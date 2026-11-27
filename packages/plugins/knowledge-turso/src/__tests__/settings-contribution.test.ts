// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Knowledge page's Turso group is contributed by the store that reads it.
 *
 * `turso_url` and `turso_auth_token` are read by this plugin alone, under
 * `urlFromSettings` (the runtime's `knowledge` mount sets it where the
 * platform database is not PostgreSQL). `@objectstack/service-settings` no
 * longer declares them; the plugin adds them to the page in `init()`. Pinned
 * on a real kernel (the real settings service, its HTTP door, the real
 * knowledge service), in every mount case:
 *
 *   - no knowledge-turso (a deployment whose store is pgvector): the page has
 *     no Turso field, and a `PUT` of either key is refused `400 UNKNOWN_KEY`;
 *   - knowledge-turso reading its URL from settings: the page carries the
 *     group, in front, where it always was; a `PUT` of `turso_url` is saved,
 *     and a value saved during the boot reaches the plugin's reader, which
 *     opens that file;
 *   - knowledge-turso given a `url` of its own: it reads no setting, so the
 *     page carries no Turso field either.
 *
 * Stored values surviving the case without the store is pinned beside the
 * page's retired keys, over the real engine, in service-settings'
 * `knowledge-settings-retired-keys.pin.test.ts`.
 *
 * The group's copy moved with it: this plugin loads it into the i18n service,
 * in every locale the settings bundle ships, and that bundle no longer
 * carries it.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import {
  SettingsServicePlugin,
  registerSettingsRoutes,
  settingsBuiltinTranslations,
  type SettingsService,
} from '@objectstack/service-settings';
import {
  KnowledgeTursoPlugin,
  dataDirectoryOf,
  knowledgeTestActionHandler,
  knowledgeTursoSettingsSpecifiers,
  knowledgeTursoSettingsTranslations,
} from '../index.js';

/** The group, its two fields and the action that checks them, in page order. */
const TURSO_IDS = ['turso', 'turso_url', 'turso_auth_token', 'test'];

/**
 * `POST /api/settings/knowledge/<actionId>` beside the same post to an action
 * no page declares: the answer "as for an undeclared action" is judged by that
 * control's envelope, never by its message text.
 */
