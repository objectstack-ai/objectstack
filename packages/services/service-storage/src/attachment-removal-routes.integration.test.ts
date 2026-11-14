// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The uploader removes an attachment they uploaded, through the removal door
 * `StorageServicePlugin` mounts (`attachment-removal-routes.ts`, maintainer
 * ruling 6879388034: own uploads only, and no delete bit on the member grant).
 *
 * One real `ObjectQL` over sqlite `:memory:`, `StorageServicePlugin` on the
 * local adapter booted through `kernel:ready` and `kernel:bootstrapped`, so the
 * attachment gates, the read-visibility gate and the lifecycle hooks are the
 * plugin's own; the door is called as the route it mounts. The attachments are
 * written through the attach rule as their uploaders, so `uploaded_by` is the
 * gate's stamp and never a fixture's value.
 *
 * Record access is the fixture's stand-in: a `sharing` service lets the case's
 * two members edit it (the attach rule's parent-EDIT verdict), and a read
 * middleware hides the case from the outsider. The object grant and the
 * administrator are plugin-security's, pinned on the real stack in the dogfood
 * suite `member-attachment-baseline.dogfood.test.ts`.
 *
 *  - the uploader's removal answers `200` and the row is gone, its file
 *    tombstoned by the lifecycle;
 *  - another member is refused `403 PERMISSION_DENIED` and the row stays —
 *    a member who can edit the record it is attached to included;
 *  - a caller who cannot read the record gets the unknown id's `404
 *    RECORD_NOT_FOUND`, and the row stays;
 *  - a request that names nobody is refused `401`, and nothing is removed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RouteHandler } from '@objectstack/spec/contracts';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { StorageServicePlugin } from './storage-service-plugin.js';
import { installDefaultOrganization, DEFAULT_ORGANIZATION_ID } from './default-organization.testkit.js';
import { ATTACHMENT_REMOVE_ROUTE } from './attachment-removal-routes.js';

const ORG = DEFAULT_ORGANIZATION_ID;
const SYS = { isSystem: true } as const;
const CASE = 'door_case';
/** Uploads the attachments under test. */
const ALICE = 'u_alice';
/** Another member who edits the same case. */
const BOB = 'u_bob';
/** A member who cannot read the case. */
const CAROL = 'u_carol';
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

type Answer = { status: number; body: any };

describe('the uploader removes an attachment they uploaded, and nobody else does', () => {
  let rootDir: string;
  let engine: ObjectQL;
  const routes = new Map<string, RouteHandler>();
  const services = new Map<string, unknown>();
  let caseId: string;

  /** One `DELETE` on the door; the session is whatever `x-test-user` names (none for `null`). */
  const remove = async (id: string, user: string | null): Promise<Answer> => {
    const handler = routes.get(`DELETE:${ATTACHMENT_REMOVE_ROUTE}`);
    if (!handler) throw new Error(`no route DELETE ${ATTACHMENT_REMOVE_ROUTE}`);
    const res: any = {
      _status: 200, _json: undefined,
      json(data: unknown) { res._json = data; return res; },
      send() { return res; },
      status(code: number) { res._status = code; return res; },
      header() { return res; },
    };
    await handler(
      { params: { id }, query: {}, headers: user === null ? {} : { 'x-test-user': user }, method: 'DELETE', path: `/api/v1/attachments/${id}` } as never,
      res,
    );
    return { status: res._status, body: res._json };
  };

  const attachmentRow = (id: string) =>
    engine.findOne('sys_attachment', { where: { id }, context: SYS } satisfies EngineQueryOptions);
  const fileRow = (id: string) =>
    engine.findOne('sys_file', { where: { id }, context: SYS } satisfies EngineQueryOptions);

  /** An `attachments`-scope upload `owner` committed, as the presigned upload leaves it. */
  const seedFile = async (id: string, owner: string) => {
    await engine.insert('sys_file', {
      id, key: `attachments/${id}.txt`, name: `${id}.txt`, scope: 'attachments',
      status: 'committed', owner_id: owner, organization_id: ORG,
    }, { context: SYS });
  };

  /** Attach `fileId` to the case AS `user`: the attach rule judges it and stamps the uploader. */
  const attachAs = async (user: string, fileId: string): Promise<string> => {
    const row = await engine.insert(
      'sys_attachment',
      { parent_object: CASE, parent_id: caseId, file_id: fileId, file_name: `${fileId}.txt` },
      { context: { userId: user, tenantId: ORG } },
    );
    return String(row.id);
  };

  beforeAll(async () => {
    rootDir = join(tmpdir(), `os-attachment-removal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });

    engine = new ObjectQL({ logger: silentLogger() } as never);
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }) as never, true);
    await engine.init();

    // The real engine, except that a read of an object this fixture never
    // registered (the permission store the caller resolution consults)
    // answers empty.
    const dataEngine = new Proxy(engine, {
      get(target, prop) {
        if (prop === 'find') {
          return (object: string, query?: EngineQueryOptions, options?: unknown) =>
            target.getSchema(object) ? target.find(object, query, options as never) : Promise.resolve([]);
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const phases = new Map<string, Array<() => unknown>>();
    const mount = (m: string) => (path: string, handler: RouteHandler) => { routes.set(`${m}:${path}`, handler); };
    const ctx = {
      logger: silentLogger(),
      registerService: (name: string, svc: unknown) => { services.set(name, svc); },
      getService: <T>(name: string): T => {
        if (!services.has(name)) throw new Error(`service '${name}' not registered`);
        return services.get(name) as T;
      },
      hook: (event: string, fn: () => unknown) => { phases.set(event, [...(phases.get(event) ?? []), fn]); },
    };
    ctx.registerService('objectql', dataEngine);
    ctx.registerService('http-server', {
      get: mount('GET'), post: mount('POST'), put: mount('PUT'), delete: mount('DELETE'), patch: mount('PATCH'),
      use: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    ctx.registerService('manifest', { register: (manifest: unknown) => engine.registerApp(manifest as never) });
    ctx.registerService('auth', {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const userId = headers.get('x-test-user');
          return userId ? { user: { id: userId }, session: { activeOrganizationId: ORG } } : undefined;
        },
      },
    });
    // The case's two members edit it; the outsider does not.
    ctx.registerService('sharing', {
      checkEdit: async (object: string, _id: string, context: { userId?: string }) => {
        if (object !== CASE) return 'abstain';
        return context.userId === ALICE || context.userId === BOB ? 'allow' : 'deny';
      },
    });

    const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false });
    await plugin.init(ctx as never);

    engine.registerApp({
      id: 'com.objectstack.test.attachment-removal',
      name: 'Attachment removal',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [{
        name: CASE,
        label: 'Case',
        enable: { files: true },
        fields: { name: { name: 'name', type: 'text' } },
      }],
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    // Each caller is a current member of the organization its session names
    // (ADR-0093 D8.1, as amended). Data at rest, seeded through the driver.
    engine.registry.registerObject(
      {
        name: 'sys_member', label: 'Member', managedBy: 'better-auth',
        fields: { user_id: { type: 'text', label: 'User' }, organization_id: { type: 'text', label: 'Organization' }, role: { type: 'text', label: 'Role' } },
      },
      '@objectstack/service-storage',
    );
    await engine.syncSchemas();
    for (const userId of [ALICE, BOB, CAROL]) {
      await engine.getDriverForObject('sys_member')!.create('sys_member', { id: `mem_${userId}`, user_id: userId, organization_id: ORG, role: 'member' });
    }

    // Record visibility, as the fixture stands it in: the outsider reads no case.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      const c = op.context;
      if (READ_OPS.has(op.operation) && c && !c.isSystem && c.userId === CAROL && op.ast) {
        const none = { id: '__no_case__' };
        op.ast.where = op.ast.where ? { $and: [op.ast.where, none] } : none;
      }
      return next();
    }, { object: CASE });

    await plugin.start(ctx as never);
    for (const fn of phases.get('kernel:ready') ?? []) await fn();
    for (const fn of phases.get('kernel:bootstrapped') ?? []) await fn();

    caseId = String((await engine.insert(CASE, { name: 'the case', organization_id: ORG }, { context: SYS })).id);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* already torn down */ }
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('is mounted by the plugin at its fixed route, outside the storage family', () => {
    expect(ATTACHMENT_REMOVE_ROUTE).toBe('/api/v1/attachments/:id');
    expect([...routes.keys()].filter((k) => k.startsWith('DELETE:'))).toEqual([`DELETE:${ATTACHMENT_REMOVE_ROUTE}`]);
  });

  it('the uploader removes their own attachment: 200, the row is gone, and its file is tombstoned', async () => {
    await seedFile('f_alice_own', ALICE);
    const id = await attachAs(ALICE, 'f_alice_own');
    expect((await attachmentRow(id))?.uploaded_by, 'the attach rule stamped the uploader').toBe(ALICE);

    const answer = await remove(id, ALICE);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body).toEqual({ success: true, data: { id, deleted: true } });
    expect(await attachmentRow(id)).toBeNull();
    expect((await fileRow('f_alice_own'))?.status, 'the lifecycle ran on the removal').toBe('deleted');
  });

  it('another member is refused PERMISSION_DENIED and the row stays, even one who can edit the record', async () => {
    await seedFile('f_alice_kept', ALICE);
    const id = await attachAs(ALICE, 'f_alice_kept');
    // The other member edits the case: their own attach to it is admitted.
    await seedFile('f_bob_own', BOB);
    const bobs = await attachAs(BOB, 'f_bob_own');
    expect((await attachmentRow(bobs))?.uploaded_by).toBe(BOB);

    const answer = await remove(id, BOB);
    expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([403, 'PERMISSION_DENIED']);
    expect(await attachmentRow(id)).toMatchObject({ id, uploaded_by: ALICE });
    expect((await fileRow('f_alice_kept'))?.status).toBe('committed');

    // And the uploader the other way round: Alice cannot remove Bob's.
    const reverse = await remove(bobs, ALICE);
    expect([reverse.status, reverse.body?.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect(await attachmentRow(bobs)).toMatchObject({ id: bobs, uploaded_by: BOB });
  });

  it('a caller who cannot read the record gets the unknown id\'s RECORD_NOT_FOUND, and the row stays', async () => {
    await seedFile('f_alice_hidden', ALICE);
    const id = await attachAs(ALICE, 'f_alice_hidden');

    const hidden = await remove(id, CAROL);
    const unknown = await remove('att_no_such_row', CAROL);
    expect([hidden.status, hidden.body?.error?.code]).toEqual([404, 'RECORD_NOT_FOUND']);
    expect([unknown.status, unknown.body?.error?.code]).toEqual([404, 'RECORD_NOT_FOUND']);
    expect(await attachmentRow(id)).toMatchObject({ id, uploaded_by: ALICE });
  });

  it('a request that names nobody is refused 401, and nothing is removed', async () => {
    await seedFile('f_alice_anon', ALICE);
    const id = await attachAs(ALICE, 'f_alice_anon');

    const answer = await remove(id, null);
    expect([answer.status, answer.body?.error?.code]).toEqual([401, 'UNAUTHENTICATED']);
    expect(await attachmentRow(id)).toMatchObject({ id, uploaded_by: ALICE });
  });
});
