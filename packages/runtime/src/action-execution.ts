// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Action-execution subsystem — extracted dispatcher helpers (ADR-0076 D11
 * step ③, PR-8). The shared machinery behind server-registered business
 * actions: declaration collection/resolution, param enforcement
 * (ADR-0104), permission/exposure gates, the engine facade + session shape
 * handlers receive, invocation, and the `callData` protocol/ObjectQL data
 * bridge. Consumed by the `/actions` domain and the MCP bridge (tool
 * invocation path) — extracting it is what turns those two domains into
 * mechanical extractions (PR-9).
 *
 * Depends only on {@link ActionExecutionDeps} — a narrow slice of the
 * domain deps contract. NO env-resolution state (kernel/resolver) lives
 * here; that stays with the route handlers.
 */

import { validateActionParams, type ActionSession, type ResolvedActionParam } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IObjectQLEngine, ServiceSlotContract, ServiceSlotContracts } from '@objectstack/spec/contracts';
import { checkApiExposure } from './api-exposure.js';
// [#9446] The ONE #9378 status table. Imported rather than re-read here: this
// door's blanket `FLOW_FAILED` was the second of three readings of one engine
// result, and a second definition of the rule is what let the doors diverge.
import {
    classifyFlowRefusal,
    flowIsUnknown,
    flowNotFoundMessage,
    FLOW_NOT_FOUND_STATUS,
    type FlowRefusalCode,
} from './flow-dispatch-status.js';
import type { FlowRunSummary } from '@objectstack/spec/automation';
// [#5138] The ONE 404 envelope a single-record path answers. Imported rather
// than re-spelled so `callData`'s ObjectQL fallback and the protocol service it
// falls back FROM cannot disagree about what "this id names no row" looks like.
// A pure factory — no service resolution — so importing it costs the fallback
// nothing on an assembly where the protocol plugin is absent, which is exactly
// when the fallback runs.
import { recordNotFoundError } from '@objectstack/metadata-protocol';
import { actorUserFromExecutionContext, resolveActorDisplayName } from './security/actor-user.js';
import type { HttpProtocolContext } from './http-dispatcher.js';
import {
    GLOBAL_ACTION_OBJECT_KEY,
    actionHandlerObjectKeys,
    isObjectLessActionKey,
    reconcileActionRegistrations as reconcileActionRegistrationsPure,
    resolveActionHandlerKeys,
    standaloneActionOwnerKey,
} from '@objectstack/objectql';

// [ADR-0110] The addressing vocabulary and the D5 reconciliation moved to
// @objectstack/objectql (the engine owns the map they describe, and its
// plugin now runs the boot inventory — AppPlugin, the previous host, is
// registered conditionally and never ran it on the `os dev` path). Runtime
// re-exports them so dispatch, the MCP bridge and existing importers keep
// reading the ONE implementation.
export {
    GLOBAL_ACTION_OBJECT_KEY,
    actionHandlerObjectKeys,
    isObjectLessActionKey,
    resolveActionHandlerKeys,
    standaloneActionOwnerKey,
};

/** A `sys_`-prefixed object is a system table — off-limits to external MCP agents. */
export function isSystemObjectName(name: string): boolean {
    return /^sys_/i.test(name);
}

/**
 * Escape hatch: accept param bags that violate the declared contract, the way
 * the pre-17 dispatcher did (ADR-0104 D2, 2026-07-30 addendum).
 *
 * Enforcement is the default. This exists for the operator whose integration
 * hits an unforeseen rejection and needs it dispatching again before they can
 * reach the caller's code — the violation still logs, so setting this makes the
 * drift tolerated, not invisible.
 *
 * Spelled `OS_ALLOW_*` per Prime Directive #9 and ADR-0110 D6: an opt-OUT of a
 * check that ships on, never an opt-IN to a check that ships off.
 */
function laxActionParams(): boolean {
    return typeof process !== 'undefined' && process.env?.OS_ALLOW_LAX_ACTION_PARAMS === '1';
}


const _warnedActionParams = new Set<string>();
function warnActionParamsOnce(key: string, message: string): void {
    if (_warnedActionParams.has(key)) return;
    _warnedActionParams.add(key);
    console.warn(message);
}

/**
 * The dispatcher facilities the action subsystem may touch.
 *
 * [#4127 batch 4] `resolveService` is split the same way as the one on
 * `DomainHandlerDeps`. This is a NARROWER re-declaration of the same facility
 * and it kept returning `any` after the main one stopped — the third copy of
 * the pattern, alongside `ResolveOptions` in security/resolve-execution-context.
 * A lookup facade has to be typed everywhere it is re-declared, or the copy
 * that still says `any` becomes the way around all the others.
 *
 * [#5155] Both lookups take the REQUEST as their first parameter, for the
 * reason spelled out on `DomainHandlerDeps` (of which this is the narrow view
 * `HttpDispatcher.actionExecutionDeps` hands out): the object is shared by
 * every request the host serves, so the kernel to resolve against is the
 * request's, never the facade's.
 */
export interface ActionExecutionDeps {
    resolveService<K extends keyof ServiceSlotContracts>(context: HttpProtocolContext, name: K, environmentId?: string): Promise<ServiceSlotContract<K> | undefined>;
    resolveService(context: HttpProtocolContext, name: string, environmentId?: string): any;
    getObjectQL(context: HttpProtocolContext, environmentId?: string): Promise<IObjectQLEngine | null>;
}

/**
 * Direct data service dispatch — replaces broker.call('data.*').
 * Tries protocol service first (supports expand/populate), falls back to ObjectQL.
 *
 * @param requestContext - The request being served (#5155). Carries the kernel
 *   every service lookup below resolves against; see
 *   {@link HttpProtocolContext.kernel}.
 * @param dataDriver - Optional environment-scoped driver to use instead of kernel default
 * @param scopeId - Optional project ID for scoped service resolution (SharedProjectPlugin mode)
 */
export async function callData(deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    action: string,
    params: any,
    dataDriver?: any,
    scopeId?: string,
    executionContext?: ExecutionContext,
): Promise<any> {
    // ── Object-level API exposure gate (ADR-0049, #1889) ─────
    // Honour the object's `apiEnabled` / `apiMethods` declarations for
    // external traffic. System/internal contexts bypass — these flags
    // govern API *exposure*, not internal engine self-writes.
    if (!executionContext?.isSystem && params?.object) {
        let def: any;
        try {
            const meta = await deps.resolveService(requestContext, 'metadata', scopeId);
            def = await (meta as any)?.getObject?.(params.object);
        } catch {
            def = undefined; // fall open to schema defaults (apiEnabled=true)
        }
        const gate = checkApiExposure(def, action);
        if (!gate.allowed) {
            throw { statusCode: gate.status ?? 403, message: gate.reason ?? 'API access denied' };
        }
    }

    const protocol = await deps.resolveService(requestContext, 'protocol', scopeId);
    const qlService = dataDriver ?? await deps.getObjectQL(requestContext, scopeId);
    const ql = qlService ?? await deps.resolveService(requestContext, 'objectql', scopeId);
    const qlOpts = executionContext ? { context: executionContext } : undefined;
    const findOpts = (extra?: any) => {
        const base = qlOpts ? { ...qlOpts } : {};
        return extra ? { ...base, ...extra } : (qlOpts ? base : undefined);
    };

    if (action === 'create') {
        // Prefer the protocol service (validations + RLS + audit), mirroring
        // the read paths below. The MCP bridge passes `context.dataDriver` as
        // `ql`, which in the multi-env runtime is a RAW db driver with no ORM
        // `insert` — so going straight to `ql.insert` broke MCP create_record
        // ("ql.insert is not a function") while REST (which uses `createData`)
        // worked. Routing writes through the protocol keeps them aligned.
        if (protocol && typeof protocol.createData === 'function') {
            return await protocol.createData({ object: params.object, data: params.data, ...(scopeId ? { environmentId: scopeId } : {}), context: executionContext });
        }
        if (ql && typeof ql.insert === 'function') {
            const res = await ql.insert(params.object, params.data, qlOpts);
            const record = { ...params.data, ...res };
            return { object: params.object, id: record.id, record };
        }
        throw { statusCode: 503, message: 'Data service not available' };
    }

    if (action === 'get') {
        if (protocol && typeof protocol.getData === 'function') {
            return await protocol.getData({ object: params.object, id: params.id, expand: params.expand, select: params.select, context: executionContext });
        }
        if (ql) {
            let all = await ql.find(params.object, findOpts({ where: { id: params.id }, limit: 1 }));
            if (all && (all as any).value) all = (all as any).value;
            if (!all) all = [];
            const match = (all as any[]).find((i: any) => i.id === params.id);
            // [#5138] Was `: null` — a miss resolved, and `/data` wrapped it as
            // `200 { data: null }`. The protocol path this falls back from has
            // answered `404 RECORD_NOT_FOUND` since #4435, so the same GET
            // answered 200 or 404 depending only on whether the deployment
            // registered the protocol slot — a difference the caller cannot see
            // and never asked for.
            if (!match) throw recordNotFoundError(params.object, params.id);
            return { object: params.object, id: params.id, record: match };
        }
        throw { statusCode: 503, message: 'Data service not available' };
    }

    if (action === 'update') {
        if (protocol && typeof protocol.updateData === 'function') {
            return await protocol.updateData({ object: params.object, id: params.id, data: params.data, ...(scopeId ? { environmentId: scopeId } : {}), context: executionContext });
        }
        if (ql && params.id && typeof ql.update === 'function') {
            let all = await ql.find(params.object, findOpts({ where: { id: params.id }, limit: 1 }));
            if (all && (all as any).value) all = (all as any).value;
            if (!all) all = [];
            const existing = (all as any[]).find((i: any) => i.id === params.id);
            // [#5138] Was `throw new Error('[ObjectStack] Not Found')`. That
            // error carried neither `.status` nor `.statusCode`, so BOTH
            // dispatcher exits fell through to their 500 fallback
            // (`HttpDispatcher.errorFromThrown`, `dispatcher-plugin`'s
            // `errorResponseBase`, and the endpoint executor's `errorAnswer`
            // all read `.status` → `.statusCode` → 500). A caller mistake was
            // reported as an internal fault and taken to the error reporter
            // with it.
            if (!existing) throw recordNotFoundError(params.object, params.id);
            await ql.update(params.object, params.data, findOpts({ where: { id: params.id } }));
            return { object: params.object, id: params.id, record: { ...existing, ...params.data } };
        }
        throw { statusCode: 503, message: 'Data service not available' };
    }

    if (action === 'delete') {
        if (protocol && typeof protocol.deleteData === 'function') {
            return await protocol.deleteData({ object: params.object, id: params.id, ...(scopeId ? { environmentId: scopeId } : {}), context: executionContext });
        }
        if (ql && typeof ql.delete === 'function') {
            // [#5138] There was NO existence check here: the delete ran and the
            // answer was `200 { deleted: true }` for any string in the path, so
            // a typo'd id, an already-deleted row and a real deletion were
            // indistinguishable — the exact shape #4435 removed from the
            // protocol's `deleteData`, still live on the path that stands in
            // for it. The "assume it worked" answer is the worst of the three
            // this fallback gave, because an integrator reading 200 records the
            // cleanup as done.
            //
            // The existence PROBE is a `find`, not a read of what `ql.delete`
            // returned. `deleteData` can read its result because `IDataDriver.
            // delete` declares `Promise<boolean>` ("true if deleted, false if
            // not found"); `ql` here is the ObjectQL ENGINE (or, on the MCP
            // multi-env path, a raw driver), and `IDataEngine.delete` declares
            // `Promise<any>` — the engine passes its driver's result through
            // the hook chain and returns `opCtx.result`. Testing that for
            // `=== false` would be reading a signal the contract does not
            // promise, which fails silently in the direction this issue is
            // about: back to reporting a delete that removed nothing. The probe
            // is the same one the sibling `get`/`update` fallbacks already run.
            let all = await ql.find(params.object, findOpts({ where: { id: params.id }, limit: 1 }));
            if (all && (all as any).value) all = (all as any).value;
            if (!all) all = [];
            const existing = (all as any[]).find((i: any) => i.id === params.id);
            if (!existing) throw recordNotFoundError(params.object, params.id);
            await ql.delete(params.object, findOpts({ where: { id: params.id } }));
            // [#5581] `success`, not `deleted`. The success body was the other
            // half of the same "one `callData`, two answers" defect #5138 fixed
            // on the not-found side: the protocol path returns the SPEC's shape
            // (`DeleteDataResponseSchema` — `{ object, id, success }`,
            // `packages/spec/src/api/protocol.zod.ts:472`) and this fallback
            // returned `{ object, id, deleted: true }` — `success` missing, and
            // `deleted` declared nowhere in the spec. A client written against
            // the declared shape read `success === undefined` off an HTTP 200
            // on any deployment that did not register the `protocol` slot, and
            // had no way to tell which path had served it.
            //
            // The spec is the authority, not this literal: `success` is what
            // `DeleteDataResponseSchema` declares, what the protocol path has
            // returned since #4435, and what the public HTTP docs already
            // document (`content/docs/protocol/kernel/http-protocol.mdx`).
            // Teaching consumers to read `success ?? deleted` would have been
            // the contract-first-forbidden shape — two spellings of one fact,
            // kept alive by every reader.
            return { object: params.object, id: params.id, success: true };
        }
        throw { statusCode: 503, message: 'Data service not available' };
    }

    if (action === 'query' || action === 'find') {
        // Build query: use explicit params.query if provided, otherwise extract
        // query fields from params. Shared by both paths below — the fallback
        // must serve the SAME request the protocol path would have served.
        const query = params.query || (() => {
            const { object, ...rest } = params;
            return rest;
        })();
        if (protocol && typeof protocol.findData === 'function') {
            return await protocol.findData({ object: params.object, query, context: executionContext });
        }
        if (ql) {
            // [#4386] This fallback used to pass only `{ context }` — the
            // caller's entire query (where/orderBy/limit/…) was dropped and the
            // FULL table came back as an ordinary-looking `{ records, total }`.
            // Serve the canonical QueryAST keys both possible recipients
            // actually execute (`ql` here is the engine, or on the MCP
            // multi-env path a RAW driver reading a QueryAST — same canonical
            // keys by design). Anything else — wire spellings (`sort`,
            // `select`, …) that need the protocol layer's fold/lowering, or
            // capabilities a raw driver would silently drop (`search`,
            // `expand`) — is refused loudly rather than part-served: a
            // fallback that cannot reproduce the query's semantics must not
            // pretend to (route-ownership rule 3).
            const FALLBACK_QUERY_KEYS = ['where', 'fields', 'orderBy', 'limit', 'offset'];
            const bag: any = {};
            const unservable: string[] = [];
            for (const [k, v] of Object.entries((query ?? {}) as Record<string, unknown>)) {
                if (v == null) continue;
                // `context` is SERVER-derived on this path, same as findData's
                // unconditional `delete options.context` — a caller-supplied
                // one is dropped, never an error and never honoured.
                if (k === 'context') continue;
                if (FALLBACK_QUERY_KEYS.includes(k)) bag[k] = v;
                else unservable.push(k);
            }
            if (unservable.length > 0) {
                throw {
                    statusCode: 501,
                    message: `Data query fallback cannot serve ${unservable.map((k) => `'${k}'`).join(', ')}: ` +
                        'the protocol service (metadata-protocol plugin) is not registered, and without its ' +
                        `normalization this path serves only canonical QueryAST keys (${FALLBACK_QUERY_KEYS.join(', ')}).`,
                };
            }
            let all = await ql.find(params.object, findOpts(bag));
            if (!Array.isArray(all) && all && (all as any).value) all = (all as any).value;
            if (!all) all = [];
            return { object: params.object, records: all, total: all.length };
        }
        throw { statusCode: 503, message: 'Data service not available' };
    }

    if (action === 'aggregate') {
        // Aggregate MUST run through the ObjectQL ENGINE (never the raw
        // `dataDriver` the MCP bridge threads through for the other verbs):
        // only the engine's middleware chain injects RLS/tenant scoping and
        // the FLS aggregate-input gate. A raw driver.aggregate() would
        // evaluate the query verbatim over every row.
        //
        // At least one aggregation is REQUIRED: with neither aggregations
        // nor groupBy the engine's in-memory path degrades to raw rows,
        // and the FLS result masker does not cover the `aggregate` op —
        // grouped/aggregated output must stay the only thing this action
        // can ever return.
        if (!Array.isArray(params.aggregations) || params.aggregations.length === 0) {
            throw { statusCode: 400, message: 'aggregate requires at least one aggregation' };
        }
        const engine = (await deps.getObjectQL(requestContext, scopeId))
            ?? await deps.resolveService(requestContext, 'objectql', scopeId).catch(() => null);
        if (engine && typeof engine.aggregate === 'function') {
            const rows = await engine.aggregate(
                params.object,
                {
                    ...(params.where ? { where: params.where } : {}),
                    ...(params.groupBy ? { groupBy: params.groupBy } : {}),
                    ...(params.aggregations ? { aggregations: params.aggregations } : {}),
                    ...(params.timezone ? { timezone: params.timezone } : {}),
                    ...(executionContext ? { context: executionContext } : {}),
                },
            );
            return { object: params.object, rows: rows ?? [] };
        }
        throw { statusCode: 503, message: 'Data service not available' };
    }

    // [#5856] `batch` deliberately has NO arm here. It used to answer
    // `{ object, results: [] }` — an HTTP 200 whose body a consumer cannot
    // tell apart from "the batch ran and matched nothing" — on a path that
    // opened no transaction and wrote nothing. Its safety was never its own:
    // no caller of `callData` can spell `batch` (`domains/data.ts` compares
    // `parts[1]` against the literal `'query'`; `domains/mcp.ts`,
    // `domains/actions.ts` and `invokeBusinessAction` pass literals; the
    // declarative endpoint executor is bounded by
    // `ApiEndpointSchema.objectParams.operation`, a closed enum of
    // find/get/create/update/delete; and `callData` is not part of this
    // package's export surface), so the arm's only live effect was to
    // pre-decide — wrongly — what the FIRST caller to arrive would get:
    // a silent success where every other unhandled action gets a loud
    // refusal. Removed under ADR-0049 enforce-or-remove, so `batch` falls to
    // the same 400 as any other unknown action. Batching itself is untouched
    // and keeps its ONE owner (route-ownership rule 1): both the atomic
    // cross-object `POST /batch` and the per-object `POST /data/:object/batch`
    // are mounted by `@objectstack/rest`'s `registerBatchEndpoints`
    // (ADR-0119) — which is exactly why this dispatcher answers
    // `capabilities.transactionalBatch: false` (#5672,
    // `http-dispatcher.ts`). Pinned by
    // `action-execution-calldata-batch-retired.test.ts`.
    throw { statusCode: 400, message: `Unknown data action: ${action}` };
}

