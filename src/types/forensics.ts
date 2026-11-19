export type SupportedLanguage = 'en' | 'kn' | 'hi' | 'ta' | 'te' | 'ml';
export type TextSizePreference = 'sm' | 'md' | 'lg';

export type UserRole =
  | 'super_admin'
  | 'investigation_admin'
  | 'senior_investigator'
  | 'investigator'
  | 'evidence_officer'
  | 'witness'
  | 'viewer';

export type CaseStatus =
  | 'draft'
  | 'registered'
  | 'under_review'
  | 'assigned'
  | 'investigation_in_progress'
  | 'evidence_collection'
  | 'forensic_analysis'
  | 'awaiting_verification'
  | 'escalated'
  | 'resolved'
  | 'closed'
  | 'archived';

export type CasePriority = 'low' | 'medium' | 'high' | 'critical';

export interface UserPreferences {
  language: SupportedLanguage;
  textSize: TextSizePreference;
  narrationEnabled: boolean;
  highContrast: boolean;
  updatedAt?: number;
}

export interface PublicConfig {
  maxUploadMb: number;
  geminiConfigured: boolean;
  geminiModel: string;
  emailConfigured: boolean;
  emailProviderType?: 'resend' | 'smtp' | 'none';
  smsConfigured: boolean;
  qrBaseUrlConfigured?: boolean;
  supportedLanguages: SupportedLanguage[];
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole | string;
  phone?: string;
  department?: string;
  badgeId?: string;
  emailVerified?: boolean;
  isDemoUser: boolean;
}

export interface ActiveSessionItem {
  id: string;
  userAgent: string;
  ipHash: string;
  lastActiveAt: number;
  expiresAt: number;
  createdAt: number;
  isCurrent: boolean;
}

export interface CategoryFieldDef {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | string;
  placeholder?: string;
  options?: string[];
}

export interface CaseCategoryDef {
  id?: string;
  slug: string;
  name: string;
  description: string;
  fields: CategoryFieldDef[];
  evidenceRequirements: string[];
  reportTemplateNote: string;
  isDefault?: boolean;
  enabled?: boolean;
}

export interface CaseSummary {
  id: string;
  caseNumber?: string;
  title: string;
  description: string;
  category?: string;
  status?: CaseStatus;
  priority?: CasePriority;
  incidentLocation?: string;
  incidentDate?: string;
  registrationDate?: number;
  assignedInvestigatorId?: string | null;
  assignedInvestigatorName?: string | null;
  isDemoSeed: boolean;
  riskLevel: 'Low' | 'Medium' | 'High';
  confidenceMin: number;
  confidenceMax: number;
  createdAt: number;
  updatedAt: number;
}

export interface VideoFrameSample {
  timestampSec: number;
  deltaScore: number;
  suspicious: boolean;
  thumbnailDataUrl: string;
}

export interface VideoMetadataInfo {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasAudioTrack: boolean | null;
  audioSyncNote: string | null;
  browserDecodeNote?: string | null;
}

export interface SuspiciousImageRegion {
  sector: string;
  meanError: number;
  ratioToMedian: number;
  severity: 'Low' | 'Medium' | 'High';
  note: string;
}

export interface CrossModalCorrelationItem {
  id: string;
  pairKey:
    | 'image_vs_video'
    | 'video_vs_audio'
    | 'audio_vs_transcript'
    | 'caption_vs_visual'
    | 'date_vs_metadata'
    | 'location_vs_context';
  pairLabel: string;
  status: 'supporting' | 'contradictory' | 'inconclusive' | 'insufficient_evidence';
  supportingSignals: string[];
  contradictorySignals: string[];
  relatedEvidence: Array<{ id: string; filename: string; modality: string }>;
  confidenceRange: string;
  uncertaintyNote: string;
  alternativeExplanations: string[];
}

export interface ManipulationIndicatorItem {
  id: string;
  category: 'image_region' | 'video_frame' | 'audio_discontinuity' | 'metadata' | 'text_context';
  severity: 'Low' | 'Medium' | 'High';
  whatDetected: string;
  whereDetected: string;
  timestampOrRegion: string;
  whyFlagged: string;
  supportingEvidence: string;
  innocentExplanation: string;
}

