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
import { readNamespacePositionSegment } from '@objectstack/spec/kernel';
// [ADR-0029 D9.6] The ONE "does a code package ship this?" reading, which the
// activation write below asks to name the ledger row's package.
import { isCodeArtifactBody, isTenantAuthored } from '@objectstack/metadata-core';
import * as actionExec from '../action-execution.js';
// The ONE admitted sequence every action door shares (the REST door, the MCP
// `run_action` bridge, a host's `dispatchAction`): everything after the
// resolution prelude.
import {
    refuseDispatchToDisabledObject,
    requestContextWiring,
    resolveRoutedActionDeclaration,
    runResolvedActionAsRest,
} from '../action-dispatch.js';
import { buildApiError } from '../error-envelope.js';
// [ADR-0126 §5] The shared activation write-authority gates — the same two
// tiers `/automation`'s toggle door passes, one implementation.
import {
    refuseUngrantedActivationWrite,
    refuseUngrantedActivationAuthoring,
    readActivationBody,
    activationWriteContext,
    ACTION_ACTIVATION_SUBJECT,
} from './activation-gate.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import { readDispatchedBody } from '../deferred-request-body.js';

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

/**
 * The one method this domain serves, on every path it claims — invocation and
 * the activation door alike: the `Allow` value of its 405.
 */
const ACTIONS_ALLOWED_METHODS = 'POST';

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
 *  1. **Both authority gates, first.** `manage_metadata` (commit 266436a7f: switching a
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
 *     touching its projection. The row names the package that ships the
 *     action, and no package when none does ({@link shippingPackageOf}).
 *
 * ⛔ It does not require the action to be PACKAGED. An action the environment
 * authored through the metadata door is switched exactly like a shipped one,
 * and its row names no package. The flow toggle draws the other line — it
 * refuses a flow no package ships — because such a flow has a server-side
 * switch of its own, its definition's `status`. An action has none: `visible`
 * and `disabled` are rendering predicates that no dispatch door reads, so the
 * ledger row is the only switch an environment-authored action has. The row
 * is harmless (absence means active, and the row records a real administrator
 * choice), while a provenance test here would refuse the flip for anything the
 * registry cannot classify — failing closed on the wrong axis.
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

    // [ADR-0150 D5] A deeper path is no route of this door, and is declined
    // AFTER the two gates above (a gate narrower than its route is a bypass),
    // so the dispatcher answers its no-route `404 ROUTE_NOT_FOUND`. Before G1
    // a mounted host answered the transport's unmatched 404 without reaching
    // this domain, and a catch-all host got this door's shape 400 here.
    if (parts.length > 3) return { handled: false };
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
    // The one activation body reader every `_activation` door shares, so this
    // door's 400s carry the same `VALIDATION_FAILED` envelope and `fields[]`
    // shape as every other one (#3878/#3899).
    const bodyReading = readActivationBody(deps, body);
    if (bodyReading.refusal) return bodyReading.refusal;
    const enabled = bodyReading.enabled;

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

    // ── 3b. switchability (#27506) ──────────────────────────────────────────
    // An api action whose `target` is on ANOTHER origin has no dispatch on
    // this server, so a ledger row for it would be a switch nothing consults.
    // Refused in both directions — there is nothing to switch on either.
    const unswitchable = actionExec.offOriginApiActivationRefusal(declaration.action, objectName);
    if (unswitchable) return { handled: true, response: deps.error(unswitchable, 409) };

    // ── 4. ambiguity ────────────────────────────────────────────────────────
    const ambiguity = await refuseAmbiguousActionActivation(deps, context, actionName, objectName);
    if (ambiguity) return ambiguity;

    // ── 5. the durable write ────────────────────────────────────────────────
    const packageId = shippingPackageOf(declaration);
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
        // An action no package ships carries NO package key: absent is the
        // ledger's one spelling for it, and the store writes `null`. The write
        // runs for the caller, elevated, so the row and its audit row name the
        // administrator who switched the action (`activationWriteContext`).
        await ql.setActionActive(
            {
                name: actionName,
                ...(packageId !== undefined ? { packageId } : {}),
                active: enabled,
            },
            { context: activationWriteContext(context) },
        );
    } catch (err: unknown) {
        // A failed write must never read as a successful flip, and its code and
        // status must say the same thing (ADR-0112). The one shared rule
        // decides both (`resolveThrownHttpError`): the engine's own refusal
        // keeps its pair (no ledger attached: 503 SERVICE_UNAVAILABLE), a
        // record validation refusal is 400 VALIDATION_FAILED, and anything that
        // declares no status is a store failure, 503 SERVICE_UNAVAILABLE.
        return { handled: true, response: deps.errorFromThrown(err, 503) };
    }
    return { handled: true, response: deps.success({ name: actionName, objectName, enabled }) };
}

