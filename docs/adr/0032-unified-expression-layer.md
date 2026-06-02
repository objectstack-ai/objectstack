# ADR-0032: Unified expression layer — one language (CEL), typed envelopes, build-time validation, no silent failure

**Status**: Proposed (2026-06-02)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0010](./0010-nl-to-flow-authoring.md) + [ADR-0011](./0011-actions-as-ai-tools.md) (AI authoring of metadata — **the design center**), [ADR-0018](./0018-unified-node-action-registry.md) (open action registry), [ADR-0031](./0031-advanced-flow-node-executors-and-dag.md) (structured, statically-analyzable constructs for AI)
**Consumers**: `@objectstack/formula` (CEL engine + stdlib + template interpolation), `@objectstack/spec` (`automation/flow.zod.ts` `ExpressionInputSchema`, every `condition`/`guard`/`value`/template field across data / automation / ui / security), `@objectstack/services/service-automation` (`engine.ts` `evaluateCondition`, `builtin/template.ts`, builtin node executors), `@objectstack/cli` (compile-time validation in `objectstack build`), `../objectui` (flow designer condition/template builders)

**Premise**: the platform is **pre-launch** — no production artifacts, no external authors, no back-compat debt. This ADR therefore specifies the **target end-state directly**, with no deprecation path. This window closes at launch; an expression layer is effectively unchangeable once metadata is in the wild.

---

## TL;DR

The platform today exposes **three syntaxes** for referencing the same data, each with a different rule, and **fails silently** when they are mixed up:

1. **Bare CEL** — `record.amount > 100000` — for predicates (`condition` / `guard` / validation / sharing).
2. **Single-brace template** — `{record.name}`, `{TODAY() + 90}` — for flow node string fields (`notify.title`, `create_record.fields`, `get_record.filter`).
3. **Double-brace mustache** — `{{record.name}}` — for `Object.titleFormat` and notification templates.

These are easy to confuse and **nothing stops the confusion**: a `condition` is typed `string`, any string is silently coerced to `{dialect:'cel'}`, and a CEL parse/eval error is **swallowed and returned as `false`**. A flow then "fires" with `success:true` and does nothing.

This ADR collapses the three syntaxes into **one expression language (CEL)** with exactly **two field shapes** — a **Predicate** (bare CEL → bool) and a **Template** (a string with `{{ CEL }}` interpolation holes) — makes every expression field a **typed envelope** (never a raw `string`), and **validates every expression at build time against the object schema**, deleting the silent-failure path entirely.

The deciding lens, as in ADR-0010/0011/0031, is **AI/pro-code authoring**. When LLMs and `.ts` are first-class authors, correctness must come from **types that make the wrong thing unrepresentable** and **loud compile-time errors**, not from documentation the author may not read.

## Context — current state (verified 2026-06-02)

This ADR is motivated by issue #1491, where record-change flows **loaded but never fired** on data writes — reproduced even with the **condition omitted**. The committed fix (static `import` of `@objectstack/formula` in `service-automation/engine.ts`, replacing a CJS `require` that bundled to a throwing tsup `__require` stub — see the comment at `engine.ts:11`) traced the symptom to the formula engine **throwing on every CEL evaluation**, which `evaluateCondition`'s `catch → return false` silently converted into "start condition not met → flow skipped, `success:true`." Every flow skipped; no error, no warning, nothing in any log. **That silent `catch → false` is the disease this ADR targets** — it turned an unrelated bundling fault into an invisible, platform-wide no-op.

The same silent path also swallows a **second, independent hazard** that the contract (not just the bundling) must fix: **single-brace template syntax colliding with CEL**. Tracing it end to end:

