---
"@objectstack/spec": patch
---

chore(spec): re-anchor the closing twelve liveness ledgers to consuming symbols (#13003)

Adoption batch 4 — the closing batch — of the symbol-anchor citation grammar
landed by #12516. The `liveness/` ledgers ship inside this package's npm tarball
(they are named in `files`), so this is a published-data change even though no
runtime behaviour moves and no schema key changes.

Eighty of the eighty-two remaining `path:NNN` citations — across
`liveness/app.json`, `validation.json`, `translation.json`, `field.json`,
`hook.json`, `mapping.json`, `capability.json`, `seed.json`, `view.json`,
`dashboard.json`, `flow.json` and `qa.json` — are now written `path#symbol`,
each re-closed by reading the code on the current tree rather than by shifting a
line number. Every path-only pointer in the same entries is anchored with them.
The gate's own line-citation counter goes 82 to 2 and its symbol-anchor counter
383 to 499.

Sixty-seven of the eighty were already wrong, every one IN RANGE and therefore
invisible to the existence check, the line bound and the key-mention check alike.
Six files were 100% rotted (validation 10/10, seed 6/6, view 5/5, dashboard 4/4,
flow 4/4, qa 4/4). The dominant shape is BLOCK drift: nine of `validation.json`'s
ten pointers had come to rest inside one 70-line ADR-0124 docblock roughly 1,200
lines above `evaluateValidationRules`, and `app.json`'s `name` / `label` /
`description` had settled on three consecutive lines of one unrelated action
resolver. `flow.status` is the sharpest single case — its pointer landed on
`flowLedgerDisabled`, the map ADJACENT to the one this key writes, after #10243
split the two apart.

Two silent classes are closed with them. Seventeen positions across four files
were written as bare `:NNN` suffixes with no path in front of them, which the
scanner never matched as citations at all, so nothing ever resolved, bounded or
key-checked them; `translation.objects` alone carried five. Three more entries
(`hook.retryPolicy` / `timeout` / `onError`) cited a path with no line, which a
line bound cannot falsify by construction. All twenty are repo-rooted anchors now.

Three citations were falsified in PROSE as well as position and are corrected
with their lines: `view.object` credited `getViewsByObject()` to
`packages/objectql/src/engine.ts` (it is in `packages/metadata`),
`field.requiredWhen` named `fieldRequiresParentRoot` (no such symbol; it is
`hasParentScopedRequiredWhen`), and `translation.metadataForms` named
`translateMetaTypes` (it is `translateMetaTypesResponse`).

Nothing is re-classified. Two entries are deliberately left byte-for-byte
untouched and un-restamped because their `live` verdict — not their citation —
is what is falsified: `action.execute` (reported as #13036) and
`field.conditionalRequired` (reported as #13043), both `retiredKey` tombstones
since protocol 17 whose cited `.transform` lowering no longer exists. Those are
ADR-0049 re-classifications with their own card shape.
