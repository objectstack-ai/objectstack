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
    // RE-FIXTURED by #10859. This case used to be driven by `fakeHandle(404,
    // undefined)` — which is the DISABLED shape, not a verification failure, and
    // now answers `DOMAIN_VERIFICATION_DISABLED` (see the #10859 describe below).
    // Pointing the generic-default leg at that shape would have left the default
    // arm of `verify-domain` with no coverage at all once the disabled branch
    // returned early, so it is driven by a real uncoded failure instead — the
    // same `502` its sibling above uses.
    const res = await runVerifyDomain(fakeHandle(502, { message: 'upstream exploded' }), post(VERIFY_URL));

    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe(OUR_DEFAULT);
    expect(res.status).toBe(502);
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

describe('#10859 the DISABLED condition gets ONE answer across both routes', () => {
  /**
   * The feature being off is a different condition from a verification failing,
   * and the two SSO domain-verification routes used to answer it differently:
   * the sibling rewrote to `400 DOMAIN_VERIFICATION_DISABLED`, while
   * `verify-domain` rewrote only the MESSAGE and let the code fall through to
   * the generic failure default — so its machine-readable field said
   * "verification failed" while its human-readable one said "the feature is
   * off". A caller can only act on the first.
   *
   * Both halves are asserted per ADR-0112 (`code` AND `status`), and the
   * counter-direction below is the load-bearing half: stamping `DISABLED` on
   * every failure would pass a one-directional suite while destroying exactly
   * the diagnosis the caller acts on.
   */
  const DISABLED = 'DOMAIN_VERIFICATION_DISABLED';
  /** The inner endpoint is unmounted when the feature is off: 404, no code. */
  const disabledInner = () => fakeHandle(404, undefined);

  it('verify-domain: the disabled condition answers the dedicated code at the sibling’s status', async () => {
    const res = await runVerifyDomain(disabledInner(), post(VERIFY_URL));

    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe(DISABLED);
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain('OS_SSO_DOMAIN_VERIFICATION');
  });

  it('both routes answer the SAME code and the SAME status for the SAME condition', async () => {
    // The card's governing invariant, asserted directly rather than inferred
    // from the two per-route cases above: one answer for one condition.
    const verify = await runVerifyDomain(disabledInner(), post(VERIFY_URL));
    const request = await runRequestDomainVerification(disabledInner(), post(REQUEST_URL));

    expect(verify.body.error?.code).toBe(request.body.error?.code);
    expect(verify.status).toBe(request.status);
    expect(verify.body.error?.code).toBe(DISABLED);
    expect(verify.status).toBe(400);
  });

  it('DOMAIN_VERIFICATION_DISABLED is registered for this package — reused, not invented', () => {
    expect(DISABLED).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(ERROR_CODE_LEDGER['@objectstack/plugin-auth']).toContain(DISABLED);
  });

  // ── the load-bearing direction: DISABLED is NOT stamped on every failure ──

  it('verify-domain: a genuine verification failure still answers the FAILURE code', async () => {
    // Uncoded, but not the disabled shape. An implementation that keyed on
    // `!resp.ok` instead of the 404-without-a-code shape would answer DISABLED
    // here and tell the admin to flip an env var that is already on.
    const res = await runVerifyDomain(fakeHandle(502, { message: 'upstream exploded' }), post(VERIFY_URL));

    expect(res.body.error?.code).toBe(OUR_DEFAULT);
    expect(res.body.error?.code).not.toBe(DISABLED);
    expect(res.status).toBe(502);
  });

  it('verify-domain: a 404 that CARRIES a vendor code is the vendor’s diagnosis, not DISABLED', async () => {
    // The disabled shape is 404 *without* a code. A 404 that carries one is the
    // vendor answering, and both its code and its status pass through untouched
    // — the arm #10716 pinned, re-pinned here at the status this branch tests.
    const res = await runVerifyDomain(fakeHandle(404, { code: VENDOR_CODE, message: 'vendor copy' }), post(VERIFY_URL));

    expect(res.body.error?.code).toBe(VENDOR_CODE);
    expect(res.body.error?.code).not.toBe(DISABLED);
    expect(res.status).toBe(404);
  });

  it('request-domain-verification: a genuine failure still answers the FAILURE code', async () => {
    // The sibling's counter-direction, so the parity assertion above cannot be
    // satisfied by both routes collapsing onto DISABLED.
    const res = await runRequestDomainVerification(fakeHandle(502, { message: 'upstream exploded' }), post(REQUEST_URL));

    expect(res.body.error?.code).toBe(OUR_DEFAULT);
    expect(res.body.error?.code).not.toBe(DISABLED);
    expect(res.status).toBe(502);
  });
});
