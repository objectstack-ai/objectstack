// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { relationConditionSites } from './relation-condition-sites.js';

const FIELDS = {
  name: { type: 'text' },
  account: { type: 'lookup', reference: 'rcs_account' },
  owner: { type: 'user' },
  tags: { type: 'lookup', reference: 'rcs_tag', multiple: true },
};

describe('[#22777] relationConditionSites — the one walk both exposure-asking doors share', () => {
  it('finds a condition on a related object, at the top level and under every combinator, with its target', () => {
    const where = {
      account: { name: 'a' },
      $or: [{ owner: { email: 'e' } }, { $not: { tags: { label: 't' } } }],
      $and: [{ name: 'n' }],
    };
    const sites = relationConditionSites(FIELDS, where).map((s) => [s.field, s.target, s.condition]);
    expect(sites.sort()).toEqual([
      ['account', 'rcs_account', { name: 'a' }],
      ['owner', 'sys_user', { email: 'e' }],
      ['tags', 'rcs_tag', { label: 't' }],
    ]);
  });

  it('CONTROL finds no site in an id comparand, an operator bag, a non-reference field or without a field map', () => {
    expect(relationConditionSites(FIELDS, { account: 'a1', owner: { $in: ['u1'] }, name: { first: 'x' } })).toEqual([]);
    expect(relationConditionSites(undefined, { account: { name: 'a' } })).toEqual([]);
  });
});
