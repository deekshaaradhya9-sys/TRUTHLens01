import React, { useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type { EvidenceItem, FullCaseData, WitnessRecord } from '../types/forensics.ts';

interface WitnessesPanelProps {
  caseId: string;
  witnesses: WitnessRecord[];
  evidenceItems: EvidenceItem[];
  canManageWitnesses: boolean;
  canViewPii: boolean;
  userRole: string;
  onUpdated: (full: FullCaseData) => void;
}

export const WitnessesPanel: React.FC<WitnessesPanelProps> = ({
  caseId,
  witnesses,
  evidenceItems,
  canManageWitnesses,
  canViewPii,
  userRole,
  onUpdated,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [relationship, setRelationship] = useState('Eyewitness / Reporting Party');
  const [statement, setStatement] = useState('');
  const [consentGranted, setConsentGranted] = useState(true);
  const [privacyRedacted, setPrivacyRedacted] = useState(true);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmitStatement = canManageWitnesses || userRole === 'witness';
  const safeWitnesses = Array.isArray(witnesses) ? witnesses : [];
  const safeEvidence = Array.isArray(evidenceItems) ? evidenceItems : [];

  const handleRegisterWitness = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiRequest<FullCaseData>(`/api/cases/${caseId}/witnesses`, {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          email,
          phone,
          address,
          relationship,
          statement,
          consentGranted,
          privacyRedacted,
          verificationStatus: 'pending',
          linkedEvidenceIds: linkedIds,
        }),
      });
      onUpdated(updated);
      setFullName('');
      setEmail('');
      setPhone('');
      setAddress('');
      setStatement('');
      setLinkedIds([]);
      setNotice('Witness record saved. Confirmation email dispatched if address was provided.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register witness.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateWitness = async (
    witnessId: string,
    payload: { verificationStatus?: 'unverified' | 'pending' | 'verified'; privacyRedacted?: boolean },
  ) => {
    setError(null);
    try {
      const updated = await apiRequest<FullCaseData>(
        `/api/cases/${caseId}/witnesses/${witnessId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      );
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update witness record.');
    }
  };

  const handleDeleteWitness = async (witnessId: string) => {
    setError(null);
    try {
      const updated = await apiRequest<FullCaseData>(
        `/api/cases/${caseId}/witnesses/${witnessId}`,
        { method: 'DELETE' },
      );
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove witness record.');
    }
  };

  const evidenceNameMap = new Map(safeEvidence.map((e) => [e.id, e.originalFilename]));

  return (
    <div className="space-y-6">
      <div className="glass-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Witnesses &amp; Persons Register
              </h3>
              <p className="text-xs text-slate-400">
                Consent-gated witness statements with PII privacy redaction and evidence linking.
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300">
            <Lock className="w-3 h-3 text-cyan-400" />
            <span>
              {canViewPii ? 'Authorized PII View' : 'Protected Redacted View'}
            </span>
          </span>
        </div>

        {canSubmitStatement && (
          <form
            onSubmit={handleRegisterWitness}
            className="rounded-xl bg-slate-950/75 border border-slate-800 p-4 space-y-3 text-xs"
          >
            <div className="font-semibold text-cyan-200 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              <span>Register Witness / Related Person</span>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Witness / Informant Name"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Relationship / Role *</label>
                <input
                  type="text"
                  required
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  placeholder="Eyewitness, Victim, Analyst"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Email (for confirmation)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="witness@example.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 014 8821"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">Address / Jurisdiction</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Optional protected contact address"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Statement / Account</label>
              <textarea
                rows={3}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="Verbatim witness statement, observed timestamps, device context..."
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
              />
            </div>

            {safeEvidence.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-slate-400">Link Exhibits to This Statement</div>
                <div className="flex flex-wrap gap-2">
                  {safeEvidence.map((ev) => {
                    const checked = linkedIds.includes(ev.id);
                    return (
                      <label
                        key={ev.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border cursor-pointer ${
                          checked
                            ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                            : 'border-slate-800 bg-slate-950 text-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setLinkedIds((prev) =>
                              e.target.checked
                                ? [...prev, ev.id]
                                : prev.filter((id) => id !== ev.id),
                            )
                          }
                          className="accent-cyan-400"
                        />
                        <span>{ev.originalFilename}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentGranted}
                    onChange={(e) => setConsentGranted(e.target.checked)}
                    className="accent-cyan-400"
                  />
                  <span>Explicit witness consent documented *</span>
                </label>
                <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacyRedacted}
                    onChange={(e) => setPrivacyRedacted(e.target.checked)}
                    className="accent-cyan-400"
                  />
                  <span>Redact contact PII from non-privileged / public views</span>
                </label>
              </div>
              <button
                type="submit"
                disabled={busy || !consentGranted}
                className="px-4 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Recording...' : 'Register Witness'}
              </button>
            </div>
          </form>
        )}

        {notice && (
          <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/35 px-3 py-2 text-xs text-emerald-200">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {/* Witness List */}
        <div className="space-y-3">
          {safeWitnesses.length === 0 ? (
            <div className="text-xs text-slate-400 py-4">
              No witnesses or protected informants registered for this investigation yet.
            </div>
          ) : (
            safeWitnesses.map((w) => (
              <div
                key={w.id}
                className="rounded-xl bg-slate-950/85 border border-slate-800 p-4 space-y-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{w.fullName}</span>
                    <span className="text-slate-400">({w.relationship})</span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] uppercase ${
                        w.verificationStatus === 'verified'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : w.verificationStatus === 'pending'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {w.verificationStatus}
                    </span>
                    {w.privacyRedacted && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 font-mono text-[10px]">
                        <EyeOff className="w-3 h-3" />
                        <span>Privacy Shield</span>
                      </span>
                    )}
                  </div>

                  {canManageWitnesses && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateWitness(w.id, {
                            verificationStatus:
                              w.verificationStatus === 'verified' ? 'pending' : 'verified',
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:border-emerald-400 text-[11px] text-slate-200 cursor-pointer"
                      >
                        {w.verificationStatus === 'verified' ? (
                          <UserCheck className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3 text-amber-400" />
                        )}
                        <span>
                          {w.verificationStatus === 'verified' ? 'Verified' : 'Mark Verified'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateWitness(w.id, { privacyRedacted: !w.privacyRedacted })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:border-cyan-400 text-[11px] text-slate-200 cursor-pointer"
                      >
                        {w.privacyRedacted ? (
                          <Eye className="w-3 h-3 text-cyan-400" />
                        ) : (
                          <EyeOff className="w-3 h-3 text-violet-400" />
                        )}
                        <span>{w.privacyRedacted ? 'Redacted' : 'Redact PII'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteWitness(w.id)}
                        className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-rose-300 cursor-pointer"
                        aria-label={`Remove ${w.fullName}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid sm:grid-cols-3 gap-2 font-mono text-[11px] text-slate-400">
                  <div>Email: {w.email || 'Not provided / Redacted'}</div>
                  <div>Phone: {w.phone || 'Not provided / Redacted'}</div>
                  <div>Address: {w.address || 'Not provided / Redacted'}</div>
                </div>

                {w.statement && (
                  <p className="text-slate-200 leading-relaxed bg-slate-900/70 border border-slate-800/80 rounded-lg p-3">
                    {w.statement}
                  </p>
                )}

                {Array.isArray(w.linkedEvidenceIds) && w.linkedEvidenceIds.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500 font-mono">Linked Exhibits:</span>
                    {w.linkedEvidenceIds.map((eid) => (
                      <span
                        key={eid}
                        className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-200 font-mono"
                      >
                        {evidenceNameMap.get(eid) || eid.slice(0, 8)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
