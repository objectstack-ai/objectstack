// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Core engine
export { AutomationEngine } from './engine.js';
export type { NodeExecutor, NodeExecutionResult, FlowTrigger } from './engine.js';

// Kernel plugin — seeds all built-in nodes; this is the only plugin needed for
// a fully-functional automation capability.
export { AutomationServicePlugin } from './plugin.js';
export type { AutomationServicePluginOptions } from './plugin.js';

// Built-in node executors (ADR-0018). These are seeded by AutomationServicePlugin
// and exported for advanced hosts that build a custom engine. They are functions,
// not plugins — the platform's foundational nodes are built in, not installed.
export {
    installBuiltinNodes,
    registerLogicNodes,
    registerCrudNodes,
    registerScreenNodes,
    registerHttpNodes,
} from './builtin/index.js';
