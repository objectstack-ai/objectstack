# ADR-0058: The Expression & Predicate Surface — One Authoring Language, Two Backends, and the Pushdown-Compiler Reconciliation (#1887)

**Status**: Accepted (2026-06-21) — implemented: canonical CEL→Filter compiler (`formula/src/cel-to-filter.ts`), RLS + sharing cutover (`rls-compiler.ts`, `bootstrap-declared-sharing-rules.ts`), `check` enforced on writes, expression-surface conformance ledger CI-gated (`dogfood/test/expression-conformance.ledger.ts`).
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (runtime proof), [ADR-0055](./0055-master-detail-controlled-by-parent.md) (RLS reuses pre-resolved membership IN-form; **no compiler subquery**), [ADR-0056](./0056-permission-model-landing-verification.md) (permission-model landing), [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (ERP authz core)
**Consumers**: `@objectstack/formula`, `@objectstack/objectql`, `@objectstack/plugin-security`, `@objectstack/plugin-sharing`, `@objectstack/service-analytics`, `@objectstack/service-automation`, `@objectstack/spec`, `@objectstack/verify`
**Closes / supersedes**: issue #1887 (SharingRuleSchema disconnected from the live engine). Reconciles ADR-0056 **D4/D5** (RLS no-silent-drop / sharing spec↔runtime) and ADR-0057 **D6** (declared-rule seeding, deferred CEL compiler).

---

> **Addendum (2026-07, #3278) — the `js` expression dialect is retired.**
> The Pass-3 inventory and the Decision below list `js` among the expression
> dialects (`{cel, js, cron, template}`). In practice `js` was only ever a
> declared enum member and a registry *stub* — no engine, and no author helper
> ever emitted it (`cel`/`F`/`P` → CEL, `tmpl` → template, `cron` → cron). Per
> ADR-0049 (enforce-or-remove), it is removed from `ExpressionDialect`; the set
> is now `{cel, cron, template}`. Procedural JavaScript remains available as the
> **L2** authoring surface — the sandboxed, capability-gated
> `ScriptBody { language: 'js' }` in hook/action bodies — which is a separate
> enum and is unaffected. This also fixed a latent `hasDialect` bug that
> reported the stub as a real engine.

---

## TL;DR

ObjectStack exposes **~50 authorable declarations** that hold an expression — formulas, visibility/required/readonly predicates, validation rules, hook conditions, flow/edge conditions, sharing-rule conditions, RLS `using`/`check`, action/view/app visibility, notification/ETL/export/sync/connector conditions — and they all funnel through **one authoring primitive** (`ExpressionInputSchema` → `{ dialect: 'cel', source }`, helpers `cel`/`F`/`P`). The authoring surface is already unified and clean.

The **runtime** is not. There are **two evaluation backends**:

1. **Interpret-against-a-record** — one rich, correct CEL interpreter (`@objectstack/formula` `cel-engine.ts`, wrapping `@marcbachmann/cel-js`: full operators/functions/macros/temporal). ~40 surfaces use it and are honestly enforced.
2. **Compile-to-a-query-filter** (pushdown) — **fragmented into three divergent, hand-rolled front-ends that do NOT share the interpreter's AST**: a 4-form regex (`rls-compiler.ts`), a field-equality-only translator (`celToFilter` in sharing seeding), and a rich `FilterCondition`→SQL *backend* (`read-scope-sql.ts`) that the front-ends barely reach.

The fragmentation is the root of the platform's predicate-honesty debt: the spec's CEL sharing-rule `condition` is **never compiled** (#1887 — "authoring a rule does NOT grant access"), the RLS `check` clause is **declared but unenforced**, and identical CEL means different things depending on which surface evaluates it. On top of that, the **silent-fail policy is inconsistent** across surfaces (formula → silent `null` *unlogged*; hook → `false`; validation → skip; flow → throw; RLS → drop+warn/deny; sharing → silent empty).

This ADR is the **whole-surface audit + consolidation** (the expression-layer analogue of ADR-0056's permission-model landing). It decides: **one canonical CEL→`FilterCondition` pushdown compiler built on the interpreter's AST** (retiring the regex + `celToFilter`), the **supported pushdown subset** (reaching the existing rich SQL backend; no subqueries per ADR-0055), the **reconciliation of sharing `condition` (#1887) and RLS `check`**, a **single fail-policy matrix** (compile-error at authoring / fail-closed for security / fail-soft-but-logged for non-security), and a **durable Expression Surface Conformance ledger** so the surface stays landed. Non-expression experimental subsystems (encryption/masking/compliance/policy/audit/runAs/transfer) remain under ADR-0056 D8 — referenced, not re-decided.

---

## Context

### The model, in one picture

```
                 ┌──────────────────────────────────────────────┐
   AUTHORING     │ ExpressionInputSchema → { dialect:'cel', source } │   one language (CEL),
   (~50 decls)   │ helpers: cel / F(ormula) / P(redicate) / tmpl / cron │   ~50 declarations
                 └──────────────────────────────────────────────┘
                                     │
              ┌──────────────────────┴───────────────────────┐
              ▼                                               ▼
   ① INTERPRET per record                          ② COMPILE to query FILTER (pushdown)
   @objectstack/formula cel-engine.ts               (fragmented — the problem)
   (@marcbachmann/cel-js, FULL CEL)                  ├─ rls-compiler.ts   (regex, 4 forms)
   ~40 surfaces, honestly enforced                   ├─ celToFilter       (field-equality only)
   formula / visibility / validation /               └─ read-scope-sql.ts (rich FilterCondition→SQL
   hook / flow / notification / UI / ETL …              BACKEND — under-reached by the front-ends)
              │                                               │
              ▼                                               ▼
   native JS value (boolean / value)                driver WHERE / SQL (no subquery, ADR-0055)
```

The **authoring** side and **backend ①** are good. The debt is entirely in **backend ②** being three disconnected front-ends that don't reuse the parser/AST of ①.

### Pass 1 — the compile-to-filter surface (evidence)

| Compiler | File | Grammar it accepts | Uncompilable → |
| :-- | :-- | :-- | :-- |
| RLS compiler | `plugin-security/src/rls-compiler.ts` | **4 regex forms only**: `1=1`, `f = current_user.x`, `f = 'lit'`, `f IN (current_user.arr)` | drop **+ WARN** (ADR-0056 D4); deny if it was the only policy |
| Sharing `celToFilter` | `plugin-sharing/src/bootstrap-declared-sharing-rules.ts` | **field-equality only** `record.f == literal` | **skip rule** (logged `[experimental]`) |
| Read-scope SQL | `service-analytics/src/read-scope-sql.ts` | **rich**: `$eq/$ne/$gt/$lt/$gte/$lte/$in/$nin/$between/$contains/…/$and/$or/$not` | **throw** (fail-closed) |

Critical: the analytics path proves a **rich `FilterCondition`→SQL backend already exists** — the missing piece is a CEL→`FilterCondition` *front-end* that reaches it. The RLS regex and `celToFilter` are the under-powered front-ends. They share no code with each other or with the interpreter.

Two declared-but-unenforced gaps fall out:

- **Sharing-rule `condition` (#1887)** — spec `CriteriaSharingRuleSchema.condition: ExpressionInputSchema` (CEL), but the runtime matches `sys_sharing_rule.criteria_json` (a JSON `FilterCondition`); the CEL is **never compiled** except the field-equality subset ADR-0057 D6 added at seeding. Spec self-flags `⚠️ EXPERIMENTAL — NOT ENFORCED`.
- **RLS `check` clause** — `rls.zod.ts` declares `check` for INSERT/UPDATE validation; **zero runtime consumers** read it (only `using` is compiled). Declared-but-unenforced (ADR-0049).

### Pass 2 — the interpret-against-a-record surface (evidence)

One interpreter: `@objectstack/formula` `cel-engine.ts` (`@marcbachmann/cel-js`), full CEL with bounded execution. Its `~40` consumers are honestly enforced — but each invents its **own fail policy**:

| Surface | File | Fail-on-unparseable |
| :-- | :-- | :-- |
| Flow / edge / decision condition | `service-automation/engine.ts` | **THROW** (loud) |
| Hook lifecycle `condition` | `objectql/hook-wrappers.ts` | **→ false** (logged) |
| Validation (`script`/`cross_field`/`when`/`requiredWhen`/`readonlyWhen`) | `objectql/validation/rule-validator.ts` | **skip** rule (logged) |
| Formula field (`Field.expression`) | `objectql/engine.ts` applyFormulaPlan | **→ null, NOT logged** |
| Seed dynamic value | `objectql/seed-loader.ts` | **error, drop record** (loud) |

The interpreter and the RLS compiler **share no grammar or AST** — confirmed. CEL `record.amount > 1000` works in a hook/flow/formula but is *silently inexpressible* in an RLS `using` or a sharing `condition`.

### Pass 3 — the spec declaration inventory (evidence)

`ExpressionInputSchema` (`spec/src/shared/expression.zod.ts`): a bare string `.transform(s => ({ dialect:'cel', source:s }))`; the canonical envelope is `{ dialect, source, ast?, meta? }`, `dialect ∈ {cel, js, cron, template}` (the `js` slot was a declared-but-unshipped stub — **retired in #3278**, see Addendum above). Helpers `cel`/`F`/`P` all emit CEL; `tmpl` → Mustache; `cron` → cron. **~50 declarations** consume it (formula, `visibleWhen`/`readonlyWhen`/`requiredWhen`, validation, hook, flow edge, action `visible`/`disabled`, view/app/page visibility, notification condition/recipients, ETL/export/sync/connector/graphql conditions, feature flags, cache invalidation, …).

Of these, the **expression-surface experimental/divergent set** is exactly two: **sharing `condition`** (#1887) and **RLS `check`**. The rest of the `EXPERIMENTAL — not enforced` markers (`PolicySchema` password/network/session/audit, `EncryptionConfig`, `MaskingRule`, GDPR/HIPAA/PCI, `SecurityContext`, `RLSAuditEvent`, `RLSConfig`, flow `runAs`, `allowTransfer/Restore/Purge`) are **whole subsystems with no runtime consumer** — already governed by **ADR-0056 D8 / ADR-0049** and **out of scope here** (they are not predicate-compiler problems).

---

## Decision

Governing rules: ADR-0049 (enforced / `experimental` / removed), ADR-0054 (proof per enforced high-risk surface), ADR-0055 (pushdown is pre-resolved `IN`-form, **never** compiler subqueries). One decision per gap.

### D1 — One canonical CEL→`FilterCondition` pushdown compiler, on the interpreter's AST

Build a single **pushdown compiler** in `@objectstack/formula` (next to the interpreter) that takes the **same parsed `@marcbachmann/cel-js` AST** the interpreter uses and lowers the pushdown-able subset to a `FilterCondition`. It **replaces** both `plugin-security/rls-compiler.ts`'s 4-form regex and `plugin-sharing`'s `celToFilter`. There is then exactly **one** CEL parser and **one** CEL→filter lowering, feeding the existing rich `FilterCondition`→SQL backend (`read-scope-sql.ts`).

- No more bespoke regex grammars; no more "this surface understands a different CEL subset than that one."
- The compiler is **pure** (AST → `FilterCondition`), driver-agnostic, and unit-testable without a kernel.

### D2 — The supported pushdown subset (and "non-pushdownable = compile error")

The compiler supports the subset the `FilterCondition`→SQL backend already handles: `==`, `!=`, `>`, `<`, `>=`, `<=`, `in`/`IN`, `not in`, `&&`/`AND`, `||`/`OR`, `!`/`NOT`, null/exists checks, and string ops (`contains`/`startsWith`/`endsWith`). Operands: a record field on one side; on the other a literal, a `current_user.*` scalar, or a pre-resolved `current_user.<key>` set (`rlsMembership`, ADR-0055).

- **No subqueries / no cross-object traversal** (ADR-0055 stands) — set membership comes from pre-resolved `current_user.*` keys.
- A predicate on a **compile surface** (RLS `using`/`check`, sharing `condition`, analytics read-scope) that the compiler cannot lower is an **authoring-time compile error** (`objectstack compile` / `defineStack`), never a silent drop or "matches nothing" (ADR-0056 D4 generalized to all pushdown surfaces). The error names the unsupported node and, where applicable, suggests the pre-resolved-`IN` rewrite.

### D3 — Reconcile sharing rules (close #1887)

With D1/D2, the spec sharing-rule **`condition` (CEL) is compiled** to `criteria_json` via the canonical compiler at seed/define time — no longer field-equality-only. The `sys_sharing_rule` runtime shape stays canonical (storage), but it becomes a **faithful lowering of the authored CEL**, not a divergent hand-write. `owner`-type rules and dynamic recipients (`role_and_subordinates`→`unit_and_subordinates`, ADR-0057 D5) reconcile to the recipient model; truly non-static cases (e.g. ownership that depends on live role membership) resolve via the **pre-resolved `current_user.*` membership** form, not a stored static filter. The spec's `⚠️ EXPERIMENTAL — NOT ENFORCED` block on `SharingRuleSchema` is removed once the compiler lands; remaining unmappable recipients (`group`/`guest`) are explicitly `[experimental]` or removed per ADR-0049 — no third "looks-authorable-but-isn't" state.

### D4 — Enforce RLS `check` (write-side validation)

Compile the RLS **`check`** clause (defaulting to `using` when omitted) with the same canonical compiler and enforce it on the **write pre-image path** that already exists for by-id writes (ADR-0056/`#1994`) and on the AST-injected bulk path. A `check` that the compiler cannot lower is a compile error (D2). This closes the declared-but-unenforced `check` gap (ADR-0049).

### D5 — One fail-policy matrix for the whole expression surface

Today each surface invents its own behavior. Standardize on **three tiers keyed by (when) × (security-relevance)**:

| When / what | Policy |
| :-- | :-- |
| **Authoring (any surface)** — parse error, unknown function/var, type error | **compile error** (`objectstack compile` / `defineStack`) — never ships |
| **Authoring (compile surface)** — valid CEL but not pushdown-able | **compile error** (D2) — never silently degrades |
| **Runtime, SECURITY predicate** (RLS `using`/`check`, sharing) | **fail CLOSED** — deny / empty-visible, never over-share; logged WARN with the policy name |
| **Runtime, NON-security predicate** (formula, validation, hook, visibility, flow) | **fail soft, ALWAYS logged** — formula → `null` **+ log** (fixes today's silent-null), validation → skip **+ log**, hook → `false` **+ log**, flow → throw (author bug) |

This keeps the deliberate "a broken non-security rule must not brick CRUD" posture, but **removes the two honesty holes**: the formula's *unlogged* `null` and the sharing-rule's *silent empty* on a criteria query failure both become logged, and security predicates are uniformly fail-closed.

### D6 — One AST, two backends; mode is a property of the surface

A declaration's **evaluation mode is fixed by its surface**, not guessed: RLS `using`/`check`, sharing `condition`, and analytics read-scope are **compile** (pushdown) surfaces; everything else is **interpret** (per-record). Both backends consume the **same parsed AST**. There is **no silent fallback** from compile to interpret — a compile-surface predicate that needs interpretation (non-pushdownable) is a D2 compile error, surfaced to the author, not silently evaluated row-by-row (which would defeat pushdown / leak via N+1).

### D7 (durable) — The Expression Surface Conformance ledger

Extend the ADR-0056 D10 conformance concept and the ADR-0054 proof registry to the expression surface: **one row per expression-holding declaration**, carrying `{ field-path, dialect, mode (interpret|compile), evaluator site (file:line), state (enforced|experimental|removed), fail-policy, proof-ref? }`. CI asserts: every `ExpressionInputSchema` declaration is classified; every **compile**-mode declaration is reachable by the canonical compiler (no orphan pushdown surface); every enforced security expression carries a dogfood proof. "The expression surface is landed" becomes a green check; a new declared-but-unenforced predicate (the #1887 class) breaks the build. This is the durable deliverable — the audit, encoded.

### D8 — Scope boundary

This ADR governs the **expression / predicate / formula surface** only. The non-expression `[EXPERIMENTAL — not enforced]` subsystems (PolicySchema, Encryption, Masking, Compliance, SecurityContext, RLSAuditEvent, RLSConfig, flow `runAs`, allowTransfer/Restore/Purge) remain under **ADR-0056 D8 / ADR-0049** and their own tracking issues (#1882/#1883/#1888). They are referenced here for completeness, **not re-decided**.

---

## Consequences

**Positive.**
- **One CEL** means one thing everywhere — a predicate that works in a hook/formula compiles to the same semantics in an RLS/sharing filter (within the pushdown subset), so authors (and the AI) stop hitting "silently does nothing here" surprises.
- **#1887 closes honestly** — sharing `condition` is enforced as authored, not a divergent hand-write; RLS `check` is enforced.
- **No fragmented grammars** — the regex front-ends die; one tested compiler feeds the already-rich SQL backend.
- **AI-safe** — every pushdown predicate either compiles or errors at authoring time; no silent fail-open, formula failures are observable, security predicates fail closed.
- **Self-verifying** (D7) — a new unenforced predicate breaks CI, not production.

**Negative / costs.**
- The canonical compiler is **security-critical** (a wrong lowering = wrong enforcement) — it must land with adversarial dogfood proofs (ADR-0054) and a thorough operator/variable test matrix.
- Making non-pushdownable compile surfaces a **hard error** is mildly behavior-changing for any existing config that authored an un-lowerable RLS/sharing predicate and silently got "nothing" — those now fail the build (intended; that is the #1887 disease surfacing). Provide a clear error + the pre-resolved-`IN` rewrite path.
- Standardizing fail-policy touches several runtimes (formula/validation/hook/sharing) — small but cross-cutting.

**Neutral / open.**
- Whether the canonical compiler lives in `@objectstack/formula` (next to the interpreter, sharing the AST — recommended) or a thin `@objectstack/formula/compile` subpath.
- Whether to keep `read-scope-sql.ts` as the sole `FilterCondition`→SQL lowering or fold it into the driver layer — out of scope.

## Non-goals

- **Not** replacing the CEL interpreter or the source language — CEL + `ExpressionInputSchema` stay; this unifies the *compile* path to match the *interpret* path.
- **Not** adding subqueries / cross-object joins to RLS (ADR-0055 stands; pushdown uses pre-resolved `IN`).
- **Not** designing the non-expression governance subsystems (D8 scopes them out).
- **Not** a new dialect — `js`/`cron`/`template` dialects are unaffected. _(Amended #3278: the `js` expression dialect was subsequently retired — see Addendum above; `cron`/`template` stand.)_

## Alternatives considered

- **(a) Leave three front-ends, just extend each.** Rejected — perpetuates "different CEL subset per surface", the exact root of #1887; triples the test surface; no shared AST.
- **(b) Interpret everything per-record (drop pushdown).** Rejected — N+1 / full-scan for RLS/sharing/analytics; defeats driver pushdown; ADR-0055's whole point is set-membership pushdown.
- **(c) Make sharing `condition` a stored JSON filter (drop CEL there).** Rejected — splits the authoring language (CEL everywhere except sharing); the unified `ExpressionInput` surface is a strength to preserve.
- **(d, chosen) One AST, two backends; one canonical pushdown compiler + conformance ledger.**

## Phasing (each independently shippable, each with proofs)

- **P1 — Canonical compiler (no behavior change).** Build the CEL→`FilterCondition` compiler on the cel-js AST; cover the D2 subset; unit-test the operator/variable matrix. Land behind the existing call sites (parity with the 4-form regex first).
- **P2 — Cut over + fail-policy.** Replace `rls-compiler.ts` regex and `celToFilter` with the compiler; D5 fail-policy (compile-error on non-pushdownable; formula/sharing logging fixes). Dogfood: RLS `using` with `>`/`AND`/`OR` now enforces; uncompilable predicate is a compile error.
- **P3 — Close #1887 + RLS `check`.** D3 sharing `condition` compiled end-to-end; D4 `check` enforced on the write path. Remove the `EXPERIMENTAL` markers; dogfood proofs (sharing rule with a real `>`/`IN` condition grants/denies; `check` blocks an invalid write).
- **P4 — D7 conformance ledger.** Expression Surface Conformance rows + CI gate; bind the enforced security-expression proofs.

## References

- ADRs: 0049, 0054, 0055, 0056, 0057. Issues: #1887 (sharing CEL divergence), #1888 (flow runAs), #1882 (policy), #1883 (transfer/restore/purge).
- Authoring primitive: `packages/spec/src/shared/expression.zod.ts` (`ExpressionInputSchema`, `cel`/`F`/`P`/`tmpl`/`cron`).
- Interpreter: `packages/formula/src/cel-engine.ts` (`@marcbachmann/cel-js`).
- Compile-to-filter front-ends: `packages/plugins/plugin-security/src/rls-compiler.ts`, `packages/plugins/plugin-sharing/src/bootstrap-declared-sharing-rules.ts` (`celToFilter`); rich backend: `packages/services/service-analytics/src/read-scope-sql.ts`.
- Divergent declarations: `packages/spec/src/security/sharing.zod.ts` (`condition`, EXPERIMENTAL block), `packages/spec/src/security/rls.zod.ts` (`using`/`check`).
- Silent-fail sites: `objectql/src/engine.ts` (formula null), `objectql/src/hook-wrappers.ts` (hook false), `objectql/src/validation/rule-validator.ts` (skip), `plugin-sharing/src/sharing-rule-service.ts` (silent empty), `service-automation/src/engine.ts` (throw).