/**
 * [ADR-0066 D4] Shared capability gate for an action invocation. Returns a
 * human-readable error string when the caller's `systemPermissions` don't
 * cover the action's declared `requiredPermissions`, or `null` when allowed.
 * System/engine self-invocation (`isSystem`) bypasses; an action without
 * `requiredPermissions` is ungated. Single-sourced so the REST `/actions/...`
 * route and the MCP `run_action` bridge enforce the SAME declaration.
 */
export function actionPermissionError(_deps: ActionExecutionDeps, actionDef: any, ec: any, objectName?: string): string | null {
    const required: string[] = Array.isArray(actionDef?.requiredPermissions)
        ? actionDef.requiredPermissions
        : [];
    if (required.length === 0) return null;
    if (ec?.isSystem) return null;
    const held = new Set<string>(ec?.systemPermissions ?? []);
    const missing = required.filter((perm) => !held.has(perm));
    if (missing.length === 0) return null;
    const on = objectName ? ` on '${objectName}'` : '';
    return (
        `Action '${actionDef?.name ?? 'unknown'}'${on} requires capability ` +
        `[${required.join(', ')}] — caller is missing [${missing.join(', ')}]`
    );
}

/**
 * [ADR-0126 §8 item 2] The activation refusal a DISABLED packaged action is
 * answered with — `409 ACTION_DISABLED`.
 *
 * ## Why 409, and why its own code
 *
 * The artifact exists and is well-formed; only its current STATE conflicts with
 * running it, and flipping the switch makes the identical request succeed —
 * 409's meaning, and the same reading `FLOW_DISABLED` got in the #9378 table.
 * The code is the action's own rather than a borrowed `FLOW_DISABLED`: a
 * `script` action refused under a code naming a flow would send an operator
 * looking for a flow that does not exist, and a machine-readable surface must
 * not lie about which artifact it is talking about (Route & surface ownership
 * rule 4). It joins the `*_DISABLED` family already registered in the ADR-0112
 * ledger (`FLOW_DISABLED`, `OBJECT_API_DISABLED`, `OBJECT_PACKAGE_DISABLED`) —
 * one census row, no new condition class.
 */
export const ACTION_DISABLED_CODE = 'ACTION_DISABLED';
export const ACTION_DISABLED_STATUS = 409;

/** The shape both doors serve — the wire envelope's three fields (ADR-0112). */
export interface DisabledActionRefusal {
    code: typeof ACTION_DISABLED_CODE;
    status: typeof ACTION_DISABLED_STATUS;
    message: string;
}

/**
 * [ADR-0126 §8 item 2] THE CONSULT POINT for the action activation ledger —
 * asked by every door that dispatches a DECLARED action.
 *
 * ## Where this sits, and why it is not one seam deeper
 *
 * The flow leg could put its consult at `execute()`, "the one seam every entry
 * path crosses". Actions have no such seam that can answer the question: the
 * two per-type primitives below it (`executeRegisteredAction` →
 * `ql.executeAction`, and `dispatchFlowAction`) are addressed by HANDLER KEY
 * and by target flow name respectively, and ADR-0110 D2 is explicit that a
 * registration key is NOT an action's identity ("`AppPlugin` auto-registers
 * body actions under `name`, while user code registers a target-bound script
 * action under `target`"). The ledger addresses the declarative NAME, so the
 * consult belongs exactly where a resolved DECLARATION exists: the REST
 * `/actions` door and the MCP `run_action` bridge, each pinned by its own test.
 * Placing it lower would silently miss every target-bound action — a gate that
 * looks present and is not.
 *
 * ⚠️ ObjectQL's `ScopedRepo.execute()` — a hook/action BODY reaching another
 * handler in-process via `ctx.api.object(x).execute(...)` — is the third
 * `executeAction` caller and is deliberately NOT a consult point: it dispatches
 * by key with no declaration, carries no caller identity, and is package code
 * calling package code (the class ADR-0126 §2 keeps outside the model for
 * `hook`). Recorded rather than left to be discovered.
 *
 * ## Ordering: authorization first, activation second
 *
 * Both doors call this AFTER the ADR-0066 D4 capability gate. An unentitled
 * caller therefore learns nothing about which packaged actions this
 * installation has switched off — the same reason `/automation`'s gates run
 * ahead of its service probe (a 403 must not become an oracle).
 *
 * Returns `undefined` when the action may run. An engine that cannot answer
 * (no `isActionEnabled` — a host on an older engine, or a test double) yields
 * `undefined` too: absence of a ledger means the packaged default, ACTIVE
 * (ADR-0126 §4), which is what a stock boot has always done.
 */
export function disabledActionRefusal(
    _deps: ActionExecutionDeps,
    ql: any,
    actionDef: any,
): DisabledActionRefusal | undefined {
    const name = actionDef?.name;
    if (typeof name !== 'string' || name === '') return undefined;
    if (typeof ql?.isActionEnabled !== 'function') return undefined;
    if (ql.isActionEnabled(name) !== false) return undefined;

    // The SENTENCE is the engine's (`describeDisabledAction`), so both doors
    // state one refusal instead of two that agree today; the fallback covers an
    // engine that answers the boolean but not the prose.
    const message = typeof ql.describeDisabledAction === 'function'
        ? String(ql.describeDisabledAction(name))
        : `Action '${name}' is disabled for this installation (ADR-0126 §8).`;
    return { code: ACTION_DISABLED_CODE, status: ACTION_DISABLED_STATUS, message };
}

/**
 * [#2849 / ADR-0011] AI-exposure gate for the MCP action surface. Returns a
 * human-readable error string unless the action's author explicitly opted it
 * into the AI surface with `ai.exposed: true`, or `null` when exposed.
 *
 * This gate is the REAL agent-facing boundary for actions: script/body
 * handlers execute as TRUSTED application code (the engine facade and
 * `ctx.api` run `isSystem` — see {@link buildActionExecutionContext}), so once
 * invoked, a body's reads/writes are NOT bounded by the caller's RLS/FLS or an
 * agent's data ceiling (ADR-0090 D10). The author's explicit opt-in — not a
 * data-layer backstop — therefore decides what AI may trigger. Fail-closed by
 * default.
 */
export function actionAiExposureError(_deps: ActionExecutionDeps, actionDef: any, objectName?: string): string | null {
    if (actionDef?.ai?.exposed === true) return null;
    const on = objectName ? ` on '${objectName}'` : '';
    return (
        `Action '${actionDef?.name ?? 'unknown'}'${on} is not exposed to AI — ` +
        `the app author must opt it in with \`ai: { exposed: true, description: … }\``
    );
}

/**
 * [#15079] The one row-level `operation` the spec admits (`ActionSchema.
 * operation`, `z.enum(['update'])` — #14092, maintainer ruling 2026-09-01).
 * Named rather than inlined so the predicate below, the two doors and their
 * pins all read ONE spelling.
 */
export const DECLARATIVE_UPDATE_OPERATION = 'update';

