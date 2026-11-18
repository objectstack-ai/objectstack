# ADR-0113: `required` is a write-time contract — the column constraint becomes its own, explicitly-authored axis

**Status**: Accepted (2026-07-30) — Q1/Q2/Q3 adjudicated same day (uniform semantics; `storage.notNull` spelling; the non-regression invariant unifies `required` and `requiredWhen`). **P0 implemented**: spec knob + parse-seam exclusivity, record-validator null-out rejection, rule-validator non-regression, driver DDL + drift rewired, `field-required-notnull-explicit` conversion. P1 (Console required-marker from the write contract) and P2 (criteria_json flip) follow.
**Amended (2026-11-17)** — D1 and D5: a field that declares `required: true` together with its own `visibleWhen` is required **when shown** (maintainer ruling A on #34905, recorded in comment 6956761249). See [Amendment — required when shown](#amendment-2026-11-17--required-when-shown).
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
| the COLUMN is `NOT NULL` | **At decision time (2026-07-30):** `packages/drivers/driver-sql/src/sql-driver.ts#createColumn` — `if (field.required) col.notNullable()`. **Superseded by this ADR's P0** (2026-09 note, #14193): the physical constraint now keys off the explicitly-authored `storage.notNull` at that same `#createColumn` site; `field.required` no longer drives the DDL. |
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
>
> **Resolved (2026-09, #14193).** The two Context sites — the table row above and
> the prose sentence under *The tri-binding, concretely* — are now annotated in
> place as the state **at decision time**, each naming the `storage.notNull` site
> that superseded it, and both citations are re-anchored by symbol
> (`packages/drivers/driver-sql/src/sql-driver.ts#createColumn`) rather than by line. ⛔ No decision text changed:
> the Context still describes the pre-P0 tri-binding, which is what motivated the
> decision — it is now dated, so it cannot be read as a description of today.

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
column is created `NOT NULL` (`packages/drivers/driver-sql/src/sql-driver.ts#createColumn` — *at
decision time; superseded by this ADR's P0, where that same site keys the constraint off the
explicit `storage.notNull` instead*), the validator enforces
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

> **Amended (2026-11-17).** "`required` is the degenerate always-true-condition
> case" now holds for a `required` field with no `visibleWhen`. A field that
> declares both takes its own `visibleWhen` as the condition, exactly as
> `requiredWhen` takes its predicate — see
> [Amendment — required when shown](#amendment-2026-11-17--required-when-shown).
> The over-approximation above stays for the unconditional knob.

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

> **Amended (2026-11-17).** It is still one meaning, read off the source alone:
> the write contract, conditioned on the field's own `visibleWhen` when the
> source declares one. Both keys sit in the same field definition, so nothing
> here depends on history or the physical column, which is what this decision
> rules out. See [Amendment — required when shown](#amendment-2026-11-17--required-when-shown).

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
  The silence is for a field with no `storage` declaration: a `required: true`
  field that writes `storage: { notNull: false }` out has its stricter column
  reported (`relax_not_null`, still `needs_confirm`, never auto-applied), and
  the publish of that declaration applies the relax, being the deliberate relax
  named above.

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

## Amendment (2026-11-17) — required when shown

**Ruling.** Maintainer ruling A on #34905 (2026-11-17 18:10Z, recorded in issue
comment 6956761249): 「A 显示时必填+切换校验」 — hidden means not required, and a
write that shows the field without filling it is refused.

**Why.** A field that is `required` and hidden by its `visibleWhen` was enforced
on every save. In Studio an administrator adds such a field to an object in a
few clicks, and from then on every record outside the condition refuses every
write, including an edit of an unrelated field, naming a field nobody can see or
fill. The form already drops the marker and the client check for a hidden field
(D4), and it writes `null` into a field its `visibleWhen` hides (clear-on-hide),
which the server then refused. The server is the side that decides (ADR-0124
D1), so it now judges the requirement from the field's own visibility, as the
form does, on the record being written. For a `formula` the predicate reads the
two sides can differ; see the formula paragraph below.

**The rule.** For a field with `required: true` and its own `visibleWhen`
(`evaluateRequiredWhenShown`, `packages/objectql/src/validation/rule-validator.ts`):

1. **Hidden** — the predicate evaluates cleanly to anything but TRUE on the
   merged record (stored row with the write over it): FALSE, or a `null` such as
   an unset boolean under `visibleWhen: record.is_vip`. The requirement does not
   apply to this write. This is the form's reading: it shows a field only for a
   clean TRUE, and `requiredWhen` holds its condition only on TRUE. *Widening.*
2. **Shown** — cleanly TRUE: D1's non-regression invariant with the predicate as
   the condition, judged against the prior record the engine now reads for such
   a field. A write that reveals the field empty is refused; a row already shown
   and empty rests under unrelated edits, and an explicit `null` onto it is
   accepted (the exact rule, as `requiredWhen` has). *Narrowing:* a write that
   moves a record into the condition without filling the field was accepted
   before this amendment and is refused now — on a flow, a bulk update (one such
   row refuses the batch), an import or an API PATCH alike.
3. **Fault** — the predicate cannot be evaluated (including a `formula` it reads
   whose read value the write path cannot know, see below): it **counts as shown**, and the
   field takes exactly the unconditional rule above (an insert must provide it,
   an update may not clear it). The write is not refused for the fault itself:
   this is not ADR-0137 D2's field-rule arm, because the fault costs only the
   waiver, and the fallback is the behaviour every app had before. The fault is
   logged at `warn`, naming the field and the fault (ADR-0137 D4).

**Scope of the predicate.** `record`, `previous`, the acting user as
`current_user` (and its ADR-0068 aliases, with the permission map the option
gate reads) and `parent` where the write resolves a header. Binding the user
makes the requirement depend on who writes, which is what "required when shown"
means for a role-gated field; a system write with no acting user takes the fault
arm, logged as `no-acting-user`, whether the predicate reads the user directly or
through a `formula` that reads it (below). The lint refuses `current_user` in a field `visibleWhen` at authoring (see
the fence below), so that binding serves older stored metadata. `features`,
`app` and `page` are never bound on the server.

**A `formula` field the predicate reads.** A formula is computed on read and is
never on the write path, so the stored row and the payload do not hold it. The
engine computes the object's formulas over the merged record and over the prior
record with the read path's own plan before it evaluates the predicate, so the
predicate sees the value a read of that record would serve
(`formulaValuesFor`, `packages/objectql/src/engine-top-level.ts`). A formula
that does not compute is answered by the reason, in two arms:

- *A fault a read shares* — an operator over an empty operand (`record.amount >
  100` with `amount` unset), an undeclared key, a cycle of formulas. A read
  serves `null` for it, so the predicate is judged on that `null`, which is what
  the form judges: usually hidden. Not a fault of the predicate.
- *A value only a read can have* — the formula reads through a reference (the
  write path follows no hop), calls `label()` (no option labels are read on a
  write), calls `current_user.can()` and the write resolved no permission
  map (it resolves one only when it picks a permission-gated option, so such a
  formula is computed on that write and not on another), or reads the acting
  user (`current_user` and its ADR-0068 aliases) on a write that has none, a
  system write, where a read would compute it for its reader; or it reads such
  a formula, at any depth of the formulas it reads. A
  formula over one can compute cleanly over the `null` it reads on the write
  path and still not be the value a read serves, so the whole read closure
  counts. The predicate is a fault, which counts as shown: the field keeps the
  unconditional `required`, and the log names the chain (`reason:
  'no-acting-user'` when the missing user alone blocks it). The lint warns
  about the first three marks (below); it does not warn about the acting-user
  mark, since a formula reading the user is computed per writer on every write
  that has one.

**Known limit: the form does not recompute a formula.** The form judges the
predicate on the formula value it last read, over its live values
(`ruleRecord` in `form.tsx`); a create form has none, and an edit of the
formula's inputs does not move it. The server judges the record being
written. So on a create the form keeps a formula-driven field hidden while the
server may require it (main refused that create too), and an edit that moves
the computed value into the condition is refused naming a field the form still
hides; main accepted that edit. The server's answer is the one ruling item 2
asks for; the form-side recompute is a follow-up card, and until it lands the
lint warns on every `required` field whose `visibleWhen` reads a formula.

**Author-time fence (narrowed from the ruling's item 4).** The ruling asked for a
warning on `required` + `visibleWhen` reading roots the server cannot bind. That
half already exists at a stronger level: `@objectstack/lint` refuses every root
but `record`, `previous` and `parent` in any field `visibleWhen`
(`FIELD_RULE_BOUND_ROOTS`), at `objectstack validate`, at the object save door
and in Studio's predicate editor, so those roots reach the server only from
older stored metadata, which the fault arm covers. What is added are three
**warnings**, never refusals, since the field keeps the requirement it had:
a `required` field's `visibleWhen` that reads through a reference field (never
hydrated at the field level, so it always faults); one that reads a `formula`
field (the known limit above, and, when a formula in its read closure reads
through a reference or calls `label()` or `can`, the counts-as-shown
consequence; `required-visible-when-formula-issue.ts`, with the same verdict as
a Studio advisory in the field inspector); and `required` + `visibleWhen`
+ `storage.notNull` (the column refuses the null the waiver admits). The latter
is not a parse refusal like the Q1 rider, because the protocol-17
`field-required-notnull-explicit` conversion stamped `storage.notNull` onto every
older `required` field; for those fields this amendment changes nothing on create.

**Not in scope.** Only the object field's own `visibleWhen`. A field group's
`visibleWhen`, a form view's field or section predicate, a hidden tab and static
`hidden` are not read: the validator does not consume view metadata (ruled on
#13252; Studio's gated-section fence covers the section case at authoring).

**Which server answer is canonical.** Three server sites answer "required, but
hidden". For the **record write contract** this rule is canonical; it is the
only one that judges an object field. The other two judge their own surface's
declarations before the engine sees the write, and keep their directions:
a flow screen's `required` field (`screen-input-contract.ts`) treats an
unevaluable predicate as not asked, because a screen field is input to a flow,
not a record column; the public form route (`form-routes.ts`) does not add a
form-view entry that has a `visibleWhen` to its own required list. A record
either of them writes is then judged by this rule.

**Other readers left as they are.** The import template, the action parameter
schema and the MCP field descriptions still describe such a field as required.
The seed loader's early required warning (`requiredOnInsertByObject`) is now an
approximation for such a field: it warns where the write may waive. ADR-0124 D4
allows a client hint stricter than the server, so they are listed here rather
than changed.

**Where the refusal comes from.** The record walk no longer judges such a field;
the rule pass does, after the hooks, the strips and (on a non-system write) the
reference check. A write with one fault gets the same `required` code and
sentence. A write with several faults may name fewer of them in one `400`, or
answer a dangling reference first, and a `beforeUpdate` hook runs before the
refusal and may fill the field.
