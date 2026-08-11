// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IAutomationService - Automation Service Contract
 *
 * Defines the interface for flow/script execution in ObjectStack.
 * Concrete implementations (Flow Engine, Script Runner, etc.)
 * should implement this interface.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete automation engine implementations.
 *
 * Aligned with CoreServiceName 'automation' in core-services.zod.ts.
 */

import type { FlowParsed } from '../automation/flow.zod';
import type { ExecutionLog, ExecutionStatus, FlowRunSummary } from '../automation/execution.zod';
import type { ActionDescriptor } from '../automation/node-executor.zod';
import type { ConnectorDescriptor } from '../integration/connector-descriptor';
import type { ConversionNotice, ConversionConflictNotice } from '../conversions/types';

/**
 * Context passed to a flow/script execution
 */
export interface AutomationContext {
    /** Record that triggered the automation (if applicable) */
    record?: Record<string, unknown>;
    /**
     * Prior state of the record for update triggers (the "old" row). Lets
     * record-change-triggered flows gate on transitions (e.g.
     * `status == "done" && previous.status != "done"`). Absent for
     * create/delete events.
     */
    previous?: Record<string, unknown>;
    /** Object name the record belongs to */
    object?: string;
    /** Trigger event type (e.g. 'on_create', 'on_update') */
    event?: string;
    /** User who triggered the automation */
    userId?: string;
    /**
     * Position names of the triggering identity (ADR-0090 D3; formerly
     * `roles`). Forwarded by the trigger surface (REST route / record-change
     * hook) so a `runAs:'user'` run enforces RLS exactly as that user — not a
     * member fallback. ADR-0049 / #1888.
     */
    positions?: string[];
    /**
     * Explicit permission-set names of the triggering identity (parity with a
     * direct REST request). Forwarded alongside {@link positions}. ADR-0049 / #1888.
     */
    permissions?: string[];
    /**
     * Tenant/org id of the triggering identity, carried so a `runAs:'user'` run
     * stays tenant-scoped. ADR-0049 / #1888.
     */
    tenantId?: string;
    /**
     * Effective execution identity for the run's DATA operations, established by
     * the engine from {@link FlowParsed.runAs} at run setup (ADR-0049 / #1888):
     *  - `'system'` runs elevated — a full-access, RLS-bypassing system principal;
     *  - `'user'` (default) runs as {@link userId}, so CRUD nodes' ObjectQL
     *    reads/writes respect that user's row-level security.
     * Node executors translate this into the ObjectQL `context` they pass to the
     * data engine (see `resolveRunDataContext` in @objectstack/service-automation).
     * Callers do NOT set this — the engine derives it from the flow definition.
     */
    runAs?: 'system' | 'user';
    /**
     * Machine name of the flow this run executes, stamped by the engine at run
     * setup alongside {@link runAs} / {@link flowRunId} (same single
     * construction point, same lifetime). Provenance, not authorization — no
     * security middleware keys on it. Its consumer is audit attribution: a
     * `runAs:'system'` run resolves no user, so `resolveRunDataContext` labels
     * its data operations `svc:flow:<flowName>` on `ExecutionContext.actor`
     * (ADR-0014 D2) instead of leaving the audit row unattributed (#4366).
     *
     * Callers do NOT set this — the engine derives it, exactly like {@link runAs}.
     */
    flowName?: string;
    /**
     * Id of the run this context belongs to, stamped by the engine at run setup
     * alongside {@link runAs} and carried into every data node's ObjectQL
     * `context` (see `resolveRunDataContext` in @objectstack/service-automation).
     * It is persisted with a suspended run, so it survives a pause/resume round
     * trip — including a cold resume after a process restart.
     *
     * Provenance, not authorization: it grants nothing and no security
     * middleware keys on it. A hook uses it to recognize writes made BY a given
     * run — the approvals record lock (#3456) lets the run that opened a pending
     * approval write its own target record, which it otherwise cannot tell apart
     * from an unrelated user's edit. A run with no resolvable principal (a
     * schedule) carries this and nothing else into the data engine, so it is
     * attributable without presenting an identity it does not have (#3712).
     *
     * Callers do NOT set this — the engine derives it, exactly like {@link runAs}.
     */
    flowRunId?: string;
    /** Additional contextual data */
    params?: Record<string, unknown>;
}

