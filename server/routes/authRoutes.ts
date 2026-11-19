import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { sessions, users } from '../db/schema.ts';
import { env } from '../env.ts';
import { recordAuditEvent } from '../security/audit.ts';
import {
  type AuthedRequest,
  asyncHandler,
  createUserSession,
  destroySession,
  hashPassword,
  hashToken,
  requireAuth,
  requireCsrf,
  resolveSessionUser,
  validatePasswordStrength,
  verifyPassword,
  verifySameOrigin,
} from '../security/auth.ts';
import { normalizeRole } from '../security/roles.ts';
import { sanitizeText } from '../security/sanitize.ts';
import {
  buildPublicAppUrl,
  createInAppNotification,
  sendTransactionalAccountEmail,
} from '../notifications/notifier.ts';
import { ensureCommunitySeedVotes, provisionDemoCaseForUser } from '../seed/demoSeeder.ts';

const signupSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(10).max(128),
  displayName: z.string().min(2).max(60),
  phone: z.string().max(24).optional().default(''),
  department: z.string().max(80).optional().default(''),
});

const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(128),
});

const profileUpdateSchema = z.object({
  displayName: z.string().min(2).max(60),
  phone: z.string().max(24).optional().default(''),
  department: z.string().max(80).optional().default(''),
  badgeId: z.string().max(40).optional().default(''),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().max(160),
});

const resetPasswordSchema = z.object({
  token: z.string().min(16).max(200),
  newPassword: z.string().min(10).max(128),
});

const verifyEmailSchema = z.object({
  token: z.string().min(16).max(200),
});

