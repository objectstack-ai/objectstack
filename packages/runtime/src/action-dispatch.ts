// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE admitted sequence of a business action, whichever door asks.
 *
 * Three doors run an action headlessly: the REST `/actions` door
 * (`domains/actions.ts`), the MCP `run_action` bridge
 * (`action-execution.ts#invokeBusinessAction`) and a host's own door, through
 * {@link dispatchAction}. Each door RESOLVES the declaration its own way (the
 * routed `object/action`, an ADR-0150 D5 address, a by-name call over the
 * served listing): that prelude stays the door's. Everything after it lives
 * here, once — the declaration trichotomy (ADR-0110 D3), the ADR-0066 D4
 * capability gate, the ADR-0126 §8 activation consult, the owner gate, the
 * type and availability checks, the body shape, the ADR-0104 param contract,
 * the subject load and the dispatch arms — so no door can drift from another,
 * and a host never keeps a second copy of the rules.
 *
 * ## Posture
 *
 * A door declares one {@link ActionDispatchPosture}:
 *
 *  - `'rest'` — the REST door's rules, exactly.
 *  - `'ai'` — the same rules plus the three that belong to a door an agent
 *    drives, and nothing else: the fail-closed `sys_*` exposure
 *    (`systemObjectActionExposureError`), the author's `ai.exposed` opt-in
 *    (`actionAiExposureError`, ADR-0011), and the `ai.requiresConfirmation`
 *    gate (`actionConfirmationRefusal`). The `ai` posture also keeps the MCP
 *    bridge's invokability check (`isHeadlessInvokableAction`): a script action
 *    with no handler binding is not run for an agent.
 *
 * Every other refusal is the REST door's under both postures, at the REST
 * door's point in the order, so a `url` action whose caller lacks its declared
 * capability is `403` for an agent too, never a type sentence that tells it
 * nothing about why. One refusal keeps that point and that status but not the
 * REST door's sentence: a client-side or off-origin `api` action is refused
 * `400` under `ai` with the AI door's own sentence
 * ({@link aiDoorNotInvokableRefusal}), because the REST prescription — open
 * the `target`, call it directly — is a next step only a REST caller can take.
 *
 * ## What the sequence answers
 *
 * A value, never an HTTP response: a gate's {@link ActionRefusal} (nothing ran,
 * no invocation row), or a dispatched arm's {@link ActionDispatchOutcome}. The
 * door renders it — the REST door and {@link dispatchAction} as the REST
 * envelope ({@link restAnswerOf}), the MCP bridge as its tool result or throw.
 * The invocation row (`action-invocation-audit.ts`) is the door's to write,
 * because only the door knows its surface.
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE, type ObjectKernel,
} from '@objectstack/core';
import { readNamespacePositionSegment } from '@objectstack/spec/kernel';
import { actionsDoorAnswerOf, earnedAnswerOf, staleSummaryAnswerLines, type SummaryRecomputeRefusal } from '@objectstack/types';
import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import type { AIActionConfirmation } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import * as actionExec from './action-execution.js';
import type { ActionExecutionDeps } from './action-execution.js';
import {
    actionInvocationBranch,
    actionInvocationForwardedFrom,
    actionInvocationTarget,
    recordActionInvocation,
    withActionSurface,
} from './action-invocation-audit.js';
import { actorUserFromExecutionContext, resolveActorDisplayName } from './security/actor-user.js';
import { validationFailure, validationFailureDetails, VALIDATION_FAILED_STATUS } from './validation-failure.js';
import { objectValueFailure } from './object-value-shape.js';
import { apiErrorResponse } from './error-envelope.js';
import { HttpDispatcher, type HttpProtocolContext, type HttpDispatcherResult } from './http-dispatcher.js';
import type { DomainHandlerDeps } from './domain-handler-registry.js';
// [ADR-0106 D1] The run doors' visibility question: the `/meta` projection's.
import { actionRunFieldVisibilityRefusal, actionRunMasker, projectActionForCaller } from './action-run-visibility.js';

/**
 * Which door's rules an action call is admitted under — see the module
 * header. `'rest'` is the REST `/actions` door's; `'ai'` adds the three
 * AI-door rules (`sys_*` exposure, `ai.exposed`, confirmation). A host's own
 * door picks the posture of the caller it serves: a door an agent drives
 * takes `'ai'`.
 */
export type ActionDispatchPosture = 'rest' | 'ai';

/**
 * A refusal, before a door renders it. The members are the REST envelope's:
 * `message`, the HTTP `status`, and `details` as `deps.error` takes them (a
 * `code` inside `details` is the envelope's `error.code`; without one the code
 * derives from the status). `userMessage` is the envelope's declared sibling.
 */
export interface ActionRefusal {
    message: string;
    status: number;
    details?: { code?: string; [member: string]: unknown };
    userMessage?: string;
}

/** What a dispatched arm answered. */
export type ActionDispatchOutcome =
    /** The action ran: its result, and the headers an api forward relays. */
    | { kind: 'answered'; result: unknown; headers?: Record<string, string | string[]> }
    /**
     * The arm refused without a throw: the api forward's own refusals (a
     * forward loop, no in-process transport, a request the declaration cannot
     * build), a handler no key carries, and a flow run that failed — whose
     * carrier (`FlowActionRefusal`) rides along as `thrown` for a door that
     * answers by throwing.
     */
    | { kind: 'refused'; refusal: ActionRefusal; thrown?: unknown }
    /** The api forward's target refused: its answer, relayed by the door. */
    | { kind: 'forward-refused'; forward: { status: number; body: unknown; headers: Record<string, string | string[]> } }
    /** The arm threw: the door's own reader answers it. */
    | { kind: 'thrown'; error: unknown };

/** Where the call runs and how it reads data, as the door holds it. */
export interface ActionDispatchWiring {
    /** The caller's envelope. ⛔ Never elevated here: the script arm elevates its own copy. */
    ec: any;
    envId?: string;
    /** The environment-scoped data driver the door holds (`context.dataDriver`). */
    driver: any;
    callData: (action: string, params: any, dataDriver?: any, scopeId?: string, ec?: ExecutionContext) => Promise<any>;
    /** The engine the actor's display name is read through. */
    actorEngine: () => any;
}

/** The door, for its trusted-mode audit line. */
export type ActionDispatchDoor = 'rest' | 'mcp' | 'host';