/**
 * [#15079] Is this the DECLARATIVE single-record field write?
 *
 * ## `operation` is read BEFORE `type` — everywhere, without exception
 *
 * This is contract point 1 of the executor contract pinned on the spec half
 * (PR #15077), and it is a rule about ORDER, not just about a new branch. The
 * declarative write is spelled as a key PARALLEL to `type`: `type` answers
 * WHERE an action dispatches (`'script'` = the platform action route, which is
 * where the write is performed) and `operation` answers WHAT the platform does
 * there. Its parsed shape is therefore always `{ type: 'script', operation:
 * 'update', patch }` — `type` carries no information at all for it, and the
 * spec refuses every other explicit `type` beside it.
 *
 * So a `type`-keyed reader that runs first gets the RIGHT answer to the WRONG
 * question: `isHeadlessInvokableAction` sees a `script` action with neither
 * `target` nor `body` and says "not invokable"; `headlessActionTypeError` would
 * hand a Studio-authored `type: 'flow'` + `operation: 'update'` row the flow
 * prescription. Both are the same defect — the executor's own discriminator
 * consulted second. Every reader below asks this function first.
 *
 * Deliberately a bare equality on the declared key, with no `type` clause: an
 * action carrying `operation: 'update'` IS the declarative write, whatever
 * `type` says. Data at rest that never went through `ActionSchema` (a Studio
 * row, a `strict: false` bundle) is exactly the population where the two keys
 * can contradict, and the ruling's answer for it is `operation`.
 */
export function isDeclarativeUpdateAction(action: any): boolean {
    return action?.operation === DECLARATIVE_UPDATE_OPERATION;
}

/**
 * Whether an action has a headless invocation path (so MCP can run it).
 * Mirrors the supported-type set of the (now cloud-side) action-tools
 * bridge: `script` needs a handler binding (`target`) or an inline `body`;
 * `flow` needs a `target` and an automation service. UI-only types
 * (`url`, `modal`, `form`) and `api` have no server dispatch here.
 *
 * [#15079] …and the DECLARATIVE update is invokable with none of those: it
 * carries no handler binding by construction (the spec refuses `target` and
 * `body` beside `operation: 'update'`), because the platform performs the
 * write. Read first, per {@link isDeclarativeUpdateAction} — the `script` arm
 * below answers `false` for it, which would have hidden every declarative
 * update action from the MCP `run_action` bridge's listing while the HTTP door
 * ran it. That divergence is the failure the card names these predicates to
 * prevent.
 */
export function isHeadlessInvokableAction(_deps: ActionExecutionDeps, action: any, hasAutomation: boolean): boolean {
    if (isDeclarativeUpdateAction(action)) return true;
    const type: string = action?.type ?? 'script';
    if (type === 'script') return Boolean(action?.target || action?.body);
    if (type === 'flow') return Boolean(action?.target) && hasAutomation;
    return false;
}

/**
 * The action types a headless caller can actually invoke through a server
 * dispatch — the two {@link isHeadlessInvokableAction} accepts. Kept next to
 * it so the predicate and the explanation below can never drift apart.
 *
 * [#15079] Deliberately still a set of TYPES, and deliberately not consulted
 * for the declarative update: `operation` is not a type, and adding `'update'`
 * here would be the member spelling the ruling rejected. What learned
 * `operation` is the READER — {@link headlessActionTypeError} asks
 * {@link isDeclarativeUpdateAction} before it reaches this set, so an update
 * action never has its `type` classified at all.
 */
const SERVER_DISPATCHED_ACTION_TYPES: ReadonlySet<string> = new Set(['script', 'flow']);

/**
 * Explain why a declared action has NO server-side dispatch — `null` when it
 * does have one (`script` / `flow`).
 *
 * The spec is explicit (`packages/spec/src/ui/action.zod.ts`): every
 * non-`script` type dispatches on `target`, and only `flow` has a server-side
 * runner (the automation engine). `url` / `modal` / `form` are renderer
 * navigation and `api` names a *different* endpoint the client calls itself —
 * none of them is the script-handler registry. Pre-#3915 the REST route had
 * no type branching at all, so every one of them fell through to
 * `executeAction` and came back as the misleading
 * `Action '' on object '*' not found`. Naming the type and the prescription
 * turns that dead end into an actionable 400.
 */
export function headlessActionTypeError(_deps: ActionExecutionDeps, action: any, objectName?: string): string | null {
    // [#15079] `operation` before `type`. The declarative update HAS a server
    // dispatch — this file performs it — so classifying its `type` could only
    // produce a wrong prescription. For the parsed shape (`type: 'script'`)
    // the set below already answers `null`; this line is what keeps the answer
    // right for data at rest whose `type` contradicts its `operation`.
    if (isDeclarativeUpdateAction(action)) return null;
    const type: string = action?.type ?? 'script';
    if (SERVER_DISPATCHED_ACTION_TYPES.has(type)) return null;
    const name: string = action?.name ?? 'unknown';
    const on = objectName ? ` on '${objectName}'` : '';
    const target: string | undefined = typeof action?.target === 'string' ? action.target : undefined;
    if (type === 'api') {
        return (
            `Action '${name}'${on} is \`type: 'api'\` — it dispatches on \`target\`, ` +
            `not through the action registry. Call ${target ? `\`${target}\`` : 'its `target` endpoint'} directly` +
            `${typeof action?.method === 'string' ? ` (${action.method})` : ''}.`
        );
    }
    return (
        `Action '${name}'${on} is \`type: '${type}'\` — a client-side action with no server dispatch. ` +
        `The renderer opens its \`target\`${target ? ` ('${target}')` : ''}; there is nothing for the server to run.`
    );
}

/**
 * The automation service when this kernel has a usable one, else `null` —
 * the single availability probe behind `type: 'flow'` dispatch (both the
 * headless-invokability filter and the two invoke paths ask through it).
 */
export async function resolveAutomationService(deps: ActionExecutionDeps, requestContext: HttpProtocolContext, envId?: string): Promise<any | null> {
    try {
        // [#4127 batch 4] Was `: any`, which voided the gate here. `execute` is
        // declared on IAutomationService, so this needed no contract work — only
        // for someone to notice, and three grep sweeps over `domains/*.ts` never
        // reached this file. The lint rule did.
        const svc = await deps.resolveService(requestContext, 'automation', envId);
        return svc && typeof svc.execute === 'function' ? svc : null;
    } catch {
        return null; // no automation service on this kernel
    }
}

/** Message for a flow action on a kernel with no automation service (a 503-shaped condition). */
export function flowActionUnavailableError(action: any): string {
    return `Action '${action?.name ?? 'unknown'}' is a flow but no automation service is available`;
}

/**
 * The params bag a flow action hands the automation engine.
 *
 * Three seeds, weakest first — each only fills a key the stronger one left
 * unset:
 *  1. the subject record's fields, which populate a flow's named `isInput`
 *     variables the way the record-change trigger does;
 *  2. the row id under the keys a flow author actually writes —
 *     `recordId` and the `<objectName>Id` camelCase alias — the SAME two
 *     `POST /automation/:name/trigger` seeds (`domains/automation.ts`), plus
 *     the action's own declared `recordIdParam` (seeded from `recordIdField`,
 *     default `id`) when it names a third key;
 *  3. the caller's explicit action params, which win outright.
 *
 * Seed 2 is the one #3915's first pass missed, and only a real run caught it:
 * the params bag carried the record's `id` but never `recordId`, so the CRM's
 * own `crm_convert_lead` action — which declares `recordIdParam: 'recordId'`
 * and whose flow reads `{recordId}` — reached the engine and died at its first
 * node ("1 filter condition(s) resolved to nothing"), while the identical run
 * through `/automation/crm_convert_lead_wizard/trigger` succeeded. A declared
 * `recordIdParam` that nothing honours is the `declared ≠ enforced` shape in
 * miniature.
 */
export function seedFlowActionParams(_deps: ActionExecutionDeps,
    action: any,
    input: {
        objectName: string;
        record: Record<string, unknown>;
        params: Record<string, unknown>;
        recordId?: string;
    },
): Record<string, unknown> {
    const { objectName, record, params, recordId } = input;
    const seeded: Record<string, unknown> = { ...record };

    // `recordIdField` names the row field whose value seeds the key (default
    // `id`) — a declaration may want a non-id value (spec: `token` for
    // revoke-session). Fall back to the explicit recordId when the record
    // never loaded (a record-less / new-record invocation).
    const idField: string = typeof action?.recordIdField === 'string' && action.recordIdField
        ? action.recordIdField
        : 'id';
    const rowId: unknown = record?.[idField] ?? (idField === 'id' ? recordId : undefined);

    if (rowId != null) {
        const keys = new Set<string>(['recordId']);
        // [#14864] ONE predicate for "object-less", the same one
        // `dispatchFlowAction` asks three lines from here before it decides
        // whether to hand the automation service an `object` at all. This used
        // to be a second, narrower comparison (`objectName !==
        // GLOBAL_ACTION_OBJECT_KEY`), and the two parted on exactly one input:
        // a route resolved at the legacy `'*'` was object-less to the envelope
        // and object-BOUND here, so the bag grew a nonsense `'*Id'` alias. The
        // empty-string leg was never the divergence — the `objectName &&`
        // truthiness test this replaces already covered it.
        if (!isObjectLessActionKey(objectName)) {
            keys.add(`${objectName.replace(/_([a-z])/g, (_m: string, c: string) => c.toUpperCase())}Id`);
        }
        if (typeof action?.recordIdParam === 'string' && action.recordIdParam) {
            keys.add(action.recordIdParam);
        }
        for (const key of keys) {
            if (seeded[key] === undefined) seeded[key] = rowId;
        }
    }

    return { ...seeded, ...params };
}

/**
 * Brand for {@link FlowActionRefusal} — `Symbol.for`, so recognition keeps
 * working even if two module instances of this file ever coexist (src vs
 * dist), where an `instanceof` would silently answer false.
 */
const FLOW_ACTION_REFUSAL_BRAND = Symbol.for('objectstack.runtime.flowActionRefusal');

/**
 * The run artefacts a failed flow dispatch carries beside its status and code
 * — EXACTLY the two fields the trigger door ships in `error.details` on its
 * own `400 FLOW_FAILED` arm (`domains/automation.ts`), same names, same
 * source (`AutomationResult.errorMessage` / `.summary`). A third key here is
 * a contract widening the #9585 ruling does not cover.
 */
export interface FlowActionRunDetails {
    /** The flow AUTHOR's own failure text (`flow.errorMessage`). */
    errorMessage?: string;
    /** The run's per-node accounting — WHICH node failed (#4354). */
    summary?: FlowRunSummary;
}

/**
 * [#9585] The typed refusal carrier for a flow ACTION that ran and failed.
 *
 * Maintainer ruling, 2026-08-19 (Option B on #9585): the `/actions` door must
 * deliver the flow author's `errorMessage` and the run `summary` the way the
 * trigger door already does — but this door THROWS, and the shared resolver
 * (`resolveThrownHttpError`, `@objectstack/types`) builds `details` from a
 * closed list that deliberately drops a thrown `.details` (#8016 / #9106).
 * Widening that list would let ANY throw anywhere declare wire payload — the
 * exact thing #9106 narrowed `code` to prevent, and the rejected Option A.
 * So the widening stays out of the shared rule: this named, closed carrier is
 * recognised by the `/actions` handler AHEAD of its generic catch
 * (`domains/actions.ts`, via {@link isFlowActionRefusal}) and mapped to
 * `deps.error(message, status, { code, ...runDetails })` — the trigger door's
 * own exit, byte for byte.
 *
 * A door that does NOT recognise it (the MCP `run_action` bridge, or any
 * future caller of {@link dispatchFlowAction}) still serves it exactly as it
 * served the plain throw this replaces: `status`, `code` and `message` are
 * stamped identically, so `resolveThrownHttpError` reads the same
 * `400 FLOW_FAILED` and the same text, and only the run details stay behind.
 * Degrading to yesterday's answer — never to a different one — is what makes
 * this carrier safe to throw on a path two transports share.
 */
export class FlowActionRefusal extends Error {
    /** HTTP status this refusal answers with — the #9378 table's 400 row. */
    readonly status: number;
    /** ADR-0112 `error.code` — registered, never minted here. */
    readonly code: FlowRefusalCode;
    /** The two run artefacts the door carries into `error.details`. */
    readonly runDetails: FlowActionRunDetails;

    constructor(
        message: string,
        refusal: { status: number; code: FlowRefusalCode },
        runDetails: FlowActionRunDetails,
    ) {
        super(message);
        this.name = 'FlowActionRefusal';
        this.status = refusal.status;
        this.code = refusal.code;
        this.runDetails = runDetails;
        (this as Record<PropertyKey, unknown>)[FLOW_ACTION_REFUSAL_BRAND] = true;
    }
}

/**
 * Recognition predicate for {@link FlowActionRefusal} — the `/actions`
 * handler asks this BEFORE its generic catch logic runs. Brand-based rather
 * than `instanceof` (see {@link FLOW_ACTION_REFUSAL_BRAND}); a foreign object
 * that merely copies the field names is not recognised, so no script handler
 * can impersonate the flow door's channel by throwing a lookalike.
 */
export function isFlowActionRefusal(e: unknown): e is FlowActionRefusal {
    return typeof e === 'object' && e !== null
        && (e as Record<PropertyKey, unknown>)[FLOW_ACTION_REFUSAL_BRAND] === true;
}

