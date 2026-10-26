/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The producer census behind the unproduced-kind diagnostic (objectui#5877).
 *
 * `PRODUCED_FEED_TYPES` is derived from `ACTIVITY_TYPE_TO_FEED_TYPE` plus one
 * DECLARED entry — `FEED_TYPES_PRODUCED_OFF_MAP` — for the producer that lives
 * in a package this one cannot import (app-shell depends on plugin-detail, not
 * the other way round). A declared list is exactly the thing that goes stale
 * without anyone noticing, and a diagnostic reading a stale census does not fall
 * silent: it starts naming kinds that DO have a producer, which trains authors
 * to ignore it. So the census is re-run here, from source, over the repository.
 *
 * ## ⭐ A census is only as wide as its pathspec, so the pathspec is asserted
 *
 * This card's family was handed a too-narrow census three times, the last one
 * missing a fourth copy sitting one package outside the grep's path. The
 * defence is not a wider grep — it is a scan whose WIDTH is itself checked:
 * the coverage assertions below fail if the walk stops finding the tree, so a
 * scan that silently narrows cannot pass by finding nothing.
 *
 * PATHSPEC: every `.ts` / `.tsx` file under the repository root, at every top
 * level (`packages/`, `apps/`, `examples/`, `scripts/`, `e2e/`, …), excluding
 * build output (`dist/`, `build/`, `coverage/`, `node_modules/`) and dotted
 * directories, then excluding tests (`*.test.*`, `*.spec.*`, `__tests__/`) —
 * a test fixture is not a producer of anything an author sees.
 *
 * NOT included, and each for a stated reason:
 *  - `.mdx` documentation. `content/docs/plugins/plugin-detail.mdx` builds
 *    example `FeedItem`s, but a documentation example produces nothing at
 *    runtime. (Both kinds it names are produced anyway, so the exclusion does
 *    not hide a producer.)
 *  - the `ActivityItem` surface — see the explicit exclusion test below.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeedItemType as SpecFeedItemType } from '@objectstack/spec/data';
import {
  ACTIVITY_TYPE_TO_FEED_TYPE,
  FEED_TYPES_PRODUCED_OFF_MAP,
  PRODUCED_FEED_TYPES,
  UNMAPPED_ACTIVITY_FEED_TYPE,
} from '../recordActivityFeed';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';
import { uiRoot } from '../../../../../scripts/ui-root.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-detail/src/renderers/__tests__ -> repository root
const repoRoot = path.resolve(here, '../../../../..');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'storybook-static']);

/** An unreadable directory is not a producer; it is also not a reason to stop. */
function safeReadDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of safeReadDir(dir)) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments are prose about producers, not producers. */
const stripComments = (src: string): string =>
  mask(src);

const isTest = (file: string): boolean =>
  /\.(test|spec)\.tsx?$/.test(file) || file.split(path.sep).includes('__tests__');

const sourceFiles = walk(repoRoot).filter((f) => !isTest(f));

/**
 * Files that could construct a `FeedItem` at all.
 *
 * Naming the type is a NECESSARY condition — the objects are built under a
 * `FeedItem` / `FeedItem[]` annotation or returned from a function typed with
 * it, and an untyped literal that happened to have the right keys would not
 * reach the feed. Narrowing on it is what keeps the scan from drowning in the
 * repository's hundreds of unrelated `type: 'file'` / `type: 'email'` field
 * declarations, which are a different vocabulary entirely.
 */
const feedFiles = sourceFiles
  .map((f) => [f, readFileSync(f, 'utf8')] as const)
  .filter(([, raw]) => raw.includes('FeedItem'))
  .map(([f, raw]) => [f, stripComments(raw)] as const);

const DECLARED_KINDS = [...SpecFeedItemType.options];

