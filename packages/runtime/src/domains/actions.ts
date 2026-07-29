// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/actions` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-9). Server-registered business-action invocation over HTTP
 * (ADR-0066 D4 permission gate + ADR-0104 param contract), running on the
 * action-execution subsystem (PR-8). Env-resolution state stays behind the
 * deps seam: `resolveProjectKernelObjectQL` owns the direct-caller kernel
 * swap (ADR-0006 Phase 5). The legacy leading/trailing-slash regex was
 * dropped — `split('/').filter(Boolean)` already covers it (the CodeQL
 * polynomial-redos twin flagged in #2462).
 *
 *  - `POST /actions/:object/:action`              — record-scoped action
 *  - `POST /actions/:object/:action/:recordId`    — record-scoped action with id in URL
 *  - `POST /actions/global/:action`               — wildcard ("*") action
 *
 * The route dispatches on the declared action TYPE (#3915), the same way the
 * MCP `run_action` bridge does — `script` through the handler registry,
 * `flow` through the automation service. Before that it was script-only, so
 * a spec-faithful REST/SDK caller could not invoke a `type: 'flow'` action at
 * all: it fell through to the registry and came back as
 * `Action '' on object '*' not found`.
 */

import * as actionExec from '../action-execution.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createActionsDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/actions',
        handler: (req, context) =>
            handleActionsRequest(deps, req.path.substring(8), req.method, req.body, context),
    };
}

/**
 * Handle action invocation routes (`/actions/...`).
 *
 * Dispatches a named, server-registered action handler (registered via
 * `engine.registerAction(objectName, actionName, handler)`) over HTTP.
 * Three URL shapes are accepted to keep the client contract flexible:
 *
 *  - `POST /actions/:object/:action`              — record-scoped action
 *  - `POST /actions/:object/:action/:recordId`    — record-scoped action with id in URL
 *  - `POST /actions/global/:action`               — wildcard ("*") action
 *
 * Body shape: `{ recordId?: string, params?: Record<string, unknown> }`.
 * The handler is invoked with an `ActionContext` of:
 *   `{ record, user, engine, params }`
 * where `engine` exposes the slimmed CRUD surface used by CRM handlers
 * (`insert`, `update`, `delete`, `find`).
 *
 * Dispatch follows the DECLARED action type (#3915):
 *  - `script` (and any action with no resolvable declaration, which is
 *    handler-only by definition) → the registered handler, as before;
 *  - `flow` → `automation.execute(action.target, …)` with the caller's
 *    identity forwarded, so `runAs: 'user'` enforces RLS as the invoker;
 *  - `url` / `modal` / `form` / `api` → 400. They dispatch on `target` in the
 *    client (or at another endpoint entirely) and have no server dispatch
 *    here; saying so beats the registry's `not found`.
 */
