// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The two sharded count artifacts, asked of git the way GitHub asks it (#20361).
//
// WHY THIS TEST SPAWNS GIT. The defect the shards cure was never in a renderer:
// it was in a MERGE. `liveness/state-counts.md` and the strictness ledger's
// `….counts.md` were each ONE generated file carrying per-unit rows AND shared
// totals that every PR moving a unit rewrote. `merge=os-regen` defers those
// paths in a LOCAL merge only; GitHub's server-side merge — the one that decides
// `mergeable` and builds the ref CI runs on — has no custom driver. Measured on
// the dispatch base `2b24b8b823`, in a bare probe clone with no driver
// registered, each side regenerated with the real generator:
//
//   - liveness, `field.useGrouping` planned→dead against `sharing_rule.type`
//     planned→live: `git merge-tree` exit 1, CONFLICT (content) in
//     `state-counts.md` — the two rows are 36 lines apart and the only overlap
//     is the total row;
//   - liveness, the same `field` move against `sharing_rule.type` planned→dead,
//     an EQUAL delta: exit 0 and WRONG — both sides wrote the identical total,
//     git took it once, and the merged table said `dead 149` where the two moves
//     make 150;
//   - strictness, one strict site added in `ui/` against two in `data/`: exit 1,
//     CONFLICT (content) in `….counts.md`, while both source files merged clean.
//
// So the question a unit test of a renderer cannot answer — "do two PRs that
// move different units merge, and merge RIGHT, with no driver?" — is asked here
// of `git merge-tree` over each real renderer's output, in a throwaway
// repository that carries the real attribute line and no driver. A same-unit
// pair is the lit control in each block: it MUST still conflict (one file's own
// rows changed twice), or a clean result would be equally explained by a
// harness that cannot see a conflict at all.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { gitFreeEnv } from '../../../scripts/git-env.mjs';

import { writeTextShardDir } from './lib/sharded-artifacts';
import { emptyBuckets, renderCountShards, type CountsModel } from './lib/strictness-ledger-doc';
import {
  STATE_COUNTS_DIR,
  renderStateCountShards,
  type StateCountsRow,
  type StatusColumn,
} from './liveness/readme-table.mts';

/** Every fixture git is LOCAL-ONLY and hermetic: no inherited `GIT_*`, no global or system config. */
const HERMETIC_ENV: NodeJS.ProcessEnv = (() => {
  const env = gitFreeEnv();
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
})();

const GIT_ARGS = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false'];

/**
 * A throwaway repository holding one shard directory, `dir`, routed to
 * `merge=os-regen` exactly as `.gitattributes` routes the real one — and with
 * no driver registered, which is what GitHub's merge sees.
 */
class ShardRepo {
  readonly root = mkdtempSync(path.join(tmpdir(), 'os-count-shards-merge-'));
  readonly attributes: string;

  constructor(readonly dir: string, base: ReadonlyMap<string, string>) {
    this.attributes = `${dir}/** merge=os-regen\n`;
    this.must('init', '-q', '-b', 'base');
    writeFileSync(path.join(this.root, '.gitattributes'), this.attributes);
    writeTextShardDir(path.join(this.root, dir), base);
    this.must('add', '-A');
    this.must('commit', '-q', '-m', 'base');
  }

  git(...args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('git', [...GIT_ARGS, ...args], { cwd: this.root, encoding: 'utf8', env: HERMETIC_ENV });
    if (r.error) throw r.error;
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  must(...args: string[]): string {
    const r = this.git(...args);
    expect(r.status, `git ${args.join(' ')}\n${r.stderr}`).toBe(0);
    return r.stdout;
  }

  /** Commit `shards` on a new branch cut from `base`, exactly as a generator writes them. */
  branch(name: string, shards: ReadonlyMap<string, string>): void {
    this.must('checkout', '-q', '-b', name, 'base');
    writeTextShardDir(path.join(this.root, this.dir), shards);
    this.must('add', '-A');
    this.must('commit', '-q', '-m', name);
  }

  /** `git merge-tree --write-tree` of two branches: exit code, tree, and the paths it names on a conflict. */
  merge(a: string, b: string): { status: number | null; tree: string; conflicted: string[] } {
    const r = this.git('merge-tree', '--write-tree', '--name-only', '--no-messages', a, b);
    const [tree = '', ...rest] = r.stdout.trim().split('\n');
    return { status: r.status, tree, conflicted: rest.filter(Boolean) };
  }

  /** Every file of a tree, as `path -> bytes`. */
  files(tree: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const p of this.must('ls-tree', '-r', '--name-only', tree).trim().split('\n')) {
      out.set(p, this.must('show', `${tree}:${p}`));
    }
    return out;
  }

