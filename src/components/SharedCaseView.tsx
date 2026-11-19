import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, ArrowLeft, FileCheck2, Clock } from 'lucide-react';
import type { SharedCasePayload } from '../types/forensics.ts';

interface SharedCaseViewProps {
  token: string;
  onExitShareMode: () => void;
}

export const SharedCaseView: React.FC<SharedCaseViewProps> = ({ token, onExitShareMode }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SharedCasePayload | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/shared-case/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || 'Share link unavailable or expired.');
        }
        return res.json() as Promise<SharedCasePayload>;
      })
      .then((data) => {
        if (active) setPayload(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load shared dossier.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const perms = payload?.permissions ?? {
    summary: true,
    findings: true,
    evidenceInventory: true,
    custodyDigest: true,
    timeline: false,
  };

  return (
    <div className="min-h-screen forensic-grid-bg text-slate-100 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
            <div>
              <h1 className="font-display text-lg font-bold text-white">
                TruthLens · Read-Only Shared Forensic Briefing
              </h1>
              <p className="text-xs font-mono text-slate-400">
                Permission-scoped redacted digest · Private evidence files &amp; witness PII hidden
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onExitShareMode}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Open Full Workbench</span>
          </button>
        </div>

        {loading && (
          <div className="glass-panel rounded-xl p-8 text-center text-xs font-mono text-cyan-300">
            Verifying signed QR share token...
          </div>
        )}

        {error && (
          <div className="glass-panel rounded-xl p-6 border-rose-500/40 flex items-center gap-3 text-sm text-rose-200">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="font-semibold">Shared QR Access Denied / Unavailable</div>
              <div className="text-xs text-rose-300 mt-1">{error}</div>
            </div>
          </div>
        )}

        {payload && (
          <div className="space-y-6">
            <div className="glass-panel rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-400">
                <span>
                  {payload.case.caseNumber ? `${payload.case.caseNumber} · ` : ''}
                  {payload.shareLabel}
                </span>
                <span>Expires: {new Date(payload.expiresAt).toLocaleString()}</span>
              </div>
              <h2 className="font-display text-xl font-bold text-white">{payload.case.title}</h2>
              {perms.summary && payload.case.description && (
                <p className="text-xs text-slate-300">{payload.case.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-amber-300 font-semibold">
                  Risk: {payload.case.riskLevel} ({payload.case.confidenceMin}%–{payload.case.confidenceMax}%)
                </span>
                {payload.case.status && (
                  <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-cyan-300 uppercase">
                    Status: {payload.case.status.replace(/_/g, ' ')}
                  </span>
                )}
                {payload.case.priority && (
                  <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-violet-300 uppercase">
                    Priority: {payload.case.priority}
                  </span>
                )}
              </div>
              {perms.summary && payload.case.incidentLocation && (
                <div className="text-xs font-mono text-slate-400">
                  Location: {payload.case.incidentLocation}
                  {payload.case.incidentDate ? ` · Incident Date: ${payload.case.incidentDate}` : ''}
                </div>
              )}
              <p className="text-sm text-slate-200 leading-relaxed pt-1">{payload.case.summary}</p>
            </div>

            {(perms.evidenceInventory || perms.custodyDigest) && (
              <div className="glass-panel rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <FileCheck2 className="w-4 h-4 text-cyan-400" />
                  <span>SHA-256 Evidence Inventory &amp; Custody Digest</span>
                </div>
                {perms.evidenceInventory && (
                  <div className="space-y-2">
                    {(payload.evidenceDigest ?? []).map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded-lg bg-slate-950 border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                      >
                        <span className="text-slate-200">
                          {ev.originalFilename} ({ev.modality})
                        </span>
                        <span className="text-cyan-300 break-all">SHA-256: {ev.sha256}</span>
                      </div>
                    ))}
                  </div>
                )}
                {perms.custodyDigest && (
                  <div className="text-xs font-mono text-slate-400 pt-1">
                    Custody Ledger Entries: {payload.ledgerSummary.entriesCount} · Head Hash:{' '}
                    {payload.ledgerSummary.headHash ?? 'N/A'}
                  </div>
                )}
              </div>
            )}

            {perms.findings && (
              <div className="glass-panel rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  Recorded Forensic Indicators ({payload.findings.length})
                </h3>
                <div className="space-y-3">
                  {(payload.findings ?? []).map((f) => (
                    <div key={f.id} className="rounded-lg bg-slate-950 border border-slate-800 p-3.5 space-y-1 text-xs">
                      <div className="font-mono text-cyan-300">
                        {f.severity} · {f.modality} · {f.locationOrTimestamp} · {f.confidenceRange}
                      </div>
                      <div className="text-sm font-semibold text-white">{f.indicator}</div>
                      <p className="text-slate-300">{f.whyFlagged}</p>
                      <p className="text-slate-500">Limitation: {f.limitation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {perms.timeline && (payload.timeline?.length ?? 0) > 0 && (
              <div className="glass-panel rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Clock className="w-4 h-4 text-violet-400" />
                  <span>Investigation Timeline Digest</span>
                </div>
                <div className="space-y-2 text-xs font-mono">
                  {payload.timeline!.map((item) => (
                    <div key={item.id} className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 flex justify-between gap-2">
                      <span className="text-slate-300">{item.action}: {item.summary}</span>
                      <span className="text-slate-500 shrink-0">{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
