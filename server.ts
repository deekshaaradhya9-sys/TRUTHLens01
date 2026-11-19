import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { WebSocketServer, WebSocket } from 'ws';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { createServer as createViteServer } from 'vite';

import { env } from './server/env.ts';
import { db, ELA_DIR, UPLOADS_DIR } from './server/db/index.ts';
import {
  agentMessages,
  caseCollaborators,
  cases,
  caseShareTokens,
  communityVotes,
  evidenceAccessLogs,
  evidenceItems,
  evidenceVersions,
  findings,
  graphEdges,
  graphNodes,
  userPreferences,
  users,
  witnesses,
} from './server/db/schema.ts';
import {
  type AuthUser,
  type AuthedRequest,
  asyncHandler,
  hashIp,
  isTrustedOrigin,
  requireAuth,
  requireCsrf,
  resolveSessionUser,
} from './server/security/auth.ts';
import {
  CASE_PRIORITIES,
  CASE_STATUSES,
  canApproveReview,
  canCreateCase,
  canDeleteCase,
  canRunAnalysis,
  canShareQr,
  canUploadEvidence,
  getUserCaseAccess,
  isAdminRole,
} from './server/security/roles.ts';
import { recordAuditEvent } from './server/security/audit.ts';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_UPLOAD_TYPES,
  normalizeMimeType,
  sanitizeFilename,
  sanitizeText,
  verifyMagicBytes,
} from './server/security/sanitize.ts';
import { analyzeImageBuffer } from './server/forensics/imageAnalyzer.ts';
import { analyzeAudioBuffer } from './server/forensics/audioAnalyzer.ts';
import { analyzeDocumentBuffer } from './server/forensics/documentAnalyzer.ts';
import { analyzeVideoBuffer } from './server/forensics/videoAnalyzer.ts';
import {
  runDeterministicCrossModalEngine,
  type CrossModalCorrelationItem,
  type ManipulationIndicatorItem,
} from './server/forensics/crossModalCorrelator.ts';
import { appendCustodyEntry, computeSha256, verifyCaseLedger } from './server/forensics/ledger.ts';
import { loadFullCaseAuthorized, recordCaseActivity } from './server/forensics/caseLoader.ts';
import {
  analyzeCaseWithGemini,
  buildDeterministicAgentBriefing,
  runForensicAgentChat,
  verifyClaimsWithWebGrounding,
  type StoredReportContext,
} from './server/forensics/geminiForensics.ts';
import { inspectAndIngestPublicUrl } from './server/forensics/urlAnalyzer.ts';
import { findCrossCaseProvenanceMatches } from './server/forensics/provenanceRadar.ts';
import {
  PUBLIC_BENCHMARK_TOPIC,
  ensureCommunitySeedVotes,
} from './server/seed/demoSeeder.ts';
import { ensureDefaultCaseCategories } from './server/seed/categoriesSeeder.ts';
import {
  buildPublicAppUrl,
  dispatchCaseAlerts,
  dispatchCaseNotificationToParticipants,
  registerInAppNotifier,
  sendTransactionalAccountEmail,
} from './server/notifications/notifier.ts';
import { registerAuthRoutes } from './server/routes/authRoutes.ts';
import { registerCaseManagementRoutes } from './server/routes/caseManagementRoutes.ts';
import { registerVaultCustodyRoutes } from './server/routes/vaultCustodyRoutes.ts';
import { registerAdminSecurityRoutes } from './server/routes/adminSecurityRoutes.ts';
import { registerNotificationRoutes } from './server/routes/notificationRoutes.ts';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Block dotfiles and sensitive internal files immediately (allow Vite's internal .vite deps only in dev)
app.use((req, res, next) => {
  const reqPath = req.path || '/';
  const segments = reqPath.split('/').filter(Boolean);
  const first = (segments[0] || '').toLowerCase();
  const isDevViteAsset = !env.isProd && reqPath.startsWith('/node_modules/.vite/');
  const blockedTopDirs = new Set(
    env.isProd ? ['data', 'server', 'src', 'node_modules'] : ['data', 'server'],
  );
  const blockedExact = new Set([
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'metadata.json',
    'vite.config.ts',
    'server.ts',
  ]);
  const lowerPath = reqPath.toLowerCase();
  if (
    (!isDevViteAsset && segments.some((seg) => seg.startsWith('.'))) ||
    segments.some((seg) => seg === '..') ||
    blockedTopDirs.has(first) ||
    blockedExact.has(first) ||
    lowerPath.endsWith('.sqlite') ||
    lowerPath.endsWith('.sqlite-wal') ||
    lowerPath.endsWith('.sqlite-shm') ||
    lowerPath.endsWith('.db')
  ) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }
  next();
});

// Strict origin-checked CORS (never wildcard * with credentials)
app.use(
  cors((req, cb) => {
    const origin = req.headers.origin;
    const forwardedHost =
      typeof req.headers['x-forwarded-host'] === 'string'
        ? req.headers['x-forwarded-host'].split(',')[0].trim()
        : '';
    const host = forwardedHost || req.headers.host || '';
    const allowed = isTrustedOrigin(origin, host);
    cb(null, {
      origin: allowed,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    });
  }),
);

// Strict security headers & CSP (permits embedding only in Google AI Studio preview iframe)
const allowedFrameAncestors = [
  "'self'",
  'https://aistudio.google.com',
  'https://*.googleusercontent.com',
  'https://*.usercontent.goog',
];

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: env.isProd ? ["'self'", "'wasm-unsafe-eval'"] : ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: allowedFrameAncestors,
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    xFrameOptions: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }),
);

app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(cookieParser());
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  }),
);

// Rate limiters (per-IP & per-user)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait before trying again.' },
});

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => {
    const authed = req as AuthedRequest;
    return authed.user?.id ? `user:${authed.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload rate limit exceeded. Try again shortly.' },
});

const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  keyGenerator: (req) => {
    const authed = req as AuthedRequest;
    return authed.user?.id ? `user:${authed.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI analysis rate limit exceeded. Try again shortly.' },
});

const urlIngestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => {
    const authed = req as AuthedRequest;
    return authed.user?.id ? `url:${authed.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'URL inspection rate limit exceeded. Try again shortly.' },
});

const shareLookupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 45,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many shared link lookups. Please try again later.' },
});

const generalApiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded. Please slow down requests.' },
});

app.use('/api', generalApiLimiter);

// Multer memory storage with configurable upload limit and Chromebook-friendly generic MIME fallback
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.maxUploadBytes,
    files: 1,
    fieldSize: 6 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const normMime = normalizeMimeType(file.mimetype);
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isGenericMime = normMime === '' || normMime === 'application/octet-stream';
    if (normMime in ALLOWED_UPLOAD_TYPES || (isGenericMime && ALLOWED_EXTENSIONS.has(ext))) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file format (${normMime || ext || 'unknown'}). Allowed: JPEG, PNG, WebP, WAV, MP3, M4A, OGG, MP4, WebM, PDF, TXT.`,
        ),
      );
    }
  },
});

// Zod schemas
const createCaseSchema = z.object({
  caseNumber: z.string().max(40).optional(),
  title: z.string().min(3).max(140),
  description: z.string().max(600).optional().default(''),
  captionText: z.string().max(3000).optional().default(''),
  category: z.string().min(2).max(60).optional().default('digital_fraud'),
  priority: z.enum(CASE_PRIORITIES).optional().default('medium'),
  status: z.enum(CASE_STATUSES).optional().default('registered'),
  incidentLocation: z.string().max(240).optional().default(''),
  incidentDate: z.string().max(40).optional().default(''),
  relatedPersons: z
    .array(z.object({ name: z.string().max(80), role: z.string().max(60) }))
    .max(25)
    .optional()
    .default([]),
  categoryFields: z.record(z.string().max(60), z.string().max(500)).optional().default({}),
  notes: z.string().max(3000).optional().default(''),
});

const updateCaptionSchema = z.object({
  captionText: z.string().max(3000),
});

const videoFrameSchema = z.object({
  timestampSec: z.number().min(0).max(36000),
  deltaScore: z.number().min(0).max(100),
  suspicious: z.boolean(),
  thumbnailDataUrl: z
    .string()
    .max(220000)
    .refine((v) => v.startsWith('data:image/jpeg;base64,'), 'Must be JPEG data URL'),
});

const videoMetaSchema = z.object({
  durationSec: z.number().min(0).max(36000).nullable().optional(),
  width: z.number().int().min(0).max(16000).nullable().optional(),
  height: z.number().int().min(0).max(16000).nullable().optional(),
  hasAudioTrack: z.boolean().nullable().optional(),
  audioSyncNote: z.string().max(300).nullable().optional(),
});

const agentChatSchema = z.object({
  question: z.string().min(1).max(1000),
  language: z.enum(['en', 'hi', 'kn', 'ta', 'te', 'ml']).default('en'),
  devilsAdvocate: z.boolean().default(false),
});

const preferencesSchema = z.object({
  language: z.enum(['en', 'hi', 'kn', 'ta', 'te', 'ml']).default('en'),
  textSize: z.enum(['sm', 'md', 'lg']).default('md'),
  narrationEnabled: z.boolean().default(true),
  highContrast: z.boolean().default(false),
});

const shareTokenSchema = z.object({
  label: z.string().min(2).max(80).optional().default('Investigator QR Access'),
  expiresHours: z.number().int().min(1).max(720).optional().default(24),
  permissions: z
    .object({
      summary: z.boolean().optional().default(true),
      findings: z.boolean().optional().default(true),
      evidenceInventory: z.boolean().optional().default(true),
      custodyDigest: z.boolean().optional().default(true),
      timeline: z.boolean().optional().default(false),
    })
    .optional(),
});

const communityVoteSchema = z.object({
  topicKey: z.string().min(2).max(80).default(PUBLIC_BENCHMARK_TOPIC),
  stance: z.enum(['plausible_artifact', 'needs_corroboration', 'likely_benign']),
  rationale: z.string().min(3).max(400),
});

const humanReviewSchema = z.object({
  status: z.enum(['pending', 'verified_corroborated', 'verified_inconclusive', 'escalated']),
  reviewerNote: z.string().max(1500).default(''),
  checkedItems: z.array(z.string().max(400)).max(25).default([]),
  findingDecisions: z
    .record(z.string().max(80), z.enum(['corroborated', 'benign_artifact', 'needs_followup']))
    .default({}),
});

// --- WebSocket server for authenticated real-time case collaboration, notifications & community calibration ---
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const wsUserMap = new WeakMap<WebSocket, AuthUser | null>();

function parseCookieHeader(cookiesHeader: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const part of cookiesHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      try {
        parsed[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        // ignore malformed cookie encoding
      }
    }
  }
  return parsed;
}

