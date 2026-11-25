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

import { createHash } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects';
import { EMBEDDER_SERVICE, KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import type {
  IEmbedder,
  IHttpRequest,
  IHttpResponse,
  IHttpServer,
  IKnowledgeAdapter,
  RouteHandler,
} from '@objectstack/spec/contracts';
import {
  SettingsServicePlugin,
  registerSettingsRoutes,
  aiEmbedderSettingsSpecifiers,
  aiTestEmbedderActionHandler,
  knowledgeTestActionHandler,
  type CryptoAdapter,
  type SettingsService,
} from '@objectstack/service-settings';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin.js';
import type { KnowledgeService } from '../knowledge-service.js';

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

// ── The embedder the ai.embedder_* settings configure (#37094) ─────────────
//
// Booted the way a deployment boots: the settings are SAVED through the
// settings service (a `kernel:ready` write, before the knowledge plugin reads
// them at `kernel:bootstrapped`), the provider is reached through the global
// `fetch` (stubbed), and the adapter below resolves `EMBEDDER_SERVICE` where it
// embeds, as a vector adapter does. Nothing here hands the plugin an embedder.

const API_KEY = 'sk-embedder-secret-37094';

interface LoggedLine { level: string; line: string }

/**
 * The API key is a secret field, which the settings service stores only through
 * an adapter that declares confidentiality; this kernel has no data engine, so
 * the adapter (not a crypto provider) is the seam.
 */
class ConfidentialTestAdapter implements CryptoAdapter {
  readonly confidential = true;
  async encrypt(plaintext: string): Promise<string> {
    return 'kms:' + Buffer.from(plaintext, 'utf8').toString('base64');
  }
  async decrypt(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext.replace(/^kms:/, ''), 'base64').toString('utf8');
  }
  digest(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }
}

/** Records every line the kernel's shared logger is handed. */
class LogRecorder implements Plugin {
  name = 'test.log-recorder';
  version = '1.0.0';
  type = 'standard' as const;
  constructor(private readonly lines: LoggedLine[]) {}
  async init(ctx: PluginContext): Promise<void> {
    const logger = ctx.logger as unknown as Record<string, unknown>;
    for (const level of ['debug', 'info', 'warn', 'error']) {
      logger[level] = (msg: unknown) => {
        this.lines.push({ level, line: String(msg) });
      };
    }
  }
}

/** An adapter that embeds what it indexes and what it is asked. */
class EmbeddingAdapterPlugin implements Plugin {
  name = 'test.knowledge.embedding-adapter';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.knowledge'];
  async init(ctx: PluginContext): Promise<void> {
    const embedder = () => ctx.getService<IEmbedder>(EMBEDDER_SERVICE);
    const adapter: IKnowledgeAdapter = {
      id: 'vec',
      async upsert(docs) {
        await embedder().embed(docs.map((d) => d.content));
      },
      async search(query) {
        await embedder().embed([query]);
        return [];
      },
      async delete() {},
    };
    ctx.getService<KnowledgeService>(KNOWLEDGE_SERVICE).registerAdapter('vec', adapter);
  }
}

/** Saves `ai` settings as an operator does, before the knowledge plugin reads them. */
class SavedAiSettings implements Plugin {
  name = 'test.saved-ai-settings';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.settings', 'com.objectstack.service.knowledge'];
  constructor(private readonly values: Record<string, unknown>) {}
  async init(): Promise<void> {}
  async start(ctx: PluginContext): Promise<void> {
    ctx.hook('kernel:ready', async () => {
      await ctx.getService<SettingsService>('settings').setMany('ai', this.values);
    });
  }
}

/** A host's (or cloud `service-ai`'s) own embedder, registered at `phase`. */
class HostEmbedderPlugin implements Plugin {
  name = 'test.host-embedder';
  version = '1.0.0';
  type = 'standard' as const;
  constructor(private readonly embedder: IEmbedder, private readonly phase: 'init' | 'kernel:ready') {}
  async init(ctx: PluginContext): Promise<void> {
    if (this.phase === 'init') ctx.registerService(EMBEDDER_SERVICE, this.embedder);
  }
  async start(ctx: PluginContext): Promise<void> {
    if (this.phase === 'kernel:ready') {
      ctx.hook('kernel:ready', async () => {
        ctx.registerService(EMBEDDER_SERVICE, this.embedder);
      });
    }
  }
}

