---
'@objectstack/skills': patch
---

docs(skills): teach a flow record write's text envelope and its organization-language key

Clause-②: no
Metadata-protocol: none

`objectstack-automation` now says that a `create_record` / `update_record` `fields` value takes a third form beside the literal and the CEL envelope: the text envelope `{ dialect: 'template', source }`, for a sentence people read. Its `source` is a text slot, it is written in the organization's language (the Localization setting when somebody set it, else the app's `i18n.defaultLocale`), never in the language of the person who started the run, a missing translation writes the authored text, and a Localization setting that cannot be read fails the node. A bare string stays a literal and is never translated.

`objectstack-i18n` names the key that translation lives at, `flows.FLOW.records.NODE_ID.fields.FIELD`, beside the other keys that sit deeper than their group's `label`, and says `os i18n extract --no-objects-only` scaffolds it.

To pay for the text, `objectstack-automation` drops three sentences that are said elsewhere: the CEL callout's pointer to `objectstack-formula` (the skill's description already says to load it), the Trigger Configuration lead-in listing a flow's top-level keys (the examples reference shows whole flows), and the pure-function row of the `functions` example (the same item says a flow function is a pure compute step).
