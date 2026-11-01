---
'@objectstack/lint': minor
---

**BREAKING** fix(lint)!: an app navigation `visible` that is valid CEL but over the parse budget is refused like a page `visibleWhen` of the same size

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no file under `skills/**` teaches a navigation entry's `visible` grammar or the CEL parse budgets; the refusal carries its own fix and `os explain visibility-predicate-over-budget` entry.

<!-- adr-0087: not-required (no-migration-prescription) The narrowing is a refusal at the authoring doors (the metadata save door, a draft's diagnostics and its publish, and os validate / os build / os lint) of one value shape that never worked at runtime: a navigation `visible` that is valid CEL but overruns a DEFAULT_LIMITS parse bound, which the console withholds from every viewer. No metadata key, accepted key, export or error code is removed or renamed, no new rule id or limit is added, and no stored shape changes. The fix is the author's choice of a smaller predicate, so there is no mechanical conversion for `objectstack migrate meta` to apply; the shipped corpus (examples, platform packages) carries 1 navigation `visible`, far under budget, so 0 are refused. -->

A navigation entry whose `visible` was flawless CEL but too large (for example a 90-clause `||` chain, over `maxAstNodes` 256) saved, read `valid: true` as a draft, published and passed `os validate`, and then the console withheld the entry from every viewer, logging `[bounds] Exceeded maxAstNodes (256)`. A page `visibleWhen` of the same size was already refused.

`navigation[].visible`, `areas[].navigation[].visible` and every entry's `children` are now judged by `visibility-predicate-over-budget` as well as `visibility-predicate-syntax`: both verdicts of the one CEL front end, with the same limits the console evaluates under. The finding is located at the key (`apps[0].navigation[0].visible`), says the entry is hidden from every viewer, and its remedy is a smaller predicate over the viewer (`current_user.positions.exists(p, p in ['a', 'b', …])`; `os explain visibility-predicate-over-budget` adds gating on one `current_user.can(…)` check), since a navigation entry binds no `record`. This supersedes the "only the syntax is judged on a navigation entry" sentence of the #28663 changeset: whether a predicate parses, including its size, is what a navigation entry is judged on.

**Where.** The metadata save door (`PUT /api/v1/meta/app/:name`, Studio, MCP), a draft's `_diagnostics`, the publish (`422 INVALID_METADATA`), and `os validate` / `os build` / `os lint`. Stored apps keep loading and serving; only the next save of one with an over-budget navigation `visible` is refused, with the fix.
