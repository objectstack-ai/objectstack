---
'@objectstack/spec': minor
---

`ObjectSchema` rejects unknown top-level keys on the PARSE path, not only in `create()` — closing the founding example of #4001, which had been live for the whole time #1535 was considered fixed.

**The gap.** #1535 built the unknown-key guard as a hand-rolled check inside the `ObjectSchema.create()` factory, on the reasoning that authored `*.object.ts` modules call `create()`. They do — but they are not the only producer, and not the path most instances travel. `defineStack({ objects })`, `/api/v1/meta/types/object` and the Studio form all reach the schema through `parse()` / `safeParse()`, which kept stripping unknown keys in silence:

```
ObjectSchema.parse({ …, workflows: ['x'] })   → key silently discarded
ObjectSchema.create({ …, workflows: ['x'] })  → rejected since #1535
```

Object-level `workflows: [...]` — the example this campaign was filed on, an author believing they had wired up automation and shipping dead metadata — was still reproducible on the main path.

The base shape is now `.strict()` with the `UNKNOWN_KEY_GUIDANCE` tombstones and the semantic renames the warning layer already knew (`capabilities` / `features` → `enable`), so graduating from warn to reject costs an author no prescription. `create()` is unaffected: its own check runs before parsing and throws a richer located error. Safe on the read path for the same reason the other closed registered types are — the ADR-0010 envelope is declared, and `stripReadDecorations` removes `_diagnostics` / `_draft` before any strict re-parse. Verified rather than assumed: every `ObjectSchema.create()` call across `platform-objects` and the three example apps uses only declared top-level keys.

**A new tombstone.** `namespace` (retired in ADR-0006 D4) had none, so it was stripped in silence — an object written as `{ namespace: 'sys', name: 'user' }` shipped as plain `user`, under a name its author never intended. The rejection now carries the fix (`name: "sys_user"`).

**And a coverage regression this change would otherwise have introduced.** The unknown-key warning layer gated each metadata collection on its ROOT schema's posture, so closing `object` at the root switched off the warnings for everything *beneath* it too — its 71 nested strip-mode sites would have stopped reporting in the same change, with nothing to say so. Posture is a per-node property and the walk now treats it as one: a strict root stays silent at its own level (the parse owns that failure) while the descent continues. Nested `object.fields.*` warnings are unaffected by the graduation.

Three tests that asserted the strip as correct behaviour are now rejection tests — `namespace`, the retired `compactLayout` alias, and the removed `detail` block. The `compactLayout` one had pinned the author-hostile outcome explicitly: "the retired key is STRIPPED, not aliased — an old-key author gets no highlightFields rather than silently working."