httpServer.on('upgrade', (req, socket, head) => {
  const urlPath = (req.url || '').split('?')[0];
  if (urlPath !== '/ws' && urlPath !== '/ws/community') {
    return;
  }

  const forwardedHost =
    typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim()
      : '';
  const host = forwardedHost || req.headers.host || '';
  if (!isTrustedOrigin(req.headers.origin, host)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', async (ws, req) => {
  wsUserMap.set(ws, null);
  try {
    const parsedCookies = parseCookieHeader(req.headers.cookie || '');
    const fakeReq = { cookies: parsedCookies, headers: req.headers } as unknown as express.Request;
    const resolved = await resolveSessionUser(fakeReq);
    if (resolved) {
      wsUserMap.set(ws, resolved.user);
    }
  } catch {
    // Wait for optional first-frame Bearer auth token
  }

  const authTimer = setTimeout(() => {
    if (!wsUserMap.get(ws) && ws.readyState === WebSocket.OPEN) {
      ws.close(4001, 'Authentication required');
    }
  }, 5000);

  ws.on('close', () => clearTimeout(authTimer));
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString('utf8')) as { type?: string; token?: string };
      if (msg?.type === 'auth' && typeof msg.token === 'string' && msg.token.length >= 32) {
        const fakeReq = {
          cookies: {},
          headers: { authorization: `Bearer ${msg.token}` },
        } as unknown as express.Request;
        const resolved = await resolveSessionUser(fakeReq);
        if (resolved) {
          wsUserMap.set(ws, resolved.user);
          clearTimeout(authTimer);
          ws.send(JSON.stringify({ type: 'auth:ok', userId: resolved.user.id }));
        } else {
          ws.close(4001, 'Invalid session token');
        }
      }
    } catch {
      // ignore non-JSON or oversized payloads
    }
  });
});

function broadcastLiveEvent(event: {
  type: string;
  caseId?: string;
  userId?: string;
  data: unknown;
}) {
  const message = JSON.stringify(event);
  void (async () => {
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const socketUser = wsUserMap.get(client);
      if (!socketUser) continue;

      if (event.userId && socketUser.id !== event.userId) {
        continue;
      }
      if (event.caseId) {
        const access = await getUserCaseAccess(event.caseId, socketUser).catch(() => ({
          allowed: false,
        }));
        if (!access.allowed) continue;
      }
      client.send(message);
    }
  })();
}

registerInAppNotifier((userId, notif) => {
  broadcastLiveEvent({ type: 'notification:new', userId, data: notif });
});

function broadcastCommunityUpdate(topicKey: string, payload: unknown) {
  const message = JSON.stringify({ type: 'vote:updated', topicKey, data: payload });
  void (async () => {
    const scopedCaseId = topicKey.startsWith('case-') ? topicKey.slice(5) : null;
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const socketUser = wsUserMap.get(client);
      if (!socketUser) continue;
      if (scopedCaseId) {
        const access = await getUserCaseAccess(scopedCaseId, socketUser).catch(() => ({
          allowed: false,
        }));
        if (!access.allowed) continue;
      }
      client.send(message);
    }
  })();
}

async function getCommunitySummary(topicKey: string) {
  const rows = await db
    .select()
    .from(communityVotes)
    .where(eq(communityVotes.topicKey, topicKey))
    .orderBy(desc(communityVotes.createdAt))
    .limit(40);

  const counts = {
    plausible_artifact: 0,
    needs_corroboration: 0,
    likely_benign: 0,
  };
  for (const r of rows) {
    if (r.stance === 'plausible_artifact') counts.plausible_artifact += 1;
    else if (r.stance === 'needs_corroboration') counts.needs_corroboration += 1;
    else if (r.stance === 'likely_benign') counts.likely_benign += 1;
  }

  return {
    topicKey,
    totalVotes: rows.length,
    counts,
    recentVotes: rows.map((r) => ({
      id: r.id,
      voterName: r.voterName,
      stance: r.stance,
      rationale: r.rationale,
      createdAt: r.createdAt,
    })),
  };
}

// --- Register Modular Routes (Auth/Profile/Sessions, Case Register/Categories/Witnesses/AI, Vault/Custody, Notifications, Admin/Security) ---
registerAuthRoutes(app, authLimiter);
registerCaseManagementRoutes(app, broadcastLiveEvent);
registerVaultCustodyRoutes(app);
registerAdminSecurityRoutes(app);
registerNotificationRoutes(app);

// --- Public non-secret runtime capabilities ---
app.get('/api/config', (_req, res) => {
  res.json({
    maxUploadMb: env.maxUploadMb,
    geminiConfigured: Boolean(env.geminiApiKey),
    geminiModel: env.geminiModel,
    emailConfigured: env.emailProviderConfigured,
    emailProviderType: env.emailProviderType,
    smsConfigured: env.smsProviderConfigured,
    qrBaseUrlConfigured: Boolean(env.qrBaseUrl),
    supportedLanguages: ['en', 'kn', 'hi', 'ta', 'te', 'ml'],
  });
});

// --- User Accessibility & Language Preferences ---
app.get('/api/user/preferences', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, req.user!.id))
    .limit(1);

  if (rows.length === 0) {
    res.json({
      language: 'en',
      textSize: 'md',
      narrationEnabled: true,
      highContrast: false,
      updatedAt: Date.now(),
    });
    return;
  }
  const p = rows[0];
  res.json({
    language: p.language,
    textSize: p.textSize,
    narrationEnabled: p.narrationEnabled === 1,
    highContrast: p.highContrast === 1,
    updatedAt: p.updatedAt,
  });
}));

app.put('/api/user/preferences', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid preferences payload.' });
    return;
  }
  const now = Date.now();
  const existing = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, req.user!.id))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(userPreferences).values({
      userId: req.user!.id,
      language: parsed.data.language,
      textSize: parsed.data.textSize,
      narrationEnabled: parsed.data.narrationEnabled ? 1 : 0,
      highContrast: parsed.data.highContrast ? 1 : 0,
      updatedAt: now,
    });
  } else {
    await db
      .update(userPreferences)
      .set({
        language: parsed.data.language,
        textSize: parsed.data.textSize,
        narrationEnabled: parsed.data.narrationEnabled ? 1 : 0,
        highContrast: parsed.data.highContrast ? 1 : 0,
        updatedAt: now,
      })
      .where(eq(userPreferences.userId, req.user!.id));
  }

  res.json({
    language: parsed.data.language,
    textSize: parsed.data.textSize,
    narrationEnabled: parsed.data.narrationEnabled,
    highContrast: parsed.data.highContrast,
    updatedAt: now,
  });
}));

