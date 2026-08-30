// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13279] A permission-store OUTAGE must not be answerable as a capability
 * denial — at the resolver, and at every transport that authorizes through it.
 *
 * Maintainer ruling, 2026-08-30, verbatim 「第一批其余同意」:
 *
 * > `tryFind` 区分「无行」与「读失败」,读失败 fail-loud —— 权限库不可达时不再
 * > 解析为「已认证零能力」,而是响亮拒绝(与真实能力拒绝的 403 可区分)。
 * > ⛔ 全部经 `resolveAuthzContext` 授权的 transport 都继承此变更,派发令必须
 * > 要求全 transport 回归(REST + 其余),不得只测 REST 门。
 *
 * ## Reading discipline
 *
 * Every loud assertion here is paired with its INNOCENT TWIN — the same wiring
 * with the store reachable and genuinely empty. Without the twin, "the outage
 * throws" is satisfied by a resolver that throws at everything, which would be
 * a worse defect than the one being fixed: a deployment where nobody holds a
 * capability yet would stop resolving at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAuthzContext, resolveUserAuthzGrants } from './resolve-authz-context.js';
import {
  AuthzStoreUnavailableError,
  isAuthzStoreUnavailableError,
  rethrowAuthzStoreUnavailable,
  AUTHZ_STORE_UNAVAILABLE_CODE,
  AUTHZ_STORE_UNAVAILABLE_STATUS,
} from './authz-store-unavailable.js';

const USER = 'u_admin';
const SESSION = { getSession: async () => ({ user: { id: USER } }) };

/** The permission store, unreachable — every read throws, as a driver outage does. */
const qlDown = () => ({ find: async () => { throw new Error('permission store unreachable'); } });
/** The INNOCENT TWIN: reachable, and genuinely holding no rows for this user. */
const qlEmpty = () => ({ find: async () => [] });
/** A store that actually grants something, so "resolves" is read against a real grant. */
const qlHealthy = () => ({
  find: async (object: string) => {
    if (object === 'sys_user_permission_set') return [{ permission_set_id: 'ps' }];
    if (object === 'sys_permission_set') {
      return [{ id: 'ps', name: 'pkg_admin', system_permissions: ['studio.access'] }];
    }
    return [];
  },
});

const settle = async (p: Promise<unknown>) =>
  p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));

// ---------------------------------------------------------------------------
// 1. The resolver distinguishes a FAILED read from an EMPTY one.
// ---------------------------------------------------------------------------

