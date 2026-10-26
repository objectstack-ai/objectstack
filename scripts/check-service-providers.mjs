#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Guards `CORE_SERVICE_PROVIDER` (packages/spec/src/system/core-services.zod.ts):
// the table that tells a consumer WHICH PACKAGE to install when discovery
// reports a service slot unavailable.
//
// The bug it exists to prevent (#4093 follow-up): that remedy used to be
// invented from the slot name — the dispatcher templated `Install a ${slot}
// plugin to enable`, and metadata-protocol hand-wrote a table in which ten of
// fifteen names were not real packages (`plugin-redis`, `plugin-bullmq`,
// `job-scheduler`, `plugin-notifications`, `plugin-storage`, `ui-plugin`,
// `plugin-automation`, plus `plugin-ai` / `plugin-search` / `plugin-workflow`
// for slots nothing implements). Discovery also surfaces the value as
// `provider`. A name that cannot be installed is a dead end handed to someone
// at the moment they are trying to fix their stack, and an agent reading
// discovery cannot tell it apart from a package it should install.
//
// Two ways that table rots, both caught here:
//   1. A name that is not a workspace package (typo, guess, or a rename
//      landing in the package but not here).
//   2. A slot in `CoreServiceName` with no entry at all — which would fall
//      back to `undefined` and print a remedy naming nothing.
//
// `null` is a legitimate entry, and it means "no name belongs in an `Install X`
// sentence" — which covers TWO situations. Nothing provides the slot at all
// (`search`, `workflow`, `graphql`), or a provider exists but cannot be
// installed: `@objectstack/service-ai` registers `ai` in objectstack-ai/cloud
// and is `private: true`. This script can only see workspace packages, so it
// cannot tell those apart — `REMEDY_DETAIL` in the same file is where the
// second kind gets an accurate sentence, and the reason a bare `null` must not
// be read here (or reported) as "nothing exists".
//
//   node scripts/check-service-providers.mjs
//   node scripts/check-service-providers.mjs --self-test   # the rule against fixtures

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = process.cwd();
const TABLE_FILE = 'packages/spec/src/system/core-services.zod.ts';

/**
 * The parent directories whose immediate children's MANIFESTS this gate opens.
 * Hoisted out of `workspacePackageNames` so the declaration below can be held
 * against it rather than against a second copy of the same list.
 *
 * Each element is built with `join` on single-segment pieces deliberately: a
 * `'packages/plugins'` literal in this module body would be read by
 * `extractWatchHints` as a declared DIRECTORY population and would put this gate
 * on every card touching any of the 691 files under it — where this gate opens
 * only the `package.json` at each child's root. The narrow claim is spelled in
 * `DECLARED_WATCH_HINTS` instead.
 */
const MANIFEST_PARENTS = ['packages', join('packages', 'plugins'), join('packages', 'services')];

/**
 * The population this gate READS, declared for `scripts/pm/dispatch-gates.mjs`
 * — spelled as a LITERAL array because the hint extractor reads source TEXT
 * (`scripts/check-watch-hint-literal.mjs` holds that spelling for every
 * declarer in the tree).
 *
 * ## What was declared before, and why it under-matched
 *
 * The only path literal this module body spelled was `TABLE_FILE` — the table
 * this gate JUDGES. Its other input, the set of workspace package names, is
 * read by opening `<parent>/<child>/package.json` for each parent above, and
 * none of those paths existed as a literal: the parents are assembled with
 * `join` and `'packages'` alone is refused by the extractor as too generic. So
 * a card renaming a package — the exact change that invalidates a row of the
 * table — derived no lead to this gate.
 *
 * ## Why PATTERNS and not the parent directories
 *
 * `'packages/plugins'` as a hint is a claim on the whole subtree, and
 * `scripts/workspace-enumerator.mjs`'s header carries the measurement that
 * settles this shape: handing a workspace-wide population to importing gates
 * priced at +41725 (gate, file) pairs, and its conclusion is that each gate
 * declares its OWN population in its OWN module body. The manifests are that
 * own population here — 53 files on this tree rather than the ~5400 the subtree
 * spelling would claim.
 */
