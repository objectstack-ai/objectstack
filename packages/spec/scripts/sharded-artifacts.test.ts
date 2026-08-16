// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two properties the sharding is FOR (#5837), pinned so neither can quietly
 * regress: **locality** and **idempotency**.
 *
 * ## Why these two, and why at this altitude
 *
 * The acceptance criterion behind this change is a statement about the GitHub
 * merge queue — "two PRs touching different categories land as a chain instead
 * of evicting each other" — and no test inside one PR can stage a merge queue.
 * Its mechanical equivalent is a statement about FILES, and that one is exactly
 * testable:
 *
 *   **locality** — two key sets that differ only inside category X serialize to
 *   shard sets that differ only in `X.json`; every other shard is byte-identical.
 *   A server-side three-way merge of two such PRs has no overlapping file to
 *   conflict on, which is the whole claim.
 *
 *   **idempotency** — serializing the same key set twice yields the same bytes,
 *   and `writeShards` leaves an unchanged shard alone rather than rewriting it.
 *   Without this, "only X changed" would be true of the CONTENT and false of the
 *   DIFF, and the queue conflicts on the diff.
 *
 * The generators' end-to-end idempotency (`gen:schema` twice on a clean tree →
 * zero diff) is proved by `check:authorable-surface` / `check:api-surface` on
 * every CI run: both re-derive the artifact and compare it byte-for-byte against
 * the tree, so a non-idempotent writer fails them. Re-spawning a ~7s full-surface
 * build here to re-prove it would buy nothing those gates do not already own.
 *
 * What IS only provable here is the routing law those gates cannot see: that the
 * category segment of a def key — and nothing else — selects its shard file.
 * That is the link between "a PR edited packages/spec/src/ui/*.zod.ts" and "a PR
 * rewrote authorable-surface/ui.json", and it is asserted directly below.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  API_SURFACE_DIR_NAME,
  AUTHORABLE_SURFACE_DIR_NAME,
  SCHEMA_MANIFEST_DIR_NAME,
  aggregateApiSurfaceShards,
  aggregateCategoryShards,
  apiSurfaceShardTexts,
  authorableSurfaceShardTexts,
  categoryOfDefKey,
  entryForShardName,
  listShardNames,
  readShardedKeysAtRev,
  schemaManifestShardTexts,
  shardNameForEntry,
  writeShards,
} from './lib/sharded-artifacts';

/** A miniature surface spanning three categories, in the real key spelling. */
const KEYS = [
  'ai/Agent:model',
  'ai/Agent:name',
  'data/Object:fields',
  'data/Object:name',
  'ui/View:columns [RETIRED]',
  'ui/View:name',
];

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-shard-5837-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Every shard's bytes, by shard name — what a `git diff` would compare. */
function bytes(root: string): Map<string, string> {
  return new Map(
    listShardNames(root).map((n) => [n, fs.readFileSync(path.join(root, `${n}.json`), 'utf-8')]),
  );
}

/** Shard names whose bytes differ between two snapshots (either direction). */
function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].filter((n) => before.get(n) !== after.get(n)).sort();
}

/**
 * The message of the error `run` throws, for the cases where the MESSAGE is the
 * thing under test (#6751). `expect(...).toThrow()` cannot serve those: the
 * reader threw before the fix too — with a bare `TypeError` — so a throw-only
 * assertion is green on the defect it is supposed to pin.
 */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return expect.fail('expected the shard reader to reject, but it returned a value');
}

