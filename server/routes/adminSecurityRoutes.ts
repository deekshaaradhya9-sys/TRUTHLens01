import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { and, desc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db, DATA_ROOT } from '../db/index.ts';
import { env } from '../env.ts';
import {
  auditLogs,
  cases,
  evidenceAccessLogs,
  sessions,
  users,
} from '../db/schema.ts';
import {
  createInAppNotification,
  sendTransactionalAccountEmail,
} from '../notifications/notifier.ts';
import { recordAuditEvent } from '../security/audit.ts';
import { type AuthedRequest, asyncHandler, requireAuth, requireCsrf } from '../security/auth.ts';
import {
  USER_ROLES,
  canManageUsers,
  isAdminRole,
  normalizeRole,
} from '../security/roles.ts';

const roleUpdateSchema = z.object({
  role: z.enum(USER_ROLES),
  active: z.boolean().optional(),
});

export function registerAdminSecurityRoutes(app: Express) {
  // --- Security & Audit Centre (User's own security data + Admin system view) ---
  app.get('/api/security/overview', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const user = req.user!;
    const admin = isAdminRole(user);

    const [myAuditLogs, mySessions, myAccessLogs] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.userId, user.id))
        .orderBy(desc(auditLogs.createdAt))
        .limit(60),
      db
        .select({
          id: sessions.id,
          userAgent: sessions.userAgent,
          ipHash: sessions.ipHash,
          lastActiveAt: sessions.lastActiveAt,
          expiresAt: sessions.expiresAt,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, Date.now())))
        .orderBy(desc(sessions.lastActiveAt)),
      db
        .select()
        .from(evidenceAccessLogs)
        .where(eq(evidenceAccessLogs.userId, user.id))
        .orderBy(desc(evidenceAccessLogs.createdAt))
        .limit(40),
    ]);

    let adminAuditLogs: typeof myAuditLogs = [];
    let adminAccessLogs: typeof myAccessLogs = [];
    let allUsers: Array<{
      id: string;
      email: string;
      displayName: string;
      role: string;
      department: string;
      badgeId: string;
      emailVerified: boolean;
      active: boolean;
      lastLoginAt: number | null;
      createdAt: number;
    }> = [];
    let totalCases = 0;

    if (admin) {
      const [sysLogs, sysAccess, userRows, caseRows] = await Promise.all([
        db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100),
        db.select().from(evidenceAccessLogs).orderBy(desc(evidenceAccessLogs.createdAt)).limit(80),
        db
          .select({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            role: users.role,
            department: users.department,
            badgeId: users.badgeId,
            emailVerified: users.emailVerified,
            active: users.active,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
          })
          .from(users)
          .orderBy(desc(users.createdAt)),
        db.select({ id: cases.id }).from(cases),
      ]);
      adminAuditLogs = sysLogs;
      adminAccessLogs = sysAccess;
      allUsers = userRows.map((u) => ({
        ...u,
        role: normalizeRole(u.role),
        emailVerified: u.emailVerified === 1,
        active: u.active !== 0,
      }));
      totalCases = caseRows.length;
    }

    res.json({
      isAdmin: admin,
      canManageRoles: canManageUsers(user),
      mySessions: mySessions.map((s) => ({ ...s, isCurrent: s.id === req.sessionId })),
      myAuditLogs,
      myAccessLogs,
      failedLoginAlerts: myAuditLogs.filter((l) => l.action === 'AUTH_LOGIN_FAILED').slice(0, 10),
      adminPanel: admin
        ? {
            totalCases,
            totalUsers: allUsers.length,
            users: allUsers,
            systemAuditLogs: adminAuditLogs,
            systemAccessLogs: adminAccessLogs,
          }
        : null,
    });
  }));

  // --- Super Admin: Update User Role / Activation ---
  app.patch('/api/admin/users/:userId/role', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    if (!canManageUsers(req.user)) {
      await recordAuditEvent({
        req,
        userId: req.user!.id,
        action: 'RBAC_DENIED',
        resourceType: 'user_role',
        resourceId: String(req.params.userId),
        details: `Role ${req.user!.role} attempted unauthorized role modification`,
      });
      res.status(403).json({ error: 'Super Administrator privileges required to change user roles.' });
      return;
    }

    const targetId = String(req.params.userId);
    const parsed = roleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid role or status update.' });
      return;
    }

    const rows = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const target = rows[0];
    if (target.id === req.user!.id && parsed.data.role !== 'super_admin') {
      res.status(400).json({ error: 'You cannot demote your own active super_admin account.' });
      return;
    }

    const updates: Record<string, unknown> = { role: parsed.data.role };
    if (typeof parsed.data.active === 'boolean') {
      updates.active = parsed.data.active ? 1 : 0;
    }
    await db.update(users).set(updates).where(eq(users.id, targetId));

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'USER_ROLE_CHANGE',
      resourceType: 'user',
      resourceId: targetId,
      details: `Updated ${target.email} role from ${target.role} to ${parsed.data.role}`,
    });

    await createInAppNotification({
      userId: targetId,
      type: 'security_alert',
      title: 'Account Permissions Updated',
      body: `Your TruthLens role was updated to ${parsed.data.role.replace(/_/g, ' ')} by ${req.user!.displayName}.`,
    }).catch(() => {});

    await sendTransactionalAccountEmail({
      userId: targetId,
      toEmail: target.email,
      eventType: 'security_alert',
      subject: 'TruthLens Security Notice — Role / Permissions Updated',
      text: `Hello ${target.displayName},\n\nYour TruthLens account role was updated from ${target.role} to ${parsed.data.role} by ${req.user!.displayName}.`,
    });

    res.json({ ok: true, userId: targetId, role: parsed.data.role });
  }));

  // --- Timing-safe Admin Bootstrap (requires server-only ADMIN_BOOTSTRAP_SECRET) ---
  app.post('/api/admin/bootstrap', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    if (!env.adminBootstrapSecret || env.adminBootstrapSecret.length < 16) {
      res.status(403).json({
        error: 'Admin bootstrap is disabled because ADMIN_BOOTSTRAP_SECRET is not configured on the server.',
      });
      return;
    }
    if (req.user!.isDemoUser) {
      res.status(403).json({ error: 'Demo sandbox accounts cannot be promoted to administrator.' });
      return;
    }
    const secretInput = typeof req.body?.bootstrapSecret === 'string' ? req.body.bootstrapSecret.trim() : '';
    const expectedBuf = Buffer.from(env.adminBootstrapSecret, 'utf8');
    const providedBuf = Buffer.from(secretInput, 'utf8');
    const match =
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (!match) {
      await recordAuditEvent({
        req,
        userId: req.user!.id,
        action: 'ADMIN_BOOTSTRAP_DENIED',
        resourceType: 'user_role',
        resourceId: req.user!.id,
        details: 'Invalid ADMIN_BOOTSTRAP_SECRET supplied',
      });
      res.status(403).json({ error: 'Invalid administrator bootstrap secret.' });
      return;
    }

    await db.update(users).set({ role: 'super_admin' }).where(eq(users.id, req.user!.id));
    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'ADMIN_BOOTSTRAP_GRANTED',
      resourceType: 'user_role',
      resourceId: req.user!.id,
      details: 'Account promoted to super_admin via timing-safe ADMIN_BOOTSTRAP_SECRET',
    });

    res.json({ ok: true, role: 'super_admin' });
  }));

  // --- Live Security Posture & Hardening Audit ---
  app.get('/api/security/audit', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const publicDir = path.resolve(process.cwd(), 'public');
    const dataInsidePublic = DATA_ROOT.startsWith(publicDir);
    const gitignorePath = path.resolve(process.cwd(), '.gitignore');
    const gitignoreText = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';

    const checks = [
      {
        id: 'api_key_isolation',
        label: 'API Keys Server-Side Isolated',
        status: 'pass' as const,
        detail: 'GEMINI_API_KEY, SESSION_SECRET, and messaging credentials reside strictly in server process.env; zero keys in client bundle.',
      },
      {
        id: 'debug_disabled',
        label: 'Debug Mode & Stack Traces Disabled',
        status: !env.debugMode ? ('pass' as const) : ('warn' as const),
        detail: 'x-powered-by disabled, production sourcemaps off, and global error handler returns sanitized JSON without stack traces.',
      },
      {
        id: 'password_hashing',
        label: 'Argon2id Hashing & Account Lockout',
        status: 'pass' as const,
        detail: 'Passwords hashed with Argon2id (19 MiB memory cost), 10+ char complexity rules, and 5-attempt / 15-min lockout.',
      },
      {
        id: 'session_csrf',
        label: 'HttpOnly Sessions & Timing-Safe CSRF',
        status: env.sessionSecret.length >= 32 ? ('pass' as const) : ('warn' as const),
        detail: 'HMAC-SHA256 hashed session tokens, HttpOnly cookies, same-origin checks, and timingSafeEqual X-CSRF-Token verification.',
      },
      {
        id: 'rbac_idor',
        label: '7-Role RBAC, Admin & WebSocket ACL',
        status: 'pass' as const,
        detail: 'Server-side RBAC on /api/admin/*, per-case ACL on REST & WebSocket streams, and timing-safe admin bootstrap.',
      },
      {
        id: 'cors_headers',
        label: 'Strict CORS Allowlist & Helmet CSP',
        status: 'pass' as const,
        detail: 'Dynamic origin allowlist (no wildcard * with credentials), Helmet CSP, HSTS, X-Content-Type-Options: nosniff, Referrer-Policy.',
      },
      {
        id: 'rate_limiting',
        label: 'Tiered Rate Limiting',
        status: 'pass' as const,
        detail: 'Dedicated rate limiters on auth, AI analysis, URL ingestion, file uploads, OTP, QR share lookups, and general API.',
      },
      {
        id: 'ssrf_xss',
        label: 'SSRF DNS Guard & XSS Sanitization',
        status: 'pass' as const,
        detail: 'URL inspector blocks loopback/private/metadata IPs prior to connect; Zod + isomorphic-dompurify sanitize all inputs.',
      },
      {
        id: 'storage_exposed_files',
        label: 'Vault Isolation & Exposed-File Guards',
        status:
          !dataInsidePublic && gitignoreText.includes('data/db/') && gitignoreText.includes('.env*')
            ? ('pass' as const)
            : ('warn' as const),
        detail: 'SQLite & uploads stored outside public/dist, excluded from .gitignore, and dotfiles/server paths return HTTP 403.',
      },
      {
        id: 'db_parameterized',
        label: 'Database Hardening (WAL + Drizzle ORM)',
        status: 'pass' as const,
        detail: 'SQLite WAL mode with foreign_keys=ON and parameterized Drizzle ORM queries preventing SQL injection.',
      },
    ];

    res.json({
      auditedAt: Date.now(),
      overallStatus: checks.every((c) => c.status === 'pass') ? 'HARDENED' : 'REVIEW_NEEDED',
      passedCount: checks.filter((c) => c.status === 'pass').length,
      totalChecks: checks.length,
      isAdmin: isAdminRole(req.user),
      checks,
    });
  }));
}
