#!/usr/bin/env node
/**
 * Validates that every publishable workspace package is enumerated in the
 * Changesets `fixed` group, so a new public package can never silently be
 * released out of lockstep with the rest of the monorepo.
 *
 * Run:  node scripts/check-changeset-fixed.mjs
 *       node scripts/check-changeset-fixed.mjs --self-test   # the rules against fixtures, no tree read
 *
 * Exits with code 1 (and a clear diff) if:
 *   - A public (non-private) workspace package is missing from the
 *     `fixed` group in .changeset/config.json
 *   - A name listed in the `fixed` group no longer exists in the workspace,
 *     or names a private package that `PRIVATE_FIXED_MEMBERS` does not declare
 *   - A declared private member is missing from the group, is not a private
 *     workspace package, or sits there while `privatePackages.version` is not
 *     true (Changesets would then leave it unversioned inside a lockstep group)
 *
 * The script intentionally has zero third-party dependencies so it can run
 * in minimal CI environments before `pnpm install`. The workspace walk comes
 * from scripts/workspace-enumerator.mjs, which has none either, for the same
 * reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackages } from './workspace-enumerator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * Private workspace packages that belong in the `fixed` group anyway, each with
 * the reason it is there. Every other name in the group must be public.
 *
 * Empty today: its one row, the VS Code extension, left the workspace under
 * objectstack#25910's ruling. A private package outside this list is refused in
 * the group, so a package marked private by mistake cannot hide in it; a new
 * row needs its reason and the ruling that put it there.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PRIVATE_FIXED_MEMBERS = Object.freeze({});

/**
 * Names of all non-private workspace packages.
 *
 * Membership comes from `scripts/workspace-enumerator.mjs` (#11510) — this
 * repo's one parse of `pnpm-workspace.yaml`, and one of nine private copies
 * before it. Two behaviours of the copy that used to live here changed, both
 * toward refusing rather than under-reporting, and neither observable on this
 * repo's workspace file:
 *
 *   - a missing or empty `packages:` block used to yield `[]`, which made this
 *     gate report the `fixed` group in sync with a workspace of zero packages —
 *     green, and vacuous. It now throws.
 *   - a `#` was stripped unconditionally, so a member path legitimately
 *     containing one was silently truncated to a directory that does not exist.
 *     Only a whitespace-led `#` is a comment now.
 *
 * @returns {string[]}
 */
function listPackageNames() {
  const publicNames = new Set();
  const privateNames = new Set();
  for (const { manifest } of workspacePackages(repoRoot)) {
    if (!manifest.name) continue;
    (manifest.private === true ? privateNames : publicNames).add(manifest.name);
  }
  return { publicNames: [...publicNames].sort(), privateNames };
}

function readConfig() {
  const configPath = resolve(repoRoot, '.changeset/config.json');
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

/**
 * Judges a config against the workspace. Pure, so the declared-private rules
 * can be read without a tree.
 *
 * @param {{ fixed?: string[][]; privatePackages?: { version?: boolean } }} config
 * @param {{ publicNames: string[]; privateNames: Set<string> }} packages
 * @param {Readonly<Record<string, string>>} [declared]
 */
export function judge(config, { publicNames, privateNames }, declared = PRIVATE_FIXED_MEMBERS) {
  const fixed = new Set(Array.isArray(config.fixed) ? config.fixed.flat() : []);
  const isDeclaredPrivate = (name) => Object.hasOwn(declared, name) && privateNames.has(name);

  const missing = publicNames.filter((name) => !fixed.has(name));
  const stale = [...fixed].filter((name) => !publicNames.includes(name) && !isDeclaredPrivate(name)).sort();
  const declaredProblems = [];
  for (const name of Object.keys(declared).sort()) {
    if (publicNames.includes(name)) {
      declaredProblems.push(`${name} is declared a private member but its manifest is public; drop it from PRIVATE_FIXED_MEMBERS`);
    } else if (!privateNames.has(name)) {
      // No such package in this tree: `stale` already names it when the group does.
      continue;
    } else if (!fixed.has(name)) {
      declaredProblems.push(`${name} (${declared[name]}) is missing from "fixed"`);
    } else if (config.privatePackages?.version !== true) {
      declaredProblems.push(`${name} sits in "fixed" while privatePackages.version is not true, so Changesets would not version it`);
    }
  }
  return { missing, stale, declaredProblems };
}

// ── --self-test ──────────────────────────────────────────────────────────────
//
// Shape copied from `scripts/check-node-version.mjs` (AGENTS.md, "Writing a
// --self-test"): a literal cases table whose row LABELS are the battery roster,
// each floored at 1 and registered as the first statement of the loop body; the
// roster's own size pinned; and a verdict flag the dispatch refuses to run
// without. `judge` only: fixtures in, findings out, no tree read.

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'every public package in the group → GREEN': 1,
  'a group split over several arrays is read as one → GREEN': 1,
  'a public package outside the group → RED (missing)': 1,
  'a config with no fixed group misses every public package → RED': 1,
  'a group name no workspace package has → RED (stale)': 1,
  'an undeclared private package in the group → RED (stale)': 1,
  'a declared private member in the group, privatePackages.version true → GREEN': 1,
  'a declared private member outside the group → RED': 1,
  'a declared private member while privatePackages.version is not true → RED': 1,
  'a declared member whose manifest is public → RED': 1,
  'a declared member absent from the tree is stale only if the group names it': 1,
  'every shipped PRIVATE_FIXED_MEMBERS row carries its reason': 1,
});

