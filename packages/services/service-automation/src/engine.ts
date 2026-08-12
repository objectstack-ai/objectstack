// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { FlowParsed, FlowNodeParsed, FlowEdgeParsed } from '@objectstack/spec/automation';
import type {
    ExecutionLog,
    ExecutionStatus,
    ActionDescriptor,
    ExecutionStepMetrics,
    ExecutionStepSkipReason,
    FlowFunctionEffect,
    FlowRunSummary,
} from '@objectstack/spec/automation';
import type { AutomationContext, AutomationResult, ResumeSignal, IAutomationService, ScreenSpec, ScreenFieldSpec } from '@objectstack/spec/contracts';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import {
    validateScreenInputs,
    screenDeclaresInputContract,
    declaredScreenFieldNames,
    type ScreenFieldVisibility,
} from './screen-input-contract.js';
import type { Logger } from '@objectstack/spec/contracts';
import { FlowSchema, FLOW_STRUCTURAL_NODE_TYPES, validateControlFlow, collectFlowGraphs, findRegionEntry, defineActionDescriptor } from '@objectstack/spec/automation';
import { resolveFlowNodeExpressions } from '@objectstack/spec/automation';
import { applyConversionsToFlow, type ConversionNotice, type ConversionConflictNotice } from '@objectstack/spec';
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
// Static import (not a lazy `require`): the engine ships as ESM ("type":"module"),
// where a CommonJS `require('@objectstack/formula')` resolves to tsup's throwing
// `__require` stub. That threw on every CEL evaluation and the catch below
// silently returned `false`, so EVERY start-node / edge condition (record-change
// `previous.*`, `budget > 100000`, …) skipped its flow. A static import binds the
// engine at module load in both ESM and CJS builds.
import { ExpressionEngine, validateExpression, nearestName } from '@objectstack/formula';

/**
 * A bare **dotted reference** (`record.amount`, `row.shouldRun`,
 * `previous.status`) — a CEL path, and a shape `{var}` template substitution can
 * never leave behind, since it replaces the whole `{…}` token with a value.
 * Each segment must start like an identifier, so numeric literals (`1.5`,
 * `500.00`) are not references. See {@link AutomationEngine.refuseUnresolvedCelOperand}.
 */
const UNRESOLVED_CEL_REFERENCE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;

/**
 * A legacy single-brace **template hole** — `{amount}`, `{get_lead.id}`. This is
 * the exact shape `{var}` substitution can consume (it splits on the literal
 * `{<key>}` text for each variable key), which is what makes it a sound dialect
 * discriminator in {@link AutomationEngine.evaluateCondition}: a condition
 * containing one was written in the template dialect, and a condition containing
 * none was written as CEL (#4336).
 *
 * No whitespace is tolerated inside the braces, deliberately — `{ amount }`
 * is not a token substitution can resolve, so treating it as a hole would only
 * move the failure. It is not valid CEL either (a map literal needs `key: value`
 * pairs), so it lands on the CEL path and gets the brace-trap diagnostic.
 */
const TEMPLATE_HOLE = /\{[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\}/g;

/** A quoted string literal, anywhere in a condition. */
const QUOTED_SEGMENT = /'[^']*'|"[^"]*"/g;

/** A single-quoted or double-quoted string literal, whole-operand. */
const QUOTED_LITERAL = /^'([^']*)'$|^"([^"]*)"$/;

/**
 * Every legacy `{var}` hole in `source`, ignoring any that sits **inside a
 * string literal** — `record.name == '{unresolved}'` is a CEL predicate
 * comparing against text that happens to contain braces, not a template.
 *
 * This is both the dialect discriminator and the unresolved-hole report, so the
 * two can never disagree about what counts as a hole. It reads the AUTHORED
 * source rather than the substituted result, so a variable whose *value*
 * contains braces cannot masquerade as an unresolved reference.
 */
function templateHoles(source: string): string[] {
    return source.replace(QUOTED_SEGMENT, '').match(TEMPLATE_HOLE) ?? [];
}

/**
 * Strip one layer of matching quotes from a template-dialect operand, so a
 * quoted string literal compares as its contents (#4336). Anything that is not
 * a whole quoted literal is returned untouched — including a value that merely
 * contains a quote.
 */
function unquoteLiteral(operand: string): string {
    const m = QUOTED_LITERAL.exec(operand);
    return m ? (m[1] ?? m[2] ?? '') : operand;
}

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

/**
 * The slice of a descriptor's JSON-Schema `configSchema` that the undeclared-key
 * walk reads (#4045). Structural only — no validation semantics.
 */
interface ConfigSchemaNode {
    type?: string;
    properties?: Record<string, ConfigSchemaNode>;
    items?: ConfigSchemaNode;
    additionalProperties?: unknown;
}

/**
 * Known-confusable flow-node config keys → precise authoring guidance,
 * appended to the undeclared-key rejection (#4277). The `UNKNOWN_KEY_GUIDANCE`
 * pattern from `object.zod.ts`, scoped per node type so a key name that is
 * wrong on one node but real on another never misfires.
 *
 * Entries are seeded only from documented incidents — a tombstone with no
 * history is noise. The generic rejection already carries the path, the
 * did-you-mean and the declared set; an entry here adds the *mechanism* the
 * author was reaching for.
 */
/**
 * The bulk-intent spellings, shared by `update_record` and `delete_record`
 * (#5393) — the same curation `builtin-node-config.zod.ts` carries at the
 * execute-time parse, copied here because this is the FIRST door an author
 * hits (registration, at boot) and #4001's finding is that detection
 * generalizes for free while prose does not.
 *
 * All four were measured against a real `safeParse` while #5225 was diagnosed,
 * back when no spelling of bulk intent — `multi` included — existed on either
 * node. Edit distance reaches `multi` from none of them.
 */
const BULK_INTENT_GUIDANCE: Record<string, string> = {
    bulk: 'Bulk intent is `multi: true` — the data engine\'s own word for it (`options.multi`), so the concept ' +
        'keeps one name from node config to driver call (#5393). Without it the write must name one row by ' +
        'scalar `id`; a predicate write is refused by the engine rather than silently widened.',
    all: 'Bulk intent is `multi: true` — the data engine\'s own word for it (`options.multi`), so the concept ' +
        'keeps one name from node config to driver call (#5393). Without it the write must name one row by ' +
        'scalar `id`; a predicate write is refused by the engine rather than silently widened.',
    multiple: 'Bulk intent is `multi: true` — the data engine\'s own word for it (`options.multi`), so the ' +
        'concept keeps one name from node config to driver call (#5393). Without it the write must name one row ' +
        'by scalar `id`; a predicate write is refused by the engine rather than silently widened.',
    options: 'This is the NODE config, not the data engine\'s options bag — declare `multi: true` at the top ' +
        'level of `config`, never `options: { multi: true }`. Translating that declaration into `options.multi` ' +
        'on the engine call is the executor\'s job (#5393).',
};

