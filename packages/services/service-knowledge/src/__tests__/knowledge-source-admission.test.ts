// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Knowledge search asks the exposure decision and the caller's field-level read
 * rules, at source granularity, before a source is searched
 * (`knowledge-source-admission.ts`; ADR-0090 D10 rule 1, ADR-0049).
 *
 * Every gate is pinned in two halves through the real `KnowledgeService`: the
 * refusal (a non-system caller whom the gate refuses gets no hit from the
 * source, and the adapter is never asked to search it) and the preservation (a
 * caller the gate admits, and the system context, still get the hit). The last
 * block drives `KnowledgeServicePlugin` on a real `LiteKernel`, so the wiring to
 * the registered `security` service is held too.
 */

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { AdapterContext, AdapterIndexStatus, IDataEngine, IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { KnowledgeHit, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeService, type KnowledgeLogger } from '../knowledge-service.js';
import { mayServeEarlierRuleTitle, type KnowledgeFieldSecurity } from '../knowledge-source-admission.js';
import { KnowledgeServicePlugin, isServiceNotRegisteredError } from '../knowledge-service-plugin.js';

const MEMBER: ExecutionContext = { userId: 'u_member', positions: ['member'], permissions: [], isSystem: false };
const MANAGER: ExecutionContext = { userId: 'u_manager', positions: ['manager'], permissions: [], isSystem: false };
const SYSTEM: ExecutionContext = { positions: [], permissions: [], isSystem: true };

interface ObjectDef {
  name: string;
  enable?: Record<string, unknown>;
  fields: Record<string, Record<string, unknown>>;
}

const TICKET: ObjectDef = {
  name: 'ticket',
  fields: {
    id: { type: 'text' },
    title: { type: 'text' },
    body: { type: 'textarea' },
    salary_note: { type: 'textarea' },
    status: { type: 'select' },
  },
};

function hitFor(sourceId: string, recordId = 'rec_1'): KnowledgeHit {
  return { chunkId: `${sourceId}-c`, documentId: `${sourceId}:${recordId}`, sourceId, sourceRecordId: recordId, score: 0.9, snippet: 'passage' };
}

/**
 * What the adapter's `indexStatus` answers (absent: it has none). `true`: the
 * fingerprint and recipe hash the call carries — an index built under the
 * current recipe. `'stateful'`: it holds what its writes and its last
 * `completeBuild` recorded, the way a generation-keeping adapter does.
 */
type IndexHeld = true | 'no-recipe' | 'other-recipe' | 'other-fingerprint' | 'throws' | 'stateful' | 'no-list' | 'no-complete';

function makeAdapter(proven?: IndexHeld): IKnowledgeAdapter & {
  searchSpy: ReturnType<typeof vi.fn>;
  indexStatus?: ReturnType<typeof vi.fn>;
} {
  const searchSpy = vi.fn(async (_q: string, opts: { source: KnowledgeSource }) => [hitFor(opts.source.name)]);
  const adapter = { id: 'memory', upsert: vi.fn(async () => undefined), delete: vi.fn(async () => undefined), search: searchSpy, searchSpy };
  if (proven === undefined) return adapter;
  const recorded: AdapterIndexStatus = {};
  const indexStatus = vi.fn(async (ctx: AdapterContext): Promise<AdapterIndexStatus> => {
    const index = ctx.index!;
    switch (proven) {
      case true:
      case 'no-list':
      case 'no-complete':
        return { fingerprint: index.fingerprint, recipeHash: index.recipeHash };
      case 'no-recipe': return { fingerprint: index.fingerprint };
      case 'other-recipe': return { fingerprint: index.fingerprint, recipeHash: 'rh1:earlier' };
      case 'other-fingerprint': return { fingerprint: 'fp1:earlier', recipeHash: index.recipeHash };
      case 'throws': throw new Error('store unreachable');
      // Documents written before any complete build: the active generation, no recipe hash.
      default: return recorded.recipeHash === undefined ? { fingerprint: index.fingerprint } : { ...recorded };
    }
  });
  // A store that lists its documents and records a complete build: what a proof needs besides the status.
  const listDocuments = vi.fn(async () => ({ documents: [] }));
  const completeBuildStub = vi.fn(async () => undefined);
  if (proven === 'no-list') return { ...adapter, indexStatus, completeBuild: completeBuildStub };
  if (proven === 'no-complete') return { ...adapter, indexStatus, listDocuments };
  if (proven !== 'stateful') return { ...adapter, indexStatus, listDocuments, completeBuild: completeBuildStub };
  return {
    ...adapter,
    indexStatus,
    listDocuments,
    beginBuild: vi.fn(async () => undefined),
    completeBuild: vi.fn(async (ctx: AdapterContext) => {
      recorded.fingerprint = ctx.index!.fingerprint;
      recorded.recipeHash = ctx.index!.recipeHash;
    }),
  };
}

function objectSource(id: string, object: string, content: string[], metadataFields?: string[]): KnowledgeSource {
  return {
    name: id,
    label: id,
    adapter: 'memory',
    source: { kind: 'object', object, content, ...(metadataFields ? { metadataFields } : {}) } as ObjectKnowledgeSource,
  };
}

/** A data engine whose row re-check admits every row, with a schema registry and a disabled-package predicate. */
function makeEngine(objects: ObjectDef[], opts: { disabled?: string[]; schemaThrows?: boolean } = {}) {
  const byName = new Map(objects.map((o) => [o.name, o]));
  const findSpy = vi.fn(async (_object: string, q: { where?: { id?: { $in?: string[] } } }) =>
    (q.where?.id?.$in ?? []).map((id) => ({ id })),
  );
  return {
    find: findSpy,
    getSchema: (name: string) => {
      if (opts.schemaThrows) throw new Error('registry unavailable');
      return byName.get(name);
    },
    registry: { isObjectPackageDisabled: (name: string) => (opts.disabled ?? []).includes(name) },
  } as unknown as IDataEngine & { find: typeof findSpy };
}

/** A security service answering the queryable fields per caller. */
function makeSecurity(queryableFor: (object: string, ctx?: ExecutionContext) => string[] | undefined): KnowledgeFieldSecurity {
  return {
    getQueryableFields: vi.fn(async (object: string, ctx?: ExecutionContext) => queryableFor(object, ctx)),
    getReadableFields: vi.fn(async () => Object.keys(TICKET.fields)),
  };
}

/** Members may not query `salary_note`; managers may query every field. */
const salaryHiddenFromMembers = makeSecurity((object, ctx) => {
  const all = Object.keys((object === 'ticket' ? TICKET : undefined)?.fields ?? {});
  return ctx?.userId === 'u_member' ? all.filter((f) => f !== 'salary_note') : all;
});

function setup(options: {
  objects?: ObjectDef[];
  sources: KnowledgeSource[];
  security?: KnowledgeFieldSecurity;
  disabled?: string[];
  schemaThrows?: boolean;
  logger?: KnowledgeLogger;
  /** What the adapter's `indexStatus` answers; absent, it has none. */
  proven?: IndexHeld;
}) {
  const adapter = makeAdapter(options.proven);
  const engine = makeEngine(options.objects ?? [TICKET], { disabled: options.disabled, schemaThrows: options.schemaThrows });
  const svc = new KnowledgeService({
    dataEngine: engine,
    logger: options.logger,
    resolveSecurity: options.security ? () => options.security : undefined,
  });
  svc.registerAdapter('memory', adapter);
  for (const s of options.sources) svc.registerSource(s);
  const searched = () => adapter.searchSpy.mock.calls.map((c) => (c[1] as { source: KnowledgeSource }).source.name);
  return { svc, adapter, engine, searched };
}

const ids = (hits: KnowledgeHit[]) => hits.map((h) => h.sourceId).sort();

describe('field gate — a source serving a field the caller may not query is not searched for that caller', () => {
  it('refusal: a member who reads the row but not `salary_note` gets no hit from the source naming it', async () => {
    const { svc, searched } = setup({
      sources: [objectSource('notes', 'ticket', ['body', 'salary_note']), objectSource('bodies', 'ticket', ['body'])],
      security: salaryHiddenFromMembers,
    });
    const out = await svc.search('raise', { executionContext: MEMBER });
    expect(ids(out)).toEqual(['bodies']);
    expect(searched()).toEqual(['bodies']); // never searched, not searched-then-dropped
  });

  it('the fields a source\'s `where` reads are judged too: one the caller may not query refuses the source', async () => {
    const selecting = (id: string, where: Record<string, unknown>): KnowledgeSource => {
      const source = objectSource(id, 'ticket', ['body']);
      return { ...source, source: { ...source.source, where } as ObjectKnowledgeSource };
    };
    const { svc, searched } = setup({
      sources: [
        selecting('by_key', { salary_note: { $ne: null } }),
        selecting('nested', { $and: [{ status: 'open' }, { $or: [{ $not: { salary_note: 'x' } }] }] }),
        selecting('dotted', { 'salary_note.grade': 3 }),
        selecting('comparand', { body: { $eq: { $field: 'salary_note' } } }),
        selecting('open_only', { status: 'open' }),
      ],
      security: salaryHiddenFromMembers,
    });
    expect(ids(await svc.search('raise', { executionContext: MEMBER }))).toEqual(['open_only']);
    expect(searched()).toEqual(['open_only']); // never searched, not searched-then-dropped
    // Preservation: a caller who may query the field is served every one of them.
    expect(ids(await svc.search('raise', { executionContext: MANAGER }))).toEqual(
      ['by_key', 'comparand', 'dotted', 'nested', 'open_only'],
    );
  });

  it('preservation: a manager who may query every field, and the system context, get the hit', async () => {
    const { svc } = setup({
      sources: [objectSource('notes', 'ticket', ['body', 'salary_note'])],
      security: salaryHiddenFromMembers,
    });
    expect(ids(await svc.search('raise', { executionContext: MANAGER }))).toEqual(['notes']);
    expect(ids(await svc.search('raise', { executionContext: SYSTEM }))).toEqual(['notes']);
  });

  it('`title` and `metadataFields` are served fields too: either one hidden refuses the source', async () => {
    const hideTitle = makeSecurity(() => ['id', 'body', 'salary_note', 'status']);
    const titleCase = setup({ sources: [objectSource('s', 'ticket', ['body'])], security: hideTitle });
    expect(await titleCase.svc.search('q', { executionContext: MEMBER })).toEqual([]);

    const hideStatus = makeSecurity(() => ['id', 'title', 'body', 'salary_note']);
    const metaCase = setup({ sources: [objectSource('s', 'ticket', ['body'], ['status'])], security: hideStatus });
    expect(await metaCase.svc.search('q', { executionContext: MEMBER })).toEqual([]);
    // Preservation: the same source without the metadata field is searched.
    const plain = setup({ sources: [objectSource('s', 'ticket', ['body'])], security: hideStatus });
    expect(ids(await plain.svc.search('q', { executionContext: MEMBER }))).toEqual(['s']);
  });

  it('a source that lists every field: one hidden field refuses it, while the fields the index never carries are not asked', async () => {
    const withSecret: ObjectDef = {
      name: 'ticket',
      fields: { ...TICKET.fields, api_token: { type: 'password' }, internal_score: { type: 'number', internal: true } },
    };
    const allButSecrets = makeSecurity(() => Object.keys(TICKET.fields));
    const every = Object.keys(withSecret.fields).filter((f) => f !== 'id');
    const admitted = setup({ objects: [withSecret], sources: [objectSource('all', 'ticket', every)], security: allButSecrets });
    expect(ids(await admitted.svc.search('q', { executionContext: MEMBER }))).toEqual(['all']);

    const refused = setup({ objects: [withSecret], sources: [objectSource('all', 'ticket', every)], security: salaryHiddenFromMembers });
    expect(await refused.svc.search('q', { executionContext: MEMBER })).toEqual([]);
  });

  it('a masked field is readable but not queryable: absent getQueryableFields, the read projection less every `maskingRule` field', async () => {
    const masked: ObjectDef = { ...TICKET, fields: { ...TICKET.fields, salary_note: { type: 'textarea', maskingRule: { strategy: 'full' } } } };
    const readOnly: KnowledgeFieldSecurity = { getReadableFields: vi.fn(async () => Object.keys(TICKET.fields)) };
    const refused = setup({ objects: [masked], sources: [objectSource('s', 'ticket', ['salary_note'])], security: readOnly });
    expect(await refused.svc.search('q', { executionContext: MEMBER })).toEqual([]);
    const admitted = setup({ objects: [masked], sources: [objectSource('s', 'ticket', ['body'])], security: readOnly });
    expect(ids(await admitted.svc.search('q', { executionContext: MEMBER }))).toEqual(['s']);
  });

  it('no security service: the contract fallback refuses a `maskingRule` field and keeps the rest', async () => {
    const masked: ObjectDef = { ...TICKET, fields: { ...TICKET.fields, salary_note: { type: 'textarea', maskingRule: { strategy: 'full' } } } };
    const refused = setup({ objects: [masked], sources: [objectSource('s', 'ticket', ['salary_note'])] });
    expect(await refused.svc.search('q', { executionContext: MEMBER })).toEqual([]);
    const admitted = setup({ objects: [masked], sources: [objectSource('s', 'ticket', ['body'])] });
    expect(ids(await admitted.svc.search('q', { executionContext: MEMBER }))).toEqual(['s']);
  });

  it('fails closed: a field answer that throws, or a security service answering neither question, refuses the source', async () => {
    const error = vi.fn();
    const throwing: KnowledgeFieldSecurity = { getQueryableFields: vi.fn(async () => { throw new Error('boom'); }) };
    const thrown = setup({ sources: [objectSource('s', 'ticket', ['body'])], security: throwing, logger: { warn: vi.fn(), error } });
    expect(await thrown.svc.search('q', { executionContext: MEMBER })).toEqual([]);
    expect(thrown.searched()).toEqual([]);
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0][0])).toMatch(/fail-closed/);

    const silent: KnowledgeFieldSecurity = {
      getQueryableFields: vi.fn(async () => undefined),
      getReadableFields: vi.fn(async () => undefined),
    };
    const unanswered = setup({ sources: [objectSource('s', 'ticket', ['body'])], security: silent });
    expect(await unanswered.svc.search('q', { executionContext: MEMBER })).toEqual([]);
  });

  it('the answer is asked once per object per search, however many sources read the object', async () => {
    const security = makeSecurity(() => Object.keys(TICKET.fields));
    const { svc } = setup({
      sources: [objectSource('a', 'ticket', ['body']), objectSource('b', 'ticket', ['title'])],
      security,
    });
    expect(ids(await svc.search('q', { executionContext: MEMBER }))).toEqual(['a', 'b']);
    expect(security.getQueryableFields).toHaveBeenCalledTimes(1);
  });
});

