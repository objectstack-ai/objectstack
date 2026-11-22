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
 * middleware hides the case from the outsider. Two more middlewares stand in
 * for grants the rename door's pins need: the object's edit grant on
 * `sys_attachment` (held by BOB and DAVE only) and DAVE's missing read of
 * `sys_user`. The object grant and the
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
 *
 * The same stack serves the rename door (`PATCH` at the same route) and the
 * attachment read the record Attachments panel draws its uploader column from,
 * each pinned in its own `describe` below over its own boot of the stack:
 *
 *  - the uploader renames their own attachment with no edit grant, and a
 *    member holding the grant who can edit the record renames another's,
 *    through the update gate's parent-editor limb — both `200`, the new name
 *    stored on the row and the file untouched; without the grant, an editor of
 *    the record is refused another's (`403 PERMISSION_DENIED`);
 *  - a member who can read the record but not edit it is refused the update
 *    gate's `403 RECORD_NOT_ACCESSIBLE`, a caller who cannot read it the unknown
 *    id's `404`, a request that names nobody `401`, and a malformed request
 *    `400` — each leaving the name as it was;
 *  - a reader who may read the uploader reads the attachment with
 *    `uploaded_by` expanded to that user's row and name; a reader the user read
 *    refuses keeps the stored id, and no name.
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
import { ATTACHMENT_REMOVE_ROUTE, ATTACHMENT_RENAME_ROUTE } from './attachment-removal-routes.js';

const ORG = DEFAULT_ORGANIZATION_ID;
const SYS = { isSystem: true } as const;
const CASE = 'door_case';
/** Uploads the attachments under test. */
const ALICE = 'u_alice';
/** Another member who edits the same case. */
const BOB = 'u_bob';
/** A member who cannot read the case. */
const CAROL = 'u_carol';
/** A member who reads the case but cannot edit it. */
const DAVE = 'u_dave';
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

type Answer = { status: number; body: any };

/** The booted door stack: one engine, the routes the plugin mounted, and the case. */
interface DoorStack {
  engine: ObjectQL;
  routes: Map<string, RouteHandler>;
  rootDir: string;
  caseId: string;
}

/**
 * Boot the stack every `describe` below runs over. `sys_user` is registered
 * with one row per member, so an attachment read can expand its uploader, and
 * a read middleware refuses DAVE every user row: the fixture's stand-in for a
 * reader without user-read rights.
 */
async function bootDoorStack(): Promise<DoorStack> {
  const routes = new Map<string, RouteHandler>();
  const services = new Map<string, unknown>();
  let rootDir: string;
  let engine: ObjectQL;
  let caseId: string;
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
  for (const userId of [ALICE, BOB, CAROL, DAVE]) {
    await engine.getDriverForObject('sys_member')!.create('sys_member', { id: `mem_${userId}`, user_id: userId, organization_id: ORG, role: 'member' });
  }
  // The members' user rows, so an attachment read can expand its uploader.
  engine.registry.registerObject(
    {
      name: 'sys_user', label: 'User', nameField: 'name',
      fields: { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' } },
    },
    '@objectstack/service-storage',
  );
  await engine.syncSchemas();
  for (const [userId, name] of [[ALICE, 'Alice Uploader'], [BOB, 'Bob Editor'], [CAROL, 'Carol Outsider'], [DAVE, 'Dave Reader']]) {
    await engine.getDriverForObject('sys_user')!.create('sys_user', { id: userId, name, email: `${userId}@door.test`, organization_id: ORG });
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
  // The object's edit grant, as the fixture stands it in: BOB and DAVE hold
  // one on `sys_attachment` (the member baseline carries read and create
  // only); a caller's update without it is refused here, ahead of the
  // attachment update gate, as plugin-security's CRUD check refuses it.
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    const c = op.context;
    if (op.operation === 'update' && c && !c.isSystem && c.userId !== BOB && c.userId !== DAVE) {
      const err: any = new Error(`Permission denied: no edit grant on sys_attachment for ${c.userId}`);
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      throw err;
    }
    return next();
  }, { object: 'sys_attachment' });
  // User-read rights, as the fixture stands them in: DAVE reads no user row.
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    const c = op.context;
    if (READ_OPS.has(op.operation) && c && !c.isSystem && c.userId === DAVE && op.ast) {
      const none = { id: '__no_user__' };
      op.ast.where = op.ast.where ? { $and: [op.ast.where, none] } : none;
    }
    return next();
  }, { object: 'sys_user' });

  await plugin.start(ctx as never);
  for (const fn of phases.get('kernel:ready') ?? []) await fn();
  for (const fn of phases.get('kernel:bootstrapped') ?? []) await fn();

  caseId = String((await engine.insert(CASE, { name: 'the case', organization_id: ORG }, { context: SYS })).id);
  return { engine, routes, rootDir, caseId };
}

