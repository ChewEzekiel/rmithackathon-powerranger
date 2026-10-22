import { withAuth } from "@/lib/auth/middleware";
import { readStore, updateStore, audit } from "@/lib/store";
import { findRoom } from "@/lib/rooms";
import { isMember } from "@/lib/claims";

// POST /api/join {room} - records a request to join. It grants nothing: an institution admin turns it
// into a TideCloak change request from their own browser, and a quorum must sign it.
export const POST = withAuth(async (req, jwt) => {
  const { room } = await req.json();
  if (!findRoom(room)) return Response.json({ error: "Unknown room" }, { status: 404 });
  if (isMember(jwt, room)) return Response.json({ error: "Already a member" }, { status: 409 });
  const s = readStore();
  const who = s.profiles[jwt.sub!]?.name || "a researcher";
  if (!s.joinRequests.some((j) => j.sub === jwt.sub && j.roomId === room)) {
    updateStore((st) => { st.joinRequests.push({ sub: jwt.sub!, name: who, institution: s.profiles[jwt.sub!]?.institution || "", roomId: room, at: new Date().toISOString() }); });
    audit(who, `asked to join ${room}`);
  }
  return Response.json({ ok: true });
});
