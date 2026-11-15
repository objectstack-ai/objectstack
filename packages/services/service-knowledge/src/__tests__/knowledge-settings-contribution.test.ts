// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The knowledge settings live and die with the knowledge service (#33933).
 *
 * A kernel that mounts `KnowledgeServicePlugin` beside `SettingsServicePlugin`
 * offers the knowledge page, the `ai` embedder section, both test actions and
 * the Setup entry; the same kernel without it offers none of them. This kernel
 * stands in for an app that mounts the service (none in this repository does):
 * the knowledge plugin is `use`d BEFORE the settings plugin on purpose, so the
 * pins also prove that its `optionalDependencies` declaration orders the
 * settings plugin ahead rather than the `use` order doing it by luck.
 *
 * The Setup entry is judged on the merged Setup tree the console reads (the
 * stock contributions plus every bundle registered through the `manifest`
 * service, folded by the ObjectQL registry), and against the hub list: the
 * knowledge page has exactly one sidebar entry exactly when the hub lists it.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import {
  SettingsServicePlugin,
  registerSettingsRoutes,
  aiEmbedderSettingsSpecifiers,
  aiTestEmbedderActionHandler,
  knowledgeTestActionHandler,
  type SettingsService,
} from '@objectstack/service-settings';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin.js';

const EMBEDDER_KEYS = aiEmbedderSettingsSpecifiers.map((s) => s.key).filter((k): k is string => !!k);
const SETTINGS_PAGE = /^\/apps\/setup\/system\/settings\/([a-z_]+)$/;

interface NavItem { id?: string; type?: string; url?: string; children?: NavItem[] }

/** The `manifest` service ObjectQL provides, reduced to a recorder. */
class FakeManifestPlugin implements Plugin {
  name = 'test.fake.manifest';
  version = '1.0.0';
  type = 'standard' as const;
  providesServices = ['manifest'];
  constructor(private readonly registered: unknown[]) {}
  async init(ctx: PluginContext): Promise<void> {
    ctx.registerService('manifest', { register: (m: unknown) => { this.registered.push(m); } });
  }
}

async function boot(withKnowledge: boolean) {
  const registered: unknown[] = [];
  const kernel = new LiteKernel();
  kernel.use(new FakeManifestPlugin(registered));
  if (withKnowledge) kernel.use(new KnowledgeServicePlugin({ enableEventSync: false }));
  kernel.use(new SettingsServicePlugin({ env: {}, registerRoutes: false }));
  await kernel.bootstrap();
  const settings = kernel.getService<SettingsService>('settings');
  return { kernel, settings, registered };
}

/** The Configuration group of the merged Setup tree. */
function configurationEntries(registered: unknown[]): NavItem[] {
  const engine = new ObjectQL();
  engine.registry.logLevel = 'silent';
  engine.registerApp({
    id: 'com.objectstack.test.setup-shell', namespace: 'sys', version: '0.0.0', type: 'plugin', scope: 'system',
    name: 'Setup shell (fixture)', apps: [SETUP_APP], navigationContributions: SETUP_NAV_CONTRIBUTIONS,
  } as any);
  for (const m of registered) engine.registerApp(m as any);
  const navigation = (engine.registry.getApp('setup') as { navigation?: NavItem[] } | undefined)?.navigation ?? [];
  return navigation.find((item) => item.id === 'group_configuration')?.children ?? [];
}

const knowledgeEntries = (registered: unknown[]) =>
  configurationEntries(registered).filter((i) => i.type === 'url' && SETTINGS_PAGE.exec(i.url ?? '')?.[1] === 'knowledge');

async function namespaceValues(settings: SettingsService, ns: string): Promise<Record<string, unknown>> {
  const payload = await settings.getNamespace(ns);
  return Object.fromEntries(Object.entries(payload.values).map(([k, v]) => [k, (v as { value?: unknown }).value]));
}

