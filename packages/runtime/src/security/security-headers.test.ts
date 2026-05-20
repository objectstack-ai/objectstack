// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { buildSecurityHeaders } from './security-headers.js';

describe('buildSecurityHeaders', () => {
  it('emits the conservative defaults when called with no args', () => {
    const h = buildSecurityHeaders();
    expect(h['Content-Security-Policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['Permissions-Policy']).toContain('geolocation=()');
    expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin');
    // HSTS off by default — caller must opt in once TLS is confirmed.
    expect(h['Strict-Transport-Security']).toBeUndefined();
  });

  it('emits HSTS with the default 180-day max-age when hsts:true', () => {
    const h = buildSecurityHeaders({ hsts: true });
    expect(h['Strict-Transport-Security']).toBe('max-age=15552000; includeSubDomains');
  });

  it('respects custom HSTS options', () => {
    const h = buildSecurityHeaders({
      hsts: { maxAge: 60, includeSubDomains: false, preload: true },
    });
    expect(h['Strict-Transport-Security']).toBe('max-age=60; preload');
  });

  it('omits headers when explicitly disabled with false', () => {
    const h = buildSecurityHeaders({
      contentSecurityPolicy: false,
      frameOptions: false,
      referrerPolicy: false,
      permissionsPolicy: false,
      corp: false,
    });
    expect(h['Content-Security-Policy']).toBeUndefined();
    expect(h['X-Frame-Options']).toBeUndefined();
    expect(h['Referrer-Policy']).toBeUndefined();
    expect(h['Permissions-Policy']).toBeUndefined();
    expect(h['Cross-Origin-Resource-Policy']).toBeUndefined();
    // XCTO is non-configurable — there is no business case for sniffing.
    expect(h['X-Content-Type-Options']).toBe('nosniff');
  });

  it('merges extra headers last (caller has the final say)', () => {
    const h = buildSecurityHeaders({
      extra: { 'X-Custom': 'one', 'X-Frame-Options': 'SAMEORIGIN' },
    });
    expect(h['X-Custom']).toBe('one');
    // Explicit extra wins over the default DENY.
    expect(h['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('allows custom CSP for HTML-serving routes', () => {
    const h = buildSecurityHeaders({
      contentSecurityPolicy: "default-src 'self'; img-src https:",
    });
    expect(h['Content-Security-Policy']).toBe("default-src 'self'; img-src https:");
  });
});
