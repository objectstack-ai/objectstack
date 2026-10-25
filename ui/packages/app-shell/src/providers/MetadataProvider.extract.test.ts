// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { extractItems } from './MetadataProvider';

/**
 * The provider consumes TWO metadata sources with different envelope shapes:
 * the adapter SDK resolves `{ items: [...] }`, while MetadataClient.list()
 * (the `?preview=draft` path, ADR-0037) unwraps internally and resolves a
 * BARE ARRAY. Both must normalize identically — the missing array branch
 * silently emptied every preview-mode list read, so a draft-built app
 * rendered "No Apps Configured" in the Live Canvas.
 */
describe('extractItems', () => {
  const apps = [{ name: 'procurement_system' }, { name: 'crm' }];

  it('unwraps the adapter SDK `{items}` envelope', () => {
    expect(extractItems({ items: apps })).toEqual(apps);
  });

  it('passes through a bare array (MetadataClient.list / preview-draft path)', () => {
    expect(extractItems(apps)).toEqual(apps);
  });

  it('returns [] for malformed responses', () => {
    expect(extractItems(null)).toEqual([]);
    expect(extractItems({ data: apps })).toEqual([]);
    expect(extractItems('nope')).toEqual([]);
  });
});