/** One resolved call, handed to {@link runResolvedAction}. */
export interface ResolvedActionCall {
    posture: ActionDispatchPosture;
    door: ActionDispatchDoor;
    /** The object the call names (the routed one, or the object-less key). */
    objectName: string;
    /** The action name the call asked for. */
    actionName: string;
    /** What the door's resolution answered. */
    declaration: actionExec.RouteActionDeclaration;
    /** The request body: `{ recordId?, params? }`. */
    body: unknown;
    /** A record id the door read from its address (the REST path's third segment). */
    recordIdFromPath?: string;
    /** The AI-door confirmation member, read under the `ai` posture only. */
    confirmation?: AIActionConfirmation;
    /**
     * [ADR-0106 D1] This door's answer for a name nothing declares, where it
     * is not the sequence's own undeclared `404` ({@link undeclaredActionRefusal}):
     * an addressed call's resolver refuses a miss by name in its scope
     * ({@link addressedUnknownNameRefusal}), and the MCP bridge's call naming
     * no object has its own. A declared action the caller is not shown is
     * answered with it, so the door's answers cannot tell the two apart.
     */
    unknownName?: ActionRefusal;
    /** The engine the gates and the script arm read (`executeAction`). */
    ql: any;
    wiring: ActionDispatchWiring;
}

/** A thrown `404` refusal (`code` + `status` on an `Error`), as the {@link ActionRefusal} a door renders. */
export function refusalOfThrown(err: Error & { code: string; status: number }): ActionRefusal {
    return { message: err.message, status: err.status, details: { code: err.code } };
}

/**
 * [ADR-0106 D1] The answer an addressed call (ADR-0150 D5) gets for a name its
 * scope declares none of — what its resolver throws — as a refusal, for
 * {@link ResolvedActionCall.unknownName}.
 */
export function addressedUnknownNameRefusal(
    actionName: string,
    objectName: string | undefined,
    qualifier: actionExec.ActionAddressQualifier,
): ActionRefusal {
    return refusalOfThrown(actionExec.addressedActionNotFoundError(actionName, objectName, actionExec.actionAddressScope(qualifier)));
}

/**
 * [ADR-0106 D6 tier 3] A definition read the visibility question could not
 * make: answered as the field-visibility fault, fail-closed.
 */
class ActionDefinitionReadFault extends Error {
    constructor(readonly objectName: string, readonly reason: unknown) {
        super(`The definition of object '${objectName}' could not be read.`);
    }
}

/**
 * [ADR-0110 D3] The sequence's answer for a name its resolution found no
 * declaration for — and, [ADR-0106 D1], for an action the caller is not shown,
 * where the door states no answer of its own.
 */
function undeclaredActionRefusal(actionName: string, objectName: string): ActionRefusal {
    return {
        message:
            `Action '${actionName}' on '${objectName}' has no declaration — ` +
            `add \`defineAction({ name: '${actionName}', … })\`, or register the handler under a ` +
            `declared action's \`target\`. Undeclared handlers cannot be permission-gated ` +
            `(ADR-0110 D3); startup logs every one of them under [action-governance].`,
        status: 404,
    };
}

/**
 * The AI door's sentence for an action an agent cannot run headlessly: the
 * MCP `run_action` bridge's own, from before the doors shared this sequence
 * (its invokability refusal in `invokeBusinessAction`). Under the `ai`
 * posture it answers both the type refusal (a client-side or off-origin
 * `api` action) and the unbound-script refusal, so an agent is never handed
 * the REST caller's prescription or the action's `target`.
 */
function aiDoorNotInvokableRefusal(actionName: string, actionDef: any): ActionRefusal {
    return { message: `Action '${actionName}' (type='${actionDef?.type ?? 'script'}') cannot be invoked via MCP`, status: 400 };
}

/** The facts of an admitted call that a door's invocation row records. */
export interface AdmittedActionCall {
    actionDef: any;
    objectName: string;
    actionName: string;
    recordId: unknown;
}

/** What {@link runResolvedAction} answers. */
export type ResolvedActionRun =
    | { refused: ActionRefusal }
    | { admitted: AdmittedActionCall; outcome: ActionDispatchOutcome };

/**
 * [#25296] The step every door asks BEFORE it resolves: an object whose owning
 * package is disabled has no action that may run, and is answered the
 * protocol's own `404 OBJECT_PACKAGE_DISABLED` (thrown, `refuseDisabledPackageObject`).
 *
 * ⛔ Before resolution, never after it: the addressed resolver reads the merged
 * listing, which omits a disabled package's object, so a check after it would
 * answer `404 RESOURCE_NOT_FOUND` for the same call. An object-less call names
 * no object to ask about.
 */
export async function refuseDispatchToDisabledObject(
    deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    objectName: string,
    envId?: string,
): Promise<void> {
    if (actionExec.isObjectLessActionKey(objectName)) return;
    await actionExec.refuseDisabledPackageObject(deps, requestContext, objectName, envId);
}

/**
 * The admitted sequence: the gates, in the REST door's order, then the
 * dispatch arms. See the module header.
 */
export async function runResolvedAction(
    deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    call: ResolvedActionCall,
): Promise<ResolvedActionRun> {
    const admission = await admitResolvedAction(deps, requestContext, call);
    if ('refused' in admission) return admission;
    const outcome = await dispatchAdmittedAction(deps, requestContext, call, admission);
    return {
        admitted: { actionDef: admission.actionDef, objectName: call.objectName, actionName: call.actionName, recordId: admission.recordId },
        outcome,
    };
}

interface Admission {
    actionDef: any;
    actionType: string;
    recordId: any;
    params: Record<string, unknown>;
    subject: actionExec.ActionSubjectRecordLoad;
}

