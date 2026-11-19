import 'dotenv/config';
import crypto from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(15),
  DB_PATH: z.string().optional(),
  STORAGE_DIR: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_BOOTSTRAP_SECRET: z.string().optional(),
  APP_URL: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  QR_BASE_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const isProd = parsed.data.NODE_ENV === 'production';

let resolvedSessionSecret = parsed.data.SESSION_SECRET?.trim() ?? '';
if (isProd && resolvedSessionSecret.length < 32) {
  console.error('FATAL: SESSION_SECRET must be set (min 32 chars) in production.');
  process.exit(1);
}
if (!resolvedSessionSecret) {
  resolvedSessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[security] SESSION_SECRET not set in environment; generated ephemeral runtime secret.');
}

if (!parsed.data.GEMINI_API_KEY || parsed.data.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
  console.warn('[ai] GEMINI_API_KEY is not configured; Gemini multimodal endpoints will fall back to deterministic analysis.');
}

const geminiModelRaw = parsed.data.GEMINI_MODEL?.trim();
const deprecatedModels = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);
const geminiModel =
  geminiModelRaw && geminiModelRaw.length > 0 && !deprecatedModels.has(geminiModelRaw)
    ? geminiModelRaw
    : 'gemini-4-hydrogen';

function extractSenderEmail(raw: string): string {
  const angleMatch = raw.match(/<([^<>]+)>/);
  return (angleMatch ? angleMatch[1] : raw).trim().toLowerCase();
}

function isValidSenderEmail(raw: string): boolean {
  const email = extractSenderEmail(raw);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && !email.endsWith('@yourdomain.com');
}

const resendApiKey = parsed.data.RESEND_API_KEY?.trim() || '';
const resendFromEmail = parsed.data.RESEND_FROM_EMAIL?.trim() || '';
const resendWebhookSecret = parsed.data.RESEND_WEBHOOK_SECRET?.trim() || '';

const smtpHost = parsed.data.SMTP_HOST?.trim() || '';
const smtpPort = parsed.data.SMTP_PORT;
const smtpSecure = parsed.data.SMTP_SECURE === 'true' || smtpPort === 465;
const smtpUser = parsed.data.SMTP_USER?.trim() || '';
const smtpPass = parsed.data.SMTP_PASS?.trim() || '';
const smtpFrom = parsed.data.SMTP_FROM?.trim() || smtpUser || '';

const twilioAccountSid = parsed.data.TWILIO_ACCOUNT_SID?.trim() || '';
const twilioAuthToken = parsed.data.TWILIO_AUTH_TOKEN?.trim() || '';
const twilioFromNumber = parsed.data.TWILIO_FROM_NUMBER?.trim() || '';

const resendConfigured = Boolean(resendApiKey && resendFromEmail && isValidSenderEmail(resendFromEmail));
const smtpConfigured = Boolean(smtpHost && smtpFrom && isValidSenderEmail(smtpFrom));
const emailProviderType: 'resend' | 'smtp' | 'none' = resendConfigured
  ? 'resend'
  : smtpConfigured
    ? 'smtp'
    : 'none';

const smsProviderConfigured = Boolean(
  /^AC[a-f0-9]{32}$/i.test(twilioAccountSid) &&
    twilioAuthToken.length >= 16 &&
    /^\+[1-9]\d{7,14}$/.test(twilioFromNumber),
);

const appBaseUrlRaw = parsed.data.APP_BASE_URL?.trim() || '';
const appUrlRaw =
  parsed.data.APP_URL && parsed.data.APP_URL !== 'MY_APP_URL' ? parsed.data.APP_URL.trim() : '';
const appUrl = appBaseUrlRaw || appUrlRaw;
const qrBaseUrl = parsed.data.QR_BASE_URL?.trim() || appUrl;

const allowedOrigins = (parsed.data.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => {
    try {
      const u = new URL(o);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  });

if (appUrl) {
  try {
    const parsedAppUrl = new URL(appUrl);
    if (!allowedOrigins.includes(parsedAppUrl.origin)) {
      allowedOrigins.push(parsedAppUrl.origin);
    }
  } catch {
    // ignore malformed APP_URL
  }
}

const rawPort = parsed.data.PORT;
const resolvedPort =
  process.env.NGINX_PORT && String(rawPort) === String(process.env.NGINX_PORT)
    ? Number(process.env.DEFAULT_APP_PORT || 3000)
    : rawPort;

export const env = {
  nodeEnv: parsed.data.NODE_ENV,
  isProd,
  debugMode: false,
  port: resolvedPort,
  geminiApiKey:
    parsed.data.GEMINI_API_KEY && parsed.data.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ? parsed.data.GEMINI_API_KEY.trim()
      : '',
  geminiModel,
  maxUploadMb: parsed.data.MAX_UPLOAD_MB,
  maxUploadBytes: parsed.data.MAX_UPLOAD_MB * 1024 * 1024,
  dbPath: parsed.data.DB_PATH?.trim() || '',
  storageDir: parsed.data.STORAGE_DIR?.trim() || '',
  sessionSecret: resolvedSessionSecret,
  allowedOrigins,
  adminEmail: (parsed.data.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminBootstrapSecret: (parsed.data.ADMIN_BOOTSTRAP_SECRET || '').trim(),
  appUrl,
  appBaseUrl: appUrl,
  qrBaseUrl,
  resendApiKey,
  resendFromEmail,
  resendWebhookSecret,
  smtpHost,
  smtpPort,
  smtpSecure,
  smtpUser,
  smtpPass,
  smtpFrom,
  twilioAccountSid,
  twilioAuthToken,
  twilioFromNumber,
  resendConfigured,
  smtpConfigured,
  emailProviderType,
  emailProviderConfigured: resendConfigured || smtpConfigured,
  smsProviderConfigured,
} as const;
