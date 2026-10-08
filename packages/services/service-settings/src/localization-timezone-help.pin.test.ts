// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Default timezone help, as the platform SERVES it, is written for an
 * administrator: in every locale it names no formula-function identifier.
 *
 * An administrator meets this text under the timezone field in Settings →
 * Localization and in the first-run "set the workspace timezone" prompt. The
 * console renders `settings.localization.keys.timezone.help` from the bundle
 * this plugin loads into the i18n service, and falls back to the manifest's
 * `description` (served by `GET /api/settings/localization`) for a locale
 * with no entry. So this pin reads those two served layers, never the source
 * files:
 *
 *   1. what `SettingsServicePlugin` hands `i18n.loadTranslations` at
 *      `kernel:ready`, per locale, on a real `LiteKernel` boot;
 *   2. the manifest as the settings route answers it, from the service that
 *      boot registered.
 *
 * "Every locale" is whatever the plugin loads, so a locale added later is held
 * to this without an edit here; the floor below only stops the loop from
 * passing over nothing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsServicePlugin } from './settings-service-plugin.js';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';

const NAMESPACE = 'localization';
const KEY = 'timezone';

/** The locales the service ships today — a floor, not the population. */
const SHIPPED_LOCALES = ['en', 'zh-CN', 'ja-JP', 'es-ES'];

/**
 * A function identifier as a formula writes it: a name directly followed by
 * its opening parenthesis (`today(`), or a lowerCamelCase name (`daysFromNow`).
 * Prose never needs either; a parenthetical after a space (`name (e.g. …)`)
 * is not a call and does not match.
 */
const CALL_SHAPE = /[A-Za-z_$][A-Za-z0-9_$]*\(/;
const LOWER_CAMEL = /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/;

function functionIdentifiersIn(text: string): string[] {
  const found: string[] = [];
  const call = text.match(CALL_SHAPE);
  if (call) found.push(call[0]);
  const camel = text.match(LOWER_CAMEL);
  if (camel) found.push(camel[0]);
  return found;
}

/** Registers an `i18n` service that records every bundle it is handed. */
class I18nCapturePlugin implements Plugin {
  name = 'test.i18n-capture';
  version = '0.0.0';
  readonly loaded = new Map<string, Record<string, any>>();
  async init(ctx: PluginContext): Promise<void> {
    ctx.registerService('i18n', {
      loadTranslations: (locale: string, data: Record<string, any>) => {
        this.loaded.set(locale, data);
      },
    });
  }
}

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  get(path: string, h: RouteHandler) { this.routes.set(`GET ${path}`, h); return this as any; }
  post(path: string, h: RouteHandler) { this.routes.set(`POST ${path}`, h); return this as any; }
  put(path: string, h: RouteHandler) { this.routes.set(`PUT ${path}`, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.routes.set(`DELETE ${path}`, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.routes.set(`PATCH ${path}`, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

let kernel: LiteKernel;
let capture: I18nCapturePlugin;
let servedDescription: unknown;

beforeAll(async () => {
  capture = new I18nCapturePlugin();
  kernel = new LiteKernel({ logger: { level: 'error' } as never });
  // The plugin's own defaults: the bundled manifests and translations, exactly
  // as a host that mounts it without options serves them.
  kernel.use(capture);
  kernel.use(new SettingsServicePlugin({ registerRoutes: false, env: {} }));
  await kernel.bootstrap();

  // The route the console's Localization page and the prompt read, mounted on
  // the service that boot registered, for an administrator holding the
  // namespace's read capability.
  const http = new MockHttp();
  registerSettingsRoutes(http, kernel.getService<SettingsService>('settings'), {
    contextFromRequest: () => ({ enforced: true, permissions: ['setup.access'] }),
  });
  const state: { status: number; body?: any } = { status: 200 };
  const res = {
    json: vi.fn((data: unknown) => { state.body = data; }),
    send: vi.fn(),
    status: vi.fn((code: number) => { state.status = code; return res; }),
    header: vi.fn(() => res),
  } as unknown as IHttpResponse;
  await http.routes.get('GET /api/settings/:namespace')!(
    { params: { namespace: NAMESPACE }, query: {}, headers: {}, method: 'GET', path: `/api/settings/${NAMESPACE}` } as IHttpRequest,
    res,
  );
  expect(state.status).toBe(200);
  const specifiers = (state.body?.data?.manifest?.specifiers ?? []) as Array<{ key?: string; description?: unknown }>;
  servedDescription = specifiers.find((s) => s.key === KEY)?.description;
});

afterAll(async () => {
  await kernel?.shutdown();
});

describe('the served Default timezone help names no function identifier', () => {
  it('the detector flags the developer wording it exists to keep out', () => {
    // Without this a detector that matches nothing passes every case below.
    expect(functionIdentifiersIn('IANA zone for today()/daysFromNow, analytics date buckets.'))
      .toEqual(['today(', 'daysFromNow']);
  });

  it('the plugin loads a bundle for every shipped locale', () => {
    expect([...capture.loaded.keys()]).toEqual(expect.arrayContaining(SHIPPED_LOCALES));
  });

  it('the manifest description served by GET /api/settings/localization', () => {
    expect(typeof servedDescription).toBe('string');
    expect((servedDescription as string).trim()).not.toBe('');
    expect(functionIdentifiersIn(servedDescription as string)).toEqual([]);
  });

  it('the translated help, in every locale the plugin loads', () => {
    expect(capture.loaded.size).toBeGreaterThanOrEqual(SHIPPED_LOCALES.length);
    for (const [locale, bundle] of capture.loaded) {
      const help = bundle?.settings?.[NAMESPACE]?.keys?.[KEY]?.help;
      // Present in every locale: a dropped entry would fall back to the
      // manifest literal and turn this loop into a pass over nothing.
      expect(typeof help, `${locale}: settings.${NAMESPACE}.keys.${KEY}.help`).toBe('string');
      expect(functionIdentifiersIn(help), `${locale}: ${help}`).toEqual([]);
    }
  });
});
