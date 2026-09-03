# ADR-0032: Expression layer for an AI-authored platform — validate-by-default, schema-aware, one CEL language, no silent failure

**Status**: Accepted — implemented; designer builders pending (objectui) (proposed 2026-06-02 · calibrated 2026-06-12)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0010](./0010-nl-to-flow-authoring.md) + [ADR-0011](./0011-actions-as-ai-tools.md) (AI authoring of metadata — **the design center**), [ADR-0018](./0018-unified-node-action-registry.md) (open action registry), [ADR-0031](./0031-advanced-flow-node-executors-and-dag.md) (structured, statically-analyzable constructs for AI)
**Consumers**: `@objectstack/formula` (CEL engine + stdlib + template interpolation + validator), `@objectstack/spec` (expression-field types + introspection: every `condition`/`guard`/`value`/template field across data / automation / ui / security; the coercion in `shared/expression.zod.ts`), `@objectstack/services/service-automation` (`engine.ts` `evaluateCondition`, `builtin/template.ts`, builtin node executors), `@objectstack/cli` (compile-time validation in `objectstack build`), the **agent tool layer** (an `validate_expression` / schema-introspection tool surfaced to authoring agents), `../objectui` (flow designer condition/template builders)

**Premise**: the platform is **pre-launch** — no production artifacts, no external authors, no back-compat debt. This ADR specifies the **target end-state directly**, with no deprecation path. This window closes at launch; an expression layer is effectively unchangeable once metadata is in the wild.

**Design center**: **the long-term author of every expression is an AI.** That single assumption reorders everything below. You cannot make a generative author incapable of the *first* mistake — it pattern-matches, over-generalizes a syntax it saw work elsewhere, and emits plausible-but-wrong text with full confidence. So the design goal is not "a syntax an AI can't get wrong"; it is **"no mistake survives to runtime, and every mistake comes back to the author as a precise, fixable error."** The spine is a *validate-by-default loop*, not a choice of brackets.

---

## TL;DR

