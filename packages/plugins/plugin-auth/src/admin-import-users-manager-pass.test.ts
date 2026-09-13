// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/auth/admin/import-users` — ruling row 7 (#18028): `manager_id`
 * admitted to the import tier, resolved in a SECOND pass keyed on the
 * importer's identity key, every row-2 refusal applied per row, and an
 * unresolved key reported as a per-row error.
 *
 * Four things this suite is built to prove, and three of them are built so a
 * lesser implementation FAILS them rather than merely not being tested:
 *
 *  1. **The pass is genuinely second.** A pin that only checks "a manager got
 *     resolved" passes against a single-pass resolve that happens to work
 *     because the fixture was written in dependency order. So the fixture here
 *     is deliberately out of order — a row whose manager is created by a LATER
 *     row — and the discrimination is asserted twice over: the harness records
 *     what `sys_user` held at the moment each row was written (the manager was
 *     NOT there), and the link's `update` is asserted to land after the last
 *     `createUser`. A single-pass implementation cannot produce either.
 *  2. **A per-row error is per-row.** Both directions, because a test that
 *     asserts only the first passes against an implementation that aborts the
 *     whole import: the offending row reports, AND every other row still lands.
 *  3. **The five refusals are the shared derivation's, not a copy.** Four of
 *     them are driven through the importer and asserted to surface with the
 *     endpoint's own `reason` discriminator, and the file is read to assert it
 *     spells none of those predicates itself — with a positive control, so a
 *     rename cannot turn the absence into a vacuous pass.
 *  4. **Tier 1 did not move.** `manager_id` is reached by system context, so
 *     `SYS_USER_PROFILE_EDIT_FIELDS` and `SYS_USER_IMPORT_UPDATE_FIELDS` are
 *     asserted UNCHANGED here as part of the fix, exactly as #16678's own
 *     delivery pinned them.
 *
 * The engine double pins `update` to the real dispatch contract
 * (`assertEngineUpdateDispatch`) and its WHERE matcher REFUSES combinators by
 * throwing rather than answering them wrongly — the cheap correct answer for a
 * double that only ever sees scalar equality.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { runAdminImportUsers, type IdentityImportDeps } from './admin-import-users.js';
import { SYS_USER_PROFILE_EDIT_FIELDS, SYS_USER_IMPORT_UPDATE_FIELDS } from './sys-user-writable-fields.js';
import type { AdminActor } from './admin-user-endpoints.js';

const ACTOR: AdminActor = { id: 'usr_admin', email: 'admin@example.com' };

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPORT_USERS_SOURCE = readFileSync(resolve(HERE, 'admin-import-users.ts'), 'utf8');

type Row = Record<string, any>;

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/admin/import-users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Equality on a field name — every predicate this endpoint and its delegate
 * issue — and a LOUD refusal of everything else. A double that reads `$or` as
 * a field name answers a question nobody asked, silently, and keeps the suite
 * green while the real engine returns something else entirely.
 *
 * Lifted to module scope rather than closed over the fixtures on purpose: a
 * matcher that closes over its own rows is unjudgeable by
 * `check:where-matcher`, which is a worse answer than a wrong one.
 */
function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key.startsWith('$') || key === 'and' || key === 'or' || key === 'not') {
      throw new Error(`engineDouble: unsupported WHERE combinator '${key}' — implement it or stop issuing it`);
    }
    if (value !== null && typeof value === 'object') {
      throw new Error(`engineDouble: unsupported operator object on '${key}' — implement it or stop issuing it`);
    }
    if (String(row[key] ?? '') !== String(value ?? '')) return false;
  }
  return true;
}

