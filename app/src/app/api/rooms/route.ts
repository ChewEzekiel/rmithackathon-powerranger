import { withAuth } from "@/lib/auth/middleware";
import { readStore } from "@/lib/store";
import { ROOMS } from "@/lib/rooms";
import { isMember } from "@/lib/claims";

// GET /api/rooms - every room is listed (its existence is not secret), its contents are.
export const GET = withAuth(async (_req, jwt) => {
  const s = readStore();
  const rooms = ROOMS.map((r) => ({
    ...r,
    member: isMember(jwt, r.id),
    hasWritePolicy: !!s.policies[r.id]?.write,
    hasReadPolicy: !!s.policies[r.id]?.read,
    posts: s.posts.filter((p) => p.roomId === r.id).length,
  }));
  return Response.json({ rooms });
});
