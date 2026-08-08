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

function buildSandboxContext(engineCtx: any, ql: any): ScriptContext {
  // `input` and `previous` are the engine's own spellings, and the only ones:
  // `HookContextSchema` (`packages/spec/src/data/hook.zod.ts`) declares neither a
  // top-level `doc` nor a `previousDoc`, and objectql's `engine.ts` — the sole
  // producer of a HookContext — builds neither. Alias limbs for both sat here for
  // producers that never existed; removed in #5906 (same family as #5671) rather
  // than left as a second de-facto contract (PD #12).
  const inputSnapshot = unwrapProxyToPlain(engineCtx?.input);
  const previousRaw = engineCtx?.previous;
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
