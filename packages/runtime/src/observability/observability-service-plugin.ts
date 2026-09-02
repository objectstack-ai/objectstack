// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
    OBSERVABILITY_METRICS_SERVICE,
    OBSERVABILITY_ERRORS_SERVICE,
} from '@objectstack/observability';
import {
    NoopMetricsRegistry,
    NoopErrorReporter,
    type MetricsRegistry,
    type ErrorReporter,
} from './index.js';

/**
 * Canonical service names other plugins look up to find the host's
 * configured observability backends. Re-exported from
 * `@objectstack/observability` so callers can grab them alongside the
 * plugin without straddling two packages.
 */
export { OBSERVABILITY_METRICS_SERVICE, OBSERVABILITY_ERRORS_SERVICE };

/**
 * Options for {@link ObservabilityServicePlugin}.
 *
 * Either or both backends can be omitted; the omitted one resolves to
 * the corresponding no-op exporter so consumers can always rely on the
 * service being present.
 */
export interface ObservabilityServicePluginOptions {
    /** Metrics backend (e.g. `ConsoleMetricsRegistry`, `OtlpHttpMetricsRegistry`). */
    metrics?: MetricsRegistry;
    /** Error reporter backend (e.g. Sentry adapter). */
    errors?: ErrorReporter;
}

/**
 * `ObservabilityServicePlugin` — registers the host's
 * {@link MetricsRegistry} and {@link ErrorReporter} in the kernel
 * service registry under the canonical names so any other plugin can
 * look them up without each host having to thread observability config
 * through every plugin constructor.
 *
 * Resolution chain other plugins should follow:
 *
 *   1. Explicit option on the plugin's own options object (escape
 *      hatch for tests / explicit wiring).
 *   2. `ctx.getService(OBSERVABILITY_METRICS_SERVICE)`.
 *   3. `NoopMetricsRegistry()` — never null.
 *
 * Register this plugin **before** any plugin that wants to consume the
 * services (cache, storage, dispatcher), otherwise the consumer's
 * `init` will fall through to the no-op default.
 *
 * @example
 * ```ts
 * import { ObjectKernel } from '@objectstack/core';
 * import {
 *   ObservabilityServicePlugin,
 *   CacheServicePlugin,
 * } from '@objectstack/runtime';
 * import { ConsoleMetricsRegistry } from '@objectstack/observability';
 *
 * const kernel = new ObjectKernel();
 * kernel.use(new ObservabilityServicePlugin({
 *   metrics: new ConsoleMetricsRegistry(),
 * }));
 * kernel.use(new CacheServicePlugin()); // picks metrics up automatically
 * ```
 */
export class ObservabilityServicePlugin implements Plugin {
    name = 'com.objectstack.observability.service';
    version = '1.0.0';
    type = 'standard' as const;

    private readonly options: ObservabilityServicePluginOptions;

    constructor(options: ObservabilityServicePluginOptions = {}) {
        this.options = options;
    }

    async init(ctx: PluginContext): Promise<void> {
        const metrics = this.options.metrics ?? new NoopMetricsRegistry();
        const errors = this.options.errors ?? new NoopErrorReporter();
        ctx.registerService(OBSERVABILITY_METRICS_SERVICE, metrics);
        ctx.registerService(OBSERVABILITY_ERRORS_SERVICE, errors);
        ctx.logger.info(
            `ObservabilityServicePlugin: registered metrics=${(metrics as any).constructor?.name ?? 'unknown'} errors=${(errors as any).constructor?.name ?? 'unknown'}`,
        );
    }
}

/**
 * Helper used by consumer plugins to resolve a metrics backend with
 * the canonical fallback chain. Never throws; always returns a usable
 * `MetricsRegistry`.
 *
 * @param ctx        the consuming plugin's `PluginContext`
 * @param override   explicit option set on the consuming plugin (wins)
 */
export function resolveMetrics(
    ctx: PluginContext,
    override?: MetricsRegistry,
): MetricsRegistry {
    if (override) return override;
    try {
        const m = ctx.getService<MetricsRegistry | undefined>(OBSERVABILITY_METRICS_SERVICE);
        if (m) return m;
    } catch {
        // Service not registered — fall through to the noop default.
    }
    return new NoopMetricsRegistry();
}

/**
 * Sibling of {@link resolveMetrics} for {@link ErrorReporter}.
 */
export function resolveErrorReporter(
    ctx: PluginContext,
    override?: ErrorReporter,
): ErrorReporter {
    if (override) return override;
    try {
        const e = ctx.getService<ErrorReporter | undefined>(OBSERVABILITY_ERRORS_SERVICE);
        if (e) return e;
    } catch {
        // Service not registered — fall through to the noop default.
    }
    return new NoopErrorReporter();
}