describe('exposure gate — an object the caller\'s exposure decision refuses is not searched', () => {
  const sealed: ObjectDef = { ...TICKET, name: 'sealed', enable: { apiEnabled: false } };
  const getOnly: ObjectDef = { ...TICKET, name: 'get_only', enable: { apiMethods: ['get'] } };

  it('`apiEnabled: false`: dropped for an end-user context, kept for the system context', async () => {
    const { svc, searched } = setup({ objects: [sealed, TICKET], sources: [objectSource('sealed', 'sealed', ['body']), objectSource('open', 'ticket', ['body'])] });
    expect(ids(await svc.search('q', { executionContext: MANAGER }))).toEqual(['open']);
    expect(searched()).toEqual(['open']);
    expect(ids(await svc.search('q', { executionContext: SYSTEM }))).toEqual(['open', 'sealed']);
  });

  it('an `apiMethods` whitelist that does not grant `search` refuses; one granting `list` admits', async () => {
    const listing: ObjectDef = { ...TICKET, name: 'listing', enable: { apiMethods: ['list'] } };
    const { svc } = setup({ objects: [getOnly, listing], sources: [objectSource('g', 'get_only', ['body']), objectSource('l', 'listing', ['body'])] });
    expect(ids(await svc.search('q', { executionContext: MANAGER }))).toEqual(['l']);
  });

  it('an object of a disabled package: dropped for an end-user context, kept for the system context', async () => {
    const { svc } = setup({ sources: [objectSource('s', 'ticket', ['body'])], disabled: ['ticket'] });
    expect(await svc.search('q', { executionContext: MANAGER })).toEqual([]);
    expect(ids(await svc.search('q', { executionContext: SYSTEM }))).toEqual(['s']);
  });

  it('a `sys_*` object follows its AI-read posture: served only with `enable.aiReadable: true`', async () => {
    const closed: ObjectDef = { ...TICKET, name: 'sys_closed_note' };
    const open: ObjectDef = { ...TICKET, name: 'sys_open_note', enable: { aiReadable: true } };
    const { svc } = setup({
      objects: [closed, open],
      sources: [objectSource('closed', 'sys_closed_note', ['body']), objectSource('open', 'sys_open_note', ['body'])],
    });
    expect(ids(await svc.search('q', { executionContext: MANAGER }))).toEqual(['open']);
    expect(ids(await svc.search('q', { executionContext: SYSTEM }))).toEqual(['closed', 'open']);
  });

  it('fails closed: a schema read that throws refuses the source', async () => {
    const { svc, searched } = setup({ sources: [objectSource('s', 'ticket', ['body'])], schemaThrows: true, logger: { warn: vi.fn(), error: vi.fn() } });
    expect(await svc.search('q', { executionContext: MANAGER })).toEqual([]);
    expect(searched()).toEqual([]);
  });
});

