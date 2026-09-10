---
"@objectstack/objectql": minor
"@objectstack/lint": minor
---

fix(objectql)!: the create-side static-`readonly` strip judges the user-writable `managedBy` buckets, as update already did (#15719)

<!-- adr-0087: not-required (no-migration-prescription) an over-wide runtime exclusion is narrowed; no authored key changes spelling, meaning or legality, and `managedBy`'s own enum is untouched — there is nothing for `objectstack migrate meta` to prescribe -->

**BREAKING** for a non-system caller that CREATES a static `readonly` column on an
object declaring `managedBy: 'platform'`, `'config'` or `'system-data'` under a name
outside the reserved `sys_` namespace: the forged value used to be persisted and is
now stripped, with the field's own `defaultValue` re-derived (#3043) and the drop
reported on the usual channels (`readonlyStripWarning` at `warn`, `onFieldsDropped`
under reason `readonly`, `strictReadonlyWrites` refusing before any driver dispatch).
That is exactly what the same caller's UPDATE of the same column already did. Shipped
as `minor` under the repo's launch-window convention.

**Measured population: zero shipped objects.** A census of this tree finds 81 object
declarations carrying `managedBy` and **none** of them named outside `sys_`, so every
platform object stays exempt through the namespace test that is unchanged here — the
21 of them in the three now-judged buckets included, holding 64 static `readonly`
columns between them. `sys_metadata_history.recorded_by`, seeded by a direct
non-system `engine.insert` from the metadata repository, is doubly exempt
(`engine-owned` bucket **and** `sys_`) and is pinned as such. The narrowing therefore
reaches app-authored objects only, which is the population the ruling is about.

## What was wrong

`staticReadonlyInsertSubject` returned `null` for `managedBy` set to **anything**,
carried over byte-for-byte from the deleted DataProtocol ingress copy on ADR-0086 /
#3004 grounds: those columns have their own 403 guards, and a silent strip must not
swallow the payload the guard exists to reject. The argument is sound and the bucket
list was not. `managedBy: 'system-data'` means "platform-defined schema,
**admin/user-writable data**" by its own definition, and `object.zod.ts` says in the
same breath that it "carries no such guard; its writes are adjudicated by the
delegated-admin gate / RLS / permission sets". So the create side skipped the strip on
objects whose data is the user's, while the update side stripped them — and #14147's
"one semantics, one enforcement point" was not literally true on that population.

## What it does now

The exclusion follows its reason. `null` is returned for the `sys_` namespace, and for
the three buckets whose columns really do carry a fail-closed refusal:

| bucket | its own refusal | the create-side strip |
|:--|:--|:--|
| `engine-owned` | ADR-0103 engine-owned write guard | steps around it |
| `append-only` | ADR-0103, same guard (locked default) | steps around it |
| `better-auth` | ADR-0092 identity write guard | steps around it |
| `platform` | none — full user CRUD by default | judges it |
| `config` | none — admin-authored, writable by default | judges it |
| `system-data` | none — "admin/user-writable DATA" | judges it |

An **unrecognised** bucket value is deliberately not read as platform-internal: the one
legacy value that can still arrive is `'system'`, retired in protocol 17 (#3355) and
converted to `'system-data'` — a judging bucket — so exempting unknowns would exempt
precisely the rows that conversion targets. The partition is pinned against
`@objectstack/spec`'s own enum, so a seventh bucket fails a test instead of landing
silently on one side.

The ruling's fallback ("leave it, if those buckets' readonly columns already carry
their own 403") does not apply: of the 64 columns above, 14 are the ADR-0086
package-provenance family (`package_id`, `managed_by`, `customized`, `drift_status`,
`drift_detail`, `is_system`, all on `config` objects) and the other 50 are `id` /
`created_at` / `updated_at` stamps, which that guard does not reach.

`@objectstack/lint` mirrors this predicate to decide which objects its create-verb
`flow-update-readonly-field` / `hook-api-update-readonly-field` findings may describe,
and is narrowed in the same stroke — a lint that kept the wider exemption would go on
suppressing findings for a strip that now really happens.

⛔ The UPDATE path is untouched, and so is `beforeInsert`'s post-hook strip position.
The asymmetry is closed by moving CREATE toward UPDATE.
