import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  inAppNotifications,
  notificationContacts,
  notificationLogs,
  notificationPreferences,
  notificationWebhookEvents,
} from '../db/schema.ts';
import { env } from '../env.ts';
import { sanitizeText } from '../security/sanitize.ts';

export type AlertEventType =
  | 'case_registered'
  | 'case_assigned'
  | 'case_updated'
  | 'analysis_completed'
  | 'high_risk_indicator'
  | 'evidence_submitted'
  | 'evidence_integrity_failed'
  | 'custody_event'
  | 'ledger_verification_alert'
  | 'witness_registered'
  | 'case_closed'
  | 'security_alert'
  | 'verification_test';

export type NotificationDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'retrying'
  | 'not_configured'
  | 'expired'
  | 'skipped_duplicate'
  | 'skipped_paused'
  | 'skipped_preference';

export interface ProviderHealthCheck {
  configured: boolean;
  ready: boolean;
  status: 'NOT_CONFIGURED' | 'READY' | 'FAILED';
  provider: 'resend' | 'smtp' | 'twilio' | 'none';
  checkedAt: number;
  detail: string;
  missingEnvVars: string[];
}

export interface AlertDispatchResult {
  channel: 'email' | 'sms';
  provider: 'resend' | 'smtp' | 'twilio' | 'none';
  recipientMasked: string;
  status: NotificationDeliveryStatus;
  providerMessageId: string | null;
  errorDetail: string | null;
  attempts: number;
}

export interface UserNotificationPrefs {
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  caseRegistered: boolean;
  caseAssigned: boolean;
  caseUpdated: boolean;
  analysisCompleted: boolean;
  highRiskIndicator: boolean;
  evidenceSubmitted: boolean;
  evidenceIntegrityFailed: boolean;
  custodyEvent: boolean;
  witnessRegistered: boolean;
  caseClosed: boolean;
  securityAlert: boolean;
  updatedAt: number;
}

type InAppBroadcastFn = (userId: string, payload: unknown) => void;
let inAppBroadcaster: InAppBroadcastFn | null = null;

export function registerInAppNotifier(fn: InAppBroadcastFn) {
  inAppBroadcaster = fn;
}

export function maskContactDestination(channel: 'email' | 'sms', destination: string): string {
  if (channel === 'email') {
    const [local, domain] = destination.split('@');
    if (!local || !domain) return '***';
    const prefix = local.slice(0, 2);
    return `${prefix}***@${domain}`;
  }
  const digits = destination.replace(/\s+/g, '');
  if (digits.length <= 4) return '****';
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}

export function hashVerificationCode(code: string): string {
  return crypto.createHmac('sha256', env.sessionSecret).update(code).digest('hex');
}

export function verifyHashedOtpCode(inputCode: string, expectedHash: string | null | undefined): boolean {
  if (!expectedHash) return false;
  const candidate = hashVerificationCode(inputCode);
  if (candidate.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expectedHash, 'utf8'));
}

export function validateEmailAddress(raw: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    return { ok: false, error: 'Email address cannot be empty or contain control characters.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) || trimmed.length > 160) {
    return { ok: false, error: 'Please enter a valid email address (e.g., investigator@agency.org).' };
  }
  return { ok: true, normalized: trimmed };
}

export function normalizeE164Phone(
  rawNumber: string,
  rawCountryCode = '',
): { ok: true; e164: string; countryCode: string } | { ok: false; error: string } {
  const cleanedNum = rawNumber.trim().replace(/[\s()-]/g, '');
  const cleanedCc = rawCountryCode.trim().replace(/[^\d+]/g, '');

  let full = cleanedNum;
  if (!full.startsWith('+')) {
    if (!cleanedCc) {
      return { ok: false, error: 'Select a country calling code or include + prefix (e.g. +919876543210).' };
    }
    const cc = cleanedCc.startsWith('+') ? cleanedCc : `+${cleanedCc}`;
    full = `${cc}${cleanedNum.replace(/^0+/, '')}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(full)) {
    return {
      ok: false,
      error: 'Phone number must follow international E.164 format (e.g. +919876543210 or +14155550123).',
    };
  }

  // Enforce standard 10-digit Indian mobile range when +91 is used
  if (full.startsWith('+91')) {
    const localIn = full.slice(3);
    if (!/^[6-9]\d{9}$/.test(localIn)) {
      return {
        ok: false,
        error: 'Indian (+91) mobile numbers must be 10 digits starting with 6, 7, 8, or 9.',
      };
    }
  }

  const matchedCc = cleanedCc
    ? cleanedCc.startsWith('+')
      ? cleanedCc
      : `+${cleanedCc}`
    : full.slice(0, full.startsWith('+1') ? 2 : 3);

  return { ok: true, e164: full, countryCode: matchedCc };
}

export function buildPublicAppUrl(querySuffix = ''): string {
  const base = env.qrBaseUrl || env.appBaseUrl || env.appUrl || '';
  const cleanBase = base.replace(/\/$/, '');
  if (!cleanBase) return querySuffix ? `/${querySuffix.replace(/^\//, '')}` : '/';
  return querySuffix ? `${cleanBase}/${querySuffix.replace(/^\//, '')}` : cleanBase;
}

function buildCaseUrl(caseId: string): string {
  return buildPublicAppUrl(`?case=${encodeURIComponent(caseId)}`);
}

function isPublicCallbackUrl(url: string): boolean {
  return /^https?:\/\/[^/]+/i.test(url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url);
}

// --- Provider Connectivity & Health Verification (Never assumes env vars == working) ---
let cachedHealth: { email: ProviderHealthCheck; sms: ProviderHealthCheck; cachedAt: number } | null = null;
const HEALTH_CACHE_TTL_MS = 45_000;

export function getMissingEnvReport(): { missingEmailEnv: string[]; missingSmsEnv: string[] } {
  const missingEmailEnv: string[] = [];
  if (!env.resendApiKey && !env.smtpHost) {
    missingEmailEnv.push('RESEND_API_KEY', 'RESEND_FROM_EMAIL');
  } else if (env.resendApiKey && (!env.resendFromEmail || env.resendFromEmail.includes('yourdomain.com'))) {
    missingEmailEnv.push('RESEND_FROM_EMAIL');
  } else if (env.smtpHost && (!env.smtpFrom || env.smtpFrom.includes('yourdomain.com'))) {
    missingEmailEnv.push('SMTP_FROM');
  }

  const missingSmsEnv: string[] = [];
  if (!/^AC[a-f0-9]{32}$/i.test(env.twilioAccountSid)) missingSmsEnv.push('TWILIO_ACCOUNT_SID');
  if (!env.twilioAuthToken || env.twilioAuthToken.length < 16) missingSmsEnv.push('TWILIO_AUTH_TOKEN');
  if (!/^\+[1-9]\d{7,14}$/.test(env.twilioFromNumber)) missingSmsEnv.push('TWILIO_FROM_NUMBER');

  return { missingEmailEnv, missingSmsEnv };
}

export async function checkEmailProviderHealth(): Promise<ProviderHealthCheck> {
  const checkedAt = Date.now();
  const { missingEmailEnv } = getMissingEnvReport();

  if (!env.emailProviderConfigured) {
    return {
      configured: false,
      ready: false,
      status: 'NOT_CONFIGURED',
      provider: 'none',
      checkedAt,
      detail: `Email provider credentials not configured. Set ${missingEmailEnv.join(' + ')} (or SMTP_HOST + SMTP_FROM).`,
      missingEnvVars: missingEmailEnv,
    };
  }

  if (env.resendConfigured) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://api.resend.com/domains', {
        method: 'GET',
        headers: { Authorization: `Bearer ${env.resendApiKey}` },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (res.ok) {
        return {
          configured: true,
          ready: true,
          status: 'READY',
          provider: 'resend',
          checkedAt,
          detail: `Resend API verified and reachable (sender ${env.resendFromEmail}).`,
          missingEnvVars: [],
        };
      }
      const errJson = (await res.json().catch(() => ({}))) as { message?: string };
      const reason = errJson.message || `Resend health check returned HTTP ${res.status}`;
      if (!env.smtpConfigured) {
        return {
          configured: true,
          ready: false,
          status: 'FAILED',
          provider: 'resend',
          checkedAt,
          detail: `Resend API connectivity check failed: ${reason}`,
          missingEnvVars: [],
        };
      }
    } catch (err) {
      if (!env.smtpConfigured) {
        return {
          configured: true,
          ready: false,
          status: 'FAILED',
          provider: 'resend',
          checkedAt,
          detail: `Resend API unreachable: ${err instanceof Error ? err.message : 'Network error'}`,
          missingEnvVars: [],
        };
      }
    }
  }

  if (env.smtpConfigured) {
    try {
      const transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
      });
      await transporter.verify();
      return {
        configured: true,
        ready: true,
        status: 'READY',
        provider: 'smtp',
        checkedAt,
        detail: `SMTP server ${env.smtpHost}:${env.smtpPort} verified (sender ${env.smtpFrom}).`,
        missingEnvVars: [],
      };
    } catch (err) {
      return {
        configured: true,
        ready: false,
        status: 'FAILED',
        provider: 'smtp',
        checkedAt,
        detail: `SMTP handshake failed (${env.smtpHost}:${env.smtpPort}): ${err instanceof Error ? err.message : 'Connection failed'}`,
        missingEnvVars: [],
      };
    }
  }

  return {
    configured: false,
    ready: false,
    status: 'NOT_CONFIGURED',
    provider: 'none',
    checkedAt,
    detail: 'No valid email provider configured.',
    missingEnvVars: missingEmailEnv,
  };
}