- **Coercion.** `ExpressionInputSchema` (defined in `spec/shared/expression.zod.ts:84`, consumed by `automation/flow.zod.ts`) turns any bare string into `{dialect:'cel', source}`. So a condition like `'{record.rating} >= 4'` is evaluated **as CEL**.
- **Collision.** CEL reads `{ … }` as a **map literal**, so `{record.rating}` (no `:`) is a parse error (`Expected COLON, got RBRACE`). The single-brace template delimiter **directly collides** with CEL syntax.
- **Silent failure (again).** `engine.ts evaluateCondition` returns **`false`** on parse/eval error (`engine.ts:1456`, and the bare `catch { return false }` at `1458`). The `decision` node would take no branch, the flow would end ~1ms `success:true`, and downstream nodes would never run — the *same* invisible failure mode as #1491.
- **The anti-pattern is even taught in-spec.** `automation/flow.zod.ts:213-214`'s own JSDoc example uses `condition: "{amount} < 500"` — the exact single-brace form that silently evaluates to `false`. The hazard is not hypothetical; the reference docs demonstrate it.
- **Two template engines already exist.** `service-automation/builtin/template.ts` interpolates **single** `{…}` (`{var}`, `{record.x}`, `{$User.Id}`, `{NOW()}`, `{TODAY()+N}`) for flow node fields; `Object.titleFormat` / notification templates use **double** `{{…}}` mustache. CEL date helpers are **lowercase** `today()` / `daysFromNow(int)`; the template engine uses **uppercase** `TODAY()` / `NOW()`. Same intent, three spellings.

Why an AI (and a human) writes it wrong: the author sees `{record.name}` work in `notify.title` and **over-generalizes** the single-brace syntax to the condition — a natural inference the platform does nothing to block, and whose failure is invisible.

The current docs/skills state "conditions are CEL" but contain **no** anti-pattern callout, **no** note that braces are template-only, and **no** mention that invalid conditions silently become `false`. The gap is structural, not a doc omission.

## The reframing — the problem is the contract, not "CEL vs template"

It is tempting to "just document the difference" or "add a lint." That treats the symptom. The actual defects are:

1. **The contract is too loose.** `condition?: string` lets you serialize a syntactically illegal predicate. The type system *permits the bug*.
2. **Failure is silent and at the wrong time.** Errors vanish at runtime instead of surfacing at authoring/build time — the cardinal sin for a low-code platform.
3. **Three syntaxes** for "reference a field," one of which (`{…}`) is *actively hostile* because it collides with the expression language.
4. **The author is increasingly an LLM.** The serialized format is now an LLM-facing API. It must be **LLM-safe**: one obvious way, types that reject the wrong way, precise errors that enable self-correction.

A low-code expression layer earns its keep by making **illegal states unrepresentable** and **catching errors where they are authored**. Today it does neither.

## Decision

### 1. One expression language: CEL. Templates are not a second language.

There is exactly one expression language — **CEL**. A "template" is **not** a separate language; it is a **string literal with `{{ CEL }}` interpolation holes**, where each hole contains an ordinary CEL expression.

```ts
condition: cel`record.rating >= 4`                       // Predicate — bare CEL → bool
title:     tpl`Hot lead: {{ record.full_name }}`          // Template — string + CEL holes
dueDate:   cel`daysFromNow(3)`                            // Computed value
filter:    { end_date: { $lte: cel`daysFromNow(int(currentContract.renewal_notice_days))` } }
```

Consequences: "reference this field" is always `record.x` / `previous.x` / `<var>.x`. The `TODAY()` vs `today()` split disappears — it is always CEL's `today()`. There is one parser, one stdlib, one type system, one doc.

### 2. One interpolation delimiter: `{{ }}`. Single `{ }` is removed.

