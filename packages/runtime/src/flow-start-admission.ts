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
 * ## The third question: the row a start addresses
 *
 * The two rules above judge the caller against the FLOW. A start that names a
 * record also hands the run a row, and a `runAs: 'system'` run reads and
 * writes that row past the caller's own access; a user run is asked the same,
 * as the action door's load asks it of every run, so a persisted run is built
 * only on a row its caller has shown it can read. So every door asks a third
 * question after them, through ONE function,
 * `refuseUnreadableFlowStartRecords` (`action-execution.ts`): every record key
 * the door hands the run in a row slot it defines (`recordId`, the
 * `<object>Id` alias, an action's declared `recordIdParam`) is first loaded in
 * the CALLER's own scope, and a key that scope does not deliver is refused
 * with the action door's own `404 RECORD_NOT_FOUND`, before `execute()`, so a
 * refused start persists no run. It is the action door's subject load
 * (`loadActionSubjectRecord`) and its refusal (`refuseDeniedSubjectLoad`),
 * asked of the keys the action door did not load itself, and asked at the
 * trigger routes and a declared endpoint too: a door that hands a run a row
 * the caller has not shown it can read is the gap this module exists to close.
 * It lives beside the load it reuses, so this module imports nothing from
 * `action-execution.ts` and the two stay a one-way edge; the declarations it
 * reads are this module's ({@link flowRunsElevated},
 * {@link flowDeclaredRecordReads}).
 *
 * The object a key is loaded from is the one the start names, AND every object
 * the flow's own definition reads that input from
 * ({@link flowDeclaredRecordReads}): the object a caller names is not always
 * the object a run reads, so a row the caller can read in the object it named
 * says nothing about the row the run reads elsewhere under the same id. Every
 * start input the definition reads as a record id is judged that way, row
 * slot or not, and must be an id (or a list of ids, where it is read as one).
 * An input the author DECLARES a record id (`objectName` on the variable) is
 * judged the same way against the declared object, whether or not the
 * definition reads it in plain sight; an undeclared input keeps the
 * visible-read rule alone.
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
import { collectFlowGraphs } from '@objectstack/spec/automation';

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
 * Whether `flowName` is declared `runAs: 'system'`, read through the
 * automation service's own `getFlow`, the probe {@link flowStartRefusal} reads.
 * `false` when the service cannot be asked (no `getFlow`) or serves no such
 * flow: an undeclared run is the parsed default, `user`, and a door that
 * cannot read the declaration dispatches as before.
 *
 * The third question's one reading of the declaration
 * (`refuseUnreadableFlowStartRecords`): a start that names a record key but
 * no object to load it from cannot be judged, which is refused for an
 * elevated run only. A user run reads in the caller's own scope.
 */
export async function flowRunsElevated(automation: unknown, flowName: string): Promise<boolean> {
    const svc = automation as { getFlow?: (name: string) => Promise<unknown> } | null | undefined;
    if (typeof svc?.getFlow !== 'function') return false;
    const flow = (await svc.getFlow(flowName)) as { runAs?: unknown } | null | undefined;
    return flow?.runAs === 'system';
}

/**
 * One record read a flow's own definition declares for a start input: the
 * input's value is read as the id of a row of `object`, or, when `many`, as a
 * list of such ids.
 */
export interface FlowDeclaredRecordRead {
    object: string;
    many: boolean;
}

/** How deep {@link flowDeclaredRecordReads} follows `subflow` and `map` inputs into callee flows. */
const DECLARED_READ_CALLEE_DEPTH = 8;

/** The three CRUD node types that address existing rows through `config.filter`. */
const ROW_ADDRESSING_CRUD_NODE_TYPES: ReadonlySet<string> = new Set(['get_record', 'update_record', 'delete_record']);

/**
 * The variable a value slot hands on unchanged, or `undefined`: a CEL value
 * envelope whose whole source is one variable name, bare or through `vars`.
 * Anything computed (a call, an operator, a member path, a literal) is not a
 * hand-off, so it is not read as one.
 */
