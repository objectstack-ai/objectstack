---
"@objectstack/lint": minor
"@objectstack/spec": minor
---

feat(lint)!: `relationship/master-detail-required` refuses the three unsafe master-reference shapes at `error` on a `controlled_by_parent` object (#9139)

Clause-②: no (narrowing)

A `controlled_by_parent` detail derives all of its record access from the master its `master_detail` reference names (ADR-0055). Three declarable shapes of that reference leave the security gate as the only thing refusing a detail record saved without its master, because record validation never checks a field that is not `required` and skips `readonly` and `system` fields before its required check:

1. `required` absent, or `required: false`;
2. `required: true` with `readonly: true`;
3. `required: true` with `system: true`.

A record that lands without its master anyway is readable by nobody, and every later write to it by id is refused. Until now `relationship/master-detail-required` was a `warning` with the predicate "`required` is not `true`", on every object, so shapes 2 and 3 drew no finding at any severity. The maintainer ruling of 2026-08-16 (Direction 1) scheduled the promotion for the v18 boundary, scoped to `controlled_by_parent`.

**BREAKING — what moves for consumers.**

- `os lint` reports each of the three shapes at `error` when the object declares `sharingModel: 'controlled_by_parent'`, located at the defect (`…fields.FIELD.required`, `.readonly` or `.system`). It covers every `master_detail` field of such an object, the same scope the builder's `required: true` force already applies. `os lint` therefore exits non-zero on such a stack, and the metadata-generation rubric (`scoreMetadata`) weighs the finding as an error and marks the stack `valid: false`.
- `@objectstack/spec` gains the step-18 semantic migration entry `cbp-master-detail-required-lint-error`, so `os migrate meta` across protocol 18 prints the prescription below.

**Remedy — the v18 upgrade-checklist line.** On every object with `sharingModel: 'controlled_by_parent'`, give each `master_detail` reference `required: true` and remove any `readonly: true` or `system: true` from it. `os lint` now refuses the missing-`required`, `required` + `readonly` and `required` + `system` shapes there at `error` (`relationship/master-detail-required`). An object authored through `ObjectSchema.create` already gets `required: true` when the key is omitted, so the edit there is dropping the flag.

**Unchanged.**

- On every object that is not `controlled_by_parent` the rule is exactly as before: a `warning` for a `master_detail` without `required: true`, the same message and fix, and no finding for the two flagged shapes.
- The rule is not in the authoring-rule registry. `os build`, `os validate` and the metadata save door do not run it, so a stack carrying one of the shapes still builds and publishes. Only `os lint`'s exit code and the generation rubric move.
- Runtime is untouched. The security gate keeps refusing an insert that omits the master FK on these shapes and keeps resolving the master for metadata already at rest, and stored metadata is neither rewritten nor refused on load.
- No export or signature moves in either package.
- Measured before crossing, at `b04a5295f`: 129 authored objects across the example apps, the platform, plugin and service objects and the CLI's golden eval corpus. 7 of them are `controlled_by_parent`, and 0 draw the new `error`.

<!-- adr-0087: registered cbp-master-detail-required-lint-error -->
