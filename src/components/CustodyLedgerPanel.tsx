import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Link2,
  Shield,
  ArrowRightLeft,
  Download,
  Info,
} from 'lucide-react';
import { apiRequest, fetchAuthorizedResponse } from '../utils/api.ts';
import type {
  AuditLogItem,
  CustodyLedgerEntry,
  EvidenceItem,
  LedgerVerificationResult,
} from '../types/forensics.ts';
import { useI18n } from '../i18n/translations.ts';

interface CustodyLedgerPanelProps {
  caseId: string;
  entries: CustodyLedgerEntry[];
  evidenceItems?: EvidenceItem[];
  canManageCustody?: boolean;
  defaultActorName?: string;
  onVerified: (result: LedgerVerificationResult) => void;
  onCaseRefreshed?: () => Promise<void> | void;
}

export const CustodyLedgerPanel: React.FC<CustodyLedgerPanelProps> = ({
  caseId,
  entries,
  evidenceItems = [],
  canManageCustody = true,
  defaultActorName = '',
  onVerified,
  onCaseRefreshed,
}) => {
  const { t } = useI18n();
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<LedgerVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  // Custody transfer form
  const [evidenceId, setEvidenceId] = useState<string>('');
  const [action, setAction] = useState<
    'CUSTODY_TRANSFER' | 'VAULT_INSPECTION' | 'LAB_HANDOFF' | 'SUPERVISOR_APPROVAL' | 'ARCHIVE_SEAL'
  >('CUSTODY_TRANSFER');
  const [collectedBy, setCollectedBy] = useState(defaultActorName);
  const [transferredBy, setTransferredBy] = useState(defaultActorName);
  const [receivedBy, setReceivedBy] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [approvalSignature, setApprovalSignature] = useState('');
  const [submittingTransfer, setSubmittingTransfer] = useState(false);

  const loadAuditLogs = async () => {
    try {
      const res = await apiRequest<{ myAuditLogs?: AuditLogItem[] }>('/api/security/overview');
      setAuditLogs(Array.isArray(res.myAuditLogs) ? res.myAuditLogs : []);
    } catch {
      // non-fatal
    }
  };

  useEffect(() => {
    apiRequest<{ myAuditLogs?: AuditLogItem[] }>('/api/security/overview')
      .then((res) => setAuditLogs(Array.isArray(res.myAuditLogs) ? res.myAuditLogs : []))
      .catch(() => {});
  }, [caseId]);

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    try {
      const res = await apiRequest<LedgerVerificationResult>(
        `/api/cases/${caseId}/verify-ledger`,
        { method: 'POST' },
      );
      setResult(res);
      onVerified(res);
      await loadAuditLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleRecordTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingTransfer(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/cases/${caseId}/custody-transfer`, {
        method: 'POST',
        body: JSON.stringify({
          evidenceId: evidenceId || null,
          action,
          collectedBy,
          transferredBy,
          receivedBy,
          transferReason,
          approvalSignature,
        }),
      });
      setReceivedBy('');
      setTransferReason('');
      setApprovalSignature('');
      setNotice('Cryptographic custody transfer block appended and linked.');
      await onCaseRefreshed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record custody transfer.');
    } finally {
      setSubmittingTransfer(false);
    }
  };

  const handleDownloadReport = async () => {
    setError(null);
    try {
      const res = await fetchAuthorizedResponse(`/api/cases/${caseId}/custody-report`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `TruthLens_Custody_Report_${caseId.slice(0, 8)}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to download custody report.');
    }
  };

  const safeEntries = Array.isArray(entries) ? entries : [];

  return (
    <div className="space-y-6">
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">{t.ledgerTitle}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t.ledgerSubtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadReport}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Download Custody Report</span>
            </button>

            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{verifying ? t.ledgerVerifying : t.ledgerVerifyBtn}</span>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-3 text-[11px] text-slate-300 flex items-start gap-2">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <span>
              <strong>Tamper-Evidence Boundary:</strong> TruthLens chains each entry using SHA-256 over the previous block and verifies on-disk file digests from the moment of ingestion forward. It detects file or block tampering against stored digests, though it cannot prove pre-upload authenticity or prevent a host OS root compromise from altering SQLite directly without an external anchor.
            </span>
          </div>

          {result && (
            <div
              className={`rounded-lg border p-3.5 text-xs flex items-start gap-3 ${
                result.valid
                  ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-200'
                  : 'bg-rose-950/40 border-rose-700/60 text-rose-200'
              }`}
            >
              {result.valid ? (
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="font-semibold">
                  {result.valid
                    ? `Ledger Intact · ${result.entriesChecked} blocks & ${result.filesVerified} original files verified`
                    : 'Integrity Mismatch Detected'}
                </div>
                <div className="font-mono text-[11px] opacity-85 break-all">
                  Head Hash: {result.headHash}
                </div>
                {(result.mismatches ?? []).length > 0 && (
                  <ul className="list-disc pl-4 space-y-0.5 text-rose-300">
                    {result.mismatches.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {notice && (
            <div className="text-xs text-emerald-200 bg-emerald-950/35 border border-emerald-700/60 rounded-lg px-3 py-2">
              {notice}
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Record Custody Transfer Form */}
          {canManageCustody && (
            <form
              onSubmit={handleRecordTransfer}
              className="rounded-xl bg-slate-950/75 border border-slate-800 p-4 space-y-3"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-200">
                <ArrowRightLeft className="w-4 h-4 text-cyan-400" />
                <span>Log Evidence Custody Transfer / Handoff / Seal</span>
              </div>
              <div className="grid sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Custody Event Type</label>
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value as typeof action)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  >
                    <option value="CUSTODY_TRANSFER">Custody Transfer</option>
                    <option value="LAB_HANDOFF">Forensic Lab Handoff</option>
                    <option value="VAULT_INSPECTION">Vault Inspection</option>
                    <option value="SUPERVISOR_APPROVAL">Supervisor Approval</option>
                    <option value="ARCHIVE_SEAL">Archive Seal</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Linked Exhibit (optional)</label>
                  <select
                    value={evidenceId}
                    onChange={(e) => setEvidenceId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  >
                    <option value="">All Case Bundle</option>
                    {evidenceItems.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.originalFilename} ({ev.modality})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Original Collector</label>
                  <input
                    type="text"
                    value={collectedBy}
                    onChange={(e) => setCollectedBy(e.target.value)}
                    placeholder="Field Officer / Collector"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Transferred By *</label>
                  <input
                    type="text"
                    required
                    value={transferredBy}
                    onChange={(e) => setTransferredBy(e.target.value)}
                    placeholder="From custodian"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Received By *</label>
                  <input
                    type="text"
                    required
                    value={receivedBy}
                    onChange={(e) => setReceivedBy(e.target.value)}
                    placeholder="To recipient / vault / lab"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Approval Signature / Ref</label>
                  <input
                    type="text"
                    value={approvalSignature}
                    onChange={(e) => setApprovalSignature(e.target.value)}
                    placeholder="Supervisor badge or ref"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <input
                  type="text"
                  required
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Reason / purpose for custody transfer or verification..."
                  className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
                <button
                  type="submit"
                  disabled={submittingTransfer}
                  className="px-4 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold cursor-pointer disabled:opacity-50"
                >
                  {submittingTransfer ? 'Signing Block...' : 'Append Custody Transfer'}
                </button>
              </div>
            </form>
          )}

          {/* Ledger Entries List */}
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {safeEntries.map((entry) => (
              <div
                key={entry.id}
                className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 text-xs font-mono space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-cyan-300 font-semibold tabular-nums">
                    Block #{entry.entryIndex} · {entry.action}
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>
                {(entry.collectedBy || entry.transferredBy || entry.receivedBy) && (
                  <div className="text-[11px] text-emerald-300 font-sans">
                    {entry.collectedBy ? `Collected by: ${entry.collectedBy} · ` : ''}
                    {entry.transferredBy ? `From: ${entry.transferredBy}` : ''}
                    {entry.receivedBy ? ` → To: ${entry.receivedBy}` : ''}
                    {entry.transferReason ? ` · Purpose: ${entry.transferReason}` : ''}
                    {entry.approvalSignature ? ` · Signed: ${entry.approvalSignature}` : ''}
                  </div>
                )}
                <div className="text-slate-300 break-all">
                  Artifact SHA-256: <span className="text-slate-400">{entry.fileSha256}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 break-all">
                  <Link2 className="w-3 h-3 shrink-0 text-emerald-500" />
                  <span>
                    prev:{entry.prevEntryHash.slice(0, 12)}... → curr:{entry.entryHash.slice(0, 20)}...
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Security Audit Trail */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-400" />
            <div>
              <h4 className="text-sm font-semibold text-white">{t.auditLogTitle}</h4>
              <p className="text-[11px] text-slate-400">{t.auditLogSubtitle}</p>
            </div>
          </div>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            {auditLogs.length} events
          </span>
        </div>

        <div className="p-4 space-y-2 max-h-[260px] overflow-y-auto">
          {auditLogs.length === 0 ? (
            <div className="text-xs text-slate-500 font-mono">No audit events recorded yet.</div>
          ) : (
            auditLogs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/85 border border-slate-800/80 text-[11px] font-mono"
              >
                <div className="space-y-0.5">
                  <span className="text-violet-300 font-semibold">{log.action}</span>
                  <span className="text-slate-500"> · {log.resourceType}</span>
                  <div className="text-slate-300 font-sans">{log.details}</div>
                </div>
                <div className="text-right text-slate-500 tabular-nums">
                  <div>ip:{log.ipHash}</div>
                  <div>{new Date(log.createdAt).toLocaleTimeString()}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
