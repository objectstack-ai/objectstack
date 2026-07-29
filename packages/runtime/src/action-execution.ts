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

import { validateActionParams, type ResolvedActionParam } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { checkApiExposure } from './api-exposure.js';

/** A `sys_`-prefixed object is a system table — off-limits to external MCP agents. */
export function isSystemObjectName(name: string): boolean {
    return /^sys_/i.test(name);
}

/** Strict action-param enforcement opt-in (ADR-0104 D2 warn-first rollout). */
function actionParamsStrict(): boolean {
    return typeof process !== 'undefined' && process.env?.OS_ACTION_PARAMS_STRICT_ENABLED === '1';
}

const _warnedActionParams = new Set<string>();
function warnActionParamsOnce(key: string, message: string): void {
    if (_warnedActionParams.has(key)) return;
    _warnedActionParams.add(key);
    console.warn(message);
}

/** The dispatcher facilities the action subsystem may touch. */
export interface ActionExecutionDeps {
    resolveService(name: string, environmentId?: string): any;
    getObjectQL(environmentId?: string): Promise<any>;
}

/**
 * Direct data service dispatch — replaces broker.call('data.*').
 * Tries protocol service first (supports expand/populate), falls back to ObjectQL.
 *
 * @param dataDriver - Optional environment-scoped driver to use instead of kernel default
 * @param scopeId - Optional project ID for scoped service resolution (SharedProjectPlugin mode)
 */
