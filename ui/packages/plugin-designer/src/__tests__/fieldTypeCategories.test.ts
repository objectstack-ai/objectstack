/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `FIELD_TYPE_CATEGORIES` partitions the designer vocabulary for the type
 * filter and the drawer's type `<select>`. tsc guarantees every entry IS a
 * `DesignerFieldType` (and that `FIELD_TYPE_META` covers the whole union),
 * but nothing at compile time guarantees every type LANDS in a category — a
 * freshly added type would silently be missing from those pickers. This is
 * that gate (objectui#3017).
 */

import { describe, it, expect } from 'vitest';
import { DESIGNER_FIELD_TYPES } from '@object-ui/types';
import { CATEGORY_ORDER, FIELD_TYPE_CATEGORIES } from '../FieldDesigner';

describe('FIELD_TYPE_CATEGORIES covers the designer vocabulary (objectui#3017)', () => {
  const flattened = Object.values(FIELD_TYPE_CATEGORIES).flat();

  it('every DesignerFieldType appears in exactly one category', () => {
    expect(new Set(flattened).size, 'a type appears in two categories').toBe(flattened.length);
    expect([...flattened].sort()).toEqual([...DESIGNER_FIELD_TYPES].sort());
  });

  it('CATEGORY_ORDER renders every category — a dropped entry hides its whole group', () => {
    expect([...CATEGORY_ORDER].sort()).toEqual(Object.keys(FIELD_TYPE_CATEGORIES).sort());
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
  });
});
