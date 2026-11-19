import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SupportedLanguage, TextSizePreference, UserPreferences } from '../types/forensics.ts';
import { apiRequest } from '../utils/api.ts';

export type UiLanguage = SupportedLanguage;

const STORAGE_LANG_KEY = 'tl_lang';
const STORAGE_TEXT_SIZE_KEY = 'tl_text_size';
const STORAGE_NARRATION_KEY = 'tl_narration';
const STORAGE_CONTRAST_KEY = 'tl_contrast';

export const SUPPORTED_LANGUAGES: UiLanguage[] = ['en', 'kn', 'hi', 'ta', 'te', 'ml'];

export function isSupportedLanguage(val: unknown): val is UiLanguage {
  return typeof val === 'string' && SUPPORTED_LANGUAGES.includes(val as UiLanguage);
}

export interface TranslationDict {
  brandTagline: string;
  landingHeadline: string;
  landingSubheading: string;
  onboardingEyebrow: string;
  onboardingTitle: string;
  onboardingSubtitle: string;
  onboardingContinue: string;
  onboardingNote: string;
  onboardingTextSize: string;
  onboardingNarration: string;
  onboardingHighContrast: string;
  onboardingListenSample: string;
  navLab: string;
  navLiveCam: string;
  navGraph: string;
  navAgent: string;
  navAlerts: string;
  navCommunity: string;
  navLedger: string;
  btnNewCase: string;
  btnSettings: string;
  btnSignOut: string;
  btnExportPdf: string;
  btnRunAnalysis: string;
  btnScanning: string;
  btnDemoGuide: string;
  btnQrShare: string;
  btnSecurity: string;
  btnListen: string;
  btnStopListen: string;
  investigatorLabel: string;
  goldenRuleShort: string;
  calibratedRiskTitle: string;
  calibratedRiskFootnote: string;
  caseSummaryTitle: string;
  limitationsTitle: string;
  alternativesTitle: string;
  ingestTitle: string;
  ingestLimit: string;
  ingestDropLabel: string;
  ingestAccepted: string;
  ingestStagedTitle: string;
  ingestUploadAll: string;
  loadedArtifacts: string;
  removeEvidence: string;
  deleteCase: string;
  searchCasesPlaceholder: string;
  captionTitle: string;
  captionSave: string;
  captionPlaceholder: string;
  imageSectionTitle: string;
  videoSectionTitle: string;
  audioSectionTitle: string;
  documentSectionTitle: string;
  findingsTitle: string;
  findingsEmpty: string;
  recordedIndicators: string;
  whyFlagged: string;
  limitationLabel: string;
  recommendedChecksTitle: string;
  scanningUpload: string;
  scanningAnalyze: string;
  working: string;
  settingsTitle: string;
  settingsLangLabel: string;
  settingsLangDesc: string;
  closeLabel: string;
  newCaseTitle: string;
  caseTitleLabel: string;
  caseDescLabel: string;
  caseCaptionLabel: string;
  cancelLabel: string;
  createCaseSubmit: string;
  landingHeroDesc: string;
  landingSandboxBtn: string;
  landingOpeningSandbox: string;
  landingSignInTab: string;
  landingSignUpTab: string;
  landingDisplayName: string;
  landingEmail: string;
  landingPassword: string;
  landingSubmitSignIn: string;
  landingSubmitSignUp: string;
  landingAboutTitle: string;
  landingHowItWorksTitle: string;
  landingTechSecurityTitle: string;
  landingLivePreviewTitle: string;
  landingPillar1Title: string;
  landingPillar1Desc: string;
  landingPillar2Title: string;
  landingPillar2Desc: string;
  landingPillar3Title: string;
  landingPillar3Desc: string;
  audioBarTitle: string;
  audioListenSite: string;
  audioReadPage: string;
  audioReadSelection: string;
  audioPause: string;
  audioResume: string;
  audioStop: string;
  audioVoiceLabel: string;
  audioSpeedLabel: string;
  audioReady: string;
  audioSpeaking: string;
  audioPaused: string;
  audioNoSelection: string;
  audioNarrationOn: string;
  audioNarrationOff: string;
  audioUnsupportedFallback: string;
  graphHint: string;
  graphCorroborates: string;
  graphContradicts: string;
  graphInconclusive: string;
  graphInspectTitle: string;
  graphInspectPrompt: string;
  agentTitle: string;
  agentSubtitle: string;
  agentDevilsAdvocate: string;
  agentNarrateSummary: string;
  agentAskPlaceholder: string;
  agentSend: string;
  communityTitle: string;
  communitySubtitle: string;
  communityLiveWs: string;
  communityPlaceholder: string;
  communitySubmit: string;
  ledgerTitle: string;
  ledgerSubtitle: string;
  ledgerVerifyBtn: string;
  ledgerVerifying: string;
  auditLogTitle: string;
  auditLogSubtitle: string;
  manipulationTitle: string;
  crossModalTitle: string;
  voiceCmdBtn: string;
  voiceCmdListening: string;
  liveCamTitle: string;
  liveCamStart: string;
  liveCamStop: string;
  liveCamCapture: string;
  alertsTitle: string;
}

