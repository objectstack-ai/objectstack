// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * R8 `field/select-missing-options` counts a `picklist` reference as an options
 * source, and its fix never prescribes `options` beside `picklist`.
 *
 * A field that names a shared list (`Field.select({ picklist: 'industry' })`)
 * takes its options from that list and declares none of its own — and
 * `FieldSchema` refuses `options` declared beside `picklist`. So R8 warning
 * "has no options" on such a field, with a remedy of adding `options`, told
 * the author to write the one shape the schema door refuses.
 *
 * The control is the half that keeps this from being a deletion: a select
 * with NEITHER source still warns, and its fix names both sources as
 * alternatives.
 */

import { describe, expect, it } from 'vitest';
import { lintDataModel } from './data-model-rules.js';

const R8 = 'field/select-missing-options';

const r8 = (fields: Record<string, unknown>) =>
  lintDataModel([{ name: 'pk_account', nameField: 'name', fields: { name: { type: 'text' }, ...fields } }])
    .filter((issue) => issue.rule === R8);

describe('R8 — a `picklist` reference is an options source', () => {
  it.each(['select', 'multiselect', 'radio'])('a %s naming a picklist is not reported', (type) => {
    expect(r8({ industry: { type, picklist: 'industry' } })).toEqual([]);
  });

  it('CONTROL: a select with neither `options` nor `picklist` still warns, at the field', () => {
    const issues = r8({ industry: { type: 'select' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'warning', path: 'objects[0].fields.industry.options' });
  });

  it('the fix names both sources — `options` and `picklist` — not `options` alone', () => {
    const [issue] = r8({ industry: { type: 'select' } });
    expect(issue.fix).toBeDefined();
    expect(issue.fix).toContain('`options');
    expect(issue.fix).toContain('`picklist');
  });

  it('CONTROL: an empty `picklist` string is no source', () => {
    expect(r8({ industry: { type: 'select', picklist: '' } })).toHaveLength(1);
  });
});
