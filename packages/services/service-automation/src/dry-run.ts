// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * {@link AutomationEngine.dryRun}: run a flow definition that need not be
 * published, once, unarmed, as a named user, against a supplied start, without
 * changing live data. The contract is `IAutomationService.dryRun`'s docblock
 * (`@objectstack/spec/contracts`, `automation-service.ts`); this module is its
 * implementation, and every sentence below points at the sentence it honours.
 *
 * ## How a dry run runs the nodes
 *
 * Through the live run's OWN traversal: the bodies of `executeNode` and
 * `traverseNext` (`dag-traversal.ts`), handed a host whose executor map is
 * this module's. So edges, conditions, `fault` routing, `try_catch` regions
 * and the runaway guard behave exactly as they do live, and nothing here
 * re-spells them.
 *
 *  - The nodes that route or compute (`decision`, `assignment`, `loop`,
 *    `parallel`, `try_catch`) run their registered executors, "as the live run
 *    runs them". A container's body runs through `AutomationEngine.runRegion`,
 *    which asks {@link activeDryRunExecuteNode} and so stays inside the dry
 *    run.
 *  - `get_record`, `create_record`, `update_record` and `delete_record` run
 *    their registered executors too, which compute the filter and the field
 *    values as live; the data engine they reach is {@link dryRunDataEngine}'s
 *    stand-in, which reads live data and simulates every write.
 *  - The nodes with an effect outside the data are never called: their payload
 *    is computed from the node's own value and text slots (the spec ledgers
 *    `FLOW_NODE_EXPRESSION_PATHS` and `FLOW_NODE_TEXT_SLOTS`) and reported.
 *  - A node whose descriptor declares `supportsPause: true`, and a node type
 *    outside every class the contract names, stops the run.
 *
 * ## Why an `AsyncLocalStorage`
 *
 * A container executor and a data node reach the engine and the data engine
 * through what they closed over at registration, not through an argument, so
 * the dry run is found by the async context it runs in: the frame is set
 * around the traversal and nowhere else, and a live run on the same engine at
 * the same time never sees it. The same idiom as `builtin/loop-frame.ts`.
 *
 * ## Step order
 *
 * Each node execution opens a segment under the segment of the node that
 * called it, at the moment it is called, so a node's successors, a container's
 * body and a `parallel` node's branches hang under it in call order. The steps
 * are the segments read depth-first: a node's unconditional out-edges are one
 * branch after another in declaration order, each branch's steps together.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { FlowEdgeParsed, FlowNodeParsed, FlowParsed } from '@objectstack/spec/automation';
import { flowNodeTextSlotSources, resolveFlowNodeExpressions } from '@objectstack/spec/automation';
import type { FlowInnerRefusal } from '@objectstack/spec/api';
import type {
    AutomationContext,
    FlowDryRunOptions,
    FlowDryRunResult,
    FlowDryRunStep,
    FlowDryRunStopStep,
    FlowDryRunWritePermission,
} from '@objectstack/spec/contracts';
import { aiAccountElevatedStartRefusal, requiredPermissionsStartRefusal } from '@objectstack/core';
import {
    executeNode as executeNodeBody,
    startConditionHolds,
    traverseNext as traverseNextBody,
} from './dag-traversal.js';
import {
    isRefusalSignal,
    isSuspendSignal,
    type AutomationEngine,
    type FlowUserGrants,
    type NodeExecutionResult,
    type NodeExecutor,
    type StepLogEntry,
} from './engine.js';
import { renderTextSlot } from './builtin/template.js';
import { isSkippedScopeKey } from './scope-key-segments.js';
import { renderSaveNoticeMessage } from './builtin/save-notice-node.js';
import {
    engineUpdateDispatchRejectError,
    resolveEngineDeleteDispatch,
    resolveEngineUpdateDispatch,
    type EngineDeleteDispatchInput,
    type EngineUpdateDispatchData,
    type EngineUpdateDispatchInput,
} from '@objectstack/metadata-core';
import { readCarriedRefusal } from './inner-refusal.js';

/** The nodes that only route the run (`FlowDryRunRouteStep`). */
const ROUTE_NODE_TYPES: ReadonlySet<string> = new Set(['start', 'end', 'loop', 'parallel', 'try_catch']);
/** The data writes (`FlowDryRunWriteStep`), by the operation each reports. */
const WRITE_NODE_OPERATIONS: Readonly<Record<string, 'create' | 'update' | 'delete'>> = {
    create_record: 'create',
    update_record: 'update',
    delete_record: 'delete',
};
/** The nodes with an effect outside the data (`FlowDryRunOutboundStep`). */
const OUTBOUND_NODE_TYPES: ReadonlySet<string> = new Set(['notify', 'http', 'connector_action', 'script', 'save_notice']);
/** The `stop` reason a pausing node type reports (`FlowDryRunStopStep.reason`). */
const STOP_REASONS: Readonly<Record<string, FlowDryRunStopStep['reason']>> = {
    approval: 'approval',
    approval_revise: 'approval',
    wait: 'wait',
    screen: 'screen',
    subflow: 'starts_flow',
    map: 'starts_flow',
};