export async function checkSmsProviderHealth(): Promise<ProviderHealthCheck> {
  const checkedAt = Date.now();
  const { missingSmsEnv } = getMissingEnvReport();

  if (!env.smsProviderConfigured) {
    return {
      configured: false,
      ready: false,
      status: 'NOT_CONFIGURED',
      provider: 'none',
      checkedAt,
      detail: `Twilio SMS not configured. Missing or invalid: ${missingSmsEnv.join(', ')}.`,
      missingEnvVars: missingSmsEnv,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const auth = Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString('base64');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.twilioAccountSid)}.json`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const json = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
    if (res.ok) {
      return {
        configured: true,
        ready: true,
        status: 'READY',
        provider: 'twilio',
        checkedAt,
        detail: `Twilio account verified (${json.status || 'active'}, from ${env.twilioFromNumber}).`,
        missingEnvVars: [],
      };
    }
    return {
      configured: true,
      ready: false,
      status: 'FAILED',
      provider: 'twilio',
      checkedAt,
      detail: `Twilio API rejected credentials: ${json.message || `HTTP ${res.status}`}`,
      missingEnvVars: [],
    };
  } catch (err) {
    return {
      configured: true,
      ready: false,
      status: 'FAILED',
      provider: 'twilio',
      checkedAt,
      detail: `Twilio API unreachable: ${err instanceof Error ? err.message : 'Network error'}`,
      missingEnvVars: [],
    };
  }
}

export async function getProvidersHealthReport(forceRefresh = false): Promise<{
  email: ProviderHealthCheck;
  sms: ProviderHealthCheck;
}> {
  const now = Date.now();
  if (!forceRefresh && cachedHealth && now - cachedHealth.cachedAt < HEALTH_CACHE_TTL_MS) {
    return { email: cachedHealth.email, sms: cachedHealth.sms };
  }
  const [email, sms] = await Promise.all([checkEmailProviderHealth(), checkSmsProviderHealth()]);
  cachedHealth = { email, sms, cachedAt: now };
  return { email, sms };
}

// --- Professional HTML & Plain-Text Forensic Email Templates ---
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildForensicEmailTemplate(params: {
  title: string;
  eventLabel: string;
  bodyText: string;
  caseTitle?: string;
  caseId?: string | null;
  actionUrl?: string;
  actionLabel?: string;
  severity?: 'normal' | 'high';
}): { html: string; text: string } {
  const safeTitle = escapeHtml(sanitizeText(params.title, 140));
  const safeBadge = escapeHtml(sanitizeText(params.eventLabel.replace(/_/g, ' ').toUpperCase(), 60));
  const safeBodyHtml = escapeHtml(params.bodyText).replace(/\n/g, '<br/>');
  const targetUrl = params.actionUrl || (params.caseId ? buildCaseUrl(params.caseId) : buildPublicAppUrl());
  const ctaLabel = escapeHtml(params.actionLabel || 'Open TruthLens Dossier');
  const accentColor = params.severity === 'high' ? '#f43f5e' : '#06b6d4';

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#070b14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070b14;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#0f172a;border:1px solid #1e293b;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:18px 24px;background:#090f1d;border-bottom:1px solid #1e293b;">
              <span style="font-size:16px;font-weight:700;letter-spacing:0.08em;color:#ffffff;">TRUTHLENS</span>
              <span style="float:right;font-size:11px;font-family:monospace;padding:3px 8px;border-radius:4px;background:${accentColor}22;color:${accentColor};border:1px solid ${accentColor}55;">${safeBadge}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <h1 style="margin:0 0 14px 0;font-size:18px;line-height:1.35;color:#ffffff;">${safeTitle}</h1>
              ${params.caseTitle ? `<p style="margin:0 0 14px 0;font-size:12px;font-family:monospace;color:#38bdf8;">Investigation: ${escapeHtml(sanitizeText(params.caseTitle, 120))}</p>` : ''}
              <div style="padding:14px 16px;background:#070b14;border:1px solid #1e293b;border-radius:8px;font-size:14px;line-height:1.6;color:#cbd5e1;">
                ${safeBodyHtml}
              </div>
              ${
                targetUrl && targetUrl !== '/'
                  ? `<div style="margin-top:20px;">
                       <a href="${escapeHtml(targetUrl)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#22d3ee;color:#020617;font-size:13px;font-weight:700;text-decoration:none;">${ctaLabel}</a>
                     </div>`
                  : ''
              }
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;background:#090f1d;border-top:1px solid #1e293b;font-size:11px;line-height:1.5;color:#94a3b8;">
              TruthLens reports probabilistic forensic indicators and never asserts absolute guilt or authenticity. Private evidence files are never attached to notification messages.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${params.title}\n[${params.eventLabel.toUpperCase()}]\n${
    params.caseTitle ? `Investigation: ${params.caseTitle}\n` : ''
  }\n${params.bodyText}\n\n${
    targetUrl && targetUrl !== '/' ? `Open Dossier: ${targetUrl}\n\n` : ''
  }-- TruthLens Digital Forensics Platform (Evidence, not verdicts. Private exhibits are never attached.)`;

  return { html, text };
}

