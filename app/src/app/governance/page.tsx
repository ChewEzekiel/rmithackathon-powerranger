"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell, useMe } from "../Shell";
import { useApi, useTideAdmin } from "@/lib/client";
import { ROOMS, groupPath, readerRole } from "@/lib/rooms";
import { DECRYPT_ROLE } from "@/lib/tide/relationship";
import tcConfig from "../../../data/tidecloak.json";

type CR = Record<string, unknown> & { id: string };
interface JoinReq { sub: string; name: string; institution: string; roomId: string; at: string }

const consoleUrl = () => {
  const c = tcConfig as { "auth-server-url": string; realm: string };
  return `${c["auth-server-url"].replace(/\/+$/, "")}/realms/${c.realm}/tide-console/`;
};
const pick = (cr: CR, ...keys: string[]) => keys.map((k) => cr[k]).find((v) => v !== undefined && v !== null && v !== "");
// Tide canon: the list object carries authorizationCount + authorizers[]; never default the count to 0.
const tally = (cr: CR) => {
  const n = typeof cr.authorizationCount === "number" ? cr.authorizationCount : undefined;
  const t = typeof cr.threshold === "number" ? cr.threshold : undefined;
  if (n === undefined) return cr.readyToCommit ? "quorum reached" : "awaiting signatures";
  return `${n} of ${t ?? "?"} signed`;
};

function Governance() {
  const api = useApi();
  const tideAdmin = useTideAdmin();
  const { me } = useMe();
  const [pending, setPending] = useState<CR[]>([]);
  const [joins, setJoins] = useState<JoinReq[]>([]);
  const [audit, setAudit] = useState<{ at: string; who: string; what: string }[]>([]);
  const [out, setOut] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    api("/api/governance").then((r) => { setPending(r.pending); setJoins(r.joinRequests); setAudit(r.audit); }).catch((e) => setErr(e.message));
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const groupId = async (roomId: string) => {
    const g = await tideAdmin(`/group-by-path${groupPath(roomId)}`);
    const id = (g.body as { id?: string })?.id;
    if (!id) throw new Error(`group lookup failed (HTTP ${g.status})`);
    return id;
  };
  // Proposals go from the admin's own browser with their own token, so TideCloak records a human filer.
  const propose = async (label: string, fn: () => Promise<{ status: number; body: unknown }>) => {
    setOut(`${label}...`);
    try {
      const r = await fn();
      setOut(r.status === 202
        ? `${label}: change request filed (HTTP 202). It takes effect only when 2 of 3 institution admins sign it.`
        : `${label}: TideCloak answered HTTP ${r.status} ${JSON.stringify(r.body)}`);
    } catch (e) { setOut(`${label} failed: ${(e as Error).message}`); }
    load();
  };
  const proposeUnseal = (roomId: string) => propose(`Unseal ${roomId}`, async () => {
    const gid = await groupId(roomId);
    // One change request maps both: the decrypt capability and this room's own reader role.
    const roles = await Promise.all([DECRYPT_ROLE, readerRole(roomId)].map((r) => tideAdmin(`/roles/${r}`)));
    return tideAdmin(`/groups/${gid}/role-mappings/realm`, { method: "POST", body: JSON.stringify(roles.map((r) => r.body)) });
  });
  const proposeAdmission = (j: JoinReq) => propose(`Admit ${j.name} to ${j.roomId}`, async () => {
    const gid = await groupId(j.roomId);
    return tideAdmin(`/users/${j.sub}/groups/${gid}`, { method: "PUT" });
  });
  // Red team: the platform operator tries to push a request through with the TideCloak master-admin key.
  const force = async (id: string) => {
    try { setOut(JSON.stringify(await api("/api/operator", { method: "POST", body: JSON.stringify({ id }) }), null, 2)); }
    catch (e) { setOut((e as Error).message); }
    load();
  };

  return (
    <div className="stack">
      <h1>Governance</h1>
      <p className="muted">
        Every change to who can read or enter a room is a TideCloak change request. It takes effect only when a quorum of
        institution admins sign it, each in their own Tide enclave. In Tide mode those signatures are checked by the Tide
        network, so neither we nor any single admin can forge one.
      </p>
      {err && <p className="status bad">{err}</p>}
      {out && <pre className="json">{out}</pre>}

      {me?.isAdmin && (
        <div className="card stack">
          <h2>Propose (institution admins)</h2>
          <div className="row">
            {ROOMS.map((r) => <button key={r.id} className="btn ghost" onClick={() => proposeUnseal(r.id)}>Propose unseal: {r.title}</button>)}
          </div>
          {joins.length > 0 && (
            <table>
              <thead><tr><th>Join request</th><th>Room</th><th></th></tr></thead>
              <tbody>{joins.map((j) => (
                <tr key={j.sub + j.roomId}><td>{j.name} <span className="muted small">{j.institution}</span></td><td>{j.roomId}</td>
                  <td><button className="btn ghost" onClick={() => proposeAdmission(j)}>Propose admission</button></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Waiting for signatures ({pending.length})</h2>
          <div className="row">
            <button className="btn ghost" onClick={load}>Refresh</button>
            <a className="btn" href={consoleUrl()} target="_blank" rel="noreferrer">Sign in Tide console</a>
          </div>
        </div>
        {pending.length === 0 ? <p className="muted">Nothing waiting.</p> : (
          <table>
            <thead><tr><th>Request</th><th>Change</th><th>Filed by</th><th>Signatures</th><th></th></tr></thead>
            <tbody>
              {pending.map((cr) => (
                <tr key={cr.id}>
                  <td><code>{String(cr.id).slice(0, 8)}</code></td>
                  <td>{String(pick(cr, "actionType") ?? "")}<div className="muted small">{String(pick(cr, "entityType") ?? "")} {String(pick(cr, "description", "summary") ?? "")}</div></td>
                  <td className="small">{String(pick(cr, "requestedBy") ?? "")}</td>
                  <td>
                    <span className={`chip ${cr.readyToCommit ? "ok" : "warn"}`}>{tally(cr)}</span>
                    <div className="muted small">{Array.isArray(cr.authorizers) ? (cr.authorizers as { username?: string }[]).map((a) => a.username).join(", ") : ""}</div>
                  </td>
                  <td>{me?.isAdmin && <button className="btn danger" onClick={() => force(cr.id)} title="Red-team demo: the platform operator tries to approve this with the TideCloak master-admin password">Force as operator</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card stack">
        <h2>Activity</h2>
        {audit.length === 0 ? <p className="muted">No activity yet.</p> : (
          <table><tbody>{audit.map((a, i) => (
            <tr key={i}><td className="small muted" style={{ whiteSpace: "nowrap" }}>{new Date(a.at).toLocaleTimeString()}</td><td><strong>{a.who}</strong> {a.what}</td></tr>
          ))}</tbody></table>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <Shell active="/governance"><Governance /></Shell>;
}
