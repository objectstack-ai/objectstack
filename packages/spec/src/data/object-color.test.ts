// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from './object.zod';
import { OBJECT_COLORS } from './index';

/**
 * [#35985] `ObjectSchema.color` — one name from a closed palette of nine; the
 * console draws the object's icon as a white glyph on a square of it.
 */
describe('ObjectSchema.color', () => {
  const base = { name: 'account', fields: { name: { label: 'Name', type: 'text' } } };

  it('is the nine-name palette, gray first (the neutral an object without a colour is drawn in)', () => {
    expect(OBJECT_COLORS).toEqual(['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'purple']);
  });

  it('accepts every palette name, and absence', () => {
    for (const color of OBJECT_COLORS) {
      expect(ObjectSchema.safeParse({ ...base, color }).success).toBe(true);
    }
    const parsed = ObjectSchema.parse(base);
    expect(parsed.color).toBeUndefined();
  });

  it('refuses a free colour value, and the refusal names the palette', () => {
    for (const color of ['#ff0000', 'rgb(255,0,0)', 'Blue', 'success', 'default', '']) {
      const result = ObjectSchema.safeParse({ ...base, color });
      expect(result.success, color).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'color');
      expect(issue, color).toBeDefined();
      for (const name of OBJECT_COLORS) expect(issue!.message).toContain(name);
    }
  });
});
