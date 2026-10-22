"use client";

import { useEffect, useState } from "react";
import { CheckCircle, LockKeyOpen, Tray, WarningCircle } from "@phosphor-icons/react";
import { Shell } from "../Shell";
import { useApi, decryptAll, tideError } from "@/lib/client";

const ic = { size: 15, weight: "regular", "aria-hidden": true } as const;

interface Dump {
  posts: { id: string; roomId: string; authorName: string; institution: string; kind: string; ciphertext: string; createdAt: string }[];
  policies: Record<string, { write?: string; read?: string; sealedBy: string; sealedAt: string }>;
  profiles: Record<string, unknown>;
}

// The platform operator's view: the whole database, handed over. Then we try to use it.
function Operator() {
  const api = useApi();
  const [dump, setDump] = useState<Dump | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [err, setErr] = useState("");
  useEffect(() => { api("/api/operator").then(setDump).catch((e) => setErr(e.message)); }, [api]);

  const attempt = async (p: Dump["posts"][number]) => {
    const pol = dump?.policies[p.roomId]?.read;
    if (!pol) return setResult((r) => ({ ...r, [p.id]: { ok: false, msg: "No reading policy for this room" } }));
    try {
      const [out] = await decryptAll([p.ciphertext], p.roomId, pol);
      setResult((r) => ({ ...r, [p.id]: { ok: true, msg: `Decrypted - you are a member of ${p.roomId}: ${out.slice(0, 120)}` } }));
    } catch (e) {
      setResult((r) => ({ ...r, [p.id]: { ok: false, msg: `Tide network refused: ${tideError(e)}` } }));
    }
  };

  return (
    <div className="stack">
      <h1>What the platform sees</h1>
      <p className="lede">
        This page plays a rogue operator or an attacker who stole our database. You get every byte we store: posts, signed
        room policies and profiles. Try to read a post with it. The Tide network checks your identity against the room
        policy and refuses unless the consortium let you in.
      </p>
      {err && <p className="status bad"><WarningCircle {...ic} /><span>{err}</span></p>}
      {dump && (
        <>
          <div className="card stack">
            <h2>Encrypted posts in our database ({dump.posts.length})</h2>
            {dump.posts.length === 0 && <div className="empty"><Tray size={18} weight="regular" aria-hidden /><p>No posts yet.</p></div>}
            {dump.posts.map((p) => (
              <div key={p.id} className="stack entry">
                <div className="row small">
                  <span className="chip">{p.roomId}</span>
                  <strong>{p.authorName}</strong>
                  <span className="muted">{p.institution}</span>
                  <span className="muted">{p.kind}</span>
                  <time className="muted">{new Date(p.createdAt).toLocaleString()}</time>
                </div>
                <div className="cipher">{p.ciphertext}</div>
                <div className="row">
                  <button className="btn ghost" onClick={() => attempt(p)}><LockKeyOpen {...ic} /> Try to decrypt with the stolen data</button>
                </div>
                {result[p.id] && (
                  <p className={`status ${result[p.id].ok ? "ok" : "bad"}`} role="status">
                    {result[p.id].ok ? <CheckCircle {...ic} /> : <WarningCircle {...ic} />}
                    <span>{result[p.id].msg}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="card stack">
            <h2>Raw database file</h2>
            <p className="muted small">Metadata (who posted, when) is visible to us; content never is.</p>
            <pre className="json">{JSON.stringify(dump, null, 2)}</pre>
          </div>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return <Shell active="/operator"><Operator /></Shell>;
}
