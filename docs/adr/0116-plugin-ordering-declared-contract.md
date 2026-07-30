# ADR-0116: Plugin ordering is a declared contract — soft dependencies plus validated init-service requirements

**Status**: Accepted (2026-07-30)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0062](./0062-external-datasource-runtime.md) (D1/D5 — the DefaultDatasourcePlugin whose header note first wrote this contract down as prose), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert declarations — an ordering requirement that lives only in a comment is the lifecycle form of the same lie), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — the disposition method applied here to a lifecycle convention)
**Consumers**: `@objectstack/core` (`plugin-order.ts`, both kernels), `@objectstack/runtime` (`AppPlugin` — the first requirer), `@objectstack/objectql` + `@objectstack/metadata` (the first declared providers), `@objectstack/spec` (`contracts/plugin-validator.ts`, `kernel/plugin-validator.zod.ts`), `packages/cli` (serve composition comments)
**Surfaced by**: [#4131](https://github.com/objectstack-ai/objectstack/issues/4131) — the structural cause of [#4085](https://github.com/objectstack-ai/objectstack/issues/4085) (fixed positionally by PR #4110, comments trued up by PR #4138)

---

## TL;DR

The kernel resolves init/start order from the plugin dependency graph, so `kernel.use()` registration order proves nothing — yet until now the only plugins that could *say* what they need were ones whose dependency is safe to make hard. `AppPlugin` needs `manifest`/`objectql` synchronously at init but is deliberately composed on engine-less kernels too, so it could declare nothing, and its correctness rode on which array slot each caller put it in. That convention failed twice in the same subsystem (the first cut of `DefaultDatasourcePlugin`; then #4085), and the first failure's lesson — written as an excellent comment in one plugin's header — did not transfer to the next plugin.

This ADR makes the ordering contract declarable and enforced, with two small additions to the kernel `Plugin` contract and one validation pass:

- **`optionalDependencies`** — order-if-present: hoisted like `dependencies` when composed, skipped (not an error) when absent.
- **`requiresServices` / `providesServices`** — what a plugin's init consumes synchronously / unconditionally registers. The kernel validates the resolved order **before Phase 1** and again immediately before each init, so a misplaced plugin fails as a *named* structural error instead of a bare `Service 'manifest' not found` from inside the victim's init.

Auto-reordering from service declarations is deliberately **not** done (yet): ordering is driven only by declared dependencies; service declarations drive *validation and diagnosis*.

## Context

### The mechanism that already existed

`resolveDependencies()` (both kernels) topologically hoists `plugin.dependencies` ahead of the declarant, and Phase 1 (init) / Phase 2 (start) both follow the resolved order. At least 11 plugins use it — `plugin-audit`, `plugin-approvals`, `metadata-protocol`, `default-datasource`, four connectors, three app plugins, `schema-migrate`. A missing hard dependency throws.

### The gap

A plugin that needs a service at init *when its provider is composed* but must also boot *without* the provider had no way to declare anything:

- `AppPlugin.init()` registers its bundle via `getService('manifest').register(...)` (no fallback) and seeds package state / sandbox runners via `objectql` (try/catch degradation) — but is legitimately assembled on kernels with no ObjectQLPlugin at all: empty environments (`plugin.app.empty-*`), metadata-only one-shot commands (`os migrate plan`/`apply`), embedder compositions, mock-engine tests. A hard `dependencies` entry would turn every one of those boots into `Dependency ... not found`.
- So `AppPlugin` declared nothing, and every composition site carried the ordering by hand. `serve.ts` put the wrap in the wrong slot → #4085, disguised for months as "crashes when the artifact is missing" because the artifact path happened to append its AppPlugin in the right slot.

### Once is an accident, twice is a missing contract

`default-datasource-plugin.ts`'s header records the first instance: the plugin originally connected in `start()` and relied on list position; a serve boot hoisted ObjectQLPlugin ahead, boot schema-sync ran first, and the server shipped with no tables. The fix (connect in init, declare the hard dependency) was correct — and the lesson stayed in that file's header, where the next plugin with the same constraint never saw it. #4085 is the same failure with a soft constraint instead of a hard one. Documentation was tried; it does not transfer. (Option 3 of #4131 — "document + lint" — is rejected on this evidence.)

## Decision

**D1 — `optionalDependencies`: order-if-present.** Third ordering primitive next to `dependencies` and the Phase 1/2 split. Composed names are hoisted exactly like hard dependencies (they are real topology edges, including for cycle detection); absent names are skipped silently. This is the correct declaration for every "degrade without it, never init before it" plugin — `AppPlugin` declares `['com.objectstack.engine.objectql']`.

**D2 — `requiresServices` / `providesServices`: the init-service contract, validated.** `requiresServices` lists services a plugin resolves *synchronously during init()* with no fallback (a probe behind try/catch does not belong in it — `objectql` is deliberately absent from AppPlugin's list). `providesServices` lists services a plugin's init *unconditionally* registers (conditionally-registered services must not be declared — the kernel would blame orderings the plugin cannot satisfy; ObjectQLPlugin declares `objectql`/`data`/`manifest`/`lifecycle` and deliberately omits option-gated `protocol`/`objects`/`analytics`). Enforcement is two-stage, one implementation shared by both kernels (`packages/core/src/plugin-order.ts`):

1. **Pre-Phase-1 (provable misordering)**: after resolving order and before any init runs, a plugin whose required service is provided only by a *later* plugin fails the boot with an error naming both plugins, both slots, and the fix. No init side effects have happened yet.
2. **Immediately before each init (authoritative)**: Phase 1 is sequential, so a required service absent at that instant is absent for that init — the boot fails with a named composition error where it previously died inside the plugin on a bare `Service not found`. This stage never false-positives: it fires precisely where the old crash fired.

The two stages divide the problem exactly: stage 1 catches misordering that declarations can prove early; stage 2 catches genuinely absent providers, including undeclared ones. A required service with no declared provider is deliberately *not* a pre-Phase-1 error — an earlier plugin may register it without declaring `providesServices`.

**D3 — Undeclared plugins get diagnosis too.** Both kernels track which plugin is currently initializing; a `getService` miss during Phase 1 appends the structural diagnosis to the error — the initializing plugin's name, and (when a composed plugin declares the service) the provider and the directive to declare the ordering. The next plugin that reaches for a service in init *without* declaring anything still gets a named, actionable boot error instead of the bare symptom. The `Service '<name>' not found` prefix is preserved verbatim (consumers substring-match it), as is the factory-backed `is async - use await` branch.

**D4 — No auto-reordering from service declarations.** Ordering comes only from `dependencies`/`optionalDependencies`; `requiresServices`/`providesServices` drive validation and messages. Deriving topology from service declarations would make ordering emergent from declarations whose completeness nothing yet guarantees. If the declarations prove reliable in practice, a future ADR may revisit — the pre-Phase-1 check's "declare the dependency" error is the migration pressure that builds that reliability first.

**D5 — The duplicated topological sort is unified.** `ObjectKernel.resolveDependencies()` and `ObjectKernelBase.resolveDependencies()` were byte-identical copies; both now delegate to `resolvePluginOrder()` in `plugin-order.ts`. One ordering semantic, one place to read it, one place the contract is enforced from.

### What deliberately stays

- **The Phase 1/2 split** remains the primary ordering tool: everything registered in any init is visible to every start. `requiresServices` is only for *init-time* consumption; start-time needs are already covered.
- **`DefaultDatasourcePlugin`'s hard dependency** — correct as-is: every composition of that plugin composes ObjectQL.
- **Composition-site slotting** (serve.ts appends the AppPlugin wrap last) — harmless, and keeps both boot paths' logs telling one story; it is just no longer load-bearing.

## Consequences

- **+** The #4085 composition (AppPlugin `use()`d before the engine) now boots correctly — the kernel hoists the engine — instead of depending on the caller's slot discipline. Regression-tested in `app-plugin.ordering.test.ts` with a real kernel in the failure shape.
- **+** A composition genuinely missing a manifest provider fails before init side effects with an error that names the plugin, the service, and the remediation — including for plugins that declare nothing (D3).
- **+** The contract is written where the kernel enforces it (plugin class fields + `plugin-order.ts`), not in comments two files away from the code they describe.
- **−** Declarations can be wrong: a `providesServices` entry for a conditionally-registered service, or a `requiresServices` entry for a tolerated probe, produces misleading verdicts. Mitigated by the declaration rules on the fields' TSDoc and by stage 2 being immune (it checks reality, not declarations).
- **−** `providesServices` adoption is incremental (ObjectQLPlugin, MetadataPlugin today); pre-Phase-1 coverage grows as providers declare. Stage 2 and D3 carry the enforcement in the meantime.
- **Risk**: a plugin relying on initializing *before* `com.objectstack.engine.objectql` while also being named in someone's `optionalDependencies` would be re-ordered. No such plugin exists; the hoist direction is the one every documented contract already requires.
