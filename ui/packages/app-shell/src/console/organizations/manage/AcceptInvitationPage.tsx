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

import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@object-ui/components';
import { useAuth } from '@object-ui/auth';
import type { AuthInvitation } from '@object-ui/auth';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { Loader2, Building2, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { resolveOrgRoleLabel } from '../orgRoleLabel.js';
import { resolveOrgErrorMessage } from '../orgErrorMessage.js';
import { resolveRootUrl } from '../resolveHomeUrl.js';

type InvitationWithOrg = AuthInvitation & {
  organizationName?: string;
  organizationSlug?: string;
};

export function AcceptInvitationPage() {
  const { t } = useObjectTranslation();
  // Dates and numbers on this surface read the display locale; a bare
  // `toLocale*()` call used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { invitationId } = useParams<{ invitationId: string }>();
  const { isAuthenticated, isLoading: isAuthLoading, getInvitation, acceptInvitation, rejectInvitation, switchOrganization } =
    useAuth();

  const [invitation, setInvitation] = useState<InvitationWithOrg | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);

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
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate('/login?redirect=' + encodeURIComponent(location.pathname + location.search));
    }
  }, [isAuthenticated, isAuthLoading, navigate, location.pathname, location.search]);

  // Fetch invitation details
  useEffect(() => {
    if (!invitationId || !isAuthenticated) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getInvitation(invitationId)
      .then((inv) => {
        if (!cancelled) setInvitation(inv);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            resolveOrgErrorMessage(err, t, {
              key: 'organization.errors.invitationNotFound',
              defaultValue: 'This invitation no longer exists or has expired',
            }),
          );
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
      toast.success(t('organization.accept.accepted', { defaultValue: 'Invitation accepted' }));
      // The console ROOT, as a full-page navigation — NOT a router `navigate()`
      // and NOT `useHomePath()` (objectui#7373).
      //
      // ⭐ WHY THE HOOK IS WRONG *HERE*, while it is right at this card's nine
      // other sites: the app list this component can read belongs to the
      // organization the user is LEAVING. `switchOrganization` one line up only
      // updates auth state; `MetadataProvider` drops its whole cache when the
      // active org changes (objectui#4486) and refetches, and this line runs
      // before any of that can land. A declared-landing answer read here would
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
    } catch (err) {
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

  // Will redirect if not authenticated — show nothing in the meantime
  if (!isAuthenticated) return null;

  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm" data-testid="accept-invitation-page">
        {isLoading ? (
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
