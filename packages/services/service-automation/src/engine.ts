// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { FlowParsed, FlowNodeParsed, FlowEdgeParsed } from '@objectstack/spec/automation';
import type { ExecutionLog, ActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext, AutomationResult, ResumeSignal, IAutomationService, ScreenSpec } from '@objectstack/spec/contracts';
import type { Logger } from '@objectstack/spec/contracts';
import { FlowSchema, FLOW_STRUCTURAL_NODE_TYPES, validateControlFlow, findRegionEntry, defineActionDescriptor } from '@objectstack/spec/automation';
import { applyConversionsToFlow } from '@objectstack/spec';
import type { FlowRegionParsed } from '@objectstack/spec/automation';
import type { Connector } from '@objectstack/spec/integration';
import { ConnectorSchema } from '@objectstack/spec/integration';
// Static import (not a lazy `require`): the engine ships as ESM ("type":"module"),
// where a CommonJS `require('@objectstack/formula')` resolves to tsup's throwing
// `__require` stub. That threw on every CEL evaluation and the catch below
// silently returned `false`, so EVERY start-node / edge condition (record-change
// `previous.*`, `budget > 100000`, …) skipped its flow. A static import binds the
// engine at module load in both ESM and CJS builds.
import { ExpressionEngine, validateExpression } from '@objectstack/formula';
import { runIsUnscopedUserMode, flowTouchesData } from './runtime-identity.js';

// ─── Node Executor Interface (Plugin Extension Point) ───────────────

/**
 * Each node type corresponds to a NodeExecutor.
 * Third-party plugins only need to implement this interface and register
 * it with the engine to extend automation capabilities.
 */
export interface NodeExecutor {
    /** Registry node type (built-in id or plugin-defined) */
    readonly type: string;

    /**
     * Optional ADR-0018 action descriptor. When present, it is published into
     * the engine's action registry and surfaced via {@link AutomationEngine.getActionDescriptors}
     * — feeding flow validation and the designer palette. Plugins SHOULD publish
     * one so their node appears in the palette and validates as a legal flow node.
     */
    readonly descriptor?: ActionDescriptor;

    /**
     * Execute a node
     * @param node - Current node definition
     * @param variables - Flow variable context (read/write)
     * @param context - Trigger context
     * @returns Execution result (may include output data, branch conditions, etc.)
     */
    execute(
        node: FlowNodeParsed,
        variables: Map<string, unknown>,
        context: AutomationContext,
    ): Promise<NodeExecutionResult>;
}

export interface NodeExecutionResult {
    success: boolean;
    output?: Record<string, unknown>;
    error?: string;
    /** Used by decision nodes — returns the selected branch label */
    branchLabel?: string;
    /**
     * ADR-0019 durable pause. When `true`, the node has done its on-entry work
     * (e.g. opened an approval request) and the run should **suspend** here: the
     * engine persists a continuation, stops traversal, and `execute()` returns
     * `{ status: 'paused', runId }`. The run is continued later via
     * {@link AutomationEngine.resume}. Any `output` is written to variables
     * before suspending. The node reads its own run id from the `$runId`
     * flow variable so it can map the run to external state.
     */
    suspend?: boolean;
    /**
     * Optional correlation key surfaced on the suspended-run record (e.g. an
     * approval request id). For observability / lookup; not required to resume.
     */
    correlation?: string;
    /**
     * Screen to render — set by a `screen` node that suspends to collect input.
     * Surfaced on the paused {@link AutomationResult} so a UI runner can render
     * the form and `resume()` with the values.
     */
    screen?: ScreenSpec;
    /**
     * #1479: step logs produced inside the node's structured region(s). A
     * container node (`loop` / `parallel` / `try_catch`) collects the
     * {@link AutomationEngine.runRegion} return value(s) here; {@link AutomationEngine.executeNode}
     * appends them to the parent run log right after the container's own step,
     * so per-iteration / per-branch body steps surface in run observability.
     */
    childSteps?: StepLogEntry[];
}

// ─── Trigger Interface (Plugin Extension Point) ─────────────────────

/**
 * A normalized description of *what* fires a flow, derived by the engine from
 * the flow's `start` node and handed to the matching {@link FlowTrigger} when a
 * flow is activated. Concrete triggers (record-change, schedule, …) read the
 * fields they care about and ignore the rest.
 *
 * The engine — not the trigger — owns parsing the start node, so trigger
 * plugins stay decoupled from flow-definition internals (mirrors how
 * `connector_action` keeps connectors decoupled from node config).
 */
export interface FlowTriggerBinding {
    /** Flow this binding activates. */
    readonly flowName: string;
    /** record-change: the object whose mutations fire the flow. */
    readonly object?: string;
    /** record-change: the start node's `triggerType` (e.g. 'record-after-update'). */
    readonly event?: string;
    /**
     * Optional trigger predicate copied from the start node's `condition`. The
     * engine evaluates it before running the flow; triggers may ignore it.
     */
    readonly condition?: string | { dialect?: string; source?: string; ast?: unknown };
    /** schedule: cron/interval descriptor (parsed but not yet acted on here). */
    readonly schedule?: unknown;
    /** The raw start-node `config`, for trigger-specific fields not modeled above. */
    readonly config?: Record<string, unknown>;
}

/**
 * Trigger interface. Schedule/Event/API triggers are registered via plugins.
 *
 * The engine completes the wiring: when a flow whose start node maps to this
 * trigger's {@link type} is registered (or when this trigger is registered
 * after such flows already exist), the engine calls {@link start} with the
 * parsed {@link FlowTriggerBinding} and a `callback` that runs the flow. The
 * trigger subscribes to its event source (e.g. an ObjectQL lifecycle hook) and
 * invokes `callback(ctx)` when it fires. {@link stop} tears that subscription
 * down when the flow is unregistered/disabled or the trigger is removed.
 */
export interface FlowTrigger {
    readonly type: string;
    start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>): void;
    stop(flowName: string): void;
}

// ─── Connector Registry (Plugin Extension Point) ────────────────────

/**
 * Context handed to a connector action handler. Carries the live flow variable
 * map and the trigger context so a handler can read prior-node output, plus a
 * logger. The platform ships the registry + the `connector_action` dispatch
 * node (baseline, ADR-0018 §Addendum); *concrete* connectors — `connector-rest`,
 * `connector-slack`, … — are plugins that register handlers here.
 */
export interface ConnectorActionContext {
    readonly variables: Map<string, unknown>;
    readonly automation: AutomationContext;
    readonly logger: Logger;
}

/**
 * A handler for one connector action. Receives the (already-resolved) input
 * mapped from the flow node and returns the action's output, which the
 * `connector_action` node writes back into flow variables.
 */
export type ConnectorActionHandler = (
    input: Record<string, unknown>,
    ctx: ConnectorActionContext,
) => Promise<Record<string, unknown>>;

/**
 * A connector registered on the engine: its validated {@link Connector}
 * definition plus the handler for each action it declares.
 */
export interface RegisteredConnector {
    readonly def: Connector;
    readonly handlers: Record<string, ConnectorActionHandler>;
}

/**
 * Context handed to a named handler function invoked from a `script` node
 * (#1870). Mirrors {@link ConnectorActionContext} but carries the node's mapped
 * `input` so the function reads its arguments without reaching into the raw
 * variable map. The function's return value becomes the node output.
 */
export interface FlowFunctionContext {
    /** Inputs mapped from the node's `config.inputs` (already in scope). */
    readonly input: Record<string, unknown>;
    /** Live flow variable map — read prior-node output / write results. */
    readonly variables: Map<string, unknown>;
    /** The flow execution / trigger context. */
    readonly automation: AutomationContext;
    readonly logger: Logger;
}

/**
 * A named handler function callable from a `script` node. Returns the node's
 * output (any JSON-serializable value); returning `undefined` yields an empty
 * output. Authored packages contribute these via `defineStack({ functions })`,
 * which the host bridges in through {@link AutomationEngine.setFunctionResolver}.
 */
export type FlowFunctionHandler = (ctx: FlowFunctionContext) => unknown | Promise<unknown>;

/**
 * Resolves a function name to its handler. Injected by the host (the automation
 * plugin bridges it to ObjectQL's `resolveFunction`, fed by `bundle.functions`),
 * so the engine stays decoupled from any specific function registry. Returns
 * `undefined` for an unknown name, letting the `script` node fail the step
 * loudly instead of silently no-op'ing (#1870).
 */
export type FlowFunctionResolver = (name: string) => FlowFunctionHandler | undefined;

/**
 * A designer-facing view of one connector action — identity + its JSON-Schema
 * input/output. The runtime handler is intentionally omitted; this is metadata.
 */
export interface ConnectorActionDescriptor {
    readonly key: string;
    readonly label: string;
    readonly description?: string;
    readonly inputSchema?: Record<string, unknown>;
    readonly outputSchema?: Record<string, unknown>;
}

/**
 * A designer-facing descriptor for a registered connector: its identity plus
 * the actions it exposes. Served by `GET /api/v1/automation/connectors` so the
 * flow designer can populate the `connector_action` node's connector → action
 * → input pickers (ADR-0018 §Addendum, ADR-0022). Mirrors `ActionDescriptor`'s
 * role for node types, but for the connector registry.
 */
export interface ConnectorDescriptor {
    readonly name: string;
    readonly label: string;
    readonly type: string;
    readonly description?: string;
    readonly icon?: string;
    readonly actions: ConnectorActionDescriptor[];
}

// ─── Core Automation Engine ─────────────────────────────────────────

/**
 * Default ceiling on the in-memory execution-log ring buffer. Execution logs are
 * process-local and diagnostic only (launch-readiness.md P1-2); the buffer keeps
 * the most recent N entries and evicts the oldest, so memory is bounded
 * regardless of throughput. Operators tune the window via
 * {@link AutomationServicePluginOptions.maxLogSize}. Durable, queryable run
 * history is the DB-backed `sys_automation_run` store (a post-GA HA item), not
 * this buffer.
 */
export const DEFAULT_MAX_EXECUTION_LOG_SIZE = 1000;

/**
 * Max steps persisted per terminal run-history row (#2585). The tail of the
 * step log is kept — the last steps carry the failure — so durable single-run
 * detail stays meaningful without letting a pathological loop-heavy run write
 * an unbounded `steps_json` column.
 */
export const MAX_PERSISTED_HISTORY_STEPS = 200;

/** Construction options for {@link AutomationEngine}. */
export interface AutomationEngineOptions {
    /**
     * Max in-memory execution-log entries retained (ring buffer; oldest evicted).
     * Defaults to {@link DEFAULT_MAX_EXECUTION_LOG_SIZE}. Must be > 0.
     */
    maxLogSize?: number;
}

/**
 * Execution step log entry. Part of a {@link SuspendedRun}'s persisted state, so
 * it survives serialization to a durable {@link SuspendedRunStore}.
 */
export interface StepLogEntry {
    nodeId: string;
    nodeType: string;
    nodeLabel?: string;
    status: 'success' | 'failure' | 'skipped';
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    error?: { code: string; message: string; stack?: string };
    /**
     * #1479: structured-region grouping. When a step ran inside a `loop` /
     * `parallel` / `try_catch` body region, these tag it with its **immediate**
     * container so run observability can distinguish per-iteration / per-branch
     * body steps from top-level ones. Set by {@link AutomationEngine.runRegion}
     * (innermost wins — never overwritten as steps bubble through nested regions).
     */
    parentNodeId?: string;
    /** Zero-based loop iteration or parallel branch index of the enclosing region. */
    iteration?: number;
    /** Which region kind the step ran in: `loop-body` | `parallel-branch` | `try` | `catch`. */
    regionKind?: string;
}

/**
 * Internal execution log entry — compatible with ExecutionLog from spec.
 */
interface ExecutionLogEntry {
    id: string;
    flowName: string;
    flowVersion?: number;
    status: ExecutionLog['status'];
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    trigger: { type: string; userId?: string; object?: string; recordId?: string };
    steps: StepLogEntry[];
    variables?: Record<string, unknown>;
    output?: unknown;
    error?: string;
}

