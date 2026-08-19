// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # QuickJS-backed ScriptRunner
 *
 * Implements `ScriptRunner` using `quickjs-emscripten` (pure-WASM, edge-safe).
 *
 * Responsibilities:
 * - L1 ExpressionBody — evaluated as a `return (<source>)` snippet.
 * - L2 ScriptBody    — wrapped in `(async (ctx) => { <source> })(ctx)` (hooks)
 *                      or `(async (input, ctx) => { <source> })(input, ctx)` (actions).
 * - Hard timeout via QuickJS interrupt handler.
 * - Capability gating — host-side `ctx.api`, `ctx.crypto`, `ctx.log` are only
 *   wired into the VM if the body declares the matching capability.
 * - Structured marshalling — JSON-serialisable values cross the VM boundary.
 *   Functions are exposed as host-resident proxies (the script calls
 *   `ctx.api.object('foo').count(...)` and the host method runs in node).
 *
 * Trade-offs:
 * - Per-invocation overhead is dominated by VM creation: every call instantiates
 *   a fresh **sync** WASM module via `newQuickJSWASMModule()` (no asyncify) and
 *   drops it on settle (see {@link QuickJSScriptRunner.execute}). Modules are
 *   deliberately NOT shared — separate modules are physically memory-isolated, so
 *   a QuickJS heap bug can't reach another invocation's data (ADR-0102 D2/D4).
 * - Budgeting is CPU-time, not wall-clock (ADR-0102 D1): the per-invocation
 *   `timeoutMs` bounds VM-active time (env defaults `OS_SANDBOX_HOOK_TIMEOUT_MS` /
 *   `OS_SANDBOX_ACTION_TIMEOUT_MS`; `OS_SANDBOX_WALL_CEILING_MS` the wall
 *   backstop), so host-await time and a nested hook's own run are not charged to
 *   the caller — the load flake that motivated this (framework#3259) cannot recur
 *   while a script is merely waiting on the host.
 * - Memory caps are advisory under quickjs (engine has no hard MB cap); the
 *   runner uses `setMemoryLimit(memoryMb * 1MB)` which is best-effort.
 */

import {
  newQuickJSWASMModule,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
} from 'quickjs-emscripten';
import { resolveSandboxTimeoutMs } from '@objectstack/types';
import type { HookBody, ScriptBody, ExpressionBody, HookBodyCapability } from '@objectstack/spec/data';
import type {
  ScriptContext,
  ScriptOrigin,
  ScriptResult,
  ScriptRunOptions,
  ScriptRunner,
} from './script-runner.js';

const DEFAULT_HOOK_TIMEOUT_MS = 250;
const DEFAULT_ACTION_TIMEOUT_MS = 5000;
const DEFAULT_MEMORY_MB = 32;
// Wall-clock backstop (ADR-0102 D1): the CPU budget bounds VM-active time, but a
// body parked forever on a host call that never settles burns no CPU — the
// interrupt handler can't fire while no VM code runs — so a separate, generous
// wall ceiling cuts it off. 30s matches the spec cap on `ScriptBody.timeoutMs`.
const DEFAULT_WALL_CEILING_MS = 30_000;

export interface QuickJSScriptRunnerOptions {
  /** Default per-invocation **CPU-time** budget for hooks (ms). */
  hookTimeoutMs?: number;
  /** Default per-invocation **CPU-time** budget for actions (ms). */
  actionTimeoutMs?: number;
  /**
   * Wall-clock ceiling (ms) — the backstop for a body stuck on a never-settling
   * host call. Effective ceiling is `max(this, cpuBudget)`, so it can never cut
   * a body still inside its CPU budget. Default 30_000.
   */
  wallCeilingMs?: number;
  /** Default memory cap in MB. */
  memoryMb?: number;
}

export class QuickJSScriptRunner implements ScriptRunner {
  private opts: Required<QuickJSScriptRunnerOptions>;

  constructor(opts: QuickJSScriptRunnerOptions = {}) {
    // Precedence for the per-invocation timeout default: an explicit constructor
    // option wins; else the deployment's `OS_SANDBOX_{HOOK,ACTION}_TIMEOUT_MS`
    // env override (so a loaded/slow host — e.g. an oversubscribed CI runner —
    // can raise the floor without a code change, framework#3259); else the
    // built-in default. `resolveSandboxTimeoutMs` returns the built-in fallback
    // untouched when the env var is unset, so default behaviour is unchanged.
    this.opts = {
      hookTimeoutMs: opts.hookTimeoutMs ?? resolveSandboxTimeoutMs('hook', DEFAULT_HOOK_TIMEOUT_MS),
      actionTimeoutMs: opts.actionTimeoutMs ?? resolveSandboxTimeoutMs('action', DEFAULT_ACTION_TIMEOUT_MS),
      wallCeilingMs: opts.wallCeilingMs ?? resolveSandboxTimeoutMs('wallCeiling', DEFAULT_WALL_CEILING_MS),
      memoryMb: opts.memoryMb ?? DEFAULT_MEMORY_MB,
    };
  }

  async evalExpression(
    body: ExpressionBody,
    ctx: ScriptContext,
    opts: ScriptRunOptions,
  ): Promise<ScriptResult> {
    return this.execute({
      isExpression: true,
      source: body.source,
      capabilities: [],
      timeoutMs: this.resolveTimeout(opts, undefined),
      memoryMb: this.opts.memoryMb,
      ctx,
      origin: opts.origin,
    });
  }

  async runScript(
    body: ScriptBody,
    ctx: ScriptContext,
    opts: ScriptRunOptions,
  ): Promise<ScriptResult> {
    return this.execute({
      isExpression: false,
      source: body.source,
      // `ScriptBody` is the AUTHOR state since ADR-0122 and `capabilities` carries
      // `.default([])`, so the runner states that default rather than passing
      // `undefined` into a Set constructor typed for an array.
      capabilities: body.capabilities ?? [],
      timeoutMs: this.resolveTimeout(opts, body.timeoutMs),
      memoryMb: body.memoryMb ?? this.opts.memoryMb,
      ctx,
      origin: opts.origin,
    });
  }

  run(body: HookBody, ctx: ScriptContext, opts: ScriptRunOptions): Promise<ScriptResult> {
    return body.language === 'expression'
      ? this.evalExpression(body, ctx, opts)
      : this.runScript(body, ctx, opts);
  }

  async dispose(): Promise<void> {
    /* no-op — runtimes are per-invocation in v1 */
  }

  /**
   * Resolve the effective per-invocation timeout.
   *
   * The engine default (`hookTimeoutMs` / `actionTimeoutMs`) is a FALLBACK used
   * only when the caller supplies no explicit timeout — it is NOT a hard
   * ceiling. Whichever explicit timeout the caller *did* supply wins: the body's
   * own `timeoutMs` (the spec permits up to 30_000ms — see `ScriptBody.timeoutMs`)
   * and/or an enclosing hook/action timeout passed via `opts.timeoutMs`; when
   * both are present the smaller wins, matching the spec's "smaller of this and
   * the enclosing hook/action timeout wins".
   *
   * Previously the default was folded straight into `Math.min(...)`, so for
   * hooks — whose default is 250ms — it *always* dominated: a body that declared
   * `timeoutMs: 5000` to give a legitimate nested cross-object write room to
   * settle was silently clamped back to 250ms and killed mid-flight. That made
   * the spec's `ScriptBody.timeoutMs` a declared-but-unenforced knob for hooks
   * and pushed template authors toward denormalized rollup workarounds (#1867).
   */
  private resolveTimeout(opts: ScriptRunOptions, bodyTimeoutMs: number | undefined): number {
    const def = opts.origin.kind === 'hook' ? this.opts.hookTimeoutMs : this.opts.actionTimeoutMs;
    const explicit = [opts.timeoutMs, bodyTimeoutMs].filter((n): n is number => typeof n === 'number');
    return explicit.length > 0 ? Math.min(...explicit) : def;
  }

  private async execute(args: {
    isExpression: boolean;
    source: string;
    capabilities: HookBodyCapability[];
    timeoutMs: number;
    memoryMb: number;
    ctx: ScriptContext;
    origin: ScriptOrigin;
  }): Promise<ScriptResult> {
    // Each invocation gets its OWN WebAssembly module (fresh linear memory) via
    // newQuickJSWASMModule() — the sync release variant, no asyncify (ADR-0102
    // D2). Separate modules are physically memory-isolated, so a QuickJS heap bug
    // can't reach another invocation's marshalled data (D4). Asyncify was dropped
    // because nothing suspends the WASM stack anymore: host calls are deferred
    // QuickJS promises drained by the pump loop, never `newAsyncifiedFunction`.
    const mod = await newQuickJSWASMModule();
    const vm = mod.newContext();
    const runtime = vm.runtime;
    runtime.setMemoryLimit(args.memoryMb * 1024 * 1024);
    runtime.setMaxStackSize(512 * 1024);

    // Budget accounting (ADR-0102 D1). `args.timeoutMs` is a CPU-time budget: the
    // sum of VM-active slices (the initial eval + each `executePendingJobs`), NOT
    // wall clock. Idle pump yields, host-promise settle time, and nested-hook
    // execution (which runs host-side while this VM is parked) are excluded — so a
    // slow/loaded host or a deep nested-write chain no longer trips the budget
    // while the script is merely waiting. A separate wall ceiling bounds a body
    // stuck forever on a host call that never settles.
    const cpuBudget = args.timeoutMs;
    const wallCeiling = Math.max(this.opts.wallCeilingMs, cpuBudget);
    const start = Date.now();
    const wallDeadline = start + wallCeiling;
    let cpuMs = 0; // sum of completed VM slices
    // Init to `start`, NOT 0: the interrupt handler reads `now - sliceStart`, and a
    // 0 init makes that the full unix-epoch millis — firing the interrupt during
    // `installCtx` (before the first real slice), which corrupts ctx marshalling
    // (the host-side setup evalCodes get interrupted). Elapsed-since-start is ~0
    // here, so the handler stays quiet until a real slice begins.
    let sliceStart = start;
    // Fires only while VM code runs, so `now - sliceStart` is the in-flight slice;
    // added to finished `cpuMs` it is total CPU. Cuts a runaway synchronous loop
    // the instant the CPU budget (or the wall ceiling) is exceeded.
    runtime.setInterruptHandler(
      () => cpuMs + (Date.now() - sliceStart) > cpuBudget || Date.now() > wallDeadline,
    );
    // Map a settled-VM state to the right budget error, or null if the body is
    // simply still progressing. Callers add the just-run slice to `cpuMs` first,
    // so `cpuMs` here is inclusive.
    const budgetError = (pumps: number): SandboxError | null => {
      if (cpuMs > cpuBudget) {
        return new SandboxError(
          `${args.origin.kind} '${args.origin.name}' exceeded CPU budget of ${cpuBudget}ms (after ${pumps} pump iterations)`,
        );
      }
      if (Date.now() > wallDeadline) {
        return new SandboxError(
          `${args.origin.kind} '${args.origin.name}' exceeded wall-clock ceiling of ${wallCeiling}ms while awaiting host calls (after ${pumps} pump iterations)`,
        );
      }
      return null;
    };

    // Shared, per-invocation transaction state. `ctx.api.transaction(fn)` opens
    // it (routing subsequent ctx.api ops through the tx-scoped context) and
    // closes it on commit/rollback. The execute() finally consults it to roll
    // back a transaction the body left open (threw mid-tx, or timed out before
    // its commit/rollback settled).
    const txState: TxState = { api: null, handle: null, open: false, owned: true };

    // Every host call hands the VM a `vm.newPromise()` deferred; the newPromise
    // contract requires each be `dispose()`d. On the settled path the runner
    // already lets them go, which the old asyncify build tolerated — but the sync
    // variant's `JS_FreeRuntime` aborts (`Assertion failed: list_empty`) if the
    // context is torn down while a deferred is still pending (a timed-out
    // never-settling host call). We track them and dispose any survivors in the
    // finally, before `vm.dispose()`.
    const deferreds = new Set<QuickJSDeferredPromise>();

    try {
      this.installCtx(vm, args.ctx, new Set(args.capabilities), args.origin, txState, deferreds);

      // L1 expressions are pure-sync: evaluate and read __result.
      if (args.isExpression) {
        const wrapped = `globalThis.__result = JSON.stringify((function(){ return (${args.source}); })());`;
        sliceStart = Date.now();
        const result = vm.evalCode(wrapped);
        cpuMs += Date.now() - sliceStart;
        if (result.error) {
          const budget = budgetError(0);
          if (budget) {
            result.error.dispose();
            throw budget;
          }
          const err = vm.dump(result.error);
          result.error.dispose();
          throw new SandboxError(
            `${args.origin.kind} '${args.origin.name}' threw: ${formatErr(err)}`,
            userFacingMessage(formatErr(err)),
          );
        }
        result.value.dispose();
        const resH = vm.getProp(vm.global, '__result');
        const resStr = vm.dump(resH);
        resH.dispose();
        const value = resStr === undefined || resStr === null || resStr === 'null'
          ? undefined
          : safeJsonParse(resStr);
        return { value, durationMs: Date.now() - start };
      }

      // L2 scripts: wrap as async IIFE and use a side-channel + pump loop.
      // Each pump iteration:
      //   1. yield to the host event loop (lets host promises settle)
      //   2. drain QuickJS pending jobs (advances the .then chain)
      //   3. read __result/__error from the VM
      // `__error` stays EXACTLY the flattened `<name>: <message>` string it has
      // always been — it is what the SandboxError message/innerMessage are built
      // from, and every existing consumer reads it. `__errorInfo` is a strictly
      // additive side-channel carrying the structured bits
      // (SANDBOX_ERROR_PASSTHROUGH) that the flattening discards, so a record
      // `ValidationError` keeps its `fields[]` on the way back out to the host.
      const REJECT_HANDLER =
        `function(e){
              globalThis.__error = (e && e.message) ? (e.name + ': ' + e.message) : String(e);
              try {
                globalThis.__errorInfo = (e && (e.code || e.fields || e.status || e.userMessage || e['${SANDBOX_FAULT_PROP}']))
                  ? JSON.stringify({ code: e.code, fields: e.fields, status: e.status, userMessage: e.userMessage, sandboxFault: e['${SANDBOX_FAULT_PROP}'] === true })
                  : undefined;
              } catch (_) { globalThis.__errorInfo = undefined; }
            }`;
      const wrapped = args.origin.kind === 'hook'
        ? `globalThis.__result = undefined; globalThis.__error = undefined; globalThis.__errorInfo = undefined;
            (async (ctx) => { ${args.source} })(globalThis.__ctx).then(
              function(v){ globalThis.__result = JSON.stringify(v === undefined ? null : v); },
              ${REJECT_HANDLER}
            );`
        : `globalThis.__result = undefined; globalThis.__error = undefined; globalThis.__errorInfo = undefined;
            (async (input, ctx) => { ${args.source} })(globalThis.__input, globalThis.__ctx).then(
              function(v){ globalThis.__result = JSON.stringify(v === undefined ? null : v); },
              ${REJECT_HANDLER}
            );`;

      sliceStart = Date.now();
      const evalRes = vm.evalCode(wrapped);
      cpuMs += Date.now() - sliceStart;
      if (evalRes.error) {
        const budget = budgetError(0);
        if (budget) {
          evalRes.error.dispose();
          throw budget;
        }
        const err = vm.dump(evalRes.error);
        evalRes.error.dispose();
        throw new SandboxError(
          `${args.origin.kind} '${args.origin.name}' threw: ${formatErr(err)}`,
          userFacingMessage(formatErr(err)),
        );
      }
      evalRes.value.dispose();

      // Drive the script's async continuations to completion. Each iteration
      // yields to the host event loop (so in-flight host promises settle and
      // resolve their VM-side deferred handles) and then drains the QuickJS job
      // queue. Two bounds apply (ADR-0102 D1): the CPU budget (VM-active time,
      // via `budgetError` below) and the wall ceiling. A slow but progressing
      // script — many sequential host writes, or one write that synchronously
      // drives a downstream record-change automation — burns little CPU per pump
      // and must be allowed to finish; a stuck / never-settling host call (the
      // interrupt handler can't fire while we are parked on a host promise) is
      // cut off by the wall ceiling, which this loop's `budgetError` checks.
      // The previous fixed `pumps < 1000` cap fired in ~tens of ms on legitimate
      // work and surfaced as "did not resolve after 1000 pump iterations".
      // Adaptive idle backoff (#3233): while the script is progressing we pump
      // on setImmediate (near-zero latency); once it is only *waiting* on an
      // in-flight host promise — 0 VM jobs executed per pump — we ramp the yield
      // up to a small capped setTimeout instead of spinning setImmediate
      // ~200k×/s doing nothing. Any executed job (a settled host call, a resumed
      // continuation) resets the fast path, so sequential host calls and
      // multi-turn work keep their low latency; only a genuinely idle wait backs
      // off, and by at most IDLE_BACKOFF_CAP_MS.
      const FAST_PUMPS = 4;
      const IDLE_BACKOFF_CAP_MS = 8;
      let pumps = 0;
      let idle = 0;
      for (;;) {
        // Yield to the host event loop so in-flight host promises can settle.
        if (idle < FAST_PUMPS) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        } else {
          const backoffMs = Math.min(IDLE_BACKOFF_CAP_MS, 1 << Math.min(idle - FAST_PUMPS, 3));
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        }

        sliceStart = Date.now();
        const pending = runtime.executePendingJobs();
        cpuMs += Date.now() - sliceStart;
        if (pending.error) {
          // An interrupt (CPU budget / wall ceiling hit mid-slice) surfaces here
          // as an error too — map it to the clean budget message rather than
          // dumping `InternalError: interrupted`.
          const budget = budgetError(pumps);
          if (budget) {
            pending.error.dispose();
            throw budget;
          }
          const err = vm.dump(pending.error);
          pending.error.dispose();
          throw new SandboxError(
            `${args.origin.kind} '${args.origin.name}' threw: ${formatErr(err)}`,
            userFacingMessage(formatErr(err)),
          );
        }

        const errH = vm.getProp(vm.global, '__error');
        const errStr = vm.dump(errH);
        errH.dispose();
        if (errStr) {
          // An interrupt (CPU budget / wall ceiling) raised inside the async body
          // rejects its promise, surfacing here as __error rather than
          // pending.error — map it to the budget message instead of the raw
          // "InternalError: interrupted".
          const budget = budgetError(pumps);
          if (budget) throw budget;
          const info = readErrorInfo(vm);
          // [#4431] A SANDBOX fault that crossed `__error` — a capability
          // denial thrown synchronously inside a host function, an unavailable
          // `ctx.api`, a marshalling failure. It is not an outcome the body
          // chose to report, so it gets neither the `<kind> '<name>' threw:`
          // wrapper (nothing threw — the sandbox refused) nor an
          // `innerMessage` (there is no business message; `SandboxError`'s own
          // contract says so). Leaving `innerMessage` unset is what makes the
          // #3951 contract hold: the dispatcher's classifier reads its absence
          // as a CRASH and answers 500 through `errorFromThrown`, instead of
          // the 400 a denial used to get — and the client sees the capability
          // text without the `SandboxError: ` debug prefix.
          if (info?.sandboxFault) {
            throw new SandboxError(sandboxFaultMessage(String(errStr)));
          }
          throw new SandboxError(
            `${args.origin.kind} '${args.origin.name}' threw: ${errStr}`,
            userFacingMessage(String(errStr)),
            info,
          );
        }

        const resH = vm.getProp(vm.global, '__result');
        const resStr = vm.dump(resH);
        resH.dispose();
        if (resStr !== undefined && resStr !== null) {
          const value = resStr === 'null' ? undefined : safeJsonParse(resStr);
          // Capture mutated ctx.input so the host can write through.
          const mutatedInput = readCtxInputJson(vm);
          // …and the ctx.record writes the host will NOT write through, so it
          // can say so instead of dropping them silently (#4345).
          const droppedRecordWrites =
            args.ctx.record !== undefined ? readRecordWritesJson(vm) : undefined;
          return { value, mutatedInput, droppedRecordWrites, durationMs: Date.now() - start };
        }

        const budget = budgetError(pumps);
        if (budget) throw budget;
        // Progress this pump → reset to the fast path; genuinely idle → ramp the
        // counter so the next yield backs off.
        idle = pending.value > 0 ? 0 : idle + 1;
        pumps++;
      }
    } finally {
      // If the body left a transaction open — it threw between begin and
      // commit/rollback, or the deadline cut the pump loop off while a tx was
      // live — roll it back before tearing down the VM, so the driver
      // connection isn't leaked with a half-applied transaction. Best-effort:
      // the script result (success or the original error) is already decided;
      // a rollback failure here must not mask it.
      //
      // Only for a transaction this runner OPENED (#6406). A JOINED one belongs
      // to the host `engine.transaction()` that is still in flight above us:
      // rolling it back from a VM teardown would discard writes the outer caller
      // has not finished with. There is nothing to leak either — the connection
      // is the outer one, and the error that cut this body off propagates to the
      // outer owner, which decides commit vs rollback for the whole unit.
      if (txState.open && txState.owned && txState.handle != null) {
        const apiTx = args.ctx.api as Record<string, unknown> | undefined;
        const rollback = apiTx?.rollbackTransaction;
        if (typeof rollback === 'function') {
          try {
            await (rollback as (h: unknown) => Promise<void>).call(apiTx, txState.handle);
          } catch {
            /* best-effort cleanup — swallow so the real outcome surfaces */
          }
        }
      }
      // Free every host-side deferred (settled or not) — the `newPromise`
      // contract, and mandatory before context teardown on the sync variant: a
      // pending deferred left alive makes `JS_FreeRuntime` abort. Best-effort so
      // one bad handle can't mask the real outcome.
      for (const d of deferreds) {
        if (d.alive) {
          try {
            d.dispose();
          } catch {
            /* already gone / VM aborted — ignore */
          }
        }
      }
      deferreds.clear();
      // Dispose the context — this frees its runtime + all QuickJS allocations
      // (QuickJSWASMModule.newContext: "the runtime will be disposed when the
      // context is disposed"). The sync `QuickJSWASMModule` has no dispose();
      // dropping `mod` at function scope lets GC reclaim its WebAssembly instance
      // + linear memory, preserving per-invocation isolation (ADR-0102 D2).
      vm.dispose();
    }
  }

  /**
   * Install ctx onto the VM's globalThis. Each capability is wired in only if
   * the body declared it; missing methods throw at call-time inside the VM
   * with a clear diagnostic.
   *
   * Host API methods are installed as deferred-promise functions (see
   * {@link installApiMethod}) so they may return Promises (real ObjectQL
   * `find/count/insert/...` are async) without asyncify's single-unwind limit.
   */
  private installCtx(
    vm: QuickJSContext,
    ctx: ScriptContext,
    caps: Set<HookBodyCapability>,
    origin: ScriptOrigin,
    txState: TxState,
    deferreds: Set<QuickJSDeferredPromise>,
  ): void {
    setGlobalJson(vm, '__input', ctx.input);
    setGlobalJson(vm, '__previous', ctx.previous);

    const ctxObj = vm.newObject();
    setObjectJson(vm, ctxObj, 'input', ctx.input);
    setObjectJson(vm, ctxObj, 'previous', ctx.previous);
    setObjectJson(vm, ctxObj, 'user', ctx.user);
    setObjectJson(vm, ctxObj, 'session', ctx.session);
    if (typeof ctx.event === 'string') {
      const evH = vm.newString(ctx.event);
      vm.setProp(ctxObj, 'event', evH);
      evH.dispose();
    }
    if (typeof ctx.object === 'string') {
      const obH = vm.newString(ctx.object);
      vm.setProp(ctxObj, 'object', obH);
      obH.dispose();
    }
    if (typeof ctx.recordId === 'string') {
      const idH = vm.newString(ctx.recordId);
      vm.setProp(ctxObj, 'recordId', idH);
      idH.dispose();
    }
    if (ctx.record !== undefined) {
      setObjectJson(vm, ctxObj, 'record', ctx.record);
    }
    if (ctx.result !== undefined) {
      setObjectJson(vm, ctxObj, 'result', ctx.result);
    }

    const apiObj = vm.newObject();
    const objectFn = vm.newFunction('object', (nameH) => {
      const objectName = vm.getString(nameH);
      const wrap = vm.newObject();
      const READ = ['find', 'findOne', 'count', 'aggregate'] as const;
      const WRITE = ['insert', 'update', 'delete', 'updateMany', 'deleteMany', 'upsert'] as const;
      for (const m of READ) installApiMethod(vm, wrap, m, objectName, ctx, caps, 'api.read', origin, txState, deferreds);
      for (const m of WRITE) installApiMethod(vm, wrap, m, objectName, ctx, caps, 'api.write', origin, txState, deferreds);
      return wrap;
    });
    vm.setProp(apiObj, 'object', objectFn);
    objectFn.dispose();

    // Transaction control. The VM-facing surface is a single `ctx.api.transaction(fn)`
    // (defined as JS sugar below); under the hood it drives three host leaves so
    // begin / commit / rollback each settle through the same deferred-promise +
    // pump mechanism every other host call uses (asyncify can't unwind twice).
    //
    // The handle is threaded EXPLICITLY through `txState` rather than via the
    // engine's ambient AsyncLocalStorage: the body runs across many host
    // event-loop turns with no single closure spanning begin→commit, so there
    // is nothing to hand `txStore.run` and a transaction opened here can never
    // be published into that store. While a tx is open, `installApiMethod`
    // resolves its repository from `txState.api` (the tx-scoped ScopedContext)
    // so every op reuses the one connection.
    //
    // Reading the store is a different matter, and is what `beginTransaction`
    // does on the engine side to JOIN a host transaction already in flight
    // (ADR-0067 D2, #6406) — a hook body that runs inside `engine.transaction()`
    // must not open a second driver transaction. `txState.owned` carries that
    // verdict back to the three close paths below.
    const apiTx = ctx.api as Record<string, unknown> | undefined;
    const installTxLeaf = (name: string, run: () => Promise<void>): void => {
      const fn = vm.newFunction(name, () => {
        if (!caps.has('api.transaction')) {
          throwSandboxFault(
            vm,
            `capability 'api.transaction' not granted to ${origin.kind} '${origin.name}' (called ctx.api.transaction)`,
          );
        }
        const deferred = vm.newPromise();
        deferreds.add(deferred);
        void (async () => {
          try {
            await run();
            if (!vm.alive) return;
            deferred.resolve(vm.undefined);
          } catch (err) {
            if (!vm.alive) return;
            const errH = hostErrorToVm(vm, err);
            deferred.reject(errH);
            errH.dispose();
          }
        })();
        return deferred.handle;
      });
      vm.setProp(apiObj, name, fn);
      fn.dispose();
    };

    installTxLeaf('__txBegin', async () => {
      if (txState.open) throw new SandboxError('nested ctx.api.transaction is not supported');
      const begin = apiTx?.beginTransaction;
      txState.owned = true;
      if (typeof begin === 'function') {
        const r = (await (begin as () => Promise<{ ctx: unknown; handle: unknown; owned?: boolean } | null>).call(apiTx)) ?? null;
        if (r) {
          txState.api = r.ctx as Record<string, unknown>;
          txState.handle = r.handle;
          // ADR-0067 D2 (#6406): `begin` JOINS a host transaction that is
          // already open rather than nesting a second driver one, and says so.
          // Absent (a foreign `ctx.api` that predates the signal) reads as
          // owned — the same answer this file gave before the bit existed.
          txState.owned = r.owned !== false;
        }
      }
      // else (or null result): driver without tx support → degrade to
      // non-transactional execution, same as ScopedContext.transaction().
      txState.open = true;
    });

    installTxLeaf('__txCommit', async () => {
      const { handle, open, owned } = txState;
      txState.api = null;
      txState.handle = null;
      txState.open = false;
      txState.owned = true;
      const commit = apiTx?.commitTransaction;
      // A JOINED transaction is committed by whoever opened it, not here
      // (#6406): committing early would land the body's writes outside the
      // outer caller's control and let them survive its rollback.
      if (open && owned && handle != null && typeof commit === 'function') {
        await (commit as (h: unknown) => Promise<void>).call(apiTx, handle);
      }
    });

    installTxLeaf('__txRollback', async () => {
      const { handle, open, owned } = txState;
      txState.api = null;
      txState.handle = null;
      txState.open = false;
      txState.owned = true;
      const rollback = apiTx?.rollbackTransaction;
      // Joined: abstain here too, exactly as the callback faces do (#6406).
      // This leaf is reached from the `ctx.api.transaction` sugar's catch
      // branch, which RE-THROWS afterwards, so the body's failure travels out
      // to the host and the outer owner rolls the whole unit of work back.
      if (open && owned && handle != null && typeof rollback === 'function') {
        await (rollback as (h: unknown) => Promise<void>).call(apiTx, handle);
      }
    });

    vm.setProp(ctxObj, 'api', apiObj);
    apiObj.dispose();

    const logObj = vm.newObject();
    // [#7661] FOUR levels, not three. `debug` was granted by the CLI's
    // capability extractor (`ctx\.log\.(?:info|warn|error|debug)` → `log`) and
    // taught by the docs table while this loop installed only the first three,
    // so a body that followed the documentation threw `TypeError: not a
    // function` here — and under `onError: 'abort'` that aborted the write.
    // Enforced rather than retired from the other two surfaces (ADR-0049): the
    // `crypto.hash` precedent this shape echoes (#4391) was removed because
    // implementing it widened the sandbox's SECURITY surface, and emitting a
    // debug-level diagnostic carries no such argument — `--log-level debug` is
    // exactly what such a body is for. `Logger.debug(message, meta)` is on the
    // contract (`packages/spec/src/contracts/logger.ts`), so nothing new is
    // required of the host logger either.
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      const fn = vm.newFunction(level, (msgH, dataH) => {
        if (!caps.has('log')) {
          throwSandboxFault(vm, `capability 'log' not granted to ${origin.kind} '${origin.name}'`);
        }
        const msg = vm.getString(msgH);
        // [#7448] `vm.dump`, NOT `vm.getString` — the marshalling every other
        // host-call bridge in this file already uses (`ctx.api`'s
        // `argHandles.map((h) => vm.dump(h))`, and the return-value paths).
        // `getString` on a non-string handle applies JS string coercion INSIDE
        // the VM, so the `data` object a body passes arrives as the literal
        // `"[object Object]"` — which `safeJsonParse` then fails to parse and
        // returns verbatim, so every structured field of every body log call
        // was lost. That is the payload half of the same declared-capability
        // gap #7448 recorded, surfaced by its reproduction; `dump`
        // deserialises the handle into a real value.
        const data = dataH ? vm.dump(dataH) : undefined;
        ctx.log?.[level]?.(msg, data);
        return vm.undefined;
      });
      vm.setProp(logObj, level, fn);
      fn.dispose();
    }
    vm.setProp(ctxObj, 'log', logObj);
    logObj.dispose();

    const cryptoObj = vm.newObject();
    const uuidFn = vm.newFunction('randomUUID', () => {
      if (!caps.has('crypto.uuid')) {
        throwSandboxFault(vm, `capability 'crypto.uuid' not granted to ${origin.kind} '${origin.name}'`);
      }
      const v = ctx.crypto?.randomUUID?.() ?? cryptoRandomUUID();
      return vm.newString(v);
    });
    vm.setProp(cryptoObj, 'randomUUID', uuidFn);
    uuidFn.dispose();
    vm.setProp(ctxObj, 'crypto', cryptoObj);
    cryptoObj.dispose();

    vm.setProp(vm.global, '__ctx', ctxObj);
    ctxObj.dispose();

    // VM-side sugar: `ctx.api.transaction(async () => { … })`. Begin runs
    // OUTSIDE the try so a begin failure (e.g. missing capability) propagates
    // without attempting a rollback there is no transaction for. The body's
    // return value is forwarded; any throw triggers rollback then re-throws,
    // so the caller observes the original error.
    const sugar = vm.evalCode(
      `__ctx.api.transaction = async function (fn) {
         await __ctx.api.__txBegin();
         try {
           var r = await fn();
           await __ctx.api.__txCommit();
           return r;
         } catch (e) {
           await __ctx.api.__txRollback();
           throw e;
         }
       };`,
    );
    if (sugar.error) {
      const msg = vm.dump(sugar.error);
      sugar.error.dispose();
      throw new SandboxError(`failed to install ctx.api.transaction: ${formatErr(msg)}`);
    }
    sugar.value.dispose();

    // `ctx.record` is a READ-ONLY snapshot: the action path returns the script's
    // value and never writes the record back, so `ctx.record.x = …` is discarded
    // — for a declared field exactly as much as for an unknown one (#4345). The
    // write still WORKS inside the VM (the trap forwards it, so a body using the
    // snapshot as scratch keeps its reads coherent); what changes is that it is
    // no longer SILENT. Recording it here rather than diffing a post-run dump is
    // what makes the signal exact: the trap fires for computed keys,
    // `Object.assign`, and aliases (`const r = ctx.record; r.x = 1`) — the cases
    // both a dump-diff and the author-time lint miss — and costs nothing on the
    // hook path, which carries no `record` and so installs no proxy.
    if (ctx.record === undefined) return;
    const recordGuard = vm.evalCode(
      `globalThis.__recordWrites = []; globalThis.__recordEscaped = false;
       (function () {
         var snapshot = __ctx.record;
         if (!snapshot || typeof snapshot !== 'object') return;
         var note = function (k) {
           // Symbol keys are never record fields; forward them unrecorded.
           if (typeof k === 'symbol') return;
           if (globalThis.__recordWrites.indexOf(k) < 0) globalThis.__recordWrites.push(k);
         };
         var wrap = function (target) {
           return new Proxy(target, {
             set: function (t, k, v) { note(k); t[k] = v; return true; },
             deleteProperty: function (t, k) { note(k); delete t[k]; return true; },
             defineProperty: function (t, k, d) { note(k); Object.defineProperty(t, k, d); return true; },
             // Escape detection. A write is only DEAD if the snapshot never
             // leaves the body as a value — this is live, and reporting it
             // would be a false statement, not just noise:
             //   ctx.record.stage = 'won';
             //   await ctx.api.object('d').update(ctx.record);   // it lands
             // Consuming the object whole (marshalling it to a host call,
             // JSON.stringify, spread, Object.keys, returning it) enumerates
             // its keys; a plain property READ does not. So an ownKeys AFTER a
             // write means the written value may have gone somewhere, and the
             // recorder goes quiet. Same direction the author-time rule takes:
             // treat ambiguity as live, because a wrong "discarded" is worse
             // than a missed one.
             ownKeys: function (t) {
               if (globalThis.__recordWrites.length > 0) globalThis.__recordEscaped = true;
               return Reflect.ownKeys(t);
             },
           });
         };
         var current = wrap(snapshot);
         // An accessor, not a plain assignment, so that replacing the snapshot
         // WHOLESALE (\`ctx.record = { stage: 'won' }\`) is caught too. A bare
         // proxy would be swapped out by that write and every later field write
         // would go unrecorded — the one shape where the recorder could have
         // gone quiet exactly when the author was most sure they had persisted.
         Object.defineProperty(__ctx, 'record', {
           configurable: true,
           enumerable: true,
           get: function () { return current; },
           set: function (v) {
             if (v && typeof v === 'object') {
               // Report the replacement's own keys: that is what the author
               // believed they were writing.
               Object.keys(v).forEach(note);
               current = wrap(v);
             } else {
               note('(whole record replaced)');
               current = v;
             }
           },
         });
       })();`,
    );
    if (recordGuard.error) {
      const msg = vm.dump(recordGuard.error);
      recordGuard.error.dispose();
      // Fatal, like the sugar above: the snippet interpolates no caller data, so
      // a failure here means the VM is broken, not that some record shape defeated
      // it. Falling back would silently restore the very blind spot this closes.
      throw new SandboxError(`failed to install the ctx.record write recorder: ${formatErr(msg)}`);
    }
    recordGuard.value.dispose();
  }
}