/**
 * Dispatch a `type: 'flow'` action through the automation service.
 *
 * The ONE implementation both headless surfaces share — the MCP `run_action`
 * tool and the REST `/actions/:object/:action` route (#3915, which is exactly
 * the asymmetry that let this branch exist on only one of them). Throws on a
 * missing automation service and converts a refused or failed dispatch into a
 * throw so both callers report failure the same way; returns the raw
 * automation result otherwise.
 *
 * [#9446] **The refusal it throws is the #9378 table, read from the ONE
 * definition** (`./flow-dispatch-status.js`) that the trigger door reads too:
 *
 * | engine exit            | this door answers          |
 * |------------------------|----------------------------|
 * | flow not found         | `404`                      |
 * | flow disabled          | `409` `FLOW_DISABLED`      |
 * | flow has no start node | `422` `FLOW_NO_START_NODE` |
 * | ran and failed         | `400` `FLOW_FAILED`        |
 *
 * Maintainer ruling (2026-08-18, verbatim 「同意」): the table is a property of
 * the flow-dispatch CONTRACT, not of the trigger route, so this door converges
 * on it rather than keeping its own reading. It used to map EVERY
 * `success: false` to `400 FLOW_FAILED` under a comment asserting "The flow
 * RAN and rejected" — a false statement for the two never-dispatched exits it
 * caught, told to a caller whose only machine-readable signal is that code.
 *
 * The never-dispatched throws carry `status` and `code` and the route serves
 * them through `errorFromThrown`; `error.details` there is whatever
 * `resolveThrownHttpError` reads off a thrown value, and that resolver's
 * closed list stays untouched (#8016 / #9106). [#9585] The ran-and-failed row
 * is the one exception, by maintainer ruling: it throws the typed
 * {@link FlowActionRefusal} carrier, which the `/actions` handler recognises
 * ahead of its generic catch and serves with the trigger door's own
 * `errorMessage` / `summary` details — see the carrier's doc for the whole
 * mechanism and the fallback story.
 *
 * Forwarding the caller's identity (rather than just executing the flow) is
 * what lets a `runAs: 'user'` flow enforce RLS as the invoker instead of
 * falling into the user-less UNSCOPED path (#2849, ADR-0049 / #1888; mirrors
 * the record-change trigger's context shape).
 *
 * The params bag is seeded exactly like `POST /automation/:name/trigger`
 * (`domains/automation.ts`) — see {@link seedFlowActionParams}. Invoking a
 * flow ACTION and triggering its flow directly must land the same run, or
 * "the actions endpoint dispatches flows for you" is a claim the runtime
 * doesn't keep.
 *
 * [#15168] **The wiring takes the subject LOAD, not a bare record.** The flow
 * face of #14143's signal (`AutomationContext.recordLoadDenied`, declared by
 * #14244) is derived here, once, from {@link loadActionSubjectRecord}'s
 * outcome — so a caller cannot hand this door a record while dropping the
 * verdict that says the caller could not read it. Both call sites already held
 * that outcome and were passing `subject.record` out of it; taking the whole
 * `subject` removes the second de-facto source rather than adding a key beside
 * it, and makes the omission a compile error instead of a silent inertness one
 * door over (the shape #14143 was filed for).
 */
export async function dispatchFlowAction(deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    action: any,
    wiring: {
        objectName: string;
        /** The caller-scope load outcome — `record` AND its verdict, from ONE producer. */
        subject: ActionSubjectRecordLoad;
        params: Record<string, unknown>;
        recordId?: string;
        ec: any;
        envId?: string;
    },
): Promise<any> {
    const { objectName, subject, params, recordId, ec, envId } = wiring;
    const record = subject.record;
    const automation = await resolveAutomationService(deps, requestContext, envId);
    if (!automation) {
        throw new Error(flowActionUnavailableError(action));
    }
    // [#9446] Row 1 of the table, answered by the SAME optional `getFlow`
    // registry probe the trigger door uses — the engine's not-found exit
    // carries no classification, so this is the only way to read it that is not
    // a regex over its message. A service that omits `getFlow` cannot be asked
    // and dispatches as before.
    if (await flowIsUnknown(automation, action.target)) {
        const err: any = new Error(flowNotFoundMessage(action.target));
        err.status = FLOW_NOT_FOUND_STATUS;
        throw err;
    }
    // Pass a proper AutomationContext (the engine never read the former
    // `triggerData` envelope).
    const result: any = await automation.execute(action.target, {
        record,
        // [#15168] The caller-scope load's verdict, a SIBLING of `record` —
        // never a key on it, and spread so it is ABSENT rather than `false`
        // when nothing was refused (`AutomationContext.recordLoadDenied` is
        // `true | undefined`; a flow reads `recordLoadDenied === true`). The
        // same producer, the same spelling and the same absence convention the
        // handler face already carries at the two script-body call sites — the
        // flow face is where the declared key had no populator at all, so a
        // `runAs: 'system'` flow guarding on it was inert, never wrong.
        ...actionRecordLoadSignal(subject),
        ...(isObjectLessActionKey(objectName) ? {} : { object: objectName }),
        userId: ec?.userId,
        ...(Array.isArray(ec?.positions) && ec.positions.length ? { positions: ec.positions } : {}),
        ...(Array.isArray(ec?.permissions) && ec.permissions.length ? { permissions: ec.permissions } : {}),
        ...(ec?.tenantId ? { tenantId: ec.tenantId } : {}),
        params: seedFlowActionParams(deps, action, { objectName, record, params, recordId }),
    });
    // [#9446] Rows 2-4, read off the PRODUCER's classification through the one
    // shared table. What stood here mapped every `success: false` to
    // `400 FLOW_FAILED` under a comment claiming "the flow RAN and rejected" —
    // false for two of the exits it caught, and the producer's own `code` was
    // available and ignored. A disabled flow invoked through an action told the
    // caller a run had failed when no node ever executed.
    const refusal = classifyFlowRefusal(action.target, result);
    if (refusal) {
        // The ran-and-failed row keeps THIS door's wording, byte for byte:
        // it has been on the wire since #3962, the ruling is about status
        // and code, and re-labelling a message nobody asked about would be
        // an unruled change riding along. It also names the flow, which
        // this door needs and the trigger door does not — the flow name is
        // in that route's URL and is nowhere in this one. The two
        // never-dispatched rows are NEW here, so they take the shared
        // table's message: the producer's own words, exactly as the
        // trigger door serves them.
        if (refusal.code === 'FLOW_FAILED') {
            // [#9585] The typed carrier, run artefacts read EXACTLY as the
            // trigger door reads them (`domains/automation.ts`, its 400 arm):
            // present when the producer wrote them, never invented. Only this
            // row carries them — a never-dispatched refusal has no author
            // failure text and no node log to point at, so emitting either
            // there would be this door inventing run evidence for a run that
            // never started, which is why the two rows below stay plain
            // throws.
            throw new FlowActionRefusal(
                `Flow '${action.target}' failed: ${result.error ?? 'unknown error'}`,
                refusal,
                {
                    ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
                    ...(result.summary !== undefined ? { summary: result.summary } : {}),
                },
            );
        }
        const err: any = new Error(refusal.message);
        err.status = refusal.status;
        err.code = refusal.code;
        throw err;
    }
    // An UNCLASSIFIED `success: false` still refuses, and `FLOW_FAILED` stays
    // its answer — deliberately NOT the trigger door's 200. This route settled
    // in #3962 that failures speak HTTP, so the alternative residual here is
    // the `200 {success:true,data:{success:false}}` double envelope that
    // ruling removed. `FLOW_FAILED` is what this exit has answered all along;
    // narrowing which refusals reach it is this card's change, re-labelling
    // the residual is not.
    if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        const err: any = new Error(`Flow '${action.target}' failed: ${result.error ?? 'unknown error'}`);
        err.status = 400;
        err.code = 'FLOW_FAILED';
        throw err;
    }
    return result ?? null;
}

/**
 * [#7828] Declared semantics only. `confirmText` is UI dialog copy — the
 * platform's own authoring convention (#7278/#7309) is actively moving confirm
 * questions onto `description`, so keying an AI-facing safety property off
 * `confirmText`'s mere presence classifies on copy the author never intended
 * as a safety signal, and erodes as that migration proceeds (6 of the 14
 * #7309 identity actions flipped to "not destructive" the moment their
 * `confirmText` was removed). `mode: 'delete'` and `variant: 'danger'` are
 * closed, declared enumerations an author sets on purpose — those remain the
 * signal. Maintainer ruling: issue #7828, comment 5265943521 (Option A).
 */
export function actionLooksDestructive(_deps: ActionExecutionDeps, action: any): boolean {
    if (action?.ai?.requiresConfirmation !== undefined) return Boolean(action.ai.requiresConfirmation);
    return Boolean(action?.mode === 'delete' || action?.variant === 'danger');
}

export function summarizeAction(deps: ActionExecutionDeps, action: any, obj: any, objectName: string, flow?: any): any {
    // [#15079] `operation` before `type`, on the LISTING face. A declarative
    // update always requires a current record — that is contract point 7, and
    // the executor refuses without one — so the answer cannot be left to
    // `locations`, which is optional metadata an author may omit entirely. An
    // agent told `requiresRecord: false` would invoke without a `recordId` and
    // collect the refusal that this summary exists to prevent.
    const declarativeUpdate = isDeclarativeUpdateAction(action);
    const requiresRecord =
        declarativeUpdate ||
        (Array.isArray(action?.locations) &&
        action.locations.some(
            (l: string) =>
                l === 'list_item' || l === 'record_header' || l === 'record_more' || l === 'record_related',
        ));
    const description =
        (typeof action?.ai?.description === 'string' ? action.ai.description : undefined) ??
        (typeof action?.label === 'string' ? action.label : undefined);
    const params = summarizeActionParams(deps, action, obj, flow);
    return {
        name: action.name,
        objectName,
        ...(typeof action?.label === 'string' ? { label: action.label } : {}),
        ...(description ? { description } : {}),
        type: action?.type ?? 'script',
        // The verb, beside the route. Emitted only when declared, so an agent
        // reading the listing can tell the platform-performed write from a
        // handler-backed `script` action — the two share a `type`.
        ...(declarativeUpdate ? { operation: DECLARATIVE_UPDATE_OPERATION } : {}),
        requiresRecord: Boolean(requiresRecord),
        requiresConfirmation: actionLooksDestructive(deps, action),
        ...(params.length > 0 ? { params } : {}),
    };
}

export function jsonTypeOf(_deps: ActionExecutionDeps, t: string | undefined): 'string' | 'number' | 'boolean' | 'array' {
    switch (t) {
        case 'number': case 'currency': case 'percent': case 'rating': case 'slider': case 'autonumber':
            return 'number';
        case 'boolean': case 'toggle':
            return 'boolean';
        case 'multiselect': case 'checkboxes': case 'tags':
            return 'array';
        default:
            return 'string';
    }
}

export function summarizeActionParams(deps: ActionExecutionDeps, action: any, obj: any, flow?: any): any[] {
    const fields: Record<string, any> = obj?.fields ?? {};
    const out: any[] = [];
    for (const p of (Array.isArray(action?.params) ? action.params : [])) {
        const fieldRef: string | undefined = p?.field;
        const field = fieldRef ? fields[fieldRef] : undefined;
        const name: string | undefined = p?.name ?? fieldRef;
        if (!name) continue;
        const type = jsonTypeOf(deps, p?.type ?? field?.type);
        const label = typeof p?.label === 'string' ? p.label : field?.label;
        const help = p?.helpText ?? field?.description;
        const description = [label, help].filter(Boolean).join(' — ') || undefined;
        const optionSource = p?.options ?? field?.options;
        const enumVals = Array.isArray(optionSource)
            ? optionSource
                  .map((o: any) => (typeof o === 'string' ? o : o?.value))
                  .filter((v: any): v is string => typeof v === 'string')
            : [];
        out.push({
            name,
            type,
            required: Boolean(p?.required ?? field?.required ?? false),
            ...(description ? { description } : {}),
            ...(enumVals.length > 0 ? { enum: enumVals } : {}),
        });
    }
    // [#15705] A FLOW action's input contract is its flow's `isInput`
    // variables, not `action.params` — a flow-typed action almost never
    // declares `params`, so this listing answered with no `params` key at all
    // while the MCP `list_actions` tool description promised "its input
    // parameters". An agent could see the action, could invoke it, and had no
    // way to learn a single input name.
    //
    // Second, never first: a declaration the AUTHOR wrote on the action wins
    // outright, so this can only fill a silence. `flow` is optional and the
    // caller resolves it (`domains/mcp.ts` asks the automation service's
    // `getFlow`), which keeps this function pure and leaves every existing
    // 3-argument call site — and every non-flow action — byte-identical.
    if (out.length === 0) out.push(...summarizeFlowInputParams(deps, flow));
    return out;
}

/**
 * A screen flow's input contract, projected onto the same param shape
 * {@link summarizeActionParams} emits for a declared param (#15705).
 *
 * The flow's `isInput` variables ARE the contract — they are what
 * `seedDeclaredVariables` binds from the caller's `params`, so their names are
 * exactly the keys an invoker must send. The variable declaration carries only
 * `name` / `type` / `defaultValue`, so everything an agent needs beyond the
 * name (`label`, `required`, select `options`) is read off the screen node
 * that collects the variable — the same field spec a paused run surfaces.
 *
 * `required` comes from the screen field alone: a flow variable has no
 * `required` key, and inferring one from "declares no `defaultValue`" would
 * invent a contract the author never wrote. A variable no screen collects is
 * still listed — it is a real input, and omitting it would hide the very names
 * this exists to publish — just without the screen-only enrichments.
 */