/**
 * Internal sentinel thrown by {@link AutomationEngine.executeNode} when a node
 * signals `suspend`. It unwinds the synchronous DAG recursion up to
 * `execute()` / `resume()`, which converts it into a persisted continuation
 * rather than a failed run. (Not exported — callers see `status: 'paused'`.)
 *
 * NOTE: suspend is supported on the serial / main execution path. A node that
 * suspends inside a `Promise.all` parallel branch will unwind that branch, but
 * sibling parallel branches already in flight are not cancelled — durable
 * pause across parallel gateways is out of scope for ADR-0019 M1.
 */
class FlowSuspendSignal {
    readonly __flowSuspend = true as const;
    constructor(readonly nodeId: string, readonly correlation?: string, readonly screen?: ScreenSpec) {}
}

function isSuspendSignal(err: unknown): err is FlowSuspendSignal {
    return typeof err === 'object' && err !== null && (err as FlowSuspendSignal).__flowSuspend === true;
}

/**
 * A run paused at a node, awaiting {@link AutomationEngine.resume} (ADR-0019).
 *
 * Held in an in-memory hot cache and — when a {@link SuspendedRunStore} is
 * configured — mirrored to durable storage so the pause survives a process
 * restart. Every field is JSON-serializable (the engine's variable `Map` is
 * snapshotted as a plain object) so the whole record round-trips through a
 * store.
 */
export interface SuspendedRun {
    runId: string;
    flowName: string;
    flowVersion?: number;
    /** The node the run paused at; resume continues from its out-edges. */
    nodeId: string;
    /** Snapshot of the flow variable map at suspend time. */
    variables: Record<string, unknown>;
    steps: StepLogEntry[];
    context: AutomationContext;
    startedAt: string;
    startTime: number;
    correlation?: string;
    /** Screen the run paused on (screen-flow runtime), for re-fetch + UI render. */
    screen?: ScreenSpec;
}

/**
 * Pluggable durable store for suspended runs (ADR-0019). The engine persists a
 * {@link SuspendedRun} on suspend and deletes it on terminal completion; on
 * {@link AutomationEngine.resume} of a run not in the in-memory cache (e.g.
 * after a process restart) it rehydrates from here.
 *
 * The default is purely in-memory (no store); a host wires a DB-backed store
 * (`ObjectStoreSuspendedRunStore`, on `sys_automation_run`) for production /
 * serverless deployments where the process hibernates between suspend and
 * resume.
 */
/**
 * A terminal run summary persisted as durable run history (completed / failed)
 * for the "Runs" observability surface — distinct from a live {@link SuspendedRun}.
 */
export interface RunRecord {
    runId: string;
    flowName: string;
    flowVersion?: number;
    status: 'completed' | 'failed';
    startedAt: string;
    startTime?: number;
    /** When the run reached its terminal state. */
    finishedAt?: string;
    durationMs?: number;
    /** Failure reason for a `failed` run — what a designer needs to fix it. */
    error?: string;
    nodeId?: string;
    organizationId?: string | null;
    userId?: string | null;
    /**
     * Bounded per-node step log (see {@link AutomationEngine.compactStepsForHistory}),
     * so "which node blew up?" survives a restart. Optional — history rows
     * written before this field existed have none.
     */
    steps?: StepLogEntry[];
}

export interface SuspendedRunStore {
    /** Persist (insert or replace) a suspended run. */
    save(run: SuspendedRun): Promise<void>;
    /** Load a suspended run by id, or `null` if not stored. */
    load(runId: string): Promise<SuspendedRun | null>;
    /** Remove a suspended run's durable record (idempotent). */
    delete(runId: string): Promise<void>;
    /** List all currently-stored suspended runs. */
    list(): Promise<SuspendedRun[]>;
    /**
     * Persist a TERMINAL run (completed / failed) as durable history for the
     * "Runs" observability surface. Optional — the in-memory / test defaults
     * still work without it. Implementations MUST key history rows separately
     * from live suspended runs (which are keyed by raw `runId`, status
     * `paused`, and deleted on completion) so the two lifecycles never collide.
     */
    recordTerminal?(record: RunRecord): Promise<void>;
    /** Newest terminal run-history records for a flow (for the Runs tab). */
    listHistory?(flowName: string, limit: number): Promise<RunRecord[]>;
    /**
     * Load one terminal run-history record by its raw `runId`, or `null` when
     * none is stored. Backs {@link AutomationEngine.getRun}'s durable fallback
     * so "open a past failed run" works after a restart.
     */
    loadTerminal?(runId: string): Promise<RunRecord | null>;
}

export class AutomationEngine implements IAutomationService {
    /**
     * ADR-0044: maximum times a single node may be (re-)entered at the top
     * level of one run before the engine aborts it as a runaway back-edge
     * loop. Generous on purpose — the product guard (`maxRevisions`) sits
     * orders of magnitude lower.
     */
    static readonly MAX_NODE_REENTRIES = 100;

    private flows = new Map<string, FlowParsed>();
    private flowEnabled = new Map<string, boolean>();
    /**
     * Re-entrancy guard for record-triggered flows (complements the intra-run
     * {@link MAX_NODE_REENTRIES} back-edge guard, which cannot see a self-trigger
     * loop because each re-fire is a NEW run with a new id).
     *
     * A `record-after-update` flow whose action writes back to its OWN trigger
     * record re-fires itself (update → afterUpdate → dispatch → execute → update
     * → …). Normally the flow's start `condition` suppresses the second fire, but
     * a broken guard makes it INFINITE — e.g. HotCRM's `case_escalation` guards on
     * `record.is_escalated != true`, but a `boolean` field persists as integer `1`
     * on SQLite/libsql and CEL `1 != true` is `true`, so it never trips. During
     * first-boot seed (which awaits automation to settle) that infinite cascade
     * wedges the whole per-env kernel build → the env is unopenable (2026-07-06).
     *
     * Keyed by `flowName::recordId`: the SAME flow re-entering for the SAME record
     * while an execution is still on the stack is broken. Different flows or
     * different records are unaffected, so legitimate cross-record fan-out and
     * distinct-flow chains still run.
     */
    private readonly activeRecordFlows = new Set<string>();
    /** Flows the persisted deployment `status` currently marks disabled
     *  (`obsolete`/`invalid`), tracked so a status flip back to active/draft
     *  re-enables on the next (re)register even if the flow had been turned off. */
    private flowStatusDisabled = new Map<string, boolean>();
    private flowVersionHistory = new Map<string, Array<{ version: number; definition: FlowParsed; createdAt: string }>>();
    private nodeExecutors = new Map<string, NodeExecutor>();
    private actionDescriptors = new Map<string, ActionDescriptor>();
    private triggers = new Map<string, FlowTrigger>();
    /**
     * Flows currently wired to a trigger, keyed by flow name → the trigger
     * `type` that owns the binding. Used to avoid double-binding and to know
     * which trigger to `stop()` when a flow is unregistered/disabled.
     */
    private boundFlowTriggers = new Map<string, string>();
    /** Connectors registered by integration plugins, keyed by connector name (ADR-0018 §Addendum). */
    private connectors = new Map<string, RegisteredConnector>();
    /** Bridge to the host function registry for `script`-node calls (#1870), if wired. */
    private functionResolver: FlowFunctionResolver | null = null;
    private executionLogs: ExecutionLogEntry[] = [];
    private readonly maxLogSize: number;
    private logger: Logger;
    /**
     * Runs paused at a node, keyed by runId (ADR-0019). In-memory hot cache —
     * mirrored to {@link store} when one is configured, so a pause survives a
     * process restart. See {@link SuspendedRun}.
     */
    private suspendedRuns = new Map<string, SuspendedRun>();
    /**
     * Optional durable backing for {@link suspendedRuns}. When set, suspended
     * runs are persisted on suspend and rehydrated on resume after a restart;
     * when absent, behaviour is purely in-memory (the historical default).
     */
    private store?: SuspendedRunStore;
    /**
     * Run ids currently mid-resume — an in-process idempotency guard so a
     * duplicate `resume(runId)` can't re-enter and double-run side effects.
     */
    private resuming = new Set<string>();

    constructor(logger: Logger, store?: SuspendedRunStore, options?: AutomationEngineOptions) {
        this.logger = logger;
        this.store = store;
        this.maxLogSize = options?.maxLogSize ?? DEFAULT_MAX_EXECUTION_LOG_SIZE;
    }

    /**
     * Attach (or replace) the durable {@link SuspendedRunStore}. Used by the
     * service plugin to upgrade the engine to DB-backed persistence once the
     * ObjectQL engine is available (the engine is constructed earlier, during
     * `init`, before services are wired).
     */
    setSuspendedRunStore(store: SuspendedRunStore): void {
        this.store = store;
    }

    /**
     * Generate a process-unique run id. Includes a random component so ids do
     * not collide with runs persisted by a previous process lifetime (a plain
     * incrementing counter would reissue `run_1` after a restart, clashing with
     * a still-suspended durable run).
     */
    private nextRunId(): string {
        const g = globalThis as { crypto?: { randomUUID?: () => string } };
        const rand = g.crypto?.randomUUID
            ? g.crypto.randomUUID()
            : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        return `run_${rand}`;
    }

    /**
     * Persist a suspended run to the in-memory cache and (best-effort) the
     * durable store. A store failure is logged but does not fail the run — the
     * in-memory copy still allows in-process resume; only cross-restart
     * durability is lost.
     */
    private async persistSuspendedRun(run: SuspendedRun): Promise<void> {
        this.suspendedRuns.set(run.runId, run);
        if (this.store) {
            try {
                await this.store.save(run);
            } catch (err) {
                this.logger.warn(
                    `[automation] failed to persist suspended run '${run.runId}' to durable store (kept in memory only): ${(err as Error).message}`,
                );
            }
        }
    }

    /**
     * Drop a suspended run from the in-memory cache and (best-effort) the
     * durable store. Called once the run is claimed for resume or reaches a
     * terminal state.
     */
    private async forgetSuspendedRun(runId: string): Promise<void> {
        this.suspendedRuns.delete(runId);
        if (this.store) {
            try {
                await this.store.delete(runId);
            } catch (err) {
                this.logger.warn(
                    `[automation] failed to delete suspended run '${runId}' from durable store: ${(err as Error).message}`,
                );
            }
        }
    }

    // ── Plugin Extension API ──────────────────────────────

    /** Register a node executor (called by plugins) */
    registerNodeExecutor(executor: NodeExecutor): void {
        if (this.nodeExecutors.has(executor.type)) {
            this.logger.warn(`Node executor '${executor.type}' replaced`);
        }
        this.nodeExecutors.set(executor.type, executor);

        // Publish the ADR-0018 action descriptor into the registry, so the
        // type validates as a legal flow node and appears in the designer
        // palette. A descriptor's `type` should match the executor's; we key
        // on the descriptor's `type` and warn on mismatch rather than silently
        // diverging.
        if (executor.descriptor) {
            const descriptorType = executor.descriptor.type;
            if (descriptorType !== executor.type) {
                this.logger.warn(
                    `Node executor '${executor.type}' publishes a descriptor for type '${descriptorType}' — registering under both.`,
                );
            }
            this.actionDescriptors.set(descriptorType, executor.descriptor);
        }

        this.logger.info(`Node executor registered: ${executor.type}`);
    }