const FLOW_NODE_UNKNOWN_KEY_GUIDANCE: Record<string, Record<string, string>> = {
    create_record: {
        fieldValues:
            'The write map is `fields` — `fieldValues` was an AI-authoring dialect that never had a ' +
            'runtime reader; the fix is the authoring source + this rejection, not a runtime alias ' +
            '(#2419, rejected by design).',
    },
    update_record: {
        fieldValues:
            'The write map is `fields` — `fieldValues` was an AI-authoring dialect that never had a ' +
            'runtime reader (#2419, rejected by design).',
        ...BULK_INTENT_GUIDANCE,
    },
    delete_record: BULK_INTENT_GUIDANCE,
    screen: {
        visibleIf:
            'The visibility predicate is `visibleWhen` (bare CEL, re-evaluated client-side as the ' +
            'user types — #3528, the incident this whole check descends from).',
    },
};
import { runIsUnscopedUserMode, flowTouchesData } from './runtime-identity.js';
import { isGuardRefusal, refuseNode } from './guard-refusal.js';
import { summarizeRun, formatRunSummaryLine } from './run-summary.js';
// #5660 — the degrade registration reports a FOREIGN failure (a third-party
// provider factory's text), so it renders it as structured `meta` rather than
// interpolating it into the log message. See ./thrown-cause-diagnostics.ts.
import { describeThrownForLog } from './thrown-cause-diagnostics.js';

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
 *    interpolation erased a filter condition (#3810), a data node names no
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
 * plus their tenant. Built by {@link FlowUserGrantsResolver}.
 */
export interface FlowUserGrants {
  positions: string[];
  permissions: string[];
  tenantId?: string;
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
     * body steps from top-level ones. Set by {@link AutomationEngine.runRegion}
     * (innermost wins — never overwritten as steps bubble through nested regions).
     */
    parentNodeId?: string;
    /** Zero-based loop iteration or parallel branch index of the enclosing region. */
    iteration?: number;
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
interface ExecutionLogEntry {
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
function buildRunTrigger(
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
        userId: context?.userId,
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
class FlowSuspendSignal {
    readonly __flowSuspend = true as const;
    constructor(
        readonly nodeId: string,
        readonly correlation?: string,
        readonly screen?: ScreenSpec,
        /** Registry type of the node that suspended — the resume gate's key (#3801). */
        readonly nodeType?: string,
    ) {}
}

function isSuspendSignal(err: unknown): err is FlowSuspendSignal {
    return typeof err === 'object' && err !== null && (err as FlowSuspendSignal).__flowSuspend === true;
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
 *   writes the handoff keys, and it is not reachable from a transport.
 */
function applyResumeSignal(
    variables: Map<string, unknown>,
    signal: ResumeSignal | undefined,
    nodeId: string,
): string[] {
    if (!signal) return [];
    const trusted = (signal as Record<symbol, unknown>)[ENGINE_BUILT_SIGNAL] === true;
    const rejected: string[] = [];
    const writes: Array<[string, unknown]> = [];

    // `output` is merged under the suspended node's id, so downstream edges
    // branch on it exactly as for a normally-executed node.
    for (const [key, value] of Object.entries(signal.output ?? {})) {
        writes.push([`${nodeId}.${key}`, value]);
    }
    // Bare flow variables — a `screen` node's collected inputs land under their
    // plain names so downstream `{var}` interpolation / conditions read them
    // directly (e.g. `new_assignee` → update_record fields).
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
        this.runSummaryLog = options?.runSummaryLog ?? 'info';
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
     * durable store. A store failure does not fail the run — the in-memory copy
     * still allows in-process resume; only cross-restart durability is lost.
     *
     * Logged at ERROR, not warn: a durable pause that silently stayed
     * in-memory is data-loss-in-waiting. #4420 was exactly this — a store
     * pointed at a table that was never created, every save failing into a warn
     * nobody read, and every in-flight approval zombified by the next restart.
     */
    private async persistSuspendedRun(run: SuspendedRun): Promise<void> {
        this.suspendedRuns.set(run.runId, run);
        if (this.store) {
            try {
                await this.store.save(run);
            } catch (err) {
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
                        `kept in memory only and will NOT be resumable after a restart. Fix the store failure ` +
                        `in this record's meta.`,
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
    private async forgetSuspendedRun(run: SuspendedRun, reason: SuspensionReleaseReason): Promise<void> {
        this.suspendedRuns.delete(run.runId);
        if (this.store) {
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
            this.warnIfResumeAuthorityUndeclared(executor.descriptor);
        }

        this.logger.info(`Node executor registered: ${executor.type}`);
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
        if (descriptor.supportsPause !== true) return;
        if (descriptor.resumeAuthority !== undefined) return;
        if (this.resumeAuthorityOmissionWarned.has(descriptor.type)) return;
        this.resumeAuthorityOmissionWarned.add(descriptor.type);
        this.logger.warn(
            `[automation] node type '${descriptor.type}' declares supportsPause but never declares ` +
            `resumeAuthority, so the #3801 resume gate REFUSES every pause it creates on the generic route ` +
            `(POST /automation/:name/runs/:runId/resume) — an unclaimed pause is fail-closed since #5561, ` +
            `because the opposite guess is how #3823 walked past an unrecorded approval decision. ` +
            `Declare it on the descriptor: 'any' if that route IS the intended door (a screen's collected ` +
            `inputs, a signal wait's external producer), or 'service' if resuming is the tail of a decision ` +
            `some service must authorize and record first. Declaring 'any' is what RESTORES the generic ` +
            `route for this type. Reported once per node type per engine.`,
        );
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
            // Delegated for the same reason `resolveResumeAuthority` walks the
            // alias to its canonical: a pause created through the old type name
            // must not lose a capability the canonical declares. Without this,
            // aliasing a pausing type would silently stop it disarming what it
            // armed on entry (#5512) — the alias's own executor implements
            // nothing. No alias of a pausing type exists today; this keeps it
            // from becoming a hole the day one does.
            async onSuspensionReleased(release) {
                await engine.nodeExecutors.get(canonicalType)?.onSuspensionReleased?.(release);
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

        // Array-form triggerType (e.g. ['record-after-create', 'record-after-delete']).
        // Multi-event unions are deliberately unsupported (#3457). But a non-string
        // triggerType would otherwise fall through every branch below and resolve to
        // `undefined` — the flow silently becomes a manual/screen flow that never
        // fires, invisible to the binding audit (#3481). Route it to the record-change
        // trigger, exactly as an unmappable single token does, so the trigger rejects
        // it LOUDLY at bind time (a warn naming the flow) instead of vanishing. The
        // authoring-time lint gate (validate-flow-trigger-readiness) is the primary
        // catch; this keeps runtime behavior consistent with the typo-token path. The
        // raw array is preserved in `config` so the trigger can tailor its message;
        // `event` is a joined string so the trigger's single-token mapper reports it
        // verbatim and maps it to no hook.
        if (
            Array.isArray(config.triggerType) &&
            config.triggerType.some((t) => typeof t === 'string' && (t as string).startsWith('record-'))
        ) {
            return {
                triggerType: 'record_change',
                binding: {
                    flowName,
                    object: typeof config.objectName === 'string' ? config.objectName : undefined,
                    event: config.triggerType.filter((t) => typeof t === 'string').join(','),
                    condition: (config.condition as FlowTriggerBinding['condition']) ?? undefined,
                    config,
                },
            };
        }

        // Declarative time-relative sweep (#1874): a start node carrying a
        // `timeRelative` descriptor is swept on a schedule and launched once per
        // record whose date field falls in the window. Checked BEFORE `schedule`
        // because such a flow ALSO carries a `schedule` cadence (the sweep
        // interval) — without this precedence it would bind to the plain schedule
        // trigger and fire once with no record instead of once per record.
        if (config.timeRelative != null && typeof config.timeRelative === 'object') {
            const tr = config.timeRelative as Record<string, unknown>;
            return {
                triggerType: 'time_relative',
                binding: {
                    flowName,
                    object:
                        typeof tr.object === 'string'
                            ? tr.object
                            : typeof config.objectName === 'string'
                              ? config.objectName
                              : undefined,
                    schedule: config.schedule,
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
            trigger.start(resolved.binding, (ctx: AutomationContext) =>
                this.execute(flowName, ctx).then((result) => {
                    if (!result.success) {
                        this.logger.error(
                            `Trigger-fired run of flow '${flowName}' failed (trigger '${resolved.triggerType}') — ` +
                                `no caller holds this result and nothing retries the run; the terminal failure ` +
                                `is recorded in the flow's run history, and the run's failure envelope is in ` +
                                `this record's meta.`,
                            undefined,
                            { error: result.error ?? 'unknown error' },
                        );
                    }
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
        const parsed = ConnectorSchema.parse(def);
        for (const action of parsed.actions ?? []) {
            if (typeof handlers[action.key] !== 'function') {
                throw new Error(
                    `Connector '${parsed.name}': action '${action.key}' is declared but no handler was provided`,
                );
            }
        }
        this.assertSameOriginOrFree(parsed.name, origin);
        this.connectors.set(parsed.name, { def: parsed, handlers, origin, state: 'ready' });
        this.logger.info(
            `Connector registered: ${parsed.name} (${Object.keys(handlers).length} action handlers, origin: ${origin})`,
        );
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
        const parsed = ConnectorSchema.parse(def);
        this.assertSameOriginOrFree(parsed.name, origin);
        this.connectors.set(parsed.name, { def: parsed, handlers: {}, origin, state: 'degraded', degradedReason: reason });
        // `warn(message, meta?)` per the `Logger` contract — no `Error` slot
        // below `error`, so the cause belongs in argument TWO here.
        this.logger.warn(
            `Connector registered DEGRADED: ${parsed.name} (origin: ${origin}) — no actions and no handlers ` +
                `until its upstream is reachable; a connector_action dispatching to it fails with the stored ` +
                `reason, and the materializer retries with backoff (#3017).`,
            cause === undefined
                ? { degradedReason: reason }
                : { degradedReason: reason, ...describeThrownForLog(cause) },
        );
    }

    /** Enforce the ADR-0097 §4 two-sources-of-truth rule; warn on same-origin replace. */
    private assertSameOriginOrFree(name: string, origin: ConnectorOrigin): void {
        const existing = this.connectors.get(name);
        if (!existing) return;
        if (existing.origin !== origin) {
            const describe = (o: ConnectorOrigin) =>
                o === 'plugin'
                    ? 'a plugin (engine.registerConnector)'
                    : 'a declarative provider-bound `connectors:` instance';
            throw new Error(
                `Connector name conflict: '${name}' is already registered by ${describe(existing.origin)} ` +
                    `and cannot also be registered by ${describe(origin)}. A declarative provider-bound instance and a ` +
                    `plugin-registered connector must not share a name — there is no silent precedence (ADR-0097 §4). ` +
                    `Rename one of them.`,
            );
        }
        this.logger.warn(`Connector '${name}' replaced`);
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
     */
    canonicalizeStoredFlow(name: string, definition: unknown): {
        parsed: FlowParsed;
        storable: unknown;
        notices: ConversionNotice[];
        conflicts: ConversionConflictNotice[];
    } {
        // ADR-0087 D2 — the runtime load seam. A stored flow authored against an
        // old shape (a `webhook`/`http_request` callout node, a `delete_record`
        // with `config.filters`) is canonicalized on rehydration, BEFORE parse +
        // execution, so the executor only ever sees the canonical shape and a
        // dropped-alias upgrade never silently changes behavior (e.g. an empty
        // `filter` deleting a whole table). `reservedNodeTypes` is this engine's
        // live executor registry: an open-namespace node-type rename over a type
        // a custom executor owns becomes a loud, refused conflict — never a
        // silent clobber of the third party's node.
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
        const reservedNodeTypes = new Set<string>([
            ...FLOW_STRUCTURAL_NODE_TYPES,
            ...this.nodeExecutors.keys(),
            ...this.actionDescriptors.keys(),
        ]);
        const notices: ConversionNotice[] = [];
        const conflicts: ConversionConflictNotice[] = [];
        const converted = applyConversionsToFlow(definition, {
            reservedNodeTypes,
            includeRetired: true,
            onNotice: (n) => {
                notices.push(n);
                this.logger.warn(`[flow '${name}'] ${n.code}: ${n.message}`);
            },
            onConflict: (c) => {
                conflicts.push(c);
                this.logger.warn(`[flow '${name}'] ${c.code}: ${c.message}`);
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
            conflicts,
        };
    }

    registerFlow(name: string, definition: unknown): void {
        // One canonicalization policy, shared with the stored-row migration so
        // the two can never disagree about what "canonical" means (#4454).
        // Execution takes the parsed shape (schema defaults materialized).
        const { parsed } = this.canonicalizeStoredFlow(name, definition);

        // ADR-0018 §M1 — node types are validated against the live action
        // registry, but NOT here: the check moved to the moment the vocabulary
        // is closed (see the end of this method and {@link
        // sealNodeTypeVocabulary}). The protocol no longer gates `type` with a
        // closed enum; membership is checked at that seam instead, and stays
        // soft-fail — a flow authored against a currently-absent plugin must
        // still register, and executeNode() throws NO_EXECUTOR at run time.

        // #4277 — REJECT config keys the node's descriptor does not declare
        // (the tightened #4059 warning; a `visibleIf` typo used to register in
        // silence). Hard-fail with per-key prescriptions: see
        // validateNodeConfigKeys for why the #4045 reconciliation made this
        // safe, and for the deliberate exemptions (`assignment`, schemaless
        // types, keyValue maps).
        this.validateNodeConfigKeys(name, parsed);

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
        if (this.nodeTypeVocabularySealed && this.flowEnabled.get(name) !== false) {
            const known = this.knownNodeTypes();
            const unknownTypes = this.unknownNodeTypes(parsed, known);
            if (unknownTypes.length > 0) {
                this.warnUnknownNodeTypes({ flowName: name, unknownTypes, knownTypes: [...known] });
            }
        }

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
     * no trigger (e.g. a manually-invoked/screen flow) or its trigger type has no
     * registered trigger. `triggerType`/`object` expose the flow's declared
     * binding so hosts (CLI startup summary, kernel:bootstrapped audit) can say
     * WHY an unbound flow is unbound; `status` is the persisted deployment status.
     */
    getFlowRuntimeStates(): Array<{
        name: string;
        enabled: boolean;
        bound: boolean;
        status?: string;
        triggerType?: string;
        object?: string;
    }> {
        return [...this.flows.keys()].map((name) => {
            const resolved = this.resolveTriggerBinding(name);
            return {
                name,
                enabled: this.flowEnabled.get(name) !== false,
                bound: this.boundFlowTriggers.has(name),
                status: (this.flows.get(name) as { status?: string } | undefined)?.status,
                triggerType: resolved?.triggerType,
                object: resolved?.binding.object,
            };
        });
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
            if (this.flowEnabled.get(name) === false) continue;
            if (this.boundFlowTriggers.has(name)) continue;
            const resolved = this.resolveTriggerBinding(name);
            if (!resolved) continue; // manual / screen flow — nothing to bind
            const reason = this.triggers.has(resolved.triggerType)
                ? `trigger '${resolved.triggerType}' is registered but binding failed — see earlier warnings`
                : `no '${resolved.triggerType}' trigger is registered — add requires: ['triggers'] (record_change/schedule/time_relative/api ship in @objectstack/trigger-*)`;
            audit.push({ flowName: name, triggerType: resolved.triggerType, reason });
        }
        return audit;
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

    async listRuns(
        flowName: string,
        options?: { limit?: number; cursor?: string; status?: ExecutionStatus },
    ): Promise<ExecutionLogEntry[]> {
        const limit = options?.limit ?? 20;
        const inMem = this.executionLogs.filter(l => l.flowName === flowName);

        // [#8050] Durable PAUSED rows — the arm this merge was missing.
        //
        // `sys_automation_run` holds TWO disjoint row families: the terminal
        // history rows `recordTerminal` writes (id `run_` + runId, status
        // completed/failed) and the LIVE suspension rows `save` writes (id =
        // the raw runId, status `paused`). The history arm below reads the
        // first family; nothing here read the second. Before a restart that is
        // invisible, because a paused run is still in `executionLogs` — so
        // every in-process test of this method passes. After a restart the ring
        // is empty and the paused rows had no reader at all, which is the
        // defect: an operator who restarts the process can enumerate what
        // FINISHED and what is IN FLIGHT vanishes — the strictly more urgent
        // half. It also structurally emptied #7359's just-enforced
        // `?status=paused`: with no producer of a `paused` entry after a
        // restart, that filter could never match a row, and the one query
        // reached for here always answered "nothing pending".
        //
        // Read-side only, by construction: this rehydrates the row the suspend
        // path already writes. No column, prefix or lifecycle changes — the
        // paused row is NOT reshaped into a history row, because the two have
        // different lifetimes (a paused row is live resumable state, deleted on
        // completion and exempt from the age sweep; a history row is a
        // tombstone). Unifying them would trade an observability gap for a
        // persistence-semantics change.
        //
        // Skipped when the caller filters for a status a paused row can never
        // have: `suspendedRunToLogEntry` always yields `paused`, and a run that
        // has since finished is answered by the fresher history/ring entry that
        // outranks it in the merge below — so the arm cannot change the result
        // of `?status=failed`, only its cost. `store.list()` is a table scan of
        // every paused row in the deployment (see its own contract), so not
        // paying it on the monitoring queries is worth the one-line guard.
        const wantsPaused = options?.status === undefined || options.status === 'paused';
        let durablePaused: ExecutionLogEntry[] = [];
        if (this.store && wantsPaused) {
            try {
                const rows = await this.store.list();
                durablePaused = rows
                    .filter(r => r.flowName === flowName)
                    .map(r => this.suspendedRunToLogEntry(r));
            } catch (err) {
                // #6499 — driver text to the structured slot; `warn(message,
                // meta?)`, meta SECOND (no `Error` slot on `warn`).
                //
                // #4632 verdict: FUNCTIONAL — `warn`, for the same reason as
                // the history arm below and `listSuspendedRunsDurable`. Nothing
                // claimed-persisted failed to land: the paused rows are intact
                // and still resumable by id (`resume` reads them through
                // `loadSuspendedRun`, a different door that is unaffected by
                // this failure). What degrades is this observability read, back
                // to exactly the pre-#8050 answer.
                this.logger.warn(
                    `[Automation] paused-run read failed for '${flowName}' — the Runs listing DEGRADES to the ` +
                        `in-memory ring buffer plus terminal history, so runs parked by a previous process are ` +
                        `missing and '?status=paused' can report an empty result for a flow that has runs ` +
                        `waiting. The rows themselves are untouched and still resumable by id. Fix the store ` +
                        `failure in this record's meta.`,
                    describeThrownForLog(err),
                );
            }
        }

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
                // #6499 — the datasource driver's text to the structured slot;
                // see `forgetSuspendedRun`'s catch above for the full mechanism
                // (#6299). `warn(message, meta?)` — meta is the SECOND
                // argument; `warn` has no `Error` slot.
                //
                // #4632 verdict: FUNCTIONAL — stays `warn`, the same reasoning
                // as `listSuspendedRunsDurable` below: nothing
                // claimed-persisted failed to land — the history rows are
                // intact — and this read feeds only the observability Runs
                // view, which degrades to the in-memory ring buffer. The
                // record says the shortfall out loud (#5186's invented-answer
                // shape; its propagation remedy is a return-contract change
                // outside #6499).
                this.logger.warn(
                    `[Automation] run-history read failed for '${flowName}' — the Runs listing DEGRADES to the ` +
                        `in-memory ring buffer alone, so terminal runs from before the last restart (or evicted ` +
                        `from the buffer) are missing and the caller cannot tell a short list from a complete ` +
                        `one. The rows themselves are untouched. Fix the store failure in this record's meta.`,
                    describeThrownForLog(err),
                );
            }
        }
        // Dedupe by run id, weakest source first — the same run legitimately
        // appears in more than one of these (#8050):
        //
        //   1. durable PAUSED  — the run parked, and the row is still there.
        //   2. durable HISTORY — the run reached a terminal state.
        //   3. in-memory ring  — this process executed it.
        //
        // The order is a precedence claim, not an accident. Paused loses to
        // both because it is the only one that can be STALE while the others
        // cannot: `forgetSuspendedRun` deletes the paused row on completion,
        // but that delete is best-effort (a store outage swallows it), so a
        // finished run can leave its paused row behind. A terminal row or a
        // terminal ring entry for the same id is therefore strictly later
        // evidence, and letting the paused row win would report a completed run
        // as still waiting — the exact defect `run-history.test.ts`'s "latest
        // entry wins" block pins for `getRun`. There is no symmetric hazard:
        // within a process the ring is written in the same breath as the paused
        // row (`persistSuspendedRun` then `recordLog`, and again on re-suspend),
        // so it is never the older of the two; across a restart the ring is
        // empty and cannot mask anything.
        const byId = new Map<string, ExecutionLogEntry>();
        for (const e of durablePaused) byId.set(e.id, e);
        for (const e of durable) byId.set(e.id, e);
        for (const e of inMem) byId.set(e.id, e); // freshest wins

        // [#7359] The wire has always declared `?status=`, but it reached
        // neither the contract nor this method, so the filter was dropped at
        // the HTTP boundary and every run came back as if it matched — a
        // monitoring caller paging for failures read the first `limit` runs of
        // any status and concluded those were the failures.
        //
        // Filtering HERE, after the merge, is load-bearing in two ways:
        //
        //  1. It covers BOTH stores at once — the in-memory ring buffer and the
        //     durable rows. Narrowing only the buffer would answer "no
        //     failures" for a flow whose failures are all in durable history
        //     (i.e. after any restart, which is exactly when someone asks);
        //     narrowing only the durable rows would hide the live ones. Half a
        //     filter is the same class of confident wrong answer as none.
        //  2. It reads each run's RESOLVED status. `executionLogs` holds more
        //     than one entry per run id — a run that pauses and later finishes
        //     appends 'paused' and then its terminal entry — and the merge above
        //     is what collapses them to the freshest. Filtering the two arms
        //     BEFORE that collapse would drop the terminal entry for
        //     `?status=paused` and let the stale 'paused' one survive, so every
        //     approval / screen / wait run that had since completed would report
        //     itself as still paused. That is the exact defect
        //     `run-history.test.ts`'s "latest entry wins" block pins for
        //     `getRun`, re-introduced one method over.
        //
        // The durable arm's window is still the store's newest `limit` rows —
        // `listHistory(flowName, limit)` has no status slot, so the filter is
        // applied to what comes back rather than pushed down. A status filter
        // therefore narrows WITHIN that window and can return fewer than
        // `limit` matches while older ones exist. That is the merge's
        // pre-existing shape (durable was already capped at `limit` before the
        // sort-and-slice) and closing it is a store-contract change, not this
        // card's. What it never does is return a run of another status.
        const status = options?.status;
        const merged = status === undefined
            ? [...byId.values()]
            : [...byId.values()].filter(e => e.status === status);
        return merged
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
            // #7533 — the persisted trigger attribution, so a run rehydrated
            // after a restart still says what fired it and (for a record
            // change) which record. `type` falls back to `''` ONLY for rows
            // written before those columns existed: the field is required by
            // `ExecutionLogSchema`, and `''` is the same "not recorded" this
            // method already returned for every row. It is a legacy-row
            // default, not an alias — a row written today always carries a
            // real type.
            trigger: {
                type: r.triggerType ?? '',
                userId: r.userId ?? undefined,
                object: r.triggerObject,
                recordId: r.triggerRecordId,
            },
            steps: r.steps ?? [],
            error: r.error,
            // #4354 — the PERSISTED summary, never re-folded from `r.steps`:
            // those are compacted (200 max), so recomputing here would report a
            // 5000-row sweep as having acted on a couple of hundred.
            summary: r.summary,
        };
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
        return {
            id: run.runId,
            flowName: run.flowName,
            flowVersion: run.flowVersion,
            status: 'paused',
            startedAt: run.startedAt,
            trigger: buildRunTrigger(run.context),
            steps: run.steps ?? [],
            variables: run.variables ?? {},
        };
    }

    async getRun(runId: string): Promise<ExecutionLogEntry | null> {
        // LAST entry wins, not the first: a run that pauses and later finishes
        // records TWO entries under the same run id ('paused', then
        // 'completed'/'failed'/'cancelled'). Scanning forwards returned the stale
        // 'paused' one, so every suspend-then-finish run — i.e. every approval,
        // screen and wait flow — reported itself as still paused forever, both on
        // the Runs surface and to the approvals dead-run sweep (#3456).
        let inMem: ExecutionLogEntry | undefined;
        for (let i = this.executionLogs.length - 1; i >= 0; i--) {
            if (this.executionLogs[i].id === runId) { inMem = this.executionLogs[i]; break; }
        }
        if (inMem) return inMem;
        // Durable fallback: after a restart (or ring-buffer eviction) the run's
        // terminal history row still answers "what happened, at which node?".
        // Best-effort — a store failure degrades to "not found", never throws.
        if (this.store?.loadTerminal) {
            try {
                const rec = await this.store.loadTerminal(runId);
                if (rec) return this.runRecordToLogEntry(rec);
            } catch (err) {
                // #6499 — driver text to the structured slot; see
                // `forgetSuspendedRun`'s catch above for the full mechanism
                // (#6299).
                //
                // #4632 verdict: FUNCTIONAL — stays `warn`. Nothing
                // claimed-persisted failed to land: the terminal row, if one
                // exists, is intact — this read degrades to `null`. What IS
                // wrong is #5186's shape: `null` is also this method's honest
                // "no such run", so a caller cannot tell an unreadable store
                // from a run that never ran (plugin-approvals'
                // `inspectStrandedRequests` counts a THROWN getRun as
                // `undetermined` — a distinction this swallow denies it). The
                // remedy is propagation, a return-contract change outside
                // #6499's scope, so the record says the degradation out loud.
                this.logger.warn(
                    `[Automation] durable run lookup failed for '${runId}' — this read DEGRADES to null, so ` +
                        `the caller sees exactly what it would see if the run had never run and cannot tell ` +
                        `the two apart. The terminal row, if one exists, is untouched. Fix the store failure ` +
                        `in this record's meta.`,
                    describeThrownForLog(err),
                );
            }
        }
        // [#8050] …and the PAUSED fallback, so run-detail and `listRuns` answer
        // out of one story. The card measured both surfaces failing together
        // after a restart — list returning zero rows AND this method 404ing —
        // and fixing only the list would have swapped a visible gap for an
        // inconsistency between two reads of the same run.
        //
        // AFTER the terminal probe, matching the merge order in `listRuns`: a
        // paused row can outlive the run it describes (the delete on completion
        // is best-effort), so a terminal row for the same id is later evidence
        // and must win. Trying this first would resurrect #3456's "paused
        // forever" for any run whose cleanup delete was lost.
        //
        // This does NOT make a nonexistent run findable: `store.load` answers
        // `null` for an unknown id exactly as `loadTerminal` does, so the route
        // above still returns its 404 `RESOURCE_NOT_FOUND` envelope for one.
        if (this.store) {
            try {
                const suspended = await this.store.load(runId);
                if (suspended) return this.suspendedRunToLogEntry(suspended);
            } catch (err) {
                // #6499 / #4632: same verdict as the terminal probe above —
                // FUNCTIONAL, so `warn`. The suspension row is intact and the
                // run stays parked and resumable; what degrades is this read.
                this.logger.warn(
                    `[Automation] durable paused-run lookup failed for '${runId}' — this read DEGRADES to null, ` +
                        `so a run that is parked and resumable reports as if it had never run, and the caller ` +
                        `cannot tell the two apart. The suspension row is untouched. Fix the store failure in ` +
                        `this record's meta.`,
                    describeThrownForLog(err),
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
     * Also warns about the user-less case (#1888 follow-up, closed by #3760): a
     * flow whose effective `runAs` is `'user'` but whose trigger resolved no user
     * has no identity to scope to, so its data nodes would run UNSCOPED (the data
     * security middleware skips when there is no identity). Those data ops are now
     * REFUSED at `resolveRunDataContext`; the warning here fires at run SETUP,
     * before any node executes, so the refusal is diagnosable rather than a
     * surprise mid-flow. Authors declare `runAs:'system'` to make the elevation
     * explicit (the build-time lint `flow-runas-unscoped` rejects the
     * statically-decidable shapes earlier — but NOT the record-change shape, which
     * is only knowable at run time).
     */
    private async resolveRunContext(flow: FlowParsed, context?: AutomationContext, runId?: string): Promise<AutomationContext> {
        // `flowRunId` is stamped alongside `runAs` because it shares that field's
        // lifetime and its single construction point: set once here, copied into
        // every data node's ObjectQL context by `resolveRunDataContext`, and
        // persisted with a suspended run so it survives pause/resume — including a
        // cold resume after a restart (#3456). Provenance, not authorization.
        const runContext: AutomationContext = {
            ...(context ?? {}),
            runAs: flow.runAs ?? 'user',
            // `flowName` shares the same lifetime and construction point: it feeds
            // audit attribution (`svc:flow:<name>` on ExecutionContext.actor) for
            // runs that resolve no user (#4366).
            flowName: flow.name,
            ...(runId ? { flowRunId: runId } : {}),
        };

        // #3356 (follow-up to #1888) — a `runAs:'user'` run must enforce its data
        // ops as the TRIGGERING user's real authorization. Most trigger surfaces
        // (REST action / trigger endpoint) already resolve the full envelope and
        // forward `permissions`; the ObjectQL record-change hook does NOT — its
        // session carries only a `userId`, so the run used to fall back to a bare
        // member/everyone principal (403 on private objects; silent field strips
        // on public ones) even when the triggering user was fully authorized.
        // When a grants resolver is wired and the trigger left the authz envelope
        // unresolved (no `permissions`), resolve the user's real positions +
        // permission sets here — the single point where every trigger type's run
        // identity is established. Contexts that ALREADY carry `permissions` are
        // left untouched: that includes an ADR-0090 agent principal acting
        // on-behalf-of a user (its scope-derived ceiling is always non-empty), so
        // this never re-broadens a deliberately narrowed identity.
        if (
            runContext.runAs !== 'system' &&
            runContext.userId &&
            !Array.isArray(runContext.permissions) &&
            this.userGrantsResolver
        ) {
            try {
                const grants = await this.userGrantsResolver(runContext.userId, runContext.tenantId);
                if (grants) {
                    runContext.positions = Array.isArray(grants.positions) ? grants.positions : [];
                    runContext.permissions = Array.isArray(grants.permissions) ? grants.permissions : [];
                    if (grants.tenantId && !runContext.tenantId) runContext.tenantId = grants.tenantId;
                }
            } catch (err) {
                // Fail-safe, never fail-open: on a resolution error the run keeps
                // the trigger's (unresolved) identity — the data middleware applies
                // its baseline member fallback, NOT elevation — and we warn loudly
                // so the degraded authorization is audible rather than silent.
                //
                // #6499 — the resolver's thrown text (transitively the
                // datasource's) goes to the structured slot; see
                // `forgetSuspendedRun`'s catch above for the full mechanism
                // (#6299). #4632 verdict: FUNCTIONAL — stays `warn`: the
                // degradation is fail-safe as argued above, its symptom is the
                // run's own data-op refusals/strips, and nothing
                // claimed-persisted failed to land.
                this.logger.warn(
                    `[runAs] flow '${flow.name}' could not resolve grants for triggering user ` +
                    `'${runContext.userId}' — its data ops fall back to baseline member permissions ` +
                    `(not elevated). The resolver's failure is in this record's meta.`,
                    describeThrownForLog(err),
                );
            }
        }

        if (runIsUnscopedUserMode(runContext) && flowTouchesData(flow)) {
            this.logger.warn(
                `[runAs] flow '${flow.name}' executes with runAs:'user' but its trigger resolved no user ` +
                `— its data operations will be REFUSED (#3760). Running them would execute UNSCOPED ` +
                `(elevated, RLS-bypassing) rather than restricted, which is the fail-open ADR-0049 ` +
                `forbids. Declare runAs:'system' to make the elevation explicit and intended, or arrange ` +
                `for the trigger to supply a user. Note a user-less trigger is NOT only a schedule: a ` +
                `record-change flow fired by a system write carries no user either (ADR-0049, #1888).`,
            );
        }

        // #3475 — opt-in single-hop lookup expansion, AFTER identity resolution so
        // the re-read runs as this run's own principal (see helper).
        await this.expandDeclaredLookups(flow, runContext);
        return runContext;
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
    private async expandDeclaredLookups(flow: FlowParsed, runContext: AutomationContext): Promise<void> {
        if (!this.recordExpander) return;
        const record = runContext.record as Record<string, unknown> | undefined;
        const id = record?.id;
        const object = runContext.object;
        if (!record || id == null || id === '' || !object) return;

        const startNode = flow.nodes.find((n) => n.type === 'start');
        const raw = (startNode?.config as { expand?: unknown } | undefined)?.expand;
        const expandFields =
            typeof raw === 'string'
                ? raw
                    ? [raw]
                    : []
                : Array.isArray(raw)
                    ? raw.filter((f): f is string => typeof f === 'string' && f.length > 0)
                    : [];
        if (expandFields.length === 0) return;

        try {
            const full = await this.recordExpander(object, id, expandFields, runContext);
            if (full && typeof full === 'object') {
                for (const field of expandFields) {
                    const expanded = (full as Record<string, unknown>)[field];
                    // Graft only a genuinely expanded relation (object/array); a
                    // scalar means the field is not a resolvable lookup — leave the
                    // raw id in place rather than overwrite it.
                    if (expanded !== null && typeof expanded === 'object') {
                        record[field] = expanded;
                    }
                }
            }
        } catch (err) {
            // #6499 — the expander's thrown text (transitively the
            // datasource's) goes to the structured slot; see
            // `forgetSuspendedRun`'s catch above for the full mechanism
            // (#6299). #4632 verdict: FUNCTIONAL — stays `warn`, per the
            // docblock: expansion is best-effort enrichment that must never
            // break the flow it feeds, and the visible symptom is templates
            // rendering the scalar id.
            this.logger.warn(
                `[expand] flow '${flow.name}' could not expand lookups [${expandFields.join(', ')}] on ` +
                `'${object}#${String(id)}' — templates referencing these relations resolve to the scalar ` +
                `id. The expander's failure is in this record's meta.`,
                describeThrownForLog(err),
            );
        }
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

        // #4792 — a real run is about to start, so if the vocabulary was never
        // sealed the ADR-0018 §M1 node-type check never ran on this engine at
        // all. Say so once. Placed after the two guards above so the trigger is
        // an execution and not a typo'd flow name (which is already loud) or a
        // flow that cannot run. See the helper for why here and not earlier.
        this.warnIfNodeTypeVocabularyNeverSealed();

        // Re-entrancy loop guard (see `activeRecordFlows`). Break the SAME flow
        // re-firing for the SAME record while a prior execution is still active —
        // a self-trigger cascade whose start condition fails to suppress it would
        // otherwise loop forever and wedge the caller (fatally, mid seed).
        const guardRecordId = (context?.record as { id?: unknown } | undefined)?.id;
        const reentryKey = guardRecordId != null ? `${flowName}::${String(guardRecordId)}` : undefined;
        if (reentryKey && this.activeRecordFlows.has(reentryKey)) {
            // #6654 — the record id is CALLER data (nothing schema-constrains
            // it against newlines), so it rides the logger's structured slot,
            // never the message; see `forgetSuspendedRun`'s catch for the full
            // mechanism (#6299). #4632: FUNCTIONAL — stays `warn` (the run is
            // deliberately skipped and the caller reads the skip envelope).
            this.logger.warn(
                `[automation] flow '${flowName}' re-entered for the same record while still running — breaking ` +
                    `self-trigger loop; the triggering record's id is in this record's meta. Its start condition ` +
                    `did not suppress the re-fire; if it guards on a boolean field (e.g. \`is_escalated != true\`), ` +
                    `note booleans persist as 0/1 on SQLite/libsql and CEL \`1 != true\` is true.`,
                { recordId: String(guardRecordId) },
            );
            return { success: true, output: { skipped: true, reason: 'reentrancy_loop_guard' } };
        }
        if (reentryKey) this.activeRecordFlows.add(reentryKey);

        // Initialize variable context
        const variables = this.seedDeclaredVariables(flow, context);
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
        // Always bind `previous` — to `null` on the create/insert leg (there is no
        // prior row) — so a start condition can DISCRIMINATE create vs update on a
        // `record-after-write` flow: `previous == null` is the create leg (#3427).
        // Binding only-when-truthy left `previous` an unknown CEL variable on
        // insert, so ANY reference to it (even `previous == null`) threw
        // "Unknown variable: previous" and failed the whole condition.
        variables.set('previous', context?.previous ?? null);

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
        // when execute() returns). Surfaces the user-less fail-open (see helper)
        // and resolves the triggering user's real grants for `runAs:'user'` (#3356).
        // Also stamps `flowRunId` so this run's data writes are attributable to it
        // (#3456).
        const runContext = await this.resolveRunContext(flow, context, runId);

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
            const logged = this.recordLog({
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
            });

            return {
                success: true,
                output,
                durationMs,
                // #4354 — hand the counts back synchronously so a caller
                // (a `subflow` roll-up, a runtime test asserting the sweep wrote
                // something) never has to re-read the run to learn what it did.
                summary: logged.summary,
            };
        } catch (err: unknown) {
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
            const logged = this.recordLog({
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
            });

            // Error handling strategy
            if (flow.errorHandling?.strategy === 'retry') {
                return this.retryExecution(flowName, context, startTime, flow.errorHandling);
            }
            return {
                success: false,
                error: errorMessage,
                durationMs,
                // A failed run's counts matter MORE, not less: they say how far
                // it got before dying — how many rows it had already written.
                summary: logged.summary,
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
    async resume(runId: string, signal?: ResumeSignal): Promise<AutomationResult> {
        const refusal = await this.refuseGatedResume(runId, signal);
        if (refusal) return refusal;
        return this.resumeInternal(runId, signal, false);
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
    private async refuseGatedResume(runId: string, signal?: ResumeSignal): Promise<AutomationResult | null> {
        const run = await this.resolveEffectiveSuspension(runId);
        if (!run) return null;

        const nodeType = this.resolveSuspendedNodeType(run);
        if (!nodeType) return null;
        if (this.resolveResumeAuthority(nodeType) !== 'service') return null;
        // The owning service stamped the signal — this resume IS the recorded
        // decision's tail, not a way around it.
        if (signal?.[RESUME_AUTHORITY_SERVICE]) return null;

        // Refusing. Which of the two reasons? A second registry walk, on the
        // refusal path only, so the message can tell a node that deliberately
        // declared `'service'` from one that declared nothing at all.
        const declared = this.resolveDeclaredResumeAuthority(nodeType);
        const direct = run.runId === runId;
        const at = direct ? `'${run.nodeId}'` : `'${run.nodeId}' (linked run '${run.runId}')`;
        const why = declared === 'service'
            ? `which is resumable only through its owning service (resumeAuthority: 'service')`
            : `whose type never declares resumeAuthority, so it is closed to the generic route until it does ` +
              `(#5561) — declare resumeAuthority: 'any' on its descriptor if this route IS the intended door`;
        this.logger.warn(`[automation] refused resume of run '${runId}': parked on ${nodeType} node ${at}, ${why}`);

        // The fix, identical in both the direct and the linked-run phrasing —
        // what has to change is a descriptor, not the call that just failed.
        const undeclaredFix =
            `and that node type never declares resumeAuthority, so the generic resume route is closed to the ` +
            `pauses it creates (#5561). If that route IS the intended door — a screen's collected inputs, a ` +
            `signal wait's external producer — declare resumeAuthority: 'any' on its action descriptor; declare ` +
            `'service' if resuming is the tail of a decision some service must authorize and record first`;
        return {
            success: false,
            code: 'PERMISSION_DENIED',
            error: declared === 'service'
                ? direct
                    ? `Run '${runId}' is paused at a '${nodeType}' node, which only its owning service may resume — ` +
                      `drive it through that service's API (e.g. an approval decision), not a raw resume`
                    : `Run '${runId}' is waiting on run '${run.runId}', which is paused at a '${nodeType}' node that ` +
                      `only its owning service may resume — resuming here would continue past a decision that has not ` +
                      `been made; drive it through that service's API instead`
                : direct
                    ? `Run '${runId}' is paused at a '${nodeType}' node, ${undeclaredFix}`
                    : `Run '${runId}' is waiting on run '${run.runId}', which is paused at a '${nodeType}' node, ` +
                      `${undeclaredFix}`,
        };
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
        const descriptor = this.resolveCanonicalDescriptor(nodeType);
        // No descriptor ⇒ no declaration ⇒ nothing to enforce (see above).
        if (!descriptor) return null;
        if (descriptor.supportsPause === true) return null;
        return refuseNode(
            `node type '${nodeType}' suspended the run but its action descriptor declares ` +
            `supportsPause: false, so the pause is refused — a run that paused here could not be ` +
            `continued on the generic resume route anyway: a type that declares no pause declares no ` +
            `resumeAuthority either, and an unclaimed pause is fail-closed since #5561. Declare ` +
            `supportsPause: true on the descriptor together with the resumeAuthority the pauses need ` +
            `('any' if POST /automation/:name/runs/:runId/resume is the intended door, 'service' if ` +
            `resuming is the tail of a decision some service must authorize and record first) — or stop ` +
            `returning suspend: true from execute(). This is a metadata defect, not a runtime one, so a ` +
            `fault edge does not route it.`,
        );
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
    private async loadSuspendedRun(runId: string): Promise<SuspendedRun | null> {
        try {
            return await this.loadSuspendedRunStrict(runId);
        } catch (err) {
            // #6230 — the cause goes to `meta`, never into the message. It is
            // the datasource DRIVER's own failure text and we do not control
            // how many lines it has; `ObjectLogger.write()` adds one
            // `<ts> <LEVEL>` head per call, so a newline in it turns this ONE
            // record into several physical lines of which only the first is
            // greppable — the family of #5048 / #5575 / #5636 / #5661 / #5737 /
            // #5912, and cloud#971's shape.
            //
            // This seam is the `warn` half of that family and carries the extra
            // harm the module docblock of ./thrown-cause-diagnostics.ts calls
            // out: `ObjectLogger` routes `warn` to **stdout**, and `serve`'s
            // boot-quiet window wraps `process.stdout.write`, where
            // `BootLogCapture.offer()` retains a physical line only when
            // `classifyBootLogLine` finds a level head on it. Continuation lines
            // are therefore DROPPED outright, not merely misread — and this is
            // live during boot: `plugin.ts` `start()` → `rearmSuspendedWaitTimers`
            // → `engine.resume()` for an overdue run → the gate
            // (`refuseGatedResume` → `resolveEffectiveSuspension`) → here.
            //
            // SECOND argument, per the `Logger` contract
            // (`packages/spec/src/contracts/logger.ts`): `warn(message, meta?)`.
            // Unlike `error(message, error?, meta?)` (#5912's seam, PR #6228)
            // `warn` has no `Error` slot, so `meta` is the second parameter.
            //
            // Level stays `warn` on purpose. This is a deliberate FUNCTIONAL
            // degradation — the loader's whole contract is "a best-effort answer
            // for incidental readers" and `resumeInternal` uses the strict form
            // when the difference matters — so #4632's durability rule does not
            // apply and raising it to `error` would be that rule's mirror-image
            // misuse, an alarm on every gate lookup during an outage.
            this.logger.warn(
                `[automation] durable suspended-run store unreadable for run '${runId}' — this read is best-effort ` +
                    `and DEGRADES to null, so its caller (the resume gate, a screen fetch) sees exactly what it ` +
                    `would see if no suspension existed under that id; the run itself is untouched and stays ` +
                    `parked. Fix the store failure in this record's meta — a strict read reports it as ` +
                    `STORE_UNAVAILABLE instead of degrading.`,
                describeThrownForLog(err),
            );
            return null;
        }
    }

    /** {@link loadSuspendedRun} without the degradation: a store read failure
     *  THROWS instead of reading as "no such run". */
    private async loadSuspendedRunStrict(runId: string): Promise<SuspendedRun | null> {
        const cached = this.suspendedRuns.get(runId);
        if (cached) return cached;
        if (!this.store) return null;
        return await this.store.load(runId);
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
     */
    private creditChildRun(steps: StepLogEntry[], nodeId: string, child: FlowRunSummary | undefined): void {
        if (!child) return;
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].nodeId !== nodeId) continue;
            const prior = steps[i].metrics ?? {};
            steps[i] = {
                ...steps[i],
                metrics: {
                    selected: (prior.selected ?? 0) + child.selected,
                    acted: (prior.acted ?? 0) + child.acted,
                    // N uncountable effects in the child collapse to ONE flag on
                    // the parent's step: this execution dispatched something the
                    // platform cannot count. The child keeps the real count in
                    // its own run row, and the question this feeds — "is the
                    // parent's `acted` complete?" — is boolean either way.
                    ...(prior.unmeasuredEffect || child.unmeasured ? { unmeasuredEffect: true } : {}),
                },
            };
            return;
        }
    }

    /**
     * @param skipBubble - Set when the caller is the subflow DELEGATION path,
     *   which continues the parent itself after the child completes — the
     *   child's own up-bubble must stay off so the parent isn't resumed twice.
     * @param childSummary - #4354: totals of the child run whose completion
     *   triggered this resume (the up-bubble path), credited to the awaiting step.
     */
    private async resumeInternal(
        runId: string,
        signal: ResumeSignal | undefined,
        skipBubble: boolean,
        childSummary?: FlowRunSummary,
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
            const flow = this.flows.get(run.flowName);
            if (!flow) {
                return { success: false, error: `Flow '${run.flowName}' not found for run '${runId}'` };
            }
            const node = flow.nodes.find(n => n.id === run.nodeId);
            if (!node) {
                return { success: false, error: `Suspended node '${run.nodeId}' no longer exists in flow '${run.flowName}'` };
            }

            // #4354 — up-bubble: the child that just finished did work this run
            // is accountable for. Credit it to the step that suspended awaiting
            // it, before traversal appends anything further.
            this.creditChildRun(run.steps, run.nodeId, childSummary);

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
                    // #4354 — down-delegation is the other way a child's work
                    // lands under a parent step written at suspend time.
                    this.creditChildRun(run.steps, run.nodeId, childRes.summary);
                } else {
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

            // Consume the suspension *before* running downstream work — a run
            // resumes exactly once per pause, and a duplicate resume after a
            // partial restart must not double-run side effects. (Folding the
            // signal above is pure in-memory work, not downstream work.)
            // This is also where the paused node learns its pause is over and
            // disarms what it armed on entry (#5512) — see forgetSuspendedRun.
            await this.forgetSuspendedRun(run, 'resumed');

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
                const logged = this.recordLog({
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
                });

                // ── Subflow up-bubble (nested pause): this run was a subflow
                // child whose parent suspended awaiting it. Auto-resume the
                // parent with our output, mapped like the synchronous path.
                // Skipped when the DELEGATION path drives the chain (it
                // continues the parent itself). Best-effort: the child's own
                // completion stands even if the parent continuation fails.
                if (!skipBubble) {
                    await this.bubbleToParent(run, output, logged.summary);
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
                    summary: logged.summary,
                };
            } catch (err: unknown) {
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
                    });
                    return { success: true, status: 'paused', runId, durationMs, screen: err.screen };
                }

                const errorMessage = err instanceof Error ? err.message : String(err);
                const durationMs = Date.now() - run.startTime;
                const logged = this.recordLog({
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
                });
                // Subflow chain: a child failing terminally fails every
                // ancestor awaiting it — they can never be resumed otherwise.
                // The delegation path handles its own level (skipBubble).
                if (!skipBubble) {
                    await this.failAncestors(run.context, errorMessage);
                }
                // Surface the flow's friendly error message (the raw error stays
                // in `error` for logs/diagnostics).
                return {
                    success: false,
                    error: errorMessage,
                    durationMs,
                    errorMessage: flow.errorMessage,
                    summary: logged.summary,
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
     *    author-named output variables, not a screen submission.
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
        signal: ResumeSignal | undefined,
    ): AutomationResult | null {
        if (!signal) return null;
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
                return this.evaluateCondition(String(field.visibleWhen), scope);
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
     * Up-bubble for the subflow chain: when a completed run carries
     * `$parentRunId`, resume that parent with this run's output. Recursion via
     * the parent's own completion bubbles multi-level chains. Best-effort —
     * a failed parent continuation is logged, never thrown back at the
     * caller who resumed the child.
     */
    private async bubbleToParent(
        run: SuspendedRun,
        output: Record<string, unknown>,
        /** #4354 — this child's totals, credited to the parent's awaiting step. */
        summary?: FlowRunSummary,
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
            const parentRes = await this.resumeInternal(parentRunId, sig, false, summary);
            if (!parentRes.success) {
                // #6499 — `parentRes.error` is the envelope field that carries
                // a failing node's / driver's text VERBATIM (#5912 left it
                // that way on purpose), so foreign newlines reach this message
                // second-hand; it goes to the structured slot. See
                // `forgetSuspendedRun`'s catch above for the full mechanism
                // (#6299).
                //
                // #4632 verdict: FUNCTIONAL — stays `warn`: no false success
                // is recorded anywhere — the parent either failed terminally
                // (recorded in run history) or stays visibly parked and
                // resumable — and the child's own completion, which is what
                // its resumer was told, is genuine.
                this.logger.warn(
                    `[automation] subflow run '${run.runId}' completed but resuming parent '${parentRunId}' ` +
                        `failed — the parent's failure envelope is in this record's meta.`,
                    { error: parentRes.error ?? 'unknown error' },
                );
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
     * Terminally fail a suspended run: consume its continuation and record a
     * `failed` log so it stops surfacing as resumable. Used when a subflow
     * descendant fails — the ancestor awaiting it can never be resumed.
     */
    private async failSuspendedRun(run: SuspendedRun, error: string): Promise<void> {
        await this.forgetSuspendedRun(run, 'failed');
        this.recordLog({
            id: run.runId,
            flowName: run.flowName,
            flowVersion: run.flowVersion,
            status: 'failed',
            startedAt: run.startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - run.startTime,
            trigger: buildRunTrigger(run.context),
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
     *
     * ⚠️ An UNREADABLE durable store also lands on that `false` — the two are
     * indistinguishable to the caller, so the run may still be parked and
     * resumable. That path is reported at `error` (#4632/#6299) precisely
     * because nothing above it can tell the difference; see the catch below.
     */
    async cancelRun(runId: string, reason?: string): Promise<boolean> {
        let run = this.suspendedRuns.get(runId) ?? null;
        if (!run && this.store) {
            try {
                run = await this.store.load(runId);
            } catch (err) {
                // #6299 — same family, same mechanism as `forgetSuspendedRun`
                // above: the driver's uncontrolled text goes to the structured
                // slot so the record stays one physical line.
                //
                // #4632 verdict: DURABILITY — raised from `warn` to `error`. The
                // failed read is silently turned into "no such suspended run"
                // and this method returns `false`, which its own contract
                // documents as idempotent success (already terminal / unknown),
                // so the cancellation is SKIPPED while the call reads clean. The
                // only in-repo caller measures the cost: plugin-approvals'
                // revise-window recall
                // (`packages/plugins/plugin-approvals/src/approval-service.ts`)
                // never reads the boolean at all — it only catches a THROW, and
                // grades that throw `error` with "the run may be stranded"
                // (#4420). A store-read failure produces precisely that stranded
                // run WITHOUT firing that alarm: the request is marked
                // `recalled`, the record lock is released, `resumeError` stays
                // undefined — and the run stays parked in the store, to be
                // re-armed and resumed by the next restart, inside a flow whose
                // approval has already been withdrawn.
                //
                // This is why #6230's verdict must not be copied here.
                // `loadSuspendedRun` is a DECLARED best-effort reader for
                // incidental callers (a gate lookup, a screen fetch), and
                // `resumeInternal` takes the strict form exactly where the
                // difference matters. `cancelRun` has no strict alternative, and
                // its degradation decides a WRITE.
                //
                // THIRD argument (`error(message, error?, meta?)`), `Error` slot
                // deliberately empty (#5575).
                this.logger.error(
                    `[automation] cancelRun('${runId}') could not read the durable suspended-run store, so the ` +
                        `cancellation was SKIPPED and reported as idempotent success — this call returns false, which ` +
                        `its callers read as "no such suspended run". The run is NOT cancelled: if it is parked in the ` +
                        `store it stays parked, and the next restart re-arms and resumes it while the caller has ` +
                        `already recorded the cancellation. Fix the store failure in this record's meta, then re-issue ` +
                        `cancelRun('${runId}').`,
                    undefined,
                    describeThrownForLog(err),
                );
            }
        }
        if (!run) return false;
        await this.forgetSuspendedRun(run, 'cancelled');
        this.recordLog({
            id: run.runId,
            flowName: run.flowName,
            flowVersion: run.flowVersion,
            status: 'cancelled',
            startedAt: run.startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - run.startTime,
            trigger: buildRunTrigger(run.context),
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
                // #6299 — driver text to the structured slot, message one line,
                // same as the two seams above. The SLOT differs: the `Logger`
                // contract declares `warn(message, meta?)`, so `meta` is the
                // SECOND argument here — `warn` has no `Error` slot, and a
                // `meta` passed third to it is silently ignored.
                //
                // #4632 verdict: FUNCTIONAL — the level deliberately STAYS
                // `warn`, and this is the one of #6299's three sites where that
                // is the answer. Nothing the system claims to have persisted
                // failed to land: the durable rows are intact, still resumable
                // by id, and the next boot's `rearmSuspendedWaitTimers` still
                // re-arms them off its OWN `store.list()` — which builtin/
                // wait-node.ts grades `error` precisely because THAT failure
                // breaks the promise to resume them. This one breaks no promise,
                // so #4632's judgment question ("does something the system
                // claims is persisted fail to land while it keeps looking
                // healthy?") answers NO.
                //
                // What IS wrong here is the shape #5186 owns: an answer INVENTED
                // for a read that failed — a silently SHORT list. That rule's
                // remedy is propagation (rethrow, or a discriminated result),
                // which changes this method's return contract and is outside
                // #6299's scope, so the record has to say the shortfall out loud
                // instead. Its scan roots (`packages/metadata`,
                // `metadata-protocol`, `objectql`) do not reach this package, so
                // `check:durability-log-level` reports neither rule here.
                // Reachability is also the weakest of the three: this method has
                // no production consumer in-repo and is not on the
                // `AutomationService` spec contract (only the synchronous
                // `listSuspendedRuns` is), so nothing decides anything on this
                // list today. Raising it to `error` would alarm for the duration
                // of an outage on a read nobody acts on — #4632's mirror-image
                // misuse, the trap #6230 avoided.
                this.logger.warn(
                    `[automation] the durable suspended-run store could not be listed — this listing DEGRADES to the ` +
                        `in-memory cache alone, so every run parked by a previous process is missing from the result ` +
                        `and the caller cannot tell a short list from a complete one (after a restart the cache is ` +
                        `empty, so this answers []). The runs themselves are untouched — still stored, still resumable ` +
                        `by id. Fix the store failure in this record's meta.`,
                    describeThrownForLog(err),
                );
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
    private recordLog(entry: ExecutionLogEntry): ExecutionLogEntry {
        // #4354 — fold the run's outcome BEFORE anything downstream trims the
        // step log. History compaction keeps 200 steps; the summary must count
        // all 5000, or a long sweep's `acted` would shrink with its step log and
        // the broken-sweep detector would read a bounded artefact as truth.
        entry.summary = summarizeRun(entry.steps);

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

        // The MVP of #4354, and the half that needs no console: one structured
        // line per terminal run. `selected=30 acted=0` in a log file is the
        // difference between an invisible failure and a greppable one. Only
        // terminal runs — a `paused` run has not finished doing its work yet.
        if (terminal && this.runSummaryLog !== 'off') {
            const line = formatRunSummaryLine(
                {
                    flowName: entry.flowName,
                    runId: entry.id,
                    status: entry.status,
                    durationMs: entry.durationMs,
                },
                entry.summary,
            );
            const meta = {
                flow: entry.flowName,
                runId: entry.id,
                status: entry.status,
                durationMs: entry.durationMs,
                selected: entry.summary.selected,
                acted: entry.summary.acted,
                skipped: entry.summary.skipped,
                unmeasured: entry.summary.unmeasured,
                gates: entry.summary.gates,
            };
            if (this.runSummaryLog === 'debug') this.logger.debug(line, meta);
            else this.logger.info(line, meta);
        }

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
                // #7533 — the rest of the trigger block, not just its userId.
                // The information exists at this exact point (the in-memory log
                // entry one line up carries it); it was simply not copied onto
                // the record handed to the store, which is where the durable
                // history lost the answer to "what fired this run?".
                triggerType: entry.trigger?.type || undefined,
                triggerObject: entry.trigger?.object,
                triggerRecordId: entry.trigger?.recordId,
                nodeId: lastStep?.nodeId,
                steps: this.compactStepsForHistory(entry.steps),
                summary: entry.summary,
            };
            void this.store.recordTerminal(record).catch((err) => {
                // #6499 — driver text to the structured slot; see
                // `forgetSuspendedRun`'s catch above for the full mechanism
                // (#6299).
                //
                // #4632 verdict: DURABILITY — RAISED from `warn` to `error`.
                // This is the WRITE half of the run-history claim whose read
                // halves (`listRuns` / `getRun` above) stay `warn`: a TERMINAL
                // run's history row failed to land while the run itself
                // completed and every caller reads healthy — fire-and-forget,
                // nothing retries it, nothing upstream is told. After the next
                // restart the run is invisible to the Runs surfaces, and the
                // approvals sweeps read exactly that hole: `inspectStranded-
                // Requests` (#3456) treats "no suspension + no terminal row"
                // as a STRANDED request, so a run that actually completed is
                // reported as lost, and `releasePendingForTerminalRuns`
                // (#4469) treats "no terminal row" as still-alive, so a
                // finished run's leftover pending approvals are never
                // auto-released. A write that claims to persist did not, while
                // the system keeps looking healthy — #4632's judgment question
                // answers YES. `check:durability-log-level` cannot see it
                // (`SuspendedRunStore.recordTerminal` is not in its callee
                // vocabulary), so the level is pinned by a test instead.
                //
                // THIRD argument per `error(message, error?, meta?)`; the
                // `Error` slot stays empty on purpose (#5575).
                this.logger.error(
                    `[Automation] run-history persist failed for terminal run '${entry.id}' of flow ` +
                        `'${entry.flowName}' — the run finished and reads healthy everywhere, but its history ` +
                        `row never landed and nothing retries the write, so after the next restart this run is ` +
                        `invisible to the Runs surfaces and the approvals sweeps read it as never-finished. ` +
                        `Fix the store failure in this record's meta.`,
                    undefined,
                    describeThrownForLog(err),
                );
            });
        }
        return entry;
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
            if (this.flowEnabled.get(flowName) === false) continue;
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
     * rather than crashing the kernel.
     */
    private validateNodeConfigKeys(flowName: string, flow: FlowParsed): void {
        const violations: string[] = [];
        // #4389 — every graph, not just the flow's own. `visibleIf` is the typo
        // this check exists to catch, and moving the node into a `loop` body
        // used to restore the silence #4277 closed. No double-reporting from the
        // container side: all three container descriptors declare their region
        // slot as a bare `nodes: { type: 'array' }` with no `items`, so the
        // schema-lockstep walk stops there rather than descending twice.
        for (const graph of collectFlowGraphs(flow)) {
            const scoped: string[] = [];
            for (const node of graph.nodes) {
                // `assignment` config keys are the author's variable names — see the
                // exemption note above.
                if (node.type === 'assignment') continue;
                const schema = this.actionDescriptors.get(node.type)?.configSchema as ConfigSchemaNode | undefined;
                if (!schema) continue;
                this.collectUndeclaredConfigKeys(node, schema, node.config, 'config', scoped);
            }
            for (const v of scoped) violations.push(graph.scope ? `${graph.scope} · ${v}` : v);
        }
        if (violations.length > 0) {
            throw new Error(
                `Flow '${flowName}' rejected: ${violations.length} undeclared config key(s) (#4277).\n` +
                violations.map((v) => `  - ${v}`).join('\n') +
                `\nAn undeclared key is never read, so it can only be a typo or dead config — fix the ` +
                `flow's metadata (rename or remove the key). If an executor genuinely reads this key, ` +
                `declare it on the node type's descriptor configSchema instead; read-but-undeclared ` +
                `keys are exactly the drift the #4045 reconciliation closed.`,
            );
        }
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
        violations: string[],
    ): void {
        if (schema.type === 'array' && schema.items) {
            if (!Array.isArray(value)) return;
            value.forEach((element, index) => {
                this.collectUndeclaredConfigKeys(node, schema.items!, element, `${path}[${index}]`, violations);
            });
            return;
        }

        // A free-form map declares no properties — its keys are author data.
        if (!schema.properties || schema.additionalProperties === true) return;
        if (value == null || typeof value !== 'object' || Array.isArray(value)) return;

        const declared = Object.keys(schema.properties);
        for (const key of Object.keys(value as Record<string, unknown>)) {
            const child = schema.properties[key];
            if (child) {
                this.collectUndeclaredConfigKeys(node, child, (value as Record<string, unknown>)[key], `${path}.${key}`, violations);
                continue;
            }
            // The declared set is printed ALWAYS, not only as a fallback when the
            // edit-distance heuristic misses. It misses more than you would
            // expect: `visibleIf` → `visibleWhen` is distance 4 against a
            // threshold of 3, so the very typo this check exists to catch gets no
            // suggestion. Loosening `nearestName` is the wrong fix — it is shared
            // with the unknown-field and unknown-role diagnostics, where a looser
            // threshold means confidently wrong suggestions over hundreds of
            // candidates. A config object declares at most a dozen keys, so simply
            // listing them is both cheap and complete, and the suggestion becomes
            // a bonus for the cases it does catch.
            const suggestion = nearestName(key, declared);
            const guidance = FLOW_NODE_UNKNOWN_KEY_GUIDANCE[node.type]?.[key];
            violations.push(
                `node '${node.id}' (${node.type}): unknown config key \`${key}\` at ${path}.${key}` +
                (suggestion ? ` — did you mean \`${suggestion}\`?` : '') +
                ` It is not declared by this node type's configSchema, so nothing reads it.` +
                ` Declared here: ${declared.join(', ')}.` +
                (guidance ? ` ${guidance}` : ''),
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
     * `{…}` is the #1491 brace-trap in a bare-CEL slot and the *correct* spelling
     * in a single-brace `{var}` flow-interpolation slot (`loop.collection`). A
     * dialect-blind pass would reject every valid `collection` while still
     * passing every wrong `visibleWhen`, so the `flow-template` slots are
     * recorded and skipped — no validator implements their dialect.
     *
     * #1928 — when an object-schema resolver is wired ({@link setObjectSchemaResolver}),
     * a second, schema-aware pass surfaces the checks `objectstack build` runs
     * (unknown-field refs, likely bare-field typos, text/boolean fields misused
     * in arithmetic) as ADVISORY warnings (logged, never thrown). Flow conditions
     * bind the record's fields flat, so the schema pass uses `flattened` scope.
     * The fatal set is unchanged — a resolver can never break a flow that used to
     * register cleanly.
     */
    private validateFlowExpressions(flowName: string, flow: FlowParsed): void {
        const failures: string[] = [];

        // Resolve the flow's record-change target object (start node's
        // `config.objectName`) so `record.*`/bare field refs can be checked
        // against the real schema. Absent resolver / non-record flow → the hint
        // is undefined and only the fatal syntax/bare-ref pass runs (unchanged).
        const startNode = flow.nodes.find((n) => n.type === 'start');
        const objectName = ((startNode?.config ?? {}) as Record<string, unknown>).objectName;
        const schemaHint = typeof objectName === 'string'
            ? (() => {
                const s = this.objectSchemaResolver?.(objectName);
                return s ? { objectName, fields: s.fields, fieldTypes: s.fieldTypes, scope: 'flattened' as const } : undefined;
            })()
            : undefined;

        const check = (where: string, raw: unknown, useSchemaHint = true): void => {
            if (raw == null) return;
            // Fatal pass — syntax, brace-in-CEL, unknown-function (ADR-0032 §5).
            // Unchanged: matches the CLI build's fatal set exactly.
            const result = validateExpression('predicate', raw as string | { dialect?: string; source?: string });
            for (const e of result.errors) {
                failures.push(`  • ${where}: ${e.message}\n      source: \`${e.source}\``);
            }
            // Advisory schema-aware pass — only when the source is syntactically
            // valid (else it would just re-report the fatal error). Everything it
            // finds (field-existence, tier-3 typo, tier-4 type mismatch) is LOGGED,
            // never thrown, so registration behaviour is strictly additive (#1928).
            if (useSchemaHint && result.errors.length === 0 && schemaHint) {
                const schemaPass = validateExpression('predicate', raw as string | { dialect?: string; source?: string }, schemaHint);
                for (const issue of [...schemaPass.errors, ...schemaPass.warnings]) {
                    // #6499's separately-argued 14th site — the OPPOSITE cause
                    // of the thrown-text seams: no foreign thrown value is
                    // involved; this message simply AUTHORED a second physical
                    // line (`\n      source: …`) into a one-record-per-call
                    // logger, and `issue.source` is the flow AUTHOR's
                    // expression text, whose line count is theirs (CEL is
                    // newline-tolerant). Same downstream damage as the family
                    // (see `forgetSuspendedRun`'s catch, #6299), same fix
                    // shape: the message stays one line (`issue.message`
                    // embeds at most identifier names, which cannot carry
                    // newlines), the source moves to the structured slot.
                    //
                    // #4632 verdict: FUNCTIONAL — stays `warn` BY CONTRACT:
                    // #1928 defines this advisory schema pass as logged-never-
                    // thrown and strictly additive to registration; a finding
                    // here must not fail or alarm a flow that registers
                    // cleanly.
                    this.logger.warn(`[flow '${flowName}'] ${where}: ${issue.message}`, { source: issue.source });
                }
            }
        };

        // #4347 — every graph in the flow, not just the top-level arrays. An
        // ADR-0031 container keeps a whole sub-graph in its `config`, so
        // iterating `flow.nodes`/`flow.edges` checked PART of the flow while
        // reporting on all of it: the `{record.x}` brace-trap this pass exists
        // to catch registered in silence one level in, and the flow then failed
        // at run time with the loud diagnostic suppressed. `scope` names the
        // region so a nested finding says where it is.
        for (const graph of collectFlowGraphs(flow)) {
            const at = graph.scope ? `${graph.scope}: ` : '';
            for (const node of graph.nodes) {
                const cfg = (node.config ?? {}) as Record<string, unknown>;
                // start-node trigger gate + decision/branch predicates live in config.condition
                check(`${at}node '${node.id}' (${node.type}) condition`, cfg.condition);

                // Descriptor-declared expression slots (#4027). The ledger names them
                // per node type and carries the dialect each one takes, so a declared
                // key like `screen.fields[].visibleWhen` is checked as the bare CEL it
                // is — the traversal gap that let #3528 ship a `{var}` predicate.
                //
                // Only `predicate` slots are checked: `flow-template` slots take the
                // single-brace `{var}` dialect `interpolate()` implements, and no
                // validator implements it (validateExpression's `template` role is the
                // ADR-0032 §3 double-brace text template and would reject every
                // correct `loop.collection`). They are declared in the ledger so the
                // reconciliation ratchet still covers the marker.
                for (const found of resolveFlowNodeExpressions(node.type, node.config)) {
                    if (found.entry.role !== 'predicate') continue;
                    // No schema hint: a screen's `visibleWhen` binds the screen's OWN
                    // collected values, not the trigger record's fields, so the
                    // field-existence pass would report every field name as unknown.
                    check(
                        `${at}node '${node.id}' (${node.type}) ${found.entry.label} at config.${found.path}`,
                        found.value,
                        false,
                    );
                }
            }
            for (const edge of graph.edges) {
                check(`${at}edge '${edge.id}' (${edge.source}→${edge.target}) condition`, edge.condition as unknown);
            }
        }

        if (failures.length > 0) {
            throw new Error(
                `Flow '${flowName}' has ${failures.length} invalid expression${failures.length > 1 ? 's' : ''} (ADR-0032 §1a). ` +
                `Predicates — conditions and declared bare-CEL slots such as a screen field's \`visibleWhen\` — ` +
                `must not wrap references in \`{…}\` template braces; template slots (e.g. \`loop.collection\`) require them:\n` +
                `${failures.join('\n')}`,
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
        //
        // A `skipped` step is NOT a visit (#4354): those entries record a gate
        // that closed in FRONT of a node, so counting them would let a flow whose
        // gate refuses often abort itself as a runaway — a new observability
        // signal changing execution semantics, which it must never do.
        const priorVisits = steps.reduce(
            (n, s) =>
                s.nodeId === node.id && s.parentNodeId === undefined && s.status !== 'skipped'
                    ? n + 1
                    : n,
            0,
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

                // #3863 — a guard that THROWS is as un-routable as one that
                // returns: `UnscopedRunDataAccessError` (ADR-0049/#1888) reports
                // that the metadata would run unscoped, and rerouting it would
                // let a `fault` edge disable the elevation check.
                const faultEdge = isGuardRefusal(execErr)
                    ? undefined
                    : flow.edges.find(e => e.source === node.id && e.type === 'fault');
                if (faultEdge) {
                    variables.set('$error', { nodeId: node.id, message: errMsg });
                    this.setNodeError(variables, node.id, errMsg);
                    const faultTarget = flow.nodes.find(n => n.id === faultEdge.target);
                    if (faultTarget) {
                        await this.executeNode(faultTarget, flow, variables, context, steps);
                        return;
                    }
                }
                throw execErr;
            }

            // #6667 — declared = enforced for `supportsPause`, at the ONE seam
            // every suspension passes through.
            //
            // Placed here rather than beside the `throw new FlowSuspendSignal`
            // below on purpose: converting the mismatch into an ordinary guard
            // refusal *before* the success bookkeeping means the run records a
            // `failure` step for the offending node (not a `success` step
            // followed by an unexplained failed run), sets `$error` like any
            // other refusal, and inherits #3863's un-routability — a `fault`
            // edge must not be able to swallow a declaration defect, since
            // re-running the flow unchanged can never fix one.
            //
            // Exactly once, and nothing bypasses it: this is the only call site
            // of any `executor.execute()` that the engine acts on — the ADR-0018
            // alias path delegates and RETURNS its target's result here rather
            // than suspending on its own, `resume()` re-enters through
            // {@link executeNode}, and region bodies ({@link runRegion}) do too.
            if (result.success && result.suspend === true) {
                result = this.refuseUndeclaredSuspension(node.type) ?? result;
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
                    ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                    // #4354 — a node that failed PART WAY may still have written
                    // rows; dropping its counts would understate what the run did.
                    ...(result.metrics ? { metrics: result.metrics } : {}),
                });

                // Write error output to variable context for downstream nodes
                variables.set('$error', { nodeId: node.id, message: errMsg, output: result.output });
                this.setNodeError(variables, node.id, errMsg);

                // #3863 — only a `runtime` failure may be routed. A `guard`
                // refusal says the METADATA is wrong (#3810 erased a filter
                // condition, a data node names no object); rerouting it would
                // make a single `fault` edge a switch that turns the guard off
                // while the run still reports success.
                const faultEdge = result.errorClass === 'guard'
                    ? undefined
                    : flow.edges.find(e => e.source === node.id && e.type === 'fault');
                if (faultEdge) {
                    const faultTarget = flow.nodes.find(n => n.id === faultEdge.target);
                    if (faultTarget) {
                        await this.executeNode(faultTarget, flow, variables, context, steps);
                        return;
                    }
                }
                throw new Error(`Node '${node.id}' failed: ${errMsg}`);
            }

            // Log successful step (#3407: advisory executor warnings ride along
            // so a legal-but-partial outcome never reads as a clean success;
            // #4354: the executor's own record counts ride along too, so the run
            // summary can tell a sweep that had nothing to do from one that did
            // nothing).
            steps.push({
                nodeId: node.id,
                nodeType: node.type,
                status: 'success',
                startedAt: stepStartedAt,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - stepStart,
                ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                ...(result.metrics ? { metrics: result.metrics } : {}),
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
                throw new FlowSuspendSignal(node.id, result.correlation, result.screen, node.type);
            }

            // #3447 P2: an executor may pick its own out-edge without suspending
            // (e.g. an approval node auto-approving an empty slate walks its
            // `approve` edge directly). The field predates this — it was declared
            // on NodeExecutionResult "for decision nodes" but never consumed on
            // the synchronous path; only resume() honoured its signal twin. On a
            // labelled-edge node, falling through to the unlabelled traversal
            // would walk EVERY unconditional out-edge (approve AND reject), so
            // the label must be honoured here.
            if (result.branchLabel) {
                await this.traverseNext(node, flow, variables, context, steps, result.branchLabel);
                return;
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
     *     `skipped` step (#4354).
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
    private async traverseNext(
        node: FlowNodeParsed,
        flow: FlowParsed,
        variables: Map<string, unknown>,
        context: AutomationContext,
        steps: StepLogEntry[],
        branchLabel?: string,
    ): Promise<void> {
        // Find next nodes — separate conditional, default and unconditional edges
        const allOutEdges = flow.edges.filter(
            e => e.source === node.id && e.type !== 'fault',
        );
        let outEdges = allOutEdges;

        // Branch selection: prefer edges tagged with the decision label.
        if (branchLabel) {
            let claimed = outEdges.filter(e => e.label === branchLabel);
            // The `default` sentinel is also claimed by the BPMN default edge, so
            // "none of my conditions matched" routes to the declared fallback
            // without the author having to ALSO label that edge 'default'.
            if (claimed.length === 0 && branchLabel === DEFAULT_BRANCH_LABEL) {
                claimed = outEdges.filter(e => e.isDefault);
            }
            if (claimed.length > 0) {
                outEdges = claimed;
            } else {
                // #4414 — do not fall back silently. The node computed a branch
                // and no out-edge claims it, so every out-edge is about to be
                // considered: the guard the author wrote is not guarding.
                //
                // #6654 — the computed branch label is potentially
                // RECORD-DERIVED and the edge labels are FLOW-AUTHOR metadata
                // (neither is schema-constrained against newlines), so both
                // ride the structured slot, never the message; see
                // `forgetSuspendedRun`'s catch for the full mechanism (#6299).
                // #4632: FUNCTIONAL — stays `warn`.
                this.logger.warn(
                    // `flow.name` is absent on the synthetic view `runRegion` builds.
                    `Flow '${flow.name ?? '(region)'}' node '${node.id}' (${node.type}) selected a branch, ` +
                    `but no out-edge carries that label — the computed branch and the out-edge labels are ` +
                    `in this record's meta. The branch selection is IGNORED and every out-edge is ` +
                    `evaluated instead, so unconditional siblings run regardless of the decision. ` +
                    `Make an out-edge's \`label\` match the branch, or mark the fallback edge ` +
                    `\`isDefault: true\`. (#4414)`,
                    {
                        branchLabel,
                        outEdges: allOutEdges.map(e => ({ id: e.id, label: e.label ?? null })),
                    },
                );
            }
        }

        const conditionalEdges: FlowEdgeParsed[] = [];
        const defaultEdges: FlowEdgeParsed[] = [];
        const unconditionalEdges: FlowEdgeParsed[] = [];
        for (const edge of outEdges) {
            if (edge.condition) {
                conditionalEdges.push(edge);
            } else if (edge.isDefault) {
                defaultEdges.push(edge);
            } else {
                unconditionalEdges.push(edge);
            }
        }

        // Conditional edges: evaluate sequentially (mutually exclusive)
        let anyConditionMet = false;
        for (const edge of conditionalEdges) {
            const nextNode = flow.nodes.find(n => n.id === edge.target);
            if (this.evaluateCondition(edge.condition!, variables)) {
                anyConditionMet = true;
                if (nextNode) {
                    await this.executeNode(nextNode, flow, variables, context, steps);
                }
            } else if (nextNode) {
                // #4354 — the gate closed. Record it: this is THE event that had
                // no trace anywhere, and the reason #4347 shipped three inert
                // production flows. A closed gate inside a loop body is logged
                // once per iteration (region tagging in `runRegion` attaches the
                // container + iteration), so the run summary can say
                // "selected 30, acted 0, skipped 30 by <gate>" instead of
                // reporting a green run that did nothing.
                //
                // The step is `skipped`, never a run: the re-entrancy guard,
                // per-node `runs` counts and node status all exclude it, so
                // recording a non-event stays a non-event to execution.
                const at = new Date().toISOString();
                steps.push({
                    nodeId: nextNode.id,
                    nodeType: nextNode.type,
                    ...(nextNode.label ? { nodeLabel: nextNode.label } : {}),
                    status: 'skipped',
                    startedAt: at,
                    completedAt: at,
                    durationMs: 0,
                    skippedBy: {
                        nodeId: node.id,
                        ...(edge.id ? { edgeId: edge.id } : {}),
                        ...(edge.label ? { label: edge.label } : {}),
                    },
                });
            }
        }

        // Default edges (BPMN default flow, #4414): the fallback, taken only
        // when NO conditional sibling matched. `isDefault` is what makes this an
        // "otherwise" rather than a second unconditional path — without it the
        // author's only spelling of "otherwise" was to hand-write the negation
        // of every sibling condition, and forgetting to do that ran both
        // branches. A default edge passed over because a real branch won records
        // the same `skipped` trace a closed gate does (#4354).
        for (const edge of defaultEdges) {
            const nextNode = flow.nodes.find(n => n.id === edge.target);
            if (!anyConditionMet) {
                if (nextNode) {
                    await this.executeNode(nextNode, flow, variables, context, steps);
                }
            } else if (nextNode) {
                const at = new Date().toISOString();
                steps.push({
                    nodeId: nextNode.id,
                    nodeType: nextNode.type,
                    ...(nextNode.label ? { nodeLabel: nextNode.label } : {}),
                    status: 'skipped',
                    startedAt: at,
                    completedAt: at,
                    durationMs: 0,
                    skippedBy: {
                        nodeId: node.id,
                        ...(edge.id ? { edgeId: edge.id } : {}),
                        ...(edge.label ? { label: edge.label } : {}),
                    },
                });
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
     * `parentNodeId` / `iteration` / `regionKind` / `retryAttempt`.
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
     * Durable pause (`suspend`) inside a region is not supported in this
     * iteration — it is converted into a clear error (mirrors the `subflow`
     * nested-pause guard).
     */
    async runRegion(
        region: FlowRegionParsed,
        variables: Map<string, unknown>,
        context: AutomationContext,
        grouping?: { parentNodeId: string; iteration?: number; regionKind?: string; retryAttempt?: number },
        partialSteps?: StepLogEntry[],
    ): Promise<StepLogEntry[]> {
        const entryId = findRegionEntry(region);
        const entry = region.nodes.find(n => n.id === entryId);
        if (!entry) {
            throw new Error(`region entry node '${entryId}' not found`);
        }
        // A synthetic flow view — executeNode/traverseNext only read `nodes`/`edges`.
        const subFlow = { nodes: region.nodes, edges: region.edges ?? [] } as unknown as FlowParsed;
        const regionSteps: StepLogEntry[] = [];
        // Tag this region's steps with their immediate container. Innermost wins:
        // a step that already carries a `parentNodeId` (set by a nested region)
        // is left untouched. Shared by the success and failure paths (#7546) so
        // a failed attempt's steps are indistinguishable in SHAPE from a
        // successful one's — they differ only in their own `status`.
        const tag = (): void => {
            if (!grouping) return;
            for (const step of regionSteps) {
                if (step.parentNodeId === undefined) {
                    step.parentNodeId = grouping.parentNodeId;
                    if (grouping.iteration !== undefined) step.iteration = grouping.iteration;
                    if (grouping.regionKind !== undefined) step.regionKind = grouping.regionKind;
                    if (grouping.retryAttempt !== undefined) step.retryAttempt = grouping.retryAttempt;
                }
            }
        };
        try {
            await this.executeNode(entry, subFlow, variables, context, regionSteps);
        } catch (err) {
            // #7546: surface what the failed attempt DID get through before
            // rethrowing. Tagged first so the caller receives finished records,
            // and pushed into the caller's sink rather than returned because
            // this path's contract is (still) to throw.
            tag();
            partialSteps?.push(...regionSteps);
            if (isSuspendSignal(err)) {
                throw new Error(
                    `durable pause inside a structured region (node '${err.nodeId}') is not supported`,
                );
            }
            throw err;
        }
        tag();
        return regionSteps;
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
    private async executeWithTimeout(
        promise: Promise<NodeExecutionResult>,
        timeoutMs: number,
        nodeId: string,
    ): Promise<NodeExecutionResult> {
        let guard: ReturnType<typeof setTimeout> | undefined;

        const timeoutPromise = new Promise<never>((_, reject) => {
            guard = setTimeout(() => {
                reject(new Error(`Node '${nodeId}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            clearTimeout(guard);
        }
    }

    /**
     * Evaluate a flow condition to a boolean.
     *
     * ## Which dialect a condition is in
     *
     * A condition is **CEL** unless it is written in the legacy single-brace
     * `{var}` template dialect — and that is decided by looking at the *source*,
     * not at whether an envelope happens to be present (#4336).
     *
     * It used to be decided by the envelope, and that was the bug: only an
     * `{ dialect, source }` envelope reached the CEL engine, so a condition
     * authored as a plain string — the shape `ExpressionInput` accepts by design,
     * and the shape every node `config` still holds, since `FlowNodeSchema.config`
     * is an open `z.record` no transform can reach — fell through to the template
     * path and was compared **as text**. The failure direction depended on the
     * predicate, which is what made it dangerous:
     *
     *     'existingTask == null'  →  'existingTask' === 'null'   →  always FALSE
     *     'record.rating >= 4'    →  'record.rating' >= '4'      →  always TRUE
     *
     * — one gate that never opens, one branch pinned open, both reporting
     * `success`. Reading the source instead means the same predicate evaluates
     * the same way wherever it is authored: an edge (parsed into an envelope by
     * `FlowEdgeSchema`), a start-node gate, or a `decision` node's
     * `config.conditions[].expression`, which no schema normalizes.
     *
     * The `{var}` dialect stays supported for the flows that use it — but it no
     * longer answers `false` when it could not resolve something. Per ADR-0032
     * §1c a predicate that cannot be evaluated is a **fault**, never a quiet
     * branch decision, so an unresolved hole is refused with the source attached.
     *
     * Braces inside a **CEL envelope** remain the #1491 brace-trap and still
     * throw: an explicit `dialect: 'cel'` is the author saying "this is CEL", and
     * `{…}` is a map literal there. The sniff only applies where the dialect was
     * never stated.
     */
    evaluateCondition(expression: string | { dialect?: string; source?: string; ast?: unknown }, variables: Map<string, unknown>): boolean {
        const isEnvelope = typeof expression === 'object' && expression != null && 'dialect' in expression;
        const dialect = isEnvelope ? (expression as { dialect?: string }).dialect : undefined;
        const exprStr = typeof expression === 'string' ? expression : ((expression as { source?: string })?.source ?? '');

        if (isEnvelope && dialect && dialect !== 'cel' && dialect !== 'flow' && dialect !== 'template') {
            // Other dialects (cron, js) are not boolean predicates here.
            return false;
        }

        // An absent / empty condition is not a predicate to evaluate. Callers that
        // mean "unconditional" guard before calling; this is the one that does not
        // (a `decision` node whose `conditions[]` entry has no `expression`), and
        // an unauthored branch must not open.
        if (exprStr.trim() === '') return false;

        // The dialect decision (see the doc comment). An explicit `template`/`flow`
        // envelope takes the author at their word; a bare string is sniffed for a
        // `{var}` hole; everything else — including an envelope with no dialect —
        // is CEL.
        const holes = templateHoles(exprStr);
        const declaredTemplate = isEnvelope && (dialect === 'template' || dialect === 'flow');
        const useTemplateDialect = declaredTemplate || (!isEnvelope && holes.length > 0);

        // CEL path — bind `vars` scope for `{step.result}` style references via
        // the equivalent `vars.step.result` CEL identifier path.
        if (!useTemplateDialect) {
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

        // No `try { … } catch { return false }` around this block (#4347). Nothing
        // in it throws — `indexOf` / `slice` / `Number` / `compareValues` are all
        // total — so the catch guarded nothing, and the things that CAN throw
        // here now are the deliberate refusals below, which a swallow-to-`false`
        // would turn straight back into the silent wrong answer they exist to
        // prevent (ADR-0032 §1c, same rule as the CEL path above).

        // A hole naming nothing in the variable map is unresolvable (#4336).
        // Refuse — see the helper for why `false` was the wrong answer.
        this.refuseUnresolvedTemplateHole(exprStr, holes.filter(h => !variables.has(h.slice(1, -1))));

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
                this.refuseUnresolvedCelOperand(exprStr, left, right);
                return this.compareValues(left, op, right);
            }
        }

        // Numeric truthy check
        const numVal = Number(resolved);
        if (!isNaN(numVal)) return numVal !== 0;

        // No operator, not a boolean, not a number — this path has no way to
        // decide the branch, and `false` used to be its answer (#4336). That made
        // a truthy gate on a non-boolean variable — `'{record.status}'`, where
        // the value is `'open'` — read as "condition not met" forever, with the
        // run still recorded as `success`. Refuse instead, same rule as above.
        throw new Error(
            `condition evaluation error: \`${resolved}\` is not a predicate — source: \`${exprStr}\`. ` +
            `The legacy \`{var}\` template dialect decides a branch by comparing the substituted ` +
            `text, so it needs a comparison (\`{status} == 'open'\`) or a value that reads as a ` +
            `boolean or number; a bare non-boolean value gives it nothing to compare and used to ` +
            `answer \`false\` regardless of the value. Write the predicate as CEL — a condition ` +
            `without \`{…}\` braces is evaluated by the CEL engine, where \`record.isActive\` is a ` +
            `truthy gate and \`record.status == 'open'\` resolves the field.`,
        );
    }

    /**
     * Refuse a legacy-dialect condition whose `{…}` holes name no variable
     * (#4336).
     *
     * Substitution replaces the literal text `{<key>}` for each key in the
     * variable map, so an unmatched hole survives into the comparison — and the
     * template path would then compare the *brace text itself*:
     *
     *     '{lead_record.status} == \'converted\''
     *         →  '{lead_record.status}' === "'converted'"  →  always FALSE
     *
     * The gate never opens, for any record, and the run still reports `success`.
     *
     * The common way to land here is a **field access on an object variable**:
     * `get_record`'s `outputVariable` stores the whole record under one name
     * (`lead_record`), so `{lead_record.status}` asks for a key that was never
     * written. Note the asymmetry that let this survive — a node's outputs ARE
     * flattened into dotted keys (`${node.id}.${key}`), so `{get_lead.id}`
     * resolves and looks like proof the spelling works.
     *
     * CEL resolves that access properly, which is why the prescription is to drop
     * the braces rather than to spell the hole differently.
     */
    private refuseUnresolvedTemplateHole(source: string, unresolved: readonly string[]): void {
        if (unresolved.length === 0) return;
        const names = [...new Set(unresolved)];
        throw new Error(
            `condition evaluation error: ${names.map(h => `\`${h}\``).join(', ')} did not resolve — ` +
            `source: \`${source}\`. The legacy \`{var}\` template dialect substitutes a WHOLE flow ` +
            `variable by name, and no variable is named ${names.map(h => `\`${h.slice(1, -1)}\``).join(', ')}. ` +
            `Leaving it in place would compare the brace text as a STRING — a branch that is silently ` +
            `wrong rather than merely unevaluated — so this is refused. Drop the braces: a condition ` +
            `without them is evaluated as CEL, which resolves field access on an object variable ` +
            `(\`lead_record.status == 'converted'\`) instead of looking for a variable spelled that way.`,
        );
    }

    /**
     * Refuse a comparison whose operand is an **unresolved CEL reference**
     * (#4347).
     *
     * The legacy path substitutes `{var}` tokens and then compares whatever text
     * is left. A dotted path can never be what that substitution produced — it
     * replaces the whole `{…}` token with a VALUE — so a surviving
     * `record.amount` means a CEL predicate reached the template path. Comparing
     * it as a string is not merely unhelpful, it is silently WRONG *in the
     * true direction*:
     *
     *     'oppRecord.amount > 500000'  →  'oppRecord.amount' > '500000'
     *                                 →  'o' > '5'  →  TRUE, for every record
     *
     * — a gate that reports success while never actually gating. So this refuses
     * rather than warns, the same rule ADR-0032 §1c set for the CEL path: a
     * predicate that cannot be evaluated is a fault, never a quiet `false` (or,
     * here, a quiet `true`).
     *
     * Since #4336 a *wholly* brace-free condition no longer arrives here at all —
     * it is CEL, and `oppRecord.amount > 500000` simply evaluates. What still
     * reaches this guard is a dotted reference **mixed into** a template-dialect
     * condition (`'{limit} > record.amount'`), where the author is one operand
     * away from the right dialect and the string compare would answer anyway.
     *
     * Only *dotted* references are refused. A bare word compares as a string on
     * purpose — `'{status} == active'` is the documented legacy spelling, and
     * after substitution both sides are plain words.
     */
    private refuseUnresolvedCelOperand(source: string, ...operands: readonly string[]): void {
        const offender = operands.find(o => UNRESOLVED_CEL_REFERENCE.test(o));
        if (!offender) return;
        throw new Error(
            `condition evaluation error: '${offender}' is an unresolved expression reference — ` +
            `source: \`${source}\`. This predicate reached the legacy \`{var}\` template path, which ` +
            `compares leftover text as STRINGS: a dotted reference is then compared character by ` +
            `character (\`record.amount > 500000\` compares 'r' against '5' and is true for every ` +
            `record), so the branch would be silently wrong rather than merely unevaluated. ` +
            `Write it as CEL — a \`{ dialect: 'cel', source }\` envelope or the \`P\` tagged template ` +
            `— which resolves references properly; or, if the \`{var}\` template dialect was meant, ` +
            `brace the reference (\`{${offender}}\`).`,
        );
    }

    /**
     * Compare two string-represented values with an operator.
     *
     * Quoted operands are unquoted first (#4336). The template dialect compares
     * text, so `'{status} == \'active\''` used to substitute to `active ==
     * 'active'` and compare `active` against `'active'` **with the quotes** —
     * never equal, for any value of `status`. That spelling is not exotic: it is
     * what the flow docs show for a decision node, and quoting a string literal
     * is what every other predicate surface on the platform requires. So the
     * quotes are stripped and both the quoted and the bare form (`{status} ==
     * active`, the older documented spelling) compare the same way.
     */
    private compareValues(left: string, op: string, right: string): boolean {
        left = unquoteLiteral(left);
        right = unquoteLiteral(right);
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
     */
    private async retryExecution(
        flowName: string,
        context: AutomationContext | undefined,
        startTime: number,
        errorHandling: NonNullable<FlowParsed['errorHandling']>,
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
        const variables = new Map<string, unknown>();
        if (!flow.variables) return variables;
        for (const v of flow.variables) {
            const supplied = v.isInput ? context?.params?.[v.name] : undefined;
            if (supplied !== undefined) {
                variables.set(v.name, supplied);
            } else if (v.defaultValue !== undefined) {
                variables.set(v.name, v.defaultValue);
            }
        }
        return variables;
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

        const variables = this.seedDeclaredVariables(flow, context);
        if (context?.record) {
            variables.set('$record', context.record);
        }

        const runId = this.nextRunId();
        const startedAt = new Date().toISOString();
        const steps: StepLogEntry[] = [];

        // ADR-0049 / #1888 — establish the run's effective execution identity
        // from flow.runAs (see execute() / resolveRunContext); threaded below.
        // `flowRunId` is stamped here too (#3456).
        const runContext = await this.resolveRunContext(flow, context, runId);

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
            const logged = this.recordLog({
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
            });

            // #4354 — a retried run reports its own attempt's counts, not the
            // failed one's: `retryExecution` returns THIS result on success.
            return { success: true, output, durationMs, summary: logged.summary };
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const durationMs = Date.now() - startTime;
            const logged = this.recordLog({
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
            });
            return { success: false, error: errorMessage, durationMs, summary: logged.summary };
        }
    }
}
