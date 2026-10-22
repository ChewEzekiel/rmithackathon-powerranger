# Running Treaty Room

Step-by-step setup for the Treaty Room prototype (Team Sunway PowerRanger, RMIT x Tide UNLOCKED Challenge 2). Commands are copy-pasteable in a bash shell.

## What you need

| Need | Why |
|------|-----|
| A **Linux host with Docker** (GitHub Codespace, WSL2, or a VM) | TideCloak runs from the official `tideorg/tidecloak-dev` image. Tide's native library for Windows is a stub, so do not run TideCloak natively on Windows. We used a GitHub Codespace. |
| Node.js 20.9 or later, npm | The Next.js 16 app in `app/`. |
| `curl`, `jq` | Used by the bootstrap scripts (`scripts/codespace-tidecloak.sh` installs `jq` with `apt-get` if missing). |
| GitHub CLI (`gh`) | Only if TideCloak runs in a Codespace: forwards its ports to your `localhost`. |
| A browser that allows pop-ups from `http://localhost:3000` | Tide opens its enclave in a pop-up for sign-in and every signature. |
| A real email address you control | The realm is licensed to it under Tide's terms. |

## 1. Get the code

```bash
git clone https://github.com/ChewEzekiel/rmithackathon-powerranger.git
cd rmithackathon-powerranger
```

If you use a Codespace, create one on this repository and run the rest of the steps in its terminal:

```bash
gh codespace create -R ChewEzekiel/rmithackathon-powerranger
gh codespace ssh            # pick the codespace you just created
cd /workspaces/rmithackathon-powerranger
```

## 2. Configure `app/.env`

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

For the demo, also set `DEMO_RED_TEAM=1`. It turns on the **Operator view** (the raw database dump) and the **Force as operator** button (realm admins only), which tries to approve a change request with the master-admin key so you can show TideCloak refusing it. Leave it unset anywhere else.

## 3. Start TideCloak and create the realm

On the Docker host, from the repository root:

```bash
bash scripts/codespace-tidecloak.sh
```

This script:

1. Starts the `tideorg/tidecloak-dev:latest` container as `tidecloak` on port 8080 (data kept in `app/data/h2`).
2. Waits until TideCloak answers, then runs `app/scripts/init-tidecloak.sh`, which:
   - creates realm `consortium` from `app/scripts/realm.json.template`, including the room groups `/rooms/alz-biomarkers` and `/rooms/dengue-vax` (each carrying `_tide_encryptor`);
   - licenses the realm to `TIDE_LICENSE_EMAIL` and enables IGA (governed change requests);
   - creates the first admin user and prints an **invite link**;
   - waits for you to open that link and enrol the admin's Tide account in the enclave;
   - finishes the bootstrap and writes the adapter config to `app/data/tidecloak.json`.

**Before you open the invite link from a Codespace, forward the ports** (step 4), because the link points at `http://localhost:8080`.

## 4. Forward the ports (Codespace only)

On your own machine, in a separate terminal:

```bash
gh codespace ports forward 8080:8080 3000:3000
```

Leave it running. `localhost:8080` (TideCloak) and `localhost:3000` (the app) now reach the Codespace. Open the invite link printed in step 3 in your browser and enrol the first admin. The script detects the link and completes.

## 5. Run the app

Easiest: run it on the same host as TideCloak (the Codespace), so `app/data/tidecloak.json` is already there.

```bash
cd app
npm install
npm run dev
```

Open <http://localhost:3000>.

To run the app on your own machine instead, forward only port 8080, create `app/.env` locally with the same values, and copy the adapter config down from the Codespace before `npm run dev`:

```bash
gh codespace cp 'remote:/workspaces/rmithackathon-powerranger/app/data/tidecloak.json' app/data/tidecloak.json
```

If `npm install` fails with a TLS or certificate error on `registry.npmjs.org`:

```bash
npm install --registry=https://registry.yarnpkg.com
```

## 6. Seal the rooms

