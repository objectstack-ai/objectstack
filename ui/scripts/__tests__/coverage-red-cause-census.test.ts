/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  attributeRun,
  deliveredCoverageReport,
  proximateCause,
  shardIndexOf,
  shardOf,
  shardRange,
  specFilesFrom,
  summarise,
} from '../coverage-red-cause-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Fixtures are module-scope constants on purpose. Nothing here walks the
 * corpus — this suite's whole subject is a census of tests that DID walk the
 * corpus from inside `it()`, and the cheapest way not to become its own next
 * data point is to keep every input tiny and literal.
 */
const SPEC_SAMPLE = [
  'packages/core/src/registry.test.ts',
  'packages/react/src/SchemaRenderer.test.tsx',
  'scripts/__tests__/check-doc-links.test.ts',
  'scripts/__tests__/check-unused-dependencies.test.ts',
  'apps/console/src/languageSeed.test.ts',
  'eslint-rules/no-inline-style.test.js',
  'examples/schema-catalog/catalog.test.ts',
];

const TRACKED_SAMPLE = [
  ...SPEC_SAMPLE,
  'packages/core/src/registry.ts',
  'README.md',
  'e2e/console-rendering.spec.ts',
  'e2e/live/master-detail.spec.ts',
];

const COVERAGE_SHARD_JOB = (shard: number, conclusion: string, failedStep: string | null) => ({
  name: `Test (coverage shard ${shard}/4)`,
  conclusion,
  steps: [
    { name: 'Checkout code', conclusion: 'success' },
    { name: `Run tests with coverage (shard ${shard}/4)`, conclusion: failedStep === 'run' ? 'failure' : 'success' },
    { name: "Upload this shard's blob report", conclusion: failedStep === 'upload' ? 'failure' : 'success' },
  ],
});

describe('the delivery probe is artifact presence, never a run conclusion', () => {
  it('reads the coverage-report artifact by name', () => {
    expect(deliveredCoverageReport([{ name: 'coverage-report' }, { name: 'coverage-blob-1' }])).toBe(true);
    expect(deliveredCoverageReport([{ name: 'coverage-blob-1' }, { name: 'coverage-blob-2' }])).toBe(false);
    expect(deliveredCoverageReport([])).toBe(false);
  });

  it('does not consult a conclusion field even when one is offered', () => {
    // objectui#6055 measured `conclusion=cancelled` runs that HAD delivered, so
    // a probe that peeked at the conclusion would mis-read exactly those.
    const artifacts = [{ name: 'coverage-report', conclusion: 'cancelled' }];
    expect(deliveredCoverageReport(artifacts)).toBe(true);
  });
});

describe('the shard replica reproduces vitest 4.1.10 arithmetic', () => {
  it('spreads the remainder over the leading shards, exactly as calculateShardRange does', () => {
    // 7 files over 4 shards: sizes 2,2,2,1 — the remainder (3) takes the first three.
    expect(shardRange(7, 1, 4)).toEqual([0, 2]);
    expect(shardRange(7, 2, 4)).toEqual([2, 4]);
    expect(shardRange(7, 3, 4)).toEqual([4, 6]);
    expect(shardRange(7, 4, 4)).toEqual([6, 7]);
  });

  it('partitions the whole spec list with no file lost and none duplicated', () => {
    const parts = [1, 2, 3, 4].map((i) => shardOf(SPEC_SAMPLE, i, 4));
    expect(parts.flat().sort()).toEqual([...SPEC_SAMPLE].sort());
    expect(new Set(parts.flat()).size).toBe(SPEC_SAMPLE.length);
  });

  it('orders by the sha1 of the ROOT-RELATIVE path with its leading slash', () => {
    // The leading slash is not decoration: vitest hashes
    // `resolve(root, moduleId).slice(root.length)`, which always starts with
    // `/`. Dropping it yields a different digest and therefore a different
    // partition, silently.
    const expected = [...SPEC_SAMPLE]
      .map((p) => ({ p, h: createHash('sha1').update(`/${p}`).digest('hex') }))
      .sort((a, b) => (a.h < b.h ? -1 : 1))
      .map((r) => r.p);
    expect([1, 2, 3, 4].flatMap((i) => shardOf(SPEC_SAMPLE, i, 4))).toEqual(expected);
  });

  it('moves a file across shards when the spec list grows, with nobody editing it', () => {
    // objectui#8545's structural claim, as arithmetic. Grow the list until the
    // target's shard changes; it must change for SOME growth, or the card's
    // "a file can move across the bound without anyone editing it" is false.
    const target = 'scripts/__tests__/check-doc-links.test.ts';
    const before = shardIndexOf(SPEC_SAMPLE, target);
    const shardsSeen = new Set<number | null>([before]);
    for (let extra = 1; extra <= 60; extra += 1) {
      const grown = [...SPEC_SAMPLE, ...Array.from({ length: extra }, (_, i) => `packages/new/src/added-${i}.test.ts`)];
      shardsSeen.add(shardIndexOf(grown, target));
    }
    expect(shardsSeen.size).toBeGreaterThan(1);
  });
});

