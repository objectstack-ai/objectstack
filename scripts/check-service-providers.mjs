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
// `null` is a legitimate entry: it means nothing ships for that slot yet, and
// the message says so instead of naming a plausible package.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TABLE_FILE = 'packages/spec/src/system/core-services.zod.ts';

/** Every package name declared anywhere in the workspace. */
function workspacePackageNames() {
  const names = new Set();
  const roots = ['packages', join('packages', 'plugins'), join('packages', 'services')];
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
      + `    the '${slot}' slot, or use \`null\` if nothing ships for it yet.`,
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
console.log(
  `✓ check:service-providers — ${table.size} slot(s): ${named} name a real workspace `
  + `package, ${table.size - named} correctly report that nothing ships yet.`,
);