/**
 * The `AutomationEngine` members a dry run reads, each typed as the member
 * itself (the `DagTraversalHost` idiom), handed by {@link AutomationEngine.dryRun}.
 */
export interface DryRunHost {
    readonly logger: AutomationEngine['logger'];
    readonly nodeExecutors: ReadonlyMap<string, NodeExecutor>;
    readonly userGrantsResolver: () => AutomationEngine['userGrantsResolver'];
    readonly judgeFlowRegistration: AutomationEngine['judgeFlowRegistration'];
    readonly resolveRunContext: AutomationEngine['resolveRunContext'];
    readonly seedRunVariables: AutomationEngine['seedRunVariables'];
    readonly evaluateCondition: AutomationEngine['evaluateCondition'];
    readonly evaluateValueEnvelope: AutomationEngine['evaluateValueEnvelope'];
    readonly validateNodeInputSchemas: AutomationEngine['validateNodeInputSchemas'];
    readonly isInputSchemaViolation: (err: unknown) => boolean;
    readonly getActionDescriptor: AutomationEngine['getActionDescriptor'];
    readonly renderRefusalMessage: AutomationEngine['renderRefusalMessage'];
    readonly renderFlowTextSlot: AutomationEngine['renderFlowTextSlot'];
    readonly executeWithTimeout: AutomationEngine['executeWithTimeout'];
    readonly setNodeError: AutomationEngine['setNodeError'];
}

type MutableStep = { -readonly [K in keyof FlowDryRunStep]?: unknown } & {
    nodeId: string;
    nodeType: string;
    kind: FlowDryRunStep['kind'];
    [key: string]: unknown;
};

interface Segment {
    readonly parent?: Segment;
    readonly node?: FlowNodeParsed;
    readonly flow?: FlowParsed;
    readonly step?: MutableStep;
    readonly children: Segment[];
}

interface DryRunState {
    readonly host: DryRunHost;
    /** The definition's own `name`: the flow its nodes read their `flows.<flow>.…` keys under (the contract's **The name.**). */
    readonly flowName: string;
    readonly root: Segment;
    /** Set once a node stops the run (`'stopped'`), or the run ended: no node runs after it. */
    halted: boolean;
    stoppedAt?: Segment;
    /** The node whose failure is travelling out (containers it passes through do not replace it). */
    failedAt?: Segment;
    /** The run's simulated rows, by object. */
    readonly created: Map<string, Map<string, Record<string, unknown>>>;
    readonly updated: Map<string, Map<string, Record<string, unknown>>>;
    readonly deleted: Map<string, Set<string>>;
    readonly placeholderPrefix: string;
    placeholderCount: number;
}

interface DryRunFrame {
    readonly state: DryRunState;
    readonly segment: Segment;
}

const frames = new AsyncLocalStorage<DryRunFrame>();

/** What a write step reports, filled by the data engine stand-in. */
interface SimulatedWrite {
    operation: 'create' | 'update' | 'delete';
    object: string;
    recordIds: string[];
    values?: Record<string, unknown>;
    permission: FlowDryRunWritePermission;
}

/**
 * The `executeNode` a container's region runs its body through while a dry
 * run is in progress, or `undefined` outside one. Asked by
 * `AutomationEngine.runRegion`, so a `loop`, `parallel` or `try_catch` body
 * stays inside the dry run.
 */
