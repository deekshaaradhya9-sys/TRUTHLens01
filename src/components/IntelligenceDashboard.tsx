import React, { useEffect, useState } from 'react';
import {
  Activity,
  Briefcase,
  CheckCircle2,
  Clock,
  FolderPlus,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  Users,
  ArrowRight,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type { CaseSummary, IntelligenceSummary } from '../types/forensics.ts';

interface IntelligenceDashboardProps {
  casesList: CaseSummary[];
  canCreateCase: boolean;
  onSelectCase: (caseId: string, targetTab?: 'register' | 'lab') => void;
  onOpenNewCase: () => void;
}

const PRIORITY_STYLES: Record<string, { label: string; bar: string; text: string }> = {
  critical: { label: 'Critical', bar: 'bg-rose-500', text: 'text-rose-300' },
  high: { label: 'High', bar: 'bg-amber-400', text: 'text-amber-300' },
  medium: { label: 'Medium', bar: 'bg-cyan-400', text: 'text-cyan-300' },
  low: { label: 'Low', bar: 'bg-emerald-400', text: 'text-emerald-300' },
};

export const IntelligenceDashboard: React.FC<IntelligenceDashboardProps> = ({
  casesList,
  canCreateCase,
  onSelectCase,
  onOpenNewCase,
}) => {
  const [summary, setSummary] = useState<IntelligenceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<IntelligenceSummary>('/api/intelligence/summary');
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, [casesList.length]);

  const statusEntries = Object.entries(summary?.statusCounts ?? {}).sort((a, b) => b[1] - a[1]);
  const totalCases = summary?.totalCases ?? 0;
  const maxPriorityCount = Math.max(
    1,
    summary?.priorityCounts?.critical ?? 0,
    summary?.priorityCounts?.high ?? 0,
    summary?.priorityCounts?.medium ?? 0,
    summary?.priorityCounts?.low ?? 0,
  );
  const recentActivity = Array.isArray(summary?.recentActivity) ? summary.recentActivity : [];
  const safeCases = Array.isArray(casesList) ? casesList : [];

  return (
    <div className="space-y-6">
      <div className="glass-panel rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
            Investigation Intelligence Command
          </div>
          <h2 className="font-display text-xl font-bold text-white mt-0.5">
            Active Operations, Triage &amp; Forensic Workload
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time overview across assigned cases, calibrated risk indicators, pending human sign-offs, and custody ledger activity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={loadSummary}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Metrics</span>
          </button>
          {canCreateCase && (
            <button
              type="button"
              onClick={onOpenNewCase}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 hover:from-cyan-300 hover:to-violet-400 text-slate-950 text-xs font-semibold cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Register Investigation</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          {
            label: 'Total Cases',
            value: summary?.totalCases ?? safeCases.length,
            icon: <Briefcase className="w-4 h-4 text-cyan-400" />,
            accent: 'border-cyan-500/25',
          },
          {
            label: 'Active Cases',
            value: summary?.activeCases ?? 0,
            icon: <Activity className="w-4 h-4 text-sky-400" />,
            accent: 'border-sky-500/25',
          },
          {
            label: 'Resolved / Closed',
            value: summary?.closedCases ?? 0,
            icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
            accent: 'border-emerald-500/25',
          },
          {
            label: 'Pending Reviews',
            value: summary?.pendingReviews ?? 0,
            icon: <Clock className="w-4 h-4 text-amber-400" />,
            accent: 'border-amber-500/25',
          },
          {
            label: 'Assigned to Me',
            value: summary?.assignedToMe ?? 0,
            icon: <UserCheck className="w-4 h-4 text-violet-400" />,
            accent: 'border-violet-500/25',
          },
          {
            label: 'Active Investigators',
            value: summary?.assignedInvestigatorsCount ?? 0,
            icon: <Users className="w-4 h-4 text-teal-400" />,
            accent: 'border-teal-500/25',
          },
        ].map((kpi) => (
          <div key={kpi.label} className={`glass-card rounded-xl p-4 border ${kpi.accent} space-y-2`}>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{kpi.label}</span>
              {kpi.icon}
            </div>
            <div className="font-display text-2xl font-bold text-white tabular-nums">
              {loading && !summary ? '—' : kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Priority & Status Distribution */}
      <div className="grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 glass-panel rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Priority Breakdown</h3>
            <span className="text-[11px] font-mono text-slate-400 tabular-nums">
              {totalCases} total
            </span>
          </div>

          <div className="space-y-3">
            {(['critical', 'high', 'medium', 'low'] as const).map((key) => {
              const count = summary?.priorityCounts?.[key] ?? 0;
              const pct = Math.round((count / maxPriorityCount) * 100);
              const meta = PRIORITY_STYLES[key];
              return (
                <div key={key} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${meta.text}`}>{meta.label} Priority</span>
                    <span className="font-mono text-slate-300 tabular-nums">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                    <div
                      className={`h-full ${meta.bar} transition-all duration-300`}
                      style={{ width: `${count === 0 ? 0 : Math.max(6, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="lg:col-span-7 glass-panel rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Investigation Lifecycle Statuses</h3>
            <span className="text-[11px] font-mono text-slate-400">12-stage workflow</span>
          </div>

          {statusEntries.length === 0 ? (
            <div className="text-xs text-slate-400 py-4">
              No cases registered yet in this workspace.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {statusEntries.map(([st, count]) => (
                <div
                  key={st}
                  className="rounded-lg bg-slate-950/85 border border-slate-800 px-3 py-2.5 flex items-center justify-between text-xs"
                >
                  <span className="text-slate-300 capitalize">{st.replace(/_/g, ' ')}</span>
                  <span className="font-mono font-semibold text-cyan-300 tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent Cases & Timeline Activity */}
      <div className="grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 glass-panel rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Recent Investigations</h3>
            <span className="text-[11px] font-mono text-slate-400">
              Click to open dossier or lab
            </span>
          </div>
          <div className="divide-y divide-slate-800/80 max-h-[340px] overflow-y-auto">
            {safeCases.length === 0 ? (
              <div className="p-5 text-xs text-slate-400">No accessible investigations found.</div>
            ) : (
              safeCases.slice(0, 8).map((c) => (
                <div
                  key={c.id}
                  className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-900/40 transition-colors"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                      <span className="text-cyan-300 font-semibold">
                        {c.caseNumber || c.id.slice(0, 8)}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-300 capitalize">
                        {(c.status || 'registered').replace(/_/g, ' ')}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span
                        className={
                          c.riskLevel === 'High'
                            ? 'text-rose-300'
                            : c.riskLevel === 'Medium'
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                        }
                      >
                        Risk: {c.riskLevel}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-white truncate">{c.title}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {c.assignedInvestigatorName
                        ? `Assigned: ${c.assignedInvestigatorName}`
                        : 'Unassigned'}
                      {c.incidentLocation ? ` · ${c.incidentLocation}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSelectCase(c.id, 'register')}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer"
                    >
                      Dossier
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectCase(c.id, 'lab')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/40 hover:border-cyan-400 text-xs text-cyan-200 cursor-pointer"
                    >
                      <span>Lab</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="lg:col-span-5 glass-panel rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">Live Case Activity Stream</h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">{recentActivity.length}</span>
          </div>
          <div className="p-4 space-y-2.5 max-h-[340px] overflow-y-auto">
            {recentActivity.length === 0 ? (
              <div className="text-xs text-slate-400">No recent investigation activity logged.</div>
            ) : (
              recentActivity.map((act) => (
                <div
                  key={act.id}
                  className="rounded-lg bg-slate-950/85 border border-slate-800 px-3 py-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="text-cyan-300 font-semibold">{act.action}</span>
                    <span className="text-slate-500 tabular-nums">
                      {new Date(act.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-slate-200">{act.summary}</div>
                  <div className="text-[11px] text-slate-500">By {act.actorName}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
