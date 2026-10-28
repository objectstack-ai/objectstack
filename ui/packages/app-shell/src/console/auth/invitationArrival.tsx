/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * invitationArrival — what a login or register page shows a visitor who
 * arrived signed out from an invitation link (#25886, #26473).
 *
 * `DefaultAcceptInvitationPage` bounces a signed-out visitor to
 * `/login?redirect=/accept-invitation/ID` (`isInvitationRedirect` in
 * `./signUpOffer`). Most invitees have never had an account here, so for them
 * the generic "Welcome back" card with a small "Sign up" link under the form
 * read as the wrong site. Both login pages — the console's own
 * (`apps/console/src/pages/auth/LoginPage.tsx`) and this package's
 * `DefaultLoginPage` — retitle the card for that visitor and render
 * `InvitationSignUpPrompt` above the form in place of the small link, so there
 * is ONE prompt and no second copy of it. Both register pages retitle theirs.
 *
 * The title names the organization and the inviter when the server's
 * signed-out preview answers for the id the link carries
 * (`useInvitationPreview`, `GET {authUrl}/organization/invitation-preview`):
 * "Lin invited you to join Acme". The invited address comes back MASKED
 * (`z***@example.com`), so the description shows it as the address to use and
 * nothing prefills it: a masked value is not an address. An id the server does
 * not know (404), a failed read, or a server without the route keeps the
 * generic copy (`invitationArrivalCopy`) — the preview only ever adds names.
 *
 * The sign-up prompt is rendered only when the page's sign-up offer is `form`,
 * so a server with sign-up switched off is never offered a registration it
 * refuses.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, type AuthInvitationPreview } from '@object-ui/auth';
import { useObjectTranslation, type TranslateFn } from '@object-ui/i18n';

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

/** The basename-stripped route an invitation link opens, as `./signUpOffer` reads it. */
const INVITATION_ROUTE_PREFIX = '/accept-invitation/';

/**
 * The invitation id a `?redirect=` target carries, or `null` when it is not an
 * invitation-acceptance path. Reads the same segment `isInvitationRedirect`
 * tests for, so the two agree on which redirects are invitations.
 */
export function invitationIdOf(redirect: string | null | undefined): string | null {
  if (!redirect || !redirect.startsWith(INVITATION_ROUTE_PREFIX)) return null;
  const segment = redirect.slice(INVITATION_ROUTE_PREFIX.length).split(/[/?#]/, 1)[0];
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape is still the segment the link carried; the server
    // answers its uniform 404 for it.
    return segment;
  }
}

/**
 * The signed-out invitation preview for the page's `?redirect=`, or `null`.
 *
 * `null` until the read answers, for a redirect that is not an invitation, for
 * the server's not-found answer, and after a failed read: each of those keeps
 * the page's generic invitation copy, and none of them throws into the page.
 * Only an answer for the CURRENT id is returned, so a page whose redirect
 * changes never shows the previous invitation's names.
 */
export function useInvitationPreview(redirect: string | null | undefined): AuthInvitationPreview | null {
  const { getInvitationPreview } = useAuth();
  const invitationId = invitationIdOf(redirect);
  const [answer, setAnswer] = useState<{ id: string; preview: AuthInvitationPreview } | null>(null);
  useEffect(() => {
    if (!invitationId) return;
    let cancelled = false;
    // Inside the chain, so a synchronous throw is a rejection like any other.
    Promise.resolve()
      .then(() => getInvitationPreview(invitationId))
      .then(
        (preview) => {
          if (!cancelled && preview) setAnswer({ id: invitationId, preview });
        },
        () => {
          // A failed read is not news for this page: the generic copy stays,
          // and the sign-in or sign-up request reports the server for itself.
        },
      );
    return () => {
      cancelled = true;
    };
  }, [invitationId, getInvitationPreview]);
  return answer && answer.id === invitationId ? answer.preview : null;
}

/**
 * The invitation card's title and description for one of the two pages: with
 * a preview, "INVITER invited you to join ORG" (or "You are invited to join
 * ORG" when the inviter has no name) over the masked address to use; without
 * one, the generic copy each page showed before the preview existed.
 */
export function invitationArrivalCopy(
  page: 'login' | 'register',
  preview: AuthInvitationPreview | null,
  t: TranslateFn,
): { title: string; description: string } {
  if (!preview) {
    return page === 'login'
      ? {
          title: t('auth.login.invitationTitle', { defaultValue: 'Accept your invitation' }),
          description: t('auth.login.invitationDescription', {
            defaultValue: 'Use the email address the invitation was sent to.',
          }),
        }
      : {
          title: t('auth.register.invitationTitle', { defaultValue: 'Create an account to join' }),
          description: t('auth.register.invitationDescription', {
            defaultValue:
              'Register with the email address the invitation was sent to. The invitation can only be accepted with that address.',
          }),
        };
  }
  const organization = preview.organizationName;
  const title = preview.inviterName
    ? t('auth.login.invitationPreviewTitle', {
        defaultValue: '{{inviter}} invited you to join {{organization}}',
        inviter: preview.inviterName,
        organization,
      })
    : t('auth.login.invitationPreviewTitleNoInviter', {
        defaultValue: 'You are invited to join {{organization}}',
        organization,
      });
  const description =
    page === 'login'
      ? t('auth.login.invitationPreviewDescription', {
          defaultValue: 'Use the email address the invitation was sent to ({{email}}).',
          email: preview.email,
        })
      : t('auth.register.invitationPreviewDescription', {
          defaultValue:
            'Register with the email address the invitation was sent to ({{email}}). The invitation can only be accepted with that address.',
          email: preview.email,
        });
  return { title, description };
}
