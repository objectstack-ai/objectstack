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
export { createDispatcherPlugin } from './dispatcher-plugin.js';
export type { DispatcherPluginConfig } from './dispatcher-plugin.js';
export { createSystemEnvironmentPlugin, SYSTEM_ENVIRONMENT_ID } from './system-environment-plugin.js';
export type { SystemEnvironmentPluginConfig } from './system-environment-plugin.js';

// Export HTTP Server Components
export { HttpServer } from './http-server.js';
export { HttpDispatcher } from './http-dispatcher.js';
export type { HttpProtocolContext, HttpDispatcherResult } from './http-dispatcher.js';
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
// Boot a host process that resolves incoming hostnames to projects and
// dispatches every request to the matching per-project ObjectKernel. The
// artifact is fetched either from an HTTP control plane (apps/cloud or
// the hosted ObjectStack Cloud) or from a local JSON file for single-
// project dev workflows. See `cloud/objectos-stack.ts`.
export { createObjectOSStack } from './cloud/objectos-stack.js';
export type { ObjectOSStackConfig, ObjectOSStackResult } from './cloud/objectos-stack.js';
export { MarketplaceProxyPlugin } from './cloud/marketplace-proxy-plugin.js';
export type { MarketplaceProxyPluginConfig } from './cloud/marketplace-proxy-plugin.js';
export { MarketplaceInstallLocalPlugin } from './cloud/marketplace-install-local-plugin.js';
export type { MarketplaceInstallLocalPluginConfig } from './cloud/marketplace-install-local-plugin.js';
export { RuntimeConfigPlugin } from './cloud/runtime-config-plugin.js';
export type { RuntimeConfigPluginConfig } from './cloud/runtime-config-plugin.js';
export { DEFAULT_CLOUD_URL, resolveCloudUrl } from './cloud/cloud-url.js';
export { ArtifactApiClient } from './cloud/artifact-api-client.js';
export type {
    ArtifactApiClientConfig,
    EnvironmentArtifactResponse,
    EnvironmentRuntimeConfig,
    ResolvedHostname,
} from './cloud/artifact-api-client.js';
export { FileArtifactApiClient } from './cloud/file-artifact-api-client.js';
export type { FileArtifactApiClientConfig } from './cloud/file-artifact-api-client.js';
export { ArtifactEnvironmentRegistry } from './cloud/artifact-environment-registry.js';
export type { ArtifactEnvironmentRegistryConfig } from './cloud/artifact-environment-registry.js';
export { ArtifactKernelFactory } from './cloud/artifact-kernel-factory.js';
export type { ArtifactKernelFactoryConfig } from './cloud/artifact-kernel-factory.js';
export { AuthProxyPlugin } from './cloud/auth-proxy-plugin.js';
export { KernelManager } from './cloud/kernel-manager.js';
export type { EnvironmentKernelFactory, KernelManagerConfig } from './cloud/kernel-manager.js';
export type { EnvironmentDriverRegistry } from './cloud/environment-registry.js';
export {
  PLATFORM_SSO_PROVIDER_ID,
  derivePlatformSsoClientId,
  derivePlatformSsoClientSecret,
  buildPlatformSsoRedirectUri,
  seedPlatformSsoClient,
  backfillPlatformSsoClients,
} from './cloud/platform-sso.js';
export type {
  SeedPlatformSsoClientOptions,
  BackfillPlatformSsoClientsOptions,
} from './cloud/platform-sso.js';

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



