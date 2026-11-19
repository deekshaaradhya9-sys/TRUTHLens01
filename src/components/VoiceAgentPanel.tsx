import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  Square,
  Send,
  Scale,
  Sparkles,
  FileCheck,
  AlertCircle,
  ClipboardCopy,
  Check,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type { AgentMessageItem, ForensicFinding, SupportedLanguage } from '../types/forensics.ts';
import { useI18n } from '../i18n/translations.ts';
import { useSpeech, SPEECH_LANG_TAGS } from '../utils/speechContext.tsx';

interface VoiceAgentPanelProps {
  caseId: string;
  findings: ForensicFinding[];
  initialMessages: AgentMessageItem[];
}

const LANGUAGES: Array<{ code: SupportedLanguage; label: string; speechLang: string }> = [
  { code: 'en', label: 'English', speechLang: 'en-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)', speechLang: 'kn-IN' },
  { code: 'hi', label: 'हिन्दी (Hindi)', speechLang: 'hi-IN' },
  { code: 'ta', label: 'தமிழ் (Tamil)', speechLang: 'ta-IN' },
  { code: 'te', label: 'తెలుగు (Telugu)', speechLang: 'te-IN' },
  { code: 'ml', label: 'മലയാളം (Malayalam)', speechLang: 'ml-IN' },
];

const QUICK_CHIPS = [
  {
    label: 'Explain Technical Terms',
    prompt: 'Explain ELA, 2D FFT, dHash, and acoustic discontinuity telemetry in plain non-technical language for this case.',
  },
  {
    label: 'List Innocent Explanations',
    prompt: 'List the strongest innocent/benign alternative explanations for every suspicious indicator in this case.',
  },
  {
    label: 'Check Limitations',
    prompt: 'What are the key methodological limitations and what additional original evidence would resolve uncertainty?',
  },
];

const ASSISTANT_TASKS = [
  { key: 'summarize_case', label: 'Summarize Case Record' },
  { key: 'draft_report', label: 'Draft Formal Briefing' },
  { key: 'missing_docs', label: 'Check Missing Documents' },
  { key: 'highlight_inconsistencies', label: 'Highlight Inconsistencies' },
] as const;

