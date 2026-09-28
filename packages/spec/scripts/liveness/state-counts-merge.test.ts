// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The sharded liveness counts, asked of git the way GitHub asks it (#20361).
//
// WHY THIS TEST SPAWNS GIT. The defect the shards cure was never in a renderer:
// it was in a MERGE. `state-counts.md` was one generated file with a row per
// type and a shared `**total**` row, so every PR that moved a verdict rewrote
// that total. `merge=os-regen` defers the file in a LOCAL merge only; GitHub's
// server-side merge — the one that decides `mergeable` and builds the ref CI
// runs on — has no custom driver. Measured on the dispatch base `2b24b8b823`,
// in a bare probe clone with no driver registered, each side regenerated with
// the real `gen:liveness-counts`:
//
//   - `field.useGrouping` planned→dead against `sharing_rule.type`
//     planned→live: `git merge-tree` exit 1, CONFLICT (content) in
//     `packages/spec/liveness/state-counts.md` — the two rows are 36 lines
//     apart and the only overlap is the total row;
//   - the same `field` move against `sharing_rule.type` planned→dead, i.e. an
//     EQUAL delta: exit 0 and WRONG — both sides wrote the identical total, git
//     took it once, and the merged table said `dead 149` where the two moves
//     make 150.
//
// So the question a unit test of the renderer cannot answer — "do two PRs that
// move different types merge, and merge RIGHT, with no driver?" — is asked here
// of `git merge-tree` over the real renderer's output, in a throwaway repository
// that carries the real attribute line and no driver. The same-type pair is the
// lit control: it MUST still conflict (one file's own row changed twice), or a
// clean result above would be equally explained by a harness that cannot see a
// conflict at all.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { gitFreeEnv } from '../../../../scripts/git-env.mjs';

import {
  STATE_COUNTS_DIR,
  renderStateCountShards,
  writeStateCountShards,
  type StateCountsRow,
  type StatusColumn,
} from './readme-table.mts';

/** Every fixture git is LOCAL-ONLY and hermetic: no inherited `GIT_*`, no global or system config. */
const HERMETIC_ENV: NodeJS.ProcessEnv = (() => {
  const env = gitFreeEnv();
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
})();

const GIT_ARGS = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false'];

/** The dispatch base's rows for the types the moves below touch, plus an untouched neighbour. */
const BASE: readonly StateCountsRow[] = [
  { type: 'object', live: 50, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 1 },
  { type: 'field', live: 91, experimental: 0, 'live-elsewhere': 0, dead: 1, planned: 1 },
  { type: 'sharing_rule', live: 16, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 1 },
  { type: 'connector', live: 29, experimental: 0, 'live-elsewhere': 0, dead: 30, planned: 1 },
];

interface Move { type: string; from: StatusColumn; to: StatusColumn }

/** One ledger verdict moved — what a PR that flips a row does to the fold. */
function apply(rows: readonly StateCountsRow[], ...moves: Move[]): StateCountsRow[] {
  return rows.map((row) => {
    const next = { ...row };
    for (const m of moves) {
      if (m.type !== row.type) continue;
      next[m.from] -= 1;
      next[m.to] += 1;
    }
    return next;
  });
}

let repo: string;

function git(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('git', [...GIT_ARGS, ...args], { cwd: repo, encoding: 'utf8', env: HERMETIC_ENV });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function mustGit(...args: string[]): string {
  const r = git(...args);
  expect(r.status, `git ${args.join(' ')}\n${r.stderr}`).toBe(0);
  return r.stdout;
}

/** Commit the shards for `rows` on a new branch cut from `base`, exactly as the generator writes them. */
function branch(name: string, rows: readonly StateCountsRow[]): void {
  mustGit('checkout', '-q', '-b', name, 'base');
  writeStateCountShards(path.join(repo, STATE_COUNTS_DIR), renderStateCountShards(rows));
  mustGit('add', '-A');
  mustGit('commit', '-q', '-m', name);
}

/** `git merge-tree --write-tree` of two branches: its exit code, and the paths it names on a conflict. */
function mergeTree(a: string, b: string): { status: number | null; tree: string; conflicted: string[] } {
  const r = git('merge-tree', '--write-tree', '--name-only', '--no-messages', a, b);
  const [tree = '', ...rest] = r.stdout.trim().split('\n');
  return { status: r.status, tree, conflicted: rest.filter(Boolean) };
}

/** Every file of the merged tree, as `path -> bytes`. */
function treeFiles(tree: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of mustGit('ls-tree', '-r', '--name-only', tree).trim().split('\n')) {
    out.set(p, mustGit('show', `${tree}:${p}`));
  }
  return out;
}

/** What the generator would write for `rows`, as the tree paths it would occupy. */
function expectedFiles(rows: readonly StateCountsRow[]): Map<string, string> {
  const out = new Map<string, string>([['.gitattributes', ATTRIBUTES]]);
  for (const [name, text] of renderStateCountShards(rows)) out.set(`${STATE_COUNTS_DIR}/${name}`, text);
  return out;
}

