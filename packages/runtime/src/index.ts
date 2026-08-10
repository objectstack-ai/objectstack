// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Export Kernels
export { ObjectKernel } from '@objectstack/core';

// Export Runtime
export { Runtime } from './runtime.js';
export type { RuntimeConfig } from './runtime.js';

// Export Standalone Stack
export { createStandaloneStack, resolveObjectStackHome, resolveStandaloneDatabase } from './standalone-stack.js';
export type { StandaloneStackConfig, StandaloneStackResult, ResolvedStandaloneDatabase } from './standalone-stack.js';

// The ONE libSQL/Turso loader (#6268). Public because `@objectstack/cli` is a
// consumer, not a second implementation: `utils/storage-driver.ts` delegates to
// `loadTursoDriverFactory` and RE-EXPORTS `MissingDriverPackageError`, so
// `serve.ts`'s `e instanceof MissingDriverPackageError` fatal branch tests one
// class identity rather than one of two same-named twins.
export {
  loadTursoDriverFactory,
  isTursoDriverId,
  MissingDriverPackageError,
  TURSO_DRIVER_PACKAGE,
  TURSO_DRIVER_INSTALL_COMMAND,
} from './turso-driver-factory.js';
export type { LoadTursoDriverFactoryOptions } from './turso-driver-factory.js';

// The ONE default-database resolution shared by `os dev` / `os start` /
// `os migrate` (#6469) — commands map their flags onto it; no command carries
// its own fallback filename.
export {
    resolveProjectDatabaseUrl,
    normalizeDatabaseUrl,
    UNIFIED_DEFAULT_DB_FILENAME,
    LEGACY_DEFAULT_DB_FILENAMES,
} from './resolve-project-database.js';
export type {
    ResolveProjectDatabaseUrlOptions,
    ResolvedProjectDatabaseUrl,
    ProjectDatabaseUrlSource,
} from './resolve-project-database.js';

// Export Default Host (artifact-first, no objectstack.config.ts required)
export { createDefaultHostConfig, resolveDefaultArtifactPath } from './default-host.js';
export type { DefaultHostConfigOptions, DefaultHostConfigResult } from './default-host.js';

