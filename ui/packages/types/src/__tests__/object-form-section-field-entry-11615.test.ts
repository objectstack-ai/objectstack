/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectFormSection.fields` declares all three entry shapes the form draws
 * (objectui#11615).
 *
 * `buildSectionFields` (`@object-ui/plugin-form`) draws a field NAME, the form
 * view's `{ field, … }` entry, and an inline runtime `FormField`. The type
 * declared `(string | FormField)[]`, so the middle shape — the one
 * `@objectstack/spec`'s own `FormSectionSchema.fields` takes beside a bare
 * name — did not compile for a TypeScript author: `FormField` requires `name`
 * and declares its `field` slot as the resolved metadata OBJECT, never a
 * string. The arm is now the spec's `FormFieldInput`, by reference.
 *
 * ⚠️ COMPILE-time first: the annotations do the work, so `type-check` (this
 * package's `tsconfig.test.json`) is the instrument that can fail these rows,
 * and vitest — which strips types — cannot. The runtime expectations only keep
 * each row from passing on an emptied literal.
 */

import { describe, it, expect } from 'vitest';
import type { ObjectFormSection } from '../objectql';

describe('`ObjectFormSection.fields` — the three entry shapes (objectui#11615)', () => {
  it('annotates a name, the form view `{ field }` entry, and an inline `FormField` side by side', () => {
    const section: ObjectFormSection = {
      name: 'main',
      label: 'Main',
      fields: [
        'customer',
        { field: 'note', label: 'Note override', required: true, colSpan: 2, helpText: 'Shown under it' },
        { name: 'memo', type: 'text', label: 'Memo' },
      ],
    };
    expect(section.fields).toHaveLength(3);
    expect(section.fields?.[1]).toEqual(
      expect.objectContaining({ field: 'note', required: true }),
    );
  });

  it('the `{ field }` arm is the spec’s own entry type, so a mistyped override is a compile error', () => {
    const section: ObjectFormSection = {
      fields: [
        // @ts-expect-error — `colSpan` is a number on the spec's form-view entry
        { field: 'note', colSpan: 'two' },
      ],
    };
    expect(section.fields).toHaveLength(1);
  });
});
