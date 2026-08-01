---
"@objectstack/spec": patch
---

docs(spec): SystemFieldName says which columns are actually injected (#4430)

`SystemFieldName` presents itself as the canonical protocol-level names for
system fields, but it was neither the injected set nor a complete one — and it
had the most load-bearing entry backwards. `TENANT_ID` was documented as
"Tenant isolation key" while the column the registry actually provisions is
`organization_id`, which had no constant at all. Nor did `created_by` /
`updated_by`, the other half of the audit-provenance family. Two of the seven
entries (`user_id`, `deleted_at`) are not injected either, with nothing in the
table saying so.

Consumers hand-copying a system-field list read the table as the injection set
and drifted accordingly. cloud#982 found three such copies in one package
carrying `tenant_id`, `org_id` and `space` between them — three spellings no
injection site produces — and cloud#979 was one of those copies claiming a
business field named `owner`, so every seeded row of a user's app shipped its
负责人 column blank.

**Additive only. No entry removed, no value changed**, so existing
`SystemFieldName.X` references are unaffected.

- Adds `ORGANIZATION_ID`, `CREATED_BY` and `UPDATED_BY` — the three injected
  columns the table was missing.
- Records per entry whether open-core actually injects it, so the legacy
  (`tenant_id`, stamped from the session's *organization* id only on an object
  that declares it) and authored (`user_id`) names can no longer be mistaken
  for provisioned ones.
- States in the module doc that this is a NAME registry, not the injected set.
  `applySystemFields` decides that per object from `ownership` / `tenancy` /
  `systemFields`, so the same name is a system column on one object and
  business data on the next. A consumer asking "is this field system-managed on
  THIS object" branches on `Field.system` — already published for exactly that
  purpose, and now pointed at from here.

`@objectstack/lint`'s `SYSTEM_FIELDS` is unchanged in content: it unions this
table with `FIELD_GROUP_SYSTEM_FIELDS`, which already carried all three added
names.
