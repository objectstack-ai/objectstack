---
'@objectstack/skills': patch
---

docs(skills): the data skill's Field Groups section teaches a group's `visibleWhen` and `requiresFeature`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/references/examples-objects.md` now names the two ways a whole field group (header included) is hidden: `visibleWhen`, a CEL predicate over the record that hides the group when FALSE or when it faults, and `requiresFeature`, a deployment feature flag from the `PUBLIC_AUTH_FEATURES` set, refused when unknown, lowered at parse into the group's `visibleWhen` and stripped, AND-combined after an authored `visibleWhen`; both are presentation only. The real example is `sys_organization`'s Group Structure section, hidden on a single-organization deployment with `requiresFeature: 'multiOrgEnabled'`. The text is paid for by deleting restatements in the same file (the intro sentence, the migrations paragraph, the deprecated-flag aside, the strictness sentence under Metadata Protection, a dangling "see above" and a path comment), so the file's token ceiling moves down, not up.
