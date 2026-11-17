/**
 * AcceptInvitationPage
 *
 * Standalone page for accepting or rejecting an organization invitation.
 * Route: /accept-invitation/:invitationId
 *
 * Exported as `DefaultAcceptInvitationPage` and routed by `apps/console`
 * (objectui#3811) as well as by downstream apps. The page paints its own
 * full-viewport shell, so hosts mount it bare — no auth layout around it.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, Input, Label } from '@object-ui/components';
import { SocialSignInButtons, useAuth } from '@object-ui/auth';
import type { AuthInvitation, AuthInvitationPreview } from '@object-ui/auth';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { Loader2, Building2, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { resolveOrgRoleLabel } from '../orgRoleLabel.js';
import {
  isAcceptNeedsVerifiedEmail,
  resolveInvitationLookupMessage,
  resolveOrgErrorMessage,
} from '../orgErrorMessage.js';
import { resolveRootUrl } from '../resolveHomeUrl.js';

type InvitationWithOrg = AuthInvitation & {
  organizationName?: string;
  organizationSlug?: string;
  /**
   * The inviting member's email, which better-auth's `get-invitation` adds to
   * its answer. The route returns no inviter name, so the page names the
   * inviter by this address (#25886).
   */
  inviterEmail?: string;
};

/** The URL fragment key the invitation mail's link carries its mailbox proof under. */
const PROOF_FRAGMENT_KEY = 'proof';

/**
 * The query marker a provider sign-in started on this page returns with, so
 * the page redeems the invitation for the session the provider just opened.
 */
const PROVIDER_RETURN_KEY = 'via';
const PROVIDER_RETURN_VALUE = 'provider';

/**
 * Reads the mailbox proof from the URL fragment once, and clears the fragment
 * from the address bar, so the proof is not left in the visible URL, the
 * history entry or a link copied from the page. A fragment never reaches the
 * server, so the proof is only ever sent in the one-step request's body.
 */
function takeProofFromFragment(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;
  const proof = new URLSearchParams(hash.slice(1)).get(PROOF_FRAGMENT_KEY);
  if (!proof) return null;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return proof;
}

/** This page's address with the provider-return marker set, for a provider sign-in to come back to. */
function providerReturnUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.set(PROVIDER_RETURN_KEY, PROVIDER_RETURN_VALUE);
  return url.toString();
}

/** Removes the provider-return marker from the address bar once it has been read. */
function clearProviderReturn(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PROVIDER_RETURN_KEY)) return;
  url.searchParams.delete(PROVIDER_RETURN_KEY);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

const readCode = (err: unknown): string | undefined => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
};

