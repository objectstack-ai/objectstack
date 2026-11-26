---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/plugin-security': minor
'@objectstack/metadata-core': minor
'@objectstack/driver-sql': minor
'@objectstack/platform-objects': patch
---

feat(units): a number field declares its unit with `unitConfig`, and the engine checks every unit code it stores

Clause-②: yes
Metadata-protocol: added

ADR-0158 R1, the membership card (#35489).

**`unitConfig` on a field** (`@objectstack/spec`, `UnitConfigSchema`):

- `{ unitMode: 'fixed', unit: 'KGM' }` on a `number`: the quantity is always in one standard UN/ECE Recommendation 20 unit, checked at parse against the standard unit table (exact uppercase; `C62` and `EA` are answered with the piece, `H87`).
- `{ unitMode: 'record', unitField: 'uom', unitDimension?: 'mass' }` on a `number`: each record names its unit by code in the sibling `text` field `unitField` names. The object refuses a pointer into nothing, into a non-`text` field, through a parent (`PARENT_FIELD.UNIT_FIELD` is reserved: a child cannot follow its parent's unit yet), or into a field carrying its own marker, and two quantities sharing one unit field with different `unitDimension` values.
- `{ unitMode: 'code', unitDimension?: 'count' }` on a `text`: a field holding a unit code with no quantity beside it, such as a material's base unit (Open item 8, ruled A). It is a unit marker, not a value domain, and is refused beside a `valueDomain`.
- `unitMode` is required and has no default. The key is refused on every other field type (`currency`, `formula`, `summary` included). A quantity stays a bare number, and needs no `scale`.

**The write check** (`@objectstack/objectql`): at every insert, by-id update, predicate update and `validate()` preview, a unit code the row stores must be a standard code or one of the organization's own non-retired units (`sys_unit`), in exact uppercase and of the declared `unitDimension`, and a quantity may not stand beside a blank code. The row image is judged whenever the write touches the quantity or its unit field (Open item 9). Refusals, each 400, registered in the error-code ledger: `ERR_UNIT_CODE_REQUIRED`, `ERR_UNIT_CODE_UNKNOWN`, `ERR_UNIT_CODE_RETIRED`, `ERR_UNIT_DIMENSION_MISMATCH`. A row resting on a code that is no longer a member stays editable in its other fields; a quantity edit beside it is refused until the row moves to a member unit.

**A unit is retired, never deleted**: the engine refuses a delete of a `sys_unit` row for every caller, a system writer and an automation run included, by id and batched (405 `ERR_UNIT_DELETE_REFUSED`), and `organization_admin` names `sys_unit` explicitly with no delete (`@objectstack/plugin-security`).

`@objectstack/metadata-core` and `@objectstack/driver-sql` classify the new field key (field-level security keeps it; the DDL does not read it). `@objectstack/platform-objects`: the `sys_unit` docblock names its readers.
