import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { JWTPayload } from "jose";
import { groupPath } from "@/lib/rooms";

// WALKTHROUGH MODE (NEXT_PUBLIC_WALKTHROUGH=1): stands in for TideCloak + the Tide network when the
// public Tide nodes are unavailable, so the app's real screens and flows can still be demonstrated.
// It simulates identity, IGA change requests (2-of-3 quorum) and the RelationshipAttestation checks.
// It is NOT security: nothing here is cryptographically enforced. Live mode never loads this file's logic.
export const WALKTHROUGH = process.env.NEXT_PUBLIC_WALKTHROUGH === "1";

export const PERSONAS: Record<string, { name: string; institution: string; admin: boolean }> = {
  lee: { name: "Dr Mei Lee", institution: "Northbridge University", admin: true },
  chen: { name: "Dr Daniel Chen", institution: "Helix Therapeutics", admin: true },
  aisha: { name: "Dr Aisha Rahman", institution: "St Aurelia Hospital", admin: true },
  nurul: { name: "Dr Nurul Huda", institution: "Sunway Institute", admin: false },
};

export interface WtCR {
  id: string; actionType: string; entityType: string; description: string; requestedBy: string; createdAt: string;
  authorizers: { username: string; timestamp: string }[]; threshold: number; status: "PENDING" | "COMMITTED";
  apply: { kind: "groupRoles"; group: string; roles: string[] } | { kind: "member"; group: string; sub: string };
}
interface WtState { members: Record<string, string[]>; groupRoles: Record<string, string[]>; crs: WtCR[] }

const FILE = join(process.cwd(), "data", "walkthrough.json");
const initial = (): WtState => ({
  members: { lee: [groupPath("alz-biomarkers")], chen: [groupPath("alz-biomarkers"), groupPath("dengue-vax")], aisha: [groupPath("alz-biomarkers")], nurul: [groupPath("dengue-vax")] },
  groupRoles: { [groupPath("alz-biomarkers")]: ["_tide_encryptor"], [groupPath("dengue-vax")]: ["_tide_encryptor"] },
  crs: [],
});
export function wtRead(): WtState {
  try { return JSON.parse(readFileSync(FILE, "utf-8")); } catch { return initial(); }
}
export function wtUpdate(fn: (s: WtState) => void) {
  const s = wtRead(); fn(s);
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
  return s;
}

/** The token payload a persona would carry: groups + realm roles inherited from those groups. */
export function wtJwt(persona: string): JWTPayload | null {
  const p = PERSONAS[persona];
  if (!p) return null;
  const s = wtRead();
  const groups = s.members[persona] || [];
  const roles = new Set(["_tide_enabled", "appUser", ...groups.flatMap((g) => s.groupRoles[g] || [])]);
  return {
    sub: persona, preferred_username: persona, groups, realm_access: { roles: [...roles] },
    resource_access: p.admin ? { "realm-management": { roles: ["tide-realm-admin"] } } : {},
  } as JWTPayload;
}

export function wtFile(cr: Omit<WtCR, "id" | "createdAt" | "authorizers" | "threshold" | "status">) {
  const full: WtCR = { ...cr, id: crypto.randomUUID(), createdAt: new Date().toISOString(), authorizers: [], threshold: 2, status: "PENDING" };
  wtUpdate((s) => { s.crs.push(full); });
  return full;
}

/** One institution admin signs. At quorum the change commits, exactly once. */
type Tally = { authorizationCount: number; threshold: number; committed: boolean };
export function wtApprove(id: string, persona: string): Tally | null {
  let out = null as Tally | null;
  wtUpdate((s) => {
    const cr = s.crs.find((c) => c.id === id && c.status === "PENDING");
    if (!cr) return;
    if (!cr.authorizers.some((a) => a.username === persona)) cr.authorizers.push({ username: persona, timestamp: new Date().toISOString() });
    if (cr.authorizers.length >= cr.threshold) {
      cr.status = "COMMITTED";
      if (cr.apply.kind === "groupRoles") s.groupRoles[cr.apply.group] = [...new Set([...(s.groupRoles[cr.apply.group] || []), ...cr.apply.roles])];
      else s.members[cr.apply.sub] = [...new Set([...(s.members[cr.apply.sub] || []), cr.apply.group])];
    }
    out = { authorizationCount: cr.authorizers.length, threshold: cr.threshold, committed: cr.status === "COMMITTED" };
  });
  return out;
}

export const wtPending = () =>
  wtRead().crs.filter((c) => c.status === "PENDING").map((c) => ({ ...c, authorizationCount: c.authorizers.length, readyToCommit: false }));
