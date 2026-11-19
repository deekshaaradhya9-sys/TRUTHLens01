import crypto from 'node:crypto';
import type { Express } from 'express';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  caseActivity,
  caseCategories,
  caseCollaborators,
  caseComments,
  cases,
  custodyLedger,
  evidenceItems,
  users,
  witnesses,
} from '../db/schema.ts';
import { loadFullCaseAuthorized, recordCaseActivity } from '../forensics/caseLoader.ts';
import {
  runInvestigationAssistantTask,
  type SupportedLanguageCode,
} from '../forensics/geminiForensics.ts';
import {
  createInAppNotification,
  dispatchCaseAlerts,
  dispatchCaseNotificationToParticipants,
  sendTransactionalAccountEmail,
} from '../notifications/notifier.ts';
import { recordAuditEvent } from '../security/audit.ts';
import { type AuthedRequest, asyncHandler, requireAdmin, requireAuth, requireCsrf } from '../security/auth.ts';
import {
  CASE_PRIORITIES,
  CASE_STATUSES,
  canAssignInvestigator,
  canEditCaseDetails,
  canManageCategories,
  canManageWitnesses,
  canViewWitnessPii,
  getUserCaseAccess,
  isAdminRole,
  normalizeRole,
} from '../security/roles.ts';
import { sanitizeText } from '../security/sanitize.ts';

const updateCaseSchema = z.object({
  title: z.string().min(3).max(140).optional(),
  description: z.string().max(600).optional(),
  category: z.string().min(2).max(60).optional(),
  status: z.enum(CASE_STATUSES).optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  incidentLocation: z.string().max(240).optional(),
  incidentDate: z.string().max(40).optional(),
  notes: z.string().max(3000).optional(),
  closingSummary: z.string().max(3000).optional(),
  relatedPersons: z
    .array(z.object({ name: z.string().max(80), role: z.string().max(60) }))
    .max(25)
    .optional(),
  categoryFields: z.record(z.string().max(60), z.string().max(500)).optional(),
});

const assignCaseSchema = z.object({
  investigatorId: z.string().min(8).max(80),
  accessRole: z.enum(['investigator', 'senior_investigator', 'evidence_officer', 'viewer']).optional().default('investigator'),
});

const witnessSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email().max(160).optional().or(z.literal('')).default(''),
  phone: z.string().max(30).optional().default(''),
  address: z.string().max(300).optional().default(''),
  relationship: z.string().min(2).max(80).default('witness'),
  statement: z.string().max(3000).default(''),
  consentGranted: z.boolean().default(true),
  privacyRedacted: z.boolean().default(true),
  verificationStatus: z.enum(['unverified', 'pending', 'verified']).default('pending'),
  linkedEvidenceIds: z.array(z.string().max(80)).max(20).default([]),
});

const commentSchema = z.object({
  body: z.string().min(1).max(2000),
});

const categorySchema = z.object({
  slug: z.string().min(2).max(60).regex(/^[a-z0-9_]+$/),
  name: z.string().min(2).max(80),
  description: z.string().max(400).default(''),
  fields: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        label: z.string().min(1).max(60),
        type: z.enum(['text', 'date', 'select']).default('text'),
        placeholder: z.string().max(120).optional(),
        options: z.array(z.string().max(60)).optional(),
      }),
    )
    .max(15)
    .default([]),
  evidenceRequirements: z.array(z.string().max(160)).max(15).default([]),
  reportTemplateNote: z.string().max(500).default(''),
  enabled: z.boolean().default(true),
});

const assistantTaskSchema = z.object({
  task: z.enum(['summarize_case', 'draft_report', 'missing_docs', 'highlight_inconsistencies']),
  language: z.enum(['en', 'hi', 'kn', 'ta', 'te', 'ml']).default('en'),
});

