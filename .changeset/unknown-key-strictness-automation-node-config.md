---
"@objectstack/spec": major
---

feat(spec)!: reject unknown keys on the flow-node config contracts (#4001 批 9)

The first `automation/` wave of the 2026-08-03 "necessary-and-complete"
ruling. Fourteen strip sites across three files close, and `automation/`'s
remaining-strip count drops 67 → 53 (authorable 41 → 27).

- **`automation/io-node-config.zod.ts`** — `NotifyConfigSchema`,
  `HttpConfigSchema`.
- **`automation/builtin-node-config.zod.ts`** — the CRUD quartet
  (`get_record` / `create_record` / `update_record` / `delete_record`),
  `ScreenConfigSchema`, `ScreenFieldConfigSchema` and its `options` item,
  `MapConfigSchema`.
- **`automation/schemaless-node-config.zod.ts`** — `ScriptConfigSchema`,
  `SubflowConfigSchema`, `DecisionConfigSchema`, `DecisionConditionSchema`.

The deliberately-open `FlowNodeSchema.config` SLOT is unchanged — ADR-0018
keeps `node.type` open so plugins contribute their own executors, and closing
the slot would close that extension point. What is closed is the per-node-type
contract *inside* it.

**Why the third file is different.** `registerFlow()` already hard-rejects
undeclared config keys against a node's descriptor `configSchema` (#4277), and
`script` / `subflow` / `decision` publish no descriptor `configSchema` — so
that walk skips them by construction. Until now those three had **no**
unknown-key enforcement at any layer. For them this is the first gate, not a
second one.

**Migration.** Every key now rejected was previously stripped and had no
runtime effect, so removing or renaming one never changes behaviour. All three
shipped example apps were re-validated after the change and no stored shape
needed an ADR-0087 conversion (160 flow nodes walked, 52 carrying one of these
contracts, 0 rejections). The rejections carry their own prescriptions:

- `notify`: `to` → `recipients`, `subject` → `title`, `body` → `message`,
  `url` → `actionUrl`, `source: { object, id }` → `sourceObject` + `sourceId`.
- CRUD: `object` → `objectName`, `filters` → `filter`,
  `fieldValues` → `fields`, `recordId` → a filter VALUE
  (`filter: { id: '{record.id}' }` — no CRUD executor has ever read a
  `recordId` key), and on `update_record` / `delete_record` `outputVariable`
  is a documented absence, not a typo — read the row back with a following
  `get_record`.
- `screen`: `object` → `objectName`, and on a field item
  `visibleIf` → `visibleWhen`.
- `map` / `subflow`: `flow` → `flowName`. `subflow`'s `timeoutMs` belongs on
  the NODE (`FlowNodeSchema.timeoutMs`), not in its config.
- `script`: `functionName` → `function`, `input` → `inputs` (the singular
  stays canonical on `connector_action`'s `connectorConfig.input` — do not
  "fix" that one). The five `actionType`-branch keys keep their existing
  `retiredKey()` tombstones.
- `decision`: `config.condition` (singular) is **not** renamed to
  `conditions`. Nothing reads it on a decision — it is the trigger gate on a
  `start` node and inert everywhere else (#4414) — and declaring branches here
  *and* on the out-edges is the double-declaration #4414 was filed for.
  Branching lives on the out-edges. On a decision BRANCH the predicate slot is
  `expression`, so `condition` → `expression` there.
- decision branch `target`: a VIRTUAL designer column projected from the
  node's out-edges, never stored — route by matching the branch `label` to an
  out-edge `label`.

For a key rewritten at load by an ADR-0087 D2 conversion, reaching this
rejection means the config carries BOTH spellings: `renameConfigKey` leaves a
shadowed alias in place rather than clobbering the canonical winner, so the
retired twin is dead weight and should be deleted.
