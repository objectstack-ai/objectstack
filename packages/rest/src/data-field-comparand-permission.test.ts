// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A field the caller may not read is not a comparison target either — with
 * the REAL security layer (`SecurityPlugin` on a real `ObjectQL` over a real
 * `SqlDriver`), through `POST /api/v1/data/:object/query`, on the data read
 * and on the aggregate path it routes to.
 *
 * The security layer refuses a query that filters by a hidden field
 * (`assertReadableQueryFields`, `403 PERMISSION_DENIED`): row presence would
 * disclose the value the field mask withholds. A cross-field comparand
 * (`FieldReferenceSchema`) reads the field it names just as a condition key
 * does, so it is collected by the same walk and answers the SAME refusal —
 * status and body — as the same hidden field written as a key. Every position
 * the filter grammar admits for a comparand is held to it: the whole
 * comparand of the six scalar comparisons, the whole-day offset wrapper (its
 * base and its offset column), under `$and` / `$or` / `$not`, and — on the
 * aggregate path — in `where` and in a per-aggregation `filter`.
 *
 * A readable comparand in the same positions is the control: served.
 *
 * SQLite only: the check is the security layer's, before any driver dialect
 * is involved.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_comparand_perm_ledger';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  // The fields the caller may not read.
  fields: {
    [`${OBJECT}.sealed_n`]: { readable: false, editable: false },
    [`${OBJECT}.sealed_day`]: { readable: false, editable: false },
    [`${OBJECT}.sealed_k`]: { readable: false, editable: false },
  },
});

const MEMBER_CTX = { userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };

const ROWS = [
  { id: 'c1', label: 'a', seen_n: 5, seen_m: 1, sealed_n: 1, seen_day: '2026-01-10', base_day: '2026-01-09', sealed_day: '2026-01-01', seen_k: 1, sealed_k: 3 },
  { id: 'c2', label: 'b', seen_n: 5, seen_m: 9, sealed_n: 9, seen_day: '2026-01-10', base_day: '2026-01-20', sealed_day: '2026-02-01', seen_k: 1, sealed_k: 1 },
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

const ref = (field: string, extra: Record<string, unknown> = {}) => ({ $field: field, ...extra });
const GROUPED = { groupBy: ['label'], aggregations: [{ function: 'count', alias: 'n' }] };
const counted = (filter: Record<string, unknown>) => ({
  groupBy: ['label'],
  aggregations: [{ function: 'count', alias: 'n', filter }],
});

/** Every comparand position the grammar admits, on the data read, with the hidden field it names. */
const READ_POSITIONS: Array<[string, Record<string, unknown>]> = [
  ...['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'].map(
    (op): [string, Record<string, unknown>] => [`the whole comparand of ${op}`, { where: { seen_n: { [op]: ref('sealed_n') } } }],
  ),
  ['a comparand under $and', { where: { $and: [{ label: { $ne: 'z' } }, { seen_n: { $gt: ref('sealed_n') } }] } }],
  ['a comparand under $or', { where: { $or: [{ label: 'z' }, { seen_n: { $gt: ref('sealed_n') } }] } }],
  ['a comparand under $not', { where: { $not: { seen_n: { $gt: ref('sealed_n') } } } }],
  ['a comparand under nested groups', { where: { $and: [{ $or: [{ $not: { seen_n: { $lte: ref('sealed_n') } } }] }] } }],
];

/** The whole-day offset wrapper, whose base and offset column name a field each. */
const OFFSET_POSITIONS: Array<[string, Record<string, unknown>]> = [
  ['the base of a whole-day offset comparand', { where: { seen_day: { $lte: ref('sealed_day', { addDays: 3 }) } } }],
  ['the offset column of a whole-day offset comparand', { where: { seen_day: { $lte: ref('base_day', { addDays: ref('sealed_k') }) } } }],
];

/** The aggregate path: a comparand in `where`, and in a per-aggregation `filter`. */
const AGGREGATE_POSITIONS: Array<[string, Record<string, unknown>]> = [
  ['a comparand in where', { ...GROUPED, where: { seen_n: { $gt: ref('sealed_n') } } }],
  ['a comparand under $or in where', { ...GROUPED, where: { $or: [{ label: 'z' }, { seen_n: { $lt: ref('sealed_n') } }] } }],
  ['a comparand in a per-aggregation filter', counted({ seen_n: { $gt: ref('sealed_n') } })],
];

/** The same body, with each hidden field swapped for a readable one of the same type. */
function readableTwin(body: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(body).replaceAll('sealed_n', 'seen_m').replaceAll('sealed_day', 'base_day').replaceAll('sealed_k', 'seen_k'),
  ) as Record<string, unknown>;
}

