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
//   hooks.run · hooks.updateWhere · validate · seed · rows → the ObjectQL
//     engine (`insert` / `update` / `delete` / `validate` / `find`), the SAME
//     calls `@objectstack/rest`'s data ingress makes (`protocol.createData` →
//     `engine.insert(object, data, { context })`, and so on). The bound hook
//     chain, the validation pass, the SecurityPlugin middleware (object
//     grants, RLS, FLS) all live INSIDE those calls, so they run here exactly
//     as they run for a REST write. `handle.test.ts` pins that parity on the
//     same row AND the same refusal. [#22301] The two update doors also take
//     the system principal by name (`{ system: true }` → `{ isSystem: true }`,
//     the context a system job's write carries), and `hooks.updateWhere` is
//     the engine's predicate path (`multi: true`), which no REST door reaches:
//     `handle.update-doors.test.ts` pins both.
//   flows.run / flows.resume · actions.run → the runtime's `HttpDispatcher`,
//     driven in-process (no Hono, no socket, no JSON round-trip). The REST
//     `/automation` and `/actions` routes are the only doors that carry the
//     full contract for those two surfaces — the ADR-0066 D4 permission gate,
//     the ADR-0104 param contract, the subject-record load, the trusted-body
//     context assembly, the ADR-0112 refusal envelopes — and the runtime
//     exposes no lower in-process door with the same contract. The dispatcher
//     is protocol-neutral by design (`HttpProtocolContext`), so driving it
//     directly IS the REST path minus HTTP.
//   the anonymous public-form door       → NOT a method here. [#22301] A
//     public form's submission is `POST /api/v1/forms/:slug/submit`, a route
//     with one owner (`@objectstack/rest`'s `registerFormEndpoints`) that
//     `bootStack` mounts on the stack's Hono app, so on a booted stack it is
//     `api('/forms/:slug/submit', …)` with no token. The dispatcher above does
//     not serve it, and a method here that handed the engine a hand-built
//     `{ publicFormGrant, … }` context would be the stand-in the design rule
//     below forbids. `handle.public-form-door.test.ts` pins the door.
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
import { resolveEngineUpdateDispatch, type ObjectQL } from '@objectstack/objectql';
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
 * [#22301] Identify the caller as the platform's own SYSTEM principal: no
 * user, no session. The write runs under `{ isSystem: true }`, the context a
 * system job, an integration or the platform's own automation writes under,
 * so it passes no permission gate, and it is still a real write: the bound
 * hooks see `session.isSystem` and no `userId`, declared validations run, and
 * the record-change trigger fires its flows with no trigger user. (`seed` is
 * the other system door, and it is not this one: it also sets `skipTriggers`
 * and `seedReplay`, because a fixture is end-state data, not an event.)
 *
 * Accepted by the UPDATE doors only: `hooks.run(object, 'update', …)` and
 * `hooks.updateWhere`. Named, never defaulted: a write that names no caller
 * is refused, so a forgotten `as` can never become a system write.
 */
export interface AsSystem {
  system: true;
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
     *
     * An ANONYMOUS write, a public-form submission (the write a web-to-lead
     * or web-to-case branch runs on), is not this door: it is the form's own
     * route on the stack, `api('/forms/:slug/submit', { method: 'POST',
     * body })` with no token. That route hands the engine its own guest
     * context, keeps only the fields the form collects, and answers `{ id }`.
     */
    run(
      object: string,
      operation: 'insert' | 'update' | 'delete',
      input: EngineRow,
      opts: AsUser,
    ): Promise<EngineRow>;
    /**
     * [#22301] The same by-id `update` as the SYSTEM principal ({@link AsSystem}):
     * `update(object, { ...input, id }, { where: { id }, context: { isSystem:
     * true } })`. No permission gate; the hooks, the declared validations and
     * the record-change trigger run as they do for any system write.
     *
     * Only `update` takes `{ system: true }`. A system insert of fixture rows
     * is `seed`; a system insert or delete that fires record triggers has no
     * door here, and asking for one is refused (`INVALID_REQUEST` / `400`).
     */
    run(object: string, operation: 'update', input: EngineRow, opts: AsSystem): Promise<EngineRow>;
    /**
     * [#22301] A PREDICATE update: one payload written to every row `where`
     * selects. This is the engine's own predicate path, `update(object, data,
     * { where, multi: true, context })`, and no REST door reaches it (`POST
     * /data/:object/updateMany` writes by id, one row at a time). The engine
     * dispatches the `beforeUpdate` and `afterUpdate` hooks once per matched
     * row, each bound to THAT row's pre-image as `previous` (ADR-0058's bulk
     * addendum), so the record-change trigger evaluates and fires per row.
     * Resolves with the affected-row count the engine answers.
     *
     * `where` is the engine's object-form filter (`{ name: 'x' }`, `{ stage:
     * { $ne: 'won' } }`); `{}` matches every row. The caller is a person
     * (`{ as }`) or the system (`{ system: true }`).
     *
     * Refused before the engine is touched (`INVALID_REQUEST` / `400`): a
     * `where` that is not an object, and a call the engine's own update
     * dispatch would write by id instead: a `where` that names only an `id`,
     * or an `id` in `data` beside a `where` that selects by nothing else. One
     * row by id is `hooks.run(object, 'update', { id, ...fields }, opts)`.
     * Every other refusal (permission, validation, a hook's throw, the
     * dispatch refusing an `id` in `data` beside a real predicate) is the
     * engine's own error, rethrown unchanged.
     */
    updateWhere(object: string, where: EngineRow, data: EngineRow, opts: AsUser | AsSystem): Promise<number>;
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

/**
 * [#22301] A call the handle refuses for its own SHAPE, before any caller is
 * resolved or the engine is touched. The ADR-0112 pair is the assertion
 * surface (`statusCode` mirrors `status`, as on a `VerifyRefusal`).
 */
function callShapeRefusal(message: string): Error & { code: string; status: number; statusCode: number } {
  return Object.assign(new Error(message), { code: 'INVALID_REQUEST', status: 400, statusCode: 400 });
}

/** `true` when `opts` names the system principal; refuses a call that names two callers. */
function namesSystem(opts: AsUser | AsSystem, door: string): boolean {
  const system = (opts as Partial<AsSystem> | undefined)?.system === true;
  if (system && (opts as Partial<AsUser>).as !== undefined) {
    throw callShapeRefusal(`verify: ${door} takes ONE caller: { as: token } or { system: true }, not both`);
  }
  return system;
}

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
      // Parameters annotated because the member is overloaded (an overload
      // set gives no contextual parameter types); the return type is left to
      // inference, as it was before the overload.
      async run(object: string, operation: 'insert' | 'update' | 'delete', input: EngineRow, opts: AsUser | AsSystem) {
        // The call's own shape is judged before anyone is resolved: a
        // malformed call is refused for its own reason, not for whatever the
        // identity resolver says about the token.
        if (operation !== 'insert' && operation !== 'update' && operation !== 'delete') {
          throw new Error(`verify: hooks.run operation must be 'insert' | 'update' | 'delete', got '${String(operation)}'`);
        }
        const system = namesSystem(opts, 'hooks.run');
        if (system && operation !== 'update') {
          throw callShapeRefusal(
            `verify: hooks.run takes { system: true } on 'update' only, got '${operation}'. ` +
              'A system insert of fixture rows is seed(object, rows); a system insert or delete that fires record triggers has no handle door.',
          );
        }
        const id = operation === 'insert' ? undefined : requireId(input, operation);
        const context = system ? { ...SYSTEM_CONTEXT } : await contextFor((opts as AsUser).as);
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

      async updateWhere(object, where, data, opts) {
        if (where === null || typeof where !== 'object' || Array.isArray(where)) {
          throw callShapeRefusal(
            'verify: hooks.updateWhere(object, where, data, opts) takes `where` as an object filter; `{}` matches every row',
          );
        }
        // The engine's OWN dispatch ladder (the one `ObjectQL.update` resolves
        // first), asked rather than re-derived: a call it would route to the
        // by-id path is not a predicate update, and answering it here would
        // hand back a row where this door promises a count.
        if (resolveEngineUpdateDispatch(data, { where, multi: true }).kind === 'by-id') {
          throw callShapeRefusal(
            "verify: hooks.updateWhere is the engine's predicate path, but this call addresses one row by id " +
              "(a `where` naming only an id, or an id in `data` beside a `where` that selects by nothing else), " +
              'which the engine writes by id. ' +
              "Update one row through hooks.run(object, 'update', { id, ...fields }, opts).",
          );
        }
        const context = namesSystem(opts, 'hooks.updateWhere') ? { ...SYSTEM_CONTEXT } : await contextFor((opts as AsUser).as);
        const ql = await engine();
        return (await ql.update(object, data, { where, multi: true, context })) as number;
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
