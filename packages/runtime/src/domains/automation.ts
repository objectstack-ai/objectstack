// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/automation` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-6). Bridges to the `automation` service (flow CRUD, trigger/execute,
 * runs history, pause/resume — ADR-0018/0019/0022 surfaces). Route-order
 * subtlety preserved verbatim: `/actions`, `/connectors` and `/_status`
 * MUST precede the `/:name → getFlow` catch-all, or a flow literally named
 * "actions"/"connectors" would shadow them.
 */

import { CoreServiceName } from '@objectstack/spec/system';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

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
 *   GET    /actions              → getActionDescriptors (ADR-0018; ?paradigm/?source/?category filters)
 *   GET    /connectors           → getConnectorDescriptors (ADR-0022; ?type filter)
 *   GET    /:name                → getFlow
 *   POST   /                     → createFlow (registerFlow)
 *   PUT    /:name                → updateFlow
 *   DELETE /:name                → deleteFlow (unregisterFlow)
 *   POST   /:name/trigger        → execute (legacy: trigger/:name also supported)
 *   POST   /:name/toggle         → toggleFlow
 *   GET    /:name/runs           → listRuns
 *   GET    /:name/runs/:runId    → getRun
 *   POST   /:name/runs/:runId/resume → resume a paused run (screen input / ADR-0019)
 *   GET    /:name/runs/:runId/screen → the screen a paused run awaits
 */
export async function handleAutomationRequest(deps: DomainHandlerDeps, path: string, method: string, body: any, context: HttpProtocolContext, query?: any): Promise<HttpDispatcherResult> {
    const automationService = await deps.getService(CoreServiceName.enum.automation);
    if (!automationService) return { handled: false };

    const m = method.toUpperCase();
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // Legacy: POST /automation/trigger/:name
    if (parts[0] === 'trigger' && parts[1] && m === 'POST') {
         const triggerName = parts[1];
         if (typeof automationService.trigger === 'function') {
             const result = await automationService.trigger(triggerName, body, { request: context.request });
             return { handled: true, response: deps.success(result) };
         }
         // Fallback to execute
         if (typeof automationService.execute === 'function') {
             const result = await automationService.execute(triggerName, body);
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
            automationService.registerFlow(body?.name, body);
            return { handled: true, response: deps.success(body) };
        }
    }

    // GET /actions → list registered action descriptors (ADR-0018).
    // MUST precede the `/:name → getFlow` catch-all below, otherwise a
    // flow lookup for a flow literally named "actions" would shadow it.
    // Backs the designer palette + flow validation; the registry is open
    // and marketplace-extensible (built-in + plugin-contributed actions).
    if (parts[0] === 'actions' && parts.length === 1 && m === 'GET') {
        if (typeof automationService.getActionDescriptors === 'function') {
            let actions = automationService.getActionDescriptors() ?? [];
            // Optional filters mirror descriptor fields.
            if (query?.paradigm) {
                actions = actions.filter((a: any) => Array.isArray(a?.paradigms) && a.paradigms.includes(query.paradigm));
            }
            if (query?.source) {
                actions = actions.filter((a: any) => a?.source === query.source);
            }
            if (query?.category) {
                actions = actions.filter((a: any) => a?.category === query.category);
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
        if (typeof automationService.getConnectorDescriptors === 'function') {
            let connectors = automationService.getConnectorDescriptors() ?? [];
            // Optional filter mirrors the descriptor's connector type.
            if (query?.type) {
                connectors = connectors.filter((c: any) => c?.type === query.type);
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
        const svc = automationService as { getFlowRuntimeStates?: () => Array<{ name: string; enabled: boolean; bound: boolean }> };
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

        // POST /:name/trigger → execute
        if (parts[1] === 'trigger' && m === 'POST') {
            if (typeof automationService.execute === 'function') {
                const ctxBody = body && typeof body === 'object' ? body : {};
                // Translate UI/SDK request shape `{recordId, objectName, params}`
                // into the canonical AutomationContext shape expected by the engine.
                // Key transformations:
                //  - `recordId` is exposed in `params.recordId` AND aliased to
                //    `<objectName>Id` (camelCase) so flow variables like `leadId`,
                //    `caseId`, `opportunityId` resolve from a single REST contract.
                //  - `objectName` is mapped to the canonical `object` field.
                //  - The user identity from the auth context (if any) is forwarded
                //    as `userId` so node executors / template interpolation can
                //    expand `{$User.Id}`.
                const recordId = ctxBody.recordId;
                const objectName = ctxBody.objectName ?? ctxBody.object;
                const baseParams = (ctxBody.params && typeof ctxBody.params === 'object') ? { ...ctxBody.params } : {};
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
                const automationContext: any = {
                    params: baseParams,
                    object: objectName,
                    event: ctxBody.event ?? 'manual',
                };
                // Forward the FULLY-RESOLVED caller identity (not just the
                // user id) so a `runAs:'user'` flow enforces RLS exactly as the
                // triggering user — their roles/tenant, not a member fallback
                // (#1888). The engine elevates to a system principal only when
                // the flow itself declares `runAs:'system'`.
                const ec = (context as any)?.executionContext;
                const userIdFromAuth = (context as any)?.user?.id ?? (context as any)?.userId ?? ec?.userId;
                if (userIdFromAuth) automationContext.userId = userIdFromAuth;
                if (Array.isArray(ec?.positions) && ec.positions.length) automationContext.positions = ec.positions;
                if (Array.isArray(ec?.permissions) && ec.permissions.length) automationContext.permissions = ec.permissions;
                if (ec?.tenantId) automationContext.tenantId = ec.tenantId;
                const result = await automationService.execute(name, automationContext);
                return { handled: true, response: deps.success(result) };
            }
        }

        // POST /:name/toggle → toggleFlow
        if (parts[1] === 'toggle' && m === 'POST') {
            if (typeof automationService.toggleFlow === 'function') {
                await automationService.toggleFlow(name, body?.enabled ?? true);
                return { handled: true, response: deps.success({ name, enabled: body?.enabled ?? true }) };
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
        // extra keys.
        //
        // Two REFUSAL codes come back from the engine and are answered as such
        // rather than a 200 carrying `success: false` (which reads as "your
        // resume ran and the flow failed"):
        //   forbidden      → 403, the suspension is service-owned (#3801)
        //   invalid_signal → 400, the signal wrote the engine's `$` variable
        //                    namespace (#3853 follow-up)
        // Both are enforced in the ENGINE, at the one place a signal reaches the
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
                if (result?.success === false && result.code === 'forbidden') {
                    return { handled: true, response: deps.error(result.error ?? 'Resume forbidden', 403) };
                }
                if (result?.success === false && result.code === 'invalid_signal') {
                    return { handled: true, response: deps.error(result.error ?? 'Invalid resume signal', 400) };
                }
                return { handled: true, response: deps.success(result) };
            }
            return { handled: true, response: deps.error('Resume not supported', 501) };
        }

        // GET /:name/runs/:runId/screen → the screen a paused run awaits
        // (refresh-safe re-fetch for the UI flow-runner).
        if (parts[1] === 'runs' && parts[2] && parts[3] === 'screen' && m === 'GET') {
            if (typeof automationService.getSuspendedScreen === 'function') {
                const screen = automationService.getSuspendedScreen(parts[2]);
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
                const options = query ? { limit: query.limit ? Number(query.limit) : undefined, cursor: query.cursor } : undefined;
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
                automationService.registerFlow(name, body?.definition ?? body);
                return { handled: true, response: deps.success(body?.definition ?? body) };
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
