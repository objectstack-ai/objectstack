// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { Connector, ConnectorProviderFactory } from '@objectstack/spec/integration';
import { createOpenApiConnector, type OpenApiConnectorConfig } from './openapi-connector.js';
import { createOpenApiProviderFactory, OPENAPI_PROVIDER_KEY } from './openapi-provider.js';

/**
 * Minimal surface of the automation engine this package depends on — the
 * connector registry (ADR-0018 §Addendum) plus the provider registry (ADR-0097).
 * Kept structural so callers need no runtime dependency on
 * `@objectstack/service-automation` (mirrors connector-rest / connector-mcp).
 */
export interface ConnectorRegistrySurface {
    registerConnector(
        def: Connector,
        handlers: Record<
            string,
            (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>
        >,
    ): void;
    unregisterConnector(name: string): void;
    registerConnectorProvider(providerKey: string, factory: ConnectorProviderFactory): void;
}

/**
 * Generate an OpenAPI-backed connector and register it on the engine's connector
 * registry so the baseline `connector_action` node can dispatch to the generated
 * actions (ADR-0023). Returns the registered connector name.
 */
export function registerOpenApiConnector(registry: ConnectorRegistrySurface, config: OpenApiConnectorConfig): string {
    const { def, handlers } = createOpenApiConnector(config);
    registry.registerConnector(def, handlers);
    return def.name;
}

/**
 * Options for {@link ConnectorOpenApiPlugin}. All optional (ADR-0097): with no
 * `document` the plugin contributes only the `openapi` provider factory — so a
 * stack can declare `provider: 'openapi'` instances as pure metadata. Supply a
 * `document` (+ config) to ALSO register one hand-wired OpenAPI connector.
 */
export interface ConnectorOpenApiPluginOptions extends Partial<OpenApiConnectorConfig> {
    /** Injected fetch implementation forwarded to the `openapi` provider factory (tests). */
    fetchImpl?: typeof fetch;
}

/**
 * ConnectorOpenApiPlugin — contributes the OpenAPI generic executor (ADR-0023) in
 * two forms:
 *
 *  1. **Provider factory** (`openapi`, ADR-0097): registered at `init()` so the
 *     automation service can materialize declarative `provider: 'openapi'`
 *     `connectors:` entries — loading the OpenAPI document and mapping each
 *     operation to a connector action — at boot.
 *  2. **Hand-wired instance** (optional, back-compat): when constructed with a
 *     `document`, it also registers one concrete OpenAPI connector at `start()`.
 *
 * If no automation engine is present the plugin logs and skips.
 */
export class ConnectorOpenApiPlugin implements Plugin {
    name = 'com.objectstack.connector.openapi';
    version = '1.0.0';
    type = 'standard' as const;
    // Ensure the automation engine (and its connector/provider registries) exist first.
    dependencies = ['com.objectstack.service-automation'];

    private readonly options: ConnectorOpenApiPluginOptions;
    private connectorName?: string;
    private automation?: ConnectorRegistrySurface;

    constructor(options: ConnectorOpenApiPluginOptions = {}) {
        this.options = options;
    }

    async init(ctx: PluginContext): Promise<void> {
        // Contribute the `openapi` provider factory (ADR-0097) before the
        // automation service materializes declarative instances during its start().
        const automation = this.tryGetAutomation(ctx);
        if (automation && typeof automation.registerConnectorProvider === 'function') {
            automation.registerConnectorProvider(
                OPENAPI_PROVIDER_KEY,
                createOpenApiProviderFactory({ fetchImpl: this.options.fetchImpl }),
            );
            ctx.logger.info("ConnectorOpenApiPlugin: registered 'openapi' connector provider");
        }
    }

    async start(ctx: PluginContext): Promise<void> {
        // Provider-only usage (no document) contributes just the factory in init().
        if (!this.options.document) return;

        const automation = this.tryGetAutomation(ctx);
        if (!automation || typeof automation.registerConnector !== 'function') {
            ctx.logger.info('ConnectorOpenApiPlugin: no automation engine — OpenAPI connector not registered');
            return;
        }

        this.connectorName = registerOpenApiConnector(automation, this.options as OpenApiConnectorConfig);
        this.automation = automation;
        ctx.logger.info(`ConnectorOpenApiPlugin: OpenAPI connector '${this.connectorName}' registered`);
    }

    /**
     * The kernel's teardown hook (`Plugin.destroy?()`, core `types.ts`) — the
     * ONLY teardown entry point `ObjectKernel.performShutdown()` and
     * `LiteKernel.destroy()` invoke.
     *
     * [#10371] IT USED TO BE `stop()`, WHICH NOTHING CALLED. `Plugin` declares
     * `init()`, `start?()` and `destroy?()` and no `stop()`, so the kernel
     * walked past this plugin at shutdown and the OpenAPI connector stayed registered in the automation
     * engine for the lifetime of the process. `start()` IS on the
     * interface, so the pair read as symmetric in review — that asymmetry is
     * what let the same shape survive in six packages at once.
     *
     * No timers here, so this instance never cost a merge-queue eviction the
     * way the `plugin-reports` / `service-messaging` members did (#9371). The
     * class is the same one either way: a teardown the kernel does not reach.
     */
    async destroy(): Promise<void> {
        if (this.automation && this.connectorName) {
            try { this.automation.unregisterConnector(this.connectorName); } catch { /* ignore */ }
        }
        this.automation = undefined;
        this.connectorName = undefined;
    }

    /**
     * Retained alias for {@link destroy}. Kept because it is public API of an
     * exported class, and removing it would break an embedder who learned to
     * call it directly precisely BECAUSE the kernel never did. Prefer kernel
     * shutdown; direct callers keep working unchanged.
     */
    async stop(_ctx?: PluginContext): Promise<void> {
        await this.destroy();
    }

    private tryGetAutomation(ctx: PluginContext): ConnectorRegistrySurface | undefined {
        try {
            return ctx.getService<ConnectorRegistrySurface>('automation');
        } catch {
            return undefined;
        }
    }
}
