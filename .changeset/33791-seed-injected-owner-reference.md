---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a seed `owner_id` naming a person resolves on an object that relies on the injected owner column

Clause-②: no
Metadata-protocol: none

The seed loader builds its reference graph from the object definition the metadata service serves, which is the one the author wrote. An object that does not declare `owner_id` gets the column from the platform at registration, so the graph had no reference for it. A seed value naming a person there (`owner_id: 'Zhang Wei'`) was stored as that text, with no error and no log line, while a declared person field on the same row (`Field.user()`, `Field.lookup('sys_user')`) resolved the same name to the user's id. This happened on every load: the single-organization boot, the per-organization replay, the organization-create replay and a package install into an organization.

The graph now reads the injected `owner_id` as the `sys_user` lookup the platform registers. The value resolves like any person reference: across the database on a load with no organization, and through the organization's membership on an organization's own load. A person who is not a member of that organization is not resolved. The column is left NULL, and the load reports the same "not a member of organization" error a declared person field gets. The first-admin handoff can then claim the NULL owner. Before, a row with the name stored as text stayed owned by a user id that does not exist, and the handoff never claimed it because the value was not NULL.

A declared `owner_id` is unchanged: the author's field is read as before, whatever its type. An object that gets no injected owner (`ownership: 'org'`, `'none'` or `'business_unit'`, `managedBy`, a `sys_*` name, `systemFields: false`) gets no owner reference added. This change itself rewrites no stored row: a row that already holds a name in `owner_id` keeps it until a later seed write or an edit sets its owner.
