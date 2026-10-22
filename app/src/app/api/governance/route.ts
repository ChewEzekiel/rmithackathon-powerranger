import { withAuth } from "@/lib/auth/middleware";
import { listChangeRequests } from "@/lib/kcAdmin";
import { readStore } from "@/lib/store";

// GET /api/governance - pending change requests straight from TideCloak, plus the app's audit trail.
export const GET = withAuth(async () => {
  const pending = await listChangeRequests("PENDING");
  return Response.json({ pending, audit: readStore().audit.slice(0, 30) });
});