describe('no context, no engine, foreign hits — an object source no gate can judge is never served', () => {
  it('no context: an object source is not searched, even when its hits carry no `sourceRecordId`', async () => {
    const adapter = makeAdapter();
    adapter.search = vi.fn(async (_q: string, opts: { source: KnowledgeSource }) => [
      { chunkId: 'c', documentId: 'd', sourceId: opts.source.name, score: 0.9, snippet: 'passage' },
    ]);
    const svc = new KnowledgeService({ dataEngine: makeEngine([TICKET]) });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('notes', 'ticket', ['body']));
    expect(ids(await svc.search('q'))).toEqual([]);
    expect(adapter.search).not.toHaveBeenCalled();
    // Preservation: the system context still reaches the source.
    expect(ids(await svc.search('q', { executionContext: SYSTEM }))).toEqual(['notes']);
  });

  it('no data engine: an object source is not searched for an end-user context', async () => {
    const adapter = makeAdapter();
    adapter.search = vi.fn(async (_q: string, opts: { source: KnowledgeSource }) => [
      { chunkId: 'c', documentId: 'd', sourceId: opts.source.name, score: 0.9, snippet: 'passage' },
    ]);
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('notes', 'ticket', ['body']));
    expect(await svc.search('q', { executionContext: MANAGER })).toEqual([]);
    expect(adapter.search).not.toHaveBeenCalled();
  });

  it('an admitted object source\'s hit with no `sourceRecordId` cannot be re-checked and is dropped', async () => {
    const adapter = makeAdapter();
    adapter.search = vi.fn(async (_q: string, opts: { source: KnowledgeSource }) => [
      { chunkId: 'a', documentId: 'a', sourceId: opts.source.name, sourceRecordId: 'rec_1', score: 0.9, snippet: 'row' },
      { chunkId: 'b', documentId: 'b', sourceId: opts.source.name, score: 0.8, snippet: 'unplaced' },
    ]);
    const svc = new KnowledgeService({ dataEngine: makeEngine([TICKET]) });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('notes', 'ticket', ['body']));
    expect((await svc.search('q', { executionContext: MANAGER })).map((h) => h.chunkId)).toEqual(['a']);
  });

  it('a hit naming another source than the one searched is dropped (a store two sources share)', async () => {
    const adapter = makeAdapter();
    // Every search answers the refused source's passage as well as its own.
    adapter.search = vi.fn(async (_q: string, opts: { source: KnowledgeSource }) =>
      opts.source.name === 'notes' ? [hitFor('notes')] : [hitFor(opts.source.name), hitFor('notes')]);
    const warn = vi.fn();
    const svc = new KnowledgeService({ dataEngine: makeEngine([TICKET]), resolveSecurity: () => salaryHiddenFromMembers, logger: { warn } });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('notes', 'ticket', ['body', 'salary_note']));
    svc.registerSource(objectSource('bodies', 'ticket', ['body']));
    expect(ids(await svc.search('q', { executionContext: MEMBER }))).toEqual(['bodies']);
    expect(warn).toHaveBeenCalled();
    // Preservation: the manager reaches both sources, each once.
    expect(ids(await svc.search('q', { executionContext: MANAGER }))).toEqual(['bodies', 'notes']);
  });
});

