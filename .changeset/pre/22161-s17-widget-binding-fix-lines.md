---
"@objectstack/lint": patch
---

fix(lint): the 11 dashboard widget-binding rule ids print a `fix:` line of one remedy sentence, and `os explain RULE_ID` carries what those lines used to explain

Clause-②: no

- **Shorter fix lines.** Each finding of these 11 rule ids (all in `validate-widget-bindings.ts`) now carries a `hint` (the CLI's `fix:` line, the runtime issue's `hint`) of one remedy sentence of at most 200 characters on every variant the lint suite fires (the lengths here are the `hint` alone; the CLI prints it after `fix: `). The longest of each, before → after:
  - dashboard filters: `dashboard-filter-field-unprovisioned` (561 → 177), `dashboard-filter-field-unknown` (403 → 148) and `dashboard-filter-field-not-included` (218 → 144);
  - widget filters: `widget-filter-field-unknown` (322 → 133);
  - refused `chartConfig` keys: `chart-field-unknown` (415 → 152);
  - empty selections: `chart-measures-missing` (369 → 144), `widget-measures-missing` (330 → 154) and `chart-dimensions-missing` (291 → 161);
  - legacy analytics keys: `widget-legacy-analytics-shape` (338 → 113) and `widget-legacy-analytics-unrenderable` (320 → 105);
  - tables: `table-count-only` (311 → 136).
- **Lists are no longer echoed.** `dashboard-filter-field-unknown` and `widget-filter-field-unknown` no longer append the object's whole field list, and `dashboard-filter-field-not-included` no longer lists the dataset's declared `include` paths: the verdict's (or, on a bare dashboard-filter field, the fix line's own) "Did you mean" names the nearest field. The three empty-selection ids still name what the dataset declares, because no "Did you mean" can: at most three names, then `…`, or "it declares no measures yet".
- **One line, one remedy.** The `suppressWarnings` clause leaves every warning's fix line, and with it: how DatasetWidget reads a dataset-bound widget; that a dotted filter target must traverse relationship fields and have its prefix in `include`, and that `a.b` includes `a`; how to vouch for or opt out of an unprovisioned anchor (`dashboard-filter-field-unprovisioned` now prints the shared one-line anchor fix the other anchor ids print); what replaces each refused `chartConfig` key, and the `os migrate meta --from 17` route; which widget families need no dimensions; and why a flat record listing is not an analytics dataset (ADR-0017).
- **`os explain RULE_ID` carries the rest.** What the fix lines stopped saying is each id's `RULE_EXPLANATIONS` entry in `@objectstack/lint`, which `os explain RULE_ID` prints. Two ids gain an entry, so their `rule:` line now carries the `os explain` pointer: `table-count-only` and `widget-legacy-analytics-shape`. Seven existing entries gain text.
- **At the runtime publish gate** (Studio, REST `PUT /api/v1/meta`, and the MCP and AI authors that write through that door), all 11 fire on a `dashboard` write; the `hint` FROM → TO, measured at the door:
  - 422 `issues[].hint`: `widget-legacy-analytics-unrenderable` 320 → 105; `dashboard-filter-field-unknown` 196 / 195 / 290 → 148 / 147 / 137 (an inherited bare field, a re-targeted bare field, a dotted path); `dashboard-filter-field-not-included` 213 → 139; `widget-filter-field-unknown` 220 → 126;
  - 2xx `advisories[].hint`: `widget-legacy-analytics-shape` 338 → 112; `dashboard-filter-field-unprovisioned` 550 → 173; `chart-field-unknown` 413 / 294 / 324 → 150 / 124 / 127 (an x-axis, a y-axis, a series); `chart-measures-missing` 240 → 96; `widget-measures-missing` 310 → 134; `chart-dimensions-missing` 297 → 156; `table-count-only` 311 → 136.

  Studio's save-advisory toast prints an advisory's `hint` after its message, so the seven advisories shorten there; Studio renders no 422 issue's `hint`. No Studio, REST or MCP reader in this repository or in objectui matches on `hint` text; a tool that did should match on `rule` and `path` instead.
- **Unchanged:** every `message` (the verdict), rule id, severity and `path`, and what each rule accepts or refuses.
