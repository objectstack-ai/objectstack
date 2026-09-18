// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18778 — `os lint` is the THIRD door that ran the author-time rule table over
 * the union fold and stopped, and #18677's table called the asymmetry 1 of 2.
 *
 * `os build` has run the table a second time, once per `artifactPackages(…)`
 * entry with `packageBodyAsStack(…)` as resolution context, since #16611;
 * `os validate` joined it in #18677. `os lint` did not, so every survivor of
 * that de-duplication was a finding `os build` reported and `os lint`
 * structurally could not — FALSE-CLEAN, on the fastest of the three doors.
 *
 * ⚠️ [#18779] This header used to size that set by quoting `compile.ts` step
 * 3b-ii — "exactly the set the union could not see" — and the sentence was
 * false when it was quoted: the de-duplication key carried the POSITIONAL
 * `path`, so echoes of union findings survived it. The key was corrected
 * there. The fixture below is unaffected and is the reason why: it raises a
 * finding the union genuinely cannot produce, ⛔ not an echo.
 *
 * ## ⭐ Why symbol presence scored this door as covered
 *
 * `lint.ts` DOES import `artifactPackages` and `packageBodyAsStack`. Opening
 * the hits is what settles it: they feed `os lint`'s OWN intra-package
 * duplicate-name advisory (#17821), never the shared rule table. ⛔ A count is
 * not a reading, and the last case in this file is the ratchet that keeps the
 * distinction mechanical at this door — the sibling doors get it for free from
 * `validate-per-package-authoring-seam.test.ts`' "names it at all" assertion,
 * which ⛔ cannot be transplanted here, because this door legitimately names the
 * seam once.
 *
 * ## What this file pins, and what its sibling pins
 *
 * This one is the SEAM plus the in-process verdict: the pass exists once, all
 * THREE doors reach it, it answers the same for each, and `lintConfig` now
 * reports what the union could not see. It spawns nothing and boots no kernel,
 * so it is UNIT tier (`packages/cli/vitest-tiers.ts`).
 * `lint-per-package-authoring-parity.test.ts` is the behavioural half — the
 * real binaries, and the `--strict` EXIT the in-process function cannot reach —
 * and lands in the INTEGRATION tier because it spawns the CLI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineStack, composeStacks } from '@objectstack/spec';
import { artifactPackages, runPerPackageAuthoringRules } from '../src/utils/artifact-packages.js';
import { lintConfig } from '../src/commands/lint.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMANDS = resolve(HERE, '../src/commands');
const sourceOf = (file: string) => readFileSync(join(COMMANDS, file), 'utf8');

/** All three doors of the one wall (`@objectstack/lint`'s `authoring-rules.ts`). */
const DOORS = ['compile.ts', 'validate.ts', 'lint.ts'] as const;

/** The `where` prefix `runPerPackageAuthoringRules` owns. */
const PER_PACKAGE = /^package '[^']+' — /;

/**
 * A two-package artifact whose union run is CLEAN of the finding its
 * per-package run raises.
 *
 * The `core` package owns `pp_account`; the `orders` package owns the view that
 * displays `pp_account.industry`. Judged as one flattened union the field has a
 * consumer and `field-no-consumers` says nothing; judged per package, `core`
 * declares a field nothing IN CORE reads. That is ⛔ not an echo of a union
 * finding — the union produced no such finding at all — which is the only
 * shape that can falsify this card, and the reason this fixture is not the
 * sibling file's.
 *
 * [#18779] It is also the positive control for the corrected de-duplication
 * key: a key that stopped discriminating would swallow this finding too, and
 * this file goes red. The echo the corrected key DOES remove is pinned in
 * `per-package-dedup-positional-echo.test.ts`, on a fixture built the other
 * way round.
 */
