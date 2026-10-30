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
// [#15124] The facade's `find` judges its own parameter against the SAME
// declaration its type names, so the refusal and the type cannot drift apart.
import { EngineQueryOptionsSchema, DATA_ACTION_TO_API_OPERATION } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isStoredMetadataBodyObject } from '@objectstack/spec/kernel';
import type { IHttpServer, IObjectQLEngine, ServiceSlotContract, ServiceSlotContracts } from '@objectstack/spec/contracts';
import { standardErrorCodeForHttpStatus, type MetadataProtocol } from '@objectstack/spec/api';
// [#15942 / #16293] The confirmation member's SPELLING is the contract, so it
// is imported, never hand-spelled: the door that refuses and the client that
// retries have to agree on it, and two doors each writing their own 'confirm'
// is how one contract becomes two dialects (Prime Directive #12).
import {
    AI_ACTION_CONFIRMATION_MEMBER,
    type AIActionConfirmation,
    type ActionConfirmationRequiredDetails,
} from '@objectstack/spec/contracts';
import { checkApiExposure, type ApiExposureDecision, type ObjectApiDef } from './api-exposure.js';
// [#22823] The ONE walk every door that hands a caller's filter to the engine
// takes to find its nested-relation conditions and each one's target — the data
// door's and the MCP stdio bridge's, imported rather than re-walked so this door
// cannot disagree with them about which conditions a filter holds.
import { relationConditionSites } from '@objectstack/core';
// [#25653] The app-automation elevation mark an action body's context carries
// — see `buildActionExecutionContext`.
import { markAppAutomationElevation } from '@objectstack/core';
// Managing API keys is a signed-in-session act: the one rule this door's
// per-object gate asks beside the exposure decision, shared with `RestServer`.
import { apiKeyManagementCredentialRefusal } from '@objectstack/core';
// [#9446] The ONE #9378 status table. Imported rather than re-read here: this
// door's blanket `FLOW_FAILED` was the second of three readings of one engine
// result, and a second definition of the rule is what let the doors diverge.
import {
    classifyFlowRefusal,
    flowFailureDetails,
    flowFailureEnvelope,
    flowIsUnknown,
    flowNotFoundMessage,
    FLOW_NOT_FOUND_STATUS,
    type FlowRefusalCode,
} from './flow-dispatch-status.js';
// Who may START a flow by name — the one rule the trigger door, this door and
// the declared endpoint share (the maintainer's rulings, letters B and A, and
// the flow's own `requiredPermissions`).
import { flowStartRefusal } from './flow-start-admission.js';
// [ADR-0066 D4] The capability arithmetic the action gate and the flow start
// gate share.
import { missingCapabilities } from './required-capabilities.js';
import type { FlowFailureDetails } from '@objectstack/spec/api';
// [#5138] The ONE 404 envelope a single-record path answers. Imported rather
// than re-spelled so `callData`'s ObjectQL fallback and the protocol service it
// falls back FROM cannot disagree about what "this id names no row" looks like.
// A pure factory — no service resolution — so importing it costs the fallback
// nothing on an assembly where the protocol plugin is absent, which is exactly
// when the fallback runs.
import { recordNotFoundError, omitInternalFieldsFromWriteResponse } from '@objectstack/metadata-protocol';
import { serveStoredMetadataRead, serveStoredMetadataReadsThrough } from './stored-metadata-reader-seam.js';
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
 * [#27681 / ADR-0011] The `sys_*` gate of the MCP action surface, PER ACTION.
 * Returns a human-readable refusal for an action on a system object that its
 * author did not opt into the AI surface, or `null` when the action may pass
 * (a non-system object, or a system-object action declaring `ai.exposed: true`).
 *
 * Maintainer ruling 6513869839 (letter B): a `sys_*` action is reachable over
 * MCP only when the action itself declares `ai: { exposed: true, description }`.
 * The guard that stood here refused EVERY action on a `sys_*` object by name,
 * ahead of the exposure check, so no declaration could open one, while the REST
 * `/actions` door served the same action to the same principal. The refusal now
 * yields to the author's opt-in and to nothing else:
 *
 *  - no deployment switch reaches it (the MCP package's `allowSystemObjects`
 *    stays on the tool layer and gains no reach here — ruling parameter 1);
 *  - every later gate still runs behind it, unchanged: the ADR-0066 D4
 *    capability gate, the ADR-0126 §8 activation consult, the param contract,
 *    the `ai.requiresConfirmation` gate and the subject load under RLS.
 *
 * ONE predicate for the three MCP sites that ask it — `run_action`
 * ({@link invokeBusinessAction}), the `list_actions` bridge and the
 * `resume_run` admission (`domains/mcp.ts`) — so an agent that lists sees
 * exactly the system-object actions it may run.
 */
export function systemObjectActionExposureError(_deps: ActionExecutionDeps, action: any, objectName: string): string | null {
    if (!isSystemObjectName(objectName)) return null;
    // [#21594] The stored-metadata family is NOT opened by the flag: the MCP
    // door never reaches the subject load for one of its tables (a row carries
    // a stored metadata body, credential material included). That boundary
    // predates the ruling, which opened identity actions and named no family
    // table; it held here only because every `sys_*` action was refused.
    if (isStoredMetadataBodyObject(objectName)) {
        return (
            `Action '${action?.name ?? 'unknown'}' is on a system object ('${objectName}') that stores metadata bodies ` +
            `and is never exposed via MCP — read and change those through the metadata API`
        );
    }
    if (action?.ai?.exposed === true) return null;
    return (
        `Action '${action?.name ?? 'unknown'}' is on a system object ('${objectName}') and is not exposed via MCP — ` +
        `a system object's action is reachable here only when its author declares \`ai: { exposed: true, description: … }\` on it`
    );
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
/**
 * The registered object schema a write mouth in this file applies the
 * write-response rules (credential-class mask, `internal` omit) from: the
 * engine's live registry first, then the metadata service. `undefined` when
 * neither answers — callers FAIL CLOSED on that (echo no record), because an
 * unjudged record is exactly the one that may carry a stored credential.
 *
 * [#22823] It is also the read {@link refuseUnservedRelationTargets} takes, for
 * the filtered object's field map and each condition target's `enable` block:
 * the engine's own registry first is the schema the engine's relation lowering
 * reads. That caller falls OPEN on `undefined`, as the exposure gate does.
 */
export async function resolveWriteResponseSchema(
    deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext | undefined,
    ql: any,
    object: string | undefined,
    scopeId?: string,
): Promise<unknown> {
    if (!object) return undefined;
    try {
        const fromEngine = ql?.registry?.getObject?.(object);
        if (fromEngine) return fromEngine;
    } catch {
        // fall through to the metadata service
    }
    try {
        const meta = await deps.resolveService(requestContext as HttpProtocolContext, 'metadata', scopeId);
        return (await (meta as any)?.getObject?.(object)) ?? undefined;
    } catch {
        return undefined;
    }
}

/**
 * [#22823] The runtime action a NESTED-RELATION condition's TARGET is judged as
 * by this door's exposure gate: `query`, which the spec's derivation
 * (`DATA_ACTION_TO_API_OPERATION`) maps to `list`. A condition is a predicate
 * over the whole target — the engine runs `find(target, { where: condition })`
 * bounded by a match cap, not by ids the caller holds — which is the read the
 * target's own filtered query performs. The data door judges the same target as
 * `list` (its own `RELATION_CONDITION_TARGET_OPERATION`, `@objectstack/metadata-protocol`),
 * and so does the MCP stdio bridge (`GATED_ACTIONS.query`).
 */
const RELATION_CONDITION_TARGET_ACTION = 'query';
/** The canonical operation that action derives to, named in the refusal. */
const RELATION_CONDITION_TARGET_OPERATION = DATA_ACTION_TO_API_OPERATION[RELATION_CONDITION_TARGET_ACTION];

/**
 * [#22823] Census row 10 of #22661. `callData` hands a caller's `where` to the
 * ObjectQL ENGINE on two arms: the `query`/`find` fallback that serves when no
 * protocol service resolves, and the `aggregate` arm, which never takes the
 * protocol. The engine lowers each NESTED-RELATION condition
 * (`{ <lookup>: { <field of the related object>: … } }`) by reading the related
 * object as the caller (`ObjectQL.lowerRelationConditions`) and keeping the
 * rows whose related record matched, so the condition is a predicate over an
 * object nobody addressed. The exposure gate at the top of `callData` judges
 * only the ADDRESSED object.
 *
 * So each condition's TARGET is asked the same gate the addressed object is
 * asked ({@link checkApiExposure}, for {@link RELATION_CONDITION_TARGET_ACTION}),
 * before the engine is called, and a target the gate does not serve REFUSES the
 * call. Refused, not withheld: dropping the condition would widen the result.
 * The conditions are found by the one walk the data door
 * (`refuseUnservedRelationTarget`, #22737) and the MCP stdio bridge
 * (`enforceRelationTargetExposure`, #22777) take, `relationConditionSites` from
 * `@objectstack/core`, and the refusal is the data door's: the protocol path
 * this fallback stands in for answers the same condition `404
 * OBJECT_API_DISABLED` / `405 OBJECT_API_METHOD_NOT_ALLOWED`, and one
 * `callData` must not give two answers depending on whether the deployment
 * registered the protocol slot (the #5138 rule this file already keeps).
 *
 * `callData` skips it for a system context on the one decision that skips the
 * addressed gate: these flags govern API exposure, not the engine's own reads. A schema
 * that cannot be resolved finds no condition (the filtered object) or serves
 * (a target), the gate's own fail-open.
 */
async function refuseUnservedRelationTargets(
    deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    engine: unknown,
    object: string,
    where: unknown,
    scopeId?: string,
): Promise<void> {
    if (where == null || typeof where !== 'object') return;
    const schema = await resolveWriteResponseSchema(deps, requestContext, engine, object, scopeId);
    const fields = (schema as { fields?: Record<string, any> } | undefined)?.fields;
    for (const site of relationConditionSites(fields, where)) {
        const target = await resolveWriteResponseSchema(deps, requestContext, engine, site.target, scopeId);
        const gate = checkApiExposure(target as ObjectApiDef | undefined, RELATION_CONDITION_TARGET_ACTION);
        if (!gate.allowed) throw unservedRelationTargetError(site.target, `where.${site.field}`, gate);
    }
}

/**
 * [#23528] The data door's two exposure codes, by the gate's verdict: `404
 * OBJECT_API_DISABLED` for an object whose `apiEnabled` is `false`, and `405
 * OBJECT_API_METHOD_NOT_ALLOWED` with the effective operation set as `allowed`
 * for a verb its `apiMethods` leaves out. That is the pairing `RestServer`
 * answers for the same declaration (`apiAccessDenialFromEnable`).
 *
 * The ONE table both exposure refusals in this file stamp: the addressed
 * object's ({@link refuseUnexposedDataAction}) and a nested-relation
 * condition's target's ({@link unservedRelationTargetError}). One table, so one
 * `callData` never answers the same verdict with two codes. A denial from
 * {@link checkApiExposure} carries exactly one of these two statuses.
 */
function exposureRefusalFields(gate: ApiExposureDecision):
    | { code: 'OBJECT_API_DISABLED'; status: 404 }
    | { code: 'OBJECT_API_METHOD_NOT_ALLOWED'; status: 405; allowed: string[] } {
    return gate.status === 404
        ? { code: 'OBJECT_API_DISABLED', status: 404 }
        : { code: 'OBJECT_API_METHOD_NOT_ALLOWED', status: 405, allowed: gate.allowedOperations ?? [] };
}

/**
 * [#22823] The data door's refusal of an unserved nested-relation condition
 * target, field for field (`refuseUnservedRelationTarget`): `code` and `status`
 * by the gate's verdict ({@link exposureRefusalFields}), the TARGET as `object`
 * (the route's object is not the one switched off), the condition's position
 * as `param`, and the effective operation set as `allowed` on a 405.
 */
function unservedRelationTargetError(target: string, param: string, gate: ApiExposureDecision): Error {
    const consequence = `, so the condition on it at '${param}' was not evaluated and the query was not run. `
        + 'Filter on the lookup\'s stored id instead, or remove the condition.';
    const refusal = exposureRefusalFields(gate);
    const message = refusal.status === 404
        ? `Object '${target}' is not exposed via the API${consequence}`
        : `API operation '${RELATION_CONDITION_TARGET_OPERATION}' is not allowed on object '${target}'${consequence}`;
    return Object.assign(new Error(message), refusal, { object: target, param });
}

/** The engine for a schema lookup, or `undefined` — a lookup failure is judged by the caller's fail-closed branch. */
async function resolveEngineQuietly(deps: ActionExecutionDeps, requestContext: HttpProtocolContext | undefined, envId?: string): Promise<unknown> {
    try {
        return (await deps.getObjectQL(requestContext as HttpProtocolContext, envId)) ?? undefined;
    } catch {
        return undefined;
    }
}

/**
 * [#25120] The by-name object reads {@link readExposureDeclaration} asks of
 * the `protocol` slot, both optional: the slot is unmapped in
 * `ServiceSlotContracts`, and a host may fill it with a partial object.
 * `getMetaItemForExecution` is the server-only face `RestProtocol` declares the
 * same way (`packages/rest/src/rest-server.ts`).
 */
type ExposureDeclarationRead = Partial<Pick<MetadataProtocol, 'getMetaItem'>> & {
    getMetaItemForExecution?: MetadataProtocol['getMetaItem'];
};

/**
 * [#25120] The definition {@link refuseUnexposedDataAction} judges: the object,
 * by name, through the protocol's MERGED read — the read `RestServer`'s own
 * exposure gate makes (`enforceApiAccess`), on the execution face where the
 * protocol has one (no serving decorations: the gate reads `enable` and serves
 * nothing). The metadata service's copy is read only on a host whose protocol
 * has no by-name read: structural absence, answered as before.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * This gate read `IMetadataService.getObject(object)`, and an absent copy is
 * "no declaration", i.e. allowed. On a kernel with an `environmentId` nothing
 * copies into that service the objects a package or a plugin registers in the
 * `SchemaRegistry` during the boot, so such an object declared
 * `apiEnabled: false` was served: measured on that shape, `query_records`
 * answered and `create_record` reached the driver, through the `/mcp` bridge
 * and every other door that asks this gate, while `RestServer` refused the
 * same object `404 OBJECT_API_DISABLED`. One declaration, two verdicts.
 *
 * ── Answers, by what the read returns ─────────────────────────────────────
 *
 * - the item under its own name → judged;
 * - nothing, or an item under another name → `undefined`: no declared
 *   exposure policy, and the data plane's registry gate answers existence
 *   (#3770), as before;
 * - refused `OBJECT_PACKAGE_DISABLED` → that refusal, THROWN
 *   ({@link isObjectPackageDisabledRefusal}): a refusal, not an outage, so it
 *   never falls back to the copy. {@link refuseUnexposedDataAction} decides
 *   who answers it. `RestServer`'s gate reads it as "no declaration"
 *   (`loadObjectItem`) because every REST data route then reaches the
 *   protocol, whose registry gate (`assertObjectRegistered`) refuses with that
 *   same code. `callData`'s `aggregate` arm takes no protocol: it asks the
 *   engine, which serves a disabled package's objects. So the reading this
 *   gate first took from REST served `aggregate_records` on such an object,
 *   one declared `apiEnabled: false` included, where the metadata service's
 *   copy had refused it `OBJECT_API_DISABLED`;
 * - any other throw (the metadata store unreadable) → the metadata service's
 *   copy, the source this gate read before. An outage of the merged read must
 *   not WIDEN exposure: failing open at once would serve an object the copy
 *   still declares off, where this gate refused it before the move. The copy
 *   can only add a refusal the healthy read would also make or a stale one, never
 *   an allowance the caller's fail-open `catch` would not already give.
 */
async function readExposureDeclaration(
    deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    object: string,
    scopeId?: string,
): Promise<unknown> {
    const readCopy = async () => {
        const meta = await deps.resolveService(requestContext, 'metadata', scopeId);
        return await (meta as any)?.getObject?.(object);
    };
    const protocol = await deps.resolveService(requestContext, 'protocol', scopeId) as ExposureDeclarationRead | undefined;
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
    return item !== null && typeof item === 'object' && (item as { name?: unknown }).name === object ? item : undefined;
}

/**
 * [#25120] Whether `err` is the protocol's refusal of an object whose owning
 * package is disabled: the one constructor `@objectstack/metadata-protocol`
 * raises from its by-name reads and its data plane (`code`
 * `OBJECT_PACKAGE_DISABLED`, `status` 404, `object`). A refusal, not an outage
 * and not an absence: {@link readExposureDeclaration} throws it, where every
 * other read failure falls back to the copy, and
 * {@link refuseUnexposedDataAction} decides who answers it.
 */
function isObjectPackageDisabledRefusal(err: unknown): boolean {
    return (err as { code?: unknown } | null)?.code === 'OBJECT_PACKAGE_DISABLED';
}

/**
 * [#25296] Throw the protocol's own `404 OBJECT_PACKAGE_DISABLED` when
 * `object`'s owning package is disabled, and return otherwise. The question
 * the REST `/actions` door asks before it reads an action's declaration: an
 * object the data plane refuses has no action that may run, so neither its
 * declaration gates nor its handler are reached.
 *
 * The read is {@link readExposureDeclaration}'s, the by-name object read the
 * data verbs' exposure gate makes, and the refusal is the one constructor the
 * protocol raises from it and from its data plane: ⛔ never a second copy of
 * the package predicate or of the refusal. Any other answer of that read is
 * not this gate's to give: an absent object is the declaration resolution's
 * to answer, and so is an unreadable metadata plane (ADR-0110 D3), so they
 * pass here unanswered.
 */
export async function refuseDisabledPackageObject(deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    object: string,
    scopeId?: string,
): Promise<void> {
    try {
        await readExposureDeclaration(deps, requestContext, object, scopeId);
    } catch (err) {
        if (isObjectPackageDisabledRefusal(err)) throw err;
    }
}

/**
 * ── Object-level API exposure gate (ADR-0049, #1889) ─────
 * Honour the object's `apiEnabled` / `apiMethods` declarations for external
 * traffic: throws the refusal ({@link checkApiExposure}'s `404` / `405`) when
 * `object` does not expose `action`, and returns otherwise. System/internal
 * contexts bypass — these flags govern API *exposure*, not internal engine
 * self-writes.
 *
 * [#23574] Extracted from {@link callData}, which still asks it first for
 * every caller, so that the runtime dispatcher's `/data` domain can ask the
 * SAME question before its own request-schema gate (`domains/data.ts`): a
 * caller the object refuses is answered the refusal, never a shape verdict
 * about the body it sent. `RestServer` asks `enforceApiAccess` before its
 * twin gate for the same reason. Moved, not copied: this is the one place the
 * dispatcher's exposure decision is resolved.
 *
 * [#23528] The refusal is the data door's, as the nested-relation target's
 * already was: an `Error` carrying `code` and `status` from
 * {@link exposureRefusalFields}, the addressed object as `object`, and
 * `allowed` on a 405. It used to throw `{ statusCode, message }` with no code,
 * so the dispatcher's `/data` door answered `404 RESOURCE_NOT_FOUND` / `405
 * METHOD_NOT_ALLOWED` (codes derived from the status) and the `/mcp` tools
 * rendered the message alone, where `RestServer` and the MCP stdio face answer
 * the same declaration `OBJECT_API_DISABLED` / `OBJECT_API_METHOD_NOT_ALLOWED`.
 * The statuses do not move, and neither does the message.
 *
 * [#25120] An object whose owning package is disabled, whatever it declares:
 * the protocol refuses its by-name read `404 OBJECT_PACKAGE_DISABLED`
 * ({@link readExposureDeclaration}), and `disabledPackage` says who answers
 * that refusal, so every door answers what `RestServer` answers:
 *
 * - `'defer'`, the default: the dispatcher's `/data` door, which asks this gate
 *   BEFORE its request-schema gate as the twin of `RestServer`'s
 *   `enforceApiAccess`. "No declaration", as `enforceApiAccess` reads it
 *   (`loadObjectItem`), so a body that is not a record is answered `400
 *   VALIDATION_FAILED` first, and a well-formed request is refused `404
 *   OBJECT_PACKAGE_DISABLED` when it reaches {@link callData}, as REST's data
 *   plane refuses it.
 * - `'refuse'`: {@link callData}, which every data door reaches where REST
 *   reaches the protocol, and which the `/mcp` bridge asks alone. The
 *   protocol's own error, thrown, on every arm: the `aggregate` arm asks the
 *   engine and never the protocol, and the engine serves a disabled package's
 *   objects, so reading the refusal as "no declaration" there served
 *   `aggregate_records` on such an object, one declared `apiEnabled: false`
 *   included.
 */
export async function refuseUnexposedDataAction(deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    action: string,
    object: unknown,
    scopeId?: string,
    executionContext?: ExecutionContext,
    disabledPackage: 'defer' | 'refuse' = 'defer',
): Promise<void> {
    if (executionContext?.isSystem || !object) return;
    let def: any;
    try {
        def = await readExposureDeclaration(deps, requestContext, String(object), scopeId);
    } catch (err) {
        // [#25120] The protocol's `404 OBJECT_PACKAGE_DISABLED` is a refusal,
        // never a read failure to fall open on: thrown where this gate stands
        // in for the data plane, "no declaration" where the data plane follows.
        if (isObjectPackageDisabledRefusal(err) && disabledPackage === 'refuse') throw err;
        def = undefined; // fall open to schema defaults (apiEnabled=true)
    }
    const gate = checkApiExposure(def, action);
    if (!gate.allowed) {
        throw Object.assign(new Error(gate.reason ?? 'API access denied'), exposureRefusalFields(gate), { object });
    }
    // A write to `sys_api_key` from a principal an API key admitted is refused
    // `403 PERMISSION_DENIED`: changing a key is a signed-in-session act, the
    // answer `/keys` gives (`@objectstack/core` `apiKeyManagementCredentialRefusal`,
    // whose docblock carries the rule). Asked after the exposure verdict, so an
    // operation the object does not expose keeps its `405`, and on this gate
    // because every data face of this door passes it: `/data`, the `/mcp`
    // bridge and the action doors, through {@link callData}. The credential is
    // the one the identity step was told (`HttpProtocolContext.admission`);
    // a context that carries none keeps today's answer.
    const credentialRefusal = apiKeyManagementCredentialRefusal({
        object,
        operation: action,
        credential: requestContext?.admission?.credential,
    });
    if (credentialRefusal) throw credentialRefusal;
}

export async function callData(deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    action: string,
    params: any,
    dataDriver?: any,
    scopeId?: string,
    executionContext?: ExecutionContext,
): Promise<any> {
    // The object-level API exposure gate ({@link refuseUnexposedDataAction}).
    // [#22823] Decided ONCE, here: the same bypass covers each nested-relation
    // condition's target, asked below on the two arms that hand the engine a
    // caller's `where` ({@link refuseUnservedRelationTargets}).
    const exposureGated = !executionContext?.isSystem;
    // [#25120] `'refuse'`: a disabled package's object is refused here, on
    // every arm, the `aggregate` arm that never reaches the protocol included.
    await refuseUnexposedDataAction(deps, requestContext, action, params?.object, scopeId, executionContext, 'refuse');

    const protocol = await deps.resolveService(requestContext, 'protocol', scopeId);
    const qlService = dataDriver ?? await deps.getObjectQL(requestContext, scopeId);
    const ql = qlService ?? await deps.resolveService(requestContext, 'objectql', scopeId);
    const qlOpts = executionContext ? { context: executionContext } : undefined;
    const findOpts = (extra?: any) => {
        const base = qlOpts ? { ...qlOpts } : {};
        return extra ? { ...base, ...extra } : (qlOpts ? base : undefined);
    };
    const writeResponseSchema = () =>
        resolveWriteResponseSchema(deps, requestContext, ql, params?.object, scopeId);

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
            // The engine's write result keeps the stored row whole, so this
            // fallback mouth owes the same write-response rules the protocol
            // ingress applies (credential-class mask, `internal` omit).
            // Fail closed: with no schema to judge the fields by, no record
            // is echoed at all — only the receipt.
            const schema = await writeResponseSchema();
            if (!schema) return { object: params.object, id: record.id };
            omitInternalFieldsFromWriteResponse(schema, record);
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
        // [#23462] `expectedVersion` rides through to `updateData`, whose
        // version check refuses a stale update. This arm forwarded only
        // `{ object, id, data }`, so a token the `/data` domain read was
        // dropped here a second time. Present only when a caller sent one:
        // every other caller hands `{ object, id, data }` and reaches
        // `updateData` as before. The `delete` arm below does the same.
        const expectedVersion = params?.expectedVersion;
        if (protocol && typeof protocol.updateData === 'function') {
            return await protocol.updateData({
                object: params.object,
                id: params.id,
                data: params.data,
                ...(expectedVersion !== undefined ? { expectedVersion } : {}),
                ...(scopeId ? { environmentId: scopeId } : {}),
                context: executionContext,
            });
        }
        // [#23462] The fallback below updates by id and nothing else, so it
        // cannot judge a version. A caller who sent one is refused `501`
        // before anything is read, never updated unguarded: that is the very
        // drop the arm above just closed. The `delete` arm's fallback refuses
        // it the same way.
        if (expectedVersion !== undefined) {
            throw {
                statusCode: 501,
                message: 'This host has no protocol updateData, so it cannot honour expectedVersion or If-Match on an '
                    + 'update. Send the update without them, or update through a host whose protocol implements updateData.',
            };
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
            const record = { ...existing, ...params.data };
            // The echo carries the caller's own patch: a credential-class value
            // in it is masked like a read of the stored row would be. Fail
            // closed, as on create: no schema ⇒ the receipt only.
            const schema = await writeResponseSchema();
            if (!schema) return { object: params.object, id: params.id };
            omitInternalFieldsFromWriteResponse(schema, record);
            return { object: params.object, id: params.id, record };
        }
        throw { statusCode: 503, message: 'Data service not available' };
    }

    if (action === 'delete') {
        // [#23265] `expectedVersion` rides through to `deleteData`, whose
        // version check refuses a stale delete. This arm forwarded only
        // `{ object, id }`, so a token the `/data` domain read was dropped here
        // a second time. Present only when a caller sent one: every other
        // caller hands `{ object, id }` and reaches `deleteData` as before.
        const expectedVersion = params?.expectedVersion;
        if (protocol && typeof protocol.deleteData === 'function') {
            return await protocol.deleteData({
                object: params.object,
                id: params.id,
                ...(expectedVersion !== undefined ? { expectedVersion } : {}),
                ...(scopeId ? { environmentId: scopeId } : {}),
                context: executionContext,
            });
        }
        // [#23265] The fallback below deletes by id and nothing else, so it
        // cannot judge a version. A caller who sent one is refused `501`
        // before anything is read, never deleted unguarded: that is the very
        // drop the arm above just closed. The `/meta` save refuses a
        // precondition its fallback writer cannot honour the same way.
        if (expectedVersion !== undefined) {
            throw {
                statusCode: 501,
                message: 'This host has no protocol deleteData, so it cannot honour ?expectedVersion or If-Match on a '
                    + 'delete. Send the delete without them, or delete through a host whose protocol implements deleteData.',
            };
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
            // [#22823] …and each nested-relation condition's TARGET, before the
            // engine reads it — the protocol path asks the same of the same
            // sites (`refuseUnservedRelationTarget`).
            if (exposureGated) {
                await refuseUnservedRelationTargets(deps, requestContext, ql, params.object, bag.where, scopeId);
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
            // [#22823] This arm takes no protocol, so it is the engine's door on
            // every assembly: each nested-relation condition's TARGET in `where`
            // is asked before the engine aggregates, as the query fallback asks
            // it (the engine lowers relation conditions in `where` only, never
            // in an aggregation's own `filter`).
            if (exposureGated) {
                await refuseUnservedRelationTargets(deps, requestContext, engine, params.object, params.where, scopeId);
            }
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
    const missing = missingCapabilities(required, ec);
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
    // engine that answers the boolean but not the prose. [#27842] Both are
    // written for the person who clicked: no table, no ADR (the engine logs
    // those when it is asked for the sentence; the code rides the envelope).
    const message = typeof ql.describeDisabledAction === 'function'
        ? String(ql.describeDisabledAction(name))
        : 'This action is turned off for this deployment.';
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
    // [#27506] A same-origin `api` action IS server-dispatched: the door
    // forwards it in-process to its declared `target` (see
    // {@link forwardApiAction}). An off-origin one stays browser-only.
    if (type === 'api') return isSameOriginApiTarget(action?.target);
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

// ── `type: 'api'` — the same-origin forward (#27506) ─────────────────────────
//
// Ruling 6499781492 on #27506 (Sales, 2026-10-29, option C in three steps):
// a `type: 'api'` action whose `target` is a SAME-ORIGIN path is dispatched
// through the two action doors like every other declared action. The door
// runs its existing gates — the anonymous floor, the ADR-0066 D4 capability
// gate, the ADR-0126 §8 activation consult, the param contract, the subject
// load — and then forwards the request IN-PROCESS to the declared `target`,
// with the body assembled from the declaration (`recordIdParam` /
// `recordIdField` / `bodyShape` / `bodyExtra` / `method`, the console's own
// rules) and the caller's credentials carried across. The target endpoint
// still authorizes the caller itself (ADR-0066 D4), so the forward adds a
// consult point, never a privilege.
//
// Why this exists: before this change the switch in `sys_metadata_activation`
// could not reach an api action at all — the console fetched `target`
// directly, so "Ban User switched off" still banned (#27506), and the MCP
// `run_action` bridge refused the type outright, so an agent could not do
// what a human click could (North Star §4: one system for people and
// agents). ADR-0066 D4's 2026-07 scope note ("fetched by the browser
// directly and never passes through that route") is amended by #27610; this
// PR lands after it.
//
// What stays browser-only: an api action whose `target` names ANOTHER origin
// (`https://…`). The platform never sees that request, so the door refuses
// it (`headlessActionTypeError`), MCP does not list it, and the activation
// write door refuses to flip it with the reason spelled out
// (`offOriginApiActivationRefusal`) rather than recording a switch that
// would never take effect.

/** `true` for a `target` the server can forward to: a path on this origin. */
export function isSameOriginApiTarget(target: unknown): target is string {
    if (typeof target !== 'string' || target.length < 2) return false;
    if (!target.startsWith('/')) return false;
    // `//host` is protocol-relative (another origin); `/\` is the same thing
    // spelled for browsers that treat a backslash as a slash.
    const second = target.charAt(1);
    return second !== '/' && second !== '\\';
}

/**
 * Why the activation ledger cannot switch THIS api action — `null` when it
 * can (every non-api action, and every same-origin api action).
 *
 * An off-origin api action is executed by the browser against a host the
 * platform never sees, so a ledger row for it would be a switch nobody
 * consults: the panel would show it off and the click would keep working,
 * which is exactly the #27506 defect in a second spelling. The write door
 * refuses the flip with this sentence instead (ADR-0126 §8 item 2 names a
 * consult point AT DISPATCH; this action has no dispatch on this server).
 */
export function offOriginApiActivationRefusal(action: any, objectName?: string): string | null {
    if (action?.type !== 'api' || isSameOriginApiTarget(action?.target)) return null;
    const name: string = action?.name ?? 'unknown';
    const on = objectName ? ` on '${objectName}'` : '';
    const target: string | undefined = typeof action?.target === 'string' ? action.target : undefined;
    return (
        `Action '${name}'${on} is \`type: 'api'\` with an off-origin \`target\`${target ? ` ('${target}')` : ''}: ` +
        `the browser calls that origin directly and this server never sees the request, so the packaged-metadata ` +
        `activation ledger (sys_metadata_activation, ADR-0126 §8) has no dispatch point at which to refuse it. ` +
        `The switch is refused rather than recorded as one that would not take effect. Point the action at a ` +
        `same-origin path (starting with \`/\`) to make it switchable, or remove the action from the app.`
    );
}

/** The request headers the forward carries across from the caller, lower-case. */
const API_FORWARD_HEADER_ALLOWLIST: ReadonlySet<string> = new Set([
    // Identity — the target authorizes the SAME principal the door admitted.
    'authorization', 'cookie', 'x-admin-session-token', 'x-tenant-id', 'x-environment-id', 'x-api-key',
    // What a browser's own fetch would carry, so a target's origin / CSRF
    // check sees the caller's browser, not the server talking to itself.
    'origin', 'referer', 'user-agent', 'accept-language',
    // Proxy provenance, carried AS THE CALLER SENT IT for a target that
    // rate-limits or logs by it — the target applies its own `server.trustProxy`
    // to these, exactly as it does to a direct request. ⛔ This door never
    // reads them itself: the forwarded URL's host is the `Host` header (see
    // {@link forwardApiAction}), because a caller-controlled
    // `X-Forwarded-Host` / `X-Forwarded-Proto` is attacker input unless the
    // deployment declared `server.trustProxy` (`security/inbound-rate-limit.ts`),
    // and this seam has no view of that declaration.
    'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'x-request-id',
]);

/**
 * Marks a forwarded request so a `target` that is itself an action door
 * cannot loop: the door refuses a request already carrying it.
 */
export const API_FORWARD_MARK_HEADER = 'x-objectstack-action-forward';

/** The response headers relayed back to the caller — the credential rotations. */
const API_FORWARD_RELAYED_RESPONSE_HEADERS: readonly string[] = [
    // better-auth's bearer lane (`bearer()` emits `set-auth-token`; #8243's
    // rotation emits `set-admin-session-token`).
    'set-auth-token', 'set-admin-session-token',
];

export type ApiActionRequest = {
    method: string;
    path: string;
    body?: Record<string, unknown>;
};

export type ApiActionRequestRefusal = { status: 400; message: string };

/** The token grammar the console's runner resolves (`${scope.path}`), one scope map. */
function substituteApiTargetTokens(template: string, scopes: Record<string, unknown>): string {
    if (template.indexOf('${') === -1) return template;
    const pattern = new RegExp(`\\$\\{(${Object.keys(scopes).join('|')})\\.([\\w.]+)\\}`, 'g');
    return template.replace(pattern, (match, scope: string, path: string) => {
        const value = path.split('.').reduce<unknown>(
            (acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]),
            scopes[scope],
        );
        // A `ctx` path the server does not carry (`ctx.selection.*`, a page's
        // own keys) is LEFT IN PLACE so the caller refuses it by name, where
        // the console blanks it; a missing `param` is blank on both.
        if (value === undefined && scope === 'ctx') return match;
        return value == null ? '' : encodeURIComponent(String(value));
    });
}

/**
 * The console's page-variable syntax (`ui/packages/.../resolvePageVarTokens.ts`):
 * `{{page.<path>}}`, whitespace tolerated inside the braces. Only this spelling
 * is a browser-only token; any other `{{…}}` is the author's literal text.
 */
const PAGE_VAR_TOKEN_RE = /\{\{\s*page\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\}\}/;

/** Does any string in this value still carry a `{{page.x}}` token? */
function carriesPageToken(value: unknown): boolean {
    if (typeof value === 'string') return PAGE_VAR_TOKEN_RE.test(value);
    if (Array.isArray(value)) return value.some(carriesPageToken);
    if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(carriesPageToken);
    return false;
}

/**
 * [#3447] The decision-output param family: `outputs.<key>`, one param per
 * output an approval node declares (`decisionOutputs`), filled in by the
 * approver while deciding. The key set belongs to the pending request, not to
 * the action, so no `params` list can declare it. A `type: 'api'` request
 * folds the family into its body's `outputs` object
 * ({@link buildApiActionRequest}), the body the approvals decide routes read,
 * and the param contract admits exactly what folds
 * ({@link foldsApiDecisionOutputs}; ADR-0104 D2, amended 2026-10-30). The
 * console's api handler folds the same family by the same rule.
 */
const API_DECISION_OUTPUT_PREFIX = 'outputs.';

/** Is `key` a member of the `outputs.<key>` family — the prefix and a non-empty key? */
export function isApiDecisionOutputParam(key: string): boolean {
    return key.startsWith(API_DECISION_OUTPUT_PREFIX) && key.length > API_DECISION_OUTPUT_PREFIX.length;
}

/** The `bodyShape.wrap` key an api request nests its params under, when the declaration names one. */
function apiBodyWrap(action: any): string | undefined {
    return action?.bodyShape && typeof action.bodyShape === 'object' && typeof action.bodyShape.wrap === 'string' && action.bodyShape.wrap
        ? action.bodyShape.wrap
        : undefined;
}

/**
 * [#27738] Does this action's request fold the `outputs.<key>` family? Only a
 * forwarded `type: 'api'` action whose params sit flat in its body. Under
 * `bodyShape.wrap` the params are nested and the fold never reaches them, and
 * a declarative update (`operation: 'update'`, whatever its `type` says)
 * writes its bag to the row instead of sending it anywhere — so for both, and
 * for every other type, the family stays an unknown param.
 */
export function foldsApiDecisionOutputs(action: any): boolean {
    return !isDeclarativeUpdateAction(action) && action?.type === 'api' && apiBodyWrap(action) === undefined;
}

/**
 * Assemble the request a same-origin `type: 'api'` action makes — method,
 * path and JSON body — from its DECLARATION and the dispatch inputs, by the
 * same rules the console's api handler applies at a click
 * (`useConsoleActionRuntime.tsx` `apiHandler`, kept in step by #27611):
 *
 *  1. `target` interpolation: `${param.X}` from the params bag, `${ctx.X}` from
 *     the caller (`ctx.recordId`, `ctx.user.id`, `ctx.org.id`; `ctx.origin` /
 *     `ctx.apiBase` are `''` on the server, as they are for a same-origin
 *     console), values percent-encoded; then `{field}` from the subject row.
 *  2. The body: the params bag, flat or under `bodyShape.wrap`; the `outputs.*`
 *     fold (#3447); `recordIdParam` seeded from the subject row's
 *     `recordIdField` (default `id`) — or REFUSED when the row cannot supply it
 *     (#8018: a request that names no record is not sent and hoped about);
 *     `organizationId` for an `/api/v1/auth/` target from the caller's active
 *     organization; `bodyExtra` merged LAST.
 *  3. `method` (default `POST`); no body on `DELETE`.
 *
 * Two things a click can resolve and the server cannot are REFUSED, not
 * blanked: a `${ctx.selection.*}` / unknown token left in the path, and a
 * `{{page.<var>}}` token in the params or `bodyExtra` — those are page
 * variables that exist only in the browser. The refusal names them so the
 * author (or #27611's console path) knows what to supply.
 */
export function buildApiActionRequest(
    action: any,
    input: {
        recordId?: string;
        record?: Record<string, unknown> | null;
        params: Record<string, unknown>;
        ec: any;
    },
): ApiActionRequest | ApiActionRequestRefusal {
    const name: string = action?.name ?? 'unknown';
    const target: string = action.target;
    const ec = input.ec ?? {};
    const organizationId: string | undefined =
        typeof ec.tenantId === 'string' && ec.tenantId ? ec.tenantId
        : typeof ec.organizationId === 'string' && ec.organizationId ? ec.organizationId
        : undefined;

    // ── 1. the path ──
    let path = substituteApiTargetTokens(target, {
        param: input.params,
        ctx: {
            origin: '',
            apiBase: '',
            recordId: input.recordId ?? (input.record as any)?.id,
            user: { id: ec.userId, email: ec.email },
            org: { id: organizationId },
        },
    });
    if (input.record && /\{[a-z_][a-z0-9_]*\}/i.test(path)) {
        const row = input.record;
        path = path.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (_m, k: string) => {
            const v = row[k];
            return v == null ? '' : encodeURIComponent(String(v));
        });
    }
    if (/\$\{[\w.]+\}|\{\{/.test(path)) {
        return {
            status: 400,
            message:
                `Action '${name}' has a \`target\` ('${target}') carrying a token this door cannot resolve ` +
                `(the server interpolates \`\${param.*}\`, \`\${ctx.recordId}\`, \`\${ctx.user.id}\`, ` +
                `\`\${ctx.org.id}\` and \`{field}\` from the subject row; a selection or page-variable token ` +
                `exists only in the browser). Pass the value as a param, or call the target from the console.`,
        };
    }
    if (!isSameOriginApiTarget(path)) {
        return { status: 400, message: `Action '${name}' interpolated its \`target\` to '${path}', which is not a same-origin path.` };
    }

    // ── 2. the body ──
    if (carriesPageToken(input.params) || carriesPageToken(action?.bodyExtra)) {
        return {
            status: 400,
            message:
                `Action '${name}' carries a \`{{page.<var>}}\` token in its params or \`bodyExtra\` — a page variable ` +
                `exists only in the browser, so this door cannot resolve it. Pass the value as a plain param, or run ` +
                `the action from the page that owns the variable.`,
        };
    }
    const wrap = apiBodyWrap(action);
    const body: Record<string, unknown> = wrap ? { [wrap]: { ...input.params } } : { ...input.params };
    // [#3447] decision outputs: `outputs.<key>` params fold into `outputs`.
    for (const k of Object.keys(body)) {
        if (isApiDecisionOutputParam(k)) {
            const value = body[k];
            delete body[k];
            if (value === undefined || value === '') continue;
            ((body.outputs ??= {}) as Record<string, unknown>)[k.slice(API_DECISION_OUTPUT_PREFIX.length)] = value;
        }
    }
    // [#8018] `recordIdParam`, seeded from the row or refused — never silently
    // left out. Without a row (a record-less dispatch) only `id` can be seeded,
    // from the routed `recordId`; anything else has no source and the request
    // goes without it, exactly as a console click from a record-less location.
    const recordIdParam: string | undefined = typeof action?.recordIdParam === 'string' && action.recordIdParam ? action.recordIdParam : undefined;
    if (recordIdParam) {
        const field: string = typeof action?.recordIdField === 'string' && action.recordIdField ? action.recordIdField : 'id';
        const row: Record<string, unknown> | undefined =
            input.record && typeof input.record === 'object' ? input.record
            : input.recordId && field === 'id' ? { id: input.recordId }
            : undefined;
        if (row) {
            const label: string = action?.label || name;
            if (!(field in row)) {
                return {
                    status: 400,
                    message:
                        `Action "${label}" identifies its record by "${field}", but that field is not present on the ` +
                        `record — running without it would send a request that names no record.`,
                };
            }
            const value = row[field];
            if (value == null) {
                return {
                    status: 400,
                    message:
                        `Action "${label}" identifies its record by "${field}", but this record has no value for it — ` +
                        `running without it would send a request that names no record.`,
                };
            }
            body[recordIdParam] = value;
        }
    }
    if (/\/api\/v1\/auth\//.test(path) && body.organizationId === undefined && organizationId) {
        body.organizationId = organizationId;
    }
    if (action?.bodyExtra && typeof action.bodyExtra === 'object' && !Array.isArray(action.bodyExtra)) {
        Object.assign(body, action.bodyExtra);
    }

    // ── 3. the method ──
    const method = String(action?.method || 'POST').toUpperCase();
    return method === 'GET' || method === 'DELETE' ? { method, path } : { method, path, body };
}

/** What the in-process forward answered — status, parsed JSON body, relayed headers. */
export type ApiActionForwardAnswer = {
    status: number;
    /**
     * The target's JSON body (`null` for an empty one). A 2xx answer that is
     * not JSON is turned into the door's own 502 refusal before it gets here
     * (see {@link forwardApiAction}); a non-2xx non-JSON answer carries its
     * text as `{ raw }` so the refusal can quote it.
     */
    body: any;
    /**
     * Response headers relayed to the caller (credential rotations).
     * `set-cookie` is a `string[]` — one line per cookie, never comma-joined.
     */
    headers: Record<string, string | string[]>;
};

/**
 * Resolve the in-process request injector: the host server's framework-native
 * app behind `IHttpServer.getRawApp()` (Hono's `app.request(url, init)` — the
 * same seam `@objectstack/verify`'s harness drives every test request
 * through). `null` on a kernel with no `http.server` (a hosted tenant kernel
 * that owns no socket) or an adapter that does not expose its app: the
 * forward then answers 503, never a silent pass.
 */
export async function resolveInProcessRequest(
    deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    envId?: string,
): Promise<((url: string, init: RequestInit) => Promise<Response>) | null> {
    let server: IHttpServer | undefined;
    try {
        server = await deps.resolveService(requestContext, 'http.server', envId);
    } catch {
        return null;
    }
    // `getRawApp` is the contract's one declared framework-specific escape
    // hatch and returns `any` on purpose (its docblock says why).
    const app = typeof server?.getRawApp === 'function' ? server.getRawApp() : undefined;
    if (app && typeof app.request === 'function') return (url, init) => app.request(url, init);
    if (app && typeof app.fetch === 'function') return (url, init) => app.fetch(new Request(url, init));
    return null;
}

/** The 503 for a kernel that cannot forward (no raw app to inject into). */
export function apiActionForwardUnavailableError(action: any): string {
    return (
        `Action '${action?.name ?? 'unknown'}' is a same-origin \`type: 'api'\` action whose \`target\` ` +
        `(${typeof action?.target === 'string' ? `'${action.target}'` : 'endpoint'}) this door forwards to in-process, ` +
        `but this deployment's HTTP server exposes no in-process request path (IHttpServer.getRawApp). ` +
        `Operator: run an HTTP server plugin that implements getRawApp; the action is not dispatched around the door.`
    );
}

/**
 * The 502 for a target that answered 2xx with something other than JSON (a
 * file, HTML, a stream): the door's answer is a JSON envelope and the console's
 * direct fetch read such a body as `{}` — a silent loss this door refuses by name.
 */
export function apiActionNonJsonAnswerError(actionName: string, status: number, contentType: string | null): string {
    return (
        `Action '${actionName}' — its target answered HTTP ${status} with ` +
        `${contentType ? `content-type '${contentType}'` : 'no content-type'}, not JSON. The action doors relay JSON ` +
        `answers only; a target that serves a file or a page is not a \`type: 'api'\` action this door can carry.`
    );
}

/**
 * The subset of a forward's relayed headers an MCP tool result may carry: the
 * bearer lane's pair ({@link API_FORWARD_RELAYED_RESPONSE_HEADERS}), which are
 * JS-visible by design. ⛔ Never `Set-Cookie`: the MCP door admits cookie
 * sessions too, and a tool result is JSON text that whatever script receives
 * it can read — an `HttpOnly` session cookie's value must not travel in it.
 * The REST door relays cookies on the response, where only the browser sees them.
 */
export function mcpRelayableForwardHeaders(headers: Record<string, string | string[]>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of API_FORWARD_RELAYED_RESPONSE_HEADERS) {
        const v = headers[name];
        if (typeof v === 'string' && v) out[name] = v;
    }
    return out;
}

/** The refusal for a forwarded request arriving back at an action door (a loop). */
export function apiActionForwardLoopError(action: any, mark: string): string {
    return (
        `Action '${action?.name ?? 'unknown'}' was reached by the forward of action '${mark}' — a \`type: 'api'\` ` +
        `action whose \`target\` is itself an action door would loop. Point the target at the endpoint that ` +
        `does the work.`
    );
}

/**
 * Forward the assembled request to the declared target, in-process, with the
 * caller's own credentials, and bring the answer back.
 *
 * The URL is `http://<Host header><path>` — the URL the direct request has at
 * this process (the in-process server builds its own requests from `Host`;
 * TLS terminates upstream), so a target that reads `request.url` sees what
 * it would have seen had the browser called it. ⛔ `X-Forwarded-Host` /
 * `X-Forwarded-Proto` are NOT consulted for it: they are caller input unless
 * `server.trustProxy` says otherwise, and this seam cannot see that
 * declaration — they cross to the target as headers, where its own trust
 * rule judges them. Only the allow-listed caller headers cross
 * ({@link API_FORWARD_HEADER_ALLOWLIST}); `Content-Length` / `Host` are the
 * injector's to set. The forward is marked ({@link API_FORWARD_MARK_HEADER})
 * so a door reached by it refuses instead of looping.
 *
 * Relayed back: the status, the JSON body, and the credential-rotation
 * headers a target like `/admin/impersonate-user` emits — `set-auth-token` /
 * `set-admin-session-token` (the bearer lane) and `Set-Cookie` (the cookie
 * lane). Everything else about the answer stays the target's business. A 2xx
 * answer that is not JSON is refused as 502 here: this door answers JSON
 * envelopes (the console's direct fetch read such an answer as `{}`, which
 * is a silent loss, not a result), and a declaration whose target streams a
 * file is not an action this door can carry.
 */
export async function forwardApiAction(
    inject: (url: string, init: RequestInit) => Promise<Response>,
    requestContext: HttpProtocolContext,
    req: ApiActionRequest,
    mark: { objectName: string; actionName: string },
): Promise<ApiActionForwardAnswer> {
    const incoming: Record<string, unknown> =
        requestContext?.request?.headers && typeof requestContext.request.headers === 'object'
            ? requestContext.request.headers
            : {};
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(incoming)) {
        const key = k.toLowerCase();
        if (!API_FORWARD_HEADER_ALLOWLIST.has(key) || v == null) continue;
        headers[key] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    headers.accept = 'application/json';
    headers[API_FORWARD_MARK_HEADER] = `${mark.objectName}/${mark.actionName}`;
    const init: RequestInit = { method: req.method, headers };
    if (req.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(req.body);
    }
    const host = typeof incoming.host === 'string' && incoming.host ? incoming.host : 'localhost';
    const res = await inject(`http://${host}${req.path}`, init);

    const text = await res.text();
    let body: any;
    let isJson = true;
    if (text.length === 0) {
        body = null;
    } else {
        try {
            body = JSON.parse(text);
        } catch {
            isJson = false;
            body = { raw: text };
        }
    }
    if (!isJson && res.status >= 200 && res.status < 300) {
        return {
            status: 502,
            body: {
                success: false,
                error: {
                    code: standardErrorCodeForHttpStatus(502),
                    message: apiActionNonJsonAnswerError(mark.actionName, res.status, res.headers.get('content-type')),
                },
            },
            headers: {},
        };
    }
    const relayed: Record<string, string | string[]> = {};
    for (const name of API_FORWARD_RELAYED_RESPONSE_HEADERS) {
        const value = res.headers.get(name);
        if (value) relayed[name] = value;
    }
    // The cookie lane: `/admin/impersonate-user` answers SIX `Set-Cookie`
    // lines (measured 2026-10-29: session_token, session_data, dont_remember,
    // admin_session, and the deletions of the old ones). They go back as an
    // array, one line each — `Headers.get('set-cookie')` would comma-join
    // them into one unparseable cookie.
    const cookies: string[] =
        typeof (res.headers as any).getSetCookie === 'function' ? (res.headers as any).getSetCookie() : [];
    if (cookies.length > 0) relayed['set-cookie'] = cookies;
    return { status: res.status, body, headers: relayed };
}

/**
 * The payload a successful forward answers as the action's RESULT: the
 * target's `data` when it answered the ObjectStack `{ success, data }`
 * envelope (the console's `apiHandler` unwraps the same way, so a
 * `resultDialog` path reads identically on both paths), else the body itself
 * (a stock better-auth answer is not enveloped).
 *
 * [#27918] A 2xx is read as success whatever its body says: `success: false`
 * on a 2xx is not a refusal here, so `{ success: false, data }` answers `data`
 * and `{ success: false, message }` answers the body itself. The status is
 * the target's verdict and this door relays it rather than sniffing a body.
 * Measured 2026-10-30 against every same-origin `type: 'api'` target declared
 * in this repository (the `sys_*` identity actions over better-auth and the
 * plugin-auth mounts, the approvals routes, the datasource admin routes, the
 * data door, the showcase's flow endpoint, print and form routes, and the
 * objectui declarations): none answers a 2xx with a top-level
 * `success: false`. Each refusal is non-2xx, and the nested
 * `{ success: true, data: { success: false } }` that a flow endpoint's
 * unclassified result or a zero-row delete can answer comes back through
 * this door as the same bytes. A target that starts answering 2xx
 * `success: false` has the defect itself (failures speak HTTP, #3962), and
 * the fix goes in that target, never in a body check here (PD #12).
 */
export function apiActionResultOf(answer: ApiActionForwardAnswer): unknown {
    const body = answer.body;
    return body && typeof body === 'object' && !Array.isArray(body) && 'data' in body && 'success' in body
        ? (body as { data: unknown }).data
        : body;
}

/**
 * [#27738] The members the target's refusal ENVELOPE carries beside `code`,
 * `message` and `httpStatus` — `details`, `userMessage`, `declaredCode`, any
 * other — exactly as the target wrote them; `undefined` when the target did
 * not envelope its refusal (`{ success: false, error: { code, … } }`): a stock
 * better-auth `{ code, message }`, a non-JSON or an empty body.
 *
 * Both doors relay these WHOLE. The REST door used to rebuild the envelope
 * from `code` alone, which dropped everything a caller branches on beside
 * the code: a flow endpoint's `details.innerRefusal` and `userMessage`, an
 * entitlement refusal's `details` (`upgrade_url`, `contact_url`, `plan`,
 * `current`, `limit`). The forward carries the caller's own credentials
 * through the same HTTP stack, so this is the answer the caller gets by
 * calling the target itself: relaying it whole discloses nothing new, and
 * the target's own boundary has already applied its message discipline.
 */
export function apiActionRefusalMembers(answer: ApiActionForwardAnswer): Record<string, unknown> | undefined {
    const body = answer.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.success !== false) return undefined;
    const error = body.error;
    if (!error || typeof error !== 'object' || Array.isArray(error) || typeof error.code !== 'string' || !error.code) return undefined;
    const members: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(error as Record<string, unknown>)) {
        if (key !== 'code' && key !== 'message' && key !== 'httpStatus') members[key] = value;
    }
    return members;
}

/**
 * The thrown shape for a forward the target REFUSED (a non-2xx), for the MCP
 * bridge: `code` + `status` ride the error so `resolveThrownHttpError` serves
 * the target's own status and the agent reads the target's own sentence.
 * [#27738] The envelope's `details` ride it too ({@link apiActionRefusalMembers}),
 * which `run_action` renders beside the code, as the REST door relays them.
 */
export function apiActionForwardRefusal(action: any, answer: ApiActionForwardAnswer): Error {
    const body = answer.body;
    const message: string =
        (body && typeof body === 'object' && typeof body.error?.message === 'string' && body.error.message) ||
        (body && typeof body === 'object' && typeof body.message === 'string' && body.message) ||
        `Action '${action?.name ?? 'unknown'}' — its target answered HTTP ${answer.status}`;
    const code: string =
        (body && typeof body === 'object' && typeof body.error?.code === 'string' && body.error.code) ||
        (body && typeof body === 'object' && typeof body.code === 'string' && body.code) ||
        standardErrorCodeForHttpStatus(answer.status);
    const details = apiActionRefusalMembers(answer)?.details;
    return Object.assign(new Error(message), { code, status: answer.status, ...(details !== undefined ? { details } : {}) });
}

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
    if (type === 'api' && isSameOriginApiTarget(action?.target)) return null;
    const name: string = action?.name ?? 'unknown';
    const on = objectName ? ` on '${objectName}'` : '';
    const target: string | undefined = typeof action?.target === 'string' ? action.target : undefined;
    if (type === 'api') {
        // [#27506] Same-origin api actions ARE dispatched here (the door
        // forwards them in-process, {@link forwardApiAction}); the predicate
        // above already answered `null` for them. What reaches this line is an
        // api action whose `target` names ANOTHER origin, or no path at all:
        // the platform never sees that request, so there is nothing to run.
        return (
            `Action '${name}'${on} is \`type: 'api'\` with an off-origin \`target\`` +
            `${target ? ` ('${target}')` : ''} — the browser calls that origin directly and the server cannot ` +
            `forward to it. Only a same-origin \`target\` (a path starting with \`/\`) is dispatched through ` +
            `this door. Call ${target ? `\`${target}\`` : 'its `target` endpoint'} directly` +
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
        for (const key of flowActionRowIdKeys(action, objectName)) {
            if (seeded[key] === undefined) seeded[key] = rowId;
        }
    }

    return { ...seeded, ...params };
}

/**
 * The keys this door uses to carry the launched row's id into a flow's params
 * bag: `recordId`, the camelCase `<objectName>Id` alias (object-bound actions
 * only), and the action's own declared `recordIdParam`. ONE definition, read by
 * {@link seedFlowActionParams} to seed them and by
 * {@link flowActionCallerParamKeys} to keep them out of the caller-provenance
 * signal — a second copy of this set is how the two would drift.
 */
function flowActionRowIdKeys(action: any, objectName: string): Set<string> {
    const keys = new Set<string>(['recordId']);
    // [066dd3bd06 — the card this comment cited no longer resolves] ONE
    // predicate for "object-less", the same one
    // `dispatchFlowAction` asks before it decides whether to hand the
    // automation service an `object` at all. This used to be a second,
    // narrower comparison (`objectName !== GLOBAL_ACTION_OBJECT_KEY`), and the
    // two parted on exactly one input: a route resolved at the legacy `'*'` was
    // object-less to the envelope and object-BOUND here, so the bag grew a
    // nonsense `'*Id'` alias. The empty-string leg was never the divergence —
    // the `objectName &&` truthiness test this replaces already covered it.
    if (!isObjectLessActionKey(objectName)) {
        keys.add(`${objectName.replace(/_([a-z])/g, (_m: string, c: string) => c.toUpperCase())}Id`);
    }
    if (typeof action?.recordIdParam === 'string' && action.recordIdParam) {
        keys.add(action.recordIdParam);
    }
    return keys;
}

/**
 * [#19846] `AutomationContext.callerParamKeys` for this door: the keys of the
 * CALLER's own `params`, read before {@link seedFlowActionParams} spreads the
 * subject row and the row id in — so the screen node's headless verdict is told
 * which values the caller supplied instead of inferring it from the merged bag.
 *
 * The row-id keys ({@link flowActionRowIdKeys}) are left out even when the
 * caller's bag names them: a client that mirrors the row id into
 * `params.recordId` is addressing the row, not answering a screen. That is also
 * what closes the two constructions the inference could not: with a non-default
 * `recordIdField` and a `recordIdParam` naming a key the record lacks, the
 * seeded row id reached the screen under a name no inference leg could refuse;
 * here that name is simply not in the caller's list.
 */
function flowActionCallerParamKeys(action: any, objectName: string, params: Record<string, unknown>): string[] {
    const rowIdKeys = flowActionRowIdKeys(action, objectName);
    return Object.keys(params).filter((key) => !rowIdKeys.has(key));
}

/**
 * Brand for {@link FlowActionRefusal} — `Symbol.for`, so recognition keeps
 * working even if two module instances of this file ever coexist (src vs
 * dist), where an `instanceof` would silently answer false.
 */
const FLOW_ACTION_REFUSAL_BRAND = Symbol.for('objectstack.runtime.flowActionRefusal');

/**
 * The run artefacts a failed flow dispatch carries beside its status and code
 * — EXACTLY the fields the trigger door ships in `error.details` on its own
 * `400 FLOW_FAILED` arm (`domains/automation.ts`), same names, same source,
 * built by the same `flowFailureDetails` (`./flow-dispatch-status.ts`). The
 * #9585 ruling capped this at two keys (`errorMessage`, `summary`); ruling B′
 * on #24914 (decision batch #379 item 5) relaxes the cap by exactly one,
 * `innerRefusal`, and the spec declares the three-key set once for every flow
 * door as `FlowFailureDetailsSchema` (`@objectstack/spec/api`). This type IS
 * that declaration, so a key beyond the three — a contract widening neither
 * ruling covers — fails the build rather than reaching the wire.
 */
export type FlowActionRunDetails = FlowFailureDetails;

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
    /** The run artefacts the door carries into `error.details`. */
    readonly runDetails: FlowActionRunDetails;
    /**
     * [#24914, ruling B′] The producer-marked END-USER text of the refusal the
     * run's node met (`AutomationResult.userMessage`), absent when the run
     * carries none. A FIELD of the thrown error on purpose: it is the channel
     * `declaredUserMessage` (`@objectstack/types`) reads on every boundary, so
     * the `/actions` handler relays it to the envelope's top level and a door
     * that does not recognise this carrier still reads it off the throw,
     * exactly as it reads an app hook's own marking.
     */
    readonly userMessage?: string;

    constructor(
        message: string,
        refusal: { status: number; code: FlowRefusalCode },
        runDetails: FlowActionRunDetails,
        userMessage?: string,
    ) {
        super(message);
        this.name = 'FlowActionRefusal';
        this.status = refusal.status;
        this.code = refusal.code;
        this.runDetails = runDetails;
        if (userMessage !== undefined) this.userMessage = userMessage;
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
 * [#19846] **The context also says which params keys the CALLER supplied**
 * (`AutomationContext.callerParamKeys`, read off `wiring.params` before any
 * seeding — {@link flowActionCallerParamKeys}). The merged bag cannot say it:
 * the record spread and the row-id seeds sit in it beside the caller's values,
 * and a downstream reader that had to tell them apart could only infer.
 *
 * [#15168] **The wiring takes the subject LOAD, not a bare record.** The flow
 * face of commit f19475c0a's signal (`AutomationContext.recordLoadDenied`, declared by
 * #14244) is derived here, once, from {@link loadActionSubjectRecord}'s
 * outcome — so a caller cannot hand this door a record while dropping the
 * verdict that says the caller could not read it. Both call sites already held
 * that outcome and were passing `subject.record` out of it; taking the whole
 * `subject` removes the second de-facto source rather than adding a key beside
 * it, and makes the omission a compile error instead of a silent inertness one
 * door over (the shape commit f19475c0a fixed).
 */
export async function dispatchFlowAction(deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    action: any,
    wiring: {
        objectName: string;
        /** The caller-scope load outcome — `record` AND its verdict, from ONE producer. */
        subject: ActionSubjectRecordLoad;
        /**
         * The CALLER's own params bag, unseeded — [#19846] its keys become the
         * run's `callerParamKeys`, so nothing may be merged into it upstream.
         */
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
    // The caller × flow check (the maintainer's ruling, letter A: the trigger
    // door's type × caller rule binds every door that starts a flow by name).
    // A caller that is not the system principal may not start a flow declared
    // `runAs: 'system'` whose type is self-triggered (`autolaunched`,
    // `record_change`, `schedule`) — those run on their own trigger or as a
    // sub-flow, so an action that names one is wiring, not an entry. AFTER
    // existence (an unknown target keeps its 404) and BEFORE dispatch (a refused
    // start runs nothing). Both entrances reach this one line — REST `/actions`
    // and MCP `run_action` — and the action's own `requiredPermissions` gate
    // (ADR-0066 D4) has already answered upstream of it at each. Holding that
    // capability does not open such a target: an author who wants members to
    // start elevated logic declares the target `screen` or `api`. Thrown with
    // `code` + `status` so the ADR-0112 envelope survives both entrances, as
    // the 409 / 422 rows below do; the words are the trigger door's own
    // (`flow-start-admission.ts`).
    //
    // [ruling record 6377848497, letter A] The same check then asks the
    // target flow's own `requiredPermissions`, so this door INHERITS the
    // flow's declaration: an action that names a gated flow is gated by it
    // even when the action declares nothing. An action that declares its own
    // list has been answered upstream, so a caller here needs both lists.
    const startRefusal = await flowStartRefusal(automation, action.target, ec);
    if (startRefusal) {
        throw Object.assign(new Error(startRefusal.message), {
            status: startRefusal.status,
            code: startRefusal.code,
        });
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
        // [#28099] The caller's already-resolved posture rung, the trigger
        // door's twin (`buildAutomationContext`): never re-derived or raised,
        // absent when the request carries none. See `AutomationContext.posture`.
        ...(typeof ec?.posture === 'string' && ec.posture.length > 0 ? { posture: ec.posture } : {}),
        // [#22450] The caller's already-resolved language, the trigger door's
        // twin (`buildAutomationContext`): a refused run's message renders in
        // it. See `AutomationContext.locale`.
        ...(typeof ec?.locale === 'string' && ec.locale.length > 0 ? { locale: ec.locale } : {}),
        params: seedFlowActionParams(deps, action, { objectName, record, params, recordId }),
        // [#19846] Which of those keys the CALLER supplied, stated here where it
        // is known rather than inferred downstream from the merged bag.
        callerParamKeys: flowActionCallerParamKeys(action, objectName, params),
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
            //
            // [#24914, ruling B′] Built by the trigger door's own builder
            // (`flowFailureDetails`), so the `innerRefusal` a node's data call
            // met rides here too, and the producer-marked `userMessage` rides
            // the carrier for the handler to put at the envelope's top level.
            // The message keeps this door's wording byte for byte.
            throw new FlowActionRefusal(
                `Flow '${action.target}' failed: ${result.error ?? 'unknown error'}`,
                refusal,
                flowFailureDetails(result),
                flowFailureEnvelope(result)?.userMessage,
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

/**
 * [#15942 / #16293 / ADR-0049] The action-confirmation GATE — the refusal an
 * AI-facing action door answers when the author declared
 * `ai.requiresConfirmation: true` and the request carries no confirmation.
 *
 * ## Why this exists at all
 *
 * `ai.requiresConfirmation` was a SAFETY-shaped flag with no execution path:
 * read once, projected into the `list_actions` summary, and never consulted by
 * `run_action`. That is the exact class ADR-0049 retired
 * `tool.requiresConfirmation` for — "a SAFETY flag that is merely accepted is
 * false compliance" — and the retirement's own prescription pointed authors at
 * THIS key. Maintainer ruling, decision batch #54: enforce it, in the minimal
 * shape — an explicit confirmation on the request, a loud registered refusal
 * when it is absent, and NO approval queue. Nothing is parked, nothing is held
 * for an operator to find later, and there is no resume path: a refused call
 * simply did not run, and the caller confirms and retries.
 *
 * ## Which predicate gates the refusal — the DECLARED flag, never the heuristic
 *
 * This reads `action.ai.requiresConfirmation === true` and nothing else. It is
 * deliberately NARROWER than {@link actionLooksDestructive} directly above,
 * and the two MUST NOT be collapsed even though they share a name:
 *
 *  - {@link actionLooksDestructive} answers "should a client ASK the human
 *    before calling?" for the LISTING, and falls back to the `mode: 'delete'` /
 *    `variant: 'danger'` heuristic when the author declared nothing.
 *  - this one answers "will the server REFUSE without an attestation?" — and an
 *    author who declared nothing has asked for nothing. Gating on the heuristic
 *    would start refusing calls that work today, on a guess the author never
 *    made.
 *
 * So `ai.requiresConfirmation: false` never refuses whatever the action looks
 * like, and an undeclared `mode: 'delete'` action is listed as
 * `requiresConfirmation: true` while remaining invokable without the member.
 * A client that confirms whenever the listing says `true` is always correct;
 * the reverse inference is sound only because the listing predicate is wider.
 *
 * ## Only the boolean `true` is an attestation
 *
 * A truthy string is a transport artefact, not a decision (`AIActionConfirmation`).
 * Absent, `false`, `'true'`, `1` — none of them confirm.
 *
 * ## What this gate is NOT
 *
 * `confirm: true` is an UNVERIFIABLE CALLER CLAIM. An agent that always sends
 * it bypasses the gate entirely; the ruling accepted that model knowingly.
 * ⇒ **The gate makes forgetting loud. It does not prove a human.**
 *
 * ## The enforced set is bounded by `ai.exposed`
 *
 * The doors that enforce this are the doors that enforce the author's AI opt-in
 * — today {@link invokeBusinessAction}, reached from the MCP `run_action` tool.
 * REST `/actions` (`domains/actions.ts`) is NOT `ai.exposed`-gated and sits
 * OUTSIDE this gate: an API-key agent on REST is understood to be outside it
 * rather than silently assumed inside it. Widening the set is its own decision,
 * not a thing to infer from this comment.
 *
 * Returns `undefined` when the call may proceed.
 */
export const ACTION_CONFIRMATION_REQUIRED_CODE = 'ACTION_CONFIRMATION_REQUIRED';
/**
 * 428 Precondition Required — the request is well-formed and the caller is
 * entitled; what is missing is a precondition the caller can add and retry
 * with. The code is registered rather than borrowing the standard
 * `PRECONDITION_REQUIRED` because this one says WHICH precondition, and the
 * `details` below make the retry mechanical.
 */
export const ACTION_CONFIRMATION_REQUIRED_STATUS = 428;

/** The shape the door serves — the ADR-0112 envelope plus its machine-readable `details`. */
export interface ActionConfirmationRefusal {
    code: typeof ACTION_CONFIRMATION_REQUIRED_CODE;
    status: typeof ACTION_CONFIRMATION_REQUIRED_STATUS;
    message: string;
    details: ActionConfirmationRequiredDetails;
}

export function actionConfirmationRefusal(
    _deps: ActionExecutionDeps,
    action: any,
    request: AIActionConfirmation | undefined,
    objectName?: string,
): ActionConfirmationRefusal | undefined {
    // The DECLARED flag only — see the docblock. `!== true` on purpose: an
    // author's `false`, and an absent key, both mean "no gate asked for".
    if (action?.ai?.requiresConfirmation !== true) return undefined;
    // Only the boolean `true` attests.
    if (request?.[AI_ACTION_CONFIRMATION_MEMBER] === true) return undefined;

    const actionName = String(action?.name ?? '');
    const details: ActionConfirmationRequiredDetails = {
        actionName,
        ...(objectName ? { objectName } : {}),
        // Echoed off the constant so a refused caller reads the member's
        // spelling from the refusal instead of hard-coding it from docs.
        confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
    };
    const on = objectName ? ` on '${objectName}'` : '';
    return {
        code: ACTION_CONFIRMATION_REQUIRED_CODE,
        status: ACTION_CONFIRMATION_REQUIRED_STATUS,
        message:
            `Action '${actionName}'${on} declares ai.requiresConfirmation: true — nothing was run. `
            + `Confirm with the human in the loop, then retry this call with `
            + `'${AI_ACTION_CONFIRMATION_MEMBER}': true on the request.`,
        details,
    };
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
        // [#27681] The author's AI opt-in, attested by the bridge that read the
        // declaration. The MCP tool layer reads it to let a `sys_*` action
        // through its own fail-closed filter (`allowSystemObjects` off): it
        // never sees the declaration, so this is the only way the per-action
        // flag reaches it. Emitted only when declared, like `operation`.
        ...(action?.ai?.exposed === true ? { aiExposed: true } : {}),
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
 *
 * ⛔ [#18199] THE `multiple` READ BELOW IS NOT THE MULTI-VALUE QUESTION — do not
 * "align" it on `isMultiValueField` because it matched a grep for
 * `field.multiple`. #18199 is the ruling card for the maintainer decision of
 * 2026-09-13 (decision batch #128 item 5, option 1′) that "multi-valued" has ONE
 * definition, and this site was measured against it and EXCLUDED, for the reason
 * the ADR-0104 D2 sentence above already gives: this function INHERITS an
 * author's declaration onto a descriptor, it does not decide anything from it.
 * The one definition is asked of the descriptor one frame down, where the
 * decision actually happens — `validateActionParams` builds the param's schema
 * with `valueSchemaFor({ type, multiple, options })`, whose last line is
 * `isMultiValueField(def) ? z.array(element) : element`. So the runtime already
 * follows the one definition here, through the spec's own consumer. Pre-computing
 * the verdict into this field would ALSO break the inheritance contract: the key
 * would stop carrying what the author wrote, and the predicate would then be
 * applied to its own output.
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
 * The bag ADR-0104 D2 judges: the request's own, less its UNDECLARED
 * `outputs.<key>` decision outputs when this action's request folds them
 * ({@link foldsApiDecisionOutputs}; D2 amended 2026-10-30, #27738). Those
 * keys are per request, so no declaration can name them; the forwarded target
 * (the approvals decide route) judges their values against the request's own
 * `decisionOutputs`. A declared param stays judged as declared, whatever its
 * name, and every other undeclared key is refused exactly as before.
 */
function paramBagUnderContract(action: any, resolved: ResolvedActionParam[], bag: Record<string, unknown>): Record<string, unknown> {
    if (!foldsApiDecisionOutputs(action)) return bag;
    const declared = new Set(resolved.map((p) => p.name));
    const judged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(bag)) {
        if (isApiDecisionOutputParam(key) && !declared.has(key)) continue;
        judged[key] = value;
    }
    return judged;
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
 * ## Which param-less actions keep the pass-through: those with a HANDLER
 *
 * A handler action that declares no `params` keeps the pass-through (ADR-0104
 * D2's boundary, unchanged for it): its handler is the author's own code
 * deciding what its bag means, and there is no declaration to judge the bag by.
 *
 * A declarative update (`operation: 'update'`, {@link isDeclarativeUpdateAction})
 * does NOT, and the reason is what its bag is for (#24268). It has no handler:
 * the bag is merged over `patch` and WRITTEN to the row
 * ({@link declarativeUpdateWrite}). So its declared `params` list is its whole
 * wire write set, and an empty or absent list is an EMPTY accept set rather
 * than an absent contract. Without that reading, an action declaring
 * `patch: { status }` and nothing else wrote any field the caller may write —
 * declared one field, enforced none. Its bag is judged here by the same
 * validator against `[]`, so every key is refused except the dispatcher
 * built-ins: the same message, the same 400 at the REST door, the same
 * `OS_ALLOW_LAX_ACTION_PARAMS` escape hatch a declared-params action gets. No
 * switch of its own.
 *
 * ## One undeclared family a forwarded api action admits (#27738)
 *
 * A `type: 'api'` action whose request folds the `outputs.<key>` decision
 * outputs is judged without them ({@link paramBagUnderContract}), so an
 * Approve or Reject carrying the approver's decision outputs reaches the fold
 * instead of a 400. Every other key is judged as above.
 */
export function enforceActionParams(deps: ActionExecutionDeps,
    action: any,
    obj: any,
    bag: Record<string, unknown>,
    where: { objectName?: string; actionName?: string },
): string | null {
    const declaresParams = Array.isArray(action?.params) && action.params.length > 0;
    if (!declaresParams && !isDeclarativeUpdateAction(action)) return null;
    const resolved = resolveDeclaredActionParams(deps, action, obj);
    const issues = validateActionParams(resolved, paramBagUnderContract(action, resolved, bag));
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
 *
 * [#25653] The elevation also carries the app-automation elevation mark
 * (`'action'`, `@objectstack/core`): an action body is app-authored
 * automation, and the identity-assignment refusal (plugin-security) judges its
 * writes to the four identity objects as it judges a system flow's — through
 * `ctx.api` (the mark is carried across `createContext`'s parse) and
 * `ctx.engine` alike. This builder serves every handler an action door
 * dispatches, a host code handler included; a census of the handlers on
 * `main` found none that writes those objects.
 */
export function buildActionExecutionContext(ec: any): Record<string, unknown> {
    const base = ec && typeof ec === 'object' ? { ...(ec as Record<string, unknown>) } : {};
    return markAppAutomationElevation({ ...base, isSystem: true }, 'action');
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
 *
 * [#21454] Served through the stored-metadata reader seam
 * (`stored-metadata-reader-seam.ts`): this context is elevated, and it is the
 * `ctx.api` a host code handler receives, so a read of the stored-metadata-body
 * family answers the generic data door's form (the body projected, the content
 * hash keyed) and never the stored row. [#21594] An action BODY's API is built
 * over this one by the sandbox (`buildSandboxApi`), whose body layers refuse a
 * family read or write before it reaches this seam.
 */
export function buildActionApi(_deps: ActionExecutionDeps, ql: any, ec: any): any | undefined {
    if (!ql || typeof ql.createContext !== 'function') return undefined;
    try {
        return serveStoredMetadataReadsThrough(ql.createContext(buildActionExecutionContext(ec)), ql);
    } catch {
        // A malformed caller envelope must not sink the action — fall back to
        // the bare elevated context (the same shape hooks default to), marked
        // as the body's elevation like every other (#25653).
        try {
            return serveStoredMetadataReadsThrough(ql.createContext(buildActionExecutionContext(undefined)), ql);
        } catch {
            return undefined;
        }
    }
}

/**
 * The sentence a caller still on the WITHDRAWN bare-filter shape must read
 * (#15124). Exported because the wording IS the contract here: this refusal is
 * a plain `Error` carrying no ADR-0112 `code`/`status` — the same shape its
 * sibling {@link ENGINE_DELETE_REJECT_MESSAGE} has — so a bare `toThrow()`
 * would stay green against any unnamed `Error` at all, and the pin has to
 * compare text.
 */
// The card id stays in this comment and out of the string: a runtime message
// reaches authors and operators who have no tracker to resolve `#NNNN` with
// (#15124, and `check:doc-authoring` enforces it).
export const ACTION_ENGINE_FIND_ENVELOPE_PRESCRIPTION =
    'ctx.engine.find(object, query) takes the engine QUERY ENVELOPE, not a bare filter — '
    + 'move the filter under `where`: find(object, { where: { … } }).';

/**
 * The envelope's own key set, read off the DECLARATION rather than restated.
 *
 * Resolved on first use, never at module load: `EngineQueryOptionsSchema` is a
 * `lazySchema` proxy whose whole purpose is to defer building its closures, and
 * touching `.shape` here would build them for every process that imports this
 * module whether or not an action ever runs.
 */
let actionEngineFindEnvelopeKeys: ReadonlySet<string> | undefined;
function findEnvelopeKeys(): ReadonlySet<string> {
    return (actionEngineFindEnvelopeKeys ??= new Set(
        Object.keys((EngineQueryOptionsSchema as unknown as { shape: Record<string, unknown> }).shape),
    ));
}

/**
 * Refuse the shape #15124 withdrew, loudly, BEFORE the engine sees it.
 *
 * ## Why the engine's own refusal is not enough
 *
 * `ObjectQL.find` already rejects option keys it does not execute (#4371) —
 * but that check deliberately exempts a `null` VALUE, because on an option bag
 * a `null` is a withdrawal carrying no intent a drop could lose. On a FILTER
 * the same rule is exactly wrong: `{ deleted_at: null }` is the "rows with no
 * X" idiom, so the key is dropped, the read widens to every row, and the call
 * resolves. Measured on a real engine over three seeded rows, the excluded row
 * came back with the others.
 *
 * Until this card the facade WRAPPED its argument, so no filter key ever
 * reached that exemption; passing the envelope through without this guard is
 * what would have opened the path. A handler's next line after such a read is
 * routinely a delete, so this is the silent-data-loss class, not a DX nit.
 *
 * ## Why the key set comes from the schema
 *
 * The declared parameter type is `EngineQueryOptions`. Reading the same
 * schema's shape here makes the compile-time refusal and the runtime refusal
 * one fact with one source: a key the type rejects is a key this rejects, and a
 * key the engine grows in the spec is legal in both on the same day.
 *
 * ⚠️ MEASURED DELTA, deliberate: the engine's own `find` set additionally
 * carries six driver pass-through keys (`transaction`, `tenantId`,
 * `tenantIds`, `timezone`, `bypassTenantAudit`, `preserveAudit`) that
 * `EngineQueryOptions` does not declare. They stay refused here. Three of them
 * are tenancy escape hatches, this facade is trusted and context-less by
 * design, and no typed caller can write any of them — so agreeing with the
 * TYPE is both the narrower and the fail-closed reading. Retired keys
 * (`cursor`, `distinct`) are in the shape and pass through on purpose: the
 * engine answers them with their tombstone, which is the better message.
 */
function assertActionEngineFindEnvelope(object: string, query: Record<string, unknown> | undefined): void {
    if (!query) return;
    const legal = findEnvelopeKeys();
    let stray: string[] | undefined;
    for (const key of Object.keys(query)) {
        if (legal.has(key)) continue;
        (stray ??= []).push(key);
    }
    if (!stray) return;
    throw new Error(
        `find('${object}') was given ${stray.length > 1 ? 'keys' : 'a key'} `
        + `${stray.map((k) => `'${k}'`).join(', ')} the query envelope does not carry. `
        + `${ACTION_ENGINE_FIND_ENVELOPE_PRESCRIPTION} `
        + `Envelope keys: ${[...legal].sort().join(', ')}.`,
    );
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
        // Both spellings are DECLARED contract (#15117), not a tolerance: the
        // spec's `ActionEngineFacade.delete` takes `string | string[]`.
        //
        // [#17620] And there is no third, undeclared one. This loop used to
        // open with `if (id != null)`, so a NULLISH element was silently
        // skipped and the call resolved as though the deletion had happened —
        // a silent no-op on a destructive verb. The declared type excludes
        // nullish, so no typed caller ever reached it; the population was
        // UNTYPED hosts (a JS host, a `registerAction` handler whose slot is
        // still `(ctx: any)`), which is exactly the population that cannot see
        // the loss. Every id now goes to `ql.delete` as written, where the
        // engine's own dispatch predicate refuses a `where.id` that is not a
        // truthy scalar (`ENGINE_DELETE_REJECT_MESSAGE`) — the loud answer the
        // declaration already implied. Removing the guard declares nothing new:
        // it pulls the runtime back onto the contract that is already on the
        // record, here, in the spec member doc, and in the `never a null id`
        // pin at `packages/spec/src/ui/action-params.test.ts`.
        async delete(object: string, idOrIds: string | string[]): Promise<void> {
            const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
            for (const id of ids) {
                await ql.delete(object, { where: { id }, context });
            }
        },
        // [#15124] The ENVELOPE goes through — this arm no longer builds one.
        //
        // It used to take the `where` half alone and wrap it
        // (`{ where: query }`, with an empty bag passed through unwrapped), so
        // the facade's parameter shape differed from the engine's for no reason
        // a caller could see. The cost was silent: an author who wrote the
        // engine's own envelope got `{ where: { where: … } }`, which matches no
        // row and resolves to `[]` with no error. The director seat withdrew
        // that parameter shape rather than reserving the field name `where`
        // across every customer's data model to refuse it — one platform, one
        // query shape. The spec member (`ActionEngineFacade.find`,
        // `packages/spec/src/ui/action-params.zod.ts`) now declares
        // `EngineQueryOptions` minus `context`, so the handler writes what the
        // engine reads and this arm only adds the identity.
        //
        // `context` is spread LAST on purpose: the facade is trusted and
        // context-less by design (#3914, ADR-0096), so the elevated context it
        // built wins over any `context` a caller put in the envelope. It is not
        // an authorization the caller gets to choose. Pinned in
        // `action-engine-facade-find-envelope.test.ts`.
        //
        // ⚠️ [#19237] The TYPE no longer admits the key — the spec member
        // subtracts it with `Omit`, ADR-0049's remove arm — but THIS ARM IS
        // UNCHANGED and still accepts it. Two halves, deliberately asymmetric:
        //
        //   - a TYPED caller now gets a compile error at the call site, which
        //     is the whole of the #19237 remedy;
        //   - an UNTYPED one (a JS config handler, a local copy of the context
        //     type, `(ctx: any)`) still passes a `context` and still has it
        //     overridden here, silently, exactly as before.
        //
        // Closing the second half means making this arm THROW on an identity
        // key, which is a runtime permission behaviour change and not a thing a
        // type narrowing gets to smuggle in. `findEnvelopeKeys()` therefore
        // still reads `context` off `EngineQueryOptionsSchema` as legal, and
        // the override — not a refusal — is what the untyped channel gets.
        // ⛔ Do not "finish the job" here without a ruling that covers it.
        async find(object: string, query?: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
            // …and the withdrawn shape is refused HERE, before the engine, so
            // the untyped channel gets the same answer the type gives
            // (`assertActionEngineFindEnvelope` above says why the engine's own
            // check cannot be the whole of it).
            assertActionEngineFindEnvelope(object, query);
            // [#21454] The answer is served through the stored-metadata reader
            // seam: this read is elevated, so a read of the stored-metadata-body
            // family answers the generic data door's form (the body projected,
            // the content hash keyed), never the stored row.
            return serveStoredMetadataRead(object, query, ql, async (q) => {
                const rows = await ql.find(object, { ...((q as Record<string, unknown> | undefined) ?? {}), context } as any);
                return Array.isArray(rows) ? rows : ((rows as any)?.value ?? []);
            });
        },
    };
}

/**
 * The subject-record load's outcome, as the two action doors hand it to a
 * handler (commit f19475c0a).
 */
export interface ActionSubjectRecordLoad {
    /** What the handler receives as `ctx.record`. Unchanged by commit f19475c0a. */
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
 * that load actually delivered the row (commit f19475c0a). ONE producer for both action
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
 * [#16370] Contract point 3, as the ONE function all three action doors call.
 *
 * ## What was wrong
 *
 * {@link loadActionSubjectRecord} computes the caller-scope load's verdict for
 * every door, and exactly ONE door consumed it as a refusal — the declarative
 * update (#15079). The flow door and the script/body door spread the same
 * verdict into the context as a field and PROCEEDED: MCP `run_action` on a
 * `type: 'flow'` action answered `ok: true` and started a persisted run for a
 * `recordId` the caller cannot read — and for an id that names nothing at all —
 * while `get_record` answered "not found" and `update_record` answered "no
 * access" for that same id, in the same session.
 *
 * #15168 made the verdict AVAILABLE to an author's opt-in guard, which is not
 * the same thing as the platform enforcing it, and its own note said so: the
 * reading it left open ("whether the automation engine acts on it … is a
 * separate reading") is this function. A swallowed load must never become an
 * implicit grant — the rule is #15079's, and a rule implemented at one of three
 * doors is the failure class commit f19475c0a and #15168 each already paid for here.
 *
 * ## The predicate is the LOAD's verdict — ⛔ never the action's `locations`
 *
 * `recordLoadDenied` is `true` exactly when a caller-scope load was ATTEMPTED
 * and did not deliver the row: a `recordId` was supplied AND the action key is
 * not object-less. So the two shapes that must not change are excluded BY
 * CONSTRUCTION rather than by a second test that could drift out of step with
 * the producer — a **record-less** action (object-less key) and a **new-record**
 * action (no `recordId`) never attempt a load, so their verdict is never `true`
 * and their stamp behaviour is byte-for-byte what it was.
 *
 * ⛔ NOT {@link summarizeAction}'s `requiresRecord`, which is derived from
 * `locations` — optional metadata an author may omit entirely, which is exactly
 * why contract point 7 refuses to be left to it. An authorization refusal keyed
 * on optional metadata is absent for precisely the authors who declared least.
 *
 * ⚠️ The refusal is the SHARED not-found envelope (`recordNotFoundError`, 404
 * `RECORD_NOT_FOUND`) — ⛔ never a 403, ⛔ never a new "denied" code. The read
 * path collapses "filtered out by RLS" and "this id names nothing" on purpose
 * (existence non-disclosure), nothing in the caught error separates them, and a
 * refusal that distinguished the two would make this door the existence oracle
 * every other door declines to be. #15079 argued it; this consumes the argument
 * rather than reopening it.
 */
export function refuseDeniedSubjectLoad(
    objectName: string,
    recordId: string | undefined,
    subject: ActionSubjectRecordLoad,
): void {
    if (!subject.recordLoadDenied) return;
    // The producer never attempts a load without a `recordId`, so the verdict
    // cannot be `true` without one. The `??` names the id in the envelope; it is
    // ⛔ NOT a second condition — a guard whose extra clause can switch it off is
    // the inert-guard shape this whole seam exists to remove.
    throw recordNotFoundError(objectName, recordId ?? '');
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
 * for word; the spec's `patch` describe states it too. The collected values are
 * the action's DECLARED params (plus the dispatcher built-ins the D2 validator
 * allowlists): both doors run {@link enforceActionParams} first, which refuses
 * every other wire key — on a param-less update too, whose declared accept set
 * is empty (#24268). ⛔ Nothing else from the
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
    // The code is the STANDARD catalog member DERIVED from the status
    // (`standardErrorCodeForHttpStatus`: 400 → `VALIDATION_ERROR`), never a
    // spelled literal — what ADR-0112 asks for when the condition is a generic
    // one, and the ledger's own registration rule says so in as many words ("If
    // the condition is generic … use the standard catalog instead of
    // registering a synonym").
    //
    // [#24268] It is STAMPED on the throw, not left for each door to derive.
    // The REST door's `resolveThrownHttpError` would derive the same member
    // from `status` alone, but the MCP tool renderer (`@objectstack/mcp`'s
    // `thrownRefusalEnvelope`) reads a string `code` and renders a code-less
    // throw as its bare message — measured over the real `/mcp` bridge, where
    // this function's refusals answered message-only while the D2 refusal one
    // gate earlier answered `{ code, message, status }`. The two doors only
    // agree because the code rides the throw.
    return Object.assign(new Error(message), { code: standardErrorCodeForHttpStatus(status), status });
}

/**
 * [#15079] Execute the DECLARATIVE single-record field write — `operation:
 * 'update'` + `patch` (#14092, maintainer ruling 2026-09-01, quoted on the
 * card). ONE implementation, called by BOTH action doors.
 *
 * ## Shared on purpose, for the reason of commit f19475c0a
 *
 * The REST `/actions` door and the MCP `run_action` bridge are two doors onto
 * one action model, and this repo has now paid twice for a rule implemented at
 * one of them: commit f19475c0a (a `recordLoadDenied` signal only one door set) and
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
 * defect commit f19475c0a fixed, verbatim: the door stamps `record.id = recordId` on a refused
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
        /** The request the action arrived on — resolves the schema the result's credential mask reads. */
        requestContext?: HttpProtocolContext;
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
    // [#16370] Through {@link refuseDeniedSubjectLoad}, the ONE implementation
    // the flow door and the script/body door now call too. Behaviour here is
    // unchanged to the byte — what changed is that this is no longer the only
    // door that reads the verdict, so the rule cannot be inert two doors over.
    refuseDeniedSubjectLoad(objectName, recordId, subject);

    // ── contract point 2: ONE data-plane update, AS THE CALLER ───────────────
    // ⛔ `ec`, never `buildActionExecutionContext(ec)`. See the docblock — this
    // single argument is the difference between a user edit and a privilege
    // escalation.
    const written = await callData('update', { object: objectName, id: recordId, data }, driver, envId, ec);

    const prior: Record<string, unknown> = subject.record ?? {};
    // The result carries the caller's merged patch (`record`'s fallback,
    // `undo.redoData`), so it owes the write-response rules a data-plane write
    // response applies: a credential-class value is masked (and a masked value
    // replays as "unchanged" through the echoed-mask guard), an `internal`
    // value is omitted. Fail closed with no schema to judge by: no echoed
    // record, and no undo anchor carrying the patch.
    const responseSchema = await resolveWriteResponseSchema(
        _deps,
        wiring.requestContext,
        driver ?? await resolveEngineQuietly(_deps, wiring.requestContext, envId),
        objectName,
        envId,
    );
    const echoed = (bag: Record<string, unknown>): Record<string, unknown> => {
        const copy = { ...bag };
        omitInternalFieldsFromWriteResponse(responseSchema, copy);
        return copy;
    };
    const record: Record<string, unknown> =
        written && typeof written === 'object' && (written as any).record && typeof (written as any).record === 'object'
            ? (written as any).record
            : responseSchema ? echoed({ ...prior, ...data }) : { id: recordId };

    // ── contract point 5: `undoable` gets its anchor ─────────────────────────
    let undo: DeclarativeUpdateUndo | undefined;
    if (action?.undoable === true && responseSchema) {
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
            redoData: echoed(data),
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
    // [#15942] The confirmation member is MIXED IN from the contract rather
    // than restated here, so this door and the MCP door cannot drift apart on
    // its spelling or its type. It rides at the TOP LEVEL, never inside
    // `params`: that bag is closed against the action author's own declared
    // vocabulary, so a platform member riding there is refused as an unknown
    // param on any action that declares params (and on a declarative update
    // that declares none, #24268), and silently accepted on a handler action
    // that declares none — one placement, two opposite behaviours.
    input: { objectName?: string; recordId?: string; params?: Record<string, unknown> } & AIActionConfirmation,
    wiring: {
        driver: any;
        envId?: string;
        ec: any;
        getMeta: () => any;
        // [#25139] The objects whose `actions[]` the name is resolved against —
        // the MCP bridge passes the listing `list_objects` serves (the
        // protocol's merged read). Left out, the metadata service's
        // `listObjects()` is read, as before.
        readObjects?: () => Promise<readonly any[]>;
        // [#25297] The standalone `action` items the name is resolved against
        // — the MCP bridge passes the protocol's merged `action` listing.
        // Left out, or answering `undefined` (a host with no merged read), the
        // metadata service's `loadMany('action')` is read, as before.
        readActions?: () => Promise<readonly any[] | undefined>;
        callData: (action: string, params: any, dataDriver?: any, scopeId?: string, ec?: ExecutionContext) => Promise<any>;
    },
): Promise<any> {
    const { driver, envId, ec, getMeta, readObjects, readActions, callData } = wiring;
    const meta: any = await getMeta();
    const params = input?.params && typeof input.params === 'object' ? input.params : {};
    const recordId = typeof input?.recordId === 'string' && input.recordId.length > 0 ? input.recordId : undefined;

    // Resolve the action def by declarative name (optionally scoped).
    const resolved = await resolveActionByName(
        deps, meta, name, input?.objectName, await readObjects?.(), await readActions?.(),
    );
    if (!resolved) {
        throw new Error(
            input?.objectName
                ? `Action '${name}' not found on object '${input.objectName}'`
                : `Action '${name}' not found`,
        );
    }
    const { action, objectName, obj } = resolved;

    // Fail-closed on system-object actions, PER ACTION (#27681): a `sys_*`
    // action passes only on its author's `ai.exposed` opt-in, and every gate
    // below still runs for it.
    const systemObjectError = systemObjectActionExposureError(deps, action, objectName);
    if (systemObjectError) throw new Error(systemObjectError);
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
    //
    // [#24268] Thrown with `code` + `status` — the 400 and the standard code
    // the REST door's `deps.error(paramError, 400)` answers — so the MCP tool
    // surface renders the same ADR-0112 envelope rather than a bare sentence
    // (`thrownRefusalEnvelope` reads a string `code`). The code is derived
    // from the status, never spelled, as `declarativeUpdateRefusal` does.
    const paramError = enforceActionParams(deps, action, obj, params, { objectName, actionName: name });
    if (paramError) {
        throw Object.assign(new Error(paramError), { code: standardErrorCodeForHttpStatus(400), status: 400 });
    }

    // [#15942 / #16293] CONFIRMATION GATE — the last pre-dispatch check, and
    // the first one that can refuse a well-formed, fully-entitled request.
    //
    // Placed HERE deliberately: AFTER the param contract, so a caller with a
    // malformed bag still gets the located 400 that tells it how to fix the
    // call; and BEFORE `loadActionSubjectRecord` below, so a refusal reads
    // nothing and writes nothing — "the action body does not run, no record is
    // read or written" is the contract's own sentence, and a gate that refuses
    // after the subject read would only describe the defect instead of ending
    // it. Nothing is queued and nothing is parked (ruling batch #54): the
    // caller confirms with its human and retries the same call.
    const confirmationRefusal = actionConfirmationRefusal(deps, action, input, objectName);
    if (confirmationRefusal) {
        // Thrown with `code` + `status` + `details` so the ADR-0112 envelope
        // survives the bridge intact — the `details` are what let a refused
        // agent rebuild the retry without re-parsing the prose it was handed.
        throw Object.assign(new Error(confirmationRefusal.message), {
            code: confirmationRefusal.code,
            status: confirmationRefusal.status,
            details: confirmationRefusal.details,
        });
    }

    // Load the subject record under RLS when row-context (engages the same
    // permission path as get_record — an unseen record reads as not-found).
    // [commit f19475c0a] Through the ONE shared producer, so this door and the REST
    // `/actions` door emit the same `recordLoadDenied` signal to handlers.
    const subject = await loadActionSubjectRecord(objectName, recordId, () =>
        callData('get', { object: objectName, id: recordId }, driver, envId, ec));
    const record = subject.record;

    // ── declarative update ── [#15079] BEFORE the `type` switch below, and
    // before the trusted-mode plumbing: contract point 1 reads `operation`
    // first, and an action with no handler has no body to elevate for. The
    // shared executor the REST `/actions` door also calls, so the two doors
    // cannot disagree about the identity the write carries — the failure class
    // commit f19475c0a and #15168 each paid for once, on this exact seam.
    if (isDeclarativeUpdateAction(action)) {
        const result = await executeDeclarativeUpdateAction(deps, action, {
            objectName, actionName: name, subject, recordId, params, ec, driver, envId, callData, requestContext,
        });
        return { ok: true, action: action.name, objectName, ...(recordId ? { recordId } : {}), result };
    }

    // ── contract point 3: the caller-scope load's VERDICT, consumed ──────────
    // [#16370] The flow door and the script/body door, on the SAME rule the
    // declarative door has enforced since #15079 — one implementation, three
    // doors. Placed HERE deliberately:
    //
    //  - AFTER the declarative branch above, whose own points 7 and 4 answer a
    //    LOCATED 400 before point 3 ever runs; hoisting the refusal over them
    //    would re-label those prescriptions as a 404;
    //  - BEFORE the identity resolution and everything below it, so no
    //    persisted automation run exists and no trusted body has been entered
    //    when the refusal lands. `ok: true` on a row the caller cannot read is
    //    the defect; refusing after the run was created would only describe it.
    refuseDeniedSubjectLoad(objectName, recordId, subject);

    // ── api forward (#27506) ── a same-origin `type: 'api'` action is
    // forwarded in-process to its declared `target` with the caller's own
    // credentials, AFTER every gate above (exposure, D4, the activation
    // consult, the param contract, confirmation, the subject load) and
    // BEFORE the trusted-mode plumbing below, which an api action never gets:
    // the target endpoint authorizes the caller itself (ADR-0066 D4). The
    // REST `/actions` door runs the identical sequence (`domains/actions.ts`).
    if (action?.type === 'api') {
        const mark = requestContext?.request?.headers?.[API_FORWARD_MARK_HEADER];
        if (typeof mark === 'string' && mark.length > 0) {
            throw Object.assign(new Error(apiActionForwardLoopError(action, mark)), {
                code: standardErrorCodeForHttpStatus(400), status: 400,
            });
        }
        const inject = await resolveInProcessRequest(deps, requestContext, envId);
        if (!inject) {
            throw Object.assign(new Error(apiActionForwardUnavailableError(action)), {
                code: standardErrorCodeForHttpStatus(503), status: 503,
            });
        }
        const built = buildApiActionRequest(action, { recordId, record, params, ec });
        if ('message' in built) {
            throw Object.assign(new Error(built.message), { code: standardErrorCodeForHttpStatus(built.status), status: built.status });
        }
        const answer = await forwardApiAction(inject, requestContext, built, { objectName, actionName: action.name });
        if (answer.status < 200 || answer.status >= 300) throw apiActionForwardRefusal(action, answer);
        return {
            ok: true, action: action.name, objectName, ...(recordId ? { recordId } : {}),
            result: apiActionResultOf(answer),
            // A credential rotation the target emitted (impersonation) — the
            // bearer caller's own new tokens, which only a header could carry
            // over HTTP; over MCP the tool result is the one channel there is.
            // Bearer pair ONLY — see {@link mcpRelayableForwardHeaders} for why
            // no `Set-Cookie` line may enter a tool result.
            ...(() => { const h = mcpRelayableForwardHeaders(answer.headers); return Object.keys(h).length > 0 ? { headers: h } : {}; })(),
        };
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
        // [commit f19475c0a] The caller-scope load's verdict, on the same context the
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
 *
 * `objects` and `actions` are handed to {@link collectActionDeclarations}
 * unchanged.
 */
export async function resolveActionByName(deps: ActionExecutionDeps, 
    meta: any,
    name: string,
    objectName?: string,
    objects?: readonly any[],
    actions?: readonly any[],
): Promise<{ action: any; objectName: string; obj: any } | null> {
    const decls = await collectActionDeclarations(deps, meta, objects, actions);
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
 *
 * [#25139] `objects` are the definitions shape 1 reads; left out, the metadata
 * service's `listObjects()`. The MCP bridge passes the protocol's merged
 * listing, the one `list_objects` serves: on a kernel with an `environmentId`
 * the metadata service holds no copy of an object a package registered during
 * the boot, so its actions were neither listed nor resolved while REST's
 * `/actions` door ran them.
 *
 * [#25297] `actions` are the items shape 2 reads; left out, the metadata
 * service's `loadMany('action')`, whose failure answers none. The MCP bridge
 * passes the protocol's merged `action` listing, the one
 * `GET /api/v1/meta/action` serves. `loadMany` reads the service's loaders
 * alone: they hold the compiled artifact's actions, but not an action a
 * package registers through the `manifest` service (during the boot or by a
 * marketplace install) nor an environment-authored `sys_metadata` row, which
 * live in the registry and the overlay the merged read reads. So a package's
 * object-less action, and an authored one, were never listed nor resolved
 * while REST's `POST /actions/global/NAME` ran them; and an artifact
 * package's action outlived the package's disable there.
 */
export async function collectActionDeclarations(deps: ActionExecutionDeps, 
    meta: any,
    objects?: readonly any[],
    actions?: readonly any[],
): Promise<Array<{ action: any; objectName: string; obj: any }>> {
    const objs: readonly any[] = objects ?? (await meta?.listObjects?.()) ?? [];
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
    let standalone: readonly any[] = [];
    if (actions) {
        standalone = actions;
    } else {
        try {
            standalone = (await meta?.loadMany?.('action')) ?? [];
        } catch {
            standalone = []; // no standalone-item source on this metadata service
        }
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
        + 'also declares `onSuccess.navigate` — two post-success destinations for one success, '
        + 'a pair the contract refuses rather than ranks. The DECLARED `onSuccess` wins and the '
        + 'handler\'s `redirectUrl` is ignored (the interim precedence the console renderer '
        + 'applies, which no contract promises). Fix the action, not the renderer: keep '
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
 * [#21321] The read-only twin of {@link executeRegisteredAction}: would the
 * script door find a handler for this action? Returns a probe over ONE snapshot
 * of the engine's handler registry (`listRegisteredActions()`, the engine's
 * public enumeration of the Map `executeAction` reads), answering for an
 * `(objectName, candidates)` pair by walking exactly the rotation the run door
 * walks — `actionHandlerObjectKeys(objectName)` × the handler-key candidates —
 * and dispatching nothing.
 *
 * It exists so an ADVERTISING surface reads the same source the run doors do.
 * MCP `list_actions` used to admit a script action on its declaration alone
 * (`target || body`), so a declaration nothing had bound — measured: an
 * `os package install`ed package, before its bodies were bound — was listed
 * and then refused by `run_action` with "No handler registered".
 *
 * An engine that cannot enumerate its handlers (no `listRegisteredActions`)
 * answers `false` for everything: the listing then cannot vouch for any script
 * action, and saying nothing is the honest answer — never a fall-back to the
 * declaration, which is the very source this replaces.
 */
export function registeredActionHandlerProbe(_deps: ActionExecutionDeps,
    ql: any,
): (objectName: string, candidates: string[]) => boolean {
    const registered = new Set<string>();
    if (ql && typeof ql.listRegisteredActions === 'function') {
        for (const row of ql.listRegisteredActions() as Array<{ objectName: string; actionName: string }>) {
            registered.add(`${row.objectName}:${row.actionName}`);
        }
    }
    return (objectName, candidates) => {
        for (const obj of actionHandlerObjectKeys(objectName)) {
            for (const key of candidates) {
                if (registered.has(`${obj}:${key}`)) return true;
            }
        }
        return false;
    };
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
 * [#25308] On a host whose `protocol` slot has a by-name read, sources 2 and 3
 * are that read instead: the protocol's merged `action` item, which withholds
 * a disabled package's. The two copies are read only where no such read
 * exists (structural absence, answered as before).
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

    // [#25308] The standalone declaration is the protocol's by-name action
    // read, in {@link readExposureDeclaration}'s shape: the execution face
    // where the protocol has one, the item under its own name or nothing. That
    // read withholds a disabled package's item (it answers it as absent, as
    // `GET /api/v1/meta/action/NAME` does), so such an action resolves to no
    // declaration and the caller's "no declaration" answer is the one a name
    // nothing declares gets. ⛔ The registry and metadata-service copies below
    // are not consulted when the read exists: both keep a disabled package's
    // item, and the package question is the protocol's alone. A read that
    // throws is the metadata plane failing to answer (ADR-0110 D3), never a
    // cue to fall back to a copy that would run that item during the outage.
    const protocol = await deps.resolveService(requestContext, 'protocol', envId) as ExposureDeclarationRead | undefined;
    const byName = typeof protocol?.getMetaItemForExecution === 'function'
        ? protocol.getMetaItemForExecution
        : typeof protocol?.getMetaItem === 'function' ? protocol.getMetaItem : undefined;
    if (byName) {
        let envelope: unknown;
        try {
            envelope = await byName.call(protocol, { type: 'action', name: actionName });
        } catch (err: any) {
            return { action: undefined, obj, degraded: true, reason: err?.message ?? String(err) };
        }
        const item: any = (envelope as { item?: unknown } | null | undefined)?.item;
        const declared = item !== null && typeof item === 'object' && item.name === actionName && ownsRoute(item);
        return { action: declared ? item : undefined, obj };
    }

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
