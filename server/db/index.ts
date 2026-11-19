import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';
import { env } from '../env.ts';

// Store database and uploaded originals strictly outside the web/dist root
export const DATA_ROOT = env.storageDir
  ? path.resolve(process.cwd(), env.storageDir)
  : path.resolve(process.cwd(), 'data');
export const DB_DIR = path.join(DATA_ROOT, 'db');
export const DB_BACKUP_DIR = path.join(DB_DIR, 'backups');
export const UPLOADS_DIR = path.join(DATA_ROOT, 'uploads');
export const ELA_DIR = path.join(DATA_ROOT, 'ela');
export const SEED_DIR = path.join(DATA_ROOT, 'seed');

const DB_PATH = env.dbPath
  ? path.resolve(process.cwd(), env.dbPath)
  : path.join(DB_DIR, 'truthlens.sqlite');

for (const dir of [
  DATA_ROOT,
  path.dirname(DB_PATH),
  DB_DIR,
  DB_BACKUP_DIR,
  UPLOADS_DIR,
  ELA_DIR,
  SEED_DIR,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Backup existing SQLite file cleanly before opening/migrating schema
if (fs.existsSync(DB_PATH)) {
  try {
    const stat = fs.statSync(DB_PATH);
    if (stat.size > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(DB_BACKUP_DIR, `truthlens-${stamp}.sqlite`);
      fs.copyFileSync(DB_PATH, backupFile);
      const backups = fs
        .readdirSync(DB_BACKUP_DIR)
        .filter((f) => f.endsWith('.sqlite'))
        .sort();
      while (backups.length > 3) {
        const oldest = backups.shift();
        if (oldest) {
          fs.rmSync(path.join(DB_BACKUP_DIR, oldest), { force: true });
        }
      }
    }
  } catch (err) {
    console.warn('[db] pre-migration backup skipped:', err instanceof Error ? err.message : err);
  }
}

export const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Initialize tables with strict schema constraints (never drops existing tables)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'investigator',
    phone TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    badge_id TEXT NOT NULL DEFAULT '',
    email_verified INTEGER NOT NULL DEFAULT 0,
    email_verify_token_hash TEXT,
    email_verify_expires_at INTEGER,
    reset_token_hash TEXT,
    reset_expires_at INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    last_login_at INTEGER,
    is_demo_user INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    language TEXT NOT NULL DEFAULT 'en',
    text_size TEXT NOT NULL DEFAULT 'md',
    narration_enabled INTEGER NOT NULL DEFAULT 1,
    high_contrast INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    ip_hash TEXT NOT NULL DEFAULT '',
    last_active_at INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS case_categories (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    field_schema_json TEXT NOT NULL DEFAULT '[]',
    evidence_requirements_json TEXT NOT NULL DEFAULT '[]',
    report_template_note TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_number TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    caption_text TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'digital_fraud',
    status TEXT NOT NULL DEFAULT 'registered',
    priority TEXT NOT NULL DEFAULT 'medium',
    incident_location TEXT NOT NULL DEFAULT '',
    incident_date TEXT NOT NULL DEFAULT '',
    registration_date INTEGER NOT NULL DEFAULT 0,
    assigned_investigator_id TEXT,
    related_persons_json TEXT NOT NULL DEFAULT '[]',
    category_fields_json TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    closing_summary TEXT NOT NULL DEFAULT '',
    is_demo_seed INTEGER NOT NULL DEFAULT 0,
    risk_level TEXT NOT NULL DEFAULT 'Medium',
    confidence_min INTEGER NOT NULL DEFAULT 40,
    confidence_max INTEGER NOT NULL DEFAULT 70,
    summary TEXT NOT NULL DEFAULT '',
    limitations_json TEXT NOT NULL DEFAULT '[]',
    alternatives_json TEXT NOT NULL DEFAULT '[]',
    recommended_checks_json TEXT NOT NULL DEFAULT '[]',
    analysis_mode TEXT NOT NULL DEFAULT 'hybrid_ai',
    correlations_json TEXT NOT NULL DEFAULT '[]',
    manipulation_json TEXT NOT NULL DEFAULT '[]',
    analysis_stale INTEGER NOT NULL DEFAULT 0,
    human_review_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS case_collaborators (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_role TEXT NOT NULL DEFAULT 'investigator',
    added_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS witnesses (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id TEXT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    relationship TEXT NOT NULL DEFAULT 'witness',
    statement TEXT NOT NULL DEFAULT '',
    consent_granted INTEGER NOT NULL DEFAULT 1,
    privacy_redacted INTEGER NOT NULL DEFAULT 1,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    linked_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evidence_items (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    modality TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'upload',
    original_filename TEXT NOT NULL,
    stored_filename TEXT,
    ela_filename TEXT,
    fft_filename TEXT,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    perceptual_hash TEXT,
    exif_json TEXT,
    metrics_json TEXT,
    frames_json TEXT,
    transcript TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evidence_versions (
    id TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL DEFAULT 1,
    sha256 TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evidence_access_logs (
    id TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    evidence_id TEXT,
    modality TEXT NOT NULL,
    indicator TEXT NOT NULL,
    why_flagged TEXT NOT NULL,
    location_or_timestamp TEXT NOT NULL,
    confidence_range TEXT NOT NULL,
    limitation TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'Medium',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    label TEXT NOT NULL,
    node_type TEXT NOT NULL,
    modality TEXT NOT NULL,
    details TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    source_key TEXT NOT NULL,
    target_key TEXT NOT NULL,
    relation TEXT NOT NULL,
    label TEXT NOT NULL,
    explanation TEXT NOT NULL,
    confidence_range TEXT NOT NULL,
    limitation TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custody_ledger (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entry_index INTEGER NOT NULL,
    evidence_id TEXT,
    action TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    collected_by TEXT NOT NULL DEFAULT '',
    transferred_by TEXT NOT NULL DEFAULT '',
    received_by TEXT NOT NULL DEFAULT '',
    transfer_reason TEXT NOT NULL DEFAULT '',
    approval_signature TEXT NOT NULL DEFAULT '',
    prev_entry_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS case_comments (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL,
    author_role TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS case_activity (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id TEXT,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    devils_advocate INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    cited_finding_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS community_votes (
    id TEXT PRIMARY KEY,
    topic_key TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    voter_name TEXT NOT NULL,
    stance TEXT NOT NULL,
    rationale TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    ip_hash TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_contacts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT '',
    destination TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    paused INTEGER NOT NULL DEFAULT 0,
    verification_code_hash TEXT,
    verification_expires_at INTEGER,
    last_otp_sent_at INTEGER NOT NULL DEFAULT 0,
    otp_attempts INTEGER NOT NULL DEFAULT 0,
    last_delivered_at INTEGER,
    last_error TEXT,
    consent_granted INTEGER NOT NULL DEFAULT 0,
    consent_at INTEGER,
    event_prefs_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_enabled INTEGER NOT NULL DEFAULT 1,
    sms_enabled INTEGER NOT NULL DEFAULT 1,
    in_app_enabled INTEGER NOT NULL DEFAULT 1,
    case_registered INTEGER NOT NULL DEFAULT 1,
    case_assigned INTEGER NOT NULL DEFAULT 1,
    case_updated INTEGER NOT NULL DEFAULT 1,
    analysis_completed INTEGER NOT NULL DEFAULT 1,
    high_risk_indicator INTEGER NOT NULL DEFAULT 1,
    evidence_submitted INTEGER NOT NULL DEFAULT 1,
    evidence_integrity_failed INTEGER NOT NULL DEFAULT 1,
    custody_event INTEGER NOT NULL DEFAULT 1,
    witness_registered INTEGER NOT NULL DEFAULT 1,
    case_closed INTEGER NOT NULL DEFAULT 1,
    security_alert INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otp_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES notification_contacts(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    destination_masked TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'pending',
    delivery_status TEXT NOT NULL DEFAULT 'pending',
    provider_message_id TEXT,
    error_detail TEXT,
    created_at INTEGER NOT NULL,
    verified_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS notification_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id TEXT,
    case_id TEXT,
    channel TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'none',
    recipient_masked TEXT NOT NULL,
    event_type TEXT NOT NULL,
    subject_or_preview TEXT,
    status TEXT NOT NULL,
    provider_message_id TEXT,
    error_detail TEXT,
    dedupe_key TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER,
    delivered_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS notification_webhook_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    provider_message_id TEXT,
    status TEXT NOT NULL,
    payload_summary TEXT NOT NULL DEFAULT '',
    signature_valid INTEGER NOT NULL DEFAULT 0,
    received_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS in_app_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS case_share_tokens (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT 'Investigator QR Access',
    permissions_json TEXT NOT NULL DEFAULT '{"summary":true,"findings":true,"custodyDigest":true,"evidenceInventory":true,"timeline":false}',
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at INTEGER,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

function addColumnIfMissing(table: string, colName: string, alterSql: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === colName)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${alterSql}`);
  }
}

// Non-destructive additive column migrations preserving all existing SQLite case data
addColumnIfMissing('users', 'phone', "phone TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'department', "department TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'badge_id', "badge_id TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'email_verified', 'email_verified INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'email_verify_token_hash', 'email_verify_token_hash TEXT');
addColumnIfMissing('users', 'email_verify_expires_at', 'email_verify_expires_at INTEGER');
addColumnIfMissing('users', 'reset_token_hash', 'reset_token_hash TEXT');
addColumnIfMissing('users', 'reset_expires_at', 'reset_expires_at INTEGER');
addColumnIfMissing('users', 'active', 'active INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'failed_login_attempts', 'failed_login_attempts INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'locked_until', 'locked_until INTEGER');
addColumnIfMissing('users', 'last_login_at', 'last_login_at INTEGER');

addColumnIfMissing('sessions', 'user_agent', "user_agent TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('sessions', 'ip_hash', "ip_hash TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('sessions', 'last_active_at', 'last_active_at INTEGER NOT NULL DEFAULT 0');

addColumnIfMissing('cases', 'case_number', "case_number TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('cases', 'status', "status TEXT NOT NULL DEFAULT 'registered'");
addColumnIfMissing('cases', 'priority', "priority TEXT NOT NULL DEFAULT 'medium'");
addColumnIfMissing('cases', 'incident_location', "incident_location TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('cases', 'incident_date', "incident_date TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('cases', 'registration_date', 'registration_date INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('cases', 'assigned_investigator_id', 'assigned_investigator_id TEXT');
addColumnIfMissing('cases', 'related_persons_json', "related_persons_json TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('cases', 'category_fields_json', "category_fields_json TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing('cases', 'notes', "notes TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('cases', 'closing_summary', "closing_summary TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('cases', 'analysis_mode', "analysis_mode TEXT NOT NULL DEFAULT 'hybrid_ai'");
addColumnIfMissing('cases', 'correlations_json', "correlations_json TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('cases', 'manipulation_json', "manipulation_json TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('cases', 'web_verifications_json', "web_verifications_json TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('cases', 'analysis_stale', 'analysis_stale INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('cases', 'human_review_json', "human_review_json TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing('cases', 'category', "category TEXT NOT NULL DEFAULT 'digital_fraud'");

addColumnIfMissing('evidence_items', 'source_type', "source_type TEXT NOT NULL DEFAULT 'upload'");

addColumnIfMissing('custody_ledger', 'collected_by', "collected_by TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('custody_ledger', 'transferred_by', "transferred_by TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('custody_ledger', 'received_by', "received_by TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('custody_ledger', 'transfer_reason', "transfer_reason TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('custody_ledger', 'approval_signature', "approval_signature TEXT NOT NULL DEFAULT ''");

addColumnIfMissing('notification_contacts', 'country_code', "country_code TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('notification_contacts', 'paused', 'paused INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('notification_contacts', 'last_otp_sent_at', 'last_otp_sent_at INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('notification_contacts', 'otp_attempts', 'otp_attempts INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('notification_contacts', 'last_delivered_at', 'last_delivered_at INTEGER');
addColumnIfMissing('notification_contacts', 'last_error', 'last_error TEXT');

addColumnIfMissing('notification_logs', 'contact_id', 'contact_id TEXT');
addColumnIfMissing('notification_logs', 'provider', "provider TEXT NOT NULL DEFAULT 'none'");
addColumnIfMissing('notification_logs', 'subject_or_preview', 'subject_or_preview TEXT');
addColumnIfMissing('notification_logs', 'attempts', 'attempts INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('notification_logs', 'next_retry_at', 'next_retry_at INTEGER');
addColumnIfMissing('notification_logs', 'delivered_at', 'delivered_at INTEGER');
addColumnIfMissing('notification_logs', 'updated_at', 'updated_at INTEGER');

addColumnIfMissing(
  'case_share_tokens',
  'permissions_json',
  `permissions_json TEXT NOT NULL DEFAULT '{"summary":true,"findings":true,"custodyDigest":true,"evidenceInventory":true,"timeline":false}'`,
);
addColumnIfMissing('case_share_tokens', 'access_count', 'access_count INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('case_share_tokens', 'last_accessed_at', 'last_accessed_at INTEGER');

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_cases_user ON cases(user_id);
  CREATE INDEX IF NOT EXISTS idx_cases_assigned ON cases(assigned_investigator_id);
  CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status, priority);
  CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence_items(case_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_findings_case ON findings(case_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_case ON custody_ledger(case_id, entry_index);
  CREATE INDEX IF NOT EXISTS idx_votes_topic ON community_votes(topic_key);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_notif_contacts_user ON notification_contacts(user_id);
  CREATE INDEX IF NOT EXISTS idx_notif_logs_user ON notification_logs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_notif_logs_msg ON notification_logs(provider_message_id);
  CREATE INDEX IF NOT EXISTS idx_otp_verifications_contact ON otp_verifications(contact_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_webhook_events_msg ON notification_webhook_events(provider_message_id, received_at);
  CREATE INDEX IF NOT EXISTS idx_share_tokens_case ON case_share_tokens(case_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_witnesses_case ON witnesses(case_id);
  CREATE INDEX IF NOT EXISTS idx_comments_case ON case_comments(case_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_case ON case_activity(case_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_in_app_notif_user ON in_app_notifications(user_id, read, created_at);
`);

// Backfill case_number and registration_date on legacy rows safely
const legacyCases = sqlite
  .prepare("SELECT id, created_at, case_number, registration_date FROM cases WHERE case_number = '' OR registration_date = 0")
  .all() as Array<{ id: string; created_at: number; case_number: string; registration_date: number }>;
const updateLegacyStmt = sqlite.prepare(
  'UPDATE cases SET case_number = ?, registration_date = ? WHERE id = ?',
);
legacyCases.forEach((row, idx) => {
  const num = row.case_number || `TL-2026-${String(idx + 1).padStart(4, '0')}`;
  const reg = row.registration_date || row.created_at || Date.now();
  updateLegacyStmt.run(num, reg, row.id);
});

export const db = drizzle(sqlite, { schema });