/** One input field rendered by a paused `screen` node (ADR-0019 / screen-flow runtime). */
export interface ScreenFieldSpec {
    name: string;
    label?: string;
    /** Widget hint (text/select/boolean/number/date/…); the client maps it to a field widget. */
    type?: string;
    required?: boolean;
    /** Closed-enum options for select-style fields. */
    options?: Array<{ value: unknown; label: string }>;
    defaultValue?: unknown;
    placeholder?: string;
    /**
     * Conditional-visibility predicate (ADR-0089's canonical key), evaluated by
     * the CLIENT against the screen's live collected values — not by the server,
     * which has no view of what the user has typed so far.
     *
     * Bare CEL over the screen's own field names, e.g. `createOpportunity ==
     * true` shows the field only once that checkbox is ticked. Omit = always
     * visible.
     *
     * A hidden field is not collected, so it must not be enforced as `required`
     * either — a client that renders this predicate but validates over the full
     * field list dead-ends the run: Submit blocks on a field the user was never
     * shown, and no resume is ever issued (#3528).
     */
    visibleWhen?: string;
}

/**
 * The screen a paused `screen` node wants the client to render. Surfaced on a
 * paused {@link AutomationResult} so a UI flow-runner can collect input and
 * `resume()` the run with the values.
 */
export interface ScreenSpec {
    /** The screen node's id (correlates the resume back to this pause point). */
    nodeId: string;
    title?: string;
    description?: string;
    fields: ScreenFieldSpec[];
    /**
     * Rendering kind. `'fields'` (default) renders the flat {@link fields} list.
     * `'object-form'` renders an object's full create/edit form — including any
     * inline master-detail child grids (`subforms`) — so a screen-flow wizard
     * can walk the user through one full object form per step (e.g. lead
     * conversion: a Customer step, then an Opportunity-with-line-items step).
     * The client renders the object form; on save it persists the record (and
     * its children, atomically) itself, then resumes the run with the new
     * record's id bound to {@link idVariable}.
     */
    kind?: 'fields' | 'object-form';
    /** Object whose form to render (object-form screens). */
    objectName?: string;
    /** Form mode for an object-form screen — defaults to `'create'`. */
    mode?: 'create' | 'edit';
    /** Record id to edit (object-form screens in `'edit'` mode). */
    recordId?: string;
    /** Prefilled field values for the object form (already interpolated). */
    defaults?: Record<string, unknown>;
    /**
     * Flow variable that receives the saved record's id when the client resumes
     * the run — so a later step can reference it (e.g. the Opportunity form
     * prefilling its `account` FK with the id created by the Customer step).
     */
    idVariable?: string;
}

/**
 * Result of an automation execution
 */
