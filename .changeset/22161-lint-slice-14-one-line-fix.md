---
"@objectstack/lint": patch
---

fix(lint): 17 more author-time rule ids print a `fix:` line of one remedy sentence, and `os explain RULE_ID` carries what those lines used to explain

Clause-②: no

- **Shorter fix lines.** Each finding of these 17 rule ids now carries a `hint` (the CLI's `fix:` line, the runtime issue's `hint`) of one remedy sentence of at most 200 characters on every variant the lint suite fires (the lengths here are the `hint` alone; the CLI prints it after `fix: `). The longest of each, before → after:
  - list-view search: `searchable-field-unknown` (448 → 129), `searchable-field-unprovisioned` (362 → 175) and `searchable-field-unsearchable` (328 → 139);
  - list-view sort: `sort-field-unprovisioned` (378 → 191), `sort-field-unsortable` (332 → 154) and `sort-field-unknown` (301 → 142);
  - visibility predicates: `visibility-predicate-unknown-function` (375 → 165), `visibility-bare-identifier` (221 → 102) and `visibility-predicate-syntax` (214 → 113);
  - flow filters: `flow-filter-token-unknown` (427 → 182);
  - actions: `action-no-placement` (424 → 171);
  - import mappings: `mapping-target-field-unknown` (405 → 189);
  - dashboards: `unconsumed-widget-option` (396 → 135);
  - app navigation: `nav-object-ungranted` (370 → 118);
  - hook bodies: `hook-body-write-unprovisioned-anchor` (365 → 178), `hook-body-write-unknown-field` (275 → 110) and `hook-body-source-unparseable` (254 → 105).
- **One line, one remedy.** Where a fix line explained its remedy, the explanation moved: why a stale or inadmissible `searchableFields` entry is a `400 INVALID_FIELD` on list search, that a view narrows the object's searchable set and never widens it, and that a lookup column stores only an id; that both runtime doors refuse a formula sort with `400 INVALID_SORT`; how to vouch for an unprovisioned anchor (`columnMap`) or opt the object out of the injection (`ownership: 'none'`, `systemFields: { audit: false }`); the two vocabularies a flow filter token resolves in; the other-language operator spellings CEL does not parse, why re-spelling cannot fix an unregistered function, and which namespaces each surface binds; why gating a nav entry does not clear a missing grant; which hook-body write shapes are checked; what a partially parsed body leaves unchecked.
- **A list the verdict already covers is not echoed.** `searchable-field-unknown`, `sort-field-unknown` and `mapping-target-field-unknown` no longer list every field of the object: the verdict's "Did you mean" names the near miss. `mapping-target-field-unknown` still lists the object's compound fields and their parts, as every import-mapping refusal does.
- **`os explain RULE_ID` carries the rest.** What the fix lines stopped saying is each id's `RULE_EXPLANATIONS` entry in `@objectstack/lint`, which `os explain RULE_ID` prints. Two ids had no entry and gain one, so their `rule:` line now ends with the `os explain` pointer: `action-no-placement` ("where an action can be placed") and `unconsumed-widget-option` ("which widget options a renderer reads"). Five entries gain text. The action locations the new entry spells out are held to the spec's `ACTION_LOCATIONS` by the rule's test.
- **At the runtime publish gate** (Studio, REST `PUT /api/v1/meta`, and the MCP and AI authors that write through that door), 10 of the 17 fire; the `hint` FROM → TO, measured at the door:
  - a `view` write: `sort-field-unknown` (422 `issues[].hint`, a name / a dotted path 114 / 261 → 47 / 135), `sort-field-unsortable` (422, 318 → 140), `sort-field-unprovisioned` (2xx `advisories[].hint`, 363 → 176), `searchable-field-unknown` (422, a name / a dotted path 281 / 430 → 48 / 129), `searchable-field-unsearchable` (422, a formula / outside the declared set / a lookup / a json column 222 / 142 / 323 / 157 → 110 / 68 / 135 / 64), `searchable-field-unprovisioned` (2xx advisory, 361 → 174), `visibility-predicate-syntax` (422, a recognised spelling / none 106 / 214 → 106 / 107), `visibility-predicate-unknown-function` (422, 371 → 165) and `visibility-bare-identifier` (422, a bare name / an unbound namespace 160 / 215 → 41 / 96);
  - an `object` write: `searchable-field-unknown` (422, the object's own set / a built-in list view 266 / 261 → 55 / 50), `searchable-field-unsearchable` (422, 222 → 110) and `searchable-field-unprovisioned` (2xx advisory, 361 → 174);
  - a `flow` write: `flow-filter-token-unknown` (422, `{TOMORROW()}` / `{ROUND(x)}` / `{Math.round(x)}` / `{TODAY() - 45 - 10}` 336 / 358 / 427 / 100 → 91 / 113 / 182 / 100).

  Studio's save-advisory toast prints an advisory's `hint` after its message, so the two `*-unprovisioned` toasts shorten; Studio renders no 422 issue's `hint`. No Studio, REST or MCP reader in this repository or in objectui matches on `hint` text; a tool that did should match on `rule` and `path` instead.
- **Never at the runtime gate:** `action-no-placement`, `mapping-target-field-unknown`, `unconsumed-widget-option`, `nav-object-ungranted` and the three `hook-body-*` ids run on the CLI only.
- **Unchanged:** every `message` (the verdict), rule id, severity and `path`, and what each rule accepts or refuses.
