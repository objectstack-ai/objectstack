// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13419 ruling B, 执行要点 5; #24757] The position-name fold is retired, and
 * its retirement is said out loud.
 *
 * ## What is pinned
 *
 * `resolvePermissionSetsForContextUnmemoized` used to request
 * `[...positions, ...explicitPermissionSets]`, so a POSITION name resolved a
 * same-named PERMISSION SET that the position's definition did not name in
 * `permissionSets`. The maintainer ruling on #13419 (2026-08-31, 「同意」 to B)
 * retires that channel; ADR-0131 D3/D4 make the definition the one binding
 * ("the binding is written, not inferred"); 「甲」 as amended (ruling record
 * 6303865025 on #6015) ships the narrowing in 18.x. 要点 5 requires the
 * difference to be loud — 「任何行为差异只能表现为拒绝/告警,永不静默改变解析结果」 —
 * so the fold's warning now reports a namesake set that is NOT granted. This
 * file pins it in four directions:
 *
 *   - ⛔ the GRANT is gone: a holder of position `P` does not resolve set `P`
 *     unless something declares it (the definition's `permissionSets`, a
 *     direct grant or the baseline), whatever the names;
 *   - the TEXT says the set shares the position's name, that holders are NOT
 *     granted it and why, and the fix (`permissionSets: ['P']`, or a rename);
 *   - the PAYLOAD carries `granted: false` beside its unchanged `event` /
 *     `position` / `permissionSet`, and no other key;
 *   - the TRIGGER and CADENCE: an undeclared pair warns, also for a position
 *     bound to some OTHER set; a declared pair, a baseline name and an inert
 *     position stay silent; once per position, not per request.
 *
 * ## Where the tuples come from
 *
 * The #13419 census (slice 1, merged `2cd0821cf`; its instrument
 * `scripts/measure-position-name-fold-census.mjs` retired with the fold)
 * classified all 19 declared positions into three groups, and the constants
 * below are that classification transcribed. The census called the declared
 * bindings "junction" rows; since ADR-0131 the same pairs are the definitions'
 * `permissionSets`, which reach this resolver as set names in
 * `context.permissions` — the shape every case below feeds.
 *
 * ⚠️ `sales_rep` and `sales_manager` appear in BOTH the namesake list and the
 * binding list: each is bound to `crm_sales_user`, and a set of its own name
 * exists too. A predicate that asked "is this position bound to anything?"
 * would report neither while looking complete.
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
 * The census's `NAME-FOLD DEPENDENCIES` block — the pairs the fold granted with
 * no position definition declaring them. Position half declared by
 * `examples/app-crm/src/security/sales-positions.ts`; permission-set half by the
 * vendored HotCRM artifact.
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
 * No set shares any of their names.
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
 *  which a log consumer may key on, plus the consequence. */
const PAYLOAD_KEYS = ['event', 'granted', 'permissionSet', 'position'];

describe('[#13419] MUST FIRE — a held position whose same-name set exists and is not declared', () => {
  for (const position of CENSUS_NAME_FOLDS) {
    it(`warns for '${position}', the census's own cross_scope pair, and does NOT grant the set`, async () => {
      // The measured shape: the position IS bound — to `crm_sales_user`, not
      // to itself — so `permissions` carries that other set. Nothing declares
      // the same-name set.
      const { sets, events } = await resolveWith({
        userId: 'u1',
        positions: [position],
        permissions: ['crm_sales_user'],
      });

      // Reported once, naming both halves of the pair and the consequence.
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ event: EVENT, position, permissionSet: position, granted: false });

      // ⛔ The retirement itself: the shared name grants nothing. The holder
      // resolves what is declared — its bound set and the baseline — and the
      // same-name set is absent.
      expect(sets.sort()).toEqual(['crm_sales_user', 'member_default'].sort());
    });
  }

  it('carries the consequence as data: the unchanged fields plus granted: false, and no other key', async () => {
    const { events, sets } = await resolveWith({ userId: 'u1', positions: ['sales_rep'], permissions: [] });
    expect(events).toHaveLength(1);
    // Exact keys, so a renamed or dropped legacy field fails here as loudly as
    // a missing consequence field does.
    expect(Object.keys(events[0]).sort()).toEqual(PAYLOAD_KEYS);
    expect(events[0].granted).toBe(false);
    expect(sets).toEqual(['member_default']);
  });

  it('says the set shares the name, that holders are NOT granted it and why, and the fix', async () => {
    const { warn } = await resolveWith({ userId: 'u1', positions: ['sales_rep'], permissions: [] });
    const message = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes(EVENT))!;
    // ① The pair, and that the shared name grants nothing.
    expect(message).toContain(
      "permission set 'sales_rep' shares its name with position 'sales_rep', but holders of position 'sales_rep' are NOT granted it",
    );
    // ② Why: the definition is the binding, and it does not name the set.
    expect(message).toContain('A position grants only the permission sets its definition names in permissionSets');
    expect(message).toContain("the definition of position 'sales_rep' does not name 'sales_rep'");
    // ③ The fix. [ADR-0131 D3/D4] The governed way is the position
    // definition's `permissionSets` — a junction row grants nothing.
    expect(message).toContain("permissionSets: ['sales_rep']");
    expect(message).toMatch(/rename one of the two/);
    expect(message).not.toContain('sys_position_permission_set');
    // The 18.x deprecation wording is gone with the grant it described.
    expect(message).not.toMatch(/next major|deprecated|in force/);
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
    // reporter. No request resolves the same-name set.
    for (let i = 0; i < 3; i++) {
      const sets = await svc.resolvePermissionSetsForContext?.({ userId: `u${i}`, positions: ['sales_rep'] } as any);
      expect((sets ?? []).map((s) => s.name)).not.toContain('sales_rep');
    }
    const reports = warn.mock.calls.filter((c) => String(c[0]).includes(EVENT));
    expect(reports).toHaveLength(1);
    expect(reports[0][1]).toMatchObject({ position: 'sales_rep', granted: false });
  });
});

describe('[#13419] ⛔ MUST NOT FIRE — the census groups the ruling protects', () => {
  it.each(CENSUS_INERT_POSITIONS.map((p) => [p]))(
    'stays silent for the inert position %s (a built-in-identity false positive is the most expensive failure here)',
    async (position) => {
      const { events, sets } = await resolveWith({ userId: 'u1', positions: [position] });
      expect(events).toEqual([]);
      // Silent for the right reason: no set shares the name, and the caller
      // resolves the baseline. A pass produced by a broken resolution would
      // show up here as an empty set list.
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

  it('stays silent once the definition declares the pair (position N: permissionSets: [N]), and grants it', async () => {
    // The fix the warning prescribes, and what objectstack-ai/hotcrm#2200 does
    // for HotCRM's five: the definition's `permissionSets` names the same-name
    // set, so it arrives in `permissions` (§6b) and is granted through the
    // declaration.
    const { events, sets } = await resolveWith({
      userId: 'u1',
      positions: ['sales_rep'],
      permissions: ['sales_rep', 'crm_sales_user'],
    });
    expect(events).toEqual([]);
    expect(sets.sort()).toEqual(['crm_sales_user', 'member_default', 'sales_rep'].sort());
  });

  it('stays silent when the same-name set IS the baseline (granted to every authenticated caller)', async () => {
    const { events } = await resolveWith({ userId: 'u1', positions: ['member_default'] });
    expect(events).toEqual([]);
  });

  it('stays silent for a context with no positions at all', async () => {
    const { events } = await resolveWith({ userId: 'u1', permissions: ['crm_sales_user'] });
    expect(events).toEqual([]);
  });
});
