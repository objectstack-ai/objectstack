// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bound pair on the screen-input VALUE contract (#17306).
 *
 * `min` / `max` are declared on `ScreenFieldConfigSchema` and forwarded onto
 * the `ScreenFieldSpec` the client renders — but a screen field's declared
 * contract is the ONLY contract behind it, so a bound the dialog alone applied
 * would be bypassed by any caller that posts to `resume` directly. That is the
 * gap #4477 closed for `required`, and these pin the same closure for the
 * bound: the client stops the user at the input, the server stops everyone.
 */

import { describe, expect, it } from 'vitest';

import type { ScreenFieldSpec } from '@objectstack/spec/contracts';

import { validateScreenInputs } from './screen-input-contract.js';

const ALWAYS_VISIBLE = () => true;

const discount: ScreenFieldSpec = { name: 'discount', type: 'number', min: 0, max: 20 };

describe('validateScreenInputs — the declared bound pair (#17306)', () => {
  it('accepts a value inside the bound, and both endpoints (inclusive)', () => {
    for (const value of [0, 5, 20]) {
      expect(validateScreenInputs([discount], { discount: value }, ALWAYS_VISIBLE), `value ${value}`)
        .toEqual([]);
    }
  });

  it('refuses a value above `max` with the catalog code that mirrors the key', () => {
    const issues = validateScreenInputs([discount], { discount: 25 }, ALWAYS_VISIBLE);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('max_value');
    expect(issues[0]!.field).toBe('discount');
    expect(issues[0]!.message).toContain('20');
  });

  it('refuses a value below `min`', () => {
    const issues = validateScreenInputs([discount], { discount: -1 }, ALWAYS_VISIBLE);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('min_value');
  });

  // ── The cost direction: what the bound must NOT start refusing ───────────
  it('leaves an unbounded field alone — the historical pass-through is intact', () => {
    const free: ScreenFieldSpec = { name: 'note', type: 'number' };
    expect(validateScreenInputs([free], { note: 999999 }, ALWAYS_VISIBLE)).toEqual([]);
  });

  it('does not fire on an ABSENT value — that is the `required` question, not this one', () => {
    // An optional bounded field left empty is conformant. Reading absence as
    // an out-of-bound zero would make every optional bound secretly required.
    expect(validateScreenInputs([discount], {}, ALWAYS_VISIBLE)).toEqual([]);
  });

  it('does not fire on a non-numeric value — `type` has no closed vocabulary here', () => {
    // The surface deliberately does not judge value shape; inventing an
    // `invalid_number` on this path would promise a check it never declared.
    expect(validateScreenInputs([discount], { discount: 'twenty' }, ALWAYS_VISIBLE)).toEqual([]);
  });

  it('does not fire on a field the user was never shown', () => {
    // Same reason `required` does not: the client is the authority on what was
    // on screen, and enforcing over a hidden field dead-ends the run (#3528).
    const conditional: ScreenFieldSpec = { ...discount, visibleWhen: 'wantsDiscount == true' };
    expect(validateScreenInputs([conditional], { discount: 999 }, () => false)).toEqual([]);
    expect(validateScreenInputs([conditional], { discount: 999 }, () => undefined)).toEqual([]);
    // …and the control: visible ⇒ it fires, or the three readings above prove nothing.
    expect(validateScreenInputs([conditional], { discount: 999 }, () => true)).toHaveLength(1);
  });

  it('still reports `required` and `unknown_field` alongside a bound violation', () => {
    const fields: ScreenFieldSpec[] = [discount, { name: 'reason', type: 'text', required: true }];
    const issues = validateScreenInputs(fields, { discount: 99, sparkles: true }, ALWAYS_VISIBLE);
    expect(issues.map((i) => i.code).sort()).toEqual(['max_value', 'required', 'unknown_field']);
  });
});
