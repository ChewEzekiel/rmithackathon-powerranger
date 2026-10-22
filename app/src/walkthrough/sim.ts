// Walkthrough-mode stand-ins for the Tide network (client side). Mirrors the checks the ORKs run for
// the built-in RelationshipAttestation:1 contract, with the same refusal messages, so the demo shows
// the real decision logic. Simulated: keys are derived locally, nothing is threshold-enforced.
export const ENCRYPT_ROLE = "_tide_encryptor";
export const DECRYPT_ROLE = "_tide_decryptor";

let session: { realmRoles: string[]; groups: string[] } = { realmRoles: [], groups: [] };
export const setSession = (me: { realmRoles?: string[]; groups?: string[] }) => {
  session = { realmRoles: me.realmRoles || [], groups: me.groups || [] };
};
export const getSession = () => session;

type SimPolicy = { sim: true; contract: string; recordId: string; subject: { type: string; id: string }; roles: string[] };
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// A policy arrives as base64 (relationship helpers) or as the decoded bytes (IAMService.doDecrypt).
export const parsePolicy = (p: string | Uint8Array): SimPolicy => JSON.parse(typeof p === "string" ? atob(p) : new TextDecoder().decode(p));

function refusal(msg: string) {
  return Object.assign(new Error("TIDE-TIDEJS-NET-THRESHOLD_FAILURE: Could not reach enough VVK ORKs (walkthrough simulation)"), { cause: { message: msg } });
}

export function check(policy: SimPolicy, tags: string[], op: "encrypt" | "decrypt") {
  const need = op === "encrypt" ? ENCRYPT_ROLE : DECRYPT_ROLE;
  if (tags.length !== 1 || tags[0] !== policy.recordId) throw refusal("Tags do not contain assignmentId.");
  if (!policy.roles.includes(need)) throw refusal(`${need} not found in list of roles.`);
  if (!session.realmRoles.includes(need)) throw refusal(`'${need}' role not found for this ${op === "encrypt" ? "encryption" : "decryption"} request.`);
  const s = policy.subject;
  if (s.type === "Group" && !session.groups.includes(s.id)) throw refusal(`'${s.id}' group not found in doken.`);
  if (s.type === "Role" && !session.realmRoles.includes(s.id)) throw refusal(`'${s.id}' role not found in doken: subjectId does not match.`);
}

async function key(recordId: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`treaty-room-walkthrough:${recordId}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealData(data: string, recordId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(recordId), enc.encode(data)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return b64(out);
}
export async function openData(ciphertext: string, recordId: string) {
  const all = unb64(ciphertext);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await key(recordId), all.slice(12));
  return new TextDecoder().decode(pt);
}
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
