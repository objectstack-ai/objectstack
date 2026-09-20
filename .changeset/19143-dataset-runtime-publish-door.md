---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

The dataset publish door now judges the dataset. A runtime-created `dataset` reached ZERO author-time rules; it now dispatches the existence rules that were already written for it (#19143).

`dataset` is a registered metadata type declaring `allowRuntimeCreate: true`, so Studio's designer, REST `/meta` item CRUD and an MCP/AI author may all mint one — and at that door nothing judged it. Measured on `origin/main`: no rule declared `dataset` in `runtimeTypes` (zero, against a lit control returning every other declared type), and `TYPE_TO_STACK_KEY` in `runtime-gate.ts` carried no `dataset` row. The two absences were **consistent rather than contradictory** — the gate filters by `runtimeTypes` before it consults the table — so nothing was mis-wired and CI was green, correctly. What they summed to is that a dataset write built no per-write snapshot and dispatched no rule at all, while the rules that judge a dataset state their own failure mode as a surface that *"renders successfully with empty or wrong numbers"*. An author working only through Studio or MCP has no `os lint` step to fall back on, so for them that door is the only one there is.

ADR-0049's 「声明即强制」 admits two resolutions and the card chose neither; this takes the first because the measurement says so. The author-time rules for `dataset` **exist**: `validateDatasetReferences` (#14105, `packages/lint/src/validate-dataset-references.ts`), `validateDatasetMeasureAggregates` (#16354) and `validateObjectReferences`' `datasets[].object` rung. The declaration is honoured rather than retired.

- **`TYPE_TO_STACK_KEY` gains `dataset: 'datasets'`**, and the rules that READ that collection are declared in the same commit — never a mapping ahead of its rules, which is the inert state the table's own `seed: 'data'` note records paying for. Every crossed rule has a door control that fires it through the real gate.
- **`validateDatasetMeasureAggregates` crosses to `CLI_AND_RUNTIME` with `runtimeTypes: ['dataset']`.** Its previous `surfaceReason` named this exact gap as what held it off the door.
- **The reference-integrity suite entry gains `dataset`**, and its per-member axis admits exactly two members — `validateDatasetReferences` and `validateObjectReferences`. Both resolve only against `stack.objects` and `stack.datasets`, the two collections a per-write snapshot carries, so neither opens a missing-collection false-positive channel. They cross together on #7220's reading: an author refused for a dangling dimension field and waved through for a dangling base object cannot predict the door.
- **No new rule and no new finding class.** The rule ids (`dataset-field-unknown`, `dataset-field-not-included`, `dataset-filter-field-unknown`, `dataset-include-unknown`, `measure-aggregate-field-type-refused`, `object-reference-unknown`) and their severities are unchanged — they now reach the door where the author actually is.
- **Findings from a dataset write are name-keyed on the wire** (#10064): `datasets.<name>.dimensions[0].field`, never the gate's private snapshot index. `datasets` entered the derived name-keyed set by derivation, with no second edit to remember.
- **Measured before crossing**, at the door's own snapshot shape and differential, over every dataset shipped in this monorepo — **11 datasets** (`platform-objects` 5 over `sys_*`, showcase 4, crm 1, todo 1) judged against 52 platform objects plus each app's own (showcase 22, crm 6, todo 1): **0 findings, 0 advisories, `rulesRun` 2 on every one** — so the zero is a fact about the corpus and not about a door that ran nothing. The same harness's synthetic probe IS refused, with both ids and both name-keyed paths.

## Migration

**A dataset publish that used to succeed can now be refused (HTTP 422, `INVALID_METADATA`).** The receipt names the rule id and the offending path, name-keyed on the wire — for example `datasets.invoice_metrics.dimensions[0].field` or `datasets.invoice_metrics.measures[1].aggregate` — plus the string that was written.

To clear a refusal, do one of:

- point the `dimensions[].field` / `measures[].field` path at a column the base object actually declares (after a Studio label edit the derived API name is the one to use); or
- add the relationship the path traverses to the dataset's `include[]`, for `dataset-field-not-included`; or
- correct the filter KEY, for `dataset-filter-field-unknown`; or
- for `measure-aggregate-field-type-refused`, either aggregate a field of an accepted type or choose an aggregate the field's type accepts (`count` / `count_distinct` accept every type) — the compile leg already refuses that same pair with `400 DATASET_INVALID` once a query is built, so this is the same fix made earlier; or
- for `object-reference-unknown`, point `object` at an object this stack defines, or at a platform object by its full name.

`os validate` / `os build` / `os lint` already reported every one of these findings at the same severity, so a code-authored stack can be repaired before it ever reaches a publish. A dataset over an object this stack does not define, one that declares no readable field map, and a registry-injected system column are all skipped exactly as they were on the CLI — the door adds no verdict the commands did not already make. A stored dataset already in violation is never charged to an unrelated publish, and republishing a dataset under its own name with the defect removed is clean (#4463 D4).