const DECLARED_WATCH_HINTS = [
  'packages/*/package.json',
  'packages/plugins/*/package.json',
  'packages/services/*/package.json',
];

// The declaration held against the read, at every invocation — the pin the
// idiom asks each declarer to carry from its own side, where the walked root is
// in scope. Both directions: a parent with no pattern is an UNDECLARED read
// (the defect being repaired), and a pattern with no parent is a fabricated
// lead pasted into every card under it. Add a fourth parent above and this
// throws here rather than going quiet in a dispatch brief.
{
  const declaredParents = DECLARED_WATCH_HINTS.map((h) => h.replace(/\/\*\/package\.json$/, ''));
  const readParents = MANIFEST_PARENTS.map((p) => p.split(sep).join('/'));
  const missing = readParents.filter((p) => !declaredParents.includes(p));
  const invented = declaredParents.filter((p) => !readParents.includes(p));
  if (missing.length || invented.length) {
    throw new Error(
      'check-service-providers: DECLARED_WATCH_HINTS no longer matches the directories this gate reads manifests from'
        + `${missing.length ? ` — undeclared: ${missing.join(', ')}` : ''}`
        + `${invented.length ? ` — declared but not read: ${invented.join(', ')}` : ''}`
        + '. Update the declaration, as a LITERAL array of `<parent>/*/package.json` patterns.',
    );
  }
}

/** Every package name declared anywhere in the workspace. */
function workspacePackageNames() {
  const names = new Set();
  const roots = MANIFEST_PARENTS;
  for (const dir of roots) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      const pkg = join(abs, entry, 'package.json');
      if (!existsSync(pkg)) continue;
      try {
        const { name } = JSON.parse(readFileSync(pkg, 'utf8'));
        if (name) names.add(name);
      } catch { /* unparseable package.json is another check's problem */ }
    }
  }
  return names;
}

/** Slot → provider entries, read from the table's source. */
function parseTable(src) {
  const start = src.indexOf('export const CORE_SERVICE_PROVIDER');
  if (start === -1) throw new Error(`CORE_SERVICE_PROVIDER not found in ${TABLE_FILE}`);
  const end = src.indexOf('} as const;', start);
  if (end === -1) throw new Error('CORE_SERVICE_PROVIDER is not closed with `} as const;`');
  const body = src.slice(start, end);
  const entries = new Map();
  // `'slot': '@scope/pkg',` or `'slot': null,` — comments are skipped by the
  // anchored quote/null alternation rather than by stripping them.
  for (const m of body.matchAll(/'([a-z0-9-]+)':\s*(?:'([^']+)'|(null))\s*,/g)) {
    entries.set(m[1], m[3] ? null : m[2]);
  }
  return entries;
}

