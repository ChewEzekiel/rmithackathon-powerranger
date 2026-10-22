# Running Treaty Room

Step-by-step setup for the Treaty Room prototype (Team Sunway PowerRanger, RMIT x Tide UNLOCKED Challenge 2). Commands are copy-pasteable in a bash shell unless marked PowerShell.

There are two ways to run it:

- **Option A: live mode** (the default). Real TideCloak and the real Tide network. Needs a Linux host with Docker and a Tide account per admin.
- **Option B: walkthrough mode** (no Tide account needed). The same app with the Tide SDK boundary replaced by a simulation. This is what the demo video was recorded in, because on 22 October Tide's public ORK nodes ork2, ork3 and ork7 returned HTTP 503 and new Tide accounts could not be enrolled. It is a simulation, not security: never set `NEXT_PUBLIC_WALKTHROUGH` in a real deployment.

## Get the code

```bash
git clone https://github.com/ChewEzekiel/treaty-room.git
cd treaty-room
```

If `npm install` fails with a TLS or certificate error on `registry.npmjs.org` (our venue network intercepted TLS), use `npm install --registry=https://registry.yarnpkg.com` wherever this guide says `npm install`.

## Option B: walkthrough mode (no Tide account needed)

Needs only Node.js 20.9 or later and npm. Works on Windows, macOS and Linux.

```bash
cp app/.env.example app/.env        # already sets DEMO_RED_TEAM=1, which enables the Operator view
```

The pages import `app/data/tidecloak.json` at build time. It is gitignored, so on a fresh clone create a placeholder (skip this if you already have a real one from Option A):

```bash
[ -f app/data/tidecloak.json ] || echo '{"realm":"consortium","auth-server-url":"http://localhost:8080","resource":"treaty-room","public-client":true,"jwk":{"keys":[]},"vendorId":"walkthrough"}' > app/data/tidecloak.json
```

Then start the app in walkthrough mode:

```bash
cd app
npm install
NEXT_PUBLIC_WALKTHROUGH=1 npm run dev
```

PowerShell equivalent of the last line: `$env:NEXT_PUBLIC_WALKTHROUGH="1"; npm run dev`

Open <http://localhost:3000>. A banner on every page says walkthrough mode is on. **Sign in with Tide** takes you to `/walkthrough`, where you pick a synthetic researcher:

| Persona | Institution | Role |
|---|---|---|
| Dr Mei Lee | Northbridge University | Institution admin, Alzheimer's room |
| Dr Daniel Chen | Helix Therapeutics | Institution admin, both rooms |
| Dr Aisha Rahman | St Aurelia Hospital | Institution admin, Alzheimer's room |
| Dr Nurul Huda | Sunway Institute | Researcher, dengue room only |

