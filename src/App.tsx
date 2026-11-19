import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileDown,
  Plus,
  ScanLine,
  AlertTriangle,
  LogOut,
  CheckSquare,
  FileText,
  Settings,
  FileCheck2,
  X,
  Download,
  Trash2,
  Search,
  QrCode,
  ShieldCheck,
  PlayCircle,
  FlaskConical,
  ScanFace,
  GitFork,
  Bot,
  Bell,
  Users,
  Link2,
  LayoutDashboard,
  FolderKanban,
  UserCheck,
  Clock,
  Shield,
  Sun,
  Moon,
  UserCircle2,
  Receipt,
  GitBranchPlus,
  Check,
} from 'lucide-react';
import {
  apiRequest,
  fetchAuthorizedResponse,
  setCsrfToken,
  setSessionToken,
} from './utils/api.ts';
import { exportForensicReportPdf, type PdfImagePreview } from './utils/pdfReport.ts';
import type {
  AuthUser,
  CaseCategoryDef,
  CaseCommentItem,
  CaseSummary,
  EvidenceItem,
  FullCaseData,
  LedgerVerificationResult,
  PublicConfig,
  SupportedLanguage,
  TextSizePreference,
} from './types/forensics.ts';
import { useI18n } from './i18n/translations.ts';
import { useSpeech } from './utils/speechContext.tsx';
import { LanguageOnboarding } from './components/LanguageOnboarding.tsx';
import { AudioAccessibilityBar } from './components/AudioAccessibilityBar.tsx';
import { LandingHero } from './components/LandingHero.tsx';
import { RiskGauge } from './components/RiskGauge.tsx';
import { ElaSlider } from './components/ElaSlider.tsx';
import { VideoForensicsPanel } from './components/VideoForensicsPanel.tsx';
import { AudioSpectrogram } from './components/AudioSpectrogram.tsx';
import { ContradictionGraph } from './components/ContradictionGraph.tsx';
import { VoiceAgentPanel } from './components/VoiceAgentPanel.tsx';
import { CustodyLedgerPanel } from './components/CustodyLedgerPanel.tsx';
import { CommunityCalibrationPanel } from './components/CommunityCalibrationPanel.tsx';
import { EvidenceUploader } from './components/EvidenceUploader.tsx';
import { CrossModalCorrelationPanel } from './components/CrossModalCorrelationPanel.tsx';
import { ManipulationIndicatorsPanel } from './components/ManipulationIndicatorsPanel.tsx';
import { HumanVerificationPanel } from './components/HumanVerificationPanel.tsx';
import { LiveFaceScanner } from './components/LiveFaceScanner.tsx';
import { NotificationCentre } from './components/NotificationCentre.tsx';
import { CaseQrShareModal } from './components/CaseQrShareModal.tsx';
import { SharedCaseView } from './components/SharedCaseView.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { SecurityLimitationsPanel } from './components/SecurityLimitationsPanel.tsx';
import { DemoWalkthroughModal } from './components/DemoWalkthroughModal.tsx';
import { VoiceCommandBar } from './components/VoiceCommandBar.tsx';
import { ListenButton } from './components/ListenButton.tsx';
import { ProfileSecurityModal } from './components/ProfileSecurityModal.tsx';
import { IntelligenceDashboard } from './components/IntelligenceDashboard.tsx';
import { InvestigationRegister } from './components/InvestigationRegister.tsx';
import { WitnessesPanel } from './components/WitnessesPanel.tsx';
import { CollaborationTimelinePanel } from './components/CollaborationTimelinePanel.tsx';
import { SecurityAuditConsole } from './components/SecurityAuditConsole.tsx';
import { WebProvenancePanel } from './components/WebProvenancePanel.tsx';
import type { VoiceCommandAction } from './utils/voiceCommands.ts';

type WorkspaceTab =
  | 'dashboard'
  | 'register'
  | 'lab'
  | 'livecam'
  | 'graph'
  | 'agent'
  | 'witnesses'
  | 'timeline'
  | 'alerts'
  | 'ledger'
  | 'community'
  | 'security';

const VALID_TABS = new Set<WorkspaceTab>([
  'dashboard',
  'register',
  'lab',
  'livecam',
  'graph',
  'agent',
  'witnesses',
  'timeline',
  'alerts',
  'ledger',
  'community',
  'security',
]);

