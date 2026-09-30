// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The cross-class field-comparison refusal reaches the WIRE with its remedy —
 * through the real `SecurityPlugin` on a real `ObjectQL` over a real
 * `SqlDriver`, at the `/data` door and at `POST /api/v1/security/explain`.
 *
 * ## Why the wire and not the thrown error
 *
 * Both doors bound a 4xx message: 500 characters or more is cut to 499 plus an
 * ellipsis (`CLIENT_MESSAGE_MAX` in `error-response.ts`). The cut keeps the
 * HEAD. The two producers of this refusal wrote their remedy LAST — the record
 * matcher's message was 972 characters with the remedy from index 825, the
 * explain engine's put it after an unbounded subject and diagnostic — so no
 * caller of either door ever read it. A thrown-message assertion cannot see
 * that; only the message the door answers with can.
 *
 * ## Which door answers which producer (measured on this stack)
 *
 * | request | producer | wire |
 * |---|---|---|
 * | `POST /data/:object` (insert) | the record matcher, as the RLS write check (`@objectstack/formula`) | its whole message |
 * | `GET /data/:object` (find) | driver-sql's read refusal of the same comparison | its whole message |
 * | `POST /security/explain` | the explain engine's own copy (`@objectstack/plugin-security`) | the first 499 characters |
 *
 * A find never carries the matcher's message: only the RLS write check and
 * explain hand the matcher the declared columns its class rule reads.
 *
 * ## What is pinned
 *
 * - each door's wire message carries its producer's remedy;
 * - a fixture with long object, policy and field names stays under the bound
 *   with the remedy intact;
 * - the control: a short refusal of another class reaches the wire unchanged.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

/** The record matcher's remedy, as its message opens. */
const MATCHER_REMEDY =
  'In a row-level policy, compare a field only with a field of the same class, or fix the declaration of the ' +
  'one that is declared with the wrong type.';
/** The explain engine's remedy, as its message opens — before the policy names. */
const EXPLAIN_REMEDY =
  'Compare a field only with a field of the same class, or fix the declaration of the one that is declared with ' +
  'the wrong type.';
/** The door's bound: a message this long or longer is cut to 499 characters plus an ellipsis. */
const BOUND = 500;

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

interface Fixture {
  /** Names the fixture's app. */
  key: string;
  object: string;
  policy: string;
  /** A text column and a number column: two comparison classes. */
  text: string;
  number: string;
}

interface Answer {
  status: number;
  code: unknown;
  message: string;
}

/** The status, code and message the door answered, in either envelope this family speaks. */
function answerOf(status: number, body: any): Answer {
  const nested = body?.error !== null && typeof body?.error === 'object';
  return {
    status,
    code: nested ? body.error.code : body?.code,
    message: String(nested ? body.error.message : body?.error),
  };
}

const thrownOf = (p: Promise<unknown>): Promise<{ code: unknown; status: unknown; message: string }> =>
  p.then(
    () => ({ code: undefined, status: undefined, message: '(admitted)' }),
    (e: any) => ({ code: e?.code, status: e?.statusCode ?? e?.status, message: String(e?.message) }),
  );

async function boot(f: Fixture) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.cross-class-remedy-wire-${f.key}`,
    name: 'Cross-class refusal remedy on the wire',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: f.object,
        label: 'Deal',
        sharingModel: 'public_read_write',
        fields: {
          [f.text]: { name: f.text, type: 'text' },
          [f.number]: { name: f.number, type: 'number' },
          title: { name: 'title', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();

  const set = PermissionSetSchema.parse({
    name: 'qa_cross_class_remedy',
    objects: { [f.object]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [
      { name: f.policy, object: f.object, operation: 'all', using: `record.${f.text} != record.${f.number}` },
    ],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, service: unknown) => { services[name] = service; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: set.name });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert(f.object, { id: 'r1', [f.text]: 'open', [f.number]: 5, title: 'x' }, { context: SYS_CTX } as never);

  const caller = { userId: 'usr_member', positions: [], permissions: [set.name], posture: 'MEMBER' };
  const noop = () => {};
  const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
  const rest = new RestServer(server as any, new ObjectStackProtocolImplementation(engine as any) as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => caller;
  (rest as any).securityServiceProvider = async () => services.security;
  rest.registerRoutes();

  const call = async (method: string, path: string, req: Record<string, unknown>): Promise<Answer> => {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path} is mounted`).toBeDefined();
    const res: any = {
      statusCode: 200,
      write: () => true, end: noop, setHeader: noop,
      header: () => res,
      status: (code: number) => { res.statusCode = code; return res; },
      json: (body: unknown) => { res.body = body; return res; },
      send: (body: unknown) => { res.body = body; return res; },
    };
    await route!.handler({ params: {}, query: {}, headers: {}, method, ...req } as any, res);
    return answerOf(res.statusCode, res.body);
  };

  const newRow = { id: 'r2', [f.text]: 'x', [f.number]: 1, title: 'y' };
  return {
    engine,
    /** `POST /data/:object` — the insert the policy's `using` judges as its check. */
    insert: () => call('POST', '/api/v1/data/:object', { params: { object: f.object }, body: { ...newRow } }),
    insertThrown: () => thrownOf(engine.insert(f.object, { ...newRow }, { context: caller } as never)),
    /** `GET /data/:object` — the find the policy scopes. */
    find: (query: Record<string, unknown> = {}) => call('GET', '/api/v1/data/:object', { params: { object: f.object }, query }),
    findThrown: (where?: unknown) => thrownOf(engine.find(f.object, { where, context: caller } as never)),
    /** `POST /security/explain` for the caller's own access to the row. */
    explain: () => call('POST', '/api/v1/security/explain', { body: { object: f.object, operation: 'read', recordId: 'r1' } }),
  };
}