export function registerCaseManagementRoutes(
  app: Express,
  broadcastLiveEvent: (event: { type: string; caseId?: string; userId?: string; data: unknown }) => void,
) {
  // --- Categories (20 defaults + admin CRUD) ---
  app.get('/api/categories', asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(caseCategories)
      .where(eq(caseCategories.enabled, 1))
      .orderBy(asc(caseCategories.name));

    res.json({
      categories: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        fields: JSON.parse(r.fieldSchemaJson || '[]'),
        evidenceRequirements: JSON.parse(r.evidenceRequirementsJson || '[]'),
        reportTemplateNote: r.reportTemplateNote,
        isDefault: r.isDefault === 1,
        enabled: r.enabled === 1,
      })),
    });
  }));

  app.get('/api/admin/categories', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
    const rows = await db.select().from(caseCategories).orderBy(asc(caseCategories.name));
    res.json({
      categories: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        fields: JSON.parse(r.fieldSchemaJson || '[]'),
        evidenceRequirements: JSON.parse(r.evidenceRequirementsJson || '[]'),
        reportTemplateNote: r.reportTemplateNote,
        isDefault: r.isDefault === 1,
        enabled: r.enabled === 1,
      })),
    });
  }));

  app.post('/api/admin/categories', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    if (!canManageCategories(req.user)) {
      res.status(403).json({ error: 'Administrator privileges required to manage categories.' });
      return;
    }
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid category payload (slug must be lowercase alphanumeric/underscore).' });
      return;
    }
    const existing = await db
      .select()
      .from(caseCategories)
      .where(eq(caseCategories.slug, parsed.data.slug))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: 'A category with this slug already exists.' });
      return;
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    await db.insert(caseCategories).values({
      id,
      slug: parsed.data.slug,
      name: sanitizeText(parsed.data.name, 80),
      description: sanitizeText(parsed.data.description, 400),
      fieldSchemaJson: JSON.stringify(parsed.data.fields),
      evidenceRequirementsJson: JSON.stringify(parsed.data.evidenceRequirements),
      reportTemplateNote: sanitizeText(parsed.data.reportTemplateNote, 500),
      isDefault: 0,
      enabled: parsed.data.enabled ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'CATEGORY_CREATE',
      resourceType: 'case_category',
      resourceId: id,
      details: `Created case category "${parsed.data.name}"`,
    });
    res.status(201).json({ ok: true, id });
  }));

  app.patch('/api/admin/categories/:id', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    if (!canManageCategories(req.user)) {
      res.status(403).json({ error: 'Administrator privileges required to update categories.' });
      return;
    }
    const catId = String(req.params.id);
    const existing = await db.select().from(caseCategories).where(eq(caseCategories.id, catId)).limit(1);
    if (existing.length === 0) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (typeof req.body?.name === 'string' && req.body.name.trim().length >= 2) {
      updates.name = sanitizeText(req.body.name, 80);
    }
    if (typeof req.body?.description === 'string') {
      updates.description = sanitizeText(req.body.description, 400);
    }
    if (typeof req.body?.enabled === 'boolean') {
      updates.enabled = req.body.enabled ? 1 : 0;
    }
    if (typeof req.body?.reportTemplateNote === 'string') {
      updates.reportTemplateNote = sanitizeText(req.body.reportTemplateNote, 500);
    }
    await db.update(caseCategories).set(updates).where(eq(caseCategories.id, catId));
    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'CATEGORY_UPDATE',
      resourceType: 'case_category',
      resourceId: catId,
      details: `Updated category ${existing[0].slug}`,
    });
    res.json({ ok: true });
  }));

  // --- Investigation Intelligence Dashboard ---
  app.get('/api/intelligence/summary', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const user = req.user!;
    const admin = isAdminRole(user);

    let accessibleCases = await db.select().from(cases).orderBy(desc(cases.updatedAt));
    if (!admin) {
      const collabIds = (
        await db
          .select({ caseId: caseCollaborators.caseId })
          .from(caseCollaborators)
          .where(eq(caseCollaborators.userId, user.id))
      ).map((r) => r.caseId);
      const witnessCaseIds = (
        await db
          .select({ caseId: witnesses.caseId })
          .from(witnesses)
          .where(or(eq(witnesses.userId, user.id), eq(witnesses.email, user.email)))
      ).map((r) => r.caseId);
      const allowedSet = new Set([...collabIds, ...witnessCaseIds]);
      accessibleCases = accessibleCases.filter(
        (c) => c.userId === user.id || c.assignedInvestigatorId === user.id || allowedSet.has(c.id),
      );
    }

    const totalCases = accessibleCases.length;
    const closedStatuses = new Set(['resolved', 'closed', 'archived']);
    const activeCases = accessibleCases.filter((c) => !closedStatuses.has(c.status || 'registered')).length;
    const closedCases = accessibleCases.filter((c) => closedStatuses.has(c.status || 'registered')).length;
    const pendingReviews = accessibleCases.filter((c) => {
      try {
        const rev = JSON.parse(c.humanReviewJson || '{}');
        return !rev.status || rev.status === 'pending' || c.analysisStale === 1;
      } catch {
        return true;
      }
    }).length;
    const assignedToMe = accessibleCases.filter((c) => c.assignedInvestigatorId === user.id).length;

    const priorityCounts = { low: 0, medium: 0, high: 0, critical: 0 };
    const statusCounts: Record<string, number> = {};
    for (const c of accessibleCases) {
      const p = (c.priority || 'medium') as keyof typeof priorityCounts;
      if (p in priorityCounts) priorityCounts[p] += 1;
      const st = c.status || 'registered';
      statusCounts[st] = (statusCounts[st] ?? 0) + 1;
    }

    const caseIds = accessibleCases.map((c) => c.id);
    let recentActivity: Array<{
      id: string;
      caseId: string;
      actorName: string;
      action: string;
      summary: string;
      createdAt: number;
    }> = [];
    if (caseIds.length > 0) {
      recentActivity = await db
        .select()
        .from(caseActivity)
        .where(inArray(caseActivity.caseId, caseIds.slice(0, 40)))
        .orderBy(desc(caseActivity.createdAt))
        .limit(15);
    }

    const activeInvestigatorIds = Array.from(
      new Set(accessibleCases.map((c) => c.assignedInvestigatorId).filter(Boolean) as string[]),
    );

    res.json({
      totalCases,
      activeCases,
      closedCases,
      pendingReviews,
      assignedToMe,
      assignedInvestigatorsCount: activeInvestigatorIds.length,
      priorityCounts,
      statusCounts,
      recentActivity,
    });
  }));

  // --- Investigator Directory (for Case Assignment) ---
  app.get('/api/investigators', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const role = normalizeRole(req.user!.role);
    if (role === 'viewer' || role === 'witness') {
      res.status(403).json({ error: 'Insufficient permissions to view staff directory.' });
      return;
    }
    const staff = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        role: users.role,
        department: users.department,
        badgeId: users.badgeId,
      })
      .from(users)
      .where(eq(users.active, 1));

    res.json({
      investigators: staff.filter((u) => {
        const nr = normalizeRole(u.role);
        return nr !== 'viewer' && nr !== 'witness';
      }),
    });
  }));

  // --- Export Investigation Register CSV ---
  app.get('/api/cases/export/csv', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const user = req.user!;
    const admin = isAdminRole(user);
    let rows = await db.select().from(cases).orderBy(desc(cases.updatedAt));
    if (!admin) {
      const collabIds = (
        await db
          .select({ caseId: caseCollaborators.caseId })
          .from(caseCollaborators)
          .where(eq(caseCollaborators.userId, user.id))
      ).map((r) => r.caseId);
      const allowedSet = new Set(collabIds);
      rows = rows.filter(
        (c) => c.userId === user.id || c.assignedInvestigatorId === user.id || allowedSet.has(c.id),
      );
    }

    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Case Number',
      'Case ID',
      'Title',
      'Category',
      'Status',
      'Priority',
      'Risk Level',
      'Confidence Range',
      'Incident Location',
      'Incident Date',
      'Registered At',
    ].join(',');
    const lines = rows.map((c) =>
      [
        esc(c.caseNumber || c.id.slice(0, 8)),
        esc(c.id),
        esc(c.title),
        esc(c.category),
        esc(c.status),
        esc(c.priority),
        esc(c.riskLevel),
        esc(`${c.confidenceMin}-${c.confidenceMax}%`),
        esc(c.incidentLocation),
        esc(c.incidentDate),
        esc(new Date(c.registrationDate || c.createdAt).toISOString()),
      ].join(','),
    );

    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="TruthLens_Investigation_Register.csv"');
    res.send(csv);
  }));

  // --- Update Investigation Register Details / Status / Closing Summary ---
  app.patch('/api/cases/:caseId', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    if (!canEditCaseDetails(req.user)) {
      res.status(403).json({ error: 'Your role does not permit editing investigation records.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed || !access.canWrite) {
      res.status(403).json({ error: 'Access denied or read-only case access.' });
      return;
    }

    const parsed = updateCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid case update payload.' });
      return;
    }

    const currentRows = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (currentRows.length === 0) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    const prev = currentRows[0];
    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (parsed.data.title !== undefined) updates.title = sanitizeText(parsed.data.title, 140);
    if (parsed.data.description !== undefined) updates.description = sanitizeText(parsed.data.description, 600);
    if (parsed.data.category !== undefined) updates.category = sanitizeText(parsed.data.category, 60);
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
    if (parsed.data.incidentLocation !== undefined) {
      updates.incidentLocation = sanitizeText(parsed.data.incidentLocation, 240);
    }
    if (parsed.data.incidentDate !== undefined) {
      updates.incidentDate = sanitizeText(parsed.data.incidentDate, 40);
    }
    if (parsed.data.notes !== undefined) updates.notes = sanitizeText(parsed.data.notes, 3000);
    if (parsed.data.closingSummary !== undefined) {
      updates.closingSummary = sanitizeText(parsed.data.closingSummary, 3000);
    }
    if (parsed.data.relatedPersons !== undefined) {
      updates.relatedPersonsJson = JSON.stringify(
        parsed.data.relatedPersons.map((p) => ({
          name: sanitizeText(p.name, 80),
          role: sanitizeText(p.role, 60),
        })),
      );
    }
    if (parsed.data.categoryFields !== undefined) {
      updates.categoryFieldsJson = JSON.stringify(parsed.data.categoryFields);
    }

    await db.update(cases).set(updates).where(eq(cases.id, caseId));

    const statusChanged = parsed.data.status && parsed.data.status !== prev.status;
    const summaryText = statusChanged
      ? `Status changed from ${prev.status} to ${parsed.data.status}`
      : 'Updated investigation metadata / notes';

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: statusChanged ? 'STATUS_CHANGE' : 'CASE_UPDATED',
      summary: summaryText,
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'CASE_UPDATE',
      resourceType: 'case',
      resourceId: caseId,
      details: summaryText,
    });

    if (statusChanged) {
      const isClosed = parsed.data.status === 'closed' || parsed.data.status === 'resolved';
      dispatchCaseNotificationToParticipants({
        userIds: [prev.userId, prev.assignedInvestigatorId],
        caseId,
        caseTitle: (updates.title as string) || prev.title,
        eventType: isClosed ? 'case_closed' : 'case_updated',
        summaryLine: isClosed
          ? `Investigation ${prev.caseNumber || caseId.slice(0, 8)} was marked ${parsed.data.status}.`
          : `Investigation ${prev.caseNumber || caseId.slice(0, 8)} moved from ${prev.status} to ${parsed.data.status}.`,
      }).catch(() => {});
    }

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    broadcastLiveEvent({ type: 'case:updated', caseId, data: full });
    res.json(full);
  }));

  // --- Assign Investigator / Collaborator ---
  app.post('/api/cases/:caseId/assign', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    if (!canAssignInvestigator(req.user)) {
      res.status(403).json({ error: 'Senior investigator or admin role required to assign cases.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const parsed = assignCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid investigator ID required.' });
      return;
    }

    const targetRows = await db
      .select()
      .from(users)
      .where(eq(users.id, parsed.data.investigatorId))
      .limit(1);
    if (targetRows.length === 0) {
      res.status(404).json({ error: 'Target user not found.' });
      return;
    }
    const targetUser = targetRows[0];
    const now = Date.now();

    const caseRows = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    const c = caseRows[0];

    await db
      .update(cases)
      .set({
        assignedInvestigatorId: targetUser.id,
        status: c.status === 'draft' || c.status === 'registered' ? 'assigned' : c.status,
        updatedAt: now,
      })
      .where(eq(cases.id, caseId));

    const existingCollab = await db
      .select()
      .from(caseCollaborators)
      .where(and(eq(caseCollaborators.caseId, caseId), eq(caseCollaborators.userId, targetUser.id)))
      .limit(1);

    if (existingCollab.length === 0) {
      await db.insert(caseCollaborators).values({
        id: crypto.randomUUID(),
        caseId,
        userId: targetUser.id,
        accessRole: parsed.data.accessRole,
        addedBy: req.user!.id,
        createdAt: now,
      });
    } else {
      await db
        .update(caseCollaborators)
        .set({ accessRole: parsed.data.accessRole })
        .where(eq(caseCollaborators.id, existingCollab[0].id));
    }

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: 'INVESTIGATOR_ASSIGNED',
      summary: `Assigned ${targetUser.displayName} (${parsed.data.accessRole}) to ${c.caseNumber || c.title}`,
    });

    await createInAppNotification({
      userId: targetUser.id,
      caseId,
      type: 'case_assigned',
      title: `Assigned to Investigation ${c.caseNumber || ''}`,
      body: `${req.user!.displayName} assigned you to "${c.title}" (${parsed.data.accessRole}).`,
    });

    await sendTransactionalAccountEmail({
      userId: targetUser.id,
      toEmail: targetUser.email,
      caseId,
      eventType: 'case_assigned',
      subject: `TruthLens Assignment — ${c.caseNumber || c.title}`,
      text: `Hello ${targetUser.displayName},\n\nYou have been assigned to investigation "${c.title}" (${c.caseNumber}) by ${req.user!.displayName} with role ${parsed.data.accessRole}.`,
    });

    dispatchCaseAlerts({
      userId: targetUser.id,
      caseId,
      caseTitle: c.title,
      eventType: 'case_assigned',
      summaryLine: `${req.user!.displayName} assigned you to ${c.caseNumber || c.title} (${parsed.data.accessRole}).`,
    }).catch(() => {});

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'CASE_ASSIGN',
      resourceType: 'case',
      resourceId: caseId,
      details: `Assigned ${targetUser.displayName} (${parsed.data.accessRole})`,
    });

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    res.json(full);
  }));

  // --- Witnesses & Persons Registration ---
  app.get('/api/cases/:caseId/witnesses', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const full = await loadFullCaseAuthorized(caseId, req.user!);
    if (!full) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    res.json({ witnesses: full.witnesses });
  }));

  app.post('/api/cases/:caseId/witnesses', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const access = await getUserCaseAccess(caseId, req.user!);
    const role = normalizeRole(req.user!.role);
    // Witnesses can submit their own witness record on a case they have access to; investigators can register any witness
    if (!access.allowed || (!canManageWitnesses(req.user) && role !== 'witness')) {
      res.status(403).json({ error: 'Insufficient permissions to register witness statements.' });
      return;
    }

    const parsed = witnessSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid witness registration details.' });
      return;
    }
    if (!parsed.data.consentGranted) {
      res.status(400).json({ error: 'Explicit witness consent is required before recording statement.' });
      return;
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    const fullName = sanitizeText(parsed.data.fullName, 100);
    const email = parsed.data.email ? parsed.data.email.trim().toLowerCase() : '';
    const phone = sanitizeText(parsed.data.phone, 30);
    const address = sanitizeText(parsed.data.address, 300);
    const relationship = sanitizeText(parsed.data.relationship, 80);
    const statement = sanitizeText(parsed.data.statement, 3000);

    await db.insert(witnesses).values({
      id,
      caseId,
      userId: role === 'witness' ? req.user!.id : null,
      fullName,
      email,
      phone,
      address,
      relationship,
      statement,
      consentGranted: 1,
      privacyRedacted: parsed.data.privacyRedacted ? 1 : 0,
      verificationStatus: canViewWitnessPii(req.user) ? parsed.data.verificationStatus : 'pending',
      linkedEvidenceIdsJson: JSON.stringify(parsed.data.linkedEvidenceIds),
      createdBy: req.user!.id,
      createdAt: now,
      updatedAt: now,
    });

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: 'WITNESS_REGISTERED',
      summary: `Registered ${parsed.data.privacyRedacted ? 'privacy-protected witness' : fullName} (${relationship})`,
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'WITNESS_REGISTER',
      resourceType: 'witness',
      resourceId: id,
      details: `Witness registered for case ${caseId} (redacted=${parsed.data.privacyRedacted})`,
    });

    if (email) {
      await sendTransactionalAccountEmail({
        userId: req.user!.id,
        toEmail: email,
        caseId,
        eventType: 'witness_registered',
        subject: 'TruthLens — Witness Registration Confirmation',
        text: `Hello ${fullName},\n\nYour witness statement has been securely logged under investigation ${caseId.slice(0, 8)} with privacy redaction ${parsed.data.privacyRedacted ? 'ENABLED' : 'STANDARD'}.`,
      });
    }

    const parentCase = await db
      .select({ title: cases.title, userId: cases.userId, assignedInvestigatorId: cases.assignedInvestigatorId })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    if (parentCase.length > 0) {
      dispatchCaseNotificationToParticipants({
        userIds: [parentCase[0].userId, parentCase[0].assignedInvestigatorId],
        caseId,
        caseTitle: parentCase[0].title,
        eventType: 'witness_registered',
        summaryLine: `${req.user!.displayName} registered witness (${relationship}) with explicit consent.`,
      }).catch(() => {});
    }

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    res.status(201).json(full);
  }));

  app.patch('/api/cases/:caseId/witnesses/:witnessId', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const witnessId = String(req.params.witnessId);
    if (!canManageWitnesses(req.user)) {
      res.status(403).json({ error: 'Investigator permissions required to verify witness records.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (['unverified', 'pending', 'verified'].includes(req.body?.verificationStatus)) {
      updates.verificationStatus = req.body.verificationStatus;
    }
    if (typeof req.body?.privacyRedacted === 'boolean') {
      updates.privacyRedacted = req.body.privacyRedacted ? 1 : 0;
    }
    if (typeof req.body?.statement === 'string') {
      updates.statement = sanitizeText(req.body.statement, 3000);
    }

    await db
      .update(witnesses)
      .set(updates)
      .where(and(eq(witnesses.id, witnessId), eq(witnesses.caseId, caseId)));

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: 'WITNESS_UPDATED',
      summary: `Updated witness verification / privacy status (${String(updates.verificationStatus || 'updated')})`,
    });

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    res.json(full);
  }));

  app.delete('/api/cases/:caseId/witnesses/:witnessId', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const witnessId = String(req.params.witnessId);
    if (!canManageWitnesses(req.user)) {
      res.status(403).json({ error: 'Insufficient permissions.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    await db.delete(witnesses).where(and(eq(witnesses.id, witnessId), eq(witnesses.caseId, caseId)));
    const full = await loadFullCaseAuthorized(caseId, req.user!);
    res.json(full);
  }));

  // --- Real-Time Collaboration Comments ---
  app.get('/api/cases/:caseId/comments', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    const rows = await db
      .select()
      .from(caseComments)
      .where(eq(caseComments.caseId, caseId))
      .orderBy(asc(caseComments.createdAt));
    res.json({ comments: rows });
  }));

  app.post('/api/cases/:caseId/comments', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Comment text is required.' });
      return;
    }
    const comment = {
      id: crypto.randomUUID(),
      caseId,
      userId: req.user!.id,
      authorName: req.user!.displayName,
      authorRole: normalizeRole(req.user!.role),
      body: sanitizeText(parsed.data.body, 2000),
      createdAt: Date.now(),
    };
    await db.insert(caseComments).values(comment);
    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: 'COMMENT_ADDED',
      summary: comment.body.slice(0, 120),
    });
    broadcastLiveEvent({ type: 'case:comment', caseId, data: comment });
    res.status(201).json({ comment });
  }));

  // --- AI Investigation Assistant Structured Tasks ---
  app.post('/api/cases/:caseId/assistant-task', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const parsed = assistantTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid AI assistant task request.' });
      return;
    }
    const full = await loadFullCaseAuthorized(caseId, req.user!);
    if (!full) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const result = await runInvestigationAssistantTask({
      task: parsed.data.task,
      language: parsed.data.language as SupportedLanguageCode,
      caseDossier: {
        caseNumber: full.case.caseNumber,
        title: full.case.title,
        category: full.case.category,
        status: full.case.status,
        priority: full.case.priority,
        incidentLocation: full.case.incidentLocation,
        incidentDate: full.case.incidentDate,
        riskLevel: full.case.riskLevel,
        confidenceMin: full.case.confidenceMin,
        confidenceMax: full.case.confidenceMax,
        summary: full.case.summary,
        captionText: full.case.captionText,
        categoryRequirements: full.categoryMeta?.evidenceRequirements ?? [],
        evidenceList: full.evidence.map((e) => ({
          filename: e.originalFilename,
          modality: e.modality,
          sha256: e.sha256,
          transcript: e.transcript,
        })),
        findings: full.findings.map((f) => ({
          indicator: f.indicator,
          severity: f.severity,
          modality: f.modality,
          whyFlagged: f.whyFlagged,
          limitation: f.limitation,
        })),
        witnessCount: full.witnesses.length,
        custodyCount: full.ledger.length,
        limitations: full.case.limitations,
        recommendedChecks: full.case.recommendedChecks,
      },
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'AI_ASSISTANT_TASK',
      resourceType: 'case',
      resourceId: caseId,
      details: `Executed ${parsed.data.task} (${result.mode})`,
    });

    res.json(result);
  }));
}
