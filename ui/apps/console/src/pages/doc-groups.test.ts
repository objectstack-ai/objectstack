/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { groupDocsByPackage } from './doc-groups';

describe('groupDocsByPackage (ADR-0046)', () => {
  it('groups docs by namespace prefix', () => {
    const groups = groupDocsByPackage([
      { name: 'crm_user_guide' },
      { name: 'crm_index' },
      { name: 'hr_onboarding' },
    ]);
    expect(groups.map((g) => g.pkg)).toEqual(['crm', 'hr']);
    expect(groups[0].docs.map((d) => d.name)).toEqual(['crm_index', 'crm_user_guide']);
    expect(groups[1].docs.map((d) => d.name)).toEqual(['hr_onboarding']);
  });

  it('sorts groups alphabetically and docs by label then name', () => {
    const groups = groupDocsByPackage([
      { name: 'zoo_b', label: 'Zebra' },
      { name: 'zoo_a', label: 'Antelope' },
      { name: 'apex_x' },
    ]);
    expect(groups.map((g) => g.pkg)).toEqual(['apex', 'zoo']);
    // Sorted by label: Antelope before Zebra.
    expect(groups[1].docs.map((d) => d.name)).toEqual(['zoo_a', 'zoo_b']);
  });

  it('groups a bare (unprefixed) name under itself', () => {
    const groups = groupDocsByPackage([{ name: 'readme' }]);
    expect(groups).toEqual([{ pkg: 'readme', docs: [{ name: 'readme' }] }]);
  });

  it('ignores a leading underscore (no empty-string package)', () => {
    // indexOf('_') === 0 → not a real prefix; group under the whole name.
    const groups = groupDocsByPackage([{ name: '_hidden' }]);
    expect(groups[0].pkg).toBe('_hidden');
  });

  it('drops malformed items without a name', () => {
    const groups = groupDocsByPackage([
      { name: 'crm_a' },
      { name: '' },
      // @ts-expect-error — exercising the runtime guard
      { label: 'no name' },
      // @ts-expect-error — exercising the runtime guard
      null,
    ]);
    expect(groups).toEqual([{ pkg: 'crm', docs: [{ name: 'crm_a' }] }]);
  });

  it('returns an empty array for no docs', () => {
    expect(groupDocsByPackage([])).toEqual([]);
  });
});
