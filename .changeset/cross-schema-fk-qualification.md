---
'@objectstack/driver-sql': minor
'@objectstack/objectql': minor
---

Cross-schema foreign keys are now qualified instead of shipping an unusable bare name (#11377).

`IntrospectedForeignKey` (driver-sql) gains an optional `referencedSchema`, present when — and
only when — the referenced parent table lives outside the introspecting session's resolution
scope (Postgres: the parent's schema is not on `current_schemas(false)`; MySQL: the parent's
database differs from `DATABASE()`; SQLite never sets it — no schemas, and a foreign key cannot
cross an ATTACHed database). `referencedTable` stays a bare name always — the qualification is a
separate key, never a conditional spelling.

`convertIntrospectedSchemaToObjects` (objectql) reads the new key: a foreign key whose target
carries `referencedSchema` is loudly skipped and flagged through the new `options.logger`
(default `console`) instead of being wired to the bare name — which either resolved to nothing
or to a same-named table in the current schema, silently. The column is kept as a plain field so
its data stays visible. Foreign keys with in-scope targets keep producing identical lookup
fields.