function parseAppUrlState(): {
  shareToken: string | null;
  caseId: string | null;
  tab: WorkspaceTab | null;
  ingestUrl: string | null;
  resetToken: string | null;
  verifyToken: string | null;
} {
  if (typeof window === 'undefined') {
    return {
      shareToken: null,
      caseId: null,
      tab: null,
      ingestUrl: null,
      resetToken: null,
      verifyToken: null,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const pathname = window.location.pathname || '/';

  const sharePathMatch = pathname.match(/^\/share\/([^/?#]+)/);
  const caseTabPathMatch = pathname.match(/^\/case\/([^/?#]+)(?:\/([^/?#]+))?/);
  const tabPathMatch = pathname.match(/^\/tab\/([^/?#]+)/);

  const rawTab =
    params.get('tab') ||
    (tabPathMatch ? decodeURIComponent(tabPathMatch[1]) : null) ||
    (caseTabPathMatch?.[2] ? decodeURIComponent(caseTabPathMatch[2]) : null);

  const tab = rawTab && VALID_TABS.has(rawTab as WorkspaceTab) ? (rawTab as WorkspaceTab) : null;
  const rawIngest = params.get('ingest_url');
  const ingestUrl =
    rawIngest && /^https?:\/\//i.test(rawIngest.trim()) ? rawIngest.trim() : null;

  return {
    shareToken:
      params.get('share') || (sharePathMatch ? decodeURIComponent(sharePathMatch[1]) : null),
    caseId:
      params.get('case') || (caseTabPathMatch ? decodeURIComponent(caseTabPathMatch[1]) : null),
    tab,
    ingestUrl,
    resetToken: params.get('reset_token'),
    verifyToken: params.get('verify_email'),
  };
}

const FALLBACK_CATEGORIES: CaseCategoryDef[] = [
  {
    slug: 'general',
    name: 'General Digital Investigation',
    description: 'General-purpose multimodal forensic triage.',
    fields: [],
    evidenceRequirements: [],
    reportTemplateNote: '',
  },
];

async function triggerAuthorizedDownload(url: string, filename: string) {
  const res = await fetchAuthorizedResponse(url);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}

async function fetchBlobAsDataUrl(url: string): Promise<string | undefined> {
  try {
    const res = await fetchAuthorizedResponse(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export default function App() {
  const {
    t,
    language,
    setLanguage,
    hasConfirmedLanguage,
    textSize,
    setTextSize,
    narrationEnabled,
    setNarrationEnabled,
    highContrast,
    setHighContrast,
    hydratePreferencesFromServer,
  } = useI18n();
  const { speakText, stop: stopSpeech } = useSpeech();

  const initialUrlState = React.useMemo(() => parseAppUrlState(), []);

  const [shareToken, setShareToken] = useState<string | null>(initialUrlState.shareToken);
  const [initialResetToken] = useState<string | null>(initialUrlState.resetToken);
  const [initialVerifyToken] = useState<string | null>(initialUrlState.verifyToken);
  const [deepLinkCaseId, setDeepLinkCaseId] = useState<string | null>(initialUrlState.caseId);
  const [initialIngestUrl, setInitialIngestUrl] = useState<string | null>(initialUrlState.ingestUrl);
  const [copiedCaseLink, setCopiedCaseLink] = useState(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return window.localStorage.getItem('tl_theme') === 'light' ? 'light' : 'dark';
  });

  const [publicConfig, setPublicConfig] = useState<PublicConfig>({
    maxUploadMb: 15,
    geminiConfigured: false,
    geminiModel: 'gemini-4-hydrogen',
    emailConfigured: false,
    emailProviderType: 'none',
    smsConfigured: false,
    supportedLanguages: ['en', 'kn', 'hi', 'ta', 'te', 'ml'],
  });

  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [categories, setCategories] = useState<CaseCategoryDef[]>(FALLBACK_CATEGORIES);
  const [casesList, setCasesList] = useState<CaseSummary[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [caseData, setCaseData] = useState<FullCaseData | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    initialUrlState.tab || (initialUrlState.ingestUrl ? 'lab' : 'lab'),
  );
  const [unreadNotifications, setUnreadNotifications] = useState<number>(0);

  const [caseSearch, setCaseSearch] = useState('');
  const [caseRiskFilter, setCaseRiskFilter] = useState<'All' | 'Low' | 'Medium' | 'High'>('All');
  const [caseCategoryFilter, setCaseCategoryFilter] = useState<string>('all');

  const [captionDraft, setCaptionDraft] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [ledgerStatus, setLedgerStatus] = useState<LedgerVerificationResult | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Version note inline state
  const [versioningEvidenceId, setVersioningEvidenceId] = useState<string | null>(null);
  const [versionNoteDraft, setVersionNoteDraft] = useState('');
  const [savingVersion, setSavingVersion] = useState(false);

  const [showNewCaseModal, setShowNewCaseModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showQrShareModal, setShowQrShareModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);

  const [confirmDeleteCaseId, setConfirmDeleteCaseId] = useState<string | null>(null);
  const [confirmDeleteEvidence, setConfirmDeleteEvidence] = useState<EvidenceItem | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCaption, setNewCaption] = useState('');
  const [newCategory, setNewCategory] = useState<string>('general');

  const activeCaseIdRef = useRef<string | null>(null);
  activeCaseIdRef.current = activeCaseId;

  // Apply Dark/Light Theme, Text Size & High Contrast cleanly on root element
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'tl-light', 'tl-text-sm', 'tl-text-md', 'tl-text-lg', 'tl-high-contrast');
    if (theme === 'light') {
      root.classList.add('tl-light');
    } else {
      root.classList.add('dark');
    }
    root.classList.add(`tl-text-${textSize}`);
    if (highContrast) {
      root.classList.add('tl-high-contrast');
    }
    try {
      window.localStorage.setItem('tl_theme', theme);
    } catch {
      // ignore
    }
  }, [theme, textSize, highContrast]);

  // Fetch public server config & investigation categories
  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        const body = (await res.json()) as { categories?: CaseCategoryDef[] };
        if (Array.isArray(body.categories) && body.categories.length > 0) {
          setCategories(body.categories);
        }
      }
    } catch {
      // fallback already set
    }
  }, []);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? (res.json() as Promise<PublicConfig>) : null))
      .then((cfg) => {
        if (cfg) setPublicConfig(cfg);
      })
      .catch(() => {});
    loadCategories();
  }, [loadCategories]);

  const loadUnreadNotifications = useCallback(async () => {
    try {
      const res = await apiRequest<{ unreadCount: number }>('/api/notifications/in-app');
      setUnreadNotifications(Number(res.unreadCount || 0));
    } catch {
      // non-fatal
    }
  }, []);

  const loadCases = useCallback(
    async (
      preferredCaseId?: string,
      opts?: {
        q?: string;
        risk?: string;
        category?: string;
        status?: string;
        priority?: string;
        sort?: string;
        assigned?: string;
        dateFrom?: string;
        dateTo?: string;
      },
    ) => {
      const params = new URLSearchParams();
      const qVal = (opts?.q ?? '').trim();
      if (qVal) params.set('q', qVal);
      if (opts?.risk && opts.risk !== 'All') params.set('risk', opts.risk);
      if (opts?.category && opts.category !== 'all') params.set('category', opts.category);
      if (opts?.status && opts.status !== 'all') params.set('status', opts.status);
      if (opts?.priority && opts.priority !== 'all') params.set('priority', opts.priority);
      if (opts?.sort) params.set('sort', opts.sort);
      if (opts?.assigned && opts.assigned !== 'all') params.set('assigned', opts.assigned);
      if (opts?.dateFrom) params.set('dateFrom', opts.dateFrom);
      if (opts?.dateTo) params.set('dateTo', opts.dateTo);

      const queryStr = params.toString();
      const res = await apiRequest<{ cases: CaseSummary[] }>(
        `/api/cases${queryStr ? `?${queryStr}` : ''}`,
      );
      const safeCases = Array.isArray(res.cases) ? res.cases : [];
      setCasesList(safeCases);

      const targetId =
        (preferredCaseId && safeCases.some((c) => c.id === preferredCaseId) ? preferredCaseId : null) ||
        safeCases[0]?.id ||
        null;

      if (targetId) {
        setActiveCaseId(targetId);
        const full = await apiRequest<FullCaseData>(`/api/cases/${targetId}`);
        setCaseData(full);
        setCaptionDraft(full.case?.captionText ?? '');
        setLedgerStatus(null);
      } else {
        setActiveCaseId(null);
        setCaseData(null);
      }
    },
    [],
  );

  // Bootstrap authentication session
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);

    apiRequest<{ authenticated: boolean; user: AuthUser | null; csrfToken: string | null }>(
      '/api/auth/me',
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (res.authenticated && res.user) {
          setUser(res.user);
          setCsrfToken(res.csrfToken);
          await Promise.all([
            hydratePreferencesFromServer(),
            loadCases(deepLinkCaseId ?? undefined),
            loadUnreadNotifications(),
          ]);
        }
      })
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(timer);
        setAuthChecked(true);
      });

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadCases, hydratePreferencesFromServer, deepLinkCaseId, loadUnreadNotifications]);

  // Real-time WebSocket stream for comments, notifications, and case updates
  useEffect(() => {
    if (!user) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onopen = () => {
        try {
          const tok = window.sessionStorage.getItem('tl_session_token');
          if (tok && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'auth', token: tok }));
          }
        } catch {
          // ignore
        }
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data || '{}')) as {
            type?: string;
            caseId?: string;
            data?: unknown;
          };
          if (msg.type === 'notification:new') {
            setUnreadNotifications((n) => n + 1);
          } else if (msg.type === 'case:comment' && msg.caseId === activeCaseIdRef.current) {
            const comment = msg.data as CaseCommentItem | undefined;
            if (comment?.id) {
              setCaseData((prev) => {
                if (!prev) return prev;
                const existing = Array.isArray(prev.comments) ? prev.comments : [];
                if (existing.some((c) => c.id === comment.id)) return prev;
                return { ...prev, comments: [...existing, comment] };
              });
            }
          } else if (msg.type === 'case:updated' && msg.caseId === activeCaseIdRef.current) {
            const updatedFull = msg.data as FullCaseData | undefined;
            if (updatedFull?.case?.id === activeCaseIdRef.current) {
              setCaseData(updatedFull);
            }
          }
        } catch {
          // ignore malformed ws frame
        }
      };
    } catch {
      // non-fatal
    }
    return () => {
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }, [user]);

  const handleFilterRefresh = useCallback(
    async (qVal: string, riskVal: string, catVal: string) => {
      if (!user) return;
      try {
        await loadCases(activeCaseId ?? undefined, { q: qVal, risk: riskVal, category: catVal });
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : 'Unable to filter cases.');
      }
    },
    [user, activeCaseId, loadCases],
  );

  const handleAuthenticated = async (
    authedUser: AuthUser,
    csrfToken: string,
    sessionToken?: string,
  ) => {
    setCsrfToken(csrfToken);
    setSessionToken(sessionToken ?? null);
    await Promise.all([
      hydratePreferencesFromServer(),
      loadCases(deepLinkCaseId ?? undefined),
      loadUnreadNotifications(),
    ]);
    setUser(authedUser);
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // clear local state regardless
    }
    setUser(null);
    setCsrfToken(null);
    setSessionToken(null);
    setCasesList([]);
    setCaseData(null);
    setActiveCaseId(null);
    setUnreadNotifications(0);
  };

  const handleSelectCase = async (caseId: string) => {
    setActiveCaseId(caseId);
    setStatusError(null);
    setStatusNote(null);
    setLedgerStatus(null);
    try {
      const full = await apiRequest<FullCaseData>(`/api/cases/${caseId}`);
      setCaseData(full);
      setCaptionDraft(full.case?.captionText ?? '');
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to load case.');
    }
  };

  const refreshActiveCase = async () => {
    if (!activeCaseId) return;
    await handleSelectCase(activeCaseId);
  };

  // Support browser back/forward and programmatic URL deep links
  useEffect(() => {
    const onPopState = () => {
      const parsed = parseAppUrlState();
      setShareToken(parsed.shareToken);
      if (parsed.tab) setActiveTab(parsed.tab);
      if (parsed.ingestUrl) setInitialIngestUrl(parsed.ingestUrl);
      if (parsed.caseId && parsed.caseId !== activeCaseIdRef.current) {
        setDeepLinkCaseId(parsed.caseId);
        if (user) {
          handleSelectCase(parsed.caseId).catch(() => {});
        }
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [user]);

  // Keep clean shareable URL in sync with active case & tab when signed in
  useEffect(() => {
    if (!user || !authChecked || shareToken) return;
    const isGlobal =
      activeTab === 'dashboard' || activeTab === 'register' || activeTab === 'security';
    let targetPath = '/';
    if (isGlobal) {
      targetPath = `/tab/${encodeURIComponent(activeTab)}`;
    } else if (activeCaseId) {
      targetPath =
        activeTab === 'lab'
          ? `/case/${encodeURIComponent(activeCaseId)}`
          : `/case/${encodeURIComponent(activeCaseId)}/${encodeURIComponent(activeTab)}`;
    } else {
      targetPath = `/tab/${encodeURIComponent(activeTab)}`;
    }
    if (window.location.pathname !== targetPath) {
      window.history.replaceState({}, '', targetPath);
    }
  }, [user, authChecked, shareToken, activeCaseId, activeTab]);

  const handleCopyCaseUrl = async () => {
    if (!caseData) return;
    const url = `${window.location.origin}/case/${encodeURIComponent(caseData.case.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCaseLink(true);
      window.setTimeout(() => setCopiedCaseLink(false), 2000);
    } catch {
      setStatusNote(`Direct case link: ${url}`);
    }
  };

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError(null);
    try {
      const created = await apiRequest<FullCaseData>('/api/cases', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          description: newDesc,
          captionText: newCaption,
          category: newCategory,
        }),
      });
      setShowNewCaseModal(false);
      setNewTitle('');
      setNewDesc('');
      setNewCaption('');
      setNewCategory('general');
      setCaseSearch('');
      setCaseRiskFilter('All');
      setCaseCategoryFilter('all');
      await loadCases(created.case.id);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to create case.');
    }
  };

  const handleConfirmDeleteCase = async () => {
    if (!confirmDeleteCaseId || deletingBusy) return;
    setDeletingBusy(true);
    setStatusError(null);
    try {
      await apiRequest(`/api/cases/${confirmDeleteCaseId}`, { method: 'DELETE' });
      setConfirmDeleteCaseId(null);
      setStatusNote('Case deleted cleanly from investigator workspace.');
      await loadCases(undefined, {
        q: caseSearch,
        risk: caseRiskFilter,
        category: caseCategoryFilter,
      });
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to delete case.');
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleConfirmDeleteEvidence = async () => {
    if (!activeCaseId || !confirmDeleteEvidence || deletingBusy) return;
    setDeletingBusy(true);
    setStatusError(null);
    try {
      const updated = await apiRequest<FullCaseData>(
        `/api/cases/${activeCaseId}/evidence/${confirmDeleteEvidence.id}`,
        { method: 'DELETE' },
      );
      setConfirmDeleteEvidence(null);
      setCaseData(updated);
      setStatusNote(
        `Removed "${confirmDeleteEvidence.originalFilename}" and logged EVIDENCE_REMOVED event in SHA-256 Custody Ledger.`,
      );
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to remove evidence item.');
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleAddEvidenceVersionNote = async (evidenceId: string) => {
    if (!activeCaseId || !versionNoteDraft.trim() || savingVersion) return;
    setSavingVersion(true);
    setStatusError(null);
    try {
      const updated = await apiRequest<FullCaseData>(
        `/api/cases/${activeCaseId}/evidence/${evidenceId}/version`,
        {
          method: 'POST',
          body: JSON.stringify({ note: versionNoteDraft.trim() }),
        },
      );
      setCaseData(updated);
      setVersioningEvidenceId(null);
      setVersionNoteDraft('');
      setStatusNote('Evidence version annotation committed to vault & SHA-256 ledger.');
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to record version note.');
    } finally {
      setSavingVersion(false);
    }
  };

  const handleSaveCaption = async () => {
    if (!activeCaseId) return;
    setStatusError(null);
    try {
      const updated = await apiRequest<FullCaseData>(`/api/cases/${activeCaseId}/caption`, {
        method: 'POST',
        body: JSON.stringify({ captionText: captionDraft }),
      });
      setCaseData(updated);
      setStatusNote('Caption claim saved to case bundle.');
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to update caption.');
    }
  };

  const handleAnalyze = async () => {
    if (!activeCaseId) return;
    setAnalyzing(true);
    setStatusError(null);
    setStatusNote(null);
    try {
      const updated = await apiRequest<FullCaseData>(`/api/cases/${activeCaseId}/analyze`, {
        method: 'POST',
      });
      setCaseData(updated);
      setStatusNote('Multimodal forensic analysis completed and committed to custody ledger.');
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Forensic analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExportPdf = async () => {
    if (!caseData || exportingPdf) return;
    setExportingPdf(true);
    try {
      const imageItems = (Array.isArray(caseData.evidence) ? caseData.evidence : []).filter(
        (e) => e.modality === 'image',
      );
      const imagePreviews: PdfImagePreview[] = await Promise.all(
        imageItems.slice(0, 4).map(async (img) => ({
          evidenceId: img.id,
          elaDataUrl: img.hasEla
            ? await fetchBlobAsDataUrl(`/api/cases/${caseData.case.id}/evidence/${img.id}/ela`)
            : undefined,
          fftDataUrl: img.hasFft
            ? await fetchBlobAsDataUrl(`/api/cases/${caseData.case.id}/evidence/${img.id}/fft`)
            : undefined,
        })),
      );
      exportForensicReportPdf(caseData, ledgerStatus, { imagePreviews });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleVoiceCommand = (action: VoiceCommandAction) => {
    switch (action.type) {
      case 'navigate':
        setActiveTab(action.tab);
        break;
      case 'new_case':
        setShowNewCaseModal(true);
        break;
      case 'run_analysis':
        handleAnalyze();
        break;
      case 'read_findings':
        if (caseData) {
          const topFindings = (Array.isArray(caseData.findings) ? caseData.findings : [])
            .slice(0, 3)
            .map((f) => `${f.severity} ${f.modality} indicator: ${f.indicator}. ${f.whyFlagged}`)
            .join(' ');
          speakText(
            `${caseData.case.title}. ${caseData.case.summary}. ${topFindings}`,
            language,
          );
        }
        break;
      case 'explain_risk':
        if (caseData) {
          speakText(
            `Calibrated risk level is ${caseData.case.riskLevel}, with confidence bounds ${caseData.case.confidenceMin} to ${caseData.case.confidenceMax} percent. These are technical anomaly indicators, never a binary verdict.`,
            language,
          );
        }
        break;
      case 'latest_report':
        handleExportPdf();
        break;
      case 'stop_speech':
        stopSpeech();
        break;
      case 'change_language':
        setLanguage(action.lang);
        break;
      case 'confirm_delete_case':
        if (activeCaseId) setConfirmDeleteCaseId(activeCaseId);
        break;
      case 'confirm_delete_evidence': {
        const firstEv = caseData?.evidence?.[0];
        if (firstEv) setConfirmDeleteEvidence(firstEv);
        break;
      }
      case 'unknown':
        setStatusNote(`Voice transcript: "${action.transcript}" (no matching navigation command).`);
        break;
    }
  };

  // Public read-only shared dossier mode (?share=<token>)
  if (shareToken) {
    return (
      <SharedCaseView
        token={shareToken}
        onExitShareMode={() => {
          setShareToken(null);
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/');
          }
        }}
      />
    );
  }

  if (!hasConfirmedLanguage) {
    return <LanguageOnboarding />;
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen forensic-grid-bg flex items-center justify-center text-xs font-mono text-cyan-400">
        {t.working}...
      </div>
    );
  }

  if (!user) {
    return (
      <LandingHero
        onAuthenticated={handleAuthenticated}
        initialResetToken={initialResetToken}
        initialVerifyToken={initialVerifyToken}
      />
    );
  }

  const role = String(user.role || 'investigator').toLowerCase();
  const isReadOnlyRole = role === 'viewer' || role === 'witness';
  const canCreateCase = !isReadOnlyRole;
  const canEditCase = !isReadOnlyRole;
  const canAssign = ['super_admin', 'investigation_admin', 'senior_investigator'].includes(role);
  const canManageCustody = [
    'super_admin',
    'investigation_admin',
    'senior_investigator',
    'investigator',
    'evidence_officer',
  ].includes(role);
  const canManageWitnesses = canManageCustody;
  const canViewWitnessPii = [
    'super_admin',
    'investigation_admin',
    'senior_investigator',
    'investigator',
  ].includes(role);
  const canShareCase = !isReadOnlyRole;

  const evidenceList = Array.isArray(caseData?.evidence) ? caseData.evidence : [];
  const findingsList = Array.isArray(caseData?.findings) ? caseData.findings : [];
  const limitationsList = Array.isArray(caseData?.case?.limitations) ? caseData.case.limitations : [];
  const alternativesList = Array.isArray(caseData?.case?.alternativeExplanations)
    ? caseData.case.alternativeExplanations
    : [];
  const checksList = Array.isArray(caseData?.case?.recommendedChecks)
    ? caseData.case.recommendedChecks
    : [];
  const correlationsList = Array.isArray(caseData?.correlations) ? caseData.correlations : [];
  const manipulationList = Array.isArray(caseData?.manipulationIndicators)
    ? caseData.manipulationIndicators
    : [];
  const witnessList = Array.isArray(caseData?.witnesses) ? caseData.witnesses : [];
  const commentsList = Array.isArray(caseData?.comments) ? caseData.comments : [];
  const activityList = Array.isArray(caseData?.activity) ? caseData.activity : [];
  const accessLogsList = Array.isArray(caseData?.evidenceAccessLogs)
    ? caseData.evidenceAccessLogs
    : [];

  const images = evidenceList.filter((e) => e.modality === 'image');
  const videos = evidenceList.filter((e) => e.modality === 'video');
  const audios = evidenceList.filter((e) => e.modality === 'audio');
  const documents = evidenceList.filter((e) => e.modality === 'document' || e.modality === 'text');

  const tabs: Array<{
    id: WorkspaceTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
    { id: 'register', label: 'Register', icon: <FolderKanban className="w-3.5 h-3.5" /> },
    { id: 'lab', label: t.navLab, icon: <FlaskConical className="w-3.5 h-3.5" /> },
    { id: 'livecam', label: t.navLiveCam, icon: <ScanFace className="w-3.5 h-3.5" /> },
    { id: 'graph', label: t.navGraph, icon: <GitFork className="w-3.5 h-3.5" /> },
    { id: 'agent', label: t.navAgent, icon: <Bot className="w-3.5 h-3.5" /> },
    { id: 'witnesses', label: 'Witnesses', icon: <UserCheck className="w-3.5 h-3.5" /> },
    { id: 'timeline', label: 'Timeline', icon: <Clock className="w-3.5 h-3.5" /> },
    {
      id: 'alerts',
      label: t.navAlerts,
      icon: <Bell className="w-3.5 h-3.5" />,
      badge: unreadNotifications > 0 ? unreadNotifications : undefined,
    },
    { id: 'ledger', label: t.navLedger, icon: <Link2 className="w-3.5 h-3.5" /> },
    { id: 'community', label: t.navCommunity, icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-3.5 h-3.5" /> },
  ];

  const findingsAudioSummary = findingsList.length
    ? `${caseData?.case?.title ?? 'Case'}. ${findingsList.length} indicators recorded. ${findingsList
        .slice(0, 4)
        .map((f) => `${f.severity} ${f.modality}: ${f.indicator}. ${f.whyFlagged}`)
        .join(' ')}`
    : t.findingsEmpty;

  const isGlobalTab = activeTab === 'dashboard' || activeTab === 'register' || activeTab === 'security';

  return (
    <div className="min-h-screen forensic-grid-bg text-slate-100 flex flex-col pb-20 md:pb-0">
      <OfflineIndicator />

      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#050814]/92 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-tr from-cyan-400 to-violet-500 shadow-[0_0_12px_rgba(6,182,212,0.85)]" />
            <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
              TruthLens
            </span>
          </div>

          <nav className="hidden xl:flex items-center gap-3 text-xs font-medium overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer pb-1 border-b-2 ${
                  activeTab === tab.id
                    ? 'text-cyan-300 border-cyan-400'
                    : 'text-slate-400 border-transparent hover:text-slate-100'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.badge ? (
                  <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-mono text-[10px] leading-4">
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 shrink-0">
            <VoiceCommandBar onCommand={handleVoiceCommand} />
            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle color theme"
              className="p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-cyan-500" />}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              title="Notifications & Alerts"
              aria-label="Open Notifications"
              className="relative p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -right-1 px-1 min-w-[16px] h-4 rounded-full bg-rose-500 text-white text-[10px] font-mono flex items-center justify-center">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowProfileModal(true)}
              title="Account Profile, Verification & Active Sessions"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-200 hover:border-cyan-500/40 text-xs cursor-pointer"
            >
              <UserCircle2 className="w-4 h-4 text-cyan-400" />
              <span className="max-w-[96px] truncate hidden md:inline">{user.displayName}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowDemoModal(true)}
              title={t.btnDemoGuide}
              className="hidden 2xl:inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:text-cyan-300 text-xs font-medium cursor-pointer whitespace-nowrap"
            >
              <PlayCircle className="w-3.5 h-3.5 text-cyan-400" />
            </button>

            <button
              type="button"
              onClick={() => setShowSecurityModal(true)}
              title={t.btnSecurity}
              aria-label={t.btnSecurity}
              className="p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
            </button>

            {canCreateCase && (
              <button
                type="button"
                onClick={() => setShowNewCaseModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 hover:from-cyan-300 hover:to-violet-400 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.btnNewCase}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              title={t.btnSettings}
              aria-label={t.btnSettings}
              className="p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              title={t.btnSignOut}
              aria-label={t.btnSignOut}
              className="p-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-400 hover:text-white hover:border-slate-700 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tablet / Compact Desktop Tab Strip */}
        <div className="hidden md:flex xl:hidden border-t border-slate-800/80 px-4 py-2 items-center gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-cyan-500/25 to-violet-500/25 text-cyan-200 border border-cyan-500/30'
                  : 'text-slate-400'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge ? (
                <span className="px-1.5 rounded-full bg-rose-500 text-white font-mono text-[10px]">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      <AudioAccessibilityBar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Case Context, Search, Filters & Action Toolbar (shown across case-centric views) */}
        <section className="glass-panel rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1 min-w-[260px]">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
                <span>
                  {t.investigatorLabel}: {user.displayName}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300 uppercase text-[10px]">
                  {role.replace(/_/g, ' ')}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-cyan-400">{t.goldenRuleShort}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  value={activeCaseId ?? ''}
                  onChange={(e) => handleSelectCase(e.target.value)}
                  aria-label="Select forensic case"
                  className="px-3 py-2 rounded-lg bg-[#0B1120] border border-slate-800 text-sm font-semibold text-white focus:outline-none focus:border-cyan-500 max-w-full sm:max-w-md cursor-pointer"
                >
                  {casesList.length === 0 && <option value="">No matching cases</option>}
                  {casesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.caseNumber ? `[${c.caseNumber}] ` : ''}
                      {c.title}
                    </option>
                  ))}
                </select>

                {caseData?.case && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                    <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-cyan-300 capitalize">
                      {(caseData.case.status || 'registered').replace(/_/g, ' ')}
                    </span>
                    <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-amber-300 uppercase">
                      {caseData.case.priority || 'medium'}
                    </span>
                  </div>
                )}

                {caseData && canEditCase && (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteCaseId(caseData.case.id)}
                    title={t.deleteCase}
                    aria-label={t.deleteCase}
                    className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 text-xs cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t.deleteCase}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 no-print">
              {caseData && (
                <>
                  <button
                    type="button"
                    onClick={handleCopyCaseUrl}
                    title="Copy direct link to this case"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedCaseLink ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                    <span>{copiedCaseLink ? 'Copied Link' : 'Copy Link'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQrShareModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{t.btnQrShare}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={exportingPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    <FileDown className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{exportingPdf ? t.working : t.btnExportPdf}</span>
                  </button>
                </>
              )}
              {canEditCase && (
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing || !caseData}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  <span>{analyzing ? t.btnScanning : t.btnRunAnalysis}</span>
                </button>
              )}
            </div>
          </div>

          {!isGlobalTab && (
            <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-800/80 no-print">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={caseSearch}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCaseSearch(val);
                    handleFilterRefresh(val, caseRiskFilter, caseCategoryFilter);
                  }}
                  placeholder={t.searchCasesPlaceholder}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <select
                value={caseRiskFilter}
                onChange={(e) => {
                  const val = e.target.value as 'All' | 'Low' | 'Medium' | 'High';
                  setCaseRiskFilter(val);
                  handleFilterRefresh(caseSearch, val, caseCategoryFilter);
                }}
                aria-label="Filter cases by risk level"
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value="All">Risk: All</option>
                <option value="High">Risk: High</option>
                <option value="Medium">Risk: Medium</option>
                <option value="Low">Risk: Low</option>
              </select>

              <select
                value={caseCategoryFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setCaseCategoryFilter(val);
                  handleFilterRefresh(caseSearch, caseRiskFilter, val);
                }}
                aria-label="Filter cases by category"
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value="all">Category: All</option>
                {categories.map((cat) => (
                  <option key={cat.slug} value={cat.slug}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        {isReadOnlyRole && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 px-4 py-2.5 text-xs text-amber-200">
            <strong>Read-Only / Witness Access ({role}):</strong> Creating cases, uploading artifacts, modifying forensic sign-offs, and issuing QR share tokens are restricted by RBAC.
          </div>
        )}

        {/* Scanning Beam Overlay during Analysis / Upload */}
        <AnimatePresence>
          {(analyzing || uploading) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative overflow-hidden glass-panel rounded-xl border-cyan-500/40 px-5 py-4"
            >
              <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-cyan-400 to-violet-500 shadow-[0_0_16px_rgba(6,182,212,0.9)] scan-beam" />
              <div className="flex items-center justify-between gap-4 text-xs font-mono text-cyan-300">
                <span>{uploading ? t.scanningUpload : t.scanningAnalyze}</span>
                <span>{t.working}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {statusError && (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
            {statusError}
          </div>
        )}

        {statusNote && (
          <div className="rounded-lg border border-cyan-800/60 bg-cyan-950/30 px-4 py-3 text-xs text-cyan-200">
            {statusNote}
          </div>
        )}

        {/* Global Workspace Tabs */}
        {activeTab === 'dashboard' && (
          <IntelligenceDashboard
            casesList={casesList}
            canCreateCase={canCreateCase}
            onSelectCase={async (cid, target) => {
              await handleSelectCase(cid);
              if (target) setActiveTab(target);
            }}
            onOpenNewCase={() => setShowNewCaseModal(true)}
          />
        )}

        {activeTab === 'register' && (
          <InvestigationRegister
            casesList={casesList}
            activeCaseData={caseData}
            categories={categories}
            canCreateCase={canCreateCase}
            canEditCase={canEditCase}
            canAssign={canAssign}
            onSelectCase={handleSelectCase}
            onOpenInLab={async (cid) => {
              await handleSelectCase(cid);
              setActiveTab('lab');
            }}
            onRefreshCases={async (filters) => {
              await loadCases(activeCaseId ?? undefined, filters);
            }}
            onCaseUpdated={(updated) => {
              setCaseData(updated);
              setActiveCaseId(updated.case.id);
              setCaptionDraft(updated.case.captionText ?? '');
            }}
          />
        )}

        {activeTab === 'security' && (
          <SecurityAuditConsole
            currentUser={user}
            onCategoriesChanged={loadCategories}
            onRoleUpdated={async () => {
              const me = await apiRequest<{ authenticated: boolean; user: AuthUser | null }>(
                '/api/auth/me',
              );
              if (me.authenticated && me.user) setUser(me.user);
            }}
          />
        )}

        {/* Case-Specific Tabs */}
        {!isGlobalTab && caseData && (
          <>
            {caseData.case.analysisStale && canEditCase && (
              <div className="rounded-xl border border-amber-500/50 bg-amber-950/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Evidence or caption text has changed since the last synthesis. Re-run Multimodal Analysis to refresh AI findings and the Contradiction Graph.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold cursor-pointer disabled:opacity-60"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  <span>{analyzing ? t.btnScanning : 'Refresh Synthesis'}</span>
                </button>
              </div>
            )}

            {/* Top Telemetry Summary Row (shown on Evidence Lab, Graph, Ledger) */}
            {(activeTab === 'lab' || activeTab === 'graph' || activeTab === 'ledger') && (
              <section className="grid lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-4 glass-panel rounded-xl p-5 flex flex-col justify-between">
                  <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                    {t.calibratedRiskTitle}
                  </div>
                  <RiskGauge
                    riskLevel={caseData.case.riskLevel}
                    confidenceMin={caseData.case.confidenceMin}
                    confidenceMax={caseData.case.confidenceMax}
                  />
                  <div className="text-[11px] text-slate-400 text-center border-t border-slate-800/80 pt-3">
                    {t.calibratedRiskFootnote}
                  </div>
                </div>

                <div className="lg:col-span-8 glass-panel rounded-xl p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
                        {t.caseSummaryTitle}
                      </div>
                      <ListenButton
                        text={`${caseData.case.title}. Calibrated Risk ${caseData.case.riskLevel}, ${caseData.case.confidenceMin} to ${caseData.case.confidenceMax} percent. ${caseData.case.summary}`}
                        compact
                      />
                    </div>
                    <p className="text-sm text-slate-200 leading-relaxed">{caseData.case.summary}</p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-slate-800/80 text-xs">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{t.limitationsTitle}</span>
                      </div>
                      <ul className="space-y-1 text-slate-400 leading-relaxed list-disc pl-4">
                        {limitationsList.slice(0, 3).map((lim, i) => (
                          <li key={i}>{lim}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>{t.alternativesTitle}</span>
                      </div>
                      <ul className="space-y-1 text-slate-400 leading-relaxed list-disc pl-4">
                        {alternativesList.slice(0, 3).map((alt, i) => (
                          <li key={i}>{alt}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Tab Views */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'lab' && (
                  <div className="space-y-8">
                    {/* Ingest Strip: Media + Document Upload + Caption Claim */}
                    <section className="grid lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-5 glass-panel rounded-xl p-5 space-y-4">
                        {canManageCustody ? (
                          <EvidenceUploader
                            key={caseData.case.id}
                            caseId={caseData.case.id}
                            maxUploadMb={publicConfig.maxUploadMb}
                            titleLabel={t.ingestTitle}
                            limitLabel={`${t.ingestLimit} · Max ${publicConfig.maxUploadMb} MB`}
                            dropLabel={t.ingestDropLabel}
                            acceptedLabel={t.ingestAccepted}
                            initialIngestUrl={initialIngestUrl}
                            onBusyChange={setUploading}
                            onUploaded={(updated) => {
                              setCaseData(updated);
                              setInitialIngestUrl(null);
                              setStatusError(null);
                              if (updated.uploadedSha256) {
                                setStatusNote(
                                  `Verified & stored artifact in immutable custody ledger (SHA-256 ${updated.uploadedSha256.slice(0, 14)}...).`,
                                );
                              }
                            }}
                          />
                        ) : (
                          <div className="text-xs text-slate-400 border border-slate-800 rounded-lg p-3">
                            Read-only role: evidence upload disabled.
                          </div>
                        )}

                        <div className="text-xs font-mono text-slate-400">
                          {t.loadedArtifacts}: {images.length} Image · {videos.length} Video ·{' '}
                          {audios.length} Audio · {documents.length} Doc
                        </div>

                        {evidenceList.length > 0 && (
                          <div className="space-y-2 max-h-64 overflow-y-auto pr-1 pt-2 border-t border-slate-800/80">
                            {evidenceList.map((ev) => (
                              <div
                                key={ev.id}
                                className="rounded-lg bg-slate-950/80 border border-slate-800 px-3 py-2 text-xs space-y-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-slate-200 truncate font-medium flex items-center gap-1.5">
                                      <span className="truncate">{ev.originalFilename}</span>
                                      {Array.isArray(ev.versions) && ev.versions.length > 0 && (
                                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 font-mono text-[10px]">
                                          v{ev.versions[ev.versions.length - 1].versionNumber}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] font-mono text-slate-500">
                                      {ev.modality.toUpperCase()} ·{' '}
                                      {ev.sourceType === 'live_camera'
                                        ? 'LIVE CAM'
                                        : ev.sourceType === 'url_ingest'
                                          ? 'URL INGEST'
                                          : 'UPLOAD'}{' '}
                                      · {ev.sha256.slice(0, 10)}...
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {ev.hasFile && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          triggerAuthorizedDownload(
                                            `/api/cases/${caseData.case.id}/evidence/${ev.id}/file?download=1`,
                                            ev.originalFilename,
                                          )
                                        }
                                        title="Download original sealed file"
                                        className="p-1.5 rounded text-slate-400 hover:text-cyan-300 cursor-pointer"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        triggerAuthorizedDownload(
                                          `/api/cases/${caseData.case.id}/evidence/${ev.id}/receipt`,
                                          `TruthLens_Receipt_${ev.id.slice(0, 8)}.txt`,
                                        )
                                      }
                                      title="Download Custody Receipt"
                                      className="p-1.5 rounded text-slate-400 hover:text-emerald-300 cursor-pointer"
                                    >
                                      <Receipt className="w-3.5 h-3.5" />
                                    </button>
                                    {canManageCustody && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setVersioningEvidenceId(
                                            versioningEvidenceId === ev.id ? null : ev.id,
                                          );
                                          setVersionNoteDraft('');
                                        }}
                                        title="Add version annotation"
                                        className="p-1.5 rounded text-slate-400 hover:text-amber-300 cursor-pointer"
                                      >
                                        <GitBranchPlus className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {canManageCustody && (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteEvidence(ev)}
                                        title={t.removeEvidence}
                                        aria-label={`${t.removeEvidence} ${ev.originalFilename}`}
                                        className="p-1.5 rounded text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {versioningEvidenceId === ev.id && (
                                  <div className="flex items-center gap-1.5 pt-1">
                                    <input
                                      type="text"
                                      value={versionNoteDraft}
                                      onChange={(e) => setVersionNoteDraft(e.target.value)}
                                      placeholder="Version / chain annotation note..."
                                      className="flex-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-white"
                                    />
                                    <button
                                      type="button"
                                      disabled={savingVersion || !versionNoteDraft.trim()}
                                      onClick={() => handleAddEvidenceVersionNote(ev.id)}
                                      className="px-2.5 py-1 rounded bg-cyan-400 text-slate-950 font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="lg:col-span-7 glass-panel rounded-xl p-5 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-violet-400" />
                            <h3 className="text-sm font-semibold text-white">{t.captionTitle}</h3>
                          </div>
                          {canEditCase && (
                            <button
                              type="button"
                              onClick={handleSaveCaption}
                              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs font-medium text-slate-200 cursor-pointer"
                            >
                              {t.captionSave}
                            </button>
                          )}
                        </div>
                        <textarea
                          rows={5}
                          disabled={!canEditCase}
                          value={captionDraft}
                          onChange={(e) => setCaptionDraft(e.target.value)}
                          placeholder={t.captionPlaceholder}
                          className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 leading-relaxed"
                        />
                      </div>
                    </section>

                    {/* Image Forensics */}
                    {images.length > 0 && (
                      <section className="space-y-4">
                        <h3 className="font-display text-base font-semibold text-white">
                          {t.imageSectionTitle}
                        </h3>
                        <div className="grid gap-6">
                          {images.map((img) => (
                            <ElaSlider
                              key={img.id}
                              caseId={caseData.case.id}
                              evidence={img}
                              peerImages={images}
                            />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Video Forensics */}
                    {videos.length > 0 && (
                      <section className="space-y-4">
                        <h3 className="font-display text-base font-semibold text-white">
                          {t.videoSectionTitle}
                        </h3>
                        <div className="grid gap-6">
                          {videos.map((vid) => (
                            <VideoForensicsPanel
                              key={vid.id}
                              caseId={caseData.case.id}
                              evidence={vid}
                            />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Audio Waveform + Spectrogram */}
                    {audios.length > 0 && (
                      <section className="space-y-4">
                        <h3 className="font-display text-base font-semibold text-white">
                          {t.audioSectionTitle}
                        </h3>
                        <div className="grid gap-6">
                          {audios.map((aud) => (
                            <AudioSpectrogram key={aud.id} caseId={caseData.case.id} evidence={aud} />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Document Forensics */}
                    {documents.length > 0 && (
                      <section className="space-y-4">
                        <h3 className="font-display text-base font-semibold text-white">
                          {t.documentSectionTitle}
                        </h3>
                        <div className="grid gap-4">
                          {documents.map((doc) => {
                            const dm = (doc.metrics ?? {}) as Record<string, unknown>;
                            const dates = Array.isArray(dm.extractedDates)
                              ? (dm.extractedDates as string[])
                              : [];
                            const locs = Array.isArray(dm.extractedLocations)
                              ? (dm.extractedLocations as string[])
                              : [];
                            const claims = Array.isArray(dm.extractedClaims)
                              ? (dm.extractedClaims as string[])
                              : [];
                            return (
                              <div key={doc.id} className="glass-panel rounded-xl p-5 space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <FileCheck2 className="w-4 h-4 text-violet-400" />
                                    <span className="text-sm font-semibold text-white">
                                      {doc.originalFilename}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2.5">
                                    <ListenButton
                                      text={`Document ${doc.originalFilename}. ${dates.length ? `Dates: ${dates.join(', ')}. ` : ''}${locs.length ? `Locations: ${locs.join(', ')}. ` : ''}${String(doc.transcript || dm.extractedExcerpt || '')}`}
                                      compact
                                    />
                                    <span className="text-xs font-mono text-slate-400">
                                      {doc.mimeType} · SHA-256 {doc.sha256.slice(0, 12)}...
                                    </span>
                                    {doc.hasFile && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          triggerAuthorizedDownload(
                                            `/api/cases/${caseData.case.id}/evidence/${doc.id}/file?download=1`,
                                            doc.originalFilename,
                                          )
                                        }
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 hover:border-cyan-500 text-[11px] font-medium text-slate-200 cursor-pointer"
                                      >
                                        <Download className="w-3 h-3 text-cyan-400" />
                                        <span>Download Original</span>
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                                  <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                                    <div className="text-slate-500">Format / Pages</div>
                                    <div className="text-cyan-300 mt-0.5">
                                      {dm.pdfVersion
                                        ? `PDF v${String(dm.pdfVersion)}`
                                        : String(dm.documentType ?? 'text').toUpperCase()}{' '}
                                      {dm.estimatedPages ? `· ${String(dm.estimatedPages)}p` : ''}
                                    </div>
                                  </div>
                                  <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                                    <div className="text-slate-500">Creator / Producer</div>
                                    <div className="text-slate-200 mt-0.5 truncate">
                                      {String(dm.creator || dm.producer || 'Not recorded')}
                                    </div>
                                  </div>
                                  <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                                    <div className="text-slate-500">Incremental %%EOF</div>
                                    <div
                                      className={`mt-0.5 ${
                                        Number(dm.incrementalUpdatesCount ?? 0) > 0
                                          ? 'text-amber-300'
                                          : 'text-emerald-300'
                                      }`}
                                    >
                                      {String(dm.incrementalUpdatesCount ?? 0)} revision(s)
                                    </div>
                                  </div>
                                  <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                                    <div className="text-slate-500">Embedded Scripts</div>
                                    <div
                                      className={`mt-0.5 ${
                                        Boolean(dm.hasEmbeddedScripts)
                                          ? 'text-rose-400 font-semibold'
                                          : 'text-emerald-300'
                                      }`}
                                    >
                                      {Boolean(dm.hasEmbeddedScripts) ? 'JS / Action Flagged' : 'None Detected'}
                                    </div>
                                  </div>
                                </div>

                                {(dates.length > 0 || locs.length > 0 || claims.length > 0) && (
                                  <div className="grid sm:grid-cols-3 gap-3 text-xs font-mono">
                                    <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                                      <div className="text-slate-500 mb-1">Extracted Dates</div>
                                      <div className="text-cyan-200">
                                        {dates.length > 0 ? dates.join(' · ') : 'None found'}
                                      </div>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                                      <div className="text-slate-500 mb-1">Extracted Locations</div>
                                      <div className="text-violet-200">
                                        {locs.length > 0 ? locs.join(' · ') : 'None found'}
                                      </div>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                                      <div className="text-slate-500 mb-1">Extracted Claims</div>
                                      <div className="text-slate-200">
                                        {claims.length > 0 ? claims.slice(0, 2).join(' | ') : 'None found'}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {Boolean(doc.transcript || dm.extractedExcerpt) && (
                                  <div className="text-xs text-slate-300 bg-slate-950/90 border border-slate-800 rounded-lg p-3 leading-relaxed">
                                    <span className="font-mono text-slate-500 block mb-1">
                                      Extracted Document Context Excerpt
                                    </span>
                                    {String(doc.transcript || dm.extractedExcerpt)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {/* Web Grounding & Cross-Case Perceptual Reuse Radar */}
                    <WebProvenancePanel
                      caseData={caseData}
                      canRunAnalysis={canEditCase}
                      onCaseUpdated={(updated) => setCaseData(updated)}
                      onOpenCase={(targetCaseId) => handleSelectCase(targetCaseId)}
                    />

                    {/* Explainable Findings Register */}
                    <section className="glass-panel rounded-xl overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <h3 className="text-sm font-semibold text-white">{t.findingsTitle}</h3>
                          <ListenButton text={findingsAudioSummary} compact />
                        </div>
                        <span className="text-xs font-mono text-slate-400 tabular-nums">
                          {findingsList.length} {t.recordedIndicators}
                        </span>
                      </div>

                      {findingsList.length === 0 ? (
                        <div className="p-6 text-xs text-slate-400">{t.findingsEmpty}</div>
                      ) : (
                        <div className="divide-y divide-slate-800/80">
                          {findingsList.map((f) => (
                            <div key={f.id} className="p-5 grid md:grid-cols-12 gap-4 text-xs">
                              <div className="md:col-span-4 space-y-1">
                                <div className="font-mono uppercase text-[11px] text-slate-400">
                                  <span
                                    className={
                                      f.severity === 'High'
                                        ? 'text-rose-400 font-semibold'
                                        : f.severity === 'Medium'
                                          ? 'text-amber-400 font-semibold'
                                          : 'text-emerald-400 font-semibold'
                                    }
                                  >
                                    {f.severity} Severity
                                  </span>{' '}
                                  · {f.modality}
                                </div>
                                <div className="text-sm font-semibold text-white">{f.indicator}</div>
                                <div className="font-mono text-cyan-300 tabular-nums">
                                  {f.locationOrTimestamp} · {f.confidenceRange}
                                </div>
                              </div>

                              <div className="md:col-span-5 text-slate-300 leading-relaxed">
                                <span className="font-mono text-slate-500 block mb-0.5">
                                  {t.whyFlagged}
                                </span>
                                {f.whyFlagged}
                              </div>

                              <div className="md:col-span-3 text-slate-400 leading-relaxed">
                                <span className="font-mono text-slate-500 block mb-0.5">
                                  {t.limitationLabel}
                                </span>
                                {f.limitation}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <ManipulationIndicatorsPanel indicators={manipulationList} />

                    {canEditCase && (
                      <HumanVerificationPanel
                        caseId={caseData.case.id}
                        recommendedChecks={checksList}
                        findings={findingsList}
                        initialReview={caseData.case.humanReview}
                        onSaved={(updated) => {
                          setCaseData(updated);
                          setStatusNote(
                            'Human investigator verification committed to immutable SHA-256 custody ledger.',
                          );
                        }}
                      />
                    )}
                  </div>
                )}

                {activeTab === 'livecam' && (
                  <LiveFaceScanner
                    caseId={caseData.case.id}
                    onCapturedEvidence={(updated) => {
                      setCaseData(updated);
                      setStatusNote(
                        'Live camera frame captured, verified, and committed to Evidence Lab & SHA-256 Custody Ledger.',
                      );
                    }}
                  />
                )}

                {activeTab === 'graph' && (
                  <div className="space-y-6">
                    <CrossModalCorrelationPanel correlations={correlationsList} />
                    <ContradictionGraph
                      nodes={caseData.graph?.nodes ?? []}
                      edges={caseData.graph?.edges ?? []}
                    />
                  </div>
                )}

                {activeTab === 'agent' && (
                  <VoiceAgentPanel
                    caseId={caseData.case.id}
                    findings={findingsList}
                    initialMessages={caseData.agentMessages ?? []}
                  />
                )}

                {activeTab === 'witnesses' && (
                  <WitnessesPanel
                    caseId={caseData.case.id}
                    witnesses={witnessList}
                    evidenceItems={evidenceList}
                    canManageWitnesses={canManageWitnesses}
                    canViewPii={canViewWitnessPii}
                    userRole={role}
                    onUpdated={(updated) => setCaseData(updated)}
                  />
                )}

                {activeTab === 'timeline' && (
                  <CollaborationTimelinePanel
                    caseId={caseData.case.id}
                    activity={activityList}
                    comments={commentsList}
                    evidenceItems={evidenceList}
                    evidenceAccessLogs={accessLogsList}
                    onCommentAdded={(comment) => {
                      setCaseData((prev) => {
                        if (!prev) return prev;
                        const existing = Array.isArray(prev.comments) ? prev.comments : [];
                        if (existing.some((c) => c.id === comment.id)) return prev;
                        return { ...prev, comments: [...existing, comment] };
                      });
                    }}
                  />
                )}

                {activeTab === 'alerts' && (
                  <NotificationCentre
                    activeCaseId={caseData.case.id}
                    activeCaseTitle={caseData.case.title}
                    emailProviderType={publicConfig.emailProviderType ?? 'none'}
                    onOpenCase={async (cid) => {
                      await handleSelectCase(cid);
                      setActiveTab('lab');
                    }}
                    onInAppChanged={(cnt) => setUnreadNotifications(cnt)}
                  />
                )}

                {activeTab === 'community' && (
                  <CommunityCalibrationPanel
                    topicKey="demo-benchmark-case"
                    caseId={caseData.case.id}
                    caseTitle={caseData.case.title}
                  />
                )}

                {activeTab === 'ledger' && (
                  <CustodyLedgerPanel
                    caseId={caseData.case.id}
                    entries={caseData.ledger ?? []}
                    evidenceItems={evidenceList}
                    canManageCustody={canManageCustody}
                    defaultActorName={user.displayName}
                    onVerified={(res) => setLedgerStatus(res)}
                    onCaseRefreshed={refreshActiveCase}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </>
        )}

        {!isGlobalTab && !caseData && (
          <div className="glass-panel rounded-xl p-8 text-center space-y-3">
            <div className="text-sm font-semibold text-white">No Active Investigation Selected</div>
            <p className="text-xs text-slate-400">
              Open the Investigation Register or create a new case to begin multimodal forensic analysis.
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('register')}
                className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 cursor-pointer"
              >
                Open Investigation Register
              </button>
              {canCreateCase && (
                <button
                  type="button"
                  onClick={() => setShowNewCaseModal(true)}
                  className="px-4 py-2 rounded-lg bg-cyan-400 text-slate-950 text-xs font-semibold cursor-pointer"
                >
                  {t.btnNewCase}
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Thumb Navigation Bar */}
      <nav
        aria-label="Mobile workspace navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-800/90 bg-[#050814]/95 backdrop-blur-md px-1 py-1 flex items-center gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[44px] min-w-[54px] shrink-0 flex flex-col items-center justify-center gap-0.5 px-1.5 rounded-lg text-[10px] font-medium cursor-pointer ${
              activeTab === tab.id ? 'text-cyan-300 bg-cyan-500/15' : 'text-slate-400'
            }`}
          >
            {tab.icon}
            <span className="truncate max-w-[52px]">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg glass-panel rounded-2xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-white">{t.settingsTitle}</h2>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                aria-label={t.closeLabel}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-200">{t.settingsLangLabel}</div>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  {t.settingsLangDesc}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { code: 'en', name: 'English', sub: 'English' },
                    { code: 'kn', name: 'ಕನ್ನಡ', sub: 'Kannada' },
                    { code: 'hi', name: 'हिन्दी', sub: 'Hindi' },
                    { code: 'ta', name: 'தமிழ்', sub: 'Tamil' },
                    { code: 'te', name: 'తెలుగు', sub: 'Telugu' },
                    { code: 'ml', name: 'മലയാളം', sub: 'Malayalam' },
                  ] as Array<{ code: SupportedLanguage; name: string; sub: string }>
                ).map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => setLanguage(item.code)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-colors ${
                      language === item.code
                        ? 'border-cyan-400 bg-gradient-to-r from-cyan-500/15 to-violet-500/15 text-white'
                        : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-semibold text-xs">{item.name}</span>
                    <span className="text-[11px] font-mono text-slate-400">{item.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-200">{t.onboardingTextSize}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['sm', 'md', 'lg'] as TextSizePreference[]).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setTextSize(sz)}
                      className={`py-2 rounded-lg border text-xs font-mono uppercase cursor-pointer ${
                        textSize === sz
                          ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                          : 'border-slate-800 bg-slate-950 text-slate-400'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-200">
                  {t.onboardingNarration} &amp; Contrast
                </div>
                <div className="flex flex-col gap-2 text-xs">
                  <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                    <span className="text-slate-300">{t.onboardingNarration}</span>
                    <input
                      type="checkbox"
                      checked={narrationEnabled}
                      onChange={(e) => setNarrationEnabled(e.target.checked)}
                      className="accent-cyan-400"
                    />
                  </label>
                  <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                    <span className="text-slate-300">{t.onboardingHighContrast}</span>
                    <input
                      type="checkbox"
                      checked={highContrast}
                      onChange={(e) => setHighContrast(e.target.checked)}
                      className="accent-cyan-400"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 text-xs font-semibold cursor-pointer"
              >
                {t.closeLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick New Case Modal */}
      {showNewCaseModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg glass-panel rounded-2xl p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-white">{t.newCaseTitle}</h2>
            <form onSubmit={handleCreateCase} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">{t.caseTitleLabel}</label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={140}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Case TL-2026-09: Coastal Storm Clip Verification"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">{t.caseDescLabel}</label>
                  <input
                    type="text"
                    maxLength={600}
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Context or source channel..."
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">Case Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    {categories.map((cat) => (
                      <option key={cat.slug} value={cat.slug}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">{t.caseCaptionLabel}</label>
                <textarea
                  rows={3}
                  maxLength={3000}
                  value={newCaption}
                  onChange={(e) => setNewCaption(e.target.value)}
                  placeholder="Paste claimed location, date, or speaker transcript..."
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewCaseModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  {t.cancelLabel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 hover:from-cyan-300 hover:to-violet-400 text-slate-950 text-xs font-semibold cursor-pointer"
                >
                  {t.createCaseSubmit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Case Confirmation Modal */}
      {confirmDeleteCaseId && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md glass-panel rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>Confirm Case Deletion</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Delete this case and its associated workspace artifacts? This action requires explicit confirmation and will be recorded in your security audit log.
            </p>
            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteCaseId(null)}
                className="px-4 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                {t.cancelLabel}
              </button>
              <button
                type="button"
                disabled={deletingBusy}
                onClick={handleConfirmDeleteCase}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                {deletingBusy ? t.working : t.deleteCase}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Evidence Item Confirmation Modal */}
      {confirmDeleteEvidence && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md glass-panel rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>Confirm Evidence Removal</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Remove <strong>{confirmDeleteEvidence.originalFilename}</strong> from this case? An immutable <code>EVIDENCE_REMOVED</code> entry preserving its SHA-256 digest will remain in the Custody Ledger.
            </p>
            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteEvidence(null)}
                className="px-4 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                {t.cancelLabel}
              </button>
              <button
                type="button"
                disabled={deletingBusy}
                onClick={handleConfirmDeleteEvidence}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                {deletingBusy ? t.working : t.removeEvidence}
              </button>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && user && (
        <ProfileSecurityModal
          user={user}
          onUserUpdated={(updated) => setUser(updated)}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {showQrShareModal && caseData && (
        <CaseQrShareModal
          caseId={caseData.case.id}
          caseTitle={caseData.case.title}
          canShare={canShareCase}
          onOpenSharedToken={(tok) => setShareToken(tok)}
          onClose={() => setShowQrShareModal(false)}
        />
      )}

      {showSecurityModal && (
        <SecurityLimitationsPanel onClose={() => setShowSecurityModal(false)} />
      )}

      {showDemoModal && (
        <DemoWalkthroughModal
          onJumpToTab={(tab) => setActiveTab(tab)}
          onTriggerPdf={caseData ? handleExportPdf : undefined}
          onClose={() => setShowDemoModal(false)}
        />
      )}
    </div>
  );
}
