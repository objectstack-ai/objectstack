// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 28 — spawns the real producer once per single-cause fixture: twelve in-process bootStack boots, no two the same configuration (a top-level requires, a package body's, the top level over the bodies, the control, an explicit instance, triggers with its hard dependencies, record-context with mcp, its no-token control, a host-mounted record-context, knowledge with realtime, its no-token control, knowledge on a file database under OS_HOME), each its case's subject; 5.9 s in a local run for the first six, 10.0 s with the three record-context boots, 14.8 s with the two knowledge boots, 19.0 s with the file-database knowledge boot (local, verbose reporter); slowest CI reading 11.4 s (scheduled full-battery run 41199450735, Test Core shard log) read before the record-context boots, scaled by the local ratio to 21.7 s, x 1.25, rounded up — the first CI reading after the knowledge boots re-measures it

/**
 * #22301 item 1 — `bootStack` mounts the providers an app's `requires` names,
 * as `objectstack serve` does: `serve`'s reader (`stackDeclaredCapabilities`),
 * `serve`'s table (`CAPABILITY_PROVIDERS`), `serve`'s "an explicit instance
 * wins" rule (`providesCapability`) — all three now in `@objectstack/core`.
 *
 * Measured before the fix (`origin/main` 28bff18d0): a `requires: ['approvals']`
 * app booted through `bootStack` registered no `com.objectstack.service.approvals`
 * plugin and no `sys_approval_request` object, in either stack shape; the app
 * had to name the plugin in `extraPlugins` (hotcrm keeps five such entries).
 *
 * One case per branch of the reader's rule — the top-level list, the package
 * bodies when there is none, and the top level winning when both are present —
 * plus the control (no `requires`), the explicit-wins rule, and the hard
 * dependencies a mounted provider has (`triggers` → `job` / `queue`, which
 * `serve` mounts through its always-on slate, and so does `bootStack` since the
 * slate stage of #22301 — `harness.served-composition.test.ts` pins the slate
 * itself and the configuration each provider is built from).
 *
 * The tokens these cases name are OFF the always-on slate (`approvals`,
 * `realtime`), so mounting one is evidence of the `requires` reader and never
 * of the slate.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITY_PROVIDERS, KNOWLEDGE_STORE_PROVIDERS } from '@objectstack/core';
import { composeStacks, defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from './harness.js';
import { constructServedProviders } from './required-providers.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// Pay the first transform of this dist-resolved dependency at MODULE LOAD: the
// harness loads it lazily inside a boot, a clocked window
// (`check:test-source-alias`, the source-reach rule).
import '@objectstack/service-automation';

// The boot's first load, paid during collection rather than in the first
// case's clock (see `boot-warm-up.testkit.ts`). The first boot below requires
// `approvals`, so its provider is loaded here too.
await warmUpBoot({}, { requires: ['approvals'] });

const APPROVALS = 'com.objectstack.service.approvals';
const REALTIME = 'com.objectstack.service.realtime';

const svcManifest = { id: 'com.example.rqp.svc', name: 'RQP Service', namespace: 'rqp', version: '1.0.0', type: 'module' };
const appManifest = { id: 'com.example.rqp.app', name: 'RQP App', namespace: 'rqp', version: '1.0.0', type: 'app' };
const note = {
  name: 'rqp_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'public_read_write',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
};
const ticket = {
  name: 'rqp_ticket', label: 'Ticket', pluralLabel: 'Tickets', sharingModel: 'public_read_write',
  fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } },
};

type Bag = Record<string, unknown>;

/** One package, `extra` at its top level. */
const onePackage = (extra: Bag = {}): Bag =>
  defineStack({ manifest: appManifest, objects: [ticket, note], ...extra } as never) as unknown as Bag;

