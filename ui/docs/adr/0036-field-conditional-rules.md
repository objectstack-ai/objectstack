# ADR-0036: Field-level conditional rules (visibleWhen / readonlyWhen / requiredWhen)

**Status**: Accepted — implementing (2026-06-07)
**Author**: ObjectUI renderer team
**Consumers**: `@object-ui/core`, `@object-ui/components` (form renderer), `@object-ui/plugin-form`, `@objectstack/spec`, `@objectstack/objectql`, every app whose forms need a field to appear / lock / become mandatory based on other field values

---

## TL;DR

A field's visibility, read-only state, and required-ness are frequently
**conditional on the rest of the record**: an invoice's `paid_on` is only
relevant once `status == 'paid'`; its `tax_rate` is locked once paid; a "send"
flow requires `issued_on` only when the invoice leaves draft. These are not
widget concerns — they are **data-model rules**, authored once on the field and
honored everywhere the object is edited.

We express them as three optional CEL predicates on `Field`:

| Prop           | When the predicate is TRUE                          | Enforced on        |
| -------------- | --------------------------------------------------- | ------------------ |
| `visibleWhen`  | the field is shown (else hidden)                    | client (UX only)   |
| `readonlyWhen` | the field is read-only                              | **client + server**|
| `requiredWhen` | the field is required                               | **client + server**|

