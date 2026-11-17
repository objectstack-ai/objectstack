// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flow start rules two different askers share — ONE spelling, asked by
 * both:
 *
 *  - every door that starts a published flow by name
 *    (`flowStartRefusal`, `@objectstack/runtime`'s `flow-start-admission.ts`,
 *    whose header is the authority on the rules and their order there);
 *  - a dry run of an unpublished definition
 *    (`IAutomationService.dryRun`, `@objectstack/service-automation`), which
 *    the contract admits by "the rules that admit a start by name".
 *
 * They live here, below both, because `@objectstack/service-automation` does
 * not depend on `@objectstack/runtime`, and a rule each asker spelled for
 * itself is a rule that drifts: the account reading, the capability
 * arithmetic, the refusals' code and status, and their words are written here
 * once. `flow-start-admission.ts` re-exports every one of them under the name
 * it always had.
 *
 * Two rules are here, and only two:
 *
 *  - **The AI service account rule** ({@link aiAccountElevatedStartRefusal};
 *    ADR-0151 D3 and Non-goals, ruling record 6812617393, letter C): an AI
 *    service account starts a flow declared `runAs: 'system'` only through
 *    an action its author opted into AI.
 *  - **The flow's own `requiredPermissions`**
 *    ({@link requiredPermissionsStartRefusal}; ruling record 6377848497,
 *    letter A): a caller must hold every capability the flow names.
 *
 * The elevated self-triggered rule stays in `flow-start-admission.ts`: only
 * the by-name doors ask it. A dry run admits such a draft for the named user,
 * never elevated (ruling record 6917953931, letter B), so it is not shared.
 *
 * The system principal is NOT decided here: each asker reads
 * `isSystem` itself, before it asks (a dry run never runs as it).
 */

/** The ADR-0112 `403` a start the rules here do not admit answers. */
export interface FlowStartPermissionRefusal {
    code: 'PERMISSION_DENIED';
    status: 403;
    message: string;
}

/**
 * [ADR-0066 D4] The capabilities in `required` the caller does not hold, in
 * declaration order — the arithmetic behind every declared
 * `requiredPermissions` gate that admits a caller to an execution surface,
 * asked by the action gate (`actionPermissionError`, `action-execution.ts`),
 * the flow start gate and a dry run's admission. A declaration is a list of
 * capability names; the caller holds the capabilities its permission sets
 * grant (`ExecutionContext.systemPermissions`). Empty when nothing is declared
 * (an ungated surface) or when the caller holds all of them. A value that is
 * not an array declares nothing.
 */
export function missingCapabilities(
    required: unknown,
    executionContext: { systemPermissions?: readonly string[] } | null | undefined,
): string[] {
    if (!Array.isArray(required) || required.length === 0) return [];
    const held = new Set<string>(executionContext?.systemPermissions ?? []);
    return (required as string[]).filter((perm) => !held.has(perm));
}

/**
 * The refusal answered when the caller lacks a capability the flow's
 * `requiredPermissions` names — the same code and status as the action
 * gate's 403 (ADR-0112). ⛔ No new code is minted here.
 *
 * The message names the declared and the missing capabilities, as the action
 * gate's does — the remedy is a grant, and a caller cannot ask for one it
 * cannot name — and nothing else about the flow: not its name, its type or its
 * run-as declaration.
 */
export function requiredPermissionsRefusal(required: readonly string[], missing: readonly string[]): FlowStartPermissionRefusal {
    return {
        code: 'PERMISSION_DENIED',
        status: 403,
        message:
            `Starting this flow requires capability [${required.join(', ')}] — `
            + `caller is missing [${missing.join(', ')}]`,
    };
}

/**
 * The refusal answered when an AI service account starts a flow declared
 * `runAs: 'system'` and what starts the flow carries no AI opt-in — the same
 * code and status as the refusal beside it (ADR-0112). ⛔ No new code is
 * minted here.
 *
 * The message names the rule and the opt-in the author adds, and nothing else
 * about THIS flow: not its name, its type or its definition, and not the
 * door, so it reads the same wherever it is answered. It names the action
 * route and the MCP tool because those are the doors where the opt-in can
 * stand.
 */
export const AI_ACCOUNT_ELEVATED_START_REFUSAL = Object.freeze({
    code: 'PERMISSION_DENIED',
    status: 403,
    message:
        'An AI service account starts a flow that runs as the system only through an action its author opted '
        + "into AI. Declare `ai: { exposed: true, description: … }` on an action of type 'flow' that targets the "
        + 'flow, and have the account run that action (the REST actions route or the MCP `run_action` tool).',
} as const);

/**
 * Whether `executionContext` is an AI service account's (ADR-0151 D3): the
 * agent principal that is its own subject, `principalKind: 'agent'` with no
 * `onBehalfOf`. An OAuth-delegated agent names the person it acts for and is
 * not one; neither is a person, the guest or the system principal.
 *
 * ONE reading, asked by the AI service account rule and by the builders that
 * forward the account's kind onto the run it starts, so the caller judged as
 * an account is the caller whose run carries the kind.
 */
export function isAiServiceAccount(
    executionContext: { principalKind?: unknown; onBehalfOf?: unknown } | null | undefined,
): boolean {
    return executionContext?.principalKind === 'agent' && !executionContext?.onBehalfOf;
}

/**
 * The AI service account rule: {@link AI_ACCOUNT_ELEVATED_START_REFUSAL} when
 * `executionContext` is an AI service account, the flow declares
 * `runAs: 'system'`, and what starts it carries no `ai.exposed: true` opt-in
 * (`aiExposed`); else `null`. A dry run starts with no action in hand, so it
 * asks with `aiExposed: false`.
 */
export function aiAccountElevatedStartRefusal(
    flow: { runAs?: unknown },
    executionContext: { principalKind?: unknown; onBehalfOf?: unknown } | null | undefined,
    aiExposed: boolean,
): FlowStartPermissionRefusal | null {
    if (flow.runAs === 'system' && isAiServiceAccount(executionContext) && aiExposed !== true) {
        return AI_ACCOUNT_ELEVATED_START_REFUSAL;
    }
    return null;
}

/**
 * The flow's own `requiredPermissions` rule: {@link requiredPermissionsRefusal}
 * naming what the caller is missing, or `null` when it holds every capability
 * the flow names (or the flow names none).
 */
export function requiredPermissionsStartRefusal(
    flow: { requiredPermissions?: unknown },
    executionContext: { systemPermissions?: readonly string[] } | null | undefined,
): FlowStartPermissionRefusal | null {
    const missing = missingCapabilities(flow.requiredPermissions, executionContext);
    if (missing.length === 0) return null;
    return requiredPermissionsRefusal(flow.requiredPermissions as string[], missing);
}
