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
 *   - boot backfill (`kernel:bootstrapped`): fill rows that predate the
 *     switch or arrived via hook-bypassing writes;
 *   - `rebuildSearchCompanion` (exported): explicit reconcile/rebuild entry.
 *
 * When the flag is off the plugin is inert: no hooks, no backfill, and
 * `pinyin-pro` is never imported.
 */

// `IObjectQLEngine` via the core barrel, which re-exports it from
// `@objectstack/spec/contracts`: this package does not depend on spec directly,
// and the slot's contract is not a reason to add a dependency.
import type { IObjectQLEngine, Plugin, PluginContext } from '@objectstack/core';
import { resolveSearchPinyinEnabled } from '@objectstack/types';
import {
  bindSearchCompanionHooks,
  backfillSearchCompanion,
} from './companion-projection.js';

export interface PinyinSearchPluginOptions {
  /**
   * Force-enable/disable regardless of `OS_SEARCH_PINYIN_ENABLED` (tests /
   * embedders). Default: `resolveSearchPinyinEnabled()`.
   */
  enabled?: boolean;
  /** Skip the boot backfill (default: run it once per boot). */
  backfill?: boolean;
}

export class PinyinSearchPlugin implements Plugin {
  name = 'com.objectstack.plugin.pinyin-search';
  version = '1.0.0';
  type = 'standard';
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: PinyinSearchPluginOptions;

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

    // Backfill AFTER boot settles (`kernel:bootstrapped` fires once every
    // `kernel:ready` hook — including seed loading — has completed), so
    // seeded rows written before/around hook binding are reconciled too.
    if (this.options.backfill !== false) {
      ctx.hook('kernel:bootstrapped', async () => {
        const engine = this.resolveEngine(ctx);
        if (!engine) return;
        try {
          await backfillSearchCompanion(engine, ctx.logger as any);
        } catch (err: any) {
          ctx.logger.warn('PinyinSearchPlugin: companion backfill failed', { error: err?.message });
        }
      });
    }
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
