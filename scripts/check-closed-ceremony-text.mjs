#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-closed-ceremony-text (#24581) -- no shipped refusal, upgrade text or
 * pending changeset says the organization-ownership ceremony is closed.
 *
 *   node scripts/check-closed-ceremony-text.mjs              # the sweep (the gate)
 *   node scripts/check-closed-ceremony-text.mjs --self-test  # the rule itself
 *
 * ## Why
 *
 * The 18.0 pre-releases refused `os migrate organization-ownership` on every
 * database, and a family of refusals, boot warnings, upgrade-guide entries,
 * docs and changesets learned to say so: "18.0 supports fresh installs only",
 * "keep a v17 database on a 17.x release until the 18.x release that carries
 * the upgrade path". Steps 5 and 6 of the 18.x line opened the ceremony, and a
 * sentence like that left anywhere sends an operator away from the one command
 * that upgrades their database. Each of those surfaces carries its own wording
 * pin; this gate holds the property none of them can hold about the others:
 * that the sentence is gone from all of them, including the one written next.
 *
 * ## The population
 *
 * What ships or is published: package sources (`packages/**`, never a test
 * file, which may name the sentence to assert its absence), the docs site
 * (`content/docs/**`) and the changesets still pending (`.changeset/*.md` at
 * the root; `.changeset/pre/` holds the ones a pre-release already consumed,
 * whose text is published history). Out of scope by rule: `docs/adr/**` and
 * `content/docs/releases/**` (records of what was decided and released), and
 * every `CHANGELOG.md` (release-owned).
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The population, for `scripts/pm/dispatch-gates.mjs` (the `ROOT_DIR_WATCH_HINTS` idiom). */
export const ROOT_DIR_WATCH_HINTS = ['packages/**', 'content/docs/**', '.changeset/**'];

/** What the closed ceremony's wording said. Each is a sentence an open ceremony never ships. */
export const CLOSED_CEREMONY_PHRASES = Object.freeze([
  { id: 'fresh-installs-only', re: /fresh installs? only/i },
  { id: 'keep-on-17x', re: /keep (?:a|this|the|your) (?:v17 )?(?:development )?database on a 17\.x release/i },
  { id: 'carries-the-upgrade-path', re: /the 18\.x release that carries the upgrade path/i },
  { id: 'upgrade-path-arrives-later', re: /upgrade path (?:for an existing database )?arrives in a later 18\.x release/i },
  { id: 'in-a-later-18x-release', re: /\bin a later 18\.x release\b/i },
  { id: 'ceremony-still-refuses', re: /(?:ceremony|command),? (?:which )?(?:still )?refuses(?: in this release| on every database|, plan and apply)/i },
  { id: 'eighteen-refuses-the-command', re: /\b18\.0 refuses (?:it|this invocation|every (?:plan|invocation)|plan and apply)/i },
  { id: 'until-then-it-refuses', re: /until then (?:the ceremony|this command|the command) refuses/i },
]);

/** Is `path` (repo-relative, `/`-separated) in the population? */
export function inPopulation(path) {
  if (/(^|\/)(node_modules|dist)\//.test(path)) return false;
  if (/(^|\/)CHANGELOG\.md$/.test(path)) return false;
  if (path.startsWith('docs/adr/') || path.startsWith('content/docs/releases/')) return false;
  if (path.startsWith('.changeset/')) return /^\.changeset\/[^/]+\.md$/.test(path);
  if (path.startsWith('content/docs/')) return /\.(mdx?|json)$/.test(path);
  if (path.startsWith('packages/')) {
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /\/(test|tests|__tests__)\//.test(path)) return false;
    return /\.([cm]?[jt]sx?|mdx?|json)$/.test(path);
  }
  return false;
}

/** Every line of `text` that says one of the phrases: `{ line, phrase }`. */
export function findingsIn(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const p of CLOSED_CEREMONY_PHRASES) if (p.re.test(line)) out.push({ line: i + 1, phrase: p.id });
  });
  return out;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z', '--', ...ROOT_DIR_WATCH_HINTS.map((h) => h.replace(/\/\*\*$/, ''))], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

export function sweep() {
  const findings = [];
  let scanned = 0;
  for (const path of trackedFiles()) {
    if (!inPopulation(path)) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, path), 'utf8');
    } catch {
      continue; // deleted in the working tree
    }
    scanned++;
    for (const f of findingsIn(text)) findings.push({ path, ...f });
  }
  return { scanned, findings };
}

