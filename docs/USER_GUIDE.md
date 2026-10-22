# Treaty Room user guide

This guide describes the app on the `main` branch. Every button, chip and message quoted here is copied from the source code under `app/src`. To start the app, follow `RUN_INSTRUCTIONS.md`, then open <http://localhost:3000>.

## 1. What Treaty Room is

Treaty Room is a shared research room for rival institutions: members encrypt unpublished results in their own browser and deposit them, and the server stores ciphertext only. Whether anyone may decrypt is decided by the Tide network against a policy signed for that room, not by our server, so neither the platform operator nor a database thief can read a deposit. Admitting a member or opening (unsealing) a room is a TideCloak change request that a quorum of institution admins (2 of 3) must sign in their own Tide enclaves, and until then a deposit stays sealed even to its author.

## 2. Roles

Access comes only from your verified Tide token: room membership is the token's `groups` claim (group `/rooms/<room-id>`), and admin rights are the `tide-realm-admin` role. The institution you pick in the profile dialog is a label shown to collaborators and grants nothing.

The two rooms (from `app/src/lib/rooms.ts`):

| Room | Room id | Institutions |
|---|---|---|
| Alzheimer's blood-test consortium | `alz-biomarkers` | Northbridge University, Helix Therapeutics, St Aurelia Hospital |
| Dengue vaccine safety signals | `dengue-vax` | Sunway Institute, Helix Therapeutics, KL General Hospital |

### Researcher (member of a room group)

You are a member of a room when your token carries the group `/rooms/<room-id>`.

