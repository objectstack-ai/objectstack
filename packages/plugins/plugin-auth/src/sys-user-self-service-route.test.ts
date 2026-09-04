// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ROUTE contract for a member editing their own `sys_user` row — maintainer
 * ruling 2026-09-03, decision batch #22, adopted 「同意」 (quoted verbatim and
 * untranslated), which also AMENDED ADR-0092 D5.
 *
 * ## Why this file exists, and why it is not the sibling `sys-user-locale-write-contract`
 *
 * That file pins WHICH COLUMNS may be written. This one pins WHO may write them
 * and TO WHICH ROW — the half D5 originally answered "nobody but a platform
 * admin", and the half the amendment moved. The two are independent by
 * construction (ADR-0092 D5), so neither file can stand in for the other:
 * before this change the column was open and the route was shut, and every
 * column-level pin was green the whole time.
 *
 * ## The failure mode this file is shaped against: a pin that passes at the
 * ## wrong layer
 *
 * Three layers can refuse a member's `PATCH /api/v1/data/sys_user/<id>`, in this
 * order:
 *
 *   1. the CRUD **object gate** — `member_default.objects.sys_user.allowEdit`;
 *   2. the **row scope** — the by-id write pre-image check, which re-reads the
 *      target row through the caller's compiled write-RLS filter and denies when
 *      it comes back empty (`sys_user_self`);
 *   3. the ADR-0092 D2 **identity write guard** — an engine `beforeUpdate` hook
 *      that strips non-whitelisted columns and throws when nothing editable
 *      survives.
 *
 * A refusal assertion that does not say WHICH layer produced it proves almost
 * nothing here, because layer 1 shadows the other two: before this change every
 * one of these four cases was refused by the object gate, so "a member cannot
 * edit someone else's row" and "a non-whitelisted column is refused by the
 * guard" were both green while neither mechanism had run. That is the exact
 * shape of the gap the card measured.
 *
 * So {@link route} returns the LAYER, established mechanically rather than
 * inferred:
 *
 *   - the middleware throws and `ql.findOne` was never called ⇒ `object-gate`
 *     (the pre-image re-read is the first thing past the CRUD check, so its
 *     absence dates the refusal);
 *   - the middleware throws and `ql.findOne` WAS called ⇒ `row-scope`;
 *   - the middleware passes and the guard hook throws ⇒ `identity-guard`.
 *
 * All four verdicts (`allowed` + the three layers) are produced by the cases
 * below, which is this file's own non-vacuity control: a `route` that could only
 * ever answer one of them would fail somewhere here.
 *
 * ## What is real and what is a fake
 *
 * Real: the shipped permission sets (`securityDefaultPermissionSets`), the real
 * `SecurityPlugin` CRUD middleware, the real RLS compiler behind it, the real
 * `SysUser` schema, the real identity write guard and its D6 companion hook.
 * Faked: the storage engine (`findOne` answers out of a two-row fixture, by
 * EVALUATING the filter the middleware actually composed) and better-auth's
 * secondary storage. Nothing that decides authorization is faked.
 */

import { describe, it, expect, vi } from 'vitest';
import { SysUser } from '@objectstack/platform-objects/identity';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import {
  registerIdentityWriteGuard,
  registerManagedUpdateWhitelist,
  type SecondaryStorageLike,
} from './identity-write-guard.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';

// ── Fixture principals and rows ─────────────────────────────────────────────

const ME = 'usr_me';
const PEER = 'usr_peer';

/** A rank-and-file member: the `org_member` position, no app profile at all. */
const MEMBER_CTX = {
  userId: ME,
  tenantId: 'org_1',
  positions: ['org_member'],
  permissions: [] as string[],
  org_user_ids: [ME, PEER],
};

/** The two rows the fake storage holds. Same organization — colleagues. */
const ROWS: Record<string, Record<string, unknown>> = {
  [ME]: { id: ME, name: 'Me', email: 'me@example.com', locale: 'en-US', role: 'user' },
  [PEER]: { id: PEER, name: 'Peer', email: 'peer@example.com', locale: 'en-US', role: 'user' },
};

// ── Filter evaluation ───────────────────────────────────────────────────────

/**
 * Evaluate the `where` the middleware composed against a fixture row.
 *
 * Deliberately minimal, and it does NOT need to be general: the composed filter
 * is itself asserted verbatim by the first test below, so this evaluator only
 * has to be right about the shapes that appear there. It throws on anything
 * else rather than guessing — a filter shape it does not understand must not
 * silently read as "row visible".
 */