/** Two packages through the real producer: `requires` lives only in the bodies. */
const twoPackages = (svcExtra: Bag = {}, appExtra: Bag = {}): Bag =>
  composeStacks(
    [
      defineStack({ manifest: svcManifest, objects: [note], ...svcExtra } as never),
      defineStack({ manifest: appManifest, objects: [ticket], ...appExtra } as never),
    ],
    { manifest: 'preserve' },
  ) as unknown as Bag;

let stack: VerifyStack | undefined;
afterEach(async () => {
  await stack?.stop();
  stack = undefined;
});

const approvalsMounted = (s: VerifyStack) => ({
  plugin: s.kernel.hasPlugin(APPROVALS),
  object: s.metadata.object('sys_approval_request') !== undefined,
});

describe('bootStack mounts what `requires` names, by serve\'s reader', () => {
  it('top-level `requires` — the provider is mounted and its objects registered', async () => {
    stack = await bootStack(onePackage({ requires: ['approvals'] }));
    expect(approvalsMounted(stack)).toEqual({ plugin: true, object: true });
  }, 120_000);

  it('a package body\'s `requires` — counted when the top level carries none', async () => {
    const config = twoPackages({ requires: ['approvals'] });
    // Anti-vacuity: the producer really left `requires` out of the top level.
    expect(config.requires).toBeUndefined();
    stack = await bootStack(config);
    expect(approvalsMounted(stack)).toEqual({ plugin: true, object: true });
  }, 120_000);

  it('the top-level list wins over the bodies when present', async () => {
    stack = await bootStack({ ...twoPackages({ requires: ['approvals'] }), requires: ['realtime'] });
    expect(stack.kernel.hasPlugin(REALTIME)).toBe(true);
    expect(approvalsMounted(stack)).toEqual({ plugin: false, object: false });
  }, 120_000);

  it('control — an app that requires nothing gets none of them', async () => {
    stack = await bootStack(onePackage());
    expect(approvalsMounted(stack)).toEqual({ plugin: false, object: false });
    expect(stack.kernel.hasPlugin(REALTIME)).toBe(false);
  }, 120_000);
});

describe('serve\'s other two rules', () => {
  it('an explicit instance wins: a caller\'s provider is kept, the boot\'s is not constructed', async () => {
    // A stand-in that registers under the provider's identity and nothing else
    // — so the absence of `sys_approval_request` proves the real one never ran.
    class StandInApprovals {
      readonly name = APPROVALS;
      readonly version = '0.0.0';
      readonly type = 'standard';
      async init(): Promise<void> {}
    }
    stack = await bootStack(onePackage({ requires: ['approvals'] }), { extraPlugins: [new StandInApprovals()] });
    expect(approvalsMounted(stack)).toEqual({ plugin: true, object: false });
  }, 120_000);

  it('a mounted provider\'s hard dependencies are mounted with it: `triggers` has `job` and `queue`', async () => {
    stack = await bootStack(onePackage({ requires: ['automation', 'triggers'] }));
    for (const name of [
      'com.objectstack.service-automation',
      'com.objectstack.trigger.record-change',
      'com.objectstack.trigger.schedule',
      'com.objectstack.trigger.time-relative',
      'com.objectstack.trigger.api',
      'com.objectstack.service.job',
      'com.objectstack.service.queue',
    ]) {
      expect(stack.kernel.hasPlugin(name), name).toBe(true);
    }
  }, 120_000);
});

describe('every provider the table names is a dependency of this package', () => {
  it('so a declared token never fails to import from @objectstack/verify', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const stores = Object.values(KNOWLEDGE_STORE_PROVIDERS);
    const packages = [
      ...Object.values(CAPABILITY_PROVIDERS).flatMap((spec) => [spec.pkg, ...(spec.extras ?? []).map((extra) => extra.pkg)]),
      // The stores the `knowledge` token chooses between (`resolveCapabilityExtras`), bar the optional one.
      ...stores.filter((store) => !store.optional).map((store) => store.pkg),
    ];
    expect(packages.length).toBeGreaterThan(0);
    expect(packages.filter((pkg) => !(pkg in manifest.dependencies))).toEqual([]);
    // A store the table marks optional is an OPTIONAL dependency, and only that: as a hard one its
    // native client would refuse this package's install on a platform outside its os / cpu list.
    const optional = stores.filter((store) => store.optional).map((store) => store.pkg);
    expect(optional).toEqual(['@objectstack/knowledge-turso']);
    expect(optional.filter((pkg) => !(pkg in (manifest.optionalDependencies ?? {})) || pkg in manifest.dependencies)).toEqual([]);
  });
});