async function admitResolvedAction(
    deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    call: ResolvedActionCall,
): Promise<Admission | { refused: ActionRefusal }> {
    const { posture, objectName, actionName, declaration, ql, wiring } = call;
    const refuse = (refusal: ActionRefusal) => ({ refused: refusal });
    const actionSchema = declaration?.obj;
    const actionDef = declaration?.action;

    // [ADR-0150 D3/D5] A name its resolution answers with no one declaration
    // — two holders — is answered with every candidate, never a pick.
    if (declaration.refusal) {
        return refuse({
            message: declaration.refusal.message,
            status: 409,
            details: { code: standardErrorCodeForHttpStatus(409), candidates: declaration.refusal.candidates },
        });
    }

    // [ADR-0110 D3] Resolution is a TRICHOTOMY, and only one branch may
    // dispatch. ── 2/3: the metadata plane could not answer ── an availability
    // failure is not an authorization decision: decline rather than degrade,
    // because the alternative is that an outage quietly removes the gate an
    // author declared.
    if (declaration.degraded) {
        return refuse({
            message:
                `Cannot verify the declaration for action '${actionName}' on '${objectName}' — ` +
                `the metadata plane is unavailable (${declaration.reason ?? 'unknown failure'}). ` +
                `Refusing rather than running it ungated.`,
            status: 503,
        });
    }

    // ── 3/3: genuinely undeclared ── a handler with no declaration is
    // invisible to every governance surface (no D4 capability, no param
    // contract, no AI tool) yet would execute TRUSTED. Refused, with the fix.
    // There is no opt-out: a flag that runs an ungoverned handler IS the
    // fail-open this ruling closes.
    if (!actionDef) return refuse(undeclaredActionRefusal(actionName, objectName));

    // ── 1/3: declared → gate against it ──

    // [ADR-0106 D1] AN ACTION THE CALLER IS NOT SHOWN, THE CALLER CANNOT RUN.
    // "Not shown" is the `/meta` projection's verdict, asked through the same
    // function (`action-run-visibility.ts`) against the object this call runs
    // the action under. Asked FIRST among the gates that read the declaration
    // on the caller's behalf — the AI-door rules, D4's capability gate, the
    // activation consult, the type checks, the param contract — and answered
    // exactly as this door answers a name nothing declares, so no answer tells
    // a withheld action from an unknown name and nothing about its shape is
    // read. A field visibility that cannot be evaluated refuses the run
    // (ADR-0106 D6 tier 3, `503 FIELD_VISIBILITY_UNRESOLVED`, as `/meta`
    // refuses the read). A `passthrough` posture — the system context, a
    // D4-exempt caller, no security service, the mask switched off — runs as
    // before.
    //
    // A definition read that THROWS is a fault, never "no object": judged with
    // no own object, the action's mentions of that object's fields would go
    // unjudged, so a failed read must not open the run.
    let visibility: Awaited<ReturnType<typeof projectActionForCaller>>;
    try {
        visibility = await projectActionForCaller(actionRunMasker(deps, requestContext), {
            action: actionDef,
            objectName,
            obj: actionSchema,
            readObject: (other) => {
                try {
                    return (typeof ql?.getSchema === 'function' ? ql.getSchema(other) : undefined) ?? ql?.registry?.getObject?.(other);
                } catch (cause) {
                    throw new ActionDefinitionReadFault(other, cause);
                }
            },
        });
    } catch (error) {
        if (!(error instanceof ActionDefinitionReadFault)) throw error;
        visibility = { kind: 'fault', object: error.objectName };
    }
    if (visibility.kind === 'fault') {
        const fault = actionRunFieldVisibilityRefusal(visibility.object);
        return refuse({ message: fault.message, status: fault.status, details: { code: fault.code } });
    }
    if (visibility.kind === 'withhold') return refuse(call.unknownName ?? undeclaredActionRefusal(actionName, objectName));
    if (posture === 'ai') {
        // Fail-closed on system-object actions, PER ACTION (#27681): a `sys_*`
        // action passes only on its author's `ai.exposed` opt-in.
        const systemObjectError = actionExec.systemObjectActionExposureError(deps, actionDef, objectName);
        if (systemObjectError) return refuse({ message: systemObjectError, status: 400 });
        // [#2849 / ADR-0011] The AI-exposure gate, fail-closed: bodies run
        // trusted, so only actions the author exposed to AI may run for an agent.
        const exposureError = actionExec.actionAiExposureError(deps, actionDef, objectName);
        if (exposureError) return refuse({ message: exposureError, status: 400 });
    }

    // [ADR-0066 D4] The capability gate — the server is the source of truth.
    // Ahead of every type and availability check, so a caller the gate refuses
    // learns that and nothing about the action's shape.
    const gateError = actionExec.actionPermissionError(deps, actionDef, wiring.ec, objectName);
    if (gateError) return refuse({ message: gateError, status: 403 });

    // [ADR-0126 §8 item 2] ACTIVATION CONSULT — after D4 (an unentitled caller
    // must not learn which packaged actions are switched off), before the type
    // branch, the param contract and the record load: a disabled action runs
    // nothing, discloses no param shape, and reads no record.
    const activationRefusal = actionExec.disabledActionRefusal(deps, ql, actionDef);
    if (activationRefusal) {
        return refuse({ message: activationRefusal.message, status: activationRefusal.status, details: { code: activationRefusal.code } });
    }

    // The handler the dispatch reaches may be one a DIFFERENT declared action
    // owns: that owner's gates apply too. The candidates are the ones the
    // script arm hands `executeRegisteredAction`.
    const ownerRefusal = await actionExec.actionHandlerOwnerRefusal(deps, requestContext, {
        ql,
        action: actionDef,
        objectName,
        candidates: actionExec.resolveActionHandlerKeys(actionDef, actionName),
        ec: wiring.ec,
        envId: wiring.envId,
        obj: actionSchema,
        ...(declaration.packageId !== undefined ? { packageId: declaration.packageId } : {}),
    });
    if (ownerRefusal) {
        return refuse({ message: ownerRefusal.message, status: ownerRefusal.status, details: { code: ownerRefusal.code } });
    }

    // [#3915] Action-TYPE dispatch: only `script`, `flow`, the declarative
    // update and a same-origin `api` action have a server dispatch; a client
    // type is refused with its prescription. The prescription is the REST
    // caller's; under `ai` the same 400 carries the AI door's sentence.
    const actionType: string = typeof actionDef?.type === 'string' ? actionDef.type : 'script';
    const typeError = actionExec.headlessActionTypeError(deps, actionDef, objectName);
    if (typeError) return refuse(posture === 'ai' ? aiDoorNotInvokableRefusal(actionName, actionDef) : { message: typeError, status: 400 });

    // A flow action on a kernel with no automation service is a deployment
    // gap, not a business failure. [#15079] `operation` before `type`.
    if (actionType === 'flow' && !actionExec.isDeclarativeUpdateAction(actionDef)
        && !(await actionExec.resolveAutomationService(deps, requestContext, wiring.envId))) {
        return refuse({ message: actionExec.flowActionUnavailableError(actionDef), status: 503 });
    }

    // The `ai` posture keeps the invokability check the MCP bridge always
    // asked: a script action with no handler binding (`target` / `body`) is
    // not run for an agent. A flow without automation was answered above.
    if (posture === 'ai' && !actionExec.isHeadlessInvokableAction(deps, actionDef, true)) {
        return refuse(aiDoorNotInvokableRefusal(actionName, actionDef));
    }

    // [#25976] The body, and then its params bag, must be objects before the
    // param contract or any handler reads them; `undefined` / `null` stay the
    // legal bodyless call and an absent `params` key keeps its empty bag.
    const invalidBody = (message: string, failure: { field: string; code: 'invalid_type'; message: string }) =>
        refuse({ message, status: VALIDATION_FAILED_STATUS, details: validationFailureDetails(validationFailure(message, [failure])) as ActionRefusal['details'] });
    const bodyFailure = objectValueFailure('(body)', call.body ?? {});
    if (bodyFailure) return invalidBody(`Invalid action body — ${bodyFailure.message}`, bodyFailure);
    const reqBody = (call.body ?? {}) as Record<string, any>;
    const paramsFailure = objectValueFailure('params', reqBody.params);
    if (paramsFailure) return invalidBody(`Invalid action body — \`params\` ${paramsFailure.message}`, paramsFailure);
    const recordId = call.recordIdFromPath ?? reqBody.recordId;
    // The routed record is named by ONE id, a string or a number; absent,
    // `null` and `''` stay the record-less call.
    if (recordId !== undefined && recordId !== null && recordId !== ''
        && typeof recordId !== 'string' && typeof recordId !== 'number') {
        const message = 'The record key `recordId` must name one record by its id.';
        return invalidBody(`Invalid action body — ${message}`, { field: 'recordId', code: 'invalid_type', message });
    }
    const params: Record<string, unknown> = reqBody.params ?? {};

    // [ADR-0104 D2] The declared param contract, before the handler runs.
    const paramError = actionExec.enforceActionParams(deps, actionDef, actionSchema, params, { objectName, actionName });
    if (paramError) return refuse({ message: paramError, status: 400 });

    // [#15942 / #16293] CONFIRMATION GATE (`ai` posture) — the last pre-dispatch
    // check: after the param contract, so a malformed bag still gets its
    // located 400; before the subject load, so a refusal reads and writes
    // nothing.
    if (posture === 'ai') {
        const confirmationRefusal = actionExec.actionConfirmationRefusal(deps, actionDef, call.confirmation ?? {}, objectName);
        if (confirmationRefusal) {
            return refuse({
                message: confirmationRefusal.message,
                status: confirmationRefusal.status,
                details: { code: confirmationRefusal.code, ...(confirmationRefusal.details as unknown as Record<string, unknown>) },
            });
        }
    }

    // Load the subject record under the caller's RLS, through the ONE shared
    // producer (`loadActionSubjectRecord`), which also reports whether the
    // CALLER's own scope delivered the row (commit f19475c0a).
    const subject = await actionExec.loadActionSubjectRecord(objectName, recordId, () =>
        wiring.callData('get', { object: objectName, id: recordId }, wiring.driver, wiring.envId, wiring.ec));
    return { actionDef, actionType, recordId, params, subject };
}