export function summarizeFlowInputParams(deps: ActionExecutionDeps, flow: any): any[] {
    const variables: any[] = Array.isArray(flow?.variables) ? flow.variables : [];
    if (variables.length === 0) return [];
    const screenFields = collectScreenFieldSpecs(flow);
    const out: any[] = [];
    for (const v of variables) {
        const name: unknown = v?.name;
        if (v?.isInput !== true || typeof name !== 'string' || !name) continue;
        const field = screenFields.get(name);
        const type = jsonTypeOf(deps, field?.type ?? v?.type);
        const description = typeof field?.label === 'string' && field.label ? field.label : undefined;
        const enumVals = Array.isArray(field?.options)
            ? field.options
                  .map((o: any) => (typeof o === 'string' ? o : o?.value))
                  .filter((x: any): x is string => typeof x === 'string')
            : [];
        out.push({
            name,
            type,
            required: field?.required === true,
            ...(description ? { description } : {}),
            ...(enumVals.length > 0 ? { enum: enumVals } : {}),
        });
    }
    return out;
}

/**
 * Every screen field a flow declares, by field name, first declaration
 * winning. Walks ALL `screen` nodes rather than just the first: a multi-step
 * wizard collects its inputs across several screens, and a contract that
 * stopped at screen one would publish a subset while looking complete.
 *
 * Object-form screens contribute nothing by construction — their `fields` is
 * empty because the client renders the object's own form — so they are simply
 * skipped rather than special-cased.
 */
function collectScreenFieldSpecs(flow: any): Map<string, any> {
    const byName = new Map<string, any>();
    for (const node of Array.isArray(flow?.nodes) ? flow.nodes : []) {
        if (node?.type !== 'screen') continue;
        for (const field of Array.isArray(node?.config?.fields) ? node.config.fields : []) {
            const name: unknown = field?.name;
            if (typeof name !== 'string' || !name || byName.has(name)) continue;
            byName.set(name, field);
        }
    }
    return byName;
}

/**
 * Resolve an action's declared `params[]` to their effective value-shape
 * inputs (ADR-0104 D2). A field-backed param inherits type/multiple/
 * options/required from the referenced object field; an inline param
 * carries them directly (inline overrides win). `obj` is the action's
 * parent object schema (holds `.fields`); pass `undefined` for a global
 * action with only inline params.
 */
export function resolveDeclaredActionParams(_deps: ActionExecutionDeps, action: any, obj: any): ResolvedActionParam[] {
    const fields: Record<string, any> = obj?.fields ?? {};
    const out: ResolvedActionParam[] = [];
    for (const p of (Array.isArray(action?.params) ? action.params : [])) {
        const fieldRef: string | undefined = p?.field;
        const field = fieldRef ? fields[fieldRef] : undefined;
        const name: string | undefined = p?.name ?? fieldRef;
        if (!name) continue;
        out.push({
            name,
            type: p?.type ?? field?.type,
            multiple: p?.multiple ?? field?.multiple,
            required: Boolean(p?.required ?? field?.required ?? false),
            options: p?.options ?? field?.options,
        });
    }
    return out;
}

/**
 * Enforce an action's declared param contract against the request bag
 * BEFORE the handler runs (ADR-0104 D2). Returns a `400`-worthy error message
 * when the contract is violated, `null` when the bag conforms.
 *
 * **Strict by default since 17.0** (#3438). R3 asked for a warn-then-error
 * window; the ADR's 2026-07-30 addendum declined it on the merits rather than
 * postponing the flip by a major. What a violation strands here is a CALLER,
 * not data: the rejection is a 400 naming the offending param and the declared
 * list, delivered to the developer or agent who can fix it in one edit, and
 * undoable with `OS_ALLOW_LAX_ACTION_PARAMS`. Deferring that to 18.0 would have
 * charged every deployment a second upgrade ceremony to defer a break that
 * costs one edited call. (D1's half went the opposite way for the opposite
 * reason — it strands stored rows, which nobody can edit their way out of.)
 *
 * Actions that declare no `params` keep the pass-through — there is nothing to
 * validate against, so existing param-less actions are untouched.
 */
export function enforceActionParams(deps: ActionExecutionDeps, 
    action: any,
    obj: any,
    bag: Record<string, unknown>,
    where: { objectName?: string; actionName?: string },
): string | null {
    if (!Array.isArray(action?.params) || action.params.length === 0) return null;
    const resolved = resolveDeclaredActionParams(deps, action, obj);
    const issues = validateActionParams(resolved, bag);
    if (issues.length === 0) return null;
    const summary = issues.map((i) => i.message).join('; ');
    if (!laxActionParams()) {
        return `Invalid action params: ${summary}`;
    }
    const key = `${where.objectName ?? GLOBAL_ACTION_OBJECT_KEY}/${where.actionName ?? action?.name ?? 'action'}`;
    warnActionParamsOnce(
        key,
        `[action-params] ${key}: ${summary} — accepted because ` +
        `OS_ALLOW_LAX_ACTION_PARAMS=1 (ADR-0104 D2; unset it to reject with 400)`,
    );
    return null;
}

/**
 * Build the action-body `ctx.session` from the request ExecutionContext.
 *
 * The shape this returns is DECLARED by {@link ActionSessionSchema}
 * (`@objectstack/spec/ui`), for which this function is the ONLY producer —
 * #5697 declared the shape as it stood, #5779 added the canonical `positions`
 * key and demoted `roles` to a deprecated alias, and this function is the
 * matching producer half (#5613). The consistency between what is declared and
 * what is built is pinned in `action-session-shape-contract.test.ts`; that pin,
 * not this comment, is what keeps the two from drifting.
 *
 * `organizationId` is the blessed name for the caller's active org — the
 * same value as the `organization_id` column and `current_user.organizationId`
 * (RLS). The deprecated `session.tenantId` alias (#3280) was removed in v16
 * (#3290); the driver-layer `ExecutionContext.tenantId` it is sourced from is
 * a distinct, configurable axis and stays. Returns `undefined` — never `{}` —
 * for a genuinely context-less / self-invoked call, so a body can tell "no
 * identity envelope at all" from "an anonymous caller" (#3712).
 *
 * ## `positions` is canonical, `roles` is its deprecated alias (#5613)
 *
 * Both keys carry the SAME array, `ExecutionContext.positions` — the ADR-0090
 * D3 vocabulary. `positions` is the spelling an action body should read.
 * `roles` is emitted only for the length of the deprecation window announced by
 * the ADR-0087 semantic migration `action-session-roles-to-positions`, and is
 * then removed on the path `session.tenantId` already walked (#3280 deprecate →
 * #3290 remove). Emitting both, with identical values, is precisely what makes
 * the migration a change of key and nothing else — a body can be moved to
 * `positions` and verified while the alias is still live.
 *
 * The conditional spread is unchanged, so absent still means the KEY IS ABSENT:
 * a context with no positions (or a non-array `positions`) yields NEITHER key,
 * and since a session is only built at all when the context carries a user or
 * an org, neither key can ever appear alone.
 *
 * ⚠️ Under either spelling this array is NOT an authorization input. Privilege
 * is judged by the security service — capability grants, placements, derived
 * posture (ADR-0095) — never by a name-string comparison; rewriting
 * `roles.includes('admin')` as `positions.includes('admin')` migrates the
 * defect rather than the read.
 *
 * ## NOT the hook `ctx.session`
 *
 * This docblock used to say it mirrors the hook `ctx.session` shape (#3280).
 * That claim stopped being true at #5050, which retired
 * `HookContext.session.roles` outright: the hook session is a DIFFERENT key set
 * (`actor`, `accessToken`, `isSystem`, the skip flags) from a different producer
 * (ObjectQL's `buildSession()`), so "same key, two realities" was exactly the
 * hazard the sentence advertised as a convenience. The two surfaces do now
 * agree on `positions` — same vocabulary, same "descriptive, never an
 * authorization input" boundary (#5605 declared it hook-side) — which is the
 * POINT of this rename, not a coincidence.
 */
export function buildActionSession(_deps: ActionExecutionDeps, ec: any): ActionSession | undefined {
    if (!ec || (ec.userId == null && ec.tenantId == null)) return undefined;
    return {
        ...(ec.userId != null ? { userId: String(ec.userId) } : {}),
        ...(ec.tenantId != null ? { organizationId: String(ec.tenantId) } : {}),
        // Dual-emitted for the #5613 deprecation window: `positions` canonical,
        // `roles` the alias, ONE array under two names (same value, by
        // construction — not two reads that could drift apart).
        ...(Array.isArray(ec.positions) && ec.positions.length
            ? { positions: ec.positions, roles: ec.positions }
            : {}),
    };
}

/**
 * The ExecutionContext an action BODY's own reads/writes execute under —
 * the caller's envelope, elevated with `isSystem: true` (#3914).
 *
 * This is what makes the `[action-audit]` line TRUE. Before #3914 the body's
 * engine facade called `ql.update(...)` with NO context at all, which is not
 * "trusted" — it is IDENTITY-LESS, and identity-less is strictly WORSE than
 * either coherent posture: plugin-sharing's write gate short-circuits on
 * `!context.userId` (there is no user to own anything) and its bypass needs
 * `context.isSystem`, so every owner-scoped write from an action body died
 * `FORBIDDEN` — as the built-in admin — while the audit line announced
 * RLS-bypassing trusted execution. Objects with a `public` sharing model or
 * no owner field passed the gate early, which is why only *some* actions
 * broke and the defect read as object-dependent flakiness.
 *
 * Elevating (rather than binding to the caller's RLS) is the posture #2849
 * already documents and gates for: an action body is trusted code, admitted
 * by the invoke-time capability + `ai.exposed` checks, and hook bodies
 * already get exactly this (the engine's `buildHookApi` falls back to
 * `{ isSystem: true }`). Spreading the caller's envelope FIRST keeps the
 * write attributable and correctly scoped — `userId` stamps `created_by` /
 * `updated_by`, `tenantId` stamps the org column and drives driver-level
 * tenant isolation, `transaction` joins an open transaction — instead of the
 * unattributable, org-less rows a bare `{ isSystem: true }` would write.
 */
export function buildActionExecutionContext(ec: any): Record<string, unknown> {
    const base = ec && typeof ec === 'object' ? { ...(ec as Record<string, unknown>) } : {};
    return { ...base, isSystem: true };
}

/**
 * Build the action-body `ctx.api` — a real `ScopedContext` bound to
 * {@link buildActionExecutionContext}, mirroring what hook bodies get from
 * `HookContext.api` (#3914).
 *
 * Without this the sandbox's `buildSandboxApi` fell through to a repo facade
 * synthesized against the raw engine's CRUD primitives: the raw `ObjectQL`
 * engine has no `.object()` (that lives on `ScopedContext`, reachable only
 * via `engine.createContext()`, which the action path never called), so the
 * facade proxied every call context-less. Returns `undefined` when the engine
 * predates `createContext`, leaving the sandbox's own fallback in charge.
 */
export function buildActionApi(_deps: ActionExecutionDeps, ql: any, ec: any): any | undefined {
    if (!ql || typeof ql.createContext !== 'function') return undefined;
    try {
        return ql.createContext(buildActionExecutionContext(ec));
    } catch {
        // A malformed caller envelope must not sink the action — fall back to
        // the bare elevated context (the same shape hooks default to).
        try {
            return ql.createContext({ isSystem: true });
        } catch {
            return undefined;
        }
    }
}

/**
 * Build the action-body `ctx.engine` — the slim CRUD surface handler suites
 * use. Every call carries {@link buildActionExecutionContext} so `ctx.engine`
 * and `ctx.api` write under the SAME identity (#3914); passing `ec` is what
 * separates a trusted write from a context-less one.
 */
export function buildActionEngineFacade(_deps: ActionExecutionDeps, ql: any, ec?: any): any {
    const context = buildActionExecutionContext(ec);
    return {
        async insert(object: string, data: Record<string, unknown>): Promise<{ id: string }> {
            const res = await ql.insert(object, data, { context });
            const id = (res && (res as any).id) ?? (data as any).id;
            return { id };
        },
        async update(object: string, id: string, data: Record<string, unknown>): Promise<void> {
            await ql.update(object, data, { where: { id }, context });
        },
        // Tolerant of both the single-id and array conventions handler suites
        // use (CRM handlers pass one id; todo handlers pass an id array).
        async delete(object: string, idOrIds: string | string[]): Promise<void> {
            const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
            for (const id of ids) {
                if (id != null) await ql.delete(object, { where: { id }, context });
            }
        },
        async find(object: string, query: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
            const where = query && Object.keys(query).length ? { where: query } : {};
            const rows = await ql.find(object, { ...where, context } as any);
            return Array.isArray(rows) ? rows : ((rows as any)?.value ?? []);
        },
    };
}

/**
 * The subject-record load's outcome, as the two action doors hand it to a
 * handler (#14143).
 */
