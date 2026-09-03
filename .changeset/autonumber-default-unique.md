---
"@objectstack/spec": minor
---

feat(spec): an `autonumber` field is `unique: 'organization'` by default; explicit `unique: false` opts out (#13894)

**BREAKING** emitted-shape change on `FieldSchema` (the accept set is unchanged),
shipped as `minor` under the repo's launch-window convention for breaking changes.

An auto-number is a business identifier — a contract number, a quote number, a
case number — and an identifier that may repeat is not one. Yet the platform
only ever materialized a unique index where the author had written `unique`
by hand: of hotcrm's nine auto-numbered identifiers, exactly one
(`crm_case.case_number`, `unique: true`) carried the tenant-composite unique
index, and the other eight could mint the same number twice (measured:
objectstack#12394 re-issued `ACC-000009`). Maintainer ruling 2026-08-31
(hotcrm#1301): the default flips.

- An `autonumber` field that **omits** `unique` now parses to
  `unique: 'organization'` — one holder per organization, materialized by the
  drivers exactly as `case_number`'s hand-written declaration was: the NULL-safe
  tenant-composite index `(COALESCE(organization_id, '__global__'), <field>)` on an
  organization-scoped object, a plain unique index on an object with no
  organization key.
- Every **other** field type keeps `unique: false` as its default, at the same
  key position — parse output for non-autonumber fields is byte-identical.
- Every **authored** spelling (`true`, `'organization'`, `'global'`, `false`)
  parses exactly as before, on every type.
- The default is materialized at parse time (the `.overwrite()` tail of
  `FieldSchema`, the type-conditional precedent `deleteBehavior` set), because
  the drivers read the parsed `unique` value-only; the published JSON Schema
  therefore no longer carries `default: false` on `Field.unique` — the
  description states the rule, and the authorable-defaults ratchet records the
  move as `data/Field:unique = false → (none)`.

**Opting out.** Write `unique: false` explicitly on the autonumber field. That
is the whole opt-out surface — no second key. It is legitimate only for a
display-only sequence that nothing uses to identify the record; note that the
platform's duplicate scan (`os migrate duplicates`) keeps treating every
autonumber field as an identifier regardless.

**Migration — what an operator with existing duplicates sees.** A table that
already holds duplicate auto-numbers cannot take the index. On SQLite/Postgres/
MySQL the SQL driver does not fail the boot and does not skip silently: it logs
on the `error` channel —

```
[sql-driver] cannot create NULL-safe unique index 'uniq_crm_quote_organization_id_quote_number' on "crm_quote" — existing rows violate it (duplicates the previous NULL-distinct index admitted, #5030). The constraint 'organization_id, quote_number' is NOT enforced until the data is deduplicated: run "os migrate plan" for the conflicting rows (ADR-0120 D4).
```

— and the same boot's drift pass names the conflicting key groups with their
row counts:

```
[schema-drift] crm_quote: cannot create 'uniq_crm_quote_organization_id_quote_number' as UNIQUE (COALESCE(organization_id, '__global__'), quote_number) — existing rows already violate the NULL-safe unique constraint (duplicates the old index wrongly admitted, #5030): (organization_id="__global__", quote_number="QUO-00009") × 2 rows; (organization_id="org_x", quote_number="QUO-00010") × 2 rows. The op is BLOCKED: apply re-probes and refuses, and the existing index stays in place (ADR-0120 D4). Deduplicate the listed rows, then re-run "os migrate plan".
```

`os migrate plan` reports the same blocked `create_index` with the same groups
until the rows are deduplicated; `os migrate duplicates` lists the holder row
ids of any value minted across organization partitions (the seed/API split).
Deduplicate — which duplicate keeps its number is a business decision — then
re-run `os migrate plan` / restart, and the index materializes. An object with
`tenancy.enabled: false` takes a plain unique index instead, and there the
driver raises the database's own unique-violation error at boot (it names the
index, not the rows) — run `os migrate duplicates` / a `GROUP BY <field> HAVING
COUNT(*) > 1` to find them.

Two landed defects change shape on purpose under the default: a counter that
re-issues a number after a burned reservation (#12394) and two counters minting
for one object (#8686) used to produce a *silent* duplicate; they now produce a
loud unique-violation refusal at the write.

<!-- adr-0087: registered autonumber-default-unique-organization -->
