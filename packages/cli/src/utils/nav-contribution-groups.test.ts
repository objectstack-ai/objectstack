// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14553 — `os build`'s compile-time half: a `navigationContributions[].group`
 * that names no group in an app the SAME artifact ships.
 *
 * ## What this file measures, and against what
 *
 * The maintainer ruled (2026-09-02, verbatim 「同意」) that the runtime keeps
 * relocating such a contribution to the app's top level and says so at `warn`,
 * and that `os build` reports the same finding at compile time "where an AI
 * author sees it first". The runtime half is pinned in
 * `packages/objectql/src/registry-nav-contribution-group-semantics.test.ts`;
 * this file is the build half.
 *
 * The inputs run through the REAL `composeStacks(…, { manifest: 'preserve' })`
 * rather than a hand-written artifact literal, because the whole question is
 * what a COMPOSED artifact looks like — a literal would pin this check against
 * a shape nothing produces, and would go on passing the day composition
 * changes. They mirror `examples/app-multi-package`, which is the fixture the
 * ruling names, including its two deliberate properties (the module is listed
 * first; it declares `dependencies` on the app package).
 *
 * ⚠️ MIRRORED, not imported. `packages/metadata`'s artifact-attribution suite
 * takes the same approach for the same example and states the reason: a test
 * reaching outside its own package for a fixture is invisible to
 * `turbo ls --affected` and to the `test` task's input hashing unless it is
 * spelled the way `check:cross-package-test-inputs` recognises, and the shape
 * under test here is three keys deep. The example is edited in the same PR to
 * carry the correct spelling, so the fixture below and the example agree by
 * construction; what this file pins is the DERIVATION, and `sales_group` /
 * `multi_crm` are named identically in both so a reader can diff them by eye.
 *
 * ## Why the typo is applied to the composed artifact and not authored twice
 *
 * Both legs compose from ONE pair of stacks and differ in a single character
 * position — the `group` id — so nothing else can drift between the clean and
 * the typo'd reading. A second hand-authored fixture would be a second thing to
 * keep in sync, and a divergence in it would read as a finding.
 */

