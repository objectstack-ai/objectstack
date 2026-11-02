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
 * ## Where an object's definition is read (#25138)
 *
 * From the protocol, as the HTTP bridge reads it since #25120: discovery
 * (`list_objects` / `describe_object`) from its MERGED listing, the read
 * `GET /api/v1/meta/object` serves, and the exposure gate from its by-name
 * read, the one `RestServer`'s own gate makes. The `metadata` service holds a
 * copy of an object only where something put one there, and on a kernel with
 * an `environmentId` nothing copies an object a package registers in the
 * `SchemaRegistry` during the boot; reading that copy listed none of them,
 * described none of them and gated none of them. See
 * {@link readObjectDeclaration} and {@link readMergedObjects}.
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
 * {@link storedMetadataBodyRefusal} and {@link serveStoredMetadataRows}.
 *
 * ⚠️ A THIRD limb was security as well: the EVALUATE positions of a field
 * declared `internal: true`. The engine omits such a field from every row, but
 * it still evaluates one named in a filter or a sort, and the protocol's data
 * door is where those positions are refused — for every caller, administrators
 * included, before the engine is asked. This engine-only bridge evaluated them.
 * `query` and `aggregate` now ask that door's ONE gate of the `protocol`
 * service before the engine ({@link refuseInternalFieldEvaluation}), so a
 * filter, a sort, a group key or an aggregation over such a field answers the
 * door's `400 INVALID_FIELD`, word for word, on this transport as on REST and
 * on the HTTP bridge. ⛔ Never a copy of that gate here: a second definition is
 * the fork this note exists to close. What remains of the divergence above is
 * genuinely not security.
 */

import { omitInternalFieldsFromWriteResponse, relationConditionSites } from '@objectstack/core';
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
// Managing API keys is a signed-in-session act: the one rule every data door
// asks beside its exposure gate (`RestServer.enforceApiAccess`, the runtime
// dispatcher's `refuseUnexposedDataAction`), asked here by the write arms.
import { apiKeyManagementCredentialRefusal } from '@objectstack/core';
// [#28715] The engine's own reading of "this field declares options" (its
// `label()` map is built from it), never a second spelling here.
import { declaresOptions } from '@objectstack/formula';
import type { McpDataBridge, McpObjectSummary } from './mcp-http-tools.js';
import { metaItemsArray, type McpObjectView } from './mcp-server-runtime.js';
import {
  diagnoseObjectListRead,
  type DiagnosedObjectListing,
} from './metadata-completeness.js';
import { staleSummaryRefusalOrThrow, withEarnedAnswer, type SummaryRecomputeRefusal } from '@objectstack/types';

/**
 * [#25138] The object reads this transport asks of the `protocol` service,
 * and the data door's internal-field gate beside them. Every member is optional: the slot is filled by name from a host-owned
 * registry, and a host may fill it with a partial object (the same duck-typed
 * probe `plugin.ts` applies to `getMetaItems` for the skill read).
 * `getMetaItemForExecution` is the server-only by-name face the REST exposure
 * gate and the HTTP bridge's gate read: no serving decorations, and the gate
 * reads a decision off it and serves none of it.
 */
export interface StdioProtocolObjectReads {
  /** The merged listing for one metadata type, `GET /api/v1/meta/TYPE`'s read. */
  getMetaItems?(request: { type: string }): Promise<unknown>;
  /** The by-name read, `GET /api/v1/meta/TYPE/NAME`'s. */
  getMetaItem?(request: { type: string; name: string }): Promise<unknown>;
  /** The by-name read without the serving decorations. */
  getMetaItemForExecution?(request: { type: string; name: string }): Promise<unknown>;
  /**
   * The data door's evaluate refusal for a field declared `internal: true`:
   * throws its `400 INVALID_FIELD` when `query` filters, sorts, groups or
   * aggregates on one, and returns otherwise. Not a read, but asked of the
   * same service at the same moment, so it rides this slot
   * ({@link refuseInternalFieldEvaluation}).
   */
  assertNoInternalFieldEvaluated?(object: string, query: Record<string, unknown>): void;
}

/** [#25138] Where this transport reads an object's definition from. */
export interface StdioObjectReads {
  /**
   * The metadata service: the copy the gate judges on an outage of the
   * protocol's by-name read, and every read on a host whose protocol has none.
   */
  metadataService: IMetadataService;
  /**
   * The `protocol` service, resolved at each use and `undefined` when this host
   * registers none. Never captured once at start: an absence read there is a
   * verdict the rest of the boot can still contradict.
   */
  protocol?: () => StdioProtocolObjectReads | undefined;
}

