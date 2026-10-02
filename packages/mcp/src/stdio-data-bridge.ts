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
 * that layer's existence probes, its spec-shaped receipts and `expand`/`select`.
 * (That layer's create-side `readonly` strip used to head this list; since the
 * maintainer ruling of 2026-09-03 — option C, #14147 — the static `readonly`
 * strip runs inside `engine.insert` for every non-system caller and the
 * ingress copy is deleted, so on that point the two transports no longer
 * differ.) None of those is the authorization boundary
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
 * (the engine's read path still strips, unchanged).
 *
 * ⚠️ [#21207] A SECOND limb was security too: the stored-metadata-body family
 * (`sys_metadata` / `sys_metadata_history`'s body column, credential material
 * included). The protocol layer serves that body only as its type's read
 * projection and refuses to evaluate it; the engine returns it as stored, so
 * this engine-only reader served it as stored — to an administrator's key, a
 * member being refused by the engine as usual. The family's one projection is
 * now applied here and the evaluate shapes are refused; see
 * {@link storedMetadataBodyRefusal} and {@link serveStoredMetadataRows}. What
 * remains of the divergence above is genuinely not security.
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
// [#21207] The stored-metadata-body family's ONE projection and its object set,
// from where every other surface of the family takes them (the data door, the
// audit copy, the analytics refusal, the realtime event). This package does not
// depend on `@objectstack/metadata-protocol` and needs nothing from it: the
// projection itself lives in `@objectstack/spec/kernel`.
import {
  isStoredMetadataBodyObject,
  redactStoredMetadataRow,
  STORED_METADATA_BODY_COLUMN,
  STORED_METADATA_TYPE_COLUMN,
} from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
// [commit 4810dd628] The repo's ONE single-record 404 (#4435/#5138/#7867). Imported from
// `@objectstack/core` rather than re-minted here or reached via
// `@objectstack/metadata-protocol`'s re-export: this package already declares
// a direct `@objectstack/core` dependency (`plugin.ts` imports from it too),
// and `@objectstack/core` is the lowest package that carries the factory, so
// there is no reason to add a second import path to the same function.
import { recordNotFoundError } from '@objectstack/core';
import type { McpDataBridge, McpObjectSummary } from './mcp-http-tools.js';
import {
  diagnoseObjectListRead,
  type DiagnosedObjectListing,
} from './metadata-completeness.js';

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

// ---------------------------------------------------------------------------
// [#21207] The stored-metadata-body family, at this engine-only reader
// ---------------------------------------------------------------------------

/**
 * The combinators a filter nests conditions under — exactly the three the
 * filter contract declares (`$and` / `$or` / `$not`), the same set the
 * protocol's data door descends through when it collects the field names a
 * filter evaluates. Any other `$` key names no field of this object.
 */
const FILTER_LOGICAL_KEYS: ReadonlySet<string> = new Set(['$and', '$or', '$not']);

/**
 * Every key of a filter that NAMES A FIELD of the object being read, nested
 * combinators descended, structure discarded. A field key's value (an operator
 * bag, or a related object's condition) is not descended into: its keys are not
 * this object's fields. `depth` is a backstop against a self-referential
 * in-process `where`.
 */
function filterFieldKeys(where: unknown, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 32 || !where || typeof where !== 'object' || Array.isArray(where)) return out;
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key.startsWith('$')) {
      if (!FILTER_LOGICAL_KEYS.has(key)) continue;
      for (const arm of Array.isArray(value) ? value : [value]) filterFieldKeys(arm, out, depth + 1);
      continue;
    }
    out.push(key);
  }
  return out;
}

/**
 * Whether a field reference reaches the stored body column — the column itself,
 * or a dotted path whose HEAD segment is that column (a path into the body
 * evaluates the body just the same).
 */
function reachesStoredBody(field: unknown): boolean {
  return typeof field === 'string' && field.split('.')[0] === STORED_METADATA_BODY_COLUMN;
}

/** A refusal to evaluate the stored body column: an `Error` carrying the data door's envelope. */
export interface McpStoredMetadataBodyRefusal extends Error {
  /** ADR-0112 machine code — the one a refused field reference answers on every data door. */
  code: 'INVALID_FIELD';
  status: 400;
  field: string;
  fields: string[];
  object: string;
  /** Which part of the call named the body column. */
  param: 'groupBy' | 'filter' | 'sort' | 'aggregations';
}