interface ProviderRequest { url: string; authorization: string | null; model: unknown; inputs: string[] }

/** Stubs the provider's `POST /embeddings` on the global `fetch`. */
function stubProvider(): ProviderRequest[] {
  const requests: ProviderRequest[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown; input: string[] };
    requests.push({
      url: String(url),
      authorization: new Headers(init?.headers).get('authorization'),
      model: body.model,
      inputs: body.input,
    });
    return new Response(JSON.stringify({ data: body.input.map(() => ({ embedding: [0.6, 0.8] })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
  return requests;
}

async function bootEmbedder(opts: {
  saved?: Record<string, unknown>;
  host?: { embedder: IEmbedder; phase: 'init' | 'kernel:ready' };
} = {}) {
  const lines: LoggedLine[] = [];
  const kernel = new LiteKernel();
  kernel.use(new LogRecorder(lines));
  if (opts.host) kernel.use(new HostEmbedderPlugin(opts.host.embedder, opts.host.phase));
  kernel.use(new KnowledgeServicePlugin({
    enableEventSync: false,
    sources: [{ id: 'docs', label: 'Docs', adapter: 'vec', source: { kind: 'http', urls: ['https://docs.example.com/'] } }],
  }));
  kernel.use(new SettingsServicePlugin({ env: {}, registerRoutes: false, crypto: new ConfidentialTestAdapter() }));
  kernel.use(new EmbeddingAdapterPlugin());
  if (opts.saved) kernel.use(new SavedAiSettings(opts.saved));
  await kernel.bootstrap();
  const knowledge = kernel.getService<KnowledgeService>(KNOWLEDGE_SERVICE);
  const embedder = kernel.getService<IEmbedder>(EMBEDDER_SERVICE);
  return { kernel, lines, knowledge, embedder };
}

const texts = (n: number) => Array.from({ length: n }, (_, i) => `chunk ${i}`);

describe('#37094 — the open edition registers EMBEDDER_SERVICE from the ai.embedder_* settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saved settings: an index write embeds through the configured provider', async () => {
    const requests = stubProvider();
    const { knowledge, embedder, lines } = await bootEmbedder({
      saved: { embedder_provider: 'openai', embedder_api_key: API_KEY, embedder_model: 'text-embedding-3-small' },
    });
    expect(embedder.id).toBe('openai');
    expect(requests).toHaveLength(0); // nothing is sent at boot

    await knowledge.indexDocument('docs', { id: 'd1', sourceId: 'docs', content: 'hello embedder' });
    expect(requests).toEqual([{
      url: 'https://api.openai.com/v1/embeddings',
      authorization: `Bearer ${API_KEY}`,
      model: 'text-embedding-3-small',
      inputs: ['hello embedder'],
    }]);
    // The key reaches the provider and nothing else.
    expect(lines.filter((l) => l.line.includes(API_KEY))).toEqual([]);
    expect(lines.some((l) => l.level === 'info' && l.line.includes(`registered '${EMBEDDER_SERVICE}' from the ai.embedder_* settings`))).toBe(true);
  });

  it('a custom endpoint takes the saved Base URL', async () => {
    const requests = stubProvider();
    const { embedder } = await bootEmbedder({
      saved: {
        embedder_provider: 'custom',
        embedder_api_key: API_KEY,
        embedder_model: 'my-gateway-model',
        embedder_base_url: 'https://gateway.example.com/v1/',
      },
    });
    await embedder.embed(['x']);
    expect(requests.map((r) => [r.url, r.model])).toEqual([['https://gateway.example.com/v1/embeddings', 'my-gateway-model']]);
  });

  for (const phase of ['init', 'kernel:ready'] as const) {
    it(`an embedder already registered at ${phase} is kept, not replaced, and the settings are not applied`, async () => {
      const requests = stubProvider();
      const own: IEmbedder = { id: 'host-own', dimensions: 3, embed: async (t) => t.map(() => [1, 0, 0]) };
      const { embedder, knowledge, lines } = await bootEmbedder({
        host: { embedder: own, phase },
        saved: { embedder_provider: 'openai', embedder_api_key: API_KEY },
      });
      expect(embedder).toBe(own);
      await knowledge.indexDocument('docs', { id: 'd1', sourceId: 'docs', content: 'hello' });
      expect(requests).toHaveLength(0);
      const kept = lines.filter((l) => l.line.includes('already registered') && l.line.includes('host-own'));
      expect(kept).toHaveLength(1);
      expect(kept[0].level).toBe('info');
    });
  }

  it('an unsaved batch size leaves the model its own cap — the default 64 is not a saved value', async () => {
    const requests = stubProvider();
    // DashScope text-embedding-v3 documents at most 10 inputs per request.
    const { embedder } = await bootEmbedder({
      saved: { embedder_provider: 'dashscope', embedder_api_key: API_KEY, embedder_model: 'text-embedding-v3' },
    });
    await embedder.embed(texts(25));
    expect(requests.map((r) => r.inputs.length)).toEqual([10, 10, 5]);
    expect(requests[0].url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');
  });

  it('a saved batch size is the batch cap', async () => {
    const requests = stubProvider();
    const { embedder } = await bootEmbedder({
      saved: {
        embedder_provider: 'openai',
        embedder_api_key: API_KEY,
        embedder_model: 'text-embedding-3-small',
        embedder_batch_size: 4,
      },
    });
    await embedder.embed(texts(9));
    expect(requests.map((r) => r.inputs.length)).toEqual([4, 4, 1]);
  });

  it('no settings: boot succeeds, and indexing and search answer an error naming the missing settings', async () => {
    const requests = stubProvider();
    const { knowledge, embedder, lines } = await bootEmbedder();
    const named = /No embedder is configured[\s\S]*ai\.embedder_provider[\s\S]*restart/;

    await expect(knowledge.indexDocument('docs', { id: 'd1', sourceId: 'docs', content: 'hello' })).rejects.toThrow(named);
    // The adapter's search answers the error; the service's search reports it
    // per source and answers no hits.
    await expect(knowledge.getAdapter('vec').search('hello', { source: knowledge.getSource('docs')!, topK: 5 }))
      .rejects.toThrow(named);
    await expect(knowledge.search('hello', { sourceIds: ['docs'] })).resolves.toEqual([]);
    expect(lines.some((l) => l.level === 'error' && named.test(l.line))).toBe(true);
    // A vector column cannot be sized from it either.
    expect(() => embedder.dimensions).toThrow(named);
    expect(requests).toHaveLength(0);
    // Nothing asked for an embedder, so the boot line is info, not warn.
    expect(lines.some((l) => l.level === 'info' && l.line.includes('no embedder is configured'))).toBe(true);
    expect(lines.some((l) => l.level === 'warn' && l.line.includes('no embedder is configured'))).toBe(false);
  });

  it("a saved batch size over the model's documented cap is held to the cap", async () => {
    const requests = stubProvider();
    // DashScope text-embedding-v3 documents 10; the operator saved 64.
    const { embedder, lines } = await bootEmbedder({
      saved: {
        embedder_provider: 'dashscope',
        embedder_api_key: API_KEY,
        embedder_model: 'text-embedding-v3',
        embedder_batch_size: 64,
      },
    });
    await embedder.embed(texts(25));
    expect(requests.map((r) => r.inputs.length)).toEqual([10, 10, 5]);
    expect(lines.some((l) => l.line.includes('batch size=10') && l.line.includes('the saved 64'))).toBe(true);
  });

  it('a saved batch size for a model with no documented cap is kept as saved', async () => {
    const requests = stubProvider();
    const { embedder } = await bootEmbedder({
      saved: {
        embedder_provider: 'custom',
        embedder_api_key: API_KEY,
        embedder_model: 'my-gateway-model',
        embedder_base_url: 'https://gateway.example.com/v1',
        embedder_batch_size: 50,
      },
    });
    await embedder.embed(texts(60));
    expect(requests.map((r) => r.inputs.length)).toEqual([50, 10]);
  });

  it("'none' saved: embeddings stay disabled, and the error says so", async () => {
    stubProvider();
    const { embedder } = await bootEmbedder({ saved: { embedder_provider: 'none' } });
    await expect(embedder.embed(['x'])).rejects.toThrow(/ai\.embedder_provider is saved as 'none'/);
  });

  it('incomplete saved settings: the settings page\'s own check names what is missing, at warn', async () => {
    const requests = stubProvider();
    const { embedder, lines } = await bootEmbedder({ saved: { embedder_provider: 'siliconflow' } });
    await expect(embedder.embed(['x'])).rejects.toThrow(/siliconflow embedder requires an API key/);
    expect(lines.some((l) => l.level === 'warn' && l.line.includes('requires an API key'))).toBe(true);
    expect(requests).toHaveLength(0);
  });
});
