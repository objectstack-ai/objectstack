// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24523] The Default Organization answer is memoised per engine across
 * requests, and retired by a `sys_organization` write through the engine's
 * write seam, by a non-`write` epoch bump, and by the residual TTL.
 *
 * Every case drives `resolveUserAuthzGrants` — the one caller — on a recording
 * double that carries the two engine seams the memo requires, shaped as the
 * engine's own (the same shape `resolve-localization-cache.test.ts` drives the
 * leg-5 seam with): the write epoch, bumped with `'write'` when a write STARTS,
 * and a middleware chain each write SNAPSHOTS when it starts.
 *
 * What each case reads: the `sys_organization` reads a resolution issued
 * (zero on a memo hit), and the platform standing the answer feeds. ⛔ The
 * reads themselves — `{ slug: 'default' }` limit 1, then `{}` limit 2 — are
 * asserted byte-for-byte wherever they are issued: only how often they run
 * moves.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec';

import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import { resolveUserAuthzGrants } from './resolve-authz-context.js';
import { makeRecordingQl } from './__tests__/resolve-authz-context.batch-equivalence.testkit.js';

const NOW = Date.parse('2026-10-19T00:00:00.000Z');
const ENVS = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_PLATFORM_OWNER_EMAIL', 'OS_AUTHZ_GRANTS_CACHE_TTL_MS'] as const;

let ambient: Record<string, string | undefined> = {};
beforeEach(() => {
  ambient = Object.fromEntries(ENVS.map((k) => [k, process.env[k]]));
  // `single`, no configured administrator, the grants cache at its default (off).
  for (const k of ENVS) delete process.env[k];
  resetPlatformAdminEmailMemo();
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENVS) {
    if (ambient[k] === undefined) delete process.env[k];
    else process.env[k] = ambient[k];
  }
  resetPlatformAdminEmailMemo();
});

type Middleware = (ctx: { object: string; operation: string }, next: () => Promise<void>) => Promise<void>;

const BY_SLUG = { object: 'sys_organization', where: { slug: 'default' }, limit: 1, isSystem: true };
const SOLE = { object: 'sys_organization', where: {}, limit: 2, isSystem: true };

/**
 * The administrator's tables: one `admin_full_access` grant owned by
 * `grantOrganization`, and the organizations given.
 */
function tablesOf(grantOrganization: string, organizations: Array<Record<string, unknown>>) {
  return {
    sys_user: [{ id: 'usr_1', email: 'admin@example.com' }],
    sys_member: [],
    sys_user_position: [],
    sys_user_permission_set: [
      { id: 'ups_1', user_id: 'usr_1', permission_set: ADMIN_FULL_ACCESS, organization_id: grantOrganization },
    ],
    sys_permission_set: [{ id: 'pst_1', name: ADMIN_FULL_ACCESS, active: true }],
    sys_organization: organizations,
  } as Record<string, Array<Record<string, unknown>>>;
}

/**
 * {@link makeRecordingQl} with the engine's write seams. `write(object,
 * operation, apply)` is one engine write: the epoch first, then the chain as
 * it stood when the write started, `apply` as its driver step. `pause` holds a
 * write between its start and its driver step, for the in-flight cases.
 */
function makeEngineQl(tables: Record<string, Array<Record<string, unknown>>>, seams = true) {
  const ql = makeRecordingQl(tables) as ReturnType<typeof makeRecordingQl> & Record<string, any>;
  const listeners = new Set<(epoch: number, reason: string) => void>();
  const middlewares: Middleware[] = [];
  let epoch = 0;
  const writeEpoch = {
    get current() {
      return epoch;
    },
    bump(reason: string) {
      epoch += 1;
      for (const l of [...listeners]) l(epoch, reason);
      return epoch;
    },
    subscribe(l: (e: number, r: string) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  if (seams) {
    ql.writeEpoch = writeEpoch;
    ql.registerMiddleware = (fn: Middleware) => {
      middlewares.push(fn);
    };
  }
  const write = async (
    object: string,
    operation: 'insert' | 'update' | 'delete',
    apply: () => void,
    pause?: Promise<void>,
  ): Promise<void> => {
    writeEpoch.bump('write');
    const chain = [...middlewares];
    let i = 0;
    const next = async (): Promise<void> => {
      if (i < chain.length) return chain[i++]({ object, operation }, next);
      if (pause) await pause;
      apply();
    };
    await next();
  };
  const organizationReads = () => ql.calls.filter((c) => c.object === 'sys_organization');
  /** The `sys_organization` reads one resolution issued, and its platform standing. */
  const resolve = async () => {
    const before = organizationReads().length;
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW, seedEmail: 'admin@example.com' });
    return { reads: organizationReads().slice(before), standing: grants.positions.includes('platform_admin') };
  };
  return { ql, write, writeEpoch, middlewares, resolve };
}

