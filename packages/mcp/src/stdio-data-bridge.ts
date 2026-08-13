// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * stdio-data-bridge — the principal-bound {@link McpDataBridge} the LONG-LIVED
 * (stdio) MCP server serves its object tools from (#8034).
 *
 * ## Why this exists
 *
 * `McpDataBridge` is an injected seam by design: the tool *shape* and every
 * fail-closed guard live in `mcp-http-tools.ts` (one owner), and each host
 * supplies the *execution + security* half bound to whatever principal that
 * host resolved. The HTTP dispatcher supplies one built from the request's
 * ExecutionContext (`packages/runtime/src/domains/mcp.ts` → `buildMcpBridge`).
 * The stdio transport had none at all — which is the whole of #8034: with no
 * bridge, nothing ever called `registerObjectTools`, so the long-lived server
 * advertised `capabilities.tools` and answered `-32601` to `tools/list`.
 *
 * The runtime's builder cannot be reused here, and not for want of trying: it
 * closes over an `HttpProtocolContext` (the request, its resolved kernel, its
 * per-environment data driver) and runs every verb through `callData`, whose
 * whole signature is request-shaped. A long-lived stdio session has no request
 * — it has ONE identity, resolved from `OS_MCP_STDIO_API_KEY` at boot and
 * re-resolved on every call so a revoked key stops working on the next read
 * (ADR-0101 D1).
 *
 * ## What it runs on
 *
 * {@link IDataEngine} with a per-call `context` — the SAME seam this plugin's
 * ADR-0101 record resource (`getRecord`) has used since #7645, and a contract
 * `packages/spec` actually declares. The security property rides on the engine,
 * not on this file: RBAC / RLS / FLS are the engine's middleware chain, so a
 * tool call here is bounded exactly like the same identity over REST. This file
 * decides no policy — if it ever appears to, that is a bug in this file.
 *
 * ## The ADR-0049 exposure gate (#8083)
 *
 * Every data verb below is gated on the object's declared `apiEnabled` /
 * `apiMethods` before it dispatches, exactly as `callData` gates the HTTP
 * bridge. This is a SURFACE-AREA control, not the authorization boundary (see
 * `api-exposure.ts`'s own ADR note) — CRUD/FLS/RLS ran on this transport before
 * and after. What was leaking was the AUTHOR'S DECLARATION: the same
 * `apiEnabled: false` was honoured on MCP over HTTP and ignored on MCP over
 * stdio. See {@link GATED_ACTIONS} for which verbs are gated and why that set
 * is exactly the HTTP one.
 *
 * ## Known divergences from the HTTP bridge (deliberate, filed, not security)
 *
 * `callData` prefers the `protocol` service (metadata-protocol) and falls back
 * to the engine; this bridge is engine-only. So the HTTP tools additionally get
 * that layer's ingress `readonly` strip, its existence probes, its spec-shaped
 * receipts and `expand`/`select`. None of those is the authorization boundary
 * — every call here still passes the engine's CRUD/FLS/RLS — but the two
 * transports should not differ at all, and unifying them behind one
 * transport-neutral data seam is filed as follow-up work rather than forked
 * here (route-ownership rule 1: a mirrored copy of `callData` would be a second
 * implementation that drifts).
 *
 * ⚠️ [#8497] ONE limb of that divergence WAS security, and the sentence above
 * used to deny it. #7823 relocated the `internal: true` WRITE-RESPONSE strip
 * from the engine to the protocol ingress — deliberately, and for measured
 * reasons (credential mint reads its own insert result back). The engine
 * therefore returns write results whole, and an engine-only bridge that echoes
 * one hands the caller a field the flag promises is never returned on the
 * generic data path (#7728). Measured on the `create` arm: the flagged column
 * rode the tool response verbatim. The strip is applied below, through the same
 * single helper every other write mouth uses; the read verbs are unaffected
 * (the engine's read path still strips, unchanged). What remains of the
 * divergence above is genuinely not security.
 */

import { omitInternalFieldsFromWriteResponse } from '@objectstack/core';
import {
  resolveEffectiveApiMethods,
  isApiOperationAllowed,
  effectiveOperationsArray,
  DATA_ACTION_TO_API_OPERATION,
  type EnableLike,
} from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import type { McpDataBridge, McpObjectSummary } from './mcp-http-tools.js';

/** What {@link createStdioDataBridge} needs from the host plugin. */
export interface StdioDataBridgeDeps {
  /** The ObjectQL engine — the `objectql` service, where RLS/FLS/permissions run. */
  engine: IDataEngine;
  /** The metadata service behind `list_objects` / `describe_object`. */
  metadataService: IMetadataService;
  /**
   * Re-resolve the stdio identity for THIS call and throw when it no longer
   * resolves (revoked / expired / owner-less key). Per call, never cached:
   * ADR-0101 D1 requires a revocation to take effect on the next read of a
   * live session, and a bridge built once at boot would outlive it.
   */
  resolvePrincipal: () => Promise<ExecutionContext>;
}

/** An object definition as `IMetadataService.getObject` hands it back. */
interface ObjectDef {
  name: string;
  label?: string;
  fields?: Record<string, { type?: string; label?: string; required?: boolean }>;
  enable?: Record<string, unknown>;
}

/**
 * Unwrap what the engine's read path resolves to.
 *
 * Same shape-tolerance as the ADR-0101 record reader next door: an engine may
 * answer a bare array or an envelope carrying `value`. Tolerating BOTH here is
 * not the consumer-side aliasing Prime Directive #12 forbids — it is the one
 * spelling the existing stdio reader already accepts, kept identical so the two
 * readers on this transport cannot disagree about what a row list is.
 */
function unwrapRows(res: unknown): Array<Record<string, unknown>> {
  const rows =
    res && typeof res === 'object' && 'value' in (res as Record<string, unknown>)
      ? (res as { value: unknown }).value
      : res;
  if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  return rows ? [rows as Record<string, unknown>] : [];
}

/** The one row this id names, or `null`. */
async function findById(
  engine: IDataEngine,
  object: string,
  id: string,
  context: ExecutionContext,
): Promise<Record<string, unknown> | null> {
  const res = await engine.find(object, { where: { id }, limit: 1 }, { context });
  return unwrapRows(res)[0] ?? null;
}

/**
 * The "this id names no row" refusal, raised BEFORE a write is attempted.
 *
 * A write path that answers success for an id that matched nothing is the
 * #5138 / #5581 defect the HTTP path already paid for: an integrator reading
 * a success receipt records the change as landed. `registerObjectTools` turns
 * a throw into a tool error, so the caller is told.
 */
function recordNotFound(object: string, id: string): Error {
  return new Error(`Record "${id}" not found in "${object}"`);
}

/**
 * Bridge method → the `callData` action name the HTTP bridge gates it under.
 *
 * This table IS the parity claim, so it is data rather than six literals spread
 * through the verbs below: `buildMcpBridge` (`packages/runtime/src/domains/mcp.ts`)
 * routes exactly these six methods through `callData`, which gates on exactly
 * these six action words — `remove` reaching it as `'delete'`, the only entry
 * whose two names differ. `listObjects` / `describeObject` are deliberately
 * ABSENT: the HTTP bridge answers both straight off the metadata service
 * without touching `callData`, so gating them here would be a NEW divergence
 * pointing the other way (a schema read refused on stdio and served on HTTP).
 */
export const GATED_ACTIONS = {
  query: 'query',
  get: 'get',
  create: 'create',
  update: 'update',
  remove: 'delete',
  aggregate: 'aggregate',
} as const;

/**
 * ADR-0112 machine codes for the two exposure refusals — the SAME pair REST's
 * `apiAccessDenialFromEnable` answers with, so one declaration reads as one
 * code on every surface that enforces it.
 */
const OBJECT_API_DISABLED = 'OBJECT_API_DISABLED';
const OBJECT_API_METHOD_NOT_ALLOWED = 'OBJECT_API_METHOD_NOT_ALLOWED';

/** An exposure refusal: an `Error` (so the tool layer reads `.message`) carrying the envelope. */
export interface McpExposureError extends Error {
  /** ADR-0112 machine code. */
  code: string;
  /** 404 (object hidden) or 405 (operation not in the whitelist). */
  status: number;
  /** The effective operation set — present on a 405, as REST's `allowed` is. */
  allowedOperations?: string[];
}

function exposureError(
  message: string,
  code: string,
  status: number,
  allowedOperations?: string[],
): McpExposureError {
  const err = new Error(message) as McpExposureError;
  err.code = code;
  err.status = status;
  if (allowedOperations) err.allowedOperations = allowedOperations;
  return err;
}

/**
 * The ADR-0049 object exposure gate, applied before a data verb dispatches
 * (#8083). Throws {@link McpExposureError} when the object's own declaration
 * does not expose `action`; returns normally when it does.
 *
 * EXPORTED for the ADR-0101 record resource (#8266), which is the one read path
 * on this transport that does NOT go through this bridge: its reader is built
 * inline in `plugin.ts` and handed to `bridgeResources`, so it called `ql.find`
 * with no gate at all and served rows for objects the tool surface refused.
 * That reader now calls this function with {@link GATED_ACTIONS}`.get` — the
 * same action word `bridge.get` gates under — so one declaration yields one
 * verdict on both read paths. Exported within the package only; `index.ts`
 * publishes neither this nor `createStdioDataBridge`.
 *
 * Any FUTURE read path added to this transport belongs here too. The decision
 * is deliberately one function rather than a per-seam re-derivation, because
 * the two defects this file has now paid for (#8083, #8266) were both a seam
 * that skipped the decision, never a seam that got the decision wrong.
 *
 * The DECISION is not re-implemented here — it comes from the spec's single
 * source of truth (`resolveEffectiveApiMethods` / `isApiOperationAllowed`),
 * the same functions `checkApiExposure` (runtime, the HTTP/MCP path) and
 * `apiAccessDenialFromEnable` (rest) delegate to. Each surface owns only its
 * own envelope; the three-state whitelist, the action→operation mapping and
 * the derived verbs resolve identically on all three.
 *
 * Three behaviours are matched to the HTTP path deliberately, not by accident:
 *
 *  - **`isSystem` bypasses.** These flags govern API *exposure*, so an internal
 *    engine self-write is not subject to them (`callData`'s first condition).
 *  - **Unresolvable metadata FAILS OPEN.** A thrown or empty `getObject` falls
 *    back to the schema defaults (`apiEnabled` true, no whitelist), matching
 *    `callData`'s `catch { def = undefined }` and `checkApiExposure`'s
 *    `if (!def) return { allowed: true }`. The fail-open is safe for the reason
 *    ADR/#3545 records: this is surface area, and the engine's CRUD/FLS/RLS
 *    still runs on the call regardless of the outcome here.
 *  - **The flat shape is still read.** `getObject()` returns the flags nested
 *    under `.enable`, but `checkApiExposure` falls back to a flat top level for
 *    legacy/test doubles. Reading only the nested shape here would let a flat
 *    definition be gated on HTTP and ungated on stdio — the very divergence
 *    this function closes, re-opened one shape down.
 */
export async function enforceApiExposure(
  metadataService: IMetadataService,
  object: string,
  action: string,
  context: ExecutionContext,
): Promise<void> {
  if (context?.isSystem) return;

  let def: ObjectDef | null | undefined;
  try {
    def = (await metadataService.getObject(object)) as ObjectDef | null | undefined;
  } catch {
    def = undefined; // fall open to the schema defaults
  }
  if (!def) return;

  const enable = (
    def.enable && typeof def.enable === 'object' ? def.enable : def
  ) as unknown as EnableLike;

  if (enable.apiEnabled === false) {
    throw exposureError(
      `Object '${object}' is not exposed via the API`,
      OBJECT_API_DISABLED,
      404,
    );
  }

  const eff = resolveEffectiveApiMethods(enable);
  if (eff.mode === 'unrestricted') return;

  const operation = DATA_ACTION_TO_API_OPERATION[action] ?? action;
  if (isApiOperationAllowed(eff, operation)) return;

  throw exposureError(
    `API operation '${operation}' is not allowed on object '${object}'`,
    OBJECT_API_METHOD_NOT_ALLOWED,
    405,
    effectiveOperationsArray(eff),
  );
}

/**
 * Build the stdio transport's principal-bound data bridge.
 *
 * `aggregate` is attached only when the engine implements it, so a partial
 * engine degrades to the same "no `aggregate_records` tool" outcome the HTTP
 * bridge produces — the graceful-degradation contract `McpDataBridge` declares,
 * honoured rather than re-decided.
 */
export function createStdioDataBridge(deps: StdioDataBridgeDeps): McpDataBridge {
  const { engine, metadataService, resolvePrincipal } = deps;

  const bridge: McpDataBridge = {
    async listObjects(): Promise<McpObjectSummary[]> {
      const objects = ((await metadataService.listObjects()) ?? []) as ObjectDef[];
      return objects.map((o) => ({
        name: o.name,
        label: o.label ?? o.name,
        fieldCount: o.fields ? Object.keys(o.fields).length : undefined,
      }));
    },

    async describeObject(name: string): Promise<unknown | null> {
      const def = (await metadataService.getObject(name)) as ObjectDef | undefined | null;
      if (!def) return null;
      const fields = def.fields ?? {};
      // The field list is an ARRAY here, not the stored map: `validate_expression`
      // reads `Array.isArray(def.fields)` off this very value, and the HTTP
      // bridge projects the same shape. A map would type-check and silently
      // leave that tool with zero fields in scope.
      return {
        name: def.name,
        label: def.label ?? def.name,
        fields: Object.entries(fields).map(([key, f]) => ({
          name: key,
          type: f?.type,
          label: f?.label ?? key,
          required: f?.required ?? false,
        })),
        enableFeatures: def.enable ?? {},
      };
    },

    async query(object, opts) {
      const context = await resolvePrincipal();
      await enforceApiExposure(metadataService, object, GATED_ACTIONS.query, context);
      const query: Record<string, unknown> = {};
      if (opts?.where) query.where = opts.where;
      if (opts?.fields) query.fields = opts.fields;
      if (opts?.orderBy) query.orderBy = opts.orderBy;
      if (typeof opts?.limit === 'number') query.limit = opts.limit;
      if (typeof opts?.offset === 'number') query.offset = opts.offset;
      const records = unwrapRows(await engine.find(object, query, { context }));
      return { object, records, total: records.length };
    },

    async get(object, id) {
      const context = await resolvePrincipal();
      await enforceApiExposure(metadataService, object, GATED_ACTIONS.get, context);
      // `null` rather than a throw: `get_record` owns the not-found wording on
      // this path and already branches on a nullish record.
      return await findById(engine, object, id, context);
    },

    async create(object, data) {
      const context = await resolvePrincipal();
      await enforceApiExposure(metadataService, object, GATED_ACTIONS.create, context);
      const written = (await engine.insert(object, data, { context })) as
        | Record<string, unknown>
        | undefined;
      const record = { ...data, ...(written ?? {}) };
      // [#8497] `written` is the engine's WRITE result, which since #7823 keeps
      // the stored row whole — flagged columns included. This is a generic data
      // mouth answering an external caller, so it owns the response-body half
      // of the `internal: true` guarantee (#7728) exactly as the protocol
      // ingress and the REST batch arm do. Measured before the fix: a create
      // returned `vault_secret` verbatim in `record`.
      omitInternalFieldsFromWriteResponse(await metadataService.getObject(object), record);
      return { object, id: record.id, record };
    },

    async update(object, id, data) {
      const context = await resolvePrincipal();
      // Before the existence probe, not after: `recordNotFound` vs. a hit is an
      // observable difference, so gating second would answer "that id names no
      // row" for an object the author declared unexposed.
      await enforceApiExposure(metadataService, object, GATED_ACTIONS.update, context);
      const existing = await findById(engine, object, id, context);
      if (!existing) throw recordNotFound(object, id);
      await engine.update(object, data, { where: { id }, context });
      const record = { ...(existing as Record<string, unknown>), ...data };
      // [#8497] The engine's update RESULT is deliberately discarded here (this
      // arm echoes the read-path row plus the caller's own patch), so no STORED
      // flagged value can reach this line. The strip still runs, for the one
      // remaining way an `internal: true` key can appear in the body: the
      // caller put it in `data`. Echoing it back would answer a read of a field
      // the flag says is never returned — using the caller's own bytes as the
      // oracle for whether their guess matched storage. Cheap, and it makes the
      // property literally true on every verb of this bridge rather than true-
      // by-argument on one.
      omitInternalFieldsFromWriteResponse(await metadataService.getObject(object), record);
      return { object, id, record };
    },

    async remove(object, id) {
      const context = await resolvePrincipal();
      // Gated before the probe, for the reason `update` states.
      await enforceApiExposure(metadataService, object, GATED_ACTIONS.remove, context);
      const existing = await findById(engine, object, id, context);
      if (!existing) throw recordNotFound(object, id);
      await engine.delete(object, { where: { id }, context });
      // `success`, not `deleted` — the spec's `DeleteDataResponse` key (#5581).
      return { object, id, success: true };
    },
  };

  if (typeof engine.aggregate === 'function') {
    bridge.aggregate = async (object, opts) => {
      const context = await resolvePrincipal();
      // `aggregate` is a list-class read: an object whose whitelist excludes
      // `list` must not leak row statistics through GROUP BY either. The
      // derivation lives in the spec helpers, so that holds here for free.
      await enforceApiExposure(metadataService, object, GATED_ACTIONS.aggregate, context);
      // No casts: `McpDataBridge.aggregate` declares the engine's own
      // `EngineAggregateOptions` slices since #8032, so the honest call
      // compiles — the two `as unknown as` casts this line used to carry
      // existed only because the engine option declared `groupBy: string[]`
      // while reading structured buckets.
      const rows = await engine.aggregate(object, {
        ...(opts?.where ? { where: opts.where } : {}),
        ...(opts?.groupBy ? { groupBy: opts.groupBy } : {}),
        aggregations: opts.aggregations,
        ...(opts?.timezone ? { timezone: opts.timezone } : {}),
        context,
      });
      return rows ?? [];
    };
  }

  return bridge;
}
