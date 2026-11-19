import crypto from 'node:crypto';
import type { Express } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  cases,
  custodyLedger,
  evidenceAccessLogs,
  evidenceItems,
  evidenceVersions,
} from '../db/schema.ts';
import { loadFullCaseAuthorized, recordCaseActivity } from '../forensics/caseLoader.ts';
import { appendCustodyEntry, computeSha256, verifyCaseLedger } from '../forensics/ledger.ts';
import { dispatchCaseNotificationToParticipants } from '../notifications/notifier.ts';
import { recordAuditEvent } from '../security/audit.ts';
import { type AuthedRequest, asyncHandler, hashIp, requireAuth, requireCsrf } from '../security/auth.ts';
import { canManageCustody, getUserCaseAccess } from '../security/roles.ts';
import { sanitizeText } from '../security/sanitize.ts';

const custodyTransferSchema = z.object({
  evidenceId: z.string().max(80).nullable().optional(),
  action: z
    .enum([
      'CUSTODY_TRANSFER',
      'VAULT_INSPECTION',
      'LAB_HANDOFF',
      'SUPERVISOR_APPROVAL',
      'ARCHIVE_SEAL',
    ])
    .default('CUSTODY_TRANSFER'),
  collectedBy: z.string().max(120).optional().default(''),
  transferredBy: z.string().min(2).max(120),
  receivedBy: z.string().min(2).max(120),
  transferReason: z.string().min(3).max(400),
  approvalSignature: z.string().max(160).optional().default(''),
});

const evidenceVersionSchema = z.object({
  note: z.string().min(2).max(500),
});

