---
'@objectstack/objectql': minor
'@objectstack/lint': patch
---

fix(objectql)!: a field-level `requiredWhen` / `readonlyWhen` predicate that cannot be evaluated now REFUSES the write, naming the field and the rule, instead of letting it through (ADR-0137 D2)

Clause-②: no (narrowing)

**BREAKING**: shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA). The banner and the ADR-0087
disposition below carry the breaking change, not the level.

**Writes that used to save now fail.** ADR-0137 D2 says: "At submit time, a
field-rule predicate that cannot be evaluated refuses the write and names the
field and the rule. Nothing is persisted." The server now enforces that on the
two arms that let such a write through:

- **`requiredWhen`**: a predicate that faults used to be logged
  (`requiredWhen for '<field>' failed to evaluate — skipped`), and the record
  saved with the field empty. It now refuses the insert or update. This covers
  every fault, including a `parent`-scoped rule whose master-detail header
  could not be resolved for the write.
- **`readonlyWhen`**: a predicate that faults used to be logged
  (`failed to evaluate — change allowed through`), and the field the author
  declared frozen was written. It now refuses the update. On a bulk update, a
  fault in any matched row refuses the whole write, and the refusal names that
  row. One case is unchanged: a predicate that faults because the header it
  reads as `parent` could not be resolved still holds the lock, as before.

The refusal is the same `ValidationError` a broken validation rule has thrown
since #4649: `VALIDATION_FAILED`, served as `400`. Its entry for the field
carries `code: 'rule_violation'` and
`constraint: { rule: 'requiredWhen' | 'readonlyWhen', reason: 'unevaluable', fault }`,
with `missingKey` or `hint: 'null-comparison'` when the fault is one of those.
The message names the field and the rule. It is refused before anything is
written, on insert, single-id update and bulk update alike. The operator also
gets a `warn` line saying the write was rejected.

The refusal applies to the whole submit. A `requiredWhen` whose predicate
faults refuses the write even when the write supplies the field, because the
rule has no verdict to judge that value against.

**What starts refusing.** A stored predicate that faults on the writes it
judges:

- a key the object does not declare, usually a typo (`record.statsu`);
- an ordering comparison or arithmetic over a `null` (`record.amount > 100`
  where `amount` is empty). Guard it with `!= null`. `has(x)` is true for a
  declared field holding null, so it does not guard this;
- a column read through a lookup (`record.account.tier`). The field level never
  reads the related record, so the reference holds a bare id there. The refusal
  says so, and names the reference and its target object;
- an envelope with no evaluable `source`: blank, or `ast`-only.

Nothing in this repository's own metadata is affected. A census of every
`requiredWhen` / `readonlyWhen` under `packages/`, `examples/` and `apps/`
found none that faults on a write it judges. How many stored predicates in a
deployment fault is unknown, and ADR-0137 names that as the point: the loud
state is what finds them.

**Fix.** Read the refusal. It names the field, the rule, and the key or
overload that faulted. Then correct the predicate: fix the key's spelling,
guard the null operand with `!= null`, or move a check that reads through a
lookup into a `validations[]` `script` rule, whose condition does read one hop
through a reference.

Unchanged: a predicate that evaluates is judged exactly as before, in both
directions. So is the ADR-0113 legacy-row rule for an evaluated `requiredWhen`.
Option-level `visibleWhen` is not a field-rule predicate, so D2 does not reach
it, and it stays fail-open. The render side is not touched here (ADR-0137 D3
keeps its directions for display).

`@objectstack/lint`: the build-time messages for a field `requiredWhen` no
longer say the server "skips" a faulting predicate. The unbound-root message,
the `parent`-without-a-master message and the null-guard message now say the
server refuses the write.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: `packages/spec` is untouched, `requiredWhen` and `readonlyWhen` keep their schema, and no stored shape is refused, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. What changes is the runtime's answer to a predicate that cannot run, and the repair is specific to each broken predicate. There is no mechanical FROM to TO rewrite. The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id covers a runtime fault direction (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
