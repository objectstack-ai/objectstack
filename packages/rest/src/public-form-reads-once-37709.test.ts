// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0159 D5, D6] One form request reads the `view` list at most once and
 * each type's stored rows (`sys_metadata`) at most once.
 *
 * The effective `form` read resolves over both types: the generic `form` list,
 * the projection of the `view` list, and the cross-type resolution over the
 * stored rows of both types (`readEffectiveFormList`, `@objectstack/metadata-protocol`).
 * Each of those readings, and each of the five an anonymous form door makes
 * (the `view` list, the `form` list, the unreadable bodies, both per-package
 * layers), asks for the same stored rows. The effective `form` read reads
 * through one request scope (`formRequestScope`), and the doors make their
 * five calls inside one request reading (`readFormRequest`), so the request
 * reads each row set once.
 *
 * Measured on the merged tree before the scope (`OS_METADATA_OVERLAY_CACHE_TTL_MS=0`,
 * an authored `form` item): a by-name `form` read read the `form` rows twice
 * and the `view` rows twice; a form-door GET read the `view` list twice, the
 * `view` rows five times and the `form` rows three times. An old-shape form
 * (no address left the `view` type, so no cross-type resolution) read the
 * `view` rows four times and the `form` rows twice on the door.
 *
 * Every pin runs the REAL protocol over a real `ObjectQL` engine and a real
 * SQL store, with the cross-request row cache off (`TTL=0`), so every row-set
 * read is a SQL statement the engine sees. A row-set read of a type issues one
 * statement under the singular spelling and, when that answers no row, one
 * under the plural (`readActiveOverlayRows`); each spelling is counted.
 *
 * CONTROL: two requests read twice (the scope never spans requests), and the
 * five door calls outside one reading (a protocol without `readFormRequest`)
 * still read the rows once per call, so the counter sees a repeated read when
 * there is one. Ablation (recorded on the PR): drop the scope from the
 * effective `form` read, from the door's reading, or the scope's row reader
 * from its list reads, and the counts go red.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataAuditObject,
  SysMetadataCommitObject,
  SysMetadataHistoryObject,
  SysMetadataObject,
} from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const BASE = 'com.example.forms37709';
const OBJECT = 'fro_inquiry';
const NAME = `${OBJECT}.contact`;
const SLUG = 'contact-37709';