const EN_DICT: TranslationDict = {
  brandTagline: 'TRUTHLENS — EVIDENCE, NOT VERDICTS.',
  landingHeadline: 'SEE BEYOND THE EVIDENCE.',
  landingSubheading:
    'An intelligent multimodal forensic investigation platform that analyses digital evidence, identifies suspicious indicators and helps investigators understand the truth.',
  onboardingEyebrow: 'MULTILINGUAL ACCESSIBILITY & FORENSIC SETUP',
  onboardingTitle: 'Choose Your Language & Accessibility Profile',
  onboardingSubtitle:
    'TruthLens translates navigation, labels, forensic notifications, and audio narration while keeping original SHA-256 hashes, EXIF tags, timestamps, and filenames unaltered.',
  onboardingContinue: 'Enter TruthLens Workbench',
  onboardingNote: 'Preferences are saved locally and synced to your investigator profile.',
  onboardingTextSize: 'Text Size',
  onboardingNarration: 'Audio Narration',
  onboardingHighContrast: 'High Contrast',
  onboardingListenSample: 'Listen to Preview',
  navLab: 'Evidence Lab',
  navLiveCam: 'Live Face Scanner',
  navGraph: 'Contradiction Graph',
  navAgent: 'Voice Agent',
  navAlerts: 'Alerts & Notifications',
  navCommunity: 'Community Loop',
  navLedger: 'Custody Ledger',
  btnNewCase: 'New Case',
  btnSettings: 'Settings',
  btnSignOut: 'Sign Out',
  btnExportPdf: 'Export PDF Report',
  btnRunAnalysis: 'Run Multimodal Analysis',
  btnScanning: 'Scanning Modalities...',
  btnDemoGuide: 'Demo Guide',
  btnQrShare: 'QR Share',
  btnSecurity: 'Security & Limits',
  btnListen: 'Listen',
  btnStopListen: 'Stop',
  investigatorLabel: 'Investigator',
  goldenRuleShort: 'Indicators, not absolute verdicts',
  calibratedRiskTitle: 'Calibrated Risk Assessment',
  calibratedRiskFootnote: 'Score is an indicator from signal heuristics + AI synthesis, never a binary verdict.',
  caseSummaryTitle: 'Case Executive Summary',
  limitationsTitle: 'Methodological Limitations',
  alternativesTitle: 'Alternative Innocent Explanations',
  ingestTitle: 'Ingest Case Evidence',
  ingestLimit: 'Magic-byte verified · SHA-256 custody',
  ingestDropLabel: 'Drag & drop or browse Image, Video, Audio, or Document files',
  ingestAccepted: 'JPEG, JPG, PNG, WebP · MP4, WebM · WAV, MP3, M4A, OGG · PDF, TXT',
  ingestStagedTitle: 'Staged Queue (Inspect & Remove Before Upload)',
  ingestUploadAll: 'Upload & Verify Evidence',
  loadedArtifacts: 'Loaded Artifacts',
  removeEvidence: 'Remove Item',
  deleteCase: 'Delete Case',
  searchCasesPlaceholder: 'Search cases by title, ID, or claim...',
  captionTitle: 'Claimed Caption / Transcript Context',
  captionSave: 'Save Claim Text',
  captionPlaceholder:
    'Paste the social post caption, claimed date/location, or witness transcript to cross-check against media signals...',
  imageSectionTitle: 'Image Signal Analysis (ELA · 2D FFT · EXIF · dHash)',
  videoSectionTitle: 'Video Temporal Keyframe & A/V Sync Inspection',
  audioSectionTitle: 'Audio Waveform, Spectrogram & Synthetic-Speech Indicators',
  documentSectionTitle: 'Document Integrity, Entities & Metadata Inspection (PDF · TXT)',
  findingsTitle: 'Explainable Forensic Indicators',
  findingsEmpty: 'No indicators generated yet. Upload evidence and click Run Multimodal Analysis.',
  recordedIndicators: 'recorded indicators',
  whyFlagged: 'Why Flagged',
  limitationLabel: 'Limitation',
  recommendedChecksTitle: 'Recommended Human Investigator Checks',
  scanningUpload: 'Ingesting original artifact · verifying magic bytes · computing SHA-256 & signals...',
  scanningAnalyze: 'Running cross-modal Gemini synthesis across image, video, audio, documents & claims...',
  working: 'Active Scan',
  settingsTitle: 'Workbench Preferences, Language & Accessibility',
  settingsLangLabel: 'Interface Language',
  settingsLangDesc: 'Switches navigation, alerts, and default speech synthesis locale without modifying stored evidence.',
  closeLabel: 'Close',
  newCaseTitle: 'Create Forensic Case',
  caseTitleLabel: 'Case Title',
  caseDescLabel: 'Brief Description',
  caseCaptionLabel: 'Initial Caption / Claim Text (optional)',
  cancelLabel: 'Cancel',
  createCaseSubmit: 'Create Case',
  landingHeroDesc:
    'Explainable digital investigation platform combining Error Level Analysis, 2D FFT spectra, live face-landmark capture, video frame deltas, acoustic splice detection, PDF integrity checks, and SHA-256 custody chains.',
  landingSandboxBtn: 'Get Started — Launch Demo Sandbox',
  landingOpeningSandbox: 'Provisioning Forensic Sandbox...',
  landingSignInTab: 'Investigator Login',
  landingSignUpTab: 'Create Account',
  landingDisplayName: 'Investigator Display Name',
  landingEmail: 'Work Email',
  landingPassword: 'Password (min 8 chars)',
  landingSubmitSignIn: 'Sign In to Workbench',
  landingSubmitSignUp: 'Create Investigator Account',
  landingAboutTitle: 'About TruthLens',
  landingHowItWorksTitle: 'How It Works',
  landingTechSecurityTitle: 'Technology & Security Architecture',
  landingLivePreviewTitle: 'Live Investigation Preview',
  landingPillar1Title: 'Explainable Signals',
  landingPillar1Desc: 'ELA heatmaps, 2D FFT, pHash matching, 8–16 frame video deltas, PCM waveforms & PDF inspection.',
  landingPillar2Title: 'Cross-Modal Graph',
  landingPillar2Desc: 'Interactive contradiction graph connecting claims, metadata anchors, findings, and artifacts.',
  landingPillar3Title: 'Tamper-Evident Custody',
  landingPillar3Desc: 'SHA-256 hash-chained ledger, QR sharing, Resend/Twilio alerts, and 6-language voice access.',
  audioBarTitle: 'Audio Accessibility',
  audioListenSite: 'Listen to Briefing',
  audioReadPage: 'Read Current View',
  audioReadSelection: 'Read Selection',
  audioPause: 'Pause',
  audioResume: 'Resume',
  audioStop: 'Stop',
  audioVoiceLabel: 'Voice',
  audioSpeedLabel: 'Speed',
  audioReady: 'Ready',
  audioSpeaking: 'Speaking',
  audioPaused: 'Paused',
  audioNoSelection: 'Highlight any text on the page first, then click Read Selection.',
  audioNarrationOn: 'Narration ON',
  audioNarrationOff: 'Narration OFF',
  audioUnsupportedFallback: 'Speech audio is muted or unsupported on this browser; showing text briefing fallback below.',
  graphHint: 'Click any node or edge to inspect corroborating or contradicting evidence.',
  graphCorroborates: 'Corroborates',
  graphContradicts: 'Contradicts',
  graphInconclusive: 'Inconclusive',
  graphInspectTitle: 'Edge & Node Inspector',
  graphInspectPrompt: 'Select any node or colored link in the contradiction graph to examine its forensic rationale.',
  agentTitle: 'Multilingual Voice Forensic Agent',
  agentSubtitle: 'Strictly grounded in stored case indicators with calibrated risk language.',
  agentDevilsAdvocate: "Devil's Advocate",
  agentNarrateSummary: 'Narrate Case Brief',
  agentAskPlaceholder: 'Ask about timestamps, EXIF mismatches, ELA spikes, or innocent explanations...',
  agentSend: 'Ask',
  communityTitle: 'Real-Time Community Calibration Loop',
  communitySubtitle: 'Public benchmark calibration stream synced over WebSockets.',
  communityLiveWs: 'Live Stream',
  communityPlaceholder: 'Add a concise forensic calibration rationale...',
  communitySubmit: 'Submit Calibration Vote',
  ledgerTitle: 'Tamper-Evident Chain of Custody',
  ledgerSubtitle: 'Originals remain immutable outside web root; every entry hashes the previous SHA-256 record.',
  ledgerVerifyBtn: 'Verify Ledger Integrity',
  ledgerVerifying: 'Verifying SHA-256 Chain...',
  auditLogTitle: 'Investigator Security Audit Trail',
  auditLogSubtitle: 'Recent authenticated security & evidence operations recorded for your account.',
  manipulationTitle: 'Advanced Manipulation Indicators',
  crossModalTitle: 'Cross-Modal Correlation Engine',
  voiceCmdBtn: 'Voice Command',
  voiceCmdListening: 'Listening for command...',
  liveCamTitle: 'Live Camera Face & Artifact Scanner',
  liveCamStart: 'Start Camera',
  liveCamStop: 'Stop Camera',
  liveCamCapture: 'Capture Frame & Analyze',
  alertsTitle: 'Investigation Alerts & Notifications',
};

