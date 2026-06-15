# Audit: Validation-rule property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/data/validation.zod.ts` (object-embedded rules; discriminatedUnion on `type`). **Consumers**: framework `objectql/validation/rule-validator.ts` (+ `record-validator.ts`), wired into `engine.ts` insert (`:1973`) + update (`:2107`) write paths.

## LIVE — all 6 validation TYPES are enforced
`script` (`.condition` CEL), `state_machine` (`.field`/`.transitions`, update-only), `format` (`.field`/`.regex`/`.format` email/url/phone/json), `cross_field` (`.condition`), `json_schema` (`.field`/`.schema` via ajv), `conditional` (`.when`/`.then`/`.otherwise`, recursive). Evidence: `rule-validator.ts:332-347,367-566`. No aspirational variant — the spec's "nothing is a silent no-op" claim holds for the type set (with the exceptions below). Un-evaluable predicates **fail-open** (treated as pass) across the board.

Common props LIVE: `name` (diagnostics), `type` (discriminator), `message` (error envelope), `active` (`!== false`), `priority` (sort low-first), `severity` (only `error` blocks; `warning`/`info` logged, never throw).

## 🔴 `events: ['delete']` is a silent no-op
Spec enum admits `delete` (`:88`) but the runtime `Mode` is `'insert' | 'update'` (`rule-validator.ts:72`) and `engine.ts` never invokes validation with `delete`. A rule scoped only to `delete` **never fires**. The header even notes delete isn't a write-payload context → drop the enum value.

## DEAD
`label`, `description`, `tags` — governance/reporting metadata, never read by either validator.

## PARTIAL / redundancy
- `cross_field.fields` — does **not** scope evaluation; `cross_field` shares the exact `checkPredicate` path with `script`. Only `fields[0]` is used as the error's field label; `fields[1..n]` decorative. `cross_field` is functionally `script` + a cosmetic field hint.
- **Two redundant paths to the same guarantee**: a `script` rule `amount < 0` overlaps field-level `min`; a `conditional`→required rule overlaps field-level `requiredWhen`. Both LIVE, enforced in different places (`rule-validator` vs `record-validator`).

## Recommendation
Remove `delete` from the events enum (dead). Drop `label`/`description`/`tags` or document as governance-only. Consider merging `cross_field` into `script` (it adds only a label). Document the rule-vs-field-prop overlap so authors pick one path.
