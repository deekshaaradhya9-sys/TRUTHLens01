import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  QrCode,
  X,
  Copy,
  Check,
  Trash2,
  ShieldAlert,
  Clock,
  Download,
  Printer,
  ScanLine,
  Upload,
  Camera,
} from 'lucide-react';
import { apiRequest } from '../utils/api.ts';
import type { CaseShareTokenItem, SharePermissions } from '../types/forensics.ts';

interface CaseQrShareModalProps {
  caseId: string;
  caseTitle: string;
  canShare?: boolean;
  onOpenSharedToken?: (token: string) => void;
  onClose: () => void;
}

export const CaseQrShareModal: React.FC<CaseQrShareModalProps> = ({
  caseId,
  caseTitle,
  canShare = true,
  onOpenSharedToken,
  onClose,
}) => {
  const [tab, setTab] = useState<'generate' | 'scan'>('generate');
  const [tokens, setTokens] = useState<CaseShareTokenItem[]>([]);
  const [label, setLabel] = useState('External Reviewer / Oversight Briefing');
  const [expiresHours, setExpiresHours] = useState<number>(24);
  const [permissions, setPermissions] = useState<SharePermissions>({
    summary: true,
    findings: true,
    evidenceInventory: true,
    custodyDigest: true,
    timeline: false,
  });
  const [shareUrl, setShareUrl] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scanner state
  const [scanningCamera, setScanningCamera] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);

  const renderQr = async (url: string) => {
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 280,
        margin: 2,
        color: { dark: '#020617', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
    } catch {
      setQrDataUrl('');
    }
  };

  const loadTokens = useCallback(async () => {
    try {
      const res = await apiRequest<{ tokens: CaseShareTokenItem[] }>(
        `/api/cases/${caseId}/share-tokens`,
      );
      setTokens(Array.isArray(res.tokens) ? res.tokens : []);
    } catch {
      // non-fatal
    }
  }, [caseId]);

  useEffect(() => {
    loadTokens();
    const directUrl = `${window.location.origin}/case/${encodeURIComponent(caseId)}`;
    setShareUrl(directUrl);
    renderQr(directUrl);
  }, [caseId, loadTokens]);

  const stopCameraScan = useCallback(() => {
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setScanningCamera(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCameraScan();
    };
  }, [stopCameraScan]);

  const extractAndRouteQrValue = (rawValue: string) => {
    setScanResult(rawValue);
    try {
      const parsed = new URL(rawValue);
      const pathShareMatch = parsed.pathname.match(/^\/share\/([^/?#]+)/);
      const shareTok =
        parsed.searchParams.get('share') ||
        (pathShareMatch ? decodeURIComponent(pathShareMatch[1]) : null);
      if (shareTok && onOpenSharedToken) {
        stopCameraScan();
        onOpenSharedToken(shareTok);
        onClose();
        return;
      }
      const pathCaseMatch = parsed.pathname.match(/^\/case\/([^/?#]+)/);
      const caseTok =
        parsed.searchParams.get('case') ||
        (pathCaseMatch ? decodeURIComponent(pathCaseMatch[1]) : null);
      if (caseTok && parsed.origin === window.location.origin) {
        stopCameraScan();
        window.history.pushState({}, '', `/case/${encodeURIComponent(caseTok)}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
        onClose();
        return;
      }
    } catch {
      // Raw token fallback
      if (rawValue.trim().length >= 16 && !rawValue.includes(' ') && onOpenSharedToken) {
        stopCameraScan();
        onOpenSharedToken(rawValue.trim());
        onClose();
        return;
      }
    }
  };

  const handleStartCameraScan = async () => {
    setError(null);
    setScanResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access unavailable in this browser. Upload a QR image instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setScanningCamera(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      scanTimerRef.current = window.setInterval(() => {
        const video = videoRef.current;
        if (!video || !ctx || video.readyState < 2) return;
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imgData.data, imgData.width, imgData.height);
        if (decoded?.data) {
          extractAndRouteQrValue(decoded.data);
        }
      }, 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start camera QR scanner.');
      stopCameraScan();
    }
  };

  const handleScanImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setScanResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height);
        if (!decoded?.data) {
          setError('No readable QR code found in the selected image.');
        } else {
          extractAndRouteQrValue(decoded.data);
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateSignedShare = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{
        id: string;
        token: string;
        shareUrl?: string;
        label: string;
        expiresAt: number;
      }>(`/api/cases/${caseId}/share-token`, {
        method: 'POST',
        body: JSON.stringify({
          label: label.trim() || 'Shared Case Summary',
          expiresHours,
          permissions,
        }),
      });
      const signedUrl =
        res.shareUrl || `${window.location.origin}/share/${encodeURIComponent(res.token)}`;
      setShareUrl(signedUrl);
      await renderQr(signedUrl);
      await loadTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create signed share token.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    try {
      await apiRequest(`/api/cases/${caseId}/share-tokens/${tokenId}`, {
        method: 'DELETE',
      });
      await loadTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke share link.');
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleDownloadPng = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `TruthLens_QR_${caseId.slice(0, 8)}.png`;
    link.click();
  };

  const handlePrintSheet = () => {
    if (!qrDataUrl || typeof window === 'undefined') return;
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl glass-panel rounded-2xl p-6 space-y-5 my-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                QR Case Sharing &amp; Scanner
              </h2>
              <p className="text-xs text-slate-400 truncate max-w-md">{caseTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCameraScan();
              onClose();
            }}
            aria-label="Close QR Share modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => {
              stopCameraScan();
              setTab('generate');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              tab === 'generate'
                ? 'bg-cyan-500/20 border border-cyan-400 text-cyan-200'
                : 'bg-slate-950 border border-slate-800 text-slate-400'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Generate &amp; Manage QR</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('scan')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              tab === 'scan'
                ? 'bg-cyan-500/20 border border-cyan-400 text-cyan-200'
                : 'bg-slate-950 border border-slate-800 text-slate-400'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>Scan QR Code</span>
          </button>
        </div>

        {tab === 'scan' ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 space-y-3">
              <p className="text-xs text-slate-300">
                Scan any TruthLens QR briefing code via your device camera or upload a QR PNG image to open the verified dossier directly.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={scanningCamera ? stopCameraScan : handleStartCameraScan}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{scanningCamera ? 'Stop Camera Scanner' : 'Start Camera QR Scan'}</span>
                </button>
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Scan QR Image File</span>
                  <input type="file" accept="image/*" onChange={handleScanImageFile} className="hidden" />
                </label>
              </div>

              {scanningCamera && (
                <div className="rounded-xl overflow-hidden border border-cyan-500/40 bg-black max-w-sm mx-auto">
                  <video ref={videoRef} muted playsInline className="w-full h-56 object-cover" />
                </div>
              )}

              {scanResult && (
                <div className="rounded-lg bg-emerald-950/35 border border-emerald-700/50 p-3 text-xs font-mono text-emerald-200 break-all">
                  Decoded QR Payload: {scanResult}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-lg bg-amber-950/25 border border-amber-700/50 p-3 text-xs text-amber-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Permission-controlled QR links expose only the selected redacted summary scopes. Private evidence files, witness PII, and investigator agent chats are never exposed publicly.
              </span>
            </div>

            <div className="grid sm:grid-cols-12 gap-5 items-start">
              <div className="sm:col-span-5 flex flex-col items-center gap-3">
                <div className="bg-white rounded-xl p-3">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="Case QR Code" className="w-44 h-44" />
                  ) : (
                    <div className="w-44 h-44 flex items-center justify-center text-xs text-slate-600">
                      Generating QR...
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 w-full">
                  <button
                    type="button"
                    onClick={handleDownloadPng}
                    disabled={!qrDataUrl}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5 text-cyan-400" />
                    <span>PNG</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintSheet}
                    disabled={!qrDataUrl}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer disabled:opacity-50"
                  >
                    <Printer className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Print Sheet</span>
                  </button>
                </div>
              </div>

              <form onSubmit={handleGenerateSignedShare} className="sm:col-span-7 space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Share Label</label>
                  <input
                    type="text"
                    maxLength={80}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    disabled={!canShare}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Expiration Window</label>
                  <select
                    value={expiresHours}
                    onChange={(e) => setExpiresHours(Number(e.target.value))}
                    disabled={!canShare}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value={1}>1 Hour (Live Demo)</option>
                    <option value={24}>24 Hours</option>
                    <option value={72}>72 Hours</option>
                    <option value={168}>7 Days (168 Hours)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs text-slate-400">Permitted Public Scopes</div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-300">
                    {(
                      [
                        ['summary', 'Case Summary'],
                        ['findings', 'Forensic Indicators'],
                        ['evidenceInventory', 'SHA-256 Digest List'],
                        ['custodyDigest', 'Custody Head Hash'],
                        ['timeline', 'Activity Timeline'],
                      ] as const
                    ).map(([key, lbl]) => (
                      <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={permissions[key]}
                          disabled={!canShare}
                          onChange={(e) =>
                            setPermissions((p) => ({ ...p, [key]: e.target.checked }))
                          }
                          className="accent-cyan-400"
                        />
                        <span>{lbl}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy || !canShare}
                  className="w-full py-2 px-4 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 font-semibold text-xs cursor-pointer disabled:opacity-50"
                >
                  {busy
                    ? 'Signing Token...'
                    : canShare
                      ? 'Generate Signed Read-Only QR Link'
                      : 'Read-Only Role Cannot Issue Tokens'}
                </button>
              </form>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-slate-400">Active QR Target URL</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-cyan-200"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Link'}</span>
                </button>
              </div>
            </div>

            {tokens.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="text-xs font-mono text-slate-400">Issued Read-Only Share Tokens</div>
                <div className="max-h-36 overflow-y-auto space-y-2">
                  {tokens.map((tok) => (
                    <div
                      key={tok.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="text-slate-200 font-medium">{tok.label}</div>
                        <div className="text-[11px] font-mono text-slate-500 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Expires {new Date(tok.expiresAt).toLocaleString()}
                          </span>
                          <span>
                            · {tok.revoked ? 'REVOKED' : Date.now() > tok.expiresAt ? 'EXPIRED' : 'ACTIVE'}
                          </span>
                          <span>· Views: {tok.accessCount ?? 0}</span>
                        </div>
                      </div>
                      {!tok.revoked && canShare && (
                        <button
                          type="button"
                          onClick={() => handleRevokeToken(tok.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-950/40 text-[11px] cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Revoke</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg p-2.5">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
