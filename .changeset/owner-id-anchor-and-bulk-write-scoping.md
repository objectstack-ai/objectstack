---
'@objectstack/plugin-security': patch
'@objectstack/objectql': patch
'@objectstack/plugin-sharing': patch
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
  change-set carrying `owner_id` fails closed. A non-scalar `owner_id`
  (array/object) is rejected outright rather than string-coerced, and the
  change-set membership test uses own-property semantics so a polluted
  prototype cannot spoof an ownership write. Both require the transfer grant
  (`allowTransfer`, or `modifyAllRecords` which implies it) to proceed. System
  context (`ctx.isSystem`) stays fully exempt (OAuth provisioning / cron
  snapshots / seed claims / migrations), and under delegation both principals
  must hold the grant (ADR-0090 D10 intersection). Note a REST **import** runs
  under the importer's own context (not `isSystem`), so a non-privileged user
  importing a CSV whose `owner_id` column names other users is correctly denied
  unless they hold the transfer grant — administrators (who carry
  `modifyAllRecords`) are unaffected.

- **#2982 — bulk writes skipped owner scoping on OWD-`private` objects.** A
  `update({ multi: true })` / bulk delete rebuilt the driver AST from
  `options.where` AFTER the middleware chain, discarding the owner/RLS write
  filter that plugin-sharing (`buildWriteFilter`) and plugin-security compose
  onto `opCtx.ast` — so a member's bulk write hit every matching row, including
  peers'. The engine now seeds `opCtx.ast` from the caller's predicate BEFORE the
  chain (the same seam reads use) and hands the middleware-composed AST to
  `driver.updateMany` / `driver.deleteMany`, so bulk writes are constrained to the
  rows the caller may edit — matching single-id write behavior. `delete` now
  applies the same scalar-`id` guard `update` already had, so an id-list bulk
  delete (`where: { id: { $in: […] } }, multi: true`) is owner-scoped too, and
  both multi branches fail CLOSED (throw) rather than silently rebuilding an
  unscoped predicate if the row-scoping AST is ever absent.

  Consequences of routing bulk writes through the AST: the anti-oracle
  predicate guard now also applies to bulk `update`/`delete` (a bulk write
  filtering on an FLS-unreadable field is rejected, as reads already are), and a
  principal-less (no-`userId`, non-system) bulk write on an owner-scoped object
  now correctly affects zero rows instead of all of them.

Proven end-to-end on the real showcase app
(`packages/qa/dogfood/test/owner-anchor-and-bulk-writes.dogfood.test.ts`) and pinned
in the ADR-0096 authz-conformance ledger (`ownership-anchor-guard`,
`bulk-write-owner-scoping`).
