---
"@objectstack/core": patch
"@objectstack/runtime": patch
"@objectstack/platform-objects": patch
"@objectstack/plugin-security": patch
"@objectstack/cloud-connection": patch
---

fix(lint,runtime,core): the slot-lookup guard sees the split-declaration form — the shape that made the ratchet look cleaner the more it was used (#4251)

The three selectors from #4321 all key off the erasure and the lookup being in
ONE expression. Split them and every selector misses:

```ts
let ql: any;
try { ql = ctx.getService('objectql'); } catch { /* optional */ }
```

Selector 1 needs the call inside the declarator (this declarator has no init),
selector 2 needs `as`, selector 3 needs a type argument. The contract is erased
exactly as in `const ql: any = ctx.getService(…)`.

**Why this could not wait for the batches.** The baseline's monotonicity check
means a file that leaves the grandfather list can never be re-added. So every
batch converted more of this shape from "grandfathered" into "lint covers this
file and says nothing" — B2 alone moved `plugin-security/security-plugin.ts`
into that state. A ratchet that reports a cleaner number the more you sweep is
the #4342 failure wearing different clothes, and the fix only gets more
expensive per batch shipped.

**It is a rule, not a fourth selector, and that is the whole finding.** esquery
can match `AssignmentExpression:has(CallExpression[…])`, but it cannot tell
which declaration the assigned identifier resolves to — so it would equally
flag the correctly-typed form this work line exists to produce (`let
i18nService: II18nService | undefined; i18nService = …`, 8 such sites today in
runtime/app-plugin.ts, service-automation and metadata-protocol). Resolving the
identifier needs SCOPE analysis. That is cheap and needs no type information, so
this stays out of the typed-lint pass the KNOWN RESIDUAL still waits on — but it
is a rule, and the earlier "just one more selector" estimate was wrong.

Verified against exactly that: the rule flags all 16 real sites and none of the
8 correctly-typed lookalikes.

**Scale.** The baseline goes 140 → **169 sites** with the file count unchanged
at 37: 29 sites were already inside grandfathered files and simply invisible.
16 more could NOT be grandfathered (12 in files earlier batches had cleared, 3
in files never listed, 1 the regex sweep had missed) and are typed here —
`runtime/app-plugin.ts` ×5, `core/fallbacks/authored-translation-sync.ts` ×2,
`plugin-security/security-plugin.ts` ×2, `cloud-connection/{runtime-config,
marketplace-proxy}-plugin.ts` ×3, `platform-objects/src/plugin.ts` ×2,
`runtime/http-dispatcher.ts`, `runtime/domains/ai.ts`. No baseline key was
added; the key set still only shrinks.

Contracts where they exist (`IAIService`, `IJobService`, `IMetadataService`,
`II18nService`, `IDataEngine`, `IHttpServer`), named local surfaces where they
do not — `AppEngineSurface`, `SecurityEngineSurface`, `RawAppHost`,
`EnvRegistrySurface`, `FreshDatastoreEngine`, `AuthoredTranslationSink`. Two of
those record something worth naming: `IHttpServer` has no `getRawApp()` (the
contract is framework-agnostic and the raw app is Hono's own handle), and
ObjectQL's `_defaultBodyRunner` / `_defaultActionRunner` have no public reader
at all — the engine attaches them via `(this as any)` and publishes nothing,
while `getHookMetricsRecorder()` exists for exactly that question about the
metrics recorder. Declared rather than laundered through `any`, and filed.