export function activeDryRunExecuteNode():
    | ((node: FlowNodeParsed, flow: FlowParsed, variables: Map<string, unknown>, context: AutomationContext, steps: StepLogEntry[]) => Promise<void>)
    | undefined {
    const frame = frames.getStore();
    if (!frame) return undefined;
    const { state } = frame;
    return (node, flow, variables, context, steps) => dryExecuteNode(state, node, flow, variables, context, steps);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The single id a `where` names (`{ id: X }`), or `undefined` for a filter that names none. */
function namedId(where: unknown): string | undefined {
    if (!isPlainObject(where)) return undefined;
    const keys = Object.keys(where);
    if (keys.length !== 1 || keys[0] !== 'id') return undefined;
    const id = where.id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

function project(row: Record<string, unknown>, fields: unknown): Record<string, unknown> {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out: Record<string, unknown> = {};
    for (const f of ['id', ...fields]) if (typeof f === 'string' && f in row) out[f] = row[f];
    return out;
}

/** The refusal a write the object-level check refuses answers (`PERMISSION_DENIED`, 403). */
function writeRefusedError(operation: 'insert' | 'update', object: string): Error {
    return Object.assign(
        new Error(`The named user may not ${operation} '${object}' records (object-level write check).`),
        { status: 403, code: 'PERMISSION_DENIED' },
    );
}

type DataEngineLike = Record<string, unknown> & {
    find?: (object: string, query?: Record<string, unknown>) => Promise<unknown>;
    findOne?: (object: string, query?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * The data engine a CRUD node reaches while a dry run is in progress, or
 * `undefined` outside one (the node then uses `real` as always). Called by the
 * CRUD executors' data lookup (`builtin/crud-nodes.ts`).
 *
 *  - Writes are simulated ("Writes: simulated, never made"): `insert`,
 *    `update` and `delete` write nothing, record the write on the node's step,
 *    and lay it over the run's own view of the rows. An update or a delete
 *    targets exactly the rows the engine's own dispatch picks.
 *  - A read that names an id answers the run's view: a created row holds only
 *    the fields the flow set, an updated row is the live row with the
 *    simulated fields laid over it, a deleted row is nothing.
 *  - Any other read passes to the live engine, in the scope the node hands it
 *    (the named user's), and does not see the run's simulated writes.
 *  - `canWriteObject`, read off the `security` service the kernel serves
 *    (`security()`), judges an insert or an update, and a check that throws
 *    is a denial (`'refused'`); with none installed, or for a delete, the
 *    write answers `'not_judged'`.
 */
export function dryRunDataEngine(real: unknown, security: () => unknown): unknown {
    const frame = frames.getStore();
    if (!frame) return undefined;
    const { state } = frame;
    const live = (real ?? undefined) as DataEngineLike | undefined;

    const judge = async (
        operation: 'insert' | 'update',
        object: string,
        context: unknown,
        data: unknown,
    ): Promise<FlowDryRunWritePermission> => {
        let svc: unknown;
        try { svc = security(); } catch { svc = undefined; }
        const check = (svc as { canWriteObject?: unknown } | undefined)?.canWriteObject;
        if (typeof check !== 'function') return 'not_judged';
        try {
            const allowed = await (check as (o: string, op: string, c: unknown, d: unknown) => Promise<boolean>)
                .call(svc, object, operation, context, data);
            return allowed ? 'allowed' : 'refused';
        } catch {
            // The check's own contract: a throw is a denial.
            return 'refused';
        }
    };

    const readById = async (object: string, id: string, query: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
        if (state.deleted.get(object)?.has(id)) return null;
        const created = state.created.get(object)?.get(id);
        if (created) return project(created, query.fields);
        const row = live?.findOne ? await live.findOne(object, query) : null;
        if (!isPlainObject(row)) return null;
        const patch = state.updated.get(object)?.get(id);
        return patch ? { ...row, ...project(patch, query.fields) } : row;
    };

    /**
     * The rows a write targets: exactly the engine dispatch's own answer
     * (`resolveEngineUpdateDispatch` / `resolveEngineDeleteDispatch`), so
     * `recordIds` is "the rows the write targets" on every arm. `by-id` is
     * the one id the dispatch picked, wherever it came from (`where.id`, or
     * an update's `data.id`), when the named user can read it; `multi` is
     * the rows the filter matches in the named user's scope; `reject`
     * targets no row and reads none.
     */
    const targets = async (
        object: string,
        dispatch: { readonly kind: 'by-id'; readonly id: unknown } | { readonly kind: 'multi' } | { readonly kind: 'reject' },
        where: unknown,
        context: unknown,
    ): Promise<string[]> => {
        if (dispatch.kind === 'reject') return [];
        if (dispatch.kind === 'by-id') {
            const id = String(dispatch.id);
            if (state.deleted.get(object)?.has(id)) return [];
            if (state.created.get(object)?.has(id)) return [id];
            const row = live?.findOne ? await live.findOne(object, { where: { id: dispatch.id }, fields: ['id'], context }) : null;
            return isPlainObject(row) ? [id] : [];
        }
        const rows = live?.find ? await live.find(object, { where, fields: ['id'], context }) : [];
        return Array.isArray(rows)
            ? rows.map((r) => (isPlainObject(r) ? r.id : undefined)).filter((v) => v != null).map(String)
            : [];
    };

    const record = (write: SimulatedWrite): void => {
        const seg = frames.getStore()?.segment;
        if (seg?.step) (seg as { write?: SimulatedWrite }).write = write;
    };

    const overrides: Record<string, unknown> = {
        async insert(object: string, data: unknown, options?: { context?: unknown }) {
            const values = isPlainObject(data) ? { ...data } : {};
            const permission = await judge('insert', object, options?.context, data);
            const id = `${state.placeholderPrefix}${++state.placeholderCount}`;
            record({ operation: 'create', object, recordIds: [id], values, permission });
            if (permission === 'refused') throw writeRefusedError('insert', object);
            let rows = state.created.get(object);
            if (!rows) state.created.set(object, (rows = new Map()));
            rows.set(id, { ...values, id });
            return { ...values, id };
        },
        async update(object: string, data: unknown, options?: { where?: unknown; context?: unknown }) {
            const values = isPlainObject(data) ? { ...data } : {};
            // The engine's own dispatch decision, asked as the live update
            // asks it, and its targets read off that answer: one row by id
            // (from `where.id` or the values' own `id`), the filter's rows
            // under `multi`, and none on a reject — a call naming neither one
            // row nor `multi` is refused with the engine's own error, after
            // the permission gate and before any row is read.
            const dispatch = resolveEngineUpdateDispatch(data as EngineUpdateDispatchData, options as EngineUpdateDispatchInput | undefined);
            const ids = await targets(object, dispatch, options?.where, options?.context);
            const permission = await judge('update', object, options?.context, data);
            record({ operation: 'update', object, recordIds: ids, values, permission });
            if (permission === 'refused') throw writeRefusedError('update', object);
            if (dispatch.kind === 'reject') throw engineUpdateDispatchRejectError(dispatch);
            for (const id of ids) {
                const created = state.created.get(object)?.get(id);
                if (created) { Object.assign(created, values); continue; }
                let patches = state.updated.get(object);
                if (!patches) state.updated.set(object, (patches = new Map()));
                patches.set(id, { ...(patches.get(id) ?? {}), ...values });
            }
            return ids.length;
        },
        async delete(object: string, options?: { where?: unknown; context?: unknown }) {
            // As `update`: the engine's own dispatch decision, its targets,
            // and its own error. A delete's by-id arm reads `where.id` only.
            const dispatch = resolveEngineDeleteDispatch(options as EngineDeleteDispatchInput | undefined);
            const ids = await targets(object, dispatch, options?.where, options?.context);
            record({ operation: 'delete', object, recordIds: ids, permission: 'not_judged' });
            if (dispatch.kind === 'reject') throw new Error(dispatch.message);
            let gone = state.deleted.get(object);
            if (!gone) state.deleted.set(object, (gone = new Set()));
            for (const id of ids) gone.add(id);
            return ids.length;
        },
        async findOne(object: string, query: Record<string, unknown> = {}) {
            const id = namedId(query.where);
            if (id !== undefined) return readById(object, id, query);
            return live?.findOne ? live.findOne(object, query) : null;
        },
        async find(object: string, query: Record<string, unknown> = {}) {
            const id = namedId(query.where);
            if (id !== undefined) {
                const row = await readById(object, id, query);
                return row ? [row] : [];
            }
            return live?.find ? live.find(object, query) : [];
        },
    };

    return new Proxy(live ?? {}, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop];
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/** The node's class, and the step it opens with. */
function openStep(state: DryRunState, node: FlowNodeParsed): MutableStep {
    const base = { nodeId: node.id, nodeType: node.type };
    if (ROUTE_NODE_TYPES.has(node.type)) return { ...base, kind: 'route' };
    if (node.type === 'assignment') return { ...base, kind: 'assignment', values: {} };
    if (node.type === 'decision') return { ...base, kind: 'decision', expressions: [], next: [] };
    if (node.type === 'get_record') {
        return { ...base, kind: 'read', object: String((node.config as { objectName?: unknown } | undefined)?.objectName ?? ''), recordIds: [] };
    }
    if (WRITE_NODE_OPERATIONS[node.type]) return { ...base, kind: 'write' };
    if (OUTBOUND_NODE_TYPES.has(node.type)) return { ...base, kind: 'outbound', payload: undefined };
    const pauses = state.host.getActionDescriptor(node.type)?.supportsPause === true;
    return { ...base, kind: 'stop', reason: pauses ? (STOP_REASONS[node.type] ?? 'suspends') : 'not_simulated' };
}

function isAncestor(maybe: Segment, of: Segment): boolean {
    for (let s: Segment | undefined = of.parent; s; s = s.parent) if (s === maybe) return true;
    return false;
}

/** Record a failure on `segment`'s step, unless it is a container the failure is travelling out through. */
function noteFailure(state: DryRunState, segment: Segment, failure: { refusal?: FlowInnerRefusal; error?: string }): void {
    const step = segment.step;
    if (!step) return;
    if (failure.refusal) step.refusal = failure.refusal;
    else if (step.refusal === undefined && failure.error !== undefined) step.error = failure.error;
    if (!state.failedAt || !isAncestor(segment, state.failedAt)) state.failedAt = segment;
}

/** One node execution, in its own segment, through the live run's own `executeNode` body. */
function dryExecuteNode(
    state: DryRunState,
    node: FlowNodeParsed,
    flow: FlowParsed,
    variables: Map<string, unknown>,
    context: AutomationContext,
    steps: StepLogEntry[],
): Promise<void> {
    if (state.halted) return Promise.resolve();
    const parent = frames.getStore()?.segment ?? state.root;
    const segment: Segment = { parent, node, flow, step: openStep(state, node), children: [] };
    parent.children.push(segment);
    const nodeHost: ThisParameterType<typeof executeNodeBody> = {
        renderRefusalMessage: state.host.renderRefusalMessage,
        nodeExecutors: dryExecutorView(state),
        executeWithTimeout: state.host.executeWithTimeout,
        setNodeError: state.host.setNodeError,
        executeNode: (...a) => dryExecuteNode(state, ...a),
        // The dry executors decide their own stops (`supportsPause` and the
        // types no class names), so the live run's declaration check on a
        // suspension has nothing to judge here.
        refuseUndeclaredSuspension: () => null,
        traverseNext: (...a) => traverseNextBody.call(traverseHost(state), ...a),
    };
    return frames.run({ state, segment }, () => executeNodeBody.call(nodeHost, node, flow, variables, context, steps));
}

function traverseHost(state: DryRunState): ThisParameterType<typeof traverseNextBody> {
    return {
        logger: state.host.logger,
        evaluateCondition: state.host.evaluateCondition,
        executeNode: (...a) => dryExecuteNode(state, ...a),
    };
}

/** The executor map `executeNode`'s body reads during a dry run: one dry executor per type. */
function dryExecutorView(state: DryRunState): Map<string, NodeExecutor> {
    const view = new Map<string, NodeExecutor>();
    view.get = (type: string): NodeExecutor | undefined => dryExecutor(state, type);
    return view;
}

function currentSegment(): Segment | undefined {
    return frames.getStore()?.segment;
}

function dryExecutor(state: DryRunState, type: string): NodeExecutor | undefined {
    const segment = currentSegment();
    const step = segment?.step;
    if (!segment || !step) return undefined;

    if (type === 'start') return { type, execute: async () => ({ success: true }) };

    if (step.kind === 'outbound') {
        return {
            type,
            async execute(node, variables, context) {
                try {
                    step.payload = outboundPayload(state, node, variables, context);
                } catch (err) {
                    noteFailure(state, segment, { error: err instanceof Error ? err.message : String(err) });
                    throw err;
                }
                // "binds no output": a later node that reads it finds it unset.
                return { success: true };
            },
        };
    }

    if (step.kind === 'stop') {
        return {
            type,
            async execute(node, variables, context) {
                const stop = step as unknown as FlowDryRunStopStep;
                if (stop.reason === 'wait') {
                    const wait = (node as { waitEventConfig?: { eventType?: unknown; timerDuration?: unknown; signalName?: unknown } }).waitEventConfig;
                    if (wait && typeof wait.eventType === 'string') {
                        stop.wait = {
                            eventType: wait.eventType,
                            ...(typeof wait.timerDuration === 'string' ? { timerDuration: wait.timerDuration } : {}),
                            ...(typeof wait.signalName === 'string' ? { signalName: wait.signalName } : {}),
                        };
                    }
                } else if (stop.reason === 'starts_flow') {
                    const flowName = (node.config as { flowName?: unknown } | undefined)?.flowName;
                    if (typeof flowName === 'string' && flowName) stop.flowName = flowName;
                } else if (stop.reason === 'screen') {
                    // The screen executor only builds the screen it hands the
                    // runner; nothing is stored until a run parks, and a dry
                    // run parks nothing.
                    const screen = state.host.nodeExecutors.get('screen');
                    if (screen) {
                        let built: NodeExecutionResult;
                        try {
                            built = await screen.execute(node, variables, context);
                        } catch (err) {
                            noteFailure(state, segment, { error: err instanceof Error ? err.message : String(err) });
                            throw err;
                        }
                        if (!built.success) {
                            noteFailure(state, segment, { error: built.error ?? 'Unknown error' });
                            return built;
                        }
                        if (built.screen) stop.screen = built.screen;
                    }
                }
                state.halted = true;
                state.stoppedAt = segment;
                return { success: true, suspend: true };
            },
        };
    }

    const real = state.host.nodeExecutors.get(type);
    if (!real) {
        // As live: no executor for a type that needs one fails the node.
        noteFailure(state, segment, { error: `No executor registered for node type '${type}'` });
        return undefined;
    }
    return {
        type,
        descriptor: real.descriptor,
        async execute(node, variables, context) {
            let result: NodeExecutionResult;
            try {
                if (step.kind === 'assignment') {
                    // Every variable the node sets, with the value it set.
                    // An assignment sets synchronously, so the recorder is
                    // removed before any other branch can run.
                    const values = step.values as Record<string, unknown>;
                    const set = variables.set;
                    variables.set = function recordSet(key: string, value: unknown) {
                        values[key] = value;
                        return set.call(this, key, value);
                    };
                    let pending: Promise<NodeExecutionResult>;
                    try {
                        pending = real.execute(node, variables, context);
                    } finally {
                        variables.set = set;
                    }
                    result = await pending;
                } else {
                    result = await real.execute(node, variables, context);
                }
            } catch (err) {
                if (!state.stoppedAt && !isSuspendSignal(err)) {
                    const { innerRefusal } = readCarriedRefusal(err);
                    noteFailure(state, segment, {
                        ...(innerRefusal ? { refusal: innerRefusal } : {}),
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                throw err;
            }
            annotate(state, segment, node, result);
            return result;
        },
    };
}

function annotate(state: DryRunState, segment: Segment, node: FlowNodeParsed, result: NodeExecutionResult): void {
    const step = segment.step!;
    if (!result.success) {
        noteFailure(state, segment, {
            ...(result.innerRefusal ? { refusal: result.innerRefusal } : {}),
            error: result.error ?? 'Unknown error',
        });
    }
    if (step.kind === 'decision') {
        const conditions = (node.config as { conditions?: Array<{ label?: string; expression?: string }> } | undefined)?.conditions;
        if (Array.isArray(conditions) && conditions.length > 0 && typeof result.branchLabel === 'string') {
            step.branch = result.branchLabel;
            const held = conditions.find((c) => c.label === result.branchLabel);
            step.expressions = held && typeof held.expression === 'string' ? [held.expression] : [];
        }
    } else if (step.kind === 'read' && result.success) {
        const output = result.output as { records?: unknown; record?: unknown } | undefined;
        const rows = Array.isArray(output?.records) ? output.records : output?.record ? [output.record] : [];
        step.recordIds = rows
            .map((r) => (isPlainObject(r) ? r.id : undefined))
            .filter((v) => v != null)
            .map(String);
    }
}

/**
 * Write the value at a ledger path (`a.b`, `list[1]`, `input.key`) into `root`.
 *
 * No authored key reaches a prototype (the rule `./scope-key-segments.ts`
 * states): a path with a skipped segment is written nowhere, and the walk
 * descends through own properties only, so a segment the path's re-split
 * produced that `root` does not hold ends the write instead of resolving
 * through an inherited slot. A slot left unwritten keeps its authored value in
 * the payload.
 */
function setAtPath(root: Record<string, unknown>, path: string, value: unknown): void {
    const parts: Array<string | number> = [];
    for (const segment of path.split('.')) {
        const match = /^(.*?)((?:\[\d+\])*)$/.exec(segment);
        if (match?.[1]) parts.push(match[1]);
        for (const idx of match?.[2]?.matchAll(/\[(\d+)\]/g) ?? []) parts.push(Number(idx[1]));
    }
    if (isSkippedScopeKey(parts.filter((part): part is string => typeof part === 'string'))) return;
    let cursor: unknown = root;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!Object.prototype.hasOwnProperty.call(cursor, parts[i])) return;
        cursor = (cursor as Record<string | number, unknown>)[parts[i]];
        if (cursor === null || typeof cursor !== 'object') return;
    }
    (cursor as Record<string | number, unknown>)[parts[parts.length - 1]] = value;
}

/**
 * What an outbound node would send, as it computed it: its config (and, for
 * `connector_action`, its `connectorConfig`), with every CEL value slot
 * evaluated and every text slot rendered in the run's scope. The slots are the
 * spec's ledgers, the ones registration judges and the executors read.
 *
 * Each text slot renders as its live executor renders it, in the same locale
 * (`options.locale`, on the run's context). Measured: the `notify` executor
 * renders `title`, `message` and `actionUrl`, and the `http` executor `url`
 * and each `headers` value, through `renderTextSlot` with no translation, so
 * they render the authored text here too. The `save_notice` executor
 * translates its `message` (`flows.<flow>.notices.<node_id>.message`), so it
 * is rendered here by that executor's own {@link renderSaveNoticeMessage},
 * under the definition's own name, never by a second lookup.
 */
function outboundPayload(
    state: DryRunState,
    node: FlowNodeParsed,
    variables: Map<string, unknown>,
    context: AutomationContext,
): unknown {
    const blocks: Record<string, unknown> = {
        config: structuredClone(node.config ?? {}),
        ...(node.type === 'connector_action' ? { connectorConfig: structuredClone((node as { connectorConfig?: unknown }).connectorConfig ?? {}) } : {}),
    };
    for (const slot of resolveFlowNodeExpressions(node.type, node.config, node as never)) {
        if (slot.entry.role !== 'value') continue;
        const value = state.host.evaluateValueEnvelope(
            slot.value as { dialect?: string; source?: string },
            variables,
            `${slot.block}.${slot.path}`,
            context,
        );
        const block = blocks[slot.block];
        if (isPlainObject(block)) setAtPath(block, slot.path, value);
    }
    const renderSlot = (path: string, source: string): string | undefined => (
        node.type === 'save_notice' && path === 'message'
            ? renderSaveNoticeMessage(state.host, state.flowName, node.id, source, variables, context)
            : renderTextSlot(source, variables, context.currency)
    );
    for (const slot of flowNodeTextSlotSources(node.type, node.config)) {
        const config = blocks.config as Record<string, unknown>;
        if (slot.path.includes('.')) {
            const dot = slot.path.indexOf('.');
            const map = config[slot.path.slice(0, dot)];
            if (isPlainObject(map)) map[slot.path.slice(dot + 1)] = renderSlot(slot.path, slot.source);
        } else {
            config[slot.path] = renderSlot(slot.path, slot.source);
        }
    }
    return node.type === 'connector_action' ? blocks : blocks.config;
}

/** The authored text of a condition (its `source`, for an envelope). */
function conditionText(condition: unknown): string {
    if (typeof condition === 'string') return condition;
    const source = (condition as { source?: unknown } | null | undefined)?.source;
    return typeof source === 'string' ? source : '';
}

/** The steps, read off the segments depth-first, finished. */
function finish(state: DryRunState, until?: Segment): FlowDryRunStep[] {
    const out: FlowDryRunStep[] = [];
    let done = false;
    const visit = (segment: Segment): void => {
        if (done) return;
        if (segment.step) {
            out.push(finishStep(segment));
            if (segment === until) { done = true; return; }
        }
        for (const child of segment.children) visit(child);
    };
    visit(state.root);
    return out;
}

function finishStep(segment: Segment): FlowDryRunStep {
    const step = segment.step!;
    const node = segment.node!;
    if (step.kind === 'decision') {
        const next = segment.children.map((c) => c.node!.id);
        step.next = next;
        const conditions = (node.config as { conditions?: unknown[] } | undefined)?.conditions;
        if (!(Array.isArray(conditions) && conditions.length > 0)) {
            // A gateway: the out-edges carry the branching, so the
            // expressions are the conditioned out-edges the run took.
            const edges: FlowEdgeParsed[] = (segment.flow?.edges ?? []).filter(
                (e) => e.source === node.id && e.type !== 'fault' && e.condition && next.includes(e.target),
            );
            step.expressions = edges.map((e) => conditionText(e.condition));
        }
    } else if (step.kind === 'write') {
        const write = (segment as { write?: SimulatedWrite }).write;
        const config = node.config as { objectName?: unknown } | undefined;
        step.operation = write?.operation ?? WRITE_NODE_OPERATIONS[node.type];
        step.object = write?.object ?? String(config?.objectName ?? '');
        step.recordIds = write?.recordIds ?? [];
        if (write?.values && step.operation !== 'delete') step.values = write.values;
        step.permission = write?.permission ?? 'not_judged';
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(step)) if (value !== undefined) out[key] = value;
    return out as unknown as FlowDryRunStep;
}

/** The body of {@link AutomationEngine.dryRun}; that method's docblock is its contract. */
export async function dryRun(this: DryRunHost, definition: unknown, options: FlowDryRunOptions): Promise<FlowDryRunResult> {
    // "In what order it answers" — the acting user first, before the definition is read.
    const userId = (options as { userId?: unknown } | null | undefined)?.userId;
    if (typeof userId !== 'string' || userId === '') {
        throw new TypeError('dryRun: options.userId must be a non-empty string naming the acting user.');
    }
    // "The name": the definition's own, judged as registration judges it;
    // nothing is registered.
    const ownName = (definition as { name?: unknown } | null | undefined)?.name;
    const flow = this.judgeFlowRegistration(typeof ownName === 'string' ? ownName : '', definition);

    const tenantId = options.tenantId;
    const needsGrants = tenantId !== undefined || flow.runAs === 'system' || (Array.isArray(flow.requiredPermissions) && flow.requiredPermissions.length > 0);
    let grants: FlowUserGrants | undefined;
    const resolver = this.userGrantsResolver();
    if (needsGrants && resolver) {
        try {
            grants = (await resolver(userId, tenantId)) ?? undefined;
        } catch {
            // Unread grants admit nothing below: refused, never admitted on a guess.
            grants = undefined;
        }
    }
    const refused = (message: string): FlowDryRunResult => ({ status: 'refused', steps: [], refusal: { code: 'PERMISSION_DENIED', message } });
    if (tenantId !== undefined && !(Array.isArray(grants?.accessible_org_ids) && grants.accessible_org_ids.includes(tenantId))) {
        return refused(`The named user is not a member of organization '${tenantId}', so a dry run cannot run in it.`);
    }
    // "Admission: the by-name start rule" — the rules a start by name asks,
    // one spelling (`@objectstack/core`'s `flow-start-rules.ts`), judged on
    // the definition against the named user. A dry run starts with no action
    // in hand, so no AI opt-in stands. The elevated self-triggered rule is the
    // by-name doors' alone (ruling B, record 6917953931).
    // Every arm fails closed on unread grants: the tenant above (no
    // membership read), `requiredPermissions` (no capability read), and the AI
    // service account rule, which cannot tell an account from a person
    // without them, so a `runAs: 'system'` definition is refused here.
    if (needsGrants && grants === undefined && flow.runAs === 'system') {
        return refused("The named user's grants could not be read, so a dry run cannot admit a definition that runs as the system.");
    }
    const caller = {
        ...(grants?.principalKind ? { principalKind: grants.principalKind } : {}),
        systemPermissions: Array.isArray(grants?.systemPermissions) ? grants.systemPermissions : [],
    };
    const admission = aiAccountElevatedStartRefusal(flow, caller, false) ?? requiredPermissionsStartRefusal(flow, caller);
    if (admission) return refused(admission.message);

    // "Identity: the named user" — never elevated, `runAs: 'system'` included:
    // run setup resolves the user's own grants as for a user run whose context
    // carries none. No run id: nothing is persisted.
    const start: AutomationContext = {
        userId,
        ...(tenantId !== undefined ? { tenantId } : {}),
        ...(options.record !== undefined ? { record: options.record } : {}),
        ...(options.previous !== undefined ? { previous: options.previous } : {}),
        ...(options.object !== undefined ? { object: options.object } : {}),
        ...(options.event !== undefined ? { event: options.event } : {}),
        ...(options.params !== undefined ? { params: options.params } : {}),
        ...(options.locale !== undefined ? { locale: options.locale } : {}),
    };
    const variables: Map<string, unknown> = this.seedRunVariables(flow, flow.name, start, '');
    variables.delete('$runId');
    const runContext = await this.resolveRunContext({ ...flow, runAs: 'user' }, start);

    const startNode = flow.nodes.find((n) => n.type === 'start')!;
    const condition = (startNode.config as { condition?: unknown } | undefined)?.condition;
    try {
        if (!startConditionHolds.call({ evaluateCondition: this.evaluateCondition }, startNode, variables, runContext)) {
            return { status: 'condition_not_met', steps: [], startCondition: { expression: conditionText(condition), result: false } };
        }
    } catch (err) {
        const fault = err instanceof Error ? err.message : String(err);
        return { status: 'failed', steps: [], startCondition: { expression: conditionText(condition), fault }, error: fault };
    }
    try {
        this.validateNodeInputSchemas(flow, variables);
    } catch (err) {
        if (!this.isInputSchemaViolation(err)) throw err;
        return { status: 'refused', steps: [], refusal: { code: 'FLOW_INPUT_SCHEMA_INVALID', message: (err as Error).message } };
    }

    const state: DryRunState = {
        host: this,
        flowName: flow.name,
        root: { children: [] },
        halted: false,
        created: new Map(),
        updated: new Map(),
        deleted: new Map(),
        // Opaque, unique within the call, and never a live row's id.
        placeholderPrefix: `dry-run:${randomUUID()}:`,
        placeholderCount: 0,
    };
    try {
        await dryExecuteNode(state, startNode, flow, variables, runContext, []);
        state.halted = true;
        return { status: 'completed', steps: finish(state) };
    } catch (err) {
        state.halted = true;
        if (state.stoppedAt) return { status: 'stopped', steps: finish(state, state.stoppedAt) };
        if (isRefusalSignal(err)) {
            // An `end` declaring `outcome: 'refused'` completes; its step
            // carries the rendered message.
            const steps = finish(state);
            const end = [...steps].reverse().find((s) => s.nodeId === err.nodeId);
            if (end && end.kind === 'route' && err.message !== undefined) end.refusalMessage = err.message;
            return { status: 'completed', steps };
        }
        return {
            status: 'failed',
            steps: finish(state, state.failedAt),
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
