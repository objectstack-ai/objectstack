// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `search_knowledge`'s one definition and executor (ADR-0149 D2): the
 * `aiExposed` refusal and preservation halves, the caller's execution
 * context reaching the row-level re-check, and the `scope`, `granularity` and
 * `groupBy` arguments (ADR-0161 K9, rule 2): their bounds, their reaching the
 * service, the answer's whitelisted hit, and a withheld source answered as an
 * absent one.
 */

import { describe, it, expect, vi } from 'vitest';
import { KnowledgeService, recordToDocument } from '../knowledge-service.js';
import {
  SEARCH_KNOWLEDGE_DEFAULT_TOP_K,
  SEARCH_KNOWLEDGE_MAX_NAME_LENGTH,
  SEARCH_KNOWLEDGE_MAX_SCOPE_ENTRIES,
  SEARCH_KNOWLEDGE_MAX_SCOPE_IDS,
  SEARCH_KNOWLEDGE_MAX_TOP_K,
  SEARCH_KNOWLEDGE_TOOL_NAME,
  createKnowledgeTools,
  getKnowledgeToolDefinitions,
} from '../knowledge-tools.js';
import type { IDataEngine, IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { KnowledgeHit, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { PLATFORM_TOOLS_BY_PACKAGE } from '@objectstack/spec/system';

/** An adapter answering every search with the hits of the source it is asked about. */
function adapterWith(hitsBySource: Record<string, KnowledgeHit[]>): IKnowledgeAdapter & { searched: string[] } {
  const searched: string[] = [];
  return {
    id: 'memory',
    searched,
    upsert: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    search: vi.fn(async (_query: string, opts: { source: KnowledgeSource }) => {
      searched.push(opts.source.name);
      return hitsBySource[opts.source.name] ?? [];
    }),
  } as unknown as IKnowledgeAdapter & { searched: string[] };
}

function objectSource(id: string, object: string, extra: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    name: id,
    label: `${id} label`,
    adapter: 'memory',
    source: { kind: 'object', object, content: ['body'] } as ObjectKnowledgeSource,
    ...extra,
  };
}

function hit(sourceId: string, recordId: string, score: number): KnowledgeHit {
  return {
    chunkId: `${sourceId}-${recordId}-c`,
    documentId: `${sourceId}:${recordId}`,
    sourceId,
    sourceRecordId: recordId,
    score,
    snippet: `passage ${recordId}`,
    title: `Clause ${recordId}`,
  };
}

/** A service with one exposed and one withheld object source, and an engine that admits `readable` ids. */
function setup(readable: readonly string[] = ['p1', 'p2', 's1']) {
  const adapter = adapterWith({
    policy_clauses: [hit('policy_clauses', 'p1', 0.9), hit('policy_clauses', 'p2', 0.5)],
    staff_notes: [hit('staff_notes', 's1', 0.99)],
  });
  const contexts: unknown[] = [];
  const engine = {
    find: vi.fn(async (_object: string, query: { where: { id: { $in: string[] } }; context: unknown }) => {
      contexts.push(query.context);
      return query.where.id.$in.filter((id) => readable.includes(id)).map((id) => ({ id }));
    }),
  } as unknown as IDataEngine;
  const service = new KnowledgeService({ dataEngine: engine, logger: { warn: () => undefined } });
  service.registerAdapter('memory', adapter);
  service.registerSource(objectSource('policy_clauses', 'policy_clause'));
  service.registerSource(objectSource('staff_notes', 'staff_note', { aiExposed: false }));
  return { service, adapter, contexts };
}

const caller: ExecutionContext = { userId: 'u_1', organizationId: 'org_1', roles: [], permissions: [] } as unknown as ExecutionContext;

describe('search_knowledge — the definition', () => {
  it('is one definition, named as the service-ai group of the platform tool registry names it', () => {
    const [definition, ...rest] = getKnowledgeToolDefinitions();
    expect(rest).toEqual([]);
    expect(definition.name).toBe(SEARCH_KNOWLEDGE_TOOL_NAME);
    expect(PLATFORM_TOOLS_BY_PACKAGE['service-ai']).toContain(definition.name);
    expect(definition.parameters).toMatchObject({
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: { topK: { maximum: SEARCH_KNOWLEDGE_MAX_TOP_K }, sourceIds: { minItems: 1 } },
    });
    // The service hands over this same definition.
    expect(new KnowledgeService().knowledgeTools().definitions).toBe(getKnowledgeToolDefinitions());
  });
});

describe('search_knowledge — aiExposed', () => {
  it('searches only the exposed sources when no sourceIds are named, and lists only them', async () => {
    const { service, adapter } = setup();
    const answer = await service.knowledgeTools().searchKnowledge({ query: 'refund window' }, caller);
    expect(adapter.searched).toEqual(['policy_clauses']);
    expect(answer.sources).toEqual([{ id: 'policy_clauses', label: 'policy_clauses label' }]);
    expect(answer.hits.map((h) => h.sourceId)).toEqual(['policy_clauses', 'policy_clauses']);
  });

  it('refuses a named aiExposed:false source with the sentence an unknown id gets, and searches nothing', async () => {
    const { service, adapter } = setup();
    const tools = service.knowledgeTools();
    const withheld = await tools.searchKnowledge({ query: 'q', sourceIds: ['staff_notes'] }, caller).catch((e) => e);
    const unknown = await tools.searchKnowledge({ query: 'q', sourceIds: ['no_such_source'] }, caller).catch((e) => e);
    expect(withheld).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(unknown).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(withheld.message.replace('staff_notes', 'X')).toBe(unknown.message.replace('no_such_source', 'X'));
    expect(withheld.message).not.toContain('staff_notes label');
    expect(adapter.searched).toEqual([]);
  });

  it('control: the same withheld source IS reached by IKnowledgeService.search, which serves non-agent callers', async () => {
    const { service, adapter } = setup();
    const hits = await service.search('q', { sourceIds: ['staff_notes'], executionContext: caller });
    expect(adapter.searched).toEqual(['staff_notes']);
    expect(hits.map((h) => h.sourceId)).toEqual(['staff_notes']);
  });

  it('searches an exposed source named in sourceIds', async () => {
    const { service, adapter } = setup();
    const answer = await service.knowledgeTools().searchKnowledge({ query: 'q', sourceIds: ['policy_clauses'], topK: 1 }, caller);
    expect(adapter.searched).toEqual(['policy_clauses']);
    expect(answer.hits).toEqual([
      {
        sourceId: 'policy_clauses',
        documentId: 'policy_clauses:p1',
        title: 'Clause p1',
        snippet: 'passage p1',
        score: 0.9,
        record: { object: 'policy_clause', id: 'p1' },
      },
    ]);
  });
});

describe('search_knowledge — the caller\'s execution context', () => {
  it('passes the caller\'s context to the row-level re-check, which drops a record the caller cannot read', async () => {
    const { service, contexts } = setup(['p2']);
    const answer = await service.knowledgeTools().searchKnowledge({ query: 'q' }, caller);
    expect(contexts).toEqual([caller]);
    expect(answer.hits.map((h) => h.record?.id)).toEqual(['p2']);
  });

  it('without a context, the service fails closed on object-source hits', async () => {
    const { service } = setup();
    const answer = await service.knowledgeTools().searchKnowledge({ query: 'q' });
    expect(answer.hits).toEqual([]);
  });

  it('caps the answer at the default topK when none is named', async () => {
    const adapter = adapterWith({
      policy_clauses: Array.from({ length: 9 }, (_, i) => hit('policy_clauses', `p${i}`, 1 - i / 10)),
    });
    // Every row re-checks readable: the cap is the only thing that shortens the answer.
    const dataEngine = {
      find: async (_object: string, q: { where?: { id?: { $in?: string[] } } }) =>
        (q.where?.id?.$in ?? []).map((id) => ({ id })),
    } as unknown as IDataEngine;
    const service = new KnowledgeService({ dataEngine, logger: { warn: () => undefined } });
    service.registerAdapter('memory', adapter);
    service.registerSource(objectSource('policy_clauses', 'policy_clause'));
    const capped = (await service.knowledgeTools().searchKnowledge({ query: 'q' }, caller)).hits;
    expect(capped).toHaveLength(SEARCH_KNOWLEDGE_DEFAULT_TOP_K);
  });
});

describe('search_knowledge — malformed arguments', () => {
  it.each([
    [{}, 'query'],
    [{ query: '   ' }, 'query'],
    [{ query: 'q', topK: 0 }, 'topK'],
    [{ query: 'q', topK: SEARCH_KNOWLEDGE_MAX_TOP_K + 1 }, 'topK'],
    [{ query: 'q', sourceIds: 'policy_clauses' }, 'sourceIds'],
    // An empty list names no source: refused, never read as "search nothing"
    // (which would answer no passage, i.e. "nothing matched").
    [{ query: 'q', sourceIds: [] }, 'sourceIds'],
    [{ query: 'q', sources: ['policy_clauses'] }, 'sources'],
    // The organizations a search is scoped to are the service's to compute
    // from the caller's identity (ADR-0161 K8, item 9): never an argument.
    [{ query: 'q', organizationIds: ['org_b'] }, 'organizationIds'],
  ])('refuses %j with VALIDATION_ERROR naming %s, and searches nothing', async (input, named) => {
    const { service, adapter } = setup();
    const err = await service.knowledgeTools().searchKnowledge(input, caller).catch((e) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(err.message).toContain(named);
    expect(adapter.searched).toEqual([]);
  });
});

describe('search_knowledge — no searchable source', () => {
  it('answers no hits and no sources when every source is withheld', async () => {
    const adapter = adapterWith({ staff_notes: [hit('staff_notes', 's1', 1)] });
    const service = new KnowledgeService({ logger: { warn: () => undefined } });
    service.registerAdapter('memory', adapter);
    service.registerSource(objectSource('staff_notes', 'staff_note', { aiExposed: false }));
    const answer = await createKnowledgeTools(service).searchKnowledge({ query: 'q' }, caller);
    expect(answer).toEqual({ hits: [], sources: [] });
    expect(adapter.searched).toEqual([]);
  });
});

describe('search_knowledge — a refused source (ADR-0161 K7, rule 5)', () => {
  const rebuild = () =>
    Object.assign(new Error("Knowledge source 'policy_clauses' needs a rebuild."), {
      code: 'KNOWLEDGE_REBUILD_REQUIRED',
      status: 409,
    });

  /** Two exposed sources; `refusing` throws a coded refusal, the other answers. */
  function twoSources(refusing: readonly string[], refusal: () => Error = rebuild) {
    const adapter = adapterWith({ policy_clauses: [hit('policy_clauses', 'p1', 0.9)], faq: [hit('faq', 'f1', 0.4)] });
    const answer = adapter.search as unknown as ReturnType<typeof vi.fn>;
    const inner = answer.getMockImplementation()! as (query: string, opts: { source: KnowledgeSource }) => Promise<unknown>;
    answer.mockImplementation(async (query: string, opts: { source: KnowledgeSource }) => {
      if (refusing.includes(opts.source.name)) throw refusal();
      return inner(query, opts);
    });
    const engine = {
      find: vi.fn(async (_object: string, query: { where: { id: { $in: string[] } } }) =>
        query.where.id.$in.map((id) => ({ id }))),
    } as unknown as IDataEngine;
    const service = new KnowledgeService({ dataEngine: engine, logger: { warn: () => undefined } });
    service.registerAdapter('memory', adapter);
    service.registerSource(objectSource('policy_clauses', 'policy_clause'));
    service.registerSource(objectSource('faq', 'faq_entry'));
    return service;
  }

  it('names the refused source beside the hits of the source that answered', async () => {
    const answer = await createKnowledgeTools(twoSources(['policy_clauses'])).searchKnowledge({ query: 'q' }, caller);
    expect(answer.hits.map((h) => h.sourceId)).toEqual(['faq']);
    expect(answer.refused).toEqual([
      { sourceId: 'policy_clauses', code: 'KNOWLEDGE_REBUILD_REQUIRED', message: "Knowledge source 'policy_clauses' needs a rebuild." },
    ]);
  });

  it('refuses the call whole, coded, when no searched source can answer — never an empty answer', async () => {
    const tools = createKnowledgeTools(twoSources(['policy_clauses', 'faq']));
    await expect(tools.searchKnowledge({ query: 'q' }, caller)).rejects.toMatchObject({
      code: 'KNOWLEDGE_REBUILD_REQUIRED',
      status: 409,
      refused: [{ sourceId: 'policy_clauses' }, { sourceId: 'faq' }],
    });
  });

  it('control: a failure without a code is logged and skipped as before, and carries no refused list', async () => {
    const answer = await createKnowledgeTools(twoSources(['policy_clauses'], () => new Error('socket hang up')))
      .searchKnowledge({ query: 'q' }, caller);
    expect(answer.hits.map((h) => h.sourceId)).toEqual(['faq']);
    expect(answer).not.toHaveProperty('refused');
  });

  it('an answer with nothing refused carries no refused list', async () => {
    const answer = await createKnowledgeTools(twoSources([])).searchKnowledge({ query: 'q' }, caller);
    expect(answer).not.toHaveProperty('refused');
  });
});

describe('search_knowledge — scope, granularity and groupBy: the definition', () => {
  it('declares the three arguments with the bounds the executor holds them to', () => {
    const [definition] = getKnowledgeToolDefinitions();
    const props = (definition.parameters as { properties: Record<string, any> }).properties;
    expect(Object.keys(props).sort()).toEqual(['granularity', 'groupBy', 'query', 'scope', 'sourceIds', 'topK']);
    expect(props.scope).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: SEARCH_KNOWLEDGE_MAX_SCOPE_ENTRIES,
      items: {
        type: 'object',
        required: ['object', 'ids'],
        additionalProperties: false,
        properties: {
          object: { type: 'string', minLength: 1, maxLength: SEARCH_KNOWLEDGE_MAX_NAME_LENGTH },
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: SEARCH_KNOWLEDGE_MAX_SCOPE_IDS,
            items: { type: 'string', minLength: 1, maxLength: SEARCH_KNOWLEDGE_MAX_NAME_LENGTH },
          },
        },
      },
    });
    expect(props.granularity).toMatchObject({ type: 'string', enum: ['chunk', 'record'] });
    expect(props.groupBy).toMatchObject({ type: 'string', minLength: 1, maxLength: SEARCH_KNOWLEDGE_MAX_NAME_LENGTH });
    // The bounds the service holds its own `scope` option to.
    expect(SEARCH_KNOWLEDGE_MAX_SCOPE_ENTRIES).toBe(10);
    expect(SEARCH_KNOWLEDGE_MAX_SCOPE_IDS).toBe(500);
  });

  it('names each argument, and each hit member the new modes add, in the description', () => {
    const [{ description }] = getKnowledgeToolDefinitions();
    for (const name of ['`scope`', '`granularity: "record"`', '`groupBy`', '`groupValue`', '`headingPath`']) {
      expect(description).toContain(name);
    }
  });
});

