// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17069 — the three authoring commands judge the SAME STACK, on the ADR-0130
 * D4 / option-B shape.
 *
 * `authoring-rule-command-parity.test.ts` next door proves the three commands
 * reach the same verdict about the same rule TABLE. This file proves the other
 * half of the same promise, one layer earlier: that they hand that table the
 * same INPUT. A command can run every rule in the registry and still certify a
 * project clean — if what it hands the registry is an empty stack.
 *
 * ## The defect this file pins
 *
 * A project whose definitions live only in `packages[]` — the ADR-0130 D4
 * artifact shape, no collections at the top level — was judged by `os validate`
 * and `os lint` as if it declared NOTHING. `compile.ts` folds the packages back
 * in through `authoringRuleUnionStack` before it runs the table; neither
 * sibling command imported that helper, so each ran 44 rules over `{}`.
 *
 * Measured through the real binaries on this card's repro, before the fix:
 *
 *     os validate   EXIT=0    ✓ Validation passed
 *     os lint       EXIT=0    (no finding of any severity)
 *     os build      EXIT=1    object-reference-unknown
 *
 * ⭐ The dangling `ob_nowhere` is only the PROBE that makes the blindness
 * visible. The same silence covered every author-time rule, because the input
 * was empty — which is why the fix is the shared fold and not a rule.
 *
 * ## Why this is the p1 direction of the #4409 class
 *
 * #4409 was `os build` publishing what the other two refuse. This is the
 * mirror, and it is worse: `os validate` is the fast inner-loop check an author
 * runs BEFORE shipping, so its clean bill of health on a stack it read nothing
 * of is the strongest false assurance the three commands can give.
 * `content/docs/deployment/validating-metadata.mdx` states the parity as a
 * promise — *"anything that can fail a build fails `os lint` too"* — and on
 * this stack shape the promise was false in the loudest direction.
 *
 * ## Why it is spawned, and why BOTH fixtures are here
 *
 * Spawned because the exit CODE is the contract a CI pipeline reads, and only a
 * real process produces one; `os validate`'s rule run is an expression inside
 * the oclif command body, so there is no exported seam a probe could call
 * instead (the same reason the option-B acceptance pin could not reach it).
 *
 * The CLEAN fixture is not decoration. A fold wired in backwards — or a rule
 * that fires on any `packages[]` at all — would satisfy the failing case alone.
 * The pair asserts what the card actually claims: that the option-B stack is
 * READ, not that it is rejected.
 *
 * ## ⚠️ [#18897] The refusal cases were satisfied by an IMPOSTOR — and the
 * ## impostor is a SIBLING PASS that arrived after this file was written
 *
 * These three refusal cases claimed to pin `authoringRuleUnionStack` — the fold
 * that makes the rule table's INPUT non-empty on an option-B stack. They could
 * not. Since #18677 (`os validate`) and #18778 (`os lint`) all three doors ALSO
 * run `runPerPackageAuthoringRules`, which judges each `packages[]` entry as its
 * own stack. That pass sees this fixture's one package body, raises the SAME
 * rule at the SAME path, and refuses with the same exit code. ⇒ `exit 1` +
 * `contains(RULE)` + `contains(RULE_PATH)` is satisfied by EITHER mechanism, so
 * the control could not tell the fold from its sibling.
 *
 * ⛔ Not reasoned about — measured by ablation, at `origin/main` 13d52947d8:
 *
 *     ablation                                          this file
 *     `authoringRuleUnionStack` never folds             6/6 GREEN
 *     `runPerPackageAuthoringRules` yields no findings  6/6 GREEN
 *     BOTH of the above                                 3 RED
 *
 * ⭐ Either mechanism alone kept every case green; only deleting both turned the
 * three refusal cases red. That is what a control satisfied by something other
 * than the mechanism it names looks like from the inside — green, and green for
 * the wrong reason.
 *
 * ## What discriminates them: a PEDIGREE, ⛔ not a count and ⛔ not an exit code
 *
 * `runPerPackageAuthoringRules` prefixes the `where` of every finding IT raises
 * with `package '<id>' — `; it owns that prefix, and three sibling files pin the
 * same regex. The union run renders `where` bare. Measured on THIS fixture, same
 * command, with only the fold's presence moving:
 *
 *     fold intact    • object "ob_order" · field "ghost": …
 *     fold ablated   • package 'com.example.ob' — object "ob_order" · field "ghost": …
 *
 * So each refusal case now asserts the refusal carries NO per-package prefix —
 * the finding is the UNION run's, which is the mechanism this file is about.
 *
 * ⚠️ A real falsifier — a fixture in which the impostor structurally CANNOT
 * raise this finding — does not exist for this rule class, and that was measured
 * rather than assumed: the per-package pass is a SUPERSET of the union run for
 * reference rules (`utils/artifact-packages.ts`: "the per-package run is
 * STRICTER"), because each body is judged with the artifact's own `packages[]`
 * handed in as resolution context. A name no package provides therefore dangles
 * in BOTH views, under every arrangement of packages. ⇒ here the pedigree is the
 * whole discriminant, and the negative assertion is made load-bearing by the
 * POSITIVE control at the foot of this file — a fixture whose finding really is
 * per-package-only. Without that pair, "the prefix is absent" would be satisfied
 * by a prefix this suite never produces at all.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');

/** The three commands the #4409 registry holds to one bar. */
const AUTHORING_COMMANDS = ['validate', 'lint', 'build'] as const;

/** The rule the probe trips, and the path it reports it at. */
const RULE = 'object-reference-unknown';
const RULE_PATH = 'objects[0].fields.ghost.reference';

/**
 * [#18897] The `where` prefix `runPerPackageAuthoringRules` puts on every
 * finding IT raises — the one thing that tells the union run's finding apart
 * from the per-package pass's copy of it. ⛔ Not this file's guess at a format:
 * the pass owns the prefix, and `validate-/lint-per-package-authoring-parity`
 * and `build-text-face-advisory-count` pin the identical regex.
 */
const PER_PACKAGE_WHERE = /package '[^']+' — /;

