#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * tenant-audit-census-replay -- the scripted two-branch replay that measures
 * whether two PRs adding a write call site in DIFFERENT packages conflict on the
 * tenant-audit census artefacts.
 *
 *   node scripts/tenant-audit-census-replay.mjs                       # base = HEAD, expect clean
 *   node scripts/tenant-audit-census-replay.mjs --base <ref> --expect conflict   # the control
 *   node scripts/tenant-audit-census-replay.mjs --keep                # leave the scratch clone
 *
 * ## What it does, in order
 *
 *   1. A throwaway `git clone --shared` of this repository, checked out at the
 *      base commit. ⛔ Never this worktree: nothing here touches its index, its
 *      working tree or any of its refs (a worktree shares every ref but four,
 *      AGENTS.md), and the clone registers NO merge driver, which is the
 *      condition GitHub's server-side merge runs under.
 *   2. Branch A adds one write call site in package X and runs
 *      `node scripts/tenant-audit-census.mjs --write`; branch B, from the same
 *      base, does the same in package Y. Each commits what `--write` wrote, as
 *      a PR author would.
 *   3. `git merge-tree --write-tree A B` -- its exit code is the verdict: 0 is a
 *      clean merge, 1 is a conflict, whose paths are printed.
 *   4. On a clean merge, the merged tree is checked out and the census is held
 *      to it: a fresh `--write` must change nothing (`git status` stays empty),
 *      `node scripts/check-tenant-audit-census.mjs` must pass, and each probe
 *      site must be certified by the shard of its own package.
 *
 * `--expect clean|conflict` turns the verdict into the exit code (0 when the
 * outcome is the expected one), so the CONTROL -- the same replay on a base whose
 * census is one page and one ledger file -- is a run that must answer
 * `conflict`, and says so by exiting 0.
 *
 * ⚠️ It walks the census five times (two `--write`s, one on the merge, the gate),
 * about half a minute each on this corpus. It is a measurement to re-run, not a
 * CI gate: a census change that reintroduces a cross-package total is refused by
 * the gate's own self-test and by `LIVE_TOTAL_PROSE_SHAPES`; this replay is the
 * end-to-end evidence that the artefacts merge apart.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The two probes: one write call site each, in two different packages. */
export const PROBES = [
  {
    branch: 'replay-a',
    pkg: 'packages/services/service-job',
    file: 'packages/services/service-job/src/tenant-audit-replay-probe.ts',
    object: 'sys_job',
  },
  {
    branch: 'replay-b',
    pkg: 'packages/plugins/plugin-sharing',
    file: 'packages/plugins/plugin-sharing/src/tenant-audit-replay-probe.ts',
    object: 'sys_user',
  },
];

/** A probe source: a corpus-declared engine type and one elevated insert through it. */
export function probeSource(object) {
  return [
    '// A replay probe: one write call site the census must place and certify.',
    'interface ReplayProbeEngine {',
    '  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;',
    '}',
    '',
    'export async function tenantAuditReplayProbe(engine: ReplayProbeEngine): Promise<void> {',
    `  await engine.insert('${object}', { name: 'replay' }, { context: { isSystem: true } });`,
    '}',
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const out = { base: 'HEAD', expect: 'clean', keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i];
    else if (a === '--expect') out.expect = argv[++i];
    else if (a === '--keep') out.keep = true;
    else throw new Error(`tenant-audit-census-replay: unknown argument ${JSON.stringify(a)}`);
  }
  if (!out.base) throw new Error('tenant-audit-census-replay: --base needs a ref');
  if (out.expect !== 'clean' && out.expect !== 'conflict') {
    throw new Error(`tenant-audit-census-replay: --expect is clean or conflict, not ${JSON.stringify(out.expect)}`);
  }
  return out;
}