/** Rewrite one shard's parsed document, in the canonical byte shape. */
function rewriteShard(
  root: string,
  name: string,
  mutate: (doc: Record<string, unknown>) => void,
): void {
  const file = path.join(root, `${name}.json`);
  const doc = JSON.parse(fs.readFileSync(file, 'utf-8'));
  mutate(doc);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

describe('sharded artifacts — locality: a change in one category moves one file (#5837)', () => {
  it('routes a key to the shard its category segment names, and only that one', () => {
    // The routing law itself. Everything below is a consequence of it, so it is
    // asserted first and directly rather than inferred from a diff.
    for (const key of KEYS) {
      const category = categoryOfDefKey(key);
      const texts = authorableSurfaceShardTexts([key]);
      expect([...texts.keys()]).toEqual([category]);
      expect(texts.get(category)).toContain(key);
    }
  });

  it('adding a key to category `ui` leaves every other shard byte-identical', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    const before = bytes(dir);
    expect([...before.keys()]).toEqual(['ai', 'data', 'ui']);

    writeShards(dir, authorableSurfaceShardTexts([...KEYS, 'ui/View:filters'].sort()));

    expect(changed(before, bytes(dir))).toEqual(['ui']);
    expect(aggregateCategoryShards(dir, 'keys')!.entries).toContain('ui/View:filters');
  });

  it('two edits in DIFFERENT categories touch disjoint files — the merge-queue claim, mechanically', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    const base = bytes(dir);

    // Two independent "PRs", each adding one key to its own category.
    const prA = path.join(dir, '..', path.basename(dir) + '-a');
    const prB = path.join(dir, '..', path.basename(dir) + '-b');
    writeShards(prA, authorableSurfaceShardTexts([...KEYS, 'ai/Agent:temperature'].sort()));
    writeShards(prB, authorableSurfaceShardTexts([...KEYS, 'ui/View:filters'].sort()));

    const touchedByA = changed(base, bytes(prA));
    const touchedByB = changed(base, bytes(prB));
    expect(touchedByA).toEqual(['ai']);
    expect(touchedByB).toEqual(['ui']);
    // The property that makes the queue able to chain them: no shared file.
    expect(touchedByA.filter((n) => touchedByB.includes(n))).toEqual([]);

    // …and the union of both PRs is exactly what regenerating from the union of
    // their keys produces, so the "resolution" a merge would need is a no-op.
    const merged = path.join(dir, '..', path.basename(dir) + '-m');
    writeShards(
      merged,
      authorableSurfaceShardTexts([...KEYS, 'ai/Agent:temperature', 'ui/View:filters'].sort()),
    );
    expect(bytes(merged).get('ai')).toBe(bytes(prA).get('ai'));
    expect(bytes(merged).get('ui')).toBe(bytes(prB).get('ui'));
    expect(bytes(merged).get('data')).toBe(base.get('data'));

    for (const p of [prA, prB, merged]) fs.rmSync(p, { recursive: true, force: true });
  });

  it('holds for the manifest and the api-surface shards too', () => {
    const defs = ['ai/Agent', 'data/Object', 'ui/View'];
    writeShards(dir, schemaManifestShardTexts(defs));
    const beforeManifest = bytes(dir);
    writeShards(dir, schemaManifestShardTexts([...defs, 'ui/Dashboard'].sort()));
    expect(changed(beforeManifest, bytes(dir))).toEqual(['ui']);

    const surfaceDir = path.join(dir, 'api');
    writeShards(surfaceDir, apiSurfaceShardTexts({ '.': ['defineView (function)'], './ui': ['View (type)'] }));
    const beforeApi = bytes(surfaceDir);
    expect([...beforeApi.keys()]).toEqual(['root', 'ui']);
    writeShards(
      surfaceDir,
      apiSurfaceShardTexts({ '.': ['defineView (function)'], './ui': ['View (type)', 'ViewKind (type)'] }),
    );
    expect(changed(beforeApi, bytes(surfaceDir))).toEqual(['ui']);
  });
});