describe('the spec matcher agrees with the vitest projects it stands in for', () => {
  it('keeps every vitest spec extension and drops the playwright tree', () => {
    expect(specFilesFrom(TRACKED_SAMPLE)).toEqual(SPEC_SAMPLE);
  });

  it('drops non-spec sources outright', () => {
    expect(specFilesFrom(['packages/core/src/registry.ts', 'README.md'])).toEqual([]);
  });
});

describe('the proximate reading separates a red suite from a broken runner', () => {
  it('names the failing shard and calls a non-zero vitest what it is', () => {
    expect(proximateCause([COVERAGE_SHARD_JOB(2, 'failure', 'run'), COVERAGE_SHARD_JOB(1, 'success', null)])).toEqual({
      failingShards: [2],
      kinds: ['vitest-nonzero'],
    });
  });

  it('does not call a failed artifact upload a test failure', () => {
    // The tests in that shard ran green; only the upload died. Counting it as a
    // red suite would put an infrastructure fault into the mechanism's column.
    expect(proximateCause([COVERAGE_SHARD_JOB(4, 'failure', 'upload')])).toEqual({
      failingShards: [4],
      kinds: ['blob-upload'],
    });
  });

  it('reports a cancelled shard without claiming any shard failed', () => {
    expect(proximateCause([{ ...COVERAGE_SHARD_JOB(3, 'cancelled', null), conclusion: 'cancelled' }])).toEqual({
      failingShards: [],
      kinds: ['run-cancelled'],
    });
  });

  it('ignores jobs that are not coverage shards', () => {
    expect(proximateCause([{ name: 'Type Check', conclusion: 'failure', steps: [] }])).toEqual({
      failingShards: [],
      kinds: [],
    });
  });

  it('reads a coverage shard at any width, not only the 4-way runs it was written for (objectui#12256)', () => {
    const eightWay = {
      name: 'Test (coverage shard 7/8)',
      conclusion: 'failure',
      steps: [{ name: 'Run tests with coverage (shard 7/8)', conclusion: 'failure' }],
    };
    expect(proximateCause([eightWay])).toEqual({ failingShards: [7], kinds: ['vitest-nonzero'] });
  });
});

describe('attribution requires BOTH the live window and the computed shard', () => {
  const suspects = [
    { name: 'doc-links', path: 'scripts/__tests__/check-doc-links.test.ts', liveFrom: '2026-09-04T15:38:06Z', liveUntil: '2026-09-07T21:59:50Z' },
  ];
  const base = {
    createdAt: '2026-09-06T04:33:09Z',
    failingShards: [2],
    suspectShard: { 'scripts/__tests__/check-doc-links.test.ts': 2 },
  };

  it('attributes when the failing shard is the shard the suspect computes into', () => {
    expect(attributeRun(base, suspects)).toEqual(['doc-links']);
  });

  it('refuses when a different shard failed — the in-window control', () => {
    expect(attributeRun({ ...base, failingShards: [3] }, suspects)).toEqual([]);
  });

  it('refuses outside the live window even when the shard matches — the out-of-window control', () => {
    // This is the control that makes the census a measurement rather than a
    // story: after the hoist the same shard keeps failing sometimes, and those
    // runs must NOT be swept into the mechanism's column.
    expect(attributeRun({ ...base, createdAt: '2026-09-09T04:33:09Z' }, suspects)).toEqual([]);
  });

  it('refuses when the suspect could not be placed on that tree', () => {
    expect(attributeRun({ ...base, suspectShard: { 'scripts/__tests__/check-doc-links.test.ts': null } }, suspects)).toEqual([]);
  });
});

