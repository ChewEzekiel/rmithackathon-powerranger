import { loadTideConfig } from "./auth/tidecloakConfig";

// The platform operator's own credentials: the TideCloak master-admin password from .env.
// We give our server this "god key" on purpose, to show what it can NOT do: with IGA in Tide
// mode, every access change it makes is only a proposal until institution admins approve it
// in their Tide enclaves. It cannot approve its own proposals.
function base() {
  const c = loadTideConfig();
  return { url: c["auth-server-url"].replace(/\/+$/, ""), realm: c.realm };
}

async function masterToken(): Promise<string> {
  const user = process.env.KC_BOOTSTRAP_ADMIN_USERNAME || "admin";
  const pass = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;
  if (!pass) throw new Error("KC_BOOTSTRAP_ADMIN_PASSWORD missing in .env");
  const { url } = base();
  // Master tokens live ~60s: mint per operation.
  const res = await fetch(`${url}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "admin-cli", grant_type: "password", username: user, password: pass }),
  });
  if (!res.ok) throw new Error(`master token failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function admin(path: string, init: RequestInit = {}) {
  const { url, realm } = base();
  const res = await fetch(`${url}/admin/realms/${realm}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await masterToken()}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body };
}

/** Ask TideCloak to add a user to a room group. Under IGA this returns a pending change request. */
export async function proposeMembership(userId: string, groupPath: string) {
  const g = await admin(`/group-by-path${groupPath}`);
  const groupId = (g.body as { id?: string })?.id;
  if (!groupId) throw new Error(`group ${groupPath} not found (${g.status})`);
  return admin(`/users/${userId}/groups/${groupId}`, { method: "PUT" });
}

export async function listChangeRequests(status = "PENDING") {
  const r = await admin(`/iga/change-requests?status=${status}`);
  return Array.isArray(r.body) ? (r.body as Record<string, unknown>[]) : [];
}

/** The operator tries to push a change request through on its own. Returns TideCloak's answer verbatim. */
export async function operatorForceApprove(id: string) {
  const authorize = await admin(`/iga/change-requests/${id}/authorize`, { method: "POST", body: "{}" });
  const commit = await admin(`/iga/change-requests/${id}/commit`, { method: "POST" });
  return { authorize, commit };
}

export async function userGroups(userId: string) {
  const r = await admin(`/users/${userId}/groups`);
  return Array.isArray(r.body) ? (r.body as { path: string }[]).map((g) => g.path) : [];
}

/** The realm's signed admin policy, needed to authorise signing a room policy. */
export async function adminPolicy() {
  const r = await admin(`/iga/role-policies/name/tide-realm-admin`);
  return r;
}
