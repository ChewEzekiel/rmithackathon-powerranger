import { loadTideConfig } from "./auth/tidecloakConfig";

// Server-side READ access to TideCloak's change-request list, plus one red-team endpoint.
// The master-admin password (from .env) is the platform operator's "god key". We use it for reads,
// and in operatorForceApprove to show what it can NOT do: in Tide multi-admin mode, approvals must
// be enclave signatures from the institution admins' own browsers.
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

export async function listChangeRequests(status = "PENDING") {
  const r = await admin(`/iga/change-requests?status=${status}`);
  return Array.isArray(r.body) ? (r.body as Record<string, unknown>[]) : [];
}

/** Red team: the operator tries to push a change request through with the master key. Answer returned verbatim. */
export async function operatorForceApprove(id: string) {
  const authorize = await admin(`/iga/change-requests/${id}/authorize`, { method: "POST", body: "{}" });
  const commit = await admin(`/iga/change-requests/${id}/commit`, { method: "POST" });
  return { authorize, commit };
}

/** The realm's signed admin policy, needed to authorise signing a room policy. */
export async function adminPolicy() {
  return admin(`/iga/role-policies/name/tide-realm-admin`);
}