/**
 * [ADR-0126 §4] The package that SHIPS a resolved action declaration — the
 * ledger row's `package_id` — or `undefined` when no package does.
 *
 * Asked through the one "does a code package ship this?" reading,
 * `isCodeArtifactBody` (ADR-0029 D9.6: a real `_packageId`, not the
 * `'sys_metadata'` sentinel a package-less row carries, and not tenant
 * provenance), never through a bare `_packageId` read:
 *
 *   - the action's own package, when the action is a code artifact;
 *   - for an action declared INSIDE its object's `actions`, the object's
 *     package when the object is a code artifact. The platform's own objects
 *     ship their actions that way, unstamped (`sys_user`'s `invite_user`,
 *     `sys_approval_request`'s `approval_approve`, …), so their rows keep
 *     naming the package that ships the object;
 *   - otherwise none. ⛔ A STANDALONE action is never credited to its route
 *     object's package: an action the environment saved through the metadata
 *     door and bound to a packaged object is not shipped by that package, and
 *     neither is a tenant-authored action wherever it is declared.
 *
 * "Declared inside" is reference identity with the object's `actions` entry,
 * which is what `resolveRouteActionDeclaration` returns for an embedded action.
 */
function shippingPackageOf(declaration: { action: unknown; obj: unknown }): string | undefined {
    const action = declaration.action as { _packageId?: unknown } | undefined;
    const obj = declaration.obj as { _packageId?: unknown; actions?: unknown } | undefined;
    if (isTenantAuthored(action)) return undefined;
    if (isCodeArtifactBody(action)) return String(action!._packageId);
    const embedded = Array.isArray(obj?.actions) && obj.actions.includes(action);
    if (embedded && isCodeArtifactBody(obj)) return String(obj!._packageId);
    return undefined;
}

