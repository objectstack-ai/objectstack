// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { resolveHomeUrl, resolveRootUrl, resolveConsoleUrl } from '../resolveHomeUrl';

describe('resolveHomeUrl', () => {
  it('builds an absolute /_console/home URL when base href points at the console mount', () => {
    expect(resolveHomeUrl('https://cloud.objectos.app/_console/')).toBe(
      'https://cloud.objectos.app/_console/home',
    );
  });

  it('builds /home when the host mounts the console at the document root', () => {
    expect(resolveHomeUrl('https://host.example/')).toBe('https://host.example/home');
  });

  it('resolves against the current document URL when no <base> is set', () => {
    expect(resolveHomeUrl('https://host.example/_console/organizations')).toBe(
      'https://host.example/_console/home',
    );
  });

  it('does NOT regress to the trailing-dot host bug from the old `${origin}${BASE_URL}home` form', () => {
    // The old implementation, when BASE_URL was Vite's portable `./`, produced
    // `https://host./home` — a 404 with a trailing-dot FQDN. The new
    // implementation must never produce a host with a trailing dot.
    const url = new URL(resolveHomeUrl('https://cloud.objectos.app/_console/'));
    expect(url.hostname.endsWith('.')).toBe(false);
    expect(url.pathname.startsWith('/_console/')).toBe(true);
  });
});

describe('resolveRootUrl', () => {
  it('returns the console MOUNT root (not /home) so RootLandingRedirect runs', () => {
    expect(resolveRootUrl('https://cloud.objectos.app/_console/')).toBe(
      'https://cloud.objectos.app/_console/',
    );
  });

  it('returns the document root when the console mounts at /', () => {
    expect(resolveRootUrl('https://host.example/')).toBe('https://host.example/');
  });

  it('resolves to the mount dir from a deeper route (drops the route segment)', () => {
    expect(resolveRootUrl('https://host.example/_console/organizations')).toBe(
      'https://host.example/_console/',
    );
  });
});

describe('resolveConsoleUrl', () => {
  it('keeps the /_console mount prefix for a raw route path (the 404 this fixes)', () => {
    // `window.open('/apps/my_app')` resolves against the document origin and
    // drops the `/_console/` mount, 404ing on hosts that serve the console
    // under a sub-path (studio-design's "Open app" button — objectui#404).
    expect(resolveConsoleUrl('apps/my_app', 'https://host.example/_console/')).toBe(
      'https://host.example/_console/apps/my_app',
    );
  });

  it('accepts a leading slash on the path without dropping the mount', () => {
    expect(resolveConsoleUrl('/apps/my_app', 'https://host.example/_console/')).toBe(
      'https://host.example/_console/apps/my_app',
    );
  });

  it('resolves against the document root when the console mounts at /', () => {
    expect(resolveConsoleUrl('apps/my_app', 'https://host.example/')).toBe(
      'https://host.example/apps/my_app',
    );
  });
});
