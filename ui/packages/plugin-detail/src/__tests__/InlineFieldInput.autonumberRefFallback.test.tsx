/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The REFERENCE-FALLBACK half of objectui#4219 — `TEXTUAL_REF_FALLBACK_TYPES`
 * must carry both spellings of the auto-number type.
 *
 * #4219 was filed against the editability gate: the set spells the type
 * `auto_number` while `@objectstack/spec` (and the designer, and the importer)
 * spell it `autonumber`, so a machine-generated identity was hand-editable.
 * #4228 closed that half from a different direction — both hosts now also
 * consult the fields package's alias-aware exclusion, which resolves
 * `autonumber` onto the excluded `auto_number`, so no affordance is offered
 * (pinned in `inlineEditTypeCoverage.test.tsx`).
 *
 * What #4228 does NOT reach is this file's reference fallback:
 *
 * ```
 * const isLookupRef = … || (!!field.reference && !TEXTUAL_REF_FALLBACK_TYPES.has(editType));
 * ```
 *
 * That read is `InlineFieldInput`'s own, on EXPORTED public API, with no host
 * gate in front of it — a caller rendering the component directly (the SDUI
 * surfaces do) gets whatever the set says. So an `autonumber` carrying a
 * `reference` — computed fields keep one for relational metadata, which is
 * the entire reason this set exists — was hijacked into the RECORD PICKER,
 * offering the user a list of records to overwrite a machine-generated value
 * with. The `auto_number` spelling of the identical field was not.
 *
 * The two gates are a UNION (`isComputedFieldType`, #3355), and until this fix
 * the union's survivability depended on which spelling the metadata happened to
 * use: `autonumber` was carried by the exclusion gate alone, `auto_number` by
 * both. Losing either gate would then have re-opened a different half of the
 * defect depending on the authoring spelling — so the last case here asserts
 * membership directly, on the set itself.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  InlineFieldInput,
  INLINE_PLAIN_TEXT_INPUT_TESTID,
  TEXTUAL_REF_FALLBACK_TYPES,
} from '../InlineFieldInput';
import { isComputedFieldType } from '../fieldEnrichment';

/** The terminal raw text input — the documented "textual fallback". */
const plainInput = () => screen.queryByTestId(INLINE_PLAIN_TEXT_INPUT_TESTID);

/**
 * The record picker's trigger (`LookupField`). Queried by its own test id
 * rather than by "some input exists": the terminal text input renders an
 * `input` too, so a role/tag heuristic reads the picker and the fallback as the
 * same thing — exactly the confusion this pin has to resolve.
 */
const recordPicker = () => screen.queryByTestId(/^lookup-trigger/);

const dataSource = { find: vi.fn(async () => ({ data: [], total: 0 })), findOne: vi.fn() };

const renderField = (type: string, extra: Record<string, unknown> = {}) =>
  render(
    <InlineFieldInput
      field={{ name: 'invoice_no', type, reference: 'crm_account', ...extra }}
      value="INV-000317"
      onChange={vi.fn()}
      dataSource={dataSource}
    />,
  );

describe('#4219 — the reference fallback carries both auto-number spellings', () => {
  it('`autonumber` + `reference` renders the textual fallback, NOT the record picker', () => {
    renderField('autonumber');
    // Before the fix this was the record picker: the set had no `autonumber`,
    // so `!!reference && !TEXTUAL_REF_FALLBACK_TYPES.has('autonumber')` was
    // true and `LookupField` took over the machine-generated identity.
    expect(recordPicker()).toBeNull();
    expect(plainInput()).not.toBeNull();
    expect(plainInput()).toHaveValue('INV-000317');
  });

  it('`auto_number` + `reference` is unchanged (control — the spelling that already worked)', () => {
    renderField('auto_number');
    expect(recordPicker()).toBeNull();
    expect(plainInput()).toHaveValue('INV-000317');
  });

  it('a real `lookup` still gets the record picker (control — the fix must not over-block)', () => {
    renderField('lookup', { name: 'account' });
    // The fallback set is about types that merely CARRY a reference; widening
    // it must never swallow a type whose value really is a record reference.
    expect(recordPicker()).not.toBeNull();
    expect(plainInput()).toBeNull();
  });

  it('both spellings are computed for the gate union, and members of the one set', () => {
    // Membership on the set itself, not only through the helper: the union's
    // survivability must not depend on which spelling the metadata uses.
    expect(TEXTUAL_REF_FALLBACK_TYPES.has('autonumber')).toBe(true);
    expect(TEXTUAL_REF_FALLBACK_TYPES.has('auto_number')).toBe(true);
    // …and the union reads it from either side (view entry / object schema).
    expect(isComputedFieldType('autonumber', undefined)).toBe(true);
    expect(isComputedFieldType(undefined, 'autonumber')).toBe(true);
  });
});
