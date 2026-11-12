epic:#31527#1 · os-bill · session_01Utp6CYGYEUhpi29FpjLmxT

## Epic #31527 handover to the new account · {{NOW}}

The maintainer moved this epic and its server seats to another agent account (11-12 12:08Z). The new seats cannot read the old project's shared folder, so every handover note is copied here. Paths under `/mnt/project-files/` and `cmsg_…` thread ids refer to the old project and are kept only as provenance. Private items are named by GHSA id only. Epic seat 2's note is not included yet; it will follow in a separate comment.


---

# Epic #31527 seat 1 (ADR-0150) handover, 2026-11-12 12:06Z

Written in case Bill moves the epic to another account. The seat's running log is in team memory `epic-31527-seat-takeover-1111.md`; card notes are `card-*.md` in team memory and `/mnt/project-files/epic-31527/card-*/`.

## The serial chain (the seat lands these itself)

| Order | Card | PR | Head | State |
|---|---|---|---|---|
| 1 | #31696 PR-3 | #32507 | b96b87579 | MERGED. ADR-0087 entry fix #32697 MERGED 11:37Z. |
| 2 | #31700 | #32513 | f74084f60 | ACCEPT 6822947309, in merge queue (12:00Z). Merge read 6822531742. |
| 3 | #32183 | #32497 | 8ec8d78ea | r4 PASS: CR 6821393023, red-line 6821404403, text delta 6821456566. r4 body applied. Card thread 7nm31Z (cmsg_016iMXWSZDzqWRWvWzdNo8wg7nm31ZnSoWKdR5KwdduBdq) merges main the moment #32513 merges, with the landing duties of 6815997281 (judgePicklistArrival includeDisabledPackages + pin; #32507's flow doors held at main under R4-G + parity pins, widening to #32670; storeRemovalKeys both sides; check #31700's picklist family). It reports the size before pushing. **Over 3,000 lines is expected, so Bill reviews it** (ACCEPT four-piece + request review). Follow-up pins #32705. |
| 4 | #31699 PR2 | #32577 | — | R3 ruling 6820856607: only M1 blocks (redelivery with no package counts holdersOf(name), ≥2 refused). Seat reads the M1 delta, lands after #32497. Three follow-up cards under #31699. |
| 5 | #31699 PR3 | — | — | owes connectorNameRefusal. |
| 6 | #31985 | #32558 | c86bfb66 | Draft, server seat 5's. Lands after #31696 PR-3, #31700, #31699 PR2-3. |

## Card threads to pick up (this project)

