// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 D2 — secure-by-default (anonymous deny) posture, proven on the real
// showcase HTTP stack ON THE PLATFORM DEFAULT: the verify harness passes no
// `requireAuth` override, so this proves the flipped global default
// (spec `requireAuth` default(true)) rejects an UNAUTHENTICATED request to the
// data API (401), while authenticated members are unaffected and the
// control-plane (`/auth/*`) stays open (sign-up itself is an anonymous call).
// Public forms survive the same default via the declaration-derived
// publicFormGrant — see showcase-public-form.dogfood.test.ts.
//
// ADR-0056 D10 — the authz-conformance matrix row this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976).
// authz-row: anonymous-deny
//
// ⚠️ It claims `anonymous-deny` and NOTHING ELSE. The `requireAuth-removed` row
// used to cite this same file (#7976): what that row asserts is that the
// deployment-wide OPT-OUT is RETIRED — `api.requireAuth` tombstoned in spec, a
// stack that mounts no auth failing AT BOOT — and this file exercises none of
// it. It drives the platform default and observes 401, which is exactly what
// `anonymous-deny` already claims. Under mutual attribution that citation could
// not be made honestly, so it was dropped rather than rubber-stamped here.

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

const OBJ = '/data/showcase_private_note';

describe('showcase: anonymous default-deny (ADR-0056 D2)', () => {
  let stack: VerifyStack;
  let memberToken: string;

  beforeAll(async () => {
    stack = await getSharedShowcase(); // harness boots on the platform default (deny anonymous)
    await stack.signIn();
    memberToken = await stack.signUp('d2-member@verify.test'); // anonymous /auth call → proves control-plane is open
  }, 60_000);

  it('control-plane is open for anonymous (sign-up succeeded without a token)', () => {
    expect(memberToken, 'anonymous /auth/sign-up returned a token').toBeTruthy();
  });

  it('anonymous READ of the data API is denied (401)', async () => {
    const r = await stack.api(OBJ, { method: 'GET' });
    expect(r.status, 'unauthenticated data read must be 401').toBe(401);
  });

  it('anonymous WRITE of the data API is denied (401)', async () => {
    const w = await stack.api(OBJ, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'anon' }),
    });
    expect(w.status, 'unauthenticated data write must be 401').toBe(401);
  });

  it('an AUTHENTICATED member is allowed (deny targets anonymity, not the API)', async () => {
    const ok = await stack.apiAs(memberToken, 'GET', OBJ);
    expect(ok.status).toBe(200);
  });
});
