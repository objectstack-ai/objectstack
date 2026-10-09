// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] The in-process session-read rule, pinned at its one home. Every
 * in-process `auth.api.getSession` reader in `rest`, `runtime`,
 * `plugin-hono-server` and `cloud-connection` hands better-auth what
 * `inProcessSessionReadInput` returns, so the cookie test below IS the line
 * between "renewal stays where the cookie is re-issued" (a browser) and
 * "renewal as before" (a bearer-only client). The end-to-end half — real
 * better-auth, real doors, `sys_session.expires_at` read back — lives in
 * `packages/runtime/src/in-process-session-renewal.pin.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { carriesSessionCookie, inProcessSessionReadInput } from './in-process-session-read.js';

const SIGNED = 'tok3nValue.c2lnbmF0dXJl';

describe('[#22258] carriesSessionCookie — what counts as a browser session cookie', () => {
  it('recognises better-auth\'s session cookie in every spelling better-auth writes', () => {
    // default prefix
    expect(carriesSessionCookie(new Headers({ cookie: `better-auth.session_token=${SIGNED}` }))).toBe(true);
    // secure cookies
    expect(carriesSessionCookie(new Headers({ cookie: `__Secure-better-auth.session_token=${SIGNED}` }))).toBe(true);
    // an author-configured `advanced.cookiePrefix`
    expect(carriesSessionCookie(new Headers({ cookie: `acme.session_token=${SIGNED}` }))).toBe(true);
    expect(carriesSessionCookie(new Headers({ cookie: `__Secure-acme-console.session_token=${SIGNED}` }))).toBe(true);
    // among other cookies, in any position
    expect(carriesSessionCookie(new Headers({
      cookie: `os_locale=en; better-auth.session_token=${SIGNED}; theme=dark`,
    }))).toBe(true);
  });

  it('a bearer-only request carries none — the bearer is NOT a cookie, however it is spelled', () => {
    expect(carriesSessionCookie(new Headers({ authorization: `Bearer ${SIGNED}` }))).toBe(false);
    expect(carriesSessionCookie(new Headers())).toBe(false);
  });

  it('other cookies are not a session cookie', () => {
    expect(carriesSessionCookie(new Headers({ cookie: 'os_locale=en; theme=dark' }))).toBe(false);
    // better-auth's OTHER cookies: renewal is the session token's question only
    expect(carriesSessionCookie(new Headers({ cookie: 'better-auth.dont_remember=x; better-auth.session_data=y' }))).toBe(false);
    // a name that merely ENDS like it, with no prefix separator
    expect(carriesSessionCookie(new Headers({ cookie: `xsession_token=${SIGNED}` }))).toBe(false);
    // a session-token-shaped string inside another cookie's VALUE
    expect(carriesSessionCookie(new Headers({ cookie: `note=better-auth.session_token` }))).toBe(false);
  });

  it('an empty session cookie value is no session cookie', () => {
    expect(carriesSessionCookie(new Headers({ cookie: 'better-auth.session_token=' }))).toBe(false);
    expect(carriesSessionCookie(new Headers({ cookie: 'better-auth.session_token=; theme=dark' }))).toBe(false);
  });

  it('reads plain header records the way adapters deliver them', () => {
    expect(carriesSessionCookie({ cookie: `better-auth.session_token=${SIGNED}` })).toBe(true);
    expect(carriesSessionCookie({ Cookie: `better-auth.session_token=${SIGNED}` })).toBe(true);
    expect(carriesSessionCookie({ cookie: ['os_locale=en', `better-auth.session_token=${SIGNED}`] })).toBe(true);
    expect(carriesSessionCookie({ authorization: `Bearer ${SIGNED}` })).toBe(false);
    expect(carriesSessionCookie({ cookie: undefined })).toBe(false);
  });

  it('no headers at all is no cookie', () => {
    expect(carriesSessionCookie(undefined)).toBe(false);
    expect(carriesSessionCookie(null)).toBe(false);
    expect(carriesSessionCookie('better-auth.session_token=x')).toBe(false);
  });
});

describe('[#22258] inProcessSessionReadInput — the getSession input every reader hands better-auth', () => {
  it('a cookie request reads WITHOUT renewal', () => {
    const headers = new Headers({ cookie: `better-auth.session_token=${SIGNED}` });
    expect(inProcessSessionReadInput(headers)).toEqual({ headers, query: { disableRefresh: true } });
  });

  it('a cookie AND bearer request (the console sends both) reads without renewal', () => {
    const headers = new Headers({
      cookie: `better-auth.session_token=${SIGNED}`,
      authorization: `Bearer ${SIGNED}`,
    });
    expect(inProcessSessionReadInput(headers).query).toEqual({ disableRefresh: true });
  });

  it('a bearer-only request reads exactly as before — no query key at all', () => {
    const headers = new Headers({ authorization: `Bearer ${SIGNED}` });
    const input = inProcessSessionReadInput(headers);
    expect(input).toEqual({ headers });
    expect('query' in input).toBe(false);
  });

  it('hands the SAME headers object through, never a copy', () => {
    const webHeaders = new Headers({ cookie: `better-auth.session_token=${SIGNED}` });
    const record = { authorization: `Bearer ${SIGNED}` };
    expect(inProcessSessionReadInput(webHeaders).headers).toBe(webHeaders);
    expect(inProcessSessionReadInput(record).headers).toBe(record);
  });
});
