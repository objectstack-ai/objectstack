// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationEngine, ConnectorActionContext } from '../engine.js';

/**
 * Connector built-in node — `connector_action` (generic integration dispatch).
 *
 * Part of the platform baseline alongside `http_request` (ADR-0018 §Addendum):
 * where `http_request` calls *any raw URL*, `connector_action` invokes *any
 * registered connector's action*. The platform ships the generic dispatch node
 * + an (initially empty) connector registry on the engine; concrete connectors
 * — `connector-rest`, `connector-slack`, `connector-salesforce`, … — populate
 * the registry at runtime via `engine.registerConnector()`.
 *
 * Because the registry starts empty, a flow referencing a connector that no
 * plugin has registered fails the *step* with a clear error rather than failing
 * to register — graceful degradation matching `http_request`'s fail-soft style.
 */
export function registerConnectorNodes(engine: AutomationEngine, ctx: PluginContext): void {
    engine.registerNodeExecutor({
        type: 'connector_action',
        descriptor: defineActionDescriptor({
            type: 'connector_action',
            version: '1.0.0',
            name: 'Connector Action',
            description:
                'Invoke an action on a registered connector (Slack, Salesforce, a REST API, …). '
                + 'The connector itself is contributed by an integration plugin via registerConnector().',
            icon: 'plug',
            category: 'io',
            source: 'builtin',
            supportsRetry: true,
            // Present in both authoring paradigms (ADR-0018 §registry table;
            // workflow_rule retired per ADR-0019).
            paradigms: ['flow', 'approval'],
            // Config contract — drives the Studio property form and flow validation.
            configSchema: {
                type: 'object',
                required: ['connectorId', 'actionId'],
                properties: {
                    connectorId: { type: 'string', description: 'Registered connector name' },
                    actionId: { type: 'string', description: 'Action key declared by the connector' },
                    input: { type: 'object', description: 'Mapped inputs for the action' },
                },
            },
        }),
        async execute(node, variables, context) {
            const cfg = node.connectorConfig;
            if (!cfg?.connectorId || !cfg?.actionId) {
                return {
                    success: false,
                    error: `connector_action '${node.id}': connectorConfig.connectorId and .actionId are required`,
                };
            }

            const handler = engine.resolveConnectorAction(cfg.connectorId, cfg.actionId);
            if (!handler) {
                return {
                    success: false,
                    error:
                        `connector_action '${node.id}': no handler for `
                        + `'${cfg.connectorId}.${cfg.actionId}' — is the connector plugin registered?`,
                };
            }

            const handlerCtx: ConnectorActionContext = {
                variables,
                automation: context,
                logger: ctx.logger,
            };

            try {
                const output = await handler((cfg.input ?? {}) as Record<string, unknown>, handlerCtx);
                return { success: true, output };
            } catch (err) {
                return {
                    success: false,
                    error: `connector_action(${cfg.connectorId}.${cfg.actionId}) failed: ${(err as Error).message}`,
                };
            }
        },
    });

    ctx.logger.info('[Connector] 1 built-in node executor registered (connector_action)');
}
