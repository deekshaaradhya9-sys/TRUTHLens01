import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  ScanFace,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { FaceDetector, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { uploadFileWithProgress } from '../utils/api.ts';
import { useI18n } from '../i18n/translations.ts';
import type { FullCaseData } from '../types/forensics.ts';
import { ListenButton } from './ListenButton.tsx';

interface LiveFaceScannerProps {
  caseId: string;
  onCapturedEvidence: (updatedCase: FullCaseData) => void;
}

interface DetectedFaceTelemetry {
  index: number;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
  landmarkCount: number;
  earAvg: number | null;
  symmetryPct: number | null;
  jitterPx: number;
  blinkCount: number;
  blinking: boolean;
}

function landmarkDist(
  a: { x: number; y: number } | undefined,
  b: { x: number; y: number } | undefined,
  w: number,
  h: number,
): number {
  if (!a || !b) return 0;
  const dx = (a.x - b.x) * w;
  const dy = (a.y - b.y) * h;
  return Math.hypot(dx, dy);
}

function computeEyeAspectRatio(
  landmarks: Array<{ x: number; y: number }>,
  indices: [number, number, number, number, number, number],
  w: number,
  h: number,
): number | null {
  const [p1, p2, p3, p4, p5, p6] = indices.map((i) => landmarks[i]);
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return null;
  const verticalA = landmarkDist(p2, p6, w, h);
  const verticalB = landmarkDist(p3, p5, w, h);
  const horizontal = landmarkDist(p1, p4, w, h);
  if (horizontal < 1e-3) return null;
  return Number(((verticalA + verticalB) / (2 * horizontal)).toFixed(3));
}

export const LiveFaceScanner: React.FC<LiveFaceScannerProps> = ({
  caseId,
  onCapturedEvidence,
}) => {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);

  const [consentChecked, setConsentChecked] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [faces, setFaces] = useState<DetectedFaceTelemetry[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ filename: string; sha256: string } | null>(null);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      const ctx = overlay.getContext('2d');
      ctx?.clearRect(0, 0, overlay.width, overlay.height);
    }
    setCameraActive(false);
    setFaces([]);
  };

  useEffect(() => {
    return () => {
      stopCamera();
      detectorRef.current?.close();
      landmarkerRef.current?.close();
    };
  }, []);

  const initMediaPipeModels = async () => {
    if (detectorRef.current && landmarkerRef.current) {
      setModelsReady(true);
      return true;
    }
    setModelsLoading(true);
    try {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const [detector, landmarker] = await Promise.all([
        FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/mediapipe/models/blaze_face_short_range.tflite',
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.45,
        }),
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/mediapipe/models/face_landmarker.task',
          },
          runningMode: 'VIDEO',
          numFaces: 4,
        }),
      ]);
      detectorRef.current = detector;
      landmarkerRef.current = landmarker;
      setModelsReady(true);
      return true;
    } catch (err) {
      setStatusMessage(
        `Local MediaPipe WASM initialization fell back to frame capture mode (${err instanceof Error ? err.message : 'WASM unavailable'}).`,
      );
      setModelsReady(false);
      return false;
    } finally {
      setModelsLoading(false);
    }
  };

  const startDetectionLoop = () => {
    let lastTs = -1;
    const prevPointsByFace = new Map<number, Array<{ x: number; y: number }>>();
    const blinkStateByFace = new Map<number, { count: number; wasClosed: boolean }>();

    const renderFrame = () => {
      const video = videoRef.current;
      const canvas = overlayCanvasRef.current;
      if (!video || !canvas || !streamRef.current) return;

      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const nowMs = performance.now();
          if (nowMs > lastTs && detectorRef.current) {
            lastTs = nowMs;
            try {
              const detRes = detectorRef.current.detectForVideo(video, nowMs);
              const lmRes = landmarkerRef.current
                ? landmarkerRef.current.detectForVideo(video, nowMs)
                : null;

              const telemetry: DetectedFaceTelemetry[] = [];
              (detRes.detections ?? []).forEach((det, idx) => {
                const box = det.boundingBox;
                if (!box) return;
                const score = Math.round(((det.categories?.[0]?.score ?? 0) * 100));
                ctx.strokeStyle = '#22d3ee';
                ctx.lineWidth = 2.5;
                ctx.strokeRect(box.originX, box.originY, box.width, box.height);

                ctx.fillStyle = 'rgba(5, 8, 20, 0.85)';
                ctx.fillRect(box.originX, Math.max(0, box.originY - 24), 170, 22);
                ctx.fillStyle = '#67e8f9';
                ctx.font = '12px monospace';
                ctx.fillText(`Face #${idx + 1} · ${score}% conf`, box.originX + 6, Math.max(15, box.originY - 8));

                const landmarks = lmRes?.faceLandmarks?.[idx] ?? [];
                if (landmarks.length > 0) {
                  ctx.fillStyle = '#a78bfa';
                  for (let p = 0; p < landmarks.length; p += 3) {
                    const lm = landmarks[p];
                    ctx.beginPath();
                    ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 1.6, 0, Math.PI * 2);
                    ctx.fill();
                  }
                }

                // Compute local geometric telemetry (EAR, symmetry, jitter, blink cadence)
                const leftEar = computeEyeAspectRatio(
                  landmarks,
                  [33, 160, 158, 133, 153, 144],
                  canvas.width,
                  canvas.height,
                );
                const rightEar = computeEyeAspectRatio(
                  landmarks,
                  [362, 385, 387, 263, 373, 380],
                  canvas.width,
                  canvas.height,
                );
                const earAvg =
                  leftEar !== null && rightEar !== null
                    ? Number(((leftEar + rightEar) / 2).toFixed(3))
                    : leftEar ?? rightEar;

                const dLeft = landmarkDist(landmarks[1], landmarks[234], canvas.width, canvas.height);
                const dRight = landmarkDist(landmarks[1], landmarks[454], canvas.width, canvas.height);
                const symmetryPct =
                  dLeft > 1 && dRight > 1
                    ? Math.round((Math.min(dLeft, dRight) / Math.max(dLeft, dRight)) * 100)
                    : null;

                const anchorPts = [landmarks[1], landmarks[33], landmarks[263]].filter(Boolean);
                const prevPts = prevPointsByFace.get(idx);
                let jitterPx = 0;
                if (prevPts && prevPts.length === anchorPts.length && anchorPts.length > 0) {
                  const totalDisp = anchorPts.reduce(
                    (acc, pt, pIdx) => acc + landmarkDist(pt, prevPts[pIdx], canvas.width, canvas.height),
                    0,
                  );
                  jitterPx = Number((totalDisp / anchorPts.length).toFixed(2));
                }
                prevPointsByFace.set(
                  idx,
                  anchorPts.map((pt) => ({ x: pt.x, y: pt.y })),
                );

                const bState = blinkStateByFace.get(idx) ?? { count: 0, wasClosed: false };
                const blinking = earAvg !== null && earAvg < 0.21;
                if (blinking) {
                  bState.wasClosed = true;
                } else if (bState.wasClosed) {
                  bState.count += 1;
                  bState.wasClosed = false;
                }
                blinkStateByFace.set(idx, bState);

                telemetry.push({
                  index: idx + 1,
                  confidence: score,
                  bbox: {
                    x: Math.round(box.originX),
                    y: Math.round(box.originY),
                    w: Math.round(box.width),
                    h: Math.round(box.height),
                  },
                  landmarkCount: landmarks.length,
                  earAvg,
                  symmetryPct,
                  jitterPx,
                  blinkCount: bState.count,
                  blinking,
                });
              });
              setFaces(telemetry);
            } catch {
              // ignore transient video frame timestamps
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(renderFrame);
    };
    rafRef.current = requestAnimationFrame(renderFrame);
  };

  const handleStartCamera = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    if (!consentChecked) {
      setErrorMessage('Please acknowledge local camera consent before activating webcam.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage('Camera API unavailable in this browser/iframe context. Use Evidence Lab file upload instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      await initMediaPipeModels();
      startDetectionLoop();
    } catch (err) {
      stopCamera();
      setErrorMessage(
        err instanceof Error
          ? `Camera access blocked or unavailable (${err.message}). Upload a still image in Evidence Lab instead.`
          : 'Unable to open camera.',
      );
    }
  };

  const handleCaptureAndAnalyze = async () => {
    const video = videoRef.current;
    if (!video || !cameraActive || video.videoWidth === 0) return;

    setCapturing(true);
    setErrorMessage(null);
    try {
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const ctx = captureCanvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable.');
      ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        captureCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to encode JPEG capture'))),
          'image/jpeg',
          0.92,
        );
      });

      const filename = `live_capture_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
      const form = new FormData();
      form.append('sourceType', 'live_camera');
      form.append('file', blob, filename);

      const res = await uploadFileWithProgress<FullCaseData>(
        `/api/cases/${caseId}/evidence`,
        form,
      );
      if (res.uploadedSha256) {
        setLastReceipt({ filename, sha256: res.uploadedSha256 });
      }
      setStatusMessage(
        `Captured & analyzed live frame (${faces.length} face bounding box(es) observed). Added to Evidence Lab & SHA-256 Custody Ledger.`,
      );
      onCapturedEvidence(res);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to capture live frame.');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ScanFace className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-base font-semibold text-white">{t.liveCamTitle}</h3>
              <p className="text-xs text-slate-400">
                Local-first MediaPipe WASM face bounding box &amp; landmark detection · Explicit forensic frame capture
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ListenButton
              text="Live Camera Face and Artifact Scanner. MediaPipe runs locally in your browser after explicit consent. It detects faces and landmarks only and does not perform biometric identity matching or produce deepfake verdicts."
              compact
            />
            {!cameraActive ? (
              <button
                type="button"
                onClick={handleStartCamera}
                disabled={modelsLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-400 text-slate-950 font-semibold text-xs cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{modelsLoading ? 'Loading Local WASM...' : t.liveCamStart}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCaptureAndAnalyze}
                  disabled={capturing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  {capturing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  <span>{capturing ? t.working : t.liveCamCapture}</span>
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-medium cursor-pointer whitespace-nowrap"
                >
                  <CameraOff className="w-3.5 h-3.5" />
                  <span>{t.liveCamStop}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Explicit Forensic & Privacy Disclaimer */}
        <div className="rounded-lg bg-amber-950/25 border border-amber-700/50 p-3 flex items-start gap-2.5 text-xs text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed">
            <strong>Forensic &amp; Privacy Boundary:</strong> Detects face regions and geometric landmarks locally on-device only. Does <strong>not</strong> perform facial biometric identity matching, does <strong>not</strong> record silently in the background, and captured frame forensics (ELA/2D FFT/EXIF) produce probabilistic indicators—never absolute deepfake verdicts.
          </div>
        </div>

        {!cameraActive && (
          <label className="flex items-start gap-2.5 text-xs text-slate-300 bg-slate-950/75 border border-slate-800 rounded-lg p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 accent-cyan-400"
            />
            <span>
              I grant explicit permission to activate my local camera for on-device face-region inspection. Video frames remain local until I click <strong>{t.liveCamCapture}</strong>.
            </span>
          </label>
        )}

        {errorMessage && (
          <div className="rounded-lg bg-rose-950/40 border border-rose-700/60 p-3 text-xs text-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {statusMessage && (
          <div className="rounded-lg bg-emerald-950/35 border border-emerald-700/50 p-3 text-xs text-emerald-200 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div>{statusMessage}</div>
              {lastReceipt && (
                <div className="font-mono text-[11px] text-cyan-300">
                  {lastReceipt.filename} · SHA-256 {lastReceipt.sha256.slice(0, 24)}...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Live Video + Landmark Canvas Stage */}
        <div className="grid lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-8 relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-contain ${cameraActive ? 'block' : 'hidden'}`}
            />
            <canvas
              ref={overlayCanvasRef}
              className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${cameraActive ? 'block' : 'hidden'}`}
            />
            {!cameraActive && (
              <div className="text-center p-6 space-y-2">
                <ScanFace className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400 max-w-sm">
                  Camera inactive. Check consent above and click <strong>{t.liveCamStart}</strong> to run local MediaPipe BlazeFace &amp; FaceLandmarker detection.
                </p>
              </div>
            )}
          </div>

          <div className="lg:col-span-4 rounded-xl bg-slate-950/90 border border-slate-800 p-4 space-y-3 text-xs">
            <div className="font-mono text-[11px] uppercase tracking-wider text-cyan-300">
              Live Telemetry
            </div>
            <div className="space-y-1.5 font-mono text-[11px] text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">Camera Stream</span>
                <span className={cameraActive ? 'text-emerald-300' : 'text-slate-400'}>
                  {cameraActive ? 'ACTIVE' : 'STOPPED'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">WASM Detector</span>
                <span className={modelsReady ? 'text-cyan-300' : 'text-slate-400'}>
                  {modelsReady ? 'MediaPipe Local' : modelsLoading ? 'Loading...' : 'Standby'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Detected Faces</span>
                <span className="text-white tabular-nums">{faces.length}</span>
              </div>
            </div>

            {faces.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                {faces.map((f) => (
                  <div key={f.index} className="rounded-lg bg-slate-900/90 border border-slate-800 p-2.5 space-y-1.5 font-mono text-[11px] tabular-nums">
                    <div className="flex justify-between text-cyan-300">
                      <span>Face #{f.index}</span>
                      <span>{f.confidence}% conf</span>
                    </div>
                    <div className="text-slate-400">
                      Box: {f.bbox.w}×{f.bbox.h}px · Landmarks: {f.landmarkCount}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-800/80 text-[10px]">
                      <div>
                        <span className="text-slate-500 block">Eye Aspect (EAR)</span>
                        <span className={f.blinking ? 'text-amber-300' : 'text-emerald-300'}>
                          {f.earAvg !== null ? `${f.earAvg} (${f.blinking ? 'BLINK' : 'OPEN'})` : 'n/a'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Blinks Observed</span>
                        <span className="text-white">{f.blinkCount}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Facial Symmetry</span>
                        <span className="text-cyan-200">
                          {f.symmetryPct !== null ? `${f.symmetryPct}%` : 'n/a'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Landmark Jitter</span>
                        <span className="text-violet-300">{f.jitterPx} px</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
