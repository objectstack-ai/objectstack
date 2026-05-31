// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationEngine } from '../engine.js';

/**
 * Screen / Script built-in nodes — 'screen' and 'script' executors.
 * Part of the core flow capability, so the {@link AutomationServicePlugin}
 * seeds them directly (ADR-0018) rather than shipping a separate plugin.
 *
 * - 'screen' nodes are pass-through on the server. The engine already injects
 *   `isInput: true` flow variables from `context.params` into the top-level
 *   variables map before execution begins, so screen nodes have no remaining
 *   server-side work.
 * - 'script' nodes dispatch by `config.actionType`. Currently only 'email'
 *   has a (logger-backed) implementation; unknown action types still succeed
 *   so flows can continue and downstream nodes can react.
 */
export function registerScreenNodes(engine: AutomationEngine, ctx: PluginContext): void {
    // screen — server-side pass-through (input vars already injected by engine).
    engine.registerNodeExecutor({
      type: 'screen',
      descriptor: defineActionDescriptor({
        type: 'screen', version: '1.0.0', name: 'Screen',
        description: 'Collect user input via a screen (human-input element).',
        icon: 'window', category: 'human', source: 'builtin',
        // Human-input nodes suspend the flow awaiting input.
        supportsPause: true, isAsync: true,
      }),
      async execute(_node, _variables, _context) {
        return { success: true };
      },
    });

    // script — dispatch by actionType.
    engine.registerNodeExecutor({
      type: 'script',
      descriptor: defineActionDescriptor({
        type: 'script', version: '1.0.0', name: 'Script',
        description: 'Run a custom script action.',
        icon: 'code', category: 'logic', source: 'builtin',
      }),
      async execute(node, _variables, _context) {
        const cfg = (node.config ?? {}) as Record<string, unknown>;
        const actionType = (cfg.actionType as string | undefined) ?? 'noop';
        if (actionType === 'email') {
          ctx.logger.info(
            `[Script:email] template=${String(cfg.template)} ` +
              `recipients=${JSON.stringify(cfg.recipients)} ` +
              `vars=${JSON.stringify(cfg.variables)}`,
          );
          return {
            success: true,
            output: {
              actionType,
              template: cfg.template,
              recipients: cfg.recipients,
            },
          };
        }
        ctx.logger.info(`[Script:${actionType}] node=${node.id} executed (no-op handler)`);
        return { success: true, output: { actionType } };
      },
    });

    ctx.logger.info('[Screen/Script Nodes] 2 built-in node executors registered');
}
