// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18682] A validation rule's related read stays inside the caller's
 * organization — so a reference naming ANOTHER organization's row tells the
 * caller nothing about that row.
 *
 * The related read runs under system authority, which skips this plugin's
 * Layer 0 wall. What keeps it in the caller's organization is that the engine
 * spreads the caller's context into it, `tenantId` included, and the driver
 * scopes the read by that. A bare `{ isSystem: true }` would read the other
 * organization's row, and the rule's verdict on it would reach the caller.
 *
 * Driven on the real `SqlDriver` under the `isolated` posture, through the
 * real middleware: a caller bound to org X writes a reference to org Y's row,
 * once with that row `secret` and once `public`. The two must end identically,
 * the read must return nothing, and the org X control must reach the rule.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SysUser } from '@objectstack/platform-objects/identity';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const RULE_MESSAGE = 'Inspections on a secret line are frozen.';

const OBJECTS = [
  {
    name: 'qa_line',
    label: 'Line',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      kind: { name: 'kind', type: 'text' },
    },
  },
  {
    name: 'qa_inspection',
    label: 'Inspection',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      line: { name: 'line', type: 'lookup', reference: 'qa_line' },
    },
    validations: [{
      name: 'no_secret_line', type: 'script', severity: 'error',
      message: RULE_MESSAGE, condition: "record.line.kind == 'secret'",
    }],
  },
  {
    // The same rule on an object the organization wall does not cover.
    name: 'qa_note',
    label: 'Note',
    sharingModel: 'public_read_write',
    tenancy: { enabled: false },
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      line: { name: 'line', type: 'lookup', reference: 'qa_line' },
    },
    validations: [{
      name: 'no_secret_line', type: 'script', severity: 'error',
      message: RULE_MESSAGE, condition: "record.line.kind == 'secret'",
    }],
  },
  SysUser,
  {
    // A rule reading through a `user` field into `sys_user`, which has no tenant column.
    name: 'qa_review',
    label: 'Review',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      reviewer: { name: 'reviewer', type: 'user' },
    },
    validations: [{
      name: 'no_banned_reviewer', type: 'script', severity: 'error',
      message: RULE_MESSAGE, condition: 'record.reviewer.banned == true',
    }],
  },
];

/** The shipped `sys_user` wall: `member_default`'s grant and row-level security. */
const SHIPPED_MEMBER = defaultPermissionSets.find((s) => s.name === 'member_default')!;

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: {
    qa_inspection: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_note: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_line: { allowRead: true },
    qa_review: { allowRead: true, allowCreate: true, allowEdit: true },
    sys_user: SHIPPED_MEMBER.objects.sys_user,
  },
  rowLevelSecurity: SHIPPED_MEMBER.rowLevelSecurity?.filter((p) => p.object === 'sys_user'),
} as unknown as PermissionSet;

/** The driver's own query builder, reached past its `protected` modifier. */
type Table = (name: string) => {
  insert(rows: Array<Record<string, unknown>>): Promise<unknown>;
  where(match: Record<string, unknown>): { select(...columns: string[]): Promise<unknown[]> };
};

/** Bound to org X. */
const CALLER = { userId: 'u_x', tenantId: 'org_x', positions: [], permissions: [], posture: 'MEMBER' };

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** `kind` is org Y's row's value; org X holds one `secret` line of its own. */
async function boot(kind: 'secret' | 'public', posture?: 'group' | 'isolated') {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.predicate-related-read-tenant-scope',
    name: 'Predicate related read tenant scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    'org-scoping': { name: 'org-scoping' },
    ...(posture ? { tenancy: { posture } } : {}),
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: { get: async (_t: string, name: string) => engine.getSchema(name) ?? null, list: async () => [MEMBER] },
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

  // Straight into the table, past every scope: the fixture is not the subject.
  const table = (driver as unknown as { knex: Table }).knex;
  await table('qa_line').insert([
    { id: 'line_x', kind: 'secret', organization_id: 'org_x' },
    { id: 'line_y', kind, organization_id: 'org_y' },
  ]);
  // The caller u_x and its peer u_x2 (org X); u_y belongs to org Y only.
  await table('sys_user').insert([
    { id: 'u_x', name: 'X', email: 'x@x.test', banned: false },
    { id: 'u_x2', name: 'X2', email: 'x2@x.test', banned: true },
    { id: 'u_y', name: 'Y', email: 'y@y.test', banned: kind === 'secret' },
  ]);

  // What the driver hands back for every read of the related object.
  const readsOfLine: unknown[][] = [];
  const userColumnsRead: unknown[] = [];
  const find = driver.find.bind(driver);
  vi.spyOn(driver, 'find').mockImplementation(async (object, ast, options) => {
    const rows = await find(object, ast, options);
    if (object === 'qa_line') readsOfLine.push(rows as unknown[]);
    if (object === 'sys_user') userColumnsRead.push(...((ast as { fields?: unknown[] }).fields ?? ['*']));
    return rows;
  });

  const stored = async (object: string, name: string) => (await table(object).where({ name }).select('id')).length;
  return { engine, readsOfLine, userColumnsRead, stored, table };
}

