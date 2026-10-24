/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * signUpOffer — what a login or register page offers a visitor who has no
 * account yet (objectui#11691).
 *
 * ONE decision for every such page (objectui#11705): the console's own
 * `/login` and `/register` (`apps/console/src/pages/auth/`) and this package's
 * exported `DefaultLoginPage` / `DefaultRegisterPage` (`./LoginPage`,
 * `./RegisterPage`, which `examples/console-starter` mounts) all call
 * {@link decideSignUpOffer}. It was written for the console's pages and moved
 * here unchanged, so that a package page can call it too; there is no second
 * copy of the rule.
 *
 * The server publishes the sign-up rule as TWO keys of `/api/v1/auth/config`:
 *
 *  - `emailPassword.disableSignUp` — the hard off switch (environment
 *    variable, config, or SSO-only mode). When it is `true` nothing is
 *    offered, invitees included; that is objectui#11634's gate and it is
 *    unchanged here.
 *  - `features.audiencePosture` — who may self-register (`invite_only`,
 *    `email_domain`, `open`). The server deliberately does NOT force
 *    `disableSignUp` from it: under `invite_only` the sign-up route still
 *    admits a pending invitee, so hiding the form outright would dead-end the
 *    people the posture exists to let in.
 *
 * Reading only the first key is how the pages used to offer "Sign up" under
 * the default `invite_only` posture and then refuse the finished form with
 * `403 SELF_REGISTRATION_CLOSED`. Reading both, the pages offer the generic
 * form only when the server would accept it from this visitor:
 *
 *  1. the posture admits uninvited self-registration (`open`, `email_domain`);
 *  2. the visitor came from an invitation — the signed-out bounce of
 *     `DefaultAcceptInvitationPage` (this package) lands on
 *     `/login?redirect=/accept-invitation/ID`, and the login page forwards
 *     that `redirect` to `/register`;
 *  3. the deployment has no owner yet (`GET /auth/bootstrap-status` answers
 *     `hasOwner: false`, read by `useBootstrapStatus` in `./bootstrapStatus`):
 *     the server admits the first account under every posture, so a fresh
 *     install never locks its operator out, and the self-hosting guide's
 *     first-run step is "open the root URL and sign up".
 *
 * Otherwise the login page offers no sign-up link, and the register page
 * explains that registration is by invitation BEFORE the form instead of
 * after it.
 *
 * A server that does not send `features.audiencePosture` (one that predates
 * the key) is answered exactly as before: `disableSignUp` alone decides. A
 * posture value this package does not recognise reads as "not admitting", so
 * an unknown future value never brings back a form the server refuses.
 */

import type { AuthPublicConfig } from '@object-ui/auth';
import type { BootstrapStatus } from './bootstrapStatus.js';

/**
 * Whether an audience posture admits a stranger's own sign-up — the spec's
 * `audiencePermitsSelfRegistration` (`@objectstack/spec/system`), restated.
 *
 * Restated rather than imported for the reason `postureHasOrgWall` in this
 * package's `hooks/useTenancyPosture.ts` records: the console's login and
 * register pages, which call this, are in the console's EAGER closure, and a
 * runtime import of a spec subpath there pays for the subpath's schema modules
 * on every page load to spell a three-value predicate. The drift that import
 * would have prevented is caught at test time instead —
 * `__tests__/signUpOffer-11691.test.ts` imports the spec's real predicate and
 * vocabulary and asserts this function agrees for every posture the spec
 * declares.
 *
 * `unknown` on purpose: the value arrives off the wire, and anything outside
 * the spec's vocabulary must read as `false`.
 */
export function audienceAdmitsUninvitedSignUp(posture: unknown): boolean {
  return posture === 'open' || posture === 'email_domain';
}

/**
 * The route an invitation link opens (the console's `App.tsx` mounts
 * `/accept-invitation/:invitationId`, and `DefaultAcceptInvitationPage` bounces
 * a signed-out visitor from it), as a basename-stripped prefix — the shape
 * `?redirect=` carries by contract.
 */
const INVITATION_ROUTE_PREFIX = '/accept-invitation/';

/**
 * Whether a `?redirect=` target is an invitation-acceptance page, i.e. the
 * visitor was bounced here by `DefaultAcceptInvitationPage` while signed out.
 *
 * This is an affordance, never an authorization: a hand-typed URL can claim
 * it, and the server still refuses a non-invitee's sign-up with
 * `SELF_REGISTRATION_CLOSED` — which `RegisterForm` renders as a localized
 * refusal. All it decides is that this visitor is shown the form.
 */
export function isInvitationRedirect(redirect: string | null | undefined): boolean {
  if (!redirect || !redirect.startsWith(INVITATION_ROUTE_PREFIX)) return false;
  const id = redirect.slice(INVITATION_ROUTE_PREFIX.length).split(/[/?#]/, 1)[0];
  return id.length > 0;
}

/**
 * What the page offers:
 *  - `form` — the generic sign-up (link on `/login`, the form on `/register`);
 *  - `by-invitation` — no generic sign-up; `/register` explains why;
 *  - `closed` — sign-up is switched off (`disableSignUp: true`);
 *  - `pending` — the posture is closed and the bootstrap probe has not
 *    answered yet; offer nothing until it does.
 */
export type SignUpOffer = 'form' | 'by-invitation' | 'closed' | 'pending';

export interface SignUpOfferContext {
  /** {@link isInvitationRedirect} of the page's `?redirect=`. */
  invitationRedirect: boolean;
  /** `useBootstrapStatus` — consulted only when the posture is closed. */
  bootstrap: BootstrapStatus;
}

/**
 * Whether the decision needs the bootstrap probe at all — only when the
 * posture is closed to strangers and nothing else already admits the visitor.
 * Gates `useBootstrapStatus`, so a deployment on `open` (or an older server)
 * makes no extra request.
 */
export function needsBootstrapProbe(
  config: AuthPublicConfig | null,
  invitationRedirect: boolean,
): boolean {
  if (!config || config.emailPassword?.disableSignUp === true) return false;
  const posture = config.features?.audiencePosture;
  if (posture === undefined) return false;
  return !audienceAdmitsUninvitedSignUp(posture) && !invitationRedirect;
}

/**
 * The decision. `config` is `null` while it has not been read (or the read
 * failed) — then nothing is known and the page behaves as it did before the
 * posture existed, leaving the server's own gate as the source of truth.
 */
export function decideSignUpOffer(
  config: AuthPublicConfig | null,
  context: SignUpOfferContext,
): SignUpOffer {
  if (config?.emailPassword?.disableSignUp === true) return 'closed';
  const posture = config?.features?.audiencePosture;
  // An older server: no posture key ⇒ `disableSignUp` alone decided, above.
  if (posture === undefined) return 'form';
  if (audienceAdmitsUninvitedSignUp(posture)) return 'form';
  if (context.invitationRedirect) return 'form';
  if (context.bootstrap === 'fresh') return 'form';
  if (context.bootstrap === 'unknown') return 'pending';
  return 'by-invitation';
}
