// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { wireAuthoredTranslationSync } from '@objectstack/core';
import type { IHttpServer, IHttpRequest, IHttpResponse } from '@objectstack/spec/contracts';
import type { II18nService } from '@objectstack/spec/contracts';
import { FileI18nAdapter } from './file-i18n-adapter.js';
import type { FileI18nAdapterOptions } from './file-i18n-adapter.js';

/**
 * Configuration options for the I18nServicePlugin.
 */
export interface I18nServicePluginOptions {
  /** Default locale (default: 'en') */
  defaultLocale?: string;
  /** Directory containing locale JSON files */
  localesDir?: string;
  /** Fallback locale for missing translations */
  fallbackLocale?: string;
  /**
   * Whether to automatically register i18n REST routes with the HTTP server.
   * When true (default), the plugin registers `/api/v1/i18n/*` endpoints
   * via the `kernel:ready` hook. When false or no HTTP server is available,
   * routes are skipped but the i18n service is still available via the kernel.
   * @default true
   */
  registerRoutes?: boolean;
  /**
   * Base path for i18n REST routes.
   * @default '/api/v1/i18n'
   */
  basePath?: string;
}

/**
 * I18nServicePlugin — Production II18nService implementation.
 *
 * Registers an i18n service with the kernel during the init phase,
 * and self-registers REST endpoints (`/api/v1/i18n/*`) with the HTTP
 * server during the `kernel:ready` hook.
 *
 * REST route self-registration follows the same autonomous plugin pattern
 * used by AuthPlugin, WorkflowPlugin, and other service plugins — RestServer
 * is not involved.
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
  version = '1.0.0';
  type = 'standard';

  private readonly options: I18nServicePluginOptions;
  private i18n: II18nService | null = null;

  constructor(options: I18nServicePluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    const adapterOptions: FileI18nAdapterOptions = {
      defaultLocale: this.options.defaultLocale,
      localesDir: this.options.localesDir,
      fallbackLocale: this.options.fallbackLocale,
    };

    this.i18n = new FileI18nAdapter(adapterOptions);
    ctx.registerService('i18n', this.i18n);
    ctx.logger.info(
      `I18nServicePlugin: registered file-based i18n adapter (default: ${this.i18n.getDefaultLocale?.() ?? 'en'})`,
    );
  }

  async start(ctx: PluginContext): Promise<void> {
    // Defer HTTP route registration to kernel:ready hook.
    // This ensures all plugins (including HonoServerPlugin) have completed
    // their init and start phases before we attempt to look up the
    // http-server service — making I18nServicePlugin resilient to plugin
    // loading order.
    if (this.options.registerRoutes !== false) {
      ctx.hook('kernel:ready', async () => {
        let httpServer: IHttpServer | null = null;
        try {
          httpServer = ctx.getService<IHttpServer>('http-server');
        } catch {
          // Service not found — expected in MSW/mock mode
        }

        if (httpServer) {
          this.registerI18nRoutes(httpServer, ctx);
        } else {
          ctx.logger.warn(
            'No HTTP server available — i18n routes not registered. ' +
            'i18n service is still available programmatically via kernel.getService("i18n").'
          );
        }
      });
    }

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

  /**
   * Register i18n REST routes with the HTTP server.
   *
   * Routes:
   * - GET /api/v1/i18n/locales           → list available locales
   * - GET /api/v1/i18n/translations/:locale → get translations for a locale
   * - GET /api/v1/i18n/labels/:object/:locale → get field labels for an object
   */
  private registerI18nRoutes(httpServer: IHttpServer, ctx: PluginContext): void {
    if (!this.i18n) return;

    const basePath = this.options.basePath || '/api/v1/i18n';
    const i18n = this.i18n;

    // GET /i18n/locales
    httpServer.get(`${basePath}/locales`, async (_req: IHttpRequest, res: IHttpResponse) => {
      try {
        const locales = i18n.getLocales();
        const defaultLocale = i18n.getDefaultLocale?.() ?? 'en';
        res.json({
          data: {
            locales: locales.map((code) => ({
              code,
              label: code,
              isDefault: code === defaultLocale,
            })),
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // GET /i18n/translations/:locale
    httpServer.get(`${basePath}/translations/:locale`, async (req: IHttpRequest, res: IHttpResponse) => {
      try {
        const locale = req.params.locale;
        if (!locale) {
          res.status(400).json({ error: 'Missing locale parameter' });
          return;
        }
        const translations = i18n.getTranslations(locale);
        res.json({ data: { locale, translations } });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // GET /i18n/labels/:object/:locale
    httpServer.get(`${basePath}/labels/:object/:locale`, async (req: IHttpRequest, res: IHttpResponse) => {
      try {
        const objectName = req.params.object;
        const locale = req.params.locale;
        if (!objectName || !locale) {
          res.status(400).json({ error: 'Missing object or locale parameter' });
          return;
        }
        // Some implementations may provide a dedicated getFieldLabels method
        const hasGetFieldLabels = 'getFieldLabels' in i18n
          && typeof (i18n as Record<string, unknown>)['getFieldLabels'] === 'function';
        if (hasGetFieldLabels) {
          const labels = (i18n as II18nService & { getFieldLabels(obj: string, loc: string): Record<string, string> })
            .getFieldLabels(objectName, locale);
          res.json({ data: { object: objectName, locale, labels } });
        } else {
          // Fallback: derive field labels from full translation bundle
          const translations = i18n.getTranslations(locale);
          const prefix = `o.${objectName}.fields.`;
          const labels: Record<string, string> = {};
          for (const [key, value] of Object.entries(translations)) {
            if (key.startsWith(prefix)) {
              labels[key.substring(prefix.length)] = value as string;
            }
          }
          res.json({ data: { object: objectName, locale, labels } });
        }
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    ctx.logger.info(`I18n routes registered: ${basePath}/locales, ${basePath}/translations/:locale, ${basePath}/labels/:object/:locale`);
  }
}
