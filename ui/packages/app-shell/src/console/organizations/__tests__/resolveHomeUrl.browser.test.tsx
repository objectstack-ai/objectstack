// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
// @vitest-environment happy-dom

/**
 * Browser-environment integration test for resolveHomeUrl().
 *
 * The plain logic test (`resolveHomeUrl.test.ts`) takes baseURI as an
 * argument. This test exercises the real `document.baseURI` path the
 * production code uses, mutating an injected `<base href>` to simulate
 * each deployment shape (tenant `/_console/`, root `/`, no <base>).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { resolveHomeUrl } from '../resolveHomeUrl';

function setBaseHref(href: string | null): void {
  document.head.querySelectorAll('base').forEach((el) => el.remove());
  if (href != null) {
    const base = document.createElement('base');
    base.setAttribute('href', href);
    document.head.appendChild(base);
  }
}

describe('resolveHomeUrl (browser)', () => {
  afterEach(() => {
    setBaseHref(null);
  });

  it('resolves against <base href="/_console/"> (cloud tenant deployment shape)', () => {
    setBaseHref('/_console/');
    const url = new URL(resolveHomeUrl());
    expect(url.pathname).toBe('/_console/home');
    // Regression: trailing-dot host is what broke prod.
    expect(url.hostname.endsWith('.')).toBe(false);
  });

  it('resolves against <base href="/"> (root-mount deployment shape)', () => {
    setBaseHref('/');
    const url = new URL(resolveHomeUrl());
    expect(url.pathname).toBe('/home');
    expect(url.hostname.endsWith('.')).toBe(false);
  });

  it('falls back to current document URL when no <base> tag exists', () => {
    setBaseHref(null);
    // happy-dom's default location is http://localhost:3000/ — that's
    // enough to assert the URL is well-formed (no trailing-dot host).
    const url = new URL(resolveHomeUrl());
    expect(url.protocol).toMatch(/^https?:$/);
    expect(url.hostname.endsWith('.')).toBe(false);
    expect(url.pathname.endsWith('/home')).toBe(true);
  });

  it('does NOT append /home recursively when invoked from a /home* route', () => {
    // Regression: when no <base> is present, document.baseURI inherits the
    // current page URL. From /home/home/, new URL('home', baseURI) was
    // resolving to /home/home/home, and each subsequent click added another
    // segment. The resolver must ignore the current SPA route.
    setBaseHref(null);
    history.pushState({}, '', '/home/home/');
    const url = new URL(resolveHomeUrl());
    expect(url.pathname).toBe('/home');
    history.pushState({}, '', '/');
  });
});
