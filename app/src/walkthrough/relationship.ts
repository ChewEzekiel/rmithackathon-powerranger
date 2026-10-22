// Walkthrough-mode replacement for src/lib/tide/relationship.ts (swapped in by next.config.ts only when
// NEXT_PUBLIC_WALKTHROUGH=1). Same exports, simulated network.
import { ENCRYPT_ROLE, DECRYPT_ROLE, getSession, parsePolicy, check, sealData, openData, pause } from "./sim";

export { ENCRYPT_ROLE, DECRYPT_ROLE };
export const RELATIONSHIP_CONTRACT_ID = "RelationshipAttestation:1";
export type RelationshipSubject = { type: "User"; id: string } | { type: "Group"; id: string } | { type: "Role"; id: string; clientId?: string };
export type RelationshipAccess = "read" | "write" | "read-write";
const ROLES_FOR: Record<RelationshipAccess, string[]> = { read: [DECRYPT_ROLE], write: [ENCRYPT_ROLE], "read-write": [ENCRYPT_ROLE, DECRYPT_ROLE] };

export function readSession() {
  const s = getSession();
  return { tideUserKey: "walkthrough", realmRoles: s.realmRoles, groups: s.groups, canEncrypt: s.realmRoles.includes(ENCRYPT_ROLE), canDecrypt: s.realmRoles.includes(DECRYPT_ROLE) };
}

export async function signRelationshipPolicy(grant: { vendorId: string; subject: RelationshipSubject; recordId: string; access: RelationshipAccess }, _adminPolicy: Uint8Array) {
  await pause(900); // the admin "approves in their enclave"
  return btoa(JSON.stringify({ sim: true, contract: RELATIONSHIP_CONTRACT_ID, recordId: grant.recordId, subject: grant.subject, roles: ROLES_FOR[grant.access] }));
}

export async function encryptForRecord(data: string, recordId: string, signedPolicyB64: string) {
  await pause(500);
  check(parsePolicy(signedPolicyB64), [recordId], "encrypt");
  return sealData(data, recordId);
}

export async function decryptForRecord(encrypted: string, recordId: string, signedPolicyB64: string) {
  await pause(500);
  check(parsePolicy(signedPolicyB64), [recordId], "decrypt");
  return openData(encrypted, recordId);
}

export function describeRelationshipPolicy(signedPolicyB64: string) {
  const p = parsePolicy(signedPolicyB64);
  return { contractId: p.contract, subjectType: p.subject.type, subjectId: p.subject.id, clientId: "", recordId: p.recordId, roles: JSON.stringify(p.roles), signed: true, isRelationshipPolicy: true };
}
