---
'@objectstack/plugin-security': patch
'@objectstack/objectql': patch
---

fix(security): guard the `owner_id` ownership anchor and scope bulk writes to owner-visible rows (#3004, #2982)

Two write-path holes on the row-ownership anchor (`owner_id`), the column OWD
row-level scoping keys off to decide who may update/delete a record.

- **#3004 — client-writable, unguarded `owner_id`.** The anchor is deliberately
  not `readonly` (ownership is transferable), so the static-readonly strip never
  covered it and FLS doesn't gate it by default. A non-privileged writer could
  therefore `insert` a record under someone else's name (forge) or `update` one
  to a new owner (transfer / disown), evading the owner gate that governs
  update/delete. The security middleware (plugin-security step 3.5) now treats
  `owner_id` as system-managed for non-privileged writers: on insert an empty
  value is auto-stamped to the acting user (batch rows too — previously only the
  single-record path stamped, leaving bulk-inserted rows NULL-owned and
  invisible to their creator), and a supplied foreign owner is denied; on update
  a supplied `owner_id` is a transfer/disown and is denied — the unchanged no-op
  echo of a form save is tolerated via a pre-image compare, and a bulk
  change-set carrying `owner_id` fails closed. Both require the transfer grant
  (`allowTransfer`, or `modifyAllRecords` which implies it) to proceed. System
  context (`ctx.isSystem`) stays fully exempt (import / OAuth provisioning / cron
  snapshots / seed claims), and under delegation both principals must hold the
  grant (ADR-0090 D10 intersection).

- **#2982 — bulk writes skipped owner scoping on OWD-`private` objects.** A
  `update({ multi: true })` / bulk delete rebuilt the driver AST from
  `options.where` AFTER the middleware chain, discarding the owner/RLS write
  filter that plugin-sharing (`buildWriteFilter`) and plugin-security compose
  onto `opCtx.ast` — so a member's bulk write hit every matching row, including
  peers'. The engine now seeds `opCtx.ast` from the caller's predicate BEFORE the
  chain (the same seam reads use) and hands the middleware-composed AST to
  `driver.updateMany` / `driver.deleteMany`, so bulk writes are constrained to the
  rows the caller may edit — matching single-id write behavior.

Proven end-to-end on the real showcase app
(`packages/dogfood/test/owner-anchor-and-bulk-writes.dogfood.test.ts`) and pinned
in the ADR-0096 authz-conformance ledger (`ownership-anchor-guard`,
`bulk-write-owner-scoping`).
