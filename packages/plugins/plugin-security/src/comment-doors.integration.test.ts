// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The comment doors (`plugin-audit`'s `comment-routes.ts`) on the real stack:
 * a rank-and-file member resolves and reopens a colleague's thread through the
 * resolution door, and removes a comment they wrote through the own-comment
 * delete door, while the data door answers exactly what it answered before
 * (ruling records 7063285032 and 7069889899).
 *
 * The members here hold what every signed-in member holds: the platform
 * baseline `member_default` (read, create and update on `sys_comment`, no
 * delete; the row floor `owner_only_writes` admits their update of their own
 * rows alone) and an application's every-member set that reads the parent
 * object. An organization administrator is the unchanged control.
 *
 *  - the REAL `AuditPlugin` (the comment object, its access hooks, the
 *    resolution stamp, and the doors it mounts on the kernel's HTTP server);
 *  - the REAL `SecurityPlugin` with the shipped permission sets;
 *  - the REAL caller resolution, over the identity rows seeded below and an
 *    auth service whose session read names the user the request names.
 *
 * The one stand-in is the HTTP transport: a capturing `http.server` records
 * the doors' registrations, and each case calls a registered handler with a
 * request and a recording response.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, assembleExecutionContext, resolveAuthzContext, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const COMMENT = 'sys_comment';
/** A parent object every member reads. */
const OPEN = 'cmd_board';
/** A parent object no member reads. */
const SECRET = 'cmd_vault';
const ORG = 'org_acme';
const RESOLUTION_ROUTE = '/api/v1/comments/:id/resolution';
const REMOVE_ROUTE = '/api/v1/comments/:id';
/** The header the test auth service reads the signed-in user from. */
const SIGNED_IN_AS = 'x-test-signed-in-as';

const ALICE = 'usr_alice';
const BOB = 'usr_bob';
const CAROL = 'usr_carol';

/** The application's every-member set: it reads the parent; comments come from `member_default`. */
const APP_EVERYONE_SET = PermissionSetSchema.parse({
  name: 'cmd_app_member',
  label: 'App member (every-member set)',
  objects: {
    [OPEN]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});

const SYS = { isSystem: true, tenantId: ORG } as const;

type Handler = (req: unknown, res: unknown) => unknown;
const routes = new Map<string, Handler>();

/** A capturing HTTP server: the doors' registrations are recorded, never served. */
function httpServerPlugin(): Plugin {
  const record = (verb: string) => (path: string, handler: Handler) => {
    routes.set(`${verb} ${path}`, handler);
  };
  const server = {
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    patch: record('PATCH'),
    delete: record('DELETE'),
    use: () => undefined,
    listen: async () => undefined,
    close: async () => undefined,
  };
  return {
    name: 'test.http',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService('http.server', server);
    },
  };
}

/** An auth service whose in-process session read names the user the request names. */
function authPlugin(): Plugin {
  const api = {
    async getSession(input: { headers: Headers }) {
      const userId = input.headers.get(SIGNED_IN_AS);
      if (!userId) return null;
      return {
        user: { id: userId, email: `${userId}@acme.test` },
        session: { id: `ses_${userId}`, userId, activeOrganizationId: ORG },
      };
    },
  };
  return {
    name: 'test.auth',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService('auth', { api });
    },
  };
}

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

function objectsPlugin(): Plugin {
  const parent = (name: string, label: string) => ({
    name,
    label,
    fields: { name: { type: 'text', label: 'Name' } },
  });
  return {
    name: 'test.objects',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.comment-doors',
        namespace: 'cmd',
        version: '1.0.0',
        type: 'plugin',
        name: 'Comment doors fixture',
        objects: [SysUser, SysMember, SysOrganization, parent(OPEN, 'Board'), parent(SECRET, 'Vault')],
      });
    },
  };
}

interface Answer {
  status: number;
  body: any;
}

/** Call the door mounted at `VERB route` as `signedInAs` (or nobody). */
async function callDoor(
  verb: 'PUT' | 'DELETE',
  route: string,
  id: string,
  signedInAs: string | undefined,
  extra: { body?: unknown; query?: Record<string, string> } = {},
): Promise<Answer> {
  const handler = routes.get(`${verb} ${route}`);
  if (!handler) throw new Error(`no ${verb} ${route} is mounted on the kernel's HTTP server`);
  const answer: Answer = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      answer.status = code;
      return res;
    },
    json(body: unknown) {
      answer.body = body;
    },
    send(body: unknown) {
      answer.body = body;
    },
    header() {
      return res;
    },
  };
  await handler(
    {
      method: verb,
      path: route.replace(':id', id),
      params: { id },
      query: extra.query ?? {},
      body: extra.body,
      headers: signedInAs ? { [SIGNED_IN_AS]: signedInAs } : {},
    },
    res,
  );
  return answer;
}

const resolve = (id: string, as: string | undefined, body: unknown = { resolved: true }, query?: Record<string, string>) =>
  callDoor('PUT', RESOLUTION_ROUTE, id, as, { body, query });
const remove = (id: string, as: string | undefined) => callDoor('DELETE', REMOVE_ROUTE, id, as);

