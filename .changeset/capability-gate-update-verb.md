---
"@objectstack/plugin-audit": patch
---

**Behaviour change (tightening):** `enable.files` / `enable.feeds` are now enforced on the **update** verb, not only on insert (#10170).

Both capability gates in `audit-writers.ts` registered on `beforeInsert` only. `enable.files` says whether `sys_attachment` rows may **target** an object and `enable.feeds` whether `sys_comment` rows may target it — properties of the target object, not of the verb that got a row there — so a re-point via update landed rows the declaration refuses: a caller who could not *create* an attachment on an object without `enable.files: true` could *move* an existing one onto it, and a comment could be re-threaded into a `feeds: false` object's thread. The access kits authorize the re-point (`comment-access-hooks.ts` since #4630, `attachment-access-hooks.ts` since #10091), but those are **access** checks — the capability half was never asked on update.

What an operator will now observe:

- An update of `sys_attachment` whose payload sets `parent_object` to an object that does not declare `enable: { files: true }` is refused with **403 `FILES_DISABLED`** — the same envelope the insert path has emitted since #2727 (ADR-0112: `code` + `status`). Fail-closed as on insert: an absent `enable` block, an absent flag, and an unknown parent object all reject.
- An update of `sys_comment` whose payload sets `thread_id` to a thread on an object declaring `enable: { feeds: false }` is refused with **403 `FEEDS_DISABLED`**. Opt-out semantics as on insert: only an explicit `false` rejects, and a missing or free-form `thread_id` is still allowed through — this is capability gating, not access control.
- Both apply on **both dispatch shapes**: a by-id update (`dispatch.mode` `record`) and a predicate `multi: true` update, which is evaluated per matched row (#5574 / ADR-0058 Addendum II). An unscoped predicate update is refused on its first matched row.

**No existing row is newly refused, and no update that is not a re-point changes.** The gates read the payload: an update that never names `parent_object` / `thread_id` returns on the gate's first line, so renames, body edits, reaction writes and other column updates on a row whose parent object has since had the capability flipped off keep working exactly as before. Only a write that makes a row *newly target* a walled object is refused.

**Blast radius.** A structural sweep of the 4 660 in-tree source files found **no** caller — none in `packages/` source, `examples/`, or the dogfood apps — that issues an update whose payload names `parent_object`, and none that re-points `thread_id`; in the console the only `sys_attachment` write is a create, and the only `sys_comment` update writes `reactions`. If you have your own "move this attachment" or "move this comment" flow, point it at a target object that declares the capability, or declare it on the target.

No new error code: both codes are existing standard-catalog members already registered in `packages/spec/src/api/error-code-ledger.zod.ts` and already mapped to 403 by `packages/rest/src/error-response.ts`.
