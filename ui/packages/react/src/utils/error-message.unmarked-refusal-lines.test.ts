/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `unmarkedRefusalLines` — one form-level line per refused entry no input
 * carries (objectstack-ai/objectstack#28053).
 *
 * The fixture is the body `POST /api/v1/data/:object` answers when two
 * validation rules fail on one save, as measured through the REST route over a
 * real engine: one `fields[]` entry per rule, the located one on the field the
 * rule names, the other on `_record`, and only the top-level `error` joined
 * with `; `.
 */

import { describe, it, expect } from 'vitest';

import { unmarkedRefusalLines } from './error-message';

const twoRules = {
  error: 'Best case must be at least the amount.; Amount must be positive.',
  code: 'VALIDATION_FAILED',
  fields: [
    { field: 'best', code: 'rule_violation', message: 'Best case must be at least the amount.' },
    { field: '_record', code: 'rule_violation', message: 'Amount must be positive.' },
  ],
  object: 'forecast',
};

/** The raw `@objectstack/client` error: the whole body lands on `details`. */
const clientError = (body: Record<string, unknown>) =>
  Object.assign(new Error(String(body.error)), { code: body.code, httpStatus: 400, details: body });

const none = () => false;

describe('unmarkedRefusalLines', () => {
  it('says each rule on its own line when no input carries any of them', () => {
    expect(unmarkedRefusalLines(clientError(twoRules), none)).toEqual([
      'Best case must be at least the amount.',
      'Amount must be positive.',
    ]);
  });

  it('leaves out the entry an input already carries', () => {
    expect(unmarkedRefusalLines(clientError(twoRules), (f) => f === 'best')).toEqual([
      'Amount must be positive.',
    ]);
  });

  it('answers an empty list when every entry is carried inline', () => {
    expect(unmarkedRefusalLines(clientError(twoRules), () => true)).toEqual([]);
  });

  it('says two record-level rules as two lines, never the joined summary', () => {
    const body = {
      ...twoRules,
      error: 'Amount must be positive.; Name is required for a forecast.',
      fields: [
        { field: '_record', code: 'rule_violation', message: 'Amount must be positive.' },
        { field: '_record', code: 'rule_violation', message: 'Name is required for a forecast.' },
      ],
    };
    expect(unmarkedRefusalLines(clientError(body), none)).toEqual([
      'Amount must be positive.',
      'Name is required for a forecast.',
    ]);
  });

  it('reads the adapter ValidationError and a hand-rolled error alike', () => {
    const adapter = Object.assign(new Error(twoRules.error), {
      validationErrors: twoRules.fields.map(({ field, message }) => ({ field, message })),
    });
    const handRolled = { message: twoRules.error, fields: twoRules.fields };
    expect(unmarkedRefusalLines(adapter, none)).toEqual(unmarkedRefusalLines(clientError(twoRules), none));
    expect(unmarkedRefusalLines(handRolled, none)).toEqual(unmarkedRefusalLines(clientError(twoRules), none));
  });

  it('says an entry that names no field, since no input can carry it', () => {
    const body = { ...twoRules, fields: [{ code: 'rule_violation', message: 'Amount must be positive.' }] };
    expect(unmarkedRefusalLines(clientError(body), () => true)).toEqual(['Amount must be positive.']);
  });

  it('answers null when an entry it would say has no readable message', () => {
    // The server builds the top-level text for such an entry; an enum on a
    // line of its own reads as a bug, so the caller keeps the envelope's text.
    const body = {
      ...twoRules,
      fields: [twoRules.fields[1], { field: '_record', code: 'rule_violation' }],
    };
    expect(unmarkedRefusalLines(clientError(body), none)).toBeNull();
  });

  it('answers null when the refusal carries no entry list', () => {
    expect(unmarkedRefusalLines(new Error('insufficient privileges'), none)).toBeNull();
    expect(unmarkedRefusalLines(clientError({ error: 'gone', code: 'UNIQUE_VIOLATION', field: 'sku' }), none)).toBeNull();
    expect(unmarkedRefusalLines(null, none)).toBeNull();
    expect(unmarkedRefusalLines('Validation failed', none)).toBeNull();
  });
});
