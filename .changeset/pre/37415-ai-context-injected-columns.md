---
'@objectstack/lint': patch
---

fix(lint): a context pack may name a system column the platform injects

Clause-②: no
Metadata-protocol: none

`ai-context-field-unknown` no longer warns on a system column the platform adds to an object without the author declaring it (`owner_id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `organization_id`, …) when a context pack names it in `fields`, in a `related` entry's `fields`, `where` or `orderBy`, or in `body.field`. `get_record_context` reads the object's published definition, which carries those columns, and serves them like any field: the warning was false, and an author who followed it removed a field the assistant reads. A column the platform does not add to that object is still reported: `owner_id` on an object with `ownership: 'org'` or `'none'`, and every system column on an object with `systemFields: false`. A `body.field` naming an injected column is now judged by that column's type (`ai-context-body-not-long-text`), and a `related` entry's `orderBy` on one is judged by its sortability. On a related list whose root is a `sys_*` object, the child's injected references to it (`created_by`, `updated_by` and `owner_id` to `sys_user`) count as links, as they do for `get_record_context`: a child with one declared reference to that root and no `field` is now reported as having several.
