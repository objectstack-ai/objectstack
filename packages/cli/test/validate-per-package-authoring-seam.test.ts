// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18677 — `os build` ran the author-time rule table a SECOND time, once per
 * `artifactPackages(…)` entry with `packageBodyAsStack(…)` as resolution
 * context; `os validate` ran the union fold and stopped, so every survivor of
 * that de-duplication was a finding `os build` reported and `os validate`
 * structurally could not. FALSE-CLEAN, on the command an author runs BEFORE
 * shipping — the same direction #17069 fixed one layer up, which is why
 * `authoringRuleUnionStack` landing in both commands did not settle it.
 *
 * ⚠️ [#18779] This header used to size that set by quoting `compile.ts` —
 * "exactly the set the union could not see" — and the sentence was false when
 * it was quoted: the key carried the POSITIONAL `path`, so echoes survived it.
 * The key was corrected there; the seam this file pins is unaffected.
 *
 * ## What this file pins, and what its sibling pins
 *
 * This one is the SEAM: the pass exists once, both doors reach it, and it
 * cannot answer differently depending on which door asked. It spawns nothing
 * and boots no kernel, so it is UNIT tier (`packages/cli/vitest-tiers.ts`) and
 * gates the merge queue. `validate-per-package-authoring-parity.test.ts` is the
 * behavioural half — it runs the two real commands over a two-package project
 * and compares their payloads — and lands in the INTEGRATION tier because it
 * spawns the CLI.
 *
 * ## Why a source ratchet and not only a behavioural assertion
 *
 * Because the defect was structural, not numeric: the per-package pass was
 * absent from one command's source, and on every single-package fixture in this
 * suite that absence is INVISIBLE — `artifactPackages` returns `[]`, the pass is
 * skipped, and both doors agree for the wrong reason. That is exactly why
 * `test/build-json-advisory-parity.e2e.test.ts`' standing assertion ("nothing
 * rides in build's `warnings` that validate does not also report") stayed green
 * through this defect: its fixture declares no `packages[]` at all. A ratchet on
 * the source is the reading that does not depend on a fixture happening to carry
 * the shape — the same instrument `packages/lint/src/authoring-rule-wiring.test.ts`
 * uses on these same two files, and for the same reason.
 *
 * ⛔ The ratchet is NOT "the file mentions the helper". It asserts the two
 * spellings that can drift: the helper is CALLED, and the loop's own seam
 * (`packageBodyAsStack`) appears in NEITHER command — because a command that
 * names it is a command that has started writing a second copy of the loop,
 * which is the failure `utils/artifact-packages.ts`' header forbids by name.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineStack, composeStacks } from '@objectstack/spec';
import { artifactPackages, runPerPackageAuthoringRules } from '../src/utils/artifact-packages.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMANDS = resolve(HERE, '../src/commands');
const sourceOf = (file: string) => readFileSync(join(COMMANDS, file), 'utf8');

/** The two doors that hold an ARTIFACT to the author-time bar. */
const DOORS = ['compile.ts', 'validate.ts'] as const;

/**
 * A two-package artifact, mirroring `examples/app-multi-package`: an App package
 * owning `crm_account` plus a module owning `crm_order`, whose `account` lookup
 * points at the sibling's object. `manifest: 'preserve'` is the one composition
 * that produces `packages[]` (ADR-0130 D4) — without it there is no per-package
 * pass to run and this file would pass by vacuity, which the last case measures.
 */
function twoPackageArtifact(): Record<string, unknown> {
  const core = defineStack({
    manifest: {
      id: 'com.example.seam.core',
      name: 'Seam Core',
      namespace: 'crm',
      version: '1.0.0',
      type: 'app',
      engines: { protocol: '^17' },
    },
    objects: [
      {
        name: 'crm_account',
        label: 'Account',
        pluralLabel: 'Accounts',
        sharingModel: 'private',
        fields: {
          name: { name: 'name', type: 'text', label: 'Account Name', required: true },
          industry: { name: 'industry', type: 'text', label: 'Industry' },
        },
      },
    ],
    // The App package publishes the navigation container, exactly as
    // `examples/app-multi-package` does. ⛔ Not decoration: `field-no-consumers`
    // returns early on a stack whose only collection is `objects` (its
    // `hasConsumerRoot` guard), so without a consumer root on at least one
    // package body the per-package pass produces nothing and the equality
    // below would hold between two empty lists. The non-vacuity case is what
    // keeps that honest.
    apps: [
      {
        name: 'seam_crm',
        label: 'Seam CRM',
        navigation: [
          {
            id: 'sales_group',
            type: 'group',
            label: 'Sales',
            children: [
              { id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
            ],
          },
        ],
      },
    ],
  });
  const orders = defineStack({
    manifest: {
      id: 'com.example.seam.orders',
      name: 'Seam Orders',
      namespace: 'crm',
      version: '1.0.0',
      type: 'module',
      engines: { protocol: '^17' },
      dependencies: { 'com.example.seam.core': '^1.0.0' },
    },
    objects: [
      {
        name: 'crm_order',
        label: 'Order',
        pluralLabel: 'Orders',
        sharingModel: 'private',
        fields: {
          name: { name: 'name', type: 'text', label: 'Order Number', required: true },
          account: { name: 'account', type: 'lookup', label: 'Account', reference: 'crm_account' },
        },
      },
    ],
  });
  return composeStacks([orders, core], { manifest: 'preserve' }) as unknown as Record<string, unknown>;
}

describe('#18677 — the per-package author-time pass is ONE seam both doors reach', () => {
  it('both `os build` and `os validate` CALL the shared pass', () => {
    for (const door of DOORS) {
      expect(
        sourceOf(door),
        `${door} must run the per-package author-time pass — its absence is the #18677 false-clean gap`,
      ).toMatch(/\brunPerPackageAuthoringRules\s*\(/);
    }
  });

  it('⛔ neither door names `packageBodyAsStack` — that spelling IS a second copy of the loop', () => {
    // `utils/artifact-packages.ts`' header forbids the second copy by name: what
    // drifts between two hand-written loops is the VERDICT (the de-duplication
    // key, the severity split, the `where` prefix), not the package reading.
    for (const door of DOORS) {
      expect(
        sourceOf(door).replace(/`packageBodyAsStack`/g, ''),
        `${door} reaches into the loop's own seam — call the shared pass instead`,
      ).not.toMatch(/\bpackageBodyAsStack\s*\(/);
    }
  });

  it('the pass answers IDENTICALLY for the two doors — same survivors, same order', () => {
    // The invariant the asymmetry violated. Both modes run all 45 registered
    // rules (`commands: ALL` for every gating entry), so a door-dependent answer
    // here would mean the two commands hold one artifact to two bars.
    const parsed = twoPackageArtifact();
    expect(artifactPackages(parsed).length, 'fixture must carry `packages[]`').toBe(2);

    const forDoor = (command: 'build' | 'validate') =>
      runPerPackageAuthoringRules({ command, parsed, unionFindings: [] });

    const build = forDoor('build');
    const validate = forDoor('validate');
    expect(validate.packageCount).toBe(build.packageCount);
    expect(validate.errors).toEqual(build.errors);
    expect(validate.advisories).toEqual(build.advisories);
  });

  it('is NON-VACUOUS — the pass really produced findings on this fixture', () => {
    // Without this, the equality above is satisfied by two empty lists and the
    // whole file passes while measuring nothing. Deliberately asserted on the
    // COUNT and on the `where` prefix the pass owns, not on a rule id: which
    // rule fires is `lint/authoring-rules.ts`' business and may change.
    const parsed = twoPackageArtifact();
    const run = runPerPackageAuthoringRules({ command: 'validate', parsed, unionFindings: [] });
    const all = [...run.errors, ...run.advisories];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((f) => /^package '/.test(f.where))).toBe(true);
  });

  it('de-duplicates against the union run it is handed', () => {
    // The filter `compile.ts` described and this pass now owns. Handing it its
    // OWN output as the union run must empty it — the property that makes the
    // survivor list mean anything at all. ⚠️ This case is NOT sensitive to
    // #18779's defect and never was: both runs judge the same stack, so the
    // two paths are identical and the positional key matched them anyway. The
    // echo it missed needs the two views to DISAGREE about the index, which
    // only a real package-body-vs-union comparison produces — pinned in
    // `per-package-dedup-positional-echo.test.ts`.
    const parsed = twoPackageArtifact();
    const first = runPerPackageAuthoringRules({ command: 'validate', parsed, unionFindings: [] });
    const raw = [...first.errors, ...first.advisories];
    expect(raw.length).toBeGreaterThan(0);
    // The pass prefixes `where`; de-duplication happens on the UNPREFIXED
    // finding, so the union set is rebuilt by stripping the prefix back off.
    const asUnion = raw.map((f) => ({ ...f, where: f.where.replace(/^package '[^']*' — /, '') }));
    const second = runPerPackageAuthoringRules({ command: 'validate', parsed, unionFindings: asUnion });
    expect([...second.errors, ...second.advisories]).toEqual([]);
  });

  it('a stack with no `packages[]` skips the pass entirely — `packageCount` 0', () => {
    // One package by definition: the union run above already judged it whole,
    // and this is why every single-package fixture in this suite was blind to
    // the defect.
    const single = defineStack({
      manifest: { id: 'com.example.seam.single', name: 'Single', version: '1.0.0', type: 'app' },
      objects: [
        {
          name: 'solo_thing',
          label: 'Thing',
          pluralLabel: 'Things',
          sharingModel: 'private',
          fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
        },
      ],
    }) as unknown as Record<string, unknown>;
    const run = runPerPackageAuthoringRules({ command: 'validate', parsed: single, unionFindings: [] });
    expect(run.packageCount).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.advisories).toEqual([]);
  });
});