describe('KnowledgeServicePlugin wires the field gate to the registered `security` service', () => {
  class FakeHostPlugin implements Plugin {
    name = 'test.fake.host';
    version = '1.0.0';
    type = 'standard' as const;
    constructor(private readonly withSecurity: boolean) {}
    async init(ctx: PluginContext): Promise<void> {
      ctx.registerService('objectql', makeEngine([TICKET]));
      if (this.withSecurity) ctx.registerService('security', salaryHiddenFromMembers);
    }
  }

  async function boot(withSecurity: boolean) {
    const kernel = new LiteKernel();
    kernel.use(new FakeHostPlugin(withSecurity));
    kernel.use(new KnowledgeServicePlugin({ enableEventSync: false, sources: [objectSource('notes', 'ticket', ['body', 'salary_note'])] }));
    await kernel.bootstrap();
    const svc = kernel.getService<KnowledgeService>('knowledge');
    svc.registerAdapter('memory', makeAdapter());
    return { kernel, svc };
  }

  it('refusal and preservation through the kernel: the member gets no hit, the manager does', async () => {
    const { kernel, svc } = await boot(true);
    expect(await svc.search('raise', { executionContext: MEMBER })).toEqual([]);
    expect(ids(await svc.search('raise', { executionContext: MANAGER }))).toEqual(['notes']);
    await kernel.shutdown();
  });

  it('no `security` service registered: the lookup miss reads as absent, and the fallback admits an unmasked source', async () => {
    const { kernel, svc } = await boot(false);
    expect(ids(await svc.search('raise', { executionContext: MEMBER }))).toEqual(['notes']);
    await kernel.shutdown();
  });

  it('a `security` lookup that throws anything but the not-registered miss fails closed, reported once at error', async () => {
    const error = vi.fn();
    const plugin = new KnowledgeServicePlugin({ enableEventSync: false, sources: [objectSource('notes', 'ticket', ['body']), objectSource('titles', 'ticket', ['title'])] });
    const services: Record<string, unknown> = { objectql: makeEngine([TICKET]) };
    const ctx = {
      getService: (name: string) => {
        if (name === 'security') throw new Error("Service 'security' is async - use await");
        if (name in services) return services[name];
        throw new Error(`[Kernel] Service '${name}' not found`);
      },
      registerService: (name: string, svc: unknown) => { services[name] = svc; },
      logger: { info: vi.fn(), warn: vi.fn(), error, debug: vi.fn() },
    } as unknown as PluginContext;
    await plugin.init(ctx);
    const svc = services.knowledge as KnowledgeService;
    svc.registerAdapter('memory', makeAdapter());
    expect(await svc.search('q', { executionContext: MANAGER })).toEqual([]);
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0][0])).toMatch(/fail-closed/);
    // Preservation: the system context bypasses the gate.
    expect(ids(await svc.search('q', { executionContext: SYSTEM }))).toEqual(['notes', 'titles']);
  });

  it('isServiceNotRegisteredError reads only the kernel\'s not-registered miss as absence', () => {
    expect(isServiceNotRegisteredError(new Error("[Kernel] Service 'security' not found"), 'security')).toBe(true);
    expect(isServiceNotRegisteredError(new Error("Service 'security' is async - use await"), 'security')).toBe(false);
    expect(isServiceNotRegisteredError(new Error("[Kernel] Service 'other' not found"), 'security')).toBe(false);
    expect(isServiceNotRegisteredError(new Error('boom'), 'security')).toBe(false);
  });
});

