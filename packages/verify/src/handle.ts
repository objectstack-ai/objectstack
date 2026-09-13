// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @objectstack/verify — the in-process handle on the stack `bootStack` boots.
//
// `bootStack` already boots the real kernel — ObjectQL + hooks + validation +
// SecurityPlugin middleware + sharing + automation + the REST/dispatcher route
// surfaces — in memory. Until this module the only way to DRIVE that stack was
// HTTP request-injection (`api` / `apiAs`), so an app that wanted to assert on
// what a hook, a flow, an action or a validation rule did had to either read
// it off a JSON response or rebuild the engine's semantics in a stand-in.
//
// Every method here is a thin facade over a door the kernel wired at boot.
// Nothing in this file decides anything: it resolves the caller, hands the
// call to the door that owns the semantics, and returns what that door
// returned (or rethrows what it threw). The doors, per method:
//
//   hooks.run · validate · seed · rows   → the ObjectQL engine (`insert` /
//     `update` / `delete` / `validate` / `find`), the SAME calls
//     `@objectstack/rest`'s data ingress makes (`protocol.createData` →
//     `engine.insert(object, data, { context })`, and so on). The bound hook
//     chain, the validation pass, the SecurityPlugin middleware (object
//     grants, RLS, FLS) all live INSIDE those calls, so they run here exactly
//     as they run for a REST write. `handle.test.ts` pins that parity on the
//     same row AND the same refusal.
//   flows.run / flows.resume · actions.run → the runtime's `HttpDispatcher`,
//     driven in-process (no Hono, no socket, no JSON round-trip). The REST
//     `/automation` and `/actions` routes are the only doors that carry the
//     full contract for those two surfaces — the ADR-0066 D4 permission gate,
//     the ADR-0104 param contract, the subject-record load, the trusted-body
//     context assembly, the ADR-0112 refusal envelopes — and the runtime
//     exposes no lower in-process door with the same contract. The dispatcher
//     is protocol-neutral by design (`HttpProtocolContext`), so driving it
//     directly IS the REST path minus HTTP.
//   contextFor(token)                    → the dispatcher's own identity
//     resolution (`resolveRequestScope` → `resolveExecutionContext` →
//     `@objectstack/core`'s `resolveAuthzContext`), the exact resolver every
//     dispatcher request goes through. The handle never assembles an
//     `ExecutionContext` by hand.
//   metadata                             → the engine's `SchemaRegistry`.
//   tenancy                              → the `tenancy` service AuthPlugin
//     registered at boot.
//
// ⛔ Design rule (hotcrm#1579 step 5a): if a method needs a semantic the
// kernel does not expose, that is a kernel gap to FILE — never a semantic to
// re-implement here. A `ctx.api` over arrays, a hand-sorted hook dispatch, a
// copied permission check would each turn this handle into the stand-in it
// exists to retire, and would stay green when the engine changes.

import { HttpDispatcher, type ObjectKernel, type HttpProtocolContext } from '@objectstack/runtime';
import { SEED_WRITE_EXECUTION_CONTEXT, type ExecutionContext } from '@objectstack/spec/kernel';
import type { ValidateDataResponse } from '@objectstack/spec/api';
import type { AutomationResult } from '@objectstack/spec/contracts';
import type { ServiceObject } from '@objectstack/spec/data';
import type { ObjectQL } from '@objectstack/objectql';
import type { TenancyService } from '@objectstack/plugin-auth';

/** Any row the engine hands back. Untyped on purpose: the engine's, not the handle's. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EngineRow = Record<string, any>;

/**
 * The refusal a dispatcher-door method (`flows.*`, `actions.run`) throws when
 * the route answered a 4xx/5xx — the route's own ADR-0112 envelope, carried
 * whole. `code` and `status` are the assertion pair (the same pair a REST
 * client reads off the wire); `statusCode` mirrors `status` so a test can spell
 * the check the way it spells it for an engine-thrown error
 * (`PermissionDeniedError` carries `statusCode`).
 *
 * Engine-door methods (`hooks.run`, `validate`, `seed`, `rows`) do NOT wrap:
 * they rethrow the engine's error unchanged, exactly as the REST ingress would
 * have caught it.
 */
export interface VerifyRefusal extends Error {
  code: string;
  status: number;
  statusCode: number;
  details?: unknown;
}

/** `true` when `e` is a refusal a dispatcher-door method threw. */
export function isVerifyRefusal(e: unknown): e is VerifyRefusal {
  return e instanceof Error && (e as Partial<VerifyRefusal>).name === 'VerifyRefusal';
}

