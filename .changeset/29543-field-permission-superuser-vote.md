---
'@objectstack/spec': patch
---

docs(spec): the `FieldPermission.when` description names the View All / Modify All field vote

Clause-②: no
Metadata-protocol: none

Description text only: no key, accepted value or default of any schema changes. The published `when` description (and the `FieldPermissionSchema` docblock) said that only the sets declaring a field vote on it. Since `@objectstack/plugin-security` and `@objectstack/core` shipped the super-user field vote, a set holding the super-user bypass on an object (its own entry for the object, otherwise its `'*'` wildcard) votes on every field of that object, on every row: `viewAllRecords` votes `readable: true`, and `modifyAllRecords` votes `readable: true` and `editable: true`, so a row-conditioned lock never binds a Modify All holder. View All never grants an edit. Otherwise union without deny is unchanged. The description now says so, and the generated JSON Schema and reference pages carry it. Nothing to migrate.
