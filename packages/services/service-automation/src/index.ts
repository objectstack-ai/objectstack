// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Core engine
export { AutomationEngine, DEFAULT_MAX_EXECUTION_LOG_SIZE, MAX_PERSISTED_HISTORY_STEPS } from './engine.js';
export type {
    AutomationEngineOptions,
    RunSummaryLogLevel,
    NodeExecutor,
    NodeExecutionResult,
    // The teardown half of a pause (#5512): a plugin node that arms something on
    // entry needs these to name the callback that disarms it.
    SuspensionRelease,
    SuspensionReleaseReason,
    FlowTrigger,
    FlowTriggerBinding,
    ConnectorActionHandler,
    ConnectorActionContext,
    RegisteredConnector,
    SuspendedRun,
    SuspendedRunStore,
    FlowDispatchStore,
    RunRecord,
    StepLogEntry,
    UnknownNodeTypeAuditEntry,
} from './engine.js';

// Per-run summary (#4354): the fold that turns a run's step log into
// "selected N, acted M, skipped K by <gate>". Exported so a host building its
// own observability surface (or a test asserting a sweep actually wrote
// something) reuses the platform's definition instead of re-deriving one.
export { summarizeRun, formatRunSummaryLine } from './run-summary.js';

// Connector provider contract (ADR-0097) and the registry vocabulary that goes
// with it — re-exported from @objectstack/spec so hosts/tests can reach them via
// this package too. Connector plugins should import them directly from
// `@objectstack/spec/integration` (no coupling to this engine).
//
// [#4127] The descriptor types moved to the spec: `ConnectorDescriptor` is the
// return type of `IAutomationService.getConnectorDescriptors`, so declaring it
// here left the contract unable to name its own method. Same names, same
// shapes — this re-export keeps `@objectstack/service-automation` importers
// working unchanged.
export type {
    ConnectorProviderFactory,
    ConnectorProviderContext,
    ConnectorMaterialization,
    ConnectorMaterializationHandler,
    ConnectorOrigin,
    ConnectorState,
    ConnectorDescriptor,
    ConnectorActionDescriptor,
} from '@objectstack/spec/integration';

// Durable suspended-run persistence (ADR-0019). The in-memory store is the
// default; the ObjectQL-backed store persists pauses across process restarts.
export {
    InMemorySuspendedRunStore,
    ObjectStoreSuspendedRunStore,
    DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW,
} from './suspended-run-store.js';
export type { SuspendedRunStoreEngine, ObjectStoreSuspendedRunStoreOptions } from './suspended-run-store.js';

// The sys_automation_run object backing the durable store — registered by
// AutomationServicePlugin and exported for hosts wiring a custom store.
export { SysAutomationRun } from './sys-automation-run.object.js';

// Trigger dispatch idempotency (#10220). The persisted claim ledger behind
// `AutomationEngine.claim(key)` — the in-memory store is for tests / explicit
// memory-only hosts; the ObjectQL-backed store makes dedup survive rebuilds.
export { InMemoryFlowDispatchStore, ObjectStoreFlowDispatchStore } from './flow-dispatch-store.js';
export { SysFlowDispatch } from './sys-flow-dispatch.object.js';

// Kernel plugin — seeds all built-in nodes; this is the only plugin needed for
// a fully-functional automation capability.
export { AutomationServicePlugin, createPackageFileLoader } from './plugin.js';
export type { AutomationServicePluginOptions } from './plugin.js';

// Run identity (ADR-0049 / #1888). Maps a flow run's effective `runAs` to the
// ObjectQL `context` its data nodes pass — `system` → elevated/RLS-bypassing,
// `user` → the triggering user. A run that resolves NO principal is refused
// outright (#3760). Exported for hosts building custom data nodes: call
// `resolveRunDataContext` and let the error propagate, so a custom node inherits
// the same posture as the built-ins instead of re-opening the fail-open.
export {
    resolveRunDataContext,
    stampSystemInsertOwner,
    UnscopedRunDataAccessError,
} from './runtime-identity.js';
export type { RunDataContext, RunIdentityContext, RunProvenanceContext } from './runtime-identity.js';

// Built-in node executors (ADR-0018). These are seeded by AutomationServicePlugin
// and exported for advanced hosts that build a custom engine. They are functions,
// not plugins — the platform's foundational nodes are built in, not installed.
export {
    installBuiltinNodes,
    registerLogicNodes,
    registerCrudNodes,
    registerScreenNodes,
    registerHttpNodes,
    registerConnectorNodes,
} from './builtin/index.js';