function main() {
  const { scanned, findings } = sweep();
  if (scanned === 0) {
    console.error('✗ check-closed-ceremony-text: the population is empty — nothing was read, so nothing is proven.');
    return 2;
  }
  if (findings.length === 0) {
    console.log(`✓ check-closed-ceremony-text: ${scanned} shipped file(s) read; none says the ownership ceremony is closed.`);
    return 0;
  }
  console.error(`✗ check-closed-ceremony-text: ${findings.length} line(s) say the organization-ownership ceremony is closed:\n`);
  for (const f of findings) console.error(`  ${f.path}:${f.line}  [${f.phrase}]`);
  console.error(
    '\n  The ceremony is open (#24581): `os migrate organization-ownership --out PLAN`, then\n'
      + '  `--apply --plan-file PLAN --backup-taken`, upgrades a database 17.x or an 18.0 pre-release created.\n'
      + '  Name that command instead. A test may spell the sentence to assert its absence; shipped text may not.',
  );
  return 1;
}

let selfTestReachedVerdict = false;

function selfTest() {
  let checked = 0;
  const failures = [];
  const t = (name, ok) => {
    checked++;
    if (!ok) failures.push(name);
  };

  // Each phrase reds on the sentence the 18.0 pre-releases shipped.
  const SHIPPED = '18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a '
    + '17.x release until the 18.x release that carries the upgrade path, and upgrade it there.';
  t('the shipped 18.0 sentence is found', findingsIn(SHIPPED).length >= 3);
  t('…its development spelling too', findingsIn('keep a v17 development database on a 17.x release').some((f) => f.phrase === 'keep-on-17x'));
  t('…and the docs callout', findingsIn('The upgrade path for an existing database arrives in a later 18.x release').some((f) => f.phrase === 'upgrade-path-arrives-later'));
  t('…a deferral to a later release', findingsIn('the walled half of this change ships in a later 18.x release.').some((f) => f.phrase === 'in-a-later-18x-release'));
  t('…a ceremony that still refuses', findingsIn('Upgrading waits for the upgrade ceremony, which still refuses in this release.').some((f) => f.phrase === 'ceremony-still-refuses'));
  t('…18.0 refusing the command', findingsIn('18.0 refuses this invocation, as it refuses every plan and apply').some((f) => f.phrase === 'eighteen-refuses-the-command'));
  t('…and step 4\'s docs sentence', findingsIn('Until then the ceremony refuses, so `os dev` stops at step 2').some((f) => f.phrase === 'until-then-it-refuses'));
  t('a finding names its line', JSON.stringify(findingsIn('a\nfresh install only\nb')) === JSON.stringify([{ line: 2, phrase: 'fresh-installs-only' }]));

  // The open ceremony's own text is not a finding.
  for (const open of [
    'This database carries no organization-ownership marker: 17.x or an 18.0 pre-release (18.0.0-next.*) created it',
    "Run 'os migrate organization-ownership --out PLAN' to write and review its plan, take a backup, then run it.",
    'A fresh install holds no legacy organization rows: there, the cause is the one named above.',
    'A database that does hold them was created by 17.x: run `os migrate organization-ownership` on it first.',
    'Fresh installs are supported under every posture: `single`, `group` and `isolated`.',
    'The 18.0 pre-releases refused it with `NOT_IMPLEMENTED`: a bare run writes the plan.',
    'A walled posture boots like `single`, under the same prerequisites as before the 18.0 pre-releases.',
  ]) t(`not a finding: ${open.slice(0, 50)}`, findingsIn(open).length === 0);

  // The population.
  for (const [path, want] of [
    ['packages/runtime/src/organization-ownership-boot-guard.ts', true],
    ['packages/runtime/src/organization-ownership-boot-guard.test.ts', false],
    ['packages/qa/dogfood/test/upgrade-18x-harness.dogfood.test.ts', false],
    ['packages/cli/test/helpers/config-miss-family.ts', false],
    ['packages/spec/src/migrations/entries/semantic/18.sys-metadata-organization-column-retired.ts', true],
    ['packages/cli/dist/index.js', false],
    ['packages/cli/CHANGELOG.md', false],
    ['content/docs/deployment/cli.mdx', true],
    ['content/docs/releases/v18.mdx', false],
    ['docs/adr/0131-total-organization-ownership-no-null-organization-id.md', false],
    ['.changeset/24581-organization-ownership-ceremony-open.md', true],
    ['.changeset/pre/15212-180-guards-fresh-single-only.md', false],
    ['.changeset/pre.json', false],
  ]) t(`population: ${path} → ${want}`, inPopulation(path) === want);

  // The watch hints declare what the sweep walks, and nothing else.
  t('every walk root is declared', ['packages', 'content/docs', '.changeset'].every((r) => ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)));
  t('and nothing undeclared is walked', ROOT_DIR_WATCH_HINTS.every((h) => ['packages', 'content/docs', '.changeset'].includes(h.replace(/\/\*\*$/, ''))));

  // The tree: a non-empty population.
  t('the population on this tree is not empty', sweep().scanned > 0);

  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(`check-closed-ceremony-text --self-test: ${failures.length} of ${checked} assertion(s) FAILED.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(`check-closed-ceremony-text --self-test: ${checked} assertion(s) passed.`);
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-closed-ceremony-text self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(selfTestCode);
  }
  process.exit(main());
}
