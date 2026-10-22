"use client";

import { useTideCloak } from "@tidecloak/nextjs";

export default function HomePage() {
  const { authenticated, login, isInitializing } = useTideCloak();
  return (
    <div className="wrap">
      <section className="hero">
        <span className="chip">Sunway PowerRanger · Tide UNLOCKED</span>
        <h1 style={{ marginTop: 14 }}>A research room that no one owns.</h1>
        <p>
          Rival universities, pharma labs and hospitals hold the pieces of the same discovery, but none of them
          will put pre-publication data on a platform someone else controls. Consilium is a shared room where
          <strong> the platform, its admins and any single member are mathematically unable</strong> to read the
          work or let someone in alone.
        </p>
        <div className="row" style={{ marginTop: 22 }}>
          {isInitializing ? (
            <span className="muted">Connecting to TideCloak...</span>
          ) : authenticated ? (
            <a className="btn" href="/rooms">Enter your rooms</a>
          ) : (
            <button className="btn" onClick={login}>Sign in with Tide</button>
          )}
          <a className="btn ghost" href="/operator">See what the platform sees</a>
        </div>
      </section>
      <section className="pillars">
        <div className="card">
          <h3>Unreadable by the host</h3>
          <p className="muted small">Findings are encrypted in the researcher&apos;s browser. Our database holds ciphertext only; a breach or a curious engineer gets nothing.</p>
        </div>
        <div className="card">
          <h3>The network checks the door</h3>
          <p className="muted small">Each room has a policy signed by the consortium. Tide&apos;s decentralised nodes, not our server, decide whether a member may decrypt.</p>
        </div>
        <div className="card">
          <h3>No unilateral access</h3>
          <p className="muted small">Adding anyone to a room is a change request that institution admins must approve in their own Tide enclaves. Even our master-admin key cannot push it through.</p>
        </div>
        <div className="card">
          <h3>Proof of who said what, when</h3>
          <p className="muted small">Every post carries its author, institution and time, so early contributors keep credit without publishing early.</p>
        </div>
      </section>
    </div>
  );
}
