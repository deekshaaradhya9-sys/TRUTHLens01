import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ShieldCheck,
  ArrowRight,
  Eye,
  Lock,
  Radio,
  Globe2,
  Camera,
  FileAudio,
  Film,
  FileText,
  Network,
  Fingerprint,
  Cpu,
  KeyRound,
  MailCheck,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type { AuthUser } from '../types/forensics.ts';
import { useI18n, type UiLanguage } from '../i18n/translations.ts';
import { AudioAccessibilityBar } from './AudioAccessibilityBar.tsx';
import { ListenButton } from './ListenButton.tsx';

interface LandingHeroProps {
  onAuthenticated: (user: AuthUser, csrfToken: string, sessionToken?: string) => Promise<void> | void;
  initialResetToken?: string | null;
  initialVerifyToken?: string | null;
}

export const LandingHero: React.FC<LandingHeroProps> = ({
  onAuthenticated,
  initialResetToken = null,
  initialVerifyToken = null,
}) => {
  const { t, language, setLanguage } = useI18n();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>(
    initialResetToken ? 'reset' : 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [resetToken, setResetToken] = useState(initialResetToken || '');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (initialResetToken) {
      setMode('reset');
      setResetToken(initialResetToken);
    }
  }, [initialResetToken]);

  useEffect(() => {
    if (!initialVerifyToken) return;
    apiRequest<{ ok: boolean }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: initialVerifyToken }),
    })
      .then(() => {
        setNotice('Email address verified successfully. You may now sign in.');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Email verification link expired or invalid.');
      });
  }, [initialVerifyToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === 'forgot') {
        const res = await apiRequest<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        setNotice(res.message);
        return;
      }
      if (mode === 'reset') {
        const res = await apiRequest<{ ok: boolean; message: string }>('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token: resetToken, newPassword }),
        });
        setNotice(res.message);
        setMode('login');
        setPassword('');
        return;
      }

      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body =
        mode === 'signup'
          ? { email, password, displayName, department, phone }
          : { email, password };
      const res = await apiRequest<{ user: AuthUser; csrfToken: string; sessionToken?: string }>(
        endpoint,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      await onAuthenticated(res.user, res.csrfToken, res.sessionToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleLaunchDemo = async () => {
    setError(null);
    setNotice(null);
    setDemoLoading(true);
    try {
      const res = await apiRequest<{ user: AuthUser; csrfToken: string; sessionToken?: string }>(
        '/api/auth/demo',
        {
          method: 'POST',
        },
      );
      await onAuthenticated(res.user, res.csrfToken, res.sessionToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initialize demo session.');
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen forensic-grid-bg text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#050814]/92 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <img src="/icon.svg" alt="" className="w-7 h-7 rounded-lg" />
            <span className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap">
              TRUTHLENS
            </span>
          </div>

          <nav className="hidden lg:flex items-center gap-6 text-sm text-slate-300">
            <a href="#about-truthlens" className="hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0">
              {t.landingAboutTitle}
            </a>
            <a href="#how-it-works" className="hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0">
              {t.landingHowItWorksTitle}
            </a>
            <a href="#live-preview" className="hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0">
              {t.landingLivePreviewTitle}
            </a>
            <a href="#tech-security" className="hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0">
              {t.landingTechSecurityTitle}
            </a>
            <a href="#investigator-login" className="hover:text-violet-300 transition-colors whitespace-nowrap shrink-0">
              {t.landingSignInTab}
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950/90 text-xs text-slate-300">
              <Globe2 className="w-3.5 h-3.5 text-violet-400" />
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as UiLanguage)}
                aria-label={t.settingsLangLabel}
                className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="en" className="bg-slate-950">English</option>
                <option value="kn" className="bg-slate-950">ಕನ್ನಡ</option>
                <option value="hi" className="bg-slate-950">हिन्दी</option>
                <option value="ta" className="bg-slate-950">தமிழ்</option>
                <option value="te" className="bg-slate-950">తెలుగు</option>
                <option value="ml" className="bg-slate-950">മലയാളം</option>
              </select>
            </label>

            <button
              type="button"
              onClick={handleLaunchDemo}
              disabled={demoLoading}
              className="px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-gradient-to-r from-cyan-400 to-sky-400 hover:from-cyan-300 hover:to-sky-300 text-slate-950 transition-all whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer shadow-md shadow-cyan-500/20"
            >
              {demoLoading ? t.landingOpeningSandbox : t.landingSandboxBtn}
            </button>
          </div>
        </div>
      </header>

      <AudioAccessibilityBar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-10 lg:py-14 space-y-16">
        {/* Hero Command Grid */}
        <section className="grid lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="lg:col-span-6 flex flex-col justify-between gap-7"
          >
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-mono tracking-widest uppercase text-cyan-300">
                  {t.brandTagline}
                </div>
                <ListenButton text={`${t.landingHeadline} ${t.landingSubheading}`} compact />
              </div>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white text-balance leading-[1.05]">
                <span className="bg-gradient-to-r from-white via-cyan-200 to-sky-400 bg-clip-text text-transparent">
                  {t.landingHeadline}
                </span>
              </h1>

              <p className="text-sm sm:text-base text-slate-300 max-w-xl leading-relaxed">
                {t.landingSubheading}
              </p>

              {/* 4 Modality Indicators */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                <div className="rounded-xl bg-slate-950/80 border border-slate-800/90 p-3 space-y-1">
                  <Camera className="w-4 h-4 text-cyan-400" />
                  <div className="text-xs font-semibold text-white">Image &amp; Live Cam</div>
                  <div className="text-[11px] font-mono text-slate-400">ELA · 2D FFT · pHash</div>
                </div>
                <div className="rounded-xl bg-slate-950/80 border border-slate-800/90 p-3 space-y-1">
                  <FileAudio className="w-4 h-4 text-violet-400" />
                  <div className="text-xs font-semibold text-white">Audio Stream</div>
                  <div className="text-[11px] font-mono text-slate-400">Spectrogram · Splice</div>
                </div>
                <div className="rounded-xl bg-slate-950/80 border border-slate-800/90 p-3 space-y-1">
                  <Film className="w-4 h-4 text-sky-400" />
                  <div className="text-xs font-semibold text-white">Video Frame</div>
                  <div className="text-[11px] font-mono text-slate-400">8–16 Keyframes · Sync</div>
                </div>
                <div className="rounded-xl bg-slate-950/80 border border-slate-800/90 p-3 space-y-1">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  <div className="text-xs font-semibold text-white">Document PDF</div>
                  <div className="text-[11px] font-mono text-slate-400">EOF Audit · Entities</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={handleLaunchDemo}
                  disabled={demoLoading}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 hover:from-cyan-300 hover:to-violet-400 text-slate-950 font-semibold text-sm transition-all cursor-pointer disabled:opacity-60 shadow-lg shadow-cyan-500/20 whitespace-nowrap"
                >
                  <span>{demoLoading ? t.landingOpeningSandbox : t.landingSandboxBtn}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2 text-xs font-mono text-emerald-300">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>SHA-256 Custody · Argon2id · 7-Role RBAC</span>
                </div>
              </div>
            </div>

            {/* Investigator Auth Card */}
            <div id="investigator-login" className="glass-panel rounded-2xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="font-display text-lg font-semibold text-white">
                  {mode === 'signup'
                    ? 'Register Investigator Account'
                    : mode === 'forgot'
                      ? 'Password Recovery'
                      : mode === 'reset'
                        ? 'Reset Account Password'
                        : t.landingSignInTab}
                </h2>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-950/80 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                      setNotice(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      mode === 'login'
                        ? 'bg-gradient-to-r from-cyan-500/25 to-violet-500/25 text-cyan-200 border border-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.landingSignInTab}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signup');
                      setError(null);
                      setNotice(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      mode === 'signup'
                        ? 'bg-gradient-to-r from-cyan-500/25 to-violet-500/25 text-cyan-200 border border-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.landingSignUpTab}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setError(null);
                      setNotice(null);
                    }}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      mode === 'forgot' || mode === 'reset'
                        ? 'bg-gradient-to-r from-cyan-500/25 to-violet-500/25 text-cyan-200 border border-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'signup' && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        {t.landingDisplayName}
                      </label>
                      <input
                        type="text"
                        required
                        minLength={2}
                        maxLength={60}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. Ananya Rao"
                        className="w-full px-3.5 py-2 rounded-lg bg-slate-950/90 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Department / Unit (optional)
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        placeholder="e.g. Digital Forensics Desk"
                        className="w-full px-3.5 py-2 rounded-lg bg-slate-950/90 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>
                )}

                {(mode === 'login' || mode === 'signup' || mode === 'forgot') && (
                  <div className={mode === 'forgot' ? 'space-y-3' : 'grid sm:grid-cols-2 gap-4'}>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        {t.landingEmail}
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="analyst@agency.org"
                        className="w-full px-3.5 py-2 rounded-lg bg-slate-950/90 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      />
                    </div>

                    {mode !== 'forgot' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">
                          {t.landingPassword}
                        </label>
                        <input
                          type="password"
                          required
                          minLength={mode === 'signup' ? 10 : 1}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={mode === 'signup' ? 'Min 10 chars (Aa1!)' : '••••••••'}
                          className="w-full px-3.5 py-2 rounded-lg bg-slate-950/90 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                        />
                      </div>
                    )}
                  </div>
                )}

                {mode === 'signup' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Phone / Contact (optional, E.164 e.g. +919876543210)
                    </label>
                    <input
                      type="tel"
                      maxLength={24}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+919876543210"
                      className="w-full px-3.5 py-2 rounded-lg bg-slate-950/90 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                )}

                {mode === 'reset' && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Reset Token
                      </label>
                      <input
                        type="text"
                        required
                        value={resetToken}
                        onChange={(e) => setResetToken(e.target.value)}
                        placeholder="Paste token from reset email"
                        className="w-full px-3.5 py-2 rounded-lg bg-slate-950/90 border border-slate-800 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        New Password (min 10 chars, Aa1!)
                      </label>
                      <input
                        type="password"
                        required
                        minLength={10}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 10 chars (Aa1!)"
                        className="w-full px-3.5 py-2 rounded-lg bg-slate-950/90 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>
                )}

                {notice && (
                  <div className="text-xs text-emerald-200 bg-emerald-950/45 border border-emerald-700/60 rounded-lg px-3 py-2 flex items-start gap-2">
                    <MailCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{notice}</span>
                  </div>
                )}

                {error && (
                  <div className="text-xs text-rose-300 bg-rose-950/50 border border-rose-800/60 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                    <span>Argon2id · HttpOnly · CSRF</span>
                    {mode === 'forgot' && (
                      <button
                        type="button"
                        onClick={() => setMode('reset')}
                        className="inline-flex items-center gap-1 text-cyan-300 hover:underline cursor-pointer"
                      >
                        <KeyRound className="w-3 h-3" />
                        <span>Have token?</span>
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2 rounded-lg bg-slate-100 hover:bg-white text-slate-950 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    {loading
                      ? t.working
                      : mode === 'signup'
                        ? t.landingSubmitSignUp
                        : mode === 'forgot'
                          ? 'Send Reset Email'
                          : mode === 'reset'
                            ? 'Update Password'
                            : t.landingSubmitSignIn}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>

          {/* Right Column: Animated Live Investigation Preview */}
          <motion.div
            id="live-preview"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 }}
            className="lg:col-span-6 flex flex-col justify-between glass-panel rounded-2xl overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-200">
                <Radio className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t.landingLivePreviewTitle} · TL-2026-04</span>
              </div>
              <span className="text-xs font-mono text-amber-300">
                High Risk Indicator · 71%–88%
              </span>
            </div>

            <div className="relative flex-1 min-h-[300px] bg-slate-950 overflow-hidden">
              <img
                src="/src/assets/images/demo_street_evidence_1795075793174.jpg"
                alt="Seeded monsoon street forensic specimen showing MH-02 auto-rickshaw and storefronts"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-90"
              />
              <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-cyan-400 via-sky-300 to-violet-400 shadow-[0_0_18px_rgba(6,182,212,0.95)] scan-beam pointer-events-none" />
              <div className="absolute top-4 left-4 w-7 h-7 border-t-2 border-l-2 border-cyan-400/70 pointer-events-none" />
              <div className="absolute top-4 right-4 w-7 h-7 border-t-2 border-r-2 border-cyan-400/70 pointer-events-none" />
              <div className="absolute bottom-20 left-4 w-7 h-7 border-b-2 border-l-2 border-violet-400/70 pointer-events-none" />
              <div className="absolute bottom-20 right-4 w-7 h-7 border-b-2 border-r-2 border-violet-400/70 pointer-events-none" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#050814] via-[#050814]/25 to-transparent" />

              <div className="absolute bottom-4 inset-x-4 space-y-1.5 bg-slate-950/80 border border-slate-800/90 rounded-xl p-3.5 backdrop-blur-md">
                <div className="flex items-center justify-between gap-2 text-xs font-mono text-cyan-300">
                  <span>Claim: Bengaluru MG Road · Nov 18, 2026</span>
                  <span>ELA 2.84x Center-Left</span>
                </div>
                <div className="text-xs font-mono text-amber-300">
                  EXIF &amp; Signage Anchor: Mumbai GPS 19.0760° N, 72.8777° E · Jul 22, 2023 · MH-02 Plate
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-800/90 grid sm:grid-cols-3 gap-4 text-xs">
              <div>
                <div className="flex items-center gap-1.5 text-slate-100 font-semibold mb-1">
                  <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{t.landingPillar1Title}</span>
                </div>
                <p className="text-slate-400 leading-relaxed">{t.landingPillar1Desc}</p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-slate-100 font-semibold mb-1">
                  <Network className="w-3.5 h-3.5 text-violet-400" />
                  <span>{t.landingPillar2Title}</span>
                </div>
                <p className="text-slate-400 leading-relaxed">{t.landingPillar2Desc}</p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-slate-100 font-semibold mb-1">
                  <Lock className="w-3.5 h-3.5 text-cyan-300" />
                  <span>{t.landingPillar3Title}</span>
                </div>
                <p className="text-slate-400 leading-relaxed">{t.landingPillar3Desc}</p>
              </div>
            </div>
          </motion.div>
        </section>

        {/* About TruthLens & How It Works */}
        <section id="about-truthlens" className="grid lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-5 glass-panel rounded-2xl p-6 sm:p-7 space-y-4">
            <div className="text-xs font-mono uppercase tracking-widest text-cyan-300">
              {t.landingAboutTitle}
            </div>
            <h2 className="font-display text-2xl font-bold text-white">
              Evidence, Not Verdicts.
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Traditional deepfake tools output opaque "Real" or "Fake" labels without explaining where anomalies occur or accounting for innocent re-encoding. TruthLens surfaces measurable DSP artifacts, cross-modal metadata contradictions, alternative innocent explanations, and methodological limitations so journalists, analysts, and responders stay in control.
            </p>
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-3 text-xs font-mono">
              <div>
                <div className="text-cyan-300 font-semibold">20+ Case Categories</div>
                <div className="text-slate-400">12 Lifecycle States · CSV/PDF</div>
              </div>
              <div>
                <div className="text-violet-300 font-semibold">Zero Opaque Labels</div>
                <div className="text-slate-400">Confidence Ranges &amp; Checks</div>
              </div>
            </div>
          </div>

          <div id="how-it-works" className="lg:col-span-7 glass-panel rounded-2xl p-6 sm:p-7 space-y-5">
            <div className="text-xs font-mono uppercase tracking-widest text-violet-300">
              {t.landingHowItWorksTitle}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                {
                  step: '01',
                  title: 'Cryptographic Ingestion',
                  desc: 'Files pass magic-byte verification, compute SHA-256 hashes, store immutably off-root, and append to a hash-chained custody ledger.',
                },
                {
                  step: '02',
                  title: 'Signal & Live Cam Extraction',
                  desc: 'Generates ELA heatmaps, 2D FFT spectra, pHash fingerprints, 8–16 video keyframe deltas, audio splices, and local MediaPipe face landmarks.',
                },
                {
                  step: '03',
                  title: 'Cross-Modal Graph Synthesis',
                  desc: 'Correlates caption claims, witness records, EXIF GPS, and visual/audio artifacts via deterministic rules + Gemini reasoning.',
                },
                {
                  step: '04',
                  title: 'Human Sign-Off & QR Briefings',
                  desc: 'Investigators review findings, track custody transfers, query the multilingual voice agent, and export PDF dossiers or permission-scoped QR shares.',
                },
              ].map((item) => (
                <div key={item.step} className="rounded-xl bg-slate-950/75 border border-slate-800/90 p-4 space-y-1.5">
                  <div className="text-xs font-mono text-cyan-400">STEP {item.step}</div>
                  <div className="font-semibold text-sm text-white">{item.title}</div>
                  <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technology & Security Section */}
        <section id="tech-security" className="glass-panel rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-mono uppercase tracking-widest text-cyan-300">
                {t.landingTechSecurityTitle}
              </div>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-white mt-1">
                Defense-in-Depth Forensics Architecture
              </h2>
            </div>
            <span className="text-xs font-mono text-emerald-300">
              Server-Side Secrets · Zero Client Key Exposure
            </span>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-1.5">
              <Fingerprint className="w-4 h-4 text-cyan-400" />
              <div className="font-semibold text-white">Local-First Face Scanning</div>
              <p className="text-slate-400 leading-relaxed">
                MediaPipe WASM runs locally in your browser with explicit camera consent—no silent background streams and zero biometric identity matching.
              </p>
            </div>
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-1.5">
              <Lock className="w-4 h-4 text-violet-400" />
              <div className="font-semibold text-white">Tamper-Evident Custody</div>
              <p className="text-slate-400 leading-relaxed">
                Every upload, custody handoff, analysis commit, removal, and human sign-off appends a SHA-256 linked ledger entry with printable receipts.
              </p>
            </div>
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-1.5">
              <Cpu className="w-4 h-4 text-sky-400" />
              <div className="font-semibold text-white">Hybrid AI + DSP Fallback</div>
              <p className="text-slate-400 leading-relaxed">
                Combines server-side Gemini multimodal synthesis with deterministic signal heuristics so cases remain inspectable even offline or without API keys.
              </p>
            </div>
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <div className="font-semibold text-white">Zero-Trust 7-Role RBAC</div>
              <p className="text-slate-400 leading-relaxed">
                Argon2id authentication, HttpOnly SameSite cookies, CSRF tokens, strict MIME magic-byte checks, witness PII redaction, and session revocation.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-900/90 py-4 px-6">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span>{t.calibratedRiskFootnote}</span>
          </div>
          <span className="font-mono text-violet-400/90">INNOVEDGE 2026 · PS-04</span>
        </div>
      </footer>
    </div>
  );
};
