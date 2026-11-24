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

// The arithmetic itself lives in `@objectstack/core` (`flow-start-rules.ts`),
// below this package, because a dry run in `@objectstack/service-automation`
// asks it too and that package does not depend on this one. Re-exported under
// the name every gate here imports.
export { missingCapabilities } from '@objectstack/core';
