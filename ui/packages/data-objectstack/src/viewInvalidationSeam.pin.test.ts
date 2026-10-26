/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import ts from 'typescript';
import { ObjectStackAdapter } from './index';

/**
 * `invalidateViewKeys` is the ONE place that knows the view cache key set
 * (objectui#4373).
 *
 * The behavioural half of this rule is already pinned next door, in
 * `viewCacheInvalidation.pin.test.ts`: eight cases assert the exact key list
 * every adapter write path emits. Those eight are deliberately unchanged by
 * #4373 — routing the four paths through a seam must change nothing they can
 * observe, and their staying green IS the refactor's acceptance evidence.
 *
 * But that is also their blind spot. A future edit that re-inlines
 * ``this.metadataCache.invalidate?.(`view-overrides:${objectName}`)`` back into
 * one write path emits the identical keys in the identical order, so every one
 * of those eight stays green while the seam quietly stops being the single
 * source of truth — and the next writer after that inherits a key list to
 * forget. That is not a hypothetical failure mode, it is the repo's measured
 * history: objectui#3778 removed five restated copies of a key no reader ever
 * populated, objectui#4363 fixed four restated copies that named half the live
 * set, and objectui#4373 is the third instalment — a writer OUTSIDE this class
 * (the console's create/publish flow through app-shell's ADR-0034 seam) that
 * never learned the key list at all.
 *
 * So the guard has to be structural, and the assertions below are on the SOURCE
 * TEXT of `index.ts`:
 *
 * | key template          | may appear exactly twice                        |
 * |-----------------------|-------------------------------------------------|
 * | `` `view:${…}:${…}` ``     | the `getView` READ + the seam               |
 * | `` `view-overrides:${…}` ``| the `listViewOverrides` READ + the seam     |
 *
 * The published view list both of those readers derive from has one key too,
 * `VIEW_LIST_KEY` (objectui#13044). It is a constant rather than a template,
 * so it is pinned by its invalidation instead: the seam, and the wrap over this
 * adapter's client's `view` writes, are the only lines that drop it.
 *
 * Two, not one: a reader must spell the key it caches under — that is where the
 * key is *defined*. What must not recur is a THIRD spelling, because the only
 * thing a third spelling can be is a writer restating what the seam already
 * knows. Re-inline any write path's key list and the count goes to three.
 *
 * If this goes red on a legitimate change: adding a new cached view-shaped READ
 * is the one case that raises a count honestly — pin the new reader here (and
 * teach {@link ObjectStackAdapter.invalidateViewKeys} to drop its key), rather
 * than relaxing the assertion to "at most N".
 */

/**
 * Read through `ts.sys`, not `node:fs` — the convention this package's
 * `cloud-surface-retired-4152.pin.test.ts` records and explains: `tsconfig.json`
 * compiles the whole test tree here, and keeping `@types/node` out of a
 * browser-side adapter's type environment is deliberate. TypeScript's own
 * system host is typed by the `typescript` devDependency.
 */
const INDEX_TS = new URL(import.meta.url).pathname.replace(/[^/]+$/, 'index.ts');
const adapterSrc = (() => {
  const raw = ts.sys.readFile(INDEX_TS);
  if (!raw) throw new Error(`cannot read ${INDEX_TS}`);
  return raw;
})();

/**
 * Code occurrences only. Both keys are also written out in prose in this
 * file's neighbours and in `index.ts`'s own doc comments, in the placeholder
 * form `view-overrides:{object}` — documentation is not a second source of
 * truth and must not be counted as one. Requiring the `${` interpolation
 * marker separates the two exactly.
 */
const PER_VIEW_KEY = /`view:\$\{/g;
const OVERRIDE_MAP_KEY = /`view-overrides:\$\{/g;

function count(re: RegExp, src: string): number {
  return src.match(re)?.length ?? 0;
}

describe('the view cache key set has exactly one owner (objectui#4373)', () => {
  it('is reading real source, not an empty string', () => {
    // Premise guard: a path typo would make every count 0, and every
    // assertion below would pass by reading nothing.
    expect(adapterSrc.length).toBeGreaterThan(10_000);
    expect(adapterSrc).toContain('invalidateViewKeys(objectName: string, viewName: string): void');
  });

  it('spells `view:{object}:{name}` exactly twice — the getView read, and the seam', () => {
    expect(count(PER_VIEW_KEY, adapterSrc)).toBe(2);
  });

  it('spells `view-overrides:{object}` exactly twice — the listViewOverrides read, and the seam', () => {
    expect(count(OVERRIDE_MAP_KEY, adapterSrc)).toBe(2);
  });

  it('no write path names a view cache key itself — they all call the seam', () => {
    // The complementary statement of the two counts, asserted where a reader
    // will look for it: every `invalidate` call in the adapter that concerns a
    // view goes through `invalidateViewKeys`, so the ONLY `metadataCache
    // .invalidate` lines naming a view key are the seam's own two.
    const invalidateLines = adapterSrc
      .split('\n')
      .filter((l: string) => l.includes('metadataCache.invalidate'))
      .filter((l: string) => /`view(-overrides)?:/.test(l));

    expect(invalidateLines.map((l: string) => l.trim())).toEqual([
      'this.metadataCache.invalidate?.(`view:${objectName}:${viewName}`);',
      'this.metadataCache.invalidate?.(`view-overrides:${objectName}`);',
    ]);
  });

  it('drops the shared view list in exactly two places: the client write wrap and the seam (objectui#13044)', () => {
    const listLines = adapterSrc
      .split('\n')
      .filter((l: string) => l.includes('metadataCache.invalidate') && l.includes('VIEW_LIST_KEY'));
    expect(listLines.map((l: string) => l.trim())).toEqual([
      'return bound(...args).finally(() => this.metadataCache.invalidate?.(VIEW_LIST_KEY));',
      'this.metadataCache.invalidate?.(VIEW_LIST_KEY);',
    ]);
  });
});

describe('invalidateViewKeys — the seam itself', () => {
  function makeAdapter() {
    const invalidated: string[] = [];
    const ds: any = new ObjectStackAdapter({
      baseUrl: 'http://test.local',
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    });
    ds.metadataCache = { invalidate: (key: string) => invalidated.push(key) };
    return { ds: ds as ObjectStackAdapter, invalidated };
  }

  it('drops the per-view key, the object override map, then the list it derives from, in that order', () => {
    const { ds, invalidated } = makeAdapter();

    ds.invalidateViewKeys('account', 'account.mine');

    expect(invalidated).toEqual(['view:account:account.mine', 'view-overrides:account', 'list:view']);
  });

  it('takes a qualified `<object>.<key>` name as-is — it is a row key, not a path', () => {
    // The console's runtime-created views are named `<object>.<key>`
    // (`viewEnvelope`, app-shell). Splitting that on `.` would key the cache
    // under something no reader asks for, which is the objectui#3774 class of
    // bug one rename later.
    const { ds, invalidated } = makeAdapter();

    ds.invalidateViewKeys('account', 'account.top_deals');

    expect(invalidated[0]).toBe('view:account:account.top_deals');
  });

  it('is callable from outside the class — the writers are not all in it', () => {
    // The seam is public because app-shell's ADR-0034 persistence module and
    // `MetadataService` write the same rows. A structural (non-class) caller
    // must be able to hold it; this is that call shape.
    const { ds, invalidated } = makeAdapter();
    const seam: { invalidateViewKeys(o: string, v: string): void } = ds;

    seam.invalidateViewKeys('lead', 'lead.hot');

    expect(invalidated).toEqual(['view:lead:lead.hot', 'view-overrides:lead', 'list:view']);
  });
});
