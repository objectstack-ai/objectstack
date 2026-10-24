// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Who may START a flow at a door that starts one by name — ONE definition,
 * asked by every such door.
 *
 * Three doors start a flow by name, and each hands the name straight to
 * `IAutomationService.execute`:
 *
 *  - the trigger routes, `POST /automation/:name/trigger` and the legacy
 *    `POST /automation/trigger/:name` (`domains/automation.ts`);
 *  - an action of `type: 'flow'`, reached through `POST /actions/:object/:action`
 *    and through the MCP `run_action` bridge, which share `dispatchFlowAction`
 *    (`action-execution.ts`);
 *  - a declared endpoint of `type: 'flow'` (`endpoint-executor.ts`).
 *
 * Two rules, asked in this order through ONE entry, {@link flowStartRefusal}:
 *
 *  1. **The elevated self-triggered rule** (the maintainer's ruling, letter B at
 *     the trigger door, extended to every door that starts a flow by name by
 *     letter A): a caller that is not the system principal may not start a flow
 *     declared `runAs: 'system'` whose `type` is self-triggered —
 *     `autolaunched`, `record_change` or `schedule`. Those types run on their
 *     own trigger, or as a sub-flow from a parent flow's `subflow` node, and are
 *     never an entry, so a button, an action or an endpoint that happens to name
 *     one is wiring, not a design. No capability opens it, which is why it
 *     answers first.
 *  2. **The flow's own `requiredPermissions`** (ruling record 6377848497,
 *     letter A): `screen` and `api` flows stay the doors their author designed,
 *     elevated or not, and the flow says who may walk through them. A caller
 *     that is not the system principal must hold EVERY capability the flow
 *     names — the action gate's arithmetic (ADR-0066 D4,
 *     `required-capabilities.ts`), so an action and a flow declaring the same
 *     list admit the same callers. Because the action door asks this too, an
 *     action that starts the flow inherits the flow's declaration: the app
 *     states it once, on the thing it protects, and an action that forgets to
 *     repeat it is no hole. An action that declares its OWN list keeps its own
 *     gate, which answers first (`actionPermissionError`), so a caller at that
 *     door needs both lists.
 *
 * ## Why a module, and why every door asks it
 *
 * The same reason `flow-dispatch-status.ts` is one: a rule each door spells
 * for itself is a rule that drifts, and a door left out is the defect, not a
 * gap. The type set, the capability check, the refusals' code and status, and
 * their words live here once, so a caller refused at one door is refused alike
 * at the other two —
 * an MCP agent and a person are judged at the same door by the same rule.
 * ⛔ A second copy of the type set or the refusal, at any door, is the defect
 * by construction.
 *
 * ## What the predicate does NOT decide
 *
 * Admission only. Elevation stays the engine's: the check reads three
 * declared keys (`type`, `runAs`, `requiredPermissions`) off the definition the
 * service serves and never re-implements the engine's run-as policy. A door's own gates are untouched and keep their
 * place: the action's declared `requiredPermissions` (ADR-0066 D4) still
 * answers first at the action door, and a declared endpoint's policy chain
 * (`authRequired`, `rateLimit`) still runs before its executor. This check
 * runs after the door's existence probe (an unknown name keeps its `404`) and
 * before dispatch, so a refused start runs nothing.
 */

import type { FlowParsed } from '@objectstack/spec/automation';

import { missingCapabilities } from './required-capabilities.js';

/**
 * The three flow types that start on their OWN trigger — or as a sub-flow
 * called from a parent flow's `subflow` node — and never as an entry: an
 * `autolaunched` flow has no trigger of its own beyond a parent or an engine
 * event, a `record_change` flow starts on a write, and a `schedule` flow on
 * its cadence. Bound to the spec's `Flow.type` enum at compile time, so a
 * member the spec drops reds this line.
 *
 * `screen` and `api` are deliberately NOT here: they are entries the author
 * designed for users and API callers, and an elevated one is the author's
 * explicit choice (ADR-0073 D2), reviewable at publish.
 */
export const SELF_TRIGGERED_FLOW_TYPES: ReadonlySet<FlowParsed['type']> = new Set(
    ['autolaunched', 'record_change', 'schedule'] as const satisfies readonly FlowParsed['type'][],
);

