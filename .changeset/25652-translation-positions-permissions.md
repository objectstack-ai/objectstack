---
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(spec,cli): positions and permission sets are translatable — `positions.<name>` and `permissions.<name>` in the translation bundle

Clause-②: yes (widening)
Metadata-protocol: added

An app authored in one language ships its positions (`positions[].label`) and permission sets (`permissions[].label`) in that language. Before this change the translation bundle had no key for them: a bundle carrying `positions` was refused by `os validate` as an unrecognized key, so those labels stayed in the authoring language next to translated object, app and flow labels, and `os i18n check` could not report the gap.

- **`@objectstack/spec`:** `TranslationData` (and the registered `translation` item and the platform bundle, which share its groups) gains `positions` and `permissions`, keyed by the position's and the permission set's `name`, each carrying `label` and `description` (strict; `name` and `title` are renamed onto `label`, and the group spellings `position`, `permission` and `permissionSets` onto the declared groups). Two new translators, `translatePosition` and `translatePermissionSet`, overlay them, and both are registered in the metadata-document dispatch, so `GET /meta/position` and `GET /meta/permission` — the lists the console's position and permission-set pickers draw — are served in the request's locale. A key the bundle does not carry keeps the authored string.
- **`@objectstack/cli`:** `os i18n extract` scaffolds `positions.<name>.label` / `.description` and `permissions.<name>.label` / `.description` from the stack's `positions[]` and `permissions[]`, and `os i18n check` / `os lint` coverage report an untranslated one in its own bucket (`i18n/missing-position`, `i18n/missing-permission`).

Example (`en` bundle of a Chinese-authored app):

```ts
positions: { srm_legal_counsel: { label: 'Legal Counsel' } },
permissions: { srm_contract_reviewer: { label: 'Contract Review', description: 'Reads and approves supplier contracts' } },
```
