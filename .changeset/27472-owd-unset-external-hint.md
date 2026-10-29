---
'@objectstack/lint': patch
---

fix(lint): `security-owd-unset`'s fix line on a writable external object names the ways out `security-external-owner-unmapped` names, instead of recommending `'private'`

Clause-②: no
Metadata-protocol: none

`security-owd-unset` refuses a custom object with no `sharingModel`, and its fix line recommended `sharingModel: 'private'` for every such object. On a writable external object (`external.writable: true`) whose ownership column no remote row serves, `'private'` is the shape `security-external-owner-unmapped` warns refuses every member edit: the author followed one rule's advice into the other's warning.

- **Now, on a writable binding.** For exactly the objects `security-external-owner-unmapped` judges (`external.writable: true`, with no declared `owner_id`, or `created_by` on an object without `owner_id`), the fix line reads: declare `sharingModel: 'public_read_write'` and decide who may edit in a `beforeUpdate` hook, or declare the ownership column in `fields` and have the driver return the remote owner under that name, and declare `'private'` or `'public_read'`; `'controlled_by_parent'` for master-detail children. Both clauses are that rule's own wording, including its shorter one when an `external.columnMap` entry already targets the column.
- **Now, on a read-only binding.** An external object that no member writes (`external.writable` not `true`, or a datasource this stack declares with `external.allowWrites: false`) and whose `owner_id` no declared field or `external.columnMap` entry names is told to declare `sharingModel: 'public_read'`: on `'private'` a member reads none of its rows.
- **Unchanged.** The severity (`error`) and the verdict line. Every other custom object, and an external object whose owner is provable, keeps the `'private'` recommendation.
- `os explain security-owd-unset` explains both external cases and points at `os explain security-external-owner-unmapped`.

The same fix line reaches the runtime publish gate's 422 issue for an `object` write. That gate sees no `datasources`, so a writable binding on an `allowWrites: false` datasource gets the writable-binding line there; neither door recommends `'private'` for it.