    /**
     * Register a **deprecated alias** of a canonical node type (ADR-0018 M3).
     *
     * The alias is a real registered executor, so old saved flows whose nodes
     * use the alias type keep validating and running with no migration. At
     * execute time it delegates to the canonical executor (resolved live, so the
     * canonical may be registered before or after the alias), logging a one-time
     * deprecation warning. Its published descriptor is flagged `deprecated` +
     * `aliasOf` so the designer palette can hide or mark it while the canonical
     * type is the one offered for new authoring.
     *
     * This is how ADR-0018 collapses the five outbound verbs onto `http` /
     * `notify`: `http_request` / `http_call` / `webhook` become aliases of
     * `http`.
     */
    registerNodeAlias(
        alias: string,
        canonicalType: string,
        meta?: { name?: string; category?: ActionDescriptor['category']; paradigms?: ActionDescriptor['paradigms']; needsOutbox?: boolean },
    ): void {
        const engine = this;
        let warned = false;
        this.registerNodeExecutor({
            type: alias,
            descriptor: defineActionDescriptor({
                type: alias,
                version: '1.0.0',
                name: meta?.name ?? alias,
                description: `Deprecated alias of '${canonicalType}' (ADR-0018 M3). Author new flows with '${canonicalType}'.`,
                category: meta?.category ?? 'io',
                source: 'builtin',
                paradigms: meta?.paradigms ?? ['flow', 'approval'],
                supportsRetry: true,
                needsOutbox: meta?.needsOutbox ?? false,
                deprecated: true,
                aliasOf: canonicalType,
            }),
            async execute(node, variables, context) {
                if (!warned) {
                    warned = true;
                    engine.logger.warn(
                        `Node type '${alias}' is deprecated; use '${canonicalType}' (ADR-0018 M3). Existing flows keep running via the alias.`,
                    );
                }
                const target = engine.nodeExecutors.get(canonicalType);
                if (!target) {
                    return {
                        success: false,
                        error: `alias '${alias}' → '${canonicalType}': canonical executor not registered`,
                    };
                }
                return target.execute(node, variables, context);
            },
        });
        this.logger.info(`Node alias registered: ${alias} → ${canonicalType} (deprecated)`);
    }

    /** Unregister a node executor (hot-unplug) */
    unregisterNodeExecutor(type: string): void {
        const executor = this.nodeExecutors.get(type);
        this.nodeExecutors.delete(type);
        // Drop the published descriptor (keyed by descriptor.type, which may
        // differ from the executor type).
        this.actionDescriptors.delete(type);
        if (executor?.descriptor) {
            this.actionDescriptors.delete(executor.descriptor.type);
        }
        this.logger.info(`Node executor unregistered: ${type}`);
    }

    /** Register a trigger (called by plugins) */
    registerTrigger(trigger: FlowTrigger): void {
        this.triggers.set(trigger.type, trigger);
        this.logger.info(`Trigger registered: ${trigger.type}`);
        // A trigger may be registered *after* its flows (e.g. AutomationServicePlugin
        // pulls flows at start(); a trigger plugin wires up on kernel:ready, which
        // fires later). Activate any already-registered flow that maps to this type.
        for (const name of this.flows.keys()) {
            if (this.boundFlowTriggers.has(name)) continue;
            const resolved = this.resolveTriggerBinding(name);
            if (resolved?.triggerType === trigger.type) {
                this.activateFlowTrigger(name);
            }
        }
    }

    /** Unregister a trigger (hot-unplug) */
    unregisterTrigger(type: string): void {
        // Tear down every flow bound to this trigger before dropping it.
        for (const [name, boundType] of [...this.boundFlowTriggers]) {
            if (boundType !== type) continue;
            try {
                this.triggers.get(type)?.stop(name);
            } catch (err) {
                this.logger.warn(`Trigger '${type}' stop('${name}') failed: ${(err as Error).message}`);
            }
            this.boundFlowTriggers.delete(name);
        }
        this.triggers.delete(type);
        this.logger.info(`Trigger unregistered: ${type}`);
    }

    /**
     * Derive a flow's trigger binding from its `start` node, or `undefined` if
     * the flow has no auto-trigger (manual / screen). The convention —
     * established by the showcase flows — is that the start node carries the
     * trigger details in its `config`: `{ objectName, triggerType, condition }`
     * for record-change, or a `schedule` descriptor for time-based flows.
     */
    private resolveTriggerBinding(
        flowName: string,
    ): { triggerType: string; binding: FlowTriggerBinding } | undefined {
        const flow = this.flows.get(flowName);
        if (!flow) return undefined;
        const startNode = flow.nodes.find(n => n.type === 'start');
        const config = (startNode?.config ?? {}) as Record<string, unknown>;
        const triggerType = typeof config.triggerType === 'string' ? config.triggerType : undefined;

        if (triggerType && triggerType.startsWith('record-')) {
            return {
                triggerType: 'record_change',
                binding: {
                    flowName,
                    object: typeof config.objectName === 'string' ? config.objectName : undefined,
                    event: triggerType,
                    condition: (config.condition as FlowTriggerBinding['condition']) ?? undefined,
                    config,
                },
            };
        }

        if (config.schedule != null || flow.type === 'schedule') {
            return {
                triggerType: 'schedule',
                binding: { flowName, schedule: config.schedule, condition: (config.condition as FlowTriggerBinding['condition']) ?? undefined, config },
            };
        }

        // Inbound HTTP (ADR-0041 Tier 1): an `api` flow waits for an external
        // POST. The concrete trigger (`@objectstack/trigger-api`) mounts the
        // endpoint and enqueues; the binding's `config` carries the hook
        // details (`hookId`, `secret`) from the start node.
        if (flow.type === 'api' || triggerType === 'api') {
            return {
                triggerType: 'api',
                binding: { flowName, condition: (config.condition as FlowTriggerBinding['condition']) ?? undefined, config },
            };
        }

        return undefined;
    }

    /**
     * Bind a flow to its matching registered trigger (idempotent). No-op when
     * the flow has no trigger binding or no trigger is registered for its type
     * yet — {@link registerTrigger} re-attempts activation when one arrives.
     */
    private activateFlowTrigger(flowName: string): void {
        if (this.boundFlowTriggers.has(flowName)) return;
        const resolved = this.resolveTriggerBinding(flowName);
        if (!resolved) return;
        const trigger = this.triggers.get(resolved.triggerType);
        if (!trigger) return;
        try {
            trigger.start(resolved.binding, (ctx: AutomationContext) => this.execute(flowName, ctx).then(() => undefined));
            this.boundFlowTriggers.set(flowName, resolved.triggerType);
            this.logger.info(`Flow '${flowName}' bound to trigger '${resolved.triggerType}'`);
        } catch (err) {
            this.logger.warn(`Failed to bind flow '${flowName}' to trigger '${resolved.triggerType}': ${(err as Error).message}`);
        }
    }

    /** Unbind a flow from its trigger, if bound. */
    private deactivateFlowTrigger(flowName: string): void {
        const boundType = this.boundFlowTriggers.get(flowName);
        if (!boundType) return;
        try {
            this.triggers.get(boundType)?.stop(flowName);
        } catch (err) {
            this.logger.warn(`Trigger '${boundType}' stop('${flowName}') failed: ${(err as Error).message}`);
        }
        this.boundFlowTriggers.delete(flowName);
    }

    /** Active flow→trigger bindings (observability / tests). */
    getActiveTriggerBindings(): Array<{ flowName: string; triggerType: string }> {
        return [...this.boundFlowTriggers].map(([flowName, triggerType]) => ({ flowName, triggerType }));
    }

    /**
     * Register a connector (called by integration plugins, ADR-0018 §Addendum).
     * Validates the definition against {@link ConnectorSchema} and asserts every
     * declared action has a handler, so a half-wired connector fails loudly at
     * registration rather than silently at dispatch. Re-registering the same
     * name replaces (mirrors {@link registerNodeExecutor}).
     */
    registerConnector(def: Connector, handlers: Record<string, ConnectorActionHandler>): void {
        const parsed = ConnectorSchema.parse(def);
        for (const action of parsed.actions ?? []) {
            if (typeof handlers[action.key] !== 'function') {
                throw new Error(
                    `Connector '${parsed.name}': action '${action.key}' is declared but no handler was provided`,
                );
            }
        }
        if (this.connectors.has(parsed.name)) {
            this.logger.warn(`Connector '${parsed.name}' replaced`);
        }
        this.connectors.set(parsed.name, { def: parsed, handlers });
        this.logger.info(
            `Connector registered: ${parsed.name} (${Object.keys(handlers).length} action handlers)`,
        );
    }

    /** Unregister a connector (hot-unplug). */
    unregisterConnector(name: string): void {
        this.connectors.delete(name);
        this.logger.info(`Connector unregistered: ${name}`);
    }

    /**
     * Resolve the handler for a connector action, used by the baseline
     * `connector_action` node. Returns `undefined` when the connector or action
     * is not registered, so the node can fail the step with a clear error.
     */
    resolveConnectorAction(connectorId: string, actionId: string): ConnectorActionHandler | undefined {
        return this.connectors.get(connectorId)?.handlers[actionId];
    }

    /**
     * Wire the engine to the host's named-function registry (#1870). The
     * automation plugin calls this in `start()` with a resolver backed by
     * ObjectQL's `resolveFunction` (populated from `bundle.functions` /
     * `defineStack({ functions })`), so a `script` node can invoke an
     * authored function by name. Passing `null` detaches the bridge.
     */
    setFunctionResolver(resolver: FlowFunctionResolver | null): void {
        this.functionResolver = resolver;
    }

    /**
     * Resolve a named function for a `script` node. Returns `undefined` when no
     * resolver is wired or the name is unregistered — the node then fails the
     * step with a clear error rather than silently no-op'ing.
     */
    resolveFunction(name: string): FlowFunctionHandler | undefined {
        return this.functionResolver?.(name) ?? undefined;
    }

    /** Get all registered connector names. */
    getRegisteredConnectors(): string[] {
        return [...this.connectors.keys()];
    }

    /**
     * Get a designer-facing descriptor for every registered connector — its
     * identity plus the actions it exposes (input/output JSON Schema). Backs
     * `GET /api/v1/automation/connectors` so the designer can fill the
     * `connector_action` node's connector / action / input pickers (ADR-0022).
     * Handlers are omitted — they are runtime code, not metadata.
     */
    getConnectorDescriptors(): ConnectorDescriptor[] {
        return [...this.connectors.values()].map(({ def }) => ({
            name: def.name,
            label: def.label,
            type: def.type,
            description: def.description,
            icon: def.icon,
            actions: (def.actions ?? []).map((a) => ({
                key: a.key,
                label: a.label,
                description: a.description,
                inputSchema: a.inputSchema,
                outputSchema: a.outputSchema,
            })),
        }));
    }

    /** Get all registered node types */
    getRegisteredNodeTypes(): string[] {
        return [...this.nodeExecutors.keys()];
    }

    /**
     * Get all published action descriptors (ADR-0018). Backs both flow
     * validation and the designer palette (`GET /api/v1/automation/actions`).
     * Only executors that published a descriptor appear here.
     */
    getActionDescriptors(): ActionDescriptor[] {
        return [...this.actionDescriptors.values()];
    }

    /** Get the action descriptor for a single node type, if published. */
    getActionDescriptor(type: string): ActionDescriptor | undefined {
        return this.actionDescriptors.get(type);
    }

    /** Get all registered trigger types */
    getRegisteredTriggerTypes(): string[] {
        return [...this.triggers.keys()];
    }

    // ── IAutomationService Contract Implementation ────────

