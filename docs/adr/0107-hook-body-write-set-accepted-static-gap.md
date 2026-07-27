# ADR-0107: The Hook-Body Write Set Is an Accepted Static-Analysis Gap

**Status**: Proposed (2026-07-27)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove trichotomy — an uncoverable surface is *marked*, never silently assumed covered), [ADR-0072](./0072-reference-scope-and-resolvability.md) (D1 linter trust contract), [ADR-0078](./0078-no-silently-inert-metadata.md) (§4 registration-time diagnostics — deferred, evidence-gated)
**Tracking**: [#3700](https://github.com/objectstack-ai/objectstack/issues/3700) (this decision + the deferred `writes` proposal), [#3583](https://github.com/objectstack-ai/objectstack/issues/3583) (HotCRM reference-integrity audit, category 5b), `docs/audits/2026-07-app-metadata-reference-integrity-assessment.md` §5 D4
**Consumers**: `@objectstack/spec` (`ScriptBodySchema` TSDoc), `content/docs/automation/hook-bodies.mdx`, `@objectstack/lint` (explicitly **no new rule**)

---

## TL;DR

Of the nine HotCRM bug categories (#3583), eight have a static path — lint rules shipped, phased behind the assessment's ratchet, or blocked only on a spec decision (§5 D1/D2 there). The ninth does not and cannot: **a hook body that writes fields its target object doesn't have** (`contact_email` / `contact_phone` in the audit). The write set lives inside `body.source`, an opaque JS string (`packages/spec/src/data/hook-body.zod.ts`); no metadata anywhere declares which fields a hook writes, so there is nothing for a lint to check.

**Decision:** accept the gap and mark it loudly at every surface an author reads (D1); do **not** approximate coverage by guessing at JS source (D2); treat the structured `writes` declaration that *would* close it as a deferred, evidence-gated capability proposal — #3700 — not a lint chore (D3).

## Context

### Why the write side is dark when everything around it is lit

| Surface | Structured? | Static check |
|---|---|---|
| Hook read side — `hook.condition` (CEL) | yes (`ExpressionInputSchema`) | `validate-expressions.ts:255-288` checks fields against the target object(s), incl. array-valued `hook.object` |
| Hook capability side — `body.capabilities` | yes (enum tokens) | declared in metadata; the sandbox enforces at call time |
| Flow write side — `update_record` node `fields` | yes (per-field config) | `validate-readonly-flow-writes`, `validate-flow-template-paths` |
| **Hook write side — assignments inside `body.source`** | **no — opaque `z.string()`** | **none possible** |

The flow rules work *because* flow nodes declare their writes structurally: the rules read node config, not JS. A hook body's writes (`ctx.input.x = …`, `ctx.api.object('y').update(id, { x: … })`) exist only as source text.

### What happens today when a body writes an unknown field

Nothing author-visible, until far too late:

1. The write-path validator skips unknown keys entirely — `validateRecord` walks *declared* fields on insert and `continue`s past unknown keys on update (`packages/objectql/src/validation/record-validator.ts:482-503`). That skip is deliberate PATCH tolerance; it is blind to this class.
2. Unknown-field dropping exists only on the **read** path (the `find`/`findOne` projection filter in `packages/objectql/src/engine.ts`). The write path forwards the hook-mutated payload to the driver untouched.
3. The driver decides the failure mode:
   - **SQL** (`driver-sql`): `formatInput` / `applyWriteColumnMap` pass unknown keys through, the database rejects the statement (`no such column`), and the whole operation fails at runtime — in production, far from the authoring mistake.
   - **Schemaless** (memory, MongoDB): the stray key is stored as-is — the worst outcome, indistinguishable from success (the ADR-0078 asymmetry: an AI author gets a success envelope and reports *done*).

## Decision

### D1 — Accept and mark (the ADR-0049 discipline)

Per the ADR-0049 trichotomy, a surface we cannot enforce is **marked**, never left for authors to assume covered. The gap is documented where authors actually meet it:

- `content/docs/automation/hook-bodies.mdx` — "Not statically checked: the write set" (exactly what is checked, what is not, what happens at runtime, what to do instead);
- `ScriptBodySchema` TSDoc in `packages/spec/src/data/hook-body.zod.ts` — the schema is the contract, and the contract now states its own blind spot;
- the reference-integrity assessment records its open decision D4 as decided.

### D2 — No heuristic source analysis (permanent posture, not a deferral)

We will not regex- or AST-guess the write set out of a Turing-complete body. `ctx.input[computeKey()] = v`, destructuring, aliasing (`const i = ctx.input`), helper indirection — ordinary code defeats the analysis. A partial rule is worse than none: it manufactures the belief that writes are checked, and the ADR-0072 D1 trust contract cuts both ways — false *confidence* is as corrosive as false positives. The assessment already took this posture (§7: "surfaces without structure are marked, not guessed at"); this ADR makes it permanent for hook bodies.

### D3 — The structured `writes` declaration is a capability proposal: deferred, evidence-gated

The only honest closure is contract-first (Prime Directive #12): the author declares the write set, lint verifies the declared fields exist, and the runtime rejects undeclared writes — the exact shape `body.capabilities` already has (declare → lint → sandbox-enforce). That is a genuine spec + runtime capability, not a lint rule:

- new spec surface — `writes` on the body (or hook), with semantics to design for multi-object / `"*"` targets and cross-object write sets;
- runtime enforcement — a write-guard proxy over `ctx.input` plus per-object interception of `ctx.api` writes. Without enforcement the declaration itself would violate ADR-0049 (declared ≠ enforced);
- migration for every existing body.

Deferred until the bug class recurs outside the HotCRM audit — the same evidence gate ADR-0078 §4 applies to registration-time diagnostics, which stay deferred there and are *not* re-decided here. #3700 remains open as the proposal's tracking issue. Per the assessment: "do not let this category stall the other eight" — the proposal must not be smuggled into a lint task.

### D4 — Author guidance (the mitigation that exists today)

- Every field a body assigns must exist on **each** target object (array and `"*"` hooks included). This is an author responsibility; no tool has your back here.
- When the write set is fixed, prefer a **flow `update_record` node** — structural `fields` get the static checking hook bodies can't.
- Exercise the hook against a real object before shipping: SQL drivers surface the mistake on first write; schemaless drivers won't.

## Consequences

- **Positive.** All nine HotCRM categories now carry an explicit disposition — eight checkable, one marked. An author reading the hook-body docs or the schema learns the exact boundary of static coverage instead of assuming lint sees everything. The `writes` proposal keeps a clean runway: capability-shaped, evidence-gated, undiluted by a rushed approximation.
- **Negative.** The gap stays real: a typo'd write still ships silently on schemaless drivers and fails late on SQL. Accepting it means HotCRM-class write bugs remain possible until (and unless) #3700's proposal earns its evidence.

## Non-goals

- **Any lint rule over `body.source` write patterns** — including a "best effort" one (D2).
- **Deciding the `writes` proposal.** This ADR only routes it: #3700, deferred, evidence-gated.
- **Registration-time dev diagnostics** — already deferred by ADR-0078 §4; unchanged here.
- **Field-level write authorization.** FLS / readonly enforcement (`stripReadonlyFields`, permission `editable` bits) governs *permitted* fields — a different axis from *existing* fields; untouched.
