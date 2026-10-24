// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { formatSurfaceParam, parseSurfaceParam } from './nav-selection';

describe('surface deep-link param', () => {
  it('round-trips a surface identity', () => {
    const surface = { type: 'page', name: 'crm_workbench' };
    expect(parseSurfaceParam(formatSurfaceParam(surface))).toEqual(surface);
  });

  it('formats as <type>:<name>', () => {
    expect(formatSurfaceParam({ type: 'view', name: 'urgent_tasks' })).toBe('view:urgent_tasks');
  });

  it('splits only on the first colon (names may contain colons)', () => {
    expect(parseSurfaceParam('page:a:b')).toEqual({ type: 'page', name: 'a:b' });
  });

  it('rejects blank, colon-less, or half-empty values', () => {
    expect(parseSurfaceParam(null)).toBeNull();
    expect(parseSurfaceParam('')).toBeNull();
    expect(parseSurfaceParam('page')).toBeNull();
    expect(parseSurfaceParam(':crm_workbench')).toBeNull();
    expect(parseSurfaceParam('page:')).toBeNull();
  });
});
