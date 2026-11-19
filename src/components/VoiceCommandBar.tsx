import React, { useRef, useState } from 'react';
import { Mic, MicOff, Terminal } from 'lucide-react';
import { useI18n } from '../i18n/translations.ts';
import { SPEECH_LANG_TAGS } from '../utils/speechContext.tsx';
import { parseVoiceCommand, type VoiceCommandAction } from '../utils/voiceCommands.ts';

interface VoiceCommandBarProps {
  onCommand: (action: VoiceCommandAction) => void;
}

export const VoiceCommandBar: React.FC<VoiceCommandBarProps> = ({ onCommand }) => {
  const { t, language } = useI18n();
  const [listening, setListening] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);

  const speechRecCtor =
    typeof window !== 'undefined'
      ? (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition
      : undefined;

  const triggerCommandText = (transcript: string) => {
    const parsed = parseVoiceCommand(transcript);
    setLastFeedback(parsed.label);
    onCommand(parsed);
    window.setTimeout(() => setLastFeedback(null), 4000);
  };

  const toggleListening = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }

    if (!speechRecCtor) {
      setShowQuickMenu((v) => !v);
      setLastFeedback('SpeechRecognition unsupported; select a quick voice command below.');
      return;
    }

    const rec = new speechRecCtor() as {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: (e: { results: ArrayLike<{ isFinal?: boolean } & ArrayLike<{ transcript: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    rec.lang = SPEECH_LANG_TAGS[language] ?? 'en-IN';
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = '';
      let finalCmd = '';
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        const part = r?.[0]?.transcript ?? '';
        if (r?.isFinal) finalCmd += part;
        else interim += part;
      }
      if (interim) {
        setLastFeedback(`"${interim.trim()}"`);
      }
      if (finalCmd.trim()) {
        triggerCommandText(finalCmd.trim());
      }
    };
    rec.onerror = () => {
      setListening(false);
      setLastFeedback('Mic unavailable — try quick command menu.');
      setShowQuickMenu(true);
    };
    rec.onend = () => setListening(false);

    recRef.current = rec;
    setListening(true);
    setShowQuickMenu(false);
    rec.start();
  };

  const quickCommands = [
    { label: t.navLiveCam, phrase: 'open live camera' },
    { label: t.navGraph, phrase: 'open contradiction graph' },
    { label: t.btnRunAnalysis, phrase: 'run analysis' },
    { label: t.audioListenSite, phrase: 'read findings' },
    { label: t.btnExportPdf, phrase: 'export pdf' },
  ];

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={toggleListening}
        title={listening ? t.voiceCmdListening : t.voiceCmdBtn}
        aria-label={t.voiceCmdBtn}
        className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
          listening
            ? 'bg-rose-950/70 border-rose-500 text-rose-200 animate-pulse'
            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200'
        }`}
      >
        {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-cyan-400" />}
        <span className="hidden xl:inline">{listening ? t.voiceCmdListening : t.voiceCmdBtn}</span>
      </button>

      <button
        type="button"
        onClick={() => setShowQuickMenu((v) => !v)}
        title="Quick Commands Menu"
        aria-label="Open quick command triggers"
        className="p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 cursor-pointer shrink-0"
      >
        <Terminal className="w-3.5 h-3.5" />
      </button>

      {lastFeedback && (
        <div className="hidden md:block text-[11px] font-mono text-cyan-300 bg-slate-950/95 border border-cyan-500/40 rounded-md px-2.5 py-1 max-w-[220px] truncate">
          {lastFeedback}
        </div>
      )}

      {showQuickMenu && (
        <div className="absolute right-0 top-full mt-2 w-60 rounded-xl glass-panel border border-slate-700/80 p-2 z-50 shadow-2xl space-y-1">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Quick Voice / Command Triggers
          </div>
          {quickCommands.map((qc) => (
            <button
              key={qc.phrase}
              type="button"
              onClick={() => {
                setShowQuickMenu(false);
                triggerCommandText(qc.phrase);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-200 hover:bg-cyan-500/15 hover:text-cyan-200 transition-colors cursor-pointer"
            >
              {qc.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
