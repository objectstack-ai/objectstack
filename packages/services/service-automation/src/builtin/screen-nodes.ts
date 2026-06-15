// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationEngine } from '../engine.js';

/**
 * Screen / Script built-in nodes — 'screen' and 'script' executors.
 * Part of the core flow capability, so the {@link AutomationServicePlugin}
 * seeds them directly (ADR-0018) rather than shipping a separate plugin.
 *
 * - 'screen' nodes collect user input. A screen that declares `config.fields`
 *   (or sets `config.waitForInput === true`) suspends the run on entry via the
 *   engine's durable pause (ADR-0019), surfacing a `ScreenSpec` for the client
 *   to render; the run continues via `resume()` with the collected values (set
 *   as bare flow variables). A field-less screen — or one with
 *   `waitForInput === false` — stays a server pass-through (input vars, if any,
 *   are already injected from `context.params`).
 * - 'script' nodes name a callable to run (#1870):
 *     - `config.actionType` selecting a built-in side-effect ('email', 'slack',
 *       logger-backed), or
 *     - `config.function` (or a bare `actionType` that matches no built-in)
 *       naming a registered function — resolved via `engine.resolveFunction()`,
 *       which the host bridges to `bundle.functions` / `defineStack({ functions })`.
 *   A target that resolves to neither fails the step LOUDLY rather than the old
 *   silent "no-op handler" success, so an unwired callable can't quietly skip.
 */

/**
 * Built-in `script` side-effect action types with a (logger-backed) handler.
 * Anything else is treated as a registered-function name (#1870).
 */
const SCRIPT_BUILTIN_ACTION_TYPES = new Set(['email', 'slack']);

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
      async execute(node, _variables, _context) {
        const cfg = (node.config ?? {}) as Record<string, unknown>;
        const rawFields = Array.isArray(cfg.fields) ? (cfg.fields as Array<Record<string, unknown>>) : [];
        const hasFields = rawFields.length > 0;
        // Suspend to collect input when the screen declares fields, or opts in
        // explicitly. `waitForInput === false` forces a server pass-through.
        const shouldPause = cfg.waitForInput === true || (hasFields && cfg.waitForInput !== false);
        if (!shouldPause) {
          return { success: true };
        }
        const fields = rawFields.map((f) => ({
          name: String(f.name ?? ''),
          label: f.label != null ? String(f.label) : undefined,
          type: f.type != null ? String(f.type) : undefined,
          required: f.required === true,
          options: Array.isArray(f.options) ? (f.options as Array<{ value: unknown; label: string }>) : undefined,
          defaultValue: f.defaultValue,
          placeholder: f.placeholder != null ? String(f.placeholder) : undefined,
        })).filter((f) => f.name.length > 0);
        return {
          success: true,
          suspend: true,
          screen: {
            nodeId: node.id,
            title: (cfg.title as string | undefined) ?? node.label ?? 'Input',
            description: cfg.description as string | undefined,
            fields,
          },
        };
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
      async execute(node, variables, context) {
        const cfg = (node.config ?? {}) as Record<string, unknown>;
        const fnName = typeof cfg.function === 'string' && cfg.function.trim() ? cfg.function.trim() : undefined;
        const actionType = typeof cfg.actionType === 'string' && cfg.actionType.trim() ? cfg.actionType.trim() : undefined;

        // Built-in side-effect actions keep their logger-backed behavior — but
        // only when an explicit `function` isn't set (that always wins).
        if (!fnName && actionType && SCRIPT_BUILTIN_ACTION_TYPES.has(actionType)) {
          ctx.logger.info(
            `[Script:${actionType}] template=${String(cfg.template)} ` +
              `recipients=${JSON.stringify(cfg.recipients)} ` +
              `vars=${JSON.stringify(cfg.variables)}`,
          );
          return {
            success: true,
            output: { actionType, template: cfg.template, recipients: cfg.recipients },
          };
        }

        // Otherwise the node names a function to invoke. `function` is canonical;
        // a bare `actionType` that matched no built-in is accepted as a shorthand
        // function name (so templates that point a node straight at e.g.
        // `helpdesk.aiTriageStub` resolve).
        const target = fnName ?? actionType;
        if (!target) {
          // Defense in depth: registerFlow already rejects this structurally
          // (#1870), so reaching here means a node bypassed registration.
          return {
            success: false,
            error:
              `script node '${node.id}': declares neither \`actionType\` nor \`function\` — nothing to run.`,
          };
        }

        const handler = engine.resolveFunction(target);
        if (!handler) {
          return {
            success: false,
            error:
              `script node '${node.id}': '${target}' is not a built-in action ` +
              `(${[...SCRIPT_BUILTIN_ACTION_TYPES].join(', ')}) and no function named '${target}' is registered. ` +
              `Register it via \`defineStack({ functions: { '${target}': fn } })\`, or fix the name (#1870).`,
          };
        }

        // Map declared inputs (`config.inputs` | `config.input`) to the function.
        const input = (cfg.inputs ?? cfg.input ?? {}) as Record<string, unknown>;
        try {
          const result = await handler({ input, variables, automation: context, logger: ctx.logger });
          return { success: true, output: { function: target, result } };
        } catch (err) {
          return {
            success: false,
            error: `script function '${target}' (node '${node.id}') failed: ${(err as Error).message}`,
          };
        }
      },
    });

    ctx.logger.info('[Screen/Script Nodes] 2 built-in node executors registered');
}