describe('search_knowledge — scope, granularity and groupBy: malformed arguments', () => {
  const long = 'x'.repeat(SEARCH_KNOWLEDGE_MAX_NAME_LENGTH + 1);
  const nul = 'p1\u0000x';
  const entry = (extra: Record<string, unknown> = {}) => ({ object: 'policy_clause', ids: ['p1'], ...extra });
  it.each([
    ['not a list', { scope: { object: 'policy_clause', ids: ['p1'] } }, 'scope'],
    ['empty', { scope: [] }, 'scope'],
    ['too many entries', { scope: Array.from({ length: SEARCH_KNOWLEDGE_MAX_SCOPE_ENTRIES + 1 }, () => entry()) }, 'scope'],
    ['an entry that is not an object', { scope: ['policy_clause'] }, 'scope'],
    ['an entry with another key', { scope: [entry({ field: 'policy' })] }, 'scope'],
    ['an entry with no object', { scope: [{ ids: ['p1'] }] }, 'scope'],
    ['an empty object', { scope: [entry({ object: '' })] }, 'scope'],
    ['an object over the length bound', { scope: [entry({ object: long })] }, 'scope'],
    ['an object with a NUL', { scope: [entry({ object: 'policy\u0000clause' })] }, 'scope'],
    ['an entry with no ids', { scope: [{ object: 'policy_clause' }] }, 'scope'],
    ['an entry with empty ids', { scope: [entry({ ids: [] })] }, 'scope'],
    ['too many ids', { scope: [entry({ ids: Array.from({ length: SEARCH_KNOWLEDGE_MAX_SCOPE_IDS + 1 }, (_, i) => `p${i}`) })] }, 'scope'],
    ['an empty id', { scope: [entry({ ids: ['p1', ''] })] }, 'scope'],
    ['an id that is not a string', { scope: [entry({ ids: [1] })] }, 'scope'],
    ['an id over the length bound', { scope: [entry({ ids: [long] })] }, 'scope'],
    ['an id with a NUL', { scope: [entry({ ids: [nul] })] }, 'scope'],
    ['an unknown granularity', { granularity: 'passage' }, 'granularity'],
    ['an empty groupBy', { groupBy: '' }, 'groupBy'],
    ['a groupBy that is not a string', { groupBy: ['policy'] }, 'groupBy'],
    ['a groupBy over the length bound', { groupBy: long }, 'groupBy'],
    ['a groupBy with a NUL', { groupBy: 'pol\u0000icy' }, 'groupBy'],
    ['groupBy with granularity chunk', { groupBy: 'policy', granularity: 'chunk' }, 'groupBy'],
  ])('refuses %s with VALIDATION_ERROR naming the argument, and searches nothing', async (_case, args, named) => {
    const { service, adapter } = setup();
    const err = await service.knowledgeTools().searchKnowledge({ query: 'q', ...args }, caller).catch((e) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(err.message).toContain(`\`${named}\``);
    // A refusal never repeats a raw control byte or a caller string whole.
    expect(err.message).not.toContain('\u0000');
    expect(err.message).not.toContain(long);
    expect(adapter.searched).toEqual([]);
  });

  it('quotes and cuts a caller string a refusal repeats: an unknown key, an unknown source id', async () => {
    const { service } = setup();
    const tools = service.knowledgeTools();
    const key = `k${'y'.repeat(4000)}\u0000`;
    const keyErr = await tools.searchKnowledge({ query: 'q', [key]: 1 }, caller).catch((e) => e);
    expect(keyErr).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(keyErr.message).toContain(`"k${'y'.repeat(63)}…"`);
    expect(keyErr.message.length).toBeLessThan(300);
    const many = Array.from({ length: 40 }, (_, i) => `unknown_${i}`);
    const manyErr = await tools.searchKnowledge({ query: 'q', ...Object.fromEntries(many.map((k) => [k, 1])) }, caller).catch((e) => e);
    expect(manyErr.message).toContain('and 35 more');
    expect(manyErr.message).not.toContain('unknown_39');
    const idErr = await tools.searchKnowledge({ query: 'q', sourceIds: [`s${'z'.repeat(4000)}`] }, caller).catch((e) => e);
    expect(idErr).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(idErr.message).toContain(`"s${'z'.repeat(63)}…"`);
    expect(idErr.message.length).toBeLessThan(300);
  });

  it('repeats a short caller string as its JSON escape: a quote, a newline and a NUL never come back raw', async () => {
    const { service } = setup();
    const tools = service.knowledgeTools();
    const odd = 'a"b\nc\u0000d';
    const escaped = '"a\\"b\\nc\\u0000d"';
    expect(JSON.stringify(odd)).toBe(escaped);
    const keyErr = await tools.searchKnowledge({ query: 'q', [odd]: 1 }, caller).catch((e) => e);
    const idErr = await tools.searchKnowledge({ query: 'q', sourceIds: [odd] }, caller).catch((e) => e);
    expect(keyErr).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(idErr).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    for (const err of [keyErr, idErr]) {
      expect(err.message).toContain(escaped);
      expect(err.message).not.toContain('\n');
      expect(err.message).not.toContain('\u0000');
    }
  });
});

/**
 * The three arguments against the real knowledge service: one exposed clause
 * source over `clause` (content `body`, metadata `policy` and `status`), one
 * withheld note source over `note` (metadata `author`), an engine answering
 * the caller's re-read with the `readable` ids and the system freshness read
 * with the rows, and an adapter ranking the hits an index would answer.
 */
describe('search_knowledge — scope, granularity and groupBy over the knowledge service', () => {
  type Row = Record<string, unknown> & { id: string };
  const CLAUSES: Row[] = [
    { id: 'c1', body: 'annual leave', policy: 'P_leave', status: 'draft' },
    { id: 'c2', body: 'sick leave', policy: 'P_leave', status: 'live' },
    { id: 'c3', body: 'travel', policy: 'P_travel', status: 'live' },
  ];
  const NOTES: Row[] = [{ id: 'n1', body: 'staff note', author: 'A' }];
  const clauses = objectSource('clauses', 'clause', {
    source: { kind: 'object', object: 'clause', content: ['body'], metadataFields: ['policy', 'status'] } as ObjectKnowledgeSource,
  });
  const notes = objectSource('notes', 'note', {
    aiExposed: false,
    source: { kind: 'object', object: 'note', content: ['body'], metadataFields: ['author'] } as ObjectKnowledgeSource,
  });

  /** The hit an index answers for `row`'s passage `n`: the document's metadata and stored docHash, as an adapter returns them. */
  function indexHit(source: KnowledgeSource, row: Row, n: number, score: number, headingPath?: string[]): KnowledgeHit {
    const doc = recordToDocument(source, source.source as ObjectKnowledgeSource, row);
    return {
      chunkId: `${doc.id}#${n}`,
      documentId: doc.id,
      sourceId: source.name,
      sourceRecordId: row.id,
      score,
      snippet: `${row.body as string} (${n})`,
      metadata: doc.metadata,
      docHash: doc.docHash,
      ...(headingPath ? { headingPath } : {}),
    };
  }

  function setupModes(readable: readonly string[] = ['c1', 'c2', 'c3', 'n1']) {
    const tables: Record<string, Row[]> = { clause: CLAUSES, note: NOTES };
    const corpus: Record<string, KnowledgeHit[]> = {
      clauses: [
        indexHit(clauses, CLAUSES[0], 0, 0.9, ['Leave', 'Annual']),
        indexHit(clauses, CLAUSES[0], 1, 0.8),
        indexHit(clauses, CLAUSES[1], 0, 0.7),
        indexHit(clauses, CLAUSES[2], 0, 0.6),
      ],
      notes: [indexHit(notes, NOTES[0], 0, 0.99)],
    };
    const asked: Array<{ source: string; opts: Record<string, unknown> }> = [];
    const adapter = {
      id: 'memory',
      upsert: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      search: vi.fn(async (_q: string, opts: { source: KnowledgeSource; topK: number }) => {
        asked.push({ source: opts.source.name, opts: opts as unknown as Record<string, unknown> });
        return [...(corpus[opts.source.name] ?? [])].slice(0, opts.topK);
      }),
    } as unknown as IKnowledgeAdapter;
    const matches = (row: Row, where: Record<string, unknown> = {}): boolean =>
      Object.entries(where).every(([k, v]) => {
        if (k === '$and') return (v as Record<string, unknown>[]).every((w) => matches(row, w));
        if (v !== null && typeof v === 'object') return ((v as { $in: string[] }).$in).includes(row[k] as string);
        return row[k] === v;
      });
    const engine = {
      find: vi.fn(async (object: string, q: { where?: Record<string, unknown>; fields?: string[]; limit?: number; context?: { isSystem?: boolean } }, o?: { context?: { isSystem?: boolean } }) => {
        const system = (q.context ?? o?.context)?.isSystem === true;
        const rows = (tables[object] ?? []).filter((r) => matches(r, q.where) && (system || readable.includes(r.id)));
        const page = typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows;
        return page.map((r) => (q.fields ? Object.fromEntries(q.fields.filter((f) => f in r).map((f) => [f, r[f]])) : { ...r }));
      }),
    } as unknown as IDataEngine;
    const service = new KnowledgeService({ dataEngine: engine, logger: { warn: () => undefined, debug: () => undefined } });
    service.registerAdapter('memory', adapter);
    service.registerSource(clauses);
    service.registerSource(notes);
    return { service, tools: service.knowledgeTools(), asked };
  }

  const SOURCES = [{ id: 'clauses', label: 'clauses label' }];

  it('hands scope, granularity and groupBy to the service as its options of the same names', async () => {
    const { service, tools } = setupModes();
    const spy = vi.spyOn(service, 'searchWithRefusals');
    const scope = [{ object: 'clause', ids: ['c1', 'c2'] }];
    await tools.searchKnowledge({ query: 'leave', scope, granularity: 'record', groupBy: 'policy', topK: 3 }, caller);
    expect(spy).toHaveBeenCalledWith('leave', {
      sourceIds: ['clauses'],
      topK: 3,
      scope,
      granularity: 'record',
      groupBy: 'policy',
      executionContext: caller,
    });
  });

  it("granularity 'record': one hit per record, its best passage; the default stays one per passage", async () => {
    const { tools } = setupModes();
    const byRecord = await tools.searchKnowledge({ query: 'q', granularity: 'record' }, caller);
    expect(byRecord.hits.map((h) => [h.record?.id, h.score])).toEqual([['c1', 0.9], ['c2', 0.7], ['c3', 0.6]]);
    const byChunk = await tools.searchKnowledge({ query: 'q' }, caller);
    expect(byChunk.hits.map((h) => h.record?.id)).toEqual(['c1', 'c1', 'c2', 'c3']);
  });

  it("groupBy: one hit per group, carrying its groupValue and no other metadata", async () => {
    const { tools } = setupModes();
    const answer = await tools.searchKnowledge({ query: 'q', groupBy: 'policy' }, caller);
    expect(answer.hits.map((h) => [h.record?.id, h.groupValue])).toEqual([['c1', 'P_leave'], ['c3', 'P_travel']]);
    expect(JSON.stringify(answer)).not.toContain('draft');
  });

  it('scope: only hits from the named records', async () => {
    const { tools } = setupModes();
    const answer = await tools.searchKnowledge({ query: 'q', scope: [{ object: 'clause', ids: ['c2', 'c3'] }] }, caller);
    expect(answer.hits.map((h) => h.record?.id)).toEqual(['c2', 'c3']);
  });

  it('the hit is a whitelist: no chunkId, no docHash, no metadata; headingPath where the passage has one', async () => {
    const { tools } = setupModes();
    const answer = await tools.searchKnowledge({ query: 'q', groupBy: 'policy' }, caller);
    expect(answer.hits[0]).toEqual({
      sourceId: 'clauses',
      documentId: 'clauses:c1',
      snippet: 'annual leave (0)',
      score: 0.9,
      record: { object: 'clause', id: 'c1' },
      headingPath: ['Leave', 'Annual'],
      groupValue: 'P_leave',
    });
    for (const hit of answer.hits) {
      expect(hit).not.toHaveProperty('docHash');
      expect(hit).not.toHaveProperty('chunkId');
      expect(hit).not.toHaveProperty('metadata');
    }
  });

  it('reports no count of what the re-check or the scope removed: the whole answer is the hits and the sources', async () => {
    // c1 is unreadable to the caller; the scope removes c3.
    const { tools } = setupModes(['c2', 'c3']);
    const answer = await tools.searchKnowledge(
      { query: 'q', granularity: 'record', scope: [{ object: 'clause', ids: ['c1', 'c2'] }] },
      caller,
    );
    expect(answer).toEqual({
      hits: [{ sourceId: 'clauses', documentId: 'clauses:c2', snippet: 'sick leave (0)', score: 0.7, record: { object: 'clause', id: 'c2' } }],
      sources: SOURCES,
    });
  });

  it('a scope entry whose object only a withheld source indexes is answered as one whose object no source indexes', async () => {
    const withheld = setupModes();
    const absent = setupModes();
    const a = await withheld.tools.searchKnowledge({ query: 'q', scope: [{ object: 'note', ids: ['n1'] }] }, caller);
    const b = await absent.tools.searchKnowledge({ query: 'q', scope: [{ object: 'no_such_object', ids: ['n1'] }] }, caller);
    expect(a).toEqual({ hits: [], sources: SOURCES });
    expect(a).toEqual(b);
    expect(withheld.asked.map((x) => x.source)).toEqual(absent.asked.map((x) => x.source));
    expect(withheld.asked.map((x) => x.source)).not.toContain('notes');
  });

  it('a groupBy field only a withheld source indexes is answered as one no source indexes', async () => {
    const withheld = setupModes();
    const absent = setupModes();
    const a = await withheld.tools.searchKnowledge({ query: 'q', groupBy: 'author' }, caller);
    const b = await absent.tools.searchKnowledge({ query: 'q', groupBy: 'no_such_field' }, caller);
    expect(a).toEqual({ hits: [], sources: SOURCES });
    expect(a).toEqual(b);
    expect(withheld.asked.map((x) => x.source)).not.toContain('notes');
  });
});