describe('a hidden field as a cross-field comparand answers the key form\'s refusal — the real security layer', () => {
  let engine: ObjectQL;
  let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
      true,
    );
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.field-comparand-permission',
      name: 'Field comparand permission',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        {
          name: OBJECT,
          label: 'Ledger',
          sharingModel: 'public_read_write',
          fields: {
            label: { name: 'label', type: 'text' },
            seen_n: { name: 'seen_n', type: 'number' },
            seen_m: { name: 'seen_m', type: 'number' },
            sealed_n: { name: 'sealed_n', type: 'number' },
            seen_day: { name: 'seen_day', type: 'date' },
            base_day: { name: 'base_day', type: 'date' },
            sealed_day: { name: 'sealed_day', type: 'date' },
            seen_k: { name: 'seen_k', type: 'number' },
            sealed_k: { name: 'sealed_k', type: 'number' },
          },
        },
      ],
    } as never);
    await engine.syncSchemas();

    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
        list: async () => [MEMBER_SET],
      },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

    await engine.insert(OBJECT, ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => MEMBER_CTX;
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
    expect(route).toBeDefined();
    query = async (body) => {
      const res = makeRes();
      await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)), query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  /** The hidden field written as a KEY: the reference refusal, per path and per field. */
  async function keyForm(field: string, shape: 'read' | 'aggregate' | 'aggregate-filter'): Promise<{ status: number; body: any }> {
    const condition = { [field]: { $ne: null } };
    const body = shape === 'read'
      ? { where: condition }
      : shape === 'aggregate' ? { ...GROUPED, where: condition } : counted(condition);
    const res = await query(body);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain('PERMISSION_DENIED');
    return res;
  }

  describe('the data read', () => {
    it.each([...READ_POSITIONS, ...OFFSET_POSITIONS])('a hidden field as %s is refused exactly as the key form is', async (_position, body) => {
      const hidden = JSON.stringify(body).includes('sealed_day') ? 'sealed_day'
        : JSON.stringify(body).includes('sealed_k') ? 'sealed_k' : 'sealed_n';
      const reference = await keyForm(hidden, 'read');
      const res = await query(body);
      expect(res.status, JSON.stringify(res.body)).toBe(reference.status);
      expect(res.body).toEqual(reference.body);
    });

    it.each([...READ_POSITIONS, ...OFFSET_POSITIONS])('CONTROL a readable field as %s is served', async (_position, body) => {
      const res = await query(readableTwin(body));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  });

  describe('the aggregate path', () => {
    it.each(AGGREGATE_POSITIONS)('a hidden field as %s is refused exactly as the key form is', async (position, body) => {
      const reference = await keyForm('sealed_n', position.includes('per-aggregation') ? 'aggregate-filter' : 'aggregate');
      const res = await query(body);
      expect(res.status, JSON.stringify(res.body)).toBe(reference.status);
      expect(res.body).toEqual(reference.body);
    });

    it.each(AGGREGATE_POSITIONS)('CONTROL a readable field as %s is served', async (_position, body) => {
      const res = await query(readableTwin(body));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  });
});
