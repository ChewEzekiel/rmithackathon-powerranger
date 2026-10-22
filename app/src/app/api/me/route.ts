import { withAuth } from "@/lib/auth/middleware";
import { readStore, updateStore, audit } from "@/lib/store";
import { INSTITUTIONS } from "@/lib/rooms";
import { groupsOf, isRealmAdmin } from "@/lib/claims";

// GET /api/me - who the verified token says you are, plus your in-app profile.
export const GET = withAuth(async (_req, jwt) => {
  const profile = readStore().profiles[jwt.sub!] || null;
  const realmRoles = ((jwt.realm_access as { roles?: string[] } | undefined)?.roles) || [];
  return Response.json({ sub: jwt.sub, profile, groups: groupsOf(jwt), realmRoles, isAdmin: isRealmAdmin(jwt) });
});

// POST /api/me {name, institution} - Tide gives accounts no name, so users introduce themselves here.
export const POST = withAuth(async (req, jwt) => {
  const { name, institution } = await req.json();
  if (typeof name !== "string" || !name.trim() || name.length > 80) return Response.json({ error: "Invalid name" }, { status: 400 });
  if (!INSTITUTIONS.includes(institution)) return Response.json({ error: "Unknown institution" }, { status: 400 });
  const profile = { sub: jwt.sub!, name: name.trim(), institution };
  updateStore((s) => { s.profiles[jwt.sub!] = profile; });
  audit(profile.name, `joined Treaty Room from ${institution}`);
  return Response.json({ profile });
});
