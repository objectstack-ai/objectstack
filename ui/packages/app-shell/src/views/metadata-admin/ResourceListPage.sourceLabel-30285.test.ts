// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30285 — the item list's source label. A translation written into
 * a code package's `.custom` pair (ADR-0146 D2) is what a customer wrote, not
 * what the code package shipped.
 */

import { describe, expect, it } from 'vitest';
import { classifyProvenance } from './ResourceListPage';

describe('classifyProvenance', () => {
  it("labels an item in a code package's .custom pair customer-written", () => {
    expect(classifyProvenance({ _packageId: 'com.example.crm.custom' })).toBe('runtime');
  });

  it('keeps an item of the code package itself labelled as shipped in code', () => {
    expect(classifyProvenance({ _packageId: 'com.example.crm', _provenance: 'package' })).toBe('artifact');
  });

  it('reads only a real pair id as a pair: a doubled or bare suffix is not one', () => {
    expect(classifyProvenance({ _packageId: 'com.example.crm.custom.custom' })).toBe('artifact');
    expect(classifyProvenance({ _packageId: '.custom' })).toBe('artifact');
  });

  it("keeps the server's own classification first", () => {
    expect(classifyProvenance({ _packageId: 'com.example.crm.custom' }, 'code')).toBe('artifact');
    expect(classifyProvenance({ _packageId: 'com.example.crm' }, 'overlay')).toBe('runtime');
  });
});
