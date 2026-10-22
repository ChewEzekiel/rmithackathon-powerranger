"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { ArrowRight, Buildings, CircleNotch, Eye, LockKey, LockKeyOpen, PenNib, ShieldCheck } from "@phosphor-icons/react";
import { ROOMS, readerRole } from "@/lib/rooms";

const ic = { size: 16, weight: "regular", "aria-hidden": true } as const;
const delay = (i: number) => ({ "--i": i }) as React.CSSProperties;

// A sample ciphertext, shown the way the platform stores it.
const SAMPLE_CIPHER =
  "zrhUnORy33M6SwduCbCrHsD96qpI++ul1+v7Ap9x355cv7gOPPIO0ggzmElmdV6xPrmM6lDyqO2VEETp0Ypl5LTqQjlm/FNR6uoN/HNXUtNV8OxuUlJ1h6T7W0wWUpQz2TgPluOncDkURwCwjn4apEvh1gXmo8ewe1fYBvVjaij4CjwKl25e5B0tIEo+n6hbGpJ+WA9O7EgE8x7PpFliPrNwsjE1KDVSQV+XrXdr5Yo3DJ80";

// A second, different sample for the "unreadable by the host" tile.
const STORED_CIPHER =
  "JhDZ2mwDBJwrEpiSUGBETDEcSoSOyutv3nTugZcIJyYYs+Ex6CqQYJtcBLo4p5VftN7+YlZwGlz1WK4o+Re8QhijpVU+SL1RVXvtLUD7x5Fn2r2ocAP/CvLxySVTBwHwaUh9i1hp/bL82YecioriBCz9CMUNZBrLOhcR0bvv4NVZHR/4YHILIDDUa9L/JcZ+Khv1tRoD";

const room = ROOMS[0];
const SIGNED = 2;
const KINDS = ["finding", "dataset", "finding"];

export default function HomePage() {
  const { authenticated, login, isInitializing } = useTideCloak();
  return (
    <>
      <nav className="nav">
        <div className="nav-in">
          <a href="/" className="brand"><span className="brand-mark"><LockKey size={15} weight="regular" aria-hidden /></span>Treaty Room</a>
          <a className="link" href="/rooms">Rooms</a>
          <a className="link" href="/governance">Governance</a>
          <a className="link" href="/operator">Operator view</a>
        </div>
      </nav>

      <div className="wrap">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow rise" style={delay(0)}>Sunway PowerRanger · Tide UNLOCKED</p>
            <h1 className="rise" style={delay(1)}>A research room that no one owns.</h1>
            <p className="hero-sub rise" style={delay(2)}>
              Rival institutions share sealed results. The platform cannot read them, and no single admin or institution can open them early.
            </p>
            <div className="row hero-cta rise" style={delay(3)}>
              {isInitializing ? (
                <span className="muted row"><CircleNotch {...ic} className="spin" /> Connecting to TideCloak...</span>
              ) : authenticated ? (
                <a className="btn lg" href="/rooms">Enter your rooms <ArrowRight {...ic} /></a>
              ) : (
                <button className="btn lg" onClick={login}>Sign in with Tide <ArrowRight {...ic} /></button>
              )}
              <a className="btn ghost lg" href="/operator"><Eye {...ic} /> See what the platform sees</a>
            </div>
          </div>

          <figure
            className="preview rise"
            style={delay(4)}
            role="img"
            aria-label="Sample deposit as the platform stores it: ciphertext only, sealed, with 1 of 2 signatures collected toward unsealing"
          >
            <div className="card stack" aria-hidden="true">
              <div className="dep-head">
                <div className="who-line">
                  <div className="row">
                    <span className="chip">finding</span>
                    <strong>Dr. Aisha Rahman</strong>
                  </div>
                  <span className="muted small">{room.institutions[0]}</span>
                </div>
                <span className="chip sealed"><LockKey size={13} weight="regular" /> Sealed</span>
              </div>
              <div className="cipher">{SAMPLE_CIPHER}</div>
              <div className="dep-foot">
                <div className="who-line">
                  <strong>Unseal request</strong>
                  <span className="muted small">2 of 3 institutions must sign</span>
                </div>
                <span className="chip warn"><PenNib size={13} weight="regular" /> 1 of 2 signatures</span>
              </div>
            </div>
            <figcaption>Sample deposit as the platform stores it.</figcaption>
          </figure>
        </section>

        <section className="bento" aria-label="What protects a room">
          <article className="card cell s7 reveal">
            <div className="cell-head"><span className="cell-icon"><LockKey {...ic} /></span><h3>Unreadable by the host</h3></div>
            <p>Findings are encrypted in the researcher&apos;s browser. Our database holds ciphertext only; a breach or a curious engineer gets nothing.</p>
            <div className="cell-visual"><div className="cipher">{STORED_CIPHER}</div></div>
          </article>

          <article className="card cell s5 tint reveal">
            <div className="cell-head"><span className="cell-icon"><ShieldCheck {...ic} /></span><h3>The network checks the door</h3></div>
            <p>Each room has a policy signed by the consortium. Tide&apos;s decentralised nodes, not our server, decide whether a member may decrypt.</p>
            <div className="cell-visual stack">
              <span className="chip ok"><ShieldCheck size={13} weight="regular" /> Network-enforced policies</span>
              <div><code>{readerRole(room.id)}</code></div>
            </div>
          </article>

          <article className="card cell s5 reveal">
            <div className="cell-head"><span className="cell-icon"><PenNib {...ic} /></span><h3>No unilateral access</h3></div>
            <p>Letting anyone in, or opening the room, is a change request that 2 of 3 institution admins must sign in their own Tide enclaves. We hold no seat in that vote.</p>
            <ul className="seats cell-visual">
              {room.institutions.map((name, i) => (
                <li key={name}>
                  <Buildings {...ic} />
                  <span className="name">{name}</span>
                  <span className={`chip ${i < SIGNED ? "ok" : "warn"}`}>{i < SIGNED ? "Signed" : "Awaiting"}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="card cell s7 inset reveal">
            <div className="cell-head"><span className="cell-icon"><LockKeyOpen {...ic} /></span><h3>Nobody reads first</h3></div>
            <p>Deposits stay sealed, even to their authors, until the treaty opens the room for every member at the same moment. Sharing first no longer means getting scooped.</p>
            <ul className="rows cell-visual">
              {room.institutions.map((name, i) => (
                <li key={name}>
                  <span className="chip">{KINDS[i]}</span>
                  <span className="name">{name}</span>
                  <span className="chip sealed"><LockKey size={13} weight="regular" /> Sealed</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="flow">
          <h2 className="reveal">How a room opens</h2>
          <ol className="steps">
            <li className="reveal">
              <span className="key"><LockKey {...ic} /> Deposit</span>
              <p>A member encrypts a result in their browser and deposits it. The server stores ciphertext only.</p>
            </li>
            <li className="reveal">
              <span className="key"><PenNib {...ic} /> Co-sign</span>
              <p>Admins from 2 of 3 institutions sign the unseal change request, each in their own Tide enclave.</p>
            </li>
            <li className="reveal">
              <span className="key"><LockKeyOpen {...ic} /> Open</span>
              <p>The room opens for every member at the same moment. Until then the Tide network refuses to open a deposit, even for its author.</p>
            </li>
          </ol>
        </section>

        <footer className="foot">
          <span className="brand"><span className="brand-mark"><LockKey size={15} weight="regular" aria-hidden /></span>Treaty Room</span>
          <span>Built on TideCloak</span>
        </footer>
      </div>
    </>
  );
}
