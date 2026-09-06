---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": patch
"@objectstack/runtime": patch
---

`publicSharing.enabled` now has one canonical predicate, exported from the package that declares the key.

`isPublicSharingEnabled(schema)` is a new export of `@objectstack/spec/data`, declared in `src/data/object.zod.ts` beside the `publicSharing` block itself — the same shape as the neighbouring `isTenancyDisabled`. It is additive: nothing was removed or narrowed from the spec's public API.

Until now the same policy read existed in two spellings. `@objectstack/plugin-sharing` defined it (for the share-link service's redemption gate and the route probe above it), and `@objectstack/runtime` carried a documented private mirror for its `/share-links` dispatcher domain — copied rather than imported because the plugin is only a **dev** dependency of the runtime. That reasoning was true of that one home and not of the question: both packages already depend on `@objectstack/spec`, so a shared home existed all along and the de-duplication adds no dependency edge. Both surfaces now consume the exported predicate and the runtime copy is deleted.

Behaviour is unchanged, fail-closed included: an absent `publicSharing` block, an absent schema, and an engine that cannot answer `getSchema` at all remain **one** answer, `false`, and only the boolean `true` enables. The two pins that held the copies equal — `share-link-eligibility.test.ts` in the plugin and `share-links-enforcement-context.test.ts` in the runtime, which assert the same observable answer on both surfaces rather than trusting the copy — are unchanged and still green; they are what proves the merge did not move behaviour. The predicate's own contract, which those tests can only observe indirectly, is now pinned directly in `packages/spec/src/data/object.test.ts`.
