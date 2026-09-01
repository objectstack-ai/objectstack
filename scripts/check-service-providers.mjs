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

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

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

const src = readFileSync(join(ROOT, TABLE_FILE), 'utf8');
const table = parseTable(src);
const slots = coreServiceNames(src);
const packages = workspacePackageNames();

const problems = [];

for (const [slot, pkg] of table) {
  if (pkg === null) continue;
  if (!packages.has(pkg)) {
    problems.push(
      `  ${slot} → ${pkg}\n`
      + '    Not a workspace package. Point it at the package that actually registers\n'
      + `    the '${slot}' slot, or use \`null\` if no installable package provides it\n`
      + '    (adding a REMEDY_DETAIL sentence if something ships that simply cannot\n'
      + '    be installed, e.g. a private package in another repository).',
    );
  }
}

// `data` and `metadata` are filled by the engine itself (ObjectQL / the
// protocol implementation), never by an installable optional package, so they
// carry no remedy and need no entry.
const NO_REMEDY_SLOTS = new Set(['data', 'metadata']);
for (const slot of slots) {
  if (NO_REMEDY_SLOTS.has(slot) || table.has(slot)) continue;
  problems.push(
    `  ${slot} → (missing)\n`
    + '    Declared in CoreServiceName but absent from CORE_SERVICE_PROVIDER, so\n'
    + '    discovery would report it unavailable with a remedy naming nothing.',
  );
}

if (problems.length > 0) {
  console.error('✗ Service-provider remedies (#4093 follow-up)\n');
  console.error(problems.join('\n\n'));
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
