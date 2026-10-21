// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13419 执行要点 3; #24757 under 「甲」] The position-name fold, said out loud —
 * and, since 18.x, said as the loud half of its retirement.
 *
 * ## What is pinned
 *
 * `resolvePermissionSetsForContextUnmemoized` requests
 * `[...positions, ...explicitPermissionSets]`, so a POSITION name resolves a
 * same-named PERMISSION SET that the position's definition does not name in
 * `permissionSets` (ADR-0131 D3/D4: the definition is the binding). The
 * maintainer ruling on #13419 (2026-08-31, 「同意」 to B) retires the fold; 要点 5
 * permits a warning and nothing else until the fold itself is deleted —
 * 「任何行为差异只能表现为拒绝/告警,永不静默改变解析结果」.
 *
 * The standing ruling 「甲」 (ruling record 6292005854 on #6015) places that
 * deletion in 19.0, because no ADR-0087 conversion can carry it, and ships its
 * loud half in 18.x. This file pins the loud half in four directions:
 *
 *   - the TEXT says the grant is in force only because the names match, that
 *     the name-based grant is removed in the next major version and what
 *     holders lose then, and the fix (`permissionSets: ['P']`, or a rename);
 *   - the PAYLOAD carries the consequence as `removedIn: 'next_major'` beside
 *     its unchanged `event` / `position` / `permissionSet`, and no other key;
 *   - the TRIGGER and CADENCE are unchanged: an undeclared pair warns, also
 *     for a position bound to some OTHER set; a declared pair, a baseline name
 *     and an inert position stay silent; once per position, not per request;
 *   - ⛔ the GRANT is unchanged: the holder still resolves set `P`.
 *
 * ## Where the tuples come from
 *
 * `scripts/measure-position-name-fold-census.mjs` (slice 1, merged `2cd0821cf`)
 * classifies all 19 declared positions into three groups, and the constants
 * below are that classification transcribed. This file pins the runtime
 * PREDICATE against that classification in BOTH directions; the census pins the
 * classification against the repository. Neither substitutes for the other.
 * The census called the declared bindings "junction" rows; since ADR-0131 the
 * same pairs are the definitions' `permissionSets`, which reach this resolver
 * as set names in `context.permissions` — the shape every case below feeds.
 *
 * ⚠️ `sales_rep` and `sales_manager` appear in BOTH the fold list and the
 * binding list, and that is the finding slice 1 exists for: each is bound to
 * `crm_sales_user`, and is folded onto its own same-name set anyway. A
 * predicate that asked "is this position bound to anything?" would report
 * neither of the repository's two real folds while looking complete.
 *
 * ## The expensive failure mode, pinned first
 *
 * ⛔ A false positive on a built-in identity. `platform_admin`, `org_owner`,
 * `org_admin`, `org_member` and `guest` are positions every deployment carries;
 * warning on them would train operators to filter the very token this warning
 * exists to be found by. `org_admin` sits one underscore from the real
 * permission set `organization_admin`, so the near-miss is pinned explicitly
 * rather than assumed.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import type { ISecurityService } from '@objectstack/spec/contracts';

/** The stable event token. Asserted as a LITERAL, never imported: an imported
 *  constant renames itself along with the source and the pin never notices. */
const EVENT = 'position_name_fold_grant';

/**
 * The census's `NAME-FOLD DEPENDENCIES` block — grants in force that no
 * position definition declares. Position half declared by `examples/app-crm/src/security/
 * sales-positions.ts`; permission-set half by the vendored HotCRM artifact.
 */
const CENSUS_NAME_FOLDS = ['sales_rep', 'sales_manager'] as const;

/**
 * The census's `JUNCTION BINDINGS` block — 13 rows, the governed channel
 * (since ADR-0131, the definitions' `permissionSets`). Every one binds a position to a DIFFERENTLY named set, which is why none of them is
 * a fold: the fold is about a position's own name.
 */
const CENSUS_JUNCTION_BINDINGS: ReadonlyArray<readonly [position: string, set: string]> = [
  ['sales_rep', 'crm_sales_user'],
  ['sales_manager', 'crm_sales_user'],
  ['finance_approver', 'crm_sales_user'],
  ['contributor', 'showcase_contributor'],
  ['manager', 'showcase_manager'],
  ['exec', 'showcase_executive'],
  ['auditor', 'showcase_auditor'],
  ['ops', 'showcase_ops'],
  ['field_ops_delegate', 'showcase_field_ops_delegate'],
  ['client_liaison', 'showcase_client_liaison'],
  ['client_portal_user', 'showcase_guest_portal'],
  ['everyone', 'member_default'],
  ['everyone', 'showcase_member_default'],
];

/**
 * The census's `INERT POSITIONS` block, printed under a heading that states the
 * obligation in terms: "要点 3's collision warning must NOT fire on these."
 */
const CENSUS_INERT_POSITIONS = [
  'platform_admin',
  'org_owner',
  'org_admin',
  'org_member',
  'guest',
  'finance',
  'legal',
] as const;

function set(name: string): PermissionSet {
  return { name, label: name, objects: {}, fields: {}, systemPermissions: [], tabPermissions: {} } as any;
}

/**
 * The permission-set universe these cases resolve against: every junction
 * TARGET, the two same-name sets the HotCRM artifact contributes, the platform
 * baseline, and `organization_admin` — the near-miss that must not be credited
 * to the `org_admin` position.
 *
 * ⛔ No set is named after any inert or non-folding position, which is the
 * repository's own state and the reason those positions are inert. The
 * MUST-FIRE cases below are what stop that absence from making the MUST-NOT
 * cases pass trivially: the same universe, the same predicate, two verdicts.
 */
const UNIVERSE: PermissionSet[] = [
  ...new Set([...CENSUS_JUNCTION_BINDINGS.map(([, s]) => s), ...CENSUS_NAME_FOLDS, 'member_default', 'organization_admin']),
].map(set);

function boot(universe: PermissionSet[] = UNIVERSE) {
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: () => null,
    find: async () => [],
  };
  const metadata: any = { get: async () => null, list: async () => universe };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const warn = vi.fn();
  const ctx: any = {
    logger: { info: vi.fn(), warn, error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  return { plugin: new SecurityPlugin({ fallbackPermissionSet: 'member_default' } as any), ctx, warn };
}

/** Resolve through the registered service handle, as every real consumer does. */
async function resolveWith(context: Record<string, unknown>, universe: PermissionSet[] = UNIVERSE) {
  const { plugin, ctx, warn } = boot(universe);
  await plugin.init(ctx);
  await plugin.start(ctx);
  const svc = ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1] as Partial<ISecurityService>;
  const sets = await svc.resolvePermissionSetsForContext?.(context as any);
  const events = warn.mock.calls
    .filter((c) => typeof c[0] === 'string' && c[0].includes(EVENT))
    .map((c) => c[1]);
  return { sets: (sets ?? []).map((s) => s.name), events, warn, svc };
}

/** Every key the structured report carries — the three it has always carried,
 *  which a log consumer may key on, plus the retirement (「甲」, 18.x). */
const PAYLOAD_KEYS = ['event', 'permissionSet', 'position', 'removedIn'];

describe('[#13419] MUST FIRE — a position folded onto its own same-name set that its definition does not name', () => {
  for (const position of CENSUS_NAME_FOLDS) {
    it(`warns for '${position}', the census's own cross_scope fold, and still grants the set`, async () => {
      // The measured shape: the position IS bound — to `crm_sales_user`, not
      // to itself — so `permissions` carries that other set. The grant on the
      // same-name set has no declaration behind it at all.
      const { sets, events } = await resolveWith({
        userId: 'u1',
        positions: [position],
        permissions: ['crm_sales_user'],
      });

      // Reported once, naming both halves of the pair and the retirement.
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ event: EVENT, position, permissionSet: position, removedIn: 'next_major' });

      // ⛔ Purely additive: the fold still grants exactly what it granted before.
      // 「甲」 moves the removal to 19.0, so in 18.x the holder still resolves
      // set `P`. A warning that also changed the answer would be the silent
      // behaviour change 要点 5 forbids.
      expect(sets.sort()).toEqual(['crm_sales_user', 'member_default', position].sort());
    });
  }

  it('carries the consequence as data: the unchanged fields plus removedIn, and no other key', async () => {
    const { events, sets } = await resolveWith({ userId: 'u1', positions: ['sales_rep'], permissions: [] });
    expect(events).toHaveLength(1);
    // Exact keys, so a renamed or dropped legacy field fails here as loudly as
    // a missing retirement field does.
    expect(Object.keys(events[0]).sort()).toEqual(PAYLOAD_KEYS);
    expect(events[0].removedIn).toBe('next_major');
    expect(sets.sort()).toEqual(['member_default', 'sales_rep'].sort());
  });

  it('says why the grant is in force, that it is removed in the next major and what holders lose, and the fix', async () => {
    const { warn } = await resolveWith({ userId: 'u1', positions: ['sales_rep'], permissions: [] });
    const message = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes(EVENT))!;
    // ① In force today only because the names match.
    expect(message).toContain(
      "permission set 'sales_rep' is in force for holders of position 'sales_rep' only because the two share a name",
    );
    // ② Deprecated, removed in the next major, and what holders lose then.
    expect(message).toContain('This name-based grant is deprecated and is removed in the next major version');
    expect(message).toContain(
      "holders of position 'sales_rep' do not receive permission set 'sales_rep' unless the position's definition names it",
    );
    // ③ The fix. [ADR-0131 D3/D4] The governed way out is the position
    // definition's `permissionSets` — a junction row no longer grants or
    // governs anything.
    expect(message).toContain("permissionSets: ['sales_rep']");
    expect(message).toMatch(/rename one of the two/);
    expect(message).not.toContain('sys_position_permission_set');
    // An operator reading the log has no tracker to resolve an issue id against.
    expect(message).not.toMatch(/#\d/);
  });

  it('is LOUD ONCE per position, not once per request', async () => {
    const { plugin, ctx, warn } = boot();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const svc = ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1] as Partial<ISecurityService>;
    // Distinct context OBJECTS, so the per-context memo cannot be what silences
    // the second call — the deduplication under test has to be the one in the
    // reporter. Each request still resolves the same-name set.
    for (let i = 0; i < 3; i++) {
      const sets = await svc.resolvePermissionSetsForContext?.({ userId: `u${i}`, positions: ['sales_rep'] } as any);
      expect((sets ?? []).map((s) => s.name)).toContain('sales_rep');
    }
    const reports = warn.mock.calls.filter((c) => String(c[0]).includes(EVENT));
    expect(reports).toHaveLength(1);
    expect(reports[0][1]).toMatchObject({ position: 'sales_rep', removedIn: 'next_major' });
  });
});