const TRANSLATIONS: Record<UiLanguage, TranslationDict> = {
  en: EN_DICT,
  kn: {
    ...EN_DICT,
    brandTagline: 'TRUTHLENS — ಸಾಕ್ಷ್ಯ ಮಾತ್ರ, ಅಂತಿಮ ತೀರ್ಪಲ್ಲ.',
    landingHeadline: 'ಸಾಕ್ಷ್ಯಕ್ಕಿಂತ ಆಚೆ ನೋಡಿ.',
    landingSubheading:
      'ಡಿಜಿಟಲ್ ಸಾಕ್ಷ್ಯವನ್ನು ವಿಶ್ಲೇಷಿಸಿ, ಅನುಮಾನಾಸ್ಪದ ಸೂಚಕಗಳನ್ನು ಗುರುತಿಸಿ ಮತ್ತು ಸತ್ಯವನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳಲು ತನಿಖಾಧಿಕಾರಿಗಳಿಗೆ ಸಹಾಯ ಮಾಡುವ ಬುದ್ಧಿವಂತ ಬಹುಮಾಧ್ಯಮ ಫೋರೆನ್ಸಿಕ್ ವೇದಿಕೆ.',
    onboardingEyebrow: 'ಬಹುಭಾಷಾ ಪ್ರವೇಶ ಮತ್ತು ಫೋರೆನ್ಸಿಕ್ ಸೆಟಪ್',
    onboardingTitle: 'ನಿಮ್ಮ ಭಾಷೆ ಮತ್ತು ಪ್ರವೇಶ ಆದ್ಯತೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ',
    onboardingSubtitle:
      'TruthLens ಮೆನುಗಳು, ಸೂಚನೆಗಳು, ಎಚ್ಚರಿಕೆಗಳು ಮತ್ತು ಧ್ವನಿ ವಿವರಣೆಯನ್ನು ಅನುವಾದಿಸುತ್ತದೆ; ಆದರೆ ಮೂಲ SHA-256 ಹ್ಯಾಶ್‌ಗಳು, EXIF ಟ್ಯಾಗ್‌ಗಳು ಮತ್ತು ಫೈಲ್ ಹೆಸರುಗಳನ್ನು ಬದಲಾಯಿಸದೆ ಉಳಿಸುತ್ತದೆ.',
    onboardingContinue: 'TruthLens ಗೆ ಪ್ರವೇಶಿಸಿ',
    onboardingNote: 'ನಿಮ್ಮ ಆದ್ಯತೆಗಳನ್ನು ಸ್ಥಳೀಯವಾಗಿ ಮತ್ತು ಪ್ರೊಫೈಲ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗುತ್ತದೆ.',
    onboardingTextSize: 'ಪಠ್ಯದ ಗಾತ್ರ',
    onboardingNarration: 'ಧ್ವನಿ ನಿರೂಪಣೆ',
    onboardingHighContrast: 'ಹೆಚ್ಚಿನ ಕಾಂಟ್ರಾಸ್ಟ್',
    onboardingListenSample: 'ಮಾದರಿ ಆಲಿಸಿ',
    navLab: 'ಸಾಕ್ಷ್ಯ ಪ್ರಯೋಗಾಲಯ',
    navLiveCam: 'ಲೈವ್ ಫೇಸ್ ಸ್ಕ್ಯಾನರ್',
    navGraph: 'ವಿರೋಧಾಭಾಸ ಗ್ರಾಫ್',
    navAgent: 'ಧ್ವನಿ ಏಜೆಂಟ್',
    navAlerts: 'ಎಚ್ಚರಿಕೆಗಳು',
    navCommunity: 'ಸಮುದಾಯ ಮೌಲ್ಯಮಾಪನ',
    navLedger: 'ಸುರಕ್ಷಾ ಲೆಡ್ಜರ್',
    btnNewCase: 'ಹೊಸ ಪ್ರಕರಣ',
    btnSettings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    btnSignOut: 'ಸೈನ್ ಔಟ್',
    btnExportPdf: 'PDF ವರದಿ ರಫ್ತು',
    btnRunAnalysis: 'ಬಹುಮಾಧ್ಯಮ ವಿಶ್ಲೇಷಣೆ ನಡೆಸಿ',
    btnScanning: 'ಮಾದರಿಗಳನ್ನು ಸ್ಕ್ಯಾನ್ ಮಾಡಲಾಗುತ್ತಿದೆ...',
    btnDemoGuide: 'ಡೆಮೊ ಮಾರ್ಗದರ್ಶಿ',
    btnQrShare: 'QR ಹಂಚಿಕೆ',
    btnSecurity: 'ಭದ್ರತೆ ಮತ್ತು ಮಿತಿಗಳು',
    btnListen: 'ಆಲಿಸಿ',
    btnStopListen: 'ನಿಲ್ಲಿಸಿ',
    investigatorLabel: 'ತನಿಖಾಧಿಕಾರಿ',
    goldenRuleShort: 'ಸೂಚಕಗಳು ಮಾತ್ರ, ಅಂತಿಮ ತೀರ್ಪಲ್ಲ',
    calibratedRiskTitle: 'ಅಪಾಯದ ಮಟ್ಟದ ಮೌಲ್ಯಮಾಪನ',
    caseSummaryTitle: 'ಪ್ರಕರಣದ ಕಾರ್ಯನಿರ್ವಾಹಕ ಸಾರಾಂಶ',
    limitationsTitle: 'ವಿಧಾನದ ಮಿತಿಗಳು',
    alternativesTitle: 'ಪರ್ಯಾಯ ನಿರಪರಾಧಿ ವಿವರಣೆಗಳು',
    ingestTitle: 'ಪ್ರಕರಣದ ಸಾಕ್ಷ್ಯ ಅಪ್‌ಲೋಡ್',
    ingestDropLabel: 'ಚಿತ್ರ, ವೀಡಿಯೊ, ಆಡಿಯೊ ಅಥವಾ ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ',
    ingestStagedTitle: 'ಸಿದ್ಧಪಡಿಸಿದ ಸಾಕ್ಷ್ಯ ಸರದಿ',
    ingestUploadAll: 'ಎಲ್ಲವನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ',
    loadedArtifacts: 'ಲೋಡ್ ಆದ ಸಾಕ್ಷ್ಯಗಳು',
    removeEvidence: 'ತೆಗೆದುಹಾಕಿ',
    deleteCase: 'ಪ್ರಕರಣ ಅಳಿಸಿ',
    searchCasesPlaceholder: 'ಶೀರ್ಷಿಕೆ, ID ಅಥವಾ ಹೇಳಿಕೆಯಿಂದ ಹುಡುಕಿ...',
    captionTitle: 'ಹಕ್ಕು ಸಾಧಿಸಿದ ಶೀರ್ಷಿಕೆ / ಪಠ್ಯ ಸಂದರ್ಭ',
    captionSave: 'ಪಠ್ಯವನ್ನು ಉಳಿಸಿ',
    imageSectionTitle: 'ಚಿತ್ರ ಸಿಗ್ನಲ್ ವಿಶ್ಲೇಷಣೆ (ELA · 2D FFT · EXIF · dHash)',
    videoSectionTitle: 'ವೀಡಿಯೊ ಫ್ರೇಮ್ ಮತ್ತು A/V ಸಿಂಕ್ ಪರಿಶೀಲನೆ',
    audioSectionTitle: 'ಆಡಿಯೊ ತರಂಗರೂಪ, ಸ್ಪೆಕ್ಟ್ರೋಗ್ರಾಮ್ ಮತ್ತು ಸಿಂಥೆಟಿಕ್ ಧ್ವನಿ ಸೂಚಕಗಳು',
    documentSectionTitle: 'ದಾಖಲೆ ಸಮಗ್ರತೆ ಮತ್ತು ಮೆಟಾಡೇಟಾ ಪರಿಶೀಲನೆ (PDF · TXT)',
    findingsTitle: 'ವಿವರಣಾತ್ಮಕ ಫೋರೆನ್ಸಿಕ್ ಸೂಚಕಗಳು',
    findingsEmpty: 'ಇನ್ನೂ ಸೂಚಕಗಳಿಲ್ಲ. ಸಾಕ್ಷ್ಯವನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ವಿಶ್ಲೇಷಣೆಯನ್ನು ಪ್ರಾರಂಭಿಸಿ.',
    recommendedChecksTitle: 'ಮಾನವ ತನಿಖಾಧಿಕಾರಿಗೆ ಶಿಫಾರಸು ಮಾಡಿದ ಪರಿಶೀಲನೆಗಳು',
    settingsTitle: 'ಕಾರ್ಯಸ್ಥಳದ ಆದ್ಯತೆಗಳು, ಭಾಷೆ ಮತ್ತು ಪ್ರವೇಶ',
    closeLabel: 'ಮುಚ್ಚಿ',
    newCaseTitle: 'ಹೊಸ ಫೋರೆನ್ಸಿಕ್ ಪ್ರಕರಣ ರಚಿಸಿ',
    cancelLabel: 'ರದ್ದುಮಾಡಿ',
    createCaseSubmit: 'ಪ್ರಕರಣ ರಚಿಸಿ',
    landingSandboxBtn: 'ಪ್ರಾರಂಭಿಸಿ — ಡೆಮೊ ಸ್ಯಾಂಡ್‌ಬಾಕ್ಸ್ ತೆರೆಯಿರಿ',
    landingSignInTab: 'ತನಿಖಾಧಿಕಾರಿ ಲಾಗಿನ್',
    landingSignUpTab: 'ಖಾತೆ ರಚಿಸಿ',
    landingAboutTitle: 'TruthLens ಬಗ್ಗೆ',
    landingHowItWorksTitle: 'ಇದು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ',
    landingTechSecurityTitle: 'ತಂತ್ರಜ್ಞಾನ ಮತ್ತು ಭದ್ರತೆ',
    landingLivePreviewTitle: 'ನೇರ ತನಿಖಾ ಮುನ್ನೋಟ',
    audioBarTitle: 'ಧ್ವನಿ ಪ್ರವೇಶ',
    audioListenSite: 'ಪರಿಚಯ ಆಲಿಸಿ',
    audioReadPage: 'ಪ್ರಸ್ತುತ ಪುಟ ಓದಿ',
    audioReadSelection: 'ಆಯ್ದ ಪಠ್ಯ ಓದಿ',
    audioPause: 'ವಿರಾಮ',
    audioResume: 'ಮುಂದುವರಿಸಿ',
    audioStop: 'ನಿಲ್ಲಿಸಿ',
    audioNarrationOn: 'ನಿರೂಪಣೆ ಆನ್',
    audioNarrationOff: 'ನಿರೂಪಣೆ ಆಫ್',
    agentTitle: 'ಬಹುಭಾಷಾ ಧ್ವನಿ ಫೋರೆನ್ಸಿಕ್ ಏಜೆಂಟ್',
    agentDevilsAdvocate: 'ಪ್ರತಿವಾದ ಮೋಡ್',
    agentNarrateSummary: 'ಸಾರಾಂಶ ಓದಿ',
    agentSend: 'ಕೇಳಿ',
    communityTitle: 'ನೈಜ-ಸಮಯದ ಸಮುದಾಯ ಮೌಲ್ಯಮಾಪನ',
    ledgerTitle: 'ಬದಲಾಯಿಸಲಾಗದ ಕಸ್ಟಡಿ ಲೆಡ್ಜರ್',
    ledgerVerifyBtn: 'ಲೆಡ್ಜರ್ ಸಮಗ್ರತೆ ಪರಿಶೀಲಿಸಿ',
    manipulationTitle: 'ಸುಧಾರಿತ ಹಸ್ತಕ್ಷೇಪ ಸೂಚಕಗಳು',
    crossModalTitle: 'ಕ್ರಾಸ್-ಮೋಡಲ್ ಸಹಸಂಬಂಧ ಎಂಜಿನ್',
    voiceCmdBtn: 'ಧ್ವನಿ ಆದೇಶ',
    voiceCmdListening: 'ಆದೇಶವನ್ನು ಆಲಿಸಲಾಗುತ್ತಿದೆ...',
    liveCamTitle: 'ಲೈವ್ ಕ್ಯಾಮೆರಾ ಫೇಸ್ ಸ್ಕ್ಯಾನರ್',
    liveCamStart: 'ಕ್ಯಾಮೆರಾ ಪ್ರಾರಂಭಿಸಿ',
    liveCamStop: 'ಕ್ಯಾಮೆರಾ ನಿಲ್ಲಿಸಿ',
    liveCamCapture: 'ಫ್ರೇಮ್ ಸೆರೆಹಿಡಿದು ವಿಶ್ಲೇಷಿಸಿ',
    alertsTitle: 'ತನಿಖಾ ಎಚ್ಚರಿಕೆಗಳು ಮತ್ತು ಅಧಿಸೂಚನೆಗಳು',
  },
  hi: {
    ...EN_DICT,
    brandTagline: 'TRUTHLENS — साक्ष्य, निर्णय नहीं।',
    landingHeadline: 'साक्ष्य से परे देखें।',
    landingSubheading:
      'एक बुद्धिमान मल्टीमॉडल फ़ोरेंसिक जांच मंच जो डिजिटल साक्ष्य का विश्लेषण करता है, संदिग्ध संकेतकों की पहचान करता है और जांचकर्ताओं को सत्य समझने में मदद करता है।',
    onboardingEyebrow: 'बहुभाषी सुगम्यता और फ़ोरेंसिक सेटअप',
    onboardingTitle: 'अपनी भाषा और सुगम्यता प्रोफ़ाइल चुनें',
    onboardingSubtitle:
      'TruthLens नेविगेशन, निर्देश, अलर्ट और ऑडियो विवरण का अनुवाद करता है, जबकि मूल SHA-256 हैश, EXIF टैग और फ़ाइल नाम अपरिवर्तित रहते हैं।',
    onboardingContinue: 'TruthLens कार्यक्षेत्र में प्रवेश करें',
    onboardingNote: 'आपकी प्राथमिकताएं स्थानीय और प्रोफ़ाइल दोनों में सहेजी जाती हैं।',
    onboardingTextSize: 'टेक्स्ट आकार',
    onboardingNarration: 'ऑडियो विवरण',
    onboardingHighContrast: 'उच्च कंट्रास्ट',
    onboardingListenSample: 'पूर्वावलोकन सुनें',
    navLab: 'साक्ष्य प्रयोगशाला',
    navLiveCam: 'लाइव फ़ेस स्कैनर',
    navGraph: 'विरोधाभास ग्राफ़',
    navAgent: 'वॉइस एजेंट',
    navAlerts: 'अलर्ट और सूचनाएं',
    navCommunity: 'कम्युनिटी लूप',
    navLedger: 'कस्टडी लेजर',
    btnNewCase: 'नया केस',
    btnSettings: 'सेटिंग्स',
    btnSignOut: 'साइन आउट',
    btnExportPdf: 'PDF रिपोर्ट निर्यात',
    btnRunAnalysis: 'मल्टीमॉडल विश्लेषण चलाएं',
    btnScanning: 'मॉडैलिटी स्कैन हो रही है...',
    btnDemoGuide: 'डेमो गाइड',
    btnQrShare: 'QR शेयर',
    btnSecurity: 'सुरक्षा और सीमाएं',
    btnListen: 'सुनें',
    btnStopListen: 'रोकें',
    investigatorLabel: 'जांचकर्ता',
    goldenRuleShort: 'संकेतक मात्र, अंतिम निर्णय नहीं',
    calibratedRiskTitle: 'कैलिब्रेटेड जोखिम मूल्यांकन',
    caseSummaryTitle: 'केस कार्यकारी सारांश',
    limitationsTitle: 'पद्धतिगत सीमाएं',
    alternativesTitle: 'वैकल्पिक निर्दोष स्पष्टीकरण',
    ingestTitle: 'केस साक्ष्य अपलोड करें',
    ingestDropLabel: 'छवि, वीडियो, ऑडियो या दस्तावेज़ फ़ाइलें अपलोड करें',
    ingestStagedTitle: 'स्टेज्ड कतार (अपलोड से पहले जांचें)',
    ingestUploadAll: 'सभी अपलोड और सत्यापित करें',
    loadedArtifacts: 'लोड की गई फ़ाइलें',
    removeEvidence: 'हटाएं',
    deleteCase: 'केस हटाएं',
    searchCasesPlaceholder: 'शीर्षक, ID या दावे से केस खोजें...',
    captionTitle: 'दावा किया गया कैप्शन / ट्रांसक्रिप्ट संदर्भ',
    captionSave: 'दावा टेक्स्ट सहेजें',
    imageSectionTitle: 'छवि सिग्नल विश्लेषण (ELA · 2D FFT · EXIF · dHash)',
    videoSectionTitle: 'वीडियो कीफ़्रेम और A/V सिंक जांच',
    audioSectionTitle: 'ऑडियो वेवफ़ॉर्म, स्पेक्ट्रोग्राम और सिंथेटिक-स्पीच संकेतक',
    documentSectionTitle: 'दस्तावेज़ अखंडता और मेटाडेटा निरीक्षण (PDF · TXT)',
    findingsTitle: 'व्याख्यात्मक फ़ोरेंसिक संकेतक',
    findingsEmpty: 'अभी तक कोई संकेतक नहीं है। साक्ष्य अपलोड करें और मल्टीमॉडल विश्लेषण चलाएं।',
    recommendedChecksTitle: 'मानव जांचकर्ता के लिए अनुशंसित जांच',
    settingsTitle: 'कार्यक्षेत्र प्राथमिकताएं, भाषा और सुगम्यता',
    closeLabel: 'बंद करें',
    newCaseTitle: 'नया फ़ोरेंसिक केस बनाएं',
    cancelLabel: 'रद्द करें',
    createCaseSubmit: 'केस बनाएं',
    landingSandboxBtn: 'शुरू करें — डेमो सैंडबॉक्स खोलें',
    landingSignInTab: 'जांचकर्ता लॉगिन',
    landingSignUpTab: 'खाता बनाएं',
    landingAboutTitle: 'TruthLens के बारे में',
    landingHowItWorksTitle: 'यह कैसे काम करता है',
    landingTechSecurityTitle: 'प्रौद्योगिकी और सुरक्षा संरचना',
    landingLivePreviewTitle: 'लाइव जांच पूर्वावलोकन',
    audioBarTitle: 'ऑडियो सुगम्यता',
    audioListenSite: 'संक्षिप्त सुनें',
    audioReadPage: 'वर्तमान दृश्य पढ़ें',
    audioReadSelection: 'चयनित पाठ पढ़ें',
    audioPause: 'रोकें',
    audioResume: 'जारी रखें',
    audioStop: 'बंद करें',
    audioNarrationOn: 'विवरण चालू',
    audioNarrationOff: 'विवरण बंद',
    agentTitle: 'बहुभाषी वॉइस फ़ोरेंसिक एजेंट',
    agentDevilsAdvocate: 'प्रतिपक्ष मोड',
    agentNarrateSummary: 'केस सारांश सुनाएं',
    agentSend: 'पूछें',
    communityTitle: 'रियल-टाइम कम्युनिटी कैलिब्रेशन लूप',
    ledgerTitle: 'छेड़छाड़-रोधी कस्टडी श्रृंखला',
    ledgerVerifyBtn: 'लेजर अखंडता सत्यापित करें',
    manipulationTitle: 'उन्नत हेरफेर संकेतक',
    crossModalTitle: 'क्रॉस-मॉडल सहसंबंध इंजन',
    voiceCmdBtn: 'वॉइस कमांड',
    voiceCmdListening: 'कमांड सुन रहा है...',
    liveCamTitle: 'लाइव कैमरा फ़ेस और आर्टिफैक्ट स्कैनर',
    liveCamStart: 'कैमरा शुरू करें',
    liveCamStop: 'कैमरा बंद करें',
    liveCamCapture: 'फ़्रेम कैप्चर और विश्लेषण करें',
    alertsTitle: 'जांच अलर्ट और सूचनाएं',
  },
  ta: {
    ...EN_DICT,
    brandTagline: 'TRUTHLENS — சான்றுகள் மட்டுமே, தீர்ப்புகள் அல்ல.',
    landingHeadline: 'சான்றுக்கு அப்பால் பாருங்கள்.',
    landingSubheading:
      'டிஜிட்டல் ஆதாரங்களை பகுப்பாய்வு செய்து, சந்தேகத்திற்குரிய குறிகாட்டிகளைக் கண்டறிந்து, உண்மையைப் புரிந்துகொள்ள ஆய்வாளர்களுக்கு உதவும் அறிவார்ந்த பன்முகத் தடயவியல் தளம்.',
    onboardingEyebrow: 'பன்மொழி அணுகல் மற்றும் தடயவியல் அமைப்பு',
    onboardingTitle: 'உங்கள் மொழி மற்றும் அணுகல் விருப்பத்தைத் தேர்ந்தெடுக்கவும்',
    onboardingSubtitle:
      'TruthLens வழிசெலுத்தல், அறிவிப்புகள் மற்றும் குரல் விளக்கத்தை மொழிபெயர்க்கிறது; ஆனால் அசல் SHA-256 ஹாஷ்கள், EXIF குறிச்சொற்கள் மற்றும் கோப்பு பெயர்களை மாற்றாமல் பாதுகாக்கிறது.',
    onboardingContinue: 'TruthLens பணிமனையில் நுழையவும்',
    onboardingNote: 'விருப்பங்கள் உள்ளூர் சேமிப்பகம் மற்றும் சுயவிவரத்தில் சேமிக்கப்படும்.',
    onboardingTextSize: 'எழுத்து அளவு',
    onboardingNarration: 'ஒலி விளக்கம்',
    onboardingHighContrast: 'உயர் மாறுபாடு',
    onboardingListenSample: 'மாதிரி கேட்கவும்',
    navLab: 'ஆதார ஆய்வகம்',
    navLiveCam: 'நேரடி முக ஸ்கேனர்',
    navGraph: 'முரண்பாடு வரைபடம்',
    navAgent: 'குரல் முகவர்',
    navAlerts: 'எச்சரிக்கைகள்',
    navCommunity: 'சமூக அளவீடு',
    navLedger: 'பாதுகாப்புப் பதிவேடு',
    btnNewCase: 'புதிய வழக்கு',
    btnSettings: 'அமைப்புகள்',
    btnSignOut: 'வெளியேறு',
    btnExportPdf: 'PDF அறிக்கை',
    btnRunAnalysis: 'பன்முகப் பகுப்பாய்வு செய்',
    btnScanning: 'ஸ்கேன் செய்யப்படுகிறது...',
    btnDemoGuide: 'டெமோ வழிகாட்டி',
    btnQrShare: 'QR பகிர்வு',
    btnSecurity: 'பாதுகாப்பு & வரம்புகள்',
    btnListen: 'கேட்கவும்',
    btnStopListen: 'நிறுத்து',
    investigatorLabel: 'ஆய்வாளர்',
    goldenRuleShort: 'குறிகாட்டிகள் மட்டுமே, இறுதி தீர்ப்பல்ல',
    calibratedRiskTitle: 'அளவீடு செய்யப்பட்ட ஆபத்து மதிப்பீடு',
    caseSummaryTitle: 'வழக்கு சுருக்கம்',
    limitationsTitle: 'முறைமை வரம்புகள்',
    alternativesTitle: 'மாற்று இயல்பான விளக்கங்கள்',
    ingestTitle: 'வழக்கு ஆதாரங்களைச் சேர்',
    ingestDropLabel: 'படம், வீடியோ, ஆடியோ அல்லது ஆவணங்களைப் பதிவேற்றவும்',
    ingestStagedTitle: 'பதிவேற்றத்திற்கு தயார் வரிசை',
    ingestUploadAll: 'அனைத்தையும் பதிவேற்றி சரிபார்',
    loadedArtifacts: 'ஏற்றப்பட்ட கோப்புகள்',
    removeEvidence: 'நீக்கு',
    deleteCase: 'வழக்கை நீக்கு',
    searchCasesPlaceholder: 'வழக்கு தலைப்பு அல்லது ID தேடு...',
    captionTitle: 'கூறப்பட்ட தலைப்பு / உரைச் சூழல்',
    captionSave: 'உரையைச் சேமி',
    imageSectionTitle: 'பட சிக்னல் பகுப்பாய்வு (ELA · 2D FFT · EXIF · dHash)',
    videoSectionTitle: 'வீடியோ கீஃபிரேம் & A/V ஒத்திசைவு சோதனை',
    audioSectionTitle: 'ஆடியோ அலைவடிவம், ஸ்பெக்ட்ரோகிராம் & செயற்கை குரல் குறிகாட்டிகள்',
    documentSectionTitle: 'ஆவண ஒருமைப்பாடு & மெட்டாடேட்டா சோதனை (PDF · TXT)',
    findingsTitle: 'விளக்கக்கூடிய தடயவியல் குறிகாட்டிகள்',
    findingsEmpty: 'இதுவரை குறிகாட்டிகள் இல்லை. ஆதாரத்தைப் பதிவேற்றி பகுப்பாய்வு செய்யவும்.',
    recommendedChecksTitle: 'மனித ஆய்வாளருக்கான பரிந்துரைகள்',
    settingsTitle: 'பணிமனை விருப்பங்கள், மொழி & அணுகல்',
    closeLabel: 'மூடு',
    newCaseTitle: 'புதிய தடயவியல் வழக்கு உருவாக்கு',
    cancelLabel: 'ரத்து செய்',
    createCaseSubmit: 'வழக்கு உருவாக்கு',
    landingSandboxBtn: 'தொடங்கவும் — டெமோ சாண்ட்பாக்ஸ்',
    landingSignInTab: 'ஆய்வாளர் உள்நுழைவு',
    landingSignUpTab: 'கணக்கு உருவாக்கு',
    landingAboutTitle: 'TruthLens பற்றி',
    landingHowItWorksTitle: 'இது எப்படி செயல்படுகிறது',
    landingTechSecurityTitle: 'தொழில்நுட்பம் & பாதுகாப்பு',
    landingLivePreviewTitle: 'நேரடி ஆய்வு முன்னோட்டம்',
    audioBarTitle: 'ஒலி அணுகல்',
    audioListenSite: 'அறிமுகம் கேட்கவும்',
    audioReadPage: 'பக்கத்தைப் படி',
    audioReadSelection: 'தேர்வைப் படி',
    audioPause: 'இடைநிறுத்து',
    audioResume: 'தொடர்',
    audioStop: 'நிறுத்து',
    audioNarrationOn: 'ஒலி இயக்கம்',
    audioNarrationOff: 'ஒலி நிறுத்தம்',
    agentTitle: 'பன்மொழி குரல் தடயவியல் முகவர்',
    agentDevilsAdvocate: 'எதிர்வாத முறை',
    agentNarrateSummary: 'வழக்கு சுருக்கத்தைக் கேள்',
    agentSend: 'கேள்',
    communityTitle: 'நேரடி சமூக அளவீட்டு சுழற்சி',
    ledgerTitle: 'மாற்ற முடியாத பாதுகாப்புச் சங்கிலி',
    ledgerVerifyBtn: 'பதிவேட்டைச் சரிபார்',
    manipulationTitle: 'மேம்பட்ட மாற்றக் குறிகாட்டிகள்',
    crossModalTitle: 'குறுக்கு-முறை தொடர்பு இயந்திரம்',
    voiceCmdBtn: 'குரல் கட்டளை',
    voiceCmdListening: 'கட்டளையைக் கேட்கிறது...',
    liveCamTitle: 'நேரடி கேமரா முக ஸ்கேனர்',
    liveCamStart: 'கேமரா தொடங்கு',
    liveCamStop: 'கேமரா நிறுத்து',
    liveCamCapture: 'படம் பிடித்து பகுப்பாய்வு செய்',
    alertsTitle: 'விசாரணை எச்சரிக்கைகள் & அறிவிப்புகள்',
  },
  te: {
    ...EN_DICT,
    brandTagline: 'TRUTHLENS — సాక్ష్యాలు మాత్రమే, తుది తీర్పులు కావు.',
    landingHeadline: 'సాక్ష్యానికి మించి చూడండి.',
    landingSubheading:
      'డిజిటల్ సాక్ష్యాలను విశ్లేషించి, అనుమానాస్పద సంకేతాలను గుర్తించి, నిజాన్ని అర్థం చేసుకోవడానికి పరిశోధకులకు సహాయపడే మల్టీమోడల్ ఫోరెన్సిక్ ప్లాట్‌ఫారమ్.',
    onboardingEyebrow: 'బహుభాషా ప్రాప్యత & ఫోరెన్సిక్ సెటప్',
    onboardingTitle: 'మీ భాష & ప్రాప్యత సెట్టింగ్‌ను ఎంచుకోండి',
    onboardingSubtitle:
      'TruthLens మెనూలు, హెచ్చరికలు మరియు వాయిస్ వివరణను అనువదిస్తుంది; కానీ అసలు SHA-256 హాష్‌లు, EXIF ట్యాగ్‌లు మరియు ఫైల్ పేర్లను మార్చదు.',
    onboardingContinue: 'TruthLens లోకి ప్రవేశించండి',
    onboardingNote: 'మీ ప్రాధాన్యతలు లోకల్‌గా మరియు ప్రొఫైల్‌లో సేవ్ చేయబడతాయి.',
    onboardingTextSize: 'అక్షర పరిమాణం',
    onboardingNarration: 'ఆడియో వివరణ',
    onboardingHighContrast: 'అధిక కాంట్రాస్ట్',
    onboardingListenSample: 'నమూనా వినండి',
    navLab: 'సాక్ష్య ప్రయోగశాల',
    navLiveCam: 'లైవ్ ఫేస్ స్కానర్',
    navGraph: 'విరుద్ధ గ్రాఫ్',
    navAgent: 'వాయిస్ ఏజెంట్',
    navAlerts: 'అలర్ట్‌లు & నోటిఫికేషన్లు',
    navCommunity: 'కమ్యూనిటీ లూప్',
    navLedger: 'కస్టడీ లెడ్జర్',
    btnNewCase: 'కొత్త కేసు',
    btnSettings: 'సెట్టింగ్‌లు',
    btnSignOut: 'సైన్ అవుట్',
    btnExportPdf: 'PDF నివేదిక',
    btnRunAnalysis: 'మల్టీమోడల్ విశ్లేషణ నడపండి',
    btnScanning: 'స్కాన్ చేస్తోంది...',
    btnDemoGuide: 'డెమో గైడ్',
    btnQrShare: 'QR షేర్',
    btnSecurity: 'భద్రత & పరిమితులు',
    btnListen: 'వినండి',
    btnStopListen: 'ఆపండి',
    investigatorLabel: 'పరిశోధకుడు',
    goldenRuleShort: 'సంకేతాలు మాత్రమే, తుది తీర్పు కాదు',
    calibratedRiskTitle: 'రిస్క్ అంచనా',
    caseSummaryTitle: 'కేసు సారాంశం',
    limitationsTitle: 'పద్ధతి పరిమితులు',
    alternativesTitle: 'ప్రత్యామ్నాయ సహజ కారణాలు',
    ingestTitle: 'సాక్ష్యాన్ని అప్‌లోడ్ చేయండి',
    ingestDropLabel: 'చిత్రం, వీడియో, ఆడియో లేదా డాక్యుమెంట్ ఫైళ్లను అప్‌లోడ్ చేయండి',
    ingestStagedTitle: 'అప్‌లోడ్ క్యూ',
    ingestUploadAll: 'అన్నీ అప్‌లోడ్ & వెరిఫై చేయండి',
    loadedArtifacts: 'లోడ్ చేసిన ఫైళ్లు',
    removeEvidence: 'తొలగించు',
    deleteCase: 'కేసు తొలగించు',
    searchCasesPlaceholder: 'కేసు పేరు లేదా ID తో శోధించండి...',
    captionTitle: 'క్లెయిమ్ చేసిన శీర్షిక / టెక్స్ట్',
    captionSave: 'టెక్స్ట్ సేవ్ చేయండి',
    imageSectionTitle: 'చిత్ర సిగ్నల్ విశ్లేషణ (ELA · 2D FFT · EXIF · dHash)',
    videoSectionTitle: 'వీడియో ఫ్రేమ్ & A/V సింక్ తనిఖీ',
    audioSectionTitle: 'ఆడియో వేవ్‌ఫార్మ్, స్పెక్ట్రోగ్రామ్ & సింథటిక్ స్పీచ్ సంకేతాలు',
    documentSectionTitle: 'డాక్యుమెంట్ సమగ్రత & మెటాడేటా తనిఖీ (PDF · TXT)',
    findingsTitle: 'వివరణాత్మక ఫోరెన్సిక్ సంకేతాలు',
    findingsEmpty: 'ఇంకా సంకేతాలు లేవు. సాక్ష్యాన్ని అప్‌లోడ్ చేసి విశ్లేషణ నడపండి.',
    recommendedChecksTitle: 'మానవ పరిశోధకులకు సిఫార్సులు',
    settingsTitle: 'ప్రాధాన్యతలు, భాష & ప్రాప్యత',
    closeLabel: 'మూసివేయండి',
    newCaseTitle: 'కొత్త ఫోరెన్సిక్ కేసు సృష్టించండి',
    cancelLabel: 'రద్దు చేయండి',
    createCaseSubmit: 'కేసు సృష్టించండి',
    landingSandboxBtn: 'ప్రారంభించండి — డెమో శాండ్‌బాక్స్',
    landingSignInTab: 'పరిశోధకుడు లాగిన్',
    landingSignUpTab: 'ఖాతా సృష్టించండి',
    landingAboutTitle: 'TruthLens గురించి',
    landingHowItWorksTitle: 'ఇది ఎలా పనిచేస్తుంది',
    landingTechSecurityTitle: 'సాంకేతికత & భద్రత',
    landingLivePreviewTitle: 'లైవ్ పరిశోధన ప్రివ్యూ',
    audioBarTitle: 'ఆడియో ప్రాప్యత',
    audioListenSite: 'పరిచయం వినండి',
    audioReadPage: 'పేజీ చదవండి',
    audioReadSelection: 'ఎంచుకున్నది చదవండి',
    audioPause: 'ఆపు',
    audioResume: 'కొనసాగించు',
    audioStop: 'ఆపండి',
    audioNarrationOn: 'ఆడియో ఆన్',
    audioNarrationOff: 'ఆడియో ఆఫ్',
    agentTitle: 'బహుభాషా వాయిస్ ఫోరెన్సిక్ ఏజెంట్',
    agentDevilsAdvocate: 'ప్రతివాద మోడ్',
    agentNarrateSummary: 'సారాంశం వినిపించండి',
    agentSend: 'అడగండి',
    communityTitle: 'రియల్-టైమ్ కమ్యూనిటీ కాలిబ్రేషన్ లూప్',
    ledgerTitle: 'మార్చలేని కస్టడీ చైన్',
    ledgerVerifyBtn: 'లెడ్జర్‌ను ధృవీకరించండి',
    manipulationTitle: 'అధునాతన మార్పు సంకేతాలు',
    crossModalTitle: 'క్రాస్-మోడల్ కోరిలేషన్ ఇంజిన్',
    voiceCmdBtn: 'వాయిస్ కమాండ్',
    voiceCmdListening: 'కమాండ్ వింటోంది...',
    liveCamTitle: 'లైవ్ కెమెరా ఫేస్ స్కానర్',
    liveCamStart: 'కెమెరా ప్రారంభించు',
    liveCamStop: 'కెమెరా ఆపు',
    liveCamCapture: 'ఫ్రేమ్ క్యాప్చర్ చేసి విశ్లేషించు',
    alertsTitle: 'పరిశోధన అలర్ట్‌లు & నోటిఫికేషన్లు',
  },
  ml: {
    ...EN_DICT,
    brandTagline: 'TRUTHLENS — തെളിവുകൾ മാത്രം, വിധികളല്ല.',
    landingHeadline: 'തെളിവുകൾക്കപ്പുറം കാണുക.',
    landingSubheading:
      'ഡിജിറ്റൽ തെളിവുകൾ വിശകലനം ചെയ്യുകയും സംശയാസ്പദമായ സൂചകങ്ങൾ കണ്ടെത്തുകയും അന്വേഷകർക്ക് സത്യം മനസ്സിലാക്കാൻ സഹായിക്കുകയും ചെയ്യുന്ന മൾട്ടിമോഡൽ ഫോറൻസിക് പ്ലാറ്റ്ഫോം.',
    onboardingEyebrow: 'ബഹുഭാഷാ ആക്സസിബിലിറ്റിയും ഫോറൻസിക് സജ്ജീകരണവും',
    onboardingTitle: 'നിങ്ങളുടെ ഭാഷയും ആക്സസിബിലിറ്റി ക്രമീകരണവും തിരഞ്ഞെടുക്കുക',
    onboardingSubtitle:
      'TruthLens മെനുകൾ, മുന്നറിയിപ്പുകൾ, ശബ്ദ വിവരണം എന്നിവ വിവർത്തനം ചെയ്യുന്നു; എന്നാൽ യഥാർത്ഥ SHA-256 ഹാഷുകൾ, EXIF ടാഗുകൾ, ഫയൽ നാമങ്ങൾ എന്നിവ മാറ്റമില്ലാതെ സൂക്ഷിക്കുന്നു.',
    onboardingContinue: 'TruthLens വർക്ക്ബെഞ്ചിലേക്ക് പ്രവേശിക്കുക',
    onboardingNote: 'മുൻഗണനകൾ ലോക്കലായും പ്രൊഫൈലിലും സംരക്ഷിക്കപ്പെടുന്നു.',
    onboardingTextSize: 'അക്ഷര വലുപ്പം',
    onboardingNarration: 'ശബ്ദ വിവരണം',
    onboardingHighContrast: 'ഉയർന്ന കോൺട്രാസ്റ്റ്',
    onboardingListenSample: 'സാമ്പിൾ കേൾക്കുക',
    navLab: 'തെളിവ് ലാബ്',
    navLiveCam: 'ലൈവ് ഫേസ് സ്കാനർ',
    navGraph: 'വൈരുദ്ധ്യ ഗ്രാഫ്',
    navAgent: 'വോയ്സ് ഏജന്റ്',
    navAlerts: 'അലർട്ടുകളും അറിയിപ്പുകളും',
    navCommunity: 'കമ്മ്യൂണിറ്റി ലൂപ്പ്',
    navLedger: 'കസ്റ്റഡി ലെഡ്ജർ',
    btnNewCase: 'പുതിയ കേസ്',
    btnSettings: 'ക്രമീകരണങ്ങൾ',
    btnSignOut: 'സൈൻ ഔട്ട്',
    btnExportPdf: 'PDF റിപ്പോർട്ട്',
    btnRunAnalysis: 'മൾട്ടിമോഡൽ വിശകലനം നടത്തുക',
    btnScanning: 'സ്കാൻ ചെയ്യുന്നു...',
    btnDemoGuide: 'ഡെമോ ഗൈഡ്',
    btnQrShare: 'QR ഷെയർ',
    btnSecurity: 'സുരക്ഷയും പരിമിതികളും',
    btnListen: 'കേൾക്കുക',
    btnStopListen: 'നിർത്തുക',
    investigatorLabel: 'അന്വേഷകൻ',
    goldenRuleShort: 'സൂചകങ്ങൾ മാത്രം, അന്തിമ വിധിയല്ല',
    calibratedRiskTitle: 'അപകടസാധ്യത വിലയിരുത്തൽ',
    caseSummaryTitle: 'കേസ് സംഗ്രഹം',
    limitationsTitle: 'രീതിശാസ്ത്ര പരിമിതികൾ',
    alternativesTitle: 'ബദൽ സ്വാഭാവിക വിശദീകരണങ്ങൾ',
    ingestTitle: 'കേസ് തെളിവുകൾ അപ്‌ലോഡ് ചെയ്യുക',
    ingestDropLabel: 'ചിത്രം, വീഡിയോ, ഓഡിയോ അല്ലെങ്കിൽ ഡോക്യുമെന്റ് അപ്‌ലോഡ് ചെയ്യുക',
    ingestStagedTitle: 'അപ്‌ലോഡ് ക്യൂ',
    ingestUploadAll: 'എല്ലാം അപ്‌ലോഡ് ചെയ്ത് പരിശോധിക്കുക',
    loadedArtifacts: 'ലോഡ് ചെയ്ത ഫയലുകൾ',
    removeEvidence: 'നീക്കം ചെയ്യുക',
    deleteCase: 'കേസ് ഇല്ലാതാക്കുക',
    searchCasesPlaceholder: 'കേസ് പേര് അല്ലെങ്കിൽ ID ഉപയോഗിച്ച് തിരയുക...',
    captionTitle: 'അവകാശപ്പെട്ട തലക്കെട്ട് / വാചകം',
    captionSave: 'വാചകം സംരക്ഷിക്കുക',
    imageSectionTitle: 'ചിത്ര സിഗ്നൽ വിശകലനം (ELA · 2D FFT · EXIF · dHash)',
    videoSectionTitle: 'വീഡിയോ ഫ്രെയിം & A/V സിങ്ക് പരിശോധന',
    audioSectionTitle: 'ഓഡിയോ വേവ്ഫോം, സ്പെക്ട്രോഗ്രാം & സിന്തറ്റിക് വോയ്സ് സൂചകങ്ങൾ',
    documentSectionTitle: 'ഡോക്യുമെന്റ് സമഗ്രതയും മെറ്റാഡാറ്റയും (PDF · TXT)',
    findingsTitle: 'വിശദീകരിക്കാവുന്ന ഫോറൻസിക് സൂചകങ്ങൾ',
    findingsEmpty: 'സൂചകങ്ങളൊന്നുമില്ല. തെളിവ് അപ്‌ലോഡ് ചെയ്ത് വിശകലനം ആരംഭിക്കുക.',
    recommendedChecksTitle: 'മനുഷ്യ അന്വേഷകർക്കുള്ള ശുപാർശകൾ',
    settingsTitle: 'മുൻഗണനകൾ, ഭാഷ & ആക്സസിബിലിറ്റി',
    closeLabel: 'അടയ്ക്കുക',
    newCaseTitle: 'പുതിയ ഫോറൻസിക് കേസ് സൃഷ്ടിക്കുക',
    cancelLabel: 'റദ്ദാക്കുക',
    createCaseSubmit: 'കേസ് സൃഷ്ടിക്കുക',
    landingSandboxBtn: 'ആരംഭിക്കുക — ഡെമോ സാൻഡ്ബോക്സ്',
    landingSignInTab: 'അന്വേഷക ലോഗിൻ',
    landingSignUpTab: 'അക്കൗണ്ട് സൃഷ്ടിക്കുക',
    landingAboutTitle: 'TruthLens നെക്കുറിച്ച്',
    landingHowItWorksTitle: 'ഇത് എങ്ങനെ പ്രവർത്തിക്കുന്നു',
    landingTechSecurityTitle: 'സാങ്കേതികവിദ്യയും സുരക്ഷയും',
    landingLivePreviewTitle: 'ലൈവ് അന്വേഷണ പ്രിവ്യൂ',
    audioBarTitle: 'ശബ്ദ ആക്സസിബിലിറ്റി',
    audioListenSite: 'ആമുഖം കേൾക്കുക',
    audioReadPage: 'പേജ് വായിക്കുക',
    audioReadSelection: 'തിരഞ്ഞെടുത്തത് വായിക്കുക',
    audioPause: 'താൽക്കാലികമായി നിർത്തുക',
    audioResume: 'തുടരുക',
    audioStop: 'നിർത്തുക',
    audioNarrationOn: 'ശബ്ദം ഓൺ',
    audioNarrationOff: 'ശബ്ദം ഓഫ്',
    agentTitle: 'ബഹുഭാഷാ വോയ്സ് ഫോറൻസിക് ഏജന്റ്',
    agentDevilsAdvocate: 'പ്രതിവാദ മോഡ്',
    agentNarrateSummary: 'സംഗ്രഹം കേൾക്കുക',
    agentSend: 'ചോദിക്കുക',
    communityTitle: 'തത്സമയ കമ്മ്യൂണിറ്റി കാലിബ്രേഷൻ ലൂപ്പ്',
    ledgerTitle: 'തിരുത്താനാവാത്ത കസ്റ്റഡി ശൃംഖല',
    ledgerVerifyBtn: 'ലെഡ്ജർ പരിശോധിക്കുക',
    manipulationTitle: 'വിപുലമായ കൃത്രിമ സൂചകങ്ങൾ',
    crossModalTitle: 'ക്രോസ്-മോഡൽ കോറിലേഷൻ എഞ്ചിൻ',
    voiceCmdBtn: 'വോയ്സ് കമാൻഡ്',
    voiceCmdListening: 'കമാൻഡ് ശ്രദ്ധിക്കുന്നു...',
    liveCamTitle: 'ലൈവ് ക്യാമറ ഫേസ് സ്കാനർ',
    liveCamStart: 'ക്യാമറ ആരംഭിക്കുക',
    liveCamStop: 'ക്യാമറ നിർത്തുക',
    liveCamCapture: 'ഫ്രെയിം പകർത്തി വിശകലനം ചെയ്യുക',
    alertsTitle: 'അന്വേഷണ അലർട്ടുകളും അറിയിപ്പുകളും',
  },
};