  /** What the generator would leave in the tree for `shards`. */
  expected(shards: ReadonlyMap<string, string>): Map<string, string> {
    const out = new Map<string, string>([['.gitattributes', this.attributes]]);
    for (const [name, text] of shards) out.set(`${this.dir}/${name}`, text);
    return out;
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * liveness/state-counts/ — one shard per governed type
 * ══════════════════════════════════════════════════════════════════════════ */

/** The dispatch base's rows for the types the moves below touch. */
const LIVENESS_BASE: readonly StateCountsRow[] = [
  { type: 'object', live: 50, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 1 },
  { type: 'field', live: 91, experimental: 0, 'live-elsewhere': 0, dead: 1, planned: 1 },
  { type: 'sharing_rule', live: 16, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 1 },
  { type: 'connector', live: 29, experimental: 0, 'live-elsewhere': 0, dead: 30, planned: 1 },
];

interface Move { type: string; from: StatusColumn; to: StatusColumn }

/** Ledger verdicts moved — what a PR that flips rows does to the fold — rendered as the generator writes them. */
function liveness(...moves: Move[]): Map<string, string> {
  return renderStateCountShards(
    LIVENESS_BASE.map((row) => {
      const next = { ...row };
      for (const m of moves) {
        if (m.type !== row.type) continue;
        next[m.from] -= 1;
        next[m.to] += 1;
      }
      return next;
    }),
  );
}

const FIELD_PLANNED_TO_DEAD: Move = { type: 'field', from: 'planned', to: 'dead' };
const FIELD_LIVE_TO_DEAD: Move = { type: 'field', from: 'live', to: 'dead' };
const SHARING_PLANNED_TO_LIVE: Move = { type: 'sharing_rule', from: 'planned', to: 'live' };
const SHARING_PLANNED_TO_DEAD: Move = { type: 'sharing_rule', from: 'planned', to: 'dead' };
const OBJECT_PLANNED_TO_DEAD: Move = { type: 'object', from: 'planned', to: 'dead' };

describe('liveness/state-counts/ — two PRs, no merge driver (#20361)', () => {
  let repo: ShardRepo;

  beforeAll(() => {
    repo = new ShardRepo(STATE_COUNTS_DIR, liveness());
    repo.branch('field-planned-dead', liveness(FIELD_PLANNED_TO_DEAD));
    repo.branch('field-live-dead', liveness(FIELD_LIVE_TO_DEAD));
    repo.branch('sharing-planned-live', liveness(SHARING_PLANNED_TO_LIVE));
    repo.branch('sharing-planned-dead', liveness(SHARING_PLANNED_TO_DEAD));
    repo.branch('object-planned-dead', liveness(OBJECT_PLANNED_TO_DEAD));
  });
  afterAll(() => repo.dispose());

  // The premise of every case below: this is GitHub's merge, not ours. A
  // registered driver would defer the path and make "clean" mean nothing.
  it('merges with the attribute present and NO driver registered — the server-side shape', () => {
    expect(repo.git('config', '--get', 'merge.os-regen.driver').status).toBe(1);
    expect(repo.git('check-attr', 'merge', '--', `${STATE_COUNTS_DIR}/field.md`).stdout.trim()).toBe(
      `${STATE_COUNTS_DIR}/field.md: merge: os-regen`,
    );
  });

  it('a regeneration touches only the shard of the type that moved', () => {
    expect(repo.must('diff', '--name-only', 'base', 'field-planned-dead').trim()).toBe(`${STATE_COUNTS_DIR}/field.md`);
  });

  // THE CARD'S REPRODUCTION, now clean: the pair that conflicted on the total row.
  it('two moves of DIFFERENT types, different deltas: merges clean, and the result is the regeneration of both', () => {
    const m = repo.merge('field-planned-dead', 'sharing-planned-live');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    expect(repo.files(m.tree)).toEqual(repo.expected(liveness(FIELD_PLANNED_TO_DEAD, SHARING_PLANNED_TO_LIVE)));
  });

  // The pair the single file merged CLEAN AND WRONG. Clean is not enough here:
  // the merged tree must equal what regenerating the merged ledgers writes.
  it('two moves of different types with an EQUAL delta: merges clean AND right — no shared line to double-count', () => {
    const m = repo.merge('field-planned-dead', 'sharing-planned-dead');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    expect(repo.files(m.tree)).toEqual(repo.expected(liveness(FIELD_PLANNED_TO_DEAD, SHARING_PLANNED_TO_DEAD)));
  });

  // Adjacent rows conflicted in the single file even with no total (git refuses
  // two edits on touching lines). Different files cannot touch.
  it('two moves of ADJACENT types merge clean — the rows no longer share a file', () => {
    const m = repo.merge('object-planned-dead', 'field-planned-dead');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    expect(repo.files(m.tree)).toEqual(repo.expected(liveness(OBJECT_PLANNED_TO_DEAD, FIELD_PLANNED_TO_DEAD)));
  });

  it('no merged file carries a total row — the sum is the reader\'s, not a file\'s', () => {
    const m = repo.merge('field-planned-dead', 'sharing-planned-live');
    for (const [p, text] of repo.files(m.tree)) expect(text, p).not.toMatch(/^\|\s*\**total/im);
  });

  // THE LIT CONTROL. A same-type pair changes one file's one row twice, which is
  // a real conflict and must stay one — the residue sharding cannot remove, and
  // what the local driver still owns.
  it('two moves of the SAME type still conflict, on that type\'s shard and nowhere else', () => {
    const m = repo.merge('field-planned-dead', 'field-live-dead');
    expect(m.status).toBe(1);
    expect(m.conflicted).toEqual([`${STATE_COUNTS_DIR}/field.md`]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * the strictness ledger's ….counts/ — one shard per source directory
 * ══════════════════════════════════════════════════════════════════════════ */

const STRICTNESS_DIR = '2026-07-unknown-key-strictness-ledger.counts';

/**
 * A two-triaged-directory model with `ui` and `data` strict sites added on top of
 * the dispatch base's shapes, plus two untriaged directories. `renderCountShards`
 * reads `triaged` and `other` only; `global` is what the gate SUMS at read time,
 * which is precisely what no shard may carry.
 */
function strictness({ ui = 0, data = 0, api = 0, kernel = 0 } = {}): Map<string, string> {
  const dir = (name: string, strictAdded: number, files: Array<{ file: string; sites: number; strip: number }>) => {
    const withAdded = files.map((f, i) => (i === 0 ? { ...f, sites: f.sites + strictAdded } : f));
    const sites = withAdded.reduce((a, f) => a + f.sites, 0);
    const strip = withAdded.reduce((a, f) => a + f.strip, 0);
    const openFiles = withAdded.filter((f) => f.strip > 0);
    return {
      dir: name,
      files: withAdded,
      sites,
      strip,
      posture: { strict: sites - strip, passthrough: 0, catchall: 0, strip },
      openFiles,
      buckets: { ...emptyBuckets(), 'wire/open': strip },
    };
  };
  const model: CountsModel = {
    triaged: [
      dir('ui', ui, [{ file: 'component.zod.ts', sites: 56, strip: 0 }, { file: 'view.zod.ts', sites: 62, strip: 4 }]),
      dir('data', data, [{ file: 'mapping.zod.ts', sites: 3, strip: 0 }, { file: 'filter.zod.ts', sites: 12, strip: 11 }]),
    ],
    other: [
      { dir: 'api', sites: 431 + api },
      { dir: 'identity', sites: 32 },
      { dir: 'integration', sites: 5 },
      { dir: 'kernel', sites: 247 + kernel },
    ],
    // Not rendered — see above. Filled so the fixture is a whole model.
    global: {
      sites: 0, strip: 0, openFiles: 0, dirs: 2,
      posture: { strict: 0, passthrough: 0, catchall: 0, strip: 0 },
      buckets: emptyBuckets(),
    },
  };
  return renderCountShards(model);
}

describe('the strictness ledger\'s ….counts/ — two PRs, no merge driver (#20361)', () => {
  let repo: ShardRepo;

  beforeAll(() => {
    repo = new ShardRepo(STRICTNESS_DIR, strictness());
    repo.branch('ui-plus-one', strictness({ ui: 1 }));
    repo.branch('ui-plus-two', strictness({ ui: 2 }));
    repo.branch('data-plus-two', strictness({ data: 2 }));
    repo.branch('api-plus-one', strictness({ api: 1 }));
    repo.branch('kernel-minus-four', strictness({ kernel: -4 }));
  });
  afterAll(() => repo.dispose());

  it('a regeneration touches only the shard of the directory that moved', () => {
    expect(repo.must('diff', '--name-only', 'base', 'ui-plus-one').trim()).toBe(`${STRICTNESS_DIR}/ui.md`);
  });

  // THE MEASURED REPRODUCTION, now clean: one site in `ui/` against two in `data/`.
  it('sites added in two DIFFERENT triaged directories: merges clean, and the result is the regeneration of both', () => {
    const m = repo.merge('ui-plus-one', 'data-plus-two');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    expect(repo.files(m.tree)).toEqual(repo.expected(strictness({ ui: 1, data: 2 })));
  });

  // The untriaged table was one block of adjacent rows; two PRs moving
  // neighbouring directories met on it even though no total sat under them.
  it('two UNTRIAGED directories moving at once merge clean', () => {
    const m = repo.merge('api-plus-one', 'kernel-minus-four');
    expect(m.status, m.conflicted.join('\n')).toBe(0);
    expect(repo.files(m.tree)).toEqual(repo.expected(strictness({ api: 1, kernel: -4 })));
  });

  // THE LIT CONTROL: the same directory twice is still a conflict on its shard.
  it('two moves in the SAME directory still conflict, on that directory\'s shard and nowhere else', () => {
    const m = repo.merge('ui-plus-one', 'ui-plus-two');
    expect(m.status).toBe(1);
    expect(m.conflicted).toEqual([`${STRICTNESS_DIR}/ui.md`]);
  });
});
