// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A member with no position removes their own comment reaction through the
 * unreact door, and nobody else's (maintainer ruling 6422861164, letter A).
 *
 * The member here holds what every signed-in member holds and nothing more:
 * the platform baseline `member_default` and an application's every-member
 * set, which grants read and create on comments and reactions and, being
 * bound to the `everyone` anchor, may not carry `delete` (ADR-0090 D5,
 * `security-anchor-high-privilege`). No position-distributed set is held. On
 * the generic data door that member can add a reaction and never remove it;
 * this file pins the door that removes it, on the real stack:
 *
 *  - the REAL `AuditPlugin` (the reaction object, its read gate, and the door
 *    it mounts on the kernel's HTTP server);
 *  - the REAL `SecurityPlugin` with the shipped permission sets;
 *  - the REAL caller resolution: the door resolves each request through the
 *    platform's one resolver, over the identity rows seeded below and an auth
 *    service whose session read names the user the request names.
 *
 * The one stand-in is the HTTP transport: a capturing `http.server` records
 * the door's registration, and each case calls the registered handler with a
 * request and a recording response.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const REACTION = 'sys_comment_reaction';
const COMMENT = 'sys_comment';
/** A parent object every member reads. */
const OPEN = 'rxd_board';
/** A parent object no member reads. */
const SECRET = 'rxd_vault';
const ORG = 'org_acme';
const ROUTE = '/api/v1/comments/reactions/:id';
/** The header the test auth service reads the signed-in user from. */
const SIGNED_IN_AS = 'x-test-signed-in-as';

const ALICE = 'usr_alice';
const BOB = 'usr_bob';

/**
 * The application's every-member set: what an `isDefault` set bound to the
 * `everyone` anchor may carry. Read and create, never delete.
 */
const APP_EVERYONE_SET = PermissionSetSchema.parse({
  name: 'rxd_app_member',
  label: 'App member (every-member set)',
  objects: {
    [OPEN]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    [COMMENT]: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
    [REACTION]: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});

const SYS = { isSystem: true, tenantId: ORG } as const;

type Handler = (req: unknown, res: unknown) => unknown;
const routes = new Map<string, Handler>();

/** A capturing HTTP server: the door's registration is recorded, never served. */
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
        id: 'test.comment-reaction-unreact',
        namespace: 'rxd',
        version: '1.0.0',
        type: 'plugin',
        name: 'Unreact door fixture',
        objects: [SysUser, SysMember, SysOrganization, parent(OPEN, 'Board'), parent(SECRET, 'Vault')],
      });
    },
  };
}

interface Answer {
  status: number;
  body: any;
}

/** Call the mounted door as `signedInAs` (or nobody) for reaction `id`. */
async function unreact(id: string, signedInAs?: string, query: Record<string, string> = {}): Promise<Answer> {
  const handler = routes.get(`DELETE ${ROUTE}`);
  if (!handler) throw new Error(`no DELETE ${ROUTE} is mounted on the kernel's HTTP server`);
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
      method: 'DELETE',
      path: ROUTE.replace(':id', id),
      params: { id },
      query,
      headers: signedInAs ? { [SIGNED_IN_AS]: signedInAs } : {},
    },
    res,
  );
  return answer;
}

