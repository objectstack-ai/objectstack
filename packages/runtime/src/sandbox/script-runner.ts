// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Hook & Action Body Sandbox
 *
 * Pluggable execution engine for L2 `ScriptBody` payloads coming from
 * `@objectstack/spec/data` `HookBodySchema`.
 *
 * ## Engine choice — quickjs-emscripten
 *
 * Two candidates were evaluated:
 *
 * | Property                | isolated-vm                | quickjs-emscripten        |
 * |-------------------------|----------------------------|---------------------------|
 * | True isolation          | ✅ V8 isolate               | ✅ separate JS heap        |
 * | Memory limit enforced   | ✅ hard cap                 | ⚠️ soft (engine-level)     |
 * | CPU timeout enforced    | ✅ hard kill                | ✅ interrupt handler       |
 * | Native dependency       | ❌ requires N-API build     | ✅ pure WASM               |
 * | Edge runtime support    | ❌ Cloudflare/Vercel ban    | ✅ runs on every JS host   |
 * | Cold-start cost         | ~50ms (native init)        | ~100ms (WASM init)        |
 * | Per-invocation overhead | very low                   | low–medium                |
 *
 * **Decision:** `quickjs-emscripten`.
 *
 * The single biggest constraint for ObjectStack is that `objectos` ships as a
 * pure-JS runtime so it can run on serverless edges, Cloudflare Workers,
 * Vercel Edge, Deno Deploy, plus traditional Node servers. `isolated-vm`
 * disqualifies us from every edge target because of its N-API dependency.
 * The performance penalty of QuickJS for short hook/action bodies (typically
 * <1 ms of script logic) is dominated by `ctx.api` round-trips anyway, so the
 * trade is favorable.
 *
 * The engine sits behind the `ScriptRunner` interface — if a host environment
 * can guarantee node-only deployment we can plug `isolated-vm` later without
 * touching call sites.
 */

import type { HookBody, ScriptBody, ExpressionBody } from '@objectstack/spec/data';

/**
 * Identity / origin information used by the sandbox for diagnostics, capability
 * gating, and audit logs.
 */
export interface ScriptOrigin {
  /** Whether the body is attached to a Hook or an Action. */
  kind: 'hook' | 'action';
  /** Object the hook/action targets, when applicable. */
  object?: string;
  /** Hook/Action name, used in error messages and traces. */
  name: string;
}

/**
 * Context object exposed to the script. The shape mirrors `HookContext` /
 * `ActionContext` from `@objectstack/spec`. The sandbox copies a subset of
 * these into the isolated heap; capability checks gate which methods are
 * actually wired up.
 */
export interface ScriptContext {
  /**
   * The script input. For an action body this is the action's params bag,
   * validated against the action's declared param contract at dispatch before
   * the body runs (ADR-0104 D2) — so its shape conforms to the declaration.
   * Typed `unknown` because the sandbox is a single generic seam over hooks
   * (record) and action bodies (params); the guarantee is enforced upstream,
   * not by this type.
   */
  input: unknown;
  previous?: unknown;
  user?: unknown;
  session?: unknown;
  /**
   * The lifecycle event name the hook is firing for (e.g. `beforeInsert`,
   * `afterUpdate`). Required for hooks that subscribe to multiple events
   * and dispatch on event name.
   */
  event?: string;
  /** The object the hook/action targets — surfaces from `HookContext.object`. */
  object?: string;
  /**
   * Action only: the record id passed in the action invocation URL
   * (`POST /api/v1/actions/:object/:action/:recordId`). Hooks always have
   * the record on `input` so this stays undefined for them.
   */
  recordId?: string;
  /**
   * Action only: the record loaded by the dispatcher before the action ran
   * (when the dispatcher pre-fetches it). May be undefined for actions
   * declared with `requiresRecord: false` or when no `recordId` was supplied.
   *
   * READ-ONLY in effect. `buildActionSandboxContext` passes a plain snapshot
   * (`unwrapProxyToPlain`), and `boundActionHandler` returns `result.value`
   * without writing anything back — the hook path's `applyMutationsToInput` has
   * no action-side counterpart. So `ctx.record.x = …` inside a body mutates a
   * copy that is then discarded, for DECLARED and undeclared fields alike; to
   * persist, write through `ctx.api.object(...)`. `@objectstack/lint` warns on
   * a provably dead assignment (`action-record-write-discarded`, #4345).
   *
   * The runtime reports the same thing at INVOCATION time — see
   * {@link ScriptResult.droppedRecordWrites}. That covers what a parse cannot:
   * computed keys, aliases, and bodies authored through Studio or the API,
   * which no lint ever inspects. It only reports; whether the runtime should
   * instead refuse or honour the write remains open, and logging a discard
   * prejudges neither answer.
   */
  record?: unknown;
  /** Engine-side `result` (only set for after* hooks). */
  result?: unknown;
  api?: unknown;
  log?: {
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
  };
  /**
   * Host-provided crypto seam. `randomUUID` is the only member — it is the only
   * one `installCtx` (quickjs-runner.ts) ever wired onto the VM's `ctx.crypto`.
   *
   * `hash?: (algo, data) => Promise< string >` was declared here until spec 17
   * (#4391) with no implementation behind it anywhere: this signature, the
   * `crypto.hash` capability token and the CLI's build-time inference all
   * described a function the sandbox never installed, so the one call it typed
   * threw inside the VM. Removed rather than implemented (ADR-0049) — hashing
   * in the sandbox widens its capability and security-review surface and
   * nothing pulled for it. It returns WITH an implementation, not ahead of one.
   */
  crypto?: {
    randomUUID?: () => string;
  };
}

