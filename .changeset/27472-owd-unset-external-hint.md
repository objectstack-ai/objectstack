---
'@objectstack/lint': patch
---

fix(lint): `security-owd-unset`'s fix line on a writable external object names the ways out `security-external-owner-unmapped` names, instead of recommending `'private'`

Clause-②: no
Metadata-protocol: none

`security-owd-unset` refuses a custom object with no `sharingModel`, and its fix line recommended `sharingModel: 'private'` for every such object. On a writable external object (`external.writable: true`) whose ownership column no remote row serves, `'private'` is the shape `security-external-owner-unmapped` warns refuses every member edit: the author followed one rule's advice into the other's warning.

- **Now.** For exactly the objects `security-external-owner-unmapped` judges (a writable binding, on a datasource this stack does not declare with `external.allowWrites: false`, with no declared `owner_id`, or `created_by` on an object without `owner_id`), the fix line reads: declare `sharingModel: 'public_read_write'` and decide who may edit in a `beforeUpdate` hook, or declare the ownership column in `fields` and have the driver return the remote owner under that name, and declare `'private'` or `'public_read'`; `'controlled_by_parent'` for master-detail children. Both clauses are that rule's own wording.
- **Unchanged.** The severity (`error`) and the verdict line. Every other custom object, and an external object that already declares its ownership column, keeps the `'private'` recommendation.
- `os explain security-owd-unset` explains the writable-external exception and points at `os explain security-external-owner-unmapped`.

The same fix line reaches the runtime publish gate's 422 issue for an `object` write.
