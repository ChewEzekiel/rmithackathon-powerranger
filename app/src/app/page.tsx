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
          will put pre-publication data on a platform someone else controls. Treaty Room is a sealed shared room:
          <strong> the platform cannot read it, and no single admin or institution can open it early or let someone
          in alone</strong>. It opens for every member at once when the consortium co-signs.
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
          <p className="muted small">Letting anyone in, or opening the room, is a change request that 2 of 3 institution admins must sign in their own Tide enclaves. We hold no seat in that vote.</p>
        </div>
        <div className="card">
          <h3>Nobody reads first</h3>
          <p className="muted small">Deposits stay sealed, even to their authors, until the treaty opens the room for every member at the same moment. Sharing first no longer means getting scooped.</p>
        </div>
      </section>
    </div>
  );
}
