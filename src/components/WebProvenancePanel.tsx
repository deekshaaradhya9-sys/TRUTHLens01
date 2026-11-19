import React, { useCallback, useEffect, useState } from 'react';
import {
  Globe,
  Radar,
  ExternalLink,
  Search,
  RefreshCw,
  ArrowUpRight,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type {
  FullCaseData,
  ProvenanceRadarResponse,
  WebVerificationRecord,
} from '../types/forensics.ts';

interface WebProvenancePanelProps {
  caseData: FullCaseData;
  canRunAnalysis: boolean;
  onCaseUpdated: (updated: FullCaseData) => void;
  onOpenCase: (caseId: string) => void;
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const WebProvenancePanel: React.FC<WebProvenancePanelProps> = ({
  caseData,
  canRunAnalysis,
  onCaseUpdated,
  onOpenCase,
}) => {
  const [claimQuery, setClaimQuery] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [radar, setRadar] = useState<ProvenanceRadarResponse | null>(null);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarError, setRadarError] = useState<string | null>(null);

  const loadRadar = useCallback(async () => {
    setRadarLoading(true);
    setRadarError(null);
    try {
      const res = await apiRequest<ProvenanceRadarResponse>(
        `/api/cases/${caseData.case.id}/provenance-radar`,
      );
      setRadar(res);
    } catch (err) {
      setRadarError(err instanceof Error ? err.message : 'Unable to scan cross-case dHash corpus.');
    } finally {
      setRadarLoading(false);
    }
  }, [caseData.case.id]);

  useEffect(() => {
    loadRadar();
  }, [loadRadar, caseData.evidence.length]);

  const handleVerifyWeb = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);

    const trimmedUrl = referenceUrl.trim();
    if (trimmedUrl && !isSafeHttpUrl(trimmedUrl)) {
      setVerifyError('Reference URL must start with https:// or http://.');
      return;
    }

    setVerifying(true);
    try {
      const updated = await apiRequest<FullCaseData & { latestVerification?: WebVerificationRecord }>(
        `/api/cases/${caseData.case.id}/verify-web`,
        {
          method: 'POST',
          body: JSON.stringify({
            claimQuery: claimQuery.trim(),
            urls: trimmedUrl ? [trimmedUrl] : [],
          }),
        },
      );
      onCaseUpdated(updated);
      setClaimQuery('');
      setReferenceUrl('');
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Web grounding verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const verifications = Array.isArray(caseData.webVerifications) ? caseData.webVerifications : [];

  return (
    <section className="grid lg:grid-cols-12 gap-6">
      {/* Section A: Live Web Grounding & Citation Claim Verifier */}
      <div className="lg:col-span-7 glass-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">
              Live Web Grounding &amp; Open-Source Claim Verifier
            </h3>
          </div>
          <span className="text-[11px] font-mono text-cyan-300 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            <span>Search Grounding + URL Context</span>
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Cross-check the active case caption, event location/date, and ingested public URLs against live web reporting to detect recycled media or out-of-context claims. Citations are logged to the SHA-256 custody ledger.
        </p>

        {canRunAnalysis && (
          <form onSubmit={handleVerifyWeb} className="space-y-2.5">
            <div className="grid sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                maxLength={600}
                value={claimQuery}
                onChange={(e) => setClaimQuery(e.target.value)}
                placeholder="Optional custom query (defaults to case title & caption)"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <input
                type="url"
                maxLength={2048}
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                placeholder="Optional https:// source link to ground"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-mono text-slate-500">
                Includes up to 4 ingested public URLs automatically
              </span>
              <button
                type="submit"
                disabled={verifying}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-400 hover:from-cyan-300 hover:to-sky-300 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                {verifying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>{verifying ? 'Grounding Claims...' : 'Verify Claims Online'}</span>
              </button>
            </div>
          </form>
        )}

        {verifyError && (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {verifyError}
          </div>
        )}

        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {verifications.length === 0 ? (
            <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-4 text-xs text-slate-400">
              No web grounding checks run for this case yet. Click <strong>Verify Claims Online</strong> to inspect open-web citations and prior appearances.
            </div>
          ) : (
            verifications.map((rec) => (
              <div
                key={rec.id}
                className="rounded-xl bg-slate-950/85 border border-slate-800 p-3.5 space-y-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-cyan-300 truncate max-w-[360px]">
                    Query: {rec.query}
                  </span>
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span
                      className={`px-2 py-0.5 rounded border ${
                        rec.mode === 'gemini_search_grounding'
                          ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                          : 'bg-amber-500/15 border-amber-500/35 text-amber-300'
                      }`}
                    >
                      {rec.mode === 'gemini_search_grounding'
                        ? 'LIVE WEB GROUNDED'
                        : 'LOCAL CROSS-CHECK'}
                    </span>
                    <span className="text-slate-500">
                      {new Date(rec.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                <p className="text-slate-200 leading-relaxed whitespace-pre-line">
                  {rec.verdictSummary}
                </p>

                {rec.notice && (
                  <div className="text-[11px] font-mono text-amber-300/90">
                    Note: {rec.notice}
                  </div>
                )}

                {Array.isArray(rec.citations) && rec.citations.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-2">
                    {rec.citations
                      .filter((c) => isSafeHttpUrl(c.uri))
                      .map((c, idx) => (
                        <a
                          key={`${rec.id}-cit-${idx}`}
                          href={c.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 hover:border-cyan-500/50 text-[11px] text-cyan-200 max-w-[240px]"
                        >
                          <span className="truncate">{c.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Section B: Cross-Case Perceptual Hash (dHash) Reuse Radar */}
      <div className="lg:col-span-5 glass-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Radar className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">
              Cross-Case Perceptual Reuse Radar
            </h3>
          </div>
          <button
            type="button"
            onClick={loadRadar}
            disabled={radarLoading}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 hover:border-violet-400 text-[11px] text-slate-200 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 text-violet-400 ${radarLoading ? 'animate-spin' : ''}`} />
            <span>Scan Corpus</span>
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Scans 64-bit perceptual <span className="font-mono text-slate-300">dHash</span> fingerprints across all investigations your role is authorized to access (RBAC-enforced) to spot cropped or recompressed recycled images.
        </p>

        {radarError && (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {radarError}
          </div>
        )}

        {radar && (
          <div className="grid grid-cols-3 gap-2 text-center font-mono text-[11px] bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 tabular-nums">
            <div>
              <div className="text-slate-500">Case Images</div>
              <div className="text-white font-semibold mt-0.5">{radar.scannedImages}</div>
            </div>
            <div>
              <div className="text-slate-500">Authorized Corpus</div>
              <div className="text-cyan-300 font-semibold mt-0.5">{radar.comparedCorpusSize}</div>
            </div>
            <div>
              <div className="text-slate-500">Matches (≤12b)</div>
              <div
                className={`font-semibold mt-0.5 ${
                  radar.matches.length > 0 ? 'text-amber-300' : 'text-emerald-300'
                }`}
              >
                {radar.matches.length}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
          {!radar || radar.matches.length === 0 ? (
            <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-4 flex items-start gap-2.5 text-xs text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                No perceptual reuse matches (Hamming distance ≤ 12) detected across your accessible investigation corpus.
              </span>
            </div>
          ) : (
            radar.matches.map((m) => (
              <div
                key={`${m.evidenceId}-${m.matchedEvidenceId}`}
                className="rounded-lg bg-slate-950/90 border border-amber-500/35 p-3 space-y-2 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-amber-300 uppercase">
                      {m.similarityPct}% Visual Similarity · Hamming {m.hammingDistance}/64
                    </div>
                    <div className="text-white font-medium truncate mt-0.5">
                      {m.matchedCaseNumber}: {m.matchedCaseTitle}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenCase(m.matchedCaseId)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-violet-500/20 border border-violet-500/40 hover:bg-violet-500/30 text-violet-200 text-[11px] font-medium shrink-0 cursor-pointer"
                  >
                    <span>Open</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-[11px] font-mono text-slate-400 flex flex-wrap justify-between gap-1">
                  <span className="truncate">This: {m.sourceFilename}</span>
                  <span className="truncate">Peer: {m.matchedFilename}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};
