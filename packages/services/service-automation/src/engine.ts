// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { FlowParsed, FlowNodeParsed } from '@objectstack/spec/automation';
import type {
    ExecutionLog,
    ExecutionStatus,
    ActionDescriptor,
    ExecutionStepMetrics,
    ExecutionStepSkipReason,
    FlowFunctionEffect,
    FlowRunSummary,
} from '@objectstack/spec/automation';
import type { AutomationContext, AutomationResult, ResumeSignal, IAutomationService, RunListResult, ScreenSpec, ScreenFieldSpec, ConnectorSourcePullRequest, ConnectorSourcePullResult } from '@objectstack/spec/contracts';
import type { FlowRegistration, FlowRegistrationRefusal, FlowInnerRefusal } from '@objectstack/spec/api';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import {
    validateScreenInputs,
    screenDeclaresInputContract,
    declaredScreenFieldNames,
    type ScreenFieldVisibility,
} from './screen-input-contract.js';
import type { Logger } from '@objectstack/spec/contracts';
import type { FlowUnboundCause } from '@objectstack/spec/contracts';
import { FLOW_HOOK_SECRET_KEY, flowCredentialClassLabel, flowCredentialPositions } from './flow-credential-projection.js';
import { FlowSchema, FLOW_RESERVED_NODE_TYPES, FLOW_STRUCTURAL_NODE_TYPES, validateControlFlow, collectFlowGraphs } from '@objectstack/spec/automation';
// [#14328] The ONE answer to "which trigger kind does this flow ask for?" —
// shared with `defineStack`'s trigger-capability refusal and `@objectstack/lint`'s
// `validate-flow-trigger-readiness`, so the runtime cannot drift from what
// authoring accepted. See `resolveTriggerBinding`.
import { resolveFlowTriggerKind, resolveScheduleOrganization } from '@objectstack/spec/automation';
import {
    resolveScheduledWorkPolicy,
    scheduledWorkDisabledReason,
    type ScheduledWorkPolicy,
} from '@objectstack/types';
import { applyConversionsToFlow, CONVERSION_TODO_CODE, type ConversionNotice, type ConversionTodoNotice } from '@objectstack/spec';
// [ADR-0126 §7.3, #20761] "Does a code package ship this flow?" is NOT read
// off a definition here. The subflow guards, the arming gate and the
// activation door ask {@link AutomationEngine.packagedFlowOwner} — the loader's
// set, attached by the host — because a definition reaches `registerFlow`
// through authoring doors too, and its provenance stamps are the caller's.
import type { FlowRegionParsed } from '@objectstack/spec/automation';
import type {
    Connector,
    ConnectorActionEffect,
    ConnectorProviderFactory,
    ConnectorOrigin,
    ConnectorState,
    ConnectorDescriptor,
} from '@objectstack/spec/integration';
import { ConnectorSchema } from '@objectstack/spec/integration';

/**
 * The branch a `decision` node reports when it DECLARED `config.conditions` and
 * none of them matched — "fall through to the declared fallback".
 *
 * Two spellings claim it in {@link AutomationEngine.traverseNext}: an out-edge
 * literally `label`led `'default'` (the historical, documented spelling) and an
 * out-edge marked `isDefault: true` (the BPMN default flow, canonical since
 * #4414). A decision that declares NO conditions reports no branch at all — it
 * has nothing to fall through *from*, and inventing a label for it is what made
 * every decision node in the repo emit an unclaimable `'default'`.
 */
export const DEFAULT_BRANCH_LABEL = 'default';

import { runTriggerUserId, type SeededRunContext } from './runtime-identity.js';
import { carriedRefusalOfResult, readCarriedRefusal, type CarriedRefusal } from './inner-refusal.js';
import { summarizeRun } from './run-summary.js';
// #5660 — the degrade registration reports a FOREIGN failure (a third-party
// provider factory's text), so it renders it as structured `meta` rather than
// interpolating it into the log message. See ./thrown-cause-diagnostics.ts.
import { describeThrownForLog } from './thrown-cause-diagnostics.js';
// [#15788] The refusing `end` node renders its `message` through the SAME
// interpolator a screen `description` gets — the ruling's own words, so a
// shared function rather than a second template engine. A value import from
// `./builtin/` is safe in this direction: `template.ts` imports only
// `../guard-refusal.js` and package-external contracts, so nothing it pulls in
// reaches back here.
import { renderTextSlot, FlowTextTemplateError } from './builtin/template.js';
// [#22450] The one bundle-locale negotiation rule (exact → case-insensitive →
// base language → variant expansion), asked about the locales the i18n service
// holds — the same question objectql's `negotiatedMessageLocale` asks it.
import { flowRefusalMessageKey, resolveBundleLocale } from '@objectstack/spec/system';
// [#25222] The registration-time checks' bodies, and the declarations only
// they read. Each `AutomationEngine` method of the same name calls its body.
import {
    registrationChecks,
    registrationCheckRefusals,
    validateNodeConfigKeys,
    validateDecisionModes,
    validateApiTriggerSecret,
    collectUndeclaredConfigKeys,
    validateFlowExpressions,
    detectCycles,
    type ConfigSchemaNode,
    type RegistrationCheckRefusal,
    type RegistrationCheckSite,
    type UndeclaredConfigKey,
} from './flow-registration-checks.js';
// [#25222] The Plugin Extension API's bodies: node executors, triggers and
// connectors. Each `AutomationEngine` method of the same name calls its body.
import {
    registerNodeExecutor,
    warnIfResumeAuthorityUndeclared,
    registerNodeAlias,
    registerTrigger,
    deriveTriggerBinding,
    registerConnector,
    registerDegradedConnector,
    assertSameOriginOrFree,
} from './plugin-extension-api.js';
// [#25222] The DAG traversal's bodies: node execution, edge traversal, regions,
// run attempts, run variables, and condition and value evaluation. Each
// `AutomationEngine` method of the same name calls its body.
import {
    executeNode,
    traverseNext,
    runRegion,
    executeWithTimeout,
    celScope,
    valueEnvelopeRefusals,
    evaluateValueEnvelope,
    evaluateCondition,
    seedDeclaredVariables,
    seedRunVariables,
    executeWithoutRetry,
    type runUserOf,
} from './dag-traversal.js';
// [#25222] The run history's bodies: recording a run's log entry, finishing a
// refused run, and reading runs and suspended runs back. Each
// `AutomationEngine` method of the same name calls its body.
import {
    listRuns,
    listRunsPage,
    runRecordToLogEntry,
    suspendedRunToLogEntry,
    getRun,
    listSuspendedRuns,
    readSuspendedRuns,
    recordLog,
    finishRefusedRun,
} from './run-history.js';
// [#25222] The run context and resume bodies: resolving a run's context,
// grants and declared lookups; loading, gating and resuming a suspended run;
// and failing, settling or cancelling one, along with its ancestors. Each
// `AutomationEngine` method of the same name calls its body.
import {
    resolveRunContext,
    seedRunGrants,
    resolveDecisionSegmentContext,
    expandDeclaredLookups,
    resume,
    refuseGatedResume,
    refuseUndeclaredSuspension,
    loadSuspendedRun,
    loadSuspendedRunStrict,
    creditChildRun,
    failSuspendedRun,
    settleUnresumableSuspension,
    cancelRun,
    cloneVariablesAtPause,
    failAncestors,
} from './run-resume.js';

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

    /**
     * The mirror of `suspend: true` — called once a suspension THIS node type
     * created is consumed, whichever path consumed it (#5512).
     *
     * A pausing executor usually arms something external on entry (a one-shot
     * wake-up job, a reminder, a lease). Only its own wake path used to tear
     * that down, so a pause ended by *anything else* — an external
     * `resume(runId)` through the REST door, a {@link AutomationEngine.cancelRun},
     * a subflow ancestor failing — left the armature live: #5512 was a
     * `flow-wait` one-shot still `active` in `sys_job` a day after its run had
     * completed, pointed at a run that no longer existed.
     *
     * Called by {@link AutomationEngine.forgetSuspendedRun}, the single choke
     * point every consumption goes through, so an executor that implements this
     * disarms on **all** of them and never needs to know which one fired. It
     * runs after the suspension is gone from the cache and the durable store:
     * teardown is best-effort observability work and must not hold up (or fail)
     * the continuation — the engine catches and logs whatever it throws.
     *
     * @param release - Which suspension ended, and how. `correlation` is the
     *   handle the executor itself returned at suspend time.
     */
    onSuspensionReleased?(release: SuspensionRelease): Promise<void> | void;
}

/** How a suspension ended — see {@link SuspensionRelease}. */
export type SuspensionReleaseReason =
    /** Continued past the paused node (timer fired, signal arrived, screen submitted, …). */
    | 'resumed'
    /** Terminally failed while paused (e.g. a subflow descendant failed under it). */
    | 'failed'
    /** Terminally cancelled while paused ({@link AutomationEngine.cancelRun}, ADR-0044). */
    | 'cancelled';

/**
 * A consumed suspension, handed to {@link NodeExecutor.onSuspensionReleased} so
 * the node that armed a pause can tear down what it armed (#5512).
 */
export interface SuspensionRelease {
    runId: string;
    flowName: string;
    /** The node the run was paused at — the one whose executor is notified. */
    nodeId: string;
    /**
     * The correlation key the node returned with `suspend: true` (its own handle
     * on the pause — e.g. the `wait` node's one-shot job name). Absent when the
     * node suspended without one.
     */
    correlation?: string;
    reason: SuspensionReleaseReason;
}

/**
 * Why a node failed — the question a `fault` edge's routing decision turns on
 * (#3863).
 *
 *  - `runtime` — the world did not cooperate: an `http` node got a 404, a
 *    connector rate-limited, the data engine rejected a write. The metadata is
 *    fine and a later run could succeed. A declared `fault` edge routes it.
 *  - `guard` — the METADATA is wrong, and a refuse-to-execute guard said so:
 *    a filter operand evaluated to nothing (#3810), a data node names no
 *    object, a run would execute unscoped (ADR-0049/#1888). Re-running changes
 *    nothing, and the refusal IS the safety property. Not routable — it stays
 *    fatal whether or not a `fault` edge exists.
 *
 * The split exists because without it a `fault` edge is a one-edge switch that
 * turns off the platform's data-safety guarantees: attach one to a
 * `delete_record` and #3810's protection against emptying the object is gone,
 * while the run still reports success. Absent, this defaults to `runtime`, so
 * every executor written before the field keeps its current routing behaviour.
 */
export type NodeFailureClass = 'runtime' | 'guard';

export interface NodeExecutionResult {
    success: boolean;
    output?: Record<string, unknown>;
    error?: string;
    /**
     * Commit c5a7448d5 — the platform's own classified failure code (ADR-0112
     * `StandardErrorCode`, e.g. `DUPLICATE_RECORD`), when the executor chose
     * to surface one. `error` stays the human-readable sentence a run log or
     * a notification renders; `code` is what a `try_catch` catch region or a
     * `fault` edge handler can actually BRANCH on (`{$error.code}`) to tell
     * "the row is already there" apart from "the store is down" or any other
     * reason the same string-shaped `error` could otherwise describe.
     * Optional, and deliberately narrow per executor rather than "any
     * platform envelope, forwarded wholesale": the CRUD executors are the only
     * ones that set it today, each only for a code it classifies itself —
     * `create_record` for `DUPLICATE_RECORD` (commit c5a7448d5), `get_record`
     * for the data door's own code on a filter that evaluates the
     * stored-metadata family (#21623), and `create_record` / `update_record` /
     * `delete_record` for `PERMISSION_DENIED` on a stored-metadata family
     * target (#21624) — never a code a driver error might someday carry
     * unaudited. An executor that never classifies
     * a failure leaves it unset, exactly as before this field existed. See
     * {@link AutomationEngine.executeNode}, which copies it onto `$error`
     * beside `message`, and `try_catch`'s executor, which preserves it
     * across its own `errorVariable` binding (subject to the identity guard
     * described there — a node that FAILS BY THROWING with no fault edge of
     * its own must not inherit an earlier failure's leftover `code`).
     */
    code?: string;
    /**
     * [#24914, ruling B′] The producer-marked END-USER text of the refusal this
     * node's data call met, verbatim (`declaredUserMessage`'s reading of the
     * caught error) — absent when the producer marked none. Only meaningful
     * when `success` is false. Never read by the flow itself: it is carried to
     * the run's caller as `AutomationResult.userMessage`, through the brand
     * {@link AutomationEngine.executeNode} puts on the failure it throws
     * (`inner-refusal.ts`). `error` keeps its wording; this rides beside it.
     */
    userMessage?: string;
    /**
     * [#24914, ruling B′] The refusal this node's data call met, structured —
     * `{ code, message }`, `code` in its WIRE spelling (`UNIQUE_VIOLATION`
     * where {@link code} above says `DUPLICATE_RECORD` in-flow). Set by the
     * CRUD executors' catch arms, and only for a thrown value that declared a
     * 4xx answer (`refusalCarriedBy`, `inner-refusal.ts`). Carried to the
     * run's caller as `AutomationResult.innerRefusal`, exactly like
     * {@link userMessage}; ⛔ never synthesised from `error`'s text.
     */
    innerRefusal?: FlowInnerRefusal;
    /**
     * #3863 — why this failed, which decides whether a `fault` edge may route it.
     * Only meaningful when `success` is false; defaults to `runtime`.
     * See {@link NodeFailureClass}.
     */
    errorClass?: NodeFailureClass;
    /**
     * #3407: advisory warnings surfaced on the step's log entry. The step still
     * SUCCEEDS — a warning flags a legal-but-surprising outcome (e.g. an
     * `update_record` whose requested fields the data layer legally stripped as
     * `readonly`/`readonlyWhen`) so the run trace never shows a clean success
     * for a write that partially didn't land. {@link AutomationEngine.executeNode}
     * copies them onto the {@link StepLogEntry}.
     */
    warnings?: string[];
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
     * [#18110 / #18555] Terminal REFUSAL. When `true`, the node evaluated
     * successfully and the answer is *no*: the engine stops traversal here and
     * the run finishes as a TERMINAL `refused` (a member of
     * {@link TERMINAL_RUN_STATUSES} since #15788 — ⛔ no new status value),
     * carrying {@link NodeExecutionResult.refusalMessage} onto the result and
     * the run-history row.
     *
     * **The twin of {@link NodeExecutionResult.suspend}, deliberately.** Both
     * are executor-facing flags asking {@link AutomationEngine.executeNode} to
     * throw an internal unwinding signal, and both are read at the same point:
     * AFTER the node's success step is pushed, after its `childSteps` are
     * folded and after its output is written back. That position is the whole
     * design — it is what keeps a refusing node's own #4354 `metrics`
     * (`selected` / `acted` / `unmeasuredEffect`) in the run log and therefore
     * in the run summary, instead of losing them to an unwind that began
     * earlier. ⛔ Not a second unwinding protocol: `FlowRefusalSignal` already
     * reuses `FlowSuspendSignal`'s, and this member is that protocol's
     * executor-facing half, exactly as `suspend` is the pause's.
     *
     * ⚠️ `refused` here is the run OUTCOME — *a refusal is a successful
     * evaluation that says no* — ⛔ NOT this package's other `refused`, the
     * GUARD refusal (`refuseNode`, `guard-refusal.ts`, the resume-authority
     * gate), which is a kind of FAILURE. A node that failed says so with
     * `success: false`, and this flag is read only past the failure arm: on a
     * failing result it changes nothing, which is the right answer rather than
     * an oversight.
     *
     * **Precedence over `suspend`**: a refusal is terminal and a pause is a
     * promise to come back, so a result carrying both REFUSES. Persisting a
     * continuation for a decision the author already made would drop the
     * refusal on the floor — the same fail-open direction this channel exists
     * to close. No first-party executor sets both (`subflow` / `map` read one
     * child status); one that does has declared a contradiction.
     *
     * ⚠️ With ONE exception, and it is FAIL-CLOSED. The #6667
     * undeclared-suspension guard runs ahead of all of this and reads
     * {@link NodeExecutionResult.suspend} alone: when the node type resolves to
     * an action descriptor that does not declare `supportsPause: true`, that
     * guard REPLACES the whole result with a guard refusal, the failure arm
     * answers it, and `refuse` is never read at all — the run ends `failed`,
     * not `refused`. That is the correct end for a declaration defect (⛔ no
     * `fault` edge may route it, and re-running the flow unchanged can never
     * fix it), so ⛔ do not reorder the guard to let this member through. The
     * paragraph above describes the case the guard has nothing to say about:
     * a type with no descriptor, or one that declares the pause it uses.
     *
     * Set today by `subflow` (#18110) and `map` (#18555) when their child run
     * returned `status: 'refused'`: a refusal an author wrote inside a child
     * flow must not roll up to the parent as an ordinary success.
     */
    refuse?: boolean;
    /**
     * The rendered reason for {@link NodeExecutionResult.refuse}, surfaced as
     * `AutomationResult.refusalMessage` and on the terminal run-history row.
     *
     * For `subflow` / `map` this is the CHILD run's own `refusalMessage`,
     * already interpolated against the child's live variables — passed through,
     * ⛔ never re-rendered and ⛔ never replaced with text this node invented.
     * `undefined` only when the refusal carried none, recorded honestly rather
     * than filled in.
     */
    refusalMessage?: string;
    /**
     * #1479: step logs produced inside the node's structured region(s). A
     * container node (`loop` / `parallel` / `try_catch`) collects the
     * {@link AutomationEngine.runRegion} return value(s) here; {@link AutomationEngine.executeNode}
     * appends them to the parent run log right after the container's own step,
     * so per-iteration / per-branch body steps surface in run observability.
     */
    childSteps?: StepLogEntry[];
    /**
     * #4354: how many records this execution **read** and **wrote**, reported by
     * the executor and folded into the run summary by {@link summarizeRun}.
     *
     * Declared by the node rather than inferred by the engine from `output`,
     * because only the node knows what its result *means*: `update_record`'s
     * `result` is a row count on a bulk write and the updated record on a
     * by-id one, `delete_record`'s can be a boolean, `notify`'s is a delivery
     * count. An engine that sniffed those shapes would be guessing, and a
     * machine-readable count that guesses is worse than none (ADR-0076 D12 —
     * "machine-readable surfaces must not lie").
     *
     * Omit it entirely for a node that touches no records (`decision`,
     * `assignment`): absent means "reads/writes nothing", which is a different
     * fact from `0`.
     */
    metrics?: ExecutionStepMetrics;
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
    /**
     * [commit ecdfc9411] schedule / time_relative: the ACTING ORGANIZATION the flow
     * declares on its start node (`config.organization`), resolved through
     * `@objectstack/spec`'s {@link resolveScheduleOrganization} so authoring,
     * this lift and the triggers cannot disagree about what counts as declared.
     *
     * Populated only for the two time-triggered kinds. `record_change` and
     * `api` bindings leave it `undefined` BY CONSTRUCTION rather than by
     * omission: both are fired by a caller who already carries an organization,
     * and lifting a declared one onto them would let a flow overrule the tenant
     * of the very write that triggered it.
     *
     * `undefined` here is a REFUSAL condition for the trigger that receives it,
     * never a default to be filled in downstream: the time triggers THROW from
     * `start()` on it, so {@link activateFlowTrigger}'s catch records the flow
     * as unbound and {@link getTriggerBindingAudit} lists it — see the schedule
     * trigger's `refuseMissingOrganization`.
     */
    readonly organization?: string;
    /** The raw start-node `config`, for trigger-specific fields not modeled above. */
    readonly config?: Record<string, unknown>;
    /**
     * [#20790] api: the inbound hook's secret, read at VERIFICATION time —
     * present whenever the flow has one, whether its definition carries it as
     * a literal (a packaged flow) or the write-only credential channel holds it
     * (every flow stored through the metadata save door; `config` then carries
     * none). The channel's row wins where one exists. Never cached: a rotation
     * applies to the next post. Rejects when a held secret does not come back —
     * the trigger answers that post as unavailable, never as verified.
     */
    readonly resolveSecret?: () => Promise<string | undefined>;
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

// `ConnectorOrigin` / `ConnectorState` / `ConnectorDescriptor` /
// `ConnectorActionDescriptor` are declared in `@objectstack/spec/integration`
// (imported above, re-exported from this package's index). [#4127] They used to
// be declared HERE — which put the return type of `IAutomationService`'s
// `getConnectorDescriptors` inside one implementation of that contract, so the
// contract could not name the method and the dispatcher route serving it had to
// duck-type it. Same reason the provider contract lives in the spec: a
// connector plugin or a designer client speaks about registered connectors
// without importing this engine.

/**
 * A connector registered on the engine: its validated {@link Connector}
 * definition plus the handler for each action it declares.
 */
export interface RegisteredConnector {
    readonly def: Connector;
    readonly handlers: Record<string, ConnectorActionHandler>;
    /** How this connector was registered (ADR-0097 §4). Defaults to `plugin`. */
    readonly origin: ConnectorOrigin;
    /** Dispatchability (#3017). `registerConnector` always yields `ready`. */
    readonly state: ConnectorState;
    /** Why the connector is degraded — set only when `state` is `degraded`. */
    readonly degradedReason?: string;
}

// The connector **provider** contract (ADR-0097) — ConnectorProviderFactory,
// ConnectorProviderContext, ConnectorMaterialization — lives in
// `@objectstack/spec/integration` so a connector plugin can implement a factory
// depending only on the spec, with no runtime coupling to this engine. Imported
// above; re-exported from this package's index for convenience.

/**
 * Context handed to a named handler function invoked from a `script` node
 * (#1870). Mirrors {@link ConnectorActionContext} but carries the node's mapped
 * `input` so the function reads its arguments without reaching into the raw
 * variable map. The function's return value becomes the node output.
 *
 * Note what is NOT here: any handle on the data engine. A flow function is a
 * pure compute step (`ActionDescriptor.handlerContract: 'pure'`, #4396) — it
 * returns a value and a later declarative node persists it — so the context
 * gives it nothing to write with. That is as far as the runtime can go: a
 * function is ordinary host code and may close over a client at module scope,
 * which is why one that legitimately writes DECLARES it
 * (`FlowFunctionEffect`) instead of being detected.
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
 * A resolved function: the callable plus what it DECLARED about itself at
 * registration (#4396).
 *
 * The effect is what keeps the run summary honest for the one case the purity
 * contract does not cover. A `script` step normally reports no record metrics —
 * accurate, because a pure function's writes are downstream declarative nodes
 * that count themselves — but a function declared `'writes'` gets its step
 * marked `unmeasuredEffect`, so the run says "an effect I cannot count"
 * rather than claiming it wrote nothing.
 */
export interface FlowFunctionRegistration {
    readonly handler: FlowFunctionHandler;
    /** Declared data effect. Absent ⇒ `'pure'`, the contract's default. */
    readonly effect?: FlowFunctionEffect;
}

/**
 * Resolves a function name to its handler. Injected by the host (the automation
 * plugin bridges it to ObjectQL's function registry, fed by `bundle.functions`),
 * so the engine stays decoupled from any specific function registry. Returns
 * `undefined` for an unknown name, letting the `script` node fail the step
 * loudly instead of silently no-op'ing (#1870).
 *
 * A resolver may return the bare handler — which IS the declaration
 * `effect: 'pure'`, written the short way — or a {@link FlowFunctionRegistration}
 * carrying what the function declared.
 */
export type FlowFunctionResolver = (
    name: string,
) => FlowFunctionHandler | FlowFunctionRegistration | undefined;

/**
 * Resolves the schema of the object a flow's conditions bind against — its field
 * names and (spec) types — so `registerFlow` can run the same schema-aware
 * expression checks as `objectstack build` (ADR-0032 tiers 2–4): unknown
 * `record.<field>` refs, likely bare-field typos, and text/boolean fields
 * misused in arithmetic (#1928). Injected by the host (bridged to the object
 * registry), so the engine stays decoupled from any metadata store. Returns
 * `undefined` for an unknown object. When unwired, registration validation is
 * unchanged (syntax + bare-ref only). Everything it surfaces is advisory (logged
 * as a warning, never thrown) — a resolver can never break a flow that used to
 * register cleanly.
 */
export type FlowObjectSchemaResolver = (
  objectName: string,
) => { fields?: readonly string[]; fieldTypes?: Record<string, string> } | undefined;

/**
 * The authorization envelope a `runAs:'user'` run needs to enforce its data
 * ops as the triggering user (#3356): the user's resolved position names and
 * permission-set names (the two lists the data security middleware keys on),
 * plus their tenant and their fellow-organization peers. Built by
 * {@link FlowUserGrantsResolver}.
 */
export interface FlowUserGrants {
  positions: string[];
  permissions: string[];
  tenantId?: string;
  /**
   * The user's peers in the organization the resolver was asked about, the
   * user included: the value RLS reads as `current_user.org_user_ids`
   * (`resolveUserAuthzGrants`' own field, under its own name). Run setup seeds
   * it on the run context ({@link SeededRunContext}). A resolver that omits it
   * leaves the run without one, so every policy that reads it drops out: the
   * run sees less, never more.
   */
  org_user_ids?: string[];
  /**
   * The user's unique email, the value RLS reads as `current_user.email`
   * (`resolveUserAuthzGrants`' own field, under its own name). Run setup
   * seeds it on the run context as {@link AutomationContext.email}. A
   * resolver that omits it leaves the run without one, so every policy that
   * reads it drops out: the run sees less, never more.
   */
  email?: string;
}

/**
 * Resolves the authorization grants held by the triggering user of a
 * `runAs:'user'` run, so its data nodes enforce RLS exactly as that user rather
 * than the bare member/everyone fallback (#3356, follow-up to #1888). Injected
 * by the host — the automation plugin bridges it to `@objectstack/core`'s
 * `resolveUserAuthzGrants`, which reads `sys_member` / `sys_user_position` /
 * `sys_*_permission_set` — so the engine stays decoupled from the identity
 * store. Returns `undefined` (or throws, tolerated) when grants can't be
 * resolved; the run then keeps whatever identity the trigger already carried
 * (see {@link AutomationEngine.resolveRunContext}). When unwired, run identity
 * is unchanged from the pre-#3356 behavior (the trigger-supplied context is
 * used verbatim), so a bare engine in tests is unaffected.
 */
export type FlowUserGrantsResolver = (
  userId: string,
  tenantId: string | undefined,
) => Promise<FlowUserGrants | undefined> | FlowUserGrants | undefined;

/**
 * Re-reads the specified single-hop lookup relations of a record-change flow's
 * triggering record so `{record.<lookup>.<field>}` templates can traverse them
 * (#3475). Injected by the host — the automation plugin bridges it to a
 * data-engine `findOne(..., { expand, context })` scoped by the run's identity
 * ({@link resolveRunDataContext}), so the referenced object's RLS/FLS are
 * enforced as the RUN (never system-elevated for a `runAs:'user'` run). Returns
 * the re-read record (with the requested relations expanded to objects) or
 * `undefined`; only the declared relation keys are grafted onto the run record.
 * When unwired, lookup traversal stays unresolved (the pre-#3475 behavior).
 */
export type FlowRecordExpander = (
  objectName: string,
  id: unknown,
  expandFields: readonly string[],
  runContext: AutomationContext,
) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;

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

/**
 * Cap on the in-memory {@link AutomationEngine.consumedSuspensions} journal —
 * the hot half of the operator restore path (#13909).
 *
 * Bounded because each entry holds a whole suspension (variables, steps,
 * context), and SMALL because it is a cache, not the record: with a
 * {@link SuspendedRunStore} configured, the authoritative copy rides the run's
 * own terminal history row and outlives both this map and the process. A
 * store-less engine keeps only the newest N, and
 * {@link AutomationEngine.restoreConsumedSuspension} answers
 * `NO_CONSUMED_SUSPENSION` for an evicted one rather than implying the run was
 * never suspended.
 */
export const MAX_CONSUMED_SUSPENSIONS = 50;

/**
 * [#15222] How far a chain restore walks in either direction before it stops —
 * the same bound `failAncestors` puts on the walk that CREATED the chain, so
 * the repair can reach exactly as deep as the cascade could, and a corrupt
 * context cannot make either loop run forever.
 */
const MAX_RESTORE_CHAIN_HOPS = 32;

/**
 * [#15222] The child run a parked run is awaiting, read off the correlation
 * the engine already writes when it parks a parent at a nested node —
 * `subflow:<childRunId>` for a subflow (`builtin/subflow-node.ts`) and
 * `map:<childRunId>` for a `map` unit (ADR-0037 A2).
 *
 * ⛔ Not a new link and not a new field: this is the SAME string the delegation
 * path in `resumeInternal` slices to find the child it must forward a signal
 * to. Naming it once here is what keeps the restore walk and the resume walk
 * reading one fact.
 */
function nestedChildRunId(correlation: string | undefined): string | undefined {
    if (typeof correlation !== 'string') return undefined;
    for (const prefix of ['subflow:', 'map:']) {
        if (correlation.startsWith(prefix)) return correlation.slice(prefix.length) || undefined;
    }
    return undefined;
}

/** [#15222] One chain member's outcome, projected from its own restore result. */
function chainEntryOf(runId: string, result: SuspensionRestoreResult): ChainRestoreEntry {
    return {
        runId,
        restored: result.restored,
        ...(result.refusal !== undefined ? { refusal: result.refusal } : {}),
        reason: result.reason,
        ...(result.flowName !== undefined ? { flowName: result.flowName } : {}),
        ...(result.nodeId !== undefined ? { nodeId: result.nodeId } : {}),
    };
}

/**
 * Level the one-line-per-terminal-run summary is logged at (#4354), or `'off'`.
 *
 * Defaults to `'info'` — deliberately. The whole premise of #4354 is that a
 * scheduled flow which silently stopped working emits **no signal at all**, and
 * a line nobody sees at their production log level is the same non-signal. A
 * host running very high-frequency record-change flows can turn the volume down
 * to `'debug'` (or off) via {@link AutomationServicePluginOptions.runSummaryLog},
 * which is a decision about noise, not about whether the platform measures.
 */
export type RunSummaryLogLevel = 'info' | 'debug' | 'off';

/**
 * One flow whose node types the (sealed) vocabulary does not cover — the
 * ADR-0018 §M1 audit entry produced by
 * {@link AutomationEngine.getUnknownNodeTypeAudit}.
 *
 * Structured rather than a log line because the finding has two consumers with
 * different needs: the plugin warns per entry at `kernel:bootstrapped`, and a
 * host (CLI startup summary, a health endpoint) reads the state off the engine
 * — the same split as {@link AutomationEngine.getTriggerBindingAudit}.
 */
export interface UnknownNodeTypeAuditEntry {
    /** Flow that references the unknown type(s). */
    flowName: string;
    /** Node `type` values no executor and no action descriptor covers. */
    unknownTypes: string[];
    /** The full vocabulary the audit judged against, for the operator's benefit. */
    knownTypes: string[];
}

/** Construction options for {@link AutomationEngine}. */
export interface AutomationEngineOptions {
    /**
     * Max in-memory execution-log entries retained (ring buffer; oldest evicted).
     * Defaults to {@link DEFAULT_MAX_EXECUTION_LOG_SIZE}. Must be > 0.
     */
    maxLogSize?: number;
    /**
     * Level for the per-terminal-run summary line (#4354). Defaults to `'info'`.
     * See {@link RunSummaryLogLevel}.
     */
    runSummaryLog?: RunSummaryLogLevel;
    /**
     * [#19834] THIS kernel's scheduled-work policy — a value, or a resolver
     * called at each bind. Absent (the default), the engine reads the
     * zero-argument deployment resolver `resolveScheduledWorkPolicy()` exactly
     * as before, so `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` keeps its meaning.
     *
     * For a host that runs several kernels in one process whose plans differ
     * (one scheduled work OFF, its sibling ON): the per-kernel answer has
     * nowhere else to live, because the deployment resolver reads one
     * process-wide environment. A time-triggered flow this policy leaves
     * unarmed is reported through the same branch as a deployment-disabled one
     * — on the bind log, the binding audit and the status row — with the
     * sentence `scheduledWorkDisabledReason(policy)` answers [#21110]: the
     * policy's `hostDisabledReason` when the host gave one, else
     * `SCHEDULED_WORK_DISABLED_REASON`, which names the deployment switch.
     *
     * ⚠️ Hand the SAME policy to `ScheduleTriggerPlugin` and
     * `TimeRelativeTriggerPlugin` of the same kernel: each trigger keeps its own
     * gate (for a host that drives it without this engine), and a trigger
     * reading a different answer from this engine refuses what the engine let
     * through, which the audit then reports as a binding failure.
     *
     * ⚠️ A hand-built value owes the resolver's invariant:
     * `requiresActingOrganization === enabled && runOwnership === 'declared'`.
     * Spreading the deployment's reading and overriding only `enabled` breaks
     * it under an `isolated` posture.
     */
    scheduledWorkPolicy?: ScheduledWorkPolicy | (() => ScheduledWorkPolicy);
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
     * #3407: advisory warnings from the node executor ({@link NodeExecutionResult.warnings}).
     * A `success` step may carry warnings — e.g. an `update_record` whose
     * requested fields the data layer legally stripped (`readonly` /
     * `readonlyWhen`) — so the Runs surface shows WHY a successful write
     * partially didn't land instead of a silent success.
     */
    warnings?: string[];
    /**
     * #1479: structured-region grouping. When a step ran inside a `loop` /
     * `parallel` / `try_catch` body region, these tag it with its **immediate**
     * container so run observability can distinguish per-iteration / per-branch
     * body steps from top-level ones. Set by {@link AutomationEngine.runRegion}.
     *
     * #15230: the innermost region wins the IDENTITY fields — `parentNodeId`,
     * `regionKind`, `retryAttempt` name which region actually ran the step, and
     * a step a nested region already claimed keeps them. The INDEX fields
     * (`iteration`, `branch`) are instead carried THROUGH nesting: an enclosing
     * region fills the one the inner region left undefined rather than having
     * it discarded.
     *
     * ⚠️ This interface is NOT derived from the spec's `ExecutionStepLog`
     * (`packages/spec/src/automation/execution.zod.ts`). The two are held in
     * step by the type-level pin in `builtin/region-index-keys.test.ts` — by
     * that assertion, not by this comment.
     */
    parentNodeId?: string;
    /**
     * Zero-based iteration of the enclosing `loop`, carried through any
     * nesting. **Single-valued** (#15230, maintainer ruling 2026-09-03): it no
     * longer doubles as the parallel branch index — that lives on `branch`.
     * A step inside a `try` / `catch` region nested in a loop body carries the
     * enclosing loop's iteration here, because such a region has no index of
     * its own.
     */
    iteration?: number;
    /**
     * #15230: zero-based index of the enclosing `parallel` branch. Present only
     * on a step inside a parallel branch, absent everywhere else. When the
     * parallel node is itself inside a loop body the step carries BOTH — the
     * row through `iteration`, the branch through here — which is what the
     * overload could not express: the branch index won outright and no step of
     * that branch recorded which row it ran for.
     */
    branch?: number;
    /** Which region kind the step ran in: `loop-body` | `parallel-branch` | `try` | `catch`. */
    regionKind?: string;
    /**
     * #7546: zero-based `try_catch` attempt this step ran in — `0` is the first
     * try, `1` the first retry. Set only on `try`-region steps, and only by a
     * container that actually retries, so its presence is itself the signal
     * that a retry ladder ran.
     *
     * Not new vocabulary: `retryAttempt` has been declared on the spec's
     * `ExecutionStepLogSchema` since the schema was written, with exactly this
     * meaning ("Retry attempt number (0 = first try)") and — until now — no
     * producer anywhere in the engine. Surfacing failed attempts (#7546) is
     * what finally gives the declared key a writer, which is the direction
     * declared-=-enforced asks for: consume the existing declaration rather
     * than invent a second spelling beside it.
     */
    retryAttempt?: number;
    /**
     * #4354: records this step read / wrote, copied from
     * {@link NodeExecutionResult.metrics}. Folded into the run summary.
     */
    metrics?: ExecutionStepMetrics;
    /**
     * #4354: the gate that closed in front of this node, on a `skipped` step.
     * Written by {@link AutomationEngine.traverseNext} when a conditional
     * out-edge evaluates false — the shape #4347 could not surface: a loop-body
     * edge that never opened left no trace at all, so a sweep that nudged
     * nobody looked exactly like a sweep with nobody to nudge.
     */
    skippedBy?: ExecutionStepSkipReason;
}

/**
 * Compact a run's step log for durable history (#2585, #3234).
 *
 * Under {@link MAX_PERSISTED_HISTORY_STEPS} the log is persisted whole (only
 * `error.stack` is dropped — the code/message pair is the designer-facing "why";
 * stacks bloat rows without aiding the Runs surface).
 *
 * Over budget — a long `loop` alone can emit `iterations × body-steps` entries —
 * a plain tail-slice would drop the `loop`/`parallel`/`try_catch` **container**
 * step (it precedes all its body steps) and every early iteration, leaving the
 * Runs surface with body steps it can no longer nest and, worse, silently hiding
 * an early failure. Instead select a bounded, order-preserving subset that keeps
 * the run's structural backbone:
 *
 *  1. Every **top-level** step (`parentNodeId === undefined`) — `start`/`end`,
 *     main-graph nodes, and the region container steps. Bounded by the flow's
 *     static node count, not by loop iterations.
 *  2. Every **failure**, wherever it occurred — the reason the run is worth
 *     keeping — each pulled in with its ancestor container chain for context.
 *  3. The most **recent** body steps (the tail shows what the run was doing when
 *     it ended), each also pulled in with its ancestor chain.
 *
 * Every retained body step therefore keeps its enclosing container(s), so the
 * compacted log never contains an orphan and the observability surface's
 * per-iteration / per-region nesting still reconstructs; the result is
 * hard-capped at `max` so `steps_json` stays bounded (#2585).
 */
export function compactStepLogForHistory(
    steps: StepLogEntry[],
    max: number = MAX_PERSISTED_HISTORY_STEPS,
): StepLogEntry[] {
    const strip = (s: StepLogEntry): StepLogEntry =>
        s.error?.stack ? { ...s, error: { code: s.error.code, message: s.error.message } } : s;

    if (steps.length <= max) return steps.map(strip);

    // Nearest preceding container-instance index for each step (its parent), or
    // -1 when top-level / its container is not in the log. The flat log is
    // pre-order, so a step's container is the closest earlier step whose nodeId
    // equals this step's parentNodeId (the same instance `buildStepTree` nests
    // under). O(n) via a running last-seen-index map.
    const parentIdx = new Array<number>(steps.length).fill(-1);
    const lastSeen = new Map<string, number>();
    for (let i = 0; i < steps.length; i++) {
        const pid = steps[i].parentNodeId;
        if (pid !== undefined) parentIdx[i] = lastSeen.get(pid) ?? -1;
        lastSeen.set(steps[i].nodeId, i);
    }
    // Indices of `i`'s ancestor chain (i first) not already selected in `into`.
    const missingChain = (i: number, into: Set<number>): number[] => {
        const chain: number[] = [];
        for (let k = i; k >= 0 && !into.has(k); k = parentIdx[k]) chain.push(k);
        return chain;
    };

    const keep = new Set<number>();
    // (1) + (2): structural backbone + every failure, each with its container chain.
    for (let i = 0; i < steps.length; i++) {
        if (steps[i].parentNodeId === undefined || steps[i].status === 'failure') {
            for (const k of missingChain(i, keep)) keep.add(k);
        }
    }

    const emit = (): StepLogEntry[] => {
        let idx = [...keep].sort((a, b) => a - b);
        // The backbone alone can exceed the cap on a very large flow — keep the
        // most recent `max` selected steps so the row stays bounded.
        if (idx.length > max) idx = idx.slice(idx.length - max);
        return idx.map((i) => strip(steps[i]));
    };
    if (keep.size >= max) return emit();

    // (3): fill the remaining budget with the most recent body steps, each with
    // its ancestor chain so no retained body step is left orphaned.
    for (let i = steps.length - 1; i >= 0 && keep.size < max; i--) {
        if (keep.has(i)) continue;
        const chain = missingChain(i, keep);
        if (keep.size + chain.length <= max) for (const k of chain) keep.add(k);
    }
    return emit();
}

/**
 * Internal execution log entry — compatible with ExecutionLog from spec.
 */
export interface ExecutionLogEntry {
    id: string;
    flowName: string;
    flowVersion?: number;
    status: ExecutionLog['status'];
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    trigger: { type: string; userId?: string; object?: string; recordId?: string };
    // ↑ built by `buildRunTrigger` at EVERY site — see its doc comment for why
    // that is a chokepoint rather than eight object literals.
    steps: StepLogEntry[];
    /**
     * #7639: the run's variable map, written at the two `paused` sites only —
     * the point-in-time snapshot the run suspended holding, and the SAME object
     * handed to {@link AutomationEngine.persistSuspendedRun}.
     *
     * Not new vocabulary. `ExecutionLogSchema` has declared
     * `variables` ("Final state of flow variables") since the schema was
     * written, and this interface has declared it for as long — with no
     * producer anywhere, so the key `GET /automation/:name/runs/:runId`
     * publishes was never populated by anything. That is the same
     * declared-with-no-writer shape as `StepLogEntry.retryAttempt` (#7546):
     * consume the existing declaration rather than invent a second spelling.
     *
     * Why `paused` and not every status: a paused run is the one an operator
     * cannot otherwise inspect. A terminal run has already produced its
     * `output`, and its step log says what ran; a run stopped at an approval or
     * a screen has produced neither, so "what did the previous node actually
     * resolve, and why did the next one route the way it did?" was answerable
     * only by inference. Widening to `completed`/`failed` would be a disclosure
     * change with no card behind it — those runs keep exactly the fields they
     * had.
     *
     * SNAPSHOT, not a live read: taken at the suspend, never refreshed. The map
     * itself is dead by then (the run unwound; resume rebuilds a fresh one from
     * the continuation), so there is nothing later to diverge from — and
     * because the continuation gets this very object, the snapshot an operator
     * reads is by construction the state the run will resume from.
     */
    variables?: Record<string, unknown>;
    output?: unknown;
    error?: string;
    /**
     * [#15788] The rendered refusal, set only on a `refused` run — the `end`
     * node's interpolated `message`. Not new vocabulary: `ExecutionLogSchema`
     * (`@objectstack/spec`) declared `refusalMessage` when lane 1 landed, and
     * this interface is "compatible with ExecutionLog from spec", so the key is
     * consumed rather than invented. Absent on every other status — a failure's
     * reason is the failing step's `error`, and a completion's `successMessage`
     * is copied from the flow definition onto the RESULT, never stored here.
     */
    refusalMessage?: string;
    /**
     * #4354: what the run did, folded out of the FULL step log by
     * {@link AutomationEngine.recordLog} — before history compaction, so a
     * 5000-iteration loop's counts are exact even though only 200 of its steps
     * are persisted.
     */
    summary?: FlowRunSummary;
}

/**
 * Build a run's trigger attribution block from its {@link AutomationContext} —
 * **the one place `ExecutionLogEntry.trigger` is constructed** (#7533).
 *
 * It is a chokepoint rather than an object literal per call site because the
 * literal was copied eight times (three on the `execute` path, three on
 * `resume`, one on `failSuspendedRun`, one on `cancelRun`) and every copy
 * populated `type` / `userId` / `object` and silently omitted `recordId`. The
 * field was declared in `ExecutionLogSchema` from the start and never written
 * by anything, so a `record_change` run — the platform's most common kind —
 * could not be correlated back to the record that caused it: "which record
 * provoked this run?" and "which runs did this record provoke?" were both
 * unanswerable from the run log. Eight literals is eight chances to omit the
 * next field too; one function is one.
 *
 * `recordId` is read off `context.record.id` rather than a context field of its
 * own: `record` is the declared carrier of the triggering row
 * ({@link AutomationContext.record}, populated by the record-change trigger's
 * `buildContext`) and `id` is the platform primary key. Empty-string and
 * nullish ids are dropped rather than persisted, mirroring
 * {@link AutomationEngine.expandDeclaredLookups}'s guard on the same read — a
 * blank `recordId` would read as an attribution the row does not have.
 */
export function buildRunTrigger(
    context: AutomationContext | undefined,
): { type: string; userId?: string; object?: string; recordId?: string } {
    const rawId = (context?.record as Record<string, unknown> | undefined)?.id;
    const recordId =
        typeof rawId === 'string'
            ? rawId || undefined
            : typeof rawId === 'number'
                ? String(rawId)
                : undefined;
    return {
        type: context?.event ?? 'manual',
        // The run's TRIGGER user, which a decision switch (ruling A on
        // `FlowSchema.runAs`) moves out of `userId` and keeps here.
        userId: runTriggerUserId(context),
        object: context?.object,
        recordId,
    };
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
export class FlowSuspendSignal {
    readonly __flowSuspend = true as const;
    constructor(
        readonly nodeId: string,
        readonly correlation?: string,
        readonly screen?: ScreenSpec,
        /** Registry type of the node that suspended — the resume gate's key (#3801). */
        readonly nodeType?: string,
    ) {}
}

export function isSuspendSignal(err: unknown): err is FlowSuspendSignal {
    return typeof err === 'object' && err !== null && (err as FlowSuspendSignal).__flowSuspend === true;
}

/**
 * [#15788] Internal sentinel thrown by {@link AutomationEngine.executeNode}
 * when a node REFUSES (#14945 ruling 2′, lane 2). Two producers, one signal:
 * an `end` node declaring `outcome: 'refused'` (#15788), and any executor that
 * returns {@link NodeExecutionResult.refuse} — `subflow` (#18110) and `map`
 * (#18555) do, when their child run refused.
 * The twin of {@link FlowSuspendSignal}: it unwinds the synchronous DAG
 * recursion up to `execute()` / `resume()` / `executeWithoutRetry`, which
 * convert it into a TERMINAL `refused` run rather than a failed one.
 *
 * ⚠️ `refused` here is the run OUTCOME, ⛔ not this package's other `refused`.
 * Everywhere else in `service-automation` a refusal is a GUARD refusal — the
 * engine declining to execute (`guard-refusal.ts`, `refuseNode`, the resume
 * authority gate, `refuseUndeclaredSuspension`), which is a kind of FAILURE.
 * This one is the maintainer's ruling verbatim: *a refusal is a successful
 * evaluation that says no*. Nearly opposite senses of one word, so a `grep` for
 * `refused` in this package returns mostly the other family — read the sense at
 * the site, never from the name.
 *
 * Why a thrown sentinel and not a return value: an `end` node can sit anywhere
 * in the graph, including several `traverseNext` frames deep, and the run has
 * to STOP there. That is precisely what {@link FlowSuspendSignal} already
 * exists to do, so this reuses the mechanism rather than inventing a second
 * unwinding protocol. (Not exported — callers see `status: 'refused'`.)
 */
export class FlowRefusalSignal {
    readonly __flowRefused = true as const;
    constructor(
        /**
         * The node that carried the refusal — the last node the run reached.
         * The refusing `end` itself, or the `subflow` / `map` whose child run
         * refused.
         */
        readonly nodeId: string,
        /**
         * The rendered reason, already interpolated against the live variables
         * of the run that produced it — the author's `end` `message`, or the
         * child run's own `refusalMessage` passed through. `undefined` only
         * when the refusal carried none, which `EndConfigSchema`'s refinement
         * refuses at the flow parse — recorded honestly rather than filled in
         * with invented text.
         */
        readonly message?: string,
    ) {}
}

export function isRefusalSignal(err: unknown): err is FlowRefusalSignal {
    return typeof err === 'object' && err !== null && (err as FlowRefusalSignal).__flowRefused === true;
}

/**
 * [#22450] The slice of `II18nService` (`@objectstack/spec/contracts`) a
 * flow text slot reads ({@link AutomationEngine.renderFlowTextSlot}): `t()` for
 * the translated template, and `getLocales()`, when the service offers it, to
 * negotiate the run's locale. Named for its first reader, the refusing `end`
 * node; the `screen` executor's heading and body text read it too (#22507).
 */
export interface RefusalI18nService {
    t(key: string, locale: string, params?: Record<string, unknown>): string;
    getLocales?(): string[];
}

/**
 * [#22507] One user-read flow text slot {@link AutomationEngine.renderFlowTextSlot}
 * renders in the run's language.
 */
export interface FlowTextSlotTranslation {
    /**
     * The slot's key in the `flows` translation face, as `@objectstack/spec/system`
     * spells it — `flowRefusalMessageKey`, `flowScreenCopyKey`.
     */
    readonly key: string;
    /** The authored `{{ }}` template, rendered whenever no translation is picked. */
    readonly authored: unknown;
    /** Whose slot it is, for the log line — `flow 'dedupe' refused at node 'finish'`. */
    readonly subject: string;
    /** What shows the authored text in its place, for the log line — `the refusal`. */
    readonly shownAs: string;
}

/**
 * [#22450] The locale `service` can actually ANSWER in, for the locale the run
 * asked for. `AutomationContext.locale` is the door's `ExecutionContext.locale`,
 * whose header leg is the request's tag verbatim, so a bare `zh` has to reach a
 * `zh-CN` bundle the way the document translators reach it.
 *
 * ⛔ No rule of its own: `resolveBundleLocale` is the one negotiation rule, asked
 * about what `getLocales()` reports, exactly as objectql's
 * `negotiatedMessageLocale` asks it. The requested tag passes through untouched
 * whenever there is nothing to negotiate against (no `getLocales`, a throwing or
 * empty answer, no match).
 */
function negotiatedServiceLocale(service: RefusalI18nService, requested: string): string {
    if (typeof service.getLocales !== 'function') return requested;
    let available: unknown;
    try {
        available = service.getLocales();
    } catch {
        return requested;
    }
    if (!Array.isArray(available) || available.length === 0) return requested;
    const offered: Record<string, true> = {};
    for (const code of available) {
        if (typeof code === 'string' && code.length > 0) offered[code] = true;
    }
    return resolveBundleLocale(offered, requested) ?? requested;
}

/**
 * [#18714] "The child run this frame is parked on finished `refused`" — the
 * RESUMED-leg counterpart of the synchronous `subflow` / `map` executors'
 * `refuse` result (#18110 / #18555).
 *
 * Those two executors read `child.status === 'refused'` off the value
 * `engine.execute` returned to them. A run that PAUSES first never returns
 * through that call at all: the child's outcome reaches its parent on one of
 * the two resumed legs instead — the delegated resume
 * ({@link AutomationEngine.resumeInternal}'s `subflow:` block, which drives the
 * child itself) and the up-bubble ({@link AutomationEngine.bubbleToParent},
 * where the child's own frame drives the parent). Neither leg had an arm for
 * `refused`, so the two failed differently and both fail-open in their own way:
 * the delegated leg read the refusal as an ordinary success and walked the
 * parent's out-edges, and the up-bubble leg never resumed the parent at all,
 * leaving it `paused` in `listSuspendedRuns()` forever.
 *
 * ⛔ Not an error and ⛔ not an error CODE. A refusal is a successful
 * evaluation that says no, so the only thing this carries is the rendered
 * reason — exactly what {@link FlowRefusalSignal} already carries, and the
 * reason both legs converge on that one signal rather than growing a second
 * terminal exit apiece.
 */
interface ChildRunRefusal {
    /**
     * The child run's own `refusalMessage`, passed through verbatim.
     * `undefined` only when the child carried none — recorded honestly rather
     * than filled in with invented text, exactly as `FlowRefusalSignal.message`
     * is.
     */
    readonly message?: string;
}

/**
 * The definition-level input-schema guard's own throw type (#10025).
 *
 * {@link AutomationEngine.validateNodeInputSchemas} used to throw bare
 * `Error`s, which left `execute()`'s catch no way to tell "the definition
 * refused to dispatch" from "a node ran and failed" without a regex over the
 * message — the tolerant-consumer shape PD #12 forbids. This class is the
 * classification channel: recognised in exactly one place, the catch's
 * non-retryable short-circuit, which converts it into the never-dispatched
 * `FLOW_INPUT_SCHEMA_INVALID` exit instead of handing it to `retryExecution`.
 *
 * Not exported on purpose — callers read the ADR-0112 `code` off the result,
 * never the throw.
 */
class InputSchemaViolationError extends Error {}

/**
 * The refusal codes {@link AutomationEngine.resumeInternal} answers for a
 * resume that NEVER RAN — the run is untouched, nothing executed, and the
 * identical call succeeds once its cause is corrected or has passed (#14379).
 *
 * Read by the subflow delegation path, which forwards a parent's resume down
 * to the child the parent is parked on: a child answering one of these has
 * REFUSED, not failed, so the parent must answer the refusal rather than
 * record a failure. The set is the PRODUCER's own vocabulary — the codes this
 * file returns from that one method — which is why it is a closed list here
 * and not a predicate over state (triage ruling 2026-09-02: branch on the
 * child's `code`, ⛔ never on "is the child's suspension still live", a second
 * store read whose answer can race and which infers intent from state).
 *
 * ⛔ `RUN_NOT_FOUND` is deliberately absent, though `resumeInternal` returns it
 * too: it is the engine's terminal "this pause is gone for good" class (#8684)
 * — no suspension, an unregistered flow, or a node edited away underneath a
 * parked run — which a transport answers **404** and which no retry can fix.
 * A child in that state can never continue, so its parent cannot either.
 */
const RETRYABLE_RESUME_REFUSAL_CODES: ReadonlySet<string> = new Set([
    'INVALID_SCREEN_INPUT',
    'INVALID_SIGNAL',
    'RESUME_IN_PROGRESS',
    'STORE_UNAVAILABLE',
] satisfies ReadonlyArray<NonNullable<AutomationResult['code']>>);

/** Whether an {@link AutomationResult} code names a resume that never ran. */
function isRetryableResumeRefusal(code: AutomationResult['code']): boolean {
    return code !== undefined && RETRYABLE_RESUME_REFUSAL_CODES.has(code);
}

/**
 * Marks a {@link ResumeSignal} the ENGINE built for its own continuations —
 * the subflow output mapping and the `map` item handoff. Module-private and
 * symbol-keyed, so it cannot arrive from a transport (no JSON body produces a
 * symbol key) and no other package can mint one.
 *
 * Distinct from `RESUME_AUTHORITY_SERVICE`, which answers a different question:
 * that marker says "the owning service authorized this decision" (#3801) and
 * still may not write engine internals; this one says "the engine wrote this
 * signal itself", which is the only case that may.
 */
const ENGINE_BUILT_SIGNAL = Symbol('objectstack.automation.resume.engineBuilt');

/** Tag a signal the engine constructed for its own continuation. */
function engineBuilt(signal: ResumeSignal): ResumeSignal {
    return Object.assign(signal, { [ENGINE_BUILT_SIGNAL]: true });
}

/**
 * Whether an incoming resume signal ALREADY carries a completed subflow
 * child's output — the engine-built up-bubble, i.e. the signal
 * `bubbleToParent` builds with `buildSubflowResumeSignal` when a delegated
 * child finishes and continues its parent.
 *
 * The discriminator for the up-bubble's log branch, and deliberately NOT "is
 * the child run still there". On the up-bubble the child has COMPLETED, so its
 * suspension is already consumed and the `loadSuspendedRun` miss on the
 * parent's `subflow:` correlation says nothing about whether the parent
 * continues with the child's output — it only says the child is not SUSPENDED.
 * Branching on a second run lookup would move that same confusion one call
 * over; this asks the fact the message is actually about.
 *
 * The engine-built marker is load-bearing, not decoration: `output` is a
 * caller-writable field, and on this node the caller's signal is delegated
 * DOWN to the child, so shape alone would let a caller's own bag silence the
 * genuine degraded warning. Only the engine can mint the symbol.
 */
function carriesSubflowChildOutput(signal: ResumeSignal): boolean {
    if ((signal as Record<symbol, unknown>)[ENGINE_BUILT_SIGNAL] !== true) return false;
    const output = signal.output;
    return typeof output === 'object' && output !== null && 'output' in output;
}

/**
 * Variable names the flow engine owns: `$runId`, `$flowName`, `$flowLabel`,
 * `$record`, `$error`, `$parentRunId`, `$parentMapNode`, `$parentOutputVariable`,
 * and the node-scoped `<nodeId>.$mapState` / `$mapItemDone` / `$mapItemOutput`.
 * Authors never write here.
 */
function isEngineVariable(name: string): boolean {
    return name.startsWith('$') || name.includes('.$');
}

/**
 * Fold a resume signal into a run's variable map — **the one place a signal
 * reaches those variables** (#3853 follow-up).
 *
 * It exists as a chokepoint rather than three open-coded loops because the
 * shape of this seam is what produced two separate escapes: the map item
 * handoff was forgeable through `variables`, and — once that was guarded at the
 * route — through `output`, which lands under `${nodeId}.${key}` and so reaches
 * the very same `<mapNodeId>.$mapItemDone`. Guarding one field at a time
 * invites the next field. Every caller-supplied write now passes here, and a
 * new signal field is checked by construction.
 *
 * @returns the rejected key names (already in their final, prefixed form).
 *   Empty ⇒ every write was applied. An engine-built signal
 *   ({@link ENGINE_BUILT_SIGNAL}) is exempt: `bubbleToParent` legitimately
 *   writes the handoff keys, and it is not reachable from a transport. The
 *   signal is never absent here — `resume` normalises a missing one to `{}`
 *   (commit 7307191db), which folds nothing and rejects nothing.
 */
function applyResumeSignal(
    variables: Map<string, unknown>,
    signal: ResumeSignal,
    nodeId: string,
): string[] {
    const trusted = (signal as Record<symbol, unknown>)[ENGINE_BUILT_SIGNAL] === true;
    const rejected: string[] = [];
    const writes: Array<[string, unknown]> = [];

    // `output` is merged under the suspended node's id, so downstream edges
    // branch on it exactly as for a normally-executed node.
    for (const [key, value] of Object.entries(signal.output ?? {})) {
        writes.push([`${nodeId}.${key}`, value]);
    }
    // Bare flow variables — a `screen` node's collected inputs land under their
    // plain names so downstream CEL envelopes, text-slot holes and conditions
    // read them directly (e.g. `new_assignee` → update_record fields).
    for (const [key, value] of Object.entries(signal.variables ?? {})) {
        writes.push([key, value]);
    }

    for (const [name] of writes) {
        if (!trusted && isEngineVariable(name)) rejected.push(name);
    }
    // Reject as a whole — never a partial application.
    if (rejected.length) return rejected;

    for (const [name, value] of writes) variables.set(name, value);
    return [];
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
    /**
     * Registry type of the node that produced the pause (`approval`, `screen`,
     * `wait`, …), captured at suspend time. Keys the resume gate (#3801): the
     * descriptor's `resumeAuthority` decides whether a raw
     * {@link AutomationEngine.resume} is a legitimate continuation, and a type
     * that declares none is refused rather than assumed open (#5561).
     *
     * Recorded on the suspension rather than re-derived from the live flow so
     * the gate reflects what actually paused the run — a flow republished
     * mid-pause cannot re-type the node out from under it. Optional: rows
     * persisted before this field existed have none, and the gate falls back
     * to the flow definition for those.
     */
    nodeType?: string;
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
/**
 * [#15223] The terminal states a run can be RECORDED in — the durable
 * run-history vocabulary, declared ONCE because three sites have to agree on
 * it: the writer ({@link AutomationEngine.recordLog}'s terminal predicate),
 * the reader (`ObjectStoreSuspendedRunStore`'s row gate) and the stored
 * column (`sys_automation_run.status`, whose `Field.select` options and
 * retention `onlyWhen` scope enumerate the same members). A second copy of
 * this list is how a widened writer ends up with rows a reader filters away.
 *
 * These are exactly the `ExecutionStatus` members (`@objectstack/spec`) that
 * mean "this run has stopped and will not resume". `paused`, `running`,
 * `pending` and `retrying` are live states with no history row.
 *
 * [#15788] `refused` joins them, and the reason it was ABSENT is the reason it
 * is here now: this list may only enumerate values something can write, and
 * until lane 2 of the #14945 ruling landed, nothing could — the spec declared
 * the member and `executeNode` returned on every `end` node without reading its
 * config. {@link AutomationEngine.executeNode} now produces it, so all three
 * sites widen together, in this change. ⛔ A refusal is NOT a failure: nothing
 * threw, the flow evaluated successfully and said no, and the authored reason
 * rides beside the status as `refusalMessage` rather than in `error`.
 */
export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled', 'timed_out', 'refused'] as const;

/** One member of {@link TERMINAL_RUN_STATUSES}. */
export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

/** Whether `status` is one of {@link TERMINAL_RUN_STATUSES}. */
export function isTerminalRunStatus(status: unknown): status is TerminalRunStatus {
    return (TERMINAL_RUN_STATUSES as readonly unknown[]).includes(status);
}

export interface RunRecord {
    runId: string;
    flowName: string;
    flowVersion?: number;
    /**
     * The terminal state this run reached, as the engine observed it.
     *
     * [#15223] This declared `'completed' | 'failed'` — TWO members — while
     * {@link AutomationEngine.recordLog}'s own terminal predicate admitted
     * FOUR and `ExecutionStatus` (`@objectstack/spec`) declared them all.
     * Both ends folded: the write mapped everything that was not `completed`
     * to `failed`, and the read mapped everything that was not `failed` to
     * `completed`. The information was not hidden by that, it was DESTROYED
     * at write time, so the same run read `cancelled` in-process (`getRun`
     * prefers the ring entry) and `failed` after a restart or a ring
     * eviction.
     *
     * ⛔ The narrowing was INHERITED, not chosen — recorded here so the next
     * reader does not re-derive it. Nothing was paying for it: the column is a
     * `Field.select` that stores the string whatever its width, so there was
     * no storage cost to buy, and neither file stated a reason. It is simply
     * older than what it had to carry — the durable history row (#2585)
     * predates `cancelRun` (ADR-0044), and `timed_out` was in the spec's
     * vocabulary the whole time. ⛔ Do not re-narrow it to make a downstream
     * `switch` exhaustive; widen the switch.
     */
    status: TerminalRunStatus;
    startedAt: string;
    startTime?: number;
    /** When the run reached its terminal state. */
    finishedAt?: string;
    durationMs?: number;
    /** Failure reason for a `failed` run — what a designer needs to fix it. */
    error?: string;
    /**
     * [#15788] The rendered refusal, set only when {@link status} is
     * `'refused'` — the `end` node's `message` template interpolated against
     * the run's variables at the moment the run reached it, so the stored text
     * names the record (`Refused: Acme Corp is a confirmed duplicate`).
     *
     * ⛔ Deliberately NOT folded into {@link error}, which would have needed no
     * new column: a refusal is not a failure, and a reader that finds authored
     * text in `error` has been told the run broke. The ruling is explicit that
     * the two are distinct, so the row carries them in distinct places — the
     * same reason `#15223` refused to keep folding `cancelled` into `failed`.
     */
    refusalMessage?: string;
    /**
     * The node this record is ABOUT. On an ordinary terminal record: the run's
     * last step. On a stranded run's record — `consumedSuspension` present, or
     * `consumedSuspensionDropped` — the PAUSE node, the node the consumed
     * snapshot re-arms, because the object store rebuilds the snapshot's node
     * from this one column and there is no other (#13937: written as the last
     * step, a restore from the row re-armed the run at the node that threw and
     * the next resume skipped it). The node that threw is still where the Runs
     * surface reads it: the last entry of `steps`, and `error`.
     */
    nodeId?: string;
    /**
     * [#10101] The ACTING context's tenant (`AutomationContext.tenantId`),
     * copied onto the record by {@link AutomationEngine.recordLog} — the ruled
     * FALLBACK for the persisted `organization_id`, never the primary. The
     * primary is the SUBJECT record's own organization, which the DB-backed
     * store resolves from {@link RunRecord.triggerRecord} through the shared
     * platform-row resolver (`@objectstack/metadata-core`, the cloud#1395
     * Option A ruling) at write time. Before #10101 nothing set this field at
     * all, so every terminal history row persisted `organization_id = NULL`.
     */
    organizationId?: string | null;
    userId?: string | null;
    /**
     * Trigger attribution — **why** this run ran (#7533), flattened here the
     * same way `userId` already is (it, too, is a field of the run's trigger
     * block). Persisted as `sys_automation_run` COLUMNS so the durable history
     * answers the two questions the in-memory log answers:
     *
     *   - `triggerType` — 'record-after-update' / 'schedule' / 'api' / … Before
     *     this existed the terminal row carried no trigger information at all,
     *     so a scheduled run, a webhook intake and a record change became
     *     indistinguishable rows the moment the process restarted: the durable
     *     copy of the history was strictly LESS informative than the volatile
     *     one.
     *   - `triggerObject` / `triggerRecordId` — the record that caused the run.
     *
     * All optional: rows written before #7533 have none, and absent must read
     * as "not recorded", never as "no trigger".
     */
    triggerType?: string;
    triggerObject?: string;
    triggerRecordId?: string;
    /**
     * [#10101] The triggering record SNAPSHOT (`AutomationContext.record`),
     * carried for the store's write-time subject-organization resolution — the
     * same snapshot the suspended-run row resolves from, so a run's paused row
     * and its terminal row agree by construction. A write-time INPUT, not a
     * column: the DB-backed store reads the resolved organization column off
     * it and persists only `organization_id`. Absent for triggers that carry
     * no record (a plain scheduled sweep has no one subject), in which case
     * the acting-context fallback ({@link RunRecord.organizationId}) stands —
     * fabricating an acting organization for schedule/api triggers stays
     * vetoed (cloud#1395 Option C).
     */
    triggerRecord?: Record<string, unknown>;
    /**
     * Bounded per-node step log (see {@link AutomationEngine.compactStepsForHistory}),
     * so "which node blew up?" survives a restart. Optional — history rows
     * written before this field existed have none.
     */
    steps?: StepLogEntry[];
    /**
     * #4354: the run's selected / acted / skipped rollup, computed from the
     * un-compacted step log. Persisted alongside `steps` so the Runs surface
     * and an operator's `selected > 0 AND acted = 0` alert both read exact
     * counts, not counts inferred from the 200 steps that survived compaction.
     * Optional — rows written before this field existed have none, and an
     * absent summary must never be read as "this run did nothing".
     */
    summary?: FlowRunSummary;
    /**
     * [#13909] The suspension this run's resume CONSUMED before the downstream
     * node threw — written only on that one path, so its presence is itself the
     * statement "this `failed` run had a pause and no longer has one".
     *
     * It rides the terminal row because that is the only durable artefact the
     * failure leaves: `forgetSuspendedRun` deleted the paused row before
     * `traverseNext` ran, and this row's `variables_json` / `context_json` /
     * `screen_json` columns already exist and were simply never written on
     * terminal rows (`sys_automation_run` says so at the field itself). No new
     * column, no new status value, no new table.
     *
     * Cleared by the next terminal record for the same run — a restored run
     * that resumes to completion upserts this row without a snapshot — so
     * "restorable" cannot outlive the condition it describes.
     *
     * ⛔ Not a run state. See {@link ConsumedSuspension}.
     */
    consumedSuspension?: SuspendedRun;
    /**
     * [#13937] The store could not persist the snapshot this run had — the
     * object store DROPS one over its row byte budget rather than truncating
     * it — and says so, with the pause it belonged to. Present exactly when a
     * snapshot existed and `consumedSuspension` is absent for THAT reason, so
     * a reader can tell "dropped" from "the run moved on": a terminal record
     * with neither field is a run that reached a terminal state which was not
     * a strand (completed, cancelled, cascade-failed), or never paused at all.
     * {@link AutomationEngine.restoreConsumedSuspension} honours a hot copy of
     * the same pause on this reading, and without one refuses naming the
     * budget. A store that cannot persist a snapshot MUST record it this way:
     * writing nothing reads as the run having moved on.
     */
    consumedSuspensionDropped?: ConsumedSuspensionDropNotice;
}

/**
 * [#13937] What a store records in place of a consumed-suspension snapshot it
 * could not persist — see {@link RunRecord.consumedSuspensionDropped}.
 */
export interface ConsumedSuspensionDropNotice {
    /** Size of the snapshot's JSON columns together, in bytes. */
    bytes: number;
    /** The store's budget the snapshot was over, in bytes. */
    budget: number;
    /** The pause the dropped snapshot belonged to — its identity, not its state. */
    nodeId?: string;
    correlation?: string;
}

/**
 * A suspension that a resume CONSUMED and then failed downstream of — the input
 * {@link AutomationEngine.restoreConsumedSuspension} puts back (#13909).
 *
 * `resumeInternal` consumes the suspension **before** running downstream nodes,
 * so a node that merely throws throws with the pause already gone and the catch
 * arm records the run `failed`. There is then no suspension left to resume —
 * and, before this journal existed, nothing anywhere to rebuild one from: the
 * durable paused row is deleted at consumption and the terminal history row
 * carries no `variables` / `context` / `screen` at all.
 *
 * ⛔ **This is not a run state.** The run's RECORDED status is `failed`
 * (`ExecutionStatus`, the run-row vocabulary, is unchanged) and this is a
 * SNAPSHOT of a deleted row, kept so a deliberate operator action can restore
 * it. What the condition is CALLED was settled by the #13937 shape-4 ruling
 * (maintainer 2026-09-01): `'stranded'`, on {@link AutomationResult.status}
 * (#14384) — and the catch arm that writes this journal is the one exit that
 * stamps it, so "a snapshot exists" and "the result said stranded" are one
 * fact stated twice.
 */
export interface ConsumedSuspension {
    /**
     * The suspension exactly as it stood when the resume consumed it —
     * VERBATIM: the resume signal is not folded in and the failed attempt's
     * steps are not included. See
     * {@link AutomationEngine.restoreConsumedSuspension} for why that is the
     * only shape that is safe to put back.
     */
    run: SuspendedRun;
    /** When the resume that consumed it recorded its downstream failure. */
    consumedAt: string;
    /** The downstream failure that left the run terminal and unresumable. */
    error: string;
    /**
     * [#13937] Whether THIS process's own history write for the strand reached
     * the store: `'pending'` while the fire-and-forget write is in flight,
     * `'landed'` once the store accepted it (the row now describes this strand
     * — as a snapshot, or as a drop notice), `'failed'` when it threw, absent
     * when no store writes history at all. The engine's own memory of what the
     * store was handed — the #13617 exception, for this journal: a row the
     * store never received says nothing about this copy, so
     * {@link AutomationEngine.restoreConsumedSuspension} reads a snapshot-less
     * row as "the run moved on" only when this is `'landed'`.
     */
    persisted?: 'pending' | 'landed' | 'failed';
}

/**
 * [#15556] What {@link AutomationEngine.bubbleToParent} records — under the
 * CHILD's own run id — when resuming that child's completion up-bubbles into
 * a PARENT that consumed its suspension and then failed downstream. Read once
 * via {@link AutomationEngine.takeSubflowParentStrand}: exported only so the
 * class's public method can name its return type in this file's declaration
 * output, never re-exported from this package's index — the shape a consumer
 * reads is this file's own return value, not a type it imports.
 *
 * Recorded on exactly the arm {@link AutomationResult.status} calls
 * `'stranded'` — never on `RESUME_IN_PROGRESS` / `STORE_UNAVAILABLE`, which
 * stay the functional degradation #15556's ruling left alone.
 */
export interface SubflowParentStrand {
    /** The run that is actually stranded — the PARENT, never the child that just completed. */
    runId: string;
    /** Always `true`: the one arm that records an entry is the one the engine journals a repair snapshot for. */
    repairable: true;
    /** The parent's own downstream failure text, verbatim — `resumeInternal`'s `error` for that run. */
    error: string;
}

/**
 * Why {@link AutomationEngine.restoreConsumedSuspension} declined (#13909).
 *
 * Every value is EARNED BY A SPECIFIC OBSERVATION, not by a catch-all "bad
 * input" arm: an operator whose repair is refused has to be able to tell "this
 * run is fine" from "this run is beyond this verb" from "I could not read the
 * store", because the remedy differs for each.
 *
 *  - `'RESTORE_IN_PROGRESS'` — another restore of this run is already running
 *    in this process. The in-process half of the idempotence guarantee.
 *  - `'RESUME_IN_PROGRESS'` — a resume is running for this run RIGHT NOW.
 *    ⚠️ The subtle one: "suspension gone, no terminal row yet" is exactly what
 *    a resume in flight looks like, so re-arming one of those races the live
 *    resume — the traversal would finish and record `completed` while a paused
 *    row it knows nothing about survives.
 *  - `'RUN_SUSPENDED'` — a live suspension already exists. The run is already
 *    resumable, so there is nothing to restore; this is also what a second
 *    restore of an already-restored run answers, in this process or after a
 *    restart.
 *  - `'STORE_UNAVAILABLE'` — the durable store could not be read, so whether a
 *    suspension is live is UNKNOWN. Refused rather than guessed: reading an
 *    outage as "no suspension" is the one mistake that mints a second pause.
 *  - `'RUN_COMPLETED'` — the run finished. Nothing to exit from.
 *  - `'RUN_CANCELLED'` — the run was cancelled (ADR-0044). A restore would
 *    undo a decision somebody made on purpose.
 *  - `'NO_CONSUMED_SUSPENSION'` — the run exists, but no consumed suspension
 *    is available for it: it never paused, or its snapshot is gone (no store
 *    configured and the in-memory journal evicted it, or a later terminal
 *    record cleared it). Usually a terminal (`failed`) run, but this arm also
 *    answers when the log's last word on the run is non-terminal
 *    (`running` / `pending`) — the fall-through does not require terminality.
 *    Deliberately does NOT claim which cause —
 *    nothing in the engine can tell those apart, and the result's `reason`
 *    names the status actually observed instead of overclaiming.
 *  - `'RUN_NOT_FOUND'` — no record of this run at all.
 */
export type SuspensionRestoreRefusal =
    | 'RESTORE_IN_PROGRESS'
    | 'RESUME_IN_PROGRESS'
    | 'RUN_SUSPENDED'
    | 'STORE_UNAVAILABLE'
    | 'RUN_COMPLETED'
    | 'RUN_CANCELLED'
    | 'NO_CONSUMED_SUSPENSION'
    | 'RUN_NOT_FOUND';

/**
 * [#15222] What ONE run of a nested chain got out of a chain restore — see
 * {@link SuspensionRestoreResult.chain}.
 *
 * The same fields the top-level result carries for the run the operator named,
 * per member, and deliberately no more: a member is either re-armed or refused
 * for one of this verb's own reasons, and WHY it was part of the chain is
 * structural (its `$parentRunId`, its nested correlation), not a further
 * outcome to enumerate.
 *
 * ⛔ It carries no status word, and must not grow one. A cascade-failed
 * ancestor is not `'stranded'` — that is the resume result of a run that
 * consumed its OWN pause and then threw downstream, and nothing re-arms an
 * ancestor by resuming it. Its repairability is this entry and the journal
 * behind it.
 */
export interface ChainRestoreEntry {
    runId: string;
    /** `true` only when a suspension was put back for this run by THIS call. */
    restored: boolean;
    /** Absent exactly when `restored` is `true`. */
    refusal?: SuspensionRestoreRefusal;
    /** One sentence naming what was observed for this run — always present. */
    reason: string;
    /** This run's flow / node, when it was re-armed. */
    flowName?: string;
    nodeId?: string;
}

/**
 * Outcome of {@link AutomationEngine.restoreConsumedSuspension} (#13909).
 *
 * Deliberately NOT an {@link AutomationResult}: this verb does not execute a
 * flow, and its refusal vocabulary is its own. Folding it into the platform
 * result type would put eight new codes into a contract every transport reads.
 * The condition this verb exits from IS platform vocabulary since the #13937
 * shape-4 ruling — `AutomationResult.status: 'stranded'`, stamped by the
 * resume that stranded the run — but the repair's own outcome stays here.
 */
export interface SuspensionRestoreResult {
    /** `true` only when a suspension was actually put back by THIS call. */
    restored: boolean;
    runId: string;
    /** Absent exactly when `restored` is `true`. */
    refusal?: SuspensionRestoreRefusal;
    /** One sentence naming what was observed — always present, both ways. */
    reason: string;
    /** The restored run's flow / node, when one was restored. */
    flowName?: string;
    nodeId?: string;
    /** When the resume that consumed the restored suspension failed. */
    consumedAt?: string;
    /**
     * [#15222] Every run this call re-armed when the named run was part of a
     * NESTED chain — leaf-first, including the named run itself, each with its
     * own outcome.
     *
     * **Absent for a flat run**, which is the whole compatibility story: a
     * single-run strand answers exactly what it always answered, and the six
     * fields above always describe the run the CALLER NAMED, wherever in the
     * chain that run sits.
     *
     * Present means the repair was a chain repair: a stranded descendant's
     * cascade consumed each ancestor's pause too, all of them were journalled,
     * and this call put every one of them back in a fixed order — deepest
     * first, so no ancestor becomes resumable before the run it is parked
     * awaiting is parked again.
     */
    chain?: ChainRestoreEntry[];
}

/**
 * [#15358] What {@link AutomationEngine.inspectConsumedSuspension} answers:
 * would {@link AutomationEngine.restoreConsumedSuspension} have a consumed
 * suspension to put back for this run? READ from the same two witnesses that
 * verb reads, and re-arming nothing.
 *
 * Every arm is earned by its own observation, and the three negative ones are
 * deliberately not folded into one boolean — a consumer that branches on
 * `repairable` alone reads the middle one wrong in both directions:
 *
 *  - `repairable: true` — a consumed-suspension snapshot is held for the run,
 *    in this process's hot journal or on the durable terminal row (`witness`
 *    says which). The restore verb re-arms it.
 *  - `'SNAPSHOT_DROPPED'` — the run DID strand, but the store could not
 *    persist the snapshot (over its row budget — the row says so,
 *    {@link RunRecord.consumedSuspensionDropped}) and THIS process holds no
 *    hot copy of it. Repairable only by the process that stranded it, while
 *    that process is still running; the restore verb refuses it here naming
 *    the budget. ⛔ Neither "unrepairable" nor "never a strand".
 *  - `'NO_CONSUMED_SUSPENSION'` — neither witness holds anything: the run
 *    reached a terminal state that was NOT a strand (completed, cancelled,
 *    cascade-failed — `failSuspendedRun` consumes an ancestor's pause and
 *    journals nothing), never paused at all, or DID strand and its snapshot
 *    is no longer held (the journal evicted a copy whose write never landed;
 *    the run was restored and then finished; a store class without
 *    `loadTerminal`, after a restart). Deliberately does not claim which:
 *    nothing in the engine can tell those apart, and the restore verb's own
 *    refusal text names the same three.
 *  - `'RUN_SUSPENDED'` — a live suspension exists, so the run is resumable
 *    already (typically: it was restored). Nothing to repair.
 */
export type ConsumedSuspensionInspection =
    | {
        repairable: true;
        runId: string;
        flowName: string;
        /**
         * The pause a restore would re-arm — its identity, the pair
         * {@link SuspendedRunStore.claimSuspension} compares.
         */
        nodeId: string;
        correlation?: string;
        /** Which of the two witnesses answered (see the restore verb's read). */
        witness: 'journal' | 'durable';
        /** When the resume that consumed the suspension failed. */
        consumedAt: string;
    }
    | { repairable: false; runId: string; reason: 'RUN_SUSPENDED'; nodeId: string }
    | { repairable: false; runId: string; reason: 'SNAPSHOT_DROPPED'; dropped: ConsumedSuspensionDropNotice }
    | { repairable: false; runId: string; reason: 'NO_CONSUMED_SUSPENSION' };

/**
 * [#14333] Where a suspension was parked when the caller READ it — the
 * condition a {@link SuspendedRunStore.claimSuspension} compare-and-set is
 * taken against.
 *
 * Both fields come off the {@link SuspendedRun} the caller loaded, never off
 * live engine state: the whole point is to ask the shared store whether the
 * row still says what this replica last saw it say.
 */
export interface SuspensionParkedAt {
    /** The node the row said the run was parked at. */
    nodeId: string;
    /**
     * The correlation the pausing executor minted, when the row carries one.
     * A store compares it only when it is set: a row persisted with no
     * correlation has nothing to compare, and the node condition still holds.
     */
    correlation?: string;
}

/**
 * [#14333] What {@link SuspendedRunStore.claimSuspension} answers.
 *
 * Three values, not a boolean, because "I cannot express this condition" is a
 * different fact from "you lost" — and an implementation that answered `false`
 * for it would stall every resume, while one that answered `true` would offer
 * no guarantee while claiming one. The third value is how a store says so out
 * loud; the engine turns it into a declared, one-time degradation.
 */
export type SuspensionClaimOutcome =
    /** THIS call consumed the durable row — the caller owns the advance. */
    | 'claimed'
    /** The row was already gone, or had moved on — another advance won it. */
    | 'lost'
    /** This store cannot express the condition; no guarantee was offered. */
    | 'unsupported';

/**
 * [#14333] What {@link AutomationEngine.claimAdvance} concluded — the engine's
 * reading of a {@link SuspensionClaimOutcome} once the cases a store never
 * sees are folded in (no store attached, a run the store never accepted, a
 * store that cannot express the condition, a store that could not be reached).
 * Module-private: it is a control-flow verdict, not a contract.
 */
type AdvanceClaim =
    | { kind: 'claimed' }
    | { kind: 'lost' }
    | { kind: 'unguarded' }
    | { kind: 'unavailable'; message: string };

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
     * [#20725] Every currently-stored suspended run of the named flows —
     * COMPLETE. An implementation MUST answer every such run or throw; ⛔ it
     * never answers a capped page, because its caller decides a write on what
     * is ABSENT from the answer (the ADR-0126 §7.3 disable guard: "does this
     * caller still hold a parked run?"), and a truncated answer reads as "no".
     *
     * OPTIONAL: a store without it is read through {@link list}, whose own
     * contract above is "all" — so the question is answered either way; this
     * member is how a store with a large table asks for a few flows' rows
     * instead of enumerating every run in the deployment.
     */
    listByFlow?(flowNames: readonly string[]): Promise<SuspendedRun[]>;
    /**
     * [#14333] CONDITIONALLY consume a suspension: remove the durable record
     * only if it is still parked where the caller read it — "delete only if
     * still at node N".
     *
     * This is the cross-replica half of the resume idempotency guard. The
     * engine's own `resuming` set is per-PROCESS, so two decisions on one run
     * arriving in the same instant on two replicas each pass their own check,
     * both read the same fresh row, and both traverse forward — running every
     * downstream side effect twice. The compare-and-set belongs where the
     * shared state lives, so it lives here.
     *
     * The condition, normatively: the stored row for `runId` is still parked
     * at `parkedAt.nodeId`, AND — when `parkedAt.correlation` is set — still
     * carries that correlation. An implementation MUST perform the test and
     * the removal as ONE atomic operation against the shared state; a read
     * followed by a separate delete re-opens the very window this closes.
     *
     * OPTIONAL, and its absence is a DECLARED degradation rather than a silent
     * one: the engine says once per store that the advance guarantee is
     * in-process only and then resumes exactly as it did before this member
     * existed. Same posture as {@link FlowDispatchStore}'s missing-ledger
     * branch — a weakened guarantee is announced, never assumed.
     */
    claimSuspension?(runId: string, parkedAt: SuspensionParkedAt): Promise<SuspensionClaimOutcome>;
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

/** What a claimed dispatch turned into (#14501). */
export type FlowDispatchOutcome = 'succeeded' | 'failed';

/**
 * One row of the dispatch-claim ledger, as a reader sees it (#14501).
 *
 * `outcome: null` is the honest third state, not a missing value: the claim
 * was taken and never settled — either the dispatch is in flight right now, or
 * the process that took it died mid-launch, or the row predates #14501. Every
 * consumer reads all three of those as **not delivered**, which is the safe
 * direction: an unforced `replay()` re-runs them rather than refusing on a
 * claim nobody ever settled.
 */
export interface FlowDispatchClaim {
    /** The dispatch key — the ledger row's primary id. */
    key: string;
    /** When the key was claimed (ISO-8601), or `null` if the store cannot say. */
    claimedAt: string | null;
    /** Terminal outcome, or `null` while the claim is unsettled. */
    outcome: FlowDispatchOutcome | null;
    /** When the outcome was recorded (ISO-8601), or `null` while unsettled. */
    settledAt: string | null;
}

/**
 * Persisted claim ledger for trigger dispatch idempotency (#10220), extended
 * by #14501 to record what each claim turned into.
 *
 * `claim(key)` is check-and-record: `true` means the caller now owns this
 * dispatch key and should launch the flow; `false` means some earlier sweep —
 * possibly in a previous process lifetime — already dispatched it. Backed by
 * `sys_flow_dispatch` in production (see `ObjectStoreFlowDispatchStore`), so
 * dedup survives kernel rebuild.
 *
 * `settle` and `read` are OPTIONAL, and their absence is a DECLARED
 * degradation rather than a silent one — the same posture
 * {@link SuspendedRunStore.claimSuspension} takes. A store that predates
 * #14501 implements neither: every claim then reads as unsettled, and the
 * `replay()` refusal the #14501 ruling adds simply never fires. Dedup is
 * unchanged; only the refusal is lost, and the engine says so once.
 */
export interface FlowDispatchStore {
    claim(key: string): Promise<boolean>;
    /**
     * Record the outcome of an already-claimed key. A no-op for a key that was
     * never claimed — settling is a transition on an existing row, never a way
     * to create one.
     */
    settle?(key: string, outcome: FlowDispatchOutcome): Promise<void>;
    /** The claim for `key`, or `null` when the key was never claimed. */
    read?(key: string): Promise<FlowDispatchClaim | null>;
}

/**
 * [ADR-0126 §4] One packaged flow's deployment-level activation row, as the
 * engine sees it. The ledger's own columns are `metadata_type` / `name` /
 * `package_id` / `active`; `metadata_type` is fixed to `'flow'` by the store,
 * so it never reaches the engine. There is no tenant column on the table —
 * a row records that THIS ENVIRONMENT switched a packaged flow off.
 */
export interface FlowActivationRow {
    /** The packaged flow's machine name. */
    name: string;
    /**
     * The package that ships the flow. Every flow row names one — the toggle
     * refuses a flow no package ships before it writes — but the row type is
     * the shared ledger's (`MetadataActivationRow`, `@objectstack/core`),
     * where an absent package is the spelling of an environment-authored
     * position or permission set, so it is optional here too. Nothing reads
     * it back to decide anything.
     */
    packageId?: string;
    /** Is the packaged flow armed for this installation. */
    active: boolean;
}

/**
 * [ADR-0126 §7.2] The durable off-switch for packaged flows — the mechanism
 * that REPLACES the process-local `flowEnabled` map commit 02b41232d measured leaking
 * across tenants.
 *
 * Backed by `sys_metadata_activation` in production (see
 * `ObjectStoreFlowActivationStore`), so a disabled packaged flow stays
 * disabled across a restart — the property the retired in-process map could
 * not have, and the one that made its "mitigating but not exculpating" cold
 * boot the only thing limiting the leak commit 02b41232d measured.
 *
 * Absence of a row means the packaged default — ACTIVE — so an engine with no
 * store attached, or a store with no rows, behaves exactly as a stock boot
 * always has.
 */
export interface FlowActivationStore {
    /** Every flow activation row — the ledger is deployment-wide. */
    list(): Promise<FlowActivationRow[]>;
    /** Insert or update the row for one packaged flow. */
    setActive(row: FlowActivationRow): Promise<void>;
}

/**
 * TTL for the engine's IN-PROCESS dispatch-claim fallback (#10220). Every
 * dispatch key embeds a calendar day, so a key stops being producible once its
 * sweep day has passed; 48h comfortably outlives any key's claimable lifetime
 * while keeping the fallback map bounded.
 */
export const IN_PROCESS_DISPATCH_CLAIM_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * ADR-0087 conversions the flow rehydration seam refuses to replay, by id —
 * the DEFAULT-FLIP class, the same per-door refusal the artifact-ingestion
 * door makes (`DEFAULT_FLIPS_NOT_REPLAYED_HERE` in
 * `packages/metadata-core/src/artifact-forward-conversion.ts`, which lists this
 * seam's one id beside its own precedent). The registry stays the single
 * authority on what converts; this is only this seam saying which entries its
 * own evidence cannot carry, and each id owes its reason beside it.
 *
 * - `flow-decision-mode-inclusive-explicit` (#15429) writes `mode: 'inclusive'`
 *   onto an edge-branched `decision` with two or more conditioned out-edges,
 *   so a flow written while every true branch ran keeps that behaviour under
 *   the exclusive traversal. The rewrite is sound only where "this body
 *   predates the flip" is a FACT, and here it never is: `canonicalizeStoredFlow`
 *   sees every body alike — a code-shipped flow at the boot pull, a REST
 *   `POST /automation` definition, a Studio save and a package duplication
 *   (both resolve this same method) — and a decision written yesterday against
 *   the contract that says an omitted `mode` is exclusive is byte-identical to
 *   a row written before the contract said so. Replaying it would rewrite every
 *   new exclusive decision into an inclusive one at registration and persist
 *   that at save, and the ruled default would be unobservable. The entry
 *   replays where the age IS asserted: `os migrate meta --from 17`, by the
 *   operator, over authored sources — never at a load seam. The artifact
 *   door refuses it for the same reason (its declared `^17.0.0` floor is a
 *   dependency range, not an age), in the module named above.
 */
const CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION: readonly string[] = [
    'flow-decision-mode-inclusive-explicit',
];

/**
 * The id a registration refusal is listed under in the stored pass — a
 * `ConversionTodoNotice.conversionId` that names the refusing door, for a site
 * no conversion and no D3 entry of the migration chain covers.
 */
export const FLOW_REGISTRATION_TODO_ID = 'registerFlow';

/** What a TODO from {@link FLOW_REGISTRATION_TODO_ID} says the site is on. */
const FLOW_REGISTRATION_TODO_SURFACE = 'flow — a site AutomationEngine.registerFlow refuses';

/**
 * One registration refusal site as a stored-pass TODO. The fate leads and the
 * check's own words follow, as a refused-shape TODO's do: the site stays as
 * stored, and the flow does not register.
 */
function flowRegistrationTodo(flowName: string, site: RegistrationCheckSite): ConversionTodoNotice {
    const reason = 'No conversion rewrites it, and registerFlow refuses it: left as stored, the flow is not '
        + `registered at boot and never runs. Flow \`${flowName}\`, ${site.detail}`;
    return {
        code: CONVERSION_TODO_CODE,
        conversionId: FLOW_REGISTRATION_TODO_ID,
        surface: FLOW_REGISTRATION_TODO_SURFACE,
        from: site.from,
        path: site.path,
        reason,
        message: `[protocol] left ${FLOW_REGISTRATION_TODO_SURFACE} at ${site.path} as stored — `
            + `AutomationEngine.registerFlow refuses it and no conversion rewrites it: ${reason}`,
    };
}

/**
 * Lift the `{ dialect, source }` envelopes the flow schema derives for edge
 * `condition`s back onto the conversion output — and take nothing else with
 * them (#4454).
 *
 * This is the persistence half of {@link AutomationEngine.canonicalizeStoredFlow}.
 * A stored flow that is written back must end up in the shape the load seam
 * would produce, or the seam keeps re-deriving it on every boot and the
 * migration was pointless. But `FlowSchema.parse` also materializes defaults
 * (`version`, `runAs`, per-edge `type` / `isDefault`), and persisting a default
 * the author never wrote pins that row to today's value forever — so the graft
 * is deliberately narrow: it copies the lowered `condition`, nothing more.
 *
 * Structural alignment is by position, which is sound because the parse — region
 * transform included (#4415) — never reorders or drops array members: every step
 * of it is a copy-on-write map. Where the two sides disagree in shape (a caller
 * passed a mismatched pair), the converted side is returned untouched: this only
 * ever lifts a value it can positively match.
 *
 * Node `config.condition` (e.g. a start node's record-change predicate) is
 * left alone by construction — `FlowNodeSchema.config` is an open `z.record`,
 * so the parse never lowers it, so there is no envelope on the parsed side to
 * copy and the recursion finds a string facing a string.
 */
function graftConditionEnvelopes(converted: unknown, parsed: unknown): unknown {
    if (Array.isArray(converted)) {
        if (!Array.isArray(parsed)) return converted;
        let changed = false;
        const out = converted.map((entry, i) => {
            const next = graftConditionEnvelopes(entry, parsed[i]);
            if (next !== entry) changed = true;
            return next;
        });
        return changed ? out : converted;
    }
    if (
        converted && typeof converted === 'object'
        && parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ) {
        const parsedRec = parsed as Record<string, unknown>;
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(converted as Record<string, unknown>)) {
            if (key === 'condition' && typeof value === 'string') {
                const lowered = parsedRec[key];
                if (
                    lowered && typeof lowered === 'object' && !Array.isArray(lowered)
                    && typeof (lowered as { source?: unknown }).source === 'string'
                ) {
                    out[key] = lowered;
                    changed = true;
                    continue;
                }
            }
            const next = graftConditionEnvelopes(value, parsedRec[key]);
            if (next !== value) changed = true;
            out[key] = next;
        }
        return changed ? out : converted;
    }
    return converted;
}

/**
 * [#11997] Where one flow body came from, as the boot pull could tell.
 *
 * `'package'` — a code-shipped artifact (`isCodeArtifactBody`, ADR-0029 D9.6).
 * `'runtime'` — a `sys_metadata`/runtime-authored row with no real package
 * provenance: the ADR-0005 overlay, and the sanctioned override path per
 * ADR-0048 §1.5.
 */
export interface FlowContender {
    source: 'package' | 'runtime';
    /** The owning package id, when a code package ships this body. */
    packageId?: string;
}

/**
 * [#20761] A reader over the loader's set: the package that ships the flow
 * `name` as a code artifact, or `undefined` when no managed package loaded a
 * flow of that name. See {@link AutomationEngine.setPackagedFlowSource}.
 */
export type PackagedFlowSource = (name: string) => string | undefined;

/**
 * [#20790] Where a flow's credentials live once they are out of its
 * definition: the write-only flow credential channel (the automation plugin's
 * `FlowCredentialChannel`, on the #7799 secret seam). Positions are
 * `(flow name, node id, config key)` and refer to the LIVE (active) flow.
 *
 * `holds` / `held` answer synchronously from what the channel knows is stored
 * — the registration check and the binding are synchronous. `resolve` reads
 * the value at the moment of use and never caches it: `undefined` means the
 * channel holds nothing there; a held credential that does not come back
 * THROWS, and is never read as "no credential". With no reachable store
 * `resolve` cannot tell held from not, so it throws too — which is why every
 * caller with a fallback (a packaged literal) asks `resolve` only for a
 * position `holds` reports.
 */
export interface FlowCredentialSource {
    holds(flowName: string, nodeId: string, key: string): boolean;
    held(flowName: string): Array<{ nodeId: string; key: string }>;
    resolve(flowName: string, nodeId: string, key: string): Promise<string | undefined>;
}

/**
 * [#20790] One credential a registered flow holds, by class: a literal in its
 * definition (a packaged flow's source), or held by the credential channel.
 * What the clone door refuses on — never the value.
 */
export interface FlowCredentialHolding {
    readonly nodeId: string;
    readonly key: string;
    /** The class an administrator is told (`flowCredentialClassLabel`). */
    readonly label: string;
    readonly held: 'literal' | 'channel';
}

/**
 * [#11997] What the ADR-0005 overlay precedence decided for one bare flow name.
 *
 * Emitted only when a name had more than one contender at pull time. `armed` is
 * the body that is actually in the engine's flow map and will dispatch;
 * `shadowed` are the ones that lost, in the order the registry listed them.
 */
export interface FlowShadowingRecord {
    /** The bare name every contender claimed. */
    name: string;
    armed: FlowContender;
    shadowed: FlowContender[];
}

/**
 * [#17396] The two trigger kinds the deployment's scheduled-work switch
 * governs: the ones launched by a CLOCK rather than by a caller.
 *
 * `record_change` and `api` are deliberately absent and the line is not
 * arbitrary — both are fired by a request that already exists and already
 * carries an identity, so neither is the unbounded background load the switch
 * exists to bound. A kind added to `FlowTriggerKind` later is OUTSIDE the
 * switch until someone decides otherwise, which is the safe default: a new kind
 * silently falling under a default-OFF switch would be a capability that
 * disappears on arrival.
 *
 * Module-local: the same two tokens are the trigger package's own subject by
 * construction (it implements exactly these two), so publishing a shared
 * predicate would add a public name with one caller.
 */
function isTimeTriggeredKind(triggerType: string): boolean {
    return triggerType === 'schedule' || triggerType === 'time_relative';
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
    /**
     * [#11997] Shadowing receipts, keyed by the bare flow name.
     *
     * `flows` is keyed by BARE name and stays that way — making it
     * package-aware is a much larger change than this defect warrants, and
     * ADR-0048 does not ask for it. The consequence is that when a packaged
     * flow and a runtime-authored flow claim one name, the loser leaves no
     * trace in `flows`: `listFlows`/`getFlowRuntimeStates` enumerate
     * `flows.keys()`, so the shadowed contender is invisible BY CONSTRUCTION,
     * and an admin cannot tell which of the two is armed.
     *
     * This side map is the receipt. It never affects dispatch — it records
     * what the ADR-0005 precedence decided, so {@link getShadowedFlows} and
     * {@link getFlowRuntimeStates} can show it.
     */
    private flowShadowing = new Map<string, FlowShadowingRecord>();
    /**
     * [#23316] Refused registrations, keyed by the bare flow name: what this
     * engine threw when a host's sync handed it a stored flow it would not
     * register, for a name it holds nothing under. The record behind
     * {@link getFlowRegistration}'s `refused`.
     *
     * Present only while the name is unheld: {@link registerFlow} succeeding
     * and {@link withdrawFlow} both delete the entry, so a name is never
     * `refused` and registered at once. The host writes it
     * ({@link recordFlowRefusal}) — the engine cannot tell a sync's refusal
     * from a write door's, which answers its caller instead and must leave no
     * record. Like {@link flowShadowing} it is a receipt: it never affects
     * dispatch.
     */
    private flowRefusals = new Map<string, FlowRegistrationRefusal>();
    /**
     * [ADR-0126 §7.2] Flows the durable ACTIVATION LEDGER currently marks
     * inactive — the local projection of `sys_metadata_activation`, keyed by
     * flow name. Membership means "a row says `active: false`"; absence means
     * the packaged default, ACTIVE (§4).
     *
     * ## ⛔ This is NOT the retired `flowEnabled` map under a new name
     *
     * That distinction is the whole point of ADR-0126 §7.2, so it is spelled out
     * rather than left to a reader's charity. The retired map was the TRUTH:
     * `toggleFlow` wrote it and nothing else recorded the bit, so the
     * off-switch was a name-keyed, unscoped, process-local value that one
     * tenant could set and every other tenant read. Three things are different
     * here, and each is load-bearing:
     *
     *   1. **It is a projection, not a source.** The only writers are
     *      {@link hydrateFlowActivations} (boot, from the ledger) and
     *      {@link toggleFlow} (which writes the durable row FIRST and updates
     *      this only after that write succeeds). There is no path that changes
     *      this set without the ledger changing, so it cannot drift into being
     *      an independent off-switch.
     *   2. **The write door is gated.** Reaching `toggleFlow` from the wire
     *      goes through the automation domain's activation gate: in `group` /
     *      `isolated` postures the write requires the platform operator, so
     *      the tenant-org-admin caller commit 02b41232d measured is refused before any
     *      of this runs (ADR-0126 §5).
     *   3. **It survives a restart** — because the row does. The retired map's
     *      cold-boot amnesia was recorded as "mitigating but not exculpating";
     *      durability is what turns the flip into a recorded administrator
     *      CHOICE (§6 wall 3) instead of a process accident.
     *
     * ## Why a projection at all, rather than reading the ledger per execute()
     *
     * Because the ledger has to be consulted at BIND time, not only at run
     * time: §7.2 requires the install-level row to unbind the trigger, so the
     * engine must know a flow's activation state at boot — before any
     * `execute()` — to decide whether to arm its trigger at all. Given that
     * boot read is required anyway, `execute()` consults its result rather
     * than issuing a datasource read on every single flow run.
     */
    private flowLedgerDisabled = new Set<string>();
    /**
     * The durable ledger behind {@link flowLedgerDisabled}. `null` until a host
     * attaches one via {@link setFlowActivationStore} — an engine with no
     * ObjectQL has no durable plane to write to, and says so at the moment of
     * a flip rather than reporting a durability it does not have.
     */
    private flowActivationStore: FlowActivationStore | null = null;
    /**
     * [#20761] The reader over the loader's set — see
     * {@link setPackagedFlowSource}. `undefined` until a host attaches one, and
     * with none attached NO flow is packaged: an engine no loader feeds holds
     * no flow a managed package loaded.
     */
    private packagedFlowSource?: PackagedFlowSource;
    /** [#20790] The write-only flow credential channel — see {@link setFlowCredentialSource}. */
    private flowCredentialSource?: FlowCredentialSource;
    /** [#20281 stage ③] The connector sync executor — see {@link setConnectorPullSource}. */
    private connectorPullSource?: (request: ConnectorSourcePullRequest) => Promise<ConnectorSourcePullResult>;
    /** [#22450] The lazy `i18n` service reader — see {@link setI18nServiceSource}. */
    private i18nServiceSource?: () => RefusalI18nService | undefined;
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
    /**
     * Whether the node-type vocabulary can still grow implicitly (#4771).
     * `false` for the whole boot — ADR-0018 lets plugins contribute node types
     * from their own `init()`/`start()`, so an unknown type seen while flows
     * are being pulled means "not registered YET", not "will fail". The host
     * flips it via {@link sealNodeTypeVocabulary} once every plugin has
     * started; only then is an unknown type a finding worth warning about.
     */
    private nodeTypeVocabularySealed = false;
    /**
     * Whether this engine has already told its host that
     * {@link sealNodeTypeVocabulary} was never called (#4792). Per **instance**,
     * not per process: an embedded host that builds several engines (one per
     * tenant/environment is the common shape) forgot the call on each of them,
     * and a module-level flag would report only whichever engine ran first.
     */
    private nodeTypeSealOmissionWarned = false;
    /**
     * Node types already named by {@link warnIfResumeAuthorityUndeclared}
     * (#5561). Per **instance** and per **type**, for the same reason
     * {@link nodeTypeSealOmissionWarned} is per instance: a hot-reload or a
     * multi-tenant host re-registers the same executor repeatedly, and one
     * omission must read as one finding rather than as a log that grows with
     * uptime.
     */
    private readonly resumeAuthorityOmissionWarned = new Set<string>();
    private triggers = new Map<string, FlowTrigger>();
    /**
     * Flows currently wired to a trigger, keyed by flow name → the trigger
     * `type` that owns the binding. Used to avoid double-binding and to know
     * which trigger to `stop()` when a flow is unregistered/disabled.
     */
    private boundFlowTriggers = new Map<string, string>();
    /**
     * [#17396] Flows {@link activateFlowTrigger} refused to arm because
     * package-authored scheduled work is switched off on this deployment.
     *
     * ## Why a record and not a re-read
     *
     * `getTriggerBindingAudit()` runs long after the bind — at
     * `kernel:bootstrapped` and in the CLI startup summary, its only two
     * callers — and the switch is an ENVIRONMENT value that can move in
     * between. Asking
     * the environment again at read time was the first spelling and it is
     * measurably wrong: a flow the engine never even offered to its trigger was
     * reported as `binding failed — see earlier warnings`, which is the one
     * thing ruled item 6 forbids this state from reading as, and it pointed at
     * warnings that do not exist. The record answers the question the audit
     * actually asks — *why is this flow not armed* — with what happened.
     *
     * ## Why this is not a recorded startup verdict (AGENTS.md)
     *
     * The repo's rule forbids recording a conclusion drawn from a registry that
     * is still filling, because a provider registering a moment later cannot
     * undo the record. None of that applies: the input is an environment
     * variable, not a registry, and the record is not terminal —
     * {@link activateFlowTrigger} DELETES the entry the moment a flow gets past
     * the gate, and {@link unregisterFlow} drops it with the flow. A later
     * registration under a switched-on deployment clears it by the ordinary
     * path.
     *
     * ## Why it records the SENTENCE, not just the flow
     *
     * [#21110] The reason depends on the policy that refused: a host-injected
     * per-kernel policy may carry its own `hostDisabledReason`, and only the
     * deployment's answer names `OS_AUTOMATION_SCHEDULED_WORK_ENABLED`. So the
     * value is `scheduledWorkDisabledReason(policy)` of the reading that
     * REFUSED, kept for the same reason the key is: a resolver re-asked at read
     * time may answer something else by then.
     */
    private readonly policyDisabledFlows = new Map<string, string>();
    /**
     * [#20725, ADR-0126 §7.3] Packaged callers {@link activateFlowTrigger}
     * declined to arm because a packaged subflow they call is disabled — each
     * with the reason `/_status` and the binding audit read, naming those
     * subflows.
     *
     * A record, for {@link policyDisabledFlows}'s reason: the audit and the
     * status door run long after the bind, and must say what HAPPENED rather
     * than "binding failed". And not a terminal verdict either:
     * {@link activateFlowTrigger} deletes the entry the moment the flow gets
     * past the gate, {@link rejudgeSubflowCallers} re-asks the gate for every
     * entry whenever one of its subflows changes state, and
     * {@link unregisterFlow} drops it with the flow.
     */
    private readonly subflowDeclinedFlows = new Map<string, string>();
    /** Connectors registered by integration plugins, keyed by connector name (ADR-0018 §Addendum). */
    private connectors = new Map<string, RegisteredConnector>();
    /** Connector provider factories keyed by provider name (ADR-0097 §2 — `openapi`/`mcp`/`rest`/…). */
    private connectorProviders = new Map<string, ConnectorProviderFactory>();
    /** Bridge to the host function registry for `script`-node calls (#1870), if wired. */
    private functionResolver: FlowFunctionResolver | null = null;
    /** Bridge to the host object registry for schema-aware condition validation at
     *  registration (#1928), if wired. Advisory-only — see {@link FlowObjectSchemaResolver}. */
    private objectSchemaResolver: FlowObjectSchemaResolver | null = null;
    /** Bridge to the host authz resolver so a `runAs:'user'` run enforces the
     *  triggering user's real grants (#3356), if wired. See {@link FlowUserGrantsResolver}. */
    private userGrantsResolver: FlowUserGrantsResolver | null = null;
    /** Bridge to a host data read that expands declared lookup relations on the
     *  run record (#3475), if wired. See {@link FlowRecordExpander}. */
    private recordExpander: FlowRecordExpander | null = null;
    private executionLogs: ExecutionLogEntry[] = [];
    private readonly maxLogSize: number;
    /** Level for the per-run summary line (#4354). See {@link RunSummaryLogLevel}. */
    private readonly runSummaryLog: RunSummaryLogLevel;
    /** [#19834] Per-kernel policy override; see {@link AutomationEngineOptions.scheduledWorkPolicy}. */
    private readonly scheduledWorkPolicy: AutomationEngineOptions['scheduledWorkPolicy'];
    private logger: Logger;
    /**
     * Runs paused at a node, keyed by runId (ADR-0019). Process-local copy of
     * the pause — mirrored to {@link store} when one is configured, so a pause
     * survives a process restart. See {@link SuspendedRun}.
     *
     * [#13617] NOT a read-through cache sitting in front of the store. When a
     * store is configured the STORE is the authority and this map answers only
     * for the runs it never accepted ({@link cacheOnlySuspensions}). Reading
     * this map first is what made a multi-replica approval flow re-create every
     * level — the mechanism is in {@link loadSuspendedRunStrict}.
     */
    private suspendedRuns = new Map<string, SuspendedRun>();
    /**
     * [#13617] Runs whose durable save FAILED, so {@link store} holds no row
     * for them and its "no such run" says nothing about them. These are the
     * only runs {@link loadSuspendedRunStrict} will answer out of
     * {@link suspendedRuns} while a store is configured — which is what keeps
     * {@link persistSuspendedRun}'s documented degradation (a save failure
     * costs cross-restart durability, not in-process resumability) working.
     *
     * Written by {@link persistSuspendedRun} — added when a save throws,
     * cleared when one lands — and dropped alongside the cache entry by
     * {@link forgetSuspendedRun}, the single choke point every consumption
     * passes through, so it is bounded by the map it qualifies.
     */
    private cacheOnlySuspensions = new Set<string>();
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
    /**
     * [#13909] Suspensions this process consumed on a resume that then failed
     * downstream — the hot half of {@link restoreConsumedSuspension}, mirrored
     * to the run's terminal history row when a {@link store} is configured
     * (exactly the {@link suspendedRuns} + {@link store} pairing one field up).
     *
     * Bounded by {@link MAX_CONSUMED_SUSPENSIONS}, oldest first: each entry
     * holds a whole suspension, and the durable copy is the record.
     */
    private consumedSuspensions = new Map<string, ConsumedSuspension>();
    /**
     * [#15556] The subflow PARENT strand a child's completion bubbled into,
     * keyed by the CHILD run id — i.e. exactly the run id a caller resuming
     * the child already holds. {@link bubbleToParent} writes an entry only on
     * its `'stranded'` exit (never on the tolerated `RESUME_IN_PROGRESS` /
     * `STORE_UNAVAILABLE` arms, which stay functional per #15556's ruling);
     * {@link takeSubflowParentStrand} is the one reader, and it deletes on
     * read so an entry nobody asks for does not accumulate forever.
     *
     * Bounded by {@link MAX_CONSUMED_SUSPENSIONS} for the same reason that
     * bound exists one field up — a caller that never asks (a bare `resume()`
     * with no subflow-aware consumer) must not leak memory across restarts of
     * the same long-lived process.
     */
    private subflowParentStrands = new Map<string, SubflowParentStrand>();
    /**
     * [#13909] Run ids currently mid-RESTORE — the same synchronous in-process
     * guard shape as {@link resuming}, so two operators racing the verb produce
     * one restored pause and one refusal instead of two `restored: true`
     * answers. Across processes the guarantee is carried by the paused row
     * itself: a suspension is keyed by run id, so a second restore finds one
     * live and refuses `RUN_SUSPENDED`.
     */
    private restoring = new Set<string>();
    /**
     * Optional persisted dispatch-claim ledger (#10220). When set, `claim()`
     * checks-and-records against `sys_flow_dispatch` so trigger dispatch dedup
     * survives kernel rebuild; when absent, `claim()` degrades to the
     * in-process map below — honestly, with a one-time warning.
     */
    private flowDispatchStore: FlowDispatchStore | null = null;
    /**
     * In-process dispatch-claim fallback: key → claim time (epoch ms) and the
     * outcome it settled to (#14501), `null` while unsettled. Used when no
     * persisted ledger is attached, and per-key when the ledger errors.
     * Entries expire after {@link IN_PROCESS_DISPATCH_CLAIM_TTL_MS}.
     */
    private readonly inProcessDispatchClaims = new Map<
        string,
        { at: number; outcome: FlowDispatchOutcome | null }
    >();
    /**
     * Whether this engine has already said its dispatch dedup is in-process
     * only (#10220). Once per instance: a silent fallback hides a permanently
     * weakened guarantee, but repeating it every sweep tick is log spam.
     */
    private dispatchClaimDegradationWarned = false;
    /**
     * [#14333] Whether this engine has already said that its cross-replica
     * advance guarantee is missing — the attached {@link SuspendedRunStore}
     * has no {@link SuspendedRunStore.claimSuspension}, or answered
     * `'unsupported'`. Once per instance, for the reason one field up: a
     * silent fallback hides a permanently weakened guarantee, and repeating it
     * per resume is log spam.
     */
    private advanceClaimDegradationWarned = false;
    /**
     * [#14501] Whether this engine has already said that its attached ledger
     * records no claim OUTCOMES — same once-per-instance reason as the two
     * fields above: a silent fallback hides a permanently weakened guarantee,
     * repeating it per replay is log spam.
     */
    private dispatchOutcomeDegradationWarned = false;

    constructor(logger: Logger, store?: SuspendedRunStore, options?: AutomationEngineOptions) {
        this.logger = logger;
        this.store = store;
        this.maxLogSize = options?.maxLogSize ?? DEFAULT_MAX_EXECUTION_LOG_SIZE;
        this.runSummaryLog = options?.runSummaryLog ?? 'info';
        this.scheduledWorkPolicy = options?.scheduledWorkPolicy;
    }

    /**
     * [#19834] The scheduled-work policy for THIS engine, read at each bind:
     * the per-kernel option when one was given, else the zero-argument
     * deployment resolver, unchanged.
     */
    private readScheduledWorkPolicy(): ScheduledWorkPolicy {
        const source = this.scheduledWorkPolicy;
        if (source === undefined) return resolveScheduledWorkPolicy();
        return typeof source === 'function' ? source() : source;
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
     * Attach (or replace) the persisted {@link FlowDispatchStore} (#10220).
     * Used by the service plugin once the ObjectQL engine is available and
     * `sys_flow_dispatch` is registered.
     */
    setFlowDispatchStore(store: FlowDispatchStore): void {
        this.flowDispatchStore = store;
    }

    /**
     * Claim a trigger dispatch key (#10220): `true` = the caller owns this
     * dispatch and should launch the flow; `false` = it was already dispatched
     * (this sweep, an earlier sweep, or a previous process lifetime).
     *
     * Exposed on the automation service surface so triggers — which resolve
     * `automation` structurally and never learn the table name — can dedup
     * their dispatches against the persisted `sys_flow_dispatch` ledger.
     *
     * Degradation contract (both halves deliberate):
     *  - No persisted ledger attached → in-process dedup, with a ONE-TIME
     *    warning that the guarantee is weakened (a rebuild can re-dispatch).
     *  - Persisted ledger ERRORS → availability over strict-once: the failure
     *    is logged and the claim falls back to the in-process check for that
     *    key, which returns `false` only when THIS process already dispatched
     *    it — so a store outage never blocks a dispatch, and never double-fires
     *    within one process lifetime either.
     */
    async claim(key: string): Promise<boolean> {
        if (this.flowDispatchStore) {
            try {
                return await this.flowDispatchStore.claim(key);
            } catch (err) {
                this.logger.warn(
                    `[automation] flow-dispatch claim '${key}' failed against the persisted ledger — ` +
                        `falling back to in-process dedup for this key (availability over strict-once: ` +
                        `the dispatch proceeds unless this process already made it; a kernel rebuild may re-dispatch it). ` +
                        `The store failure is in this record's meta.`,
                    describeThrownForLog(err),
                );
                return this.claimInProcess(key);
            }
        }
        if (!this.dispatchClaimDegradationWarned) {
            this.dispatchClaimDegradationWarned = true;
            this.logger.warn(
                '[automation] no persisted flow-dispatch ledger (no ObjectQL engine, or sys_flow_dispatch not registered) — ' +
                    'trigger dispatch dedup is IN-PROCESS ONLY and will NOT survive a kernel rebuild: ' +
                    'the same record/window can be re-dispatched after a restart.',
            );
        }
        return this.claimInProcess(key);
    }

    /** In-process half of {@link claim}: TTL-pruned check-and-record. */
    private claimInProcess(key: string): boolean {
        const now = Date.now();
        this.pruneInProcessDispatchClaims(now);
        if (this.inProcessDispatchClaims.has(key)) return false;
        this.inProcessDispatchClaims.set(key, { at: now, outcome: null });
        return true;
    }

    private pruneInProcessDispatchClaims(now: number): void {
        const cutoff = now - IN_PROCESS_DISPATCH_CLAIM_TTL_MS;
        for (const [k, rec] of this.inProcessDispatchClaims) {
            if (rec.at < cutoff) this.inProcessDispatchClaims.delete(k);
        }
    }

    /**
     * Record what a claimed dispatch turned into (#14501) — the second half of
     * {@link claim}, and the half `IJobService.replay()` reads to decide
     * whether a window was DELIVERED or merely attempted.
     *
     * Best-effort by construction, in both directions. A settle that throws is
     * logged and swallowed: the dispatch already happened, and turning a
     * delivered flow into a thrown one to report a bookkeeping failure is
     * strictly worse than leaving the row unsettled — an unsettled row reads
     * as "not delivered", so the only cost is that a later replay is allowed
     * through instead of refused. A ledger without `settle()` is the same
     * cost, said once by {@link readDispatch}.
     *
     * ⚠️ Not every call writes. `succeeded` is ABSORBING: a claim that already
     * recorded success stays `succeeded` even if a later forced replay throws,
     * because rewriting it would silently reopen the unforced re-delivery door
     * the #14501 ruling closed. The store enforces that (`isSettleAllowed`) and
     * refuses by not writing, never by throwing — a refusal is the invariant
     * working, not a failure to report.
     */
    async settleDispatch(key: string, outcome: FlowDispatchOutcome): Promise<void> {
        const store = this.flowDispatchStore;
        if (store && typeof store.settle === 'function') {
            try {
                await store.settle(key, outcome);
                return;
            } catch (err) {
                this.logger.warn(
                    `[automation] flow-dispatch settle '${key}' → '${outcome}' failed against the persisted ledger — ` +
                        `the claim stays UNSETTLED, which reads as 'not delivered': a later replay of this window is ` +
                        `allowed through rather than refused. The store failure is in this record's meta.`,
                    describeThrownForLog(err),
                );
            }
        }
        const existing = this.inProcessDispatchClaims.get(key);
        // Same write rule as the persisted ledger: `succeeded` is absorbing, so
        // the fallback cannot reopen a re-delivery door the durable path keeps
        // shut. Kept here rather than imported so the engine stays free of a
        // dependency on the store module it merely drives.
        if (existing && !(existing.outcome === 'succeeded' && outcome === 'failed')) {
            this.inProcessDispatchClaims.set(key, { ...existing, outcome });
        }
    }

    /**
     * Read one dispatch claim (#14501): `null` when the key was never claimed.
     *
     * A ledger that cannot answer — none attached, one predating #14501, or a
     * read that throws — reports the key as UNCLAIMED rather than guessing.
     * That is the availability-over-strict-once direction this ledger already
     * takes everywhere else: the caller re-runs, it never refuses on a reading
     * it could not make.
     */
    async readDispatch(key: string): Promise<FlowDispatchClaim | null> {
        const store = this.flowDispatchStore;
        if (store && typeof store.read === 'function') {
            try {
                return await store.read(key);
            } catch (err) {
                this.logger.warn(
                    `[automation] flow-dispatch read '${key}' failed against the persisted ledger — ` +
                        `reporting the key as UNCLAIMED (availability over strict-once: a replay proceeds rather ` +
                        `than being refused on a reading we could not make). The store failure is in this record's meta.`,
                    describeThrownForLog(err),
                );
                return null;
            }
        }
        if (store && !this.dispatchOutcomeDegradationWarned) {
            this.dispatchOutcomeDegradationWarned = true;
            // The ledger predates the outcome half of the claim contract.
            this.logger.warn(
                '[automation] the attached flow-dispatch ledger has no read() — this message describes the ' +
                    'ledger that has no read()/settle() AT ALL, where dispatch claims are still deduplicated ' +
                    'and the in-process fallback still records outcomes and still refuses WITHIN one process ' +
                    'lifetime, but nothing outlives a restart. A ledger that has settle() but no read() is ' +
                    'weaker still: outcomes are written durably and never read back, so no replay is ever ' +
                    'refused, in this lifetime or any other.',
            );
        }
        this.pruneInProcessDispatchClaims(Date.now());
        const rec = this.inProcessDispatchClaims.get(key);
        if (!rec) return null;
        return {
            key,
            claimedAt: new Date(rec.at).toISOString(),
            outcome: rec.outcome,
            settledAt: null,
        };
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
     * durable store. A store failure does not fail the run — the in-memory copy
     * still allows in-process resume; only cross-restart durability is lost.
     *
     * Logged at ERROR, not warn: a durable pause that silently stayed
     * in-memory is data-loss-in-waiting. #4420 was exactly this — a store
     * pointed at a table that was never created, every save failing into a warn
     * nobody read, and every in-flight approval zombified by the next restart.
     */
    private async persistSuspendedRun(run: SuspendedRun): Promise<void> {
        // [#16129] THE MAP WRITE IS FIRST, and `cacheOnlySuspensions` is written
        // only after the save below settles => for the whole duration of that
        // await this entry is in the map and is NOT yet qualified. A concurrent
        // per-id `loadSuspendedRunStrict` therefore reads a store that
        // truthfully has no row yet, finds no qualifier, and takes
        // `evictConsumedSuspension` on a run being parked RIGHT NOW. Reachable
        // without out-of-band knowledge of the id, because the map write is what
        // publishes it to `listSuspendedRuns`.
        //
        // Bounded, measured, and pinned in
        // `suspended-run-mid-park-eviction-window.test.ts`: the store-first
        // strict load keeps the run resumable once the save lands, and the cost
        // falls entirely on `listSuspendedRuns`, which merely OMITS the run --
        // inside that listing's declared latitude. Do not widen the marking, add
        // a lock, or move the save above this line without reading that pin's
        // header.
        //
        // [#16151] The ONE compound case that ESCAPED those bounds — an evicting
        // read inside the window, and then the save FAILING, leaving the run
        // with neither a durable row nor a map entry — is closed in the catch
        // below, which re-seats this entry. The base window itself is
        // deliberately unchanged: while the save is still in flight a per-id
        // read still evicts, and bound 1 still carries it.
        this.suspendedRuns.set(run.runId, run);
        if (this.store) {
            try {
                await this.store.save(run);
                // [#13617] The store now holds this pause, so it — not this map
                // — is the answer for it. Cleared here and not only on the
                // failure path: a re-suspend whose save lands after an earlier
                // one failed must stop being read out of memory.
                this.cacheOnlySuspensions.delete(run.runId);
            } catch (err) {
                // [#13617] The store was never given the row, so its "no such
                // run" is silence about this run rather than an answer. This is
                // what lets `loadSuspendedRunStrict` keep serving it from the
                // map — the in-process resumability the message below promises.
                this.cacheOnlySuspensions.add(run.runId);
                // [#16151] RE-SEAT THE MAP ENTRY — the marking above qualifies
                // an entry that may no longer be there. The map write at the
                // top of this method is NOT yet qualified for the whole
                // duration of the await, so a concurrent per-id
                // `loadSuspendedRunStrict` reads a store that truthfully has no
                // row, finds no qualifier, and evicts a run being parked right
                // now. Compound that with THIS save failing and the run was
                // left with neither a durable row nor a map entry:
                // `hasSuspendedRun` answered `false` and `resume` answered
                // `RUN_NOT_FOUND` — the run lost IN-PROCESS, while the record
                // below told the operator it was "kept in memory only" and that
                // they had until the next restart to act.
                //
                // Re-seating restores exactly this method's own write, on the
                // one path where the store refused the row. It cannot resurrect
                // a CONSUMED suspension: consumption goes through
                // `forgetSuspendedRun`, which is reachable only once
                // `loadSuspendedRunStrict` answers for this run, and for the
                // whole of this await it answers `null` for the reason above.
                // Nor can it clobber a NEWER entry: `persistSuspendedRun` is the
                // only writer of this map, and a second park of the same run
                // needs a resume that the same `null` refuses.
                //
                // ⛔ NOT a widening of the cache-only marking, which #16129
                // forbids taking unilaterally because it would weaken #13617's
                // store authority: the marking still happens only after the
                // save has settled, and only when it settled as a FAILURE.
                this.suspendedRuns.set(run.runId, run);
                // #6499 — the cause is the datasource DRIVER's own text, so it
                // goes to the logger's STRUCTURED slot, never spliced into the
                // message; see `forgetSuspendedRun`'s catch below for the full
                // mechanism (#6299) — this seam is its nearest twin, on the
                // same `SuspendedRunStore` driver.
                //
                // #4632 verdict: DURABILITY — the level STAYS `error`, where
                // #4460 put it: the docblock above argues it (#4420 is this
                // exact seam's accident). Third argument per the `Logger`
                // contract (`error(message, error?, meta?)`); the `Error` slot
                // stays empty on purpose (#5575).
                this.logger.error(
                    `[automation] failed to persist suspended run '${run.runId}' to the durable store — it is ` +
                        `kept in memory only: this process keeps it resumable, and hasSuspendedRun() and ` +
                        `listSuspendedRuns() both still answer for it — if they do not, this run is already ` +
                        `gone and that is a defect in this engine, not in the store. It will NOT be resumable ` +
                        `after a restart. Fix the store failure in this record's meta.`,
                    undefined,
                    describeThrownForLog(err),
                );
            }
        }
    }

    /**
     * Drop a suspended run from the in-memory cache and (best-effort) the
     * durable store. Called once the run is claimed for resume or reaches a
     * terminal state.
     *
     * This is the ONE choke point through which every consumption of a
     * suspension passes (resume, terminal failure, cancel), which is why it —
     * and not any individual caller — notifies the paused node's executor that
     * its pause is over ({@link NodeExecutor.onSuspensionReleased}, #5512). It
     * therefore takes the whole {@link SuspendedRun}: the notification needs the
     * node and the correlation the executor minted, not just the id.
     *
     * A durable-store `delete` failure does NOT fail the consumption — the run
     * has already left the node — but it is reported at `error`, not `warn`
     * (#4632/#6299): the cache entry is gone while the row survives, so the run
     * reads as terminal now and as still-suspended after a restart. See the
     * catch below for the full verdict.
     */
    private async forgetSuspendedRun(
        run: SuspendedRun,
        reason: SuspensionReleaseReason,
        /**
         * [#14333] Set only by the resume path, and only when
         * {@link claimAdvance} has ALREADY removed the durable row as its
         * compare-and-set. The unconditional delete below would then be a
         * second round-trip that can only re-delete what is gone — while the
         * rest of this choke point (the cache entry, the cache-only
         * qualifier, and the executor's release notification) is still owed
         * exactly once. Nothing else may pass it: for every other consumption
         * the durable row is still there and this method is what removes it.
         */
        durableRecordAlreadyConsumed = false,
    ): Promise<void> {
        this.suspendedRuns.delete(run.runId);
        // [#13617] The qualifier goes with the entry it qualifies — this is the
        // one choke point every consumption passes through, so nothing can leave
        // a run marked "the store never took this" after its map entry is gone.
        this.cacheOnlySuspensions.delete(run.runId);
        if (this.store && !durableRecordAlreadyConsumed) {
            try {
                await this.store.delete(run.runId);
            } catch (err) {
                // #6299 — the cause goes to the logger's STRUCTURED slot, never
                // spliced into the message: it is the datasource DRIVER's own
                // failure text, we do not control how many lines it has, and
                // `ObjectLogger.write()` adds exactly one `<ts> <LEVEL>` head
                // per call — so a newline in it turns this ONE record into
                // several physical lines of which only the first is greppable.
                // The family of #5048 / #5575 / #5636 / #5661 / #5737 / #5912 /
                // #6230, and cloud#971's shape.
                //
                // #4632 verdict: DURABILITY — raised from `warn` to `error`, and
                // deliberately NOT a copy of #6230's "the level stays warn". The
                // hot cache is dropped on the line ABOVE the try, and this
                // method is the single choke point every consumption of a
                // suspension passes through (resume / terminal failure /
                // cancel), so on this path the suspension is gone in-process
                // while the durable row SURVIVES. Every caller still reports
                // success — `resume()` returns a successful result, `cancelRun()`
                // returns `true`, `recordLog` writes a terminal record — and the
                // surviving row is read straight back out after the next
                // restart: `rearmSuspendedWaitTimers` lists it and `resume()`
                // rehydrates it through `loadSuspendedRunStrict`'s store read,
                // re-running a continuation that has already run. Nothing
                // retries this delete. That is the shape the durability gate's
                // own vocabulary already grades `error` for the metadata store
                // (`deleteMetaItemFromLoader`, #5259: "the surviving row is read
                // straight back out of storage … so the 'deleted' item reappears
                // and survives every restart"). `check:durability-log-level`
                // cannot see it HERE only because `SuspendedRunStore.delete` is
                // not in its declared callee vocabulary — which is exactly why
                // this level is pinned by a test instead.
                //
                // THIRD argument, per the `Logger` contract
                // (`packages/spec/src/contracts/logger.ts`):
                // `error(message, error?, meta?)`. The `Error` slot is left
                // empty on purpose (#5575) — a raw `Error` there ships its stack
                // trace on every record.
                this.logger.error(
                    `[automation] suspended run '${run.runId}' was consumed (${reason}) but could NOT be deleted from ` +
                        `the durable store — the in-memory suspension is already gone while the durable row SURVIVES, ` +
                        `so this run reads as terminal now and as still-suspended after the next restart, where ` +
                        `rearmSuspendedWaitTimers lists it and resume() rehydrates it from the store and re-runs a ` +
                        `continuation that has already run. Nothing retries this delete. Fix the store failure in this ` +
                        `record's meta, then delete the row for '${run.runId}' by hand.`,
                    undefined,
                    describeThrownForLog(err),
                );
            }
        }
        await this.releaseSuspension(run, reason);
    }

    /**
     * [#15832] Drop a map entry for a run this process has a store-authoritative
     * per-id "no row" answer for — a run parked HERE and consumed by another
     * replica.
     *
     * ## Why this exists at all, and why not on the `'lost'` branch
     *
     * {@link forgetSuspendedRun} is the one eviction site, and it runs in
     * whichever process CONSUMES the suspension. Put two replicas over one
     * store and the parking process is routinely not that one: A parks a run
     * and B resumes it, so A's entry is never removed by anything. The card
     * that found this located the leak on `resumeInternal`'s `'lost'` branch,
     * which returns before that choke point — but the NO-RACE shape leaks
     * identically (A parks, only B ever resumes, A never attempts a claim and
     * there is no `'lost'` at all), so an eviction hung on `'lost'` alone would
     * leave the ordinary multi-replica deployment untouched.
     *
     * The retained snapshot is not only memory. Two readers hand it back:
     * {@link listSuspendedRuns} — synchronous, cache-only, and the one listing
     * on the `AutomationService` spec contract — and
     * {@link listSuspendedRunsDurable}, which deliberately appends map entries
     * the durable list lacks. After the other replica COMPLETES the run both
     * report a phantom: a finished run listed as suspended, whose
     * {@link getSuspendedScreen} answers `null`, so a consumer that lists and
     * then opens gets an entry it cannot act on.
     *
     * ## What this does NOT do
     *
     * ⛔ It does not touch the cache-only listing's contract. The spec says
     * `listSuspendedRuns()` lists "the currently suspended (paused) runs
     * awaiting a resume"; this engine's own docblock adds only that it may
     * OMIT runs (those parked in a previous process lifetime) because it reads
     * the cache alone. Removing an entry therefore moves nothing: under-
     * reporting is already inside that declared latitude, and over-reporting
     * was never inside the promise. Nothing here makes either listing
     * store-backed.
     *
     * ⛔ It does not notify the paused node's executor
     * ({@link NodeExecutor.onSuspensionReleased}). That notification belongs to
     * {@link forgetSuspendedRun} because it is the choke point every
     * CONSUMPTION passes through, and an eviction is not a consumption — this
     * process consumed nothing, the replica that did fired its own. Firing one
     * here would tear down a pause twice, once per replica.
     *
     * ## The two guards, and why each is load-bearing
     *
     *  - **no store** — the map IS the authority (`loadSuspendedRunStrict`
     *    returns from it directly), so there is no second reader to be wrong
     *    about and nothing may be dropped.
     *  - **{@link cacheOnlySuspensions}** — a run whose durable save failed was
     *    never handed to the store, so the store's "no row" is SILENCE about it
     *    rather than an answer (#13617). Evicting on that would convert
     *    {@link persistSuspendedRun}'s documented degradation — a failed save
     *    costs cross-restart durability, not in-process resumability — into a
     *    run that vanishes from its own process.
     *
     * [#16129] Neither guard covers the MID-PARK WINDOW: `persistSuspendedRun`
     * writes its map entry BEFORE it awaits the durable save, so an entry can be
     * live here while the store legitimately has no row for it and the
     * cache-only qualifier is not yet set. Evicting it is bounded -- the run
     * stays resumable through the store-first strict load and only the
     * cache-only listing under-reports -- and
     * `suspended-run-mid-park-eviction-window.test.ts` pins that window.
     *
     * [#16151] The one COMPOUND case that escaped those bounds -- an eviction
     * here, and then that same save FAILING, leaving the run with neither a
     * durable row nor a map entry -- no longer does: `persistSuspendedRun`'s
     * catch re-seats the entry alongside the cache-only marking, so guard 2
     * above has something to guard again. The same pin file carries it, now at
     * the intended outcome rather than at the measured loss.
     *
     * A store read that THROWS must never reach here: an outage means the
     * run's existence is UNKNOWN, not "gone". Every caller below is on a path
     * where the store answered.
     */
    private evictConsumedSuspension(runId: string): void {
        if (!this.store) return;
        if (this.cacheOnlySuspensions.has(runId)) return;
        this.suspendedRuns.delete(runId);
    }

    /**
     * [#14333] Claim the right to advance this run past the node it is parked
     * at — the CROSS-REPLICA half of the resume idempotency guard.
     *
     * {@link resuming} is a per-PROCESS `Set`, which is a complete guard for
     * exactly one deployment shape: a single process. Put two replicas behind
     * a load balancer over one store and two decisions on one run arriving in
     * the same instant each pass their OWN `resuming` check, both read the
     * same fresh row through {@link loadSuspendedRunStrict}, both consume it,
     * and both traverse forward — every downstream side effect runs twice.
     * Measured on the two-engines-over-one-shared-store harness at 25/25
     * raced runs before this claim existed.
     *
     * So the decision is taken where the shared state lives:
     * {@link SuspendedRunStore.claimSuspension} removes the row only if it is
     * still parked at the node this replica read, atomically, and the loser is
     * TOLD. `resuming` stays as the cheap first gate — it is not replaced, and
     * it still refuses a same-process duplicate without any store round-trip.
     *
     * Four cases never reach the store, and each is a deliberate `unguarded`:
     *  - **no store** — nothing is shared, so there is no second replica to
     *    race and `resuming` is already the whole guarantee. Not a
     *    degradation: there is no cross-replica guarantee to weaken.
     *  - **a run the store never accepted** ({@link cacheOnlySuspensions},
     *    #13617) — the store holds no row for it, so a compare-and-set would
     *    answer `lost` for a run that is legitimately resumable in this
     *    process, converting {@link persistSuspendedRun}'s documented
     *    degradation (a failed save costs cross-RESTART durability, not
     *    in-process resumability) into an unresumable run.
     *  - **a store without the member** — a third-party store predating it.
     *  - **a store answering `'unsupported'`** — one that cannot express the
     *    condition against its backing engine.
     *
     * The last two are announced once per engine rather than assumed silently,
     * which is the whole difference between a degradation and a lie.
     */
    private async claimAdvance(run: SuspendedRun): Promise<AdvanceClaim> {
        const store = this.store;
        if (!store) return { kind: 'unguarded' };
        if (this.cacheOnlySuspensions.has(run.runId)) return { kind: 'unguarded' };
        if (typeof store.claimSuspension !== 'function') {
            this.warnAdvanceClaimDegraded('the attached suspended-run store has no claimSuspension()');
            return { kind: 'unguarded' };
        }
        let outcome: SuspensionClaimOutcome;
        try {
            outcome = await store.claimSuspension(run.runId, {
                nodeId: run.nodeId,
                ...(run.correlation !== undefined ? { correlation: run.correlation } : {}),
            });
        } catch (err) {
            // Handed to the CALLER, so not a degradation and deliberately NOT a
            // log site (AGENTS.md "Degradation log levels": a failure the
            // requester was told about does not look normal from the outside).
            // The envelope is the same STORE_UNAVAILABLE the strict load
            // answers, for the same reason — existence is UNKNOWN, not "gone
            // for good" (#4420).
            //
            // ⛔ What this branch may NOT claim is that the suspension was not
            // consumed. A throw can arrive AFTER a committed delete — a dropped
            // connection on the way back from a landed statement — so the one
            // thing known here is that THIS resume did not continue the run.
            // The result text says exactly that and no more; a retry is what
            // resolves the ambiguity, answering RUN_NOT_FOUND if the row is in
            // fact gone.
            return { kind: 'unavailable', message: (err as Error).message };
        }
        if (outcome === 'unsupported') {
            this.warnAdvanceClaimDegraded("the attached suspended-run store answered 'unsupported'");
            return { kind: 'unguarded' };
        }
        return outcome === 'claimed' ? { kind: 'claimed' } : { kind: 'lost' };
    }

    /**
     * [#14333] Say ONCE, per engine instance, that resume idempotency is
     * in-process only.
     *
     * #4632 verdict: FUNCTIONAL — `warn`, not `error`. Nothing that claims to
     * be persisted fails to land here; what is smaller than advertised is a
     * GUARANTEE, and the next person to run two replicas finds out the way
     * this line says they will. Byte-for-byte the call {@link claim}'s
     * missing-ledger branch makes one screen up, and for the same reason: a
     * silent fallback hides a permanently weakened guarantee, while an
     * `error` here would train everyone to skim `error`.
     */
    private warnAdvanceClaimDegraded(cause: string): void {
        if (this.advanceClaimDegradationWarned) return;
        this.advanceClaimDegradationWarned = true;
        this.logger.warn(
            `[automation] no cross-replica advance guarantee (${cause}) — resume idempotency is ` +
                `IN-PROCESS ONLY: two decisions on one run arriving at the same moment on two replicas ` +
                `can both advance it, running every downstream side effect twice. Attach a suspended-run ` +
                `store that implements claimSuspension() to close it.`,
        );
    }

    /**
     * Tell the executor of the node a run was paused at that the pause is over,
     * so it can disarm whatever it armed on entry (#5512).
     *
     * Runs AFTER the suspension is gone from cache and store: the run has
     * definitively left the node, so a slow or broken job service can neither
     * delay the continuation nor resurrect the pause. Failures are logged and
     * swallowed for the same reason — a wake-up that outlives its run is a
     * misleading `sys_job` row, not a broken run, and the log names the handle
     * an operator needs to clean it up by hand.
     *
     * Routed by the node's own registry type (recorded on the suspension,
     * falling back to the live flow for rows persisted before `nodeType`
     * existed) rather than broadcast to every listener — the executor that
     * created the pause is the one that owns tearing it down, and nothing else
     * has to pattern-match correlation strings it does not own.
     */
    private async releaseSuspension(run: SuspendedRun, reason: SuspensionReleaseReason): Promise<void> {
        const nodeType = this.resolveSuspendedNodeType(run);
        const executor = nodeType ? this.nodeExecutors.get(nodeType) : undefined;
        if (!executor?.onSuspensionReleased) return;
        try {
            await executor.onSuspensionReleased({
                runId: run.runId,
                flowName: run.flowName,
                nodeId: run.nodeId,
                correlation: run.correlation,
                reason,
            });
        } catch (err) {
            // #6499 — the thrown text is PLUGIN-SUPPLIED (the node executor's
            // own teardown), so it goes to the structured slot; see
            // `forgetSuspendedRun`'s catch above for the full mechanism
            // (#6299). The message keeps the correlation handle — that is the
            // thing an operator cleans up by hand.
            //
            // #4632 verdict: FUNCTIONAL — stays `warn`, per the docblock: the
            // run continued and nothing claimed-persisted failed to land; the
            // leftover is whatever the node armed on entry (a misleading
            // `sys_job` row, not a broken run). `warn(message, meta?)` — meta
            // is the SECOND argument; `warn` has no `Error` slot.
            this.logger.warn(
                `[automation] run '${run.runId}': '${nodeType}' node '${run.nodeId}' failed to release its suspension ` +
                    `(reason: ${reason}, correlation: ${run.correlation ?? 'none'}) — the run continued; whatever the ` +
                    `node armed on entry may still be scheduled. The executor's own failure is in this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }

    /**
     * The registry type of the node a run is paused at: what the suspension
     * recorded at pause time, falling back to the live flow definition for rows
     * persisted before `nodeType` existed. Recorded-first on purpose — a flow
     * republished mid-pause must not re-type the node out from under a run
     * (see {@link SuspendedRun.nodeType}).
     */
    private resolveSuspendedNodeType(run: SuspendedRun): string | undefined {
        return run.nodeType ?? this.flows.get(run.flowName)?.nodes.find(n => n.id === run.nodeId)?.type;
    }

    // ── Plugin Extension API ──────────────────────────────

    /**
     * Register a node executor (called by plugins).
     *
     * [#23543 F5-http] Refuses a type — the executor's or its descriptor's —
     * that is one of the retired callout names reserved inside the open node
     * namespace ({@link FLOW_RESERVED_NODE_TYPES}). No node could ever reach
     * such an executor: the flow parse refuses an authored node typed with the
     * name, and flow rehydration rewrites a stored one to `http` before it
     * parses. Refused loudly here, at the plugin's own registration call, so
     * the author hears it at boot instead of shipping a node type that is dead
     * on arrival. Nothing is registered on a refusal.
     */
    registerNodeExecutor(executor: NodeExecutor): void {
        // The body lives in ./plugin-extension-api.ts (#25222).
        const host: ThisParameterType<typeof registerNodeExecutor> = {
            nodeExecutors: this.nodeExecutors,
            logger: this.logger,
            actionDescriptors: this.actionDescriptors,
            warnIfResumeAuthorityUndeclared: (...a) => this.warnIfResumeAuthorityUndeclared(...a),
        };
        registerNodeExecutor.call(host, executor);
    }

    /**
     * Name a pausing node type that never declared WHO may resume the pauses it
     * creates (#5561, the tracking item ADR-0044's amendment deferred).
     *
     * `resumeAuthority` carries no schema default precisely so this warning can
     * exist: with `.default('any')` an omission parsed into a descriptor
     * byte-identical to an author's explicit `'any'`, so the fact was gone
     * before the engine ever saw the object. Absent now means absent, and a
     * pausing type that leaves it absent is judged by nobody's decision —
     * #3823 is what that costs (a revise pause standing in a service-owned
     * position inherited `wait`'s legitimate `'any'`, and a raw resume walked
     * past an unrecorded decision).
     *
     * **Since #5561 step two this warning precedes a refusal, not a silence.**
     * An omission used to resolve `'any'`, so the line was pure advice about a
     * run-time behaviour that was already happening; it now resolves
     * `'service'` ({@link RESUME_AUTHORITY_WHEN_UNDECLARED}), so every pause the
     * named type creates will be refused on the generic resume route. The line
     * says so, and says the one-line fix, because registration is the earliest
     * moment the author can hear it — the alternative is hearing it from a user
     * whose run will not continue.
     *
     * **What it asserts, and why that is safe here.** Only the static fact that
     * THIS descriptor omits the key — a property of the object being registered,
     * fixed at authoring time, which no later registration can contradict. It
     * reads no registry and draws no conclusion from anything being absent from
     * one, so it is not the shape AGENTS.md "Startup registry reads" forbids and
     * needs no seal flag (contrast {@link warnIfNodeTypeVocabularyNeverSealed},
     * which reports a missing CALL for the same reason).
     *
     * **Scope, stated up front:** the trigger is `supportsPause`, so a descriptor
     * that leaves it false is not asked this question at all. That used to be a
     * blind spot — the executor could suspend anyway and nothing said a word
     * (#5703) — and it is now closed at the other end instead of here:
     * {@link refuseUndeclaredSuspension} refuses the suspension itself at the
     * engine boundary (#6667), so the mismatch fails the run that produced it
     * rather than parking a continuation this gate never got to warn about.
     * A type that suspends therefore reaches this warning by the only route
     * left — declaring `supportsPause: true`, which is when the question about
     * `resumeAuthority` is worth asking.
     */
    private warnIfResumeAuthorityUndeclared(descriptor: ActionDescriptor): void {
        // The body lives in ./plugin-extension-api.ts (#25222).
        const host: ThisParameterType<typeof warnIfResumeAuthorityUndeclared> = {
            resumeAuthorityOmissionWarned: this.resumeAuthorityOmissionWarned,
            logger: this.logger,
        };
        warnIfResumeAuthorityUndeclared.call(host, descriptor);
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
     * ADR-0018 M3 first collapsed the outbound verbs onto `http` / `notify`
     * this way: `http_request` / `http_call` / `webhook` were aliases of `http`
     * until 11.0 removed them. Since 18 those three names are reserved
     * (#23543 F5-http), so {@link registerNodeExecutor} refuses an alias under
     * one of them too.
     */
    registerNodeAlias(
        alias: string,
        canonicalType: string,
        meta?: { name?: string; category?: ActionDescriptor['category']; paradigms?: ActionDescriptor['paradigms']; needsOutbox?: boolean },
    ): void {
        // The body lives in ./plugin-extension-api.ts (#25222).
        const host: ThisParameterType<typeof registerNodeAlias> = {
            registerNodeExecutor: (...a) => this.registerNodeExecutor(...a),
            logger: this.logger,
            nodeExecutors: this.nodeExecutors,
        };
        registerNodeAlias.call(host, alias, canonicalType, meta);
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
        // The body lives in ./plugin-extension-api.ts (#25222).
        const host: ThisParameterType<typeof registerTrigger> = {
            triggers: this.triggers,
            logger: this.logger,
            flows: this.flows,
            boundFlowTriggers: this.boundFlowTriggers,
            resolveTriggerBinding: (...a) => this.resolveTriggerBinding(...a),
            activateFlowTrigger: (...a) => this.activateFlowTrigger(...a),
        };
        registerTrigger.call(host, trigger);
    }

    /** Unregister a trigger (hot-unplug) */
    unregisterTrigger(type: string): void {
        // Tear down every flow bound to this trigger before dropping it.
        for (const [name, boundType] of [...this.boundFlowTriggers]) {
            if (boundType !== type) continue;
            try {
                this.triggers.get(type)?.stop(name);
            } catch (err) {
                // #6499 — the thrown text is PLUGIN-SUPPLIED (`FlowTrigger.stop`),
                // so it goes to the structured slot; see `forgetSuspendedRun`'s
                // catch above for the full mechanism (#6299).
                //
                // #4632 verdict: FUNCTIONAL — stays `warn`: nothing
                // claimed-persisted is involved. The binding bookkeeping is
                // dropped either way; the worst case is the trigger's own
                // subscription staying armed, and a fired flow still lands in
                // run history visibly, behind execute()'s own guards.
                this.logger.warn(
                    `Trigger '${type}' stop('${name}') failed while unregistering the trigger — the flow is ` +
                        `unbound anyway; whatever the trigger armed for it may keep firing until the process ` +
                        `restarts. The trigger's own failure is in this record's meta.`,
                    describeThrownForLog(err),
                );
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
     *
     * [#14328] WHICH KIND a flow asks for is not decided here: it is
     * {@link resolveFlowTriggerKind}'s answer, the one `@objectstack/spec`
     * export that `defineStack`'s trigger-capability refusal and
     * `@objectstack/lint`'s `validate-flow-trigger-readiness` already read.
     * This method keeps only the per-kind BINDING construction — which start-node
     * fields each trigger needs. Before #14328 the chain was hand-kept here in
     * parallel with the spec one, and nothing pinned them together: a branch
     * added on one side left `defineStack` accepting a stack the runtime leaves
     * inert, or refusing one it would arm. Now `getTriggerBindingAudit` and the
     * boot banner name the kind authoring named, by construction.
     */
    private resolveTriggerBinding(
        flowName: string,
    ): { triggerType: string; binding: FlowTriggerBinding } | undefined {
        const flow = this.flows.get(flowName);
        if (!flow) return undefined;
        return this.deriveTriggerBinding(flowName, flow);
    }

    /**
     * {@link resolveTriggerBinding}'s body, over a flow that need not be
     * registered yet — so {@link validateApiTriggerSecret} judges, at
     * registration, the very binding {@link activateFlowTrigger} would hand the
     * trigger, rather than a second reading of the start node.
     */
    private deriveTriggerBinding(
        flowName: string,
        flow: FlowParsed,
    ): { triggerType: string; binding: FlowTriggerBinding } | undefined {
        // The body lives in ./plugin-extension-api.ts (#25222).
        const host: ThisParameterType<typeof deriveTriggerBinding> = {
            hookSecretResolver: (...a) => this.hookSecretResolver(...a),
        };
        return deriveTriggerBinding.call(host, flowName, flow);
    }

    /**
     * Bind a flow to its matching registered trigger (idempotent). No-op when
     * the flow may not run ({@link isFlowEnabled}), when it has no trigger
     * binding, or when no trigger is registered for its type yet —
     * {@link registerTrigger} re-attempts activation when one arrives.
     */
    private activateFlowTrigger(flowName: string): void {
        if (this.boundFlowTriggers.has(flowName)) return;
        // [ADR-0126 §7.2] THE enablement gate for arming — here, at the one
        // point every arming path crosses, and not in its callers. A flow
        // either disable dimension switches off (the activation ledger, or an
        // `obsolete` / `invalid` status) is never handed to a trigger, whichever
        // path asks: {@link registerFlow} (boot pull, publish, hot reload),
        // {@link registerTrigger}, the enable half of {@link toggleFlow}, and
        // any path added later.
        //
        // Why it cannot live in the callers: `registerTrigger` runs when a
        // trigger plugin registers at `kernel:ready`, AFTER `start()` pulled
        // the flows and {@link hydrateFlowActivations} unbound the switched-off
        // ones. While only `registerFlow` asked, that later registration
        // re-armed every one of them on every cold boot — `/_status` reported a
        // disabled flow `bound: true`, and each matching event fired a run
        // `execute()` then refused.
        //
        // Silent on purpose: an unarmed disabled flow is the state the switch
        // exists to produce, the host's hydration line already named it, and
        // `getFlowRuntimeStates()` reports it `enabled: false`. Ahead of the
        // scheduled-work policy gate below for the same reason — a flow that
        // may not run has no policy refusal to record.
        if (!this.isFlowEnabled(flowName)) return;
        const resolved = this.resolveTriggerBinding(flowName);
        if (!resolved) return;
        // [#17396] The deployment gate, read HERE rather than only inside the
        // trigger. The trigger has its own copy of this gate and throws, which
        // is what protects a host that binds without this engine — but a
        // refusal that arrives as a THROW can only be reported through this
        // method's catch, and that catch says "Failed to bind", which is the
        // one thing ruled item 6 forbids this state from reading as. Asking the
        // policy before `start()` keeps the two apart at the source: nothing is
        // called, nothing throws, nothing is logged as a failure.
        //
        // ⚠️ AHEAD of the trigger lookup, deliberately. With the switch off,
        // registering the missing trigger would change nothing, so reporting
        // "no 'schedule' trigger is registered — add requires: ['triggers']"
        // hands the operator a remedy that cannot work. The switch outranks it
        // because it is the fact that decides the outcome.
        //
        // ⛔ The POLICY is not cached — the resolver reads `process.env` live,
        // so a host that rebinds after changing the environment (the CLI's
        // `--fresh` harness, a test flipping the switch between kernels in one
        // process) sees the value current at the bind. [#19834] A per-kernel
        // `scheduledWorkPolicy` option replaces that read for this engine only;
        // a resolver given there is likewise called at each bind. What IS recorded is the
        // REFUSAL, on {@link policyDisabledFlows}, and that is the difference
        // between the two: see its own docblock for why the audit must read
        // what happened rather than re-derive it from an environment that may
        // have moved since.
        //
        // The policy is read only for a time-triggered kind, as before: a
        // record-change or api flow never asks it.
        const policy = isTimeTriggeredKind(resolved.triggerType) ? this.readScheduledWorkPolicy() : undefined;
        if (policy !== undefined && !policy.enabled) {
            // [#21110] The sentence comes from the SAME reading that refused —
            // the host's own reason when its per-kernel policy carries one, else
            // the deployment sentence — and the bind log, the audit and the
            // `/_status` row all read this one recorded value.
            const reason = scheduledWorkDisabledReason(policy);
            if (this.policyDisabledFlows.get(flowName) !== reason) {
                this.policyDisabledFlows.set(flowName, reason);
                // Said once per flow while it stays refused for the same
                // reason, at `info`, for the reason the trigger's own refusal
                // records: this is the DEFAULT state of every deployment and the
                // deployment declared it, so nothing is wrong and nothing looks
                // normal-but-broken. The structured channel is the audit below,
                // which the `kernel:bootstrapped` hook and the CLI startup
                // summary read.
                this.logger.info(
                    `Flow '${flowName}' is not armed on trigger '${resolved.triggerType}' — ${reason}`,
                );
            }
            return;
        }
        // Past the gate the refusal no longer describes this flow: either it
        // binds below, or it fails/waits for its trigger with a reason of its
        // own. Cleared BEFORE the trigger lookup so a flow whose trigger has
        // not arrived yet is reported as waiting for a trigger, not as
        // policy-disabled — with the switch on, the missing trigger really is
        // the reason.
        this.policyDisabledFlows.delete(flowName);
        // [#20725, ADR-0126 §7.3] The subflow half of the same gate: a PACKAGED
        // flow is not armed while a packaged subflow it calls is disabled —
        // armed, it would fail at its subflow node on the child's refusal, the
        // late, inexplicable failure §7.3 exists to prevent. Here rather than
        // in the callers for this gate's own reason: every arming path —
        // create, republish, upgrade, hot reload, the kernel:ready trigger
        // registration, the enable toggle — crosses this line, so none of them
        // can arm onto a disabled child and none can forget to ask.
        //
        // ⛔ A DECLINE, never a refusal: `registerFlow` still registers, so a
        // boot or an upgrade never fails on an installation's choice. The flow
        // stays unarmed, `/_status` says why ({@link describeUnboundReason}),
        // and it is armed the moment its subflow is enabled
        // ({@link rejudgeSubflowCallers}). Ahead of the trigger lookup for the
        // policy gate's reason: with the child off, registering the missing
        // trigger would change nothing, so "no trigger registered" would name
        // a remedy that cannot work.
        if (this.declineOntoDisabledSubflows(flowName, resolved.triggerType)) return;
        const trigger = this.triggers.get(resolved.triggerType);
        if (!trigger) return;
        try {
            // A trigger-fired run's result must not vanish (2026-07-17 eval:
            // a failing record-change flow produced zero output — the failure
            // lived only in the run-history row). Condition-skipped runs stay
            // quiet (execute() already debug-logs them — they are high-frequency).
            //
            // #6587 — `result.error` is the envelope field that carries a
            // failing node's / driver's text VERBATIM (#5912 left it that way
            // on purpose), so foreign newlines reach this message second-hand;
            // it goes to the structured slot — the identical class as
            // `bubbleToParent`'s envelope branch, on the fired-run path. See
            // `forgetSuspendedRun`'s catch for the full mechanism (#6299).
            //
            // #4632 verdict: stays `error`, on its own reasoning rather than
            // inertia. This is the fire-and-forget path: NO caller holds this
            // result envelope, so after the failure the system looks normal
            // from the outside — the triggering event was handled and nothing
            // retries the run — while the flow's declared effects never
            // landed; the only other trace is the passive run-history row.
            // That stderr also survives the CLI's boot-quiet stdout window is
            // stream mechanics, not the verdict.
            //
            // [ADR-0126 §7.2] The line states only what happened. Two kinds of
            // `execute()` answer are not a failed run:
            //   - `FLOW_DISABLED`: the flow was switched off after the trigger
            //     took the event — an event in flight at the switch-off, or a
            //     trigger whose `stop()` failed. The refusal IS the switch
            //     working, so it is said at `info`, never as an `error` that
            //     reads as a production failure. The enablement gate above
            //     keeps a disabled flow from being armed at all, so this is the
            //     residue, not the steady state.
            //   - every other never-dispatched exit (a `code` or a missing
            //     flow, and no `status`): no node ran, so the line claims no
            //     run-history row. Only a run that dispatched and failed
            //     carries `status: 'failed'` — the verdict that exit also wrote
            //     to the run history.
            trigger.start(resolved.binding, (ctx: AutomationContext) =>
                this.execute(flowName, ctx).then((result) => {
                    if (result.success) return;
                    if (result.code === 'FLOW_DISABLED') {
                        this.logger.info(
                            `Trigger '${resolved.triggerType}' fired flow '${flowName}', which is disabled — the ` +
                                `run was refused before it started, nothing ran, and no run-history row records ` +
                                `it. The refusal is in this record's meta.`,
                            { error: result.error },
                        );
                        return;
                    }
                    this.logger.error(
                        `Trigger-fired run of flow '${flowName}' failed (trigger '${resolved.triggerType}') — ` +
                            `no caller holds this result and nothing retries the run; ` +
                            (result.status === 'failed'
                                ? `the terminal failure is recorded in the flow's run history, and the run's ` +
                                  `failure envelope is in this record's meta.`
                                : `it was refused before it dispatched, and the refusal envelope is in this ` +
                                  `record's meta.`),
                        undefined,
                        { error: result.error ?? 'unknown error' },
                    );
                }),
            );
            this.boundFlowTriggers.set(flowName, resolved.triggerType);
            this.logger.info(`Flow '${flowName}' bound to trigger '${resolved.triggerType}'`);
        } catch (err) {
            // #6499 — plugin-supplied thrown text (`FlowTrigger.start`) to the
            // structured slot; see `forgetSuspendedRun`'s catch above for the
            // full mechanism (#6299).
            //
            // #4632 verdict: FUNCTIONAL — stays `warn`: "a trigger is not
            // armed" is the rule's own canonical `warn` example. The flow is
            // visibly smaller than declared (its runs never appear), and the
            // kernel:bootstrapped binding audit re-reports every unbound
            // triggered flow.
            this.logger.warn(
                `Failed to bind flow '${flowName}' to trigger '${resolved.triggerType}' — the flow stays ` +
                    `registered but will NOT fire on this trigger until the flow or the trigger is ` +
                    `re-registered. The trigger's own failure is in this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }

    /** Unbind a flow from its trigger, if bound. */
    private deactivateFlowTrigger(flowName: string): void {
        const boundType = this.boundFlowTriggers.get(flowName);
        if (!boundType) return;
        try {
            this.triggers.get(boundType)?.stop(flowName);
        } catch (err) {
            // #6499 — plugin-supplied thrown text (`FlowTrigger.stop`) to the
            // structured slot; see `forgetSuspendedRun`'s catch above for the
            // full mechanism (#6299).
            //
            // #4632 verdict: FUNCTIONAL — stays `warn`, same consequence shape
            // as `unregisterTrigger`'s stop above: the binding is dropped
            // either way, and a subscription the trigger failed to tear down
            // fires into execute()'s own disabled/unregistered-flow guards,
            // visibly.
            this.logger.warn(
                `Trigger '${boundType}' stop('${flowName}') failed while unbinding the flow — the binding is ` +
                    `dropped anyway; whatever the trigger armed for it may keep firing until the process ` +
                    `restarts. The trigger's own failure is in this record's meta.`,
                describeThrownForLog(err),
            );
        }
        this.boundFlowTriggers.delete(flowName);
    }

    /** Active flow→trigger bindings (observability / tests). */
    getActiveTriggerBindings(): Array<{ flowName: string; triggerType: string }> {
        return [...this.boundFlowTriggers].map(([flowName, triggerType]) => ({ flowName, triggerType }));
    }

    /**
     * Register a connector (called by integration plugins, ADR-0018 §Addendum;
     * and by the automation service for materialized declarative instances,
     * ADR-0097 §2). Validates the definition against {@link ConnectorSchema} and
     * asserts every declared action has a handler, so a half-wired connector
     * fails loudly at registration rather than silently at dispatch.
     *
     * Re-registering the **same** name from the **same** origin replaces (mirrors
     * {@link registerNodeExecutor} — supports hot-reload). Re-registering across
     * origins — a plugin name colliding with a declarative provider-bound
     * instance, or vice versa — is a **hard error** (the two-sources-of-truth
     * hazard, ADR-0097 §4): there is no silent precedence, because silent
     * precedence is how the declared def and the plugin def drift apart.
     *
     * @param origin how the connector reached the engine (defaults to `plugin`;
     *   the automation service passes `declarative` for materialized instances).
     */
    registerConnector(
        def: Connector,
        handlers: Record<string, ConnectorActionHandler>,
        origin: ConnectorOrigin = 'plugin',
    ): void {
        // The body lives in ./plugin-extension-api.ts (#25222).
        const host: ThisParameterType<typeof registerConnector> = {
            assertSameOriginOrFree: (...a) => this.assertSameOriginOrFree(...a),
            connectors: this.connectors,
            logger: this.logger,
        };
        registerConnector.call(host, def, handlers, origin);
    }

    /**
     * Register a connector in the **degraded** state (#3017): its provider
     * factory could not reach the upstream it materializes from (an MCP server,
     * a remote spec), so there are no actions and no handlers yet. Registering
     * the husk — instead of leaving the name absent — keeps the instance honest:
     * `GET /connectors` shows it with `state: 'degraded'` + the reason, and a
     * `connector_action` dispatching to it fails with a pointed error rather
     * than "unknown connector". The materializer retries and replaces this
     * registration via {@link registerConnector} once the upstream is back.
     * Same cross-origin collision rule as {@link registerConnector} (ADR-0097 §4).
     *
     * #5660 — this record's message used to end in `— ${reason}`, and `reason`
     * is not ours: the only caller passes `ConnectorUpstreamUnavailableError`'s
     * message, constructed by a third-party provider factory (ADR-0097 invites
     * people to write them; the spec defines the error class and says nothing
     * about its text), so an upstream SDK's multi-line failure landed inside the
     * message verbatim. `ObjectLogger.write()` emits one `<ts> <LEVEL> …` head
     * per call, so a message carrying newlines becomes several physical lines
     * and only the first is a record. This is the seam of that family (#5048,
     * #5575, #5636) that fires **first and on the default branch** — every
     * successful husk registration, i.e. every first degrade — and it fires at
     * cold boot inside `serve`'s boot-quiet window, which wraps
     * `process.stdout.write` (where `warn` goes) and whose `BootLogCapture`
     * *drops* any physical line `classifyBootLogLine` finds no level head on.
     * So the continuation lines were not merely hard to parse, they were gone.
     *
     * The message is now self-sufficient and newline-free by construction
     * (`name` is `^[a-z_][a-z0-9_]*$` per {@link ConnectorSchema}, `origin` is
     * an enum), and the facts travel in the logger's `meta`:
     *
     *   - `degradedReason` — always present: the text this registration STORED
     *     on the husk. Named for the field it mirrors, and deliberately not
     *     `reason`/`cause`/`key`-flavoured: `ObjectLogger` redacts recursively
     *     by substring over `password`/`token`/`secret`/`key` (#5573), and this
     *     name matches none of them, so the operator's one fact survives.
     *   - the thrown value's own rendering (`error` or `issues`, via
     *     {@link describeThrownForLog}) — present only when the caller supplied
     *     `cause`. It is a fact about the FAILURE, where `degradedReason` is a
     *     fact about the REGISTRATION; today's single caller derives one from
     *     the other, so the two coincide, but the record's shape does not
     *     depend on that and a caller that summarizes is not silently lossy.
     *     Note `describeThrownForLog` renders the thrown value's own `.message`
     *     only — `ConnectorUpstreamUnavailableError.cause` (the underlying
     *     connect error) is carried here but not yet rendered; widening that
     *     rendering is a change to the shared helper, not to this seam.
     *
     * `reason` itself — and therefore `degradedReason` on the descriptor, what
     * `GET /connectors` shows and what a `connector_action` refusal quotes — is
     * unchanged, verbatim, newlines included. It is read by a human through
     * JSON, not by a line splitter (#5636 made the same call at the caller).
     *
     * @param reason operator-facing text stored as the husk's `degradedReason`.
     *   Kept verbatim; never interpolated into a log message.
     * @param origin how the connector reached the engine (ADR-0097 §4).
     * @param cause the thrown value behind the degrade, for the log record's
     *   structured `meta`. Optional — a caller with no thrown value in hand
     *   still gets `degradedReason` in the record.
     */
    registerDegradedConnector(
        def: Connector,
        reason: string,
        origin: ConnectorOrigin = 'declarative',
        cause?: unknown,
    ): void {
        // The body lives in ./plugin-extension-api.ts (#25222).
        const host: ThisParameterType<typeof registerDegradedConnector> = {
            assertSameOriginOrFree: (...a) => this.assertSameOriginOrFree(...a),
            connectors: this.connectors,
            logger: this.logger,
        };
        registerDegradedConnector.call(host, def, reason, origin, cause);
    }

    /** Enforce the ADR-0097 §4 two-sources-of-truth rule; warn on same-origin replace. */
    private assertSameOriginOrFree(name: string, origin: ConnectorOrigin): void {
        // The body lives in ./plugin-extension-api.ts (#25222).
        const host: ThisParameterType<typeof assertSameOriginOrFree> = {
            connectors: this.connectors,
            logger: this.logger,
        };
        assertSameOriginOrFree.call(host, name, origin);
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
     * Resolve what a connector action does upstream (#4395), so the
     * `connector_action` node can COUNT its step instead of reporting it as
     * uncountable. `undefined` means the connector declared nothing — the
     * honest third answer, and still the default.
     *
     * Read from the registered connector's stored `def` rather than from
     * {@link getConnectorDescriptors}: the def is what `registerConnector`
     * validated through `ConnectorSchema`, and the descriptor list is a
     * projection of it built for HTTP discovery. Both the plugin path and the
     * ADR-0097 declarative materialization path store their def here, so one
     * lookup covers both origins.
     */
    resolveConnectorActionEffect(connectorId: string, actionId: string): ConnectorActionEffect | undefined {
        return this.connectors.get(connectorId)?.def.actions?.find((a) => a.key === actionId)?.effect;
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
     * Wire the engine to the host's object registry (#1928) so `registerFlow`
     * runs the same schema-aware condition checks as `objectstack build` —
     * unknown-field refs, likely bare-field typos, and text/boolean fields
     * misused in arithmetic. Everything it adds is advisory (logged, never
     * thrown); passing `null` detaches the bridge (registration reverts to
     * syntax + bare-ref validation only).
     */
    setObjectSchemaResolver(resolver: FlowObjectSchemaResolver | null): void {
        this.objectSchemaResolver = resolver;
    }

    /**
     * Wire the engine to the host's authorization resolver (#3356) so a
     * `runAs:'user'` run resolves the TRIGGERING user's real positions +
     * permission sets at run setup — the record-change hook session carries
     * only a `userId`, so without this the run's data ops fell back to a bare
     * member/everyone principal even when the triggering user was fully
     * authorized. The automation plugin bridges it to `@objectstack/core`'s
     * `resolveUserAuthzGrants`. Passing `null` detaches the bridge (run identity
     * reverts to whatever the trigger supplied).
     */
    setUserGrantsResolver(resolver: FlowUserGrantsResolver | null): void {
        this.userGrantsResolver = resolver;
    }

    /**
     * Wire the record lookup-expander (#3475). The automation plugin bridges it
     * to a `findOne(..., { expand, context })` on the same data engine the CRUD
     * nodes use, scoped by the run's identity. Passing `null` detaches it (lookup
     * traversal in templates then stays unresolved).
     */
    setRecordExpander(expander: FlowRecordExpander | null): void {
        this.recordExpander = expander;
    }

    /**
     * Resolve a named function for a `script` node, normalized to
     * {@link FlowFunctionRegistration} so the caller reads the handler and its
     * declared effect the same way whichever shape the host's resolver returned.
     * Returns `undefined` when no resolver is wired or the name is unregistered
     * — the node then fails the step with a clear error rather than silently
     * no-op'ing.
     */
    resolveFunction(name: string): FlowFunctionRegistration | undefined {
        const resolved = this.functionResolver?.(name);
        if (!resolved) return undefined;
        if (typeof resolved === 'function') return { handler: resolved };
        return typeof resolved.handler === 'function' ? resolved : undefined;
    }

    /** Get all registered connector names. */
    getRegisteredConnectors(): string[] {
        return [...this.connectors.keys()];
    }

    /** The origin a connector was registered under, or `undefined` if unregistered. */
    getConnectorOrigin(name: string): ConnectorOrigin | undefined {
        return this.connectors.get(name)?.origin;
    }

    /**
     * The degraded-state reason for a connector, or `undefined` when the
     * connector is `ready` (or not registered at all). Lets the
     * `connector_action` node distinguish "degraded, retrying" from "no such
     * connector/action" in its failure message (#3017).
     */
    getConnectorDegradedReason(name: string): string | undefined {
        const reg = this.connectors.get(name);
        return reg?.state === 'degraded' ? (reg.degradedReason ?? 'upstream unavailable') : undefined;
    }

    /**
     * Register a connector **provider factory** (ADR-0097 §2). A connector
     * plugin (e.g. `@objectstack/connector-openapi`) calls this at `init()` under
     * its provider key (`openapi`); the automation service then invokes the
     * factory at boot for every declarative `connectors:` entry naming that
     * provider, turning stack metadata into a live connector. Re-registering a
     * key replaces (mirrors {@link registerNodeExecutor}).
     */
    registerConnectorProvider(providerKey: string, factory: ConnectorProviderFactory): void {
        if (this.connectorProviders.has(providerKey)) {
            this.logger.warn(`Connector provider '${providerKey}' replaced`);
        }
        this.connectorProviders.set(providerKey, factory);
        this.logger.info(`Connector provider registered: ${providerKey}`);
    }

    /** Unregister a connector provider factory (hot-unplug). */
    unregisterConnectorProvider(providerKey: string): void {
        this.connectorProviders.delete(providerKey);
        this.logger.info(`Connector provider unregistered: ${providerKey}`);
    }

    /** Resolve a provider factory by key, or `undefined` when none is installed. */
    getConnectorProvider(providerKey: string): ConnectorProviderFactory | undefined {
        return this.connectorProviders.get(providerKey);
    }

    /** All registered connector-provider keys (observability / boot diagnostics). */
    getRegisteredConnectorProviders(): string[] {
        return [...this.connectorProviders.keys()];
    }

    /**
     * Get a designer-facing descriptor for every registered connector — its
     * identity plus the actions it exposes (input/output JSON Schema). Backs
     * `GET /api/v1/automation/connectors` so the designer can fill the
     * `connector_action` node's connector / action / input pickers (ADR-0022).
     * Handlers are omitted — they are runtime code, not metadata.
     */
    getConnectorDescriptors(): ConnectorDescriptor[] {
        return [...this.connectors.values()].map(({ def, origin, state, degradedReason }) => ({
            name: def.name,
            label: def.label,
            type: def.type,
            description: def.description,
            icon: def.icon,
            origin,
            state,
            degradedReason,
            actions: (def.actions ?? []).map((a) => ({
                key: a.key,
                label: a.label,
                description: a.description,
                inputSchema: a.inputSchema,
                outputSchema: a.outputSchema,
                // #4395 — the declared upstream effect travels to the designer
                // too, not only to the executor: `GET /connectors` is where a
                // flow author picks the action, and "this one writes" is a fact
                // about the pick.
                effect: a.effect,
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

    /**
     * Canonicalize a flow definition the way the load seam does — the ONE
     * policy, exposed so a caller that is not registering the flow can still
     * ask "what is this flow's canonical shape?" (#4454).
     *
     * Two consumers, two shapes, one pass — because they share every expensive
     * step and must never drift apart:
     *
     * - `parsed` is for **execution**: `FlowSchema.parse` output with the
     *   region pass applied, i.e. schema defaults materialized. This is what
     *   {@link registerFlow} runs and stores in `this.flows`.
     * - `storable` is for **persistence** (`os migrate meta --stored`, #4327):
     *   the conversion output plus the `condition` envelopes the schema lowers,
     *   and *deliberately nothing else*. Schema defaults (`version`, `runAs`,
     *   per-edge `type` / `isDefault`) are excluded on purpose — writing values
     *   the author never wrote would freeze every migrated row on today's
     *   defaults while untouched rows follow tomorrow's, i.e. two populations
     *   with different behaviour. That is exactly the drift a canonicalization
     *   pass exists to remove, so the pass must not become a source of it.
     *
     * Throws whatever the parse throws. `FlowSchema` is **strict** (#4001), so
     * a flow carrying an unrecognized key is a hard error here rather than a
     * silent drop; a caller migrating stored rows reports that row as failed
     * instead of persisting a guess.
     *
     * `todos` (#23269) are the sites the chain leaves as stored because no
     * lossless rewrite exists — above all a value slot carrying a `{…}`
     * template token, a CRUD filter operand among them, which
     * {@link registerFlow} goes on to refuse. The parse accepts such a flow, so
     * without them the stored pass would read a flow the boot refuses as on
     * protocol.
     *
     * [#23317] `todos` also carries every site {@link registerFlow} refuses
     * once the parse has accepted the flow: the same registration checks, run
     * here without registering ({@link registrationCheckRefusals}), each site
     * listed under {@link FLOW_REGISTRATION_TODO_ID}. A text slot's template
     * hole, a decision's `mode`, a malformed predicate, a plugin node's
     * undeclared config key and an `api` flow with no secret are among them.
     * A site a conversion TODO already names is not listed twice. What the
     * parse itself refuses is not a TODO: this method throws it, and the
     * stored pass reports that row `failed` with the parse's words.
     *
     * None of it changes `parsed` or `storable`, and nothing here throws for
     * it. The checks run on the first read of `todos`, so a caller that reads
     * none (the save door, a package duplication, the sync's comparison of a
     * held flow) does no more work than before. `registerFlow` reads none
     * either: it runs the same checks itself and throws the first refusal.
     *
     * [#23775, ADR-0087 addendum 2026-07-31] `options.includeRetired` — whether
     * the chain replays the entries retired from the authoring funnel
     * (`retiredFromLoadPath`). Omitted, it is `true`: a body at rest has no
     * author to teach, so every caller that hands this method a stored row, a
     * copied row or a built artifact passes nothing. `false` is the AUTHORING
     * posture `normalizeStackInput` takes: the metadata save door passes it for
     * a flow with no stored row at the save's address, so a retired spelling is
     * left in place and meets the parse refusal, with its prescription, instead
     * of being lifted. {@link registerFlow}, the rehydration seam, never passes
     * it. The default-flip ids stay excluded either way.
     */
    canonicalizeStoredFlow(name: string, definition: unknown, options: { includeRetired?: boolean } = {}): {
        parsed: FlowParsed;
        storable: unknown;
        notices: ConversionNotice[];
        todos: ConversionTodoNotice[];
    } {
        const { parsed, storable, notices, todos: chainTodos } = this.canonicalizeFlow(name, definition, options);
        // The registration checks run when `todos` is first READ, once: the
        // stored pass reads it, and the doors that only want `parsed` or
        // `storable` (the save door, a package duplication, the sync's
        // "already held?" comparison) pay nothing for a listing they discard.
        const listRegistrationRefusals = (): ConversionTodoNotice[] => {
            const todos = [...chainTodos];
            // One listing per site: a site a conversion TODO names (the value-slot
            // refusal the spec lists under its D3 entry) keeps that TODO, which
            // names the retirement; the registration check's line for it is the
            // same refusal and is not repeated.
            const listed = new Set(chainTodos.map((todo) => todo.path));
            for (const refusal of this.registrationCheckRefusals(name, parsed)) {
                for (const site of refusal.sites) {
                    if (listed.has(site.path)) continue;
                    todos.push(flowRegistrationTodo(name, site));
                }
            }
            return todos;
        };
        let listedTodos: ConversionTodoNotice[] | undefined;
        return {
            parsed,
            storable,
            notices,
            get todos(): ConversionTodoNotice[] {
                listedTodos ??= listRegistrationRefusals();
                return listedTodos;
            },
        };
    }

    /**
     * {@link canonicalizeStoredFlow}'s pass without the registration checks:
     * convert, parse, and refuse what the parse, the cycle check and the
     * region validator refuse. {@link registerFlow} calls this and then runs
     * the checks itself, so registration judges a flow once. `options` is
     * {@link canonicalizeStoredFlow}'s, and only that method passes it.
     */
    private canonicalizeFlow(name: string, definition: unknown, options: { includeRetired?: boolean } = {}): {
        parsed: FlowParsed;
        storable: unknown;
        notices: ConversionNotice[];
        todos: ConversionTodoNotice[];
    } {
        // ADR-0087 D2 — the runtime load seam. A stored flow authored against an
        // old shape (a `webhook`/`http_request` callout node, a `delete_record`
        // with `config.filters`) is canonicalized on rehydration, BEFORE parse +
        // execution, so the executor only ever sees the canonical shape and a
        // dropped-alias upgrade never silently changes behavior (e.g. an empty
        // `filter` deleting a whole table). No live executor registry is handed
        // to the pass: the one open-namespace rename, the callout rename,
        // reserves its old names instead (#23543 F5-http), and
        // `registerNodeExecutor` refuses an executor under one, so (#24001) the
        // conversion-conflict channel it used to feed is gone.
        //
        // `includeRetired` (#3903): this seam rehydrates DATA AT REST — flows
        // stored in `sys_metadata` outlive any load window, and a row written
        // under protocol N has no author for a tombstone to teach. When a flow
        // conversion graduates to `retiredFromLoadPath` (retiring at N+1), the
        // stored flows that still carry the old shape must keep canonicalizing
        // here or the retirement would silently change their behavior — the
        // exact hazard this seam exists to prevent. Authored sources keep
        // window semantics at their own seam (`normalizeStackInput` applies
        // live-window entries only; the schema tombstones the retired shape).
        // [#23775] The one caller that closes the window is the metadata save
        // door, for a flow with no stored row (an authored body, not one at
        // rest), through `canonicalizeStoredFlow`'s option; the rehydration
        // passes none and replays the full chain, as it always has.
        //
        // `excludeConversionIds`: the retired window is opened for a CLASS of
        // caller, and one kind of entry inside it is not a rescue but a
        // reinterpretation — a DEFAULT FLIP, whose old shape still parses and
        // now means something else. This seam cannot say a body predates such
        // a flip, so it refuses those entries by id, each with its reason on
        // `CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION`.
        const notices: ConversionNotice[] = [];
        const todos: ConversionTodoNotice[] = [];
        const converted = applyConversionsToFlow(definition, {
            includeRetired: options.includeRetired ?? true,
            excludeConversionIds: CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION,
            onNotice: (n) => {
                notices.push(n);
                this.logger.warn(`[flow '${name}'] ${n.code}: ${n.message}`);
            },
            // Collected, not logged: a site listed here is one `registerFlow`
            // refuses below with its own located message.
            onTodo: (t) => {
                todos.push(t);
            },
        });
        // #4347 / #4415 — one call, canonical at every depth. `FlowNodeSchema`
        // parses its own ADR-0031 regions (`FlowNodeSchema.transform` →
        // `parseFlowNodeRegions`), so what comes back here is already normalized
        // inside `loop.config.body`, `parallel.config.branches[]` and
        // `try_catch.config.try`/`.catch` — recursively. Until #4415 that needed
        // a second, separately-remembered call to `normalizeControlFlowRegions`
        // right here, and every consumer that took a `FlowParsed` without making
        // it held a half-parsed flow that looked finished.
        const parsed = FlowSchema.parse(converted);

        // DAG cycle detection
        this.detectCycles(parsed);

        // ADR-0031 — validate structured control-flow constructs (loop bodies,
        // parallel branches, try/catch regions) are well-formed (single-entry/
        // single-exit, acyclic). Reject the malformed before it can run.
        validateControlFlow(parsed);

        return {
            parsed,
            storable: graftConditionEnvelopes(converted, parsed),
            notices,
            todos,
        };
    }

    registerFlow(name: string, definition: unknown): FlowParsed {
        // One canonicalization policy, shared with the stored-row migration so
        // the two can never disagree about what "canonical" means (#4454).
        // Execution takes the parsed shape (schema defaults materialized).
        const { parsed } = this.canonicalizeFlow(name, definition);

        // ADR-0018 §M1 — node types are validated against the live action
        // registry, but NOT here: the check moved to the moment the vocabulary
        // is closed (see the end of this method and {@link
        // sealNodeTypeVocabulary}). The protocol no longer gates `type` with a
        // closed enum; membership is checked at that seam instead, and stays
        // soft-fail — a flow authored against a currently-absent plugin must
        // still register, and executeNode() throws NO_EXECUTOR at run time.

        // [#23317] Every registration check, in order, through the ONE list
        // the stored pass previews with ({@link registrationChecks}). The first
        // refusal is thrown, so a flow is refused exactly as before; a check
        // belongs in that list, never as a second call here, or the stored
        // pass would read a flow this method refuses as on protocol.
        for (const check of this.registrationChecks({ advisory: true })) {
            const refusal = check(name, parsed);
            if (refusal) throw new Error(refusal.message);
        }

        // Version history management
        const history = this.flowVersionHistory.get(name) ?? [];
        history.push({
            version: parsed.version,
            definition: parsed,
            createdAt: new Date().toISOString(),
        });
        this.flowVersionHistory.set(name, history);

        this.flows.set(name, parsed);
        // [#23316] Held now, so no longer refused — see {@link flowRefusals}.
        this.flowRefusals.delete(name);
        // Enable/disable from the persisted deployment `status`. `obsolete`/`invalid`
        // flows are DISABLED (unbound + guarded in execute); `draft`/`active` — and
        // any legacy flow with no explicit status — stay enabled, so existing flows
        // are unaffected (zero regression). This is how the Studio's on/off switch
        // persists: it flips `status` active↔obsolete, applied on the next publish
        // rebind.
        //
        // [ADR-0126 §7.2] Recording the STATUS dimension is now all this does.
        // It used to also fold that dimension into the `flowEnabled` map and
        // then work to preserve the OTHER dimension living in the same map —
        // hence the old `wasStatusDisabled || !flowEnabled.has(name)` arm,
        // whose job was to re-enable on a status flip without clobbering a
        // runtime toggle. With the activation ledger holding the toggle
        // dimension separately ({@link flowLedgerDisabled}) the two no longer
        // share a slot, so there is nothing to reconcile: a status flip moves
        // the status bit, a ledger flip moves the ledger bit, and
        // {@link isFlowEnabled} composes them. That the reconciliation
        // DISAPPEARS rather than moving is the sign the two were always
        // distinct facts crammed into one map.
        const flowStatus = (parsed as { status?: string }).status;
        this.flowStatusDisabled.set(name, flowStatus === 'obsolete' || flowStatus === 'invalid');
        this.logger.info(`Flow registered: ${name} (version ${parsed.version})`);

        // ADR-0018 §M1 node-type check, inline — but ONLY once the vocabulary
        // is closed (#4771). During boot the registry is still filling up
        // (plugins contribute executors from their own init()/start(), which
        // runs after the flow pull), so a verdict here would judge a world that
        // has not finished forming — that is what warned about every showcase
        // `approval` flow 0.8s before the `approval` executor existed. The
        // authoritative boot pass runs in sealNodeTypeVocabulary(); after it,
        // every later registration (Studio publish, dev reload, a runtime
        // registerFlow) IS against a complete vocabulary, so it warns at once.
        // Placed after the enable/disable resolution above so it can honor the
        // same "a flow that cannot run cannot fail" rule as the audit.
        if (this.nodeTypeVocabularySealed && this.isFlowEnabled(name)) {
            const known = this.knownNodeTypes();
            const unknownTypes = this.unknownNodeTypes(parsed, known);
            if (unknownTypes.length > 0) {
                this.warnUnknownNodeTypes({ flowName: name, unknownTypes, knownTypes: [...known] });
            }
        }

        // Re-bind in case the definition changed its trigger, then (re)activate.
        // [ADR-0126 §7.2] A disabled flow — ledger or status — is NOT re-armed
        // here, which is what makes the unbind survive a republish and a
        // restart: the boot pull re-registers every flow, so a hydrated ledger
        // row has to be able to keep a trigger unbound through exactly this
        // path. The refusal is `activateFlowTrigger`'s own enablement gate,
        // the one every arming path shares — ⛔ not re-asked here, where a
        // caller-side check once stood alone and `registerTrigger` had none.
        this.deactivateFlowTrigger(name);
        this.activateFlowTrigger(name);
        // [#20725, ADR-0126 §7.3] And the flows that call THIS one: a subflow
        // republished `obsolete` disarms its packaged callers, republished
        // `active` re-arms the ones the gate declined — both through the gate.
        this.rejudgeSubflowCallers(name);

        // #12206 (Option A) — hand the caller the canonicalized flow this
        // registration stored: the same object `this.flows` now holds and
        // {@link getFlow} answers. The `/automation` write doors relay it, so
        // a write answers the shape the subsequent read serves.
        return parsed;
    }

    /**
     * Unregister a flow — the `IAutomationService` removal door, which the
     * `DELETE /automation/:name` route calls.
     *
     * [#20725, ADR-0126 §7.3] REFUSED, synchronously and before anything
     * moves, while a packaged caller can still reach this packaged subflow —
     * the disable direction's refusal family (`DELETE_RESTRICTED` / 409, the
     * callers named, a step that completes), because a removed subflow breaks
     * its callers at their subflow node exactly as a disabled one does. Which
     * callers guard, and why a switched-off one is judged by the subflow's
     * own switch here, is {@link refuseUnderReachingCallers}'s `'remove'` act.
     * Only a PACKAGED subflow is guarded, for the enable direction's reason: a
     * subflow the customer authored does not hold a packaged caller's
     * removal hostage, and is theirs to remove.
     *
     * An artifact reload that no longer ships a flow does not come through
     * here: see {@link withdrawFlow}.
     *
     * @throws `DELETE_RESTRICTED` / 409 as above; nothing is removed.
     */
    unregisterFlow(name: string): void {
        const flow = this.flows.get(name);
        if (flow && this.isPackagedFlow(name)) {
            const callers = this.packagedSubflowCallers(name);
            if (callers.length > 0) this.refuseUnderReachingCallers(name, 'remove', callers, new Map());
        }
        this.withdrawFlow(name);
    }

    /**
     * Unregister a flow its own artifact no longer ships — the removal half of
     * a `metadata:reloaded` re-sync (a package upgrade or uninstall, a Studio
     * package publish, a dev reload), which is the one other caller of the
     * engine's removal.
     *
     * [#20725] ⛔ NOT guarded by ADR-0126 §7.3, and deliberately: §7.3 guards
     * an installation's or an operator's act against a vendor flow, and what
     * this removes is the vendor's own decision. A gate here could not hold
     * anything either — the next cold boot does not register a flow the
     * artifact no longer ships, whatever this method did — so refusing would
     * only delay the same state by one restart, and would make an uninstall
     * depend on the order its flows are listed in (a caller and its subflow
     * leave together, and whichever is asked first would refuse the other).
     * A package that drops a subflow its own caller still calls is a defect of
     * that package, reported at the caller's subflow node.
     */
    withdrawFlow(name: string): void {
        this.deactivateFlowTrigger(name);
        this.flows.delete(name);
        // [ADR-0126 §7.2] `flowLedgerDisabled` is deliberately NOT cleared. It
        // mirrors a durable row, and unregistering a flow does not delete that
        // row — so dropping the projection here would silently re-arm a
        // disabled packaged flow the moment it was re-registered (a hot
        // reload, a Studio publish, the next boot pull), which is the one
        // thing the durable switch exists to prevent. The projection is a Set
        // of names; a genuinely deleted flow leaves one harmless string.
        this.flowStatusDisabled.delete(name);
        this.flowVersionHistory.delete(name);
        // [#17396] Dropped with the flow, unlike `flowLedgerDisabled` above:
        // that one mirrors a DURABLE row and must survive, while this records
        // an in-process bind attempt that no longer has a subject.
        this.policyDisabledFlows.delete(name);
        this.subflowDeclinedFlows.delete(name);
        // [#23316] A withdrawal ends a refusal as it ends a registration: the
        // record's subject is gone. A host that withdraws BECAUSE it refused
        // records the refusal after this — see {@link recordFlowRefusal}.
        this.flowRefusals.delete(name);
        this.logger.info(`Flow unregistered: ${name}`);
    }

    /**
     * [#23316] Record that a host's sync handed this engine a stored flow and
     * the engine refused it, leaving nothing registered under `name` — the
     * fact {@link getFlowRegistration} answers as `refused`.
     *
     * The record keeps what the engine threw, verbatim: the error's own string
     * `code` when it set one (absent otherwise — never invented) and its
     * `message`. A later {@link registerFlow} success or a
     * {@link withdrawFlow} of the name deletes it.
     *
     * Ignored while the engine holds a registration under `name`: a refused
     * re-registration leaves the old one in place (`registerFlow` throws
     * before it changes anything), and that flow is registered, not refused.
     */
    recordFlowRefusal(name: string, error: unknown): void {
        if (this.flows.has(name)) return;
        const thrown = (error ?? {}) as { code?: unknown; message?: unknown };
        this.flowRefusals.set(name, {
            ...(typeof thrown.code === 'string' ? { code: thrown.code } : {}),
            message: typeof thrown.message === 'string' ? thrown.message : String(error),
        });
    }

    /**
     * [#23316] This engine's verdict on one flow name, for the metadata read
     * that serves it beside the stored flow — see
     * `IAutomationService.getFlowRegistration`. Total over this engine's state:
     * `registered` while {@link flows} holds the name, `refused` with the
     * recorded reason while {@link flowRefusals} does, `unregistered`
     * otherwise. A read: it records nothing.
     */
    getFlowRegistration(name: string): FlowRegistration {
        if (this.flows.has(name)) return { state: 'registered' };
        const refusal = this.flowRefusals.get(name);
        return refusal ? { state: 'refused', reason: { ...refusal } } : { state: 'unregistered' };
    }

    /**
     * Runtime enable/bound state for every registered flow — the truth behind the
     * Studio's status badges. The persisted `status` is metadata; whether a flow
     * is actually **enabled** (allowed to run) and **bound** (wired to its trigger,
     * so it fires) is engine state. `enabled: false` ⇒ status is obsolete/invalid
     * or a runtime toggle turned it off; `bound: false` on an enabled flow ⇒ it has
     * no trigger (e.g. a manually-invoked/screen flow) or its trigger type has no
     * registered trigger. `triggerType`/`object` expose the flow's declared
     * binding so hosts (CLI startup summary, kernel:bootstrapped audit) can say
     * WHY an unbound flow is unbound; `status` is the persisted deployment status.
     *
     * [#18235, ruling G item 6] `reason` carries that WHY on the row itself, for
     * the one host that cannot ask a second question: Studio's only status door
     * is `GET /automation/_status`, which passes these rows through verbatim and
     * has no access to {@link getTriggerBindingAudit}. Same sentence, same
     * eligibility, one computation — see {@link describeUnboundReason}.
     */
    getFlowRuntimeStates(): Array<{
        name: string;
        enabled: boolean;
        bound: boolean;
        status?: string;
        triggerType?: string;
        object?: string;
        reason?: string;
        unboundCause?: FlowUnboundCause;
        armedFrom?: FlowContender;
        shadowed?: FlowContender[];
    }> {
        return [...this.flows.keys()].map((name) => {
            const resolved = this.resolveTriggerBinding(name);
            // [#11997] Attach the shadowing receipt to the row an admin already
            // reads. This map holds ONE entry per bare name, so without these
            // two fields a displaced contender leaves no trace on this surface.
            const shadowing = this.flowShadowing.get(name);
            const unbound = this.describeUnboundReason(name, resolved);
            return {
                name,
                enabled: this.isFlowEnabled(name),
                bound: this.boundFlowTriggers.has(name),
                status: (this.flows.get(name) as { status?: string } | undefined)?.status,
                triggerType: resolved?.triggerType,
                object: resolved?.binding.object,
                // Absent, not `undefined`-valued: a row that is bound, disabled
                // or trigger-less has no reason to carry, and `reason: null` on
                // the wire would read as "we looked and found nothing".
                // [#23842] `unboundCause` rides the SAME spread, so the pair is
                // present together or absent together by construction.
                ...(unbound === undefined
                    ? {}
                    : { reason: unbound.reason, unboundCause: unbound.cause }),
                ...(shadowing
                    ? { armedFrom: shadowing.armed, shadowed: shadowing.shadowed }
                    : {}),
            };
        });
    }

    /**
     * [#17396 ruled item 6, #18235] The ONE place that decides why a registered
     * flow is not armed — both the status door ({@link getFlowRuntimeStates})
     * and the boot-time audit ({@link getTriggerBindingAudit}) read it, so the
     * sentence an operator sees in Studio and the one the CLI prints cannot
     * drift apart. `undefined` means this flow has no unbound reason to report:
     * it is bound, it is disabled, or it declares no trigger at all.
     *
     * [#23842] Each branch answers its sentence AND its closed
     * `FlowUnboundCause` together, so the status door can let a consumer
     * classify a row without parsing the sentence — one value per branch,
     * stamped where the branch is decided, never inferred from the text.
     *
     * The POLICY branch outranks both binding branches, and deliberately so.
     * When package-authored scheduled work is off, neither of the other two
     * reasons is true in any useful sense: the trigger was never called, so
     * nothing "failed", and registering the missing trigger would change
     * nothing, so "add requires: ['triggers']" is a remedy that does not work.
     * ⛔ Never reported as "binding failed" — a binding failure is a defect with
     * an engineering remedy, while this is a deployment policy with an operator
     * remedy, and the two send the reader to different places.
     *
     * ⛔ Read from the RECORD, never re-derived from the environment here.
     * Re-deriving was the first spelling and it was measured wrong: both
     * callers run long after the bind, so an environment that moved in
     * between — an operator setting the switch, a test restoring it — makes
     * this report *binding failed* for a flow whose trigger was never called.
     * The record says what HAPPENED; `activateFlowTrigger` clears it the moment
     * the flow gets past the gate. [#21110] And it holds the SENTENCE, not just
     * the fact: `scheduledWorkDisabledReason` of the policy reading that
     * refused, so a host-injected OFF reports the host's reason here and the
     * deployment switch's sentence is reported only where that switch decided.
     *
     * @param resolved the caller's already-resolved binding, so neither door
     *   pays for a second {@link resolveTriggerBinding} on the same row.
     */
    private describeUnboundReason(
        name: string,
        resolved: { triggerType: string } | undefined,
    ): { reason: string; cause: FlowUnboundCause } | undefined {
        if (!resolved) return undefined; // manual / screen flow — nothing to bind
        if (!this.isFlowEnabled(name)) return undefined;
        if (this.boundFlowTriggers.has(name)) return undefined;
        const policyReason = this.policyDisabledFlows.get(name);
        if (policyReason !== undefined) return { reason: policyReason, cause: 'deployment_policy' };
        // [#20725, ADR-0126 §7.3] The arming gate declined it onto a disabled
        // packaged subflow — read from the record, for the policy line's
        // reason, and ahead of the trigger branches for the gate's: with the
        // child off, the trigger would not arm it either.
        const declined = this.subflowDeclinedFlows.get(name);
        if (declined !== undefined) return { reason: declined, cause: 'disabled_subflow' };
        return this.triggers.has(resolved.triggerType)
            ? {
                reason: `trigger '${resolved.triggerType}' is registered but binding failed — see earlier warnings`,
                cause: 'binding_failure',
            }
            : {
                reason: `no '${resolved.triggerType}' trigger is registered — add requires: ['triggers'] (record_change/schedule/time_relative/api ship in @objectstack/trigger-*)`,
                cause: 'missing_trigger',
            };
    }

    /**
     * Silent-miss audit (2026-07-17 third-party eval): every ENABLED flow that
     * declares an auto-launch trigger but is not bound to one, with the reason.
     * Empty when every triggered flow is wired. Hosts surface this after
     * bootstrap — the automation plugin warns per entry at kernel:bootstrapped,
     * and the CLI prints it in the startup summary (the boot-quiet stdout
     * window swallows plain warn/info logs, so the summary is the reliable
     * channel in `os dev` / `os start`).
     */
    getTriggerBindingAudit(): Array<{ flowName: string; triggerType: string; reason: string }> {
        const audit: Array<{ flowName: string; triggerType: string; reason: string }> = [];
        for (const name of this.flows.keys()) {
            const resolved = this.resolveTriggerBinding(name);
            // [#18235] The eligibility rules (enabled, unbound, declares a
            // trigger) and the three-branch vocabulary both live in
            // `describeUnboundReason` now, so this audit and the status door
            // report the SAME sentence for the same flow by construction.
            const unbound = this.describeUnboundReason(name, resolved);
            if (unbound === undefined || !resolved) continue;
            audit.push({ flowName: name, triggerType: resolved.triggerType, reason: unbound.reason });
        }
        return audit;
    }

    /**
     * [#11997] Record what the ADR-0005 overlay precedence decided for one bare
     * name. Called by the boot pull when a name had more than one contender.
     *
     * Purely a receipt: it does not arm, disarm, or reorder anything. The pull
     * has already registered the winner through the normal
     * {@link registerFlow} path by the time this is called.
     */
    recordFlowShadowing(record: FlowShadowingRecord): void {
        if (!record.shadowed.length) return;
        this.flowShadowing.set(record.name, record);
    }

    /**
     * [#11997] Admin-visible receipt: every bare flow name that had more than
     * one contender at boot, which body is armed, and which were shadowed.
     *
     * Empty when no name collided — the normal case. Without this the shadowed
     * flow is unobservable: {@link listFlows} and {@link getFlowRuntimeStates}
     * both enumerate a map that holds one entry per name by construction, so a
     * packaged flow displaced by a same-named runtime overlay simply is not
     * there to be listed.
     */
    getShadowedFlows(): FlowShadowingRecord[] {
        return [...this.flowShadowing.values()];
    }

    async listFlows(): Promise<string[]> {
        return [...this.flows.keys()];
    }

    async getFlow(name: string): Promise<FlowParsed | null> {
        return this.flows.get(name) ?? null;
    }

    /**
     * Attach the durable activation ledger (ADR-0126 §4). Hosts call this at
     * start(), after ObjectQL is available; see the automation plugin.
     */
    setFlowActivationStore(store: FlowActivationStore): void {
        this.flowActivationStore = store;
    }

    /**
     * [#20761, ADR-0126 §7.2 / §7.3] Attach the reader over THE LOADER'S SET —
     * the one server-held fact of which flows are packaged. Hosts call this at
     * start(); the automation plugin hands over a reader that asks the metadata
     * protocol's `packagedArtifactOwner` at question time, which answers from
     * the entries the artifact loader registered — the same set the protocol's
     * locked-base verdict reads.
     *
     * For a flow, "packaged" means exactly "loaded by the loader from a managed
     * package". Every classification this engine makes — the §7.3 subflow
     * guards in both directions, the arming gate, the activation door, and the
     * package the activation row is attributed to — reads {@link
     * packagedFlowOwner}, and so this reader. ⛔ Never the stamps a definition
     * carries: a definition reaches {@link registerFlow} through authoring doors
     * too, and its `_packageId` / `_provenance` are the caller's bytes. They are
     * kept on the definition for display only.
     */
    setPackagedFlowSource(source: PackagedFlowSource | undefined): void {
        this.packagedFlowSource = source;
    }

    /**
     * [#20761] The package that ships the flow `name`, per the loader's set
     * ({@link setPackagedFlowSource}); `undefined` for a flow authored in this
     * deployment — and for every flow while no reader is attached.
     */
    packagedFlowOwner(name: string): string | undefined {
        const owner = this.packagedFlowSource?.(name);
        return typeof owner === 'string' && owner !== '' ? owner : undefined;
    }

    /** [#20761] Is `name` a packaged flow — {@link packagedFlowOwner}, as a verdict. */
    private isPackagedFlow(name: string): boolean {
        return this.packagedFlowOwner(name) !== undefined;
    }

    /**
     * [#20790] Attach the write-only flow credential channel. The automation
     * plugin calls this at `init()`, before any flow is registered. With none
     * attached (a bare engine) every credential is the literal its definition
     * carries, as before.
     */
    setFlowCredentialSource(source: FlowCredentialSource | undefined): void {
        this.flowCredentialSource = source;
    }

    /**
     * [#20281 stage ③] Attach the connector sync executor this engine serves as
     * {@link pullConnectorSource}. The automation plugin calls this at
     * `init()`, before it registers the engine as the `automation` service:
     * the executor resolves connectors against the instances the PLUGIN
     * materialized, which the engine does not hold, so the plugin hands the
     * engine the call rather than the map.
     */
    /**
     * [#22450] Attach a reader of the `i18n` service, through which a refusing
     * `end` node picks its translated message
     * (`flows.<flow>.refusals.<node_id>.message`) in the run's locale. The
     * automation plugin calls this at `init()` with a reader that asks the
     * kernel at QUESTION time, the bridge objectql takes for its validation
     * messages made lazy: the `i18n` provider may register after this plugin
     * starts, and a reading taken at boot would record its absence for good.
     * With none attached (a bare engine), or one that answers nothing, every
     * refusal renders its authored message.
     */
    setI18nServiceSource(source: (() => RefusalI18nService | undefined) | undefined): void {
        this.i18nServiceSource = source;
    }

    setConnectorPullSource(
        source: ((request: ConnectorSourcePullRequest) => Promise<ConnectorSourcePullResult>) | undefined,
    ): void {
        this.connectorPullSource = source;
    }

    /**
     * [#20281 stage ③] `IAutomationService.pullConnectorSource` — pull one
     * `mapping`'s `connectorSource` and write the records through the import
     * runner, under `request.context`. The door a job's `pull` run form binds
     * through. Rejects, naming the gap, on an engine no plugin attached an
     * executor to: there is nothing that could pull, and answering as if a
     * pull ran would be the silent no-op the contract's rejection rule exists
     * to rule out.
     */
    async pullConnectorSource(request: ConnectorSourcePullRequest): Promise<ConnectorSourcePullResult> {
        if (!this.connectorPullSource) {
            // ADR-0112: the code the executor itself answers for "cannot pull
            // now" (a degraded connector), so a caller branches on one pair.
            throw Object.assign(
                new Error(
                    `[Automation] pullConnectorSource('${request.mapping}'): this automation engine has no connector sync `
                    + 'executor attached — it is attached by AutomationServicePlugin at init(); a bare engine cannot pull. Nothing was pulled.',
                ),
                { code: 'SERVICE_UNAVAILABLE', status: 503 },
            );
        }
        return this.connectorPullSource(request);
    }

    /** [#20790] Does the credential channel hold the LIVE credential at this position? */
    holdsFlowCredential(flowName: string, nodeId: string, key: string): boolean {
        return this.flowCredentialSource?.holds(flowName, nodeId, key) ?? false;
    }

    /**
     * [#20790] The credential the channel holds at this position, read now.
     * `undefined` when it holds none; throws when it holds one that does not
     * come back (see {@link FlowCredentialSource.resolve}).
     */
    async resolveFlowCredential(flowName: string, nodeId: string, key: string): Promise<string | undefined> {
        if (!this.flowCredentialSource) return undefined;
        return this.flowCredentialSource.resolve(flowName, nodeId, key);
    }

    /**
     * [#20790] Every credential the registered flow `name` holds, by class —
     * a literal in its definition, or one the channel holds for one of its
     * credential positions. `[]` for an unknown name. The clone door's input:
     * a flow that holds any credential is never cloned in one step, because a
     * copy would share it.
     */
    flowCredentialHoldings(name: string): FlowCredentialHolding[] {
        const flow = this.flows.get(name);
        if (!flow) return [];
        const out: FlowCredentialHolding[] = [];
        const seen = new Set<string>();
        for (const position of flowCredentialPositions(flow)) {
            const id = JSON.stringify([position.nodeId, position.key]);
            if (position.form === 'value') {
                seen.add(id);
                out.push({ nodeId: position.nodeId, key: position.key, label: flowCredentialClassLabel(position.key), held: 'literal' });
            }
        }
        for (const { nodeId, key } of this.flowCredentialSource?.held(name) ?? []) {
            const id = JSON.stringify([nodeId, key]);
            if (seen.has(id)) continue;
            out.push({ nodeId, key, label: flowCredentialClassLabel(key), held: 'channel' });
        }
        return out;
    }

    /**
     * [#20790] The verification-time reader for an `api` flow's hook secret, or
     * `undefined` when the flow has none to verify with — the binding then
     * carries no resolver and both registration doors refuse it, exactly as
     * before.
     *
     * Q3 A, as ruled: a packaged flow's literal stays its author's source of
     * truth, and at verification the channel's row wins where one exists. So
     * a LITERAL start-node secret yields a reader that asks the channel only
     * when the channel's index says it holds that position (the `http` node's
     * shape — both doors read one rule), and otherwise answers the literal
     * without touching the channel; a WITHHELD one (the key absent — every
     * flow stored through the metadata save door) yields one only when the
     * channel holds it; a cleared or unusable one yields none.
     *
     * A HELD secret that does not come back still rejects — it is never
     * verified against the literal. The index is per process: a row written
     * after its last refresh (boot, `kernel:ready`, `metadata:reloaded`, every
     * channel write in this process) loses to the literal until the next
     * refresh, exactly as at the `http` node.
     */
    private hookSecretResolver(
        flowName: string,
        startNodeId: string | undefined,
        config: Record<string, unknown>,
    ): (() => Promise<string | undefined>) | undefined {
        const source = this.flowCredentialSource;
        const written = Object.prototype.hasOwnProperty.call(config, FLOW_HOOK_SECRET_KEY);
        const literal = typeof config.secret === 'string' && config.secret.trim() !== '' ? config.secret : undefined;
        if (written && literal === undefined) return undefined;
        if (!source || startNodeId === undefined) {
            return literal === undefined ? undefined : async () => literal;
        }
        if (literal === undefined && !source.holds(flowName, startNodeId, FLOW_HOOK_SECRET_KEY)) return undefined;
        return async () => {
            if (literal !== undefined && !source.holds(flowName, startNodeId, FLOW_HOOK_SECRET_KEY)) return literal;
            return (await source.resolve(flowName, startNodeId, FLOW_HOOK_SECRET_KEY)) ?? literal;
        };
    }

    /**
     * [ADR-0126 §7.2] Load the ledger into {@link flowLedgerDisabled}.
     *
     * Called once at boot, AFTER the flow pull, because the projection decides
     * whether a flow's trigger is armed and re-arming happens per
     * {@link registerFlow}. Returns the names it disarmed so the host can say
     * so in its bootstrap audit.
     *
     * An empty ledger — the stock-boot case — disarms nothing and rebinds
     * nothing, which is §4's "an empty ledger changes nothing anywhere".
     */
    async hydrateFlowActivations(): Promise<string[]> {
        if (!this.flowActivationStore) return [];
        const rows = await this.flowActivationStore.list();
        const disabled: string[] = [];
        for (const row of rows) {
            if (row.active) {
                this.flowLedgerDisabled.delete(row.name);
                continue;
            }
            this.flowLedgerDisabled.add(row.name);
            // Only a flow this engine actually holds can be unbound; a row for
            // a flow this deployment does not ship is kept in the projection
            // (it costs one string, and the flow may be registered later by a
            // hot reload) but has nothing to disarm now.
            if (this.flows.has(row.name)) {
                this.deactivateFlowTrigger(row.name);
                disabled.push(row.name);
            }
        }
        // [#20725, ADR-0126 §7.3] The callers of what the ledger just switched
        // off go back to the arming gate. On a stock boot none is armed yet
        // (the trigger plugins register at kernel:ready, and the gate judges
        // them then), so this changes nothing there; a host whose trigger was
        // registered before the pull would otherwise keep a caller armed onto
        // a subflow this read has just switched off.
        for (const name of disabled) this.rejudgeSubflowCallers(name);
        return disabled;
    }

    /**
     * Is this flow allowed to run — the composition of the two INDEPENDENT
     * disable dimensions.
     *
     * `flowStatusDisabled` is the authoring state (`obsolete` / `invalid`),
     * owned by the definition. `flowLedgerDisabled` is the installation's
     * activation choice (ADR-0126 §4), owned by `sys_metadata_activation`.
     * Either one disarms; neither can override the other, because they answer
     * different questions and an "override" would mean one silently undoing a
     * decision it does not own.
     */
    private isFlowEnabled(name: string): boolean {
        return this.flowStatusDisabled.get(name) !== true && !this.flowLedgerDisabled.has(name);
    }

    /**
     * The `FLOW_DISABLED` refusal MESSAGE, which is where the ledger-vs-status
     * distinction rides (ADR-0126 §7.2 reuses the CODE deliberately, so the
     * message is the only channel left).
     */
    private describeDisabledFlow(flowName: string): string {
        if (this.flowLedgerDisabled.has(flowName)) {
            return (
                `Flow '${flowName}' is disabled — it is switched off for this installation in the ` +
                `packaged-metadata activation ledger (sys_metadata_activation, ADR-0126 §7.2). ` +
                `Re-enable the packaged flow to arm it again, or run a clone of it under a new name.`
            );
        }
        // Unchanged wording for the status dimension: it is what every existing
        // consumer and test reads, and this leg has no reason to move it.
        return `Flow '${flowName}' is disabled`;
    }

    /**
     * [ADR-0126 §7.3] The flow names `flow` invokes as a subflow — the ONE
     * reading of "flow A calls flow B" that both directions of the subflow
     * guard share ({@link packagedSubflowCallers} on disable,
     * {@link disabledPackagedSubflows} on enable), so the two can never
     * disagree about which pairs exist.
     *
     * A DEFINITION SCAN — ⛔ deliberately not an index. ADR-0126 §9 records
     * that no reference index exists and that building one is not chartered
     * (#11665 §3.2); the flow map is small, the guard runs once per flip, and
     * an index would be a durable structure to keep correct forever for a
     * check that happens when an administrator clicks a switch.
     *
     * Two node types invoke another flow by name, and BOTH count: `subflow`
     * (config.flowName) and `map`, whose own descriptor calls its per-item
     * target "the per-item subflow" and reaches it through the same
     * `engine.execute`. Scanning only `subflow` would let a `map` caller break
     * exactly the way §7.3 exists to prevent.
     *
     * ⛔ The historical `flow` alias for `config.flowName` is NOT read here.
     * ADR-0087 D2's conversion `flow-node-subflow-flow-alias` canonicalizes it
     * at load, so only the canonical key reaches a registered definition;
     * re-reading the alias in this consumer would be a tolerant fallback
     * papering over a producer that is already correct.
     */
    private subflowTargets(flow: FlowParsed): string[] {
        const nodes = (flow as { nodes?: unknown }).nodes;
        if (!Array.isArray(nodes)) return [];
        const targets: string[] = [];
        for (const node of nodes) {
            const n = node as { type?: unknown; config?: { flowName?: unknown } } | null;
            if (!n || (n.type !== 'subflow' && n.type !== 'map')) continue;
            if (typeof n.config?.flowName === 'string') targets.push(n.config.flowName);
        }
        return targets;
    }

    /**
     * [ADR-0126 §7.3] Packaged flows that invoke `name` as a subflow — the
     * callers the DISABLE direction of the guard judges.
     *
     * Only PACKAGED callers are reported: §7.3's rationale is that a VENDOR
     * flow would break mid-run at its subflow node. A caller the customer
     * authored is theirs to fix, and refusing on it would make the packaged
     * artifact hostage to a tenant's own flow.
     *
     * Every packaged caller is reported, whatever its own activation state.
     * Which of them still GUARD — can still reach the subflow node — is
     * {@link refuseUnderReachingCallers}'s question, not this scan's.
     */
    private packagedSubflowCallers(name: string): string[] {
        const callers: string[] = [];
        for (const [callerName, flow] of this.flows) {
            if (callerName === name) continue;
            if (!this.isPackagedFlow(callerName)) continue;
            if (this.subflowTargets(flow).includes(name)) callers.push(callerName);
        }
        return callers;
    }

    /**
     * [ADR-0126 §7.3] The runs each of `flowNames` holds PARKED — suspended
     * and resumable — read from BOTH run stores: this process's hot cache and
     * the durable {@link SuspendedRunStore}, including a run a previous
     * process parked that this one has never loaded.
     *
     * The ONE answer the disable direction of the subflow guard takes, for its
     * verdict and for its refusal text alike
     * ({@link refuseUnderReachingCallers}), so the runs a refusal names
     * are exactly the runs that made it refuse.
     *
     * Read through {@link readSuspendedRuns}, the same merge
     * {@link listSuspendedRunsDurable} serves, with one difference: an
     * enumeration that FAILS throws here instead of degrading to the cache.
     * The listing is an operability read and says so in a warning; this
     * answer decides a write, and "the store could not say" is not "no parked
     * run" — read as one, it would let a disable land under a run a previous
     * process parked, the exact mid-run failure §7.3 refuses.
     *
     * [#20725] And it asks for THESE flows' runs, every one of them, rather
     * than reading the deployment-wide listing: that listing is one capped page
     * of paused rows, and a guard deciding on a caller's absence from it would
     * accept a disable whenever the caller's run fell past the page.
     *
     * A run that has ENDED — completed, failed, refused, cancelled — is not in
     * either store, so it never counts.
     */
    private async parkedRunsOf(flowNames: ReadonlySet<string>): Promise<Map<string, string[]>> {
        const parked = new Map<string, string[]>();
        if (flowNames.size === 0) return parked;
        for (const run of await this.readSuspendedRuns('throw', flowNames)) {
            if (!flowNames.has(run.flowName)) continue;
            parked.set(run.flowName, [...(parked.get(run.flowName) ?? []), run.runId]);
        }
        for (const runIds of parked.values()) runIds.sort();
        return parked;
    }

    /**
     * [ADR-0126 §7.3, the disable direction] Refuse switching `name` off while
     * a packaged flow can still REACH it as a subflow, naming each such caller
     * and the step that lets the disable complete.
     *
     * Reachability, not the caller's switch — triage's answer A on #20678,
     * the reading of §7.3's own rationale. Switching a caller off stops its
     * NEW runs only: a run it had already parked — at a `wait`, an `approval`,
     * a `screen`, or at a `map` node between two items — resumes through
     * {@link resume}, which does not consult activation, and walks on into its
     * subflow node. So a packaged caller guards when:
     *  - it is ENABLED ({@link isFlowEnabled}) — the step is to disable it; or
     *  - it is disabled, by the ledger or by its definition's `status` alike,
     *    and holds a parked run ({@link parkedRunsOf}) — the step is to cancel
     *    each named run through the operator cancel door (ADR-0044) or to let
     *    it finish.
     * A disabled caller with no parked run cannot reach the node, and does not
     * guard.
     *
     * `parked` is {@link parkedRunsOf} over the switched-off `callers`, read by
     * {@link toggleFlow} only when there is one to judge — so a flow whose
     * callers are all armed never touches the run stores, and awaits nothing
     * it did not await before.
     *
     * ## [#20725] The removal door, through the same family
     *
     * `act: 'remove'` is {@link unregisterFlow} — the `DELETE /automation/:name`
     * door, synchronous by the `IAutomationService.unregisterFlow` contract, so
     * it cannot await {@link parkedRunsOf} and passes no `parked`. It decides
     * the same reachability without that read:
     *  - an ENABLED caller reaches `name` — the step is to disable it first,
     *    exactly as on the disable door;
     *  - a switched-off caller reaches `name` only through a parked run, and a
     *    run that resumes into a DISABLED `name` already fails on its refusal —
     *    so once `name` is switched off, removing it breaks nothing that was
     *    not already broken, and a switched-off caller does not guard;
     *  - while `name` is still ENABLED, whether a switched-off caller holds a
     *    parked run is the one question this door cannot read. It does not
     *    guess and it does not read a second way: the step it names is the
     *    disable door, which reads that answer completely (both run stores,
     *    every run of the named callers) and names each run to cancel — and
     *    once that door has switched `name` off, the removal completes.
     * ⛔ No second reading of "who reaches this subflow": the callers are
     * {@link packagedSubflowCallers}, "armed" is {@link isFlowEnabled}, and the
     * parked-run question is left to the one door that asks it.
     *
     * ADR-0112 envelope unchanged: `DELETE_RESTRICTED` / 409, and
     * `subflowCallers` lists exactly the callers that guard.
     */
    private refuseUnderReachingCallers(
        name: string,
        act: 'disable' | 'remove',
        callers: string[],
        parked: ReadonlyMap<string, string[]>,
    ): void {
        const armed = callers.filter((c) => this.isFlowEnabled(c));
        // Removal only: a switched-off caller guards while `name` is enabled,
        // because whether it still holds a parked run is not readable here.
        const switchOffFirst = act === 'remove' && this.isFlowEnabled(name);
        const unread = switchOffFirst ? callers.filter((c) => !armed.includes(c)) : [];
        const guarding = callers.filter((c) => armed.includes(c) || parked.has(c) || unread.includes(c));
        if (guarding.length === 0) return;

        const quote = (names: string[]) => names.map((n) => `'${n}'`).join(', ');
        const one = guarding.length === 1;
        const steps = [
            ...(armed.length > 0 ? [`disable the calling flow${armed.length === 1 ? '' : 's'} ${quote(armed)} first`] : []),
            ...[...parked].map(([caller, runIds]) => {
                const single = runIds.length === 1;
                return (
                    `'${caller}' is disabled but still holds ${single ? 'a parked run' : `${runIds.length} parked runs`} ` +
                    `that ${single ? 'resumes' : 'resume'} into its subflow node (${quote(runIds)}): cancel ` +
                    `${single ? 'it' : 'each'} through the operator cancel door, ` +
                    `POST /automation/${caller}/runs/:runId/cancel (ADR-0044), or let ${single ? 'it' : 'them'} finish`
                );
            }),
            ...(!switchOffFirst
                ? []
                : armed.length > 0
                  ? [
                        `then switch '${name}' off, which reads whether a switched-off caller still holds a parked ` +
                            `run and names each one to cancel, and remove it after that`,
                    ]
                  : [
                        `switch '${name}' off first, which reads whether ${quote(unread)} still ` +
                            `hold${unread.length === 1 ? 's' : ''} a parked run and names each one to cancel, then remove it`,
                    ]),
        ].join('; ');
        const [verb, gerund, keep] = act === 'disable'
            ? ['disabled', 'Disabling', 'leave this one armed']
            : ['removed', 'Removing', 'leave this one registered'];
        throw Object.assign(
            new Error(
                `Flow '${name}' cannot be ${verb} while ${guarding.length} packaged flow${one ? '' : 's'} ` +
                    `still call${one ? 's' : ''} it as a subflow: ${quote(guarding)}. ${gerund} it would break ` +
                    `${one ? 'that caller' : 'those callers'} mid-run at ${one ? 'its' : 'their'} subflow node with a ` +
                    `late, inexplicable failure (ADR-0126 §7.3). ` +
                    `${steps.charAt(0).toUpperCase()}${steps.slice(1)} — or ${keep}.`,
            ),
            // ADR-0112 envelope: code AND status. `DELETE_RESTRICTED` is the
            // standard catalog's "cannot do this due to dependencies" member
            // (409) — ⛔ no new ledger entry is minted here. Its `DELETE_`
            // prefix fits because the toggle ruling (commit 266436a7f,
            // recorded at `isFlowAuthoringWrite` in the runtime's automation
            // domain) holds that "disabling a shipped flow is functionally
            // equivalent to deleting it for as long as it stays off".
            { code: 'DELETE_RESTRICTED', status: 409, subflowCallers: guarding },
        );
    }

    /**
     * [ADR-0126 §7.3, the enable direction] The packaged subflows a packaged
     * flow `name` calls that may not run now ({@link isFlowEnabled}), each
     * with the disable dimension(s) holding it off — the enable direction of
     * the guard refuses on these, because a caller re-armed onto a disabled
     * child fails at its subflow node on the child's `FLOW_DISABLED`: the same
     * late, inexplicable failure the disable direction refuses to cause.
     *
     * Both dimensions are reported, not just the verdict, because the remedy
     * differs and a refusal must prescribe one the caller can complete: the
     * activation switch moves only the LEDGER bit, so "enable the subflow
     * first" re-arms a ledger-disabled child and does nothing for one whose
     * definition's `status` disables it.
     *
     * ⛔ A child in a CYCLE of switched-off flows with `name` is not reported.
     * Enabling that child goes through this same guard, which would refuse it
     * on the chain leading back to `name` — so every order is refused and no
     * sequence the refusal could name completes. Only a chain of LEDGER-
     * disabled flows closes that loop: a status-disabled link is re-armed by
     * publishing its definition, a door this guard does not sit on, and an
     * enabled link does not refuse at all.
     *
     * ⛔ And the exemption answers the LEDGER bit only, so it is asked only of
     * a child whose status does not disable it too. A child disabled BOTH ways
     * inside such a cycle is still reported: no enable order re-arms a status,
     * so the cycle is no reason to leave its publish remedy unnamed — and
     * skipping it would arm the caller onto a child that stays disabled.
     *
     * ⛔ [#20725] And only while `name` ITSELF is ledger-disabled — the one
     * state in which the loop closes. The arming gate
     * ({@link declineOntoDisabledSubflows}) asks this same question of a flow
     * it is about to arm, which is ENABLED: enabling its child then refuses
     * nothing on the chain back to it, so no order is blocked, and exempting
     * the child would arm the caller onto it. In the enable direction `name`
     * is always ledger-disabled here ({@link refuseEnableOntoDisabledSubflow}
     * returns before asking otherwise), so what that door answers is unchanged.
     */
    private disabledPackagedSubflows(name: string): Array<{ name: string; ledger: boolean; status?: string }> {
        const flow = this.flows.get(name);
        if (!flow) return [];
        const loopCanClose = this.flowLedgerDisabled.has(name);
        const disabled: Array<{ name: string; ledger: boolean; status?: string }> = [];
        for (const target of new Set(this.subflowTargets(flow))) {
            const child = this.flows.get(target);
            if (!child || !this.isPackagedFlow(target)) continue;
            if (this.isFlowEnabled(target)) continue;
            const ledger = this.flowLedgerDisabled.has(target);
            const statusDisabled = this.flowStatusDisabled.get(target) === true;
            if (loopCanClose && ledger && !statusDisabled && this.ledgerDisabledChainReaches(target, name)) continue;
            const status = statusDisabled ? String((child as { status?: unknown }).status) : undefined;
            disabled.push({ name: target, ledger, ...(status !== undefined ? { status } : {}) });
        }
        return disabled;
    }

    /**
     * Whether `to` is reachable from `from` along packaged subflow calls
     * whose every intermediate flow is ledger-disabled — the loop
     * {@link disabledPackagedSubflows} must not guard on.
     */
    private ledgerDisabledChainReaches(from: string, to: string): boolean {
        const seen = new Set<string>([from]);
        const pending = [from];
        while (pending.length > 0) {
            const flow = this.flows.get(pending.pop()!);
            if (!flow) continue;
            for (const target of this.subflowTargets(flow)) {
                if (target === to) return true;
                if (seen.has(target) || !this.flowLedgerDisabled.has(target)) continue;
                const next = this.flows.get(target);
                if (!next || !this.isPackagedFlow(target)) continue;
                seen.add(target);
                pending.push(target);
            }
        }
        return false;
    }

    /**
     * [ADR-0126 §7.3, the enable direction] Refuse re-arming a packaged caller
     * onto a packaged subflow that may not run, naming each child and the
     * remedy its real state admits.
     *
     * Only a RE-enable is judged: a flow the ledger holds off. Enabling a flow
     * that is already armed re-arms nothing, and refusing it would report a
     * running flow as one that "cannot be enabled". Only a PACKAGED caller is
     * judged, for the disable direction's reason: a flow the customer
     * authored is theirs to arm.
     *
     * ADR-0112 envelope: code AND status. `RESOURCE_CONFLICT` (409) is the
     * standard catalog's generic "the request conflicts with the resource's
     * current state" member — ⛔ no new ledger entry is minted. Not the
     * disable direction's `DELETE_RESTRICTED`: its `DELETE_` prefix rests on
     * disabling a shipped flow being equivalent to deleting it, and enabling
     * is the opposite act.
     */
    private refuseEnableOntoDisabledSubflow(name: string): void {
        if (!this.flowLedgerDisabled.has(name)) return;
        if (!this.isPackagedFlow(name)) return;
        const disabled = this.disabledPackagedSubflows(name);
        if (disabled.length === 0) return;

        const { reasons, remedy } = this.describeDisabledSubflows(disabled, 'this switch');
        const many = disabled.length !== 1;
        throw Object.assign(
            new Error(
                `Flow '${name}' cannot be enabled while ${disabled.length} packaged subflow${many ? 's' : ''} it calls ` +
                    `${many ? 'are' : 'is'} disabled: ${reasons.join(', ')}. Enabled, it would fail at its subflow node ` +
                    `on a disabled child — the late, inexplicable failure ADR-0126 §7.3 refuses to cause. ` +
                    `${remedy.charAt(0).toUpperCase()}${remedy.slice(1)} first, then enable this flow — or leave it disabled.`,
            ),
            { code: 'RESOURCE_CONFLICT', status: 409 },
        );
    }

    /**
     * [ADR-0126 §7.3] Each disabled subflow with the dimension(s) holding it
     * off, and the remedy its REAL state admits — ONE wording for the enable
     * refusal ({@link refuseEnableOntoDisabledSubflow}) and the arming gate's
     * warning and `/_status` reason ({@link declineOntoDisabledSubflows}), so
     * no two of them can name different steps for the same child.
     *
     * `switchPhrase` names the activation switch as the reader meets it: "this
     * switch" to the administrator who just used it, "the activation switch"
     * everywhere else.
     */
    private describeDisabledSubflows(
        disabled: Array<{ name: string; ledger: boolean; status?: string }>,
        switchPhrase: 'this switch' | 'the activation switch',
    ): { reasons: string[]; remedy: string } {
        const quote = (names: string[]) =>
            names.length === 1
                ? `'${names[0]}'`
                : `${names.slice(0, -1).map((n) => `'${n}'`).join(', ')} and '${names[names.length - 1]}'`;
        const reasons = disabled.map((d) => {
            const why = [
                ...(d.ledger ? ['switched off in the activation ledger'] : []),
                ...(d.status !== undefined ? [`its definition's status is '${d.status}'`] : []),
            ].join(', and ');
            return `'${d.name}' (${why})`;
        });
        // The remedy follows each child's REAL state: the switch re-arms the
        // ledger bit, and only the definition moves a status.
        const byStatus = disabled.filter((d) => d.status !== undefined).map((d) => d.name);
        const byLedger = disabled.filter((d) => d.ledger).map((d) => d.name);
        const remedy = [
            ...(byStatus.length > 0
                ? [
                      `publish ${quote(byStatus)} with status 'active' (${switchPhrase} never changes a definition's ` +
                          `status; for a package that is read-only here, that takes a package version that ships ` +
                          `${byStatus.length === 1 ? 'it' : 'them'} active)`,
                  ]
                : []),
            ...(byLedger.length > 0 ? [`enable ${quote(byLedger)}`] : []),
        ].join(' and ');
        return { reasons, remedy };
    }

    /**
     * [#20725, ADR-0126 §7.3] The arming gate's subflow half, asked by
     * {@link activateFlowTrigger} of an ENABLED flow it is about to arm: is it
     * a packaged caller of a packaged subflow that is disabled? Then it is
     * declined — recorded on {@link subflowDeclinedFlows} for `/_status` and
     * the binding audit, and said once as a `warn` naming each subflow and the
     * step that re-arms it.
     *
     * "Disabled" is {@link disabledPackagedSubflows}, the SAME reading the
     * enable refusal takes — ⛔ no second reading of "A calls B": a `subflow`
     * or `map` target that is ledger-disabled OR status-disabled, the child
     * and the caller both packaged. Its cycle exemption never applies here,
     * because the flow being armed is enabled (see that method).
     *
     * #4632 verdict: FUNCTIONAL — `warn`. A flow is visibly smaller than
     * declared (its trigger is not armed), `/_status` reports it `bound: false`
     * with this reason, and nothing claimed-persisted is lost. Said once per
     * decline: a re-registration that declines the flow for the same subflows
     * (a hot reload, the kernel:ready re-bind) records it without repeating it.
     *
     * @returns `true` when the flow is declined and must not be armed.
     */
    private declineOntoDisabledSubflows(flowName: string, triggerType: string): boolean {
        const flow = this.flows.get(flowName);
        const disabled = flow && this.isPackagedFlow(flowName)
            ? this.disabledPackagedSubflows(flowName)
            : [];
        if (disabled.length === 0) {
            this.subflowDeclinedFlows.delete(flowName);
            return false;
        }
        const { reasons, remedy } = this.describeDisabledSubflows(disabled, 'the activation switch');
        const many = disabled.length !== 1;
        const reason =
            `not armed while the packaged subflow${many ? 's' : ''} it calls ${many ? 'are' : 'is'} disabled — ` +
            `${reasons.join(', ')}; ${remedy} and it is armed (ADR-0126 §7.3)`;
        const previous = this.subflowDeclinedFlows.get(flowName);
        this.subflowDeclinedFlows.set(flowName, reason);
        if (previous === reason) return true;
        this.logger.warn(
            `Flow '${flowName}' is registered but NOT armed on trigger '${triggerType}' — ${disabled.length} packaged ` +
                `subflow${many ? 's' : ''} it calls ${many ? 'are' : 'is'} disabled: ${reasons.join(', ')}. Armed, it ` +
                `would fail at its subflow node on a disabled child — the late, inexplicable failure ADR-0126 §7.3 ` +
                `refuses to cause. It is armed the moment ${many ? 'they are' : 'that subflow is'} enabled: ` +
                `${remedy}.`,
        );
        return true;
    }

    /**
     * [#20725, ADR-0126 §7.3] `subflow` just changed state — (re)registered,
     * switched on or off, or read off the ledger at boot — so ask the arming
     * gate again for each packaged flow that calls it, where the answer can
     * have moved:
     *  - a caller the gate DECLINED is re-offered to it, so a caller that
     *    "registers and stays unarmed" is armed the moment its subflow is
     *    enabled, through the one gate, rather than staying enabled-but-unbound
     *    until a restart;
     *  - an ARMED caller whose subflows the gate would now decline on is
     *    unbound and offered again, so a subflow republished `obsolete`, or
     *    switched off by the ledger at boot after a trigger armed its caller,
     *    does not leave that caller armed onto it.
     * Every other caller is left exactly as it is: an armed caller whose
     * subflows are all enabled is not stopped and restarted, and a caller
     * unbound for a reason of its own is not re-offered here.
     */
    private rejudgeSubflowCallers(subflow: string): void {
        if (this.boundFlowTriggers.size === 0 && this.subflowDeclinedFlows.size === 0) return;
        for (const caller of this.packagedSubflowCallers(subflow)) {
            const settled = this.boundFlowTriggers.has(caller)
                ? this.disabledPackagedSubflows(caller).length === 0
                : !this.subflowDeclinedFlows.has(caller);
            if (settled) continue;
            this.deactivateFlowTrigger(caller);
            this.activateFlowTrigger(caller);
        }
    }

    /**
     * [#20726, ADR-0126 §7.2] Refuse the toggle door for a flow no package
     * ships — loudly, naming that flow's own switch, and before anything is
     * written or changed.
     *
     * ## Why the door switches packaged flows only
     *
     * The door records an installation's CHOICE about a packaged artifact in
     * `sys_metadata_activation`, whose rows each name "the package that ships
     * the base artifact" (§4), and §7.2 makes that row "the sanctioned
     * off-switch for packaged flows". A flow authored in this deployment has
     * no such package, and it already has an off-switch of its own: its
     * definition's `status` (`obsolete` / `invalid` disarm it, see
     * {@link registerFlow}; {@link isFlowEnabled} composes the two). Writing
     * it into the ledger anyway would give it a SECOND off-switch under a
     * package key its declaration excludes — with an empty id the durable
     * store refused the write with a validation error naming a field the
     * caller never sent, and with a sentinel id it would record a package
     * that ships nothing.
     *
     * ⛔ The door does not rewrite the definition's `status` itself either:
     * that would make it a second write door into definitions. It names the
     * flow's update door instead — `PUT /automation/:name`, which drives
     * {@link registerFlow} with the complete definition.
     *
     * "No package ships it" is {@link packagedFlowOwner} answering nothing —
     * the one reading the §7.3 guards already ask, ⛔ never a second one.
     * [#20761] That is the loader's set, never the definition's own stamps: a
     * runtime row carrying the `sys_metadata` sentinel, a tenant-authored row
     * bound to an app package, and a definition an authoring door registered
     * with a package's stamps on it are all refused exactly as a flow with no
     * package envelope at all is — the server's fact decides, not what the
     * body says.
     *
     * ADR-0112 envelope: code AND status. `RESOURCE_CONFLICT` (409) is the
     * standard catalog's "the request conflicts with the resource's current
     * state" member — the flow exists and the request is well-formed, but the
     * target's provenance does not admit the act — and it is the code this
     * same door already answers for its other state conflict (the §7.3
     * enable guard), so the door speaks one dialect. ⛔ No new ledger entry is
     * minted. Not a 400: nothing about the request is malformed. Not a 403:
     * no caller could be authorized into it. Not `DELETE_RESTRICTED`: that
     * member means dependencies.
     *
     * ## A customer flow a ledger row ALREADY holds off
     *
     * The ledger is keyed by name, and a row can already stand under a
     * customer flow's name: this door used to accept a customer flow whose
     * package id was non-empty (the sentinel and app-bound shapes above) and
     * wrote one, and a customer overlay can shadow a packaged flow the ledger
     * switched off. A status does not clear such a row ({@link isFlowEnabled}
     * composes the two, neither overrides the other), so for that flow the
     * refusal must not stop at "publish it `active`" — a step that completes
     * nothing. It names the one that does, and the one the `FLOW_DISABLED`
     * refusal already names for a ledger-held flow: a clone under a new name
     * (ADR-0126 §7.1), which no row holds. Still nothing is written: which
     * rows this door should clear is not this refusal's to decide.
     */
    private refuseCustomerAuthoredToggle(name: string, enabled: boolean): void {
        if (this.isPackagedFlow(name)) return;
        const updateDoor = `its update door, PUT /automation/${name}, which takes the complete definition`;
        const ownSwitch = this.flowLedgerDisabled.has(name)
            ? `This flow's own switch is its definition's status, published through ${updateDoor} — but it is ` +
              `ALSO held off by an activation-ledger row recorded under the name '${name}' (for a packaged flow of ` +
              `that name, or by this switch before it refused customer-authored flows), and no status clears that ` +
              `row. To run this flow, clone it under a new name through POST /automation/${name}/clone, which ` +
              `arms the copy, and remove this one.`
            : `This flow's switch is its own definition's status: publish it through ${updateDoor}, with status ` +
              `'obsolete' to switch it off or 'active' to arm it.`;
        throw Object.assign(
            new Error(
                `Flow '${name}' cannot be ${enabled ? 'enabled' : 'disabled'} through this switch: the switch turns ` +
                    `packaged flows on and off, and '${name}' was authored in this deployment, not shipped by a ` +
                    `package. The switch records an installation's choice about a packaged flow in the activation ` +
                    `ledger (sys_metadata_activation, ADR-0126 §7.2). ${ownSwitch} Nothing was changed.`,
            ),
            { code: 'RESOURCE_CONFLICT', status: 409 },
        );
    }

    /**
     * [ADR-0126 §7.2] Flip a PACKAGED flow's activation — THE sanctioned
     * off-switch for packaged flows. A flow no package ships is refused
     * ({@link refuseCustomerAuthoredToggle}); its switch is its `status`.
     *
     * ## What changed, and why the durable write is inside this method
     *
     * This used to set a process-local map and nothing else, which is the
     * mechanism commit 02b41232d measured leaking across tenants. It now writes the
     * `sys_metadata_activation` row FIRST and updates the in-process
     * projection only after that write returns. Putting the durable write here
     * — rather than in the HTTP route that calls it — is deliberate: this is
     * the service contract's off-switch (`IAutomationService.toggleFlow`), so
     * a caller that reaches it any other way must get the same durable
     * semantics. A route-side write would leave every non-HTTP caller on the
     * retired in-process-only behaviour.
     *
     * ## Where the AUTHORITY gate is, and why it is not here
     *
     * ADR-0126 §5 gates the write on posture and the platform-operator
     * capability. That gate lives at the automation domain's toggle route,
     * because it needs the CALLER — and `toggleFlow(name, enabled)` is a
     * `packages/spec` contract with no caller channel and no room to grow one
     * on this line. In-process callers are trusted here exactly as they are at
     * every other service method; the wire is the untrusted surface, and the
     * wire goes through the gate.
     *
     * @throws when the flow is unknown, when no package ships it
     *   (`RESOURCE_CONFLICT` / 409, before anything is written or changed),
     *   when §7.3's subflow guard refuses in either direction, when the
     *   durable suspended-run store cannot be listed while the disable guard
     *   judges a switched-off caller, or when the durable write fails — a
     *   reported flip that did not persist is the failure mode this whole leg
     *   exists to remove.
     */
    async toggleFlow(name: string, enabled: boolean): Promise<void> {
        const flow = this.flows.get(name);
        if (!flow) {
            throw new Error(`Flow '${name}' not found`);
        }

        // [#20726, ADR-0126 §7.2] FIRST, ahead of both §7.3 guards: a flow no
        // package ships is not this door's to switch in either direction, so
        // neither guard's question arises, the disable guard's run-store read
        // is never awaited for it, and the refusal lands before the ledger
        // write and before any in-process change — with a ledger attached or
        // in the degraded mode without one. Nothing half-flips.
        this.refuseCustomerAuthoredToggle(name, enabled);
        // Past the refusal the loader's set names a package, and the ledger row
        // is attributed to exactly that one — read with the verdict, so the
        // run-store await below cannot separate the two.
        const packageOwner = this.packagedFlowOwner(name) as string;

        // [ADR-0126 §7.3] The subflow guard runs in BOTH directions, because
        // a subflow pair breaks from either end. Disabling a child breaks the
        // callers that still reach it — armed, or holding a parked run;
        // re-arming a caller whose child is off breaks the caller itself, at
        // its subflow node, on the child's refusal. Arming a flow never breaks
        // the flows that call IT, so enabling a child is not guarded by its
        // callers.
        if (enabled) {
            this.refuseEnableOntoDisabledSubflow(name);
        } else {
            // A switched-off caller guards only while it holds a parked run,
            // so only then are the run stores read — and only that read is
            // awaited: every other disable flips exactly as it did before,
            // synchronously up to its durable write. A store that cannot be
            // listed throws out of `parkedRunsOf` and nothing is written.
            const callers = this.packagedSubflowCallers(name);
            const switchedOff = callers.filter((c) => !this.isFlowEnabled(c));
            const parked = switchedOff.length > 0
                ? await this.parkedRunsOf(new Set(switchedOff))
                : new Map<string, string[]>();
            this.refuseUnderReachingCallers(name, 'disable', callers, parked);
        }

        // The durable row FIRST. A store that throws aborts the flip with
        // nothing changed in process, so the engine never reports an
        // activation state the ledger does not carry.
        if (this.flowActivationStore) {
            await this.flowActivationStore.setActive({
                name,
                // [#20761] The package the LOADER's set names, never the
                // definition's stamps — so no row is attributed to a package
                // from an authoring door. Read once, up top, with the verdict.
                packageId: packageOwner,
                active: enabled,
            });
        } else {
            // Degrading to in-process is a legitimate mode for a host with no
            // ObjectQL — degrading to it while REPORTING durability is not
            // (the posture this package already takes for suspended runs).
            // Note the leak commit 02b41232d measured is closed by the route's authority gate,
            // not by durability, so this degraded mode is not that leak.
            this.logger.warn(
                `[Automation] flow '${name}' ${enabled ? 'enabled' : 'disabled'} IN PROCESS ONLY — no activation ledger is ` +
                `attached (sys_metadata_activation), so this flip will NOT survive a restart.`,
            );
        }

        if (enabled) this.flowLedgerDisabled.delete(name);
        else this.flowLedgerDisabled.add(name);

        this.logger.info(`Flow '${name}' ${enabled ? 'enabled' : 'disabled'}`);
        // A disabled flow should stop receiving trigger events; a re-enabled one
        // should resume. execute() also guards disabled flows, but unbinding
        // avoids firing the trigger (and its event-source subscription) at all.
        // Re-enabling moves only the LEDGER bit: a flow whose `status` still
        // disables it stays unarmed, by `activateFlowTrigger`'s enablement gate
        // — armed, it would only fire runs `execute()` refuses.
        if (enabled) {
            this.activateFlowTrigger(name);
        } else {
            this.deactivateFlowTrigger(name);
        }
        // [#20725, ADR-0126 §7.3] Enabling a subflow arms the packaged callers
        // the gate declined onto it — through the gate, which still declines
        // one held back by ANOTHER disabled subflow. (Disabling it re-judges
        // nothing that the guard above let through: an armed caller refuses
        // the disable.)
        this.rejudgeSubflowCallers(name);
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

    listRuns(
        flowName: string,
        options?: { limit?: number; status?: ExecutionStatus },
    ): Promise<ExecutionLogEntry[]> {
        // The body lives in ./run-history.ts (#25222).
        const host: ThisParameterType<typeof listRuns> = {
            listRunsPage: (...a) => this.listRunsPage(...a),
        };
        return listRuns.call(host, flowName, options);
    }

    /**
     * [#19543] The run listing AND whether it was truncated — the member the
     * REST door builds `hasMore` from.
     *
     * ## What "truncated" means at this seam, and why `runs.length === limit` is not it
     *
     * Three sources merge below and only ONE of them was ever capped: the
     * durable HISTORY arm, because `RunStore.listHistory(flowName, limit)`
     * takes the window as an argument. The durable PAUSED arm (`store.list()`)
     * and the in-memory ring are read in full and contribute everything they
     * hold for the flow. So before this change the merged set could be short
     * for two indistinguishable reasons — the flow really has that many runs,
     * or the store had more and was asked for exactly `limit`.
     *
     * `runs.length === limit` cannot separate them, which is why it is ⛔ not
     * the signal: a flow with EXACTLY `limit` runs and a flow with ten
     * thousand produce byte-identical windows, and reporting `hasMore: true`
     * for the first is as wrong as `false` for the second.
     *
     * The signal is an OVER-READ of exactly one row. The history arm is asked
     * for `limit + 1`; the merged, filtered, sorted set is then compared to
     * `limit`. If it overflows, a run matched that this window does not carry
     * and `hasMore` is true; if it does not, the window IS the answer. The
     * extra row is dropped by the same `.slice(0, limit)` that was always
     * here, so the wire shape does not change — only the fact reported beside
     * it. ⛔ `RunStore.listHistory`'s signature is deliberately NOT redesigned:
     * over-reading is expressible in the `limit` it already takes, so the
     * truncation signal costs the store contract nothing.
     *
     * ## What `hasMore` does NOT mean
     *
     * ⛔ Not "the retention cap evicted older runs". A run the deployment's
     * per-flow retention has discarded does not exist any more; it is not
     * "more" and no `limit` will bring it back. This answers only about rows
     * the sources still hold.
     *
     * ⛔ Not "there is a next page". This door mints no cursor (the request
     * half is a retired key). The caller's remedy is a WIDER `limit`, up to
     * the 100 the wire declares.
     *
     * ⚠️ One honest residual, pre-existing and unchanged: under `?status=`,
     * the history arm's window is still the newest `limit + 1` rows of ANY
     * status, because `listHistory` has no status slot and the filter is
     * applied to what comes back. So a status-filtered `hasMore: false` means
     * "no further match within the scanned window", not "no further match
     * exists". Pushing the filter down is a store-contract change and is ⛔ not
     * this card's; the same paragraph below the merge already records it for
     * the listing itself.
     */
    listRunsPage(
        flowName: string,
        options?: { limit?: number; status?: ExecutionStatus },
    ): Promise<RunListResult> {
        // The body lives in ./run-history.ts (#25222).
        const readStore = () => this.store;
        const host: ThisParameterType<typeof listRunsPage> = {
            executionLogs: this.executionLogs,
            get store() { return readStore(); },
            suspendedRunToLogEntry: (...a) => this.suspendedRunToLogEntry(...a),
            logger: this.logger,
            runRecordToLogEntry: (...a) => this.runRecordToLogEntry(...a),
        };
        return listRunsPage.call(host, flowName, options);
    }

    /** Rehydrate a durable {@link RunRecord} into an {@link ExecutionLogEntry}
     *  for the Runs surfaces. Steps carry the bounded persisted step log (rows
     *  written before step persistence have none). */
    private runRecordToLogEntry(r: RunRecord): ExecutionLogEntry {
        // The body lives in ./run-history.ts (#25222).
        return runRecordToLogEntry(r);
    }

    /**
     * Rehydrate a durably-stored {@link SuspendedRun} into the `paused`
     * {@link ExecutionLogEntry} the Runs surfaces expect (#8050) — the
     * suspension-row twin of {@link runRecordToLogEntry}.
     *
     * Deliberately reconstructs the SAME entry the two `status: 'paused'`
     * `recordLog` sites write, from the same inputs, so that whether a paused
     * run is read before or after a restart is invisible to the caller:
     *
     *  - `trigger` goes through {@link buildRunTrigger} on the persisted
     *    `context_json`, not through the flattened `trigger_*` columns. Those
     *    columns exist for FILTERING (#7533) and drop `type` to `null` where
     *    the log entry says `'manual'`; the context is what the ring entry was
     *    built from, so reusing the chokepoint reproduces it exactly rather
     *    than approximating it.
     *  - `variables` is carried because #7639 made it part of what a PAUSED run
     *    discloses on run-detail, and the row has held the same snapshot all
     *    along (`variables_json` is written from the very object handed to the
     *    log entry). Dropping it here would have re-opened #7639 for exactly
     *    the runs an operator most needs it for — the ones that outlived the
     *    process.
     *
     * `durationMs` / `completedAt` are absent because a suspension row records
     * no pause instant — only `started_at` / `start_time`. Absent reads as "not
     * recorded", which is what the schema's `optional()` means; inventing an
     * age-since-start here would publish a number that grows every time the row
     * is read and is not the "time spent executing" the ring entry reports.
     */
    private suspendedRunToLogEntry(run: SuspendedRun): ExecutionLogEntry {
        // The body lives in ./run-history.ts (#25222).
        return suspendedRunToLogEntry(run);
    }

    getRun(runId: string): Promise<ExecutionLogEntry | null> {
        // The body lives in ./run-history.ts (#25222).
        const readStore = () => this.store;
        const host: ThisParameterType<typeof getRun> = {
            executionLogs: this.executionLogs,
            get store() { return readStore(); },
            runRecordToLogEntry: (...a) => this.runRecordToLogEntry(...a),
            logger: this.logger,
            suspendedRunToLogEntry: (...a) => this.suspendedRunToLogEntry(...a),
        };
        return getRun.call(host, runId);
    }

    /**
     * Build the run's effective {@link AutomationContext} from `flow.runAs` — a
     * COPY, never mutating the caller's context, so the elevation is scoped to
     * this run and the caller's identity is restored when the run returns
     * (ADR-0049 / #1888). The single construction point shared by `execute()` and
     * `executeWithoutRetry()`.
     *
     * Also warns about the user-less case (#1888 follow-up, closed by #3760): a
     * flow whose effective `runAs` is `'user'` but whose trigger resolved no user
     * has no identity to scope to, so its data nodes used to run UNSCOPED (the
     * data security middleware skipped a context with no identity; since
     * ADR-0096 D5 it refuses one). Those data ops are now
     * REFUSED at `resolveRunDataContext`; the warning here fires at run SETUP,
     * before any node executes, so the refusal is diagnosable rather than a
     * surprise mid-flow. Authors declare `runAs:'system'` to make the elevation
     * explicit (the build-time lint `flow-runas-unscoped` rejects the
     * statically-decidable shapes earlier — but NOT the record-change shape, which
     * is only knowable at run time).
     */
    private resolveRunContext(flow: FlowParsed, context?: AutomationContext, runId?: string): Promise<AutomationContext> {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof resolveRunContext> = {
            seedRunGrants: (...a) => this.seedRunGrants(...a),
            logger: this.logger,
            expandDeclaredLookups: (...a) => this.expandDeclaredLookups(...a),
        };
        return resolveRunContext.call(host, flow, context, runId);
    }

    /**
     * Seed a `runAs:'user'` run context's authorization facts — `positions`,
     * `permissions`, the peer list `org_user_ids` and the user's `email` — for
     * its `userId`, through the wired grants resolver: the one resolver the
     * request path seeds a request's envelope through
     * (`resolveUserAuthzGrants`, bridged by the automation plugin). Mutates
     * `runContext`; a fact it already carries is kept verbatim, so only the
     * missing ones are resolved (see the setup comment in
     * {@link resolveRunContext} for why carried positions and permissions are
     * never re-broadened).
     *
     * Two callers, one resolution: run setup for the TRIGGER user
     * ({@link resolveRunContext}), and the decision switch for the DECIDER
     * ({@link resolveDecisionSegmentContext}), which hands this a context whose
     * trigger-user facts it has already removed — so the decider's segment
     * carries the decider's own positions, permission sets, peers and email,
     * resolved exactly as the decider's own request resolves them, and never a
     * copy of anybody else's.
     *
     * A `runAs:'system'` run, a user-less run, a context carrying every fact,
     * and an engine with no resolver wired resolve nothing.
     */
    private seedRunGrants(
        flowName: string,
        runContext: AutomationContext,
        whose: 'triggering' | 'deciding',
    ): Promise<void> {
        // The body lives in ./run-resume.ts (#25222).
        const readUserGrantsResolver = () => this.userGrantsResolver;
        const host: ThisParameterType<typeof seedRunGrants> = {
            get userGrantsResolver() { return readUserGrantsResolver(); },
            logger: this.logger,
        };
        return seedRunGrants.call(host, flowName, runContext, whose);
    }

    /**
     * The context the nodes after a resumed pause run with (ruling A on
     * `FlowSchema.runAs`: 「the human whose act is running this segment: the
     * trigger user until a human decision, the decider after it」).
     *
     * When the signal names the decider of an approval
     * ({@link ResumeSignal.resumedBy}) AND carries the owning service's
     * {@link RESUME_AUTHORITY_SERVICE} marker, a `runAs:'user'` run continues
     * as that decider — identity and permissions together. The answer is a
     * COPY of the persisted context with the trigger user's authorization facts
     * REMOVED, `userId` set to the decider, and the decider's own positions,
     * permission sets, peers and email resolved by {@link seedRunGrants}, the
     * trigger setup's own resolver. Nothing of the trigger user's survives into the
     * segment: copying the decision request's envelope by hand, or keeping the
     * submitter's grants under the decider's name, would be two identities in
     * one context — the reading ruling A rejected.
     *
     * The trigger is not forgotten: {@link SeededRunContext.triggerUserId}
     * records who started the run (`null` when its trigger resolved no user),
     * set on the first switch and kept by every later one, so the run's
     * history still names its trigger ({@link buildRunTrigger}). The switched
     * context is what a later pause in the same run persists, so a second
     * decision, a cold resume or a repair replay continues from the decider's
     * segment and never falls back to the submitter.
     *
     * A `runAs:'system'` run moves its ATTRIBUTION user and nothing else (ruling
     * 6267719791 Q1 A: 「`'system'` flows keep system privileges; after the
     * decision their attribution user is the decider」). Its nodes after the
     * decision run as `{ isSystem: true, userId: DECIDER }` — the shape the
     * approvals verdict mirror already writes with — so `updated_by`, the audit
     * row and `ctx.user` in the hooks those writes fire name the decider, while
     * elevation is untouched and no grant is resolved for the run. Its data
     * context carries no positions or permission sets
     * ({@link resolveRunDataContext}'s system arm), so a `runAs:'user'` hook a
     * post-decision write fires resolves the decider's own grants. The
     * trigger user's positions, permission sets, peers and email are removed
     * here too, so `current_user` in the segment is the decider and never the
     * decider's id over the submitter's grants.
     *
     * Unchanged:
     *  - a signal with no decider — an SLA auto-decision, a screen, a wait
     *    timer, every engine-built continuation (a subflow parent's own nodes
     *    included: the parent declares no decision node of its own);
     *  - a decider the signal names WITHOUT the service marker: only the
     *    service that authenticated and recorded the decision may name its
     *    decider, and an HTTP body cannot carry the symbol;
     *  - a decider who is already the run's acting user.
     *
     * On a resolution failure the decider's segment carries no positions or
     * permission sets, so its data operations fall back to the baseline member
     * set — narrower, never the trigger user's grants (see the warning in
     * {@link seedRunGrants}).
     */
    private resolveDecisionSegmentContext(
        run: SuspendedRun,
        signal: ResumeSignal,
    ): Promise<AutomationContext> {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof resolveDecisionSegmentContext> = {
            seedRunGrants: (...a) => this.seedRunGrants(...a),
        };
        return resolveDecisionSegmentContext.call(host, run, signal);
    }

    /**
     * Enrich `runContext.record` with opt-in single-hop lookup expansions the
     * start node declares as `config.expand: string[]` (#3475). Re-reads just
     * those relations through the injected {@link setRecordExpander} — which the
     * host wires to a data-engine read scoped by {@link resolveRunDataContext},
     * so the referenced object's RLS/FLS are enforced as the RUN's identity (the
     * triggering user for `runAs:'user'`, elevated for `runAs:'system'`). Grafts
     * ONLY the declared relation keys, and only when the re-read actually returned
     * an object/array, so bare lookup ids and #1872 multi-lookup arrays on other
     * relations — and the formula fields the trigger already hydrated — stay
     * untouched. Mutates `record` in place (the same object the run's variable map
     * already references). Best-effort: any failure leaves `record` unexpanded
     * (the template then renders the scalar id) — expansion must never break the
     * flow it feeds.
     */
    private expandDeclaredLookups(flow: FlowParsed, runContext: AutomationContext): Promise<void> {
        // The body lives in ./run-resume.ts (#25222).
        const readRecordExpander = () => this.recordExpander;
        const host: ThisParameterType<typeof expandDeclaredLookups> = {
            get recordExpander() { return readRecordExpander(); },
            logger: this.logger,
        };
        return expandDeclaredLookups.call(host, flow, runContext);
    }

    async execute(flowName: string, context?: AutomationContext): Promise<AutomationResult> {
        const startTime = Date.now();
        const flow = this.flows.get(flowName);

        if (!flow) {
            return { success: false, error: `Flow '${flowName}' not found` };
        }

        // Check if flow is disabled.
        //
        // [ADR-0126 §7.2] THE consult point for the activation ledger. This is
        // the one seam every entry path crosses (#11665 §2.3) — record-change,
        // schedule, time-relative, api and subflow all arrive here — which is
        // why the ADR puts the runtime refusal beside this guard instead of
        // teaching each trigger its own check.
        if (!this.isFlowEnabled(flowName)) {
            // [#9415] NEVER DISPATCHED, and the producer says which kind — the
            // remaining half of #9378's classification. `status` stays ABSENT
            // here on purpose (see the `status: 'failed'` exit below): its
            // absence is what proves the transport's 400 arm reads a verdict
            // instead of guessing, so a later edit that stamps `'failed'` on
            // this exit "for consistency" must fail a test. What the exit
            // gained is a `code`, which is the classification's own channel.
            //
            // [ADR-0126 §7.2] The ledger refusal REUSES `FLOW_DISABLED` — ⛔ no
            // new ADR-0112 ledger entry — so the distinction has to ride the
            // MESSAGE. It is a real distinction to an operator: a status
            // disable is an authoring state fixed in Studio, a ledger disable
            // is an installation choice fixed by re-enabling the packaged
            // flow, and the two have different remedies.
            return {
                success: false,
                code: 'FLOW_DISABLED',
                error: this.describeDisabledFlow(flowName),
            };
        }

        // #4792 — a real run is about to start, so if the vocabulary was never
        // sealed the ADR-0018 §M1 node-type check never ran on this engine at
        // all. Say so once. Placed after the two guards above so the trigger is
        // an execution and not a typo'd flow name (which is already loud) or a
        // flow that cannot run. See the helper for why here and not earlier.
        this.warnIfNodeTypeVocabularyNeverSealed();

        // Re-entrancy loop guard KEY (see `activeRecordFlows`). Only the key is
        // computed here; the CHECK itself lives downstream of the start-condition
        // gate inside the `try` below, and that placement is load-bearing — see
        // the guard block there (#8689).
        const guardRecordId = (context?.record as { id?: unknown } | undefined)?.id;
        const reentryKey = guardRecordId != null ? `${flowName}::${String(guardRecordId)}` : undefined;
        // Set ONLY by the run that actually added `reentryKey` to the active set.
        // The `finally` releases the key on this flag, never on `reentryKey`
        // alone: a re-entrant dispatch now returns from INSIDE the try (the guard
        // block below), and an unconditional delete there would release the key
        // belonging to the OUTER run still on the stack — disarming the breaker
        // for every later re-entry in that same cascade, which is precisely the
        // runaway it exists to stop.
        let reentryHeld = false;

        // Initialize the run's variable environment. Every binding a run is
        // entitled to — the flow's declared variables, the trigger record and
        // its flattened fields, `previous`, and the engine-owned `$runId` /
        // `$flowName` / `$flowLabel` — is seeded by `seedRunVariables`, the one
        // chokepoint `executeWithoutRetry` shares (#9704). See that helper for
        // why the seeding is not written out here any more.
        //
        // The run id is minted BEFORE the seeding because `$runId` is part of
        // that environment. Order-safe: `nextRunId()` is a stateless random id
        // (no counter to advance), and nothing between the old call site and
        // this one reads or mints one.
        const runId = this.nextRunId();
        const variables = this.seedRunVariables(flow, flowName, context, runId);
        const startedAt = new Date().toISOString();
        const steps: StepLogEntry[] = [];

        // ADR-0049 / #1888 — establish the run's effective execution identity
        // from flow.runAs (a COPY, never mutating the caller's context, so the
        // elevation is scoped to this run and the caller's identity is restored
        // when execute() returns). Surfaces the user-less fail-open (see helper)
        // and resolves the triggering user's real grants for `runAs:'user'` (#3356).
        // Also stamps `flowRunId` so this run's data writes are attributable to it
        // (#3456).
        const runContext = await this.resolveRunContext(flow, context, runId);

        try {
            // Find the start node
            const startNode = flow.nodes.find(n => n.type === 'start');
            if (!startNode) {
                // [#9415] Inside the `try`, but still a NEVER-DISPATCHED exit:
                // nothing has executed at this point — the run id and the run
                // context exist, no node does. Registration accepts a flow with
                // no `start` (`FlowSchema` requires no such member), so this is
                // reachable from the trigger door and is not dead code. No
                // `status`, for the reason the disabled exit above states.
                return { success: false, code: 'FLOW_NO_START_NODE', error: 'Flow has no start node' };
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
                if (!this.evaluateCondition(condExpr, variables, runContext)) {
                    this.logger.debug(`Flow '${flowName}' skipped: start condition not met`);
                    // `flowLabel` rides even here, unlike `successMessage` /
                    // `summary`: it names the flow, it claims no work done, and
                    // this answer reaches a runner as a 200 like any other.
                    return { success: true, output: { skipped: true, reason: 'condition_not_met' }, flowLabel: flow.label };
                }
            }

            // Re-entrancy loop guard (see `activeRecordFlows`). Breaks the SAME
            // flow re-firing for the SAME record while a prior execution is still
            // active — a self-trigger cascade whose start condition is genuinely
            // true on every pass (the 2026-07-06 incident: a `boolean` persists as
            // integer 1 on SQLite/libsql and CEL `1 != true` is true, so
            // `is_escalated != true` never tripped) would otherwise loop forever
            // and wedge the caller, fatally mid seed.
            //
            // #8689 — this check sits AFTER the start-condition gate above, and
            // the order is the contract, not a detail. The declared behaviour is
            // "a record-change flow fires only when its start condition is true",
            // and that has to hold on the re-entrant dispatch a flow's OWN write
            // causes — it cannot if the breaker returns first, because then the
            // gate is never reached on that dispatch at all. Measured before the
            // reorder, on the real kernel (a `record-after-update` flow guarded on
            // `record.status != "escalated"` whose data node writes
            // `status = "escalated"`): TWO dispatches for the record, exactly ONE
            // start-condition evaluation, and one breaker WARN. So the author's
            // guard was never what stopped the loop — the breaker was, and its own
            // message said so. The re-entrant dispatch already carries the
            // POST-write row, so evaluating first suppresses it with
            // `condition_not_met` and the breaker returns to being a backstop.
            //
            // The breaker is UNCHANGED in strength (deliberately — a stronger
            // breaker is not the repair): a condition that really is true on
            // re-entry still lands here, at the same depth, with the same WARN and
            // the same skip envelope. What changed is that reaching it now MEANS
            // something — the condition was evaluated and returned true — which is
            // why the message can state that as fact.
            if (reentryKey && this.activeRecordFlows.has(reentryKey)) {
                // #6654 — the record id is CALLER data (nothing schema-constrains
                // it against newlines), so it rides the logger's structured slot,
                // never the message; see `forgetSuspendedRun`'s catch for the full
                // mechanism (#6299). #4632: FUNCTIONAL — stays `warn` (the run is
                // deliberately skipped and the caller reads the skip envelope).
                this.logger.warn(
                    `[automation] flow '${flowName}' re-entered for the same record while still running — breaking ` +
                        `self-trigger loop; the triggering record's id is in this record's meta. Its start condition ` +
                        `WAS evaluated on this re-fire and returned true, so the guard as authored does not exclude ` +
                        `the flow's own write-back; if it guards on a boolean field (e.g. \`is_escalated != true\`), ` +
                        `note booleans persist as 0/1 on SQLite/libsql and CEL \`1 != true\` is true.`,
                    { recordId: String(guardRecordId) },
                );
                return { success: true, output: { skipped: true, reason: 'reentrancy_loop_guard' }, flowLabel: flow.label };
            }
            if (reentryKey) {
                this.activeRecordFlows.add(reentryKey);
                reentryHeld = true;
            }

            // Validate node input schemas before execution. [#9889] The same
            // call sits in `executeWithoutRetry` — every retry attempt must be
            // refused by the same guard that refused attempt 1; see the guard's
            // own doc for the chokepoint contract.
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

            // [#16274] THE RUN IS OVER AND IT SUCCEEDED. Everything from here
            // to the return is BOOKKEEPING ABOUT that fact, and the `catch`
            // below this `try` exists for NODE failures — so a throw out of the
            // history write was handled as though a node had thrown: the arm
            // recorded a `failed` row carrying the history driver's own text as
            // the run's error and answered `status: 'failed'` for a run whose
            // every node succeeded. This is the guard PR #16273 landed on
            // {@link resumeInternal}'s completion path, now on the two
            // INITIAL-execution paths that card deliberately scoped out — this
            // one and {@link executeWithoutRetry}'s.
            //
            // ⚠️ MEASURED, and sharper than the report assumed: under
            // `errorHandling.strategy: 'retry'` that false `failed` is handed
            // to {@link retryExecution} by the strategy branch in the catch
            // below, whose loop reads `result.success` — so it RE-EXECUTES a
            // flow that already finished. `1 + maxRetries` runs of every node,
            // unattended, inside this one call, with the side effects repeated
            // each time and one `failed` history row per attempt. That is the
            // DOUBLE RUN #15944 was graded sharp for, reached here with no
            // operator action at all, where #15944's needed an operator to
            // restore and resume.
            //
            // Two statements inside `recordLog` reach that catch on the
            // terminal path, and neither is hypothetical:
            //
            //  1. the run-summary line `this.logger.info(line, meta)` — on by
            //     default (`runSummaryLog: 'info'`) and calling a
            //     HOST-INJECTED `Logger`, so it needs no store at all;
            //  2. `store.recordTerminal(record)` throwing SYNCHRONOUSLY — the
            //     `void write.catch(...)` beneath that call only ever sees a
            //     returned promise's rejection (both shipped stores are
            //     `async` and cannot; `SuspendedRunStore` is an exported
            //     interface with an optional `recordTerminal`, so a host store
            //     is unconstrained, and one returning a non-thenable makes
            //     `write.catch` itself a synchronous `TypeError`). On THAT
            //     variant the unguarded code did not even answer `failed`: the
            //     catch arm's own `recordLog({ status: 'failed' })` threw again
            //     out of the same store and escaped `execute()` entirely,
            //     rejecting a promise `AutomationResult` is declared for.
            //
            // The guard restores the invariant `recordLog`'s own doc states —
            // "a history write must NEVER block or break the run that produced
            // it" — which that call was relied upon to keep and did not.
            //
            // ⛔ NOT a widening of anything: no exit gains a status it did not
            // have, the node-failure arm below is untouched (a genuine node
            // throw still lands there, still records `failed`, still retries),
            // and the failure is REPORTED rather than swallowed — see the
            // catch.
            let logged: ExecutionLogEntry | undefined;
            try {
                logged = this.recordLog({
                    id: runId,
                    flowName,
                    flowVersion: flow.version,
                    status: 'completed',
                    startedAt,
                    completedAt: new Date().toISOString(),
                    durationMs,
                    trigger: buildRunTrigger(context),
                    steps,
                    output,
                }, context);
            } catch (bookkeeping) {
                // #4632 verdict: DURABILITY, so `error` — the caller is told
                // the truthful thing (the run completed), which is exactly
                // what makes the rest invisible from the outside: the terminal
                // history row never landed, nothing retries it, and no
                // envelope carries a word about it. Consequence and fix in the
                // first line, per AGENTS.md. Said ONCE per run, not once per
                // failed write.
                //
                // ⚠️ The level is the precedent's (#16273, #15555) and is NOT
                // a raise under the published-sink ruling (commit e238c79f0): that ruling forbids raising a site to
                // `error` where doing so means GROWING `error?` onto a
                // published sink that lacks it, and this sink — `Logger` from
                // `@objectstack/spec/contracts` — declares `error(message,
                // error?, meta?)` as a REQUIRED member (only `fatal?`,
                // `child?` and `withTrace?` are optional). Nothing is widened,
                // which is also why the two precedents on this same sink could
                // land `error`.
                //
                // THIRD argument per `error(message, error?, meta?)`; the
                // `Error` slot stays empty on purpose (#5575), and the thrown
                // text goes to the structured slot rather than into the
                // message (#6499).
                this.logger.error(
                    `[Automation] run '${runId}' of flow '${flowName}' COMPLETED successfully but its ` +
                        `run-history bookkeeping threw, so its terminal history row never landed — nothing ` +
                        `retries it, the caller is told the run succeeded, and after the next restart this ` +
                        `run is invisible to the Runs surfaces while the approvals sweeps read it as ` +
                        `never-finished. The run itself is COMPLETE and must NOT be re-run or retried. Fix ` +
                        `the history failure in this record's meta.`,
                    undefined,
                    describeThrownForLog(bookkeeping),
                );
            }
            // [#16274] Recomputed when the guard above had to abandon
            // `recordLog`: the same pure function of the same steps that
            // `recordLog`'s own first statement runs, so the two spellings
            // cannot disagree. Same shape as `resumeInternal`'s (#15944).
            const summary = logged?.summary ?? summarizeRun(steps);

            return {
                success: true,
                output,
                durationMs,
                // [#9414] The flow author's own completion text, on the exit
                // every TRIGGERED run leaves through. `AutomationResult`
                // declares this pair as a general terminal-result feature —
                // "`successMessage` is set on terminal success, `errorMessage`
                // on failure" — but `resumeInternal` was the only producer, so
                // the author's words reached a caller only when the run
                // happened to pause and be resumed. A flow dispatched straight
                // through `POST /api/v1/automation/:name/trigger` (or the
                // legacy `trigger/:name` the SDK calls) carried nothing. Same
                // declaration, two behaviours decided by ROUTE rather than by
                // authoring — the shape ADR-0049's enforce-or-remove exists to
                // stop, and this is the restoration half of it, not a new key.
                //
                // ⚠️ TERMINAL exits only, which is the whole boundary. The
                // paused return below carries neither (the run has not
                // finished; `resumeInternal` stamps the message when it later
                // ends). Neither do the SKIP exits above — `condition_not_met`
                // and `reentrancy_loop_guard` return `success: true` for a run
                // that executed no node, so stamping "Opportunity created!" on
                // one would be a toast about work nobody did. They carry no
                // `summary` for exactly the same reason.
                successMessage: flow.successMessage,
                // The authored flow name for the runner header and the
                // completion toast — on EVERY evaluation's result, paused and
                // terminal alike (see `AutomationResult.flowLabel`).
                flowLabel: flow.label,
                // #4354 — hand the counts back synchronously so a caller
                // (a `subflow` roll-up, a runtime test asserting the sweep wrote
                // something) never has to re-read the run to learn what it did.
                summary,
            };
        } catch (err: unknown) {
            // [#15788] The run REFUSED — an `end` node declaring
            // `outcome: 'refused'`, or (#18110 / #18555) a node whose own child
            // run refused. Tested FIRST, beside the
            // pause and for the same reason: this is NOT a failure either, and
            // a signal recognised only by the arm below would be recorded as
            // one. The shape is `finishRefusedRun`'s — one method, all three
            // producers.
            if (isRefusalSignal(err)) {
                return this.finishRefusedRun({
                    runId, flowName, flowVersion: flow.version,
                    startedAt, durationMs: Date.now() - startTime,
                    steps, flow, variables,
                    refusalMessage: err.message, context,
                });
            }
            // A node asked to suspend the run (ADR-0019 durable pause). Snapshot
            // the live state, record a `paused` log, and return the run id so the
            // caller can later `resume()` it. This is NOT a failure.
            if (isSuspendSignal(err)) {
                const durationMs = Date.now() - startTime;
                // #7639 — ONE snapshot expression feeding BOTH consumers: the
                // continuation the run will resume from, and the `paused` log
                // entry run-detail serves. Same object, so what an operator
                // reads can never disagree with what the run holds. See
                // {@link ExecutionLogEntry.variables} for why the log carries it.
                const variablesSnapshot = Object.fromEntries(variables);
                await this.persistSuspendedRun({
                    runId,
                    flowName,
                    flowVersion: flow.version,
                    nodeId: err.nodeId,
                    nodeType: err.nodeType,
                    variables: variablesSnapshot,
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
                    trigger: buildRunTrigger(context),
                    steps,
                    variables: variablesSnapshot,
                }, context);
                return {
                    success: true,
                    status: 'paused',
                    runId,
                    durationMs,
                    screen: err.screen,
                    flowLabel: flow.label,
                };
            }

            const errorMessage = err instanceof Error ? err.message : String(err);

            // Record failed execution log
            const durationMs = Date.now() - startTime;
            // [#17562] THE RUN IS OVER AND IT FAILED, and this `catch` IS the
            // handler for that failure — there is no outer one. So a throw out
            // of THIS history write escaped `execute()` entirely and left it a
            // REJECTED PROMISE, where its declared return type is an
            // `AutomationResult`. The FAILURE-arm half of the guard #16274
            // landed on the completion arm of this same method, and the same
            // shape #15555 landed on {@link resumeInternal}'s failure arm.
            //
            // ⚠️ What is lost is the SHAPE, not the verdict — which is why this
            // is a narrower defect than #16274's and still a contract
            // violation. The run genuinely failed, so nothing misleads an
            // operator: no false `failed`, no double run. But the caller that
            // branches on `{ success: false, status: 'failed' }` gets an
            // exception instead, so the transport's `status` arm (#9378) is
            // bypassed and `errorMessage` (#9414) and `summary` (#4354) never
            // arrive — a REST route or SDK caller sees a 500-class throw for a
            // run that had a perfectly good failure envelope waiting, and the
            // NODE's own error text is replaced by the history driver's.
            //
            // The two statements inside `recordLog` that reach here are the
            // ones stated at the completion site above: the default-on
            // run-summary line `this.logger.info(line, meta)` calling a
            // HOST-INJECTED `Logger`, and `store.recordTerminal(record)`
            // throwing SYNCHRONOUSLY — which the `void write.catch(...)`
            // beneath that call cannot see, because it only ever observes a
            // RETURNED promise's rejection.
            //
            // The guard restores the invariant `recordLog`'s own doc states —
            // "a history write must NEVER block or break the run that produced
            // it" — which this call was relied upon to keep and did not.
            //
            // ⛔ NOT a widening of this arm's meaning: the suspend arm above,
            // the `InputSchemaViolationError` refusal below and the
            // `strategy: 'retry'` branch are all untouched, a genuine node
            // failure still records `failed` with the node's own text, and the
            // retry budget is unchanged — pinned by two controls.
            let logged: ExecutionLogEntry | undefined;
            try {
                logged = this.recordLog({
                id: runId,
                flowName,
                flowVersion: flow.version,
                status: 'failed',
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs,
                trigger: buildRunTrigger(context),
                steps,
                error: errorMessage,
            }, context);
            } catch (bookkeeping) {
                // #4632 verdict: DURABILITY, so `error` — the caller is told a
                // truthful thing (the run failed, with the node's own text),
                // which is exactly what makes the rest invisible from the
                // outside: the terminal history row never landed, nothing
                // retries it, and no envelope carries a word about it.
                // Consequence and fix in the first line, per AGENTS.md. Said
                // ONCE per abandoned write.
                //
                // ⚠️ NOT the rule's third answer ("a failure handed to the
                // CALLER is not a degradation at all"): what is handed to the
                // caller is the NODE's failure. The bookkeeping failure is
                // handed to nobody, and it is a durability loss — which is why
                // `recordLog` is in `DURABILITY_CRITICAL_CALLEES`.
                //
                // ⚠️ The level is the precedent's (#15555, #16273, #16274) and
                // is NOT a raise under the published-sink ruling (commit e238c79f0): that ruling forbids raising a
                // site to `error` where doing so means GROWING `error?` onto a
                // published sink that lacks it, and this sink — `Logger` from
                // `@objectstack/spec/contracts` — declares `error(message,
                // error?, meta?)` as a REQUIRED member. Nothing is widened and
                // no sink type changes in this diff.
                //
                // THIRD argument per `error(message, error?, meta?)`; the
                // `Error` slot stays empty on purpose (#5575), and the thrown
                // text goes to the structured slot rather than into the message
                // (#6499).
                this.logger.error(
                    `[Automation] run '${runId}' of flow '${flowName}' FAILED and its run-history ` +
                        `bookkeeping threw, so its terminal 'failed' row never landed — nothing retries the ` +
                        `write, and after the next restart this run is invisible to the Runs surfaces while ` +
                        `the approvals sweeps read it as never-finished. The run's OWN failure IS reported: ` +
                        `the caller was answered status 'failed' carrying the node's error, so nothing ` +
                        `needs re-driving on account of this line. Fix the history failure in this record's ` +
                        `meta.`,
                    undefined,
                    describeThrownForLog(bookkeeping),
                );
            }

            // [#10025] NEVER DISPATCHED, ruled NON-RETRYABLE (maintainer,
            // 2026-08-20, Option B taken whole). The guard's verdict is a pure
            // function of the flow definition — `validateNodeInputSchemas`
            // deliberately ignores its variables parameter — so attempt 2
            // cannot answer differently than attempt 1, and handing this throw
            // to `retryExecution` below would burn the whole retry budget
            // (backoff delays included) re-deriving a certainty into
            // 1 + maxRetries identical failed rows. Short-circuiting HERE,
            // before the strategy branch, is the ruling's whole content:
            // `strategy: 'retry'` changes nothing about this exit, and the ONE
            // failed row recorded above is the run history's entire account of
            // the refusal.
            //
            // The envelope matches its never-dispatched siblings
            // (`FLOW_DISABLED`, `FLOW_NO_START_NODE` — #9378/#9415): a `code`
            // and NO `status`, whose absence is the discriminator the
            // transport's 422 arm reads (see the `status: 'failed'` exit
            // below). No `errorMessage` / `summary` either — those are a RUN's
            // artefacts, and no node executed.
            //
            // The #9889 parity floor underneath is UNTOUCHED: the guard is
            // still called identically by both attempt paths, so if any route
            // ever reaches `executeWithoutRetry` without crossing this catch,
            // the refusal still fires — just without this classification.
            // This arm decides what `execute()` does with the verdict; it
            // never weakens who renders it.
            if (err instanceof InputSchemaViolationError) {
                return {
                    success: false,
                    code: 'FLOW_INPUT_SCHEMA_INVALID',
                    error: errorMessage,
                };
            }

            // Error handling strategy.
            //
            // [#9510] ⚠️ This handoff can now return a NON-TERMINAL result: a
            // retry attempt that reaches a pausing node comes back as
            // `{ success: true, status: 'paused', runId }` — the same shape the
            // suspend arm above returns — and `execute()` forwards it
            // unchanged, so its contract is ONE answer per situation rather
            // than one per attempt number. Deliberate, not incidental: a caller
            // branching on `status` sees no difference between a pause on
            // attempt 1 and a pause on attempt 3, which is what
            // `AutomationResult` already promises.
            //
            // ⚠️ The `runId` that comes back is then the PAUSED ATTEMPT's, not
            // this failed first attempt's. They are different runs with
            // different log rows, and the paused one is the key
            // `persistSuspendedRun` stored the continuation under — so it is
            // the only id `resume()` can be called with.
            if (flow.errorHandling?.strategy === 'retry') {
                return this.retryExecution(
                    flowName, context, startTime, flow.errorHandling, flow.errorMessage, flow.label,
                );
            }
            return {
                success: false,
                error: errorMessage,
                durationMs,
                // [#9378] RAN AND FAILED, said by the producer that knows —
                // the same lifecycle verdict this exit just wrote to the run
                // log two statements up, now also on the result.
                //
                // Load-bearing, not decoration: `execute()` has four OTHER
                // `success: false` exits that never dispatched anything (flow
                // not found, flow disabled, no start node, and the
                // input-schema refusal in the arm above), and a transport
                // cannot tell them from this one without either a message
                // regex or sniffing `summary` / `durationMs` — the
                // tolerant-consumer shape PD #12 forbids, and the one #8684
                // deliberately did not reproduce on the resume route. Those
                // four exits carry NO `status`, this one carries `'failed'`,
                // so "the run dispatched and was rejected" is a fact the route
                // reads rather than infers.
                //
                // [#9415] Three of those four now also carry a `code`
                // (`FLOW_DISABLED`, `FLOW_NO_START_NODE`, and #10025's
                // `FLOW_INPUT_SCHEMA_INVALID`) so the transport can
                // answer them 409/422 instead of 200. That did NOT retire the
                // rule above — it sharpened it. The `status` absence is still
                // the discriminator this arm is read by, and it is the reason
                // the never-dispatched exits must never acquire `status`: a
                // tidy-up that stamped `'failed'` on all of them would put
                // every refusal back on this 400 arm, silently.
                //
                // `status` and not a `code`, and that division SURVIVED the
                // union widening: #9415 added `'FLOW_DISABLED'` /
                // `'FLOW_NO_START_NODE'` for the two never-dispatched exits,
                // and this exit still classifies with `status` alone. The two
                // fields answer different questions — `code` says WHY a
                // dispatch was refused, `status` says how a run that started
                // ended — and a run that reached here has no refusal to name.
                // `status?: 'completed' | 'paused' | 'failed'` is declared,
                // documented as the run's lifecycle verdict, and already the
                // value recorded in the log.
                status: 'failed',
                // [#9414] The author's failure text, BESIDE the raw `error`
                // rather than instead of it. The transport folds `error` into
                // the ADR-0112 message and carries this one in
                // `error.details.errorMessage` — the single place the console
                // reads it from (objectui `flowResponse.ts`, PR #4899). The
                // envelope has no `data`, so a producer that leaves this absent
                // does not degrade to a plainer toast: the consumer falls back
                // to the raw node error text, which is what every non-screen
                // flow showed until now.
                errorMessage: flow.errorMessage,
                flowLabel: flow.label,
                // A failed run's counts matter MORE, not less: they say how far
                // it got before dying — how many rows it had already written.
                // [#17562] Recomputed when the guard above had to abandon
                // `recordLog`: the same pure function of the same steps that
                // `recordLog`'s own first statement runs, so the two spellings
                // cannot disagree. Same shape as #15555's.
                summary: logged?.summary ?? summarizeRun(steps),
                // [#24914, ruling B′] The refusal the failing node's data call met,
                // beside the unchanged `error`: `userMessage` / `innerRefusal`, read
                // off the brand the node's throw carries (`inner-refusal.ts`) — `{}`
                // for a throw that met none, so nothing is invented.
                ...readCarriedRefusal(err),
            };
        } finally {
            // Release the re-entrancy guard for this (flow, record). Runs before
            // the returned promise settles, so an error-retry re-run (whose inner
            // execute happens after its own await) is not falsely blocked.
            //
            // Gated on `reentryHeld`, NOT on `reentryKey` (#8689): since the guard
            // check moved below the start-condition gate, a run can now leave this
            // try WITHOUT owning the key — the re-entrant dispatch that tripped the
            // breaker, and a condition-not-met skip. Deleting then would release
            // the OUTER run's key and disarm the breaker mid-cascade.
            if (reentryHeld && reentryKey) this.activeRecordFlows.delete(reentryKey);
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
     *
     * **Authorization (#3801).** This is the public door — the generic REST
     * resume route and the SDK land here — so it is gated on WHAT THE RUN IS
     * PARKED ON before any state is touched: a suspension whose node declares
     * `resumeAuthority: 'service'` — or declares no `resumeAuthority` at all,
     * fail-closed since #5561 — is refused unless the signal carries
     * {@link RESUME_AUTHORITY_SERVICE}. The engine's own continuations
     * (subflow delegation / up-bubble, `map` re-entry, wait-timer wake) go
     * through {@link resumeInternal} and are not re-gated — they continue work
     * some already-authorized call started.
     */
    resume(runId: string, signal?: ResumeSignal): Promise<AutomationResult> {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof resume> = {
            refuseGatedResume: (...a) => this.refuseGatedResume(...a),
            resumeInternal: (...a) => this.resumeInternal(...a),
        };
        return resume.call(host, runId, signal);
    }

    /**
     * The resume gate (#3801): decide whether `signal` may continue the run
     * `runId` is parked on, returning a refusal result or `null` to allow.
     *
     * Keyed on the SUSPENDED NODE, not the caller or the route — an `approval`
     * pause continues only through `ApprovalService` (which records the
     * decision and enforces the slate), while a `screen` pause stays open to
     * the flow-runner that owns it. The service-side resume proves itself with
     * an in-process symbol the transport cannot mint from a JSON body.
     *
     * Resolves the EFFECTIVE suspension first: a run parked on a `subflow` or
     * `map` node is really waiting on a CHILD run, so the gate follows that
     * chain and judges the node the signal lands on (subflow) or would advance
     * past (map) — see {@link LINKED_RUN_PREFIXES}. A run it cannot resolve at
     * all (unknown run id, nothing suspended, no resolvable node type) is left to
     * `resumeInternal`, which reports the machine-state error — the gate only
     * ever speaks to authorization.
     *
     * **An UNDECLARED node type is refused, not deferred** (#5561 step two). It
     * used to be let through on the schema default's inherited `'any'`; a pause
     * whose type never stated who may continue it is now closed until its author
     * states it. The refusal says WHICH of the two reasons applies, because they
     * ask opposite things of the reader: a declared `'service'` node is working
     * exactly as designed and the caller must go through the owning service,
     * while an undeclared one is a missing one-line declaration on a descriptor
     * and the fix belongs to whoever registered it. Emitting the `'service'`
     * wording for both would tell an author their node declares something it
     * never declared — the failure mode this whole issue is about, restated as a
     * log line.
     */
    private refuseGatedResume(runId: string, signal?: ResumeSignal): Promise<AutomationResult | null> {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof refuseGatedResume> = {
            resolveEffectiveSuspension: (...a) => this.resolveEffectiveSuspension(...a),
            resolveSuspendedNodeType: (...a) => this.resolveSuspendedNodeType(...a),
            resolveResumeAuthority: (...a) => this.resolveResumeAuthority(...a),
            resolveDeclaredResumeAuthority: (...a) => this.resolveDeclaredResumeAuthority(...a),
            logger: this.logger,
        };
        return refuseGatedResume.call(host, runId, signal);
    }

    /**
     * The authority a node type **declared**, following a deprecated ADR-0018
     * alias to its canonical type — `undefined` when nothing declared one.
     *
     * An alias's descriptor is synthesized by {@link registerNodeAlias} and does
     * NOT copy the canonical's capabilities, so reading it directly would hand
     * anyone who authors the old type name an ungated pause — the gate is
     * declared and not enforced, one rename away. Resolving live (rather than
     * snapshotting at alias-registration time) also keeps it correct whichever
     * order the two register in. No alias of a pausing type exists today; this
     * keeps it from becoming a hole the day one does.
     *
     * Split out from {@link resolveResumeAuthority} because since #5561 step two
     * the two facts differ: a type that declared `'service'` and a type that
     * declared nothing are both refused, but for opposite reasons, and the
     * refusal has to say which (one is working as designed, the other is a
     * missing one-line declaration). One walk, so the alias hop can never be
     * implemented twice and drift.
     */
    private resolveDeclaredResumeAuthority(nodeType: string): ActionDescriptor['resumeAuthority'] {
        return this.resolveCanonicalDescriptor(nodeType)?.resumeAuthority;
    }

    /**
     * The descriptor whose CAPABILITY declarations govern a node type: the one
     * registered under that type, or — when that one is a deprecated ADR-0018
     * alias — the canonical descriptor it forwards to.
     *
     * The alias hop is the whole reason this is a function rather than a map
     * lookup, and the reasoning is {@link registerNodeAlias}'s: an alias's
     * descriptor is SYNTHESIZED, so it carries the schema defaults for every
     * capability (`supportsPause: false`, `resumeAuthority` absent) rather than
     * the canonical's real values. Reading it directly would make each capability
     * gate answer "no" for the old type name — one rename away from either a hole
     * (#5561's, if the gate fails open) or a false refusal (#6667's, if it fails
     * closed). Resolving live rather than snapshotting at alias-registration time
     * also keeps the answer right whichever order the two register in. No alias
     * of a pausing type exists today; this keeps it from becoming a defect the
     * day one does.
     *
     * Extracted at #6667 so the two capability gates that need the hop —
     * {@link resolveDeclaredResumeAuthority} (who may resume) and
     * {@link refuseUndeclaredSuspension} (may this type pause at all) — share
     * ONE walk. Two copies of a four-line loop is exactly how one of them
     * acquires a bound the other lacks.
     */
    private resolveCanonicalDescriptor(nodeType: string): ActionDescriptor | undefined {
        let descriptor = this.actionDescriptors.get(nodeType);
        for (let hop = 0; descriptor?.aliasOf && hop < AutomationEngine.MAX_ALIAS_HOPS; hop++) {
            const canonical = this.actionDescriptors.get(descriptor.aliasOf);
            if (!canonical || canonical === descriptor) break;
            descriptor = canonical;
        }
        return descriptor;
    }

    /**
     * Refuse a suspension the node type never declared it could produce — the
     * runtime half of `supportsPause` (#6667, from #5703).
     *
     * Returns a guard refusal when the node type publishes a descriptor whose
     * (alias-resolved) `supportsPause` is not `true` and its executor just
     * returned `suspend: true`; `null` when there is nothing to refuse.
     *
     * ## Why refuse rather than pause-and-log
     *
     * Honouring the pause and logging `error` was the alternative, and it loses
     * on consequence. A type that leaves `supportsPause` false is, in the same
     * breath, a type `check:resume-authority-declared` does not gate and
     * {@link warnIfResumeAuthorityUndeclared} does not warn about — both key on
     * `supportsPause: true` — so it almost certainly declares no
     * `resumeAuthority` either, and since #5561 step two an undeclared authority
     * resolves to `'service'`: the generic resume route REFUSES every pause it
     * creates. Honouring the suspension therefore writes a durable continuation
     * for a run that nothing can continue, and the `error` line is printed in the
     * process that paused — hours or a restart before anyone tries to resume and
     * gets a `PERMISSION_DENIED` that names `resumeAuthority`, not the
     * `supportsPause` that actually caused it. That is Prime Directive #10
     * exactly: advertising a capability (a resumable pause) the runtime does not
     * deliver, discovered by someone who cannot connect it back.
     *
     * Refusing fails the run at the moment of the mistake, in the process that
     * made it, with the failure handed to the run's own caller and NOTHING
     * durable written — and the message names the one-line fix. It is the same
     * direction #5561 chose for the neighbouring guess: the loud mistake is
     * discoverable by the person who made it; the silent one is not.
     *
     * No log line is emitted here, deliberately. This is AGENTS.md's third legal
     * answer under "Degradation log levels" — a failure handed to the CALLER is
     * not a degradation, and the run's own `failed` history row already carries
     * the message. A `logger.error` on top would fire once per execution of a
     * mis-declared node, which is what makes `error` unreadable.
     *
     * ## What it does NOT judge
     *
     *  - **The inverse.** `supportsPause: true` on a type that never suspends is
     *    not a mismatch: the declaration is a capability, not an obligation, and
     *    `wait` legitimately returns without suspending when its condition is
     *    already met.
     *  - **Silence.** A node type that publishes NO descriptor declares nothing —
     *    not even `false` — so there is no declaration for this gate to enforce,
     *    and `NodeExecutor.descriptor` is optional by contract. Its pauses are
     *    already fail-closed at the other end (#5561: an absent descriptor means
     *    an absent `resumeAuthority`, so the generic route refuses them and says
     *    so). Refusing here as well would delete that behaviour, which
     *    `resume-authority-gate.test.ts`'s `bare_pause` case pins on purpose.
     */
    private refuseUndeclaredSuspension(nodeType: string): NodeExecutionResult | null {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof refuseUndeclaredSuspension> = {
            resolveCanonicalDescriptor: (...a) => this.resolveCanonicalDescriptor(...a),
        };
        return refuseUndeclaredSuspension.call(host, nodeType);
    }

    /**
     * The `resumeAuthority` in force for a node type: what it declared, or
     * {@link RESUME_AUTHORITY_WHEN_UNDECLARED} when it declared nothing.
     *
     * **The fallback is the whole of #5561 step two.** With no schema default on
     * `resumeAuthority` (step one), an undeclared descriptor arrives with the key
     * absent and this is the ONE place that resolves it — so this single
     * expression is where "a pause nobody claimed" is either open to the world or
     * closed to everyone. It used to resolve `'any'`, inherited from the schema
     * default step one removed; it now resolves `'service'`, and a pause whose
     * node type never stated who may continue it is refused on the generic route
     * until its author says otherwise.
     *
     * That is the direction #3823 was decided in: ADR-0044 pointed a revise edge
     * at a generic `wait`, `wait` is legitimately `'any'`, and the pause standing
     * in a service-owned position inherited a fail-open value nobody chose. The
     * cost of guessing wrong is asymmetric — guessing `'any'` walks past a
     * decision nothing recorded, guessing `'service'` returns a refusal that names
     * the one-line fix — so the guess is made in the direction that is loud
     * instead of the direction that is silent.
     */
    private resolveResumeAuthority(nodeType: string): NonNullable<ActionDescriptor['resumeAuthority']> {
        return this.resolveDeclaredResumeAuthority(nodeType) ?? AutomationEngine.RESUME_AUTHORITY_WHEN_UNDECLARED;
    }

    /**
     * What an UNDECLARED `resumeAuthority` resolves to (#5561 step two).
     *
     * The single source of truth for the fail-closed default — the registration
     * warning, the refusal message and {@link resolveResumeAuthority} all speak
     * about the same constant rather than three copies of a string literal.
     * `ActionDescriptorSchema.resumeAuthority` deliberately carries no Zod
     * `.default()` (that is what makes an omission observable at all), so this is
     * the default in every sense that matters at run time.
     */
    private static readonly RESUME_AUTHORITY_WHEN_UNDECLARED = 'service' as const;

    /** Depth bound for the subflow chain walk — a corrupt correlation cycle
     *  must not spin the gate. Far above any real nesting. */
    private static readonly MAX_SUSPENSION_CHAIN_DEPTH = 32;

    /** Depth bound for the alias → canonical hop in {@link resolveResumeAuthority}. */
    private static readonly MAX_ALIAS_HOPS = 4;

    /**
     * Linked-run correlation prefixes the gate walks (#3853). Both park a
     * parent on a child run, so in both the pending work — and therefore the
     * authority that governs continuing it — belongs to the CHILD, even though
     * `resumeInternal` handles the two oppositely:
     *
     *  - `subflow:` — the signal is DELEGATED down to the child, so the child's
     *    node is literally where it lands.
     *  - `map:` — the signal is not delegated; the `map` node RE-RUNS, and since
     *    `$mapState.started` was advanced past the in-flight item before the
     *    suspend, continuing here advances the map *past* the item whose child
     *    is still parked. Judging the parent's own `map` node (always
     *    `resumeAuthority: 'any'`) let a raw resume skip a pending approval in a
     *    batch-approval flow — the gate has to read the item, not the loop.
     */
    private static readonly LINKED_RUN_PREFIXES = ['subflow:', 'map:'] as const;

    /**
     * Follow the linked-run chain from `runId` to the suspension whose node
     * actually governs a resume — see {@link LINKED_RUN_PREFIXES}. The deepest
     * reachable suspension, not the id the caller holds, is what a resume
     * really continues (or skips past). Returns `null` when nothing is
     * suspended under that id; stops at the last resolvable link when a child
     * row is gone (that run is where `resumeInternal` will continue).
     */
    private async resolveEffectiveSuspension(runId: string): Promise<SuspendedRun | null> {
        const seen = new Set<string>();
        let run = await this.loadSuspendedRun(runId);
        for (let depth = 0; run && depth < AutomationEngine.MAX_SUSPENSION_CHAIN_DEPTH; depth++) {
            const correlation = run.correlation;
            const prefix = typeof correlation === 'string'
                ? AutomationEngine.LINKED_RUN_PREFIXES.find(p => correlation.startsWith(p))
                : undefined;
            if (!prefix) return run;
            const childRunId = correlation!.slice(prefix.length);
            if (!childRunId || seen.has(childRunId)) return run;
            seen.add(childRunId);
            const child = await this.loadSuspendedRun(childRunId);
            if (!child) return run;
            run = child;
        }
        return run;
    }

    /** Read a suspended run from the hot cache, falling back to the durable
     *  store. Read-only — never consumes the suspension.
     *
     *  Degrading form: a store read failure becomes `null`, i.e. "no such run".
     *  Correct for the incidental readers (a gate lookup, a screen fetch) that
     *  only need a best-effort answer. NOT correct for {@link resumeInternal},
     *  which must tell a dead run from an unreachable store — it uses
     *  {@link loadSuspendedRunStrict}. */
    private loadSuspendedRun(runId: string): Promise<SuspendedRun | null> {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof loadSuspendedRun> = {
            loadSuspendedRunStrict: (...a) => this.loadSuspendedRunStrict(...a),
            logger: this.logger,
        };
        return loadSuspendedRun.call(host, runId);
    }

    /** {@link loadSuspendedRun} without the degradation: a store read failure
     *  THROWS instead of reading as "no such run".
     *
     *  [#13617] STORE-AUTHORITATIVE. When a {@link SuspendedRunStore} is
     *  configured, the store answers and {@link suspendedRuns} answers only for
     *  a run the store never accepted ({@link cacheOnlySuspensions}). It used
     *  to be the other way round — this process's map first, the store only on
     *  a miss — which is a correct read for exactly one deployment shape: a
     *  single process. Put several replicas behind a load balancer over one
     *  database and that map is a per-replica snapshot of the node a run was
     *  parked at THE LAST TIME THIS REPLICA TOUCHED IT, and nothing invalidates
     *  it, because there is no invalidation channel to it at all.
     *
     *  The measured shape, a multi-level approval flow: replica A parks the run
     *  at `lv1` and keeps it in its map. The `lv1` decision round-robins to
     *  replica B, which advances the run to `lv2` in the store and in B's map;
     *  A's map still says `lv1`. The `lv2` decision lands back on A, which read
     *  its own map, resumed from `lv1`, and traversed to `lv2` a SECOND time —
     *  the same level re-created as a fresh pending request tens of
     *  milliseconds after the first one completed, so one approver approves
     *  every level twice. Land the same one-beat-stale read on the FINAL level
     *  and the run rolls back to the previous one instead of terminating. A
     *  single replica shows zero duplicates because there is one map and it is
     *  never behind.
     *
     *  Both callers that must not be wrong funnel through here: `resumeInternal`
     *  (which node does this resume continue from) and {@link hasSuspendedRun}
     *  (the approvals pre-flight that decides whether to record a decision at
     *  all), so one seam settles both.
     *
     *  ⛔ NOT a re-ordering of the resume path. The suspension is still consumed
     *  before `traverseNext` and {@link forgetSuspendedRun} is untouched —
     *  the #13937 shape-4 ruling (maintainer 2026-09-01) keeps that order, for
     *  exactly-once across a crash. This changes only WHICH suspension is
     *  read, never when it is consumed. */
    private loadSuspendedRunStrict(runId: string): Promise<SuspendedRun | null> {
        // The body lives in ./run-resume.ts (#25222).
        const readStore = () => this.store;
        const host: ThisParameterType<typeof loadSuspendedRunStrict> = {
            get store() { return readStore(); },
            suspendedRuns: this.suspendedRuns,
            cacheOnlySuspensions: this.cacheOnlySuspensions,
            evictConsumedSuspension: (...a) => this.evictConsumedSuspension(...a),
        };
        return loadSuspendedRunStrict.call(host, runId);
    }

    /**
     * Whether a suspension exists for `runId`, in the hot cache or the durable
     * store. Read-only — never consumes the suspension.
     *
     * For callers that must know a run is resumable BEFORE they write anything
     * of their own: approvals pre-flights this so a decision is never recorded
     * against a run that can no longer advance (#4420).
     *
     * THROWS when the durable store cannot be read — an outage means "unknown",
     * and a caller must not act on it as if the run were gone. That is the one
     * axis {@link getRun} still differs on: since #8050 it, too, sees a run
     * suspended by a previous process, but as an OBSERVABILITY read it degrades
     * a store failure to `null` with a warning rather than throwing. Use this
     * one before writing anything of your own; use `getRun` to display.
     */
    async hasSuspendedRun(runId: string): Promise<boolean> {
        return (await this.loadSuspendedRunStrict(runId)) !== null;
    }

    /**
     * Credit a completed child run's totals to the parent step waiting on it
     * (#4354).
     *
     * A `subflow` / `map` child that PAUSED cannot report through
     * `NodeExecutionResult.metrics` the way a synchronous one does: the parent's
     * step for that node was written at suspend time, before the child had done
     * anything. Without this, a sweep whose writes all happen inside a paused
     * child would report `acted: 0` — a healthy run indistinguishable from a
     * dead one, which is the exact confusion this feature exists to remove.
     *
     * The credit lands on the LAST step for the node, which is the entry that
     * suspended awaiting this child — so a `map` re-entering once per item
     * credits each item to its own step and nothing is counted twice.
     *
     * Both call sites are COMPLETION paths — the up-bubble is raised only from
     * a child that completed, and the down-delegation path returns on
     * `!childRes.success` before reaching here — which is what lets #15617's
     * `failures` ride this seam under exactly its declared rule: the contained
     * failures of a child that COMPLETED, never a failed child's own `failed`.
     */
    private creditChildRun(steps: StepLogEntry[], nodeId: string, child: FlowRunSummary | undefined): void {
        // The body lives in ./run-resume.ts (#25222).
        creditChildRun(steps, nodeId, child);
    }

    /**
     * @param skipBubble - Set when the caller is the subflow DELEGATION path,
     *   which continues the parent itself after the child completes — the
     *   child's own up-bubble must stay off so the parent isn't resumed twice.
     * @param childSummary - #4354: totals of the child run whose completion
     *   triggered this resume (the up-bubble path), credited to the awaiting step.
     * @param childRefusal - [#18714] Set ONLY by {@link bubbleToParent}'s
     *   refusal arm: the child this run is parked on finished `refused`, so
     *   this run must refuse too instead of continuing past its `subflow` /
     *   `map` node. Carried as a parameter rather than on the resume signal
     *   because it is engine-internal control flow, not data the parent's
     *   variable map should ever see — the reserved-name guard
     *   (`applyResumeSignal`) polices that map, and a refusal is not a variable.
     */
    private async resumeInternal(
        runId: string,
        // Never `undefined` past the public door: `resume` normalises an
        // absent caller signal to `{}` (commit 7307191db), and the engine's own
        // continuations (subflow delegation / up-bubble, `map` re-entry)
        // always hand over a built signal. Typed so, the chokepoints below
        // cannot grow a falsy-signal branch again.
        signal: ResumeSignal,
        skipBubble: boolean,
        childSummary?: FlowRunSummary,
        childRefusal?: ChildRunRefusal,
    ): Promise<AutomationResult> {
        // Idempotency guard (set synchronously, before any await): reject a
        // concurrent duplicate resume of the same run so side effects can't run
        // twice. A duplicate that arrives *after* this one finishes finds no
        // suspended run and returns the "no suspended run" error below.
        if (this.resuming.has(runId)) {
            return { success: false, code: 'RESUME_IN_PROGRESS', error: `Run '${runId}' is already being resumed` };
        }
        this.resuming.add(runId);
        try {
            // Hot path: suspended in this process. Cold path: rehydrate from the
            // durable store (e.g. the process restarted since the pause, ADR-0019).
            //
            // Strict load: a store that cannot be READ must not report as
            // "no such run" (#4420). A caller that already persisted a decision
            // needs "retry when the store is back" to be distinguishable from
            // "this run is gone for good" — same failure, opposite remedy.
            let run: SuspendedRun | null;
            try {
                run = await this.loadSuspendedRunStrict(runId);
            } catch (err) {
                const message = (err as Error).message;
                // #5912 — the LOG record's cause goes to `meta`, never into the
                // message. `message` is the datasource DRIVER's own failure text
                // and we do not control how many lines it has;
                // `ObjectLogger.write()` adds one `<ts> <LEVEL>` head per call, so
                // a newline in it turns this ONE record into several physical
                // lines of which only the first is greppable — the family of
                // #5048 / #5575 / #5636 / #5661 / #5737, and cloud#971's shape.
                //
                // Third argument, per the `Logger` contract
                // (`packages/spec/src/contracts/logger.ts`)
                // `error(message, error?, meta?)`. NOT the second: that is the
                // `Error` slot and a raw error there ships its whole stack on
                // every record (#5575). `runId` stays in the message — it is the
                // caller's own handle, the same call the family's other seams
                // make for their ids, not the foreign text this fix is about.
                //
                // Level stays `error`: the run is on disk and the resume did not
                // land, which is #4632's durability degradation exactly.
                this.logger.error(
                    `[automation] durable suspended-run store unreachable while resuming '${runId}' — the suspension was ` +
                        `NOT consumed, so the run stays parked and this resume can be retried verbatim once the store is ` +
                        `reachable; the caller was told the same via the STORE_UNAVAILABLE result. The store's own failure ` +
                        `is in this record's meta.`,
                    undefined,
                    describeThrownForLog(err),
                );
                // The RESULT envelope keeps the cause spliced in, verbatim and
                // deliberately (#5636 made the same call for `degradedReason`):
                // this is a structured return value a caller reads as a whole —
                // over REST it is a JSON string field, never split on newlines —
                // and PR #5911 already made wait-node put it into `meta` intact.
                return {
                    success: false,
                    code: 'STORE_UNAVAILABLE',
                    error: `Durable suspended-run store unreachable for run '${runId}' — retry once the store is available: ${message}`,
                };
            }
            if (!run) {
                return { success: false, code: 'RUN_NOT_FOUND', error: `No suspended run '${runId}'` };
            }
            // [#8684] The two NEVER-DISPATCHED exits, classified HERE rather than
            // guessed at the transport. Both mean the suspension is real but can
            // never continue — the flow it belongs to is no longer registered, or
            // the node it parked on was edited away underneath it. Nothing ran,
            // so neither is a business rejection: they are the same terminal
            // "this pause is gone for good" class as a missing suspension, and a
            // transport answers all three **404**.
            //
            // Code-less until now, which is what forced the route to either
            // answer them 200 (the defect this card is about) or sniff the result
            // for `summary`/`durationMs` to tell them from a run that ran and
            // failed — the tolerant-consumer shape PD #12 forbids. The producer
            // is the only component that knows, so it says so.
            //
            // Deliberately the EXISTING `RUN_NOT_FOUND` rather than a new code:
            // the remedy is identical (this run is finished; start a new one),
            // the consumer branches on the 404 STATUS and not on the code
            // (objectui's `interpretFlowResponse`), and `error` below still names
            // which of the three causes it was, verbatim on the wire. A distinct
            // code would be vocabulary nothing reads — add one the day a caller
            // needs to branch on the difference.
            //
            // [#23963] And the verdict is carried onto the RUN, not only onto
            // the answer: both exits go through
            // {@link settleUnresumableSuspension}, which moves the parked row to
            // `failed` with this same text in `error`. Answering "gone for
            // good" while the row kept `status: 'paused'` left it resumable on
            // every surface that reads the row, and outside retention, whose
            // scope is terminal statuses only.
            const flow = this.flows.get(run.flowName);
            if (!flow) {
                return this.settleUnresumableSuspension(run, `Flow '${run.flowName}' not found for run '${runId}'`);
            }
            const node = flow.nodes.find(n => n.id === run.nodeId);
            if (!node) {
                return this.settleUnresumableSuspension(
                    run,
                    `Suspended node '${run.nodeId}' no longer exists in flow '${run.flowName}'`,
                );
            }

            // #4354 — up-bubble: the child that just finished did work this run
            // is accountable for. Credit it to the step that suspended awaiting
            // it, before traversal appends anything further.
            this.creditChildRun(run.steps, run.nodeId, childSummary);

            // [#18714] The refusal this run must end on instead of continuing
            // past its `subflow` / `map` node, if any. Seeded from the UP-BUBBLE
            // leg (the child's own frame drove this resume and already knows),
            // and set below by the DELEGATED leg (this frame drives the child
            // and reads its answer). Both legs hand it to the ONE throw site
            // inside the traversal `try` further down, so a refusal leaves this
            // method through the same `finishRefusedRun` chokepoint every other
            // producer uses — see `ChildRunRefusal`.
            let pendingChildRefusal: ChildRunRefusal | undefined = childRefusal;

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
                const childRun = await this.loadSuspendedRun(childRunId);
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
                            // THIS run's flow, not the child's: the caller
                            // addressed this run id and its runner names the
                            // flow it launched. The child only lends a screen.
                            flowLabel: flow.label,
                        };
                    }
                    // [#14379] A child REFUSAL is not a child failure. The
                    // codes in {@link RETRYABLE_RESUME_REFUSAL_CODES} are this
                    // method's own answers for a resume that never ran: the
                    // child's screen contract is checked BEFORE
                    // `forgetSuspendedRun` precisely so "a rejected bag leaves
                    // the pause live and the legitimate submission still lands"
                    // (#4477), so the child is parked exactly where it was.
                    //
                    // Reading those as a terminal failure consumed the PARENT's
                    // pause over a mistyped form field — and the screen-flow
                    // path is where a caller holds ONE stable run id, the
                    // parent's, and posts every wizard step to it. The run was
                    // gone, the still-paused child orphaned with nothing left
                    // to bubble into, the caller told `400 FLOW_FAILED` ("it
                    // ran and was rejected") for something that never ran, and
                    // their corrected retry on that same id answered
                    // `RUN_NOT_FOUND`.
                    //
                    // The child's envelope is answered VERBATIM but for the
                    // parent's `durationMs`. Propagating the `code` is half the
                    // fix: a code-less envelope is exactly what forced the
                    // transport onto `400 FLOW_FAILED`, and leaving both pauses
                    // alive while still answering one repairs the state and
                    // leaves the caller equally misled. The child's `error` is
                    // the actionable half — `Screen field "kind" is required` —
                    // where the failure text below names neither the problem
                    // nor anything a caller can act on. Nothing else moves:
                    // neither pause is consumed, and the parent's surfaced
                    // screen needs no refresh because the child did not
                    // advance.
                    if (!childRes.success && isRetryableResumeRefusal(childRes.code)) {
                        return { ...childRes, durationMs: Date.now() - run.startTime };
                    }
                    if (!childRes.success) {
                        const error = `subflow run '${childRunId}' (${childRun.flowName}) failed: ${childRes.error ?? 'unknown error'}`;
                        // [#15222] This frame consumes its OWN pause here, and
                        // before this card journalled nothing for it — so a
                        // child that stranded left a repairable leaf under an
                        // ancestor no verb could reach. Journalled exactly when
                        // the child is repairable, asked of the journal rather
                        // than of the child's `status`: a child that itself
                        // cascade-failed from a deeper strand carries no status
                        // word at all (see the return below) and is repairable
                        // all the same, which is what makes a chain deeper than
                        // two levels re-armable by induction.
                        //
                        // ⛔ And the envelope below is UNCHANGED — no status is
                        // stamped on it. `'stranded'` belongs to the run that
                        // consumed its own pause and then threw downstream;
                        // stamping it here would tell an operator to retry a
                        // recovery that cannot succeed, because nothing re-arms
                        // this run by resuming it. What reaches this run is
                        // {@link restoreConsumedSuspension}, through the
                        // journal one line up.
                        await this.failSuspendedRun(
                            run,
                            error,
                            this.consumedSuspensions.has(childRunId) ? childRunId : undefined,
                        );
                        return { success: false, error, durationMs: Date.now() - run.startTime, flowLabel: flow.label };
                    }
                    // [#18714] DELEGATED-LEG REFUSAL. The child ran to a
                    // refusing terminal — an `end` declaring
                    // `outcome: 'refused'`, or a node of its own whose child
                    // refused — and answered `{ success: true, status:
                    // 'refused' }`, because *a refusal is a successful
                    // evaluation that says no*. The branch set above tests only
                    // `paused` and `!success`, so until this arm existed a
                    // refused child was neither and fell straight through the
                    // ordinary success exit below: measured, the parent
                    // returned `{ success: true, successMessage: … }`, its run
                    // row recorded `completed`, and the node downstream of the
                    // `subflow` RAN. That is the identical fail-open shape
                    // #18110 / #18555 closed on the synchronous leg, still open
                    // on the leg 「the one a screen flow actually takes」.
                    //
                    // ⛔ NOT folded into the `!childRes.success` arm above. That
                    // arm calls `failSuspendedRun` and records the parent
                    // `failed`; a refusal is not a failure — it must not be
                    // routable by a `fault` edge, must not consume retry budget
                    // and must not be counted in `nodes[].failures`, all of
                    // which the failure arm would confer. The parent's terminal
                    // row must read `refused`, the same word the child's does.
                    //
                    // Recorded, ⛔ not thrown here. The pause is not consumed
                    // yet — `claimAdvance` / `forgetSuspendedRun` are still
                    // below — and a refusal that unwound from this position
                    // would leave the parent's own suspension live while its
                    // run row said terminal. The throw site inside the
                    // traversal `try` is past the consumption, which is why
                    // both legs converge there.
                    //
                    // The mapping below still runs, deliberately: the child's
                    // declared outputs really were produced and the nodes
                    // before its refusal really ran, so the parent's answer
                    // must not depend on HOW the child ended — the same call
                    // the synchronous `subflow` arm makes when it returns the
                    // success envelope PLUS `refuse`.
                    if (childRes.status === 'refused') {
                        pendingChildRefusal = { message: childRes.refusalMessage };
                    }
                    // Child completed — continue below with its output as the
                    // resume signal (replaces the caller's signal, which the
                    // child already consumed).
                    signal = this.buildSubflowResumeSignal(childRun.context, childRes.output);
                    // #4354 — down-delegation is the other way a child's work
                    // lands under a parent step written at suspend time.
                    this.creditChildRun(run.steps, run.nodeId, childRes.summary);
                } else if (carriesSubflowChildOutput(signal)) {
                    // The engine-built UP-BUBBLE — the HEALTHY path, and the
                    // one this `else` used to describe as a degradation. The
                    // child COMPLETED and `bubbleToParent` resumed this run
                    // with the child's mapped output, so the miss above is the
                    // SUSPENSION lookup missing (a completed run has no
                    // suspension), not the child having disappeared, and the
                    // parent continues *with* the child's output — which is
                    // what the old sentence denied outright.
                    //
                    // `debug`, for the same reason as the lost-advance-claim
                    // record further down: an ordinary outcome logged at `warn`
                    // on every healthy subflow completion is the cry-wolf
                    // shape — the operator who reads "child run is gone" on
                    // each one stops reading the line, and the one time it
                    // means what it says is the time it is ignored. Nothing
                    // else moves: this branch continues the parent exactly as
                    // before, and the degraded branch below keeps its text and
                    // its level.
                    this.logger.debug(
                        `[automation] run '${runId}' continues from subflow node '${run.nodeId}' with the output of ` +
                            `completed child run '${childRunId}' — carried on the engine-built up-bubble signal ` +
                            `(the child's suspension is consumed, which is why it is not loadable here).`,
                    );
                } else {
                    // The genuinely degraded case, and the only one the
                    // sentence below was ever true of: nothing suspended under
                    // the child id AND no carried output, so this run really
                    // does continue without the child's output. #4632 verdict:
                    // FUNCTIONAL — stays `warn`.
                    this.logger.warn(
                        `[automation] run '${runId}' is paused at subflow node '${run.nodeId}' but child run '${childRunId}' ` +
                            `is gone — continuing without child output`,
                    );
                }
            }

            // The SCREEN contract (#4477). A run parked on a `screen` node
            // declared exactly which keys it collects and which are required;
            // until this ran, `resume` folded any bag at all straight into the
            // variables, so a caller that skipped the dialog bypassed every
            // `required` the author wrote. Checked here — beside the engine's
            // other resume refusals and BEFORE the suspension is consumed — so
            // a rejected bag leaves the pause live and the legitimate
            // submission still lands.
            const screenRefusal = this.refuseInvalidScreenInput(run, runId, signal);
            if (screenRefusal) return screenRefusal;

            // Restore the variable context and fold the signal in — the ONE
            // place a resume signal reaches the variable map. Runs BEFORE the
            // suspension is consumed, so a rejected signal changes nothing:
            // the pause stays live and the legitimate continuation still lands.
            const variables = new Map<string, unknown>(Object.entries(run.variables));
            const rejected = applyResumeSignal(variables, signal, run.nodeId);
            if (rejected.length) {
                // #6654 — the rejected names are the CALLER's resume-signal
                // keys (nothing constrains them against newlines), so they
                // ride the structured slot, never the message; see
                // `forgetSuspendedRun`'s catch for the full mechanism (#6299).
                // The returned INVALID_SIGNAL envelope below is caller-facing
                // refusal text, not a log record — it keeps naming the
                // variables (the envelope class is ruled elsewhere).
                // #4632: FUNCTIONAL — stays `warn`.
                this.logger.warn(
                    `[automation] refused resume of run '${runId}': signal writes engine-internal ` +
                        `variable(s) — the rejected names are in this record's meta.`,
                    { rejected },
                );
                return {
                    success: false,
                    code: 'INVALID_SIGNAL',
                    error:
                        `Resume signal may not set engine-internal variables (${rejected.join(', ')}) — ` +
                        `names starting with '$' (or containing '.$') are reserved by the flow engine`,
                };
            }

            // [#13909] How long the step log was AT THE PAUSE, read before
            // anything downstream runs. `steps` below is the SAME array
            // `traverseNext` appends to, so by the time the catch arm builds a
            // restore snapshot the pause's own step log is no longer
            // recoverable from it — this integer is what trims it back. One
            // `int` on every resume and nothing else: the snapshot itself is
            // built only on the failure path.
            //
            // ⛔ Deliberately NOT a change to the ordering. The consumption
            // below still precedes the traversal, `forgetSuspendedRun` is
            // untouched, and `hasSuspendedRun` still answers false for the
            // whole traversal window (pinned in
            // `consumed-suspension-restore.test.ts`). That order is RULED,
            // not inherited: #13937 shape 4 (maintainer 2026-09-01) keeps it
            // for exactly-once across a crash, excludes the flip (shape 2)
            // unless a durable claim/lease lands with it, and excludes
            // consume-then-re-arm (shape 3) outright. The exit from the state
            // it leaves behind is `restoreConsumedSuspension`, and the state
            // itself is named on the result (`status: 'stranded'`, below).
            const stepCountAtPause = run.steps.length;
            // [#15660] …and the variables AT THE PAUSE, for the same reason and
            // at the same moment, because `run.steps.length` is not the only
            // thing the failed attempt can move under the journal.
            //
            // `journalConsumedSuspension` promises its snapshot VERBATIM — "the
            // state at the pause, not the state the failed attempt was working
            // from" — and delivered that only for the TOP-LEVEL keys. The scope
            // the downstream nodes run against is built one line below as
            // `new Map(Object.entries(run.variables))`, which copies the keys
            // and SHARES every value object. A node that holds state in the
            // scope and updates it in place — `map` keeps `<nodeId>.$mapState`
            // and is, by a re-derived census, the only executor that does —
            // therefore writes straight through into the object the journal
            // later hands an operator as the pause.
            //
            // Measured, not read (`consumed-suspension-snapshot-aliasing.test.ts`):
            // the durable row held `started: 1` at the pause and the restore put
            // back `started: 99`. ⛔ And the two placements the card proposed
            // are both refuted by that same measurement:
            //   - "deep copy at SNAPSHOT time" — `InMemorySuspendedRunStore`
            //     already JSON round-trips on save AND load, so this run's
            //     variables ARE a private deep copy before a single downstream
            //     node runs. It reproduces anyway: the aliasing that carries the
            //     mutation is minted HERE, on the resume, not at the suspend.
            //   - "copy at RESTORE time" — the mutation lands before the node
            //     throws, so the journal is already corrupt when it is written;
            //     anything copied at or after that point copies the corruption.
            // The copy has to be taken before the failed attempt runs, which is
            // this line.
            //
            // Cost, measured rather than assumed (the card flagged it NOT
            // MEASURED): 5.8 µs for a typical scope, and one suspend+resume
            // round trip against a configured store already performs FOUR full
            // clones of this same payload (save ×1, load ×2, recordTerminal ×1),
            // so this is a fifth on a path whose production cost is a durable
            // round trip. ⛔ Deliberately NOT the JSON clone the journal's own
            // docblock ruled out: that objection was that it would run INSIDE a
            // catch arm already handling a failure, where a circular value would
            // throw the operator's repair away. Here it is on the happy path,
            // where a throw is just a value we decline to copy.
            const variablesAtPause = this.cloneVariablesAtPause(run, runId);

            // Ruling A on `FlowSchema.runAs`: who runs the nodes after this
            // pause — the decider, when the owning service's signal names one
            // (with their own grants on a `runAs:'user'` run, as the attribution
            // user of a still-elevated `runAs:'system'` run); otherwise the
            // identity the run paused with.
            // Resolved BEFORE the claim, so nothing here can run after the
            // suspension is consumed and leave it consumed with no continuation;
            // the persisted `run.context` is left as it was, and the repair
            // journal therefore still snapshots the pause exactly as it parked.
            const segmentContext = await this.resolveDecisionSegmentContext(run, signal);

            // Consume the suspension *before* running downstream work — a run
            // resumes exactly once per pause, and a duplicate resume after a
            // partial restart must not double-run side effects. (Folding the
            // signal above is pure in-memory work, not downstream work.)
            // This is also where the paused node learns its pause is over and
            // disarms what it armed on entry (#5512) — see forgetSuspendedRun.
            //
            // [#14333] And the consumption is now a CLAIM, not an assertion.
            // `resuming` above answered "is this process already resuming it";
            // this answers "did any process get here first", against the shared
            // store, atomically. Placed exactly where the unconditional consume
            // was: every refusal above it still refuses without consuming, and
            // the ordering #13937 ruled to keep is untouched.
            const claim = await this.claimAdvance(run);
            if (claim.kind === 'lost') {
                // An ORDINARY outcome, not a degradation: this is the guard
                // doing its job, and the caller is told in the result. `debug`
                // rather than `warn` for exactly that reason — a losing racer
                // per approval on a busy any-of level would otherwise be a
                // steady `warn` stream describing correct behaviour.
                this.logger.debug(
                    `[automation] resume of run '${runId}' lost the advance claim at node '${run.nodeId}' — ` +
                        `another replica consumed this suspension first; nothing was dispatched here.`,
                );
                // The SAME code the in-process guard answers, deliberately: the
                // observation differs (another process, not this one) but the
                // remedy is identical — a concurrent resume already has this
                // run, the caller's own recorded outcome stands, and nothing
                // here should be retried. `plugin-approvals` already branches
                // on it that way (`resumeRecordedOutcome`), and the transport
                // already maps it to 409. A distinct code would be vocabulary
                // nothing reads — add one the day a caller needs the
                // difference.
                // [#15832] The store's compare-and-set ANSWERED: no row is parked
                // where this replica read it. Whatever snapshot this process
                // still holds for the run is stale by construction — it names a
                // node the run has left — so it stops being published by the two
                // listings. ⛔ NOT `forgetSuspendedRun`: nothing was consumed
                // here, and firing that choke point would tear the pause down a
                // second time in this process on top of the winner's own.
                this.evictConsumedSuspension(runId);
                return {
                    success: false,
                    code: 'RESUME_IN_PROGRESS',
                    error:
                        `Run '${runId}' is already being resumed — another replica consumed its suspension ` +
                        `at node '${run.nodeId}' first`,
                };
            }
            if (claim.kind === 'unavailable') {
                // Same envelope, same reason as the strict load's failure
                // above: existence is UNKNOWN, not "gone for good", and the
                // identical call is expected to work once the store recovers
                // (#4420).
                //
                // The text states only what is KNOWN. The strict load's failure
                // can say the suspension was not consumed, because it fails
                // before anything is consumed; this one cannot — a claim throws
                // just as readily after a committed delete as before one, so
                // "NOT consumed" would be a claim about a fact this seam does
                // not have. What it does know is that this resume did not
                // continue the run, and that a retry settles the rest.
                return {
                    success: false,
                    code: 'STORE_UNAVAILABLE',
                    error:
                        `Durable suspended-run store unreachable while claiming the advance for run '${runId}' — ` +
                        `this resume did NOT continue the run, and whether the store consumed the suspension is ` +
                        `UNKNOWN (a failure can arrive after a committed delete). Retry once the store is ` +
                        `available: a retry that finds the run still parked continues it, and one that finds the ` +
                        `suspension gone answers RUN_NOT_FOUND: ${claim.message}`,
                };
            }
            await this.forgetSuspendedRun(run, 'resumed', claim.kind === 'claimed');

            const steps = run.steps;
            const context = segmentContext;

            try {
                // [#18714] The child this run is parked on REFUSED — on either
                // resumed leg (see `ChildRunRefusal`). Thrown HERE, and the
                // position is the point:
                //
                //  - Past the consumption. `claimAdvance` and
                //    `forgetSuspendedRun` have run, so the parent's own pause is
                //    gone exactly as it is for every other way this resume can
                //    end. A refusal raised before them would record a terminal
                //    run while leaving its suspension live in
                //    `listSuspendedRuns()` — the very leak the up-bubble leg is
                //    filed for, moved one frame up.
                //  - Before the traversal. Nothing downstream of the awaiting
                //    node runs, which is the whole content of "a refusal stops
                //    the run".
                //  - As `FlowRefusalSignal`, so the `catch` below converts it
                //    through `finishRefusedRun` — ONE terminal shape, whichever
                //    producer raised it. ⛔ Deliberately not a second terminal
                //    exit of its own: this file's own history is a list of
                //    outcomes that became a function of WHICH ROUTE a run took.
                //
                // `run.nodeId` is the node that was awaiting the child — the
                // `subflow` / `map` this frame is parked on, the same node the
                // synchronous leg names on its `FlowRefusalSignal`.
                if (pendingChildRefusal) {
                    throw new FlowRefusalSignal(run.nodeId, pendingChildRefusal.message);
                }
                // ── Map re-entry (sequential multi-instance, ADR-0037 A2).
                // A run paused at a `map` node (correlation `map:<childRunId>`)
                // does NOT continue past the node on resume — it RE-RUNS the
                // node so the executor can record the just-completed unit and
                // start the next item. The default path continues past the node.
                if (typeof run.correlation === 'string' && run.correlation.startsWith('map:')) {
                    await this.executeNode(node, flow, variables, context, steps);
                } else {
                    await this.traverseNext(node, flow, variables, context, steps, signal.branchLabel);
                }

                // Collect output variables
                const output: Record<string, unknown> = {};
                if (flow.variables) {
                    for (const v of flow.variables) {
                        if (v.isOutput) output[v.name] = variables.get(v.name);
                    }
                }
                const durationMs = Date.now() - run.startTime;
                // [#15944] THE RUN IS OVER AND IT SUCCEEDED. Everything from
                // here to the return is BOOKKEEPING ABOUT that fact, and the
                // `catch` below this `try` exists for NODE failures — so a
                // throw out of the history write was handled as though a node
                // had thrown: the arm journalled a repair snapshot, stamped
                // `status: 'stranded'`, answered `success: false`, and
                // {@link restoreConsumedSuspension} then honoured that
                // snapshot and re-armed the pause, so the NEXT resume RE-RAN
                // every node after it. Measured: `tail` ran twice.
                //
                // The guard restores the invariant `recordLog`'s own doc
                // states two screens down — "a history write must NEVER block
                // or break the run that produced it" — which that call was
                // relied upon to keep and did not.
                //
                // Two statements inside `recordLog` reach here on the terminal
                // path, and neither is hypothetical: `store.recordTerminal`,
                // whose SYNCHRONOUS throw escapes because the
                // `void write.catch(...)` beneath it only ever sees a returned
                // promise's rejection (both shipped stores are `async` and
                // cannot; the interface is exported, optional, and
                // host-implementable, and a store returning a non-thenable
                // makes `write.catch` itself a synchronous TypeError), and the
                // run-summary line `this.logger.info(line, meta)`, on by
                // default and calling a HOST-INJECTED logger.
                //
                // ⛔ NOT a widening of anything: no exit gains a status it
                // did not have, the node-failure arm below is untouched, and
                // the failure is REPORTED rather than swallowed — see the
                // catch. ⛔ And ⛔ deliberately not fixed at
                // `restoreConsumedSuspension`: that verb judged correctly on
                // the evidence it was handed; the evidence is what was wrong,
                // and no journal is written for a completed run at all now.
                let logged: ExecutionLogEntry | undefined;
                try {
                    logged = this.recordLog({
                        id: runId,
                        flowName: run.flowName,
                        flowVersion: run.flowVersion,
                        status: 'completed',
                        startedAt: run.startedAt,
                        completedAt: new Date().toISOString(),
                        durationMs,
                        trigger: buildRunTrigger(context),
                        steps,
                        output,
                    }, context);
                } catch (bookkeeping) {
                    // #4632 verdict: DURABILITY, so `error` — the caller is
                    // told the truthful thing (the run completed), which is
                    // exactly what makes the rest invisible from the outside:
                    // the terminal history row never landed, nothing retries
                    // it, and no envelope carries a word about it. After the
                    // next restart the run is invisible to the Runs surfaces
                    // and the approvals sweeps read the hole —
                    // `inspectStrandedRequests` reads "no suspension + no
                    // terminal row" as a STRANDED request, and
                    // `releasePendingForTerminalRuns` reads "no terminal row"
                    // as still-alive. Consequence and fix in the first line,
                    // per AGENTS.md. Said ONCE per run, not once per failed
                    // write.
                    //
                    // THIRD argument per `error(message, error?, meta?)`; the
                    // `Error` slot stays empty on purpose (#5575), and the
                    // thrown text goes to the structured slot rather than into
                    // the message (#6499).
                    this.logger.error(
                        `[Automation] run '${runId}' of flow '${run.flowName}' COMPLETED successfully but its ` +
                            `run-history bookkeeping threw, so its terminal history row never landed — nothing ` +
                            `retries it, the caller is told the run succeeded, and after the next restart this ` +
                            `run is invisible to the Runs surfaces while the approvals sweeps read it as ` +
                            `stranded and never-finished. The run itself is COMPLETE and must NOT be repaired ` +
                            `or re-run. Fix the history failure in this record's meta.`,
                        undefined,
                        describeThrownForLog(bookkeeping),
                    );
                }
                // [#15944] Recomputed when the guard above had to abandon
                // `recordLog`: the same pure function of the same steps that
                // `recordLog`'s own first statement runs, so the two spellings
                // cannot disagree. Same shape as the strand arm's below.
                const summary = logged?.summary ?? summarizeRun(steps);

                // ── Subflow up-bubble (nested pause): this run was a subflow
                // child whose parent suspended awaiting it. Auto-resume the
                // parent with our output, mapped like the synchronous path.
                // Skipped when the DELEGATION path drives the chain (it
                // continues the parent itself). Best-effort: the child's own
                // completion stands even if the parent continuation fails.
                if (!skipBubble) {
                    await this.bubbleToParent(run, output, summary);
                }

                // Surface the flow's friendly completion message so a screen-flow
                // runner shows it instead of a generic "Done". `summary` (#4354)
                // covers the WHOLE run — the steps before the pause and after it
                // are one log, so a resumed approval reports what it did in total.
                return {
                    success: true,
                    output,
                    durationMs,
                    successMessage: flow.successMessage,
                    flowLabel: flow.label,
                    summary,
                };
            } catch (err: unknown) {
                // [#15788] A resumed run reached a refusing `end` — the SECOND
                // producer, and the one a screen flow actually takes: a wizard
                // that collects an answer and then refuses on it leaves through
                // here, never through `execute()`'s exit. Tested first, beside
                // the re-suspend, for the same reason it is tested first there.
                if (isRefusalSignal(err)) {
                    const refused = this.finishRefusedRun({
                        runId,
                        flowName: run.flowName,
                        flowVersion: run.flowVersion,
                        startedAt: run.startedAt,
                        durationMs: Date.now() - run.startTime,
                        steps, flow, variables,
                        refusalMessage: err.message, context,
                    });
                    // [#18714] UP-BUBBLE LEG. This run is terminal and the
                    // caller holds ITS id — but if it was a subflow CHILD, some
                    // ancestor is still parked at the `subflow` / `map` node
                    // that started it, and nothing else in the engine will ever
                    // move that ancestor: `bubbleToParent` was called on the
                    // completion path alone, so a child resumed to a refusal
                    // returned from here having resolved exactly one of the two
                    // runs it is responsible for. Measured: the child row read
                    // `refused` while its parent stayed `paused` and stayed in
                    // `listSuspendedRuns()` indefinitely — a leaked run, not a
                    // wrong answer, which is why it fails DIFFERENTLY from the
                    // delegated leg above and needs its own arm.
                    //
                    // The same call the completion path makes, with the refusal
                    // attached: the parent is genuinely resumed — it consumes
                    // its pause, records its own terminal row and bubbles to
                    // ITS parent in turn, so a chain of any depth resolves by
                    // the same induction completions already rely on. ⛔ Not a
                    // direct walk like `failAncestors`: that verb exists for a
                    // cascade in which no ancestor can be resumed at all, and
                    // it records them `failed` — the wrong word here.
                    //
                    // `output` and `summary` are the refused run's own, for the
                    // reason `finishRefusedRun` collects them: the nodes before
                    // the refusal really ran, and a parent that refuses must
                    // still be able to report what its child did.
                    //
                    // `skipBubble` is honoured exactly as on the completion
                    // path — under the DELEGATED leg the parent's frame is the
                    // caller, and it raises its own refusal at the throw site
                    // above. Bubbling here as well would resume the parent
                    // twice.
                    if (!skipBubble) {
                        await this.bubbleToParent(
                            run,
                            (refused.output ?? {}) as Record<string, unknown>,
                            refused.summary,
                            { message: err.message },
                        );
                    }
                    return refused;
                }
                // Re-suspended at a downstream node: persist a fresh continuation.
                if (isSuspendSignal(err)) {
                    const durationMs = Date.now() - run.startTime;
                    // #7639 — the re-suspend half of the same rule as the
                    // initial-execution site above: one snapshot, both consumers.
                    // A multi-stage approval re-pauses HERE on every stage but the
                    // first, so covering only the other site would leave every
                    // stage after stage 1 — the ones an operator actually needs to
                    // inspect — unreadable.
                    const variablesSnapshot = Object.fromEntries(variables);
                    await this.persistSuspendedRun({
                        ...run,
                        // The segment's identity, not the one the run parked
                        // with last time: after a decision switch (ruling A on
                        // `FlowSchema.runAs`) the next pause must continue as
                        // the decider, whatever resumes it — never fall back to
                        // the trigger user. Identical to `run.context` when no
                        // switch happened.
                        context,
                        nodeId: err.nodeId,
                        nodeType: err.nodeType,
                        variables: variablesSnapshot,
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
                        trigger: buildRunTrigger(context),
                        steps,
                        variables: variablesSnapshot,
                    }, context);
                    return { success: true, status: 'paused', runId, durationMs, screen: err.screen, flowLabel: flow.label };
                }

                const errorMessage = err instanceof Error ? err.message : String(err);
                const durationMs = Date.now() - run.startTime;
                // [#13909] THE seam this card is about. The pause was consumed
                // above, this node merely threw, and the record below makes the
                // run terminal — so from here on nothing in the engine can move
                // it: `resume` answers RUN_NOT_FOUND, `cancelRun` is a no-op on
                // it, and no other public method takes it anywhere EXCEPT the
                // deliberate operator exit, {@link restoreConsumedSuspension}.
                // Journal the suspension that was consumed so that exit has
                // something to put back.
                //
                // ⛔ Not a repair, and nothing here re-arms anything: the run
                // stays `failed`, no suspension exists after this line, and the
                // ordering above is untouched. It is the evidence a repair
                // needs, written at the only moment it still exists.
                const consumed = this.journalConsumedSuspension(
                    run,
                    stepCountAtPause,
                    errorMessage,
                    variablesAtPause,
                );
                // [#15555] From the line above, "this run is repairable" is a
                // FACT: a snapshot exists and `restoreConsumedSuspension` puts
                // it back. Everything from here to the `status: 'stranded'`
                // stamp below is BOOKKEEPING ABOUT that fact — and none of it
                // may be allowed to delete the fact by throwing.
                //
                // It could, and the direction is the dangerous one. The stamp
                // is the ONLY thing that tells a consumer the run is
                // repairable (`plugin-approvals` derives its operator-facing
                // `repairable` from it verbatim: `status === 'stranded'`), and
                // two statements in here throw out of the whole arm. Both live
                // in `recordLog`'s terminal path: the run-summary line
                // (`logger.info`, on by default) and `store.recordTerminal`,
                // whose SYNCHRONOUS throw escapes — the `void write.catch(...)`
                // beneath that call only ever sees a returned promise's
                // rejection. Then `failAncestors` awaits a walk that can throw.
                // A throw anywhere in that window replaced a truthful
                // `repairable: true` with `false`, which does not merely lose
                // information: it tells an operator NOT to attempt a repair
                // that succeeds. A false negative on a repair instruction is
                // worse than silence, and it is the opposite of the direction
                // everybody checks for.
                //
                // [#15944] THE SAME TWO STATEMENTS HAVE A SECOND CONSEQUENCE,
                // and it is the direction everybody DOES check for. On the
                // COMPLETION path above, a throw out of the same `recordLog`
                // fell into this arm on a run whose nodes ALL succeeded — a
                // false `true`: a journal and a `stranded` stamp for a run
                // that finished, whose "repair" re-armed it and re-ran every
                // node after the pause. That half is guarded at its own site
                // (see the completion path), NOT here: this arm stays the
                // node-failure arm, and reaching it at all was the defect.
                //
                // ⛔ This is NOT "assume repairable when the failure is
                // unknown" — that would invert the honest default and promise
                // a repair for a lost run. The guard opens AFTER the journal,
                // so only a run that demonstrably HAS a snapshot can reach the
                // stamp: a throw from `journalConsumedSuspension` itself still
                // propagates, and every exit above the consumption point is
                // untouched and still carries no status at all.
                //
                // ⛔ And the journal is NOT moved down to sit beside the stamp
                // instead. `recordLog` is what carries the snapshot into the
                // durable row, so journalling after it would leave a
                // `recordLog` failure with NO snapshot anywhere — converting
                // this false negative into a TRUE one by destroying the repair
                // rather than by reporting it.
                let logged: ExecutionLogEntry | undefined;
                try {
                    logged = this.recordLog({
                        id: runId,
                        flowName: run.flowName,
                        flowVersion: run.flowVersion,
                        status: 'failed',
                        startedAt: run.startedAt,
                        completedAt: new Date().toISOString(),
                        durationMs,
                        trigger: buildRunTrigger(context),
                        steps,
                        error: errorMessage,
                    }, context, consumed.run);
                    // Subflow chain: a child failing terminally fails every
                    // ancestor awaiting it — they can never be resumed otherwise.
                    // The delegation path handles its own level (skipBubble).
                    if (!skipBubble) {
                        // [#15222] `runId` names the run that stranded two
                        // statements above, so the walk journals every ancestor
                        // whose pause this cascade consumes and the chain is
                        // re-armable to its full depth, leaf-first.
                        await this.failAncestors(run.context, errorMessage, runId);
                    }
                } catch (bookkeeping) {
                    // #4632 verdict: DURABILITY, so `error` — the caller is
                    // told a truthful, actionable thing (the run stranded, and
                    // it is repairable), which is exactly what makes the rest
                    // invisible from the outside: the terminal history row
                    // never landed and/or the ancestor cascade stopped
                    // part-way, nothing retries either, and no envelope
                    // carries a word about it. Consequence and fix in the
                    // first line, per AGENTS.md. Said ONCE per stranded run,
                    // not once per failed write.
                    //
                    // THIRD argument per `error(message, error?, meta?)`; the
                    // `Error` slot stays empty on purpose (#5575), and the
                    // thrown text goes to the structured slot rather than into
                    // the message (#6499).
                    this.logger.error(
                        `[Automation] run '${runId}' of flow '${run.flowName}' is STRANDED and its ` +
                            `post-strand bookkeeping threw, so its terminal history row never landed ` +
                            `and/or its subflow ancestors were not failed — nothing retries either, and ` +
                            `the run reads healthy to the Runs surfaces and the approvals sweeps. The ` +
                            `strand itself IS reported and repairable right now: restore it with ` +
                            `restoreConsumedSuspension('${runId}') before this process restarts, which ` +
                            `drops the in-memory journal this repair rides on. Fix the failure in this ` +
                            `record's meta.`,
                        undefined,
                        describeThrownForLog(bookkeeping),
                    );
                }
                // Surface the flow's friendly error message (the raw error stays
                // in `error` for logs/diagnostics).
                return {
                    success: false,
                    error: errorMessage,
                    durationMs,
                    // [#13937] STRANDED, said by the producer that knows — the
                    // services half of the shape-4 ruling (maintainer
                    // 2026-09-01): the ordering stays, and the condition it
                    // leaves behind carries the platform-level name #14384 put
                    // on the contract. Stamped HERE and on no other exit,
                    // because this is the one exit that journalled a snapshot
                    // two statements up: the pause a durable decision was
                    // waiting on is gone, the run is recorded `failed`, and it
                    // can be re-armed only by {@link restoreConsumedSuspension}
                    // — never by `resume` (which now answers RUN_NOT_FOUND),
                    // never automatically. Terminal exactly like `'failed'`
                    // and distinct from it on purpose: `'failed'` says the run
                    // ran and was rejected; this says a recorded continuation
                    // stopped mid-flight and an operator has something to
                    // repair. The verdict and the journal are one fact stated
                    // twice — `stranded-run-status.test.ts` holds them equal.
                    //
                    // ⚠️ The run's RECORDED status — the log entry above and
                    // the durable history row — stays `'failed'`: that is
                    // `ExecutionStatus` (`@objectstack/spec`,
                    // `automation/execution.zod.ts`), a vocabulary the ruling
                    // did not widen; the durable discriminator for this
                    // condition is the snapshot the terminal row carries.
                    //
                    // ⛔ The cascade-failed ancestors above are NOT stranded:
                    // `failSuspendedRun` consumes their pauses and journals
                    // nothing, so no verb can re-arm them. A different (and
                    // worse) condition, which this stamp must not claim.
                    status: 'stranded',
                    errorMessage: flow.errorMessage,
                    flowLabel: flow.label,
                    // [#15555] Recomputed when the guard above had to abandon
                    // `recordLog`: the same pure function of the same steps
                    // that `recordLog`'s own first statement runs, so the two
                    // spellings cannot disagree.
                    summary: logged?.summary ?? summarizeRun(steps),
                    // [#24914, ruling B′] As `execute()`'s failure exit: the refusal
                    // the node after the consumed pause met, off the throw's brand. The
                    // screen-flow leg (a write behind a screen) reaches its caller HERE.
                    ...readCarriedRefusal(err),
                };
            }
        } finally {
            this.resuming.delete(runId);
        }
    }

    /**
     * Enforce a suspended `screen` node's declared field contract against the
     * submitted bag, returning a refusal or `null` to allow (#4477).
     *
     * The render half of `screen` always worked — the trigger response and
     * `GET …/runs/:runId/screen` carry `required` and `visibleWhen` intact, so
     * a renderer had everything it needed. There was no validation half:
     * `resume` accepted `{}` on a screen with an unconditional `required`
     * field, accepted a visible conditional field's value being absent, and
     * accepted keys the screen never declared — every one of them completing
     * the run. A client that skipped the dialog and posted here directly was
     * unconstrained by anything the flow author wrote.
     *
     * Scope, and the reasons for each edge:
     *
     *  - **Only `signal.variables`.** That is the screen's collected-values
     *    channel (the executor surfaces `fields`, the runner posts `inputs`).
     *    `signal.output` is the node-OUTPUT namespace, lands under
     *    `${nodeId}.${key}`, and belongs to the approval-style resume envelope
     *    — a different contract, not this one's to police.
     *  - **Only a screen that declares fields** — see
     *    {@link screenDeclaresInputContract}. An object-form screen and a
     *    message-only screen declare no keys, so they constrain none (the same
     *    pass-through `enforceActionParams` gives a param-less action).
     *  - **Never an engine-built signal.** The subflow output mapping and the
     *    `map` item handoff are the engine's own continuations; they carry
     *    author-named output variables, not a screen submission. This is the
     *    ONLY exemption, and it is spelled once: an absent signal is not a
     *    case here — `resume` normalises it to `{}` (commit 7307191db) — because a bare
     *    `if (!signal)` beside the flag was a second, unnamed spelling of the
     *    same exemption that let `resume(runId)` skip every `required` the
     *    author wrote.
     *
     * `visibleWhen` is evaluated against the SUBMITTED values first (layered
     * over the run's variables, so a predicate may reference a prior node),
     * because a hidden field's `required` must not fire — that is #3528's
     * dead-end reproduced server-side. An unevaluable predicate is reported and
     * treated as hidden: the client decides what the user saw, and a broken
     * predicate is not evidence a field was shown.
     */
    private refuseInvalidScreenInput(
        run: SuspendedRun,
        runId: string,
        signal: ResumeSignal,
    ): AutomationResult | null {
        if ((signal as Record<symbol, unknown>)[ENGINE_BUILT_SIGNAL] === true) return null;
        if (!screenDeclaresInputContract(run.screen)) return null;
        const fields = run.screen!.fields;

        const bag = (signal.variables ?? {}) as Record<string, unknown>;
        // Submitted values win over the snapshot: the predicate is about what
        // the user is filling in NOW, and the run's variables only supply the
        // wider context a `visibleWhen` may legitimately reference.
        const scope = new Map<string, unknown>(Object.entries(run.variables));
        for (const [k, v] of Object.entries(bag)) scope.set(k, v);

        const visibility = (field: ScreenFieldSpec): ScreenFieldVisibility => {
            try {
                return this.evaluateCondition(String(field.visibleWhen), scope, run.context);
            } catch (err) {
                // #6499 — BOTH spliced pieces were uncontrolled: the author's
                // own `visibleWhen` source (metadata text of any shape) and
                // the evaluator's thrown message (`evaluateCondition` composes
                // a deliberately multi-line one). Both go to the structured
                // slot; see `forgetSuspendedRun`'s catch above for the full
                // mechanism (#6299).
                //
                // #4632 verdict: FUNCTIONAL — stays `warn`: one field's
                // `required` is not enforced for one submission, the resume
                // caller reads the outcome directly, and nothing
                // claimed-persisted is involved.
                this.logger.warn(
                    `[automation] run '${runId}': screen field '${field.name}' has a visibleWhen that could not be ` +
                        `evaluated — its \`required\` is not enforced for this submission. The predicate and the ` +
                        `evaluator's failure are in this record's meta.`,
                    { visibleWhen: String(field.visibleWhen), ...describeThrownForLog(err) },
                );
                return undefined;
            }
        };

        const issues = validateScreenInputs(fields, bag, visibility);
        if (!issues.length) return null;

        const declared = declaredScreenFieldNames(fields);
        const summary = issues.map((i) => i.message).join('; ');
        // #6654 — the issue messages embed USER-SUBMITTED keys
        // (`validateScreenInputs`' `Unknown screen field "…"`,
        // screen-input-contract.ts), which nothing constrains against
        // newlines, so the findings ride the structured slot, never the
        // message; see `forgetSuspendedRun`'s catch for the full mechanism
        // (#6299). The returned INVALID_SCREEN_INPUT envelope below is
        // caller-facing refusal text, not a log record — it keeps the summary
        // (the envelope class is ruled elsewhere). #4632: FUNCTIONAL — stays
        // `warn`.
        this.logger.warn(
            `[automation] refused resume of run '${runId}': screen '${run.nodeId}' input violates its declared ` +
                `field contract — ${issues.length} issue(s); the field-level findings are in this record's meta.`,
            { issues },
        );
        return {
            success: false,
            code: 'INVALID_SCREEN_INPUT',
            error:
                `Invalid screen input: ${summary} — declared fields: ` +
                `${declared.map((n) => `'${n}'`).join(', ') || '(none)'}`,
        };
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
        // Engine-built: `outVar` is the author's `config.outputVariable`, so the
        // reserved-name check would be a false positive on an oddly-named one.
        return engineBuilt({
            output: { output: childOutput ?? null },
            ...(typeof outVar === 'string' && outVar
                ? { variables: { [outVar]: childOutput ?? null } }
                : {}),
        });
    }

    /**
     * Up-bubble for the subflow chain: when a TERMINAL run carries
     * `$parentRunId`, resume that parent with this run's output. Recursion via
     * the parent's own terminal exit bubbles multi-level chains. Best-effort —
     * a failed parent continuation is logged, never thrown back at the
     * caller who resumed the child.
     *
     * [#18714] "Terminal" is two outcomes, not one. The completion path was the
     * only caller until this card, so a child that resumed to a REFUSAL left
     * its parent parked at the awaiting node forever — visible in
     * `listSuspendedRuns()`, resumable by nobody, because the child it waits on
     * no longer exists. The refusal arm calls this with `refusal` set; every
     * other thing this method does is identical on both outcomes.
     *
     * [#15556] Best-effort at the ENGINE layer only, since this call never
     * throws either way: on the `'stranded'` exit — the one #15556's ruling
     * names — it also records a {@link SubflowParentStrand} under the CHILD's
     * own run id in {@link subflowParentStrands}, so the caller who resumed
     * that child (`resumeInternal` returns before this method's caller sees
     * anything beyond `success: true`) can retrieve it via
     * {@link takeSubflowParentStrand} and tell its OWN caller the truth. The
     * two tolerated arms below (`RESUME_IN_PROGRESS` / `STORE_UNAVAILABLE`)
     * record nothing — #15556's ruling is scoped to the strand, and those two
     * stay the functional degradation the old verdict already had right.
     */
    private async bubbleToParent(
        run: SuspendedRun,
        output: Record<string, unknown>,
        /** #4354 — this child's totals, credited to the parent's awaiting step. */
        summary?: FlowRunSummary,
        /**
         * [#18714] Set when this child finished `refused` rather than
         * `completed`. Everything about the bubble is unchanged — the same
         * mapped signal, the same best-effort contract, the same per-outcome
         * #4632 grading below — except that the parent ends on the child's
         * refusal instead of continuing past its awaiting node. Carried to
         * {@link resumeInternal} as its own argument, ⛔ never folded into
         * `sig`: the signal is the parent's variable map, and a refusal is
         * control flow, not a variable.
         */
        refusal?: ChildRunRefusal,
    ): Promise<void> {
        const ctx = run.context as Record<string, unknown> | undefined;
        const parentRunId = ctx?.$parentRunId;
        if (typeof parentRunId !== 'string' || !parentRunId) return;
        try {
            // A `map` child (ADR-0037 A2): hand the unit's output to the map
            // node + flag the completion, so on re-entry it records this item
            // and starts the next. A plain subflow child uses the 1:1 mapping.
            const mapNode = ctx?.$parentMapNode;
            const sig = typeof mapNode === 'string' && mapNode
                // Engine-built: these ARE the reserved handoff keys, and this is
                // the one writer allowed to set them (#3853 follow-up).
                ? engineBuilt({ variables: { [`${mapNode}.$mapItemOutput`]: output ?? null, [`${mapNode}.$mapItemDone`]: true } })
                : this.buildSubflowResumeSignal(run.context, output);
            const parentRes = await this.resumeInternal(parentRunId, sig, false, summary, refusal);
            if (!parentRes.success) {
                // #6499 — `parentRes.error` is the envelope field that carries
                // a failing node's / driver's text VERBATIM (#5912 left it
                // that way on purpose), so foreign newlines reach this message
                // second-hand; it goes to the structured slot. See
                // `forgetSuspendedRun`'s catch above for the full mechanism
                // (#6299).
                //
                // [#15556] The #4632 verdict is taken PER OUTCOME here, graded
                // by the engine's own discriminator and never by this seam's
                // guess at what went wrong upstream.
                //
                // The old verdict was FUNCTIONAL for the whole arm, on this
                // enumeration: "the parent either failed terminally (recorded
                // in run history) or stays visibly parked and resumable". A
                // reproduction of the composition the enumeration never
                // covered — a parent parked at a `subflow` node whose child
                // hosts an approval, resumed by the approvals decision door —
                // measured a THIRD outcome: `resumeInternal` answers
                // `{ success: false, status: 'stranded' }` (and no `code`),
                // because the parent consumed its suspension and then threw
                // downstream. That exit journals a repair snapshot and records
                // the parent `failed`, so the parent is neither parked nor
                // merely failed: nothing in the engine will ever move it again
                // and only {@link restoreConsumedSuspension} can re-arm it.
                //
                // That is AGENTS.md's DURABILITY class verbatim — persisted
                // state and runtime state disagree and nothing looks broken
                // from the outside: the approval row is durably terminal, the
                // child's own resume genuinely succeeded, and the decision
                // door therefore answered its caller success. ⛔ And the rule's
                // third legal answer (a failure handed to the CALLER is not a
                // degradation) does NOT apply: measured, no caller is told.
                //
                // ⛔ Deliberately NOT the whole arm. `RESUME_IN_PROGRESS` (a
                // replica is already advancing the parent) and
                // `STORE_UNAVAILABLE` (the parent's suspension was not
                // consumed, so it stays parked and the identical resume works
                // once the store recovers) are exactly the functional cases
                // the old verdict was right about, and escalating those is how
                // `error` becomes unreadable. `status === 'stranded'` is the
                // ONE exit that journalled a snapshot, so it is the one an
                // operator can and must act on.
                //
                // #15556 family ruling (#16472, maintainer 2026-09-07, decision
                // batch #76, option A): the LOG half stays exactly as it was
                // (below, unchanged) — the door's status code does not move —
                // and the strand is ALSO recorded here, under the CHILD's own
                // run id, so `takeSubflowParentStrand` can hand it to whichever
                // caller resumed that child. Not a widening of what this
                // method tells ITS OWN caller (still `void`, still never
                // thrown) — a sibling side-channel, read only by a caller that
                // asks for it by name.
                if (parentRes.status === 'stranded') {
                    this.subflowParentStrands.set(run.runId, {
                        runId: parentRunId,
                        repairable: true,
                        error: parentRes.error ?? 'unknown error',
                    });
                    while (this.subflowParentStrands.size > MAX_CONSUMED_SUSPENSIONS) {
                        const oldest = this.subflowParentStrands.keys().next().value;
                        if (oldest === undefined) break;
                        this.subflowParentStrands.delete(oldest);
                    }
                    // THIRD argument per the `Logger` contract
                    // (`error(message, error?, meta?)`); the `Error` slot stays
                    // empty on purpose (#5575). The message owes the two things
                    // AGENTS.md's durability rule asks of an `error`: the
                    // CONSEQUENCE, concretely, and the FIX.
                    this.logger.error(
                        `[automation] subflow run '${run.runId}' completed, but its parent run ` +
                            `'${parentRunId}' is STRANDED — the parent consumed its suspension and then failed ` +
                            `downstream, so no resume, timer or restart will move it again, while this child's ` +
                            `resumer (an approvals decision door, a wait timer) was told the resume SUCCEEDED and ` +
                            `nothing else reports the parent. Repair it with ` +
                            `restoreConsumedSuspension('${parentRunId}') and re-issue the continuation. The ` +
                            `parent's failure envelope is in this record's meta.`,
                        undefined,
                        { error: parentRes.error ?? 'unknown error', parentRunId, status: parentRes.status },
                    );
                } else {
                    // #4632 verdict: FUNCTIONAL — stays `warn`, unchanged: on
                    // every other exit nothing claimed-persisted fails to land
                    // — the parent either failed terminally (recorded in run
                    // history) or stays visibly parked and resumable — and the
                    // child's own completion, which is what its resumer was
                    // told, is genuine.
                    this.logger.warn(
                        `[automation] subflow run '${run.runId}' completed but resuming parent '${parentRunId}' ` +
                            `failed — the parent's failure envelope is in this record's meta.`,
                        { error: parentRes.error ?? 'unknown error' },
                    );
                }
            }
        } catch (err) {
            // #6499 — thrown text to the structured slot; see
            // `forgetSuspendedRun`'s catch above for the full mechanism
            // (#6299). #4632 verdict: FUNCTIONAL — stays `warn`, the same
            // consequence envelope as the branch above: the parent's
            // suspension was either consumed with a recorded outcome or
            // survives parked and resumable; nothing reads as success that
            // is not.
            this.logger.warn(
                `[automation] subflow run '${run.runId}' completed but resuming parent '${parentRunId}' ` +
                    `threw — the thrown failure is in this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }

    /**
     * [#15556] Read — and clear — the {@link SubflowParentStrand}
     * {@link bubbleToParent} recorded for `childRunId`'s most recent
     * completion, if any. `undefined` on every other outcome: no parent, a
     * parent that resumed cleanly, or a parent bubble that hit the tolerated
     * `RESUME_IN_PROGRESS` / `STORE_UNAVAILABLE` arms (#15556's ruling leaves
     * those functional, not reported here).
     *
     * Delete-on-read on purpose: this is a hand-off to the ONE caller that
     * resumed `childRunId` and is about to answer its OWN caller, not a
     * durable record — the durable half is the parent's own consumed-
     * suspension journal and terminal history row, both already readable via
     * {@link inspectConsumedSuspension} / {@link getRun} against the
     * PARENT's run id, which this method is what hands a caller in the first
     * place (nothing else names it).
     *
     * ⚠️ Never populated for `childRunId`'s OWN failure — only for a PARENT
     * this child's completion bubbled into. A child that itself stranded is
     * reported on `childRunId`'s own {@link AutomationResult}, unchanged.
     */
    takeSubflowParentStrand(childRunId: string): SubflowParentStrand | undefined {
        const found = this.subflowParentStrands.get(childRunId);
        if (found) this.subflowParentStrands.delete(childRunId);
        return found;
    }

    /**
     * Terminally fail a suspended run: consume its continuation and record a
     * `failed` log so it stops surfacing as resumable. Used when a subflow
     * descendant fails — the ancestor awaiting it can never be resumed.
     *
     * [#15222] **And journal the pause it consumes, when the descendant whose
     * failure got us here is itself repairable.** This consumption is exactly
     * as terminal as the one `resumeInternal`'s catch arm makes — the paused
     * row is deleted, `resume` then answers `RUN_NOT_FOUND` and `cancelRun` is
     * a no-op — so leaving no snapshot left the operator exit reaching the
     * stranded leaf and NOTHING above it: restoring the leaf completed it into
     * an ancestor that never continues. The journal is written from the same
     * one producer ({@link journalConsumedSuspension}) and carried into the
     * durable terminal row by the same third argument to
     * {@link recordLog} as the strand's own, so a chain is repairable from any
     * replica and across a restart, not only from this process's memory.
     *
     * @param repairableDescendant - The descendant run whose failure consumed
     *   this pause, and ONLY when a consumed-suspension snapshot is held for
     *   it. `undefined` journals nothing, which is the honest answer for a
     *   cascade nothing can re-arm from below: re-arming an ancestor whose
     *   descendant is beyond repair promises a chain repair that cannot be
     *   completed, and an operator acting on that promise resumes the ancestor
     *   past a nested node whose child never ran.
     *
     * ⛔ The snapshot is taken BEFORE `forgetSuspendedRun`, from a `run` no
     * traversal has touched: this seam is reached with the pause still live
     * (the ancestor never resumed at all, or — on the delegation path — its
     * own resume has not passed the consumption point yet), so `run.steps` is
     * the pause's own step log and `run.variables` the pause's own scope. That
     * is why there is no {@link cloneVariablesAtPause} here: the #15660
     * aliasing hazard is a FAILED ATTEMPT writing through a shared scope
     * object, and no attempt has run against this run.
     */
    private failSuspendedRun(
        run: SuspendedRun,
        error: string,
        repairableDescendant?: string,
    ): Promise<void> {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof failSuspendedRun> = {
            journalConsumedSuspension: (...a) => this.journalConsumedSuspension(...a),
            forgetSuspendedRun: (...a) => this.forgetSuspendedRun(...a),
            recordLog: (...a) => this.recordLog(...a),
        };
        return failSuspendedRun.call(host, run, error, repairableDescendant);
    }

    /**
     * [#23963] Answer a resume refused as GONE FOR GOOD, and settle the run it
     * names in the same act.
     *
     * {@link resumeInternal} reaches this from its two never-dispatched exits:
     * the run's flow is no longer registered, or the node it parked on was
     * edited away. Both are the terminal `RUN_NOT_FOUND` class (#8684). The
     * answer is unchanged, and the run now moves to the state the answer
     * describes: the parked row is consumed and a `failed` history row records
     * `cause`, the same text the caller is answered. `failed` and not
     * `cancelled`, for {@link failSuspendedRun}'s reason: nobody decided to end
     * this run (ADR-0044's `cancelled`, which a restore refuses as a deliberate
     * act). It can never continue, and `error` is the column that says why.
     * Retention's `onlyWhen` scope already holds `failed`, so the row ages out
     * like any other history row and nothing there changes.
     *
     * Three guards, each against a different way the verdict could be wrong:
     *
     *  - **The boot is still filling the flow registry.** Before the host
     *    seals the boot, an absent flow means "not registered YET": the plugin
     *    re-arms overdue wait timers in its `start()`, and those resume runs
     *    before its `kernel:ready` handler binds the inline app flows they
     *    belong to. Recording the verdict there would kill a run whose flow
     *    arrives a moment later (AGENTS.md "Startup registry reads"). The host
     *    declares the boot complete with {@link sealNodeTypeVocabulary}, which
     *    `AutomationServicePlugin` calls at `kernel:bootstrapped`, strictly
     *    after every flow bind of the boot. Before the seal this answers the
     *    refusal and records nothing, which is exactly what shipped before.
     *    After it, a flow can leave only by an explicit withdrawal. An
     *    embedded host that never seals keeps the pre-#23963 behaviour.
     *  - **Another consumer got there first.** The row is consumed through
     *    {@link claimAdvance}, the compare-and-set the resume path takes: the
     *    store removes the row only while it is still parked where this
     *    replica read it. `lost` means a concurrent resume or cancel already
     *    consumed it and wrote its own outcome, so nothing is written here.
     *    The answer stays the refusal this replica reached.
     *  - **The store cannot say whether the row was consumed.** A claim that
     *    throws answers `STORE_UNAVAILABLE`, as the resume path's claim does.
     *    That tells the caller the row may still read `paused`, and a retry
     *    settles it. Answering `RUN_NOT_FOUND` there would tell the caller the
     *    matter is closed while the row it describes stayed parked.
     *
     * The history write is guarded the way the completion paths guard theirs
     * (#16274): the run is already consumed when it runs, so a throw out of
     * it must not turn the refusal into a rejected promise.
     */
    private settleUnresumableSuspension(run: SuspendedRun, cause: string): Promise<AutomationResult> {
        // The body lives in ./run-resume.ts (#25222).
        const readNodeTypeVocabularySealed = () => this.nodeTypeVocabularySealed;
        const host: ThisParameterType<typeof settleUnresumableSuspension> = {
            get nodeTypeVocabularySealed() { return readNodeTypeVocabularySealed(); },
            claimAdvance: (...a) => this.claimAdvance(...a),
            evictConsumedSuspension: (...a) => this.evictConsumedSuspension(...a),
            forgetSuspendedRun: (...a) => this.forgetSuspendedRun(...a),
            recordLog: (...a) => this.recordLog(...a),
            logger: this.logger,
        };
        return settleUnresumableSuspension.call(host, run, cause);
    }

    /**
     * Cancel a suspended run (ADR-0044): consume its continuation and record a
     * terminal `cancelled` log so it stops surfacing as resumable. The
     * engine-level primitive behind "the submitter abandoned the revision
     * window" — recalling there leaves the run paused at a wait node with no
     * reject edge to resume down, so the run must end, not continue. Returns
     * `false` when no suspended run exists under the id (already terminal /
     * unknown), which callers treat as idempotent success.
     *
     * ⚠️ An UNREADABLE durable store also lands on that `false` — the two are
     * indistinguishable to the caller, so the run may still be parked and
     * resumable. That path is reported at `error` (#4632/#6299) precisely
     * because nothing above it can tell the difference; see the catch below.
     *
     * [#14332] WHERE THE RUN IS READ FROM: {@link loadSuspendedRunStrict} —
     * the same store-authoritative read `resumeInternal` takes, and the STRICT
     * loader by deliberate choice rather than the degrading
     * {@link loadSuspendedRun}. NOT FOUND (the store answered and holds no row
     * for this id) reads as "already terminal / unknown" and returns `false`,
     * exactly as before; a store that cannot be READ throws out of the loader
     * into the catch below, which keeps this site's own #4632 DURABILITY record
     * at `error`. The degrading loader would have answered `null` under its own
     * best-effort `warn` and silently downgraded that verdict — the posture is
     * preserved here by picking the loader that preserves it.
     *
     * ⚠️ The consequence of a store-authoritative read, stated rather than left
     * to be discovered: while a store is configured this process's map is no
     * longer an answer, so a store outage reaches the `error` record above even
     * for a run THIS replica is holding — where the old cache-first read
     * cancelled from the local snapshot instead. That snapshot is the defect:
     * the row delete is by id and is therefore right either way, but
     * {@link forgetSuspendedRun} notifies the executor of the node recorded on
     * the SNAPSHOT, so a stale replica tore down the pause of a node the run had
     * already left and left the live one's armed.
     */
    cancelRun(runId: string, reason?: string): Promise<boolean> {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof cancelRun> = {
            loadSuspendedRunStrict: (...a) => this.loadSuspendedRunStrict(...a),
            logger: this.logger,
            forgetSuspendedRun: (...a) => this.forgetSuspendedRun(...a),
            recordLog: (...a) => this.recordLog(...a),
        };
        return cancelRun.call(host, runId, reason);
    }

    /**
     * [#15660] The pause's variables, decoupled from the scope the resume is
     * about to hand the downstream nodes.
     *
     * Called once per resume of a suspended run, BEFORE the failed attempt can
     * run — see the call site for why no later placement works and for the
     * measured cost. A JSON clone specifically, not `structuredClone`: the
     * durable row for this same pause was written through `JSON` by the store,
     * so this keeps the hot journal and the durable row the same shape. A
     * `Date` that survived here as a `Date` while the row held a string would
     * make `restoreConsumedSuspension`'s two sources disagree about the pause
     * they both claim to describe.
     *
     * A value JSON cannot carry (a cycle) costs the copy, never the repair: the
     * fallback is the aliased object this method exists to replace, which is
     * exactly the behaviour that shipped before, so the operator exit is no
     * worse than it was. It is reported at `warn` — the exit still works, and
     * what it puts back may name post-resume state.
     */
    private cloneVariablesAtPause(run: SuspendedRun, runId: string): SuspendedRun['variables'] {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof cloneVariablesAtPause> = {
            logger: this.logger,
        };
        return cloneVariablesAtPause.call(host, run, runId);
    }

    /**
     * Record the suspension a resume consumed before its downstream node threw
     * (#13909) — the one and only producer of a {@link ConsumedSuspension}.
     *
     * VERBATIM, and that word is load-bearing:
     *
     *  - `variablesAtPause` is the pause's OWN snapshot, deep-copied by
     *    {@link cloneVariablesAtPause} before the failed attempt ran. The
     *    resume's signal was folded into a separate `Map` built from
     *    `run.variables`, never into this object, so what is journalled is the
     *    state at the pause, not the state the failed attempt was working from.
     *
     *    ⚠️ [#15660] That last sentence used to be written against
     *    `run.variables` itself, and was true only of its TOP-LEVEL keys. The
     *    scope the downstream nodes run against is `new Map(Object.entries(
     *    run.variables))` — the keys are copied, every value object is SHARED —
     *    so an executor that keeps state in the scope and updates it in place
     *    (`map`'s `<nodeId>.$mapState`) wrote through into this snapshot, and
     *    the operator exit handed back post-resume state stamped as the pause.
     *    Measured end to end in `consumed-suspension-snapshot-aliasing.test.ts`.
     *    ⛔ Do not route the copy back to this method: by the time this runs the
     *    mutation has already landed (the node mutates, THEN throws), so a copy
     *    taken here copies the corruption. It has to be taken before the failed
     *    attempt runs, which is where the caller takes it.
     *  - `run.steps` is the live array `traverseNext` appended to, so it is
     *    trimmed back to `stepCountAtPause` — the failed attempt's steps are
     *    NOT part of the thing an operator puts back.
     *  - Everything else (`nodeId`, `nodeType`, `context`, `correlation`,
     *    `screen`, `startedAt`, `startTime`) is carried across untouched.
     *
     * Still shallow HERE, and for the reason it always was: a JSON clone in
     * this method could throw on a circular value inside a catch arm that is
     * already handling a failure. The one field that needed copying is copied
     * by the caller instead, on the happy path, where a throw costs nothing.
     */
    private journalConsumedSuspension(
        run: SuspendedRun,
        stepCountAtPause: number,
        error: string,
        variablesAtPause: SuspendedRun['variables'],
    ): ConsumedSuspension {
        const consumed: ConsumedSuspension = {
            run: { ...run, steps: run.steps.slice(0, stepCountAtPause), variables: variablesAtPause },
            consumedAt: new Date().toISOString(),
            error,
            // [#13937] `recordLog` settles this when its write settles.
            ...(this.store?.recordTerminal ? { persisted: 'pending' as const } : {}),
        };
        this.consumedSuspensions.set(run.runId, consumed);
        // Oldest first — `Map` iterates in insertion order, and re-`set`ting an
        // existing key keeps its original position, which is what we want: a
        // run that strands twice does not jump the queue ahead of one that has
        // been waiting for an operator longer.
        while (this.consumedSuspensions.size > MAX_CONSUMED_SUSPENSIONS) {
            const oldest = this.consumedSuspensions.keys().next().value;
            if (oldest === undefined) break;
            this.consumedSuspensions.delete(oldest);
        }
        return consumed;
    }

    /**
     * [#13937] Does the durable row describe a LATER strand than this
     * process's hot copy? True only when the two name different pauses AND the
     * hot copy's own history write landed — then the row can only be a later
     * strand another replica recorded. Same pause: never (the hot copy is the
     * more faithful witness of it). Different pause but the hot copy's write
     * never reached the store (`persisted` not `'landed'`): never — the row
     * predates this strand and says nothing about it (the #13617 exception).
     * The pause identity is the pair {@link SuspendedRunStore.claimSuspension}
     * compares: the node, and the correlation when one was minted.
     */
    private rowSupersedesJournal(
        hot: ConsumedSuspension,
        rowPause: { nodeId?: string; correlation?: string },
    ): boolean {
        const samePause =
            hot.run.nodeId === rowPause.nodeId &&
            (hot.run.correlation ?? undefined) === (rowPause.correlation ?? undefined);
        if (samePause) return false;
        return hot.persisted === 'landed';
    }

    /**
     * [#15358] The two-witness READ of a run's consumed suspension — this
     * process's hot journal against the durable terminal row — factored out of
     * {@link restoreConsumedSuspension} so that {@link inspectConsumedSuspension}
     * answers from the same reading and the two cannot disagree. PURE: it
     * mutates nothing. A hot copy the row proves stale is REPORTED
     * (`staleHot`) for the restore verb to drop; the read-only verb leaves it.
     *
     * [#13937] Two witnesses of one strand, and neither is trusted alone —
     * the contract review of that ruling's services half measured both
     * single-witness readings wrong, one store class apart:
     *
     *  - This process's HOT copy is the verbatim object the failure was
     *    journalled from: the pause's own node, variables, step log as of the
     *    pause. It is a per-process cache. The replica that stranded a run
     *    keeps it after another replica restored, resumed and FINISHED the
     *    run, and re-arming it then re-runs every node after the pause —
     *    shape 2's silent double-run, through the restore verb's side door
     *    (pinned in `stranded-run-status.test.ts`, red on the hot-only tree).
     *  - The DURABLE row is the record every replica can read, and a
     *    flattened, column-bounded copy of the same snapshot: the object
     *    store rebuilds it from columns, DROPS it over a byte budget — and
     *    says so in the row, `consumedSuspensionDropped` — and receives it
     *    fire-and-forget. Read alone, a snapshot-less row sent a run the
     *    store could not persist into NO_CONSUMED_SUSPENSION on the very
     *    replica holding its copy (pinned in `stranded-run-object-store.test.ts`,
     *    red on the durable-first tree).
     *
     * So: the hot copy is preferred whenever both describe the SAME pause
     * ({@link rowSupersedesJournal}). When they describe different pauses,
     * the newest strand wins — a hot copy whose own write never landed
     * (`persisted` is not `'landed'`: the #13617 exception, a row the store
     * was never handed says nothing) beats the older row, and a landed hot
     * copy yields to the later strand another replica recorded. A row with
     * neither a snapshot nor a drop notice is "the run moved on" only for a
     * hot copy whose write did land — that copy is then stale rather than
     * honoured. A hot copy answers alone where there is no row to ask: no
     * store, no run history, a write that never landed or is still in flight.
     *
     * ⚠️ Sampling instant (#15358 contract review): the hot copy is read HERE,
     * i.e. AFTER the caller's `await loadTerminal(...)`, where the inline read
     * this replaced took it BEFORE that await. The decision table is the same;
     * the sample time is later. With {@link MAX_CONSUMED_SUSPENSIONS} bounding
     * the journal, an eviction that lands during that await now answers a
     * refusal (`NO_CONSUMED_SUSPENSION`) where the old read would have restored
     * from the copy it had already captured. The direction is refusal, never a
     * double-run — the copy is gone either way; only which of the two verbs
     * notices moved.
     *
     * @param terminal - The durable terminal row, already loaded by the
     *   caller (each caller owns its own outage posture for that read).
     */
    private resolveConsumedSuspensionWitnesses(
        runId: string,
        terminal: RunRecord | null,
    ): {
        consumed?: ConsumedSuspension;
        witness?: 'journal' | 'durable';
        dropped?: ConsumedSuspensionDropNotice;
        /** The hot copy describes a pause the run has since LEFT. */
        staleHot: boolean;
    } {
        const hot = this.consumedSuspensions.get(runId);
        if (!terminal) {
            return hot ? { consumed: hot, witness: 'journal', staleHot: false } : { staleHot: false };
        }
        if (terminal.consumedSuspension) {
            const durable: ConsumedSuspension = {
                run: terminal.consumedSuspension,
                consumedAt: terminal.finishedAt ?? terminal.startedAt,
                error: terminal.error ?? '',
            };
            if (hot && !this.rowSupersedesJournal(hot, durable.run)) {
                return { consumed: hot, witness: 'journal', staleHot: false };
            }
            return { consumed: durable, witness: 'durable', staleHot: hot !== undefined };
        }
        if (terminal.consumedSuspensionDropped) {
            const dropped = terminal.consumedSuspensionDropped;
            if (hot && !this.rowSupersedesJournal(hot, dropped)) {
                return { consumed: hot, witness: 'journal', dropped, staleHot: false };
            }
            return { dropped, staleHot: hot !== undefined };
        }
        if (hot && hot.persisted !== 'landed') {
            // The row predates this strand — this process's own write for it
            // never reached the store (in flight, or failed and reported at
            // `error`). The store's silence says nothing.
            return { consumed: hot, witness: 'journal', staleHot: false };
        }
        // A later terminal record with no snapshot and no drop notice:
        // completed, cancelled or cascade-failed after any hot copy was
        // taken. Stale by definition.
        return { staleHot: hot !== undefined };
    }

    /** Build a refusal from {@link restoreConsumedSuspension}. */
    private refuseRestore(
        runId: string,
        refusal: SuspensionRestoreRefusal,
        reason: string,
    ): SuspensionRestoreResult {
        return { restored: false, runId, refusal, reason };
    }

    /**
     * **The operator exit from a run a resume left terminally unresumable**
     * (#13909, deliverable 2). Puts back the suspension that resume consumed,
     * so the run is resumable again.
     *
     * ## The state this is an exit from
     *
     * `resumeInternal` consumes the suspension **before** running downstream
     * nodes, so a node that merely throws throws with the pause already gone
     * and the catch arm records the run `failed`. That state is terminal:
     * {@link resume} answers `RUN_NOT_FOUND` (there is no suspension left),
     * {@link cancelRun} is a no-op on it, and nothing else moves it either. A
     * deployment could enter that state and never leave it. This verb is the
     * leaving.
     *
     * ⚠️ It is a REPAIR, not a prevention — and that is the ruled shape.
     * #13937 (maintainer 2026-09-01, shape 4) keeps the consumption order for
     * exactly-once across a crash and makes THIS verb the way out: the state
     * it exits from is `AutomationResult.status: 'stranded'`, stamped by the
     * resume that consumed the pause and then failed downstream. This method
     * changes no resume semantics for any pausing node type — the ordering,
     * {@link forgetSuspendedRun} and `traverseNext` are all exactly as they
     * were.
     *
     * ## Deliberate — never automatic
     *
     * Nothing calls this on its own. There is no retry, no sweeper, no
     * self-healing arm anywhere in the engine: an operator (or an admin door
     * standing in for one) asks for this run, by id, on purpose. A machine that
     * re-armed strandings by itself would re-run the node that threw, forever,
     * with nobody deciding it should.
     *
     * ## Verbatim — the pause goes back as it was, and nothing else
     *
     * The restored suspension is the one that was consumed, exactly: the
     * pause's own variables, its step log as of the pause, its node, its
     * correlation, its screen. Two consequences an operator must know, and both
     * are in the trace this writes:
     *
     *  - ⚠️ **The resume signal is NOT replayed.** The approval decision or
     *    screen submission that accompanied the failed resume is not folded
     *    back in; the continuation must be re-issued. Replaying it would mean
     *    re-deciding on the operator's behalf, and the branch a signal routes
     *    down (`signal.branchLabel`) is not part of a suspension at all — a
     *    resume with the signal dropped would silently take a different edge.
     *  - ⚠️ **The failed attempt is NOT undone.** Whatever the downstream nodes
     *    did before one of them threw stands; this re-arms a pause, it does not
     *    roll a transaction back. That is why re-deciding is the right default
     *    and why this is an operator's call rather than the engine's.
     *
     * Restoring the pause exactly as it stood is also the shape that composes
     * with a later resume-ordering change (#13937 point 3 reopens shape 2 only
     * with a durable claim/lease): it is precisely the state such a change
     * would leave behind, so nothing here would need to move.
     *
     * ## Idempotence — carried by the paused row, not by a flag
     *
     * A suspension is keyed by run id, so a restore cannot produce two
     * resumable pauses however many operators ask: the second call finds one
     * live and answers `RUN_SUSPENDED`. That holds across processes and across
     * a restart, because the paused row is durable. {@link restoring} adds the
     * in-process half — two callers racing in one process get one
     * `restored: true` and one `RESTORE_IN_PROGRESS`, rather than two calls
     * both claiming the restore.
     *
     * [#13937] The third half, across replicas and across TIME: this
     * process's journal and the durable terminal row are read as two
     * witnesses of one strand (see the read itself, below). A hot copy left
     * behind on the replica that stranded the run cannot re-arm it after
     * another replica restored and finished it, or restranded it at a later
     * pause; a snapshot the store could not persist is still restorable from
     * the copy the stranding process holds; and a row the store was never
     * handed says nothing about that copy.
     *
     * And it cannot produce two traversals, by construction: **this verb does
     * not resume.** It re-arms the pause and stops. The continuation is an
     * ordinary {@link resume} afterwards, through the same authority gate, the
     * same screen validation and the same `resuming` guard as any other.
     *
     * ## The trace
     *
     * A restore is recorded at `warn` with the run, flow, node, when the
     * suspension was consumed, who asked and why. #4632's vocabulary grades
     * this FUNCTIONAL — nothing claimed-persisted failed to land — but the
     * level is `warn` rather than `info` on purpose: this moves a run the
     * platform had already recorded as terminally failed, and an exit that
     * leaves no mark is the same silence that let this whole class go
     * unnoticed. Operator-supplied text (`requestedBy` / `reason`) and the
     * original thrown message ride the STRUCTURED slot, never the message —
     * none of the three is controlled by us and a newline in any of them would
     * split one record into several physical lines of which only the first is
     * greppable (the #6299 family).
     *
     * @param options.requestedBy - Who asked. Logged; `not recorded` when
     *   absent, which is itself something an operator can find.
     * @param options.reason - Why. Logged the same way.
     * @returns Never throws: every outcome — including an unreadable store — is
     *   a {@link SuspensionRestoreResult} naming what was observed.
     */
    async restoreConsumedSuspension(
        runId: string,
        options?: { requestedBy?: string; reason?: string },
    ): Promise<SuspensionRestoreResult> {
        // [#15222] Resolve the nested chain FIRST, read-only. A flat run finds
        // nothing here and takes the per-run call below unchanged — same
        // guards, same answer, and a result with no `chain` key at all.
        //
        // A nested one is the whole of this card: the ancestors' pauses were
        // consumed by the same cascade and journalled by
        // {@link failSuspendedRun}, and re-arming only the run the operator
        // named would put the deployment back in the condition the verb exists
        // to leave — a leaf that completes into an ancestor which never
        // continues. So the chain is one unit of repair, and this is the call
        // that makes it one.
        const { below, above } = await this.resolveRestoreChain(runId);
        if (below.length === 0 && above.length === 0) {
            return this.restoreOneConsumedSuspension(runId, options);
        }
        // DEEPEST FIRST, and the order IS the guarantee: an ancestor becomes
        // resumable only after the run it is parked awaiting is parked again,
        // so a resume arriving mid-repair delegates into a live child instead
        // of continuing past a nested node whose child is terminal.
        //
        // Every member goes through the SAME per-run call — its own
        // `restoring` claim, its own strict live-suspension read, its own
        // two-witness read, its own durable park. So the verb's idempotence
        // and the #14333 advance claim hold PER RUN in the chain rather than
        // once for the chain, and a second chain restore finds every member
        // parked and answers `RUN_SUSPENDED` without minting a second pause
        // anywhere.
        const chain: ChainRestoreEntry[] = [];
        for (const memberId of below) {
            chain.push(chainEntryOf(memberId, await this.restoreOneConsumedSuspension(memberId, options, runId)));
        }
        const own = await this.restoreOneConsumedSuspension(runId, options);
        chain.push(chainEntryOf(runId, own));
        for (const memberId of above) {
            chain.push(chainEntryOf(memberId, await this.restoreOneConsumedSuspension(memberId, options, runId)));
        }
        // The six fields above `chain` keep describing the run the caller
        // NAMED, wherever in the chain it sits — a consumer that never heard
        // of nesting reads exactly what it always read.
        return { ...own, chain };
    }

    /**
     * [#15222] The runs a chain restore of `runId` must re-arm besides it:
     * `below` deepest-first (the descendants it is parked awaiting) and
     * `above` nearest-first (the ancestors whose pauses its cascade consumed).
     *
     * READ-ONLY, and bounded in both directions by
     * {@link MAX_RESTORE_CHAIN_HOPS}. A run joins the chain only when it is
     * BOTH not currently suspended and holds a consumed-suspension snapshot —
     * which is what makes a second restore of an already-repaired chain
     * resolve to nothing and answer the flat `RUN_SUSPENDED`.
     *
     * The links are ones the engine already persists: a parent parked at a
     * nested node carries `<kind>:<childRunId>` as its correlation
     * ({@link nestedChildRunId}) and a child carries `$parentRunId` in its
     * context. ⛔ No new column and no new marker on the journal — a durable
     * marker would be a store change, and a hot-only one would make a chain
     * resolvable in the process that stranded it and not in the replica that
     * has to repair it after a restart, which is the one place this has to
     * work.
     */
    private async resolveRestoreChain(runId: string): Promise<{ below: string[]; above: string[] }> {
        const below: string[] = [];
        const above: string[] = [];
        const self = await this.peekConsumedSuspension(runId);
        if (!self) return { below, above };

        let cursor = self;
        for (let hops = 0; hops < MAX_RESTORE_CHAIN_HOPS; hops++) {
            const childRunId = nestedChildRunId(cursor.run.correlation);
            if (childRunId === undefined || childRunId === runId || below.includes(childRunId)) break;
            const child = await this.peekConsumedSuspension(childRunId, runId);
            if (!child) break;
            below.unshift(childRunId);
            cursor = child;
        }

        cursor = self;
        for (let hops = 0; hops < MAX_RESTORE_CHAIN_HOPS; hops++) {
            const parentRunId = (cursor.run.context as Record<string, unknown> | undefined)?.$parentRunId;
            if (typeof parentRunId !== 'string' || !parentRunId) break;
            if (parentRunId === runId || above.includes(parentRunId)) break;
            const parent = await this.peekConsumedSuspension(parentRunId, runId);
            if (!parent) break;
            above.push(parentRunId);
            cursor = parent;
        }
        return { below, above };
    }

    /**
     * [#15222] Is there a consumed suspension to put back for `runId` — without
     * putting anything back, and without evicting the stale hot copy the
     * restore verb would drop? The read-only step of a chain walk, taking the
     * same two witnesses {@link resolveConsumedSuspensionWitnesses} reconciles
     * for every other reader.
     *
     * A run that is still SUSPENDED answers `undefined`: it is not a member to
     * re-arm, and treating it as one would turn an idempotent second call into
     * a chain of `RUN_SUSPENDED`s where the flat answer is the truthful one.
     *
     * @param chainOf - The run whose chain is being walked. Present only for a
     *   HOP, and only so that an unreadable store is reported: the walk stops
     *   there, and a chain silently truncated by an outage would read to an
     *   operator as a complete repair. The named run's own read is not
     *   reported here because {@link restoreOneConsumedSuspension} takes the
     *   identical read immediately afterwards and refuses `STORE_UNAVAILABLE`
     *   on it — one degradation, said once.
     */
    private async peekConsumedSuspension(runId: string, chainOf?: string): Promise<ConsumedSuspension | undefined> {
        try {
            if (await this.loadSuspendedRunStrict(runId)) return undefined;
            const terminal = this.store?.loadTerminal ? await this.store.loadTerminal(runId) : null;
            return this.resolveConsumedSuspensionWitnesses(runId, terminal).consumed;
        } catch (err) {
            if (chainOf !== undefined) {
                // #6299 — the driver's own text rides the structured slot.
                // #4632 verdict: FUNCTIONAL — the repair is visibly short (the
                // `chain` this call returns names only what it reached) and the
                // remedy is to re-issue, which is safe per run.
                this.logger.warn(
                    `[automation] restoreConsumedSuspension('${chainOf}') could not read run '${runId}' while ` +
                        `walking its nested chain, so the walk STOPPED there and nothing beyond it was re-armed ` +
                        `— the repair this call reports is partial. Nothing was written for that run. Fix the ` +
                        `store failure in this record's meta, then re-issue the restore: it is idempotent per ` +
                        `run and puts back only what is still missing.`,
                    describeThrownForLog(err),
                );
            }
            return undefined;
        }
    }

    /**
     * One run's half of {@link restoreConsumedSuspension}: every guard, both
     * witnesses, the re-arm and the trace, for exactly one run id. The public
     * verb is this call for a flat run, and this call per member — in a fixed
     * order — for a nested chain (#15222).
     *
     * @param chainRestoreOf - Set when this run is being re-armed as a member
     *   of another run's chain. It shapes the trace only; every guard above is
     *   taken identically either way.
     */
    private async restoreOneConsumedSuspension(
        runId: string,
        options?: { requestedBy?: string; reason?: string },
        chainRestoreOf?: string,
    ): Promise<SuspensionRestoreResult> {
        // Synchronously, before the first await — the same shape as `resuming`
        // in `resumeInternal`: a guard set after an await is not a guard.
        if (this.restoring.has(runId)) {
            return this.refuseRestore(
                runId,
                'RESTORE_IN_PROGRESS',
                `Another restore of run '${runId}' is already in progress in this process`,
            );
        }
        // ⚠️ The subtle one. `resuming` is set before `resumeInternal`'s first
        // await and cleared in its `finally`, so this window is exactly
        // "suspension consumed, outcome not yet decided" — which is what a
        // resume IN FLIGHT looks like, and is indistinguishable from the
        // stranded state by any other reading. Re-arming one of these races the
        // live resume: its traversal would finish and record `completed` while
        // a paused row it knows nothing about survives, and the next restart
        // would resume an already-finished run.
        if (this.resuming.has(runId)) {
            return this.refuseRestore(
                runId,
                'RESUME_IN_PROGRESS',
                `Run '${runId}' is being resumed right now — its outcome is not decided yet`,
            );
        }
        this.restoring.add(runId);
        try {
            // Already resumable? STRICT read: an unreadable store must not read
            // as "no suspension" here. That degradation is harmless for a
            // display path and is the one mistake that mints a second pause on
            // this one.
            let live: SuspendedRun | null;
            try {
                live = await this.loadSuspendedRunStrict(runId);
            } catch (err) {
                this.logger.warn(
                    `[automation] restoreConsumedSuspension('${runId}') could not read the durable suspended-run ` +
                        `store, so whether this run is still parked is UNKNOWN — the restore was REFUSED rather ` +
                        `than guessed, because reading an outage as "no suspension" is what would put a second ` +
                        `resumable pause on a live run. Nothing was written. Fix the store failure in this ` +
                        `record's meta, then re-issue the restore.`,
                    describeThrownForLog(err),
                );
                return this.refuseRestore(
                    runId,
                    'STORE_UNAVAILABLE',
                    `Durable suspended-run store unreachable for run '${runId}' — whether it is still suspended is unknown`,
                );
            }
            if (live) {
                return this.refuseRestore(
                    runId,
                    'RUN_SUSPENDED',
                    `Run '${runId}' is suspended at node '${live.nodeId}' and already resumable — nothing to restore`,
                );
            }

            // [#13937] Two witnesses of one strand, and neither is trusted
            // alone — the read is {@link resolveConsumedSuspensionWitnesses},
            // shared with the read-only {@link inspectConsumedSuspension} so
            // what that verb calls repairable is what this one restores. The
            // durable row is loaded HERE because this verb's posture on an
            // unreadable history is its own: a refusal, never a guess.
            let terminal: RunRecord | null = null;
            if (this.store?.loadTerminal) {
                try {
                    terminal = await this.store.loadTerminal(runId);
                } catch (err) {
                    this.logger.warn(
                        `[automation] restoreConsumedSuspension('${runId}') could not read the durable run-history ` +
                            `row, so whether a consumed suspension is recoverable for this run is UNKNOWN — the ` +
                            `restore was REFUSED rather than reported as "nothing to restore", which is the answer ` +
                            `an operator would act on by giving up. Nothing was written. Fix the store failure in ` +
                            `this record's meta, then re-issue the restore.`,
                        describeThrownForLog(err),
                    );
                    return this.refuseRestore(
                        runId,
                        'STORE_UNAVAILABLE',
                        `Durable run-history unreachable for run '${runId}' — whether a consumed suspension survives is unknown`,
                    );
                }
            }

            const { consumed, dropped, staleHot } = this.resolveConsumedSuspensionWitnesses(runId, terminal);
            // A hot copy of a pause the run has since LEFT — re-arming it
            // would send the run back through work it already did.
            if (staleHot) this.consumedSuspensions.delete(runId);

            if (!consumed) {
                // Nothing to restore — say WHICH nothing. The remedy differs for
                // every one of these and a single "bad run" refusal would send an
                // operator looking for the wrong thing.
                if (dropped) {
                    return this.refuseRestore(
                        runId,
                        'NO_CONSUMED_SUSPENSION',
                        `Run '${runId}' is recorded 'failed' and its consumed suspension (${dropped.bytes} bytes) was over ` +
                            `the store's ${dropped.budget}-byte row budget, so it was not persisted — it can be restored ` +
                            `only by the process that stranded it, while that process is still running`,
                    );
                }
                //
                // The durable row, when there is one, is the later word on how
                // the run ended than this process's own log — which may still
                // say `failed` for a run another replica finished.
                if (terminal?.status === 'completed') {
                    return this.refuseRestore(
                        runId,
                        'RUN_COMPLETED',
                        `Run '${runId}' completed — there is no unresumable state to exit`,
                    );
                }
                const logged = await this.getRun(runId);
                if (!logged) {
                    return this.refuseRestore(runId, 'RUN_NOT_FOUND', `No run '${runId}' is known`);
                }
                if (logged.status === 'completed') {
                    return this.refuseRestore(
                        runId,
                        'RUN_COMPLETED',
                        `Run '${runId}' completed — there is no unresumable state to exit`,
                    );
                }
                if (logged.status === 'cancelled') {
                    return this.refuseRestore(
                        runId,
                        'RUN_CANCELLED',
                        `Run '${runId}' was cancelled — restoring it would undo a deliberate decision`,
                    );
                }
                // ⛔ Deliberately does not claim WHICH: "it never paused" and
                // "its snapshot is gone" are indistinguishable from here, and
                // guessing would hand an operator a false certainty. The status
                // actually observed is named instead.
                return this.refuseRestore(
                    runId,
                    'NO_CONSUMED_SUSPENSION',
                    `Run '${runId}' is recorded '${logged.status}' and no consumed suspension is available for it ` +
                        `— it never suspended, or its snapshot is no longer held`,
                );
            }

            // Claim, then re-arm. No await between the claim and the write.
            this.consumedSuspensions.delete(runId);
            await this.persistSuspendedRun(consumed.run);

            // The run IS paused again, so the run log has to say so — otherwise
            // the repair is invisible on every surface that reads it and the
            // Runs view keeps calling a resumable run `failed`. This is the
            // SAME record the resume path writes when a run re-suspends at a
            // downstream node (`status: 'paused'`, carrying the variable
            // snapshot, #7639), for the same reason, and `getRun`'s
            // last-entry-wins order is what makes it the answer.
            //
            // ⚠️ Deliberately NOT terminal, so it neither writes a history row
            // nor clears the snapshot the row carries: until this run reaches a
            // real terminal state, "it failed mid-resume and was put back" is
            // the truth, and both halves of it should survive a restart.
            //
            // ⚠️ Measured limitation, stated rather than papered over: after a
            // restart the DURABLE surfaces still read this run `failed`, because
            // `getRun` / `listRuns` deliberately let a terminal row win over a
            // paused one (a paused row can outlive the run it describes). The
            // in-process log entry and the `warn` above are the trace this
            // ships. The #13937 ruling named the condition on the RESULT
            // (`status: 'stranded'`, the resume's catch arm), not on the run
            // row: `ExecutionStatus` carries no such member, so a durable
            // status that survives the restart is a spec-vocabulary decision
            // nobody has taken — the row's discriminator stays the snapshot.
            this.recordLog({
                id: runId,
                flowName: consumed.run.flowName,
                flowVersion: consumed.run.flowVersion,
                status: 'paused',
                startedAt: consumed.run.startedAt,
                durationMs: Date.now() - consumed.run.startTime,
                trigger: buildRunTrigger(consumed.run.context),
                steps: consumed.run.steps,
                variables: consumed.run.variables,
            }, consumed.run.context);

            // ⚠️ Uncontrolled text — the operator's own words and the original
            // thrown message — goes to the STRUCTURED slot, never the message
            // (#6299 family). `warn(message, meta?)`: meta is the SECOND
            // argument; `warn` has no `Error` slot.
            this.logger.warn(
                `[automation] run '${runId}' of flow '${consumed.run.flowName}': an operator RESTORED the ` +
                    // [#15222] "consumed at" rather than "its resume had
                    // consumed": an ancestor's pause was consumed by a
                    // descendant's cascade, not by a resume of its own, and the
                    // old wording was false for every member of a chain. Which
                    // of the two it was is not guessed here — `failure` in the
                    // meta below is the cascade's own text when it was one, and
                    // it is durable, where a marker on the journal would not be.
                    `suspension consumed at node '${consumed.run.nodeId}', so the run is resumable ` +
                    `again. ⚠️ Nothing the failed attempt already did was undone, and the original resume signal ` +
                    `was NOT replayed — the continuation must be re-issued. Who asked, why, and the failure this ` +
                    `is an exit from are in this record's meta.` +
                    (chainRestoreOf === undefined
                        ? ''
                        : ` This run was re-armed as one member of the nested chain repaired by the restore of ` +
                          `run '${chainRestoreOf}' — the continuation is re-issued on THAT run.`),
                {
                    runId,
                    flowName: consumed.run.flowName,
                    nodeId: consumed.run.nodeId,
                    nodeType: consumed.run.nodeType,
                    correlation: consumed.run.correlation,
                    consumedAt: consumed.consumedAt,
                    requestedBy: options?.requestedBy ?? 'not recorded',
                    restoreReason: options?.reason ?? 'not recorded',
                    failure: consumed.error,
                    ...(chainRestoreOf === undefined ? {} : { chainRestoreOf }),
                },
            );

            return {
                restored: true,
                runId,
                reason:
                    `Restored the suspension run '${runId}' consumed at node '${consumed.run.nodeId}' — the run is ` +
                    `resumable again; re-issue the continuation`,
                flowName: consumed.run.flowName,
                nodeId: consumed.run.nodeId,
                consumedAt: consumed.consumedAt,
            };
        } finally {
            this.restoring.delete(runId);
        }
    }

    /**
     * [#15358] **Read-only**: would {@link restoreConsumedSuspension} have a
     * consumed suspension to put back for `runId`? Answers from the SAME two
     * witnesses that verb reads — this process's hot journal and the durable
     * terminal row, reconciled by {@link resolveConsumedSuspensionWitnesses}
     * — and re-arms nothing and writes nothing. The one incidental mutation is
     * the strict suspension read's own: {@link loadSuspendedRunStrict} may
     * evict a phantom `suspendedRuns` entry the store has already answered
     * "no row" for (#15832; `evictConsumedSuspension` touches `suspendedRuns`
     * only, never the consumed-suspension journal) — identical to
     * {@link hasSuspendedRun} today. A stale hot copy the row supersedes is
     * REPORTED by the shared read and left in place; only the restore verb
     * drops it.
     *
     * ## Why a dedicated member, and not a field on the run
     *
     * The discriminator lives on the durable {@link RunRecord}
     * (`consumedSuspension` / `consumedSuspensionDropped`) and in this
     * process's journal; {@link getRun} answers an {@link ExecutionLogEntry},
     * which carries neither ON PURPOSE — `recordLog` keeps the snapshot off
     * that interface because `GET /automation/:name/runs/:runId` serves it
     * verbatim. So a consumer reading `getRun` sees `status: 'failed'` and
     * cannot tell the #13909 strand (repairable by the restore verb) from a
     * cascade-failed ancestor (`failAncestors` → `failSuspendedRun`, which
     * consumes the ancestor's pause and journals nothing — repairable by
     * nothing; #15222's shape). Ruled on #15358 (B′, 2026-09-07): the answer is
     * published as a dedicated read-only engine member, never on the wire.
     * plugin-approvals' stranded-request inspection is the first consumer.
     *
     * ⛔ Not a single `loadTerminal` read. A snapshot-less row is "the run
     * moved on" only when this process holds no hot copy whose write never
     * landed, and a drop notice is repairable from the hot copy on the very
     * replica that stranded the run — both measured wrong under a
     * single-witness reading (#13937's contract review). Sharing the read
     * with the restore verb is what keeps that from regressing in one of the
     * two alone.
     *
     * ## What it does NOT judge
     *
     * Whether re-arming would be SAFE at this instant — the `restoring` /
     * `resuming` guards — is the restore verb's own pre-flight. A verdict
     * here is about what survives, not about the moment.
     *
     * @throws when a store read fails — the suspended-run store or the run
     *   history. An unreadable store is UNKNOWN, and a read-only verdict that
     *   turned an outage into `NO_CONSUMED_SUSPENSION` would send an operator
     *   (or a sweep) to give up on a run that is repairable. Same posture as
     *   {@link hasSuspendedRun}; the restore verb answers `STORE_UNAVAILABLE`
     *   for the same observation.
     */
    async inspectConsumedSuspension(runId: string): Promise<ConsumedSuspensionInspection> {
        // Already resumable? STRICT read — a store outage throws through.
        const live = await this.loadSuspendedRunStrict(runId);
        if (live) return { repairable: false, runId, reason: 'RUN_SUSPENDED', nodeId: live.nodeId };

        let terminal: RunRecord | null = null;
        if (this.store?.loadTerminal) terminal = await this.store.loadTerminal(runId);

        const { consumed, witness, dropped } = this.resolveConsumedSuspensionWitnesses(runId, terminal);
        if (consumed && witness) {
            return {
                repairable: true,
                runId,
                flowName: consumed.run.flowName,
                nodeId: consumed.run.nodeId,
                ...(consumed.run.correlation !== undefined ? { correlation: consumed.run.correlation } : {}),
                witness,
                consumedAt: consumed.consumedAt,
            };
        }
        if (dropped) return { repairable: false, runId, reason: 'SNAPSHOT_DROPPED', dropped };
        return { repairable: false, runId, reason: 'NO_CONSUMED_SUSPENSION' };
    }

    /**
     * Walk a failed run's `$parentRunId` chain and fail each suspended
     * ancestor (see {@link failSuspendedRun}). Bounded so a corrupt context
     * can't loop forever.
     *
     * [#15222] Each hop carries the run BELOW it, so every ancestor's pause is
     * journalled for as long as the thing under it is repairable — the leaf on
     * the first hop, the ancestor this walk just journalled on every hop after
     * it. The chain therefore stays restorable to its full depth by induction,
     * and stops being journalled at the exact hop where re-arming would stop
     * being honest (an evicted journal, a store that dropped the snapshot).
     *
     * @param strandedRunId - The run that stranded and started this cascade.
     *   Omitted by a caller that has no repairable run below the walk.
     */
    private failAncestors(
        context: AutomationContext | undefined,
        error: string,
        strandedRunId?: string,
    ): Promise<void> {
        // The body lives in ./run-resume.ts (#25222).
        const host: ThisParameterType<typeof failAncestors> = {
            loadSuspendedRun: (...a) => this.loadSuspendedRun(...a),
            failSuspendedRun: (...a) => this.failSuspendedRun(...a),
            consumedSuspensions: this.consumedSuspensions,
        };
        return failAncestors.call(host, context, error, strandedRunId);
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
        // The body lives in ./run-history.ts (#25222).
        const host: ThisParameterType<typeof listSuspendedRuns> = {
            suspendedRuns: this.suspendedRuns,
        };
        return listSuspendedRuns.call(host);
    }

    /**
     * Like {@link listSuspendedRuns} but includes runs held only in the durable
     * {@link SuspendedRunStore} (e.g. suspended before a restart). Falls back to
     * the in-memory list when no store is configured.
     *
     * [#14332] The DURABLE row wins an id collision — the store is the shared
     * answer to "where is this run parked" and this process's map is only its
     * own memory of it. A run present in the map but absent from the durable
     * listing is still included, because a capped or failed enumeration is not
     * the per-id "no row" the strict loader rests on; see the merge below.
     */
    async listSuspendedRunsDurable(): Promise<Array<{ runId: string; flowName: string; nodeId: string; correlation?: string }>> {
        return this.readSuspendedRuns('degrade');
    }

    /**
     * The ONE reader of "which runs are parked" over BOTH run stores — the
     * body of {@link listSuspendedRunsDurable}, and the read the §7.3 disable
     * guard takes through {@link parkedRunsOf}, so the listing and the guard
     * can never disagree about a run the store answered for.
     *
     * They differ in ONE thing, the posture on an enumeration that FAILS:
     *  - `'degrade'` — the listing: warn, and answer from the cache alone.
     *  - `'throw'` — a caller that decides a WRITE on what is ABSENT from the
     *    answer: an outage is "unknown", never "not parked", so the store's
     *    own failure propagates and nothing is decided on a short list.
     *
     * [#20725] And in WHAT it asks, through `flowNames`. Absent, it is the
     * deployment-wide listing — `store.list()`, which a DB-backed store serves
     * as one capped page. Given, it asks only for those flows' runs, and asks
     * the durable store for ALL of them ({@link SuspendedRunStore.listByFlow},
     * complete by contract, or `list()` filtered where a store offers only
     * that): a guard deciding on a caller's absence from the answer must not
     * read a page in which that caller's run could be row 1001. ⛔ Raising the
     * listing's cap would not have been this: a bigger page is still a page.
     */
    private readSuspendedRuns(
        onEnumerationFailure: 'degrade' | 'throw',
        flowNames?: ReadonlySet<string>,
    ): Promise<Array<{ runId: string; flowName: string; nodeId: string; correlation?: string }>> {
        // The body lives in ./run-history.ts (#25222).
        const readStore = () => this.store;
        const host: ThisParameterType<typeof readSuspendedRuns> = {
            get store() { return readStore(); },
            logger: this.logger,
            suspendedRuns: this.suspendedRuns,
            cacheOnlySuspensions: this.cacheOnlySuspensions,
            evictConsumedSuspension: (...a) => this.evictConsumedSuspension(...a),
        };
        return readSuspendedRuns.call(host, onEnumerationFailure, flowNames);
    }

    /**
     * The screen a paused run is currently waiting on (screen-flow runtime), or
     * `null` if the run isn't suspended / didn't pause at a screen node. Lets a
     * UI flow-runner re-fetch the form after a refresh.
     *
     * Durable (#4515): the hot cache is the fast path, and a miss falls through
     * to the {@link SuspendedRunStore} via the same {@link loadSuspendedRun}
     * that {@link resume} rehydrates from — one loader, two callers. Without
     * that fallback a screen run that survived a restart could be *resumed* but
     * not *rendered*, which is precisely when a refresh-safe re-fetch matters.
     *
     * Best-effort by design: a store outage reads as "no such run" (`null`),
     * matching the 404 this backs. A caller that must distinguish "gone" from
     * "unknown" before writing anything wants {@link hasSuspendedRun}, which
     * throws instead.
     */
    async getSuspendedScreen(runId: string): Promise<ScreenSpec | null> {
        return (await this.loadSuspendedRun(runId))?.screen ?? null;
    }

    // ── DAG Traversal Core ──────────────────────────────────

    /**
     * Append a run to the in-memory ring buffer, fold its {@link FlowRunSummary},
     * log the one-line-per-run summary (#4354) and mirror a terminal run to
     * durable history.
     *
     * @returns the same entry, now carrying `summary` — so a caller returning an
     *   {@link AutomationResult} hands the counts straight back without a second
     *   fold or a `getRun` round-trip.
     */
    // [#10101] `context` is the run's {@link AutomationContext}, passed by
    // every call site (the same value each already hands `buildRunTrigger`) so
    // a TERMINAL record can carry the two organization-attribution inputs the
    // durable store resolves from: the triggering record snapshot (the
    // SUBJECT — primary, per the cloud#1395 Option A ruling) and the acting
    // tenant (the ruled fallback). Threaded as a parameter rather than read
    // off the entry because `ExecutionLogEntry` deliberately keeps the
    // published `trigger` block's shape (`ExecutionLogSchema`).
    // [#13909] `consumedSuspension` is the suspension a resume consumed before
    // the downstream node threw, passed ONLY by that one call site and copied
    // straight onto the {@link RunRecord} below. It is deliberately a parameter
    // rather than a field of {@link ExecutionLogEntry}: that interface is
    // served verbatim by `GET /automation/:name/runs/:runId`, so carrying a
    // whole variable map and run context on it would publish a paused run's
    // internals for every failed run — a disclosure change with no card behind
    // it, and the exact widening #7639 refused when it added `variables` to the
    // `paused` sites only.
    private recordLog(
        entry: ExecutionLogEntry,
        context?: AutomationContext,
        consumedSuspension?: SuspendedRun,
    ): ExecutionLogEntry {
        // The body lives in ./run-history.ts (#25222).
        const readStore = () => this.store;
        const host: ThisParameterType<typeof recordLog> = {
            executionLogs: this.executionLogs,
            maxLogSize: this.maxLogSize,
            runSummaryLog: this.runSummaryLog,
            logger: this.logger,
            get store() { return readStore(); },
            compactStepsForHistory: (...a) => this.compactStepsForHistory(...a),
            consumedSuspensions: this.consumedSuspensions,
        };
        return recordLog.call(host, entry, context, consumedSuspension);
    }

    /**
     * [#15788] Finish a REFUSED run — record the terminal row and build the
     * caller's result (#14945 ruling 2′, lane 2). Reached from either producer
     * of {@link FlowRefusalSignal}: an `end` node declaring
     * `outcome: 'refused'`, or a node returning
     * {@link NodeExecutionResult.refuse} (#18110 / #18555).
     *
     * **ONE method, three producers.** `execute()`, `resumeInternal` and
     * `executeWithoutRetry` each own a terminal exit, and this file's own
     * history is what makes a shared chokepoint non-negotiable here: the
     * author's `successMessage` (#9414) and the durable pause (#9510) were each
     * implemented at one exit and missing from the others, so the run's
     * user-visible outcome became a function of WHICH ROUTE it took — a
     * triggered run, a resumed screen flow and a run that succeeded on retry
     * are the same situation reached three ways. Same rule as
     * `seedRunVariables` (#9704) and `validateNodeInputSchemas` (#9889): one
     * method holds the shape, every path calls it.
     *
     * The envelope, member by member, is the ruling:
     *
     *  - `success: true` — the evaluation SUCCEEDED and said no. ⛔ Not
     *    `false`: a caller branching on `success` must not route a refusal into
     *    its error path, and the transport's `status: 'failed'` arm (#9378)
     *    must not claim it.
     *  - `status: 'refused'` — terminal, and DISTINCT from `failed`. Nothing
     *    threw, so there is no `error` and no `errorMessage`.
     *  - `refusalMessage` — the authored, already-rendered per-record text.
     *  - ⛔ no `successMessage`. The flow's completion toast is for a
     *    COMPLETION; stamping it here would toast "Account created!" over a
     *    refusal to create one. This is also the half the ruling protects from
     *    the other side — the paused-run `silent` contract is untouched
     *    because this arm never runs for a pause.
     *  - ⛔ no `runId`. That member's contract is "set when `status` is
     *    `'paused'`, so callers can resume it", and a refused run is never
     *    resumed — handing one back would advertise a verb that answers
     *    `RUN_NOT_FOUND`.
     *  - `flowLabel` — the refused run's own flow, as on every evaluation's
     *    result: the refusal notice is still shown under the flow's name.
     *
     * The `recordLog` call is guarded exactly as the completion sites are
     * (#16274 / #15555): a history write must never break the run that
     * produced it, and `summary` is recomputed from the same pure function when
     * the write had to be abandoned.
     */
    private finishRefusedRun(args: {
        runId: string;
        flowName: string;
        flowVersion?: number;
        startedAt: string;
        durationMs: number;
        steps: StepLogEntry[];
        /** Read for its `isOutput` variable declarations — see `output` below. */
        flow: FlowParsed;
        variables: Map<string, unknown>;
        refusalMessage?: string;
        context?: AutomationContext;
    }): AutomationResult {
        // The body lives in ./run-history.ts (#25222).
        const host: ThisParameterType<typeof finishRefusedRun> = {
            recordLog: (...a) => this.recordLog(...a),
            logger: this.logger,
        };
        return finishRefusedRun.call(host, args);
    }

    /**
     * Compact a run's step log for durable history. Delegates to the region-aware
     * {@link compactStepLogForHistory} (#3234): under {@link MAX_PERSISTED_HISTORY_STEPS}
     * the log is kept whole (stacks stripped); over budget it keeps the run's
     * structural backbone (top-level + container steps + every failure) plus the
     * most recent body steps, so a long loop's container survives and the Runs
     * surface can still nest what it retains.
     */
    private compactStepsForHistory(steps: StepLogEntry[]): StepLogEntry[] {
        return compactStepLogForHistory(steps, MAX_PERSISTED_HISTORY_STEPS);
    }

    /**
     * The node-type vocabulary this engine can validate against (ADR-0018).
     * A type is known if it is structural (start/end), has a registered
     * executor, or has a published action descriptor.
     */
    private knownNodeTypes(): Set<string> {
        return new Set<string>([
            ...FLOW_STRUCTURAL_NODE_TYPES,
            ...this.nodeExecutors.keys(),
            ...this.actionDescriptors.keys(),
        ]);
    }

    /**
     * The node types one flow references that the CURRENT vocabulary does not
     * cover. Pure — it reports, it never logs; the callers below decide whether
     * the answer is authoritative yet.
     *
     * Covers nodes inside ADR-0031 regions (#4389). A node in a `loop` body is
     * as executable as one beside it, so leaving regions out meant the warning
     * that exists to predict NO_EXECUTOR went quiet on exactly the nodes whose
     * failure is hardest to place at run time.
     */
    private unknownNodeTypes(flow: FlowParsed, known: Set<string>): string[] {
        return [...new Set(
            collectFlowGraphs(flow)
                .flatMap(g => g.nodes.map(n => n.type))
                .filter(t => !known.has(t)),
        )];
    }

    /**
     * Unknown-node-type audit over every ENABLED registered flow, against the
     * live registry (ADR-0018 §M1). Empty when every node type is covered.
     *
     * Disabled flows (`status: 'obsolete'`/`'invalid'`, or toggled off) are
     * skipped for the same reason the whole check moved: the finding asserts a
     * *run-time* failure, and a flow that cannot run cannot fail. Mirrors
     * {@link getTriggerBindingAudit}, which skips them too.
     *
     * Read this only where the vocabulary is complete — see
     * {@link sealNodeTypeVocabulary} for why "complete" is a moment in the boot
     * sequence and not a property of the engine.
     */
    getUnknownNodeTypeAudit(): UnknownNodeTypeAuditEntry[] {
        const known = this.knownNodeTypes();
        const audit: UnknownNodeTypeAuditEntry[] = [];
        for (const [flowName, flow] of this.flows) {
            if (!this.isFlowEnabled(flowName)) continue;
            const unknownTypes = this.unknownNodeTypes(flow, known);
            if (unknownTypes.length > 0) {
                audit.push({ flowName, unknownTypes, knownTypes: [...known] });
            }
        }
        return audit;
    }

    /**
     * Declare the node-type vocabulary CLOSED and run the authoritative
     * unknown-type audit, warning once per offending flow (#4771).
     *
     * Why this is a separate act, rather than a check inside `registerFlow`:
     * ADR-0018 makes the node vocabulary **open and runtime-extensible** — a
     * plugin contributes types via `registerNodeExecutor()` during its own
     * `init()`/`start()`. Flows, meanwhile, are registered from the boot pull
     * long before the last plugin has started. Validating at registration
     * therefore judged a world that had not finished forming: every ADR-0019
     * `approval` flow in the showcase was warned about as "will fail at
     * execution time" ~0.8s before `ApprovalsServicePlugin` registered the
     * `approval` executor. Eight false alarms per cold boot, phrased as an
     * assertion — and a deployment that genuinely lacks the plugin produced
     * the identical eight, so the signal could not tell the two apart.
     *
     * The host calls this once the vocabulary can no longer grow implicitly
     * (`AutomationServicePlugin` does it at `kernel:bootstrapped`, strictly
     * after every plugin's `start()` and every `kernel:ready` handler). From
     * then on `registerFlow` validates inline again — a flow published into a
     * running server (Studio publish, dev reload) IS being registered against
     * a complete vocabulary, and its unknown types deserve an immediate warn.
     *
     * Idempotent: only the first call warns (a second one would re-report
     * findings whose flows have not changed), and every call returns the
     * current audit so a host can surface it its own way — the CLI startup
     * summary reads engine state rather than scraping log lines.
     */
    sealNodeTypeVocabulary(): UnknownNodeTypeAuditEntry[] {
        const alreadySealed = this.nodeTypeVocabularySealed;
        this.nodeTypeVocabularySealed = true;
        const audit = this.getUnknownNodeTypeAudit();
        if (!alreadySealed) {
            for (const entry of audit) this.warnUnknownNodeTypes(entry);
        }
        return audit;
    }

    /**
     * Report — once per engine — that a flow ran on an engine whose node-type
     * vocabulary was never sealed, so the ADR-0018 §M1 check never ran (#4792).
     *
     * #4771 made {@link sealNodeTypeVocabulary} the *only* moment node types are
     * validated. `AutomationServicePlugin` calls it at `kernel:bootstrapped`, so
     * every plugin-hosted deployment is covered — but a host that constructs
     * `new AutomationEngine()` itself has no plugin doing it, and before #4771
     * those hosts *did* get a verdict at `registerFlow` (an accurate one, since
     * an embedded host controls its own ordering and typically registers
     * executors first). For them the fix traded an unreliable warning for no
     * warning at all, discoverable only by reading a changeset. "Documented" is
     * not "enforced" (ADR-0049, #4632), so the omission has to say its own name.
     *
     * **Why the first `execute()` is the right moment.** It is the earliest point
     * that is both safe and certain to be reached: the engine cannot know when a
     * host has finished wiring, but a host that is *running flows* has finished —
     * this very run resolves its executors from the same registry, and would fail
     * `NO_EXECUTOR` otherwise. On the plugin path the seal already happened at
     * `kernel:bootstrapped`, strictly before any `execute()`, so that path can
     * never reach this line (pinned by test, so the warning cannot become noise).
     *
     * **Why it names the missing CALL and not the audit findings.** Running the
     * unknown-type audit here and warning about what it finds would be the exact
     * shape AGENTS.md "Startup registry reads" forbids: an unsealed engine is one
     * whose host has *not* declared the vocabulary closed, so "no executor for
     * `approval`" is still "not registered YET" — a verdict this process can
     * contradict a line later, recorded in a log nobody can retract. That is
     * #4771 rebuilt inside the embedded path. The missing call, by contrast, is a
     * fact about the host that no later registration can change. A host that
     * wants the findings without sealing has {@link getUnknownNodeTypeAudit},
     * which is read-only by design.
     *
     * **Why it does not seal here.** Sealing would silently move the authority
     * over "the vocabulary is closed" from the host to the first execution, and
     * it would not be harmless: after the seal `registerFlow` validates inline,
     * so an embedded host that registers a plugin's executors *after* running a
     * flow — legal, ADR-0018 keeps the vocabulary open — would start getting the
     * false "will fail at execution time" assertions #4771 exists to delete. The
     * engine states the omission; the host still decides when the world is
     * closed.
     *
     * Keep this text clear of {@link warnUnknownNodeTypes}'s "no registered
     * executor or descriptor" phrase: tests and log filters use that substring
     * to count *per-flow* findings, and a line that merely talks about them must
     * not be counted as one.
     */
    private warnIfNodeTypeVocabularyNeverSealed(): void {
        if (this.nodeTypeVocabularySealed || this.nodeTypeSealOmissionWarned) return;
        this.nodeTypeSealOmissionWarned = true;
        this.logger.warn(
            `[automation] flow executed on an engine whose node-type vocabulary was never sealed — ` +
            `sealNodeTypeVocabulary() has not been called, so the ADR-0018 node-type check never ran and this ` +
            `engine has never reported a flow whose node types nothing has registered; such nodes now fail ` +
            `mid-run with NO_EXECUTOR instead of being named at startup. ` +
            `A host that constructs AutomationEngine directly must call engine.sealNodeTypeVocabulary() once every ` +
            `plugin has contributed its executors (AutomationServicePlugin does this at 'kernel:bootstrapped'); ` +
            `engine.getUnknownNodeTypeAudit() returns the same finding without closing the vocabulary. ` +
            `Reported once per engine instance.`,
        );
    }

    /** One warning per flow, shared by the boot audit and the post-seal path. */
    private warnUnknownNodeTypes(entry: UnknownNodeTypeAuditEntry): void {
        // #6654 — the unknown type names are FLOW-AUTHOR metadata and the
        // registered vocabulary is plugin-supplied (neither is
        // schema-constrained against newlines), so both lists ride the
        // structured slot, never the message; see `forgetSuspendedRun`'s
        // catch for the full mechanism (#6299). The "no registered executor
        // or descriptor" phrase is load-bearing — tests and log filters count
        // per-flow findings by it. #4632: FUNCTIONAL — stays `warn`.
        this.logger.warn(
            `Flow '${entry.flowName}' references node type(s) with no registered executor or descriptor — ` +
                `the unknown type names and the registered vocabulary are in this record's meta. Every plugin ` +
                `has started, so nothing will register them now — these nodes fail at execution time with ` +
                `NO_EXECUTOR. Install/enable the plugin that contributes them.`,
            { unknownTypes: entry.unknownTypes, knownTypes: entry.knownTypes },
        );
    }

    /**
     * [#23317] What {@link registerFlow} judges a canonical flow by after the
     * parse — every registration check, in the order it runs them. The ONE
     * list: `registerFlow` throws the first refusal, and
     * {@link registrationCheckRefusals} collects them all for the stored pass,
     * so a check added here is refused at registration and previewed by
     * `os migrate meta --stored` alike.
     *
     * `advisory` turns on the schema-aware expression pass, which logs and
     * never refuses: registration runs it, the stored pass does not, so the
     * doors that canonicalize without registering log nothing new.
     */
    private registrationChecks(
        { advisory }: { advisory: boolean },
    ): ReadonlyArray<(flowName: string, flow: FlowParsed) => RegistrationCheckRefusal | undefined> {
        // The body lives in ./flow-registration-checks.ts (#25222).
        const host: ThisParameterType<typeof registrationChecks> = {
            validateNodeConfigKeys: (...a) => this.validateNodeConfigKeys(...a),
            validateDecisionModes: (...a) => this.validateDecisionModes(...a),
            validateFlowExpressions: (...a) => this.validateFlowExpressions(...a),
            validateApiTriggerSecret: (...a) => this.validateApiTriggerSecret(...a),
        };
        return registrationChecks.call(host, { advisory });
    }

    /**
     * [#23317] Every refusal {@link registerFlow} would raise for a flow that
     * has passed the parse, without registering it — what the stored pass
     * lists through {@link canonicalizeStoredFlow}.
     *
     * Never throws. A check that throws instead of refusing still names a flow
     * `registerFlow` does not register (it throws the same error there), so it
     * is listed as one refusal at the flow itself: the doors that canonicalize
     * without registering must not start throwing for a check they never ran.
     */
    private registrationCheckRefusals(flowName: string, flow: FlowParsed): RegistrationCheckRefusal[] {
        // The body lives in ./flow-registration-checks.ts (#25222).
        const host: ThisParameterType<typeof registrationCheckRefusals> = {
            registrationChecks: (...a) => this.registrationChecks(...a),
        };
        return registrationCheckRefusals.call(host, flowName, flow);
    }

    /**
     * REJECT node `config` keys the node type's descriptor does not declare
     * (#4277 — the error half of the #4045 unknown-key ladder; #4059 shipped
     * the warn half).
     *
     * `FlowNodeSchema.config` is `z.record(z.unknown())`, so before #4059 a
     * misspelled or invented config key was accepted in total silence:
     * `visibleIf` instead of `visibleWhen` registered cleanly and then did
     * nothing, which is exactly the failure shape that made #3528 take three
     * passes to diagnose. The key is never read, so there is no runtime error
     * to trace back — the only symptom is a feature that quietly does not
     * happen.
     *
     * **Why an error is safe now.** An undeclared key falls into three
     * populations, and when #4059 landed this seam could not tell them apart:
     * an author typo (reject), a key the executor genuinely reads that its
     * hand-written `configSchema` never declared (`notify.source` was exactly
     * this — rejecting those breaks working apps), and dead config nobody
     * reads. The #4045 reconciliation closed the second population — every
     * read-but-undeclared key across the schema-carrying builtins was either
     * declared on its descriptor or graduated into the ADR-0087 conversion
     * layer, with ledger tests ratcheting both directions — and the #4059
     * warning measured what remains in live metadata. What survives to this
     * check today is typos and dead config, and both are metadata bugs the
     * platform's contract-first rule says to reject at the producer, loudly
     * (Prime Directive #12; ADR-0032 no-silent-failure).
     *
     * The rejection carries its prescription (the `UNKNOWN_KEY_GUIDANCE`
     * pattern from `object.zod.ts`): every violation names its exact path, the
     * declared key set, a did-you-mean when edit distance allows, and — for
     * keys with documented history — a per-key tombstone from
     * {@link FLOW_NODE_UNKNOWN_KEY_GUIDANCE}.
     *
     * **[#21982] One judge per node type.** For every builtin the spec judges
     * ({@link builtinNodeConfigKeysJudged} — every builtin with an executor
     * contract, `try_catch` included since its `retry` closed, #22343), the
     * spec's key arm is the judge, at every door: `FlowSchema.parse` above
     * already refused such a key, anchored at `nodes.N.config.<key>` in the
     * contract's own words, before this walk runs. So this walk stands aside
     * for those types and keeps the rest: every PLUGIN node type, whose
     * contract the spec does not declare and whose descriptor `configSchema`
     * is the only declaration there is. No builtin reaches it any more — the
     * builtins it does not skip publish no `configSchema` (`decision`, `wait`,
     * `connector_action`) or are exempt (`assignment`). The per-key tombstones below
     * ({@link FLOW_NODE_UNKNOWN_KEY_GUIDANCE}) live on in the contracts' own
     * unknown-key prescriptions for the types the spec now judges.
     *
     * Deliberate exemptions, unchanged from the warn era:
     *  - **`assignment` is exempt wholesale**: with no `assignments` wrapper
     *    its top-level config keys ARE the author's variable names
     *    (logic-nodes.ts normalizes three shapes), so no fixed key set can
     *    describe it — pinned as un-reconcilable by the form↔Zod ledger.
     *  - Schemaless types (`decision`, `script`, `wait`, `subflow`,
     *    `connector_action`) publish no `configSchema` ⇒ nothing is declared,
     *    so nothing can be undeclared. `wait` / `connector_action` keep their
     *    contracts on FlowNode SIBLING blocks (`waitEventConfig` /
     *    `connectorConfig`), which this walk never touches.
     *  - keyValue maps (`additionalProperties: true`, no fixed `properties`)
     *    stop the walk: their keys are author data, not config keys.
     *
     * Hard-fail matches {@link validateFlowExpressions} below — a flow whose
     * metadata is wrong never registers, and every `registerFlow` call site
     * already try/catches per flow, so a bad flow is skipped loudly at boot
     * rather than crashing the kernel. [#23317] The refusal is returned, not
     * thrown: `registerFlow` throws it ({@link registrationChecks}).
     */
    private validateNodeConfigKeys(flowName: string, flow: FlowParsed): RegistrationCheckRefusal | undefined {
        // The body lives in ./flow-registration-checks.ts (#25222).
        const host: ThisParameterType<typeof validateNodeConfigKeys> = {
            actionDescriptors: this.actionDescriptors,
            collectUndeclaredConfigKeys: (...a) => this.collectUndeclaredConfigKeys(...a),
        };
        return validateNodeConfigKeys.call(host, flowName, flow);
    }

    /**
     * [#15429] The registration-time reader of a `decision` node's `mode`.
     *
     * `decision` publishes no descriptor `configSchema` (its Target column is
     * derived from the out-edges), so {@link validateNodeConfigKeys}'
     * schemaless exemption skips it and, until this pass, nothing at run time
     * parsed its config at all — `mode` was export-only, enforced by `tsc`, the
     * published JSON Schema and the objectui reconciliation, and a stored
     * `mode: 'bogus'` registered clean and ran as whatever the traversal made
     * of it. Now every decision's config goes through the spec's
     * `DecisionConfigSchema` here and the flow is refused on any issue rooted
     * at `mode`: a value outside `'exclusive' | 'inclusive'`, or a legal `mode`
     * beside a non-empty `conditions` list (a list is first-match on its own,
     * so a `mode` beside it would be accepted and never read — ruling A on
     * #20168). The refusal is the schema's own sentence, shared with
     * `os validate`'s `flow-decision-mode-invalid`, so build time and
     * registration cannot disagree about the key.
     *
     * Judged on `mode` alone, deliberately. The same parse also refuses an
     * undeclared key on a decision (the shape is `strictObject`), but that
     * strictness binds at authoring by a standing decision (the module header
     * of `schemaless-node-config.zod.ts`): a flow carrying an inert extra key
     * registered and ran before this pass, and refusing it at boot would be a
     * second behaviour change riding a ruling that ordered one. `os validate`
     * keeps reporting that shape through its own advisory rule.
     *
     * Hard-fail, like {@link validateNodeConfigKeys}: a flow whose gateway
     * declares a mode the engine does not have is wrong metadata, and the
     * caller's per-flow try/catch skips it loudly at boot rather than arming a
     * gateway that would run as something the author did not write. [#23317]
     * The refusal is returned, not thrown: `registerFlow` throws it.
     */
    private validateDecisionModes(flowName: string, flow: FlowParsed): RegistrationCheckRefusal | undefined {
        // The body lives in ./flow-registration-checks.ts (#25222).
        return validateDecisionModes(flowName, flow);
    }

    /**
     * ADR-0041 — the registration-time half of `trigger-api`'s acceptance
     * criteria: "a per-flow secret; HMAC signature verification". A flow whose
     * binding resolves to the `api` trigger (the kind {@link
     * deriveTriggerBinding} answers — `type: 'api'` or a start-node
     * `triggerType: 'api'`) and whose start node carries no non-blank
     * `config.secret` is refused, whatever its `status`: such a flow can never
     * be armed, and an author who wrote it should hear so at publish time,
     * not from a boot audit.
     *
     * It reads the BINDING's `config` — the same object `trigger-api`'s
     * `start()` reads the secret from — so the two refusals judge one input
     * and cannot disagree about which flows need a secret. The rule is kept in
     * both places deliberately: `@objectstack/trigger-api` does not depend on
     * this package (nor this package on it), and the trigger's own refusal is
     * what protects a host that binds without this engine.
     *
     * Hard-fail, like {@link validateNodeConfigKeys}: every `registerFlow` call
     * site already try/catches per flow, so a refused flow is skipped loudly
     * at boot, and the `/automation` write doors answer the throw as `400
     * VALIDATION_FAILED`. [#23317] The refusal is returned, not thrown:
     * `registerFlow` throws it.
     */
    private validateApiTriggerSecret(flowName: string, flow: FlowParsed): RegistrationCheckRefusal | undefined {
        // The body lives in ./flow-registration-checks.ts (#25222).
        const host: ThisParameterType<typeof validateApiTriggerSecret> = {
            deriveTriggerBinding: (...a) => this.deriveTriggerBinding(...a),
        };
        return validateApiTriggerSecret.call(host, flowName, flow);
    }

    /**
     * Walk `value` against `schema` in lockstep, collecting keys the schema does
     * not declare into `violations`.
     *
     * Descends **only where the schema declares structure** — an object with fixed
     * `properties`, or an array whose `items` do. It deliberately stops at a
     * keyValue map (`additionalProperties: true` with no `properties`): those keys
     * are author *data* (`filter: { status: 'stale' }`), not config keys, and
     * flagging them would make the check useless noise.
     *
     * Descending matters rather than being thoroughness for its own sake: the
     * #3528 typo class lives *inside* the `screen` field repeater, not at the top
     * level. `visibleWhen` is a property of `fields[].items`, so a top-level-only
     * comparison would miss `visibleIf` — the exact mistake this check exists to
     * catch — while still reporting the rarer top-level ones. A test pins it.
     */
    private collectUndeclaredConfigKeys(
        node: FlowNodeParsed,
        schema: ConfigSchemaNode,
        value: unknown,
        path: string,
        violations: UndeclaredConfigKey[],
    ): void {
        // The body lives in ./flow-registration-checks.ts (#25222).
        const host: ThisParameterType<typeof collectUndeclaredConfigKeys> = {
            collectUndeclaredConfigKeys: (...a) => this.collectUndeclaredConfigKeys(...a),
        };
        collectUndeclaredConfigKeys.call(host, node, schema, value, path, violations);
    }

    /**
     * ADR-0032 §Decision 1a — parse-validate every predicate in the flow at
     * registration. Predicates are bare CEL; this catches the #1491 class
     * (`{record.x}` template braces in a condition → CEL parse error) and any
     * other malformed predicate LOUDLY, with the offending location + source +
     * a corrective hint, instead of letting it fail silently at run time.
     *
     * Two families of surface are checked:
     *
     *  1. The *structural* predicates every flow has — start/node
     *     `config.condition` and `edge.condition`. Always bare CEL.
     *  2. Every **descriptor-declared** bare-CEL slot named by
     *     `FLOW_NODE_EXPRESSION_PATHS` (#4027) — the ledger records the dialect
     *     each declared slot takes, and the `predicate` ones are checked here.
     *
     * (2) exists because assuming "node string fields are templates" is what let
     * #3528 ship: `screen.fields[].visibleWhen` is declared *bare CEL*, this pass
     * never traversed it, and an app authored it in the `{var}` template dialect
     * its sibling config keys use. Nothing complained at any layer. The ledger is
     * the declared list of such slots and is reconciled against the live
     * descriptors by a test, so a newly declared expression key cannot go
     * unvalidated again.
     *
     * Recording the dialect is what makes (2) safe rather than a regression:
     * `{…}` is the #1491 brace-trap in a bare-CEL slot, and a `value` slot's
     * expression is an envelope rather than a string. Until #19939 a third
     * role recorded the single-brace `{var}` slots (`loop` / `map`
     * `collection`), skipped because no validator implements that dialect; both
     * are value slots now, and the role is gone.
     *
     * #1928 — when an object-schema resolver is wired ({@link setObjectSchemaResolver}),
     * a second, schema-aware pass surfaces the checks `objectstack build` runs
     * (unknown-field refs, likely bare-field typos, text/boolean fields misused
     * in arithmetic) as ADVISORY warnings (logged, never thrown). Flow conditions
     * bind the record's fields flat, so the schema pass uses `flattened` scope.
     * The fatal set is unchanged — a resolver can never break a flow that used to
     * register cleanly. `advisory: false` skips that pass: the stored pass
     * previews refusals ({@link registrationCheckRefusals}), and an advisory
     * finding is none.
     *
     * [#23317] The refusal is returned, not thrown: `registerFlow` throws it.
     * Each failure is recorded with its site, so the stored pass lists it
     * where the author wrote it.
     */
    private validateFlowExpressions(
        flowName: string,
        flow: FlowParsed,
        { advisory }: { advisory: boolean },
    ): RegistrationCheckRefusal | undefined {
        // The body lives in ./flow-registration-checks.ts (#25222).
        const host: ThisParameterType<typeof validateFlowExpressions> = {
            logger: this.logger,
            objectSchemaResolver: this.objectSchemaResolver,
            valueEnvelopeRefusals: (...a) => this.valueEnvelopeRefusals(...a),
        };
        return validateFlowExpressions.call(host, flowName, flow, { advisory });
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
        // The body lives in ./flow-registration-checks.ts (#25222).
        detectCycles(flow);
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
     *
     * [#9889] The ONE definition-level input-schema chokepoint, called by BOTH
     * attempt paths — `execute()` (attempt 1) and `executeWithoutRetry` (every
     * retry attempt) — the same chokepoint discipline `seedRunVariables`
     * carries for the variable environment (#9704). Its verdict is a pure
     * function of the flow definition (`_variables` is deliberately unused),
     * so a refusal on attempt 1 must hold on every attempt: when only
     * `execute()` called it, `errorHandling.strategy: 'retry'` ran the very
     * nodes attempt 1 refused to run. ⛔ A repair to the validation rules
     * belongs HERE, in the shared method — re-inlining either caller's copy
     * re-opens the execute/executeWithoutRetry drift this file has now paid
     * for six times (#9378, #9415, #9414, #9510, #9704, #9889).
     *
     * [#10025] Throws {@link InputSchemaViolationError}, not a bare `Error`:
     * because the verdict cannot change between attempts, the maintainer ruled
     * the refusal NON-RETRYABLE (2026-08-20, Option B taken whole), and
     * `execute()`'s catch needs a typed throw to classify it as the
     * never-dispatched `FLOW_INPUT_SCHEMA_INVALID` exit without sniffing
     * message prose. The chokepoint contract above is unchanged — both attempt
     * paths still call this method identically; what changed is what
     * `execute()` does with the throw.
     */
    private validateNodeInputSchemas(flow: FlowParsed, _variables: Map<string, unknown>): void {
        for (const node of flow.nodes) {
            if (node.inputSchema && node.config) {
                for (const [paramName, paramDef] of Object.entries(node.inputSchema)) {
                    if (paramDef.required && !(paramName in (node.config as Record<string, unknown>))) {
                        throw new InputSchemaViolationError(
                            `Node '${node.id}' missing required input parameter '${paramName}'`,
                        );
                    }
                    const value = (node.config as Record<string, unknown>)[paramName];
                    if (value !== undefined) {
                        const actualType = this.getValueType(value);
                        if (actualType !== paramDef.type) {
                            throw new InputSchemaViolationError(
                                `Node '${node.id}' parameter '${paramName}' expected type '${paramDef.type}' but got '${actualType}'`,
                            );
                        }
                    }
                }
            }
        }
    }

    /**
     * #3863 — publish a failed node's message under `<nodeId>.error` alongside
     * the run-wide `$error`.
     *
     * `$error` names only the most recent failure, so a flow with more than one
     * `fault` edge converging on a shared handler cannot tell which node it is
     * handling. Keying by node id makes `{cleanup.error}` addressable from any
     * downstream template, which is what a handler needs to branch or report.
     * Merges into an existing entry so a node's earlier `output` survives.
     */
    private setNodeError(variables: Map<string, unknown>, nodeId: string, message: string): void {
        const prior = variables.get(nodeId);
        const base = prior && typeof prior === 'object' && !Array.isArray(prior)
            ? (prior as Record<string, unknown>)
            : {};
        variables.set(nodeId, { ...base, error: message });
    }

    /**
     * [#22450] A refusing `end` node's message, rendered in the run's language.
     *
     * The run stores the refusal already rendered
     * (`sys_automation_run.refusal_message`, `AutomationResult.refusalMessage`),
     * so the translation has to be picked HERE, as a template, before its
     * `{{ }}` holes are filled — {@link renderFlowTextSlot}, at
     * `flowRefusalMessageKey` (`@objectstack/spec/system`). This is the
     * validation-message precedent (objectql's `authoredRuleMessage`) on the
     * automation side.
     */
    private renderRefusalMessage(
        flowName: string,
        nodeId: string,
        authored: string | undefined,
        variables: Map<string, unknown>,
        context: AutomationContext,
    ): string | undefined {
        return this.renderFlowTextSlot(
            {
                key: flowRefusalMessageKey(flowName, nodeId),
                authored,
                subject: `flow '${flowName}' refused at node '${nodeId}'`,
                shownAs: 'the refusal',
            },
            variables,
            context,
        );
    }

    /**
     * [#22450, #22507] Render one user-read flow TEXT slot in the run's
     * language: pick the translated TEMPLATE at `slot.key`, then fill its
     * `{{ }}` holes through `renderTextSlot`, the one text renderer — or render
     * the authored template when no translation is picked.
     *
     * The rule it implements is stated once, in the maintainer's ruling on
     * #22507: a user-read flow string the server renders per run is translated
     * where it is rendered, in the run's locale, before its holes are filled,
     * and a client overlay never touches a server-rendered slot. Its callers
     * are the refusing `end` node ({@link renderRefusalMessage}) and the
     * `screen` executor (its heading and body text, at `flowScreenCopyKey`).
     * One pick for all of them:
     *
     *  - the address is the caller's key in the `flows` translation face
     *    (`@objectstack/spec/system` spells each one);
     *  - the channel is the existing `i18n` service, reached through
     *    {@link setI18nServiceSource} — no second i18n path;
     *  - the locale is `AutomationContext.locale`, the door's already-resolved
     *    `ExecutionContext.locale`, negotiated against the locales the service
     *    holds by `resolveBundleLocale`, the one bundle-locale rule.
     *
     * The authored template renders whenever no translation is picked: no
     * locale on the run (a record-change or schedule trigger, code calling
     * `execute` directly), no service, no entry (`t()` echoes the key on a
     * miss; an empty skeleton slot reads as none), or a service that throws. A
     * resumed leg renders in the locale the run was STARTED in — the context is
     * persisted with the suspended run and a resume carries none of its own.
     *
     * A translation is a text slot like the template it translates: the
     * single-brace `{token}` is refused at every door that reads the bundle
     * (`TranslationDataSchema`, the one text-slot judge) for the keys that
     * judge covers. If one still fails to compile here, it is a translator's
     * defect, not the run's: the run must not fail on it, so the authored
     * template renders and the line below names the key and the reason. A
     * failure of the AUTHORED template still throws, exactly as before.
     */
    renderFlowTextSlot(
        slot: FlowTextSlotTranslation,
        variables: Map<string, unknown>,
        context: AutomationContext,
    ): string | undefined {
        const translated = this.translatedFlowTemplate(slot, context.locale);
        if (translated !== undefined) {
            try {
                return renderTextSlot(translated.template, variables);
            } catch (err: unknown) {
                if (!(err instanceof FlowTextTemplateError)) throw err;
                this.logger.warn(
                    `[automation] ${slot.subject}: the '${translated.locale}' translation at '${slot.key}' does not ` +
                    `compile (${err.message}), so ${slot.shownAs} shows its authored text instead. Fix the ` +
                    `translation's holes to match the authored text.`,
                );
            }
        }
        return renderTextSlot(slot.authored, variables);
    }

    /**
     * [#22450, #22507] The translated TEMPLATE at `slot.key` for `requested`, or
     * `undefined` when none is picked — see {@link renderFlowTextSlot} for
     * every reason.
     */
    private translatedFlowTemplate(
        slot: FlowTextSlotTranslation,
        requested: string | undefined,
    ): { template: string; locale: string } | undefined {
        if (typeof requested !== 'string' || requested.length === 0) return undefined;
        let service: RefusalI18nService | undefined;
        try {
            service = this.i18nServiceSource?.();
        } catch {
            return undefined;
        }
        if (!service || typeof service.t !== 'function') return undefined;
        const locale = negotiatedServiceLocale(service, requested);
        const { key } = slot;
        try {
            const template = service.t(key, locale);
            // II18nService echoes the key back on a miss.
            if (typeof template === 'string' && template.length > 0 && template !== key) {
                return { template, locale };
            }
        } catch (err: unknown) {
            this.logger.warn(
                `[automation] ${slot.subject}: the i18n service threw reading '${key}' ` +
                `(${err instanceof Error ? err.message : String(err)}), so ${slot.shownAs} shows its authored text.`,
            );
        }
        return undefined;
    }

    /**
     * Execute a node with timeout support, fault edge handling, and step logging.
     */
    private executeNode(
        node: FlowNodeParsed,
        flow: FlowParsed,
        variables: Map<string, unknown>,
        context: AutomationContext,
        steps: StepLogEntry[],
    ): Promise<void> {
        // The body lives in ./dag-traversal.ts (#25222).
        const host: ThisParameterType<typeof executeNode> = {
            renderRefusalMessage: (...a) => this.renderRefusalMessage(...a),
            nodeExecutors: this.nodeExecutors,
            executeWithTimeout: (...a) => this.executeWithTimeout(...a),
            setNodeError: (...a) => this.setNodeError(...a),
            executeNode: (...a) => this.executeNode(...a),
            refuseUndeclaredSuspension: (...a) => this.refuseUndeclaredSuspension(...a),
            traverseNext: (...a) => this.traverseNext(...a),
        };
        return executeNode.call(host, node, flow, variables, context, steps);
    }

    /**
     * Traverse a node's out-edges and execute its successors. Split out of
     * {@link executeNode} so {@link resume} can re-enter traversal from a
     * suspended node without re-running the node body.
     *
     * Three declared mechanisms select a branch here, and #4414 found two of
     * them doing nothing. They now compose as ONE model, applied in this order:
     *
     *  1. **`branchLabel`** (from a `decision`/`approval` executor or a resume
     *     signal) narrows the edge set to out-edges carrying that `label`.
     *     {@link DEFAULT_BRANCH_LABEL} is the engine's own sentinel for "the
     *     node's declared conditions all failed" and is additionally claimed by
     *     the BPMN default edge. A label NO edge claims is a metadata error —
     *     traversal still falls back to the full edge set (a run mid-flight must
     *     not die on it) but it is now **logged**, not silent: the decision had
     *     computed a branch and nothing routed it, which is how app-crm's
     *     convert-lead guard ran its abort screen AND its wizard.
     *  2. **`edge.condition`** — evaluated per edge; a closed gate records a
     *     `skipped` step (#4354). On a `decision` node the conditioned
     *     out-edges are EXCLUSIVE (#15429): evaluated in declaration order,
     *     the first one that holds is the branch and its later siblings are
     *     passed over unevaluated, recording the same `skipped` step. A
     *     decision declaring `config.mode: 'inclusive'` takes every one that
     *     holds instead.
     *  3. **`edge.isDefault`** — BPMN default flow. Traversed **only** when no
     *     conditional sibling in the selected set matched. Before #4414 this key
     *     had zero readers: it parsed, it was documented as "the default path
     *     when no other conditions match", and it routed nothing — an author who
     *     reached for it got an ordinary unconditional edge that ran on every
     *     pass, in parallel with the branch that *did* match.
     *
     * A default edge is therefore NOT part of the unconditional parallel fan-out
     * — that distinction is the whole point of the marker. An edge that carries
     * both a `condition` and `isDefault` is self-contradictory (BPMN forbids it);
     * the `condition` wins here, and the flow linter flags the shape at authoring
     * time (`flow-default-edge-with-condition`) so it is caught before it runs —
     * Prime Directive #12.
     *
     * @param branchLabel - When set, restrict traversal to out-edges whose
     *   `label` matches — this is how an Approval node's `approve`/`reject`
     *   decision selects its downstream branch.
     */
    private traverseNext(
        node: FlowNodeParsed,
        flow: FlowParsed,
        variables: Map<string, unknown>,
        context: AutomationContext,
        steps: StepLogEntry[],
        branchLabel?: string,
    ): Promise<void> {
        // The body lives in ./dag-traversal.ts (#25222).
        const host: ThisParameterType<typeof traverseNext> = {
            logger: this.logger,
            evaluateCondition: (...a) => this.evaluateCondition(...a),
            executeNode: (...a) => this.executeNode(...a),
        };
        return traverseNext.call(host, node, flow, variables, context, steps, branchLabel);
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
     * `NodeExecutionResult.childSteps`. Tagging only ever fills fields left
     * undefined, so when regions nest each step keeps its **innermost**
     * container's IDENTITY — `parentNodeId` / `regionKind` / `retryAttempt`.
     *
     * #15230: the INDEX fields are the exception, and the reason this card
     * exists. `iteration` and `branch` are carried THROUGH nesting: an
     * enclosing region fills the index the inner region left undefined instead
     * of being discarded because the step already had a `parentNodeId`. Before
     * this, `loop { parallel }` recorded the branch index and nothing else, so
     * a per-row failure inside a branch was attributable to a branch and never
     * to the row.
     *
     * #7546: a region that FAILS still throws — the `try_catch` retry/throw
     * semantics are untouched — but its partial steps are no longer discarded.
     * They are tagged exactly like a successful region's and handed to the
     * caller through the `partialSteps` sink before the throw propagates, so a
     * container that recovers from the failure can still fold them into the run
     * log. Until this, a caught failure left NO trace at all: the container's
     * own step read `success`, nothing carried `regionKind: 'try'`, nothing
     * carried `status: 'failure'`, and an operator could not tell what failed,
     * how many attempts ran, or which node threw — the only evidence a failure
     * had happened was the catch region's side effects. The steps always
     * existed (a failing node pushes its own `failure` step into the region's
     * array before it throws); they were simply dropped on the floor when the
     * region unwound.
     *
     * A sink rather than a return value because the failure path's contract is
     * still "throw": handing the steps back through the exception would either
     * change what callers catch or require a bespoke error type, and both are
     * larger seams than an out-parameter the two callers that want it opt into.
     * Callers that do not pass a sink (`loop`, `parallel`) are unaffected.
     *
     * [#18881] Durable pause (`suspend`) inside a region is not supported —
     * #3267 ruled that limit 禁, and this boundary is where the run meets it.
     * The conversion is a NAMED refusal
     * ({@link FlowRegionSuspensionRefusalError}) carrying the region node, the
     * suspending node and the sub-flow, ⛔ not the plain `Error` it used to
     * raise: an enclosing `try_catch` read that one as an ordinary region
     * failure, ran its catch handler, and the run reported success over a sweep
     * that had processed nothing. The container executors test for the named
     * type and re-throw, so no region can contain it.
     */
    runRegion(
        region: FlowRegionParsed,
        variables: Map<string, unknown>,
        context: AutomationContext,
        grouping?: { parentNodeId: string; iteration?: number; branch?: number; regionKind?: string; retryAttempt?: number },
        partialSteps?: StepLogEntry[],
    ): Promise<StepLogEntry[]> {
        // The body lives in ./dag-traversal.ts (#25222).
        const host: ThisParameterType<typeof runRegion> = {
            executeNode: (...a) => this.executeNode(...a),
        };
        return runRegion.call(host, region, variables, context, grouping, partialSteps);
    }

    /**
     * Race a node's execution against its `timeoutMs` guard, and reclaim the
     * guard the moment the race settles (#4952).
     *
     * The guard used to be armed and then abandoned: when the node won the
     * race, its `setTimeout` stayed ref'd in the event loop for the full
     * `timeoutMs`. Same leak as the kernel's startup guards (#4813, PR #4874)
     * and the health checks (#4875, PR #4950), with the widest blast radius of
     * the three — this is the per-node hot path, so the orphan count grows with
     * flow size × trigger frequency, and a one-shot process (`os` CLI running a
     * flow) idles for the longest `timeoutMs` it happened to arm after its work
     * is done.
     *
     * Clearing on settle rather than `unref()`-ing at arm time is deliberate.
     * An unref'd guard also stops pinning the loop, but it stops being a guard
     * as well: if the node never settles and nothing else keeps the loop alive,
     * Node exits before the timer can fire and the timeout is never reported.
     * The guard has to stay ref'd exactly as long as the race is undecided,
     * which is what `clearTimeout` in a `finally` expresses.
     *
     * No `T | PromiseLike<T>` widening here (unlike the kernel and
     * health-monitor helpers, whose hooks may be synchronous):
     * `NodeExecutor.execute` is declared `Promise`-returning.
     */
    private executeWithTimeout(
        promise: Promise<NodeExecutionResult>,
        timeoutMs: number,
        nodeId: string,
    ): Promise<NodeExecutionResult> {
        // The body lives in ./dag-traversal.ts (#25222).
        return executeWithTimeout(promise, timeoutMs, nodeId);
    }

    /**
     * The CEL scope a flow expression is evaluated in — ONE builder, shared by
     * the predicate path ({@link evaluateCondition}) and the `value` path
     * ({@link evaluateValueEnvelope}), extracted from the former in #15137.
     *
     * Flat variable keys carrying dots (`step.result`) become nested object
     * paths, and the result is exposed two ways under `extra`: as a `vars`
     * namespace (so `vars.step.result` keeps working) AND spread to top level
     * (so bare identifiers like `status` / `previous.status` resolve — the
     * natural authoring style for record-change start conditions, and what lets
     * an assignment envelope write `joinNonEmpty(rows.map(r, r.subject), "\n")`
     * against a `rows` variable).
     *
     * Shared deliberately: a predicate and a value expression that disagreed
     * about what `rows` means would be two dialects wearing one name.
     *
     * ## `current_user` — the run's user, or `null` (#19939)
     *
     * The scope also binds `current_user`, ADR-0068's canonical user root, from
     * the run context the caller passes ({@link runUserOf}): the run's
     * `EvalUser` when the run has a user, and `null` when it has none — never
     * a pseudo-user (ADR-0118 D1, D4). It carries `id`, `positions`,
     * `organizationId` and the `isPlatformAdmin` flag derived from them, and no
     * email or name: the run context's email is for row policies only (see
     * {@link runUserOf}). This is what the
     * retired `{$User.Id}` value-slot token is refused in favour of, so it
     * reads the same context the 17.x interpolator's `$User.Id` branch read.
     *
     * `vars` and `current_user` are bound AFTER the variables are spread, so
     * each wins over a flow variable of the same name — which is then read as
     * `vars["vars"]` / `vars["current_user"]` (the spec's
     * `FLOW_SCOPE_CLAIMED_IDENTIFIERS`, measured from here).
     *
     * ## `record` — the record the run was handed, or unbound (#22642)
     *
     * This builder binds no `record` of its own. `record` resolves through the
     * spread like any other name, so it is bound exactly when the variable map
     * holds a `record` key:
     *
     *  - an entrance handed the run a record. {@link seedRunVariables} binds
     *    `context.record` as `record` (and `$record`), and every entrance hands
     *    its record there: a record-change trigger's row, a time-relative
     *    sweep's row, the inbound hook's request body (`trigger-api`), a
     *    `type: 'flow'` action's record (the row it loaded, or an empty record
     *    carrying at most the `id` it was given), a parent's (`subflow` and
     *    `map` spread the parent's context into the child's) and a `map` item
     *    that carries a string `id`. The REST trigger route, a declared
     *    endpoint and a cron schedule hand none;
     *  - or the flow binds a variable named `record` itself: a declared
     *    variable that has a value, or an assignment target.
     *
     * With neither, `record.X` faults `Unknown variable: record`, as every
     * other unbound root does. It used to be bound to the variables map
     * (`record: vars`, the formula engine's `record` slot, which `extra`
     * overrides only when a `record` variable exists), so with no record in
     * hand `record.assignee` silently read a variable named `assignee`. A
     * variable is read by its name (`assignee`) or through `vars`
     * (`vars.assignee`). ⛔ Never bind `record` to the variable map again: a
     * record root that answers when the run holds no record is a second
     * spelling of every variable, and it hides the author's mistake instead
     * of naming it.
     */
    private celScope(
        variables: Map<string, unknown>,
        context?: AutomationContext,
    ): { extra: Record<string, unknown> } {
        // The body lives in ./dag-traversal.ts (#25222).
        return celScope(variables, context);
    }

    /**
     * Why a `value`-role envelope argument is malformed — the SINGLE notion of
     * "malformed" this package has (#15137), composed of the two published
     * primitives plus the one presence rule neither of them can state:
     *
     *  0. **Presence** (#16439) — a `null` / `undefined` argument. Neither
     *     primitive judges it: the shape rule is a no-op on anything not
     *     `isExpressionEnvelopeShaped` (neither shape is), and
     *     `validateExpression` reads an absent `source` as "not authored"
     *     (`ok: true`). Both therefore returned NO findings, and
     *     {@link evaluateValueEnvelope} went on to read `envelope.source` off
     *     nothing — a bare `TypeError` with no `where`, no source and no rule,
     *     the one shape in that method's sweep that failed unattributed.
     *  1. **Shape** — `FlowValueSlotSchema` (spec, #14149; the slot-neutral
     *     name since #19938 — `AssignmentValueSchema` is the same rule). It is a no-op on
     *     anything not `isExpressionEnvelopeShaped`, and on an envelope it
     *     requires `ExpressionSchema` narrowed to `dialect: 'cel'`: a `template`
     *     or `cron` envelope is refused, and so is `{ dialect: 'cel' }` with no
     *     `source` — the one shape `validateExpression` lets through, because an
     *     empty source reads as "not authored" (`ok: true`) there.
     *  2. **CEL** — `validateExpression('value', …)` (formula), the same parse
     *     the `predicate` role gets, minus the boolean expectation.
     *
     * Both messages lead with the published `VALUE_ENVELOPE_REFUSAL` sentence
     * (slot-neutral since #19938 — `ASSIGNMENT_VALUE_ENVELOPE_REFUSAL` is the
     * same string), so an author meets the rule before the detail however the
     * envelope is wrong and whichever value slot it sits in. Neither string is
     * re-spelled here.
     *
     * `registerFlow` turns the result into a throw and `objectstack validate`
     * into a located finding (`@objectstack/lint` composes the same two calls) —
     * the severity split the `predicate` role already uses. The RUN-TIME
     * evaluator calls this too, which is the property that matters: the reject
     * set of registration and the reject set of evaluation are one set, derived
     * once. Two independently-derived notions of "malformed" is how a flow comes
     * to register cleanly and then fault, or to be refused for a shape the
     * executor would have run.
     */
    private valueEnvelopeRefusals(value: unknown): { message: string; source: string }[] {
        // The body lives in ./dag-traversal.ts (#25222).
        return valueEnvelopeRefusals(value);
    }

    /**
     * Evaluate a `value`-role CEL envelope to the value a variable takes
     * (#15137 — the executor half of the 2026-09-02 ruling on #14149).
     *
     * Before this, the built-in `assignment` executor handed an envelope to
     * `interpolate()`, which recursed into it as a plain object and wrote it
     * into the variable VERBATIM — `notify` then rendered `{"dialect":"cel",
     * "source":"…"}` as JSON into a message body. The whole declared CEL stdlib
     * (`joinNonEmpty`, …) was unreachable from metadata because CEL was only
     * ever asked for a boolean.
     *
     * A `null` / `undefined` envelope is refused here too, attributed like every
     * other malformed shape, and by the same shared call (#16439) — it used to
     * be the one argument that reached `envelope.source` unjudged and threw a
     * bare `TypeError` carrying neither `where` nor the rule.
     *
     * Refusals are thrown, never swallowed to a value: ADR-0032 §1c's rule for
     * predicates holds at least as hard here, since a value that failed to
     * compute has no truthy/falsy default to hide behind — a silent `undefined`
     * in a variable surfaces three nodes later as an empty notification. The
     * message carries the source, per §1d.
     *
     * Only slots the ledger declares reach this: `assignment`'s canonical
     * `assignments` map; since #19938 (#11182 ruling D) the `create_record` /
     * `update_record` `fields` map (top-level field values only); and since
     * #19939 the maps a node hands to a callee (`subflow` and `map` `input`,
     * `script` `inputs`), a `screen`'s `defaults`, field `defaultValue` and
     * `recordId`, the list a `loop` (with a `body`) and a `map` iterate,
     * their `collection`, and a `notify` node's `recipients` (the value, or
     * each entry of a list), `templateData` map and `sourceId` — every one but
     * `assignments`
     * through `builtin/value-slot-map.ts`, the one per-slot resolver
     * (`resolveValueSlotMap`, `resolveValueSlot`, `resolveCollectionSlot`).
     * The two legacy
     * `assignment` shapes the executor still normalizes (the
     * `assignments: [{ variable, value }]` array and the bare
     * `{ <variable>: <value> }` config) are deliberately NOT declared, so an
     * envelope-shaped object there stays the literal object it always was.
     *
     * `context` is the run's: it decides what `current_user` is in the scope
     * ({@link celScope}) — the run's user, or `null` when the run has none or
     * no context is passed. Every executor passes the one it was handed.
     */
    evaluateValueEnvelope(
        envelope: { dialect?: string; source?: string; ast?: unknown },
        variables: Map<string, unknown>,
        where: string,
        context?: AutomationContext,
    ): unknown {
        // The body lives in ./dag-traversal.ts (#25222).
        const host: ThisParameterType<typeof evaluateValueEnvelope> = {
            valueEnvelopeRefusals: (...a) => this.valueEnvelopeRefusals(...a),
            celScope: (...a) => this.celScope(...a),
        };
        return evaluateValueEnvelope.call(host, envelope, variables, where, context);
    }

    /**
     * Evaluate a flow condition to a boolean.
     *
     * ## A condition is CEL
     *
     * Every condition is **CEL**, wherever it is authored: bare text, an
     * envelope with `dialect: 'cel'`, or an envelope naming no dialect.
     *
     * The dialect used to be decided by the envelope, and that was #4336's bug:
     * only an `{ dialect, source }` envelope reached the CEL engine, so a
     * condition authored as a plain string — the shape `ExpressionInput`
     * accepts by design, and the shape every node `config` still holds, since
     * `FlowNodeSchema.config` is an open `z.record` no transform can reach —
     * fell through to the single-brace `{var}` template path and was compared
     * **as text**:
     *
     *     'existingTask == null'  →  'existingTask' === 'null'   →  always FALSE
     *     'record.rating >= 4'    →  'record.rating' >= '4'      →  always TRUE
     *
     * #4336 then read the source instead, and kept the template path for a
     * string carrying a `{var}` hole. That path is deleted with the
     * single-brace resolver (#19939, ADR-0032 Sequencing 6): no registered flow
     * reached it — `registerFlow` refuses a braced predicate and a `template` or
     * `flow` envelope at every condition slot (ADR-0032 §1a) — so it answered
     * only a direct call. A braced string is now the #1491 brace-trap, refused
     * as the CEL fault below with the source attached; a `template` or `flow`
     * envelope is refused before any evaluation, never re-read as CEL under a
     * dialect its author did not write. Per ADR-0032 §1c a predicate that
     * cannot be evaluated is a **fault**, never a quiet branch decision.
     *
     * ## The shape gate, shared with registration (#16038)
     *
     * The FIRST statement, above everything else, is `structuralConditionRefusal`
     * — the same call `registerFlow` makes on the same slots, not a second
     * hand-written envelope that would drift from it. #15662 closed the reject
     * set at the producer; this closes it at the evaluator, so the two are one
     * set by construction rather than by agreement. It matters because
     * `evaluateCondition` is a public method on an exported class: a plugin
     * reaches it directly regardless of what `registerFlow` admits, and a flow
     * stored before that gate landed replays through here.
     *
     * It sits ABOVE the dialect check, not at the `exprStr` derivation, because
     * the unguarded read has three arms and the derivation is only two of them:
     * a non-string `source` threw a bare `TypeError: exprStr.trim is not a
     * function` naming nothing; a value that is neither text nor envelope read
     * as an EMPTY condition and answered `false` — on the same key a start
     * node's trigger gate is read from; and a malformed envelope carrying a
     * non-predicate dialect (`{ dialect: 'cron', source: 1 }`) answered `false`
     * one statement earlier still, never reaching the derivation at all.
     *
     * What it does NOT refuse is what the constructor admits, and those are
     * controls, not oversights: every string (a malformed one still earns the
     * #1491 brace trap or the §1c CEL fault below), absent/`null`, and an
     * envelope carrying a string `source`. The `ast`-only envelope used to be
     * admitted too, and fell through to a silent `false` here — that population
     * was #15430/#15807's, not #16038's, and #15807 closed it: the edge schema
     * refuses it at authoring, and `structuralConditionRefusal` refuses it on
     * both structural slots, so it is refused here as well, through the same
     * shared constructor rather than a second rule.
     *
     * `context` is the run's: it decides what `current_user` is in a CEL
     * predicate's scope ({@link celScope}) — the run's user, or `null` when
     * the run has none or no context is passed. Every engine site and the
     * `decision` executor pass the run's.
     */
    evaluateCondition(
        expression: string | { dialect?: string; source?: string; ast?: unknown },
        variables: Map<string, unknown>,
        context?: AutomationContext,
    ): boolean {
        // The body lives in ./dag-traversal.ts (#25222).
        const host: ThisParameterType<typeof evaluateCondition> = {
            celScope: (...a) => this.celScope(...a),
        };
        return evaluateCondition.call(host, expression, variables, context);
    }

    /**
     * Retry execution with exponential backoff, jitter, and recursive protection.
     * Uses an iterative loop with an internal retry flag to prevent recursive call stacking.
     *
     * ⚠️ [#9510] NOT a terminal-only method. Three results leave it: an attempt
     * that succeeded, the exhausted-budget failure at the bottom, and — since
     * the ADR-0019 suspend arm was restored to `executeWithoutRetry` — an
     * attempt that PAUSED, returned unchanged from inside the loop. The paused
     * one is non-terminal: the run is durably suspended and finishes later
     * through `resume()`, not here. Its readers are told so explicitly (the
     * loop below, `execute()`'s handoff, and the flow-dispatch status table in
     * `@objectstack/runtime`) rather than discovering it by falling through a
     * `success` check — a non-terminal result reaching a reader that assumes
     * terminal is how this defect becomes a different one.
     *
     * Reads the PARSED `errorHandling` block straight — no `??` fallbacks
     * (#4247). It used to declare every knob optional and re-state a default
     * for each, and one of those copies disagreed with the schema
     * (`maxRetries ?? 3` against `.default(0)`), which made the retry count a
     * function of how the flow reached the engine rather than of what its
     * author wrote. `this.flows` only ever holds `FlowSchema.parse` output —
     * `registerFlow` parses, and the version-history rollback re-seats a
     * previously parsed snapshot — so every field below is present, and typing
     * the parameter as the parsed shape is what keeps a second set of defaults
     * from growing back here: a knob the spec stops defaulting becomes a
     * compile error, not a silent engine-side guess.
     *
     * `flowErrorMessage` is the author's terminal failure text
     * (`flow.errorMessage`), passed for the same reason `errorHandling` is
     * passed rather than re-read: `execute()` already holds the parsed flow,
     * and the exhausted exit below must report the definition THIS dispatch
     * started under — not whatever a hot-reload re-registered under the same
     * name while the loop slept between attempts (#9414). `flowLabel` is
     * passed for the same reason.
     */
    private async retryExecution(
        flowName: string,
        context: AutomationContext | undefined,
        startTime: number,
        errorHandling: NonNullable<FlowParsed['errorHandling']>,
        flowErrorMessage: string | undefined,
        flowLabel: string,
    ): Promise<AutomationResult> {
        // `maxRetries >= 1` is guaranteed under `strategy: 'retry'` — the schema
        // refuses the zero-attempt spelling of "retry" (#4247), so reaching this
        // method always means at least one re-run.
        // `backoffMs` (was `retryDelayMs`) since spec 17.0.0 — `errorHandling`
        // now carries the converged `RetryPolicySchema` contract, so this reads
        // the same key the `try_catch` executor and `runWithPolicy` read
        // (#4661, #4964). Destructured, not `??`-defaulted: the parsed block is
        // the only source of these numbers (#4247).
        const {
            maxRetries,
            backoffMs: baseDelay,
            backoffMultiplier: multiplier,
            maxRetryDelayMs: maxDelay,
            jitter: useJitter,
        } = errorHandling;

        let lastError = 'Max retries exceeded';
        // [#24914, ruling B′] The refusal the LAST attempt met, kept paired
        // with `lastError` so the exhausted exit never reports one attempt's
        // text beside another attempt's refusal.
        let lastCarried: CarriedRefusal = {};
        for (let i = 0; i < maxRetries; i++) {
            // Calculate delay with exponential backoff
            let delay = Math.min(baseDelay * Math.pow(multiplier, i), maxDelay);
            if (useJitter) {
                delay = delay * (0.5 + Math.random() * 0.5);
            }
            await new Promise(r => setTimeout(r, delay));

            // Execute directly without recursion into retryExecution again
            const result = await this.executeWithoutRetry(flowName, context);
            // [#9510] THE THIRD STATE, read deliberately and BEFORE `success`.
            // Since the ADR-0019 suspend arm was restored to
            // `executeWithoutRetry`, an attempt can end NON-TERMINAL: the run
            // asked to pause, its continuation is persisted under
            // `result.runId`, and it is waiting for a `resume()` that may
            // arrive days later. Returning it is the only correct answer —
            // re-running the flow would start the paused work a SECOND time
            // while the first continuation is still live and resumable, which
            // is what the pre-repair loop did on every remaining attempt.
            //
            // ⛔ Not left to the `result.success` line below, even though a
            // paused result is `success: true` and would fall through it today.
            // That line means "this attempt SUCCEEDED, stop retrying" — a
            // different sentence about a different outcome — and a
            // non-terminal result recognised only by a branch that names
            // something else is one edit away from being misread again. The
            // reason this returns is the PAUSE, so the pause is what it tests.
            //
            // ⛔ And it weakens no retry accounting: nothing above is skipped,
            // reset or shortened, `maxRetries` still bounds the loop, and a
            // genuinely failing attempt still consumes one. The loop stops here
            // only because this attempt did not fail.
            if (result.status === 'paused') return result;
            if (result.success) return result;
            lastError = result.error ?? 'Unknown error';
            lastCarried = carriedRefusalOfResult(result);
        }
        // [#9378] Same "ran and was rejected" class as `execute()`'s own failure
        // exit — every attempt above dispatched the flow — so it carries the
        // same lifecycle verdict, and a transport answers it the same way.
        // Without it, a flow whose author chose `errorHandling.strategy:
        // 'retry'` would be the ONE failure shape that still rode HTTP 200.
        //
        // [#9414] `errorMessage` for the same structural reason: this is a
        // DIFFERENT terminal exit from `execute()`'s own failure return — a
        // flow under `strategy: 'retry'` is handed off above and never reaches
        // that one — so a repair that stopped at `execute()` would leave the
        // author's message missing for precisely the runs most likely to need
        // it, the ones that failed over and over.
        return {
            success: false,
            error: lastError,
            durationMs: Date.now() - startTime,
            status: 'failed',
            errorMessage: flowErrorMessage,
            flowLabel,
            ...lastCarried,
        };
    }

    /**
     * Seed a run's variable map from the flow's DECLARED variables — the one
     * place `declared` is turned into `bound` (#4697).
     *
     * Two sources, in this precedence:
     *
     * 1. `context.params[name]`, for an `isInput` variable, when the caller
     *    supplied it. The boundary is `!== undefined`, so an explicit `false`,
     *    `null`, `0` or `''` is a supplied value and wins over the default —
     *    only *absence* falls through.
     * 2. `defaultValue`, when the declaration carries one. This is the half
     *    that did not exist before #4697: a declared variable the caller left
     *    out stayed **unbound**, and conditions are strict CEL, where reading
     *    an unbound name ABORTS the predicate (`Unknown variable: X`) instead
     *    of yielding `false`. A screen flow collecting an optional checkbox hit
     *    exactly that — the runner returns only the fields the user touched, so
     *    the untouched path aborted the outgoing edge and the run stopped
     *    (hotcrm#643). The workaround was an `assignment` node per screen,
     *    mirroring the screen field's own `defaultValue`.
     *
     * `defaultValue` is honoured for a NON-input variable too: params are not
     * readable there by definition, so the default is the only thing that can
     * bind it, and "declared means bound" would otherwise hold for half the
     * declarations. A declaration with no `defaultValue` behaves exactly as
     * before — existing flows are untouched.
     *
     * Seeding happens BEFORE the trigger record is flattened to top-level
     * names, and that flattening skips names already present. So a declared
     * variable — bound from a param or from its default — shadows a record
     * field of the same name, which is the rule params already followed; a
     * default cannot make the same name resolve from a different source
     * depending on whether the caller passed it.
     */
    private seedDeclaredVariables(
        flow: FlowParsed,
        context?: AutomationContext,
    ): Map<string, unknown> {
        // The body lives in ./dag-traversal.ts (#25222).
        return seedDeclaredVariables(flow, context);
    }

    /**
     * Seed a run's COMPLETE variable environment — the one chokepoint every
     * attempt of every run goes through (#9704).
     *
     * `seedDeclaredVariables` above turns the flow's own DECLARATIONS into
     * bindings; this adds everything the ENGINE owns on top of them, in the
     * order the precedence rules require:
     *
     *  1. declared variables (params, then `defaultValue`) — seeded first, so
     *     the record flattening below cannot shadow a flow input;
     *  2. the trigger record: `$record` is the canonical handle, `record` a
     *     friendlier alias so templates and conditions can write
     *     `{record.title}` / `record.status`, plus the record's own fields
     *     flattened to top-level names so bare references (`status`, `budget`)
     *     resolve in start conditions and edge predicates — WITHOUT clobbering
     *     anything already bound;
     *  3. `previous`, bound ALWAYS — to `null` on the create/insert leg, since
     *     there is no prior row — so a start condition can DISCRIMINATE create
     *     from update on a `record-after-write` flow: `previous == null` is the
     *     create leg (#3427). Binding it only when truthy left `previous` an
     *     unknown CEL variable on insert, so ANY reference to it (even
     *     `previous == null`) threw "Unknown variable: previous" and failed the
     *     whole condition;
     *  4. `$runId`, so a pausing node (e.g. Approval) can map its external
     *     state back to this run for resume (ADR-0019), and `$flowName` /
     *     `$flowLabel`, so externalized state carries a human-readable origin.
     *     All three are captured in the variable snapshot, so they survive a
     *     suspend/resume.
     *
     * ⚠️ It is ONE method because the two callers drifting apart is the defect
     * it repairs, not a tidiness preference. `execute()` seeded all of the
     * above and `executeWithoutRetry()` — the method `retryExecution` re-runs
     * the flow through on EVERY retry attempt — seeded only (1) and `$record`,
     * so a retry attempt ran in a strictly smaller environment than the first
     * one: conditions are strict CEL, where reading an unbound name ABORTS the
     * predicate instead of yielding `false` (#4697), so the retry failed for a
     * reason attempt 1 never hit, which reads as a flaky flow rather than a
     * defect. The two methods had already drifted once per card on four
     * separate exits (#9378, #9415, #9414, #9510) before this one, always in
     * the same direction — the copy that is not `execute()` is the one a repair
     * forgets. `buildRunTrigger` is the same chokepoint pattern, for the same
     * reason. ⛔ So a change here belongs here: re-inlining either caller's copy
     * re-opens the drift, and `retry-attempt-pause.test.ts` pins the two
     * snapshots against EACH OTHER precisely so it cannot happen silently.
     *
     * The caller mints `runId` and passes it in rather than this helper minting
     * one, because the run id is the caller's own bookkeeping: it keys the log
     * row, the continuation and the returned envelope, and a helper that
     * produced a second one would put a `$runId` in the snapshot that names no
     * run anybody can resume.
     */
    private seedRunVariables(
        flow: FlowParsed,
        flowName: string,
        context: AutomationContext | undefined,
        runId: string,
    ): Map<string, unknown> {
        // The body lives in ./dag-traversal.ts (#25222).
        const host: ThisParameterType<typeof seedRunVariables> = {
            seedDeclaredVariables: (...a) => this.seedDeclaredVariables(...a),
        };
        return seedRunVariables.call(host, flow, flowName, context, runId);
    }

    /**
     * Execute a flow without triggering retry logic (used by retryExecution to prevent recursion).
     *
     * [#9510] It exits the way `execute()` exits, and that parity is the
     * contract rather than a coincidence: a run that suspends here is a durable
     * ADR-0019 pause — continuation persisted, `paused` log row — not a failed
     * attempt, because it is the SAME event happening on a later attempt. Two
     * answers for one user-visible situation is what this method's missing
     * suspend arm produced.
     */
    private executeWithoutRetry(
        flowName: string,
        context?: AutomationContext,
    ): Promise<AutomationResult> {
        // The body lives in ./dag-traversal.ts (#25222).
        const host: ThisParameterType<typeof executeWithoutRetry> = {
            flows: this.flows,
            isFlowEnabled: (...a) => this.isFlowEnabled(...a),
            describeDisabledFlow: (...a) => this.describeDisabledFlow(...a),
            nextRunId: (...a) => this.nextRunId(...a),
            seedRunVariables: (...a) => this.seedRunVariables(...a),
            resolveRunContext: (...a) => this.resolveRunContext(...a),
            validateNodeInputSchemas: (...a) => this.validateNodeInputSchemas(...a),
            executeNode: (...a) => this.executeNode(...a),
            recordLog: (...a) => this.recordLog(...a),
            logger: this.logger,
            finishRefusedRun: (...a) => this.finishRefusedRun(...a),
            persistSuspendedRun: (...a) => this.persistSuspendedRun(...a),
        };
        return executeWithoutRetry.call(host, flowName, context);
    }
}
