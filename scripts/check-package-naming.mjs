#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-package-naming — a new workspace package is named by its KIND, and the
 * generic `plugin-` prefix is frozen at the ten packages that already carry it.
 *
 *   node scripts/check-package-naming.mjs                 # the gate, on this tree
 *   node scripts/check-package-naming.mjs --root <dir>    # judge another checkout
 *   node scripts/check-package-naming.mjs --self-test     # verify the checker itself, offline
 *
 * ## Why
 *
 * Maintainer ruling, 2026-11-03 (#29710), verbatim and untranslated, on where
 * the push channel of #29041 lives: 「应该用 service-*，包括如何制定仓库规则，
 * 避免类似的问题」 and 「plugin- 太笼统，是不是建议逐渐退役这个名字。」
 *
 * ADR-0012 named that package `plugin-notification-push`. The tree's precedent
 * said otherwise — every kernel-managed service lives in `packages/services/`
 * as `@objectstack/service-<name>`, and `packages/plugins/` already holds
 * kind-named packages with no `plugin-` prefix (`embedder-openai`,
 * `knowledge-memory`, `knowledge-ragflow`, `organizations`). Nothing written
 * held either fact, so the name almost shipped. A published name cannot be
 * taken back without a major, so the rule has to bite before the first
 * publish, which is in review, not after.
 *
 * ## The two rules
 *
 *   services   every workspace package whose directory sits directly under
 *              `packages/services/` is named `@objectstack/service-<x>`, and
 *              `<x>` with the prefix is its directory basename — the npm name
 *              and the folder say the same thing.
 *   plugin-    the set of `@objectstack/plugin-*` names in the workspace is a
 *              shrink-only ratchet, `FROZEN_PLUGIN_NAMES` below. A name outside
 *              it is red; the only remedy is to name the package by its kind.
 *              A frozen name the tree no longer carries is red too, so the set
 *              can only shrink and never silently keeps a dead slot open.
 *
 * Scope, stated rather than implied: the ratchet reads the `@objectstack/`
 * scope only. The `@object-ui/plugin-*` packages under `ui/packages/` (18 at
 * landing) are a separate scope with its own naming convention and are not in
 * the frozen set. A `@objectstack/service-*` package outside
 * `packages/services/` (0 at landing) is not judged here either.
 *
 * ⛔ No remedy here renames or moves an existing package. The ten frozen names
 * are published, with 15–392 references each outside their own directories;
 * renaming one is a public break (ADR-0087 tombstone, `check-changeset-no-major`).
 * The prefix is retired for NEW names only. Growing the frozen set is refused
 * outright, not offered: a package that genuinely needs a `plugin-` name is a
 * new maintainer ruling, and that ruling edits this header first.
 *
 * ## Inputs
 *
 * The workspace membership comes from `scripts/workspace-enumerator.mjs`, the
 * one parse of `pnpm-workspace.yaml`. A lit control refuses an enumeration
 * below `LIT_CONTROL_FLOOR` packages, one without `@objectstack/spec`, or one
 * with no member under `packages/services/` — an enumeration that stops
 * reading the tree must say so, never compare an empty set green.
 *
 * Reads manifests only. No build, no network, no pnpm invocation, sub-second.
 *
 * ## Exit codes
 *
 *   0  every rule holds
 *   1  a naming finding — each one named with its rule and its remedy
 *   2  prerequisite not met — the workspace could not be enumerated, or the
 *      lit control failed. Never 0.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceEnumerationError, workspacePackages } from './workspace-enumerator.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const EXIT_CLEAN = 0;
const EXIT_FINDING = 1;
const EXIT_PREREQUISITE = 2;
const LIT_CONTROL_FLOOR = 50;
const SCOPE = '@objectstack/';
const SERVICES_DIR = 'packages/services/';
const SERVICE_PREFIX = 'service-';
const PLUGIN_PREFIX = 'plugin-';
const KIND_EXAMPLES = '`service-` (a kernel-managed service, in packages/services/), `connector-`, `driver-`, `embedder-`, `knowledge-`';

/**
 * The ten `@objectstack/plugin-*` names the tree carried when the prefix was
 * frozen (origin/main c9636f1e, 2026-11-03). Shrink-only: delete a row when its
 * package leaves the workspace; never add one. #29709's rule text names the
 * same ten.
 */
const FROZEN_PLUGIN_NAMES = Object.freeze([
  '@objectstack/plugin-approvals',
  '@objectstack/plugin-audit',
  '@objectstack/plugin-auth',
  '@objectstack/plugin-dev',
  '@objectstack/plugin-email',
  '@objectstack/plugin-hono-server',
  '@objectstack/plugin-pinyin-search',
  '@objectstack/plugin-security',
  '@objectstack/plugin-sharing',
  '@objectstack/plugin-webhooks',
]);