All template interpolation uses **`{{ … }}`**. Single-brace `{…}` is **deleted** from the template engine. Rationale: `{…}` collides with CEL map-literal syntax (the physical cause of #1491); `{{…}}` does not. A template accidentally pasted into a predicate (`cel\`{{record.x}} ...\``) still fails to parse — and is then caught loudly by Decision 4, not silently swallowed. Three syntaxes collapse to **one language + one delimiter**.

### 3. Expression fields are typed envelopes, never raw `string`.

Every expression-bearing field is a **typed Expression envelope**, constructed only via the SDK tagged templates (or the GUI, see Decision 6) — never a bare `string`:

- Predicate field → `Predicate` (CEL constrained to return `bool`).
- Template/text field → `Template` (string-with-`{{CEL}}`-holes).
- Computed value field → `Expr<T>` (or `T | Expr<T>` where a literal is also valid).

The canonical serialized form remains the existing envelope `{ dialect, source, ast? }`. The change is that the spec **stops accepting bare strings** for these fields: `condition: string` becomes `condition: Predicate`. The #1491 line `condition: '{record.rating} >= 4'` then **fails type-checking** — correctness comes from the type, not from a reader noticing a doc.

### 4. Zero silent failure: validate at build time, delete the fallback-to-false path.

Two complementary halves, catching two distinct failure modes:

- **Build-time validation.** `objectstack build` (and `registerFlow` / metadata registration) **parses and validates every expression**, failing with a precise source location on any error. This catches the *malformed-expression* class — e.g. the single-brace `{amount} < 500` would fail `objectstack build` at the offending line instead of silently becoming `false` at runtime.
- **No silent runtime fallback.** The **"eval error → return false"** branch in `evaluateCondition` (`engine.ts:1456`/`1458`) is **removed** — it does not exist in the target design. This catches the *runtime-fault* class — e.g. the #1491 bundling fault, where the engine itself threw at runtime on valid expressions, surfaces **loudly** instead of as an invisible platform-wide no-op. (Build-time validation alone would *not* have caught #1491, because the expressions were syntactically valid; the silent `catch` is what hid it.)

One policy, repo-wide. Today the silent/inconsistent handling is not confined to `evaluateCondition`: the same `EvalResult` is treated five different ways — `seed-loader.ts` fails **loud** (flips `success:false`), `hook-wrappers.ts` warns + treats as **false**, `rule-validator.ts` warns + **skips** (returns `null`, fail-open), `engine.ts` formula projection writes **`null`** with no log, and flow `evaluateCondition` returns **`false`** with no log. The target is a **single, declared failure policy** applied at every expression call site, not five ad-hoc ones.

### 5. Schema-aware validation — the greenfield payoff.

The CEL compiler is fed the **object schema as its type environment**, so build-time validation is not merely syntactic:

- `record.raitng` → *"crm_lead has no field `raitng` — did you mean `rating`?"*
- predicate not returning `bool`, or `amount` (number) compared to a string → **type error**.

This is the line between a serious low-code platform (Salesforce / Airtable formula editors type-check live) and a string-eval toy. It is **especially valuable for AI authors**: a precise, located error closes the self-correction loop. Retrofitting schema-aware checking after launch is prohibitively expensive; pre-launch is the only economical moment.

### 6. One canonical IR, three front-ends.

The GUI flow/condition builder, the `.ts` SDK tagged templates, and AI generation all emit the **same canonical Expression IR** and run through the **same validator**. One language, one IR — the GUI and pro-code surfaces cannot drift, and any author (human, dev, LLM) is held to the same contract.

## Representation / contract summary

| Field role | Author writes | Serialized envelope | Validated as |
|---|---|---|---|
| Predicate (`condition`, `guard`, validation, sharing) | `` cel`record.x > 1` `` | `{dialect:'cel', source, ast?}` | parses + returns `bool` + fields exist |
| Template (`notify.title/body`, `create_record.fields`, titleFormat, notification) | `` tpl`...{{ record.x }}...` `` | `{dialect:'template', source, ast?}` | every `{{…}}` hole parses as CEL + fields exist |
| Computed value (`dueDate`, filter values) | `` cel`daysFromNow(3)` `` | `{dialect:'cel', …}` | parses + result type compatible with field |

Reserved for future dialects (`sql`, `cron`) via the same envelope; CEL is the default and overwhelmingly dominant.

## Consequences

**Positive**
- The malformed-expression class (single-brace, bad field refs) becomes **unrepresentable** (type error) or **caught at build** (validator); the runtime-fault class (the actual #1491 bundling failure) surfaces **loudly** instead of as a silent no-op. Neither can produce an invisible `success:true` again.
- One mental model for every author; the format is LLM-safe and LLM-self-correcting.
- Schema-aware errors raise authoring quality across *all* CEL surfaces (flows, validations, sharing, formula fields), not just flows.

**Costs / risks**
- Tagged-template envelopes are more verbose than raw strings. Mitigation: `` cel`` `` is terse; AI handles it trivially; the trade buys "wrong = compile error."
- **Schema-aware checking is real engineering**: the object schema must be projected into a CEL type environment fed to the compiler. Greenfield is when this is affordable.
- The `{{CEL}}` interpolator replaces the current regex mini-resolver in `template.ts` (modest).
- CEL surfaces are platform-wide; this contract change touches `spec`, `formula`, `service-automation`, CLI build, and the designer together — must be sequenced as one coherent change while pre-launch.

## Sequencing (roadmap)

1. **Contract** — `spec`: expression fields become typed envelopes (`Predicate` / `Template` / `Expr<T>`); remove bare-string acceptance and the string→CEL coercion. Land `` cel`` `` / `` tpl`` `` builders.
2. **Engine** — `formula`: `{{CEL}}` template interpolation; unify date helpers under CEL stdlib (`today()`/`daysFromNow`). `service-automation`: route templates through it; **delete** the eval-error→false fallback in `evaluateCondition`, and adopt **one declared failure policy** across all five call sites (seed / hook / validation / projection / condition) rather than today's five ad-hoc ones.
3. **Build-time validation** — CLI/registration parses every expression; fail with location. (Catches the malformed-expression class immediately.) Also fix the in-spec authoring examples that still teach the anti-pattern (`automation/flow.zod.ts:213-214` `condition: "{amount} < 500"`) and the skills/docs.
4. **Schema-aware validation** — project object schema into the CEL type env; field-existence + return-type checks (see Open Question 1 for v1 depth).
5. **Designer** — GUI condition/template builders emit the canonical IR; one validator shared with build.

## Non-goals / deferred

- **Full single-language purity** (CEL-only, no template sugar): rejected — interpolation ergonomics matter; `{{CEL}}` holes keep one language *and* ergonomics.
- **Replacing CEL** with JS/Power Fx: rejected — CEL is sandboxed, statically checkable, non-Turing-complete, and AI-legible; the right base for "safe + checkable + LLM-friendly."
- **Runtime, non-CEL custom DSLs** in conditions: out of scope.

## Open questions (need a decision)

1. **Depth of schema-aware validation in v1.** Minimum viable is *field existence + predicate-returns-bool* (highest ROI). Full type inference (numeric/date/string compatibility, function-overload resolution against field types) could be v2. **Can the build pipeline obtain the complete, resolved object schema at compile time** to feed the type environment? That gates how much of Decision 5 lands in v1.
2. **Reference front-end.** This ADR treats the **IR/SDK as the reference implementation and the GUI as its visual producer** (matching today's AI+`.ts` authoring reality). If the intended end-state is "GUI-drag-first, `.ts` is export-only," validation and ergonomics weight shifts toward the designer, and the strictness of the `` cel`` `` tagged templates should be tuned accordingly.

## Already shipped / observed on this line of work

- `@objectstack/formula` envelope routing exists (`{dialect, source, ast}`), CEL stdlib (`now()`/`today()`/`daysFromNow(int)`/`isBlank`/`coalesce`), and the legacy single-brace template resolver (`service-automation/builtin/template.ts`). This ADR **converges** these onto one language + one delimiter and adds the typed contract + build-time/schema validation that the current seam lacks.
