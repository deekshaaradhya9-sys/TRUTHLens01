import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  agentMessages,
  caseActivity,
  caseCategories,
  caseCollaborators,
  caseComments,
  cases,
  custodyLedger,
  evidenceAccessLogs,
  evidenceItems,
  evidenceVersions,
  findings,
  graphEdges,
  graphNodes,
  users,
  witnesses,
} from '../db/schema.ts';
import type { AuthUser } from '../security/auth.ts';
import { canViewWitnessPii, getUserCaseAccess } from '../security/roles.ts';
import {
  runDeterministicCrossModalEngine,
  type CrossModalCorrelationItem,
  type ManipulationIndicatorItem,
} from './crossModalCorrelator.ts';

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeArray<T>(raw: string | null | undefined): T[] {
  const parsed = safeJson<unknown>(raw, []);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function maskEmail(email: string): string {
  if (!email) return '';
  const [l, d] = email.split('@');
  if (!l || !d) return '***';
  return `${l.slice(0, 2)}***@${d}`;
}

function maskPhone(phone: string): string {
  if (!phone) return '';
  const clean = phone.replace(/\s+/g, '');
  if (clean.length <= 4) return '****';
  return `${clean.slice(0, 3)}****${clean.slice(-3)}`;
}

export async function recordCaseActivity(params: {
  caseId: string;
  userId?: string | null;
  actorName: string;
  action: string;
  summary: string;
}) {
  await db.insert(caseActivity).values({
    id: crypto.randomUUID(),
    caseId: params.caseId,
    userId: params.userId ?? null,
    actorName: params.actorName,
    action: params.action,
    summary: params.summary,
    createdAt: Date.now(),
  });
}

export async function loadFullCaseAuthorized(
  caseId: string,
  user: AuthUser | null,
  options?: { bypassAclForShare?: boolean },
) {
  const caseRows = await db
    .select()
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);

  if (caseRows.length === 0) return null;
  const c = caseRows[0];

  if (!options?.bypassAclForShare) {
    if (!user) return null;
    const access = await getUserCaseAccess(caseId, user);
    if (!access.allowed) return null;
  }

  const [
    evRows,
    verRows,
    accessRows,
    findingRows,
    nodeRows,
    edgeRows,
    ledgerRows,
    msgRows,
    witnessRows,
    commentRows,
    activityRows,
    collabRows,
    categoryRows,
  ] = await Promise.all([
    db.select().from(evidenceItems).where(eq(evidenceItems.caseId, caseId)).orderBy(asc(evidenceItems.createdAt)),
    db.select().from(evidenceVersions).where(eq(evidenceVersions.caseId, caseId)).orderBy(desc(evidenceVersions.createdAt)),
    db.select().from(evidenceAccessLogs).where(eq(evidenceAccessLogs.caseId, caseId)).orderBy(desc(evidenceAccessLogs.createdAt)).limit(60),
    db.select().from(findings).where(eq(findings.caseId, caseId)).orderBy(asc(findings.createdAt)),
    db.select().from(graphNodes).where(eq(graphNodes.caseId, caseId)),
    db.select().from(graphEdges).where(eq(graphEdges.caseId, caseId)),
    db.select().from(custodyLedger).where(eq(custodyLedger.caseId, caseId)).orderBy(asc(custodyLedger.entryIndex)),
    db.select().from(agentMessages).where(eq(agentMessages.caseId, caseId)).orderBy(asc(agentMessages.createdAt)),
    db.select().from(witnesses).where(eq(witnesses.caseId, caseId)).orderBy(desc(witnesses.createdAt)),
    db.select().from(caseComments).where(eq(caseComments.caseId, caseId)).orderBy(asc(caseComments.createdAt)),
    db.select().from(caseActivity).where(eq(caseActivity.caseId, caseId)).orderBy(desc(caseActivity.createdAt)).limit(80),
    db.select().from(caseCollaborators).where(eq(caseCollaborators.caseId, caseId)),
    db.select().from(caseCategories).where(eq(caseCategories.slug, c.category)).limit(1),
  ]);

  let assignedInvestigator: { id: string; displayName: string; email: string; role: string } | null = null;
  if (c.assignedInvestigatorId) {
    const uRows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, c.assignedInvestigatorId))
      .limit(1);
    assignedInvestigator = uRows[0] ?? null;
  }

  let storedCorrelations = safeArray<CrossModalCorrelationItem>(c.correlationsJson);
  let storedManipulation = safeArray<ManipulationIndicatorItem>(c.manipulationJson);
  if ((storedCorrelations.length === 0 || storedManipulation.length === 0) && evRows.length > 0) {
    const computed = runDeterministicCrossModalEngine({
      caseTitle: c.title,
      captionText: c.captionText,
      evidenceRows: evRows,
    });
    if (storedCorrelations.length === 0) storedCorrelations = computed.correlations;
    if (storedManipulation.length === 0) storedManipulation = computed.manipulationIndicators;
  }

  const rawReview = safeJson<Record<string, unknown>>(c.humanReviewJson, {});
  const humanReview = {
    status:
      rawReview.status === 'verified_corroborated' ||
      rawReview.status === 'verified_inconclusive' ||
      rawReview.status === 'escalated'
        ? rawReview.status
        : 'pending',
    reviewerNote: typeof rawReview.reviewerNote === 'string' ? rawReview.reviewerNote : '',
    checkedItems: Array.isArray(rawReview.checkedItems)
      ? rawReview.checkedItems.filter((x): x is string => typeof x === 'string')
      : [],
    findingDecisions:
      rawReview.findingDecisions && typeof rawReview.findingDecisions === 'object'
        ? (rawReview.findingDecisions as Record<string, 'corroborated' | 'benign_artifact' | 'needs_followup'>)
        : {},
    signedOffBy: typeof rawReview.signedOffBy === 'string' ? rawReview.signedOffBy : null,
    signedOffAt: typeof rawReview.signedOffAt === 'number' ? rawReview.signedOffAt : null,
  };

  const allowWitnessPii = !options?.bypassAclForShare && canViewWitnessPii(user);
  const versionsByEv = new Map<string, typeof verRows>();
  for (const v of verRows) {
    const list = versionsByEv.get(v.evidenceId) ?? [];
    list.push(v);
    versionsByEv.set(v.evidenceId, list);
  }

  const catRow = categoryRows[0];
  const categoryInfo = catRow
    ? {
        slug: catRow.slug,
        name: catRow.name,
        description: catRow.description,
        fields: safeArray<{ key: string; label: string; type: string; placeholder?: string; options?: string[] }>(
          catRow.fieldSchemaJson,
        ),
        evidenceRequirements: safeArray<string>(catRow.evidenceRequirementsJson),
        reportTemplateNote: catRow.reportTemplateNote,
      }
    : null;

  return {
    case: {
      id: c.id,
      userId: c.userId,
      caseNumber: c.caseNumber || `TL-2026-${c.id.slice(0, 4).toUpperCase()}`,
      title: c.title,
      description: c.description,
      captionText: c.captionText,
      category: c.category || 'digital_fraud',
      categoryName: catRow?.name || c.category.replace(/_/g, ' '),
      status: c.status || 'registered',
      priority: (c.priority || 'medium') as 'low' | 'medium' | 'high' | 'critical',
      incidentLocation: c.incidentLocation || '',
      incidentDate: c.incidentDate || '',
      registrationDate: c.registrationDate || c.createdAt,
      assignedInvestigatorId: c.assignedInvestigatorId || null,
      assignedInvestigator,
      relatedPersons: safeArray<{ name: string; role: string }>(c.relatedPersonsJson),
      categoryFields: safeJson<Record<string, string>>(c.categoryFieldsJson, {}),
      notes: c.notes || '',
      closingSummary: c.closingSummary || '',
      isDemoSeed: c.isDemoSeed === 1,
      riskLevel: c.riskLevel as 'Low' | 'Medium' | 'High',
      confidenceMin: c.confidenceMin,
      confidenceMax: c.confidenceMax,
      summary: c.summary,
      analysisMode: (c.analysisMode || 'hybrid_ai') as 'hybrid_ai' | 'deterministic_heuristics',
      analysisStale: c.analysisStale === 1,
      humanReview,
      limitations: safeArray<string>(c.limitationsJson),
      alternativeExplanations: safeArray<string>(c.alternativesJson),
      recommendedChecks: safeArray<string>(c.recommendedChecksJson),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    },
    categoryMeta: categoryInfo,
    evidence: evRows.map((ev) => ({
      id: ev.id,
      modality: ev.modality,
      sourceType: (ev.sourceType || 'upload') as 'upload' | 'live_camera' | 'caption' | 'url_ingest',
      originalFilename: ev.originalFilename,
      hasFile: Boolean(ev.storedFilename),
      hasEla: Boolean(ev.elaFilename),
      hasFft: Boolean(ev.fftFilename),
      mimeType: ev.mimeType,
      byteSize: ev.byteSize,
      sha256: ev.sha256,
      perceptualHash: ev.perceptualHash,
      exif: safeJson(ev.exifJson, null),
      metrics: safeJson(ev.metricsJson, null),
      frames: ev.framesJson ? safeArray(ev.framesJson) : null,
      transcript: ev.transcript,
      versions: (versionsByEv.get(ev.id) ?? []).map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        sha256: v.sha256,
        byteSize: v.byteSize,
        note: v.note,
        updatedBy: v.updatedBy,
        createdAt: v.createdAt,
      })),
      createdAt: ev.createdAt,
    })),
    evidenceAccessLogs: accessRows,
    findings: findingRows,
    correlations: storedCorrelations,
    manipulationIndicators: storedManipulation,
    webVerifications: safeArray(c.webVerificationsJson),
    graph: {
      nodes: nodeRows,
      edges: edgeRows,
    },
    ledger: ledgerRows,
    witnesses: witnessRows
      .filter((w) => allowWitnessPii || !w.privacyRedacted || (user && w.userId === user.id))
      .map((w) => {
        const canSeeFull = allowWitnessPii || (user && w.userId === user.id);
        return {
          id: w.id,
          caseId: w.caseId,
          fullName: w.privacyRedacted && !canSeeFull ? `Witness #${w.id.slice(0, 4).toUpperCase()} (Redacted)` : w.fullName,
          email: canSeeFull ? w.email : maskEmail(w.email),
          phone: canSeeFull ? w.phone : maskPhone(w.phone),
          address: canSeeFull ? w.address : w.address ? '[Protected Address]' : '',
          relationship: w.relationship,
          statement: w.statement,
          consentGranted: w.consentGranted === 1,
          privacyRedacted: w.privacyRedacted === 1,
          verificationStatus: w.verificationStatus as 'unverified' | 'pending' | 'verified',
          linkedEvidenceIds: safeArray<string>(w.linkedEvidenceIdsJson),
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
        };
      }),
    comments: commentRows,
    activity: activityRows,
    collaborators: collabRows,
    agentMessages: msgRows.map((m) => ({
      id: m.id,
      role: m.role,
      language: m.language,
      devilsAdvocate: m.devilsAdvocate === 1,
      content: m.content,
      citedFindingIds: safeArray<string>(m.citedFindingIdsJson),
      createdAt: m.createdAt,
    })),
  };
}