/**
 * Per-invocation transaction state shared between {@link QuickJSScriptRunner.execute}
 * (which rolls back a tx the body left open) and the `ctx.api.transaction`
 * host leaves (which open/close it). `api` is the tx-scoped ScopedContext that
 * `installApiMethod` routes repository ops through while a tx is live; `handle`
 * is the driver transaction handle; `open` guards against nesting and tells the
 * finally block whether cleanup is owed.
 */
interface TxState {
  api: Record<string, unknown> | null;
  handle: unknown;
  open: boolean;
  /**
   * Did `__txBegin` OPEN this transaction, or JOIN one the host already had
   * open (ADR-0067 D2, #6406)? `false` means the outer caller owns the one and
   * only commit/rollback, so every close path here abstains — the commit leaf,
   * the rollback leaf, and the teardown cleanup in `execute`'s finally.
   *
   * `ScopedContext` abstains for a joined handle on its own side too, so a
   * caller that ignored this bit still could not close someone else's
   * transaction. Honouring it here is what makes THIS file's intent readable:
   * the runner closes what the runner opened.
   */
  owned: boolean;
}

/**
 * Host-bound API method, exposed to the VM as an async function.
 *
 * IMPORTANT: host calls settle through a real QuickJS promise (a deferred), NOT
 * an asyncified call. Asyncify unwound the WASM stack while a host call was in
 * flight and forbade one asyncified call running while another was unwound ("the
 * stack cannot be unwound twice"): a script awaiting two host calls in sequence —
 * e.g. the real `lead_apply_convert` action doing `findOne()` then `update()` —
 * tripped exactly that, corrupting the wasm heap (`memory access out of bounds` /
 * `p->ref_count == 0`) and blowing the pump budget. Shedding that dependency is
 * precisely what let the runner drop the asyncify build entirely and move to the
 * sync variant (ADR-0102 D2).
 *
 * We hand the VM a deferred promise and settle it from the host event loop.
 * Sequential `await`s are ordinary promises with no stack unwinding, so any
 * number of host calls compose safely; the pump loop in
 * {@link QuickJSScriptRunner.execute} drains the resulting jobs.
 *
 * The capability check runs synchronously at call time and surfaces inside the
 * VM as a thrown error with a clear diagnostic.
 */