// --- Case Endpoints (RBAC + Collaborator + Assignment Scoped) ---
app.get('/api/cases', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const user = req.user!;
  const q = sanitizeText(String(req.query.q || ''), 120).toLowerCase();
  const riskFilter = String(req.query.risk || '').trim();
  const categoryFilter = String(req.query.category || '').trim();
  const statusFilter = String(req.query.status || '').trim();
  const priorityFilter = String(req.query.priority || '').trim();
  const assignedToFilter = String(req.query.assignedTo || '').trim();
  const dateFrom = Number(req.query.dateFrom || 0) || 0;
  const dateTo = Number(req.query.dateTo || 0) || 0;
  const sortBy = String(req.query.sort || 'updated').trim();

  const admin = isAdminRole(user);
  let visibleCases = await db.select().from(cases).orderBy(desc(cases.updatedAt));

  if (!admin) {
    const [collabRows, witnessRows] = await Promise.all([
      db
        .select({ caseId: caseCollaborators.caseId })
        .from(caseCollaborators)
        .where(eq(caseCollaborators.userId, user.id)),
      db
        .select({ caseId: witnesses.caseId })
        .from(witnesses)
        .where(or(eq(witnesses.userId, user.id), eq(witnesses.email, user.email))),
    ]);
    const allowedSet = new Set([
      ...collabRows.map((r) => r.caseId),
      ...witnessRows.map((r) => r.caseId),
    ]);
    visibleCases = visibleCases.filter(
      (c) => c.userId === user.id || c.assignedInvestigatorId === user.id || allowedSet.has(c.id),
    );
  }

  const investigatorIds = Array.from(
    new Set(visibleCases.map((c) => c.assignedInvestigatorId).filter(Boolean) as string[]),
  );
  const invMap = new Map<string, string>();
  if (investigatorIds.length > 0) {
    const invUsers = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, investigatorIds));
    for (const u of invUsers) invMap.set(u.id, u.displayName);
  }

  let filtered = visibleCases.filter((c) => {
    if (riskFilter && riskFilter !== 'All' && c.riskLevel !== riskFilter) return false;
    if (categoryFilter && categoryFilter !== 'all' && (c.category || 'digital_fraud') !== categoryFilter) {
      return false;
    }
    if (statusFilter && statusFilter !== 'all' && (c.status || 'registered') !== statusFilter) {
      return false;
    }
    if (priorityFilter && priorityFilter !== 'all' && (c.priority || 'medium') !== priorityFilter) {
      return false;
    }
    if (assignedToFilter === 'me' && c.assignedInvestigatorId !== user.id) return false;
    if (assignedToFilter === 'unassigned' && c.assignedInvestigatorId) return false;
    if (dateFrom > 0 && (c.registrationDate || c.createdAt) < dateFrom) return false;
    if (dateTo > 0 && (c.registrationDate || c.createdAt) > dateTo) return false;
    if (q) {
      const hay = `${c.caseNumber || ''} ${c.title} ${c.description} ${c.captionText} ${c.incidentLocation || ''} ${c.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const priorityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  if (sortBy === 'newest') {
    filtered = filtered.sort((a, b) => b.createdAt - a.createdAt);
  } else if (sortBy === 'oldest') {
    filtered = filtered.sort((a, b) => a.createdAt - b.createdAt);
  } else if (sortBy === 'priority') {
    filtered = filtered.sort(
      (a, b) => (priorityRank[b.priority || 'medium'] ?? 2) - (priorityRank[a.priority || 'medium'] ?? 2),
    );
  } else {
    filtered = filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  res.json({
    cases: filtered.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber || `TL-2026-${c.id.slice(0, 4).toUpperCase()}`,
      title: c.title,
      description: c.description,
      category: c.category || 'digital_fraud',
      status: c.status || 'registered',
      priority: (c.priority || 'medium') as 'low' | 'medium' | 'high' | 'critical',
      incidentLocation: c.incidentLocation || '',
      incidentDate: c.incidentDate || '',
      registrationDate: c.registrationDate || c.createdAt,
      assignedInvestigatorId: c.assignedInvestigatorId || null,
      assignedInvestigatorName: c.assignedInvestigatorId
        ? invMap.get(c.assignedInvestigatorId) || 'Assigned Staff'
        : null,
      isDemoSeed: c.isDemoSeed === 1,
      riskLevel: c.riskLevel,
      confidenceMin: c.confidenceMin,
      confidenceMax: c.confidenceMax,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}));

app.post('/api/cases', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
  if (!canCreateCase(req.user)) {
    res.status(403).json({ error: 'Viewers and witnesses cannot create new investigation cases.' });
    return;
  }
  const parsed = createCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid case title, category, or metadata fields.' });
    return;
  }

  const caseId = crypto.randomUUID();
  const now = Date.now();
  const year = new Date(now).getFullYear();
  const caseNumber = parsed.data.caseNumber?.trim()
    ? sanitizeText(parsed.data.caseNumber, 40)
    : `TL-${year}-${caseId.slice(0, 4).toUpperCase()}`;
  const title = sanitizeText(parsed.data.title, 140);
  const description = sanitizeText(parsed.data.description, 600);
  const captionText = sanitizeText(parsed.data.captionText, 3000);
  const category = sanitizeText(parsed.data.category, 60);
  const incidentLocation = sanitizeText(parsed.data.incidentLocation, 240);
  const incidentDate = sanitizeText(parsed.data.incidentDate, 40);
  const notes = sanitizeText(parsed.data.notes, 3000);

  await db.insert(cases).values({
    id: caseId,
    userId: req.user!.id,
    caseNumber,
    title,
    description,
    captionText,
    category,
    status: parsed.data.status,
    priority: parsed.data.priority,
    incidentLocation,
    incidentDate,
    registrationDate: now,
    assignedInvestigatorId: req.user!.id,
    relatedPersonsJson: JSON.stringify(parsed.data.relatedPersons ?? []),
    categoryFieldsJson: JSON.stringify(parsed.data.categoryFields ?? {}),
    notes,
    closingSummary: '',
    isDemoSeed: 0,
    riskLevel: 'Low',
    confidenceMin: 15,
    confidenceMax: 35,
    summary:
      'Investigation registered. Upload image, video, audio, or document evidence and run forensic analysis to generate explainable indicators.',
    limitationsJson: JSON.stringify([
      'No multimodal signals evaluated yet. Upload evidence items and run analysis.',
    ]),
    alternativesJson: JSON.stringify([]),
    recommendedChecksJson: JSON.stringify(['Upload original unedited media files and record initial custody transfer.']),
    createdAt: now,
    updatedAt: now,
  });

  if (captionText.length > 0) {
    const txtId = crypto.randomUUID();
    const sha = computeSha256(Buffer.from(captionText, 'utf8'));
    await db.insert(evidenceItems).values({
      id: txtId,
      caseId,
      userId: req.user!.id,
      modality: 'text',
      sourceType: 'caption',
      originalFilename: 'submitted_caption.txt',
      storedFilename: null,
      elaFilename: null,
      fftFilename: null,
      mimeType: 'text/plain',
      byteSize: Buffer.byteLength(captionText, 'utf8'),
      sha256: sha,
      transcript: captionText,
      createdAt: now,
    });
    await db.insert(evidenceVersions).values({
      id: crypto.randomUUID(),
      evidenceId: txtId,
      caseId,
      versionNumber: 1,
      sha256: sha,
      byteSize: Buffer.byteLength(captionText, 'utf8'),
      note: 'Initial claim/caption statement ingested on registration',
      updatedBy: req.user!.displayName,
      createdAt: now,
    });
    await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId: txtId,
      action: 'INGEST_ORIGINAL',
      fileSha256: sha,
      collectedBy: req.user!.displayName,
      receivedBy: 'TruthLens Vault',
      transferReason: 'Case registration claim text',
      createdAt: now,
    });
  }

  await recordCaseActivity({
    caseId,
    userId: req.user!.id,
    actorName: req.user!.displayName,
    action: 'CASE_REGISTERED',
    summary: `Registered ${caseNumber} (${category}, priority=${parsed.data.priority})`,
  });

  await recordAuditEvent({
    req,
    userId: req.user!.id,
    action: 'CASE_CREATE',
    resourceType: 'case',
    resourceId: caseId,
    details: `Registered case ${caseNumber} "${title}"`,
  });

  dispatchCaseAlerts({
    userId: req.user!.id,
    caseId,
    caseTitle: title,
    eventType: 'case_registered',
    summaryLine: `Investigation ${caseNumber} ("${title}") registered (${category}, priority=${parsed.data.priority}).`,
  }).catch(() => {});

  sendTransactionalAccountEmail({
    userId: req.user!.id,
    toEmail: req.user!.email,
    caseId,
    eventType: 'case_registered',
    subject: `TruthLens Investigation Registered — ${caseNumber}`,
    text: `Investigation ${caseNumber} ("${title}") was registered by ${req.user!.displayName}.\nCategory: ${category}\nPriority: ${parsed.data.priority}\nOpen case: ${buildPublicAppUrl(`?case=${encodeURIComponent(caseId)}`)}`,
  }).catch(() => {});

  const full = await loadFullCaseAuthorized(caseId, req.user!);
  res.status(201).json(full);
}));

app.get('/api/cases/:caseId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const full = await loadFullCaseAuthorized(String(req.params.caseId), req.user!);
  if (!full) {
    res.status(404).json({ error: 'Case not found or access denied.' });
    return;
  }
  res.json(full);
}));

app.delete('/api/cases/:caseId', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
  const caseId = String(req.params.caseId);
  if (!canDeleteCase(req.user)) {
    res.status(403).json({ error: 'Your role cannot delete investigations.' });
    return;
  }
  const access = await getUserCaseAccess(caseId, req.user!);
  if (!access.allowed || (!access.isOwner && !access.isAdmin)) {
    res.status(403).json({ error: 'Only the case owner or an administrator may delete this investigation.' });
    return;
  }
  const owned = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (owned.length === 0) {
    res.status(404).json({ error: 'Case not found.' });
    return;
  }
  const evRows = await db.select().from(evidenceItems).where(eq(evidenceItems.caseId, caseId));

  for (const ev of evRows) {
    if (ev.storedFilename) {
      const p = path.join(UPLOADS_DIR, path.basename(ev.storedFilename));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (ev.elaFilename) {
      const p = path.join(ELA_DIR, path.basename(ev.elaFilename));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (ev.fftFilename) {
      const p = path.join(ELA_DIR, path.basename(ev.fftFilename));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }

  await db.delete(cases).where(eq(cases.id, caseId));
  await recordAuditEvent({
    req,
    userId: req.user!.id,
    action: 'CASE_DELETE',
    resourceType: 'case',
    resourceId: caseId,
    details: `Deleted case "${owned[0].title}"`,
  });
  res.json({ ok: true, deletedCaseId: caseId });
}));

app.post('/api/cases/:caseId/caption', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
  const caseId = String(req.params.caseId);
  if (!canUploadEvidence(req.user)) {
    res.status(403).json({ error: 'Read-only roles cannot modify case claims.' });
    return;
  }
  const access = await getUserCaseAccess(caseId, req.user!);
  if (!access.allowed || !access.canWrite) {
    res.status(403).json({ error: 'Access denied or read-only case access.' });
    return;
  }
  const owned = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (owned.length === 0) {
    res.status(404).json({ error: 'Case not found.' });
    return;
  }

  const parsed = updateCaptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid caption text.' });
    return;
  }

  const cleanCaption = sanitizeText(parsed.data.captionText, 3000);
  const now = Date.now();
  await db.update(cases).set({ captionText: cleanCaption, updatedAt: now }).where(eq(cases.id, caseId));

  const existingText = await db
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.caseId, caseId), eq(evidenceItems.modality, 'text')))
    .limit(1);

  const sha = computeSha256(Buffer.from(cleanCaption, 'utf8'));
  if (existingText.length > 0) {
    await db
      .update(evidenceItems)
      .set({
        transcript: cleanCaption,
        sha256: sha,
        byteSize: Buffer.byteLength(cleanCaption, 'utf8'),
      })
      .where(eq(evidenceItems.id, existingText[0].id));
    await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId: existingText[0].id,
      action: 'CAPTION_UPDATED',
      fileSha256: sha,
      transferredBy: req.user!.displayName,
      transferReason: 'Updated associated claim / caption statement',
      createdAt: now,
    });
  } else {
    const txtId = crypto.randomUUID();
    await db.insert(evidenceItems).values({
      id: txtId,
      caseId,
      userId: req.user!.id,
      modality: 'text',
      sourceType: 'caption',
      originalFilename: 'submitted_caption.txt',
      mimeType: 'text/plain',
      byteSize: Buffer.byteLength(cleanCaption, 'utf8'),
      sha256: sha,
      transcript: cleanCaption,
      createdAt: now,
    });
    await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId: txtId,
      action: 'INGEST_ORIGINAL',
      fileSha256: sha,
      collectedBy: req.user!.displayName,
      receivedBy: 'TruthLens Vault',
      createdAt: now,
    });
  }

  const updatedEvRows = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.caseId, caseId))
    .orderBy(asc(evidenceItems.createdAt));

  const detCap = runDeterministicCrossModalEngine({
    caseTitle: owned[0].title,
    captionText: cleanCaption,
    evidenceRows: updatedEvRows,
  });

  await db
    .update(cases)
    .set({
      correlationsJson: JSON.stringify(detCap.correlations),
      manipulationJson: JSON.stringify(detCap.manipulationIndicators),
      analysisStale: 1,
      updatedAt: now,
    })
    .where(eq(cases.id, caseId));

  await recordCaseActivity({
    caseId,
    userId: req.user!.id,
    actorName: req.user!.displayName,
    action: 'CLAIM_UPDATED',
    summary: 'Updated claim/caption text for cross-modal correlation',
  });

  const full = await loadFullCaseAuthorized(caseId, req.user!);
  res.json(full);
}));

async function ingestMediaBufferToCase(params: {
  req: AuthedRequest;
  caseRow: typeof cases.$inferSelect;
  buffer: Buffer;
  originalFilename: string;
  modality: 'image' | 'audio' | 'video' | 'document';
  canonicalMime: string;
  ext: string;
  sourceType: 'upload' | 'live_camera' | 'url_ingest';
  videoMeta?: z.infer<typeof videoMetaSchema>;
  videoFrames?: Array<z.infer<typeof videoFrameSchema>>;
  urlExtraMetrics?: Record<string, unknown>;
}): Promise<{
  evidenceId: string;
  sha256: string;
  storedOk: boolean;
}> {
  const { req, caseRow, buffer, modality, canonicalMime, ext, sourceType } = params;
  const caseId = caseRow.id;
  const evidenceId = crypto.randomUUID();
  const randomStoredName = `${crypto.randomUUID()}${ext}`;
  const originalFilename = sanitizeFilename(params.originalFilename);
  const sha256 = computeSha256(buffer);
  const now = Date.now();

  const targetPath = path.join(UPLOADS_DIR, randomStoredName);
  fs.writeFileSync(targetPath, buffer);
  const verifiedDiskSha = computeSha256(fs.readFileSync(targetPath));
  if (verifiedDiskSha !== sha256) {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    return { evidenceId, sha256, storedOk: false };
  }

  let elaFilename: string | null = null;
  let fftFilename: string | null = null;
  let perceptualHash: string | null = null;
  let exifJson: string | null = null;
  let metricsJson: string | null = null;
  let framesJson: string | null = null;
  let transcript: string | null = null;

  if (modality === 'image') {
    const imgMetrics = await analyzeImageBuffer(buffer);
    elaFilename = imgMetrics.elaFilename;
    fftFilename = imgMetrics.fftFilename;
    perceptualHash = imgMetrics.perceptualHash;
    exifJson = JSON.stringify(imgMetrics.exifSummary);
    metricsJson = JSON.stringify({
      width: imgMetrics.width,
      height: imgMetrics.height,
      elaMean: imgMetrics.elaMean,
      elaMax: imgMetrics.elaMax,
      elaP95: imgMetrics.elaP95,
      blockVarianceRatio: imgMetrics.blockVarianceRatio,
      hotspotSector: imgMetrics.hotspotSector,
      fftHighFreqRatio: imgMetrics.fftHighFreqRatio,
      fftPeriodicPeakScore: imgMetrics.fftPeriodicPeakScore,
      lsbAnomalyScore: imgMetrics.lsbAnomalyScore,
      c2paPresent: imgMetrics.c2paPresent,
      c2paOrAiMarkers: imgMetrics.c2paOrAiMarkers,
      manipulationIndicators: imgMetrics.manipulationIndicators,
      aiGenerationIndicators: imgMetrics.aiGenerationIndicators,
      suspiciousRegions: imgMetrics.suspiciousRegions,
      integrityCheck: imgMetrics.integrityCheck,
      ...(params.urlExtraMetrics ?? {}),
    });
  } else if (modality === 'audio') {
    const audMetrics = analyzeAudioBuffer(buffer, canonicalMime);
    metricsJson = JSON.stringify({ ...audMetrics, ...(params.urlExtraMetrics ?? {}) });
  } else if (modality === 'document') {
    const docMetrics = analyzeDocumentBuffer(buffer, canonicalMime);
    metricsJson = JSON.stringify({ ...docMetrics, ...(params.urlExtraMetrics ?? {}) });
    transcript = docMetrics.extractedExcerpt;
  } else if (modality === 'video') {
    const parsedFrames = params.videoFrames ?? [];
    if (parsedFrames.length > 0) {
      framesJson = JSON.stringify(parsedFrames);
    }
    const extraMeta = params.videoMeta ?? {};
    const vidMetrics = analyzeVideoBuffer(buffer, canonicalMime, {
      durationSec: extraMeta.durationSec ?? undefined,
      width: extraMeta.width ?? undefined,
      height: extraMeta.height ?? undefined,
      hasAudioTrack: extraMeta.hasAudioTrack ?? null,
      audioSyncNote: extraMeta.audioSyncNote ? sanitizeText(extraMeta.audioSyncNote, 300) : undefined,
      frames: parsedFrames,
    });
    metricsJson = JSON.stringify({ ...vidMetrics, ...(params.urlExtraMetrics ?? {}) });
  }

  await db.insert(evidenceItems).values({
    id: evidenceId,
    caseId,
    userId: req.user!.id,
    modality,
    sourceType,
    originalFilename,
    storedFilename: randomStoredName,
    elaFilename,
    fftFilename,
    mimeType: canonicalMime,
    byteSize: buffer.length,
    sha256,
    perceptualHash,
    exifJson,
    metricsJson,
    framesJson,
    transcript,
    createdAt: now,
  });

  await db.insert(evidenceVersions).values({
    id: crypto.randomUUID(),
    evidenceId,
    caseId,
    versionNumber: 1,
    sha256,
    byteSize: buffer.length,
    note: `Original ${modality} (${sourceType}) sealed on ingestion`,
    updatedBy: req.user!.displayName,
    createdAt: now,
  });

  await appendCustodyEntry({
    caseId,
    userId: req.user!.id,
    evidenceId,
    action: sourceType === 'url_ingest' ? 'INGEST_URL_MEDIA' : 'INGEST_ORIGINAL',
    fileSha256: sha256,
    collectedBy: req.user!.displayName,
    receivedBy: 'TruthLens Immutable Vault',
    transferReason: `Initial ${sourceType} ingest (${originalFilename})`,
    createdAt: now,
  });

  await recordCaseActivity({
    caseId,
    userId: req.user!.id,
    actorName: req.user!.displayName,
    action: 'EVIDENCE_UPLOADED',
    summary: `Ingested ${modality} "${originalFilename}" (SHA-256 ${sha256.slice(0, 12)}…)`,
  });

  await recordAuditEvent({
    req,
    userId: req.user!.id,
    action: sourceType === 'url_ingest' ? 'EVIDENCE_URL_INGEST' : 'EVIDENCE_UPLOAD',
    resourceType: 'evidence',
    resourceId: evidenceId,
    details: `Ingested ${modality} (${sourceType}) "${originalFilename}" (${buffer.length} bytes, sha256:${sha256.slice(0, 12)})`,
  });

  const updatedEvRows = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.caseId, caseId))
    .orderBy(asc(evidenceItems.createdAt));

  const detUpdate = runDeterministicCrossModalEngine({
    caseTitle: caseRow.title,
    captionText: caseRow.captionText,
    evidenceRows: updatedEvRows,
  });

  await db
    .update(cases)
    .set({
      correlationsJson: JSON.stringify(detUpdate.correlations),
      manipulationJson: JSON.stringify(detUpdate.manipulationIndicators),
      analysisStale: 1,
      updatedAt: now,
    })
    .where(eq(cases.id, caseId));

  dispatchCaseNotificationToParticipants({
    userIds: [caseRow.userId, caseRow.assignedInvestigatorId],
    caseId,
    caseTitle: caseRow.title,
    eventType: 'evidence_submitted',
    summaryLine: `${req.user!.displayName} ingested ${modality} "${originalFilename}" (${buffer.length} bytes).`,
  }).catch(() => {});

  if (detUpdate.manipulationIndicators.some((m) => m.severity === 'High')) {
    dispatchCaseNotificationToParticipants({
      userIds: [caseRow.userId, caseRow.assignedInvestigatorId],
      caseId,
      caseTitle: caseRow.title,
      eventType: 'high_risk_indicator',
      summaryLine: `High-severity manipulation signal detected in uploaded ${modality} "${originalFilename}".`,
    }).catch(() => {});
  }

  return { evidenceId, sha256, storedOk: true };
}

// Upload image / audio / video / document evidence
app.post(
  '/api/cases/:caseId/evidence',
  requireAuth,
  requireCsrf,
  uploadLimiter,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: `File exceeds the ${env.maxUploadMb} MB upload limit.` });
            return;
          }
          res.status(400).json({ error: `Upload error (${err.code}): ${err.message}` });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : 'File upload rejected.' });
        return;
      }
      next();
    });
  },
  asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    if (!canUploadEvidence(req.user)) {
      res.status(403).json({ error: 'Viewers and witnesses cannot upload raw exhibits.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed || !access.canWrite) {
      res.status(403).json({ error: 'Access denied or read-only case access.' });
      return;
    }
    const owned = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (owned.length === 0) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No evidence file attached.' });
      return;
    }

    if (!file.buffer || file.buffer.length === 0) {
      res.status(400).json({ error: 'Uploaded file is empty (0 bytes).' });
      return;
    }

    const magicCheck = verifyMagicBytes(file.buffer, file.mimetype, file.originalname);
    if (!magicCheck.ok) {
      res.status(400).json({ error: magicCheck.reason });
      return;
    }

    const sourceType = req.body?.sourceType === 'live_camera' ? 'live_camera' : 'upload';

    let videoMeta: z.infer<typeof videoMetaSchema> = {};
    let parsedFrames: Array<z.infer<typeof videoFrameSchema>> = [];
    if (magicCheck.modality === 'video') {
      if (typeof req.body?.videoMetaJson === 'string') {
        try {
          videoMeta = videoMetaSchema.parse(JSON.parse(req.body.videoMetaJson));
        } catch {
          videoMeta = {};
        }
      }
      if (typeof req.body?.framesJson === 'string' && req.body.framesJson.trim() !== '') {
        try {
          parsedFrames = z.array(videoFrameSchema).max(16).parse(JSON.parse(req.body.framesJson));
        } catch {
          parsedFrames = [];
        }
      }
    }

    const ingested = await ingestMediaBufferToCase({
      req,
      caseRow: owned[0],
      buffer: file.buffer,
      originalFilename: file.originalname,
      modality: magicCheck.modality,
      canonicalMime: magicCheck.canonicalMime,
      ext: magicCheck.ext,
      sourceType,
      videoMeta,
      videoFrames: parsedFrames,
    });

    if (!ingested.storedOk) {
      res.status(500).json({ error: 'Storage integrity verification failed during upload.' });
      return;
    }

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    broadcastLiveEvent({ type: 'case:updated', caseId, data: full });
    res.status(201).json({
      ...full,
      uploadedEvidenceId: ingested.evidenceId,
      uploadedSha256: ingested.sha256,
    });
  }),
);

// SSRF-safe public URL evidence ingestion & webpage provenance inspector
app.post(
  '/api/cases/:caseId/ingest-url',
  requireAuth,
  requireCsrf,
  urlIngestLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    if (!canUploadEvidence(req.user)) {
      res.status(403).json({ error: 'Viewers and witnesses cannot ingest URL evidence.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed || !access.canWrite) {
      res.status(403).json({ error: 'Access denied or read-only case access.' });
      return;
    }
    const owned = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (owned.length === 0) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const bodySchema = z.object({
      url: z.string().trim().min(8).max(2048),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a valid public http:// or https:// URL.' });
      return;
    }

    let result;
    try {
      result = await inspectAndIngestPublicUrl(parsed.data.url, env.maxUploadBytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch URL.';
      if (/private|loopback|local|unsafe|credentials|protocol|hostname/i.test(msg)) {
        await recordAuditEvent({
          req,
          userId: req.user!.id,
          action: 'SSRF_BLOCKED',
          resourceType: 'case',
          resourceId: caseId,
          details: `Blocked unsafe URL ingestion attempt: ${msg.slice(0, 180)}`,
        });
      }
      res.status(400).json({ error: msg });
      return;
    }

    if (result.kind === 'media') {
      const magicCheck = verifyMagicBytes(result.buffer, result.canonicalMime, result.filename);
      if (!magicCheck.ok) {
        res.status(400).json({ error: `Remote asset rejected: ${magicCheck.reason}` });
        return;
      }
      const ingested = await ingestMediaBufferToCase({
        req,
        caseRow: owned[0],
        buffer: result.buffer,
        originalFilename: result.filename,
        modality: magicCheck.modality,
        canonicalMime: magicCheck.canonicalMime,
        ext: magicCheck.ext,
        sourceType: 'url_ingest',
        urlExtraMetrics: {
          sourceUrl: result.finalUrl,
          httpStatus: result.httpStatus,
          headersSummary: result.headersSummary,
        },
      });
      if (!ingested.storedOk) {
        res.status(500).json({ error: 'Storage integrity verification failed while sealing remote media.' });
        return;
      }
      const full = await loadFullCaseAuthorized(caseId, req.user!);
      broadcastLiveEvent({ type: 'case:updated', caseId, data: full });
      res.status(201).json({
        ...full,
        uploadedEvidenceId: ingested.evidenceId,
        uploadedSha256: ingested.sha256,
        ingestedUrlMetadata: {
          kind: 'media',
          finalUrl: result.finalUrl,
          httpStatus: result.httpStatus,
          mimeType: magicCheck.canonicalMime,
          byteSize: result.buffer.length,
        },
      });
      return;
    }

    // Webpage HTML snapshot ingestion
    const meta = result.metadata;
    const evidenceId = crypto.randomUUID();
    const randomStoredName = `${crypto.randomUUID()}.txt`;
    const sha256 = result.sha256;
    const now = Date.now();
    const originalFilename = sanitizeFilename(result.filename);

    const targetPath = path.join(UPLOADS_DIR, randomStoredName);
    fs.writeFileSync(targetPath, result.buffer);

    const metricsPayload = {
      documentType: 'webpage',
      finalUrl: result.finalUrl,
      hostname: meta.hostname,
      title: meta.title,
      description: meta.description,
      ogTitle: meta.ogTitle,
      ogImage: meta.ogImage,
      canonicalUrl: meta.canonicalUrl,
      author: meta.author,
      publishedDate: meta.publishedDate,
      outboundDomains: meta.outboundDomains,
      wordCount: meta.wordCount,
      httpStatus: result.httpStatus,
      contentType: result.canonicalMime,
      headersSummary: result.headersSummary,
      extractedExcerpt: result.extractedExcerpt,
    };

    await db.insert(evidenceItems).values({
      id: evidenceId,
      caseId,
      userId: req.user!.id,
      modality: 'document',
      sourceType: 'url_ingest',
      originalFilename,
      storedFilename: randomStoredName,
      elaFilename: null,
      fftFilename: null,
      mimeType: 'text/plain',
      byteSize: result.buffer.length,
      sha256,
      perceptualHash: null,
      exifJson: null,
      metricsJson: JSON.stringify(metricsPayload),
      framesJson: null,
      transcript: result.extractedExcerpt,
      createdAt: now,
    });

    await db.insert(evidenceVersions).values({
      id: crypto.randomUUID(),
      evidenceId,
      caseId,
      versionNumber: 1,
      sha256,
      byteSize: result.buffer.length,
      note: `Sanitized webpage snapshot sealed from ${result.finalUrl}`,
      updatedBy: req.user!.displayName,
      createdAt: now,
    });

    await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId,
      action: 'INGEST_URL_SNAPSHOT',
      fileSha256: sha256,
      collectedBy: req.user!.displayName,
      receivedBy: 'TruthLens Immutable Vault',
      transferReason: `Sanitized webpage snapshot (${meta.hostname})`,
      createdAt: now,
    });

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: 'URL_SNAPSHOT_INGESTED',
      summary: `Captured sanitized webpage snapshot from ${meta.hostname} (SHA-256 ${sha256.slice(0, 12)}…)`,
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'EVIDENCE_URL_SNAPSHOT',
      resourceType: 'evidence',
      resourceId: evidenceId,
      details: `Ingested sanitized webpage snapshot from ${result.finalUrl}`,
    });

    const updatedEvRows = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.caseId, caseId))
      .orderBy(asc(evidenceItems.createdAt));

    const detUpdate = runDeterministicCrossModalEngine({
      caseTitle: owned[0].title,
      captionText: owned[0].captionText,
      evidenceRows: updatedEvRows,
    });

    await db
      .update(cases)
      .set({
        correlationsJson: JSON.stringify(detUpdate.correlations),
        manipulationJson: JSON.stringify(detUpdate.manipulationIndicators),
        analysisStale: 1,
        updatedAt: now,
      })
      .where(eq(cases.id, caseId));

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    broadcastLiveEvent({ type: 'case:updated', caseId, data: full });
    res.status(201).json({
      ...full,
      uploadedEvidenceId: evidenceId,
      uploadedSha256: sha256,
      ingestedUrlMetadata: { kind: 'webpage', ...metricsPayload },
    });
  }),
);

// Remove evidence item cleanly while preserving cryptographic custody chain
app.delete(
  '/api/cases/:caseId/evidence/:evidenceId',
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const evidenceId = String(req.params.evidenceId);
    if (!canDeleteCase(req.user)) {
      res.status(403).json({ error: 'Insufficient role permissions to remove evidence.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed || !access.canWrite) {
      res.status(403).json({ error: 'Access denied or read-only case access.' });
      return;
    }

    const owned = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (owned.length === 0) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const evRows = await db
      .select()
      .from(evidenceItems)
      .where(and(eq(evidenceItems.id, evidenceId), eq(evidenceItems.caseId, caseId)))
      .limit(1);

    if (evRows.length === 0) {
      res.status(404).json({ error: 'Evidence item not found.' });
      return;
    }
    const target = evRows[0];

    if (target.storedFilename) {
      const p = path.join(UPLOADS_DIR, path.basename(target.storedFilename));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (target.elaFilename) {
      const p = path.join(ELA_DIR, path.basename(target.elaFilename));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (target.fftFilename) {
      const p = path.join(ELA_DIR, path.basename(target.fftFilename));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    const now = Date.now();
    await db.delete(evidenceItems).where(and(eq(evidenceItems.id, evidenceId), eq(evidenceItems.caseId, caseId)));

    await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId,
      action: 'EVIDENCE_REMOVED',
      fileSha256: target.sha256,
      transferredBy: req.user!.displayName,
      transferReason: `Exhibit "${target.originalFilename}" removed by authorized investigator`,
      createdAt: now,
    });

    const remainingRows = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.caseId, caseId))
      .orderBy(asc(evidenceItems.createdAt));

    const detUpdate = runDeterministicCrossModalEngine({
      caseTitle: owned[0].title,
      captionText: owned[0].captionText,
      evidenceRows: remainingRows,
    });

    await db
      .update(cases)
      .set({
        correlationsJson: JSON.stringify(detUpdate.correlations),
        manipulationJson: JSON.stringify(detUpdate.manipulationIndicators),
        analysisStale: 1,
        updatedAt: now,
      })
      .where(eq(cases.id, caseId));

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: 'EVIDENCE_REMOVED',
      summary: `Removed ${target.modality} "${target.originalFilename}"`,
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'EVIDENCE_DELETE',
      resourceType: 'evidence',
      resourceId: evidenceId,
      details: `Removed ${target.modality} "${target.originalFilename}"`,
    });

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    res.json(full);
  }),
);

// Authorized streaming routes for original uploads, ELA PNG, and FFT PNG (never publicly exposed)
app.get('/api/cases/:caseId/evidence/:evidenceId/file', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const caseId = String(req.params.caseId);
  const evidenceId = String(req.params.evidenceId);
  const access = await getUserCaseAccess(caseId, req.user!);
  if (!access.allowed) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }
  const rows = await db
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.id, evidenceId), eq(evidenceItems.caseId, caseId)))
    .limit(1);

  if (rows.length === 0 || !rows[0].storedFilename) {
    res.status(404).json({ error: 'Evidence file not found.' });
    return;
  }

  const safePath = path.join(UPLOADS_DIR, path.basename(rows[0].storedFilename));
  if (!fs.existsSync(safePath)) {
    res.status(404).json({ error: 'Stored file missing.' });
    return;
  }

  const isDownload = req.query.download === '1';
  db.insert(evidenceAccessLogs)
    .values({
      id: crypto.randomUUID(),
      evidenceId,
      caseId,
      userId: req.user!.id,
      userName: req.user!.displayName,
      action: isDownload ? 'download' : 'view',
      ipHash: hashIp(req.ip ?? 'unknown'),
      createdAt: Date.now(),
    })
    .catch(() => {});

  res.setHeader('Content-Type', rows[0].mimeType);
  res.setHeader(
    'Content-Disposition',
    `${isDownload ? 'attachment' : 'inline'}; filename="${sanitizeFilename(rows[0].originalFilename)}"`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(safePath).pipe(res);
}));

app.get('/api/cases/:caseId/evidence/:evidenceId/ela', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const caseId = String(req.params.caseId);
  const evidenceId = String(req.params.evidenceId);
  const access = await getUserCaseAccess(caseId, req.user!);
  if (!access.allowed) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }
  const rows = await db
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.id, evidenceId), eq(evidenceItems.caseId, caseId)))
    .limit(1);

  if (rows.length === 0 || !rows[0].elaFilename) {
    res.status(404).json({ error: 'ELA heatmap not found.' });
    return;
  }

  const safePath = path.join(ELA_DIR, path.basename(rows[0].elaFilename));
  if (!fs.existsSync(safePath)) {
    res.status(404).json({ error: 'ELA asset missing.' });
    return;
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(safePath).pipe(res);
}));

app.get('/api/cases/:caseId/evidence/:evidenceId/fft', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const caseId = String(req.params.caseId);
  const evidenceId = String(req.params.evidenceId);
  const access = await getUserCaseAccess(caseId, req.user!);
  if (!access.allowed) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }
  const rows = await db
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.id, evidenceId), eq(evidenceItems.caseId, caseId)))
    .limit(1);

  if (rows.length === 0 || !rows[0].fftFilename) {
    res.status(404).json({ error: 'FFT spectrum not found.' });
    return;
  }

  const safePath = path.join(ELA_DIR, path.basename(rows[0].fftFilename));
  if (!fs.existsSync(safePath)) {
    res.status(404).json({ error: 'FFT asset missing.' });
    return;
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(safePath).pipe(res);
}));

// Run Gemini multimodal cross-modal forensic synthesis
app.post(
  '/api/cases/:caseId/analyze',
  requireAuth,
  requireCsrf,
  aiLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    if (!canRunAnalysis(req.user)) {
      res.status(403).json({ error: 'Investigator privileges required to run forensic synthesis.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed || !access.canWrite) {
      res.status(403).json({ error: 'Access denied or read-only case access.' });
      return;
    }
    const full = await loadFullCaseAuthorized(caseId, req.user!);
    if (!full) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const evRows = await db.select().from(evidenceItems).where(eq(evidenceItems.caseId, caseId));

    if (evRows.length === 0 && !full.case.captionText) {
      res.status(400).json({ error: 'Upload at least one evidence item or caption before running analysis.' });
      return;
    }

    const images = [];
    const audios = [];
    const videos = [];
    const documents = [];

    for (const ev of evRows) {
      if (ev.modality === 'image' && ev.storedFilename) {
        const diskPath = path.join(UPLOADS_DIR, path.basename(ev.storedFilename));
        if (fs.existsSync(diskPath)) {
          const buf = fs.readFileSync(diskPath);
          const m = ev.metricsJson ? JSON.parse(ev.metricsJson) : {};
          images.push({
            evidenceId: ev.id,
            filename: ev.originalFilename,
            mimeType: ev.mimeType,
            buffer: buf,
            elaSummary: `ELA mean=${m.elaMean ?? 'n/a'}, max=${m.elaMax ?? 'n/a'}, sector=${m.hotspotSector ?? 'n/a'}, varianceRatio=${m.blockVarianceRatio ?? 'n/a'}, lsbAnomaly=${m.lsbAnomalyScore ?? 'n/a'}, c2paPresent=${Boolean(m.c2paPresent)}`,
            exifSummary: ev.exifJson ?? '{}',
            fftSummary: `highFreqRatio=${m.fftHighFreqRatio ?? 'n/a'}, periodicPeakScore=${m.fftPeriodicPeakScore ?? 'n/a'}, aiMarkers=${Array.isArray(m.c2paOrAiMarkers) ? m.c2paOrAiMarkers.join(',') : 'none'}`,
            perceptualHash: ev.perceptualHash ?? '',
          });
        }
      } else if (ev.modality === 'audio' && ev.storedFilename) {
        const diskPath = path.join(UPLOADS_DIR, path.basename(ev.storedFilename));
        if (fs.existsSync(diskPath)) {
          const buf = fs.readFileSync(diskPath);
          audios.push({
            evidenceId: ev.id,
            filename: ev.originalFilename,
            mimeType: ev.mimeType,
            buffer: buf,
            signalSummary: ev.metricsJson ?? '{}',
          });
        }
      } else if (ev.modality === 'document') {
        const docMetrics = ev.metricsJson ? JSON.parse(ev.metricsJson) : {};
        documents.push({
          evidenceId: ev.id,
          filename: ev.originalFilename,
          mimeType: ev.mimeType,
          summary:
            docMetrics.documentType === 'webpage'
              ? `type=webpage_snapshot, url=${docMetrics.finalUrl ?? 'n/a'}, hostname=${docMetrics.hostname ?? 'n/a'}, title=${docMetrics.title ?? 'n/a'}, author=${docMetrics.author ?? 'n/a'}, published=${docMetrics.publishedDate ?? 'n/a'}, outboundDomains=${Array.isArray(docMetrics.outboundDomains) ? docMetrics.outboundDomains.join(',') : 'none'}`
              : `type=${docMetrics.documentType ?? 'unknown'}, pdfVersion=${docMetrics.pdfVersion ?? 'n/a'}, pages=${docMetrics.estimatedPages ?? 'n/a'}, author=${docMetrics.author ?? 'n/a'}, creator=${docMetrics.creator ?? 'n/a'}, producer=${docMetrics.producer ?? 'n/a'}, incrementalUpdates=${docMetrics.incrementalUpdatesCount ?? 0}, embeddedScripts=${Boolean(docMetrics.hasEmbeddedScripts)}`,
          excerpt: ev.transcript ?? docMetrics.extractedExcerpt ?? '',
        });
      } else if (ev.modality === 'video') {
        let frames: Array<{
          timestampSec: number;
          deltaScore: number;
          suspicious: boolean;
          thumbnailDataUrl: string;
        }> = [];
        try {
          const parsedFrames = ev.framesJson ? JSON.parse(ev.framesJson) : [];
          frames = Array.isArray(parsedFrames) ? parsedFrames : [];
        } catch {
          frames = [];
        }
        const prioritized = [
          ...frames.filter((f) => f.suspicious),
          ...frames.filter((f) => !f.suspicious),
        ].slice(0, 4);
        videos.push({
          evidenceId: ev.id,
          filename: ev.originalFilename,
          frameCount: frames.length,
          suspiciousSummary: ev.metricsJson ?? '{}',
          sampleFramesBase64: prioritized.map((f) => ({
            timestampSec: f.timestampSec,
            base64Jpeg: f.thumbnailDataUrl,
          })),
        });
      }
    }

    const deterministic = runDeterministicCrossModalEngine({
      caseTitle: full.case.title,
      captionText: full.case.captionText,
      evidenceRows: evRows,
    });

    let report = {
      riskLevel: deterministic.riskLevel,
      confidenceMin: deterministic.confidenceMin,
      confidenceMax: deterministic.confidenceMax,
      summary: deterministic.summary,
      audioTranscripts: [] as Array<{ evidenceId: string; transcript: string }>,
      findings: deterministic.findings,
      graphNodes: deterministic.graphNodes,
      graphEdges: deterministic.graphEdges,
      limitations: deterministic.limitations,
      alternativeExplanations: deterministic.alternativeExplanations,
      recommendedChecks: deterministic.recommendedChecks,
    };
    let analysisMode: 'hybrid_ai' | 'deterministic_heuristics' = 'deterministic_heuristics';

    if (env.geminiApiKey) {
      try {
        const geminiReport = await analyzeCaseWithGemini({
          caseTitle: full.case.title,
          captionText: full.case.captionText,
          images,
          audios,
          videos,
          documents,
        });
        analysisMode = 'hybrid_ai';
        report = {
          ...geminiReport,
          findings:
            geminiReport.findings.length > 0 ? geminiReport.findings : deterministic.findings,
          graphNodes:
            geminiReport.graphNodes.length > 0
              ? geminiReport.graphNodes
              : deterministic.graphNodes,
          graphEdges:
            geminiReport.graphEdges.length > 0
              ? geminiReport.graphEdges
              : deterministic.graphEdges,
          limitations:
            geminiReport.limitations.length > 0
              ? geminiReport.limitations
              : deterministic.limitations,
          alternativeExplanations:
            geminiReport.alternativeExplanations.length > 0
              ? geminiReport.alternativeExplanations
              : deterministic.alternativeExplanations,
          recommendedChecks:
            geminiReport.recommendedChecks.length > 0
              ? geminiReport.recommendedChecks
              : deterministic.recommendedChecks,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gemini upstream error';
        console.warn('[analyze fallback to deterministic]', msg);
        report.limitations = [
          ...deterministic.limitations,
          `Gemini multimodal synthesis skipped/unavailable (${msg.slice(0, 120)}); assessment reflects deterministic signal heuristics and metadata correlation only.`,
        ];
      }
    } else {
      report.limitations = [
        ...deterministic.limitations,
        'GEMINI_API_KEY is not configured in server secrets; analysis used deterministic signal heuristics and cross-modal metadata correlation.',
      ];
    }

    const now = Date.now();
    await db
      .update(cases)
      .set({
        riskLevel: report.riskLevel,
        confidenceMin: report.confidenceMin,
        confidenceMax: report.confidenceMax,
        summary: report.summary,
        analysisMode,
        analysisStale: 0,
        correlationsJson: JSON.stringify(deterministic.correlations),
        manipulationJson: JSON.stringify(deterministic.manipulationIndicators),
        limitationsJson: JSON.stringify(report.limitations),
        alternativesJson: JSON.stringify(report.alternativeExplanations),
        recommendedChecksJson: JSON.stringify(report.recommendedChecks),
        updatedAt: now,
      })
      .where(eq(cases.id, caseId));

    for (const tr of report.audioTranscripts) {
      await db
        .update(evidenceItems)
        .set({ transcript: tr.transcript })
        .where(and(eq(evidenceItems.id, tr.evidenceId), eq(evidenceItems.caseId, caseId)));
    }

    // Replace findings & graph for this case cleanly
    await db.delete(findings).where(eq(findings.caseId, caseId));
    await db.delete(graphNodes).where(eq(graphNodes.caseId, caseId));
    await db.delete(graphEdges).where(eq(graphEdges.caseId, caseId));

    if (report.findings.length > 0) {
      await db.insert(findings).values(
        report.findings.map((f, idx) => ({
          id: crypto.randomUUID(),
          caseId,
          evidenceId: f.evidenceId || null,
          modality: f.modality,
          indicator: f.indicator,
          whyFlagged: f.whyFlagged,
          locationOrTimestamp: f.locationOrTimestamp,
          confidenceRange: f.confidenceRange,
          limitation: f.limitation,
          severity: f.severity,
          createdAt: now + idx,
        })),
      );
    }

    if (report.graphNodes.length > 0) {
      await db.insert(graphNodes).values(
        report.graphNodes.map((n) => ({
          id: crypto.randomUUID(),
          caseId,
          nodeKey: n.nodeKey,
          label: n.label,
          nodeType: n.nodeType,
          modality: n.modality,
          details: n.details,
        })),
      );
    }

    if (report.graphEdges.length > 0) {
      await db.insert(graphEdges).values(
        report.graphEdges.map((e) => ({
          id: crypto.randomUUID(),
          caseId,
          sourceKey: e.sourceKey,
          targetKey: e.targetKey,
          relation: e.relation,
          label: e.label,
          explanation: e.explanation,
          confidenceRange: e.confidenceRange,
          limitation: e.limitation,
        })),
      );
    }

    const bundleDigest = computeSha256(
      Buffer.from(evRows.map((r) => r.sha256).join(':') + ':' + report.summary, 'utf8'),
    );
    await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId: null,
      action: 'FORENSIC_ANALYSIS_COMMIT',
      fileSha256: bundleDigest,
      transferredBy: req.user!.displayName,
      transferReason: `${analysisMode} synthesis committed`,
      createdAt: now,
    });

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: 'ANALYSIS_COMPLETED',
      summary: `${analysisMode} completed (${report.riskLevel} risk, ${report.confidenceMin}–${report.confidenceMax}%)`,
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'FORENSIC_ANALYZE',
      resourceType: 'case',
      resourceId: caseId,
      details: `${analysisMode} synthesis completed (risk=${report.riskLevel}, range=${report.confidenceMin}-${report.confidenceMax}%)`,
    });

    // Fire registered alerts cleanly in background (never blocks response or fakes delivery)
    const participantIds = [full.case.userId, full.case.assignedInvestigatorId, req.user!.id];
    dispatchCaseNotificationToParticipants({
      userIds: participantIds,
      caseId,
      caseTitle: full.case.title,
      eventType: 'analysis_completed',
      summaryLine: `${report.riskLevel} risk indicator (${report.confidenceMin}%–${report.confidenceMax}%). ${report.summary}`,
    }).catch((err) => console.warn('[alert dispatch error]', err));

    if (report.riskLevel === 'High') {
      dispatchCaseNotificationToParticipants({
        userIds: participantIds,
        caseId,
        caseTitle: full.case.title,
        eventType: 'high_risk_indicator',
        summaryLine: `High-risk forensic indicator flagged (${report.confidenceMin}%–${report.confidenceMax}%): ${report.summary}`,
      }).catch((err) => console.warn('[high-risk dispatch error]', err));
    }

    const updated = await loadFullCaseAuthorized(caseId, req.user!);
    broadcastLiveEvent({ type: 'case:updated', caseId, data: updated });
    res.json(updated);
  }),
);

// Live Web Grounding & Citation Claim Verifier (Gemini Google Search + URL Context)
app.post(
  '/api/cases/:caseId/verify-web',
  requireAuth,
  requireCsrf,
  aiLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    if (!canRunAnalysis(req.user)) {
      res.status(403).json({ error: 'Investigator privileges required to verify claims online.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed || !access.canWrite) {
      res.status(403).json({ error: 'Access denied or read-only case access.' });
      return;
    }
    const full = await loadFullCaseAuthorized(caseId, req.user!);
    if (!full) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const verifyBodySchema = z.object({
      claimQuery: z.string().max(600).optional().default(''),
      urls: z.array(z.string().trim().max(2048)).max(5).optional().default([]),
    });
    const parsed = verifyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid web verification query payload.' });
      return;
    }

    const safeInputUrls = parsed.data.urls.filter((u) => /^https?:\/\//i.test(u));
    const ingestedUrls: string[] = [];
    for (const ev of full.evidence) {
      if (ev.sourceType === 'url_ingest' && ev.metrics && typeof ev.metrics === 'object') {
        const metricsMap = ev.metrics as Record<string, unknown>;
        const u = metricsMap.finalUrl || metricsMap.sourceUrl;
        if (typeof u === 'string' && /^https?:\/\//i.test(u)) {
          ingestedUrls.push(u);
        }
      }
    }
    const mergedUrls = Array.from(new Set([...safeInputUrls, ...ingestedUrls])).slice(0, 4);
    const customQuery = parsed.data.claimQuery ? sanitizeText(parsed.data.claimQuery, 600) : '';

    const record = await verifyClaimsWithWebGrounding({
      caseTitle: full.case.title,
      captionText: full.case.captionText || full.case.description || '',
      incidentLocation: full.case.incidentLocation || '',
      incidentDate: full.case.incidentDate || '',
      customQuery: customQuery || undefined,
      sourceUrls: mergedUrls,
    });

    const caseRow = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    let existingRecords: unknown[] = [];
    try {
      const parsedExisting = JSON.parse(caseRow[0]?.webVerificationsJson || '[]');
      if (Array.isArray(parsedExisting)) existingRecords = parsedExisting;
    } catch {
      existingRecords = [];
    }
    const nextRecords = [record, ...existingRecords].slice(0, 10);
    const now = Date.now();

    await db
      .update(cases)
      .set({
        webVerificationsJson: JSON.stringify(nextRecords),
        updatedAt: now,
      })
      .where(eq(cases.id, caseId));

    const digest = computeSha256(Buffer.from(JSON.stringify(record), 'utf8'));
    await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId: null,
      action: 'WEB_PROVENANCE_VERIFY',
      fileSha256: digest,
      transferredBy: req.user!.displayName,
      transferReason: `Web claim verification (${record.mode}, ${record.citations.length} citations)`,
      createdAt: now,
    });

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: 'WEB_PROVENANCE_VERIFIED',
      summary: `Executed web grounding verification (${record.citations.length} source citations, mode=${record.mode})`,
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'WEB_CLAIM_VERIFY',
      resourceType: 'case',
      resourceId: caseId,
      details: `Web grounding query executed (${record.citations.length} citations)`,
    });

    const updated = await loadFullCaseAuthorized(caseId, req.user!);
    broadcastLiveEvent({ type: 'case:updated', caseId, data: updated });
    res.json({
      ...updated,
      latestVerification: record,
    });
  }),
);

// Cross-case 64-bit Perceptual Hash (dHash) Reuse Radar (RBAC-scoped)
app.get(
  '/api/cases/:caseId/provenance-radar',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    const radar = await findCrossCaseProvenanceMatches(caseId, req.user!);
    res.json(radar);
  }),
);

// Verify Tamper-Evident Chain of Custody
app.post(
  '/api/cases/:caseId/verify-ledger',
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const result = await verifyCaseLedger(caseId);
    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'LEDGER_VERIFY',
      resourceType: 'case',
      resourceId: caseId,
      details: `Verified custody ledger (valid=${result.valid}, entries=${result.entriesChecked})`,
    });

    if (!result.valid) {
      const caseRow = await db
        .select({ title: cases.title, userId: cases.userId, assignedInvestigatorId: cases.assignedInvestigatorId })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (caseRow.length > 0) {
        dispatchCaseNotificationToParticipants({
          userIds: [caseRow[0].userId, caseRow[0].assignedInvestigatorId, req.user!.id],
          caseId,
          caseTitle: caseRow[0].title,
          eventType: 'evidence_integrity_failed',
          summaryLine: `Integrity verification detected ${result.mismatches.length} mismatch(es): ${result.mismatches[0] || 'Custody ledger broken.'}`,
        }).catch(() => {});
      }
    }

    res.json(result);
  }),
);

// Commit Human Investigator Verification & Check-Offs to Custody Ledger
app.post(
  '/api/cases/:caseId/human-review',
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    if (!canApproveReview(req.user)) {
      res.status(403).json({ error: 'Investigator role required to sign off human verification.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed || !access.canWrite) {
      res.status(403).json({ error: 'Access denied or read-only access.' });
      return;
    }

    const parsed = humanReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid human verification payload.' });
      return;
    }

    const now = Date.now();
    const reviewPayload = {
      status: parsed.data.status,
      reviewerNote: sanitizeText(parsed.data.reviewerNote, 1500),
      checkedItems: parsed.data.checkedItems.map((c) => sanitizeText(c, 400)).filter(Boolean),
      findingDecisions: parsed.data.findingDecisions,
      signedOffBy: req.user!.displayName,
      signedOffAt: now,
    };

    const reviewJson = JSON.stringify(reviewPayload);
    await db
      .update(cases)
      .set({ humanReviewJson: reviewJson, updatedAt: now })
      .where(eq(cases.id, caseId));

    const reviewDigest = computeSha256(Buffer.from(reviewJson, 'utf8'));
    await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId: null,
      action: 'HUMAN_REVIEW_COMMIT',
      fileSha256: reviewDigest,
      transferredBy: req.user!.displayName,
      approvalSignature: `${req.user!.displayName} (${req.user!.role})`,
      transferReason: `Human review status: ${reviewPayload.status}`,
      createdAt: now,
    });

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: 'HUMAN_REVIEW_SIGNED',
      summary: `Signed human verification (${reviewPayload.status}, ${reviewPayload.checkedItems.length} checks)`,
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'HUMAN_REVIEW',
      resourceType: 'case',
      resourceId: caseId,
      details: `Investigator verification saved (status=${reviewPayload.status}, checked=${reviewPayload.checkedItems.length})`,
    });

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    res.json(full);
  }),
);

// Multilingual Voice Forensic Agent
app.post(
  '/api/cases/:caseId/agent',
  requireAuth,
  requireCsrf,
  aiLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const parsed = agentChatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid agent prompt or language.' });
      return;
    }

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    if (!full) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const reportContext: StoredReportContext = {
      caseTitle: full.case.title,
      riskLevel: full.case.riskLevel,
      confidenceMin: full.case.confidenceMin,
      confidenceMax: full.case.confidenceMax,
      summary: full.case.summary,
      captionText: full.case.captionText,
      findings: full.findings.map((f) => ({
        id: f.id,
        modality: f.modality,
        indicator: f.indicator,
        whyFlagged: f.whyFlagged,
        locationOrTimestamp: f.locationOrTimestamp,
        confidenceRange: f.confidenceRange,
        limitation: f.limitation,
      })),
      edges: full.graph.edges.map((e) => ({
        sourceKey: e.sourceKey,
        targetKey: e.targetKey,
        relation: e.relation,
        label: e.label,
        explanation: e.explanation,
      })),
      limitations: full.case.limitations,
      alternativeExplanations: full.case.alternativeExplanations,
      recommendedChecks: full.case.recommendedChecks,
    };

    const cleanQuestion = sanitizeText(parsed.data.question, 1000);
    const history = full.agentMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    let agentRes: { reply: string; citedFindingIds: string[] };
    let responseMode: 'ai' | 'deterministic_fallback' = 'ai';
    let notice: string | null = null;

    if (env.geminiApiKey) {
      try {
        agentRes = await runForensicAgentChat({
          report: reportContext,
          userQuestion: cleanQuestion,
          language: parsed.data.language,
          devilsAdvocate: parsed.data.devilsAdvocate,
          history,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Agent request failed.';
        console.warn('[agent fallback to local dossier]', msg);
        responseMode = 'deterministic_fallback';
        notice = `Gemini API unavailable (${msg.slice(0, 100)}); answered from stored local forensic dossier.`;
        agentRes = buildDeterministicAgentBriefing({
          report: reportContext,
          userQuestion: cleanQuestion,
          language: parsed.data.language,
          devilsAdvocate: parsed.data.devilsAdvocate,
        });
      }
    } else {
      responseMode = 'deterministic_fallback';
      notice = 'GEMINI_API_KEY is not configured; answered from stored local forensic dossier.';
      agentRes = buildDeterministicAgentBriefing({
        report: reportContext,
        userQuestion: cleanQuestion,
        language: parsed.data.language,
        devilsAdvocate: parsed.data.devilsAdvocate,
      });
    }

    const now = Date.now();
    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();

    await db.insert(agentMessages).values([
      {
        id: userMsgId,
        caseId,
        userId: req.user!.id,
        role: 'user',
        language: parsed.data.language,
        devilsAdvocate: parsed.data.devilsAdvocate ? 1 : 0,
        content: cleanQuestion,
        citedFindingIdsJson: '[]',
        createdAt: now,
      },
      {
        id: assistantMsgId,
        caseId,
        userId: req.user!.id,
        role: 'assistant',
        language: parsed.data.language,
        devilsAdvocate: parsed.data.devilsAdvocate ? 1 : 0,
        content: agentRes.reply,
        citedFindingIdsJson: JSON.stringify(agentRes.citedFindingIds),
        createdAt: now + 1,
      },
    ]);

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'VOICE_AGENT_QUERY',
      resourceType: 'case',
      resourceId: caseId,
      details: `Voice agent query (${responseMode}) in ${parsed.data.language} (devilsAdvocate=${parsed.data.devilsAdvocate})`,
    });

    res.json({
      reply: agentRes.reply,
      citedFindingIds: agentRes.citedFindingIds,
      language: parsed.data.language,
      devilsAdvocate: parsed.data.devilsAdvocate,
      mode: responseMode,
      notice,
    });
  }),
);

// --- Real-Time Community Calibration Voting Loop (IDOR-Protected) ---
app.get('/api/community/votes', asyncHandler(async (req, res) => {
  const topicKey = sanitizeText(String(req.query.topicKey || PUBLIC_BENCHMARK_TOPIC), 80);
  if (topicKey !== PUBLIC_BENCHMARK_TOPIC) {
    const resolved = await resolveSessionUser(req);
    if (!resolved) {
      res.status(401).json({ error: 'Authentication required to view case-scoped calibration votes.' });
      return;
    }
    if (topicKey.startsWith('case-')) {
      const scopedCaseId = topicKey.slice(5);
      const access = await getUserCaseAccess(scopedCaseId, resolved.user);
      if (!access.allowed) {
        res.status(403).json({ error: 'Access denied to this case calibration stream.' });
        return;
      }
    }
  }
  const summary = await getCommunitySummary(topicKey);
  res.json(summary);
}));

app.post('/api/community/votes', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = communityVoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid community calibration vote payload.' });
    return;
  }

  const topicKey = sanitizeText(parsed.data.topicKey, 80);
  if (topicKey.startsWith('case-')) {
    const scopedCaseId = topicKey.slice(5);
    const access = await getUserCaseAccess(scopedCaseId, req.user!);
    if (!access.allowed) {
      res.status(403).json({ error: 'Access denied to submit calibration votes on this case.' });
      return;
    }
  }
  const rationale = sanitizeText(parsed.data.rationale, 400);

  await db.insert(communityVotes).values({
    id: crypto.randomUUID(),
    topicKey,
    userId: req.user!.id,
    voterName: req.user!.displayName,
    stance: parsed.data.stance,
    rationale,
    createdAt: Date.now(),
  });

  await recordAuditEvent({
    req,
    userId: req.user!.id,
    action: 'COMMUNITY_VOTE',
    resourceType: 'community_vote',
    resourceId: topicKey,
    details: `Submitted calibration stance: ${parsed.data.stance}`,
  });

  const summary = await getCommunitySummary(topicKey);
  broadcastCommunityUpdate(topicKey, summary);
  res.status(201).json(summary);
}));

// Notification routes are registered via server/routes/notificationRoutes.ts

// --- QR Code Case Share Tokens (Permission-scoped signed read-only summaries) ---
function hashShareToken(rawToken: string): string {
  return crypto.createHmac('sha256', env.sessionSecret).update(rawToken).digest('hex');
}

app.get('/api/cases/:caseId/share-tokens', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const caseId = String(req.params.caseId);
  const access = await getUserCaseAccess(caseId, req.user!);
  if (!access.allowed) {
    res.status(404).json({ error: 'Case not found.' });
    return;
  }
  const tokens = await db
    .select()
    .from(caseShareTokens)
    .where(eq(caseShareTokens.caseId, caseId))
    .orderBy(desc(caseShareTokens.createdAt));

  res.json({
    tokens: tokens.map((t) => {
      let permissions = {
        summary: true,
        findings: true,
        evidenceInventory: true,
        custodyDigest: true,
        timeline: false,
      };
      try {
        permissions = { ...permissions, ...JSON.parse(t.permissionsJson || '{}') };
      } catch {
        // default permissions
      }
      return {
        id: t.id,
        label: t.label,
        permissions,
        accessCount: t.accessCount || 0,
        lastAccessedAt: t.lastAccessedAt || null,
        expiresAt: t.expiresAt,
        revoked: t.revoked === 1,
        createdAt: t.createdAt,
      };
    }),
  });
}));

app.post('/api/cases/:caseId/share-token', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
  const caseId = String(req.params.caseId);
  if (!canShareQr(req.user)) {
    res.status(403).json({ error: 'Viewers and witnesses cannot generate QR share links.' });
    return;
  }
  const access = await getUserCaseAccess(caseId, req.user!);
  if (!access.allowed || !access.canWrite) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }
  const parsed = shareTokenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid share token parameters.' });
    return;
  }

  const rawToken = crypto.randomBytes(24).toString('base64url');
  const tokenHash = hashShareToken(rawToken);
  const now = Date.now();
  const expiresAt = now + parsed.data.expiresHours * 60 * 60 * 1000;
  const id = crypto.randomUUID();
  const permissions = {
    summary: parsed.data.permissions?.summary ?? true,
    findings: parsed.data.permissions?.findings ?? true,
    evidenceInventory: parsed.data.permissions?.evidenceInventory ?? true,
    custodyDigest: parsed.data.permissions?.custodyDigest ?? true,
    timeline: parsed.data.permissions?.timeline ?? false,
  };

  await db.insert(caseShareTokens).values({
    id,
    caseId,
    userId: req.user!.id,
    tokenHash,
    label: sanitizeText(parsed.data.label, 80),
    permissionsJson: JSON.stringify(permissions),
    accessCount: 0,
    lastAccessedAt: null,
    expiresAt,
    revoked: 0,
    createdAt: now,
  });

  await recordCaseActivity({
    caseId,
    userId: req.user!.id,
    actorName: req.user!.displayName,
    action: 'QR_SHARE_CREATED',
    summary: `Generated QR access link "${sanitizeText(parsed.data.label, 80)}" (${parsed.data.expiresHours}h)`,
  });

  await recordAuditEvent({
    req,
    userId: req.user!.id,
    action: 'CASE_SHARE_TOKEN_CREATE',
    resourceType: 'case',
    resourceId: caseId,
    details: `Created permission-scoped QR share token (${parsed.data.expiresHours}h expiry)`,
  });

  const proto =
    typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0].trim()
      : req.protocol || 'http';
  const host =
    (typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim()
      : req.headers.host) || '';
  const originBase = env.qrBaseUrl || env.appUrl || (host ? `${proto}://${host}` : '');
  const shareUrl = originBase
    ? `${originBase.replace(/\/$/, '')}/?share=${encodeURIComponent(rawToken)}`
    : `/?share=${encodeURIComponent(rawToken)}`;

  res.status(201).json({
    id,
    token: rawToken,
    shareUrl,
    label: sanitizeText(parsed.data.label, 80),
    permissions,
    expiresAt,
    createdAt: now,
  });
}));

