---
'@objectstack/spec': patch
---

docs(spec): the upgrade-guide entry `page-record-no-component-refused` says what the console draws today for a stored record page that places no component

Clause-②: no
Metadata-protocol: none

Prose only: no rule, schema, conversion or entry `id` changes. The ADR-0087 semantic entry `page-record-no-component-refused` (step 18 of `protocol-upgrade-guide.md`, and `spec-changes.json`) said that a page row already stored this way still opens every record of its object on a blank panel until it is fixed or deleted. The console no longer does that: opening a record of that object draws an explanation panel in place of the detail view, naming the page and the three fixes (place components in a region, make the page `kind: 'slotted'`, or delete it). The entry's `reason` now says so, and its `acceptanceCriteria` reads "not the explanation panel that names the page and its fixes" where it read "not a blank panel".
