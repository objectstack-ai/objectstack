// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os serve`'s auth base-URL resolution, and the diagnostic for an unusable one
 * (#10202).
 *
 * ## The defect, MEASURED before it was fixed
 *
 * Three language semantics compose into a silent failure:
 *
 *   1. `readEnvWithDeprecation` returns the preferred variable whenever it is
 *      `!== undefined` — a present-but-empty variable resolves to `''`.
 *   2. serve's fallback chain coalesces with `??`, which falls through only on
 *      `null`/`undefined`. `'' ?? x` is `''`, so neither `OS_BASE_URL` nor the
 *      `http://localhost:<port>` default is consulted.
 *   3. `new URL('')` throws — and the throw landed in
 *      `catch { /* ignore malformed baseUrl *\/ }`, the ONLY witness that the
 *      configured base URL was unusable.
 *
 * Measured on a real `os serve` boot of `examples/app-todo`, `NODE_ENV=production`,
 * `OS_TRUSTED_ORIGINS` / `OS_ROOT_DOMAIN` / preview mode all unset, probing
 * `POST /api/v1/auth/sign-in/email` with bogus credentials so a TRUSTED origin
 * answers `401 INVALID_EMAIL_OR_PASSWORD` and an UNTRUSTED one `403 INVALID_ORIGIN`:
 *
 *   origin                        OS_AUTH_URL=   OS_AUTH_URL=https://app.example.com   unset
 *   https://app.example.com       403            401                                   403
 *   http://localhost:<port>       401            403                                   401
 *   http://tenant.localhost:<port>401            403                                   403
 *   /api/v1/health, /api/v1/ready 200            200                                   200
 *
 * Two things that table settles, and one it corrects:
 *
 *   • CONFIRMED — with a set-but-empty `OS_AUTH_URL` the deployment's OWN origin
 *     is refused while health and ready keep answering `200`. Authentication is
 *     dead and nothing says so.
 *   • CORRECTED — the filing predicted `trustedOrigins` would be `[]` and that
 *     "every origin is refused". It is not. serve's local array is empty, but
 *     serve passes `trustedOrigins.length ? trustedOrigins : undefined`, and
 *     `AuthManager` substitutes a localhost wildcard trio for an absent list.
 *     So better-auth receives a NON-empty allow-list — the masking layer the
 *     filing suspected is real, and it is ObjectStack's own AuthManager rather
 *     than better-auth.
 *   • WORSE THAN CLAIMED — empty is therefore strictly MORE permissive than
 *     unset: `http://tenant.localhost:<port>` is trusted in the empty case and
 *     refused in the unset case. An env template that renders an absent key to
 *     the empty string silently widens a production CSRF allow-list.
 *
 * ## What these tests pin, and what they deliberately do not
 *
 * They pin the SEAM: what the chain resolves to, which variable supplied it,
 * whether it parses, and the sentence produced when it does not. The resolution
 * itself is unchanged by #10202 — the precedence assertions below describe
 * behaviour that predates the fix and must keep holding, including the one that
 * looks like the bug (an empty `OS_AUTH_URL` does NOT fall through). Making
 * empty behave as unset would change every `readEnvWithDeprecation` caller and
 * is a separate, deliberate decision; nothing here presumes it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  resolveAuthBaseUrl,
  formatUnusableAuthBaseUrlDiagnostic,
  AUTH_BASE_URL_ENV_NAMES,
} from './serve.js';

