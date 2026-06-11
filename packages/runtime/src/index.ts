// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Export Kernels
export { ObjectKernel } from '@objectstack/core';

// Export Runtime
export { Runtime } from './runtime.js';
export type { RuntimeConfig } from './runtime.js';

// Export Standalone Stack
export { createStandaloneStack, resolveObjectStackHome } from './standalone-stack.js';
export type { StandaloneStackConfig, StandaloneStackResult } from './standalone-stack.js';

// Export Default Host (artifact-first, no objectstack.config.ts required)
export { createDefaultHostConfig, resolveDefaultArtifactPath } from './default-host.js';
export type { DefaultHostConfigOptions, DefaultHostConfigResult } from './default-host.js';

// Export Plugins
export { DriverPlugin } from './driver-plugin.js';
export { AppPlugin, collectBundleHooks, collectBundleFunctions, collectBundleActions } from './app-plugin.js';
export { SeedLoaderService } from './seed-loader.js';
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
export { HttpServer } from './http-server.js';
export { HttpDispatcher } from './http-dispatcher.js';
export type { HttpProtocolContext, HttpDispatcherResult } from './http-dispatcher.js';
// ADR-0006 generic kernel-resolution seam (retained framework contract; the
// multi-tenant implementation lives in cloud `@objectstack/objectos-runtime`).
export type { KernelResolver } from './http-dispatcher.js';
export { MiddlewareManager } from './middleware.js';

// ── Security primitives ───────────────────────────────────────────────
// Adapter-agnostic helpers for response hardening (CSP/HSTS/XCTO/…)
// and per-IP token-bucket rate limiting. The dispatcher plugin wires
// security headers automatically; rate limiting is exposed as a
// primitive so adapters can mount it at the appropriate layer (see
// `docs/guide/hardening.md`).
export {
    buildSecurityHeaders,
    type SecurityHeadersOptions,
    RateLimiter,
    DEFAULT_RATE_LIMITS,
    type RateLimitBucketConfig,
    type RateLimitDecision,
    type RateLimitDefaults,
    type RateLimitStore,
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
// manager, artifact fetching, the auth proxy, per-environment kernel
// construction, platform SSO, marketplace browse/install, the
// runtime-config endpoint — lives in the cloud distribution
// (`@objectstack/objectos-runtime`). ADR-0006 Phase 4 removed the
// framework's deprecated duplicate cloud plugins (MarketplaceProxyPlugin,
// MarketplaceInstallLocalPlugin, RuntimeConfigPlugin, cloud-url; =
// cloud ADR-0007 ⑤). The framework keeps only the generic contracts a host
// runtime needs to plug in an externally-supplied multi-tenant kernel
// router: `KernelResolver` (exported above with HttpDispatcher) and the
// `EnvironmentDriverRegistry` / `KernelManager` interfaces below (D3 —
// converged into the resolver seam in Phase 5).
export type { EnvironmentDriverRegistry, KernelManager } from './cloud/environment-registry.js';

// Export Sandbox (script body runner) — engine choice is quickjs-emscripten.
// See packages/runtime/src/sandbox/script-runner.ts for the decision rationale.
export { UnimplementedScriptRunner, QuickJSScriptRunner, SandboxError, hookBodyRunnerFactory, actionBodyRunnerFactory } from './sandbox/index.js';
export type {
  ScriptRunner,
  ScriptContext,
  ScriptOrigin,
  ScriptResult,
  ScriptRunOptions,
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



