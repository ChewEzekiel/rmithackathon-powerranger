# Submission check (22 Oct 2026, 17:05 to 17:20 MYT)

Final checks run on `main` before submission. Every result below came from a real run; nothing is estimated.

## 1. Fresh clone (what a judge downloads)

`git clone https://github.com/ChewEzekiel/treaty-room` at the then-latest commit, then:

| Check | Result |
|---|---|
| Repository | Public, default branch `main`, not archived; local and GitHub identical |
| Required files | README, run instructions, user guide, `demo/video.mp4`, `deliverables/{sourcecode.zip, summary.docx, video.mp4, RUN_INSTRUCTIONS.md, USER_GUIDE.md}` all present and non-empty |
| Copies | `deliverables/` copies byte-identical to `demo/video.mp4`, `RUN_INSTRUCTIONS.md`, `docs/USER_GUIDE.md` |
| `npm install` (yarnpkg registry), `tsc --noEmit`, `next build --webpack` | All exit 0; no walkthrough or `/api/wt` routes in the build |
| Video | 1:40, 15.6 MB, H.264 1920x1080 30 fps + AAC 48 kHz; full decode with no errors |
| `sourcecode.zip` | Archive test passes; contains `app/`, no walkthrough code, no `.env` |
| `summary.docx` | Opens with python-docx; about 1,400 words; no em-dash |
| Secrets | No `.env`, adapter config, store, or invite link tracked; the master-admin password appears in neither the repository nor the zip |

## 2. Seven independent reviews

Read-only, each from one angle. Verdicts: rules PASS (with nits), README facts PASS (with nits), docs PASS (with nits), video PASS (with nits), deliverables PASS, security and git history (both branches) PASS (with nits), judge read-through PASS (with nits). No blocker.

- **Rules.** The README follows the official template from `tide.org/unlocked` (badge, project overview, one-sentence description, "Built with TideCloak", the five prompt headings with their comments, a separate Setup section). The overview is 293 words as GitHub renders it, 271 excluding headings. The organisers' page also states that simulated and live integrations are judged the same.
- **Live app.** Sign-in is Tide-only on `main`: every protected API route returns 401 to no token, the old simulated token and forged tokens. "Sign in with Tide" hands off through TideCloak to Tide's own sign-in page (see `login-1-landing.png`, `login-2-tide-enclave.png` and section 8 of `live-tidecloak.md`). Tide's own checker (`tide-doctor.sh --check`) reported 14 of 14 PASS.
- **Fixed after the reviews (wording only, outside the 300-word overview except one word-neutral swap):**
  - outage wording now matches the evidence (ork2 503, ork3 and ork7 flapping);
  - the `FinalizeWallet` 500 is attributed to licensing the second realm;
  - the 14-of-20 figure is labelled as Tide's network threshold;
  - "Refresh access" is described as signing you out;
  - the master-admin refusal is marked as documented by Tide, not observed live;
  - two limitations were added: single-admin policy signing, and the realm-wide quorum;
  - a membership step was added to the demo flow;
  - "rogue steward" became "rogue admin";
  - `app/data/*.json` is gitignored.
- **Known and accepted.** The video was recorded with simulated Tide calls (disclosed on screen and in the docs). The live flows after sign-in could not run because no Tide account could sign in on 22 Oct (`live-tidecloak.md`, section 6). `npm audit` could not run on the venue network.
