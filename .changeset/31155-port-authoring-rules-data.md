---
'@objectstack/skills': patch
---

docs(skills): objectstack-data carries the metadata-authoring judgment the hosted build agent learned — booleans, people fields, dynamic defaults, process modelling, roll-up qualifiers, seed values, labels, sharing posture

Clause-②: no
Metadata-protocol: none

Card 1 of the cloud#3659 ruling A split: one source of metadata-authoring knowledge for every build channel. This is the `objectstack-data` port — the judgment the schema cannot express and the published skill did not yet state. `SKILL.md`: a yes/no flag is `{ type: 'boolean', defaultValue: false }` and never `required` ("must be accepted" is a validation rule); a person on the record is `type: 'user'`, optional unless asked; a dynamic default resolves on save and is described as such; record status is a `select` with a `state_machine`, never a status table; approvals, routing and audit trails are not objects; the record owner is the platform `owner_id`, never a hand-added lookup, and `ownership: 'none'` is only for catalogs and junctions; the `sharingModel` posture is chosen from the request; a `state_machine` declares `initialStates` whenever the status has a real start. `rules/relationships.md`: pick the roll-up function from the words, put every qualifier in `summaryOperations.filter` (dropped, it is a plausible wrong total), a rate is a formula over a working summary, and a summary added after the data loaded stays blank until a child is edited. `rules/naming.md`: labels follow the user's language. `references/seeds.md`: seed values may be fictional, never malformed. Eight eval cases pin the teachings (objects-fields-relationships 8–12, hooks-security-seeds-datasources 11–13).
