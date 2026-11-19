import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  FolderCog,
  KeyRound,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  UserCog,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type {
  AuthUser,
  CaseCategoryDef,
  SecurityAuditReport,
  SecurityOverviewData,
  UserRole,
} from '../types/forensics.ts';

interface SecurityAuditConsoleProps {
  currentUser?: AuthUser | null;
  onCategoriesChanged?: () => Promise<void> | void;
  onRoleUpdated?: () => Promise<void> | void;
}

const SEVEN_ROLES: UserRole[] = [
  'super_admin',
  'investigation_admin',
  'senior_investigator',
  'investigator',
  'evidence_officer',
  'witness',
  'viewer',
];

export const SecurityAuditConsole: React.FC<SecurityAuditConsoleProps> = ({
  currentUser = null,
  onCategoriesChanged,
  onRoleUpdated,
}) => {
  const [data, setData] = useState<SecurityOverviewData | null>(null);
  const [auditReport, setAuditReport] = useState<SecurityAuditReport | null>(null);
  const [adminCategories, setAdminCategories] = useState<CaseCategoryDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create custom category form (for investigation_admin / super_admin)
  const [catSlug, setCatSlug] = useState('');
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catReq, setCatReq] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overview, audit] = await Promise.all([
        apiRequest<SecurityOverviewData>('/api/security/overview'),
        apiRequest<SecurityAuditReport>('/api/security/audit'),
      ]);
      setData(overview);
      setAuditReport(audit);
      if (overview.isAdmin) {
        const catRes = await apiRequest<{ categories: CaseCategoryDef[] }>('/api/admin/categories');
        setAdminCategories(Array.isArray(catRes.categories) ? catRes.categories : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load security overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleRevokeSession = async (sessionId: string) => {
    setError(null);
    try {
      await apiRequest(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
      setNotice('Session revoked.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke session.');
    }
  };

  const handleUpdateUserRole = async (userId: string, role: UserRole, active: boolean) => {
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role, active }),
      });
      setNotice('User RBAC role & status updated.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update user role.');
    }
  };

  const handleToggleCategory = async (cat: CaseCategoryDef) => {
    if (!cat.id) return;
    setError(null);
    try {
      await apiRequest(`/api/admin/categories/${cat.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !cat.enabled }),
      });
      await loadAll();
      await onCategoriesChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to toggle category.');
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingCat(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({
          slug: catSlug.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          name: catName.trim(),
          description: catDesc.trim(),
          evidenceRequirements: catReq
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          enabled: true,
        }),
      });
      setCatSlug('');
      setCatName('');
      setCatDesc('');
      setCatReq('');
      setNotice('Custom investigation category created.');
      await loadAll();
      await onCategoriesChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create category.');
    } finally {
      setCreatingCat(false);
    }
  };

  const handleBootstrapAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bootstrapSecret.trim()) return;
    setBootstrapping(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/api/admin/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ bootstrapSecret: bootstrapSecret.trim() }),
      });
      setBootstrapSecret('');
      setNotice('Administrator privileges granted via timing-safe server bootstrap verification.');
      await loadAll();
      await onRoleUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Administrator bootstrap rejected.');
    } finally {
      setBootstrapping(false);
    }
  };

  const sessions = Array.isArray(data?.mySessions) ? data.mySessions : [];
  const failedAlerts = Array.isArray(data?.failedLoginAlerts) ? data.failedLoginAlerts : [];
  const myAuditLogs = Array.isArray(data?.myAuditLogs) ? data.myAuditLogs : [];
  const adminUsers = Array.isArray(data?.adminPanel?.users) ? data.adminPanel.users : [];
  const sysAuditLogs = Array.isArray(data?.adminPanel?.systemAuditLogs)
    ? data.adminPanel.systemAuditLogs
    : [];

  return (
    <div className="space-y-6">
      <div className="glass-panel rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="font-display text-lg font-bold text-white">
              Security, Sessions, 7-Role RBAC &amp; Audit Console
            </h2>
            <p className="text-xs text-slate-400">
              Monitor active sessions, failed sign-in attempts, audit trails, and role-based access administration.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadAll}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Security Log</span>
        </button>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/35 px-4 py-2.5 text-xs text-emerald-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-2.5 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Live 10-Check Security Hardening Audit Matrix */}
      {auditReport && (
        <section className="glass-panel rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">
                Automated Platform Security Audit Matrix ({auditReport.passedCount}/{auditReport.totalChecks} Passed)
              </h3>
            </div>
            <span
              className={`px-2.5 py-1 rounded font-mono text-[11px] border ${
                auditReport.overallStatus === 'HARDENED'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              }`}
            >
              {auditReport.overallStatus}
            </span>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
            {auditReport.checks.map((chk) => (
              <div
                key={chk.id}
                className="rounded-lg bg-slate-950/85 border border-slate-800 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-semibold text-slate-100 leading-tight">{chk.label}</span>
                  <CheckCircle2
                    className={`w-3.5 h-3.5 shrink-0 ${
                      chk.status === 'pass' ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  />
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">{chk.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Administrator Privilege Bootstrap (non-admin, non-demo users only) */}
      {data && !data.isAdmin && currentUser && !currentUser.isDemoUser && (
        <section className="glass-panel rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">
              Administrator Privilege Bootstrap
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            New accounts always start with standard investigator privileges to prevent privilege escalation. If the server operator provisioned <span className="font-mono text-slate-300">ADMIN_BOOTSTRAP_SECRET</span>, verify it here using timing-safe comparison to unlock Super Admin RBAC governance.
          </p>
          <form onSubmit={handleBootstrapAdmin} className="flex flex-col sm:flex-row gap-2.5 text-xs">
            <input
              type="password"
              required
              minLength={16}
              value={bootstrapSecret}
              onChange={(e) => setBootstrapSecret(e.target.value)}
              placeholder="Enter server ADMIN_BOOTSTRAP_SECRET..."
              className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-violet-400"
            />
            <button
              type="submit"
              disabled={bootstrapping || bootstrapSecret.trim().length < 16}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-400 to-cyan-400 text-slate-950 font-semibold cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {bootstrapping ? 'Verifying...' : 'Elevate to Super Admin'}
            </button>
          </form>
        </section>
      )}

      {/* Personal Sessions & Failed Logins */}
      <div className="grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-6 glass-panel rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <KeyRound className="w-4 h-4 text-cyan-400" />
              <span>Your Active Sessions ({sessions.length})</span>
            </div>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/85 border border-slate-800 px-3 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="text-slate-200 truncate font-medium">
                    {s.userAgent || 'Authenticated Client'}
                    {s.isCurrent && (
                      <span className="ml-2 text-[10px] font-mono text-emerald-300">
                        (CURRENT)
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    ip:{s.ipHash} · Last active: {new Date(s.lastActiveAt).toLocaleString()}
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    onClick={() => handleRevokeSession(s.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-950/40 text-[11px] cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Revoke</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-6 glass-panel rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>Failed Sign-In Alerts ({failedAlerts.length})</span>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {failedAlerts.length === 0 ? (
              <div className="text-xs text-slate-400">
                No recent failed authentication alerts on your account.
              </div>
            ) : (
              failedAlerts.map((f) => (
                <div
                  key={f.id}
                  className="rounded-lg bg-amber-950/25 border border-amber-800/50 px-3 py-2 text-xs font-mono"
                >
                  <div className="text-amber-300">{f.details}</div>
                  <div className="text-[11px] text-slate-400">
                    ip:{f.ipHash} · {new Date(f.createdAt).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Super Admin: 7-Role User Governance */}
      {data?.isAdmin && data.adminPanel && (
        <section className="glass-panel rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UserCog className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">
                7-Role RBAC User Management ({data.adminPanel.totalUsers} accounts ·{' '}
                {data.adminPanel.totalCases} total cases)
              </h3>
            </div>
            {!data.canManageRoles && (
              <span className="text-[11px] font-mono text-amber-300">
                Read-only view (Super Admin required to modify roles)
              </span>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-mono uppercase text-[11px]">
                <tr>
                  <th className="px-3 py-2.5">User</th>
                  <th className="px-3 py-2.5">Department / Badge</th>
                  <th className="px-3 py-2.5">Email Verified</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {adminUsers.map((u) => (
                  <tr key={u.id}>
                    <td className="px-3 py-2.5">
                      <div className="text-white font-medium">{u.displayName}</div>
                      <div className="text-[11px] font-mono text-slate-400">{u.email}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">
                      {u.department || '—'} {u.badgeId ? `· ${u.badgeId}` : ''}
                    </td>
                    <td className="px-3 py-2.5 font-mono">
                      <span className={u.emailVerified ? 'text-emerald-300' : 'text-amber-300'}>
                        {u.emailVerified ? 'VERIFIED' : 'UNVERIFIED'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        disabled={!data.canManageRoles}
                        value={u.role}
                        onChange={(e) =>
                          handleUpdateUserRole(u.id, e.target.value as UserRole, u.active)
                        }
                        className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-200"
                      >
                        {SEVEN_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        disabled={!data.canManageRoles}
                        onClick={() =>
                          handleUpdateUserRole(u.id, u.role as UserRole, !u.active)
                        }
                        className={`px-2.5 py-1 rounded font-mono text-[11px] cursor-pointer disabled:opacity-50 ${
                          u.active
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {u.active ? 'ACTIVE' : 'SUSPENDED'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Admin Investigation Category Management (20 defaults + Custom) */}
      {data?.isAdmin && (
        <section className="glass-panel rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FolderCog className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">
              Investigation Category Registry ({adminCategories.length} configured)
            </h3>
          </div>

          <form
            onSubmit={handleCreateCategory}
            className="rounded-xl bg-slate-950/75 border border-slate-800 p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs"
          >
            <input
              type="text"
              required
              value={catSlug}
              onChange={(e) => setCatSlug(e.target.value)}
              placeholder="slug (e.g. maritime_fraud)"
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
            />
            <input
              type="text"
              required
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="Category Display Name"
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
            />
            <input
              type="text"
              value={catDesc}
              onChange={(e) => setCatDesc(e.target.value)}
              placeholder="Short description..."
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
            />
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={catReq}
                onChange={(e) => setCatReq(e.target.value)}
                placeholder="Requirements (comma-sep)"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
              />
              <button
                type="submit"
                disabled={creatingCat}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-cyan-400 text-slate-950 font-semibold cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </form>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5 max-h-64 overflow-y-auto">
            {adminCategories.map((c) => (
              <div
                key={c.slug}
                className="rounded-lg bg-slate-950/85 border border-slate-800 px-3 py-2.5 text-xs flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-slate-200 font-medium truncate">{c.name}</div>
                  <div className="text-[10px] font-mono text-slate-500">{c.slug}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleCategory(c)}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] cursor-pointer shrink-0 ${
                    c.enabled
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {c.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* System / Personal Audit Logs */}
      <section className="glass-panel rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {data?.isAdmin ? 'System-Wide Security Audit Stream' : 'Personal Security Audit Log'}
          </h3>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            {(data?.isAdmin ? sysAuditLogs : myAuditLogs).length} records
          </span>
        </div>
        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {(data?.isAdmin ? sysAuditLogs : myAuditLogs).map((log) => (
            <div
              key={log.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/85 border border-slate-800 px-3 py-2 text-[11px] font-mono"
            >
              <div>
                <span className="text-cyan-300 font-semibold">{log.action}</span>
                <span className="text-slate-500"> · {log.resourceType}</span>
                <div className="text-slate-300 font-sans">{log.details}</div>
              </div>
              <div className="text-right text-slate-500 tabular-nums">
                <div>ip:{log.ipHash}</div>
                <div>{new Date(log.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