function installApiMethod(
  vm: QuickJSContext,
  parent: QuickJSHandle,
  method: string,
  objectName: string,
  ctx: ScriptContext,
  caps: Set<HookBodyCapability>,
  required: HookBodyCapability,
  origin: ScriptOrigin,
  txState: TxState,
  deferreds: Set<QuickJSDeferredPromise>,
): void {
  const fn = vm.newFunction(method, (...argHandles) => {
    // Capability gate — throw synchronously so the VM sees a normal exception at
    // the call site (mirrors ctx.log / ctx.crypto gating).
    if (!caps.has(required)) {
      throwSandboxFault(
        vm,
        `capability '${required}' not granted to ${origin.kind} '${origin.name}' (called ctx.api.object('${objectName}').${method})`,
      );
    }
    const apiAny = ctx.api as Record<string, unknown> | undefined;
    if (!apiAny || typeof apiAny.object !== 'function') {
      throwSandboxFault(vm, `ctx.api unavailable in ${origin.kind} '${origin.name}'`);
    }
    // Dump args now, while the handles are alive — they are freed when this
    // function returns, long before the async work below runs.
    const args = argHandles.map((h) => vm.dump(h));

    const deferred = vm.newPromise();
    deferreds.add(deferred);
    void (async () => {
      try {
        // While a transaction is open, resolve the repository from the
        // tx-scoped context so this op reuses the transaction's connection;
        // otherwise use the base ctx.api. Read `txState` HERE (at call time,
        // inside the async body) — the tx may have opened after this method
        // was installed.
        const source = (txState.api ?? apiAny) as Record<string, unknown>;
        const proxy = (source.object as (n: string) => Record<string, unknown>)(objectName);
        const m = proxy[method] as ((...a: unknown[]) => unknown) | undefined;
        if (typeof m !== 'function') {
          throw new SandboxError(`ctx.api.object('${objectName}').${method} not implemented`);
        }
        const ret = await Promise.resolve(m.apply(proxy, args));
        if (!vm.alive) return; // VM disposed (e.g. timed out) before we settled.
        const h = jsonToHandle(vm, ret);
        deferred.resolve(h);
        h.dispose();
      } catch (err) {
        if (!vm.alive) return;
        // The load-bearing one: this is the `ctx.api.object(x).<op>()` rejection,
        // i.e. where a record `ValidationError` enters the VM.
        const errH = hostErrorToVm(vm, err);
        deferred.reject(errH);
        errH.dispose();
      }
    })();
    // The pump loop is the sole driver of executePendingJobs, so the resolution
    // propagates into the VM on a subsequent pump iteration — no nudge here, to
    // avoid any re-entrant executePendingJobs.
    return deferred.handle;
  });
  vm.setProp(parent, method, fn);
  fn.dispose();
}