function makeHarness(opts: {
  seedUsers?: Row[];
  seedMembers?: Row[];
  phoneEnabled?: boolean;
  emailAvailable?: boolean;
  smsInviteAvailable?: boolean;
  resetFails?: boolean;
  /** Make every `sys_user` READ throw, to drive the failed-lookup branch. */
  failUserReads?: boolean;
} = {}) {
  const tables: Record<string, Row[]> = {
    sys_user: (opts.seedUsers ?? []).map((u) => ({ manager_id: null, source: 'env_native', ...u })),
    sys_member: [...(opts.seedMembers ?? [])],
    sys_audit_log: [],
  };

  /**
   * What `sys_user` held at the instant each row was written. This is the
   * discrimination for the forward reference: if the manager's email is not in
   * the snapshot taken when its report was created, then no single-pass
   * implementation could have resolved that row.
   */
  const snapshotsAtCreate: string[][] = [];

  let nextId = 1;
  let readsFail = opts.failUserReads === true;
  const createUser = vi.fn(async ({ body }: any) => {
    snapshotsAtCreate.push(tables.sys_user.map((u) => String(u.email ?? '')));
    const id = `u-${nextId++}`;
    tables.sys_user.push({
      id,
      email: body.email,
      name: body.name,
      phone_number: body?.data?.phoneNumber ?? null,
      manager_id: null,
      source: 'env_native',
    });
    return { user: { id, email: body.email, name: body.name } };
  });
  const requestPasswordReset = vi.fn(async () => {
    if (opts.resetFails) throw new Error('smtp down');
    return { status: true };
  });

  const find = vi.fn(async (object: string, query?: any) => {
    if (readsFail && object === 'sys_user') throw new Error(`read of ${object} failed`);
    const q = query ?? {};
    const rows = tables[object] ?? [];
    const out = rows.filter((r) => matchesWhere(r, q.where ?? {}));
    return typeof q.limit === 'number' ? out.slice(0, q.limit) : out;
  });
  const update = vi.fn(async (object: string, data: any, options?: any) => {
    // The real engine's three-way dispatch — a double looser than this is no
    // double at all.
    assertEngineUpdateDispatch(data, options);
    const row = (tables[object] ?? []).find((r) => r.id === data.id);
    if (row) Object.assign(row, data);
    return row ?? null;
  });
  const insert = vi.fn(async (object: string, data: any) => {
    (tables[object] ??= []).push({ ...data });
    return {};
  });

  const warn = vi.fn();
  const sendInviteSms = vi.fn(async () => {});
  const noteMustChangePasswordIssued = vi.fn();

  const deps: IdentityImportDeps = {
    getAuthApi: async () => ({ createUser, requestPasswordReset }),
    getDataEngine: () => ({ find, update, insert }),
    phoneNumberEnabled: () => opts.phoneEnabled ?? false,
    emailServiceAvailable: () => opts.emailAvailable ?? true,
    smsInviteAvailable: () => opts.smsInviteAvailable ?? false,
    sendInviteSms,
    noteMustChangePasswordIssued,
    logger: { warn },
  };

  return {
    deps, tables, snapshotsAtCreate,
    createUser, requestPasswordReset, find, update, insert, warn,
    failUserReadsFrom: () => { readsFail = true; },
    userBy: (email: string) => tables.sys_user.find((u) => u.email === email),
  };
}

/** The `data` half of a 200, typed loosely on purpose — it is a wire payload. */
function payload(res: { body: { data?: unknown } }): any {
  return res.body.data as any;
}

/** The index of the `update` call that wrote a manager link, or -1. */
function managerWriteIndex(update: ReturnType<typeof vi.fn>): number {
  return update.mock.calls.findIndex(
    ([object, data]: any[]) => object === 'sys_user' && data && Object.hasOwn(data, 'manager_id'),
  );
}

