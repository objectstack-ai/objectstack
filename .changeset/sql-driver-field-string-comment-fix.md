---
"@objectstack/driver-sql": patch
---

fix(driver-sql): correct two comments in `createColumn` that cited a `Field.string` builder that has never existed (#12593)

Two comments in the keyed/bounded text-family branch of `createColumn`
(`signature` / `qrcode` / `richtext` / `code`) asserted a `Field.string`
builder exists and that it "has always taken knex's `varchar(255)`." It does
not exist and never has: `Field` has 37 keys and none is `string`,
`FieldType.options` (49 entries) does not list it, and
`FieldSchema.safeParse({ type: 'string', … })` fails at `[type]` — all three
reproduced fresh on this branch, plus `git log -S` confirming no commit ever
added such a builder key to `field.zod.ts`.

The name is not arbitrary: `'string'` is knex's own column-builder method
name (`table.string(name)`), reused internally by this driver as its
*untyped* default (`field?.type || 'string'`) — a storage-side spelling that
collides with, but is not, an authoring-side one. The corrected comments now
state only checkable facts: knex's bare `table.string(name)` (no length) is
`varchar(255)`; this branch never calls it bare, it calls
`table.string(name, keyable)` with the field's own declared `maxLength`
(up to `MAX_KEYABLE_VARCHAR_CHARS`, 768 chars); and the nearest *authorable*
spelling that reaches this exact `varchar(n)` shape is `Field.text({
maxLength: n })` on a keyed column — exactly what this switch arm already
serves.

No code changed — `git diff` is comment-only lines inside `sql-driver.ts`.
Nothing here alters DDL, column widths, or any runtime behavior; the two
pins that already exercise this exact branch behaviorally
(`sql-driver-11565-row-byte-budget.test.ts`'s "agrees with createColumn about
every FieldType" mirror, and `sql-driver-keyed-text-mysql.test.ts`'s
"emits varchar(maxLength) for a keyed bounded field") both stay green,
unmodified.

**Grade: `patch`, and deliberately no higher.** This is documentation
embedded in source, not an exported symbol, a spec key, or any authorable or
runtime surface — there is nothing here for a consumer to migrate. `patch`
is the correct floor for a fix that changes only what the driver's own
source *says*, matching the sibling `builtin-column-delivery-id-type.md`
changeset (#12131) that corrected the same false `Field.string` premise in
an adjacent file. Not a declared-breaking changeset, so no ADR-0087
disposition marker applies.
