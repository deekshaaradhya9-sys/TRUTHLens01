import React, { useCallback, useEffect, useState } from 'react';
import {
  User,
  X,
  ShieldCheck,
  KeyRound,
  MailCheck,
  Laptop,
  Trash2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type { ActiveSessionItem, AuthUser } from '../types/forensics.ts';

interface ProfileSecurityModalProps {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onClose: () => void;
}

export const ProfileSecurityModal: React.FC<ProfileSecurityModalProps> = ({
  user,
  onUserUpdated,
  onClose,
}) => {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [phone, setPhone] = useState(user.phone || '');
  const [department, setDepartment] = useState(user.department || '');
  const [badgeId, setBadgeId] = useState(user.badgeId || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [verifyingEmail, setVerifyingEmail] = useState(false);

  const [sessions, setSessions] = useState<ActiveSessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await apiRequest<{ sessions: ActiveSessionItem[] }>('/api/auth/sessions');
      setSessions(Array.isArray(res.sessions) ? res.sessions : []);
    } catch {
      // ignore non-fatal
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setBanner(null);
    try {
      const res = await apiRequest<{ user: AuthUser }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName, phone, department, badgeId }),
      });
      onUserUpdated(res.user);
      setBanner({ kind: 'ok', text: 'Investigator profile updated.' });
    } catch (err) {
      setBanner({ kind: 'err', text: err instanceof Error ? err.message : 'Profile update failed.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    setBanner(null);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setBanner({ kind: 'ok', text: 'Password updated successfully.' });
    } catch (err) {
      setBanner({ kind: 'err', text: err instanceof Error ? err.message : 'Password change failed.' });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleResendVerification = async () => {
    setVerifyingEmail(true);
    setBanner(null);
    try {
      const res = await apiRequest<{ ok: boolean; status: string; detail: string }>(
        '/api/auth/resend-verification',
        { method: 'POST' },
      );
      setBanner({
        kind: res.ok ? 'ok' : 'warn',
        text: res.detail || `Verification email status: ${res.status}`,
      });
    } catch (err) {
      setBanner({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to send verification.' });
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleVerifyToken = async () => {
    if (!verifyTokenInput.trim()) return;
    setVerifyingEmail(true);
    setBanner(null);
    try {
      await apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verifyTokenInput.trim() }),
      });
      onUserUpdated({ ...user, emailVerified: true });
      setVerifyTokenInput('');
      setBanner({ kind: 'ok', text: 'Email address verified!' });
    } catch (err) {
      setBanner({ kind: 'err', text: err instanceof Error ? err.message : 'Invalid verification token.' });
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await apiRequest(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
      await loadSessions();
      setBanner({ kind: 'ok', text: 'Session revoked.' });
    } catch (err) {
      setBanner({ kind: 'err', text: err instanceof Error ? err.message : 'Unable to revoke session.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl glass-panel rounded-2xl p-6 space-y-5 my-8">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <User className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                Account Profile &amp; Security
              </h2>
              <p className="text-xs font-mono text-slate-400">
                {user.email} · Role: <span className="text-cyan-300 uppercase">{user.role.replace(/_/g, ' ')}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Profile Modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {banner && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs flex items-center gap-2 ${
              banner.kind === 'err'
                ? 'bg-rose-950/40 border-rose-700/60 text-rose-200'
                : banner.kind === 'warn'
                  ? 'bg-amber-950/35 border-amber-700/60 text-amber-200'
                  : 'bg-emerald-950/35 border-emerald-700/60 text-emerald-200'
            }`}
          >
            {banner.kind === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
        )}

        {/* Email Verification Status */}
        <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <MailCheck className="w-4 h-4 text-cyan-400" />
              <span>Email Verification Status</span>
            </div>
            <span
              className={`text-xs font-mono px-2 py-0.5 rounded ${
                user.emailVerified
                  ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-700/50'
                  : 'bg-amber-950/60 text-amber-300 border border-amber-700/50'
              }`}
            >
              {user.emailVerified ? 'VERIFIED' : 'PENDING VERIFICATION'}
            </span>
          </div>

          {!user.emailVerified && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={verifyingEmail}
                className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-cyan-200 cursor-pointer disabled:opacity-50"
              >
                Resend Verification Email
              </button>
              <input
                type="text"
                value={verifyTokenInput}
                onChange={(e) => setVerifyTokenInput(e.target.value)}
                placeholder="Paste verification token"
                className="flex-1 min-w-[160px] px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white"
              />
              <button
                type="button"
                onClick={handleVerifyToken}
                disabled={verifyingEmail || !verifyTokenInput.trim()}
                className="px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-xs cursor-pointer disabled:opacity-50"
              >
                Confirm Token
              </button>
            </div>
          )}
        </div>

        {/* Profile Details Form */}
        <form onSubmit={handleSaveProfile} className="space-y-3 rounded-xl bg-slate-950/70 border border-slate-800 p-4">
          <div className="text-xs font-mono uppercase tracking-wider text-slate-400">
            Investigator Identity Metadata
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Display Name</label>
              <input
                type="text"
                required
                minLength={2}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Phone (E.164)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+919876543210"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Department / Unit</label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Badge / Analyst ID</label>
              <input
                type="text"
                value={badgeId}
                onChange={(e) => setBadgeId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-white"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingProfile}
              className="px-4 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>

        {/* Change Password */}
        {!user.isDemoUser && (
          <form onSubmit={handleChangePassword} className="space-y-3 rounded-xl bg-slate-950/70 border border-slate-800 p-4">
            <div className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-slate-400">
              <KeyRound className="w-3.5 h-3.5 text-violet-400" />
              <span>Change Password</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
              />
              <input
                type="password"
                required
                minLength={10}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 10 chars, Aa1!)"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingPassword}
                className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-white text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {savingPassword ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        )}

        {/* Active Sessions */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Active Authenticated Sessions ({sessions.length})</span>
          </div>
          {loadingSessions ? (
            <div className="text-xs text-slate-400">Loading active sessions...</div>
          ) : (
            <div className="max-h-44 overflow-y-auto space-y-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-slate-200 font-medium truncate">
                      <Laptop className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">{s.userAgent || 'Browser Session'}</span>
                      {s.isCurrent && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 font-mono text-[10px] shrink-0">
                          CURRENT
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      IP Hash: {s.ipHash} · Last active {new Date(s.lastActiveAt || s.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {!s.isCurrent && (
                    <button
                      type="button"
                      onClick={() => handleRevokeSession(s.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-950/40 text-[11px] cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Revoke</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