export interface AutomationResult {
    /** Whether the automation completed successfully */
    success: boolean;
    /** Output data from the automation */
    output?: unknown;
    /** Error message if execution failed */
    error?: string;
    /** Execution duration in milliseconds */
    durationMs?: number;
    /**
     * Machine-readable failure classification, set alongside `error` when the
     * caller must distinguish *why* it failed rather than just report it —
     * without it a refusal is indistinguishable from "no such run".
     *
     *  - `'forbidden'` — {@link IAutomationService.resume} refused because the
     *    run is parked on a node whose descriptor declares
     *    `resumeAuthority: 'service'` — or declares no `resumeAuthority` at all,
     *    which resolves the same way (#3801, #5561). A transport maps it to
     *    **403**.
     *  - `'invalid_signal'` — the resume signal tried to write variables the
     *    flow engine reserves for itself (a `$…` name, or one carrying a `.$`
     *    segment: `$runId`, `<nodeId>.$mapItemDone`, …). A transport maps it to
     *    **400**.
     *  - `'RUN_NOT_FOUND'` — no suspension exists for the run id, in the hot
     *    cache or the durable store. The run is unresumable *for good*: it
     *    already resumed, was cancelled, or paused in a process whose state was
     *    never persisted (#4420). A transport maps it to **404**. Callers that
     *    persist a decision before resuming (approvals) must treat this as a
     *    hard failure, not a no-op.
     *  - `'STORE_UNAVAILABLE'` — the durable store could not be read, so
     *    whether a suspension exists is UNKNOWN. Distinct from
     *    `'RUN_NOT_FOUND'` on purpose: a transient store outage must not be
     *    mistaken for a dead run. A transport maps it to **503**; the same
     *    resume is expected to succeed once the store recovers.
     *  - `'RESUME_IN_PROGRESS'` — a concurrent resume of this run is already
     *    running; this duplicate was refused so side effects cannot run twice.
     *    A transport maps it to **409**. The other resume is doing the work,
     *    so callers should treat it as benign.
     *  - `'INVALID_SCREEN_INPUT'` — the run is parked on a `screen` node and
     *    the submitted bag violates that screen's declared field contract: a
     *    `required` field the caller WAS asked for is missing, or a key the
     *    screen never declared was sent (#4477). A transport maps it to
     *    **400**. Distinct from `'INVALID_SIGNAL'`, which is about the
     *    engine's own `$` variable namespace rather than the author's field
     *    declarations. `visibleWhen` is evaluated against the submitted values
     *    first, so a HIDDEN field's `required` never fires — enforcing it would
     *    dead-end the run at a field the user was never shown (#3528).
     *
     * All of these refuse before consuming the suspension: the run stays parked
     * and the legitimate continuation still lands.
     */
    code?: 'PERMISSION_DENIED' | 'INVALID_SIGNAL' | 'RUN_NOT_FOUND' | 'STORE_UNAVAILABLE' | 'RESUME_IN_PROGRESS' | 'INVALID_SCREEN_INPUT';
    /**
     * Lifecycle status. `'paused'` means the run suspended at a node (e.g.
     * an Approval node awaiting a human decision, ADR-0019) and can be
     * continued later with {@link IAutomationService.resume}. Absent or
     * `'completed'`/`'failed'` ⇒ the run reached a terminal state.
     */
    status?: 'completed' | 'paused' | 'failed';
    /** Run id — set when `status` is `'paused'`, so callers can resume it. */
    runId?: string;
    /**
     * The screen to render — set when the run paused at a `screen` node awaiting
     * user input (screen-flow runtime). The client collects values for
     * `screen.fields` and calls {@link IAutomationService.resume} with them as
     * `signal.variables`.
     */
    screen?: ScreenSpec;
    /**
     * Friendly terminal messages copied from the flow definition
     * (`flow.successMessage` / `flow.errorMessage`) so a screen-flow runner can
     * show a meaningful toast instead of a generic "Done" / the raw error.
     * `successMessage` is set on terminal success, `errorMessage` on failure.
     */
    successMessage?: string;
    errorMessage?: string;
    /**
     * #4354: what the run did — records selected / acted on, gate skips,
     * per-node status. Set on a TERMINAL result (a paused run has not finished
     * doing it yet).
     *
     * On the result rather than only in the run log because a caller that
     * invokes a flow synchronously — the `subflow` node rolling a child run up
     * into its parent, a test asserting a sweep wrote something — needs the
     * answer without a second round-trip through `getRun`.
     */
    summary?: FlowRunSummary;
}

/**
 * Marker a SERVICE stamps on its {@link ResumeSignal} to prove the resume is
 * the tail of a decision it already authorized and recorded (#3801).
 *
 * A run parked on a node whose descriptor declares `resumeAuthority: 'service'`
 * (today: `approval`, `approval_revise`) is resumable ONLY with this marker
 * present — as is a pause whose node type declares no `resumeAuthority` at all,
 * fail-closed since #5561. It is a
 * symbol on purpose: the generic resume route builds its signal out of a JSON
 * body, and no JSON body can produce a symbol-keyed property — so the marker
 * is unforgeable from outside the process, while an in-process owner
 * (`ApprovalService.decide` and friends) just sets it.
 *
 * Registered via `Symbol.for` so duplicate copies of this package in one
 * process still agree on identity.
 */
export const RESUME_AUTHORITY_SERVICE: unique symbol = Symbol.for(
    'objectstack.automation.resume.service',
);

/** Signal payload used to resume a paused run (ADR-0019). */
export interface ResumeSignal {
    /**
     * Output to merge into flow variables under the suspended node's id
     * (e.g. `{ decision: 'approved' }` → `<nodeId>.decision`). Downstream
     * edges branch on it exactly as for a normally-executed node.
     */
    output?: Record<string, unknown>;
    /**
     * Optional edge label to select which out-edge of the suspended node to
     * follow (e.g. `'approve'` / `'reject'`). When omitted, traversal falls
     * back to the node's conditional/unconditional edges.
     */
    branchLabel?: string;
    /**
     * Bare flow variables to set on resume (e.g. a `screen` node's collected
     * inputs: `{ new_assignee: 'ada@x' }` → variable `new_assignee`). Unlike
     * {@link output} these are set under their plain names, so downstream
     * `{var}` interpolation and conditions read them directly.
     */
    variables?: Record<string, unknown>;
    /**
     * Set by the service that OWNS the suspension to clear the resume gate on
     * a `resumeAuthority: 'service'` node — or on one that declares no
     * authority, which is gated the same way since #5561 (#3801). See
     * {@link RESUME_AUTHORITY_SERVICE} — unforgeable from an HTTP body, and
     * ignored entirely on nodes that declare `'any'`.
     */
    [RESUME_AUTHORITY_SERVICE]?: true;
}

