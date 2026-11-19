import React, { useEffect, useRef, useState } from 'react';
import { Film, Volume2, VolumeX, Info } from 'lucide-react';
import { fetchAuthorizedResponse } from '../utils/api.ts';
import type { EvidenceItem } from '../types/forensics.ts';
import { ListenButton } from './ListenButton.tsx';

interface VideoForensicsPanelProps {
  caseId: string;
  evidence: EvidenceItem;
}

export const VideoForensicsPanel: React.FC<VideoForensicsPanelProps> = ({
  caseId,
  evidence,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [blobVideoUrl, setBlobVideoUrl] = useState<string>('');
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objUrl = '';
    if (evidence.hasFile) {
      fetchAuthorizedResponse(`/api/cases/${caseId}/evidence/${evidence.id}/file`)
        .then((res) => res.blob())
        .then((blob) => {
          if (!active) return;
          objUrl = URL.createObjectURL(blob);
          setBlobVideoUrl(objUrl);
        })
        .catch(() => {
          if (active) setVideoError('Video preview stream unavailable in this browser.');
        });
    }
    return () => {
      active = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [caseId, evidence.id, evidence.hasFile]);

  const metrics = (evidence.metrics ?? {}) as Record<string, unknown>;
  const frames = Array.isArray(evidence.frames) ? evidence.frames : [];
  const maxDelta = Math.max(25, ...frames.map((f) => Number(f.deltaScore) || 0));

  const seekToTimestamp = (sec: number) => {
    const el = videoRef.current;
    if (!el) return;
    try {
      el.currentTime = sec;
      el.play().catch(() => {
        // pause or manual play acceptable
      });
    } catch {
      // ignore seek error on partial streams
    }
  };

  const audioBrief = `Video ${evidence.originalFilename}. Container ${String(metrics.containerFormat ?? 'unknown')}, duration ${String(metrics.durationSec ?? '?')} seconds, ${frames.length} sampled keyframes. ${String(metrics.audioSyncNote ?? '')}`;

  return (
    <div className="glass-panel rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-violet-400" />
          <span className="font-semibold text-sm text-white">{evidence.originalFilename}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ListenButton text={audioBrief} compact />
          <span className="text-xs font-mono text-slate-400">
            {String(metrics.containerFormat ?? 'video').toUpperCase()} ·{' '}
            {metrics.width && metrics.height ? `${metrics.width}×${metrics.height}` : 'header parsed'} ·{' '}
            {metrics.durationSec ? `${metrics.durationSec}s` : 'duration n/a'}
          </span>
        </div>
      </div>

      {blobVideoUrl ? (
        <div className="rounded-lg overflow-hidden border border-slate-800 bg-black">
          <video
            ref={videoRef}
            src={blobVideoUrl}
            controls
            playsInline
            className="w-full max-h-[260px] object-contain mx-auto"
          />
        </div>
      ) : videoError ? (
        <div className="text-xs text-slate-400 font-mono bg-slate-950 border border-slate-800 rounded-lg p-3">
          {videoError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-2.5">
        {metrics.hasAudioTrack === true ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-300">
            <Volume2 className="w-3.5 h-3.5" />
            Audio Track Present
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-amber-300">
            <VolumeX className="w-3.5 h-3.5" />
            {metrics.hasAudioTrack === false ? 'Silent Container (No Audio Track)' : 'Audio Track Unknown'}
          </span>
        )}
        <span className="text-slate-400">{String(metrics.audioSyncNote ?? '')}</span>
      </div>

      {/* Interactive Frame Delta Timeline Bar Chart */}
      {frames.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Temporal Frame Delta Timeline (Click frame to seek)</span>
            <span>{frames.filter((f) => f.suspicious).length} flagged jump(s)</span>
          </div>
          <div className="grid gap-1.5 items-end h-14 bg-slate-950 border border-slate-800 rounded-lg p-2" style={{ gridTemplateColumns: `repeat(${frames.length}, minmax(0, 1fr))` }}>
            {frames.map((frame, i) => {
              const pct = Math.max(12, Math.round(((Number(frame.deltaScore) || 0) / maxDelta) * 100));
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => seekToTimestamp(frame.timestampSec)}
                  title={`${frame.timestampSec}s · Δ${frame.deltaScore}`}
                  className="h-full flex flex-col justify-end group cursor-pointer"
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      frame.suspicious ? 'bg-amber-400 group-hover:bg-amber-300' : 'bg-cyan-500/70 group-hover:bg-cyan-400'
                    }`}
                    style={{ height: `${pct}%` }}
                  />
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {frames.map((frame, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => seekToTimestamp(frame.timestampSec)}
                className={`text-left rounded-lg overflow-hidden border bg-slate-950 transition-colors cursor-pointer ${
                  frame.suspicious ? 'border-amber-500/70 hover:border-amber-400' : 'border-slate-800 hover:border-cyan-500/60'
                }`}
              >
                <img
                  src={frame.thumbnailDataUrl}
                  alt={`Video frame at ${frame.timestampSec}s`}
                  className="w-full h-20 object-cover"
                />
                <div className="p-2 text-[11px] font-mono flex items-center justify-between tabular-nums">
                  <span className="text-slate-300">{frame.timestampSec}s</span>
                  <span className={frame.suspicious ? 'text-amber-300' : 'text-cyan-300'}>
                    Δ {frame.deltaScore}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {frames.length === 0 && (
        <div className="text-xs text-slate-400 font-mono bg-slate-950 border border-slate-800 rounded-lg p-3">
          Uploaded raw video container ({evidence.byteSize.toLocaleString()} bytes) stored cleanly with SHA-256 custody hash; server container header audit completed.
        </div>
      )}

      <div className="text-[11px] text-slate-400 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
        <span>
          Limitation: Uniform {frames.length || 'container'}-frame sampling measures pixel luminance jumps, which can reflect normal jump-cuts or camera flashes rather than tampering.
        </span>
      </div>
    </div>
  );
};
