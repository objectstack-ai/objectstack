---
'@objectstack/objectql': minor
'@objectstack/lint': patch
'@objectstack/spec': patch
---

A select option whose `visibleWhen` cannot be evaluated refuses the write instead of admitting the value with one warn line (#22402)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing at the server's per-option gate: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What narrows is the set of writes the gate admits: a picked option whose predicate faults is refused instead of admitted. The refusal reuses the existing field-rule envelope, so no error code and no TypeScript export changes. The package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered). -->

**BREAKING** accept-set narrowing on `@objectstack/objectql`, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D9).

A select, multiselect, radio or checkboxes option may gate itself with a `visibleWhen` predicate, and the server re-checks it for every value a write picks. ADR-0137 D2 says a field-rule predicate that cannot be evaluated refuses the submit. The option gate is the server's enforcement of who may pick the option (ADR-0124 D1), so D2 now reaches it on the write path too.

- **Before.** When an option's predicate faulted on a write (an undeclared key, a root or member the gate does not bind, a read through a reference, a computed key or receiver, `current_user.can()` with no permission data), the server logged "the option's gate was NOT enforced on this write" and admitted the value. A role-gated option whose rule was broken was open to every caller.
- **Now.** The write is refused with `VALIDATION_FAILED` (HTTP 400) and one field entry in the envelope a faulting `requiredWhen` or `readonlyWhen` already uses: `code: 'rule_violation'`, `constraint.reason: 'unevaluable'`, `constraint.rule: 'visibleWhen'`, `constraint.fault` naming the fault, and the picked option as `value`. The message names the option, the field and the fault, for example `Option 'gold' of field 'tier' visibleWhen could not be evaluated (runtime: No such key: statsu) — write rejected.` Nothing is written. This holds on insert (one row or a batch), by-id update and bulk update, and so on an import, which writes through them; `validate()` previews the same refusal.
- **Unchanged.** A predicate that evaluates is judged exactly as before: false refuses with `invalid_option`, true admits. A system write with no acting user whose predicate reads the acting user (`'admin' in current_user.positions` on a seed) is still admitted and logged with reason `no-acting-user`, because the gate has nobody to ask about. A system write whose predicate faults for any other reason is refused, as a faulting `requiredWhen` is. The form still offers an option whose predicate faults (ADR-0137 D3); the refusal comes at save.
- **`current_user.can()` with no permission data.** On an engine with no effective-permission resolver registered (no security plugin composed), a write by an acting user that picks a `can`-gated option is now refused, naming the missing permission data, instead of admitted.
- **A preview limit this inherits.** An `update`-mode `validate()` preview (an import dry run of a matched row) reads no stored row, so a cascade predicate whose parent column the patch omits faults there and the preview now refuses the row, as it already refuses a `requiredWhen` that reads an omitted column. The write itself reads the stored row and judges the predicate cleanly.

**The remedy: fix the predicate, which `os build` names for every statically judgeable shape.** The shapes no build can judge (a computed key, a computed receiver, a row stored before the build verdicts, or a save under `OS_ALLOW_UNLINTED_METADATA_WRITES=1`) now meet this refusal at the first write that picks the option, naming the fault.

Measured before the change, on `origin/main` 3054516ef1: the objects this repository ships carry 5 option predicates, all on the showcase's `showcase_cascade` (four `record.country == …` cascades and one `'org_admin' in current_user.positions` role gate), and none of them faults on a write. Insert and update evaluate them over a total record, so a payload without `country` reads `null == 'cn'`, a clean false. No seed or dogfood write picks a gated option.

Earlier entries in this release that say an option predicate which faults is still logged and admitted describe the gate before this change.

`@objectstack/lint` and `@objectstack/spec`: the published text that said the server admits a faulting option predicate now says it refuses the write. This covers the `objectstack validate` finding for an option predicate that reads through a reference, a root or member the gate does not bind, and the `SelectOption.visibleWhen` description. No verdict moves.
