---
'@objectstack/lint': minor
---

feat(lint): `email-template-hole-grammar` accepts an `option` hole whose `object.field` names a field with options, and refuses one that names an object, field or option list the app does not have

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — `skills/objectstack-automation/SKILL.md` (the `notify` section) gains one line: an option label in a notice is written with the mail formatter `{{ stage | option:opportunity.stage }}`, not with `label()` in `templateData`. The skills lane owns that file.

`os validate`, `os build`, `os lint` and the metadata publish door judge each `{{ value | option:object.field }}` hole of a template's three faces against the app's objects as the registry serves them (`objectExtensions` fields folded in, the injected system columns beside the declared fields; at the publish door, the live object universe the gate carries). A select field with inline `options` or a `picklist` name is accepted. An object the app does not have, a field that object does not have and a field that declares no options are each refused at `error` under the existing rule id, naming the hole and what to fix, and so is an argument that is not a bare `object.field`. The finding's hint quotes `OPTION_ARGUMENT_RULE`. A misspelled formatter's refusal now lists `option` among the known mail formatters.