describe('import-users manager pass — the SECOND pass is genuinely second (#18028)', () => {
  const forwardReference = {
    passwordPolicy: 'none',
    format: 'json',
    rows: [
      // Row 1 names a manager that row 2 creates. A single-pass resolve
      // refuses this; the ruling's second pass is what admits it.
      { email: 'report@x.co', name: 'Report', manager_id: 'boss@x.co' },
      { email: 'boss@x.co', name: 'Boss' },
    ],
  };

  it('links a row to a manager CREATED BY A LATER ROW', async () => {
    const h = makeHarness();
    const res = await runAdminImportUsers(h.deps, makeRequest(forwardReference), ACTOR);

    expect(res.status).toBe(200);
    const data = payload(res);
    expect(data.summary.created).toBe(2);
    expect(data.summary.errors).toBe(0);
    expect(data.summary.manager).toEqual({ linked: 1, unresolved: 0, refused: 0 });
    expect(data.rows[0].manager).toBe('linked');
    expect(data.rows[0].code).toBeUndefined();
    // The link is on the row, pointing at the id the LATER row minted.
    expect(h.userBy('report@x.co')?.manager_id).toBe(h.userBy('boss@x.co')?.id);
  });

  it('CONTROL — the manager did not exist when its report was written', async () => {
    // Without this the test above is explainable by a fixture that happened to
    // be in dependency order. It was not: at the instant row 1 was created,
    // `sys_user` did not contain the manager at all.
    const h = makeHarness();
    await runAdminImportUsers(h.deps, makeRequest(forwardReference), ACTOR);

    expect(h.snapshotsAtCreate).toHaveLength(2);
    expect(h.snapshotsAtCreate[0]).not.toContain('boss@x.co');
    expect(h.snapshotsAtCreate[1]).toContain('report@x.co');
  });

  it('CONTROL — the link is written AFTER the last row was created', async () => {
    const h = makeHarness();
    await runAdminImportUsers(h.deps, makeRequest(forwardReference), ACTOR);

    const idx = managerWriteIndex(h.update);
    expect(idx).toBeGreaterThanOrEqual(0);
    const linkOrder = h.update.mock.invocationCallOrder[idx];
    const createOrders = h.createUser.mock.invocationCallOrder;
    expect(createOrders).toHaveLength(2);
    // Ordering a single-pass implementation structurally cannot produce: the
    // link postdates EVERY creation in the batch, not just its own row's.
    expect(linkOrder).toBeGreaterThan(createOrders[createOrders.length - 1]);
  });

  it('resolves a manager ALREADY IN THE TREE, not named by this file', async () => {
    const h = makeHarness({
      seedUsers: [{ id: 'u_boss', email: 'boss@x.co', name: 'Boss' }],
    });
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [{ email: 'new@x.co', name: 'New', manager_id: 'boss@x.co' }],
    }), ACTOR);

    expect(res.status).toBe(200);
    expect(payload(res).rows[0].manager).toBe('linked');
    expect(h.userBy('new@x.co')?.manager_id).toBe('u_boss');
  });

  it('keys on PHONE as well as email — the ruling names both', async () => {
    const h = makeHarness({ phoneEnabled: true });
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [
        { email: 'report@x.co', name: 'Report', manager_id: '+15550001111' },
        { phone_number: '+1 555 000 1111', name: 'Boss' },
      ],
    }), ACTOR);

    expect(res.status).toBe(200);
    const data = payload(res);
    expect(data.summary.manager).toEqual({ linked: 1, unresolved: 0, refused: 0 });
    // The phone-only row's email is a minted placeholder, so the ONLY key that
    // could have matched here is the phone one.
    const boss = h.tables.sys_user.find((u) => u.phone_number === '+15550001111');
    expect(boss).toBeTruthy();
    expect(h.userBy('report@x.co')?.manager_id).toBe(boss?.id);
  });
});

