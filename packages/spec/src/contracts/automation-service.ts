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
    /** Object name the record belongs to */
    object?: string;
    /** Trigger event type (e.g. 'on_create', 'on_update') */
    event?: string;
    /** User who triggered the automation */
    userId?: string;
    /** Additional contextual data */
    params?: Record<string, unknown>;
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
}
