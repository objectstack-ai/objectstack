// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationEngine } from '../engine.js';
import { interpolate } from './template.js';

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
        // Designer form (ADR-0018, #3304) — mirrors objectui's hardcoded `screen`
        // field group: flat input list OR an object form, plus title/description.
        // `visibleWhen` is bare CEL (xExpression), `defaults` a free-form keyValue
        // map (values may be `{var}` templates → `true`-permissive).
        configSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', title: 'Title', description: 'Heading shown above the screen.' },
            description: { type: 'string', format: 'multiline', title: 'Description', description: 'Body text. Interpolates {var} references (e.g. {approval_path}).' },
            fields: {
              type: 'array',
              title: 'Fields',
              description: 'Input fields collected on this screen. Leave empty for a message-only screen.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', title: 'Name' },
                  label: { type: 'string', title: 'Label' },
                  type: { type: 'string', title: 'Type' },
                  required: { type: 'boolean', title: 'Required' },
                  visibleWhen: { type: 'string', title: 'Visible when', xExpression: 'expression' },
                },
              },
            },
            waitForInput: { type: 'boolean', title: 'Wait for input', description: 'Pause to show this screen even with no fields (a message / confirmation). A field-less screen with this off is a server pass-through.' },
            objectName: { type: 'string', title: 'Object form', xRef: { kind: 'object' }, description: 'Render this object’s full create/edit form (incl. master-detail) instead of a flat field list.' },
            idVariable: { type: 'string', title: 'Saved-record variable', description: 'Object form only: variable bound to the saved record’s id, for later steps.' },
            mode: { type: 'string', enum: ['create', 'edit'], default: 'create', title: 'Form mode', description: 'Object form only.' },
            defaults: { type: 'object', additionalProperties: true, title: 'Form defaults', description: 'Object form only: prefilled values (e.g. account → {account_id}).' },
          },
        },
      }),
      async execute(node, variables, context) {
        const cfg = (node.config ?? {}) as Record<string, unknown>;
        // `{var}` tokens in screen config resolve against the live flow
        // variables here (the engine does NOT pre-interpolate node config) — so
        // a step's title/description/field-default/object-form-default can pull
        // from prior nodes (e.g. `{lead_record.company}`, `{account_id}`).
        const interp = (v: unknown): string | undefined => {
          if (v == null) return undefined;
          const r = interpolate(v, variables, context);
          return r == null ? undefined : String(r);
        };

        // ── Object-form screen (master-detail wizards) ──────────────────────
        // When the step names an `objectName`, render that object's FULL
        // create/edit form — including any inline master-detail child grids —
        // instead of a flat field list. The client persists the record (and its
        // children, atomically) and resumes the run with the new id bound to
        // `idVariable`, so a later step can reference it (e.g. an Opportunity
        // step prefilling its `account` FK from the Customer step's new id).
        const objectName =
          typeof cfg.objectName === 'string' && cfg.objectName.trim() ? cfg.objectName.trim() : undefined;
        if (objectName) {
          const defaults =
            cfg.defaults && typeof cfg.defaults === 'object'
              ? (interpolate(cfg.defaults, variables, context) as Record<string, unknown>)
              : undefined;
          const idVariable =
            typeof cfg.idVariable === 'string' && cfg.idVariable.trim() ? cfg.idVariable.trim() : undefined;
          return {
            success: true,
            suspend: true,
            screen: {
              nodeId: node.id,
              kind: 'object-form',
              title: interp(cfg.title) ?? node.label ?? objectName,
              description: interp(cfg.description),
              objectName,
              mode: cfg.mode === 'edit' ? 'edit' : 'create',
              recordId: cfg.recordId != null ? interp(cfg.recordId) : undefined,
              defaults,
              idVariable,
              fields: [],
            },
          };
        }

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
          defaultValue: f.defaultValue !== undefined ? interpolate(f.defaultValue, variables, context) : undefined,
          placeholder: f.placeholder != null ? String(f.placeholder) : undefined,
          // Forwarded RAW — deliberately not interpolated. `visibleWhen` is a
          // predicate the client re-evaluates on every keystroke against the
          // values collected SO FAR; the server has no view of those, so
          // resolving it here (to a constant, against flow variables) would
          // freeze the field visible-or-hidden for the life of the screen.
          //
          // It was declared on the designer form from the start but never put
          // on the wire, so no client could honour it: authors wrote a
          // predicate, Studio offered the input, and the field rendered
          // unconditionally. Where that field was also `required`, a runner
          // validating the full list blocked Submit on a field the user was
          // never shown — the run then sat paused with no resume request ever
          // issued (#3528).
          visibleWhen: f.visibleWhen != null ? String(f.visibleWhen) : undefined,
        })).filter((f) => f.name.length > 0);
        return {
          success: true,
          suspend: true,
          screen: {
            nodeId: node.id,
            title: interp(cfg.title) ?? node.label ?? 'Input',
            description: interp(cfg.description),
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
        // `function` is canonical; `functionName` is an accepted alias — AI/templates
        // commonly emit it alongside `actionType: 'invoke_function'` (#1870 DX).
        const fnRaw = cfg.function ?? cfg.functionName;
        const fnName = typeof fnRaw === 'string' && fnRaw.trim() ? fnRaw.trim() : undefined;
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

        // Inline `config.script` (a JS source body) is a distinct, recognized
        // form — but the built-in runtime has no server-side JS sandbox, so it
        // does not execute it. Warn loudly (not a silent success) and steer the
        // author to the supported path — a registered function — rather than
        // failing the flow. Executing inline scripts is a separate capability,
        // out of #1870's callable-resolution scope.
        const inlineScript = typeof cfg.script === 'string' && cfg.script.trim() ? cfg.script : undefined;
        if (!fnName && inlineScript) {
          ctx.logger.warn(
            `[Script] node '${node.id}': inline \`config.script\` is not executed by the built-in runtime ` +
              `(no server-side JS sandbox) — this node is a no-op. To run server logic, move it into a ` +
              `registered function and call it via \`config.function\` + \`defineStack({ functions })\`.`,
          );
          return { success: true, output: { script: 'not-executed' } };
        }

        // `actionType: 'invoke_function'` is a MARKER meaning "call the named
        // function" — the name lives in `function`/`functionName`, not in actionType
        // itself. A bare actionType that matched no built-in is still accepted as a
        // function name (shorthand).
        const target = fnName ?? (actionType === 'invoke_function' ? undefined : actionType);
        if (!target) {
          return {
            success: false,
            error:
              actionType === 'invoke_function'
                ? `script node '${node.id}': actionType 'invoke_function' requires \`config.function\` (or \`functionName\`) naming the function to call.`
                : `script node '${node.id}': declares neither \`actionType\` nor \`function\` — nothing to run.`,
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

        // Map declared inputs (`config.inputs` | `config.input`) to the function,
        // interpolating `{var}` references against the live flow variables (so a
        // function can consume a prior node's output, e.g. `{aiResult.id}`).
        const input = interpolate(cfg.inputs ?? cfg.input ?? {}, variables, context) as Record<string, unknown>;
        const outputVariable =
          typeof cfg.outputVariable === 'string' && cfg.outputVariable.trim() ? cfg.outputVariable.trim() : undefined;
        try {
          const result = await handler({ input, variables, automation: context, logger: ctx.logger });
          // Pure-function pattern: the function RETURNS its result; `outputVariable`
          // exposes it as a flow variable so a later declarative node persists it
          // (e.g. `update_record fields: { ai_category: '{aiResult.ai_category}' }`).
          // Data I/O stays on the flow graph — the function itself does no writes.
          if (outputVariable) variables.set(outputVariable, result);
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
