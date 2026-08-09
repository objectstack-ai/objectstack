// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, ScreenConfigSchema, ScriptConfigSchema } from '@objectstack/spec/automation';
import type { ScreenConfigParsed, ScriptConfigParsed } from '@objectstack/spec/automation';
import type { AutomationEngine } from '../engine.js';
import { interpolate } from './template.js';
import { parseNodeConfig } from './parse-config.js';

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
 * - 'script' nodes call a registered function (#1870): `config.function` names
 *   it, `engine.resolveFunction()` resolves it, and the host bridges that to
 *   `bundle.functions` / `defineStack({ functions })`. A name that resolves to
 *   nothing fails the step LOUDLY rather than the old silent "no-op handler"
 *   success, so an unwired callable can't quietly skip. The named function is
 *   contractually PURE — it returns a value and the flow graph persists it —
 *   which the descriptor publishes as `handlerContract: 'pure'` and a writing
 *   function opts out of by declaring `effect: 'writes'` where it is registered
 *   (#4396).
 *
 *   #4343 converged this node to that single path. `config.actionType`'s
 *   built-in side effects ('email' / 'slack') were logger-backed stubs that
 *   delivered nothing, inline `config.script` was never executed (no
 *   server-side JS sandbox), and any other `actionType` was a second spelling
 *   of `config.function`. All five keys are retired in the spec contract, which
 *   this executor now parses before it runs — see the note in `execute` for why
 *   that parse is what makes the retirement audible to stored metadata.
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
        supportsPause: true,  // (`isAsync` stood here — retired in #6748, ADR-0049: nothing read it)
        // The generic resume route IS this node's intended door: the flow-runner
        // collects the inputs and hands them back as the continuation, so there
        // is no service decision to route around (#3801). Stated rather than
        // inherited from a default — an omission is now a reported fact (#5561).
        resumeAuthority: 'any',
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
                  // Declared in #4045 — all three are forwarded into the
                  // ScreenSpec the client renders, but no form offered them, so
                  // a select field's choices (and any prefill or hint text) were
                  // authorable only by hand. Same nested position as the
                  // `visibleWhen` gap #3528 was filed for.
                  options: {
                    type: 'array', title: 'Options',
                    description: 'Choices for a select-style field.',
                    items: {
                      type: 'object',
                      properties: {
                        value: { title: 'Value', description: 'Stored value.' },
                        label: { type: 'string', title: 'Label' },
                      },
                    },
                  },
                  defaultValue: { title: 'Default', description: 'Prefilled value. Interpolates {var} references.' },
                  placeholder: { type: 'string', title: 'Placeholder' },
                  visibleWhen: { type: 'string', title: 'Visible when', xExpression: 'expression' },
                },
              },
            },
            waitForInput: { type: 'boolean', title: 'Wait for input', description: 'Pause to show this screen even with no fields (a message / confirmation). A field-less screen with this off is a server pass-through.' },
            objectName: { type: 'string', title: 'Object form', xRef: { kind: 'object' }, description: 'Render this object’s full create/edit form (incl. master-detail) instead of a flat field list.' },
            idVariable: { type: 'string', title: 'Saved-record variable', description: 'Object form only: variable bound to the saved record’s id, for later steps.' },
            mode: { type: 'string', enum: ['create', 'edit'], default: 'create', title: 'Form mode', description: 'Object form only.' },
            // Declared in #4045: `mode: 'edit'` needs a record to edit, and the
            // executor reads exactly this key for it — but the form declared the
            // mode while offering no way to name its target.
            recordId: { type: 'string', title: 'Record to edit', description: 'Object form only: id of the record `edit` mode opens. Interpolates {var} references.' },
            defaults: { type: 'object', additionalProperties: true, title: 'Form defaults', description: 'Object form only: prefilled values (e.g. account → {account_id}).' },
          },
        },
      }),
      async execute(node, variables, context) {
        // Parsed BEFORE interpolation: the contract's typed slots are strings
        // (or `unknown`, for the interpolatable `defaultValue`/`defaults`), so
        // `{var}` templates pass the parse and resolve below as always.
        const parsedCfg = parseNodeConfig<ScreenConfigParsed>('screen', node.id, ScreenConfigSchema, node.config);
        if (!parsedCfg.ok) return parsedCfg.refusal;
        const cfg = parsedCfg.config;
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

        const rawFields = cfg.fields ?? [];
        const hasFields = rawFields.length > 0;
        // Suspend to collect input when the screen declares fields, or opts in
        // explicitly. `waitForInput === false` forces a server pass-through.
        const shouldPause = cfg.waitForInput === true || (hasFields && cfg.waitForInput !== false);
        if (!shouldPause) {
          return { success: true };
        }
        const fields = rawFields.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          required: f.required === true,
          options: f.options as Array<{ value: unknown; label: string }> | undefined,
          defaultValue: f.defaultValue !== undefined ? interpolate(f.defaultValue, variables, context) : undefined,
          placeholder: f.placeholder,
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
          visibleWhen: f.visibleWhen,
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

    // script — call the registered function named by `config.function`.
    engine.registerNodeExecutor({
      type: 'script',
      descriptor: defineActionDescriptor({
        type: 'script', version: '1.0.0', name: 'Script',
        description: 'Run a custom script action.',
        icon: 'code', category: 'logic', source: 'builtin',
        // #4396 — the purity rule this executor relies on, published where an
        // author, a designer and the action catalog can read it. `category:
        // 'logic'` says nothing about it, so until this field the contract
        // existed only as a comment inside the call below.
        handlerContract: 'pure',
      }),
      async execute(node, variables, context) {
        // #4343 — the contract is parsed before anything runs. A `script` node
        // calls a registered function and nothing else, so `config.function` is
        // required and a retired dispatch key refuses here with its tombstone
        // prescription (`notify` for mail, a Slack connector for slack, a
        // registered function for an inline body).
        //
        // A refusal is a GUARD, not a routable failure: a config that fails its
        // contract is wrong METADATA — re-running it unchanged can never
        // succeed — so no `fault` edge may silence it (#3863).
        //
        // What a STORED flow meets here is the required `function`, not the
        // tombstones: `registerFlow` canonicalizes data at rest through the
        // retired conversion as well (#3903), so an old `actionType: 'email'`
        // node arrives stripped of the keys nothing read, and refuses for
        // naming no callable. That is the behavioral change the retirement
        // bought — the same node used to log a line and report success.
        //
        // The historical aliases (`functionName`/`input`) are canonicalized on
        // the same seam by 'flow-node-script-config-aliases' (#3796), so only
        // the canonical keys reach the parse.
        const parsed = parseNodeConfig<ScriptConfigParsed>('script', node.id, ScriptConfigSchema, node.config);
        if (!parsed.ok) return parsed.refusal;
        const cfg = parsed.config;
        const target = cfg.function.trim();

        // Unresolvable is a RUNTIME failure, deliberately: the function
        // registry is the host's (`defineStack({ functions })`), so the same
        // metadata succeeds on a host that registers the name. Only the
        // metadata itself earns a guard.
        const registration = engine.resolveFunction(target);
        if (!registration) {
          return {
            success: false,
            error:
              `script node '${node.id}': no function named '${target}' is registered. ` +
              `Register it via \`defineStack({ functions: { '${target}': fn } })\`, or fix the name (#1870).`,
          };
        }

        // Map declared inputs (`config.inputs`) to the function, interpolating
        // `{var}` references against the live flow variables (so a function can
        // consume a prior node's output, e.g. `{aiResult.id}`).
        const input = interpolate(cfg.inputs ?? {}, variables, context) as Record<string, unknown>;
        const outputVariable = cfg.outputVariable?.trim() || undefined;
        // Pure-function pattern: the function RETURNS its result; `outputVariable`
        // exposes it as a flow variable so a later declarative node persists it
        // (e.g. `update_record fields: { ai_category: '{aiResult.ai_category}' }`).
        // Data I/O stays on the flow graph — the function itself does no writes.
        // The descriptor above publishes that as `handlerContract: 'pure'`, and
        // `FlowFunctionContext` hands the function no data engine to write with.
        //
        // #4354 — which is why a pure function's step reports NO metrics: by that
        // contract every write it causes is a downstream `update_record` counting
        // itself, so "absent" (this kind of node touches no records) is the
        // accurate answer, not a guess.
        //
        // #4396 — and a function that legitimately writes DECLARES it
        // (`{ handler, effect: 'writes' }`), which is what turns this step's
        // silence into an honest "cannot count". Declaring stays per FUNCTION:
        // a blanket `unmeasuredEffect` on every script step would suppress the
        // broken-sweep signal on every flow that calls any function, to cover
        // the few that write. An UNDECLARED writer still under-reports — no
        // runtime check can catch code that closed over a client at module
        // scope, so the rule is published rather than policed.
        const unmeasured = registration.effect === 'writes';
        try {
          const result = await registration.handler({ input, variables, automation: context, logger: ctx.logger });
          if (outputVariable) variables.set(outputVariable, result);
          return {
            success: true,
            output: { function: target, result },
            ...(unmeasured ? { metrics: { unmeasuredEffect: true } } : {}),
          };
        } catch (err) {
          return {
            success: false,
            error: `script function '${target}' (node '${node.id}') failed: ${(err as Error).message}`,
            // A declared writer that threw may have written before it did, so
            // the run still cannot claim it counted everything.
            ...(unmeasured ? { metrics: { unmeasuredEffect: true } } : {}),
          };
        }
      },
    });

    ctx.logger.info('[Screen/Script Nodes] 2 built-in node executors registered');
}
