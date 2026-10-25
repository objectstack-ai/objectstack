/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Item 7 of objectui#4914 — `normalizeFieldType`, behind the retirement gate
 * (maintainer ruling B, 2026-08-18).
 *
 * Measured before the ruling (comment 5324769751):
 * `normalizeFieldType('owner') === 'select'`, the SAME answer `picklist` gets —
 * the retired spelling classified as a first-class option-driven column.
 *
 * This function is the clearest instance of the shape the card originally got
 * wrong. It is a defensive normalizer over an OPEN backend vocabulary: `int`,
 * `money`, `datetime_tz`, `picklist` and a dozen more are equally absent from
 * the spec's closed `FieldType` and were never retired. So "not in the spec
 * enum" could not mean "dead" — which is why the members could not simply be
 * deleted, and why the maintainer answered the boundary question on record:
 * a retired spelling arriving through a backend-vocabulary normalizer is an
 * authoring error to refuse LOUDLY, not legitimate foreign input to tolerate.
 *
 * The refusal is `'text'` — what an unrecognised spelling gets — plus the
 * console prescription. Ablation direction, predicted before running: drop the
 * gate and `refuses a retired spelling` goes RED with `'select'` received,
 * while every never-retired control stays green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RETIRED_FIELD_TYPES, resetRetiredFieldTypeReports } from '@object-ui/core';
import { normalizeFieldType } from '../view-config-utils';

const RETIRED = Object.keys(RETIRED_FIELD_TYPES)[0];

/**
 * The measurement's own reductio, as a control table: every one of these is
 * outside the spec's closed `FieldType` and every one is a deliberate
 * compatibility member. They are what proves the gate reads the RETIREMENT
 * TABLE and not "is this in the spec enum".
 */
const NEVER_RETIRED_NON_SPEC: ReadonlyArray<[string, string]> = [
  ['picklist', 'select'],
  ['single_select', 'select'],
  ['money', 'number'],
  ['int', 'number'],
  ['double', 'number'],
  ['datetime_tz', 'date'],
  ['timestamp', 'date'],
  ['bool', 'boolean'],
  ['checkbox', 'boolean'],
  ['master_detail', 'select'],
  ['user', 'select'],
];

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRetiredFieldTypeReports();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  resetRetiredFieldTypeReports();
});

describe('`normalizeFieldType` — the open backend vocabulary is untouched', () => {
  it('still classifies every never-retired non-spec spelling exactly as before', () => {
    // NON-VACUITY CONTROL for the refusal below: these must keep their
    // categories, or the gate has over-reached from "retired" to "not in spec"
    // and taken the compatibility layer with it.
    for (const [spelling, category] of NEVER_RETIRED_NON_SPEC) {
      expect(normalizeFieldType(spelling), spelling).toBe(category);
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still falls to `text` for a spelling it has never heard of, silently', () => {
    expect(normalizeFieldType('a_type_from_some_other_backend')).toBe('text');
    expect(normalizeFieldType(undefined)).toBe('text');
    expect(normalizeFieldType('')).toBe('text');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('`normalizeFieldType` — a retired spelling is refused, loudly', () => {
  it('refuses a retired spelling to `text`, where it used to answer `select`', () => {
    expect(normalizeFieldType(RETIRED)).toBe('text');
    // Stated as the comparison the ruling makes: the retired column gets the
    // unknown column's answer, and specifically NOT the live sibling's.
    expect(normalizeFieldType(RETIRED)).toBe(normalizeFieldType('a_type_from_some_other_backend'));
    expect(normalizeFieldType(RETIRED)).not.toBe(normalizeFieldType('user'));
  });

  it('refuses the CASE-FOLDED spelling too — the function lowercases first', () => {
    // The gate runs after the fold, so a stored `Owner` is refused as well.
    // Pinned because a gate placed before the fold would silently miss it.
    expect(normalizeFieldType(RETIRED.toUpperCase())).toBe('text');
  });

  it('says why exactly once, however many columns are normalized', () => {
    for (let i = 0; i < 8; i += 1) normalizeFieldType(RETIRED);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(RETIRED_FIELD_TYPES[RETIRED]);
  });

  it('closes the CLASS — quantified over the table', () => {
    for (const spelling of Object.keys(RETIRED_FIELD_TYPES)) {
      expect(normalizeFieldType(spelling), spelling).toBe('text');
    }
  });
});