/**
 * The refusal every door answers (ADR-0112: code AND status) — the code and
 * status the automation domain's other permission refusals already answer
 * with. ⛔ No new code is minted here.
 *
 * The message names what admits such a flow and nothing about THIS flow: not
 * its name, its type, its run-as declaration or its definition, and not the
 * door, so it reads the same at every door and for every refused flow and
 * tells a caller nothing the refusal itself does not.
 */
export const ELEVATED_START_REFUSAL = Object.freeze({
    code: 'PERMISSION_DENIED',
    status: 403,
    message:
        'This caller may not start this flow. A flow that runs on its own trigger starts there, '
        + "or as a sub-flow from a parent flow's `subflow` node.",
} as const);

/**
 * The refusal a door answers when the caller lacks a capability the flow's
 * `requiredPermissions` names — the same code and status as
 * {@link ELEVATED_START_REFUSAL} and as the action gate's 403 (ADR-0112). ⛔ No
 * new code is minted here.
 *
 * The message names the declared and the missing capabilities, as the action
 * gate's does — the remedy is a grant, and a caller cannot ask for one it
 * cannot name — and nothing else about the flow: not its name, its type or its
 * run-as declaration.
 */
export function requiredPermissionsRefusal(required: readonly string[], missing: readonly string[]): FlowStartRefusal {
    return {
        code: 'PERMISSION_DENIED',
        status: 403,
        message:
            `Starting this flow requires capability [${required.join(', ')}] — `
            + `caller is missing [${missing.join(', ')}]`,
    };
}

/** The ADR-0112 refusal a door answers for a start it does not admit. */
export interface FlowStartRefusal {
    code: 'PERMISSION_DENIED';
    status: 403;
    message: string;
}

/**
 * Whether a flow definition is elevated AND self-triggered — rule 1's subject,
 * judged on the declaration alone (the caller is {@link flowStartRefusal}'s).
 */
export function isElevatedSelfTriggered(flow: { type?: FlowParsed['type']; runAs?: unknown }): boolean {
    return flow.runAs === 'system' && flow.type !== undefined && SELF_TRIGGERED_FLOW_TYPES.has(flow.type);
}

/**
 * THE CHECK every door that starts a flow by name asks: the refusal it
 * answers for this caller starting `flowName`, or `null` when the start is
 * admitted. Rule 1 ({@link isElevatedSelfTriggered}) answers first, then rule 2
 * (the flow's `requiredPermissions`).
 *
 * What stays exactly as it was, and why each is outside this check:
 *
 *  - **The system principal** (`executionContext.isSystem`, never set on
 *    inbound HTTP; an in-process caller such as a job) still starts every flow,
 *    whatever it declares — the same bypass the action gate grants. The guest
 *    principal an `authRequired: false` endpoint admits carries
 *    `isSystem: false` and is judged like any other caller.
 *  - **A parent flow's `subflow` node** starts its child through the engine
 *    (`engine.execute`), never through a door, so a sub-flow called from its
 *    parent is untouched by both rules — the check lives at the doors
 *    precisely so that path stays open. The parent's own start was the door.
 *  - **A flow that declares no `requiredPermissions`** (or an empty list) and is
 *    not elevated-and-self-triggered: admitted, as before.
 *
 * Reads the flow through the automation service's own `getFlow` — the probe
 * `flowIsUnknown` (`flow-dispatch-status.ts`) uses, which serves the same
 * definition `execute` runs — so there is no second loader. `getFlow` is
 * optional on `IAutomationService`; an implementation that omits it cannot be
 * asked, and the door dispatches as before, exactly as the existence check
 * does.
 */
export async function flowStartRefusal(
    automation: unknown,
    flowName: string,
    executionContext: { isSystem?: boolean; systemPermissions?: readonly string[] } | null | undefined,
): Promise<FlowStartRefusal | null> {
    if (executionContext?.isSystem === true) return null;
    const svc = automation as { getFlow?: (name: string) => Promise<unknown> } | null | undefined;
    if (typeof svc?.getFlow !== 'function') return null;
    const flow = (await svc.getFlow(flowName)) as
        | { type?: FlowParsed['type']; runAs?: unknown; requiredPermissions?: unknown }
        | null
        | undefined;
    if (!flow) return null;
    if (isElevatedSelfTriggered(flow)) return ELEVATED_START_REFUSAL;
    const missing = missingCapabilities(flow.requiredPermissions, executionContext);
    if (missing.length > 0) return requiredPermissionsRefusal(flow.requiredPermissions as string[], missing);
    return null;
}