/**
 * Serialise a host value for marshalling into the VM, tolerating shapes that
 * plain `JSON.stringify` chokes on. Only JSON-safe leaves cross the sandbox
 * boundary anyway, so anything unserialisable is dropped rather than fatal:
 *
 * - **Circular references** — a live `setTimeout`/`setInterval` handle (or any
 *   node host object) reachable from `ctx` links back on itself
 *   (`Timeout._idlePrev -> TimersList._idleNext -> …`). Naive `JSON.stringify`
 *   throws `TypeError: Converting circular structure to JSON` and takes the
 *   whole hook down (issue #2674). A `WeakSet` of ancestors on the current path
 *   drops the back-edge instead.
 * - **BigInt** — `JSON.stringify` throws outright; we coerce to a string.
 *
 * The replacer is deliberately conservative: it strips only what would crash
 * the serialiser, leaving legitimate data intact.
 */
function safeJsonStringify(v: unknown): string {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(v ?? null, function (this: unknown, _key, value) {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined; // drop circular back-edge
      seen.add(value);
    }
    return value;
  });
  // `JSON.stringify` returns `undefined` when the top-level value is itself
  // unserialisable (e.g. a bare function); normalise to a JSON literal so the
  // downstream `vm.evalCode` never receives `(undefined)`.
  return json ?? 'null';
}