export interface ActionSubjectRecordLoad {
    /** What the handler receives as `ctx.record`. Unchanged by #14143. */
    record: Record<string, unknown>;
    /**
     * `true` exactly when a caller-scope load was ATTEMPTED and did not deliver
     * the row. Absent-or-`false` otherwise — including for the record-less and
     * new-record actions that never attempt one.
     */
    recordLoadDenied: boolean;
}

/**
 * Load an action's subject record IN THE CALLER'S OWN SCOPE, and report whether
 * that load actually delivered the row (#14143). ONE producer for both action
 * doors — the MCP `run_action` bridge below and the REST `/actions` route
 * (`domains/actions.ts`) — because the signal it emits is documented to app
 * authors, and a signal only one of two doors sets is an authorization guard
 * that is silently inert on the other.
 *
 * ## Why the signal exists
 *
 * The load runs under the CALLER's `ExecutionContext` deliberately: an action's
 * subject row must be readable by the person invoking the action. But the body
 * that follows runs ELEVATED (`buildActionExecutionContext` = `isSystem: true`,
 * settled design — #3914), so authorization has to be re-established INSIDE the
 * handler, and the platform's most natural predicate for that was broken:
 *
 *  - a refused/absent load leaves `record` as `{}`, so `record.id == null`;
 *  - the `recordId` stamp below fires on exactly that condition.
 *
 * The stamp condition and the load-failure condition COINCIDED, so
 * `if (!ctx.record?.id) refuse()` — the guard an author reaches for first —
 * was true on a row the caller cannot read, every time. The stamp is NOT the
 * defect and is kept verbatim: new-record / record-less actions legitimately
 * depend on `recordId` being in place, and removing it would break them.
 * What was missing is a second, independent channel saying "this id did not
 * resolve in your caller's scope", which is what `recordLoadDenied` is.
 *
 * ## What the flag can and cannot tell you
 *
 * It reports "the caller-scope load did not deliver the row", NOT "the platform
 * caught an authorization error". The read path collapses the two on purpose:
 * a row filtered out by RLS and an id that names nothing both arrive as
 * `RECORD_NOT_FOUND` / 404 (`recordNotFoundError`, `@objectstack/core`), which
 * is existence non-disclosure working as designed — the same reason the doc
 * comment on the call site says "an unseen record reads as not-found". Nothing
 * in the caught error separates them, so this flag deliberately does not
 * pretend to, and carries no code/status: for an authorization decision the two
 * are ONE answer — this caller has not demonstrated read access to that row.
 */
export async function loadActionSubjectRecord(
    objectName: string,
    recordId: string | undefined,
    getRecord: () => Promise<any>,
): Promise<ActionSubjectRecordLoad> {
    let record: Record<string, unknown> = {};
    let recordLoadDenied = false;
    if (recordId && !isObjectLessActionKey(objectName)) {
        try {
            const got: any = await getRecord();
            if (got?.record) record = got.record;
            // A resolved call that carried no row is the same fact as a thrown
            // one — the protocol's own 404 arrives as a throw, but a data
            // service that answers `{ record: undefined }` must not read as a
            // successful load just because it declined to throw.
            else recordLoadDenied = true;
        } catch {
            /* new-record / record-less actions pass an empty record */
            recordLoadDenied = true;
        }
    }
    // ⛔ Do NOT delete: a new-record / record-less action's handler reads its
    // id from here. `recordLoadDenied` is what tells the two cases apart now.
    if (record && (record as any).id == null && recordId) (record as any).id = recordId;
    return { record, recordLoadDenied };
}

/**
 * The `ctx` keys that carry {@link loadActionSubjectRecord}'s verdict into an
 * action context — spread so the flag is ABSENT rather than `false` when no
 * load was refused, matching the `referentialFieldClear` marker convention on
 * the sandbox seam: a body reads `ctx.recordLoadDenied === true`.
 */
export function actionRecordLoadSignal(load: ActionSubjectRecordLoad): { recordLoadDenied?: true } {
    return load.recordLoadDenied ? { recordLoadDenied: true } : {};
}

/**
 * [#15079] The prior/next value pair a successful declarative update hands back
 * when the action declares `undoable: true` — the anchor that key never had.
 *
 * The three keys objectui's `UndoableOperation` also needs (`id`, `timestamp`,
 * `description`) are deliberately NOT here: they are the client's — a clock, a
 * stack key and the action's own label, all of which the console already has
 * where it builds the toast. What only the SERVER can answer is what the row
 * held before the write, under the caller's own read scope, and that is exactly
 * what this carries.
 */
export interface DeclarativeUpdateUndo {
    /** The `UndoableOperation.type` this restores to — one verb, by ruling. */
    type: typeof DECLARATIVE_UPDATE_OPERATION;
    objectName: string;
    recordId: string;
    /**
     * The prior value of EXACTLY the fields written, keyed identically to
     * {@link redoData}. A field the row did not carry is `null`, never absent:
     * "restore what was there" needs a value for every key it re-writes, and an
     * absent key would silently leave the new value in place — the same
     * half-restore the platform's serialisation would produce for `undefined`.
     */
    undoData: Record<string, unknown>;
    /** The values written — the merged `{ ...patch, ...params }` bag. */
    redoData: Record<string, unknown>;
}

/** [#15079] What a declarative `operation: 'update'` action returns. */
export interface DeclarativeUpdateResult {
    operation: typeof DECLARATIVE_UPDATE_OPERATION;
    object: string;
    id: string;
    /** The row after the write, as the data plane answered it. */
    record: Record<string, unknown>;
    /** Present only when the action declares `undoable: true`. */
    undo?: DeclarativeUpdateUndo;
}

/**
 * [#15079] The write bag of a declarative update: `{ ...patch, ...params }`.
 *
 * Contract point 4, and the precedence is the whole content of it — the static
 * `patch` sits UNDER the values the dialog collected, so a param of the same
 * name WINS. That is the bulk def's own rule (`bulkActionDefs`), mirrored word
 * for word; the spec's `patch` describe states it too. ⛔ Nothing else from the
 * action is merged: not `bodyExtra` (refused beside `operation`), not
 * `recordIdField`, not the route's own `objectName`/`recordId` stamps — those
 * are handler plumbing, and a declarative update has no handler.
 */
export function declarativeUpdateWrite(action: any, params: Record<string, unknown> | undefined): Record<string, unknown> {
    const patch = action?.patch;
    const base: Record<string, unknown> =
        patch && typeof patch === 'object' && !Array.isArray(patch) ? { ...patch } : {};
    return { ...base, ...(params && typeof params === 'object' ? params : {}) };
}

/** A refusal from the declarative-update executor, carrying the ADR-0112 envelope. */
function declarativeUpdateRefusal(message: string, status: number): Error {
    // ⛔ No `code` literal is stamped here, deliberately. `resolveThrownHttpError`
    // derives the STANDARD catalog member from the status
    // (`standardErrorCodeForHttpStatus`: 400 → `VALIDATION_ERROR`), which is
    // what ADR-0112 asks for when the condition is a generic one — and the
    // ledger's own registration rule says so in as many words ("If the
    // condition is generic … use the standard catalog instead of registering a
    // synonym"). Both doors resolve the throw through that one function, so
    // the REST envelope and the MCP bridge's tool-error agree by construction.
    return Object.assign(new Error(message), { status });
}

/**
 * [#15079] Execute the DECLARATIVE single-record field write — `operation:
 * 'update'` + `patch` (#14092, maintainer ruling 2026-09-01, quoted on the
 * card). ONE implementation, called by BOTH action doors.
 *
 * ## Shared on purpose, for the #14143 reason
 *
 * The REST `/actions` door and the MCP `run_action` bridge are two doors onto
 * one action model, and this repo has now paid twice for a rule implemented at
 * one of them: #14143 (a `recordLoadDenied` signal only one door set) and
 * #15168 (a flow face with no populator at all). An authorization rule is the
 * worst possible thing to fork, and contract point 3 is an authorization rule
 * — so the branch each door owns is three lines, and everything that decides
 * whether a row gets written lives here.
 *
 * ## The identity question, which is the whole card
 *
 * The write goes through the data plane under the CALLER's own
 * `ExecutionContext` — `wiring.ec`, exactly the envelope
 * `resolveExecutionContext` built for this request — and ⛔ NEVER through
 * {@link buildActionExecutionContext}, which forces `isSystem: true`.
 *
 * That elevation is correct for a script BODY (settled design, #3914: a body
 * is trusted code admitted by the invoke-time gates) and it is exactly wrong
 * here, because a declarative update has no body to trust. There is no author
 * code between the caller and the row — the platform performs the write — so
 * the only authorization anywhere on this path is the data plane's own, and it
 * only exists if the caller's identity is what reaches it. An `isSystem` write
 * here would be an RLS/FLS-bypassing field write that any authenticated caller
 * could trigger through a declaration, with no handler, no `ai.exposed` opt-in
 * on the REST door, and nothing in the audit trail to distinguish it from a
 * user edit. That is a privilege escalation, not a bug, which is why the
 * identity lives at this ONE call site and is pinned directly.
 *
 * The direction is the one already ruled for hook `runAs: 'user'` (#14010),
 * consumed here rather than reopened: no `runAs` key is added.
 *
 * ## Why the caller-scope load's VERDICT is consumed rather than re-derived
 *
 * `subject` is {@link loadActionSubjectRecord}'s outcome — the row AND whether
 * the caller's own scope actually delivered it. A caller who cannot read the
 * row is refused HERE, before any write is attempted, on
 * `subject.recordLoadDenied`. Re-deriving that from `subject.record` is the
 * #14143 defect verbatim: the door stamps `record.id = recordId` on a refused
 * load, so `record.id` is truthy either way and `if (!record?.id)` is false on
 * a row the caller cannot see. A swallowed load must never become an implicit
 * grant.
 *
 * ⚠️ The refusal is the SHARED not-found envelope (`recordNotFoundError`, 404
 * `RECORD_NOT_FOUND`) rather than a 403, and that is deliberate: the read path
 * collapses "filtered out by RLS" and "this id names nothing" on purpose
 * (existence non-disclosure), nothing in the caught error separates them, and
 * inventing a 403 for the pair would answer a question the platform declines to
 * answer everywhere else. See the note on `loadActionSubjectRecord`.
 *
 * ## What is NOT checked here
 *
 * `visible` — contract point 6. It is a per-record UI predicate the client
 * evaluates with the record bound, and it is NOT authorization: point 3 is.
 * Treating it as a gate here would put a display rule on the security path
 * (and leave the real gate unimplemented for every caller that is not a
 * browser). Deliberately unread; pinned as unread.
 *
 * A caller who can READ but not WRITE the row is refused by the data plane
 * itself, for the same reason — the write carries the caller's identity, so
 * the object's permissions, its hooks and its validations fire exactly as for a
 * user edit, and their refusals propagate untouched to the door's catch.
 */
export async function executeDeclarativeUpdateAction(
    _deps: ActionExecutionDeps,
    action: any,
    wiring: {
        objectName: string;
        actionName: string;
        /** The caller-scope load outcome — record AND verdict, from ONE producer. */
        subject: ActionSubjectRecordLoad;
        recordId?: string;
        /** The values the dialog collected. Merged OVER the static `patch`. */
        params: Record<string, unknown>;
        /** The CALLER's execution context. ⛔ Never `buildActionExecutionContext`. */
        ec: any;
        driver?: any;
        envId?: string;
        callData: (action: string, params: any, dataDriver?: any, scopeId?: string, ec?: ExecutionContext) => Promise<any>;
    },
): Promise<DeclarativeUpdateResult> {
    const { objectName, actionName, subject, recordId, params, ec, driver, envId, callData } = wiring;

    // ── contract point 7: no current record ⇒ a LOCATED refusal ──────────────
    // ⛔ Never a silent no-op, and never a write to "whatever row" — a
    // declarative update writes ONE record, the one it runs on. Two shapes
    // reach this, and they get different prescriptions because they have
    // different fixes.
    if (isObjectLessActionKey(objectName)) {
        throw declarativeUpdateRefusal(
            `Action '${actionName}' declares \`operation: '${DECLARATIVE_UPDATE_OPERATION}'\` but is addressed at the ` +
            `object-less action key '${objectName}' — a global action has no current record to write. ` +
            `Give the action an \`objectName\`, or declare it on the object it updates, and invoke it at ` +
            `\`/actions/<object>/${actionName}/<recordId>\`.`,
            400,
        );
    }
    if (!recordId) {
        throw declarativeUpdateRefusal(
            `Action '${actionName}' on '${objectName}' declares \`operation: '${DECLARATIVE_UPDATE_OPERATION}'\` and ` +
            `writes the CURRENT record, but no \`recordId\` was supplied. Invoke it at ` +
            `\`/actions/${objectName}/${actionName}/<recordId>\`, or pass \`{ "recordId": "…" }\` in the body.`,
            400,
        );
    }

    // ── contract point 4: the write bag, patch UNDER params ──────────────────
    const data = declarativeUpdateWrite(action, params);
    if (Object.keys(data).length === 0) {
        // The spec refuses `operation: 'update'` with neither `patch` nor
        // `params` at parse time, so this catches the runtime residual: a
        // params-only action invoked with an empty bag. An update that writes
        // no field is the silent no-op point 7 forbids one step over — it would
        // answer 200 having touched nothing.
        throw declarativeUpdateRefusal(
            `Action '${actionName}' on '${objectName}' has nothing to write: its \`patch\` is empty and no ` +
            `params were supplied. Declare a static \`patch\`, or send the values its \`params\` collect.`,
            400,
        );
    }

    // ── contract point 3: the caller-scope load's VERDICT, consumed ──────────
    if (subject.recordLoadDenied) {
        throw recordNotFoundError(objectName, recordId);
    }

    // ── contract point 2: ONE data-plane update, AS THE CALLER ───────────────
    // ⛔ `ec`, never `buildActionExecutionContext(ec)`. See the docblock — this
    // single argument is the difference between a user edit and a privilege
    // escalation.
    const written = await callData('update', { object: objectName, id: recordId, data }, driver, envId, ec);

    const prior: Record<string, unknown> = subject.record ?? {};
    const record: Record<string, unknown> =
        written && typeof written === 'object' && (written as any).record && typeof (written as any).record === 'object'
            ? (written as any).record
            : { ...prior, ...data };

    // ── contract point 5: `undoable` gets its anchor ─────────────────────────
    let undo: DeclarativeUpdateUndo | undefined;
    if (action?.undoable === true) {
        const undoData: Record<string, unknown> = {};
        // EXACTLY the fields written — the patch names them, which is the whole
        // reason `undoable` has an anchor now. `?? null` rather than a
        // presence test: every written key must carry a value, or the restore
        // silently leaves that field at its new value.
        for (const key of Object.keys(data)) undoData[key] = prior[key] ?? null;
        undo = {
            type: DECLARATIVE_UPDATE_OPERATION,
            objectName,
            recordId,
            undoData,
            redoData: { ...data },
        };
    }

    return {
        operation: DECLARATIVE_UPDATE_OPERATION,
        object: objectName,
        id: recordId,
        record,
        ...(undo ? { undo } : {}),
    };
}

