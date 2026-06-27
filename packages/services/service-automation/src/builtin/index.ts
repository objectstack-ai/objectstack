// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in node executors — the automation engine's foundational vocabulary.
 *
 * Per ADR-0018 and the platform principle "plugins are plugins; the platform's
 * foundational capabilities are built in," these node packs are seeded directly
 * by the core {@link AutomationServicePlugin} rather than shipped as separately
 * installable plugins. Each `register*Nodes(engine, ctx)` publishes its
 * descriptors with `source: 'builtin'`.
 *
 * Scope (built-in baseline):
 *  - logic   — decision / assignment            (engine core)
 *  - logic   — loop                              (structured iteration container, ADR-0031)
 *  - logic   — parallel                          (structured parallel block, implicit join, ADR-0031)
 *  - logic   — try_catch                         (structured try/catch/retry, ADR-0031)
 *  - data    — get/create/update/delete_record   (platform CRUD baseline)
 *  - human   — screen / script                   (core flow capability)
 *  - io      — http                               (foundational outbound I/O)
 *  - io      — connector_action                   (generic integration dispatch)
 *  - io      — notify                              (outbound notification via messaging service)
 *
 * `connector_action` is the *generic dispatch* counterpart to `http`
 * (ADR-0018 §Addendum): the platform ships the node + an (initially empty)
 * connector registry on the engine, and *concrete* connectors populate it at
 * runtime via `engine.registerConnector()`. Third-party node types continue to
 * extend the vocabulary via `engine.registerNodeExecutor()`, keeping the action
 * list open and marketplace-extensible.
 */

import type { PluginContext } from '@objectstack/core';
import type { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';
import { registerLoopNode } from './loop-node.js';
import { registerParallelNode } from './parallel-node.js';
import { registerTryCatchNode } from './try-catch-node.js';
import { registerCrudNodes } from './crud-nodes.js';
import { registerScreenNodes } from './screen-nodes.js';
import { registerHttpNodes } from './http-nodes.js';
import { registerConnectorNodes } from './connector-nodes.js';
import { registerNotifyNode } from './notify-node.js';
import { registerWaitNode } from './wait-node.js';
import { registerSubflowNode } from './subflow-node.js';
import { registerMapNode } from './map-node.js';

export { registerLogicNodes } from './logic-nodes.js';
export { registerLoopNode } from './loop-node.js';
export { registerParallelNode } from './parallel-node.js';
export { registerTryCatchNode } from './try-catch-node.js';
export { registerCrudNodes } from './crud-nodes.js';
export { registerScreenNodes } from './screen-nodes.js';
export { registerHttpNodes } from './http-nodes.js';
export { registerConnectorNodes } from './connector-nodes.js';
export { registerNotifyNode } from './notify-node.js';
export { registerWaitNode, parseIsoDuration, rearmSuspendedWaitTimers } from './wait-node.js';
export { registerSubflowNode } from './subflow-node.js';
export { registerMapNode } from './map-node.js';

/**
 * Seed every built-in node executor into the engine. Called by
 * {@link AutomationServicePlugin.init} so a bare `new AutomationServicePlugin()`
 * yields a fully-functional automation capability with no companion plugins.
 */
export function installBuiltinNodes(engine: AutomationEngine, ctx: PluginContext): void {
    registerLogicNodes(engine, ctx);
    registerLoopNode(engine, ctx);
    registerParallelNode(engine, ctx);
    registerTryCatchNode(engine, ctx);
    registerCrudNodes(engine, ctx);
    registerScreenNodes(engine, ctx);
    registerHttpNodes(engine, ctx);
    registerConnectorNodes(engine, ctx);
    registerNotifyNode(engine, ctx);
    registerWaitNode(engine, ctx);
    registerSubflowNode(engine, ctx);
    registerMapNode(engine, ctx);

    const types = engine.getRegisteredNodeTypes();
    ctx.logger.info(
        `[Automation] ${types.length} built-in node executors installed: ${types.join(', ')}`,
    );
}
