---
"@objectstack/cli": patch
---

`os generate migration` and `os generate types` ask the ONE definition of "is this field multi-valued" — `isMultiValueField` in `@objectstack/spec` — instead of reading `field.multiple` raw, so the DDL they scaffold is the DDL `driver-sql` creates for the same object again (#18199).

Clause-②: no — no schema key moves, no accept set widens or narrows, no export changes. The generators' inputs and outputs keep their shapes; what changes is which predicate decides one branch inside them.

The maintainer ruling of 2026-09-13 (decision batch #128 item 5, option 1′) gave "multi-valued" one definition and made storage follow it. #17469 landed the `driver-sql` half — `createColumn` short-circuits on the spec predicate above its own type switch, `isJsonField` and `fieldHasColumn` derive from it — and left `packages/cli` reading the flag. For one release the two answered differently, which is #14829 ("the platform and the GENERATED DDL as two lists") in reverse:

| declaration | `os generate migration` before | `driver-sql` | now |
|---|---|---|---|
| `{ type: 'text', multiple: true }` | `JSONB` / `table.jsonb` | `TEXT` | `TEXT` / `table.text` |
| `{ type: 'lookup', multiple: true }` | `JSONB` / `table.jsonb` | JSON column | unchanged |

Two further shapes moved with it, both the same raw read:

- **`os generate types` stops emitting a nested array for a redundantly-flagged option type.** `multiple: true` is accepted (redundantly) on `multiselect` / `checkboxes` / `tags`, and the generated property type was `string[][]`; it is `string[]` now, which is what the value contract says and what the platform stores.
- **A column DEFAULT is no longer withheld from a single-value field that carries the flag.** `{ type: 'text', multiple: true, defaultValue: 'x' }` emitted a column with no DEFAULT while the driver emits `DEFAULT 'x'`.

⚠️ These declarations are refused at the authoring entrance by the same ruling's `FieldSchema` change, so they reach the generators only through the doors that never run it (`registerExternalObject` / `initObjects`, and a hand-written config the generators read unvalidated). Reachable, not authorable — which is why this is a `patch` and not a break.
