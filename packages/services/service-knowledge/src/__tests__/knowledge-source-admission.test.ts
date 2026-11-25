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
import type { IDataEngine, IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { KnowledgeHit, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeService, type KnowledgeLogger } from '../knowledge-service.js';
import type { KnowledgeFieldSecurity } from '../knowledge-source-admission.js';
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

function makeAdapter(): IKnowledgeAdapter & { searchSpy: ReturnType<typeof vi.fn> } {
  const searchSpy = vi.fn(async (_q: string, opts: { source: KnowledgeSource }) => [hitFor(opts.source.id)]);
  return { id: 'memory', upsert: vi.fn(async () => undefined), delete: vi.fn(async () => undefined), search: searchSpy, searchSpy };
}

function objectSource(id: string, object: string, contentFields: string[], metadataFields?: string[]): KnowledgeSource {
  return {
    id,
    label: id,
    adapter: 'memory',
    source: { kind: 'object', object, contentFields, ...(metadataFields ? { metadataFields } : {}) } as ObjectKnowledgeSource,
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
}) {
  const adapter = makeAdapter();
  const engine = makeEngine(options.objects ?? [TICKET], { disabled: options.disabled, schemaThrows: options.schemaThrows });
  const svc = new KnowledgeService({
    dataEngine: engine,
    logger: options.logger,
    resolveSecurity: options.security ? () => options.security : undefined,
  });
  svc.registerAdapter('memory', adapter);
  for (const s of options.sources) svc.registerSource(s);
  const searched = () => adapter.searchSpy.mock.calls.map((c) => (c[1] as { source: KnowledgeSource }).source.id);
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

  it("`'*'` serves every declared field: one hidden field refuses it, while the fields the index never carries are not asked", async () => {
    const withSecret: ObjectDef = {
      name: 'ticket',
      fields: { ...TICKET.fields, api_token: { type: 'password' }, internal_score: { type: 'number', internal: true } },
    };
    const allButSecrets = makeSecurity(() => Object.keys(TICKET.fields));
    const admitted = setup({ objects: [withSecret], sources: [objectSource('all', 'ticket', ['*'])], security: allButSecrets });
    expect(ids(await admitted.svc.search('q', { executionContext: MEMBER }))).toEqual(['all']);

    const refused = setup({ objects: [withSecret], sources: [objectSource('all', 'ticket', ['*'])], security: salaryHiddenFromMembers });
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

  it('a file / http source is untouched by either gate', async () => {
    const { svc } = setup({
      objects: [sealed],
      sources: [objectSource('sealed', 'sealed', ['body']), { id: 'web', label: 'web', adapter: 'memory', source: { kind: 'http', urls: ['https://x.test'] } as KnowledgeSource['source'] }],
    });
    expect(ids(await svc.search('q', { executionContext: MEMBER }))).toEqual(['web']);
  });
});

describe('no context, no engine, foreign hits — an object source no gate can judge is never served', () => {
  it('no context: an object source is not searched, even when its hits carry no `sourceRecordId`', async () => {
    const adapter = makeAdapter();
    adapter.search = vi.fn(async (_q: string, opts: { source: KnowledgeSource }) => [
      { chunkId: 'c', documentId: 'd', sourceId: opts.source.id, score: 0.9, snippet: 'passage' },
    ]);
    const svc = new KnowledgeService({ dataEngine: makeEngine([TICKET]) });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('notes', 'ticket', ['body']));
    svc.registerSource({ id: 'web', label: 'web', adapter: 'memory', source: { kind: 'http', urls: ['https://x.test'] } as KnowledgeSource['source'] });
    expect(ids(await svc.search('q'))).toEqual(['web']);
    expect((adapter.search as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { source: KnowledgeSource }).source.id)).toEqual(['web']);
    // Preservation: the system context still reaches the object source.
    expect(ids(await svc.search('q', { executionContext: SYSTEM }))).toEqual(['notes', 'web']);
  });

  it('no data engine: an object source is not searched for an end-user context', async () => {
    const adapter = makeAdapter();
    adapter.search = vi.fn(async (_q: string, opts: { source: KnowledgeSource }) => [
      { chunkId: 'c', documentId: 'd', sourceId: opts.source.id, score: 0.9, snippet: 'passage' },
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
      { chunkId: 'a', documentId: 'a', sourceId: opts.source.id, sourceRecordId: 'rec_1', score: 0.9, snippet: 'row' },
      { chunkId: 'b', documentId: 'b', sourceId: opts.source.id, score: 0.8, snippet: 'unplaced' },
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
      opts.source.id === 'notes' ? [hitFor('notes')] : [hitFor(opts.source.id), hitFor('notes')]);
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

  // A document indexed before the title became the display field carries the
  // value of the field named `title`, and stays in the index until a complete
  // reindex writes it again: the gate still asks about a declared `title`.
  it('refusal: a declared `title` the caller may not query still refuses the source — a stored hit may carry its value', async () => {
    const hideTitle = makeSecurity(() => ['id', 'name', 'body']);
    const { svc, adapter, searched } = setup({ objects: [ACCOUNT], sources: [objectSource('s', 'account', ['body'])], security: hideTitle });
    adapter.searchSpy.mockImplementation(async () => [{ ...hitFor('s'), title: 'synthetic-old-rule-title-4e1a' }]);
    expect(await svc.search('q', { executionContext: MEMBER })).toEqual([]);
    expect(searched()).toEqual([]);
  });

  it('preservation: a caller who may query both the display field and `title` gets the hit', async () => {
    const all = makeSecurity(() => ['id', 'name', 'title', 'body']);
    const { svc } = setup({ objects: [ACCOUNT], sources: [objectSource('s', 'account', ['body'])], security: all });
    expect(ids(await svc.search('q', { executionContext: MEMBER }))).toEqual(['s']);
  });
});