/**
 * Structured properties a HOST error may carry ACROSS the sandbox boundary,
 * in addition to `name`/`message`.
 *
 * This is an explicit ALLOWLIST, and that is a security decision rather than a
 * style one: everything placed on the handle below becomes readable by
 * untrusted sandboxed code, and host errors routinely hang driver state,
 * connection details, or whole record payloads off themselves. Copying the
 * error's own enumerable keys would leak all of it. Only these three are safe
 * and useful — they are already destined for the HTTP client.
 *
 * Why they need to cross at all: a record `ValidationError` reaching a body via
 * `ctx.api.object(x).update(...)` used to arrive as bare `name`/`message`, so
 * its `fields[]` was gone before any dispatcher exit could map it (#3918
 * follow-up) — a form action could only ever show prose, never highlight the
 * offending input.
 *
 * [#7867] `status` joined for the same reason one card later, on the same call
 * shape. `ctx.api.object(x).update({ id, … })` against an id that names no row
 * now throws the repo's one `RECORD_NOT_FOUND` — `code` 'RECORD_NOT_FOUND',
 * `status` 404 — and `code` alone crossed, so the action surface answered
 * `{ code: 'RECORD_NOT_FOUND', httpStatus: 400 }`: the right diagnosis served
 * with the wrong status, which is the half-fix a client cannot act on (404 and
 * 400 mean different things to a retry policy and to a cache).
 *
 * `domains/actions.ts`'s classifier already honours a `.status` FIRST — "an
 * error that NAMES its own HTTP status is asking to be served with it" — so
 * nothing downstream needed teaching; the number simply never arrived. A
 * number, like `code`, carries no host state.
 *
 * [#9934] `userMessage` is the fourth member — the producer-side user-facing
 * marking (see `declaredUserMessage` in `@objectstack/types`). A hook or
 * action BODY is the authoring surface the marking exists for: an app author
 * writes `const e = new Error(msg); e.userMessage = msg; throw e`, and the
 * text must survive the VM flattening the throw to a string, or the marking
 * dies exactly where its primary producers live. Crossing INTO the VM is safe
 * for the same reason `code` is: the value is author-written user-facing text
 * by construction (platform and driver code never sets the field), so it
 * carries no host state a sandboxed body could exfiltrate — and it keeps the
 * established property that a body which catches, inspects and re-throws a
 * host error does not lose the structured payload.
 */