/** Everything the caller sees of one write and one preview naming `line`. */
async function observe(
  kind: 'secret' | 'public', line: string, caller: object = CALLER,
  posture?: 'group' | 'isolated', object = 'qa_inspection',
) {
  const h = await boot(kind, posture);
  const ref = object === 'qa_review' ? 'reviewer' : 'line';
  const refusal = await h.engine
    .insert(object, { name: 'probe', [ref]: line }, { context: caller } as never)
    .then(() => null, (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));
  const preview = await h.engine.validate(
    object, { name: 'probe', [ref]: line }, { mode: 'insert', context: caller } as never,
  );
  // Given a posture, the by-id UPDATE door too: a seeded row the caller may edit, repointed at `line`.
  let update: unknown;
  if (posture) {
    await h.table(object).insert([{ id: 'row_x', name: 'seed', ...(object !== 'qa_note' ? { organization_id: 'org_x' } : {}) }]);
    update = await h.engine
      .update(object, { [ref]: line }, { where: { id: 'row_x' }, context: caller } as never)
      .then(() => 'committed', (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));
  }
  return {
    seen: {
      refusal,
      committed: await h.stored(object, 'probe'),
      preview: { valid: preview.results?.[0]?.valid, errors: preview.results?.[0]?.errors?.map((e) => e.message) },
      update,
    },
    readsOfLine: h.readsOfLine,
    userColumnsRead: h.userColumnsRead,
  };
}

describe('#18682 — the related read stays inside the caller’s organization', () => {
  it('a reference to org Y’s row ends identically whether that row is secret or public', async () => {
    const secret = await observe('secret', 'line_y');
    const open = await observe('public', 'line_y');

    expect(open.seen).toEqual(secret.seen);
    expect(secret.seen.refusal?.code).toBe('VALIDATION_FAILED');
    expect(secret.seen.committed).toBe(0);
    // The read happened, once per door, and found nothing in org X.
    expect(secret.readsOfLine).toEqual([[], []]);
    expect(open.readsOfLine).toEqual([[], []]);
  });

  it('CONTROL: org X’s own secret line reaches the rule on both doors', async () => {
    const own = await observe('public', 'line_x');

    expect(own.seen.refusal).toEqual({ code: 'VALIDATION_FAILED', message: RULE_MESSAGE });
    expect(own.seen.committed).toBe(0);
    expect(own.seen.preview).toEqual({ valid: false, errors: [RULE_MESSAGE] });
    expect(own.readsOfLine.map((rows) => rows.length)).toEqual([1, 1]);
  });
});

/**
 * Under `group` a member's reach is their membership set, so a member with no
 * ACTIVE organization is admitted to the preview, yet carries no `tenantId`
 * to scope the related read by. Such a caller gets no related read at all.
 */
describe('#18682 — under `group`, a member with no active organization reads nothing related', () => {
  const ORGLESS_MEMBER = { userId: 'u_x', accessible_org_ids: ['org_x'], positions: [], permissions: [], posture: 'MEMBER' };

  it('a reference to org Y’s row ends identically whether that row is secret or public', async () => {
    const secret = await observe('secret', 'line_y', ORGLESS_MEMBER, 'group');
    const open = await observe('public', 'line_y', ORGLESS_MEMBER, 'group');

    expect(open.seen).toEqual(secret.seen);
    expect(secret.seen.committed).toBe(0);
    expect(secret.seen.preview.valid).toBe(false);
    expect(secret.seen.update).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(secret.readsOfLine).toEqual([]);
    expect(open.readsOfLine).toEqual([]);
  });

  it('CONTROL: WITH an active organization, org X’s own secret line reaches the rule on every door', async () => {
    const own = await observe('public', 'line_x', { ...ORGLESS_MEMBER, tenantId: 'org_x' }, 'group');

    expect(own.seen.refusal).toEqual({ code: 'VALIDATION_FAILED', message: RULE_MESSAGE });
    expect(own.seen.preview).toEqual({ valid: false, errors: [RULE_MESSAGE] });
    expect(own.seen.update).toEqual({ code: 'VALIDATION_FAILED', message: RULE_MESSAGE });
    expect(own.readsOfLine.map((rows) => rows.length)).toEqual([1, 1, 1]);
  });
});

