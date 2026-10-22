# Treaty Room app

Next.js 16 app for Treaty Room. Sign-in is Tide only: every page and API route needs a Tide-issued, DPoP-bound token from TideCloak.
Project overview, setup and the user guide live at the repo root: [../README.md](../README.md), [../RUN_INSTRUCTIONS.md](../RUN_INSTRUCTIONS.md), [../docs/USER_GUIDE.md](../docs/USER_GUIDE.md).

## Layout

```
src/
  app/
    page.tsx                 landing ("Sign in with Tide")
    Shell.tsx                nav, Tide sign-in gate, first-time profile dialog
    rooms/ room/             room list; one room: sign policies, deposit, open
    governance/              change requests, propose unseal / admission
    operator/                what the platform stores (DEMO_RED_TEAM=1 only)
    api/                     me, rooms, posts, policy, join, governance, operator (all withAuth)
    auth/redirect/           OIDC callback (Tide template)
    providers.tsx            TideCloakProvider with DPoP (Tide template)
  lib/
    auth/                    JWT + DPoP verification (Tide template)
    tide/relationship.ts     RelationshipAttestation:1 helper (Tide template, unchanged)
    rooms.ts store.ts claims.ts kcAdmin.ts client.ts
scripts/
  init-tidecloak.sh          Tide's bootstrap (TIDECLOAK_EXTERNAL=1 skips starting Docker)
  realm.json.template        realm with room groups, _tide_encryptor/_tide_decryptor, room-<id>-reader
data/
  tidecloak.json             adapter config exported by the bootstrap (gitignored)
  store.json                 ciphertext + metadata store (gitignored)
```

## Run

```bash
npm install --registry=https://registry.yarnpkg.com   # if registry.npmjs.org TLS is intercepted
npm run dev
```

Needs a running, bootstrapped TideCloak and `data/tidecloak.json`; see [../RUN_INSTRUCTIONS.md](../RUN_INSTRUCTIONS.md).
Built on Tide's `nextjs-e2ee-vault` template; files marked "Tide template" above are kept as Tide ships them.
