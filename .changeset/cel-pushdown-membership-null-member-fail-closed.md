---
"@objectstack/formula": patch
---

fix(formula): fail closed on a null MEMBER of a resolved membership array in the CEL pushdown (#13496)

`compileCelToFilter` already fails closed when a `current_user.*` variable
resolves to `undefined`/`null` — the module's docblock calls it "the no active
org fail-closed path" and it is pinned for the SCALAR case. `lowerMembership`
did not apply the same discipline one level in: it checked only
`Array.isArray(value)` and emitted the list verbatim, so a null MEMBER of a
resolved membership array went straight into a security `$in`. The one shape
that IS a permission predicate was the one shape that did not fail closed.

`lowerMembership` now refuses a `null`/`undefined` member of a **variable-resolved**
membership array with the same `unresolved-variable` reason the scalar path
uses, which the RLS path already turns into the deny sentinel.

Maintainer ruling, 2026-08-31 (quoted unchanged): 「membership 数组中的 null
**成员**触发与 null 标量同款处置——`unresolved-variable` / deny sentinel,⛔ 不
strip、不静默清洗。」

**Why refuse rather than strip.** Stripping the unresolved member is safe in
POSITIVE polarity only. `not in` is a supported, pinned member of the pushdown
subset (`!(x in y)` lowers to `$not` wrapping `$in`), and `$in: []` matches
nothing on every backend — so `$not { $in: [] }` matches the WHOLE table.
Stripping therefore inverts into fail-OPEN exactly where the predicate is a
blocklist, and it silently deletes a blocklist entry in the mixed
`['u1', null]` case. Refusing needs no polarity awareness at all: it throws
before any `$not` wrapper is built. Both polarities are pinned.

**No shipped behaviour changes.** No first-party provider puts a null into a
membership array — `resolve-authz-context.ts` filters non-strings out of
`org_user_ids`, and the kernel spec declares `org_user_ids: z.array(z.string())`
— so the refused shape was never a declared-valid input. This makes the
implementation match the declaration rather than narrowing it. A fully resolved
list, an empty list (`$in: []`, a legitimate declared predicate) and the
authoring-time `isPushdownableCel` shape gate are all unchanged and pinned so.

Out of scope, deliberately: an AUTHORED literal null inside a list
(`record.status in ['lost', null]`) is a declared predicate, not an unresolved
variable, and what such a filter should select is a separate open question. It
is untouched, with a pin recording that.
