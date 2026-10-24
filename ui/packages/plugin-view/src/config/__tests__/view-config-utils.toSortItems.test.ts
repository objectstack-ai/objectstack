/**
 * `toSortItems` — the retired `direction` sort spelling (objectui#6011).
 *
 * `toSortItems` is a **published export**: re-exported from the package root
 * (`src/index.tsx`) and listed in the README. It used to read
 * `s.order || s.direction || 'asc'` — two spellings for one key, silently
 * preferring the canonical one. That is the tolerance layer objectui#4869
 * ruled against (a spelling the sink does not recognise gets ruled into the
 * contract or rejected at the producer, never absorbed by a tolerance layer),
 * and objectui#5293 executed the identical retirement for the `views[].sort`
 * path. `order` is now the only spelling this export reads.
 *
 * These are the ONLY assertions that grade the retirement. The function has no
 * in-repo production caller — the studio inspector-draft surface it serves
 * (`SortBuilder`) is reached from out-of-tree hosts, and the one in-repo
 * importer of the published symbol
 * (`apps/console/src/__tests__/insecure-origin-crypto.test.ts`) passes the
 * canonical `order` and only grades `crypto.randomUUID`. So no pre-existing
 * suite can go red for this change; the `direction` case below is what does.
 *
 * ⚠️ `packages/plugin-view/src/SortUI.tsx` declares a DIFFERENT, file-local
 * `const toSortItems` that maps `SortEntry[]`. Its `direction` key is
 * type-correct on `SortUISchema`, it is not this symbol, and it is deliberately
 * untouched.
 */

import { describe, it, expect } from 'vitest';
import { toSortItems } from '../view-config-utils';

describe('toSortItems reads only the canonical `order` spelling', () => {
  it('reads `order`', () => {
    const items = toSortItems([
      { field: 'created_at', order: 'desc' },
      { field: 'name', order: 'asc' },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]?.field).toBe('created_at');
    expect(items[0]?.order).toBe('desc');
    expect(items[1]?.field).toBe('name');
    expect(items[1]?.order).toBe('asc');
  });

  it('does NOT read the retired `direction` spelling — it falls back to `asc`', () => {
    // The unmigrated out-of-tree caller. Before objectui#6011 this returned
    // `order: 'desc'`; the fallback is gone, so the entry now takes the
    // documented default. This assertion is the retirement: it fails against
    // the tolerant `s.order || s.direction || 'asc'` read.
    const items = toSortItems([{ field: 'created_at', direction: 'desc' }]);

    expect(items).toHaveLength(1);
    expect(items[0]?.field).toBe('created_at');
    expect(items[0]?.order).toBe('asc');
  });

  it('ignores `direction` even when it is the only key that could answer', () => {
    const items = toSortItems([
      { field: 'a', direction: 'desc' },
      { field: 'b', order: 'desc' },
    ]);

    expect(items.map((i) => i.order)).toEqual(['asc', 'desc']);
  });

  it('defaults a sort entry with no direction key at all to `asc`', () => {
    const items = toSortItems([{ field: 'name' }]);

    expect(items[0]?.order).toBe('asc');
  });

  it('preserves an explicit id and mints one otherwise', () => {
    const items = toSortItems([{ id: 'fixed', field: 'name', order: 'asc' }, { field: 'other' }]);

    expect(items[0]?.id).toBe('fixed');
    expect(items[1]?.id).toEqual(expect.any(String));
    expect(items[1]?.id).not.toBe('');
  });

  it('returns an empty list for a non-array draft', () => {
    expect(toSortItems(undefined)).toEqual([]);
    expect(toSortItems(null)).toEqual([]);
    expect(toSortItems({ field: 'name', order: 'asc' })).toEqual([]);
  });
});
