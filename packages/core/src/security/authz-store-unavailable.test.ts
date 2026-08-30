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