    registerFlow(name: string, definition: unknown): void {
        // ADR-0087 D2 — the runtime load seam. A stored flow authored against an
        // old shape (a `webhook`/`http_request` callout node, a `delete_record`
        // with `config.filters`) is canonicalized on rehydration, BEFORE parse +
        // execution, so the executor only ever sees the canonical shape and a
        // dropped-alias upgrade never silently changes behavior (e.g. an empty
        // `filter` deleting a whole table). `reservedNodeTypes` is this engine's
        // live executor registry: an open-namespace node-type rename over a type
        // a custom executor owns becomes a loud, refused conflict — never a
        // silent clobber of the third party's node.
        const reservedNodeTypes = new Set<string>([
            ...FLOW_STRUCTURAL_NODE_TYPES,
            ...this.nodeExecutors.keys(),
            ...this.actionDescriptors.keys(),
        ]);
        const converted = applyConversionsToFlow(definition, {
            reservedNodeTypes,
            onNotice: (n) => this.logger.warn(`[flow '${name}'] ${n.code}: ${n.message}`),
            onConflict: (c) => this.logger.warn(`[flow '${name}'] ${c.code}: ${c.message}`),
        });
        const parsed = FlowSchema.parse(converted);

        // DAG cycle detection
        this.detectCycles(parsed);

        // ADR-0031 — validate structured control-flow constructs (loop bodies,
        // parallel branches, try/catch regions) are well-formed (single-entry/
        // single-exit, acyclic). Reject the malformed before it can run.
        validateControlFlow(parsed);

        // ADR-0018 §M1 — validate node types against the live action registry.
        // The protocol no longer gates `type` with a closed enum; membership is
        // checked here instead. Soft-fail (warn, don't throw): a flow authored
        // against a plugin that is currently disabled should still register, and
        // executeNode() already throws NO_EXECUTOR at run time for unknown types.
        this.validateNodeTypes(name, parsed);

        // ADR-0032 §Decision 1a — parse-validate every predicate at registration,
        // so a malformed condition (e.g. the #1491 `{record.x}` template-brace-in-
        // CEL mistake) is a LOUD registration error with the offending source,
        // not a silent runtime `false`. Hard-fail: a broken predicate is never
        // safe to run.
        this.validateFlowExpressions(name, parsed);

        // Version history management
        const history = this.flowVersionHistory.get(name) ?? [];
        history.push({
            version: parsed.version,
            definition: parsed,
            createdAt: new Date().toISOString(),
        });
        this.flowVersionHistory.set(name, history);

        this.flows.set(name, parsed);
        // Enable/disable from the persisted deployment `status`. `obsolete`/`invalid`
        // flows are DISABLED (unbound + guarded in execute); `draft`/`active` — and
        // any legacy flow with no explicit status — stay enabled, so existing flows
        // are unaffected (zero regression). This is how the Studio's on/off switch
        // persists: it flips `status` active↔obsolete, applied on the next publish
        // rebind. A flip back OUT of a disabled status re-enables even if turned off;
        // a runtime toggleFlow() override on a still-enabled flow is preserved.
        const flowStatus = (parsed as { status?: string }).status;
        const disabledByStatus = flowStatus === 'obsolete' || flowStatus === 'invalid';
        const wasStatusDisabled = this.flowStatusDisabled.get(name) === true;
        this.flowStatusDisabled.set(name, disabledByStatus);
        if (disabledByStatus) {
            this.flowEnabled.set(name, false);
        } else if (wasStatusDisabled || !this.flowEnabled.has(name)) {
            this.flowEnabled.set(name, true);
        }
        this.logger.info(`Flow registered: ${name} (version ${parsed.version})`);

        // Re-bind in case the definition changed its trigger, then (re)activate.
        this.deactivateFlowTrigger(name);
        if (this.flowEnabled.get(name) !== false) {
            this.activateFlowTrigger(name);
        }
    }

    unregisterFlow(name: string): void {
        this.deactivateFlowTrigger(name);
        this.flows.delete(name);
        this.flowEnabled.delete(name);
        this.flowStatusDisabled.delete(name);
        this.flowVersionHistory.delete(name);
        this.logger.info(`Flow unregistered: ${name}`);
    }

    /**
     * Runtime enable/bound state for every registered flow — the truth behind the
     * Studio's status badges. The persisted `status` is metadata; whether a flow
     * is actually **enabled** (allowed to run) and **bound** (wired to its trigger,
     * so it fires) is engine state. `enabled: false` ⇒ status is obsolete/invalid
     * or a runtime toggle turned it off; `bound: false` on an enabled flow ⇒ it has
     * no trigger (e.g. a manually-invoked/screen flow).
     */
    getFlowRuntimeStates(): Array<{ name: string; enabled: boolean; bound: boolean }> {
        return [...this.flows.keys()].map((name) => ({
            name,
            enabled: this.flowEnabled.get(name) !== false,
            bound: this.boundFlowTriggers.has(name),
        }));
    }

    async listFlows(): Promise<string[]> {
        return [...this.flows.keys()];
    }

    async getFlow(name: string): Promise<FlowParsed | null> {
        return this.flows.get(name) ?? null;
    }

    async toggleFlow(name: string, enabled: boolean): Promise<void> {
        if (!this.flows.has(name)) {
            throw new Error(`Flow '${name}' not found`);
        }
        this.flowEnabled.set(name, enabled);
        this.logger.info(`Flow '${name}' ${enabled ? 'enabled' : 'disabled'}`);
        // A disabled flow should stop receiving trigger events; a re-enabled one
        // should resume. execute() also guards disabled flows, but unbinding
        // avoids firing the trigger (and its event-source subscription) at all.
        if (enabled) {
            this.activateFlowTrigger(name);
        } else {
            this.deactivateFlowTrigger(name);
        }
    }

    /** Get flow version history */
    getFlowVersionHistory(name: string): Array<{ version: number; definition: FlowParsed; createdAt: string }> {
        return this.flowVersionHistory.get(name) ?? [];
    }

    /** Rollback flow to a specific version */
    rollbackFlow(name: string, version: number): void {
        const history = this.flowVersionHistory.get(name);
        if (!history) {
            throw new Error(`Flow '${name}' has no version history`);
        }
        const entry = history.find(h => h.version === version);
        if (!entry) {
            throw new Error(`Version ${version} not found for flow '${name}'`);
        }
        this.flows.set(name, entry.definition);
        this.logger.info(`Flow '${name}' rolled back to version ${version}`);
    }

    async listRuns(flowName: string, options?: { limit?: number; cursor?: string }): Promise<ExecutionLogEntry[]> {
        const limit = options?.limit ?? 20;
        const inMem = this.executionLogs.filter(l => l.flowName === flowName);

        // Merge durable run history so the "Runs" view survives a restart and
        // ring-buffer eviction. In-memory entries are the freshest (they carry
        // full step detail); durable rows backfill runs the process no longer
        // holds. Best-effort: a history-read failure degrades to in-memory only.
        let durable: ExecutionLogEntry[] = [];
        if (this.store?.listHistory) {
            try {
                const rows = await this.store.listHistory(flowName, limit);
                durable = rows.map(r => this.runRecordToLogEntry(r));
            } catch (err) {
                this.logger.warn(
                    `[Automation] run-history read failed for '${flowName}': ${(err as Error)?.message}`,
                );
            }
        }
        const byId = new Map<string, ExecutionLogEntry>();
        for (const e of durable) byId.set(e.id, e);
        for (const e of inMem) byId.set(e.id, e); // freshest wins
        return [...byId.values()]
            .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
            .slice(0, limit);
    }

    /** Rehydrate a durable {@link RunRecord} into an {@link ExecutionLogEntry}
     *  for the Runs surfaces. Steps carry the bounded persisted step log (rows
     *  written before step persistence have none). */
    private runRecordToLogEntry(r: RunRecord): ExecutionLogEntry {
        return {
            id: r.runId,
            flowName: r.flowName,
            flowVersion: r.flowVersion,
            status: r.status, // 'completed' | 'failed' — both valid ExecutionLog statuses
            startedAt: r.startedAt,
            completedAt: r.finishedAt,
            durationMs: r.durationMs,
            trigger: { type: '', userId: r.userId ?? undefined },
            steps: r.steps ?? [],
            error: r.error,
        };
    }

    async getRun(runId: string): Promise<ExecutionLogEntry | null> {
        const inMem = this.executionLogs.find(l => l.id === runId);
        if (inMem) return inMem;
        // Durable fallback: after a restart (or ring-buffer eviction) the run's
        // terminal history row still answers "what happened, at which node?".
        // Best-effort — a store failure degrades to "not found", never throws.
        if (this.store?.loadTerminal) {
            try {
                const rec = await this.store.loadTerminal(runId);
                if (rec) return this.runRecordToLogEntry(rec);
            } catch (err) {
                this.logger.warn(
                    `[Automation] durable run lookup failed for '${runId}': ${(err as Error)?.message}`,
                );
            }
        }
        return null;
    }

    /**
     * Build the run's effective {@link AutomationContext} from `flow.runAs` — a
     * COPY, never mutating the caller's context, so the elevation is scoped to
     * this run and the caller's identity is restored when the run returns
     * (ADR-0049 / #1888). The single construction point shared by `execute()` and
     * `executeWithoutRetry()`.
     *
     * Also surfaces the user-less **fail-open** footgun (#1888 follow-up): a flow
     * whose effective `runAs` is `'user'` but whose trigger carries no user — e.g.
     * a schedule-triggered run — has no user to scope to, so its data nodes run
     * UNSCOPED (the data security middleware skips when there is no identity).
     * Denying would break legitimate scheduled CRUD and silently elevating would
     * hide the author's intent, so the run proceeds — but we log a clear warning so
     * the elevation is *audible* rather than silent. Authors should declare
     * `runAs:'system'` to make scheduled elevation explicit (the build-time lint
     * `flow-schedule-runas-unscoped` flags the same shape earlier).
     */
    private resolveRunContext(flow: FlowParsed, context?: AutomationContext): AutomationContext {
        const runContext: AutomationContext = { ...(context ?? {}), runAs: flow.runAs ?? 'user' };
        if (runIsUnscopedUserMode(runContext) && flowTouchesData(flow)) {
            this.logger.warn(
                `[runAs] flow '${flow.name}' executes with runAs:'user' but its trigger carries no user ` +
                `(e.g. a schedule) — its data operations run UNSCOPED (elevated, RLS-bypassing), not ` +
                `restricted. Declare runAs:'system' to make the elevation explicit and intended ` +
                `(ADR-0049, #1888).`,
            );
        }
        return runContext;
    }

