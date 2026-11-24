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
 * Four rules, asked in this order through ONE entry, {@link flowStartRefusal}:
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
 *  2. **The AI service account rule** (ADR-0151 Non-goals; ruling record
 *     6812617393, letter C): an AI service account (ADR-0151 D3,
 *     {@link isAiServiceAccount}) starts a flow declared `runAs: 'system'`
 *     only through an action whose author opted it into the AI surface,
 *     `ai: { exposed: true, … }` (ADR-0011) — the opt-in the MCP `run_action`
 *     door already asks of every action. The account holds its explicit
 *     grants and never runs as the system (ADR-0151 D3); an elevated flow
 *     runs past them, so the author's word that AI may start it is asked
 *     before the run exists. Each door states whether what starts the flow
 *     THERE carries that opt-in ({@link FlowStartDoor}): the action door hands
 *     its action's, and the trigger routes and a declared endpoint start a
 *     flow by name with no action in hand — neither a flow nor an endpoint
 *     declares an AI opt-in — so at those two an account's start of an
 *     elevated flow is refused, and the refusal names the door that admits
 *     it. No capability opens it either, so it answers before rule 3.
 *  2b. **The confirmation an action declares travels with what it starts**
 *     (ADR-0151 D3 rule 3): an AI service account does not confirm an action
 *     for itself, and the action door refuses it an action that declares
 *     `ai.requiresConfirmation: true` whatever the request carries
 *     (`actionConfirmationRefusal`, `action-execution.ts`). A door that starts
 *     by NAME a flow such an action targets would start the same run with no
 *     confirmation asked, so at a door that states the environment's action
 *     declarations ({@link FlowStartDoor.actionDeclarations}) an account's
 *     start of that flow is refused with the action door's own refusal, `428
 *     ACTION_CONFIRMATION_REQUIRED`, naming the action, whatever the request
 *     carries — no confirmation member is read for an account — and a
 *     declaration read that fails refuses it `503`. The rule is asked at the
 *     two trigger routes; the declared-endpoint door is not judged by it yet,
 *     and the action door keeps its own confirmation gate. It reads the flow's
 *     name and the declarations only, never the definition, so a service
 *     that cannot serve the definition is judged by it too. A person, an
 *     OAuth-delegated agent and the system principal are not judged by it,
 *     and a flow no confirmation-gated action targets is admitted as before.
 *     No capability opens it, so it answers before rule 3.
 *  3. **The flow's own `requiredPermissions`** (ruling record 6377848497,
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
 * The rules above judge the caller against the FLOW; this question keeps the
 * name it has at every door that asks it, and answers after all of them. A
 * start that names a
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
 * It lives beside the load it reuses, so this module imports no value from
 * `action-execution.ts` (one type, the confirmation refusal's shape, which
 * erases) and the two stay a one-way edge; the declarations it
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
 * gap. The type set, the account rule, the capability check, the refusals'
 * code and status, and their words live once, so a caller refused at one
 * door is refused alike at the other two —
 * an MCP agent and a person are judged at the same door by the same rule.
 * Rules 2 and 3 (their refusals, the account reading and the capability
 * arithmetic) are written in `@objectstack/core`'s `flow-start-rules.ts` and
 * re-exported here, because a dry run of an unpublished definition
 * (`IAutomationService.dryRun`) asks them too, from a package that does not
 * depend on this one; rule 1 and rule 2b are asked by the by-name doors alone
 * and stay here.
 * ⛔ A second copy of the type set or the refusal, at any door, is the defect
 * by construction.
 *
 * ## What the predicate does NOT decide
 *
 * Admission only. Elevation stays the engine's: the check reads three
 * declared keys (`type`, `runAs`, `requiredPermissions`) off the definition the
 * service serves, what a door states about itself ({@link FlowStartDoor}) —
 * its AI opt-in, and the action declarations its environment serves, of
 * which it reads three keys (`type`, `target`, `ai.requiresConfirmation`) —
 * and never re-implements the engine's run-as policy. A door's own gates are untouched and keep their
 * place: the action's declared `requiredPermissions` (ADR-0066 D4) still
 * answers first at the action door, and a declared endpoint's policy chain
 * (`authRequired`, `rateLimit`) still runs before its executor. This check
 * runs after the door's existence probe (an unknown name keeps its `404`) and
 * before dispatch, so a refused start runs nothing.
 */

import type { FlowParsed } from '@objectstack/spec/automation';
import { collectFlowGraphs } from '@objectstack/spec/automation';
// The confirmation member's SPELLING is the contract, imported as the action
// door imports it, never hand-spelled (Prime Directive #12).
import { AI_ACTION_CONFIRMATION_MEMBER, type ActionConfirmationRequiredDetails } from '@objectstack/spec/contracts';
import { isObjectLessActionKey } from '@objectstack/objectql';

// A TYPE only, erased at runtime: the action door's refusal shape, so the code
// and status rule 2b answers are the action door's own literals, checked at
// compile time, with no value edge back into `action-execution.ts`.
import type { ActionConfirmationRefusal } from './action-execution.js';
// Rules 2 and 3, their refusals and the account reading are spelled ONCE, in
// `@objectstack/core` (`flow-start-rules.ts`): a dry run of an unpublished
// definition (`IAutomationService.dryRun`, `@objectstack/service-automation`,
// which does not depend on this package) asks the same two rules. Re-exported
// here under the names every door imports.
import {
    aiAccountElevatedStartRefusal,
    isAiServiceAccount,
    requiredPermissionsStartRefusal,
    type FlowStartPermissionRefusal,
} from '@objectstack/core';
export {
    AI_ACCOUNT_ELEVATED_START_REFUSAL,
    isAiServiceAccount,
    requiredPermissionsRefusal,
    type FlowStartPermissionRefusal,
} from '@objectstack/core';

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
 * The refusal rule 2b answers: the action door's own (`428
 * ACTION_CONFIRMATION_REQUIRED`, ADR-0112), its code, status and `details`
 * typed to that door's shape, so the two cannot drift. ⛔ No new code.
 */
export type FlowStartConfirmationRefusal = ActionConfirmationRefusal;

/**
 * The refusal rule 2b answers when the door's action declarations could not be
 * read (ADR-0110 D3: the metadata plane failing to answer): a flat `503
 * SERVICE_UNAVAILABLE`, whatever the failure declared, so a start an account
 * could not be judged for is refused and never admitted. The standard-catalog
 * code (ADR-0112); ⛔ no new code. The message names no flow, no action and
 * nothing of the failure.
 */
export const DECLARATION_READ_FAILED_REFUSAL = Object.freeze({
    code: 'SERVICE_UNAVAILABLE',
    status: 503,
    message:
        'The action declarations this start is judged against could not be read — nothing was run. '
        + 'Retry once the metadata service answers.',
} as const);

/** The ADR-0112 `503` rule 2b answers when it could not read the declarations it judges. */
export type FlowStartUnavailableRefusal = typeof DECLARATION_READ_FAILED_REFUSAL;

/** The ADR-0112 refusal a door answers for a start it does not admit. */
export type FlowStartRefusal = FlowStartPermissionRefusal | FlowStartConfirmationRefusal | FlowStartUnavailableRefusal;

/**
 * One action declaration a door's environment serves, as the door reads it
 * (`collectActionDeclarations`, `action-execution.ts`): the declaration, and
 * the object it is declared on or bound to (the object-less key for none).
 */
export interface FlowStartActionDeclaration {
    action: unknown;
    objectName?: string;
}

/**
 * The action declaration that makes a start of `flowName` confirmation-gated
 * (rule 2b), or `undefined`: an action of `type: 'flow'` whose `target` is the
 * flow and that declares `ai.requiresConfirmation: true` — the DECLARED flag
 * alone, the reading the action door's gate makes (`!== true` is no gate).
 * Every holder counts, whichever package declares it: a name two packages
 * hold is judged against all of them, so an account is refused rather than
 * admitted on a guess about which holder the start reaches. With several, the
 * first by object and action name, so the refusal names the same action on
 * every call.
 */
export function confirmationGatedStarterOf(
    declarations: readonly FlowStartActionDeclaration[],
    flowName: string,
): FlowStartActionDeclaration | undefined {
    const gated = declarations.filter((row) => {
        const action = row?.action as { type?: unknown; target?: unknown; ai?: { requiresConfirmation?: unknown } } | null | undefined;
        return action?.type === 'flow' && action.target === flowName && action.ai?.requiresConfirmation === true;
    });
    const keyOf = (row: FlowStartActionDeclaration): string =>
        `${row.objectName ?? ''}\u0000${String((row.action as { name?: unknown }).name ?? '')}`;
    return gated.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0))[0];
}

/**
 * Rule 2b's refusal for `declaration`: the action door's own refusal of an AI
 * service account (`actionConfirmationRefusal`), naming the action, its
 * object, the confirmation member and `reason: 'service_account'` in
 * `details` as that door does. The
 * message states the rule and prescribes no retry: nothing the account adds
 * to the request starts this flow. It names the action, which is the thing
 * that declares the gate, and nothing of the flow's definition.
 */
export function confirmationGatedStartRefusal(declaration: FlowStartActionDeclaration): FlowStartConfirmationRefusal {
    const actionName = String((declaration.action as { name?: unknown }).name ?? '');
    const objectName = isObjectLessActionKey(declaration.objectName) ? undefined : declaration.objectName;
    const details: ActionConfirmationRequiredDetails = {
        actionName,
        ...(objectName ? { objectName } : {}),
        confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
        // The action door's reason for an account (`actionConfirmationRefusal`,
        // `action-execution.ts`), so a client that branches on it treats a
        // flow start as it treats an action. Typed to the contract's closed set
        // (`ACTION_CONFIRMATION_REFUSAL_REASONS`, `@objectstack/spec/contracts`).
        reason: 'service_account',
    };
    const on = objectName ? ` on '${objectName}'` : '';
    return {
        code: 'ACTION_CONFIRMATION_REQUIRED',
        status: 428,
        message:
            `Action '${actionName}'${on} starts this flow and declares ai.requiresConfirmation: true — nothing was run. `
            + 'An AI service account does not confirm an action for itself: a person starts this flow.',
        details,
    };
}

/**
 * What a door that starts a flow by name states about ITSELF for rule 2. A
 * required argument of {@link flowStartRefusal}, so a door that never
 * considered the rule does not compile.
 */
export interface FlowStartDoor {
    /**
     * Whether what starts the flow at this door carries its author's
     * `ai.exposed: true` opt-in (ADR-0011). The action door hands its action's
     * (`actionIsAiExposed`, the reading the MCP `run_action` gate makes). The
     * trigger routes and a declared endpoint state `false`: they start a flow
     * by name with no action in hand, and neither a flow nor an endpoint
     * declares an AI opt-in.
     */
    aiExposed: boolean;
    /**
     * [ADR-0151 D3 rule 3] Rule 2b's input: the action declarations this
     * door's environment serves, read ONLY when the caller is an AI service
     * account. A door that states none is not judged by rule 2b. A read that
     * throws (a listing, or the service it is read from failing to resolve)
     * refuses the start with {@link DECLARATION_READ_FAILED_REFUSAL}, a flat
     * `503`, and nothing runs; it never admits it.
     *
     * Rule 2b is asked at the two trigger routes, which state the
     * declarations (`servedActionDeclarations`, `domains/automation.ts`). The
     * declared-endpoint door states none, so it is not judged by rule 2b yet.
     * The action door states none: the action it runs is asked its own
     * confirmation gate first (`actionConfirmationRefusal`), which this rule
     * leaves exactly as it is.
     */
    actionDeclarations?: () => Promise<readonly FlowStartActionDeclaration[]>;
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

/**
 * [ADR-0150 D3/D4, #31696] How {@link flowDeclaredRecordReads} reads the flows
 * a walk reaches, the way the engine's run reads them: the started flow, and
 * each `subflow` / `map` callee resolved from the CALLING flow's package (the
 * engine's `resolveFlowKey`), never from the bare name alone. A flow name two
 * namespaces hold is refused by the bare `getFlow`, while the engine runs the
 * caller package's own flow of that name; the walk reads that one.
 * `flow-slot-view.ts` builds it ({@link FlowWalkReads}, `flowWalkReads`).
 */
export interface FlowWalkReads {
    /** The package whose flow the started flow `flowName` is, `null` for none. */
    rootPackage(flowName: string): Promise<string | null>;
    /**
     * The flow a call by `name` from a flow of package `callerPackageId`
     * reaches, and the package holding it (`null` for none). Throws the
     * refusal the engine's call would answer (`409`, every candidate named).
     */
    callee(name: string, callerPackageId: string | null): Promise<{ flow: unknown; packageId: string | null }>;
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
 *
 * [ADR-0150 D3/D4, #31696] A callee is read the way the run reads it: from
 * the calling flow's package, through `walk` ({@link FlowWalkReads}), so P's
 * flow calling a subflow name another namespace also holds reads P's own
 * subflow, as the engine runs it. Without `walk`, every callee is the bare
 * `getFlow` read, which refuses a shared name (fail closed).
 */
export async function flowDeclaredRecordReads(
    automation: unknown,
    flowName: string,
    walk?: FlowWalkReads,
): Promise<ReadonlyMap<string, readonly FlowDeclaredRecordRead[]>> {
    const svc = automation as { getFlow?: (name: string) => Promise<unknown> } | null | undefined;
    if (typeof svc?.getFlow !== 'function') return new Map();
    const root: FlowRead = {
        flow: () => svc.getFlow!(flowName),
        packageId: async () => (walk ? walk.rootPackage(flowName) : null),
    };
    const callee = async (name: string, callerPackageId: string | null): Promise<FlowRead> => {
        if (!walk) return { flow: () => svc.getFlow!(name), packageId: async () => null };
        const read = await walk.callee(name, callerPackageId);
        return { flow: async () => read.flow, packageId: async () => read.packageId };
    };
    return declaredReadsOf(root, callee, flowName, new Set(), 0);
}

/** One flow a walk reads: its definition, and the package holding it (its place on the walk's path). */
interface FlowRead {
    flow(): Promise<unknown>;
    packageId(): Promise<string | null>;
}

/**
 * A flow on the walk's path: its package and its name, so a callee of one
 * name held by another namespace is another flow, never a re-entry. A walk
 * with no {@link FlowWalkReads} reads every package as `null`: the name alone.
 */
const pathKeyOf = (packageId: string | null, name: string): string => `${packageId ?? ''}\u0000${name}`;

async function declaredReadsOf(
    self: FlowRead,
    callee: (name: string, callerPackageId: string | null) => Promise<FlowRead>,
    flowName: string,
    onPath: Set<string>,
    depth: number,
): Promise<Map<string, FlowDeclaredRecordRead[]>> {
    const reads = new Map<string, FlowDeclaredRecordRead[]>();
    if (depth > DECLARED_READ_CALLEE_DEPTH) return reads;
    const selfKey = pathKeyOf(await self.packageId(), flowName);
    if (onPath.has(selfKey)) return reads;
    const flow = (await self.flow()) as FlowParsed | null | undefined;
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
    onPath.add(selfKey);
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
                    const calleeName = literalString(config, 'flowName');
                    const handed = recordOf(config.input);
                    if (calleeName === undefined || handed === undefined) continue;
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
                    // [#31696] From this flow's package, as the run resolves it.
                    const calleeReads = depth + 1 > DECLARED_READ_CALLEE_DEPTH
                        ? new Map<string, FlowDeclaredRecordRead[]>()
                        : await declaredReadsOf(await callee(calleeName, await self.packageId()), callee, calleeName, onPath, depth + 1);
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
        onPath.delete(selfKey);
    }
    return reads;
}

/**
 * THE CHECK every door that starts a flow by name asks: the refusal it
 * answers for this caller starting `flowName`, or `null` when the start is
 * admitted. Rule 1 ({@link isElevatedSelfTriggered}) answers first, then rule 2
 * (an AI service account at an elevated flow, {@link FlowStartDoor}), then
 * rule 2b (an AI service account at a flow a confirmation-gated action
 * targets, {@link FlowStartDoor.actionDeclarations}), then rule 3 (the flow's
 * `requiredPermissions`).
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
 *    parent is untouched by every rule — the check lives at the doors
 *    precisely so that path stays open. The parent's own start was the door.
 *  - **A flow that declares no `requiredPermissions`** (or an empty list) and is
 *    not elevated-and-self-triggered: admitted, as before — for every caller
 *    but an AI service account at an elevated flow, which rule 2 judges.
 *  - **A person, and an OAuth-delegated agent**, are not judged by rule 2 or
 *    rule 2b: each reads the account alone ({@link isAiServiceAccount}). The delegated
 *    agent's token is honoured on the MCP endpoint only, where `run_action`
 *    asks the opt-in of every action.
 *  - **A flow that runs as the user**: an account starts it as before, and the
 *    run holds the account's own grants under the agent ceiling (ADR-0151 D3).
 *
 * Reads the flow through the automation service's own `getFlow` — the probe
 * `flowIsUnknown` (`flow-dispatch-status.ts`) uses, which serves the same
 * definition `execute` runs — so there is no second loader. `getFlow` is
 * optional on `IAutomationService`; an implementation that omits it, or a
 * definition the probe does not return, cannot be asked rules 1, 2 and 3, and
 * the door dispatches as before, exactly as the existence check does. Rule 2b
 * reads no definition and is asked either way.
 */
export async function flowStartRefusal(
    automation: unknown,
    flowName: string,
    executionContext:
        | { isSystem?: boolean; systemPermissions?: readonly string[]; principalKind?: unknown; onBehalfOf?: unknown }
        | null
        | undefined,
    door: FlowStartDoor,
): Promise<FlowStartRefusal | null> {
    if (executionContext?.isSystem === true) return null;
    const svc = automation as { getFlow?: (name: string) => Promise<unknown> } | null | undefined;
    // Rules 1, 2 and 3 read the definition; a service without `getFlow`, or a
    // definition the probe does not return, cannot be asked them.
    const flow = typeof svc?.getFlow === 'function'
        ? (await svc.getFlow(flowName)) as
            | { type?: FlowParsed['type']; runAs?: unknown; requiredPermissions?: unknown }
            | null
            | undefined
        : undefined;
    if (flow && isElevatedSelfTriggered(flow)) return ELEVATED_START_REFUSAL;
    // [ADR-0151 Non-goals; ruling record 6812617393, letter C] Rule 2: the
    // account starts an elevated flow only where the author's AI opt-in stands.
    const accountRefusal = flow ? aiAccountElevatedStartRefusal(flow, executionContext, door.aiExposed) : null;
    if (accountRefusal) return accountRefusal;
    // [ADR-0151 D3 rule 3] Rule 2b: the confirmation an action declares
    // travels with what it starts. It reads the flow's NAME and the door's
    // declarations only, so it is asked whether or not the definition could
    // be read. Asked of an account alone, so the declarations are read for no
    // other caller; nothing the request carries is read here, so no
    // confirmation member admits an account.
    if (isAiServiceAccount(executionContext) && door.actionDeclarations) {
        let declarations: readonly FlowStartActionDeclaration[];
        try {
            declarations = await door.actionDeclarations();
        } catch {
            // The read did not happen: refused, never admitted on a guess.
            return DECLARATION_READ_FAILED_REFUSAL;
        }
        const gated = confirmationGatedStarterOf(declarations, flowName);
        if (gated) return confirmationGatedStartRefusal(gated);
    }
    if (!flow) return null;
    return requiredPermissionsStartRefusal(flow, executionContext);
}
