"use client";

import { useEffect, useState } from "react";
import { Shell } from "../Shell";
import { useApi } from "@/lib/client";
import type { Room } from "@/lib/rooms";

type RoomRow = Room & { member: boolean; hasWritePolicy: boolean; hasReadPolicy: boolean; posts: number };

function Rooms() {
  const api = useApi();
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { api("/api/rooms").then((r) => setRooms(r.rooms)).catch((e) => setErr(e.message)); }, [api]);
  return (
    <div className="stack">
      <h1>Research rooms</h1>
      <p className="muted">Anyone can see a room exists. Only members approved by the consortium can read it, and that is enforced by the Tide network.</p>
      {err && <p className="status bad">{err}</p>}
      <div className="grid">
        {rooms.map((r) => (
          <a key={r.id} href={`/room?id=${r.id}`} className="card stack" style={{ color: "inherit" }}>
            <div className="row">
              {r.member ? <span className="chip ok">Member</span> : <span className="chip">Not a member</span>}
              {r.hasWritePolicy && r.hasReadPolicy ? <span className="chip ok">Network-enforced policies</span> : <span className="chip warn">Policies not signed yet</span>}
              <span className="chip">{r.posts} encrypted posts</span>
            </div>
            <h2>{r.title}</h2>
            <p style={{ margin: 0 }}>{r.question}</p>
            <p className="muted small" style={{ margin: 0 }}>{r.institutions.join(" · ")}</p>
            <p className="muted small" style={{ margin: 0 }}>Protects: {r.sensitivity}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  return <Shell active="/rooms"><Rooms /></Shell>;
}