1. Sign in with Tide as the first admin. Enter a display name and an institution.
2. Open **Rooms**, then each room (`alz-biomarkers`, `dengue-vax`).
3. Click **1. Sign deposit policy**, approve in your Tide enclave, then **2. Sign reading policy** and approve again. These sign the room's two `RelationshipAttestation:1` policies (deposit: the room group may encrypt; reading: only `room-<id>-reader` may decrypt), both using the room id as the only tag. From now on the Tide network, not our server, decides who can encrypt or decrypt for that room.

## 7. Enrol three admins for a real 2-of-3 quorum

The approval threshold is `max(1, floor(0.7 × admins))`: 1 with one admin, 2 with three. To demonstrate the treaty, enrol one admin per institution (for the Alzheimer's room: Northbridge University, Helix Therapeutics, St Aurelia Hospital).

For each extra admin:

1. Create the user in the TideCloak admin console (<http://localhost:8080/admin>, realm `consortium`, sign in with `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD`).
2. Generate a Tide invite link for them (the same "Link Tide Account" required action the init script used) and have them open it in **their own** browser to enrol in the Tide enclave.
3. Add them to the room group(s) and assign the `tide-realm-admin` role.

Once the realm is in multi-admin mode, each of these is a change request. Approve it from an existing admin's browser: **Governance** page, then **Sign in Tide console** (<http://localhost:8080/realms/consortium/tide-console/>). Screen names may differ slightly between TideCloak dev-image versions.

## 8. Demo walkthrough

1. **Deposit.** Each admin signs in, opens the Alzheimer's room, writes a finding and clicks **Encrypt & deposit** (or **Load my synthetic example** first). The post is encrypted in their browser; the server stores ciphertext only.
2. **Sealed.** **Open** / **Open all** is refused by the Tide network: no one holds the room's reader role yet, depositors included.
3. **Rogue steward.** One admin files a change request that would give read access early. On **Governance** it shows as pending with 1 of 2 approvals. **Force as operator** tries the server-side `authorize` lane with the master-admin password; TideCloak refuses it in multi-admin Tide mode and the page shows the answer.
4. **Treaty.** A second admin approves the request in their own Tide enclave. Quorum is reached and the change commits, mapping `_tide_decryptor` and `room-<id>-reader` onto the room group (**Propose unseal** on the Governance page creates it).
5. **Unseal.** Every member signs out and in again, then clicks **Open all**. The room opens for all of them.
6. **Operator view.** Open **Operator view** ("What the platform sees"): the raw database file (ciphertext, signed policies, metadata). **Try to decrypt with the stolen data** shows the Tide network refusing.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Nothing happens on **Sign in with Tide**, a **Sign ... policy** button or an approval | The Tide enclave pop-up was blocked. Allow pop-ups for `http://localhost:3000` and click again. |
| An approval committed but the app still says you lack access | Your token was issued before the change. **Sign out and sign in again** to get a fresh token with the new group or role. |
| `npm install` fails with a TLS or certificate error | `npm install --registry=https://registry.yarnpkg.com` |
| Decrypt or encrypt fails with `TIDE-TIDEJS-NET-THRESHOLD_FAILURE` ("Could not reach enough VVK ORKs") | Usually the contract refusing you, not an outage: the room is still sealed, you are not in its group, or your token is stale. The contract's reason is in the error's `cause`. Do not retry in a loop. |
| Init script exits asking for `KC_BOOTSTRAP_ADMIN_PASSWORD`, licence email or terms | Fill `app/.env` as in step 2. `TIDE_TERMS_ACCEPTED` must be exactly `yes`. |
| Init reports `NEED_PAYMENT` | The realm was not licensed. Check `TIDE_LICENSE_EMAIL` is a real address and run the script again. |
| App fails to build: cannot find `data/tidecloak.json` | The realm has not been bootstrapped, or you are running the app on a different machine. Run step 3, or copy the file as in step 5. |
| Sign-in redirects to `localhost:8080` and fails to load | Port 8080 is not forwarded. Re-run `gh codespace ports forward 8080:8080 3000:3000`. |
| TideCloak will not start on Windows | Expected: run it in Docker on Linux (Codespace, WSL2 or a VM). |
| You want a clean slate | On the Docker host: `docker rm -f tidecloak`, then delete `app/data/h2`, `app/data/store.json` and `app/data/tidecloak.json`, and repeat from step 3. This wipes the realm and all demo posts. |
