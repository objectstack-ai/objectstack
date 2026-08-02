---
"@objectstack/spec": major
---

BREAKING(spec): `FieldMapping` named three declarations — the two domain-specific
sides are renamed to `ConnectorFieldMapping` and `ImportFieldMapping` (#4703, #4535 C12)

`FieldMapping` / `FieldMappingSchema` were exported by **three** entry points for
**three different declarations**, so which type you got depended only on the import
path — the #4411 trap, one entry worse than the usual pair:

| entry | declaration | keys | shape |
|:--|:--|:--|:--|
| `@objectstack/spec/shared` (**unchanged**) | `shared/mapping.zod.ts` | 4 | the base — plain `z.object` |
| `@objectstack/spec/integration` (**renamed**) | `integration/connector.zod.ts` | 7 | `Base.extend({ dataType, required, syncMode })` |
| `@objectstack/spec/data` (**renamed**) | `data/mapping.zod.ts` | 4 | an independent `strictObject` |

The first two are base-and-superset. The third is **not the same concept at all**: it
is the column mapping of a CSV/table import (`mapping.fieldMapping[]`), not a
connector's remote-field mapping. Three ways the two are mutually unparseable:

1. **`transform` is the same key name with incompatible value types.** `shared` /
   `integration` take the discriminated union `FieldMappingTransformSchema`
   (`{ type: 'cast', targetType: 'string' }`); `data` takes a flat `TransformType`
   enum defaulting to `'none'`, steering a separate `params` bag.
2. **Different cardinality.** `data` accepts `string | string[]` for `source` and
   `target` — one target field may be composed from several columns (`split` /
   `join`). The other two accept a single `string`.
3. **Opposite failure modes for an unknown key.** `data` is a `strictObject`
   (#4001): it **throws**, naming the canonical spelling. The other two are plain
   `z.object`: they **strip silently**. Under one shared name, the same typo is a
   hard error in one domain and a no-op in the other.

Per **ADR-0112 D9(a)** the domain-specific sides take a domain prefix and the base
keeps the bare name — the same ruling that produced `ConnectorRateLimitConfig`
(#4684), `ConnectorErrorCategory` and `ConnectorRetryStrategy`. This is not a new
convention: `data/ExternalFieldMappingSchema` already extends the same base and,
purely because it carries a prefix, never entered the dual-source baseline at all.

The dual-source baseline shrinks **16 → 14**.

## FROM → TO

```ts
// before — @objectstack/spec/integration
import { FieldMappingSchema, type FieldMapping } from '@objectstack/spec/integration';
// after
import {
  ConnectorFieldMappingSchema,
  type ConnectorFieldMapping,
} from '@objectstack/spec/integration';

// before — @objectstack/spec/data
import { FieldMappingSchema, type FieldMapping } from '@objectstack/spec/data';
// after
import {
  ImportFieldMappingSchema,
  type ImportFieldMapping,
} from '@objectstack/spec/data';
```

**Importing from `@objectstack/spec/shared`? Nothing changes** — that `FieldMapping`
is the base, keeps its name, its four keys and its plain-`z.object` behaviour.

No deprecated aliases are kept on either renamed entry: re-exporting the old name
would be a third declaration of it and would re-open the trap this change closes.

⚠️ **Do not "fix" the compile error by re-pointing the import at
`@objectstack/spec/shared`.** That name resolves, and it is the wrong schema. On the
connector side it silently costs you `dataType` / `required` / `syncMode` — the base
is not `.strict()`, so those keys are **stripped at parse time** and the mapping runs
without them. On the import side the base rejects arrays and the enum form of
`transform` outright. Take the prefixed name for the domain you are in.

## Authored metadata needs no migration

This renames TypeScript exports and two internal JSON Schema `$def`s — **not a single
authorable key**. All eleven keys carry over unchanged, verified by the
`authorable-surface.json` ratchet rather than by inspection:

- `connectors[].fieldMappings[]` — `source`, `target`, `transform`, `defaultValue`,
  `dataType`, `required`, `syncMode` (7)
- `mapping.fieldMapping[]` — `source`, `target`, `transform`, `params` (4)

Same names, same types, same defaults, same strictness. Existing stack metadata,
stored `sys_metadata` rows and published apps are byte-for-byte unaffected, which is
why this ships with **no ADR-0087 conversion and no tombstone**: nothing was retired.
The `major` is for the two renamed TypeScript exports alone — the only edit an upgrade
needs is the import above.

The published JSON Schema `$id`s move with the defs:
`…/integration/FieldMapping.json` → `…/integration/ConnectorFieldMapping.json`, and
`…/data/FieldMapping.json` → `…/data/ImportFieldMapping.json`.

## Gate change riding along

`scripts/lib/renamed-defs.ts` (the #4684 carry-over table) gets its first entries
beyond the original one, and with them the first rules that only bind when the table
holds **more than one**:

- **two sources onto one target is rejected.** That is a merge, not two renames, and
  it defeats the table's purpose: `build-schemas.ts` carries the snapshot into a map
  keyed by the *new* key, so two defs' entries for one property name collapse — and
  the surviving `[RETIRED]` state is whichever was carried last. A key live under one
  def and tombstoned under the other would then read as already-retired, and the
  "every live → retired transition needs a registered conversion" check would never
  fire for it.
- **a chained rename (A → B → C) is rejected by name.** It was already red as
  "B is not emitted", which is true but misdiagnoses it as a typo; the carry is a
  single pass, so chains are unsupported outright.