describe('import-users manager pass — an unresolved key is PER-ROW (#18028)', () => {
  it('reports the offending row AND lands every other row', async () => {
    const h = makeHarness();
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [
        { email: 'orphan@x.co', name: 'Orphan', manager_id: 'ghost@x.co' },
        { email: 'fine@x.co', name: 'Fine' },
      ],
    }), ACTOR);

    // Direction 1 — the row reports.
    expect(res.status).toBe(200);
    const data = payload(res);
    expect(data.rows[0].manager).toBe('unresolved');
    expect(String(data.rows[0].error)).toContain('manager_id');
    // ⛔ No row-level `code`: the obvious `MANAGER_UNRESOLVED` symmetry with
    // `INVITE_EMAIL_FAILED` needs a `packages/spec` error-code ledger entry
    // this lane is fenced out of, and `check:dispatcher-error-vocabulary`
    // refuses an unregistered one. Pinned so the symmetry cannot be restored
    // without the registration that makes it legal.
    expect(data.rows[0].code).toBeUndefined();

    // Direction 2 — and it is not a whole-import failure. Asserting only the
    // first would pass against an implementation that aborts everything.
    expect(h.createUser).toHaveBeenCalledTimes(2);
    expect(data.summary.created).toBe(2);
    expect(data.summary.errors).toBe(0);
    expect(data.rows[1].code).toBeUndefined();
    expect(data.rows[1].manager).toBeUndefined();
    expect(data.summary.manager).toEqual({ linked: 0, unresolved: 1, refused: 0 });

    // ⛔ Not a silent skip either: the identity landed, unlinked.
    expect(h.userBy('orphan@x.co')).toBeTruthy();
    expect(h.userBy('orphan@x.co')?.manager_id ?? null).toBeNull();
  });

  it('a cell that is neither an email nor a phone is unresolved, not ignored', async () => {
    const h = makeHarness();
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [{ email: 'a@x.co', name: 'A', manager_id: 'Jane Doe' }],
    }), ACTOR);

    const data = payload(res);
    expect(data.rows[0].manager).toBe('unresolved');
    expect(String(data.rows[0].error)).toContain('phone number');
    expect(data.rows[0].code).toBeUndefined();
    expect(data.summary.manager.unresolved).toBe(1);
  });

  it('an EMPTY manager cell is not a finding', async () => {
    const h = makeHarness();
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [{ email: 'a@x.co', name: 'A', manager_id: '   ' }],
    }), ACTOR);

    const data = payload(res);
    expect(data.rows[0].manager).toBeUndefined();
    expect(data.rows[0].code).toBeUndefined();
    expect(data.summary.manager).toEqual({ linked: 0, unresolved: 0, refused: 0 });
  });

  it('a manager failure does not overwrite a delivery failure, or vice versa', async () => {
    // Both post-write phases have something to report about the SAME row. The
    // shared `code`/`error` slot belongs to whoever claimed it first; the
    // manager verdict is still readable on its own field, so neither failure
    // is lost into silence.
    const h = makeHarness({ resetFails: true });
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'invite', format: 'json',
      rows: [{ email: 'a@x.co', name: 'A', manager_id: 'ghost@x.co' }],
    }), ACTOR);

    const data = payload(res);
    expect(data.rows[0].code).toBe('INVITE_EMAIL_FAILED');
    expect(String(data.rows[0].error)).toContain('invitation email failed');
    // The delivery report keeps the shared `error` slot; the manager verdict is
    // still readable on its own field, so neither failure is lost to silence.
    expect(data.rows[0].manager).toBe('unresolved');
    expect(data.summary.manager.unresolved).toBe(1);
  });

  it('an engine fault DURING the link stays a per-row error, not a 500', async () => {
    // By this point every identity in the batch is written. A fault here must
    // not turn a 200 that created N users into a 500 that reports none of them.
    const h = makeHarness({ seedUsers: [{ id: 'u_boss', email: 'boss@x.co', name: 'Boss' }] });
    h.update.mockImplementation(async () => { throw new Error('driver offline'); });

    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [{ email: 'a@x.co', name: 'A', manager_id: 'boss@x.co' }],
    }), ACTOR);

    expect(res.status).toBe(200);
    const data = payload(res);
    expect(data.summary.created).toBe(1);
    expect(data.rows[0].manager).toBe('unresolved');
    expect(String(data.rows[0].error)).toContain('driver offline');
  });

  it('a FAILED sys_user lookup is reported as unresolved AND said out loud', async () => {
    // "the read did not happen" and "no such user" are different facts. The
    // link genuinely was not written either way, so the row reads the same —
    // but the reason is stated once rather than degrading in silence.
    const h = makeHarness();
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [{ email: 'a@x.co', name: 'A', manager_id: 'boss@x.co' }],
    }), ACTOR);
    void res;

    const h2 = makeHarness();
    // Fail reads only once the identity writes are done, so the row still lands.
    h2.createUser.mockImplementationOnce(async ({ body }: any) => {
      const created = { user: { id: 'u-1', email: body.email, name: body.name } };
      h2.tables.sys_user.push({ id: 'u-1', email: body.email, name: body.name, manager_id: null, source: 'env_native' });
      h2.failUserReadsFrom();
      return created;
    });
    const res2 = await runAdminImportUsers(h2.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [{ email: 'a@x.co', name: 'A', manager_id: 'boss@x.co' }],
    }), ACTOR);

    const data = payload(res2);
    expect(data.rows[0].manager).toBe('unresolved');
    expect(h2.warn.mock.calls.some(([m]: any[]) => String(m).includes('FAILED'))).toBe(true);
    expect(h2.warn.mock.calls.some(([m]: any[]) => String(m).includes('Remedy'))).toBe(true);
  });
});

