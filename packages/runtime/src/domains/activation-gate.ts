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
 * The activation row these routes write is **install-level**
 * (`organization_id NULL`, §5): one row, one environment, every tenant. So the
 * authority required to write it scales with how many tenants that reach
 * covers:
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
 * ## Why the operator test is a POSITION and not a capability
 *
 * ADR-0126 §5 says "the platform-operator capability"; the platform's actual
 * operator identity is the ADR-0068 D2 built-in `platform_admin` POSITION,
 * documented verbatim as "Platform operator (SaaS admin). NOT a tenant user
 * role", unscoped, sourced from the unscoped `admin_full_access` grant. No
 * capability in `PLATFORM_CAPABILITIES` carries that meaning: `manage_metadata`
 * is the one the tier above already requires, and a tenant org admin can hold
 * it — so spelling this gate as a capability check would either re-ask the
 * question already answered or invent a capability name, which would be a
 * `packages/spec` change ADR-0126 §9 walls this family out of. The position IS
 * the platform's operator concept; this gate reads it rather than minting a
 * synonym.
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
// and this gate can never disagree) and the built-in identity name that means
// "platform operator, NOT a tenant user role" (ADR-0068 D2).
import { effectiveTenancyPosture } from '@objectstack/core';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { BUILTIN_IDENTITY_PLATFORM_ADMIN } from '@objectstack/spec/identity';
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
 */
export async function refuseUngrantedActivationWrite(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    artifact: ActivationSubject,
): Promise<HttpDispatcherResult | undefined> {
    const ec: any = context?.executionContext;
    if (ec?.isSystem) return undefined;

    let posture;
    try {
        posture = effectiveTenancyPosture(await deps.resolveService(context, 'tenancy'));
    } catch {
        posture = undefined;
    }
    if (!posture || !postureEnforcesWall(posture)) return undefined;

    const positions: string[] = Array.isArray(ec?.positions) ? ec.positions : [];
    if (positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN)) return undefined;

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