export async function handleActionsRequest(deps: DomainHandlerDeps, path: string, method: string, body: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    if (method.toUpperCase() !== 'POST') {
        return { handled: true, response: deps.error('Method not allowed', 405) };
    }
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 2) {
        return { handled: true, response: deps.error('Path must be /actions/:object/:action', 400) };
    }
    const objectName = parts[0];
    const actionName = parts[1];
    const recordIdFromPath = parts[2];

    // Resolve project scope so the right project kernel's ObjectQL is
    // used (single-environment default when unset), then let the host
    // swap to the per-project kernel for DIRECT callers — dispatch()-
    // routed requests already did both, so this is idempotent there.
    // The kernel-swap side effect stays behind the deps seam (env-
    // resolution state never lives in a domain module).
    if (!_context.environmentId) {
        const def = deps.getDefaultEnvironmentId();
        if (def) _context.environmentId = def;
    }
    const projectQl: any = await deps.resolveProjectKernelObjectQL(_context);

    const ql: any = projectQl ?? await deps.getObjectQL(_context?.environmentId);
    if (!ql || typeof ql.executeAction !== 'function') {
        return { handled: true, response: deps.error('Data engine not available', 503) };
    }

    // [ADR-0066 D4] Dual-surface action gate — the server is the source of
    // truth. Resolve the action's declared `requiredPermissions` from the
    // object schema and reject (403) when the caller's systemPermissions
    // don't cover them. The objectui ActionRunner hides/disables the same
    // action from the identical declaration, so a UI-hidden action is also
    // server-closed (and the inverse footgun is removed). System/engine
    // self-invocation (isSystem) bypasses; an unauthenticated caller holds
    // no capabilities and is therefore denied for a gated action.
    // Resolve the object schema + this action's declaration once — both the
    // permission gate (ADR-0066 D4) and the param contract (ADR-0104 D2)
    // read it.
    let actionSchema: any;
    let actionDef: any;
    try {
        // Standalone declarations (ObjectQL registry artifacts / Studio-
        // authored `action` rows) resolve here too, so a route whose action
        // never appears inside an object definition is gated and dispatched
        // like any other (#3915).
        const declaration = await actionExec.resolveRouteActionDeclaration(deps, {
            ql,
            objectName,
            actionName,
            envId: _context?.environmentId,
        });
        actionSchema = declaration?.obj;
        actionDef = declaration?.action;
        const gateError = actionExec.actionPermissionError(deps, actionDef, _context?.executionContext, objectName);
        if (gateError) {
            return { handled: true, response: deps.error(gateError, 403) };
        }
    } catch {
        /* schema unresolved → no declared gate to enforce (handler-only action) */
    }

    // [#3915] Action-TYPE dispatch. Per spec every non-`script` type
    // dispatches on `target`, and only `flow` has a server-side runner — so
    // a `url`/`modal`/`form`/`api` action reaching this endpoint has nowhere
    // to go. It used to fall through to the script registry and come back as
    // the misleading `Action '' on object '*' not found`; reject it with the
    // prescription instead. `script` — and an UNDECLARED action, which is
    // handler-only by definition — keeps the registry path below; `flow` is
    // dispatched to the automation service once the param contract and the
    // record load have run, exactly as the MCP `run_action` path does.
    const actionType: string = typeof actionDef?.type === 'string' ? actionDef.type : 'script';
    if (actionDef) {
        const typeError = actionExec.headlessActionTypeError(deps, actionDef, objectName);
        if (typeError) {
            return { handled: true, response: deps.error(typeError, 400) };
        }
    }
    // A flow action on a kernel with no automation service is a deployment
    // gap, not a business failure — report it like the missing data engine
    // above (503) instead of burying it in a `{ success: false }` body.
    if (actionType === 'flow' && !(await actionExec.resolveAutomationService(deps, _context?.environmentId))) {
        return { handled: true, response: deps.error(actionExec.flowActionUnavailableError(actionDef), 503) };
    }

    // Resolve the handler — fall back to wildcard '*' if the object-specific key is missing.
    // Since engine.executeAction throws when the key is unknown, we probe via the internal
    // map by attempting the call inside a try/catch and rotating to '*'.
    const tryExecute = async (obj: string) => {
        return ql.executeAction(obj, actionName, actionContext);
    };

    const reqBody = body && typeof body === 'object' ? body : {};
    const recordId = recordIdFromPath ?? reqBody.recordId;
    const reqParams = (reqBody.params && typeof reqBody.params === 'object') ? reqBody.params : {};

    // [ADR-0104 D2] Enforce the declared param contract before the handler
    // runs — required/option/multiple/reference-id shape + unknown keys.
    // Warn-first unless OS_ACTION_PARAMS_STRICT_ENABLED=1 (then a 400).
    const paramError = actionExec.enforceActionParams(deps, actionDef, actionSchema, reqParams, { objectName, actionName });
    if (paramError) {
        return { handled: true, response: deps.error(paramError, 400) };
    }

    // Load the record (best-effort) so handlers can rely on `ctx.record`.
    let record: Record<string, unknown> = {};
    if (recordId && objectName !== 'global') {
        try {
            const got = await actionExec.callData(deps, 'get', { object: objectName, id: recordId }, _context.dataDriver, _context.environmentId, _context.executionContext);
            if (got?.record) record = got.record;
        } catch { /* record may not exist for new-record actions; pass empty */ }
    }
    if (record && (record as any).id == null && recordId) (record as any).id = recordId;

    // Slim engine facade matching the ActionContext.engine shape used by CRM
    // handlers. ⚠️ TRUSTED — context-less, RLS/FLS-bypassing by design; see
    // buildActionEngineFacade for the full security-model rationale (#2849).
    const engineFacade = {
        async insert(object: string, data: Record<string, unknown>): Promise<{ id: string }> {
            const res = await ql.insert(object, data);
            const id = (res && (res as any).id) ?? (data as any).id;
            return { id };
        },
        async update(object: string, id: string, data: Record<string, unknown>): Promise<void> {
            await ql.update(object, data, { where: { id } });
        },
        async delete(object: string, id: string): Promise<void> {
            await ql.delete(object, { where: { id } });
        },
        async find(object: string, query: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
            const opts = query && Object.keys(query).length ? { where: query } : undefined;
            const rows = await ql.find(object, opts as any);
            return Array.isArray(rows) ? rows : ((rows as any)?.value ?? []);
        },
    };

    // Resolve the caller identity from the request's ExecutionContext — the
    // single source `dispatch()` populates via `resolveExecutionContext`,
    // the same envelope the MCP `runAction` and record-change trigger paths
    // read. The action body sandbox receives the operator's id and business
    // roles (ADR-0090 `positions`, formerly `roles`) so a handler can branch
    // on identity and enforce ownership. Falls back to a `system` principal
    // only for a genuinely anonymous / self-invoked call (#2701).
    const ec: any = _context?.executionContext;
    const userFromAuth = ec?.userId
        ? {
            id: ec.userId,
            name: ec.userId,
            email: ec.email,
            roles: Array.isArray(ec.positions) ? ec.positions : [],
            positions: Array.isArray(ec.positions) ? ec.positions : [],
            permissions: Array.isArray(ec.permissions) ? ec.permissions : [],
            // `organizationId` is the blessed developer-facing name for the
            // caller's active org (matches columns + `current_user.organizationId`).
            // The deprecated `tenantId` alias (#3280) was removed in v11 (#3290).
            organizationId: ec.tenantId,
          }
        : { id: 'system', name: 'system', roles: [], positions: [], permissions: [] };

    const actionContext: any = {
        record,
        user: userFromAuth,
        session: actionExec.buildActionSession(deps, ec),
        engine: engineFacade,
        params: { ...reqParams, recordId, objectName },
    };

    try {
        // ── flow dispatch (#3915) ── the same `dispatchFlowAction` the MCP
        // `run_action` path uses: the automation engine runs `action.target`
        // with the caller's identity forwarded, so a `runAs: 'user'` flow
        // enforces RLS as the invoker (ADR-0049). No trusted-mode audit line
        // here — RLS/FLS-bypassing elevation is a script-BODY property, and a
        // flow does not get it.
        if (actionType === 'flow') {
            const result = await actionExec.dispatchFlowAction(deps, actionDef, {
                objectName,
                record,
                params: reqParams,
                ec,
                envId: _context?.environmentId,
            });
            return { handled: true, response: deps.success({ success: true, data: result }) };
        }

        // [#2849] Same trusted-mode elevation as the MCP path — keep it audible.
        console.info(
            `[action-audit] REST action '${objectName}/${actionName}' — body executes TRUSTED ` +
            `(context-less engine, RLS/FLS-bypassing) for user '${userFromAuth.id}'`,
        );

        // ── script/body dispatch ──
        // Try object-specific first; on "not found" error, fall back to wildcard.
        let result: any;
        try {
            result = await tryExecute(objectName);
        } catch (err: any) {
            const msg = String(err?.message ?? err ?? '');
            if (/not found/i.test(msg) && objectName !== '*') {
                result = await tryExecute('*');
            } else {
                throw err;
            }
        }
        return { handled: true, response: deps.success({ success: true, data: result }) };
    } catch (err: any) {
        const full = err?.message ?? String(err);
        // The sandbox wraps a user throw as `<kind> '<name>' threw: <msg>` for
        // server logs; surface only the business `<msg>` (SandboxError.innerMessage)
        // to the client so an action's error toast reads as plain text instead of
        // leaking the debug prefix. Keep the full wrapper in the log for debugging.
        const inner: unknown = err?.innerMessage;
        const clientMsg = (typeof inner === 'string' && inner) ? inner : full;
        if (clientMsg !== full) console.error(`[action ${objectName}/${actionName}] ${full}`);
        return { handled: true, response: deps.success({ success: false, error: clientMsg }) };
    }
}
