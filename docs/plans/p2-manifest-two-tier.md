# Plan: P2 — Manifest Two-Tier + D6/D7 Validation (ADR-0019)

> **Status:** Landing draft (warn-only). Implements ADR-0019 Phase P2.
> **Scope:** `@objectstack/spec` only. No runtime/registry changes (those are P4).

## What P2 delivers

ADR-0019 P2 = "two-tier `type`; `isConsumerInstallable`; App-purity (D6) and
`requires`-shape (D7) validation; Marketplace filters to `type: app`."

This draft lands the **schema/primitive + validator** half, deliberately
**non-breaking** (warn-only), and defers the policy switch + Marketplace filter
to follow-ups once the reference apps are migrated.

### Shipped in this draft

| Piece | File | Notes |
|---|---|---|
| Tier constants + predicate | `packages/spec/src/kernel/plugin.zod.ts` | `CONSUMER_INSTALLABLE_TYPES = ['app']`, `isConsumerInstallable(type)`. Additive; the `type` enum is unchanged (D2 is a *semantic* split, not a schema removal). |
| D6 purity validator | `packages/spec/src/kernel/consumer-app-rules.ts` | `validateConsumerAppPurity(manifest, stackCodeSurfaces?)` → `string[]`. Flags code-bearing `contributes.*`, `capabilities.provides/extensions`, and bundled `plugins/devPlugins` on a `type: app`. |
| D7 requires-shape validator | same file | `validateRequiresShape(requires)` → `string[]`. Tokens must match `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$` (e.g. `sql`, `sys.sql`); rejects paths, npm specs, version pins. |
| Wiring (warn-only) | `packages/spec/src/stack.zod.ts` | `defineStack()` runs both validators and `console.warn`s violations. **Does not throw.** |
| Tests | `packages/spec/src/kernel/consumer-app-rules.test.ts` | 10 tests, green. |

### Why warn-only (not enforced)

A scan shows the current reference apps are **not** pure metadata today:

- `examples/app-crm/objectstack.config.ts` — `type: app`, imports
  `* as actions from './src/actions/index.js'` (JS action code).
- `examples/app-showcase/objectstack.config.ts` — same pattern.

Turning D6 into a hard error now would break `defineStack` for these and any
similar app. So this draft only **warns**, surfacing the gap without blocking.
Their `requires: ['ui','automation']` already satisfy D7 (abstract tokens), so
D7 is effectively clean today.

## Definition of "code" enforced here (D6 line)

"Code" = a reference to an external runtime module. In manifest terms, the
code-bearing surfaces flagged are:

- `contributes.drivers | actions | commands | functions | fieldTypes | kinds`
- `capabilities.provides` (providing a service is a code-plane role)
- `capabilities.extensions[].implementation` (module path)
- stack-level `plugins` / `devPlugins`

**Not** code (allowed in a pure App): formula, ObjectQL, flow/approval/
validation expressions, agent prompt + declarative tool bindings, and all
declarative metadata (objects, views, pages, dashboards, reports, …).

## Deferred (follow-up PRs)

1. **Flip to hard error at the publish boundary.** The Marketplace publish path
   (not `defineStack`) should treat D6/D7 violations as **errors** for consumer
   `type: app` listings. `defineStack` may stay warn-only (authoring) or gain an
   opt-in `{ enforceConsumerAppRules: true }`.
2. **Marketplace `type: app` filter.** Filter consumer listings/search in
   `marketplace.zod.ts` + the Console `marketplace` UI to `isConsumerInstallable`.
3. **Migrate reference apps.** Move `app-crm` / `app-showcase` action code to
   code-plane packages and express the dependency via `requires` — proving the
   D6/D7 model end-to-end. This is the real migration cost and validates the
   line above.
4. **D4 namespace-set** (registry-level) and **P4 capability registry + install
   gate** (the load-bearing wall) remain separate per ADR-0019.

## Open question carried from ADR-0019

The D6 line (`PluginSource` = code) has edge cases — e.g. a declarative formula
that invokes a server action which is itself code. P2 flags the *declared*
code surfaces; a precise rule for *transitive* reach is still open and tracked
in ADR-0019 §Open questions.

## Verification

```
cd packages/spec
pnpm exec vitest run src/kernel/consumer-app-rules.test.ts   # 10 passed
pnpm exec vitest run src/kernel/manifest.test.ts src/stack.test.ts  # 101 passed (no regression)
pnpm exec tsc --noEmit                                       # clean
```
