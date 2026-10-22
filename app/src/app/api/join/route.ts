import { withAuth } from "@/lib/auth/middleware";
import { readStore, audit } from "@/lib/store";
import { findRoom, groupPath } from "@/lib/rooms";
import { proposeMembership } from "@/lib/kcAdmin";

// POST /api/join {room} - the platform asks TideCloak (with the master-admin key) to add the caller.
// With quorum-enforced governance this grants nothing: it files a change request.
export const POST = withAuth(async (req, jwt) => {
  const { room } = await req.json();
  if (!findRoom(room)) return Response.json({ error: "Unknown room" }, { status: 404 });
  const r = await proposeMembership(jwt.sub!, groupPath(room));
  const who = readStore().profiles[jwt.sub!]?.name || "a researcher";
  audit(who, `requested to join ${room} (TideCloak answered HTTP ${r.status})`);
  return Response.json({ status: r.status, body: r.body });
});