> **Amended (2026-07-29) — the `conditionalRequired` alias is gone.**
> This ADR originally carried `conditionalRequired` as a back-compat **alias of
> `requiredWhen`**. `@objectstack/spec` 17 (objectstack#3855) *retired* the key:
> it is tombstoned via `retiredKey()`, so authoring it is both a `tsc` error and
> a hard parse rejection whose message carries the rename (and
> `os migrate meta --from 16` rewrites it automatically). Since the producer now
> rejects the key outright, ObjectUI no longer reads it anywhere — keeping a
> renderer-side `??` fallback would have re-created the second dialect the
> tombstone exists to prevent (AGENTS.md #0.1). **`requiredWhen` is the only
> required-predicate slot.** The paragraphs below are kept as the historical
> record of the original decision.

## Why CEL, and why the *same* engine on both ends

The whole point of a dual-side rule is that the **client UX and the persisted
server verdict agree** for any given record. To guarantee that, both ends
evaluate the predicate with the canonical ObjectStack expression engine —
`@objectstack/formula`'s `ExpressionEngine` (CEL via `@marcbachmann/cel-js`) —
rather than a parallel evaluator. Same dialect, same stdlib, same null/missing
semantics. The alternative (a bespoke client-side condition DSL) is exactly the
drift hazard this avoids: it would agree on `record.status == 'paid'` today and
silently diverge the first time a predicate used `has()`, a string function, or
a list membership test.

`@objectstack/formula` is browser-safe — its only deps are
`@marcbachmann/cel-js` and `@objectstack/spec`, and `@object-ui/core` already
depends on the latter — so there is no new runtime surface and no node-only
import dragged into the bundle.

## Server enforcement (framework)

- **`requiredWhen`** — `@objectstack/objectql`'s rule-validator evaluates the
  predicate over the *merged* record (`{ ...previous, ...patch }`) and pushes a
  `{ field, code: 'required' }` violation when it is TRUE and the value is
  missing. (Historical: `conditionalRequired` was treated identically until the
  spec retired the key — see the amendment above.)
- **`readonlyWhen`** — `stripReadonlyWhenFields` drops any field from an UPDATE
  payload whose predicate is TRUE for the merged record: the incoming change is
  **ignored** (the persisted value is kept), not rejected. Update paths fetch
  the prior record only when an object actually declares conditional fields
  (`needsPriorRecord`).
- A predicate that fails to evaluate is **fail-open** and logged (a broken rule
  must never block a legitimate write) — **except** a `readonlyWhen` whose fault
  is an unbound scope root, which has been fail-CLOSED since objectstack#4889.
  See the next subsection; this bullet used to state the policy unconditionally
  and that is no longer true.
- `visibleWhen` is **not** a server concept — visibility is purely a client UX
  affordance. The server's `requiredWhen` / `readonlyWhen` are the real guards,
  so hiding a field client-side never weakens enforcement.

### The one fail-CLOSED fault (objectstack#4889)

The exception is narrow, and worth stating in full because its symptom is
silent. A `readonlyWhen` predicate can fault because it names a scope ROOT this
write never bound — `parent.status == 'paid'` evaluated where no master-detail
header was resolved. That is not a broken predicate; it is a supported construct
the evaluation site could not answer, and answering "not locked" writes a field
the author declared frozen. So the server takes the conservative branch:
`isReadonlyWhenLocked` logs `… treating the field as LOCKED`, resolves the field
to locked, and `stripReadonlyWhenFields` — with its bulk twin
`stripReadonlyWhenFieldsMulti` — deletes the key from the UPDATE payload. The
incoming change is dropped exactly as a TRUE predicate's would be, and reported
on the write response as a `droppedFields` entry with `reason: 'readonly_when'`.
Enforcement belongs on the server — *server enforces, client is courtesy*, the
rule the framework decides in **ADR-0124 D1** (framework ADR numbering) and
practises throughout its rule-validator, its lint diagnostics and its QA runner
— and a declared lock that failed open would leave enforcement in the courtesy
layer instead.

Everything else keeps the fail-open policy, deliberately:

- **Every other `readonlyWhen` fault** — undeclared key, null overload, parse
  error — logs `… failed to evaluate — change allowed through` and lets the
  change land. The two faults are told apart by the engine's own error text (it
  reports an unknown variable, naming the root, for the unbound case, versus a
  missing key / an overload / a parse fault for the rest), not by guessing.
- **`requiredWhen` carries no such carve-out.** objectstack#4977 bound the same
  `parent` scope for it — so the requirement is now enforced where this ADR says
  it is, on insert, single-id update and bulk — but deliberately kept the
  fail-open *semantics*: an unevaluable requirement, an unresolvable header
  included, is logged and skipped, and the write proceeds. Rejecting a write
  because a header was momentarily unreadable is a louder failure than refusing
  one field.
- **`visibleWhen`** is never evaluated server-side at all, per the bullet above.

## Client enforcement (objectui)

- **`@object-ui/core`** exposes two zero-React helpers:
  - `evalFieldPredicate(pred, record, fallback, previous?)` — wraps the engine,
    returns `fallback` on an absent/broken predicate.
  - `resolveFieldRuleState(rules, record, statics, previous?)` → `{ visible,
    readonly, required }`. A static `required: true` / `readonly: true` is a
    **floor** — a FALSE predicate never weakens it; `visibleWhen` is
    authoritative when present.
- **The form renderer** (`@object-ui/components`) watches the live record
  (`form.watch()`) and re-evaluates every field's rules **reactively** as the
  user types. A field whose `visibleWhen` is FALSE is not rendered; `readonly`
  feeds the field's `disabled`; `required` drives both the asterisk and the RHF
  validation rule.
- **`ObjectForm`** (`@object-ui/plugin-form`) carries the three props through
  from object metadata onto the generated `FormField`s.

### The missing-key gotcha

CEL **throws** on a *missing* map key (`record.status` when `status` isn't in
the record) but compares cleanly against `null`. On a fresh create form,
react-hook-form hasn't registered every field yet, so a naïve `form.watch()`
omits them — and a `visibleWhen` referencing an unregistered field would fault
and fail *open* (flash visible). The renderer therefore seeds every declared
field to `null` before overlaying the *defined* watched values, so an
unregistered field reads as present-null (clean predicate result) rather than
missing (fault). This mirrors the server, which always evaluates over the full
merged record.

`evalFieldPredicate`'s fallbacks are chosen so a fault is *safe*: `true` for
visibility (don't hide content on error), `false` for required/readonly (don't
block submit or lock a field on error) — the same posture as the server for
every fault but one.

**The one place the two ends point in opposite directions.** For the
unbound-root `readonlyWhen` fault above the server locks the field and the
client keeps it editable, deliberately: by the same *server enforces, client is
courtesy* reasoning that makes the server the authority, the courtesy layer does
not get to guess "locked" and grey out a field the server might have accepted. The consequence is worth knowing
before debugging it, because nothing about it looks like a failure: the form
renders the field editable, the user edits it, the save reports SUCCESS, and the
new value never lands. That trail leads to the SERVER-side lock — its `… treating
the field as LOCKED` warning and the write response's `droppedFields` — not to
the client predicate, which returned exactly what it was asked for. The
narrowing is recorded on the client helper's own module head too
(`packages/core/src/evaluator/fieldRules.ts`, objectui#3828).

**Amendment (objectstack#5149, appeal 2).** Fail-open is now **loud**: a
predicate that cannot be evaluated (parse error, unbound identifier, engine
fault) logs one `console.warn` per predicate text — with the source, the
engine's failure reason, and the caller's locator (`visibleWhen of field
'amount'`) when the call site provides one — and then still returns the
fallback. Previously the failure was swallowed, which made a broken predicate
indistinguishable from an absent one (the exact bug class objectstack#5149
documents: two live inert predicates in one app, one shipped for months).
Callers that deliberately probe for faults by evaluating twice with both
fallbacks (`evalRowPredicate`'s fail-closed path, `ExpressionEvaluator`'s
`throwOnError`) pass `warn: false` and surface their own diagnostic, so each
broken predicate produces exactly one warning. The fail-open *default itself*
is unchanged — flipping it is objectstack#5149 appeal 1, deliberately left
undecided; this diagnostic exists partly to measure how often real apps hit
the failure path before that call is made.

## Showcase

`showcase_invoice` demonstrates all three:

```ts
issued_on: Field.date({ requiredWhen: "record.status in ['sent', 'paid']" }),
tax_rate:  Field.number({ readonlyWhen: "record.status == 'paid'" }),
paid_on:   Field.date({
  visibleWhen:  "record.status == 'paid'",   // UX-only: hide until paid
  requiredWhen: "record.status == 'paid'",   // dual-side
}),
```

Covered by the `field-conditional-rules` live e2e (drives Status →
paid/sent/draft and asserts each dependent field re-gates).

## Inline grids (line items)

The same rules apply to **inline line-item grid cells**. `deriveMasterDetail`
carries a column's `readonlyWhen` / `requiredWhen` through to its `GridColumn`,
and `GridField` evaluates them **per row** via `resolveFieldRuleState`:

- A `readonlyWhen`-TRUE cell renders locked (its control is disabled).
- A `requiredWhen`-TRUE empty cell flags inline-invalid on that row
  (`data-testid="line-items-invalid-<row>-<field>"`), the same affordance a
  statically-required empty cell uses.

Scope: today the grid evaluates against the **row** (`record.*`) — e.g.
`description.requiredWhen = "record.quantity >= 100"` (a bulk line needs a
note). The core helpers also accept an extra `scope` (so a predicate could
reference the header as `parent.*`, e.g. lock a paid invoice's lines), and
`GridField` accepts a `contextRecord` prop for it — but wiring the live header
record into the grid requires isolating the grid's re-renders from the
reset-sensitive master-detail header form (a parent re-render mid-submit can
fire the header's `form.reset`). That header-driven lock is therefore a
**deferred** follow-up; row-scoped rules ship now.

## Submit-time enforcement

`requiredWhen` is enforced not just visually but at **submit**: the form
renderer registers react-hook-form's `required` rule from the *resolved*
(CEL) required state, so saving while the predicate is TRUE and the value is
empty blocks submission and attaches the error to the field. When the predicate
later flips FALSE (e.g. the status that imposed it changes), a reactive effect
clears the now-stale *required* error (react-hook-form keeps an error until the
erroring field itself revalidates) — and a field hidden by `visibleWhen` clears
all of its errors.

## Consequences

- Authors express conditional UX once, on the field, in the same CEL they
  already use for validation rules and formulas — no widget-level wiring.
- Client and server cannot drift: identical engine, identical dialect.
- `visibleWhen` is intentionally client-only; never rely on it for security —
  use `readonlyWhen` / `requiredWhen` (or a full validation rule) for guarantees.