describe('sharded artifacts — idempotency: the same keys write the same bytes (#5837)', () => {
  it('re-serializing an unchanged key set produces identical bytes and rewrites nothing', () => {
    const first = writeShards(dir, authorableSurfaceShardTexts(KEYS));
    expect(first.written.sort()).toEqual(['ai', 'data', 'ui']);
    const before = bytes(dir);

    // The second run is the one that matters: `written` must be EMPTY. Bytes
    // being equal is not enough — a writer that rewrites identical content
    // still churns mtimes, and every "is this stale?" comparison downstream is
    // one `mtime` read away from churning with it.
    const second = writeShards(dir, authorableSurfaceShardTexts([...KEYS]));
    expect(second.written).toEqual([]);
    expect(second.removed).toEqual([]);
    expect(bytes(dir)).toEqual(before);
  });

  it('key order in does not change bytes out — the shards are sorted, per shard', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    const sorted = bytes(dir);
    const shuffled = [...KEYS].reverse();
    const again = writeShards(dir, authorableSurfaceShardTexts(shuffled));
    expect(again.written).toEqual([]);
    expect(bytes(dir)).toEqual(sorted);
  });

  it('a category that empties has its shard REMOVED, not left behind holding stale keys', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    const { removed } = writeShards(
      dir,
      authorableSurfaceShardTexts(KEYS.filter((k) => categoryOfDefKey(k) !== 'data')),
    );
    expect(removed).toEqual(['data']);
    expect(listShardNames(dir)).toEqual(['ai', 'ui']);
    // The ratchets read the DIRECTORY, so an orphan left behind would keep
    // answering for keys the build no longer emits — a baseline that outlives
    // its source is exactly what #2978/#4650 exist to catch.
    expect(aggregateCategoryShards(dir, 'keys')!.entries.some((k) => k.startsWith('data/'))).toBe(false);
  });
});

