// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/automation` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-6). Bridges to the `automation` service (flow CRUD, trigger/execute,
 * runs history, pause/resume — ADR-0018/0019/0022 surfaces). Route-order
 * subtlety preserved verbatim: `/actions`, `/connectors` and `/_status`
 * MUST precede the `/:name → getFlow` catch-all, or a flow literally named
 * "actions"/"connectors" would shadow them.
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import { CoreServiceName } from '@objectstack/spec/system';
import type { IAutomationService, ISecurityService } from '@objectstack/spec/contracts';
import { isServiceServeable } from '../service-serveable.js';
import {
    validationFailure, validationFailureDetails, fieldsFromZodIssues, VALIDATION_FAILED_STATUS,
} from '../validation-failure.js';
import { ExecutionStatus } from '@objectstack/spec/automation';
import { ListRunsRequestSchema } from '@objectstack/spec/api';
import { parseEnumParam, parseIntegerParam, parseStringParam } from '../query-param.js';
import { capabilityUnavailable } from './unavailable.js';
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
 * Implements the maintainer ruling on #9378 (2026-08-17) — all four rows,
 * completed by #9415:
 *
 * | engine exit                | reality            | answer                |
 * |----------------------------|--------------------|-----------------------|
 * | flow not found             | never dispatched   | `404`                 |
 * | flow disabled              | never dispatched   | `409` `FLOW_DISABLED` |
 * | flow has no start node     | never dispatched   | `422` `FLOW_NO_START_NODE` |
 * | ran and failed (incl. the retry-strategy exits) | ran, rejected | `400` `FLOW_FAILED` |
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
 * stamps `'FLOW_NO_START_NODE'`, and the two arms below read those.
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
    if (typeof automationService.getFlow === 'function') {
        const existing = await automationService.getFlow(flowName);
        if (!existing) {
            return { handled: true, response: deps.error(`Flow '${flowName}' not found`, 404) };
        }
    }
    const result = await automationService.execute(flowName, buildAutomationContext(body, context));
    if (result?.success === false && result.code === 'FLOW_DISABLED') {
        return {
            handled: true,
            response: deps.error(result.error ?? `Flow '${flowName}' is disabled`, 409, {
                code: 'FLOW_DISABLED',
            }),
        };
    }
    if (result?.success === false && result.code === 'FLOW_NO_START_NODE') {
        return {
            handled: true,
            response: deps.error(result.error ?? `Flow '${flowName}' has no start node`, 422, {
                code: 'FLOW_NO_START_NODE',
            }),
        };
    }
    if (result?.success === false && result.status === 'failed') {
        return {
            handled: true,
            response: deps.error(result.error ?? 'Flow run failed', 400, {
                code: 'FLOW_FAILED',
                ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
                ...(result.summary !== undefined ? { summary: result.summary } : {}),
            }),
        };
    }
    return { handled: true, response: deps.success(result) };
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
 *   PUT    /:name                → updateFlow
 *   DELETE /:name                → deleteFlow (unregisterFlow)
 *   POST   /:name/trigger        → execute (legacy: trigger/:name also supported;
 *                                  unknown name → 404, disabled → 409 `FLOW_DISABLED`,
 *                                  no start node → 422 `FLOW_NO_START_NODE`, a run that
 *                                  ran and failed → 400 `FLOW_FAILED`; #9378 + #9415)
 *   POST   /:name/toggle         → toggleFlow (unknown name → 404, #7535)
 *   GET    /:name/runs           → listRuns (query: limit, cursor — validated, #7300;
 *                                  status — validated AND honoured, #7359)
 *                                  ⚑ run-state read — `sys_automation_run` grant (#7900)
 *   GET    /:name/runs/:runId    → getRun
 *                                  ⚑ run-state read — `sys_automation_run` grant (#7900)
 *   POST   /:name/runs/:runId/resume → resume a paused run (screen input / ADR-0019)
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
            try {
                automationService.registerFlow(body.name, body);
            } catch (e) {
                return {
                    handled: true,
                    response: deps.errorFromThrown(flowDefinitionRefusal(e), VALIDATION_FAILED_STATUS),
                };
            }
            return { handled: true, response: deps.success(body) };
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

        // POST /:name/runs/:runId/resume → resume a paused run (screen-flow
        // runtime / ADR-0019). Body `{ inputs }` = a screen node's collected
        // values, applied as bare flow variables; `output`/`branchLabel` also
        // forwarded for approval-style resumes. The outer envelope is a CLOSED
        // set — exactly the four keys below — and an unknown top-level key is
        // refused (#8796). Returns the next paused `{ screen }` (multi-screen)
        // or the completed result.
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
        // All are enforced in the ENGINE, at the one place a signal reaches the
        // variable map — deliberately not re-implemented here. Guarding a field
        // at a time in the transport is what let `output` reopen the hole
        // `inputs` had just closed; every transport now inherits one rule.
        if (parts[1] === 'runs' && parts[2] && parts[3] === 'resume' && m === 'POST') {
            if (typeof automationService.resume === 'function') {
                const b = (body && typeof body === 'object') ? body : {};
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
                const RESUME_BODY_KEYS = ['inputs', 'variables', 'output', 'branchLabel'];
                const unknownKeys = Object.keys(b).filter((k) => !RESUME_BODY_KEYS.includes(k));
                if (unknownKeys.length > 0) {
                    const accepted = RESUME_BODY_KEYS.map((k) => `\`${k}\``).join(', ');
                    throw validationFailure(
                        `Unknown key${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map((k) => `\`${k}\``).join(', ')} — the resume body accepts ${accepted}`,
                        unknownKeys.map((k) => ({
                            field: k,
                            code: 'unknown_field',
                            message: `not a resume body key — the resume body accepts ${accepted}`,
                        })),
                    );
                }
                const inputs = (b.inputs ?? b.variables);
                const signal: any = {};
                if (inputs && typeof inputs === 'object') signal.variables = inputs;
                if (b.output && typeof b.output === 'object') signal.output = b.output;
                if (typeof b.branchLabel === 'string') signal.branchLabel = b.branchLabel;
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
                if (result?.success === false) {
                    return {
                        handled: true,
                        response: deps.error(result.error ?? 'Flow run failed', 400, {
                            code: 'FLOW_FAILED',
                            ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
                            ...(result.summary !== undefined ? { summary: result.summary } : {}),
                        }),
                    };
                }
                return { handled: true, response: deps.success(result) };
            }
            return { handled: true, response: deps.error('Resume not supported', 501) };
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
                // has always declared it (`z.enum([...8 ExecutionStatus members])
                // .optional()`), but it had no slot on `IAutomationService.listRuns`
                // and was never built into this object — so `?status=failed` was
                // dropped here, silently, and the caller was answered 200 with
                // EVERY run of the flow capped by `limit`. That is worse than an
                // empty page: a monitoring caller paging for failures reads the
                // first 20 runs of any status and concludes those are the
                // failures. #7300 deliberately left the key ignored rather than
                // decide between honouring and retiring it; this card takes the
                // enforce route (ADR-0049), so the declared surface is true.
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
                try {
                    automationService.registerFlow(name, definition);
                } catch (e) {
                    return {
                        handled: true,
                        response: deps.errorFromThrown(flowDefinitionRefusal(e), VALIDATION_FAILED_STATUS),
                    };
                }
                return { handled: true, response: deps.success(definition) };
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
