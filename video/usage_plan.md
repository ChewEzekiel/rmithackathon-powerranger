# Demo video v3: "how a researcher actually uses Treaty Room"

Real screen recordings of the app (walkthrough mode, recorded by `video/record_flow.mjs`) in `video/rec/*.mp4`,
Blender hero shots in `video/blender/*.mp4`. Voice: en-US-AndrewMultilingualNeural (+6%). Total <= 120 s.
Recordings are longer than needed: trim/speed them (setpts) to fit each narration line; never cut a result off screen
(the refusal banners, "1 of 2 signed", "Quorum reached", the opened plaintext must be readable for >= 1.2 s).

| # | id | visual | narration (lively, accurate) |
|---|----|--------|-----------|
| 1 | intro | blender/sealed_deposit.mp4 + title "Treaty Room" | What if rival labs could pool their unpublished results, without trusting anyone to hold them? Meet Treaty Room. |
| 2 | signin | rec/01-signin.mp4 | Dr Mei Lee runs an Alzheimer's lab at Northbridge University. She signs in with Tide. No password ever lands on our server. |
| 3 | deposit | rec/02-seal-and-deposit.mp4 | She opens the consortium room, signs its access policy once in her Tide enclave, and deposits a failed drug result. It's encrypted right in her browser. |
| 4 | sealed | rec/03-sealed-for-everyone.mp4 | Helix and St Aurelia deposit too. Now watch: Mei tries to open the room. Refused. Even her own deposit stays sealed. |
| 5 | operator | rec/04-operator-view.mp4 | Here's everything we, the host, can see. Ciphertext. Steal the whole database, try to decrypt it, and the network says no. |
| 6 | rogue | rec/05-rogue-steward.mp4 (+ 06-still-sealed.mp4 tail) | Now an insider. Helix's admin proposes unsealing the room and signs it himself. One of two. Stuck. Even our master admin key can't force it. |
| 7 | treaty | rec/07-treaty-cosign.mp4 then blender/vault_unseal.mp4 | St Aurelia's admin reviews it and co-signs in her own enclave. Two of three. Quorum. The treaty opens the room. |
| 8 | open | rec/08-room-opens.mp4 | Back to Mei: everyone's results open at the same moment. Nobody went first, nobody got scooped. |
| 9 | why | blender/ork_ring.mp4 + 2-line caption | Why TideCloak? The key never exists in one piece. Tide's nodes check every request, and access changes only with a quorum of enclave signatures. |
| 10 | close | close card + disclosure line | Treaty Room, by Team Sunway PowerRanger. This walkthrough simulates the Tide network calls, because Tide's public nodes were down while we recorded. The live code is in the repo. |

Caption on every recorded scene: short key phrase. Small persistent corner tag on recordings: "Walkthrough mode (Tide calls simulated)".
