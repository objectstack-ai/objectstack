// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0066 D4] The capability arithmetic behind every declared
 * `requiredPermissions` gate that admits a caller to an execution surface —
 * ONE definition, asked by the action gate (`actionPermissionError`,
 * `action-execution.ts`) and the flow start gate (`flowStartRefusal`,
 * `flow-start-admission.ts`).
 *
 * A declaration is a list of capability names; the caller holds the
 * capabilities its permission sets grant (`ExecutionContext.systemPermissions`).
 * The gate admits a caller that holds EVERY named capability. The two gates
 * share this line so an action and a flow that declare the same list admit
 * the same callers: two spellings of "holds X" would be two answers to one
 * question.
 *
 * The system principal is NOT decided here: each gate reads
 * `ExecutionContext.isSystem` itself, before it asks, so the bypass stays at
 * the gate that grants it and the census page
 * (`content/docs/permissions/system-context.mdx`) anchors it there.
 */

/**
 * The capabilities in `required` the caller does not hold, in declaration
 * order. Empty when nothing is declared (an ungated surface) or when the
 * caller holds all of them. A value that is not an array declares nothing.
 */
export function missingCapabilities(
    required: unknown,
    executionContext: { systemPermissions?: readonly string[] } | null | undefined,
): string[] {
    if (!Array.isArray(required) || required.length === 0) return [];
    const held = new Set<string>(executionContext?.systemPermissions ?? []);
    return (required as string[]).filter((perm) => !held.has(perm));
}
