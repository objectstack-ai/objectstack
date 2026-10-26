/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Transaction Manager
 *
 * Provides transaction wrapper for multi-step operations via @objectstack/client.
 * Supports optimistic UI updates with rollback on failure and batch operation
 * progress tracking with connection-aware retry.
 *
 * @module actions
 * @packageDocumentation
 */

import type {
  DataSource,
  TransactionConfig,
  TransactionResult,
  ActionResult,
  UIActionSchema,
} from '@object-ui/types';

/**
 * Operation within a transaction (recorded for rollback)
 */
export interface TransactionOperation {
  /** Operation type */
  type: 'create' | 'update' | 'delete';
  /** Target resource name */
  resource: string;
  /**
   * Record ID (for update/delete). A `string`, as `@objectstack/spec` declares
   * every record door and as this type's own sibling `BatchTransactionOperation.id`
   * already did; the rollback path hands it straight to `DataSource.update`
   * (objectui#9333).
   */
  id?: string;
  /** Data payload */
  data?: Record<string, any>;
  /** Previous state (for rollback) */
  previousState?: Record<string, any>;
  /** Result of the operation */
  result?: any;
}

/**
 * Optimistic update entry for UI state management
 */
export interface OptimisticUpdate {
  /** Unique update ID */
  id: string;
  /** Operation type */
  type: 'create' | 'update' | 'delete';
  /** Target resource */
  resource: string;
  /** Record ID */
  recordId?: string | number;
  /** Optimistic data to display */
  optimisticData: Record<string, any>;
  /** Previous data (for rollback) */
  previousData?: Record<string, any>;
  /** Whether the update has been confirmed by server */
  confirmed: boolean;
  /** Whether the update was rolled back */
  rolledBack: boolean;
}

/**
 * Progress event for batch transaction operations
 */
export interface TransactionProgressEvent {
  /** Transaction name */
  transactionName: string;
  /** Total operations to execute */
  total: number;
  /** Completed operations */
  completed: number;
  /** Failed operations */
  failed: number;
  /** Progress percentage (0-100) */
  percentage: number;
  /** Current operation description */
  currentOperation?: string;
}

/**
 * Progress callback type
 */
export type TransactionProgressCallback = (event: TransactionProgressEvent) => void;

/**
 * Transaction manager for executing multi-step operations with rollback support
 */
export class TransactionManager {
  private dataSource: DataSource;
  private operations: TransactionOperation[] = [];
  private optimisticUpdates: Map<string, OptimisticUpdate> = new Map();
  private progressListeners: TransactionProgressCallback[] = [];
  private maxRetries: number;
  private retryDelay: number;

  constructor(
    dataSource: DataSource,
    options?: {
      maxRetries?: number;
      retryDelay?: number;
    },
  ) {
    this.dataSource = dataSource;
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelay = options?.retryDelay ?? 1000;
  }

  /**
   * Register a progress listener
   */
  onProgress(listener: TransactionProgressCallback): () => void {
    this.progressListeners.push(listener);
    return () => {
      const idx = this.progressListeners.indexOf(listener);
      if (idx > -1) this.progressListeners.splice(idx, 1);
    };
  }

