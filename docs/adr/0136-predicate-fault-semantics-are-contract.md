# ADR-0136: A predicate's FAULT semantics are part of the protocol — loud at submit, fail-open at render, and a blank predicate is a declared third state

**Status**: Accepted (2026-09-18) — **D1 implemented here** (`PredicateSchema` / `PredicateInputSchema` compose the evaluated rule; the `FieldSchema` field-rule triad binds them; ADR-0087 D3 entry `field-rule-predicate-evaluated-slot-source-required`). **D2 / D3 / D4 are declared here and delivered by consumers** — the renderer and submit path in objectui#8069, which is `pm:blocked` on this record. D4's spec-side authoring refusal for the action / visibility GATE slots is deliberately **not** in this record's PR; see [Scope boundary](#scope-boundary-what-this-record-does-not-land).
**Deciders**: ObjectStack Protocol Architects (maintainer ruling on objectui#8069, decision batch #119 item 3, 2026-09-12: 「同意」 to **A**, with **Q2 yes** and **Q3 yes**), filed as objectstack#17778 by the director seat
**Builds on**: [ADR-0058](./0058-expression-and-predicate-surface.md) (the expression & predicate surface — its D5 predicate failure tiers are the table this record writes the field-rule row of), [ADR-0089](./0089-unify-visibility-predicate-naming.md) (unified the `*When` family under one NAME; this record decides what that family does when it cannot RUN), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (conversion-over-notification — D1 lands as a D3 semantic entry because no D2 conversion exists), [ADR-0124](./0124-server-enforces-client-is-courtesy.md) (D1 server-enforces — why a render-side direction is never the whole answer), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently-inert metadata — a predicate that cannot run is the purest case), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), [ADR-0032](./0032-unified-expression-layer.md) (the CEL layer these predicates are written in)
**Consumers**: `@objectstack/spec` (`shared/expression.zod.ts` — the predicate contract; `data/field.zod.ts` — the field-rule triad), `@objectstack/objectql` (`validation/rule-validator.ts` — the server-side enforcer whose three fault directions this record measured), `@objectstack/lint` (`validate-expressions.ts`, `validate-visibility-predicates.ts` — the author-time reporters), and the ObjectUI form renderer + submit path (objectui#8069)
**Surfaced by**: objectui#8069, measured on objectui `main`: `resolveFieldRuleState` evaluates `visibleWhen` / `readonlyWhen` / `requiredWhen` with fallbacks `true` / `false` / `false` when a predicate cannot be evaluated, so **one misspelled column in one predicate produces a form that shows more, locks less and demands less, all at once, with no state that says "this rule did not run"**. PR objectui#8904 named the three directions and made a blank predicate warn, and declined the producer-side narrowing — which is what this record decides.

---

## TL;DR

A field-rule predicate has always had three possible states and a protocol that
named two. The missing state is **"authored, but the engine cannot run it"** — and
because nothing named it, every layer resolved it to its own local fallback and
none of those fallbacks was the author's.

| state | before | after this record |
|---|---|---|
| absent | no rule | no rule (unchanged) |
| authored and evaluable | the author's verdict | the author's verdict (unchanged) |
| **authored, blank** | parsed, then silently no-op'd | **refused at authoring** (D1) |
| **authored, not evaluable** | each layer's own fallback, silently | **refused at submit, loudly** (D2) |

**Decision:** a predicate's fault semantics are **protocol**, not renderer choice.
A predicate slot accepts only what the engine can actually run (D1). A fault at
**submit** refuses the write and names the field and the rule (D2). A fault at
**render** leaves visibility **fail-open** (D3). A blank or faulting **gate**
predicate is diagnosed, never a silent `true` (D4). The evaluation **helper's**
fallback stays freely specifiable, and no part of this record changes it.

The standing ruling this sits under, verbatim:

> 我们的项目以objectstack 协议为准…协议不正确的应该先修改协议。

## Context

### The composite was never argued — only each key, once, at introduction

The three directions were each chosen on their own, and each is defensible alone.
`visibleWhen` fails open because hiding a control you cannot justify hiding is how
a form writes `null` over a column nobody saw. `readonlyWhen` and `requiredWhen`
fail their own ways for their own reasons. What no record ever asked is what the
three do **together**, and together they compose the one outcome none of them
would have chosen: a broken predicate makes a form simultaneously more permissive
on every axis, and says nothing.

### The three fault directions, measured at their own ends

Measured on `objectstack` at `03b7b8187`, reading each enforcement point rather
than inferring any cell from its neighbours:

- **`visibleWhen` — the server never evaluates it at the FIELD level at all.**
  `rule-validator.ts`'s `ConditionalFieldDef` has no such member. The renderer
  falls back to VISIBLE where no host publishes a predicate scope.
- **`readonlyWhen` — the declared lock is silently WAIVED on an unevaluable
  envelope.** `isReadonlyWhenLocked` has two fault arms: an unbound-ROOT fault
  returns `true` ("the declared lock is not waived because it could not be
  evaluated"), and **every other** fault logs `readonlyWhen for '<name>' failed to
  evaluate — change allowed through` and returns `false`. An `ast`-only or blank
  envelope takes the second arm. So the fault direction here depends on *which*
  fault, and the shape this record refuses lands on the permissive one.
- **`requiredWhen` — fail-open at both ends.** The server logs and `continue`s;
  the form does not mark the field required. A record saves with the field empty.

So all three refused spellings resolve to a **no-op** today. That matters for the
migration prescription: removing such a key is behaviour-preserving, which makes
it a safe default — and a dishonest one to reach for without noticing that it
records a rule that never ran.

### The narrowing mechanism already existed

This record introduces no new validation machinery. `EvaluatedExpressionSchema`
and `EvaluatedExpressionInputSchema` already spell "an evaluated slot is held to
what the engine can actually run", already publish one sentence for it
(`EVALUATED_EXPRESSION_SOURCE_REQUIRED`), and `FlowEdgeSchema.condition` already
composes them for exactly this defect one family over. What was missing is that
`PredicateSchema` / `PredicateInputSchema` — the aliases whose entire purpose is
to mark a slot as a predicate — composed the **persistence** contract, whose rule
is "`source` OR `ast`". The alias that means "this will be evaluated" pointed at
the schema that does not require evaluability.

## Decision

### D1 — A predicate slot accepts only what the engine can run

`PredicateSchema` and `PredicateInputSchema` compose `EvaluatedExpressionSchema` /
`EvaluatedExpressionInputSchema`. An envelope carrying only an `ast`, and a
`source` that is blank after trimming (through the envelope key or the bare-string
shorthand), are refused at authoring with `EVALUATED_EXPRESSION_SOURCE_REQUIRED`.
The `FieldSchema` field-rule triad — `visibleWhen`, `readonlyWhen`, `requiredWhen`
— binds them.

`ExpressionSchema` / `ExpressionInputSchema` are **not** narrowed: they remain the
persistence contract, and `ast` remains an optional opaque structured value there.
An `ast` **beside** a string `source` stays admitted everywhere.

This is an accept-set narrowing and ships with an ADR-0087 D3 semantic entry
(`field-rule-predicate-evaluated-slot-source-required`), because no D2 conversion
can express it: an `ast`-only envelope carries no `source` to lower an AST back
into, and a blank `source` names no predicate to reconstruct. Which of "author the
rule" and "drop the rule" the author meant is not derivable, and the platform does
not guess.

### D2 — A field-rule predicate that FAULTS refuses the SUBMIT, loudly

At submit time, a field-rule predicate that cannot be evaluated refuses the write
and names **the field and the rule**. Nothing is persisted. This is the "loud but
safe" middle state, and it is the mainstream shape: a validation formula that
errors blocks the save **with** the error rather than passing.

A rule that could not run has produced no verdict. Treating "no verdict" as the
author's verdict is the whole defect; refusing is the only answer that neither
invents a verdict nor hides that one is missing.

A blank predicate takes this path too, wherever one is already stored — D1 keeps
new ones from being authored, and D2 is what a stored one meets. That is what
makes "blank" a declared **third** state rather than a spelling of "no rule".

### D3 — At RENDER, visibility stays fail-OPEN

A faulting `visibleWhen` **shows** the field. `readonlyWhen` / `requiredWhen` keep
their existing render directions for display.

⛔ This is **not** a softening of D2, and it is not re-litigable on the grounds
that it reads inconsistent with it. The two are a **pair**: fail-open at render is
what keeps a faulting rule from hiding a control and letting the form write `null`
over a stored column the user never saw, and the submit-time refusal is what keeps
fail-open from being a silent permission grant. Neither is safe alone. Per
ADR-0124 D1 the render side was never the enforcement point anyway; D2 is where
enforcement lives.

### D4 — A blank or faulting GATE predicate is diagnosed, never a silent `true`

The action / visibility gate path answers a bare `true` for a blank source before
the value ever reaches the evaluator, with no diagnostic. That silence is closed by
the same declaration: a gate predicate that is blank or faulting is **diagnosed**.
A gate is a predicate, and D1's reasoning applies to it unchanged.

### D5 — The evaluation HELPER's fallback stays freely specifiable

No part of this record fixes a fault direction inside the shared evaluation helper.
The direction is declared at the **field-rule and gate layer**, where the author's
intent lives; the helper stays a mechanism. Two shipped strategies depend on that
freedom and a helper-level default would delete both — see the constraints below.

## Two constraints carried verbatim, and not re-litigable

From the objectui#8069 thread, into objectstack#17778, into this record:

> objectui#6958 deliberately relies on visibility fail-open: a broken predicate
> must NEVER silently null a stored column.

> Fault strategies 4 (fault → flag, `listConditional.ts`) and 5 (fault → throw,
> `evaluateCelCondition` under `throwOnError`) exist ONLY because the helper's
> fallback is freely specifiable ⇒ ⛔ no change may bake a direction into the
> helper.

The first is why D3 is fail-open and why that direction is load-bearing rather
than a leniency. The second is why D5 exists as its own decision line instead of
being left implicit: a reader who takes D2 as "make faults throw" would delete
strategy 4, and a reader who takes D3 as "make faults fall back" would delete
strategy 5. The helper is not where either direction belongs.

## Scope boundary — what this record does not land

Stated explicitly so that no part of it reads as delivered when it is not
(Prime Directive #10: declared ≠ enforced is the defect this whole record is
about).

- **D2 / D3 / D4 are consequences CONSUMERS deliver.** `packages/spec` carries no
  business logic (Prime Directive #2), so the submit refusal, the render direction
  and the gate diagnostic are declared here and implemented in objectui#8069.
  This record is the contract they are held to.
- **D4's spec-side authoring refusal is NOT applied to the gate slots in this
  record's PR.** The action / visibility gate slots — view and page `visibleWhen` /
  `visibleOn` / `visibility`, action and bulk-action `visible` / `visibleWhen`,
  component `visible` / `visibleWhen`, app nav `visible`, `ObjectFieldGroupSchema`
  `visibleWhen`, `RowCrudActionOverride` `visibleWhen` / `disabledWhen`, the
  per-OPTION `visibleWhen` and the inline-column `readonlyWhen` / `requiredWhen`
  — still compose `ExpressionInputSchema`. Two reasons, and the first is the one
  that matters: several of those slots carry their **own** declared fault
  directions ("fail-closed", "fail-soft") which are not the field-rule triad's,
  and the ruling measured its evidence on the field-rule path. Binding them all to
  one rule without re-measuring each declared direction would bake a direction the
  ruling did not give, which is exactly what the second constraint above forbids.
  Second, `validate-visibility-predicates.ts`'s `celRefusal` currently records the
  opposite position for those slots — a blank predicate there "is 'no predicate',
  exactly what the author meant" — so converting them is also a behaviour change
  in a second package, not a schema swap. That conversion is filed as a follow-up
  with the slot inventory, and it is the one place where D4 is currently declared
  ahead of its authoring-side enforcement.

## Consequences

**The loud state surfaces every silently-faulting stored predicate.** How many
exist in production is **unmeasured** — the loud state is what will reveal them,
and that is its purpose. It is user-visible, so the objectui half ships with a
changeset banner saying so. A repo-wide census over `examples/`, `packages/`,
`content/` and `skills/` at `03b7b8187` found **zero** field-rule predicates of
either refused spelling, against two live lit controls (15 files carrying
non-blank tagged-template predicates, 14 carrying envelope-form ones) — so there
is nothing in this repository to rewrite.

**One stored-row edge is named rather than asserted.**
`applyConversionsToStoredItem` **is** applied to `object` (only `flow` is
skipped), but no conversion repairs either refused spelling, so a stored row
carrying one now meets a strict schema at whichever seam parses it. Which seam
that is, and whether it degrades to a warn or refuses the object, was **not
measured** on this card. It is recorded here as the open edge, and in the D3
entry's acceptance criteria as "read the boot log for the object by name rather
than expecting a specific message".

**ADR-0089 is extended, not reversed.** That record unified the `*When` family
under one name and is untouched by this one; this record decides what the family
does when it cannot run. A reader arriving at ADR-0089 for fault behaviour is
sent here.

## Alternatives considered

**Amend ADR-0089 instead of a new record.** Rejected. ADR-0089's decision is
*naming* — one concept, one spelling — and fault semantics is an orthogonal
decision that composes ADR-0058, ADR-0124 and ADR-0078 as much as it does
ADR-0089. Hanging "what happens when it faults" off a naming record would make
both harder to cite. The filing card explicitly authorized a new record if the
spec seat judged the scope larger, and it is larger.

**Bake the direction into the evaluation helper** (one fallback, centrally). This
is the shape a reader reaches for first, and it is refused by the second
constraint above: it deletes fault strategies 4 and 5, both of which are shipped
and both of which exist only because the fallback is a parameter.

**Make a blank predicate mean "no rule", formally.** This is the position the lint
layer currently records for the gate slots, and it is coherent. It is refused for
the field-rule triad because it makes the two failure modes indistinguishable at
exactly the moment an author needs them distinguished: "I deleted the rule" and
"the rule I wrote will not run" get the same runtime behaviour and the same
silence. Q3 = yes is the ruling on that question.

**Narrow `ExpressionSchema` itself.** Rejected, unchanged from the flow-edge
precedent: it is the persistence contract, its docblock declares `ast` an optional
opaque value carrying no promise of becoming required, and a slot that only
*stores* an envelope has no reason to demand evaluability.
