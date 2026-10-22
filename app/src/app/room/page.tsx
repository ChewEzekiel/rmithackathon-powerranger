"use client";

import { useCallback, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { ArrowLeft, ArrowsClockwise, CheckCircle, CircleNotch, LockKey, LockKeyOpen, Scales, Tray, WarningCircle } from "@phosphor-icons/react";
import { Shell, useMe } from "../Shell";
import { useApi, decryptAll, tideError } from "@/lib/client";
import { encryptForRecord, signRelationshipPolicy, readSession, DECRYPT_ROLE, ENCRYPT_ROLE, type RelationshipSubject, type RelationshipAccess } from "@/lib/tide/relationship";
import { findRoom, groupPath, readerRole } from "@/lib/rooms";
import tcConfig from "../../../data/tidecloak.json";

interface Post { id: string; authorName: string; institution: string; kind: string; ciphertext: string; createdAt: string }
type Plain = { title: string; body: string };
type Opened = { ok: true; plain: Plain } | { ok: false; msg: string };
type Policies = { write?: string; read?: string };

const EXAMPLES: Record<string, { kind: string; title: string; body: string }> = {
  "Northbridge University": { kind: "finding", title: "NB-17 stopped: liver enzymes up at 40 mg", body: "Phase I (n=48). ALT > 3x ULN in 6/24 on the 40 mg arm by week 6. Target engagement fine. We are not publishing; sharing so nobody repeats this dose." },
  "Helix Therapeutics": { kind: "dataset", title: "HX-221 failed futility: hepatic signal", body: "Phase IIa (n=120). p-tau217 fell 18% but missed futility at week 24. Transaminase rise in 9% of the high-dose arm, same window as other BACE-adjacent compounds." },
  "St Aurelia Hospital": { kind: "finding", title: "Blood p-tau217 agrees with PET in 91% of our cohort", body: "AUREL-AD-300 memory clinic cohort (n=300). Agreement with amyloid PET was 91% at the 0.42 pg/mL cut-off. Weakest in over-80s with kidney disease." },
  "Sunway Institute": { kind: "question", title: "Anyone else seeing day-3 fever spikes?", body: "Site 2: 7% of second-dose recipients reported fever over 38.5 C on day 3. Is this site-specific or cross-site?" },
  "KL General Hospital": { kind: "dataset", title: "Adverse-event line list, weeks 1-8", body: "Synthetic line list: 412 participants, 31 AEs, 2 serious (both resolved)." },
};

const ic = { size: 15, weight: "regular", "aria-hidden": true } as const;

const parsePlain = (s: string): Plain => { try { return JSON.parse(s); } catch { return { title: "(unstructured)", body: s }; } };

function RoomView({ id }: { id: string }) {
  const room = findRoom(id);
  const api = useApi();
  const { me } = useMe();
  const { logout } = useTideCloak();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [policy, setPolicy] = useState<Policies>({});
  const [signed, setSigned] = useState({ write: false, read: false });
  const [state, setState] = useState<"loading" | "member" | "outsider">("loading");
  const [opened, setOpened] = useState<Record<string, Opened>>({});
  const [status, setStatus] = useState<{ kind: "" | "ok" | "bad"; msg: string }>({ kind: "", msg: "" });
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ kind: "finding", title: "", body: "" });
  // What the Tide network will check: roles in my own doken.
  const session = typeof window !== "undefined" ? (() => { try { return readSession(); } catch { return null; } })() : null;
  const canWrite = !!session?.realmRoles.includes(ENCRYPT_ROLE);
  const canRead = !!session?.realmRoles.includes(DECRYPT_ROLE) && !!session?.realmRoles.includes(readerRole(id));

  const load = useCallback(async () => {
    const r = await api("/api/rooms").catch(() => null);
    const row = r?.rooms?.find((x: { id: string }) => x.id === id);
    if (row) setSigned({ write: row.hasWritePolicy, read: row.hasReadPolicy });
    try {
      const p = await api(`/api/posts?room=${id}`);
      setPosts(p.posts);
      setState("member");
      setPolicy((await api(`/api/policy?room=${id}`).catch(() => null)) || {});
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

  const join = () => run("Recording your request...", async () => {
    await api("/api/join", { method: "POST", body: JSON.stringify({ room: id }) });
    return "Request recorded. An institution admin must propose your admission, and 2 of 3 institutions must sign it in their Tide enclaves.";
  });

  // Realm admin, once per room and policy. Each opens the Tide enclave pop-up, so each is its own click.
  // Deposit policy: the room group may ENCRYPT. Reading policy: only holders of room-<id>-reader may DECRYPT,
  // and that role reaches the group only through a quorum change request.
  const sign = (kind: "write" | "read") => run("Opening your Tide enclave to sign the policy...", async () => {
    const { policy: adminB64 } = await api(`/api/policy?room=${id}&admin=1`);
    const adminBytes = Uint8Array.from(atob(adminB64), (c) => c.charCodeAt(0));
    const subject: RelationshipSubject = kind === "write" ? { type: "Group", id: groupPath(id) } : { type: "Role", id: readerRole(id) };
    const access: RelationshipAccess = kind;
    const signedPolicy = await signRelationshipPolicy({ vendorId: (tcConfig as { vendorId: string }).vendorId, subject, recordId: id, access }, adminBytes);
    await api("/api/policy", { method: "POST", body: JSON.stringify({ room: id, kind, policy: signedPolicy }) });
    await load();
    return kind === "write"
      ? "Deposit policy signed: the Tide network now lets room members encrypt into this room."
      : `Reading policy signed: only holders of ${readerRole(id)} can decrypt, and that takes a 2-of-3 treaty.`;
  });

  const deposit = () => run("Encrypting in your browser via the Tide network...", async () => {
    if (!policy.write) throw new Error("The room's deposit policy is not signed yet");
    const ciphertext = await encryptForRecord(JSON.stringify({ title: draft.title, body: draft.body }), id, policy.write);
    await api("/api/posts", { method: "POST", body: JSON.stringify({ room: id, kind: draft.kind, ciphertext }) });
    setDraft({ kind: draft.kind, title: "", body: "" });
    await load();
    return "Deposited. The server stored ciphertext only.";
  });

  // Ask the network to open posts. Before the treaty unseals the room it refuses - even for the author.
  const open = (list: Post[]) => run("Asking the Tide network to open...", async () => {
    if (!policy.read) throw new Error("The room's reading policy is not signed yet");
    try {
      const out = await decryptAll(list.map((p) => p.ciphertext), id, policy.read);
      setOpened((o) => ({ ...o, ...Object.fromEntries(list.map((p, i) => [p.id, { ok: true, plain: parsePlain(out[i]) } as Opened])) }));
      return `Opened ${out.length} deposit(s) in your browser.`;
    } catch (e) {
      const msg = tideError(e);
      setOpened((o) => ({ ...o, ...Object.fromEntries(list.map((p) => [p.id, { ok: false, msg } as Opened])) }));
      throw e;
    }
  });

  const example = me?.profile ? EXAMPLES[me.profile.institution] : undefined;
  const needsSigning = !signed.write || !signed.read;

  return (
    <div className="stack">
      <a href="/rooms" className="back"><ArrowLeft {...ic} /> All rooms</a>
      <h1>{room.title}</h1>
      <p className="lede">{room.question}</p>
      <div className="card treaty">
        <div className="stack">
          <h2 className="row"><Scales {...ic} /> The treaty</h2>
          <p className="small muted">Signatories: {room.institutions.join(", ")}</p>
          <p className="small">Unseal the room or admit a member: <strong>2 of 3 institutions</strong> sign in their own Tide enclaves.</p>
        </div>
        <div className="row">
          <span className={`chip ${state === "member" ? "ok" : ""}`}>{state === "member" ? "Member" : state === "outsider" ? "Not a member" : "..."}</span>
          <span className={`chip ${canWrite && state === "member" ? "ok" : ""}`}>{canWrite && state === "member" ? "Can deposit" : "Cannot deposit"}</span>
          <span className={`chip ${canRead ? "ok" : "sealed"}`}>{canRead ? <LockKeyOpen {...ic} /> : <LockKey {...ic} />}{canRead ? "Read: OPEN" : "Read: SEALED"}</span>
        </div>
      </div>
      {status.msg && (
        <p className={`status ${status.kind}`} role="status">
          {status.kind === "ok" ? <CheckCircle {...ic} /> : status.kind === "bad" ? <WarningCircle {...ic} /> : <CircleNotch {...ic} className="spin" />}
          <span>{status.msg}</span>
        </p>
      )}

      {me?.isAdmin && needsSigning && (
        <div className="card stack">
          <h2>Sign this room&apos;s policies (realm admin, once)</h2>
          <p className="muted small">
            Two policies under Tide&apos;s built-in <code>RelationshipAttestation:1</code> contract, both tagged <code>{id}</code>.
            Deposit: group <code>{groupPath(id)}</code> may encrypt. Reading: only role <code>{readerRole(id)}</code> may decrypt.
          </p>
          <div className="row">
            <button className="btn" onClick={() => sign("write")} disabled={busy || signed.write}>{signed.write ? "Deposit policy signed" : "1. Sign deposit policy"}</button>
            <button className="btn" onClick={() => sign("read")} disabled={busy || signed.read}>{signed.read ? "Reading policy signed" : "2. Sign reading policy"}</button>
          </div>
        </div>
      )}

      {state === "outsider" && (
        <div className="card stack">
          <h2>You are not in this room</h2>
          <p className="muted">Membership is decided by the consortium, not by us. Your request becomes a TideCloak change request that institution admins must co-sign.</p>
          <div className="row">
            <button className="btn" onClick={join} disabled={busy}>Request to join</button>
            <button className="btn ghost" onClick={logout}>Approved? Sign in again</button>
          </div>
        </div>
      )}

      {state === "member" && policy.write && (
        <div className="card stack">
          <div className="row split">
            <h2>Deposit a result</h2>
            {example && <button className="btn ghost" onClick={() => setDraft(example)}>Load my synthetic example</button>}
          </div>
          <div className="field-row">
            <div>
              <label htmlFor="deposit-kind">Type</label>
              <select id="deposit-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                <option value="finding">Finding</option><option value="dataset">Dataset</option><option value="question">Question</option>
              </select>
            </div>
            <div>
              <label htmlFor="deposit-title">Title</label>
              <input id="deposit-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" />
            </div>
          </div>
          <div>
            <label htmlFor="deposit-body">Details</label>
            <textarea id="deposit-body" rows={4} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Unpublished or failed result, data summary or question for the other labs..." />
          </div>
          <div className="row">
            <button className="btn" onClick={deposit} disabled={busy || !draft.title.trim() || !draft.body.trim()}><LockKey {...ic} /> Encrypt &amp; deposit</button>
            <span className="muted small">Encrypted in your browser to this room only. Sealed until the treaty opens it.</span>
          </div>
        </div>
      )}

      {state === "member" && posts && (
        <div className="stack">
          <div className="row split">
            <h2>Deposits ({posts.length})</h2>
            <div className="row">
              <button className="btn ghost" onClick={logout} title="Picks up a committed change request"><ArrowsClockwise {...ic} /> Refresh access</button>
              {posts.length > 0 && policy.read && <button className="btn" onClick={() => open(posts)} disabled={busy}><LockKeyOpen {...ic} /> Open all</button>}
            </div>
          </div>
          {posts.length === 0 && <div className="empty"><Tray size={18} weight="regular" aria-hidden /><p>No deposits yet.</p></div>}
          {[...posts].reverse().map((p) => {
            const o = opened[p.id];
            return (
              <article key={p.id} className="card stack">
                <div className="row">
                  <span className="chip">{p.kind}</span>
                  <strong>{p.authorName}</strong>
                  <span className="muted small">{p.institution}</span>
                  <time className="muted small">{new Date(p.createdAt).toLocaleString()}</time>
                  <span className={`chip push ${o?.ok ? "ok" : "sealed"}`}>{o?.ok ? <LockKeyOpen {...ic} /> : <LockKey {...ic} />}{o?.ok ? "Opened" : "Sealed"}</span>
                </div>
                {o?.ok ? (
                  <div className="plain"><h3>{o.plain.title}</h3><p>{o.plain.body}</p></div>
                ) : (
                  <>
                    <div className="cipher">{p.ciphertext}</div>
                    {o && !o.ok && <p className="status bad small"><WarningCircle {...ic} /><span>Tide network refused: {o.msg}</span></p>}
                    {policy.read && <div><button className="btn ghost" onClick={() => open([p])} disabled={busy}>Open</button></div>}
                  </>
                )}
              </article>
            );
          })}
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
