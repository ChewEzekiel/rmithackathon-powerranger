import { withAuth } from "@/lib/auth/middleware";
import { readStore, updateStore, audit } from "@/lib/store";
import { findRoom } from "@/lib/rooms";
import { isMember, isRealmAdmin } from "@/lib/claims";
import { adminPolicy } from "@/lib/kcAdmin";

// GET /api/policy?room=x          -> the room's signed policies {write, read}, only to members
// GET /api/policy?room=x&admin=1  -> the realm admin policy bytes, only to realm admins (to sign a room)
export const GET = withAuth(async (req, jwt) => {
  const u = new URL(req.url);
  const room = u.searchParams.get("room") || "";
  if (!findRoom(room)) return Response.json({ error: "Unknown room" }, { status: 404 });
  if (u.searchParams.get("admin")) {
    if (!isRealmAdmin(jwt)) return Response.json({ error: "Realm admins only" }, { status: 403 });
    const r = await adminPolicy();
    const policy = (r.body as { policy?: string })?.policy;
    if (!policy) return Response.json({ error: `No admin policy (${r.status})` }, { status: 502 });
    return Response.json({ policy });
  }
  if (!isMember(jwt, room)) return Response.json({ error: "Not a member of this room" }, { status: 403 });
  const p = readStore().policies[room];
  if (!p) return Response.json({ error: "Room not sealed yet" }, { status: 404 });
  return Response.json(p);
});

// POST /api/policy {room, kind: "write"|"read", policy} - a realm admin stores a policy they just signed
// in their enclave. A stored policy is never replaced: changing a room's rules is not a single-admin act.
export const POST = withAuth(async (req, jwt) => {
  if (!isRealmAdmin(jwt)) return Response.json({ error: "Realm admins only" }, { status: 403 });
  const { room, kind, policy } = await req.json();
  if (!findRoom(room)) return Response.json({ error: "Unknown room" }, { status: 404 });
  if (kind !== "write" && kind !== "read") return Response.json({ error: "kind must be write or read" }, { status: 400 });
  if (typeof policy !== "string" || !policy || policy.length > 20_000) return Response.json({ error: "Missing policy" }, { status: 400 });
  const s = readStore();
  if (s.policies[room]?.[kind as "write" | "read"]) return Response.json({ error: `The ${kind} policy for this room is already signed` }, { status: 409 });
  const who = s.profiles[jwt.sub!]?.name || "realm admin";
  updateStore((st) => {
    st.policies[room] = { ...(st.policies[room] || { sealedBy: who, sealedAt: new Date().toISOString() }), [kind]: policy };
  });
  audit(who, `signed the ${kind === "write" ? "deposit" : "reading"} policy of ${room}`);
  return Response.json({ ok: true });
});
