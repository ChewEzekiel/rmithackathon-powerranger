import { withAuth } from "@/lib/auth/middleware";
import { readStore, audit } from "@/lib/store";
import { listChangeRequests, operatorForceApprove } from "@/lib/kcAdmin";
import { isRealmAdmin } from "@/lib/claims";

// RED TEAM DEMO, off unless DEMO_RED_TEAM=1, so a deployment never exposes these by accident.
const enabled = () => process.env.DEMO_RED_TEAM === "1";

// GET /api/operator - exactly what the platform operator (or anyone who steals the database) sees.
export const GET = withAuth(async () => {
  if (!enabled()) return Response.json({ error: "Operator view disabled (set DEMO_RED_TEAM=1)" }, { status: 403 });
  return Response.json(readStore());
});

// POST /api/operator {id?} - the operator, holding the TideCloak master-admin password, tries to approve
// a pending change request on its own; TideCloak's answer is returned verbatim. Realm admins only.
export const POST = withAuth(async (req, jwt) => {
  if (!enabled()) return Response.json({ error: "Red-team demo disabled (set DEMO_RED_TEAM=1)" }, { status: 403 });
  if (!isRealmAdmin(jwt)) return Response.json({ error: "Realm admins only" }, { status: 403 });
  const { id } = await req.json().catch(() => ({}));
  if (id !== undefined && (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id))) return Response.json({ error: "Invalid id" }, { status: 400 });
  const target = id || (await listChangeRequests("PENDING"))[0]?.id;
  if (!target) return Response.json({ error: "No pending change request to force" }, { status: 404 });
  const result = await operatorForceApprove(String(target));
  audit("Platform operator", `tried to force-approve change request ${String(target).slice(0, 8)} with the master-admin key`);
  return Response.json({ id: target, ...result });
});
