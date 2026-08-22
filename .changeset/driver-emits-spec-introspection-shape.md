---
"@objectstack/driver-sql": minor
"@objectstack/objectql": minor
---

fix(driver-sql): `introspectSchema()` emits the spec introspection contract — `primaryKey`, `dialect`, `introspectedAt` (#10676, #10998)

**BREAKING** change to the value `SqlDriver.introspectSchema()` returns, shipped
as `minor` under the repo's launch-window convention for breaking changes.

`packages/spec/src/contracts/schema-diff-service.ts` declares one introspection
contract. The driver declared a second one beside it and, separately, so did
`packages/objectql/src/util.ts`. The three agreed on the idea and disagreed on
the vocabulary: the driver spelled a column's primary-key membership
`isPrimary`, the spec spells it `primaryKey`; the spec declares `dialect` and a
REQUIRED `introspectedAt` that the driver's schema type never mentioned and
`introspectSchema()` therefore never emitted. Nothing was type-unsound — each
side compiled against its own declaration and the value crossed between them
with no compiler in the middle.

Measured on a live in-memory SQLite database before this change: the id column
of a `primary key (id)` table came back carrying `isPrimary: true` with no
`primaryKey` key at all, and `Object.keys()` of the schema was `["tables"]`.
Two consequences, both silent:

- `ExternalDatasourceService.generateObjectDraft` reads `col.primaryKey`, so
  every federated object drafted from a real remote table lost the remote
  primary key — the addressing key for the federated table, dropped by the
  codegen meant to produce it (#10676).
- type mapping ran with `dialect: undefined` across the whole federation path,
  making every per-dialect alias in `suggestFieldTypeForSqlType` unreachable
  there, and `refreshCatalog` persisted `dialect: undefined` into the
  `external_catalog` record Studio's schema browser and the boot gate read
  back (#10998).

Maintainer ruling, 2026-08-22 (live session, 「同意所有」 item 9 =
驱动侧对齐 spec 契约): `packages/spec` is the one contract and the driver
aligns to it.

What the driver now returns: every column carries the boolean `primaryKey`, the
schema carries `dialect` and `introspectedAt`, and the retired `isPrimary`
member is gone rather than emitted alongside — one spelling, so no consumer can
key off the wrong one again. `dialect` is the driver's canonical dialect name
(`sqlite`, `postgres`, `mysql`, `unknown`), which is the vocabulary the only
in-tree consumer keys its alias tables on; `introspectedAt` is an ISO 8601
instant stamped before the reads begin.

`IntrospectedColumn`, `IntrospectedTable` and `IntrospectedSchema` in both
`@objectstack/driver-sql` and `@objectstack/objectql` are now derived from the
spec contract instead of re-declared, so a key added there fails their `tsc`
until the producer emits it. Two divergences are kept explicitly: `defaultValue`
stays `unknown` at the SQL layer because Knex reports `null`, and `indexes` is
omitted rather than emitted empty because this driver does not introspect
indexes and an empty array would tell a schema differ that a table has none.

TypeScript consumers of the removed member are told by the compiler, precisely
and at every site: `Property 'isPrimary' does not exist on type
'IntrospectedColumn'`.

<!-- adr-0087: not-required (runtime-interface-only packages/drivers/driver-sql/src/sql-driver.ts#IntrospectedColumn, packages/drivers/driver-sql/src/sql-driver.ts#IntrospectedSchema, packages/objectql/src/util.ts#IntrospectedColumn, packages/objectql/src/util.ts#IntrospectedSchema) these are published runtime TypeScript interfaces describing a driver's introspection RESULT — not a metadata surface. There is no Zod schema, no `packages/spec` declaration of the old spelling, and no stored representation of it, so `objectstack migrate meta` has nothing to rewrite; the channel that reaches every affected consumer is the compiler. -->