function git(cwd, args, opts = {}) {
  return execFileSync('git', [
    '-c', 'user.name=tenant-audit-census-replay', '-c', 'user.email=replay@invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    ...args,
  ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** Run a census script inside the clone; returns { status, output }. */
function node(cwd, script, args) {
  const r = spawnSync(process.execPath, [join(cwd, script), ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function say(line) {
  process.stdout.write(`${line}\n`);
}

export function replay({ base = 'HEAD', expect = 'clean', keep = false } = {}) {
  const baseSha = git(ROOT, ['rev-parse', '--verify', `${base}^{commit}`]).trim();
  const dir = mkdtempSync(join(tmpdir(), 'tenant-audit-replay-'));
  say(`replay: base ${base} = ${baseSha}`);
  say(`replay: scratch clone ${dir}`);
  try {
    git(dir, ['clone', '-q', '--shared', '--no-checkout', ROOT, '.']);
    git(dir, ['checkout', '-q', '--detach', baseSha]);
    // The census imports `typescript`; the clone borrows this checkout's install.
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
    appendFileSync(join(dir, '.git', 'info', 'exclude'), '\nnode_modules\n');

    for (const probe of PROBES) {
      git(dir, ['checkout', '-q', '-b', probe.branch, baseSha]);
      mkdirSync(dirname(join(dir, probe.file)), { recursive: true });
      writeFileSync(join(dir, probe.file), probeSource(probe.object));
      // ⚠️ The census reads TRACKED sources only, so the probe is committed
      // before `--write` runs -- exactly the order a PR author's tree is in.
      git(dir, ['add', probe.file]);
      git(dir, ['commit', '-q', '-m', `probe: a write call site in ${probe.pkg}`]);
      const w = node(dir, 'scripts/tenant-audit-census.mjs', ['--write']);
      if (w.status !== 0) throw new Error(`--write on ${probe.branch} exited ${w.status}:\n${w.output}`);
      const touched = w.output.split('\n').filter((l) => / (rewrote|created|removed) /.test(l));
      say(`replay: ${probe.branch} (${probe.pkg}) --write touched ${touched.length} file(s):`);
      for (const l of touched) say(`    ${l.replace(/^tenant-audit-census: /, '')}`);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', `census: --write after the probe in ${probe.pkg}`]);
    }

    const [a, b] = PROBES.map((p) => p.branch);
    const mt = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', a, b], { cwd: dir, encoding: 'utf8' });
    say(`replay: git merge-tree --write-tree ${a} ${b} :: exit ${mt.status}`);
    let outcome;
    if (mt.status === 0) {
      outcome = 'clean';
    } else if (mt.status === 1) {
      outcome = 'conflict';
      const lines = mt.stdout.split('\n');
      const blank = lines.indexOf('');
      const conflicted = lines.slice(1, blank === -1 ? undefined : blank).filter(Boolean);
      say(`replay: CONFLICT in ${conflicted.length} path(s):`);
      for (const p of conflicted) say(`    ${p}`);
    } else {
      throw new Error(`git merge-tree exited ${mt.status} -- not a merge verdict:\n${mt.stderr}`);
    }

    if (outcome === 'clean') {
      const tree = mt.stdout.split('\n')[0].trim();
      const merge = git(dir, ['commit-tree', tree, '-p', a, '-p', b, '-m', 'replay merge']).trim();
      git(dir, ['checkout', '-q', '--detach', merge]);
      const w = node(dir, 'scripts/tenant-audit-census.mjs', ['--write']);
      const status = git(dir, ['status', '--porcelain']).trim();
      say(`replay: merged tree --write :: exit ${w.status}; git status --porcelain after it: ${status === '' ? '(empty)' : `\n${status}`}`);
      const gate = node(dir, 'scripts/check-tenant-audit-census.mjs', []);
      const verdict = gate.output.split('\n').filter((l) => /^(✓|✗) check-tenant-audit-census/.test(l));
      const total = /^ {2}Write call sites +(\d+)$/m.exec(gate.output);
      say(`replay: merged tree gate :: exit ${gate.status}; ${verdict.join(' ') || '(no verdict line)'}`);
      if (total) say(`replay: merged tree census total, as the gate prints it: ${total[1]} write call sites`);
      const certified = PROBES.map((p) => {
        const shard = join(dir, 'docs/audits/2026-08-tenant-audit-write-call-sites.counts',
          `${p.pkg.split('/').slice(1).join('/')}.md`);
        let text = '';
        try { text = readFileSync(shard, 'utf8'); } catch { /* reported below */ }
        const ok = text.includes(`| \`${p.file}\` | \`insert\` | \`${p.object}\` |`);
        say(`replay: ${p.file} certified by its package shard: ${ok ? 'yes' : 'NO'}`);
        return ok;
      });
      if (w.status !== 0 || status !== '' || gate.status !== 0 || certified.includes(false)) {
        if (gate.status !== 0) say(gate.output);
        say('replay: ✗ the merge was clean but the merged tree is NOT a passing census');
        outcome = 'clean-but-wrong';
      }
    }

    const ok = outcome === expect;
    say(`replay: ${ok ? '✓' : '✗'} outcome ${outcome}, expected ${expect}`);
    return ok ? 0 : 1;
  } finally {
    if (keep) say(`replay: kept ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

if (isEntrypoint(import.meta.url)) process.exit(replay(parseArgs(process.argv.slice(2))));
