// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0029 D7 / ADR-0130 — `navigationContributions[].group` semantics,
 * measured across a package boundary (#14454 item 2).
 *
 * ## Why these three, and why they are load-bearing
 *
 * #14122 §4 measured that an app's OWN `navigation` may not name another
 * package's object (rule R3, refused), so a module split converts every such
 * entry into a `navigationContributions` entry owned by the module. hotcrm's
 * split plan converts 17 nav nodes this way, and that conversion preserves the
 * product's information architecture only if all three of these hold:
 *
 *   1. `group` resolves against a group node the TARGET app declares;
 *   2. a contribution into a group that does not exist fails VISIBLY, rather
 *      than vanishing;
 *   3. several packages contributing into one group are ordered by `priority`,
 *      not by registration order.
 *
 * ## What was measured — 1 and 3 hold; 2 does NOT, in a third way
 *
 * ⚠️ Proposition 2 is neither confirmed nor refuted as posed, because the
 * platform does a third thing: a contribution naming a missing group is
 * **relocated to the app's top level**. It does not vanish (so "silent drop",
 * the failure mode the card feared, is not what happens) and it does not fail
 * — no throw, and no refusal was ever added.
 *
 * For the conversion this is the worse half of the two outcomes the card
 * considered. A dropped entry is missing and someone notices; a relocated entry
 * is present, looks fine, and has silently changed the information architecture
 * — which is the exact property the 17-node conversion exists to preserve. A
 * typo'd `group` therefore converts a nested entry into a top-level one.
 *
 * ## What #14553 changed, and what it deliberately did not
 *
 * Maintainer ruling, 2026-09-02 (verbatim: 「同意」) — option B. The
 * RELOCATION is unchanged and its pin below is unchanged with it: the fold
 * stays order-independent (`registerAppNavContribution` still does not require
 * the target app to exist yet) and contributions into optional groups keep
 * working. Option A — refuse at install, with the registration-order rule that
 * implies — was weighed and NOT taken.
 *
 * What inverted is VISIBILITY. Until #14553 the only trace was one
 * `console.log` line emitted by the registry's own `log()`, gated at
 * `logLevel` `info`/`debug`: the shipped default IS `info`, so a default
 * deployment printed it once at boot, while a deployment running at `warn` —
 * which is what `OS_REGISTRY_LOG` exists to select, and what this very
 * package's `vitest.config.ts` selects — emitted NOTHING while its information
 * architecture changed. The trace is now a real diagnostic: an ADR-0038
 * BuildIssue-family record (ADR-0112 D6c — a diagnostics code, lowercase and
 * out of the error ledger) carried on the app via `getAppNavDiagnostics` and
 * announced through `console.warn`, so it survives `OS_REGISTRY_LOG=warn`.
 * The `PROPOSITION 2 (visibility)` pin below is that inversion, asserted at
 * three levels rather than assumed at one.
 *
 * ## The log assertions set `logLevel` explicitly, and must
 *
 * `packages/objectql/vitest.config.ts` sets `OS_REGISTRY_LOG: 'warn'` for the
 * whole package (#13517), which is BELOW the level `log()` writes at. A test
 * that read the default here would observe silence and mis-report it as "the
 * platform emits nothing", when what it actually measured was the harness. So
 * each log reading names the level it is reading at, and the silence at `warn`
 * is asserted as its own case rather than assumed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { SchemaRegistry } from './registry.js';
import { NAV_CONTRIBUTION_GROUP_MISSING } from './nav-contribution-diagnostics.js';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type ManifestService = { register(m: unknown): void | Promise<void> };
type NavItem = { id?: string; type?: string; label?: string; objectName?: string; children?: NavItem[] };

const engineOf = (kernel: ObjectKernel): ObjectQL => kernel.getService<ObjectQL>('objectql');

/** The app-owning package: declares the app and the `sales_group` container. */
const hostPackage = () => ({
  id: 'com.acme.crm',
  name: 'acme_crm',
  version: '1.0.0',
  type: 'app',
  namespace: 'crm',
  objects: [
    { name: 'crm_account', label: 'Account', fields: { name: { name: 'name', label: 'Name', type: 'text' } } },
  ],
  apps: [{
    name: 'crm_app',
    label: 'CRM',
    navigation: [
      {
        id: 'sales_group',
        type: 'group',
        label: 'Sales',
        children: [{ id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' }],
      },
    ],
  }],
});

/**
 * A co-owning module that contributes ONE nav item into the host app.
 *
 * `short` names both the module's own object and its nav item, so a reading of
 * the merged tree can name which package put which entry where.
 */
const contributorPackage = (
  short: string,
  contribution: { group?: string; priority?: number },
) => ({
  id: `com.acme.crm.${short}`,
  name: `acme_crm_${short}`,
  version: '1.0.0',
  type: 'module',
  namespace: 'crm',
  objects: [
    { name: `crm_${short}`, label: short, fields: { note: { name: 'note', label: 'Note', type: 'text' } } },
  ],
  navigationContributions: [{
    app: 'crm_app',
    ...(contribution.group === undefined ? {} : { group: contribution.group }),
    ...(contribution.priority === undefined ? {} : { priority: contribution.priority }),
    items: [{ id: `nav_${short}`, type: 'object', objectName: `crm_${short}`, label: short }],
  }],
});

const artifactOf = (...manifests: unknown[]) => ({ packages: manifests.map((manifest) => ({ manifest })) });

const kernels: ObjectKernel[] = [];

/** Install the host plus contributors as ONE artifact and read the merged app. */
const mergedNav = async (...contributors: unknown[]): Promise<NavItem[]> => {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  kernels.push(kernel);
  await (kernel.getService('manifest') as ManifestService).register(artifactOf(hostPackage(), ...contributors));
  const app = engineOf(kernel).registry.getApp('crm_app') as { navigation?: NavItem[] };
  return app.navigation ?? [];
};

const groupOf = (nav: NavItem[], id: string): NavItem | undefined => nav.find((n) => n.id === id);
const idsOf = (items: NavItem[] | undefined): string[] => (items ?? []).map((i) => i.id ?? '(unnamed)');

afterEach(async () => {
  while (kernels.length) {
    const k = kernels.pop()!;
    if (k.getState() === 'running') await k.shutdown();
  }
});

describe('#14454 item 2 — `navigationContributions[].group` semantics across a package boundary', () => {
  it('PROPOSITION 1 (HOLDS) — `group` resolves against a group node the TARGET app declares', async () => {
    // The module names a group id it does not own and cannot see at authoring
    // time. The merge finds it by depth-first search over the host app's own
    // navigation tree (`findNavGroup`, matching `id` AND `type === 'group'`)
    // and appends into that group's children.
    const nav = await mergedNav(contributorPackage('cpq', { group: 'sales_group' }));

    const group = groupOf(nav, 'sales_group');
    expect(group, 'the host app\'s declared group survived the merge').toBeDefined();
    expect(idsOf(group?.children)).toEqual(['nav_accounts', 'nav_cpq']);
    // …and the contribution did NOT also land at the top level: resolution is
    // placement, not duplication.
    expect(idsOf(nav)).toEqual(['sales_group']);
  });

  it('PROPOSITION 1 (scope) — the id must name a `type: "group"` node, not merely an id that exists', async () => {
    // `findNavGroup` requires both `id` AND `type === 'group'`. An `object`-type
    // nav item sharing the name is NOT a container, so this falls through to
    // the missing-group path measured below. Worth pinning separately: it is
    // the difference between "the group id was wrong" and "the group id named
    // the wrong KIND of node", and both arrive at the same silent relocation.
    const nav = await mergedNav(contributorPackage('cpq', { group: 'nav_accounts' }));

    expect(idsOf(groupOf(nav, 'sales_group')?.children)).toEqual(['nav_accounts']);
    expect(idsOf(nav)).toEqual(['sales_group', 'nav_cpq']);
  });

  it('PROPOSITION 2 (DOES NOT HOLD AS POSED) — a missing group does not vanish and does not fail: it is RELOCATED to the top level', async () => {
    // The card asked whether a contribution into a non-existent group fails
    // VISIBLY rather than vanishing. Measured: neither. `applyNavContributions`
    // appends the items at the app's top level and continues.
    //
    // ⚠️ This is the reading that matters for a 17-node conversion: the entry
    // is PRESENT, so no smoke test misses it, but it sits one level up from
    // where the author put it — the information architecture changed.
    //
    // ⛔ THIS PIN DOES NOT MOVE, and #14553 is the card that says so out loud.
    // The ruling upgraded the TRACE (see the visibility pin) and changed the
    // fold by not one line: refusing here would have introduced the
    // registration-order constraint the read-time fold exists to avoid, and
    // would have broken every package contributing into an OPTIONAL group.
    // If this assertion ever goes red, the fold was changed — not the log.
    const nav = await mergedNav(contributorPackage('cpq', { group: 'group_that_does_not_exist' }));

    // Not dropped…
    expect(idsOf(nav)).toEqual(['sales_group', 'nav_cpq']);
    // …and not placed anywhere near the group it named.
    expect(idsOf(groupOf(nav, 'sales_group')?.children)).toEqual(['nav_accounts']);
  });

  it('PROPOSITION 2 (visibility) — [#14553 INVERTED] the relocation is a warn-level diagnostic, carried on the app; still nothing throws', () => {
    // ⚠️ THIS PIN INVERTED IN #14553 and the direction is the whole point.
    // Before: `logs` held one line at `info` and `warns` was EMPTY at every
    // level, so the assertion `expect(atWarn.warns).toEqual([])` recorded the
    // defect. It now asserts the opposite at the same level, over the same
    // fixture, so the file reads as one continuous measurement rather than as
    // a rewritten expectation.
    //
    // Driven directly on a `SchemaRegistry` rather than through the kernel so
    // the level under test is the one this assertion names — the package's
    // vitest config pins `OS_REGISTRY_LOG=warn` for every registry constructed
    // from the environment (see the file header).
    const read = (level: 'silent' | 'warn' | 'info' | 'debug') => {
      const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
      registry.logLevel = level;
      registry.registerApp(
        { name: 'crm_app', label: 'CRM', navigation: [{ id: 'sales_group', type: 'group', label: 'Sales', children: [] }] },
        'com.acme.crm',
      );
      registry.registerAppNavContribution(
        { app: 'crm_app', group: 'group_that_does_not_exist', items: [{ id: 'nav_cpq', type: 'object', objectName: 'crm_cpq', label: 'cpq' }] },
        'com.acme.crm.cpq',
      );

      const logs: string[] = [];
      const warns: string[] = [];
      const errors: string[] = [];
      const [ol, ow, oe] = [console.log, console.warn, console.error];
      console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
      console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
      console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
      let threw: unknown;
      let app: { navigation?: NavItem[] } | undefined;
      try {
        app = registry.getApp('crm_app') as { navigation?: NavItem[] };
      } catch (e) {
        threw = e;
      } finally {
        console.log = ol; console.warn = ow; console.error = oe;
      }
      return {
        logs, warns, errors, threw,
        nav: app?.navigation ?? [],
        carried: registry.getAppNavDiagnostics('crm_app'),
      };
    };

    // ── The level the card is about ──────────────────────────────────
    // `warn` is what `OS_REGISTRY_LOG` exists to select, what this package's
    // own harness runs at, and what a quiet production boot runs at. It used to
    // emit NOTHING while relocating; it now emits the diagnostic, on the
    // channel an operator filters FOR.
    const atWarn = read('warn');
    expect(atWarn.threw).toBeUndefined();
    expect(atWarn.warns).toHaveLength(1);
    // Every fact the ruling named — the contributing package, the target app,
    // the missing group id, and the relocated items — asserted individually, so
    // a message rewrite that drops one goes red on that one rather than on a
    // whole-string comparison nobody can read.
    expect(atWarn.warns[0]).toContain(NAV_CONTRIBUTION_GROUP_MISSING);
    expect(atWarn.warns[0]).toContain('com.acme.crm.cpq');
    expect(atWarn.warns[0]).toContain('crm_app');
    expect(atWarn.warns[0]).toContain('group_that_does_not_exist');
    expect(atWarn.warns[0]).toContain('nav_cpq');
    expect(atWarn.warns[0]).toContain('RELOCATED');
    // Still not an ERROR and still no throw: a diagnostic was added, a refusal
    // was not. Option A stays untaken, and this is the assertion that says so.
    expect(atWarn.errors).toEqual([]);
    expect(atWarn.logs).toEqual([]);
    // …and the items are exactly where the unchanged fold puts them.
    expect(idsOf(atWarn.nav)).toEqual(['sales_group', 'nav_cpq']);

    // ── Carried on the app, not only printed ─────────────────────────
    // The ruling asked for a diagnostic the app CARRIES, so `os doctor`, a boot
    // report or a test can ask the app what happened to it instead of scraping
    // a log line.
    expect(atWarn.carried).toHaveLength(1);
    expect(atWarn.carried[0]).toMatchObject({
      code: NAV_CONTRIBUTION_GROUP_MISSING,
      severity: 'warning',
      app: 'crm_app',
      packageId: 'com.acme.crm.cpq',
      group: 'group_that_does_not_exist',
      relocated: ['nav_cpq'],
    });

    // ── The shipped default behaves the same ─────────────────────────
    // `info` is BELOW `warn` on the ladder, so a default deployment sees the
    // diagnostic too — once, not once per channel.
    const atInfo = read('info');
    expect(atInfo.threw).toBeUndefined();
    expect(atInfo.warns).toHaveLength(1);
    expect(atInfo.warns[0]).toBe(atWarn.warns[0]);
    expect(atInfo.errors).toEqual([]);

    // ── And silence is still available, without losing the record ────
    // A deployment that asked for silence gets it. The diagnostic is still
    // CARRIED, which is what separates "quiet" from "not measured": muting the
    // log must not destroy the app's own verdict.
    const atSilent = read('silent');
    expect(atSilent.logs).toEqual([]);
    expect(atSilent.warns).toEqual([]);
    expect(atSilent.errors).toEqual([]);
    expect(atSilent.carried).toHaveLength(1);
    expect(idsOf(atSilent.nav)).toEqual(['sales_group', 'nav_cpq']);
  });

  it('[#14553] the diagnostic is emitted ONCE per mis-aim, however many times the app is read', () => {
    // The merge is a READ-time fold — it runs on every `getApp` — so a
    // diagnostic emitted per fold would print once per request. That is the
    // other half of the #12015 discipline: a line that fires on every read is
    // as unreadable as one that never fires, and it would make this diagnostic
    // the thing operators filter OUT.
    //
    // The de-duplication is per REGISTRY, not per process. A module-level memo
    // would make the second registry in a process silent — which is exactly the
    // shape the pin above reads (three fresh registries, same mis-aim each).
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.logLevel = 'warn';
    registry.registerApp(
      { name: 'crm_app', label: 'CRM', navigation: [{ id: 'sales_group', type: 'group', label: 'Sales', children: [] }] },
      'com.acme.crm',
    );
    registry.registerAppNavContribution(
      { app: 'crm_app', group: 'group_that_does_not_exist', items: [{ id: 'nav_cpq', type: 'object', objectName: 'crm_cpq', label: 'cpq' }] },
      'com.acme.crm.cpq',
    );

    const warns: string[] = [];
    const ow = console.warn;
    const capture = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };

    console.warn = capture;
    try {
      registry.getApp('crm_app');
      registry.getApp('crm_app');
      registry.getApp('crm_app');
    } finally {
      console.warn = ow;
    }
    expect(warns).toHaveLength(1);
    // …and the carried record is deduplicated with it, so a long-running
    // process does not accumulate one entry per read of the same app.
    expect(registry.getAppNavDiagnostics('crm_app')).toHaveLength(1);

    // A DIFFERENT mis-aim on the same app is a different finding and speaks —
    // the floor under the de-duplication, without which "once" could be
    // satisfied by a memo that silences everything after the first line.
    registry.registerAppNavContribution(
      { app: 'crm_app', group: 'another_missing_group', items: [{ id: 'nav_quote', type: 'object', objectName: 'crm_quote', label: 'quote' }] },
      'com.acme.crm.quote',
    );
    console.warn = capture;
    try {
      registry.getApp('crm_app');
    } finally {
      console.warn = ow;
    }
    expect(warns).toHaveLength(2);
    expect(registry.getAppNavDiagnostics('crm_app')).toHaveLength(2);
  });

  it('[#14553] a contribution that RESOLVES raises no diagnostic — what is reported is the mis-aim, not the mechanism', () => {
    // The floor under every assertion above. Without it, a diagnostic that
    // fired on EVERY contribution would satisfy all of them, and the platform
    // would have traded a silent relocation for a warning nobody can act on.
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.logLevel = 'warn';
    registry.registerApp(
      { name: 'crm_app', label: 'CRM', navigation: [{ id: 'sales_group', type: 'group', label: 'Sales', children: [] }] },
      'com.acme.crm',
    );
    registry.registerAppNavContribution(
      { app: 'crm_app', group: 'sales_group', items: [{ id: 'nav_cpq', type: 'object', objectName: 'crm_cpq', label: 'cpq' }] },
      'com.acme.crm.cpq',
    );
    // …and a group-LESS contribution, which lands at the top level BY DESIGN
    // and must never be reported as a mis-aim.
    registry.registerAppNavContribution(
      { app: 'crm_app', items: [{ id: 'nav_help', type: 'object', objectName: 'crm_help', label: 'help' }] },
      'com.acme.crm.help',
    );

    const warns: string[] = [];
    const ow = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
    let nav: NavItem[] = [];
    try {
      nav = (registry.getApp('crm_app') as { navigation?: NavItem[] }).navigation ?? [];
    } finally {
      console.warn = ow;
    }

    expect(warns).toEqual([]);
    expect(registry.getAppNavDiagnostics('crm_app')).toEqual([]);
    expect(idsOf(groupOf(nav, 'sales_group')?.children)).toEqual(['nav_cpq']);
    expect(idsOf(nav)).toEqual(['sales_group', 'nav_help']);
  });

  it('PROPOSITION 2 (authoring door) — the authoring gate cannot catch it either: `group` reaches no cross-reference check', async () => {
    // Completes the "visibly?" question across both doors. `group` names a node
    // in an app the contributing package does not own, so there is nothing for
    // `validateCrossReferences` to resolve it against — and indeed
    // `navigationContributions` appears in no cross-reference rule at all. The
    // observable consequence is that a typo'd group id survives BOTH doors: it
    // installs, and it relocates.
    //
    // ⛔ STILL TRUE AFTER #14553, and that is the point of keeping it. The
    // ruling put the diagnostic on the FOLD (where the relocation happens) and
    // on `os build` (where an author sees it first) — not on registration,
    // which by design does not know whether the target app exists yet, let
    // alone which groups it declares. So the install door is as quiet as it
    // ever was, deliberately, and this pin is what would notice a refusal
    // creeping in here.
    //
    // Asserted at the install door, where the consequence is observable: the
    // contribution is recorded verbatim, group id and all, with no diagnostic.
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    kernels.push(kernel);

    await (kernel.getService('manifest') as ManifestService).register(
      artifactOf(hostPackage(), contributorPackage('cpq', { group: 'group_that_does_not_exist' })),
    );

    const recorded = engineOf(kernel).registry.getAppNavContributions('crm_app');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.group).toBe('group_that_does_not_exist');
    expect(recorded[0]?.packageId).toBe('com.acme.crm.cpq');
  });

  it('PROPOSITION 3 (HOLDS) — several packages contributing into one group are ordered by `priority`, not by registration order', async () => {
    // Registration order and priority order are deliberately OPPOSED here: the
    // artifact lists `cpq` (priority 300) before `order` (priority 100), so a
    // merge that honoured arrival would read `nav_cpq, nav_order`. Without the
    // opposition this assertion would pass against a registration-ordered
    // implementation and pin nothing.
    const nav = await mergedNav(
      contributorPackage('cpq', { group: 'sales_group', priority: 300 }),
      contributorPackage('order', { group: 'sales_group', priority: 100 }),
    );

    expect(idsOf(groupOf(nav, 'sales_group')?.children)).toEqual(['nav_accounts', 'nav_order', 'nav_cpq']);
  });

  it('PROPOSITION 3 (tie-break) — equal priorities fall back to registration order, and the default is 200', async () => {
    // The other half of "ordered by priority": what happens when priority does
    // NOT distinguish. `applyNavContributions` sorts with `Array#sort`, stable
    // since ES2019, so ties keep arrival order — which is the sane fallback,
    // but it is a fallback and a module split must not lean on it for IA.
    //
    // `margin` declares no `priority` at all and lands between the explicit 100
    // and 300, which is what pins the schema default of 200 from the merge side.
    const nav = await mergedNav(
      contributorPackage('cpq', { group: 'sales_group', priority: 100 }),
      contributorPackage('order', { group: 'sales_group', priority: 100 }),
      contributorPackage('margin', { group: 'sales_group' }),
      contributorPackage('quote', { group: 'sales_group', priority: 300 }),
    );

    expect(idsOf(groupOf(nav, 'sales_group')?.children))
      .toEqual(['nav_accounts', 'nav_cpq', 'nav_order', 'nav_margin', 'nav_quote']);
  });

  it('merging is a READ-time fold — the stored app is never mutated, so repeated reads are identical', async () => {
    // Why this belongs with the three: the conversion turns 17 owned nav nodes
    // into contributions from several packages, and the merge runs on EVERY
    // read of the app. If the fold mutated the stored app, the second read
    // would show each contribution twice and the IA would drift with traffic
    // rather than with metadata.
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    kernels.push(kernel);
    await (kernel.getService('manifest') as ManifestService).register(
      artifactOf(hostPackage(), contributorPackage('cpq', { group: 'sales_group' })),
    );

    const registry = engineOf(kernel).registry;
    const first = registry.getApp('crm_app') as { navigation?: NavItem[] };
    const second = registry.getApp('crm_app') as { navigation?: NavItem[] };

    expect(idsOf(groupOf(first.navigation ?? [], 'sales_group')?.children)).toEqual(['nav_accounts', 'nav_cpq']);
    expect(idsOf(groupOf(second.navigation ?? [], 'sales_group')?.children)).toEqual(['nav_accounts', 'nav_cpq']);
    // Distinct objects, equal content — a fold over a stored value, not an
    // accumulation into it.
    expect(second).not.toBe(first);
    expect(second.navigation).toEqual(first.navigation);
  });
});
