import crypto from 'node:crypto';
import express, { type Express } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  inAppNotifications,
  notificationContacts,
  notificationLogs,
  notificationWebhookEvents,
  otpVerifications,
} from '../db/schema.ts';
import { env } from '../env.ts';
import {
  dispatchCaseAlerts,
  dispatchVerificationChallenge,
  getMissingEnvReport,
  getProvidersHealthReport,
  getUserNotificationPreferences,
  hashVerificationCode,
  maskContactDestination,
  normalizeE164Phone,
  processResendWebhook,
  processTwilioWebhook,
  retryNotificationLog,
  updateUserNotificationPreferences,
  validateEmailAddress,
  verifyHashedOtpCode,
} from '../notifications/notifier.ts';
import { recordAuditEvent } from '../security/audit.ts';
import { type AuthedRequest, asyncHandler, requireAuth, requireCsrf } from '../security/auth.ts';
import { sanitizeText } from '../security/sanitize.ts';

const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_EXPIRY_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const contactSchema = z.object({
  channel: z.enum(['email', 'sms']),
  countryCode: z.string().max(8).optional().default(''),
  destination: z.string().min(5).max(160),
  consentGranted: z.boolean(),
  eventPrefs: z
    .object({
      analysis_completed: z.boolean().optional(),
      high_risk_indicator: z.boolean().optional(),
      case_updated: z.boolean().optional(),
      ledger_verification_alert: z.boolean().optional(),
      case_registered: z.boolean().optional(),
      case_assigned: z.boolean().optional(),
      evidence_submitted: z.boolean().optional(),
      witness_registered: z.boolean().optional(),
      case_closed: z.boolean().optional(),
    })
    .optional(),
});

const verifyContactSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const contactPrefsSchema = z.object({
  analysis_completed: z.boolean(),
  high_risk_indicator: z.boolean(),
  case_updated: z.boolean(),
  ledger_verification_alert: z.boolean(),
});

const globalPrefsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  caseRegistered: z.boolean().optional(),
  caseAssigned: z.boolean().optional(),
  caseUpdated: z.boolean().optional(),
  analysisCompleted: z.boolean().optional(),
  highRiskIndicator: z.boolean().optional(),
  evidenceSubmitted: z.boolean().optional(),
  evidenceIntegrityFailed: z.boolean().optional(),
  custodyEvent: z.boolean().optional(),
  witnessRegistered: z.boolean().optional(),
  caseClosed: z.boolean().optional(),
  securityAlert: z.boolean().optional(),
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => {
    const authed = req as AuthedRequest;
    return authed.user?.id ? `otp:${authed.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait before trying again.' },
});

export function registerNotificationRoutes(app: Express) {
  // --- Unified Notification Status, Verified Provider Connectivity & Audit Feed ---
  app.get('/api/notifications/status', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const userId = req.user!.id;

    const [health, prefs, contacts, logs, otpRows, webhookEvents] = await Promise.all([
      getProvidersHealthReport(forceRefresh),
      getUserNotificationPreferences(userId),
      db
        .select()
        .from(notificationContacts)
        .where(eq(notificationContacts.userId, userId))
        .orderBy(desc(notificationContacts.createdAt)),
      db
        .select()
        .from(notificationLogs)
        .where(eq(notificationLogs.userId, userId))
        .orderBy(desc(notificationLogs.createdAt))
        .limit(50),
      db
        .select()
        .from(otpVerifications)
        .where(eq(otpVerifications.userId, userId))
        .orderBy(desc(otpVerifications.createdAt))
        .limit(40),
      db
        .select()
        .from(notificationWebhookEvents)
        .orderBy(desc(notificationWebhookEvents.receivedAt))
        .limit(20),
    ]);

    const latestOtpByContact = new Map<string, typeof otpVerifications.$inferSelect>();
    for (const row of otpRows) {
      if (!latestOtpByContact.has(row.contactId)) {
        latestOtpByContact.set(row.contactId, row);
      }
    }

    const now = Date.now();
    const { missingEmailEnv, missingSmsEnv } = getMissingEnvReport();
    const lastDeliveredLog = logs.find((l) => l.status === 'delivered' || l.status === 'sent');
    const lastDeliveredAt = lastDeliveredLog?.deliveredAt || lastDeliveredLog?.createdAt || null;

    const appBase = env.appBaseUrl || env.appUrl || '';
    const webhookCallbackConfigured = Boolean(appBase && /^https?:\/\//i.test(appBase));

    res.json({
      emailConfigured: health.email.ready,
      smsConfigured: health.sms.ready,
      emailProviderType: env.emailProviderType,
      emailHealth: health.email,
      smsHealth: health.sms,
      missingEmailEnv,
      missingSmsEnv,
      lastDeliveredAt,
      webhookHealth: {
        callbackBaseConfigured: webhookCallbackConfigured,
        resendSecretConfigured: Boolean(env.resendWebhookSecret),
        twilioSignatureValidationActive: Boolean(env.twilioAuthToken),
        recentEventsCount: webhookEvents.length,
        lastReceivedAt: webhookEvents[0]?.receivedAt || null,
      },
      preferences: prefs,
      contacts: contacts.map((c) => {
        let contactPrefs: Record<string, boolean> = {};
        try {
          contactPrefs = JSON.parse(c.eventPrefsJson || '{}') as Record<string, boolean>;
        } catch {
          contactPrefs = {};
        }
        const latestOtp = latestOtpByContact.get(c.id);
        const isExpired =
          c.verified === 0 &&
          Boolean(c.verificationExpiresAt) &&
          now > (c.verificationExpiresAt ?? 0);
        const isLocked = c.verified === 0 && (c.otpAttempts ?? 0) >= OTP_MAX_ATTEMPTS;
        const otpStatus =
          c.verified === 1
            ? 'verified'
            : isLocked
              ? 'locked'
              : isExpired
                ? 'expired'
                : latestOtp?.deliveryStatus === 'failed' || latestOtp?.deliveryStatus === 'not_configured'
                  ? latestOtp.deliveryStatus
                  : 'pending';
        const resendAvailableAt = (c.lastOtpSentAt || 0) + OTP_RESEND_COOLDOWN_MS;

        return {
          id: c.id,
          channel: c.channel,
          countryCode: c.countryCode || '',
          destinationMasked: maskContactDestination(c.channel === 'sms' ? 'sms' : 'email', c.destination),
          verified: c.verified === 1,
          paused: c.paused === 1,
          consentGranted: c.consentGranted === 1,
          otpStatus,
          otpAttempts: c.otpAttempts ?? 0,
          maxOtpAttempts: OTP_MAX_ATTEMPTS,
          verificationExpiresAt: c.verificationExpiresAt ?? null,
          resendAvailableAt,
          lastDeliveredAt: c.lastDeliveredAt ?? null,
          lastError: c.lastError ?? null,
          eventPrefs: {
            analysis_completed: contactPrefs.analysis_completed !== false,
            high_risk_indicator: contactPrefs.high_risk_indicator !== false,
            case_updated: contactPrefs.case_updated === true,
            ledger_verification_alert: contactPrefs.ledger_verification_alert !== false,
          },
          createdAt: c.createdAt,
        };
      }),
      logs,
      webhookEvents: webhookEvents.map((w) => ({
        id: w.id,
        provider: w.provider,
        eventType: w.eventType,
        providerMessageId: w.providerMessageId,
        status: w.status,
        payloadSummary: w.payloadSummary,
        signatureValid: w.signatureValid === 1,
        receivedAt: w.receivedAt,
      })),
    });
  }));

  // --- User Notification Preferences ---
  app.get('/api/notifications/preferences', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const prefs = await getUserNotificationPreferences(req.user!.id);
    res.json({ preferences: prefs });
  }));

  app.put('/api/notifications/preferences', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = globalPrefsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid notification preferences payload.' });
      return;
    }
    const updated = await updateUserNotificationPreferences(req.user!.id, parsed.data);
    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'NOTIFICATION_PREFS_UPDATE',
      resourceType: 'notification_preferences',
      resourceId: req.user!.id,
      details: `Updated global notification preferences`,
    });
    res.json({ ok: true, preferences: updated });
  }));

  // --- Register Contact & Dispatch Cryptographic OTP ---
  app.post('/api/notifications/contacts', requireAuth, requireCsrf, otpLimiter, asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid contact details. Check channel and destination format.' });
      return;
    }
    if (!parsed.data.consentGranted) {
      res.status(400).json({ error: 'Explicit opt-in consent is required before registering alert contacts.' });
      return;
    }

    const channel = parsed.data.channel;
    let normalizedDest = '';
    let countryCode = '';

    if (channel === 'email') {
      const emailCheck = validateEmailAddress(parsed.data.destination);
      if (!emailCheck.ok) {
        res.status(400).json({ error: emailCheck.error });
        return;
      }
      normalizedDest = emailCheck.normalized;
    } else {
      const phoneCheck = normalizeE164Phone(parsed.data.destination, parsed.data.countryCode);
      if (!phoneCheck.ok) {
        res.status(400).json({ error: phoneCheck.error });
        return;
      }
      normalizedDest = phoneCheck.e164;
      countryCode = phoneCheck.countryCode;
    }

    const now = Date.now();
    const existingRows = await db
      .select()
      .from(notificationContacts)
      .where(
        and(
          eq(notificationContacts.userId, req.user!.id),
          eq(notificationContacts.channel, channel),
          eq(notificationContacts.destination, normalizedDest),
        ),
      )
      .limit(1);

    const prefs = {
      analysis_completed: parsed.data.eventPrefs?.analysis_completed ?? true,
      high_risk_indicator: parsed.data.eventPrefs?.high_risk_indicator ?? true,
      case_updated: parsed.data.eventPrefs?.case_updated ?? false,
      ledger_verification_alert: parsed.data.eventPrefs?.ledger_verification_alert ?? true,
    };

    let contactId: string;
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      if (existing.verified === 1) {
        res.status(409).json({
          error: 'This contact is already registered and verified for your account.',
        });
        return;
      }
      const elapsed = now - (existing.lastOtpSentAt || 0);
      if (elapsed < OTP_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
        res.status(429).json({
          error: `Please wait ${waitSec}s before requesting another OTP for this contact.`,
          retryAfterSec: waitSec,
        });
        return;
      }
      contactId = existing.id;
    } else {
      contactId = crypto.randomUUID();
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = hashVerificationCode(code);
    const expiresAt = now + OTP_EXPIRY_MS;
    const masked = maskContactDestination(channel, normalizedDest);

    if (existingRows.length > 0) {
      await db
        .update(notificationContacts)
        .set({
          countryCode,
          verificationCodeHash: codeHash,
          verificationExpiresAt: expiresAt,
          lastOtpSentAt: now,
          otpAttempts: 0,
          consentGranted: 1,
          consentAt: now,
          eventPrefsJson: JSON.stringify(prefs),
          updatedAt: now,
        })
        .where(eq(notificationContacts.id, contactId));
    } else {
      await db.insert(notificationContacts).values({
        id: contactId,
        userId: req.user!.id,
        channel,
        countryCode,
        destination: normalizedDest,
        verified: 0,
        paused: 0,
        verificationCodeHash: codeHash,
        verificationExpiresAt: expiresAt,
        lastOtpSentAt: now,
        otpAttempts: 0,
        consentGranted: 1,
        consentAt: now,
        eventPrefsJson: JSON.stringify(prefs),
        createdAt: now,
        updatedAt: now,
      });
    }

    const dispatchResult = await dispatchVerificationChallenge({
      userId: req.user!.id,
      contactId,
      channel,
      destination: normalizedDest,
      code,
    });

    await db.insert(otpVerifications).values({
      id: crypto.randomUUID(),
      userId: req.user!.id,
      contactId,
      channel,
      destinationMasked: masked,
      codeHash,
      expiresAt,
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      status: dispatchResult.delivered ? 'pending' : 'failed',
      deliveryStatus: dispatchResult.status,
      providerMessageId: dispatchResult.providerMessageId,
      errorDetail: dispatchResult.delivered ? null : sanitizeText(dispatchResult.detail, 240),
      createdAt: now,
    });

    if (!dispatchResult.delivered) {
      await db
        .update(notificationContacts)
        .set({ lastError: sanitizeText(dispatchResult.detail, 240), updatedAt: Date.now() })
        .where(eq(notificationContacts.id, contactId));
    } else {
      await db
        .update(notificationContacts)
        .set({ lastError: null, updatedAt: Date.now() })
        .where(eq(notificationContacts.id, contactId));
    }

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'NOTIFICATION_CONTACT_ADD',
      resourceType: 'notification_contact',
      resourceId: contactId,
      details: `Registered ${channel} alert contact ${masked} (provider=${dispatchResult.provider}, status=${dispatchResult.status})`,
    });

    res.status(201).json({
      contactId,
      channel,
      destinationMasked: masked,
      provider: dispatchResult.provider,
      providerMessageId: dispatchResult.providerMessageId,
      deliveryStatus: dispatchResult.status,
      delivered: dispatchResult.delivered,
      detail: dispatchResult.detail,
      expiresAt,
      resendCooldownSec: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
    });
  }));

  // --- Resend OTP Challenge with Cooldown & Rate Limiting ---
  app.post(
    '/api/notifications/contacts/:id/resend-otp',
    requireAuth,
    requireCsrf,
    otpLimiter,
    asyncHandler(async (req: AuthedRequest, res) => {
      const contactId = String(req.params.id);
      const rows = await db
        .select()
        .from(notificationContacts)
        .where(and(eq(notificationContacts.id, contactId), eq(notificationContacts.userId, req.user!.id)))
        .limit(1);

      if (rows.length === 0) {
        res.status(404).json({ error: 'Contact not found.' });
        return;
      }
      const contact = rows[0];
      if (contact.verified === 1) {
        res.status(400).json({ error: 'This contact is already verified.' });
        return;
      }
      if (contact.consentGranted !== 1) {
        res.status(400).json({ error: 'Contact consent has not been granted.' });
        return;
      }

      const now = Date.now();
      const elapsed = now - (contact.lastOtpSentAt || 0);
      if (elapsed < OTP_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
        res.status(429).json({
          error: `Please wait ${waitSec}s before resending OTP.`,
          retryAfterSec: waitSec,
        });
        return;
      }

      const channel = contact.channel === 'sms' ? 'sms' : 'email';
      const masked = maskContactDestination(channel, contact.destination);
      const code = String(crypto.randomInt(100000, 1000000));
      const codeHash = hashVerificationCode(code);
      const expiresAt = now + OTP_EXPIRY_MS;

      await db
        .update(notificationContacts)
        .set({
          verificationCodeHash: codeHash,
          verificationExpiresAt: expiresAt,
          lastOtpSentAt: now,
          otpAttempts: 0,
          updatedAt: now,
        })
        .where(eq(notificationContacts.id, contactId));

      const dispatchResult = await dispatchVerificationChallenge({
        userId: req.user!.id,
        contactId,
        channel,
        destination: contact.destination,
        code,
      });

      await db.insert(otpVerifications).values({
        id: crypto.randomUUID(),
        userId: req.user!.id,
        contactId,
        channel,
        destinationMasked: masked,
        codeHash,
        expiresAt,
        attempts: 0,
        maxAttempts: OTP_MAX_ATTEMPTS,
        status: dispatchResult.delivered ? 'pending' : 'failed',
        deliveryStatus: dispatchResult.status,
        providerMessageId: dispatchResult.providerMessageId,
        errorDetail: dispatchResult.delivered ? null : sanitizeText(dispatchResult.detail, 240),
        createdAt: now,
      });

      await db
        .update(notificationContacts)
        .set({
          lastError: dispatchResult.delivered ? null : sanitizeText(dispatchResult.detail, 240),
          updatedAt: Date.now(),
        })
        .where(eq(notificationContacts.id, contactId));

      res.json({
        ok: dispatchResult.delivered,
        deliveryStatus: dispatchResult.status,
        provider: dispatchResult.provider,
        providerMessageId: dispatchResult.providerMessageId,
        detail: dispatchResult.detail,
        expiresAt,
        resendCooldownSec: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
      });
    }),
  );

  // --- Verify 6-Digit OTP with Max-Attempts Lock & Expiration Enforcement ---
  app.post(
    '/api/notifications/contacts/:id/verify',
    requireAuth,
    requireCsrf,
    otpLimiter,
    asyncHandler(async (req: AuthedRequest, res) => {
      const contactId = String(req.params.id);
      const parsed = verifyContactSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Verification code must be 6 digits.' });
        return;
      }

      const rows = await db
        .select()
        .from(notificationContacts)
        .where(and(eq(notificationContacts.id, contactId), eq(notificationContacts.userId, req.user!.id)))
        .limit(1);

      if (rows.length === 0) {
        res.status(404).json({ error: 'Contact not found.' });
        return;
      }
      const contact = rows[0];
      if (contact.verified === 1) {
        res.json({ ok: true, verified: true });
        return;
      }

      const latestOtpRows = await db
        .select()
        .from(otpVerifications)
        .where(eq(otpVerifications.contactId, contactId))
        .orderBy(desc(otpVerifications.createdAt))
        .limit(1);
      const latestOtp = latestOtpRows[0];

      const now = Date.now();
      if (!contact.verificationExpiresAt || now > contact.verificationExpiresAt) {
        if (latestOtp) {
          await db
            .update(otpVerifications)
            .set({ status: 'expired' })
            .where(eq(otpVerifications.id, latestOtp.id));
        }
        res.status(400).json({ error: 'OTP expired. Click Resend OTP to request a fresh 6-digit code.' });
        return;
      }

      const currentAttempts = contact.otpAttempts ?? 0;
      if (currentAttempts >= OTP_MAX_ATTEMPTS) {
        if (latestOtp) {
          await db
            .update(otpVerifications)
            .set({ status: 'locked' })
            .where(eq(otpVerifications.id, latestOtp.id));
        }
        res.status(429).json({
          error: `Maximum verification attempts (${OTP_MAX_ATTEMPTS}) exceeded. Click Resend OTP to generate a new code.`,
        });
        return;
      }

      if (!verifyHashedOtpCode(parsed.data.code, contact.verificationCodeHash)) {
        const nextAttempts = currentAttempts + 1;
        await db
          .update(notificationContacts)
          .set({ otpAttempts: nextAttempts, updatedAt: now })
          .where(eq(notificationContacts.id, contactId));
        if (latestOtp) {
          await db
            .update(otpVerifications)
            .set({
              attempts: nextAttempts,
              status: nextAttempts >= OTP_MAX_ATTEMPTS ? 'locked' : latestOtp.status,
            })
            .where(eq(otpVerifications.id, latestOtp.id));
        }
        const remaining = Math.max(0, OTP_MAX_ATTEMPTS - nextAttempts);
        res.status(400).json({
          error:
            remaining > 0
              ? `Incorrect verification code (${remaining} attempt${remaining === 1 ? '' : 's'} remaining).`
              : 'Incorrect code. Maximum attempts reached; click Resend OTP for a new code.',
          attemptsRemaining: remaining,
        });
        return;
      }

      await db
        .update(notificationContacts)
        .set({
          verified: 1,
          verificationCodeHash: null,
          otpAttempts: currentAttempts + 1,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(notificationContacts.id, contactId));

      if (latestOtp) {
        await db
          .update(otpVerifications)
          .set({ status: 'verified', attempts: currentAttempts + 1, verifiedAt: now })
          .where(eq(otpVerifications.id, latestOtp.id));
      }

      await recordAuditEvent({
        req,
        userId: req.user!.id,
        action: 'NOTIFICATION_CONTACT_VERIFY',
        resourceType: 'notification_contact',
        resourceId: contactId,
        details: `Verified ${contact.channel} alert contact`,
      });

      res.json({ ok: true, verified: true });
    }),
  );

  app.put('/api/notifications/contacts/:id/prefs', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const contactId = String(req.params.id);
    const parsed = contactPrefsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid event preference flags.' });
      return;
    }

    const rows = await db
      .select()
      .from(notificationContacts)
      .where(and(eq(notificationContacts.id, contactId), eq(notificationContacts.userId, req.user!.id)))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }

    await db
      .update(notificationContacts)
      .set({ eventPrefsJson: JSON.stringify(parsed.data), updatedAt: Date.now() })
      .where(eq(notificationContacts.id, contactId));

    res.json({ ok: true, eventPrefs: parsed.data });
  }));

  app.patch('/api/notifications/contacts/:id/pause', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const contactId = String(req.params.id);
    const paused = Boolean(req.body?.paused);
    const rows = await db
      .select({ id: notificationContacts.id })
      .from(notificationContacts)
      .where(and(eq(notificationContacts.id, contactId), eq(notificationContacts.userId, req.user!.id)))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }

    await db
      .update(notificationContacts)
      .set({ paused: paused ? 1 : 0, updatedAt: Date.now() })
      .where(and(eq(notificationContacts.id, contactId), eq(notificationContacts.userId, req.user!.id)));
    res.json({ ok: true, paused });
  }));

  app.delete('/api/notifications/contacts/:id', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const contactId = String(req.params.id);
    await db
      .delete(notificationContacts)
      .where(and(eq(notificationContacts.id, contactId), eq(notificationContacts.userId, req.user!.id)));
    res.json({ ok: true });
  }));

  // --- Send Test Email / Test SMS / Test Alert ---
  app.post('/api/notifications/test', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const channelRaw = typeof req.body?.channel === 'string' ? req.body.channel : 'all';
    const channelFilter: 'email' | 'sms' | 'all' =
      channelRaw === 'email' || channelRaw === 'sms' ? channelRaw : 'all';
    const contactIdFilter = typeof req.body?.contactId === 'string' ? req.body.contactId : undefined;
    const caseId = typeof req.body?.caseId === 'string' ? req.body.caseId : 'active-case';
    const caseTitle = sanitizeText(String(req.body?.caseTitle || 'TruthLens Diagnostic Check'), 100);

    const userContacts = await db
      .select()
      .from(notificationContacts)
      .where(eq(notificationContacts.userId, req.user!.id));

    const matchingContacts = userContacts.filter((c) => {
      if (contactIdFilter && c.id !== contactIdFilter) return false;
      if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
      return true;
    });

    if (matchingContacts.length === 0) {
      res.status(400).json({
        error:
          channelFilter === 'all'
            ? 'No notification contacts registered yet. Add and verify an Email or SMS contact first.'
            : `No ${channelFilter.toUpperCase()} contact registered yet. Add and verify a ${channelFilter.toUpperCase()} contact first.`,
      });
      return;
    }

    const eligible = matchingContacts.filter((c) => c.verified === 1 && c.consentGranted === 1 && c.paused === 0);
    if (eligible.length === 0) {
      res.status(400).json({
        error:
          'Target contact must be OTP-verified, consented, and unpaused before sending test notifications.',
      });
      return;
    }

    const results = await dispatchCaseAlerts({
      userId: req.user!.id,
      caseId,
      caseTitle,
      eventType: 'verification_test',
      summaryLine: `Diagnostic test alert (${channelFilter.toUpperCase()}) initiated by ${req.user!.displayName}.`,
      channelFilter,
      contactIdFilter,
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'NOTIFICATION_TEST',
      resourceType: 'notification',
      resourceId: caseId,
      details: `Dispatched ${channelFilter} test (${results.map((r) => `${r.channel}:${r.status}`).join(', ')})`,
    });

    res.json({
      ok: results.some((r) => r.status === 'sent' || r.status === 'delivered' || r.status === 'pending'),
      results,
    });
  }));

  // --- Retry Failed / Unconfigured Notification Log ---
  app.post('/api/notifications/logs/:logId/retry', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const logId = String(req.params.logId);
    const result = await retryNotificationLog(logId, req.user!.id);
    if (!result) {
      res.status(404).json({ error: 'Notification log not found.' });
      return;
    }
    res.json({
      ok: result.status === 'sent' || result.status === 'delivered' || result.status === 'pending',
      ...result,
    });
  }));

  // --- In-App Real-Time Notifications ---
  app.get('/api/notifications/in-app', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const items = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, req.user!.id))
      .orderBy(desc(inAppNotifications.createdAt))
      .limit(40);

    res.json({
      notifications: items.map((n) => ({ ...n, read: n.read === 1 })),
      unreadCount: items.filter((n) => n.read === 0).length,
    });
  }));

  app.post('/api/notifications/in-app/:id/read', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const notifId = String(req.params.id);
    await db
      .update(inAppNotifications)
      .set({ read: 1 })
      .where(and(eq(inAppNotifications.id, notifId), eq(inAppNotifications.userId, req.user!.id)));
    res.json({ ok: true });
  }));

  app.post('/api/notifications/in-app/read-all', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    await db
      .update(inAppNotifications)
      .set({ read: 1 })
      .where(eq(inAppNotifications.userId, req.user!.id));
    res.json({ ok: true });
  }));

  // --- Provider Delivery Callbacks / Webhooks (Resend & Twilio) ---
  app.post('/api/notifications/webhooks/resend', async (req, res) => {
    try {
      const rawBody =
        typeof (req as unknown as { rawBody?: string }).rawBody === 'string'
          ? (req as unknown as { rawBody: string }).rawBody
          : JSON.stringify(req.body ?? {});
      const out = await processResendWebhook({
        rawBody,
        body: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>,
        headers: req.headers,
      });
      res.status(out.statusCode).json({ ok: out.ok, detail: out.detail });
    } catch (err) {
      res.status(500).json({ ok: false, detail: err instanceof Error ? err.message : 'Webhook error' });
    }
  });

  app.post(
    '/api/notifications/webhooks/twilio',
    express.urlencoded({ extended: false }),
    async (req, res) => {
      try {
        const proto =
          typeof req.headers['x-forwarded-proto'] === 'string'
            ? req.headers['x-forwarded-proto'].split(',')[0].trim()
            : req.protocol || 'https';
        const host =
          (typeof req.headers['x-forwarded-host'] === 'string'
            ? req.headers['x-forwarded-host'].split(',')[0].trim()
            : req.headers.host) || '';
        const base = env.appBaseUrl || env.appUrl || (host ? `${proto}://${host}` : '');
        const fullUrl = `${base.replace(/\/$/, '')}/api/notifications/webhooks/twilio`;

        const out = await processTwilioWebhook({
          fullUrl,
          body: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>,
          signatureHeader: String(req.headers['x-twilio-signature'] || ''),
        });
        res.status(out.statusCode).type('text/plain').send(out.detail);
      } catch (err) {
        res.status(500).type('text/plain').send(err instanceof Error ? err.message : 'Webhook error');
      }
    },
  );
}
