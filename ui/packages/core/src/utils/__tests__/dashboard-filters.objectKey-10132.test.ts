/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10132, half 1 — the SEAM half.
 *
 * `@objectstack/spec`'s `GlobalFilterSchema` carries an optional `object` key
 * whose own describe text is
 * "Object whose `fields.<object>.<field>` translation-bundle entry resolves
 * this filter's field label and option labels". `resolveDashboardFilterDefs`
 * built its `DashboardFilterDef` by naming the keys it copies, and `object`
 * was not among them — so the authored value could not reach a renderer even
 * in principle. That is the declared-but-unenforced shape: authorable,
 * documented, validated, and inert.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * The seam only: the authored key survives the normalization. It cannot pin
 * that a viewer sees a translated label — `@object-ui/core` is locale-free by
 * design (see `DashboardFilterDef.label`'s own comment) and holds no bundle.
 * The rendered half is `DashboardFilterBar.objectBundleLabel-10132.test.tsx`
 * in `@object-ui/plugin-dashboard`, which renders the same filter with the
 * bundle entry present and absent and asserts the two differ.
 *
 * A green run here over a filter bar that never reads the key would be a
 * correct seam feeding no consumer at all — which is precisely the state the
 * card reports — so neither half stands alone.
 *
 * PREDICTIONS, written before the run: the two `object` cases are RED (the key
 * is absent from the def); the "no `object` authored" and untouched-key cases
 * are GREEN on both sides — they pin decisions that must NOT move.
 */

import { describe, it, expect } from 'vitest';
import { resolveDashboardFilterDefs } from '../dashboard-filters';

describe('resolveDashboardFilterDefs — the spec `object` key reaches the definition (objectui#10132)', () => {
  it('copies an authored `object` onto the filter definition', () => {
    const [def] = resolveDashboardFilterDefs({
      globalFilters: [{ name: 'type', field: 'type', object: 'opportunity', type: 'select' }],
    } as never);

    expect(def.object).toBe('opportunity');
  });

  it('carries it for a filter that also declares a label and options', () => {
    // The key is additive: it does not replace either of the two slots that
    // already resolve, it names the bundle entry they are looked up under.
    const [def] = resolveDashboardFilterDefs({
      globalFilters: [
        {
          name: 'type',
          field: 'type',
          object: 'opportunity',
          type: 'select',
          label: 'Type',
          options: [{ value: 'new_business', label: 'New business' }],
        },
      ],
    } as never);

    expect(def.object).toBe('opportunity');
    expect(def.label).toBe('Type');
    expect(def.options).toEqual([{ value: 'new_business', label: 'New business' }]);
  });

  it('leaves `object` absent when the author declared none — the live control', () => {
    // The acceptance boundary: every dashboard authored today resolves to a
    // byte-identical def, and `'object' in def` stays the discriminator a
    // consumer branches on.
    const [def] = resolveDashboardFilterDefs({
      globalFilters: [{ name: 'type', field: 'type', type: 'select', label: 'Type' }],
    } as never);

    expect(def.object).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(def, 'object')).toBe(false);
  });

  it('does not confuse it with `optionsFrom.object`, which names a different object', () => {
    // The spec's own text separates the two: `optionsFrom.object` names where
    // dynamic OPTIONS are fetched from (it may differ — filtering `opportunity`
    // by `owner` with options sourced from `user`), while this key names the
    // object `field` itself lives on, which is what a translator's bundle entry
    // is keyed by. A fix that read `optionsFrom.object` for label resolution
    // would resolve against the wrong object for exactly that filter.
    const [def] = resolveDashboardFilterDefs({
      globalFilters: [
        {
          name: 'owner',
          field: 'owner',
          object: 'opportunity',
          type: 'lookup',
          optionsFrom: { object: 'user', valueField: 'id', labelField: 'name' },
        },
      ],
    } as never);

    expect(def.object).toBe('opportunity');
    expect(def.optionsFrom?.object).toBe('user');
  });
});
