/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * **`DESIGNER_FIELD_TYPES` is the single vocabulary source** (objectui#3017).
 *
 * `DesignerFieldType` is derived from this array, `FieldDesigner`'s
 * `FIELD_TYPE_META` must cover it (total `Record`, so tsc gates that side),
 * and `MetadataFieldsPage` builds its editable-subset check from it. The
 * inventory below is a deliberate second statement of the list:
 * growing or shrinking the vocabulary is a two-file edit by design, so it
 * cannot happen as a drive-by — the failure message routes the editor to the
 * consumers that must be reviewed alongside it.
 */

import { describe, it, expect } from 'vitest';
import { DESIGNER_FIELD_TYPES } from '../index';

const INVENTORY = [
  'address', 'autonumber', 'boolean', 'code', 'color', 'currency', 'date',
  'datetime', 'email', 'file', 'formula', 'html', 'image', 'location',
  'lookup', 'markdown', 'number', 'password', 'percent', 'phone', 'rating',
  'select', 'slider', 'text', 'textarea', 'time', 'url',
] as const;

describe('DESIGNER_FIELD_TYPES (canonical Field Designer vocabulary)', () => {
  it('has no duplicate entries — a duplicate would silently shrink every derived Set', () => {
    expect(new Set(DESIGNER_FIELD_TYPES).size).toBe(DESIGNER_FIELD_TYPES.length);
  });

  it('matches the checked-in inventory — vocabulary edits must be deliberate', () => {
    // If this fails you changed the designer's type vocabulary. That is fine,
    // but it is never only a types change: FieldDesigner needs presentation
    // (FIELD_TYPE_META + FIELD_TYPE_CATEGORIES), and this inventory must be
    // re-pinned to acknowledge the review happened.
    expect([...DESIGNER_FIELD_TYPES].sort()).toEqual([...INVENTORY]);
  });
});
