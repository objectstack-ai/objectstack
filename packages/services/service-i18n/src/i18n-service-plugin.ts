// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { wireAuthoredTranslationSync } from '@objectstack/core';
import { FileI18nAdapter } from './file-i18n-adapter.js';
import type { FileI18nAdapterOptions } from './file-i18n-adapter.js';

/**
 * Configuration options for the I18nServicePlugin.
 *
 * [#23347] `registerRoutes` and `basePath` are gone: they drove this plugin's
 * own `/api/v1/i18n/*` mounts, and those mounts are retired (see the class
 * docblock). Nothing else ever read them.
 */
export interface I18nServicePluginOptions {
  /** Default locale (default: 'en') */
  defaultLocale?: string;
  /** Directory containing locale JSON files */
  localesDir?: string;
  /** Fallback locale for missing translations */
  fallbackLocale?: string;
}

/**
 * I18nServicePlugin — Production II18nService implementation.
 *
 * Registers the `i18n` service with the kernel during the init phase and
 * wires the runtime-authored translation sync in start. It mounts NO HTTP
 * route.
 *
 * ## Who serves `/api/v1/i18n/*` — one owner (#23347, ADR-0076 D11)
 *
 * The dispatcher bridge (`createDispatcherPlugin` in `@objectstack/runtime`)
 * registers the three i18n paths in its `start()` and answers them through the
 * dispatcher's `/i18n` domain (`packages/runtime/src/domains/i18n.ts`), which
 * reads WHICHEVER provider fills the `i18n` slot: this plugin's adapter, or the
 * in-memory fallback. That domain also enforces the authenticated-caller floor
 * (ADR-0056 D2, authz row `anonymous-deny-i18n`). The slot is multi-provider,
 * so the route bridges to the slot, not to a package.
 *
 * This plugin used to register the same three patterns a second time, in a
 * `kernel:ready` hook. Measured on `objectstack serve` over
 * `examples/app-showcase` (#23347): both registrations were mounted and every
 * request reached the dispatcher's, because it registers first (Phase 2
 * `start()` before Phase 3 `kernel:ready`) and the Hono adapter answers a
 * duplicate path with its first registration. The second copy was code that
 * grep finds and the runtime never runs on that composition, and on a
 * composition with an HTTP server but no dispatcher bridge it answered with
 * no authenticated-caller floor at all. It is retired, not kept in parity:
 * one route, one owner (AGENTS.md, Route & surface ownership rule 1).
 * ⛔ Do not re-add an HTTP mount here — mount the capability through the
 * dispatcher's domain instead.
 *
 * @example
 * ```ts
 * import { ObjectKernel } from '@objectstack/core';
 * import { I18nServicePlugin } from '@objectstack/service-i18n';
 *
 * const kernel = new ObjectKernel();
 * kernel.use(new I18nServicePlugin({
 *   defaultLocale: 'en',
 *   localesDir: './i18n',
 *   fallbackLocale: 'en',
 * }));
 * await kernel.bootstrap();
 *
 * const i18n = kernel.getService('i18n');
 * i18n.t('objects.account.label', 'en'); // 'Account'
 * ```
 */
export class I18nServicePlugin implements Plugin {
  name = 'com.objectstack.service.i18n';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['i18n'];
  version = '1.0.0';
  type = 'standard' as const;

  private readonly options: I18nServicePluginOptions;

  constructor(options: I18nServicePluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    const adapterOptions: FileI18nAdapterOptions = {
      defaultLocale: this.options.defaultLocale,
      localesDir: this.options.localesDir,
      fallbackLocale: this.options.fallbackLocale,
    };

    const i18n = new FileI18nAdapter(adapterOptions);
    ctx.registerService('i18n', i18n);
    ctx.logger.info(
      `I18nServicePlugin: registered file-based i18n adapter (default: ${i18n.getDefaultLocale?.() ?? 'en'})`,
    );
  }

  async start(ctx: PluginContext): Promise<void> {
    // ── Runtime-authored translations (#2591) ──────────────────────────
    // Translations authored in the Studio persist as `translation` metadata
    // (`allowRuntimeCreate: true`) but only static bundles were ever loaded
    // — a published translation was a dead-end on publish AND after restart.
    // The shared core sync (`wireAuthoredTranslationSync`) loads the authored
    // layer at `kernel:ready`, on `metadata:reloaded`, and on `translation`
    // protocol mutations, replacing it wholesale via the adapter's
    // `replaceAuthoredTranslations` (clear-then-reload — deleted keys stop
    // resolving). The runtime's AppPlugin wires the same sync for kernels
    // running the in-memory fallback adapter; the ownership marker inside
    // makes double-wiring a no-op.
    wireAuthoredTranslationSync(ctx as any);
  }
}