export interface AuditLogItem {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipHash: string;
  details: string;
  createdAt: number;
}

export interface EvidenceExifSummary {
  make: string | null;
  model: string | null;
  software: string | null;
  dateTimeOriginal: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  hasExif: boolean;
  rawTags: Record<string, string | number>;
}

export interface EvidenceVersionItem {
  id: string;
  versionNumber: number;
  sha256: string;
  byteSize: number;
  note: string;
  updatedBy: string;
  createdAt: number;
}

export interface EvidenceAccessLogItem {
  id: string;
  evidenceId: string;
  caseId: string;
  userId: string;
  userName: string;
  action: string;
  ipHash: string;
  createdAt: number;
}

export interface EvidenceItem {
  id: string;
  modality: 'image' | 'video' | 'audio' | 'text' | 'document';
  sourceType?: 'upload' | 'live_camera' | 'caption' | 'url_ingest';
  originalFilename: string;
  hasFile: boolean;
  hasEla: boolean;
  hasFft: boolean;
  mimeType: string;
  byteSize: number;
  sha256: string;
  perceptualHash: string | null;
  exif: EvidenceExifSummary | null;
  metrics: Record<string, unknown> | null;
  frames: VideoFrameSample[] | null;
  transcript: string | null;
  versions?: EvidenceVersionItem[];
  createdAt: number;
}

export interface ForensicFinding {
  id: string;
  caseId: string;
  evidenceId: string | null;
  modality: 'image' | 'video' | 'audio' | 'text' | 'document';
  indicator: string;
  whyFlagged: string;
  locationOrTimestamp: string;
  confidenceRange: string;
  limitation: string;
  severity: 'Low' | 'Medium' | 'High';
  createdAt: number;
}

export interface GraphNodeItem {
  id: string;
  caseId: string;
  nodeKey: string;
  label: string;
  nodeType: 'evidence' | 'claim' | 'metadata' | 'finding' | 'person' | 'case';
  modality: string;
  details: string;
}

export interface GraphEdgeItem {
  id: string;
  caseId: string;
  sourceKey: string;
  targetKey: string;
  relation: 'corroborates' | 'contradicts' | 'inconclusive';
  label: string;
  explanation: string;
  confidenceRange: string;
  limitation: string;
}

export interface CustodyLedgerEntry {
  id: string;
  caseId: string;
  entryIndex: number;
  evidenceId: string | null;
  action: string;
  fileSha256: string;
  collectedBy?: string;
  transferredBy?: string;
  receivedBy?: string;
  transferReason?: string;
  approvalSignature?: string;
  prevEntryHash: string;
  entryHash: string;
  createdAt: number;
}

export interface LedgerVerificationResult {
  valid: boolean;
  entriesChecked: number;
  filesVerified: number;
  mismatches: string[];
  verifiedAt: number;
  headHash: string;
}

