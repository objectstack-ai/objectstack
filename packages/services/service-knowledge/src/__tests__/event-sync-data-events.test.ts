// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The knowledge event sync: which `data.record.*` events reach the service, and
 * what the service then makes of a written row.
 *
 * `data.record.*` envelopes carry the spec's `DataEvent` in `payload`: the
 * written row is `after`, the id is the required top-level `recordId`. The
 * envelope is never the row.
 *
 * A source's `where` decides which rows it indexes (ADR-0049: a declared key
 * holds on every path it applies to — the reindex walk already honoured it).
 * So for a created, updated or restored row the service does NOT build the
 * document from `after`: with a data engine bound it re-reads the row under
 * the source's `where`, indexes the re-read row when one comes back, and
 * deletes the document when none does. Without an engine a source with no
 * `where` still builds from `after`, and a source with one is skipped, said
 * once at `warn`.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  IDataEngine,
  IKnowledgeAdapter,
  RealtimeEventHandler,
  RealtimeEventPayload,
} from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeHit, KnowledgeSource } from '@objectstack/spec/ai';
import { RECORD_RESTORED_EVENT } from '@objectstack/spec/data';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin.js';
import type { KnowledgeService } from '../knowledge-service.js';

type Row = Record<string, unknown>;

/**
 * The rows of one object, and a `find` over them that applies what the sync
 * sends: scalar equality and `$and`. Any other operator is REFUSED by a throw,
 * so a query this double does not understand turns the suite red rather than
 * answering it wrongly. `limit` is applied by presence, after the filter.
 *
 * `holdNextFind()` makes the next `find` read the rows at call time but resolve
 * only when released — the window in which a second event can arrive.
 */
function makeEngine(initial: Row[] = []) {
  const rows = new Map<string, Row>(initial.map((r) => [String(r.id), { ...r }]));
  let hold: Promise<void> | undefined;

  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [key, value] of Object.entries(where)) {
      if (key === '$and') {
        if (!Array.isArray(value)) throw new Error('engine double: $and takes an array');
        if (!value.every((clause) => matches(row, clause as Record<string, unknown>))) return false;
        continue;
      }
      if (key.startsWith('$')) throw new Error(`engine double: operator ${key} is not implemented`);
      if (value !== null && typeof value === 'object') {
        throw new Error(`engine double: a non-scalar condition on '${key}' is not implemented`);
      }
      if (row[key] !== value) return false;
    }
    return true;
  };

  const find = vi.fn(async (
    _object: string,
    query?: { where?: Record<string, unknown>; limit?: number },
    _options?: { context?: unknown },
  ): Promise<Row[]> => {
    const matched = [...rows.values()].filter((row) => matches(row, query?.where));
    const bounded = typeof query?.limit === 'number' ? matched.slice(0, query.limit) : matched;
    const snapshot = bounded.map((row) => ({ ...row }));
    const gate = hold;
    hold = undefined;
    if (gate) await gate;
    return snapshot;
  });

  return {
    rows,
    find,
    engine: { find } as unknown as IDataEngine,
    put(row: Row) {
      rows.set(String(row.id), { ...row });
    },
    holdNextFind(): () => void {
      let release!: () => void;
      hold = new Promise<void>((resolve) => { release = resolve; });
      return release;
    },
  };
}

/** An adapter that keeps documents by id and answers a search by substring. */
function makeAdapter() {
  const docs = new Map<string, KnowledgeDocument>();
  const adapter: IKnowledgeAdapter = {
    id: 'memory',
    upsert: vi.fn(async (batch: KnowledgeDocument[]) => {
      for (const doc of batch) docs.set(doc.id, doc);
    }),
    delete: vi.fn(async (ids: string[]) => {
      for (const id of ids) docs.delete(id);
    }),
    search: vi.fn(async (query: string): Promise<KnowledgeHit[]> =>
      [...docs.values()]
        .filter((doc) => doc.content.includes(query))
        .map((doc) => ({
          chunkId: doc.id,
          documentId: doc.id,
          sourceId: doc.sourceId,
          sourceRecordId: doc.sourceRecordId,
          score: 1,
          snippet: doc.content,
        }))),
  };
  return { adapter, docs };
}

