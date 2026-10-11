// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15598] What `ObjectQL.find` actually resolves at the seams that used
 * to normalize it — one pin per seam, each driven against a REAL engine.
 *
 * ## The class, and why a type was not allowed to settle it
 *
 * Seven blocks in this plugin carried `Array.isArray(x) ? x : x.records` over an
 * engine `find()` result. `IDataEngine.find` is declared `Promise<any[]>`, so
 * the envelope limb looked provably unreachable — but a declared type is NOT
 * proof in this repo: `ObjectStackAdapter.find()` resolves a `QueryResult`
 * envelope and never an array, which is exactly the counter-case that makes
 * "the type says so" the wrong instrument. The limbs were therefore removed on
 * a MEASUREMENT: a real `ObjectQL` over a real `SqlDriver` (better-sqlite3
 * `:memory:`), driven once per seam through the shipped function that owns it.
 * Every seam answered `[object Array]`, with no own `records` key, on a
 * populated page and an empty one alike.
 *
 * ⚠️ These are six pins, not one pin repeated. A single reading of "the engine
 * returns an array" would say nothing about whether a given seam is even
 * reachable — six of them sit behind a trigger (a truncated page, a refused
 * bulk write, a publish-materializer call path), and a seam nothing reaches is
 * precisely how a dead limb survives review. So each case DRIVES its own block
 * through the real function and asserts the answer that block produced, and
 * {@link assertBareArrayPage} then reads back the value the engine handed it.
 *
 * The seventh seam, `security-plugin.ts`'s `sys_permission_set` loader, is
 * gone: the plugin takes a set's body from the security catalog
 * (ADR-0131 D3/D4) and reads no `sys_permission_set` row, so it has no
 * engine page to pin. Its fault direction (a read that did not answer
 * propagates, and `PermissionEvaluator`'s #2565 warn fires) is pinned on the
 * catalog loader in `security-readers-catalog.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { SysPosition } from './objects/sys-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';
import {
  assertEngineUpdateDispatch,
  assertEngineFindOnePredicate,
  assertEngineDeleteDispatch,
} from '@objectstack/metadata-core';

import { buildExistingByName } from './seed-name-lookup.js';
import { upsertPackagePermissionSet } from './bootstrap-declared-permissions.js';
import { reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { claimSeedOwnership } from './claim-seed-ownership.js';
import { normalizeManagedByVocab } from './normalize-managed-by.js';

const SYS = { context: { isSystem: true } } as any;
const ORG = 'org_a';
const ADMIN = 'usr_admin';

/** A business object with an `owner_id`, so the seed-ownership pass has work. */
const PROBE_OBJECT: any = {
  name: 'probe_deal',
  label: 'Probe Deal',
  fields: {
    id: { type: 'text', label: 'Id', primary: true },
    name: { type: 'text', label: 'Name' },
    owner_id: { type: 'text', label: 'Owner' },
  },
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.find-shape-15598',
    name: 'Find shape',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet,
      SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, PROBE_OBJECT,
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  await (engine as any).insert('sys_organization', { id: ORG, name: ORG }, SYS);
  await (engine as any).insert('sys_user', { id: ADMIN, name: 'admin', email: 'admin@example.test' }, SYS);
  return engine;
}

/** Every `find` result a seam received, in order. */
type Seen = unknown[];

/**
 * The real engine, with `find` OBSERVED — forwarded verbatim, never replaced.
 *
 * A recorder rather than a double, deliberately: the value under test is the one
 * the real engine produced, so anything that answered on its behalf would make
 * every case below a statement about the fixture instead of about `ObjectQL`.
 *
 * ⚠️ It is still a seam, and a seam that merely FORWARDS is exactly the shape
 * that reads as "not a double" and then admits a call the real engine would
 * refuse. So the three dispatch-shaped verbs open with the PRODUCER's own
 * predicates (`check:engine-double-contract`) rather than a hand-mirrored guard.
 */
function observed(engine: any, seen: Seen, extra: Record<string, any> = {}): any {
  return {
    registry: engine.registry,
    registerMiddleware: (...a: any[]) => engine.registerMiddleware?.(...a),
    find: async (o: string, q?: any, opt?: any) => {
      const r = await engine.find(o, q, opt);
      seen.push(r);
      return r;
    },
    findOne: (o: string, q?: any, opt?: any) => {
      assertEngineFindOnePredicate(o, q);
      return engine.findOne(o, q, opt);
    },
    insert: (o: string, d: any, opt?: any) => engine.insert(o, d, opt),
    insertMany: (o: string, d: any, opt?: any) => engine.insertMany?.(o, d, opt),
    update: (o: string, d: any, opt?: any) => {
      assertEngineUpdateDispatch(d, opt);
      return engine.update(o, d, opt);
    },
    delete: (o: string, id: any, opt?: any) => {
      assertEngineDeleteDispatch(opt);
      return engine.delete(o, id, opt);
    },
    ...extra,
  };
}

/**
 * The reading this whole file exists to record: what the engine handed the seam.
 *
 * ⛔ `toBeInstanceOf(Array)` is not enough and `.length` is not enough — the
 * removed limb read `x.records`, so the assertion that retires it has to say
 * the value carries no such key of its own. The element check is the other
 * half: the seventh seam's repair refuses a page carrying a non-row, and a
 * reading that never looked at the elements could not tell that apart.
 */
function assertBareArrayPage(seen: Seen, label: string): void {
  expect(seen.length, `${label}: the seam issued no read at all — nothing was driven`).toBeGreaterThan(0);
  for (const page of seen) {
    expect(Array.isArray(page), `${label}: expected a bare array`).toBe(true);
    expect(Object.prototype.toString.call(page)).toBe('[object Array]');
    expect(
      Object.prototype.hasOwnProperty.call(page as object, 'records'),
      `${label}: the engine answered an ENVELOPE — the removed limb was NOT dead`,
    ).toBe(false);
    for (const row of page as unknown[]) {
      expect(row === null ? 'null' : typeof row).toBe('object');
    }
  }
}

/** A logger that records what a seeder said, so a fallback can be asserted absent. */
function recordingLogger() {
  const warns: string[] = [];
  const infos: string[] = [];
  return {
    warns,
    infos,
    logger: {
      info: (m: string) => { infos.push(m); },
      warn: (m: string) => { warns.push(m); },
      debug: () => { /* noop */ },
      error: (m: string) => { warns.push(m); },
    },
  };
}

describe('[#15598] block 1 — seed-name-lookup readNamePage (the BATCHED page)', () => {
  it('answers from one bare array, so the batched read is live and does not degrade', async () => {
    const engine = await boot();
    await (engine as any).insert(
      'sys_permission_set',
      { name: 'ps_batched', label: 'Batched', managed_by: 'admin', organization_id: ORG },
      SYS,
    );
    const seen: Seen = [];
    const { warns, logger } = recordingLogger();

    const index = await buildExistingByName(
      observed(engine, seen), 'sys_permission_set', ['ps_batched'], logger as any, ORG,
    );
    const found = await index.get('ps_batched');

    assertBareArrayPage(seen, 'readNamePage');
    // The batched page ANSWERED. This is the discriminating half: a normalizer
    // that could not read the page degrades to the per-item oracle, which would
    // still resolve `present` — so the result alone proves nothing here.
    expect(warns.filter((w) => w.includes('falling back to one read per item'))).toEqual([]);
    expect(found.status).toBe('present');
  }, 120_000);
});

describe('[#15598] block 2 — seed-name-lookup perItemIndex (the DEGRADATION read)', () => {
  it('answers from one bare array on the per-item path', async () => {
    const engine = await boot();
    await (engine as any).insert(
      'sys_permission_set',
      { name: 'ps_peritem', label: 'Per item', managed_by: 'admin', organization_id: ORG },
      SYS,
    );
    const seen: Seen = [];
    // TRIGGER ONLY: the batched read is refused so the per-item path is taken.
    // The per-item read itself reaches the real engine untouched — it is the
    // subject, and nothing stands in for it.
    const batchedRefused = observed(engine, seen, {
      find: async (o: string, q?: any, opt?: any) => {
        const name = q?.where?.name;
        if (name && typeof name === 'object' && '$in' in name) throw new Error('batched read refused (trigger)');
        const r = await engine.find(o, q, opt);
        seen.push(r);
        return r;
      },
    });

    const index = await buildExistingByName(batchedRefused, 'sys_permission_set', ['ps_peritem'], undefined, ORG);
    const found = await index.get('ps_peritem');

    assertBareArrayPage(seen, 'perItemIndex');
    // `present`, never `unknown`: a seam that cannot read its page reports the
    // read as un-happened, which is the outcome this pin discriminates against.
    expect(found.status).toBe('present');
  }, 120_000);
});

describe('[#15598] block 3 — bootstrap-declared-permissions defaultLookup', () => {
  it('answers from one bare array on the publish-materializer path', async () => {
    const engine = await boot();
    const seen: Seen = [];

    // No `existingByName` — the ADR-0086 P2 publish materializer path, which is
    // the only caller that reaches `defaultLookup`'s own read.
    const outcome = await upsertPackagePermissionSet(
      observed(engine, seen),
      { name: 'ps_published', label: 'Published', objects: {} } as any,
      'com.acme.crm',
      undefined,
      {} as any,
    );

    assertBareArrayPage(seen, 'defaultLookup');
    // `unreadable` is what a seam that cannot read its page reports, and it is
    // one-hot with `seeded` — so this pair is the discriminator.
    expect(outcome.unreadable).toBe(0);
    expect(outcome.seeded).toBe(1);
  }, 120_000);
});

describe('[#15598] block 4 — auto-org-admin-grant tryFind', () => {
  it('reads the set and the membership out of bare arrays, and grants on them', async () => {
    const engine = await boot();
    // Both reads this reconciler makes are `tryFind`s through the repaired
    // block: the org-admin set it points a grant AT, and the membership that
    // QUALIFIES the pair. Either one reading empty produces `skipped`, so the
    // `granted` verdict below is only reachable when both answered.
    await (engine as any).insert(
      'sys_permission_set',
      { id: 'ps_orgadmin', name: ORGANIZATION_ADMIN_NO_BYPASS, label: 'Org admin', managed_by: 'platform' },
      SYS,
    );
    await (engine as any).insert('sys_member', { user_id: ADMIN, organization_id: ORG, role: 'admin' }, SYS);
    const seen: Seen = [];

    const report = await reconcileOrgAdminGrant(observed(engine, seen), ADMIN, ORG, {} as any);

    assertBareArrayPage(seen, 'auto-org-admin-grant tryFind');
    expect(report.action).toBe('granted');
    const grants = await (engine as any).find('sys_user_permission_set', { where: { user_id: ADMIN } }, SYS);
    expect(grants.length).toBe(1);
  }, 120_000);
});

describe('[#15598] block 5 — claim-seed-ownership idsFrom (the PAGING fallback)', () => {
  it('pages ids out of one bare array and re-owns the row', async () => {
    const engine = await boot();
    await (engine as any).insert('probe_deal', { id: 'd1', name: 'Deal', owner_id: null }, SYS);
    const seen: Seen = [];

    // TRIGGER ONLY: the whole-set write is refused for its per-row-hook budget,
    // which is the sole path that reaches `idsFrom`. Refusing the WRITE keeps
    // the READ — the subject — on the real engine, and costs no 10,000-row
    // fixture to reach the same branch.
    let refuseOnce = true;
    const budgetRefusal = Object.assign(new Error('over the per-row-hook ceiling (trigger)'), {
      code: 'ERR_BULK_PER_ROW_HOOK_LIMIT',
    });
    const io = observed(engine, seen, {
      update: async (o: string, d: any, opt?: any) => {
        assertEngineUpdateDispatch(d, opt);
        if (refuseOnce && opt?.multi && opt?.where) { refuseOnce = false; throw budgetRefusal; }
        return engine.update(o, d, opt);
      },
    });

    await claimSeedOwnership(io, ADMIN, {} as any);

    assertBareArrayPage(seen, 'claim-seed-ownership readPage');
    // Re-owned THROUGH the id page: an `idsFrom` that read nothing stops the
    // pass with "matched no rows to page" and leaves the row unowned.
    const rows = await (engine as any).find('probe_deal', { where: { id: 'd1' } }, SYS);
    expect(rows[0].owner_id).toBe(ADMIN);
  }, 120_000);
});

describe('[#15598] block 6 — normalize-managed-by tryFind', () => {
  it('reads the legacy rows out of one bare array and rewrites them', async () => {
    const engine = await boot();
    await (engine as any).insert('sys_position', { name: 'pos_legacy', label: 'Legacy', managed_by: 'system' }, SYS);
    const seen: Seen = [];

    const counts = await normalizeManagedByVocab(observed(engine, seen), {});

    assertBareArrayPage(seen, 'normalize-managed-by tryFind');
    // The rewrite happened, which it cannot if the scan read nothing.
    expect(counts.positions).toBe(1);
    const rows = await (engine as any).find('sys_position', { where: { name: 'pos_legacy' } }, SYS);
    expect(rows[0].managed_by).toBe('platform');
  }, 120_000);
});
