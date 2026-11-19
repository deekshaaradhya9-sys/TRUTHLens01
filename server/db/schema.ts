import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('investigator'),
  phone: text('phone').notNull().default(''),
  department: text('department').notNull().default(''),
  badgeId: text('badge_id').notNull().default(''),
  emailVerified: integer('email_verified').notNull().default(0),
  emailVerifyTokenHash: text('email_verify_token_hash'),
  emailVerifyExpiresAt: integer('email_verify_expires_at'),
  resetTokenHash: text('reset_token_hash'),
  resetExpiresAt: integer('reset_expires_at'),
  active: integer('active').notNull().default(1),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: integer('locked_until'),
  lastLoginAt: integer('last_login_at'),
  isDemoUser: integer('is_demo_user').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  language: text('language').notNull().default('en'),
  textSize: text('text_size').notNull().default('md'),
  narrationEnabled: integer('narration_enabled').notNull().default(1),
  highContrast: integer('high_contrast').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  csrfToken: text('csrf_token').notNull(),
  userAgent: text('user_agent').notNull().default(''),
  ipHash: text('ip_hash').notNull().default(''),
  lastActiveAt: integer('last_active_at').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const caseCategories = sqliteTable('case_categories', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  fieldSchemaJson: text('field_schema_json').notNull().default('[]'),
  evidenceRequirementsJson: text('evidence_requirements_json').notNull().default('[]'),
  reportTemplateNote: text('report_template_note').notNull().default(''),
  isDefault: integer('is_default').notNull().default(0),
  enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const cases = sqliteTable('cases', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  caseNumber: text('case_number').notNull().default(''),
  title: text('title').notNull(),
  description: text('description').notNull(),
  captionText: text('caption_text').notNull().default(''),
  category: text('category').notNull().default('digital_fraud'),
  status: text('status').notNull().default('registered'),
  priority: text('priority').notNull().default('medium'),
  incidentLocation: text('incident_location').notNull().default(''),
  incidentDate: text('incident_date').notNull().default(''),
  registrationDate: integer('registration_date').notNull().default(0),
  assignedInvestigatorId: text('assigned_investigator_id'),
  relatedPersonsJson: text('related_persons_json').notNull().default('[]'),
  categoryFieldsJson: text('category_fields_json').notNull().default('{}'),
  notes: text('notes').notNull().default(''),
  closingSummary: text('closing_summary').notNull().default(''),
  isDemoSeed: integer('is_demo_seed').notNull().default(0),
  riskLevel: text('risk_level').notNull().default('Medium'),
  confidenceMin: integer('confidence_min').notNull().default(40),
  confidenceMax: integer('confidence_max').notNull().default(70),
  summary: text('summary').notNull().default(''),
  limitationsJson: text('limitations_json').notNull().default('[]'),
  alternativesJson: text('alternatives_json').notNull().default('[]'),
  recommendedChecksJson: text('recommended_checks_json').notNull().default('[]'),
  analysisMode: text('analysis_mode').notNull().default('hybrid_ai'),
  correlationsJson: text('correlations_json').notNull().default('[]'),
  manipulationJson: text('manipulation_json').notNull().default('[]'),
  webVerificationsJson: text('web_verifications_json').notNull().default('[]'),
  analysisStale: integer('analysis_stale').notNull().default(0),
  humanReviewJson: text('human_review_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const caseCollaborators = sqliteTable('case_collaborators', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessRole: text('access_role').notNull().default('investigator'),
  addedBy: text('added_by').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const witnesses = sqliteTable('witnesses', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  fullName: text('full_name').notNull(),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  relationship: text('relationship').notNull().default('witness'),
  statement: text('statement').notNull().default(''),
  consentGranted: integer('consent_granted').notNull().default(1),
  privacyRedacted: integer('privacy_redacted').notNull().default(1),
  verificationStatus: text('verification_status').notNull().default('pending'),
  linkedEvidenceIdsJson: text('linked_evidence_ids_json').notNull().default('[]'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const evidenceItems = sqliteTable('evidence_items', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  modality: text('modality').notNull(), // 'image' | 'video' | 'audio' | 'text' | 'document'
  sourceType: text('source_type').notNull().default('upload'), // 'upload' | 'live_camera' | 'caption'
  originalFilename: text('original_filename').notNull(),
  storedFilename: text('stored_filename'),
  elaFilename: text('ela_filename'),
  fftFilename: text('fft_filename'),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  perceptualHash: text('perceptual_hash'),
  exifJson: text('exif_json'),
  metricsJson: text('metrics_json'),
  framesJson: text('frames_json'),
  transcript: text('transcript'),
  createdAt: integer('created_at').notNull(),
});

export const evidenceVersions = sqliteTable('evidence_versions', {
  id: text('id').primaryKey(),
  evidenceId: text('evidence_id')
    .notNull()
    .references(() => evidenceItems.id, { onDelete: 'cascade' }),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull().default(1),
  sha256: text('sha256').notNull(),
  byteSize: integer('byte_size').notNull(),
  note: text('note').notNull().default(''),
  updatedBy: text('updated_by').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const evidenceAccessLogs = sqliteTable('evidence_access_logs', {
  id: text('id').primaryKey(),
  evidenceId: text('evidence_id').notNull(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  action: text('action').notNull(), // 'view' | 'download' | 'receipt_download' | 'metadata_update'
  ipHash: text('ip_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  evidenceId: text('evidence_id'),
  modality: text('modality').notNull(),
  indicator: text('indicator').notNull(),
  whyFlagged: text('why_flagged').notNull(),
  locationOrTimestamp: text('location_or_timestamp').notNull(),
  confidenceRange: text('confidence_range').notNull(),
  limitation: text('limitation').notNull(),
  severity: text('severity').notNull().default('Medium'),
  createdAt: integer('created_at').notNull(),
});

export const graphNodes = sqliteTable('graph_nodes', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  nodeKey: text('node_key').notNull(),
  label: text('label').notNull(),
  nodeType: text('node_type').notNull(), // 'evidence' | 'claim' | 'metadata' | 'finding' | 'person' | 'case'
  modality: text('modality').notNull(),
  details: text('details').notNull(),
});

export const graphEdges = sqliteTable('graph_edges', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  sourceKey: text('source_key').notNull(),
  targetKey: text('target_key').notNull(),
  relation: text('relation').notNull(), // 'corroborates' | 'contradicts' | 'inconclusive'
  label: text('label').notNull(),
  explanation: text('explanation').notNull(),
  confidenceRange: text('confidence_range').notNull(),
  limitation: text('limitation').notNull(),
});

export const custodyLedger = sqliteTable('custody_ledger', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  entryIndex: integer('entry_index').notNull(),
  evidenceId: text('evidence_id'),
  action: text('action').notNull(),
  fileSha256: text('file_sha256').notNull(),
  collectedBy: text('collected_by').notNull().default(''),
  transferredBy: text('transferred_by').notNull().default(''),
  receivedBy: text('received_by').notNull().default(''),
  transferReason: text('transfer_reason').notNull().default(''),
  approvalSignature: text('approval_signature').notNull().default(''),
  prevEntryHash: text('prev_entry_hash').notNull(),
  entryHash: text('entry_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const caseComments = sqliteTable('case_comments', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  authorName: text('author_name').notNull(),
  authorRole: text('author_role').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const caseActivity = sqliteTable('case_activity', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  language: text('language').notNull().default('en'),
  devilsAdvocate: integer('devils_advocate').notNull().default(0),
  content: text('content').notNull(),
  citedFindingIdsJson: text('cited_finding_ids_json').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
});

export const communityVotes = sqliteTable('community_votes', {
  id: text('id').primaryKey(),
  topicKey: text('topic_key').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  voterName: text('voter_name').notNull(),
  stance: text('stance').notNull(), // 'plausible_artifact' | 'needs_corroboration' | 'likely_benign'
  rationale: text('rationale').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  ipHash: text('ip_hash').notNull(),
  details: text('details').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const notificationContacts = sqliteTable('notification_contacts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(), // 'email' | 'sms'
  countryCode: text('country_code').notNull().default(''),
  destination: text('destination').notNull(),
  verified: integer('verified').notNull().default(0),
  paused: integer('paused').notNull().default(0),
  verificationCodeHash: text('verification_code_hash'),
  verificationExpiresAt: integer('verification_expires_at'),
  lastOtpSentAt: integer('last_otp_sent_at').notNull().default(0),
  otpAttempts: integer('otp_attempts').notNull().default(0),
  lastDeliveredAt: integer('last_delivered_at'),
  lastError: text('last_error'),
  consentGranted: integer('consent_granted').notNull().default(0),
  consentAt: integer('consent_at'),
  eventPrefsJson: text('event_prefs_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const notificationPreferences = sqliteTable('notification_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailEnabled: integer('email_enabled').notNull().default(1),
  smsEnabled: integer('sms_enabled').notNull().default(1),
  inAppEnabled: integer('in_app_enabled').notNull().default(1),
  caseRegistered: integer('case_registered').notNull().default(1),
  caseAssigned: integer('case_assigned').notNull().default(1),
  caseUpdated: integer('case_updated').notNull().default(1),
  analysisCompleted: integer('analysis_completed').notNull().default(1),
  highRiskIndicator: integer('high_risk_indicator').notNull().default(1),
  evidenceSubmitted: integer('evidence_submitted').notNull().default(1),
  evidenceIntegrityFailed: integer('evidence_integrity_failed').notNull().default(1),
  custodyEvent: integer('custody_event').notNull().default(1),
  witnessRegistered: integer('witness_registered').notNull().default(1),
  caseClosed: integer('case_closed').notNull().default(1),
  securityAlert: integer('security_alert').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
});

export const otpVerifications = sqliteTable('otp_verifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  contactId: text('contact_id')
    .notNull()
    .references(() => notificationContacts.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  destinationMasked: text('destination_masked').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: integer('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  status: text('status').notNull().default('pending'), // 'pending' | 'verified' | 'expired' | 'locked' | 'failed'
  deliveryStatus: text('delivery_status').notNull().default('pending'),
  providerMessageId: text('provider_message_id'),
  errorDetail: text('error_detail'),
  createdAt: integer('created_at').notNull(),
  verifiedAt: integer('verified_at'),
});

export const notificationLogs = sqliteTable('notification_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  contactId: text('contact_id'),
  caseId: text('case_id'),
  channel: text('channel').notNull(),
  provider: text('provider').notNull().default('none'), // 'resend' | 'smtp' | 'twilio' | 'none'
  recipientMasked: text('recipient_masked').notNull(),
  eventType: text('event_type').notNull(),
  subjectOrPreview: text('subject_or_preview'),
  status: text('status').notNull(), // 'pending' | 'sent' | 'delivered' | 'failed' | 'retrying' | 'not_configured' | 'expired' | 'skipped_duplicate'
  providerMessageId: text('provider_message_id'),
  errorDetail: text('error_detail'),
  dedupeKey: text('dedupe_key').notNull(),
  attempts: integer('attempts').notNull().default(1),
  retryCount: integer('retry_count').notNull().default(0),
  nextRetryAt: integer('next_retry_at'),
  deliveredAt: integer('delivered_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
});

export const notificationWebhookEvents = sqliteTable('notification_webhook_events', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(), // 'resend' | 'twilio'
  eventType: text('event_type').notNull(),
  providerMessageId: text('provider_message_id'),
  status: text('status').notNull(),
  payloadSummary: text('payload_summary').notNull().default(''),
  signatureValid: integer('signature_valid').notNull().default(0),
  receivedAt: integer('received_at').notNull(),
});

export const inAppNotifications = sqliteTable('in_app_notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  caseId: text('case_id'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  read: integer('read').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const caseShareTokens = sqliteTable('case_share_tokens', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull().default('Investigator QR Access'),
  permissionsJson: text('permissions_json').notNull().default('{"summary":true,"findings":true,"custodyDigest":true,"evidenceInventory":true,"timeline":false}'),
  accessCount: integer('access_count').notNull().default(0),
  lastAccessedAt: integer('last_accessed_at'),
  expiresAt: integer('expires_at').notNull(),
  revoked: integer('revoked').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});