/**
 * The dispatch arms, once every gate has passed: the declarative update, the
 * subject-record verdict, the api forward, the flow dispatch and the
 * script/body dispatch.
 */
async function dispatchAdmittedAction(
    deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    call: ResolvedActionCall,
    admission: Admission,
): Promise<ActionDispatchOutcome> {
    const { objectName, actionName, ql, wiring, door } = call;
    const { actionDef, actionType, recordId, params, subject } = admission;
    const { ec, envId } = wiring;
    try {
        // ── declarative update ── [#15079] FIRST, ahead of the `type` switch
        // and the trusted-mode plumbing below: it has no body to trust, so its
        // write carries the CALLER's identity and nothing else.
        if (actionExec.isDeclarativeUpdateAction(actionDef)) {
            const result = await actionExec.executeDeclarativeUpdateAction(deps, actionDef, {
                objectName, actionName, subject, recordId, params, ec,
                driver: wiring.driver, envId, requestContext, callData: wiring.callData,
            });
            return { kind: 'answered', result };
        }

        // ── contract point 3: the caller-scope load's VERDICT, consumed ── one
        // implementation of the rule (#16370), ahead of everything that builds
        // a trusted context. [#28657] Except ahead of an api forward that needs
        // nothing from the row: its target authorizes the caller itself.
        actionExec.refuseDeniedSubjectLoadBeforeDispatch(actionDef, objectName, recordId, subject);

        // ── api forward (#27506) ── a same-origin `type: 'api'` action is
        // forwarded IN-PROCESS to its declared `target` with the caller's own
        // credentials, after every gate and before the trusted-mode context,
        // which an api action never receives (ADR-0066 D4).
        if (actionType === 'api') {
            const mark = requestContext?.request?.headers?.[actionExec.API_FORWARD_MARK_HEADER];
            if (typeof mark === 'string' && mark.length > 0) {
                return { kind: 'refused', refusal: { message: actionExec.apiActionForwardLoopError(actionDef, mark), status: 400 } };
            }
            const inject = await actionExec.resolveInProcessRequest(deps, requestContext, envId);
            if (!inject) {
                return { kind: 'refused', refusal: { message: actionExec.apiActionForwardUnavailableError(actionDef, door), status: 503 } };
            }
            // [#28657] On a denied load the request is built from the
            // `recordId` alone — ⛔ never from a row the caller could not read.
            const built = actionExec.buildApiActionRequest(actionDef, {
                recordId, record: actionExec.apiForwardSubjectRecord(recordId, subject), params, ec,
            });
            if ('message' in built) return { kind: 'refused', refusal: { message: built.message, status: built.status } };
            const forward = await actionExec.forwardApiAction(inject, requestContext, built, {
                objectName, actionName, target: actionDef?.target,
                ...(recordId ? { recordId: String(recordId) } : {}),
            });
            if (forward.status >= 200 && forward.status < 300) {
                return { kind: 'answered', result: actionExec.apiActionResultOf(forward), headers: forward.headers };
            }
            return { kind: 'forward-refused', forward };
        }

        // [#5372] One shared producer for the user shape (`security/actor-user.ts`).
        const user = actorUserFromExecutionContext(ec, await resolveActorDisplayName(wiring.actorEngine, ec));

        // ── flow dispatch (#3915) ── the automation engine runs `action.target`
        // with the caller's identity forwarded, so a `runAs: 'user'` flow
        // enforces RLS as the invoker (ADR-0049). No trusted elevation here.
        if (actionType === 'flow') {
            try {
                // [#15168] `subject`, not `record`: the shared door derives the
                // flow context's `record` AND its `recordLoadDenied` sibling
                // from the one load outcome.
                // [ADR-0150 D3, #31696] The action's own package: its `target`
                // flow name resolves from it.
                const callerPackageId = call.declaration.packageId ?? actionExec.actionDeclaringPackage(actionDef, call.declaration.obj);
                const result = await actionExec.dispatchFlowAction(deps, requestContext, actionDef, {
                    objectName, subject, params, recordId, ec, envId,
                    ...(callerPackageId !== undefined ? { callerPackageId } : {}),
                });
                return { kind: 'answered', result };
            } catch (err) {
                // [#9585] A flow that RAN and failed: the author's `errorMessage`
                // and the run `summary` ride `error.details`, exactly as the
                // trigger door ships them. [#24914, ruling B′] its producer-marked
                // `userMessage` goes to the envelope's top level.
                if (actionExec.isFlowActionRefusal(err)) {
                    return {
                        kind: 'refused',
                        refusal: {
                            message: err.message,
                            status: err.status,
                            details: { code: err.code, ...err.runDetails },
                            ...(err.userMessage !== undefined ? { userMessage: err.userMessage } : {}),
                        },
                        thrown: err,
                    };
                }
                throw err;
            }
        }

        // ── script/body dispatch ── through the engine's `executeAction`.
        if (!ql || typeof ql.executeAction !== 'function') {
            throw new Error('Data engine not available for action dispatch');
        }
        // [#2849] Trusted-mode elevation must be AUDIBLE: the body's `ctx.engine`
        // and `ctx.api` bypass RLS/FLS, so record who triggered which action.
        console.info(trustedBodyAuditLine(door, objectName, door === 'mcp' ? actionDef?.name ?? actionName : actionName, user.id, ec));
        const actionContext: any = {
            record: subject.record,
            // [commit f19475c0a] The caller-scope load's verdict — the only
            // channel that tells a handler its subject row did not resolve for
            // THIS caller (`ctx.record.id` is stamped either way).
            ...actionExec.actionRecordLoadSignal(subject),
            user,
            session: actionExec.buildActionSession(deps, ec),
            // ⚠️ TRUSTED — system-elevated, RLS/FLS-bypassing by design; see
            // buildActionEngineFacade + buildActionExecutionContext (#2849, #3914).
            engine: actionExec.buildActionEngineFacade(deps, ql, ec),
            api: actionExec.buildActionApi(deps, ql, ec),
            executionContext: actionExec.buildActionExecutionContext(ec),
            params: { ...params, recordId, objectName },
        };
        // [ADR-0110 D2] "resolve, then address": the handler KEY is derived from
        // the resolved declaration; [ADR-0150 D4] the resolved holder's package
        // picks its own handler.
        const dispatch = await actionExec.executeRegisteredAction(
            deps, ql, objectName,
            actionExec.resolveActionHandlerKeys(actionDef, actionName),
            actionContext,
            call.declaration.packageId,
        );
        if (!dispatch.dispatched) {
            // No key carried a handler: a routing miss, not a server fault.
            return {
                kind: 'refused',
                refusal: { message: `Action '${actionName}' on object '${objectName}' not found`, status: 404 },
            };
        }
        // [#11519] Doubled post-success navigation — observe LOUDLY, never
        // rewrite the wire.
        const doubled = actionExec.doubledPostSuccessNavigationWarning(deps, actionDef, dispatch.result, objectName);
        if (doubled) console.warn(doubled);
        return { kind: 'answered', result: dispatch.result };
    } catch (error) {
        return { kind: 'thrown', error };
    }
}

