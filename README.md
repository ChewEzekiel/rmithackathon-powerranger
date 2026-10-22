[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

_**Treaty Room** is a sealed research room no one owns: rival universities, drug companies and hospitals deposit unpublished and failed results, and it opens to all of them at once only when their admins co-sign the treaty._

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

<!-- What new product, service, experience or way of working are you proposing? What makes your idea distinctive? -->

A neutral data room with no neutral host. Deposits are encrypted in the browser and stay sealed, even to depositors, until 2 of 3 institutions sign; then every member reads at once. Nobody reads first, so nobody has to trust first.

### 2. Trust constraint insight

<!-- What is difficult, risky or impossible today because trust, privacy or security gets in the way? Explain what becomes possible when that constraint is removed. -->

Failed and unpublished results stay in drawers: pooling them means trusting a host that could read or leak them, or a partner who could publish first. Data trusts only move that trust. Remove it and competitors pool evidence before publication.

### 3. Value & impact

<!-- Who would benefit, and how would their lives or work improve? Give a concrete example of why this matters. -->

Northbridge University, Helix Therapeutics and St Aurelia Hospital pool Alzheimer's p-tau217 blood-test results, dead ends included, so nobody funds a cohort another lab saw fail. In Malaysia, Sunway Institute, Helix and KL General Hospital pool dengue vaccine safety signals, protecting trial volunteers sooner.

### 4. Why TideCloak matters

<!-- How does your application use TideCloak, and how does that integration help enable your idea? Connect the technology to the possibility you are demonstrating. -->

- Tide's ORKs threshold-sign logins; we hold no passwords and can't mint tokens.
- Each room has two `RelationshipAttestation:1` policies: its group may encrypt; only its own reader role may decrypt. Tide's nodes check every operation; plaintext never reaches us.
- The seal: the reader role reaches the room only via a change request that a quorum signs in their own Tide enclaves. We can't grant it.

### 5. Prototype & storytelling

<!-- What does your prototype demonstrate today? Describe the key interaction judges should look for. -->

The video (walkthrough mode: Tide's network simulated, as its public nodes were down): three institutions deposit; decryption is refused. A rogue steward's early unseal stalls at 1 of 2 signatures; a second admin co-signs and the room opens for all. The Operator view shows a thief's haul, undecryptable.

## Demo video

[demo/video.mp4](demo/video.mp4) (2 minutes). Team **Sunway PowerRanger**, judged in Malaysia.

The video was recorded in **walkthrough mode**, not against the live Tide network. See [Walkthrough mode](#walkthrough-mode-demo-recording) for why and for exactly what is simulated.

## How it works

```mermaid
flowchart LR
  R["Researcher browser"] -- "encrypt, tag = room id" --> T["Tide ORK network<br/>checks policy + doken"]
  T -- ciphertext --> R
  R -- "ciphertext + metadata" --> S["Next.js server<br/>store.json"]
  A1["Admin A enclave"] -- "signature 1 of 2" --> G["TideCloak IGA<br/>change request"]
  A2["Admin B enclave"] -- "signature 2 of 2" --> G
  G -- "commit: map _tide_decryptor + room-id-reader onto /rooms/id" --> T
  O["Operator / DB thief"] -. "decrypt with stolen data" .-> T
  T -. refused .-> O
```

- **Identity.** Users sign in with Tide. Tokens (and the doken that carries realm roles and groups) are threshold-signed by Tide's ORK network, so the app server can verify them but cannot forge them.
- **Rooms.** Each room is a TideCloak group, `/rooms/<id>` (`alz-biomarkers`, `dengue-vax`). The group carries `_tide_encryptor`, so members can deposit.
- **Room policies.** A realm admin signs two policies per room, once, in their Tide enclave (**1. Sign deposit policy**, **2. Sign reading policy**). Both use Tide's built-in `RelationshipAttestation:1` contract with the room id as the only tag. Deposit policy: subject = the group `/rooms/<id>`, role `_tide_encryptor`. Reading policy: subject = the realm role `room-<id>-reader`, role `_tide_decryptor`. Tide's decentralised nodes check the user's doken against the policy on every `doEncrypt`/`doDecrypt`.
- **The seal.** At first nobody holds `room-<id>-reader`, depositors included, so deposits can be written but not read. The unseal is **one** IGA change request that maps both `_tide_decryptor` and `room-<id>-reader` onto the room group (Governance page, **Propose unseal: &lt;room&gt;**). Because `_tide_decryptor` is realm-wide but the reader role is per room, opening one room opens no other. Under Quorum-Enforced Governance (Tide mode) approvals are enclave signatures from each admin's own browser, and the threshold is `max(1, floor(0.7 × admins))`, which is 2 of 3. Admins can also review and sign in the **Sign in Tide console** link.
- **Joining.** **Request to join** files a request; an admin turns it into a change request with **Propose admission**, and the quorum must sign it like any other.
- **Members read.** After the change commits, members click **Refresh access** (signs out and in for a fresh token), then **Open** or **Open all**.
- **Red team.** The server-side `authorize` call is refused in multi-admin Tide mode. With `DEMO_RED_TEAM=1`, realm admins see **Force as operator** on the Governance page, which tries it with the master-admin password and shows TideCloak's answer.
- **Host view.** The database is one JSON file (`app/data/store.json`): ciphertext, signed policies and metadata. The **Operator view** shows exactly that, and **Try to decrypt with the stolen data** shows the Tide network's refusal.

Key files: `app/src/lib/rooms.ts` (rooms and the per-room reader role), `app/src/lib/tide/relationship.ts` (policy, encrypt, decrypt), `app/src/lib/kcAdmin.ts` (change-request reads and the operator red-team call), `app/src/lib/store.ts` (the ciphertext store), `app/scripts/realm.json.template` (room groups and roles), `app/scripts/init-tidecloak.sh` (realm bootstrap).

Interface: Geist and Geist Mono, zinc with an emerald accent, light and dark themes, Phosphor icons.

## Walkthrough mode (demo recording)

**What happened.** On 22 October, Tide's public ORK network had nodes down (ork2, ork3 and ork7 returned HTTP 503). Creating a new Tide account needs every selected ORK, so nobody could enrol an account, and without an enrolled admin the live flow stops before any policy can be signed. Our live setup worked up to that step: TideCloak running, realm `consortium` created, licensed, IGA enabled and the adapter config exported. We could not run the steps after enrolment against the live network that day.

**What we did.** So the screens and flows could still be shown, we added a walkthrough mode. `NEXT_PUBLIC_WALKTHROUGH=1 npm run dev` makes webpack (`NormalModuleReplacementPlugin` in `app/next.config.ts`) swap the Tide SDK boundary, `@tidecloak/nextjs`, `@tidecloak/js` and `lib/tide/relationship`, for a simulation in `app/src/walkthrough/`. Everything else is the same app code.

| | Live mode (default) | Walkthrough mode |
|---|---|---|
| Sign-in | Tide account, threshold-signed token | Pick a persona at `/walkthrough`: Dr Mei Lee (Northbridge, admin), Dr Daniel Chen (Helix, admin), Dr Aisha Rahman (St Aurelia, admin), Dr Nurul Huda (Sunway Institute, researcher) |
| Policy and access checks | Tide's ORKs run `RelationshipAttestation:1` | The same checks run in the browser, with the same refusal messages |
| Encryption | Tide threshold encryption | AES-GCM with a locally derived key (a stand-in, not secure) |
| Change requests | TideCloak IGA, enclave signatures | Simulated IGA and a simulated "Tide enclave" panel per admin; threshold 2, shown as the quorum |
| State | TideCloak realm | `app/data/walkthrough.json` |

A banner on every page says walkthrough mode is on and that Tide network calls are simulated. **The demo video shows walkthrough mode, not live Tide.** Live mode is unchanged and still uses real TideCloak.

## Setup

<!-- How to install and run the prototype. -->

Full copy-paste steps and troubleshooting: [RUN_INSTRUCTIONS.md](RUN_INSTRUCTIONS.md).

**Walkthrough mode (no Tide account needed, matches the video).**

1. `cp app/.env.example app/.env` (it already sets `DEMO_RED_TEAM=1` for the Operator view).
2. Create a placeholder adapter config if `app/data/tidecloak.json` does not exist (the pages import it at build time; see RUN_INSTRUCTIONS.md Option B).
3. `cd app && npm install && NEXT_PUBLIC_WALKTHROUGH=1 npm run dev`, open <http://localhost:3000> and pick a researcher.

**Live mode (real TideCloak).** TideCloak must run on **Linux with Docker**: Tide's native library for Windows is a stub. We ran the official `tideorg/tidecloak-dev` image in a GitHub Codespace and forwarded port 8080 to `localhost`.

1. Copy `app/.env.example` to `app/.env` and set `KC_BOOTSTRAP_ADMIN_PASSWORD`, `TIDE_LICENSE_EMAIL` (an address you control) and `TIDE_TERMS_ACCEPTED=yes`. Set the last one only after reading [tide.org/legal](https://tide.org/legal).
2. On the Docker host, run `bash scripts/codespace-tidecloak.sh`. It starts `tideorg/tidecloak-dev` on port 8080 and runs `app/scripts/init-tidecloak.sh`, which creates realm `consortium` with the room groups and reader roles, licenses it, enables IGA and prints an invite link. Open the link to enrol the first admin in the Tide enclave.
3. If TideCloak runs in a Codespace, forward the ports before opening that invite link: `gh codespace ports forward 8080:8080 3000:3000`.
4. `cd app && npm install && npm run dev`, then open <http://localhost:3000>.
5. Enrol three admins (one per institution) for a real 2-of-3 quorum. An admin signs each room's policies once (**1. Sign deposit policy**, **2. Sign reading policy**).

Our venue network intercepted TLS, so `registry.npmjs.org` failed; `npm install --registry=https://registry.yarnpkg.com` worked.

## Limitations

- **Walkthrough mode is a simulation.** It enforces nothing cryptographically: the key is derived locally and the checks run in the browser. It accepts persona tokens (`Bearer wt.<persona>`) without any signature, so `NEXT_PUBLIC_WALKTHROUGH` must never be set in a real deployment.
- **Live mode was verified only up to account enrolment on 22 October**, because Tide's public nodes were partly down. The flows after it were recorded in walkthrough mode.
- **Institution is self-asserted.** The display name and institution in a user's profile are typed by the user, not attested. Group membership and roles, which decide access, come from the signed token.
- **Metadata is visible to the host.** The store holds each post's author name and institution, room, type (finding, dataset or question), time and ciphertext size, plus profiles, join requests and an audit log; never the content.
- **Whoever serves the JavaScript is trusted.** A malicious host could ship code that exfiltrates plaintext after it is decrypted in the browser.
- **Revocation is forward-only.** Removing a member stops future decryptions; anything they already read stays read.
- **Admitted members can copy.** Once the room unseals, a member can export what they see.
- **The host can delete or withhold ciphertext.** It cannot read or forge it, but it can deny service.
- **Two institutions can unseal over the third.** That is the agreed treaty rule (2 of 3), not a bypass.
- **Demo only.** All data is synthetic, and TideCloak runs from the `tideorg/tidecloak-dev` development image.

## Credits

Team **Sunway PowerRanger** for the RMIT x Tide UNLOCKED Challenge 2. Built on Tide's `nextjs-e2ee-vault` template, with TideCloak and Tide's `RelationshipAttestation:1` contract. Institutions, researchers and results are fictional; no real patient or trial data is used.
