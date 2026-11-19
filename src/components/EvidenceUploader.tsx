import React, { useEffect, useRef, useState } from 'react';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Trash2,
  FileImage,
  Film,
  Music,
  FileText,
  Loader2,
  X,
  ArrowUpCircle,
  Link2,
  Globe,
} from 'lucide-react';
import { apiRequest, cleanText, uploadFileWithProgress } from '../utils/api.ts';
import { extractVideoKeyframes } from '../utils/videoFrames.ts';
import { useI18n } from '../i18n/translations.ts';
import type { FullCaseData } from '../types/forensics.ts';

const ACCEPTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.mp4',
  '.webm',
  '.wav',
  '.mp3',
  '.m4a',
  '.ogg',
  '.pdf',
  '.txt',
]);

const ACCEPTED_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
  'application/pdf',
  'application/x-pdf',
  'text/plain',
]);

export type QueueItemStatus = 'staged' | 'queued' | 'extracting' | 'uploading' | 'verified' | 'error';

interface UploadQueueItem {
  id: string;
  file: File;
  filename: string;
  mimeDisplay: string;
  sizeBytes: number;
  selectedAt: number;
  kind: 'image' | 'video' | 'audio' | 'document' | 'unknown';
  previewUrl: string | null;
  status: QueueItemStatus;
  progress: number;
  errorMessage?: string;
  sha256?: string;
}

interface EvidenceUploaderProps {
  caseId: string;
  maxUploadMb?: number;
  titleLabel: string;
  limitLabel: string;
  dropLabel: string;
  acceptedLabel: string;
  initialIngestUrl?: string | null;
  onUploaded: (updatedCase: FullCaseData) => void;
  onBusyChange?: (busy: boolean) => void;
}

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function detectFileKind(file: File): UploadQueueItem['kind'] {
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  const ext = getFileExtension(file.name);
  if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['.mp4', '.webm'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['.wav', '.mp3', '.m4a', '.ogg'].includes(ext)) return 'audio';
  if (mime === 'application/pdf' || mime === 'application/x-pdf' || mime === 'text/plain' || ['.pdf', '.txt'].includes(ext)) {
    return 'document';
  }
  return 'unknown';
}

