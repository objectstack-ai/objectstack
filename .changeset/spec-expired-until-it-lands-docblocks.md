---
'@objectstack/spec': patch
---

Two published docblocks now describe the tree as it is, instead of promising a change that has already landed (#16835, #15239).

Both files ship: `@objectstack/spec` lists `src/**/*.zod.ts` in its `files[]`, so a TSDoc comment in either is a published byte and a reader gets it from the package as well as from `content/docs/references/`. No schema, export, key or predicate changes — comment text only.

**`automation/control-flow.zod.ts`** said the schema and `validateControlFlow` "do not overlap and cannot fight: the schema rejects undeclared KEYS, the analysis rejects malformed STRUCTURE", meeting at "one seam". #16134 removed exactly that division: `FlowSchema`'s `superRefine` now refuses a duplicate node id — a structural fact — across one node-id space spanning the top-level `nodes[]` and every region body. The docblock now names both seams and the boundary between them: the #4001 region-slot `safeParse`, and the #16134 node-id space judged at every depth `collectFlowGraphs` walks. That walk stops at `MAX_REGION_DEPTH` (32), so past the ceiling a region is left raw and `analyzeRegion`'s own `duplicate node id` line is the only refusal of a within-region duplicate — a cross-region collision beyond the ceiling is not judged at all. The two guards overlap there by design and hand off at that measured boundary.

**`security/sharing.zod.ts`** said, in two places, that a `field` sharing rule is skipped at seed "until [#15072] lands". It landed: `mapRecipientType` maps `field` through and `SharingRuleService.expandRecipientForRecord` reads the named column on each matched record. Both sentences now name that executor rather than a schedule.

⚠️ The third sentence the card counted — `queue` is "deliberately NOT authorable until the implementation lands" — is **still true** and deliberately untouched: it is about `sys_queue`, not about `field`, and there is no `sys_queue` object in the tree.
