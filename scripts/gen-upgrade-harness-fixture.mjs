#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * gen-upgrade-harness-fixture — regenerate the 18.x line's upgrade-harness
 * fixture (#24522) from a NAMED git ref: the database an install of that ref
 * holds after real use, dumped to reviewable SQL text.
 *
 *   node scripts/gen-upgrade-harness-fixture.mjs --ref <ref>
 *   node scripts/gen-upgrade-harness-fixture.mjs --ref <ref> --checkout <dir>
 *
 * `--ref` names the release the fixture stands for. Two fixtures exist:
 *
 *   - `fixture-18.0/`, the pre-release shape (`main` at or after `f8ef14487`,
 *     the card's rule), written by default;
 *   - `fixture-18.0.0/`, the GA: a database the published 18.0.0 created
 *     (#24884), written with
 *     `--ref @objectstack/cli@18.0.0 --out packages/qa/dogfood/test/upgrade-harness/fixture-18.0.0`.
 *
 * ## What it does
 *
 * 1. Resolves `--ref` to a commit.
 * 2. Gets a BUILT checkout of that commit:
 *    - with `--checkout <dir>`: uses it, after proving its tree equals the
 *      ref's everywhere outside the harness's own files (`packages/qa/dogfood`
 *      and `scripts/`) — so a checkout carrying this harness on top of the ref
 *      is accepted, and one carrying any other change is refused;
 *    - without it: `git worktree add --detach` in a temporary directory,
 *      `pnpm install --frozen-lockfile`, and the dogfood package's build
 *      closure (`pnpm turbo run build --filter=@objectstack/dogfood`); the
 *      worktree is removed afterwards.
 * 3. Copies THIS checkout's populator (`packages/qa/dogfood/test/upgrade-harness/`)
 *    into that checkout when they differ — the populator drives the ref's code
 *    through its HTTP doors, so it is the one part that comes from HEAD.
 * 4. Runs it under `tsx`, from an empty working directory (a showcase boot
 *    writes `.objectstack/` relative to the cwd), with the dogfood suite's own
 *    two environment settings (`OS_CLOUD_URL=off`, `OS_REGISTRY_LOG=warn`).
 * 5. The populator boots the showcase over a fresh SQLite file, uses it, boots
 *    it once more, refuses an empty reshaped table, and writes
 *    `database.sql` and `manifest.json` into the fixture directory.
 *
 * ⛔ The fixture is not byte-reproducible: ids, timestamps and ciphertexts are
 * minted per run. What is reproducible is its COVERAGE — the census refuses a
 * run that leaves a reshaped table empty — and its provenance, which
 * `manifest.json` records (`ref`, `sha`).
 *
 * Exit codes: 0 written; 1 the populator or a build step failed; 2 a usage or
 * provenance refusal (bad ref, a checkout that is not the ref).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_DIR = 'packages/qa/dogfood/test/upgrade-harness';
const FIXTURE_DIR = join(HARNESS_DIR, 'fixture-18.0');
/** The paths a `--checkout` may differ from the ref in: the harness's own files. */
const HARNESS_PATHS = ['packages/qa/dogfood', 'scripts'];

function refuse(message) {
  console.error(`gen-upgrade-harness-fixture: ${message}`);
  process.exit(2);
}

function run(cmd, args, opts = {}) {
  console.error(`$ ${cmd} ${args.join(' ')}${opts.cwd ? `   (in ${opts.cwd})` : ''}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`gen-upgrade-harness-fixture: \`${cmd} ${args.join(' ')}\` exited ${r.status ?? r.signal}`);
    process.exit(1);
  }
}

const git = (args, cwd = REPO_ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const { values } = parseArgs({
  options: {
    ref: { type: 'string' },
    checkout: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!values.ref) refuse('--ref <git ref> is required (the 18.0 release tag, or main at or after f8ef14487)');

let sha;
try {
  sha = git(['rev-parse', '--verify', `${values.ref}^{commit}`]);
} catch {
  refuse(`--ref ${values.ref} does not resolve to a commit here (fetch it first)`);
}
const out = resolve(REPO_ROOT, values.out ?? FIXTURE_DIR);

let checkout;
let temporary = false;
if (values.checkout) {
  checkout = resolve(values.checkout);
  // The checkout must BE the ref outside the harness's own files: its tracked
  // tree and its working tree both, so an uncommitted edit is refused too.
  const exclude = HARNESS_PATHS.map((p) => `:(exclude)${p}`);
  const drift = spawnSync('git', ['diff', '--name-only', sha, '--', '.', ...exclude], { cwd: checkout, encoding: 'utf8' });
  if (drift.status !== 0) refuse(`cannot compare ${checkout} with ${sha}: ${drift.stderr.trim()}`);
  if (drift.stdout.trim() !== '') {
    refuse(`${checkout} differs from ${values.ref} (${sha.slice(0, 12)}) outside ${HARNESS_PATHS.join(', ')}:\n${drift.stdout.trim()}`);
  }
  if (!existsSync(join(checkout, 'node_modules'))) refuse(`${checkout} has no node_modules: install and build it first, or omit --checkout`);
} else {
  checkout = mkdtempSync(join(tmpdir(), 'upgrade-harness-ref-'));
  temporary = true;
  run('git', ['worktree', 'add', '--detach', checkout, sha], { cwd: REPO_ROOT });
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: checkout });
  run('pnpm', ['turbo', 'run', 'build', '--filter=@objectstack/dogfood', '--concurrency=2'], { cwd: checkout });
}

try {
  // The populator comes from HEAD; copy it in when the checkout's differs.
  const from = join(REPO_ROOT, HARNESS_DIR);
  const to = join(checkout, HARNESS_DIR);
  // The fixture DIRECTORIES stay the checkout's own; `fixture-manifest.ts`
  // is populator code and comes from HEAD like the rest.
  const isFixtureDir = (src) => /^fixture-[^/]*$/.test(relative(from, src)) && statSync(src).isDirectory();
  if (resolve(from) !== resolve(to)) cpSync(from, to, { recursive: true, filter: (src) => !isFixtureDir(src) });

  const work = mkdtempSync(join(tmpdir(), 'upgrade-harness-run-'));
  try {
    const tsx = join(checkout, 'node_modules', '.bin', 'tsx');
    run(tsx, [join(to, 'run-populate.ts'), '--db', join(work, 'fixture.db'), '--out', out, '--ref', values.ref, '--sha', sha], {
      cwd: work,
      env: { ...process.env, OS_CLOUD_URL: 'off', OS_REGISTRY_LOG: 'warn', NO_COLOR: '1' },
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
} finally {
  if (temporary) run('git', ['worktree', 'remove', '--force', checkout], { cwd: REPO_ROOT });
}

const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
console.log(`gen-upgrade-harness-fixture: wrote ${relative(REPO_ROOT, out)} from ${values.ref} (${sha.slice(0, 12)})`);
for (const t of manifest.reshaped) console.log(`  ${t.table.padEnd(26)} ${String(t.count).padStart(4)} rows   steps ${t.steps.join(',')}`);
