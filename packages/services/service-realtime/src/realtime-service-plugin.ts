// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { SysPresence } from './objects/index.js';
import { InMemoryRealtimeAdapter } from './in-memory-realtime-adapter.js';
import type { InMemoryRealtimeAdapterOptions } from './in-memory-realtime-adapter.js';

/**
 * Configuration options for the RealtimeServicePlugin.
 */
export interface RealtimeServicePluginOptions {
  /** Realtime adapter type (default: 'memory') */
  adapter?: 'memory';
  /** Options for the in-memory adapter */
  memory?: InMemoryRealtimeAdapterOptions;
}

/**
 * RealtimeServicePlugin — Production IRealtimeService implementation.
 *
 * Registers a realtime pub/sub service with the kernel during the init phase.
 * Currently supports in-memory pub/sub for single-process environments.
 *
 * @example
 * ```ts
 * import { ObjectKernel } from '@objectstack/core';
 * import { RealtimeServicePlugin } from '@objectstack/service-realtime';
 *
 * const kernel = new ObjectKernel();
 * kernel.use(new RealtimeServicePlugin());
 * await kernel.bootstrap();
 *
 * const realtime = kernel.getService('realtime');
 * await realtime.subscribe('records', (event) => {
 *   console.log(event.type, event.payload);
 * });
 * ```
 */
export class RealtimeServicePlugin implements Plugin {
  name = 'com.objectstack.service.realtime';
  version = '1.0.0';
  type = 'standard';
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: RealtimeServicePluginOptions;

  constructor(options: RealtimeServicePluginOptions = {}) {
    this.options = { adapter: 'memory', ...options };
  }

  async init(ctx: PluginContext): Promise<void> {
    const realtime = new InMemoryRealtimeAdapter(this.options.memory);
    ctx.registerService('realtime', realtime);

    // Register realtime system objects via the manifest service.
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: 'com.objectstack.service.realtime',
      name: 'Realtime Service',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      namespace: 'sys',
      objects: [SysPresence],
    });

    // ADR-0029 D8 — contribute sys_presence translations on kernel:ready.
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', async () => {
        try {
          const i18n = ctx.getService<any>('i18n');
          if (i18n && typeof i18n.loadTranslations === 'function') {
            const { RealtimeTranslations } = await import('./translations/index.js');
            for (const [locale, data] of Object.entries(RealtimeTranslations)) {
              i18n.loadTranslations(locale, data as Record<string, unknown>);
            }
          }
        } catch { /* i18n optional */ }
      });
    }

    ctx.logger.info('RealtimeServicePlugin: registered in-memory realtime adapter');
  }
}
