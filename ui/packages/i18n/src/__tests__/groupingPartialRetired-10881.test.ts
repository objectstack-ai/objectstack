/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10881 — the grouped grid's `Partial` marker is retired from every
 * pack, and the refusal that replaced it is in every pack.
 *
 * Maintainer ruling F: a grouped grid over a data source that declares no
 * `queryGroupHeaders` refuses grouping loudly, naming that member, instead of
 * grouping the page it fetched and marking the counts partial — so the
 * marker's three `grid.grouping.partial*` rows go from all ten packs, and one
 * `grid.grouping.needsHeaderQuery` row arrives in all ten.
 *
 * The absence half is only a measurement if the walker below can see that
 * namespace at all, so the presence half is its control: the SAME walk over
 * the SAME packs must find the new key in every one of them. A walker that
 * never reached `grid.grouping` would pass the first assertion and fail the
 * second.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

/** Every leaf key of a pack, dotted, with its value. */
function leaves(node: unknown, prefix = ''): Array<[string, unknown]> {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  );
}

const PACKS = Object.entries(builtInLocales);

describe('the grouped grid marker is retired from every locale pack (objectui#10881)', () => {
  it('reads all ten packs', () => {
    expect(PACKS.map(([code]) => code).sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh']);
  });

  it.each(PACKS)('%s carries no grid.grouping.partial* key', (_code, pack) => {
    const partial = leaves(pack).map(([key]) => key).filter((key) => key.startsWith('grid.grouping.partial'));
    expect(partial).toEqual([]);
  });

  // CONTROL — the same walk reaches `grid.grouping`: the refusal is there, and
  // names the member it refuses on in every language.
  it.each(PACKS)('%s carries grid.grouping.needsHeaderQuery, naming queryGroupHeaders', (_code, pack) => {
    const value = new Map(leaves(pack)).get('grid.grouping.needsHeaderQuery');
    expect(typeof value).toBe('string');
    expect(value as string).toContain('queryGroupHeaders');
  });
});