/** The trusted-mode audit line each door prints, in its own words. */
function trustedBodyAuditLine(door: ActionDispatchDoor, objectName: string, actionName: string, userId: unknown, ec: any): string {
    const tail = '— body executes TRUSTED (system-elevated context, RLS/FLS-bypassing)';
    if (door === 'mcp') {
        return `[action-audit] MCP run_action '${actionName}' on '${objectName}' ${tail} for user '${ec?.userId ?? 'anonymous'}'` +
            // [ADR-0151 D3] An agent names a person it acts for only when it is
            // OAuth-delegated; an AI service account is its own subject.
            (ec?.principalKind === 'agent'
                ? ec?.onBehalfOf
                    ? ` (AGENT on behalf of '${ec.onBehalfOf.userId ?? 'unknown'}')`
                    : ' (AGENT: an AI service account, acting for itself)'
                : '');
    }
    const label = door === 'host' ? 'host action' : 'REST action';
    return `[action-audit] ${label} '${objectName}/${actionName}' ${tail} for user '${String(userId)}'`;
}

/**
 * The REST envelope of a refusal — what the REST door, and {@link dispatchAction},
 * answer for it.
 */
export function restRefusalResponse(deps: DomainHandlerDeps, refusal: ActionRefusal): { status: number; body: any } {
    return deps.error(
        refusal.message, refusal.status, refusal.details,
        refusal.userMessage !== undefined ? { userMessage: refusal.userMessage } : undefined,
    );
}

/** A REST answer as the dispatcher returns it: the `{ handled, response }` pair. */
type RestActionAnswer = { handled: true; response: { status: number; body: any; headers?: Record<string, string | string[]> } };

/**
 * The REST door's answer to a dispatched arm's outcome (#3962: failures speak
 * HTTP, success is a single wrap). A throw is answered by the door's ONE
 * reader, `actionsDoorAnswerOf` (#31271).
 *
 * Returned as the dispatcher's `{ handled, response }` pair so the two
 * hand-built relays below (the api forward's 2xx and non-2xx answers, which
 * carry the target's credential headers no `deps.*` helper takes) stay in the
 * `check:route-envelope` census of this file.
 */