const SANDBOX_ERROR_PASSTHROUGH = ['code', 'fields', 'status', 'userMessage'] as const;

/**
 * Marshal a HOST error into the VM as a rejectable QuickJS error handle,
 * carrying {@link SANDBOX_ERROR_PASSTHROUGH} when present.
 *
 * The caller owns the returned handle and must dispose it.
 */
function hostErrorToVm(vm: QuickJSContext, err: unknown): QuickJSHandle {
  const e = err as { name?: string; message?: string; code?: unknown; fields?: unknown; status?: unknown; userMessage?: unknown };
  const errH = err instanceof Error
    ? vm.newError({ name: e.name || 'Error', message: e.message ?? '' })
    : vm.newError({ name: 'Error', message: String(err) });
  // Best-effort: a malformed `fields` must never turn an ordinary rejection
  // into a marshalling failure, which would replace the body's real error.
  try {
    if (typeof e?.code === 'string' && e.code) {
      const h = vm.newString(e.code);
      vm.setProp(errH, 'code', h);
      h.dispose();
    }
    if (Array.isArray(e?.fields)) {
      const h = jsonToHandle(vm, e.fields);
      vm.setProp(errH, 'fields', h);
      h.dispose();
    }
    // [#7867] Finite numbers only — a status is a small integer or it is not a
    // status, and `NaN`/`Infinity` would not survive the JSON side-channel that
    // carries it back out.
    if (typeof e?.status === 'number' && Number.isFinite(e.status)) {
      const h = vm.newNumber(e.status);
      vm.setProp(errH, 'status', h);
      h.dispose();
    }
    // [#9934] Non-empty strings only, same one-read rule as every other
    // boundary (`declaredUserMessage`): a blank or non-string value is not a
    // declaration and must not become one by crossing the VM.
    if (typeof e?.userMessage === 'string' && e.userMessage.trim().length > 0) {
      const h = vm.newString(e.userMessage);
      vm.setProp(errH, 'userMessage', h);
      h.dispose();
    }
    // [#4431] Mark the sandbox's OWN faults so the pump loop can tell them
    // apart from a user throw after the VM has flattened both to a string.
    if (err instanceof SandboxError) {
      const h = vm.true;
      vm.setProp(errH, SANDBOX_FAULT_PROP, h);
    }
  } catch {
    /* keep the bare name/message error */
  }
  return errH;
}

