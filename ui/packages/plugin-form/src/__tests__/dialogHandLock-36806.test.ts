/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #36806 — the create and edit dialogs read the hand lock: a `uiReadonly`
 * field is left off both dialogs (as `readonly` is) and never rides in the
 * payload a dialog submits, so a UI create falls back to the field's
 * `defaultValue` on the server. A `uiReadonlyWhen` field stays listed — its
 * predicate is judged per record by the form renderer.
 */
import { describe, it, expect } from 'vitest';
import { filterCreateModeFields, filterSystemFields } from '../autoLayout';
import { sanitizeFormData } from '../sanitize';
import type { FormField } from '@object-ui/types';

const objectSchema = {
  fields: {
    title: { type: 'text' },
    status: { type: 'select', uiReadonly: true },
    note: { type: 'text', uiReadonlyWhen: "record.status != 'draft'" },
  },
};
const fields = [
  { name: 'title', type: 'text' },
  { name: 'status', type: 'select' },
  { name: 'note', type: 'text' },
] as FormField[];

describe('dialog hand lock (#36806)', () => {
  it('a uiReadonly field is off the create and the edit dialog; uiReadonlyWhen stays', () => {
    expect(filterCreateModeFields(fields, objectSchema).map((f) => f.name)).toEqual(['title', 'note']);
    expect(filterSystemFields(fields, objectSchema).map((f) => f.name)).toEqual(['title', 'note']);
  });

  it('a uiReadonly field never rides in the submitted payload', () => {
    const out = sanitizeFormData({ title: 'A', status: 'approved', note: 'n' }, objectSchema);
    expect(out).toEqual({ title: 'A', note: 'n' });
  });
});
