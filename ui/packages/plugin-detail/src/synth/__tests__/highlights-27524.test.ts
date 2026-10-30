/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524, Target 12 — the record header's highlights are the
 * object's declared `highlightFields` minus the name field (the title), at
 * most six. Nothing is invented: an object with no status field shows none.
 * The declared sets are HotCRM's, as the v4 boards were audited against them.
 */

import { describe, expect, it } from 'vitest';
import { RECORD_HIGHLIGHTS_MAX, deriveHighlightFields } from '../buildDefaultPageSchema';

const text = { type: 'text' };

describe('highlights = the declared highlightFields minus the name field, max 6 (objectstack#27524, Target 12)', () => {
  it('a lead: the full name is the title, the rest are its highlights in the declared order', () => {
    const lead = {
      name: 'crm_lead',
      nameField: 'full_name',
      highlightFields: ['full_name', 'company', 'email', 'status', 'owner_id'],
      fields: { full_name: text, company: text, email: { type: 'email' }, status: { type: 'select' }, owner_id: { type: 'user' } },
    };
    expect(deriveHighlightFields(lead as never, 'status')).toEqual(['company', 'email', 'status', 'owner_id']);
  });

  it('a contact declares no status field, and none is invented', () => {
    const contact = {
      name: 'crm_contact',
      nameField: 'full_name',
      highlightFields: ['full_name', 'email', 'crm_account', 'phone'],
      fields: { full_name: text, email: { type: 'email' }, crm_account: { type: 'lookup' }, phone: { type: 'phone' } },
    };
    expect(deriveHighlightFields(contact as never, null)).toEqual(['email', 'crm_account', 'phone']);
  });

  it('a longer declared list is cut at six, after the title is taken out', () => {
    const names = ['name', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const wide = { name: 'x', nameField: 'name', highlightFields: names, fields: Object.fromEntries(names.map((n) => [n, text])) };
    expect(RECORD_HIGHLIGHTS_MAX).toBe(6);
    expect(deriveHighlightFields(wide as never, null)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