/**
 * ADR-0160 D5 — `requires: ['record-context']` mounts `RecordContextServicePlugin`,
 * so `get_record_context` is served over MCP from the app's `aiContexts` packs
 * with no hand wiring; without the token there is no tool and no service; a host
 * that mounts the plugin itself keeps its own instance. The MCP server is
 * declared as `requires: ['mcp']` (`serve` mounts it as a host default; this
 * boot takes none), so both providers come from the table `serve` reads.
 */
describe("requires: ['record-context'] — get_record_context over MCP", () => {
  const RECORD_CONTEXT = 'com.objectstack.service.record-context';
  /** The service name the plugin registers and the MCP doors resolve. */
  const RECORD_CONTEXT_SERVICE = 'record-context';
  const policy = {
    name: 'rqp_policy', label: 'Policy', pluralLabel: 'Policies', sharingModel: 'public_read_write',
    fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } },
  };
  const pack = { name: 'rqp_policy_brief', label: 'Policy brief', object: 'rqp_policy', fields: ['title'] };
  const withPack = (extra: Bag = {}): Bag =>
    defineStack({ manifest: appManifest, objects: [policy], aiContexts: [pack], ...extra } as never) as unknown as Bag;

  /** One MCP JSON-RPC call over the live `/mcp` transport, as the seeded admin. */
  const rpc = async (s: VerifyStack, method: string, params: Record<string, unknown>) => {
    const bearer = await s.signIn();
    const res = await s.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: any; error?: unknown };
    expect(body.error, JSON.stringify(body.error)).toBeUndefined();
    return body.result;
  };
  const toolNames = async (s: VerifyStack): Promise<string[]> =>
    ((await rpc(s, 'tools/list', {}))?.tools ?? []).map((t: { name: string }) => t.name);

  it('the token and one pack: tools/list carries get_record_context, and a call answers the pack', async () => {
    stack = await bootStack(withPack({ requires: ['mcp', 'record-context'] }));
    expect(stack.kernel.hasPlugin(RECORD_CONTEXT)).toBe(true);
    const names = await toolNames(stack);
    // Anti-vacuity: the MCP door is up and lists the record tools.
    expect(names).toContain('get_record');
    expect(names).toContain('get_record_context');

    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const row = await ql.insert('rqp_policy', { title: 'Travel policy RQP' }, { context: { isSystem: true } });
    const result = await rpc(stack, 'tools/call', {
      name: 'get_record_context',
      arguments: { objectName: 'rqp_policy', recordId: String(row.id) },
    });
    const text = String(result?.content?.[0]?.text ?? '');
    expect(result?.isError, text).not.toBe(true);
    expect(text).toContain('Travel policy RQP');
    expect(text).toContain('Policy brief');
  }, 120_000);

  it('control — the same app without the token: no provider, no service, no tool', async () => {
    stack = await bootStack(withPack({ requires: ['mcp'] }));
    expect(stack.kernel.hasPlugin(RECORD_CONTEXT)).toBe(false);
    const names = await toolNames(stack);
    expect(names).toContain('get_record');
    expect(names).not.toContain('get_record_context');
  }, 120_000);

  it("a host that mounts the plugin itself keeps its own: the boot constructs no second one", async () => {
    // A stand-in registered under the provider's real name, whose service is
    // marked: had the boot mounted the real plugin too, the service would be
    // the real one's.
    const marker = { recordContextTools: () => ({ definitions: [], getRecordContext: async () => ({}) }), host: true };
    class HostRecordContext {
      readonly name = RECORD_CONTEXT;
      readonly version = '0.0.0';
      readonly type = 'standard';
      async init(ctx: { registerService(name: string, service: unknown): void }): Promise<void> {
        ctx.registerService(RECORD_CONTEXT_SERVICE, marker);
      }
    }
    const host = new HostRecordContext();
    expect(
      await constructServedProviders({ config: withPack({ requires: ['record-context'] }), held: [host], packageRoot: process.cwd() }),
    ).not.toContainEqual(expect.objectContaining({ name: RECORD_CONTEXT }));

    stack = await bootStack(withPack({ requires: ['record-context'], plugins: [host] }));
    expect(await stack.kernel.getServiceAsync(RECORD_CONTEXT_SERVICE)).toBe(marker);
  }, 120_000);
});

