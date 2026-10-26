/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * invitationArrival — the register-first action a login page shows a visitor
 * who arrived signed out from an invitation link (#25886).
 *
 * `DefaultAcceptInvitationPage` bounces a signed-out visitor to
 * `/login?redirect=/accept-invitation/ID` (`isInvitationRedirect` in
 * `./signUpOffer`). Most invitees have never had an account here, so for them
 * the generic "Welcome back" card with a small "Sign up" link under the form
 * read as the wrong site. Both login pages — the console's own
 * (`apps/console/src/pages/auth/LoginPage.tsx`) and this package's
 * `DefaultLoginPage` — retitle the card for that visitor and render this
 * prompt above the form in place of the small link, so there is ONE prompt and
 * no second copy of it.
 *
 * The prompt names no organization and no inviter: the only invitation read
 * the server serves (`GET /organization/get-invitation`) answers a signed-out
 * caller `401`, and an anonymous preview is a server decision this package
 * does not make. It is rendered only when the page's sign-up offer is `form`,
 * so a server with sign-up switched off is never offered a registration it
 * refuses.
 */

import { Link } from 'react-router-dom';
import { useObjectTranslation } from '@object-ui/i18n';

/** A full-width outlined link with the auth primary button's box. */
const INVITATION_SIGN_UP_CLASS =
  'inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2';

/**
 * "Create an account and join", then a divider that hands over to the sign-in
 * form below it. `registerUrl` is the page's own `/register?redirect=…`, so the
 * invitation survives the hop.
 */
export function InvitationSignUpPrompt({ registerUrl }: { registerUrl: string }) {
  const { t } = useObjectTranslation();
  return (
    <div data-testid="invitation-sign-up" className="flex flex-col gap-4">
      <Link to={registerUrl} className={INVITATION_SIGN_UP_CLASS}>
        {t('auth.login.invitationSignUpButton', { defaultValue: 'Create an account and join' })}
      </Link>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span>
          {t('auth.login.invitationSignInDivider', {
            defaultValue: 'or sign in to an existing account',
          })}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
