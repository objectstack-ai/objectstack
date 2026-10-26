/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Undo Manager
 *
 * Global undo/redo system for CRUD operations. Class-based singleton
 * pattern for use from ActionRunner, React hooks, and standalone contexts.
 * Maintains bounded history stacks with subscriber notifications.
 */

import type { UndoableOperation } from '@object-ui/types';

/**
 * A single undoable CRUD operation — declared once, in `@object-ui/types`
 * (objectui#6349, batch 4), beside the `ActionResult` whose `undo` member it
 * types, and re-exported here so an import from `@object-ui/core` keeps
 * resolving to the same type.
 */
export type { UndoableOperation } from '@object-ui/types';

export interface UndoManagerOptions {
  /** Maximum number of operations to retain in history. @default 50 */
  maxHistory?: number;
}

/** Type guard validating the required shape of a persisted UndoableOperation. */
function isValidOperation(op: unknown): op is UndoableOperation {
  if (typeof op !== 'object' || op === null) return false;
  const o = op as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.type === 'string' &&
    typeof o.objectName === 'string' &&
    typeof o.recordId === 'string' &&
    typeof o.timestamp === 'number'
  );
}

/**
 * Manages undo/redo stacks for CRUD operations.
 *
 * Designed as a framework-agnostic class so it can be used from
 * ActionRunner, React hooks, or any other consumer.
 */
export class UndoManager {
  private undoStack: UndoableOperation[] = [];
  private redoStack: UndoableOperation[] = [];
  private readonly maxHistory: number;
  private listeners: Set<() => void> = new Set();

  constructor(options?: UndoManagerOptions) {
    this.maxHistory = options?.maxHistory ?? 50;
  }

  /** Record an undoable operation. Clears the redo stack. */
  push(operation: UndoableOperation): void {
    this.undoStack.push(operation);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.notify();
  }

  /** Peek at the next undoable operation without removing it. */
  peekUndo(): UndoableOperation | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  /** Peek at the next redoable operation without removing it. */
  peekRedo(): UndoableOperation | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  /** Pop the last operation from the undo stack and move it to redo. */
  popUndo(): UndoableOperation | undefined {
    const op = this.undoStack.pop();
    if (op) {
      this.redoStack.push(op);
      this.notify();
    }
    return op;
  }

  /** Pop the last operation from the redo stack and move it to undo. */
  popRedo(): UndoableOperation | undefined {
    const op = this.redoStack.pop();
    if (op) {
      this.undoStack.push(op);
      this.notify();
    }
    return op;
  }

  /** Clear all undo and redo history. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoCount(): number { return this.undoStack.length; }
  get redoCount(): number { return this.redoStack.length; }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Get a shallow copy of the undo history (for developer tools). */
  getHistory(): UndoableOperation[] { return [...this.undoStack]; }

  /** Get a shallow copy of the redo history (for developer tools). */
  getRedoHistory(): UndoableOperation[] { return [...this.redoStack]; }

  // ---------------------------------------------------------------------------
  // Batch operations
  // ---------------------------------------------------------------------------

  /** Push multiple operations as one atomic unit. Clears the redo stack. */
  pushBatch(operations: UndoableOperation[]): void {
    if (operations.length === 0) return;
    this.undoStack.push(...operations);
    // Trim from the front if we exceed maxHistory
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.splice(0, this.undoStack.length - this.maxHistory);
    }
    this.redoStack = [];
    this.notify();
  }

  /** Pop `count` operations from the undo stack and move them to redo (LIFO order). */
  popUndoBatch(count: number): UndoableOperation[] {
    const actual = Math.min(count, this.undoStack.length);
    if (actual === 0) return [];
    const ops = this.undoStack.splice(this.undoStack.length - actual, actual);
    // Preserve LIFO order on the redo stack (last undone goes on top)
    this.redoStack.push(...ops);
    this.notify();
    return ops;
  }

  /** Pop `count` operations from the redo stack and move them to undo (LIFO order). */
  popRedoBatch(count: number): UndoableOperation[] {
    const actual = Math.min(count, this.redoStack.length);
    if (actual === 0) return [];
    const ops = this.redoStack.splice(this.redoStack.length - actual, actual);
    this.undoStack.push(...ops);
    this.notify();
    return ops;
  }

  // ---------------------------------------------------------------------------
  // Persistence (localStorage)
  // ---------------------------------------------------------------------------

  private static readonly STORAGE_KEY = 'objectui:undo-history';

  /** Persist the current undo/redo stacks to localStorage. */
  saveToStorage(): void {
    try {
      const payload = JSON.stringify({
        undoStack: this.undoStack,
        redoStack: this.redoStack,
      });
      localStorage.setItem(UndoManager.STORAGE_KEY, payload);
    } catch {
      // localStorage may be unavailable (SSR, quota exceeded, etc.)
    }
  }

  /** Restore undo/redo stacks from localStorage (no-op when unavailable). */
  loadFromStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(UndoManager.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        undoStack?: UndoableOperation[];
        redoStack?: UndoableOperation[];
      };
      if (Array.isArray(parsed.undoStack)) {
        this.undoStack = parsed.undoStack.filter(isValidOperation);
      }
      if (Array.isArray(parsed.redoStack)) {
        this.redoStack = parsed.redoStack.filter(isValidOperation);
      }
      // Enforce maxHistory in case persisted state used a different limit
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.splice(0, this.undoStack.length - this.maxHistory);
      }
      this.notify();
    } catch {
      // Silently ignore parse errors or missing storage
    }
  }

  private notify(): void { this.listeners.forEach((fn) => fn()); }
}

/** Global singleton instance. */
export const globalUndoManager = new UndoManager();
