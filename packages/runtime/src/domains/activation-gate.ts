// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §5] THE WRITE-AUTHORITY GATE for the packaged-metadata activation
 * switch — shared by every door that writes a `sys_metadata_activation` row.
 *
 * It lived inline in `domains/automation.ts` when flows were the only consumer
 * (#12157). ADR-0126 §8 item 2 then brought actions onto the SAME ledger with
 * the SAME §5 authority, and a second copy of a security gate is two policies
 * that happen to agree today — the shape this repo removes on sight (the
 * `/automation` domain's own `isRunStateRead` comment argues it in as many
 * words). So the gate moved HERE, unchanged in behaviour, and both doors call
 * it. What varies per door is one clause of the refusal SENTENCE, which is
 * data, not logic: see {@link ActivationSubject}.
 *
 * ## What it enforces
 *
 * The activation row these routes write is **deployment-level** (§5): the
 * ledger carries no tenant column, so one row covers one environment and every
 * tenant in it. The authority required to write it scales with that reach:
 *
 *   - **`single` posture** — one logical tenant, so install-level and org-level
 *     are the SAME scope. The org admin who already passed the caller's own
 *     `manage_metadata` gate one tier up is the right authority, and this gate
 *     is inert.
 *   - **`group` / `isolated`** — a real multi-organization deployment. Here the
 *     write requires the PLATFORM OPERATOR, because a tenant org admin flipping
 *     an install-wide switch is precisely #10243: that incident measured a
 *     tenant org owner switching a shipped flow off ENVIRONMENT-WIDE, read back
 *     by an unrelated tenant in a different organization. ADR-0126 §5 makes
 *     that durable in the correct direction — and a durable install-wide row
 *     writable by tenants would be the same leak WITH persistence, which is
 *     strictly worse than what was measured.
 *
 * ## Why the operator test is the POSTURE RUNG and not a capability
 *
 * ADR-0126 §5 says "the platform-operator capability"; the platform's actual
 * operator identity is the ADR-0068 D2 platform operator — "Platform operator
 * (SaaS admin). NOT a tenant user role", unscoped, sourced from the unscoped
 * `admin_full_access` grant. No capability in `PLATFORM_CAPABILITIES` carries
 * that meaning: `manage_metadata` is the one the tier above already requires,
 * and a tenant org admin can hold it — so spelling this gate as a capability
 * check would either re-ask the question already answered or invent a
 * capability name, which would be a `packages/spec` change ADR-0126 §9 walls
 * this family out of.
 *
 * ⛔ [#15981] What this gate reads is the ADR-0095 D2/D3 posture RUNG
 * (`posture === 'PLATFORM_ADMIN'`), NEVER
 * `positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN)`. It used to read the
 * name, on the reasoning above that the built-in position IS "sourced from the
 * unscoped `admin_full_access` grant" — a premise that stopped holding when
 * `positions[]` became the security axis. That array now also carries ADR-0057
 * D4 `sys_user_position` names; `sys_user_position` is `apiEnabled` with
 * unconstrained `position` values, so a tenant could mint a row spelling that
 * very built-in and `resolveUserAuthzGrants` §4 would push it onto the array.
 * The rung is derived from the unscoped-grant evidence and nothing else, so it
 * is what the paragraph above always MEANT — and it is byte-for-byte what
 * `hasPlatformAdminStanding` returns. `resolve-authz-context.ts` states the
 * rule at that predicate; this gate is one of the four sites #15981 found
 * ignoring it.
 *
 * Driven, not argued: with the minted row present, a tenant org admin holding
 * only the org-scoped `manage_metadata` capability flipped the install-wide
 * switch under both walled postures — #10243 again, now with a DURABLE row.
 * See `activation-gate-positions-name-authority.test.ts`.
 *
 * ## Fail-open on an ABSENT posture is deliberate, not a gap
 *
 * No `tenancy` service ⇒ no posture ⇒ no posture-conditional refusal, matching
 * `resolve-execution-context.ts` verbatim. Under ADR-0093 D4/D5 a
 * requested-but-unenforceable wall resolves to `single` anyway, so an absent
 * posture and `single` are the same deployment shape — and refusing there would
 * lock every single-tenant operator out of their own switch.
 */

// [ADR-0126 §5] The gate's two inputs: the deployment's EFFECTIVE tenancy
// posture (the same resolver `resolve-execution-context.ts` uses, so admission
// and this gate can never disagree) and — since #15981 — the caller's ADR-0095
// authorization RUNG off the execution context, which is where "platform
// operator, NOT a tenant user role" (ADR-0068 D2) still means that. The
// built-in identity NAME is deliberately no longer imported: see the doc block.
import { effectiveTenancyPosture, AuthzStoreUnavailableError } from '@objectstack/core';
import { postureEnforcesWall } from '@objectstack/spec/security';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

/** [ADR-0126 §5] Refusal vocabulary for the activation (enable/disable) gates. */
export const ACTIVATION_DENY_STATUS = 403;
export const ACTIVATION_DENY_CODE = 'PERMISSION_DENIED';

/**
 * [ADR-0066 D1 / #10145] The authoring capability every door onto the metadata
 * plane demands — and, since the #10243 ruling, the activation switch too:
 * *"Disabling a shipped flow is functionally equivalent to deleting it for as
 * long as it stays off"*, and `DELETE` already required it. Actions inherit the
 * sentence with one word changed.
 */
export const ACTIVATION_AUTHORING_CAPABILITY = 'manage_metadata';

/**
 * The per-door half of the refusal: WHAT is being switched, and what the
 * refused caller can do instead.
 *
 * `remedy` is a whole sentence rather than a noun because the sanctioned path
 * genuinely differs by artifact and ADR-0126 §7 requires a refusal to name one:
 * a flow can be cloned under a new name (§7.1), while **action-clone is not
 * chartered** (§8 item 2) — recommending one for actions would advertise
 * machinery that does not exist, which is the failure Prime Directive #10 names.
 */
export interface ActivationSubject {
    /** Noun phrase completing "Enabling or disabling …" — e.g. `a packaged flow`. */
    subject: string;
    /** One sentence naming what the refused caller CAN do. */
    remedy: string;
}

/** The flow door's wording (#12157) — byte-identical to what it shipped with. */
export const FLOW_ACTIVATION_SUBJECT: ActivationSubject = {
    subject: 'a packaged flow',
    remedy: 'To customize this flow for your organization, clone it under a new name instead.',
};

/**
 * The action door's wording (ADR-0126 §8 item 2).
 *
 * ⛔ It does NOT recommend a clone. The action-clone half is deliberately
 * unchartered ("it stays on §3's pre-chart discipline until real pull
 * appears"), so the honest alternatives are the operator, and authoring an
 * ordinary sibling action — which Regime C leaves open exactly as today.
 */
export const ACTION_ACTIVATION_SUBJECT: ActivationSubject = {
    subject: 'a packaged action',
    remedy:
        'To switch a packaged action off for this installation, ask your platform operator; authoring your own action ' +
        'alongside it stays open to you.',
};

/**
 * The §5 gate itself.
 *
 * Returns a refusal to short-circuit on, `undefined` to proceed — the shape
 * every gate in this family uses, so no route can consume a denial as a value.
 * Engine self-invocation (`isSystem`, never settable from the wire) bypasses,
 * as it does at every neighbouring gate.
 *
 * ⚠️ Callers MUST run this BEFORE the write is attempted and before body
 * validation, so a refused caller writes nothing and learns nothing about the
 * contract. "Write first, refuse second" is the worst shape here — it is
 * #10243 with an audit trail.
 *
 * ⚠️ It has THREE exits, not two: a refusal, `undefined` to proceed, and a
 * THROW. See the posture read below for the class that throws and why a caller
 * must not absorb it into "no gate to enforce".
 *
 * ⚠️ TWO DOORS, one gate body — so every exit above, the throw included,
 * reaches BOTH of them and neither is "the" activation door:
 *
 *   - `./actions.ts` — `POST /actions/_activation/:object/:action`, calling
 *     this function directly with {@link ACTION_ACTIVATION_SUBJECT};
 *   - `./automation.ts` — `POST /automation/:name/toggle`, through its
 *     `refuseUngrantedFlowActivationWrite` wrapper and
 *     {@link FLOW_ACTIVATION_SUBJECT}.
 *
 * Both `await` the call, so the throw exit is a rejected promise the domain
 * handler propagates and the dispatcher's error exit renders — nothing is
 * unhandled at either door. Written down because a change to this body is a
 * change to two routes: a claim about "the gate" that was measured at one door
 * is a claim about half the surface, and both doors are pinned together in
 * `./tenancy-posture-outage-gates.test.ts` for that reason.
 */
export async function refuseUngrantedActivationWrite(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    artifact: ActivationSubject,
): Promise<HttpDispatcherResult | undefined> {
    const ec: any = context?.executionContext;
    if (ec?.isSystem) return undefined;

    // [#15900, ruled 2026-09-06 — option A] The posture is an authorization
    // INPUT here, so the two ways it can be missing are two different facts:
    //
    //  - **never registered** ⇒ no posture, and no refusal. Unchanged, and load
    //    bearing: ADR-0093 D4/D5 makes a deployment with no tenancy service the
    //    same shape as `single`, where install-level and org-level are ONE
    //    scope and the org admin who already cleared `manage_metadata` is the
    //    right authority. Refusing here would lock every single-organization
    //    operator out of their own switch.
    //  - **registered and unable to answer** ⇒ how far this install-wide row
    //    reaches was never READ, so whether the operator is required was never
    //    DECIDED. Serving the write there is #13906 decision 1 option A's
    //    permissive direction at a second door — 「A posture that could not be
    //    READ is not a posture that is ABSENT.」 — so it is answered as an
    //    outage (503), never as a permit.
    //
    // Told apart by the REGISTRY's brand (#13905) inside `resolveServiceOrLoud`,
    // never by message text; the branded class is already absorbed there, so
    // anything reaching this `catch` is a `tenancy` that is wired and broke.
    //
    // ⛔ The plain `resolveService` probe is what this gate used to read, and it
    // collapses the two: a factory that threw and a name nothing registered
    // both arrived as the same absent posture, and this gate then returned
    // `undefined` — no refusal — for both.
    //
    // ⚠️ THE SCOPE ID IS PART OF THE READ, not an optimisation. `tenancy` may be
    // registered `ServiceLifecycle.SCOPED`, and a scoped registration resolved
    // without a scope id rejects UNBRANDED (`Scope ID required for scoped
    // service 'tenancy'`) — which the classified lookup correctly re-raises,
    // and this gate would then answer as a 503 it MANUFACTURED itself on a
    // perfectly healthy deployment, locking the platform operator out of the
    // switch that is theirs. `context.environmentId` is the same scope the
    // identity step and `./keys.ts` already resolve this exact name with, so
    // all three read one deployment's posture through one scope: an outage
    // answered here is the service's, never this call site's omission.
    let posture;
    try {
        posture = effectiveTenancyPosture(
            await deps.resolveServiceOrLoud(context, 'tenancy', context.environmentId),
        );
    } catch (err) {
        throw new AuthzStoreUnavailableError('tenancy', err);
    }
    if (!posture || !postureEnforcesWall(posture)) return undefined;

    // [ADR-0095 D2/D3 · #15981] The platform-operator test is the posture RUNG.
    // See the "Why the operator test is a POSITION" section above for why this
    // is the SAME concept that section argues for, read through the one input
    // that still means it.
    if (ec?.posture === 'PLATFORM_ADMIN') return undefined;

    // The message names the posture and the sanctioned path — the loud-refusal
    // shape ADR-0126 §7 asks for throughout — and says nothing about the
    // caller's own positions or permission sets (#7450).
    return {
        handled: true,
        response: deps.error(
            `Enabling or disabling ${artifact.subject} writes an INSTALL-WIDE activation row, and this deployment runs ` +
            `the '${posture}' tenancy posture, where that reaches every organization. It requires the platform operator ` +
            `(ADR-0126 §5) — an organization administrator cannot flip an install-wide switch. ${artifact.remedy}`,
            ACTIVATION_DENY_STATUS,
            { code: ACTIVATION_DENY_CODE },
        ),
    };
}

/**
 * [#10145 / #10243] The capability tier that sits IN FRONT of the §5 gate: the
 * caller must hold `manage_metadata` before the posture question is even asked.
 *
 * The `/automation` domain enforces this through its own
 * `isFlowAuthoringWrite` predicate, because there the activation door is one
 * arm of a whole authoring family (create / update / delete / toggle / clone)
 * that shares one policy. The `/actions` domain has no such family — it is an
 * EXECUTION surface whose per-action `requiredPermissions` gate answers a
 * different question entirely — so its activation door carries this gate
 * directly, with the same capability and the same refusal envelope.
 *
 * Synchronous: the capability rides the caller's own `systemPermissions`
 * (CAPABILITIES, not permission-SET names — #4705), so nothing is resolved.
 * The message names the CAPABILITY it wants and nothing about the caller
 * (#7450).
 */
export function refuseUngrantedActivationAuthoring(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    artifact: ActivationSubject,
): HttpDispatcherResult | undefined {
    const ec: any = context?.executionContext;
    if (ec?.isSystem) return undefined;
    if (new Set<string>(ec?.systemPermissions ?? []).has(ACTIVATION_AUTHORING_CAPABILITY)) return undefined;

    return {
        handled: true,
        response: deps.error(
            `Enabling or disabling ${artifact.subject} requires the \`${ACTIVATION_AUTHORING_CAPABILITY}\` capability — ` +
            `switching a shipped artifact off is functionally equivalent to deleting it for as long as it stays off ` +
            `(#10243).`,
            ACTIVATION_DENY_STATUS,
            { code: ACTIVATION_DENY_CODE },
        ),
    };
}