Can:
- See every room on **Research rooms** (a room's existence is not secret).
- Fetch the room's deposits (as ciphertext) and its signed policies.
- Deposit an encrypted result once the room's deposit policy is signed. The Tide network also checks that your token holds `_tide_encryptor`, which the room group carries.
- Open deposits only after the room is unsealed. The Tide network checks that your token holds both `_tide_decryptor` and `room-<room-id>-reader`.
- View the **Governance** page (pending change requests and **Activity**).

Cannot:
- Read any deposit before the room is unsealed, including your own.
- Sign room policies, propose changes, admit anyone, or use **Force as operator**.

### Outsider (signed in, not in the room group)

Can see the room, its institutions and its deposit count, and can click **Request to join**. Cannot fetch its deposits or policies: the server answers "Not a member of this room".

### Institution admin (`tide-realm-admin`)

Admins get an **admin** chip next to their name in the top bar. The role is granted in TideCloak, not in the app.

Can:
- Sign a room's two policies, once per room (**1. Sign deposit policy**, **2. Sign reading policy**).
- File change requests from their own browser: **Propose unseal: Alzheimer's blood-test consortium** (one button per room) and **Propose admission** for each join request.
- Approve pending change requests with their own Tide enclave in the Tide console (**Sign in Tide console**).
- Use **Force as operator** on the Governance page (red-team demo, needs `DEMO_RED_TEAM=1`).

Cannot:
- Admit a member or unseal a room alone. A proposal only files a change request (HTTP 202); it takes effect when 2 of 3 institution admins sign it.
- Replace a signed policy. The server refuses with "The write policy for this room is already signed" (or "read").
- Read a room just by being admin. Reading still needs membership of the room group and an unsealed room.

The quorum is TideCloak's realm-wide admin threshold, `max(1, floor(0.7 x admins))`, which is 2 of 3 with three enrolled institution admins.

### Platform operator (red-team view)

This is not a Tide role. It stands for whoever runs the server: they hold the database file (`app/data/store.json`) and the TideCloak master-admin password. The **Operator view** page plays that person. It is off unless the server runs with `DEMO_RED_TEAM=1`; when on, any signed-in user can open it.

Can: see everything the platform stores, which is ciphertext plus metadata (room, author name, institution, kind, time), the signed room policies, profiles, join requests and the activity log.

Cannot: decrypt a deposit (the Tide network checks the identity of whoever asks, not the stolen data), or approve a change request with the master-admin key (TideCloak refuses in multi-admin Tide mode).

## 3. Signing in with Tide

1. Open the app. The landing page shows **Sign in with Tide** (or **Enter your rooms** if you are already signed in). Every other page (Rooms, Governance, Operator view) shows a **Sign in to Treaty Room** card with the same **Sign in with Tide** button until you sign in.
2. Click **Sign in with Tide**. Tide's enclave opens (allow pop-ups for `http://localhost:3000`). Sign in, or create a Tide account, inside the enclave. Your password goes to the Tide network, never to Treaty Room.
3. After the redirect ("Completing login..."), the app loads your identity from the verified token.
4. First time only: the **Introduce yourself** dialog appears, because Tide accounts carry no name or email.
   - **Display name**: what collaborators will see (for example "Dr. Aisha Rahman"), up to 80 characters.
   - **Institution**: choose one of Helix Therapeutics, KL General Hospital, Northbridge University, St Aurelia Hospital, Sunway Institute.
   - Click **Continue** (disabled until a name is entered). Your name and institution then show in the top bar.
5. To leave, click **Sign out** in the top bar.

Signing out and back in is also how you pick up a change that a quorum approved: your new token carries the new group or roles.

## 4. Step-by-step tasks

Open **Rooms** in the top bar to see **Research rooms**. Each card shows **Member** or **Not a member**, either **Network-enforced policies** or **Policies not signed yet**, and how many encrypted posts the room holds. Click a card to open the room.

At the top of a room, **The treaty** card shows three chips:

| Chip | Meaning |
|---|---|
| **Member** / **Not a member** | Whether your token has the room's group |
| **Can deposit** / **Cannot deposit** | Whether you are a member and your token holds `_tide_encryptor` |
| **Read: SEALED** / **Read: OPEN** | Whether your token holds `_tide_decryptor` and `room-<room-id>-reader` (only after an unseal is committed and you signed in again) |

### a. Admin: sign a room's two policies (once per room)

1. Sign in as an institution admin and open the room.
2. The card **Sign this room's policies (realm admin, once)** appears while either policy is unsigned. It shows for admins even if they are not members of the room.
3. Click **1. Sign deposit policy**. The status line reads "Opening your Tide enclave to sign the policy...". Sign in the Tide enclave pop-up. On success: "Deposit policy signed: the Tide network now lets room members encrypt into this room." The button becomes **Deposit policy signed**.
4. Click **2. Sign reading policy** and sign again in the enclave. On success: "Reading policy signed: only holders of room-alz-biomarkers-reader can decrypt, and that takes a quorum-signed change request." (with the room's own id). The button becomes **Reading policy signed**.
5. The card disappears and the room shows **Network-enforced policies** on the Rooms page. A signed policy can never be replaced from the app.

### b. Member: deposit an encrypted result

1. As a member, open the room. The **Deposit a result** card appears once the deposit policy is signed.
2. Fill in **Type** (Finding, Dataset or Question), **Title** and **Details**, or click **Load my synthetic example** to fill in a synthetic result for the institution in your profile.
3. Click **Encrypt & deposit** (enabled once Title and Details are filled). The status line reads "Encrypting in your browser via the Tide network...", then "Deposited. The server stored ciphertext only."
4. Your deposit appears under **Deposits** as ciphertext with a **Sealed** chip.

### c. Member: try to open while sealed

1. Under **Deposits**, click **Open** on one deposit, or **Open all** (both appear once the reading policy is signed).
2. The status line reads "Asking the Tide network to open...". While the room is sealed the Tide network refuses, even for the author.
3. The refusal looks like this: the status line turns red with the network's error, and each deposit you tried keeps its **Sealed** chip and ciphertext with a red line underneath that starts "Tide network refused:" followed by the error the Tide network returned.
4. The treaty card still shows **Read: SEALED**. This is the expected result until task (e).

### d. Outsider joins: request, propose admission, quorum approves, sign in again

1. Outsider: open the room. The card **You are not in this room** appears. Click **Request to join**. The status line reads "Request recorded. An institution admin must propose your admission, and a quorum of institution admins must sign it in their Tide enclaves." Nothing is granted yet.
2. Admin: open **Governance**. Under **Propose (institution admins)**, the join request is listed with the person's name, institution and room id. Click **Propose admission**. The output box reads `Admit <name> to <room-id>: change request filed (HTTP 202). It takes effect only when a quorum of institution admins sign it.`
3. The request appears under **Waiting for signatures** with its signature count (`<n> of <threshold> signed`) and who has signed. Click **Refresh** to update the list.
4. Quorum: each approving institution admin clicks **Sign in Tide console** (opens the TideCloak Tide console in a new tab), reviews the change request and approves it with their own Tide enclave. Once 2 of 3 have signed and the request is committed in the console, the change takes effect.
5. Outsider: back in the room, click **Approved? Sign in again**. This signs you out; sign in with Tide again. The room now shows **Member**.

### e. Admin unseals the room (2 of 3), members refresh and open

1. Admin: on **Governance**, click **Propose unseal: Alzheimer's blood-test consortium** (or **Propose unseal: Dengue vaccine safety signals**). This one change request maps `_tide_decryptor` and `room-<room-id>-reader` onto the room's group. The output reads `Unseal <room-id>: change request filed (HTTP 202). It takes effect only when a quorum of institution admins sign it.`
2. Until a second admin signs, the request sits under **Waiting for signatures** and nobody can read. One admin alone cannot open the room.
3. A second institution admin clicks **Sign in Tide console** and approves the request with their own enclave (2 of 3). Once it is committed, the room is unsealed for every member at once.
4. Members: in the room, click **Refresh access**. This signs you out; sign in with Tide again so your new token carries the reader roles. The treaty card now shows **Read: OPEN**.
5. Click **Open all**. On success the status line reads "Opened N deposit(s) in your browser." and each deposit shows **Opened** with its title and details. Decryption happens in your browser.

### f. Operator view (only when `DEMO_RED_TEAM=1`)

1. Click **Operator view** in the top bar (or **See what the platform sees** on the landing page). The page **What the platform sees** lists **Encrypted posts in our database** and a **Raw database file** dump: room, author, institution, kind, time and ciphertext for every post, plus signed policies, profiles, join requests and the activity log. Metadata is visible; content never is.
2. Click **Try to decrypt with the stolen data** under a post. The app asks the Tide network to decrypt with the stolen ciphertext and policy, using your own signed-in identity:
   - Not an approved member of an unsealed room: "Tide network refused:" followed by the network's error.
   - Room has no reading policy: "No reading policy for this room".
   - You are a member of an unsealed room: `Decrypted - you are a member of <room-id>:` followed by the start of the text. The stolen data added nothing; your own access did.
3. **Force as operator** (Governance page, in the **Waiting for signatures** table, shown to realm admins only): the server uses the TideCloak master-admin password to call `authorize` and then `commit` on that change request. The output box shows TideCloak's answer to both calls verbatim (HTTP status and body). In multi-admin Tide mode TideCloak refuses, because approvals must be enclave signatures from the admins' own browsers, so the request stays pending. **Activity** records `Platform operator tried to force-approve change request <first 8 characters of id> with the master-admin key`.
4. If the server runs without `DEMO_RED_TEAM=1`, the page shows "Operator view disabled (set DEMO_RED_TEAM=1)" and **Force as operator** answers "Red-team demo disabled (set DEMO_RED_TEAM=1)".

## 5. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The Tide enclave does not appear after **Sign in with Tide**, or a signing click stays on "Opening your Tide enclave to sign the policy..." | The browser blocked the Tide enclave pop-up (Tide uses it for sign-in and every signature). Allow pop-ups for `http://localhost:3000` and click again. |
| A change request was approved but your access did not change (still **Not a member** or **Read: SEALED**) | Your token predates the change. Click **Refresh access** (members) or **Approved? Sign in again** (outsiders), or **Sign out** and sign in again. If it still has not changed, check **Governance**: the request may still be under **Waiting for signatures** or not yet committed. |
| "Not a member of this room" | The server's answer when your verified token lacks the room's group. In the room you see **Not a member** and **You are not in this room**. Use **Request to join**, wait for the quorum, then sign in again. |
| "Room not sealed yet", **Policies not signed yet**, no **Deposit a result** card, or no **Open** / **Open all** buttons | The room's policies are not signed. A realm admin must click **1. Sign deposit policy** (enables depositing) and **2. Sign reading policy** (enables opening). |
| **Read: SEALED** although both policies are signed | Expected: the room is still sealed. It opens only after an unseal change request reaches 2 of 3 signatures and you sign in again. |
| "Realm admins only" | That action needs the `tide-realm-admin` role. |
| "Already a member" after **Request to join** | Your token already has the room group. Reload the room. |
| Creating a Tide account fails in the enclave ("Error creating user account", or "max user created, contact admin") | This is on Tide's side, not in the app. See `docs/evidence/live-tidecloak.md` for what was observed on 22 Oct 2026. Try again later or contact Tide. |

## 6. Honest note

On 22 Oct 2026 Tide account creation was blocked on Tide's side (ORK nodes failing, then the free-tier account allowance exhausted; details in `docs/evidence/live-tidecloak.md`). As a result, the live flows in this guide (Tide login, enclave signing of room policies, and encrypt/decrypt on the Tide network) were verified in the code on `main` and on the `walkthrough-demo` branch, not end to end with a live Tide account. The realm itself was licensed live, and governed admin writes returning HTTP 202 change requests were observed live. The demo video was recorded from `walkthrough-demo`, which has a simulated persona sign-in; `main` has no simulated sign-in and requires Tide login.
