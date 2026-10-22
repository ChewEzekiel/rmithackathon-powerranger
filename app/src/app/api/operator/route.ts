import { withAuth } from "@/lib/auth/middleware";
import { readStore, audit } from "@/lib/store";
import { listChangeRequests, operatorForceApprove } from "@/lib/kcAdmin";

// GET /api/operator - exactly what the platform operator (or anyone who steals the database) sees.
export const GET = withAuth(async () => Response.json(readStore()));

// POST /api/operator {id?} - the operator, holding the TideCloak master-admin password, tries to
// approve a pending access request on its own. TideCloak's answer is returned verbatim.
export const POST = withAuth(async (req) => {
  const { id } = await req.json().catch(() => ({}));
  const target = id || (await listChangeRequests("PENDING"))[0]?.id;
  if (!target) return Response.json({ error: "No pending change request to force" }, { status: 404 });
  const result = await operatorForceApprove(String(target));
  audit("Platform operator", `tried to force-approve change request ${String(target).slice(0, 8)} with the master-admin key`);
  return Response.json({ id: target, ...result });
});