  /**
   * Execute a set of operations within a logical transaction.
   * If any operation fails, previously completed operations are rolled back.
   *
   * @example
   * ```ts
   * const result = await manager.executeTransaction({
   *   name: 'Create Order',
   *   actions: [createOrderAction, updateInventoryAction, sendNotificationAction],
   *   retryOnConflict: true,
   *   maxRetries: 3,
   * }, actionExecutor);
   * ```
   */
  async executeTransaction(
    config: TransactionConfig,
    actionExecutor: (action: UIActionSchema) => Promise<ActionResult>,
  ): Promise<TransactionResult> {
    const transactionId = generateId();
    const actions = config.actions || [];
    const maxRetries = config.maxRetries ?? this.maxRetries;
    const actionResults: ActionResult[] = [];

    this.operations = [];
    let completed = 0;
    let failed = 0;

    const emitProgress = (currentOp?: string) => {
      this.emitProgress({
        transactionName: config.name || transactionId,
        total: actions.length,
        completed,
        failed,
        percentage: actions.length > 0 ? ((completed + failed) / actions.length) * 100 : 0,
        currentOperation: currentOp,
      });
    };

    try {
      for (const action of actions) {
        emitProgress(action.label || action.name);

        let result: ActionResult | undefined;
        let lastError: string | undefined;

        // Retry loop for conflict handling
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            result = await actionExecutor(action);

            if (result.success) {
              break;
            } else {
              lastError = result.error;
              // Only retry on conflict if enabled
              if (config.retryOnConflict && attempt < maxRetries) {
                await delay(this.retryDelay * Math.pow(2, attempt));
                continue;
              }
              break;
            }
          } catch (error) {
            lastError = (error as Error).message;
            if (config.retryOnConflict && attempt < maxRetries) {
              await delay(this.retryDelay * Math.pow(2, attempt));
              continue;
            }
            result = { success: false, error: lastError };
            break;
          }
        }

        if (!result) {
          result = { success: false, error: lastError || 'Unknown error' };
        }

        actionResults.push(result);

        if (result.success) {
          completed++;
          emitProgress();
        } else {
          failed++;
          emitProgress();

          // Transaction failed - rollback previous operations
          await this.rollbackOperations();

          return {
            success: false,
            transactionId,
            actionResults,
            error: result.error || `Action "${action.name}" failed`,
            rolledBack: true,
          };
        }
      }