Today the platform exposes **three look-alike syntaxes** for referencing data — bare CEL (`record.amount > 100000`) for predicates, single-brace `{record.name}` for flow node string fields, double-brace `{{record.name}}` for titleFormat/notifications — and when they are mixed up it **fails silently**: a `condition` is typed `string`, any string is coerced to CEL, and a CEL parse/eval error is **swallowed to `false`**. The flow "fires" with `success:true` and does nothing (issue #1491).

For an AI-authored platform the fix is not "pick the right brackets." It is, in priority order:

1. **Validate by default, never fail silently, and feed the failure back to the author** — parse + schema-check every expression at build (and on demand via an agent-callable validator); a malformed expression is a *build error with a fixable message*, never a runtime no-op. **This is the spine.**
2. **Two structurally un-confusable field shapes, with the field's type naming the dialect** — predicates and computed values are whole-field CEL with **no delimiters**; only genuine text uses templates. The #1491 pattern (`{…}` in a condition) then has nowhere to live.
3. **Templates: `{{ }}` holes restricted to field-paths + whitelisted formatters**, with defined value→string semantics; single `{ }` deleted.
4. **Correctness is training data** — remove every anti-pattern from the spec's own examples/skills, ship a golden example set, make the contract self-describing.
5. **One canonical IR**, emitted identically by GUI, SDK, and AI, behind one validator.

Syntax hygiene (`{{ }}`, typed fields) lowers the *rate* of first-pass errors; the validation loop drives the rate of *shipped* errors to ~zero. Both matter; the loop matters more.

## Context — current state (verified 2026-06-02)

This came out of a real incident — issue #1491, *"record-change trigger plugin loads but flows never fire on data writes"* (reported against **7.4.1**, repro app `hotcrm`, flow `lead_assignment`). The reporter observed that `POST /api/v1/data/crm_lead` never stamped `next_followup_date` and **inferred** the flow "never runs" — but they explicitly noted they **could not see any logs** (the CLI forces the kernel logger to `level:'silent'`), so "never runs" was a hypothesis, not a verified fact.

What the incident actually was — established by reproducing it end-to-end against hotcrm's own 7.4.1 packages and artifact:

- **The trigger fires.** With logging restored, the record-change trigger registers and binds all four `record_change` flows, and a write to `crm_lead` calls `automation.execute('lead_assignment')` → `success:true`. The reporter's own evidence corroborates this: object-level L2 hooks (`beforeInsert`) fire on the same REST writes, and the trigger's `afterInsert` hook rides the same `triggerHooks` pipeline. The flow **runs**.
- **But it produces zero effect**, because `lead_assignment`'s `decision`/edge conditions were authored as `'{record.rating} >= 4'`. The single brace makes this **invalid CEL** — CEL reads `{ … }` as a map literal, so it is a parse error (`Expected COLON, got RBRACE`; confirmed against `@objectstack/formula`). `evaluateCondition` returns **`false`** on a non-`ok`/throwing result (verified in 7.4.1 `service-automation/dist`: `if (!result.ok) return false; … catch { return false }`), so **neither branch is taken**, `update_record` never runs, and the SLA field is never stamped — exactly the reported symptom.

**Not the cause (a related but distinct bug):** the throwing-`__require` stub — where an ESM CommonJS `require('@objectstack/formula')` compiled to tsup's throwing stub and made *every* CEL eval throw → `catch → false` → all conditions skip — was a **different** issue (**#1429**, fixed by `a6d4cbb6f`, a static top-level import) and is **already shipped in 7.4.1**. So #1491 on 7.4.1 is the **brace-in-CEL** failure above, not the stub.

**The shared villain** behind both is the same and is the deeper point: a CEL parse/eval failure is **silently swallowed to `false`**. A malformed predicate and an unreachable engine are indistinguishable from "condition not met." For an AI author this is the worst possible property: the agent gets **no signal**, believes it succeeded, and ships a dead flow.

Supporting facts (verified in source):

- **Loose contract + coercion.** `ExpressionInputSchema` (`packages/spec/src/shared/expression.zod.ts#ExpressionInputSchema`) transforms any bare string into `{dialect:'cel', source}`; `flow.zod.ts` only *consumes* it. A `condition: string` is silently treated as CEL with no opportunity to reject a bad form.
- **The spec teaches the bad form.** `packages/spec/src/automation/flow.zod.ts#FlowSchema`'s own `FlowSchema` JSDoc example uses `condition: "{amount} < 500"` / `"{amount} >= 500"` — the **exact single-brace-in-CEL pattern that silently fails**. This is the concrete answer to *"why did the AI write it wrong"*: not a missing skill — an actively wrong authoritative example the model faithfully copied.
- **Three syntaxes coexist, at scale.** Across `../templates` (10 packages, 30 flows): only **6** flow `condition`s, but **191** single-brace `{…}` template usages and **40+** double-brace `{{…}}` (titleFormat/notification). So by volume the dominant expression surface is *interpolation*, not predicates — and the single-brace delimiter is the one that collides with CEL. (Date helpers also split: template `TODAY()`/`NOW()` vs CEL `today()`/`daysFromNow(int)`.)
- **Inconsistent failure policy.** The same evaluation-failure decision is made five different ways: `seed-loader` (loud fail), hook-wrappers (warn + false), rule-validator (warn + skip → null), the engine's formula projection (silent null), flow `evaluateCondition` (silent false). No single declared policy.

## The reframing — for an AI author, the loop is the product

It is tempting to "document the difference" or "pick safer brackets." Both treat the symptom. The defects, ranked by how badly they hurt a *generative* author:

1. **Silent failure is catastrophic for AI.** A human notices "nothing happened" and investigates; an agent records success and moves on. Errors must be loud, located, and returned to the author.
2. **The contract is too loose and mode-ambiguous.** `condition?: string` lets a syntactically illegal predicate serialize, and three look-alike syntaxes invite the over-generalization that is an LLM's single most common failure (it saw `{x}` work in `notify.title`, so it used it in a `condition`).
3. **The canon is wrong.** Whatever the spec/skills show, the model emits. Anti-patterns in examples are training data.
4. **The author can't ask.** An agent that can *introspect* "what dialect does this field expect, what fields/functions are in scope?" and *validate before committing* will self-correct; one that must guess will not.

A low-code expression layer for AI earns its keep by **making mistakes impossible to ship silently** and **making the rule discoverable and checkable at authoring time**. Today it does neither.

## Decision

### 1. Validate by default; never fail silently; built for the agent loop. (**The spine.**)

- **1a — Build-time parse.** `objectstack build` / `registerFlow` / metadata registration **parses every expression**; a parse error is a **build failure** with `file:line` and the offending source. (#1491's `{record.rating} >= 4` fails here instead of becoming a runtime `false`.)
- **1b — Schema-aware.** Expressions are parsed against the target object's field/type environment. v1: **field existence + predicate-returns-`bool`** (`record.raitng` → *"crm_lead has no field `raitng` — did you mean `rating`?"*). v2: full type inference (number-vs-string compares, function overloads).
- **1c — No silent runtime fallback.** Remove every "error → `false`/`null`" swallow. **One declared `EvalResult` policy** replaces today's five: parse failure → build error (1a); runtime fault → **logged, attributed failure** (never a swallowed `false`).
- **1d — Errors written for self-correction.** The message must state *what is wrong* **and** *the correct form*: e.g. *"conditions are bare CEL, not templates — you wrote `{record.rating} >= 4`; use `record.rating >= 4`."* This message contract is tested, not incidental — it is the interface the agent repairs against.
- **1e — Author-accessible validation + introspection.** The same validator is exposed as an **agent-callable tool** (`validate_expression(fieldRole, source, objectName)`), and each field's **expected dialect + in-scope fields/functions are introspectable**. The object **schema is fed into the authoring context**. So the agent checks *while writing*, not only at build — collapsing the correction loop and removing guesswork.

### 2. Two structurally un-confusable field shapes; the field type names the dialect.

- **Expression fields** (predicate, computed value) = **whole-field CEL, no delimiters.** `condition: Predicate`, `dueDate: Expr<Date>`. Never a raw `string`.
- **Text fields** = `Template` (Decision 3).

Rationale (AI-first): the #1 LLM error is *mode over-generalization* — copying `{x}` across fields with different rules. Make the modes **look nothing alike** (no-braces predicate vs `{{ }}` template) and let the **TS type name the dialect** — an in-context signal the model reads directly off the field type. Because predicates contain no braces by construction, the #1491 pattern has nowhere to live; and because the field is typed `Predicate` not `string`, the wrong *shape* is a type error. (Note the division of labor: the type rejects wrong *shape*; Decision 1 rejects wrong *content*. Neither alone is sufficient — together they close both.)

### 3. Text templates: `{{ }}` holes, restricted to paths + formatters, with defined value→string semantics.

- **One delimiter, `{{ }}`; single `{ }` deleted.** `{ }` collides with CEL map literals (the physical #1491 trap); `{{ }}` does not, carries a universal mustache prior (low LLM error), and — decisively for `.ts` authoring — does **not** collide with TypeScript tagged-template `${…}` interception, whereas `${…}` would. A `{{…}}` accidentally pasted into a predicate still fails to parse and is caught loudly by Decision 1.
- **Holes are a restricted CEL subset**: field/variable paths plus a **whitelisted formatter set** (`format`, `datetime`, `currency`, `number`, …) — **not arbitrary CEL logic.** Rationale: a smaller hole grammar is a smaller error surface for AI, lets the GUI offer a field picker, and keeps display strings declarative — real logic is forced back into validated `Predicate`/`Expr` fields where it is visible and checked.
- **Defines value→string semantics** (numbers, dates, money, null, locale) that arbitrary-CEL holes left undefined — formatting is explicit (`{{ currency(record.amount) }}`), not implicit coercion.

### 4. Correctness is training data.

- **Fix the canon first.** Remove every anti-pattern from the spec's own JSDoc (`packages/spec/src/automation/flow.zod.ts`'s `{amount} < 500`), skills, and guides **before** shipping the contract — the model emits what it is shown.
- **Ship a golden example set** per field role (predicate / template / computed value), copy-pasteable and correct, that authoring agents are pointed at.
- **Make the contract self-describing** (Decision 1e) so the agent *discovers* the rule rather than inferring it from priors.

### 5. One canonical IR, three front-ends.

GUI condition/template builders, `.ts` SDK tagged templates (`` cel`…` `` / `` tpl`…` ``), and AI generation all emit the **same canonical Expression IR** (`{ dialect, source, ast? }`) and run through the **same validator**. The surfaces cannot drift; every author — human, dev, LLM — is held to one contract.

## Design judgment (resolving the forks)

- **Looped vs one-shot authoring → design for both.** The validation loop (Decision 1) is the spine and serves agents that can build/iterate; the structural first-pass reductions (Decisions 2–4) keep *one-shot* authoring (NL→flow with no compile loop) safe too. Do **not** rely on the loop alone (fragile when there is none) and do **not** force structured-only authoring (verbose, fights model priors).
- **Predicates stay free-text CEL, not mandatory structured AST.** Models are strong at CEL, and schema-aware validation (1b) makes free text safe. A structured `{field, op, value}` AST remains available as an *alternate serialization* the GUI/one-shot generators may emit into the same IR — offered, not required.
- **Schema-aware depth in v1 = field-existence + bool-return** (highest ROI, needs only the resolved object schema at build). Full type inference is v2.

## Representation / contract summary

| Field role | Author writes | Serialized IR | Validated as |
|---|---|---|---|
| Predicate (`condition`, `guard`, validation, sharing, visibility) | `` cel`record.amount > 1e5` `` (no braces) | `{dialect:'cel', source, ast?}` | parses · returns `bool` · fields exist |
| Computed value (`dueDate`, filter values) | `` cel`daysFromNow(3)` `` (no braces) | `{dialect:'cel', …}` | parses · result type fits field |
| Text template (`notify.title/body`, `titleFormat`, email/notification) | `` tpl`Hot lead: {{ record.full_name }}` `` | `{dialect:'template', source, ast?}` | each `{{…}}` is a path/formatter · fields exist |

Out of scope (separate surfaces, intentionally **not** unified): query-filter operators (`{ field: { $lte: … } }`, MongoDB-style) and cron schedules. "One expression language" means predicates + computed values + template holes resolve to CEL semantics — not literally one syntax for everything.

## Consequences

**Positive**
- Silent failure — the property that is *catastrophic* for an AI author — is gone: parse errors are build failures, runtime faults are loud, and the author gets a fixable message (1a/1c/1d).
- The #1491 mode-confusion pattern is structurally impossible (predicates have no braces) and would also be a type error (Decision 2) and a build error (Decision 1).
- The agent can validate and introspect *before committing* (1e) — the correction loop runs at authoring time, not in production.
- Schema-aware checks raise quality across *all* CEL surfaces (flows, validations, sharing, formula fields), not just flows.

**Costs / risks**
- **Schema-aware validation is real engineering**: the resolved object schema must be projected into a CEL type environment fed to the compiler. Pre-launch is when this is affordable; retrofitting is not.
- **Restricted template holes + a formatter whitelist** is more design work than "interpolate anything," and must cover the real formatting needs (dates/money/percent/locale) or authors hit walls.
- Typed expression fields are more verbose than raw strings (mitigated: `` cel`` `` is terse, and verbosity buys "wrong = compile error").
- The change touches `spec` / `formula` / `service-automation` / CLI / agent-tooling / designer together — must be sequenced as one coherent pre-launch change.

## Sequencing (roadmap, ordered by AI-safety ROI)

1. **Stop the silent failure + fix the canon (ship first, decisive).** One `EvalResult` policy: parse → build error, runtime fault → loud attributed failure; delete every `error→false/null` swallow (`evaluateCondition` + the other four). Simultaneously remove the anti-pattern examples from spec JSDoc/skills (`packages/spec/src/automation/flow.zod.ts`). This alone kills the #1491/#1429 class.
2. **Build-time parse validation + error-message contract.** CLI/registration parses every expression; failures carry `file:line`, source, and the *corrective* message (1d).
3. **Contract/types.** `spec`: expression fields become typed (`Predicate` / `Template` / `Expr<T>`); remove bare-string acceptance + the `packages/spec/src/shared/expression.zod.ts#Predicate` coercion. Land `` cel`` `` / `` tpl`` `` builders. Two shapes, no single brace.
4. **Schema-aware validation (v1)** — project resolved object schema into the CEL type env; field-existence + bool-return. (v2: full type inference.)
5. **Agent tooling** — expose `validate_expression` + field-dialect/scope introspection; feed schema into the authoring context.
6. **Template engine** — `{{ }}` holes (paths + formatter whitelist) with defined value→string semantics; delete the single-brace resolver; unify date helpers under CEL stdlib.
7. **Designer** — GUI condition/template builders emit the canonical IR through the shared validator.

## Non-goals / deferred

- **Mandatory structured/AST authoring** for predicates: rejected — verbose, fights model priors; free-text CEL + schema validation is safe and AST stays available as an option.
- **Arbitrary CEL inside template holes**: rejected — larger error surface, un-pickable in GUI, invites logic-in-display-strings; holes are paths + whitelisted formatters.
- **Replacing CEL** with JS/Power Fx: rejected — CEL is sandboxed, statically checkable, non-Turing-complete, and AI-legible.
- **Unifying query-filter operators / cron** into the expression language: out of scope.

## Open questions (need a decision)

1. **Resolved schema at build time.** 1b's depth depends on whether the build pipeline can obtain the **fully resolved** object schema (post overlay/extension, ADR-0005/0010) at compile time. If only partial schema is available pre-deploy, v1 schema checks may need to run at registration rather than `build`. **Confirm what schema the build has.**
2. **Formatter whitelist surface.** Which formatters ship in v1 (`currency`/`datetime`/`number`/`percent`/`truncate`/…) and how locale is threaded into them — needs a short catalog before the template engine work (step 6).

## Already shipped / observed on this line of work

- **#1429** (`a6d4cbb6f`) fixed the throwing-`__require` stub by switching `service-automation` to a static `import { ExpressionEngine } from '@objectstack/formula'`, and populated `hookContext.previous` for update hooks. **Shipped in 7.4.1.** It removed the *engine-unreachable* runtime fault but left the underlying `catch → false` swallow in place — which is why **#1491** (a malformed predicate on the same swallow) still presents identically. Decision 1 closes the swallow itself.
- `@objectstack/formula` envelope routing exists (`{dialect, source, ast}`), CEL stdlib (`now()`/`today()`/`daysFromNow(int)`/`isBlank`/`coalesce`), and the legacy single-brace template resolver (`service-automation/builtin/template.ts`). This ADR **converges** these onto one language + one delimiter and, more importantly, adds the **validate-by-default loop, schema-awareness, corrective errors, and agent introspection** the current seam lacks.
