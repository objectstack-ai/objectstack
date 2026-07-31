// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationEngine, ConnectorActionContext } from '../engine.js';
import { refuseNode } from '../guard-refusal.js';

/**
 * Connector built-in node — `connector_action` (generic integration dispatch).
 *
 * Part of the platform baseline alongside `http` (ADR-0018 §Addendum):
 * where `http` calls *any raw URL*, `connector_action` invokes *any
 * registered connector's action*. The platform ships the generic dispatch node
 * + an (initially empty) connector registry on the engine; concrete connectors
 * — `connector-rest`, `connector-slack`, `connector-salesforce`, … — populate
 * the registry at runtime via `engine.registerConnector()`.
 *
 * Because the registry starts empty, a flow referencing a connector that no
 * plugin has registered fails the *step* with a clear error rather than failing
 * to register — graceful degradation matching `http`'s fail-soft style.
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
            // NO configSchema — deliberate, same class as `wait` (#4045). The
            // node's contract is not `config` at all: the executor reads only
            // the declared `FlowNodeSchema.connectorConfig` sibling block.
            // This descriptor used to publish a configSchema declaring
            // `connectorId`/`actionId`/`input` — but a published configSchema
            // by contract describes `node.config` and the Studio inspector
            // derives its property form from it, rooting every field at
            // `config.<key>` and REPLACING the client's hand-written
            // connectorConfig form (with its connector/action pickers). So the
            // schema steered online authoring to keys the executor never
            // reads, and the node refused to dispatch. Stored flows that
            // carry the mis-taught shape are healed at load by the ADR-0087 D2
            // conversion 'flow-node-connector-config-lift'.
        }),
        async execute(node, variables, context) {
            const cfg = node.connectorConfig;
            if (!cfg?.connectorId || !cfg?.actionId) {
                return refuseNode(
                    `connector_action '${node.id}': connectorConfig.connectorId and .actionId are required`,
                );
            }

            const handler = engine.resolveConnectorAction(cfg.connectorId, cfg.actionId);
            if (!handler) {
                // A degraded declarative instance (#3017) is registered but has no
                // handlers — say WHY dispatch fails and that recovery is automatic,
                // instead of the generic wiring hint below.
                const degraded = engine.getConnectorDegradedReason(cfg.connectorId);
                if (degraded) {
                    return {
                        success: false,
                        error:
                            `connector_action '${node.id}': connector '${cfg.connectorId}' is degraded — ${degraded}. `
                            + `Dispatch is unavailable until its upstream recovers; the platform retries automatically (#3017).`,
                    };
                }
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
                // #4354 — the action reached an external system and the platform
                // cannot say what it did there: `ConnectorActionDescriptor`
                // declares `key` / `label` / `description` / `inputSchema` /
                // `outputSchema` and NOTHING about whether the action reads or
                // writes. `acted: 0` would understate a Salesforce create;
                // `acted: 1` would overstate a lookup and make the broken-sweep
                // alert never fire — the original bug back again. Report the
                // honest third answer: this run's `acted` is incomplete.
                // #4395 proposes declaring the effect kind on the descriptor,
                // which would turn this into a real count.
                return { success: true, output, metrics: { unmeasuredEffect: true } };
            } catch (err) {
                return {
                    success: false,
                    error: `connector_action(${cfg.connectorId}.${cfg.actionId}) failed: ${(err as Error).message}`,
                    // A handler that threw may still have reached the upstream.
                    metrics: { unmeasuredEffect: true },
                };
            }
        },
    });

    ctx.logger.info('[Connector] 1 built-in node executor registered (connector_action)');
}
