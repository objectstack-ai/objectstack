// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `security/explain`, at the door: a caller explaining its own access, whose
 * read of the object is refused, is answered the same for every record id —
 * through the real `SecurityPlugin` on a real `ObjectQL` over a real
 * `SqlDriver`, and the REST explain route.
 *
 * ## The rule
 *
 * Ruling of record 6787890900. A caller whose read of an object is refused
 * gets the same explanation for every record id. It names the read refusal and
 * the layer that refused, as its decider, and never tells a stored record from
 * a missing one. The engine-level pins live beside the engine
 * (`explain-self-refused-read-one-answer.test.ts` in plugin-security); this
 * file holds the wire: the body the route answers, byte for byte.
 *
 * ## What is pinned
 *
 * - a create-only caller is refused its read at the `/data` door, for the
 *   stored row and a missing id alike;
 * - `POST` and `GET /security/explain`, for every verb, answer the stored id
 *   and the missing id with the same body, apart from the echoed id, decided
 *   by the read's refusal; the batch form likewise;
 * - the control: a caller who reads the object is still told the stored row's
 *   story, and a missing id stays a missing id.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema, type ExplainOperation } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const BOARD = 'qa_srd_board';
const STORED = 'r_stored';
const MISSING = 'r_missing';
const EVERY_VERB: ExplainOperation[] = ['read', 'create', 'update', 'delete', 'transfer', 'restore', 'purge', 'export'];

const CREATE_ONLY_SET = PermissionSetSchema.parse({ name: 'qa_srd_create_only', objects: { [BOARD]: { allowCreate: true } } });
const READER_SET = PermissionSetSchema.parse({
  name: 'qa_srd_reader',
  objects: { [BOARD]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});
const CREATE_ONLY_CALLER = { userId: 'usr_srd_create_only', positions: [], permissions: [CREATE_ONLY_SET.name], principalKind: 'human' };
const READER_CALLER = { userId: 'usr_srd_reader', positions: [], permissions: [READER_SET.name], principalKind: 'human' };

interface Wire {
  status: number;
  body: any;
}

let engine: ObjectQL;
let caller: Record<string, unknown> = CREATE_ONLY_CALLER;
let call: (method: string, path: string, req: Record<string, unknown>) => Promise<Wire>;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.explain-self-refused-read-door',
    name: 'Explain door: a refused read is one answer for every record id',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: BOARD,
        label: 'Board',
        sharingModel: 'public_read_write',
        fields: {
          name: { name: 'name', type: 'text' },
          owner_id: { name: 'owner_id', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  // A real `single` install's Default Organization (ADR-0131 D1/D9).
  await installDefaultOrganization(engine);

  const sets = [CREATE_ONLY_SET, READER_SET];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? sets.find((s) => s.name === name) : engine.getSchema(name)) ?? null,
      list: async () => sets,
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
  const plugin = new SecurityPlugin({ fallbackPermissionSet: CREATE_ONLY_SET.name });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert(BOARD, { id: STORED, name: 'stored', owner_id: 'usr_srd_owner' }, { context: SYS_CTX } as never);

  const noop = () => {};
  const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
  const rest = new RestServer(server as any, new ObjectStackProtocolImplementation(engine as any) as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ ...caller });
  (rest as any).securityServiceProvider = async () => services.security;
  rest.registerRoutes();

  call = async (method, path, req) => {
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
    return { status: res.statusCode, body: res.body };
  };
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

const explainPost = (operation: ExplainOperation, recordId: string) =>
  call('POST', '/api/v1/security/explain', { body: { object: BOARD, operation, recordId } });
const explainGet = (operation: ExplainOperation, recordId: string) =>
  call('GET', '/api/v1/security/explain', { query: { object: BOARD, operation, recordId } });
const readDoor = (id: string) => call('GET', '/api/v1/data/:object/:id', { params: { object: BOARD, id } });

/** The wire body, serialised with the echoed record id set aside. */
const bytesApartFromId = (w: Wire): string => JSON.stringify(w.body).split(STORED).join('ID').split(MISSING).join('ID');
/** The decision the route answered, in either envelope this family speaks. */
const decisionOf = (w: Wire): any => w.body?.data ?? w.body;

describe('a caller whose read of the object is refused gets one explain answer for every record id, at the door', () => {
  it('armed: the /data read door refuses the caller the stored row and a missing id alike', async () => {
    caller = CREATE_ONLY_CALLER;
    const stored = await readDoor(STORED);
    const missing = await readDoor(MISSING);
    expect(stored.status).toBe(403);
    expect(missing.status).toBe(stored.status);
  });

  for (const verb of EVERY_VERB) {
    it(`${verb}: POST and GET answer the stored id and a missing id with the same body, decided by the read's refusal`, async () => {
      caller = CREATE_ONLY_CALLER;
      for (const explain of [explainPost, explainGet]) {
        const stored = await explain(verb, STORED);
        const missing = await explain(verb, MISSING);
        expect(stored.status, verb).toBe(200);
        expect(missing.status, verb).toBe(200);
        expect(decisionOf(stored).record, verb).toEqual({ recordId: STORED, visible: false, decidedBy: 'object_crud' });
        expect(bytesApartFromId(stored), verb).toBe(bytesApartFromId(missing));
      }
    });
  }

  it('batch: every id\'s verdict is the refused read\'s, the stored id\'s and the missing id\'s alike', async () => {
    caller = CREATE_ONLY_CALLER;
    for (const verb of EVERY_VERB) {
      const batch = await call('POST', '/api/v1/security/explain', { body: { object: BOARD, operation: verb, recordIds: [STORED, MISSING] } });
      expect(batch.status, verb).toBe(200);
      expect(decisionOf(batch).records, verb).toEqual([
        { recordId: STORED, visible: false, decidedBy: 'object_crud' },
        { recordId: MISSING, visible: false, decidedBy: 'object_crud' },
      ]);
    }
  });

  it('control: a caller who reads the object is told the stored row\'s story, and a missing id stays missing', async () => {
    caller = READER_CALLER;
    expect((await readDoor(STORED)).status).toBe(200);
    for (const verb of ['read', 'update', 'delete'] as ExplainOperation[]) {
      const stored = await explainPost(verb, STORED);
      const missing = await explainPost(verb, MISSING);
      expect(decisionOf(stored).record, verb).toMatchObject({ recordId: STORED, visible: true });
      expect(decisionOf(missing).record, verb).toEqual({ recordId: MISSING, visible: false });
    }
  });
});
