// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { Connector, ConnectorProviderFactory } from '@objectstack/spec/integration';
import { createMcpConnector, type McpConnectorOptions } from './mcp-connector.js';
import {
    createMcpProviderFactory,
    MCP_PROVIDER_KEY,
    type McpDeclarativeStdioPolicy,
} from './mcp-provider.js';

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
    /**
     * `options.credentialHandle: true` says the factory asks
     * `ConnectorProviderContext.credentialHandle` on every request, so the host
     * serves grant-bearing instances (`oauth2`, `app-credential`) through it
     * (ADR-0143 D4). An older host ignores the third argument and keeps
     * holding those instances degraded.
     */
    registerConnectorProvider(
        providerKey: string,
        factory: ConnectorProviderFactory,
        options?: { readonly credentialHandle?: boolean },
    ): void;
}

/**
 * Options for {@link ConnectorMcpPlugin}. All optional (ADR-0097): with no
 * `transport` the plugin contributes only the `mcp` provider factory — so a
 * stack can declare `provider: 'mcp'` instances as pure metadata. Supply a
 * `transport` to ALSO connect one hand-wired MCP server at `start()`.
 */
export interface ConnectorMcpPluginOptions extends Partial<McpConnectorOptions> {
    /**
     * Policy for stdio transports on **declarative** `provider: 'mcp'`
     * instances (#3055). Default **deny**: metadata (including a runtime Studio
     * publish) must not spawn local processes unless the host opts in.
     * `string[]` allowlists specific commands; `true` allows any. Hand-wired
     * connectors configured via these plugin options are not subject to it —
     * their command lives in host code, not metadata.
     */
    declarativeStdio?: McpDeclarativeStdioPolicy;
}

/**
 * ConnectorMcpPlugin — contributes the generic MCP adapter (ADR-0024) in two forms:
 *
 *  1. **Provider factory** (`mcp`, ADR-0097): registered at `init()` so the
 *     automation service can materialize declarative `provider: 'mcp'`
 *     `connectors:` entries — connecting to the server and mapping its tools to
 *     connector actions — at boot.
 *  2. **Hand-wired instance** (optional, back-compat): when constructed with a
 *     `transport`, it also connects that one server at `start()` and registers
 *     the resulting connector.
 *
 * Lifecycle: on `start()` a configured instance connects and builds the
 * connector once; on `destroy()` it tears the MCP connection down. If no
 * automation engine is present — or the server is unreachable at boot — the
 * hand-wired path logs and skips: a missing optional connector is not fatal
 * (unlike a *declarative* provider-bound instance, which fails boot loudly).
 */
export class ConnectorMcpPlugin implements Plugin {
    name = 'com.objectstack.connector.mcp';
    version = '1.0.0';
    type = 'standard' as const;
    // Ensure the automation engine (and its connector/provider registries) exist first.
    dependencies = ['com.objectstack.service-automation'];

    private readonly options: ConnectorMcpPluginOptions;
    private connectorName?: string;
    private automation?: ConnectorRegistrySurface;
    private close?: () => Promise<void>;

    constructor(options: ConnectorMcpPluginOptions = {}) {
        this.options = options;
    }

    async init(ctx: PluginContext): Promise<void> {
        // Contribute the `mcp` provider factory (ADR-0097) before the automation
        // service materializes declarative instances during its start().
        const automation = this.tryGetAutomation(ctx);
        if (automation && typeof automation.registerConnectorProvider === 'function') {
            automation.registerConnectorProvider(
                MCP_PROVIDER_KEY,
                createMcpProviderFactory({
                    clientFactory: this.options.clientFactory,
                    declarativeStdio: this.options.declarativeStdio,
                }),
                // ADR-0143 D4 — an http transport asks the credential handle per request.
                { credentialHandle: true },
            );
            ctx.logger.info("ConnectorMcpPlugin: registered 'mcp' connector provider");
        }
    }

    async start(ctx: PluginContext): Promise<void> {
        // Provider-only usage (no transport) contributes just the factory in init().
        if (!this.options.transport) return;

        const automation = this.tryGetAutomation(ctx);
        if (!automation || typeof automation.registerConnector !== 'function') {
            ctx.logger.info('ConnectorMcpPlugin: no automation engine — MCP connector not registered');
            return;
        }

        let bundle;
        try {
            bundle = await createMcpConnector(this.options as McpConnectorOptions);
        } catch (err) {
            // The MCP server is unreachable / failed discovery at boot. Skip the
            // optional connector rather than failing the whole bootstrap.
            ctx.logger.warn(
                `ConnectorMcpPlugin: could not connect to MCP server — connector not registered: ${(err as Error).message}`,
            );
            return;
        }

        automation.registerConnector(bundle.def, bundle.handlers);
        this.automation = automation;
        this.connectorName = bundle.def.name;
        this.close = bundle.close;
        ctx.logger.info(
            `ConnectorMcpPlugin: MCP connector '${bundle.def.name}' registered with ${bundle.def.actions?.length ?? 0} action(s)`,
        );
    }

    /**
     * Destroy phase — the kernel's shutdown hook (the `Plugin` lifecycle exposes
     * `destroy()`, not `stop()`). Unregister the connector and tear the MCP
     * connection down so no child process / socket is leaked.
     */
    async destroy(): Promise<void> {
        if (this.automation && this.connectorName) {
            try { this.automation.unregisterConnector(this.connectorName); } catch { /* ignore */ }
        }
        if (this.close) {
            try { await this.close(); } catch { /* ignore */ }
        }
    }

    private tryGetAutomation(ctx: PluginContext): ConnectorRegistrySurface | undefined {
        try {
            return ctx.getService<ConnectorRegistrySurface>('automation');
        } catch {
            return undefined;
        }
    }
}
