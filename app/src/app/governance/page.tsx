"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "../Shell";
import { useApi } from "@/lib/client";
import tcConfig from "../../../data/tidecloak.json";

type CR = Record<string, unknown>;
const consoleUrl = () => {
  const c = tcConfig as { "auth-server-url": string; realm: string };
  return `${c["auth-server-url"].replace(/\/+$/, "")}/realms/${c.realm}/tide-console/`;
};
// TideCloak's change-request shape varies by action type; show the useful fields we find.
const pick = (cr: CR, ...keys: string[]) => keys.map((k) => cr[k]).find((v) => v !== undefined && v !== null && v !== "");

function Governance() {
  const api = useApi();
  const [pending, setPending] = useState<CR[]>([]);
  const [audit, setAudit] = useState<{ at: string; who: string; what: string }[]>([]);
  const [forced, setForced] = useState<string>("");
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    api("/api/governance").then((r) => { setPending(r.pending); setAudit(r.audit); }).catch((e) => setErr(e.message));
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const force = async (id: unknown) => {
    try {
      const r = await api("/api/operator", { method: "POST", body: JSON.stringify({ id }) });
      setForced(JSON.stringify(r, null, 2));
    } catch (e) { setForced((e as Error).message); }
    load();
  };

  return (
    <div className="stack">
      <h1>Governance</h1>
      <p className="muted">
        Every change to who can enter a room is a TideCloak change request. It takes effect only when a quorum of
        institution admins approve it, each in their own Tide enclave. Approvals are sealed by the Tide network, so
        neither we nor any single admin can forge one.
      </p>
      {err && <p className="status bad">{err}</p>}
      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Pending change requests ({pending.length})</h2>
          <div className="row">
            <button className="btn ghost" onClick={load}>Refresh</button>
            <a className="btn" href={consoleUrl()} target="_blank" rel="noreferrer">Approve in Tide console</a>
          </div>
        </div>
        {pending.length === 0 ? <p className="muted">Nothing waiting for approval.</p> : (
          <table>
            <thead><tr><th>Request</th><th>What</th><th>Who</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {pending.map((cr) => (
                <tr key={String(cr.id)}>
                  <td><code>{String(cr.id).slice(0, 8)}</code></td>
                  <td>{String(pick(cr, "actionType", "type") ?? "")}<div className="muted small">{String(pick(cr, "description", "summary", "details", "affectedEntity") ?? "")}</div></td>
                  <td className="small">{String(pick(cr, "requestedBy", "username", "userName", "user", "affectedUser") ?? "")}</td>
                  <td><span className="chip warn">{String(pick(cr, "status") ?? "PENDING")}</span>{cr.readyToCommit ? <div className="chip ok" style={{ marginTop: 4 }}>quorum reached</div> : null}</td>
                  <td><button className="btn danger" onClick={() => force(cr.id)} title="The platform operator tries to approve this with the TideCloak master-admin password">Force as operator</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {forced && (<><h3>TideCloak&apos;s answer to the operator</h3><pre className="json">{forced}</pre></>)}
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
