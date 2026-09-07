---
"@objectstack/plugin-email": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
---

The three provenance-stamp `beforeUpdate` hooks stop re-reading a row the engine has already read, and their contract now states what they actually do on a multi-row update.

`sys_email_template`, `sys_sharing_rule` and `sys_webhook` each carry a hook that stamps `customized: true` when a non-system caller edits a package- or platform-seeded row — the half of seed-not-clobber that detects the admin edit. All three carried the same two comments, and both were assertions about runtime behaviour that runtime measurement falsifies:

- **"multi-row updates (no single `input.id`) are not stamped."** Not true on any engine these packages ship against. A predicate (`multi: true`) update dispatches `beforeUpdate` once per matched row, and every per-row context arrives with `input.id` bound — so the `if (!id) return` guard answered "single write" on every row of a batch and declined nothing. The rows were being stamped all along.
- **"`previous` is not resolved before beforeUpdate hooks run — read the current row ourselves."** The engine binds `previous` before dispatching `beforeUpdate` on both write shapes, so each hook was issuing its own `find` for a row the engine had just read — on a bulk edit, one extra read **per matched row**.

Observable behaviour is deliberately unchanged: the same rows are stamped, with the same values, and a bulk edit whose matched rows disagree on `managed_by` is still refused by the engine with `MULTI_UPDATE_HOOK_KEY_DIVERGENCE` (HTTP 400) rather than widening one row's stamp across the batch. What changes is the cost and the contract: the redundant per-row read is gone, and the header of each hook now describes the per-row dispatch, the single `SET` clause a predicate write shares, and why declining to stamp on a bulk edit was rejected — unstamped rows are exactly the ones the next boot's seeder overwrites.
