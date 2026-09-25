---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: the NativeSQL execute face and the `/analytics/sql` echo resolve a read-scope filter placeholder with the caller's context, and refuse one they cannot resolve, as the ObjectQL execute face already does (#20075)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: `packages/spec` is untouched and no metadata key or value changes meaning. What changes is which runtime faces resolve a read-scope placeholder and refuse one they cannot resolve; the engine behind the ObjectQL face already did both, with the same `@objectstack/core` resolver. `objectstack migrate meta` has nothing to act on and the ledger has no row to gain. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a read-scope placeholder (not `registered` / `already-registered`); and the change is runtime behaviour of a function, not a TypeScript declaration removed or narrowed (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: an accept-set narrowing on the read-scope lowering, shipped as `minor` under the launch-window convention. `minor` is also the level a new accepted option key takes.

`compileScopedFilterToSql` is the read-scope lowering behind the NativeSQL execute face (`NativeSQLStrategy.applyReadScope`, the base table and every joined hop) and the `/analytics/sql` echo (`ObjectQLStrategy.generateSql`), and a public export of this package. It never resolved a filter placeholder, so both faces bound `{current_user_id}`, `{current_org_id}` or a date macro as its literal text. The ObjectQL execute face hands the same scope to the engine, which resolves it with the caller's context. One read scope, two row sets.

It now takes an optional `context` (`ReadScopeCompileOptions.context`) and resolves the scope with `resolveFilterTokens(scope, filterTokenContextFrom(context))` from `@objectstack/core`, the resolver the engine calls, before lowering it. Both strategies pass the request's context.

| a read scope carrying | before, on the NativeSQL face and the echo | now |
|:--|:--|:--|
| a placeholder the caller's context resolves | its literal text was bound: an equality matched no row, and a `$ne` exclusion admitted every row, the caller's own included | the resolved value is bound and the echo prints it; the same rows as the ObjectQL face |
| an unknown placeholder, or a context token the request has no value for | served, with the literal bound | `READ_SCOPE_COMPILE_FAILED` / 500, message withheld, as on the ObjectQL face |

Without a context the answer is the engine's for a context-less operation: a date macro resolves against UTC now, and a context token is refused. A placeholder is never bound as its literal text.

Who is affected: a host whose own `getReadScope` returns scopes carrying placeholders, and a direct caller of `compileScopedFilterToSql`. The security service's read filter, the auto-bridged default, composes concrete values and is not affected.

Not changed: a scope with no placeholder compiles to the same SQL and parameters as before. The caller's own `where` is untouched: `AnalyticsService` already resolves its placeholders and answers an unresolvable one `FILTER_TOKEN_UNKNOWN` / `FILTER_TOKEN_UNRESOLVED` / 400 with its message. The ObjectQL execute face is untouched.
