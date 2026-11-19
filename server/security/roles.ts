import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { caseCollaborators, cases, witnesses } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';

export const USER_ROLES = [
  'super_admin',
  'investigation_admin',
  'senior_investigator',
  'investigator',
  'evidence_officer',
  'witness',
  'viewer',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const CASE_STATUSES = [
  'draft',
  'registered',
  'under_review',
  'assigned',
  'investigation_in_progress',
  'evidence_collection',
  'forensic_analysis',
  'awaiting_verification',
  'escalated',
  'resolved',
  'closed',
  'archived',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export function normalizeRole(role: string | undefined | null): UserRole {
  if (role === 'admin') return 'super_admin'; // backwards compatibility
  if (USER_ROLES.includes(role as UserRole)) return role as UserRole;
  return 'investigator';
}

export function isSuperAdmin(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  return normalizeRole(user.role) === 'super_admin';
}

export function isAdminRole(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return r === 'super_admin' || r === 'investigation_admin';
}

export function canManageUsers(user: AuthUser | undefined | null): boolean {
  return isSuperAdmin(user);
}

export function canManageCategories(user: AuthUser | undefined | null): boolean {
  return isAdminRole(user);
}

export function canAssignInvestigator(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return r === 'super_admin' || r === 'investigation_admin' || r === 'senior_investigator';
}

export function canCreateCase(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return r !== 'viewer' && r !== 'witness';
}

export function canEditCaseDetails(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return r !== 'viewer' && r !== 'witness';
}

export function canDeleteCase(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return r === 'super_admin' || r === 'investigation_admin' || r === 'senior_investigator' || r === 'investigator';
}

export function canUploadEvidence(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return r !== 'viewer' && r !== 'witness';
}

export function canManageCustody(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return (
    r === 'super_admin' ||
    r === 'investigation_admin' ||
    r === 'senior_investigator' ||
    r === 'investigator' ||
    r === 'evidence_officer'
  );
}

export function canRunAnalysis(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return (
    r === 'super_admin' ||
    r === 'investigation_admin' ||
    r === 'senior_investigator' ||
    r === 'investigator'
  );
}

export function canApproveReview(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return (
    r === 'super_admin' ||
    r === 'investigation_admin' ||
    r === 'senior_investigator' ||
    r === 'investigator'
  );
}

export function canManageWitnesses(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return (
    r === 'super_admin' ||
    r === 'investigation_admin' ||
    r === 'senior_investigator' ||
    r === 'investigator'
  );
}

export function canViewWitnessPii(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return (
    r === 'super_admin' ||
    r === 'investigation_admin' ||
    r === 'senior_investigator' ||
    r === 'investigator'
  );
}

export function canShareQr(user: AuthUser | undefined | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return r !== 'viewer' && r !== 'witness';
}

export interface CaseAccessResult {
  allowed: boolean;
  isOwner: boolean;
  isAssigned: boolean;
  isAdmin: boolean;
  isWitnessLinked: boolean;
  collaboratorRole: string | null;
  canWrite: boolean;
}

export async function getUserCaseAccess(
  caseId: string,
  user: AuthUser,
): Promise<CaseAccessResult> {
  const rowList = await db
    .select()
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);

  if (rowList.length === 0) {
    return {
      allowed: false,
      isOwner: false,
      isAssigned: false,
      isAdmin: false,
      isWitnessLinked: false,
      collaboratorRole: null,
      canWrite: false,
    };
  }

  const c = rowList[0];
  const admin = isAdminRole(user);
  const owner = c.userId === user.id;
  const assigned = c.assignedInvestigatorId === user.id;

  const collabRows = await db
    .select()
    .from(caseCollaborators)
    .where(and(eq(caseCollaborators.caseId, caseId), eq(caseCollaborators.userId, user.id)))
    .limit(1);
  const collaboratorRole = collabRows[0]?.accessRole ?? null;

  const witnessRows = await db
    .select()
    .from(witnesses)
    .where(
      and(
        eq(witnesses.caseId, caseId),
        or(eq(witnesses.userId, user.id), eq(witnesses.email, user.email)),
      ),
    )
    .limit(1);
  const isWitnessLinked = witnessRows.length > 0;

  const allowed = admin || owner || assigned || Boolean(collaboratorRole) || isWitnessLinked;
  const normRole = normalizeRole(user.role);
  const roleCanWrite = normRole !== 'viewer' && normRole !== 'witness' && collaboratorRole !== 'viewer';

  return {
    allowed,
    isOwner: owner,
    isAssigned: assigned,
    isAdmin: admin,
    isWitnessLinked,
    collaboratorRole,
    canWrite: allowed && roleCanWrite,
  };
}
