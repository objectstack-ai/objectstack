/**
 * The mobile sign-in hand-off as a sign-in redirect target (#29971): which
 * `?redirect=` values name the hand-off route, and which sessions it carries.
 * The sign-in pages' behaviour is pinned in `authExitBasename.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { AuthEndpointPaths } from '@objectstack/spec/api';
import {
  HANDOFF_REFUSED_AT_PARAM,
  HANDOFF_SESSION_MAX_AGE_MS,
  handoffMarkQuery,
  handoffNavigationTarget,
  handoffRefusedAt,
  isHandoffSessionFresh,
  sessionCreatedAtMs,
} from '../handoffRedirect';

const ORIGIN = 'https://os.example.com';
const AUTH_BASE = '/api/v1/auth';
const HANDOFF_PATH = '/api/v1/auth/one-time-token/handoff';
const QUERY =
  '?redirect_uri=ai.objectos.mobile%3A%2F%2Fauth%2Fcallback' +
  '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';

const target = (redirect: string | null, authBase = AUTH_BASE) =>
  handoffNavigationTarget(redirect, { origin: ORIGIN, authBase });

describe('handoffNavigationTarget — the hand-off route and nothing wider', () => {
  it('is the route the spec names under the auth base', () => {
    expect(`${AUTH_BASE}${AuthEndpointPaths.oneTimeTokenHandoff}`).toBe(HANDOFF_PATH);
  });

  it('answers the hand-off path with its query, unprefixed', () => {
    expect(target(`${HANDOFF_PATH}${QUERY}`)).toBe(`${HANDOFF_PATH}${QUERY}`);
    expect(target(HANDOFF_PATH)).toBe(HANDOFF_PATH);
  });

  it('CONTROL: an ordinary API path is not the hand-off (it stays a Console route)', () => {
    expect(target('/api/v1/data/x')).toBeNull();
    expect(target('/settings')).toBeNull();
    expect(target('/')).toBeNull();
  });

  it('refuses lookalike paths', () => {
    for (const lookalike of [
      '/api/v1/auth/one-time-token/handoffX',
      `/api/v1/auth/one-time-token/handoffX${QUERY}`,
      '/api/v1/auth/one-time-token/handoff/',
      '/api/v1/auth/one-time-token/handoff/x',
      '/api/v1/auth/one-time-token/verify',
      '/API/v1/auth/one-time-token/handoff',
      '/api/v1/auth/one-time-token%2Fhandoff',
      '/_console/api/v1/auth/one-time-token/handoff',
    ]) {
      expect(target(lookalike), lookalike).toBeNull();
    }
  });

  it('refuses the hand-off under a different base path', () => {
    // A Console whose auth base carries a prefix: only that prefix's hand-off.
    expect(target(`${HANDOFF_PATH}${QUERY}`, '/tenant-a/api/v1/auth')).toBeNull();
    expect(target(`/tenant-a${HANDOFF_PATH}${QUERY}`, '/tenant-a/api/v1/auth')).toBe(
      `/tenant-a${HANDOFF_PATH}${QUERY}`,
    );
    // And the other way round.
    expect(target(`/tenant-a${HANDOFF_PATH}`)).toBeNull();
  });

  it('refuses an absolute, protocol-relative or backslash-smuggled URL', () => {
    for (const offsite of [
      `https://evil.example${HANDOFF_PATH}${QUERY}`,
      `${ORIGIN}${HANDOFF_PATH}${QUERY}`,
      `//evil.example${HANDOFF_PATH}${QUERY}`,
      `/\\evil.example${HANDOFF_PATH}${QUERY}`,
      `/\t/evil.example${HANDOFF_PATH}`,
      `javascript:alert(1)//${HANDOFF_PATH}`,
    ]) {
      expect(target(offsite), offsite).toBeNull();
    }
  });

  it('refuses when the auth base is on another origin: that route is not reachable from this page', () => {
    expect(target(`${HANDOFF_PATH}${QUERY}`, 'https://api.example.com/api/v1/auth')).toBeNull();
  });

  it('answers null for no redirect or a relative one', () => {
    expect(target(null)).toBeNull();
    expect(target('')).toBeNull();
    expect(target('api/v1/auth/one-time-token/handoff')).toBeNull();
  });

  it('answers the parsed URL, so what is navigated to is what was checked', () => {
    expect(target(`/api/v1/data/../auth/one-time-token/handoff${QUERY}`)).toBe(
      `${HANDOFF_PATH}${QUERY}`,
    );
    expect(target(`${HANDOFF_PATH}${QUERY}#fragment`)).toBe(`${HANDOFF_PATH}${QUERY}`);
  });
});

describe('isHandoffSessionFresh — the five-minute window', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms);
  const arrival = { session: null };

  it('carries a session created within five minutes', () => {
    expect(isHandoffSessionFresh({ createdAt: ago(4 * 60_000) }, { arrival, now })).toBe(true);
    expect(isHandoffSessionFresh({ createdAt: ago(HANDOFF_SESSION_MAX_AGE_MS) }, { arrival, now })).toBe(true);
  });

  it('refuses a session created more than five minutes ago', () => {
    expect(isHandoffSessionFresh({ createdAt: ago(6 * 60_000) }, { arrival, now })).toBe(false);
    expect(isHandoffSessionFresh({ createdAt: ago(7 * 24 * 3_600_000) }, { arrival, now })).toBe(false);
  });

  it('reads createdAt as a Date or as the ISO string a raw fetch leaves', () => {
    const iso = ago(6 * 60_000).toISOString();
    expect(sessionCreatedAtMs({ createdAt: iso })).toBe(now - 6 * 60_000);
    expect(isHandoffSessionFresh({ createdAt: iso }, { arrival, now })).toBe(false);
  });

  it('a session without createdAt is fresh only when the page did not find it on arrival', () => {
    const found = { token: 't0' };
    // Found on arrival: treated as too old.
    expect(isHandoffSessionFresh(found, { arrival: { session: found }, now })).toBe(false);
    // Before the first session check answered: not judged fresh either.
    expect(isHandoffSessionFresh(found, { arrival: null, now })).toBe(false);
    // Made by a sign-in on the page (better-auth's sign-in answer has no
    // session record, so the provider holds `undefined` or `{ token }`).
    expect(isHandoffSessionFresh(undefined, { arrival: { session: null }, now })).toBe(true);
    expect(isHandoffSessionFresh({ token: 't1' }, { arrival: { session: found }, now })).toBe(true);
  });

  it('an unreadable createdAt counts as none', () => {
    expect(sessionCreatedAtMs({ createdAt: 'not a date' })).toBeNull();
    expect(sessionCreatedAtMs({ createdAt: new Date(Number.NaN) })).toBeNull();
    const found = { createdAt: 'not a date' };
    expect(isHandoffSessionFresh(found, { arrival: { session: found }, now })).toBe(false);
  });
});

describe('isHandoffSessionFresh — the route said when it refused', () => {
  const refusedAt = Date.parse('2026-11-03T12:00:00Z');
  const at = (offsetMs: number) => new Date(refusedAt + offsetMs);
  const arrival = { session: null };
  // Where the device's clock might read, against the server's.
  const deviceClocks = [
    ['agrees with the server', refusedAt],
    ['is an hour behind', refusedAt - 3_600_000],
    ['is an hour ahead', refusedAt + 3_600_000],
  ] as const;

  it.each(deviceClocks)('a session created after the refusal is fresh when the device clock %s', (_label, now) => {
    const session = { createdAt: at(1) };
    expect(isHandoffSessionFresh(session, { arrival: { session }, now, refusedAt })).toBe(true);
  });

  it.each(deviceClocks)('a session not created after it is held when the device clock %s', (_label, now) => {
    for (const session of [{ createdAt: at(0) }, { createdAt: at(-1) }, { createdAt: at(-7 * 24 * 3_600_000) }]) {
      expect(isHandoffSessionFresh(session, { arrival: { session }, now, refusedAt })).toBe(false);
    }
  });

  it('CONTROL: a device behind the server reads that same old session as young when the route said nothing', () => {
    const session = { createdAt: at(-6 * 60_000) };
    expect(isHandoffSessionFresh(session, { arrival, now: refusedAt - 3_600_000 })).toBe(true);
    expect(isHandoffSessionFresh(session, { arrival, now: refusedAt - 3_600_000, refusedAt })).toBe(false);
  });

  it('reads createdAt as an ISO string too', () => {
    const later = { createdAt: at(1).toISOString() };
    const earlier = { createdAt: at(-1).toISOString() };
    expect(isHandoffSessionFresh(later, { arrival, now: refusedAt, refusedAt })).toBe(true);
    expect(isHandoffSessionFresh(earlier, { arrival, now: refusedAt, refusedAt })).toBe(false);
  });

  it('a session with no createdAt keeps its own branch: found on arrival is held, made on this page is fresh', () => {
    const found = { token: 't0' };
    expect(isHandoffSessionFresh(found, { arrival: { session: found }, now: refusedAt, refusedAt })).toBe(false);
    expect(isHandoffSessionFresh(found, { arrival: null, now: refusedAt, refusedAt })).toBe(false);
    expect(isHandoffSessionFresh(undefined, { arrival: { session: null }, now: refusedAt, refusedAt })).toBe(true);
    expect(isHandoffSessionFresh({ token: 't1' }, { arrival: { session: found }, now: refusedAt, refusedAt })).toBe(true);
    const unreadable = { createdAt: 'not a date' };
    expect(isHandoffSessionFresh(unreadable, { arrival: { session: unreadable }, now: refusedAt, refusedAt })).toBe(false);
  });
});

describe('handoffMarkQuery — the mark on a link between the sign-in pages', () => {
  const marked = `?redirect=x&${HANDOFF_REFUSED_AT_PARAM}=1793620800000`;

  it('is the mark, beside a redirect naming the hand-off', () => {
    expect(handoffMarkQuery(`${HANDOFF_PATH}${QUERY}`, marked)).toBe(`&${HANDOFF_REFUSED_AT_PARAM}=1793620800000`);
  });

  it('is empty beside any other redirect, or none, so those links stay what they were', () => {
    for (const other of ['/settings', '/api/v1/data/x', `${HANDOFF_PATH}X`, 'https://evil.example/x', '', null]) {
      expect(handoffMarkQuery(other, marked), String(other)).toBe('');
    }
  });

  it('is empty when the page carries no mark, or one that is not a number of milliseconds', () => {
    expect(handoffMarkQuery(`${HANDOFF_PATH}${QUERY}`, '?redirect=x')).toBe('');
    expect(handoffMarkQuery(`${HANDOFF_PATH}${QUERY}`, '')).toBe('');
    expect(handoffMarkQuery(`${HANDOFF_PATH}${QUERY}`, `?${HANDOFF_REFUSED_AT_PARAM}=soon`)).toBe('');
  });
});

describe('handoffRefusedAt — what the route wrote, or nothing', () => {
  const query = (value: string) => `?redirect=%2Fx&${HANDOFF_REFUSED_AT_PARAM}=${value}`;

  it('reads a whole number of milliseconds', () => {
    expect(handoffRefusedAt(query('1793620800000'))).toBe(1793620800000);
    expect(handoffRefusedAt(`?${HANDOFF_REFUSED_AT_PARAM}=0`)).toBe(0);
  });

  it('is null when the page was not sent here by the route', () => {
    expect(handoffRefusedAt('')).toBeNull();
    expect(handoffRefusedAt('?redirect=%2Fx')).toBeNull();
  });

  it.each(['', 'abc', '12a', '-1', '1.5', '1e3', '%201', '0x10', 'NaN', 'Infinity', '9'.repeat(400)])(
    'ignores %j, so the five-minute check decides',
    (value) => {
      expect(handoffRefusedAt(query(value))).toBeNull();
    },
  );
});