describe('import-users manager pass — the refusals are the DELEGATE\'s (#18028)', () => {
  it('self-assignment — a row naming itself surfaces the endpoint\'s reason', async () => {
    const h = makeHarness();
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [{ email: 'a@x.co', name: 'A', manager_id: 'a@x.co' }],
    }), ACTOR);

    const data = payload(res);
    expect(data.rows[0].manager).toBe('self_assignment');
    // The delegate's own message, carried through rather than re-worded.
    expect(String(data.rows[0].error)).toContain('cannot be their own manager');
    expect(data.rows[0].code).toBeUndefined();
    expect(data.summary.manager).toEqual({ linked: 0, unresolved: 0, refused: 1 });
    expect(h.userBy('a@x.co')?.manager_id ?? null).toBeNull();
  });

  it('cycle — refused against the links THIS PASS has already written', async () => {
    // Row 1's link is in place by the time row 2 is judged, so the loop is
    // caught inside one import rather than left for a later read to trip over.
    const h = makeHarness();
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [
        { email: 'a@x.co', name: 'A', manager_id: 'b@x.co' },
        { email: 'b@x.co', name: 'B', manager_id: 'a@x.co' },
      ],
    }), ACTOR);

    const data = payload(res);
    expect(data.rows[0].manager).toBe('linked');
    expect(data.rows[1].manager).toBe('cycle');
    expect(String(data.rows[1].error)).toContain('loop');
    expect(data.summary.manager).toEqual({ linked: 1, unresolved: 0, refused: 1 });
    expect(h.userBy('b@x.co')?.manager_id ?? null).toBeNull();
  });

  it('directory-owned identity — an upsert row the IdP owns is refused', async () => {
    const h = makeHarness({
      seedUsers: [
        { id: 'u_sso', email: 'sso@x.co', name: 'SSO', source: 'idp_provisioned' },
        { id: 'u_boss', email: 'boss@x.co', name: 'Boss' },
      ],
    });
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', mode: 'upsert', matchBy: 'email', format: 'json',
      rows: [{ email: 'sso@x.co', name: 'SSO', manager_id: 'boss@x.co' }],
    }), ACTOR);

    const data = payload(res);
    expect(data.rows[0].action).toBe('updated');
    expect(data.rows[0].manager).toBe('idp_provisioned');
    expect(data.summary.manager.refused).toBe(1);
    expect(h.userBy('sso@x.co')?.manager_id ?? null).toBeNull();
  });

  it('cross-organization — the delegate\'s sys_member screen really runs', async () => {
    const h = makeHarness({
      seedUsers: [
        { id: 'u_report', email: 'report@x.co', name: 'Report' },
        { id: 'u_boss', email: 'boss@x.co', name: 'Boss' },
      ],
      seedMembers: [
        { user_id: 'u_report', organization_id: 'org_a' },
        { user_id: 'u_boss', organization_id: 'org_b' },
      ],
    });
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', mode: 'upsert', matchBy: 'email', format: 'json',
      rows: [{ email: 'report@x.co', name: 'Report', manager_id: 'boss@x.co' }],
    }), ACTOR);

    const data = payload(res);
    expect(data.rows[0].manager).toBe('cross_organization');
    expect(data.summary.manager.refused).toBe(1);
    // The screen is only reachable through the delegate — nothing in the
    // importer reads sys_member.
    expect(h.find.mock.calls.some(([object]: any[]) => object === 'sys_member')).toBe(true);
  });

  it('⛔ the importer carries NO second copy of the five predicates', () => {
    // POSITIVE CONTROL — the delegation is really in this file, so the
    // absences below are readings rather than a vacuous pass after a rename.
    expect(IMPORT_USERS_SOURCE).toContain('applyUserManagerLink');
    expect(IMPORT_USERS_SOURCE).toContain('admin-set-user-manager.js');

    // Each refusal reason is the delegate's to name. A fork would spell them.
    for (const reason of [
      'self_assignment', 'cycle', 'max_depth_exceeded', 'cross_organization', 'idp_provisioned',
    ]) {
      expect(IMPORT_USERS_SOURCE).not.toContain(`'${reason}'`);
    }
    // And none of the predicates' own machinery.
    expect(IMPORT_USERS_SOURCE).not.toContain('MAX_MANAGER_CHAIN_DEPTH');
    expect(IMPORT_USERS_SOURCE).not.toContain('sys_member');
  });
});