describe('the unreact door — a member with no position removes their own reaction, and only theirs', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let openComment: string;
  let secretComment: string;

  const rowById = async (id: string) => ql.findOne(REACTION, { where: { id }, context: SYS });
  /**
   * A reaction row reacted as `userId`, `created_by` stamped by the engine as
   * theirs. Written under a system context so a reaction on the secret comment
   * can exist at all; `user_id` is then the writer's to supply, as the create
   * gate stamps it only on a member's own create.
   */
  const reactAs = async (userId: string, commentId: string, emoji: string): Promise<string> => {
    const row = await ql.insert(
      REACTION,
      { comment_id: commentId, emoji, user_id: userId },
      { context: { ...SYS, userId } },
    );
    const stored = await rowById(String(row.id));
    expect(stored?.created_by, 'the engine stamps the reactor').toBe(userId);
    return String(row.id);
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
        // The every-member baseline: the app's set composed with `member_default`.
        fallbackPermissionSet: APP_EVERYONE_SET.name,
      }),
    );
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');

    await ql.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme' }, { context: SYS });
    for (const userId of [ALICE, BOB]) {
      await ql.insert(
        'sys_user',
        { id: userId, name: userId, email: `${userId}@acme.test`, email_verified: true },
        { context: SYS },
      );
      // A plain member: the organization's `member` role, no position.
      await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role: 'member' }, { context: SYS });
    }

    const board = await ql.insert(OPEN, { name: 'board' }, { context: SYS });
    const vault = await ql.insert(SECRET, { name: 'vault' }, { context: SYS });
    openComment = String(
      (await ql.insert(COMMENT, { thread_id: `${OPEN}:${board.id}`, author_id: BOB, body: 'open' }, { context: SYS })).id,
    );
    secretComment = String(
      (await ql.insert(COMMENT, { thread_id: `${SECRET}:${vault.id}`, author_id: BOB, body: 'secret' }, { context: SYS }))
        .id,
    );
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('the member reads the open comment and not the secret one (the fixture is armed)', async () => {
    const asAlice = { userId: ALICE, tenantId: ORG, positions: ['org_member', 'everyone'], permissions: [] };
    const readable = (await ql.find(COMMENT, { context: asAlice })).map((r) => String(r.id));
    expect(readable).toContain(openComment);
    expect(readable).not.toContain(secretComment);
  });

  it('own row: the door removes it — 200, and the row is gone', async () => {
    const id = await reactAs(ALICE, openComment, '👍');
    const answer = await unreact(id, ALICE);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body).toEqual({ success: true, data: { id, deleted: true } });
    expect(await rowById(id)).toBeNull();
  });

  it('foreign row: refused loudly — 403 PERMISSION_DENIED, and the row stays', async () => {
    const id = await reactAs(BOB, openComment, '🎉');
    const answer = await unreact(id, ALICE);
    expect(answer.status).toBe(403);
    expect(answer.body?.error?.code).toBe('PERMISSION_DENIED');
    expect((await rowById(id))?.id).toBe(id);
  });

  it('a reaction on a comment the caller cannot read: 404 RECORD_NOT_FOUND, the unknown-id answer, and the row stays', async () => {
    // The caller's OWN reaction, so the refusal is about readability alone.
    const id = await reactAs(ALICE, secretComment, '👀');
    const hidden = await unreact(id, ALICE);
    const unknown = await unreact('rxd_no_such_reaction', ALICE);
    expect(hidden.status).toBe(404);
    expect(hidden.body?.error?.code).toBe('RECORD_NOT_FOUND');
    // No existence leak: the same status and code as an id that names no row.
    expect({ status: unknown.status, code: unknown.body?.error?.code }).toEqual({
      status: hidden.status,
      code: hidden.body?.error?.code,
    });
    expect((await rowById(id))?.id).toBe(id);
  });

  it('an unknown id: 404 RECORD_NOT_FOUND', async () => {
    const answer = await unreact('rxd_no_such_reaction', BOB);
    expect(answer.status).toBe(404);
    expect(answer.body?.error?.code).toBe('RECORD_NOT_FOUND');
  });

  it('anonymous: 401 UNAUTHENTICATED, and nothing is removed', async () => {
    const id = await reactAs(BOB, openComment, '🚀');
    const answer = await unreact(id);
    expect(answer.status).toBe(401);
    expect(answer.body?.error?.code).toBe('UNAUTHENTICATED');
    expect((await rowById(id))?.id).toBe(id);
  });

  it('a query parameter is refused, not ignored: 400 VALIDATION_ERROR, and nothing is removed', async () => {
    const id = await reactAs(ALICE, openComment, '✅');
    const answer = await unreact(id, ALICE, { force: 'true' });
    expect(answer.status).toBe(400);
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect((await rowById(id))?.id).toBe(id);
  });

  it('the grant model does not move: the generic data-door delete of the own row still answers 403', async () => {
    const id = await reactAs(ALICE, openComment, '❤️');
    // The data door's own path: the engine delete under the caller's context,
    // mapped to the wire by `mapDataError`, as `DELETE /api/v1/data/:object/:id` does.
    const asAlice = { userId: ALICE, tenantId: ORG, positions: ['org_member', 'everyone'], permissions: [] };
    let thrown: unknown;
    try {
      await ql.delete(REACTION, { where: { id }, context: asAlice });
    } catch (e) {
      thrown = e;
    }
    expect(thrown, 'the generic delete went through').toBeDefined();
    const wire = mapDataError(thrown, REACTION);
    expect(wire.status).toBe(403);
    expect(wire.body.code).toBe('PERMISSION_DENIED');
    expect((await rowById(id))?.id).toBe(id);
  });
});
