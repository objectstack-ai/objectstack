// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Core engine
export { AutomationEngine, DEFAULT_MAX_EXECUTION_LOG_SIZE, MAX_PERSISTED_HISTORY_STEPS } from './engine.js';
export type {
    AutomationEngineOptions,
    NodeExecutor,
    NodeExecutionResult,
    FlowTrigger,
    FlowTriggerBinding,
    ConnectorActionHandler,
    ConnectorActionContext,
    RegisteredConnector,
    ConnectorOrigin,
    ConnectorDescriptor,
    ConnectorActionDescriptor,
    SuspendedRun,
    SuspendedRunStore,
    RunRecord,
    StepLogEntry,
} from './engine.js';

// Connector provider contract (ADR-0096) — re-exported from @objectstack/spec so
// hosts/tests can reach it via this package too. Connector plugins should import
// it directly from `@objectstack/spec/integration` (no coupling to this engine).
export type {
    ConnectorProviderFactory,
    ConnectorProviderContext,
    ConnectorMaterialization,
    ConnectorMaterializationHandler,
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

// Kernel plugin — seeds all built-in nodes; this is the only plugin needed for
// a fully-functional automation capability.
export { AutomationServicePlugin } from './plugin.js';
export type { AutomationServicePluginOptions } from './plugin.js';

// Run identity (ADR-0049 / #1888). Maps a flow run's effective `runAs` to the
// ObjectQL `context` its data nodes pass — `system` → elevated/RLS-bypassing,
// `user` → the triggering user. Exported for hosts building custom data nodes.
export { resolveRunDataContext } from './runtime-identity.js';
export type { RunDataContext } from './runtime-identity.js';

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
