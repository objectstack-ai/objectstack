/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11691 — the sign-up decision, pinned where it lives.
 *
 * `decideSignUpOffer` was written for the console's own login and register
 * pages and moved into this package by objectui#11705, so that the exported
 * `DefaultLoginPage` / `DefaultRegisterPage` call the same rule. These cases
 * moved with it, unchanged, out of the console's
 * `apps/console/src/pages/auth/__tests__/signUpFollowsPosture-11691.test.tsx`
 * (which keeps the console pages' rendered pins); the default pages' rendered
 * pins are `defaultPagesFollowPosture-11705.test.tsx` beside this file.
 *
 * The posture predicate is restated in `../signUpOffer` (the console's pages
 * that call it sit in the console's eager closure); the parity case below
 * imports the spec's own predicate and vocabulary, so a posture added or
 * reclassified upstream turns this file red instead of silently mis-offering
 * the form.
 */

import { describe, it, expect } from 'vitest';
import type { AuthPublicConfig } from '@object-ui/auth';
import { AUDIENCE_POSTURES, audiencePermitsSelfRegistration } from '@objectstack/spec/system';
import type { AudiencePosture } from '@objectstack/spec/system';
import {
  audienceAdmitsUninvitedSignUp,
  decideSignUpOffer,
  isInvitationRedirect,
  needsBootstrapProbe,
} from '../signUpOffer';

const INVITATION = '/accept-invitation/inv_1';

/** The dev-seeded admin hint the console reads off the SAME config as the sign-up offer. */
const DEV_SEED = { devSeedAdmin: { email: 'admin@objectos.ai', password: 'admin123' } };

type EmailPassword = NonNullable<AuthPublicConfig['emailPassword']>;
const OPEN_SIGN_UP: EmailPassword = { enabled: true, disableSignUp: false, requireEmailVerification: false };

/**
 * The config as the server sends it. `posture` is a plain string because the
 * cases include values OUTSIDE the spec vocabulary — what a newer server could
 * send — so the one cast below is the wire, not a shortcut.
 */
function configFor(
  posture: string | undefined,
  emailPassword: EmailPassword = OPEN_SIGN_UP,
): AuthPublicConfig & typeof DEV_SEED {
  return {
    ...DEV_SEED,
    emailPassword,
    features: posture === undefined ? {} : { audiencePosture: posture as AudiencePosture },
  };
}

describe('signUpOffer — the decision both pages share (objectui#11691)', () => {
  it('agrees with the spec on every audience posture the spec declares', () => {
    expect(AUDIENCE_POSTURES.length).toBeGreaterThan(0);
    for (const posture of AUDIENCE_POSTURES) {
      expect(audienceAdmitsUninvitedSignUp(posture), posture).toBe(
        audiencePermitsSelfRegistration(posture),
      );
    }
  });

  it('reads a posture outside the spec vocabulary as not admitting', () => {
    for (const value of ['invite-only', 'OPEN', 'emailDomain', '', null, undefined, 1]) {
      expect(audienceAdmitsUninvitedSignUp(value), String(value)).toBe(false);
    }
  });

  it('recognises the invitation-acceptance route as the redirect target', () => {
    expect(isInvitationRedirect(INVITATION)).toBe(true);
    expect(isInvitationRedirect(`${INVITATION}?from=mail`)).toBe(true);
    for (const value of ['/accept-invitation/', '/accept-invitationx/inv_1', '/home', '//accept-invitation/inv_1', '', null]) {
      expect(isInvitationRedirect(value), String(value)).toBe(false);
    }
  });

  it('decides the offer from disableSignUp, the posture, the invitation and the owner state', () => {
    const none = { invitationRedirect: false, bootstrap: 'bootstrapped' } as const;
    const invited = { invitationRedirect: true, bootstrap: 'bootstrapped' } as const;
    const fresh = { invitationRedirect: false, bootstrap: 'fresh' } as const;
    const probing = { invitationRedirect: false, bootstrap: 'unknown' } as const;
    const closed = configFor('open', { enabled: true, disableSignUp: true });

    // disableSignUp: true hides everything — invitees and a fresh deployment included.
    expect(decideSignUpOffer(closed, none)).toBe('closed');
    expect(decideSignUpOffer(closed, invited)).toBe('closed');
    expect(decideSignUpOffer(configFor('invite_only', { enabled: true, disableSignUp: true }), fresh)).toBe('closed');

    // Nothing read yet, or an older server that sends no posture: as before.
    expect(decideSignUpOffer(null, none)).toBe('form');
    expect(decideSignUpOffer(configFor(undefined), none)).toBe('form');

    expect(decideSignUpOffer(configFor('open'), none)).toBe('form');
    expect(decideSignUpOffer(configFor('email_domain'), none)).toBe('form');

    expect(decideSignUpOffer(configFor('invite_only'), invited)).toBe('form');
    expect(decideSignUpOffer(configFor('invite_only'), fresh)).toBe('form');
    expect(decideSignUpOffer(configFor('invite_only'), probing)).toBe('pending');
    expect(decideSignUpOffer(configFor('invite_only'), none)).toBe('by-invitation');
    expect(decideSignUpOffer(configFor('a_future_posture'), none)).toBe('by-invitation');
  });

  it('asks for the bootstrap probe only when the posture is closed and nothing else admits', () => {
    expect(needsBootstrapProbe(configFor('invite_only'), false)).toBe(true);
    expect(needsBootstrapProbe(configFor('a_future_posture'), false)).toBe(true);
    expect(needsBootstrapProbe(configFor('invite_only'), true)).toBe(false);
    expect(needsBootstrapProbe(configFor('open'), false)).toBe(false);
    expect(needsBootstrapProbe(configFor('email_domain'), false)).toBe(false);
    expect(needsBootstrapProbe(configFor(undefined), false)).toBe(false);
    expect(needsBootstrapProbe(configFor('invite_only', { enabled: true, disableSignUp: true }), false)).toBe(false);
    expect(needsBootstrapProbe(null, false)).toBe(false);
  });
});