/** The slot names the kernel declares. */
function coreServiceNames(src) {
  const start = src.indexOf('export const CoreServiceName = z.enum([');
  const end = src.indexOf(']);', start);
  return [...src.slice(start, end).matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

// `data` and `metadata` are filled by the engine itself (ObjectQL / the
// protocol implementation), never by an installable optional package, so they
// carry no remedy and need no entry.
const NO_REMEDY_SLOTS = new Set(['data', 'metadata']);

/**
 * The rule over its three inputs, which `main()` reads from the tree and
 * `selfTest()` builds by hand. Each problem carries a `kind` and the slot it
 * names, so the self-test asserts WHAT was found, never the message wording.
 */
function findProblems({ table, slots, packages }) {
  const problems = [];

  for (const [slot, pkg] of table) {
    if (pkg === null) continue;
    if (!packages.has(pkg)) {
      problems.push({
        kind: 'not-a-workspace-package',
        slot,
        text:
          `  ${slot} → ${pkg}\n`
          + '    Not a workspace package. Point it at the package that actually registers\n'
          + `    the '${slot}' slot, or use \`null\` if no installable package provides it\n`
          + '    (adding a REMEDY_DETAIL sentence if something ships that simply cannot\n'
          + '    be installed, e.g. a private package in another repository).',
      });
    }
  }

  for (const slot of slots) {
    if (NO_REMEDY_SLOTS.has(slot) || table.has(slot)) continue;
    problems.push({
      kind: 'slot-missing',
      slot,
      text:
        `  ${slot} → (missing)\n`
        + '    Declared in CoreServiceName but absent from CORE_SERVICE_PROVIDER, so\n'
        + '    discovery would report it unavailable with a remedy naming nothing.',
    });
  }
  return problems;
}

// ── --self-test ──────────────────────────────────────────────────────────────
//
// Shape copied from `scripts/check-agent-model-declared.mjs` (AGENTS.md,
// "Writing a --self-test"): a literal cases table whose row LABELS are the
// battery roster, each floored at 1 and registered as the first statement of
// the loop body; the roster's own size pinned; and a verdict flag the dispatch
// refuses to run without.

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'every named provider is a workspace package, every slot has an entry → GREEN': 1,
  'a provider name that is not a workspace package → RED, naming the slot': 1,
  'a CoreServiceName slot absent from the table → RED, naming the slot': 1,
  '`null` is a legitimate entry and is never looked up → GREEN': 1,
  '`data` and `metadata` need no entry → GREEN': 1,
  'several defects → every one reported, not only the first': 1,
  'the table parser reads quoted and null entries, and nothing outside the table': 1,
  'a source without CORE_SERVICE_PROVIDER → the parser throws, never an empty table': 1,
  'a table not closed with `} as const;` → the parser throws': 1,
  'CoreServiceName is read from its z.enum declaration': 1,
  'the live table parses to a non-empty table and slot list (the read is not vacuous)': 1,
});

const SELF_TEST_BATTERY_FLOOR = 11;

