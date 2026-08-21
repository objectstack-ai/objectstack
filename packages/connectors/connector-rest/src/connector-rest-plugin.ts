// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { Connector, ConnectorProviderFactory } from '@objectstack/spec/integration';
import { createRestConnector, type RestConnectorOptions } from './rest-connector.js';
import { createRestProviderFactory, REST_PROVIDER_KEY } from './rest-provider.js';

/**
 * Minimal surface of the automation engine this plugin depends on — the
 * connector registry (ADR-0018 §Addendum) plus the provider registry (ADR-0097).
 * Kept structural so the plugin needs no runtime dependency on
 * `@objectstack/service-automation`.
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
 * Options for {@link ConnectorRestPlugin}. All optional (ADR-0097): with no
 * `baseUrl` the plugin contributes only the `rest` provider factory — so a stack
 * can declare `provider: 'rest'` instances as pure metadata. Supply `baseUrl`
 * (etc.) to ALSO register a single hand-wired `rest` connector, the pre-ADR-0097
 * usage.
 */
export interface ConnectorRestPluginOptions extends Partial<RestConnectorOptions> {}

/**
 * ConnectorRestPlugin — contributes the generic REST connector (ADR-0018
 * §Addendum) in two forms:
 *
 *  1. **Provider factory** (`rest`, ADR-0097): registered at `init()` so the
 *     automation service can materialize declarative `provider: 'rest'`
 *     `connectors:` entries into live connectors at boot.
 *  2. **Hand-wired instance** (optional, back-compat): when constructed with a
 *     `baseUrl`, it also registers one concrete `rest` connector at `start()`.
 *
 * If no automation engine is present the plugin logs and skips — the connector
 * has nowhere to register, which is not an error.
 */
export class ConnectorRestPlugin implements Plugin {
    name = 'com.objectstack.connector.rest';
    version = '1.0.0';
    type = 'standard' as const;
    // Ensure the automation engine (and its connector/provider registries) exist first.
    dependencies = ['com.objectstack.service-automation'];

    private readonly options: ConnectorRestPluginOptions;
    private connectorName?: string;
    private automation?: ConnectorRegistrySurface;

    constructor(options: ConnectorRestPluginOptions = {}) {
        this.options = options;
    }

    async init(ctx: PluginContext): Promise<void> {
        // Contribute the `rest` provider factory (ADR-0097). Done in init() — not
        // start() — so it is registered before the automation service materializes
        // declarative instances during its own start().
        const automation = this.tryGetAutomation(ctx);
        if (automation && typeof automation.registerConnectorProvider === 'function') {
            automation.registerConnectorProvider(
                REST_PROVIDER_KEY,
                createRestProviderFactory({ fetchImpl: this.options.fetchImpl }),
            );
            ctx.logger.info("ConnectorRestPlugin: registered 'rest' connector provider");
        }
    }

    async start(ctx: PluginContext): Promise<void> {
        // Only register a concrete connector when a baseUrl was supplied — the
        // provider-only usage (no options) contributes just the factory in init().
        if (!this.options.baseUrl) return;

        const automation = this.tryGetAutomation(ctx);
        if (!automation || typeof automation.registerConnector !== 'function') {
            ctx.logger.info('ConnectorRestPlugin: no automation engine — REST connector not registered');
            return;
        }

        const { def, handlers } = createRestConnector(this.options as RestConnectorOptions);
        automation.registerConnector(def, handlers);
        this.automation = automation;
        this.connectorName = def.name;
        ctx.logger.info(`ConnectorRestPlugin: REST connector '${def.name}' registered`);
    }

    /**
     * The kernel's teardown hook (`Plugin.destroy?()`, core `types.ts`) — the
     * ONLY teardown entry point `ObjectKernel.performShutdown()` and
     * `LiteKernel.destroy()` invoke.
     *
     * [#10371] IT USED TO BE `stop()`, WHICH NOTHING CALLED. `Plugin` declares
     * `init()`, `start?()` and `destroy?()` and no `stop()`, so the kernel
     * walked past this plugin at shutdown and the REST connector stayed registered in the automation
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
