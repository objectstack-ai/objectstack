// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup's 默认语言 (`localization.locale`) offers and accepts the languages
 * the deployment supports: the i18n service's locale list, the one the user's
 * language menu reads (`GET /api/v1/i18n/locales`), not four codes written
 * into the manifest.
 *
 * Pinned on a real `LiteKernel` boot of `SettingsServicePlugin`, through the
 * settings routes the Localization page reads and saves through, so the
 * wiring, the served manifest and the save's acceptance are one path. The
 * i18n service is a stand-in whose locale list the cases change at runtime,
 * the way an added translation item grows it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsServicePlugin } from './settings-service-plugin.js';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { localizationSettingsManifest } from './manifests/localization.manifest.js';
import { localeSelfName, localizationLocaleOptionSource, notOfferedCopy } from './localization-locale-options.js';

/** An i18n service whose reported locale list each case sets. */
class LocaleListI18nPlugin implements Plugin {
  name = 'test.locale-list-i18n';
  version = '0.0.0';
  locales: string[] = [];
  async init(ctx: PluginContext): Promise<void> {
    ctx.registerService('i18n', {
      loadTranslations: () => {},
      getLocales: () => [...this.locales],
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

async function call(
  http: MockHttp,
  route: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const state: { status: number; body?: any } = { status: 200 };
  const res = {
    json: vi.fn((data: unknown) => { state.body = data; }),
    send: vi.fn(),
    status: vi.fn((code: number) => { state.status = code; return res; }),
    header: vi.fn(() => res),
  } as unknown as IHttpResponse;
  const req = {
    params: { namespace: 'localization' },
    query: {},
    body: opts.body,
    headers: opts.headers ?? {},
    method: route.split(' ')[0],
    path: '/api/settings/localization',
  } as IHttpRequest;
  await http.routes.get(route)!(req, res);
  return { status: state.status, body: state.body };
}

const admin = () => ({ enforced: true, permissions: ['setup.access', 'setup.write'], userId: 'usr_admin' });

async function boot(env: Record<string, string> = {}): Promise<{
  kernel: LiteKernel;
  i18n: LocaleListI18nPlugin;
  service: SettingsService;
  http: MockHttp;
}> {
  const i18n = new LocaleListI18nPlugin();
  const kernel = new LiteKernel({ logger: { level: 'error' } as never });
  kernel.use(i18n);
  kernel.use(new SettingsServicePlugin({ registerRoutes: false, env }));
  await kernel.bootstrap();
  const service = kernel.getService<SettingsService>('settings');
  const http = new MockHttp();
  registerSettingsRoutes(http, service, { contextFromRequest: admin });
  return { kernel, i18n, service, http };
}

const servedLocaleOptions = (body: any): Array<{ value: string; label: string }> =>
  body.data.manifest.specifiers.find((s: { key?: string }) => s.key === 'locale').options;

const getPage = (http: MockHttp, headers?: Record<string, string>) =>
  call(http, 'GET /api/settings/:namespace', { headers });
const save = (http: MockHttp, body: unknown) => call(http, 'PUT /api/settings/:namespace', { body });

describe('localization.locale serves the deployment\'s locale list', () => {
  let booted: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    booted = await boot();
  });
  afterAll(async () => {
    await booted.kernel.shutdown();
  });
  afterEach(async () => {
    await booted.service.setMany('localization', { locale: null });
  });

  it('offers what the i18n service reports, each named in its own language', async () => {
    booted.i18n.locales = ['en', 'zh-CN', 'fr', 'vi-VN'];
    const page = await getPage(booted.http);
    expect(page.status).toBe(200);
    const options = servedLocaleOptions(page.body);
    // The manifest default `en-US` is in effect, a second spelling of `en`:
    // that option is offered under the stored spelling, so it shows chosen.
    expect(options.map((o) => o.value)).toEqual(['en-US', 'zh-CN', 'fr', 'vi-VN']);
    expect(options.slice(0, 3).map((o) => o.label)).toEqual(['English', '简体中文', 'Français']);
    expect(options[3].label).toBe(localeSelfName('vi-VN'));
    // The registered manifest is left as declared: once the source has no
    // answer, the manifest read is the declared four again.
    booted.i18n.locales = [];
    const declared = (booted.service.getManifest('localization').specifiers as any[]).find((s) => s.key === 'locale');
    expect(declared.options.map((o: { value: string }) => o.value)).toEqual(['en-US', 'zh-CN', 'ja-JP', 'es-ES']);
  });

  it('the manifest list serves the table the namespace read serves and the save judges against', async () => {
    booted.i18n.locales = ['en', 'zh-CN', 'fr-FR', 'vi-VN'];
    // An offered value in effect, so the namespace read offers the list as reported.
    expect((await save(booted.http, { locale: 'fr-FR' })).status).toBe(200);

    const list = await call(booted.http, 'GET /api/settings');
    expect(list.status).toBe(200);
    const listed = (list.body.data.manifests as any[])
      .find((m) => m.namespace === 'localization')
      .specifiers.find((s: { key?: string }) => s.key === 'locale').options as Array<{ value: string; label: string }>;
    const page = servedLocaleOptions((await getPage(booted.http)).body);
    expect(listed).toEqual(page);
    expect(listed.map((o) => o.value)).toEqual(['en', 'zh-CN', 'fr-FR', 'vi-VN']);
    // In-process readers are told the same table.
    const read = (booted.service.getManifest('localization').specifiers as any[]).find((s) => s.key === 'locale');
    expect(read.options).toEqual(listed);
    const inProcess = booted.service.listManifests().find((m) => m.namespace === 'localization')!;
    expect((inProcess.specifiers as any[]).find((s) => s.key === 'locale').options).toEqual(listed);

    // The save's boundary is that table: every listed value saves, the
    // declared `ja-JP` the list leaves out is refused naming the listed values.
    for (const { value } of listed) {
      expect((await save(booted.http, { locale: value })).status).toBe(200);
    }
    const refused = await save(booted.http, { locale: 'ja-JP' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.fields).toEqual([
      expect.objectContaining({
        field: 'locale',
        code: 'invalid_option',
        constraint: { allowed: listed.map((o) => o.value).join(', ') },
      }),
    ]);
  });

  it('accepts a language the deployment supports that the declared four never named', async () => {
    booted.i18n.locales = ['en', 'zh-CN', 'fr-FR'];
    const saved = await save(booted.http, { locale: 'fr-FR' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.values.locale.value).toBe('fr-FR');
    expect((await booted.service.get('localization', 'locale')).value).toBe('fr-FR');
  });

  it('follows the list at runtime: a translation item added later is accepted without a reboot', async () => {
    booted.i18n.locales = ['en', 'zh-CN'];
    const before = await save(booted.http, { locale: 'vi-VN' });
    expect(before.status).toBe(400);
    booted.i18n.locales = ['en', 'zh-CN', 'vi-VN'];
    const after = await save(booted.http, { locale: 'vi-VN' });
    expect(after.status).toBe(200);
    expect((await booted.service.get('localization', 'locale')).value).toBe('vi-VN');
  });

  it('refuses a language the deployment does not support, as any value outside a table is refused', async () => {
    booted.i18n.locales = ['en', 'zh-CN'];
    const refused = await save(booted.http, { locale: 'ja-JP' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(refused.body.error.details.fields).toEqual([
      expect.objectContaining({ field: 'locale', code: 'invalid_option', value: 'ja-JP', constraint: { allowed: 'en, zh-CN' } }),
    ]);
    // Nothing was written.
    expect((await booted.service.get('localization', 'locale')).source).toBe('default');
  });

  it('accepts the spelling stored values carry for an offered language (`en-US` where `en` is offered)', async () => {
    booted.i18n.locales = ['en', 'zh-Hans'];
    expect((await save(booted.http, { locale: 'zh-CN' })).status).toBe(200);
    expect((await save(booted.http, { locale: 'en-US' })).status).toBe(200);
    // A code the platform locale table does not alias is accepted only as spelled.
    booted.i18n.locales = ['en', 'fr'];
    expect((await save(booted.http, { locale: 'fr-FR' })).status).toBe(400);
  });

  it('keeps a stored value the deployment no longer offers readable, and serves it named as such', async () => {
    booted.i18n.locales = ['en', 'zh-CN', 'ja-JP'];
    expect((await save(booted.http, { locale: 'ja-JP' })).status).toBe(200);
    booted.i18n.locales = ['en', 'zh-CN'];

    const page = await getPage(booted.http, { 'accept-language': 'zh-CN' });
    expect(page.body.data.values.locale.value).toBe('ja-JP');
    expect(servedLocaleOptions(page.body)).toEqual([
      { value: 'en', label: 'English' },
      { value: 'zh-CN', label: '简体中文' },
      { value: 'ja-JP', label: `日本語 (${notOfferedCopy('zh-CN')})` },
    ]);
    // It keeps being the value in effect, and a save of another key passes it by.
    expect((await save(booted.http, { fiscal_year_start: 'april' })).status).toBe(200);
    expect((await booted.service.get('localization', 'locale')).value).toBe('ja-JP');
    // Written again, it is judged like any other value.
    expect((await save(booted.http, { locale: 'ja-JP' })).status).toBe(400);
  });

  it('stands on the declared four when the i18n service reports no locale', async () => {
    booted.i18n.locales = [];
    const page = await getPage(booted.http);
    expect(servedLocaleOptions(page.body).map((o) => o.value)).toEqual(['en-US', 'zh-CN', 'ja-JP', 'es-ES']);
    expect((await save(booted.http, { locale: 'fr-FR' })).status).toBe(400);
    expect((await save(booted.http, { locale: 'es-ES' })).status).toBe(200);
  });
});

describe('an OS_LOCALIZATION_LOCALE override is judged against the same list, when it is read', () => {
  it('is in force for a language the deployment supports, and not reported at boot', async () => {
    const booted = await boot({ OS_LOCALIZATION_LOCALE: 'vi-VN' });
    try {
      booted.i18n.locales = ['en', 'vi-VN'];
      const resolved = await booted.service.get('localization', 'locale');
      expect(resolved.value).toBe('vi-VN');
      expect(resolved.source).toBe('env');
      booted.i18n.locales = ['en'];
      // No longer offered: the override is not in force, as any rejected one.
      expect((await booted.service.get('localization', 'locale')).source).not.toBe('env');
    } finally {
      await booted.kernel.shutdown();
    }
  });
});

describe('the registration-time audit of OS_* overrides', () => {
  it('leaves a sourced key to be judged when read, and still judges a key with only a declared table', () => {
    const error = vi.fn();
    const svc = new SettingsService({
      env: { OS_LOCALIZATION_LOCALE: 'vi-VN', OS_LOCALIZATION_FISCAL_YEAR_START: 'smarch' },
      logger: { warn: vi.fn(), error } as never,
    });
    // The i18n service is not up yet at this point of a boot.
    svc.registerOptionSource('localization', 'locale', localizationLocaleOptionSource(() => undefined));
    svc.registerManifest(localizationSettingsManifest);
    const reported = error.mock.calls.map((c) => String(c[0]));
    expect(reported.some((line) => line.includes('OS_LOCALIZATION_LOCALE'))).toBe(false);
    expect(reported.some((line) => line.includes('OS_LOCALIZATION_FISCAL_YEAR_START'))).toBe(true);
  });
});

describe('a service with no option source, or a failing one', () => {
  it('judges the declared table', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(localizationSettingsManifest);
    await expect(svc.setMany('localization', { locale: 'fr-FR' })).rejects.toMatchObject({ code: 'SETTINGS_VALIDATION' });
    await svc.setMany('localization', { locale: 'ja-JP' });
    expect((await svc.get('localization', 'locale')).value).toBe('ja-JP');
  });

  it('falls back to the declared table when the source throws, and says so once', async () => {
    const warn = vi.fn();
    const svc = new SettingsService({ env: {}, logger: { warn, error: vi.fn() } as never });
    svc.registerOptionSource('localization', 'locale', localizationLocaleOptionSource(() => {
      throw new Error('i18n exploded');
    }));
    svc.registerManifest(localizationSettingsManifest);
    await svc.setMany('localization', { locale: 'ja-JP' });
    await expect(svc.setMany('localization', { locale: 'fr-FR' })).rejects.toMatchObject({ code: 'SETTINGS_VALIDATION' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("'localization.locale'");
  });
});

describe('localeSelfName: a locale named in its own language, else its code', () => {
  it('takes the platform locale table\'s name for the language a code means', () => {
    expect(localeSelfName('en')).toBe('English');
    expect(localeSelfName('en-US')).toBe('English');
    expect(localeSelfName('zh-TW')).toBe('繁體中文');
    expect(localeSelfName('ja-JP')).toBe('日本語');
  });

  it('answers the code for a tag nothing names, a malformed tag, and a runtime without Intl.DisplayNames', () => {
    expect(localeSelfName('xx-YY')).toBe('xx-YY');
    expect(localeSelfName('not a tag')).toBe('not a tag');
    const original = Intl.DisplayNames;
    try {
      (Intl as { DisplayNames?: unknown }).DisplayNames = undefined;
      expect(localeSelfName('vi-VN')).toBe('vi-VN');
    } finally {
      (Intl as { DisplayNames?: unknown }).DisplayNames = original;
    }
  });

  it('names a language off the table through Intl.DisplayNames where the runtime\'s ICU data has it', () => {
    // Read from the runtime rather than written down: ICU builds differ, and
    // the pin is that the name comes from it, capitalized, or is the code.
    let expected = 'vi-VN';
    try {
      const name = new Intl.DisplayNames(['vi-VN'], { type: 'language', fallback: 'none' }).of('vi-VN');
      if (name && name !== 'vi-VN') expected = name.charAt(0).toLocaleUpperCase('vi-VN') + name.slice(1);
    } catch {
      // keep the code
    }
    expect(localeSelfName('vi-VN')).toBe(expected);
  });
});