/** Identify the caller: a bearer token from `signIn()` / `signUp()`. */
export interface AsUser {
  /** A bearer token minted by `signIn()` / `signUp()` on the same stack. */
  as: string;
}

/**
 * The engine's answer to a flow trigger or resume, plus the flow's name so the
 * value can be handed straight back to `flows.resume`. The `AutomationResult`
 * half is the engine's own object as the route returned it (`runId`, `status`,
 * `screen`, `success`, `output`, `summary`, …); `flowName` is the request's,
 * not the engine's.
 */
export type FlowRun = AutomationResult & { flowName: string };

/**
 * What `flows.resume` needs to address a parked run — a `FlowRun` satisfies
 * it as-is. `runId` is optional here because the engine's result carries one
 * only for a run that actually paused; `flows.resume` refuses loudly when it
 * is absent instead of making the caller narrow the type.
 */
export interface FlowRunRef {
  flowName: string;
  runId?: string;
}

export interface VerifyHandle {
  /**
   * Resolve the execution context the platform resolves for `token` — user,
   * positions, permission sets, tenant, locale — through the dispatcher's own
   * request-identity resolver. This is the context every other method here
   * hands the engine; it is exposed so a test can drive a kernel service the
   * handle does not cover (`analytics`, `sharing`, …) as a real caller instead
   * of hand-assembling one. Throws when the token resolves to nobody.
   */
  contextFor(token: string): Promise<ExecutionContext>;

  hooks: {
    /**
     * Run one write through the real engine as `as`, and return what the engine
     * returned. The bound hook chain (`before*` → validation → the driver →
     * `after*`), the field defaults, the SecurityPlugin middleware — all of it
     * runs, in the engine's order, because this IS the engine's write door:
     * `insert(object, input, { context })`, `update(object, { ...input, id },
     * { where: { id }, context })`, `delete(object, { where: { id }, context })`
     * — the same three calls the REST data ingress makes.
     *
     * A refusal (permission, validation, a hook's throw) rejects with the
     * engine's own error: assert on its `code` (and `statusCode`), never on
     * the message alone.
     *
     * `update` and `delete` address the row by `input.id`.
     */
    run(
      object: string,
      operation: 'insert' | 'update' | 'delete',
      input: EngineRow,
      opts: AsUser,
    ): Promise<EngineRow>;
  };

  /**
   * The engine's validation pass for one record (or several), as `as`, without
   * writing: `ObjectQL.validate(object, data, { mode, context })`. Same field
   * defaults, same value-shape posture, same declared `validations[]` the
   * write path applies. Hooks do not run (the engine's documented contract for
   * a dry run — see `ObjectQL.validate`). `mode` defaults to `'insert'`.
   */
  validate(
    object: string,
    record: EngineRow | EngineRow[],
    opts: AsUser & { mode?: 'insert' | 'update' },
  ): Promise<ValidateDataResponse>;

  flows: {
    /**
     * Trigger a flow as `as` through the runtime's `POST
     * /automation/:name/trigger` route, driven in-process. The route builds the
     * engine's `AutomationContext` from the caller's resolved identity (so a
     * `runAs: 'user'` flow enforces RLS as `as`) and runs the flow through the
     * `automation` service registered at boot. Returns the engine's result;
     * a never-dispatched refusal (unknown flow, disabled, no start node) or a
     * run that failed rejects with the route's envelope (`VerifyRefusal`).
     */
    run(name: string, params: EngineRow | undefined, opts: AsUser): Promise<FlowRun>;
    /**
     * Continue a parked run through `POST /automation/:name/runs/:runId/resume`
     * with `input` as the screen submission. The engine's resume gate (what the
     * run is parked on, the screen's field contract) applies unchanged.
     */
    resume(run: FlowRunRef, input: EngineRow | undefined, opts: AsUser): Promise<FlowRun>;
  };

  actions: {
    /**
     * Invoke a declared action as `as` through `POST /actions/:object/:action`,
     * driven in-process — the one door that carries the whole action contract:
     * the ADR-0066 D4 permission gate, the ADR-0104 param contract, the
     * subject-record load under the caller's scope, and the trusted body
     * context the sandboxed body receives. Returns the handler's return value;
     * a refusal rejects with the route's envelope (`VerifyRefusal`).
     */
    run(
      object: string,
      action: string,
      opts: AsUser & { recordId?: string; params?: EngineRow },
    ): Promise<unknown>;
  };