export async function callData(deps: ActionExecutionDeps, 
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
            const meta = await deps.resolveService('metadata', scopeId);
            def = await (meta as any)?.getObject?.(params.object);
        } catch {
            def = undefined; // fall open to schema defaults (apiEnabled=true)
        }
        const gate = checkApiExposure(def, action);
        if (!gate.allowed) {
            throw { statusCode: gate.status ?? 403, message: gate.reason ?? 'API access denied' };
        }
    }

    const protocol = await deps.resolveService('protocol', scopeId);
    const qlService = dataDriver ?? await deps.getObjectQL(scopeId);
    const ql = qlService ?? await deps.resolveService('objectql', scopeId);
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
            return match ? { object: params.object, id: params.id, record: match } : null;
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
            if (!existing) throw new Error('[ObjectStack] Not Found');
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
            await ql.delete(params.object, findOpts({ where: { id: params.id } }));
            return { object: params.object, id: params.id, deleted: true };
        }
        throw { statusCode: 503, message: 'Data service not available' };
    }

    if (action === 'query' || action === 'find') {
        if (protocol && typeof protocol.findData === 'function') {
            // Build query: use explicit params.query if provided, otherwise extract query fields from params
            const query = params.query || (() => {
                const { object, ...rest } = params;
                return rest;
            })();
            return await protocol.findData({ object: params.object, query, context: executionContext });
        }
        if (ql) {
            let all = await ql.find(params.object, qlOpts);
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
        const engine = (await deps.getObjectQL(scopeId))
            ?? await deps.resolveService('objectql', scopeId).catch(() => null);
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

    if (action === 'batch') {
        // Batch operations — not yet supported via direct service dispatch
        return { object: params.object, results: [] };
    }

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
export function actionPermissionError(deps: ActionExecutionDeps, actionDef: any, ec: any, objectName?: string): string | null {
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
export function actionAiExposureError(deps: ActionExecutionDeps, actionDef: any, objectName?: string): string | null {
    if (actionDef?.ai?.exposed === true) return null;
    const on = objectName ? ` on '${objectName}'` : '';
    return (
        `Action '${actionDef?.name ?? 'unknown'}'${on} is not exposed to AI — ` +
        `the app author must opt it in with \`ai: { exposed: true, description: … }\``
    );
}

/**
 * Whether an action has a headless invocation path (so MCP can run it).
 * Mirrors the supported-type set of the (now cloud-side) action-tools
 * bridge: `script` needs a handler binding (`target`) or an inline `body`;
 * `flow` needs a `target` and an automation service. UI-only types
 * (`url`, `modal`, `form`) and `api` have no server dispatch here.
 */
export function isHeadlessInvokableAction(deps: ActionExecutionDeps, action: any, hasAutomation: boolean): boolean {
    const type: string = action?.type ?? 'script';
    if (type === 'script') return Boolean(action?.target || action?.body);
    if (type === 'flow') return Boolean(action?.target) && hasAutomation;
    return false;
}

/**
 * The action types a headless caller can actually invoke through a server
 * dispatch — the two {@link isHeadlessInvokableAction} accepts. Kept next to
 * it so the predicate and the explanation below can never drift apart.
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
export function headlessActionTypeError(deps: ActionExecutionDeps, action: any, objectName?: string): string | null {
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
export async function resolveAutomationService(deps: ActionExecutionDeps, envId?: string): Promise<any | null> {
    try {
        const svc: any = await deps.resolveService('automation', envId);
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
export function seedFlowActionParams(deps: ActionExecutionDeps,
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
        if (objectName && objectName !== 'global') {
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
 * Dispatch a `type: 'flow'` action through the automation service.
 *
 * The ONE implementation both headless surfaces share — the MCP `run_action`
 * tool and the REST `/actions/:object/:action` route (#3915, which is exactly
 * the asymmetry that let this branch exist on only one of them). Throws on a
 * missing automation service and converts a `{ success: false }` engine result
 * into a throw so both callers report failure the same way; returns the raw
 * automation result otherwise.
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
 */
export async function dispatchFlowAction(deps: ActionExecutionDeps,
    action: any,
    wiring: {
        objectName: string;
        record: Record<string, unknown>;
        params: Record<string, unknown>;
        recordId?: string;
        ec: any;
        envId?: string;
    },
): Promise<any> {
    const { objectName, record, params, recordId, ec, envId } = wiring;
    const automation = await resolveAutomationService(deps, envId);
    if (!automation) {
        throw new Error(flowActionUnavailableError(action));
    }
    // Pass a proper AutomationContext (the engine never read the former
    // `triggerData` envelope).
    const result: any = await automation.execute(action.target, {
        record,
        ...(isObjectLessActionKey(objectName) ? {} : { object: objectName }),
        userId: ec?.userId,
        ...(Array.isArray(ec?.positions) && ec.positions.length ? { positions: ec.positions } : {}),
        ...(Array.isArray(ec?.permissions) && ec.permissions.length ? { permissions: ec.permissions } : {}),
        ...(ec?.tenantId ? { tenantId: ec.tenantId } : {}),
        params: seedFlowActionParams(deps, action, { objectName, record, params, recordId }),
    });
    if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        // The flow RAN and rejected — a business outcome, so the REST route
        // reports it in the payload (`{success: false, error}`, HTTP 200), the
        // same as a script body that throws. Only a route that never dispatched
        // gets a status (#3913).
        throw new Error(`Flow '${action.target}' failed: ${result.error ?? 'unknown error'}`);
    }
    return result ?? null;
}

export function actionLooksDestructive(deps: ActionExecutionDeps, action: any): boolean {
    if (action?.ai?.requiresConfirmation !== undefined) return Boolean(action.ai.requiresConfirmation);
    return Boolean(action?.confirmText || action?.mode === 'delete' || action?.variant === 'danger');
}

export function summarizeAction(deps: ActionExecutionDeps, action: any, obj: any, objectName: string): any {
    const requiresRecord =
        Array.isArray(action?.locations) &&
        action.locations.some(
            (l: string) =>
                l === 'list_item' || l === 'record_header' || l === 'record_more' || l === 'record_related',
        );
    const description =
        (typeof action?.ai?.description === 'string' ? action.ai.description : undefined) ??
        (typeof action?.label === 'string' ? action.label : undefined);
    const params = summarizeActionParams(deps, action, obj);
    return {
        name: action.name,
        objectName,
        ...(typeof action?.label === 'string' ? { label: action.label } : {}),
        ...(description ? { description } : {}),
        type: action?.type ?? 'script',
        requiresRecord: Boolean(requiresRecord),
        requiresConfirmation: actionLooksDestructive(deps, action),
        ...(params.length > 0 ? { params } : {}),
    };
}

export function jsonTypeOf(deps: ActionExecutionDeps, t: string | undefined): 'string' | 'number' | 'boolean' | 'array' {
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

export function summarizeActionParams(deps: ActionExecutionDeps, action: any, obj: any): any[] {
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
    return out;
}

/**
 * Resolve an action's declared `params[]` to their effective value-shape
 * inputs (ADR-0104 D2). A field-backed param inherits type/multiple/
 * options/required from the referenced object field; an inline param
 * carries them directly (inline overrides win). `obj` is the action's
 * parent object schema (holds `.fields`); pass `undefined` for a global
 * action with only inline params.
 */
export function resolveDeclaredActionParams(deps: ActionExecutionDeps, action: any, obj: any): ResolvedActionParam[] {
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
 * BEFORE the handler runs (ADR-0104 D2). Returns a `400`-worthy error
 * message when the contract is violated AND strict mode is on
 * (`OS_ACTION_PARAMS_STRICT_ENABLED=1`); otherwise returns `null`, logging
 * a one-time warning per (object/action) so the drift is visible without
 * breaking callers whose params were silently wrong before (warn-first, R3).
 *
 * Actions that declare no `params` keep today's pass-through — there is
 * nothing to validate against, so existing param-less actions are untouched.
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
    if (actionParamsStrict()) {
        return `Invalid action params: ${summary}`;
    }
    const key = `${where.objectName ?? 'global'}/${where.actionName ?? action?.name ?? 'action'}`;
    warnActionParamsOnce(
        key,
        `[action-params] ${key}: ${summary} — accepted for now (ADR-0104 D2 warn-first; ` +
        `set OS_ACTION_PARAMS_STRICT_ENABLED=1 to reject with 400)`,
    );
    return null;
}

/**
 * Build the action-body `ctx.session` from the request ExecutionContext,
 * mirroring the hook `ctx.session` shape (#3280) so an action author reads
 * the caller's active org under the SAME blessed name as a hook author.
 *
 * `organizationId` is the blessed name for the caller's active org — the
 * same value as the `organization_id` column and `current_user.organizationId`
 * (RLS). The deprecated `session.tenantId` alias (#3280) was removed in v11
 * (#3290); the driver-layer `ExecutionContext.tenantId` it is sourced from is
 * a distinct, configurable axis and stays. Returns undefined for a genuinely
 * context-less / self-invoked call so a body can distinguish "no session" the
 * same way hooks do.
 */
export function buildActionSession(deps: ActionExecutionDeps, ec: any): any | undefined {
    if (!ec || (ec.userId == null && ec.tenantId == null)) return undefined;
    return {
        ...(ec.userId != null ? { userId: String(ec.userId) } : {}),
        ...(ec.tenantId != null ? { organizationId: String(ec.tenantId) } : {}),
        ...(Array.isArray(ec.positions) && ec.positions.length ? { roles: ec.positions } : {}),
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
export function buildActionApi(deps: ActionExecutionDeps, ql: any, ec: any): any | undefined {
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
export function buildActionEngineFacade(deps: ActionExecutionDeps, ql: any, ec?: any): any {
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
    const hasAutomation = Boolean(await resolveAutomationService(deps, envId));
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

    // [ADR-0104 D2] Declared param contract — same enforcement as the REST
    // route. AI/MCP is the caller most likely to send a plausible-but-wrong
    // bag, so the check belongs here too. Warn-first unless
    // OS_ACTION_PARAMS_STRICT_ENABLED=1 (then throws → surfaced as an error).
    const paramError = enforceActionParams(deps, action, obj, params, { objectName, actionName: name });
    if (paramError) throw new Error(paramError);

    // Load the subject record under RLS when row-context (engages the same
    // permission path as get_record — an unseen record reads as not-found).
    let record: Record<string, unknown> = {};
    if (recordId && !isObjectLessActionKey(objectName)) {
        try {
            const got: any = await callData('get', { object: objectName, id: recordId }, driver, envId, ec);
            if (got?.record) record = got.record;
        } catch {
            /* new-record / record-less actions pass an empty record */
        }
    }
    if (record && (record as any).id == null && recordId) (record as any).id = recordId;

    const user = ec?.userId
        ? {
            id: ec.userId,
            name: ec.userName ?? ec.userDisplayName ?? ec.userId,
            // `organizationId` is the blessed name for the caller's active
            // org (matches columns + `current_user.organizationId`); the
            // action body executes TRUSTED (RLS-bypassing), so a body that
            // wants to scope by org must read it here (#3280).
            ...(ec.tenantId != null ? { organizationId: String(ec.tenantId) } : {}),
          }
        : { id: 'system', name: 'system' };

    // ── flow dispatch ── (shared with the REST /actions route, #3915)
    if (action.type === 'flow') {
        const result = await dispatchFlowAction(deps, action, { objectName, record, params, recordId, ec, envId });
        return { ok: true, action: action.name, objectName, ...(recordId ? { recordId } : {}), result };
    }

    // ── script/body dispatch via the engine's executeAction ──
    const ql: any = await deps.getObjectQL(envId);
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
    // Handler key: body-based actions register under `name` (AppPlugin);
    // target-bound script actions register under `target` (user code).
    // Probe both, then the object-less keys (#3913), distinguishing the
    // engine's "action not registered" miss from a genuine handler error.
    const primary = action.body ? action.name : (action.target || action.name);
    const candidates = [primary, action.target, action.name].filter(
        (k: unknown, i: number, a: unknown[]): k is string => typeof k === 'string' && a.indexOf(k) === i,
    );
    for (const obj of actionHandlerObjectKeys(objectName)) {
        for (const key of candidates) {
            try {
                const result = await ql.executeAction(obj, key, actionContext);
                return { ok: true, action: action.name, objectName, ...(recordId ? { recordId } : {}), result: result ?? null };
            } catch (err: any) {
                if (!isActionNotRegisteredError(err)) throw err; // real handler failure → surface
            }
        }
    }
    throw new Error(`No handler registered for action '${name}' on '${objectName}'`);
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
 *     legacy `object` field, else the `'global'` wildcard).
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
 * Owning object of a standalone `action` item — must stay in lockstep with
 * the ObjectQL plugin's `actionObjectKey` (the engine registration key), so
 * the declaration the MCP surface resolves is the one whose handler
 * `executeAction` will find: spec `objectName`, bundle-collector `object`,
 * else the `'global'` wildcard.
 */
export function standaloneActionObjectName(deps: ActionExecutionDeps, action: any): string {
    if (typeof action?.objectName === 'string' && action.objectName.length > 0) return action.objectName;
    if (typeof action?.object === 'string' && action.object.length > 0) return action.object;
    return GLOBAL_ACTION_OBJECT_KEY;
}

/**
 * The engine object key an object-LESS ("global") action registers under.
 *
 * Canonical since #3913, and it is `'global'` because that is what the two
 * writers have always written: `AppPlugin` (`action.object || 'global'`) and
 * `ObjectQLPlugin.actionObjectKey`. `engine.executeAction` is an exact-string
 * `Map` lookup with no wildcard semantics, so the READERS have to probe the
 * same literal — before this, the REST route and the MCP bridge both rotated
 * to `'*'`, which nothing ever registers, and every global action came back as
 * `Action '<name>' on object '*' not found`.
 */
export const GLOBAL_ACTION_OBJECT_KEY = 'global';

/**
 * The engine object keys to probe, in order, for a route's action handler.
 *
 * The routed object first, then the canonical object-less key (#3913), then
 * the legacy `'*'` — kept last so a handler that user code registered directly
 * against the wildcard still resolves. Deduped, so a request routed AT
 * `/actions/global/:action` probes `'global'` exactly once.
 */
export function actionHandlerObjectKeys(objectName: string): string[] {
    return [objectName, GLOBAL_ACTION_OBJECT_KEY, '*'].filter(
        (k, i, all) => all.indexOf(k) === i,
    );
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
 * True when the routed "object" is the object-less placeholder rather than a
 * real object — the canonical `'global'`, the legacy `'*'`, or nothing at all
 * (`POST /actions//:action`). Callers use it to skip work that only makes
 * sense for a record-scoped action: loading `ctx.record`, and naming an
 * `object` on the flow-automation context.
 */
export function isObjectLessActionKey(objectName: string | undefined | null): boolean {
    return !objectName || objectName === GLOBAL_ACTION_OBJECT_KEY || objectName === '*';
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
    args: { ql: any; objectName: string; actionName: string; envId?: string },
): Promise<{ action: any; obj: any } | undefined> {
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

    try {
        const meta: any = await deps.resolveService('metadata', envId);
        const fromMeta: any = await meta?.load?.('action', actionName);
        if (fromMeta && ownsRoute(fromMeta)) return { action: fromMeta, obj };
    } catch {
        /* no metadata service on this kernel → no declaration to resolve */
    }

    return obj ? { action: undefined, obj } : undefined;
}
