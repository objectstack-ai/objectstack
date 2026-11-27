// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { takesSignedExpiry } from './signed-expiry-scope.js';

/**
 * [ADR-0154 D8] Signed expiry covers objects whose lifecycle is declared in
 * packaged metadata, and only on the registry's positive answer: a registry
 * that cannot place an object answers no.
 */
describe('takesSignedExpiry — only a positive answer from the registry', () => {
  const object = { name: 'app_ledger' };

  it('no for a registry that cannot be asked, or no registry at all', () => {
    expect(takesSignedExpiry({}, object)).toBe(false);
    expect(takesSignedExpiry(undefined, object)).toBe(false);
    expect(takesSignedExpiry({ getPackagedObjectOwner: () => ({ packageId: 'app.ledger' }) }, object)).toBe(false);
  });

  it('yes for an owner of an installed code or marketplace package, no for an authored or unknown one', () => {
    const over = (source: string | undefined) => ({
      getPackagedObjectOwner: () => ({ packageId: 'app.ledger' }),
      getPackage: () => (source ? { source } : undefined),
    });
    expect(takesSignedExpiry(over('code'), object)).toBe(true);
    expect(takesSignedExpiry(over('marketplace'), object)).toBe(true);
    expect(takesSignedExpiry(over('authored'), object)).toBe(false);
    expect(takesSignedExpiry(over(undefined), object)).toBe(false);
  });

  it('yes for a plain registration from code; no for a tenant-authored definition or owner', () => {
    expect(takesSignedExpiry({ getObjectOwner: () => ({}) }, object)).toBe(true);
    expect(takesSignedExpiry({ getObjectOwner: () => ({ packageId: 'metadata-service' }) }, object)).toBe(false);
    expect(takesSignedExpiry({ getObjectOwner: () => ({ definition: { _provenance: 'org' } }) }, object)).toBe(false);
    expect(takesSignedExpiry({ getObjectOwner: () => ({}) }, { ...object, _provenance: 'org' } as never)).toBe(false);
  });
});
