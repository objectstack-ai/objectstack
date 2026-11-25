// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `search_knowledge`'s one definition and executor (ADR-0149 D2): the
 * `aiExposed` refusal and preservation halves, and the caller's execution
 * context reaching the row-level re-check.
 */

import { describe, it, expect, vi } from 'vitest';
import { KnowledgeService } from '../knowledge-service.js';
import {
  SEARCH_KNOWLEDGE_DEFAULT_TOP_K,
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
      searched.push(opts.source.id);
      return hitsBySource[opts.source.id] ?? [];
    }),
  } as unknown as IKnowledgeAdapter & { searched: string[] };
}

function objectSource(id: string, object: string, extra: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id,
    label: `${id} label`,
    adapter: 'memory',
    source: { kind: 'object', object, contentFields: ['body'] } as ObjectKnowledgeSource,
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
      // A file source's hits name no record: nothing for the row-level re-check to drop.
      policy_clauses: Array.from({ length: 9 }, (_, i) => {
        const { sourceRecordId: _record, ...fileHit } = hit('policy_clauses', `p${i}`, 1 - i / 10);
        return fileHit;
      }),
    });
    const service = new KnowledgeService({ logger: { warn: () => undefined } });
    service.registerAdapter('memory', adapter);
    service.registerSource({
      id: 'policy_clauses',
      label: 'Policies',
      adapter: 'memory',
      source: { kind: 'file', uris: ['file:///p.md'] },
    } as unknown as KnowledgeSource);
    const fileHits = (await service.knowledgeTools().searchKnowledge({ query: 'q' }, caller)).hits;
    expect(fileHits).toHaveLength(SEARCH_KNOWLEDGE_DEFAULT_TOP_K);
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
