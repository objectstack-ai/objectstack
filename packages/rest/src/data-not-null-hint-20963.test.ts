// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20963] The `hint` on a driver's NOT NULL refusal, for a column the object
 * declares NOT NULL on purpose (ADR-0113 D1 / D2).
 *
 * `must` is `storage: { notNull: true }` and not `required`. The engine's record
 * validator judges `required` and reads `storage.notNull` nowhere, so a write
 * with no value for `must` reaches the driver and the DATABASE refuses it.
 * `mapDataError` classifies that refusal from the driver's text and the object's
 * name; it never sees the field map. The answer's `code`, `fields` and sentence
 * are right. What was wrong is the `hint`, which said `must` is optional in the
 * metadata and the physical schema has drifted, and sent the author to
 * `os migrate`, which changes nothing for a column declared NOT NULL.
 *
 * Read through the public doors, over a REAL {@link ObjectQL} +
 * {@link ObjectStackProtocolImplementation} + SQLite `:memory:`:
 * `POST /api/v1/data/:object` with `must` omitted, and
 * `PATCH /api/v1/data/:object/:id` writing `must: null`.
 *
 * Pinned by kind, not by wording: the answer is the one it was (the control), and
 * its `hint` leads with the remedy for a column that requires a value, then
 * names drift in one sentence that is conditional on the object declaring
 * neither `required` nor `storage.notNull`, never as a verdict on this column.
 * ⚠️ Not pinned: telling the two cases apart. That needs a registry read, which
 * the mapper does not make.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'proj_notnull_hint_20963';

const PROJ = {
  name: OBJECT, label: 'Proj notnull hint 20963', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    // Physically NOT NULL, not `required`: declared on purpose, so nothing has drifted.
    must: { name: 'must', type: 'text' as const, storage: { notNull: true } },
  },
};

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

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registry.registerObject(PROJ as any);
  await engine.syncSchemas();
  await engine.insert(OBJECT, { id: 'e1', title: 'existing', must: 'm' } as any);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const call = async (method: string, path: string, body: unknown, params: Record<string, string> = { object: OBJECT }): Promise<{ status: number; body: any }> => {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ params, body, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  return { engine, call };
}

/** The control: the answer's code, status, `fields` and sentence are what they were. */
function expectNotNullAnswer(door: { status: number; body: any }) {
  expect(door.status, JSON.stringify(door.body)).toBe(400);
  expect(door.body).toMatchObject({
    code: 'VALIDATION_FAILED',
    error: 'must is required',
    fields: [{ field: 'must', code: 'required', message: 'must is required' }],
    object: OBJECT,
  });
  // No key is added or dropped by the hint's correction.
  expect(Object.keys(door.body).sort()).toEqual(['code', 'error', 'fields', 'hint', 'object']);
}

/** The hint's sentences: none of the prose here contains a full stop but the one ending a sentence. */
function sentencesOf(hint: unknown): string[] {
  expect(typeof hint, 'a NOT NULL refusal answers a hint').toBe('string');
  return (hint as string).trim().split(/(?<=\.)\s+/);
}

/** What the hint must be for a column that requires a value on purpose (ADR-0113). */
function expectHintLeadsWithTheRemedy(hint: unknown) {
  const sentences = sentencesOf(hint);
  const text = String(hint);
  // First: the column requires a value, so provide it or declare the field `required`.
  expect(sentences[0], text).toMatch(/\brequires a value\b/i);
  expect(sentences[0], text).toMatch(/provide/i);
  expect(sentences[0], text).toContain('`required`');
  expect(sentences[0], text).not.toMatch(/drift|os migrate/i);
  // Then drift, in exactly one sentence, and only as a condition on the declaration.
  const drift = sentences.filter((s) => /drift|os migrate/i.test(s));
  expect(drift, text).toHaveLength(1);
  expect(drift[0], text).toMatch(/^If\b/);
  expect(drift[0], text).toMatch(/storage/);
  expect(drift[0], text).toMatch(/notNull/);
  expect(drift[0], text).toMatch(/os migrate/);
  expect(sentences.indexOf(drift[0]!), text).toBeGreaterThan(0);
}

describe('[#20963] a declared `storage.notNull` column\'s refusal does not assert drift', () => {
  it('the fixture is the ADR-0113 posture: the database refuses what the validator lets through', async () => {
    const { engine } = await boot();
    expect(PROJ.fields.must).toMatchObject({ storage: { notNull: true } });
    expect('required' in PROJ.fields.must).toBe(false);
    await expect(engine.insert(OBJECT, { id: 'x', title: 't' } as any)).rejects.toThrow(/not null/i);
  });

  it('POST /data/:object with no value for the column: the same answer, a hint that leads with the remedy', async () => {
    const { call } = await boot();
    const door = await call('POST', '/api/v1/data/:object', { title: 't' });
    expectNotNullAnswer(door);
    expectHintLeadsWithTheRemedy(door.body.hint);
  });

  it('PATCH /data/:object/:id writing null onto the column: the same answer, the same hint', async () => {
    const { call } = await boot();
    const created = await call('POST', '/api/v1/data/:object', { title: 't' });
    const door = await call('PATCH', '/api/v1/data/:object/:id', { must: null }, { object: OBJECT, id: 'e1' });
    expectNotNullAnswer(door);
    expectHintLeadsWithTheRemedy(door.body.hint);
    // One branch answers both doors: the update says what the create said.
    expect(door.body.hint).toBe(created.body.hint);
  });
});