export function registerVaultCustodyRoutes(app: Express) {
  // --- Record Chain of Custody Transfer / Handoff / Approval ---
  app.post('/api/cases/:caseId/custody-transfer', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    if (!canManageCustody(req.user)) {
      res.status(403).json({ error: 'Evidence officer or investigator privileges required for custody transfers.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed || !access.canWrite) {
      res.status(403).json({ error: 'Access denied or read-only access.' });
      return;
    }

    const parsed = custodyTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Transfer requires transferredBy, receivedBy, and transferReason.' });
      return;
    }

    let fileSha256 = computeSha256(
      Buffer.from(`${caseId}:${parsed.data.transferredBy}:${parsed.data.receivedBy}:${Date.now()}`, 'utf8'),
    );
    const evId = parsed.data.evidenceId || null;
    if (evId) {
      const evRows = await db
        .select()
        .from(evidenceItems)
        .where(and(eq(evidenceItems.id, evId), eq(evidenceItems.caseId, caseId)))
        .limit(1);
      if (evRows.length === 0) {
        res.status(404).json({ error: 'Linked evidence item not found in this case.' });
        return;
      }
      fileSha256 = evRows[0].sha256;
    }

    const now = Date.now();
    const collectedBy = sanitizeText(parsed.data.collectedBy, 120);
    const transferredBy = sanitizeText(parsed.data.transferredBy, 120);
    const receivedBy = sanitizeText(parsed.data.receivedBy, 120);
    const transferReason = sanitizeText(parsed.data.transferReason, 400);
    const approvalSignature = sanitizeText(
      parsed.data.approvalSignature || `${req.user!.displayName} (${req.user!.role})`,
      160,
    );

    const entry = await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId: evId,
      action: parsed.data.action,
      fileSha256,
      collectedBy,
      transferredBy,
      receivedBy,
      transferReason,
      approvalSignature,
      createdAt: now,
    });

    await recordCaseActivity({
      caseId,
      userId: req.user!.id,
      actorName: req.user!.displayName,
      action: parsed.data.action,
      summary: `Custody handoff: ${transferredBy} → ${receivedBy} (${transferReason})`,
    });

    await recordAuditEvent({
      req,
      userId: req.user!.id,
      action: 'CUSTODY_TRANSFER',
      resourceType: 'custody_ledger',
      resourceId: entry.id,
      details: `${parsed.data.action}: ${transferredBy} -> ${receivedBy} (${transferReason})`,
    });

    const caseRow = await db
      .select({ title: cases.title, userId: cases.userId, assignedInvestigatorId: cases.assignedInvestigatorId })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    if (caseRow.length > 0) {
      dispatchCaseNotificationToParticipants({
        userIds: [caseRow[0].userId, caseRow[0].assignedInvestigatorId],
        caseId,
        caseTitle: caseRow[0].title,
        eventType: 'custody_event',
        summaryLine: `${parsed.data.action}: ${transferredBy} → ${receivedBy} (${transferReason})`,
      }).catch(() => {});
    }

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    res.status(201).json(full);
  }));

  // --- Add Evidence Version Annotation (preserves original sealed file & SHA-256) ---
  app.post('/api/cases/:caseId/evidence/:evidenceId/version', requireAuth, requireCsrf, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const evidenceId = String(req.params.evidenceId);
    if (!canManageCustody(req.user)) {
      res.status(403).json({ error: 'Insufficient role permissions.' });
      return;
    }
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed || !access.canWrite) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    const parsed = evidenceVersionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Version note is required.' });
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
    const ev = evRows[0];

    const existingVers = await db
      .select()
      .from(evidenceVersions)
      .where(eq(evidenceVersions.evidenceId, evidenceId));
    const nextVer = existingVers.length + 1;
    const now = Date.now();
    const note = sanitizeText(parsed.data.note, 500);

    await db.insert(evidenceVersions).values({
      id: crypto.randomUUID(),
      evidenceId,
      caseId,
      versionNumber: nextVer,
      sha256: ev.sha256,
      byteSize: ev.byteSize,
      note,
      updatedBy: req.user!.displayName,
      createdAt: now,
    });

    await db.insert(evidenceAccessLogs).values({
      id: crypto.randomUUID(),
      evidenceId,
      caseId,
      userId: req.user!.id,
      userName: req.user!.displayName,
      action: 'metadata_update',
      ipHash: hashIp(req.ip ?? 'unknown'),
      createdAt: now,
    });

    await appendCustodyEntry({
      caseId,
      userId: req.user!.id,
      evidenceId,
      action: 'EVIDENCE_VERSION_NOTE',
      fileSha256: ev.sha256,
      transferredBy: req.user!.displayName,
      transferReason: `v${nextVer}: ${note}`,
      createdAt: now,
    });

    const full = await loadFullCaseAuthorized(caseId, req.user!);
    res.status(201).json(full);
  }));

  // --- Download / Print Evidence Integrity Receipt ---
  app.get('/api/cases/:caseId/evidence/:evidenceId/receipt', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const evidenceId = String(req.params.evidenceId);
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const [caseRows, evRows, ledgerRows] = await Promise.all([
      db.select().from(cases).where(eq(cases.id, caseId)).limit(1),
      db.select().from(evidenceItems).where(and(eq(evidenceItems.id, evidenceId), eq(evidenceItems.caseId, caseId))).limit(1),
      db.select().from(custodyLedger).where(eq(custodyLedger.caseId, caseId)).orderBy(asc(custodyLedger.entryIndex)),
    ]);

    if (caseRows.length === 0 || evRows.length === 0) {
      res.status(404).json({ error: 'Evidence receipt not found.' });
      return;
    }

    const c = caseRows[0];
    const ev = evRows[0];
    const verification = await verifyCaseLedger(caseId);

    await db.insert(evidenceAccessLogs).values({
      id: crypto.randomUUID(),
      evidenceId,
      caseId,
      userId: req.user!.id,
      userName: req.user!.displayName,
      action: 'receipt_download',
      ipHash: hashIp(req.ip ?? 'unknown'),
      createdAt: Date.now(),
    });

    const receiptText = [
      '============================================================',
      'TRUTHLENS DIGITAL EVIDENCE CUSTODY RECEIPT',
      '============================================================',
      `Receipt Generated : ${new Date().toISOString()}`,
      `Generated By      : ${req.user!.displayName} (${req.user!.role})`,
      `Case Number       : ${c.caseNumber || c.id.slice(0, 8)}`,
      `Case Title        : ${c.title}`,
      '------------------------------------------------------------',
      `Evidence ID       : ${ev.id}`,
      `Original Filename : ${ev.originalFilename}`,
      `Modality / Source : ${ev.modality.toUpperCase()} / ${ev.sourceType}`,
      `MIME Type         : ${ev.mimeType}`,
      `Byte Size         : ${ev.byteSize} bytes`,
      `Ingested At       : ${new Date(ev.createdAt).toISOString()}`,
      `SHA-256 Digest    : ${ev.sha256}`,
      `Perceptual dHash  : ${ev.perceptualHash || 'N/A'}`,
      '------------------------------------------------------------',
      `Ledger Chain Valid: ${verification.valid ? 'INTACT' : 'MISMATCH DETECTED'}`,
      `Ledger Blocks     : ${verification.entriesChecked}`,
      `Ledger Head Hash  : ${verification.headHash}`,
      '------------------------------------------------------------',
      'Custody Events Involving This Exhibit:',
      ...ledgerRows
        .filter((l) => l.evidenceId === ev.id || l.action === 'FORENSIC_ANALYSIS_COMMIT')
        .map(
          (l) =>
            `  #${l.entryIndex} [${new Date(l.createdAt).toISOString()}] ${l.action}` +
            `${l.transferredBy ? ` | From: ${l.transferredBy}` : ''}` +
            `${l.receivedBy ? ` -> To: ${l.receivedBy}` : ''}` +
            `${l.transferReason ? ` | Reason: ${l.transferReason}` : ''}`,
        ),
      '============================================================',
      'Notice: SHA-256 verifies integrity from the moment of TruthLens',
      'ingestion forward; it does not prove authenticity prior to upload.',
      '============================================================',
    ].join('\n');

    if (req.query.format === 'json') {
      res.json({
        receiptGeneratedAt: Date.now(),
        caseNumber: c.caseNumber,
        caseTitle: c.title,
        evidence: {
          id: ev.id,
          originalFilename: ev.originalFilename,
          modality: ev.modality,
          mimeType: ev.mimeType,
          byteSize: ev.byteSize,
          sha256: ev.sha256,
          perceptualHash: ev.perceptualHash,
          createdAt: ev.createdAt,
        },
        ledgerVerification: verification,
      });
      return;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TruthLens_Receipt_${ev.id.slice(0, 8)}.txt"`,
    );
    res.send(receiptText);
  }));

  // --- Full Chain of Custody Printable / Downloadable Report ---
  app.get('/api/cases/:caseId/custody-report', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const caseId = String(req.params.caseId);
    const access = await getUserCaseAccess(caseId, req.user!);
    if (!access.allowed) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    const [caseRows, ledgerRows, evRows] = await Promise.all([
      db.select().from(cases).where(eq(cases.id, caseId)).limit(1),
      db.select().from(custodyLedger).where(eq(custodyLedger.caseId, caseId)).orderBy(asc(custodyLedger.entryIndex)),
      db.select().from(evidenceItems).where(eq(evidenceItems.caseId, caseId)),
    ]);
    if (caseRows.length === 0) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    const c = caseRows[0];
    const verification = await verifyCaseLedger(caseId);
    const evMap = new Map(evRows.map((e) => [e.id, e.originalFilename]));

    const lines = [
      'TRUTHLENS TAMPER-EVIDENT CHAIN OF CUSTODY REPORT',
      `Generated: ${new Date().toISOString()} | Requested by: ${req.user!.displayName}`,
      `Case: ${c.caseNumber || c.id.slice(0, 8)} — ${c.title}`,
      `Chain Integrity Check: ${verification.valid ? 'VERIFIED INTACT' : 'MISMATCH'} (${verification.entriesChecked} blocks, ${verification.filesVerified} files)`,
      `Head Hash: ${verification.headHash}`,
      '------------------------------------------------------------------------',
      ...ledgerRows.map((e) => {
        const fileName = e.evidenceId ? evMap.get(e.evidenceId) || e.evidenceId : 'Case Bundle';
        return [
          `Block #${e.entryIndex} | ${new Date(e.createdAt).toISOString()} | ${e.action}`,
          `  Artifact : ${fileName}`,
          `  SHA-256  : ${e.fileSha256}`,
          e.collectedBy ? `  Collected: ${e.collectedBy}` : '',
          e.transferredBy || e.receivedBy
            ? `  Transfer : ${e.transferredBy || 'System'} -> ${e.receivedBy || 'Vault'}`
            : '',
          e.transferReason ? `  Reason   : ${e.transferReason}` : '',
          e.approvalSignature ? `  Approval : ${e.approvalSignature}` : '',
          `  HashLink : ${e.prevEntryHash.slice(0, 14)}... -> ${e.entryHash.slice(0, 22)}...`,
        ]
          .filter(Boolean)
          .join('\n');
      }),
    ].join('\n\n');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TruthLens_Custody_Report_${c.caseNumber || c.id.slice(0, 8)}.txt"`,
    );
    res.send(lines);
  }));
}
