// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36167] The scorer judges a card's record expression as the build's pass
 * does: it hands the shared validator the object's list-valued fields
 * (`multiValueFields`, read through `isMultiValueField`), so a formula or a
 * validation rule comparing a `multiple: true` field with a scalar — which
 * answers one constant on every row — does not compile here either.
 */

import { describe, it, expect } from 'vitest';

import { recordExpressionRefusal } from '../src/score/scenario-expressions.js';

const TICKET = {
  fields: {
    owners: { type: 'user', multiple: true },
    owner: { type: 'user' },
  },
};

describe('recordExpressionRefusal — list-equality', () => {
  it('refuses a multiple: true field compared with a scalar', () => {
    expect(recordExpressionRefusal('predicate', "record.owners == 'u1'", 'ticket', TICKET)).toContain(
      '`record.owners` holds a list',
    );
  });

  it.each(["record.owner == 'u1'", "'u1' in record.owners", 'record.owners != null'])('CONTROL — accepts %s', (source) => {
    expect(recordExpressionRefusal('predicate', source, 'ticket', TICKET)).toBeUndefined();
  });
});
