import { eq, isNotNull, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { caseCollaborators, cases, evidenceItems, witnesses } from '../db/schema.ts';
import type { AuthUser } from '../security/auth.ts';
import { isAdminRole } from '../security/roles.ts';

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

export function computeHexHammingDistance(h1: string | null | undefined, h2: string | null | undefined): number | null {
  if (!h1 || !h2 || h1.length !== h2.length || h1.length === 0) return null;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    const a = Number.parseInt(h1[i], 16);
    const b = Number.parseInt(h2[i], 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    let xor = a ^ b;
    while (xor > 0) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

export async function findCrossCaseProvenanceMatches(
  targetCaseId: string,
  user: AuthUser,
): Promise<{ scannedImages: number; comparedCorpusSize: number; matches: ProvenanceRadarMatch[] }> {
  const targetImages = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.caseId, targetCaseId));

  const targetWithHash = targetImages.filter((ev) => ev.modality === 'image' && ev.perceptualHash);
  if (targetWithHash.length === 0) {
    return { scannedImages: 0, comparedCorpusSize: 0, matches: [] };
  }

  // Enforce strict RBAC/IDOR isolation: compare ONLY against cases the current user is authorized to view
  const admin = isAdminRole(user);
  let accessibleCaseRows = await db.select().from(cases);
  if (!admin) {
    const [collabRows, witnessRows] = await Promise.all([
      db
        .select({ caseId: caseCollaborators.caseId })
        .from(caseCollaborators)
        .where(eq(caseCollaborators.userId, user.id)),
      db
        .select({ caseId: witnesses.caseId })
        .from(witnesses)
        .where(or(eq(witnesses.userId, user.id), eq(witnesses.email, user.email))),
    ]);
    const allowedSet = new Set([
      ...collabRows.map((r) => r.caseId),
      ...witnessRows.map((r) => r.caseId),
    ]);
    accessibleCaseRows = accessibleCaseRows.filter(
      (c) => c.userId === user.id || c.assignedInvestigatorId === user.id || allowedSet.has(c.id),
    );
  }

  const caseById = new Map(accessibleCaseRows.map((c) => [c.id, c]));
  const allHashedImages = await db
    .select()
    .from(evidenceItems)
    .where(isNotNull(evidenceItems.perceptualHash));

  const corpusImages = allHashedImages.filter(
    (img) => img.caseId !== targetCaseId && caseById.has(img.caseId),
  );

  const matches: ProvenanceRadarMatch[] = [];
  for (const src of targetWithHash) {
    const totalBits = (src.perceptualHash?.length ?? 16) * 4;
    for (const candidate of corpusImages) {
      const dist = computeHexHammingDistance(src.perceptualHash, candidate.perceptualHash);
      if (dist !== null && dist <= 12) {
        const matchedCase = caseById.get(candidate.caseId);
        if (!matchedCase) continue;
        const similarityPct = Math.max(0, Math.round(((totalBits - dist) / totalBits) * 100));
        matches.push({
          evidenceId: src.id,
          sourceFilename: src.originalFilename,
          matchedCaseId: matchedCase.id,
          matchedCaseNumber: matchedCase.caseNumber || `TL-${matchedCase.id.slice(0, 6).toUpperCase()}`,
          matchedCaseTitle: matchedCase.title,
          matchedEvidenceId: candidate.id,
          matchedFilename: candidate.originalFilename,
          matchedPerceptualHash: candidate.perceptualHash || '',
          hammingDistance: dist,
          similarityPct,
          matchedCreatedAt: candidate.createdAt,
          relationType: dist <= 2 ? 'exact_perceptual_match' : 'near_duplicate_recompressed',
        });
      }
    }
  }

  matches.sort((a, b) => a.hammingDistance - b.hammingDistance);

  return {
    scannedImages: targetWithHash.length,
    comparedCorpusSize: corpusImages.length,
    matches: matches.slice(0, 20),
  };
}
