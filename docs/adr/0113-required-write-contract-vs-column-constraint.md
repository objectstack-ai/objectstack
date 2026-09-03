# ADR-0113: `required` is a write-time contract — the column constraint becomes its own, explicitly-authored axis

**Status**: Accepted (2026-07-30) — Q1/Q2/Q3 adjudicated same day (uniform semantics; `storage.notNull` spelling; the non-regression invariant unifies `required` and `requiredWhen`). **P0 implemented**: spec knob + parse-seam exclusivity, record-validator null-out rejection, rule-validator non-regression, driver DDL + drift rewired, `field-required-notnull-explicit` conversion. P1 (Console required-marker from the write contract) and P2 (criteria_json flip) follow.
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
| the COLUMN is `NOT NULL` | `packages/drivers/driver-sql/src/sql-driver.ts` — `if (field.required) col.notNullable()` |
| required-vs-nullable divergence is DRIFT | `packages/drivers/driver-sql/src/schema-drift.ts` — metadata-required + nullable column ⇒ expected `NOT NULL`, and imposing `NOT NULL` over possibly-null data is the classifier's `destructive` class |

> ⚠️ **Anchor note (#13556).** The three anchors above were line numbers into
> `sql-driver.ts` and had rotted; they are file-level anchors now, per the
> 2026-09-01 ruling on #13556 (line anchors → symbol anchors, resolver-gated).
> ⛔ Re-anchoring did **not** touch what this table says, and the row about the
> `NOT NULL` column is **known to be stale about today's code**: the physical
> constraint now keys off `storage.notNull`, not `field.required` — the inverse
> predicate. That is a separate defect, carded as
> [#14193](https://github.com/objectstack-ai/objectstack/issues/14193), and it is
> deliberately **not** repaired here: this record's Context describes the
> PRE-decision state, and rewriting it inside an anchor migration would edit a
> decision record's substance under cover of a formatting change.

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
column is created `NOT NULL` (packages/drivers/driver-sql/src/sql-driver.ts), the validator enforces
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

### D1 — the non-regression invariant (unifies `required` and `requiredWhen`)

> **A write may not take a record from compliant to violating; a pre-existing
> violation does not block writes that leave it in place.**
> Operationally: *reject iff the merged post-state violates AND the pre-state
> complied.* (On insert the pre-state complies vacuously.)

`required` is the degenerate always-true-condition case: an insert must
provide a non-null value; an update may not null it out; a legacy null row
remains readable and editable so long as the write does not touch the field.
This is exactly the semantics #3929 hand-built for `criteria_json`, promoted
from three guards to one platform word.

`requiredWhen` inherits the same invariant with the condition generalized —
which also catches the case the old merged-record check missed in the OTHER
direction and over-blocked in this one: an update that flips the condition
true without providing the field **creates** the violation and is rejected,
while a row violating since before the rule tightened no longer locks out
unrelated edits (the #3929 objection, cured rather than worked around).

One deliberate over-approximation, chosen to keep the hot write path free of
prior-state reads for the unconditional knob: an explicit `null` written onto
an *already-null* legacy required field is rejected even though the pre-state
already violated. That write was a no-op carrying a false claim; rejecting it
costs nothing and needs no prior fetch. (`requiredWhen` evaluates against the
prior record it already fetches, so it applies the exact rule.)

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
unchanged. The `packages/drivers/driver-sql/src/schema-drift.ts` comparison reads the storage property
instead of `required`.

### D4 — the UI marker follows the write contract

The form renderer derives the required marker from `required` (the write
contract), not from the column. `criteria_json` gets its asterisk back, and
client-side validation aligns with what the server will actually reject —
removing the last reason for the objectui#2962-style mirror hints.

### D5 — back-compat by explicitization, never by inference (Q2 resolved: uniform)

`required: true` has exactly ONE meaning at any point in time — the write
contract — and the transition is carried by rewriting old sources, not by the
loader guessing:

- **The `field-required-notnull-explicit` conversion** (D2 table, protocol-17
  step) stamps `storage: { notNull: true }` onto every `required: true` field
  of a pre-17 source. Under the old semantics that column WAS created
  `NOT NULL`, so the rewrite writes down what the text already meant — a pure
  semantic explicitization, lossless by construction. It is
  **migration-chain-only** (retired from the load path): this is a default
  flip, not a rename, and a loader that auto-applied it would stamp the
  constraint back onto 17-authored sources that deliberately omit it.
- The earlier draft's "loader treats an already-NOT NULL column as
  `storage.notNull`" is **rejected as self-contradictory** — inferring
  semantics from the physical column at load is itself the history-dependent
  behaviour this ADR exists to eliminate.
- New fields: `required: true` alone creates a **nullable** column with the
  write-contract gate — uniformly, on new and old objects alike. The
  history-dependent alternative (new objects still get `NOT NULL`) would make
  correct authoring depend on a fact absent from the author's context — when
  the object was first deployed — which an AI author (ADR-0033) cannot know
  from source. Authors who want the constraint say so; at creation time the
  ceremony is free (no rows, no backfill).
- **Drift direction** (refined during implementation): a column *stricter*
  than its declaration is reported `needs_confirm` (ratify with
  `storage.notNull` or deliberately relax; never auto-applied) — **except**
  when the field is `required: true`, where it is *silent*: that is every
  pre-17 source after a runtime upgrade, the write gate makes the column
  constraint unreachable, and nagging every legacy required field would bury
  real drift. A declaration stricter than the column stays the destructive
  ceremony it always was.

### D6 — `criteria_json` is the first consumer

`sys_sharing_rule.criteria_json` flips to `required: true` (no
`storage.notNull`). The `defineRule` validation and the `beforeInsert` guard
reduce to defense-in-depth or retire; the evaluator's fail-closed stays
regardless (ADR-0049 — enforcement where it can explain itself). The
empty-state registry entry for sharing `condition` gains the declarative
pointer as evidence.

## Rollout (proposed)

- **P0 — DONE** (this ADR's landing PR): the storage property + parse-seam
  exclusivity; record-validator null-out rejection; rule-validator
  non-regression; driver DDL + drift rewired; the explicitization conversion
  + chain step.
- **P1** (objectui): D4 marker + client validation from the write contract.
- **P2**: D6 criteria_json flip + guard consolidation; sweep for other
  "mandatory in substance, optional in metadata" fields (the empty-state
  registry's `closed` entries are the seed list).

Lands inside the unreleased 17.0.0 train (the DDL-emission change and the two
validator tightenings ride the major).

## Resolved questions (adjudicated 2026-07-30)

- **Q1 — spelling: `storage: { notNull: true }`.** The decisive argument is
  orthogonality: the write contract and the column constraint form a genuine
  2×2, and every cell exists in the platform's own system objects — `required`
  alone is the criteria_json posture, `storage.notNull` alone is the
  engine-populated column (audit fields, the tenant column). A single
  `requiredEnforcement` enum cannot express the storage-only cell at all, and
  hands the author a wrong option on every required field. `notNull` is also
  vocabulary a model already knows from the SQL corpus — no invented term to
  hallucinate values for. The namespace earns future entries one *enforced*
  knob at a time (ADR-0078); nothing is pre-reserved.
  **Rider:** `storage.notNull` × `requiredWhen` is rejected at the parse seam
  (`FieldSchema.superRefine`) — when the condition is false the contract
  permits null but the column would refuse it; two gates that cannot both be
  honest are a contradiction the author must resolve.
- **Q2 — uniform semantics** (folded into D5 above). Semantics conditioned on
  deployment history are unreasonable-about by construction for an author —
  human or model — who sees only the source.
- **Q3 — folded in and generalized** (D1 above): rather than `requiredWhen`
  "adopting" `required`'s asymmetry, both are corollaries of the one
  non-regression invariant. The knobs stay one family with one temporal
  semantics; no divergence window ever exists.
