"use client";

// Walkthrough-mode replacement for @tidecloak/nextjs (swapped in by next.config.ts only when
// NEXT_PUBLIC_WALKTHROUGH=1). Personas instead of Tide login; a simulated enclave for co-signing.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import tcConfig from "../../data/tidecloak.json";
import { setSession } from "./sim";

type Ctx = Record<string, unknown>;
const TideCtx = createContext<Ctx>({});
const PERSONA_KEY = "treatyroom.walkthrough.persona";
const NAMES: Record<string, string> = { lee: "Dr Mei Lee", chen: "Dr Daniel Chen", aisha: "Dr Aisha Rahman", nurul: "Dr Nurul Huda" };

export function TideCloakProvider({ children }: { config?: unknown; children: React.ReactNode }) {
  const [persona, setPersona] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<{ isAdmin?: boolean } | null>(null);

  useEffect(() => {
    let p: string | null = null;
    try { p = localStorage.getItem(PERSONA_KEY); } catch {}
    setPersona(p);
    if (!p) { setReady(true); return; }
    fetch("/api/me", { headers: { Authorization: `Bearer wt.${p}` } })
      .then((r) => r.json()).then((m) => { setSession(m); setMe(m); }).finally(() => setReady(true));
  }, []);

  const base = (tcConfig as { "auth-server-url": string })["auth-server-url"].replace(/\/+$/, "");
  const getToken = useCallback(async () => (persona ? `wt.${persona}` : null), [persona]);
  const secureFetch = useCallback((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    // TideCloak admin API calls from an admin's browser go to the walkthrough stand-in.
    return fetch(u.startsWith(base) ? `/api/wt/kc${u.slice(base.length).replace(/^\/admin\/realms\/[^/]+/, "")}` : u, init);
  }, [base]);
  const value = useMemo<Ctx>(() => ({
    isInitializing: !ready, authenticated: !!persona, token: persona ? `wt.${persona}` : null,
    login: () => window.location.assign("/walkthrough"),
    logout: () => { try { localStorage.removeItem(PERSONA_KEY); } catch {} window.location.assign("/walkthrough"); },
    getToken, secureFetch, getConfig: () => tcConfig,
    hasRealmRole: () => false, hasClientRole: () => false,
    getValueFromIdToken: (k: string) => (k === "preferred_username" ? persona : undefined),
    getValueFromToken: () => undefined,
  }), [ready, persona, getToken, secureFetch]);

  return (
    <TideCtx.Provider value={value}>
      {children}
      {ready && persona && me?.isAdmin && <SimEnclave persona={persona} />}
      <div className="wt-banner" role="note">
        <strong>Walkthrough mode.</strong> Tide network calls are simulated because Tide&apos;s public nodes were unavailable during recording.
        {persona ? <> Signed in as {NAMES[persona]}. <a href="/walkthrough">Switch researcher</a></> : null}
      </div>
    </TideCtx.Provider>
  );
}

// Stands in for each admin's Tide enclave: lists pending change requests and lets THIS admin sign.
function SimEnclave({ persona }: { persona: string }) {
  const [pending, setPending] = useState<{ id: string; description: string; authorizers: { username: string }[]; threshold: number }[]>([]);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    fetch("/api/governance", { headers: { Authorization: `Bearer wt.${persona}` } })
      .then((r) => r.json()).then((g) => setPending(g.pending || [])).catch(() => {});
  }, [persona]);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  if (!pending.length && !msg) return null;
  const sign = async (id: string) => {
    const r = await fetch("/api/wt/approve", { method: "POST", headers: { Authorization: `Bearer wt.${persona}`, "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((x) => x.json());
    setMsg(r.committed ? `Quorum reached (${r.authorizationCount} of ${r.threshold}). Change committed.` : `Signed (${r.authorizationCount} of ${r.threshold}). Waiting for another institution.`);
    load();
  };
  return (
    <div className="wt-enclave">
      <button className="btn" onClick={() => setOpen(!open)}>Tide enclave{pending.length ? ` (${pending.length} to sign)` : ""}</button>
      {open && (
        <div className="card stack">
          <strong>Your Tide enclave (simulated)</strong>
          {pending.map((cr) => {
            const mine = cr.authorizers.some((a) => a.username === persona);
            return (
              <div key={cr.id} className="stack">
                <span className="small">{cr.description}</span>
                <span className="muted small">{cr.authorizers.length} of {cr.threshold} signed</span>
                <button className="btn" disabled={mine} onClick={() => sign(cr.id)}>{mine ? "You signed" : "Approve and sign"}</button>
              </div>
            );
          })}
          {msg && <span className="small">{msg}</span>}
        </div>
      )}
    </div>
  );
}

export const useTideCloak = () => useContext(TideCtx) as never;
export function useAuthCallback() { return { isProcessing: false, isSuccess: true, error: null as Error | null }; }