function makeCtx(engine?: IDataEngine) {
  let readyHook: (() => Promise<void>) | undefined;
  let handler: RealtimeEventHandler | undefined;
  let service: KnowledgeService | undefined;

  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: (name: string, fn: () => Promise<void>) => {
      if (name === 'kernel:ready') readyHook = fn;
    },
    registerService: (_name: string, svc: KnowledgeService) => { service = svc; },
    getService: (name: string) => {
      if (name === 'realtime') {
        return {
          publish: async () => undefined,
          subscribe: async (_channel: string, h: RealtimeEventHandler) => { handler = h; return 'sub-1'; },
          unsubscribe: async () => undefined,
        };
      }
      if (name === 'objectql' && engine) return engine;
      throw new Error(`[Kernel] Service '${name}' not found`);
    },
  };

  return {
    ctx,
    async boot(plugin: KnowledgeServicePlugin) {
      await plugin.init(ctx);
      await plugin.start(ctx);
      await readyHook?.();
      return {
        service: service!,
        deliver: (event: RealtimeEventPayload) => handler!(event),
      };
    },
  };
}

const AT = '2026-08-02T12:00:00.000Z';

/** A `data.record.*` envelope carrying the spec's `DataEvent`. */
function dataEvent(type: string, recordId: string, after?: Row): RealtimeEventPayload {
  return {
    type,
    object: 'kb_article',
    payload: {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      type,
      object: 'kb_article',
      recordId,
      ...(after ? { after } : {}),
      timestamp: AT,
    },
    timestamp: AT,
  };
}