export interface WitnessRecord {
  id: string;
  caseId: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  relationship: string;
  statement: string;
  consentGranted: boolean;
  privacyRedacted: boolean;
  verificationStatus: 'unverified' | 'pending' | 'verified';
  linkedEvidenceIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CaseCommentItem {
  id: string;
  caseId: string;
  userId: string;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: number;
}

export interface CaseActivityItem {
  id: string;
  caseId: string;
  userId?: string | null;
  actorName: string;
  action: string;
  summary: string;
  createdAt: number;
}

export interface AgentMessageItem {
  id: string;
  role: 'user' | 'assistant';
  language: SupportedLanguage;
  devilsAdvocate: boolean;
  content: string;
  citedFindingIds: string[];
  createdAt: number;
}

export interface HumanReviewRecord {
  status: 'pending' | 'verified_corroborated' | 'verified_inconclusive' | 'escalated';
  reviewerNote: string;
  checkedItems: string[];
  findingDecisions: Record<string, 'corroborated' | 'benign_artifact' | 'needs_followup'>;
  signedOffBy: string | null;
  signedOffAt: number | null;
}

export interface FullCaseData {
  case: {
    id: string;
    userId?: string;
    caseNumber?: string;
    title: string;
    description: string;
    captionText: string;
    category?: string;
    categoryName?: string;
    status?: CaseStatus;
    priority?: CasePriority;
    incidentLocation?: string;
    incidentDate?: string;
    registrationDate?: number;
    assignedInvestigatorId?: string | null;
    assignedInvestigator?: {
      id: string;
      displayName: string;
      email: string;
      role: string;
    } | null;
    relatedPersons?: Array<{ name: string; role: string }>;
    categoryFields?: Record<string, string>;
    notes?: string;
    closingSummary?: string;
    isDemoSeed: boolean;
    riskLevel: 'Low' | 'Medium' | 'High';
    confidenceMin: number;
    confidenceMax: number;
    summary: string;
    analysisMode?: 'hybrid_ai' | 'deterministic_heuristics';
    analysisStale?: boolean;
    humanReview?: HumanReviewRecord;
    limitations: string[];
    alternativeExplanations: string[];
    recommendedChecks: string[];
    createdAt: number;
    updatedAt: number;
  };
  categoryMeta?: CaseCategoryDef | null;
  evidence: EvidenceItem[];
  evidenceAccessLogs?: EvidenceAccessLogItem[];
  findings: ForensicFinding[];
  correlations?: CrossModalCorrelationItem[];
  manipulationIndicators?: ManipulationIndicatorItem[];
  graph: {
    nodes: GraphNodeItem[];
    edges: GraphEdgeItem[];
  };
  ledger: CustodyLedgerEntry[];
  witnesses?: WitnessRecord[];
  comments?: CaseCommentItem[];
  activity?: CaseActivityItem[];
  agentMessages: AgentMessageItem[];
  webVerifications?: WebVerificationRecord[];
  uploadedEvidenceId?: string;
  uploadedSha256?: string;
  ingestedUrlMetadata?: Record<string, unknown>;
}

export interface CommunityVoteItem {
  id: string;
  voterName: string;
  stance: 'plausible_artifact' | 'needs_corroboration' | 'likely_benign';
  rationale: string;
  createdAt: number;
}

export interface CommunitySummary {
  topicKey: string;
  totalVotes: number;
  counts: {
    plausible_artifact: number;
    needs_corroboration: number;
    likely_benign: number;
  };
  recentVotes: CommunityVoteItem[];
}

export interface ProviderHealthCheck {
  configured: boolean;
  ready: boolean;
  status: 'NOT_CONFIGURED' | 'READY' | 'FAILED';
  provider: 'resend' | 'smtp' | 'twilio' | 'none';
  checkedAt: number;
  detail: string;
  missingEnvVars: string[];
}

export interface GlobalNotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  caseRegistered: boolean;
  caseAssigned: boolean;
  caseUpdated: boolean;
  analysisCompleted: boolean;
  highRiskIndicator: boolean;
  evidenceSubmitted: boolean;
  evidenceIntegrityFailed: boolean;
  custodyEvent: boolean;
  witnessRegistered: boolean;
  caseClosed: boolean;
  securityAlert: boolean;
  updatedAt?: number;
}

export interface NotificationContactItem {
  id: string;
  channel: 'email' | 'sms';
  countryCode?: string;
  destinationMasked: string;
  verified: boolean;
  paused?: boolean;
  consentGranted: boolean;
  otpStatus?: 'verified' | 'pending' | 'expired' | 'locked' | 'failed' | 'not_configured';
  otpAttempts?: number;
  maxOtpAttempts?: number;
  verificationExpiresAt?: number | null;
  resendAvailableAt?: number;
  lastDeliveredAt?: number | null;
  lastError?: string | null;
  eventPrefs: {
    analysis_completed: boolean;
    high_risk_indicator: boolean;
    case_updated: boolean;
    ledger_verification_alert: boolean;
  };
  createdAt: number;
}

export interface NotificationLogItem {
  id: string;
  caseId: string | null;
  channel: string;
  provider?: string;
  recipientMasked: string;
  eventType: string;
  subjectOrPreview?: string | null;
  status: string;
  providerMessageId: string | null;
  errorDetail: string | null;
  attempts?: number;
  retryCount?: number;
  deliveredAt?: number | null;
  createdAt: number;
  updatedAt?: number | null;
}