/**
 * Under `isolated` the organization wall refuses an org-less writer only on an
 * object it covers. On an object declared `tenancy: { enabled: false }` the
 * write is admitted, and its rule's related read has no `tenantId` to scope by:
 * such a caller gets no related read at all.
 */
describe('#18682 — under `isolated`, an org-less writer of an unwalled object reads nothing related', () => {
  const ORGLESS_USER = { userId: 'u_x', positions: [], permissions: [], posture: 'MEMBER' };

  it('a reference to org Y’s row ends identically whether that row is secret or public', async () => {
    const secret = await observe('secret', 'line_y', ORGLESS_USER, 'isolated', 'qa_note');
    const open = await observe('public', 'line_y', ORGLESS_USER, 'isolated', 'qa_note');

    expect(open.seen).toEqual(secret.seen);
    expect(secret.seen.refusal?.code).toBe('VALIDATION_FAILED');
    expect(secret.seen.committed).toBe(0);
    expect(secret.seen.preview.valid).toBe(false);
    expect(secret.seen.update).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(secret.readsOfLine).toEqual([]);
    expect(open.readsOfLine).toEqual([]);
  });

  it('CONTROL: WITH an active organization, org X’s own secret line reaches the rule on every door', async () => {
    const own = await observe('public', 'line_x', { ...ORGLESS_USER, tenantId: 'org_x' }, 'isolated', 'qa_note');

    expect(own.seen.refusal).toEqual({ code: 'VALIDATION_FAILED', message: RULE_MESSAGE });
    expect(own.seen.preview).toEqual({ valid: false, errors: [RULE_MESSAGE] });
    expect(own.seen.update).toEqual({ code: 'VALIDATION_FAILED', message: RULE_MESSAGE });
    expect(own.readsOfLine.map((rows) => rows.length)).toEqual([1, 1, 1]);
  });
});

/**
 * `sys_user` has no tenant column, so no organization wall scopes the related
 * read; its own wall is the shipped `member_default` row-level security. A user
 * the caller's own read of `sys_user` does not return is NOT READABLE: the rule
 * faults loudly, is never evaluated on that user, and never reads its columns.
 */
describe('#18682 — a related user the caller cannot read makes the rule fault loudly', () => {
  const PEERS = { ...CALLER, org_user_ids: ['u_x', 'u_x2'] };
  const NOT_READABLE = "could not read 'sys_user'";

  it('CONTROL: the caller’s own read of sys_user returns org X’s users, never org Y’s', async () => {
    const h = await boot('secret', 'isolated');
    const own = await h.engine.find('sys_user', { where: { id: { $in: ['u_x2', 'u_y'] } }, context: PEERS } as never);

    expect((own as Array<{ id: string }>).map((row) => row.id)).toEqual(['u_x2']);
  });

  it('a user only org Y holds: every door refuses identically, whatever that user’s value', async () => {
    const banned = await observe('secret', 'u_y', PEERS, 'isolated', 'qa_review');
    const clear = await observe('public', 'u_y', PEERS, 'isolated', 'qa_review');

    expect(clear.seen).toEqual(banned.seen);
    for (const door of [banned.seen.refusal, banned.seen.update]) {
      expect(door).toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining(NOT_READABLE) });
    }
    expect(banned.seen.committed).toBe(0);
    expect(banned.seen.preview).toEqual({ valid: false, errors: [expect.stringContaining(NOT_READABLE)] });
    expect(banned.userColumnsRead).not.toContain('banned');
  });

  it('CONTROL: a user in org X — the rule evaluates on every door, in both directions', async () => {
    const peer = await observe('public', 'u_x2', PEERS, 'isolated', 'qa_review');
    const self = await observe('public', 'u_x', PEERS, 'isolated', 'qa_review');

    expect(peer.seen.refusal).toEqual({ code: 'VALIDATION_FAILED', message: RULE_MESSAGE });
    expect(peer.seen.preview).toEqual({ valid: false, errors: [RULE_MESSAGE] });
    expect(peer.seen.update).toEqual({ code: 'VALIDATION_FAILED', message: RULE_MESSAGE });
    expect(peer.userColumnsRead).toContain('banned');
    expect(self.seen).toEqual({
      refusal: null, committed: 1, preview: { valid: true, errors: [] }, update: 'committed',
    });
  });
});