// --- Real Email Dispatch (Resend Primary + Optional SMTP Fallback) ---
async function sendViaResend(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ ok: true; messageId: string; attempts: number } | { ok: false; error: string; attempts: number }> {
  let attempt = 0;
  let lastErr = 'Resend dispatch failed';
  while (attempt < 3) {
    attempt++;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.resendFromEmail,
          to: [params.to],
          subject: params.subject,
          html: params.html,
          text: params.text,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (res.ok && json.id) {
        return { ok: true, messageId: json.id, attempts: attempt };
      }
      lastErr = json.message || `Resend HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) {
        return { ok: false, error: lastErr, attempts: attempt };
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : 'Resend network error';
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt === 1 ? 350 : 900));
    }
  }
  return { ok: false, error: lastErr, attempts: attempt };
}

async function sendViaSmtp(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ ok: true; messageId: string; attempts: number } | { ok: false; error: string; attempts: number }> {
  let attempt = 0;
  let lastErr = 'SMTP delivery failed';
  while (attempt < 2) {
    attempt++;
    try {
      const transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        connectionTimeout: 8000,
        greetingTimeout: 6000,
        auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
      });
      const info = await transporter.sendMail({
        from: env.smtpFrom,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
      return { ok: true, messageId: info.messageId || `smtp-${Date.now()}`, attempts: attempt };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : 'SMTP delivery failed';
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  return { ok: false, error: lastErr, attempts: attempt };
}

export async function sendEmailMessage(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<
  | { ok: true; provider: 'resend' | 'smtp'; messageId: string; attempts: number }
  | { ok: false; provider: 'resend' | 'smtp' | 'none'; status: 'not_configured' | 'failed'; error: string; attempts: number }
> {
  const emailCheck = validateEmailAddress(params.to);
  if (!emailCheck.ok) {
    return {
      ok: false,
      provider: 'none',
      status: 'failed',
      error: emailCheck.error,
      attempts: 0,
    };
  }

  const html =
    params.html ||
    buildForensicEmailTemplate({
      title: params.subject,
      eventLabel: 'NOTIFICATION',
      bodyText: params.text,
    }).html;

  if (env.resendConfigured) {
    const res = await sendViaResend({ to: emailCheck.normalized, subject: params.subject, text: params.text, html });
    if (res.ok) {
      return { ok: true, provider: 'resend', messageId: res.messageId, attempts: res.attempts };
    }
    if (env.smtpConfigured) {
      const smtpRes = await sendViaSmtp({ to: emailCheck.normalized, subject: params.subject, text: params.text, html });
      if (smtpRes.ok) {
        return {
          ok: true,
          provider: 'smtp',
          messageId: smtpRes.messageId,
          attempts: res.attempts + smtpRes.attempts,
        };
      }
      return {
        ok: false,
        provider: 'smtp',
        status: 'failed',
        error: `Resend failed (${res.error}); SMTP fallback failed (${smtpRes.error})`,
        attempts: res.attempts + smtpRes.attempts,
      };
    }
    return {
      ok: false,
      provider: 'resend',
      status: 'failed',
      error: res.error,
      attempts: res.attempts,
    };
  }

  if (env.smtpConfigured) {
    const res = await sendViaSmtp({ to: emailCheck.normalized, subject: params.subject, text: params.text, html });
    if (res.ok) {
      return { ok: true, provider: 'smtp', messageId: res.messageId, attempts: res.attempts };
    }
    return { ok: false, provider: 'smtp', status: 'failed', error: res.error, attempts: res.attempts };
  }

  const { missingEmailEnv } = getMissingEnvReport();
  return {
    ok: false,
    provider: 'none',
    status: 'not_configured',
    error: `Email provider not configured. Set ${missingEmailEnv.join(' + ')} (or SMTP_HOST + SMTP_FROM).`,
    attempts: 0,
  };
}

// --- Real SMS Dispatch via Twilio (Distinguishes Queued/Pending vs Sent vs Delivered) ---
async function sendViaTwilio(params: {
  to: string;
  body: string;
}): Promise<
  | {
      ok: true;
      messageId: string;
      status: 'pending' | 'sent' | 'delivered';
      attempts: number;
    }
  | { ok: false; status: 'not_configured' | 'failed'; error: string; attempts: number }
> {
  if (!env.smsProviderConfigured) {
    const { missingSmsEnv } = getMissingEnvReport();
    return {
      ok: false,
      status: 'not_configured',
      error: `Twilio SMS not configured. Missing or invalid: ${missingSmsEnv.join(', ')}.`,
      attempts: 0,
    };
  }

  const phoneCheck = normalizeE164Phone(params.to);
  if (!phoneCheck.ok) {
    return { ok: false, status: 'failed', error: phoneCheck.error, attempts: 0 };
  }

  const auth = Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.twilioAccountSid)}/Messages.json`;
  const form = new URLSearchParams({
    From: env.twilioFromNumber,
    To: phoneCheck.e164,
    Body: params.body,
  });

  const publicBase = buildPublicAppUrl();
  if (isPublicCallbackUrl(publicBase)) {
    form.set('StatusCallback', `${publicBase.replace(/\/$/, '')}/api/notifications/webhooks/twilio`);
  }

  let attempt = 0;
  let lastErr = 'Twilio dispatch failed';
  while (attempt < 3) {
    attempt++;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      const json = (await res.json().catch(() => ({}))) as {
        sid?: string;
        status?: string;
        message?: string;
        error_message?: string;
      };
      if (res.ok && json.sid) {
        const twilioStatus = (json.status || 'queued').toLowerCase();
        if (twilioStatus === 'failed' || twilioStatus === 'undelivered') {
          return {
            ok: false,
            status: 'failed',
            error: json.error_message || json.message || `Twilio status: ${twilioStatus}`,
            attempts: attempt,
          };
        }
        // Honest status: queued/accepted/sending -> 'pending', sent -> 'sent', delivered -> 'delivered'
        const mappedStatus: 'pending' | 'sent' | 'delivered' =
          twilioStatus === 'delivered'
            ? 'delivered'
            : twilioStatus === 'sent'
              ? 'sent'
              : 'pending';
        return { ok: true, messageId: json.sid, status: mappedStatus, attempts: attempt };
      }

      lastErr = json.message || json.error_message || `Twilio HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) {
        return { ok: false, status: 'failed', error: lastErr, attempts: attempt };
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : 'Twilio network error';
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt === 1 ? 350 : 900));
    }
  }
  return { ok: false, status: 'failed', error: lastErr, attempts: attempt };
}

// --- Per-User Notification Preferences ---
const DEFAULT_USER_PREFS: Omit<UserNotificationPrefs, 'updatedAt'> = {
  emailEnabled: true,
  smsEnabled: true,
  inAppEnabled: true,
  caseRegistered: true,
  caseAssigned: true,
  caseUpdated: true,
  analysisCompleted: true,
  highRiskIndicator: true,
  evidenceSubmitted: true,
  evidenceIntegrityFailed: true,
  custodyEvent: true,
  witnessRegistered: true,
  caseClosed: true,
  securityAlert: true,
};

export async function getUserNotificationPreferences(userId: string): Promise<UserNotificationPrefs> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  if (rows.length === 0) {
    return { ...DEFAULT_USER_PREFS, updatedAt: 0 };
  }
  const r = rows[0];
  return {
    emailEnabled: r.emailEnabled === 1,
    smsEnabled: r.smsEnabled === 1,
    inAppEnabled: r.inAppEnabled === 1,
    caseRegistered: r.caseRegistered === 1,
    caseAssigned: r.caseAssigned === 1,
    caseUpdated: r.caseUpdated === 1,
    analysisCompleted: r.analysisCompleted === 1,
    highRiskIndicator: r.highRiskIndicator === 1,
    evidenceSubmitted: r.evidenceSubmitted === 1,
    evidenceIntegrityFailed: r.evidenceIntegrityFailed === 1,
    custodyEvent: r.custodyEvent === 1,
    witnessRegistered: r.witnessRegistered === 1,
    caseClosed: r.caseClosed === 1,
    securityAlert: r.securityAlert === 1,
    updatedAt: r.updatedAt,
  };
}

export async function updateUserNotificationPreferences(
  userId: string,
  partial: Partial<Omit<UserNotificationPrefs, 'updatedAt'>>,
): Promise<UserNotificationPrefs> {
  const current = await getUserNotificationPreferences(userId);
  const merged = { ...current, ...partial };
  const now = Date.now();

  const existing = await db
    .select({ userId: notificationPreferences.userId })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  const values = {
    emailEnabled: merged.emailEnabled ? 1 : 0,
    smsEnabled: merged.smsEnabled ? 1 : 0,
    inAppEnabled: merged.inAppEnabled ? 1 : 0,
    caseRegistered: merged.caseRegistered ? 1 : 0,
    caseAssigned: merged.caseAssigned ? 1 : 0,
    caseUpdated: merged.caseUpdated ? 1 : 0,
    analysisCompleted: merged.analysisCompleted ? 1 : 0,
    highRiskIndicator: merged.highRiskIndicator ? 1 : 0,
    evidenceSubmitted: merged.evidenceSubmitted ? 1 : 0,
    evidenceIntegrityFailed: merged.evidenceIntegrityFailed ? 1 : 0,
    custodyEvent: merged.custodyEvent ? 1 : 0,
    witnessRegistered: merged.witnessRegistered ? 1 : 0,
    caseClosed: merged.caseClosed ? 1 : 0,
    securityAlert: merged.securityAlert ? 1 : 0,
    updatedAt: now,
  };

  if (existing.length === 0) {
    await db.insert(notificationPreferences).values({ userId, ...values });
  } else {
    await db
      .update(notificationPreferences)
      .set(values)
      .where(eq(notificationPreferences.userId, userId));
  }

  return { ...merged, updatedAt: now };
}

function isEventAllowedByPrefs(prefs: UserNotificationPrefs, eventType: AlertEventType): boolean {
  switch (eventType) {
    case 'verification_test':
      return true;
    case 'case_registered':
      return prefs.caseRegistered;
    case 'case_assigned':
      return prefs.caseAssigned;
    case 'case_updated':
      return prefs.caseUpdated;
    case 'analysis_completed':
      return prefs.analysisCompleted;
    case 'high_risk_indicator':
      return prefs.highRiskIndicator;
    case 'evidence_submitted':
      return prefs.evidenceSubmitted;
    case 'evidence_integrity_failed':
    case 'ledger_verification_alert':
      return prefs.evidenceIntegrityFailed;
    case 'custody_event':
      return prefs.custodyEvent;
    case 'witness_registered':
      return prefs.witnessRegistered;
    case 'case_closed':
      return prefs.caseClosed;
    case 'security_alert':
      return prefs.securityAlert;
    default:
      return true;
  }
}

function contactAllowsEvent(contactEventPrefsJson: string, eventType: AlertEventType): boolean {
  if (eventType === 'verification_test') return true;
  let eventPrefs: Record<string, boolean> = {};
  try {
    eventPrefs = JSON.parse(contactEventPrefsJson || '{}') as Record<string, boolean>;
  } catch {
    return true;
  }
  if (eventType === 'custody_event' || eventType === 'evidence_integrity_failed') {
    return eventPrefs.ledger_verification_alert !== false && eventPrefs[eventType] !== false;
  }
  if (eventType === 'case_closed' || eventType === 'case_registered' || eventType === 'case_assigned' || eventType === 'witness_registered' || eventType === 'evidence_submitted') {
    return eventPrefs[eventType] !== false;
  }
  return eventPrefs[eventType] !== false;
}

export async function createInAppNotification(params: {
  userId: string;
  caseId?: string | null;
  type: string;
  title: string;
  body: string;
}) {
  const prefs = await getUserNotificationPreferences(params.userId).catch(() => ({
    ...DEFAULT_USER_PREFS,
    updatedAt: 0,
  }));
  if (!prefs.inAppEnabled && params.type !== 'security_alert') {
    return null;
  }

  const item = {
    id: crypto.randomUUID(),
    userId: params.userId,
    caseId: params.caseId ?? null,
    type: sanitizeText(params.type, 50),
    title: sanitizeText(params.title, 120),
    body: sanitizeText(params.body, 400),
    read: 0,
    createdAt: Date.now(),
  };
  await db.insert(inAppNotifications).values(item);
  if (inAppBroadcaster) {
    inAppBroadcaster(params.userId, { ...item, read: false });
  }
  return item;
}

export async function sendTransactionalAccountEmail(params: {
  userId: string;
  toEmail: string;
  caseId?: string | null;
  eventType: string;
  subject: string;
  text: string;
  actionUrl?: string;
}): Promise<{
  delivered: boolean;
  status: 'sent' | 'failed' | 'not_configured';
  provider: 'resend' | 'smtp' | 'none';
  providerMessageId: string | null;
  detail: string;
}> {
  const masked = maskContactDestination('email', params.toEmail);
  const now = Date.now();
  const dedupeKey = `tx:${params.userId}:${params.eventType}:${Math.floor(now / 15000)}`;
  const templated = buildForensicEmailTemplate({
    title: params.subject,
    eventLabel: params.eventType,
    bodyText: params.text,
    caseId: params.caseId,
    actionUrl: params.actionUrl,
  });

  const res = await sendEmailMessage({
    to: params.toEmail,
    subject: params.subject,
    text: templated.text,
    html: templated.html,
  });

  const status = res.ok ? 'sent' : res.status;
  await db.insert(notificationLogs).values({
    id: crypto.randomUUID(),
    userId: params.userId,
    contactId: null,
    caseId: params.caseId ?? null,
    channel: 'email',
    provider: res.provider,
    recipientMasked: masked,
    eventType: params.eventType,
    subjectOrPreview: sanitizeText(params.subject, 120),
    status,
    providerMessageId: res.ok ? res.messageId : null,
    errorDetail: res.ok ? null : sanitizeText(res.error, 240),
    dedupeKey,
    attempts: res.attempts,
    retryCount: status === 'failed' ? Math.max(0, res.attempts - 1) : 0,
    createdAt: now,
    updatedAt: now,
  });

  return {
    delivered: res.ok,
    status,
    provider: res.provider,
    providerMessageId: res.ok ? res.messageId : null,
    detail: res.ok ? `Email accepted by ${res.provider.toUpperCase()} for ${masked}.` : res.error,
  };
}

export async function dispatchVerificationChallenge(params: {
  userId: string;
  contactId?: string;
  channel: 'email' | 'sms';
  destination: string;
  code: string;
}): Promise<{
  delivered: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'not_configured';
  provider: 'resend' | 'smtp' | 'twilio' | 'none';
  providerMessageId: string | null;
  detail: string;
}> {
  const masked = maskContactDestination(params.channel, params.destination);
  const now = Date.now();
  const dedupeKey = `verify:${params.userId}:${params.channel}:${Math.floor(now / 10000)}`;

  if (params.channel === 'email') {
    const templated = buildForensicEmailTemplate({
      title: 'Verify Your TruthLens Alert Contact',
      eventLabel: 'CONTACT VERIFICATION OTP',
      bodyText: `Your 6-digit TruthLens verification code is:\n\n${params.code}\n\nThis OTP expires in 15 minutes and allows a maximum of 5 verification attempts. Private evidence files are never attached to alerts.`,
    });

    const res = await sendEmailMessage({
      to: params.destination,
      subject: 'TruthLens Investigation Alerts — 6-Digit Verification OTP',
      text: templated.text,
      html: templated.html,
    });
    const status = res.ok ? 'sent' : res.status;
    await db.insert(notificationLogs).values({
      id: crypto.randomUUID(),
      userId: params.userId,
      contactId: params.contactId ?? null,
      caseId: null,
      channel: 'email',
      provider: res.provider,
      recipientMasked: masked,
      eventType: 'contact_verification',
      subjectOrPreview: '6-digit contact verification OTP',
      status,
      providerMessageId: res.ok ? res.messageId : null,
      errorDetail: res.ok ? null : sanitizeText(res.error, 240),
      dedupeKey,
      attempts: res.attempts,
      retryCount: status === 'failed' ? Math.max(0, res.attempts - 1) : 0,
      createdAt: now,
      updatedAt: now,
    });
    return {
      delivered: res.ok,
      status,
      provider: res.provider,
      providerMessageId: res.ok ? res.messageId : null,
      detail: res.ok
        ? `Verification OTP sent via ${res.provider.toUpperCase()} to ${masked}. Check your inbox and enter the 6-digit code to activate.`
        : res.error,
    };
  }

  const smsBody = `TruthLens verification OTP: ${params.code}. Expires in 15 min. Reply STOP to opt out.`;
  const smsRes = await sendViaTwilio({
    to: params.destination,
    body: smsBody,
  });

  const status = smsRes.ok ? smsRes.status : smsRes.status;
  await db.insert(notificationLogs).values({
    id: crypto.randomUUID(),
    userId: params.userId,
    contactId: params.contactId ?? null,
    caseId: null,
    channel: 'sms',
    provider: env.smsProviderConfigured ? 'twilio' : 'none',
    recipientMasked: masked,
    eventType: 'contact_verification',
    subjectOrPreview: '6-digit SMS OTP challenge',
    status,
    providerMessageId: smsRes.ok ? smsRes.messageId : null,
    errorDetail: smsRes.ok ? null : sanitizeText(smsRes.error, 240),
    dedupeKey,
    attempts: smsRes.attempts,
    retryCount: status === 'failed' ? Math.max(0, smsRes.attempts - 1) : 0,
    createdAt: now,
    updatedAt: now,
  });

  return {
    delivered: smsRes.ok,
    status,
    provider: env.smsProviderConfigured ? 'twilio' : 'none',
    providerMessageId: smsRes.ok ? smsRes.messageId : null,
    detail: smsRes.ok
      ? `Verification OTP accepted by Twilio (${status.toUpperCase()}, SID ${smsRes.messageId}) for ${masked}.`
      : smsRes.error,
  };
}

export async function dispatchCaseAlerts(params: {
  userId: string;
  caseId: string;
  caseTitle: string;
  eventType: AlertEventType;
  summaryLine: string;
  channelFilter?: 'email' | 'sms' | 'all';
  contactIdFilter?: string;
}): Promise<AlertDispatchResult[]> {
  const userPrefs = await getUserNotificationPreferences(params.userId).catch(() => ({
    ...DEFAULT_USER_PREFS,
    updatedAt: 0,
  }));

  if (params.eventType !== 'verification_test' && !isEventAllowedByPrefs(userPrefs, params.eventType)) {
    return [
      {
        channel: 'email',
        provider: 'none',
        recipientMasked: 'user-prefs',
        status: 'skipped_preference',
        providerMessageId: null,
        errorDetail: `Event "${params.eventType}" is disabled in user notification preferences.`,
        attempts: 0,
      },
    ];
  }

  // Record in-app notification unless in-app is muted (tests and security alerts always appear)
  if (params.eventType === 'verification_test' || params.eventType === 'security_alert' || userPrefs.inAppEnabled) {
    await createInAppNotification({
      userId: params.userId,
      caseId: params.caseId,
      type: params.eventType,
      title: `${params.eventType.replace(/_/g, ' ').toUpperCase()} — ${sanitizeText(params.caseTitle, 80)}`,
      body: sanitizeText(params.summaryLine, 260),
    }).catch(() => {});
  }

  const allContacts = await db
    .select()
    .from(notificationContacts)
    .where(eq(notificationContacts.userId, params.userId));

  const contacts = allContacts.filter((c) => {
    if (params.contactIdFilter && c.id !== params.contactIdFilter) return false;
    if (params.channelFilter && params.channelFilter !== 'all' && c.channel !== params.channelFilter) return false;
    return true;
  });

  const results: AlertDispatchResult[] = [];
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const caseUrl = buildCaseUrl(params.caseId);

  for (const contact of contacts) {
    if (contact.verified !== 1 || contact.consentGranted !== 1) {
      continue;
    }

    const channel = contact.channel === 'sms' ? 'sms' : 'email';
    const masked = maskContactDestination(channel, contact.destination);

    if (params.eventType !== 'verification_test') {
      if (channel === 'email' && !userPrefs.emailEnabled) continue;
      if (channel === 'sms' && !userPrefs.smsEnabled) continue;
    }

    if (contact.paused === 1) {
      results.push({
        channel,
        provider: 'none',
        recipientMasked: masked,
        status: 'skipped_paused',
        providerMessageId: null,
        errorDetail: 'Contact is paused / opted out.',
        attempts: 0,
      });
      continue;
    }

    if (!contactAllowsEvent(contact.eventPrefsJson, params.eventType)) {
      continue;
    }

    const dedupeKey = `${params.userId}:${params.caseId}:${params.eventType}:${contact.id}:${Math.floor(now / (5 * 60 * 1000))}`;
    const recentLogs = await db
      .select()
      .from(notificationLogs)
      .where(and(eq(notificationLogs.userId, params.userId), gte(notificationLogs.createdAt, oneHourAgo)))
      .orderBy(desc(notificationLogs.createdAt));

    if (params.eventType !== 'verification_test') {
      const duplicate = recentLogs.some(
        (l) => l.dedupeKey === dedupeKey && (l.status === 'sent' || l.status === 'delivered' || l.status === 'pending'),
      );
      if (duplicate || recentLogs.length >= 30) {
        await db.insert(notificationLogs).values({
          id: crypto.randomUUID(),
          userId: params.userId,
          contactId: contact.id,
          caseId: params.caseId,
          channel,
          provider: 'none',
          recipientMasked: masked,
          eventType: params.eventType,
          subjectOrPreview: sanitizeText(params.caseTitle, 100),
          status: 'skipped_duplicate',
          providerMessageId: null,
          errorDetail: duplicate ? 'Deduplicated within 5-minute window' : 'Hourly notification cap reached',
          dedupeKey,
          attempts: 0,
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        });
        results.push({
          channel,
          provider: 'none',
          recipientMasked: masked,
          status: 'skipped_duplicate',
          providerMessageId: null,
          errorDetail: duplicate ? 'Deduplicated within 5-minute window' : 'Hourly alert limit reached',
          attempts: 0,
        });
        continue;
      }
    }

    const safeTitle = sanitizeText(params.caseTitle, 100);
    const safeSummary = sanitizeText(params.summaryLine, 240);

    if (channel === 'email') {
      const subject = `[TruthLens Alert] ${safeTitle} (${params.eventType.replace(/_/g, ' ')})`;
      const templated = buildForensicEmailTemplate({
        title: `TruthLens Alert — ${params.eventType.replace(/_/g, ' ').toUpperCase()}`,
        eventLabel: params.eventType,
        caseTitle: safeTitle,
        caseId: params.caseId,
        bodyText: safeSummary,
        severity:
          params.eventType === 'high_risk_indicator' ||
          params.eventType === 'evidence_integrity_failed' ||
          params.eventType === 'ledger_verification_alert'
            ? 'high'
            : 'normal',
      });

      const res = await sendEmailMessage({
        to: contact.destination,
        subject,
        text: templated.text,
        html: templated.html,
      });
      const status = res.ok ? 'sent' : res.status;

      await db.insert(notificationLogs).values({
        id: crypto.randomUUID(),
        userId: params.userId,
        contactId: contact.id,
        caseId: params.caseId,
        channel: 'email',
        provider: res.provider,
        recipientMasked: masked,
        eventType: params.eventType,
        subjectOrPreview: subject,
        status,
        providerMessageId: res.ok ? res.messageId : null,
        errorDetail: res.ok ? null : sanitizeText(res.error, 240),
        dedupeKey,
        attempts: res.attempts,
        retryCount: status === 'failed' ? Math.max(0, res.attempts - 1) : 0,
        createdAt: now,
        updatedAt: now,
      });

      if (!res.ok) {
        await db
          .update(notificationContacts)
          .set({ lastError: sanitizeText(res.error, 240), updatedAt: now })
          .where(eq(notificationContacts.id, contact.id));
      }

      results.push({
        channel: 'email',
        provider: res.provider,
        recipientMasked: masked,
        status,
        providerMessageId: res.ok ? res.messageId : null,
        errorDetail: res.ok ? null : res.error,
        attempts: res.attempts,
      });
    } else {
      const smsText = `TruthLens [${params.eventType.replace(/_/g, ' ')}]: ${safeTitle}. ${safeSummary.slice(0, 110)} Open: ${caseUrl}`;
      const smsRes = await sendViaTwilio({
        to: contact.destination,
        body: smsText,
      });

      const status = smsRes.ok ? smsRes.status : smsRes.status;
      const provider = env.smsProviderConfigured ? 'twilio' : 'none';

      await db.insert(notificationLogs).values({
        id: crypto.randomUUID(),
        userId: params.userId,
        contactId: contact.id,
        caseId: params.caseId,
        channel: 'sms',
        provider,
        recipientMasked: masked,
        eventType: params.eventType,
        subjectOrPreview: sanitizeText(smsText, 120),
        status,
        providerMessageId: smsRes.ok ? smsRes.messageId : null,
        errorDetail: smsRes.ok ? null : sanitizeText(smsRes.error, 240),
        dedupeKey,
        attempts: smsRes.attempts,
        retryCount: status === 'failed' ? Math.max(0, smsRes.attempts - 1) : 0,
        createdAt: now,
        updatedAt: now,
      });

      if (!smsRes.ok) {
        await db
          .update(notificationContacts)
          .set({ lastError: sanitizeText(smsRes.error, 240), updatedAt: now })
          .where(eq(notificationContacts.id, contact.id));
      }

      results.push({
        channel: 'sms',
        provider,
        recipientMasked: masked,
        status,
        providerMessageId: smsRes.ok ? smsRes.messageId : null,
        errorDetail: smsRes.ok ? null : smsRes.error,
        attempts: smsRes.attempts,
      });
    }
  }

  return results;
}

export async function dispatchCaseNotificationToParticipants(params: {
  userIds: Array<string | null | undefined>;
  caseId: string;
  caseTitle: string;
  eventType: AlertEventType;
  summaryLine: string;
}): Promise<void> {
  const uniqueIds = Array.from(new Set(params.userIds.filter((id): id is string => Boolean(id))));
  await Promise.all(
    uniqueIds.map((userId) =>
      dispatchCaseAlerts({
        userId,
        caseId: params.caseId,
        caseTitle: params.caseTitle,
        eventType: params.eventType,
        summaryLine: params.summaryLine,
      }).catch(() => []),
    ),
  );
}

export async function retryNotificationLog(logId: string, userId: string) {
  const rows = await db
    .select()
    .from(notificationLogs)
    .where(and(eq(notificationLogs.id, logId), eq(notificationLogs.userId, userId)))
    .limit(1);

  if (rows.length === 0) return null;
  const log = rows[0];
  const now = Date.now();

  let targetContact = null as typeof notificationContacts.$inferSelect | null;
  if (log.contactId) {
    const specific = await db
      .select()
      .from(notificationContacts)
      .where(and(eq(notificationContacts.id, log.contactId), eq(notificationContacts.userId, userId)))
      .limit(1);
    if (specific.length > 0) targetContact = specific[0];
  }
  if (!targetContact) {
    const fallback = await db
      .select()
      .from(notificationContacts)
      .where(
        and(
          eq(notificationContacts.userId, userId),
          eq(notificationContacts.channel, log.channel),
          eq(notificationContacts.verified, 1),
          eq(notificationContacts.paused, 0),
        ),
      )
      .limit(1);
    if (fallback.length > 0) targetContact = fallback[0];
  }

  if (!targetContact || targetContact.verified !== 1 || targetContact.paused === 1 || targetContact.consentGranted !== 1) {
    await db
      .update(notificationLogs)
      .set({
        status: 'failed',
        errorDetail: 'No verified, consented, unpaused contact available to retry this dispatch.',
        retryCount: (log.retryCount || 0) + 1,
        attempts: (log.attempts || 1) + 1,
        updatedAt: now,
      })
      .where(eq(notificationLogs.id, logId));
    return {
      status: 'failed',
      provider: 'none',
      providerMessageId: null,
      detail: 'No verified, consented, unpaused contact found for this channel.',
    };
  }

  const dest = targetContact.destination;
  const caseUrl = log.caseId ? buildCaseUrl(log.caseId) : buildPublicAppUrl();

  await db
    .update(notificationLogs)
    .set({ status: 'retrying', updatedAt: now })
    .where(eq(notificationLogs.id, logId));

  if (log.channel === 'email') {
    const subject = log.subjectOrPreview || `[TruthLens Retry] Investigation Alert (${log.eventType.replace(/_/g, ' ')})`;
    const templated = buildForensicEmailTemplate({
      title: `Retried TruthLens Alert — ${log.eventType.replace(/_/g, ' ').toUpperCase()}`,
      eventLabel: log.eventType,
      caseId: log.caseId,
      bodyText: `Retried forensic notification for event: ${log.eventType.replace(/_/g, ' ')}.\nOpen case: ${caseUrl}`,
    });
    const res = await sendEmailMessage({
      to: dest,
      subject,
      text: templated.text,
      html: templated.html,
    });
    const newStatus = res.ok ? 'sent' : res.status;
    await db
      .update(notificationLogs)
      .set({
        status: newStatus,
        provider: res.provider,
        providerMessageId: res.ok ? res.messageId : null,
        errorDetail: res.ok ? null : sanitizeText(res.error, 240),
        attempts: (log.attempts || 1) + res.attempts,
        retryCount: (log.retryCount || 0) + 1,
        updatedAt: Date.now(),
      })
      .where(eq(notificationLogs.id, logId));
    return {
      status: newStatus,
      provider: res.provider,
      providerMessageId: res.ok ? res.messageId : null,
      detail: res.ok ? `Retry accepted by ${res.provider.toUpperCase()} (ID: ${res.messageId}).` : res.error,
    };
  }

  const smsRes = await sendViaTwilio({
    to: dest,
    body: `TruthLens Retry [${log.eventType.replace(/_/g, ' ')}]: Open ${caseUrl}`,
  });
  const newStatus = smsRes.ok ? smsRes.status : smsRes.status;
  const provider = env.smsProviderConfigured ? 'twilio' : 'none';
  await db
    .update(notificationLogs)
    .set({
      status: newStatus,
      provider,
      providerMessageId: smsRes.ok ? smsRes.messageId : null,
      errorDetail: smsRes.ok ? null : sanitizeText(smsRes.error, 240),
      attempts: (log.attempts || 1) + smsRes.attempts,
      retryCount: (log.retryCount || 0) + 1,
      updatedAt: Date.now(),
    })
    .where(eq(notificationLogs.id, logId));

  return {
    status: newStatus,
    provider,
    providerMessageId: smsRes.ok ? smsRes.messageId : null,
    detail: smsRes.ok ? `Retry SMS accepted by Twilio (SID: ${smsRes.messageId}, ${newStatus}).` : smsRes.error,
  };
}

// --- Webhook Verification & Status Transitions ---
function verifySvixSignature(rawBody: string, headers: Record<string, string | string[] | undefined>, secret: string): boolean {
  if (!secret) return true; // Optional secret when not configured
  const svixId = String(headers['svix-id'] || '');
  const svixTimestamp = String(headers['svix-timestamp'] || '');
  const svixSignature = String(headers['svix-signature'] || '');
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const secretKey = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret, 'utf8');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretKey).update(signedContent).digest('base64');

  const sigs = svixSignature.split(' ').map((part) => part.split(',')[1]).filter(Boolean);
  return sigs.some((sig) => {
    try {
      const a = Buffer.from(sig, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

function verifyTwilioSignature(fullUrl: string, params: Record<string, string>, signatureHeader: string): boolean {
  if (!env.twilioAuthToken) return true;
  if (!signatureHeader) return false;
  const keys = Object.keys(params).sort();
  let data = fullUrl;
  for (const k of keys) {
    data += k + (params[k] ?? '');
  }
  const expected = crypto.createHmac('sha1', env.twilioAuthToken).update(data).digest('base64');
  try {
    const a = Buffer.from(signatureHeader, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function processResendWebhook(params: {
  rawBody: string;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}): Promise<{ ok: boolean; statusCode: number; detail: string }> {
  const signatureValid = verifySvixSignature(params.rawBody, params.headers, env.resendWebhookSecret);
  if (env.resendWebhookSecret && !signatureValid) {
    return { ok: false, statusCode: 401, detail: 'Invalid Resend webhook signature.' };
  }

  const eventType = String(params.body.type || 'unknown');
  const data = (params.body.data && typeof params.body.data === 'object' ? params.body.data : {}) as Record<string, unknown>;
  const messageId = typeof data.email_id === 'string' ? data.email_id : typeof data.id === 'string' ? data.id : null;

  let mappedStatus = 'sent';
  if (eventType === 'email.delivered') mappedStatus = 'delivered';
  else if (eventType === 'email.delivery_delayed') mappedStatus = 'retrying';
  else if (eventType === 'email.bounced' || eventType === 'email.complained' || eventType === 'email.failed') {
    mappedStatus = 'failed';
  }

  const now = Date.now();
  await db.insert(notificationWebhookEvents).values({
    id: crypto.randomUUID(),
    provider: 'resend',
    eventType: sanitizeText(eventType, 80),
    providerMessageId: messageId,
    status: mappedStatus,
    payloadSummary: sanitizeText(JSON.stringify(data).slice(0, 300), 300),
    signatureValid: signatureValid ? 1 : 0,
    receivedAt: now,
  });

  if (messageId) {
    const logs = await db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.providerMessageId, messageId))
      .limit(1);
    if (logs.length > 0) {
      const log = logs[0];
      await db
        .update(notificationLogs)
        .set({
          status: mappedStatus,
          deliveredAt: mappedStatus === 'delivered' ? now : log.deliveredAt,
          errorDetail: mappedStatus === 'failed' ? sanitizeText(`Resend webhook: ${eventType}`, 240) : log.errorDetail,
          updatedAt: now,
        })
        .where(eq(notificationLogs.id, log.id));

      if (mappedStatus === 'delivered' && log.contactId) {
        await db
          .update(notificationContacts)
          .set({ lastDeliveredAt: now, lastError: null, updatedAt: now })
          .where(eq(notificationContacts.id, log.contactId));
      }
    }
  }

  return { ok: true, statusCode: 200, detail: `Processed ${eventType}` };
}

export async function processTwilioWebhook(params: {
  fullUrl: string;
  body: Record<string, string>;
  signatureHeader: string;
}): Promise<{ ok: boolean; statusCode: number; detail: string }> {
  const signatureValid = verifyTwilioSignature(params.fullUrl, params.body, params.signatureHeader);
  if (env.twilioAuthToken && !signatureValid) {
    return { ok: false, statusCode: 401, detail: 'Invalid Twilio webhook signature.' };
  }

  const sid = String(params.body.MessageSid || params.body.SmsSid || '').trim() || null;
  const rawStatus = String(params.body.MessageStatus || params.body.SmsStatus || 'unknown').toLowerCase();
  const errorCode = params.body.ErrorCode ? `Twilio error ${params.body.ErrorCode}` : '';
  const errorMessage = params.body.ErrorMessage || errorCode || '';

  let mappedStatus: string = 'pending';
  if (rawStatus === 'delivered') mappedStatus = 'delivered';
  else if (rawStatus === 'sent' || rawStatus === 'sending') mappedStatus = 'sent';
  else if (rawStatus === 'queued' || rawStatus === 'accepted') mappedStatus = 'pending';
  else if (rawStatus === 'failed' || rawStatus === 'undelivered' || rawStatus === 'canceled') mappedStatus = 'failed';

  const now = Date.now();
  await db.insert(notificationWebhookEvents).values({
    id: crypto.randomUUID(),
    provider: 'twilio',
    eventType: `sms.${rawStatus}`,
    providerMessageId: sid,
    status: mappedStatus,
    payloadSummary: sanitizeText(
      `sid=${sid || 'none'} status=${rawStatus}${errorMessage ? ` error=${errorMessage}` : ''}`,
      300,
    ),
    signatureValid: signatureValid ? 1 : 0,
    receivedAt: now,
  });

  if (sid) {
    const logs = await db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.providerMessageId, sid))
      .limit(1);
    if (logs.length > 0) {
      const log = logs[0];
      await db
        .update(notificationLogs)
        .set({
          status: mappedStatus,
          deliveredAt: mappedStatus === 'delivered' ? now : log.deliveredAt,
          errorDetail: mappedStatus === 'failed' ? sanitizeText(errorMessage || `Twilio: ${rawStatus}`, 240) : log.errorDetail,
          updatedAt: now,
        })
        .where(eq(notificationLogs.id, log.id));

      if (mappedStatus === 'delivered' && log.contactId) {
        await db
          .update(notificationContacts)
          .set({ lastDeliveredAt: now, lastError: null, updatedAt: now })
          .where(eq(notificationContacts.id, log.contactId));
      } else if (mappedStatus === 'failed' && log.contactId) {
        await db
          .update(notificationContacts)
          .set({ lastError: sanitizeText(errorMessage || `Twilio: ${rawStatus}`, 240), updatedAt: now })
          .where(eq(notificationContacts.id, log.contactId));
      }
    }
  }

  return { ok: true, statusCode: 200, detail: `Processed Twilio status ${rawStatus}` };
}