/**
 * [#4431] The marker a sandbox-internal fault carries THROUGH the VM.
 *
 * ## The problem it solves
 *
 * A capability gate throws `SandboxError` **synchronously inside a QuickJS host
 * function**. That rejects the async IIFE *inside* the VM, so it comes back
 * through the `__error` side-channel — and the pump loop presumed that anything
 * arriving there was user code throwing deliberately:
 *
 * ```ts
 * throw new SandboxError(
 *   `${kind} '${name}' threw: ${errStr}`,
 *   userFacingMessage(String(errStr)),   // ← innerMessage SET
 * );
 * ```
 *
 * `SandboxError`'s own contract says the opposite — `innerMessage` is
 * "undefined for the sandbox's own internal errors (capability denials,
 * timeouts, marshalling failures), which have no user-meaningful inner
 * message" — and the #3951 crash contract pins the consequence: *"`SandboxError`
 * with no `innerMessage` — timeout, **capability denial** → crash → 500"*.
 * With `innerMessage` set, `domains/actions.ts`'s classifier read the denial as
 * a deliberate rejection and answered **400**, leaving every capability denial
 * invisible to gateway error rates, APM and alerting. The client also received
 * the `SandboxError: ` debug prefix, which only ever belonged in server logs.
 *
 * The jsdoc's claim only held for denials detected OUTSIDE evaluation (a
 * timeout, which takes the separate `budgetError` path). In-VM host-call
 * denials — `ctx.api.*`, `ctx.log`, `ctx.crypto`, `ctx.api.transaction` — were
 * misclassified.
 *
 * ## Why a marker and not the name
 *
 * `__error` is a FLATTENED `<name>: <message>` string by design (every existing
 * consumer reads it that way), and quickjs-emscripten's host-throw conversion
 * copies only `name` and `message` onto the VM error — which is exactly why the
 * denial's identity was lost. Matching on the `SandboxError:` text would be
 * matching on a string user code can produce. The marker is a real property set
 * on the VM error object and read back through the additive `__errorInfo`
 * channel, so the classification survives the flattening it is meant to outlive.
 */
const SANDBOX_FAULT_PROP = '__objectstackSandboxFault';

/**
 * [#4431] Throw a sandbox-internal fault OUT OF a host function so it reaches
 * the VM carrying {@link SANDBOX_FAULT_PROP}.
 *
 * quickjs-emscripten's `errorToHandle` passes a thrown HANDLE through as the VM
 * exception verbatim (`error instanceof Lifetime ? error : this.newError(error)`),
 * and it is `newError` — the non-handle path — that drops everything but
 * `name`/`message`. Building the handle here is therefore what preserves the
 * marker. The handle is consumed by `QTS_Throw`, so it must NOT be disposed
 * here.
 *
 * The host-side `SandboxError` is still constructed: it is what carries the
 * message, and it keeps this helper's call sites reading like the plain
 * `throw new SandboxError(...)` they replaced.
 */
function throwSandboxFault(vm: QuickJSContext, message: string): never {
  throw hostErrorToVm(vm, new SandboxError(message));
}

/**
 * Strip the `SandboxError: ` name prefix the VM's flattening prepends.
 *
 * The runner's own doc says only the business message should reach a client;
 * for a sandbox fault there is no business message at all, so what reaches the
 * client is this text — the capability, the origin and the call that tripped
 * the gate — with the debug prefix removed.
 */
function sandboxFaultMessage(raw: string): string {
  return raw.startsWith('SandboxError: ') ? raw.slice('SandboxError: '.length) : raw;
}

/** Marshal a host JSON-serializable value into a QuickJS handle. */
function jsonToHandle(vm: QuickJSContext, v: unknown): QuickJSHandle {
  const json = safeJsonStringify(v);
  const r = vm.evalCode(`(${json})`);
  if (r.error) {
    const msg = vm.dump(r.error);
    r.error.dispose();
    throw new SandboxError(`failed to marshal host value: ${formatErr(msg)}`);
  }
  return r.value;
}

function setGlobalJson(vm: QuickJSContext, name: string, v: unknown): void {
  const json = safeJsonStringify(v);
  const result = vm.evalCode(`(${json})`);
  if (result.error) {
    result.error.dispose();
    return;
  }
  vm.setProp(vm.global, name, result.value);
  result.value.dispose();
}

function setObjectJson(vm: QuickJSContext, parent: QuickJSHandle, key: string, v: unknown): void {
  const json = safeJsonStringify(v);
  const result = vm.evalCode(`(${json})`);
  if (result.error) {
    result.error.dispose();
    vm.setProp(parent, key, vm.null);
    return;
  }
  vm.setProp(parent, key, result.value);
  result.value.dispose();
}

