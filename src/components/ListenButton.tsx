import React from 'react';
import { Volume2, Square } from 'lucide-react';
import { useSpeech } from '../utils/speechContext.tsx';
import { useI18n } from '../i18n/translations.ts';

interface ListenButtonProps {
  text: string;
  label?: string;
  compact?: boolean;
}

export function ListenButton({ text, label, compact = false }: ListenButtonProps) {
  const { t } = useI18n();
  const { speaking, speakText, stop } = useSpeech();

  return (
    <button
      type="button"
      onClick={() => {
        if (speaking) {
          stop();
        } else {
          speakText(text);
        }
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
        compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
      } ${
        speaking
          ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25'
          : 'bg-slate-900/90 border-slate-700/80 hover:border-cyan-400 text-cyan-200'
      }`}
      title={speaking ? t.btnStopListen : t.btnListen}
    >
      {speaking ? <Square className="w-3 h-3" /> : <Volume2 className="w-3.5 h-3.5 text-cyan-400" />}
      <span>{label ?? (speaking ? t.btnStopListen : t.btnListen)}</span>
    </button>
  );
}
