---
"@objectstack/lint": minor
---

**BREAKING for runtime metadata writes** — five metadata write doors now judge what walks through them. `action`, `hook`, `report`, `email_template` and `mapping` each declared `allowRuntimeCreate: true` and reached ZERO author-time rules at the runtime publish gate; they now dispatch the rules already written for them, so an `action`, `hook` or `report` publish that used to succeed can now be refused (#19474)

Clause-②: no (narrowing)

Each of these is a registered metadata type declaring `allowRuntimeCreate: true`, so Studio's designer, REST `/meta` item CRUD and an MCP/AI author may all mint one — and at that door nothing judged any of them. Measured on `origin/main`: no rule declared any of them in `runtimeTypes`, so the gate filtered them out before it ever consulted `TYPE_TO_STACK_KEY`. `action` and `hook` already HAD their stack-key rows, which made the two absences **consistent rather than contradictory** — the gate filters by `runtimeTypes` first — so nothing was mis-wired and CI was green, correctly. What they summed to is that a write of any of them built no per-write snapshot and ran no rule at all. An author working only through Studio or MCP has no `os lint` step to fall back on, so for them that door is the only one there is.

ADR-0049's 「声明即强制」 admits two resolutions — honour the declaration, or retire it — and the ruling on #19275 took the first for these six, by evidence group. The rules exist; this is the wiring that reaches them.

- **`validateStackExpressions` crosses to `action` and `hook`.** It judges the written action's own `visible` / `disabled` CEL and the written hook's own `condition`, resolving `record.<field>` against `objects` — the one collection every snapshot carries. The action/hook BODY rules deliberately do **not** cross with them: they parse authored JS through `typescript`/`sucrase`, the two dependencies `runtime-lazy-deps.test.ts` pins off the kernel boot path outright, and an action/hook write is exactly the snapshot that would carry a body for them to parse.
- **`validatePresetComparands` and `validateEmptyCombinators` cross to `report`, together.** Both judge the same authored filter literal on the same `reports` scan surface, so on #7220's reading they cross or they do not — an author refused for a bad preset comparand and waved through for a literal `$and: []` on the same report could not predict the door.
- **The reference-integrity suite entry gains `report`**, and its per-member axis admits exactly ONE member: `validateChartBindings` (it resolves the report's `dataset` / `rows` / `columns` / `values` against `stack.datasets`, a carried collection).
- **`lintLivenessProperties` crosses to `email_template` and `mapping` only.** The `RUNTIME_OBJECT_ADVISORY_VOLUME` reason that held it back is about the OBJECT write door (~8 advisories per object write, rendered in Studio); `object` is deliberately not declared, so that reason is untouched and still holds for every type left off.
- **`TYPE_TO_STACK_KEY` gains `report` / `email_template` / `mapping`**, never ahead of their rules — the inert state the table's own `seed: 'data'` note records paying for. Every crossed rule has a door control that fires it through the real gate (`runtime-gate.inert-type-writes.test.ts`), and each control was shown to be load-bearing by reverting its declaration and watching it go red.
- **No new rule and no new finding class.** The rule ids (`expression-invalid`, `chart-dataset-unknown`, `chart-dimension-unknown`, `filter-empty-combinator`, `filter-preset-comparand`) and their severities are unchanged — they now reach the door where the author actually is.
- **Measured before crossing**, at the door's own snapshot shape and differential, over every item of these types shipped in this monorepo: **79 actions** (showcase 70, todo 8, crm 1), **6 hooks** (showcase 4, todo 1, crm 1), **9 reports** (showcase 4, todo 5 — 5 of them carrying an authored filter key, so the filter rules were non-vacuously exercised), **1 email template** and **1 mapping** — **0 findings** on every one, with lit synthetic probes refused per rule.

## Two readings that are part of the deliverable, not omissions

**`email_template` and `mapping` are wired and SILENT.** Their bridge, `lintLivenessProperties`, is ledger-driven and skips a type whose warn map is empty; `packages/spec/liveness/email_template.json` is 13 props / **0** warn keys and `mapping.json` is 7 / **0** (lit control on the same instrument: `tool.json` 6/1, `object.json` 35/1). The ruling dispatched the wiring and **no ledger-population work** — 「the empty warn maps stay empty until a real property needs a row — zero pull, the wiring is the whole deliverable」 — so this is the ruled end state. Both halves are pinned: that the rule is dispatched, and that it judges nothing today. The day a property earns an `authorWarn` row the door lights up with no second edit.

**`skill` — the fourth type of group A — is NOT wired, and for it that IS the deliverable.** Its bridge, `validateAiToolReferences`, resolves into `stack.tools` and `stack.actions`; a per-write snapshot carries `objects` (so an object-level `action_NAME` resolves) but neither of those, so at that door the rule has no truthful `unresolved` verdict at all — only its clean answers are reliable. Measured on the shipped corpus rather than synthetically: `app-showcase`'s single AI-exposed action exists at STACK level only, and a skill naming it is advised `ai-skill-tool-unresolved` at the door while the same rule over the whole stack answers `[]`. That advisory reaches `SaveMetaItemResponseSchema.advisories` and renders in Studio, with a hint prescribing exactly what the author had already done — so the card's own acceptance («a good write passes») does not hold for `skill`. The type therefore takes the ruling's own group B treatment of `tool`, the same universe obstacle read from the other side: **a reading first, not a wiring**. Crossing it needs `actions` / `tools` carried in `RuntimeStackContext` plus a `CLOSURE_CONTEXT_KEY_BY_TYPE` row and two more door gathers in `@objectstack/metadata-protocol` — a second package, a snapshot widening paid on every gated write, and its own card. Both halves of the wiring are held ABSENT by pins, with the measurement kept executable beside them.

## Migration

**A publish of an `action`, `hook` or `report` that used to succeed can now be refused (HTTP 422, `INVALID_METADATA`).** The receipt names the rule id and the offending path plus the string that was written. To clear a refusal:

| Refusal | Fix |
| --- | --- |
| `expression-invalid` on an action's `visible` / `disabled`, or a hook's `condition` | Correct the CEL. A syntax fault is named with its position; an `unknown field` names the object it was resolved against — point the ref at a column that object declares, or bind the action with `objectName`. |
| `chart-dataset-unknown` / `chart-dimension-unknown` on a report | Point `dataset` at a declared dataset, and `rows` / `columns` / `values` at dimension and measure NAMES that dataset declares (post-ADR-0021 result rows are keyed by dimension name, not by the base field). |
| `filter-empty-combinator` on a report filter | Delete the empty `$and: []` / `$or: []` / `$not: {}` key — it constrains nothing. |
| `filter-preset-comparand` on a report filter | A dashboard date-range PRESET name (`last_30_days`, …) is not a filter value; write a real comparand. |

`skill` writes are unchanged — the type is not gated by this change. `email_template` and `mapping` writes are unchanged in behaviour today: their rule is dispatched and judges nothing until a ledger row lands.

The gate's differential keeps all of this honest in the one direction that matters: a STORED sibling already in violation is never charged to this write (#4463 D4).

<!-- adr-0087: not-required (no-migration-prescription) nothing is retired, renamed or added: no authorable key changes, no stored shape is rewritten, and `objectstack migrate meta` has nothing to reach. Every rule id, severity and fix-it text crossed here is unchanged — only the surface each runs on widens, from the three CLI commands to the runtime publish door as well. An affected tenant corrects its own metadata against a message the rule already shipped, which is tenant data rather than a spec migration. -->
