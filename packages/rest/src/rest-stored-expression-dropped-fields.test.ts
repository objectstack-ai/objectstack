// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24690] The PATCH door and the cross-object `/batch` door report a caller
 * value a stored expression REPLACED, as `droppedFields` under
 * `stored_expression`.
 *
 * Since #24619 (item a) the engine computes a stored field's declared
 * `expression` on every write, so a client-sent `amount` never stands — and
 * until this card nothing said so: the engine's `onFieldsDropped` stayed
 * silent, so these doors answered `200` with no `droppedFields` over a row that
 * holds a value the client never sent.
 *
 * Driven through the composed stack — `RestServer` → `ObjectStackProtocolImplementation`
 * → `ObjectQL` → a real `SqlDriver` on better-sqlite3 — because the claim is
 * about what reaches the wire, not about what a stubbed engine reports.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'se_line';
const AMOUNT = { object: OBJECT, fields: ['amount'], reason: 'stored_expression' };

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    write: () => true, end: () => {},
    header: (k: string, v: string) => { res.headers[k] = v; return res; },
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

const dir = mkdtempSync(join(tmpdir(), 'os-24690-'));
let engine: ObjectQL;
let routes: any[];

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'lines.sqlite') }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  engine.registry.registerObject({
    name: OBJECT,
    label: 'Line',
    enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'] },
    fields: {
      quantity: { name: 'quantity', type: 'number' },
      unit_price: { name: 'unit_price', type: 'number' },
      amount: { name: 'amount', type: 'number', expression: { dialect: 'cel', source: 'record.quantity * record.unit_price' } },
    },
  } as any);
  await engine.syncSchemas();
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);
  await engine.insert(OBJECT, [
    { id: 'l1', quantity: 3, unit_price: 10 },
    { id: 'l2', quantity: 2, unit_price: 7 },
  ] as any);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(
    createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined,
    async () => engine,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  routes = rest.getRoutes();
});

afterAll(async () => {
  try { await engine.destroy(); } catch { /* noop */ }
  rmSync(dir, { recursive: true, force: true });
});

const patch = async (id: string, body: Record<string, unknown>) => {
  const route = routes.find((r) => r.method === 'PATCH' && r.path === '/api/v1/data/:object/:id');
  expect(route).toBeDefined();
  const res = makeRes();
  await route.handler({ query: {}, headers: {}, params: { object: OBJECT, id }, body } as any, res);
  return res;
};

const batch = async (operations: unknown[]) => {
  const route = routes.find((r) => r.method === 'POST' && (r.metadata?.summary ?? '').startsWith('Cross-object'));
  expect(route).toBeDefined();
  const res = makeRes();
  await route.handler({ method: 'POST', query: {}, headers: {}, params: {}, body: { operations } } as any, res);
  return res;
};

const stored = async (id: string) =>
  (await engine.findOne(OBJECT, { where: { id }, context: { isSystem: true } })) as Record<string, unknown>;

describe('[#24690] PATCH /data/:object/:id reports a replaced stored-expression value', () => {
  it('a PATCH of amount alone: 200, the computed amount is stored, and the replacement is on the body and the header', async () => {
    const res = await patch('l1', { amount: 1 });
    expect(res._status ?? 200).toBe(200);
    expect(res._json.droppedFields).toEqual([AMOUNT]);
    expect(res.headers['X-ObjectStack-Dropped-Fields']).toBe('amount;reason=stored_expression');
    expect((await stored('l1')).amount).toBe(30);
  });

  it('control: a consistent save (amount equals the computed value) carries no droppedFields', async () => {
    const res = await patch('l1', { quantity: 4, unit_price: 10, amount: 40 });
    expect(res._json).not.toHaveProperty('droppedFields');
    expect((await stored('l1')).amount).toBe(40);
  });
});

describe('[#24690] POST /batch reports a replaced stored-expression value, tagged with its op index', () => {
  it('an update op whose amount the expression replaced is reported; the consistent op beside it is not', async () => {
    const res = await batch([
      { object: OBJECT, action: 'update', id: 'l2', data: { quantity: 5, amount: 999 } },
      { object: OBJECT, action: 'update', id: 'l1', data: { quantity: 1, unit_price: 2, amount: 2 } },
    ]);
    expect(res._status ?? 200).toBe(200);
    expect(res._json.results).toHaveLength(2);
    expect(res._json.droppedFields).toEqual([{ ...AMOUNT, index: 0 }]);
    expect((await stored('l2')).amount).toBe(35);
    expect((await stored('l1')).amount).toBe(2);
  });
});
