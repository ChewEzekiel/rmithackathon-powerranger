import { withAuth } from "@/lib/auth/middleware";
import { isRealmAdmin } from "@/lib/claims";
import { WALKTHROUGH, PERSONAS, wtFile } from "@/walkthrough/server";

// Walkthrough stand-in for the few TideCloak admin endpoints the Governance page calls from an
// admin's browser. Like real TideCloak under IGA, every governed write returns 202 + a change request.
const handle = withAuth(async (req, jwt) => {
  if (!WALKTHROUGH) return Response.json({ error: "Walkthrough mode is off" }, { status: 404 });
  if (!isRealmAdmin(jwt)) return Response.json({ error: "Realm admins only" }, { status: 403 });
  const path = new URL(req.url).pathname.replace(/^\/api\/wt\/kc/, "");
  const who = PERSONAS[jwt.sub!]?.name || String(jwt.sub);
  let m;
  if (req.method === "GET" && (m = path.match(/^\/group-by-path\/rooms\/([\w-]+)$/))) return Response.json({ id: m[1], path: `/rooms/${m[1]}` });
  if (req.method === "GET" && (m = path.match(/^\/roles\/([\w.-]+)$/))) return Response.json({ name: m[1] });
  if (req.method === "POST" && (m = path.match(/^\/groups\/([\w-]+)\/role-mappings\/realm$/))) {
    const roles = ((await req.json()) as { name: string }[]).map((r) => r.name);
    const cr = wtFile({ actionType: "GRANT_ROLES", entityType: "GROUP", description: `Map ${roles.join(" + ")} onto /rooms/${m[1]}`, requestedBy: who, apply: { kind: "groupRoles", group: `/rooms/${m[1]}`, roles } });
    return Response.json({ status: "PENDING", changeRequestId: cr.id, message: "Change request created - awaiting approval" }, { status: 202 });
  }
  if (req.method === "PUT" && (m = path.match(/^\/users\/([\w-]+)\/groups\/([\w-]+)$/))) {
    const cr = wtFile({ actionType: "ADD_GROUP_MEMBER", entityType: "USER", description: `Admit ${PERSONAS[m[1]]?.name || m[1]} to /rooms/${m[2]}`, requestedBy: who, apply: { kind: "member", group: `/rooms/${m[2]}`, sub: m[1] } });
    return Response.json({ status: "PENDING", changeRequestId: cr.id, message: "Change request created - awaiting approval" }, { status: 202 });
  }
  return Response.json({ error: `Not simulated: ${req.method} ${path}` }, { status: 404 });
});

export const GET = handle;
export const POST = handle;
export const PUT = handle;
