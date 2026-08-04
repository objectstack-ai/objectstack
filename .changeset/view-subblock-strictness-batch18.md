---
'@objectstack/spec': major
---

**View sub-blocks now reject unknown keys instead of dropping them (#4001 批 18).**

Sixteen object shapes in `ui/view.zod.ts` were still zod's default `.strip`: a key
the schema did not declare was discarded and the parse still succeeded, so the view
rendered without whatever the key was meant to configure — no error, no warning,
`tsc` green. They are now closed, and the rejection names the surface, echoes the
offending key, and suggests the right one.

Closed shapes: `ViewDataSchema`'s four provider arms (`object` / `api` / `value` /
`schema`), `UserFilterField.options`, `GanttQuickFilter.options`,
`GanttConfig.tooltipFields`, `ListView.sort` / `.conditionalFormatting` /
`.emptyState`, the `keyField` block on a form field, `FormView.subforms`, and all
four arms of `FormView.submitBehavior`.

**Migration — the spellings that used to be silently dropped and now raise:**

| You wrote | Where | Write instead |
|---|---|---|
| `direction` | `list.sort[]` | `order` (`'asc'` / `'desc'`) |
| `object` | `form.subforms[]` | `childObject` |
| `objectName` | `data: { provider: 'object' }` | `object` |
| `delay` / `delayMS` | `submitBehavior: { kind: 'redirect' }` | `delayMs` |
| `visibleWhen` / `when` | `list.conditionalFormatting[]` | `condition` |
| `description` / `text` | `list.emptyState` | `message` |
| `count` | a user-filter option | nothing — counts are computed; set `showCount: true` on the filter field |
| `action` / `button` | `list.emptyState` | configure the `addRecord` block instead |

`sort` is the one worth acting on first: `{ field, direction: 'desc' }` used to parse
to `{ field, order: 'asc' }` — a list silently sorted the **opposite** way, reported
as valid. This is the same alias `SortNodeSchema` took in #4721, applied to the
second declaration of that tuple.

`submitBehavior` is now a discriminated union on the `kind` literal it already
required. No accepted input changes shape; the rejection improves — a plain union
reported `invalid_union` with one sub-error per arm, and the useful message did not
survive to the CLI (#5014).

**Not changed, deliberately:** `GanttConfig` / `TreeConfig` stay open at the parent
(`.passthrough()`) so renderer-ahead knobs keep reaching plugin-gantt / plugin-tree —
only the nested `tooltipFields` entry closed. `UserFiltersSchema`, `ViewItemSchema`
and the private `FormFieldBase` also stay open, each for a measured reason recorded
in the schema's own JSDoc, in `view-strictness-batch18.test.ts`, and in the `ui/` row
of `docs/audits/2026-07-unknown-key-strictness-ledger.md`.
