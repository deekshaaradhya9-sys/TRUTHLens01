import React, { useState } from 'react';
import {
  Activity,
  Eye,
  FileClock,
  MessageSquare,
  Send,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type {
  CaseActivityItem,
  CaseCommentItem,
  EvidenceAccessLogItem,
  EvidenceItem,
} from '../types/forensics.ts';

interface CollaborationTimelinePanelProps {
  caseId: string;
  activity: CaseActivityItem[];
  comments: CaseCommentItem[];
  evidenceItems: EvidenceItem[];
  evidenceAccessLogs: EvidenceAccessLogItem[];
  onCommentAdded: (comment: CaseCommentItem) => void;
}

export const CollaborationTimelinePanel: React.FC<CollaborationTimelinePanelProps> = ({
  caseId,
  activity,
  comments,
  evidenceItems,
  evidenceAccessLogs,
  onCommentAdded,
}) => {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeActivity = Array.isArray(activity) ? activity : [];
  const safeComments = Array.isArray(comments) ? comments : [];
  const safeEvidence = Array.isArray(evidenceItems) ? evidenceItems : [];
  const safeAccessLogs = Array.isArray(evidenceAccessLogs) ? evidenceAccessLogs : [];

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiRequest<{ comment: CaseCommentItem }>(
        `/api/cases/${caseId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ body: body.trim() }),
        },
      );
      setBody('');
      if (res.comment) {
        onCommentAdded(res.comment);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to post comment.');
    } finally {
      setSending(false);
    }
  };

  const evidenceNameMap = new Map(safeEvidence.map((e) => [e.id, e.originalFilename]));

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left: Chronological Activity Timeline */}
        <section className="lg:col-span-6 glass-panel rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">Investigation Timeline</h3>
            </div>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {safeActivity.length} events
            </span>
          </div>
          <div className="p-4 space-y-2.5 max-h-[420px] overflow-y-auto">
            {safeActivity.length === 0 ? (
              <div className="text-xs text-slate-400">No timeline entries recorded yet.</div>
            ) : (
              safeActivity.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg bg-slate-950/85 border border-slate-800 px-3.5 py-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="text-cyan-300 font-semibold">{item.action}</span>
                    <span className="text-slate-500 tabular-nums">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-slate-200">{item.summary}</div>
                  <div className="text-[11px] text-slate-500">Actor: {item.actorName}</div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right: Real-Time Investigator Comments */}
        <section className="lg:col-span-6 glass-panel rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-white">
                Real-Time Investigation Comments
              </h3>
            </div>
            <span className="text-[11px] font-mono text-emerald-300">Live WebSocket Sync</span>
          </div>

          <div className="p-4 space-y-2.5 flex-1 max-h-[340px] overflow-y-auto">
            {safeComments.length === 0 ? (
              <div className="text-xs text-slate-400">
                No case notes or team comments yet. Start a collaboration thread below.
              </div>
            ) : (
              safeComments.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg bg-slate-950/85 border border-slate-800 px-3.5 py-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">
                      {c.authorName}{' '}
                      <span className="font-mono text-[10px] text-cyan-300 uppercase">
                        ({c.authorRole.replace(/_/g, ' ')})
                      </span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">{c.body}</p>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={handleSubmitComment}
            className="p-4 border-t border-slate-800/90 space-y-2"
          >
            {error && <div className="text-xs text-rose-300">{error}</div>}
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Add live collaboration note, follow-up lead, or verification request..."
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
              />
              <button
                type="submit"
                disabled={sending || !body.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{sending ? 'Posting...' : 'Post'}</span>
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Evidence Version History & Access Telemetry */}
      <div className="grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-6 glass-panel rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center gap-2">
            <FileClock className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-semibold text-white">Exhibit Version History</h4>
          </div>
          <div className="p-4 space-y-3 max-h-[280px] overflow-y-auto">
            {safeEvidence.length === 0 ? (
              <div className="text-xs text-slate-400">No evidence artifacts ingested.</div>
            ) : (
              safeEvidence.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-lg bg-slate-950/85 border border-slate-800 p-3 text-xs space-y-1.5"
                >
                  <div className="font-semibold text-white">{ev.originalFilename}</div>
                  {Array.isArray(ev.versions) && ev.versions.length > 0 ? (
                    <div className="space-y-1">
                      {ev.versions.map((v) => (
                        <div
                          key={v.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-300 bg-slate-900/70 px-2.5 py-1.5 rounded"
                        >
                          <span>
                            v{v.versionNumber} · {v.note}
                          </span>
                          <span className="text-slate-500">
                            {v.updatedBy} · {new Date(v.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] font-mono text-slate-500">
                      v1 · Sealed original SHA-256 {ev.sha256.slice(0, 14)}...
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="lg:col-span-6 glass-panel rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center gap-2">
            <Eye className="w-4 h-4 text-cyan-400" />
            <h4 className="text-sm font-semibold text-white">Evidence Vault Access Log</h4>
          </div>
          <div className="p-4 space-y-2 max-h-[280px] overflow-y-auto">
            {safeAccessLogs.length === 0 ? (
              <div className="text-xs text-slate-400">
                No evidence view or download access events recorded yet.
              </div>
            ) : (
              safeAccessLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/85 border border-slate-800 px-3 py-2 text-[11px] font-mono"
                >
                  <div>
                    <span className="text-cyan-300 font-semibold">{log.action.toUpperCase()}</span>
                    <span className="text-slate-400">
                      {' '}
                      · {evidenceNameMap.get(log.evidenceId) || log.evidenceId.slice(0, 8)}
                    </span>
                    <div className="text-slate-300 font-sans">Accessed by {log.userName}</div>
                  </div>
                  <div className="text-right text-slate-500 tabular-nums">
                    <div>ip:{log.ipHash}</div>
                    <div>{new Date(log.createdAt).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
