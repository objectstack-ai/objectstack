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
// [#31271] The door's ONE reader of a thrown value (`actionsDoorAnswerOf`),
// which composes the native-error name list (#17681, #17273), the generic
// replacement text and the `/data` door's shared reads, so this door's crash
// reading cannot drift from the `/data` door's. ⛔ Never re-inline its arms.
import { actionsDoorAnswerOf, earnedAnswerOf, staleSummaryAnswerLines, type SummaryRecomputeRefusal } from '@objectstack/types';
// [ADR-0029 D9.6] The ONE "does a code package ship this?" reading, which the
// activation write below asks to name the ledger row's package.
import { isCodeArtifactBody, isTenantAuthored } from '@objectstack/metadata-core';
import * as actionExec from '../action-execution.js';
import {
    actionInvocationBranch,
    actionInvocationForwardedFrom,
    actionInvocationTarget,
    recordActionInvocation,
    withActionSurface,
} from '../action-invocation-audit.js';
import { actorUserFromExecutionContext, resolveActorDisplayName } from '../security/actor-user.js';
import { validationFailure, validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';
// [#25976] The one value-shape check the run doors share — the trigger and
// resume doors ask it of their input too.
import { objectValueFailure } from '../object-value-shape.js';
import { apiErrorResponse, buildApiError } from '../error-envelope.js';
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

    // [#25296] AN OBJECT THE DATA PLANE REFUSES HAS NO ACTION THAT MAY RUN.
    // An object whose owning package is disabled stays registered in the
    // engine's schema registry, which the declaration resolution below reads,
    // so its declarations resolved and its handler ran (a script action
    // answered `200` with the body's result) while `/data` refused the object
    // `404 OBJECT_PACKAGE_DISABLED`, `GET /meta/object` omitted it and the MCP
    // `run_action` tool answered "not found". Refused here with the protocol's
    // own error, before every gate that reads the declaration (D4's 403, the
    // activation ledger's 409, the "no declaration" 404) and before any record
    // load or dispatch: what those gates answer is about an action of an object
    // that is not served. An object-less action names no object to ask about.
    if (!actionExec.isObjectLessActionKey(objectName)) {
        try {
            await actionExec.refuseDisabledPackageObject(deps, _context, objectName, _context?.environmentId);
        } catch (err) {
            return { handled: true, response: deps.errorFromThrown(err, 404) };
        }
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

        // The handler this dispatch reaches may be one a DIFFERENT declared
        // action owns: that owner's `requiredPermissions` and activation switch
        // gate this call too (`actionHandlerOwnerRefusal`, which the MCP
        // `run_action` bridge calls at the same point). The candidates are the
        // ones the script dispatch below hands `executeRegisteredAction`.
        const ownerRefusal = await actionExec.actionHandlerOwnerRefusal(deps, _context, {
            ql,
            action: actionDef,
            objectName,
            candidates: actionExec.resolveActionHandlerKeys(actionDef, actionName),
            ec: _context?.executionContext,
            envId: _context?.environmentId,
            obj: actionSchema,
        });
        if (ownerRefusal) {
            return {
                handled: true,
                response: deps.error(ownerRefusal.message, ownerRefusal.status, { code: ownerRefusal.code }),
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
    //
    // [#15079] `!isDeclarativeUpdateAction` is the last `type`-first read on
    // this door, closed for the same reason as the two predicates: the parsed
    // shape of a declarative update is `type: 'script'`, so this probe cannot
    // fire for it — but data at rest whose `type` contradicts its `operation`
    // would collect a 503 about an automation service the write never needs.
    // `operation` before `type`, without exception.
    if (actionType === 'flow' && !actionExec.isDeclarativeUpdateAction(actionDef)
        && !(await actionExec.resolveAutomationService(deps, _context, _context?.environmentId))) {
        return { handled: true, response: deps.error(actionExec.flowActionUnavailableError(actionDef), 503) };
    }

    // [#25976] The body, and then its params bag, must be objects before the
    // param contract or any handler reads them. These reads used to be
    // `body && typeof body === 'object' ? body : {}` and
    // `params && typeof params === 'object' ? params : {}`, so a JSON string
    // body, an array body and `{"params":"oops"}` all ran the action with an
    // EMPTY bag, and an array `params` was handed on as the bag itself — each
    // answered `200` with a started run, exactly like `{"params":{}}`. Asked
    // through `objectValueFailure`, the check the trigger and resume doors ask
    // too, and answered the way they answer it. `undefined` / `null` stay the
    // legal bodyless call and an absent `params` key keeps its empty bag.
    // Before the param contract, the record load and dispatch: a refused call
    // reads no row and runs nothing.
    const invalidBody = (message: string, failure: { field: string; code: 'invalid_type'; message: string }) => ({
        handled: true,
        response: deps.error(message, VALIDATION_FAILED_STATUS, validationFailureDetails(validationFailure(message, [failure]))),
    });
    const bodyFailure = objectValueFailure('(body)', body ?? {});
    if (bodyFailure) return invalidBody(`Invalid action body — ${bodyFailure.message}`, bodyFailure);
    const reqBody = (body ?? {}) as Record<string, any>;
    const paramsFailure = objectValueFailure('params', reqBody.params);
    if (paramsFailure) return invalidBody(`Invalid action body — \`params\` ${paramsFailure.message}`, paramsFailure);
    const recordId = recordIdFromPath ?? reqBody.recordId;
    // The routed record is named by ONE id, a string or a number: the subject
    // load below reads the row whose `id` equals it, and every branch hands it
    // on as the row's id. Any other value names no one row, so it is refused
    // here, before the param contract, the load and dispatch, with the `400`
    // flow start admission answers for a record key that is not one id at the
    // other doors (`refuseUnreadableFlowStartRecords`). A path segment is
    // always a string; absent, `null` and `''` stay the record-less call.
    if (recordId !== undefined && recordId !== null && recordId !== ''
        && typeof recordId !== 'string' && typeof recordId !== 'number') {
        const message = 'The record key `recordId` must name one record by its id.';
        return invalidBody(`Invalid action body — ${message}`, { field: 'recordId', code: 'invalid_type', message });
    }
    const reqParams: Record<string, unknown> = reqBody.params ?? {};

    // [ADR-0104 D2] Enforce the declared param contract before the handler
    // runs — required/option/multiple/reference-id shape + unknown keys.
    // Strict by default (#3438); OS_ALLOW_LAX_ACTION_PARAMS=1 warns instead.
    const paramError = actionExec.enforceActionParams(deps, actionDef, actionSchema, reqParams, { objectName, actionName });
    if (paramError) {
        return { handled: true, response: deps.error(paramError, 400) };
    }

    // Load the record (best-effort) so handlers can rely on `ctx.record`.
    // [commit f19475c0a] Through the ONE shared producer `loadActionSubjectRecord`, which
    // also reports whether the CALLER's own scope actually delivered the row.
    // This door and the MCP `run_action` door must emit the same signal: a
    // documented guard (`if (ctx.recordLoadDenied) …`) that only one of two
    // doors sets is inert on the other, which is the defect one door over.
    const subject = await actionExec.loadActionSubjectRecord(objectName, recordId, () =>
        actionExec.callData(deps, _context, 'get', { object: objectName, id: recordId }, _context.dataDriver, _context.environmentId, _context.executionContext));
    const record = subject.record;

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

    // [#27908 — ruling 6513869839 on #27681, parameter 3] THE INVOCATION ROW.
    // Every call that cleared the gates above reaches its branch below, and
    // whatever the branch answers — a result, the subject-record 404, a
    // target's refusal, a body's throw mapped by the catch — is answered as
    // ONE response. One `action_invocation` row is written for it, naming this
    // door (`surface: 'rest'`, set from the door's identity on a copy of the
    // caller's envelope; nothing on the request can move it). A call a gate
    // above refused ran nothing and writes no row. See
    // `../action-invocation-audit.ts`.
    const answer = await dispatchAdmittedRestAction(deps, _context, {
        objectName, actionName, actionDef, actionType, subject, record, recordId, reqParams, ql, ec, userFromAuth,
    });
    const answered: any = answer.response;
    const answeredStatus: number = typeof answered?.status === 'number' ? answered.status : 500;
    const answeredOk = answeredStatus >= 200 && answeredStatus < 300;
    const answeredCode: unknown = answered?.body?.error?.code;
    await recordActionInvocation(deps, _context, _context?.environmentId, {
        context: withActionSurface(ec, 'rest'),
        actionName: typeof actionDef?.name === 'string' && actionDef.name ? actionDef.name : actionName,
        objectName: actionExec.isObjectLessActionKey(objectName) ? undefined : objectName,
        recordId: recordId !== undefined && recordId !== null && recordId !== '' ? String(recordId) : undefined,
        branch: actionInvocationBranch(actionDef, actionExec.isDeclarativeUpdateAction(actionDef)),
        outcome: answeredOk ? 'succeeded' : 'failed',
        ...(answeredOk ? {} : { status: answeredStatus }),
        ...(!answeredOk && typeof answeredCode === 'string' ? { errorCode: answeredCode } : {}),
        // An api forward's two rows name each other: this row, as the OUTER
        // door, the declared target; as the INNER door, the forward mark it
        // arrived carrying (a hint — see `../action-invocation-audit.ts`).
        target: actionInvocationTarget(actionDef, actionExec.isDeclarativeUpdateAction(actionDef)),
        forwardedFrom: actionInvocationForwardedFrom(_context, actionExec.API_FORWARD_MARK_HEADER),
    });
    return answer;
}

/**
 * The REST action door's dispatch, once every admission gate in
 * {@link handleActionsRequest} has passed: the declarative update, the
 * subject-record verdict, the api forward, the flow dispatch and the
 * script/body dispatch, with the one catch that maps a thrown refusal to the
 * route's answer. Split out of the handler so the handler can write the
 * invocation row for whatever this answers (#27908); the code is unchanged.
 */
async function dispatchAdmittedRestAction(
    deps: DomainHandlerDeps,
    _context: HttpProtocolContext,
    admitted: {
        objectName: string;
        actionName: string;
        actionDef: any;
        actionType: string;
        subject: actionExec.ActionSubjectRecordLoad;
        record: any;
        recordId: any;
        reqParams: Record<string, unknown>;
        ql: any;
        ec: any;
        userFromAuth: ReturnType<typeof actorUserFromExecutionContext>;
    },
): Promise<HttpDispatcherResult> {
    const { objectName, actionName, actionDef, actionType, subject, record, recordId, reqParams, ql, ec, userFromAuth } = admitted;
    try {
        // ── declarative update ── [#15079] FIRST, ahead of the `type` switch
        // and ahead of the trusted-mode plumbing below. Contract point 1 reads
        // `operation` before `type`; the ordering here is also load-bearing in
        // a second way — the elevated `ctx.api` / `ctx.engine` /
        // `executionContext` an action BODY receives are built below, and an
        // `operation: 'update'` action must never be near them: it has no body
        // to trust, so its write carries the CALLER's identity and nothing
        // else. Inside the `try` so a data-plane refusal (a permission denial,
        // a validation failure, a hook's throw) reaches the ONE catch this door
        // already has, with its `.status` / `.code` honoured — the same exit
        // the flow branch's refusals take.
        if (actionExec.isDeclarativeUpdateAction(actionDef)) {
            const result = await actionExec.executeDeclarativeUpdateAction(deps, actionDef, {
                objectName,
                actionName,
                subject,
                recordId,
                params: reqParams,
                // The caller's own envelope, exactly as `resolveExecutionContext`
                // built it for this request. ⛔ Not `buildActionExecutionContext`.
                ec,
                driver: _context.dataDriver,
                envId: _context?.environmentId,
                requestContext: _context,
                callData: (a, params, dataDriver, scopeId, execCtx) =>
                    actionExec.callData(deps, _context, a, params, dataDriver, scopeId, execCtx),
            });
            return { handled: true, response: deps.success(result) };
        }

        // ── contract point 3: the caller-scope load's VERDICT, consumed ──────
        // [#16370] The same shared refusal the MCP `run_action` bridge calls at
        // the same point in its own sequence — ONE implementation of the rule
        // #15079 wrote into the declarative executor, now read by the flow door
        // and the script/body door as well. A signal only one of three doors
        // consumed is an authorization rule silently inert on the other two,
        // which is the commit f19475c0a / #15168 failure class on this exact seam.
        //
        // Inside the `try`, like the declarative branch above, so the 404 takes
        // the ONE catch this door already has and is served with its `.status` /
        // `.code` intact. Ahead of `actionContext` on purpose: the trusted-mode
        // audit line and the RLS/FLS-bypassing `ctx.engine` / `ctx.api` are
        // built below, and none of them may exist for a caller who has not
        // demonstrated read access to the subject row.
        //
        // [#28657] Except ahead of an api forward that needs nothing from the
        // row: it builds none of that, and its target authorizes the caller
        // itself (ADR-0066 D4), so a denied load forwards and the target's
        // answer is this door's — see `refuseDeniedSubjectLoadBeforeDispatch`.
        // The MCP `run_action` bridge calls the same function at the same point.
        actionExec.refuseDeniedSubjectLoadBeforeDispatch(actionDef, objectName, recordId, subject);

        // ── api forward (#27506, ruling 6499781492) ── a same-origin
        // `type: 'api'` action is forwarded IN-PROCESS to its declared
        // `target`, with the body assembled from the declaration and the
        // caller's own credentials carried across — after every gate above
        // (the 401 floor, D4, the ADR-0126 §8 consult, the param contract, the
        // subject load) and BEFORE the trusted-mode context below, which an
        // api action never receives: the target endpoint authorizes the caller
        // itself (ADR-0066 D4). The MCP `run_action` bridge runs the identical
        // sequence (`invokeBusinessAction`). The target's status and body come
        // back as this door's answer (its `data` unwrapped, as the console's
        // direct fetch did), and a credential rotation it emitted
        // (`Set-Cookie` / `set-auth-token` / `set-admin-session-token`, the
        // impersonation case) is relayed on the response headers.
        if (actionType === 'api') {
            const mark = _context?.request?.headers?.[actionExec.API_FORWARD_MARK_HEADER];
            if (typeof mark === 'string' && mark.length > 0) {
                return { handled: true, response: deps.error(actionExec.apiActionForwardLoopError(actionDef, mark), 400) };
            }
            const inject = await actionExec.resolveInProcessRequest(deps, _context, _context?.environmentId);
            if (!inject) {
                return { handled: true, response: deps.error(actionExec.apiActionForwardUnavailableError(actionDef), 503) };
            }
            // [#28657] On a denied load the request is built from the
            // `recordId` alone — ⛔ never from a row the caller could not read.
            const built = actionExec.buildApiActionRequest(actionDef, {
                recordId, record: actionExec.apiForwardSubjectRecord(recordId, subject), params: reqParams, ec,
            });
            if ('message' in built) {
                return { handled: true, response: deps.error(built.message, built.status) };
            }
            const answer = await actionExec.forwardApiAction(inject, _context, built, { objectName, actionName, target: actionDef?.target, ...(recordId ? { recordId: String(recordId) } : {}) });
            const relayed = Object.keys(answer.headers).length > 0 ? { headers: answer.headers } : {};
            if (answer.status >= 200 && answer.status < 300) {
                return { handled: true, response: { ...deps.success(actionExec.apiActionResultOf(answer)), ...relayed } };
            }
            const refusal = actionExec.apiActionForwardRefusal(actionDef, answer);
            // [#27738] An enveloped refusal is relayed WHOLE: its code and
            // sentence, and every member beside them (`details`, `userMessage`,
            // …) as the target wrote them — see `apiActionRefusalMembers`. Only
            // a refusal the target did not envelope is rebuilt from its code.
            const members = actionExec.apiActionRefusalMembers(answer);
            const refused = members
                ? apiErrorResponse({ message: refusal.message, httpStatus: answer.status, code: (refusal as any).code, extra: members })
                : deps.error(refusal.message, answer.status, { code: (refusal as any).code });
            return { handled: true, response: { ...refused, ...relayed } };
        }

        const actionContext: any = {
            record,
            // [commit f19475c0a] The caller-scope load's verdict — see
            // `loadActionSubjectRecord`. `ctx.record.id` is stamped either way, so
            // this is the only channel that distinguishes "the caller cannot read
            // this row" from "this action legitimately has no record".
            ...actionExec.actionRecordLoadSignal(subject),
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
                    // [#15168] `subject`, not `record` — the shared door derives
                    // the flow context's `record` AND its `recordLoadDenied`
                    // sibling from the same load outcome, so this door and the
                    // MCP one cannot diverge on the signal the way the two
                    // doors diverged before commit f19475c0a.
                    subject,
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
                    // [#24914, ruling B′] `runDetails` now carries the
                    // `innerRefusal` a node's data call met (the declared third
                    // key), and the carrier's producer-marked `userMessage`
                    // goes to the envelope's top level through the deps slot.
                    return {
                        handled: true,
                        response: deps.error(
                            err.message, err.status, { code: err.code, ...err.runDetails },
                            err.userMessage !== undefined ? { userMessage: err.userMessage } : undefined,
                        ),
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
        // [#28856] An action whose write landed under a failing roll-up answers
        // the result the runtime composed and attached (`executeDeclarativeUpdateAction`),
        // as when the recompute succeeds; the stale column is logged once.
        //
        // [#28861] Read on the declarative-update arm only: that arm's refusal
        // carries the ACTION's result. Any other arm's can carry only a WRITE's
        // data answer — a handler that let out a refusal a data door attached
        // its answer to — and the action that threw has no result, so it is
        // answered below as the failure it is. (A handler's own `ctx.engine` /
        // `ctx.api` writes answer a landed write's success and never throw it.)
        const earned = actionExec.isDeclarativeUpdateAction(actionDef) ? earnedAnswerOf(err) : undefined;
        if (earned) {
            const log = deps.logger && typeof deps.logger.error === 'function'
                ? (line: string) => deps.logger.error(`[HttpDispatcher] ${line}`)
                : (line: string) => console.error(`[HttpDispatcher] ${line}`);
            for (const line of staleSummaryAnswerLines(err as SummaryRecomputeRefusal, objectName)) log(line);
            return { handled: true, response: deps.success(earned) };
        }
        // [#31271] Every other throw is answered by this door's ONE reader,
        // `actionsDoorAnswerOf` (`@objectstack/types`), beside the `/data`
        // door's `mapDataError`: the arms this catch used to spell inline
        // (the sandbox wrapper kept off the wire, a sandboxed crash, a
        // declared status, a driver's NOT NULL refusal, an unexpected fault,
        // the 400 rejection), moved there in the same order with their
        // reasons, so the MCP `run_action` / `resume_run` tools answer a throw
        // as this door does instead of re-deriving it. The body is the one
        // this catch built through the dispatcher's `error` / `errorFromThrown`
        // exits, byte for byte; the operator lines are the ones it printed.
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
