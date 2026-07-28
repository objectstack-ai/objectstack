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
import type { ExecutionLog } from '../automation/execution.zod';
import type { ActionDescriptor } from '../automation/node-executor.zod';

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
}

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
     * @param flowName - Flow name (snake_case)
     * @param options - Pagination options
     * @returns Array of execution logs
     */
    listRuns?(flowName: string, options?: { limit?: number; cursor?: string }): Promise<ExecutionLog[]>;

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
     * Resume a run that suspended at a pausing node (ADR-0019). The run must
     * have previously returned `{ status: 'paused', runId }` from
     * {@link execute} (or a prior `resume`). Continues traversal from the
     * suspended node's out-edges, applying `signal.output` / `signal.branchLabel`.
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
     * re-fetch the form (e.g. after a page refresh).
     */
    getSuspendedScreen?(runId: string): ScreenSpec | null;
}