  /**
   * Write fixture rows through the real engine as the platform's own seed
   * replay does — `insert(object, rows, { context: { isSystem, seedReplay,
   * skipTriggers } })`, the context `AppPlugin` uses for a stack's `data[]`.
   * System-elevated (no permission gate), state-machine rules relaxed, record
   * triggers not fired; hooks and declared validations still run, so a fixture
   * the app itself could not write is refused rather than smuggled in. Returns
   * the engine's rows (ids assigned).
   */
  seed(object: string, rows: EngineRow[]): Promise<EngineRow[]>;

  /**
   * Read rows through the real engine: `find(object, { where }, { context })`.
   * System-scoped by default (every row); pass `as` to read as a caller, under
   * that caller's object grants and RLS.
   */
  rows(object: string, where?: EngineRow, opts?: Partial<AsUser>): Promise<EngineRow[]>;

  /** The booted `SchemaRegistry`, read through its own accessors. */
  metadata: {
    /** One registered object (system columns injected), or `undefined`. */
    object(name: string): ServiceObject | undefined;
    /** Every registered object — the app's and the platform's. */
    objects(): ServiceObject[];
    /**
     * Every registered item of one metadata type, named as the registry names
     * it — the SINGULAR `MetadataTypeSchema` vocabulary (`'permission'` for
     * permission sets, `'flow'`, `'action'`, `'view'`, …; `types()` lists the
     * ones this boot holds). An unknown name answers `[]`, never a guess.
     */
    items<T = unknown>(type: string): T[];
    /** The metadata types the registry currently holds items for. */
    types(): string[];
  };

  /**
   * The `tenancy` service AuthPlugin registered at boot — `posture`,
   * `requestedPosture`, `isolationActive`, `degraded` — read live. What a stack
   * booted with `multiTenant` (the `--multi-tenant` option `os verify` already
   * has) reports here is the posture every posture-gated seam keys on.
   */
  tenancy(): TenancyService;
}

const API_PREFIX = '/api/v1';

/**
 * The write context `AppPlugin` uses to replay a stack's declared `data[]` —
 * read from the kernel's own {@link SEED_WRITE_EXECUTION_CONTEXT} rather than
 * re-spelled here, so this fixture writer cannot drift from the seed posture
 * the platform actually replays with (#17178).
 */
const SEED_CONTEXT: ExecutionContext = SEED_WRITE_EXECUTION_CONTEXT;
const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true } as ExecutionContext;

function refusalFrom(status: number, body: unknown, fallback: string): VerifyRefusal {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  const envelope = b?.error && typeof b.error === 'object' ? b.error : undefined;
  const message =
    typeof envelope?.message === 'string' ? envelope.message
      : typeof b?.error === 'string' ? b.error
        : typeof b?.message === 'string' ? b.message
          : fallback;
  const code =
    typeof envelope?.code === 'string' ? envelope.code
      : typeof b?.code === 'string' ? b.code
        : 'UNKNOWN';
  const err = new Error(message) as VerifyRefusal;
  err.name = 'VerifyRefusal';
  err.code = code;
  err.status = status;
  err.statusCode = status;
  if (envelope?.details !== undefined) err.details = envelope.details;
  return err;
}

/**
 * Build the handle over a booted kernel. Called by `bootStack` once the kernel
 * has bootstrapped; not a second boot path — it holds no state of its own
 * beyond the dispatcher it drives, and every call resolves the engine and the
 * services off `kernel` at call time.
 */