/**
 * After the script has settled, dump `globalThis.__ctx.input` so the host can
 * write through any direct property mutations the script performed (e.g.
 * `ctx.input.account_number = 'ABC'`).
 *
 * Returns `undefined` if the read fails for any reason — callers fall back to
 * the script's return value in that case.
 */
function readCtxInputJson(vm: QuickJSContext): Record<string, unknown> | undefined {
  try {
    const r = vm.evalCode(`JSON.stringify(globalThis.__ctx && globalThis.__ctx.input || null)`);
    if (r.error) {
      r.error.dispose();
      return undefined;
    }
    const s = vm.dump(r.value);
    r.value.dispose();
    if (typeof s !== 'string' || s === 'null') return undefined;
    const parsed = safeJsonParse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * After the script has settled, dump the keys the write-recorder proxy saw on
 * `ctx.record` (#4345). Those writes are discarded — the action path has no
 * record write-back — so the host reports them rather than staying silent.
 *
 * Returns `undefined` if the read fails or the recorder was never installed;
 * `[]` when the snapshot was present and untouched, which is the common case
 * and the one that must stay quiet.
 */
function readRecordWritesJson(vm: QuickJSContext): string[] | undefined {
  try {
    const r = vm.evalCode(
      `JSON.stringify(globalThis.__recordEscaped ? [] : (globalThis.__recordWrites || null))`,
    );
    if (r.error) {
      r.error.dispose();
      return undefined;
    }
    const s = vm.dump(r.value);
    r.value.dispose();
    if (typeof s !== 'string' || s === 'null') return undefined;
    const parsed = safeJsonParse(s);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : undefined;
  } catch {
    return undefined;
  }
}

function safeJsonParse(s: string | undefined): unknown {
  if (s === undefined || s === '') return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function cryptoRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // RFC 4122 v4 fallback
  const r = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${r()}-${r().slice(0, 4)}-4${r().slice(0, 3)}-${r().slice(0, 4)}-${r()}${r().slice(0, 4)}`;
}

function formatErr(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { message?: string; name?: string; stack?: string };
    if (o.message) return `${o.name ?? 'Error'}: ${o.message}`;
    return JSON.stringify(err);
  }
  return String(err);
}

export class SandboxError extends Error {
  /**
   * For errors thrown by *user* script/hook/action code: the original business
   * message without the `<kind> '<name>' threw:` debug wrapper that lives in
   * `.message`. Safe to surface to end users (e.g. an action's error toast);
   * the wrapped `.message` stays for server logs. Undefined for the sandbox's
   * own internal errors (capability denials, timeouts, marshalling failures),
   * which have no user-meaningful inner message.
   */
  readonly innerMessage?: string;
  /**
   * The semantic code of the error that crossed OUT of the VM, when it carried
   * one — most usefully `'VALIDATION_FAILED'`.
   */
  readonly code?: string;
  /**
   * Per-field validation envelopes belonging to that error. Present only when a
   * record `ValidationError` reached the body (typically via
   * `ctx.api.object(x).update(...)`), so a caller can highlight the offending
   * input instead of showing the message alone.
   */
  readonly fields?: unknown[];
  /**
   * [#7867] The HTTP status the error that crossed OUT of the VM named for
   * itself — 404 for the engine's `RECORD_NOT_FOUND`, 403 for a permission
   * refusal. `domains/actions.ts` serves it directly ("an error that NAMES its
   * own HTTP status is asking to be served with it"); without it a by-id write
   * against a nonexistent record was answered `RECORD_NOT_FOUND` at status 400.
   */
  readonly status?: number;
  /**
   * [#9934] The user-facing refusal text the error that crossed OUT of the VM
   * was marked with — the producer-side opt-in of the objectui#5210 ruling. A
   * body that throws `e.userMessage = '…'` is saying that exact text is
   * addressed to the END USER; the HTTP boundaries carry it to the wire's
   * `userMessage` channel and consumers render it verbatim, keeping the
   * generic #3821 substitution for everything unmarked. Absent unless the
   * body's own throw declared it — the sandbox never invents one.
   */
  readonly userMessage?: string;
  constructor(message: string, innerMessage?: string, info?: SandboxErrorInfo) {
    super(message);
    this.name = 'SandboxError';
    this.innerMessage = innerMessage;
    if (info?.code) this.code = info.code;
    if (info?.fields) this.fields = info.fields;
    if (typeof info?.status === 'number') this.status = info.status;
    if (info?.userMessage) this.userMessage = info.userMessage;
  }
}

/** The structured payload carried out of the VM alongside the flattened message. */
export interface SandboxErrorInfo {
  code?: string;
  fields?: unknown[];
  /** [#7867] See {@link SandboxError.status}. */
  status?: number;
  /** [#9934] See {@link SandboxError.userMessage}. */
  userMessage?: string;
  /**
   * [#4431] The error that crossed `__error` was the SANDBOX's own fault — a
   * denied capability, an unavailable `ctx.api`, a marshalling failure — not
   * user code rejecting. Read by the pump loop, which then leaves
   * `innerMessage` undefined so the #3951 crash contract's "SandboxError with
   * no innerMessage → 500" holds for in-VM host-call denials too.
   */
  sandboxFault?: boolean;
}

/**
 * Read the `__errorInfo` side-channel the wrapper's reject handler writes.
 * Returns `undefined` when the body's error carried nothing structured — which
 * is the common case, and keeps `SandboxError` unchanged for it.
 */
function readErrorInfo(vm: QuickJSContext): SandboxErrorInfo | undefined {
  let raw: unknown;
  try {
    const h = vm.getProp(vm.global, '__errorInfo');
    raw = vm.dump(h);
    h.dispose();
  } catch {
    return undefined;
  }
  if (typeof raw !== 'string' || !raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const p = parsed as { code?: unknown; fields?: unknown; status?: unknown; userMessage?: unknown; sandboxFault?: unknown };
  const info: SandboxErrorInfo = {};
  if (typeof p?.code === 'string' && p.code) info.code = p.code;
  if (Array.isArray(p?.fields)) info.fields = p.fields;
  // [#7867] `Number.isFinite` rather than a bare `typeof`: an out-of-range
  // number JSON-round-trips to `null`, and `NaN` would satisfy `typeof` while
  // making `errorFromThrown` emit a nonsense status line.
  if (typeof p?.status === 'number' && Number.isFinite(p.status)) info.status = p.status;
  // [#9934] Non-empty strings only — the same "what counts as marked" rule as
  // `declaredUserMessage` (`@objectstack/types`), applied at this boundary too.
  if (typeof p?.userMessage === 'string' && p.userMessage.trim().length > 0) info.userMessage = p.userMessage;
  if (p?.sandboxFault === true) info.sandboxFault = true;
  return info.code || info.fields || info.status !== undefined || info.userMessage !== undefined || info.sandboxFault
    ? info
    : undefined;
}

/**
 * Strip a leading default `Error: ` name prefix so a thrown business message
 * (`new Error('线索信息不完整…')`) reads as plain text for end users. Non-default
 * names (`TypeError:`, `RangeError:`) are kept — they signal a genuine bug
 * rather than a deliberately thrown business rule, which is useful context.
 */
function userFacingMessage(raw: string): string {
  return raw.startsWith('Error: ') ? raw.slice('Error: '.length) : raw;
}
