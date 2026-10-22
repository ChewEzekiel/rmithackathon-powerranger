# Live TideCloak evidence

The demo video runs in walkthrough mode because no Tide account could be created on 22 Oct 2026 (see "Outage" below).
This page records what **did** run against real TideCloak and the real Tide network, so the integration can be checked.
Every value below is copied from real output on the day. Tokens, keys, passwords, invite links and the licence email are redacted.

## 1. Environment

| Item | Value |
|---|---|
| Server | Official `tideorg/tidecloak-dev:latest` (TideCloak 0.14.41, Keycloak 26.7.5) |
| Host | GitHub Codespace (Linux + Docker), started 2026-10-22 05:59 UTC (13:59 MYT) |
| Why not the laptop | Tide's Windows native library in the image (`MidgardCore.dll`) exports only 5 functions and lacks `initialize_wallet`, so licensing fails on Windows |
| Bootstrap | `app/scripts/init-tidecloak.sh` (Tide's template script) via `scripts/codespace-tidecloak.sh` |

## 2. Realm bootstrap (log excerpt)

```text
==> Licence email: <redacted>
==> Terms & Conditions (https://tide.org/legal): accepted by the operator
==> Using already-running TideCloak at http://localhost:8080
  TideCloak is ready.
==> Creating realm 'consortium' with E2EE roles...
==> Disabling the first-broker-login profile page...
==> Initializing Tide realm (license + VRK)...
==> Stamping iga.attestor=tide...
==> Enabling IGA...
==> Approving client change requests...
==> Creating admin user...
==> Generating invite link...
Waiting for admin to link Tide account (polling every 5s)...
```

The script exits on any licensing failure (`setUpTideRealm` non-2xx or `NEED_PAYMENT`), so reaching the IGA and admin steps means the realm was licensed and its vendor key (VRK) created on the Tide network.

## 3. Realm state, read back from the TideCloak admin API

```json
{
  "realm": "consortium",
  "enabled": true,
  "attributes": { "isIGAEnabled": "true", "iga.attestor": "tide" }
}
```

- Identity provider: `{"alias": "tide", "providerId": "tide", "enabled": true}`
- Realm roles: `_tide_enabled`, `_tide_encryptor`, `_tide_decryptor`, `_tide_vault.selfencrypt`, `_tide_vault.selfdecrypt`, `room-alz-biomarkers-reader`, `room-dengue-vax-reader`
- Room groups (the seal): `/rooms/alz-biomarkers` and `/rooms/dengue-vax` each carry only `_tide_encryptor`. Neither carries `_tide_decryptor` or its reader role, so members can deposit but nobody can read until a quorum change request maps them.

## 4. Quorum-enforced governance (IGA, Tide mode)

A governed admin write is not applied; TideCloak answers **HTTP 202** with a change request. Real response when we added the per-room reader role:

```json
{"status":"PENDING","changeRequestId":"458adb5f-1817-4fa0-952c-f586f7d9bdda","entityType":"ROLE","actionType":"CREATE_ROLE","message":"Change request created — awaiting approval"}
```

Change requests on the realm (read back via `GET /admin/realms/consortium/iga/change-requests?status=...`):

| Status | Count | By action |
|---|---|---|
| APPROVED | 266 | ADOPT_* x263 (baseline adoption when IGA was switched on), CREATE_ROLE x2 (the two `room-*-reader` roles), CREATE_USER x1 (the first admin) |
| PENDING | 0 | |

These were approved in first-admin mode (before any `tide-realm-admin` exists, threshold 1, as Tide's bootstrap does). After the first admin enrols, approvals switch to enclave signatures with a threshold of `max(1, floor(0.7 x admins))`, which is 2 of 3 for three institution admins.

## 5. Adapter config exported for the app

`app/data/tidecloak.json` (gitignored) contains Tide's extensions, which only exist on a licensed realm with IGA on:

`auth-server-url, backgroundUrl, client-origin-auth-http://localhost:3000, client-origin-auth-http://localhost:8080, confidential-port, gVRKCertificate, gVVK, homeOrkUrl, jwk, logoUrl, obfGVVK, orkUrl, payerPublic, public-client, realm, resource, ssl-required, thresholdN, thresholdT, vendorId, vvkId`

with `thresholdT=14`, `thresholdN=20`, `homeOrkUrl=https://ork1.tideprotocol.com`. The live app loads this file: `withAuth` verifies tokens against its `jwk`, and room policies are signed for its `vendorId`.

## 6. Outage: why no Tide account could be created

| Time (MYT) | What happened |
|---|---|
| ~14:35 | In the Tide enclave, "Create an account" failed: `Error creating user account`. Browser console: request to `https://ork2.tideprotocol.com/Authentication/Create/SetCMK` failed (CORS / `net::ERR_FAILED`). |
| 14:38 to 14:45 | Probing `https://ork2.tideprotocol.com/` from the Codespace: HTTP 000 after 40 s, 200 after 28 s, then `503 upstream connect error or disconnect/reset before headers ... delayed connect error: Connection refused`. ork3 and ork7 also flapped. Creating a new account needs every selected ORK to answer. |
| ~16:05 | After ork2 recovered, the enclave refused new accounts with "max user created, contact admin" (`TIDE-ORK-VOUCHER-SUBSCRIPTION_EXCEEDED_CONCURRENT`), probably because earlier half-completed attempts used up the free-tier allowance. |
| 16:14 and 16:18 | A fresh realm (`treatyroom`) could not be licensed: `setUpTideRealm` returned `TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`. Server log: `Initialized subscription for realm treatyroom on tier free, awaiting vendor payment` then `[Midgard] FinalizeWallet failed: HttpRequestException: Response status code does not indicate success: 500 (Internal Server Error).` |

Separately, the venue network intercepted TLS for `*.tideprotocol.com` (`SEC_E_UNTRUSTED_ROOT` from the laptop), so the browser reached Tide through an SSH SOCKS proxy via the Codespace.

## 7. What this does and does not prove

- **Proven live:** TideCloak running the official image; realm licensed with a Tide vendor key; IGA in Tide mode; governed writes become change requests (HTTP 202); the room seal model (groups with `_tide_encryptor` only, per-room reader roles) exists in the real realm; Tide adapter config exported.
- **Not proven live:** Tide login, enclave signing of the room policies, and `RelationshipAttestation:1` encrypt/decrypt on the Tide network. All three need an enrolled Tide account, which the outage prevented. The code paths are in `app/src/lib/tide/relationship.ts` (Tide's helper, unchanged) and `app/src/app/room/page.tsx`; the walkthrough mode replays the same checks with a simulation.

## Reproduce

With TideCloak running (Option A in `RUN_INSTRUCTIONS.md`) and a master-admin token in `$T`:

```bash
R=http://localhost:8080/admin/realms/consortium
curl -s $R -H "Authorization: Bearer $T" | jq '{realm, attributes: (.attributes | {isIGAEnabled, "iga.attestor": .["iga.attestor"]})}'
curl -s "$R/iga/change-requests?status=APPROVED" -H "Authorization: Bearer $T" | jq 'group_by(.actionType) | map({(.[0].actionType): length}) | add'
```