/**
 * One flow's deployment + trigger-binding state, as
 * {@link IAutomationService.getFlowRuntimeStates} reports it (#4127).
 */
export interface FlowRuntimeState {
    /** Flow name (snake_case) — the key {@link IAutomationService.execute} takes. */
    name: string;
    /** Whether the flow is enabled; a disabled flow stays registered and never runs. */
    enabled: boolean;
    /**
     * Whether a trigger is actually wired to this flow. `false` for a flow with
     * no declared trigger (manual / screen flows) AND for one whose declared
     * trigger type has no registered trigger — `triggerType` distinguishes the
     * two.
     */
    bound: boolean;
    /** Persisted deployment status, when the flow carries one. */
    status?: string;
    /** Declared trigger type, when the flow declares one. */
    triggerType?: string;
    /** Object the trigger binds to, for object-bound trigger types. */
    object?: string;
}

export interface IAutomationService {
    /**
     * Execute a named flow or script
     * @param flowName - Flow/script identifier (snake_case)
     * @param context - Execution context with trigger data
     * @returns Automation result
     */
    execute(flowName: string, context?: AutomationContext): Promise<AutomationResult>;

    /**
     * List all registered automation flows
     * @returns Array of flow names
     */
    listFlows(): Promise<string[]>;

    /**
     * Register a flow definition
     * @param name - Flow name (snake_case)
     * @param definition - Flow definition object
     */
    registerFlow?(name: string, definition: unknown): void;

    /**
     * Canonicalize a flow definition WITHOUT registering it (#4454).
     *
     * The same ADR-0087 conversion policy {@link registerFlow} applies, exposed
     * for a caller that needs a flow's canonical shape but must not arm it —
     * `os migrate meta --stored` rewriting stored `sys_metadata` rows is the
     * reason this is on the contract rather than only on the implementation.
     *
     * Only an implementation holding the live executor registry can offer this:
     * flow-node conversions carry ADR-0078's open-namespace conflict guard, and
     * deciding a rename from a clobber requires knowing which node types are
     * actually owned here. Hence optional — a caller falls back to leaving flow
     * rows alone rather than guessing.
     *
     * @param name - Flow name (snake_case), used for diagnostics
     * @param definition - The stored/authored flow body
     * @returns `parsed` (execution shape — schema defaults materialized) and
     *   `storable` (persistence shape — conversions plus the schema's
     *   `condition` envelopes, deliberately WITHOUT schema defaults, so a
     *   written-back row is not frozen on today's default values), plus the
     *   conversions applied and any rewrite the guard refused.
     * @throws when the definition cannot be canonicalized at all (a strict-schema
     *   violation, a malformed control-flow region) — such a flow cannot be
     *   registered either, so a caller reports it rather than persisting a guess.
     */
    canonicalizeStoredFlow?(name: string, definition: unknown): {
        parsed: FlowParsed;
        storable: unknown;
        notices: ConversionNotice[];
        conflicts: ConversionConflictNotice[];
    };

    /**
     * Unregister a flow by name
     * @param name - Flow name (snake_case)
     */
    unregisterFlow?(name: string): void;

    /**
     * Get a flow definition by name
     * @param name - Flow name (snake_case)
     * @returns Flow definition or null if not found
     */
    getFlow?(name: string): Promise<FlowParsed | null>;

    /**
     * Enable or disable a flow
     * @param name - Flow name (snake_case)
     * @param enabled - Whether to enable (true) or disable (false)
     */
    toggleFlow?(name: string, enabled: boolean): Promise<void>;

    /**
     * List execution runs for a flow
     *
     * `status` is the wire's declared filter (`ListRunsRequestSchema`) reaching
     * the implementation at last: it was declared on `GET /:name/runs`, had no
     * slot here, and was therefore dropped at the HTTP boundary — so
     * `?status=failed` answered 200 with EVERY run of the flow (#7359). An
     * implementation that accepts the option must narrow by it across every
     * store it merges; a filter that sees only half the rows is the same class
     * of confident wrong answer as not filtering at all.
     *
     * @param flowName - Flow name (snake_case)
     * @param options - Filter and pagination options
     * @returns Array of execution logs
     */
    listRuns?(
        flowName: string,
        options?: { limit?: number; cursor?: string; status?: ExecutionStatus },
    ): Promise<ExecutionLog[]>;

    /**
     * Get a single execution run by ID
     * @param runId - Execution run ID
     * @returns Execution log or null if not found
     */
    getRun?(runId: string): Promise<ExecutionLog | null>;