- #31700 / PR #32513: thread cmsg_016iMXWSZDzqWRWvWzdNo8wg3Q9GGj4YD1Kqoi6WF8xMrm. In the merge queue since 11:57Z (merge sha will be 94a830662 if it lands). If kicked out, the thread writes the reason under the card folder.
- #32183 / PR #32497: thread cmsg_016iMXWSZDzqWRWvWzdNo8wg7nm31ZnSoWKdR5KwdduBdq (branch claude/project-thread-phk4r9). Told at 12:09Z to push everything, write landing-plan.md in card-32183/, merge main once #32513 lands, and NOT queue. The new seat reads that merge, writes ACCEPT (four-piece, over 3,000 lines) and asks Bill to review.
- #31699 PR2 / PR #32577: thread cmsg_016iMXWSZDzqWRWvWzdNo8wgV1Wp8HYsu2keXwrYrCpGHZ (branch claude/project-thread-3giljf, head 938f948b2 at 12:08Z). Told to push M1 + text fixes and write status to card-31699-pr2/.
- Epic seat 2: thread cmsg_016iMXWSZDzqWRWvWzdNo8wgGrVv491rC2z73wxPqDJRJY (#32560; #31698 PR-2 in "Land #31698 PR-2" cmsg_016iMXWSZDzqWRWvWzdNo8wgDTbCHNDqhiJkWnspTJ3Jwd).
- Server seats 2/3/5 handovers: handover-seat2.md, handover-seat3.md, handover-seat5.md in this folder.

## Rulings in force

- Maintainer 09:41Z: only correctness, red-line or security issues block a merge; everything else becomes a follow-up card. No extra rounds.
- Landing order of the server PRs (now with the new server seats): #32569 → #32687 → #32676. The last two both adopt `pluralEntryKeys`. #32566 red-line re-read PASS at e020075ca; it lands on green.
- #31698 PR-2 (epic seat 2): stricter permission predicate accepted. Conditions: one named predicate shared by install and save doors; FROM → TO "not moved" rows + pins for sys+crm, base+crm, guest_portal; row 9 re-measured against main after the merge. needs_decision comes to the seat before landing.
- Released to the general server lane (mailbox #32580): #32600 #32624 #32622 #32605 #32662 #32606 #32680 #32681. Outside lanes ask for the red-line read by commenting on #31527.
- #31527 is at GitHub's 100 sub-issue cap: nest new cards under their source card.

## How the seat writes

- Only through the relay: `post-stamped.mjs --comment=N --repo=objectstack-ai/objectstack < file`, `label-write.mjs --issue N --comment-file F --land`, `fleet-write/dispatch.mjs --repo … --actions-file F`, `issue-create.mjs`. No GitHub MCP writes. Never print env values.
- Reviews and red-line reads run in fable subagents and come back as records; the seat posts them.


---

# Handover: server seat 2 → epic seat 1 (2026-11-12 12:10Z)

From `domain:server#2 · os-bill · session_01Utp6CaP1iy4RSEQbW6177G`. Bill 12:03Z 「server 车道已经卡发完的pr能交给下一席位吗？」, 12:06Z 「本地分支全部推」, 12:08Z 「同意你的方案」 (the epic moves to another account). Fuller notes: /mnt/project-files/server-seat2-p2/handover.md; seat log: /mnt/project-files/server-seat2-p2/seat-log-1111.md.

Landing order: **PR #32569 first, then PR #32687.**

| Card | PR / branch | Head | Waits on | Open review items | Review / red-line ids |
|:--|:--|:--|:--|:--|:--|
| #32351 | PR #32569 · `claude/project-thread-zflfxt` | `1776d3034e9757311b6820a016cd942e3b6e98d7` (card thread 12:2xZ: main merged onto fd541692b to start CI; one conflict in `DatabaseLoader.registerRollback` vs #32540, resolved by picking #32540's member row within the one slot `rollbackSlot` chose; metadata suite 74 files / 1631 passed, M1/F2 CONTROL 7/7, metadata tsc 0; a source change, so the delta wants a contract look) → then seat record (draft: /mnt/project-files/server-seat2-p2/card-32351/seat-record-draft.md, fill `K_LINE`/`CHECKS_LINE`), pointer on #32351, ready + automerge | none blocking; nits → #32717; eviction → #32636 | contract: r1–r3 PASS 6818786105 (fe88538bd), r4 NO PASS (dabfcb615, M1), r5 PASS-with-nits (1d4ef3337, local record; fd541692b = one changeset line). Red-line: No PASS 6818909551 → ruling 6818953020 → F2 6820873174 → PASS 6822596301 (confirmed for fd541692b) |
| #32517 | PR #32687 · `claude/project-thread-4tivnv` | `d9e9676c87893bb2082a7650fa92e904b3b5473f` | #32569 merging; then the card thread merges main and does (a) `environmentStoreKey` → `memberKeyOf(type, slotIdentityOf(type, name, data), data)` + `writeRegistryEntry` 4th-arg check + non-canonical-locale rollback pin, (b) re-verify the action fold in `pluralEntryKeys` against #32651, re-run the 3 pin files, restate the rule, (c) full gates + dogfood → contract delta + epic short red-line read → land. Trial-merge vs `skucll` (#32676): ruled #32687 first, #32676 adopts `pluralEntryKeys` after | none blocking; nits → #32714; composed activation 404→409 → #32689 | contract: r1 NO PASS (cf96064ea; M1 merge, M2 order, S1, S2), r2 PASS-with-nits (d9e9676c8, local record). Red-line: PASS 6821412191 (cf96064ea), PASS 6822608066 (d9e9676c8); body updated via relay 11:50Z |
| #32451 | no PR · `claude/project-thread-twntru` | HEAD_32451 | blocker #32447 merged 11:59Z; card thread told 12:06Z to merge main and push WIP (no PR). Remaining: finish ruling 6819919065's Owed list (pins 1–7, declarations, docblocks, cluster.mdx §6.2), open draft PR, contract review, epic red-line read | n/a (pre-PR) | claim 6819638822 + amendment; step-0 ruling 6819919065; Q4 card #32663 |

Card threads: #32351 KMSVrr `cmsg_016iMXWSZDzqWRWvWzdNo8wgKMSVrrddtWZzQ9rWDugJCC` · #32517 38xLzm `cmsg_016iMXWSZDzqWRWvWzdNo8wg38xLzmffQZvAGqE2vPd7Ta` · #32451 5JB3J1 `cmsg_016iMXWSZDzqWRWvWzdNo8wg5JB3J13AWAKQLWP1bgYv2A`. All three told to report to your thread.

Handed back unstarted: #32600. Landed today: #32435, #32349, #32369, #32161, #32411, #32516 (PR #32652), #32164 P2 (PR #32306).



---

# Server seat 3 handover (2026-11-12 ~12:06Z)

From `domain:server#3 · os-bill · session_01Utp6CaAUev5V62cLHhQwBi` (thread cmsg_016iMXWSZDzqWRWvWzdNo8wgJSRdLSMks47MshHcmtLwgx), going off duty per Bill 11:03Z / 12:03Z.
**Taker (Bill 12:05Z, relayed by epic seat 1): a NEW server seat on another account**, not epic seat 1. Each card thread below keeps working and reports to the new seat once it introduces itself in the card thread. Until then they hold.

Common orders: `/mnt/project-files/server-seat3-p2/epic-common.md` (incl. the #32649 gate note: `Metadata-protocol` declares the authoring surface only; read-answer narrowing is Clause-② only) and `/mnt/project-files/server-seat3-p2/dispatch-<N>.md`. Seat log: memory `server-seat3-p2-1111.md`. Earlier summary: `/mnt/project-files/server-seat3-p2/handover-1204.md`.

No PR from this seat is open. No contract review or red-line read has been run on any of these yet (none owed until a PR exists). All cards: assignee `os-bill`, `pm:dispatched`, seat-3 claim; the new seat re-claims or amends.

| Card | Thread | Branch | Head (pushed?) | Waits on | Ruling / record ids | Open items |
|---|---|---|---|---|---|---|
| #32250 /data 409 `details.candidates` | cmsg_016iMXWSZDzqWRWvWzdNo8wgAKScZvUefoZc72KMUvhwYC | `claude/project-thread-2g3ujl` | see update below | nothing: #32306 MERGED 10:55Z; thread merging main → gates → dogfood → draft PR | claim 6817626155, ruling 6817764528 (F1=A, F2=A) | PR says `Fixes #32250`, `Refs #32622`; Clause-② yes widening; Metadata-protocol none. Owed: CR (fable), red-line read, seat record, landing. |
| #32501 pair-address envelope | cmsg_016iMXWSZDzqWRWvWzdNo8wgUbBVParFKYHnyTJN5njrSW | `claude/project-thread-3jrz5i` | `4429ad3a0d361b526d6bc68dec0cbb27d3905512` **NOT pushed** (push refused by the session's permission check without Bill's own word); bundle `/mnt/project-files/server-seat3-p2/card-32501/wip-3jrz5i.bundle` (relative to phk4r9 `8ec8d78e`, verified) | PR #32497 merge; pushes FIRST of the phk4r9 family | claim 6817588127, rulings 6817871252, 6817992172 | Metadata-protocol none, patch + BREAKING banner (maintainer word at landing). Accepted deviation: flip of a4b57cf4's objectql pin (fefcc153). |
| #32354 stored rows by save order | cmsg_016iMXWSZDzqWRWvWzdNo8wg3TFVirQgJEZsnCnm8jmVxW | `claude/project-thread-pv4nip` | `fd41963c156d383d1d8851c9895e19bb4add225c` **pushed** (no PR) | #32497 merge, then merge pushed 3jrz5i (2 runtime reds turn green with #32501 F1) | claim 6817604765, ruling 6817756360 | Metadata-protocol none (accepted). Patch for dependants: `card-32354/32354.patch`. |
| #32292 dataset query admission order | cmsg_016iMXWSZDzqWRWvWzdNo8wgHfBYp3Uh1cu3JriWjcDohz | `claude/project-thread-elxrlt` | see update below; WIP patch `card-32292/wip-b60e9776.patch` | #32497 merge | claim 6817615501, ruling 6817809380 | limb 1 only; limb 2 withdrawn (census in PR). |
| #32607 two enabled row holders | cmsg_016iMXWSZDzqWRWvWzdNo8wg1f33kecVjqjj9BwvdvPbu5 | `claude/project-thread-j3i5j5` | see update below; patches `card-32607/patches/` | #32497 AND #32354's PR merge (branch carries #32354's patch applied) | claim 6819852006, rulings 6820000598, 6820653691, 6821134180 | surface + `rest-server.ts` step 1b (A1); #28337 pins kept. |

Handed back earlier (unclaimed, not started): #32605, #32624 + #32622 (one PR), #32662.
Landed today by seat 3: #32617 (#32395 self-closes on the next green nightly).

## Head updates (appended as threads report)
- #32292: `claude/project-thread-elxrlt` pushed @ `339584f66cd2ccab69965e45a421dc422fa5192d` (own b60e9776 + blocker 8ec8d78e merged), no PR.
- #32354: `claude/project-thread-pv4nip` pushed @ `fd41963c156d383d1d8851c9895e19bb4add225c`, no PR.
- #32607: `claude/project-thread-j3i5j5` pushed @ `f073c310e871c609db786890d22b1e0497f1d420`, no PR. Carries #32354's patch copy as commit cb73bf6c (base phk4r9 8ec8d78e); pv4nip is now pushed (fd41963c), so merge it in and drop the copy.
- #32250: `claude/project-thread-2g3ujl` pushed @ `2abf1d1d95ce` (main 6bbdf301 merged, no rebase; ~550 lines, 11 files; gates/lint/dispatch-gates clean; full dogfood running; draft PR next). After the main merge, the dispatcher's bare action `/layers` and `/published` (#32365) also carry `details.candidates`, pinned on all three doors, and #32365's comment was corrected. The new seat should check that row at review.
- #32501: NOT pushed (permission check refused without Bill's own word). Local head `4429ad3a0d36…`; bundle `/mnt/project-files/server-seat3-p2/card-32501/wip-3jrz5i.bundle`. It pushes when #32497 merges.
- #32501 (update 12:06Z, Bill 「本地分支全部推」): `claude/project-thread-3jrz5i` pushed @ `4429ad3a0d361b526d6bc68dec0cbb27d3905512`, no PR. All five branches are now on origin.


---

# Server seat 5 handover → new server seat (2026-11-12 12:10Z)

Translated by epic seat 1 from the seat's own note. Taker (Bill 12:05Z): a **new server seat on another account** takes over review and landing of every PR and branch below. Card threads report to it; until it arrives they write to their own card folders. The epic seat still owes the red-line re-read before each landing.

Landing order (ruled by epic seat 1): #32569 → #32687 → #32676. #32687 and #32676 both adopt the landed `pluralEntryKeys`; #32676 drops its own `pluralEntryKey` + `namesSeveralPackagesHold`.
Rules unchanged: fable contract review on every head, plus the epic red-line re-read, before ACCEPT. Simple issues become follow-up cards nested under their source card (#31527 is at the 100 sub-issue cap). Security findings go to security#1, never public.

## Open PRs

| Card | PR / head | Thread (branch) | Waits on / next |
|---|---|---|---|
| #32407 | #32566 @ `e020075ca5188b51404c4f945973d5f955901499`. CR PASS 6815792757; red-line PASS 6815747396, re-read PASS 6822507859. No open items. | ti4ue1 | **Queued** 11:49Z (ACCEPT 6822763557, pointer 6822776171). After it merges: landing note on #32407, drop `pm:dispatched`, tell cyidlz (#32568 can push). #32497's main merge must resolve one test conflict this PR brings (`cli` `stored-package-references.literal-namespace.test.ts`). Follow-up #32716 filed. The new seat subscribes to the PR itself. |
| #32521 | #32676 @ `2126b08ccc6796b6b5c74015340cca7618b7ad33` (CI green). CR PASS 6820408972 → delta PASS 6821787622 (D1 should-fix fixed in af25f64c, not yet reviewed). Red-line read: none yet. | skucll | After #32687 merges: merge main, adopt `pluralEntryKeys`, re-measure and re-declare `flow` (b96b8757 added flow to `PACKAGE_SLOTTED_STORE_TYPES`; the changeset's "five types" and row 11 no longer hold), re-run both pin sets, write needs-decision for any door where answers diverge. Then one fable delta review (D1 + #32687 merge + flow), red-line re-read, land. Follow-ups #32680, #32681 (under #32521). |
| #32408 | #32557 @ `075fb3188b5aec8cd9d572ef7f48516562ce23cb` (draft). CR PASS 6815340803; red-line PASS 6815300751. No open review items (one changeset wording nit rides the main merge). | 3e08el | Waits on #32497. Then merge main with the wording nit and the ADR-0087 semantic entry `18.pair-row-locale-addition-refused` (marker `adr-0087: registered …`). Seat checks the net diff, trial-merges, seat record, lands. Unblocks #32552 and #32561. |
| #31985 | #32558 @ `c86bfb66` (draft). No CR or red-line read yet. | x8suof (F87Pkr) | Waits on the cloud reading (#32003, request 6813913417) and the chain (#31700/#32513, #31699 PR2/PR3). `Metadata-protocol: added`, not affected by the ADR-0087 gate. |

## Pushed branches, no PR (blocked)

All four pushed 12:08Z (Bill 12:06Z 「本地分支全部推」), read back with ls-remote. No CR or red-line read yet.

| Card | Branch `claude/project-thread-*` @ head | Waits on |
|---|---|---|
| #32568 | cyidlz @ `191cd2fabb3a75bf3e6c8b445e414f60b768c365` (+476 −60, on 238b9ee69) | #32566 merges → merge main, push, draft PR, report; then CR. |
| #32613 | 70eqr9 @ `b0c90e96c` (main pre-merged 0410fcf5; 7 files +270 −16) | #32568 merges. |
| #32552 | qul92e @ `73391d51c639f158645f64badda2f57b617fd4cc` (5 files, 296 lines) | #32557 merges. Trial-merge with #32568/#32613 and the epic red-line read before landing. Private item: GHSA-ghqj-qx2q-5g7v (security#1). |
| #32561 | u392g8 @ `65a7c73f4b5581f7fbde3ed4db09b1bfd2591e0c` (on 075fb3188, 3 commits) | #32557 merges. #32606 follows it. |

## Parked (not epic)

- #31948 / PR #32194: `pm:on-hold`, draft; waits on the security owner's activity-gate item (queue failure 04:32Z in Dogfood activity-parent-read-gate).

## Handed back, unstarted

#32606, #32680, #32681, #32716 (#32716 filed 11:45Z under #32407, triage knocked).

## Seat stopped

Patrol trigger off. Mailbox PR #32509 is unattended after the handover.
