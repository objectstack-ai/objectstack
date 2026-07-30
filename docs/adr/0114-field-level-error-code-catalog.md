# ADR-0114: Field-level error codes name the violated constraint — a closed lowercase catalog, and Zod stops leaking onto the wire

**Status**: Accepted (2026-07-30)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (D6 deferred exactly this decision, and its catalog+ledger shape is the model reused here), [ADR-0049](./0049-no-unenforced-security-properties.md) (declare-and-enforce — the wire `fields[]` element currently has no schema at all), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert declarations — `EnhancedApiErrorSchema.fieldErrors` is declared and never emitted), [ADR-0104](./0104-field-runtime-value-shape-contract.md) (the silently-stripped-key line its contract guard enforces — why D4's rename is deferred rather than done here)
**Consumers**: `@objectstack/spec` (`api/errors.zod.ts`, `ui/action-params.zod.ts`), `@objectstack/objectql` (`validation/record-validator.ts`, `validation/rule-validator.ts`), `@objectstack/rest` (`import-coerce.ts`, `import-runner.ts`, `zodIssuesToFields`), `@objectstack/plugin-sharing` (`rule-criteria.ts`), `@objectstack/runtime` (`validation-failure.ts`), `@objectstack/client`, objectui (`react/src/utils/error-message.ts` — the only console consumer)
**Surfaced by**: [#3977](https://github.com/objectstack-ai/objectstack/issues/3977), split out of [#3841](https://github.com/objectstack-ai/objectstack/issues/3841) by ADR-0112 D6.

---

## TL;DR

A field-level code names **which constraint the value violated**, and constraints are already named in the metadata's own snake_case vocabulary — `required: true`, `max_length: 50`, `min_value: 0`. So the field vocabulary stays **lowercase snake_case**, deliberately *not* following ADR-0112's SCREAMING_SNAKE, because here the code is a constraint name and the correspondence with the schema property is the point.

It becomes a **closed catalog** (`FieldErrorCode` in spec, 27 members) that `FieldErrorSchema.code` validates against, and Zod's issue codes get **mapped at the `zodIssuesToFields` boundary** instead of leaking library internals onto the wire. The `fields`-vs-`fieldErrors` naming split is decided (`fields` is right) but **not executed**: it is an authorable-key retirement, so ADR-0104's tombstone-plus-migration machinery applies and gets its own change.

## Context

ADR-0112 settled the top-level `error.code` vocabulary and explicitly refused to decide this one (D6), on the grounds that field-level codes have different emitters (validators) and different consumers (form UIs). `FieldErrorSchema.code` was widened to `z.string()` there so the spec would stop declaring an enum nothing complied with. This ADR is the deferred decision.

### The vocabulary is more coherent than #3977's framing

#3977 describes "four vocabularies with no schema." The harvest says: **six emitters, 24 distinct codes, and the overlaps are semantically consistent.**

| Emitter | Codes |
|:---|:---|
| `record-validator.ts` | `required`, `invalid_type`, `invalid_boolean`, `invalid_date`, `invalid_time`, `invalid_email`, `invalid_url`, `invalid_phone`, `invalid_number`, `invalid_option`, `min_length`, `max_length`, `min_value`, `max_value` |
| `rule-validator.ts` | `required`, `invalid_option`, `invalid_format`, `invalid_json`, `json_schema_violation`, `invalid_initial_state`, `invalid_transition`, `rule_violation` |
| `import-coerce.ts` | `invalid_boolean`, `invalid_date`, `invalid_number`, `invalid_option`, `min_length`, `max_length`, `min_value`, `max_value`, `reference_not_found`, `reference_ambiguous` |
| `import-runner.ts`, `rule-criteria.ts` | `required` |
| `ui/action-params.zod.ts` | `required`, `unknown_param`, `invalid_shape` |

`required` means the same thing in all five places that emit it; so do `max_length`, `min_value`, `invalid_option`. This is a de-facto standard that grew consistently, not four dialects that happen to share a wire position. What is missing is a **schema**, not a decision about which dialect wins.

The genuine outlier is the fourth item in #3977's list: `StandardErrorCode`'s never-complied-with members (`VALUE_TOO_LONG` vs the emitted `max_length`, `MISSING_REQUIRED_FIELD` vs the emitted `required`). ADR-0112 resolved the immediate lie by widening `FieldErrorSchema.code`; this ADR leaves those members where they are.

That leaves a **known wart, recorded rather than fixed**: the top-level catalog still carries six field-shaped members — `INVALID_FIELD`, `MISSING_REQUIRED_FIELD`, `INVALID_FORMAT`, `VALUE_TOO_LONG`, `VALUE_TOO_SHORT`, `VALUE_OUT_OF_RANGE`. As *top-level* codes they answer "why did this request fail" with "some value was too long", which is answerable but not useful — the useful version is `VALIDATION_ERROR` plus a `fields[]` entry naming the value and its constraint. They stay because removing a member from the top-level catalog is a breaking change to a vocabulary two batches just stabilised, and because `VALIDATION_ERROR` already covers the honest top-level answer. The consequence to live with: `invalid_format` exists at both levels (as `INVALID_FORMAT` above), which the catalog test admits as the single declared overlap rather than papering over. Retiring the six belongs to whoever next revisits the top-level catalog.

### Nothing branches on the value

#3977 asks to survey consumers before deciding casing, because "form UIs may already string-match." They do not:

- **objectui** has exactly one field-error consumer, `extractFieldErrors` in `react/src/utils/error-message.ts`. It reads `field` and `message`, and touches `code` only as the last fallback in `firstString(rec.message, rec.error, rec.code)`. Its own comment says an untranslated enum in the UI reads as a bug. No branch, no match.
- **The framework** has no product-code branch on a field code at all — every match is in a test asserting an emitter's output.

So the casing choice is unconstrained by migration cost, and can be made on principle.

### Zod leaks its internals, ambiguously

`zodIssuesToFields` (`rest-server.ts`) passes Zod's issue code straight through with `String(i?.code ?? 'invalid')`. Two consequences:

1. The wire carries Zod's vocabulary (`too_small`, `too_big`, `unrecognized_keys`, `invalid_value`) on the same field position as the validators' — so a client cannot know which vocabulary it is reading without knowing which route served it.
2. `too_small` is **ambiguous on its own**: it covers a short string, a small number, and a short array. #3977 assumed this was a mapping problem with no clean answer. It has one — Zod v4 issues carry `origin` (`'string' | 'number' | 'array' | …`) and, for format failures, `format` (`'email' | 'url' | 'regex' | …`). Those disambiguate every case:

```
too_small        + origin=string  → min_length      too_big + origin=string → max_length
too_small        + origin=number  → min_value       too_big + origin=number → max_value
too_small        + origin=array   → min_items       too_big + origin=array  → max_items
invalid_format   + format=email   → invalid_email   invalid_format + format=url → invalid_url
invalid_value                     → invalid_option  unrecognized_keys       → unknown_field
invalid_type     (see below)      → required | invalid_type
```

That last row is a real bug, not a tidy-up: Zod reports a missing required property as `invalid_type` (expected string, received undefined). Passed through verbatim, a form marks a *missing* input as a *type* error.

It is also the one case `origin`/`format` cannot settle. A v4 issue carries `expected` and a message but **not the offending value**, so a missing property and a wrong-typed one are byte-identical on the issue — same `code`, same `expected`, same keys. The only other signal is the message text ("received undefined"), and depending on Zod's phrasing for a wire contract is precisely the leak this decision removes. So the discriminator is the **parsed input**, walked to the issue's `path`: the mapper takes it as an optional argument, and a caller that cannot supply it gets the accurate-but-less-specific `invalid_type` rather than a guess.

### `fieldErrors` is declared and never emitted

The wire carries `fields` — `runtime/src/validation-failure.ts`, all six emitters, `@objectstack/client`, and objectui's extractor all say `fields`. `EnhancedApiErrorSchema` declares `fieldErrors`, which nothing emits and nothing reads. That is ADR-0078's silently-inert declaration, on the error envelope.

## Decision

**D1 — Field-level codes stay lowercase `snake_case`, and this is not an exception to ADR-0112 but a consequence of what they name.** ADR-0112 D8 makes machine constants SCREAMING because a top-level code names a *condition the request hit* — an API-level fact, catalogued across services. A field-level code names the *constraint the value violated*, and constraints are declared in the metadata's own snake_case vocabulary: `required` ↔ `required: true`, `max_length` ↔ `max_length: 50`, `min_value` ↔ `min_value: 0`. The code and the schema property are the same word on purpose, and SCREAMING would break that correspondence to buy consistency with a vocabulary these codes are deliberately not part of (D6). Prime Directive #3's snake_case-for-data-values applies.

**D2 — One closed catalog, `FieldErrorCode`, and `FieldErrorSchema.code` validates against it.** 27 members: the 24 harvested plus `min_items` / `max_items` / `unknown_field`, which the Zod mapping in D3 needs and which the validators will grow into. No ledger tier, unlike ADR-0112: field codes describe constraint kinds, which are a property of the *type system* and therefore closed by nature — a service does not get to invent one, it gets to add one to the catalog. `unknown_param` (action-params) folds into `unknown_field`; the param/field distinction lives in the surrounding record's key, not in the code.

**D3 — Zod is mapped at the boundary, never passed through.** `zodIssuesToFields` translates using `origin` / `format` per the table above, plus the parsed input for the `invalid_type` split. An unmapped Zod code becomes `invalid_value` (a catalog member) rather than leaking. The mapping is tested by driving **real** `safeParse` calls, not by hand-written issue fixtures — which is how the `input` problem above surfaced at all: the first draft read `issue.input`, and a real parse showed that branch could never fire.

**D4 — The wire's `fields` is the right name, and the rename is deferred with its cost written down.** `EnhancedApiErrorSchema.fieldErrors` should become `fields`; nothing has ever emitted `fieldErrors`, so the declaration points away from reality. But it is an **authorable key**, and the contract guard in `build-schemas.ts` (#3733, ADR-0104) rightly blocks a bare rename: these schemas are not `.strict()`, so Zod silently strips an unknown key, and an author or producer still writing the old name would get a clean parse and a value that never takes effect. Retiring it properly needs a `retiredKey()` tombstone carrying the fix, a D2 conversion (and D3 chain step) so `os migrate meta` can rewrite consumers, and a major changeset with the FROM → TO mapping.

That is a change of its own, not a rider on this one. What lands here is the half that makes a validation body **assertable** — the element schema, with `code` closed — and the property keeps its name plus a banner naming the mismatch and the machinery its retirement needs. Declaring the wrong name loudly beats renaming it quietly.

**D5 — What this catalog does NOT govern, restated from ADR-0112.** The three neighbouring vocabularies stay put: persisted columns (D6b), diagnostics inside a 200 (D6c), and the top-level catalog. The line from ADR-0112 holds — *the field catalog governs the code that names which constraint a value violated*. `check-error-code-casing.mjs` already recognises the field-addressed shape structurally, so this catalog needs no new guard exemptions; what it needs, and now gets, is a schema.

## Alternatives rejected

**SCREAMING_SNAKE for consistency with ADR-0112.** Defensible on "one convention for machine constants," and free of migration cost since nothing branches. Rejected because it severs the code-to-constraint-name correspondence that makes `max_length` self-documenting against `max_length: 50`, and because ADR-0112 D6 already ruled that this is a different vocabulary — inheriting its casing rule would quietly re-merge what D6 separated. Consistency with the *metadata* vocabulary is the more load-bearing consistency here.

**Keep `z.string()` and document the convention.** Cheapest, and no worse than today. Rejected as exactly the state ADR-0112 D4 refused for the top level: an undeclared vocabulary reopens the moment someone types a new code, and the conformance suites have nothing to assert. The Zod passthrough proves the failure mode is live, not hypothetical.

**Map Zod codes into the catalog *and* keep them as ledger-style extensions.** Rejected: it makes the wire carry two vocabularies again, which is the whole problem. Zod is an implementation detail of one route's parsing, and an implementation detail has no business being a wire contract.

**Rename the wire's `fields` to the declared `fieldErrors`.** Rejected on ADR-0112's own reasoning: the wire is the harder thing to move, and here it is also the *more used* thing — six emitters, the client, and the console versus zero emitters of `fieldErrors`.

## Consequences

- `FieldErrorSchema.code` tightens from `z.string()` to `FieldErrorCode`, and ADR-0112's banner comment comes off. The conformance suites that parse error bodies gain a value check for free.
- The wire `fields[]` element has a schema for the first time, so a validation response can be asserted structurally rather than by duck-typing.
- Zod-served routes change their field codes (`too_small` → `min_length`, and a missing property stops reporting as a type error). This is a wire-visible fix; nothing in-repo or in the console branches on the old values.
- `EnhancedApiErrorSchema.fieldErrors` keeps a name the wire does not use, now with a banner saying so. That is a deliberate debt: loud and documented beats a quiet rename that strips an author's key.
- Adding a constraint kind now means adding a catalog member, which is the intended friction: a new *kind* of constraint is a type-system change and deserves a line in the spec.

## Rollout

One PR — the emitters already speak the chosen vocabulary, so the change is the catalog, the schema tightening, and the Zod mapping. No sweep, no batches, no consumer migration.

Deferred to its own change (D4): retiring `fieldErrors` for `fields`, which needs the ADR-0104 sequence — tombstone, D2 conversion + D3 chain step, major changeset.