export function restAnswerOf(
    deps: DomainHandlerDeps,
    admitted: AdmittedActionCall,
    outcome: ActionDispatchOutcome,
): RestActionAnswer {
    const { actionDef, objectName, actionName } = admitted;
    switch (outcome.kind) {
        case 'answered': {
            const relayed = outcome.headers && Object.keys(outcome.headers).length > 0 ? { headers: outcome.headers } : {};
            return { handled: true, response: { ...deps.success(outcome.result), ...relayed } };
        }
        case 'refused':
            return { handled: true, response: restRefusalResponse(deps, outcome.refusal) };
        case 'forward-refused': {
            const { forward } = outcome;
            const relayed = Object.keys(forward.headers).length > 0 ? { headers: forward.headers } : {};
            const refusal = actionExec.apiActionForwardRefusal(actionDef, forward);
            // [#27738] An enveloped refusal is relayed WHOLE: its code and
            // sentence, and every member beside them as the target wrote them.
            const members = actionExec.apiActionRefusalMembers(forward);
            const refused = members
                ? apiErrorResponse({ message: refusal.message, httpStatus: forward.status, code: (refusal as any).code, extra: members })
                : deps.error(refusal.message, forward.status, { code: (refusal as any).code });
            return { handled: true, response: { ...refused, ...relayed } };
        }
        case 'thrown': {
            const err = outcome.error;
            // [#28856 / #28861] An action whose write landed under a failing
            // roll-up answers the result the runtime composed — read on the
            // declarative-update arm only, whose refusal carries the ACTION's
            // result; the stale column is logged once.
            const earned = actionExec.isDeclarativeUpdateAction(actionDef) ? earnedAnswerOf(err) : undefined;
            if (earned) {
                const log = deps.logger && typeof deps.logger.error === 'function'
                    ? (line: string) => deps.logger.error(`[HttpDispatcher] ${line}`)
                    : (line: string) => console.error(`[HttpDispatcher] ${line}`);
                for (const line of staleSummaryAnswerLines(err as SummaryRecomputeRefusal, objectName)) log(line);
                return { handled: true, response: deps.success(earned) };
            }
            const answer = actionsDoorAnswerOf(err, objectName);
            for (const line of answer.operatorLines) console.error(`[action ${objectName}/${actionName}] ${line}`);
            const extra = {
                ...(answer.declaredCode !== undefined ? { declaredCode: answer.declaredCode } : {}),
                ...(answer.userMessage !== undefined ? { userMessage: answer.userMessage } : {}),
            };
            return {
                handled: true,
                response: apiErrorResponse({
                    message: answer.message,
                    httpStatus: answer.status,
                    code: answer.code,
                    details: answer.details,
                    ...(Object.keys(extra).length > 0 ? { extra } : {}),
                }),
            };
        }
    }
}

/**
 * The REST-shaped run of a resolved call, with its invocation row: what the
 * REST door and {@link dispatchAction} share once their resolution answered.
 * `surface` names the door on the row (`'rest'`); a host's call writes none
 * (`ExecutionContext.surface` is absent on every other operation).
 */
export async function runResolvedActionAsRest(
    deps: DomainHandlerDeps,
    requestContext: HttpProtocolContext,
    call: ResolvedActionCall,
    surface: 'rest' | undefined,
): Promise<HttpDispatcherResult> {
    const run = await runResolvedAction(deps, requestContext, call);
    if ('refused' in run) return { handled: true, response: restRefusalResponse(deps, run.refused) };
    const { response } = restAnswerOf(deps, run.admitted, run.outcome);
    // [#27908] THE INVOCATION ROW: one row for every call that cleared the
    // gates, whatever the arm answered. A call a gate refused writes none.
    const { actionDef, objectName, actionName, recordId } = run.admitted;
    const status = response.status;
    const ok = status >= 200 && status < 300;
    const code: unknown = response.body?.error?.code;
    const ec = call.wiring.ec;
    await recordActionInvocation(deps, requestContext, call.wiring.envId, {
        context: surface ? withActionSurface(ec, surface) : (ec && typeof ec === 'object' ? ec : ({} as ExecutionContext)),
        actionName: typeof actionDef?.name === 'string' && actionDef.name ? actionDef.name : actionName,
        objectName: actionExec.isObjectLessActionKey(objectName) ? undefined : objectName,
        recordId: recordId !== undefined && recordId !== null && recordId !== '' ? String(recordId) : undefined,
        branch: actionInvocationBranch(actionDef, actionExec.isDeclarativeUpdateAction(actionDef)),
        outcome: ok ? 'succeeded' : 'failed',
        ...(ok ? {} : { status }),
        ...(!ok && typeof code === 'string' ? { errorCode: code } : {}),
        // An api forward's two rows name each other (`action-invocation-audit.ts`).
        target: actionInvocationTarget(actionDef, actionExec.isDeclarativeUpdateAction(actionDef)),
        forwardedFrom: actionInvocationForwardedFrom(requestContext, actionExec.API_FORWARD_MARK_HEADER),
    });
    return { handled: true, response };
}

/**
 * The declaration a routed call names: through its ADR-0150 D5 address when it
 * carries one (`resolveAddressedRouteActionDeclaration`, the resolution the MCP
 * bridge's qualified call reads), else the bare route pair
 * (`resolveRouteActionDeclaration`). An addressed miss is THROWN `404` by name;
 * it comes back as `refusedBy`, for the door to answer.
 */
export async function resolveRoutedActionDeclaration(
    deps: ActionExecutionDeps,
    requestContext: HttpProtocolContext,
    args: { ql: any; objectName: string; actionName: string; envId?: string; qualifier?: actionExec.ActionAddressQualifier },
): Promise<{ declaration: actionExec.RouteActionDeclaration } | { refusedBy: unknown }> {
    const { ql, objectName, actionName, envId, qualifier } = args;
    if (qualifier) {
        try {
            return { declaration: await actionExec.resolveAddressedRouteActionDeclaration(deps, requestContext, { ql, objectName, actionName, envId, qualifier }) };
        } catch (err) {
            return { refusedBy: err };
        }
    }
    return { declaration: await actionExec.resolveRouteActionDeclaration(deps, requestContext, { ql, objectName, actionName, envId }) };
}

/** The door's wiring for a call served from an HTTP-shaped request context. */
export function requestContextWiring(deps: ActionExecutionDeps, requestContext: HttpProtocolContext, ql: any): ActionDispatchWiring {
    return {
        ec: requestContext?.executionContext,
        envId: requestContext?.environmentId,
        driver: requestContext?.dataDriver,
        callData: (a, params, dataDriver, scopeId, execCtx) =>
            actionExec.callData(deps, requestContext, a, params, dataDriver, scopeId, execCtx),
        actorEngine: () => ql,
    };
}

// ── The host's door ─────────────────────────────────────────────────────────

/**
 * One action call from a host's own door — {@link dispatchAction}'s input.
 *
 * The members are the REST door's request, unbundled: the object and action
 * the path names, an optional ADR-0150 D5 address, the body's `recordId` and
 * `params`. `confirm` is the AI door's confirmation member
 * (`AIActionConfirmation`), read under the `'ai'` posture only.
 */