const SELF_TEST_BATTERY_FLOOR = 12;

function selfTest() {
  const ws = (publicNames, privateNames = []) => ({ publicNames: [...publicNames].sort(), privateNames: new Set(privateNames) });
  const DECLARED = Object.freeze({ 'ext-x': 'a fixture reason' });
  const verdict = (config, packages, declared = DECLARED) => {
    const { missing, stale, declaredProblems } = judge(config, packages, declared);
    return { missing, stale, declared: declaredProblems.length };
  };
  const green = { missing: [], stale: [], declared: 0 };

  const cases = [
    { label: 'every public package in the group → GREEN', got: () => verdict({ fixed: [['@a/one', '@a/two']] }, ws(['@a/one', '@a/two'])), expect: green },
    {
      label: 'a group split over several arrays is read as one → GREEN',
      got: () => verdict({ fixed: [['@a/one'], ['@a/two']] }, ws(['@a/one', '@a/two'])),
      expect: green,
    },
    {
      label: 'a public package outside the group → RED (missing)',
      got: () => verdict({ fixed: [['@a/one']] }, ws(['@a/one', '@a/two'])),
      expect: { missing: ['@a/two'], stale: [], declared: 0 },
    },
    {
      label: 'a config with no fixed group misses every public package → RED',
      got: () => verdict({}, ws(['@a/one', '@a/two'])),
      expect: { missing: ['@a/one', '@a/two'], stale: [], declared: 0 },
    },
    {
      label: 'a group name no workspace package has → RED (stale)',
      got: () => verdict({ fixed: [['@a/one', '@a/gone']] }, ws(['@a/one'])),
      expect: { missing: [], stale: ['@a/gone'], declared: 0 },
    },
    {
      label: 'an undeclared private package in the group → RED (stale)',
      got: () => verdict({ fixed: [['@a/one', 'tool-y']], privatePackages: { version: true } }, ws(['@a/one'], ['tool-y'])),
      expect: { missing: [], stale: ['tool-y'], declared: 0 },
    },
    {
      label: 'a declared private member in the group, privatePackages.version true → GREEN',
      got: () => verdict({ fixed: [['@a/one', 'ext-x']], privatePackages: { version: true } }, ws(['@a/one'], ['ext-x'])),
      expect: green,
    },
    {
      label: 'a declared private member outside the group → RED',
      got: () => verdict({ fixed: [['@a/one']], privatePackages: { version: true } }, ws(['@a/one'], ['ext-x'])),
      expect: { missing: [], stale: [], declared: 1 },
    },
    {
      label: 'a declared private member while privatePackages.version is not true → RED',
      got: () => [
        verdict({ fixed: [['@a/one', 'ext-x']] }, ws(['@a/one'], ['ext-x'])),
        verdict({ fixed: [['@a/one', 'ext-x']], privatePackages: { version: false } }, ws(['@a/one'], ['ext-x'])),
      ],
      expect: [{ missing: [], stale: [], declared: 1 }, { missing: [], stale: [], declared: 1 }],
    },
    {
      label: 'a declared member whose manifest is public → RED',
      got: () => verdict({ fixed: [['@a/one', 'ext-x']], privatePackages: { version: true } }, ws(['@a/one', 'ext-x'])),
      expect: { missing: [], stale: [], declared: 1 },
    },
    {
      label: 'a declared member absent from the tree is stale only if the group names it',
      got: () => [verdict({ fixed: [['@a/one']] }, ws(['@a/one'])), verdict({ fixed: [['@a/one', 'ext-x']] }, ws(['@a/one']))],
      expect: [green, { missing: [], stale: ['ext-x'], declared: 0 }],
    },
    {
      label: 'every shipped PRIVATE_FIXED_MEMBERS row carries its reason',
      got: () => Object.entries(PRIVATE_FIXED_MEMBERS).filter(([, reason]) => typeof reason !== 'string' || reason.trim() === '').map(([name]) => name),
      expect: [],
    },
  ];

  const batterySeen = new Map();
  let failed = 0;
  for (const c of cases) {
    batterySeen.set(c.label, (batterySeen.get(c.label) ?? 0) + 1);
    const got = c.got();
    if (JSON.stringify(got) === JSON.stringify(c.expect)) {
      console.log(`  ✓ ${c.label}`);
    } else {
      console.error(`  ✗ ${c.label}\n      expected ${JSON.stringify(c.expect)}\n      got      ${JSON.stringify(got)}`);
      failed += 1;
    }
  }

  // The floor: every declared row RAN, evaluated before the verdict so the
  // success line can only follow a run whose registered rows equal the roster.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} -- ` +
        'a battery deleted from the roster takes its own floor with it.',
    );
  }
  const labels = cases.map((c) => c.label);
  const duplicated = [...new Set(labels.filter((label, i) => labels.indexOf(label) !== i))];
  if (duplicated.length > 0) {
    floorFailure(`the cases table uses ${duplicated.map((l) => JSON.stringify(l)).join(', ')} as a row label more than once.`);
  }
  for (const [label, count] of batterySeen) {
    if (!Object.hasOwn(SELF_TEST_BATTERIES, label)) {
      floorFailure(`self-test battery "${label}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
    }
  }
  for (const label of declared) {
    const count = batterySeen.get(label) ?? 0;
    if (count < SELF_TEST_BATTERIES[label]) {
      floorFailure(`self-test battery "${label}" DID NOT RUN -- ${count} case(s) registered, ${SELF_TEST_BATTERIES[label]} pinned.`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ check-changeset-fixed self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ check-changeset-fixed self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-changeset-fixed self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test\n' +
          'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }

  const packages = listPackageNames();
  const { missing, stale, declaredProblems } = judge(readConfig(), packages);

  if (missing.length === 0 && stale.length === 0 && declaredProblems.length === 0) {
    const privateCount = Object.keys(PRIVATE_FIXED_MEMBERS).filter((name) => packages.privateNames.has(name)).length;
    console.log(
      `✓ .changeset/config.json "fixed" group is in sync with ${packages.publicNames.length} public workspace packages` +
        (privateCount > 0 ? ` and ${privateCount} declared private member(s).` : '.'),
    );
    return;
  }

  console.error('✗ .changeset/config.json "fixed" group is out of sync.');
  if (missing.length > 0) {
    console.error(
      '\nPublic packages missing from "fixed" (add them to keep versions in lockstep):',
    );
    for (const name of missing) console.error(`  - ${name}`);
  }
  if (stale.length > 0) {
    console.error(
      '\nNames in "fixed" that are no public workspace package and no declared private member (remove them, or declare a private one in PRIVATE_FIXED_MEMBERS):',
    );
    for (const name of stale) console.error(`  - ${name}`);
  }
  if (declaredProblems.length > 0) {
    console.error('\nDeclared private members (PRIVATE_FIXED_MEMBERS):');
    for (const problem of declaredProblems) console.error(`  - ${problem}`);
  }
  console.error(
    '\nEdit .changeset/config.json so the "fixed" group matches the public workspace, then re-run this script.',
  );
  process.exit(1);
}

if (isEntrypoint(import.meta.url)) main();