/**
 * The card's repro verbatim: no top-level `objects`, one `packages[]` entry
 * carrying an object whose `ghost` lookup points at an object that does not
 * exist. Every collection this project declares lives inside `packages[]`.
 */
const optionBStack = (reference: string): Record<string, unknown> => ({
  manifest: { id: 'com.example.ob', name: 'ob', version: '1.0.0', type: 'app', namespace: 'ob' },
  packages: [
    {
      manifest: {
        id: 'com.example.ob',
        name: 'ob',
        version: '1.0.0',
        type: 'app',
        namespace: 'ob',
        objects: [
          {
            name: 'ob_order',
            label: 'Order',
            sharingModel: 'private',
            fields: {
              number: { type: 'text', label: 'Number' },
              ghost: { type: 'lookup', label: 'Ghost', reference },
            },
          },
        ],
      },
    },
  ],
});

/**
 * [#18897] The POSITIVE half of the pedigree pair: a project whose ONLY
 * author-time finding is one the union run genuinely cannot see.
 *
 * `core` owns `ob_account`; `orders` owns the view that displays
 * `ob_account.industry`. Folded into one union the field HAS a consumer and
 * nothing is raised; judged per package, `core` declares a field nothing in
 * `core` reads — so the survivor is the per-package pass's alone and carries its
 * `where` prefix. It is the falsifier shape PR #18878 landed in
 * `lint-per-package-authoring-parity.test.ts`, and it is here for one job: to
 * prove that {@link PER_PACKAGE_WHERE} is a prefix this suite CAN observe, so
 * the refusal cases' `toBe(false)` is a measurement and not the silence of a
 * regex that never matches anything. ⛔ Do not remove the view to "simplify" it.
 */
const perPackageOnlyStack = (): Record<string, unknown> => {
  const coreManifest = {
    id: 'com.example.obflip.core', name: 'obflip core', namespace: 'ob',
    version: '1.0.0', type: 'app', engines: { protocol: '^17' },
  };
  const coreObjects = [{
    name: 'ob_account', label: 'Account', pluralLabel: 'Accounts', sharingModel: 'private',
    fields: {
      name: { name: 'name', type: 'text', label: 'Account Name', required: true },
      industry: { name: 'industry', type: 'text', label: 'Industry' },
    },
  }];
  const coreApps = [{
    name: 'ob_crm', label: 'OB CRM',
    navigation: [{
      id: 'sales_group', type: 'group', label: 'Sales',
      children: [{ id: 'nav_accounts', type: 'object', objectName: 'ob_account', label: 'Accounts' }],
    }],
  }];
  const ordersManifest = {
    id: 'com.example.obflip.orders', name: 'obflip orders', namespace: 'ob',
    version: '1.0.0', type: 'module', engines: { protocol: '^17' },
    dependencies: { 'com.example.obflip.core': '^1.0.0' },
  };
  const ordersObjects = [{
    name: 'ob_order', label: 'Order', pluralLabel: 'Orders', sharingModel: 'private',
    fields: {
      name: { name: 'name', type: 'text', label: 'Order Number', required: true },
      account: { name: 'account', type: 'lookup', label: 'Account', reference: 'ob_account' },
    },
  }];
  const ordersViews = [
    {
      name: 'ob_account_list', label: 'Account List', object: 'ob_account',
      list: { label: 'Account List', columns: ['name', 'industry'] },
    },
    {
      name: 'ob_order_list', label: 'Order List', object: 'ob_order',
      list: { label: 'Order List', columns: ['name', 'account'] },
    },
  ];
  return {
    manifest: coreManifest,
    objects: [...ordersObjects, ...coreObjects],
    apps: [...coreApps],
    views: [...ordersViews],
    packages: [
      { manifest: { ...ordersManifest, objects: ordersObjects, views: ordersViews } },
      { manifest: { ...coreManifest, objects: coreObjects, apps: coreApps } },
    ],
  };
};

interface Run {
  code: number;
  output: string;
}

/**
 * One authoring command over one option-B project, as a shell sees it.
 *
 * A plain literal config with no imports, so it resolves with no `node_modules`
 * next to it — the `authoring-rule-command-parity.test.ts` pattern.
 */
