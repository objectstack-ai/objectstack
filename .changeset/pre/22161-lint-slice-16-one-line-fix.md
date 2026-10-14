---
"@objectstack/lint": patch
---

fix(lint): 17 more author-time rule ids print a `fix:` line of one remedy sentence, and `os explain RULE_ID` carries what those lines used to explain

Clause-②: no

- **Shorter fix lines.** Each finding of these 17 rule ids now carries a `hint` (the CLI's `fix:` line, the runtime issue's `hint`) of one remedy sentence of at most 200 characters on every variant the lint suite fires (the lengths here are the `hint` alone; the CLI prints it after `fix: `). The longest of each, before → after:
  - approval nodes: `approval-approver-not-membership-tier` (313 → 168), `approval-expression-no-empty-policy` (294 → 121) and `approval-expression-invalid` (292 → 144);
  - datasets: `dataset-include-unknown` (336 → 97) and `dataset-field-unknown` (206 → 139);
  - record titles: `title-format-retired` (267 → 148) and `title-unresolvable` (237 → 122);
  - list views: `list-view-field-unknown` (258 → 62) and `list-view-field-dotted` (233 → 158);
  - translations: `translation-target-unknown` (317 → 164);
  - seeds: `seed-insert-mode-duplicates-on-replay` (309 → 131) and `seed-value-outside-state-machine` (251 → 139);
  - charts: `chart-measure-unknown` (285 → 115);
  - object field-name lists: `object-field-ref-unknown` (284 → 186);
  - stack views: `view-container-shape` (256 → 187);
  - agents: `ai-skill-surface-mismatch` (235 → 171);
  - source-tier pages: `page-source-className-tailwind` (231 → 167).
- **Lists are no longer echoed.** `dataset-include-unknown`, `dataset-field-unknown`, `list-view-field-unknown` and `object-field-ref-unknown` no longer append the object's whole field list, `chart-measure-unknown` no longer lists the dataset's measures, and `translation-target-unknown` no longer lists the declared fields, views, sections, tabs, rules, actions, apps, navigation ids, dashboards, widgets, header actions, flows, screens, screen fields, refusing end nodes, params, outcomes or result paths: the verdict's "Did you mean" (on `chart-measure-unknown`, the fix line's own) names the nearest one. Two facts a list used to carry stay on the line as one bounded clause: a stale `_views` key is told that a nameless default `list` is keyed `default`, and a `_tabs` key over an object with no preset bar is told to declare the tab in a page's `interfaceConfig.userFilters.tabs`, because a list view's own `tabs` has no renderer. `dataset-filter-field-unknown`, outside this change, keeps its field list.
- **One line, one remedy.** Where a fix line explained its remedy, the explanation moved: what an expression approver's three roots hold, why `record` and `previous` are unbound at an approval node, and what `resolveAs` does; what each `onEmptyApprovers` policy does; that a business role is always a position; that a dataset join is derived from the object graph, up to three hops, with `a.b` including `a`; why `titleFormat` is retired and how a record title resolves, with its fallback; what a denormalised field is; which presentation positions a chart measure lands on, and that none carries a `suppressWarnings` key; the composite `externalId` of a junction table; that the seed exemption never licenses an undeclared state; when a skill may declare `surface: 'both'`; and why a Tailwind class in page source produces no CSS, with the theme-token and overlay advice.
- **`os explain RULE_ID` carries the rest.** What the fix lines stopped saying is each id's `RULE_EXPLANATIONS` entry in `@objectstack/lint`, which `os explain RULE_ID` prints. Five ids gain an entry, so their `rule:` line now carries the `os explain` pointer: `approval-expression-invalid`, `approval-expression-no-empty-policy`, `title-format-retired`, `title-unresolvable` and `page-source-className-tailwind`. Ten existing entries gain text. The enumerations an entry spells out are held to their sources by the rules' tests: the empty-slate policies to the spec's `onEmptyApprovers` enum, the expression roots to `APPROVER_EXPRESSION_ROOTS`, and the title-eligible types to `TITLE_ELIGIBLE_TYPES`.
- **At the runtime publish gate** (Studio, REST `PUT /api/v1/meta`, and the MCP and AI authors that write through that door), 9 of the 17 fire; the `hint` FROM → TO, measured at the door:
  - a `flow` write with an approval node: `approval-approver-not-membership-tier` (2xx `advisories[].hint`, 313 → 138), `approval-expression-invalid` (422 `issues[].hint`: an empty expression 216 → 90, a `record` root 292 → 144; a parse failure 129, a bare root 110 and the `resolveAs` advisory 102 unchanged) and `approval-expression-no-empty-policy` (2xx advisory, 294 → 121);
  - a `dataset` write: `dataset-include-unknown` (422, an entry naming nothing / an ordinary field 239 / 187 → 93 / 93) and `dataset-field-unknown` (422, a dimension / a measure 184 / 182 → 132 / 130);
  - an `object` write: `object-field-ref-unknown` (422, 180 → 128; the same text is the `fix` of the publish receipt's `object_field_ref_unknown` runtime probe issue), and on its `listViews`, `list-view-field-unknown` (422, 110 → 57) and `list-view-field-dotted` (422, 231 → 157);
  - a `view` write: `list-view-field-unknown` (422, 110 → 57) and `list-view-field-dotted` (422, a projection / a filter 231 / 143 → 157 / 95);
  - a `report` write: `chart-measure-unknown` (422 at the query position, 117 → 106; 2xx advisory at a presentation position, 301 → 113).

  Studio's save-advisory toast prints an advisory's `hint` after its message, so the three approval advisories and the chart presentation advisory shorten there; Studio renders no 422 issue's `hint`. No Studio, REST or MCP reader in this repository or in objectui matches on `hint` text; a tool that did should match on `rule` and `path` instead.
- **Never at the runtime gate:** `title-format-retired`, `title-unresolvable`, `translation-target-unknown`, both seed ids, `view-container-shape`, `ai-skill-surface-mismatch` and `page-source-className-tailwind` run on the CLI only.
- **Unchanged:** every `message` (the verdict), rule id, severity and `path`, and what each rule accepts or refuses.
