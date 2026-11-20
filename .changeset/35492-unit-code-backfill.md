---
'@objectstack/objectql': minor
'@objectstack/cli': minor
'@objectstack/rest': minor
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
---

feat(units): `os migrate unit-codes` converts stored unit text into unit codes, from the operator's mapping

Clause-②: yes
Metadata-protocol: added

ADR-0158 U7 R1, the backfill door (#35492). It is the twin of `os migrate record-currency-codes`.

**What it is for.** A field declared a unit code field after its rows were stored still holds free text such as `kg`, `公斤` or `lbs`. Since #35489 the engine checks each unit code it writes, so editing a quantity beside such a value is refused until the row holds a code. This door converts those rows in one run.

**`backfillUnitCodes`** (`@objectstack/objectql`, also exported: `formatUnitCodeBackfillReport`, `unitCodeBackfillComplete`, `unitCodeMappingOf` and the report types):

- **Which field.** `field` names the unit code field: the `text` field a quantity's `unitConfig.unitField` names, or a standalone `unitConfig: { unitMode: 'code' }` field. If you name the quantity, the refusal is `INVALID_FIELD` and names the field to use.
- **The mapping.** It is the operator's, never derived. It maps stored text, exactly as written, to a unit code. Matching is exact: `kg ` and `KG` need their own entries.
- **Targets are judged before any row is read**, as the write would judge them. A target that is not a standard UN/ECE Recommendation 20 code or one of the organization's own units, a retired unit, or a unit of another dimension than the field's `unitDimension` is refused `INVALID_FIELD` / 400 on the field. With no organization named, organization codes are judged in each organization the run would write them in, still before any write.
- **Rows already holding a unit code are never rewritten**, so the run is idempotent: a second apply run writes nothing. That includes a unit the organization retired and a code of another dimension. Both are codes, not free text, and rewriting them from a mapping would change what the stored quantity means.
- **A blank unit beside a quantity** is written only from an explicit `""` entry. A blank unit with no quantity is left alone.
- **Dry run by default.** It lists each distinct stored value with its row count and what the mapping does with it, and writes nothing. With no mapping, the listing shows which spellings to map.
- **Unmatched values.** An apply run that meets a value with no mapping entry is refused `VALIDATION_ERROR` / 400 on `mapping` before any write. The refusal names each value with its row count, and carries them as `unmatched`.
- **Scope.** Scope is `organizationId` or `allOrganizations`, as on the currency backfill. An unscoped run over the rows of several organizations is refused with each organization's counts.
- **Writes.** Each row is written through `engine.update` as a system write, so the unit check judges every converted code.

**`os migrate unit-codes --object O --field F [--map-file mapping.json] [--org ID | --all-organizations] [--apply] [--yes]`** (`@objectstack/cli`):

- It has the precedent's confirmation and exit behaviour: `--apply` asks first, and exits 1 under `--json` or with no terminal unless `--yes` is given.
- A mapping file that is not JSON, or a mapping the engine refuses as malformed, is refused before the occupancy probe, the prompt and the boot.
- Any refusal exits 1. Under `--json` it carries the code, the HTTP status, and `unmatched` or `organizations` where those apply.

**`POST /api/v1/meta/_migrate-unit-codes`** (`@objectstack/rest`) is the tenant-admin twin of `_migrate-record-currency-codes`.

- Its body is `{ object, field, mapping?, apply? }`, and any other key is refused 400.
- It sits behind `metadata.endpoints.maintenance` and requires `setup.write`. It converts the caller's current organization only, and is a preview unless `apply: true`.
- The report is the `data` of the shared envelope. A refusal over unmatched values answers 400 with `error.details.unmatched`.

**The unit refusals name the door** (`@objectstack/objectql`). The `ERR_UNIT_CODE_REQUIRED` and `ERR_UNIT_CODE_UNKNOWN` refusals of a quantity written beside a stored value the write did not supply now end with the remedy: the `os migrate unit-codes` command for that object and field, or the REST door. The refusal of a blank names the `""` entry. A refusal of a code the caller wrote carries no remedy.

**A metadata save that declares a unit code field over stored rows is a destructive change** (`@objectstack/metadata-protocol`, `@objectstack/spec`). Two findings sit beside `currency_mode_to_record` on the 409 `DESTRUCTIVE_CHANGE`, and `force: true` lifts them:

- `unit_mode_to_record`: a stored quantity switched to `unitMode: 'record'`.
- `unit_mode_to_code`: a stored `text` field marked `unitMode: 'code'`.

Each names the conversion run for that object and field, CLI and REST.