describe('#33933 — knowledge settings are contributed by the mounted knowledge service', async () => {
  const mounted = await boot(true);
  const bare = await boot(false);

  it('reads two real hubs: both serve the default slate', () => {
    for (const { settings } of [mounted, bare]) {
      expect(settings.listManifests().map((m) => m.namespace)).toEqual(expect.arrayContaining(['ai', 'storage', 'mail']));
    }
  });

  it('the knowledge page is offered with the service, and only with it', () => {
    expect(mounted.settings.listManifests().map((m) => m.namespace)).toContain('knowledge');
    expect(bare.settings.listManifests().map((m) => m.namespace)).not.toContain('knowledge');
  });

  it('the ai page carries the embedder section with the service, and only with it', () => {
    const keysOf = (s: SettingsService) =>
      (s.getManifest('ai').specifiers as Array<{ key?: string; id?: string }>).map((x) => x.key ?? x.id);
    expect(EMBEDDER_KEYS.length).toBeGreaterThanOrEqual(6);
    expect(keysOf(mounted.settings)).toEqual(expect.arrayContaining([...EMBEDDER_KEYS, 'embedder', 'test_embedder']));
    const bareKeys = keysOf(bare.settings);
    expect(bareKeys).toContain('provider');
    for (const key of [...EMBEDDER_KEYS, 'embedder', 'test_embedder']) expect(bareKeys, key).not.toContain(key);
  });

  it('both test buttons reach their handlers when the service is mounted', async () => {
    // "Reached" is judged by the handler's own answer for the same inputs,
    // never by message text: the no-handler answer is a different result.
    const knowledgeValues = await namespaceValues(mounted.settings, 'knowledge');
    expect(await mounted.settings.runAction('knowledge', 'test', {})).toEqual(
      await knowledgeTestActionHandler({ namespace: 'knowledge', actionId: 'test', values: knowledgeValues, payload: {}, ctx: {} }),
    );
    const aiValues = await namespaceValues(mounted.settings, 'ai');
    const embedder = await mounted.settings.runAction('ai', 'test_embedder', {});
    expect(embedder).toEqual(
      await aiTestEmbedderActionHandler({ namespace: 'ai', actionId: 'test_embedder', values: aiValues, payload: {}, ctx: {} }),
    );
    expect(embedder.severity).toBe('warning');
  });

  it('the Setup sidebar opens the knowledge page exactly once with the service, and never without it', () => {
    const entries = knowledgeEntries(mounted.registered);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('nav_settings_knowledge');
    expect(knowledgeEntries(bare.registered)).toHaveLength(0);
    // Non-vacuity: the bare tree is a real Setup tree with its AI entry.
    expect(configurationEntries(bare.registered).some((i) => i.id === 'nav_settings_ai')).toBe(true);
  });
});

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

async function post(http: MockHttp, namespace: string, actionId: string, body: unknown) {
  const req = { params: { namespace, actionId }, query: {}, body, headers: {}, method: 'POST', path: '/' } as IHttpRequest;
  const state: { status: number; body?: any } = { status: 200 };
  const res = {
    json: (data: unknown) => { state.body = data; },
    send: () => {},
    status: (code: number) => { state.status = code; return res; },
    header: () => res,
  } as unknown as IHttpResponse;
  await http.routes.get('POST /api/settings/:namespace/:actionId')!(req, res);
  return state;
}

/**
 * The two buttons #24769 measured, at the HTTP door — moved here from
 * `@objectstack/service-settings`' `settings-default-action-handlers.pin.test.ts`
 * with #33933, because the composition that serves them is now the one that
 * mounts the knowledge service.
 */
describe('[#24769] the two buttons the knowledge service contributes, at the HTTP door', async () => {
  // A platform admin: both namespaces gate reads and writes (and so actions) on
  // `manage_platform_settings`.
  const admin = () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' });
  const { settings } = await boot(true);
  const http = new MockHttp();
  registerSettingsRoutes(http, settings, { contextFromRequest: admin });

  it('POST /api/settings/ai/test_embedder is answered by the embedder check (200, not 400)', async () => {
    const answer = await post(http, 'ai', 'test_embedder', {
      values: { embedder_provider: 'openai', embedder_api_key: 'sk-test', embedder_model: 'text-embedding-3-small' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body?.data?.ok).toBe(true);
    expect(answer.body?.data?.message).toContain('text-embedding-3-small');
  });

  it('POST /api/settings/knowledge/test is answered by the adapter check (200, not 400)', async () => {
    const answer = await post(http, 'knowledge', 'test', {
      values: { adapter: 'ragflow', ragflow_base_url: 'http://localhost:9380', ragflow_api_key: 'k' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body?.data?.ok).toBe(true);
    expect(answer.body?.data?.message).toContain('localhost:9380');
  });
});
