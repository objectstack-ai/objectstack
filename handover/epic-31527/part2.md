epic:#31527#1 · os-bill · session_01Utp6CYGYEUhpi29FpjLmxT

## Epic #31527 handover, part 2 · {{NOW}}

This continues the handover above (comment 6823237839).

**Update to server seat 2's #32569.** The head is now `1776d3034` (after the main merge that started CI). It needs a short contract look at the merge delta before landing. The red-line read PASS 6822596301 was taken at `fd541692b`. Landing order is unchanged: #32569, then #32687, then #32676.

---

# Handover · epic #31527 seat 2 (`epic:#31527#2 · os-bill · session_01Utp6Ca5UHVBDE3DqQXgJsW`) · 2026-11-12 ~12:10Z

Reason: this account is low on tokens. Bill agreed to move the epic to another agent account (12:08Z 「同意你的方案」) and said 「本地分支全部推」.
Seat thread: cmsg_016iMXWSZDzqWRWvWzdNo8wgGrVv491rC2z73wxPqDJRJY.
Dispatch orders and card notes: /mnt/project-files/epic-31527-seat2/ (common-tail.md, dispatch-NNNNN.md, card-NNNNN/).
Seat memory: team memory `epic-31527-seat2.md`.

## Landed (closed, pm:dispatched removed)
| Card | PR | Merge |
|---|---|---|
| #32489 | #32547 | 67c49d778d |
| #32412 | #32567 | 3452dec219 |
| #32352 | #32533 | 137cc36b98 |
| #32365 | #32551 | 067349bbe9 |
| #32540 | #32651 | 6b58d7e336 |

## In flight

### #32538 → PR #32718 (p2): ACCEPTED, auto-merge armed
- Branch `claude/project-thread-jhhx6x`, head `5c03334919c0bd69b4a65d537ac5c639f2972b7a`. All pushed; the card thread has stopped.
- Contract review PASS (record on the PR). ACCEPT 6823216639, then `label-write --land` at 12:10Z. When I armed it, only Test Core (1/8) was still running.
- **Next:** confirm it merges. Then remove `pm:dispatched` from #32538 (`label-write --issue 32538 --remove pm:dispatched`). If it is dequeued, re-arm once.
- Follow-up card #32720 (linked under #32538, because the epic is at the 100 sub-issue cap).

### #32560 → draft PR #32719 (p2): contract review NOT done
- Branch `claude/project-thread-4t4jf1`, head `a309114bf448808c476e64a349a420053c422c20`. All pushed; the card thread has stopped.
- Seat ruling 6817582700 (fix 1, 2, 2', 3, 4, 5a, 5b), plus item 6 (disabled-holder customization) from the #32551 round-3 review. os-dev-report 6822928487.
- Contract-review-claim posted at 11:57Z. The review was started and stopped unfinished. **Re-claim on the current head and run CONTRACT_REVIEW_TIER.**
- ⚠ Check specifically: the dev first declared `Metadata-protocol: narrowed`. The ADR-0087 registration gate (#32649 rule) then demanded a semantic migration entry, so the dev changed the line to `none` / patch to pass. Judge whether a bare `GET /meta/action/NAME` going 200 → 409 is a protocol narrowing (compare merged #32551, which declared `none`). If `none` is wrong, it is a red-line must-fix.

### #31698 PR-2 (p1, effort xhigh): building, no PR yet
- Taken over on Bill's 「接手 31698」 (11:05Z). Takeover claim 6821910041 (os-support-ai → os-bill). Claim amendment: branch `claude/project-thread-xsgo56`, dev session `session_01Utp6CawaYjvvL4WiQcQHTy`, thread cmsg_016iMXWSZDzqWRWvWzdNo8wgDTbCHNDqhiJkWnspTJ3Jwd.
- **Pushed at 12:10Z: head `fddb44aa9` on xsgo56, no PR, worktree clean.** Steps ①–⑥ are done (pins went red → green and were ablated). Step ⑦ is half done, step ⑧ has not started, and `main` is not merged yet. The dev's handover is /mnt/project-files/epic-31527-seat2/card-31698/handover.md (both needs_decision questions are in it).
- Order: /mnt/project-files/epic-31527-seat2/dispatch-31698.md. Step 0: card-31698/step0.md (about 2100–2300 lines; split the echo and peer rows off as a Part of PR if over 2800).
- Seat go (11:2xZ): fix every open owed row (rows 1–2, the echo trio, R1, the peer `invalidateForForeignWrite` dropping every slot, the stale-slot drop deleting another package's row) plus N1 (the save-door collision refusal) and N2 (the registry claim becoming a set).
- **N3 predicate:** the stricter rule, confirmed by seat 1 at 11:20Z on three conditions:
  1. One named predicate function used by both the install door and the save door.
  2. The difference from the sibling `namespacedHoldersMeet` declared as FROM → TO "unchanged" rows, with pins for sys+crm, base+crm, two guest_portal holders and a passing CONTROL.
  3. The row-9 pin taken against `main` at merge time, since #32497 may flip `holdsPlatformPermissionSet` false → true.
- Also owed: a real-engine door pin (gate + seam + reader) for an organization admin naming one of two holders, after #32718 merges.
- **Before landing: a `needs_decision` to epic seat 1** (cmsg_016iMXWSZDzqWRWvWzdNo8wg5Gs4SUUn6MG8VPoX9nWYZS), carrying two questions with measured options and a recommendation:
  - (1) Row 9 (6816011109): may a security answer follow a reversible disable?
  - (2) One private question; the new seat gets it from the maintainer or security#1, never from public text.
- Lands after #32718. Merge `main` first.

## Private items

- GHSA-c5wj-57rj-hh8f (draft advisory, with security#1 via mailbox #32579). Details are never put in public text.
- One #31698 PR-2 question is private (see above).

## Other open threads of this seat's work
- **PR #32447** (server#4, os-lizheng; carrier of the #32365 Q2 retire): the epic red-line re-read is PASS-with-nits. Under Bill's rule, only item 2 blocks: the peer convergence retire is undeclared, so declare and pin it or exclude it. Amendment 6820192754 on mailbox #32423. The open question was ruled A (also retire a non-holder row's entry), in a follow-up PR after #32447.
- **Follow-up cards filed by this seat (unclaimed):**
  - #32609: action overlay `bundle_member`, the served-overrides lookup, and the `bundleEntryKey` question.
  - #32671 (under #32540): rollback holder check, the naming-pass collision, wording.
  - #32720 (under #32538): delegated-admin gate follow-ups.
- **Seat 1's chain on main 6b58d7e336:** du44hj clean; phk4r9 conflicts in two test files (rest `meta-qualified-item-route.test.ts`, runtime `domains/meta-qualified-item-read.test.ts`). Seat 1 has been told.

## Rules in force (Bill)
- Simple review items go to a follow-up card. Only correctness, red-line or security items block a merge (09:41Z).
- Decisions run on the fable model.
- Tier H goes to os-zhuang / hotlong, never os-bill.
- Epic #31527 is at GitHub's cap of 100 sub-issues. Link new cards under their origin card.
