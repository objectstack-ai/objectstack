---
"@objectstack/metadata-core": minor
"@objectstack/objectql": minor
"@objectstack/metadata-protocol": minor
"@objectstack/driver-sql": minor
"@objectstack/cli": minor
---

fix(objectql)!: a field whose `type` is absent or is not a `FieldType` member is refused at the registration door, and every downstream family default becomes a refusal (#16319)

<!-- adr-0087: not-required (no-migration-prescription) nothing an author can write is removed or renamed, and no conversion could repair these bodies: a field with no `type` carries no statement of intent for a conversion to rewrite, which is exactly the finding — the platform cannot know whether the author meant a bounded VARCHAR or an unbounded TEXT, and the two producers guessed differently. The remedy is a human decision per field, so it is prescribed in prose and in the refusal text rather than registered as a mechanical rewrite. -->

**BREAKING** for stored metadata only: an object whose declaration carries a field with no `type`, or with a `type` that is not a `FieldType` member, **no longer loads**. Shipped as `minor` under the repo's launch-window convention. Maintainer ruling, 2026-09-10, verbatim: 「16319 一个没写 type(或拼错)的字段 应该禁止加载。这个才是合理的吧?其他同意」.

**What you have to do.** Nothing, unless a `sys_metadata` row in your deployment carries such a field. If one does, the startup log names it at `error` level — object, field and reason — and the row is left untouched and still reachable: open it in Studio and give the field a real `FieldType` member, or delete it (`DELETE /api/v1/metadata/object/NAME`). Nothing that passes `FieldSchema` is affected: it has always required `type` and always refused a non-member, so only the doors that skip Zod could ever deliver one.

## What was wrong

One declaration produced two different columns. Measured on live PostgreSQL 16.13, driving all three producers from one object:

| declaration | driver | `os generate migration --format sql` | `--format ts` |
|:---|:---|:---|:---|
| `{ maxLength: 100 }`, no `type` | `character varying(100)` | `TEXT` | `TEXT` |
| `{ type: 'this_is_not_a_field_type', maxLength: 100 }` | `character varying(255)` | `TEXT` | `TEXT` |

`SqlDriver.createColumn` read `field.type || 'string'`, which heads its STRING-family arm and sizes the column from the declared `maxLength` (knex's 255 without one). All four generator loops in `os generate` read `String(fieldDef.type || 'text')`, which heads the TEXT family — unbounded unless the column is keyed. Both directions of harm are in the first row: the platform refuses a 101-character value that both generated tables accept, and a table generated from the same object accepts values the platform will not store.

## What it does now

- **One point of closure, at the registration door.** `SchemaRegistry.registerObject` refuses the WHOLE object declaration, with the ADR-0112 envelope (`INVALID_METADATA` + `422`), naming the object, the field and the reason — and offering the spec's own "did you mean?" for a mis-spelling. ⛔ The offending field is never dropped on its own: an object loaded one field short reports success at every authoring surface while the column is never created and every read of it answers `undefined`. Every door goes through this one — declared stacks, package and plugin manifests, `saveMetaItem`, the `sys_metadata` boot rehydration, and raw `registerObject` calls — and all three contributor kinds (`own`, `overlay`, `extend`) are judged, because `ObjectSchema.fields` and `ObjectExtensionSchema.fields` are both `z.record(z.string(), FieldSchema)`.
- **The startup policy is revised for this class.** `loadMetaFromDb`'s 「Registered anyway so it stays serveable and fixable」 no longer applies to it. The row does not register; the startup log states the consequence and the fix once, at `error`. The row itself is untouched, and the metadata API's raw-row path still lists it, still serves it with the offending field visible, still accepts a corrected write, and still deletes it — pinned, because a refused row that vanished from Studio would be unfixable.
- **Downstream guesses become refusals.** `createColumn` refuses a field that declares no `type` instead of building `varchar(255)` for it. All four `os generate` loops — both migration formats and both `os generate types` loops — refuse an absent or non-member `type` and generate nothing for that object, rather than emitting a table one column short. `fieldTypeToSql`'s docblock is rewritten in the same stroke: its `TEXT` miss branch is now dead residue of a total table, ⛔ not a family default to route anything new to.

## Scope, stated rather than left to be inferred

`SqlDriver.createColumn` refuses `type` ABSENCE, not `FieldType` MEMBERSHIP. Membership is refused for the whole object at the registration door, which fronts every route into `syncSchema`, so a non-member cannot reach the driver from a runtime at all. `driver-sql`'s own test corpus declares 388 non-member spellings across ~100 files that drive `initObjects` directly, and `'string'` is a declared `case` arm of that switch whose column shape differs from every member's — so closing that half is a corpus migration with column consequences, deliberately not folded into this change. A pin holds the boundary in both directions.
