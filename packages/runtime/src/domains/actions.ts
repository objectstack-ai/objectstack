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
 *  - `POST /actions/global/:action`               — object-less ("global") action
 *  - `POST /actions//:action`                     — object-less action, empty segment
 *  - `POST /actions/_activation/:object/:action`  — [ADR-0126 §8] enable/disable
 *      the PACKAGED action: one `sys_metadata_activation` row, gated by
 *      `manage_metadata` + the §5 platform-operator posture rule. The only
 *      non-invocation shape here, and the only one whose first segment cannot
 *      be a name (machine names cannot start with `_`).
 *
 * Every invocation shape above consults that ledger once the declaration is
 * resolved: a packaged action switched off for this installation is refused
 * `409 ACTION_DISABLED` before anything dispatches (`disabledActionRefusal`,
 * `../action-execution.ts`, which the MCP `run_action` bridge calls too).
 *
 * The route dispatches on the declared action TYPE (#3915), the same way the
 * MCP `run_action` bridge does — `script` through the handler registry,
 * `flow` through the automation service. Before that it was script-only, so
 * a spec-faithful REST/SDK caller could not invoke a `type: 'flow'` action at
 * all: it fell through to the registry and came back as
 * `Action '' on object '*' not found`.
 *
 * #3913 closed two holes:
 *  - object-less actions register under `'global'` (AppPlugin +
 *    ObjectQLPlugin) but the handler fallback probed `'*'`, which nothing
 *    registers — so a global action was reachable only by spelling `global`
 *    into the URL, and `POST /actions//:action` never resolved at all;
 *  - an action that no key carried came back as HTTP 200
 *    `{success: true, data: {success: false, error: "… not found"}}`, so a
 *    caller that did not hand-inspect the INNER envelope read it as a success.
 *    Nothing DISPATCHED there, so it is a 404 now — joining the pre-dispatch
 *    answers this route already gives a status (403 denied, 400 wrong type,
 *    503 unavailable).
 *
 * #3962 finished the unification: FAILURES SPEAK HTTP, exactly as /data always
 * has. The old 200-with-inner-`{success:false}` wire was never a designed
 * contract — no ADR or doc specified it; it was the catch block reusing
 * `deps.success()`, and /actions was the only route of 12 that double-wrapped.
 * Success is now a SINGLE wrap (`data` = the handler's return value), a
 * deliberate rejection (body `throw`, flow rejection, ValidationError) is a
 * 400 carrying `code`/`fields` in `details`, and a crash (`TypeError`, driver
 * class, sandbox timeout — told apart by the error's NAME, #3951) is a 500.
 *
 *   did a handler run?       no → 404 / 403 / 400 / 503
 *   did it reject or crash?  reject → 400;  crash → 500
 *   did it return?           200, `data` = handler return value
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import * as actionExec from '../action-execution.js';
import { actorUserFromExecutionContext, resolveActorDisplayName } from '../security/actor-user.js';
import { validationFailure, validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';
// [ADR-0126 §5] The shared activation write-authority gates — the same two
// tiers `/automation`'s toggle door passes, one implementation.
import {
    refuseUngrantedActivationWrite,
    refuseUngrantedActivationAuthoring,
    ACTION_ACTIVATION_SUBJECT,
} from './activation-gate.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * [ADR-0126 §8 item 2] The reserved first segment of the activation door,
 * `POST /actions/_activation/:object/:action`.
 *
 * ## Why a leading underscore, and why the FIRST segment
 *
 * Every other shape this domain serves is an INVOCATION, and the segments are
 * caller-supplied names: `/:object/:action`, `/:object/:action/:recordId`. A
 * door spelled as a deeper segment (`/:object/:action/toggle`) would sit in the
 * `recordId` position, where the value is an arbitrary string — so a record
 * whose id is literally `toggle` would collide with it, and the collision would
 * be silent. The first segment cannot collide with anything: object and action
 * machine names are `SnakeCaseIdentifierSchema`, `^[a-z][a-z0-9_]*$`, which
 * cannot begin with `_`. So `_activation` is unreachable as an object name, and
 * `/actions/_activation` is unreachable as an object-less invocation of an
 * action named `_activation`.
 *
 * The predicate has **no upper bound on depth**, deliberately, and matches the
 * arm exactly: the `/automation` toggle gate records what a mismatch costs — "a
 * gate narrower than its route is a bypass and a gate wider than its route is
 * an over-block". Everything under `_activation` is gated here; the arm itself
 * refuses a wrong-shaped path with a 400 that names the shape.
 */
const ACTION_ACTIVATION_SEGMENT = '_activation';

function isActionActivationWrite(parts: string[], method: string): boolean {
    return method === 'POST' && parts[0] === ACTION_ACTIVATION_SEGMENT;
}

/**
 * [ADR-0126 §8 item 2] `POST /actions/_activation/:object/:action` — flip one
 * packaged action's install-level activation row.
 *
 * ## What this door writes, and what it deliberately does not
 *
 * One `sys_metadata_activation` row: `metadata_type: 'action'`, the action's
 * declarative NAME, its package, `active`. ⛔ No definition is touched (§6 wall
 * 2: `sys_metadata` stays the sole definition ledger), ⛔ no clone is created —
 * the action-clone half is NOT chartered (§8 item 2), so this door has no
 * sibling that authors anything.
 *
 * ## Order of operations, and why each step is where it is
 *
 *  1. **Both authority gates, first.** `manage_metadata` (#10243: switching a
 *     shipped artifact off is functionally equivalent to deleting it), then the
 *     ADR-0126 §5 posture gate. Ahead of the body checks and ahead of any
 *     lookup, so a refused caller writes nothing and learns nothing — neither
 *     the body contract nor whether the named action exists here.
 *  2. **Body contract.** `{ enabled?: boolean }`, unknown keys refused. The
 *     flow toggle's #3899 lesson verbatim: on an unchecked body `{"enable":
 *     false}` — one letter off — ENABLED the artifact and answered 200, and the
 *     caller trying to switch something OFF is exactly the caller this must not
 *     silently invert.
 *  3. **Declaration**, through the SAME `resolveRouteActionDeclaration` the
 *     invocation door uses, so the two can never disagree about which actions
 *     exist. Unknown → 404 (the #7535 shape: a typo must not read as a server
 *     fault), metadata plane unavailable → 503 (an outage is not a verdict).
 *  4. **Ambiguity refusal.** The ledger addresses an artifact by machine name
 *     (§4). Two objects declaring the same action name therefore address ONE
 *     row, so this refuses instead of silently switching both off.
 *  5. **The durable write**, through the engine, which writes the row before
 *     touching its projection.
 *
 * ⛔ It does not require the action to be PACKAGED. Neither does the flow
 * toggle: a row for a runtime-authored artifact is harmless (absence means
 * active, and the row records a real administrator choice), while a
 * provenance test here would refuse the flip for anything the registry cannot
 * classify — failing closed on the wrong axis.
 */
async function handleActionActivationWrite(
    deps: DomainHandlerDeps,
    ql: any,
    parts: string[],
    body: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // ── 1. authority ────────────────────────────────────────────────────────
    const authoringRefusal = refuseUngrantedActivationAuthoring(deps, context, ACTION_ACTIVATION_SUBJECT);
    if (authoringRefusal) return authoringRefusal;
    const postureRefusal = await refuseUngrantedActivationWrite(deps, context, ACTION_ACTIVATION_SUBJECT);
    if (postureRefusal) return postureRefusal;

    // The shape, refused with the shape named. `parts` is
    // `['_activation', object, action]` — the object segment is mandatory even
    // for an object-less action, which spells it `global` exactly as the
    // invocation door does (#3913).
    if (parts.length !== 3 || !parts[1] || !parts[2]) {
        return {
            handled: true,
            response: deps.error(
                'Path must be /actions/_activation/:object/:action (use `global` for an object-less action)',
                400,
            ),
        };
    }
    const objectName = parts[1];
    const actionName = parts[2];

    // ── 2. body ─────────────────────────────────────────────────────────────
    // Built through the shared `validationFailure` constructor and its own
    // `details` reader, so this door's 400s carry the same `VALIDATION_FAILED`
    // envelope and `fields[]` shape as every other one — ⛔ never a hand-rolled
    // details literal that agrees with them by eye (#3878/#3899).
    const invalidBody = (
        message: string,
        fields: Array<{ field: string; code: string; message: string }>,
    ): HttpDispatcherResult => ({
        handled: true,
        response: deps.error(message, VALIDATION_FAILED_STATUS, validationFailureDetails(validationFailure(message, fields))),
    });

    const toggleBody = body ?? {};
    if (typeof toggleBody !== 'object' || Array.isArray(toggleBody)) {
        return invalidBody('Invalid activation body — expected { enabled?: boolean }', [
            { field: '(body)', code: 'invalid_type', message: 'expected an object' },
        ]);
    }
    const unknownKeys = Object.keys(toggleBody).filter((k) => k !== 'enabled');
    if (unknownKeys.length > 0) {
        return invalidBody(
            `Unknown key${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map((k) => `\`${k}\``).join(', ')} — the activation body is { enabled?: boolean }`,
            // `unknown_field` — the ADR-0114 catalog member for "a key the
            // target does not declare".
            unknownKeys.map((k) => ({
                field: k,
                code: 'unknown_field',
                message: 'not an activation field — did you mean `enabled`?',
            })),
        );
    }
    if ('enabled' in toggleBody && typeof (toggleBody as Record<string, unknown>).enabled !== 'boolean') {
        return invalidBody('`enabled` must be a boolean (JSON true/false, not a string)', [
            { field: 'enabled', code: 'invalid_type', message: 'expected a boolean' },
        ]);
    }
    const enabled = (toggleBody as { enabled?: boolean }).enabled ?? true;

    // ── 3. declaration ──────────────────────────────────────────────────────
    const declaration = await actionExec.resolveRouteActionDeclaration(deps, context, {
        ql,
        objectName,
        actionName,
        envId: context?.environmentId,
    });
    if (declaration.degraded) {
        return {
            handled: true,
            response: deps.error(
                `Cannot verify the declaration for action '${actionName}' on '${objectName}' — the metadata plane is ` +
                `unavailable (${declaration.reason ?? 'unknown failure'}). Refusing rather than writing an activation ` +
                `row for an action nobody can confirm exists.`,
                503,
            ),
        };
    }
    if (!declaration.action) {
        return {
            handled: true,
            response: deps.error(
                `Action '${actionName}' on '${objectName}' has no declaration — there is nothing to switch ` +
                `${enabled ? 'on' : 'off'}. The activation ledger addresses DECLARED actions (ADR-0126 §4).`,
                404,
            ),
        };
    }

    // ── 4. ambiguity ────────────────────────────────────────────────────────
    const ambiguity = await refuseAmbiguousActionActivation(deps, context, actionName, objectName);
    if (ambiguity) return ambiguity;

    // ── 5. the durable write ────────────────────────────────────────────────
    const packageId = String(
        (declaration.action as { _packageId?: unknown })?._packageId ??
        (declaration.obj as { _packageId?: unknown } | undefined)?._packageId ??
        '',
    );
    if (typeof ql.setActionActive !== 'function') {
        // An engine too old to carry the projection cannot make this durable,
        // and a 200 here would report a switch that never existed.
        return {
            handled: true,
            response: deps.error(
                `This deployment's data engine does not implement the packaged-metadata activation ledger ` +
                `(ADR-0126 §8), so a packaged action cannot be switched off here.`,
                501,
            ),
        };
    }
    try {
        await ql.setActionActive({ name: actionName, packageId, active: enabled });
    } catch (err: any) {
        // The engine declares its own class for the one refusal it raises (no
        // ledger attached → 503 SERVICE_UNAVAILABLE); anything else is a store
        // failure, and a failed write must never read as a successful flip.
        const status = typeof err?.status === 'number' ? err.status : 503;
        const code = typeof err?.code === 'string' ? err.code : 'SERVICE_UNAVAILABLE';
        return {
            handled: true,
            response: deps.error(err?.message ?? String(err), status, { code }),
        };
    }
    return { handled: true, response: deps.success({ name: actionName, objectName, enabled }) };
}

/**
 * [ADR-0126 §4] Refuse a flip whose NAME does not identify one action.
 *
 * The ledger's row identity is `(metadata_type, name, organization_id)` — one
 * row per machine name — and ADR-0110 D1 says the same about actions: identity
 * is the declarative `name`. Two objects may nevertheless declare the same
 * action name, and then one row would address both. The three ways out were
 * weighed and only this one is honest:
 *
 *   - encoding `<object>:<name>` into the `name` column puts two facts in a
 *     column declared to hold one, and the ADR is explicit that a new dimension
 *     is an ADDITIVE column later, never a smuggled encoding (§4, §5);
 *   - disabling both is a silent cross-artifact effect — the class of failure
 *     this whole regime exists to close;
 *   - refusing names the conflict at the moment of the attempt, which is the
 *     posture §5 already prescribes for the per-org case ("refuses loudly at
 *     the moment of the attempt, naming the trigger type — never a silent
 *     fallback").
 *
 * Measured before choosing: name collisions across objects are rare in the
 * platform's own catalog, so this refuses an edge case rather than the common
 * path. `RESOURCE_CONFLICT` is the standard-catalog member for it — ⛔ no new
 * error code is minted for a case that already has one.
 *
 * Best-effort by construction: the collection needs a metadata service, and a
 * deployment without one cannot enumerate declarations at all. It then flips
 * the row the caller asked for rather than inventing a conflict — the same
 * posture `resolveActionByName` takes when it cannot see a second declaration.
 */
async function refuseAmbiguousActionActivation(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    actionName: string,
    objectName: string,
): Promise<HttpDispatcherResult | undefined> {
    let declarations: Array<{ action: any; objectName: string }> = [];
    try {
        const meta = await deps.resolveService(context, 'metadata', context?.environmentId);
        if (!meta) return undefined;
        declarations = await actionExec.collectActionDeclarations(deps, meta);
    } catch {
        return undefined; // cannot enumerate → no conflict can be asserted
    }
    const owners = [...new Set(
        declarations.filter((d) => d.action?.name === actionName).map((d) => d.objectName),
    )];
    if (owners.length < 2) return undefined;

    return {
        handled: true,
        response: deps.error(
            `Action '${actionName}' is declared on ${owners.length} objects (${owners.map((o) => `'${o}'`).join(', ')}), ` +
            `and the activation ledger addresses an action by its machine name (ADR-0126 §4) — one row would switch ` +
            `every one of them, not just the one on '${objectName}'. Refusing rather than changing artifacts you did ` +
            `not name. Give the actions distinct machine names, or leave them armed.`,
            409,
            { code: 'RESOURCE_CONFLICT' },
        ),
    };
}

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
 *  - `POST /actions/global/:action`               — object-less ("global") action
 *  - `POST /actions//:action`                     — object-less action, empty segment
 *
 * Body shape: `{ recordId?: string, params?: Record<string, unknown> }`.
 * The handler is invoked with an `ActionContext` of:
 *   `{ record, user, session, engine, api, params }`
 * where `engine` exposes the slimmed CRUD surface used by CRM handlers
 * (`insert`, `update`, `delete`, `find`) and `api` is the ScopedContext a
 * sandboxed body reaches through `ctx.api.object(...)`. Both are bound to the
 * caller's ExecutionContext elevated with `isSystem` (#3914).
 *
 * Dispatch follows the DECLARED action type (#3915):
 *  - `script` (and any action with no resolvable declaration, which is
 *    handler-only by definition) → the registered handler, as before;
 *  - `flow` → `automation.execute(action.target, …)` with the caller's
 *    identity forwarded, so `runAs: 'user'` enforces RLS as the invoker;
 *  - `url` / `modal` / `form` / `api` → 400. They dispatch on `target` in the
 *    client (or at another endpoint entirely) and have no server dispatch
 *    here; saying so beats the registry's `not found`.
 *
 * A `flow` action is NOT trusted-elevated: the flow engine receives the
 * caller's identity and honours `runAs` (ADR-0049). The `isSystem` elevation
 * above is a script-BODY property only.
 */
export async function handleActionsRequest(deps: DomainHandlerDeps, path: string, method: string, body: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    // [#5519] ANONYMOUS BASELINE — first, before anything dispatches.
    //
    // ADR-0056 D2 / #3963 made "anonymous access is always denied" a platform
    // promise, and `/data`, `/meta`, `/ai` and `/security` each honour it with
    // this one shared decision. `/actions` did not, and it is the surface where
    // the omission costs most: a `script` action's body runs with
    // `buildActionExecutionContext` forcing `isSystem: true`, so an
    // unauthenticated POST bought an RLS/FLS-bypassing SYSTEM write. The only
    // gate ahead of it was ADR-0066 D4's `actionPermissionError`, which returns
    // `null` — allow — for every action that declares no `requiredPermissions`,
    // i.e. for the overwhelming majority of authored actions.
    //
    // Deliberately the FIRST statement, ahead of the 405: an anonymous caller
    // learns the auth baseline and nothing about the route's shape, exactly as
    // `/data` answers. The finer-grained gates below are unchanged and still
    // run for everyone who clears this one — this adds a floor, it does not
    // replace `requiredPermissions`.
    //
    // Who still passes: any resolved `userId` (a session, an API key, an OAuth
    // principal — `resolveExecutionContext` writes them all), and any internal
    // `isSystem` context. `isSystem` is never settable from the wire; internal
    // callers (flow `call action` nodes, the MCP `run_action` bridge, the
    // declarative endpoint executor) do not route through this HTTP handler at
    // all — they reach `action-execution.ts` / the automation service directly,
    // so this gate cannot see them.
    {
        const gateEc: any = _context?.executionContext;
        if (shouldDenyAnonymous({ userId: gateEc?.userId, isSystem: gateEc?.isSystem, method })) {
            return {
                handled: true,
                response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
            };
        }
    }
    if (method.toUpperCase() !== 'POST') {
        return { handled: true, response: deps.error('Method not allowed', 405) };
    }
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 1) {
        return { handled: true, response: deps.error('Path must be /actions/:object/:action', 400) };
    }
    // A single segment is an OBJECT-LESS action (#3913): `POST /actions//log_call`
    // is what an SDK that has no object to name emits, and `filter(Boolean)`
    // already ate the empty segment. Route it at the canonical `'global'` key
    // rather than 400-ing — before this it was the one global-action shape that
    // could never work, and `/actions/global/log_call` only worked by accident
    // (the literal path segment happened to match the registration key).
    const objectName = parts.length > 1 ? parts[0] : actionExec.GLOBAL_ACTION_OBJECT_KEY;
    const actionName = parts.length > 1 ? parts[1] : parts[0];
    const recordIdFromPath = parts.length > 1 ? parts[2] : undefined;

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

    // [#4127] Same as the
    // action-execution site: `executeAction` is outside IDataEngine, and
    // ObjectQL's wider surface has no contract yet.
    const ql: any = projectQl ?? await deps.getObjectQL(_context, _context?.environmentId);
    if (!ql || typeof ql.executeAction !== 'function') {
        return { handled: true, response: deps.error('Data engine not available', 503) };
    }

    // [ADR-0126 §8 item 2] THE ACTIVATION WRITE DOOR — enable/disable one
    // packaged action, which is a `sys_metadata_activation` row and nothing
    // else. Answered before the invocation path derives an object/action pair,
    // so `_activation` can never be read as a name (it cannot BE one — see the
    // predicate above).
    //
    // Placed after the engine resolution rather than ahead of it, unlike
    // `/automation`'s gates: what sits above is the SAME "data engine not
    // available" answer every caller of this domain already gets, so it
    // fingerprints nothing an unentitled caller could not learn by invoking any
    // action at all. Everything that IS an oracle — the body contract, whether
    // a given action is declared here, whether it is switched off — stays
    // behind the two gates inside.
    if (isActionActivationWrite(parts, method.toUpperCase())) {
        return handleActionActivationWrite(deps, ql, parts, body, _context);
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
    {
        // Standalone declarations (ObjectQL registry artifacts / Studio-
        // authored `action` rows) resolve here too, so a route whose action
        // never appears inside an object definition is gated and dispatched
        // like any other (#3915).
        const declaration = await actionExec.resolveRouteActionDeclaration(deps, _context, {
            ql,
            objectName,
            actionName,
            envId: _context?.environmentId,
        });
        actionSchema = declaration?.obj;
        actionDef = declaration?.action;

        // [ADR-0110 D3] Resolution is a TRICHOTOMY, and only one branch may
        // dispatch. This block used to be a `try { … } catch { /* no gate to
        // enforce */ }`, which collapsed three states with opposite meanings
        // into one fail-open path: a declaration that resolved, a metadata
        // plane that could not answer, and an action that genuinely has no
        // declaration all arrived as "ungated, run it".
        //
        // ── 2/3: the metadata plane could not answer ──
        // An availability failure is not an authorization decision. Refusing
        // is the same posture v17 already takes for a datasource that cannot
        // connect (#3741) and a flow run with no trigger user (#3760): decline
        // rather than degrade, because the alternative is that an outage
        // quietly removes the gate an author declared.
        if (declaration.degraded) {
            return {
                handled: true,
                response: deps.error(
                    `Cannot verify the declaration for action '${actionName}' on '${objectName}' — ` +
                    `the metadata plane is unavailable (${declaration.reason ?? 'unknown failure'}). ` +
                    `Refusing rather than running it ungated.`,
                    503,
                ),
            };
        }

        // ── 3/3: genuinely undeclared ──
        // A handler with no declaration is invisible to every governance
        // surface — ADR-0066 D4 has no `requiredPermissions` to read, ADR-0104
        // no param contract, ADR-0109 materialises no `action_<name>` tool —
        // yet it executes TRUSTED. Refuse, and say what to add.
        //
        // There is no opt-out. An earlier draft shipped
        // `OS_ALLOW_UNDECLARED_ACTIONS` as a migration valve slated for removal
        // in 18; it was dropped before 17 went out. A flag that runs an
        // ungoverned handler IS the fail-open this ruling exists to close, so
        // keeping one would have preserved the hole in configurable form —
        // and a reconciliation sweep found the platform, every package and
        // every example carry zero undeclared handlers, so it would have
        // shipped a documented way to reopen the gate for a population nobody
        // has ever observed. The boot inventory (D5) names the offenders and
        // the 404 below names the fix, which is the whole migration path.
        if (!actionDef) {
            return {
                handled: true,
                response: deps.error(
                    `Action '${actionName}' on '${objectName}' has no declaration — ` +
                    `add \`defineAction({ name: '${actionName}', … })\`, or register the handler under a ` +
                    `declared action's \`target\`. Undeclared handlers cannot be permission-gated ` +
                    `(ADR-0110 D3); startup logs every one of them under [action-governance].`,
                    404,
                ),
            };
        }

        // ── 1/3: declared → gate against it ──
        const gateError = actionExec.actionPermissionError(deps, actionDef, _context?.executionContext, objectName);
        if (gateError) {
            return { handled: true, response: deps.error(gateError, 403) };
        }

        // [ADR-0126 §8 item 2] ACTIVATION CONSULT — door 1 of 2 (the MCP
        // `run_action` bridge is the other; see `disabledActionRefusal`, which
        // both call, for why the consult sits at the DECLARATION and not at
        // the handler-key seam below).
        //
        // Deliberately AFTER the D4 capability gate — an unentitled caller must
        // not learn which packaged actions this installation switched off — and
        // BEFORE the type branch, the param contract and the record load: a
        // disabled action runs nothing, discloses no param shape, and reads no
        // record. It applies to every declared type, so a `flow` action is
        // refused by its OWN switch regardless of what its target flow's
        // ledger row says.
        const activationRefusal = actionExec.disabledActionRefusal(deps, ql, actionDef);
        if (activationRefusal) {
            return {
                handled: true,
                response: deps.error(activationRefusal.message, activationRefusal.status, {
                    code: activationRefusal.code,
                }),
            };
        }
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
    if (actionType === 'flow' && !(await actionExec.resolveAutomationService(deps, _context, _context?.environmentId))) {
        return { handled: true, response: deps.error(actionExec.flowActionUnavailableError(actionDef), 503) };
    }

    const reqBody = body && typeof body === 'object' ? body : {};
    const recordId = recordIdFromPath ?? reqBody.recordId;
    const reqParams = (reqBody.params && typeof reqBody.params === 'object') ? reqBody.params : {};

    // [ADR-0104 D2] Enforce the declared param contract before the handler
    // runs — required/option/multiple/reference-id shape + unknown keys.
    // Strict by default (#3438); OS_ALLOW_LAX_ACTION_PARAMS=1 warns instead.
    const paramError = actionExec.enforceActionParams(deps, actionDef, actionSchema, reqParams, { objectName, actionName });
    if (paramError) {
        return { handled: true, response: deps.error(paramError, 400) };
    }

    // Load the record (best-effort) so handlers can rely on `ctx.record`.
    let record: Record<string, unknown> = {};
    if (recordId && !actionExec.isObjectLessActionKey(objectName)) {
        try {
            const got = await actionExec.callData(deps, _context, 'get', { object: objectName, id: recordId }, _context.dataDriver, _context.environmentId, _context.executionContext);
            if (got?.record) record = got.record;
        } catch { /* record may not exist for new-record actions; pass empty */ }
    }
    if (record && (record as any).id == null && recordId) (record as any).id = recordId;

    // Resolve the caller identity from the request's ExecutionContext — the
    // single source `dispatch()` populates via `resolveExecutionContext`,
    // the same envelope the MCP `runAction` and record-change trigger paths
    // read. The action body sandbox receives the operator's id and business
    // roles (ADR-0090 `positions`, formerly `roles`) so a handler can branch
    // on identity and enforce ownership. Falls back to a `system` principal
    // only for a genuinely anonymous / self-invoked call (#2701).
    //
    // [#5372] The SHAPE is built by the one shared producer
    // (`security/actor-user.ts`) that the MCP `run_action` and AI-route paths
    // also use — three hand-rolled literals had drifted into three different
    // user shapes. `name` in particular was hardcoded to `ec.userId` here: a
    // declared key delivering a plausible WRONG value, which no consumer-side
    // fallback can detect. It now carries `sys_user.name`, resolved once per
    // request (falling back to the id, quietly, when there is none).
    // `organizationId` remains the blessed developer-facing name for the
    // caller's active org (matches columns + `current_user.organizationId`);
    // the deprecated `tenantId` alias (#3280) was removed in v16 (#3290).
    const ec: any = _context?.executionContext;
    const userFromAuth = actorUserFromExecutionContext(
        ec,
        await resolveActorDisplayName(() => ql, ec),
    );

    const actionContext: any = {
        record,
        user: userFromAuth,
        session: actionExec.buildActionSession(deps, ec),
        // Slim engine facade matching the ActionContext.engine shape used by
        // CRM handlers. ⚠️ TRUSTED — system-elevated, RLS/FLS-bypassing by
        // design; see buildActionEngineFacade + buildActionExecutionContext
        // for the full security-model rationale (#2849, #3914).
        engine: actionExec.buildActionEngineFacade(deps, ql, ec),
        // [#3914] `ctx.api` — the ScopedContext a body's `ctx.api.object(...)`
        // resolves to. Absent here, the sandbox synthesized a context-less
        // facade and every owner-scoped write died FORBIDDEN. `executionContext`
        // is the same envelope, carried so the sandbox's own last-resort facade
        // is elevated identically instead of falling back to no identity.
        api: actionExec.buildActionApi(deps, ql, ec),
        executionContext: actionExec.buildActionExecutionContext(ec),
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
            let result: any;
            try {
                result = await actionExec.dispatchFlowAction(deps, _context, actionDef, {
                    objectName,
                    record,
                    params: reqParams,
                    recordId,
                    ec,
                    envId: _context?.environmentId,
                });
            } catch (err) {
                // [#9585] The typed refusal carrier, recognised BEFORE the
                // generic catch below (maintainer ruling, Option B): a flow
                // that RAN and failed carries the author's `errorMessage` and
                // the run `summary`, and they ride `error.details` here
                // exactly as the trigger door ships them
                // (`domains/automation.ts`) — same exit, same field names, so
                // objectui's `flowResponse.ts` reads both doors identically.
                // `details.code` is promoted into `error.code` by the shared
                // envelope builder (`error-envelope.ts`), never duplicated.
                //
                // Everything else — the never-dispatched rows (404/409/422),
                // the unclassified residual, a crashed handler — rethrows to
                // the generic catch unchanged: this branch adds ONE recognised
                // shape at ONE door, it does not restructure the catch, and
                // the shared `resolveThrownHttpError` stays the rule for every
                // other thrower (#8016 / #9106 — its closed `details` list is
                // deliberate, not a gap this branch works around).
                if (actionExec.isFlowActionRefusal(err)) {
                    return {
                        handled: true,
                        response: deps.error(err.message, err.status, { code: err.code, ...err.runDetails }),
                    };
                }
                throw err;
            }
            // [#3962] Single wrap: `data` is the handler's return value, exactly as
            // every other domain serializes. The former inner `{success, data}`
            // envelope existed only to carry a failure signal at HTTP 200; failures
            // carry a status now, so the extra layer lost its job.
            return { handled: true, response: deps.success(result) };
        }

        // [#2849] Same trusted-mode elevation as the MCP path — keep it audible.
        // [#3914] Wording tracks what the body ACTUALLY gets — a system-elevated
        // context carrying the caller's identity, not a context-less engine.
        console.info(
            `[action-audit] REST action '${objectName}/${actionName}' — body executes TRUSTED ` +
            `(system-elevated context, RLS/FLS-bypassing) for user '${userFromAuth.id}'`,
        );

        // ── script/body dispatch ── [ADR-0110 D2] "resolve, then address":
        // the handler KEY is derived from the resolved declaration, not read
        // off the URL. `app-plugin.ts` registers a body action under `name`
        // while user code registers a target-bound one under `target`, so the
        // URL segment matches the registration key only by luck — which is why
        // the documented `/actions/todo_task/complete_task` curl used to 404
        // for every target-bound action. The candidate keys rotate across the
        // object-key rotation (#3913) inside the shared helper the MCP
        // `run_action` bridge also calls, so both surfaces address handlers
        // identically. The routed URL segment stays as the last candidate for
        // an UNDECLARED action, which has no declaration to derive from.
        const dispatch = await actionExec.executeRegisteredAction(
            deps, ql, objectName,
            actionExec.resolveActionHandlerKeys(actionDef, actionName),
            actionContext,
        );
        const result = dispatch.result;
        if (!dispatch.dispatched) {
            // No key carried a handler. That is a routing miss, not a server
            // fault — 404, and named after the ROUTED object rather than
            // whichever probe happened to run last (the old fallback reported
            // `on object '*'`, an object the caller never asked for).
            return {
                handled: true,
                response: deps.error(`Action '${actionName}' on object '${objectName}' not found`, 404),
            };
        }
        // [#11519] Doubled post-success navigation — the handler returned
        // `redirectUrl` while the declaration carries `onSuccess`. The one
        // seam holding both channels; observe LOUDLY, never rewrite the wire
        // (the interim renderer precedence, declared wins per objectui#5933,
        // stays the decider until the author takes the remedy).
        const doubled = actionExec.doubledPostSuccessNavigationWarning(deps, actionDef, result, objectName);
        if (doubled) console.warn(doubled);
        // [#3962] Single wrap: `data` is the handler's return value, exactly as
        // every other domain serializes. The former inner `{success, data}`
        // envelope existed only to carry a failure signal at HTTP 200; failures
        // carry a status now, so the extra layer lost its job.
        return { handled: true, response: deps.success(result) };
    } catch (err: any) {
        const full = err?.message ?? String(err);
        // The sandbox wraps a user throw as `<kind> '<name>' threw: <msg>` for
        // server logs; surface only the business `<msg>` (SandboxError.innerMessage)
        // to the client so an action's error toast reads as plain text instead of
        // leaking the debug prefix. Keep the full wrapper in the log for debugging.
        const inner: unknown = err?.innerMessage;
        const clientMsg = (typeof inner === 'string' && inner) ? inner : full;
        if (clientMsg !== full) {
            console.error(`[action ${objectName}/${actionName}] ${full}`);
            // Every exit below reads `.message`; hand it the client-safe text so
            // the debug wrapper stays in the log and off the wire.
            try { err.message = clientMsg; } catch { /* frozen error */ }
        }
        const code: unknown = err?.code;
        const fields: unknown = err?.fields;

        // An error that NAMES its own HTTP status is asking to be served with
        // it — a plugin's `FORBIDDEN` (status 403), a domain error from the
        // protocol layer. Honour that first: burying an explicit 403 in a 200
        // payload discards the one thing the thrower was unambiguous about.
        // Safe against #3937's cases by construction — a record
        // `ValidationError` deliberately carries no `.status` (see
        // `validation-failure.ts`), so it never reaches this branch.
        if (typeof err?.status === 'number' || typeof err?.statusCode === 'number') {
            return { handled: true, response: deps.errorFromThrown(err, 500) };
        }

        // [#3913 follow-up] …and it does not cover an UNEXPECTED FAULT either.
        // "A failed action is a normal outcome" is a statement about the action
        // REJECTING — a business rule saying no. A `TypeError` in a handler, a
        // driver that blew up: those are not outcomes the action chose to
        // report, they are the server failing to produce one. Reporting them as
        // 200 makes them invisible to every layer that exists to catch server
        // faults — gateway error rates, retry/circuit-breaker policy, APM
        // auto-capture, alerting — so "customer action bodies are throwing" has
        // no signal short of body-parsing at every hop.
        //
        // Told apart by the error's NAME, the same signal `@objectstack/rest`
        // uses on this exact distinction. [#7543] That citation used to quote
        // rest's comment for the EVIDENCE while the two exits drew opposite
        // conclusions from it: rest read a non-default name as "a genuine script
        // bug" and then shipped it to the client as a 400 anyway. It no longer
        // does — `mapDataError`'s `isScriptFaultMessage` now answers the
        // sanitised `500 INTERNAL_ERROR` this branch has answered since #3913,
        // so the two exits agree on the reading as well as the signal:
        //
        //   name === 'Error'        a deliberate `throw new Error(msg)` — the
        //                           shape a registered handler uses to reject.
        //   innerMessage present    the sandbox's mark for "user code threw
        //                           this deliberately" (SandboxError).
        //   code / fields present   a structured domain failure — the
        //                           ValidationError shape #3937 carries out.
        //   a ValidationError       matched by `validationFailureDetails`, the
        //                           same predicate the dispatcher's error exits
        //                           use, so one whose `fields` were stripped in
        //                           transit is still recognised by NAME alone.
        //   name absent             an unrecognisable throw; treated as a
        //                           rejection (the caller-fault reading), not
        //                           a server fault.
        //   any other name          TypeError / ReferenceError / SqliteError /
        //                           a driver's own class ⇒ a fault.
        //
        // `errorFromThrown` is the same exit every other domain catch has used
        // since #3925, and an error carrying its own `.status` still wins there
        // so a hand-thrown 4xx keeps it.
        const name: unknown = err?.name;
        const unexpectedFault =
            typeof name === 'string'
            && name !== 'Error'
            && !(typeof inner === 'string' && inner)
            && !(typeof code === 'string' && code)
            && !Array.isArray(fields)
            && !validationFailureDetails(err);
        if (unexpectedFault) {
            console.error(`[action ${objectName}/${actionName}] unexpected fault (${name}): ${full}`);
            return { handled: true, response: deps.errorFromThrown(err, 500) };
        }

        // [#3962] A deliberate REJECTION is a 400. The 200-with-inner-envelope
        // wire this used to emit was never a designed contract — no ADR or doc
        // specified it, it was the catch block reusing `deps.success()`, and
        // /actions was the only route of 12 that double-wrapped. The platform
        // decision in #3962 classifies it as a bug: failures speak HTTP, same
        // as /data has always done. `errorFromThrown` carries the structured
        // payload #3937 fought for — `VALIDATION_FAILED` + `fields[]` land in
        // `details`, the exact shape @objectstack/client normalizes to
        // `err.code` / `err.fields` (#3927).
        return { handled: true, response: deps.errorFromThrown(err, 400) };
    }
}