/** What {@link createStdioDataBridge} needs from the host plugin. */
export interface StdioDataBridgeDeps {
  /** The ObjectQL engine — the `objectql` service, where RLS/FLS/permissions run. */
  engine: IDataEngine;
  /**
   * The metadata service: `list_objects` / `describe_object` read it on a host
   * with no merged read, and the exposure gate on an outage of the by-name
   * read ({@link StdioObjectReads}).
   */
  metadataService: IMetadataService;
  /** [#25138] The `protocol` service, resolved at each use ({@link StdioObjectReads}). */
  protocol?: () => StdioProtocolObjectReads | undefined;
  /**
   * Re-resolve the stdio identity for THIS call and throw when it no longer
   * resolves (revoked / expired / owner-less key). Per call, never cached:
   * ADR-0101 D1 requires a revocation to take effect on the next read of a
   * live session, and a bridge built once at boot would outlive it.
   */
  resolvePrincipal: () => Promise<ExecutionContext>;
  /**
   * [#21207] The registered crypto provider's keyed digest
   * (`ICryptoProvider.keyedDigest`, reached through the engine's
   * `getKeyedDigest` accessor), read per call — a host registers the provider
   * after the kernel starts. `undefined`, or a resolver answering `undefined`,
   * means none: the stored content-hash columns are then not served at all.
   */
  keyedDigest?: () => StoredHashDigest | undefined;
}

/** The keyed-digest primitive the stored content-hash columns are served through. */
export type StoredHashDigest = (plain: string) => Promise<string>;

