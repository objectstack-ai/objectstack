---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

The skills teach where an object extension's additions go on the object it extends:

- `objectstack-data` Object Extension Model: `place` puts the extension's own fields, groups and child lists after (or before) a named item of the target, where the target declares `fieldGroups` / `relatedLists`. Example: `place: [{ field: 'tax_id', group: 'basic', after: 'industry' }, { list: 'acme_contract', after: 'crm_opportunity' }]`; a group of the extension's own is `{ group: { key, label }, after }`.
- `objectstack-ui` record-page rule: on a parent that declares `relatedLists`, a child list another package adds still shows, after the named lists or where that package's extension places it. The rule no longer says such a list is hidden until the parent names it.
- Eval: a new `objectstack-data` case places an add-on package's field after Industry in the account's Basic group and its child list after the Opportunities tab.
