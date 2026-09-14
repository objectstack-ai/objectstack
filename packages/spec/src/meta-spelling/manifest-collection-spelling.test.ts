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

/**
 * The `Object.prototype` fall-through pin for BOTH folds.
 *
 * Its POPULATION is the point. The assertions above iterate the declared
 * manifest vocabulary and one ordinary unmapped word — precisely the population
 * that behaves — which is why both sites sat green while
 * `pluralToSingular('constructor')` returned the `Object` FUNCTION out of a
 * signature that declares `string`.
 *
 * `key` is uncontrolled: these folds sit at the boundary where manifest
 * collection fields and `/meta/:type` path segments — author- and
 * client-supplied — are fed into the metadata registry.
 *
 * ⭐ `SINGULAR_TO_PLURAL` is built by `Object.fromEntries`, not written as an
 * object literal. That changes nothing: `Object.fromEntries` returns an
 * ORDINARY object, and the first assertion below is the measurement — both
 * tables carry `Object.prototype` on their chain, so both take the same guard.
 */
describe('pluralToSingular / singularToPlural — Object.prototype fall-through', () => {
  // Fixed at five: the three prototype methods a raw key can name, the
  // assignment-shaped one, and a plain unknown word that names nothing at all.
  // Four is not four-fifths of this pin.
  const POPULATION = ['constructor', 'toString', 'valueOf', '__proto__', 'nope'] as const;

  it('both tables inherit from Object.prototype — the reason the guard is needed on BOTH', () => {
    // The discriminating fact for the second fold: `Object.fromEntries` is not
    // an object literal, and is an ordinary object all the same.
    expect(Object.getPrototypeOf(PLURAL_TO_SINGULAR)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(SINGULAR_TO_PLURAL)).toBe(Object.prototype);
  });

  it('folds the real vocabulary in both directions (lit control — the pin is not vacuous)', () => {
    expect(pluralToSingular('objects')).toBe('object');
    expect(singularToPlural('object')).toBe('objects');
    expect(pluralToSingular('sharingRules')).toBe('sharing_rule');
    expect(singularToPlural('sharing_rule')).toBe('sharingRules');
  });

  it.each(POPULATION)('%s answers a string from both folds, never a prototype member', (word) => {
    // What the defect produced was a `function` (and an `object` for
    // `__proto__`) out of a signature that declares `string`.
    expect(typeof pluralToSingular(word)).toBe('string');
    expect(typeof singularToPlural(word)).toBe('string');
  });

  it("refuses each probe with each function's own declared refusal value", () => {
    // Returning the input verbatim is the trailing `return` of each function —
    // the answer an unmapped word already gets, and what keeps a store key from
    // being manufactured for a collection that does not exist. ⛔ Not a value
    // invented for the fix.
    for (const word of POPULATION) {
      expect(pluralToSingular(word), `pluralToSingular(${word})`).toBe(word);
      expect(singularToPlural(word), `singularToPlural(${word})`).toBe(word);
    }
  });
});
