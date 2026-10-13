---
'@objectstack/service-automation': minor
'@objectstack/plugin-security': patch
'@objectstack/runtime': patch
'@objectstack/service-analytics': patch
'@objectstack/platform-objects': patch
---

fix(service-automation)!: retire the `RunProvenanceContext` type; `RunDataContext` names only what `resolveRunDataContext` returns

Clause-②: no (narrowing)

<!-- adr-0087: not-required (runtime-interface-only packages/services/service-automation/src/runtime-identity.ts#RunDataContext) Two TypeScript-only declarations in one runtime file move, and neither is metadata: `RunDataContext` loses its `RunProvenanceContext` arm, and the `RunProvenanceContext` interface declared beside it in the same file is removed together with its type export. No spec key, authorable spelling, Zod schema or stored shape moves, and no stored row is read or rewritten, so `objectstack migrate meta` has nothing to rewrite. The channel that reaches an affected consumer is the compiler, at the consumer's own import. -->

**BREAKING** for TypeScript code that imports from `@objectstack/service-automation`: one type export is removed and one type narrows. It ships as `minor` under the launch-window convention for breaking changes. No runtime behaviour changes in any package.

**What is removed.** The `RunProvenanceContext` type export, the `{ flowRunId }`-only "provenance" envelope, and its arm of `RunDataContext`. No code in this repository builds or reads one. Since ADR-0096 D5, the data engine's security middleware refuses a context that carries no principal and is not a system context (`403 PERMISSION_DENIED`, for every verb). So the type described a context the engine refuses, while its docstring said such a context was "indistinguishable from passing no context at all" and was let through.

**What `RunDataContext` is now.** Exactly what `resolveRunDataContext` returns: `isSystem: true` for a `runAs: 'system'` run, and the triggering user's principal for a `runAs: 'user'` run. A run that resolves no principal is refused before any data operation (`AUTOMATION_UNSCOPED_RUN_DATA_ACCESS`), as before.

**If your code named the type.** There is no replacement, because the context it described is refused. A custom data node builds its context with `resolveRunDataContext(context)`, typed `RunDataContext`.

**`@objectstack/plugin-security`, `@objectstack/runtime`, `@objectstack/service-analytics`, `@objectstack/platform-objects`:** comment and docstring text only. Shipped comments that said the security middleware hands through, skips or falls open for a context with no principal now say that it used to, and that ADR-0096 D5 refuses such a context. Nothing these packages do changes.
