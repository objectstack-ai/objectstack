---
"@objectstack/objectql": minor
---

The `__search` companion is no longer provisioned or backfilled on objects whose only companion source is the primary key (#10290)

`resolveSearchCompanionSources` resolves the companion's source through
ADR-0079's `resolveDisplayField`. That derivation ends at "first title-eligible
field by declaration order", and on a table whose only text column IS its
primary key — system tables, junction tables, append-only logs — it lands on
`id`. `id` is `type: 'text'`, not hidden and carries no `requiredPermissions`,
so it passed the eligibility gate: `provisionSearchCompanion` declared a
`__search` column on those objects and `plugin-pinyin-search`'s backfill walked
them at every boot.

That work is doomed by construction rather than merely unlikely. Both writers —
the `beforeInsert`/`beforeUpdate` stamp and the boot backfill — gate on
`containsCJK(row[source])`, and a platform-generated primary key is ASCII by
construction, so the predicate can never be true. Measured on a real
`bootStack` of `examples/app-showcase`: **20 of the 66 objects** the backfill
enumerated were in this state, walking whole platform tables to compute nothing
— `sys_secret`, `sys_oauth_access_token` and `sys_jwks` among them.

`resolveSearchCompanionSources` now returns `[]` when the resolved display
field is the record's primary key, and `isPrimaryKeyField` is exported as the
named judgement behind it.

**Keyed on the field's ROLE, not on "resolved by fallback".** The registry's
materialization seam runs `provisionPrimary(schema, { synthesize: false })`
before this module — a contractual order — and that pass writes `nameField:
'id'` onto the document, so by the time provisioning asks, a derived fallback
and an author's explicit pointer are byte-identical. The role is readable from
the name because that is where the platform keeps it: the driver provisions
`id` on every physical table unconditionally and there is no per-field
`primaryKey` marker in the spec, which is why `isPreservableUnderAudit` already
keys on `SystemFieldName.ID` for the same reason. `_id` is refused as the
alternate spelling of the same address.

**This interprets ADR-0079, it does not amend it.** The title contract is
untouched: `resolveDisplayField` still resolves `id`, `provisionPrimary` still
designates it, and `resolveRecordDisplayName` still renders the `Record #<id>`
floor. Only the search normalizer declines to take its input from there — the
same distinction #4483 drew one seam over on the READ path, where the display
field's job in the `$search` auto-default is to ORDER the set and never to
ADMIT a field the exclusions already rejected (`SEARCH_AUTO_EXCLUDED_FIELDS`
names `id` and `_id`).

**What does not change.** Existing permanently-NULL `__search` columns on
already-migrated tables stay: ADR-0045 migrations are additive and dropping a
physical column is a separate decision. Those deployments still stop walking —
the backfill skips an object whose sources resolve empty even when its schema
still declares the column. Objects with a real name/title field are unaffected:
provisioning, write-time stamping and the query-time `$or` clause all behave
exactly as before, including when the object also declares an `id` field and
when its display field is a plain text column that is not named `name`/`title`.
