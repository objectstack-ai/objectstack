#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-harness-current -- is every harness-loaded file on `origin/main` already in the
 * shared (primary) checkout's HEAD? A seat-side fire-time reading; ⛔ not a CI gate.
 *
 *   node scripts/pm/check-harness-current.mjs [--shared <dir>] [--ref origin/main]
 *
 * The harness reads `.claude/settings.json`, `.claude/agents/*.md` and `.claude/hooks/*` from
 * the PRIMARY checkout when a session starts and never reloads them, so a touch that lands on
 * `origin/main` after that clone is inert for the running session -- measured: a session whose
 * primary checkout predated the MCP-write deny list still carried every denied tool. Worktrees
 * do not help (the harness never reads them) and the primary checkout is never advanced in place
 * (worktree-first), so the remedy is to close the shift and re-seat in a fresh session.
 *
 * Reads git only -- fetch first. Exit 0 = current; 1 = stale (each stale path printed with its
 * touch); 2 = undecidable: the ancestry test is negative on a SHALLOW clone and the touch is not
 * newer than HEAD, so the missing ancestor path may be a truncation, not a fact -- deepen, rerun.
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const PATHS = ['.claude/settings.json', '.claude/agents/*.md', '.claude/hooks/*'];
const argv = process.argv.slice(2);
const opt = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
const git = (dir, ...args) => {
  try {
    return { ok: true, out: execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() };
  } catch (error) {
    return { ok: false, out: String(error.stdout ?? '').trim() };
  }
};

const common = git(process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir');
const shared = opt('--shared', common.ok ? common.out.replace(/\/\.git$/, '') : undefined);
const ref = opt('--ref', 'origin/main');
const head = shared ? git(shared, 'rev-parse', 'HEAD') : { ok: false, out: '' };
if (!head.ok) { console.error(`check-harness-current: no git checkout at ${shared ?? '(cwd)'} -- pass --shared <dir>`); process.exit(2); }
const headTime = Number(git(shared, 'log', '-1', '--format=%ct', 'HEAD').out);
const shallow = git(shared, 'rev-parse', '--is-shallow-repository').out === 'true';
const short = (sha) => sha.slice(0, 10);
let stale = 0;
let undecided = 0;
for (const path of PATHS) {
  const touch = git(shared, 'log', '-1', '--format=%H %ct %cI', ref, '--', path);
  if (!touch.ok || !touch.out) { undecided += 1; console.log(`? ${path}: no touch of ${ref} visible from ${shared} (unfetched ref, or a shallow window) -- UNDECIDED`); continue; }
  const [sha, ct, ci] = touch.out.split(' ');
  if (git(shared, 'merge-base', '--is-ancestor', sha, 'HEAD').ok) { console.log(`✓ ${path}: latest touch ${short(sha)} (${ci}) is in the shared HEAD`); continue; }
  if (Number(ct) > headTime || !shallow) { stale += 1; console.log(`✗ ${path}: latest touch ${short(sha)} (${ci}) is NOT in the shared HEAD ${short(head.out)} -- STALE`); continue; }
  undecided += 1;
  console.log(`? ${path}: touch ${short(sha)} (${ci}) is not under HEAD in a SHALLOW clone and not newer than HEAD -- UNDECIDED, deepen and rerun`);
}
const verdict = stale
  ? `STALE -- ${stale} harness-loaded path(s) on ${ref} are not in ${shared} HEAD ${short(head.out)}: close the shift and re-seat in a fresh session; ⛔ never advance the shared checkout in place`
  : undecided ? `UNDECIDED -- ${undecided} path(s) could not be placed; fetch/deepen ${shared} and rerun` : `CURRENT -- every harness-loaded path on ${ref} is in ${shared} HEAD ${short(head.out)}`;
console.log(`check-harness-current: ${verdict}`);
process.exit(stale ? 1 : undecided ? 2 : 0);
