import { describe, it, expect } from 'vitest';
import { preferLocal } from '../preferLocal';

/**
 * ADR-0048 Phase 2 — prefer-local (container-scoped) resolution.
 */
describe('preferLocal', () => {
  const crmHome = { name: 'home', _packageId: 'com.acme.crm', title: 'CRM Home' };
  const hrHome = { name: 'home', _packageId: 'com.acme.hr', title: 'HR Home' };
  const list = [crmHome, hrHome];

  it('prefers the item owned by the current package', () => {
    expect(preferLocal(list, 'home', 'com.acme.crm')).toBe(crmHome);
    expect(preferLocal(list, 'home', 'com.acme.hr')).toBe(hrHome);
  });

  it('falls back to first match when the package owns no such item', () => {
    expect(preferLocal(list, 'home', 'com.acme.unknown')).toBe(crmHome);
  });

  it('falls back to first match when no owner package is given (legacy behaviour)', () => {
    expect(preferLocal(list, 'home')).toBe(crmHome);
    expect(preferLocal(list, 'home', undefined)).toBe(crmHome);
  });

  it('returns undefined for missing name or list', () => {
    expect(preferLocal(list, undefined, 'com.acme.crm')).toBeUndefined();
    expect(preferLocal(undefined, 'home', 'com.acme.crm')).toBeUndefined();
    expect(preferLocal(null, 'home')).toBeUndefined();
  });

  it('returns undefined when nothing matches the name', () => {
    expect(preferLocal(list, 'dashboard', 'com.acme.crm')).toBeUndefined();
  });

  it('resolves a single unambiguous item regardless of owner', () => {
    expect(preferLocal([crmHome], 'home', 'com.acme.hr')).toBe(crmHome);
  });
});