function matchesFilter(row: Record<string, unknown>, filter: unknown): boolean {
  if (filter == null) return true;
  if (typeof filter !== 'object') throw new Error(`unhandled filter: ${String(filter)}`);
  const f = filter as Record<string, unknown>;
  return Object.entries(f).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((sub) => matchesFilter(row, sub));
    if (key === '$or') return (value as unknown[]).some((sub) => matchesFilter(row, sub));
    if (value && typeof value === 'object') {
      const op = value as Record<string, unknown>;
      if (Array.isArray(op.$in)) return (op.$in as unknown[]).includes(row[key]);
      throw new Error(`unhandled operator on '${key}': ${JSON.stringify(value)}`);
    }
    return row[key] === value;
  });
}

// ── The route harness ───────────────────────────────────────────────────────

type Layer = 'object-gate' | 'row-scope' | 'identity-guard';

interface RouteResult {
  /** `null` when the write was admitted end to end. */
  refusedBy: Layer | null;
  error: any;
  /** The payload as it stands after every layer ran (the guard strips in place). */
  data: Record<string, unknown>;
  /** Every `where` the pre-image re-read was called with, in order. */
  preImageWheres: unknown[];
  /** The secondary-storage writes the ADR-0092 D6 companion hook performed. */
  snapshotWrites: Array<{ key: string; value: any }>;
}

/**
 * Drive one `PATCH sys_user/<targetId>` through the real middleware and then the
 * real identity write guard, reporting which layer (if any) refused.
 */