      return {
        success: true,
        transactionId,
        actionResults,
      };
    } catch (error) {
      await this.rollbackOperations();

      return {
        success: false,
        transactionId,
        actionResults,
        error: (error as Error).message,
        rolledBack: true,
      };
    }
  }

  /**
   * Apply an optimistic update to the UI and return a handle for confirmation/rollback.
   *
   * @example
   * ```ts
   * const update = manager.applyOptimisticUpdate({
   *   type: 'update',
   *   resource: 'orders',
   *   recordId: '123',
   *   optimisticData: { status: 'completed' },
   *   previousData: { status: 'pending' },
   * });
   *
   * try {
   *   await dataSource.update('orders', '123', { status: 'completed' });
   *   manager.confirmOptimisticUpdate(update.id);
   * } catch (error) {
   *   manager.rollbackOptimisticUpdate(update.id);
   * }
   * ```
   */
  applyOptimisticUpdate(params: {
    type: 'create' | 'update' | 'delete';
    resource: string;
    recordId?: string | number;
    optimisticData: Record<string, any>;
    previousData?: Record<string, any>;
  }): OptimisticUpdate {
    const update: OptimisticUpdate = {
      id: generateId(),
      type: params.type,
      resource: params.resource,
      recordId: params.recordId,
      optimisticData: params.optimisticData,
      previousData: params.previousData,
      confirmed: false,
      rolledBack: false,
    };

    this.optimisticUpdates.set(update.id, update);
    return update;
  }

  /**
   * Confirm an optimistic update (server operation succeeded)
   */
  confirmOptimisticUpdate(updateId: string): boolean {
    const update = this.optimisticUpdates.get(updateId);
    if (!update) return false;
    update.confirmed = true;
    return true;
  }

  /**
   * Rollback an optimistic update (server operation failed)
   * Returns the previous data that should be restored in the UI.
   */
  rollbackOptimisticUpdate(updateId: string): Record<string, any> | undefined {
    const update = this.optimisticUpdates.get(updateId);
    if (!update) return undefined;
    update.rolledBack = true;
    return update.previousData;
  }

  /**
   * Get all pending (unconfirmed, non-rolled-back) optimistic updates
   */
  getPendingUpdates(): OptimisticUpdate[] {
    return Array.from(this.optimisticUpdates.values()).filter(
      u => !u.confirmed && !u.rolledBack,
    );
  }

  /**
   * Clear all optimistic updates
   */
  clearOptimisticUpdates(): void {
    this.optimisticUpdates.clear();
  }

  /**
   * Execute a batch of data operations with progress tracking and retry.
   *
   * @example
   * ```ts
   * const results = await manager.executeBatch('orders', 'update', items, {
   *   onProgress: (event) => console.log(`${event.percentage}% complete`),
   * });
   * ```
   */
  async executeBatch<T = any>(
    resource: string,
    operation: 'create' | 'update' | 'delete',
    items: Partial<T>[],
    options?: {
      onProgress?: TransactionProgressCallback;
      retryOnError?: boolean;
      maxRetries?: number;
    },
  ): Promise<{
    success: boolean;
    results: T[];
    errors: Array<{ index: number; error: string }>;
    total: number;
    succeeded: number;
    failed: number;
  }> {
    const maxRetries = options?.maxRetries ?? this.maxRetries;
    const retryOnError = options?.retryOnError ?? true;
    const results: T[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    let completed = 0;
    let failed = 0;

    const emitProgress = (currentOp?: string) => {
      const event: TransactionProgressEvent = {
        transactionName: `batch-${operation}`,
        total: items.length,
        completed,
        failed,
        percentage: items.length > 0 ? ((completed + failed) / items.length) * 100 : 0,
        currentOperation: currentOp,
      };
      this.emitProgress(event);
      options?.onProgress?.(event);
    };

    // Try bulk operation first if available
    if (this.dataSource.bulk) {
      try {
        const bulkResult = await this.dataSource.bulk(resource, operation, items);
        return {
          success: true,
          results: bulkResult as T[],
          errors: [],
          total: items.length,
          succeeded: items.length,
          failed: 0,
        };
      } catch {
        // Fall through to individual processing
      }
    }

    // Individual processing with retry
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let lastError: string | undefined;
      let success = false;

      for (let attempt = 0; attempt <= (retryOnError ? maxRetries : 0); attempt++) {
        try {
          let result: any;
          switch (operation) {
            case 'create':
              result = await this.dataSource.create(resource, item);
              break;
            case 'update': {
              const id = (item as Record<string, any>).id;
              if (!id) throw new Error(`Missing ID for item at index ${i}`);
              result = await this.dataSource.update(resource, id, item);
              break;
            }
            case 'delete': {
              const deleteId = (item as Record<string, any>).id;
              if (!deleteId) throw new Error(`Missing ID for item at index ${i}`);
              await this.dataSource.delete(resource, deleteId);
              result = item;
              break;
            }
          }

          results.push(result);
          completed++;
          success = true;
          emitProgress();
          break;
        } catch (error) {
          lastError = (error as Error).message;
          if (retryOnError && attempt < maxRetries) {
            await delay(this.retryDelay * Math.pow(2, attempt));
            continue;
          }
        }
      }

      if (!success) {
        errors.push({ index: i, error: lastError || 'Unknown error' });
        failed++;
        emitProgress();
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
      total: items.length,
      succeeded: completed,
      failed,
    };
  }

  /**
   * Record an operation for potential rollback
   */
  recordOperation(op: TransactionOperation): void {
    this.operations.push(op);
  }

  /**
   * Rollback all recorded operations in reverse order
   */
  private async rollbackOperations(): Promise<void> {
    const ops = [...this.operations].reverse();

    for (const op of ops) {
      try {
        switch (op.type) {
          case 'create':
            // Undo create -> delete the created record
            if (op.result?.id) {
              await this.dataSource.delete(op.resource, op.result.id);
            }
            break;
          case 'update':
            // Undo update -> restore previous state
            if (op.id && op.previousState) {
              await this.dataSource.update(op.resource, op.id, op.previousState);
            }
            break;
          case 'delete':
            // Undo delete -> re-create with previous state
            if (op.previousState) {
              await this.dataSource.create(op.resource, op.previousState);
            }
            break;
        }
      } catch (error) {
        // Rollback errors are logged but don't throw
        console.error(`Rollback failed for ${op.type} on ${op.resource}:`, error);
      }
    }

    this.operations = [];
  }

  /**
   * Emit progress event to all listeners
   */
  private emitProgress(event: TransactionProgressEvent): void {
    for (const listener of this.progressListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in transaction progress listener:', error);
      }
    }
  }
}

// ==========================================================================
// Helpers
// ==========================================================================

/**
 * Generate a unique transaction ID using crypto when available
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `txn_${crypto.randomUUID()}`;
  }
  return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Promise-based delay
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