    async execute(flowName: string, context?: AutomationContext): Promise<AutomationResult> {
        const startTime = Date.now();
        const flow = this.flows.get(flowName);

        if (!flow) {
            return { success: false, error: `Flow '${flowName}' not found` };
        }

        // Check if flow is disabled
        if (this.flowEnabled.get(flowName) === false) {
            return { success: false, error: `Flow '${flowName}' is disabled` };
        }

        // Re-entrancy loop guard (see `activeRecordFlows`). Break the SAME flow
        // re-firing for the SAME record while a prior execution is still active —
        // a self-trigger cascade whose start condition fails to suppress it would
        // otherwise loop forever and wedge the caller (fatally, mid seed).
        const guardRecordId = (context?.record as { id?: unknown } | undefined)?.id;
        const reentryKey = guardRecordId != null ? `${flowName}::${String(guardRecordId)}` : undefined;
        if (reentryKey && this.activeRecordFlows.has(reentryKey)) {
            this.logger.warn(
                `[automation] flow '${flowName}' re-entered for the same record '${String(guardRecordId)}' while still running — breaking self-trigger loop. ` +
                `Its start condition did not suppress the re-fire; if it guards on a boolean field (e.g. \`is_escalated != true\`), note booleans persist as 0/1 on SQLite/libsql and CEL \`1 != true\` is true.`,
            );
            return { success: true, output: { skipped: true, reason: 'reentrancy_loop_guard' } };
        }
        if (reentryKey) this.activeRecordFlows.add(reentryKey);

        // Initialize variable context
        const variables = new Map<string, unknown>();
        if (flow.variables) {
            for (const v of flow.variables) {
                if (v.isInput && context?.params?.[v.name] !== undefined) {
                    variables.set(v.name, context.params[v.name]);
                }
            }
        }
        // Inject trigger record. `$record` is the canonical handle; `record` is a
        // friendlier alias so templates/conditions can write `{record.title}` and
        // `record.status`. We also flatten the record's own fields to top-level
        // variables (so bare references like `status`/`budget` resolve in start
        // conditions and edge predicates) WITHOUT clobbering flow inputs already
        // seeded above. `previous` exposes the pre-update row for transition gates.
        if (context?.record) {
            variables.set('$record', context.record);
            variables.set('record', context.record);
            for (const [k, v] of Object.entries(context.record)) {
                if (!variables.has(k)) variables.set(k, v);
            }
        }
        if (context?.previous) {
            variables.set('previous', context.previous);
        }

        const runId = this.nextRunId();
        // Expose the run id to executors (ADR-0019): a pausing node (e.g. Approval)
        // reads `$runId` to map its external state back to this run for resume.
        variables.set('$runId', runId);
        // Expose flow identity to executors so externalized state (e.g. an
        // approval request row) can carry a human-readable origin. Captured in
        // the variable snapshot, so still present after a suspend/resume.
        variables.set('$flowName', flowName);
        variables.set('$flowLabel', flow.label ?? flowName);
        const startedAt = new Date().toISOString();
        const steps: StepLogEntry[] = [];

        // ADR-0049 / #1888 — establish the run's effective execution identity
        // from flow.runAs (a COPY, never mutating the caller's context, so the
        // elevation is scoped to this run and the caller's identity is restored
        // when execute() returns). Surfaces the user-less fail-open (see helper).
        const runContext = this.resolveRunContext(flow, context);

        try {
            // Find the start node
            const startNode = flow.nodes.find(n => n.type === 'start');
            if (!startNode) {
                return { success: false, error: 'Flow has no start node' };
            }

            // Trigger-condition gate. The start node's `condition` is the predicate
            // that decides whether the trigger event should launch this flow (e.g.
            // `status == "done" && previous.status != "done"`). The engine — not the
            // trigger — owns evaluating it, so every trigger type (record-change,
            // schedule, …) and a manual `execute()` share one gate. Plain-string
            // conditions are routed through CEL so bare field references resolve.
            const startCondition = (startNode.config as Record<string, unknown> | undefined)?.condition as
                | string
                | { dialect?: string; source?: string; ast?: unknown }
                | undefined;
            if (startCondition !== undefined && startCondition !== null && startCondition !== '') {
                const condExpr =
                    typeof startCondition === 'string' ? { dialect: 'cel', source: startCondition } : startCondition;
                if (!this.evaluateCondition(condExpr, variables)) {
                    this.logger.debug(`Flow '${flowName}' skipped: start condition not met`);
                    return { success: true, output: { skipped: true, reason: 'condition_not_met' } };
                }
            }

            // Validate node input schemas before execution
            this.validateNodeInputSchemas(flow, variables);

            // DAG traversal execution
            await this.executeNode(startNode, flow, variables, runContext, steps);

            // Collect output variables
            const output: Record<string, unknown> = {};
            if (flow.variables) {
                for (const v of flow.variables) {
                    if (v.isOutput) {
                        output[v.name] = variables.get(v.name);
                    }
                }
            }

            const durationMs = Date.now() - startTime;

            // Record execution log
            this.recordLog({
                id: runId,
                flowName,
                flowVersion: flow.version,
                status: 'completed',
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs,
                trigger: {
                    type: context?.event ?? 'manual',
                    userId: context?.userId,
                    object: context?.object,
                },
                steps,
                output,
            });

            return {
                success: true,
                output,
                durationMs,
            };
        } catch (err: unknown) {
            // A node asked to suspend the run (ADR-0019 durable pause). Snapshot
            // the live state, record a `paused` log, and return the run id so the
            // caller can later `resume()` it. This is NOT a failure.
            if (isSuspendSignal(err)) {
                const durationMs = Date.now() - startTime;
                await this.persistSuspendedRun({
                    runId,
                    flowName,
                    flowVersion: flow.version,
                    nodeId: err.nodeId,
                    variables: Object.fromEntries(variables),
                    steps,
                    context: runContext,
                    startedAt,
                    startTime,
                    correlation: err.correlation,
                    screen: err.screen,
                });
                this.recordLog({
                    id: runId,
                    flowName,
                    flowVersion: flow.version,
                    status: 'paused',
                    startedAt,
                    durationMs,
                    trigger: {
                        type: context?.event ?? 'manual',
                        userId: context?.userId,
                        object: context?.object,
                    },
                    steps,
                });
                return {
                    success: true,
                    status: 'paused',
                    runId,
                    durationMs,
                    screen: err.screen,
                };
            }

            const errorMessage = err instanceof Error ? err.message : String(err);

            // Record failed execution log
            const durationMs = Date.now() - startTime;
            this.recordLog({
                id: runId,
                flowName,
                flowVersion: flow.version,
                status: 'failed',
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs,
                trigger: {
                    type: context?.event ?? 'manual',
                    userId: context?.userId,
                    object: context?.object,
                },
                steps,
                error: errorMessage,
            });

            // Error handling strategy
            if (flow.errorHandling?.strategy === 'retry') {
                return this.retryExecution(flowName, context, startTime, flow.errorHandling);
            }
            return {
                success: false,
                error: errorMessage,
                durationMs,
            };
        } finally {
            // Release the re-entrancy guard for this (flow, record). Runs before
            // the returned promise settles, so an error-retry re-run (whose inner
            // execute happens after its own await) is not falsely blocked.
            if (reentryKey) this.activeRecordFlows.delete(reentryKey);
        }
    }

    /**
     * Resume a run suspended at a node (ADR-0019 durable pause). Restores the
     * snapshotted variables, merges `signal.output` under the suspended node's
     * id, and continues traversal from that node's out-edges — optionally
     * restricted to the edge labelled `signal.branchLabel` (e.g. the approval
     * decision). The continuation may itself suspend again, in which case this
     * returns `{ status: 'paused', runId }` afresh.
     *
     * **Subflow chains (nested pause, linked-runs model).** A run paused at a
     * `subflow` node (correlation `subflow:<childRunId>`) DELEGATES the signal
     * down to the suspended child; a run that completes and carries
     * `$parentRunId` in its context BUBBLES its output up by auto-resuming the
     * parent. Both directions compose recursively, so arbitrarily nested
     * subflow pauses resolve from either end (UI holds the parent run id;
     * approval/wait infrastructure holds the child's).
     */
    async resume(runId: string, signal?: ResumeSignal): Promise<AutomationResult> {
        return this.resumeInternal(runId, signal, false);
    }

    /**
     * @param skipBubble - Set when the caller is the subflow DELEGATION path,
     *   which continues the parent itself after the child completes — the
     *   child's own up-bubble must stay off so the parent isn't resumed twice.
     */
    private async resumeInternal(runId: string, signal: ResumeSignal | undefined, skipBubble: boolean): Promise<AutomationResult> {
        // Idempotency guard (set synchronously, before any await): reject a
        // concurrent duplicate resume of the same run so side effects can't run
        // twice. A duplicate that arrives *after* this one finishes finds no
        // suspended run and returns the "no suspended run" error below.
        if (this.resuming.has(runId)) {
            return { success: false, error: `Run '${runId}' is already being resumed` };
        }
        this.resuming.add(runId);
        try {
            // Hot path: suspended in this process. Cold path: rehydrate from the
            // durable store (e.g. the process restarted since the pause, ADR-0019).
            let run = this.suspendedRuns.get(runId) ?? null;
            if (!run && this.store) {
                try {
                    run = await this.store.load(runId);
                } catch (err) {
                    this.logger.warn(
                        `[automation] failed to load suspended run '${runId}' from durable store: ${(err as Error).message}`,
                    );
                }
            }
            if (!run) {
                return { success: false, error: `No suspended run '${runId}'` };
            }
            const flow = this.flows.get(run.flowName);
            if (!flow) {
                return { success: false, error: `Flow '${run.flowName}' not found for run '${runId}'` };
            }
            const node = flow.nodes.find(n => n.id === run.nodeId);
            if (!node) {
                return { success: false, error: `Suspended node '${run.nodeId}' no longer exists in flow '${run.flowName}'` };
            }

            // ── Subflow delegation (nested pause): this run is paused at a
            // `subflow` node whose child run itself suspended. The caller's
            // signal is meant for the node the CHILD paused on (its screen /
            // approval / wait), so forward it down. The child resumes with
            // bubbling off — when it completes, *this* invocation continues the
            // parent from the subflow node with the child's output, using the
            // same mapping as the synchronous path.
            if (typeof run.correlation === 'string' && run.correlation.startsWith('subflow:')) {
                const childRunId = run.correlation.slice('subflow:'.length);
                // Capture the child's row BEFORE resuming consumes it — the
                // output-variable mapping rides on the child's context.
                const childRun =
                    this.suspendedRuns.get(childRunId) ??
                    (this.store ? await this.store.load(childRunId).catch(() => null) : null);
                if (childRun) {
                    const childRes = await this.resumeInternal(childRunId, signal, true);
                    if (childRes.status === 'paused') {
                        // Child paused again (e.g. the next screen of a wizard).
                        // This run stays suspended; refresh its surfaced screen
                        // so a re-fetch (getSuspendedScreen) shows the new one.
                        if (childRes.screen && childRes.screen !== run.screen) {
                            await this.persistSuspendedRun({ ...run, screen: childRes.screen });
                        }
                        return {
                            success: true,
                            status: 'paused',
                            runId,
                            durationMs: Date.now() - run.startTime,
                            screen: childRes.screen,
                        };
                    }
                    if (!childRes.success) {
                        const error = `subflow run '${childRunId}' (${childRun.flowName}) failed: ${childRes.error ?? 'unknown error'}`;
                        await this.failSuspendedRun(run, error);
                        return { success: false, error, durationMs: Date.now() - run.startTime };
                    }
                    // Child completed — continue below with its output as the
                    // resume signal (replaces the caller's signal, which the
                    // child already consumed).
                    signal = this.buildSubflowResumeSignal(childRun.context, childRes.output);
                } else {
                    this.logger.warn(
                        `[automation] run '${runId}' is paused at subflow node '${run.nodeId}' but child run '${childRunId}' ` +
                            `is gone — continuing without child output`,
                    );
                }
            }

            // Consume the suspension *before* running downstream work — a run
            // resumes exactly once per pause, and a duplicate resume after a
            // partial restart must not double-run side effects.
            await this.forgetSuspendedRun(runId);

            // Restore variable context and apply the resume signal's output as if it
            // were the node's output, so downstream edges branch on it.
            const variables = new Map<string, unknown>(Object.entries(run.variables));
            if (signal?.output) {
                for (const [key, value] of Object.entries(signal.output)) {
                    variables.set(`${run.nodeId}.${key}`, value);
                }
            }
            // Bare flow variables — a `screen` node's collected inputs land under
            // their plain names so downstream `{var}` interpolation / conditions
            // read them directly (e.g. `new_assignee` → update_record fields).
            if (signal?.variables) {
                for (const [key, value] of Object.entries(signal.variables)) {
                    variables.set(key, value);
                }
            }

            const steps = run.steps;
            const context = run.context;

            try {
                // ── Map re-entry (sequential multi-instance, ADR-0037 A2).
                // A run paused at a `map` node (correlation `map:<childRunId>`)
                // does NOT continue past the node on resume — it RE-RUNS the
                // node so the executor can record the just-completed unit and
                // start the next item. The default path continues past the node.
                if (typeof run.correlation === 'string' && run.correlation.startsWith('map:')) {
                    await this.executeNode(node, flow, variables, context, steps);
                } else {
                    await this.traverseNext(node, flow, variables, context, steps, signal?.branchLabel);
                }

                // Collect output variables
                const output: Record<string, unknown> = {};
                if (flow.variables) {
                    for (const v of flow.variables) {
                        if (v.isOutput) output[v.name] = variables.get(v.name);
                    }
                }
                const durationMs = Date.now() - run.startTime;
                this.recordLog({
                    id: runId,
                    flowName: run.flowName,
                    flowVersion: run.flowVersion,
                    status: 'completed',
                    startedAt: run.startedAt,
                    completedAt: new Date().toISOString(),
                    durationMs,
                    trigger: {
                        type: context.event ?? 'manual',
                        userId: context.userId,
                        object: context.object,
                    },
                    steps,
                    output,
                });

                // ── Subflow up-bubble (nested pause): this run was a subflow
                // child whose parent suspended awaiting it. Auto-resume the
                // parent with our output, mapped like the synchronous path.
                // Skipped when the DELEGATION path drives the chain (it
                // continues the parent itself). Best-effort: the child's own
                // completion stands even if the parent continuation fails.
                if (!skipBubble) {
                    await this.bubbleToParent(run, output);
                }

                // Surface the flow's friendly completion message so a screen-flow
                // runner shows it instead of a generic "Done".
                return { success: true, output, durationMs, successMessage: flow.successMessage };
            } catch (err: unknown) {
                // Re-suspended at a downstream node: persist a fresh continuation.
                if (isSuspendSignal(err)) {
                    const durationMs = Date.now() - run.startTime;
                    await this.persistSuspendedRun({
                        ...run,
                        nodeId: err.nodeId,
                        variables: Object.fromEntries(variables),
                        steps,
                        correlation: err.correlation,
                        screen: err.screen,
                    });
                    this.recordLog({
                        id: runId,
                        flowName: run.flowName,
                        flowVersion: run.flowVersion,
                        status: 'paused',
                        startedAt: run.startedAt,
                        durationMs,
                        trigger: {
                            type: context.event ?? 'manual',
                            userId: context.userId,
                            object: context.object,
                        },
                        steps,
                    });
                    return { success: true, status: 'paused', runId, durationMs, screen: err.screen };
                }

                const errorMessage = err instanceof Error ? err.message : String(err);
                const durationMs = Date.now() - run.startTime;
                this.recordLog({
                    id: runId,
                    flowName: run.flowName,
                    flowVersion: run.flowVersion,
                    status: 'failed',
                    startedAt: run.startedAt,
                    completedAt: new Date().toISOString(),
                    durationMs,
                    trigger: {
                        type: context.event ?? 'manual',
                        userId: context.userId,
                        object: context.object,
                    },
                    steps,
                    error: errorMessage,
                });
                // Subflow chain: a child failing terminally fails every
                // ancestor awaiting it — they can never be resumed otherwise.
                // The delegation path handles its own level (skipBubble).
                if (!skipBubble) {
                    await this.failAncestors(run.context, errorMessage);
                }
                // Surface the flow's friendly error message (the raw error stays
                // in `error` for logs/diagnostics).
                return { success: false, error: errorMessage, durationMs, errorMessage: flow.errorMessage };
            }
        } finally {
            this.resuming.delete(runId);
        }
    }