function twoPackageArtifact(): Record<string, unknown> {
  const core = defineStack({
    manifest: {
      id: 'com.example.lintseam.core',
      name: 'Lint Seam Core',
      namespace: 'pp',
      version: '1.0.0',
      type: 'app',
      engines: { protocol: '^17' },
    },
    objects: [
      {
        name: 'pp_account',
        label: 'Account',
        pluralLabel: 'Accounts',
        sharingModel: 'private',
        fields: {
          name: { name: 'name', type: 'text', label: 'Account Name', required: true },
          industry: { name: 'industry', type: 'text', label: 'Industry' },
        },
      },
    ],
    apps: [
      {
        name: 'pp_crm',
        label: 'PP CRM',
        navigation: [
          {
            id: 'sales_group',
            type: 'group',
            label: 'Sales',
            children: [{ id: 'nav_accounts', type: 'object', objectName: 'pp_account', label: 'Accounts' }],
          },
        ],
      },
    ],
  });
  const orders = defineStack({
    manifest: {
      id: 'com.example.lintseam.orders',
      name: 'Lint Seam Orders',
      namespace: 'pp',
      version: '1.0.0',
      type: 'module',
      engines: { protocol: '^17' },
      dependencies: { 'com.example.lintseam.core': '^1.0.0' },
    },
    objects: [
      {
        name: 'pp_order',
        label: 'Order',
        pluralLabel: 'Orders',
        sharingModel: 'private',
        fields: {
          name: { name: 'name', type: 'text', label: 'Order Number', required: true },
          account: { name: 'account', type: 'lookup', label: 'Account', reference: 'pp_account' },
        },
      },
    ],
    views: [
      {
        name: 'pp_account_list',
        label: 'Account List',
        object: 'pp_account',
        list: { label: 'Account List', columns: ['name', 'industry'] },
      },
      {
        name: 'pp_order_list',
        label: 'Order List',
        object: 'pp_order',
        list: { label: 'Order List', columns: ['name', 'account'] },
      },
    ],
  });
  return composeStacks([orders, core], { manifest: 'preserve' }) as unknown as Record<string, unknown>;
}

/** The same metadata as ONE package — no `packages[]`, so the pass is skipped. */
function singlePackageStack(): Record<string, unknown> {
  return defineStack({
    manifest: {
      id: 'com.example.lintseam.single',
      name: 'Lint Seam Single',
      namespace: 'ps',
      version: '1.0.0',
      type: 'app',
      engines: { protocol: '^17' },
    },
    objects: [
      {
        name: 'ps_thing',
        label: 'Thing',
        pluralLabel: 'Things',
        sharingModel: 'private',
        fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
      },
    ],
  }) as unknown as Record<string, unknown>;
}