/**
 * The rule, as a pure function over `{ dir, name }` rows, so the self-test can
 * drive it with shapes a clean tree does not contain.
 *
 * @param {Array<{ dir: string, name: unknown }>} rows
 * @param {readonly string[]} frozen
 * @returns {{ exit: number, lines: string[] }}
 */
export function judge(rows, frozen = FROZEN_PLUGIN_NAMES) {
  const names = rows.map((r) => r.name).filter((n) => typeof n === 'string');
  const services = rows.filter((r) => r.dir.startsWith(SERVICES_DIR) && !r.dir.slice(SERVICES_DIR.length).includes('/'));
  if (rows.length < LIT_CONTROL_FLOOR || !names.includes(`${SCOPE}spec`) || services.length === 0) {
    return {
      exit: EXIT_PREREQUISITE,
      lines: [
        `PREREQUISITE NOT MET: lit control failed — ${rows.length} workspace package(s) enumerated (floor ${LIT_CONTROL_FLOOR}), `
          + `${names.includes(`${SCOPE}spec`) ? '' : `no ${SCOPE}spec, `}${services.length} under ${SERVICES_DIR}. `
          + 'The enumeration no longer reads this tree; refusing to report an empty population as clean.',
      ],
    };
  }

  const lines = [];
  for (const { dir, name } of services) {
    const base = dir.slice(SERVICES_DIR.length);
    if (typeof name !== 'string' || !name.startsWith(`${SCOPE}${SERVICE_PREFIX}`)) {
      lines.push(
        `[services-prefix] ${dir} is named ${typeof name === 'string' ? `\`${name}\`` : '(no name)'}; every package in ${SERVICES_DIR} is a kernel-managed service `
          + `and is named \`${SCOPE}${SERVICE_PREFIX}NAME\`. REMEDY: name it \`${SCOPE}${base.startsWith(SERVICE_PREFIX) ? base : `${SERVICE_PREFIX}${base.replace(/^plugin-/, '')}`}\` `
          + `with a directory to match, or, if it is not a kernel-managed service, move it out of ${SERVICES_DIR} and name it by its kind (${KIND_EXAMPLES}).`,
      );
      continue;
    }
    if (name !== `${SCOPE}${base}`) {
      lines.push(
        `[dir-mismatch] ${dir} holds \`${name}\`; in ${SERVICES_DIR} the directory basename equals the unscoped package name. `
          + `REMEDY: rename the directory to ${SERVICES_DIR}${name.slice(SCOPE.length)}, or the package to \`${SCOPE}${base}\` before its first publish.`,
      );
    }
  }

  const frozenSet = new Set(frozen);
  const pluginRows = rows.filter((r) => typeof r.name === 'string' && r.name.startsWith(`${SCOPE}${PLUGIN_PREFIX}`));
  for (const { dir, name } of pluginRows) {
    if (frozenSet.has(name)) continue;
    lines.push(
      `[plugin-prefix] ${dir} is named \`${name}\`; the \`${SCOPE}${PLUGIN_PREFIX}\` prefix is frozen at the ${frozen.length} packages that already carry it `
        + `(maintainer ruling 2026-11-03, #29710: the prefix is too generic and is being retired). REMEDY: name it by its kind — ${KIND_EXAMPLES} — `
        + 'the way packages/plugins/ already holds embedder-openai and knowledge-memory. The frozen set does not grow.',
    );
  }
  const live = new Set(pluginRows.map((r) => r.name));
  for (const name of frozen) {
    if (live.has(name)) continue;
    lines.push(
      `[stale-row] FROZEN_PLUGIN_NAMES in scripts/check-package-naming.mjs lists \`${name}\` and no workspace package carries that name any more. `
        + 'The set is shrink-only. REMEDY: delete the row, so the slot cannot be reused by a new package.',
    );
  }

  if (lines.length) return { exit: EXIT_FINDING, lines };
  return {
    exit: EXIT_CLEAN,
    lines: [
      `✓ check-package-naming: ${rows.length} workspace package(s); all ${services.length} in ${SERVICES_DIR} are \`${SCOPE}${SERVICE_PREFIX}*\` `
        + `named after their directory; the \`${SCOPE}${PLUGIN_PREFIX}*\` set is exactly the ${frozen.length} frozen names.`,
    ],
  };
}

/** @returns {{ rows: Array<{ dir: string, name: unknown }> } | { error: string }} */
export function readRows(root) {
  try {
    return { rows: workspacePackages(root).map(({ dir, manifest }) => ({ dir, name: manifest.name })) };
  } catch (err) {
    if (err instanceof WorkspaceEnumerationError) return { error: `PREREQUISITE NOT MET: ${err.message}` };
    throw err;
  }
}

