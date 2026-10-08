---
'@objectstack/spec': minor
---

`defineSeed()` refuses a seed record key that names no column of the target object, whatever shape the records arrive in, and its record type now admits the system columns the platform injects (`created_at`, `owner_id` and the rest), which it used to refuse in a record literal.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten or converted, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the define helper's verdict on record keys: a key that names neither a field the object declares nor a system column the platform injects on it is refused when `defineSeed` runs, at module load, which `os validate`, `os build` and boot all reach. The repair is the author's edit of a misspelled key, which no ledger entry can derive. The only export change is an added type, `InjectedSystemColumnName`. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this helper and this diff adds none (not registered / already-registered); and the refusal is a call-time verdict reached at the build doors, not a type surface alone (not type-surface-only). -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings. It is a call-time refusal, not a type-only change: the check runs when `defineSeed` is called, so it is reached by `os validate`, `os build` and boot through the config module's evaluation.

**Why.** The docblock promised that "typos in record field names are caught at compile time", and nothing else checked them. The promise held only for a record written as an object literal directly in `records`. TypeScript's excess-property check is the only thing the record type enforced, and it does not run for records from a variable or a `.map()`, for an object typed `ServiceObject`, or for any inline record in an array that also spreads a `Record<string, unknown>[]`. A seed with a misspelled key passed `tsc` and `objectstack validate`, and the mistake surfaced, if at all, only when the seed loaded. Measured with the published 17.7.0 types on a real app: an `ObjectSchema.create()` object keeps its literal field keys, and the spread is what silenced the check. The same type refused `created_at` in a record literal, a key the seed loader keeps on insert, so the one legitimate way to seed it was the shape that also hid typos.

**What is refused.** `defineSeed(obj, config)` throws when any record carries a key that is neither one of `obj.fields` nor a system column the platform injects on `obj`. The injected set is `resolveInjectedSystemColumns(obj).names`, the same per-object answer the registry's injection reads. It holds the driver's `id` always, plus `organization_id`, the audit columns (`created_at`, `created_by`, `updated_at`, `updated_by`), `owner_id` and `owning_business_unit_id` as the object's `systemFields`, `tenancy`, `ownership` and `managedBy` select them. All unknown keys are reported in one error, one line per key, naming the object, the record index and the key, with a near-miss suggestion:

```text
defineSeed('crm_case'): unknown field(s) in records — created_atx.
  • records[0]: `created_atx` is not a field of `crm_case`. Did you mean 'created_at'?
```

**What is admitted that was not.** The record type adds every injectable system column name (the new exported type `InjectedSystemColumnName`) to the keys a record literal may carry, typed `unknown`. A literal writing `created_at` or `owner_id` now passes `tsc`. The type cannot evaluate an object's opt-outs, so the call narrows it: `created_at` on a `systemFields: false` object, or `owner_id` on an `ownership: 'org'` object, is refused when the call runs. A declared field of the same name keeps its declared value type.

**Remedy.** Correct, declare or remove the key the refusal names. A misspelled key takes the spelling the refusal suggests (the declared field, or the system column such as `created_at`). A key for a field the object does not declare needs that field declared on the object, or the key removed. A system column the object opts out of (`created_at` on `systemFields: false`, `owner_id` on `ownership: 'org'`) does not exist on that object, so the key is removed. The key named no column of the object, so no value it carried could be stored under it, and no working seed depends on it.

**Who is affected, measured.** At `0767335c`, every `defineSeed` call in this repository passes: `examples/app-crm` (5 seeds, 28 records), `examples/app-showcase` (19 seeds, 132 records) and `examples/app-todo` (1 seed, 8 records), evaluated against the built package. A misspelled key in the same context is refused, which is the control. Every seed module in hotcrm at `99d290a` passes too (8 modules, 354 records, including the `created_at` its case seeds author), and its `crm_case` with the misspelled `created_atx` is refused. Other repositories and deployed packages were not measured.
