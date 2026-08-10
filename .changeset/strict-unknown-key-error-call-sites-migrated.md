---
"@objectstack/spec": patch
---

refactor(spec): the last 44 hand-transcribed key lists are gone — every alias table is judged against its schema's real shape (#5593)

Forty-four authoring schemas predated `strictObject` and wired their unknown-key
error by hand: a `const X_KEYS = [...] as const` transcription of the shape, a
`strictUnknownKeyError({ knownKeys: X_KEYS, … })` call, and a drift-probe test
whose only job was to catch the two copies disagreeing. All 44 now call
`strictObject(options, shape)`, which reads the candidate list from the shape
itself, and the 16 transcriptions plus their probe tests are deleted.

The point is not the line count — it is what the alias-integrity gate (#5013)
can now assert about them. #5483 had put these tables under the gate through a
transitional registry, but two of its three claims were answered against the
*transcription*: an array that had drifted from its schema dragged both answers
with it, and "this alias target is a tombstone" was invisible because a flat
string array holds no schemas. Migrating closes that half, and the migration
itself found what the transcriptions were hiding:

- **11 alias/suggestion targets were retired keys.** `app` (8: `apis`, `aria`,
  `embed`, `homePageId`, `mobileNavigation`, `objects`, `sharing`, `version`),
  `flow` (`active`, `template`) and `flow node` (`outputSchema`) are
  `retiredKey()` tombstones the arrays still listed, so a near-miss was steered
  onto the one key guaranteed to be rejected next — ledger finding 12, three
  files, live. `strictObject` excludes anything the shape cannot accept, so the
  author now gets the tombstone's own upgrade prescription instead.
- **A nav `separator` was answering with keys it rejects.** The nine navigation
  variants shared one transcription that handed every variant the base nav keys —
  but `SeparatorNavItemSchema` spreads nothing and declares `type` / `id` /
  `order` alone. Writing `title` on a separator was answered *"did you mean
  `label`?"*, and `label` was rejected too: finding 7, from the campaign built to
  end it. The separator now carries the alias entries whose target it really has,
  and one prescription for the nine base keys it does not.
- **Three ADR-0010 envelopes were missing from their own pools** (`datasource`,
  `hook`, `sharing rule`): the protection keys the shapes spread were never
  transcribed, so a typo of one got no suggestion at all.

Author-facing messages are otherwise unchanged — the surface name, the offending
key, the rename and the curated prescriptions all survive verbatim, verified by
comparing every migrated surface's old array against its new derived pool and by
sampling a real rejection from each.

Two structural consequences:

- the shrink-only ratchet on direct `strictUnknownKeyError` call sites is a hard
  **zero**, and the assertion changed meaning with the number: it no longer
  measures how much of the gate runs on the weaker instrument, it forbids the
  weaker instrument. `strictUnknownKeyError` stays published for external
  callers; inside `packages/spec` the only caller is `strictObject`.
- `shared/alias-table-registry.ts` — #5483's transitional registry — is deleted
  with its last call site, along with the suppression hook `strictObject` needed
  to stay out of it.

`data/object.zod.ts`'s error map was built lazily to step around a temporal dead
zone; `strictObject` evaluates its options at construction, so the deferral is
replaced by declaration order (`UNKNOWN_KEY_GUIDANCE` moved above the shape) and
that order is now load-bearing.
