---
'@objectstack/metadata-protocol': minor
'@objectstack/service-storage': minor
---

Report the refused writes three `catch { }` sites swallowed (#12981 batch 7)

Three tier-1 DARK sites from the #12981 swallow-family worklist, across two
packages. Control flow is unchanged at every one of them — none of these
failures should abort the operation it sits inside — but none of them is silent
any more.

**`metadata-protocol` — `reassignOrphanedMetadata` (the durability one).**
ADR-0070 D5's orphan-adoption loop dropped a refused `sys_metadata` update
whole: not logged, not rethrown, not carried on the response. The return line
reports `success: reassigned.length > 0`, so an adoption in which 99 of 100
orphans were refused answered `{ success: true, reassignedCount: 1 }` — a
response identical in shape to a healthy run with one orphan to move — while
the 99 stayed orphans, with nothing retrying them and no record that they had
been tried. The loop now counts refusals and states the degradation **once**
after the loop at `console.error`, naming the count, the target package, the
driver's own sentence and the fix. `error` and not this file's usual
`console.warn`, by the AGENTS.md question this turns on: the system keeps
looking normal while something it claims to have persisted did not land. It is
the verdict `recordPackageCommit` in the same file already reaches on the same
sink, and the inverse of the one `clientFacingRowFailureText` records for its
`console.warn` (there the row reports `success: false` and the counters
reconcile; here neither holds). The response shape is untouched — no
`failedCount` was added.

**`service-storage` — two sites at the tail of `StorageServicePlugin.start()`,
both functional, both `warn`.**

- The settings-namespace binding ended in `catch { }` with a comment naming
  only one of the two outcomes it caught. The settings service being **absent**
  (a bare kernel, where nothing ever claimed the admin UI could swap adapters)
  is now resolved on its own line and stays correctly silent; a binding that
  **fails with the service present** is reported, because `start()` otherwise
  completes into a healthy-looking boot whose storage settings screen is wired
  to nothing — an operator's adapter or credential change is saved and never
  applied.
- The `storage/test` probe cleanup swallowed its own failure in
  `catch { /* ignore */ }`. The result returned beside it reports the *probe's*
  failure, which is a different failure: one stray `__objectstack_probe__/…`
  key accrued per failed test and the only record of its name died with the
  frame. The refused cleanup now names the key it left behind.

Both `service-storage` sites are `warn` on the merits, not by default: neither
is a durability degradation. Storage keeps serving from the adapter the
plugin's own options built, and the leaked probe object is inert content no
record references — AGENTS.md is explicit that escalating these is what makes
`error` unreadable. No sink type is changed at any of the three sites: the two
`service-storage` reports go to `PluginContext.logger`, whose `error` is
already non-optional, and `metadata-protocol` reports on `console`.

Each repaired seam is pinned by a test that fails if it goes quiet again, plus
absence-asserting controls — declared as controls — so a seam that reports
unconditionally cannot pass.