describe('sharded artifacts — the aggregate reads the whole directory (#5837)', () => {
  it('round-trips a key set through shards without loss', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    expect(aggregateCategoryShards(dir, 'keys')!.entries).toEqual([...KEYS].sort());
  });

  it('deleting a shard file deletes its keys — the ratchets see the same removal lines did', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    fs.rmSync(path.join(dir, 'ui.json'));
    const after = aggregateCategoryShards(dir, 'keys')!.entries;
    expect(after).toEqual(['ai/Agent:model', 'ai/Agent:name', 'data/Object:fields', 'data/Object:name']);
  });

  it('refuses a shard that answers for a category it is not named for', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    const smuggled = JSON.parse(fs.readFileSync(path.join(dir, 'ai.json'), 'utf-8'));
    smuggled.keys.push('ui/View:smuggled');
    fs.writeFileSync(path.join(dir, 'ai.json'), JSON.stringify(smuggled, null, 2) + '\n');
    expect(() => aggregateCategoryShards(dir, 'keys')).toThrow(/belongs to category "ui"/);
  });

  it('refuses a shard whose declared category disagrees with its filename', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'ai.json'), 'utf-8'));
    doc.category = 'data';
    fs.writeFileSync(path.join(dir, 'ai.json'), JSON.stringify(doc, null, 2) + '\n');
    expect(() => aggregateCategoryShards(dir, 'keys')).toThrow(/declares category "data"/);
  });

  /**
   * The fourth defect class of this reader (#6751). The other three name the
   * shard file and carry an issue anchor; a non-string entry used to reach
   * `categoryOfDefKey` — whose parameter is declared `string` — and die on
   * `key.indexOf is not a function`. All three call sites in `build-schemas.ts`
   * print `error.message` and nothing else, so that bare text WAS the whole
   * diagnostic: no file among 14 shards, no entry, no anchor.
   *
   * Note what these cases may not do: assert only that it throws. The unfixed
   * reader throws too, so `expect(...).toThrow()` — and even `toThrow(/./)` —
   * stays green on exactly the defect. The message is the contract here, so the
   * file, the entry and the anchor are each pinned by name.
   */
  it('names the shard file, the entry index and the anchor when an entry is not a string', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    rewriteShard(dir, 'ui', (doc) => {
      (doc.keys as unknown[])[0] = 12345;
    });

    const message = messageOf(() => aggregateCategoryShards(dir, 'keys'));
    expect(message, 'names the shard file').toContain('ui.json');
    expect(message, 'names the entry').toContain('keys[0]');
    expect(message, 'carries the issue anchor').toContain('#5837');
    expect(message, 'says what was found instead').toContain('is a number, not a string');
    expect(message, 'quotes the offending value').toContain('12345');
    // The regression this exists for, stated as itself.
    expect(message, 'never the bare JS error again').not.toContain('indexOf');
  });

  it('distinguishes null and object entries, which `typeof` alone reports as one', () => {
    // `typeof null === 'object'` is the trap the type label exists for: telling
    // an author "object" when they wrote `null` sends them looking for a brace.
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    rewriteShard(dir, 'ui', (doc) => {
      (doc.keys as unknown[])[1] = null;
    });
    expect(messageOf(() => aggregateCategoryShards(dir, 'keys'))).toContain(
      'keys[1] is null, not a string',
    );

    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    rewriteShard(dir, 'ui', (doc) => {
      (doc.keys as unknown[])[1] = { 'ui/View:name': true };
    });
    expect(messageOf(() => aggregateCategoryShards(dir, 'keys'))).toContain(
      'keys[1] is an object, not a string',
    );
  });

  it('speaks the same way for every sharded artifact, naming that artifact’s own field', () => {
    // `categoryOfDefKey` is shared by all three category-sharded ratchets
    // (authorable-surface/, json-schema.manifest/, authorable-defaults/), so the
    // dumb message appeared under three different prefixes. The field name is
    // part of the message for the same reason the file name is.
    //
    // The entry here is an ARRAY on purpose, and it is the worst of the class:
    // `['ui/View'].indexOf('/')` is a perfectly valid Array.prototype call that
    // answers -1, so this case never produced a TypeError at all — it fell
    // through to `cannot shard "ui/View": … has no category segment`, naming a
    // key that is not in the file and a cause that is not the defect. A wrong
    // diagnosis outranks a bare one, which is why the type is checked before
    // the routing rather than left to whatever `indexOf` happens to mean.
    writeShards(dir, schemaManifestShardTexts(['ai/Agent', 'ui/View', 'ui/Dashboard']));
    rewriteShard(dir, 'ui', (doc) => {
      (doc.schemas as unknown[])[1] = ['ui/View'];
    });

    const message = messageOf(() => aggregateCategoryShards(dir, 'schemas'));
    expect(message).toContain('ui.json');
    expect(message).toContain('schemas[1] is an array, not a string');
    expect(message).toContain('#5837');
  });

  /**
   * The fourth sharded artifact, held to the message #6751 established for the
   * other three (#7076). `api-surface/` is not routed by `categoryOfDefKey`, so
   * that fix could not reach it: its rows went straight from `Array.isArray` —
   * a statement about the CONTAINER — into a `Record<string, string[]>`.
   *
   * Deliberately adjacent to the three cases above rather than in a file of its
   * own: what has to stay true is that these readers say the SAME thing, and the
   * shared middle (`<field>[<i>] is <type>, not a string (#5837): <value>`) is
   * only reviewable when the assertions sit next to each other.
   */
  it('names the shard file, the entry index and the anchor for a non-string export row', () => {
    const apiDir = path.join(dir, 'api');
    writeShards(apiDir, apiSurfaceShardTexts({ './data': ['Field (type)', 'Object (type)'] }));
    rewriteShard(apiDir, 'data', (doc) => {
      (doc.exports as unknown[])[1] = { name: 'Object' };
    });

    const message = messageOf(() => aggregateApiSurfaceShards(apiDir));
    expect(message, 'names the shard file').toContain('api-surface/data.json');
    expect(message, 'names the entry, in the artifact’s own field').toContain('exports[1]');
    expect(message, 'carries the issue anchor').toContain('#5837');
    expect(message, 'says what was found instead').toContain('is an object, not a string');
    expect(message, 'quotes the offending value').toContain('{"name":"Object"}');
    // The reverse direction is NOT "threw a worse error before" — it is `messageOf`'s
    // own `expect.fail`: unfixed, this reader RETURNS the corrupt row as a
    // `string` and the diff in `build-api-surface.ts` reports it as a REMOVED
    // export, demanding a major bump for an export that never existed. So the
    // pin is that the reader rejects at all, and then that it rejects in the
    // shared words.
  });

  it('refuses a stray file in a generator-owned directory', () => {
    writeShards(dir, authorableSurfaceShardTexts(KEYS));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'scratch\n');
    expect(() => listShardNames(dir)).toThrow(/not a <name>\.json shard/);
  });
});