    /**
     * Build the resume signal that maps a completed subflow child's output
     * into its parent — mirroring the synchronous path exactly: the engine's
     * standard `signal.output` merge lands it under `${subflowNodeId}.output`,
     * and `signal.variables` writes the bare `config.outputVariable` when the
     * child's context carries one (`$parentOutputVariable`).
     */
    private buildSubflowResumeSignal(childContext: AutomationContext | undefined, childOutput: unknown): ResumeSignal {
        const outVar = (childContext as Record<string, unknown> | undefined)?.$parentOutputVariable;
        return {
            output: { output: childOutput ?? null },
            ...(typeof outVar === 'string' && outVar
                ? { variables: { [outVar]: childOutput ?? null } }
                : {}),
        };
    }

    /**
     * Up-bubble for the subflow chain: when a completed run carries
     * `$parentRunId`, resume that parent with this run's output. Recursion via
     * the parent's own completion bubbles multi-level chains. Best-effort —
     * a failed parent continuation is logged, never thrown back at the
     * caller who resumed the child.
     */
    private async bubbleToParent(run: SuspendedRun, output: Record<string, unknown>): Promise<void> {
        const ctx = run.context as Record<string, unknown> | undefined;
        const parentRunId = ctx?.$parentRunId;
        if (typeof parentRunId !== 'string' || !parentRunId) return;
        try {
            // A `map` child (ADR-0037 A2): hand the unit's output to the map
            // node + flag the completion, so on re-entry it records this item
            // and starts the next. A plain subflow child uses the 1:1 mapping.
            const mapNode = ctx?.$parentMapNode;
            const sig = typeof mapNode === 'string' && mapNode
                ? { variables: { [`${mapNode}.$mapItemOutput`]: output ?? null, [`${mapNode}.$mapItemDone`]: true } }
                : this.buildSubflowResumeSignal(run.context, output);
            const parentRes = await this.resumeInternal(parentRunId, sig, false);
            if (!parentRes.success) {
                this.logger.warn(
                    `[automation] subflow run '${run.runId}' completed but resuming parent '${parentRunId}' failed: ${parentRes.error}`,
                );
            }
        } catch (err) {
            this.logger.warn(
                `[automation] subflow run '${run.runId}' completed but resuming parent '${parentRunId}' threw: ${(err as Error).message}`,
            );
        }
    }

    /**
     * Terminally fail a suspended run: consume its continuation and record a
     * `failed` log so it stops surfacing as resumable. Used when a subflow
     * descendant fails — the ancestor awaiting it can never be resumed.
     */
    private async failSuspendedRun(run: SuspendedRun, error: string): Promise<void> {
        await this.forgetSuspendedRun(run.runId);
        this.recordLog({
            id: run.runId,
            flowName: run.flowName,
            flowVersion: run.flowVersion,
            status: 'failed',
            startedAt: run.startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - run.startTime,
            trigger: {
                type: run.context?.event ?? 'manual',
                userId: run.context?.userId,
                object: run.context?.object,
            },
            steps: run.steps,
            error,
        });
    }

    /**
     * Cancel a suspended run (ADR-0044): consume its continuation and record a
     * terminal `cancelled` log so it stops surfacing as resumable. The
     * engine-level primitive behind "the submitter abandoned the revision
     * window" — recalling there leaves the run paused at a wait node with no
     * reject edge to resume down, so the run must end, not continue. Returns
     * `false` when no suspended run exists under the id (already terminal /
     * unknown), which callers treat as idempotent success.
     */
    async cancelRun(runId: string, reason?: string): Promise<boolean> {
        let run = this.suspendedRuns.get(runId) ?? null;
        if (!run && this.store) {
            try {
                run = await this.store.load(runId);
            } catch (err) {
                this.logger.warn(
                    `[automation] cancelRun: failed to load suspended run '${runId}' from durable store: ${(err as Error).message}`,
                );
            }
        }
        if (!run) return false;
        await this.forgetSuspendedRun(runId);
        this.recordLog({
            id: run.runId,
            flowName: run.flowName,
            flowVersion: run.flowVersion,
            status: 'cancelled',
            startedAt: run.startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - run.startTime,
            trigger: {
                type: run.context?.event ?? 'manual',
                userId: run.context?.userId,
                object: run.context?.object,
            },
            steps: run.steps,
            error: reason,
        });
        return true;
    }

    /**
     * Walk a failed run's `$parentRunId` chain and fail each suspended
     * ancestor (see {@link failSuspendedRun}). Bounded so a corrupt context
     * can't loop forever.
     */
    private async failAncestors(context: AutomationContext | undefined, error: string): Promise<void> {
        let parentId = (context as Record<string, unknown> | undefined)?.$parentRunId;
        let hops = 0;
        while (typeof parentId === 'string' && parentId && hops++ < 32) {
            const parent =
                this.suspendedRuns.get(parentId) ??
                (this.store ? await this.store.load(parentId).catch(() => null) : null);
            if (!parent) return;
            await this.failSuspendedRun(parent, `subflow descendant failed: ${error}`);
            parentId = (parent.context as Record<string, unknown> | undefined)?.$parentRunId;
        }
    }

    /**
     * List the runs currently suspended awaiting {@link resume} (ADR-0019).
     * Backs operability surfaces such as a "pending approvals" view.
     *
     * Synchronous — reads the in-memory cache only, so after a process restart
     * runs that suspended in a prior lifetime are not listed here even though
     * they remain durably stored and resumable by id. Use
     * {@link listSuspendedRunsDurable} to include those.
     */
    listSuspendedRuns(): Array<{ runId: string; flowName: string; nodeId: string; correlation?: string }> {
        return [...this.suspendedRuns.values()].map(r => ({
            runId: r.runId,
            flowName: r.flowName,
            nodeId: r.nodeId,
            correlation: r.correlation,
        }));
    }

    /**
     * Like {@link listSuspendedRuns} but includes runs held only in the durable
     * {@link SuspendedRunStore} (e.g. suspended before a restart). The in-memory
     * cache takes precedence on id collisions. Falls back to the in-memory list
     * when no store is configured.
     */
    async listSuspendedRunsDurable(): Promise<Array<{ runId: string; flowName: string; nodeId: string; correlation?: string }>> {
        const byId = new Map<string, { runId: string; flowName: string; nodeId: string; correlation?: string }>();
        if (this.store) {
            try {
                for (const r of await this.store.list()) {
                    byId.set(r.runId, { runId: r.runId, flowName: r.flowName, nodeId: r.nodeId, correlation: r.correlation });
                }
            } catch (err) {
                this.logger.warn(`[automation] failed to list suspended runs from durable store: ${(err as Error).message}`);
            }
        }
        // In-memory entries win — they are the freshest copy.
        for (const r of this.suspendedRuns.values()) {
            byId.set(r.runId, { runId: r.runId, flowName: r.flowName, nodeId: r.nodeId, correlation: r.correlation });
        }
        return [...byId.values()];
    }

    /**
     * The screen a paused run is currently waiting on (screen-flow runtime), or
     * `null` if the run isn't suspended / didn't pause at a screen node. Lets a
     * UI flow-runner re-fetch the form after a refresh.
     */
    getSuspendedScreen(runId: string): ScreenSpec | null {
        return this.suspendedRuns.get(runId)?.screen ?? null;
    }

    // ── DAG Traversal Core ──────────────────────────────────

    private recordLog(entry: ExecutionLogEntry): void {
        this.executionLogs.push(entry);
        // Evict oldest logs when exceeding max size
        if (this.executionLogs.length > this.maxLogSize) {
            this.executionLogs.splice(0, this.executionLogs.length - this.maxLogSize);
        }
        // Durable run history (observability): mirror every TERMINAL run to the
        // store so "did it run / fail, and why?" survives a restart and the
        // in-memory ring-buffer eviction. Best-effort + fire-and-forget: a
        // history write must NEVER block or break the run that produced it.
        const terminal =
            entry.status === 'completed' ||
            entry.status === 'failed' ||
            entry.status === 'cancelled' ||
            entry.status === 'timed_out';
        if (terminal && this.store?.recordTerminal) {
            const lastStep = entry.steps[entry.steps.length - 1];
            const record: RunRecord = {
                runId: entry.id,
                flowName: entry.flowName,
                flowVersion: entry.flowVersion,
                status: entry.status === 'completed' ? 'completed' : 'failed',
                startedAt: entry.startedAt,
                finishedAt: entry.completedAt,
                durationMs: entry.durationMs,
                error: entry.error,
                userId: entry.trigger?.userId,
                nodeId: lastStep?.nodeId,
                steps: this.compactStepsForHistory(entry.steps),
            };
            void this.store.recordTerminal(record).catch((err) => {
                this.logger.warn(
                    `[Automation] run-history persist failed for '${entry.flowName}': ${(err as Error)?.message}`,
                );
            });
        }
    }

    /**
     * Compact a run's step log for durable history: keep the newest
     * {@link MAX_PERSISTED_HISTORY_STEPS} steps (the tail carries the failure)
     * and drop `error.stack` (the code/message pair is the designer-facing
     * "why"; stacks bloat rows without aiding the Runs surface). Bounds the
     * `steps_json` column so history rows stay cheap under retention (#2585).
     */
    private compactStepsForHistory(steps: StepLogEntry[]): StepLogEntry[] {
        return steps.slice(-MAX_PERSISTED_HISTORY_STEPS).map((s) =>
            s.error?.stack ? { ...s, error: { code: s.error.code, message: s.error.message } } : s,
        );
    }

    /**
     * Validate each node's `type` against the live action registry (ADR-0018).
     * A type is known if it is structural (start/end), has a registered
     * executor, or has a published action descriptor. Unknown types are
     * warned about (not rejected) so flows authored against a temporarily
     * absent plugin still register; the runtime surfaces a hard NO_EXECUTOR
     * error if such a node is actually executed.
     */
    private validateNodeTypes(flowName: string, flow: FlowParsed): void {
        const known = new Set<string>([
            ...FLOW_STRUCTURAL_NODE_TYPES,
            ...this.nodeExecutors.keys(),
            ...this.actionDescriptors.keys(),
        ]);
        const unknown = [...new Set(
            flow.nodes.map(n => n.type).filter(t => !known.has(t)),
        )];
        if (unknown.length > 0) {
            this.logger.warn(
                `Flow '${flowName}' references node type(s) with no registered executor or descriptor: ` +
                `${unknown.join(', ')}. They will fail at execution time unless a plugin registers them. ` +
                `Registered types: ${[...known].join(', ') || '(none)'}`,
            );
        }
    }