function runCommand(command: string, stack: Record<string, unknown>): Run {
  const dir = mkdtempSync(join(tmpdir(), 'os-union-fold-'));
  try {
    writeFileSync(join(dir, 'objectstack.config.mjs'), `export default ${JSON.stringify(stack, null, 2)};\n`);
    try {
      const stdout = execFileSync(process.execPath, [CLI, command], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        // Every spawned child under this directory declares its environment at
        // the call site (#11595).
        env: childEnv({ NO_COLOR: '1' }),
      });
      return { code: 0, output: String(stdout) };
    } catch (error: any) {
      return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('#17069 — os validate and os lint judge the option-B stack, not an empty one', () => {
  it.each(AUTHORING_COMMANDS)(
    'os %s refuses a packages[]-only project whose lookup target does not exist',
    (command) => {
      const run = runCommand(command, optionBStack('ob_nowhere'));
      expect(
        run.code,
        `os ${command} exited ${run.code} on a project whose definitions live only in packages[]. ` +
          `Before #17069 os validate and os lint both exited 0 here — they handed the author-time ` +
          `rule table an EMPTY stack, so all 44 rules reported nothing and the project was certified ` +
          `clean without being read. Hand the table authoringRuleUnionStack(...) as compile.ts does.` +
          `\n--- output ---\n${run.output}`,
      ).toBe(1);
      expect(run.output, `os ${command} refused the stack without naming the rule`).toContain(RULE);
      expect(
        run.output,
        `os ${command} named ${RULE} at a different path than the other doors — the three commands ` +
          `must report one finding one way`,
      ).toContain(RULE_PATH);
      // ⭐ [#18897] PEDIGREE. Everything above this line is satisfied by the
      // per-package authoring pass, which raises the same rule at the same path
      // on this one-package body and refuses with the same code — measured: with
      // `authoringRuleUnionStack` ablated all six cases here stayed GREEN, and
      // only ablating the per-package pass TOO turned these three red. The union
      // run renders `where` bare; the per-package pass prefixes it. So the
      // absence of that prefix is what makes this case a reading of the FOLD.
      expect(
        PER_PACKAGE_WHERE.test(run.output),
        `os ${command} refused this stack through the PER-PACKAGE authoring pass, not through the ` +
          `union fold this file pins: the finding carries ${String(PER_PACKAGE_WHERE)}, the prefix ` +
          `runPerPackageAuthoringRules puts on its own findings. The fold is what makes the rule ` +
          `table's INPUT non-empty on an option-B stack, and with it gone this command is refusing ` +
          `for a reason #17069 did not buy. ⛔ Do not answer this by deleting the assertion — the ` +
          `pedigree is the only thing here that can tell the two mechanisms apart.` +
          `\n--- output ---\n${run.output}`,
      ).toBe(false);
    },
    180_000,
  );

  it.each(AUTHORING_COMMANDS)(
    'control: os %s passes the identical option-B project once the lookup resolves',
    (command) => {
      const run = runCommand(command, optionBStack('ob_order'));
      expect(
        run.code,
        `os ${command} exited ${run.code} on a CLEAN option-B project. The fold folds packages[] ` +
          `back in as the rule table's INPUT — it does not make a packages[]-only project fail. ` +
          `Without this control the case above would pass on a command that refuses every ` +
          `multi-package stack.\n--- output ---\n${run.output}`,
      ).toBe(0);
      expect(run.output, `os ${command} reported ${RULE} on a stack whose lookup resolves`).not.toContain(RULE);
    },
    180_000,
  );

  it.each(AUTHORING_COMMANDS)(
    '⭐ PEDIGREE CONTROL — os %s DOES render the per-package prefix when the finding is the pass\'s own',
    (command) => {
      // The other half of the pair above. A `toBe(false)` on a regex is only a
      // measurement if the same suite can make it true; without this case an
      // absent prefix and a prefix nothing ever emits read identically — which
      // is the whole class of defect #18897 is about, one level up.
      const run = runCommand(command, perPackageOnlyStack());
      expect(
        run.code,
        `os ${command} exited ${run.code} on the per-package-only fixture. Its single finding is an ` +
          `ADVISORY (field-no-consumers), so every door reports it and none of them fails on it.` +
          `\n--- output ---\n${run.output}`,
      ).toBe(0);
      expect(
        PER_PACKAGE_WHERE.test(run.output),
        `os ${command} raised no per-package-prefixed finding on a fixture whose only finding the ` +
          `union run cannot see (core declares ob_account.industry; orders owns the view that ` +
          `displays it). Either the pass stopped running on this door, or the prefix was re-spelled ` +
          `— and in both cases the refusal cases above are asserting the absence of something this ` +
          `suite no longer produces.\n--- output ---\n${run.output}`,
      ).toBe(true);
      // …and it is that field, not some other advisory that happens to be
      // prefixed: the pedigree names the member, never just the shape.
      expect(run.output, `os ${command} prefixed a finding, but not the one this fixture is built on`)
        .toContain('industry');
    },
    180_000,
  );
});