describe('[#24523] the Default Organization answer is read once per engine', () => {
  it('⭐ slugged `default`: the first resolution reads it, the next ones do not', async () => {
    const e = makeEngineQl(tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]));
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });
    expect(await e.resolve()).toEqual({ reads: [], standing: true });
    expect(await e.resolve()).toEqual({ reads: [], standing: true });
  });

  it('⭐ the only organization, slugged otherwise: two reads once, then none', async () => {
    const e = makeEngineQl(tablesOf('org_a', [{ id: 'org_a', slug: 'acme' }]));
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG, SOLE], standing: true });
    expect(await e.resolve()).toEqual({ reads: [], standing: true });
  });

  it('`undefined` is a real answer and is memoised: several organizations, none `default`', async () => {
    const e = makeEngineQl(tablesOf('org_a', [{ id: 'org_a', slug: 'acme' }, { id: 'org_b', slug: 'beta' }]));
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG, SOLE], standing: false });
    expect(await e.resolve()).toEqual({ reads: [], standing: false });
    // …and an organization write retires it like any other answer.
    await e.write('sys_organization', 'update', () => {});
    expect((await e.resolve()).reads).toEqual([BY_SLUG, SOLE]);
  });

  it('CONTROL — an engine without the write seams memoises nothing: every resolution reads, as before', async () => {
    const e = makeEngineQl(tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]), false);
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });
  });

  it('CONTROL — an organization-less grant never reads it, memo or not', async () => {
    const e = makeEngineQl(tablesOf('', [{ id: 'org_a', slug: 'default' }]));
    // The grant's organization is blank: the legacy organization-less spelling.
    expect(await e.resolve()).toEqual({ reads: [], standing: true });
    expect(e.middlewares).toHaveLength(0);
  });
});