/**
 * Resolve + invoke a business action by its declarative name for the MCP
 * `run_action` tool. Enforces the AI-exposure gate (`ai.exposed`, #2849), the
 * ADR-0066 D4 capability gate, loads the subject record under the caller's
 * RLS for row-context actions, and dispatches through the framework's
 * `engine.executeAction` (script/body) or automation flow runner (flow).
 * Throws on denial / not-found / handler failure so the tool surfaces a
 * clean tool-error. No service-ai dependency.
 *
 * SECURITY MODEL (#2849, #3914): all gating happens at INVOKE time. A
 * script/body handler then runs as trusted code — its `ctx.engine` and
 * `ctx.api` perform `isSystem` reads/writes that bypass RLS/FLS
 * (SECURITY-DEFINER-like), so the caller's permissions and an agent's
 * ADR-0090 D10 data ceiling do NOT bound what the body does internally. The
 * caller's identity still RIDES the elevated context so those writes stay
 * attributable and org-scoped. Flow actions differ: the flow engine receives
 * the caller's identity below and honours `runAs` (ADR-0049).
 */
export async function invokeBusinessAction(deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    name: string,
    input: { objectName?: string; recordId?: string; params?: Record<string, unknown> },
    wiring: {
        driver: any;
        envId?: string;
        ec: any;
        getMeta: () => any;
        callData: (action: string, params: any, dataDriver?: any, scopeId?: string, ec?: ExecutionContext) => Promise<any>;
    },
): Promise<any> {
    const { driver, envId, ec, getMeta, callData } = wiring;
    const meta: any = await getMeta();
    const params = input?.params && typeof input.params === 'object' ? input.params : {};
    const recordId = typeof input?.recordId === 'string' && input.recordId.length > 0 ? input.recordId : undefined;

    // Resolve the action def by declarative name (optionally scoped).
    const resolved = await resolveActionByName(deps, meta, name, input?.objectName);
    if (!resolved) {
        throw new Error(
            input?.objectName
                ? `Action '${name}' not found on object '${input.objectName}'`
                : `Action '${name}' not found`,
        );
    }
    const { action, objectName, obj } = resolved;

    // Fail-closed on system-object actions (mirrors the object-tool guard).
    if (isSystemObjectName(objectName)) {
        throw new Error(`Action '${name}' is on a system object and is not exposed via MCP`);
    }
    const hasAutomation = Boolean(await resolveAutomationService(deps, requestContext, envId));
    if (!isHeadlessInvokableAction(deps, action, hasAutomation)) {
        throw new Error(
            `Action '${name}' (type='${action?.type ?? 'script'}') cannot be invoked via MCP`,
        );
    }

    // [#2849 / ADR-0011] AI-exposure gate — fail-closed. Bodies run trusted
    // (unbounded by the caller's RLS or an agent's data ceiling), so only
    // actions the author explicitly exposed to AI may be invoked here.
    const exposureError = actionAiExposureError(deps, action, objectName);
    if (exposureError) throw new Error(exposureError);

    // ADR-0066 D4 capability gate — same declaration the REST route enforces.
    const gateError = actionPermissionError(deps, action, ec, objectName);
    if (gateError) throw new Error(gateError);

    // [ADR-0126 §8 item 2] ACTIVATION CONSULT — door 2 of 2. A packaged action
    // the installation switched off is refused here, before the param contract
    // and before the subject record is read: nothing about a disabled action
    // should run, and an agent must not be able to probe its param shape.
    //
    // The engine is resolved for this — the same `getObjectQL` the script
    // branch below uses — because the projection lives on it (ADR-0110 D5's
    // "the engine plugin is the component unconditionally present wherever
    // actions execute"). A flow-type action is refused here too: the switch is
    // the ACTION's, independent of whatever its target flow's own ledger row
    // says, so this must sit AHEAD of the type branch.
    {
        const activationEngine: any = await deps.getObjectQL(requestContext, envId).catch(() => undefined);
        const refusal = disabledActionRefusal(deps, activationEngine, action);
        // Thrown with `code` + `status` so the ADR-0112 envelope survives the
        // bridge: `resolveThrownHttpError` reads both, and the MCP tool surface
        // gets a clean tool-error instead of a 500 (the #7535/#8055 shape).
        if (refusal) {
            throw Object.assign(new Error(refusal.message), { code: refusal.code, status: refusal.status });
        }
    }

    // [ADR-0104 D2] Declared param contract — same enforcement as the REST
    // route. AI/MCP is the caller most likely to send a plausible-but-wrong
    // bag, and a rejection is corrective feedback the agent consumes in-loop,
    // which a server-side warning never was. Strict by default (#3438);
    // OS_ALLOW_LAX_ACTION_PARAMS=1 restores the pass-through.
    const paramError = enforceActionParams(deps, action, obj, params, { objectName, actionName: name });
    if (paramError) throw new Error(paramError);

    // Load the subject record under RLS when row-context (engages the same
    // permission path as get_record — an unseen record reads as not-found).
    // [#14143] Through the ONE shared producer, so this door and the REST
    // `/actions` door emit the same `recordLoadDenied` signal to handlers.
    const subject = await loadActionSubjectRecord(objectName, recordId, () =>
        callData('get', { object: objectName, id: recordId }, driver, envId, ec));
    const record = subject.record;

    // ── declarative update ── [#15079] BEFORE the `type` switch below, and
    // before the trusted-mode plumbing: contract point 1 reads `operation`
    // first, and an action with no handler has no body to elevate for. The
    // shared executor the REST `/actions` door also calls, so the two doors
    // cannot disagree about the identity the write carries — the failure class
    // #14143 and #15168 each paid for once, on this exact seam.
    if (isDeclarativeUpdateAction(action)) {
        const result = await executeDeclarativeUpdateAction(deps, action, {
            objectName, actionName: name, subject, recordId, params, ec, driver, envId, callData,
        });
        return { ok: true, action: action.name, objectName, ...(recordId ? { recordId } : {}), result };
    }

    // [#5372] One shared producer for the user shape (`security/actor-user.ts`),
    // the same one the REST `/actions` route and the AI routes use. What stood
    // here was `name: ec.userName ?? ec.userDisplayName ?? ec.userId` — a `??`
    // chain over two fields `ExecutionContextSchema` never declared and nothing
    // in the repo ever assigned, so its only reachable arm was the id (#4984's
    // dead-limb family). The name now comes from `sys_user.name`, resolved once
    // per request. `organizationId` is the blessed name for the caller's active
    // org (matches columns + `current_user.organizationId`); the action body
    // executes TRUSTED (RLS-bypassing), so a body that wants to scope by org
    // must read it here (#3280).
    const user = actorUserFromExecutionContext(
        ec,
        await resolveActorDisplayName(
            async () => driver ?? await deps.getObjectQL(requestContext, envId),
            ec,
        ),
    );

    // ── flow dispatch ── (shared with the REST /actions route, #3915)
    if (action.type === 'flow') {
        // [#15168] `subject`, not `record`: the shared door derives the flow
        // context's `record` AND its `recordLoadDenied` sibling from the one
        // load outcome, so this door cannot forward the row without the verdict.
        const result = await dispatchFlowAction(deps, requestContext, action, { objectName, subject, params, recordId, ec, envId });
        return { ok: true, action: action.name, objectName, ...(recordId ? { recordId } : {}), result };
    }

    // ── script/body dispatch via the engine's executeAction ──
    // [#4127] `executeAction` is
    // ObjectQL's own surface, outside IDataEngine; `getObjectQL` exists to reach
    // exactly that. Closing this needs ObjectQL's contract written, not a cast.
    const ql: any = await deps.getObjectQL(requestContext, envId);
    if (!ql || typeof ql.executeAction !== 'function') {
        throw new Error('Data engine not available for action dispatch');
    }
    // [#2849] Trusted-mode elevation must be AUDIBLE: the body's `ctx.engine`
    // and `ctx.api` bypass RLS/FLS, so record who triggered which action.
    // [#3914] Wording tracks what the body ACTUALLY gets — a system-elevated
    // context carrying the caller's identity, not a context-less engine.
    console.info(
        `[action-audit] MCP run_action '${action.name}' on '${objectName}' — body executes TRUSTED ` +
        `(system-elevated context, RLS/FLS-bypassing) for user '${ec?.userId ?? 'anonymous'}'` +
        (ec?.principalKind === 'agent' ? ` (AGENT on behalf of '${ec?.onBehalfOf?.userId ?? 'unknown'}')` : ''),
    );
    const actionContext: any = {
        record,
        // [#14143] The caller-scope load's verdict, on the same context the
        // record rides. `ctx.record.id` is present either way (the stamp is
        // load-bearing for record-less actions), so this is the ONLY thing that
        // tells a handler its subject row did not resolve for THIS caller —
        // and the body face carries it too (`sandbox/body-runner.ts`).
        ...actionRecordLoadSignal(subject),
        user,
        session: buildActionSession(deps, ec),
        engine: buildActionEngineFacade(deps, ql, ec),
        // [#3914] `ctx.api` — the ScopedContext a body's `ctx.api.object(...)`
        // resolves to. Absent here, the sandbox synthesized a context-less
        // facade and every owner-scoped write died FORBIDDEN. `executionContext`
        // is the same envelope, carried so the sandbox's own last-resort facade
        // is elevated identically instead of falling back to no identity.
        api: buildActionApi(deps, ql, ec),
        executionContext: buildActionExecutionContext(ec),
        params: { ...params, recordId, objectName },
    };
    // [ADR-0110 D2] Handler-key derivation + the probe rotation are shared with
    // the REST `/actions` route — one addressing algorithm, not two.
    const dispatch = await executeRegisteredAction(
        deps, ql, objectName, resolveActionHandlerKeys(action), actionContext,
    );
    if (!dispatch.dispatched) {
        throw new Error(`No handler registered for action '${name}' on '${objectName}'`);
    }
    // [#11519] Same doubled post-success-navigation diagnostic as the REST
    // seam — the defect is a property of the authored action + handler pair,
    // observable wherever the two meet. Observe-only; the result is untouched.
    const doubled = doubledPostSuccessNavigationWarning(deps, action, dispatch.result, objectName);
    if (doubled) console.warn(doubled);
    return { ok: true, action: action.name, objectName, ...(recordId ? { recordId } : {}), result: dispatch.result ?? null };
}

/**
 * Find an action's declarative definition by name across object metadata,
 * optionally scoped to a single object. Returns the action plus its owning
 * object name, or `null`. Throws when the name is ambiguous across objects
 * and no `objectName` was supplied (so `run_action` can ask for one).
 */
export async function resolveActionByName(deps: ActionExecutionDeps, 
    meta: any,
    name: string,
    objectName?: string,
): Promise<{ action: any; objectName: string; obj: any } | null> {
    const decls = await collectActionDeclarations(deps, meta);
    if (objectName) {
        const hit = decls.find((d) => d.objectName === objectName && d.action?.name === name);
        return hit ? { action: hit.action, objectName, obj: hit.obj } : null;
    }
    const matches = decls.filter((d) => d.action?.name === name);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
        const where = matches.map((m) => m.objectName).join(', ');
        throw new Error(`Action '${name}' exists on multiple objects (${where}); pass objectName to disambiguate`);
    }
    return { action: matches[0].action, objectName: matches[0].objectName, obj: matches[0].obj };
}

