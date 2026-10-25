# ADR-0058: Cascading & role-gated select options (`option.visibleWhen` + `dependsOn`)

**Status**: Accepted — implemented (2026-07-15)
**Author**: ObjectUI renderer team
**Consumers**: `@object-ui/core`, `@object-ui/fields` (`SelectField`), `@object-ui/components` (form renderer), `@object-ui/plugin-form`, `@objectstack/spec`, `@objectstack/objectql`, every app whose forms need a select/lookup whose choices depend on another field or on who is editing
**Companion to**: ADR-0036 (field-level conditional rules) — this applies the same dual-side, one-dialect philosophy to *option* sets. Supersedes the `optionsWhen` framing in issue #1583.

---

## TL;DR

A select's **available options frequently depend on the rest of the record or on
the actor**: pick a Country, then State lists only that country's states; a
"visibility" field offers *Public* only to admins. These are not widget concerns
— they are data-model rules, authored once on the option and honored everywhere
the object is edited.

We express them by reusing the two primitives ADR-0036 and the dependent-lookup
work (#2215) already established, **not** a new mechanism:

| Knob                    | Meaning                                                        | Enforced on         |
| ----------------------- | ------------------------------------------------------------- | ------------------- |
| `option.visibleWhen`    | the option is offered when the CEL predicate is TRUE          | client (UX) + server (for authorization) |
| `field.dependsOn`       | which sibling field(s) the option list reacts to (gate/recompute) | client              |

A picklist cascade is therefore `dependsOn` (declares the dependency edge) + per-option
`visibleWhen` (the condition) — structurally identical to a lookup cascade.

## Decision: per-option `visibleWhen`, not a field-level `optionsWhen` or `validFor`

Issue #1583 floated a field-level `optionsWhen` predicate; #2284 settled the
authoring shape as **per-option `visibleWhen` + `dependsOn`**, explicitly
rejecting Salesforce-style `validFor` / `controllingField` / dependency matrices.
Rationale:

1. **Minimal, unified vocabulary.** `dependsOn` is already how a lookup declares
   its cascade; `visibleWhen` is already the field-level CEL predicate (ADR-0036).
   Reusing both introduces no new category and no bespoke matrix format.
2. **`visibleWhen` is strictly more expressive than a value cascade.** It sees
   `current_user` (positions/tenant) and `now()`, so the *same* knob covers cascades
   (`record.country == 'cn'`) **and** role/context gating
   (`'admin' in current_user.positions`). `validFor` can only express "varies with
   another field's value" — it cannot gate by role. `current_user` is already
   bound on every predicate surface (server formula, RLS, client UI gates), so a
   role-referencing option predicate needs **zero new binding**.
3. **AI-authoring friendly.** Schemas are increasingly model-generated and
   human-reviewed. `visibleWhen: "record.country == 'cn'"` reads as prose and is
   a primitive the model has seen countless times; a `validFor` matrix's main
   value (a visual editor) does not exist under this authoring model.
4. **`dependsOn` ⟂ `visibleWhen`.** `dependsOn` only declares which sibling
   fields drive the list (gating UX + recompute); `visibleWhen` is the predicate.
   An option may carry `visibleWhen` with **no** `dependsOn` (a pure role gate).
   The two are never coupled.

## Why CEL, and the same engine on both ends

As in ADR-0036, the point of a dual-side rule is that the **client UX and the
persisted server verdict agree** for a given record. Both ends evaluate the
option predicate with the canonical `@objectstack/formula` `ExpressionEngine`
(CEL via `@marcbachmann/cel-js`) — the same dialect, stdlib, and null/missing
semantics the field-level rules use — via the shared `evalFieldPredicate` path.
No parallel client DSL, so no drift.

## Client implementation (objectui)

- **`@object-ui/core` — `evaluator/optionRules.ts`** exposes four zero-React helpers,
  all reusing `evalFieldPredicate`:
  - `resolveVisibleOptions(options, record, scope?)` — keep options whose
    `visibleWhen` is TRUE against the live record (+ `{ current_user }` scope);
    predicate-less options are always kept; a faulting predicate **fails open**
    (option kept), matching field-visibility posture.
  - `resolveDependsOnFields(dependsOn)` — normalize the spec `dependsOn`
    (`string | Array<string | {field,param}>`) to sibling field names.
  - `isOptionGroupGated(dependsOn, record)` — TRUE while any `dependsOn` field is
    empty; the list is withheld rather than shown unfiltered.
  - `isValueStillOffered(value, visibleOptions)` — cascade-clear decision
    (scalar and multi-select), so a parent change drops a now-invalid child value.
- **The form renderer** (`@object-ui/components`, `renderers/form/form.tsx`)
  watches the live record (`ruleRecord`, every declared field seeded to `null`
  first — the missing-key gotcha from ADR-0036), narrows each dependent select's
  options, gates the control with a `Select {parent} first` hint while a
  `dependsOn` field is empty, and **cascade-clears** a stale value in a reactive
  effect (no "China + California" pair ever submits).
- **`SelectField`** (`@object-ui/fields`) applies the identical resolution
  standalone via `dependentValues` (the channel dependent lookups use) + the
  global `usePredicateScope()` (so `current_user` resolves). Filtered-out options
  are absent from the DOM (`data-testid="select-option-<value>"` only for offered
  values); a gated field renders `select-empty-<name>`.
- **`ObjectForm`** (`@object-ui/plugin-form`) carries `options` (and thus their
  `visibleWhen`) and `dependsOn` through from object metadata onto the generated
  `FormField`s.

## Static options vs. query-backed lookups

Two paths, one declaration style:

- **Small, stable dictionaries** (category → subcategory, a handful of statuses,
  role gates) → static `options` + `option.visibleWhen`. This ADR.
- **Large / changing / shared data** (countries, org trees, catalogs,
  account → contact) → `lookup` + `dependsOn`, with the dependency folded into
  the query `$filter` (#2215). The choice is a data-modeling decision, documented
  in `skills/objectui/guides/schema-expressions.md`; the authoring surface
  (`dependsOn`) is the same either way.

## Build-time guardrail

An option `visibleWhen` fails **closed**: a wrong predicate makes its option
silently never appear, which runtime fail-open cannot surface. The headline case
(#2284) is an AI-authored literal typo — `record.country == 'chna'` when
`country`'s options are `cn`/`us`, so the option is unreachable although the
expression parses and the field exists.

`@object-ui/core`'s `lintOptionPredicates(fields)` (`evaluator/optionLint.ts`)
closes this at authoring/CI time with three conservative checks: `syntax` (via
`@objectstack/formula`'s `validateExpression`, no schema hint so a legitimate
`current_user.positions` reference is never flagged), `unknown-field` (a `record.<name>`
naming no declared sibling), and `option-literal-not-in-domain` (a literal
compared against an *enum* sibling that is outside its declared value set). It
only flags what it can statically prove — non-`record.` roots, open-domain
fields, and unrecognized shapes are left alone, so there are no false positives.
The schema catalog runs it over every shipped example
(`examples/schema-catalog/test/option-predicates.test.tsx`).

## Server enforcement (framework) — the authorization half

Hiding an option client-side is **UX, not a security boundary**: a caller can
still submit a hidden value. When an option is gated for **authorization**, the
server must also reject writes of that value. The contract (framework
`@objectstack/objectql`, alongside ADR-0036's `requiredWhen`/`readonlyWhen`):

- On write, evaluate the submitted option value's `visibleWhen` over the merged
  record (`{ ...previous, ...patch }`) plus the actor; reject with a
  `{ field, code }` violation when FALSE — mirroring how `stripReadonlyWhenFields`
  already walks conditional fields (`needsPriorRecord`).
- A predicate that fails to evaluate is **fail-open** and logged (a broken rule
  must never block a legitimate write), matching the client and ADR-0036.
- Pure cascades / UX-only gating do not require this; it is specifically the
  authorization path.

This ADR records the objectui (client + guardrail) work as shipped; the
server-side option-value enforcement and its live e2e are the framework-side
remainder tracked in #1583.

## Consequences

- Authors express dependent and role-gated choices once, on the option, in the
  same CEL they already use for field rules and formulas — no widget wiring, no
  new matrix format.
- Client and server cannot drift: identical engine and dialect.
- `option.visibleWhen` is UX by default; for authorization it must be paired with
  server enforcement — never rely on client hiding for a security guarantee.
- A wrong option predicate is caught before it ships by `lintOptionPredicates`,
  not discovered as a silently-missing choice in production.
