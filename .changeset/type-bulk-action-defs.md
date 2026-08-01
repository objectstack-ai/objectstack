---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

feat(spec,lint)!: give `bulkActionDefs` a shape, and lint the aggregate name it references (#4457)

A selection-bar bulk action was declared as
`z.array(z.record(z.string(), z.any()))` — **no shape at all**. The real
contract lived in objectui's `BulkActionDef` interface and in the executor that
reads it, so every authoring mistake landed as a silent runtime downgrade:
`opeartion` parsed and the executor hit `Unknown operation: undefined` per row;
`excution: 'aggregate'` parsed and the def stayed per-record, so the endpoint
written for ONE `_selectedIds` call got N calls instead — the exact defect
objectui#3139 was filed to make expressible. That is ADR-0018's "second
vocabulary" smell (an action surface sharing none of `ActionSchema`'s checks)
crossed with ADR-0078's silently-inert metadata.

`ui/bulk-action.zod.ts` types it, with the same treatment `ActionParamSchema`
got in #3746/#4001: a **strict** def whose unknown-key error names the offending
key and the canonical spelling. Beyond spelling, it refuses the combinations the
executor never reads — `patch` outside an `update`, `execution` outside a
`custom`, `params` on a `delete`, `batchSize` on an aggregate — and refuses a
hand-written `actionDef`, which is attached by the renderer when it resolves the
def's `name` and which authored by hand would smuggle an action definition past
the action registry.

**One shape that parsed before is now rejected**: `operation: 'custom'` without
`execution: 'aggregate'`. `resolveBulkActions` attaches a dispatcher for exactly
one authored shape (the aggregate one); every other custom def falls to
`Promise.resolve()` per row — a button that reports success for every selected
record and does nothing. The error names both legal forms: `bulkActions:
['<name>']` for per-record (promoted with the action's own label, params and
`visible`), `execution: 'aggregate'` for one call over the whole selection.

Two things are deliberately left open:

- **`params[]` is `.passthrough()`.** objectui's `BulkActionParam` declares a
  `[key: string]: unknown` catch-all — widget config (min/max/step/format)
  forwarded to the field renderer as-is. Locking it down would reject valid
  config, so declared keys are typed and the rest rides through, the same call
  `dashboard.zod.ts` makes for a widget's `config`.
- **The bulk-param / action-param spelling divergence** (`help`/`helpText`,
  `default`/`defaultValue`, `object`/`reference`, plus `labelField`, which
  `ActionParamSchema` has no counterpart for). objectui already owns a converter
  for the promoted direction; converging the authored direction is a cross-repo
  change with its own migration. Typing them as they are is what makes the
  divergence visible rather than undocumented — the prerequisite for closing it.

`label` and the param/option labels are `z.string()`, not `I18nLabelSchema`:
an authored def reaches the grid verbatim (nothing resolves an `{ en, zh }` map
on this path) and the bar renders `def.label` as a React child, so blessing the
map form would trade a parse error for a blank screen. Localize by declaring a
real action and naming it in `bulkActions` — that path runs through the i18n
resolver.

**Lint**: `validate-action-name-refs` now covers `bulkActionDefs`. Only an
`execution: 'aggregate'` entry is a name reference (it is what
`resolveBulkActions` looks up); an `update`/`delete` def's `name` is a button id
and resolving it would be nonsense. The walk also reaches an **object's own
`listViews`** for the first time — an object has no top-level `list`, so that
tier had simply never been visited while the view-level ones were covered. And
the hint no longer tells a bulk-surface author to add a `locations` entry: the
selection bar is the one surface that does not filter on it, so naming the
action there is the whole placement.

Verified zero new findings against `app-showcase` / `app-crm` / `app-todo`.
