"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { useApi } from "@/lib/client";
import { INSTITUTIONS } from "@/lib/rooms";

export interface Me {
  sub: string;
  profile: { name: string; institution: string } | null;
  groups: string[];
  isAdmin: boolean;
}
const MeCtx = createContext<{ me: Me | null; reloadMe: () => void }>({ me: null, reloadMe: () => {} });
export const useMe = () => useContext(MeCtx);

const LINKS = [
  ["/rooms", "Rooms"],
  ["/governance", "Governance"],
  ["/operator", "Operator view"],
];

export function Shell({ active, children }: { active: string; children: React.ReactNode }) {
  const { authenticated, isInitializing, login, logout } = useTideCloak();
  const api = useApi();
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState("");

  const reloadMe = useCallback(() => {
    api("/api/me").then(setMe).catch((e) => setErr(e.message));
  }, [api]);
  useEffect(() => { if (authenticated) reloadMe(); }, [authenticated, reloadMe]);

  if (isInitializing) return <div className="wrap"><p className="muted">Connecting to TideCloak...</p></div>;
  if (!authenticated) {
    return (
      <div className="wrap" style={{ textAlign: "center", paddingTop: 80 }}>
        <h2>Sign in to Consilium</h2>
        <p className="muted">Your identity is verified by the Tide network. No one stores your password.</p>
        <button className="btn" onClick={login}>Sign in with Tide</button>
      </div>
    );
  }

  return (
    <MeCtx.Provider value={{ me, reloadMe }}>
      <nav className="nav">
        <a href="/" className="brand">Consil<span>ium</span></a>
        {LINKS.map(([href, label]) => (
          <a key={href} href={href} className={`link ${active === href ? "on" : ""}`}>{label}</a>
        ))}
        {me?.profile && (
          <span className="chip">{me.profile.name} · {me.profile.institution}{me.isAdmin ? " · admin" : ""}</span>
        )}
        <button className="btn ghost" onClick={logout}>Sign out</button>
      </nav>
      {err && <div className="wrap"><p className="status bad">{err}</p></div>}
      {me && !me.profile && <ProfileModal onDone={reloadMe} />}
      <main className="wrap" style={{ paddingTop: 28 }}>{children}</main>
    </MeCtx.Provider>
  );
}

// Tide accounts carry no name or email, so a researcher introduces themselves once, in-app.
function ProfileModal({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState(INSTITUTIONS[0]);
  const [err, setErr] = useState("");
  const save = async () => {
    try {
      await api("/api/me", { method: "POST", body: JSON.stringify({ name, institution }) });
      onDone();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="modal">
      <div className="card stack">
        <h2>Introduce yourself</h2>
        <p className="muted small">Tide verified who you are without giving us your password or email. Tell your collaborators what to call you.</p>
        <div><label>Display name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Aisha Rahman" /></div>
        <div>
          <label>Institution</label>
          <select value={institution} onChange={(e) => setInstitution(e.target.value)}>
            {INSTITUTIONS.map((i) => <option key={i}>{i}</option>)}
          </select>
        </div>
        {err && <p className="status bad">{err}</p>}
        <button className="btn" onClick={save} disabled={!name.trim()}>Continue</button>
      </div>
    </div>
  );
}
