---
'@objectstack/mcp': patch
---

fix(mcp): the `describe_object` tool description says whose words a field `description` carries

Clause-②: no
Metadata-protocol: none

The tool description used to promise each field's `description` "where written", next to an object description "where the author wrote one", so a client read every field description as the app author's text. Most of them are not: on the CRM example no field declares a description, and every field description `describe_object` returns (8 on each of its 6 objects) belongs to a column the platform adds to the object (`organization_id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `owner_id`, `owning_business_unit_id`, `queue`), each answered with `system: true`. The sentence now reads "description (where set: the author's, or the platform's on a column it injects)". The answer itself does not change: same keys, same values, on both transports. The object-level clause stays as it was, because an object's description is always the one its author wrote.