async function route(
  targetId: string,
  patch: Record<string, unknown>,
  opts: {
    context?: Record<string, unknown>;
    operation?: 'update' | 'insert' | 'delete';
    /** Seed better-auth's session cache so the D6 refresh has something to rewrite. */
    cachedSessionToken?: string;
  } = {},
): Promise<RouteResult> {
  const context = opts.context ?? MEMBER_CTX;
  const operation = opts.operation ?? 'update';

  // ── Layer 1 + 2: the real SecurityPlugin CRUD middleware ──────────────────
  let middleware: any;
  const preImageWheres: unknown[] = [];
  const findOne = vi.fn(async (_object: string, query: any) => {
    preImageWheres.push(query?.where);
    const row = ROWS[targetId];
    if (!row) return null;
    // The pre-image gate denies on `null`. Answering it by EVALUATING the
    // filter the middleware built is what makes the row-scope layer a
    // measurement rather than a stub: a filter that stopped naming the caller
    // would let the peer row through here and redden the pin below.
    return matchesFilter(row, query?.where) ? { ...row } : null;
  });
  const ql = {
    registerMiddleware: (mw: any) => {
      if (!middleware) middleware = mw;
    },
    getSchema: () => SysUser as any,
    findOne,
  };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => SysUser as any, list: () => securityDefaultPermissionSets },
    'org-scoping': { name: 'org-scoping' },
  };
  const pluginCtx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`no service: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin();
  await plugin.init(pluginCtx);
  await plugin.start(pluginCtx);

  const data: Record<string, unknown> = { id: targetId, ...patch };
  const opCtx: any = {
    object: 'sys_user',
    operation,
    data,
    options: operation === 'insert' ? undefined : { where: { id: targetId } },
    context,
  };

  const snapshotWrites: Array<{ key: string; value: any }> = [];
  try {
    await middleware(opCtx, async () => {});
  } catch (error: any) {
    return {
      // The pre-image re-read is the first engine call past the CRUD gate, so
      // "was it called" dates the refusal without reading the message.
      refusedBy: findOne.mock.calls.length === 0 ? 'object-gate' : 'row-scope',
      error,
      data,
      preImageWheres,
      snapshotWrites,
    };
  }

  // ── Layer 3: the real ADR-0092 D2 identity write guard ────────────────────
  const store = new Map<string, string>();
  if (opts.cachedSessionToken) {
    store.set(
      `active-sessions-${targetId}`,
      JSON.stringify([{ token: opts.cachedSessionToken, expiresAt: Date.now() + 3_600_000 }]),
    );
    store.set(
      opts.cachedSessionToken,
      JSON.stringify({
        session: { id: 'ses_1', userId: targetId, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
        user: { id: targetId, name: ROWS[targetId]?.name, image: null, email: ROWS[targetId]?.email },
      }),
    );
  }
  const storage: SecondaryStorageLike = {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      snapshotWrites.push({ key, value: JSON.parse(value) });
    },
    delete: async (key) => void store.delete(key),
  };

  const handlers: Record<string, Array<(ctx: any) => Promise<void>>> = {};
  const engine = {
    getSchema: () => ({ name: 'sys_user', managedBy: SysUser.managedBy }),
    registerHook: (event: string, handler: (ctx: any) => Promise<void>) => {
      (handlers[event] ??= []).push(handler);
    },
  };
  registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
  registerIdentityWriteGuard(engine as any, {
    packageId: 'test.sys-user-self-service-route',
    getSecondaryStorage: () => storage,
  });

  const hookCtx = { object: 'sys_user', session: context, input: { id: targetId, data } };
  const before = operation === 'insert' ? 'beforeInsert' : operation === 'delete' ? 'beforeDelete' : 'beforeUpdate';
  try {
    for (const handler of handlers[before] ?? []) await handler(hookCtx);
  } catch (error: any) {
    return { refusedBy: 'identity-guard', error, data, preImageWheres, snapshotWrites };
  }
  for (const handler of handlers.afterUpdate ?? []) await handler(hookCtx);

  return { refusedBy: null, error: null, data, preImageWheres, snapshotWrites };
}

// ── The composed write filter, read once and asserted verbatim ──────────────

describe('sys_user self-service — the row scope the write actually composes', () => {
  it('narrows a member’s by-id write to EXACTLY their own row', async () => {
    const r = await route(ME, { locale: 'ja-JP' });
    expect(r.refusedBy).toBeNull();
    // One pre-image re-read, and its `where` is the `{id}` address ANDed with
    // the compiled RLS parts. Asserted verbatim because every other assertion in
    // this file leans on `matchesFilter` reading it correctly, and because it is
    // the security property in one line: the caller's id, and nothing wider.
    expect(r.preImageWheres).toHaveLength(1);
    expect(r.preImageWheres[0]).toEqual({ $and: [{ id: ME }, { id: ME }] });
  });

  it('the org-peer READ scope does not appear in the write filter', async () => {
    // `sys_user_org_members` (`id in current_user.org_user_ids`) is what lets a
    // member see colleagues at all. If it ever reached the write class, the
    // filter above would carry an `$or` with a `$in` over `org_user_ids` and
    // every member could edit every colleague. Asserted as an absence on the
    // MEASURED filter rather than on the declaration, so a change anywhere in
    // the composition path fails here.
    const r = await route(ME, { name: 'Renamed' });
    // Non-vacuity: an absence assertion over an EMPTY list passes for free, and
    // an object-gate refusal produces exactly that. Pin the write got as far as
    // composing a filter before asserting what is not in it.
    expect(r.refusedBy).toBeNull();
    expect(r.preImageWheres).toHaveLength(1);
    expect(JSON.stringify(r.preImageWheres)).not.toContain('$in');
    expect(JSON.stringify(r.preImageWheres)).not.toContain(PEER);
  });
});

// ── The four pins the ruling names ──────────────────────────────────────────

describe('sys_user self-service — the four pins, each attributed to a layer', () => {
  it('PIN 1 — a member sets their OWN `locale`, and the value survives to the row', async () => {
    const r = await route(ME, { locale: 'ja-JP' });
    expect(r.refusedBy, 'own-row locale must be admitted end to end').toBeNull();
    // Admitted is not enough: the guard strips in place, so a "success" that
    // dropped the column would be a silent no-op at the driver.
    expect(r.data).toEqual({ id: ME, locale: 'ja-JP' });
  });

  it('PIN 2 — another member’s row is refused, and refused BY THE ROW SCOPE', async () => {
    const r = await route(PEER, { locale: 'ja-JP' });
    expect(r.refusedBy).toBe('row-scope');
    // The discriminating half. Before this change the same expectation passed
    // with `refusedBy === 'object-gate'` — the object bit was false, so the row
    // scope never ran and this pin proved nothing about it. Now the pre-image
    // re-read HAPPENED, was scoped to the caller, and came back empty.
    expect(r.preImageWheres).toEqual([{ $and: [{ id: PEER }, { id: ME }] }]);
    expect(r.error?.name).toBe('PermissionDeniedError');
    expect(r.error?.code).toBe('PERMISSION_DENIED');
  });

  it('PIN 3 — `name` and `image` are editable on the generic path', async () => {
    const r = await route(ME, { name: 'Renamed', image: 'https://example.com/a.png' });
    expect(r.refusedBy).toBeNull();
    expect(r.data).toEqual({ id: ME, name: 'Renamed', image: 'https://example.com/a.png' });
  });

  it('PIN 3 — …and the ADR-0092 D6 session refresh is OBSERVED, not merely registered', async () => {
    const r = await route(ME, { name: 'Renamed' }, { cachedSessionToken: 'tok_1' });
    expect(r.refusedBy).toBeNull();
    // The observable effect: better-auth's cached `{session, user}` snapshot is
    // re-written with the new value, at the same key. Asserting that the hook is
    // registered would pass over a hook that returned early on every input —
    // which is precisely what it does when the mirror set excludes the column
    // (see the `locale` case below).
    const rewritten = r.snapshotWrites.filter((w) => w.key === 'tok_1');
    expect(rewritten).toHaveLength(1);
    expect(rewritten[0].value.user).toMatchObject({ id: ME, name: 'Renamed' });
    // …and it REWRITES rather than deletes: the session survives the edit.
    expect(rewritten[0].value.session).toMatchObject({ id: 'ses_1', userId: ME });
  });

  it('PIN 3 — `locale` correctly does NOT touch the snapshot (D6 mirror ≠ whitelist)', async () => {
    // Not a gap. better-auth carries no `locale` on its user model and it is
    // deliberately not an `additionalFields` entry, so there is no stale cached
    // copy to repair; merging one in would MANUFACTURE a key present only on
    // sessions that happen to be cached. Pinned as an expected absence so a
    // future reader does not "fix" it into an incoherence.
    const r = await route(ME, { locale: 'ja-JP' }, { cachedSessionToken: 'tok_1' });
    expect(r.refusedBy).toBeNull();
    expect(r.snapshotWrites).toEqual([]);
  });

  it('PIN 4 — a non-whitelisted column is refused BY THE GUARD, not by the layers above it', async () => {
    // The phantom-pin case, stated as the mechanism under test: `email` must get
    // PAST the object gate and PAST the row scope — the caller is editing their
    // own row, which both layers permit — and be stopped by the column
    // whitelist. If either layer above refused instead, this pin would be green
    // while the guard was dead code.
    const r = await route(ME, { email: 'attacker@example.com' });
    expect(r.refusedBy).toBe('identity-guard');
    // The pre-image re-read ran and SUCCEEDED (the row was visible) — proof the
    // first two layers admitted the write before the guard refused it.
    expect(r.preImageWheres).toEqual([{ $and: [{ id: ME }, { id: ME }] }]);
    // ADR-0112 envelope, both discriminators (the REST boundary derives 403 from
    // `status`, and `mapDataError` keys on `code`).
    expect(r.error?.code).toBe('PERMISSION_DENIED');
    expect(r.error?.status).toBe(403);
    // The wording is load-bearing here: it is the only place the caller is told
    // WHICH fields are editable, and it is what distinguishes this refusal from
    // the two above in a log.
    expect(r.error?.message).toContain('email');
    expect(r.error?.message).toContain('ADR-0092');
    expect(r.error?.message).toMatch(/Editable fields: .*locale/);
    // And the column never reached the payload.
    expect(r.data).toEqual({ id: ME });
  });

  it('PIN 4 — the same holds for every other non-whitelisted column, one at a time', () => {
    // A property over the tier list rather than one example, so a whitelist that
    // grew by accident is caught here rather than in production.
    const forbidden = ['email', 'role', 'banned', 'phone_number', 'email_verified', 'manager_id'];
    for (const field of forbidden) {
      expect(SYS_USER_PROFILE_EDIT_FIELDS.has(field), `${field} must not be self-editable`).toBe(false);
    }
    expect([...SYS_USER_PROFILE_EDIT_FIELDS].sort()).toEqual(['image', 'locale', 'name']);
  });

  it('PIN 4 — a mixed payload keeps the legal column and strips the rest, still admitted', async () => {
    // The guard strips rather than refuses when SOMETHING editable survives.
    // Worth pinning next to the refusal: the two behaviours are one branch apart
    // and a change that made stripping silent-refuse (or refusal silent-strip)
    // would be invisible to either test alone.
    const r = await route(ME, { locale: 'zh-CN', role: 'admin' });
    expect(r.refusedBy).toBeNull();
    expect(r.data).toEqual({ id: ME, locale: 'zh-CN' });
  });
});

// ── The axes the ruling did NOT open ────────────────────────────────────────

describe('sys_user self-service — create and delete stay shut, at the object gate', () => {
  it.each([
    ['insert', 'insert' as const],
    ['delete', 'delete' as const],
  ])('a member’s %s on sys_user is refused before any row is read', async (_name, operation) => {
    const r = await route(ME, { name: 'X' }, { operation });
    // These two cases are also this file's positive control for the
    // `object-gate` verdict: without them, a `route` that could never answer
    // `object-gate` would leave PIN 2 and PIN 4 unable to fail for the reason
    // they are written to catch.
    expect(r.refusedBy).toBe('object-gate');
    expect(r.preImageWheres).toEqual([]);
    expect(r.error?.name).toBe('PermissionDeniedError');
  });
});