describe('the comment doors — a member resolves any thread they can read, and removes only their own comment', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let boardThread: string;
  let vaultThread: string;
  /** Each persona's context as the platform's one resolver gives it, for the data door's path. */
  const as: Record<string, any> = {};
  const contextOf = async (userId: string): Promise<any> => {
    const authz = await resolveAuthzContext({
      ql,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `ses_${userId}`, userId, activeOrganizationId: ORG },
      }),
    } as never);
    return assembleExecutionContext({
      authz,
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    } as never);
  };

  const rowById = async (id: string) => ql.findOne(COMMENT, { where: { id }, context: SYS });
  /** A comment written as `author` (the engine stamps `created_by` from the writer). */
  const commentAs = async (author: string, threadId: string, body: string, parentId?: string): Promise<string> => {
    const row = await ql.insert(
      COMMENT,
      { thread_id: threadId, author_id: author, body, ...(parentId ? { parent_id: parentId } : {}) },
      { context: { ...SYS, userId: author } },
    );
    return String(row.id);
  };
  /** The data door's own path: the engine write under the caller's context, mapped to the wire as the REST door maps it. */
  const viaDataDoor = async (write: () => Promise<unknown>): Promise<number> => {
    try {
      await write();
      return 200;
    } catch (e) {
      return mapDataError(e, COMMENT).status;
    }
  };

  beforeAll(async () => {
    routes.clear();
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(httpServerPlugin());
    await kernel.use(authPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(objectsPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.use(
      new SecurityPlugin({
        defaultPermissionSets: [...defaultPermissionSets, APP_EVERYONE_SET],
        fallbackPermissionSet: APP_EVERYONE_SET.name,
      }),
    );
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');

    await ql.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme' }, { context: SYS });
    const roles: Record<string, string> = { [ALICE]: 'member', [BOB]: 'member', [CAROL]: 'admin' };
    for (const [userId, role] of Object.entries(roles)) {
      await ql.insert(
        'sys_user',
        { id: userId, name: userId, email: `${userId}@acme.test`, email_verified: true },
        { context: SYS },
      );
      await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role }, { context: SYS });
    }
    for (const userId of Object.keys(roles)) as[userId] = await contextOf(userId);

    const board = await ql.insert(OPEN, { name: 'board' }, { context: SYS });
    const vault = await ql.insert(SECRET, { name: 'vault' }, { context: SYS });
    boardThread = `${OPEN}:${board.id}`;
    vaultThread = `${SECRET}:${vault.id}`;
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('the fixture is armed: two plain members and an administrator', () => {
    expect(as[ALICE].positions).toEqual(expect.arrayContaining(['org_member', 'everyone']));
    expect(as[ALICE].positions).not.toContain('org_admin');
    expect(as[CAROL].positions).toEqual(expect.arrayContaining(['org_admin', 'everyone']));
  });

  describe('the resolution door', () => {
    it("a member resolves a colleague's thread — 200, resolved_by is the member — and reopens it", async () => {
      const id = await commentAs(BOB, boardThread, "Bob's question");
      const resolved = await resolve(id, ALICE);
      expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
      expect(resolved.body?.data).toMatchObject({ id, is_resolved: true, resolved_by: ALICE });
      expect(typeof resolved.body?.data?.resolved_at).toBe('string');
      expect(await rowById(id)).toMatchObject({ is_resolved: true, resolved_by: ALICE, body: "Bob's question" });

      const reopened = await resolve(id, ALICE, { resolved: false });
      expect(reopened.status).toBe(200);
      expect(reopened.body?.data).toEqual({ id, is_resolved: false, resolved_by: null, resolved_at: null });
      const stored = await rowById(id);
      expect(stored?.is_resolved).toBe(false);
      expect(stored?.resolved_by ?? null).toBeNull();
    });

    it("the data door does not move: a member's update of a colleague's comment is refused, is_resolved alone or with body", async () => {
      const id = await commentAs(BOB, boardThread, 'unchanged words');
      expect(await viaDataDoor(() => ql.update(COMMENT, { body: 'rewritten' }, { where: { id }, context: as[ALICE] }))).toBe(403);
      expect(await viaDataDoor(() => ql.update(COMMENT, { is_resolved: true }, { where: { id }, context: as[ALICE] }))).toBe(403);
      expect(
        await viaDataDoor(() => ql.update(COMMENT, { is_resolved: true, body: 'rewritten' }, { where: { id }, context: as[ALICE] })),
      ).toBe(403);
      expect(await rowById(id)).toMatchObject({ body: 'unchanged words', is_resolved: false });
    });

    it('a reply is refused — 400 VALIDATION_ERROR — and nothing is written', async () => {
      const root = await commentAs(BOB, boardThread, 'root');
      const reply = await commentAs(BOB, boardThread, 'reply', root);
      const answer = await resolve(reply, ALICE);
      expect(answer.status).toBe(400);
      expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
      expect((await rowById(reply))?.is_resolved ?? false).toBe(false);
    });

    it('a thread the member cannot read answers as an unknown id — 404 RECORD_NOT_FOUND — and stays', async () => {
      const id = await commentAs(BOB, vaultThread, 'vault talk');
      const hidden = await resolve(id, ALICE);
      const unknown = await resolve('cmd_no_such_comment', ALICE);
      expect(hidden.status).toBe(404);
      expect(hidden.body?.error?.code).toBe('RECORD_NOT_FOUND');
      expect({ status: unknown.status, code: unknown.body?.error?.code }).toEqual({
        status: hidden.status,
        code: hidden.body?.error?.code,
      });
      expect((await rowById(id))?.is_resolved ?? false).toBe(false);
    });

    it('anonymous is 401; a query parameter or any body but { resolved: boolean } is 400; nothing is written', async () => {
      const id = await commentAs(BOB, boardThread, 'shape');
      expect((await resolve(id, undefined)).status).toBe(401);
      expect((await resolve(id, ALICE, { resolved: true }, { force: 'true' })).status).toBe(400);
      for (const body of [undefined, {}, { resolved: 'yes' }, { resolved: true, body: 'x' }, { is_resolved: true }, [true]]) {
        const answer = await callDoor('PUT', RESOLUTION_ROUTE, id, ALICE, { body });
        expect(answer.status, JSON.stringify(body)).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
      }
      expect((await rowById(id))?.is_resolved ?? false).toBe(false);
    });
  });

  describe('the own-comment delete door', () => {
    it('own comment: removed — 200 — and gone', async () => {
      const id = await commentAs(ALICE, boardThread, 'mine');
      const answer = await remove(id, ALICE);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(answer.body).toEqual({ success: true, data: { id, deleted: true } });
      expect(await rowById(id)).toBeNull();
    });

    it("a colleague's comment: 403 PERMISSION_DENIED, and it stays", async () => {
      const id = await commentAs(BOB, boardThread, "Bob's");
      const answer = await remove(id, ALICE);
      expect(answer.status).toBe(403);
      expect(answer.body?.error?.code).toBe('PERMISSION_DENIED');
      expect((await rowById(id))?.id).toBe(id);
    });

    it('an own comment others replied under stays: 409 DELETE_RESTRICTED, root and reply unchanged', async () => {
      const root = await commentAs(ALICE, boardThread, 'my question');
      const reply = await commentAs(BOB, boardThread, "Bob's answer", root);
      const answer = await remove(root, ALICE);
      expect(answer.status).toBe(409);
      expect(answer.body?.error?.code).toBe('DELETE_RESTRICTED');
      expect((await rowById(root))?.id).toBe(root);
      expect((await rowById(reply))?.parent_id).toBe(root);
    });

    it('an own reply with nothing under it: removed — 200', async () => {
      const root = await commentAs(BOB, boardThread, "Bob's question");
      const reply = await commentAs(ALICE, boardThread, 'my reply', root);
      expect((await remove(reply, ALICE)).status).toBe(200);
      expect(await rowById(reply)).toBeNull();
      expect((await rowById(root))?.id).toBe(root);
    });

    it('an own comment on a record the member cannot read: 404, and it stays', async () => {
      const id = await commentAs(ALICE, vaultThread, 'mine, hidden');
      const answer = await remove(id, ALICE);
      expect(answer.status).toBe(404);
      expect(answer.body?.error?.code).toBe('RECORD_NOT_FOUND');
      expect((await rowById(id))?.id).toBe(id);
    });

    it("the grant model does not move: a member's data-door delete of their own comment still answers 403", async () => {
      const id = await commentAs(ALICE, boardThread, 'mine via data door');
      expect(await viaDataDoor(() => ql.delete(COMMENT, { where: { id }, context: as[ALICE] }))).toBe(403);
      expect((await rowById(id))?.id).toBe(id);
    });
  });

  describe('an administrator is unchanged', () => {
    it("the data door: an administrator resolves a member's thread as before (the row floor does not bind them), and the comment rule still decides edits and deletes", async () => {
      const id = await commentAs(BOB, boardThread, "Bob's words");
      expect(await viaDataDoor(() => ql.update(COMMENT, { is_resolved: true }, { where: { id }, context: as[CAROL] }))).toBe(200);
      expect(await rowById(id)).toMatchObject({ is_resolved: true, resolved_by: CAROL });
      // This fixture's administrator cannot edit the board, so the comment
      // rule (author or record editor) refuses them, as it did before.
      expect(await viaDataDoor(() => ql.update(COMMENT, { body: 'moderated' }, { where: { id }, context: as[CAROL] }))).toBe(403);
      expect(await viaDataDoor(() => ql.delete(COMMENT, { where: { id }, context: as[CAROL] }))).toBe(403);
      expect(await rowById(id)).toMatchObject({ body: "Bob's words" });
    });

    it("the doors: an administrator's own-comment door still refuses a member's comment (the moderator's delete is the data door's)", async () => {
      const id = await commentAs(BOB, boardThread, "Bob's, again");
      expect((await remove(id, CAROL)).status).toBe(403);
      expect((await resolve(id, CAROL)).status).toBe(200);
    });
  });
});