describe('sharded artifacts — entry-point shard naming (#5837)', () => {
  it('maps the root entry to a reserved name and round-trips every subpath', () => {
    expect(shardNameForEntry('.')).toBe('root');
    expect(entryForShardName('root')).toBe('.');
    for (const entry of ['./data', './ui', './api']) {
      expect(entryForShardName(shardNameForEntry(entry))).toBe(entry);
    }
  });

  it('refuses a `./root` entry point rather than letting it overwrite the root shard', () => {
    // The def-key collision guard's lesson (#5976) applied to file names: two
    // sources claiming one output path must be loud, never last-writer-wins.
    expect(() => shardNameForEntry('./root')).toThrow(/collides with the shard name reserved/);
  });

  it('keeps each entry point self-identifying, so a renamed file cannot lie', () => {
    const apiDir = path.join(dir, 'api');
    writeShards(apiDir, apiSurfaceShardTexts({ './data': ['Field (type)'] }));
    fs.renameSync(path.join(apiDir, 'data.json'), path.join(apiDir, 'ui.json'));
    expect(() => aggregateApiSurfaceShards(apiDir)).toThrow(/declares entry "\.\/data"/);
  });
});

// ── #9109 — this file's fixture repos inherit nothing from the machine ───────
//
// Same exposure class #9068 closed for `build-schemas-check-mode.test.ts`, and
// the same two layers, applied here verbatim. The fixtures below were spawned
// with `cwd` and two `-c user.*` args only, so they inherited the ambient global
// and system git config, `init.templateDir`, and every `GIT_*` variable.
//
// The half that matters here is env leakage rather than gc: no fixture in this
// file writes `.git/shallow`, so an ordinary gc leaves its fresh reachable
// objects alone. What a leaked `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`
// or `GIT_ALTERNATE_OBJECT_DIRECTORIES` does instead is point a fixture's git at
// a repository other than the directory it was handed — and these cases read a
// revision back out of the repo they just built, so that is not a flake, it is a
// test that silently measures another repository. The repo-local `[gc]` block is
// carried anyway, because it is the layer that binds a git process this file
// never launched, and it costs one `config` call per fixture.
//
// Nothing about what these cases assert changes: the fixtures are built from the
// same writes and read by the same `readShardedKeysAtRev`, only insulated.

/** `GIT_*` variables that would point a fixture's git at a different repository
 *  (or a different index/object store) than the directory it was handed. */
const LEAKED_GIT_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_TEMPLATE_DIR',
  'GIT_CONFIG',
] as const;

/** The environment every fixture git in this file gets. */
const HERMETIC_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  for (const key of LEAKED_GIT_ENV) delete env[key];
  // git's own documented "read no config file" spellings. `/dev/null` parses as
  // an empty config, which is what makes `init.templateDir`, `core.hooksPath`
  // and any ambient `[gc]` block unable to reach a fixture.
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
})();

/** Passed to every fixture git invocation — including the `init` that runs
 *  before the repo-local config below exists. Identity first (with the global
 *  config closed, there is no other source for it), then the maintenance switches. */