// ── Self-test: batteries, floor, handshake ──────────────────────────────────
//
// Table-driven; the ROW is the battery, its label is registered before it runs,
// and the verdict flag below is set only after the success line prints. A
// pinned TOTAL would let a deleted row delete its floor.
let selfTestReachedVerdict = false;
const SELF_TEST_BATTERIES = Object.freeze({
  'clean — services conform and the plugin set equals the frozen set → exit 0': 1,
  'fixture tree — packages/services/plugin-x named @objectstack/plugin-x → exit 1 [services-prefix] and [plugin-prefix]': 1,
  'fixture tree — an eleventh @objectstack/plugin-* in packages/plugins → exit 1 [plugin-prefix] naming it': 1,
  'a services package whose name is not service-* → exit 1 [services-prefix]': 1,
  'a services package with no name → exit 1 [services-prefix]': 1,
  'a service-* name in a directory of another name → exit 1 [dir-mismatch]': 1,
  'a frozen name the tree no longer carries → exit 1 [stale-row]': 1,
  'a plugin- name in another scope (@object-ui) is not judged → exit 0': 1,
  'a kind-named package in packages/plugins is not judged → exit 0': 1,
  'a nested directory under packages/services is not a services member': 1,
  'the plugin-prefix remedy names the kind and never offers growing the set': 1,
  'lit control — a population below the floor → exit 2, never 0': 1,
  'lit control — no member under packages/services → exit 2': 1,
  'an unenumerable root (no pnpm-workspace.yaml) → exit 2 naming it': 1,
  'live tree — the real workspace is clean and carries exactly the ten frozen names': 1,
});
const SELF_TEST_BATTERY_FLOOR = 15;