function selfTest() {
  const source = (rows, enumSlots) =>
    `export const CoreServiceName = z.enum([\n${enumSlots.map((s) => `  '${s}',`).join('\n')}\n]);\n\n`
    + `export const CORE_SERVICE_PROVIDER = {\n${rows.join('\n')}\n} as const;\n`;
  const input = ({ table = [['cache', '@demo/cache'], ['search', null]], slots = ['data', 'metadata', 'cache', 'search'], packages = ['@demo/cache'] } = {}) => ({
    table: new Map(table),
    slots,
    packages: new Set(packages),
  });
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  const cases = [
    {
      label: 'every named provider is a workspace package, every slot has an entry → GREEN',
      input: input(),
      expect: [],
    },
    {
      label: 'a provider name that is not a workspace package → RED, naming the slot',
      input: input({ packages: ['@demo/other'] }),
      expect: ['not-a-workspace-package:cache'],
    },
    {
      label: 'a CoreServiceName slot absent from the table → RED, naming the slot',
      input: input({ slots: ['data', 'metadata', 'cache', 'search', 'queue'] }),
      expect: ['slot-missing:queue'],
    },
    {
      label: '`null` is a legitimate entry and is never looked up → GREEN',
      input: input({ table: [['cache', '@demo/cache'], ['search', null]], packages: ['@demo/cache'] }),
      expect: [],
    },
    {
      label: '`data` and `metadata` need no entry → GREEN',
      input: input({ table: [], slots: ['data', 'metadata'], packages: [] }),
      expect: [],
    },
    {
      label: 'several defects → every one reported, not only the first',
      input: input({ table: [['cache', '@demo/typo'], ['search', null]], slots: ['cache', 'search', 'queue'], packages: [] }),
      expect: ['not-a-workspace-package:cache', 'slot-missing:queue'],
    },
    {
      label: 'the table parser reads quoted and null entries, and nothing outside the table',
      check: () => {
        const src = `const OTHER = { 'outside': '@demo/outside', };\n${source([
          "  // a comment line that names no entry",
          "  'cache': '@demo/cache',",
          "  'search': null,",
        ], ['cache'])}const AFTER = { 'late': '@demo/late', };\n`;
        return JSON.stringify([...parseTable(src)]) === JSON.stringify([['cache', '@demo/cache'], ['search', null]]);
      },
    },
    {
      label: 'a source without CORE_SERVICE_PROVIDER → the parser throws, never an empty table',
      check: () => throws(() => parseTable("export const CoreServiceName = z.enum(['cache']);\n")),
    },
    {
      label: 'a table not closed with `} as const;` → the parser throws',
      check: () => throws(() => parseTable("export const CORE_SERVICE_PROVIDER = {\n  'cache': '@demo/cache',\n};\n")),
    },
    {
      label: 'CoreServiceName is read from its z.enum declaration',
      check: () => JSON.stringify(coreServiceNames(source([], ['data', 'cache', 'job-queue']))) === JSON.stringify(['data', 'cache', 'job-queue']),
    },
    {
      label: 'the live table parses to a non-empty table and slot list (the read is not vacuous)',
      check: () => {
        const live = readFileSync(join(ROOT, TABLE_FILE), 'utf8');
        return parseTable(live).size > 0 && coreServiceNames(live).length > 0;
      },
    },
  ];

  const batterySeen = new Map();
  let failed = 0;
  for (const c of cases) {
    batterySeen.set(c.label, (batterySeen.get(c.label) ?? 0) + 1);
    let ok;
    let detail = '';
    if (c.check) {
      ok = c.check();
    } else {
      const got = findProblems(c.input).map((p) => `${p.kind}:${p.slot}`);
      ok = JSON.stringify(got) === JSON.stringify(c.expect);
      if (!ok) detail = `\n      expected ${JSON.stringify(c.expect)}\n      got      ${JSON.stringify(got)}`;
    }
    if (ok) {
      console.log(`  ✓ ${c.label}`);
    } else {
      console.error(`  ✗ ${c.label}${detail}`);
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
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — `
        + 'a battery deleted from the roster takes its own floor with it.',
    );
  }
  const labels = cases.map((c) => c.label);
  const duplicated = [...new Set(labels.filter((label, i) => labels.indexOf(label) !== i))];
  if (duplicated.length > 0) {
    floorFailure(`the cases table uses ${duplicated.map((l) => JSON.stringify(l)).join(', ')} as a row label more than once.`);
  }
  for (const [label, count] of batterySeen) {
    if (!declared.includes(label)) {
      floorFailure(`self-test battery "${label}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
    }
  }
  for (const label of declared) {
    const count = batterySeen.get(label) ?? 0;
    if (count < SELF_TEST_BATTERIES[label]) {
      floorFailure(`self-test battery "${label}" DID NOT RUN — ${count} case(s) registered, ${SELF_TEST_BATTERIES[label]} pinned.`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ check-service-providers self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ check-service-providers self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-service-providers self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }

  const src = readFileSync(join(ROOT, TABLE_FILE), 'utf8');
  const table = parseTable(src);
  const problems = findProblems({ table, slots: coreServiceNames(src), packages: workspacePackageNames() });

  if (problems.length > 0) {
    console.error('✗ Service-provider remedies (#4093 follow-up)\n');
    console.error(problems.map((p) => p.text).join('\n\n'));
    console.error(
      '\nDiscovery reports these as `provider` and as "Install X to enable". A name\n'
      + `that cannot be installed is worse than none. See ${TABLE_FILE}.`,
    );
    process.exit(1);
  }

  const named = [...table.values()].filter(Boolean).length;
  // Deliberately NOT "nothing ships yet" — `null` means "no name belongs in an
  // `Install X` sentence", which also covers a provider that exists but cannot be
  // installed (`ai`, whose `@objectstack/service-ai` is private to the cloud
  // repo). Saying "nothing ships" here would repeat, in this script's own output,
  // the conflation the table was corrected to stop making.
  console.log(
    `✓ check:service-providers — ${table.size} slot(s): ${named} name an installable workspace `
    + `package, ${table.size - named} name none (see REMEDY_DETAIL for those that still ship something).`,
  );
}

if (isEntrypoint(import.meta.url)) {
  main();
}
