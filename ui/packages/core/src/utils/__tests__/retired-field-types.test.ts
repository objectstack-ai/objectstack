/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE retirement gate — `isRetiredFieldType` and its once-per-spelling reporter
 * (objectui#4914, maintainer ruling B of 2026-08-18).
 *
 * This file pins the gate itself. The six ruled predicate faces each pin their
 * own refusal in their own package; what belongs HERE is the property those six
 * files depend on and cannot each prove: the gate is quantified over the TABLE,
 * and the console prescription is deduplicated per SPELLING rather than per
 * face — so a filter row refused by `operatorsForFieldType`, by the control
 * chooser and by `normalizeFieldType` in one render still prints one line.
 *
 * Every assertion is written against `RETIRED_FIELD_TYPES` rather than against
 * the literal `owner`, deliberately: the next retirement must be covered by
 * this file on the day it lands, not by whoever remembers to come back here.
 * The one place a literal is allowed is the "never retired" control list, whose
 * whole job is to be a spelling the gate must NOT claim.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RETIRED_FIELD_TYPES,
  isRetiredFieldType,
  reportRetiredFieldType,
  resetRetiredFieldTypeReports,
} from '../retired-field-types.js';

/**
 * Spellings that are NOT retired and must never be claimed by the gate.
 *
 * Three of them (`reference`, `picklist`, `money`) are the measurement's own
 * reductio (comment 5324769751): they are equally absent from the spec's closed
 * `FieldType` and were never retired, which is why "not in the spec enum" could
 * not be the test for deadness. If the gate ever starts answering `true` for
 * one of these, it has stopped reading the table and started guessing.
 */
const NEVER_RETIRED = ['user', 'lookup', 'reference', 'picklist', 'money', 'text'] as const;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRetiredFieldTypeReports();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  resetRetiredFieldTypeReports();
});

describe('`isRetiredFieldType` — the gate', () => {
  it('claims every key of the table and nothing else', () => {
    const retired = Object.keys(RETIRED_FIELD_TYPES);
    // Non-vacuity: an empty table would make every assertion below trivially
    // true, and this file would pass while guarding nothing.
    expect(retired.length).toBeGreaterThan(0);

    for (const spelling of retired) {
      expect(isRetiredFieldType(spelling), spelling).toBe(true);
    }
    for (const live of NEVER_RETIRED) {
      expect(isRetiredFieldType(live), live).toBe(false);
    }
  });

  it('is PURE — deciding does not log', () => {
    for (const spelling of Object.keys(RETIRED_FIELD_TYPES)) isRetiredFieldType(spelling);
    // The gate answers the question; `reportRetiredFieldType` is what makes a
    // face loud. Keeping them separable is what lets a face decide WHERE in its
    // control flow the author's prescription belongs.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not answer through the prototype chain', () => {
    // `RETIRED_FIELD_TYPES[type]` — an index read, which is what this module
    // used before the gate existed — is truthy for these. A backend column
    // typed `constructor` is absurd, but "absurd input silently classified as
    // retired" is a refusal an author could never explain.
    for (const inherited of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(isRetiredFieldType(inherited), inherited).toBe(false);
    }
  });

  it('answers false for the absent cases rather than throwing', () => {
    expect(isRetiredFieldType(undefined)).toBe(false);
    expect(isRetiredFieldType(null)).toBe(false);
    expect(isRetiredFieldType('')).toBe(false);
  });
});

describe('`reportRetiredFieldType` — loud, exactly once per spelling', () => {
  it('logs the table’s own prescription, and returns true', () => {
    for (const [spelling, prescription] of Object.entries(RETIRED_FIELD_TYPES)) {
      resetRetiredFieldTypeReports();
      errorSpy.mockClear();
      expect(reportRetiredFieldType(spelling)).toBe(true);
      // The message is asserted to BE the table's entry, never re-spelled here:
      // one place owns the words an author is told to follow.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(prescription);
    }
  });

  it('fires ONCE across many calls — the ruling’s "once", not once per face', () => {
    const [spelling] = Object.keys(RETIRED_FIELD_TYPES);

    // Six calls stands for the six ruled faces answering about one column in
    // one render. A gate that logged per face would print six lines and bury
    // the prescription it exists to surface — that is a defect of its own, so
    // it is pinned rather than assumed.
    for (let i = 0; i < 6; i += 1) {
      expect(reportRetiredFieldType(spelling)).toBe(true);
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a live spelling and returns false', () => {
    for (const live of NEVER_RETIRED) {
      expect(reportRetiredFieldType(live), live).toBe(false);
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('agrees with the gate on every input, both ways', () => {
    // The two must never disagree: a face that branches on the reporter's
    // return and a face that branches on the gate would otherwise dispose of
    // the same column differently.
    for (const probe of [...Object.keys(RETIRED_FIELD_TYPES), ...NEVER_RETIRED, 'constructor', '']) {
      resetRetiredFieldTypeReports();
      expect(reportRetiredFieldType(probe), probe).toBe(isRetiredFieldType(probe));
    }
  });

  it('the reset seam actually forgets — otherwise every "once" pin is untestable', () => {
    const [spelling] = Object.keys(RETIRED_FIELD_TYPES);
    reportRetiredFieldType(spelling);
    reportRetiredFieldType(spelling);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    resetRetiredFieldTypeReports();
    reportRetiredFieldType(spelling);
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
