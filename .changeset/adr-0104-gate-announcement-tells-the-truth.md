---
"@objectstack/objectql": patch
---

fix(objectql): the boot gate announcement stops firing where it is false, and stops counting fields nothing enforces (#3438)

The startup line that names an open value-shape gate (#4253) fired on every
deployment there is, and said something untrue on any deployment that had
already settled the question with an environment switch. Both are the same
failure — an advisory that speaks where it does not apply is how readers learn
to ignore it — and neither is reachable from the suite that shipped with it,
because `engine.test.ts` mocks the registry away and a mocked registry hands
the engine exactly the fields the test wrote.

`objectHasCoveredValueField` — the dormancy short-circuit that is supposed to
spare an object with no covered field the flag query — tested raw type
membership, while the real registry INJECTS covered-type fields into every
object it registers: `organization_id` and `owner_id` (both `system`),
`created_by` and `updated_by` (both in `SKIP_FIELDS`), four `lookup`s.
`validateRecord` skips every one of them before it reaches the value-shape
check, so the short-circuit answered `true` for literally every object, never
fired, and its WeakMap memoized a constant. Counting is now by the validator's
own `isScannableValueShapeField`, the predicate the scanner already imports —
three readings of "a covered field" drifting by one clause is how a gate ends
up governing fields nothing enforces.

The announcement also consulted no environment switch, while both postures it
reports on short-circuit ahead of the deployment flag. Under
`OS_DATA_VALUE_SHAPE_STRICT_ENABLED` enforcement is already on for both
classes, so "checked but NOT enforced here" was simply false; under either
opt-out the operator chose leniency deliberately, so naming a migration that
cannot change what they get is noise. Each gate now consults its own pair
(`mediaPostureSetByEnv` / `valueShapePostureSetByEnv`, siblings for the reason
`mediaStrictEffective` and `valueShapeStrictEffective` are siblings), since the
opt-outs are per-class while the opt-in opens both. Cheapest test first, so a
kernel with nothing to say still reaches no flag query.

Enforcement is unchanged: same gates, same flags, same default. The flag read
was already memoized per process, so what this corrects is the property
ADR-0104 states, not a user-visible cost.
