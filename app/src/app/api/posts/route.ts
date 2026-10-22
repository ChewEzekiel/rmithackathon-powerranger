import { randomUUID } from "crypto";
import { withAuth } from "@/lib/auth/middleware";
import { readStore, updateStore, audit, type Post } from "@/lib/store";
import { findRoom } from "@/lib/rooms";
import { isMember } from "@/lib/claims";

// Membership here only decides who may FETCH ciphertext. Whether anyone can READ it is decided
// by the Tide network against the room's signed policy: a server bug or a rogue operator
// handing out ciphertext still gives away nothing.
export const GET = withAuth(async (req, jwt) => {
  const roomId = new URL(req.url).searchParams.get("room") || "";
  if (!findRoom(roomId)) return Response.json({ error: "Unknown room" }, { status: 404 });
  if (!isMember(jwt, roomId)) return Response.json({ error: "Not a member of this room" }, { status: 403 });
  return Response.json({ posts: readStore().posts.filter((p) => p.roomId === roomId) });
});

export const POST = withAuth(async (req, jwt) => {
  const { room, kind, ciphertext } = await req.json();
  if (!findRoom(room)) return Response.json({ error: "Unknown room" }, { status: 404 });
  if (!isMember(jwt, room)) return Response.json({ error: "Not a member of this room" }, { status: 403 });
  if (!["finding", "dataset", "question"].includes(kind)) return Response.json({ error: "Invalid kind" }, { status: 400 });
  if (typeof ciphertext !== "string" || !ciphertext || ciphertext.length > 200_000) return Response.json({ error: "Invalid ciphertext" }, { status: 400 });
  const profile = readStore().profiles[jwt.sub!];
  const post: Post = {
    id: randomUUID(), roomId: room, authorSub: jwt.sub!, authorName: profile?.name || "Unnamed researcher",
    institution: profile?.institution || "Unknown", kind, ciphertext, createdAt: new Date().toISOString(),
  };
  updateStore((s) => { s.posts.push(post); });
  audit(post.authorName, `posted an encrypted ${kind} to ${room}`);
  return Response.json({ post }, { status: 201 });
});
