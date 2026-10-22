"use client";

// Walkthrough mode only: pick a synthetic researcher instead of signing in with Tide.
const PEOPLE = [
  { id: "lee", name: "Dr Mei Lee", institution: "Northbridge University", note: "Institution admin, Alzheimer's room" },
  { id: "chen", name: "Dr Daniel Chen", institution: "Helix Therapeutics", note: "Institution admin, both rooms" },
  { id: "aisha", name: "Dr Aisha Rahman", institution: "St Aurelia Hospital", note: "Institution admin, Alzheimer's room" },
  { id: "nurul", name: "Dr Nurul Huda", institution: "Sunway Institute", note: "Researcher, dengue room only" },
];

export default function WalkthroughPage() {
  if (process.env.NEXT_PUBLIC_WALKTHROUGH !== "1") return <div className="wrap"><p>Walkthrough mode is off. Sign in with Tide from the home page.</p></div>;
  const choose = async (p: (typeof PEOPLE)[number]) => {
    await fetch("/api/me", { method: "POST", headers: { Authorization: `Bearer wt.${p.id}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: p.name, institution: p.institution }) });
    try { localStorage.setItem("treatyroom.walkthrough.persona", p.id); } catch {}
    window.location.assign("/rooms");
  };
  return (
    <div className="wrap stack" style={{ paddingTop: 56, maxWidth: 760 }}>
      <h1>Sign in as a researcher</h1>
      <p className="muted">In live mode this is the Tide sign-in. In this walkthrough, pick one of the synthetic researchers.</p>
      <div className="grid">
        {PEOPLE.map((p) => (
          <button key={p.id} className="card stack wt-person" onClick={() => choose(p)}>
            <strong>{p.name}</strong>
            <span>{p.institution}</span>
            <span className="muted small">{p.note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