export function registerAuthRoutes(
  app: Express,
  authLimiter: (req: Request, res: Response, next: () => void) => void,
) {
  app.get('/api/auth/me', asyncHandler(async (req, res) => {
    const resolved = await resolveSessionUser(req);
    if (!resolved) {
      res.json({ authenticated: false, user: null, csrfToken: null });
      return;
    }
    res.json({
      authenticated: true,
      user: resolved.user,
      csrfToken: resolved.csrfToken,
    });
  }));

  app.post('/api/auth/signup', authLimiter, asyncHandler(async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Cross-origin request blocked.' });
      return;
    }
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid signup fields. Password must be at least 10 characters with mixed character classes.' });
      return;
    }
    const pwCheck = validatePasswordStrength(parsed.data.password);
    if (!pwCheck.ok) {
      res.status(400).json({ error: pwCheck.reason });
      return;
    }

    const email = parsed.data.email.toLowerCase().trim();
    const displayName = sanitizeText(parsed.data.displayName, 60);
    const phone = sanitizeText(parsed.data.phone, 24);
    const department = sanitizeText(parsed.data.department, 80);

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    // Never auto-promote arbitrary first signup to super_admin; only match server-configured ADMIN_EMAIL
    const assignedRole =
      env.adminEmail && email === env.adminEmail ? 'super_admin' : 'investigator';

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(parsed.data.password);
    const rawVerifyToken = crypto.randomBytes(24).toString('base64url');
    const verifyHash = hashToken(rawVerifyToken);
    const now = Date.now();

    await db.insert(users).values({
      id: userId,
      email,
      displayName,
      passwordHash,
      role: assignedRole,
      phone,
      department,
      badgeId: `TL-${userId.slice(0, 6).toUpperCase()}`,
      emailVerified: 0,
      emailVerifyTokenHash: verifyHash,
      emailVerifyExpiresAt: now + 24 * 60 * 60 * 1000,
      active: 1,
      lastLoginAt: now,
      isDemoUser: 0,
      createdAt: now,
    });

    await provisionDemoCaseForUser(userId);
    await ensureCommunitySeedVotes(userId);

    const { csrfToken, sessionToken } = await createUserSession(res, req, userId);
    await recordAuditEvent({
      req,
      userId,
      action: 'AUTH_SIGNUP',
      resourceType: 'user',
      resourceId: userId,
      details: `Investigator account registered (role=${assignedRole})`,
    });

    const verifyUrl = buildPublicAppUrl(`?verify_email=${encodeURIComponent(rawVerifyToken)}`);
    const emailDelivery = await sendTransactionalAccountEmail({
      userId,
      toEmail: email,
      eventType: 'account_registration',
      subject: 'Welcome to TruthLens — Confirm Your Email Address',
      text: `Hello ${displayName},\n\nYour TruthLens account (${assignedRole}) has been registered.\n\nConfirm your email using this verification link:\n${verifyUrl}\n\nOr paste this verification token inside Profile & Security:\n${rawVerifyToken}\n\nThis token expires in 24 hours.`,
    });

    res.status(201).json({
      user: {
        id: userId,
        email,
        displayName,
        role: assignedRole,
        phone,
        department,
        badgeId: `TL-${userId.slice(0, 6).toUpperCase()}`,
        emailVerified: false,
        isDemoUser: false,
      },
      csrfToken,
      sessionToken,
      verificationEmailStatus: emailDelivery.status,
      verificationEmailDetail: emailDelivery.detail,
    });
  }));

  app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Cross-origin request blocked.' });
      return;
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid email or password format.' });
      return;
    }

    const email = parsed.data.email.toLowerCase().trim();
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (rows.length === 0) {
      await recordAuditEvent({
        req,
        userId: null,
        action: 'AUTH_LOGIN_FAILED',
        resourceType: 'user',
        details: 'Failed login attempt (unknown email)',
      });
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const user = rows[0];
    if (user.active === 0) {
      res.status(403).json({ error: 'This account has been suspended by an administrator.' });
      return;
    }

    const now = Date.now();
    if (user.lockedUntil && user.lockedUntil > now) {
      const minsLeft = Math.max(1, Math.ceil((user.lockedUntil - now) / 60_000));
      res.status(429).json({
        error: `Account temporarily locked after repeated failed sign-ins. Try again in ${minsLeft} minute(s).`,
      });
      return;
    }

    const valid = await verifyPassword(user.passwordHash, parsed.data.password);
    if (!valid) {
      const nextAttempts = (user.failedLoginAttempts || 0) + 1;
      const shouldLock = nextAttempts >= 5;
      const lockUntil = shouldLock ? now + 15 * 60 * 1000 : null;
      await db
        .update(users)
        .set({
          failedLoginAttempts: shouldLock ? 0 : nextAttempts,
          lockedUntil: lockUntil,
        })
        .where(eq(users.id, user.id));

      await recordAuditEvent({
        req,
        userId: user.id,
        action: shouldLock ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED',
        resourceType: 'user',
        resourceId: user.id,
        details: shouldLock
          ? 'Account locked for 15 minutes after 5 consecutive failed logins'
          : `Failed login attempt (${nextAttempts}/5 before lockout)`,
      });
      await createInAppNotification({
        userId: user.id,
        type: 'security_alert',
        title: shouldLock ? 'Account Temporarily Locked' : 'Failed Login Attempt Detected',
        body: shouldLock
          ? '5 failed sign-in attempts triggered a 15-minute security lock on your TruthLens account.'
          : 'Someone entered an incorrect password for your TruthLens account.',
      }).catch(() => {});
      res.status(shouldLock ? 429 : 401).json({
        error: shouldLock
          ? 'Too many failed attempts. Account locked for 15 minutes.'
          : 'Invalid credentials.',
      });
      return;
    }

    await db
      .update(users)
      .set({ lastLoginAt: now, failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, user.id));

    const { csrfToken, sessionToken } = await createUserSession(res, req, user.id);
    await recordAuditEvent({
      req,
      userId: user.id,
      action: 'AUTH_LOGIN',
      resourceType: 'user',
      resourceId: user.id,
      details: `Session authenticated (role=${normalizeRole(user.role)})`,
    });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: normalizeRole(user.role),
        phone: user.phone || '',
        department: user.department || '',
        badgeId: user.badgeId || '',
        emailVerified: user.emailVerified === 1,
        isDemoUser: user.isDemoUser === 1,
      },
      csrfToken,
      sessionToken,
    });
  }));

  app.post('/api/auth/demo', authLimiter, asyncHandler(async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Cross-origin request blocked.' });
      return;
    }
    const userId = crypto.randomUUID();
    const randomPassword = crypto.randomBytes(24).toString('hex');
    const passwordHash = await hashPassword(randomPassword);
    const shortTag = userId.slice(0, 6);
    const email = `demo-${shortTag}@truthlens.local`;
    const displayName = `Investigator ${shortTag.toUpperCase()}`;
    const now = Date.now();

    await db.insert(users).values({
      id: userId,
      email,
      displayName,
      passwordHash,
      role: 'investigator',
      badgeId: `DEMO-${shortTag.toUpperCase()}`,
      department: 'Sandbox Forensics Unit',
      emailVerified: 1,
      active: 1,
      lastLoginAt: now,
      isDemoUser: 1,
      createdAt: now,
    });

    await provisionDemoCaseForUser(userId);
    await ensureCommunitySeedVotes(userId);

    const { csrfToken, sessionToken } = await createUserSession(res, req, userId);
    await recordAuditEvent({
      req,
      userId,
      action: 'AUTH_DEMO',
      resourceType: 'user',
      resourceId: userId,
      details: 'Isolated demo investigator sandbox created',
    });
    res.status(201).json({
      user: {
        id: userId,
        email,
        displayName,
        role: 'investigator',
        phone: '',
        department: 'Sandbox Forensics Unit',
        badgeId: `DEMO-${shortTag.toUpperCase()}`,
        emailVerified: true,
        isDemoUser: true,
      },
      csrfToken,
      sessionToken,
    });
  }));

  app.post('/api/auth/logout', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    await recordAuditEvent({
      req,
      userId: req.user?.id ?? null,
      action: 'AUTH_LOGOUT',
      resourceType: 'session',
      details: 'Session terminated by user',
    });
    await destroySession(req, res);
    res.json({ ok: true });
  }));

  // --- Profile & Account Security ---
  app.get('/api/auth/profile', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  app.patch('/api/auth/profile', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid profile details.' });
      return;
    }

    const displayName = sanitizeText(parsed.data.displayName, 60);
    const phone = sanitizeText(parsed.data.phone, 24);
    const department = sanitizeText(parsed.data.department, 80);
    const badgeId = sanitizeText(parsed.data.badgeId, 40);

    await db
      .update(users)
      .set({ displayName, phone, department, badgeId })
      .where(eq(users.id, req.user!.id));

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'PROFILE_UPDATE',
      resourceType: 'user',
      resourceId: req.user!.id,
      details: `Updated investigator profile details`,
    });

    res.json({
      user: {
        ...req.user!,
        displayName,
        phone,
        department,
        badgeId,
      },
    });
  }));

  app.post('/api/auth/change-password', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'New password must be at least 10 characters with mixed character classes.' });
      return;
    }
    const pwCheck = validatePasswordStrength(parsed.data.newPassword);
    if (!pwCheck.ok) {
      res.status(400).json({ error: pwCheck.reason });
      return;
    }
    const rows = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const ok = await verifyPassword(rows[0].passwordHash, parsed.data.currentPassword);
    if (!ok) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const newHash = await hashPassword(parsed.data.newPassword);
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, req.user!.id));
    // Revoke all other sessions when password changes
    if (req.sessionId) {
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, req.user!.id), ne(sessions.id, req.sessionId)));
    }

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'PASSWORD_CHANGE',
      resourceType: 'user',
      resourceId: req.user!.id,
      details: 'Account password changed by authenticated user (other sessions revoked)',
    });

    await sendTransactionalAccountEmail({
      userId: req.user!.id,
      toEmail: req.user!.email,
      eventType: 'security_alert',
      subject: 'TruthLens Security Alert — Password Changed',
      text: `Your TruthLens account password was changed on ${new Date().toISOString()}. All other active sessions were revoked.`,
    });

    res.json({ ok: true });
  }));

  // --- Email Verification ---
  app.post('/api/auth/resend-verification', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    if (req.user!.emailVerified) {
      res.json({ ok: true, alreadyVerified: true, detail: 'Email is already verified.' });
      return;
    }
    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    await db
      .update(users)
      .set({ emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: expiresAt })
      .where(eq(users.id, req.user!.id));

    const verifyUrl = buildPublicAppUrl(`?verify_email=${encodeURIComponent(rawToken)}`);
    const delivery = await sendTransactionalAccountEmail({
      userId: req.user!.id,
      toEmail: req.user!.email,
      eventType: 'email_verification',
      subject: 'TruthLens — Verify Your Email Address',
      text: `Confirm your TruthLens email address by opening:\n${verifyUrl}\n\nOr paste this verification token in Profile & Security:\n${rawToken}`,
    });

    res.json({
      ok: delivery.delivered,
      status: delivery.status,
      detail: delivery.detail,
    });
  }));

  app.post('/api/auth/verify-email', asyncHandler(async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Cross-origin request blocked.' });
      return;
    }
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid verification token format.' });
      return;
    }
    const tokenHash = hashToken(parsed.data.token.trim());
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.emailVerifyTokenHash, tokenHash), gt(users.emailVerifyExpiresAt, Date.now())))
      .limit(1);

    if (rows.length === 0) {
      res.status(400).json({ error: 'Verification token is invalid or expired.' });
      return;
    }

    await db
      .update(users)
      .set({ emailVerified: 1, emailVerifyTokenHash: null, emailVerifyExpiresAt: null })
      .where(eq(users.id, rows[0].id));

    await recordAuditEvent({
      req,
      userId: rows[0].id,
      action: 'EMAIL_VERIFIED',
      resourceType: 'user',
      resourceId: rows[0].id,
      details: 'User email verified via signed token',
    });

    res.json({ ok: true, emailVerified: true });
  }));

  // --- Forgot & Reset Password ---
  app.post('/api/auth/forgot-password', authLimiter, asyncHandler(async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Cross-origin request blocked.' });
      return;
    }
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const email = parsed.data.email.toLowerCase().trim();
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (rows.length === 0) {
      // Do not enumerate accounts; return honest generic response
      res.json({
        ok: true,
        emailConfigured: env.emailProviderConfigured,
        message: env.emailProviderConfigured
          ? 'If that email exists in TruthLens, a password reset link has been dispatched.'
          : 'Email provider is not configured on the server; password reset emails require RESEND_API_KEY or SMTP settings.',
      });
      return;
    }

    const user = rows[0];
    const rawToken = crypto.randomBytes(24).toString('base64url');
    const resetHash = hashToken(rawToken);
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

    await db
      .update(users)
      .set({ resetTokenHash: resetHash, resetExpiresAt: expiresAt })
      .where(eq(users.id, user.id));

    const resetUrl = buildPublicAppUrl(`?reset_token=${encodeURIComponent(rawToken)}`);
    const delivery = await sendTransactionalAccountEmail({
      userId: user.id,
      toEmail: user.email,
      eventType: 'password_reset',
      subject: 'TruthLens — Password Reset Request',
      text: `A password reset was requested for your TruthLens account.\n\nReset Link:\n${resetUrl}\n\nReset Token:\n${rawToken}\n\nThis token expires in 60 minutes. If you did not request this, ignore this email.`,
    });

    await recordAuditEvent({
      req,
      userId: user.id,
      action: 'PASSWORD_RESET_REQUEST',
      resourceType: 'user',
      resourceId: user.id,
      details: `Password reset requested (email_status=${delivery.status})`,
    });

    res.json({
      ok: delivery.delivered,
      emailConfigured: env.emailProviderConfigured,
      deliveryStatus: delivery.status,
      message: delivery.delivered
        ? 'Password reset instructions have been sent to your email address.'
        : delivery.detail,
    });
  }));

  app.post('/api/auth/reset-password', authLimiter, asyncHandler(async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Cross-origin request blocked.' });
      return;
    }
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid reset token and strong password (min 10 chars) required.' });
      return;
    }
    const pwCheck = validatePasswordStrength(parsed.data.newPassword);
    if (!pwCheck.ok) {
      res.status(400).json({ error: pwCheck.reason });
      return;
    }

    const tokenHash = hashToken(parsed.data.token.trim());
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.resetTokenHash, tokenHash), gt(users.resetExpiresAt, Date.now())))
      .limit(1);

    if (rows.length === 0) {
      res.status(400).json({ error: 'Password reset token is invalid or expired.' });
      return;
    }

    const newHash = await hashPassword(parsed.data.newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, resetTokenHash: null, resetExpiresAt: null })
      .where(eq(users.id, rows[0].id));

    // Invalidate all prior sessions on password reset
    await db.delete(sessions).where(eq(sessions.userId, rows[0].id));

    await recordAuditEvent({
      req,
      userId: rows[0].id,
      action: 'PASSWORD_RESET_COMPLETE',
      resourceType: 'user',
      resourceId: rows[0].id,
      details: 'Password reset completed and prior sessions revoked',
    });

    res.json({ ok: true, message: 'Password updated. You may now sign in with your new password.' });
  }));

  // --- Active Session Management ---
  app.get('/api/auth/sessions', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const list = await db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        ipHash: sessions.ipHash,
        lastActiveAt: sessions.lastActiveAt,
        expiresAt: sessions.expiresAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, req.user!.id), gt(sessions.expiresAt, Date.now())))
      .orderBy(desc(sessions.lastActiveAt));

    res.json({
      sessions: list.map((s) => ({
        ...s,
        isCurrent: s.id === req.sessionId,
      })),
    });
  }));

  app.delete('/api/auth/sessions/:sessionId', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const targetId = String(req.params.sessionId);
    await db
      .delete(sessions)
      .where(and(eq(sessions.id, targetId), eq(sessions.userId, req.user!.id)));

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'SESSION_REVOKED',
      resourceType: 'session',
      resourceId: targetId,
      details: 'User revoked an active session',
    });

    res.json({ ok: true, revokedCurrent: targetId === req.sessionId });
  }));
}
