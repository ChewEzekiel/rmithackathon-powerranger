"use client";

import { useCallback, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { Shell, useMe } from "../Shell";
import { useApi, decryptAll, tideError } from "@/lib/client";
import { encryptForRecord, signRelationshipPolicy } from "@/lib/tide/relationship";
import { findRoom, groupPath } from "@/lib/rooms";
import tcConfig from "../../../data/tidecloak.json";

interface Post { id: string; authorName: string; institution: string; kind: string; ciphertext: string; createdAt: string }
type Plain = { title: string; body: string };

function RoomView({ id }: { id: string }) {
  const room = findRoom(id);
  const api = useApi();
  const { me } = useMe();
  const { logout } = useTideCloak();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [policy, setPolicy] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "member" | "outsider">("loading");
  const [plain, setPlain] = useState<Record<string, Plain>>({});
  const [status, setStatus] = useState<{ kind: "" | "ok" | "bad"; msg: string }>({ kind: "", msg: "" });
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ kind: "finding", title: "", body: "" });

  const load = useCallback(async () => {
    try {
      const r = await api(`/api/posts?room=${id}`);
      setPosts(r.posts);
      setState("member");
      const p = await api(`/api/policy?room=${id}`).catch(() => null);
      setPolicy(p?.policy || null);
    } catch (e) {
      if ((e as { status?: number }).status === 403) setState("outsider");
      else setStatus({ kind: "bad", msg: (e as Error).message });
    }
  }, [api, id]);
  useEffect(() => { load(); }, [load]);

  if (!room) return <p className="status bad">Unknown room.</p>;

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(true);
    setStatus({ kind: "", msg: label });
    try { setStatus({ kind: "ok", msg: (await fn()) || "Done." }); }
    catch (e) { setStatus({ kind: "bad", msg: tideError(e) }); }
    finally { setBusy(false); }
  };

  const join = () => run("Asking TideCloak to add you...", async () => {
    const r = await api("/api/join", { method: "POST", body: JSON.stringify({ room: id }) });
    return r.status === 202
      ? "Change request filed (HTTP 202). Nothing is granted until the consortium's admins approve it in their Tide enclaves - see Governance."
      : `TideCloak answered HTTP ${r.status}: ${JSON.stringify(r.body)}`;
  });

  // Realm admin, once per room: sign a RelationshipAttestation:1 policy naming the room's group.
  // Must run straight from the click: it opens the Tide enclave pop-up.
  const seal = () => run("Opening your Tide enclave to sign the room policy...", async () => {
    const { policy: adminB64 } = await api(`/api/policy?room=${id}&admin=1`);
    const adminBytes = Uint8Array.from(atob(adminB64), (c) => c.charCodeAt(0));
    const signed = await signRelationshipPolicy(
      { vendorId: (tcConfig as { vendorId: string }).vendorId, subject: { type: "Group", id: groupPath(id) }, recordId: id, access: "read-write" },
      adminBytes,
    );
    await api("/api/policy", { method: "POST", body: JSON.stringify({ room: id, policy: signed }) });
    await load();
    return "Room sealed. From now on the Tide network decides who can read or write it.";
  });

  const publish = () => run("Encrypting in your browser via the Tide network...", async () => {
    if (!policy) throw new Error("Room is not sealed yet");
    const ciphertext = await encryptForRecord(JSON.stringify({ title: draft.title, body: draft.body }), id, policy);
    await api("/api/posts", { method: "POST", body: JSON.stringify({ room: id, kind: draft.kind, ciphertext }) });
    setDraft({ kind: draft.kind, title: "", body: "" });
    await load();
    return "Encrypted and posted. The server stored ciphertext only.";
  });

  const openAll = () => run("Asking the Tide network to decrypt for you...", async () => {
    if (!posts?.length || !policy) return "Nothing to decrypt.";
    const out = await decryptAll(posts.map((p) => p.ciphertext), id, policy);
    setPlain(Object.fromEntries(posts.map((p, i) => [p.id, JSON.parse(out[i])])));
    return `Decrypted ${out.length} post(s) in your browser.`;
  });

  return (
    <div className="stack">
      <a href="/rooms" className="small">← All rooms</a>
      <h1>{room.title}</h1>
      <p style={{ margin: 0 }}>{room.question}</p>
      <div className="row">
        {room.institutions.map((i) => <span key={i} className="chip">{i}</span>)}
        {state === "member" && (policy ? <span className="chip ok">Network-enforced policy</span> : <span className="chip warn">Not sealed yet</span>)}
      </div>
      {status.msg && <p className={`status ${status.kind}`}>{status.msg}</p>}

      {state === "outsider" && (
        <div className="card stack">
          <h2>You are not in this room</h2>
          <p className="muted">Membership is decided by the consortium, not by us. Requesting access files a governed change request in TideCloak that institution admins must approve.</p>
          <div className="row">
            <button className="btn" onClick={join} disabled={busy}>Request to join</button>
            <button className="btn ghost" onClick={logout}>Approved? Sign in again to pick up access</button>
          </div>
        </div>
      )}

      {state === "member" && !policy && (
        <div className="card stack">
          <h2>This room has no access policy yet</h2>
          <p className="muted">A realm admin signs the room&apos;s policy once, in their Tide enclave. It names the group <code>{groupPath(id)}</code>; after that the network itself refuses anyone outside it.</p>
          {me?.isAdmin ? <button className="btn" onClick={seal} disabled={busy}>Seal room policy</button> : <p className="small muted">Waiting for a realm admin.</p>}
        </div>
      )}

      {state === "member" && policy && (
        <div className="card stack">
          <h2>Share with the consortium</h2>
          <div className="row">
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} style={{ width: 160 }}>
              <option value="finding">Finding</option><option value="dataset">Dataset</option><option value="question">Question</option>
            </select>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" style={{ flex: 1, width: "auto" }} />
          </div>
          <textarea rows={4} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Pre-publication result, data summary or question for the other labs..." />
          <div className="row">
            <button className="btn" onClick={publish} disabled={busy || !draft.title.trim() || !draft.body.trim()}>Encrypt &amp; post</button>
            <span className="muted small">Encrypted in your browser. Tagged with this room only.</span>
          </div>
        </div>
      )}

      {state === "member" && posts && (
        <div className="stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Thread ({posts.length})</h2>
            {posts.length > 0 && policy && <button className="btn ghost" onClick={openAll} disabled={busy}>Decrypt thread</button>}
          </div>
          {posts.length === 0 && <p className="muted">No posts yet.</p>}
          {[...posts].reverse().map((p) => (
            <div key={p.id} className="card stack">
              <div className="row">
                <span className="chip">{p.kind}</span>
                <strong>{p.authorName}</strong>
                <span className="muted small">{p.institution} · {new Date(p.createdAt).toLocaleString()}</span>
              </div>
              {plain[p.id] ? (
                <div className="plain"><h3>{plain[p.id].title}</h3><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{plain[p.id].body}</p></div>
              ) : (
                <div className="cipher">{p.ciphertext}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoomPage() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => setId(new URLSearchParams(window.location.search).get("id") || ""), []);
  return id === null ? null : <RoomView id={id} />;
}

export default function Page() {
  return <Shell active="/rooms"><RoomPage /></Shell>;
}
