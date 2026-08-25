// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11503] The manifest-collection vocabulary's schema-free home, pinned.
 *
 * `PLURAL_TO_SINGULAR` moved from `shared/metadata-collection.zod.ts` to this
 * entry's graph so `@objectstack/core`'s store-key fold (#7378 row 2 — the map
 * has ONE owner) stops linking the `/shared` zod closure into every browser
 * consumer (#10096 standing principle, recorded verbatim, untranslated:
 * 「浏览器可达的 spec 导出面必须 schema-free」). Two facts must hold and are
 * pinned here:
 *
 *  1. the move is a RE-EXPORT, not a fork — `/shared` and `/meta-spelling`
 *     hand out reference-identical bindings (a faithful copy would pass every
 *     value comparison, so identity is the discriminating check);
 *  2. widening the entry did NOT merge the two spelling contracts (#8424) —
 *     the manifest map and the URL map stay distinct symbols with distinct
 *     key sets.
 *
 * Schema-freeness of the BUILT entry is not asserted here — that is
 * `check:browser-reachable-entries`' job, on the real bundle.
 */

import { describe, expect, it } from 'vitest';
import {
  PLURAL_TO_SINGULAR,
  SINGULAR_TO_PLURAL,
  pluralToSingular,
  singularToPlural,
  META_URL_TO_SINGULAR,
} from './index';

describe('#11503 — the manifest-collection vocabulary is the SAME contract on both entries', () => {
  it('`/meta-spelling` and `/shared` hand out identical bindings (one declaration, two entries)', async () => {
    const shared = await import('../shared/metadata-collection.zod');
    expect(shared.PLURAL_TO_SINGULAR).toBe(PLURAL_TO_SINGULAR);
    expect(shared.SINGULAR_TO_PLURAL).toBe(SINGULAR_TO_PLURAL);
    expect(shared.pluralToSingular).toBe(pluralToSingular);
    expect(shared.singularToPlural).toBe(singularToPlural);
  });

  it('folds a manifest collection key and passes unmapped names through', () => {
    expect(pluralToSingular('objects')).toBe('object');
    expect(singularToPlural('object')).toBe('objects');
    expect(pluralToSingular('object')).toBe('object');
    expect(pluralToSingular('not_a_collection')).toBe('not_a_collection');
  });
});

describe('#8424 — widening the entry did not merge the two spelling contracts', () => {
  it('keeps the manifest map and the URL map distinct symbols', () => {
    expect(PLURAL_TO_SINGULAR).not.toBe(META_URL_TO_SINGULAR);
  });

  it('the manifest map still lacks the four registry-only spellings the URL map carries', () => {
    // These are URL spellings of registry types that are NOT stack-level
    // collections — adding any of them to the manifest map would advertise a
    // `defineStack()` collection that does not exist (the `fields:` incident,
    // see metadata-url-spelling.ts).
    for (const key of ['fields', 'seeds', 'translations', 'external_catalogs', 'externalCatalogs']) {
      expect(PLURAL_TO_SINGULAR[key], `${key} must not enter the manifest map`).toBeUndefined();
    }
    expect(META_URL_TO_SINGULAR['fields']).toBe('field');
    expect(META_URL_TO_SINGULAR['seeds']).toBe('seed');
  });
});
