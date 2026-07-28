---
"@objectstack/spec": patch
---

feat(spec): `verifiedAt` re-verification clock on liveness entries + two entries re-verified against objectui (#3714 follow-up)

A ledger entry is a claim with a timestamp, and **twice** now one has been
falsified by code moving under it — `flow.status` (#3711) and `action.undoable`
(#3714), both *understated*, both found only because a sweep aimed at the
opposite failure walked past them. Nothing in the gate asked how old a claim
was, so a stale entry stayed invisible until someone tripped over it.

**`verifiedAt`.** Ledger entries may now carry `"verifiedAt": "YYYY-MM-DD"` —
the date a human last closed the call graph. The asymmetry is the design:

- **Age never fails CI.** Re-verification is a worklist, not a merge gate. Every
  run prints one summary line; `pnpm check:liveness --stale-verification[=days]`
  prints the worklist (stale oldest-first, then undated). Default 180 days.
- **A malformed or future-dated value DOES fail CI.** A date the parser can't
  read would silently exempt that entry from every staleness window — the same
  silent-no-op shape this ledger exists to catch. Also rejects calendar-invalid
  dates, since `new Date('2026-02-30')` rolls over to March 2 rather than
  throwing.

Currently 2 of 401 entries are dated. The rest predate the field and report as
undated; date them as you re-verify rather than back-filling guesses.

**Two entries re-verified against objectui `732b1bf`:**

- `action.undoable` — both readers stand, and the call graph now closes end to
  end in the evidence: the two `if (action.undoable …)` gates build
  `result.undo`; `ActionRunner.ts:640-643` pushes it onto `globalUndoManager`
  and passes `undo` to the toast handler; the toast's Undo button runs
  `undoCtl.undo()` → `useGlobalUndo` → `UndoManager` → `dataSource`. The cited
  `RecordDetailView` line numbers had already drifted (545→573, 404→432) in the
  day between the issue being filed and this pass — hence the pinned sha.
- `action.type` — `api` → `executeAPI`, `form` → `executeForm`, both real.

**Docs correction (`content/docs/ui/actions.mdx`).** That page told authors the
schema's `api` and `form` types have "no runtime executor / renderer today —
stick to the four above." Both have had executors in objectui's `ActionRunner`
for some time, and the ledger's own `action.type` entry recorded `form` as live
since #2377. Same understatement shape as #3714, one page over. Both types now
have table rows; the callout keeps the parts that are true (`shortcut` and
`bulkEnabled` really are unwired) and links the ledger. `undoable` also joins
the UX property list, which is the author-facing payoff of #3714.