/**
 * [ADR-0126 §4] Refuse a flip whose NAME does not identify one action.
 *
 * The ledger's row identity is `(metadata_type, name)` — one row per machine
 * name — and ADR-0110 D1 says the same about actions: identity
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
 * Dispatch follows the DECLARED action type (#3915) — except that `operation`
 * is read BEFORE `type` (#15079, contract point 1 of the #14092 ruling):
 *  - `operation: 'update'` → the DECLARATIVE single-record field write. The
 *    platform performs ONE data-plane update of the current record, under the
 *    CALLER's own identity — ⛔ never the `isSystem` elevation the script arm
 *    below gets, because there is no author body here to trust — so the
 *    object's permissions, hooks and validations fire exactly as for a user
 *    edit. `type` is `'script'` on such an action (this route IS where the
 *    write happens) and carries no handler; see
 *    `actionExec.executeDeclarativeUpdateAction`, which the MCP `run_action`
 *    bridge calls too.
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
    // [#24151] The body is read once the baseline above has admitted the
    // caller, never ahead of it (`../deferred-request-body.ts`).
    body = readDispatchedBody(body);
    if (method.toUpperCase() !== 'POST') {
        // RFC 9110 §15.5.6: a 405 MUST carry an `Allow` header naming the
        // target resource's supported methods. Hand-rolled rather than
        // `deps.error(...)` only for that header, which `deps.error` cannot
        // carry — the shape `domains/mcp.ts`, `domains/meta.ts` and
        // `domains/ai.ts` already answer with. The BODY still goes through the
        // one builder, so its code stays DERIVED from the status
        // (`METHOD_NOT_ALLOWED`) and is not spelled here. Below the anonymous
        // baseline above, which stays this handler's first statement.
        return {
            handled: true,
            response: {
                status: 405,
                headers: { Allow: ACTIONS_ALLOWED_METHODS },
                body: {
                    success: false,
                    error: buildApiError({ message: 'Method not allowed', httpStatus: 405 }),
                },
            },
        };
    }
    let parts = path.split('/').filter(Boolean);
    if (parts.length < 1) {
        return { handled: true, response: deps.error('Path must be /actions/:object/:action', 400) };
    }

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

    // [ADR-0150 D5, epic child G1] THE ADDRESS, read once, before every gate
    // that reads the path: `/actions/:ns/:object/:action[/:recordId]`,
    // `/actions/:ns/global/:action` and the same under `_env`. The segment in
    // the namespace position is read in the router's order
    // (`readNamespacePositionSegment`): a literal (`global`, `_activation`, the
    // empty object-less segment) first, then `_env`, then an installed
    // namespace (the registry's `getNamespaceOwners`), else the bare grammar,
    // unchanged. An addressed path is then the bare path after its qualifier,
    // and the declaration is the qualifier's alone (`addressQualifier`).
    // No object is named like a namespace (ADR-0150 D6), so a bare
    // `/actions/:object/:action/:recordId` never reads as addressed.
    let addressQualifier: actionExec.ActionAddressQualifier | undefined;
    {
        const registry: any = ql?.registry;
        const namespaceOwners = (ns: string): readonly string[] =>
            (typeof registry?.getNamespaceOwners === 'function' ? registry.getNamespaceOwners(ns) ?? [] : []);
        const reading = readNamespacePositionSegment('actions', parts[0], (ns) => namespaceOwners(ns).length > 0);
        if (reading.reading === 'environment' || reading.reading === 'namespace') {
            addressQualifier = reading.reading === 'environment'
                ? { environment: true }
                : { namespace: reading.namespace, namespaceOwners };
            parts = parts.slice(1);
            // An addressed path names an object (or `global`) and an action,
            // and a record id at most: two or three segments after its
            // qualifier, the shapes D5's table publishes. One segment is no
            // shape of it (`/actions/:ns/:action` is not published: the
            // object-less call is `/actions/:ns/global/:action`); more than
            // three are declined below, as the bare arm declines them. The
            // activation write is the environment's ledger door and names its
            // action by `(object, name)`: it has no addressed form.
            if (parts.length < 2 || parts[0] === ACTION_ACTIVATION_SEGMENT) {
                return {
                    handled: true,
                    response: deps.error(
                        'An addressed action path is /actions/:ns/:object/:action[/:recordId] or /actions/:ns/global/:action (ADR-0150 D5)',
                        404,
                    ),
                };
            }
        }
    }
    // [ADR-0150 D5] The grammar ends at three segments, bare or after a
    // qualifier: `/:object/:action/:recordId`. A longer path is no route, and
    // is declined (`handled: false`), so the dispatcher answers its no-route
    // `404 ROUTE_NOT_FOUND` on every host. Before G1 that was not one answer:
    // the dispatcher mounted no four-segment `/actions` pattern, so a mounted
    // host answered the transport's unmatched 404 without reaching this
    // domain, while a catch-all host (`createHonoApp`) handed this domain the
    // path, which read `parts[0..2]` and ran the call with the tail ignored
    // (and a deeper `_activation` path got that door's shape 400). A deeper
    // `_activation` path is declined by its own door, behind its two gates.
    if (parts.length > 3 && parts[0] !== ACTION_ACTIVATION_SEGMENT) return { handled: false };
    // A single segment is an OBJECT-LESS action (#3913): `POST /actions//log_call`
    // is what an SDK that has no object to name emits, and `filter(Boolean)`
    // already ate the empty segment. Route it at the canonical `'global'` key
    // rather than 400-ing — before this it was the one global-action shape that
    // could never work, and `/actions/global/log_call` only worked by accident
    // (the literal path segment happened to match the registration key).
    const objectName = parts.length > 1 ? parts[0] : actionExec.GLOBAL_ACTION_OBJECT_KEY;
    const actionName = parts.length > 1 ? parts[1] : parts[0];
    const recordIdFromPath = parts.length > 1 ? parts[2] : undefined;

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

    // [#25296] AN OBJECT THE DATA PLANE REFUSES HAS NO ACTION THAT MAY RUN.
    // An object whose owning package is disabled stays registered in the
    // engine's schema registry, which the declaration resolution below reads,
    // so its declarations resolved and its handler ran while `/data` refused
    // the object `404 OBJECT_PACKAGE_DISABLED`. Refused here with the
    // protocol's own error, BEFORE the resolution (an addressed call's
    // resolver omits the object, and would answer "not found") and before
    // every gate that reads the declaration.
    try {
        await refuseDispatchToDisabledObject(deps, _context, objectName, _context?.environmentId);
    } catch (err) {
        return { handled: true, response: deps.errorFromThrown(err, 404) };
    }

    // The declaration — standalone declarations (ObjectQL registry artifacts,
    // Studio-authored `action` rows) resolve here too (#3915). [ADR-0150 D5,
    // child G1] An addressed path resolves through the qualifier alone — the
    // namespace's packages, or the environment — by the resolution the MCP
    // `run_action` bridge's qualified call reads.
    const resolution = await resolveRoutedActionDeclaration(deps, _context, {
        ql, objectName, actionName, envId: _context?.environmentId,
        ...(addressQualifier ? { qualifier: addressQualifier } : {}),
    });
    if ('refusedBy' in resolution) {
        return { handled: true, response: deps.errorFromThrown(resolution.refusedBy, 404) };
    }

    // Everything after the resolution is the ONE admitted sequence every door
    // shares (`../action-dispatch.ts`) under the REST posture: the ADR-0110 D3
    // trichotomy, ADR-0066 D4, the ADR-0126 §8 consult, the owner gate, the
    // type and availability checks, the body shape, ADR-0104, the subject load,
    // the dispatch arms and — for a call that cleared the gates — ONE
    // `action_invocation` row naming this door (`surface: 'rest'`, #27908).
    return runResolvedActionAsRest(deps, _context, {
        posture: 'rest',
        door: 'rest',
        objectName,
        actionName,
        declaration: resolution.declaration,
        body,
        ...(recordIdFromPath !== undefined ? { recordIdFromPath } : {}),
        ql,
        wiring: requestContextWiring(deps, _context, ql),
    }, 'rest');
}