async function stopDoorStack(stack: DoorStack | undefined): Promise<void> {
  try { await stack?.engine.destroy(); } catch { /* already torn down */ }
  if (stack?.rootDir) await fs.rm(stack.rootDir, { recursive: true, force: true });
}

/** One request on a door the plugin mounted; the session is whatever `x-test-user` names (none for `null`). */
async function callDoor(
  stack: DoorStack,
  method: 'DELETE' | 'PATCH',
  id: string,
  user: string | null,
  extra: { body?: unknown; query?: Record<string, string> } = {},
): Promise<Answer> {
  const route = method === 'DELETE' ? ATTACHMENT_REMOVE_ROUTE : ATTACHMENT_RENAME_ROUTE;
  const handler = stack.routes.get(`${method}:${route}`);
  if (!handler) throw new Error(`no route ${method} ${route}`);
  const res: any = {
    _status: 200, _json: undefined,
    json(data: unknown) { res._json = data; return res; },
    send() { return res; },
    status(code: number) { res._status = code; return res; },
    header() { return res; },
  };
  await handler(
    {
      params: { id },
      query: extra.query ?? {},
      headers: user === null ? {} : { 'x-test-user': user },
      method,
      path: `/api/v1/attachments/${id}`,
      ...('body' in extra ? { body: extra.body } : {}),
    } as never,
    res,
  );
  return { status: res._status, body: res._json };
}

/** The reads and seeds every `describe` below makes over its stack. */
function doorFixture(stack: () => DoorStack) {
  return {
    attachmentRow: (id: string) =>
      stack().engine.findOne('sys_attachment', { where: { id }, context: SYS } satisfies EngineQueryOptions),
    fileRow: (id: string) =>
      stack().engine.findOne('sys_file', { where: { id }, context: SYS } satisfies EngineQueryOptions),
    /** An `attachments`-scope upload `owner` committed, as the presigned upload leaves it. */
    seedFile: async (id: string, owner: string) => {
      await stack().engine.insert('sys_file', {
        id, key: `attachments/${id}.txt`, name: `${id}.txt`, scope: 'attachments',
        status: 'committed', owner_id: owner, organization_id: ORG,
      }, { context: SYS });
    },
    /** Attach `fileId` to the case AS `user`: the attach rule judges it and stamps the uploader. */
    attachAs: async (user: string, fileId: string): Promise<string> => {
      const row = await stack().engine.insert(
        'sys_attachment',
        { parent_object: CASE, parent_id: stack().caseId, file_id: fileId, file_name: `${fileId}.txt` },
        { context: { userId: user, tenantId: ORG } },
      );
      return String(row.id);
    },
  };
}

