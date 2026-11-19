import crypto from 'node:crypto';
import { db } from '../db/index.ts';
import { caseCategories } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

export interface CategoryFieldDef {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select';
  placeholder?: string;
  options?: string[];
}

export interface DefaultCategorySeed {
  slug: string;
  name: string;
  description: string;
  fields: CategoryFieldDef[];
  evidenceRequirements: string[];
  reportTemplateNote: string;
}

export const DEFAULT_CASE_CATEGORIES: DefaultCategorySeed[] = [
  {
    slug: 'digital_fraud',
    name: 'Digital Fraud',
    description: 'Online deception, deceptive digital storefronts, payment portal spoofing, and manipulated receipts.',
    fields: [
      { key: 'platform', label: 'Platform / Channel', type: 'text', placeholder: 'e.g. Payment App, Web Portal' },
      { key: 'claimedAmount', label: 'Claimed Impact / Reference', type: 'text', placeholder: 'Reference or invoice ID' },
    ],
    evidenceRequirements: ['Original screenshot or receipt PDF', 'Transaction confirmation communication', 'URL / header capture'],
    reportTemplateNote: 'Highlight transaction artifact metadata, PDF incremental revisions, and communication timeline.',
  },
  {
    slug: 'financial_fraud',
    name: 'Financial Fraud',
    description: 'Forged bank statements, altered wire confirmations, invoice tampering, and synthetic financial documents.',
    fields: [
      { key: 'institution', label: 'Financial Institution', type: 'text', placeholder: 'Bank or clearing network' },
      { key: 'instrumentType', label: 'Instrument / Statement Type', type: 'text', placeholder: 'Wire slip, PDF statement' },
    ],
    evidenceRequirements: ['Unmodified bank PDF', 'Supporting remittance email/text', 'Verification statement'],
    reportTemplateNote: 'Focus on PDF Producer/Creator tags, incremental %%EOF edits, and date mismatches.',
  },
  {
    slug: 'identity_theft',
    name: 'Identity Theft',
    description: 'Stolen identity documents, spoofed KYC selfies/videos, and unauthorized account creation artifacts.',
    fields: [
      { key: 'compromisedSurface', label: 'Verification Surface', type: 'text', placeholder: 'KYC portal, SIM swap, ID check' },
      { key: 'jurisdiction', label: 'Jurisdiction / Issuing Region', type: 'text', placeholder: 'State or country' },
    ],
    evidenceRequirements: ['Original identity capture', 'Live face verification frame', 'Notification log'],
    reportTemplateNote: 'Redact sensitive PII in exports; emphasize live-capture liveness and ELA boundary differentials.',
  },
  {
    slug: 'cybercrime',
    name: 'Cybercrime',
    description: 'Unauthorized digital intrusion artifacts, malicious PDF scripts, defacement captures, and log evidence.',
    fields: [
      { key: 'vector', label: 'Suspected Vector', type: 'text', placeholder: 'Malicious attachment, credential reuse' },
      { key: 'affectedSystem', label: 'Affected System / Endpoint', type: 'text', placeholder: 'Host or portal name' },
    ],
    evidenceRequirements: ['Suspicious document or capture', 'Chronological incident notes', 'System screenshot'],
    reportTemplateNote: 'Flag embedded PDF JS/OpenAction triggers and document SHA-256 chain verification.',
  },
  {
    slug: 'online_harassment',
    name: 'Online Harassment',
    description: 'Fabricated chat screenshots, targeted synthetic media abuse, and coordinated impersonation harassment.',
    fields: [
      { key: 'platform', label: 'Social / Messaging Platform', type: 'text', placeholder: 'Messaging or social app' },
      { key: 'targetAccount', label: 'Targeted Account Handle', type: 'text', placeholder: '@handle or profile ID' },
    ],
    evidenceRequirements: ['Full-resolution screenshots', 'Original audio/video attachments', 'Witness timeline'],
    reportTemplateNote: 'Inspect screenshot UI compression seams and protect witness contact PII.',
  },
  {
    slug: 'phishing_scams',
    name: 'Phishing and Scams',
    description: 'Lure messages, cloned login pages, synthetic voice vishing calls, and scam QR/link payloads.',
    fields: [
      { key: 'deliveryChannel', label: 'Delivery Channel', type: 'select', options: ['Email', 'SMS', 'Voice Call', 'Messaging App', 'QR Code'] },
      { key: 'senderClaim', label: 'Impersonated Brand / Sender', type: 'text', placeholder: 'Organization or caller claimed' },
    ],
    evidenceRequirements: ['Lure message text or PDF', 'Voice call recording if vishing', 'Captured lure screenshot'],
    reportTemplateNote: 'Evaluate acoustic vocoder markers on vishing calls and text entity consistency.',
  },
  {
    slug: 'fake_documents',
    name: 'Fake Documents',
    description: 'Suspected fabricated certificates, permits, academic transcripts, court notices, or ID cards.',
    fields: [
      { key: 'documentClass', label: 'Document Classification', type: 'text', placeholder: 'Certificate, Permit, Notice' },
      { key: 'issuingAuthority', label: 'Purported Issuing Authority', type: 'text', placeholder: 'Agency or institution' },
    ],
    evidenceRequirements: ['Original digital PDF or high-res scan', 'Purported issuer verification notes'],
    reportTemplateNote: 'Summarize incremental PDF revisions, font/software mismatches, and ELA patch anomalies.',
  },
  {
    slug: 'image_manipulation',
    name: 'Image Manipulation',
    description: 'Spliced photographs, copy-move edits, localized retouching, and generative image inpainting.',
    fields: [
      { key: 'cameraSource', label: 'Claimed Capture Device', type: 'text', placeholder: 'Phone or DSLR model' },
      { key: 'targetRegion', label: 'Disputed Visual Region', type: 'text', placeholder: 'e.g. License plate, background crowd' },
    ],
    evidenceRequirements: ['Original uncropped image file', 'Comparison peer photos if available'],
    reportTemplateNote: 'Include ELA heatmap sector variance ratios, 2D FFT spectral peaks, and EXIF summary.',
  },
  {
    slug: 'video_manipulation',
    name: 'Video Manipulation',
    description: 'Frame splicing, temporal re-ordering, face-swap video overlays, and A/V desynchronization.',
    fields: [
      { key: 'containerFormat', label: 'Container / Codec', type: 'text', placeholder: 'MP4 / H.264 / WebM' },
      { key: 'disputedTimestamp', label: 'Disputed Timestamp Range', type: 'text', placeholder: 'e.g. 00:12 - 00:28' },
    ],
    evidenceRequirements: ['Original MP4/WebM file', 'Keyframe temporal delta samples', 'Context caption'],
    reportTemplateNote: 'Document sampled frame delta peaks, flagged timestamps, and audio track presence.',
  },
  {
    slug: 'audio_manipulation',
    name: 'Audio Manipulation',
    description: 'Voice splicing, ambient noise-floor breaks, TTS cloning, and selective phrase removal.',
    fields: [
      { key: 'recordingDevice', label: 'Claimed Recording Environment', type: 'text', placeholder: 'Street memo, phone call, studio' },
      { key: 'disputedWindow', label: 'Disputed Audio Window', type: 'text', placeholder: 'e.g. 02.6s - 03.85s' },
    ],
    evidenceRequirements: ['Uncompressed WAV or original voice memo', 'Claimed transcript'],
    reportTemplateNote: 'Report spectral discontinuity windows, noise-floor shifts, and synthetic pitch markers.',
  },
  {
    slug: 'deepfake_investigation',
    name: 'Deepfake Investigation',
    description: 'Comprehensive multimodal verification of suspected AI-generated faces, voices, and crisis claims.',
    fields: [
      { key: 'claimedContext', label: 'Claimed Event / Location', type: 'text', placeholder: 'Event name & claimed date' },
      { key: 'suspectedModality', label: 'Primary Suspected Modality', type: 'select', options: ['Multimodal', 'Image', 'Video', 'Audio', 'Live Camera'] },
    ],
    evidenceRequirements: ['Visual/audio artifact', 'Claimed caption text', 'Corroborating witness record'],
    reportTemplateNote: 'Present cross-modal correlation matrix, contradiction graph, and innocent explanations.',
  },
  {
    slug: 'missing_digital_evidence',
    name: 'Missing Digital Evidence',
    description: 'Investigations tracking missing source originals, stripped EXIF/container chains, and custody gaps.',
    fields: [
      { key: 'expectedSource', label: 'Expected Source Custodian', type: 'text', placeholder: 'Device owner or relay platform' },
      { key: 'gapWindow', label: 'Missing Custody Window', type: 'text', placeholder: 'Timeframe of unverified transfer' },
    ],
    evidenceRequirements: ['Available re-encoded copies', 'Transfer/custody communication logs'],
    reportTemplateNote: 'Emphasize methodological limitations of re-encoded files and custody gap recommendations.',
  },
  {
    slug: 'social_media_investigation',
    name: 'Social Media Investigation',
    description: 'Viral claim verification, recycled crisis footage, bot-amplified captions, and geo-location checks.',
    fields: [
      { key: 'postUrlOrHandle', label: 'Source Handle / Post Ref', type: 'text', placeholder: 'Account or post identifier' },
      { key: 'claimedTimestamp', label: 'Claimed Post Date', type: 'text', placeholder: 'YYYY-MM-DD' },
    ],
    evidenceRequirements: ['Media file saved from post', 'Exact post caption/text', 'Location reference'],
    reportTemplateNote: 'Cross-check visual signage/landmarks against caption date and location assertions.',
  },
  {
    slug: 'data_breach',
    name: 'Data Breach',
    description: 'Leaked document verification, manipulated dump samples, and unauthorized disclosure timelines.',
    fields: [
      { key: 'affectedOrg', label: 'Affected Organization / Asset', type: 'text', placeholder: 'Organization or dataset name' },
      { key: 'exposureScope', label: 'Suspected Exposure Scope', type: 'text', placeholder: 'Records or file types' },
    ],
    evidenceRequirements: ['Redacted sample artifact', 'Disclosure notice PDF', 'Incident timeline notes'],
    reportTemplateNote: 'Maintain strict PII redaction in shared reports and custody verification.',
  },
  {
    slug: 'impersonation',
    name: 'Impersonation',
    description: 'Executive/official spoofing, cloned profiles, synthetic voice impersonation, and false endorsements.',
    fields: [
      { key: 'impersonatedRole', label: 'Impersonated Person / Role', type: 'text', placeholder: 'Title or account impersonated' },
      { key: 'channel', label: 'Channel Used', type: 'text', placeholder: 'Video call, voice note, social account' },
    ],
    evidenceRequirements: ['Suspected impersonation media', 'Baseline reference notes', 'Witness statement'],
    reportTemplateNote: 'Detail live face-landmark symmetry/motion checks or voice cadence anomalies without identity verdict.',
  },
  {
    slug: 'suspicious_communication',
    name: 'Suspicious Communication',
    description: 'Altered emails, forged chat exports, spliced voicemails, and coerced communication claims.',
    fields: [
      { key: 'medium', label: 'Communication Medium', type: 'select', options: ['Voice Note', 'SMS/Chat', 'Email/PDF', 'Video Message'] },
      { key: 'senderClaim', label: 'Purported Sender', type: 'text', placeholder: 'Claimed sender identifier' },
    ],
    evidenceRequirements: ['Exported message text or PDF', 'Attached voice/media file'],
    reportTemplateNote: 'Correlate claimed timestamps against PDF/EXIF/audio stream properties.',
  },
  {
    slug: 'witness_statement_verification',
    name: 'Witness Statement Verification',
    description: 'Cross-checking witness accounts against physical metadata, timestamps, and submitted digital media.',
    fields: [
      { key: 'witnessRef', label: 'Witness Reference ID', type: 'text', placeholder: 'Internal witness reference' },
      { key: 'corroborationTarget', label: 'Corroboration Target', type: 'text', placeholder: 'Time, place, or artifact' },
    ],
    evidenceRequirements: ['Signed/consented witness record', 'Supporting photo/audio/document evidence'],
    reportTemplateNote: 'Keep witness PII redacted in external views while documenting corroboration or discrepancies.',
  },
  {
    slug: 'document_authenticity',
    name: 'Document Authenticity',
    description: 'Forensic inspection of contracts, affidavits, invoices, and notices for post-creation tampering.',
    fields: [
      { key: 'documentTitle', label: 'Document Title / Ref', type: 'text', placeholder: 'Contract or affidavit number' },
      { key: 'claimedAuthor', label: 'Claimed Author / Signer', type: 'text', placeholder: 'Organization or role' },
    ],
    evidenceRequirements: ['Original PDF/TXT artifact', 'Signature or issuance date claim'],
    reportTemplateNote: 'Audit %%EOF incremental revisions, creator software provenance, and entity dates.',
  },
  {
    slug: 'evidence_tampering',
    name: 'Evidence Tampering',
    description: 'Audit of altered digital exhibits, broken SHA-256 custody chains, and re-saved forensic files.',
    fields: [
      { key: 'exhibitId', label: 'Disputed Exhibit ID', type: 'text', placeholder: 'Original exhibit identifier' },
      { key: 'expectedSha256', label: 'Prior Recorded SHA-256 (if known)', type: 'text', placeholder: '64-char hex digest' },
    ],
    evidenceRequirements: ['Suspected altered artifact', 'Prior custody receipt or ledger digest'],
    reportTemplateNote: 'Include SHA-256 verification state, dHash comparison, and full custody transfer audit.',
  },
  {
    slug: 'other_custom',
    name: 'Other / Custom Investigation',
    description: 'Flexible multimodal forensic dossier for custom digital investigations and emerging anomaly workflows.',
    fields: [
      { key: 'customClassification', label: 'Custom Classification', type: 'text', placeholder: 'Define investigation type' },
      { key: 'customScope', label: 'Primary Investigation Goal', type: 'text', placeholder: 'Describe scope' },
    ],
    evidenceRequirements: ['Any image, video, audio, PDF, or text context'],
    reportTemplateNote: 'Tailor human investigator checklist to custom case scope.',
  },
];

export async function ensureDefaultCaseCategories(): Promise<void> {
  const now = Date.now();
  const existing = await db.select({ slug: caseCategories.slug }).from(caseCategories);
  const existingSlugs = new Set(existing.map((c) => c.slug));

  for (const cat of DEFAULT_CASE_CATEGORIES) {
    if (!existingSlugs.has(cat.slug)) {
      await db.insert(caseCategories).values({
        id: crypto.randomUUID(),
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        fieldSchemaJson: JSON.stringify(cat.fields),
        evidenceRequirementsJson: JSON.stringify(cat.evidenceRequirements),
        reportTemplateNote: cat.reportTemplateNote,
        isDefault: 1,
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

export async function getCategoryBySlugOrName(slugOrName: string) {
  const rows = await db
    .select()
    .from(caseCategories)
    .where(eq(caseCategories.slug, slugOrName))
    .limit(1);
  return rows[0] ?? null;
}