    /**
     * ADR-0032 §Decision 1a — parse-validate every predicate in the flow at
     * registration. Predicates are bare CEL; this catches the #1491 class
     * (`{record.x}` template braces in a condition → CEL parse error) and any
     * other malformed predicate LOUDLY, with the offending location + source +
     * a corrective hint, instead of letting it fail silently at run time.
     *
     * Only the *predicate* surfaces are checked here (start/node `config.condition`
     * and `edge.condition`) — node string fields are templates (a different
     * dialect) and are validated by the template engine, not as CEL.
     */
    private validateFlowExpressions(flowName: string, flow: FlowParsed): void {
        const failures: string[] = [];

        const check = (where: string, raw: unknown): void => {
            if (raw == null) return;
            // Conditions are predicates (bare CEL). Delegate to the one shared
            // validator (ADR-0032 §5) so the corrective message matches the CLI
            // build and the agent `validate_expression` tool exactly.
            const result = validateExpression('predicate', raw as string | { dialect?: string; source?: string });
            for (const e of result.errors) {
                failures.push(`  • ${where}: ${e.message}\n      source: \`${e.source}\``);
            }
        };

        for (const node of flow.nodes) {
            const cfg = (node.config ?? {}) as Record<string, unknown>;
            // start-node trigger gate + decision/branch predicates live in config.condition
            check(`node '${node.id}' (${node.type}) condition`, cfg.condition);
        }
        for (const edge of flow.edges) {
            check(`edge '${edge.id}' (${edge.source}→${edge.target}) condition`, edge.condition as unknown);
        }

        if (failures.length > 0) {
            throw new Error(
                `Flow '${flowName}' has ${failures.length} invalid condition${failures.length > 1 ? 's' : ''} (ADR-0032 §1a). ` +
                `Conditions are bare CEL — do not wrap field references in \`{…}\` template braces:\n${failures.join('\n')}`,
            );
        }
    }

    /**
     * Detect cycles in the flow graph (DAG validation).
     * Uses DFS with coloring (white/gray/black) to detect back edges.
     * Throws an error with cycle details if a cycle is found.
     *
     * ADR-0044: edges explicitly typed `back` (declared back-edges — e.g. a
     * revise/rework loop re-entering an approval node) are excluded from the
     * analysis: the graph **minus `back` edges** must be a DAG. An unmarked
     * cycle is still rejected — authors opt in edge by edge. At run time a
     * `back` edge traverses like any default edge; the re-entry runaway guard
     * lives in {@link executeNode}.
     */
    private detectCycles(flow: FlowParsed): void {
        const WHITE = 0, GRAY = 1, BLACK = 2;
        const color = new Map<string, number>();
        const parent = new Map<string, string>();

        // Build adjacency list from edges
        const adj = new Map<string, string[]>();
        for (const node of flow.nodes) {
            color.set(node.id, WHITE);
            adj.set(node.id, []);
        }
        for (const edge of flow.edges) {
            if (edge.type === 'back') continue; // ADR-0044 declared back-edge
            const targets = adj.get(edge.source);
            if (targets) targets.push(edge.target);
        }

        const dfs = (nodeId: string): string[] | null => {
            color.set(nodeId, GRAY);
            for (const neighbor of adj.get(nodeId) ?? []) {
                if (color.get(neighbor) === GRAY) {
                    // Back edge found — reconstruct cycle
                    const cycle = [neighbor, nodeId];
                    let cur = nodeId;
                    while (cur !== neighbor) {
                        cur = parent.get(cur)!;
                        if (cur) cycle.push(cur);
                        else break;
                    }
                    return cycle.reverse();
                }
                if (color.get(neighbor) === WHITE) {
                    parent.set(neighbor, nodeId);
                    const result = dfs(neighbor);
                    if (result) return result;
                }
            }
            color.set(nodeId, BLACK);
            return null;
        };

        for (const node of flow.nodes) {
            if (color.get(node.id) === WHITE) {
                const cycle = dfs(node.id);
                if (cycle) {
                    throw new Error(
                        `Flow contains a cycle: ${cycle.join(' → ')}. Only DAG flows are allowed — ` +
                        `to author an intentional rework loop, mark the cycle-closing edge with type: 'back' (ADR-0044).`,
                    );
                }
            }
        }
    }

    /**
     * Get the runtime type name of a value for schema validation.
     */
    private getValueType(value: unknown): string {
        if (Array.isArray(value)) return 'array';
        if (typeof value === 'object' && value !== null) return 'object';
        return typeof value;
    }

    /**
     * Validate node input schemas before execution.
     * Checks that node config matches declared inputSchema if present.
     */
    private validateNodeInputSchemas(flow: FlowParsed, _variables: Map<string, unknown>): void {
        for (const node of flow.nodes) {
            if (node.inputSchema && node.config) {
                for (const [paramName, paramDef] of Object.entries(node.inputSchema)) {
                    if (paramDef.required && !(paramName in (node.config as Record<string, unknown>))) {
                        throw new Error(
                            `Node '${node.id}' missing required input parameter '${paramName}'`,
                        );
                    }
                    const value = (node.config as Record<string, unknown>)[paramName];
                    if (value !== undefined) {
                        const actualType = this.getValueType(value);
                        if (actualType !== paramDef.type) {
                            throw new Error(
                                `Node '${node.id}' parameter '${paramName}' expected type '${paramDef.type}' but got '${actualType}'`,
                            );
                        }
                    }
                }
            }
        }
    }

    /**
     * Execute a node with timeout support, fault edge handling, and step logging.
     */
    private async executeNode(
        node: FlowNodeParsed,
        flow: FlowParsed,
        variables: Map<string, unknown>,
        context: AutomationContext,
        steps: StepLogEntry[],
    ): Promise<void> {
        if (node.type === 'end') return;

        // ADR-0044 runaway guard: declared back-edges make re-entering a node
        // legal, so a misauthored unconditional loop could otherwise spin
        // forever. Count this node's prior *top-level* visits in the run's step
        // log (region body steps carry `parentNodeId` and are excluded — a
        // 200-iteration `loop` region is legitimate) and fail the run loudly
        // past the cap. Product-level guards (e.g. an approval node's
        // `maxRevisions`) terminate far earlier; this is the engine backstop.
        const priorVisits = steps.reduce(
            (n, s) => (s.nodeId === node.id && s.parentNodeId === undefined ? n + 1 : n), 0,
        );
        if (priorVisits >= AutomationEngine.MAX_NODE_REENTRIES) {
            throw new Error(
                `Node '${node.id}' was entered ${priorVisits} times in one run — aborting as a runaway loop ` +
                `(back-edge cycles must terminate; see ADR-0044)`,
            );
        }

        const stepStart = Date.now();
        const stepStartedAt = new Date().toISOString();

        // Find executor
        const executor = this.nodeExecutors.get(node.type);
        if (!executor) {
            // start node without executor is fine — just skip
            if (node.type !== 'start') {
                steps.push({
                    nodeId: node.id,
                    nodeType: node.type,
                    status: 'failure',
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                    durationMs: Date.now() - stepStart,
                    error: { code: 'NO_EXECUTOR', message: `No executor registered for node type '${node.type}'` },
                });
                throw new Error(`No executor registered for node type '${node.type}'`);
            }
            // Log start node step
            steps.push({
                nodeId: node.id,
                nodeType: node.type,
                status: 'success',
                startedAt: stepStartedAt,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - stepStart,
            });
        } else {
            // Execute node with optional timeout
            let result: NodeExecutionResult;
            try {
                if (node.timeoutMs && node.timeoutMs > 0) {
                    result = await this.executeWithTimeout(
                        executor.execute(node, variables, context),
                        node.timeoutMs,
                        node.id,
                    );
                } else {
                    result = await executor.execute(node, variables, context);
                }
            } catch (execErr: unknown) {
                const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
                steps.push({
                    nodeId: node.id,
                    nodeType: node.type,
                    status: 'failure',
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                    durationMs: Date.now() - stepStart,
                    error: { code: 'EXECUTION_ERROR', message: errMsg },
                });

                // Check for fault edges
                const faultEdge = flow.edges.find(e => e.source === node.id && e.type === 'fault');
                if (faultEdge) {
                    variables.set('$error', { nodeId: node.id, message: errMsg });
                    const faultTarget = flow.nodes.find(n => n.id === faultEdge.target);
                    if (faultTarget) {
                        await this.executeNode(faultTarget, flow, variables, context, steps);
                        return;
                    }
                }
                throw execErr;
            }

            if (!result.success) {
                const errMsg = result.error ?? 'Unknown error';
                steps.push({
                    nodeId: node.id,
                    nodeType: node.type,
                    status: 'failure',
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                    durationMs: Date.now() - stepStart,
                    error: { code: 'NODE_FAILURE', message: errMsg },
                });

                // Write error output to variable context for downstream nodes
                variables.set('$error', { nodeId: node.id, message: errMsg, output: result.output });

                // Check for fault edges
                const faultEdge = flow.edges.find(e => e.source === node.id && e.type === 'fault');
                if (faultEdge) {
                    const faultTarget = flow.nodes.find(n => n.id === faultEdge.target);
                    if (faultTarget) {
                        await this.executeNode(faultTarget, flow, variables, context, steps);
                        return;
                    }
                }
                throw new Error(`Node '${node.id}' failed: ${errMsg}`);
            }

            // Log successful step
            steps.push({
                nodeId: node.id,
                nodeType: node.type,
                status: 'success',
                startedAt: stepStartedAt,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - stepStart,
            });

            // #1479: fold a structured-region container's body/branch/handler
            // steps into the run log, right after the container's own step.
            if (result.childSteps?.length) {
                steps.push(...result.childSteps);
            }

            // Write back output variables
            if (result.output) {
                for (const [key, value] of Object.entries(result.output)) {
                    variables.set(`${node.id}.${key}`, value);
                }
            }

            // ADR-0019 durable pause: the node did its on-entry work and asked to
            // suspend here. Output is already written above; unwind the recursion
            // up to execute()/resume(), which persists a continuation. Traversal
            // of this node's out-edges happens on resume, not now.
            if (result.suspend) {
                throw new FlowSuspendSignal(node.id, result.correlation, result.screen);
            }
        }

        // Continue to the node's successors.
        await this.traverseNext(node, flow, variables, context, steps);
    }

    /**
     * Traverse a node's out-edges and execute its successors. Split out of
     * {@link executeNode} so {@link resume} can re-enter traversal from a
     * suspended node without re-running the node body.
     *
     * @param branchLabel - When set (e.g. from a resume signal), restrict
     *   traversal to out-edges whose `label` matches — this is how an Approval
     *   node's `approve`/`reject` decision selects its downstream branch. When
     *   no edge carries the label, traversal falls back to the normal edge set.
     */
    private async traverseNext(
        node: FlowNodeParsed,
        flow: FlowParsed,
        variables: Map<string, unknown>,
        context: AutomationContext,
        steps: StepLogEntry[],
        branchLabel?: string,
    ): Promise<void> {
        // Find next nodes — separate conditional and unconditional edges
        let outEdges = flow.edges.filter(
            e => e.source === node.id && e.type !== 'fault',
        );

        // Branch selection (resume): prefer edges tagged with the decision label.
        if (branchLabel) {
            const labeled = outEdges.filter(e => e.label === branchLabel);
            if (labeled.length > 0) outEdges = labeled;
        }

        const conditionalEdges: FlowEdgeParsed[] = [];
        const unconditionalEdges: FlowEdgeParsed[] = [];
        for (const edge of outEdges) {
            if (edge.condition) {
                conditionalEdges.push(edge);
            } else {
                unconditionalEdges.push(edge);
            }
        }

        // Conditional edges: evaluate sequentially (mutually exclusive)
        for (const edge of conditionalEdges) {
            if (this.evaluateCondition(edge.condition!, variables)) {
                const nextNode = flow.nodes.find(n => n.id === edge.target);
                if (nextNode) {
                    await this.executeNode(nextNode, flow, variables, context, steps);
                }
            }
        }

        // Unconditional edges: execute in parallel (Promise.all)
        if (unconditionalEdges.length > 0) {
            const parallelTasks = unconditionalEdges
                .map(edge => flow.nodes.find(n => n.id === edge.target))
                .filter((n): n is FlowNodeParsed => n != null)
                .map(nextNode => this.executeNode(nextNode, flow, variables, context, steps));

            await Promise.all(parallelTasks);
        }
    }