export interface ActionDispatchRequest extends AIActionConfirmation {
    /**
     * The caller, as the host authenticated it. The same envelope a REST
     * request carries: an anonymous caller (no `userId`, not `isSystem`) is
     * refused `401`, as at the REST door.
     *
     * It is used as given. `dispatch()` resolves a REST caller's envelope
     * against the kernel the request was placed on; this door does not, so
     * the envelope must be the caller as the named environment resolves it
     * (its permission sets and positions there). See {@link dispatchAction} for the
     * gates that stay the host's.
     */
    executionContext: ExecutionContext;
    /**
     * The environment the call runs in. It reaches the host's
     * `kernel-resolver` as the scoped-URL hint (`urlEnvironmentId`), the way
     * `POST /environments/:environmentId/actions/...` reaches it, and the
     * resolver writes the environment: the call runs on the kernel it answers,
     * on the host kernel when it places none, and a resolver that throws
     * refuses the call with the status it carries. Omitted, the resolver gets
     * no environment hint and places the call from what else it reads (the
     * `credentialHeaders`; a host door has no hostname), or not at all; a call
     * the resolver places in no environment runs in the kernel's default
     * environment, as the REST door's does. On a host with no
     * `kernel-resolver` nothing places the call: it runs in the environment
     * named here (the scope of its service lookups), or in the default
     * environment when none is named.
     */
    environmentId?: string;
    /** The object whose action is called; omitted, an object-less action. */
    objectName?: string;
    /** The action's declared name. */
    actionName: string;
    /**
     * [ADR-0150 D5] The exact qualifier, read as the REST path's namespace
     * position reads it: `_env` for the environment's own declaration, else an
     * installed namespace, whose packages alone answer. A namespace no
     * installed package has is refused `404`; there is no bare fallback.
     * Omitted, the name resolves as the bare route does.
     */
    namespace?: string;
    /** The subject record's id. */
    recordId?: string | number;
    /** The action's params, closed against its declared `params[]` (ADR-0104). */
    params?: Record<string, unknown>;
    /**
     * The caller's own credential headers (`authorization`, `cookie`, …): what
     * a same-origin `type: 'api'` action forwards to its target, which
     * authorizes the caller itself (ADR-0066 D4). Omitted, an api forward
     * carries none, and its target answers as for an unauthenticated call.
     */
    credentialHeaders?: Record<string, string>;
    /** Which door's rules admit the call; default `'rest'`. */
    posture?: ActionDispatchPosture;
}

/**
 * {@link dispatchAction}'s answer: the REST door's response for the same call,
 * byte for byte — `status`, the `{ success, data }` / `{ success, error }`
 * body, and the headers an api forward relays (a credential rotation its
 * target emitted).
 */
export interface ActionDispatchAnswer {
    status: number;
    body: {
        success: boolean;
        data?: unknown;
        error?: { code: string; message: string; httpStatus?: number; details?: unknown; userMessage?: string; [member: string]: unknown };
        [member: string]: unknown;
    };
    headers?: Record<string, string | string[]>;
}

/**
 * The dispatcher's placement step for the host door (`HttpDispatcher`'s
 * `placeHostActionRequest`): it writes the two resolver hints from the
 * values it is handed — `routePath`, and `urlEnvironmentId` from
 * `environmentId` alone — then runs the placement `resolveRequestScope`
 * runs, writing `context.kernel` and whatever the host's resolver writes
 * (`environmentId`, `dataDriver`). A resolver's throw leaves through it.
 */
export type PlaceRequestInEnvironment = (
    context: HttpProtocolContext,
    hints: { routePath: string; environmentId?: string },
) => Promise<void>;

/**
 * The REST route of the same call, as the scoped mount hands it to
 * `dispatch()` (the environment travels beside it, never inside it). Every
 * segment is encoded, so a name containing `/` stays one segment. It is
 * informational only: no environment hint is derived from it, so the route
 * path the host door builds cannot be steered by an object, namespace or
 * action name. The record id travels in the body, a spelling the REST door
 * also takes.
 */
function actionRoutePath(namespace: string | undefined, objectName: string, actionName: string): string {
    const segment = encodeURIComponent;
    return `/actions${namespace !== undefined ? `/${segment(namespace)}` : ''}/${segment(objectName)}/${segment(actionName)}`;
}

/**
 * The declared environment header (`X-Environment-Id`, lower-case as the
 * forward's header bag spells it), which a host's `kernel-resolver` reads to
 * place a request in its environment and which the api forward carries across
 * from its request (`action-execution.ts`'s forward allow-list).
 */
const FORWARD_ENVIRONMENT_HEADER = 'x-environment-id';

/**
 * The host door over a dispatcher's deps: the REST door's sequence for a
 * call that arrived as values, not as a path. Writes the invocation row with
 * no `surface` (a host's call came through neither REST nor MCP).
 *
 * `place` is the dispatcher's own scope step, minus identity (the host
 * authenticated its caller): the call is placed in its environment's kernel
 * by the code that places a REST request, never by a copy of it.
 */