describe('the uploader removes an attachment they uploaded, and nobody else does', () => {
  let stack: DoorStack;
  const { attachmentRow, fileRow, seedFile, attachAs } = doorFixture(() => stack);
  const remove = (id: string, user: string | null) => callDoor(stack, 'DELETE', id, user);

  beforeAll(async () => {
    stack = await bootDoorStack();
  });

  afterAll(async () => {
    await stopDoorStack(stack);
  });

  it('is mounted by the plugin at its fixed route, outside the storage family', () => {
    expect(ATTACHMENT_REMOVE_ROUTE).toBe('/api/v1/attachments/:id');
    expect([...stack.routes.keys()].filter((k) => k.startsWith('DELETE:'))).toEqual([`DELETE:${ATTACHMENT_REMOVE_ROUTE}`]);
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

describe('the rename door renames an attachment by the delete rule: its uploader, or an editor of the record', () => {
  let stack: DoorStack;
  const { attachmentRow, fileRow, seedFile, attachAs } = doorFixture(() => stack);
  const rename = (id: string, user: string | null, body: unknown = { file_name: 'renamed.txt' }, query?: Record<string, string>) =>
    callDoor(stack, 'PATCH', id, user, { body, ...(query ? { query } : {}) });

  beforeAll(async () => {
    stack = await bootDoorStack();
  });

  afterAll(async () => {
    await stopDoorStack(stack);
  });

  it('is mounted at the removal door\'s route, as PATCH', () => {
    expect(ATTACHMENT_RENAME_ROUTE).toBe(ATTACHMENT_REMOVE_ROUTE);
    expect([...stack.routes.keys()].filter((k) => k.startsWith('PATCH:'))).toEqual([`PATCH:${ATTACHMENT_RENAME_ROUTE}`]);
  });

  it('the uploader renames their own attachment with no edit grant: 200, the name persists on the row, and the file is untouched', async () => {
    await seedFile('f_alice_rename', ALICE);
    const id = await attachAs(ALICE, 'f_alice_rename');

    const answer = await rename(id, ALICE, { file_name: '  Q3 report.txt  ' });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body).toEqual({ success: true, data: { id, file_name: 'Q3 report.txt' } });
    expect(await attachmentRow(id)).toMatchObject({ id, file_name: 'Q3 report.txt', uploaded_by: ALICE });
    expect((await fileRow('f_alice_rename'))?.name, 'the stored file keeps its own name').toBe('f_alice_rename.txt');
  });

  it('the uploader renames their own attachment on a record they read but cannot edit: the uploader limb needs no edit', async () => {
    // A row DAVE uploaded, as one attached while he could still edit the case.
    await seedFile('f_dave_own', DAVE);
    const id = String((await stack.engine.insert('sys_attachment', {
      parent_object: CASE, parent_id: stack.caseId, file_id: 'f_dave_own', file_name: 'f_dave_own.txt',
      uploaded_by: DAVE, organization_id: ORG,
    }, { context: SYS })).id);

    const answer = await rename(id, DAVE, { file_name: 'daves notes.txt' });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(await attachmentRow(id)).toMatchObject({ id, file_name: 'daves notes.txt', uploaded_by: DAVE });
  });

  it('a member who can edit the record renames another member\'s attachment, through the update gate', async () => {
    await seedFile('f_alice_for_bob', ALICE);
    const id = await attachAs(ALICE, 'f_alice_for_bob');

    const answer = await rename(id, BOB, { file_name: 'named by bob.txt' });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(await attachmentRow(id)).toMatchObject({ id, file_name: 'named by bob.txt', uploaded_by: ALICE });
  });

  it('an editor of the record without the edit grant is refused the grant\'s 403 on another member\'s attachment', async () => {
    await seedFile('f_bob_for_alice', BOB);
    const id = await attachAs(BOB, 'f_bob_for_alice');

    const answer = await rename(id, ALICE);
    expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([403, 'PERMISSION_DENIED']);
    expect(await attachmentRow(id)).toMatchObject({ id, file_name: 'f_bob_for_alice.txt', uploaded_by: BOB });
  });

  it('a member who reads the record but cannot edit it is refused the update gate\'s 403, and the name stays', async () => {
    await seedFile('f_alice_for_dave', ALICE);
    const id = await attachAs(ALICE, 'f_alice_for_dave');

    const answer = await rename(id, DAVE);
    expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([403, 'RECORD_NOT_ACCESSIBLE']);
    expect(await attachmentRow(id)).toMatchObject({ id, file_name: 'f_alice_for_dave.txt' });
  });

  it('a caller who cannot read the record gets the unknown id\'s 404, and the name stays', async () => {
    await seedFile('f_alice_for_carol', ALICE);
    const id = await attachAs(ALICE, 'f_alice_for_carol');

    const hidden = await rename(id, CAROL);
    const unknown = await rename('att_no_such_row', ALICE);
    expect([hidden.status, hidden.body?.error?.code]).toEqual([404, 'RECORD_NOT_FOUND']);
    expect([unknown.status, unknown.body?.error?.code]).toEqual([404, 'RECORD_NOT_FOUND']);
    expect(await attachmentRow(id)).toMatchObject({ id, file_name: 'f_alice_for_carol.txt' });
  });

  it('a request that names nobody is refused 401, and the name stays', async () => {
    await seedFile('f_alice_anon_rename', ALICE);
    const id = await attachAs(ALICE, 'f_alice_anon_rename');

    const answer = await rename(id, null);
    expect([answer.status, answer.body?.error?.code]).toEqual([401, 'UNAUTHENTICATED']);
    expect(await attachmentRow(id)).toMatchObject({ id, file_name: 'f_alice_anon_rename.txt' });
  });

  it('refuses a blank name, another key, a non-object body and a query parameter with 400, and the name stays', async () => {
    await seedFile('f_alice_bad_body', ALICE);
    const id = await attachAs(ALICE, 'f_alice_bad_body');

    for (const answer of [
      await rename(id, ALICE, { file_name: '   ' }),
      await rename(id, ALICE, { file_name: 7 }),
      await rename(id, ALICE, {}),
      await rename(id, ALICE, { file_name: 'x.txt', parent_id: 'elsewhere' }),
      await rename(id, ALICE, ['x.txt']),
      await rename(id, ALICE, { file_name: 'x.txt' }, { force: '1' }),
    ]) {
      expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([400, 'VALIDATION_ERROR']);
    }
    expect(await attachmentRow(id)).toMatchObject({ id, file_name: 'f_alice_bad_body.txt', parent_id: stack.caseId });
  });
});

describe('an attachment read serves its uploader as the reader may read that user', () => {
  let stack: DoorStack;
  const { seedFile, attachAs } = doorFixture(() => stack);
  const readAs = (user: string, id: string) =>
    stack.engine.findOne('sys_attachment', {
      where: { id },
      expand: { uploaded_by: { object: 'uploaded_by' } },
      context: { userId: user, tenantId: ORG },
    } as EngineQueryOptions);

  beforeAll(async () => {
    stack = await bootDoorStack();
  });

  afterAll(async () => {
    await stopDoorStack(stack);
  });

  it('another member\'s attachment carries its uploader\'s row and name for a reader who may read that user', async () => {
    await seedFile('f_alice_named', ALICE);
    const id = await attachAs(ALICE, 'f_alice_named');

    const row = await readAs(BOB, id);
    expect(row?.uploaded_by).toMatchObject({ id: ALICE, name: 'Alice Uploader' });
  });

  it('a reader the user read refuses keeps the stored id and is served no name', async () => {
    await seedFile('f_alice_unnamed', ALICE);
    const id = await attachAs(ALICE, 'f_alice_unnamed');

    const row = await readAs(DAVE, id);
    expect(row, 'the reader reads the attachment itself').toMatchObject({ id, file_name: 'f_alice_unnamed.txt' });
    expect(row?.uploaded_by).toBe(ALICE);
    expect(JSON.stringify(row)).not.toContain('Alice Uploader');
  });
});