// The real routing line, relative to this fixture's root. Carried so the fixture
// is what GitHub sees — the attribute present, its driver absent — rather than a
// repository that never asked for a driver at all.
const ATTRIBUTES = `${STATE_COUNTS_DIR}/** merge=os-regen\n`;

const FIELD_PLANNED_TO_DEAD: Move = { type: 'field', from: 'planned', to: 'dead' };
const FIELD_LIVE_TO_DEAD: Move = { type: 'field', from: 'live', to: 'dead' };
const SHARING_PLANNED_TO_LIVE: Move = { type: 'sharing_rule', from: 'planned', to: 'live' };
const SHARING_PLANNED_TO_DEAD: Move = { type: 'sharing_rule', from: 'planned', to: 'dead' };
const OBJECT_PLANNED_TO_DEAD: Move = { type: 'object', from: 'planned', to: 'dead' };

describe('state-counts/ shards — two PRs, no merge driver (#20361)', () => {
  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'os-state-counts-merge-'));
    mustGit('init', '-q', '-b', 'base');
    writeFileSync(path.join(repo, '.gitattributes'), ATTRIBUTES);
    writeStateCountShards(path.join(repo, STATE_COUNTS_DIR), renderStateCountShards(BASE));
    mustGit('add', '-A');
    mustGit('commit', '-q', '-m', 'base');

    branch('field-planned-dead', apply(BASE, FIELD_PLANNED_TO_DEAD));
    branch('field-live-dead', apply(BASE, FIELD_LIVE_TO_DEAD));
    branch('sharing-planned-live', apply(BASE, SHARING_PLANNED_TO_LIVE));
    branch('sharing-planned-dead', apply(BASE, SHARING_PLANNED_TO_DEAD));
    branch('object-planned-dead', apply(BASE, OBJECT_PLANNED_TO_DEAD));
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  // The premise of every case below: this is GitHub's merge, not ours. A
  // registered driver would defer the path and make "clean" mean nothing.
  it('merges with the attribute present and NO driver registered — the server-side shape', () => {
    expect(git('config', '--get', 'merge.os-regen.driver').status).toBe(1);
    expect(git('check-attr', 'merge', '--', `${STATE_COUNTS_DIR}/field.md`).stdout.trim()).toBe(
      `${STATE_COUNTS_DIR}/field.md: merge: os-regen`,
    );
  });

  it('a regeneration touches only the shard of the type that moved', () => {
    expect(mustGit('diff', '--name-only', 'base', 'field-planned-dead').trim()).toBe(`${STATE_COUNTS_DIR}/field.md`);
    expect(mustGit('diff', '--name-only', 'base', 'sharing-planned-live').trim()).toBe(
      `${STATE_COUNTS_DIR}/sharing_rule.md`,
    );
  });

  // THE CARD'S REPRODUCTION, now clean: the pair that conflicted on the total row.
  it('two moves of DIFFERENT types, different deltas: merges clean, and the result is the regeneration of both', () => {
    const m = mergeTree('field-planned-dead', 'sharing-planned-live');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    expect(treeFiles(m.tree)).toEqual(expectedFiles(apply(BASE, FIELD_PLANNED_TO_DEAD, SHARING_PLANNED_TO_LIVE)));
  });

  // The pair the single file merged CLEAN AND WRONG. Clean is not enough here:
  // the merged tree must equal what regenerating the merged ledgers writes.
  it('two moves of different types with an EQUAL delta: merges clean AND right — no shared line to double-count', () => {
    const m = mergeTree('field-planned-dead', 'sharing-planned-dead');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    expect(treeFiles(m.tree)).toEqual(expectedFiles(apply(BASE, FIELD_PLANNED_TO_DEAD, SHARING_PLANNED_TO_DEAD)));
  });

  // Adjacent rows conflicted in the single file even with no total (git refuses
  // two edits on touching lines). Different files cannot touch.
  it('two moves of ADJACENT types merge clean — the rows no longer share a file', () => {
    const m = mergeTree('object-planned-dead', 'field-planned-dead');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    expect(treeFiles(m.tree)).toEqual(expectedFiles(apply(BASE, OBJECT_PLANNED_TO_DEAD, FIELD_PLANNED_TO_DEAD)));
  });

  it('no merged tree carries a total — the sum is the reader\'s, not a file\'s', () => {
    const m = mergeTree('field-planned-dead', 'sharing-planned-live');
    for (const [p, text] of treeFiles(m.tree)) expect(text, p).not.toMatch(/^\|\s*\**total/im);
  });

  // THE LIT CONTROL. A same-type pair changes one file's one row twice, which is
  // a real conflict and must stay one — the residue sharding cannot remove, and
  // what the local driver still owns. Without it, every "exit 0" above is also
  // explained by a merge harness that never reports a conflict.
  it('two moves of the SAME type still conflict, on that type\'s shard and nowhere else', () => {
    const m = mergeTree('field-planned-dead', 'field-live-dead');
    expect(m.status).toBe(1);
    expect(m.conflicted).toEqual([`${STATE_COUNTS_DIR}/field.md`]);
  });
});