describe('the summary counts MERGES, not runs', () => {
  const suspects = [
    { name: 'doc-links', path: 'scripts/__tests__/check-doc-links.test.ts', liveFrom: '2026-09-04T00:00:00Z', liveUntil: '2026-09-08T00:00:00Z' },
  ];
  const shard2 = { 'scripts/__tests__/check-doc-links.test.ts': 2 };

  it('splits delivered from red and buckets the red by cause', () => {
    const snapshot = {
      runs: [
        { sha: 'aaa', delivered: true, createdAt: '2026-09-05T00:00:00Z', failingShards: [], suspectShard: shard2 },
        { sha: 'bbb', delivered: false, createdAt: '2026-09-05T01:00:00Z', failingShards: [2], suspectShard: shard2 },
        { sha: 'ccc', delivered: false, createdAt: '2026-09-05T02:00:00Z', failingShards: [2], suspectShard: shard2 },
        { sha: 'ddd', delivered: false, createdAt: '2026-09-05T03:00:00Z', failingShards: [3], suspectShard: shard2 },
      ],
    };
    expect(summarise(snapshot, suspects)).toEqual({
      runs: 4,
      merges: 4,
      supersededRuns: 0,
      delivered: 1,
      red: 3,
      redShare: 0.75,
      byCause: { 'doc-links': 2, unattributed: 1 },
    });
  });

  it('does not count a superseded run as a red merge when the same sha delivered', () => {
    // objectui#6049's per-sha concurrency group cancels the earlier run and
    // starts a fresh one on the SAME head sha. The cancelled one has no
    // artifact; the commit still got its merged report. Counting runs here is
    // what made this census disagree with objectui#6055's published figures.
    const snapshot = {
      runs: [
        { sha: 'eee', delivered: false, createdAt: '2026-09-05T04:00:00Z', failingShards: [], suspectShard: shard2 },
        { sha: 'eee', delivered: true, createdAt: '2026-09-05T04:00:30Z', failingShards: [], suspectShard: shard2 },
      ],
    };
    const out = summarise(snapshot, suspects);
    expect(out).toMatchObject({ runs: 2, merges: 1, supersededRuns: 1, red: 0, delivered: 1 });
  });

  it('keeps a sha red when none of its runs delivered', () => {
    const snapshot = {
      runs: [
        { sha: 'fff', delivered: false, createdAt: '2026-09-05T05:00:00Z', failingShards: [], suspectShard: shard2 },
        { sha: 'fff', delivered: false, createdAt: '2026-09-05T05:00:30Z', failingShards: [2], suspectShard: shard2 },
      ],
    };
    expect(summarise(snapshot, suspects)).toMatchObject({ merges: 1, red: 1, byCause: { 'doc-links': 1 } });
  });
});

describe('the suspects ledger stays readable by the script that consumes it', () => {
  it('declares a path, a live window and the provenance of both bounds', () => {
    const ledger = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/coverage-red-cause-suspects.json'), 'utf8'));
    expect(ledger.length).toBeGreaterThan(0);
    for (const entry of ledger) {
      expect(typeof entry.name).toBe('string');
      expect(entry.path).toMatch(/\.test\.tsx?$/);
      expect(entry.liveFrom < entry.liveUntil).toBe(true);
      // ⛔ A window with no stated provenance is a number nobody can re-derive.
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });
});
