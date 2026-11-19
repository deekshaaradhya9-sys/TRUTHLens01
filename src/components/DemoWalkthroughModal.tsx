import React, { useState } from 'react';
import { PlayCircle, CheckCircle2, ArrowRight, X } from 'lucide-react';

export type WalkthroughTargetTab =
  | 'lab'
  | 'livecam'
  | 'graph'
  | 'agent'
  | 'alerts'
  | 'community'
  | 'ledger';

interface DemoWalkthroughModalProps {
  onJumpToTab: (tab: WalkthroughTargetTab) => void;
  onTriggerPdf?: () => void;
  onClose: () => void;
}

const STEPS: Array<{
  step: number;
  title: string;
  tab: WalkthroughTargetTab;
  summary: string;
  whatToShow: string;
}> = [
  {
    step: 1,
    title: 'Multimodal Evidence Lab & ELA / 2D FFT / EXIF',
    tab: 'lab',
    summary: 'Inspect Case TL-2026-04 evidence items, SHA-256 hashes, EXIF metadata, and the interactive ELA/FFT slider.',
    whatToShow: 'Drag the Error Level Analysis wipe slider and highlight Peak Sector anomalies plus dHash similarity.',
  },
  {
    step: 2,
    title: 'Audio Spectrogram & Temporal Video Deltas',
    tab: 'lab',
    summary: 'Review acoustic splice markers at 2.60s and clickable video keyframe delta jumps.',
    whatToShow: 'Click a flagged discontinuity marker or video keyframe bar to seek playback directly to the anomalous instant.',
  },
  {
    step: 3,
    title: 'Live Camera Face & Artifact Capture',
    tab: 'livecam',
    summary: 'Activate explicit consent webcam with local MediaPipe WASM BlazeFace & 468-point FaceLandmarker overlay.',
    whatToShow: 'Click "Capture Frame & Analyze" to ingest a verified JPEG into Evidence Lab & SHA-256 Custody Ledger.',
  },
  {
    step: 4,
    title: 'Cross-Modal Contradiction Graph',
    tab: 'graph',
    summary: 'Explore links between Evidence (cyan), Claims (violet), Findings (amber diamonds), and Metadata (slate).',
    whatToShow: 'Filter by Contradicts / Corroborates and click red contradiction links to inspect uncertainty notes.',
  },
  {
    step: 5,
    title: 'Multilingual Voice Agent & Devil’s Advocate',
    tab: 'agent',
    summary: 'Query the AI forensic agent in English, Kannada, Hindi, Tamil, Telugu, or Malayalam with Devil’s Advocate mode.',
    whatToShow: 'Toggle Devil’s Advocate ON and tap "List Innocent Explanations" to audit alternative benign causes.',
  },
  {
    step: 6,
    title: 'Consent-Gated Alerts & Community Loop',
    tab: 'alerts',
    summary: 'Inspect honest Resend/Twilio provider status, masked notification audit logs, and real-time community calibration.',
    whatToShow: 'Check provider status honesty or jump to Community Loop to see live WebSocket calibration tallies.',
  },
  {
    step: 7,
    title: 'Tamper-Evident SHA-256 Custody Ledger & PDF Dossier',
    tab: 'ledger',
    summary: 'Verify the entire cryptographic hash chain against stored files on disk and export a 14-point PDF briefing.',
    whatToShow: 'Click "Verify Ledger Integrity" then use "Export PDF Report" or "QR Share" in the top toolbar.',
  },
];

export const DemoWalkthroughModal: React.FC<DemoWalkthroughModalProps> = ({
  onJumpToTab,
  onTriggerPdf,
  onClose,
}) => {
  const [completed, setCompleted] = useState<number[]>([]);

  const handleJump = (stepNum: number, tab: WalkthroughTargetTab) => {
    setCompleted((prev) => (prev.includes(stepNum) ? prev : [...prev, stepNum]));
    onJumpToTab(tab);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl glass-panel rounded-2xl p-6 space-y-4 my-8">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <PlayCircle className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                INNOVEDGE Judge Demonstration Guide
              </h2>
              <p className="text-xs text-slate-400">
                Interactive 7-step tour of TruthLens capabilities — jump straight to any module
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Demo Guide"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
          {STEPS.map((s) => {
            const done = completed.includes(s.step);
            return (
              <div
                key={s.step}
                className="rounded-xl bg-slate-950/90 border border-slate-800 p-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-1 flex-1 min-w-[240px]">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    {done ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono text-[11px] flex items-center justify-center shrink-0">
                        {s.step}
                      </span>
                    )}
                    <span>{s.title}</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{s.summary}</p>
                  <p className="text-[11px] font-mono text-cyan-300/80">{s.whatToShow}</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleJump(s.step, s.tab)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs font-medium text-cyan-200 cursor-pointer shrink-0"
                >
                  <span>Jump Here</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
          {onTriggerPdf && (
            <button
              type="button"
              onClick={() => {
                onTriggerPdf();
                onClose();
              }}
              className="px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs font-medium text-slate-200 cursor-pointer"
            >
              Export 14-Point PDF Dossier Now
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 font-semibold text-xs cursor-pointer"
          >
            Resume Workbench
          </button>
        </div>
      </div>
    </div>
  );
};
