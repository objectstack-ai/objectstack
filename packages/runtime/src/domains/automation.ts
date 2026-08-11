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
import type { IAutomationService } from '@objectstack/spec/contracts';
import { isServiceServeable } from '../service-serveable.js';
import { validationFailure } from '../validation-failure.js';
import { ExecutionStatus } from '@objectstack/spec/automation';
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
 *   POST   /:name/trigger        → execute (legacy: trigger/:name also supported)
 *   POST   /:name/toggle         → toggleFlow (unknown name → 404, #7535)
 *   GET    /:name/runs           → listRuns (query: limit, cursor — validated, #7300;
 *                                  status — validated AND honoured, #7359)
 *   GET    /:name/runs/:runId    → getRun
 *   POST   /:name/runs/:runId/resume → resume a paused run (screen input / ADR-0019)
 *   GET    /:name/runs/:runId/screen → the screen a paused run awaits
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

    const m = method.toUpperCase();
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // Legacy: POST /automation/trigger/:name — the shape
    // `client.automation.trigger()` calls. Same handling as
    // `POST /:name/trigger` below: one context builder, one service method.
    //
    // [#4127] This branch used to probe `automationService.trigger(name, body,
    // { request })` first and "fall back" to `execute`. Nothing in the repo has
    // ever implemented `trigger` on the automation slot — not the engine, not
    // the dev stub — and the contract never declared it, so the probe was dead
    // on every deployment and the fallback WAS the route. Declaring `trigger?`
    // to make the probe honest would have blessed a second name for `execute`
    // (Prime Directive #12); the dead branch is gone instead.
    if (parts[0] === 'trigger' && parts[1] && m === 'POST') {
        const triggerName = parts[1];
        if (typeof automationService.execute === 'function') {
            const result = await automationService.execute(triggerName, buildAutomationContext(body, context));
            return { handled: true, response: deps.success(result) };
        }
    }

    // GET / → listFlows
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
            automationService.registerFlow(body.name, body);
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
                const result = await automationService.execute(name, buildAutomationContext(body, context));
                return { handled: true, response: deps.success(result) };
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
                        unknownKeys.map((k) => ({ field: k, code: 'unrecognized_keys', message: 'not a toggle field — did you mean `enabled`?' })),
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
        // forwarded for approval-style resumes. Returns the next paused
        // `{ screen }` (multi-screen) or the completed result.
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
        //   RUN_NOT_FOUND      → 404, no such suspension — unresumable for good
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
                return { handled: true, response: deps.success(result) };
            }
            return { handled: true, response: deps.error('Resume not supported', 501) };
        }

        // GET /:name/runs/:runId/screen → the screen a paused run awaits
        // (refresh-safe re-fetch for the UI flow-runner).
        if (parts[1] === 'runs' && parts[2] && parts[3] === 'screen' && m === 'GET') {
            if (typeof automationService.getSuspendedScreen === 'function') {
                const screen = await automationService.getSuspendedScreen(parts[2]);
                if (!screen) return { handled: true, response: deps.error('No pending screen for run', 404) };
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
                // Out-of-range numbers are NOT refused — `?limit=1000` still
                // reaches the engine as 1000 and is sliced there. Range is the
                // service's declared business (`ListRunsRequestSchema` bounds it
                // 1..100); this gate only refuses values that were never whole
                // numbers.
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
                const options = query
                    ? {
                        limit: parseIntegerParam('limit', query.limit),
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
                automationService.registerFlow(name, definition);
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