function handedOnVariable(slot: unknown): string | undefined {
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) return undefined;
    const { dialect, source } = slot as { dialect?: unknown; source?: unknown };
    if (dialect !== 'cel' || typeof source !== 'string') return undefined;
    const match = /^(?:vars\.)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(source.trim());
    return match ? match[1] : undefined;
}

/** A node config's string value at `key`, when it is a non-empty literal. */
function literalString(config: Record<string, unknown>, key: string): string | undefined {
    const value = config[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A plain object, or `undefined`. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/**
 * The record reads a flow's own definition declares for its start inputs —
 * flow start admission's reading of what a run addresses, asked by
 * `refuseUnreadableFlowStartRecords` (`action-execution.ts`) at every door
 * that starts a flow by name.
 *
 * A start input is a variable the flow declares `isInput`: the engine binds it
 * from the start's `params` under the same name. The definition reads such an
 * input as a record id of a FIXED object in these places, and only these,
 * across every region of the flow (`collectFlowGraphs`):
 *
 *  - the input's own declaration, `objectName` on the variable (#29425 ruling
 *    A): one id of that object, whatever the rest of the definition does with
 *    it. It is ADDED to the reads below, never in place of them: a run that
 *    also reads the input from another object reads that row too, so the
 *    caller must be able to read both. Being the author's word about the
 *    caller's value, it holds even where a `loop` or `map` later rebinds the
 *    name, and a callee's declaration is followed through the hand-offs below
 *    like any other callee read;
 *  - a `get_record`, `update_record` or `delete_record` node with a literal
 *    `objectName` whose `filter.id` is the input (one id), or whose
 *    `filter.id.$eq` / `filter.id.$in` is (one id / a list of ids);
 *  - a `screen` node with a literal `objectName` whose `recordId` is the input;
 *  - a `subflow` node with a literal `flowName` that hands the input on to a
 *    callee input, or a `map` node that hands it on as it is or per item (a
 *    callee input taking the iterator variable of a `collection` that is the
 *    input, which reads the input as a list): the callee's own declared reads
 *    of that callee input, followed {@link DECLARED_READ_CALLEE_DEPTH} levels
 *    deep, never re-entering a flow already on the path.
 *
 * "Is the input" means a CEL value envelope whose whole source is the input's
 * name ({@link handedOnVariable}). A read computed from the input, or from a
 * value the flow derived, declares nothing here: the definition does not say
 * which object such a value addresses, so it is not judged. Nor is a name a
 * `loop` or `map` node binds as its item or index variable: that binding
 * replaces the start's value in the run's variables.
 *
 * Read through the automation service's own `getFlow`, the probe
 * {@link flowStartRefusal} reads; a service that cannot be asked, or a flow it
 * does not serve, declares nothing.
 */
export async function flowDeclaredRecordReads(
    automation: unknown,
    flowName: string,
): Promise<ReadonlyMap<string, readonly FlowDeclaredRecordRead[]>> {
    const svc = automation as { getFlow?: (name: string) => Promise<unknown> } | null | undefined;
    if (typeof svc?.getFlow !== 'function') return new Map();
    const getFlow = (name: string): Promise<unknown> => svc.getFlow!(name);
    return declaredReadsOf(getFlow, flowName, new Set(), 0);
}

async function declaredReadsOf(
    getFlow: (name: string) => Promise<unknown>,
    flowName: string,
    onPath: Set<string>,
    depth: number,
): Promise<Map<string, FlowDeclaredRecordRead[]>> {
    const reads = new Map<string, FlowDeclaredRecordRead[]>();
    if (onPath.has(flowName) || depth > DECLARED_READ_CALLEE_DEPTH) return reads;
    const flow = (await getFlow(flowName)) as FlowParsed | null | undefined;
    if (!flow || typeof flow !== 'object') return reads;
    const inputs = new Set<string>();
    const add = (input: string, read: FlowDeclaredRecordRead): void => {
        const list = reads.get(input) ?? [];
        if (!list.some((r) => r.object === read.object && r.many === read.many)) list.push(read);
        reads.set(input, list);
    };
    for (const variable of Array.isArray(flow.variables) ? flow.variables : []) {
        if (!variable || variable.isInput !== true || typeof variable.name !== 'string') continue;
        inputs.add(variable.name);
        // The author's own word (`objectName` on the input, #29425 ruling A):
        // the value is the id of one record of that object. It reads the
        // caller's value, so a `loop` or `map` that rebinds the name further
        // down does not withdraw it, and it sits beside every read the
        // definition makes in plain sight, never in place of one.
        if (typeof variable.objectName === 'string' && variable.objectName !== '') {
            add(variable.name, { object: variable.objectName, many: false });
        }
    }
    const graphs = collectFlowGraphs(flow);
    // A `loop` or `map` node binds its item (and index) variable over the run's
    // own variables, so once it runs that name no longer holds the start's
    // value: such a name is not read as a start input anywhere in the flow.
    for (const graph of graphs) {
        for (const node of graph.nodes) {
            const type = String(node.type);
            const config = recordOf(node.config);
            if (config === undefined || (type !== 'loop' && type !== 'map')) continue;
            const iterator = literalString(config, 'iteratorVariable') ?? (type === 'map' ? 'item' : undefined);
            if (iterator !== undefined) inputs.delete(iterator);
            const index = literalString(config, 'indexVariable');
            if (index !== undefined) inputs.delete(index);
        }
    }
    if (inputs.size === 0) return reads;
    const inputOf = (slot: unknown): string | undefined => {
        const name = handedOnVariable(slot);
        return name !== undefined && inputs.has(name) ? name : undefined;
    };
    onPath.add(flowName);
    try {
        for (const graph of graphs) {
            for (const node of graph.nodes) {
                const config = recordOf(node.config);
                if (config === undefined) continue;
                const type = String(node.type);
                if (ROW_ADDRESSING_CRUD_NODE_TYPES.has(type)) {
                    const object = literalString(config, 'objectName');
                    const filter = recordOf(config.filter);
                    if (object === undefined || filter === undefined) continue;
                    const one = inputOf(filter.id);
                    if (one !== undefined) add(one, { object, many: false });
                    const operators = recordOf(filter.id);
                    const eq = operators ? inputOf(operators.$eq) : undefined;
                    if (eq !== undefined) add(eq, { object, many: false });
                    const within = operators ? inputOf(operators.$in) : undefined;
                    if (within !== undefined) add(within, { object, many: true });
                } else if (type === 'screen') {
                    const object = literalString(config, 'objectName');
                    const input = inputOf(config.recordId);
                    if (object !== undefined && input !== undefined) add(input, { object, many: false });
                } else if (type === 'subflow' || type === 'map') {
                    const callee = literalString(config, 'flowName');
                    const handed = recordOf(config.input);
                    if (callee === undefined || handed === undefined) continue;
                    // What each callee input carries: one of this flow's inputs
                    // as it is, or (a `map`) one item of an input it iterates.
                    const iterated = type === 'map' ? inputOf(config.collection) : undefined;
                    const iterator = literalString(config, 'iteratorVariable') ?? 'item';
                    const carried: Array<readonly [calleeInput: string, input: string, perItem: boolean]> = [];
                    for (const [calleeInput, slot] of Object.entries(handed)) {
                        const input = inputOf(slot);
                        if (input !== undefined) carried.push([calleeInput, input, false]);
                        else if (iterated !== undefined && handedOnVariable(slot) === iterator) carried.push([calleeInput, iterated, true]);
                    }
                    if (carried.length === 0) continue;
                    const calleeReads = await declaredReadsOf(getFlow, callee, onPath, depth + 1);
                    for (const [calleeInput, input, perItem] of carried) {
                        for (const read of calleeReads.get(calleeInput) ?? []) {
                            // One id read per item makes the input a list of ids;
                            // a list read per item (a list of lists) states no row.
                            if (perItem && read.many) continue;
                            add(input, { object: read.object, many: perItem || read.many });
                        }
                    }
                }
            }
        }
    } finally {
        onPath.delete(flowName);
    }
    return reads;
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
