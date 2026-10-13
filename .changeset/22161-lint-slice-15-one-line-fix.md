---
"@objectstack/lint": patch
---

fix(lint): 17 more author-time rule ids print a `fix:` line of one remedy sentence, and `os explain RULE_ID` carries what those lines used to explain

Clause-②: no

- **Shorter fix lines.** Each finding of these 17 rule ids now carries a `hint` (the CLI's `fix:` line, the runtime issue's `hint`) of one remedy sentence of at most 200 characters on every variant the lint suite fires (the lengths here are the `hint` alone; the CLI prints it after `fix: `). The longest of each, before → after:
  - react pages: `react-chart-field-unprovisioned` (362 → 175), `react-prop-missing-required` (277 → 131), `react-page-source-unparseable` (254 → 105) and `react-block-needs-record-context` (228 → 195);
  - action bodies: `action-body-write-unprovisioned-anchor` (358 → 171), `action-body-write-unknown-field` (323 → 91), `action-record-write-discarded` (309 → 104) and `action-body-source-unparseable` (254 → 105);
  - agents: `agent-authoring-withdrawn` (363 → 158) and `default-agent-outside-roster` (237 → 118);
  - flow nodes: `flow-node-write-unprovisioned-anchor` (358 → 171) and `flow-node-write-unknown-field` (289 → 110);
  - object validation rules: `validation-rule-json-schema-uncompilable` (341 → 124) and `validation-rule-regex-uncompilable` (300 → 135);
  - translations: `translation-section-name-missing` (359 → 172);
  - managed objects: `object/managed-api-method-unaffordable` (357 → 169);
  - app navigation: `nav-object-unservable` (348 → 156).
- **One line, one remedy.** Where a fix line explained its remedy, the explanation moved: how to vouch for an unprovisioned anchor (`columnMap`) or opt the object out of the injection (`ownership: 'none'`, `systemFields: { audit: false }`), now on the react-chart, action-body and flow-node anchor ids too; what a partially parsed source leaves unchecked; which action-body write shapes are checked and that the warning never blocks a build; why the flow-node unknown-field finding gates where the body rules advise; that skills attach to the platform agents by `surface` affinity, so dropping a custom agent loses nothing; the escaped regex spellings and the named `format`s; the shapes the common JSON Schema keywords take; that a suggested section name is never a key derived from the label; and that a record block's react-tier replacement binds the record itself.
- **Shared one-line forms.** The anchor and parse ids of the react-page, action-body and flow-node rules print the same one-line forms the hook-body ids print (`If the remote table carries '…', declare it in …'s own fields (mapped through columnMap); otherwise drop the reference or opt the object out of the injection`, and `Fix the syntax error and re-run: until the source parses, the checks cover only what the parser recovered`).
- **Quoted from the contract, cut to one sentence.** A missing required react-tier binding still prints the contract's own description of it, now its first sentence, which names the binding and its spelling (`Pass data={…}: The object this block binds to, written as the metadata-tier data source: data={{ provider: 'object', object: '…' }}`); the rest of the description is in the published react-blocks reference. A record block's line is the spec's named replacement behind the lead-in `Instead:`.
- **`os explain RULE_ID` carries the rest.** What the fix lines stopped saying is each id's `RULE_EXPLANATIONS` entry in `@objectstack/lint`, which `os explain RULE_ID` prints; eleven entries gain text. The named formats the regex entry spells out are held to the spec's `FormatValidationSchema` by the rule's test. `react-prop-missing-required` has no entry, as before, so its `rule:` line carries no pointer.
- **At the runtime publish gate** (Studio, REST `PUT /api/v1/meta`, and the MCP and AI authors that write through that door), 5 of the 17 fire; the `hint` FROM → TO, measured at the door:
  - an `object` write: `object/managed-api-method-unaffordable` (422 `issues[].hint`, two refused verbs / every write verb 335 / 372 → 132 / 169), `validation-rule-regex-uncompilable` (422, the pattern `([` / a 28-character pattern 288 / 314 → 123 / 149) and `validation-rule-json-schema-uncompilable` (422, 341 → 124);
  - a `flow` write: `flow-node-write-unknown-field` (422, with / without a near miss 271 / 250 → 92 / 71) and `flow-node-write-unprovisioned-anchor` (2xx `advisories[].hint`, 361 → 174).

  Studio's save-advisory toast prints an advisory's `hint` after its message, so the flow-node anchor toast shortens; Studio renders no 422 issue's `hint`. No Studio, REST or MCP reader in this repository or in objectui matches on `hint` text; a tool that did should match on `rule` and `path` instead.
- **Never at the runtime gate:** the four react-page ids, the four action-body ids, the two agent ids, `translation-section-name-missing` and `nav-object-unservable` run on the CLI only.
- **Unchanged:** every `message` (the verdict), rule id, severity and `path`, and what each rule accepts or refuses.