describe('[#13279] resolveAuthzContext — an outage is loud, an empty store is not', () => {
  it('a permission-store OUTAGE refuses, with the branded error', async () => {
    const r = await settle(resolveAuthzContext({ ql: qlDown(), headers: {}, ...SESSION }));
    expect(r.ok).toBe(false);
    expect(isAuthzStoreUnavailableError((r as any).e)).toBe(true);
    // The wire vocabulary an outage selects — an EXISTING ADR-0112 member.
    expect((r as any).e.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    expect((r as any).e.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
    // Names the table, so an operator is told WHAT was unreachable.
    expect(typeof (r as any).e.object).toBe('string');
    expect((r as any).e.object.length).toBeGreaterThan(0);
  });

  it('⭐ THE TWIN: a reachable, genuinely EMPTY store still resolves to zero capabilities', async () => {
    // The assertion that keeps the fix honest. If this ever throws, the repair
    // has stopped distinguishing the two facts and merely moved the lie.
    const ctx = await resolveAuthzContext({ ql: qlEmpty(), headers: {}, ...SESSION });
    expect(ctx.userId).toBe(USER);
    expect(ctx.systemPermissions).toEqual([]);
  });

  it('⭐ CONTROL: a healthy store still resolves the capability it grants', async () => {
    const ctx = await resolveAuthzContext({ ql: qlHealthy(), headers: {}, ...SESSION });
    expect(ctx.userId).toBe(USER);
    expect(ctx.systemPermissions).toContain('studio.access');
  });

  it('an ABSENT engine is not a failed read — it still resolves, as it always did', async () => {
    // `tryFind`'s `!ql` guard. An embedder that never wired a data plane must
    // keep resolving; only a read that was ISSUED and THREW is loud.
    const ctx = await resolveAuthzContext({ ql: undefined, headers: {}, ...SESSION });
    expect(ctx.userId).toBe(USER);
    expect(ctx.systemPermissions).toEqual([]);
    const noFind = await resolveAuthzContext({ ql: {} as any, headers: {}, ...SESSION });
    expect(noFind.userId).toBe(USER);
  });

  it('an ANONYMOUS request never reaches the store, so an outage cannot make it loud', async () => {
    const ctx = await resolveAuthzContext({ ql: qlDown(), headers: {} });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.systemPermissions).toEqual([]);
  });
});

describe('[#13279] resolveUserAuthzGrants inherits the distinction', () => {
  it('an OUTAGE refuses rather than reporting an empty grant set', async () => {
    const r = await settle(resolveUserAuthzGrants(qlDown(), USER));
    expect(r.ok).toBe(false);
    expect(isAuthzStoreUnavailableError((r as any).e)).toBe(true);
  });

  it('⭐ THE TWIN: an empty store yields an empty-but-valid envelope', async () => {
    const grants = await resolveUserAuthzGrants(qlEmpty(), USER);
    expect(grants.systemPermissions).toEqual([]);
    expect(grants.org_user_ids).toEqual([USER]);
  });
});

// ---------------------------------------------------------------------------
// 2. The brand, and the guard the transports use.
// ---------------------------------------------------------------------------

describe('[#13279] the brand survives what `instanceof` does not', () => {
  it('recognises a genuine instance', () => {
    expect(isAuthzStoreUnavailableError(new AuthzStoreUnavailableError('sys_member'))).toBe(true);
  });

  it('⭐ recognises a DUPLICATE class — the monorepo hazard `instanceof` fails', () => {
    // A second copy of the module (src under a vitest alias vs dist under the
    // published `exports`) produces a structurally identical error from a
    // DIFFERENT class object. `instanceof` answers false for it, which would
    // silently restore the quiet 403 this card removes.
    class DuplicateCopy extends Error {
      readonly __objectstackAuthzStoreUnavailable = true as const;
      readonly code = AUTHZ_STORE_UNAVAILABLE_CODE;
      readonly status = AUTHZ_STORE_UNAVAILABLE_STATUS;
    }
    const twin = new DuplicateCopy('from another realm');
    expect(twin instanceof AuthzStoreUnavailableError).toBe(false);   // the hazard, shown
    expect(isAuthzStoreUnavailableError(twin)).toBe(true);            // the brand, holding
  });

  it('does NOT claim unrelated failures', () => {
    for (const other of [new Error('boom'), null, undefined, 'string', 42, {}, { code: 'FORBIDDEN' }]) {
      expect(isAuthzStoreUnavailableError(other)).toBe(false);
    }
  });

  it('`rethrowAuthzStoreUnavailable` re-raises the outage and swallows everything else', () => {
    expect(() => rethrowAuthzStoreUnavailable(new AuthzStoreUnavailableError('sys_member'))).toThrow();
    expect(rethrowAuthzStoreUnavailable(new Error('unrelated'))).toBeUndefined();
    expect(rethrowAuthzStoreUnavailable(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. ⭐ ALL-TRANSPORT LEDGER — the ruling's "not just the REST door".
//
//    The enumeration is REBUILT FROM SOURCE on every run and audited for SET
//    EQUALITY against the ledger, so a transport added later cannot inherit the
//    old silence unnoticed: an unlisted call site fails this suite until it is
//    classified. A curated list alone would answer "the doors I remembered".
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/**
 * How each production transport lets the loud failure reach its door.
 *
 *  - `guarded`    — the call sits inside a fail-closed `catch` that would have
 *    re-silenced the outage, so that `catch` now re-raises it explicitly.
 *    MEASURED, not assumed: with `tryFind` loud but the nets untouched, the
 *    REST package door answered 401 instead of 403 — the outage had merely
 *    changed disguises.
 *  - `propagates` — nothing between the call and the door swallows, so the
 *    throw reaches the transport's error mapping unaided.
 */
const TRANSPORT_LEDGER: Record<string, 'guarded' | 'propagates'> = {
  'packages/rest/src/rest-server.ts': 'guarded',
  'packages/runtime/src/security/resolve-execution-context.ts': 'propagates',
  'packages/mcp/src/plugin.ts': 'propagates',
  'packages/services/service-datasource/src/admin-routes.ts': 'guarded',
  'packages/services/service-settings/src/settings-service-plugin.ts': 'guarded',
  'packages/services/service-storage/src/storage-service-plugin.ts': 'guarded',
  'packages/plugins/plugin-sharing/src/sharing-plugin.ts': 'guarded',
  'packages/cloud-connection/src/marketplace-install-local-plugin.ts': 'guarded',
};

/** Test scaffolding is not a transport — it drives the resolver, it does not authorize for anyone. */
const isScaffolding = (rel: string) =>
  /\.test\.ts$/.test(rel) || /\.testkit\.ts$/.test(rel)
  || /\.fixtures?\.ts$/.test(rel) || rel.includes(`${sep}dogfood${sep}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every PRODUCTION file that calls `resolveAuthzContext`, rebuilt from source. */
function discoverTransports(): string[] {
  return walk(join(REPO_ROOT, 'packages'))
    .filter((f) => readFileSync(f, 'utf8').includes('resolveAuthzContext({'))
    .map((f) => relative(REPO_ROOT, f).split(sep).join('/'))
    .filter((rel) => !isScaffolding(rel.split('/').join(sep)))
    .sort();
}

describe('[#13279] every transport that authorizes through resolveAuthzContext', () => {
  it('CONTROL: the scanner finds transports at all, and finds THIS repo', () => {
    // Without this, a broken walk would return [] and the set-equality audit
    // below would be comparing two empty sets and passing.
    const found = discoverTransports();
    expect(found.length).toBeGreaterThanOrEqual(8);
    expect(found).toContain('packages/rest/src/rest-server.ts');
  });

  it('⭐ SET EQUALITY: the ledger names exactly the transports source contains', () => {
    // A NEW transport is red here until it is classified — which is the whole
    // point: the ruling is about every transport, including the ones written
    // after it.
    expect(discoverTransports()).toEqual(Object.keys(TRANSPORT_LEDGER).sort());
  });

  it.each(Object.entries(TRANSPORT_LEDGER))(
    '%s (%s) — a fail-closed catch re-raises the outage instead of degrading it',
    (rel, disposition) => {
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      if (disposition === 'guarded') {
        // The guard must be IMPORTED (so it is the shared predicate, not a
        // local re-spelling that can drift) and USED.
        expect(src).toMatch(/from '@objectstack\/core'/);
        expect(
          src.includes('isAuthzStoreUnavailableError') || src.includes('rethrowAuthzStoreUnavailable'),
        ).toBe(true);
      } else {
        // `propagates` is a CLAIM about this file, so it is checked rather than
        // trusted: a bare `catch {` around the resolver call would silently
        // reintroduce the swallow this ledger exists to track.
        expect(src).not.toMatch(/resolveAuthzContext\(\{[\s\S]{0,600}?\n\s*\} catch \{\s*\n\s*return (undefined|null|\{\})/);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 4. ⭐⭐ THE BOUNDARY, PINNED IN BOTH DIRECTIONS.
//
//    Maintainer ruling, 2026-08-30, 第 5 场总监席决裁批 #9, verbatim:
//
//      > 签字在案:基于 driver 错误码的表缺失判定获准在安全路径上门控响亮性;
//      > 其假阳方向(误判「表缺失」⇒ 静默恢复安静 403)是本裁定接受的已知风险,
//      > 须在谓词旁注释写明并以测试钉住两个方向(真 outage ⇒ 响;真未 provision
//      > ⇒ 零能力为真答案,不响)。
//
//    This section IS the "以测试钉住两个方向" half; the "谓词旁注释" half is the
//    comment beside `isMissingTableError` in `tryFind`'s catch.
//
//    Why BOTH are load-bearing, and why neither alone would do:
//      - only the LOUD direction  ⇒ satisfied by a resolver that throws at
//        everything, which refuses service to correctly-configured deployments
//        whose `sys_*` tables were never created (measured: it turned four CI
//        suites red — client CRUD, runtime notifications, and two integration
//        noise guards).
//      - only the QUIET direction ⇒ satisfied by the pre-#13279 `return []`,
//        i.e. the defect itself: an outage answered as a capability denial.
//
//    ⚠️ The accepted risk lives in the first direction. A false POSITIVE from
//    `isMissingTableError` — an outage mis-read as "not provisioned" — restores
//    the quiet 403 with no other symptom anywhere. Every case below is a shape
//    that must NOT be mis-read, so this table is the risk's tripwire. Add to it
//    rather than relax it.
// ---------------------------------------------------------------------------

/** The tables `resolveAuthzContext` reads; a fake engine answers all of them alike. */
const qlThrowing = (make: (object: string) => unknown) => ({
  find: async (object: string) => { throw make(object); },
});

/**
 * Shapes that are NOT "this table was never provisioned", each with the reason
 * a naive predicate might have said otherwise.
 */
const OUTAGE_SHAPES: ReadonlyArray<readonly [string, (object: string) => unknown]> = [
  ['a bare connection failure', () => new Error('permission store unreachable')],
  ['ECONNREFUSED from the driver', () => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
  ['a statement timeout', () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })],
  [
    'a PERMISSION denial on the table — the row exists, we were refused it',
    (o: string) => Object.assign(new Error(`permission denied for table ${o}`), { code: '42501' }),
  ],
  [
    '#6347 the Postgres missing-COLUMN phrase, which CONTAINS a legal missing-table phrase',
    (o: string) => Object.assign(new Error(`column "x" of relation "${o}" does not exist`), { code: '42703' }),
  ],
  [
    '#13324 a missing-table phrase naming a DIFFERENT relation (a view over a dropped base)',
    () => new Error('no such table: main.some_other_base'),
  ],
  ['an unrecognised driver error — unrecognised must never mean benign', () => Object.assign(new Error('opaque'), { code: 'SQLITE_BUSY' })],
];

describe('[#13279 option A] ⭐ THE OUTAGE DIRECTION — a read failure that is not an unprovisioned table stays LOUD', () => {
  it.each(OUTAGE_SHAPES)('%s ⇒ AuthzStoreUnavailableError (503 SERVICE_UNAVAILABLE)', async (_label, make) => {
    const r = await settle(resolveAuthzContext({ ql: qlThrowing(make), headers: {}, ...SESSION }));
    expect(r.ok).toBe(false);
    expect(isAuthzStoreUnavailableError((r as any).e)).toBe(true);
    expect((r as any).e.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    expect((r as any).e.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
  });

  it('⭐ a store that is provisioned but loses ONE table mid-resolution is still loud', async () => {
    // The quiet branch must not leak past the table it is about. Everything
    // resolves normally except `sys_user_permission_set`, which fails for a
    // reason that is not "never provisioned".
    const ql = {
      find: async (object: string) => {
        if (object === 'sys_user_permission_set') throw new Error('connection terminated unexpectedly');
        return [];
      },
    };
    const r = await settle(resolveAuthzContext({ ql, headers: {}, ...SESSION }));
    expect(r.ok).toBe(false);
    expect(isAuthzStoreUnavailableError((r as any).e)).toBe(true);
    expect((r as any).e.object).toBe('sys_user_permission_set');
  });
});

/**
 * Genuine "the table was never created", in every spelling a supported driver
 * produces. This is the shape a first boot against a fresh database makes, and
 * `packages/runtime`'s `notifications.hono.integration.test.ts` names the
 * deployment shape `ABSENT_AUTHZ_TABLES`.
 */
const UNPROVISIONED_SHAPES: ReadonlyArray<readonly [string, (object: string) => unknown]> = [
  ['SQLite / libsql message', (o: string) => new Error(`no such table: ${o}`)],
  ['PostgreSQL SQLSTATE 42P01', (o: string) => Object.assign(new Error(`relation "${o}" does not exist`), { code: '42P01' })],
  ['MySQL / MariaDB errno 1146', (o: string) => Object.assign(new Error(`Table 'app.${o}' doesn't exist`), { errno: 1146 })],
  [
    'the PRODUCTION wrapper shape — driver phrase on `cause`, not on the outer message',
    // What `SqlDriver.backendStatementFaultError` actually raises: a wrapper
    // that deliberately withholds the verdict, with the driver's own error
    // attached. The predicate follows `cause`; if it stopped at the outer
    // message this would be read as an outage and first boot would 503.
    (o: string) => Object.assign(new Error('backend statement fault'), { cause: new Error(`no such table: ${o}`) }),
  ],
];

describe('[#13279 option A] ⭐ THE UNPROVISIONED DIRECTION — a never-provisioned table resolves QUIETLY', () => {
  it.each(UNPROVISIONED_SHAPES)(
    '%s ⇒ zero capabilities, because that is the TRUE answer and not a fabrication',
    async (_label, make) => {
      const ctx = await resolveAuthzContext({ ql: qlThrowing(make), headers: {}, ...SESSION });
      expect(ctx.userId).toBe(USER);
      expect(ctx.systemPermissions).toEqual([]);
      expect(ctx.permissions).toEqual([]);
      // ONLY the unconditional `everyone` audience anchor (ADR-0090 D5), which
      // every authenticated member holds without any read happening. Asserted
      // exactly rather than as "empty": the point is that NOTHING was invented
      // from a read that failed, and `toEqual([])` would have been a claim
      // about the anchor rather than about this repair.
      expect(ctx.positions).toEqual(['everyone']);
    },
  );

  it('⭐ resolves IDENTICALLY to a reachable, genuinely empty store', async () => {
    // The strongest statement of "this is the true answer": an unprovisioned
    // deployment and an empty-but-provisioned one are the same fact — nothing
    // is granted — so they must be the same envelope, byte for byte. Anything
    // less means the quiet branch is quietly different.
    const unprovisioned = await resolveAuthzContext({
      ql: qlThrowing((o) => new Error(`no such table: ${o}`)), headers: {}, ...SESSION,
    });
    const empty = await resolveAuthzContext({ ql: qlEmpty(), headers: {}, ...SESSION });
    expect(JSON.stringify(unprovisioned)).toBe(JSON.stringify(empty));
    // CONTROL against a vacuous comparison: a HEALTHY store differs from both.
    const healthy = await resolveAuthzContext({ ql: qlHealthy(), headers: {}, ...SESSION });
    expect(JSON.stringify(healthy)).not.toBe(JSON.stringify(empty));
  });

  it('⭐ `resolveUserAuthzGrants` inherits the quiet direction too', async () => {
    const grants = await resolveUserAuthzGrants(qlThrowing((o) => new Error(`no such table: ${o}`)), USER);
    expect(grants.systemPermissions).toEqual([]);
    expect(grants.org_user_ids).toEqual([USER]);
  });
});

describe('[#13279 option A] the classifier is the RELOCATED one, not a second copy', () => {
  it('⭐ `resolve-authz-context.ts` imports `isMissingTableError` from `@objectstack/types`', () => {
    // The ruling's structural half, pinned in source. A local re-spelling of
    // the predicate here would pass every behavioural test above and still be
    // the duplication-drift the ruling rejected (option B).
    const src = readFileSync(join(REPO_ROOT, 'packages/core/src/security/resolve-authz-context.ts'), 'utf8');
    expect(src).toMatch(/import \{ isMissingTableError \} from '@objectstack\/types';/);
    expect(src).not.toMatch(/function\s+isMissingTableError/);
    // ⛔ core must not IMPORT `@objectstack/metadata` — metadata depends on
    // core, and that edge is why the predicate moved rather than being imported.
    // (Prose mentions of the old home are fine and deliberate; an import is not.)
    expect(src).not.toMatch(/from '@objectstack\/metadata/);
  });

  it('⭐ the SIGNED-OFF RISK is written beside the predicate, as the ruling requires', () => {
    // The audit trail is a deliverable of the ruling, not decoration: the
    // false-positive direction is accepted only BECAUSE it is recorded where
    // the next author will read it before widening the predicate.
    const src = readFileSync(join(REPO_ROOT, 'packages/core/src/security/resolve-authz-context.ts'), 'utf8');
    const catchBody = src.slice(src.indexOf('} catch (err) {'), src.indexOf('throw new AuthzStoreUnavailableError(object, err);'));
    expect(catchBody).toContain('THE SIGNED-OFF RISK');
    expect(catchBody).toContain('签字在案');
    expect(catchBody).toContain('isMissingTableError(err, object)');
  });
});