const TOUCHED = ['OS_AUTH_URL', 'BETTER_AUTH_URL', 'OS_BASE_URL'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveAuthBaseUrl — precedence (pre-existing behaviour, unchanged)', () => {
  it('falls back to http://localhost:<port> when no variable is set', () => {
    expect(resolveAuthBaseUrl(3000)).toEqual({
      value: 'http://localhost:3000',
      source: null,
      baseOrigin: 'http://localhost:3000',
    });
  });

  it('prefers OS_AUTH_URL over the legacy BETTER_AUTH_URL and over OS_BASE_URL', () => {
    process.env.OS_AUTH_URL = 'https://auth.example.com';
    process.env.BETTER_AUTH_URL = 'https://legacy.example.com';
    process.env.OS_BASE_URL = 'https://base.example.com';

    const r = resolveAuthBaseUrl(3000);
    expect(r.value).toBe('https://auth.example.com');
    expect(r.source).toBe('OS_AUTH_URL');
  });

  it('honours the legacy BETTER_AUTH_URL when OS_AUTH_URL is unset', () => {
    process.env.BETTER_AUTH_URL = 'https://legacy.example.com';
    process.env.OS_BASE_URL = 'https://base.example.com';

    const r = resolveAuthBaseUrl(3000);
    expect(r.value).toBe('https://legacy.example.com');
    expect(r.source).toBe('BETTER_AUTH_URL');
  });

  it('falls through to OS_BASE_URL when neither auth-url name is set', () => {
    process.env.OS_BASE_URL = 'https://base.example.com';

    const r = resolveAuthBaseUrl(3000);
    expect(r.value).toBe('https://base.example.com');
    expect(r.source).toBe('OS_BASE_URL');
  });

  it('does NOT treat a set-but-empty OS_AUTH_URL as unset — the chain still stops there', () => {
    // This is the shape the defect is made of, pinned as-is. `??` skips only
    // unset values, so OS_BASE_URL and the localhost default stay unconsulted.
    process.env.OS_AUTH_URL = '';
    process.env.OS_BASE_URL = 'https://base.example.com';

    const r = resolveAuthBaseUrl(3000);
    expect(r.value).toBe('');
    expect(r.source).toBe('OS_AUTH_URL');
    expect(r.value).not.toBe('https://base.example.com');
  });

  it('names the origin as protocol//host, keeping port and dropping path', () => {
    // Pinned against `URL.origin`, which the inline code never used and which
    // answers the string "null" for a non-special scheme.
    process.env.OS_AUTH_URL = 'https://app.example.com:8443/mounted/here?q=1';
    expect(resolveAuthBaseUrl(3000).baseOrigin).toBe('https://app.example.com:8443');
  });
});

describe('resolveAuthBaseUrl — a usable base URL stays silent', () => {
  it.each([
    ['OS_AUTH_URL', 'https://app.example.com'],
    ['BETTER_AUTH_URL', 'https://legacy.example.com'],
    ['OS_BASE_URL', 'https://base.example.com'],
  ])('%s=%s parses, yields its own origin, and produces no diagnostic', (name, url) => {
    process.env[name] = url;

    const r = resolveAuthBaseUrl(3000);
    expect(r.baseOrigin).toBe(url);
    expect(formatUnusableAuthBaseUrlDiagnostic(r)).toBeNull();
  });

  it('produces no diagnostic for the built-in default either', () => {
    expect(formatUnusableAuthBaseUrlDiagnostic(resolveAuthBaseUrl(3000))).toBeNull();
  });
});

