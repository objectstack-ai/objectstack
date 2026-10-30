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
 * nothing prefills it: a masked value is not an address. A failed read, or a
 * server without the route, keeps the generic copy (`invitationArrivalCopy`).
 *
 * The server's one not-found answer is different (#27509): ADR-0138 D2 has the
 * door answer the same 404 for an unknown, expired, accepted, rejected or
 * cancelled id, so the page cannot say which of those it is, but it does know
 * the link no longer leads anywhere. All four pages then draw
 * `InvitationGoneNotice` in place of the invitation card, the sign-up prompt
 * and the form (`useInvitationArrival`'s `gone`); its copy never names one of
 * the five cases. A sign-up the server refuses with `SELF_REGISTRATION_CLOSED`
 * re-reads the preview (`recheck`): a 404 turns the page into the same
 * notice, and an answer keeps the form with the refusal naming the masked
 * address the invitation was sent to (`signUpRefusalMessages`).
 *
 * The sign-up prompt is rendered only when the page's sign-up offer is `form`,
 * so a server with sign-up switched off is never offered a registration it
 * refuses.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthFormHeader, AUTH_LINK_CLASS, useAuth, type AuthInvitationPreview } from '@object-ui/auth';
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

/** What the signed-out invitation preview has said about the page's invitation. */
export interface InvitationArrival {
  /**
   * The preview, or `null`: until the read answers, for a redirect that is not
   * an invitation, after a failed read, and when the invitation is `gone`.
   */
  preview: AuthInvitationPreview | null;
  /**
   * `true` once the server gave its one not-found answer for the CURRENT id
   * (#27509): the link no longer leads to an invitation. Never `true` for a
   * failed read or a server without the route.
   */
  gone: boolean;
  /**
   * Read the preview again — after a sign-up the server refused, so the page
   * learns whether the invitation went away meanwhile. A failed re-read keeps
   * what the page already knew.
   */
  recheck: () => void;
}

/**
 * The signed-out invitation preview for the page's `?redirect=`.
 *
 * Only an answer for the CURRENT id is returned, so a page whose redirect
 * changes never shows the previous invitation's names or calls it gone. A
 * failed read is not news for the page and never throws into it: the generic
 * copy stays, and the sign-in or sign-up request reports the server for
 * itself.
 */
export function useInvitationArrival(redirect: string | null | undefined): InvitationArrival {
  const { getInvitationPreview } = useAuth();
  const invitationId = invitationIdOf(redirect);
  const [answer, setAnswer] = useState<{ id: string; preview: AuthInvitationPreview | null } | null>(null);
  const [readCount, setReadCount] = useState(0);
  useEffect(() => {
    if (!invitationId) return;
    let cancelled = false;
    // Inside the chain, so a synchronous throw is a rejection like any other.
    Promise.resolve()
      .then(() => getInvitationPreview(invitationId))
      .then(
        // `null` is the door's not-found answer: the invitation is gone.
        (preview) => {
          if (!cancelled) setAnswer({ id: invitationId, preview });
        },
        () => {},
      );
    return () => {
      cancelled = true;
    };
  }, [invitationId, getInvitationPreview, readCount]);
  const recheck = () => setReadCount((n) => n + 1);
  const current = answer && answer.id === invitationId ? answer : null;
  return { preview: current?.preview ?? null, gone: current !== null && current.preview === null, recheck };
}

/**
 * The signed-out invitation preview for the page's `?redirect=`, or `null` —
 * {@link useInvitationArrival}'s `preview`, for a caller that only greets.
 */
export function useInvitationPreview(redirect: string | null | undefined): AuthInvitationPreview | null {
  return useInvitationArrival(redirect).preview;
}

/**
 * What every login and register page draws for an invitation the server no
 * longer knows (#27509), in place of the invitation card, the sign-up prompt
 * and the form: the link is no longer valid, ask for a new one, and a way on
 * to the plain sign-in. The copy never says which of the door's five
 * not-found cases it is, because the server does not say (ADR-0138 D2).
 */
export function InvitationGoneNotice() {
  const { t } = useObjectTranslation();
  return (
    <div
      data-testid="invitation-gone"
      className="mx-auto flex w-full flex-col justify-center space-y-7 sm:max-w-[400px]"
    >
      <AuthFormHeader
        title={t('auth.login.invitationGoneTitle', {
          defaultValue: 'This invitation link is no longer valid',
        })}
        description={t('auth.login.invitationGoneDescription', {
          defaultValue:
            'It may have expired, been used, or been withdrawn. Ask the person who invited you to send a new invitation.',
        })}
      />
      <p className="text-center text-sm text-muted-foreground">
        <Link to="/login" className={AUTH_LINK_CLASS}>
          {t('auth.login.invitationGoneSignIn', { defaultValue: 'Go to sign in' })}
        </Link>
      </p>
    </div>
  );
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