export function AcceptInvitationPage() {
  const { t } = useObjectTranslation();
  // Dates and numbers on this surface read the display locale; a bare
  // `toLocale*()` call used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { invitationId } = useParams<{ invitationId: string }>();
  const {
    user,
    isAuthenticated,
    isLoading: isAuthLoading,
    getInvitation,
    acceptInvitation,
    acceptInvitationOneStep,
    rejectInvitation,
    switchOrganization,
  } = useAuth();

  const [invitation, setInvitation] = useState<InvitationWithOrg | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  // Set once the membership exists and the session is switched to it: the page
  // then says the user joined, and Continue enters the organization.
  const [joined, setJoined] = useState(false);
  // The mailbox proof the invitation mail's link carries in its fragment. A
  // signed-out visitor holding it is offered the one-step form in place of
  // the sign-in redirect; without it (a copied link) the page keeps its path.
  const [proof] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.hash.slice(1)).get(PROOF_FRAGMENT_KEY) || null,
  );
  // True while the page redeems the invitation for a session a provider
  // sign-in started here just opened.
  const [providerReturn, setProviderReturn] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get(PROVIDER_RETURN_KEY) === PROVIDER_RETURN_VALUE,
  );
  // Joined through the one-step door: the organization's name to welcome the
  // visitor to (the door answers no role).
  const [oneStepJoined, setOneStepJoined] = useState<{ orgName: string } | null>(null);
  // The provider session's address is not the invited one, or not verified.
  const [needsVerifiedEmail, setNeedsVerifiedEmail] = useState(false);

  // The proof leaves the address bar as soon as it has been read.
  useEffect(() => {
    if (proof) takeProofFromFragment();
  }, [proof]);

  // Redirect to login if not authenticated.
  //
  // The return path comes from the ROUTER (`useLocation`), never from
  // `window.location.pathname`: `?redirect=` is a basename-stripped path by
  // contract — a host mounted under `<base href="/console/">` re-prefixes it
  // before navigating (see `apps/console` `LoginPage.withConsoleBase`), so a
  // window-derived path that already carries the mount doubles it into
  // `/console/console/accept-invitation/…`. Under the default `/` mount the two
  // spellings agree, which is why only the basename case can catch it
  // (objectui#3811).
  //
  // A visitor holding the mailbox proof is not redirected: the page offers the
  // one-step form instead.
  const loginRedirect = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated && !proof) {
      navigate(loginRedirect);
    }
  }, [isAuthenticated, isAuthLoading, navigate, loginRedirect, proof]);

  // Back from a provider sign-in started on this page: read the invitation
  // while it is still pending, then redeem it for the new session. Anything
  // but an acceptance falls back to the page's own path.
  // Runs once: the redemption is not repeated when the effect re-runs.
  const redeemStarted = useRef(false);
  useEffect(() => {
    if (!providerReturn || !invitationId || isAuthLoading || !isAuthenticated) return;
    if (redeemStarted.current) return;
    redeemStarted.current = true;
    clearProviderReturn();
    setIsLoading(true);
    void (async () => {
      const inv = await getInvitation(invitationId).catch(() => null);
      try {
        const outcome = await acceptInvitationOneStep({ invitationId });
        if (outcome.outcome === 'accepted') {
          await switchOrganization(outcome.organizationId).catch(() => null);
          setOneStepJoined({
            orgName: (inv as InvitationWithOrg | null)?.organizationName ?? outcome.organizationId,
          });
          setIsLoading(false);
          return;
        }
        if (outcome.outcome === 'verify_email') {
          setNeedsVerifiedEmail(true);
          setIsLoading(false);
          return;
        }
      } catch {
        // Falls through to the page's own path below.
      }
      setProviderReturn(false);
    })();
  }, [providerReturn, invitationId, isAuthLoading, isAuthenticated, getInvitation, acceptInvitationOneStep, switchOrganization]);

  // Fetch invitation details
  useEffect(() => {
    if (!invitationId || !isAuthenticated || providerReturn) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getInvitation(invitationId)
      .then((inv) => {
        if (!cancelled) setInvitation(inv);
      })
      .catch((err) => {
        if (!cancelled)
          // objectstack#33650 — the lookup's own not-found answer carries no
          // code; read by route, status and the missing code, never the text.
          setError(resolveInvitationLookupMessage(err, t));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invitationId, isAuthenticated, getInvitation, t]);

  const handleAccept = async () => {
    if (!invitation || !invitationId) return;
    setIsAccepting(true);
    try {
      await acceptInvitation(invitationId);
      await switchOrganization(invitation.organizationId).catch(() => null);
      setJoined(true);
    } catch (err) {
      // objectstack#34272 — while the deployment delivers mail, an address that
      // was never verified may not accept. The next step is to verify it, so
      // the page hands over to the verification-mail screen for this account's
      // address, whose link brings the person back here to accept.
      if (isAcceptNeedsVerifiedEmail(err)) {
        const sp = new URLSearchParams();
        if (user?.email) sp.set('email', user.email);
        sp.set('redirect', location.pathname + location.search);
        navigate(`/verify-email-prompt?${sp.toString()}`);
        return;
      }
      // objectui#4474 — the card's site 5: a wrong recipient produced better-auth's
      // English sentence under the translated title. Mapped by `code` now.
      toast.error(
        resolveOrgErrorMessage(err, t, {
          key: 'organization.accept.acceptFailed',
          defaultValue: 'Failed to accept invitation',
        }),
      );
      setIsAccepting(false);
    }
  };

  // Continue from the "you joined" state. The confirmation is the page, not a
  // toast: the full-page navigation below would drop a toast before anyone
  // read it.
  const handleContinue = () => {
    // The console ROOT, as a full-page navigation — NOT a router `navigate()`
    // and NOT `useHomePath()` (objectui#7373).
    //
    // ⭐ WHY THE HOOK IS WRONG *HERE*, while it is right at this card's nine
    // other sites: the app list this component can read belongs to the
    // organization the user is LEAVING. `switchOrganization` in `handleAccept`
    // only updates auth state; `MetadataProvider` drops its whole cache when the
    // active org changes (objectui#4486) and refetches, and nothing here waits
    // for that to land. A declared-landing answer read here would
    // therefore name the PREVIOUS org's app — an app the new organization may
    // not even carry — which is worse than the launcher this replaced.
    //
    // Landing on the ROOT resolves the declaration AFTER the switch instead
    // of before it: the full page load re-seats every data scope on the new
    // org, then `RootLandingRedirect` reads the new org's list and applies
    // `resolveLandingPath` — the declared landing, a single-app workspace's
    // one app, or the launcher. So this page honours `app.isDefault` for the
    // organization the user just joined, which is what objectui#7373 asked
    // for, by the only route that can read it.
    //
    // This is the shape both other org-switch paths already take, for this
    // same reason, and their comments say so: `layout/WorkspaceSwitcher.tsx`
    // (`handleSwitch`) and `console/organizations/OrganizationsPage.tsx`
    // (`handleSelect`). Accepting an invitation is the third site of one
    // transition; it was the only one not taking it.
    //
    // `resolveRootUrl()` and not a bare `'/'`: a full-page navigation leaves
    // React Router, so nothing applies the host's `basename`, and a console
    // served under `<base href="/_console/">` would drop the user at the
    // origin root, outside the SPA.
    window.location.href = resolveRootUrl();
  };

  const handleDecline = async () => {
    if (!invitationId) return;
    setIsDeclining(true);
    try {
      await rejectInvitation(invitationId);
      toast.success(t('organization.accept.declined', { defaultValue: 'Invitation declined' }));
      navigate('/organizations');
    } catch (err) {
      toast.error(
        resolveOrgErrorMessage(err, t, {
          key: 'organization.accept.declineFailed',
          defaultValue: 'Failed to decline invitation',
        }),
      );
      setIsDeclining(false);
    }
  };

  // Show spinner while auth is loading
  if (isAuthLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Joined in one step: welcomed by name, and Continue enters the organization.
  const oneStepJoinedState = oneStepJoined ? (
    <div className="flex flex-col items-center gap-6 text-center" data-testid="accept-invitation-joined">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <CheckCircle className="h-7 w-7 text-primary" />
      </div>
      <div role="status">
        <h1 className="text-xl font-bold">
          {t('organization.accept.accepted', { defaultValue: 'Invitation accepted' })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('organization.accept.joinedWelcome', {
            defaultValue: 'Welcome to {{orgName}}.',
            orgName: oneStepJoined.orgName,
          })}
        </p>
      </div>
      <Button className="w-full" onClick={handleContinue} autoFocus>
        {t('organization.accept.continue', { defaultValue: 'Continue' })}
      </Button>
    </div>
  ) : null;

  if (!isAuthenticated) {
    // Will redirect when the link carries no proof — show nothing meanwhile.
    if (!proof || !invitationId) return null;
    return (
      <div className="flex min-h-svh items-center justify-center px-4 py-12 bg-background">
        <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm" data-testid="accept-invitation-page">
          {oneStepJoinedState ?? (
            <OneStepJoinForm
              invitationId={invitationId}
              proof={proof}
              acceptInvitationOneStep={acceptInvitationOneStep}
              onJoined={(orgName) => setOneStepJoined({ orgName })}
              onSignIn={() => navigate(loginRedirect)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm" data-testid="accept-invitation-page">
        {oneStepJoinedState ? (
          oneStepJoinedState
        ) : needsVerifiedEmail ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center" data-testid="accept-invitation-verify-email">
            <XCircle className="h-10 w-10 text-muted-foreground" />
            <h1 className="text-xl font-semibold">
              {t('organization.accept.verifyEmailTitle', { defaultValue: 'Verify your email address' })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('organization.accept.verifyEmailDescription', {
                defaultValue:
                  'The email address of this account must be the invited one, and verified. Verify it, then open the invitation link from your mailbox again.',
              })}
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t('organization.accept.loading', { defaultValue: 'Loading invitation…' })}
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <XCircle className="h-10 w-10 text-destructive" />
            <h1 className="text-xl font-semibold">
              {t('organization.accept.errorTitle', { defaultValue: 'Invitation unavailable' })}
            </h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => navigate('/organizations')}>
              {t('organization.accept.goToOrgs', { defaultValue: 'Go to organizations' })}
            </Button>
          </div>
        ) : invitation && joined ? (
          <div className="flex flex-col items-center gap-6 text-center" data-testid="accept-invitation-joined">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle className="h-7 w-7 text-primary" />
            </div>
            <div role="status">
              <h1 className="text-xl font-bold">
                {t('organization.accept.accepted', { defaultValue: 'Invitation accepted' })}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('organization.accept.joinedDescription', {
                  defaultValue: 'Welcome to {{orgName}}. You joined as {{role}}.',
                  orgName: invitation.organizationName ?? invitation.organizationId,
                  role: resolveOrgRoleLabel(invitation.role, t),
                })}
              </p>
            </div>
            {/* Focused when the state appears, so Enter continues. */}
            <Button className="w-full" onClick={handleContinue} autoFocus>
              {t('organization.accept.continue', { defaultValue: 'Continue' })}
            </Button>
          </div>
        ) : invitation ? (
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Building2 className="h-7 w-7 text-primary" />
            </div>

            <div>
              <h1 className="text-xl font-bold">
                {t('organization.accept.title', { defaultValue: 'You have been invited' })}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('organization.accept.description', {
                  defaultValue:
                    'You have been invited to join {{orgName}} as {{role}}.',
                  orgName: invitation.organizationName ?? invitation.organizationId,
                  role: resolveOrgRoleLabel(invitation.role, t),
                })}
              </p>
            </div>

            <div className="w-full rounded-lg border bg-muted/50 p-4 text-left space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('organization.accept.organization', { defaultValue: 'Organization' })}
                </span>
                <span className="font-medium">
                  {invitation.organizationName ?? invitation.organizationId}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('organization.accept.role', { defaultValue: 'Role' })}
                </span>
                <span className="font-medium" data-testid="accept-invitation-role">
                  {resolveOrgRoleLabel(invitation.role, t)}
                </span>
              </div>
              {invitation.inviterEmail && (
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">
                    {t('organization.accept.invitedBy', { defaultValue: 'Invited by' })}
                  </span>
                  <span className="truncate font-medium" data-testid="accept-invitation-inviter">
                    {invitation.inviterEmail}
                  </span>
                </div>
              )}
              {invitation.expiresAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('organization.accept.expiresAt', { defaultValue: 'Expires' })}
                  </span>
                  <span className="font-medium">
                    {new Date(invitation.expiresAt).toLocaleDateString(displayLocale)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex w-full gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleDecline}
                disabled={isDeclining || isAccepting}
              >
                {isDeclining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('organization.accept.decline', { defaultValue: 'Decline' })}
              </Button>
              <Button
                className="flex-1"
                onClick={handleAccept}
                disabled={isAccepting || isDeclining}
              >
                {isAccepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <CheckCircle className="mr-2 h-4 w-4" />
                {t('organization.accept.accept', { defaultValue: 'Accept invitation' })}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface OneStepJoinFormProps {
  invitationId: string;
  proof: string;
  acceptInvitationOneStep: ReturnType<typeof useAuth>['acceptInvitationOneStep'];
  /** The door accepted: the visitor has an account, a session and the membership. */
  onJoined: (orgName: string) => void;
  /** The address has an account the visitor signs in to, as today. */
  onSignIn: () => void;
}

/**
 * The one form a signed-out visitor holding the mailbox proof sees: a name and
 * a password, or a provider sign-in. One request creates the account (or sets
 * the password of an unverified one), verifies the address, accepts and signs
 * in. A provider sign-in returns to this page, which redeems the invitation for
 * the provider's session.
 */
function OneStepJoinForm({ invitationId, proof, acceptInvitationOneStep, onJoined, onSignIn }: OneStepJoinFormProps) {
  const { t } = useObjectTranslation();
  const { getInvitationPreview } = useAuth();
  const [preview, setPreview] = useState<AuthInvitationPreview | null>(null);
  const [gone, setGone] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInvitationPreview(invitationId)
      .then((answer) => {
        if (cancelled) return;
        if (answer === null) setGone(true);
        else setPreview(answer);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [getInvitationPreview, invitationId]);

  const invalidMessage = t('organization.accept.proofInvalid', {
    defaultValue: 'This invitation link can no longer be used. Ask for a new invitation, or sign in to an existing account.',
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const outcome = await acceptInvitationOneStep({ invitationId, proof, name: name.trim(), password });
      if (outcome.outcome === 'accepted') {
        onJoined(preview?.organizationName ?? outcome.organizationId);
        return;
      }
      onSignIn();
    } catch (err) {
      setFailure(
        readCode(err) === 'INVALID_TOKEN'
          ? invalidMessage
          : resolveOrgErrorMessage(err, t, {
              key: 'organization.accept.acceptFailed',
              defaultValue: 'Failed to accept invitation',
            }),
      );
      setSubmitting(false);
    }
  };

  if (gone) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center" data-testid="accept-invitation-proof-gone">
        <XCircle className="h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold">
          {t('organization.accept.errorTitle', { defaultValue: 'Invitation unavailable' })}
        </h1>
        <p className="text-sm text-muted-foreground">{invalidMessage}</p>
        <Button variant="outline" onClick={onSignIn}>
          {t('organization.accept.signInInstead', { defaultValue: 'Sign in to an existing account' })}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="accept-invitation-one-step">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Building2 className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">
            {preview
              ? t('organization.accept.proofTitle', {
                  defaultValue: 'Join {{orgName}}',
                  orgName: preview.organizationName,
                })
              : t('organization.accept.title', { defaultValue: 'You have been invited' })}
          </h1>
          {preview && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('organization.accept.proofDescription', {
                defaultValue: 'Set up your account for {{email}} to accept the invitation.',
                email: preview.email,
              })}
            </p>
          )}
        </div>
      </div>

      <SocialSignInButtons
        mode="sign-up"
        callbackURL={providerReturnUrl()}
        dividerText={t('organization.accept.proofDivider', { defaultValue: 'or set a password' })}
      />

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {failure && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive" role="alert">
            {failure}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="accept-invitation-name">
            {t('organization.accept.proofNameLabel', { defaultValue: 'Name' })}
          </Label>
          <Input
            id="accept-invitation-name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="accept-invitation-password">
            {t('organization.accept.proofPasswordLabel', { defaultValue: 'Password' })}
          </Label>
          <Input
            id="accept-invitation-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting || !name.trim() || !password}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('organization.accept.proofSubmit', { defaultValue: 'Create account and join' })}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onSignIn} disabled={submitting}>
          {t('organization.accept.signInInstead', { defaultValue: 'Sign in to an existing account' })}
        </Button>
      </form>
    </div>
  );
}
