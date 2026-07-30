# ADR-0113: `required` is a write-time contract — the column constraint becomes its own, explicitly-authored axis

**Status**: Proposed (2026-07-30) — **awaiting adjudication**. Drafted from the #3896 close-out; no code in this ADR has been implemented.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert metadata), the #3896/#3929 sharing-criteria case study, `driver-sql/schema-drift.ts` (the drift classifier whose `destructive` class this ADR exists to route around)
**Consumers**: `@objectstack/spec` (`FieldSchema`), `@objectstack/objectql` (`validation/record-validator.ts`), `@objectstack/driver-sql` (`sql-driver.ts` column DDL, `schema-drift.ts`), `@objectstack/lint`, objectui form renderers (the required marker)
**Surfaced by**: [#3896](https://github.com/objectstack-ai/objectstack/issues/3896) — `sys_sharing_rule.criteria_json` is mandatory in substance but `required: false` in metadata, enforced by three hand-written imperative guards, and its Setup form shows no required marker. The pattern, not the instance, is the subject here.

---

## TL;DR

`field.required: true` means three different things through one knob, at three
verified sites:

| Meaning | Where it lives today |
|---|---|
| a write must provide the value | `objectql/validation/record-validator.ts` |
| the COLUMN is `NOT NULL` | `driver-sql/sql-driver.ts:4901` — `if (field.required) col.notNullable()` |
| required-vs-nullable divergence is DRIFT | `driver-sql/schema-drift.ts:249-277` — metadata-required + nullable column ⇒ expected `NOT NULL`, and imposing `NOT NULL` over possibly-null data is the classifier's `destructive` class |

Because all three ride one flag, **tightening any invariant on a deployed
object is a destructive migration, blocked by the very legacy nulls that
motivated the tightening**. The observed consequence (#3929): the platform's
own `criteria_json` — whose emptiness was a P0 over-share — could not be
declared required. The invariant had to be built as three imperative guards
(`defineRule` validation, a `sys_sharing_rule` `beforeInsert` hook, evaluator
fail-closed), and the Setup form renders Name, Object and Recipient with
required markers while the one field whose absence was a security bug shows
none. Every post-GA tightening hits the same wall; the predictable outcome is
that invariants which should be one declarative line become N guards — or
don't happen.

**Decision (proposed)**: split the axes. `required` keeps the write-time and
UI meanings; the physical constraint becomes an explicit, separately-authored
storage property that carries its own destructive-migration ceremony. A
declared-required field over a legacy-nullable column stops being "drift" and
becomes a recognized posture: *new writes must provide; old rows may rest.*

---

## Context

### The tri-binding, concretely

Authoring `required: true` on a field of a **new** object is unremarkable: the
column is created `NOT NULL` (sql-driver.ts:4901), the validator enforces
presence, the form shows the marker, drift never fires. The knob works —
until the object has deployed data.

On a **deployed** object with legacy null rows, flipping `required` to `true`
produces, in order:

1. `schema-drift.ts` reports the nullable column as drift with expected
   `NOT NULL` (line 265-277) and classifies applying it as `destructive` —
   correctly, because a `NOT NULL` constraint over possibly-null data fails or
   corrupts.
2. The operator now needs a backfill — but for a field like `criteria_json`
   **no correct backfill value exists** (what predicate should a formerly
   match-all rule get? any answer either preserves the over-share or invents
   intent). #3929 adjudicated this: the nulls must stay, as inert rows whose
   grants the evaluator revokes.
3. So `required` stays `false`, and the invariant migrates into imperative
   guards — per entry point, hand-maintained, invisible to the UI layer, and
   invisible to any tool that reads the metadata as the contract (which, per
   ADR-0033, is very often a model).

### Why this is a platform problem and not a sharing problem

The #3896 line produced two of these in one week: `criteria_json` (three
guards) and the empty-state registry's whole `closed` category — entries that
exist precisely because the invariant they record cannot be expressed in the
metadata. A platform whose premise is "typed metadata an AI can hold in
context and reason about" pays double here: the enforcement is real but the
declaration says `required: false`, so the metadata **understates the
contract**, which is the same claim-vs-reality divergence the liveness ledger
polices in the other direction.

## Decision — proposed rulings

### D1 — `required` means the write contract

`required: true` asserts: **an insert must provide a non-null value, and an
update may not null it out.** Existing rows are untouched — a legacy null row
remains readable and editable so long as the write does not touch the required
field. This is exactly the semantics #3929 hand-built for `criteria_json`,
promoted from three guards to the platform's one word.

### D2 — the column constraint becomes explicit

A new field-level storage property owns the DDL:

```ts
budget: Field.currency({
  required: true,                    // write contract + UI marker
  storage: { notNull: true },        // column constraint — separate, explicit
})
```

`storage.notNull` (exact spelling open, see Q1) is what emits
`col.notNullable()` and what schema-drift compares against the physical
column. Declaring it on a column with existing nulls remains a destructive
migration and SHOULD fail loudly until a backfill is provided — that ceremony
is correct; the defect was only that the write contract couldn't be declared
without buying into it.

### D3 — drift semantics change

`required: true` + nullable column stops being drift (it is the D1 posture).
`storage.notNull: true` + nullable column IS drift, destructive class,
unchanged. The `schema-drift.ts:249` comparison reads the storage property
instead of `required`.

### D4 — the UI marker follows the write contract

The form renderer derives the required marker from `required` (the write
contract), not from the column. `criteria_json` gets its asterisk back, and
client-side validation aligns with what the server will actually reject —
removing the last reason for the objectui#2962-style mirror hints.

### D5 — back-compat is the deliberate asymmetry

For existing metadata, `required: true` today implies both meanings, so the
migration must not silently drop the column constraint fields already have:

- Fields whose column is **already `NOT NULL`** (created as required): loader
  treats them as `required + storage.notNull` — nothing changes, no DDL, no
  drift.
- Fields declared required whose column is nullable: today that is
  un-declarable without destructive drift; under this ADR it becomes the D1
  posture. This set is currently EMPTY by construction (nobody could declare
  it), so no deployed tenant changes behaviour.
- New fields: `required: true` alone creates a **nullable** column with a
  write-contract gate. Authors who want the constraint say so (Q2 disputes
  this default).

### D6 — `criteria_json` is the first consumer

`sys_sharing_rule.criteria_json` flips to `required: true` (no
`storage.notNull`). The `defineRule` validation and the `beforeInsert` guard
reduce to defense-in-depth or retire; the evaluator's fail-closed stays
regardless (ADR-0049 — enforcement where it can explain itself). The
empty-state registry entry for sharing `condition` gains the declarative
pointer as evidence.

## Rollout (proposed)

- **P0** (`@objectstack/spec` + `objectql`): the storage property + D1
  validator semantics + D3 drift change. Additive; no tenant behaviour change.
- **P1** (objectui): D4 marker + client validation from the write contract.
- **P2**: D6 criteria_json flip + guard consolidation; sweep for other
  "mandatory in substance, optional in metadata" fields (the empty-state
  registry's `closed` entries are the seed list).

Not v17-blocking: additive surface, no breaking change. Target: early 17.x.

## Open questions for adjudication

- **Q1 — spelling.** `storage: { notNull: true }` (proposed: room for future
  storage knobs — collation, computed defaults) vs a flat
  `requiredEnforcement: 'write' | 'column'` (one knob, no nesting, but closes
  the namespace).
- **Q2 — the new-field default.** This draft says `required: true` alone
  creates a nullable column (uniform semantics; the constraint is opt-in).
  The alternative — new objects still get `NOT NULL`, deployed objects don't —
  keeps today's clean-database behaviour but makes the same declaration mean
  different DDL depending on when it was authored, which is the kind of
  history-dependent semantics ADR-0087 exists to eliminate.
- **Q3 — `requiredWhen` interplay.** The conditional variant evaluates
  server-side against the merged record on update (#3929 rejected it for
  criteria_json because it blocks legacy-row edits). Should `requiredWhen`
  adopt D1's insert-vs-update asymmetry too? Out of scope here unless the
  deciders want it folded in.