export const VoiceAgentPanel: React.FC<VoiceAgentPanelProps> = ({
  caseId,
  findings,
  initialMessages,
}) => {
  const { t, language: uiLang } = useI18n();
  const { speakText: speakUnified, stop: stopUnified, speaking: unifiedSpeaking } = useSpeech();

  const [messages, setMessages] = useState<AgentMessageItem[]>(
    Array.isArray(initialMessages) ? initialMessages : [],
  );
  const [language, setLanguage] = useState<SupportedLanguage>(uiLang);
  const [manualOverride, setManualOverride] = useState(false);
  const [devilsAdvocate, setDevilsAdvocate] = useState(false);
  const [question, setQuestion] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState<string | null>(null);
  const [taskOutput, setTaskOutput] = useState<{
    task: string;
    output: string;
    mode: string;
  } | null>(null);
  const [copiedTask, setCopiedTask] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    setMessages(Array.isArray(initialMessages) ? initialMessages : []);
    setModeNotice(null);
    setTaskOutput(null);
  }, [caseId, initialMessages]);

  useEffect(() => {
    if (!manualOverride) {
      setLanguage(uiLang);
    }
  }, [uiLang, manualOverride]);

  useEffect(() => {
    if (!unifiedSpeaking) {
      setSpeakingId(null);
    }
  }, [unifiedSpeaking]);

  const handleSpeakMessage = (text: string, msgId: string, langCode: SupportedLanguage) => {
    if (speakingId === msgId && unifiedSpeaking) {
      stopUnified();
      setSpeakingId(null);
      return;
    }
    setSpeakingId(msgId);
    speakUnified(text, langCode);
  };

  const runAssistantTask = async (task: (typeof ASSISTANT_TASKS)[number]['key']) => {
    setTaskLoading(task);
    setError(null);
    try {
      const res = await apiRequest<{ output: string; mode: string }>(
        `/api/cases/${caseId}/assistant-task`,
        {
          method: 'POST',
          body: JSON.stringify({ task, language }),
        },
      );
      setTaskOutput({ task, output: res.output, mode: res.mode });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant task failed.');
    } finally {
      setTaskLoading(null);
    }
  };

  const askAgent = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || loading) return;
    setError(null);
    setLoading(true);
    setInterimTranscript('');

    const optimisticUser: AgentMessageItem = {
      id: `tmp-u-${Date.now()}`,
      role: 'user',
      language,
      devilsAdvocate,
      content: trimmed,
      citedFindingIds: [],
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setQuestion('');

    try {
      const res = await apiRequest<{
        reply: string;
        citedFindingIds: string[];
        language: SupportedLanguage;
        devilsAdvocate: boolean;
        mode?: 'ai' | 'deterministic_fallback';
        notice?: string | null;
      }>(`/api/cases/${caseId}/agent`, {
        method: 'POST',
        body: JSON.stringify({
          question: trimmed,
          language,
          devilsAdvocate,
        }),
      });

      setModeNotice(res.mode === 'deterministic_fallback' ? (res.notice ?? null) : null);

      const assistantMsg: AgentMessageItem = {
        id: `tmp-a-${Date.now()}`,
        role: 'assistant',
        language: res.language,
        devilsAdvocate: res.devilsAdvocate,
        content: res.reply,
        citedFindingIds: Array.isArray(res.citedFindingIds) ? res.citedFindingIds : [],
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      handleSpeakMessage(res.reply, assistantMsg.id, res.language);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent request failed.');
    } finally {
      setLoading(false);
    }
  };

  const toggleVoiceInput = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      setInterimTranscript('');
      return;
    }

    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setError('Browser SpeechRecognition is unavailable here; type your question or tap a quick prompt below.');
      return;
    }

    const rec = new SpeechRec() as {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: (e: {
        results: ArrayLike<{ isFinal?: boolean } & ArrayLike<{ transcript: string }>>;
      }) => void;
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
      let finalText = '';
      for (let i = 0; i < event.results.length; i++) {
        const resItem = event.results[i];
        const txt = resItem?.[0]?.transcript ?? '';
        if (resItem?.isFinal) {
          finalText += txt;
        } else {
          interim += txt;
        }
      }
      if (interim) {
        setInterimTranscript(interim.trim());
        setQuestion(interim.trim());
      }
      if (finalText.trim()) {
        setInterimTranscript('');
        setQuestion(finalText.trim());
        askAgent(finalText.trim());
      }
    };
    rec.onerror = () => {
      setListening(false);
      setInterimTranscript('');
      setError('Microphone capture failed or permission denied.');
    };
    rec.onend = () => {
      setListening(false);
      setInterimTranscript('');
    };

    recognitionRef.current = rec;
    setError(null);
    setListening(true);
    rec.start();
  };

  const safeFindings = Array.isArray(findings) ? findings : [];
  const findingById = new Map(safeFindings.map((f) => [f.id, f]));

  return (
    <div className="space-y-5">
      {/* Structured AI Investigation Assistant Quick Tools */}
      <div className="glass-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">AI Investigation Assistant</h3>
              <p className="text-xs text-slate-400">
                Structured forensic drafting grounded strictly in stored case exhibits, witness counts, and custody records
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Language: {language.toUpperCase()}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {ASSISTANT_TASKS.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={Boolean(taskLoading)}
              onClick={() => runAssistantTask(item.key)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-cyan-400 text-xs font-medium text-cyan-200 cursor-pointer disabled:opacity-50"
            >
              {item.key === 'missing_docs' ? (
                <FileCheck className="w-3.5 h-3.5 text-amber-400" />
              ) : item.key === 'highlight_inconsistencies' ? (
                <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              )}
              <span>{taskLoading === item.key ? 'Generating...' : item.label}</span>
            </button>
          ))}
        </div>

        {taskOutput && (
          <div className="rounded-xl bg-slate-950 border border-cyan-500/30 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 text-xs font-mono">
              <span className="text-cyan-300 uppercase">
                {taskOutput.task.replace(/_/g, ' ')} · {taskOutput.mode}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(taskOutput.output).catch(() => {});
                    setCopiedTask(true);
                    window.setTimeout(() => setCopiedTask(false), 1800);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 cursor-pointer"
                >
                  {copiedTask ? <Check className="w-3 h-3 text-emerald-400" /> : <ClipboardCopy className="w-3 h-3" />}
                  <span>{copiedTask ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSpeakMessage(taskOutput.output, 'assistant-task', language)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-cyan-300 cursor-pointer"
                >
                  <Volume2 className="w-3 h-3" />
                  <span>Listen</span>
                </button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-xs text-slate-200 leading-relaxed">
              {taskOutput.output}
            </pre>
          </div>
        )}
      </div>

      {/* Conversational Voice & Multilingual Agent */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">{t.agentTitle}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t.agentSubtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={language}
              onChange={(e) => {
                setManualOverride(true);
                setLanguage(e.target.value as SupportedLanguage);
              }}
              aria-label="Select spoken language"
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setDevilsAdvocate((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                devilsAdvocate
                  ? 'bg-violet-950/60 border-violet-500/70 text-violet-200'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              <span>
                {t.agentDevilsAdvocate}: {devilsAdvocate ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() =>
                askAgent(
                  devilsAdvocate
                    ? 'Argue the strongest innocent explanation for each flagged indicator and tell me what extra evidence would settle it.'
                    : 'Narrate a concise briefing of all stored indicators, contradictions, and limitations.',
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 hover:from-cyan-300 hover:to-violet-400 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>{t.agentNarrateSummary}</span>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                disabled={loading}
                onClick={() => askAgent(chip.prompt)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-cyan-500/50 text-[11px] font-medium text-cyan-200 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                {chip.label}
              </button>
            ))}
          </div>

          <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
            {messages.length === 0 && (
              <div className="text-xs text-slate-400 bg-slate-950/90 border border-slate-800 rounded-lg p-4 leading-relaxed">
                {t.agentSubtitle}
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg p-3.5 border text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-slate-900/70 border-slate-800 text-slate-200 ml-8'
                    : 'bg-slate-950/95 border-cyan-500/20 text-slate-200 mr-4'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5 font-mono text-[11px] text-slate-400">
                  <span>
                    {m.role === 'user' ? t.investigatorLabel : 'TruthLens Agent'} · {m.language.toUpperCase()}
                    {m.devilsAdvocate ? ` · ${t.agentDevilsAdvocate}` : ''}
                  </span>
                  {m.role === 'assistant' && (
                    <button
                      type="button"
                      onClick={() => handleSpeakMessage(m.content, m.id, m.language as SupportedLanguage)}
                      className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 cursor-pointer"
                    >
                      {speakingId === m.id && unifiedSpeaking ? (
                        <>
                          <Square className="w-3 h-3" />
                          <span>{t.audioStop}</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3 h-3" />
                          <span>{t.btnListen}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {(m.citedFindingIds ?? []).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-400">
                    Cited Indicators:{' '}
                    {(m.citedFindingIds ?? [])
                      .map((id) => findingById.get(id)?.indicator ?? id.slice(0, 8))
                      .join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          {interimTranscript && (
            <div className="text-xs font-mono text-cyan-300 bg-cyan-950/30 border border-cyan-500/30 rounded-lg px-3 py-2">
              Heard: “{interimTranscript}”
            </div>
          )}

          {modeNotice && (
            <div className="text-xs text-amber-200 bg-amber-950/35 border border-amber-800/50 rounded-lg px-3 py-2">
              {modeNotice}
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              askAgent(question);
            }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={toggleVoiceInput}
              aria-label={listening ? 'Stop microphone' : 'Ask by voice'}
              className={`p-2.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                listening
                  ? 'bg-rose-950/60 border-rose-500 text-rose-300'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-cyan-500'
              }`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={listening ? 'Listening...' : t.agentAskPlaceholder}
              className="flex-1 px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />

            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-white text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{loading ? t.working : t.agentSend}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
