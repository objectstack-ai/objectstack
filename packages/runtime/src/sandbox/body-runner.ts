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
 *      via its set trap.
 */

import type { Hook } from '@objectstack/spec/data';
import { HookBodySchema } from '@objectstack/spec/data';
import type { ScriptRunner, ScriptContext, ScriptResult } from './script-runner.js';

interface FactoryOptions {
  ql: any;
  appId: string;
  logger?: any;
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
      const sandboxCtx = buildSandboxContext(engineCtx, opts.ql);
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
        applyMutationsToInput(engineCtx, result);
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
 */
export function actionBodyRunnerFactory(
  runner: ScriptRunner,
  opts: FactoryOptions,
): (action: { name: string; body?: unknown; object?: string; timeoutMs?: number }) =>
  | ((actionCtx: any) => Promise<unknown>)
  | undefined {
  return (action) => {
    const raw = action.body;
    if (!raw) return undefined;

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
      const sandboxCtx = buildActionSandboxContext(actionCtx, opts.ql);
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

function applyMutationsToInput(engineCtx: any, result: ScriptResult): void {
  const target = engineCtx?.input;
  if (!target || typeof target !== 'object') return;
  if (result.mutatedInput && typeof result.mutatedInput === 'object') {
    Object.assign(target, result.mutatedInput);
  }
  if (
    result.value &&
    typeof result.value === 'object' &&
    !Array.isArray(result.value)
  ) {
    Object.assign(target, result.value);
  }
}

function buildEngineRepoFacade(ql: any, objectName: string) {
  // Minimal repository surface that proxies to the raw engine.
  // Actions execute as the system user (no user context at HTTP boundary
  // beyond `actionCtx.user`); ObjectQL's permission middleware will still
  // gate writes via the engine's standard insert/update path.
  return {
    async find(opts?: any) { return ql.find(objectName, opts); },
    async findOne(opts?: any) {
      const rows = await ql.find(objectName, opts);
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
    async count(opts?: any) {
      if (typeof ql.count === 'function') return ql.count(objectName, opts);
      const rows = await ql.find(objectName, opts);
      return Array.isArray(rows) ? rows.length : 0;
    },
    async insert(data: any) { return ql.insert(objectName, data); },
    async update(data: any, opts?: any) { return ql.update(objectName, data, opts); },
    async upsert(data: any, opts?: any) {
      if (typeof ql.upsert === 'function') return ql.upsert(objectName, data, opts);
      return ql.insert(objectName, data);
    },
    async delete(opts?: any) { return ql.delete(objectName, opts); },
  };
}

function buildSandboxApi(engineCtx: any, ql: any, errLabel: string) {
  const engineApi = engineCtx?.api;
  if (engineApi && typeof engineApi.object === 'function') return engineApi;
  return {
    object: (objectName: string) => {
      if (!ql) throw new Error(`ObjectQL engine unavailable to ${errLabel}`);
      // Prefer the engine's own ScopedContext-based `.object()` when
      // present; otherwise synthesize a minimal repo facade against the
      // engine's CRUD primitives (so the body can call .insert/.find/etc).
      if (typeof ql.object === 'function') {
        try { return ql.object(objectName); } catch { /* fall through */ }
      }
      return buildEngineRepoFacade(ql, objectName);
    },
  };
}

function buildSandboxContext(engineCtx: any, ql: any): ScriptContext {
  const inputSnapshot = unwrapProxyToPlain(engineCtx?.input ?? engineCtx?.doc);
  const previousRaw = engineCtx?.previous ?? engineCtx?.previousDoc;
  return {
    input: inputSnapshot ?? {},
    // Preserve `undefined` for `previous` on insert events so hooks can
    // reliably distinguish create (`!ctx.previous`) from update/delete.
    previous: unwrapProxyToPlain(previousRaw),
    user: engineCtx?.user ?? engineCtx?.session?.user,
    session: engineCtx?.session,
    event: typeof engineCtx?.event === 'string' ? engineCtx.event : undefined,
    object: typeof engineCtx?.object === 'string' ? engineCtx.object : undefined,
    result: engineCtx?.result,
    api: buildSandboxApi(engineCtx, ql, 'hook body'),
    log: engineCtx?.logger,
    crypto: globalThis.crypto,
  };
}

function buildActionSandboxContext(actionCtx: any, ql: any): ScriptContext {
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
    user: actionCtx?.user ?? actionCtx?.session?.user,
    session: actionCtx?.session,
    object: typeof actionCtx?.object === 'string' ? actionCtx.object : undefined,
    recordId,
    record: unwrapProxyToPlain(actionCtx?.record),
    api: buildSandboxApi(actionCtx, ql, 'action body'),
    log: actionCtx?.logger,
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