describe('[#24523 / #21868] a sys_organization write through the engine retires the answer', () => {
  it('⭐ the Default Organization deleted and recreated: the next resolution reads the new id', async () => {
    const tables = tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]);
    const e = makeEngineQl(tables);
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });

    await e.write('sys_organization', 'delete', () => {
      tables.sys_organization.splice(0);
    });
    await e.write('sys_organization', 'insert', () => {
      tables.sys_organization.push({ id: 'org_b', slug: 'default' });
    });
    // The first-user promotion's grant now belongs to the new organization.
    tables.sys_user_permission_set[0].organization_id = 'org_b';

    // A memo still answering `org_a` would withhold standing from `org_b`'s grant.
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });
    expect(await e.resolve()).toEqual({ reads: [], standing: true });
  });

  it('⭐ a slug change that moves `default` to another organization: the old organization\'s grant stops anchoring', async () => {
    const tables = tablesOf('org_a', [{ id: 'org_a', slug: 'default' }, { id: 'org_b', slug: 'beta' }]);
    const e = makeEngineQl(tables);
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });

    await e.write('sys_organization', 'update', () => {
      tables.sys_organization[0].slug = 'alpha';
    });
    await e.write('sys_organization', 'update', () => {
      tables.sys_organization[1].slug = 'default';
    });
    // The GRANTING direction: a memo still answering `org_a` would keep
    // conferring standing on `org_a`'s grant.
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: false });

    tables.sys_user_permission_set[0].organization_id = 'org_b';
    expect(await e.resolve()).toEqual({ reads: [], standing: true });
  });

  it('a write to another object — a watched grants table included — does not retire it', async () => {
    const e = makeEngineQl(tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]));
    await e.resolve();
    await e.write('sys_user_permission_set', 'update', () => {});
    await e.write('sys_session', 'update', () => {});
    expect(await e.resolve()).toEqual({ reads: [], standing: true });
  });

  it('the `remote` and `metadata` epoch bumps retire it; a bare `write` bump does not', async () => {
    const e = makeEngineQl(tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]));
    await e.resolve();
    e.writeEpoch.bump('write');
    expect((await e.resolve()).reads).toEqual([]);
    e.writeEpoch.bump('remote');
    expect((await e.resolve()).reads).toEqual([BY_SLUG]);
    e.writeEpoch.bump('metadata');
    expect((await e.resolve()).reads).toEqual([BY_SLUG]);
    expect((await e.resolve()).reads).toEqual([]);
  });

  it('a write that lands WHILE the read is in flight leaves that answer dead on arrival', async () => {
    const tables = tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]);
    const e = makeEngineQl(tables);
    // Register the observer first (one resolution), then retire it so the next one reads.
    await e.resolve();
    e.writeEpoch.bump('manual');
    const find = e.ql.find.bind(e.ql);
    let landed = false;
    e.ql.find = async (object: string, opts: any) => {
      const rows = await find(object, opts);
      if (object === 'sys_organization' && !landed) {
        landed = true;
        // The rows above are the pre-write snapshot; the write settles before the resolution does.
        await e.write('sys_organization', 'update', () => {
          tables.sys_organization[0].slug = 'gone';
        });
      }
      return rows;
    };
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });
    // Not served from the entry that read was stored under.
    expect((await e.resolve()).reads).toEqual([BY_SLUG, SOLE]);
  });

  it('the TTL is the residual bound: an answer older than 30 s is read again', async () => {
    const e = makeEngineQl(tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await e.resolve();
    clock.mockReturnValue(NOW + 29_999);
    expect((await e.resolve()).reads).toEqual([]);
    clock.mockReturnValue(NOW + 30_001);
    expect((await e.resolve()).reads).toEqual([BY_SLUG]);
  });

  it('MEASURED — a write that STARTED before the observer registered is not seen; the TTL bounds it', async () => {
    const tables = tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]);
    const e = makeEngineQl(tables);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    let release!: () => void;
    const pause = new Promise<void>((r) => {
      release = r;
    });
    // The write starts with an empty chain: no observer is registered yet.
    const inFlight = e.write('sys_organization', 'update', () => {
      tables.sys_organization[0].slug = 'alpha';
    }, pause);
    // The first resolution registers the observer and reads the pre-write row.
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });
    release();
    await inFlight;
    // The write landed unobserved: the answer stands, stale, until the TTL.
    expect(await e.resolve()).toEqual({ reads: [], standing: true });
    clock.mockReturnValue(NOW + 30_001);
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG, SOLE], standing: true });
  });
});

describe('[#24523] ⛔ an outage is not an answer', () => {
  it('⭐ a failed read memoises nothing: it propagates, and the next resolution reads again', async () => {
    const e = makeEngineQl(tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]));
    const find = e.ql.find.bind(e.ql);
    let down = true;
    e.ql.find = async (object: string, opts: any) => {
      if (object === 'sys_organization' && down) {
        await find(object, opts); // recorded as issued
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
      }
      return find(object, opts);
    };
    const refused = await resolveUserAuthzGrants(e.ql, 'usr_1', { nowMs: NOW, seedEmail: 'admin@example.com' })
      .then(() => undefined, (err: unknown) => err as { code?: unknown; status?: unknown });
    expect(refused).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });

    down = false;
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });
    expect(await e.resolve()).toEqual({ reads: [], standing: true });
  });

  it('a registry that does not hold sys_organization: no read, nothing wired, nothing memoised', async () => {
    const e = makeEngineQl(tablesOf('org_a', [{ id: 'org_a', slug: 'default' }]));
    let registered = false;
    e.ql.registry = { getObject: (name: string) => (name === 'sys_organization' ? registered : true) };
    expect(await e.resolve()).toEqual({ reads: [], standing: false });
    expect(e.middlewares).toHaveLength(0);
    // Registered later in the same boot: read at once, not answered from a verdict.
    registered = true;
    expect(await e.resolve()).toEqual({ reads: [BY_SLUG], standing: true });
  });
});