const PUBLISHED: Row = { id: 'a1', title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' };
const DRAFT: Row = { ...PUBLISHED, body: 'Draft wording, not yet approved', status: 'draft' };

function source(where?: Record<string, unknown>): KnowledgeSource {
  return {
    name: 'kb',
    label: 'Knowledge base',
    adapter: 'memory',
    source: {
      kind: 'object',
      object: 'kb_article',
      content: ['title', 'body'],
      ...(where ? { where } : {}),
    },
  };
}

const PUBLISHED_ONLY = { status: 'published' };
const SYSTEM = { executionContext: { positions: [], permissions: [], systemPermissions: [], isSystem: true } };

async function bootWith(opts: { rows?: Row[]; where?: Record<string, unknown>; engine?: false }) {
  const db = makeEngine(opts.rows ?? []);
  const harness = makeCtx(opts.engine === false ? undefined : db.engine);
  const { service, deliver } = await harness.boot(new KnowledgeServicePlugin({ sources: [source(opts.where)] }));
  const memory = makeAdapter();
  service.registerAdapter('memory', memory.adapter);
  return { db, harness, service, deliver, ...memory };
}

describe('the event bridge: which data.record.* events reach the service', () => {
  it.each([
    ['data.record.created'],
    ['data.record.updated'],
    [RECORD_RESTORED_EVENT],
  ])('%s hands the service the RECORD (payload.after), not the event envelope', async (type) => {
    const harness = makeCtx();
    const { service, deliver } = await harness.boot(new KnowledgeServicePlugin());
    const upsert = vi.spyOn(service, 'handleRecordUpsert').mockResolvedValue(undefined);

    await deliver(dataEvent(type, 'a1', PUBLISHED));

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith('kb_article', PUBLISHED);
  });

  it('resolves the delete id from the required top-level recordId', async () => {
    const harness = makeCtx();
    const { service, deliver } = await harness.boot(new KnowledgeServicePlugin());
    const del = vi.spyOn(service, 'handleRecordDelete').mockResolvedValue(undefined);

    await deliver(dataEvent('data.record.deleted', 'a1'));

    expect(del).toHaveBeenCalledWith('kb_article', 'a1');
  });

  it('ignores a data event that carries no record body', async () => {
    const harness = makeCtx();
    const { service, deliver } = await harness.boot(new KnowledgeServicePlugin());
    const upsert = vi.spyOn(service, 'handleRecordUpsert').mockResolvedValue(undefined);

    await deliver(dataEvent('data.record.created', 'a1'));

    expect(upsert).not.toHaveBeenCalled();
  });

  it('says out loud that a predicate write leaves the index stale where no reconcile can repair it', async () => {
    // The source's adapter does not list its documents, so the reconcile a
    // predicate write asks for elsewhere cannot repair this index.
    const db = makeEngine([]);
    const harness = makeCtx(db.engine);
    const { service, deliver } = await harness.boot(new KnowledgeServicePlugin({ sources: [source()] }));
    service.registerAdapter('memory', makeAdapter().adapter);
    const upsert = vi.spyOn(service, 'handleRecordUpsert').mockResolvedValue(undefined);
    const del = vi.spyOn(service, 'handleRecordDelete').mockResolvedValue(undefined);

    await deliver({
      type: 'data.records.deleted',
      object: 'kb_article',
      payload: { id: '9c8b7a65-4321-4fed-8ba9-876543210fed', type: 'data.records.deleted', object: 'kb_article', matched: 12, timestamp: AT },
      timestamp: AT,
    });

    // A knowledge index is a per-record projection and `matched: 12` names no
    // record, so there is nothing to upsert or delete. A silent no-op here
    // would read exactly like "nothing happened". The two halves of the line
    // the warn draws (the reap guard covers retention deletes; application
    // predicate writes are not covered) are pinned so it neither over- nor
    // under-claims coverage.
    expect(upsert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(harness.ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('may now be stale'),
      expect.objectContaining({ object: 'kb_article', matched: 12 }),
    );
    const [message] = harness.ctx.logger.warn.mock.calls.at(-1) as [string];
    expect(message).toContain('cannot be repaired from the event stream');
    expect(message).toContain('the lifecycle reap guard de-indexes those rows before they are deleted');
    expect(message).toContain('application-level predicate writes are not');
    expect(message).toContain("source(s) kb (no reconcile can repair it");
  });
});

/**
 * No producer emits a bare `record.created|updated|deleted` event, and the
 * bridge has no branch for one. Each case delivers the legacy shape and then
 * the same record as `data.record.*` on the SAME subscription: the legacy
 * delivery must sync nothing while the `data.record.*` one does, so a silent
 * harness cannot pass for a removed branch.
 */
describe('a bare record.* event is not part of the sync vocabulary', () => {
  const legacy = (type: string, payload: Row): RealtimeEventPayload => ({ type, object: 'kb_article', payload, timestamp: AT });

  it.each([
    ['record.created', 'under payload.record', { record: PUBLISHED }],
    ['record.updated', 'as the payload itself', PUBLISHED],
  ])('%s (%s) upserts nothing, while data.record.created upserts the same row', async (type, _shape, payload) => {
    const harness = makeCtx();
    const { service, deliver } = await harness.boot(new KnowledgeServicePlugin());
    const upsert = vi.spyOn(service, 'handleRecordUpsert').mockResolvedValue(undefined);
    const del = vi.spyOn(service, 'handleRecordDelete').mockResolvedValue(undefined);

    await deliver(legacy(type, payload));
    expect(upsert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();

    await deliver(dataEvent('data.record.created', 'a1', PUBLISHED));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith('kb_article', PUBLISHED);
  });

  it.each([
    ['payload.id', { id: 'a1' }],
    ['payload.record.id', { record: { id: 'a1' } }],
  ])('record.deleted (id from %s) deletes nothing, while data.record.deleted deletes the same id', async (_shape, payload) => {
    const harness = makeCtx();
    const { service, deliver } = await harness.boot(new KnowledgeServicePlugin());
    const upsert = vi.spyOn(service, 'handleRecordUpsert').mockResolvedValue(undefined);
    const del = vi.spyOn(service, 'handleRecordDelete').mockResolvedValue(undefined);

    await deliver(legacy('record.deleted', payload));
    expect(upsert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();

    await deliver(dataEvent('data.record.deleted', 'a1'));
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('kb_article', 'a1');
  });
});

describe("a written row is re-read against the source's where", () => {
  it('re-reads by where AND id, one row, under the system context', async () => {
    const t = await bootWith({ rows: [PUBLISHED], where: PUBLISHED_ONLY });

    await t.deliver(dataEvent('data.record.created', 'a1', PUBLISHED));

    expect(t.db.find).toHaveBeenCalledTimes(1);
    expect(t.db.find).toHaveBeenCalledWith(
      'kb_article',
      { where: { $and: [PUBLISHED_ONLY, { id: 'a1' }] }, limit: 1 },
      { context: expect.objectContaining({ isSystem: true }) },
    );
  });

  it('a matching row enters the index', async () => {
    const t = await bootWith({ rows: [PUBLISHED], where: PUBLISHED_ONLY });

    await t.deliver(dataEvent('data.record.created', 'a1', PUBLISHED));

    expect([...t.docs.keys()]).toEqual(['kb:a1']);
    expect(t.docs.get('kb:a1')?.content).toBe('Leave policy\n\nTwenty days of paid leave');
  });

  it('a row that does not match is not indexed', async () => {
    const t = await bootWith({ rows: [DRAFT], where: PUBLISHED_ONLY });

    await t.deliver(dataEvent('data.record.created', 'a1', DRAFT));

    expect(t.docs.size).toBe(0);
    expect(t.adapter.upsert).not.toHaveBeenCalled();
  });

  it('a row that stops matching leaves the index — and is no longer found', async () => {
    const t = await bootWith({ rows: [PUBLISHED], where: PUBLISHED_ONLY });
    await t.deliver(dataEvent('data.record.created', 'a1', PUBLISHED));
    expect(await t.service.search('paid leave', SYSTEM)).toHaveLength(1);

    t.db.put(DRAFT);
    await t.deliver(dataEvent('data.record.updated', 'a1', DRAFT));

    expect(t.docs.size).toBe(0);
    expect(t.adapter.delete).toHaveBeenCalledWith(['kb:a1'], expect.objectContaining({ reason: 'event-sync' }));
    expect(await t.service.search('paid leave', SYSTEM)).toEqual([]);
    expect(await t.service.search('Draft wording', SYSTEM)).toEqual([]);
  });

  it('a source with no where re-reads by id alone and indexes the row', async () => {
    const t = await bootWith({ rows: [DRAFT] });

    await t.deliver(dataEvent('data.record.created', 'a1', DRAFT));

    expect(t.db.find).toHaveBeenCalledWith(
      'kb_article',
      { where: { id: 'a1' }, limit: 1 },
      { context: expect.objectContaining({ isSystem: true }) },
    );
    expect(t.docs.get('kb:a1')?.content).toBe('Leave policy\n\nDraft wording, not yet approved');
  });

  it('a payload missing a content field still yields the whole document — from the re-read row', async () => {
    const t = await bootWith({ rows: [PUBLISHED], where: PUBLISHED_ONLY });

    // A projected write result: the id and the field the write touched.
    await t.deliver(dataEvent('data.record.updated', 'a1', { id: 'a1', status: 'published' }));

    expect(t.docs.get('kb:a1')?.content).toBe('Leave policy\n\nTwenty days of paid leave');
  });

  it('a restored row that matches is searchable again', async () => {
    const t = await bootWith({ rows: [PUBLISHED], where: PUBLISHED_ONLY });
    expect(await t.service.search('paid leave', SYSTEM)).toEqual([]);

    await t.deliver(dataEvent(RECORD_RESTORED_EVENT, 'a1', PUBLISHED));

    const hits = await t.service.search('paid leave', SYSTEM);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sourceId: 'kb', sourceRecordId: 'a1' });
  });

  it('a restored row that does not match is not indexed', async () => {
    const t = await bootWith({ rows: [DRAFT], where: PUBLISHED_ONLY });

    await t.deliver(dataEvent(RECORD_RESTORED_EVENT, 'a1', DRAFT));

    expect(t.docs.size).toBe(0);
    expect(t.adapter.upsert).not.toHaveBeenCalled();
    expect(await t.service.search('Draft wording', SYSTEM)).toEqual([]);
  });
});

describe('with no data engine bound', () => {
  it('a source with no where still builds the document from the payload', async () => {
    const t = await bootWith({ engine: false });

    await t.deliver(dataEvent('data.record.created', 'a1', DRAFT));

    expect(t.docs.get('kb:a1')?.content).toBe('Leave policy\n\nDraft wording, not yet approved');
  });

  it('a source with a where is skipped, said once at warn', async () => {
    const t = await bootWith({ engine: false, where: PUBLISHED_ONLY });

    await t.deliver(dataEvent('data.record.created', 'a1', PUBLISHED));
    await t.deliver(dataEvent('data.record.updated', 'a1', DRAFT));

    expect(t.adapter.upsert).not.toHaveBeenCalled();
    expect(t.adapter.delete).not.toHaveBeenCalled();
    const reports = (t.harness.ctx.logger.warn.mock.calls as Array<[string]>)
      .filter(([message]) => message.includes("source 'kb' declares a where filter and no data engine is bound"));
    expect(reports).toHaveLength(1);
  });
});

/**
 * Two events for one row, the first one's re-read still in flight when the
 * second arrives. The first re-read saw the row as it was; acting on it after
 * the second sync would leave the index disagreeing with the database. Syncs of
 * one document run one after another, so the last one re-reads last.
 */
describe('two opposite events for one row end consistent with the database', () => {
  it('matching, then not matching: the document ends absent', async () => {
    const t = await bootWith({ rows: [PUBLISHED], where: PUBLISHED_ONLY });

    const release = t.db.holdNextFind();
    const first = t.deliver(dataEvent('data.record.updated', 'a1', PUBLISHED));
    t.db.put(DRAFT);
    const second = t.deliver(dataEvent('data.record.updated', 'a1', DRAFT));
    release();
    await Promise.all([first, second]);

    expect(t.db.rows.get('a1')?.status).toBe('draft');
    expect(t.docs.has('kb:a1')).toBe(false);
  });

  it('not matching, then matching: the document ends present, from the latest row', async () => {
    const t = await bootWith({ rows: [DRAFT], where: PUBLISHED_ONLY });
    await t.deliver(dataEvent('data.record.created', 'a1', DRAFT));

    const release = t.db.holdNextFind();
    const first = t.deliver(dataEvent('data.record.updated', 'a1', DRAFT));
    t.db.put(PUBLISHED);
    const second = t.deliver(dataEvent('data.record.updated', 'a1', PUBLISHED));
    release();
    await Promise.all([first, second]);

    expect(t.docs.get('kb:a1')?.content).toBe('Leave policy\n\nTwenty days of paid leave');
  });

  it('an update, then a delete: the document ends absent', async () => {
    const t = await bootWith({ rows: [PUBLISHED], where: PUBLISHED_ONLY });

    const release = t.db.holdNextFind();
    const first = t.deliver(dataEvent('data.record.updated', 'a1', PUBLISHED));
    t.db.rows.delete('a1');
    const second = t.deliver(dataEvent('data.record.deleted', 'a1'));
    release();
    await Promise.all([first, second]);

    expect(t.docs.has('kb:a1')).toBe(false);
  });
});
