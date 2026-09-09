// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/automation` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-6). Bridges to the `automation` service (flow CRUD, trigger/execute,
 * runs history, pause/resume, and the two operator run-lifecycle verbs
 * (cancel / restore-suspension, #13953) — ADR-0018/0019/0022 surfaces). Route-order
 * subtlety preserved verbatim: `/actions`, `/connectors` and `/_status`
 * MUST precede the `/:name → getFlow` catch-all, or a flow literally named
 * "actions"/"connectors" would shadow them.
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
// [ADR-0126 §5] The shared activation write-authority gate — one
// implementation, one refusal envelope, per-door wording. See its header for
// the posture rule and the #10243 measurement behind it.
import { refuseUngrantedActivationWrite, FLOW_ACTIVATION_SUBJECT } from './activation-gate.js';
import { CoreServiceName } from '@objectstack/spec/system';
import type { AutomationResult, IAutomationService, ISecurityService } from '@objectstack/spec/contracts';
import { isServiceServeable } from '../service-serveable.js';
import {
    validationFailure, validationFailureDetails, fieldsFromZodIssues, VALIDATION_FAILED_STATUS,
} from '../validation-failure.js';
import { ExecutionStatus } from '@objectstack/spec/automation';
import { ListRunsRequestSchema } from '@objectstack/spec/api';
import type { ResumeFailureDetails } from '@objectstack/spec/api';
import { parseEnumParam, parseIntegerParam, parseStringParam } from '../query-param.js';
import { capabilityUnavailable } from './unavailable.js';
// [#9446] The ONE #9378 status table, now shared with the `/actions` door.
import {
    classifyFlowRefusal,
    flowIsUnknown,
    flowNotFoundMessage,
    isPausedRun,
    FLOW_NOT_FOUND_STATUS,
} from '../flow-dispatch-status.js';
// [#12156] ADR-0126 §7.1 clone — the whole-definition copy, the keys it must
// not carry forward, the same-name refusal and the references notice.
import {
    cloneFlowDefinition,
    flowCloneNameTakenMessage,
    FLOW_CLONE_NAME_TAKEN_STATUS,
    FLOW_CLONE_NOTICE,
} from '../flow-clone.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * Translate a trigger request body into the canonical `AutomationContext` the
 * engine expects, and forward the caller's resolved identity.
 *
 * [#4127] ONE construction point for BOTH trigger routes. It used to live
 * inline in `POST /:name/trigger` while `POST /trigger/:name` — the legacy
 * shape, and the one `client.automation.trigger()` calls — passed the raw HTTP
 * body straight to `execute(name, body)`. Two consequences, both silent:
 *
 *  - The `{ recordId, objectName, params }` translation never ran, so flow
 *    variables (`params.recordId`, the `<object>Id` alias) resolved from
 *    nothing.
 *  - No identity was forwarded. A flow's default `runAs` is `'user'`, and a
 *    `runAs:'user'` run whose trigger resolved no user has its data operations
 *    REFUSED (#3760, fail-closed) — so the SDK's `automation.trigger()` could
 *    not successfully run any data-touching flow, while the other route could.
 *    service-automation's own comment claims "most trigger surfaces (REST
 *    action / trigger endpoint) already resolve the full envelope"; for this
 *    endpoint that was not true.
 *
 * Identity forwarding is the FULLY-RESOLVED envelope, not just the user id, so
 * a `runAs:'user'` flow enforces RLS exactly as the triggering user — their
 * positions/permissions/tenant, not a member fallback (#1888). The engine
 * elevates to a system principal only when the flow declares `runAs:'system'`.
 *
 * [#5040 E5] Exported — the declarative endpoint executor
 * (`../endpoint-executor.ts`) triggers flows too, and must send the SAME
 * context this route sends or a `type: 'flow'` endpoint becomes a second
 * trigger dialect with its own identity-forwarding bugs. Exporting it is the
 * whole point: the alternative (a second builder over there) is the shape
 * #4127 above was written to remove.
 */
export function buildAutomationContext(body: any, context: HttpProtocolContext): Record<string, unknown> {
    const ctxBody = body && typeof body === 'object' ? body : {};
    // `{recordId, objectName, params}` (the UI/SDK request shape) → the
    // canonical AutomationContext shape:
    //  - `recordId` is exposed in `params.recordId` AND aliased to
    //    `<objectName>Id` (camelCase) so flow variables like `leadId`,
    //    `caseId`, `opportunityId` resolve from a single REST contract.
    //  - `objectName` maps to the canonical `object` field.
    const recordId = ctxBody.recordId;
    const objectName = ctxBody.objectName ?? ctxBody.object;
    const baseParams: Record<string, any> = (ctxBody.params && typeof ctxBody.params === 'object')
        ? { ...ctxBody.params }
        : {};
    // Back-compat: when callers POST a flat body (no `params` wrapper),
    // forward unknown top-level keys as flow params so the original
    // `{ foo: 'bar' }` payload is not silently dropped.
    if (!ctxBody.params) {
        const reserved = new Set(['recordId', 'objectName', 'object', 'event', 'params']);
        for (const [k, v] of Object.entries(ctxBody)) {
            if (reserved.has(k)) continue;
            if (baseParams[k] === undefined) baseParams[k] = v;
        }
    }
    if (recordId !== undefined && baseParams.recordId === undefined) {
        baseParams.recordId = recordId;
    }
    if (recordId !== undefined && objectName) {
        const alias = `${String(objectName).replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())}Id`;
        if (baseParams[alias] === undefined) baseParams[alias] = recordId;
    }

    const automationContext: Record<string, unknown> = {
        params: baseParams,
        object: objectName,
        event: ctxBody.event ?? 'manual',
    };
    const ec = (context as any)?.executionContext;
    const userIdFromAuth = (context as any)?.user?.id ?? (context as any)?.userId ?? ec?.userId;
    if (userIdFromAuth) automationContext.userId = userIdFromAuth;
    if (Array.isArray(ec?.positions) && ec.positions.length) automationContext.positions = ec.positions;
    if (Array.isArray(ec?.permissions) && ec.permissions.length) automationContext.permissions = ec.permissions;
    if (ec?.tenantId) automationContext.tenantId = ec.tenantId;
    return automationContext;
}

export function createAutomationDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/automation',
        handler: (req, context) =>
            handleAutomationRequest(deps, req.path.substring(11), req.method, req.body, context, req.query),
    };
}

/**
 * [#7900] The system object whose READ grant governs automation RUN STATE —
 * the durable row `service-automation` writes for every suspended run, whose
 * `variables_json` column holds the very snapshot `GET /:name/runs/:runId`
 * hands back (`sys-automation-run.object.ts`).
 *
 * It is named here because the two are ONE policy with two doors, not two
 * policies: reading the row through `/data/sys_automation_run` has always
 * answered with this object's permissions, while the `/automation` door asked
 * only "are you authenticated?".
 */
export const AUTOMATION_RUN_OBJECT = 'sys_automation_run';

/** [#7900] Refusal vocabulary for the run-state read gate (ADR-0112: code AND status). */
const RUN_READ_DENY_STATUS = 403;
const RUN_READ_DENY_CODE = 'PERMISSION_DENIED';
const RUN_READ_DENY_MESSAGE =
    `Reading automation run state requires read access to '${AUTOMATION_RUN_OBJECT}'.`;

/**
 * [#7968] The screen route's own refusal text — same `code` and `status`, a
 * different sentence, because a different question was asked.
 *
 * The two halves are BOTH named. A caller refused here is either the wrong
 * person or an operator without the grant, and a message naming only the grant
 * would tell the end user the flow paused for to go ask for operator tooling —
 * the exact misdirection this route's gate exists to avoid. It still names no
 * position, permission set or identity (#7450): what it lists is what would
 * admit ANY caller, not what this one is missing.
 */
const SCREEN_READ_DENY_MESSAGE =
    'Reading a paused run\'s screen requires being the identity that triggered the run, '
    + `or read access to '${AUTOMATION_RUN_OBJECT}'.`;

/**
 * [#7900] Which `/automation` GET routes serve `sys_automation_run`-class data.
 *
 * Declared as ONE predicate rather than a check per branch on purpose — the
 * whole point of the ruling is that this domain gets one policy, and a policy
 * spelled out at three call sites is three policies that happen to agree today.
 * `parts` is the flow-scoped path split (`parts[0]` is the flow name).
 *
 *   `/:name/runs`         → listRuns, an `ExecutionLogEntry[]`
 *   `/:name/runs/:runId`  → getRun,   an `ExecutionLogEntry` served verbatim
 *
 * `/:name/runs/:runId/screen` is deliberately NOT here — [#7968] it is gated,
 * but on a DIFFERENT question (`refuseUnrelatedScreenRead`): the run's own
 * trigger identity, with this grant as an operator override. Adding it here
 * would apply the grant alone and lock out the end user the flow paused for.
 */
function isRunStateRead(parts: string[], method: string): boolean {
    if (method !== 'GET') return false;
    if (parts.length < 2 || parts[1] !== 'runs') return false;
    // `/:name/runs` (listRuns) and `/:name/runs/:runId` (getRun) — nothing deeper.
    return parts.length === 2 || parts.length === 3;
}

/**
 * [#7900] Ask the SAME question the other door answers with: may this caller
 * READ `sys_automation_run`?
 *
 * The BOOLEAN the two gates in this file share. [#7968] split it out of
 * {@link refuseUngrantedRunRead} when a second route needed the identical
 * question under a different refusal sentence: the run-state reads refuse when
 * the answer is no, while the screen route treats it as the OPERATOR OVERRIDE
 * half of a two-half gate. Two refusals, one implementation — a second copy of
 * the resolution/feature-detection/fail-closed logic would be a second policy
 * that happens to agree today, which is the shape the #7900 ruling exists to
 * remove.
 *
 * ## Why `explain`, and why nothing new was built
 *
 * `ISecurityService` is the contract for exactly this: "the query surface that
 * lets code OUTSIDE the ObjectQL engine middleware ask the same questions the
 * middleware answers when it enforces access", with a standing instruction that
 * a consumer re-deriving any of these answers locally will drift. `explain` runs
 * the same permission-set resolution, the same `PermissionEvaluator` and the
 * same RLS compiler the middleware runs — `allowed` is `!capsDeny &&
 * crudAllowed && !denyAll && !delegatorMissing` over that shared machinery — so
 * this gate cannot answer differently from the `/data` door by drifting. The
 * slot is already on `DomainHandlerDeps` (`domains/meta.ts` resolves it the same
 * way for ADR-0106 masking), so no new cross-package seam exists to invent.
 *
 * ⛔ It is deliberately NOT a per-field filter of the run's `variables` map —
 * rejected by the ruling, on the card's own measurement that the map's keys
 * (`.`, `record`, `previous`, `$runId`, seeded inputs) are not decidably
 * record fields.
 *
 * ## The three non-denials, each of which is a decision
 *
 * 1. **System context passes.** The middleware's very first act is
 *    `if (opCtx.context?.isSystem) return next()`. A gate that refused what the
 *    object read admits would not be convergence.
 * 2. **No security service ⇒ no grant to require.** In a deployment without
 *    `plugin-security` there is no object-permission system at all, so
 *    `/data/sys_automation_run` is itself ungated: "authenticated is enough" is
 *    what BOTH doors answer, and refusing here would make them disagree in the
 *    other direction. The contract mandates this tolerance ("Consumers MUST
 *    tolerate absence"). Same for a partial implementation that omits `explain`.
 * 3. **An `explain` THROW is a denial, not a pass.** This is an
 *    access-narrowing answer, so it fails CLOSED — the stance `plugin-security`
 *    itself takes when an object's posture cannot be resolved (#3545).
 *
 * ## The one place this is STRICTER than the door it converges on
 *
 * The middleware skips its CRUD gate entirely for an authenticated caller whose
 * permission-set resolution comes back EMPTY (`if (permissionSets.length > 0)`),
 * while `explain` runs `checkObjectPermission` over that empty list and gets
 * `false`. ADR-0090 D5's additive baseline plus the post-resolution fallback
 * make an empty resolution reachable only on a deployment that configures NO
 * baseline permission set at all — and on that deployment this surface refuses
 * where `/data` falls open. Left as-is deliberately: the divergence is in the
 * closed direction on the door this card was filed about, and closing it the
 * other way would mean re-deriving the middleware's own empty-set rule here,
 * which is the drift `ISecurityService` exists to prevent.
 */
async function mayReadRunState(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<boolean> {
    const ec = context?.executionContext;
    if (ec?.isSystem === true) return true;

    const security = await deps.resolveService(context, 'security').catch(() => undefined) as
        Partial<ISecurityService> | undefined;
    if (!security || typeof security.explain !== 'function') return true;

    try {
        const decision = await security.explain({ object: AUTOMATION_RUN_OBJECT, operation: 'read' }, ec);
        return decision?.allowed === true;
    } catch {
        return false;
    }
}

/**
 * [#7900] The run-state read gate itself: {@link mayReadRunState} as a guard
 * clause.
 *
 * Returns a refusal result when the answer is no, `undefined` when the read may
 * proceed — so the caller reads as a guard clause and no route can accidentally
 * consume a "denied" as a value.
 */
async function refuseUngrantedRunRead(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult | undefined> {
    if (await mayReadRunState(deps, context)) return undefined;

    // The refusal names the GRANT it wants and nothing about the caller — no
    // positions, no permission-set names (#7450: a denial must not answer the
    // caller's authorization topology).
    return {
        handled: true,
        response: deps.error(RUN_READ_DENY_MESSAGE, RUN_READ_DENY_STATUS, { code: RUN_READ_DENY_CODE }),
    };
}

/**
 * [#10145] ADR-0066 D1's authoring capability, required by the `/automation`
 * DEFINITION writes.
 *
 * The same key the sibling metadata doors already demand — `PUT /meta/:type/:name`
 * on both of its transports (#6603 REST, #7019 dispatcher), `POST /meta/_migrate-stored`,
 * and every state-changing `/packages` route (#7033). A flow IS authored metadata:
 * the domain's own `GET /` audit note says so in as many words ("Flow definitions
 * are metadata and are governed on the metadata plane (`/meta`, ADR-0106)"), and
 * that note settled the READ posture while leaving the WRITE half of the same
 * sentence unstated. This is that half.
 */
const FLOW_AUTHORING_CAPABILITY = 'manage_metadata';

/** [#10145] Refusal vocabulary for the authoring-write gate (ADR-0112: code AND status). */
const FLOW_WRITE_DENY_STATUS = 403;
const FLOW_WRITE_DENY_CODE = 'PERMISSION_DENIED';
const FLOW_WRITE_DENY_MESSAGE =
    `Authoring automation flows requires the \`${FLOW_AUTHORING_CAPABILITY}\` capability.`;

/**
 * [#11666] The enablement arm's own refusal text — the same capability, the
 * same `code` and the same `status` as {@link FLOW_WRITE_DENY_MESSAGE}, and a
 * different sentence, because a different operation was attempted.
 *
 * ⛔ Copy, not policy. [#10243]'s ruling put `POST /:name/toggle` into the
 * authoring write set and that classification is untouched here: the same
 * callers are refused, with the same `PERMISSION_DENIED` and the same 403.
 * What moves is only what a refused caller is TOLD. Switching a shipped flow
 * OFF was answered with "Authoring automation flows requires …" — accurate
 * about the policy, and naming a verb the caller did not use.
 *
 * Shaped on {@link SCREEN_READ_DENY_MESSAGE} (#7968) one screen up: a second
 * constant for a second question, rather than a reworded shared one. Rewording
 * the shared sentence was considered and declined — it reads correctly for the
 * authoring writes that reach it (`POST /`, `PUT /:name`, `DELETE /:name`, and
 * [#12156]'s `POST /:name/clone`), and widening it to cover both would degrade
 * it for every one of them in order to fix one.
 *
 * It satisfies #7450 exactly as its sibling does: it names the capability that
 * would admit ANY caller, and nothing about this one.
 */
const FLOW_ENABLEMENT_DENY_MESSAGE =
    `Enabling or disabling an automation flow requires the \`${FLOW_AUTHORING_CAPABILITY}\` capability.`;

/**
 * [#11666] Is THIS request the enablement door, `POST /automation/:name/toggle`?
 *
 * Extracted so the question is asked once. {@link isFlowAuthoringWrite} needs
 * it to decide whether the route is gated at all, and
 * {@link refuseUngrantedFlowWrite} needs the SAME answer to decide which
 * sentence the refusal carries — and this file's own rule is that a question
 * spelled at two call sites is two questions that happen to agree today.
 *
 * ⛔ The truth table is [#10243]'s, moved nowhere: the exclusion of
 * `parts[0] === 'trigger'` and the absence of any depth bound are that arm's,
 * for that arm's reasons, restated below where they are read.
 */
function isFlowEnablementWrite(parts: string[], method: string): boolean {
    return method === 'POST' && parts[1] === 'toggle' && parts[0] !== 'trigger';
}

/**
 * [#10145] Which `/automation` routes the `manage_metadata` write set covers.
 *
 * One predicate, for the reason {@link isRunStateRead} is one predicate: this
 * domain gets one policy per data class, and a policy spelled at three call
 * sites is three policies that happen to agree today. [#10243] That is why the
 * toggle ruling below was one arm here rather than a fourth copy of the policy.
 *
 *   `POST   /`             → registerFlow    (create)
 *   `PUT    /:name`        → registerFlow    (update)
 *   `DELETE /:name`        → unregisterFlow  (deregister)
 *   `POST   /:name/toggle` → toggleFlow      (enablement — #10243, see below)
 *
 * ## [#10243] Why `toggle` joins them — ruled, not inferred
 *
 * #10145 left it out and said so in the open, because whether disabling a flow
 * is authoring or operating is a product call rather than a code call. It was
 * filed, MEASURED over HTTP, and ruled (2026-08-23). What the measurement found
 * is the reason the answer is not "it is engine state, so leave it":
 *
 *   - The bit is NOT a row, so no organization wall scopes it. `toggleFlow`
 *     writes an in-process map keyed by flow NAME only; `getFlowRuntimeStates`
 *     reads that same map with no caller, no organization and no argument; and
 *     the automation service is ONE instance per environment.
 *   - So on a real, non-degraded `isolated` posture, a tenant org owner without
 *     this capability switched a shipped flow off and an unrelated tenant in a
 *     DIFFERENT organization — and the platform admin — read it off, in both
 *     directions. Environment-wide reach from an unentitled caller.
 *   - Mitigating but not exculpating: the override is process-local, so a cold
 *     boot reads `enabled: true` again.
 *
 * Disabling a shipped flow is functionally equivalent to deleting it for as
 * long as it stays off, and `DELETE /:name` is already here. No new capability
 * name was minted for it (option C was declined): one predicate, one policy.
 *
 * ⛔ The EXECUTION routes are still deliberately NOT here, and the omission is
 * the ruling rather than an oversight — authoring and executing are different
 * questions, and sweeping a run surface into a metadata gate would lock every
 * ordinary user out of the flows built for them:
 *
 *   - `POST /:name/trigger` and the legacy `POST /trigger/:name` RUN a flow.
 *     They are the door a member's own record action goes through.
 *   - `POST /:name/runs/:runId/resume` resumes a paused run and is already
 *     fail-closed on the suspended node's `resumeAuthority` (#3801 / #5561) —
 *     a second, unrelated gate in front of it would refuse the very user the
 *     flow paused for, which is the mistake #7968 records for the screen read.
 *
 * The reads are untouched: `GET /` and `GET /:name` serve flow definitions and
 * keep the posture the #7900 audit recorded for them.
 */
function isFlowAuthoringWrite(parts: string[], method: string): boolean {
    // `POST /automation` — the create door. `parts` is empty only for the
    // domain root, so `POST /trigger/:name` (parts `['trigger', name]`) and
    // `POST /:name/trigger` cannot reach this arm.
    if (method === 'POST' && parts.length === 0) return true;
    // [#10243] `POST /automation/:name/toggle` — the enablement door.
    //
    // Matched exactly as the ROUTER matches it, not approximately, because a
    // gate narrower than its route is a bypass and a gate wider than its route
    // is an over-block:
    //
    //   - No upper bound on depth. The toggle arm below tests `parts[1] ===
    //     'toggle'` with no length check, so `/:name/toggle/anything` still
    //     reaches `toggleFlow`; `parts.length === 2` here would leave exactly
    //     that spelling ungated.
    //   - `parts[0] === 'trigger'` is excluded. `POST /automation/trigger/:name`
    //     is the LEGACY EXECUTION door and it is answered ABOVE this domain's
    //     toggle arm, so for a flow literally named `toggle` the path
    //     `/automation/trigger/toggle` RUNS that flow. Gating it would over-block
    //     an execution door, which is the one thing the ruling did not do.
    //
    // [#11666] Delegated to `isFlowEnablementWrite` rather than inlined, because
    // the refusal text now asks the same question; under this guard the helper
    // reduces to exactly the `parts[0] !== 'trigger'` it replaces.
    if (method === 'POST' && parts[1] === 'toggle') return isFlowEnablementWrite(parts, method);
    // [#12156] `POST /automation/:name/clone` — the ADR-0126 §7.1 clone door.
    //
    // It CREATES a flow, so it belongs to this set for the same reason
    // `POST /` does, and leaving it out would have been a bypass of the whole
    // #10145 gate rather than a gap in it: the measured escalation there was a
    // tenant org owner without `manage_metadata` registering flow metadata at
    // ENVIRONMENT scope, and a clone door registers flow metadata at
    // environment scope. An ungated clone reproduces that verbatim, with the
    // extra twist that the caller does not even have to author a definition —
    // it copies one the deployment already trusts.
    //
    // Matched exactly as the toggle arm above is, and for the identical
    // reason: no upper bound on depth (the route arm tests `parts[1] ===
    // 'clone'` with no length check, so a gate spelled `parts.length === 2`
    // would leave `/:name/clone/anything` ungated), and `parts[0] !==
    // 'trigger'` so that `POST /automation/trigger/clone` — the LEGACY
    // EXECUTION door for a flow literally named `clone` — is not over-blocked.
    if (method === 'POST' && parts[1] === 'clone') return parts[0] !== 'trigger';
    // `PUT /automation/:name` / `DELETE /automation/:name` — the update and
    // deregister doors. Exactly one segment: a deeper path is a run surface.
    if (method === 'PUT' || method === 'DELETE') return parts.length === 1;
    return false;
}

/**
 * [ADR-0126 §5] Which routes the ACTIVATION gate covers: the enable/disable
 * door, and only it.
 *
 * A second predicate rather than an arm of {@link isFlowAuthoringWrite}
 * because the two ask different questions and cover different route sets. That
 * one asks "is this an authoring write?" (create / update / delete / toggle /
 * clone → `manage_metadata`); this one asks "does this write an INSTALL-WIDE
 * activation row?", which is true of the toggle alone. ⛔ `clone` is
 * deliberately NOT here: a clone creates an ordinary new artifact under a new
 * name (§7.1) and takes nothing away from any tenant, so gating it on the
 * platform operator would refuse the very customization path this refusal
 * message recommends.
 *
 * Spelled exactly like the toggle arm of the predicate above — no upper bound
 * on depth, `parts[0] !== 'trigger'` — for the reasons documented there: a
 * gate narrower than its route is a bypass, and a gate wider than its route
 * over-blocks the legacy execution door.
 */
function isFlowActivationWrite(parts: string[], method: string): boolean {
    if (method === 'POST' && parts[1] === 'toggle') return parts[0] !== 'trigger';
    return false;
}

/**
 * [#10145] The authoring-write gate: refuse a caller without
 * {@link FLOW_AUTHORING_CAPABILITY}.
 *
 * ## What it closes, measured over HTTP
 *
 * On a walled multi-organization deployment (`OS_TENANCY_POSTURE=isolated`) a
 * plain tenant org owner holding `organization_admin` and NOT this capability —
 * the same session answered 403 by `PUT /meta/:type/:name`,
 * `POST /ai/tools/:tool/execute` and `POST /packages/*` — created, modified and
 * DELETED flows here, all 200. Flow metadata is registered at ENVIRONMENT
 * scope, not organization scope, so the write crossed the tenant wall: a
 * shipped flow one tenant deleted read 404 for the actor, for an unrelated
 * tenant AND for the platform admin; an injected flow read 200 for all three.
 * Privilege escalation and cross-tenant metadata mutation in one call.
 *
 * ## Structure — copied from this file's own neighbours, not reinvented
 *
 * Returns a refusal to short-circuit on, `undefined` to proceed, so the caller
 * reads as a guard clause and no route can consume a denial as a value
 * ({@link refuseUngrantedRunRead}'s shape).
 *
 * Engine self-invocation (`isSystem`, never settable from the wire) bypasses,
 * matching `/meta`'s and `/packages`' gates and the run-state gate above: a
 * door that refused what the engine's own metadata loader does would not be
 * convergence. The capability channel is `systemPermissions` — CAPABILITIES,
 * not permission-SET names, which ride `permissions` (#4705).
 *
 * The message names the CAPABILITY it wants and nothing about the caller (no
 * positions, no permission-set names — #7450). [#11666] There are two of them,
 * picked by the arm that was actually refused — the definition writes get
 * {@link FLOW_WRITE_DENY_MESSAGE}, the enablement door gets
 * {@link FLOW_ENABLEMENT_DENY_MESSAGE}. ⛔ `code` and `status` are shared and
 * do not vary: one policy, one envelope, two sentences.
 *
 * ⚠️ Callers MUST run this BEFORE the automation service is resolved and before
 * any body validation, so (a) an unentitled caller cannot use the 501-vs-403
 * answer to fingerprint whether this deployment mounts automation, (b) nothing
 * is registered or unregistered before the refusal — "delete first, refuse
 * second" is the worst shape here, and it is precisely what the report
 * measured — and (c) the definition contract is not enumerable by probing
 * 422s from outside the authoring cohort.
 */
/**
 * [ADR-0126 §5] THE WRITE-AUTHORITY GATE for the packaged-flow activation
 * switch — `POST /automation/:name/toggle`.
 *
 * The gate itself now lives in `./activation-gate.ts`: ADR-0126 §8 item 2 put
 * ACTIONS on the same ledger under the same §5 authority, and a second copy of
 * a security gate is two policies that happen to agree today. Behaviour and
 * refusal text here are unchanged — what this door supplies is the per-artifact
 * clause ({@link FLOW_ACTIVATION_SUBJECT}), which is the only part that ever
 * differed. The shared module's header carries the full rationale: why the
 * operator test is a POSITION, why an absent posture fails open, and what
 * #10243 measured.
 */
const refuseUngrantedFlowActivationWrite = (
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult | undefined> =>
    refuseUngrantedActivationWrite(deps, context, FLOW_ACTIVATION_SUBJECT);

function refuseUngrantedFlowWrite(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    parts: string[],
    method: string,
): HttpDispatcherResult | undefined {
    const ec: any = context?.executionContext;
    if (ec?.isSystem) return undefined;
    if (new Set<string>(ec?.systemPermissions ?? []).has(FLOW_AUTHORING_CAPABILITY)) return undefined;

    // [#11666] Which sentence, decided from the SAME predicate that decided the
    // route is gated — never a second reading of the path.
    const message = isFlowEnablementWrite(parts, method)
        ? FLOW_ENABLEMENT_DENY_MESSAGE
        : FLOW_WRITE_DENY_MESSAGE;

    return {
        handled: true,
        response: deps.error(message, FLOW_WRITE_DENY_STATUS, { code: FLOW_WRITE_DENY_CODE }),
    };
}

/** [#13953] The path segment naming the cancel door (ADR-0044's operator verb). */
const RUN_CANCEL_SEGMENT = 'cancel';
/** [#13953] The path segment naming the repair door (#13909's operator verb). */
const RUN_RESTORE_SEGMENT = 'restore-suspension';

/**
 * [#13953] The two OPERATOR RUN-LIFECYCLE doors — `POST /:name/runs/:runId/cancel`
 * and `POST /:name/runs/:runId/restore-suspension`.
 *
 * Declared as ONE predicate for the reason {@link isRunStateRead} and
 * {@link isFlowAuthoringWrite} are one predicate each: this domain gets one
 * policy per data class, and a policy spelled at two call sites is two
 * policies that happen to agree today. It is read TWICE — once by the gate
 * below to decide the route is gated at all, once by each route arm to decide
 * the arm fires — so the gate and the routes it guards cannot drift apart. A
 * gate narrower than its route is a bypass; a gate wider than its route is an
 * over-block.
 *
 * ⛔ `parts[0] === 'trigger'` is excluded, exactly as the toggle (#10243) and
 * clone (#12156) arms exclude it, and the ROUTE ARMS carry the same exclusion
 * so the two spellings stay byte-identical. `POST /automation/trigger/:name`
 * is the LEGACY EXECUTION door, answered ABOVE the flow-scoped block, so for a
 * flow literally named `runs` the path `/automation/trigger/runs/x/cancel`
 * RUNS that flow. Gating it would over-block an execution door — the one thing
 * the #10243 ruling did not do — and dispatching a cancel from it would be the
 * mirror bypass.
 *
 * No upper bound on depth, for the reason the toggle arm documents: the arms
 * below test `parts[3]` with no length check, so a predicate spelled
 * `parts.length === 4` would leave `/…/cancel/anything` reaching the route
 * with no gate in front of it.
 */
function isRunLifecycleWrite(parts: string[], method: string): boolean {
    if (method !== 'POST') return false;
    if (parts[0] === 'trigger') return false;
    if (parts[1] !== 'runs' || !parts[2]) return false;
    return parts[3] === RUN_CANCEL_SEGMENT || parts[3] === RUN_RESTORE_SEGMENT;
}

/** [#13953] Refusal vocabulary for the run-lifecycle operator gate (ADR-0112: code AND status). */
const RUN_LIFECYCLE_DENY_STATUS = 403;
const RUN_LIFECYCLE_DENY_CODE = 'PERMISSION_DENIED';

/**
 * [#13953] The refusal sentence. It names the standing that would admit ANY
 * caller and nothing about this one (#7450), and — like every refusal in the
 * ADR-0126 §7 family — it names the sanctioned path a refused caller does
 * have, because the commonest reason to arrive here is an end user trying to
 * get their OWN paused run moving again, for which `resume` is the door.
 */
const RUN_LIFECYCLE_DENY_MESSAGE =
    'Cancelling an automation run, or restoring a consumed suspension, is a platform-operator verb: it ends or '
    + 're-arms a run for the whole environment, and a run belongs to the environment rather than to a user. It '
    + 'requires platform-operator standing (the unscoped `admin_full_access` grant, ADR-0068 D2). Resuming a run '
    + 'you are the declared authority for is a different question and stays open to you at '
    + '`POST /automation/:name/runs/:runId/resume`.';

/**
 * [#13953] THE RUN-LIFECYCLE GATE: the platform operator, and only the
 * platform operator.
 *
 * ## Why this is a THIRD policy on this domain rather than an arm of an
 * existing one
 *
 * The card's own words are the reason: *"a repair verb re-arms a run the
 * platform recorded as terminally failed, so 'who may do this' is a real
 * question and not the same answer as 'who may resume'"*. Neither existing
 * predicate answers it:
 *
 *  - {@link isRunStateRead} / {@link refuseUngrantedRunRead} govern READS of
 *    `sys_automation_run`-class data. These verbs WRITE run lifecycle; the
 *    grant that lets support tooling look at a run is not the authority to end
 *    one or to re-arm one.
 *  - {@link isFlowAuthoringWrite} governs the flow DEFINITION (`manage_metadata`,
 *    the metadata plane). A run is not a definition, and the #10145 comment
 *    says in as many words why the execution surfaces are deliberately outside
 *    that set — sweeping a run surface into a metadata gate locks every
 *    ordinary user out of the flows built for them.
 *
 * ## The authority, and why it is spelled as the RUNG
 *
 * Maintainer ruling, 2026-09-05 (the #13953 fork, option A): both verbs are
 * *"platform-operator verbs gated on the existing `platform_admin` position
 * (no new permission type, no per-run ownership — a run belongs to the
 * environment, not a user)"*.
 *
 * ⛔ [#15981] What that is READ as is the ADR-0095 D2/D3 posture RUNG
 * (`posture === 'PLATFORM_ADMIN'`), NEVER
 * `positions.includes('platform_admin')` — the same correction
 * `./activation-gate.ts` carries, made here at birth rather than after a
 * measurement. `positions[]` also carries ADR-0057 D4 `sys_user_position`
 * names, and that table is `apiEnabled` with unconstrained `position` values,
 * so a tenant can mint a row spelling the built-in and
 * `resolveUserAuthzGrants` §4 pushes it onto the array. The rung is derived
 * from the unscoped `admin_full_access` evidence and nothing else, so it is
 * what the ruling MEANT, and it is byte-for-byte what
 * `hasPlatformAdminStanding` returns.
 *
 * ## ⛔ Why it is NOT posture-conditional the way the activation gate is
 *
 * `refuseUngrantedActivationWrite` requires the operator only under
 * `group`/`isolated`, and falls open under `single` — correctly, because a
 * capability tier (`manage_metadata`) still gates it there, so `single` is not
 * an ungated deployment. This door has no such tier in front of it, so the
 * same conditionality would leave the two verbs open to any authenticated
 * caller on every single-organization deployment. That is LOOSER than
 * `resume`, which is fail-closed on the suspended node's declared
 * `resumeAuthority` (#3801 / #5561) on every deployment, and the card's floor
 * is that this door is at least as strict as `resume`'s. So the rung is
 * required unconditionally.
 *
 * ## The two non-denials, each of which is a decision
 *
 * 1. **System context passes** (`isSystem`, never settable from the wire) — as
 *    at every neighbouring gate in this file and in `./activation-gate.ts`. The
 *    in-process owner the contract names, `plugin-approvals`' revise-window
 *    recall (ADR-0044), cancels on behalf of a decision it already authorized
 *    and recorded; it does not speak HTTP and never enters this handler.
 * 2. **Nothing else passes.** An absent `executionContext`, an absent
 *    `posture`, or any other rung all fall through to the refusal. A
 *    deployment with no authorization system resolves no rung, so it has no
 *    platform operator to name — and answering an operator verb there would be
 *    inventing one. That direction is deliberate and it is the fail-closed
 *    one; the #5519 anonymous floor answers an unidentified caller 401 before
 *    this gate is reached at all.
 *
 * Returns a refusal to short-circuit on, `undefined` to proceed — the shape
 * every gate in this family uses, so no route can consume a denial as a value.
 *
 * ⚠️ Callers MUST run this BEFORE the automation service is resolved and
 * before any body validation, for the reasons {@link refuseUngrantedFlowWrite}
 * documents: an unentitled caller must not learn from a 501-vs-403 whether
 * this deployment mounts automation, nothing may be cancelled or re-armed
 * before the refusal, and the body contract must not be enumerable by probing
 * validation errors from outside the operator cohort.
 *
 * Synchronous: the rung rides the caller's own execution context, so nothing
 * is resolved and no outage class exists here to absorb.
 */
function refuseUngrantedRunLifecycleWrite(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): HttpDispatcherResult | undefined {
    const ec: any = context?.executionContext;
    if (ec?.isSystem) return undefined;
    if (ec?.posture === 'PLATFORM_ADMIN') return undefined;

    return {
        handled: true,
        response: deps.error(RUN_LIFECYCLE_DENY_MESSAGE, RUN_LIFECYCLE_DENY_STATUS, {
            code: RUN_LIFECYCLE_DENY_CODE,
        }),
    };
}

/**
 * [#13953] The CLOSED body envelope both lifecycle doors accept — exactly one
 * optional key, `reason`.
 *
 * Shaped on the resume door's own envelope discipline (#8796 / #9416), for the
 * same reason and with the same three refusals: the body itself must be a JSON
 * object (a string / number / boolean / array body used to normalise to `{}`
 * there and reach the engine as an empty signal, answered 200), an unknown
 * top-level key is refused rather than dropped, and an accepted key carrying
 * the wrong TYPE is refused rather than coerced.
 *
 * ⛔ `requestedBy` is deliberately NOT an accepted key, and refusing it is the
 * point rather than an omission. The contract slot exists — `restoreConsumedSuspension`
 * takes `options.requestedBy` and the implementation's trace records it — but a
 * door that let the WIRE fill it would let an operator write somebody else's
 * name into the record of who re-armed a terminally-failed run, which is the
 * one field that record exists for. The door fills it from the caller's own
 * authenticated identity instead (see the route arm), so a caller who spells it
 * in the body gets a loud refusal rather than the silent impression that they
 * set it.
 *
 * Returns `undefined` when the body is acceptable; a `HttpDispatcherResult` to
 * short-circuit on otherwise — the guard-clause shape every refusal in this
 * file uses.
 */
function refuseInvalidRunLifecycleBody(
    deps: DomainHandlerDeps,
    rawBody: unknown,
    door: string,
): HttpDispatcherResult | undefined {
    /**
     * How the offending value is NAMED back to the caller. A second copy of
     * the resume arm's one-liner rather than a hoist of it, DELIBERATELY: that
     * arm's own note records the decision that it stays local to the arm it
     * serves — *"it exists to make one refusal message readable, not to become
     * a shared formatter for a vocabulary nobody has ruled on"* — and hoisting
     * it here would overturn that decision as a side effect of adding a route.
     */
    const jsonTypeOf = (v: unknown): string =>
        v === null ? 'null' : Array.isArray(v) ? 'an array' : `a ${typeof v}`;

    if (rawBody === undefined || rawBody === null) return undefined;
    if (typeof rawBody !== 'object' || Array.isArray(rawBody)) {
        return {
            handled: true,
            response: deps.errorFromThrown(
                validationFailure(
                    `Invalid ${door} body — expected an object with an optional \`reason\`, received `
                    + `${jsonTypeOf(rawBody)}`,
                    [{ field: '(body)', code: 'invalid_type', message: 'expected an object' }],
                ),
                VALIDATION_FAILED_STATUS,
            ),
        };
    }

    const unknownKeys = Object.keys(rawBody as Record<string, unknown>).filter((k) => k !== 'reason');
    if (unknownKeys.length) {
        return {
            handled: true,
            response: deps.errorFromThrown(
                validationFailure(
                    `Unknown key${unknownKeys.length > 1 ? 's' : ''} `
                    + `${unknownKeys.map((k) => `\`${k}\``).join(', ')} — the ${door} body accepts \`reason\``
                    + (unknownKeys.includes('requestedBy')
                        ? '; `requestedBy` is filled from the authenticated caller and is not settable from the wire'
                        : ''),
                    unknownKeys.map((k) => ({
                        field: k,
                        code: 'unrecognized_keys' as const,
                        message: `not a ${door} body key — the ${door} body accepts \`reason\``,
                    })),
                ),
                VALIDATION_FAILED_STATUS,
            ),
        };
    }

    const reason = (rawBody as { reason?: unknown }).reason;
    if (reason !== undefined && typeof reason !== 'string') {
        return {
            handled: true,
            response: deps.errorFromThrown(
                validationFailure(
                    `Invalid ${door} body — \`reason\` must be a string, received ${jsonTypeOf(reason)}`,
                    [{ field: 'reason', code: 'invalid_type', message: 'expected a string' }],
                ),
                VALIDATION_FAILED_STATUS,
            ),
        };
    }

    return undefined;
}

/**
 * [#13953] The refusal-code → HTTP-status table for
 * `restoreConsumedSuspension`, and the fail-closed answer for everything that
 * is not in it.
 *
 * ⚠️ THIS SWITCH IS NON-EXHAUSTIVE BY CONSTRUCTION, and that is a property of
 * the contract rather than a gap here. `IAutomationService` types the refusal
 * as `refusal?: string` — a deliberate COVARIANT WIDENING of the engine's own
 * closed eight-member `SuspensionRestoreRefusal` union (#16495 route (i)): the
 * contract declines to keep an enumeration in step with an implementation's
 * vocabulary, and the wider engine type satisfies the narrower contract one
 * under `implements`. So this door is reading a `string` and any implementation
 * may answer a code that did not exist when this table was written.
 *
 * ⛔ The vocabulary is NOT narrowed or extended here. Closing it is a
 * `packages/spec` card; a call site that widened it would be exactly the
 * "second consumer that needs the vocabulary itself" the contract's own
 * docblock rules out.
 *
 * The eight rows are the engine's, mapped onto the statuses this same door
 * already uses for the same conditions on `resume` — so one deployment cannot
 * answer `RUN_NOT_FOUND` two ways depending on which verb asked:
 *
 *   `RUN_NOT_FOUND`          → 404, no record of the run at all (resume: 404)
 *   `STORE_UNAVAILABLE`      → 503, the store is unreadable so existence is
 *                              UNKNOWN and the same call is expected to work
 *                              once it recovers (resume: 503)
 *   `RESUME_IN_PROGRESS`     → 409, a resume holds this run right now
 *                              (resume: 409)
 *   `RESTORE_IN_PROGRESS`    → 409, a restore holds it — the same class
 *   `RUN_SUSPENDED`          → 409, a live suspension already exists, so the
 *                              run is resumable and there is nothing to repair
 *   `RUN_COMPLETED`          → 409, the run finished
 *   `RUN_CANCELLED`          → 409, somebody ended it on purpose (ADR-0044)
 *   `NO_CONSUMED_SUSPENSION` → 409, the run exists and holds no consumed
 *                              suspension to put back
 *
 * The five 409s are one class stated five ways: the run's OWN STATE refuses
 * the repair, the request was well-formed, and retrying it unchanged will
 * answer the same. They are not collapsed at the source — the engine's
 * `reason` sentence, which this door relays verbatim, is what tells "this run
 * is fine" from "this run is beyond this verb", and the code itself rides
 * `details.refusal`.
 */
const RESTORE_REFUSAL_STATUS: Readonly<Record<string, number>> = Object.freeze({
    RUN_NOT_FOUND: 404,
    STORE_UNAVAILABLE: 503,
    RESUME_IN_PROGRESS: 409,
    RESTORE_IN_PROGRESS: 409,
    RUN_SUSPENDED: 409,
    RUN_COMPLETED: 409,
    RUN_CANCELLED: 409,
    NO_CONSUMED_SUSPENSION: 409,
});

/**
 * [#13953] The fail-closed status for a refusal this door cannot classify —
 * an unrecognised code, or a `restored: false` carrying no code at all.
 *
 * ⛔ NOT one of the 409s, and the choice is the whole point of the arm. A 409
 * would CLAIM a diagnosis this door did not make ("the run's state refuses
 * this, retrying will not help"), and a caller — or an agent — reading that
 * would stop, believing the platform had answered them. 500 says the true
 * thing: the implementation refused, and this door does not know what it
 * refused with, so nothing about the run's state has been established here.
 * The refusal itself is never absorbed into a 200 either way, which is
 * #13909's posture — ⛔ never a door that returns success while hiding the
 * condition.
 */
const RESTORE_REFUSAL_UNKNOWN_STATUS = 500;

/**
 * [#13953] The ABSENT-MEMBER refusals — the half of the fail-closed promise
 * the contract cannot keep on its own.
 *
 * Both verbs are OPTIONAL members of `IAutomationService` (the house
 * convention: 13 of its 15 members are), and that is deliberate — cancelling
 * or repairing a suspension is a capability of the flow-engine implementation,
 * exactly like `resume`, and a script-runner slot never suspends and has
 * nothing to cancel. The contract states the consequence and hands this door
 * the job: *"A service that does not declare this member has NO operator door
 * for it: a door MUST probe for presence and refuse fail-closed when it is
 * absent — never answer success for a verb it could not dispatch."*
 *
 * ⇒ 501, in the shape `resume` already uses one arm up (`'Resume not
 * supported'`), and ⛔ never `{ handled: false }`. The difference matters and
 * is `./unavailable.ts`'s whole subject: a fall-through becomes the
 * dispatcher's `404 ROUTE_NOT_FOUND` with the hint "check the API discovery
 * endpoint", both halves of which are false here — a handler DID match, and
 * discovery does not list the route — so an operator reads a routing bug that
 * does not exist. `error.code` derives from the 501 as `NOT_IMPLEMENTED`
 * (ADR-0112), which is the accurate one: the route is mounted, the
 * implementation behind it is not.
 *
 * ⛔ And never a 200. That is the pin the whole fail-closed promise rests on:
 * a door that answered `{ cancelled: false }` or `{ restored: false }` for a
 * verb it never dispatched would be #13909's exact failure — success hiding
 * the condition — and it would be indistinguishable, on the wire, from a real
 * engine answering about a run it could not find.
 */
const RUN_CANCEL_UNSUPPORTED_MESSAGE =
    'Cancelling a run is not supported by the automation service this deployment mounts — it does not implement '
    + '`cancelRun`, an optional member of `IAutomationService`. No run was cancelled.';
const RUN_RESTORE_UNSUPPORTED_MESSAGE =
    'Restoring a consumed suspension is not supported by the automation service this deployment mounts — it does '
    + 'not implement `restoreConsumedSuspension`, an optional member of `IAutomationService`. No suspension was '
    + 'restored.';

/**
 * [#13953] The message for a refusal this door could not classify — no
 * `reason` came back, so there is nothing of the implementation's to relay.
 * Says what was established (nothing) rather than guessing at the run's state.
 */
const RUN_RESTORE_UNCLASSIFIED_MESSAGE =
    'The automation service refused to restore this run\'s consumed suspension and reported no reason this door '
    + 'recognises. Nothing has been established about the run\'s state, and no suspension was restored.';

/**
 * [#13953] What the cancel door says on `true`.
 *
 * ⚠️ It exists to keep the non-exclusivity of `true` from being invisible on
 * the wire. The engine has no cancel-side compare-and-set, so two overlapping
 * cancels of one run can each answer `true` and each write the terminal log.
 * This door keys nothing off it — but the door is not the last consumer, and a
 * caller who reads a bare `cancelled: true` as "I, uniquely, ended this run"
 * will build the once-only side effect the contract warns against one tier up
 * instead. Saying it here costs one string.
 */
const RUN_CANCEL_TRUE_NOTICE =
    'A suspended run was cancelled and a terminal `cancelled` log recorded. ⚠️ This answer is not exclusive to '
    + 'this call: overlapping cancels of one run can each answer `true` and each record the terminal log, so do '
    + 'not use it as an idempotency token for a once-only side effect.';

/**
 * [#13953] What the cancel door says on `false` — the two readings, both of
 * them, because nothing above the engine can tell them apart.
 *
 * The contract's `false` is "no suspended run exists under the id, which
 * callers treat as idempotent success". But an UNREADABLE durable store lands
 * on the same `false`, and then the run may still be parked and resumable. The
 * engine reports that path at `error` precisely because the caller cannot see
 * it. A door that answered a bare `cancelled: false` would be reporting a
 * clean idempotent no-op for a case where nothing is known — success hiding
 * the condition, which is what #13909 exists to name.
 */
const RUN_CANCEL_FALSE_NOTICE =
    'No suspended run was cancelled. ⚠️ Two conditions answer this way and the platform cannot tell them apart '
    + 'from here: the run is already terminal or unknown (idempotent success), OR the durable store could not be '
    + 'read, in which case the run may still be parked and resumable — the implementation reports that second '
    + 'case in its own logs at `error`. Confirm the run\'s state before treating this as done.';

/**
 * [#13953] Read the status for a refusal code, fail-closed.
 *
 * `Object.prototype.hasOwnProperty` rather than a bare index read, because the
 * code is a `string` off the wire-facing contract and a lookup of
 * `'constructor'` or `'__proto__'` on a plain object literal answers a
 * FUNCTION, which would then be spread into an HTTP status. The table is
 * frozen and null-prototype-free, so the own-property test is what makes the
 * read total.
 */
function restoreRefusalStatus(refusal: unknown): number {
    if (typeof refusal !== 'string') return RESTORE_REFUSAL_UNKNOWN_STATUS;
    if (!Object.prototype.hasOwnProperty.call(RESTORE_REFUSAL_STATUS, refusal)) {
        return RESTORE_REFUSAL_UNKNOWN_STATUS;
    }
    return RESTORE_REFUSAL_STATUS[refusal];
}

/**
 * [#7968] The screen route's gate: **the run's own trigger identity, OR the
 * `sys_automation_run` read grant as an operator override.**
 *
 * Maintainer ruling, 2026-08-12 (Option B). Acceptance, verbatim: *"stranger
 * with valid auth + run id ⇒ denied; triggering user ⇒ screen; holder of
 * `sys_automation_run` read ⇒ screen."*
 *
 * ## ⛔ Why this is NOT the grant check one route up
 *
 * The obvious gate — require the `sys_automation_run` grant, exactly as
 * `/:name/runs/:runId` does — was **considered and ruled out for this route**,
 * and the reason is the whole point of the card: it would **refuse the end user
 * the flow paused for**. The pause exists because the flow is asking THIS
 * caller to fill a form in; a screen served only to grant-holders is a screen
 * served to everyone except its audience. So the grant is the OVERRIDE half
 * here (operator tooling, support), never the whole question — and the
 * over-block direction is pinned as hard as the under-block one
 * (`automation-screen-read-gate.test.ts`).
 *
 * ## What the identity half reads, and why that field
 *
 * `ExecutionLogEntry.trigger.userId` — the caller whose request started the run,
 * written by the engine's single `buildRunTrigger` chokepoint (#7533) at every
 * site that records a run. It is the only identity the run itself carries, and
 * it is the same axis `resume` answers on (`resumeAuthority`, #3801 / #5561),
 * so read and write on one pause stay on one axis rather than the two unrelated
 * permissions #7900 exists to remove.
 *
 * ⚠️ It is deliberately NOT the richer per-run authority question — "may this
 * caller resume THIS suspension, per its declared `resumeAuthority`/assignee
 * state". That is Option A, recorded as the coherent end state and ADR-0019
 * class design work; B does not preclude it, because both refuse the same
 * stranger and admit the same end user.
 *
 * ## Order of operations — the 404 comes FIRST, on purpose
 *
 * Unlike the #7900 gate (which fires before the automation service is consulted
 * at all), this one runs AFTER `getSuspendedScreen`, and that ordering is a
 * decision with two reasons:
 *
 *  1. **A nonexistent run id must keep answering exactly as it does today.**
 *     The gate's identity half is derived from the run, so an unresolvable run
 *     would have to fail CLOSED — turning today's `404 No pending screen for
 *     run` into a 403 for every caller, including the honest ones who mistyped.
 *     Deciding only where there IS a screen to disclose keeps every 404 path
 *     byte-identical.
 *  2. **It cannot be asked earlier anyway.** The identity is a property of the
 *     run, so the run must be looked up before the question exists. Nothing is
 *     disclosed by the lookup: a refused caller gets the refusal, never the
 *     spec.
 *
 * The consequence, stated rather than hidden: a stranger can still tell a
 * paused run id (403) from an unknown one (404). That existence oracle is the
 * price of leaving the not-found behaviour untouched, it is strictly narrower
 * than the disclosure it replaces (an id, not the record's values), and closing
 * it means answering 404 for the refused caller — a different, defensible
 * design that is not what was ruled.
 *
 * ## The non-denials it inherits
 *
 * Everything {@link mayReadRunState} decides: a system context passes, a
 * deployment with no `plugin-security` (or a partial one) passes, and an
 * `explain` that throws fails CLOSED — but only the OVERRIDE half fails closed,
 * so the triggering user still gets their own screen while the permission
 * subsystem is unavailable. That asymmetry is the point of a two-half gate: the
 * end user's access does not depend on operator infrastructure.
 */
async function refuseUnrelatedScreenRead(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    automationService: Partial<IAutomationService>,
    runId: string,
): Promise<HttpDispatcherResult | undefined> {
    const ec = context?.executionContext;
    if (ec?.isSystem === true) return undefined;

    // ── Half 1: the run's own trigger identity ───────────────────────────────
    // Best-effort: `getRun` is optional on `IAutomationService`, and a service
    // that cannot answer who triggered a run simply does not admit anyone on
    // this half — it never admits everyone. A throw is the same: unresolved,
    // not granted.
    const callerId = typeof ec?.userId === 'string' && ec.userId !== '' ? ec.userId : undefined;
    if (callerId && typeof automationService.getRun === 'function') {
        const run = await automationService.getRun(runId).catch(() => undefined);
        const triggerUserId = (run as { trigger?: { userId?: unknown } } | null | undefined)?.trigger?.userId;
        if (typeof triggerUserId === 'string' && triggerUserId === callerId) return undefined;
    }

    // ── Half 2: the operator override, asked as ONE question with #7900 ──────
    if (await mayReadRunState(deps, context)) return undefined;

    return {
        handled: true,
        response: deps.error(SCREEN_READ_DENY_MESSAGE, RUN_READ_DENY_STATUS, { code: RUN_READ_DENY_CODE }),
    };
}

/**
 * [#8055] A refusal thrown by `registerFlow` is the CALLER's metadata being
 * wrong — serve it as one.
 *
 * Every throw `registerFlow` can raise is a verdict on the definition in the
 * request body: `FlowSchema.parse` (a missing `label`, an unknown node key),
 * `validateControlFlow` (a malformed ADR-0031 region), `validateNodeConfigKeys`
 * (#4277's undeclared config key) and `validateFlowExpressions` (ADR-0032's
 * malformed predicate). None of them carries a `.status`, so both dispatcher
 * error exits fell back to **500 INTERNAL_ERROR** for four measured bodies
 * (#8055) — and 500 is the one thing the answer is not. Two costs, the same
 * pair #7535 spelled out on the sibling `/toggle` route:
 *
 *  - A retry-on-5xx client re-sends a request that can never succeed.
 *  - An agent authoring a flow reads "the server broke" instead of "your
 *    metadata is wrong". Case 4 is the sharpest: #4277 shaped that message so
 *    an authoring agent can SELF-CORRECT ("unknown config key `x` … not
 *    declared by this node type's configSchema … Declared here: …"), and it
 *    arrived under a status telling the agent to try again unchanged.
 *
 * ⛔ This changes the CLASS and the ENVELOPE only. Which bodies are refused is
 * decided entirely inside the engine and is not touched here — a definition
 * that registered before still registers, and every one that was refused is
 * still refused, with the engine's own message intact (a 400 never reaches the
 * #3867 5xx sanitiser, so the #4277 prescription survives verbatim).
 *
 * ## Why the whole call, rather than a recognised subset
 *
 * The alternative is to reclassify only the shapes this file can name — a
 * `ZodError`, or an engine message matched by its prose. #7535's fix rejected
 * exactly that ("teaching a shared catch to recognise one engine's message
 * string would make every domain's not-found depend on that prose"), and here
 * it would also be wrong on the merits: `registerFlow` IS the parse of a
 * caller-supplied document, so "the definition is bad" is the honest default
 * for a refusal it raises, not a guess about which one it raised.
 *
 * The escape hatch is the producer's, and it is the same precedence
 * `errorFromThrown` already applies: an error that DECLARES its own class with
 * `.status` / `.statusCode` keeps it. Nothing in the engine declares one today,
 * so this is not a live branch — it is the seam that keeps a future engine-side
 * "the flow store is unreachable" (a genuine 503) from being answered as the
 * author's fault.
 *
 * ## Why a `fields[]` entry with no path for the non-Zod refusals
 *
 * The engine's own messages LOCATE the fault in prose (`node 'n' (notify):
 * unknown config key \`totallyBogusKey\` at config.totallyBogusKey`), and
 * re-deriving that location by parsing the sentence is the same prose
 * dependency rejected above. So the entry addresses the body root — the
 * convention {@link fieldsFromZodIssues} already uses for a failure with no
 * path to point at — and carries the engine's text as its message. `code` is
 * `invalid_value`, the ADR-0114 catalog's "rejected for a reason no other
 * member names".
 *
 * The Zod branch's per-issue `code` is whatever {@link fieldsFromZodIssues}
 * produces — since #8124 that is the ADR-0114 D3 catalog: the helper maps
 * through `zodIssuesToFields` (`@objectstack/spec`), the same table the REST
 * transport applies, so `/analytics`, `/notifications` and this route speak
 * one field-code vocabulary instead of leaking Zod's.
 */
function flowDefinitionRefusal(err: any): unknown {
    // The producer declared its class; the boundary does not overrule it.
    if (typeof err?.status === 'number' || typeof err?.statusCode === 'number') return err;
    // Already the house shape (a service that throws `validationFailure` itself)
    // — re-wrapping would only duplicate the message.
    if (validationFailureDetails(err)) return err;

    // A Zod parse failure. The raw issue array must NOT reach the wire: it is
    // Zod's internal shape on a position the house envelope owns, and
    // `errorFromThrown` copies any `.issues` into `details` verbatim — which is
    // precisely how `{expected:'string', code:'invalid_type', path:['nodes',0,
    // 'label']}` was answered to a caller. Mapped to `fields[]` here, so the
    // converted error carries no `.issues` for that branch to find.
    const issues: unknown[] | undefined = Array.isArray(err?.issues) ? err.issues : undefined;
    if (issues && issues.every((i: any) => Array.isArray(i?.path))) {
        const fields = fieldsFromZodIssues(issues as Parameters<typeof fieldsFromZodIssues>[0]);
        return validationFailure(
            fields.length > 0
                ? `Invalid flow definition: ${fields.map((f) => `${f.field}: ${f.message}`).join('; ')}`
                : 'Invalid flow definition',
            fields,
        );
    }

    const message = typeof err?.message === 'string' && err.message.trim() !== ''
        ? err.message
        : 'Invalid flow definition';
    return validationFailure(message, [
        { field: '(body)', code: 'invalid_value', message },
    ]);
}

/**
 * [#9378] The ONE mapper both trigger doors answer through — `POST
 * /:name/trigger` and the legacy `POST /trigger/:name`, which
 * `client.automation.trigger()` calls. Extracted rather than written twice:
 * the two routes already shared one context builder so they could not drift
 * about what a body means (#4127), and they must not drift about what a
 * failed run means either.
 *
 * Until now both ended `return deps.success(result)` unconditionally, so a
 * flow that RAN AND FAILED came back as
 * `HTTP 200 {success:true,data:{success:false,error:"…"}}` — the double
 * envelope #3962 ruled out for `/actions` and #8684 closed on the resume
 * route. A caller that branches on the HTTP status alone read a failed run as
 * a successful one, and this is the door every app dispatches flows through.
 *
 * Implements the maintainer ruling on #9378 (2026-08-17) — completed by
 * #9415, extended by #10025's non-retryable row:
 *
 * | engine exit                | reality            | answer                |
 * |----------------------------|--------------------|-----------------------|
 * | flow not found             | never dispatched   | `404`                 |
 * | flow disabled              | never dispatched   | `409` `FLOW_DISABLED` |
 * | flow has no start node     | never dispatched   | `422` `FLOW_NO_START_NODE` |
 * | node config violates its declared `inputSchema` | never dispatched | `422` `FLOW_INPUT_SCHEMA_INVALID` |
 * | ran and failed (incl. the retry-strategy exits) | ran, rejected | `400` `FLOW_FAILED` |
 * | ran and PAUSED (whichever attempt) | ran, suspended | `200` + `runId` / `screen` |
 *
 * [#9510] The last row is NON-TERMINAL and is answered by its own arm at the
 * bottom of this function. The durable pause is not a refusal, and since the
 * suspend arm was restored to the engine's retry path it arrives from two
 * producers — `execute()`'s catch and `retryExecution` — which this door must
 * NOT be able to tell apart. See that arm for why it is written separately from
 * the terminal success it happens to answer identically.
 *
 * [#9446] **The table itself now lives in `../flow-dispatch-status.js`** — one
 * definition, read by this door and by `/actions` (`action-execution.ts`) —
 * because the maintainer ruled (2026-08-18, verbatim 「同意」) that it is a
 * property of the flow-dispatch CONTRACT rather than of this route. Everything
 * below about WHY each row answers as it does is unchanged and is still the
 * reference for it; what moved is the READING, so no door can drift from the
 * rule while claiming to implement it. Two things stay here because the table
 * deliberately does not answer them: the `errorMessage` / `summary` details on
 * the 400 arm, and the 200 an UNCLASSIFIED refusal still gets at this door.
 *
 * **404 is answered by the registry probe, not by reading the result.** It is
 * the SAME `getFlow` probe `POST /:name/toggle` (#7535) and `GET /:name` use,
 * so no two doors can disagree about which flows exist — and existence is a
 * question the transport legitimately owns, the way every REST resource route
 * owns its own 404. `getFlow` is optional on `IAutomationService`; an
 * implementation that omits it cannot be asked, so the trigger proceeds as
 * before rather than this inventing an answer.
 *
 * **400 is answered by the ENGINE's classification, never by sniffing.** The
 * engine stamps `status: 'failed'` on exactly the exits that dispatched the
 * flow and were rejected (#9378, engine `execute` / `retryExecution`); its
 * never-dispatched exits carry no `status`. So this reads a producer verdict —
 * it does not inspect `summary` / `durationMs` / the message text to guess the
 * class, which is the tolerant-consumer shape PD #12 forbids and the one
 * #8684 deliberately did not reproduce.
 *
 * ⚠️ `errorMessage` is the flow AUTHOR's own failure text and travels in
 * `details`, the one place the console reads it from (objectui
 * `flowResponse.ts`, PR #4899): the ADR-0112 envelope carries no `data`, so a
 * producer that builds its message out of `result.error` alone drops the
 * author's words silently. `summary` rides along for the same reason it was on
 * the 200 body — it is how a caller finds WHICH node failed.
 *
 * **409 and 422 are answered the SAME way as 400 — by reading the producer's
 * classification (#9415).** Both are never-dispatched exits, and telling them
 * apart needed the producer to say which is which. When #9413 landed, the
 * closed `AutomationResult.code` union had no honest member for either, so
 * both kept today's 200 and the question went to the spec seat under the
 * #9384 ruling (which keeps the union closed — a new member is a deliberate
 * widening, not a call-site mint). #9415 is that widening: the engine's
 * disabled-flow exit stamps `'FLOW_DISABLED'`, its start-node-less exit
 * stamps `'FLOW_NO_START_NODE'`, and the arms below read those. #10025
 * repeated the same shape for the definition-level input-schema refusal —
 * spec seat first (#11504 registered `'FLOW_INPUT_SCHEMA_INVALID'`), then the
 * engine's non-retryable short-circuit stamps it — so its 422 is read here
 * through the same shared table, again never minted at this call site.
 *
 * ⛔ The two workarounds this replaced were measured and REJECTED, and neither
 * becomes tempting again just because the arms now exist: matching the
 * engine's message text is a regex on prose (PD #12), and probing enable-state
 * here would put a second copy of the engine's own execution policy in the
 * transport, with a TOCTOU window in which a flow disabled between probe and
 * dispatch is answered as a malformed definition. Nothing below inspects
 * `summary`, `durationMs` or the message.
 *
 * Why these statuses and not one shared 4xx: a DISABLED flow is well-formed
 * and well-defined — only its current *state* conflicts with running it, and
 * flipping the switch makes the identical request succeed, which is 409's
 * meaning. A flow with NO START NODE is understood, exists, and cannot be
 * executed as stored: an authoring defect no retry fixes, which is 422's.
 * Collapsing them would tell an operator to flip a switch that will not help.
 *
 * ⚠️ **Ordering: the never-dispatched arms come FIRST.** They are exclusive of
 * the `status: 'failed'` arm today (a refused dispatch has no lifecycle
 * verdict), so the order is not load-bearing for correctness — but it states
 * the intended precedence, and it keeps a future producer that stamped both by
 * mistake from being reported as a run that failed, which is the wrong of the
 * two answers.
 */
async function respondToFlowTrigger(
    deps: DomainHandlerDeps,
    automationService: IAutomationService,
    flowName: string,
    body: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    if (await flowIsUnknown(automationService, flowName)) {
        return {
            handled: true,
            response: deps.error(flowNotFoundMessage(flowName), FLOW_NOT_FOUND_STATUS),
        };
    }
    const result = await automationService.execute(flowName, buildAutomationContext(body, context));
    const refusal = classifyFlowRefusal(flowName, result);
    if (refusal) {
        // The run's own artefacts ride the 400 arm ONLY — they describe a run
        // that happened. A never-dispatched refusal has no author failure text
        // and no node log to point at, so emitting either there would be this
        // door inventing run evidence for a run that never started.
        const runDetails = refusal.code === 'FLOW_FAILED'
            ? {
                ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
                ...(result.summary !== undefined ? { summary: result.summary } : {}),
            }
            : {};
        return {
            handled: true,
            response: deps.error(refusal.message, refusal.status, { code: refusal.code, ...runDetails }),
        };
    }
    // [#9510] THE THIRD STATE, answered deliberately. A run that dispatched and
    // then SUSPENDED at a pausing node (ADR-0019) is neither refused nor
    // finished: its continuation is persisted, and the `200` here carries the
    // `runId` — and the `screen`, for a screen flow — that the caller continues
    // it with at `POST /:name/runs/:runId/resume`, the door just below.
    //
    // The answer is unchanged from what this door has always given a paused
    // run, and that IS the requirement rather than an accident of ordering: it
    // must be the SAME answer a pause on the first attempt gets, because a
    // pause on a retry attempt is the same user-visible situation reached by a
    // different route. Two answers for one situation would replace #9510's LOST
    // pause with an inconsistent one. Pinned as an equality between the two
    // routes — engine-side in `service-automation`'s
    // `retry-attempt-pause.test.ts`, and on the wire through a real engine in
    // `@objectstack/verify`'s `automation-trigger-paused-run.test.ts`.
    //
    // ⛔ Its own arm even though it returns what the terminal exit below
    // returns. The two are different STATEMENTS about the run — "still running,
    // here is how to continue it" versus "it finished" — and collapsing them
    // recreates exactly the fall-through this card is about: a non-terminal
    // result that no reader on the path ever names is one edit away from being
    // classified as a terminal one.
    if (isPausedRun(result)) {
        return { handled: true, response: deps.success(result) };
    }
    // Terminal success: the run reached an `end` node, and `deps.success` serves
    // the engine result as the response data (`output`, `successMessage`,
    // `summary`).
    return { handled: true, response: deps.success(result) };
}

/**
 * The two `AutomationResult.status` members a `success: false` result can
 * carry — the enum `ResumeFailureDetailsSchema.status` publishes, spelled
 * once here and `satisfies`-bound to it (a member the spec drops reds this
 * line; a member the spec adds is caught by the spec's own subset pin).
 */
const TERMINAL_FAILURE_STATUSES = ['failed', 'stranded'] as const satisfies readonly NonNullable<ResumeFailureDetails['status']>[];

/** The guard {@link resumeFailureDetails} relays `status` through — a narrowing, never a default. */
function isTerminalFailureStatus(status: AutomationResult['status']): status is (typeof TERMINAL_FAILURE_STATUSES)[number] {
    return status !== undefined && (TERMINAL_FAILURE_STATUSES as readonly string[]).includes(status);
}

/**
 * [#15221] The machine-readable verdict the resume door's `400 FLOW_FAILED`
 * arm carries in `error.details`, beside the run's two artefacts — the
 * #16472 family ruling (maintainer 2026-09-07, option A), applied to this
 * door: `status: 'stranded'` and `repairable`, so a client branches without a
 * message regex, and ⛔ no `FLOW_STRANDED` sibling code (a new code is a
 * ledger event; the console needing one is its own card).
 *
 * The structure is `ResumeFailureDetailsSchema` (`@objectstack/spec/api`),
 * declared once for every carrier the ruling names; this door is the
 * PRODUCER of one of them, so the whole object is bound to that declaration
 * at compile time (the return type IS `ResumeFailureDetails`): the two
 * members the door owns are computed, and `status` is relayed through a
 * guard on the two terminal-failure members the published enum names.
 *
 * What each member says, and why it is shaped the way it is:
 *
 *  - `runId` — the run this door was asked to resume (the path's `:runId`).
 *    The engine stamps `'stranded'` on exactly one exit, `resumeInternal`'s
 *    own catch arm for the run being resumed, so the resumed run IS the run
 *    that is actually stranded; the engine result carries no `runId` on a
 *    terminal exit (the contract sets it on `'paused'` only), and this door
 *    knows the id from the request rather than sniffing it out of the
 *    engine's message.
 *  - `status` — the engine's own verdict, forwarded when it stamped one and
 *    never synthesised. Measured on the engine: the stranded exit stamps
 *    `'stranded'`; the other exit that reaches this arm — a subflow child
 *    that failed terminally — stamps nothing, so that arm carries no
 *    `status` today rather than a `'failed'` this door made up. Reading the
 *    producer's verdict is the whole rule (PD #12; `flow-dispatch-status.ts`
 *    says it for the trigger table). It is relayed through a GUARD on the
 *    two terminal-failure members (`'failed' | 'stranded'`) — exactly the
 *    members `ResumeFailureDetailsSchema.status` publishes — so the binding
 *    is true by construction and not by accident of what is reachable: a
 *    `success: false` result stamped with a `success: true` verdict
 *    (`'completed'` / `'paused'` / `'refused'`, unreachable per the contract)
 *    is neither forwarded under a schema that refuses it nor turned into
 *    anything else. `TERMINAL_FAILURE_STATUSES` is `satisfies`-bound to the
 *    schema's enum, so a member the spec drops reds this file.
 *  - `repairable` — `status === 'stranded'`, and ALWAYS present on this arm.
 *    Present-and-false on the plain terminal exit is a deliberate contract,
 *    not an implementation detail: an ABSENT member would be
 *    indistinguishable from a server that predates this field, and
 *    `StrandedDecisionDetails.repairable` (`@objectstack/types`, the approvals
 *    door's carrier) already fixed the vocabulary — `false` is the honest
 *    answer for every other exit, including the ones that report no status
 *    at all, because promising a repair verb that will refuse is worse than
 *    promising nothing.
 *
 * ⛔ Not reused from `@objectstack/types`: `strandedDecisionDetails` /
 * `strandedDecisionFailure` are an all-four-or-nothing envelope whose
 * `finalized` and `decision` are approvals facts with no referent at a
 * generic resume (this door has no decision to report), and its reader
 * refuses a partial envelope by design. Only the `repairable` / `runId`
 * vocabulary is shared, through the spec declaration.
 *
 * ⛔ Not on the trigger door and not on `/actions`: neither ever resumes, so
 * "repairable" has no referent there; their `400 FLOW_FAILED` details stay
 * `{ errorMessage?, summary? }`, and an absent `repairable` there means "not
 * a resume", never "not repairable". Pinned as exact `details` equality at
 * both doors: the trigger door in `automation-resume-stranded-details.test.ts`,
 * `/actions` in `actions-flow-dispatch-status.test.ts` (#9585's artefacts pin).
 */
function resumeFailureDetails(runId: string, result: AutomationResult): ResumeFailureDetails {
    const status = isTerminalFailureStatus(result.status) ? result.status : undefined;
    return {
        runId,
        repairable: status === 'stranded',
        ...(status !== undefined ? { status } : {}),
    };
}

/**
 * Handles Automation requests
 * path: sub-path after /automation/
 *
 * Routes:
 *   GET    /                     → listFlows
 *   GET    /actions              → getActionDescriptors (ADR-0018; ?paradigm/?source/?category
 *                                  single-string filters — validated, #7360)
 *   GET    /connectors           → getConnectorDescriptors (ADR-0022; ?type single-string
 *                                  filter — validated, #7360)
 *   GET    /:name                → getFlow
 *   POST   /                     → createFlow (registerFlow)
 *                                  ⚑ authoring write — `manage_metadata` (#10145)
 *   PUT    /:name                → updateFlow
 *                                  ⚑ authoring write — `manage_metadata` (#10145)
 *   DELETE /:name                → deleteFlow (unregisterFlow)
 *                                  ⚑ authoring write — `manage_metadata` (#10145)
 *   POST   /:name/trigger        → execute (legacy: trigger/:name also supported;
 *                                  unknown name → 404, disabled → 409 `FLOW_DISABLED`,
 *                                  no start node → 422 `FLOW_NO_START_NODE`, node config
 *                                  violating its `inputSchema` → 422
 *                                  `FLOW_INPUT_SCHEMA_INVALID` (#10025), a run that
 *                                  ran and failed → 400 `FLOW_FAILED`; #9378 + #9415;
 *                                  a run that PAUSED → 200 with `runId` / `screen`,
 *                                  on whichever attempt it paused — #9510)
 *   POST   /:name/toggle         → toggleFlow (unknown name → 404, #7535)
 *                                  ⚑ authoring write — `manage_metadata` (#10243):
 *                                    enablement is environment-wide, so an
 *                                    unentitled toggle reached every organization
 *                                    ⚑ refused with its OWN sentence (#11666) —
 *                                    same capability, code and status
 *   POST   /:name/clone          → clone the whole definition under a NEW machine
 *                                  name (ADR-0126 §7.1, #12156). Body
 *                                  `{ name, label }`, both mandatory; unknown source
 *                                  → 404, target name already taken → 409
 *                                  `RESOURCE_CONFLICT`. ⛔ No ancestry is recorded
 *                                  or returned (amendment ruling 2), and references
 *                                  are NOT re-pointed — the response says so (§9).
 *                                  ⚑ authoring write — `manage_metadata`: it
 *                                    registers flow metadata, like `POST /`
 *   GET    /:name/runs           → listRuns (query: limit, cursor — validated, #7300;
 *                                  status — validated AND honoured, #7359)
 *                                  ⚑ run-state read — `sys_automation_run` grant (#7900)
 *   GET    /:name/runs/:runId    → getRun
 *                                  ⚑ run-state read — `sys_automation_run` grant (#7900)
 *   POST   /:name/runs/:runId/resume → resume a paused run (screen input / ADR-0019;
 *                                  a run that resumed and then failed → 400
 *                                  `FLOW_FAILED` whose details carry the engine's
 *                                  verdict — `status: 'stranded'` + `repairable` —
 *                                  beside `errorMessage` / `summary`, #15221)
 *   POST   /:name/runs/:runId/cancel → cancel a suspended run (ADR-0044,
 *                                  #13953). Body `{ reason? }`, closed. Answers
 *                                  200 `{ runId, cancelled, notice }` both ways —
 *                                  `false` is idempotent success AND an
 *                                  unreadable store, and the notice says so
 *                                  ⚑ operator verb — the ADR-0095 PLATFORM_ADMIN
 *                                    rung, unconditionally (#13953)
 *   POST   /:name/runs/:runId/restore-suspension → put back the suspension a
 *                                  failed resume consumed (#13909, #13953). Body
 *                                  `{ reason? }`, closed; `requestedBy` comes from
 *                                  the authenticated caller, ⛔ never the wire.
 *                                  Refusals are refusals (404/409/503; an
 *                                  unrecognised refusal code → 500), ⛔ never a 200
 *                                  ⚑ operator verb — the same rung, same gate
 *   GET    /:name/runs/:runId/screen → the screen a paused run awaits
 *                                  ⚑ run's trigger identity OR the
 *                                    `sys_automation_run` grant (#7968)
 */
export async function handleAutomationRequest(deps: DomainHandlerDeps, path: string, method: string, body: any, context: HttpProtocolContext, query?: any): Promise<HttpDispatcherResult> {
    // [#5519] ANONYMOUS BASELINE — the same floor `/data`, `/meta`, `/ai` and
    // `/security` stand on (ADR-0056 D2 → #3963: "anonymous access is now
    // always denied"). `/automation` had none, and the whole domain is a write
    // surface: `POST /:name/trigger` starts a flow run, `POST /` and `PUT
    // /:name` register a flow definition, `DELETE /:name` unregisters one, and
    // `GET /` enumerates every flow the deployment has. All four were reachable
    // unauthenticated — verified against a real showcase boot, where an
    // anonymous `DELETE /automation/showcase_inquiry_janitor` answered 200
    // `{deleted: true}` and an anonymous trigger returned a live `runId`.
    //
    // Gated for the WHOLE domain rather than per-route, and ahead of the
    // service-availability probe below: one floor cannot drift route by route,
    // and an anonymous caller should not learn from a 501-vs-401 whether this
    // deployment mounts automation at all.
    //
    // ⚠️ This is the HTTP seam only. `buildAutomationContext` above is exported
    // and also used by the declarative endpoint executor (#5040 E5), which runs
    // in the transport's fallback seam and never enters this handler — a
    // metadata-declared `type: 'flow'` endpoint keeps its own policy chain and
    // is untouched here. Internal engine triggers (record-change, schedule)
    // never speak HTTP at all.
    {
        const ec: any = (context as any)?.executionContext;
        if (shouldDenyAnonymous({ userId: ec?.userId, isSystem: ec?.isSystem, method })) {
            return {
                handled: true,
                response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
            };
        }
    }
    const m = method.toUpperCase();
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // [#7900] RUN-STATE READ GATE — the maintainer ruling of 2026-08-12: the
    // `/automation` read surface requires the same permission the
    // `sys_automation_run` object read answers with. One policy, two doors, one
    // answer.
    //
    // What it closes, measured: `GET /:name/runs/:runId` answered with
    // `deps.success(run)` — the `ExecutionLogEntry` verbatim, no projection, no
    // redaction, no masking — so any AUTHENTICATED caller who knew a run id read
    // the triggering record's fields with that record's own FLS never applying.
    // `listRuns` serves the same entries a page at a time and was gated the same
    // (i.e. not at all).
    //
    // Placed with the #5519 anonymous floor and AHEAD of the service probe below
    // for that gate's own reason, read one authorization tier up: which
    // permission a route requires must not vary with which automation service a
    // deployment happens to mount, and a 501-vs-403 should not be the thing that
    // tells an ungranted caller whether automation is mounted here.
    //
    // Which routes: `isRunStateRead` above — deliberately one predicate, so the
    // domain's policy cannot drift route by route the way the finding described.
    if (isRunStateRead(parts, m)) {
        const refusal = await refuseUngrantedRunRead(deps, context);
        if (refusal) return refusal;
    }

    // [#10145] AUTHORING-WRITE GATE — `manage_metadata`, the capability the
    // metadata plane these flow definitions live on already requires of every
    // other door onto it. Placed with the two gates above and AHEAD of the
    // service probe below for their reason, read one tier up: which capability
    // a route requires must not vary with which automation service a deployment
    // mounts, and a 501-vs-403 must not be what tells an unentitled caller
    // whether automation is mounted here. Ahead of every body check too — a
    // refused caller writes nothing and learns nothing about the definition
    // contract. Which routes: `isFlowAuthoringWrite` above, one predicate, with
    // the execution surfaces deliberately outside it — [#10243] `POST
    // /:name/toggle` moved INSIDE it by ruling, and moved by editing that one
    // predicate rather than by adding a check here.
    if (isFlowAuthoringWrite(parts, m)) {
        const refusal = refuseUngrantedFlowWrite(deps, context, parts, m);
        if (refusal) return refusal;
    }

    // [ADR-0126 §5] ACTIVATION-WRITE GATE — the install-wide enable/disable
    // switch needs the platform operator in a walled posture. Placed directly
    // AFTER the authoring gate and BEFORE the service probe / body checks, for
    // the reasons that gate documents: an unentitled caller must not learn
    // whether automation is mounted here, and must not get a body-validation
    // answer that maps out the contract. Strictly narrower than the gate
    // above, never a replacement for it — a caller must hold `manage_metadata`
    // AND, in `group`/`isolated`, be the platform operator.
    if (isFlowActivationWrite(parts, m)) {
        const refusal = await refuseUngrantedFlowActivationWrite(deps, context);
        if (refusal) return refusal;
    }

    // [#13953] RUN-LIFECYCLE GATE — the two operator verbs (`cancel`,
    // `restore-suspension`) need the platform operator, unconditionally.
    // Placed with the three gates above and AHEAD of the service probe for
    // their reason, read one more tier up: which standing a route requires
    // must not vary with which automation service a deployment mounts, an
    // unentitled caller must not learn from a 501-vs-403 whether automation is
    // mounted here, and nothing may be cancelled or re-armed before the
    // refusal — "cancel first, refuse second" is the worst shape a run
    // lifecycle door can have. Ahead of the body checks too, so the envelope
    // is not enumerable by probing 422s from outside the operator cohort.
    // Which routes: `isRunLifecycleWrite` above, the SAME predicate the two
    // route arms fire on.
    if (isRunLifecycleWrite(parts, m)) {
        const refusal = refuseUngrantedRunLifecycleWrite(deps, context);
        if (refusal) return refusal;
    }

    const automationService = await deps.getService(context, CoreServiceName.enum.automation);
    // [#4058] Empty slot — or a slot filled by a self-declared non-handler
    // (`handlerReady: false`, ADR-0076 D12), which is the same amount of
    // automation capability. This domain is the sharpest case for the rule: a
    // stub whose `execute` returns `{ success: true }` without running anything
    // answered 200, so a caller (or an agent) read "flow executed" off a flow
    // that never ran.
    //
    // 501, not the `handled: false` this used to return: `/automation` IS
    // mounted, so the dispatcher's ROUTE_NOT_FOUND exit ("No handler matched
    // this request") described neither half truthfully. See ./unavailable.ts.
    if (!isServiceServeable(automationService)) return capabilityUnavailable(deps, 'automation');

    // Legacy: POST /automation/trigger/:name — the shape
    // `client.automation.trigger()` calls. Same handling as
    // `POST /:name/trigger` below: one context builder, one service method,
    // and since #9378 one response mapper.
    //
    // [#4127] This branch used to probe `automationService.trigger(name, body,
    // { request })` first and "fall back" to `execute`. Nothing in the repo has
    // ever implemented `trigger` on the automation slot — not the engine, not
    // the dev stub — and the contract never declared it, so the probe was dead
    // on every deployment and the fallback WAS the route. Declaring `trigger?`
    // to make the probe honest would have blessed a second name for `execute`
    // (Prime Directive #12); the dead branch is gone instead.
    //
    // [#9378] Both doors answer through `respondToFlowTrigger` — see its
    // docblock for the status table, complete since #9415 delivered the
    // ruling's remaining two rows (409 / 422).
    if (parts[0] === 'trigger' && parts[1] && m === 'POST') {
        const triggerName = parts[1];
        if (typeof automationService.execute === 'function') {
            return respondToFlowTrigger(deps, automationService, triggerName, body, context);
        }
    }

    // GET / → listFlows
    //
    // [#7900 AUDIT — stays authenticated-only, with a reason] Together with
    // `GET /:name`, `GET /actions`, `GET /connectors` and `GET /_status`, this
    // serves FLOW-DEFINITION and REGISTRY data: names, definitions, the
    // deployment's action/connector catalogs, per-flow enabled/bound state. None
    // of it is `sys_automation_run`-class data — no run, no trigger record, no
    // variable snapshot — so the grant the ruling names says nothing about it,
    // and requiring it here would not be convergence but a SECOND policy
    // invented for a different data class, which is precisely what the ruling
    // forbids. Flow definitions are metadata and are governed on the metadata
    // plane (`/meta`, ADR-0106); if their read posture should narrow, that is a
    // metadata-plane decision and belongs to its own card.
    if (parts.length === 0 && m === 'GET') {
        if (typeof automationService.listFlows === 'function') {
            const names = await automationService.listFlows();
            return { handled: true, response: deps.success({ flows: names, total: names.length, hasMore: false }) };
        }
    }

    // POST / → createFlow
    if (parts.length === 0 && m === 'POST') {
        if (typeof automationService.registerFlow === 'function') {
            // [#3899] `registerFlow(body?.name, body)` used to run unchecked, so
            // a definition whose `name` was missing or mistyped registered the
            // flow under the key `undefined` — 200, body echoed back, caller
            // convinced it succeeded, flow unreachable ever after. The name is
            // the registry key; require it before touching the registry.
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
                throw validationFailure('Flow definition body required', [
                    { field: '(body)', code: 'invalid_type', message: 'expected a flow definition object' },
                ]);
            }
            if (typeof body.name !== 'string' || body.name.trim() === '') {
                throw validationFailure('Flow definition requires a non-empty `name` (the registry key this flow is stored and triggered under)', [
                    { field: 'name', code: body.name === undefined ? 'required' : 'invalid_type', message: 'expected a non-empty string' },
                ]);
            }
            // [#8055] The engine's verdict on the definition is served as a
            // 400, not a 500 — see `flowDefinitionRefusal` above for what that
            // does and does not change. Caught and RETURNED (rather than
            // rethrown) for the reason the resume branch below already returns
            // its engine-originated refusals: `dispatch()` re-throws everything
            // that is not a permission denial, so a transport calling it
            // directly would otherwise get an exception where every other
            // refusal on this domain hands back a response.
            // [#12206, Option A] The door answers the canonicalized PARSED
            // flow `registerFlow` stored (schema defaults materialized,
            // `edge.condition` strings lowered to their envelopes) — the same
            // shape `GET /automation/:name` serves — never an echo of the
            // caller's own pre-parse bytes.
            let registered;
            try {
                registered = automationService.registerFlow(body.name, body);
            } catch (e) {
                return {
                    handled: true,
                    response: deps.errorFromThrown(flowDefinitionRefusal(e), VALIDATION_FAILED_STATUS),
                };
            }
            return { handled: true, response: deps.success(registered) };
        }
    }

    // GET /actions → list registered action descriptors (ADR-0018).
    // MUST precede the `/:name → getFlow` catch-all below, otherwise a
    // flow lookup for a flow literally named "actions" would shadow it.
    // Backs the designer palette + flow validation; the registry is open
    // and marketplace-extensible (built-in + plugin-contributed actions).
    if (parts[0] === 'actions' && parts.length === 1 && m === 'GET') {
        // [#7360] The three filters below used to compare the RAW query value
        // against a string field. A repeated parameter arrives as an ARRAY from
        // every query parser these routes run behind, and an array is never
        // `===` any string and never a member of `paradigms[]` — so
        // `?source=builtin&source=plugin` (a caller widening its filter, or a UI
        // serialising a multi-select the obvious way) answered **200 with zero
        // descriptors**, which the designer palette reads as "this deployment
        // registers no actions". That is a different sentence from "no actions
        // matched", and nothing in the response distinguishes them. Same for a
        // structured `?category[$ne]=x`.
        //
        // Parsed AHEAD of the capability probe below on purpose: a malformed
        // query is malformed whichever automation service this deployment
        // mounts, and a 400 that appears only where `getActionDescriptors` is
        // implemented would be a contract that varies by deployment.
        const paradigm = parseStringParam('paradigm', query?.paradigm);
        const source = parseStringParam('source', query?.source);
        const category = parseStringParam('category', query?.category);
        if (typeof automationService.getActionDescriptors === 'function') {
            let actions = automationService.getActionDescriptors() ?? [];
            // Optional filters mirror descriptor fields. The falsy gate is the
            // one these always had: an absent or empty spelling means "no
            // filter", and every other string — including one naming no live
            // paradigm/source/category — still filters to a legitimate empty
            // list exactly as before. Only a non-string is refused.
            if (paradigm) {
                actions = actions.filter((a: any) => Array.isArray(a?.paradigms) && a.paradigms.includes(paradigm));
            }
            if (source) {
                actions = actions.filter((a: any) => a?.source === source);
            }
            if (category) {
                actions = actions.filter((a: any) => a?.category === category);
            }
            return { handled: true, response: deps.success({ actions, total: actions.length }) };
        }
        // Service present but does not implement the optional method:
        // report an empty (but valid) registry rather than a 404.
        return { handled: true, response: deps.success({ actions: [], total: 0 }) };
    }

    // GET /connectors → list registered connector descriptors (ADR-0022).
    // Like /actions, MUST precede the `/:name → getFlow` catch-all so a flow
    // named "connectors" cannot shadow it. Backs the designer's
    // `connector_action` connector/action/input pickers; the registry is
    // empty in baseline and populated by connector plugins (e.g.
    // @objectstack/connector-rest, @objectstack/connector-slack).
    if (parts[0] === 'connectors' && parts.length === 1 && m === 'GET') {
        // [#7360] The `/actions` note above applies verbatim to this filter:
        // `?type=rest&type=slack` arrived as an array, matched no connector,
        // and answered 200 with an empty registry to a picker that cannot tell
        // that from "no connector plugins are installed". Parsed ahead of the
        // capability probe for the same reason as `/actions`.
        const type = parseStringParam('type', query?.type);
        // [#4127] The method is declared on IAutomationService now, so the
        // `?type=` filter reads `ConnectorDescriptor['type']` instead of
        // re-typing each element as `any` — a filter on a field the contract
        // did not know existed was a typo away from silently matching nothing.
        const svc = automationService as Pick<IAutomationService, 'getConnectorDescriptors'>;
        if (typeof svc.getConnectorDescriptors === 'function') {
            let connectors = svc.getConnectorDescriptors() ?? [];
            // Optional filter mirrors the descriptor's connector type.
            if (type) {
                connectors = connectors.filter((c) => c?.type === type);
            }
            return { handled: true, response: deps.success({ connectors, total: connectors.length }) };
        }
        // Service present but does not implement the optional method:
        // report an empty (but valid) registry rather than a 404.
        return { handled: true, response: deps.success({ connectors: [], total: 0 }) };
    }

    // GET /_status → runtime enable/bound state for every flow (backs the
    // Studio's Automations status badges: persisted `status` is metadata, but
    // whether a flow is actually enabled + bound to its trigger is engine
    // state). Underscore-prefixed so no flow name can shadow it; MUST precede
    // the `/:name → getFlow` catch-all.
    if (parts[0] === '_status' && parts.length === 1 && m === 'GET') {
        // [#4127] Was an inline cast re-declaring the shape as
        // `{ name, enabled, bound }` — a third copy of it (engine, here,
        // caller), and a narrower one than the engine actually returns: it
        // omitted `status` / `triggerType` / `object`, the three fields the
        // Studio badge needs to say WHY a flow is unbound. Reads the contract
        // now, so there is one shape.
        const svc = automationService as Pick<IAutomationService, 'getFlowRuntimeStates'>;
        if (typeof svc.getFlowRuntimeStates === 'function') {
            const flows = svc.getFlowRuntimeStates();
            return { handled: true, response: deps.success({ flows, total: flows.length }) };
        }
        // Service present but older / does not implement the method.
        return { handled: true, response: deps.success({ flows: [], total: 0 }) };
    }

    // Routes with :name
    if (parts.length >= 1) {
        const name = parts[0];

        // POST /:name/trigger → execute. Body translation and identity
        // forwarding live in `buildAutomationContext` (#4127), shared with the
        // legacy `POST /trigger/:name` above so the two routes cannot drift.
        if (parts[1] === 'trigger' && m === 'POST') {
            if (typeof automationService.execute === 'function') {
                return respondToFlowTrigger(deps, automationService, name, body, context);
            }
        }

        // POST /:name/toggle → toggleFlow
        if (parts[1] === 'toggle' && m === 'POST') {
            if (typeof automationService.toggleFlow === 'function') {
                // [#3899] The old read was `body?.enabled ?? true` on an
                // otherwise-unchecked body, so `{"enable": false}` — one letter
                // off — ENABLED the flow and answered 200 `{enabled: true}`;
                // `{"enabled": "false"}` (a string) toggled on too. The caller
                // trying to switch a flow OFF is exactly the caller this must
                // not silently invert. Contract: `{ enabled?: boolean }`, empty
                // body = enable (the SDK always sends the key; bodyless enable
                // is the documented legacy shape).
                const toggleBody = body ?? {};
                if (typeof toggleBody !== 'object' || Array.isArray(toggleBody)) {
                    throw validationFailure('Invalid toggle body — expected { enabled?: boolean }', [
                        { field: '(body)', code: 'invalid_type', message: 'expected an object' },
                    ]);
                }
                const unknownKeys = Object.keys(toggleBody).filter((k) => k !== 'enabled');
                if (unknownKeys.length > 0) {
                    throw validationFailure(
                        `Unknown key${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map((k) => `\`${k}\``).join(', ')} — the toggle body is { enabled?: boolean }`,
                        // `unknown_field` — the ADR-0114 catalog member for "a
                        // key the target does not declare"; this entry used to
                        // hand-spell Zod's `unrecognized_keys`, a code outside
                        // the closed catalog (#8124).
                        unknownKeys.map((k) => ({ field: k, code: 'unknown_field', message: 'not a toggle field — did you mean `enabled`?' })),
                    );
                }
                if ('enabled' in toggleBody && typeof (toggleBody as Record<string, unknown>).enabled !== 'boolean') {
                    throw validationFailure('`enabled` must be a boolean (JSON true/false, not a string)', [
                        { field: 'enabled', code: 'invalid_type', message: 'expected a boolean' },
                    ]);
                }
                const enabled = (toggleBody as { enabled?: boolean }).enabled ?? true;
                // [#7535] The unknown-FLOW arm, brought up to the standard the
                // body arm above already meets. `toggleFlow` on a name the
                // registry does not hold throws a plain `Error` ("Flow '<name>'
                // not found", service-automation's engine) carrying no
                // `.status`, so both dispatcher catches fell back to **500
                // INTERNAL_ERROR** for what is purely a caller mistake. That
                // tells every client the opposite of the truth: 5xx reads as
                // "the server broke, retry", so a typo'd flow name had
                // retry-on-5xx callers hammering a request that can never
                // succeed. 404 says "your request was wrong" — and names which
                // flow was wrong, the way the body rejection names the key.
                //
                // Answered HERE rather than by teaching a generic catch to
                // recognise that message: which HTTP status a plain domain
                // error means is the serving boundary's decision (see
                // ../validation-failure.ts), and this is the SAME existence
                // probe `GET /:name` uses below, so the two routes cannot
                // disagree about which flows exist.
                //
                // Deliberately AFTER the body checks: a malformed body is still
                // refused without the registry being consulted at all, so
                // #3899's "nothing reaches the service until the body is legal"
                // holds unchanged.
                //
                // `getFlow` is optional on `IAutomationService`; an
                // implementation that omits it cannot be asked whether the flow
                // exists, so the toggle proceeds as before rather than this
                // inventing an answer.
                if (typeof automationService.getFlow === 'function') {
                    const existing = await automationService.getFlow(name);
                    if (!existing) {
                        return { handled: true, response: deps.error(`Flow '${name}' not found`, 404) };
                    }
                }
                await automationService.toggleFlow(name, enabled);
                return { handled: true, response: deps.success({ name, enabled }) };
            }
        }

        // POST /:name/clone → clone the whole definition under a new machine
        // name (ADR-0126 §7.1). The copy itself, the fields it mutates, the
        // keys it must not carry forward and the notice it returns all live in
        // `../flow-clone.ts` — see that module's header for the ADR and for
        // #11703, the measurement that decides the copy's SHAPE.
        //
        // Built out of `getFlow` + `registerFlow`, not a new contract method:
        // `IAutomationService` lives in `packages/spec`, and this door needs
        // nothing the contract does not already offer. The clone therefore goes
        // through the engine's own registration path, so it is canonicalized
        // and validated exactly as a create is (`registerFlow` →
        // `canonicalizeStoredFlow` + `validateNodeConfigKeys` +
        // `validateFlowExpressions`) rather than by a second policy that agrees
        // with the first only until one of them moves.
        if (parts[1] === 'clone' && m === 'POST') {
            if (typeof automationService.registerFlow === 'function' && typeof automationService.getFlow === 'function') {
                // BODY FIRST, registry second — #3899's guarantee on this
                // domain is that nothing reaches the service until the body is
                // legal, and the toggle arm above keeps it the same way.
                const cloneBody = body ?? {};
                if (typeof cloneBody !== 'object' || Array.isArray(cloneBody)) {
                    throw validationFailure('Invalid clone body — expected { name: string, label: string }', [
                        { field: '(body)', code: 'invalid_type', message: 'expected an object' },
                    ]);
                }
                const unknownKeys = Object.keys(cloneBody).filter((k) => k !== 'name' && k !== 'label');
                if (unknownKeys.length > 0) {
                    throw validationFailure(
                        `Unknown key${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map((k) => `\`${k}\``).join(', ')} — the clone body is { name: string, label: string }`,
                        // `unknown_field` — the ADR-0114 catalog member for "a
                        // key the target does not declare" (#8124).
                        unknownKeys.map((k) => ({ field: k, code: 'unknown_field', message: 'not a clone field — the clone body is { name, label }' })),
                    );
                }
                // The NEW MACHINE NAME IS MANDATORY (ADR-0126 §7.1, the #11513
                // shape exactly). Refused here rather than defaulted, because
                // every default a clone could pick is either the source's own
                // name — the same-name clone the ADR bans outright — or a name
                // this door invented on the admin's behalf and would then have
                // to keep inventing consistently forever.
                const targetName = (cloneBody as { name?: unknown }).name;
                if (typeof targetName !== 'string' || targetName.trim() === '') {
                    throw validationFailure(
                        'A clone requires a new machine name — `name` is mandatory (ADR-0126 §7.1). '
                        + 'The clone is a sibling flow, not a revision of the one it was copied from.',
                        [{ field: 'name', code: targetName === undefined ? 'required' : 'invalid_type', message: 'expected a non-empty string' }],
                    );
                }
                // `label` is mandatory too, mirroring the permission-set clone
                // this action is shaped on (`sys-permission-set.object.ts`:
                // both `label` and `name` are `required: true`). ADR-0126 §7.1
                // lists `label` among the three fields a clone mutates, and a
                // clone that silently kept the source's display name would put
                // two identically-labelled flows on the packaged-automation
                // page (§7.4) with nothing to tell them apart.
                const targetLabel = (cloneBody as { label?: unknown }).label;
                if (typeof targetLabel !== 'string' || targetLabel.trim() === '') {
                    throw validationFailure(
                        'A clone requires a new display name — `label` is mandatory. '
                        + 'Two flows sharing one label are indistinguishable on the automation surface.',
                        [{ field: 'label', code: targetLabel === undefined ? 'required' : 'invalid_type', message: 'expected a non-empty string' }],
                    );
                }

                // The SOURCE must exist — the same existence probe `GET /:name`
                // and the toggle arm use, so the three routes cannot disagree
                // about which flows exist. 404, not 500: a typo'd source name
                // is a caller mistake (#7535).
                const source = await automationService.getFlow(name);
                if (!source) {
                    return { handled: true, response: deps.error(flowNotFoundMessage(name), FLOW_NOT_FOUND_STATUS) };
                }

                // ⛔ SAME-NAME REFUSAL, loudly, naming the sanctioned path.
                // Checked against the same probe, so "already exists" means the
                // same thing here as everywhere else on this domain. This also
                // catches `name === <source>`, which is the case the ADR is
                // actually about — see `flowCloneNameTakenMessage` for why a
                // second definition under one bare name is a silent,
                // order-dependent shadow rather than a storage error.
                const collision = await automationService.getFlow(targetName);
                if (collision) {
                    return {
                        handled: true,
                        response: deps.error(flowCloneNameTakenMessage(targetName), FLOW_CLONE_NAME_TAKEN_STATUS),
                    };
                }

                const clone = cloneFlowDefinition(source, { name: targetName, label: targetLabel });
                // Engine verdicts are answered as a 400, not rethrown — the
                // create arm's reasoning (`flowDefinitionRefusal`) applies
                // verbatim, and it matters more here: a clone that the engine
                // refuses must not leave a half-registered flow behind, and it
                // must not read as a server fault when the source definition is
                // simply one this deployment can no longer register.
                try {
                    automationService.registerFlow(targetName, clone);
                } catch (e) {
                    return {
                        handled: true,
                        response: deps.errorFromThrown(flowDefinitionRefusal(e), VALIDATION_FAILED_STATUS),
                    };
                }
                // ⛔ NO ANCESTRY on the way out either (ADR-0126 amendment
                // ruling 2, §9): the response names the flow that was created
                // and says nothing about what it was copied from. There is no
                // `clonedFrom` key here on purpose — a response field is the
                // cheapest place for ancestry to reappear, and a UI that reads
                // one starts displaying a lineage the platform has ruled it
                // does not track.
                return { handled: true, response: deps.success({ flow: clone, notice: FLOW_CLONE_NOTICE }) };
            }
        }

        // POST /:name/runs/:runId/resume → resume a paused run (screen-flow
        // runtime / ADR-0019). Body `{ inputs }` = a screen node's collected
        // values, applied as bare flow variables; `output`/`branchLabel` also
        // forwarded for approval-style resumes. The outer envelope is a CLOSED
        // set — exactly the four keys below — and an unknown top-level key is
        // refused (#8796); since #9416 so is an accepted key carrying a value
        // of the wrong TYPE, and a body that is not a JSON object at all.
        // Returns the next paused `{ screen }` (multi-screen) or the completed
        // result.
        //
        // The signal is built key-by-key from the JSON body on purpose (#3801):
        // the engine gates a suspension whose node declares
        // `resumeAuthority: 'service'` — an `approval` pause, resumable only via
        // `ApprovalService`, which records the decision and enforces the slate —
        // on a SYMBOL-keyed marker. Assembling the signal field-wise (never
        // spreading the body) keeps that unforgeable even if a caller invents
        // extra keys. Since #5561 a node type that declares NO `resumeAuthority`
        // is gated the same way, so this door is one a descriptor opts into with
        // `'any'` rather than one every pausing node inherits.
        //
        // REFUSAL codes come back from the engine and are answered as such
        // rather than a 200 carrying `success: false` (which reads as "your
        // resume ran and the flow failed"):
        //   PERMISSION_DENIED  → 403, the suspension is service-owned (#3801)
        //   INVALID_SIGNAL     → 400, the signal wrote the engine's `$` variable
        //                        namespace (#3853 follow-up)
        //   INVALID_SCREEN_INPUT → 400, the bag violates the suspended screen's
        //                        declared field contract — a required field the
        //                        caller was asked for is missing, or an
        //                        undeclared key was sent (#4477)
        //   RUN_NOT_FOUND      → 404, no such suspension — unresumable for good.
        //                        Since #8684 the engine also reports the two
        //                        STALE-suspension exits under this code (the flow
        //                        deregistered, the suspended node edited away):
        //                        same terminal class, same remedy, and the
        //                        engine's message names which one it was
        //   STORE_UNAVAILABLE  → 503, the durable store is unreadable, so
        //                        existence is unknown; the same call is expected
        //                        to work once it recovers (#4420)
        //   RESUME_IN_PROGRESS → 409, a concurrent resume already has this run
        // A result with NO code and `success: false` consumed its pause and
        // ran: 400 `FLOW_FAILED` (#8684), whose details carry the engine's
        // own verdict since #15221 — `status: 'stranded'` + `repairable`
        // (`resumeFailureDetails` above) — beside `errorMessage` / `summary`.
        // All are enforced in the ENGINE, at the one place a signal reaches the
        // variable map — deliberately not re-implemented here. Guarding a field
        // at a time in the transport is what let `output` reopen the hole
        // `inputs` had just closed; every transport now inherits one rule.
        if (parts[1] === 'runs' && parts[2] && parts[3] === 'resume' && m === 'POST') {
            if (typeof automationService.resume === 'function') {
                // [#9416] The BODY ITSELF must be a JSON object before its
                // keys mean anything. This read used to normalise anything
                // else to `{}` — a JSON string/number/boolean body, and an
                // EMPTY array (a non-empty one was caught by the key check
                // below, because its indices read as unknown keys) — so those
                // reached the engine as an empty signal and answered 200
                // `success:true` with the submission treated as EMPTY: the
                // #8796 failure shape, reached without misspelling anything.
                // `undefined` / `null` stay the legal bodyless resume (an
                // empty submission is legal — a screen whose declared fields
                // are all optional), which is why the normalisation survives
                // for exactly those two.
                const rawBody = body ?? {};
                const RESUME_BODY_KEYS = ['inputs', 'variables', 'output', 'branchLabel'];
                const accepted = RESUME_BODY_KEYS.map((k) => `\`${k}\``).join(', ');
                /**
                 * How the offending value is NAMED back to the caller. Local to
                 * this arm on purpose: it exists to make one refusal message
                 * readable, not to become a shared formatter for a vocabulary
                 * nobody has ruled on.
                 */
                const jsonTypeOf = (v: unknown): string =>
                    v === null ? 'null' : Array.isArray(v) ? 'an array' : `a ${typeof v}`;
                if (typeof rawBody !== 'object' || Array.isArray(rawBody)) {
                    throw validationFailure(
                        `Invalid resume body — expected an object with ${accepted}, received ${jsonTypeOf(rawBody)}`,
                        [{ field: '(body)', code: 'invalid_type', message: `expected an object with ${accepted}` }],
                    );
                }
                const b = rawBody as Record<string, unknown>;
                // [#8796] The outer envelope is a CLOSED SET (maintainer ruling
                // 2026-08-15, Option A): an unknown top-level key is refused,
                // located, naming the offending key(s) AND the accepted set —
                // the closed-parameter-set policy (Route & surface ownership
                // rule 5) applied to a request body, and the declared=enforced
                // treatment #4477 gave the INNER bag, one level up. Until now
                // the assembly below read the keys it knows and silently
                // dropped the rest, so `{"nodeId":"ask","values":{…}}` — no
                // key of which this route reads — was answered 200
                // `success:true` with the submission treated as EMPTY: the run
                // completed and the submitted value never reached the flow. A
                // caller that guesses `values` instead of `inputs` now gets a
                // correction at authoring time instead of silence.
                //
                // The refusal WRAPS #3801's field-by-field signal assembly, it
                // never replaces it with a body spread — the service-authority
                // marker stays unforgeable exactly as before.
                //
                // Deliberately BEFORE the `resume()` call: nothing reaches the
                // engine until the body is legal (#3899, the same ordering the
                // toggle arm above enforces), so this refusal composes AHEAD
                // of every engine verdict — a body that is both malformed and
                // unauthorized answers the envelope 400 and the suspension is
                // never consulted, let alone consumed.
                //
                // Thrown as the duck-typed validation failure both dispatcher
                // error exits map to 400 `VALIDATION_FAILED` + `fields[]`
                // (#3918) — the same wire shape the toggle arm's closed set
                // answers. NOT `FLOW_FAILED` (#8684, a few lines down): the
                // console treats 400 `FLOW_FAILED` as terminal (the engine
                // consumed the suspension and ran — objectui PR #4899), while
                // this refusal leaves the suspension intact and the caller can
                // retry with a corrected body. It sits with `INVALID_SIGNAL` /
                // `INVALID_SCREEN_INPUT` on the retryable side.
                const unknownKeys = Object.keys(b).filter((k) => !RESUME_BODY_KEYS.includes(k));
                if (unknownKeys.length > 0) {
                    throw validationFailure(
                        `Unknown key${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map((k) => `\`${k}\``).join(', ')} — the resume body accepts ${accepted}`,
                        unknownKeys.map((k) => ({
                            field: k,
                            code: 'unknown_field',
                            message: `not a resume body key — the resume body accepts ${accepted}`,
                        })),
                    );
                }
                // [#9416] VALUE SHAPES — the same silent-drop family as #8796,
                // one axis over: a key that IS accepted, carrying a value the
                // engine contract excludes. The assembly below used to
                // type-guard each key and skip what failed the guard, so
                // `{"inputs":"a string"}` / `{"output":42}` /
                // `{"branchLabel":7}` passed the closed KEY set, lost their
                // value, and answered 200 `success:true` on an EMPTY
                // submission — the caller told its screen input landed when
                // nothing did. Ruled Option A (maintainer, on this card): 400,
                // located, naming the key and the expected type, inheriting
                // #8796's ruling together with its reason plus #3899's toggle
                // arm (a truthy non-boolean `enabled` is refused there, never
                // coerced or dropped).
                //
                // ⛔ NOT Option B (forward the raw value, let the engine
                // judge): `ResumeSignal` types `variables`/`output` as
                // `Record<string, unknown>` and `branchLabel` as `string`, so
                // forwarding hands a service a shape its own contract excludes
                // — an array included, which the old `typeof === 'object'`
                // guard passed through.
                //
                // A key whose value is `undefined` counts as ABSENT rather than
                // mis-shaped, deliberately: `JSON.stringify` drops such a key,
                // so no HTTP caller can produce one, and the in-process
                // spelling `{ inputs: maybeUndefined }` means "no inputs". An
                // explicit `null` IS refused — JSON can express it, and it is
                // the value that used to be dropped most quietly of all.
                //
                // Ordering: after the unknown-key refusal, so a body that is
                // both misspelled and mis-shaped still reports the misspelling
                // #8796 pinned; before `resume()`, so nothing reaches the
                // engine until the body is legal and the suspension stays
                // intact for a corrected retry.
                const valueFailures: Array<{ field: string; code: 'invalid_type'; message: string }> = [];
                for (const key of ['inputs', 'variables', 'output']) {
                    const v = b[key];
                    if (v === undefined) continue;
                    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
                        valueFailures.push({
                            field: key,
                            code: 'invalid_type',
                            message: `expected an object (a map of names to values), received ${jsonTypeOf(v)}`,
                        });
                    }
                }
                if (b.branchLabel !== undefined && typeof b.branchLabel !== 'string') {
                    valueFailures.push({
                        field: 'branchLabel',
                        code: 'invalid_type',
                        message: `expected a string (the out-edge label to follow), received ${jsonTypeOf(b.branchLabel)}`,
                    });
                }
                if (valueFailures.length > 0) {
                    throw validationFailure(
                        `Invalid resume body — ${valueFailures.map((f) => `\`${f.field}\` ${f.message}`).join('; ')}`,
                        valueFailures,
                    );
                }
                // #3801's field-by-field assembly, unchanged in substance: the
                // body is never spread, so the symbol-keyed service-authority
                // marker stays unforgeable. Every surviving value is now known
                // to match the contract, so presence is the only test left.
                const inputs = (b.inputs ?? b.variables);
                const signal: any = {};
                if (inputs !== undefined) signal.variables = inputs;
                if (b.output !== undefined) signal.output = b.output;
                if (b.branchLabel !== undefined) signal.branchLabel = b.branchLabel;
                const result = await automationService.resume(parts[2], signal);
                if (result?.success === false && result.code === 'PERMISSION_DENIED') {
                    return { handled: true, response: deps.error(result.error ?? 'Resume forbidden', 403) };
                }
                if (result?.success === false && result.code === 'INVALID_SIGNAL') {
                    return { handled: true, response: deps.error(result.error ?? 'Invalid resume signal', 400) };
                }
                if (result?.success === false && result.code === 'INVALID_SCREEN_INPUT') {
                    return { handled: true, response: deps.error(result.error ?? 'Invalid screen input', 400) };
                }
                if (result?.success === false && result.code === 'RUN_NOT_FOUND') {
                    return { handled: true, response: deps.error(result.error ?? 'No such suspended run', 404) };
                }
                if (result?.success === false && result.code === 'STORE_UNAVAILABLE') {
                    return { handled: true, response: deps.error(result.error ?? 'Suspended-run store unavailable', 503) };
                }
                if (result?.success === false && result.code === 'RESUME_IN_PROGRESS') {
                    return { handled: true, response: deps.error(result.error ?? 'Run is already being resumed', 409) };
                }
                // [#8684] TERMINAL RUN FAILURE → 400 `FLOW_FAILED`, inheriting
                // #3962's ruling for `/actions` (maintainer, 2026-08-15): a
                // business failure must not ride HTTP 200 inside a double
                // envelope. It did here until now — `{success:true,data:{success:
                // false,error:"Node 'x' failed: …"}}` — so a scripted or
                // integration caller that branches on the HTTP status alone read
                // a failed run as a successful one.
                //
                // Every arm above is a REFUSAL that left the suspension intact
                // and can be retried; what reaches HERE consumed its pause and
                // ran. Two engine exits produce it — the flow itself failed, or a
                // subflow child failed terminally — and both are the "ran and was
                // rejected" row, hence 400. The two NEVER-DISPATCHED exits are
                // answered 404 by the `RUN_NOT_FOUND` arm above because the
                // ENGINE classifies them (#8684, producer-first): this route
                // never sniffs the result for `summary`/`durationMs` to tell the
                // two classes apart, which is the tolerant-consumer shape PD #12
                // forbids.
                //
                // `FLOW_FAILED` is the code `/actions` already answers for a flow
                // that ran and rejected (`../action-execution.ts`), and the
                // ADR-0112 ledger registers it to `@objectstack/runtime` — this
                // door, not the engine's, is where the wire vocabulary is named.
                //
                // ⚠️ `errorMessage` is the flow AUTHOR's own failure text
                // (`flow.errorMessage`, engine `resumeInternal`) and it travels in
                // `details`, which is the one place the console reads it from
                // (objectui `flowResponse.ts` / PR #4899 — no alias chain). The
                // ADR-0112 envelope carries no `data`, so a producer that builds
                // its message out of `result.error` alone drops the author's words
                // silently; `/actions`'s producer does exactly that, and this
                // deliberately does not copy it. `summary` rides along for the
                // same reason it was on the 200 body: a failed run's per-node
                // accounting is how a caller finds WHICH node failed.
                //
                // [#15221] And the engine's VERDICT rides with them. Of the
                // two exits above, only the flow-itself-failed one can be
                // `status: 'stranded'` (#14384 / #13937: the pause a durable
                // decision was waiting on is gone and an operator verb can
                // re-arm the run) — and until now this arm copied
                // `errorMessage` and `summary` off the result and dropped
                // `status`, so `'stranded'` could not reach the wire through
                // any door and an HTTP-only caller read "beyond reach" and
                // "repair waiting" as one and the same 400. The #16472
                // ruling (option A) carries it here, in the details of the
                // EXISTING code: `runId`, `status` (verbatim, when stamped)
                // and `repairable` (`status === 'stranded'`, always present —
                // false on the plain terminal exit, deliberately, see
                // `resumeFailureDetails`), declared once as
                // `ResumeFailureDetailsSchema` in `@objectstack/spec/api`.
                // ⛔ No `FLOW_STRANDED` sibling code: the console treats
                // `400 FLOW_FAILED` as terminal (#8684) and a client that
                // wants to branch reads `details.repairable`, never a regex
                // over the message.
                if (result?.success === false) {
                    return {
                        handled: true,
                        response: deps.error(result.error ?? 'Flow run failed', 400, {
                            code: 'FLOW_FAILED',
                            ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
                            ...(result.summary !== undefined ? { summary: result.summary } : {}),
                            ...resumeFailureDetails(parts[2], result),
                        }),
                    };
                }
                return { handled: true, response: deps.success(result) };
            }
            return { handled: true, response: deps.error('Resume not supported', 501) };
        }

        // POST /:name/runs/:runId/cancel → cancel a suspended run (ADR-0044).
        //
        // [#13953] The FIRST of the two operator run-lifecycle doors the
        // maintainer ruled (2026-09-05, option A). Both verbs existed on the
        // engine with no way for an operator to reach them: no REST route, no
        // CLI command, and — until #16563 — not on `IAutomationService` either.
        //
        // ⚑ Gated ABOVE, on the platform-operator rung and nothing else
        // (`refuseUngrantedRunLifecycleWrite`). The arm repeats the same
        // `isRunLifecycleWrite` predicate the gate fired on, `parts[0] !==
        // 'trigger'` included, so route and gate cannot drift.
        //
        // Body: the closed `{ reason? }` envelope. `reason` is the operator's
        // own words and is relayed VERBATIM — the engine lands it on the
        // terminal `cancelled` log's `error`, and the contract calls it "why,
        // in the operator's words", so this door does not decorate it with the
        // caller's identity or anything else. ⚠️ Stated rather than hidden:
        // `cancelRun` has no `requestedBy` slot (the repair verb does), so what
        // the terminal record carries about WHO cancelled is whatever the
        // operator wrote. Inventing a slot for it here would be a second name
        // for a contract parameter that does not exist.
        //
        // ⛔ NO ONCE-ONLY SIDE EFFECT IS KEYED OFF THE RETURN VALUE, and that
        // is a ruling this arm implements rather than a habit. The engine has
        // no cancel-side compare-and-set: `cancelRun` does a
        // `loadSuspendedRunStrict` then an unconditional delete-by-id, and only
        // `resume` passes the `claimAdvance` compare-and-set through
        // `forgetSuspendedRun`. So two cancels of one run overlapping in time
        // each read the row, each delete, each record the terminal log, and
        // EACH RETURN `true` — the contract now says so in terms ("a caller may
        // not read `true` as sole authorship, nor use it as an idempotency
        // token for a once-only side effect"). Whether the engine should grow
        // the CAS is open and deliberately not decided here (#13953 dispatch
        // ruling ①: an independent behaviour change that would also force
        // rewriting the contract sentence #16563 just landed). ⇒ This arm
        // calls the verb and answers; it fires no notification, writes no audit
        // entry and announces no kernel event. A door that did any of those on
        // `true` would fire them twice. Pinned in
        // `automation-run-lifecycle-door.test.ts`.
        //
        // The answer is a 200 either way, because `false` is idempotent success
        // per the contract — but it is NEVER a bare success. ⚠️ `false` is
        // TWO conditions the caller cannot tell apart: "no suspended run under
        // this id" (already terminal, or unknown) and "the durable store could
        // not be READ, so the run may still be parked". Nothing above the
        // engine can distinguish them — the engine reports the second at
        // `error` for exactly that reason — so the door SAYS SO in the
        // response rather than letting `cancelled: false` read as a clean
        // no-op. #13909's posture, applied to the one verb that can hide a
        // condition inside a success: ⛔ never a door that returns success
        // while hiding the condition.
        if (isRunLifecycleWrite(parts, m) && parts[3] === RUN_CANCEL_SEGMENT) {
            if (typeof automationService.cancelRun !== 'function') {
                return { handled: true, response: deps.error(RUN_CANCEL_UNSUPPORTED_MESSAGE, 501) };
            }
            const bodyRefusal = refuseInvalidRunLifecycleBody(deps, body, 'cancel');
            if (bodyRefusal) return bodyRefusal;
            const reason = (body as { reason?: string } | undefined | null)?.reason;
            const cancelled = await automationService.cancelRun(parts[2], reason);
            return {
                handled: true,
                response: deps.success({
                    runId: parts[2],
                    cancelled,
                    notice: cancelled ? RUN_CANCEL_TRUE_NOTICE : RUN_CANCEL_FALSE_NOTICE,
                }),
            };
        }

        // POST /:name/runs/:runId/restore-suspension → put back the suspension
        // a failed resume consumed (#13909).
        //
        // [#13953] The SECOND operator door. This is the verb that re-arms a
        // run the platform recorded as TERMINALLY FAILED, which is why the card
        // says "who may do this" is a real question and not the same answer as
        // "who may resume" — see the gate above for the answer and why it is
        // required unconditionally.
        //
        // ⭐ `requestedBy` comes from the AUTHENTICATED CALLER, never from the
        // body. The implementation's trace records who asked and why (and
        // writes `not recorded` when `requestedBy` is absent), and that record
        // is the whole reason the optional parameters are on the signature
        // rather than the ruling's `restoreConsumedSuspension(runId)`
        // shorthand. A wire-settable `requestedBy` would let one operator write
        // another's name into it; the body validator refuses the key by name so
        // a caller who tries gets a loud refusal rather than the silent
        // impression that it took.
        //
        // The result is NOT an `AutomationResult` — it is the narrower
        // structural type the contract declares, and `refusal` on it is
        // `string`, a covariant widening of the engine's closed eight-member
        // union. `restoreRefusalStatus` above is therefore a NON-EXHAUSTIVE
        // switch by construction and answers fail-closed (500) for anything it
        // does not recognise, including a `restored: false` carrying no code at
        // all. ⛔ The vocabulary is not narrowed or extended here — closing it
        // is a spec card.
        //
        // Refusals are answered as refusals (4xx/5xx), never as a 200 carrying
        // `restored: false`, which would read as "your repair ran and the run
        // did not come back". The engine's own one-sentence `reason` is
        // relayed as the message — it is what tells "this run is fine" from
        // "this run is beyond this verb" from "I could not read the store" —
        // and the code itself rides `details.refusal` rather than
        // `details.code`, so `error.code` stays inside the ADR-0112 closed
        // catalog (derived from the status) instead of minting eight
        // unregistered members at a call site.
        if (isRunLifecycleWrite(parts, m) && parts[3] === RUN_RESTORE_SEGMENT) {
            if (typeof automationService.restoreConsumedSuspension !== 'function') {
                return { handled: true, response: deps.error(RUN_RESTORE_UNSUPPORTED_MESSAGE, 501) };
            }
            const bodyRefusal = refuseInvalidRunLifecycleBody(deps, body, 'restore-suspension');
            if (bodyRefusal) return bodyRefusal;
            const reason = (body as { reason?: string } | undefined | null)?.reason;
            const requestedBy = (context as any)?.executionContext?.userId;
            const result = await automationService.restoreConsumedSuspension(parts[2], {
                ...(typeof requestedBy === 'string' && requestedBy ? { requestedBy } : {}),
                ...(reason !== undefined ? { reason } : {}),
            });
            if (result?.restored === true) {
                // The runId answered is the one this door was ASKED about (the
                // path's `:runId`), for the reason `resumeFailureDetails`
                // documents for its own: it is what the door knows, and
                // echoing a service's own copy of it would relay a
                // disagreement instead of reporting one.
                return {
                    handled: true,
                    response: deps.success({ runId: parts[2], restored: true, reason: result.reason }),
                };
            }
            const status = restoreRefusalStatus(result?.refusal);
            const message = typeof result?.reason === 'string' && result.reason
                ? result.reason
                : RUN_RESTORE_UNCLASSIFIED_MESSAGE;
            return {
                handled: true,
                response: deps.error(message, status, {
                    runId: parts[2],
                    restored: false,
                    // The implementation's own code, relayed for an operator to
                    // act on. ⛔ Deliberately NOT `details.code`: that key is
                    // PROMOTED into `error.code`, which ADR-0112 closes to
                    // `StandardErrorCode` ∪ the registered ledger, and none of
                    // the engine's eight are members. `error.code` is derived
                    // from the status instead.
                    ...(typeof result?.refusal === 'string' ? { refusal: result.refusal } : {}),
                }),
            };
        }

        // GET /:name/runs/:runId/screen → the screen a paused run awaits
        // (refresh-safe re-fetch for the UI flow-runner).
        //
        // [#7968] GATED — the run's own trigger identity, OR the
        // `sys_automation_run` read grant as an operator override. The audit
        // that #7900 left here recorded, correctly, that the grant ALONE is the
        // wrong gate for this route (it would refuse the end user the flow
        // paused for) — and left the door authenticated-only as a result. The
        // residual it named was measured and is real: a `ScreenSpec` carries
        // `defaults` / `defaultValue` interpolated against the live flow
        // variables (`builtin/screen-nodes.ts`), so a real screen flow over
        // `{record.email}` / `{record.phone}` answered those values to ANY
        // authenticated caller who knew a run id. The ruling of 2026-08-12
        // closes it on the identity axis instead, keeping the end user in.
        // Reasoning, the ordering, and what stays out of scope (Option A, the
        // per-run `resumeAuthority` read gate): `refuseUnrelatedScreenRead`.
        if (parts[1] === 'runs' && parts[2] && parts[3] === 'screen' && m === 'GET') {
            if (typeof automationService.getSuspendedScreen === 'function') {
                const screen = await automationService.getSuspendedScreen(parts[2]);
                // Deliberately AHEAD of the gate: no screen ⇒ nothing to
                // disclose ⇒ every not-found answer stays exactly what it was,
                // for every caller. See the gate's "order of operations".
                if (!screen) return { handled: true, response: deps.error('No pending screen for run', 404) };
                const refusal = await refuseUnrelatedScreenRead(deps, context, automationService, parts[2]);
                if (refusal) return refusal;
                return { handled: true, response: deps.success({ runId: parts[2], screen }) };
            }
            return { handled: true, response: deps.error('Screen lookup not supported', 501) };
        }

        // GET /:name/runs/:runId → getRun
        if (parts[1] === 'runs' && parts[2] && !parts[3] && m === 'GET') {
            if (typeof automationService.getRun === 'function') {
                const run = await automationService.getRun(parts[2]);
                if (!run) return { handled: true, response: deps.error('Execution not found', 404) };
                return { handled: true, response: deps.success(run) };
            }
        }

        // GET /:name/runs → listRuns
        if (parts[1] === 'runs' && !parts[2] && m === 'GET') {
            if (typeof automationService.listRuns === 'function') {
                // [#7300] Both options are CHECKED at the point they are read,
                // in the shared query-parameter refusal this route now consumes
                // with `/notifications` (#6928 / PR #7299 — the same defect, one
                // file over). What used to stand here was
                // `{ limit: query.limit ? Number(query.limit) : undefined,
                //    cursor: query.cursor }`:
                //
                //  - `?limit=abc` coerced to `NaN`, which no guard downstream
                //    catches — `AutomationEngine.listRuns` computes
                //    `options?.limit ?? 20` (`??` does not catch NaN), hands NaN
                //    to `store.listHistory(flowName, NaN)`, and ends on
                //    `.slice(0, NaN)`, which is `[]`. The caller was told "this
                //    flow has no runs", with a 200, for a typo in the window.
                //  - `cursor` was forwarded raw into a slot the contract types
                //    `cursor?: string` (`IAutomationService.listRuns`), so a
                //    repeated `?cursor=a&cursor=b` handed an ARRAY to a service
                //    that declared it would receive a string. Today's engine
                //    ignores the option entirely, which is exactly why this is
                //    worth closing at the boundary rather than downstream: the
                //    first implementation that starts honouring cursors must not
                //    be the one that discovers the type was never enforced.
                //
                // [#8054] `limit`'s RANGE — `ListRunsRequestSchema` has always
                // declared `.min(1).max(100)`, and until now this gate only
                // checked that the value was a whole number at all, never that
                // it fell inside that declared range. `?limit=0` reached the
                // engine as 0, and `store.listHistory(flowName, 0).slice(0, 0)`
                // is `[]` — a confidently wrong "this flow has never run",
                // exactly #7300's shape but from a value that WAS a valid
                // integer. `?limit=101` reached the engine uncapped, so the
                // declared upper bound was decorative.
                //
                // The bounds are READ off `ListRunsRequestSchema.shape.limit`
                // rather than re-listed as `(1, 100)` here — the same
                // discipline `status` already applies via
                // `ExecutionStatus.options` two lines down. Re-listing the
                // literals would make the boundary correct today and silently
                // wrong again the moment the schema's own `.min()`/`.max()`
                // changes; reading them makes declared == enforced true by
                // construction, not by two call sites happening to agree.
                //
                // A value outside the range is refused in the same house shape
                // as everything else in this module — `VALIDATION_FAILED` with
                // an ADR-0114 field code, here `min_value` / `max_value`, the
                // ones the property names already mirror.
                //
                // [#7359] `status` is the THIRD declared parameter, and until
                // now the only one this handler never read. `ListRunsRequestSchema`
                // declares it as `ExecutionStatus.optional()` — the enum itself
                // rather than a copy of its members — so what the wire bounds
                // the filter to is read from that vocabulary rather than
                // restated here. It has NOT always been spelled that way: from
                // the schema's introduction until #7359 that line was an inline
                // `z.enum([...]).optional()` copy of eight members, and #7359
                // replaced the copy with the enum in the same change that made
                // this boundary read the parameter. But `status` had no slot on
                // `IAutomationService.listRuns` and was never built into this
                // object, so `?status=failed` was dropped here, silently, and
                // the caller was answered 200 with EVERY run of the flow capped
                // by `limit`. That is worse than an empty page: a monitoring
                // caller paging for failures reads the first 20 runs of any
                // status and concludes those are the failures. #7300
                // deliberately left the key ignored rather than decide between
                // honouring and retiring it; this card takes the enforce route
                // (ADR-0049), so the declared surface is true.
                //
                // The members come from the spec's own `ExecutionStatus` enum
                // rather than a list copied into this file: the wire schema is
                // built from that same enum, so a future member cannot be
                // accepted by one and refused by the other.
                const limitBounds = ListRunsRequestSchema.shape.limit.unwrap();
                const options = query
                    ? {
                        limit: parseIntegerParam('limit', query.limit, {
                            min: limitBounds.minValue ?? undefined,
                            max: limitBounds.maxValue ?? undefined,
                        }),
                        cursor: parseStringParam('cursor', query.cursor),
                        status: parseEnumParam('status', query.status, ExecutionStatus.options),
                    }
                    : undefined;
                const runs = await automationService.listRuns(name, options);
                return { handled: true, response: deps.success({ runs, hasMore: false }) };
            }
        }

        // GET /:name → getFlow (no sub-path)
        if (parts.length === 1 && m === 'GET') {
            if (typeof automationService.getFlow === 'function') {
                const flow = await automationService.getFlow(name);
                if (!flow) return { handled: true, response: deps.error('Flow not found', 404) };
                return { handled: true, response: deps.success(flow) };
            }
        }

        // PUT /:name → updateFlow
        if (parts.length === 1 && m === 'PUT') {
            if (typeof automationService.registerFlow === 'function') {
                // [#3899] Same class as POST /: an unchecked body stored
                // whatever arrived as the flow definition. The name rides the
                // path here, so only the definition's shape needs guarding.
                // (`body.definition ?? body` is a pre-existing two-dialect
                // unwrap — kept as-is, not a new alias.)
                const definition = (body && typeof body === 'object' && !Array.isArray(body))
                    ? ((body as { definition?: unknown }).definition ?? body)
                    : undefined;
                if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
                    throw validationFailure('Flow definition body required', [
                        { field: '(body)', code: 'invalid_type', message: 'expected a flow definition object' },
                    ]);
                }
                // [#8123] Same class as POST /: the engine's verdict on the
                // definition is served as a 400, not a 500 — reusing the
                // same route-agnostic `flowDefinitionRefusal` helper POST
                // uses above, so the two doors cannot disagree about the
                // class of an identical refusal (#8055 wired POST only).
                // [#12206, Option A] Same as the POST door above: answer the
                // canonicalized parsed flow the engine stored, not the
                // caller's echo. This also closes the old PUT quirk where the
                // echoed `definition` could lack `name` (the name rode the
                // path) — the parsed flow always carries it.
                let registered;
                try {
                    registered = automationService.registerFlow(name, definition);
                } catch (e) {
                    return {
                        handled: true,
                        response: deps.errorFromThrown(flowDefinitionRefusal(e), VALIDATION_FAILED_STATUS),
                    };
                }
                return { handled: true, response: deps.success(registered) };
            }
        }

        // DELETE /:name → deleteFlow
        if (parts.length === 1 && m === 'DELETE') {
            if (typeof automationService.unregisterFlow === 'function') {
                automationService.unregisterFlow(name);
                return { handled: true, response: deps.success({ name, deleted: true }) };
            }
        }
    }
    
    return { handled: false };
}