type World = Awaited<ReturnType<typeof boot>>;

const SHORT: Fixture = { key: 'short', object: 'qa_remedy_deal', policy: 'deal_guard', text: 'status', number: 'amount' };
/** Names far past any real one: object, field and policy names declare no maximum length. */
const long = (stem: string) => `${stem}_${'x'.repeat(90)}`;
const LONG: Fixture = {
  key: 'long',
  object: long('qa_remedy_opportunity_forecast'),
  policy: long('opportunity_pipeline_visibility_guard'),
  text: long('negotiation_stage_label'),
  number: long('forecast_amount_value'),
};

describe('the cross-class refusal carries its remedy on the wire', () => {
  let short: World;
  let longNames: World;

  beforeAll(async () => {
    short = await boot(SHORT);
    longNames = await boot(LONG);
  });

  afterAll(async () => {
    for (const w of [short, longNames]) {
      try { await w?.engine.destroy(); } catch { /* noop */ }
    }
  });

  it('`/data` insert: the record matcher\'s whole message reaches the wire, remedy first', async () => {
    const answer = await short.insert();
    expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'INVALID_FILTER' });
    expect(answer.message.startsWith(MATCHER_REMEDY), answer.message).toBe(true);
    // Whole: under the bound, so nothing is cut — the reason and the withholding sentence arrive too.
    expect(answer.message.length).toBeLessThan(BOUND);
    expect(answer.message).toBe((await short.insertThrown()).message);
    for (const column of [SHORT.text, SHORT.number]) expect(answer.message).not.toContain(column);
  });

  it('`/data` find: the read refusal of the same comparison reaches the wire whole', async () => {
    const answer = await short.find();
    expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'INVALID_FILTER' });
    expect(answer.message.length).toBeLessThan(BOUND);
    expect(answer.message).toBe((await short.findThrown()).message);
    // driver-sql's read refusal states the same rule: same-class columns only.
    expect(answer.message).toContain('compared as the same type class');
    for (const column of [SHORT.text, SHORT.number]) expect(answer.message).not.toContain(column);
  });

  it('`POST /security/explain`: the wire message opens with the remedy, before the policy it names', async () => {
    const answer = await short.explain();
    expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'INVALID_FILTER' });
    expect(answer.message.startsWith(`${EXPLAIN_REMEDY} `), answer.message).toBe(true);
    expect(answer.message.length).toBeLessThanOrEqual(BOUND);
    expect(answer.message).toContain(`'${SHORT.policy}'`);
  });

  it('long object, policy and field names: explain is cut at the bound with the remedy intact, and the matcher\'s message is unchanged', async () => {
    const explain = await longNames.explain();
    expect({ status: explain.status, code: explain.code }).toEqual({ status: 400, code: 'INVALID_FILTER' });
    expect(explain.message.length).toBe(BOUND);
    expect(explain.message.endsWith('…')).toBe(true);
    expect(explain.message.startsWith(`${EXPLAIN_REMEDY} `), explain.message).toBe(true);

    const insert = await longNames.insert();
    expect({ status: insert.status, code: insert.code }).toEqual({ status: 400, code: 'INVALID_FILTER' });
    // The matcher names no column, so the names do not move its length.
    expect(insert.message).toBe((await short.insert()).message);
    expect(insert.message.startsWith(MATCHER_REMEDY)).toBe(true);
  });

  it('control — a short refusal of another class reaches the wire unchanged', async () => {
    const where = { title: { $bogus: 1 } };
    const thrown = await short.findThrown(where);
    expect({ code: thrown.code, status: thrown.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(thrown.message.length).toBeLessThan(BOUND);
    const answer = await short.find({ filter: JSON.stringify(where) });
    expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'INVALID_FILTER' });
    expect(answer.message).toBe(thrown.message);
  });
});
