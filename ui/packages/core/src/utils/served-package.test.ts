import { describe, it, expect } from 'vitest';
import { servedPackageId } from './served-package';

describe('servedPackageId (ADR-0150 D5, objectstack#32077)', () => {
  it('reads the served item\'s own `_packageId`', () => {
    expect(servedPackageId({ name: 'sales_overview', _packageId: 'com.acme.alpha' })).toBe('com.acme.alpha');
  });

  it.each([
    ['no item', undefined],
    ['no decoration', { name: 'x' }],
    ['an empty id', { _packageId: '' }],
    ['the package-less sentinel', { _packageId: 'sys_metadata' }],
    ['the runtime compatibility package', { _packageId: '__runtime__' }],
    ['a non-string', { _packageId: 7 }],
  ])('names no package for %s', (_label, item) => {
    expect(servedPackageId(item)).toBeUndefined();
  });
});