function validateCandidateFile(file: File, maxUploadMb: number): string | null {
  const maxBytes = maxUploadMb * 1024 * 1024;
  if (file.size === 0) {
    return 'File is empty (0 bytes). Empty files cannot be ingested.';
  }
  if (file.size > maxBytes) {
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    return `File size (${mb} MB) exceeds the ${maxUploadMb} MB upload limit.`;
  }
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  const ext = getFileExtension(file.name);
  const isGenericMime = mime === '' || mime === 'application/octet-stream';

  if (isGenericMime) {
    if (!ACCEPTED_EXTENSIONS.has(ext)) {
      return `Unsupported extension "${ext || '(none)'}". Accepted: JPEG, JPG, PNG, WebP, MP4, WebM, WAV, MP3, M4A, OGG, PDF, TXT.`;
    }
    return null;
  }

  if (!ACCEPTED_MIMES.has(mime) && !ACCEPTED_EXTENSIONS.has(ext)) {
    return `Unsupported file type "${mime || ext}". Allowed: JPEG, JPG, PNG, WebP, MP4, WebM, WAV, MP3, M4A, OGG, PDF, TXT.`;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const EvidenceUploader: React.FC<EvidenceUploaderProps> = ({
  caseId,
  maxUploadMb = 15,
  titleLabel,
  limitLabel,
  dropLabel,
  acceptedLabel,
  initialIngestUrl = null,
  onUploaded,
  onBusyChange,
}) => {
  const { t } = useI18n();
  const [ingestMode, setIngestMode] = useState<'upload' | 'url'>(
    initialIngestUrl ? 'url' : 'upload',
  );
  const [urlInput, setUrlInput] = useState(initialIngestUrl || '');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlReceipt, setUrlReceipt] = useState<{
    kind: string;
    finalUrl: string;
    sha256: string;
  } | null>(null);

  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [videoSampleCount, setVideoSampleCount] = useState<8 | 12 | 16>(8);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (initialIngestUrl) {
      setIngestMode('url');
      setUrlInput(initialIngestUrl);
    }
  }, [initialIngestUrl]);

  useEffect(() => {
    return () => {
      for (const item of queue) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateItem = (id: string, patch: Partial<UploadQueueItem>) => {
    setQueue((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const processItem = async (item: UploadQueueItem) => {
    try {
      const form = new FormData();
      if (item.kind === 'video') {
        updateItem(item.id, { status: 'extracting', progress: 8 });
        const { frames, metadata } = await extractVideoKeyframes(item.file, videoSampleCount);
        if (frames.length > 0) {
          form.append('framesJson', JSON.stringify(frames));
        }
        form.append('videoMetaJson', JSON.stringify(metadata));
      }
      form.append('sourceType', 'upload');
      form.append('file', item.file);

      updateItem(item.id, { status: 'uploading', progress: 15 });
      const res = await uploadFileWithProgress<FullCaseData>(
        `/api/cases/${caseId}/evidence`,
        form,
        (pct) => {
          updateItem(item.id, { progress: Math.max(15, pct) });
        },
      );

      if (!res || !res.uploadedEvidenceId || !res.uploadedSha256) {
        throw new Error('Server did not return a verified custody receipt.');
      }

      updateItem(item.id, {
        status: 'verified',
        progress: 100,
        sha256: res.uploadedSha256,
        errorMessage: undefined,
      });
      onUploaded(res);
    } catch (err) {
      updateItem(item.id, {
        status: 'error',
        progress: 0,
        errorMessage: err instanceof Error ? err.message : 'Upload failed.',
      });
    }
  };

  useEffect(() => {
    const nextQueued = queue.find((item) => item.status === 'queued');
    const anyActive = queue.some(
      (item) => item.status === 'queued' || item.status === 'extracting' || item.status === 'uploading',
    );
    if (onBusyChange) onBusyChange(anyActive);

    if (!nextQueued || processingRef.current) return;

    processingRef.current = true;
    processItem(nextQueued).finally(() => {
      processingRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, caseId, videoSampleCount]);

  const enqueueFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const now = Date.now();
    const created: UploadQueueItem[] = files.map((file) => {
      const validationError = validateCandidateFile(file, maxUploadMb);
      const kind = detectFileKind(file);
      const previewUrl =
        !validationError && kind === 'image' ? URL.createObjectURL(file) : null;

      return {
        id: `${now}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        filename: cleanText(file.name) || 'evidence_file',
        mimeDisplay: file.type || getFileExtension(file.name) || 'binary',
        sizeBytes: file.size,
        selectedAt: now,
        kind,
        previewUrl,
        status: validationError ? 'error' : 'staged',
        progress: 0,
        errorMessage: validationError ?? undefined,
      };
    });

    setQueue((prev) => [...created, ...prev]);
  };

  const handleUploadAllStaged = () => {
    setQueue((prev) =>
      prev.map((it) => (it.status === 'staged' ? { ...it, status: 'queued' } : it)),
    );
  };

  const handleUploadSingle = (id: string) => {
    updateItem(id, { status: 'queued' });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      enqueueFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      enqueueFiles(e.dataTransfer.files);
    }
  };

  const handleRetry = (id: string) => {
    const target = queue.find((it) => it.id === id);
    if (!target) return;
    const validationError = validateCandidateFile(target.file, maxUploadMb);
    if (validationError) {
      updateItem(id, { status: 'error', errorMessage: validationError });
      return;
    }
    updateItem(id, { status: 'queued', progress: 0, errorMessage: undefined });
  };

  const handleRemove = (id: string) => {
    setQueue((prev) => {
      const victim = prev.find((it) => it.id === id);
      if (victim?.previewUrl) URL.revokeObjectURL(victim.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
  };

  const handleClearCompleted = () => {
    setQueue((prev) => {
      for (const it of prev) {
        if (it.status === 'verified' && it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      }
      return prev.filter((it) => it.status !== 'verified');
    });
  };

  const renderKindIcon = (kind: UploadQueueItem['kind']) => {
    if (kind === 'image') return <FileImage className="w-4 h-4 text-cyan-400" />;
    if (kind === 'video') return <Film className="w-4 h-4 text-violet-400" />;
    if (kind === 'audio') return <Music className="w-4 h-4 text-amber-400" />;
    return <FileText className="w-4 h-4 text-emerald-400" />;
  };

  const handleIngestUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError(null);
    setUrlReceipt(null);
    const trimmed = urlInput.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setUrlError('Enter a valid URL starting with https:// or http://.');
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      setUrlError('Only public http:// and https:// URLs are supported.');
      return;
    }

    setUrlLoading(true);
    if (onBusyChange) onBusyChange(true);
    try {
      const res = await apiRequest<FullCaseData>(`/api/cases/${caseId}/ingest-url`, {
        method: 'POST',
        body: JSON.stringify({ url: parsed.toString() }),
      });
      const meta = (res.ingestedUrlMetadata ?? {}) as Record<string, unknown>;
      setUrlReceipt({
        kind: String(meta.kind || 'artifact'),
        finalUrl: String(meta.finalUrl || parsed.toString()),
        sha256: String(res.uploadedSha256 || ''),
      });
      setUrlInput('');
      onUploaded(res);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Unable to inspect & seal URL.');
    } finally {
      setUrlLoading(false);
      if (onBusyChange) onBusyChange(false);
    }
  };

  const stagedCount = queue.filter((q) => q.status === 'staged').length;
  const verifiedCount = queue.filter((q) => q.status === 'verified').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{titleLabel}</h3>
        <span className="text-xs font-mono text-slate-400">
          Max {maxUploadMb} MB · {limitLabel}
        </span>
      </div>

      {/* Mode Switch: Local Upload vs Public URL Inspector */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800 text-xs">
        <button
          type="button"
          onClick={() => setIngestMode('upload')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md font-medium transition-colors cursor-pointer ${
            ingestMode === 'upload'
              ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/35'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Upload Files</span>
        </button>
        <button
          type="button"
          onClick={() => setIngestMode('url')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md font-medium transition-colors cursor-pointer ${
            ingestMode === 'url'
              ? 'bg-violet-500/20 text-violet-200 border border-violet-500/35'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Link2 className="w-3.5 h-3.5" />
          <span>Inspect URL / Link</span>
        </button>
      </div>

      {ingestMode === 'url' ? (
        <form onSubmit={handleIngestUrl} className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Globe className="w-4 h-4 text-violet-400 shrink-0" />
            <span>
              Fetch a public media file (image/audio/video/PDF) or webpage snapshot safely with SSRF DNS blocking, DOMPurify sanitization, and SHA-256 ledger sealing.
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              required
              maxLength={2048}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.org/article-or-media.jpg"
              className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-violet-400"
            />
            <button
              type="submit"
              disabled={urlLoading || !urlInput.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-400 to-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {urlLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              <span>{urlLoading ? 'Inspecting...' : 'Fetch & Seal URL'}</span>
            </button>
          </div>
          {urlError && (
            <div className="flex items-start gap-1.5 text-[11px] text-rose-300 bg-rose-950/35 border border-rose-800/50 rounded-lg px-2.5 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{urlError}</span>
            </div>
          )}
          {urlReceipt && (
            <div className="flex items-start gap-1.5 text-[11px] font-mono text-emerald-300 bg-emerald-950/35 border border-emerald-800/50 rounded-lg px-2.5 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-all">
                Sealed {urlReceipt.kind} from {urlReceipt.finalUrl} · SHA-256 {urlReceipt.sha256.slice(0, 16)}...
              </span>
            </div>
          )}
        </form>
      ) : (
        <>
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
            }}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            aria-label={dropLabel}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center cursor-pointer transition-all ${
              dragOver
                ? 'border-cyan-400 bg-cyan-950/30 shadow-[0_0_24px_rgba(6,182,212,0.22)]'
                : 'border-slate-700 hover:border-cyan-400 bg-slate-950/80'
            }`}
          >
            <Upload className={`w-5 h-5 ${dragOver ? 'text-cyan-300 scale-110' : 'text-cyan-400'} transition-transform`} />
            <span className="text-xs font-medium text-slate-200">{dropLabel}</span>
            <span className="text-[11px] text-slate-400">
              Drag &amp; drop multiple files, browse device, or pick from mobile gallery
            </span>
            <span className="text-[11px] font-mono text-slate-500">{acceptedLabel}</span>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/wav,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,application/pdf,text/plain,.jpg,.jpeg,.png,.webp,.mp4,.webm,.wav,.mp3,.m4a,.ogg,.pdf,.txt"
              onChange={handleInputChange}
              className="sr-only"
            />
          </div>

          {/* Video Frame Sampling Density Selector */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 px-1">
            <span>Video Frame Sampling:</span>
            <div className="flex items-center gap-1">
              {([8, 12, 16] as const).map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setVideoSampleCount(cnt)}
                  className={`px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                    videoSampleCount === cnt
                      ? 'bg-violet-500/20 border-violet-400/50 text-violet-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cnt} frames
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {queue.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
            <span>{t.ingestStagedTitle} ({queue.length})</span>
            <div className="flex items-center gap-3">
              {stagedCount > 0 && (
                <button
                  type="button"
                  onClick={handleUploadAllStaged}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 font-semibold text-xs cursor-pointer shadow-sm"
                >
                  <ArrowUpCircle className="w-3.5 h-3.5" />
                  <span>{t.ingestUploadAll} ({stagedCount})</span>
                </button>
              )}
              {verifiedCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearCompleted}
                  className="text-cyan-400 hover:text-cyan-300 cursor-pointer"
                >
                  Clear verified ({verifiedCount})
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {queue.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border p-2.5 text-xs bg-slate-950/90 ${
                  item.status === 'error'
                    ? 'border-rose-700/70'
                    : item.status === 'verified'
                      ? 'border-emerald-700/60'
                      : item.status === 'staged'
                        ? 'border-cyan-600/40'
                        : 'border-slate-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                    {item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt={item.filename}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      renderKindIcon(item.kind)
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-100 truncate">{item.filename}</span>
                      <span className="text-[11px] font-mono text-slate-400 shrink-0 tabular-nums">
                        {formatBytes(item.sizeBytes)} · {item.mimeDisplay}
                      </span>
                    </div>

                    {item.status === 'staged' && (
                      <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-cyan-300">
                        <span>Ready · Selected {new Date(item.selectedAt).toLocaleTimeString()}</span>
                        <button
                          type="button"
                          onClick={() => handleUploadSingle(item.id)}
                          className="text-emerald-300 hover:text-emerald-200 underline cursor-pointer"
                        >
                          Upload now
                        </button>
                      </div>
                    )}

                    {(item.status === 'queued' || item.status === 'extracting' || item.status === 'uploading') && (
                      <div className="space-y-1">
                        <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-all duration-150"
                            style={{ width: `${Math.max(6, item.progress)}%` }}
                          />
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-300">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>
                            {item.status === 'queued'
                              ? 'Queued for ingestion...'
                              : item.status === 'extracting'
                                ? `Sampling ${videoSampleCount} video keyframes...`
                                : `Uploading & hashing (${item.progress}%)`}
                          </span>
                        </div>
                      </div>
                    )}

                    {item.status === 'verified' && (
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          Verified &amp; Stored · SHA-256 {item.sha256?.slice(0, 16)}...
                        </span>
                      </div>
                    )}

                    {item.status === 'error' && (
                      <div className="flex items-start gap-1.5 text-[11px] text-rose-300 leading-snug">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{item.errorMessage}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {item.status === 'error' && (
                      <button
                        type="button"
                        onClick={() => handleRetry(item.id)}
                        title="Retry upload"
                        aria-label={`Retry ${item.filename}`}
                        className="p-1.5 rounded-md border border-slate-800 text-cyan-300 hover:border-cyan-500/50 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemove(item.id)}
                      title="Remove before upload"
                      aria-label={`Remove ${item.filename}`}
                      className="p-1.5 rounded-md border border-slate-800 text-slate-400 hover:text-rose-300 hover:border-rose-700/60 cursor-pointer"
                    >
                      {item.status === 'verified' ? (
                        <X className="w-3.5 h-3.5" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