export interface NotificationWebhookEventItem {
  id: string;
  provider: string;
  eventType: string;
  providerMessageId: string | null;
  status: string;
  payloadSummary: string;
  signatureValid: boolean;
  receivedAt: number;
}

export interface InAppNotificationItem {
  id: string;
  caseId: string | null;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
}

export interface SharePermissions {
  summary: boolean;
  findings: boolean;
  evidenceInventory: boolean;
  custodyDigest: boolean;
  timeline: boolean;
}

export interface CaseShareTokenItem {
  id: string;
  label: string;
  permissions?: SharePermissions;
  accessCount?: number;
  lastAccessedAt?: number | null;
  expiresAt: number;
  revoked: boolean;
  createdAt: number;
}

export interface SharedCasePayload {
  shareLabel: string;
  expiresAt: number;
  permissions?: SharePermissions;
  case: {
    id: string;
    caseNumber?: string;
    title: string;
    description: string;
    category?: string;
    categoryName?: string;
    status?: string;
    priority?: string;
    incidentLocation?: string;
    incidentDate?: string;
    captionText: string;
    riskLevel: 'Low' | 'Medium' | 'High';
    confidenceMin: number;
    confidenceMax: number;
    summary: string;
    analysisMode?: string;
    limitations: string[];
    alternativeExplanations: string[];
    recommendedChecks: string[];
    humanReview?: HumanReviewRecord;
    updatedAt: number;
  };
  evidenceDigest: Array<{
    id: string;
    modality: string;
    sourceType?: string;
    originalFilename: string;
    byteSize: number;
    sha256: string;
  }>;
  findings: ForensicFinding[];
  correlations: CrossModalCorrelationItem[];
  ledgerSummary: {
    entriesCount: number;
    headHash: string | null;
  };
  timeline?: Array<{
    id: string;
    action: string;
    summary: string;
    createdAt: number;
  }>;
}

export interface IntelligenceSummary {
  totalCases: number;
  activeCases: number;
  closedCases: number;
  pendingReviews: number;
  assignedToMe: number;
  assignedInvestigatorsCount: number;
  priorityCounts: { low: number; medium: number; high: number; critical: number };
  statusCounts: Record<string, number>;
  recentActivity: CaseActivityItem[];
}

export interface SecurityOverviewData {
  isAdmin: boolean;
  canManageRoles: boolean;
  mySessions: ActiveSessionItem[];
  myAuditLogs: AuditLogItem[];
  myAccessLogs: EvidenceAccessLogItem[];
  failedLoginAlerts: AuditLogItem[];
  adminPanel: {
    totalCases: number;
    totalUsers: number;
    users: Array<{
      id: string;
      email: string;
      displayName: string;
      role: string;
      department: string;
      badgeId: string;
      emailVerified: boolean;
      active: boolean;
      lastLoginAt: number | null;
      createdAt: number;
    }>;
    systemAuditLogs: AuditLogItem[];
    systemAccessLogs: EvidenceAccessLogItem[];
  } | null;
}

export interface WebVerificationCitation {
  title: string;
  uri: string;
}

export interface WebVerificationRecord {
  id: string;
  query: string;
  urlsEvaluated: string[];
  mode: 'gemini_search_grounding' | 'local_cross_check';
  verdictSummary: string;
  citations: WebVerificationCitation[];
  createdAt: number;
  notice?: string | null;
}

export interface ProvenanceRadarMatch {
  evidenceId: string;
  sourceFilename: string;
  matchedCaseId: string;
  matchedCaseNumber: string;
  matchedCaseTitle: string;
  matchedEvidenceId: string;
  matchedFilename: string;
  matchedPerceptualHash: string;
  hammingDistance: number;
  similarityPct: number;
  matchedCreatedAt: number;
  relationType: 'exact_perceptual_match' | 'near_duplicate_recompressed';
}

export interface ProvenanceRadarResponse {
  scannedImages: number;
  comparedCorpusSize: number;
  matches: ProvenanceRadarMatch[];
}

export interface SecurityAuditCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn';
  detail: string;
}

export interface SecurityAuditReport {
  auditedAt: number;
  overallStatus: 'HARDENED' | 'REVIEW_NEEDED';
  passedCount: number;
  totalChecks: number;
  isAdmin: boolean;
  checks: SecurityAuditCheck[];
}
