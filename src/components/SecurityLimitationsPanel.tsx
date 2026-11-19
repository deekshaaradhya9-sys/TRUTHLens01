import React from 'react';
import { ShieldCheck, AlertTriangle, Lock, Server, X } from 'lucide-react';

interface SecurityLimitationsPanelProps {
  onClose: () => void;
}

export const SecurityLimitationsPanel: React.FC<SecurityLimitationsPanelProps> = ({ onClose }) => {
  const securityControls = [
    {
      title: 'Magic-Byte Validation & Isolated Storage',
      detail:
        'Uploaded files are verified against magic bytes (not file extensions alone), stored outside the static web root, and streamed via authenticated endpoints with CSP and X-Content-Type-Options: nosniff.',
    },
    {
      title: 'Cryptographic SHA-256 Custody Ledger',
      detail:
        'Every upload, live camera capture, analysis run, verification sign-off, and removal event hashes the previous entry hash to detect any post-ingest database or file tampering.',
    },
    {
      title: 'Server-Side AI & Provider Secrets',
      detail:
        'GEMINI_API_KEY, RESEND_API_KEY, TWILIO credentials, and SESSION_SECRET remain strictly server-side. CSRF tokens + httpOnly signed cookies + Argon2 password hashing protect sessions.',
    },
    {
      title: 'Privacy-Safe Live Camera & PWA Cache Policy',
      detail:
        'MediaPipe face & landmark detection executes 100% locally in browser WASM only after explicit user consent. Workbox uses NetworkOnly for all /api/* routes so private evidence never leaks into offline caches.',
    },
  ];

  const residualLimitations = [
    'Client-Side Metadata Malleability: EXIF tags and container creation timestamps can be stripped or forged before acquisition; absence of EXIF (e.g. social platform re-encoding) is common and non-conclusive.',
    'Heuristic DSP Boundaries: ELA heatmaps, 2D FFT spectral peaks, video frame delta jumps, and audio RMS discontinuities detect technical anomalies — they NEVER constitute binary deepfake verdicts.',
    'Offline Scope: The PWA caches the application shell only. Live uploads, server DSP, Gemini synthesis, and private evidence previews require active server connectivity.',
    'Browser Speech Synthesis & Recognition Variance: Native voice availability for Kannada, Hindi, Tamil, Telugu, and Malayalam varies across OS voice packs; TruthLens provides readable text fallbacks automatically.',
    'Session & Access Controls: Demo Sandbox enables rapid judge evaluation; production deployments should enforce multi-factor authentication and institutional key management.',
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl glass-panel rounded-2xl p-6 space-y-5 my-8">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                Security Architecture &amp; Methodological Limitations
              </h2>
              <p className="text-xs text-slate-400">
                INNOVEDGE 2026 Transparency &amp; Forensic Accountability Disclosure
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Security & Limitations dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-cyan-300">
            <Lock className="w-3.5 h-3.5" />
            <span>Implemented Security Controls</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {securityControls.map((ctrl) => (
              <div
                key={ctrl.title}
                className="rounded-xl bg-slate-950/90 border border-slate-800 p-3.5 space-y-1.5 text-xs"
              >
                <div className="font-semibold text-white">{ctrl.title}</div>
                <p className="text-slate-400 leading-relaxed">{ctrl.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Honest Residual Limitations</span>
          </div>
          <ul className="space-y-2 text-xs text-slate-300 bg-amber-950/20 border border-amber-800/40 rounded-xl p-4 list-disc pl-6 leading-relaxed">
            {residualLimitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <span>Principle: Evidence, not verdicts.</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 font-semibold text-xs cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