    /**
     * Execute a structured control-flow **region** (ADR-0031) — the nested
     * body of a `loop` container (or, later, a `parallel` branch / `try_catch`
     * region). The region is a self-contained single-entry/single-exit
     * sub-graph carried in the container's `config`; it runs in the **enclosing
     * variable scope** (the caller's `variables` map), so the iterator variable
     * and any body mutations are visible to the surrounding flow — a region is
     * NOT a separate `subflow` invocation.
     *
     * The region executes against a synthetic flow view of its own
     * nodes/edges, so the main DAG traversal (`traverseNext`) is never aware of
     * scope markers — keeping the shared traversal untouched.
     *
     * #1479: the executed body steps are **returned** (tagged with `grouping`)
     * so the calling container node can fold them into the parent run log via
     * `NodeExecutionResult.childSteps`. Tagging only fills fields left undefined,
     * so when regions nest, each step keeps its **innermost** container's
     * `parentNodeId` / `iteration` / `regionKind`. On failure the region throws
     * as before (preserving `try_catch` retry semantics); a failed attempt's
     * partial steps are not surfaced.
     *
     * Durable pause (`suspend`) inside a region is not supported in this
     * iteration — it is converted into a clear error (mirrors the `subflow`
     * nested-pause guard).
     */
    async runRegion(
        region: FlowRegionParsed,
        variables: Map<string, unknown>,
        context: AutomationContext,
        grouping?: { parentNodeId: string; iteration?: number; regionKind?: string },
    ): Promise<StepLogEntry[]> {
        const entryId = findRegionEntry(region);
        const entry = region.nodes.find(n => n.id === entryId);
        if (!entry) {
            throw new Error(`region entry node '${entryId}' not found`);
        }
        // A synthetic flow view — executeNode/traverseNext only read `nodes`/`edges`.
        const subFlow = { nodes: region.nodes, edges: region.edges ?? [] } as unknown as FlowParsed;
        const regionSteps: StepLogEntry[] = [];
        try {
            await this.executeNode(entry, subFlow, variables, context, regionSteps);
        } catch (err) {
            if (isSuspendSignal(err)) {
                throw new Error(
                    `durable pause inside a structured region (node '${err.nodeId}') is not supported`,
                );
            }
            throw err;
        }
        // Tag this region's steps with their immediate container. Innermost wins:
        // a step that already carries a `parentNodeId` (set by a nested region)
        // is left untouched.
        if (grouping) {
            for (const step of regionSteps) {
                if (step.parentNodeId === undefined) {
                    step.parentNodeId = grouping.parentNodeId;
                    if (grouping.iteration !== undefined) step.iteration = grouping.iteration;
                    if (grouping.regionKind !== undefined) step.regionKind = grouping.regionKind;
                }
            }
        }
        return regionSteps;
    }

    /**
     * Execute a promise with timeout using Promise.race.
     */
    private executeWithTimeout(
        promise: Promise<NodeExecutionResult>,
        timeoutMs: number,
        nodeId: string,
    ): Promise<NodeExecutionResult> {
        return Promise.race([
            promise,
            new Promise<NodeExecutionResult>((_, reject) =>
                setTimeout(() => reject(new Error(`Node '${nodeId}' timed out after ${timeoutMs}ms`)), timeoutMs),
            ),
        ]);
    }

    /**
     * Safe expression evaluator.
     * Uses simple operator-based parsing without `new Function`.
     * Supports: comparisons (>, <, >=, <=, ==, !=, ===, !==),
     * boolean literals (true, false), and basic arithmetic.
     */
    evaluateCondition(expression: string | { dialect?: string; source?: string; ast?: unknown }, variables: Map<string, unknown>): boolean {
        // M9.5+ wiring: route Expression envelopes through @objectstack/formula
        // ExpressionEngine. CEL is the default; legacy `{var}` template syntax
        // is preserved as a fallback for back-compat.
        const isEnvelope = typeof expression === 'object' && expression != null && 'dialect' in expression;
        const dialect = isEnvelope ? (expression as { dialect?: string }).dialect : undefined;
        const exprStr = typeof expression === 'string' ? expression : ((expression as { source?: string })?.source ?? '');

        if (isEnvelope && dialect && dialect !== 'cel' && dialect !== 'flow' && dialect !== 'template') {
            // Other dialects (cron, js) are not boolean predicates here.
            return false;
        }

        // CEL path — bind `vars` scope for `{step.result}` style references via
        // the equivalent `vars.step.result` CEL identifier path.
        if (dialect === 'cel' || (isEnvelope && !dialect)) {
            try {
                const vars: Record<string, unknown> = {};
                for (const [key, value] of variables) {
                    // Convert "step.result" keys into nested object paths.
                    const segs = key.split('.');
                    let cursor = vars;
                    for (let i = 0; i < segs.length - 1; i++) {
                        if (typeof cursor[segs[i]] !== 'object' || cursor[segs[i]] === null) {
                            cursor[segs[i]] = {};
                        }
                        cursor = cursor[segs[i]] as Record<string, unknown>;
                    }
                    cursor[segs[segs.length - 1]] = value;
                }
                // Expose variables two ways under `extra`: as a `vars` namespace
                // (so `vars.step.result` keeps working) AND spread to top level (so
                // bare identifiers like `status` / `previous.status` resolve — the
                // natural authoring style for record-change start conditions).
                const result = ExpressionEngine.evaluate(
                    { dialect: 'cel', source: exprStr },
                    { extra: { ...vars, vars }, record: vars },
                );
                // ADR-0032 §Decision 1c — NO silent fallback. A non-`ok` result is a
                // real fault (malformed predicate, or — pre build-validation — a
                // `{…}` template mistakenly written into a CEL condition). Surfacing
                // it as a thrown, attributed error makes execute()'s catch record a
                // loud flow failure, instead of the old `return false` that made a
                // broken condition indistinguishable from "condition not met" (#1491).
                if (!result.ok) {
                    throw new Error(
                        `condition failed to evaluate as CEL: ${result.error?.message ?? 'unknown error'} — ` +
                        `source: \`${exprStr}\`. Conditions are bare CEL (e.g. \`record.rating >= 4\`); ` +
                        `do not wrap field references in \`{…}\` template braces.`,
                    );
                }
                return Boolean(result.value);
            } catch (err) {
                // Re-throw with the source attached (ADR-0032 §1d — errors written
                // for self-correction). Never swallow to `false`.
                const msg = (err as Error)?.message ?? String(err);
                throw new Error(
                    msg.includes('source:') ? msg : `condition evaluation error: ${msg} — source: \`${exprStr}\``,
                );
            }
        }

        // Legacy template path: {varName} → value, then primitive compare.
        let resolved = exprStr;
        for (const [key, value] of variables) {
            resolved = resolved.split(`{${key}}`).join(String(value));
        }
        resolved = resolved.trim();

        try {
            // Boolean literals
            if (resolved === 'true') return true;
            if (resolved === 'false') return false;

            // Comparison operators (ordered by length to match longer operators first)
            const operators = ['===', '!==', '>=', '<=', '!=', '==', '>', '<'] as const;
            for (const op of operators) {
                const idx = resolved.indexOf(op);
                if (idx !== -1) {
                    const left = resolved.slice(0, idx).trim();
                    const right = resolved.slice(idx + op.length).trim();
                    return this.compareValues(left, op, right);
                }
            }

            // Numeric truthy check
            const numVal = Number(resolved);
            if (!isNaN(numVal)) return numVal !== 0;

            return false;
        } catch {
            return false;
        }
    }

    /**
     * Compare two string-represented values with an operator.
     */
    private compareValues(left: string, op: string, right: string): boolean {
        const lNum = Number(left);
        const rNum = Number(right);
        const bothNumeric = !isNaN(lNum) && !isNaN(rNum) && left !== '' && right !== '';

        if (bothNumeric) {
            switch (op) {
                case '>': return lNum > rNum;
                case '<': return lNum < rNum;
                case '>=': return lNum >= rNum;
                case '<=': return lNum <= rNum;
                case '==': case '===': return lNum === rNum;
                case '!=': case '!==': return lNum !== rNum;
                default: return false;
            }
        }
        // String comparison
        switch (op) {
            case '==': case '===': return left === right;
            case '!=': case '!==': return left !== right;
            case '>': return left > right;
            case '<': return left < right;
            case '>=': return left >= right;
            case '<=': return left <= right;
            default: return false;
        }
    }

    /**
     * Retry execution with exponential backoff, jitter, and recursive protection.
     * Uses an iterative loop with an internal retry flag to prevent recursive call stacking.
     */
    private async retryExecution(
        flowName: string,
        context: AutomationContext | undefined,
        startTime: number,
        errorHandling: {
            maxRetries?: number;
            retryDelayMs?: number;
            backoffMultiplier?: number;
            maxRetryDelayMs?: number;
            jitter?: boolean;
        },
    ): Promise<AutomationResult> {
        const maxRetries = errorHandling.maxRetries ?? 3;
        const baseDelay = errorHandling.retryDelayMs ?? 1000;
        const multiplier = errorHandling.backoffMultiplier ?? 1;
        const maxDelay = errorHandling.maxRetryDelayMs ?? 30000;
        const useJitter = errorHandling.jitter ?? false;

        let lastError = 'Max retries exceeded';
        for (let i = 0; i < maxRetries; i++) {
            // Calculate delay with exponential backoff
            let delay = Math.min(baseDelay * Math.pow(multiplier, i), maxDelay);
            if (useJitter) {
                delay = delay * (0.5 + Math.random() * 0.5);
            }
            await new Promise(r => setTimeout(r, delay));

            // Execute directly without recursion into retryExecution again
            const result = await this.executeWithoutRetry(flowName, context);
            if (result.success) return result;
            lastError = result.error ?? 'Unknown error';
        }
        return { success: false, error: lastError, durationMs: Date.now() - startTime };
    }

    /**
     * Execute a flow without triggering retry logic (used by retryExecution to prevent recursion).
     */
    private async executeWithoutRetry(
        flowName: string,
        context?: AutomationContext,
    ): Promise<AutomationResult> {
        const startTime = Date.now();
        const flow = this.flows.get(flowName);

        if (!flow) {
            return { success: false, error: `Flow '${flowName}' not found` };
        }
        if (this.flowEnabled.get(flowName) === false) {
            return { success: false, error: `Flow '${flowName}' is disabled` };
        }

        const variables = new Map<string, unknown>();
        if (flow.variables) {
            for (const v of flow.variables) {
                if (v.isInput && context?.params?.[v.name] !== undefined) {
                    variables.set(v.name, context.params[v.name]);
                }
            }
        }
        if (context?.record) {
            variables.set('$record', context.record);
        }

        const runId = this.nextRunId();
        const startedAt = new Date().toISOString();
        const steps: StepLogEntry[] = [];

        // ADR-0049 / #1888 — establish the run's effective execution identity
        // from flow.runAs (see execute() / resolveRunContext); threaded below.
        const runContext = this.resolveRunContext(flow, context);

        try {
            const startNode = flow.nodes.find(n => n.type === 'start');
            if (!startNode) {
                return { success: false, error: 'Flow has no start node' };
            }

            await this.executeNode(startNode, flow, variables, runContext, steps);

            const output: Record<string, unknown> = {};
            if (flow.variables) {
                for (const v of flow.variables) {
                    if (v.isOutput) {
                        output[v.name] = variables.get(v.name);
                    }
                }
            }

            const durationMs = Date.now() - startTime;
            this.recordLog({
                id: runId,
                flowName,
                flowVersion: flow.version,
                status: 'completed',
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs,
                trigger: {
                    type: context?.event ?? 'manual',
                    userId: context?.userId,
                    object: context?.object,
                },
                steps,
                output,
            });

            return { success: true, output, durationMs };
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const durationMs = Date.now() - startTime;
            this.recordLog({
                id: runId,
                flowName,
                flowVersion: flow.version,
                status: 'failed',
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs,
                trigger: {
                    type: context?.event ?? 'manual',
                    userId: context?.userId,
                    object: context?.object,
                },
                steps,
                error: errorMessage,
            });
            return { success: false, error: errorMessage, durationMs };
        }
    }
}