const body = { type: 'simple', sections: [{ fields: ['name'] }], sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` } };
const INQUIRY = { name: OBJECT, label: 'Inquiry', fields: { name: { name: 'name', type: 'text' as const, label: 'Name' } } };

/** The two shapes a first-party form takes: an authored `form` item, an old-shape container's `formViews` entry. */
const SHAPES = {
  'an authored `form` item': { forms: [{ name: NAME, object: OBJECT, label: 'Contact us', ...body }] },
  'an old-shape `formViews` entry': { views: [{ object: OBJECT, formViews: { contact: { ...body, data: { provider: 'object', object: OBJECT } } } }] },
} as const;

function mockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    header: () => res,
    setHeader: () => res,
    send: (b: unknown) => { res._json = b; return res; },
    write: () => true,
    end: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (b: unknown) => { res._json = b; return res; },
  };
  return res;
}

/** The reads one request issues: row-set statements per type spelling, name-predicated row reads, flattened lists. */
interface Reads {
  rows: Record<string, number>;
  named: number;
  lists: Record<string, number>;
}

const FAMILIES = new Set(['form', 'forms', 'view', 'views']);

async function boot(ships: Record<string, unknown>) {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    engine.registry.registerObject(o as any, 'test-package');
  }
  engine.registerApp({ id: BASE, name: 'forms37709', version: '1.0.0', namespace: 'fro', objects: [INQUIRY], ...ships } as any);
  await engine.syncSchemas();
  const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => new Map());
  const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
  rest.registerRoutes();
  const resolve = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/forms/:slug');
  expect(resolve, 'GET /api/v1/forms/:slug is registered').toBeDefined();

  let reads: Reads | undefined;
  const find = engine.find.bind(engine);
  vi.spyOn(engine, 'find').mockImplementation(async (object: string, query?: any) => {
    if (reads !== undefined && object === 'sys_metadata' && query?.where?.state === 'active') {
      const type = query.where.type;
      if (typeof type === 'string' && FAMILIES.has(type) && query.where.name === undefined) reads.rows[type] = (reads.rows[type] ?? 0) + 1;
      else if (query.where.name !== undefined) reads.named += 1;
    }
    return find(object, query);
  });
  const flattened = protocol.readFlattenedMetaItems.bind(protocol);
  protocol.readFlattenedMetaItems = (request: any, audience: any, layer: any, rows: any) => {
    if (reads !== undefined && FAMILIES.has(request.type)) {
      const key = `${request.type}:${layer ?? 'effective'}`;
      reads.lists[key] = (reads.lists[key] ?? 0) + 1;
    }
    return flattened(request, audience, layer, rows);
  };
  /** The reads `run` issued. */
  const counted = async (run: () => Promise<unknown>): Promise<Reads> => {
    reads = { rows: {}, named: 0, lists: {} };
    try {
      await run();
      return reads;
    } finally {
      reads = undefined;
    }
  };
  const door = async () => {
    const res = makeRes();
    await resolve!.handler({ params: { slug: SLUG }, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const byName = () => protocol.getMetaItem({ type: 'form', name: NAME });
  return { engine, protocol, door, byName, counted };
}

/** Each type's stored rows read once: one statement per spelling. */
const ONCE = { form: 1, forms: 1, view: 1, views: 1 };

describe('[ADR-0159 D5, D6] one form request reads the `view` list once and each type\'s stored rows once', () => {
  const engines: ObjectQL[] = [];
  beforeAll(() => {
    // The cross-request row cache off: every row-set read reaches the store.
    vi.stubEnv('OS_METADATA_OVERLAY_CACHE_TTL_MS', '0');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: Record<string, unknown>) => {
    const b = await boot(ships);
    engines.push(b.engine);
    // The first request of a process pays its one-time reads (the catalog probe); measure the next.
    await b.byName();
    await b.door();
    return b;
  };

  describe.each(Object.entries(SHAPES))('the form is %s', (_shape, ships) => {
    it('a by-name `form` read: the `view` list once, each type\'s stored rows once, and the rows of the name once', async () => {
      const b = await booted(ships);
      let answer: any;
      const reads = await b.counted(async () => { answer = await b.byName(); });
      expect(answer?.item?.name).toBe(NAME);
      expect(answer?.item?._packageId).toBe(BASE);
      expect(reads.lists).toEqual({ 'form:effective': 1, 'view:effective': 1 });
      expect(reads.rows).toEqual(ONCE);
      // The generic by-name read: its own row read, predicated on the name.
      expect(reads.named).toBe(1);
    });

    it('an anonymous form-door GET: the `view` list once, each type\'s stored rows once', async () => {
      const b = await booted(ships);
      let answer: any;
      const reads = await b.counted(async () => { answer = await b.door(); });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(reads.lists).toEqual({
        'view:effective': 1, 'form:effective': 1, 'form:per-package': 1, 'view:per-package': 1,
      });
      expect(reads.rows).toEqual(ONCE);
      expect(reads.named).toBe(0);
    });

    it('CONTROL: two requests read twice: the scope never outlives its request', async () => {
      const b = await booted(ships);
      const reads = await b.counted(async () => { await b.door(); await b.byName(); });
      expect(reads.rows).toEqual({ form: 2, forms: 2, view: 2, views: 2 });
      expect(reads.lists['view:effective']).toBe(2);
    });

    it('CONTROL: the five door calls outside one reading (a protocol without `readFormRequest`) read the rows once per call', async () => {
      const b = await booted(ships);
      b.protocol.readFormRequest = undefined;
      let answer: any;
      const reads = await b.counted(async () => { answer = await b.door(); });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // The `view` list twice: the door's own read, and the `form` list's step 2.
      expect(reads.lists['view:effective']).toBe(2);
      // The `view` rows: the `view` list, the `form` list's scope, the unreadable bodies, the per-package layer.
      expect(reads.rows.view).toBe(4);
    });
  });
});