/** An object definition, as the protocol's object reads or `IMetadataService.getObject` hand it back. */
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
 * ABSENT: the HTTP bridge answers both from the protocol's merged listing
 * (the metadata service on a host with none) without touching `callData`, so
 * gating them here would be a NEW divergence pointing the other way (a schema
 * read refused on stdio and served on HTTP).
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
 * [#25138] Whether `err` is the protocol's refusal of an object whose owning
 * package is disabled: the one constructor `@objectstack/metadata-protocol`
 * raises from its by-name object reads and its data plane (`code`
 * `OBJECT_PACKAGE_DISABLED`, `status` 404, `object`). A refusal, not an outage
 * and not an absence: {@link readObjectDeclaration} throws it, where every
 * other read failure falls back to the copy, and {@link enforceApiExposure}
 * answers it.
 */
function isObjectPackageDisabledRefusal(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'OBJECT_PACKAGE_DISABLED';
}

/** The protocol behind `reads`, or `undefined` when this host registers none. */
function protocolOf(reads: StdioObjectReads): StdioProtocolObjectReads | undefined {
  return reads.protocol?.() ?? undefined;
}

/**
 * [#25138] The definition this transport judges and strips an object by: the
 * object, by name, through the protocol's MERGED read — the read the HTTP
 * bridge's gate makes since #25120 (`readExposureDeclaration`,
 * `packages/runtime/src/action-execution.ts`) and `RestServer`'s own exposure
 * gate makes (`enforceApiAccess`), on the execution face where the protocol has
 * one. The metadata service's copy is read only on a host whose protocol has no
 * by-name read: structural absence, answered as before.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * The gate read `IMetadataService.getObject(object)`, and an absent copy is "no
 * declaration", i.e. allowed. On a kernel with an `environmentId` nothing
 * copies into that service an object a package registers in the
 * `SchemaRegistry` during the boot, so such an object declared
 * `apiEnabled: false` was served on this transport: measured through the
 * `MCPServerPlugin` stdio session, `query_records` answered on that shape, and
 * the same object was refused `404 OBJECT_API_DISABLED` by REST and by the
 * HTTP bridge.
 *
 * ── Answers, by what the read returns ─────────────────────────────────────
 *
 * - the item under its own name → that definition;
 * - nothing, or an item under another name → `undefined`: no declared
 *   exposure policy, and the engine answers existence, as before;
 * - refused `OBJECT_PACKAGE_DISABLED` → that refusal, THROWN
 *   ({@link isObjectPackageDisabledRefusal}): a refusal, never an outage, so it
 *   never falls back to the copy;
 * - any other throw (the metadata store unreadable) → the metadata service's
 *   copy, the source this gate read before. An outage of the merged read must
 *   not WIDEN exposure: failing open at once would serve an object the copy
 *   still declares off.
 */
async function readObjectDeclaration(reads: StdioObjectReads, object: string): Promise<ObjectDef | undefined> {
  const readCopy = async () =>
    ((await reads.metadataService.getObject(object)) ?? undefined) as ObjectDef | undefined;
  const protocol = protocolOf(reads);
  const byName = typeof protocol?.getMetaItemForExecution === 'function'
    ? protocol.getMetaItemForExecution
    : typeof protocol?.getMetaItem === 'function' ? protocol.getMetaItem : undefined;
  if (!byName) return await readCopy();
  let envelope: unknown;
  try {
    envelope = await byName.call(protocol, { type: 'object', name: object });
  } catch (err) {
    if (isObjectPackageDisabledRefusal(err)) throw err;
    return await readCopy();
  }
  const item = (envelope as { item?: unknown } | null | undefined)?.item;
  return item !== null && typeof item === 'object' && (item as { name?: unknown }).name === object
    ? (item as ObjectDef)
    : undefined;
}

/**
 * [#25138] The objects `list_objects` and `describe_object` answer from: the
 * protocol's MERGED listing, the read `GET /api/v1/meta/object` serves and the
 * HTTP bridge answers both tools from since #25120 — never
 * `IMetadataService.listObjects()` / `getObject()`, which on a kernel with an
 * `environmentId` hold none of the objects a package registered during the
 * boot. Measured through the `MCPServerPlugin` stdio session on that shape:
 * `list_objects` answered `{ objects: [], totalCount: 0 }` and
 * `describe_object` "not found" for the package's objects, while REST listed
 * them.
 *
 * `undefined` = no merged read on this host (structural absence): both tools
 * then read the metadata service, exactly as before. A throw travels to the
 * caller, ⛔ never a fallback to the un-merged read, as on the HTTP bridge.
 */
async function readMergedObjects(reads: StdioObjectReads): Promise<ObjectDef[] | undefined> {
  const protocol = protocolOf(reads);
  if (!protocol || typeof protocol.getMetaItems !== 'function') return undefined;
  return metaItemsArray(await protocol.getMetaItems({ type: 'object' })) as ObjectDef[];
}

/**
 * [#25245] This transport's ONE reading of which objects exist and what each
 * declares: the protocol's merged listing ({@link readMergedObjects}), and a
 * name from that same listing, so a name the listing omits (a disabled
 * package's object among them) is absent on both reads. On a host with no
 * merged read, the metadata service's `listObjects()` / `getObject()`, as
 * before.
 *
 * Two consumers, so they cannot disagree: this bridge's `list_objects` /
 * `describe_object`, and the `objectstack://objects` resources, which
 * `plugin.ts` hands this view to `bridgeResources`. Those resources read the
 * metadata service until #25245, so on a kernel with an `environmentId` they
 * listed none of a package's boot-registered objects and answered `404` for
 * each, while the tools listed and described them.
 */
export function stdioObjectView(reads: StdioObjectReads): McpObjectView {
  return {
    async listObjects() {
      return (await readMergedObjects(reads)) ?? (((await reads.metadataService.listObjects()) ?? []) as ObjectDef[]);
    },
    async getObject(name) {
      const merged = await readMergedObjects(reads);
      return merged !== undefined
        ? merged.find((o) => o?.name === name)
        : (((await reads.metadataService.getObject(name)) ?? undefined) as ObjectDef | undefined);
    },
  };
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
 *  - **Unresolvable metadata FAILS OPEN.** A definition that cannot be read
 *    ({@link readObjectDeclaration} throwing past its own fallback to the copy)
 *    or that resolves nothing falls back to the schema defaults (`apiEnabled`
 *    true, no whitelist), matching `callData`'s `catch { def = undefined }` and
 *    `checkApiExposure`'s `if (!def) return { allowed: true }`. The fail-open is
 *    safe for the reason ADR/#3545 records: this is surface area, and the
 *    engine's CRUD/FLS/RLS still runs on the call regardless of the outcome
 *    here.
 *  - **The flat shape is still read.** `getObject()` returns the flags nested
 *    under `.enable`, but `checkApiExposure` falls back to a flat top level for
 *    legacy/test doubles. Reading only the nested shape here would let a flat
 *    definition be gated on HTTP and ungated on stdio — the very divergence
 *    this function closes, re-opened one shape down.
 *  - **[#25138] A disabled package's object is REFUSED**, whatever it
 *    declares, with the protocol's own error (`404 OBJECT_PACKAGE_DISABLED`,
 *    thrown by its by-name read), never read as "no declaration". Every verb of
 *    this bridge asks the engine and never the protocol, and the engine serves
 *    a disabled package's objects: this is the posture `callData` takes on all
 *    six of its arms since #25120, for the one of them (`aggregate`) that is
 *    engine-only too. A nested-relation condition's target of such a package is
 *    refused the same way: the engine would read it to lower the condition.
 *
 * [#22777] `condition` is set when `object` is not addressed but is the TARGET
 * of a nested-relation condition at that filter position
 * ({@link enforceRelationTargetExposure}); the refusal then names the position
 * and the way out, as the data door's does for the same condition.
 */
export async function enforceApiExposure(
  reads: StdioObjectReads,
  object: string,
  action: string,
  context: ExecutionContext,
  condition?: string,
): Promise<void> {
  if (context?.isSystem) return;

  let def: ObjectDef | null | undefined;
  try {
    def = await readObjectDeclaration(reads, object);
  } catch (err) {
    // [#25138] A refusal, never a read failure to fall open on.
    if (isObjectPackageDisabledRefusal(err)) throw err;
    def = undefined; // fall open to the schema defaults
  }
  if (!def) return;

  const enable = (
    def.enable && typeof def.enable === 'object' ? def.enable : def
  ) as unknown as EnableLike;
  const consequence = condition === undefined
    ? ''
    : `, so the condition on it at '${condition}' was not evaluated and the query was not run. `
      + 'Filter on the lookup\'s stored id instead, or remove the condition.';

  if (enable.apiEnabled === false) {
    throw exposureError(
      `Object '${object}' is not exposed via the API${consequence}`,
      OBJECT_API_DISABLED,
      404,
    );
  }

  const eff = resolveEffectiveApiMethods(enable);
  if (eff.mode === 'unrestricted') return;

  const operation = DATA_ACTION_TO_API_OPERATION[action] ?? action;
  if (isApiOperationAllowed(eff, operation)) return;

  throw exposureError(
    `API operation '${operation}' is not allowed on object '${object}'${consequence}`,
    OBJECT_API_METHOD_NOT_ALLOWED,
    405,
    effectiveOperationsArray(eff),
  );
}

/**
 * [#22777] A NESTED-RELATION condition in the caller's filter is evaluated on
 * its TARGET object: the engine lowers it by reading the target as the caller
 * (`ObjectQL.lowerRelationConditions`) and keeps the rows whose related record
 * matched. So each condition's target is asked {@link enforceApiExposure}'s
 * decision for {@link GATED_ACTIONS}`.query` — `list`, because a condition is a
 * predicate over the whole target, the read the target's own filtered query
 * performs — and an unserved target REFUSES the call: dropping the condition
 * would widen the result. The data door asks the same of the same sites
 * (`refuseUnservedRelationTarget`), found by the one walk both doors import
 * (`relationConditionSites`). One hop, as the engine serves one: a relation
 * beneath a condition is refused by the engine before anything is read.
 */
async function enforceRelationTargetExposure(
  reads: StdioObjectReads,
  object: string,
  where: unknown,
  context: ExecutionContext,
): Promise<void> {
  if (where == null) return;
  let def: ObjectDef | null | undefined;
  try {
    // [#25138] The field map from the definition the gate judged, so a
    // package object's relation conditions are found where it has no copy.
    def = await readObjectDeclaration(reads, object);
  } catch {
    def = undefined; // no field map, no site: the gate above falls open the same way
  }
  for (const site of relationConditionSites(def?.fields, where)) {
    await enforceApiExposure(reads, site.target, GATED_ACTIONS.query, context, `where.${site.field}`);
  }
}

/**
 * The data door's evaluate refusal for a field declared `internal: true`,
 * asked of the `protocol` service before the engine reads anything: the
 * protocol's own `assertNoInternalFieldEvaluated`, the gate `findData` asks
 * for REST and for the HTTP bridge's `query_records` — ⛔ never a copy of it
 * here (route-ownership rule 1). It throws that door's `400 INVALID_FIELD`,
 * naming the object, the field and the position in the door's own sentence,
 * for a filter (`where`, each aggregation's own `filter`, a nested-relation
 * condition judged on its target), a sort, a group key or an aggregation
 * operand on such a field — for every principal this transport admits. A
 * query over ordinary fields passes untouched.
 *
 * Asked whatever the caller's context, as the door asks it: the engine's
 * privileged lookups that legitimately match on such a field call the engine
 * directly and never reach this bridge.
 *
 * Structural absence answers nothing: on a host that registers no protocol,
 * or one whose protocol has no such face, there is no data door whose verdict
 * this transport could match, and the call proceeds to the engine as before.
 * An object the protocol's registry does not hold is likewise left to the
 * engine's existence answer, as the door leaves it.
 */
function refuseInternalFieldEvaluation(
  reads: StdioObjectReads,
  object: string,
  query: Record<string, unknown>,
): void {
  const protocol = protocolOf(reads);
  if (typeof protocol?.assertNoInternalFieldEvaluated !== 'function') return;
  protocol.assertNoInternalFieldEvaluated(object, query);
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
 * [#21207] The stored CONTENT-HASH columns of the same two tables: `checksum`
 * (both) and the history table's `previous_checksum` (the parent's hash).
 *
 * Each is the canonical SHA-256 of the WHOLE stored body — withheld credential
 * material included — kept as-is at rest. The engine returns it as stored, so
 * this engine-only reader served it raw beside the projected body: an offline
 * verifier for a guess at the withheld material, and an online one when
 * filtered on. Per the maintainer's ruling on #21207 this transport serves the
 * crypto provider's KEYED digest of it ({@link serveStoredMetadataHashes}) and
 * refuses to evaluate it ({@link storedMetadataHashRefusal}) — the protocol
 * data door's answer for the same columns
 * (`@objectstack/metadata-protocol`'s `STORED_METADATA_HASH_COLUMNS`, which this
 * package cannot import; `stored-metadata-body-family.pin.test.ts` pins the
 * list to the object definitions).
 */
export const STORED_METADATA_HASH_COLUMNS: readonly string[] = Object.freeze(['checksum', 'previous_checksum']);

/**
 * [#21207] The history table's change note, which can QUOTE a stored content
 * hash (`publish draft (hash …)` on rows written before the publish door stated
 * its own message): served with each quote in its served form, never evaluated.
 */
export const STORED_METADATA_HASH_NOTE_COLUMN = 'change_note';

/** Every column that holds or can quote a stored content hash. */
const HASH_BEARING_COLUMNS: readonly string[] = [...STORED_METADATA_HASH_COLUMNS, STORED_METADATA_HASH_NOTE_COLUMN];

/** An unkeyed content hash quoted in free text (the keyed form's `hmac-sha256:` prefix is not one). */
const QUOTED_STORED_HASH = /(?<![\w-])sha256:[0-9a-f]{64}/g;

/** Free text with each quoted stored hash keyed, or `(withheld)` with no provider. */
async function serveStoredHashTokens(text: string, digest: StoredHashDigest | undefined): Promise<string> {
  const quoted = text.match(QUOTED_STORED_HASH);
  if (!quoted) return text;
  const served = new Map<string, string>();
  for (const stored of new Set(quoted)) served.set(stored, digest ? await digest(stored) : '(withheld)');
  return text.replace(QUOTED_STORED_HASH, (stored) => served.get(stored) as string);
}

/** The hash-bearing column a field reference reaches — the column, or a dotted path headed by it. */
function hashColumnOf(field: unknown): string | undefined {
  if (typeof field !== 'string') return undefined;
  const head = field.split('.')[0] as string;
  return HASH_BEARING_COLUMNS.includes(head) ? head : undefined;
}

/**
 * [#21207] The refusal for a read of a stored-metadata table whose call would
 * EVALUATE a content-hash column — a grouping (whose keys would serve the
 * stored values), a filter (a guessed hash matches its row) or a sort — or
 * `undefined` when none is named. Same envelope as
 * {@link storedMetadataBodyRefusal} (`INVALID_FIELD` / 400, naming the field,
 * the object and the part), judged in the same order, and naming the columns
 * that remain usable.
 */
export function storedMetadataHashRefusal(
  object: string,
  opts: {
    where?: unknown;
    orderBy?: ReadonlyArray<{ field?: unknown }>;
    groupBy?: ReadonlyArray<unknown>;
    aggregations?: ReadonlyArray<{ field?: unknown; filter?: unknown }>;
  },
): McpStoredMetadataBodyRefusal | undefined {
  if (!isStoredMetadataBodyObject(object)) return undefined;
  const make = (param: 'groupBy' | 'filter' | 'sort', column: string): McpStoredMetadataBodyRefusal => {
    const doing = param === 'groupBy' ? 'group' : param;
    const err = new Error(
      `Cannot ${doing} '${object}' by '${column}' (${param}): the query was not run. The '${column}' column `
        + `${column === STORED_METADATA_HASH_NOTE_COLUMN ? 'can quote' : 'holds'} `
        + `the stored content hash of a metadata body, computed over withheld credential material too, so this door `
        + `serves it only in keyed form; ${param === 'filter'
          ? 'a filter on it compares a guess against the stored hash row by row, which confirms the guess'
          : param === 'groupBy' ? 'a group key would serve the stored value itself' : 'a sort on it orders by the stored values'}. `
        + `Use '${STORED_METADATA_TYPE_COLUMN}', 'name', 'state' or another scalar column instead.`,
    ) as McpStoredMetadataBodyRefusal;
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.field = column;
    err.fields = [column];
    err.object = object;
    err.param = param;
    return err;
  };
  for (const entry of opts.groupBy ?? []) {
    const column = hashColumnOf(
      entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as { field?: unknown }).field : entry,
    );
    if (column) return make('groupBy', column);
  }
  const aggregations = Array.isArray(opts.aggregations) ? opts.aggregations : [];
  for (const field of [...filterFieldKeys(opts.where), ...aggregations.flatMap((a) => filterFieldKeys(a?.filter))]) {
    const column = hashColumnOf(field);
    if (column) return make('filter', column);
  }
  for (const entry of Array.isArray(opts.orderBy) ? opts.orderBy : []) {
    const column = hashColumnOf(entry?.field);
    if (column) return make('sort', column);
  }
  return undefined;
}

/**
 * [#21207] Serve one row of `object` with its stored content-hash columns in
 * their served form: each the keyed digest of the stored value, a `null` kept
 * `null` — and both columns OMITTED when no crypto provider is registered. ⛔
 * Never the stored value. Rows of every other object, and rows carrying
 * neither column, are returned by reference. A failing digest is not caught:
 * the read fails rather than serving what it exists to replace.
 *
 * Exported within the package for the ADR-0101 record resource (`plugin.ts`),
 * which serves through the same helpers as `bridge.get`.
 */
export async function serveStoredMetadataHashes<T>(
  object: string,
  row: T,
  digest: StoredHashDigest | undefined,
): Promise<T> {
  if (!isStoredMetadataBodyObject(object) || !row || typeof row !== 'object' || Array.isArray(row)) return row;
  const record = row as Record<string, unknown>;
  if (!HASH_BEARING_COLUMNS.some((column) => column in record)) return row;
  const out: Record<string, unknown> = { ...record };
  for (const column of STORED_METADATA_HASH_COLUMNS) {
    if (!(column in out)) continue;
    const stored = out[column];
    if (!digest || (stored !== null && typeof stored !== 'string')) delete out[column];
    else out[column] = stored === null ? null : await digest(stored);
  }
  const note = out[STORED_METADATA_HASH_NOTE_COLUMN];
  if (typeof note === 'string') out[STORED_METADATA_HASH_NOTE_COLUMN] = await serveStoredHashTokens(note, digest);
  return out as T;
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
 * The API-key management rule on this transport: a write to `sys_api_key` is
 * refused `403 PERMISSION_DENIED` (`apiKeyManagementCredentialRefusal`,
 * `@objectstack/core`, whose docblock carries the rule), thrown as the error
 * the tool layer renders, like the exposure refusals beside it.
 *
 * The credential is `'api_key'` by construction: this transport admits its
 * principal from `OS_MCP_STDIO_API_KEY` and from nothing else (ADR-0101,
 * `resolveStdioExecutionContext` in `plugin.ts`), and the envelope carries no
 * credential to read. That principal is never the system context, so the rule
 * reads no elevation flag: it has none to grant. Asked after the exposure
 * gate, so an operation the object does not expose keeps its `405`, and before
 * the engine is asked anything.
 */
function enforceApiKeyManagementCredential(object: string, action: string): void {
  const refusal = apiKeyManagementCredentialRefusal({ object, operation: action, credential: 'api_key' });
  if (refusal) throw refusal;
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
  const { engine, metadataService, protocol, resolvePrincipal, keyedDigest } = deps;
  // [#25138] One definition source for the gate, the relation-target gate and
  // the write-response strip, and one listing for discovery.
  const reads: StdioObjectReads = { metadataService, protocol };
  // [#25245] …and that listing is the view the object resources read too.
  const objectView = stdioObjectView(reads);

  const bridge: McpDataBridge = {
    async listObjects(): Promise<McpObjectSummary[]> {
      // [#25138] The protocol's merged listing ({@link readMergedObjects}).
      return ((await objectView.listObjects()) as ObjectDef[]).map((o) => ({
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

    // [#25138] Answered from the listing `list_objects` serves
    // ({@link readMergedObjects}), so every object an agent is listed it can
    // describe, and a name the listing omits (a disabled package's object among
    // them) is "not found" here too, as on the HTTP bridge.
    async describeObject(name: string): Promise<unknown | null> {
      const def = (await objectView.getObject(name)) as ObjectDef | undefined;
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

    // [#28715] From the object `describeObject` reads: the protocol's served
    // object, where a picklist-bound field carries its list's resolved
    // `options`, so the served-form predicate is the one that matches.
    async optionFieldsOf(name: string): Promise<readonly string[] | null> {
      const def = (await objectView.getObject(name)) as ObjectDef | undefined;
      if (!def) return null;
      return Object.entries(def.fields ?? {})
        .filter(([, f]) => declaresOptions(f))
        .map(([key]) => key);
    },

    async query(object, opts) {
      const context = await resolvePrincipal();
      await enforceApiExposure(reads, object, GATED_ACTIONS.query, context);
      // [#22777] …and each nested-relation condition's target, before the engine reads it.
      await enforceRelationTargetExposure(reads, object, opts?.where, context);
      // [#21207] After the exposure gate, before the engine: a filter or sort
      // on a stored metadata body is refused rather than evaluated.
      const bodyRefusal = storedMetadataBodyRefusal(object, { where: opts?.where, orderBy: opts?.orderBy });
      if (bodyRefusal) throw bodyRefusal;
      // [#21207] …and the same for a stored content-hash column.
      const hashRefusal = storedMetadataHashRefusal(object, { where: opts?.where, orderBy: opts?.orderBy });
      if (hashRefusal) throw hashRefusal;
      // …and a filter or sort on an `internal: true` field, by the data door's
      // own gate, after the stored-metadata refusals as the door orders them.
      refuseInternalFieldEvaluation(reads, object, { where: opts?.where, orderBy: opts?.orderBy });
      const read = storedMetadataBodyReadFields(object, opts?.fields);
      const query: Record<string, unknown> = {};
      if (opts?.where) query.where = opts.where;
      if (read.fields) query.fields = read.fields;
      if (opts?.orderBy) query.orderBy = opts.orderBy;
      if (typeof opts?.limit === 'number') query.limit = opts.limit;
      if (typeof opts?.offset === 'number') query.offset = opts.offset;
      // [#21207] The content-hash columns are served keyed, or not at all.
      const digest = keyedDigest?.();
      const records = await Promise.all(
        serveStoredMetadataRows(object, unwrapRows(await engine.find(object, query, { context })), {
          dropType: read.addedType,
        }).map((row) => serveStoredMetadataHashes(object, row, digest)),
      );
      return { object, records, total: records.length };
    },

    async get(object, id) {
      const context = await resolvePrincipal();
      await enforceApiExposure(reads, object, GATED_ACTIONS.get, context);
      // `null` rather than a throw: `get_record` owns the not-found wording on
      // this path and already branches on a nullish record.
      // [#21207] A stored metadata body is served as its type's projection,
      // and its stored content hash keyed (or not at all).
      return serveStoredMetadataHashes(
        object,
        serveStoredMetadataRow(object, await findById(engine, object, id, context)),
        keyedDigest?.(),
      );
    },

    async create(object, data) {
      const context = await resolvePrincipal();
      await enforceApiExposure(reads, object, GATED_ACTIONS.create, context);
      enforceApiKeyManagementCredential(object, GATED_ACTIONS.create);
      // [#28782] A record stored under a parent roll-up the engine could not
      // recompute (`ERR_SUMMARY_RECOMPUTE`, carrying `written`) builds this
      // bridge's answer and carries it on the refusal (#28781's carrier), so
      // the `create_record` tool answers the create it is.
      let stale: SummaryRecomputeRefusal | undefined;
      let written: Record<string, unknown> | undefined;
      try {
        written = (await engine.insert(object, data, { context })) as Record<string, unknown> | undefined;
      } catch (e) {
        stale = staleSummaryRefusalOrThrow(e);
        written = stale.written as Record<string, unknown> | undefined;
      }
      const record = { ...data, ...(written ?? {}) };
      // [#8497] `written` is the engine's WRITE result, which since #7823 keeps
      // the stored row whole — flagged columns included. This is a generic data
      // mouth answering an external caller, so it owns the response-body half
      // of the `internal: true` guarantee (#7728) exactly as the protocol
      // ingress and the REST batch arm do. Measured before the fix: a create
      // returned `vault_secret` verbatim in `record`.
      // [#25138] By the definition the gate judged: the metadata service's copy
      // is absent for a package's boot-registered object on an `environmentId`
      // kernel, and with no schema the helper masks and omits nothing.
      omitInternalFieldsFromWriteResponse(await readObjectDeclaration(reads, object), record);
      const answer = { object, id: record.id, record };
      if (stale) throw withEarnedAnswer(stale, answer);
      return answer;
    },

    async update(object, id, data) {
      const context = await resolvePrincipal();
      // Before the existence probe, not after: refusing on exposure vs. on a
      // miss is an observable difference, so gating second would answer "that
      // id names no row" for an object the author declared unexposed.
      await enforceApiExposure(reads, object, GATED_ACTIONS.update, context);
      enforceApiKeyManagementCredential(object, GATED_ACTIONS.update);
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
      // [#28844] An update the engine applied but whose parent roll-up it could
      // not recompute (`ERR_SUMMARY_RECOMPUTE`) answers the update it is,
      // attached to the refusal by #28781's carrier as `create` does; every
      // other throw, a refusal before the write among them, propagates as is.
      let stale: SummaryRecomputeRefusal | undefined;
      try {
        await engine.update(object, data, { where: { id }, context });
      } catch (e) {
        stale = staleSummaryRefusalOrThrow(e);
      }
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
      omitInternalFieldsFromWriteResponse(await readObjectDeclaration(reads, object), record);
      const answer = { object, id, record };
      if (stale) throw withEarnedAnswer(stale, answer);
      return answer;
    },

    async remove(object, id) {
      const context = await resolvePrincipal();
      // Gated before the probe, for the reason `update` states.
      await enforceApiExposure(reads, object, GATED_ACTIONS.remove, context);
      enforceApiKeyManagementCredential(object, GATED_ACTIONS.remove);
      const existing = await findById(engine, object, id, context);
      // Same shared envelope as `update`, above.
      if (!existing) throw recordNotFoundError(object, id);
      // [#28844] As `update`, above: a delete applied under a failing roll-up
      // answers the delete it is.
      let stale: SummaryRecomputeRefusal | undefined;
      try {
        await engine.delete(object, { where: { id }, context });
      } catch (e) {
        stale = staleSummaryRefusalOrThrow(e);
      }
      // `success`, not `deleted` — the spec's `DeleteDataResponse` key (#5581).
      const answer = { object, id, success: true };
      if (stale) throw withEarnedAnswer(stale, answer);
      return answer;
    },
  };

  if (typeof engine.aggregate === 'function') {
    bridge.aggregate = async (object, opts) => {
      const context = await resolvePrincipal();
      // `aggregate` is a list-class read: an object whose whitelist excludes
      // `list` must not leak row statistics through GROUP BY either. The
      // derivation lives in the spec helpers, so that holds here for free.
      await enforceApiExposure(reads, object, GATED_ACTIONS.aggregate, context);
      // [#22777] …and each nested-relation condition's target, as `query` asks it.
      await enforceRelationTargetExposure(reads, object, opts?.where, context);
      // [#21207] A grouping, filter or aggregate member on a stored metadata
      // body computes over the stored bytes, so it is refused, not run.
      const bodyRefusal = storedMetadataBodyRefusal(object, {
        where: opts?.where,
        groupBy: opts?.groupBy,
        aggregations: opts?.aggregations,
      });
      if (bodyRefusal) throw bodyRefusal;
      // [#21207] …and a grouping or filter on a stored content-hash column.
      const hashRefusal = storedMetadataHashRefusal(object, {
        where: opts?.where,
        groupBy: opts?.groupBy,
        aggregations: opts?.aggregations,
      });
      if (hashRefusal) throw hashRefusal;
      // …and a filter (`where` or an aggregation's own), a group key or an
      // aggregation operand on an `internal: true` field, by the data door's
      // own gate ({@link refuseInternalFieldEvaluation}).
      refuseInternalFieldEvaluation(reads, object, {
        where: opts?.where,
        groupBy: opts?.groupBy,
        aggregations: opts?.aggregations,
      });
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
