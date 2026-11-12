---
'@object-ui/types': patch
'@object-ui/data-objectstack': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
'@object-ui/components': patch
'@object-ui/plugin-form': patch
---

fix(fields, plugin-form): the permission-set picker lists one option per package that provides a set's name, and a grant's New form saves the package picked

Clause-②: yes (widening)
Metadata-protocol: none

A permission set is identified by its package and its name, and the registry serves one item per package that provides a name. The `permission-ref` picker listed them by name alone, so two packages' sets of one name were two identical options, and a grant could not say which one it meant.

- **Now.** Where more than one package provides a permission set's name, the picker lists one option per provider, each naming it: "Sales User (sales_user) · package com.acme.crm", or "… · defined in this environment" for the environment's own set. On a permission-set grant's New form, picking a package's set saves its package in the grant's package column beside the name. Picking the environment's set, or a name only one package provides, saves the name alone, as before.
- **Where a form cannot name the package** (editing a grant, whose package the server re-stamps by its own rule, and an action input that takes a set's name only), a package's option is listed but cannot be picked, and a note under the picker says why. The environment's own set can still be picked. The picker never chooses between packages by their order.
- **Shown values.** A stored name more than one package provides is shown as the set its grant's package column names. Without one it is shown as the environment's own set, or, where two packages provide it and none is named, as naming none.
- **Unchanged.** A name one provider serves is listed, saved and shown exactly as before, with no note, on every form. The relationship pickers keep their autofill on every form, and every other widget gets no new prop. Every other read-only column, every other object's, and every edit are still stripped from the save. The server still judges the package: an insert naming a package that does not provide the set is refused.
- **The widening.** `DataSource.listMetadataItems` (`@object-ui/types`) may answer an optional `packageId` on each item: the package it was served under, verbatim. `ObjectStackAdapter` (`@object-ui/data-objectstack`) answers it from the item's `_packageId`, and an item served without one reads as before. `@object-ui/fields` exports `PERMISSION_SET_GRANT_COLUMNS`, the grant's name and package columns, and `@object-ui/plugin-form` exports nothing new. `@object-ui/i18n` adds four `fields.registryRef.*` strings in every locale.