describe('formatUnusableAuthBaseUrlDiagnostic — the failure is loud', () => {
  it('reports a set-but-empty OS_AUTH_URL, naming the variable and the value', () => {
    process.env.OS_AUTH_URL = '';

    const r = resolveAuthBaseUrl(3000);
    expect(r.baseOrigin).toBeNull();

    const text = formatUnusableAuthBaseUrlDiagnostic(r);
    expect(text).not.toBeNull();
    expect(text).toContain('OS_AUTH_URL');
    // The value it resolved to, quoted, so an empty string is visible at all.
    expect(text).toContain('""');
    expect(text).toContain('EMPTY');
    // The trap itself: the operator believes they left it unset.
    expect(text).toContain('NOT the same as an unset one');
    // The symptom, so the sentence is findable from what the operator sees.
    expect(text).toContain('403 INVALID_ORIGIN');
  });

  it('reports a set-but-empty legacy BETTER_AUTH_URL under its own name', () => {
    process.env.BETTER_AUTH_URL = '';

    const text = formatUnusableAuthBaseUrlDiagnostic(resolveAuthBaseUrl(3000));
    expect(text).toContain('BETTER_AUTH_URL');
    expect(text).not.toContain('OS_AUTH_URL is set');
  });

  it('reports a set-but-empty OS_BASE_URL under its own name', () => {
    process.env.OS_BASE_URL = '';

    const text = formatUnusableAuthBaseUrlDiagnostic(resolveAuthBaseUrl(3000));
    expect(text).toContain('OS_BASE_URL');
    expect(text).toContain('""');
  });

  it('reports a NON-empty but unparseable value, quoting what it resolved to', () => {
    // The other half of "unusable": a bare host has no scheme and throws too.
    process.env.OS_AUTH_URL = 'app.example.com';

    const r = resolveAuthBaseUrl(3000);
    expect(r.baseOrigin).toBeNull();

    const text = formatUnusableAuthBaseUrlDiagnostic(r);
    expect(text).toContain('OS_AUTH_URL');
    expect(text).toContain('"app.example.com"');
    expect(text).toContain('not a usable URL');
    // Not the empty-vs-unset lecture — that would be wrong for this case.
    expect(text).not.toContain('NOT the same as an unset one');
  });

  it('prescribes the two ways out: set a real origin, or remove the variable', () => {
    process.env.OS_AUTH_URL = '';

    const text = formatUnusableAuthBaseUrlDiagnostic(resolveAuthBaseUrl(3000)) ?? '';
    expect(text).toContain('https://app.example.com');
    expect(text).toContain('remove the variable');
  });

  it('carries no raw control bytes — chalk colouring happens at the call site', () => {
    process.env.OS_AUTH_URL = '';

    const text = formatUnusableAuthBaseUrlDiagnostic(resolveAuthBaseUrl(3000)) ?? '';
    // Written as an escape, never as the byte itself: one raw control character
    // makes grep treat the whole file as binary.
    expect(text).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
  });
});

describe('the allow-list is never silently short of the base origin', () => {
  /**
   * The invariant the fix exists for, stated as the call site consumes it:
   * EXACTLY ONE of the two outcomes happens for any resolved value — either an
   * origin is available to push, or a diagnostic is produced. The old `catch`
   * allowed a third: neither.
   */
  it.each([
    ['unset (built-in default)', undefined],
    ['a normal https origin', 'https://app.example.com'],
    ['a normal http origin with a port', 'http://10.0.0.5:8080'],
    ['set-but-empty', ''],
    ['whitespace only', '   '],
    ['a bare host, no scheme', 'app.example.com'],
    ['a value that is not a URL at all', 'not a url'],
  ])('%s: an origin to trust, or a complaint — never neither', (_label, value) => {
    if (value !== undefined) process.env.OS_AUTH_URL = value;

    const r = resolveAuthBaseUrl(3000);
    const text = formatUnusableAuthBaseUrlDiagnostic(r);

    const gotOrigin = r.baseOrigin !== null;
    const gotDiagnostic = text !== null;
    expect(gotOrigin || gotDiagnostic).toBe(true);
    expect(gotOrigin && gotDiagnostic).toBe(false);
  });
});

describe('AUTH_BASE_URL_ENV_NAMES', () => {
  it('lists the variables the chain reads, in precedence order', () => {
    expect(AUTH_BASE_URL_ENV_NAMES).toEqual(['OS_AUTH_URL', 'BETTER_AUTH_URL', 'OS_BASE_URL']);
  });

  it('every name it lists can actually supply the base URL', () => {
    for (const name of AUTH_BASE_URL_ENV_NAMES) {
      for (const k of TOUCHED) delete process.env[k];
      process.env[name] = `https://${name.toLowerCase()}.example.com`;
      expect(resolveAuthBaseUrl(3000).source).toBe(name);
    }
  });
});