// [#7668 family, `check:test-source-alias`] A MODULE-TOP side-effect load of
// the dependency `findNavGroupDiagnostics` imports dynamically. This package
// resolves `@objectstack/objectql/core` through its `dist/`, so the first call
// transforms that whole module graph — measured here at over vitest's 5s
// default, inside a test body, which is a CLOCKED window. Paying it during
// COLLECTION (which vitest clocks against nothing) is the convention: clocked
// windows measure behaviour, never loading. ⛔ Do not "fix" a timeout here by
// widening it — that relocates the cliff to the next heavier shard.
//
// The production import stays lazy and stays where it is: this line decides
// only WHERE the first load is paid in THIS suite, and `os build`'s cold path
// must not pull the data engine in to judge a stack with no contributions.
import '@objectstack/objectql/core';
import { describe, it, expect } from 'vitest';
import { composeStacks, normalizeStackInput, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { collectNavGroupInputs, findNavGroupDiagnostics } from './nav-contribution-groups.js';

type AnyRec = Record<string, unknown>;

const APP = 'multi_crm';
const GROUP = 'sales_group';
const CORE_ID = 'com.example.multi.core';
const ORDERS_ID = 'com.example.multi.orders';

/** The App package — owns the app and the group container modules aim at. */
const coreStack = () => ({
  manifest: {
    id: CORE_ID,
    name: 'Multi-Package Core',
    namespace: 'crm',
    version: '1.0.0',
    type: 'app' as const,
  },
  objects: [{
    name: 'crm_account',
    label: 'Account',
    sharingModel: 'private' as const,
    fields: { name: { name: 'name', type: 'text' as const, label: 'Account Name', required: true } },
  }],
  apps: [{
    name: APP,
    label: 'Multi-Package CRM',
    navigation: [{
      id: GROUP,
      type: 'group' as const,
      label: 'Sales',
      children: [{ id: 'nav_accounts', type: 'object' as const, objectName: 'crm_account', label: 'Accounts' }],
    }],
  }],
});

/** The Module package — contributes into the App package's group. */
const ordersStack = (group: string) => ({
  manifest: {
    id: ORDERS_ID,
    name: 'Multi-Package Orders',
    namespace: 'crm',
    version: '1.0.0',
    type: 'module' as const,
    dependencies: { [CORE_ID]: '^1.0.0' },
    navigationContributions: [{
      app: APP,
      group,
      items: [{ id: 'nav_orders', type: 'object' as const, objectName: 'crm_order', label: 'Orders' }],
    }],
  },
  objects: [{
    name: 'crm_order',
    label: 'Order',
    sharingModel: 'private' as const,
    fields: { name: { name: 'name', type: 'text' as const, label: 'Order Number', required: true } },
  }],
});

/** Compose exactly as `examples/app-multi-package/objectstack.config.ts` does. */
const artifact = (group: string): AnyRec =>
  composeStacks([ordersStack(group), coreStack()], { manifest: 'preserve' }) as unknown as AnyRec;

/**
 * The composed artifact as `compile.ts` actually hands it to this check —
 * through the SAME `normalizeStackInput` + `ObjectStackDefinitionSchema`
 * parse the command runs, and `result.data` is the object it passes.
 *
 * ⚠️ Load-bearing, and the one thing a raw `composeStacks` reading cannot
 * establish. The check walks `parsed.packages[].manifest`, and if the parse
 * reshaped, renamed or dropped any part of that path the derivation would
 * silently see an empty artifact — reporting nothing, which is
 * indistinguishable from a clean stack. This is asserted rather than assumed
 * because the alternative was a 57-package build of the CLI's dependency
 * closure to spawn one `os build`.
 */
const parsedArtifact = (group: string): AnyRec => {
  const normalized = normalizeStackInput(artifact(group) as Record<string, unknown>, {
    onConversionNotice: () => {},
  });
  const result = ObjectStackDefinitionSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(`fixture does not parse: ${JSON.stringify(result.error.issues.slice(0, 3))}`);
  }
  return result.data as unknown as AnyRec;
};

/** The artifact's packages, in the `{ index, id, body }` shape `compile.ts` walks. */
const packagesOf = (parsed: AnyRec) =>
  ((parsed.packages ?? []) as Array<{ manifest?: AnyRec }>).map((entry, index) => {
    const body = (entry.manifest ?? {}) as AnyRec;
    const id = typeof body.id === 'string' && body.id !== ''
      ? body.id
      : (typeof body.name === 'string' ? body.name : `packages[${index}]`);
    return { id, body };
  });

