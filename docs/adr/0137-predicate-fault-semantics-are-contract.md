# ADR-0137: A predicate's FAULT semantics are part of the protocol — loud at submit, fail-open at render, and a blank predicate is a declared third state

**Status**: Accepted (2026-09-18) — **this record declares; it implements nothing.** D1's authoring refusal is ruled by decision batch #122 item 2 (card #15811, [`5644350409`](https://github.com/objectstack-ai/objectstack/issues/15811#issuecomment-5644350409), 2026-09-12) and lands in PR #18638, which owns the accept-set narrowing across every evaluated slot under one ADR-0087 id — this record's own PR carries **no** schema change, by decision batch #160 item 1 (2026-09-18: 「同意」 to **A**). **D2 / D3 / D4 are declared here and delivered by consumers** — the renderer and submit path in objectui#8069, which is `pm:blocked` on this record. See [Scope boundary](#scope-boundary-what-this-record-does-not-land) for what this record does not land and who lands it.
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

| state | before | after this decision |
|---|---|---|
| absent | no rule | no rule (unchanged) |
| authored and evaluable | the author's verdict | the author's verdict (unchanged) |
| **authored, blank** | parsed, then silently no-op'd | **refused at authoring** (D1) |
| **authored, not evaluable** | each layer's own fallback, silently | **refused at submit, loudly** (D2) |

"After this decision", not "after this PR": every row of the right-hand column is
carried by someone else — D1 by PR #18638 under decision batch #122 item 2, D2–D4
by the consumers in objectui#8069. This record is the contract, not the landing.

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

### The narrowing mechanism already existed, and it already has an owner

This record introduces no validation machinery and carries none.
`EvaluatedExpressionSchema` and `EvaluatedExpressionInputSchema` already spell
"an evaluated slot is held to what the engine can actually run", already publish
one sentence for it (`EVALUATED_EXPRESSION_SOURCE_REQUIRED`), and
`FlowEdgeSchema.condition` already composes them for exactly this defect one
family over.