async function postBesideUndeclared(http: MockHttp, actionId: string, body: unknown) {
  const route = 'POST /api/settings/:namespace/:actionId';
  const answer = await call(http, route, { namespace: 'knowledge', actionId }, body);
  const control = await call(http, route, { namespace: 'knowledge', actionId: 'never_declared' }, body);
  return { answer, control };
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An i18n service reduced to a recorder of what each plugin loads. */
class RecordingI18nPlugin implements Plugin {
  name = 'test.recording.i18n';
  version = '0.0.0';
  type = 'standard' as const;
  readonly loaded: Array<[string, Record<string, unknown>]> = [];
  async init(ctx: PluginContext): Promise<void> {
    ctx.registerService('i18n', {
      loadTranslations: (locale: string, data: Record<string, unknown>) => { this.loaded.push([locale, data]); },
    });
  }
}

/** The operator's save, after the settings service has bound and before the boot completes. */
class SavesStoreUrl implements Plugin {
  name = 'test.saves-store-url';
  version = '0.0.0';
  type = 'standard' as const;
  optionalDependencies = ['com.objectstack.service.settings'];
  outcome: unknown;
  constructor(private readonly url: string) {}
  async init(): Promise<void> {}
  async start(ctx: PluginContext): Promise<void> {
    const settings = ctx.getService<SettingsService>('settings');
    ctx.hook('kernel:ready', async () => {
      this.outcome = await settings.set('knowledge', 'turso_url', this.url, { isSystem: true } as never).then(
        () => 'saved',
        (e: unknown) => e,
      );
    });
  }
}

type Mount = 'no-turso' | 'turso-from-settings' | 'turso-own-url';

async function boot(mount: Mount, extra: Plugin[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-turso-settings-'));
  dirs.push(root);
  const i18n = new RecordingI18nPlugin();
  const kernel = new LiteKernel();
  kernel.use(i18n);
  // The store is `use`d ahead of the service and the settings plugin on
  // purpose: its `optionalDependencies` must order it after the knowledge
  // service, whose init() registers the page this plugin adds to.
  if (mount === 'turso-from-settings') kernel.use(new KnowledgeTursoPlugin({ urlFromSettings: true, projectRoot: root, env: {} }));
  if (mount === 'turso-own-url') kernel.use(new KnowledgeTursoPlugin({ url: ':memory:', urlFromSettings: true, projectRoot: root, env: {} }));
  kernel.use(new KnowledgeServicePlugin({ enableEventSync: false, buildAtBoot: false }));
  kernel.use(new SettingsServicePlugin({ env: {}, registerRoutes: false }));
  for (const p of extra) kernel.use(p);
  await kernel.bootstrap();
  const settings = kernel.getService<SettingsService>('settings');
  const http = new MockHttp();
  registerSettingsRoutes(http, settings, {
    contextFromRequest: () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' }),
  });
  return { kernel, settings, http, root, i18n };
}

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

async function call(http: MockHttp, route: string, params: Record<string, string>, body?: unknown) {
  const [method] = route.split(' ');
  const req = { params, query: {}, body: body ?? {}, headers: {}, method, path: '/' } as IHttpRequest;
  const state: { status: number; body?: any } = { status: 200 };
  const res = {
    json: (data: unknown) => { state.body = data; },
    send: () => {},
    status: (code: number) => { state.status = code; return res; },
    header: () => res,
  } as unknown as IHttpResponse;
  await http.routes.get(route)!(req, res);
  return state;
}

const idsOf = (settings: SettingsService) =>
  (settings.getManifest('knowledge').specifiers as Array<{ key?: string; id?: string }>).map((s) => s.key ?? s.id);

const loadedTursoCopy = (loaded: Array<[string, Record<string, unknown>]>) =>
  loaded.filter(([, data]) => JSON.stringify(data).includes('"turso_url"'));

describe('the Knowledge page without knowledge-turso (the store is pgvector)', async () => {
  const { settings, http, i18n } = await boot('no-turso');

  it('shows no Turso group or field, and serves no Turso value', async () => {
    const ids = idsOf(settings);
    // Non-vacuity: the page is served, with the keys it does declare.
    expect(ids).toContain('chunk_target');
    for (const id of TURSO_IDS) expect(ids, id).not.toContain(id);
    const page = await call(http, 'GET /api/settings/:namespace', { namespace: 'knowledge' });
    expect(page.status).toBe(200);
    for (const key of ['turso_url', 'turso_auth_token']) expect(page.body?.data?.values ?? {}, key).not.toHaveProperty(key);
  });

  it('refuses a PUT of either Turso key as an undeclared key', async () => {
    for (const [key, value] of [['turso_url', 'file:./knowledge.db'], ['turso_auth_token', 'tok']] as const) {
      const write = await call(http, 'PUT /api/settings/:namespace', { namespace: 'knowledge' }, { [key]: value });
      expect(write.status, key).toBe(400);
      expect(write.body?.error?.code, key).toBe('UNKNOWN_KEY');
    }
  });

  it('has no Test connection: the action door answers as for an undeclared action', async () => {
    const specs = settings.getManifest('knowledge').specifiers as Array<{ type: string }>;
    expect(specs.filter((s) => s.type === 'action_button')).toEqual([]);
    const { answer, control } = await postBesideUndeclared(http, 'test', { values: { turso_url: 'file:./sent.db' } });
    expect(answer.status).toBe(400);
    expect(answer.body?.error?.code).toBe('SETTINGS_ACTION_FAILED');
    expect([control.status, control.body?.error?.code]).toEqual([answer.status, answer.body?.error?.code]);
    // Not the Turso check's answer: it would name the URL it was sent.
    expect(JSON.stringify(answer.body)).not.toContain('file:./sent.db');
  });

  it('loads no Turso copy into the i18n service', () => {
    expect(loadedTursoCopy(i18n.loaded)).toEqual([]);
    // Non-vacuity: the settings bundle itself was loaded into the same recorder.
    expect(i18n.loaded.length).toBeGreaterThan(0);
  });
});

describe('the Knowledge page with knowledge-turso reading its URL from settings', async () => {
  const probe = mkdtempSync(join(tmpdir(), 'knowledge-turso-settings-'));
  dirs.push(probe);
  const { settings, http, i18n } = await boot('turso-from-settings');

  it('carries the Turso group, its two fields and their Test connection, in front of the page, as declared', () => {
    const ids = idsOf(settings);
    expect(ids.slice(0, TURSO_IDS.length)).toEqual(TURSO_IDS);
    expect(ids).toContain('chunk_target');
    expect(settings.getManifest('knowledge').specifiers.slice(0, TURSO_IDS.length)).toEqual(knowledgeTursoSettingsSpecifiers);
    expect(knowledgeTursoSettingsSpecifiers.find((s) => s.id === 'test')).toMatchObject({
      type: 'action_button',
      handler: { kind: 'http', method: 'POST', url: '/api/settings/knowledge/test' },
    });
  });

  it('answers Test connection with the Turso check, where an undeclared action is refused', async () => {
    const { answer, control } = await postBesideUndeclared(http, 'test', { values: { turso_url: 'file:./sent.db' } });
    expect(control.status).toBe(400);
    expect(answer.status).toBe(200);
    expect(answer.body?.data?.ok).toBe(true);
    expect(String(answer.body?.data?.message)).toContain('file:./sent.db');
  });

  it('saves a PUT of turso_url, and keeps the auth token a secret', async () => {
    const write = await call(http, 'PUT /api/settings/:namespace', { namespace: 'knowledge' }, { turso_url: 'file:./other.db' });
    expect(write.status).toBe(200);
    expect((await settings.get('knowledge', 'turso_url'))?.value).toBe('file:./other.db');
    expect([...settings.secretKeysOf('knowledge')]).toContain('turso_auth_token');
    // The test button reads the stored field it now declares.
    const answer = await call(http, 'POST /api/settings/:namespace/:actionId', { namespace: 'knowledge', actionId: 'test' }, {});
    expect(answer.status).toBe(200);
    expect(String(answer.body?.data?.message)).toContain('file:./other.db');
  });

  it('a turso_url saved during the boot reaches the plugin\'s reader, which opens that file', async () => {
    const saved = join(dataDirectoryOf(probe), 'saved.db');
    const saver = new SavesStoreUrl(`file:${saved}`);
    const root = probe;
    const i18nPlugin = new RecordingI18nPlugin();
    const kernel = new LiteKernel();
    kernel.use(i18nPlugin);
    kernel.use(new KnowledgeTursoPlugin({ urlFromSettings: true, projectRoot: root, env: {} }));
    kernel.use(new KnowledgeServicePlugin({ enableEventSync: false, buildAtBoot: false }));
    kernel.use(new SettingsServicePlugin({ env: {}, registerRoutes: false }));
    kernel.use(saver);
    await kernel.bootstrap();
    try {
      // Without the contribution this save is refused as an undeclared key.
      expect(saver.outcome).toBe('saved');
      const knowledge = kernel.getService<{ getAdapter(id: string): { healthCheck(): Promise<unknown> } }>(KNOWLEDGE_SERVICE);
      expect(await knowledge.getAdapter('turso').healthCheck()).toMatchObject({ ok: true });
      expect(existsSync(saved)).toBe(true);
      // Not the default file.
      expect(existsSync(join(dataDirectoryOf(root), 'knowledge.db'))).toBe(false);
    } finally {
      await kernel.shutdown();
    }
  });

  it('loads the group\'s copy into the i18n service, in every locale the settings bundle ships', () => {
    const locales = loadedTursoCopy(i18n.loaded).map(([locale]) => locale).sort();
    expect(locales).toEqual(Object.keys(settingsBuiltinTranslations).sort());
  });
});

describe('knowledge-turso given a url of its own', async () => {
  const { settings, http } = await boot('turso-own-url');

  it('reads no setting, so the page carries no Turso field and no Test connection', async () => {
    const ids = idsOf(settings);
    expect(ids).toContain('chunk_target');
    for (const id of TURSO_IDS) expect(ids, id).not.toContain(id);
    const { answer, control } = await postBesideUndeclared(http, 'test', {});
    expect(answer.status).toBe(400);
    expect([control.status, control.body?.error?.code]).toEqual([answer.status, answer.body?.error?.code]);
  });
});

describe('the Turso group\'s copy moved with its fields', () => {
  const locales = Object.keys(settingsBuiltinTranslations);

  it('is held in every locale the settings bundle ships, and in no other', () => {
    expect(Object.keys(knowledgeTursoSettingsTranslations).sort()).toEqual([...locales].sort());
    // Non-vacuity: the bundle ships English and ten translations.
    expect(locales.length).toBe(11);
  });

  it('covers the group\'s title and description and each field\'s label and help, in every locale', () => {
    const group = knowledgeTursoSettingsSpecifiers.find((s) => s.type === 'group')!;
    const fields = knowledgeTursoSettingsSpecifiers.filter((s) => s.key);
    expect(fields.map((f) => f.key)).toEqual(['turso_url', 'turso_auth_token']);
    for (const locale of locales) {
      const copy = knowledgeTursoSettingsTranslations[locale]!.settings.knowledge as any;
      expect(copy.groups[group.id!].title, locale).toBeTruthy();
      expect(copy.groups[group.id!].description, locale).toBeTruthy();
      for (const f of fields) {
        expect(copy.keys[f.key!].label, `${locale} ${f.key}`).toBeTruthy();
        expect(copy.keys[f.key!].help, `${locale} ${f.key}`).toBeTruthy();
      }
      expect(copy.actions.test.label, `${locale} test`).toBeTruthy();
    }
  });

  it('is no longer in the settings bundle, which carries the rest of the page', () => {
    for (const locale of locales) {
      const page = (settingsBuiltinTranslations[locale] as any).settings.knowledge;
      expect(page.keys.chunk_target, locale).toBeDefined();
      expect(page.groups, locale).not.toHaveProperty('turso');
      expect(page.keys, locale).not.toHaveProperty('turso_url');
      expect(page.keys, locale).not.toHaveProperty('turso_auth_token');
      expect(page.actions ?? {}, locale).not.toHaveProperty('test');
    }
  });

  // The group is on the page only where the store reads it, which is never on
  // PostgreSQL, and no deployment reuses an organization's own database for a
  // blank URL (a blank URL opens knowledge.db in the data directory). So the
  // description names PostgreSQL once (when the group is used), says what
  // blank means, and carries neither the PostgreSQL clause nor the cloud one.
  it('describes the group as it is read: PostgreSQL named once, blank is knowledge.db, no cloud fallback', () => {
    const fallback = String(knowledgeTursoSettingsSpecifiers.find((s) => s.type === 'group')!.description);
    const descriptions: Array<[string, string]> = [
      ['fallback', fallback],
      ...locales.map((l) => [l, (knowledgeTursoSettingsTranslations[l]!.settings.knowledge.groups.turso.description)] as [string, string]),
    ];
    expect(descriptions).toHaveLength(12);
    for (const [where, text] of descriptions) {
      expect(text.split('PostgreSQL').length - 1, where).toBe(1);
      expect(text, where).toContain('knowledge.db');
    }
    expect(fallback).not.toMatch(/organi[sz]ation|cloud|not read/i);
    expect(fallback).toContain('Leave blank to use knowledge.db in the data directory.');
  });
});

describe('knowledgeTestActionHandler — the Turso form check', () => {
  it('accepts no URL (the plugin defaults to its own file)', async () => {
    const r = await knowledgeTestActionHandler({ values: {} });
    expect(r.ok).toBe(true);
    expect(r.severity).toBe('info');
    // The plugin opens a file of its own, never the platform's database.
    expect(r.message).toMatch(/knowledge\.db/);
    expect(r.message).not.toMatch(/reuse the tenant/);
  });

  it('accepts a local file URL', async () => {
    expect((await knowledgeTestActionHandler({ values: { turso_url: 'file:./knowledge.db' } })).ok).toBe(true);
  });

  it('rejects a managed Turso URL without an auth token, and accepts it with one', async () => {
    const without = await knowledgeTestActionHandler({ values: { turso_url: 'libsql://x.turso.io' } });
    expect(without.ok).toBe(false);
    expect(without.severity).toBe('error');
    const withToken = await knowledgeTestActionHandler({ values: { turso_url: 'libsql://x.turso.io', turso_auth_token: 't' } });
    expect(withToken.ok).toBe(true);
  });

  it('names the package that reads the URL and how it is registered, not an outside origin', async () => {
    const message = String((await knowledgeTestActionHandler({ values: { turso_url: 'file:./knowledge.db' } })).message);
    expect(message).toContain('@objectstack/knowledge-turso');
    expect(message).toMatch(/registered beside the knowledge service/);
    expect(message).not.toMatch(/ObjectOS Cloud monorepo|does not ship|to exercise live calls/);
  });

  it('every green answer says no connection was attempted', async () => {
    const forms: Array<[string, Record<string, unknown>]> = [
      ['no URL', {}],
      ['local file', { turso_url: 'file:./knowledge.db' }],
      ['managed', { turso_url: 'libsql://x.turso.io', turso_auth_token: 't' }],
    ];
    for (const [label, values] of forms) {
      const r = await knowledgeTestActionHandler({ values });
      expect(r.ok, label).toBe(true);
      expect(String(r.message), label).toMatch(/no connection was attempted/);
    }
  });

  it('reads no adapter: a stale one in the values or the payload changes nothing', async () => {
    const fields = { turso_url: 'libsql://x.turso.io', turso_auth_token: 't' };
    const baseline = await knowledgeTestActionHandler({ values: fields });
    expect(baseline.ok).toBe(true);
    for (const adapter of ['memory', 'turso', 'ragflow', 'pgvector']) {
      expect(await knowledgeTestActionHandler({ values: { ...fields, adapter } }), adapter).toEqual(baseline);
      expect(await knowledgeTestActionHandler({ values: fields, payload: { values: { adapter } } }), adapter).toEqual(baseline);
    }
    // Non-vacuity: the fields it does read change the answer.
    expect((await knowledgeTestActionHandler({ values: { turso_url: 'libsql://x.turso.io' } })).ok).toBe(false);
  });

  it('prefers payload.values over persisted values', async () => {
    const r = await knowledgeTestActionHandler({
      values: { turso_url: 'libsql://x.turso.io' },
      payload: { values: { turso_url: 'file:foo.db' } },
    });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/file:foo\.db/);
  });
});

/**
 * A store that reads its URL from settings, on a composition where the page
 * cannot carry the two keys: the read finds nothing saved and the store opens
 * its default file. That is said once, at init().
 */
describe('KnowledgeTursoPlugin — a store-from-settings whose page cannot carry the Turso keys', () => {
  const NOT_ON_PAGE = /does not carry turso_url and turso_auth_token/;

  function ctxWith(settings: unknown) {
    const warns: string[] = [];
    const ctx = {
      getService: (name: string) => {
        if (name === 'settings' && settings !== undefined) return settings;
        throw new Error(`no service ${name}`);
      },
      hook: () => undefined,
      logger: { info: () => undefined, warn: (m: string) => warns.push(m), debug: () => undefined, error: () => undefined },
    } as unknown as PluginContext;
    return { ctx, warns };
  }

  function pageOf(specifiers: unknown[]) {
    let page = { namespace: 'knowledge', specifiers };
    const actions: string[] = [];
    return {
      actions,
      getManifest: () => page,
      registerManifest: (m: typeof page) => { page = m; },
      registerAction: (_ns: string, id: string) => { actions.push(id); },
    };
  }

  const plugin = () => new KnowledgeTursoPlugin({ urlFromSettings: true, projectRoot: '/srv/app', env: {} });

  it('warns once with no settings service, naming the default file', async () => {
    const { ctx, warns } = ctxWith(undefined);
    await plugin().init(ctx);
    const hits = warns.filter((m) => NOT_ON_PAGE.test(m));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('knowledge.db');
  });

  it('warns once for a host page that declares a Turso group id without the keys', async () => {
    const page = pageOf([{ type: 'action_button', id: 'test', label: 'Host test' }]);
    const { ctx, warns } = ctxWith(page);
    await plugin().init(ctx);
    expect(warns.filter((m) => NOT_ON_PAGE.test(m))).toHaveLength(1);
    // The host's page and its own handler are left as written.
    expect(page.actions).toEqual([]);
  });

  it('says nothing where it contributes the group, and registers the check with it', async () => {
    const page = pageOf([{ type: 'number', key: 'chunk_target', label: 'Chunk' }]);
    const { ctx, warns } = ctxWith(page);
    await plugin().init(ctx);
    expect(warns.filter((m) => NOT_ON_PAGE.test(m))).toEqual([]);
    expect(page.actions).toEqual(['test']);
  });

  it('says nothing for a store given a url of its own: it reads no setting', async () => {
    const { ctx, warns } = ctxWith(undefined);
    await new KnowledgeTursoPlugin({ url: ':memory:', urlFromSettings: true, projectRoot: '/srv/app', env: {} }).init(ctx);
    expect(warns.filter((m) => NOT_ON_PAGE.test(m))).toEqual([]);
  });
});