const FIXTURE_GIT_ARGS = [
  '-c', 'user.name=t',
  '-c', 'user.email=t@example.invalid',
  '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=false',
  '-c', 'gc.pruneExpire=never',
  '-c', 'gc.reflogExpire=never',
  '-c', 'gc.reflogExpireUnreachable=never',
];

describe('sharded artifacts — the historical baseline reader (#5837)', () => {
  /**
   * The deletion gates anchor on an already-merged upstream commit, and commits
   * older than this migration carry the single-file layout. That branch is a
   * read of immutable HISTORY, so it is pinned in both directions: the sharded
   * layout wins where it exists, the retired single file is read where it is all
   * the revision has, and "neither" stays the `nothing to compare` verdict the
   * single-file gates already drew.
   *
   * Non-throwing by contract: this runner is handed to `readShardedKeysAtRev`,
   * which reads `status` itself and reports a bad revision as `{ error }`. The
   * fixture-BUILDING calls below get their loudness from `mustSucceed` instead.
   */
  const gitIn = (cwd: string) => (...args: string[]) => {
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    return spawnSync('git', [...FIXTURE_GIT_ARGS, ...args], {
      cwd,
      encoding: 'utf-8' as const,
      env: HERMETIC_ENV,
    });
  };

  /**
   * `git init` plus the repo-local half of the isolation above.
   *
   * Local config is the layer that survives a git process this file did not
   * start: `gc.auto=0` stops the fixture's own commits from triggering one, and
   * the `never` expiries mean a gc arriving from anywhere else — an ambient
   * maintenance schedule, a `[gc]` block in someone's global config — finds
   * nothing it is allowed to drop.
   */
  function initFixtureRepo(root: string): void {
    const git = gitIn(root);
    const mustSucceed = (...args: string[]): void => {
      const r = git(...args);
      // Silent failure here used to surface as an empty `rev` and a confusing
      // assertion three calls downstream; a broken fixture says so instead.
      if (r.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed (${r.status}) in ${root}: ${r.stderr}`);
      }
    };
    mustSucceed('init', '-q', '-b', 'main', '.');
    for (const [key, value] of [
      ['gc.auto', '0'],
      ['gc.autoDetach', 'false'],
      ['maintenance.auto', 'false'],
      ['gc.pruneExpire', 'never'],
      ['gc.reflogExpire', 'never'],
      ['gc.reflogExpireUnreachable', 'never'],
      // Reflogs are the other thing standing between a fixture commit and a
      // prune, and an ambient `core.logAllRefUpdates=false` would have taken
      // them away.
      ['core.logAllRefUpdates', 'true'],
    ] as const) {
      mustSucceed('config', key, value);
    }
    mustSucceed('add', '-A');
    mustSucceed('commit', '-q', '-m', 'fixture');
  }

  function repoWith(write: (root: string) => void): { root: string; rev: string } {
    const root = path.join(dir, 'repo');
    const pkg = path.join(root, 'packages', 'spec');
    fs.mkdirSync(pkg, { recursive: true });
    write(pkg);
    initFixtureRepo(root);
    return { root: pkg, rev: gitIn(root)('rev-parse', 'HEAD').stdout.trim() };
  }

  it('reads the sharded layout when the revision has one', () => {
    const { root, rev } = repoWith((pkg) => {
      writeShards(path.join(pkg, AUTHORABLE_SURFACE_DIR_NAME), authorableSurfaceShardTexts(KEYS));
    });
    const read = readShardedKeysAtRev(gitIn(root), rev, AUTHORABLE_SURFACE_DIR_NAME, 'keys');
    expect(read).toEqual({ entries: [...KEYS].sort(), layout: 'sharded' });
  });

  it('falls back to the retired single file for a revision that predates the split', () => {
    const { root, rev } = repoWith((pkg) => {
      fs.writeFileSync(
        path.join(pkg, 'authorable-surface.json'),
        JSON.stringify({ description: 'legacy', keys: KEYS }, null, 2) + '\n',
      );
    });
    const read = readShardedKeysAtRev(gitIn(root), rev, AUTHORABLE_SURFACE_DIR_NAME, 'keys');
    expect(read).toEqual({ entries: [...KEYS].sort(), layout: 'legacy' });
  });

  it('prefers the sharded layout when a revision somehow carries both', () => {
    // Belt and braces for the migration commit itself: the directory is the
    // tree's own layout, so it decides — never a merge of the two.
    const { root, rev } = repoWith((pkg) => {
      writeShards(path.join(pkg, AUTHORABLE_SURFACE_DIR_NAME), authorableSurfaceShardTexts(KEYS));
      fs.writeFileSync(
        path.join(pkg, 'authorable-surface.json'),
        JSON.stringify({ description: 'legacy', keys: ['ai/Agent:stale'] }, null, 2) + '\n',
      );
    });
    const read = readShardedKeysAtRev(gitIn(root), rev, AUTHORABLE_SURFACE_DIR_NAME, 'keys');
    expect(read).toEqual({ entries: [...KEYS].sort(), layout: 'sharded' });
  });

  it('reports "nothing to compare" when a revision carries neither', () => {
    const { root, rev } = repoWith((pkg) => {
      fs.writeFileSync(path.join(pkg, 'placeholder.txt'), 'x\n');
    });
    expect(readShardedKeysAtRev(gitIn(root), rev, AUTHORABLE_SURFACE_DIR_NAME, 'keys')).toBeNull();
  });

  /**
   * The same defect class as the aggregate's fourth case (#6751), on the reader
   * that cannot throw it (#7076). This one reports by `{ error }` — its callers
   * in `build-schemas.ts` print that string under the gate's own name and exit —
   * so the assertion is on the returned string, not on a thrown one, and the
   * message skeleton has to be identical while the carrier is not.
   *
   * Why it matters more here than a bare container check: an unchecked entry was
   * forwarded into the baseline SET, and the three gates that consume that set
   * each fail somewhere else — `entry.replace is not a function` in the
   * authorable-surface deletion check, a demand for a `RETIRED_DEFS_BY_MAJOR`
   * registration in the manifest removal check, and "the anchor is not the
   * baseline it claims to be" in `compareAnchorKeys`. None of the three can name
   * the file the value came from; only this reader knows it.
   */
  it('reports a non-string entry as an error naming the file, the entry and the anchor', () => {
    const { root, rev } = repoWith((pkg) => {
      const surfaceDir = path.join(pkg, AUTHORABLE_SURFACE_DIR_NAME);
      writeShards(surfaceDir, authorableSurfaceShardTexts(KEYS));
      const file = path.join(surfaceDir, 'ui.json');
      const doc = JSON.parse(fs.readFileSync(file, 'utf-8'));
      doc.keys[1] = 12345;
      fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
    });

    const read = readShardedKeysAtRev(gitIn(root), rev, AUTHORABLE_SURFACE_DIR_NAME, 'keys');
    // Not `toThrow`, and not `entries` either: unfixed, this call SUCCEEDS and
    // hands 12345 to the gates as a key. The pin is that it refuses instead.
    expect(read, 'refuses rather than forwarding the bad entry').toHaveProperty('error');
    const message = (read as { error: string }).error;
    expect(message, 'names the shard file').toContain(`${AUTHORABLE_SURFACE_DIR_NAME}/ui.json`);
    expect(message, 'names the revision it read').toContain(rev.slice(0, 12));
    expect(message, 'names the entry, in the artifact’s own field').toContain('keys[1]');
    expect(message, 'carries the issue anchor').toContain('#5837');
    expect(message, 'says what was found instead').toContain('is a number, not a string');
    expect(message, 'quotes the offending value').toContain('12345');
  });

  it('reports a non-string entry in the retired single-file layout the same way', () => {
    // The legacy branch reads immutable history — a commit from before #5837 —
    // so it is the one place where "regenerate the artifact" is not advice
    // anyone can take. All the more reason for the message to name the file and
    // the entry itself.
    const { root, rev } = repoWith((pkg) => {
      fs.writeFileSync(
        path.join(pkg, 'authorable-surface.json'),
        JSON.stringify({ description: 'legacy', keys: [...KEYS.slice(0, 2), null] }, null, 2) + '\n',
      );
    });

    const read = readShardedKeysAtRev(gitIn(root), rev, AUTHORABLE_SURFACE_DIR_NAME, 'keys');
    expect(read).toHaveProperty('error');
    const message = (read as { error: string }).error;
    expect(message, 'names the retired single file').toContain('authorable-surface.json');
    expect(message, 'names the entry').toContain('keys[2]');
    expect(message, 'carries the issue anchor').toContain('#5837');
    // `typeof null === 'object'` is the trap `jsonTypeLabel` exists for, and it
    // has to survive the trip through the `{ error }` carrier unchanged.
    expect(message, 'distinguishes null from an object').toContain('is null, not a string');
  });

  it('reads the manifest layout by the same rule', () => {
    const defs = ['ai/Agent', 'ui/View'];
    const { root, rev } = repoWith((pkg) => {
      writeShards(path.join(pkg, SCHEMA_MANIFEST_DIR_NAME), schemaManifestShardTexts(defs));
    });
    expect(readShardedKeysAtRev(gitIn(root), rev, SCHEMA_MANIFEST_DIR_NAME, 'schemas')).toEqual({
      entries: defs,
      layout: 'sharded',
    });
  });
});

describe('sharded artifacts — the committed tree matches the layout it declares (#5837)', () => {
  const PKG = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

  it('carries all three directories and none of the retired single files', () => {
    for (const name of [AUTHORABLE_SURFACE_DIR_NAME, SCHEMA_MANIFEST_DIR_NAME, API_SURFACE_DIR_NAME]) {
      expect(fs.existsSync(path.join(PKG, name)), `${name}/ is a committed artifact`).toBe(true);
      expect(listShardNames(path.join(PKG, name)).length).toBeGreaterThan(0);
    }
    // The retirement half: a leftover single file would be read by nothing and
    // would drift silently into a second, stale answer to the same question.
    for (const name of ['authorable-surface.json', 'json-schema.manifest.json', 'api-surface.json']) {
      expect(fs.existsSync(path.join(PKG, name)), `${name} was retired by #5837`).toBe(false);
    }
  });

  it('every committed shard passes the integrity checks the aggregate applies', () => {
    expect(aggregateCategoryShards(path.join(PKG, AUTHORABLE_SURFACE_DIR_NAME), 'keys')!.entries.length)
      .toBeGreaterThan(0);
    expect(aggregateCategoryShards(path.join(PKG, SCHEMA_MANIFEST_DIR_NAME), 'schemas')!.entries.length)
      .toBeGreaterThan(0);
    const api = aggregateApiSurfaceShards(path.join(PKG, API_SURFACE_DIR_NAME))!;
    expect(Object.keys(api.surface)).toContain('.');
  });

  it('re-serializing the committed shards is a no-op — the tree IS the generator’s output', () => {
    const surface = aggregateCategoryShards(path.join(PKG, AUTHORABLE_SURFACE_DIR_NAME), 'keys')!;
    const canonical = authorableSurfaceShardTexts(surface.entries);
    for (const shard of surface.shards) {
      expect(canonical.get(shard.name), `${shard.name}.json is not in canonical form`).toBe(shard.raw);
    }
    expect([...canonical.keys()].sort()).toEqual(surface.shards.map((s) => s.name).sort());
  });
});
