// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PinyinSearchPlugin (#2486) — pinyin recall for `$search`.
 *
 * Pure hook plugin: the `__search` companion column is declared at object
 * compile time by the SchemaRegistry (gated on the SAME
 * `OS_SEARCH_PINYIN_ENABLED` decision point), the engine ORs it into the
 * `$search` filter, and this plugin fills the value:
 *
 *   - before-save hooks: recompute full pinyin + initials of the
 *     display/name field when it changes;
 *   - boot reconcile (started at `kernel:bootstrapped`, NOT awaited there —
 *     #25634): fill rows that predate the switch or arrived via
 *     hook-bypassing writes, reading only what changed since the last
 *     completed pass (`boot-reconcile.ts`);
 *   - `rebuildSearchCompanion` (exported): explicit reconcile/rebuild entry.
 *
 * When the flag is off the plugin is inert: no hooks, no backfill, and
 * `pinyin-pro` is never imported.
 */

// `IObjectQLEngine` via the core barrel, which re-exports it from
// `@objectstack/spec/contracts`: the slot's contract is not a reason to import
// spec here (the reconcile receipt's row contract is, in `boot-reconcile.ts`).
import type { IObjectQLEngine, Plugin, PluginContext } from '@objectstack/core';
import { resolveSearchPinyinEnabled } from '@objectstack/types';
import { bindSearchCompanionHooks } from './companion-projection.js';
import { reconcileSearchCompanion } from './boot-reconcile.js';

export interface PinyinSearchPluginOptions {
  /**
   * Force-enable/disable regardless of `OS_SEARCH_PINYIN_ENABLED` (tests /
   * embedders). Default: `resolveSearchPinyinEnabled()`.
   */
  enabled?: boolean;
  /** Skip the boot reconcile (default: run it once per boot, after readiness). */
  backfill?: boolean;
}

export class PinyinSearchPlugin implements Plugin {
  name = 'com.objectstack.plugin.pinyin-search';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: PinyinSearchPluginOptions;
  /** The in-flight boot reconcile, so `destroy()` can stop and await it. */
  private reconcile: { abort: AbortController; done: Promise<void> } | null = null;

  constructor(options: PinyinSearchPluginOptions = {}) {
    this.options = options;
  }

  private get enabled(): boolean {
    return this.options.enabled ?? resolveSearchPinyinEnabled();
  }

  async init(_ctx: PluginContext): Promise<void> {
    // Nothing to register: the companion column is provisioned by the
    // SchemaRegistry's compile-time seam, not injected at runtime.
  }

  async start(ctx: PluginContext): Promise<void> {
    if (!this.enabled) {
      ctx.logger.debug?.('PinyinSearchPlugin: OS_SEARCH_PINYIN_ENABLED is off — inert');
      return;
    }

    ctx.hook('kernel:ready', async () => {
      const engine = this.resolveEngine(ctx);
      if (!engine) {
        ctx.logger.warn('PinyinSearchPlugin: no ObjectQL engine — companion hooks NOT bound');
        return;
      }
      try {
        bindSearchCompanionHooks(engine, ctx.logger as any);
      } catch (err: any) {
        ctx.logger.warn('PinyinSearchPlugin: companion hooks not bound', { error: err?.message });
      }
    });

    // Reconcile AFTER boot settles (`kernel:bootstrapped` fires once every
    // `kernel:ready` hook — including seed loading — has completed), so
    // seeded rows written before/around hook binding are reconciled too.
    //
    // [#25634] Started here, NOT awaited here. The kernel awaits every
    // `kernel:bootstrapped` handler before `kernel:listening`, the cue the
    // HTTP server opens its socket on, so an awaited walk held readiness for
    // as long as the largest companion-bearing table took to read (6.7 M
    // `sys_inbox_message` rows: about 4 min 50 s). Writes made meanwhile are
    // stamped by the hooks bound at `kernel:ready`; the reconcile only fills
    // rows those hooks never saw. Its failure is logged, never swallowed, and
    // `destroy()` stops it between pages.
    if (this.options.backfill !== false) {
      ctx.hook('kernel:bootstrapped', async () => {
        const engine = this.resolveEngine(ctx);
        if (!engine) return;
        const abort = new AbortController();
        const done = reconcileSearchCompanion(engine as any, ctx.logger as any, { signal: abort.signal })
          .then(
            (result) => {
              ctx.logger.debug?.('PinyinSearchPlugin: companion reconcile finished', result as any);
            },
            (err: any) => {
              ctx.logger.warn('PinyinSearchPlugin: companion reconcile failed — rows written by hook-bypassing ' +
                'writers may stay unsearchable by pinyin until the next boot or rebuildSearchCompanion()', {
                error: err?.message,
              });
            },
          )
          .finally(() => {
            if (this.reconcile?.done === done) this.reconcile = null;
          });
        this.reconcile = { abort, done };
      });
    }
  }

  /** The in-flight boot reconcile's completion, for hosts and tests; resolved when none runs. */
  whenReconciled(): Promise<void> {
    return this.reconcile?.done ?? Promise.resolve();
  }

  async destroy(): Promise<void> {
    const running = this.reconcile;
    if (!running) return;
    running.abort.abort();
    await running.done;
  }

  /**
   * [#4251 B5] The engine SEEN WHOLE — `bindSearchCompanionHooks` binds
   * `registerHook`, which lives on `IObjectQLEngine`, not on the data plane.
   * The ledger records `objectql` as "the SAME instance as `data`, seen whole",
   * so the alias fallback resolves the same object under the same contract.
   */
  private resolveEngine(ctx: PluginContext): IObjectQLEngine | null {
    try {
      return ctx.getService<IObjectQLEngine>('objectql');
    } catch {
      try {
        return ctx.getService<IObjectQLEngine>('data');
      } catch {
        return null;
      }
    }
  }
}
