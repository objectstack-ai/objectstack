---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui and objectstack-i18n teach six keys the platform already draws — `pressed`, the `{{ }}` copy slots `description` / `helpText` / `outcomeMessages`, the param dialog's `submitText` and its translation slot, the form thank-you translation keys, `kanban.lanes` and report chart `seriesBy`

Clause-②: no
Metadata-protocol: none

- **Before.** Each key shipped in the spec and the console drew it, but no published skill taught it: an agent authoring from the skills wrote a toggle header action with no `pressed`, spelled the dialog line, a param hint or a per-outcome toast with `${…}` holes that `os validate` refuses, left the param dialog's button at "Confirm", translated no thank-you panel, could neither order kanban lanes nor drop an always-empty one, and split a chart by a second dimension with a `matrix` workaround.
- **Now.** `objectstack-ui/rules/actions.md` teaches `pressed` (display-only reader state over an `attachedOnRead` block; a boolean literal is refused), names all five `{{ }}` copy slots with one example each, and teaches `submitText` beside `params` (with the `confirmText` contrast and the refused spellings); its `ReassignLeadAction` example sets `submitText`, and eval 11 asks for a param dialog whose button reads the verb. `rules/list-views.md` shows `kanban.lanes` in the kanban example — a choice of lanes and their order, not a record filter. `rules/dashboards.md` sets `seriesBy` on the report chart example and says where it is refused (an undeclared dimension, the `xAxis` dimension, a single-series type). `objectstack-i18n/SKILL.md` lists `_views.{view}.submitBehavior.title` / `.message` and `_actions.{action}.submitText`.
- Every file stays at or under its token ceiling: the actions, list-views and dashboards additions are paid for by condensing text in the same file (the `ctx` section's blessed-name code block, which restates the objectstack-data hooks reference; two ADR-0047 renderer notes folded into the code comments they repeat; two engine- and Studio-facing notes that told an author nothing to write). No ceiling moves, no frontmatter changes, no schema, key or behaviour changes.
