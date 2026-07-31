// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { wireAuthoredTranslationSync } from '@objectstack/core';
import type { IHttpServer, IHttpRequest, IHttpResponse } from '@objectstack/spec/contracts';
import type { II18nService } from '@objectstack/spec/contracts';
import type { TranslationData } from '@objectstack/spec/system';
import { resolveObjectFieldLabels, toLocaleDescriptors } from '@objectstack/spec/system';
// The declared envelope is written in ONE place for the whole platform (#3973).
import { sendOk, sendError } from '@objectstack/types';
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
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['i18n'];
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
   * Routes (ledgered in `i18n-route-ledger.ts`, guarded by
   * `i18n-route-ledger.conformance.test.ts` — #3636):
   * - GET /api/v1/i18n/locales           → list available locales
   * - GET /api/v1/i18n/translations/:locale → get translations for a locale
   * - GET /api/v1/i18n/labels/:object/:locale → get field labels for an object
   *
   * Success bodies carry the `{ success: true, data }` BaseResponse envelope
   * the `i18n` route group declares (`plugin-rest-api.zod.ts` →
   * `response_envelope`), matching what the dispatcher's `/i18n` domain emits
   * for the same three shapes. They used to omit the `success` flag, which is
   * the flag `ObjectStackClient.unwrapResponse` keys on — so the SDK handed
   * callers the raw `{ data: … }` wrapper against THIS provider while
   * returning the declared unwrapped shape against the dispatcher. Same
   * method, two shapes, decided by which plugin happened to mount the route
   * (#3636). `data` did not move, so direct body readers are unaffected.
   *
   * Error bodies now carry the matching `{ success: false, error: { code,
   * message } }` half via `sendError` (#3675). That was left out of #3636
   * because only the success bodies broke `unwrapResponse`, and unlike the
   * success fix it is NOT additive — `error` goes from string to object.
   */
  private registerI18nRoutes(httpServer: IHttpServer, ctx: PluginContext): void {
    if (!this.i18n) return;

    const basePath = this.options.basePath || '/api/v1/i18n';
    const i18n = this.i18n;

    // GET /i18n/locales
    httpServer.get(`${basePath}/locales`, async (_req: IHttpRequest, res: IHttpResponse) => {
      try {
        // Same shared mapping the dispatcher's `/i18n` domain uses — the two
        // surfaces serve this route interchangeably, and each holding its own
        // copy is what let them answer in different shapes (#3833's lesson,
        // one route over).
        const locales = toLocaleDescriptors(i18n.getLocales(), i18n.getDefaultLocale?.() ?? 'en');
        sendOk(res, { locales });
      } catch (error: any) {
        sendError(res, 500, 'INTERNAL', error?.message ?? 'Internal error');
      }
    });

    // GET /i18n/translations/:locale
    httpServer.get(`${basePath}/translations/:locale`, async (req: IHttpRequest, res: IHttpResponse) => {
      try {
        const locale = req.params.locale;
        if (!locale) {
          sendError(res, 400, 'INVALID_REQUEST', 'Missing locale parameter');
          return;
        }
        const translations = i18n.getTranslations(locale);
        sendOk(res, { locale, translations });
      } catch (error: any) {
        sendError(res, 500, 'INTERNAL', error?.message ?? 'Internal error');
      }
    });

    // GET /i18n/labels/:object/:locale
    httpServer.get(`${basePath}/labels/:object/:locale`, async (req: IHttpRequest, res: IHttpResponse) => {
      try {
        const objectName = req.params.object;
        const locale = req.params.locale;
        if (!objectName || !locale) {
          sendError(res, 400, 'INVALID_REQUEST', 'Missing object or locale parameter');
          return;
        }
        // Some implementations may provide a dedicated getFieldLabels method.
        // [#4127] Was `'getFieldLabels' in i18n` plus two casts — one through
        // `Record<string, unknown>`, one re-declaring the signature inline —
        // because `II18nService` did not declare the method both this mount
        // and the dispatcher's were probing for. It does now, so the probe is
        // a plain optional-method check and the signature has one home.
        if (typeof i18n.getFieldLabels === 'function') {
          const labels = i18n.getFieldLabels(objectName, locale);
          sendOk(res, { object: objectName, locale, labels });
        } else {
          // Fallback: read field labels out of the locale's translation data.
          // That data is NESTED (`objects.<obj>.fields.<field>.label`) — the
          // flat dotted `o.<obj>.fields.<field>` keys this used to scan were a
          // third translation dialect that no producer ever wrote, so the
          // fallback always returned `{}` (#3778). The derivation now lives in
          // `resolveObjectFieldLabels` so the dispatcher's copy of it cannot
          // drift out of shape again the way it did after that fix (#3833).
          const data = i18n.getTranslations(locale) as TranslationData | undefined;
          const labels = resolveObjectFieldLabels(data, objectName);
          sendOk(res, { object: objectName, locale, labels });
        }
      } catch (error: any) {
        sendError(res, 500, 'INTERNAL', error?.message ?? 'Internal error');
      }
    });

    ctx.logger.info(`I18n routes registered: ${basePath}/locales, ${basePath}/translations/:locale, ${basePath}/labels/:object/:locale`);
  }
}