export async function dispatchActionRequest(
    deps: DomainHandlerDeps,
    request: ActionDispatchRequest,
    place: PlaceRequestInEnvironment,
): Promise<ActionDispatchAnswer> {
    const ec: any = request?.executionContext;
    // [#5519] ANONYMOUS BASELINE — first, as at the REST door: a script body
    // runs `isSystem`, so an anonymous call must never reach it.
    if (shouldDenyAnonymous({ userId: ec?.userId, isSystem: ec?.isSystem, method: 'POST' })) {
        return deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE });
    }
    const actionName = request?.actionName;
    if (typeof actionName !== 'string' || actionName === '') {
        return deps.error('dispatchAction needs the action\'s name (`actionName`)', 400);
    }
    // The posture picks which rules run, so a value that is neither is refused
    // before anything resolves: read as `'rest'`, a misspelt `'AI'` or
    // `'mcp'` would quietly drop the AI door's three rules.
    const posture: unknown = request.posture;
    if (posture !== undefined && posture !== 'rest' && posture !== 'ai') {
        const message = `\`posture\` must be 'rest' or 'ai' (or absent, which is 'rest'); got ${JSON.stringify(posture)}`;
        return deps.error(
            `Invalid action request — ${message}`,
            VALIDATION_FAILED_STATUS,
            validationFailureDetails(validationFailure(message, [{ field: 'posture', code: 'invalid_option', message }])) as ActionRefusal['details'],
        );
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.credentialHeaders ?? {})) {
        if (typeof value === 'string') headers[name.toLowerCase()] = value;
    }
    const namedEnvironment = typeof request.environmentId === 'string' && request.environmentId !== '' ? request.environmentId : undefined;
    // On a host with a `kernel-resolver`, `environmentId` is the RESOLVER's to
    // write, as at the REST door: the named environment reaches it as the
    // scoped-URL hint, never pre-written onto the context.
    const context: HttpProtocolContext = { request: { headers }, executionContext: ec };
    const objectName = typeof request.objectName === 'string' && request.objectName !== ''
        ? request.objectName
        : actionExec.GLOBAL_ACTION_OBJECT_KEY;
    // [ADR-0006 Phase 5] PLACEMENT — the step `dispatch()` runs before the
    // REST door, asked what the scoped REST request asks: on a multi-kernel
    // host the resolver answers the environment's own kernel (and writes its
    // `environmentId` / `dataDriver`), and a resolver that fails refuses the
    // call instead of letting it run on the host kernel.
    try {
        await place(context, {
            routePath: actionRoutePath(request.namespace, objectName, actionName),
            ...(namedEnvironment ? { environmentId: namedEnvironment } : {}),
        });
    } catch (err) {
        return deps.errorFromThrown(err, 500);
    }
    // [#32658] THE FORWARD'S ROUTING IDENTITY. A same-origin `type: 'api'`
    // action forwards into the host's raw app, which places the forwarded
    // request as it places any request it receives. A REST request carries
    // what placed it (its `Host`, its `X-Environment-Id`) into its forward, so
    // the forward lands in the environment the call ran in. This door's request
    // carries neither: on a multi-kernel host its forward reached the raw app as
    // `Host: localhost`, which places it in no environment, and the target
    // answered the caller 401. The environment the host's resolver placed the
    // call in is written as the declared environment header, so the forward is
    // placed where the call ran. It is the resolver's answer, never the
    // caller's: it replaces any spelling the credential headers carried.
    const placedEnvironment = deps.isMultiTenantHost() ? context.environmentId : undefined;
    if (typeof placedEnvironment === 'string' && placedEnvironment !== '' && placedEnvironment !== 'platform') {
        headers[FORWARD_ENVIRONMENT_HEADER] = placedEnvironment;
    }
    // On a host with NO resolver nothing places the call, so the environment
    // the host named is carried as it always was — never silently dropped for
    // the default one. Written after placement, so the scope touch, which this
    // door never made for an unvalidated id, still fires only on one a
    // resolver wrote.
    if (namedEnvironment && !deps.isMultiTenantHost()) context.environmentId = namedEnvironment;
    if (!context.environmentId) {
        const def = deps.getDefaultEnvironmentId();
        if (def) context.environmentId = def;
    }
    const projectQl: any = await deps.resolveProjectKernelObjectQL(context);
    const ql: any = projectQl ?? await deps.getObjectQL(context, context.environmentId);
    if (!ql || typeof ql.executeAction !== 'function') return deps.error('Data engine not available', 503);
    let qualifier: actionExec.ActionAddressQualifier | undefined;
    if (request.namespace !== undefined) {
        const registry: any = ql?.registry;
        const namespaceOwners = (ns: string): readonly string[] =>
            (typeof registry?.getNamespaceOwners === 'function' ? registry.getNamespaceOwners(ns) ?? [] : []);
        const reading = readNamespacePositionSegment('actions', request.namespace, (ns) => namespaceOwners(ns).length > 0);
        qualifier = reading.reading === 'environment'
            ? { environment: true }
            : { namespace: request.namespace, namespaceOwners };
    }

    try {
        await refuseDispatchToDisabledObject(deps, context, objectName, context.environmentId);
    } catch (err) {
        return deps.errorFromThrown(err, 404);
    }
    const resolution = await resolveRoutedActionDeclaration(deps, context, {
        ql, objectName, actionName, envId: context.environmentId, ...(qualifier ? { qualifier } : {}),
    });
    if ('refusedBy' in resolution) return deps.errorFromThrown(resolution.refusedBy, 404);

    const answer = await runResolvedActionAsRest(deps, context, {
        posture: posture === 'ai' ? 'ai' : 'rest',
        door: 'host',
        objectName,
        actionName,
        declaration: resolution.declaration,
        ...(qualifier ? { unknownName: addressedUnknownNameRefusal(actionName, objectName, qualifier) } : {}),
        body: {
            ...(request.recordId !== undefined ? { recordId: request.recordId } : {}),
            ...(request.params !== undefined ? { params: request.params } : {}),
        },
        confirmation: { ...(request.confirm !== undefined ? { confirm: request.confirm } : {}) },
        ql,
        wiring: requestContextWiring(deps, context, ql),
    }, undefined);
    return answer.response as ActionDispatchAnswer;
}

/** One dispatcher per kernel: its deps are the REST door's. */
const hostDispatchers = new WeakMap<object, HttpDispatcher>();

/**
 * Run one business action from a host's own door — the REST `/actions`
 * door's admission and dispatch, as a function. A host that runs actions
 * outside REST and MCP (an in-product AI tool, a job runner) calls this
 * instead of keeping a copy of the door's rules: the answer is the REST
 * door's for the same call, and every rule the door adds later reaches the
 * host with no change on its side.
 *
 * `posture` picks the rules (see {@link ActionDispatchPosture}): a door an
 * agent drives takes `'ai'`, which adds the `sys_*` exposure, `ai.exposed`
 * and `ai.requiresConfirmation` gates the MCP `run_action` tool enforces.
 *
 * `kernel` is the kernel the host's HTTP door is served from — on a
 * multi-kernel host, the one that registers the `kernel-resolver` service.
 * The call is placed by the dispatcher's own placement step, asked what the
 * scoped REST request asks, so both doors run the call on the same kernel.
 *
 * A same-origin `type: 'api'` action forwards into the raw app of the
 * kernel's HTTP server, as at the REST door, and on a multi-kernel host the
 * forward carries the environment the resolver placed the call in
 * (`X-Environment-Id`), so the raw app places it in that same environment.
 * An environment's own kernel owns no socket: handed one, the door has
 * nothing to forward through and refuses the action `503`.
 *
 * What `dispatch()` runs after placement and this door does NOT, so it stays
 * the host's job before it calls:
 *  - resolving the caller's envelope against the placed kernel
 *    (`executionContext` is used as given);
 *  - the ADR-0069 authentication-policy gate (an expired password or a
 *    required MFA step blocks a REST session; nothing here reads a session);
 *  - the environment-membership gate, which refuses a signed-in non-member of
 *    the environment `403 PROJECT_MEMBERSHIP_REQUIRED` at the REST door.
 *
 * @example
 * const answer = await dispatchAction(kernel, {
 *   executionContext, objectName: 'crm_lead', actionName: 'convert', recordId,
 *   posture: 'ai', confirm: humanApproved,
 * });
 * if (answer.status !== 200) refuse(answer.body.error);
 */
export async function dispatchAction(kernel: ObjectKernel, request: ActionDispatchRequest): Promise<ActionDispatchAnswer> {
    let dispatcher = hostDispatchers.get(kernel);
    if (!dispatcher) {
        dispatcher = new HttpDispatcher(kernel);
        hostDispatchers.set(kernel, dispatcher);
    }
    return dispatcher.dispatchHostAction(request);
}
