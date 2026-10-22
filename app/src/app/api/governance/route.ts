import { withAuth } from "@/lib/auth/middleware";
import { listChangeRequests } from "@/lib/kcAdmin";
import { readStore } from "@/lib/store";

// GET /api/governance - pending change requests straight from TideCloak, join requests and the audit trail.
export const GET = withAuth(async () => {
  const pending = await listChangeRequests("PENDING").catch(() => []);
  const s = readStore();
  return Response.json({ pending, joinRequests: s.joinRequests, audit: s.audit.slice(0, 30) });
});
