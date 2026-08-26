// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Hook & Action Body Runner Factory
 *
 * Bridges the metadata-only `Hook.body` / `Action.body` discriminated union
 * (defined in `@objectstack/spec/data/hook-body.zod`) into an executable
 * handler registered on the ObjectQL engine.
 *
 * The runtime owns this bridge — `objectql` itself never imports the
 * sandbox engine, so it can stay light enough to embed in tooling and
 * tests. `AppPlugin` constructs one factory per bundle bind and passes it
 * through `bindHooksToEngine({ bodyRunner })` for hooks, and walks the
 * bundle actions to register them via `engine.registerAction`.
 *
 * Per-invocation flow when a triggered hook fires:
 *   1. ObjectQL calls the wrapped handler with its native `(ctx)` arg.
 *   2. We adapt that engine-context into the sandbox `ScriptContext`
 *      shape and proxy `ctx.api.object(...)` to the running ObjectQL
 *      proxy bound to the current organization/user.
 *   3. `ScriptRunner.runScript` evaluates the body inside QuickJS with
 *      the declared capabilities + timeout.
 *   4. After settle, we write back two kinds of mutations to the host
 *      `ctx.input`:
 *      a. `result.mutatedInput` — a snapshot of `ctx.input` taken inside
 *         the VM, used to propagate direct property writes such as
 *         `ctx.input.account_number = 'ABC'`.
 *      b. `result.value` — if the script returned an object, it is
 *         shallow-merged on top of `mutatedInput` as an explicit patch.
 *      Writes go through `Object.assign`, which means the host engine's
 *      flat-record Proxy (installed by `wrapDeclarativeHook`) sees them
 *      via its set trap. `Object.assign` cannot express a REMOVAL, so
 *      keys the VM deleted are diffed out of the entry snapshot and
 *      deleted on the host separately (#12277) — see
 *      {@link applyMutationsToInput}.
 *
 * The ACTION path deliberately has no step 4: its output is the script's
 * return value, and its write channel is `ctx.api.object(...)`. In particular
 * `ctx.record` is a read-only pre-fetched snapshot — writes to it are
 * discarded whether or not the field is declared (#4345). That stays true;
 * what changed is that the discard is now REPORTED
 * ({@link warnDiscardedRecordWrites}) instead of silent.
 */

import type { Hook } from '@objectstack/spec/data';
import { HookBodySchema } from '@objectstack/spec/data';
import type { ScriptRunner, ScriptContext, ScriptResult } from './script-runner.js';
// The record-title contract, imported rather than re-derived (#11293). The
// object's `nameField` pointer, a formula title's server-side evaluation and
// the "what does this reference field point at" rule all have exactly one
// owner — `@objectstack/objectql` — and this seam is a consumer of it, not a
// second implementation. That is the whole point: the defect being closed is a
// title re-composed per hook drifting from the declaration it copies, so a
// runtime-side copy of the same rules would reproduce the defect one layer up.
import {
  hookRecordState,
  resolveRecordTitle,
  resolveRelatedTitleTarget,
} from '@objectstack/objectql';

interface FactoryOptions {
  ql: any;
  appId: string;
  logger?: any;
}

/**
 * Build the `['log']` capability surface for one body invocation (#7448).
 *
 * ## Why this is not `engineCtx?.logger`
 *
 * It was, at `:339` (hooks) and `:377` (actions), and that key is written by
 * nobody. `HookContextSchema` (`packages/spec/src/data/hook.zod.ts`) declares
 * no `logger`, and ObjectQL's engine — the sole producer of a HookContext —
 * builds all four of them (`engine.ts` `beforeFind` / `find` / `update` /
 * `delete` assembly sites) without one. Both action-context assembly sites
 * (`../domains/actions.ts` REST `/actions`, `../action-execution.ts` MCP
 * `run_action`) likewise write no `logger`. So `ctx.log` resolved `undefined`
 * on EVERY path, and `installCtx` (`quickjs-runner.ts`) forwards through
 * `ctx.log?.[level]?.(…)` — an optional call on an absent host seam. The
 * capability gate passes, the VM-side `ctx.log.info` exists, the body runs to
 * completion and returns normally, and the line goes nowhere. QA run #7439 saw
 * exactly that: `[BodyRunner] hook fired` at `--log-level debug` with the
 * body's own `ctx.log.info('task completed: …')` absent.
 *
 * That is the third limb of this shape removed from this file, not the first:
 * `doc` / `previousDoc` (#5906) and `session.user` (#6316) were also keys no
 * producer ever wrote, deleted rather than left as a second de-facto contract
 * (Prime Directive #12). The remedy is the same — read the source that exists.
 * `opts.logger` is the engine's own `Logger`, handed to the factory by all four
 * construction sites in `../app-plugin.ts` (`logger: ctx.logger`), and it is
 * the very logger whose `[BodyRunner] hook fired` WAS observable in the same
 * QA run. Adding a `logger` to `HookContextSchema` instead would widen the
 * metadata contract to re-supply, per invocation, something the runner already
 * holds for the lifetime of the bind.
 *
 * ## Why absence warns rather than falling back to `console`
 *
 * A declared capability must not silently produce nothing — either it works or
 * the author is told it cannot. When the factory was constructed with no logger
 * at all, working is not on the table, so this takes the told branch. Routing
 * to `console` instead would override a decision that belongs to the host: a
 * `Logger` carries the level threshold, formatting and sinks the host chose,
 * and a host running at `warn` would start receiving body `info` lines on an
 * unfiltered second stream it never configured. No production path reaches the
 * warning — all four `../app-plugin.ts` sites pass `ctx.logger` — so it is a
 * diagnostic for embedders that construct the factory directly, and it fires
 * once per invocation rather than once per call so a chatty body cannot bury
 * the rest of the log.
 */
function buildBodyLogSurface(
  opts: FactoryOptions,
  origin: { kind: 'hook' | 'action'; name: string },
): ScriptContext['log'] {
  const logger = opts.logger;
  const label = `[${origin.kind} '${origin.name}']`;

  if (!logger) {
    let warned = false;
    const warnOnce = () => {
      if (warned) return;
      warned = true;
      console.warn(
        `[BodyRunner] ${origin.kind} '${origin.name}' (app '${opts.appId}') declares the 'log' ` +
          `capability, but this BodyRunner was constructed without a logger — ctx.log output is ` +
          `discarded. Pass \`logger\` to ${origin.kind}BodyRunnerFactory({ … }). See #7448.`,
      );
    };
    // [#7661] `debug` is warned for like the other three. A member missing from
    // THIS branch is `undefined` at `ctx.log?.[level]?.(…)`, which is the same
    // `TypeError: not a function` one construction shape over.
    return { debug: warnOnce, info: warnOnce, warn: warnOnce, error: warnOnce };
  }

  // `Logger.meta` is a `Record` (`packages/spec/src/contracts/logger.ts`); a
  // body may pass anything JSON-serialisable, so non-objects are carried under
  // a `data` key rather than dropped on the floor.
  const toMeta = (data: unknown): Record<string, any> | undefined => {
    if (data === undefined || data === null) return undefined;
    if (typeof data === 'object' && !Array.isArray(data)) return data as Record<string, any>;
    return { data };
  };

  return {
    // [#7661] The fourth level. `installCtx` forwards through
    // `ctx.log?.[level]?.(…)` — an optional call — so a `debug` absent from this
    // object is not a throw but a SILENT DROP: the VM-side method exists, the
    // body runs to completion, and the line goes nowhere. That is the #7448
    // defect verbatim, which is why the pin asserts a delivered record rather
    // than the absence of a throw. `Logger.debug` is `(message, meta)` — two
    // args, like `info`/`warn` and unlike `error` below.
    debug: (msg: string, data?: unknown) => logger.debug?.(`${label} ${msg}`, toMeta(data)),
    info: (msg: string, data?: unknown) => logger.info?.(`${label} ${msg}`, toMeta(data)),
    warn: (msg: string, data?: unknown) => logger.warn?.(`${label} ${msg}`, toMeta(data)),
    // ⚠️ `Logger.error` is `(message, error, meta)` — THREE args, and the body's
    // `data` is the third. Passing it second lands a meta object in the `Error`
    // slot, where `ConsoleLogger`/`JsonLogger` read `error.message`/`error.stack`
    // as `undefined` and drop every field, leaving a bare sentence. Same trap
    // `hook-wrappers.ts` documents for `HookDiagnosticsLogger`.
    error: (msg: string, data?: unknown) => logger.error?.(`${label} ${msg}`, undefined, toMeta(data)),
  };
}

/**
 * Build the `ctx.title(field?)` seam for one hook-body invocation (#11293).
 *
 * ## The measurement this shape is answering
 *
 * A hook body could not name a record. `ctx.previous` / `ctx.input` carry
 * stored columns, a formula is computed on read, and nothing on `ctx` resolves
 * the object's `nameField` — so a body composing "Case X was closed" had to
 * re-implement the object's title inline. The exemplar app carried **five**
 * such reimplementations, and in **four of the five** the `nameField` is a
 * FORMULA (`display_title`, `full_name`); only one is a real column. So the
 * formula case is the design centre here, not an extension of the column case:
 * an accessor that only read stored columns would answer the wrong four of
 * five, and the ruling's parenthetical — *formula evaluated server-side* — is
 * load-bearing.
 *
 * What the absence actually produced was worse than duplication. The cheap
 * thing to write with no title accessor is `record.id`, the one identifier
 * always in scope, and it shipped into user-facing prose across four hooks. An
 * AI writing a hook reaches for it for the same reason. Hence the whole point
 * of this seam: put the correct answer closer to hand than the wrong one.
 *
 * ## Why the two forms cost different things
 *
 *  - **`ctx.title()`** — this record. `hookRecordState` is the state the hook
 *    is ALREADY firing on (stored ⊕ payload, materialized over the declared
 *    fields — the very state the declarative `condition` gate evaluates), so
 *    the record is in hand. A formula title is evaluated against it in-process
 *    by `resolveRecordTitle`: **zero round trips**, even for the majority
 *    formula case. Measured cost is one CEL evaluation of one expression.
 *  - **`ctx.title('account_id')`** — a related record. A lookup column hands
 *    the body an id and nothing else, so this costs **exactly one `findOne`**,
 *    and no more: the engine's read path already materializes formula fields
 *    onto what it returns, so the related record arrives with its own
 *    `display_title` computed. There is no second pass and no per-field
 *    round trip.
 *
 * That asymmetry is why the VM-facing wire gates only the second form behind
 * `api.read` (see `installCtx`): the token gates a read, and the first form has
 * no read to gate.
 *
 * ## Why the read goes through `ctx.api` and not the engine directly
 *
 * `api` is handed in per call by the installer rather than closed over, so it
 * is the transaction-scoped context whenever a body-opened
 * `ctx.api.transaction` is in flight. A related-title read that bypassed it
 * would ask the pool for a second connection — invisible on a roomy pool, a
 * deadlock on `pool max=1`, which is SQLite and therefore the default
 * datasource for `objectstack dev`. It also means the read obeys the caller's
 * scope and field-level security exactly as the body's own
 * `ctx.api.object(...).findOne` would: the accessor is a convenience over the
 * read channel a body already has, never a privilege escalation around it.
 */
function buildTitleSurface(
  engineCtx: any,
  ql: any,
  origin: { kind: 'hook' | 'action'; name: string },
): ScriptContext['title'] {
  const label = `ctx.title (${origin.kind} '${origin.name}')`;

  return async (field: string | undefined, api: unknown): Promise<string | undefined> => {
    const objectName = typeof engineCtx?.object === 'string' ? engineCtx.object : undefined;
    if (!objectName || !ql || typeof ql.getObject !== 'function') {
      throw new Error(`${label}: no object schema is reachable from this hook context`);
    }
    const schema = ql.getObject(objectName);
    if (!schema) {
      throw new Error(`${label}: object '${objectName}' is not registered`);
    }
    const record = hookRecordState(engineCtx);
    const execCtx = executionContextFromHook(engineCtx);

    if (field === undefined) {
      return resolveRecordTitle(schema, record, execCtx);
    }

    const target = resolveRelatedTitleTarget(schema, record, field, label);
    // A declared but EMPTY reference: an ordinary state, answered as absence.
    if (!target) return undefined;

    const source = (api ?? engineCtx?.api) as { object?: (n: string) => any } | undefined;
    if (!source || typeof source.object !== 'function') {
      throw new Error(`${label}: no read channel is available to resolve '${field}'`);
    }
    const related = await source.object(target.object).findOne({ where: { id: target.id } });
    if (!related) return undefined;
    // The read path already evaluated the related object's formula fields onto
    // this row; `resolveRecordTitle` re-derives the SAME value from the same
    // declaration rather than trusting whichever repo facade answered, so a
    // minimal embedder's `findOne` cannot quietly downgrade a formula title to
    // absence.
    return resolveRecordTitle(ql.getObject(target.object), related as Record<string, unknown>, execCtx);
  };
}

/**
 * The evaluation scope a formula title is computed in, derived from what the
 * hook context actually carries.
 *
 * `HookContext` declares no `timezone` and no `ExecutionContext`, so this is the
 * closest scope reachable on this path rather than a copy of the read path's:
 * `os.user` / `os.org` resolve from the hook session, and a timezone-sensitive
 * formula falls back to the server default exactly as it does for every other
 * hook-layer CEL evaluation. Stated rather than silently approximated — a
 * `nameField` formula reading `os.user` is the realistic case and it works;
 * one reading a localized date is the case that can differ from a REST read,
 * and an author is owed that fact.
 */
function executionContextFromHook(engineCtx: any): any {
  const session = engineCtx?.session;
  if (!session || typeof session !== 'object') return undefined;
  return {
    userId: session.userId,
    tenantId: session.organizationId,
    positions: Array.isArray(session.positions) ? session.positions : undefined,
    isSystem: session.isSystem,
  };
}

export function hookBodyRunnerFactory(
  runner: ScriptRunner,
  opts: FactoryOptions,
): (hook: Hook) => ((engineCtx: any) => Promise<void>) | undefined {
  return (hook: Hook) => {
    const raw = (hook as any).body;
    if (!raw) return undefined;

    const parsed = HookBodySchema.safeParse(raw);
    if (!parsed.success) {
      opts.logger?.warn?.('[BodyRunner] invalid hook.body shape', {
        appId: opts.appId,
        hook: hook.name,
        issues: parsed.error.issues.slice(0, 3),
      });
      return undefined;
    }
    const body = parsed.data;

    return async function boundBodyHandler(engineCtx: any): Promise<void> {
      const sandboxCtx = buildSandboxContext(
        engineCtx,
        opts.ql,
        buildBodyLogSurface(opts, { kind: 'hook', name: hook.name }),
        buildTitleSurface(engineCtx, opts.ql, { kind: 'hook', name: hook.name }),
      );
      try {
        opts.logger?.debug?.('[BodyRunner] hook fired', { appId: opts.appId, hook: hook.name });
        const result = await runner.run(body, sandboxCtx, {
          origin: {
            kind: 'hook',
            name: hook.name,
            object: typeof (hook as any).object === 'string' ? (hook as any).object : undefined,
          },
          // When the body declares no timeout, leave opts.timeoutMs unset so the
          // runner's own configurable hook default applies (QuickJSScriptRunner
          // defaults to 250ms). Hardcoding the fallback here would make that
          // constructor option dead for hooks.
          timeoutMs: (body as any).timeoutMs,
        });
        applyMutationsToInput(engineCtx, result, sandboxCtx.input);
      } catch (err: any) {
        opts.logger?.error?.('[BodyRunner] sandboxed hook threw', err, {
          appId: opts.appId,
          hook: hook.name,
        });
        throw err;
      }
    };
  };
}

/**
 * Action body runner factory.
 *
 * Returns a handler with the shape ObjectQL's `executeAction` expects:
 * `(actionCtx) => Promise<unknown>`. The action's return value bubbles up
 * to the HTTP dispatcher which JSON-serialises it back to the caller.
 *
 * This is the ONE choke point where an `action.body` becomes an executable
 * handler — both bind paths go through it (`AppPlugin`'s bundle walk over
 * `collectBundleActions`, and `engine.setDefaultActionRunner` for the
 * Studio-authored `action` metadata ObjectQLPlugin re-syncs). So the
 * `type` gate below is enforced here rather than at either call site: a
 * second copy at the collector would be a rule that can drift from this one.
 */
export function actionBodyRunnerFactory(
  runner: ScriptRunner,
  opts: FactoryOptions,
): (action: { name: string; body?: unknown; object?: string; type?: string; timeoutMs?: number }) =>
  | ((actionCtx: any) => Promise<unknown>)
  | undefined {
  return (action) => {
    const raw = action.body;
    if (!raw) return undefined;

    // [#4352] `body` binds a handler ONLY for `type: 'script'` — the rule the
    // spec always stated (`ActionSchema.body`: "Only used when type is
    // `script`") and the runtime never enforced. Every other type dispatches
    // on `target` (the URL, page, flow or endpoint), so a body alongside one
    // is self-contradictory metadata: two implementations, only one of which
    // the author can see running.
    //
    // Binding it anyway produced the worst-shaped bug this repo has a name
    // for — an author flips `type` from `script` to `url`, reasonably reads
    // that as "the body no longer runs", and it keeps running, reachable
    // through `ql.object(o).execute(name)` (the ObjectQL proxy calls
    // `executeAction` with no type branching of its own) and counted by the
    // ADR-0110 D5 governance inventory as a live handler.
    //
    // `?? 'script'` is the schema's own default (`ActionType.default('script')`),
    // not a tolerant fallback: the collectors walk RAW bundle objects, which
    // for a `strict: false` `defineStack` or a legacy `manifest.actions[]`
    // never went through `ActionSchema`, so an omitted `type` still has to
    // mean what the spec says it means. An action that EXPLICITLY declares
    // another type is the only one whose behavior changes.
    //
    // The publish gate rejects this shape at authoring time (`ActionSchema`'s
    // non-script-body refinement, #4438), so anything arriving here is either
    // data at rest published before that gate existed or a bundle that never
    // parsed. Refusing silently would just relocate the invisibility, so the
    // refusal is logged with the same prescription the schema gives.
    const type = action.type ?? 'script';
    if (type !== 'script') {
      opts.logger?.warn?.(
        `[BodyRunner] action '${action.name}' declares \`type: '${type}'\` and carries a \`body\` — ` +
          `no handler was bound. \`body\` only runs for \`type: 'script'\`; a '${type}' action dispatches ` +
          `on \`target\`. Set \`type: 'script'\` to run the body, or drop the \`body\`. See #4352.`,
        { appId: opts.appId, action: action.name, object: action.object, type },
      );
      return undefined;
    }

    const parsed = HookBodySchema.safeParse(raw);
    if (!parsed.success) {
      opts.logger?.warn?.('[BodyRunner] invalid action.body shape', {
        appId: opts.appId,
        action: action.name,
        issues: parsed.error.issues.slice(0, 3),
      });
      return undefined;
    }
    const body = parsed.data;

    return async function boundActionHandler(actionCtx: any): Promise<unknown> {
      const sandboxCtx = buildActionSandboxContext(
        actionCtx,
        opts.ql,
        buildBodyLogSurface(opts, { kind: 'action', name: action.name }),
      );
      try {
        opts.logger?.debug?.('[BodyRunner] action fired', {
          appId: opts.appId,
          action: action.name,
          object: action.object,
        });
        const result = await runner.run(body, sandboxCtx, {
          origin: { kind: 'action', name: action.name, object: action.object },
          // As with hooks above: no declared timeout → let the runner's
          // configurable action default (5000ms) apply.
          timeoutMs: (body as any).timeoutMs ?? action.timeoutMs,
        });
        warnDiscardedRecordWrites(result, action.name, action.object, opts);
        return result.value;
      } catch (err: any) {
        opts.logger?.error?.('[BodyRunner] sandboxed action threw', err, {
          appId: opts.appId,
          action: action.name,
        });
        throw err;
      }
    };
  };
}

/**
 * Report `ctx.record` writes the action path discards (#4345).
 *
 * The hook path writes `ctx.input` back to the engine via
 * {@link applyMutationsToInput}; the action path has no counterpart for
 * `ctx.record`, by design — an action's output is its return value, and its
 * write channel is `ctx.api`. What was wrong was not the design but the
 * SILENCE: a body assigning to `ctx.record` got a successful action and an
 * unchanged record, with no diagnostic anywhere, and the field being correctly
 * declared changed nothing (the #4001 false-completion shape).
 *
 * Advisory, not fatal — the same reason the author-time lint warns rather than
 * gates: a body may legitimately use the snapshot as local scratch
 * (`ctx.record.total = a + b; return { total: ctx.record.total }`), which is
 * indistinguishable here from an intended persist. The message states what is
 * true of both — the writes did not leave the VM — and names the remedy.
 * Ratcheting to a throw is a decision for field data, not a default.
 */
function warnDiscardedRecordWrites(
  result: ScriptResult,
  actionName: string,
  object: string | undefined,
  opts: FactoryOptions,
): void {
  const fields = result.droppedRecordWrites;
  if (!fields || fields.length === 0) return;
  opts.logger?.warn?.(
    `[BodyRunner] action '${actionName}' wrote ${fields.length} field(s) to ctx.record, which is a read-only ` +
      `pre-fetched snapshot — the writes never left the sandbox and the stored record is unchanged. ` +
      `To persist, call ctx.api.object('${object ?? '<object>'}').update({ id: ctx.recordId, … }) ` +
      `(needs the 'api.write' capability). See #4345.`,
    { appId: opts.appId, action: actionName, object, fields },
  );
}

/**
 * [#12277] Keys of the ENTRY snapshot that the VM could actually see, and
 * therefore the only keys whose absence from the exit snapshot is evidence of
 * a deletion.
 *
 * Both directions of the sandbox boundary are JSON (`safeJsonStringify` in,
 * `JSON.stringify` out), and JSON has no spelling for `undefined`, a function,
 * or a symbol. A key carrying one of those is absent from the VM's `ctx.input`
 * from the start, so it is absent from the dump too — indistinguishable, on the
 * dump alone, from a key the body deleted. Filtering the entry side through the
 * SAME lens removes that ambiguity at the source instead of guessing at it.
 *
 * Every failure mode here is deliberately conservative — a key that cannot be
 * probed is simply not deletable, so the worst outcome is the pre-#12277
 * behaviour (a delete that does not land) rather than a field destroyed on
 * evidence that was never there. One residual miss follows from that and is
 * worth naming: `safeJsonStringify` marshals a `bigint` into the VM as a
 * string, while the probe below throws on it and drops it — so a delete of a
 * bigint-valued key is still lost. Losing a delete is the recoverable
 * direction; inventing one is not.
 */
function vmVisibleEntryKeys(entryInput: unknown): string[] {
  if (!entryInput || typeof entryInput !== 'object' || Array.isArray(entryInput)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(entryInput as Record<string, unknown>)) {
    try {
      if (JSON.stringify(v) !== undefined) out.push(k);
    } catch {
      /* unserialisable (cycle, bigint) — not deletable on this evidence */
    }
  }
  return out;
}

/**
 * Write one settled body's mutations back onto the host `ctx.input`.
 *
 * ## [#12277] Why a key diff, and not `Object.assign` alone
 *
 * `Object.assign` copies own enumerable properties, and **has no way to
 * represent a deletion**: a key the VM removed simply is not in `mutatedInput`,
 * and the original stays. So `delete ctx.input.internal_notes` in a sandboxed
 * body was lost on the way home — and lost in the worst possible shape,
 * because INSIDE the VM the delete is real. Measured on the pre-fix code, with
 * the host row alongside:
 *
 * ```
 * delete ctx.input.internal_notes    ->  true
 * 'internal_notes' in ctx.input      ->  false      // the VM agrees
 * Object.keys(ctx.input)             ->  ['subject'] // …and so does this
 * host ctx.input after write-back    ->  { subject: 'HELP',
 *                                          internal_notes: 'STAFF-ONLY' }
 * ```
 *
 * Every instrument reachable from inside the body confirms the removal, an
 * assignment made in the same call lands, and the field is stored anyway.
 * There is no diagnostic to notice and nothing to notice it with.
 *
 * The sibling half of the same defect was the engine's flat-input Proxy
 * missing its `deleteProperty` trap (`installFlatInput`,
 * `packages/objectql/src/hook-wrappers.ts`); the two are unrelated mechanisms
 * with one author-visible outcome. They are fixed together on purpose: closing
 * one alone would make the same authored `delete` behave differently depending
 * on whether the body runs in-process or in QuickJS, which is a worse contract
 * than the symmetric silence it replaces.
 *
 * Deletions apply BEFORE both merges, so a body that deletes a key and then
 * returns it (`delete ctx.input.x; return { x: 1 };`) keeps the explicit patch
 * — the return value is the later, more deliberate statement of the two.
 */
function applyMutationsToInput(
  engineCtx: any,
  result: ScriptResult,
  // `unknown`, not `Record<string, unknown>`: that is what `ScriptContext.input`
  // declares, and narrowing is {@link vmVisibleEntryKeys}'s job. Widening the
  // declared type here to make the call site typecheck would move the guard to
  // the producer's word rather than this consumer's own check.
  entryInput?: unknown,
): void {
  const target = engineCtx?.input;
  if (!target || typeof target !== 'object') return;
  if (result.mutatedInput && typeof result.mutatedInput === 'object') {
    const mutated = result.mutatedInput;
    for (const key of vmVisibleEntryKeys(entryInput)) {
      if (!(key in mutated)) delete (target as Record<string, unknown>)[key];
    }
    Object.assign(target, mutated);
  }
  if (
    result.value &&
    typeof result.value === 'object' &&
    !Array.isArray(result.value)
  ) {
    Object.assign(target, result.value);
  }
}

/**
 * Last-resort repository surface proxying to the raw engine, used only when
 * the host context carried no `api` and the engine exposes no `.object()`.
 *
 * `context` is the ExecutionContext every call is threaded with. It is NOT
 * optional in spirit: proxying context-less is what #3914 was — the write
 * reaches plugin-sharing's gate with no `userId` to own the record and no
 * `isSystem` to bypass, so it is denied FORBIDDEN even for an admin. A caller
 * that has no context to give gets the same identity-less behavior as before,
 * which is why the action path now always supplies one.
 */
function buildEngineRepoFacade(ql: any, objectName: string, context?: any) {
  const withCtx = (opts?: any) =>
    context ? { ...(opts && typeof opts === 'object' ? opts : {}), context } : opts;
  return {
    async find(opts?: any) { return ql.find(objectName, withCtx(opts)); },
    async findOne(opts?: any) {
      const rows = await ql.find(objectName, withCtx(opts));
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
    async count(opts?: any) {
      if (typeof ql.count === 'function') return ql.count(objectName, withCtx(opts));
      const rows = await ql.find(objectName, withCtx(opts));
      return Array.isArray(rows) ? rows.length : 0;
    },
    async insert(data: any) { return ql.insert(objectName, data, withCtx(undefined)); },
    async update(data: any, opts?: any) { return ql.update(objectName, data, withCtx(opts)); },
    async upsert(data: any, opts?: any) {
      if (typeof ql.upsert === 'function') return ql.upsert(objectName, data, withCtx(opts));
      return ql.insert(objectName, data, withCtx(undefined));
    },
    async delete(opts?: any) { return ql.delete(objectName, withCtx(opts)); },
  };
}

function buildSandboxApi(engineCtx: any, ql: any, errLabel: string) {
  const engineApi = engineCtx?.api;
  if (engineApi && typeof engineApi.object === 'function') return engineApi;
  // [#3914] The host's own execution envelope, when it supplied one. Hooks get
  // `api` from the engine and never reach here; actions now supply both, so
  // this stays the fallback for hosts that predate either.
  const execCtx = engineCtx?.executionContext;
  return {
    object: (objectName: string) => {
      if (!ql) throw new Error(`ObjectQL engine unavailable to ${errLabel}`);
      // Prefer the engine's own ScopedContext-based `.object()` when
      // present; otherwise synthesize a minimal repo facade against the
      // engine's CRUD primitives (so the body can call .insert/.find/etc).
      if (typeof ql.createContext === 'function' && execCtx) {
        try { return ql.createContext(execCtx).object(objectName); } catch { /* fall through */ }
      }
      if (typeof ql.object === 'function') {
        try { return ql.object(objectName); } catch { /* fall through */ }
      }
      return buildEngineRepoFacade(ql, objectName, execCtx);
    },
  };
}

function buildSandboxContext(
  engineCtx: any,
  ql: any,
  log: ScriptContext['log'],
  title?: ScriptContext['title'],
): ScriptContext {
  // `input` and `previous` are the engine's own spellings, and the only ones:
  // `HookContextSchema` (`packages/spec/src/data/hook.zod.ts`) declares neither a
  // top-level `doc` nor a `previousDoc`, and objectql's `engine.ts` — the sole
  // producer of a HookContext — builds neither. Alias limbs for both sat here for
  // producers that never existed; removed in #5906 (same family as #5671) rather
  // than left as a second de-facto contract (PD #12).
  const inputSnapshot = unwrapProxyToPlain(engineCtx?.input);
  const previousRaw = engineCtx?.previous;

  // [#11552] The per-row dispatch signal, and the D2 options visibility, both
  // of which the snapshot above DROPS by construction: `unwrapProxyToPlain`
  // materialises only what `installFlatInput`'s `ownKeys` enumerates (the
  // payload fields), and `dispatch` was never marshalled at all. ADR-0058
  // Addendum II D3 names three routes for row-specific work, and routes 1
  // (scoped throw) and 2 (`ctx.api` per row) both require the handler to KNOW
  // it is on the per-row path — a guard written `ctx.dispatch?.mode ===
  // 'per-row'` in a shipped body lowered cleanly and evaluated `false` on
  // every dispatch in production (maintainer ruling on #11552: close the
  // declared≠observable gap; the D3 contract itself is untouched).
  //
  // Copy `{ mode, index }` only when the engine marker carries its declared
  // shape — an unrecognised shape is left ABSENT, never guessed at, so
  // `ctx.dispatch?.mode` reads "not a per-row dispatch" exactly as the spec's
  // back-compat rule prescribes. `scope` is deliberately not copied (see
  // {@link ScriptContext.dispatch}).
  const dispatchRaw = engineCtx?.dispatch;
  const dispatch =
    dispatchRaw &&
    typeof dispatchRaw === 'object' &&
    (dispatchRaw.mode === 'record' || dispatchRaw.mode === 'per-row') &&
    typeof dispatchRaw.index === 'number'
      ? { mode: dispatchRaw.mode as 'record' | 'per-row', index: dispatchRaw.index as number }
      : undefined;

  // [#11552] The caller's bag, read THROUGH the flat proxy's get trap (wrapper
  // keys pass through even though `ownKeys` hides them), projected to the two
  // members D2 declares `before*`-visible. `{}` when a bag exists but carries
  // neither — presence mirrors the engine face; absence stays absence.
  const optionsRaw =
    engineCtx?.input && typeof engineCtx.input === 'object'
      ? (engineCtx.input as { options?: unknown }).options
      : undefined;
  let inputOptions: ScriptContext['inputOptions'];
  if (optionsRaw && typeof optionsRaw === 'object') {
    const bag = optionsRaw as Record<string, unknown>;
    inputOptions = {};
    if ('multi' in bag) inputOptions.multi = bag.multi;
    if ('where' in bag) inputOptions.where = bag.where;
  }

  return {
    input: inputSnapshot ?? {},
    // Preserve `undefined` for `previous` on insert events so hooks can
    // reliably distinguish create (`!ctx.previous`) from update/delete.
    previous: unwrapProxyToPlain(previousRaw),
    // `engineCtx.user` is the ONLY source, and the `?? engineCtx?.session?.user`
    // limb that used to follow it was removed in #6316 (same family as #5906
    // above, and as #4984): `HookContext['session']` declares no `user` key
    // (`packages/spec/src/data/hook.zod.ts`) and its sole producer —
    // ObjectQL's `buildSession()` (`packages/objectql/src/engine.ts`), which
    // every HookContext assembly site in the engine calls — builds the session
    // field by field and writes none. The limb resolved `undefined` on every
    // real path, so deleting it changes no behaviour; what it changed was the
    // reading, which advertised a second data source that has never existed.
    // Keep it deleted: a `session.user` that some future engine "might" set is
    // a contract to DECLARE on `HookContextSchema.session`, not to anticipate
    // with consumer-side tolerance here (PD #12).
    user: engineCtx?.user,
    session: engineCtx?.session,
    event: typeof engineCtx?.event === 'string' ? engineCtx.event : undefined,
    object: typeof engineCtx?.object === 'string' ? engineCtx.object : undefined,
    result: engineCtx?.result,
    api: buildSandboxApi(engineCtx, ql, 'hook body'),
    // [#7448] NOT `engineCtx?.logger` — a key no HookContext producer writes and
    // `HookContextSchema` never declared, so the `['log']` capability resolved
    // `undefined` and every body log line vanished. See {@link buildBodyLogSurface}.
    log,
    // [#11293] Hook face only. The action face has its own record shape
    // (`ctx.record`, a pre-fetched read-only snapshot) and its own dispatch
    // sites; widening the accessor to it is a separate capability call and is
    // deliberately not taken here — the ruling names hook bodies.
    title,
    // [#11552] Hook face only, both of them: an action is never one of N
    // dispatches for one write, and its params bag has no caller options.
    dispatch,
    inputOptions,
    crypto: globalThis.crypto,
  };
}

function buildActionSandboxContext(
  actionCtx: any,
  ql: any,
  log: ScriptContext['log'],
): ScriptContext {
  // Action ctx convention (mirrors http-dispatcher.ts):
  //   { record, params, recordId, user, session, engine, services, ... }
  // The script signature is `(input, ctx)` — input gets `params`, ctx gets
  // the full action context.
  const recordId =
    typeof actionCtx?.recordId === 'string'
      ? actionCtx.recordId
      : typeof actionCtx?.record?.id === 'string'
        ? actionCtx.record.id
        : undefined;
  return {
    input: unwrapProxyToPlain(actionCtx?.params ?? {}),
    previous: undefined,
    // Same removal as the hook face above (#6316), measured on this face's own
    // shapes: `ActionSession` (`packages/spec/src/ui/action-params.zod.ts`)
    // declares `userId` / `organizationId` / `positions` / `roles` and no
    // `user`, and its sole producer `buildActionSession()`
    // (`../action-execution.ts`) writes exactly those four — for both action ctx
    // assembly sites (`action-execution.ts` MCP `run_action`, `domains/actions.ts`
    // REST `/actions`). The third `executeAction` caller, ObjectQL's
    // `ScopedRepo.execute()`, passes neither `user` nor `session`, so `ctx.user`
    // stays `undefined` there — unchanged by this removal, and the correct
    // semantics: that path carries no caller identity.
    user: actionCtx?.user,
    session: actionCtx?.session,
    object: typeof actionCtx?.object === 'string' ? actionCtx.object : undefined,
    recordId,
    // A snapshot by construction, and read-only by contract (#4345): nothing
    // downstream writes it back. `warnDiscardedRecordWrites` reports the writes
    // a body makes to it rather than letting them vanish.
    record: unwrapProxyToPlain(actionCtx?.record),
    api: buildSandboxApi(actionCtx, ql, 'action body'),
    // [#7448] Same removal as the hook face: neither action-context assembly
    // site (`../domains/actions.ts`, `../action-execution.ts`) writes `logger`.
    log,
    crypto: globalThis.crypto,
  };
}

/**
 * Convert a Proxy-wrapped record into a plain object so it round-trips through
 * JSON cleanly. `Object.fromEntries(Object.entries(p))` triggers the proxy's
 * ownKeys + get traps, materialising every visible field.
 */
function unwrapProxyToPlain(v: unknown): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object') return undefined;
  if (Array.isArray(v)) return undefined;
  try {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>));
  } catch {
    return undefined;
  }
}