// Export Plugins
export { DriverPlugin } from './driver-plugin.js';
// Boot reconciliation for the ADR-0119 D2 migration journal (#4617) — surfaces
// runs that started and never concluded, and owns the `migration-plans`
// registry `os migrate resume` looks plans up in.
export { MigrationRecoveryPlugin, describeInterruptedRun } from './migration-recovery-plugin.js';
export { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
export type { DefaultDatasourceDefinition, DefaultDatasourcePluginOptions } from './default-datasource-plugin.js';
export { AppPlugin, collectBundleHooks, collectBundleFunctions, collectBundleFunctionEntries, collectBundleActions } from './app-plugin.js';
export { SeedLoaderService } from './seed-loader.js';
// Boot-summary seed outcome accumulator (#3415/#3430) — the single writer
// contract shared by AppPlugin and the marketplace rehydrate/heal path.
export { recordSeedOutcome } from './seed-summary.js';
export type { SeedSourceOutcome } from './seed-summary.js';
// Multi-tenant seed-replay registry (#3453) — the register-once-then-mutate
// contract shared by AppPlugin and the marketplace install path so a new org
// replays the UNION of every seed source, not just the first one.
export { mergeSeedDatasets, readSeedDatasets, registerSeedReplayerOnce } from './seed-datasets.js';
export { declareSeedSource, readSeedSettlement } from './seed-settlement.js';
export type { SeedSourceHandle } from './seed-settlement.js';
// External Datasource Federation — boot-validation gate (ADR-0015, Gate 2)
export { ExternalValidationPlugin, createExternalValidationPlugin } from './external-validation-plugin.js';
export type { ExternalSchemaDriftEvent } from './external-validation-plugin.js';
// NOTE: the runtime-UI datasource lifecycle host glue (ADR-0015 Addendum —
// default driver factory + secret binder) was extracted into the private
// `@objectstack/datasource-admin` package and no longer ships here.
export { createDispatcherPlugin } from './dispatcher-plugin.js';
export type { DispatcherPluginConfig } from './dispatcher-plugin.js';
export { createSystemEnvironmentPlugin, SYSTEM_ENVIRONMENT_ID } from './system-environment-plugin.js';
export type { SystemEnvironmentPluginConfig } from './system-environment-plugin.js';

// Export HTTP Server Components
// NOTE: the `HttpServer` delegating wrapper (`./http-server.ts`) is RETIRED
// (#5122, #4939 precedent). It declared `implements IHttpServer` but forwarded
// only the REQUIRED members, so every optional one — `getPort`, `getRawApp`
// and above all `setFallbackHandler`, the single seam declarative `apis:`
// endpoints enter through since #5111 — read as absent to the `typeof x ===
// 'function'` probe the contract tells consumers to use. Do not reintroduce a
// same-shaped wrapper: a host composes the framework by registering an
// `IHttpServer` ADAPTER INSTANCE as `http.server`, which is what every real
// host already does. Absence is held by `http-server-retirement.test.ts`.
export { HttpDispatcher } from './http-dispatcher.js';
export type { HttpProtocolContext, HttpDispatcherResult } from './http-dispatcher.js';
// ADR-0006 generic kernel-resolution seam (retained framework contract; the
// multi-tenant implementation lives in cloud `@objectstack/objectos-runtime`).
export type { KernelResolver } from './http-dispatcher.js';
// ADR-0076 D11 step ③ — thin domain-handler registry seam; owning service
// packages register normalized handlers via HttpDispatcher.registerDomainHandler.
export { DomainHandlerRegistry } from './domain-handler-registry.js';
export type { DomainRoute, DomainHandler, DomainRequest, DomainHandlerDeps } from './domain-handler-registry.js';
export { MiddlewareManager } from './middleware.js';

// ── Security primitives ───────────────────────────────────────────────
// Adapter-agnostic helpers for response hardening (CSP/HSTS/XCTO/…) and
// token-bucket rate limiting.
//
// The dispatcher plugin wires BOTH automatically: security headers on
// every response it mounts, and — when the stack declares
// `server.security.rateLimit` — the inbound limiter as global middleware
// on the `http.server` service (#4910). The pieces stay exported because
// a host that composes its own transport still needs them; they are not
// exported *instead* of being wired, which is what the previous version
// of this comment claimed while pointing at a guide that did not exist
// (#4937).
export {
    buildSecurityHeaders,
    type SecurityHeadersOptions,
    RateLimiter,
    DEFAULT_RATE_LIMITS,
    applyTokenBucket,
    bucketIdleTtlSeconds,
    type BucketState,
    type RateLimitBucketConfig,
    type RateLimitDecision,
    type RateLimitDefaults,
    type RateLimitStore,
    createInboundRateLimitMiddleware,
    deriveBucketConfig,
    resolveRateLimitKey,
    SharedTokenBucketLimiter,
    type InboundRateLimitBudget,
    type InboundRateLimitOptions,
    type RateLimitKeyInput,
    type RateLimitKeyKind,
    type RateLimitLogger,
    type ActorUser,
} from './security/index.js';

// ── Observability primitives ──────────────────────────────────────────
// Request-id propagation (X-Request-Id + W3C traceparent), pluggable
// MetricsRegistry, and pluggable ErrorReporter. The dispatcher plugin
// wraps every route with instrumentation when these are configured;
// see `docs/guide/observability.md`.
export {
    extractRequestId,
    generateRequestId,
    resolveRequestId,
    parseTraceparent,
    formatTraceparent,
    type TraceContext,
    NoopMetricsRegistry,
    InMemoryMetricsRegistry,
    RUNTIME_METRICS,
    type MetricsRegistry,
    type MetricSample,
    NoopErrorReporter,
    InMemoryErrorReporter,
    type ErrorReporter,
    type CapturedError,
    ObservabilityServicePlugin,
    OBSERVABILITY_METRICS_SERVICE,
    OBSERVABILITY_ERRORS_SERVICE,
    resolveMetrics,
    resolveErrorReporter,
    type ObservabilityServicePluginOptions,
} from './observability/index.js';

// Export Artifact Loader
export { loadArtifactBundle, mergeRuntimeModule, isHttpUrl, readArtifactSource } from './load-artifact-bundle.js';
export type { LoadArtifactBundleOptions } from './load-artifact-bundle.js';

// ── ObjectOS Cloud Runtime (artifact-fetching shared multi-tenant host) ───────
// Multi-tenant / cloud-operations code is NOT part of the framework
// (ADR-0006). The MULTI-TENANT runtime — createObjectOSStack, the kernel
// manager, environment registries, artifact fetching, the auth proxy,
// per-environment kernel construction, platform SSO, marketplace
// browse/install, the runtime-config endpoint — lives in the cloud
// distribution (`@objectstack/objectos-runtime`). Phase 4 removed the
// framework's duplicate cloud plugins (= cloud ADR-0007 ⑤); Phase 5
// converged the dispatcher's environment resolution + kernel routing into
// the single generic `KernelResolver` seam (exported above with
// HttpDispatcher) — the only multi-tenant contract the framework retains.

// Export Sandbox (script body runner) — engine choice is quickjs-emscripten.
// See packages/runtime/src/sandbox/script-runner.ts for the decision rationale.
export { UnimplementedScriptRunner, QuickJSScriptRunner, SandboxError, hookBodyRunnerFactory, actionBodyRunnerFactory } from './sandbox/index.js';
export type {
  ScriptRunner,
  ScriptContext,
  ScriptOrigin,
  ScriptResult,
  ScriptRunOptions,
  ScriptSession,
  ScriptUser,
  QuickJSScriptRunnerOptions,
} from './sandbox/index.js';

// Re-export from @objectstack/rest
export {
    RestServer,
    RouteManager,
    RouteGroupBuilder,
    createRestApiPlugin,
} from '@objectstack/rest';
export type {
    RouteEntry,
    RestApiPluginConfig,
} from '@objectstack/rest';

// Export Types
export * from '@objectstack/core';
export { readEnvWithDeprecation, _resetEnvDeprecationWarnings } from '@objectstack/types';



