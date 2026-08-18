# ADR-0112: One error-code vocabulary — SCREAMING_SNAKE on the wire, a closed standard catalog plus a registered extension ledger

**Status**: Accepted (2026-07-30)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (declare-and-enforce — a declared property nothing enforces is worse than absent), [ADR-0060](./0060-conformance-ledger-platform-pattern.md) (the ledger pattern this ADR reuses for extension codes), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert declarations — a catalog no route validates against is exactly this), [ADR-0089](./0089-unify-visibility-predicate-naming.md) (the naming-unification precedent: one name per concept, enforced)
**Consumers**: `@objectstack/spec` (`api/errors.zod.ts`, `api/contract.zod.ts`, generated manifests), `@objectstack/client` (re-exports `StandardErrorCode`; `StandardError` interface; the three-location code probe), `@objectstack/runtime` (`http-dispatcher.ts`), `@objectstack/rest` (`rest-server.ts`, import/export routes), `services/*` (storage, i18n, messaging, automation …), `packages/qa/dogfood`, objectui console (`RecordAttachmentsPanel` and every error-code branch), `content/docs/api/error-catalog.mdx`
**Surfaced by**: [#3841](https://github.com/objectstack-ai/objectstack/issues/3841) (the vocabulary split), carried out of [#3689](https://github.com/objectstack-ai/objectstack/issues/3689); envelope groundwork in #3687 / #3837 is what makes this decidable now.

---

## TL;DR

The platform has **two live error-code vocabularies** for the same concepts — `StandardErrorCode` declares lowercase `permission_denied`, the wire majority emits `PERMISSION_DENIED` — and **three wire locations** where a semantic code may appear (`error.code`, `error.details.code`, `error.type`). Nothing arbitrates, because `ApiErrorSchema.code` is a bare `z.string()`: both dialects, and any typo or hallucinated code, parse fine and fail silently at the consumer's `===`.

**Decision.** Top-level `error.code` adopts **SCREAMING_SNAKE_CASE**, in a **two-tier vocabulary**:

1. a small, closed **standard catalog** — `StandardErrorCode`, members renamed in place (breaking), mapping to HTTP semantics;
2. **service extension codes**, each **registered in an error-code ledger** (ADR-0060 pattern). Conformance suites assert every emitted top-level code ∈ standard ∪ registered.

`ApiErrorSchema.code` stops being `z.string()`. `error-catalog.mdx` becomes **generated from the spec**, never hand-written again. Field-level codes (`FieldErrorSchema.code`) are **explicitly out of scope** — they are a de-facto separate vocabulary today and get their own decision; until then the field schema is widened to tell the truth. The target end-state (recorded here, landed in follow-ups) is **one location**: `error.code` carries the semantic code; the HTTP status lives on the transport and `error.httpStatus` only.

This is a **deliberate, recorded deviation** from Prime Directive #3 ("machine names (data values) → `snake_case`"): error codes are machine *constants*, not data values, and the deviation buys lexical-category separation from snake_case metadata identifiers.

---

## Context

### The drift

`packages/spec/src/api/errors.zod.ts:51` declares `StandardErrorCode` as a closed enum of **51 lowercase snake_case** codes (`validation_error`, `unauthenticated`, `permission_denied`, …). It is the declared type of `FieldErrorSchema.code` and `EnhancedApiErrorSchema.code`, and `content/docs/api/error-catalog.mdx` documents it as *the* catalog.

The wire disagrees. Counting distinct `code: '…'` literals in non-test source under `packages/` at the time of #3841: **≈140 SCREAMING_SNAKE** (`AUTH_REQUIRED`, `FILE_NOT_FOUND`, `ATTACHMENT_DOWNLOAD_DENIED`, `UPLOAD_SESSION_NOT_FOUND`, …) vs **≈100 lowercase** (`validation_error`, `driver_missing`, …; count includes some false positives). Exact numbers move week to week — nothing stops them — but the split's shape is not in doubt, and it runs through single request paths: `http-dispatcher.ts:1424` parks `{ code: 'PERMISSION_DENIED' }` in `details` while the enum names the same condition `permission_denied`.

Nothing arbitrates because the enforced schema never references the enum: `packages/spec/src/api/contract.zod.ts:12` declares `ApiErrorSchema.code` as `z.string()`. The catalog is a declaration no route validates against — ADR-0078's silently-inert trap, on the error contract.

### Three homes for the semantic code

Worse than two spellings: the code has three possible wire locations, and consumers must know which surface answered to know where to look.

| Location | Producer | Example |
|---|---|---|
| `error.code` | `@objectstack/rest` flat envelope; most services | `DELETE_RESTRICTED`, `AUTH_REQUIRED` |
| `error.details.code` | runtime dispatcher — `error.code` itself is **occupied by the HTTP status number** (`http-dispatcher.ts:475-484`) | `{ code: 400, details: { code: 'VALIDATION_FAILED' } }` |
| `error.type` (undeclared field) | dispatcher 404/405 paths (`http-dispatcher.ts:530-541`, `dispatcher-plugin.ts:340-349`, `domains/ai.ts`, `domains/mcp.ts`) | `type: 'ROUTE_NOT_FOUND'` |

The client SDK is the living cost: `packages/client/src/index.ts:4455-4459` probes all three locations in priority order, under a comment explaining that the branch our own docs teach (`if (err.code === 'VALIDATION_FAILED')`) *never matched* on dispatcher-served surfaces before the probe existed.

### Consumers branch on these strings

- objectui `packages/app-shell/src/views/RecordAttachmentsPanel.tsx:103-108` maps `ATTACHMENT_DOWNLOAD_DENIED` / `AUTH_REQUIRED` to user-facing copy.
- `packages/qa/dogfood/test/attachments-permission-matrix.dogfood.test.ts` asserts on the same codes.
- `packages/client` exposes `err.code` as the programmatic branch point and documents it.

Every consumer that exists today branches on the **SCREAMING** dialect. No consumer branch on the lowercase dialect has been found (to be re-verified per service during the sweep — see Rollout).

> **Corrected during batch 2 (#4003).** The re-verification the sentence above asks for found three lowercase consumer branches that the original survey missed, all in-repo:
> `packages/runtime/src/domains/automation.ts:240,243` reads `forbidden` and `invalid_signal` from `service-automation`'s resume result; `packages/metadata-protocol/src/protocol.ts:4353` re-reads its own thrown `destructive_change`; and `packages/spec/src/contracts/automation-service.ts` *documents* `code: 'forbidden'` as the contract. Each was renamed atomically with its emitter. The lesson generalises: grep for `code === '…'` (comparison), not only `code: '…'` (emission), before each service's sweep — a rename that misses the comparison side does not fail any test, it silently stops matching.

#### Sweep checklist (earned in batch 2)

A `code: 'x'` grep finds the easy half. Each of these forms was missed once and cost a red suite:

| Form | Example | Why a `code: '…'` grep misses it |
|:---|:---|:---|
| Comparison | `err?.code === 'destructive_change'` | reads, doesn't emit — and silently stops matching rather than failing |
| Assignment to a property | `err.code = 'item_locked'` | no colon |
| Indirect / computed | `const code = intent === 'runtime-only' ? 'not_creatable' : 'not_overridable'` | the literal never sits next to the word `code:` |
| Regex assertion | `expect.stringMatching(/^(not_overridable\|not_creatable)$/)` | literal is inside a pattern |
| `toBe` assertion | `expect(caught.code).toBe('invalid_metadata')` | test-side spelling of the same contract |
| Literal-union **type** | `code?: 'forbidden' \| 'invalid_signal'` in a contract interface | it's a type, not a value — `tsc --noEmit` on the *declaring* package still passes, and only a **consumer's** `dts` build fails, so the error surfaces in a package you did not touch |
| Doc comment / contract docstring | ``* refused with `{ code: 'forbidden' }` `` | teaches the old spelling to the next author (and to AI) |

Also rebuild dependent packages before trusting a cross-package suite: a stale `dist/` makes the *old* code the one under test, which reads as "my rename broke it" (or, worse, as a false green).

### The field-level vocabulary is a third thing entirely

`FieldErrorSchema.code` declares `StandardErrorCode`, but field-level emitters use vocabularies of their own: `packages/objectql/src/validation/record-validator.ts` and `rule-validator.ts` emit `required`, `max_length`, `invalid_email`, … (of which only `invalid_format` is in the enum); `packages/rest/src/import-coerce.ts` adds `reference_ambiguous`, `reference_not_found`; `packages/rest/src/rest-server.ts:89-96` passes **raw Zod issue codes** (`invalid_type`, `too_small`) straight through. The wire array is named `fields`, not the declared `fieldErrors`, and no schema validates it. This is a separate decision with different consumers (form UIs) and different emitters (validators), and jamming it into this ADR would either block the top-level fix or force a hasty field-level one.

### Why now

- **The window.** Error codes are values consumers string-match on; once external (AI-generated) apps branch on them, they are frozen forever. Today every branching consumer lives in objectstack/objectui — both in hand.
- **The groundwork is fresh.** #3687/#3837 settled the *envelope* on the storage and i18n paths and left conformance suites (`error-envelope.conformance.test.ts`, `success-envelope.conformance.test.ts`) that parse against imported spec schemas. The moment `code` is a real type, those suites assert *values* with zero test changes.
- **It blocks the rest.** The `error.code`-occupied-by-status defect (#3689 sibling, pinned in `http-dispatcher.test.ts` since #3687) cannot be fixed without a vocabulary to migrate to.
- **Entropy has no gate.** This repo is developed by multiple concurrent agents; any new `code: '…'` literal in either dialect passes CI today. The mixed state self-replicates: agents copy whichever dialect they see.

### What comparable platforms do

| Platform | Top-level error code style | Notes |
|---|---|---|
| Salesforce | `SCREAMING_SNAKE` (`FIELD_CUSTOM_VALIDATION_EXCEPTION`, `INVALID_FIELD`, `DUPLICATE_VALUE`) | The genre ObjectStack sits in |
| gRPC / Google Cloud | `SCREAMING_SNAKE` (`PERMISSION_DENIED`, `NOT_FOUND`); domain detail in `ErrorInfo.reason`, also SCREAMING | Two-tier: tiny closed code set + namespaced reasons — the structure this ADR adopts |
| Stripe | lowercase snake (`card_declined`) | Payments API, not an app platform |

The enterprise-app-platform genre is uniformly SCREAMING. This matters twice: once for human familiarity, and once because **AI agents authoring apps on this platform carry that training prior** — the convention that matches the prior is the one agents get right when context is thin.

---

## Decision

Nine rulings, D1–D9.

**D1 — Top-level `error.code` speaks SCREAMING_SNAKE.** The value space is `^[A-Z][A-Z0-9_]*$`. This matches ≈140 of ≈240 existing distinct literals, every consumer branch in existence, and the genre. The ≈100 lowercase emitters are swept in follow-up batches (Rollout, batch 2).

**D2 — `StandardErrorCode` members are renamed in place (breaking).** Same 51 concepts, SCREAMING spelling (`permission_denied` → `PERMISSION_DENIED`). The enum remains the small, closed **standard catalog**: codes with platform-wide HTTP semantics (the `ErrorCategory`/status mapping). It does not try to swallow service-specific codes. `@objectstack/client` re-exports the type (`client/src/index.ts:12`) and uses it in `StandardError` (`:243`) — the client updates in the same PR.

**D3 — Service extension codes are registered, not free-typed.** Codes like `ATTACHMENT_DOWNLOAD_DENIED` or `UPLOAD_SESSION_NOT_FOUND` do not enter the standard catalog. Each service registers its codes in an **error-code ledger** (ADR-0060 pattern; same generation machinery as `api-surface.json` / `json-schema.manifest.json`). Registration carries the code, the owning service, and a one-line meaning. A recommended (not required) convention is a domain prefix (`ATTACHMENT_*`, `UPLOAD_*`). The ledger is the anti-bottleneck: adding a service code touches the service's own ledger entry, not the spec enum — but it is still a *deliberate, reviewable* act, which is the entropy gate this whole problem lacked.

**D4 — `ApiErrorSchema.code` stops being `z.string()`.** It becomes the generated union of the standard catalog and the registered ledger (`ErrorCode`, generated at build time — Zod-first per PD#1, enum generated from ledger + `StandardErrorCode`). Conformance suites thereby assert values for free. There is **no regex escape hatch** (see Alternatives — a casing regex passes hallucinated codes, which is precisely the AI failure mode this ADR exists to prevent).

> **Amendment (2026-08-17, [#9106](https://github.com/objectstack-ai/objectstack/issues/9106)) — `error.code` is closed at EVERY door, and `declaredCode` is the open, author-authored channel beside it.** D4 closed the *schema*; it did not say what a door does with a throw whose `.code` is not a member, and the two doors answered differently. The REST package door narrowed (an unregistered code fell to the code the status derives); the runtime dispatcher door put the producer's string on the wire verbatim. #8087 first ruled the verbatim spelling stays and delivered a gate over the platform producers (`pnpm check:dispatcher-error-vocabulary`) — and that gate's own first derivation measured the limb no registration can ever close: `SandboxError` carries a metadata app's **own** `.code` across the QuickJS boundary on purpose ([#7867](https://github.com/objectstack-ai/objectstack/issues/7867)), so `domains/actions.ts` served a code **authored by tenants, at runtime**, into `error.code`. `ERROR_CODE_LEDGER` cannot enumerate strings that do not exist when CI runs.
>
> **Ruled (maintainer, 2026-08-16).** `error.code` stays a closed vocabulary at every door. A thrown code that is not a member of `StandardErrorCode` union the serving side's ledger is **demoted** to a declared sibling field, `ApiError.declaredCode`, and `error.code` carries the member the HTTP status derives. One rule platform-wide, and the same one hotcrm#1075 states from the app side: **apps branch on enum codes; app-specific spellings ride `declaredCode`.**
>
> **The boundary, named.** `code` is closed — a consumer may switch on it exhaustively and that is now true at every door, which is exactly what it was not before this amendment. `declaredCode` is **open**: any string a producer spells, platform or tenant, and no ledger governs it. **Presence means demotion** — the field is absent when the producer's code IS a vocabulary member (it is already in `code`, and repeating it would put two spellings of one fact on every refusal) and absent when the producer declared none. So a consumer that reads `declaredCode` at all knows the serving side's ledger did not recognise the spelling.
>
> **The #7867 capability is preserved, not retired.** Narrowing the sandbox boundary — rejecting or namespacing an author's code before it reaches the wire — was the rejected alternative: it withdraws a capability this platform deliberately granted, to protect a property nothing had yet needed at that door. The author's code still crosses the sandbox and still reaches the wire; it lands in the open channel rather than the closed one.
>
> **Where it is pinned.** `resolveThrownHttpError` and `demotedDeclaredCode` (`packages/types/src/thrown-http-error.ts`, anchored in `scripts/adr-anchors/`) are the ONE definition of both spellings; all three dispatcher exits (`HttpDispatcher.errorFromThrown`, `dispatcher-plugin`'s `errorResponseBase`, `endpoint-executor`'s `endpointErrorAnswer`) read them rather than restating the rule. The demote is pinned end to end in `packages/runtime/src/domains/actions-validation-envelope.test.ts` (the actions door, with the tenant witness `DUPLICATE`), `packages/runtime/src/package-door-error-parity.test.ts` and `packages/runtime/src/error-envelope.conformance.test.ts` (which asserts, for every body the door emits, that a present `declaredCode` is never a vocabulary member and never a copy of `code`).
>
> ⛔ **`DUPLICATE` is deliberately NOT registered.** It is the pinned witness to the tenant-authored limb, re-homed under this rule rather than added to the ledger: registering one tenant spelling closes nothing (the next app picks a different string) and would promote a single app's vocabulary into the platform catalog every consumer branches on. It stays fenced off from the ledger-registration hand-off (#8846).
>
> **Scope.** This amendment rules the doors served by `resolveThrownHttpError` — the runtime dispatcher exits (the actions door among them) and the direct-mount REST package registrar. `packages/rest`'s flat `sendThrownError` dialect, which puts `code` at the body's **top level** rather than in `error.code`, was a different envelope position and was out of scope *here*; it was measured and filed separately as [#9232](https://github.com/objectstack-ai/objectstack/issues/9232), and is ruled by the amendment immediately below.

> **Amendment (2026-08-17, [#9232](https://github.com/objectstack-ai/objectstack/issues/9232)) — the flat door narrows too, so "every door" is literal.** The paragraph above left exactly one thrown path outside the closure, and #9232 measured what that cost: `packages/rest`'s flat `{ error, code }` responder passed a caught error's `code` to the wire verbatim, so an invariant this ADR had been amended to state **absolutely** the day before was contradicted by an observable door. An agent reading both had no way to tell which was authoritative — the AI-error-resistance failure #9106 exists to remove, moved one door over rather than closed.
>
> **Ruled (maintainer, 2026-08-17).** Demote alignment: a thrown `code` that is not an `ErrorCode` member is demoted to a **top-level `declaredCode` sibling** in the flat body, and `code` carries the member the HTTP status derives — the same rule, the same two spellings, computed by the same `resolveThrownHttpError` / `demotedDeclaredCode` pair. **Body POSITION is not a carve-out.** The rejected alternative was to rule the flat top-level `code` a different field this ADR does not govern; that would have cut an exception into an invariant amended to be absolute one day earlier, which is the reader contradiction the card measured rather than a fix for it.
>
> **Envelope-position convergence is a separate line and was explicitly NOT a precondition.** The flat dialect still puts `code` beside `error` rather than inside it; moving it is owned by the `check:route-envelope` ratchet, whose end state is routing these bodies through the shared `sendOk` / `sendError` pair. Vocabulary and position are two decisions, and this one is only the first. ⚠️ Do not cite #7035 for the position half — it closed on 2026-08-10 (PR #7293) having converged three `/meta` 501 handlers, and was still being quoted as the open owner of that line across `packages/rest` prose until #9232 repointed it.
>
> **What it changes on the wire.** A registered code is untouched at this door, exactly as at the others. An unregistered one moves to `declaredCode`, so a consumer branching on an *unregistered* spelling in the flat top-level `code` must read `declaredCode` instead — the same "breaking for author-thrown codes only" class the Consequences section records for the actions door, and measured the same way: the consumer sweep found the SDK's read of the flat top-level `code` to be a generic pass-through normalisation, with no branch anywhere on a spelling outside the union. One live producer was found and is the observable case: `plugin-security`'s object-posture gate throws a **lowercase** `owd_widening_forbidden`, which violates D1 as well as the ledger and could never satisfy `ApiErrorSchema`; it now answers `PERMISSION_DENIED` with its own spelling preserved beside it.
>
> **Where it is pinned.** `packages/rest/src/rest-thrown-code-vocabulary.test.ts`, in both directions — an unregistered code demotes, and a registered code still arrives verbatim in `code`. The second half is the one a regression does not redden, which is why it is written down.

**D5 — One location, eventually: `error.code` carries the semantic code.** Target end-state, recorded here so the follow-ups have a fixed destination: the HTTP status lives on the transport and (optionally) `error.httpStatus`; `error.code` is always the semantic string; `error.details.code` and `error.type` are retired as code carriers. The dispatcher-occupation fix (#3689 sibling) and `ROUTE_NOT_FOUND`-in-`type` retirement land as follow-ups (Rollout, batch 3). The client's three-location probe is deleted only after both.

> **Amendment (2026-07-30, [#4007](https://github.com/objectstack-ai/objectstack/issues/4007)) — ruled and done.** With batch 3 landed, the client's parking-spot read (`error.details.code`) is deleted: SDK and server ship as a changesets fixed group, so the "newer SDK, older server" pairing it served is not a supported deployment — and batches 1–2 renamed the code *values* anyway, so a code dug out of an old server's parking spot would match no branch written against the current catalog; location-compat without value-compat protects nothing. The client's two remaining reads are the two *live* envelopes' declared spots (flat top-level `code`, wrapped `error.code`) — a present-tense fact, not a fallback chain; retiring the flat shape itself belongs to the envelope-convergence line (#3843 family), not this ADR. The D9b nesting fix (`category`/`retryable`, [#4006](https://github.com/objectstack-ai/objectstack/issues/4006)) landed in the same change.

**D6 — Field-level codes are explicitly a separate vocabulary, and the schema stops lying meanwhile.** `FieldErrorSchema.code` widens from `StandardErrorCode` to `z.string()` with a banner comment pointing at the follow-up issue. Widening is honest (emitters never complied) and prevents this ADR's rename from silently claiming field-level compliance it does not deliver. The field vocabulary (validator codes, import codes, Zod-passthrough, the `fields` vs `fieldErrors` naming, and a schema for the wire array) gets its own issue and, if the decision is non-obvious, its own ADR.

**D6b — Persisted code columns are a third separate vocabulary (added in batch 2).** `sys_metadata_audit.code` spells its denial reasons exactly like the codes `metadata-protocol` throws (`item_locked`, `destructive_change`, …), so a naive sweep renames it too. It must not: the column is audit *history*, rows written before this ADR keep their spelling forever, and the same field also holds outcomes that are not errors (`ok`, `lock_override`). Following the error catalog here would buy either a data migration or one column with two vocabularies mixed by write date. So the audit column stays lowercase and self-contained, the thrown code goes SCREAMING, and the two deliberately diverge — recorded at both sites so the split reads as a decision rather than a missed rename. Generalisation for the remaining batches: a code that is **persisted** is versioned by its data, not by the catalog, and is out of scope for a rename sweep.

**D6c — Diagnostics codes are not error codes (added in batch 2).** `build-probes.ts` (`RuntimeBuildIssue`) and `metadata-diagnostics.ts` emit records like `{ severity, artifact, ref, code, message, fix }` and `{ path, message, code }` — lowercase, and easy to mistake for stragglers. They are not: they travel as **payload of a 200** (`res.json(result)` on the diagnostics route), describe an artifact rather than the request, carry a severity that can be `warning`, and are addressed by `path`. Nothing routes them to `error.code`. They stay lowercase and out of the ledger.

The line that decides all three of D6/D6b/D6c: **the catalog governs the code a failing request answers with.** A code that is field-addressed (D6), persisted (D6b), or shipped inside a successful response (D6c) is a different vocabulary with different consumers, and sweeping it in buys churn plus a migration nobody asked for. When in doubt, ask what reads it — a client branching on why its call failed, or something else.

**D7 — `error-catalog.mdx` is generated from the spec.** The hand-written catalog is how docs and wire drifted apart in the first place (`docs/audits/2026-06-handwritten-docs-accuracy-followups.md:230` catalogues the casing drift; `:106` found a documented-only vocabulary with zero emitters). Generated docs are the only docs that cannot lie — and for AI authors, docs *are* context.

**D8 — Recorded deviation from Prime Directive #3.** PD#3 says machine names (data values) are `snake_case`. Error codes are ruled to be machine **constants**, a different lexical category from data values and metadata identifiers. The deviation is deliberate and buys visual disambiguation: in a platform where objects and fields are `snake_case` (`account`, `validation_rule`), an ALL-CAPS token is recognizably a platform constant and cannot be confused with a field API name. Genre precedent (Salesforce, gRPC) and AI-prior alignment reinforce it. This ruling covers **error codes only** — it is not a general license to deviate from PD#3.

**D9 — Adjacent spec-internal cleanups ride along.** Two same-class defects found while evaluating #3841 are folded into the batches because they share the fix surface: (a) `packages/spec` exports **two mutually incompatible** `ErrorCategory` and `RetryStrategy` types (`api/errors.zod.ts:29-39,147-152` vs `integration/connector.zod.ts:409-420,346-353`) — the connector-side pair gets renamed (`ConnectorErrorCategory`, `ConnectorRetryStrategy`) so one name means one thing; (b) the client reads `category`/`retryable` from the wrong nesting level (`client/src/index.ts:4473-4475` reads top-level where the contract puts them inside `error`) — fixed when the probe area is touched in batch 3.

---

## Alternatives rejected

**Adopt lowercase snake_case (issue option 2).** Consistent with PD#3 on its face, but: every existing consumer branch reads SCREAMING, so this changes strings the console and dogfood suite match on, coupling objectstack and objectui through a tolerant-dual-read deployment window (the objectui#2869 dance) for ~140 emitters instead of ~100; the migration window is longer, and mixed states self-replicate in a multi-agent repo; and it fights the genre prior AI authors bring. The "consistency" it buys is the wrong kind — see D8.

**Keep both vocabularies as declared siblings (issue option 3).** Honest about the accident, but institutionalizes it: every consumer forever needs to know which dialect a surface speaks, which is precisely the per-surface knowledge this ADR abolishes. The defensible kernel of option 3 — that field-level really is a different vocabulary — survives as D6, split by *structural level* (top-level vs field-level), not as two dialects of the same field.

**Casing regex instead of a closed type (`z.string().regex(/^[A-Z][A-Z0-9_]*$/)`).** Catches case errors only. The dominant authoring error — human and especially AI — is a *plausible but wrong* code (`NOT_FOUND` for `RECORD_NOT_FOUND`, `BAD_REQUEST` for `INVALID_REQUEST`), which a casing regex waves through. A closed generated union makes hallucinated codes fail at parse/typecheck. Rejected as the primary mechanism; the regex survives only as a ledger-admission lint (a registered code must match it).

**One giant closed enum of all ~140 codes in `packages/spec`.** Makes the spec a bottleneck for every service-level error and invites either high-friction spec churn or (worse) developers routing around the enum — reopening the hole. The two-tier ledger (D3) keeps the closed-world guarantee without centralizing every code.

---

## Consequences

- **Breaking (compile-time):** `StandardErrorCode` member rename breaks any importer branching on lowercase members — in-repo: `packages/spec/src/api/errors.test.ts`, `@objectstack/client`. Both update in the batch-1 PR. Generated manifests (`json-schema.manifest.json`, `api-surface.json`) regenerate.
- **No runtime behavior change in batch 1.** SCREAMING emitters (the wire majority, and everything consumers branch on) are already compliant; batch 1 changes spec, types, docs, and the ledger only.
- **The lowercase sweep (batch 2) does change wire values** (`validation_error` → `VALIDATION_ERROR`). Before each service's sweep, its lowercase codes are checked for consumer branches; none are known today, which is exactly why the sweep is cheap *now*.
- **The conformance suites become value-asserting** with no test edits — the schema tightens under them (guard note in #3841, verified).
- **New-code friction is introduced deliberately:** an unregistered code fails CI. This is the entropy gate; the ≈240-literal status quo is what its absence produces.
- **Unblocked follow-ups:** the `error.code`-occupied-by-status fix; `error.type` retirement; deletion of the client's three-location probe and its explanatory comment block; the field-level vocabulary decision (D6's issue).
- **Docs debt retired:** `error-catalog.mdx` regenerated; the two error-code items in the 2026-06 docs-accuracy audit close.
- **Breaking on the wire, for author-thrown codes only (added by the 2026-08-17 amendment):** a metadata app throwing its own `.code` from an action body used to see it echoed at `error.code`; it now arrives at `error.declaredCode`, with `error.code` carrying the closed member the status derives. The binding precondition the ruling attached — measure whether any existing consumer of the actions door branches on author-authored strings in `error.code` — was measured before landing and came back empty, twice, by two independent search shapes (the second widened to every SCREAMING_SNAKE literal precisely because a comparison-shape scan cannot see helper-mediated branches such as objectui's `errorCodeIs`). Registered platform codes are unaffected: they were, and remain, in `error.code` verbatim. **#9232 extends the same consequence to `packages/rest`'s flat dialect**, where the demoted spelling lands in a top-level `declaredCode` beside a top-level `code`; its own sweep re-ran the measurement for that door's consumers rather than inheriting this one, and likewise came back empty of any branch on an unregistered spelling.

## Rollout

**Batch 1 — decision lands (with this ADR; no runtime change).**
Rename `StandardErrorCode` members; introduce the error-code ledger + generated `ErrorCode` union; tighten `ApiErrorSchema.code` to it; widen `FieldErrorSchema.code` to `z.string()` + banner (D6) and open the field-vocabulary issue; regenerate `error-catalog.mdx` from spec and wire up its generation; update `@objectstack/client` re-exports/types; register all existing SCREAMING codes in the ledger (mechanical harvest of the ≈140).

**Batch 2 — lowercase emitter sweep (per service, independent PRs).**
For each service: verify no consumer branches on its lowercase codes; convert emitters to registered SCREAMING codes; that service's conformance suite now passes value assertions. No cross-repo coordination needed — consumers already read SCREAMING.

**Batch 3 — location convergence (D5).**
Dispatcher: semantic code moves into `error.code`, numeric status stops occupying it (`http-dispatcher.ts:475`), `error.type` retired as a code carrier; update the #3687 pin in `http-dispatcher.test.ts` from "documents the deviation" to "asserts the fix". objectui ships tolerant dual-read first where needed (objectui#2869 pattern). Then delete the client three-location probe and fix the `category`/`retryable` nesting read (D9b).

Batches 2 and 3 are independent of each other; both depend on batch 1.
