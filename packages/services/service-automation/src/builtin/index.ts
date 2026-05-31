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
 *  - logic   — decision / assignment / loop      (engine core)
 *  - data    — get/create/update/delete_record   (platform CRUD baseline)
 *  - human   — screen / script                   (core flow capability)
 *  - io      — http_request                       (foundational outbound I/O)
 *
 * Deliberately NOT baseline: `connector_action` (an integration concern that
 * needs a connector registry the platform does not ship). Third-party node
 * types — including connector_action — extend the registry at runtime via
 * `engine.registerNodeExecutor()`, keeping the action vocabulary open and
 * marketplace-extensible.
 */

import type { PluginContext } from '@objectstack/core';
import type { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';
import { registerCrudNodes } from './crud-nodes.js';
import { registerScreenNodes } from './screen-nodes.js';
import { registerHttpNodes } from './http-nodes.js';

export { registerLogicNodes } from './logic-nodes.js';
export { registerCrudNodes } from './crud-nodes.js';
export { registerScreenNodes } from './screen-nodes.js';
export { registerHttpNodes } from './http-nodes.js';

/**
 * Seed every built-in node executor into the engine. Called by
 * {@link AutomationServicePlugin.init} so a bare `new AutomationServicePlugin()`
 * yields a fully-functional automation capability with no companion plugins.
 */
export function installBuiltinNodes(engine: AutomationEngine, ctx: PluginContext): void {
    registerLogicNodes(engine, ctx);
    registerCrudNodes(engine, ctx);
    registerScreenNodes(engine, ctx);
    registerHttpNodes(engine, ctx);

    const types = engine.getRegisteredNodeTypes();
    ctx.logger.info(
        `[Automation] ${types.length} built-in node executors installed: ${types.join(', ')}`,
    );
}