    /**
     * Get the action descriptors published by registered node executors
     * (ADR-0018). Backs flow validation and the designer palette. Plugins
     * that register an executor with a descriptor extend this set, so the
     * automation engine's node/action vocabulary is open and marketplace-
     * extensible rather than a closed enum.
     * @returns Array of registered action descriptors
     */
    getActionDescriptors?(): ActionDescriptor[];

    /**
     * The connector registry, as designer-facing descriptors (ADR-0022).
     *
     * [#4127] Declared because `GET /automation/connectors` already called it —
     * the sibling of {@link getActionDescriptors}, which the contract HAS
     * declared since ADR-0018, serving the same designer with the other half of
     * the `connector_action` node's pickers (node type ← actions, connector /
     * action / input ← this). Undeclared, the route had to probe for the method
     * and then re-type its own result as `any` to filter on `type`.
     *
     * Optional for the same reason `getActionDescriptors` is: a connector
     * registry is a capability of the flow-engine implementation, not of every
     * automation slot — a script-runner implementation of this contract has no
     * connectors to describe, and answers an empty registry rather than 404.
     *
     * @returns One entry per registered connector; empty when none are registered
     */
    getConnectorDescriptors?(): ConnectorDescriptor[];

    /**
     * Per-flow deployment + binding state, for operator surfaces.
     *
     * [#4127] Declared because the dispatcher's `GET /automation/_status`
     * already called it (as did the CLI boot summary and the
     * `kernel:bootstrapped` audit), while the contract stopped at
     * {@link listFlows} — a bare `string[]` that cannot say whether a flow is
     * enabled, or bound to a trigger, or why it is not.
     *
     * `bound: false` is the answer the operator surfaces exist for: a flow with
     * no trigger (manually-invoked / screen flows) or whose declared trigger
     * type has no registered trigger. `triggerType` / `object` expose the
     * declared binding so the caller can say WHY, rather than only that.
     *
     * @returns One entry per registered flow
     */
    getFlowRuntimeStates?(): FlowRuntimeState[];

    /**
     * Resume a run that suspended at a pausing node (ADR-0019). The run must
     * have previously returned `{ status: 'paused', runId }` from
     * {@link execute} (or a prior `resume`). Continues traversal from the
     * suspended node's out-edges, applying `signal.output` / `signal.branchLabel`.
     *
     * **Gated by the suspended node (#3801).** When the run is parked on a node
     * whose descriptor declares `resumeAuthority: 'service'`, only that node's
     * owning service may continue it — the call is refused with
     * `{ success: false, code: 'PERMISSION_DENIED' }` unless `signal` carries
     * {@link RESUME_AUTHORITY_SERVICE}. The gate follows a subflow pause down
     * to the child the signal would actually land on, so a parent parked on a
     * `subflow` node is no way around it.
     *
     * **A node type that declares NO `resumeAuthority` is gated identically**
     * (#5561): the generic route is an opt-in a descriptor declares with
     * `'any'`, not a default it inherits. The refusal names the omission and
     * the one-line declaration that lifts it, so this is recoverable by the
     * plugin author rather than only by the platform.
     *
     * @param runId - The paused run's id
     * @param signal - Optional output to merge and/or branch label to follow
     * @returns The result of continuing the run (may itself be `'paused'` again)
     */
    resume?(runId: string, signal?: ResumeSignal): Promise<AutomationResult>;

    /**
     * List the currently suspended (paused) runs awaiting a resume — id, the
     * flow, the node they paused at, and any correlation key the pausing node
     * attached. Backs operability (e.g. a "pending approvals" view).
     */
    listSuspendedRuns?(): Array<{ runId: string; flowName: string; nodeId: string; correlation?: string }>;

    /**
     * The screen a paused run is currently awaiting (screen-flow runtime), or
     * `null` if the run isn't suspended at a `screen` node. Lets a UI flow-runner
     * re-fetch the form (e.g. after a page refresh, or on another device).
     *
     * **Durable, like {@link resume} (#4515).** The answer covers any run that
     * is genuinely suspended, not just the ones this process paused: the
     * in-memory hot cache is the fast path, and a miss falls back to the
     * suspended-run store the same way `resume` rehydrates. So a screen run
     * that survives a restart re-fetches its screen exactly as it resumes —
     * the rendering half of ADR-0019's durable-suspend promise. Async for that
     * reason; a synchronous reading of this method can only ever answer for the
     * current process lifetime.
     *
     * A run that does not exist, is no longer suspended, or paused at a
     * non-screen node still resolves to `null`.
     */
    getSuspendedScreen?(runId: string): Promise<ScreenSpec | null>;
}
