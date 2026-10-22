"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { CircleNotch, LockKey, SignOut } from "@phosphor-icons/react";
import { useApi } from "@/lib/client";
import { INSTITUTIONS } from "@/lib/rooms";

const ic = { size: 16, weight: "regular", "aria-hidden": true } as const;

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

  if (isInitializing) return <div className="gate"><p className="muted row"><CircleNotch {...ic} className="spin" /> Connecting to TideCloak...</p></div>;
  if (!authenticated) {
    return (
      <div className="gate">
        <div className="card stack">
          <div className="brand-mark lg"><LockKey size={22} weight="regular" aria-hidden /></div>
          <h2>Sign in to Treaty Room</h2>
          <p className="muted">Your identity is verified by the Tide network. No one stores your password.</p>
          <button className="btn" onClick={login}>Sign in with Tide</button>
        </div>
      </div>
    );
  }

  return (
    <MeCtx.Provider value={{ me, reloadMe }}>
      <nav className="nav">
        <div className="nav-in">
          <a href="/" className="brand"><span className="brand-mark"><LockKey size={15} weight="regular" aria-hidden /></span>Treaty Room</a>
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} className={`link ${active === href ? "on" : ""}`} aria-current={active === href ? "page" : undefined}>{label}</a>
          ))}
          {me?.profile && (
            <span className="who">
              <strong>{me.profile.name}</strong>
              <span className="muted">{me.profile.institution}</span>
              {me.isAdmin && <span className="chip">admin</span>}
            </span>
          )}
          <button className="btn ghost" onClick={logout}><SignOut {...ic} /> Sign out</button>
        </div>
      </nav>
      {err && <div className="wrap notice"><p className="status bad">{err}</p></div>}
      {me && !me.profile && <ProfileModal onDone={reloadMe} />}
      <main className="wrap enter">{children}</main>
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
      <div className="card stack" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <h2 id="profile-title">Introduce yourself</h2>
        <p className="muted small">Tide verified who you are without giving us your password or email. Tell your collaborators what to call you.</p>
        <div><label htmlFor="profile-name">Display name</label><input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Aisha Rahman" /></div>
        <div>
          <label htmlFor="profile-institution">Institution</label>
          <select id="profile-institution" value={institution} onChange={(e) => setInstitution(e.target.value)}>
            {INSTITUTIONS.map((i) => <option key={i}>{i}</option>)}
          </select>
        </div>
        {err && <p className="status bad">{err}</p>}
        <button className="btn" onClick={save} disabled={!name.trim()}>Continue</button>
      </div>
    </div>
  );
}
