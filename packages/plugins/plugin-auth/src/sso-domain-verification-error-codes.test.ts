// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10716 — the two SSO domain-verification routes answer an ADR-0112 error code.
 *
 * Both handlers shape their failure as `code: parsed?.code || <our default>`,
 * and the two halves of that expression have DIFFERENT owners:
 *
 *   - `parsed?.code` is @better-auth/sso's own code passing through. It is the
 *     vendor's diagnosis and must reach the caller unchanged.
 *   - the default is OURS, so ADR-0112 applies to it: SCREAMING_SNAKE, drawn
 *     from the registered vocabulary rather than invented at the call site.
 *
 * Both directions are pinned below, and that pairing is the point. Pinning only
 * "our code appears" would go green against a handler that overwrites the
 * vendor's code unconditionally — which would swallow exactly the diagnosis the
 * caller needs (`NO_PENDING_VERIFICATION` tells them to request the DNS record
 * first; a blanket "verification failed" does not). Statuses are pinned in both
 * directions too: the inner status passes through untouched.
 *
 * Rejection cases assert `code` AND `status` per ADR-0112 — a bare "it threw"
 * would pass against a handler that refuses everyone.
 */

import { describe, it, expect } from 'vitest';
// The `/api` subpath is where the built package exposes the ledger VALUE — the
// root entry re-exports the schemas only. Reading it through the published
// exports map (i.e. `dist`) is deliberate: this asserts against the surface a
// consumer actually gets, not against a source file this test could reach.
import { ERROR_CODE_LEDGER } from '@objectstack/spec/api';
import { runRequestDomainVerification, runVerifyDomain, type AuthRequestHandler } from './register-sso-provider.js';

/** The default this package authors for both routes when the vendor gives no code. */
const OUR_DEFAULT = 'DOMAIN_VERIFICATION_FAILED';
/** A vendor code with its own meaning — the one an overwrite would destroy. */
const VENDOR_CODE = 'NO_PENDING_VERIFICATION';

const REQUEST_URL = 'https://app.example/api/v1/auth/admin/sso/request-domain-verification';
const VERIFY_URL = 'https://app.example/api/v1/auth/admin/sso/verify-domain';

/** A fake inner @better-auth/sso endpoint that answers one canned response. */
function fakeHandle(status: number, body: unknown): AuthRequestHandler {
  return async () =>
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

const post = (url: string) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'p1', domain: 'acme.example' }),
  });

describe('#10716 SSO domain verification — our default is a registered ADR-0112 code', () => {
  it('request-domain-verification: an uncoded vendor failure answers our SCREAMING default, status passed through', async () => {
    const res = await runRequestDomainVerification(fakeHandle(502, { message: 'upstream exploded' }), post(REQUEST_URL));

    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe(OUR_DEFAULT);
    expect(res.status).toBe(502);
  });

  it('verify-domain: an uncoded vendor failure answers our SCREAMING default, status passed through', async () => {
    // The 404-without-a-code shape: SSO domain verification is off for this env.
    // This is the response the dogfood admin-route probe observes.
    const res = await runVerifyDomain(fakeHandle(404, undefined), post(VERIFY_URL));

    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe(OUR_DEFAULT);
    expect(res.status).toBe(404);
  });

  it('both defaults are SCREAMING_SNAKE and registered for this package — reused, not invented', () => {
    expect(OUR_DEFAULT).toMatch(/^[A-Z][A-Z0-9_]*$/);
    // The mechanical half of "we reused a ledger entry": if this code were a new
    // spelling it would need a `packages/spec` registration, and an unregistered
    // code in a fallback slot is invisible to BOTH error-code gates — a silent
    // fourth state, which is precisely what ADR-0112 D3 exists to prevent.
    expect(ERROR_CODE_LEDGER['@objectstack/plugin-auth']).toContain(OUR_DEFAULT);
  });
});

describe('#10716 the vendor pass-through arm is untouched', () => {
  it('request-domain-verification: the vendor code and status reach the caller unchanged', async () => {
    const res = await runRequestDomainVerification(
      fakeHandle(400, { code: VENDOR_CODE, message: 'vendor copy' }),
      post(REQUEST_URL),
    );

    expect(res.body.error?.code).toBe(VENDOR_CODE);
    expect(res.body.error?.code).not.toBe(OUR_DEFAULT);
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toBe('vendor copy');
  });

  it('verify-domain: the vendor code and status reach the caller unchanged', async () => {
    const res = await runVerifyDomain(fakeHandle(400, { code: VENDOR_CODE, message: 'vendor copy' }), post(VERIFY_URL));

    expect(res.body.error?.code).toBe(VENDOR_CODE);
    expect(res.body.error?.code).not.toBe(OUR_DEFAULT);
    expect(res.status).toBe(400);
    // This route substitutes friendlier COPY for known vendor codes — the code
    // itself still passes through, which is the half that matters on the wire.
    expect(res.body.error?.message).toContain('Request Domain Verification');
  });

  it('request-domain-verification: the disabled branch keeps its own dedicated code', async () => {
    // Unchanged by #10716 and pinned so the rename cannot have blurred the two:
    // "the feature is off" is a different answer from "verification failed".
    const res = await runRequestDomainVerification(fakeHandle(404, undefined), post(REQUEST_URL));

    expect(res.body.error?.code).toBe('DOMAIN_VERIFICATION_DISABLED');
    expect(res.status).toBe(400);
  });
});
