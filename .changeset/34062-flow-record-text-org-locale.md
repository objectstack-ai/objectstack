---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/service-automation': minor
'@objectstack/lint': minor
'@objectstack/runtime': patch
'@object-ui/app-shell': patch
---

feat(automation): a flow writes a field marked as text in the organization's language

Clause-②: yes (widening) — `create_record` / `update_record` `fields` values now also take the text envelope `{ dialect: 'template', source }` (`FlowRecordFieldValueSchema`), and the translation face gains `flows.<flow>.records.<node_id>.fields.<field>`; every value accepted before is accepted and written as before
Metadata-protocol: added
Skills-docs: follow-up #34434 — skills/objectstack-automation/SKILL.md (the record write's field values: the text envelope beside the CEL envelope and the literal), skills/objectstack-i18n/SKILL.md (the `flows.<flow>.records.<node_id>.fields.<field>` key and the organization-language rule)

A `create_record` / `update_record` field value can now be marked as text: `{ dialect: 'template', source: 'Auto-escalated: {{ record.priority }} priority' }`. The node writes that sentence in the organization's language, because everyone in the organization reads the record. It picks the translated template at `flows.<flow>.records.<node_id>.fields.<field>` first, then fills its `{{ }}` holes. The language is the Localization setting (`localization.locale`) when somebody set it, else the app's declared `i18n.defaultLocale`. It is never the language of the person who started the run, so a run started by a button writes the same text as a record-change run.

- A missing translation, or no language to pick, writes the authored text, and the run goes on.
- A bare string is still a literal and is written as spelled. Only the `fields` map of these two nodes takes the text envelope; every other value slot still refuses it. The source is judged as a text slot: a single-brace `{token}` is refused with its `{{ }}` spelling.
- A Localization setting that cannot be read fails the node and writes nothing, so another language is never stored over a choice that may exist. A `fault` edge routes the failure. A host that registers no `localization` setting has none set, so the app's declared default answers.
- The Studio flow inspector judges a record node's `fields` cells by the same rule (`FlowRecordFieldValueSchema`), so a text envelope there reads as valid and a malformed value still shows the spec's refusal. Fixes #34445.
- `os i18n extract` scaffolds the key, and the existing coverage check reports it missing against `supportedLocales`. `objectstack validate` refuses a key over an unknown node, over a node that is not a record write, or over a field the node does not mark as text.
- Text is picked when it is written. Records already written are not changed.

`@objectstack/core` exports `resolveOrganizationLocale` and `readOrganizationLocaleSetting`: one reader of the organization's language, for text the platform writes on the organization's behalf. `@objectstack/runtime`'s seed-locale resolver now reads its organization-setting rung through `readOrganizationLocaleSetting`; its answers are unchanged.