/**
 * The refusal for a read of a stored-metadata-body table (`sys_metadata` /
 * `sys_metadata_history`) whose call would EVALUATE the stored body column
 * rather than serve it, or `undefined` when there is none to make.
 *
 * The stored body is served only as its type's read projection (see
 * {@link serveStoredMetadataRows}); a call that groups by it, filters or sorts
 * on it, or aggregates over it runs the engine against the STORED bytes, where
 * the projection cannot reach: a group key would be a whole stored body, a
 * predicate answers a guess about withheld credential material row by row, and
 * an order or an aggregate is computed over the same bytes. So each is refused
 * before the engine is asked — the posture the protocol's data door and the
 * analytics door take for the same column, in the same envelope:
 * `INVALID_FIELD` / 400, naming the field, the object and the offending part.
 *
 * Judged in the data door's order — grouping first, then filter, then sort —
 * with the aggregate members last. A filter is collected from the call's
 * `where` and from each aggregation's own `filter`.
 */
export function storedMetadataBodyRefusal(
  object: string,
  opts: {
    where?: unknown;
    orderBy?: ReadonlyArray<{ field?: unknown }>;
    groupBy?: ReadonlyArray<unknown>;
    aggregations?: ReadonlyArray<{ field?: unknown; filter?: unknown }>;
  },
): McpStoredMetadataBodyRefusal | undefined {
  if (!isStoredMetadataBodyObject(object)) return undefined;
  const make = (param: McpStoredMetadataBodyRefusal['param'], doing: string): McpStoredMetadataBodyRefusal => {
    const err = new Error(
      `Cannot ${doing} '${object}' by '${STORED_METADATA_BODY_COLUMN}' (${param}): the query was not run. `
        + `The '${STORED_METADATA_BODY_COLUMN}' column holds a stored metadata body, which this door serves only as `
        + `its type's read projection, with stored credential material withheld; ${doing === 'filter'
          ? 'a filter on it evaluates the stored body row by row, which would answer guesses about the withheld material'
          : `to ${doing} by it is to compute over the same stored bytes`}. `
        + `Use '${STORED_METADATA_TYPE_COLUMN}', 'name' or another scalar column instead, and read bodies with a plain query.`,
    ) as McpStoredMetadataBodyRefusal;
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.field = STORED_METADATA_BODY_COLUMN;
    err.fields = [STORED_METADATA_BODY_COLUMN];
    err.object = object;
    err.param = param;
    return err;
  };

  const groupFields = (opts.groupBy ?? []).map((entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as { field?: unknown }).field : entry,
  );
  if (groupFields.some(reachesStoredBody)) return make('groupBy', 'group');

  const aggregations = Array.isArray(opts.aggregations) ? opts.aggregations : [];
  const filterFields = [
    ...filterFieldKeys(opts.where),
    ...aggregations.flatMap((a) => filterFieldKeys(a?.filter)),
  ];
  if (filterFields.some(reachesStoredBody)) return make('filter', 'filter');

  const sortFields = (Array.isArray(opts.orderBy) ? opts.orderBy : []).map((entry) => entry?.field);
  if (sortFields.some(reachesStoredBody)) return make('sort', 'sort');

  if (aggregations.some((a) => reachesStoredBody(a?.field))) return make('aggregations', 'aggregate');
  return undefined;
}

/**
 * The field projection to hand the engine for a read of `object`, given the
 * caller's own.
 *
 * The body's redactor is chosen by the row's `type`, so a projection naming the
 * body column without the type column would leave nothing to choose with — the
 * body would then be withheld whole (fail-closed) rather than projected. The
 * type column is read too in that case, and `addedType` tells the caller to
 * take it back off the served rows, so the caller gets exactly the columns it
 * named: the data door's answer for the same projection. Every other
 * projection, and every object outside the family, passes through unchanged.
 */
export function storedMetadataBodyReadFields(
  object: string,
  fields: string[] | undefined,
): { fields: string[] | undefined; addedType: boolean } {
  if (!isStoredMetadataBodyObject(object) || !Array.isArray(fields)) return { fields, addedType: false };
  if (!fields.includes(STORED_METADATA_BODY_COLUMN) || fields.includes(STORED_METADATA_TYPE_COLUMN)) {
    return { fields, addedType: false };
  }
  return { fields: [...fields, STORED_METADATA_TYPE_COLUMN], addedType: true };
}

/**
 * Serve one row of `object` as read through the engine: on a stored-metadata-body
 * table its body becomes the body's type's read projection, through the family's
 * ONE projection (`redactStoredMetadataRow`, `@objectstack/spec/kernel`) — the
 * same object the protocol's data door and every `/meta` read serve, with stored
 * credential material withheld, and the body omitted when it cannot be judged.
 * Every other column, and every row of any other object, is returned as the
 * engine returned it. ⛔ A throwing redactor is not caught: the read fails
 * rather than serving what the projection exists to withhold.
 *
 * Exported within the package for the ADR-0101 record resource (`plugin.ts`),
 * the one read path on this transport that does not go through the bridge —
 * the reason {@link enforceApiExposure} is exported too.
 */