/**
 * ADR-0161 — `requires: ['knowledge']` mounts `KnowledgeServicePlugin` and ONE
 * vector store, chosen by the platform database. This boot's database is an
 * in-memory SQLite, so the store is `turso` on an in-memory libSQL database
 * (`resolveKnowledgeStore`); `serve` over SQLite gets `turso` on
 * `.objectstack/data/knowledge.db`, and over PostgreSQL `pgvector` — that
 * branch runs on the live PostgreSQL, in `@objectstack/knowledge-pgvector`.
 * Sources are still written in app code: a plugin registers one here.
 */
describe("requires: ['knowledge'] — the knowledge service and one store", () => {
  const KNOWLEDGE = 'com.objectstack.service.knowledge';
  const TURSO = 'com.objectstack.plugin.knowledge-turso';
  const PGVECTOR = 'com.objectstack.plugin.knowledge-pgvector';
  const article = {
    name: 'rqp_article', label: 'Article', pluralLabel: 'Articles', sharingModel: 'public_read_write',
    fields: {
      title: { name: 'title', type: 'text', label: 'Title', required: true },
      body: { name: 'body', type: 'textarea', label: 'Body' },
    },
  };
  const app = (extra: Bag = {}): Bag =>
    defineStack({ manifest: appManifest, objects: [article], ...extra } as never) as unknown as Bag;

  /** A deterministic bag-of-words embedder: shared words, close vectors. */
  class WordEmbedder {
    readonly id = 'rqp-words';
    readonly dimensions = 16;
    readonly model = 'rqp-words';
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => {
        const v = new Array<number>(this.dimensions).fill(0);
        for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
          let h = 0;
          for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          v[h % this.dimensions] += 1;
        }
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      });
    }
  }

  /** The app's own code: an embedder, a source on the mounted store, and one naming the other store. */
  class AppKnowledge {
    readonly name = 'com.example.rqp.knowledge';
    readonly version = '0.0.0';
    readonly type = 'standard';
    async init(ctx: { registerService(name: string, service: unknown): void }): Promise<void> {
      ctx.registerService('embedder', new WordEmbedder());
    }
    async start(ctx: { getService<T>(name: string): T }): Promise<void> {
      const svc = ctx.getService<{ registerSource(s: unknown): void }>('knowledge');
      svc.registerSource({ name: 'rqp_articles', label: 'Articles', adapter: 'turso', source: { kind: 'object', object: 'rqp_article', content: ['title', 'body'] } });
      svc.registerSource({ name: 'rqp_elsewhere', label: 'Elsewhere', adapter: 'pgvector', source: { kind: 'object', object: 'rqp_article', content: ['body'] } });
    }
  }

  it('the token: the service and the turso store; a record write is indexed and found, a source naming pgvector is refused', async () => {
    stack = await bootStack(app({ requires: ['realtime', 'knowledge'] }), { extraPlugins: [new AppKnowledge()] });
    expect(stack.kernel.hasPlugin(KNOWLEDGE)).toBe(true);
    expect(stack.kernel.hasPlugin(TURSO)).toBe(true);
    expect(stack.kernel.hasPlugin(PGVECTOR)).toBe(false);
    const knowledge = await stack.kernel.getServiceAsync<any>('knowledge');
    expect(knowledge.listAdapters()).toEqual(['turso']);

    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    await ql.insert('rqp_article', { title: 'Granite quarry RQP', body: 'basalt and granite slabs' }, { context: { isSystem: true } });
    const ec = { isSystem: true, userId: 'system', roles: [], permissions: [] };
    let hits: Array<{ sourceId: string; snippet: string }> = [];
    for (let i = 0; i < 50 && hits.length === 0; i++) {
      hits = (await knowledge.searchWithRefusals('granite quarry', { executionContext: ec, sourceIds: ['rqp_articles'] })).hits;
      if (hits.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(hits.map((h) => h.sourceId)).toEqual(['rqp_articles']);
    expect(hits[0]?.snippet).toContain('granite');

    const refused = await knowledge.search('granite', { executionContext: ec, sourceIds: ['rqp_elsewhere'] }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(String((refused as Error).message)).toContain("adapter 'pgvector' is not mounted (mounted: turso)");
  }, 120_000);

  it('control — no token: no knowledge service, no store, no Knowledge settings page', async () => {
    stack = await bootStack(app({ requires: ['realtime'] }));
    expect(stack.kernel.hasPlugin(KNOWLEDGE)).toBe(false);
    expect(stack.kernel.hasPlugin(TURSO)).toBe(false);
    await expect(stack.kernel.getServiceAsync('knowledge')).rejects.toThrow();
    const settings = await stack.kernel.getServiceAsync<any>('settings');
    await expect(settings.getNamespace('knowledge')).rejects.toMatchObject({ code: 'SETTINGS_UNKNOWN_NAMESPACE' });
  }, 120_000);

  it('a host that mounts the service itself keeps its own, and the runtime adds no store', async () => {
    class HostKnowledge {
      readonly name = KNOWLEDGE;
      readonly version = '0.0.0';
      readonly type = 'standard';
      async init(): Promise<void> {}
    }
    const constructed = await constructServedProviders({
      config: app({ requires: ['knowledge'] }),
      held: [new HostKnowledge()],
      packageRoot: process.cwd(),
    });
    const names = constructed.map((p) => (p as { name?: string }).name);
    expect(names).not.toContain(KNOWLEDGE);
    expect(names).not.toContain(TURSO);
    expect(names).not.toContain(PGVECTOR);
    // The control: without the host's instance both are constructed.
    const served = (
      await constructServedProviders({ config: app({ requires: ['knowledge'] }), held: [], packageRoot: process.cwd() })
    ).map((p) => (p as { name?: string }).name);
    expect(served).toEqual(expect.arrayContaining([KNOWLEDGE, TURSO]));
    expect(served).not.toContain(PGVECTOR);
  });

  // The arm `os dev` and `os serve` mount on SQLite: a FILE database, so the
  // store is a libSQL file whose URL the operator may save in Settings. On a
  // real kernel, because what is under test is the kernel's own order: the
  // settings service binds in `kernel:ready`, the saved value is written
  // after that, and the store opens at `kernel:bootstrapped`.
  it('a file database: the store opens the file the operator saved, in the directory OS_HOME names, and indexes into it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rqp-knowledge-'));
    const home = join(root, 'home');
    const saved = join(home, 'data', 'saved.db');
    const previousHome = process.env.OS_HOME;
    process.env.OS_HOME = home;
    try {
      const served = await constructServedProviders({
        config: app({ requires: ['knowledge'] }),
        held: [],
        packageRoot: join(root, 'app'),
        database: { driver: 'sqlite', url: `file:${join(home, 'data', 'objectstack.db')}` },
      });
      const mounted = served.filter((p) => [KNOWLEDGE, TURSO, PGVECTOR].includes((p as { name: string }).name));
      expect(mounted.map((p) => (p as { name: string }).name)).toEqual([KNOWLEDGE, TURSO]);

      /** The operator's save: after the settings service has bound, before the boot completes. */
      class SavesStoreUrl {
        readonly name = 'com.example.rqp.saves-store-url';
        readonly version = '0.0.0';
        readonly type = 'standard';
        readonly optionalDependencies = ['com.objectstack.service.settings'];
        outcome: unknown;
        async init(): Promise<void> {}
        async start(ctx: { getService<T>(name: string): T; hook(name: string, handler: () => Promise<void>): void }): Promise<void> {
          const settings = ctx.getService<{ set(ns: string, key: string, value: unknown, ec: unknown): Promise<unknown> }>('settings');
          ctx.hook('kernel:ready', async () => {
            this.outcome = await settings.set('knowledge', 'turso_url', `file:${saved}`, { isSystem: true }).then(
              () => 'saved',
              (e: unknown) => e,
            );
          });
        }
      }
      const saver = new SavesStoreUrl();
      // The two providers the file arm constructed are this boot's own: held, so the boot adds no second pair.
      stack = await bootStack(app({ requires: ['realtime', 'knowledge'] }), {
        extraPlugins: [...mounted, new AppKnowledge(), saver],
      } as never);
      expect(saver.outcome).toBe('saved');

      const knowledge = await stack.kernel.getServiceAsync<any>('knowledge');
      expect(await knowledge.getAdapter('turso').healthCheck()).toMatchObject({ ok: true });
      expect(existsSync(saved)).toBe(true);
      // Neither default was made: not the one under OS_HOME, and nothing under the app's own directory.
      expect(existsSync(join(home, 'data', 'knowledge.db'))).toBe(false);
      expect(existsSync(join(root, 'app', '.objectstack'))).toBe(false);

      const ql = await stack.kernel.getServiceAsync<any>('objectql');
      await ql.insert('rqp_article', { title: 'Slate quarry RQP', body: 'slate and shale tiles' }, { context: { isSystem: true } });
      const ec = { isSystem: true, userId: 'system', roles: [], permissions: [] };
      let hits: Array<{ sourceId: string }> = [];
      for (let i = 0; i < 50 && hits.length === 0; i++) {
        hits = (await knowledge.searchWithRefusals('slate quarry', { executionContext: ec, sourceIds: ['rqp_articles'] })).hits;
        if (hits.length === 0) await new Promise((r) => setTimeout(r, 50));
      }
      expect(hits.map((h) => h.sourceId)).toEqual(['rqp_articles']);
    } finally {
      await stack?.stop();
      stack = undefined;
      if (previousHome === undefined) delete process.env.OS_HOME;
      else process.env.OS_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  // LAST in the file: it clears the module cache to make the store's package unimportable.
  it('an install without the optional libSQL store: the service is constructed, the store is not, and the boot says so once', async () => {
    vi.resetModules();
    vi.doMock('@objectstack/knowledge-turso', () => {
      throw new Error("Cannot find module '@objectstack/knowledge-turso'");
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const served = (
        await constructServedProviders({ config: app({ requires: ['knowledge'] }), held: [], packageRoot: process.cwd() })
      ).map((p) => (p as { name?: string }).name);
      expect(served).toContain(KNOWLEDGE);
      expect(served).not.toContain(TURSO);
      const said = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('@objectstack/knowledge-turso'));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("requires: ['knowledge'] mounts KnowledgeTursoPlugin");
      expect(said[0]).toContain('an optional dependency this install does not have');
    } finally {
      warn.mockRestore();
      vi.doUnmock('@objectstack/knowledge-turso');
      vi.resetModules();
    }
  });
});