interface LanguageContextValue {
  language: UiLanguage;
  hasConfirmedLanguage: boolean;
  setLanguage: (lang: UiLanguage) => void;
  confirmLanguage: (lang: UiLanguage) => void;
  textSize: TextSizePreference;
  setTextSize: (sz: TextSizePreference) => void;
  narrationEnabled: boolean;
  setNarrationEnabled: (enabled: boolean) => void;
  highContrast: boolean;
  setHighContrast: (enabled: boolean) => void;
  hydratePreferencesFromServer: () => Promise<void>;
  t: TranslationDict;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_LANG_KEY);
      if (isSupportedLanguage(saved)) return saved;
    } catch {
      // ignore
    }
    return 'en';
  });

  const [hasConfirmedLanguage, setHasConfirmedLanguage] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_LANG_KEY);
      return isSupportedLanguage(saved);
    } catch {
      return true;
    }
  });

  const [textSize, setTextSizeState] = useState<TextSizePreference>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_TEXT_SIZE_KEY);
      if (saved === 'sm' || saved === 'md' || saved === 'lg') return saved;
    } catch {
      // ignore
    }
    return 'md';
  });

  const [narrationEnabled, setNarrationState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_NARRATION_KEY);
      if (saved === 'false') return false;
    } catch {
      // ignore
    }
    return true;
  });

  const [highContrast, setHighContrastState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_CONTRAST_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('tl-text-sm', 'tl-text-md', 'tl-text-lg');
    root.classList.add(`tl-text-${textSize}`);
    root.classList.toggle('tl-high-contrast', highContrast);
  }, [textSize, highContrast]);

  const persistServerPrefs = useCallback(
    (next: {
      language: UiLanguage;
      textSize: TextSizePreference;
      narrationEnabled: boolean;
      highContrast: boolean;
    }) => {
      apiRequest<UserPreferences>('/api/user/preferences', {
        method: 'PUT',
        body: JSON.stringify(next),
      }).catch(() => {
        // Silently ignore when unauthenticated (landing / onboarding)
      });
    },
    [],
  );

  const setLanguage = useCallback(
    (lang: UiLanguage) => {
      const safeLang: UiLanguage = isSupportedLanguage(lang) ? lang : 'en';
      setLanguageState(safeLang);
      try {
        localStorage.setItem(STORAGE_LANG_KEY, safeLang);
      } catch {
        // ignore
      }
      persistServerPrefs({
        language: safeLang,
        textSize,
        narrationEnabled,
        highContrast,
      });
    },
    [textSize, narrationEnabled, highContrast, persistServerPrefs],
  );

  const confirmLanguage = useCallback(
    (lang: UiLanguage) => {
      const safeLang: UiLanguage = isSupportedLanguage(lang) ? lang : 'en';
      setLanguageState(safeLang);
      setHasConfirmedLanguage(true);
      try {
        localStorage.setItem(STORAGE_LANG_KEY, safeLang);
        localStorage.setItem(STORAGE_TEXT_SIZE_KEY, textSize);
        localStorage.setItem(STORAGE_NARRATION_KEY, String(narrationEnabled));
        localStorage.setItem(STORAGE_CONTRAST_KEY, String(highContrast));
      } catch {
        // ignore
      }
      persistServerPrefs({
        language: safeLang,
        textSize,
        narrationEnabled,
        highContrast,
      });
    },
    [textSize, narrationEnabled, highContrast, persistServerPrefs],
  );

  const setTextSize = useCallback(
    (sz: TextSizePreference) => {
      setTextSizeState(sz);
      try {
        localStorage.setItem(STORAGE_TEXT_SIZE_KEY, sz);
      } catch {
        // ignore
      }
      persistServerPrefs({ language, textSize: sz, narrationEnabled, highContrast });
    },
    [language, narrationEnabled, highContrast, persistServerPrefs],
  );

  const setNarrationEnabled = useCallback(
    (enabled: boolean) => {
      setNarrationState(enabled);
      try {
        localStorage.setItem(STORAGE_NARRATION_KEY, String(enabled));
      } catch {
        // ignore
      }
      persistServerPrefs({ language, textSize, narrationEnabled: enabled, highContrast });
    },
    [language, textSize, highContrast, persistServerPrefs],
  );

  const setHighContrast = useCallback(
    (enabled: boolean) => {
      setHighContrastState(enabled);
      try {
        localStorage.setItem(STORAGE_CONTRAST_KEY, String(enabled));
      } catch {
        // ignore
      }
      persistServerPrefs({ language, textSize, narrationEnabled, highContrast: enabled });
    },
    [language, textSize, narrationEnabled, persistServerPrefs],
  );

  const hydratePreferencesFromServer = useCallback(async () => {
    try {
      const remote = await apiRequest<UserPreferences>('/api/user/preferences');
      if (isSupportedLanguage(remote.language)) {
        setLanguageState(remote.language);
        try {
          localStorage.setItem(STORAGE_LANG_KEY, remote.language);
        } catch {
          // ignore
        }
      }
      if (remote.textSize === 'sm' || remote.textSize === 'md' || remote.textSize === 'lg') {
        setTextSizeState(remote.textSize);
      }
      if (typeof remote.narrationEnabled === 'boolean') {
        setNarrationState(remote.narrationEnabled);
      }
      if (typeof remote.highContrast === 'boolean') {
        setHighContrastState(remote.highContrast);
      }
    } catch {
      // ignore if endpoint unavailable
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      hasConfirmedLanguage,
      setLanguage,
      confirmLanguage,
      textSize,
      setTextSize,
      narrationEnabled,
      setNarrationEnabled,
      highContrast,
      setHighContrast,
      hydratePreferencesFromServer,
      t: TRANSLATIONS[language] ?? TRANSLATIONS.en,
    }),
    [
      language,
      hasConfirmedLanguage,
      setLanguage,
      confirmLanguage,
      textSize,
      setTextSize,
      narrationEnabled,
      setNarrationEnabled,
      highContrast,
      setHighContrast,
      hydratePreferencesFromServer,
    ],
  );

  return React.createElement(LanguageContext.Provider, { value }, children);
}

export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useI18n must be used within LanguageProvider');
  }
  return ctx;
}
