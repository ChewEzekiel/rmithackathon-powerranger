import { withAuth } from "@/lib/auth/middleware";
import { isRealmAdmin } from "@/lib/claims";
import { audit } from "@/lib/store";
import { WALKTHROUGH, PERSONAS, wtApprove } from "@/walkthrough/server";

// POST /api/wt/approve {id} - walkthrough stand-in for an admin signing a change request in their Tide enclave.
export const POST = withAuth(async (req, jwt) => {
  if (!WALKTHROUGH) return Response.json({ error: "Walkthrough mode is off" }, { status: 404 });
  if (!isRealmAdmin(jwt)) return Response.json({ error: "Realm admins only" }, { status: 403 });
  const { id } = await req.json();
  const r = wtApprove(String(id), jwt.sub!);
  if (!r) return Response.json({ error: "No such pending change request" }, { status: 404 });
  const who = PERSONAS[jwt.sub!]?.name || String(jwt.sub);
  audit(who, r.committed ? `co-signed change ${String(id).slice(0, 8)}: quorum reached (${r.authorizationCount} of ${r.threshold}), committed` : `signed change ${String(id).slice(0, 8)} (${r.authorizationCount} of ${r.threshold})`);
  return Response.json(r);
});