function selfTest() {
  const filler = Array.from({ length: LIT_CONTROL_FLOOR }, (_, i) => ({ dir: `packages/filler-${i}`, name: `${SCOPE}filler-${i}` }));
  const base = () => [
    ...filler,
    { dir: 'packages/spec', name: `${SCOPE}spec` },
    { dir: 'packages/services/service-sms', name: `${SCOPE}service-sms` },
    { dir: 'packages/services/service-cache', name: `${SCOPE}service-cache` },
    ...FROZEN_PLUGIN_NAMES.map((n) => ({ dir: `packages/plugins/${n.slice(SCOPE.length)}`, name: n })),
    { dir: 'packages/plugins/embedder-openai', name: `${SCOPE}embedder-openai` },
  ];
  const tags = (r) => r.lines.map((l) => /^\[([a-z-]+)\]/.exec(l)?.[1]).filter(Boolean).sort();
  /** Write a minimal workspace on disk and judge it through the real enumerator. */
  const onDisk = (extra) => {
    const root = mkdtempSync(join(tmpdir(), 'check-package-naming-'));
    try {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n  - packages/plugins/*\n  - packages/services/*\n');
      for (const { dir, name } of [...base(), ...extra]) {
        mkdirSync(join(root, dir), { recursive: true });
        writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name }));
      }
      const read = readRows(root);
      return read.error ? { exit: EXIT_PREREQUISITE, lines: [read.error] } : judge(read.rows);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const cases = [
    { label: 'clean — services conform and the plugin set equals the frozen set → exit 0', run: () => judge(base()).exit === EXIT_CLEAN },
    { label: 'fixture tree — packages/services/plugin-x named @objectstack/plugin-x → exit 1 [services-prefix] and [plugin-prefix]', run: () => { const r = onDisk([{ dir: 'packages/services/plugin-x', name: `${SCOPE}plugin-x` }]); return r.exit === EXIT_FINDING && tags(r).join() === 'plugin-prefix,services-prefix' && r.lines.every((l) => l.includes('packages/services/plugin-x')); } },
    { label: 'fixture tree — an eleventh @objectstack/plugin-* in packages/plugins → exit 1 [plugin-prefix] naming it', run: () => { const r = onDisk([{ dir: 'packages/plugins/plugin-notification-push', name: `${SCOPE}plugin-notification-push` }]); return r.exit === EXIT_FINDING && tags(r).join() === 'plugin-prefix' && r.lines[0].includes(`${SCOPE}plugin-notification-push`); } },
    { label: 'a services package whose name is not service-* → exit 1 [services-prefix]', run: () => { const r = judge([...base(), { dir: 'packages/services/push', name: `${SCOPE}push` }]); return r.exit === EXIT_FINDING && tags(r).join() === 'services-prefix' && r.lines[0].includes(`\`${SCOPE}service-push\``); } },
    { label: 'a services package with no name → exit 1 [services-prefix]', run: () => { const r = judge([...base(), { dir: 'packages/services/service-push', name: undefined }]); return r.exit === EXIT_FINDING && tags(r).join() === 'services-prefix' && r.lines[0].includes('(no name)'); } },
    { label: 'a service-* name in a directory of another name → exit 1 [dir-mismatch]', run: () => { const r = judge([...base(), { dir: 'packages/services/service-push', name: `${SCOPE}service-notification-push` }]); return r.exit === EXIT_FINDING && tags(r).join() === 'dir-mismatch'; } },
    { label: 'a frozen name the tree no longer carries → exit 1 [stale-row]', run: () => { const r = judge(base().filter((x) => x.name !== `${SCOPE}plugin-dev`)); return r.exit === EXIT_FINDING && tags(r).join() === 'stale-row' && r.lines[0].includes(`${SCOPE}plugin-dev`); } },
    { label: 'a plugin- name in another scope (@object-ui) is not judged → exit 0', run: () => judge([...base(), { dir: 'ui/packages/plugin-grid', name: '@object-ui/plugin-grid' }]).exit === EXIT_CLEAN },
    { label: 'a kind-named package in packages/plugins is not judged → exit 0', run: () => judge([...base(), { dir: 'packages/plugins/knowledge-memory', name: `${SCOPE}knowledge-memory` }]).exit === EXIT_CLEAN },
    { label: 'a nested directory under packages/services is not a services member', run: () => judge([...base(), { dir: 'packages/services/service-sms/fixtures/demo', name: 'demo' }]).exit === EXIT_CLEAN },
    { label: 'the plugin-prefix remedy names the kind and never offers growing the set', run: () => { const l = judge([...base(), { dir: 'packages/plugins/plugin-x', name: `${SCOPE}plugin-x` }]).lines[0]; return l.includes('REMEDY: name it by its kind') && l.includes('The frozen set does not grow.') && !/add (it|the name|a row)/i.test(l); } },
    { label: 'lit control — a population below the floor → exit 2, never 0', run: () => { const r = judge(base().slice(LIT_CONTROL_FLOOR)); return r.exit === EXIT_PREREQUISITE && r.lines[0].startsWith('PREREQUISITE NOT MET: lit control failed'); } },
    { label: 'lit control — no member under packages/services → exit 2', run: () => judge(base().filter((x) => !x.dir.startsWith(SERVICES_DIR))).exit === EXIT_PREREQUISITE },
    { label: 'an unenumerable root (no pnpm-workspace.yaml) → exit 2 naming it', run: () => { const root = mkdtempSync(join(tmpdir(), 'check-package-naming-empty-')); try { const r = readRows(root); return Boolean(r.error) && r.error.startsWith('PREREQUISITE NOT MET') && r.error.includes('pnpm-workspace.yaml'); } finally { rmSync(root, { recursive: true, force: true }); } } },
    { label: 'live tree — the real workspace is clean and carries exactly the ten frozen names', run: () => { const read = readRows(REPO_ROOT); if (read.error) return false; const live = read.rows.filter((x) => typeof x.name === 'string' && x.name.startsWith(`${SCOPE}${PLUGIN_PREFIX}`)).map((x) => x.name).sort(); return judge(read.rows).exit === EXIT_CLEAN && FROZEN_PLUGIN_NAMES.length === 10 && live.join() === [...FROZEN_PLUGIN_NAMES].sort().join(); } },
  ];
  const seen = new Map();
  let failed = 0;
  for (const c of cases) {
    seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
    let ok = false;
    try { ok = c.run(); } catch (e) { console.error(`  ✗ ${c.label} — threw ${e.message}`); failed += 1; continue; }
    if (ok) console.log(`  ✓ ${c.label}`); else { console.error(`  ✗ ${c.label}`); failed += 1; }
  }
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = (msg) => { console.error(`✗ self-test floor: ${msg}`); failed += 1; };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  for (const [name] of seen) if (!declared.includes(name)) floor(`case "${name}" is attributed to no declared battery.`);
  for (const name of declared) if ((seen.get(name) ?? 0) < SELF_TEST_BATTERIES[name]) floor(`battery "${name}" DID NOT RUN (${seen.get(name) ?? 0} of ${SELF_TEST_BATTERIES[name]} pinned).`);
  if (failed > 0) { console.error(`\n✗ check-package-naming self-test: ${failed} failure(s) (cases and floor).`); process.exit(1); }
  console.log(`\n✓ check-package-naming self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) { console.error('\n✗ check-package-naming self-test: selfTest() returned without reaching its verdict.'); process.exit(1); }
    return;
  }
  const i = argv.indexOf('--root');
  const root = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : REPO_ROOT;
  const read = readRows(root);
  if (read.error) { console.error(read.error); process.exit(EXIT_PREREQUISITE); }
  const verdict = judge(read.rows);
  for (const l of verdict.lines) (verdict.exit === EXIT_CLEAN ? console.log : console.error)(l);
  process.exit(verdict.exit);
}

main();