// The field gate asks about the field the title is read from — the object's
// display field (`documentTitleField`, ADR-0161 K5) — not a field named `title`.
describe('field gate — the title field is the object\'s display field', () => {
  const ACCOUNT: ObjectDef = {
    name: 'account',
    fields: { id: { type: 'text' }, name: { type: 'text' }, title: { type: 'text' }, body: { type: 'textarea' } },
  };

  it('refusal: a caller who may not query the display field gets no hit, even with `title` visible', async () => {
    const hideName = makeSecurity(() => ['id', 'title', 'body']);
    const { svc, searched } = setup({ objects: [ACCOUNT], sources: [objectSource('s', 'account', ['body'])], security: hideName });
    expect(await svc.search('q', { executionContext: MEMBER })).toEqual([]);
    expect(searched()).toEqual([]);
  });

  it('preservation: a caller who may query the display field gets the hit', async () => {
    const all = makeSecurity(() => ['id', 'name', 'title', 'body']);
    const { svc } = setup({ objects: [ACCOUNT], sources: [objectSource('s', 'account', ['body'])], security: all, proven: true });
    expect(ids(await svc.search('q', { executionContext: MEMBER }))).toEqual(['s']);
  });
});

// The gate's former `title` arm: a document indexed before the title became
// the display field carries the value of a field named `title`. The gate no
// longer asks about that field; instead a source over which such a document
// could be served is searched only once its index is proven built under the
// current recipe (the adapter's `indexStatus` reports the fingerprint and the
// recipe hash the service computes now), and is refused
// KNOWLEDGE_REBUILD_REQUIRED (409) until then — never served through a gate
// that asks about `title`.
describe('field gate — the earlier title rule: searched only once the index is proven built under the current recipe', () => {
  const ACCOUNT: ObjectDef = {
    name: 'account',
    fields: { id: { type: 'text' }, name: { type: 'text' }, title: { type: 'text' }, body: { type: 'textarea' } },
  };
  const hideTitle = makeSecurity(() => ['id', 'name', 'body']);
  const queryAll = makeSecurity(() => ['id', 'name', 'title', 'body']);

  it('proven: a caller who may not query `title` is served — the arm is gone for a source built under the current recipe', async () => {
    const { svc, adapter, searched } = setup({ objects: [ACCOUNT], sources: [objectSource('s', 'account', ['body'])], security: hideTitle, proven: true });
    expect(ids(await svc.search('q', { executionContext: MEMBER }))).toEqual(['s']);
    expect(searched()).toEqual(['s']);
    expect(adapter.indexStatus).toHaveBeenCalledOnce();
  });

  it.each([
    ['an adapter with no indexStatus', undefined, 'never'],
    ['an adapter with no completeBuild, whose status reads current', 'no-complete' as const, 'never'],
    ['an adapter with no listDocuments, whose status reads current: its builds purge nothing', 'no-list' as const, 'never'],
    ['an index that records no recipe hash (no complete build completed)', 'no-recipe' as const, 'rebuild'],
    ['an index last completed under another recipe', 'other-recipe' as const, 'rebuild'],
    ['an index under another fingerprint', 'other-fingerprint' as const, 'rebuild'],
    ['an indexStatus that throws', 'throws' as const, 'unreadable'],
  ])('unproven (%s): refused KNOWLEDGE_REBUILD_REQUIRED / 409 for every non-system caller, never searched', async (_label, held, ends) => {
    for (const security of [hideTitle, queryAll]) {
      const warn = vi.fn();
      const { svc, searched } = setup({
        objects: [ACCOUNT],
        sources: [objectSource('s', 'account', ['body'])],
        security,
        ...(held === undefined ? {} : { proven: held }),
        logger: { warn, error: vi.fn() },
      });
      let thrown: unknown;
      try {
        await svc.searchWithRefusals('q', { executionContext: MEMBER });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toMatchObject({ code: 'KNOWLEDGE_REBUILD_REQUIRED', status: 409 });
      expect((thrown as { refused: unknown[] }).refused).toEqual([
        expect.objectContaining({ sourceId: 's', code: 'KNOWLEDGE_REBUILD_REQUIRED', status: 409 }),
      ]);
      expect(searched()).toEqual([]);
      const line = String(warn.mock.calls[warn.mock.calls.length - 1]?.[0]);
      expect(line).toContain("source 's' not searched (KNOWLEDGE_REBUILD_REQUIRED)");
      // A refusal no rebuild can end never promises one, to the caller or the operator.
      const said = (thrown as { refused: Array<{ message: string }> }).refused[0].message;
      if (ends === 'never') {
        expect(said).toContain('No rebuild changes that');
        expect(line).toContain('No rebuild can prove it');
      } else {
        expect(said).not.toContain('No rebuild');
        expect(line).not.toContain('No rebuild');
      }
      // Preservation: the system context bypasses every gate, this one too.
      expect(ids(await svc.search('q', { executionContext: SYSTEM }))).toEqual(['s']);
    }
  });

  it('a source with `refresh.onRecordChange: false` is never proven, whatever its status reads: its builds purge nothing', async () => {
    const optedOut = objectSource('s', 'account', ['body']);
    const source = { ...optedOut, refresh: { onRecordChange: false } } as KnowledgeSource;
    const warn = vi.fn();
    const { svc, adapter, searched } = setup({ objects: [ACCOUNT], sources: [source], security: queryAll, proven: true, logger: { warn, error: vi.fn() } });
    const thrown = await svc.searchWithRefusals('q', { executionContext: MEMBER }).catch((err: unknown) => err);
    expect(thrown).toMatchObject({ code: 'KNOWLEDGE_REBUILD_REQUIRED', status: 409 });
    expect((thrown as { refused: Array<{ message: string }> }).refused[0].message).toContain('No rebuild changes that');
    expect(String(warn.mock.calls[warn.mock.calls.length - 1]?.[0])).toContain('refresh.onRecordChange is false');
    expect(adapter.indexStatus).not.toHaveBeenCalled();
    expect(searched()).toEqual([]);
    // Preservation: the system context bypasses it, and the same source synced by the service is proven.
    expect(ids(await svc.search('q', { executionContext: SYSTEM }))).toEqual(['s']);
    const synced = setup({ objects: [ACCOUNT], sources: [optedOut], security: queryAll, proven: true });
    expect(ids(await synced.svc.search('q', { executionContext: MEMBER }))).toEqual(['s']);
  });

  it('beside a searchable source, the unproven one is named in `refused` and the other still answers', async () => {
    const { svc, searched } = setup({
      objects: [ACCOUNT, TICKET],
      sources: [objectSource('unproven', 'account', ['body']), objectSource('tickets', 'ticket', ['body'])],
      security: queryAll,
    });
    const report = await svc.searchWithRefusals('q', { executionContext: MEMBER });
    expect(ids(report.hits)).toEqual(['tickets']);
    expect(report.refused).toEqual([
      expect.objectContaining({ sourceId: 'unproven', code: 'KNOWLEDGE_REBUILD_REQUIRED', status: 409 }),
    ]);
    expect(searched()).toEqual(['tickets']);
  });

  it('a source the earlier rule served nothing extra for is searched without asking for the proof', async () => {
    // TICKET's display field IS `title`; a source listing `title` serves it; an object with no `title` field.
    const NOTE: ObjectDef = { name: 'note', fields: { id: { type: 'text' }, name: { type: 'text' }, body: { type: 'textarea' } } };
    const { svc, adapter, searched } = setup({
      objects: [ACCOUNT, TICKET, NOTE],
      sources: [
        objectSource('tickets', 'ticket', ['body']),
        objectSource('titled', 'account', ['body', 'title']),
        objectSource('notes', 'note', ['body']),
      ],
      security: makeSecurity((object) => (object === 'note' ? ['id', 'name', 'body'] : ['id', 'name', 'title', 'body'])),
      proven: 'throws',
    });
    expect(ids(await svc.search('q', { executionContext: MEMBER }))).toEqual(['notes', 'tickets', 'titled']);
    expect(searched().sort()).toEqual(['notes', 'tickets', 'titled']);
    expect(adapter.indexStatus).not.toHaveBeenCalled();
  });

  it('rebuilt: a source refused for want of proof is served once a complete build has completed', async () => {
    const { svc, adapter, searched } = setup({ objects: [ACCOUNT], sources: [objectSource('s', 'account', ['body'])], security: hideTitle, proven: 'stateful' });
    await expect(svc.search('q', { executionContext: MEMBER })).rejects.toMatchObject({ code: 'KNOWLEDGE_REBUILD_REQUIRED', status: 409 });
    expect(searched()).toEqual([]);
    // A refused search starts no build and writes nothing.
    for (const member of ['beginBuild', 'upsert', 'completeBuild'] as const) {
      expect((adapter as unknown as Record<string, ReturnType<typeof vi.fn>>)[member]).not.toHaveBeenCalled();
    }
    const record = await svc.rebuildSource('s', { trigger: 'operator' });
    expect(record.status).toBe('done');
    expect((await svc.readIndexState('s')).state).toBe('current');
    expect(ids(await svc.search('q', { executionContext: MEMBER }))).toEqual(['s']);
  });

  // Reverse pins: with the proof in hand, no other arm is weakened — a field
  // the caller may not query still never reaches a hit.
  it.each([
    ['the display field', ['id', 'title', 'body'], ['body']],
    ['a content field', ['id', 'name', 'title'], ['body']],
    ['a metadata field', ['id', 'name', 'title', 'body'], ['body'], ['status']],
  ])('reverse pin, proven index: %s the caller may not query still refuses the source', async (_label, queryable, content, metadata?: string[]) => {
    const withStatus: ObjectDef = { ...ACCOUNT, fields: { ...ACCOUNT.fields, status: { type: 'select' } } };
    const { svc, adapter, searched } = setup({
      objects: [withStatus],
      sources: [objectSource('s', 'account', content, metadata)],
      security: makeSecurity(() => queryable),
      proven: true,
    });
    adapter.searchSpy.mockImplementation(async () => [{ ...hitFor('s'), title: 'synthetic-hidden-name-7c2d', metadata: { status: 'hidden' } }]);
    expect(await svc.search('q', { executionContext: MEMBER })).toEqual([]);
    expect(searched()).toEqual([]);
  });

  it('reverse pin, unproven index: a stored hit carrying an earlier-rule `title` never reaches a caller who may not query it', async () => {
    const { svc, adapter, searched } = setup({ objects: [ACCOUNT], sources: [objectSource('s', 'account', ['body'])], security: hideTitle, proven: 'no-recipe' });
    adapter.searchSpy.mockImplementation(async () => [{ ...hitFor('s'), title: 'synthetic-old-rule-title-4e1a' }]);
    const out = await svc.search('q', { executionContext: MEMBER }).catch((err: unknown) => err);
    expect(out).toMatchObject({ code: 'KNOWLEDGE_REBUILD_REQUIRED', status: 409 });
    expect(JSON.stringify(out)).not.toContain('synthetic-old-rule-title-4e1a');
    expect(searched()).toEqual([]);
  });
});

describe('mayServeEarlierRuleTitle — whether an earlier-rule index could serve a field the gate does not ask about', () => {
  const src = (content: string[], metadataFields?: string[]) => objectSource('s', 'x', content, metadataFields).source as ObjectKnowledgeSource;
  it.each([
    ['an object declaring `title` beside a `name` display field', { fields: { name: { type: 'text' }, title: { type: 'text' } } }, ['body'], true],
    ['an object whose display field is `title`', { fields: { title: { type: 'text' }, body: { type: 'textarea' } } }, ['body'], false],
    ['an object declaring no `title` field', { fields: { name: { type: 'text' }, body: { type: 'textarea' } } }, ['body'], false],
    ['a source that serves `title` itself', { fields: { name: { type: 'text' }, title: { type: 'text' } } }, ['title'], false],
    ['an `internal` `title` the index never carries', { fields: { name: { type: 'text' }, title: { type: 'text', internal: true } } }, ['body'], false],
    ['fields that cannot be enumerated, display field elsewhere', { nameField: 'subject' }, ['body'], true],
    ['no object definition (the title is read from `title`)', undefined, ['body'], false],
  ])('%s → %s', (_label, schema, content, expected) => {
    expect(mayServeEarlierRuleTitle(src(content), schema)).toBe(expected);
  });
});

// [ADR-0161 K4, guard two] The same gates, asked once for the AUTHOR when a
// `knowledge_source` item is saved: nobody builds an index over an object or
// a field they could not themselves search.
describe('admitAuthoredSource — source admission at save, as the authoring principal', () => {
  const item = (object: string, content: string[], extra: Record<string, unknown> = {}) => ({
    name: 'authored', label: 'Authored', adapter: 'memory', source: { kind: 'object', object, content, ...extra },
  });
  const sealed: ObjectDef = { ...TICKET, name: 'sealed', enable: { apiEnabled: false } };
  const getOnly: ObjectDef = { ...TICKET, name: 'get_only', enable: { apiMethods: ['get'] } };
  const sysClosed: ObjectDef = { ...TICKET, name: 'sys_closed_note' };
  const sysOpen: ObjectDef = { ...TICKET, name: 'sys_open_note', enable: { aiReadable: true } };

  it('a field the author may not query is refused PERMISSION_DENIED / 403, naming the object and the field', async () => {
    const { svc } = setup({ sources: [], security: salaryHiddenFromMembers });
    const verdict = await svc.admitAuthoredSource(item('ticket', ['body', 'salary_note']), MEMBER);
    expect(verdict).toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403, object: 'ticket', field: 'salary_note' });
    const message = (verdict as { message: string }).message;
    expect(message).toContain('knowledge source "authored" was not saved');
    expect(message).toContain("field 'salary_note' of object 'ticket'");
    expect(message).toContain('Remove the field from `content` and `metadataFields`');
    // The same source, by an author who may query the field, and by the engine itself.
    expect(await svc.admitAuthoredSource(item('ticket', ['body', 'salary_note']), MANAGER)).toEqual({ admitted: true });
    expect(await svc.admitAuthoredSource(item('ticket', ['body', 'salary_note']), SYSTEM)).toEqual({ admitted: true });
  });

  it('a `metadataFields` member, and the retired `contentFields` spelling, are judged as the fields they index', async () => {
    const { svc } = setup({ sources: [], security: salaryHiddenFromMembers });
    expect(await svc.admitAuthoredSource(item('ticket', ['body'], { metadataFields: ['salary_note'] }), MEMBER))
      .toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403, field: 'salary_note' });
    const retired = { name: 'authored', label: 'A', adapter: 'memory', source: { kind: 'object', object: 'ticket', contentFields: ['salary_note'] } };
    expect(await svc.admitAuthoredSource(retired, MEMBER))
      .toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403, field: 'salary_note' });
  });

  it.each([
    ['a condition key', { salary_note: { $ne: null } }],
    ['a key under $and / $or / $not', { $and: [{ status: 'open' }, { $or: [{ $not: { salary_note: 'x' } }] }] }],
    ['a dotted path, by its first segment', { 'salary_note.grade': 3 }],
    ['a cross-field comparand', { body: { $eq: { $field: 'salary_note' } } }],
  ])('a field the `where` reads is judged like a served one: %s', async (_label, where) => {
    const { svc } = setup({ sources: [], security: salaryHiddenFromMembers });
    const verdict = await svc.admitAuthoredSource(item('ticket', ['body'], { where }), MEMBER);
    expect(verdict).toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403, object: 'ticket', field: 'salary_note' });
    const message = (verdict as { message: string }).message;
    expect(message).toContain("its `where` reads field 'salary_note' of object 'ticket'");
    expect(message).toContain('Remove the field from `where`');
    // The same source, by an author who may query the field, and by the engine itself.
    expect(await svc.admitAuthoredSource(item('ticket', ['body'], { where }), MANAGER)).toEqual({ admitted: true });
    expect(await svc.admitAuthoredSource(item('ticket', ['body'], { where }), SYSTEM)).toEqual({ admitted: true });
  });

  it('CONTROL: a `where` over fields the author may query is admitted, and a `where` that is no condition names no field', async () => {
    const { svc } = setup({ sources: [], security: salaryHiddenFromMembers });
    expect(await svc.admitAuthoredSource(item('ticket', ['body'], { where: { status: { $in: ['open', 'new'] } } }), MEMBER))
      .toEqual({ admitted: true });
    expect(await svc.admitAuthoredSource(item('ticket', ['body'], { where: 'status = open' }), MEMBER)).toEqual({ admitted: true });
  });

  it('a `where` key that is neither a logical key nor a field the author may query is refused: an unknown operator is not a pass', async () => {
    const { svc } = setup({ sources: [], security: salaryHiddenFromMembers });
    expect(await svc.admitAuthoredSource(item('ticket', ['body'], { where: { $nor: [{ status: 'open' }] } }), MEMBER))
      .toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403, field: '$nor' });
  });

  it("the object's display field is indexed as the title: an author who may not query it is refused though the source does not list it", async () => {
    const hideTitle = makeSecurity(() => ['id', 'body', 'salary_note', 'status']);
    const { svc } = setup({ sources: [], security: hideTitle });
    const verdict = await svc.admitAuthoredSource(item('ticket', ['body']), MEMBER);
    expect(verdict).toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403, field: 'title' });
    expect((verdict as { message: string }).message).toContain("display field");
  });

  it('a declared `title` that is not the display field is not indexed, so it is not asked at save; the display field still is', async () => {
    const ACCOUNT: ObjectDef = {
      name: 'account',
      fields: { id: { type: 'text' }, name: { type: 'text' }, title: { type: 'text' }, body: { type: 'textarea' } },
    };
    const hideTitle = makeSecurity(() => ['id', 'name', 'body']);
    const admitted = setup({ objects: [ACCOUNT], sources: [], security: hideTitle });
    expect(await admitted.svc.admitAuthoredSource(item('account', ['body']), MEMBER)).toEqual({ admitted: true });
    const hideName = makeSecurity(() => ['id', 'title', 'body']);
    const refused = setup({ objects: [ACCOUNT], sources: [], security: hideName });
    expect(await refused.svc.admitAuthoredSource(item('account', ['body']), MEMBER))
      .toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403, object: 'account', field: 'name' });
  });

  it.each([
    ['an object of a disabled package', { objects: [TICKET], disabled: ['ticket'] }, 'ticket', 'disabled package'],
    ['an object the API does not serve at all', { objects: [sealed] }, 'sealed', 'does not serve object'],
    ['an object whose `apiMethods` do not grant `search`', { objects: [getOnly] }, 'get_only', 'does not serve object'],
    ['a system object without `enable.aiReadable`', { objects: [sysClosed] }, 'sys_closed_note', 'does not opt into AI reads'],
  ])('%s is refused PERMISSION_DENIED / 403, naming the object', async (_label, opts, object, said) => {
    const { svc } = setup({ sources: [], ...opts });
    const verdict = await svc.admitAuthoredSource(item(object, ['body']), MANAGER);
    expect(verdict).toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403, object });
    expect((verdict as { message: string }).message).toContain(`'${object}'`);
    expect((verdict as { message: string }).message).toContain(said);
    // The engine's own write is admitted: a package install is judged at validate and publish.
    expect(await svc.admitAuthoredSource(item(object, ['body']), SYSTEM)).toEqual({ admitted: true });
  });

  it('CONTROL: a served object, and a system object that opts into AI reads, are admitted', async () => {
    const { svc } = setup({ sources: [], objects: [TICKET, sysOpen] });
    expect(await svc.admitAuthoredSource(item('ticket', ['body']), MANAGER)).toEqual({ admitted: true });
    expect(await svc.admitAuthoredSource(item('sys_open_note', ['body']), MANAGER)).toEqual({ admitted: true });
  });

  it('fails closed, SERVICE_UNAVAILABLE / 503: a gate that throws, a security service that answers neither question, no data engine', async () => {
    const thrown = setup({ sources: [], schemaThrows: true, logger: { warn: vi.fn(), error: vi.fn() } });
    expect(await thrown.svc.admitAuthoredSource(item('ticket', ['body']), MANAGER))
      .toMatchObject({ admitted: false, code: 'SERVICE_UNAVAILABLE', status: 503, object: 'ticket' });

    const mute: KnowledgeFieldSecurity = { getQueryableFields: async () => undefined, getReadableFields: async () => undefined };
    const unanswered = setup({ sources: [], security: mute });
    expect(await unanswered.svc.admitAuthoredSource(item('ticket', ['body']), MANAGER))
      .toMatchObject({ admitted: false, code: 'SERVICE_UNAVAILABLE', status: 503 });

    const noEngine = new KnowledgeService({});
    expect(await noEngine.admitAuthoredSource(item('ticket', ['body']), MANAGER))
      .toMatchObject({ admitted: false, code: 'SERVICE_UNAVAILABLE', status: 503 });
  });

  it('a save that carries no identity is refused; an item naming no object is left to the parse', async () => {
    const { svc } = setup({ sources: [] });
    expect(await svc.admitAuthoredSource(item('ticket', ['body']), undefined))
      .toMatchObject({ admitted: false, code: 'PERMISSION_DENIED', status: 403 });
    for (const shapeless of [null, {}, { name: 'x' }, { name: 'x', source: { kind: 'object' } }, { name: 'x', source: 'ticket' }]) {
      expect(await svc.admitAuthoredSource(shapeless, MANAGER), JSON.stringify(shapeless)).toEqual({ admitted: true });
    }
  });

  it('registers nothing and searches nothing: the verdict is a read', async () => {
    const { svc, adapter } = setup({ sources: [], security: salaryHiddenFromMembers });
    await svc.admitAuthoredSource(item('ticket', ['body']), MANAGER);
    expect(svc.listSources()).toEqual([]);
    expect(adapter.searchSpy).not.toHaveBeenCalled();
  });
});
