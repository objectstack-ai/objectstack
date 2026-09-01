# ADR-0072: Reference Scope & Resolvability — the authored-expression data-picker model (#1934)

**Status**: Proposed (2026-06-25)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0032](./0032-unified-expression-layer.md) (one authoring language: CEL), [ADR-0058](./0058-expression-and-predicate-surface.md) (the expression & predicate surface — interpret vs compile, fail-policy matrix), [ADR-0036 field conditional rules](https://github.com/objectstack-ai/objectui/blob/main/docs/adr/0036-field-conditional-rules.md) (objectui repo)
**Consumers**: `@objectstack/spec` (`FlowNode.outputSchema`), `@objectstack/service-automation`, `@objectstack/formula`; `@object-ui/app-shell` (the metadata-admin authoring surface — implementation lives in the objectui repo)
**Relates to**: objectui #1934 (flow variable data-picker). The picker/validation already landed incrementally in objectui (#1973 / #1975 / #1978 / #1980 / #1981) — this ADR is the *model* those slices are instances of, and the contract for everything past them. Filed here (alongside the expression-layer ADRs 0032/0058) because the invariant is grounded in framework engine + spec semantics, even though the UI lives in objectui.

---

## TL;DR

A low-code author writes CEL expressions and `{var}` templates across **dozens of surfaces** (flow/edge conditions, formula fields, validation & visibility predicates, sharing/RLS conditions, screen templates, …). Until #1934 they typed reference names **from memory**, and a slightly-wrong name failed *silently* at runtime (or tripped the `{record.x}` brace-in-CEL trap, ADR-0032). The objectui data-picker fixes discovery for flow; this ADR generalises the **model** behind it.

The model rests on **one invariant**: *the picker and its inline validator surface only references that actually resolve at runtime.* Everything else follows:

1. **Scope is per-surface and graph-aware.** What is referenceable depends on *where* you author (a flow node sees the trigger record + upstream outputs + flow vars; a formula sees only its object's record; an RLS rule sees `current_user` + record fields). The same picker, fed a surface-specific scope, offers the right set — and the **token shape follows the surface** (flow flattens the record so bare `status` is valid; everywhere else it is `record.status`).
2. **Object-typed references are drillable; lookups are not dot-walked.** `account_data.<field>` (an upstream `get_record` output) resolves and is offered. `record.account.name` (a trigger-record lookup) does **not** resolve — the engine never expands lookups — so it is **never offered**; the relational path is a *guided fetch* ("add a Get Records step"), mirroring Salesforce Flow.
3. **Schema is the source of truth, the engine is the oracle.** Output types come from the producing node's object (today `config.objectName`; long-term `outputSchema.objectName`); the validator's "in-scope roots" align with the engine's canonical CEL scope roots.

Non-goal: re-deciding the runtime evaluation layer (ADR-0058 owns that). This ADR is its **authoring-side dual**: discoverability + resolvability of references *before* they reach the evaluator.

---

## Context

### The problem, concretely

Authoring a reference you cannot see is guesswork, and the failure is invisible:

- Mistype `lead_scor` for `lead_score` → CEL resolves it to `null`, the branch silently takes the wrong path (ADR-0058 D5: non-security surfaces fail *soft*).
- Wrap a field in single braces inside a condition — `{record.x} > 1` — and CEL parses `{…}` as a *map literal* (#1491 / ADR-0032). Fails silently.
- Reach for `record.account.name` expecting the related Account — but the trigger record carries `account` as an **id**, not an expanded object, so it is `undefined`.

These are the same class of bug: **referencing something that is not actually in scope / not resolvable** at that authoring point. A picker that lists the in-scope references and inserts the correctly-shaped token removes the guesswork — *if and only if* every entry it offers truly resolves. One dead entry and authors stop trusting it.

### Evidence — how the runtime actually seeds references

**Flow / edge / decision conditions** (`packages/services/service-automation/src/engine.ts#variables`): the engine seeds `$record` + `record` = the **raw** trigger record, **flattens** its fields to top-level (so bare `status`/`budget` resolve), and adds `previous`, flow `variables`, prior-node outputs, `$runId`/`$flowName`. Crucially the record is injected verbatim:

```js
variables.set('record', context.record);
for (const [k, v] of Object.entries(context.record))
  if (!variables.has(k)) variables.set(k, v);   // flatten — NO relationship expansion
```

→ **lookups stay ids; `record.account.name` does not resolve.** This is *why* the showcase fetches related data explicitly (`get_record` → `account_data.annual_revenue`).

**Other surfaces do not flatten** (research across this repo):

| Surface | Evaluator (file:line) | In-scope references | Token shape |
| :-- | :-- | :-- | :-- |
| Flow / edge / decision | `packages/services/service-automation/src/engine.ts#variables` | `record`,`previous`, **flattened record fields**, flow `variables`, node outputs, `$runId`/`$flowName` | bare **and** `record.x` |
| Formula field (`Field.expression`) | `packages/objectql/src/engine.ts#expression` | `{ now, timezone, user, org, record }` | `record.x` only |
| Validation (`script`/`cross_field`/`when`) | `packages/objectql/src/validation/rule-validator.ts#cross_field` | `{ record: {...previous,...patch}, previous }` | `record.x` only |
| Field `visibleWhen`/`requiredWhen`/`readonlyWhen` | `packages/objectql/src/validation/rule-validator.ts#readonlyWhen` | merged `record`, `previous`, (`parent` for master-detail — server-bound for `readonlyWhen` since #4889; the client grid binds it for all three) | `record.x` only |
| Hook lifecycle `condition` | `packages/objectql/src/hook-wrappers.ts#condition` | `{ record }` | `record.x` only |
| RLS `using`/`check` (compile→filter) | `packages/plugins/plugin-security/src/rls-compiler.ts` | `current_user.*` (+ pre-resolved membership), record field names | field operands; pushdown subset only |
| Sharing-rule `condition` (compile→filter) | `packages/plugins/plugin-sharing/src/bootstrap-declared-sharing-rules.ts` | record fields only | field operands; pushdown subset only |
| Action/view/app `visible` | framework UI layer; roots in `@objectstack/formula packages/formula/src/cel-engine.ts` | `record`,`os`,`user`,`ctx`,`features`,… | `record.x` / namespaced |

The canonical CEL scope roots the engine recognises are declared in `@objectstack/formula packages/formula/src/cel-engine.ts`: `record, previous, input, output, os, vars, variables, automation, context, args, item, env, user, step, result, trigger, event, payload, data, params, config, settings, ctx, features, parent`.

Two consequences for the picker model:
- **Token shape is surface-specific** (flow = bare-or-dotted; everything else = dotted). The picker must know the surface.
- There is **one canonical root allowlist** the validator should reuse, instead of a hand-rolled one.

**`outputSchema` today** (`packages/spec/src/automation/flow.zod.ts#outputSchema`): `Record<string, { type: 'string'|'number'|'boolean'|'object'|'array'; description?: string }>`, **optional**, carries **no `objectName`**, is **not consumed by the engine**, and is read by the designer only for connector/Tool display. So it cannot, today, tell the picker *which object* an `object`-typed output holds. The reliable signal is the **producing node's `config.objectName`** (required on CRUD nodes) found by walking the graph back — exactly the walk the objectui picker already does (`@object-ui/app-shell` · `inspectors/flow-scope.ts` `flowAncestors`).

### What already shipped (Slice 0/1, objectui #1934)

The flow data-picker and its inline validator already landed in objectui: graph-aware scope resolution (`flow-scope.ts`), the `{x}` picker with bare-vs-`{var}` insertion (`VariableTextInput.tsx`, ADR-0032 brace handling), scope-aware unknown-reference warnings with "did you mean?" (`flow-ref-check.ts`), repeater-cell + Problems-panel surfacing, and `previous.<field>` refs. This ADR frames those as the first instances of the model below — and the contract for extending it.

---

## Decision

**D1 — Resolvability is the invariant.** The picker and its validator MUST only surface references that resolve at runtime for the surface being authored. A reference whose path the engine cannot resolve is never *offered*; if *typed*, it is *warned* (non-blocking). This is the trust contract; every other decision serves it.

**D2 — Scope is per-surface and graph-aware; the token shape follows the surface.** A "scope resolver" computes the author-visible reference set for the (surface, location) pair — for flow, by walking the graph (trigger record + ancestor outputs + flow vars + enclosing loop item); for a formula/validation/visibility predicate, the object's own record; for RLS/sharing, `current_user` + record fields. The picker inserts the surface-correct token: **bare or `record.x` in flow conditions, `record.x` elsewhere, `{var}` in templates**. (Flow scope resolution + token shaping is implemented; other surfaces adopt the same resolver interface.)

**D3 — Object-typed references are drillable one level, lazily, schema-driven.** An `object`-typed reference (a `get_record`/`create_record` output, an enclosing `map` item, an object-typed flow variable, the trigger `record`) is expandable to its fields. The object is resolved from the **producing node's `config.objectName`** today (graph-walked), migrating to `outputSchema.objectName` (D6). Expansion is **one level**, **lazy** (fetched on demand), and surfaced as a tree — not a pre-fetched flat list — to stay scalable and quiet.

**D4 — Relationships are a guided fetch, never a lookup dot-walk.** Because the engine does not expand lookups (Evidence), `record.<lookup>.<field>` is **forbidden** from the picker. When an author wants a related record's fields, the picker offers the lookup as a leaf (`record.account`, an id) plus an affordance — *"Account is a related record — add a Get Records step to load it"* — that scaffolds a `get_record` node whose output is then drillable (`account_data.*`). This is the Salesforce-Flow pattern and the only runtime-honest relational story.

**D5 — Validation pairs with the picker and reuses the engine's truth.** Inline validation flags (a) ADR-0032 brace/shape errors (deterministic, scope-free) and (b) scope-aware unknown roots. Its allowlist of "known roots" MUST track the engine's canonical scope roots (`@objectstack/formula packages/formula/src/cel-engine.ts`) rather than a private list, and it MUST skip surfaces/positions where it cannot decide without a fetch (e.g. the start node's bare trigger fields) to keep false positives at zero. Flow-level issues also surface as Problems-panel rows + canvas badges (ADR-0058 fail-policy: authoring-time guidance, non-blocking).

**D6 — `outputSchema` evolves into the authoritative output-typing channel.** Add an optional `objectName` (and array-item type) to `FlowNode.outputSchema` entries so an `object`-typed output can name its object — making D3 work for *any* producer, including connectors and subflows that have no `config.objectName`. Built-in CRUD executors populate it from their `objectName`; the designer prefers `outputSchema.objectName`, falling back to the graph-walk. Until then, D3 runs on `config.objectName`. (Spec change owned by this repo; coordinate the designer change in objectui.)

**D7 — Degrade gracefully, never trap.** Free-text typing always works; an empty/unresolved scope degrades to a plain input; the picker is additive (a `{x}` affordance), never a hard dropdown. Warnings are amber and non-blocking; only the build/agent (ADR-0058) hard-fail.

---

## Roadmap (incremental landing)

- **Slice 0/1 — shipped (objectui #1973–#1981):** flow scope resolution, picker + brace-correct insertion, scope-aware unknown-ref validation (inline + repeater cells + Problems panel), `previous.<field>`.
- **Slice 2 — object-output drilling (next):** D3 on `config.objectName` — offer `account_data.<field>`, `new_opportunity.<field>`, `item.<field>`. Lazy multi-object fetch.
- **Slice 3 — lazy reference tree:** generalise the picker to a type-aware tree; expand any object-typed ref; consume `outputSchema` where present.
- **Slice 4 — guided fetch (D4):** the lookup → "add Get Records" affordance.
- **Slice 5 — generalise beyond flow:** apply the D2 resolver to formula / validation / visibility / sharing authoring surfaces (dotted token shape, `current_user` for RLS).
- **Cross-cutting:** D5 allowlist alignment + D6 `outputSchema.objectName` spec change.

---

## Consequences

**Positive** — authors stop guessing; the brace-in-CEL and silent-typo classes are caught at authoring time; the relational story is *correct* (guided fetch) instead of a footgun; the model generalises to ~50 expression surfaces from one resolver + one picker; the validator stays honest by reusing the engine's roots.

**Negative / cost** — a per-surface scope resolver is more work than a single flat list; lazy multi-object fetching adds designer↔metadata round-trips (mitigated by on-demand + caching); D6 is a coordinated spec change; the guided-fetch affordance (D4) is real UX surface.

**Risks** — (a) drift between the validator allowlist and the engine roots → mitigated by D5 sourcing from `cel-engine.ts`. (b) `outputSchema` left unpopulated by third-party executors → D3 falls back to `config.objectName`, and unknown-type outputs simply aren't drillable (no false offers, per D1). (c) over-eager nesting noise → one level + lazy + search.

---

## Alternatives considered

1. **Auto-expand lookups (`record.account.name`).** Rejected — the engine does not expand lookups (Evidence); every such token would resolve to `undefined`, violating D1. This is the literal #1934 follow-up ask; the investigation that killed it is the reason for this ADR.
2. **Pre-fetch the whole schema graph and show a flat list.** Rejected — N+M fetches on open, hundreds of entries, and still can't represent relationships honestly. The lazy tree (D3) scales and stays quiet.
3. **A private "known globals" allowlist in the validator.** Rejected for the long term — drifts from the engine. D5 reuses `packages/formula/src/cel-engine.ts`.
4. **Designer-only `outputSchema` typing (no spec change).** Rejected as the end state — connectors/subflows have no `config.objectName`; D6 makes typing authoritative and plugin-extensible.

## Open questions

- Should D6's `outputSchema.objectName` also express array-of-object element types (`map`/list outputs) for drilling list items?
- For UI visibility surfaces (action/view/app), is the scope stable enough to resolve client-side, or does it need a server-published context descriptor?
- Does the guided-fetch (D4) scaffold a `get_record` inline, or just deep-link to add one? (UX spike.)