/** `type: 'x'` where `x` is a declared kind — excluding union DECLARATIONS. */
function literalProducers(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, src] of feedFiles) {
    for (const kind of DECLARED_KINDS) {
      // The negative lookahead drops `type: 'field_change' | 'create' | …`,
      // which declares a shape rather than producing one.
      const re = new RegExp(`type:\\s*['"]${kind}['"](?!\\s*\\|)`);
      if (re.test(src)) {
        const rel = path.relative(repoRoot, file);
        found.set(kind, [...(found.get(kind) ?? []), rel]);
      }
    }
  }
  return found;
}

describe('the producer census the unproduced-kind diagnostic reads (objectui#5877)', () => {
  it('the scan reached the repository — a narrow scan must not pass by finding nothing', () => {
    // Every assertion below is of the form "the scan found no producer the
    // census missed", which a broken walk satisfies trivially. These are the
    // guards that make a silent narrowing loud instead.
    expect(repoRoot).toBe(uiRoot());
    expect(sourceFiles.length).toBeGreaterThan(1000);
    for (const top of ['packages', 'apps', 'examples', 'scripts']) {
      expect(
        sourceFiles.some((f) => path.relative(repoRoot, f).startsWith(`${top}${path.sep}`)),
        `the scan covered no file under ${top}/`,
      ).toBe(true);
    }
    // …and it reached the one known off-map producer, in another package.
    expect(
      feedFiles.some(([f]) =>
        path.relative(repoRoot, f) === path.join('packages', 'app-shell', 'src', 'views', 'RecordDetailView.tsx')),
    ).toBe(true);
  });

  it('no ObjectUI surface produces a kind the census calls unproduced', () => {
    const produced = literalProducers();
    const missed = [...produced.keys()].filter((k) => !PRODUCED_FEED_TYPES.has(k as never));
    expect(
      missed,
      `these kinds have a producer in the tree but are absent from PRODUCED_FEED_TYPES: `
        + missed.map((k) => `${k} (${produced.get(k)?.join(', ')})`).join('; '),
    ).toEqual([]);
  });

  it('the DECLARED off-map producer list is exactly what the tree contains', () => {
    // The half that cannot be derived: `comment`, built from `sys_comment` rows
    // by app-shell. If a second off-map producer ever appears, this names it
    // rather than letting the declaration quietly under-count.
    const fromMap = new Set<string>([
      ...Object.values(ACTIVITY_TYPE_TO_FEED_TYPE).filter(Boolean) as string[],
      UNMAPPED_ACTIVITY_FEED_TYPE,
    ]);
    const offMap = [...literalProducers().keys()].filter((k) => !fromMap.has(k)).sort();
    expect(offMap).toEqual([...FEED_TYPES_PRODUCED_OFF_MAP].sort());
  });

  it('EXPLICITLY excludes the `ActivityItem` surface, and says why (objectui#6730)', () => {
    // The third reading of `sys_activity`: app-shell's bell / Home / ActivityFeed
    // map the SAME rows onto `ActivityItemType`, a different five-value
    // vocabulary that is not a projection of `FeedItemType` in either direction.
    // A row it maps never becomes a `FeedItem`, so it produces nothing for this
    // feed — but silence about it is what makes a census unreusable, so the
    // exclusion is asserted rather than assumed.
    const activityItemType = path.join(repoRoot, 'packages/app-shell/src/layout/activityItemType.ts');
    expect(existsSync(activityItemType)).toBe(true);
    const src = readFileSync(activityItemType, 'utf8');
    expect(src).toContain("export type ActivityItemType = 'create' | 'update' | 'delete' | 'comment' | 'system';");
    // It is in the scan's reach and deliberately contributes nothing: its rows
    // are typed by a function, never by a `FeedItemType` literal.
    const scanned = feedFiles.find(([f]) => f === activityItemType);
    expect(scanned, 'activityItemType.ts fell outside the scan — the exclusion would be vacuous').toBeTruthy();
    for (const kind of DECLARED_KINDS) {
      expect(new RegExp(`type:\\s*['"]${kind}['"](?!\\s*\\|)`).test(scanned![1])).toBe(false);
    }
  });
});
