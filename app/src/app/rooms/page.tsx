"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, ShieldCheck, Warning } from "@phosphor-icons/react";
import { Shell } from "../Shell";
import { useApi } from "@/lib/client";
import type { Room } from "@/lib/rooms";

type RoomRow = Room & { member: boolean; hasWritePolicy: boolean; hasReadPolicy: boolean; posts: number };

const ic = { size: 13, weight: "regular", "aria-hidden": true } as const;

function Rooms() {
  const api = useApi();
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { api("/api/rooms").then((r) => setRooms(r.rooms)).catch((e) => setErr(e.message)); }, [api]);
  return (
    <div className="stack">
      <h1>Research rooms</h1>
      <p className="lede">Anyone can see a room exists. Only members approved by the consortium can read it, and that is enforced by the Tide network.</p>
      {err && <p className="status bad">{err}</p>}
      <div className="grid" aria-busy={rooms.length === 0 && !err}>
        {rooms.length === 0 && !err && [0, 1].map((i) => (
          <div key={i} className="card stack skel" aria-hidden="true">
            <div className="bar t" /><div className="bar w" /><div className="bar s" />
          </div>
        ))}
        {rooms.map((r) => (
          <a key={r.id} href={`/room?id=${r.id}`} className="card stack room-card">
            <div className="row split">
              <h2>{r.title}</h2>
              <ArrowUpRight size={18} weight="regular" aria-hidden className="go" />
            </div>
            <p>{r.question}</p>
            <p className="muted small">{r.institutions.join(", ")}</p>
            <p className="muted small">Protects: {r.sensitivity}</p>
            <div className="row">
              {r.member ? <span className="chip ok">Member</span> : <span className="chip">Not a member</span>}
              {r.hasWritePolicy && r.hasReadPolicy ? <span className="chip ok"><ShieldCheck {...ic} /> Network-enforced policies</span> : <span className="chip warn"><Warning {...ic} /> Policies not signed yet</span>}
              <span className="chip">{r.posts} encrypted posts</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  return <Shell active="/rooms"><Rooms /></Shell>;
}
