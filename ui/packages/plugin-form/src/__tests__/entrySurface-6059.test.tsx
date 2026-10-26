/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6059 — what `schemaDefaults.ts` publishes from the package ENTRY,
 * and what it deliberately does not.
 *
 * The card is a surface decision, so the surface is what this pins. Two names
 * became importable and the reason they travel together is that each one's
 * docblock names the other as its half: `omitServerResolvedDefaults` drops the
 * keys a CREATE payload must leave to the producer, `isRequiredInForm` excuses
 * those same fields from the client-side `required` rule, and a consumer able
 * to reach one but not the other can build the half-fixed state #4069 and
 * #5883 closed on the two form chains separately.
 *
 * ## Why the negative half is the load-bearing one
 *
 * "These two are exported" is proved by anything that imports them — the
 * console's `FormPage` does, and its own suite would go red without them. What
 * nothing else would notice is the OTHER direction: `schemaDefaults.ts` holds
 * five more names, and `export * from './schemaDefaults'` would have published
 * every one of them in a diff that looks tidier than the explicit list. Every
 * added name is published surface somebody then has to keep compatible, so the
 * withheld set is asserted rather than left to the reviewer's eye.
 *
 * `isRuntimeDefault` is withheld for a stronger reason than "nobody asked". It
 * belongs to `@object-ui/core` (it moved there in #4085 exactly so a third
 * consumer could read one answer); this module re-exports it for its own call
 * sites, and re-publishing it from a plugin entry would put a second spelling
 * of one classifier back into the workspace. The README says so too, in the
 * "`required` + a runtime default" section.
 */

import { describe, expect, it } from 'vitest';
import * as entry from '../index';
import { optionListDefault, type OptionListFieldLike } from '../index';
import * as schemaDefaults from '../schemaDefaults';

/**
 * Published by the entry: the #6059 pair, plus `optionListDefault` for the
 * console's public form page (objectui#13049) — the one reading of an option's
 * `default: true` both form renderers seed from.
 */
const PUBLISHED = ['omitServerResolvedDefaults', 'isRequiredInForm', 'optionListDefault'] as const;

/**
 * Present in `schemaDefaults.ts` and deliberately NOT on the entry. `SeedContext`
 * is type-only and cannot be probed at runtime, so it is absent from this list
 * by construction rather than by choice.
 */
const WITHHELD = [
  'seedCreateValues',
  'schemaDefaultValues',
  'isSeedableDefault',
  'isCreateFormMode',
  'isRuntimeDefault',
] as const;

describe('@object-ui/plugin-form entry — the #6059 surface addition', () => {
  it('publishes the pair and the option-list reading, as the very functions `schemaDefaults` defines', () => {
    for (const name of PUBLISHED) {
      expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
      // Identity, not just presence: a re-export cannot quietly become a
      // second implementation that is free to disagree with the one the
      // package's own containers call.
      expect((entry as Record<string, unknown>)[name]).toBe(
        (schemaDefaults as Record<string, unknown>)[name],
      );
    }
  });

  it('withholds the rest of `schemaDefaults`, including the core classifier', () => {
    for (const name of WITHHELD) {
      // Present in the module, absent from the entry — which is the whole
      // decision, and the thing `export *` would have undone.
      expect(typeof (schemaDefaults as Record<string, unknown>)[name]).toBe('function');
      expect(Object.keys(entry)).not.toContain(name);
    }
  });

  it('adds exactly those three names to the entry and no others from this module', () => {
    const fromSchemaDefaults = Object.keys(entry).filter((k) =>
      Object.prototype.hasOwnProperty.call(schemaDefaults, k),
    );
    expect(fromSchemaDefaults.sort()).toEqual([...PUBLISHED].sort());
  });
});

describe('@object-ui/plugin-form entry — `optionListDefault` and its parameter type (objectui#13049)', () => {
  it('a field held under the published type flows through the published function', () => {
    // Annotated with the published name: `tsc` (the package's type-check) is
    // what judges that the type is importable from the entry.
    const single: OptionListFieldLike = {
      type: 'select',
      options: [{ value: 'low', default: true }, { value: 'high' }],
    };
    const multi: OptionListFieldLike = {
      type: 'select',
      multiple: true,
      options: [{ value: 'a', default: true }, { value: 'b' }, { value: 'c', default: true }],
    };
    expect(optionListDefault(single)).toBe('low');
    expect(optionListDefault(multi)).toEqual(['a', 'c']);
    expect(optionListDefault({ options: [{ value: 'x' }] })).toBeUndefined();
    expect(optionListDefault(undefined)).toBeUndefined();
  });

  it('adds no RUNTIME name for the type', () => {
    expect(Object.keys(entry)).not.toContain('OptionListFieldLike');
  });
});