/**
 * Result returned to the caller after script execution.
 * - For hooks the `value` is typically `undefined` (mutations happen on `ctx`).
 * - For actions the `value` is the script's return value.
 */
export interface ScriptResult {
  value: unknown;
  /** Total wall-clock time inside the sandbox, milliseconds. */
  durationMs: number;
  /**
   * Snapshot of `ctx.input` *as observed inside the VM after the script settled*.
   *
   * Hooks frequently mutate `ctx.input.x = y` directly without returning a value.
   * The runner dumps the post-execution `ctx.input` so the host body-runner can
   * write the mutations back through to the engine's `hookContext.input` (which
   * is itself usually a flat-record Proxy).
   *
   * `undefined` if the dump failed or the script context did not expose `input`.
   */
  mutatedInput?: Record<string, unknown>;
  /**
   * Keys the script wrote on `ctx.record`, in first-write order (#4345).
   *
   * `ctx.record` is a read-only snapshot (see {@link ScriptContext.record}), so
   * every one of these writes is DISCARDED. The engine records them rather than
   * dropping them in silence: an author who believed the write persisted gets a
   * host-side diagnostic naming the fields and the remedy, instead of a green
   * action and an unchanged record — the #4001 "silent no-op manufactures false
   * completion" shape.
   *
   * Recorded by a `set`/`deleteProperty`/`defineProperty` proxy installed over
   * the snapshot inside the VM — behind an accessor, so a wholesale
   * `ctx.record = {…}` is caught as well and does not swap the recorder out.
   * Being a run-time trap rather than a parse, it sees what static analysis
   * cannot: computed keys, `Object.assign`, aliased references
   * (`const r = ctx.record; r.x = 1`), and bodies authored through Studio or
   * the API, which no lint ever inspects.
   *
   * ONLY dead writes are reported. A snapshot that leaves the body as a value
   * — `update(ctx.record)`, a spread, a return, a `JSON.stringify` — may well
   * have carried the write somewhere, so the recorder goes quiet (an `ownKeys`
   * after a write marks the escape). A plain property read does not rescue it.
   * Same direction as the author-time rule: a wrong "discarded" asserts
   * something false about the stored record, which is worse than a miss.
   *
   * `undefined` when the context carried no `record` (every hook, and actions
   * with no pre-fetched record) or when the read-back failed; empty when a
   * record was present and untouched.
   */
  droppedRecordWrites?: string[];
}

export interface ScriptRunOptions {
  origin: ScriptOrigin;
  /** Hard timeout for this invocation. The smaller of body.timeoutMs and this wins. */
  timeoutMs?: number;
  /** Optional abort signal from the surrounding kernel. */
  signal?: AbortSignal;
}

/**
 * The sandbox engine contract. Implementations live under
 * `packages/runtime/src/sandbox/engines/`.
 */
export interface ScriptRunner {
  /** Execute an L1 expression. Pure, side-effect-free. */
  evalExpression(body: ExpressionBody, ctx: ScriptContext, opts: ScriptRunOptions): Promise<ScriptResult>;

  /** Execute an L2 sandboxed JS script body. */
  runScript(body: ScriptBody, ctx: ScriptContext, opts: ScriptRunOptions): Promise<ScriptResult>;

  /** Convenience dispatch on the discriminated union. */
  run(body: HookBody, ctx: ScriptContext, opts: ScriptRunOptions): Promise<ScriptResult>;

  /** Release any underlying VM resources. */
  dispose(): Promise<void>;
}

/**
 * Default no-op runner — throws on every call. The real engine is injected
 * during runtime bootstrap once `quickjs-emscripten` is wired in. This stub
 * lets the rest of the pipeline (loader, dispatcher, type plumbing) compile
 * and be unit-tested ahead of the engine landing.
 */
export class UnimplementedScriptRunner implements ScriptRunner {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  evalExpression(_body: ExpressionBody, _ctx: ScriptContext, _opts: ScriptRunOptions): Promise<ScriptResult> {
    return Promise.reject(new Error('ScriptRunner not configured: install a quickjs engine first.'));
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  runScript(_body: ScriptBody, _ctx: ScriptContext, _opts: ScriptRunOptions): Promise<ScriptResult> {
    return Promise.reject(new Error('ScriptRunner not configured: install a quickjs engine first.'));
  }
  run(body: HookBody, ctx: ScriptContext, opts: ScriptRunOptions): Promise<ScriptResult> {
    return body.language === 'expression'
      ? this.evalExpression(body, ctx, opts)
      : this.runScript(body, ctx, opts);
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
