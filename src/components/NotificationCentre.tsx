import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  Filter,
  KeyRound,
  Mail,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  Trash2,
  Webhook,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type {
  GlobalNotificationPreferences,
  InAppNotificationItem,
  NotificationContactItem,
  NotificationLogItem,
  NotificationWebhookEventItem,
  ProviderHealthCheck,
} from '../types/forensics.ts';
import { useI18n } from '../i18n/translations.ts';

interface NotificationCentreProps {
  activeCaseId: string | null;
  activeCaseTitle: string;
  emailProviderType?: 'resend' | 'smtp' | 'none';
  onOpenCase?: (caseId: string) => void;
  onInAppChanged?: (unreadCount: number) => void;
}

interface NotificationStatusResponse {
  emailConfigured: boolean;
  smsConfigured: boolean;
  emailProviderType: 'resend' | 'smtp' | 'none';
  emailHealth?: ProviderHealthCheck;
  smsHealth?: ProviderHealthCheck;
  missingEmailEnv?: string[];
  missingSmsEnv?: string[];
  lastDeliveredAt?: number | null;
  webhookHealth?: {
    callbackBaseConfigured: boolean;
    resendSecretConfigured: boolean;
    twilioSignatureValidationActive: boolean;
    recentEventsCount: number;
    lastReceivedAt: number | null;
  };
  preferences?: GlobalNotificationPreferences;
  contacts: NotificationContactItem[];
  logs: NotificationLogItem[];
  webhookEvents?: NotificationWebhookEventItem[];
}

const COUNTRY_CODES = [
  { code: '+91', label: '+91 (IN)' },
  { code: '+1', label: '+1 (US/CA)' },
  { code: '+44', label: '+44 (UK)' },
  { code: '+61', label: '+61 (AU)' },
  { code: '+65', label: '+65 (SG)' },
  { code: '+971', label: '+971 (AE)' },
  { code: '+49', label: '+49 (DE)' },
  { code: '+33', label: '+33 (FR)' },
  { code: '+81', label: '+81 (JP)' },
];

function formatDisplayStatus(raw: string): string {
  const s = (raw || 'pending').toLowerCase();
  if (s === 'not_configured') return 'NOT CONFIGURED';
  if (s === 'ready') return 'READY';
  if (s === 'pending' || s === 'queued') return 'PENDING';
  if (s === 'sent') return 'SENT';
  if (s === 'delivered') return 'DELIVERED';
  if (s === 'failed') return 'FAILED';
  if (s === 'retrying') return 'RETRYING';
  if (s === 'expired') return 'EXPIRED';
  if (s === 'skipped_duplicate') return 'SKIPPED (DEDUPE)';
  if (s === 'skipped_paused') return 'PAUSED';
  if (s === 'skipped_preference') return 'MUTED BY PREF';
  return raw.toUpperCase();
}

function getStatusBadgeClass(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s === 'delivered' || s === 'ready') {
    return 'bg-emerald-950/60 border-emerald-600/50 text-emerald-300';
  }
  if (s === 'sent') {
    return 'bg-cyan-950/60 border-cyan-600/50 text-cyan-200';
  }
  if (s === 'pending' || s === 'retrying') {
    return 'bg-sky-950/60 border-sky-600/50 text-sky-200';
  }
  if (s === 'failed' || s === 'expired' || s === 'locked') {
    return 'bg-rose-950/60 border-rose-600/50 text-rose-200';
  }
  return 'bg-amber-950/60 border-amber-600/50 text-amber-200';
}