describe('[#13419] ⛔ MUST NOT FIRE — the census groups the ruling protects', () => {
  it.each(CENSUS_INERT_POSITIONS.map((p) => [p]))(
    'stays silent for the inert position %s (a built-in-identity false positive is the most expensive failure here)',
    async (position) => {
      const { events, sets } = await resolveWith({ userId: 'u1', positions: [position] });
      expect(events).toEqual([]);
      // Silent for the right reason: nothing resolved off the position name, so
      // the caller fell back to the baseline. A pass produced by a broken
      // resolution would show up here as an empty set list.
      expect(sets).toEqual(['member_default']);
    },
  );

  it('stays silent for org_admin even though the set organization_admin exists (near-miss, not a collision)', async () => {
    const { events } = await resolveWith({ userId: 'u1', positions: ['org_admin'] });
    expect(events).toEqual([]);
  });

  it.each(CENSUS_JUNCTION_BINDINGS.map(([p, s]) => [p, s]))(
    'stays silent for the junction binding %s -> %s',
    async (position, boundSet) => {
      const { events } = await resolveWith({ userId: 'u1', positions: [position], permissions: [boundSet] });
      // ⚠️ `sales_rep` and `sales_manager` are in this list too, and they DO
      // warn — above, on their own name. What is pinned here is that binding a
      // position to some other set never warns ABOUT THAT BINDING: the reported
      // pair is always (position N, set N).
      expect(events.map((e: any) => e.position)).not.toContain(boundSet);
      if (!(CENSUS_NAME_FOLDS as readonly string[]).includes(position)) expect(events).toEqual([]);
    },
  );

  it('stays silent once the definition declares the pair (position N: permissionSets: [N])', async () => {
    // The fix the warning prescribes, and what objectstack-ai/hotcrm#2200 does
    // for HotCRM's five: the definition's `permissionSets` names the same-name
    // set, so it arrives in `permissions` (§6b) and the grant no longer depends
    // on the fold. This is the forward pin: a declared pair is silent without a
    // second edit here.
    const { events, sets } = await resolveWith({
      userId: 'u1',
      positions: ['sales_rep'],
      permissions: ['sales_rep', 'crm_sales_user'],
    });
    expect(events).toEqual([]);
    expect(sets.sort()).toEqual(['crm_sales_user', 'member_default', 'sales_rep'].sort());
  });

  it('stays silent when the same-name set IS the baseline (in force with or without the fold)', async () => {
    const { events } = await resolveWith({ userId: 'u1', positions: ['member_default'] });
    expect(events).toEqual([]);
  });

  it('stays silent for a context with no positions at all', async () => {
    const { events } = await resolveWith({ userId: 'u1', permissions: ['crm_sales_user'] });
    expect(events).toEqual([]);
  });
});