export async function createHandle(kernel: ObjectKernel, origin: string): Promise<VerifyHandle> {
  // The dispatcher class the boot mounted behind Hono, over the same kernel.
  // Its constructor registers domain handlers and nothing else (no routes
  // mounted, no services registered, no timers) — see `HttpDispatcher`.
  const dispatcher = new HttpDispatcher(kernel);
  // The slot's contract is the engine class itself: the handle reaches
  // `registry`, `validate` and the write/read doors, which `IDataEngine` does
  // not name (eslint.config.mjs, the slot-lookup rule).
  const engine = (): Promise<ObjectQL> => kernel.getServiceAsync<ObjectQL>('objectql');
  const registry = () => kernel.getService<ObjectQL>('objectql').registry;

  const requestFor = (token: string, method: string, path: string) => ({
    method,
    url: `${origin}${API_PREFIX}${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
  });

  const contextFor = async (token: string): Promise<ExecutionContext> => {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('verify: `as` must be a bearer token from signIn()/signUp() on this stack');
    }
    const ctx: HttpProtocolContext = { request: requestFor(token, 'GET', '/data') };
    await dispatcher.resolveRequestScope(ctx, '/data');
    const ec = ctx.executionContext;
    if (!ec?.userId) {
      throw new Error(
        'verify: `as` token resolved to no signed-in user — the platform treats it as anonymous. ' +
          'Mint it with signIn()/signUp() on THIS stack; a token from another boot does not carry over.',
      );
    }
    return ec;
  };

  const dispatch = async (token: string, method: string, path: string, body: unknown): Promise<unknown> => {
    const ctx: HttpProtocolContext = { request: requestFor(token, method, path) };
    const res = await dispatcher.dispatch(method, path, body, {}, ctx);
    if (!res.handled || !res.response) {
      throw new Error(`verify: no route handled ${method} ${API_PREFIX}${path}`);
    }
    const { status, body: rb } = res.response;
    if (status >= 400) throw refusalFrom(status, rb, `${method} ${API_PREFIX}${path} answered ${status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (rb as any)?.data;
  };

  const requireId = (input: EngineRow, operation: string): string => {
    const id = input?.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`verify: hooks.run(..., '${operation}', input) addresses the row by input.id — none given`);
    }
    return id;
  };

  return {
    contextFor,

    hooks: {
      async run(object, operation, input, opts) {
        // The call's own shape is judged before anyone is resolved: a
        // malformed call is refused for its own reason, not for whatever the
        // identity resolver says about the token.
        if (operation !== 'insert' && operation !== 'update' && operation !== 'delete') {
          throw new Error(`verify: hooks.run operation must be 'insert' | 'update' | 'delete', got '${String(operation)}'`);
        }
        const id = operation === 'insert' ? undefined : requireId(input, operation);
        const context = await contextFor(opts.as);
        const ql = await engine();
        switch (operation) {
          case 'insert':
            return ql.insert(object, input, { context });
          case 'update':
            // The REST PATCH door's spelling (`protocol.updateData`): the id
            // rides in the payload AND selects the row.
            return ql.update(object, { ...input, id }, { where: { id }, context });
          case 'delete':
            return ql.delete(object, { where: { id }, context });
        }
      },
    },

    async validate(object, record, opts) {
      const context = await contextFor(opts.as);
      const ql = await engine();
      return ql.validate(object, record, { mode: opts.mode ?? 'insert', context });
    },

    flows: {
      async run(name, params, opts) {
        const data = (await dispatch(opts.as, 'POST', `/automation/${encodeURIComponent(name)}/trigger`, {
          params: params ?? {},
        })) as AutomationResult;
        return { ...data, flowName: name };
      },
      async resume(run, input, opts) {
        if (typeof run.runId !== 'string' || run.runId.length === 0) {
          throw new Error(
            `verify: flows.resume needs a runId — the run passed for '${run.flowName}' carries none` +
              ('status' in run ? ` (status: ${String((run as { status?: unknown }).status)})` : '') +
              '; only a run that PAUSED can be resumed.',
          );
        }
        const data = (await dispatch(
          opts.as,
          'POST',
          `/automation/${encodeURIComponent(run.flowName)}/runs/${encodeURIComponent(run.runId)}/resume`,
          { inputs: input ?? {} },
        )) as AutomationResult;
        return { ...data, flowName: run.flowName };
      },
    },

    actions: {
      async run(object, action, opts) {
        return dispatch(opts.as, 'POST', `/actions/${encodeURIComponent(object)}/${encodeURIComponent(action)}`, {
          ...(opts.recordId !== undefined ? { recordId: opts.recordId } : {}),
          params: opts.params ?? {},
        });
      },
    },

    async seed(object, rows) {
      if (!Array.isArray(rows)) throw new Error('verify: seed(object, rows) takes an array of rows');
      const ql = await engine();
      const written = await ql.insert(object, rows, { context: SEED_CONTEXT });
      return Array.isArray(written) ? written : [written];
    },

    async rows(object, where, opts) {
      const context = opts?.as ? await contextFor(opts.as) : SYSTEM_CONTEXT;
      const ql = await engine();
      const found = await ql.find(object, where ? { where } : {}, { context });
      return Array.isArray(found) ? found : [];
    },

    metadata: {
      object: (name) => registry().getObject(name),
      objects: () => registry().getAllObjects(),
      items: <T = unknown>(type: string): T[] => [...registry().listItems<T>(type)],
      types: () => registry().getRegisteredTypes(),
    },

    tenancy: () => kernel.getService<TenancyService>('tenancy'),
  };
}
