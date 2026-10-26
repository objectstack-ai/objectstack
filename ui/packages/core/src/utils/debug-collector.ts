/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * DebugCollector — lightweight, tree-shakeable event collector
 * for perf / expression / action debug data.
 *
 * Usage in production is a no-op when the singleton is never imported.
 * Consumers call `DebugCollector.getInstance()` and subscribe via
 * `.subscribe()`.
 */

export interface PerfEntry {
  type: string;
  id?: string;
  durationMs: number;
  timestamp: number;
}

export interface ExprEntry {
  expression: string;
  result: unknown;
  context?: Record<string, unknown>;
  timestamp: number;
}

export interface EventEntry {
  action: string;
  payload?: unknown;
  timestamp: number;
}

export type DebugEntry =
  | { kind: 'perf'; data: PerfEntry }
  | { kind: 'expr'; data: ExprEntry }
  | { kind: 'event'; data: EventEntry };

type DebugSubscriber = (entry: DebugEntry) => void;

const MAX_ENTRIES = 200;

export class DebugCollector {
  private static instance: DebugCollector | null = null;

  private entries: DebugEntry[] = [];
  private subscribers = new Set<DebugSubscriber>();

  static getInstance(): DebugCollector {
    if (!DebugCollector.instance) {
      DebugCollector.instance = new DebugCollector();
    }
    return DebugCollector.instance;
  }

  /** Reset singleton — only used for testing */
  static resetInstance(): void {
    DebugCollector.instance = null;
  }

  addPerf(entry: PerfEntry): void {
    this.push({ kind: 'perf', data: entry });
  }

  addExpr(entry: ExprEntry): void {
    this.push({ kind: 'expr', data: entry });
  }

  addEvent(entry: EventEntry): void {
    this.push({ kind: 'event', data: entry });
  }

  getEntries(kind?: DebugEntry['kind']): DebugEntry[] {
    if (!kind) return this.entries.slice();
    return this.entries.filter((e) => e.kind === kind);
  }

  clear(): void {
    this.entries = [];
  }

  subscribe(fn: DebugSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private push(entry: DebugEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    for (const fn of this.subscribers) {
      try { fn(entry); } catch { /* subscriber errors must not break debug flow */ }
    }
  }
}