export function serveStoredMetadataRow<T>(object: string, row: T, opts?: { dropType?: boolean }): T {
  if (!isStoredMetadataBodyObject(object) || !row || typeof row !== 'object' || Array.isArray(row)) return row;
  const served = redactStoredMetadataRow(object, row) as Record<string, unknown>;
  if (opts?.dropType !== true) return served as T;
  const { [STORED_METADATA_TYPE_COLUMN]: _type, ...rest } = served;
  return rest as T;
}

/** {@link serveStoredMetadataRow} over the rows of one read. */
export function serveStoredMetadataRows(
  object: string,
  rows: Array<Record<string, unknown>>,
  opts?: { dropType?: boolean },
): Array<Record<string, unknown>> {
  if (!isStoredMetadataBodyObject(object)) return rows;
  return rows.map((row) => serveStoredMetadataRow(object, row, opts));
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

    /**
     * [#6504] `listObjects` with the completeness verdict attached, so the
     * `list_objects` tool can withhold `totalCount` on a known-partial read.
     *
     * The resolver above is reused rather than re-implemented: the items are
     * whatever `listObjects()` answers, and only the verdict is asked of
     * `listDiagnosed('object')` — see {@link diagnoseObjectListRead} for why
     * this composition, and not resolving the items through the diagnosed read,
     * is the correct one.
     */
    async listObjectsDiagnosed(): Promise<DiagnosedObjectListing<McpObjectSummary>> {
      const objects = await bridge.listObjects();
      const { degraded, errors } = await diagnoseObjectListRead(metadataService);
      return { objects, degraded, errors };
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
      // [#21207] After the exposure gate, before the engine: a filter or sort
      // on a stored metadata body is refused rather than evaluated.
      const bodyRefusal = storedMetadataBodyRefusal(object, { where: opts?.where, orderBy: opts?.orderBy });
      if (bodyRefusal) throw bodyRefusal;
      const read = storedMetadataBodyReadFields(object, opts?.fields);
      const query: Record<string, unknown> = {};
      if (opts?.where) query.where = opts.where;
      if (read.fields) query.fields = read.fields;
      if (opts?.orderBy) query.orderBy = opts.orderBy;
      if (typeof opts?.limit === 'number') query.limit = opts.limit;
      if (typeof opts?.offset === 'number') query.offset = opts.offset;
      const records = serveStoredMetadataRows(
        object,
        unwrapRows(await engine.find(object, query, { context })),
        { dropType: read.addedType },
      );
      return { object, records, total: records.length };
    },

    async get(object, id) {
      const context = await resolvePrincipal();
      await enforceApiExposure(metadataService, object, GATED_ACTIONS.get, context);
      // `null` rather than a throw: `get_record` owns the not-found wording on
      // this path and already branches on a nullish record.
      // [#21207] A stored metadata body is served as its type's projection.
      return serveStoredMetadataRow(object, await findById(engine, object, id, context));
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
      // Before the existence probe, not after: refusing on exposure vs. on a
      // miss is an observable difference, so gating second would answer "that
      // id names no row" for an object the author declared unexposed.
      await enforceApiExposure(metadataService, object, GATED_ACTIONS.update, context);
      const existing = await findById(engine, object, id, context);
      // The "this id names no row" refusal, raised BEFORE the write is
      // attempted — a write path that answered success for an id that matched
      // nothing is the #5138/#5581 defect the HTTP path already paid for: an
      // integrator reading a success receipt records the change as landed.
      // `registerObjectTools` turns a throw into a tool error, so the caller
      // is told. [commit 4810dd628] Throws the repo's ONE not-found envelope
      // (`recordNotFoundError`, `@objectstack/core`) rather than a bare
      // `Error`, so a stdio caller sees the same `RECORD_NOT_FOUND` / 404 the
      // HTTP bridge's `callData` path throws for the identical miss.
      if (!existing) throw recordNotFoundError(object, id);
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
      // Same shared envelope as `update`, above.
      if (!existing) throw recordNotFoundError(object, id);
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
      // [#21207] A grouping, filter or aggregate member on a stored metadata
      // body computes over the stored bytes, so it is refused, not run.
      const bodyRefusal = storedMetadataBodyRefusal(object, {
        where: opts?.where,
        groupBy: opts?.groupBy,
        aggregations: opts?.aggregations,
      });
      if (bodyRefusal) throw bodyRefusal;
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