/**
 * The MCP surface's single declaration source: every action declaration the
 * bridge may list or invoke, as `{ action, objectName, obj }` rows.
 *
 * Two shapes feed it (#3010):
 *  1. `object.actions` — bundle/artifact objects and authored object rows.
 *  2. Standalone `action` metadata items — Studio-authored rows that the
 *     engine executes since #2608 (`resyncAuthoredActions`) but that never
 *     appear inside any object definition. Their owning object follows the
 *     same convention as the engine registration key (`objectName` field,
 *     legacy `object` field, else the object-less `GLOBAL_ACTION_OBJECT_KEY`).
 *
 * On a key clash (`objectName:name`) the object-embedded declaration wins,
 * mirroring the execution layer's artifact-wins rule — `resyncAuthoredActions`
 * refuses to clobber an artifact-registered handler, so the embedded
 * declaration is the one that matches what actually runs. All MCP gating
 * (`ai.exposed`, ADR-0066 D4, headless-invokability) applies downstream of
 * this collection, unchanged.
 */
export async function collectActionDeclarations(deps: ActionExecutionDeps, 
    meta: any,
): Promise<Array<{ action: any; objectName: string; obj: any }>> {
    const objs: any[] = (await meta?.listObjects?.()) ?? [];
    const objByName = new Map<string, any>();
    for (const obj of objs) {
        if (typeof obj?.name === 'string') objByName.set(obj.name, obj);
    }
    const out: Array<{ action: any; objectName: string; obj: any }> = [];
    const seen = new Set<string>();
    for (const obj of objs) {
        const objectName: string | undefined = obj?.name;
        if (!objectName) continue;
        for (const action of Array.isArray(obj?.actions) ? obj.actions : []) {
            if (!action || typeof action.name !== 'string') continue;
            seen.add(`${objectName}:${action.name}`);
            out.push({ action, objectName, obj });
        }
    }
    let standalone: any[] = [];
    try {
        standalone = (await meta?.loadMany?.('action')) ?? [];
    } catch {
        standalone = []; // no standalone-item source on this metadata service
    }
    for (const action of standalone) {
        if (!action || typeof action.name !== 'string') continue;
        const objectName = standaloneActionObjectName(deps, action);
        const key = `${objectName}:${action.name}`;
        if (seen.has(key)) continue; // object-embedded declaration wins
        seen.add(key);
        out.push({ action, objectName, obj: objByName.get(objectName) });
    }
    return out;
}


/**
 * Owning object of a standalone `action` item: spec `objectName`, then the
 * bundle collector's `object`, else the object-less `GLOBAL_ACTION_OBJECT_KEY`.
 *
 * A DELEGATING ALIAS, not a second spelling. The ladder itself is
 * {@link standaloneActionOwnerKey}, re-exported above — one implementation, so
 * the declaration the MCP surface resolves is the one whose handler
 * `executeAction` will find. This name survives because `ownsRoute` and any
 * out-of-repo importer already call it, and `_deps` stays (unused, as its
 * underscore already said) so the exported signature does not move under them.
 */
export function standaloneActionObjectName(_deps: ActionExecutionDeps, action: any): string {
    return standaloneActionOwnerKey(action);
}



/**
 * True when the error is `executeAction`'s "no such key in the registry" miss
 * rather than a genuine handler failure — the difference between rotating to
 * the next candidate key and surfacing the error to the caller.
 *
 * Matched on the message because that is all `executeAction` throws
 * (`engine.ts`: `Action '<name>' on object '<object>' not found`). A handler
 * whose own message happens to read that way is misclassified as a miss; the
 * rotation ends in a 404 either way, so the blast radius is the status code.
 */
export function isActionNotRegisteredError(err: any): boolean {
    return /Action '.+' on object '.+' not found/i.test(String(err?.message ?? err));
}


/**
 * [#11519] The DOUBLED post-success-navigation diagnostic — the runtime half
 * of the maintainer's 2026-08-24 ruling (refuse the doubled channel; ⛔ no
 * `precedence` contract field).
 *
 * Two channels can name a post-success destination for one `type: 'script'`
 * action: the declared `ActionSchema.onSuccess` block, and the
 * handler-returned `{ redirectUrl }` convention. The statically-knowable half
 * (`onSuccess` beside `opensInNewTab: true`, the schema-visible marker of the
 * handler-redirect channel) is refused at parse time by `@objectstack/spec`.
 * This helper covers the remainder no schema can see — "the handler returns
 * `redirectUrl`" is runtime-only knowledge (`target` names an opaque registry
 * entry; `HookBodySchema` declares no return contract) — at the one seam
 * where both channels are finally in hand: the script dispatch, holding the
 * resolved declaration AND the handler's return value.
 *
 * Returns the warning text on the doubled case, `null` otherwise; the caller
 * logs it (the `actionPermissionError` string-or-null convention). It only
 * OBSERVES — the result still reaches the client intact, and the interim
 * renderer precedence (declared `onSuccess` wins, objectui#5933) still
 * decides the navigation until the author takes the remedy the warning
 * names. `warn`, not `error`, by the degradation-log-level rule: nothing
 * claimed-persisted is lost, and the system is visibly navigating — to the
 * declared destination.
 *
 * Both dispatch surfaces call it — the REST `/actions` route and the MCP
 * `run_action` bridge — because the defect it names is a property of the
 * AUTHORED action + handler pair, observable wherever the two meet, not of
 * whichever caller happened to invoke it.
 */
export function doubledPostSuccessNavigationWarning(
    _deps: ActionExecutionDeps,
    actionDef: any,
    result: unknown,
    objectName?: string,
): string | null {
    const navigate: unknown = actionDef?.onSuccess?.navigate;
    if (typeof navigate !== 'string' || navigate.length === 0) return null;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const redirectUrl: unknown = (result as Record<string, unknown>).redirectUrl;
    if (typeof redirectUrl !== 'string' || redirectUrl.length === 0) return null;
    const where = objectName ? `${objectName}/${actionDef?.name ?? '<unnamed>'}` : String(actionDef?.name ?? '<unnamed>');
    return (
        `[action-contract] Action '${where}': the handler returned \`redirectUrl\` while the action `
        + 'also declares `onSuccess.navigate` — two post-success destinations for one success '
        + '(#11519). The DECLARED `onSuccess` wins and the handler\'s `redirectUrl` is ignored '
        + '(interim renderer precedence, objectui#5933). Fix the action, not the renderer: keep '
        + '`onSuccess` and stop returning `redirectUrl` from the handler, or drop `onSuccess` and '
        + 'let the handler return drive the navigation. There is no `precedence` field, by ruling.'
    );
}


/**
 * [ADR-0110 D2] Run a script/body action through the engine's handler
 * registry: rotate the derived key candidates across the object-key rotation
 * (`actionHandlerObjectKeys`), telling an "unregistered key" miss apart from
 * a genuine handler failure.
 *
 * Shared by the REST `/actions` route and the MCP `run_action` bridge so both
 * surfaces address handlers identically. Before it was shared, REST rotated
 * only the OBJECT and used the URL segment verbatim as the key — strictly
 * weaker than MCP, and the reason the documented
 * `POST /api/v1/actions/todo_task/complete_task` curl 404ed for every
 * target-bound action while the Console's `target`-addressed call worked
 * (and skipped the D4 gate on the way past).
 *
 * Reports a total miss as `{ dispatched: false }` rather than throwing, so
 * neither surface has to pattern-match this function's own error message to
 * tell "no handler anywhere" (a routing miss — 404) from "the handler ran and
 * failed" (a business outcome, which propagates). Each surface words its own
 * miss: REST 404s naming the routed object, MCP throws naming the action.
 */
export async function executeRegisteredAction(_deps: ActionExecutionDeps,
    ql: any,
    objectName: string,
    candidates: string[],
    actionContext: any,
): Promise<{ dispatched: boolean; result?: any }> {
    for (const obj of actionHandlerObjectKeys(objectName)) {
        for (const key of candidates) {
            try {
                return { dispatched: true, result: await ql.executeAction(obj, key, actionContext) };
            } catch (err: any) {
                if (!isActionNotRegisteredError(err)) throw err; // real handler failure → surface
            }
        }
    }
    return { dispatched: false };
}


/**
 * Resolve the DECLARATION behind a `<object>/<action>` route pair — the
 * single source the REST `/actions` route reads for the ADR-0066 D4
 * permission gate, the ADR-0104 param contract, and (since #3915) the action
 * TYPE it must dispatch on.
 *
 * Three sources, in the same precedence the execution layer uses:
 *  1. the object's own `actions[]` (bundle/artifact objects + authored object
 *     rows) — object-embedded wins, mirroring `collectActionDeclarations`;
 *  2. the ObjectQL registry's standalone `action` items — `defineAction`
 *     artifacts and rehydrated authored rows, which never appear inside any
 *     object definition;
 *  3. the metadata service's standalone `action` rows — the env-scoped
 *     kernels where the registry carries no copy.
 *
 * Sources 2 and 3 are what the route was missing: a Studio-authored or
 * standalone `defineAction` declaration was invisible here, so its declared
 * `type` (and its `requiredPermissions`) were never read on the REST path
 * even though the MCP path honoured both. A standalone declaration is
 * accepted only when it belongs to the routed object or is object-less — the
 * same key rotation {@link actionHandlerObjectKeys} performs for the handler
 * lookup.
 */
export async function resolveRouteActionDeclaration(deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    args: { ql: any; objectName: string; actionName: string; envId?: string },
): Promise<{ action: any; obj: any; degraded?: boolean; reason?: string }> {
    const { ql, objectName, actionName, envId } = args;

    let obj: any;
    try {
        obj =
            (typeof ql?.getSchema === 'function' ? ql.getSchema(objectName) : undefined) ??
            ql?.registry?.getObject?.(objectName);
    } catch {
        obj = undefined; // schema unresolved → handler-only action
    }
    const embedded = Array.isArray(obj?.actions)
        ? obj.actions.find((a: any) => a?.name === actionName)
        : undefined;
    if (embedded) return { action: embedded, obj };

    const ownsRoute = (action: any): boolean => {
        const owner = standaloneActionObjectName(deps, action);
        return owner === objectName || isObjectLessActionKey(owner);
    };

    try {
        const fromRegistry: any = ql?.registry?.getItem?.('action', actionName);
        if (fromRegistry && ownsRoute(fromRegistry)) return { action: fromRegistry, obj };
    } catch {
        /* registry without an item lookup → fall through to the metadata service */
    }

    // [ADR-0110 D3] A miss and an OUTAGE are different facts. `load` answers
    // `null` for both — a loader that throws is warn-logged and skipped — so
    // reading its `null` as "no declaration, hence no gate to enforce" lets an
    // unreachable metadata plane silently ungate every action it can't see.
    // `loadDiagnosed` reports whether the answer is trustworthy; a service
    // that predates it (or a test double) simply reports nothing degraded.
    let degraded = false;
    let reason: string | undefined;
    try {
        // [#4127 FINDING, batch 5]
        // `metadata` IS contracted, so this `any` is not legitimate — but
        // `loadDiagnosed` is not on IMetadataService, though MetadataManager
        // implements it. Same shape as every gap this line of work has found:
        // call site and implementation agree, the contract is what nobody wrote.
        // Recorded rather than fixed here — adding it changes a public contract
        // and belongs in the batch that adds the four undeclared auth members.
        // [#4127 batch 4] `loadDiagnosed` is on IMetadataService now, so this
        // reads the contract instead of guessing at it.
        const meta = await deps.resolveService(requestContext, 'metadata', envId);
        if (meta && typeof meta.loadDiagnosed === 'function') {
            const diag: any = await meta.loadDiagnosed('action', actionName);
            if (diag?.data && ownsRoute(diag.data)) return { action: diag.data, obj };
            if (diag?.degraded) {
                degraded = true;
                reason = Array.isArray(diag.errors) && diag.errors.length > 0
                    ? diag.errors.join('; ')
                    : 'the metadata plane reported a loader failure';
            }
        } else {
            const fromMeta: any = await meta?.load?.('action', actionName);
            if (fromMeta && ownsRoute(fromMeta)) return { action: fromMeta, obj };
        }
    } catch (err: any) {
        // `resolveService` swallows its own resolution failures, so reaching
        // here means the metadata service itself threw while answering.
        degraded = true;
        reason = err?.message ?? String(err);
    }

    return { action: undefined, obj, degraded, reason };
}

/**
 * [ADR-0110 D5] Back-compat wrapper over the engine-owned reconciliation —
 * the `deps` parameter was never read; kept so existing call sites and tests
 * are source-compatible. New code should import from `@objectstack/objectql`.
 */
export function reconcileActionRegistrations(_deps: ActionExecutionDeps,
    registered: Array<{ objectName: string; actionName: string; package?: string }>,
    declarations: Array<{ action: any; objectName: string }>,
): ReturnType<typeof reconcileActionRegistrationsPure> {
    return reconcileActionRegistrationsPure(registered, declarations);
}
