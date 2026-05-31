// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { Connector } from '@objectstack/spec/integration';
import { createSlackConnector, type SlackConnectorOptions } from './slack-connector.js';

/**
 * Minimal surface of the automation engine this plugin depends on — the
 * connector registry from ADR-0018 §Addendum. Kept structural so the plugin
 * needs no runtime dependency on `@objectstack/service-automation`.
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
}

export interface ConnectorSlackPluginOptions extends SlackConnectorOptions {}

/**
 * ConnectorSlackPlugin — registers a Slack Web API connector on the automation
 * engine. The second reference concrete connector (ADR-0018 §Addendum); it
 * enables the ADR-0022 "raw API call" path — a flow's `connector_action` step
 * can dispatch to `slack.chat.postMessage` without the messaging stack.
 *
 * If no automation engine is present the plugin logs and skips — the connector
 * has nowhere to register, which is not an error.
 */
export class ConnectorSlackPlugin implements Plugin {
    name = 'com.objectstack.connector.slack';
    version = '1.0.0';
    type = 'standard' as const;
    // Ensure the automation engine (and its connector registry) is started first.
    dependencies = ['com.objectstack.service-automation'];

    private readonly options: ConnectorSlackPluginOptions;
    private connectorName?: string;
    private automation?: ConnectorRegistrySurface;

    constructor(options: ConnectorSlackPluginOptions) {
        this.options = options;
    }

    async init(_ctx: PluginContext): Promise<void> {
        // No services to register; the connector is registered in start() once
        // the automation engine is available.
    }

    async start(ctx: PluginContext): Promise<void> {
        let automation: ConnectorRegistrySurface | undefined;
        try {
            automation = ctx.getService<ConnectorRegistrySurface>('automation');
        } catch {
            automation = undefined;
        }

        if (!automation || typeof automation.registerConnector !== 'function') {
            ctx.logger.info('ConnectorSlackPlugin: no automation engine — Slack connector not registered');
            return;
        }

        const { def, handlers } = createSlackConnector(this.options);
        automation.registerConnector(def, handlers);
        this.automation = automation;
        this.connectorName = def.name;
        ctx.logger.info(`ConnectorSlackPlugin: Slack connector '${def.name}' registered`);
    }

    async stop(_ctx: PluginContext): Promise<void> {
        if (this.automation && this.connectorName) {
            try { this.automation.unregisterConnector(this.connectorName); } catch { /* ignore */ }
        }
    }
}
