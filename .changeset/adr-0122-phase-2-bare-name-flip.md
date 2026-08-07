---
"@objectstack/spec": major
---

feat(spec)!: the bare type name is now the AUTHOR state — 1384 aliases flipped, 102 `XInput` synonyms retired (ADR-0122 phase 2, #6083)

A Zod schema denotes two types: `z.input` (what an author writes — defaulted keys
optional, pre-transform) and `z.infer` (what `.parse()` returns). Until protocol 17 the
bare name `X` meant the second one in 1384 places and the first one in 86, with nothing
recorded about which was which.

**[ADR-0122](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0122-schema-type-alias-naming-convention.md)
settles it: the bare name `X` is the AUTHOR state, `XParsed` is the PARSED state.**
Phase 1 (16.x, additive) gave every schema with two distinct shapes its `XParsed` name so
nothing would be stranded. **This release is phase 2: it flips the bare names.** It is the
breaking half, and it is the reason `@objectstack/spec` goes to 17.0.0.

```ts
// before (16.x)                              // after (17.0.0)
export type Connector       = z.infer<…>;     export type Connector       = z.input<…>;
export type ConnectorParsed = z.infer<…>;     export type ConnectorParsed = z.infer<…>;
export type ConnectorInput  = z.input<…>;     // ConnectorInput: RETIRED
```

## FROM → TO

There are exactly two migrations, and each has a mechanical test.

### 1. `XInput` → `X` (102 names removed)

The flip made `XInput` a character-for-character synonym of the bare name, and ADR-0122
D3 forbids a permanent synonym. Every retired name has the same fix: **drop the `Input`
suffix.**

```diff
- import type { ConnectorInput } from '@objectstack/spec/integration';
- const c: ConnectorInput = { name: 'acme', label: 'Acme', type: 'saas' };
+ import type { Connector } from '@objectstack/spec/integration';
+ const c: Connector = { name: 'acme', label: 'Acme', type: 'saas' };
```

Find them: `rg '\b\w+Input\b' --type ts` over your own code, then keep only the hits that
resolve to `@objectstack/spec`. Every one of them is a compile error on upgrade — there is
no silent failure in this direction, because the name is gone.

The 102 retired names, by module:

| module | retired |
|:---|:---|
| `api/auth` | `SessionUserInput`, `LoginRequestInput` |
| `api/dispatcher` | `DispatcherRouteInput`, `DispatcherConfigInput` |
| `api/endpoint` | `ApiEndpointInput` |
| `api/plugin-rest-api` | `RequestValidationConfigInput`, `ResponseEnvelopeConfigInput`, `ErrorHandlingConfigInput`, `OpenApiGenerationConfigInput`, `RestApiPluginConfigInput` |
| `api/protocol` | `NotificationPreferencesInput`, `NotificationInput` |
| `api/query-adapter` | `RestQueryAdapterInput`, `ODataQueryAdapterInput`, `QueryAdapterConfigInput` |
| `api/rest-server` | `RestApiConfigInput`, `CrudEndpointsConfigInput`, `MetadataEndpointsConfigInput`, `BatchEndpointsConfigInput`, `RouteGenerationConfigInput`, `RestServerConfigInput` |
| `api/versioning` | `VersioningConfigInput` |
| `automation` | `FlowFunctionDeclarationInput`, `ActionDescriptorInput`, `TimeRelativeTriggerInput`, `WebhookInput` |
| `data/analytics` | `CubeInput`, `AnalyticsQueryInput` |
| `data/datasource` | `DatasourceInput` |
| `data/field` | `FieldParseInput` (→ `Field`), `CurrencyConfigInput` |
| `data/mapping` | `MappingInput` |
| `data/object` | `ObjectFieldGroupInput`, `RowCrudActionOverrideInput`, `ServiceObjectInput`, `ObjectExtensionInput` |
| `data/seed`, `data/seed-loader` | `SeedInput`, `SeedLoaderConfigInput`, `SeedLoaderRequestInput` |
| `identity` | `EvalUserInput`, `PositionInput` |
| `integration/connector` | `ConnectorInput` |
| `kernel` | `ClusterCapabilityConfigInput`, `ExecutionContextInput`, `ObjectStackManifestInput`, `PackageArtifactInput`, `PluginVendorInput`, `PluginQualityMetricsInput`, `PluginStatisticsInput`, `PluginRegistryEntryInput`, `PluginSearchFiltersInput`, `PluginInstallConfigInput`, `ServiceRegistryConfigInput`, `StartupOptionsInput` |
| `security` | `ExplainRequestInput`, `AdminScopeInput`, `PermissionSetInput`, `SharingRuleInput` |
| `system` | `CacheTierInput`, `CacheConfigInput`, `DistributedCacheConfigInput`, `BackupConfigInput`, `FailoverConfigInput`, `DisasterRecoveryPlanInput`, `EmailTemplateDefinitionInput`, `KeyRotationPolicyInput`, `EncryptionConfigInput`, `FieldEncryptionInput`, `EnvironmentArtifactInput`, `RouteHandlerMetadataInput`, `MiddlewareConfigInput`, `ServerCapabilitiesInput`, `JobInput`, `FeatureInput`, `PlanInput`, `SecurityContextConfigInput`, `StackServerConfigInput`, `RowLevelIsolationStrategyInput`, `SchemaLevelIsolationStrategyInput`, `DatabaseLevelIsolationStrategyInput`, `TenantSecurityPolicyInput`, `TranslationBundleInput`, `TaskRetryPolicyInput`, `TaskInput`, `QueueConfigInput`, `BatchTaskInput`, `BatchProgressInput`, `WorkerConfigInput` |
| `ui` | `ActionInput`, `InlineActionInput`, `NavigationContributionInput`, `AppInput`, `DashboardInput`, `DatasetDimensionInput`, `DatasetMeasureInput`, `DatasetInput`, `PageInput`, `JoinedReportBlockInput`, `ReportInput`, `ReportChartInput`, `ReportSortInput`, `ThemeInput` |

**Nine `*Input` names are NOT retired** and need no change: `ExpressionInput`,
`CronExpressionInput`, `TemplateExpressionInput` and `PredicateInput` are the bare aliases
of their own `…InputSchema`, and `FormFieldInput`, `QueryInput`, `FieldInput`,
`ObjectStackDefinitionInput` and `NavigationItemInput` are composed types (recursive or
`Partial`-shaped) that no bare alias denotes.

### 2. `X` → `XParsed` **only where you hold a parse result**

If you annotate a value you *wrote*, do nothing — the bare name is now correct, and this
is the whole point of the change:

```ts
// This did not compile in 16.x unless you knew to write `ConnectorInput`.
// In 17.0.0 it is simply right, in every domain.
const c: Connector = { name: 'acme_erp', label: 'Acme ERP', type: 'saas' };
```

If you annotate a value that came *out of* `.parse()` (or out of a `defineX()` factory, or
off the wire after the engine parsed it) and you read a defaulted key from it, move that
annotation to `XParsed`:

```diff
- const parsed: Connector = ConnectorSchema.parse(raw);
+ const parsed: ConnectorParsed = ConnectorSchema.parse(raw);
  if (parsed.enabled) { … }   // `enabled` is `boolean` here, `boolean | undefined` on `Connector`
```

**The grep that finds these:** `rg 'Schema\.parse\(' -A2` and `rg ': *\w+ *= *await'` in
your own code, then check each annotation. **The reliable finder is the compiler**: every
site that reads a defaulted key off an author-state value is a `TS18048` /
`TS2532` ("possibly undefined") or a `TS2345`. Upgrade, run `tsc`, and fix what it names. In
this repo — 1127 files annotate a value with a spec type — that came to **40 files outside
`packages/spec`**, and every one of them was a compile error first, never a silent change.

**The one case tsc cannot name for you:** a *function's declared return type*. A parse
result is structurally assignable to the author state, so

```ts
function loadConnector(): Connector { return ConnectorSchema.parse(raw); }  // still compiles!
```

keeps compiling while quietly promising callers less than it delivers. If you have
factories or loaders that return a parsed value, re-declare them as `XParsed` by hand.
`@objectstack/spec`'s own 24 `defineX` factories were migrated exactly this way —
`defineApp(...)` now returns `AppParsed`, `defineConnector(...)` returns `ConnectorParsed`,
and so on for every factory whose schema has two shapes.

## What did NOT change

- **No runtime behaviour.** Not one `.parse()` call, `.default()`, `.transform()` or schema
  shape moved. This release changes which type name describes which value, nothing else.
- **`json-schema/` and `authorable-surface/` are byte-identical.** Those generators read
  runtime `z.ZodType` exports, never type aliases.
- **Your metadata files.** `*.object.ts`, `*.view.ts`, connector and flow definitions
  authored with `defineX(...)` are untouched. Bare-literal metadata files typed with
  `XInput` need the suffix dropped and nothing else.

## Also in this release

- **`check:spec-parsed-alias` is inverted.** It used to require every bare `z.infer` alias
  to be paired or pinned; the flip empties that population, so it now refuses a bare name
  that reads `z.infer` (the flip, enforced), refuses an `XInput` synonym of a bare name
  (the retirement, enforced), and keeps the paired-or-pinned and stale-pin arms on the
  flipped form.
- **57 previously ungoverned aliases were audited.** Inverting the gate widened it to the
  86 aliases that already read `z.input`, which phase 1 never examined. 22 gained an
  `XParsed`; 35 were proved isomorphic and pinned, adding 35 to the pin registry (716 → 751
  on the merged tree, after #5055's four retirements and #5775's one addition). This closes
  #5507's remaining scope.
- **`@objectstack/spec` public surface: 106 export names removed, 24 added.** The removals
  are the 102 `XInput` aliases (plus re-exports); the additions are the 22 new `XParsed`
  names (plus re-exports). All type-only — no runtime code, no bundle-size change.

<!-- adr-0087: registered spec-type-alias-input-suffix-retired -->