export const NotificationCentre: React.FC<NotificationCentreProps> = ({
  activeCaseId,
  activeCaseTitle,
  emailProviderType = 'none',
  onOpenCase,
  onInAppChanged,
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [refreshingHealth, setRefreshingHealth] = useState(false);

  const [emailHealth, setEmailHealth] = useState<ProviderHealthCheck | null>(null);
  const [smsHealth, setSmsHealth] = useState<ProviderHealthCheck | null>(null);
  const [missingEmailEnv, setMissingEmailEnv] = useState<string[]>([]);
  const [missingSmsEnv, setMissingSmsEnv] = useState<string[]>([]);
  const [lastDeliveredAt, setLastDeliveredAt] = useState<number | null>(null);
  const [webhookHealth, setWebhookHealth] = useState<NotificationStatusResponse['webhookHealth'] | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<NotificationWebhookEventItem[]>([]);

  const [globalPrefs, setGlobalPrefs] = useState<GlobalNotificationPreferences | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const [contacts, setContacts] = useState<NotificationContactItem[]>([]);
  const [logs, setLogs] = useState<NotificationLogItem[]>([]);
  const [inAppList, setInAppList] = useState<InAppNotificationItem[]>([]);

  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [countryCode, setCountryCode] = useState('+91');
  const [destination, setDestination] = useState('');
  const [consentGranted, setConsentGranted] = useState(false);
  const [eventPrefs, setEventPrefs] = useState({
    analysis_completed: true,
    high_risk_indicator: true,
    case_updated: false,
    ledger_verification_alert: true,
  });

  const [submitting, setSubmitting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [testingChannel, setTestingChannel] = useState<'email' | 'sms' | 'all' | null>(null);
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
  const [verifyCodes, setVerifyCodes] = useState<Record<string, string>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [logChannelFilter, setLogChannelFilter] = useState<'all' | 'email' | 'sms'>('all');
  const [logStatusFilter, setLogStatusFilter] = useState<string>('all');
  const [banner, setBanner] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);

  const loadStatus = useCallback(
    async (refreshProviders = false) => {
      if (refreshProviders) setRefreshingHealth(true);
      else setLoading(true);

      try {
        const [statusRes, inAppRes] = await Promise.all([
          apiRequest<NotificationStatusResponse>(
            `/api/notifications/status${refreshProviders ? '?refresh=true' : ''}`,
          ),
          apiRequest<{ notifications: InAppNotificationItem[]; unreadCount: number }>(
            '/api/notifications/in-app',
          ),
        ]);
        setEmailHealth(statusRes.emailHealth ?? null);
        setSmsHealth(statusRes.smsHealth ?? null);
        setMissingEmailEnv(statusRes.missingEmailEnv ?? []);
        setMissingSmsEnv(statusRes.missingSmsEnv ?? []);
        setLastDeliveredAt(statusRes.lastDeliveredAt ?? null);
        setWebhookHealth(statusRes.webhookHealth ?? null);
        setWebhookEvents(Array.isArray(statusRes.webhookEvents) ? statusRes.webhookEvents : []);
        if (statusRes.preferences) setGlobalPrefs(statusRes.preferences);
        setContacts(Array.isArray(statusRes.contacts) ? statusRes.contacts : []);
        setLogs(Array.isArray(statusRes.logs) ? statusRes.logs : []);
        const notifs = Array.isArray(inAppRes.notifications) ? inAppRes.notifications : [];
        setInAppList(notifs);
        onInAppChanged?.(inAppRes.unreadCount ?? notifs.filter((n) => !n.read).length);
      } catch (err) {
        setBanner({
          kind: 'error',
          text: err instanceof Error ? err.message : 'Unable to load notification status.',
        });
      } finally {
        setLoading(false);
        setRefreshingHealth(false);
      }
    },
    [onInAppChanged],
  );

  useEffect(() => {
    loadStatus(false);
  }, [loadStatus]);

  // Live 1-second timer for OTP resend cooldown countdowns
  useEffect(() => {
    const hasPendingCooldown = contacts.some(
      (c) => !c.verified && (c.resendAvailableAt ?? 0) > Date.now(),
    );
    if (!hasPendingCooldown) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [contacts]);

  const handleMarkRead = async (id: string) => {
    await apiRequest(`/api/notifications/in-app/${id}/read`, { method: 'POST' }).catch(() => {});
    setInAppList((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      onInAppChanged?.(next.filter((n) => !n.read).length);
      return next;
    });
  };

  const handleMarkAllRead = async () => {
    await apiRequest('/api/notifications/in-app/read-all', { method: 'POST' }).catch(() => {});
    setInAppList((prev) => prev.map((n) => ({ ...n, read: true })));
    onInAppChanged?.(0);
  };

  const handleRegisterContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentGranted) {
      setBanner({ kind: 'error', text: 'Explicit opt-in consent is required before adding an alert contact.' });
      return;
    }
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await apiRequest<{
        contactId: string;
        deliveryStatus: string;
        provider?: string;
        providerMessageId?: string | null;
        delivered: boolean;
        detail: string;
      }>('/api/notifications/contacts', {
        method: 'POST',
        body: JSON.stringify({
          channel,
          countryCode: channel === 'sms' ? countryCode : '',
          destination: destination.trim(),
          consentGranted,
          eventPrefs,
        }),
      });
      setDestination('');
      setConsentGranted(false);
      setBanner({
        kind: res.delivered ? 'info' : 'warn',
        text: `${res.detail}${res.providerMessageId ? ` [ID: ${res.providerMessageId}]` : ''}`,
      });
      await loadStatus(false);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to register alert contact.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async (contactId: string) => {
    setResendingId(contactId);
    setBanner(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        deliveryStatus: string;
        providerMessageId?: string | null;
        detail: string;
      }>(`/api/notifications/contacts/${contactId}/resend-otp`, { method: 'POST' });
      setBanner({
        kind: res.ok ? 'info' : 'warn',
        text: `${res.detail}${res.providerMessageId ? ` [ID: ${res.providerMessageId}]` : ''}`,
      });
      await loadStatus(false);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Unable to resend OTP.',
      });
    } finally {
      setResendingId(null);
    }
  };

  const handleVerifyContact = async (contactId: string) => {
    const code = (verifyCodes[contactId] ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      setBanner({ kind: 'error', text: 'Enter the 6-digit verification OTP sent to your contact.' });
      return;
    }
    setVerifyingId(contactId);
    setBanner(null);
    try {
      await apiRequest(`/api/notifications/contacts/${contactId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setVerifyCodes((prev) => ({ ...prev, [contactId]: '' }));
      setBanner({ kind: 'info', text: 'OTP verified! Contact is now active for forensic alerts.' });
      await loadStatus(false);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'OTP verification failed.',
      });
      await loadStatus(false);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleToggleGlobalPref = async (key: keyof GlobalNotificationPreferences) => {
    if (!globalPrefs || key === 'updatedAt') return;
    const nextVal = !globalPrefs[key];
    setSavingPrefs(true);
    try {
      const res = await apiRequest<{ preferences: GlobalNotificationPreferences }>(
        '/api/notifications/preferences',
        {
          method: 'PUT',
          body: JSON.stringify({ [key]: nextVal }),
        },
      );
      setGlobalPrefs(res.preferences);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Unable to save global preferences.',
      });
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleTogglePref = async (
    contact: NotificationContactItem,
    key: keyof NotificationContactItem['eventPrefs'],
  ) => {
    const updated = { ...contact.eventPrefs, [key]: !contact.eventPrefs[key] };
    try {
      await apiRequest(`/api/notifications/contacts/${contact.id}/prefs`, {
        method: 'PUT',
        body: JSON.stringify(updated),
      });
      setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, eventPrefs: updated } : c)));
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Unable to update preferences.',
      });
    }
  };

  const handleTogglePause = async (contact: NotificationContactItem) => {
    const nextPaused = !contact.paused;
    try {
      await apiRequest(`/api/notifications/contacts/${contact.id}/pause`, {
        method: 'PATCH',
        body: JSON.stringify({ paused: nextPaused }),
      });
      setContacts((prev) =>
        prev.map((c) => (c.id === contact.id ? { ...c, paused: nextPaused } : c)),
      );
      setBanner({
        kind: 'info',
        text: nextPaused
          ? 'Contact paused (opted out until resumed).'
          : 'Contact resumed for alert delivery.',
      });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Unable to toggle opt-out state.',
      });
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    try {
      await apiRequest(`/api/notifications/contacts/${contactId}`, { method: 'DELETE' });
      await loadStatus(false);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Unable to remove contact.',
      });
    }
  };

  const handleSendTest = async (targetChannel: 'email' | 'sms' | 'all') => {
    setTestingChannel(targetChannel);
    setBanner(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        results: Array<{
          channel: string;
          provider?: string;
          status: string;
          providerMessageId?: string | null;
          errorDetail?: string | null;
        }>;
      }>('/api/notifications/test', {
        method: 'POST',
        body: JSON.stringify({
          channel: targetChannel,
          caseId: activeCaseId ?? 'active-case',
          caseTitle: activeCaseTitle || 'TruthLens Case Check',
        }),
      });
      const safeResults = Array.isArray(res.results) ? res.results : [];
      if (safeResults.length === 0) {
        setBanner({
          kind: 'warn',
          text: `No verified, consented, unpaused ${targetChannel === 'all' ? '' : targetChannel.toUpperCase() + ' '}contacts active.`,
        });
      } else {
        setBanner({
          kind: res.ok ? 'info' : 'warn',
          text: safeResults
            .map(
              (r) =>
                `${r.channel.toUpperCase()} (${(r.provider || 'none').toUpperCase()}): ${formatDisplayStatus(r.status)}${
                  r.providerMessageId ? ` [ID: ${r.providerMessageId}]` : ''
                }${r.errorDetail ? ` — ${r.errorDetail}` : ''}`,
            )
            .join(' · '),
        });
      }
      await loadStatus(false);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Test alert failed.',
      });
    } finally {
      setTestingChannel(null);
    }
  };

  const handleRetryLog = async (logId: string) => {
    setRetryingLogId(logId);
    setBanner(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        status: string;
        provider?: string;
        providerMessageId?: string | null;
        detail: string;
      }>(`/api/notifications/logs/${logId}/retry`, { method: 'POST' });
      setBanner({
        kind: res.ok ? 'info' : 'warn',
        text: `Retry -> ${formatDisplayStatus(res.status)}: ${res.detail}`,
      });
      await loadStatus(false);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Retry failed.',
      });
    } finally {
      setRetryingLogId(null);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (logChannelFilter !== 'all' && log.channel !== logChannelFilter) return false;
      if (logStatusFilter === 'failed_or_unconfigured') {
        return log.status === 'failed' || log.status === 'not_configured' || log.status === 'expired';
      }
      if (logStatusFilter !== 'all' && log.status !== logStatusFilter) return false;
      return true;
    });
  }, [logs, logChannelFilter, logStatusFilter]);

  const unreadCount = inAppList.filter((n) => !n.read).length;
  const emailStatusLabel = emailHealth?.status ?? 'NOT_CONFIGURED';
  const smsStatusLabel = smsHealth?.status ?? 'NOT_CONFIGURED';

  return (
    <div className="space-y-6">
      {/* Real-Time In-App Notification Feed */}
      <div className="glass-panel rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">
              In-App Investigation Notifications ({unreadCount} unread)
            </h3>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-cyan-200 cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark All Read</span>
            </button>
          )}
        </div>

        {inAppList.length === 0 ? (
          <div className="text-xs text-slate-400">
            No in-app notifications yet. Case registrations, assignments, custody handoffs, and high-risk indicators appear here in real time.
          </div>
        ) : (
          <div className="max-h-52 overflow-y-auto space-y-2">
            {inAppList.map((n) => (
              <div
                key={n.id}
                className={`rounded-lg border px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
                  n.read
                    ? 'bg-slate-950/60 border-slate-800/80 text-slate-400'
                    : 'bg-cyan-950/25 border-cyan-500/40 text-slate-100'
                }`}
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="font-semibold flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-900 text-cyan-300">
                      {n.type.replace(/_/g, ' ')}
                    </span>
                    <span>{n.title}</span>
                  </div>
                  <p className="text-[11px] opacity-90">{n.body}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {n.caseId && onOpenCase && (
                    <button
                      type="button"
                      onClick={() => onOpenCase(n.caseId!)}
                      className="px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-cyan-400 text-[11px] text-cyan-200 cursor-pointer"
                    >
                      Open Case
                    </button>
                  )}
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(n.id)}
                      className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-300 cursor-pointer"
                    >
                      Mark Read
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* External Provider Health, Webhooks, Registration, Preferences & Audit */}
      <div className="glass-panel rounded-xl p-5 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-2.5">
            <Mail className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-base font-semibold text-white">{t.alertsTitle}</h3>
              <p className="text-xs text-slate-400">
                Real provider health verification · Resend / SMTP Email · Twilio SMS with StatusCallbacks &amp; OTP verification
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadStatus(true)}
            disabled={refreshingHealth}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-400 text-xs text-cyan-200 cursor-pointer disabled:opacity-50"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{refreshingHealth ? 'Checking Providers...' : 'Verify Provider Connectivity'}</span>
          </button>
        </div>

        {/* Provider Health & Webhook Diagnostic Cards */}
        <div className="grid md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-slate-300">
                Email ({emailProviderType !== 'none' ? emailProviderType.toUpperCase() : 'Resend / SMTP'})
              </span>
              <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${getStatusBadgeClass(emailStatusLabel)}`}>
                {emailStatusLabel.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {emailHealth?.detail || 'Checking server-side Resend/SMTP provider configuration...'}
            </p>
            {missingEmailEnv.length > 0 && (
              <div className="text-[10px] font-mono text-amber-300">
                Missing env: {missingEmailEnv.join(', ')}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-slate-300">Twilio SMS</span>
              <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${getStatusBadgeClass(smsStatusLabel)}`}>
                {smsStatusLabel.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {smsHealth?.detail || 'Checking Twilio API connectivity...'}
            </p>
            {missingSmsEnv.length > 0 && (
              <div className="text-[10px] font-mono text-amber-300">
                Missing env: {missingSmsEnv.join(', ')}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-slate-300 flex items-center gap-1.5">
                <Webhook className="w-3.5 h-3.5 text-cyan-400" />
                <span>Webhook &amp; Delivery</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded border text-[10px] font-mono ${
                  webhookHealth?.callbackBaseConfigured
                    ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-300'
                    : 'bg-amber-950/60 border-amber-600/50 text-amber-200'
                }`}
              >
                {webhookHealth?.callbackBaseConfigured ? 'CALLBACK READY' : 'LOCAL ONLY'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 space-y-0.5">
              <div>
                Last delivery:{' '}
                <span className="text-slate-200 font-mono">
                  {lastDeliveredAt ? new Date(lastDeliveredAt).toLocaleString() : 'None yet'}
                </span>
              </div>
              <div>
                Webhooks logged: <span className="text-slate-200 font-mono">{webhookHealth?.recentEventsCount ?? 0}</span>
                {webhookHealth?.twilioSignatureValidationActive ? ' · Twilio Sig ON' : ''}
                {webhookHealth?.resendSecretConfigured ? ' · Resend Svix ON' : ''}
              </div>
            </div>
          </div>
        </div>

        {(emailStatusLabel !== 'READY' || smsStatusLabel !== 'READY') && (
          <div className="rounded-lg bg-amber-950/25 border border-amber-700/50 p-3 text-xs text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>Server Environment Setup:</strong> TruthLens keeps all API keys strictly in server secrets (never exposed in browser code). Add{' '}
              <code>RESEND_API_KEY</code> + <code>RESEND_FROM_EMAIL</code> (or <code>SMTP_HOST</code> + <code>SMTP_FROM</code>),{' '}
              <code>TWILIO_ACCOUNT_SID</code> + <code>TWILIO_AUTH_TOKEN</code> + <code>TWILIO_FROM_NUMBER</code>, and{' '}
              <code>APP_BASE_URL</code> to enable live external delivery and delivery callbacks.
            </div>
          </div>
        )}

        {banner && (
          <div
            className={`rounded-lg border p-3 text-xs flex items-start gap-2 ${
              banner.kind === 'error'
                ? 'bg-rose-950/40 border-rose-700/60 text-rose-200'
                : banner.kind === 'warn'
                  ? 'bg-amber-950/35 border-amber-700/60 text-amber-200'
                  : 'bg-emerald-950/35 border-emerald-700/60 text-emerald-200'
            }`}
          >
            {banner.kind === 'info' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            )}
            <span>{banner.text}</span>
          </div>
        )}

        {/* Register Contact & Test Dispatch Form */}
        <form onSubmit={handleRegisterContact} className="grid lg:grid-cols-12 gap-4 bg-slate-950/70 border border-slate-800 rounded-xl p-4">
          <div className="lg:col-span-3 space-y-1.5">
            <label className="block text-xs text-slate-400 font-mono">Channel</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChannel('email')}
                className={`inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium cursor-pointer ${
                  channel === 'email'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Email</span>
              </button>
              <button
                type="button"
                onClick={() => setChannel('sms')}
                className={`inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium cursor-pointer ${
                  channel === 'sms'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>SMS</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-1.5">
            <label className="block text-xs text-slate-400 font-mono">
              {channel === 'email' ? 'Investigator Email Address' : 'International Phone Number (+91 / E.164)'}
            </label>
            <div className="flex items-center gap-2">
              {channel === 'sms' && (
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  aria-label="Country calling code"
                  className="px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              )}
              <input
                type={channel === 'email' ? 'email' : 'tel'}
                required
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={channel === 'email' ? 'investigator@agency.org' : '9876543210'}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-wrap items-end gap-2">
            <button
              type="submit"
              disabled={submitting || !consentGranted || !destination.trim()}
              className="flex-1 min-w-[140px] py-2 px-3.5 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-400 text-slate-950 font-semibold text-xs cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Registering...' : 'Register & Send OTP'}
            </button>
            <button
              type="button"
              onClick={() => handleSendTest('email')}
              disabled={testingChannel !== null}
              className="inline-flex items-center gap-1 py-2 px-2.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer disabled:opacity-50"
            >
              <Mail className="w-3.5 h-3.5 text-cyan-400" />
              <span>{testingChannel === 'email' ? 'Sending...' : 'Test Email'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleSendTest('sms')}
              disabled={testingChannel !== null}
              className="inline-flex items-center gap-1 py-2 px-2.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer disabled:opacity-50"
            >
              <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
              <span>{testingChannel === 'sms' ? 'Sending...' : 'Test SMS'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleSendTest('all')}
              disabled={testingChannel !== null}
              className="inline-flex items-center gap-1 py-2 px-2.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5 text-cyan-400" />
              <span>{testingChannel === 'all' ? 'Testing...' : 'Test Alert'}</span>
            </button>
          </div>

          <div className="lg:col-span-12 space-y-3 pt-1">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
              <span className="font-mono text-slate-400">Contact Events:</span>
              {(
                [
                  ['analysis_completed', 'Analysis Completed'],
                  ['high_risk_indicator', 'High Risk Indicator'],
                  ['ledger_verification_alert', 'Custody / Integrity Alert'],
                  ['case_updated', 'Case / Status Updated'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={eventPrefs[key]}
                    onChange={(e) => setEventPrefs((p) => ({ ...p, [key]: e.target.checked }))}
                    className="accent-cyan-400"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={consentGranted}
                onChange={(e) => setConsentGranted(e.target.checked)}
                className="mt-0.5 accent-cyan-400"
              />
              <span>
                I explicitly consent to receiving TruthLens notifications and OTP challenges (you can opt-out/pause or remove this contact at any time).
              </span>
            </label>
          </div>
        </form>

        {/* Global Automated Notification Preferences */}
        {globalPrefs && (
          <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-300">
                <Settings2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Automated Investigation Notification Preferences</span>
              </div>
              {savingPrefs && <span className="text-[11px] font-mono text-cyan-300">Saving...</span>}
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
              {(
                [
                  ['emailEnabled', 'Master Email Alerts'],
                  ['smsEnabled', 'Master SMS Alerts'],
                  ['inAppEnabled', 'Master In-App Feed'],
                  ['caseRegistered', 'Case Registered'],
                  ['caseAssigned', 'Investigator Assigned'],
                  ['caseUpdated', 'Status Updates'],
                  ['analysisCompleted', 'Analysis Completed'],
                  ['highRiskIndicator', 'High-Risk Indicators'],
                  ['evidenceSubmitted', 'Evidence Uploaded'],
                  ['evidenceIntegrityFailed', 'Integrity Verification Failed'],
                  ['custodyEvent', 'Chain-of-Custody Events'],
                  ['witnessRegistered', 'Witness Registered'],
                  ['caseClosed', 'Investigation Closed'],
                  ['securityAlert', 'Security Alerts'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/90 px-2.5 py-1.5 text-slate-300 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(globalPrefs[key])}
                    onChange={() => handleToggleGlobalPref(key)}
                    className="accent-cyan-400"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Registered Contacts & OTP Verification Controls */}
        <div className="space-y-3">
          <div className="text-xs font-mono uppercase tracking-wider text-slate-400">
            Registered Contacts ({contacts.length})
          </div>
          {loading ? (
            <div className="text-xs text-slate-400">Loading contacts...</div>
          ) : contacts.length === 0 ? (
            <div className="text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
              No notification contacts registered yet.
            </div>
          ) : (
            <div className="grid gap-3">
              {contacts.map((c) => {
                const cooldownSec = Math.max(0, Math.ceil(((c.resendAvailableAt ?? 0) - nowTick) / 1000));
                const attemptsLeft = Math.max(0, (c.maxOtpAttempts ?? 5) - (c.otpAttempts ?? 0));
                return (
                  <div
                    key={c.id}
                    className="rounded-lg bg-slate-950/90 border border-slate-800 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 font-mono">
                        <span className="text-cyan-300 uppercase">{c.channel}</span>
                        <span className="text-white">{c.destinationMasked}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] ${
                            c.verified
                              ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-300'
                              : c.otpStatus === 'expired' || c.otpStatus === 'locked' || c.otpStatus === 'failed'
                                ? 'bg-rose-950/60 border-rose-600/50 text-rose-200'
                                : 'bg-amber-950/60 border-amber-600/50 text-amber-200'
                          }`}
                        >
                          {c.verified
                            ? 'VERIFIED'
                            : c.otpStatus === 'expired'
                              ? 'OTP EXPIRED'
                              : c.otpStatus === 'locked'
                                ? 'OTP LOCKED'
                                : c.otpStatus === 'not_configured'
                                  ? 'OTP NOT SENT (PROVIDER NOT CONFIGURED)'
                                  : c.otpStatus === 'failed'
                                    ? 'OTP DELIVERY FAILED'
                                    : 'PENDING OTP'}
                        </span>
                        {c.paused && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 text-[10px]">
                            PAUSED / OPTED OUT
                          </span>
                        )}
                      </div>

                      {!c.verified && (
                        <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-3">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-cyan-400" />
                            Attempts left: {attemptsLeft}/{c.maxOtpAttempts ?? 5}
                          </span>
                          {c.verificationExpiresAt && (
                            <span>
                              Expires: {new Date(c.verificationExpiresAt).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      )}

                      {c.lastError && (
                        <div className="text-[11px] text-amber-300">Provider note: {c.lastError}</div>
                      )}

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                        {(
                          [
                            ['analysis_completed', 'Analysis'],
                            ['high_risk_indicator', 'High Risk'],
                            ['ledger_verification_alert', 'Custody Alert'],
                            ['case_updated', 'Case Updates'],
                          ] as const
                        ).map(([k, lbl]) => (
                          <label key={k} className="inline-flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={c.eventPrefs[k]}
                              onChange={() => handleTogglePref(c, k)}
                              className="accent-cyan-400"
                            />
                            <span>{lbl}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!c.verified && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="text"
                            maxLength={6}
                            value={verifyCodes[c.id] ?? ''}
                            onChange={(e) =>
                              setVerifyCodes((prev) => ({ ...prev, [c.id]: e.target.value }))
                            }
                            placeholder="6-digit OTP"
                            className="w-24 px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-white"
                          />
                          <button
                            type="button"
                            disabled={verifyingId === c.id}
                            onClick={() => handleVerifyContact(c.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs cursor-pointer disabled:opacity-50"
                          >
                            <KeyRound className="w-3 h-3" />
                            <span>{verifyingId === c.id ? 'Verifying...' : 'Verify OTP'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={resendingId === c.id || cooldownSec > 0}
                            onClick={() => handleResendOtp(c.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 hover:border-cyan-400 text-cyan-200 text-xs cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>
                              {resendingId === c.id
                                ? 'Sending...'
                                : cooldownSec > 0
                                  ? `Resend (${cooldownSec}s)`
                                  : 'Resend OTP'}
                            </span>
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => handleTogglePause(c)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-700 text-slate-300 hover:border-amber-400 text-[11px] cursor-pointer"
                      >
                        {c.paused ? (
                          <>
                            <PlayCircle className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Resume</span>
                          </>
                        ) : (
                          <>
                            <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                            <span>Opt-Out</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteContact(c.id)}
                        aria-label="Delete contact"
                        className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Delivery History & Filters */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              <span>Notification Delivery Audit Log ({filteredLogs.length})</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={logChannelFilter}
                onChange={(e) => setLogChannelFilter(e.target.value as 'all' | 'email' | 'sms')}
                aria-label="Filter delivery log channel"
                className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200"
              >
                <option value="all">All Channels</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>

              <select
                value={logStatusFilter}
                onChange={(e) => setLogStatusFilter(e.target.value)}
                aria-label="Filter delivery log status"
                className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200"
              >
                <option value="all">All Statuses</option>
                <option value="delivered">DELIVERED</option>
                <option value="sent">SENT</option>
                <option value="pending">PENDING</option>
                <option value="retrying">RETRYING</option>
                <option value="failed">FAILED</option>
                <option value="not_configured">NOT CONFIGURED</option>
                <option value="failed_or_unconfigured">Failed / Unconfigured</option>
              </select>
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="text-xs text-slate-500 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
              No dispatches matching the selected filter.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/80 bg-slate-950/80 text-xs">
              {filteredLogs.map((log) => (
                <div key={log.id} className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-[11px] flex flex-wrap items-center gap-2">
                    <span className="text-cyan-300 uppercase">{log.channel}</span>
                    {log.provider && log.provider !== 'none' && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 uppercase text-[10px]">
                        {log.provider}
                      </span>
                    )}
                    <span className="text-slate-200">{log.recipientMasked}</span>
                    <span className="text-slate-500">· {log.eventType}</span>
                    {(log.retryCount ?? 0) > 0 && (
                      <span className="text-slate-500">· retries: {log.retryCount}</span>
                    )}
                    {log.providerMessageId && (
                      <span className="text-slate-500">· ID: {log.providerMessageId}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className={`px-2 py-0.5 rounded border text-[10px] ${getStatusBadgeClass(log.status)}`}>
                      {formatDisplayStatus(log.status)}
                    </span>
                    <span className="text-slate-500 tabular-nums">
                      {new Date(log.deliveredAt || log.createdAt).toLocaleTimeString()}
                    </span>
                    {(log.status === 'failed' ||
                      log.status === 'not_configured' ||
                      log.status === 'expired' ||
                      log.status === 'retrying') && (
                      <button
                        type="button"
                        disabled={retryingLogId === log.id}
                        onClick={() => handleRetryLog(log.id)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 hover:border-cyan-400 text-cyan-200 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>{retryingLogId === log.id ? 'Retrying...' : 'Retry'}</span>
                      </button>
                    )}
                  </div>
                  {log.errorDetail && (
                    <div className="w-full text-[11px] text-slate-400">{log.errorDetail}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Provider Webhook Events */}
        {webhookEvents.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Webhook className="w-3.5 h-3.5 text-cyan-400" />
              <span>Recent Provider Webhook Callbacks ({webhookEvents.length})</span>
            </div>
            <div className="max-h-40 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/80 bg-slate-950/80 text-[11px] font-mono">
              {webhookEvents.map((ev) => (
                <div key={ev.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-300 uppercase">{ev.provider}</span>
                    <span className="text-white">{ev.eventType}</span>
                    {ev.providerMessageId && <span className="text-slate-400">({ev.providerMessageId})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${getStatusBadgeClass(ev.status)}`}>
                      {formatDisplayStatus(ev.status)}
                    </span>
                    <span className="text-slate-500">{new Date(ev.receivedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