describe('#14553 — `os build` checks `navigationContributions[].group` across one composed artifact', () => {
  it('the fixture really is a two-package artifact — the floor under every reading below', async () => {
    // Without this, a composition change that stopped emitting `packages[]`
    // would make every assertion in this file vacuously true: the derivation
    // would see no contributions and report nothing, which is also what "clean"
    // looks like. Asserted first, and on the CLEAN leg, so the file cannot go
    // green by measuring an empty artifact.
    const parsed = artifact(GROUP);
    const packages = packagesOf(parsed);
    expect(packages.map((p) => p.id).sort()).toEqual([CORE_ID, ORDERS_ID]);

    const { apps, contributions } = collectNavGroupInputs(parsed, packages);
    expect(apps.map((a) => a.name)).toContain(APP);
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({ app: APP, group: GROUP, packageId: ORDERS_ID });
  });

  it('the correctly spelled group id reports NOTHING', async () => {
    expect(await findNavGroupDiagnostics(artifact(GROUP), packagesOf(artifact(GROUP)))).toEqual([]);
  });

  it('ONE typo\'d group id prints one diagnostic naming the package, the app, the group and the items', async () => {
    const parsed = artifact('sales_grp');
    const found = await findNavGroupDiagnostics(parsed, packagesOf(parsed));

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: 'nav_contribution_group_missing',
      severity: 'warning',
      app: APP,
      packageId: ORDERS_ID,
      group: 'sales_grp',
      relocated: ['nav_orders'],
    });
    // The four facts the ruling required, in the printed text — this is the
    // string an author actually reads, and `severity: 'warning'` is what says
    // the build still succeeds.
    expect(found[0].message).toContain(ORDERS_ID);
    expect(found[0].message).toContain(APP);
    expect(found[0].message).toContain('sales_grp');
    expect(found[0].message).toContain('nav_orders');
    expect(found[0].fix).toContain('sales_grp');
  });

  it('reports the mis-aim ONCE, not once per surface the composed artifact carries it on', async () => {
    // `manifest: 'preserve'` is ADDITIVE: it flattens every collection to the
    // top level AND still picks a singular `manifest` by the default `'last'`
    // rule. So the contribution is reachable twice in a composed artifact —
    // once under `packages[]`, once under the picked top-level manifest — and a
    // walk that read both would report the same author error twice, the second
    // time with no package id to act on.
    const parsed = artifact('sales_grp');
    expect(await findNavGroupDiagnostics(parsed, packagesOf(parsed))).toHaveLength(1);
  });

  it('a contribution into an app NO package here ships is not a finding — the cross-artifact case stays supported', async () => {
    // The bound that keeps this a report rather than option A. A package may
    // legally contribute into an app shipped by a different artifact installed
    // separately — that is precisely why the merge is a read-time fold — so the
    // only mis-aims a build can judge are the ones it can see both halves of.
    const parsed = artifact(GROUP);
    (parsed as AnyRec).packages = ((parsed.packages ?? []) as unknown[]).slice();
    const orders = ordersStack(GROUP);
    const found = await findNavGroupDiagnostics(
      { packages: [] },
      [{ id: ORDERS_ID, body: { ...orders.manifest } as AnyRec }],
    );
    expect(found).toEqual([]);
  });

  it('a SINGLE-package stack is judged too — the same defect, without an artifact', async () => {
    // `packages[]` is absent from an ordinary `defineStack` project, so the
    // artifact walk skips it entirely. A stack that declares an app and
    // contributes into it has the identical mis-aim, and the top-level manifest
    // is where its contributions live.
    const single: AnyRec = {
      manifest: {
        id: 'com.example.single',
        name: 'Single',
        navigationContributions: [{
          app: APP,
          group: 'sales_grp',
          items: [{ id: 'nav_orders', type: 'object' as const, objectName: 'crm_order', label: 'Orders' }],
        }],
      },
      apps: coreStack().apps,
    };
    const found = await findNavGroupDiagnostics(single, []);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ app: APP, group: 'sales_grp', packageId: 'com.example.single' });
  });

  it('survives the command\'s own parse — what `compile.ts` passes in is what this reads', async () => {
    // The end-to-end statement this file can make without spawning the CLI:
    // run the fixture through the real `normalizeStackInput` +
    // `ObjectStackDefinitionSchema` chain `os build` runs, hand `result.data`
    // to the derivation exactly as the command does, and require the SAME
    // finding the raw composed object produces.
    //
    // Both directions matter. The typo'd leg proves the parse does not hide the
    // path this check walks; the clean leg proves it does not invent findings.
    const typod = parsedArtifact('sales_grp');
    const found = await findNavGroupDiagnostics(typod, packagesOf(typod));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ app: APP, packageId: ORDERS_ID, group: 'sales_grp', relocated: ['nav_orders'] });

    const clean = parsedArtifact(GROUP);
    expect(packagesOf(clean).map((pkg) => pkg.id).sort()).toEqual([CORE_ID, ORDERS_ID]);
    expect(await findNavGroupDiagnostics(clean, packagesOf(clean))).toEqual([]);
  });

  it('naming an id that exists but is not a `type: "group"` node reaches the same diagnostic', async () => {
    // `findNavGroup` requires BOTH `id` and `type === 'group'`, so pointing at
    // the app's `nav_accounts` object entry is the same authoring error as
    // pointing at nothing — and the build must not let the near-miss through
    // just because the id resolves to something.
    const parsed = artifact('nav_accounts');
    const found = await findNavGroupDiagnostics(parsed, packagesOf(parsed));
    expect(found).toHaveLength(1);
    expect(found[0].group).toBe('nav_accounts');
  });
});
