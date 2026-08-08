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

> **Addendum (2026-08, #4889) — D5's "non-security ⇒ fail soft" line is NARROWED
> at the write-path gates: an UNEVALUABLE gate now fails CLOSED.**
> D5 sorts fail policy by *security-relevance*, and it put validation, hook and
> field predicates on the fail-soft side. Three findings since have shown that
> the sorting axis was one notch off for a specific subset: the predicates that
> **gate a write**. Fail-soft there does not mean "the rule was advisory"; it
> means "the guarantee the author declared did not happen, and nothing told
> anyone". The write returns 200, the client still renders the guard, and only a
> log line disagrees.
>
> Three instances, one direction:
>
> | # | Gate | Old | New |
> | :-- | :-- | :-- | :-- |
> | #4649 | object validation predicate (`script`/`cross_field`/`when`) | skip rule + log | **reject the write**, naming the rule and key |
> | #4775 | declarative hook `condition` | → `false` + log | **abort the operation** (`HookConditionError`) |
> | #4889 | field `readonlyWhen` whose predicate names an **unbound scope root** (e.g. `parent` with no master-detail header resolved) | → "not locked", write lands | **treat the field as LOCKED** (strip it) |
>
> The narrowing is deliberately *not* "every CEL fault is now fail-closed". A
> predicate that is simply BROKEN on this record — an undeclared key, a `null`
> ordering overload, a parse error, an engine throw — keeps D5's fail-soft
> policy at the field-predicate surfaces (`requiredWhen`, option `visibleWhen`,
> and every non-scope `readonlyWhen` fault), because the author has no remedy for
> an engine fault and bricking CRUD over one is the cure being worse. What
> changed is the case where the expression is **well-formed and supported** and
> the site simply could not bind what it names: there, "I could not check" must
> not resolve to "allowed", because the *declaration itself* says otherwise.
>
> Read the Pass-2 evidence table below as a snapshot of 2026-06, not as current
> behaviour, for those three rows. D5's tiering stands everywhere else — formula
> → `null` + log, flow → throw, security predicates fail closed.

---

> **Addendum (2026-08, #4800 / #4862 / #5037 / #5038) — BULK-WRITE SCOPE: on a
> predicate (`multi: true`) write, after-hooks and record-change flow triggers
> evaluate and fire PER ROW.** _Contract recorded here; **implemented by #5038**
> (see "How it landed" below). `before*` hooks are outside it, by nature._
>
> The addendum above settles what happens when a write-path predicate cannot be
> evaluated. It does not settle **what the evaluation is even over** when one
> write touches N rows — and that is a scope question this ADR owns, because
> "the same CEL means the same thing on every surface" is D6's premise.
>
> **The decision.** A bulk write is N record changes, so every record-scoped
> declaration on it is evaluated **per row**, with `record` = that row's state
> and `previous` = that row's pre-write state. This is not a new idea on the
> platform: validation predicates have worked this way on bulk writes since
> #3106 (`rulesNeedRows` fetches the matched rows and `evaluateValidationRules`
> runs once per row). Hook `condition`s — and the record-change flow triggers
> that ride the same lifecycle hooks — join them. An author writes one
> transition condition (`previous.done != true && record.done == true`) and it
> means the same thing whether the write carries an id or a predicate.
>
> **What the engine did before #5038, measured (#4862).** A `multi: true` update
> reaches `driver.updateMany`, which resolves an affected COUNT; the lifecycle
> hook fired **once**, `hookContext.previous` was never assigned (only the
> single-id branch fetched a prior row), and `record` degraded to the write's
> bare payload. So a condition naming `previous` was unevaluable and — since the
> #4775 row above — **rejected the write**. The rc window (#5037) kept the
> rejection (fail loud takes no exception; logging-and-skipping was considered
> and refused on #4800, because a missing audit row is the one failure nobody
> goes looking for) but made it name the limitation instead of the author.
>
> **How it landed (#5038).** The engine's bulk branch reads the matched row set
> **once** — the same `driver.find` #3106 already issues for per-row validation,
> now also demanded when the object has after-hooks — and then dispatches
> `afterUpdate` / `afterDelete` **once per matched row**, on a context with the
> single-record shape: `input.id` = the row, `previous` = its pre-image,
> `result` = its state. That shape is #2922's ruling for batch INSERT restated
> (a single array-shaped context "broke every consumer built for the single
> shape"), and it is why the fix has no code in the consumers: `hook-wrappers`'
> `record`/`previous` bindings, the record-change trigger's `buildContext` and
> plugin-audit's diff all read those same fields and became correct at the
> producer. The write's own contract is untouched — a predicate write still
> resolves an affected count (#4639), and still publishes ONE aggregate
> `data.records.updated`, because per-row dispatch changed hook granularity, not
> what the write is.
>
> **The consequences, priced as this addendum required.**
>
> - **`ctx.result` per row is the ROW, not the batch** — composed as
>   `row ⊕ payload` from the pre-image already in hand, so the guardrail above
>   ("read the row set once") stays literal: no second full-set query after the
>   write. A bulk DELETE has no post-state, so its per-row context sets no
>   `result` and consumers fall back to `previous`, which is what `record` means
>   for a delete.
> - **`onError` needed no per-row meaning.** It governs a HANDLER on a
>   record-scoped context, and per-row dispatch is what finally gives it one:
>   `abort` propagates and fails the operation (as on the single-record and
>   batch-insert paths), `log` swallows that row and the batch continues.
> - **The ceiling is a refusal, not a downgrade.** Past
>   `MAX_BULK_PER_ROW_HOOK_ROWS` (10 000) a predicate write against an object
>   with after-hooks is rejected BEFORE the driver call, so nothing is written.
>   Falling back to one dispatch for the batch would skip the hook for N-1 rows
>   silently — the failure shape this whole family exists to abolish.
>
> **`before*` hooks are NOT per row, and that is not a version gap.**
> ⚠️ **SUPERSEDED by Addendum II below (#5574, ruling B).** The maintainer
> reversed the "not a version gap" half on measured evidence: `before*` hooks
> ARE dispatched per row on a predicate write. What survives verbatim is the
> reason given here for the payload — one `updateMany` carries one payload —
> which Addendum II keeps as its D3 rather than overturning. Kept in place, not
> rewritten, because a reversed decision is a record (Prime Directive #13). A
> `beforeUpdate` / `beforeDelete` fires once for the whole batch because it may
> still rewrite the payload, and one `updateMany` carries one payload — there is
> nothing per-row to hand it. So #5037's `HookConditionError` and its
> `limitation` discriminator (`bulk_write_previous_unbound`,
> `bulk_write_stored_state_unavailable`) **survive, rescoped to that dispatch**,
> and their message no longer promises an expiry that has already happened: it
> names the phase as the reason and points at the matching `after*` event, where
> the same condition evaluates per row exactly as authored. Authors put
> transition conditions on `after*`; `before*` conditions stay over the incoming
> payload.
>
> **One refusal reversed on evidence.** #5037 deliberately did NOT offer "use a
> record-change flow trigger instead", because that trigger subscribes to these
> very lifecycle hooks and so fired once with the same unbound `previous`
> (#4862) — naming it would have made the error that fixes a
> `declared ≠ delivered` into another one. #5038 fixed it at the producer, so an
> after-type record-change trigger now rides the per-row dispatch and the route
> is real. The message names it because the fact changed, not because the
> constraint was relaxed.

---

> **Addendum II (2026-08, #5748 / #5574 / #6462) — BULK-WRITE, part two: which
> writes ARE bulk writes, and what a bulk write does to the `before*` phase.**
> _Contract recorded here. The `data.id` half is **implemented** (#5748 / PR
> #5919). The `before*` half is the **spec** side of a deliberate contract-first
> split (#6462); the engine side is #5574's engine card, `Blocked-by` it._
>
> Addendum I answered "what is a record-scoped declaration evaluated over when
> one write touches N rows" for the `after*` phase. Two questions it left are
> answered here, because a maintainer ruled on both on 2026-08-06 and directed
> them into one appendix.
>
> ---
>
> ### Part A — which writes are bulk writes (#5748, delivered)
>
> `ObjectQL.update(object, data, options)` took its id from two sources with two
> different rules: `where.id` went through a scalar test (an operator object, an
> array or `null` is a predicate, not an id), while `data.id` went through none
> at all and outranked both `where` and an explicit `options.multi`. So
> `update(o, { id: { $in: ['a','b'] }, title: 'x' }, { multi: true })` bound a
> serialized operator object as a **primary key** and silently discarded the
> declared bulk intent.
>
> **The decision (ruling A, 2026-08-06).** One scalar test, defined once and
> reused on both sides: a non-scalar `data.id` is not an id, so the same call
> now dispatches to `updateMany` and honours the declared `multi: true`. Route B
> (reject non-scalar `data.id` outright) was considered and refused — it would
> have made "the author put the predicate in the wrong slot" fatal for a call
> whose intent is unambiguous once the two halves agree. The concern behind B
> was converted into a required test instead, and #5919 landed 16 assertions of
> it: a non-scalar `data.id` **without** `multi: true` rejects with zero driver
> calls, so a typo is never silently promoted into a real batch write.
>
> Two consequences landed after it, same rule one layer on: a value already
> ruled not-a-primary-key does not get to sit in the primary-key column of the
> SET clause either — stripped with a warning on the predicate branch (#6262)
> and on the by-id branch (#6435).
>
> Why this belongs in the bulk-write appendix and not in a dispatch ADR of its
> own: everything Addendum I says is conditioned on a write BEING a predicate
> write. A rule that decides that question silently, and differently depending
> on which slot the caller used, is the entry to this whole surface.
>
> ---
>
> ### Part B — the `before*` phase is per row too (#5574 ruling B; spec half #6462)
>
> **What Addendum I got right and what it got wrong.** It reasoned: one
> `updateMany` carries one payload, a `before*` hook may rewrite the payload,
> therefore there is nothing per-row to hand it, therefore the dispatch is
> batch-scoped. The premise is true; the conclusion does not follow. The payload
> is not the only thing a `before*` handler reads — `previous` is — and binding
> a per-row pre-image needs no per-row payload at all.
>
> **The measured harm (#5574).** On the predicate path `ctx.previous` was never
> assigned in the before phase, so every guard hook written the way guards are
> written — `if (ctx.previous?.locked) throw` — passed silently. A hotcrm
> deployment measured all **15** of its guard hooks bypassed by one batch edit,
> including writing `null` into a `readonly: true` field that the single-id path
> refuses. The failure direction is fail-OPEN, and the optional chaining that
> makes it silent is exactly what an AI writes. The alternative on the table
> (option A: document the limitation) was refused for that reason — it puts the
> hole in the manual and leaves it in the product.
>
> **The decision.** A predicate write dispatches `beforeUpdate` / `beforeDelete`
> **once per matched row**, on a single-record-shaped context, replacing the
> single batch dispatch — the same move #5038 made for `after*`, held to the
> same yardstick. The full clause set, with the reasoning that does not fit
> here, is `packages/spec/src/data/bulk-write-hook-conformance.ts` (D1–D7), and
> `BULK_WRITE_HOOK_DISPATCH_CONTRACT` is that table machine-readable, carrying a
> `delivered` flag per event so the contract-first gap cannot read as delivered.
> The load-bearing clauses:
>
> - **Per-row context (D1/D2).** `input.id` names the row, `previous` is its
>   pre-image, `input.options` is still the caller's bag (the PHASE rule is
>   unchanged), `result` stays absent — the before phase has no post-state.
>   Zero matched rows is zero dispatches.
> - **The payload stays BATCH-scoped, and that IS the merge rule (D3).** Every
>   per-row context carries the one payload, not a copy. A rewrite therefore
>   applies to the whole batch whoever made it, rewrites accumulate in dispatch
>   order, N post-hook payloads cannot diverge, nothing is reconciled, and no
>   predicate write is ever split into N single-row writes. One `updateMany`,
>   one affected count (#4639), one aggregate `data.records.updated`. A rewrite
>   *conditioned* on the row is out of contract: it widens to every matched row
>   rather than scoping itself. Per-row `previous` is supplied so a guard can
>   REFUSE, not so a rewrite can be aimed.
> - **`input.id` stops being a reroute lever, on this path only (D4).** A
>   per-row context arrives with `id` already bound and the dispatch decided, so
>   rebinding it retargets nothing; it is refused rather than ignored, because a
>   silent no-op is the failure this family exists to abolish.
> - **One ceiling, both phases (D6).** `MAX_BULK_PER_ROW_HOOK_ROWS` (10 000)
>   governs `before*` exactly as it governs `after*`, and the check runs before
>   the FIRST per-row dispatch — so an over-ceiling batch runs zero handlers and
>   writes nothing, rather than running 10 001 and then throwing. Still a
>   refusal, never a downgrade. `resolveBulkPerRowHookBudget` is the rule,
>   executable, and the engine half replaces its open-coded copy with it.
> - **One read, reused (D7).** The row set is read once, with the composed AST
>   the write binds, and serves validation (#3106), the `readonlyWhen` strip
>   (#3042) and both per-row dispatches. The ruling forbids a second fetch in as
>   many words.
>
> **Why per-row payload COPIES plus a reconciliation rule was rejected.** It is
> the obvious alternative and it is defeated by a measured fact, so the evidence
> is recorded rather than left to be rediscovered: objectql's own
> `sys_stamp_audit_update` builtin is registered on `'*'` and reads
> `new Date().toISOString()` **inside** the per-record stamp. Under per-row
> dispatch that is one clock read per row, so rows either side of a millisecond
> boundary carry different `updated_at` values — a converge-or-refuse rule would
> refuse honest batches non-deterministically, and a converge-or-split rule
> would shatter one `updateMany` into N writes for the same reason. Beside that,
> nothing measured needs divergent payloads: every `beforeUpdate` payload
> rewrite in the repo (the audit stamp, plugin-pinyin-search's companion
> projection, service-storage's copy-on-claim) is row-invariant. Refusing
> divergence also stays reversible in the safe direction — a later ADR can relax
> it, while a write that has learned to split itself cannot be un-split.
>
> **The consequences, priced as this appendix's predecessor requires.**
>
> - **`bulk_write_previous_unbound` becomes unreachable.** #5038 retired
>   `HookConditionError` for after-type hooks and Addendum I kept it alive
>   "rescoped to the before dispatch". Once the engine half lands there is no
>   dispatch left without a bound `previous`, and `isPredicateBulkWrite`
>   (`hook-wrappers.ts`) — whose whole test is "no `input.id` and `multi`" —
>   answers `false` for the before phase too. Both `HookConditionLimitation`
>   members then have neither producer nor reachable consumer, which is an
>   ADR-0049 enforce-or-remove item for the engine card, not a gap.
> - **The demand becomes effectively universal, and that is #5846's bill.** The
>   engine gates the row-set read on `hasHooksFor('beforeUpdate', object)`, and
>   objectql registers `sys_stamp_audit_update` and `sys_fetch_previous_update`
>   on `'*'` — so the gate is true for every object wherever the plugin is
>   loaded. Making those builtins express in their registration what their
>   handlers already decide at run time is #5846's, already scoped there.
> - **The dispatch ladder must be resolved BEFORE the before phase**, since the
>   row set has to be read to build the per-row contexts. That reorders a seam
>   #5846 also owns (its (a) direction moves the prior read ahead of
>   `beforeUpdate` and binds it), and it interacts with one existing capability
>   — a `beforeUpdate` handler that CLEARS `input.id` on a by-id call currently
>   converts the write into a predicate write. Deliberately **not** settled
>   here: it is a live-behaviour question on a seam another card owns, and this
>   appendix will not presume the answer. The engine half and #5846 settle it
>   together, in one edit to one ordering, and record it as an amendment.
>   **→ Settled in Amendment II.1 below.**
> - **`scripts/adr-anchors.json`'s `hook-wrappers.ts` invariant still describes
>   the batch dispatch.** It is TRUE today and must move with the engine half,
>   not before it. **→ Moved with #5574's engine half.**

---

> **Amendment II.1 (2026-08, #5574 engine half + #5846 (a)) — the `input.id`
> reroute lever is RETIRED, and refused loudly.**
> _Settles the item Addendum II left open by name. Delivered in the same PR that
> delivered the per-row `before*` dispatch, because it is the same edit to the
> same ordering._
>
> **The capability, stated exactly.** `update()` and `delete()` dispatched their
> `before*` event FIRST and only then read `hookContext.input.id` to choose the
> driver call. The id slot therefore doubled as a control lever: a handler
> assigning `ctx.input.id = undefined` on a by-id call converted the write into
> a PREDICATE write over the caller's `where`; a handler assigning a different
> id moved the write to another row (`delete()` supported that explicitly, by
> re-reading the pre-image for the new target — #5272).
>
> **Why it cannot survive the reorder.** A per-row `before*` context is BUILT
> from the matched row set, so the row set must be in hand before the first
> dispatch, so the branch that decides whether there IS a row set must be
> decided before that. #5846's (a) direction lands in the same edit: the by-id
> path reads its prior row ahead of the dispatch and binds `previous` there. By
> the time any handler runs, the target is settled — `previous`, the
> `readonlyWhen` strip and every validation rule have already been computed
> against the row the ladder chose.
>
> **The three options, and the choice.** *Ignore it* — the assignment retargets
> nothing and says nothing, which is the silent no-op D4 exists to abolish, and
> here the write still lands on the ORIGINAL row. *Honour it by re-resolving* —
> the write lands on a row whose pre-image was never read, whose `readonlyWhen`
> locks were never evaluated and whose rules were checked against a different
> record: silently weaker enforcement, aimed by a hook. *Refuse* — chosen. The
> write is rejected with `HookTargetRebindError`
> (`objectql/src/hook-target-rebind-errors.ts`, code `ERR_HOOK_TARGET_REBIND`,
> an `ERR_`-prefixed operational code on the error's own bag and deliberately
> NOT an ADR-0112 wire code, same reasoning as the budget refusal). The message
> NAMES the retired capability, so an author whose handler stopped working
> learns what changed instead of watching a write land somewhere unexpected.
>
> **Scope, stated precisely, because the two verbs do NOT answer alike.**
>
> | | CLEARED id | REBOUND to another id |
> |---|---|---|
> | `update()` by-id | refused | refused |
> | `delete()` by-id | refused | **honoured** (#5272's re-read, unchanged) |
> | either, per-row | refused (D4) | refused (D4) |
>
> The CLEARED column is uniform because the ladder reorder leaves it no answer
> of its own: clearing worked by falling through to the predicate branch, and
> that branch is chosen before any handler runs. That is the capability this
> amendment retires, and it is the one the ruling names.
>
> The REBOUND column is not uniform, and the asymmetry is principled rather
> than an oversight. The case against honouring a rebind is that the write would
> land on a row whose pre-image, `readonlyWhen` locks and validation rules were
> never evaluated — and on `delete()` that is simply not true: #5272 already
> RE-RESOLVES the new target, re-reading its pre-image and rebinding `previous`
> before `afterDelete` or the summary recompute can see it. `update()` has no
> such mechanism and would have to grow one, which is the "silently pick
> re-resolution instead" this ruling forbids. So `update()` refuses and
> `delete()` keeps honouring, until the delete-side repoint is ruled on as its
> own question (#6752) — deliberately NOT folded in here as a rider on an
> ordering change.
>
> Premise for the retirement, checked against `origin/main`: the only
> `ctx.input.id` assignment in the whole repository was one engine test forcing
> the fail-closed AST assertion, which is now the refusal's own pin.
>
> **What replaces it, for each thing it was used for.** Write a different row:
> `ctx.api` / `ctx.ql` for that row explicitly. Write many rows: have the caller
> pass `{ multi: true, where: … }`. Stop this write: throw from the handler —
> the supported way for a `before*` guard to refuse, and the one the per-row
> `previous` binding exists to enable.
>
> **One consequence priced with it.** `ENGINE_UPDATE_REJECT_MESSAGE` /
> `ENGINE_DELETE_REJECT_MESSAGE` used to be raised AFTER the before phase, so a
> handler binding `input.id` could convert a rejecting call into a by-id write.
> That is the same lever pointed the other way; with the ladder resolved first
> the refusal lands before any handler runs and before anything is read.

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
