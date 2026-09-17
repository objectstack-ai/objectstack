// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18780 — `os build`'s TEXT face counted per-package advisories it never
 * printed: `⚠ 4 author-time warning(s) — see above` standing over a list of 3.
 *
 * `compile.ts` rendered the advisory block at step 3b, inline, straight off the
 * union rule run. Step 3b-ii then appended the per-package survivors to the
 * SAME `ruleAdvisories` binding, and the summary line at the foot of the
 * command counts that binding. So on a multi-package stack the count was the
 * complete set and the list was the union's alone, and the sentence pointing at
 * it — "see above" — sent the reader back up to find a warning that had never
 * been printed. Measured on `examples/app-multi-package` at 17.4.0, exit 0:
 *
 *   os build           3 advisory entries · `⚠ 4 author-time warning(s)`
 *   os build --json    warnings: 4     <- the count was right
 *   os validate        4 advisory entries (#18769)
 *
 * The direction matters: the count was RIGHT and the list was SHORT, which
 * reads as "I must have missed it" rather than as a defect in the tool.
 *
 * ## WHAT THESE PINS ASSERT — an equality, not a number
 *
 * Not "four warnings printed". The three numbers are read from ONE run of the
 * command and compared to each other: the integer in the summary line, the
 * count of advisory entries actually rendered above it, and the length of the
 * `--json` payload's `warnings`. A future fixture that raises a different
 * number of advisories keeps passing; a face that counts a set it did not print
 * cannot. That is the invariant the sentence "see above" states.
 *
 * ⚠️ The cap is the one legal gap between the count and the list — #11529 kept
 * the 50-entry cap and made the printer NAME the remainder. So the equality is
 * asserted together with the absence of that notice: on a fixture this small
 * the two numbers must agree outright, and if a future change ever truncates
 * here the notice's absence fails first rather than the equality silently
 * meaning something else.
 *
 * ## The lit control
 *
 * The multi-package fixture is asserted to REACH the per-package pass and to
 * raise at least one finding there, before any equality is read — a fixture
 * that raises none makes the equality hold for the reason the defect survived
 * in the first place. The single-package control shows the opposite end: the
 * per-package prefix is not something the command emits unconditionally, and
 * the equality holds there on a shape that never had the defect.
 *
 * ## Tier
 *
 * SPAWNS the CLI ⇒ INTEGRATION tier by `packages/cli/vitest-tiers.ts`'
 * predicate (`childProcess` + `helperCliOrTsx`). No `.e2e` segment in the name,
 * so by the orthogonal NIGHTLY cut it is a QUEUE-tier file — the combination
 * `validate-per-package-authoring-parity.test.ts` already tiers as deliberate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

function payloadOf(run: Run, label: string): Record<string, unknown> {
  try {
    return JSON.parse(run.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

/** Drop SGR sequences so an assertion reads the words, not chalk's opinion. */
const stripAnsi = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, '');

/**
 * The summary line's integer — the number the command claims is "above".
 * Anchored on the whole sentence, not on the digits, so a different `… (s)`
 * tally elsewhere in the output cannot be mistaken for it.
 */
const SUMMARY_LINE = /(\d+) author-time warning\(s\) — see above/;

/**
 * How many advisory entries were actually RENDERED. `printAuthoringAdvisories`
 * closes every entry with a four-space `rule: <id>  at <path>` line;
 * `printAuthoringRuleErrors` — the GATING printer — indents its own by six, so
 * the exact indent is what tells an advisory from an error here rather than a
 * substring of either one's prose.
 */
const renderedAdvisoryCount = (out: string): number =>
  stripAnsi(out).split('\n').filter((l) => /^ {4}rule: /.test(l)).length;

/** #11529's truncation notice — the one legal reason the two numbers may differ. */
const TRUNCATION_NOTICE = /and \d+ more author-time warning\(s\) not shown/;

/** The `where` prefix `runPerPackageAuthoringRules` puts on every finding it raises. */
const PER_PACKAGE_WHERE = /^package '[^']+' — /;

const perPackageWarnings = (warnings: unknown[]): string[] =>
  warnings
    .filter((w): w is { where: string } => typeof (w as { where?: unknown })?.where === 'string')
    .map((w) => w.where)
    .filter((where) => PER_PACKAGE_WHERE.test(where));

/**
 * Two packages sharing a namespace, mirroring `examples/app-multi-package`: an
 * App package owning `bc_account` and publishing the navigation container, plus
 * a module owning `bc_order` whose `account` lookup points at the sibling's
 * object — legal under ADR-0130 §1.5, and what makes the per-package pass
 * produce a survivor at all.
 */
const CONFIG_MULTI = `
const coreManifest = {
  id: 'com.example.bcount.core', name: 'bcount core', namespace: 'bc',
  version: '1.0.0', type: 'app', engines: { protocol: '^17' },
};
const coreObjects = [{
  name: 'bc_account', label: 'Account', pluralLabel: 'Accounts', sharingModel: 'private',
  fields: {
    name: { name: 'name', type: 'text', label: 'Account Name', required: true },
    industry: { name: 'industry', type: 'text', label: 'Industry' },
  },
}];
const coreApps = [{
  name: 'bc_crm', label: 'BC CRM',
  navigation: [{
    id: 'sales_group', type: 'group', label: 'Sales',
    children: [{ id: 'nav_accounts', type: 'object', objectName: 'bc_account', label: 'Accounts' }],
  }],
}];

const ordersManifest = {
  id: 'com.example.bcount.orders', name: 'bcount orders', namespace: 'bc',
  version: '1.0.0', type: 'module', engines: { protocol: '^17' },
  dependencies: { 'com.example.bcount.core': '^1.0.0' },
};
const ordersObjects = [{
  name: 'bc_order', label: 'Order', pluralLabel: 'Orders', sharingModel: 'private',
  fields: {
    name: { name: 'name', type: 'text', label: 'Order Number', required: true },
    account: { name: 'account', type: 'lookup', label: 'Account', reference: 'bc_account' },
  },
}];

export default {
  manifest: coreManifest,
  objects: [...ordersObjects, ...coreObjects],
  apps: [...coreApps],
  packages: [
    { manifest: { ...ordersManifest, objects: ordersObjects } },
    { manifest: { ...coreManifest, objects: coreObjects, apps: coreApps } },
  ],
};
`;

/**
 * The CONTROL: one package, no `packages[]`. `artifactPackages` returns `[]`,
 * the per-package pass is skipped, and the count has always equalled the list —
 * which is why every existing text-face assertion in this package stayed green
 * through the defect.
 */
const CONFIG_SINGLE = `
export default {
  manifest: {
    id: 'com.example.bcsingle', name: 'bcsingle', namespace: 'bs',
    version: '1.0.0', type: 'app', engines: { protocol: '^17' },
  },
  objects: [{
    name: 'bs_thing', label: 'Thing', pluralLabel: 'Things', sharingModel: 'private',
    fields: {
      name: { name: 'name', type: 'text', label: 'Name', required: true },
      unused: { name: 'unused', type: 'text', label: 'Unused' },
    },
  }],
  apps: [{
    name: 'bs_app', label: 'BS App',
    navigation: [{ id: 'nav_things', type: 'object', objectName: 'bs_thing', label: 'Things' }],
  }],
};
`;

const dirs = { multi: '', single: '' };

function plant(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-bcount-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'objectstack.config.ts'), config, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'bcount-fixture', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  return dir;
}

describe("#18780 — `os build`'s text face prints every advisory its summary line counts", () => {
  let multiText: Run;
  let multiJson: Run;

  beforeAll(async () => {
    dirs.multi = plant(CONFIG_MULTI);
    dirs.single = plant(CONFIG_SINGLE);
    multiText = await runCli(['build'], dirs.multi);
    multiJson = await runCli(['build', '--json'], dirs.multi);
  }, 180_000);

  afterAll(() => {
    for (const dir of Object.values(dirs)) if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the fixture reaches the per-package pass and raises a survivor there', () => {
    // Asserted BEFORE any equality is read. A fixture that never reaches the
    // pass makes every assertion below hold for the reason the defect survived
    // the existing parity file: both sides agreeing about an empty set.
    expect(multiText.code, `${multiText.stdout}\n${multiText.stderr}`).toBe(0);
    expect(multiText.stdout).toContain('Running author-time rules per package (2)');
    expect(multiJson.code, `${multiJson.stdout}\n${multiJson.stderr}`).toBe(0);
    const perPackage = perPackageWarnings(payloadOf(multiJson, 'os build --json').warnings as unknown[]);
    expect(perPackage.length).toBeGreaterThan(0);
  });

  it('the summary line counts exactly what the list above it renders', () => {
    // THE PIN. On `origin/main` ad1f94e8ec this read `summary 4, rendered 3`.
    const out = stripAnsi(multiText.stdout);
    const summary = out.match(SUMMARY_LINE);
    expect(summary, `no summary line in:\n${out}`).not.toBeNull();

    // The cap is the one legal gap between the two, and it announces itself.
    // Asserting its absence first is what lets the equality below be read as
    // "the list is complete" rather than "the list is capped at some number".
    expect(out).not.toMatch(TRUNCATION_NOTICE);

    expect(renderedAdvisoryCount(out), `summary said ${summary?.[1]}; rendered list:\n${out}`)
      .toBe(Number(summary?.[1]));
  });

  it('…and the number it counts is the whole set the machine face publishes', () => {
    // The third side of the triangle. Without it the two faces could agree with
    // each other while both under-reporting what the run actually found — which
    // is the shape #11727 measured one face over.
    const out = stripAnsi(multiText.stdout);
    const summary = out.match(SUMMARY_LINE);
    const payloadWarnings = payloadOf(multiJson, 'os build --json').warnings as unknown[];
    const advisories = payloadWarnings.filter(
      (w) => typeof (w as { where?: unknown })?.where === 'string',
    );
    expect(Number(summary?.[1])).toBe(advisories.length);
  });

  it('the per-package survivor is one of the entries actually rendered', () => {
    // The equality above is a count; this names the member. Without it a face
    // that printed the union list twice would satisfy the arithmetic.
    const out = stripAnsi(multiText.stdout);
    const perPackage = perPackageWarnings(payloadOf(multiJson, 'os build --json').warnings as unknown[]);
    for (const where of perPackage) {
      expect(out, `this per-package finding rides \`--json\` and the text face never prints it:\n${where}`)
        .toContain(where);
    }
  });

  it('CONTROL — a single-package project renders no per-package entry, and still balances', () => {
    // "Present" must be distinguishable from "always present". This shape never
    // carried the defect, so it pins the other end: the prefix is not emitted
    // unconditionally, and the equality is not a tautology of the assertion.
    return runCli(['build'], dirs.single).then((run) => {
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
      const out = stripAnsi(run.stdout);
      expect(out).not.toContain('Running author-time rules per package');
      expect(out.split('\n').some((l) => PER_PACKAGE_WHERE.test(l.replace(/^\s*⚠ /, '')))).toBe(false);
      const summary = out.match(SUMMARY_LINE);
      expect(summary, `no summary line in:\n${out}`).not.toBeNull();
      expect(out).not.toMatch(TRUNCATION_NOTICE);
      expect(renderedAdvisoryCount(out)).toBe(Number(summary?.[1]));
    });
  }, 180_000);
});