describe('import-users manager pass — the fences (#18028)', () => {
  it('the manager cell never reaches the identity write path', async () => {
    const h = makeHarness();
    await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', format: 'json',
      rows: [
        { email: 'report@x.co', name: 'Report', manager_id: 'boss@x.co' },
        { email: 'boss@x.co', name: 'Boss' },
      ],
    }), ACTOR);

    // better-auth never sees it (it would be a lookup column handed an email).
    expect(JSON.stringify(h.createUser.mock.calls)).not.toContain('manager_id');
    // And the ONLY `manager_id` write is the delegate's, one per link.
    const managerWrites = h.update.mock.calls.filter(
      ([object, data]: any[]) => object === 'sys_user' && data && Object.hasOwn(data, 'manager_id'),
    );
    expect(managerWrites).toHaveLength(1);
  });

  it('an upsert patch still cannot carry manager_id', async () => {
    const h = makeHarness({ seedUsers: [{ id: 'u_a', email: 'a@x.co', name: 'A' }] });
    await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', mode: 'upsert', matchBy: 'email', format: 'json',
      rows: [{ email: 'a@x.co', name: 'A2', manager_id: 'Jane Doe' }],
    }), ACTOR);

    const patches = h.update.mock.calls.filter(([object]: any[]) => object === 'sys_user');
    for (const [, data] of patches) expect(Object.hasOwn(data, 'manager_id')).toBe(false);
  });

  it('⛔ Tier 1 did not move — the column is reached by system context', () => {
    // #16678's delivery pinned this ABSENCE; admitting the column to the
    // import tier must leave it exactly as pinned.
    expect([...SYS_USER_PROFILE_EDIT_FIELDS].sort()).toEqual(['image', 'locale', 'name']);
    expect([...SYS_USER_IMPORT_UPDATE_FIELDS].sort()).toEqual(
      ['image', 'locale', 'name', 'phone_number', 'role'],
    );
    expect(SYS_USER_IMPORT_UPDATE_FIELDS.has('manager_id')).toBe(false);
  });

  it('dryRun does not run the pass, and does not half-answer about it', async () => {
    const h = makeHarness();
    const res = await runAdminImportUsers(h.deps, makeRequest({
      passwordPolicy: 'none', dryRun: true, format: 'json',
      rows: [
        { email: 'report@x.co', name: 'Report', manager_id: 'boss@x.co' },
        { email: 'boss@x.co', name: 'Boss' },
      ],
    }), ACTOR);

    const data = payload(res);
    expect(data.summary.dryRun).toBe(true);
    expect(data.summary.manager).toEqual({ linked: 0, unresolved: 0, refused: 0 });
    expect(managerWriteIndex(h.update)).toBe(-1);
    expect(data.rows.every((r: Row) => r.manager === undefined)).toBe(true);
  });
});