Generalising that composition to the rest of the evaluated slots was ruled six
days before this record, on its own card: **decision batch #122 item 2**
(card #15811, comment
[`5644350409`](https://github.com/objectstack-ai/objectstack/issues/15811#issuecomment-5644350409),
2026-09-12, maintainer 「同意」 to **A**). Its item 1 names the population from
a measured census, the field-rule triad included: *「field / option /
grid-column `visibleWhen` / `readonlyWhen` / `requiredWhen`」*. Its item 2 keeps
`ExpressionSchema` / `ExpressionInputSchema` on "`source` OR `ast`". **PR #18638
implements it** — one ADR-0087 id for all 36 declaring positions.

So the authoring refusal this record's D1 states is **not this record's to
carry**, and a second carrier for it would be a second id for one migration.
`PredicateSchema` / `PredicateInputSchema` are **not** that carrier either: they
are a plain alias pair of the persistence contract with zero slot users, they
stay wide with the schema they alias (#18638's own measurement says so), and
retiring them as dead symbols is a separate question on its own measurement.

## Decision

### D1 — A predicate slot accepts only what the engine can run

A field-rule predicate is an EVALUATED slot by definition, so the envelope it
accepts must be one the engine can evaluate, and the CEL engine reads `source`
alone (`cel-engine.ts` `evaluate`: "AST-only evaluation not yet supported;
persist `source`"). An envelope carrying only an `ast`, and a `source` that is
blank after trimming (through the envelope key or the bare-string shorthand), are
refused at **authoring** with `EVALUATED_EXPRESSION_SOURCE_REQUIRED` rather than
parsing, registering, and faulting at evaluation time.

⚠️ **This decision is recorded here and carried elsewhere.** It is the
field-rule row of a rule already ruled across every evaluated slot by decision
batch #122 item 2 and implemented by PR #18638 (see [the
Context](#the-narrowing-mechanism-already-existed-and-it-already-has-an-owner)
above): `EvaluatedExpressionSchema` / `EvaluatedExpressionInputSchema` compose
into the slots themselves, and **one** ADR-0087 D3 semantic entry covers the
whole population. This record's own PR changes no schema and registers no
migration id. A reader who arrives at this line asking "where is it enforced"
should read #18638's entry, not look for a second one.

`ExpressionSchema` / `ExpressionInputSchema` are **not** narrowed: they remain the
persistence contract, and `ast` remains an optional opaque structured value there.
An `ast` **beside** a string `source` stays admitted everywhere.

The refusal needs an ADR-0087 D3 **semantic** entry rather than a D2 conversion,
and the reason is worth keeping next to the decision: no conversion can express
it. An `ast`-only envelope carries no `source` to lower an AST back into where
the dialect has no printer, and a blank `source` names no predicate to
reconstruct. Which of "author the rule" and "drop the rule" the author meant is
not derivable, and the platform does not guess.

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

- **This record lands no schema change at all.** Its own PR carries the record,
  the ADR-0089 pointer and nothing that a runtime or an author can observe. D1's
  authoring refusal is #18638's, under batch #122 item 2; the record is here
  because the fault semantics D2–D4 state are what a consumer is held to, and a
  consumer cannot be held to a direction no protocol states.
- **D2 / D3 / D4 are consequences CONSUMERS deliver.** `packages/spec` carries no
  business logic (Prime Directive #2), so the submit refusal, the render direction
  and the gate diagnostic are declared here and implemented in objectui#8069.
  This record is the contract they are held to.
- **D4's spec-side authoring refusal for the GATE slots is RULED and IN FLIGHT —
  it is not a follow-up, and it is not this record's to give or withhold.** The
  action / visibility gate slots are inside decision batch #122 item 2's
  population, which was drawn from the measured census on card #15811
  ([`5629834274`](https://github.com/objectstack-ai/objectstack/issues/15811#issuecomment-5629834274),
  36 declaring positions, re-derived by identity on #18638's base) and named in
  the ruling as *「action `visibleWhen` / `visible` / `ActionConditionInputSchema`;
  app `visible`; settings visibility; … `ui/bulk-action` visibility」*. **Cite that
  census rather than re-enumerating it** — a hand list rots, and this record's
  did: it omitted `system/settings-manifest.zod.ts:424` and `:686`, both
  `visible: SettingsVisibilityInputSchema`, which is
  `ExpressionInputSchema.superRefine(…)` — the refinement returns early on a
  `source` that is absent or blank (`if (!source) return;`), so it narrows
  neither the `ast`-only nor the blank-`source` arm and those two slots sit on
  the persistence contract exactly like the rest.
- **What the batch #119 ruling did not give, and what that does not mean.** The
  card behind this record measured its evidence on the field-rule path, and
  several gate slots carry their **own** declared fault directions
  ("fail-closed" on `ObjectFieldGroupSchema.visibleWhen` and
  `RowCrudActionOverride.visibleWhen`, "fail-soft" on `disabledWhen`) which are
  not the field-rule triad's. Converting them **on the strength of batch #119**
  would bake a direction that ruling did not give. That is the whole of the
  claim: it is a statement about which ruling authorizes what, not a reason the
  conversion should wait. Batch #122 item 2 gave exactly that direction six days
  earlier, on its own measured census, and #18638 implements it. A second
  consideration is a cost, not an objection: `packages/lint`'s
  `validate-visibility-predicates.ts` `celRefusal` records the opposite position
  for those slots today — a blank predicate there "is 'no predicate', exactly
  what the author meant" — so the conversion is a behaviour change in a second
  package rather than a schema swap, and #18638 carries that cost with the
  narrowing.

## Consequences

**The loud state surfaces every silently-faulting stored predicate.** How many
exist in production is **unmeasured** — the loud state is what will reveal them,
and that is its purpose. It is user-visible, so the objectui half ships with a
changeset banner saying so. A repo-wide census over `examples/`, `packages/`,
`content/` and `skills/` at `03b7b8187` found **zero** field-rule predicates of
either spelling D1 refuses, against two live lit controls (15 files carrying
non-blank tagged-template predicates, 14 carrying envelope-form ones) — so there
is nothing in this repository for D1's landing to rewrite.

**One stored-row edge is named rather than asserted.**
`applyConversionsToStoredItem` **is** applied to `object` (only `flow` is
skipped), but no conversion repairs either refused spelling, so a stored row
carrying one meets a strict schema at whichever seam parses it once the refusal
lands. Which seam that is, and whether it degrades to a warn or refuses the
object, was **not measured** on this card. It is recorded here as the open edge,
and it belongs in the acceptance criteria of the ADR-0087 entry that carries the
refusal — #18638's, under batch #122 item 2 — as "read the boot log for the
object by name rather than expecting a specific message".

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