Switch researcher from the banner. Each admin gets a simulated **Tide enclave** button (bottom right, above the banner) listing pending change requests to sign; the threshold is 2, shown as the quorum. Then follow the [demo walkthrough](#demo-walkthrough) below, using the enclave panel wherever it says "approve in their Tide enclave".

What is simulated: sign-in (persona tokens), the Tide network (the same `RelationshipAttestation:1` checks and refusal messages, run in the browser), encryption (AES-GCM with a locally derived key) and TideCloak IGA (state in `app/data/walkthrough.json`). To reset, stop the server and delete `app/data/walkthrough.json` and `app/data/store.json`.

## Option A: live mode (real TideCloak)

### What you need

| Need | Why |
|------|-----|
| A **Linux host with Docker** (GitHub Codespace, WSL2, or a VM) | TideCloak runs from the official `tideorg/tidecloak-dev` image. Tide's native library for Windows is a stub, so do not run TideCloak natively on Windows. We used a GitHub Codespace. |
| Node.js 20.9 or later, npm | The Next.js 16 app in `app/`. |
| `curl`, `jq` | Used by the bootstrap scripts (`scripts/codespace-tidecloak.sh` installs `jq` with `apt-get` if missing). |
| GitHub CLI (`gh`) | Only if TideCloak runs in a Codespace: forwards its ports to your `localhost`. |
| A browser that allows pop-ups from `http://localhost:3000` | Tide opens its enclave in a pop-up for sign-in and every signature. |
| A real email address you control | The realm is licensed to it under Tide's terms. |
| Tide's public ORK network up | Enrolling a new Tide account needs every selected ORK to answer. |

### 1. Open a Codespace (optional)

If you use a Codespace, create one on this repository and run steps 2 and 3 in its terminal:

```bash
gh codespace create -R ChewEzekiel/treaty-room
gh codespace ssh            # pick the codespace you just created
cd /workspaces/treaty-room
```

### 2. Configure `app/.env`

`app/.env` is gitignored, so create it on every machine that runs the scripts or the app (including the Codespace).

```bash
cp app/.env.example app/.env
```

Edit `app/.env` and set:

```ini
KC_BOOTSTRAP_ADMIN_USERNAME=admin
KC_BOOTSTRAP_ADMIN_PASSWORD=<a strong password of your choosing>
TIDE_LICENSE_EMAIL=<an email address you control>
TIDE_TERMS_ACCEPTED=yes
```

Set `TIDE_TERMS_ACCEPTED=yes` only after you have read and agreed to Tide's terms at <https://tide.org/legal>. The init script refuses to run if any of these are missing, and rejects placeholder emails.

`DEMO_RED_TEAM=1` (already in the example) turns on the **Operator view** (the raw database dump) and the **Force as operator** button (realm admins only), which tries to approve a change request with the master-admin key so you can show TideCloak refusing it. Remove it anywhere other than a demo.

### 3. Start TideCloak and create the realm

On the Docker host, from the repository root:

```bash
bash scripts/codespace-tidecloak.sh
```

This script:

1. Starts the `tideorg/tidecloak-dev:latest` container as `tidecloak` on port 8080 (data kept in `app/data/h2`).
2. Waits until TideCloak answers, then runs `app/scripts/init-tidecloak.sh`, which:
   - creates realm `consortium` from `app/scripts/realm.json.template`, including the room groups `/rooms/alz-biomarkers` and `/rooms/dengue-vax` (each carrying `_tide_encryptor`) and the per-room reader roles `room-<id>-reader`;
   - licenses the realm to `TIDE_LICENSE_EMAIL` and enables IGA (governed change requests);
   - creates the first admin user and prints an **invite link**;
   - waits for you to open that link and enrol the admin's Tide account in the enclave;
   - finishes the bootstrap and writes the adapter config to `app/data/tidecloak.json`.

**Before you open the invite link from a Codespace, forward the ports** (step 4), because the link points at `http://localhost:8080`.

### 4. Forward the ports (Codespace only)

On your own machine, in a separate terminal:

```bash
gh codespace ports forward 8080:8080 3000:3000
```

Leave it running. `localhost:8080` (TideCloak) and `localhost:3000` (the app) now reach the Codespace. Open the invite link printed in step 3 in your browser and enrol the first admin. The script detects the link and completes.

### 5. Run the app

Easiest: run it on the same host as TideCloak (the Codespace), so `app/data/tidecloak.json` is already there.

```bash
cd app
npm install
npm run dev
```

Open <http://localhost:3000>.

To run the app on your own machine instead, forward only port 8080, create `app/.env` locally with the same values, and copy the adapter config down from the Codespace before `npm run dev`:

```bash
gh codespace cp 'remote:/workspaces/treaty-room/app/data/tidecloak.json' app/data/tidecloak.json
```

### 6. Sign the room policies

1. Sign in with Tide as the first admin. Enter a display name and an institution.
2. Open **Rooms**, then each room (`alz-biomarkers`, `dengue-vax`).
3. Click **1. Sign deposit policy** and approve in your Tide enclave, then **2. Sign reading policy** and approve again. These sign the room's two `RelationshipAttestation:1` policies, both tagged with the room id: deposit (subject = group `/rooms/<id>`, role `_tide_encryptor`) and reading (subject = realm role `room-<id>-reader`, role `_tide_decryptor`). From now on the Tide network, not our server, decides who can encrypt or decrypt for that room.

### 7. Enrol three admins for a real 2-of-3 quorum

The approval threshold is `max(1, floor(0.7 × admins))`: 1 with one admin, 2 with three. To demonstrate the treaty, enrol one admin per institution (for the Alzheimer's room: Northbridge University, Helix Therapeutics, St Aurelia Hospital).

For each extra admin:

1. Create the user in the TideCloak admin console (<http://localhost:8080/admin>, realm `consortium`, sign in with `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD`).
2. Generate a Tide invite link for them (the same "Link Tide Account" required action the init script used) and have them open it in **their own** browser to enrol in the Tide enclave.
3. Add them to the room group(s) and assign the `tide-realm-admin` role.

Once the realm is in multi-admin mode, each of these is a change request. Approve it from an existing admin's browser: **Governance** page, then **Sign in Tide console** (<http://localhost:8080/realms/consortium/tide-console/>). Screen names may differ slightly between TideCloak dev-image versions.

## Demo walkthrough

The same steps work in both modes. In walkthrough mode, "sign in" means picking a persona and "approve in their Tide enclave" means the simulated enclave panel.

1. **Deposit.** Each admin signs in, opens the Alzheimer's room, clicks **Load my synthetic example** (or writes a finding) and **Encrypt & deposit**. The post is encrypted in their browser; the server stores ciphertext only.
2. **Sealed.** **Open** / **Open all** is refused by the Tide network: no one holds the room's reader role yet, depositors included.
3. **Rogue steward.** One admin clicks **Propose unseal: &lt;room&gt;** on **Governance** and signs it. It shows as pending at 1 of 2 signatures. **Force as operator** tries the server-side `authorize` lane with the master-admin password; TideCloak refuses it in multi-admin Tide mode and the page shows the answer.
4. **Treaty.** A second admin approves the request in their own Tide enclave. Quorum is reached and the one change request commits, mapping `_tide_decryptor` and `room-<id>-reader` onto the room group. The other room stays sealed.
5. **Unseal.** Each member clicks **Refresh access** (signs out and in for a fresh token), then **Open all**. The room opens for all of them.
6. **Joining (optional).** A non-member clicks **Request to join**; an admin clicks **Propose admission** on **Governance**, and it needs the quorum like any other change.
7. **Operator view.** Open **Operator view** ("What the platform sees"): the raw database file (ciphertext, signed policies, metadata). **Try to decrypt with the stolen data** shows the Tide network refusing.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Nothing happens on **Sign in with Tide**, a **Sign ... policy** button or an approval | The Tide enclave pop-up was blocked. Allow pop-ups for `http://localhost:3000` and click again. |
| Tide account enrolment fails or hangs; ORK URLs return HTTP 503 | Tide's public ORK network is partly down; enrolment needs every selected ORK. Wait and retry, or use Option B to show the flows. |
| An approval committed but the app still says you lack access | Your token was issued before the change. Click **Refresh access** (or sign out and in) to get a fresh token with the new group or role. |
| `npm install` fails with a TLS or certificate error | `npm install --registry=https://registry.yarnpkg.com` |
| Decrypt or encrypt fails with `TIDE-TIDEJS-NET-THRESHOLD_FAILURE` ("Could not reach enough VVK ORKs") | Usually the contract refusing you, not an outage: the room is still sealed, you are not in its group, or your token is stale. The contract's reason is in the error's `cause`. Do not retry in a loop. Walkthrough mode shows the same message with "(walkthrough simulation)". |
| Init script exits asking for `KC_BOOTSTRAP_ADMIN_PASSWORD`, licence email or terms | Fill `app/.env` as in step 2. `TIDE_TERMS_ACCEPTED` must be exactly `yes`. |
| Init reports `NEED_PAYMENT` | The realm was not licensed. Check `TIDE_LICENSE_EMAIL` is a real address and run the script again. |
| App fails to build: cannot find `data/tidecloak.json` | Live mode: the realm has not been bootstrapped, or you are running the app on a different machine; run step 3 or copy the file as in step 5. Walkthrough mode: create the placeholder shown in Option B. |
| `/walkthrough` says "Walkthrough mode is off" | Start the dev server with `NEXT_PUBLIC_WALKTHROUGH=1` (it is read at build time, so restart after changing it). |
| Sign-in redirects to `localhost:8080` and fails to load | Port 8080 is not forwarded. Re-run `gh codespace ports forward 8080:8080 3000:3000`. |
| TideCloak will not start on Windows | Expected: run it in Docker on Linux (Codespace, WSL2 or a VM). |
| You want a clean slate | Walkthrough: delete `app/data/walkthrough.json` and `app/data/store.json`. Live, on the Docker host: `docker rm -f tidecloak`, then delete `app/data/h2`, `app/data/store.json` and `app/data/tidecloak.json`, and repeat from step 3. This wipes the realm and all demo posts. |
