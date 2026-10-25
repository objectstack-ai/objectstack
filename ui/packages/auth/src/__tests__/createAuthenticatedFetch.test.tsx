/**
 * Tests for createAuthenticatedFetch — header injection (auth, tenant, locale).
 *
 * Lives as a `.test.tsx` so it runs under happy-dom (the repo routes `.test.ts`
 * to the node environment), giving us a real `document` for the
 * `Accept-Language` ← `<html lang>` behaviour added for issue #1319.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthenticatedFetch, ActiveOrganizationStorage } from '../createAuthenticatedFetch';
import { TokenStorage } from '../createAuthClient';

const API_URL = 'http://localhost/api/v1/meta/object/account';

/** Stub the global fetch and capture the Headers it was called with. */
function stubFetch() {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

describe('createAuthenticatedFetch', () => {
  beforeEach(() => {
    ActiveOrganizationStorage.clear();
    vi.spyOn(TokenStorage, 'get').mockReturnValue(null);
    document.documentElement.removeAttribute('lang');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('injects the Bearer token on API calls', async () => {
    vi.spyOn(TokenStorage, 'get').mockReturnValue('tok123');
    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL);
    expect(calls[0].headers.get('Authorization')).toBe('Bearer tok123');
  });

  it('does not inject the token on non-API URLs', async () => {
    vi.spyOn(TokenStorage, 'get').mockReturnValue('tok123');
    const calls = stubFetch();
    await createAuthenticatedFetch()('http://localhost/static/logo.png');
    expect(calls[0].headers.get('Authorization')).toBeNull();
  });

  it('injects the tenant header when an active organization is set', async () => {
    ActiveOrganizationStorage.set('org-42');
    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL);
    expect(calls[0].headers.get('X-Tenant-ID')).toBe('org-42');
  });

  it('folds the active <html lang> into Accept-Language on API calls (#1319)', async () => {
    document.documentElement.lang = 'zh-CN';
    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL);
    expect(calls[0].headers.get('Accept-Language')).toBe('zh-CN');
  });

  it('does not set Accept-Language when <html lang> is empty', async () => {
    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL);
    expect(calls[0].headers.get('Accept-Language')).toBeNull();
  });

  it('does not set Accept-Language on non-API URLs', async () => {
    document.documentElement.lang = 'zh-CN';
    const calls = stubFetch();
    await createAuthenticatedFetch()('http://localhost/static/logo.png');
    expect(calls[0].headers.get('Accept-Language')).toBeNull();
  });

  it('never clobbers an Accept-Language the caller set explicitly', async () => {
    document.documentElement.lang = 'zh-CN';
    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL, { headers: { 'Accept-Language': 'ja' } });
    expect(calls[0].headers.get('Accept-Language')).toBe('ja');
  });

  // ── sameOriginOnly (#2725) — fetches must not leak the bearer token to
  //    third-party hosts a metadata URL (an action's target) may name ──

  it('sameOriginOnly: still injects the token on same-origin API calls', async () => {
    vi.spyOn(TokenStorage, 'get').mockReturnValue('tok123');
    const calls = stubFetch();
    await createAuthenticatedFetch({ sameOriginOnly: true })('/api/gantt/tree');
    expect(calls[0].headers.get('Authorization')).toBe('Bearer tok123');
  });

  it('sameOriginOnly: passes cross-origin URLs through with no auth/tenant headers', async () => {
    vi.spyOn(TokenStorage, 'get').mockReturnValue('tok123');
    ActiveOrganizationStorage.set('org-42');
    document.documentElement.lang = 'zh-CN';
    const calls = stubFetch();
    await createAuthenticatedFetch({ sameOriginOnly: true })('https://third-party.example.com/api/x');
    expect(calls[0].headers.get('Authorization')).toBeNull();
    expect(calls[0].headers.get('X-Tenant-ID')).toBeNull();
    expect(calls[0].headers.get('Accept-Language')).toBeNull();
  });

  it('without sameOriginOnly, cross-origin /api/ URLs keep the legacy attach behaviour', async () => {
    vi.spyOn(TokenStorage, 'get').mockReturnValue('tok123');
    const calls = stubFetch();
    await createAuthenticatedFetch()('https://third-party.example.com/api/x');
    expect(calls[0].headers.get('Authorization')).toBe('Bearer tok123');
  });

  // ── X-Tenant-ID: the edge contract, pinned (#5279) ────────────────────
  //
  // The header IS consumed — by the cloud edge, in a repository this one
  // cannot see. These cases pin the three statements the README's "The
  // `X-Tenant-ID` edge contract" section makes about what leaves the browser,
  // so the prose cannot drift away from the wire without a red test.

  it('sends NO tenant header at all when no organization is active (the unstamped-first-request gap)', async () => {
    // The gap itself, on the wire. `AuthProvider` fills
    // `ActiveOrganizationStorage` only after its async organization chain
    // resolves, so every request before that looks like this one. The
    // distinction a cloud-side resolver depends on is ABSENT vs
    // present-and-empty: an empty-string header would make the resolver see a
    // tenant id of "" instead of falling through to its next identification
    // source.
    expect(ActiveOrganizationStorage.get()).toBeNull();
    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL);
    expect(calls[0].headers.get('X-Tenant-ID')).toBeNull();
    expect(calls[0].headers.has('X-Tenant-ID')).toBe(false);
  });

  it('stamps the tenant header on non-API URLs too — recorded, not endorsed (#5279)', async () => {
    // Unlike `Authorization` and `Accept-Language`, the tenant stamp is not
    // gated on `isApiCall`. This case exists so that asymmetry is VISIBLE:
    // it records what ships today, it does not bless it, and the question of
    // whether the stamp should be gated is reported on #5279 for triage. If
    // that is answered by gating the stamp, this expectation changes with the
    // fix — deliberately, rather than silently.
    ActiveOrganizationStorage.set('org-42');
    const calls = stubFetch();
    await createAuthenticatedFetch()('http://localhost/static/logo.png');
    expect(calls[0].headers.get('X-Tenant-ID')).toBe('org-42');
    // The contrast that makes the asymmetry the point of this case:
    expect(calls[0].headers.get('Authorization')).toBeNull();
  });

  it('the active organization wins over an X-Tenant-ID the caller supplied', async () => {
    // `headers.set` overwrites. Stated in the README as the header's
    // precedence rule, because a caller reading its own value back off the
    // request would otherwise be surprised.
    ActiveOrganizationStorage.set('org-42');
    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL, { headers: { 'X-Tenant-ID': 'org-caller' } });
    expect(calls[0].headers.get('X-Tenant-ID')).toBe('org-42');
  });
});