app.delete('/api/cases/:caseId/share-tokens/:tokenId', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
  const caseId = String(req.params.caseId);
  const tokenId = String(req.params.tokenId);
  const access = await getUserCaseAccess(caseId, req.user!);
  if (!access.allowed || !access.canWrite) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }
  await db
    .update(caseShareTokens)
    .set({ revoked: 1 })
    .where(and(eq(caseShareTokens.id, tokenId), eq(caseShareTokens.caseId, caseId)));

  await recordAuditEvent({
    req,
    userId: req.user!.id,
    action: 'CASE_SHARE_TOKEN_REVOKED',
    resourceType: 'case_share_token',
    resourceId: tokenId,
    details: `Revoked QR share token for case ${caseId}`,
  });
  res.json({ ok: true });
}));

app.get('/api/shared-case/:token', shareLookupLimiter, asyncHandler(async (req, res) => {
  const rawToken = String(req.params.token || '').trim();
  if (!rawToken || rawToken.length < 16) {
    res.status(404).json({ error: 'Invalid QR share link format.', code: 'INVALID' });
    return;
  }
  const tokenHash = hashShareToken(rawToken);
  const rows = await db
    .select()
    .from(caseShareTokens)
    .where(eq(caseShareTokens.tokenHash, tokenHash))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: 'This QR share link does not exist or has been removed.', code: 'NOT_FOUND' });
    return;
  }
  const tokenRow = rows[0];
  if (tokenRow.revoked === 1) {
    res.status(410).json({ error: 'This QR share link was revoked by the investigator.', code: 'REVOKED' });
    return;
  }
  if (Date.now() > tokenRow.expiresAt) {
    res.status(410).json({ error: 'This QR share link has expired.', code: 'EXPIRED' });
    return;
  }

  const full = await loadFullCaseAuthorized(tokenRow.caseId, null, { bypassAclForShare: true });
  if (!full) {
    res.status(404).json({ error: 'Shared case no longer exists.', code: 'CASE_MISSING' });
    return;
  }

  let permissions = {
    summary: true,
    findings: true,
    evidenceInventory: true,
    custodyDigest: true,
    timeline: false,
  };
  try {
    permissions = { ...permissions, ...JSON.parse(tokenRow.permissionsJson || '{}') };
  } catch {
    // default permissions
  }

  await db
    .update(caseShareTokens)
    .set({
      accessCount: (tokenRow.accessCount || 0) + 1,
      lastAccessedAt: Date.now(),
    })
    .where(eq(caseShareTokens.id, tokenRow.id));

  // Strictly scoped read-only dossier (never exposes private files, agent chat, or witness PII)
  res.json({
    shareLabel: tokenRow.label,
    expiresAt: tokenRow.expiresAt,
    permissions,
    case: {
      id: full.case.id,
      caseNumber: full.case.caseNumber,
      title: full.case.title,
      description: permissions.summary ? full.case.description : '',
      category: full.case.category,
      categoryName: full.case.categoryName,
      status: full.case.status,
      priority: full.case.priority,
      incidentLocation: permissions.summary ? full.case.incidentLocation : '',
      incidentDate: permissions.summary ? full.case.incidentDate : '',
      captionText: permissions.summary ? full.case.captionText : '',
      riskLevel: full.case.riskLevel,
      confidenceMin: full.case.confidenceMin,
      confidenceMax: full.case.confidenceMax,
      summary: permissions.summary
        ? full.case.summary
        : 'Executive summary restricted by QR share permissions.',
      analysisMode: full.case.analysisMode,
      limitations: permissions.summary ? full.case.limitations : [],
      alternativeExplanations: permissions.findings ? full.case.alternativeExplanations : [],
      recommendedChecks: permissions.findings ? full.case.recommendedChecks : [],
      humanReview: permissions.summary ? full.case.humanReview : undefined,
      updatedAt: full.case.updatedAt,
    },
    evidenceDigest: permissions.evidenceInventory
      ? full.evidence.map((e) => ({
          id: e.id,
          modality: e.modality,
          sourceType: e.sourceType,
          originalFilename: e.originalFilename,
          byteSize: e.byteSize,
          sha256: e.sha256,
        }))
      : [],
    findings: permissions.findings ? full.findings : [],
    correlations: permissions.findings ? (full.correlations ?? []) : [],
    ledgerSummary: permissions.custodyDigest
      ? {
          entriesCount: full.ledger.length,
          headHash: full.ledger.length > 0 ? full.ledger[full.ledger.length - 1].entryHash : null,
        }
      : {
          entriesCount: 0,
          headHash: null,
        },
    timeline: permissions.timeline
      ? full.activity.slice(0, 20).map((a) => ({
          id: a.id,
          action: a.action,
          summary: a.summary,
          createdAt: a.createdAt,
        }))
      : [],
  });
}));

async function startServer() {
  await ensureDefaultCaseCategories();

  // Unknown /api/* routes always return structured 404 JSON rather than falling through to SPA HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (!env.isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { dotfiles: 'deny' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Generic error handler (never leaks stack traces to client)
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Malformed JSON request body.' });
      return;
    }
    console.error('[unhandled error]', err instanceof Error ? err.message : err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'An internal server error occurred.' });
    }
  });

  httpServer.listen(env.port, '0.0.0.0', () => {
    console.log(`TruthLens server listening on http://0.0.0.0:${env.port} (${env.nodeEnv})`);
  });
}

startServer().catch((err) => {
  console.error('Fatal startup failure:', err);
  process.exit(1);
});
