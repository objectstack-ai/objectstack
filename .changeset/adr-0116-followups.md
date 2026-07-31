---
"@objectstack/plugin-auth": patch
"@objectstack/plugin-webhooks": patch
---

fix(plugin-auth,plugin-webhooks): retire a dead degrade branch and an implicit transitive dependency (ADR-0116 follow-ups, #4187)

Two concrete findings from the ADR-0116 consumer-side audit, plus the
authoring rule that would have prevented both.

**`plugin-auth` claimed a fallback it did not have.** `init()` ran
`const dataEngine = ctx.getService('data'); if (!dataEngine) { warn('No data
engine service found - auth will use in-memory storage') }`. That branch could
never execute: `getService` **throws** for an unregistered service rather than
returning `undefined`, and this plugin declares a hard dependency on ObjectQL
(which registers `data` unconditionally), so a kernel without the engine fails
even earlier with `Dependency … not found`. The branch is removed and the real
contract is declared — `requiresServices: ['data', 'manifest']` — which also
replaces a trailing `// manifest service required` comment with the
machine-checked form of the same claim. `AuthManager` keeps its own optional
`dataEngine` guards: it is usable outside the plugin.

**`plugin-webhook-outbox` was protected only transitively.** It resolves
`manifest` in `init()` with no fallback while depending on
`com.objectstack.service.messaging`, which in turn depends on ObjectQL, the
actual provider. That works today and would have broken silently the day
messaging stopped depending on the engine — surfacing as a crash inside an
unrelated plugin's init. It now declares `requiresServices: ['manifest']`
directly.

Neither change alters ordering or boot outcomes on any current composition:
both plugins were already ordered correctly. What changes is what a broken
composition *says*, and that the guarantees are now checked rather than
inherited.

Docs: `content/docs/plugins/anatomy.mdx` gains the three ADR-0116 fields and
the decision rule for resolving a service inside `init()` (hard dependency vs
`optionalDependencies` + `requiresServices`), including the two traps behind
these fixes — don't rely on a transitive provider, and don't write an
`if (!svc)` fallback after a bare `getService`. The api-registry example
declares the contract on all seven of its plugins instead of relying on
`kernel.use()` order.