describe('#18778 — the per-package author-time pass is ONE seam all THREE doors reach', () => {
  it('all three authoring commands CALL the shared pass', () => {
    for (const door of DOORS) {
      expect(
        sourceOf(door),
        `${door} must run the per-package author-time pass — its absence is the #18677/#18778 ` +
          `false-clean gap, and the door it is absent from is the bar the whole wall is held to`,
      ).toMatch(/\brunPerPackageAuthoringRules\s*\(/);
    }
  });

  it('the pass answers IDENTICALLY for all three doors — same survivors, same order', () => {
    // Every gating entry in the registry is `commands: ALL`, so a door-dependent
    // answer here would mean the three commands hold one artifact to three bars.
    // #18677 pinned this for two doors; the third is the card.
    const parsed = twoPackageArtifact();
    expect(artifactPackages(parsed).length, 'fixture must carry `packages[]`').toBe(2);

    const forDoor = (command: 'build' | 'validate' | 'lint') =>
      runPerPackageAuthoringRules({ command, parsed, unionFindings: [] });

    const build = forDoor('build');
    for (const command of ['validate', 'lint'] as const) {
      const other = forDoor(command);
      expect(other.packageCount, `${command} walked a different package count`).toBe(build.packageCount);
      expect(other.findings, `${command} produced a different finding list`).toEqual(build.findings);
      expect(other.errors).toEqual(build.errors);
      expect(other.advisories).toEqual(build.advisories);
    }
  });

  it('`findings` is the SAME set as `errors` ∪ `advisories`, in walk order', () => {
    // The member `os lint` reads. It must be the one loop's output and not a
    // second computation: a `findings` that could differ from the split is a
    // door-dependent verdict wearing one function's name.
    const run = runPerPackageAuthoringRules({
      command: 'lint',
      parsed: twoPackageArtifact(),
      unionFindings: [],
    });
    expect(run.findings.length, 'NON-VACUITY — the pass produced nothing on this fixture').toBeGreaterThan(0);
    expect(run.findings.length).toBe(run.errors.length + run.advisories.length);
    expect(run.findings.every((f) => PER_PACKAGE.test(f.where))).toBe(true);
    // Every split member is a findings member, compared on the finding itself —
    // `errors` carries the extra `package` key the two artifact doors render.
    const flat = new Set(run.findings.map((f) => JSON.stringify(f)));
    for (const a of run.advisories) expect(flat.has(JSON.stringify(a))).toBe(true);
    for (const { package: _pkg, ...e } of run.errors) expect(flat.has(JSON.stringify(e))).toBe(true);
  });

  it('`os lint` now reports a finding the union run could NOT see', () => {
    // The card, measured in process. Before this change `lintConfig` returned
    // ZERO issues carrying the per-package prefix on this fixture, and the
    // `industry` finding appeared on NEITHER face — the union cannot see it and
    // `os lint` did not run the leg that can.
    const issues = lintConfig(twoPackageArtifact());
    const perPackage = issues.filter((i) => PER_PACKAGE.test(i.message));
    expect(
      perPackage.map((i) => i.rule),
      'os lint reported no per-package finding at all — the #18778 gap',
    ).toContain('field-no-consumers');

    // …and it is a survivor, not an echo: the union run raised nothing about
    // this field, which is what makes the fixture a falsifier rather than a
    // duplicate counter.
    const industry = (i: { rule: string; message: string }) =>
      i.rule === 'field-no-consumers' && i.message.includes('"industry"');
    expect(issues.filter((i) => industry(i) && !PER_PACKAGE.test(i.message))).toEqual([]);
    expect(issues.filter((i) => industry(i) && PER_PACKAGE.test(i.message)).length).toBe(1);
  });

  it('CONTROL — a single-package stack raises no per-package finding through `os lint`', () => {
    // "Present" must be distinguishable from "always present". A stack with no
    // `packages[]` is one package by definition: the union run judged it whole,
    // the pass is skipped, and `packageCount` says so.
    const single = singlePackageStack();
    const run = runPerPackageAuthoringRules({ command: 'lint', parsed: single, unionFindings: [] });
    expect(run.packageCount).toBe(0);
    expect(run.findings).toEqual([]);
    expect(lintConfig(single).filter((i) => PER_PACKAGE.test(i.message))).toEqual([]);
  });

  it('⛔ `lint.ts` names `packageBodyAsStack` exactly ONCE — a second call IS a second loop', () => {
    // The sibling file asserts the two artifact doors name this seam NEVER.
    // ⛔ That assertion cannot be transplanted: this door legitimately calls it,
    // for the #17821 intra-package duplicate-name advisory, which is `os lint`'s
    // OWN rubric. So the ratchet here is the COUNT — and the reason it is worth
    // a case of its own is that this file is the one place in the tree where
    // "the loop is already written here, write the second one beside it" is the
    // cheap move. What drifts between two hand-written loops is the VERDICT (the
    // de-duplication key, the severity split, the `where` prefix), never the
    // package reading — `utils/artifact-packages.ts`' header forbids it by name.
    const calls = sourceOf('lint.ts').replace(/`packageBodyAsStack`/g, '').match(/\bpackageBodyAsStack\s*\(/g) ?? [];
    expect(
      calls.length,
      `lint.ts calls packageBodyAsStack ${calls.length} time(s). Exactly one is sanctioned — the ` +
        `#17821 duplicate-name advisory. A second call means the shared rule table is being walked ` +
        `by a loop this file wrote instead of by runPerPackageAuthoringRules().`,
    ).toBe(1);
  });
});
