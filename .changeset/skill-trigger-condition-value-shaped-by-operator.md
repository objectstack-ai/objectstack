---
"@objectstack/spec": minor
---

feat(spec): a skill trigger condition's `value` must have the shape its OPERATOR reads (#7113)

`SkillTriggerConditionSchema.operator` and `.value` were declared independently
— `z.enum(['eq','neq','in','not_in','contains'])` beside
`z.union([z.string(), z.array(z.string())])` — so every operator accepted every
shape. `{ field: 'userRole', operator: 'in', value: 'admin' }` was a spec-valid
skill trigger: a membership test whose list is not a list.

This is the **dormant twin** of #6227 on `ViewFilterRuleSchema`, and the fix
mirrors that one (PR #7114) key for key — the exported operator vocabularies,
the `superRefine`, the single issue at path `['value']`.

**Why "dormant" is the whole point.** #6227's shape genuinely failed at query
time (`assertListComparandShapes`, 400 `INVALID_FILTER`), which made it a
two-stage failure. This one never failed at all: the sole consumer,
`SkillRegistry.evaluateCondition` in the cloud agent runtime, coerces the scalar
itself with `Array.isArray(expected) ? expected : [expected]`. Nothing 400s and
the predicate evaluates the way the author meant. What is being closed is
therefore not a break but a **second dialect** — a consumer-side lenient
coercion standing in for a contract the producer never declared, on a surface
whose authors are increasingly AI-generated, where "declared = enforced" is what
keeps generated metadata honest. That coercion becomes a no-op once this ships;
removing it is a follow-up in the cloud repo, producer-first.

**The constraint, and its deliberate limit:**

| operator | `value` must be | why |
|---|---|---|
| `in` / `not_in` (`SKILL_TRIGGER_LIST_VALUE_OPERATORS`) | an array, any length | the consumer answers them with `list.includes(fieldValue)` — the authored value IS the list |
| `eq` / `neq` (`SKILL_TRIGGER_SCALAR_VALUE_OPERATORS`) | a string | `===` / `!==` on an array is reference identity, so an array comparand is a DEAD predicate: `eq` never fires, `neq` always does |
| `contains` | **unchanged — either shape** | it has two live branches: string∈string substring, and array⊆array subset (`expected.every(v => fieldValue.includes(v))`) |

`contains` is left alone on purpose. #5685 ruled on the opposite error — a
schema stricter than its runtime in ways the runtime deliberately allows — and
`SkillContext` is indexed `[extraField: string]: unknown`, so an array-valued
context field is a shape the consumer is written for. Refusing it here would
un-declare a working capability, which is an ADR-0049 retirement decision and
not a rider on a shape fix.

Both vocabularies are **exported** so a producer — a condition editor, a
generator, a test — asks the question the schema asks instead of keeping its own
copy of the list, the same reason `VIEW_FILTER_LIST_VALUE_OPERATORS` is exported
one module over.

**Authoring impact: measured, not assumed.** Censused before landing across this
repo (`packages/`, `examples/`, `content/`, `docs/`) and the cloud repo
(`packages/service-ai` skill definitions, seeds, fixtures, docs corpora): no
real (non-test) skill authors `triggerConditions` in the scalar-on-set-operator
form. The framework's six built-in skills declare no `triggerConditions` at all,
and both authored examples already use the array form on `in`. The one in-repo
test that handed a scalar to all five operators was asserting the decoupling
itself and is updated to enumerate the shape each operator reads.
