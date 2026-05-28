// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useClient } from '@objectstack/client-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useSession } from '@/hooks/useSession';
import { SocialSignInButtons } from '@/components/auth/social-sign-in-buttons';
import { AuthShell } from '@/components/auth/auth-shell';
import { LegalLinks } from '@/components/auth/legal-links';
import { TransitionOverlay } from '@/components/auth/transition-overlay';

export const Route = createFileRoute('/login')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string } => {
    const r = search.redirect;
    return typeof r === 'string' ? { redirect: r } : {};
  },
  component: LoginPage,
});

function isSafeRedirect(target: string | undefined): target is string {
  return !!target && target.startsWith('/') && !target.startsWith('//');
}

/**
 * Resolve a redirect target to an absolute path on the current origin.
 *
 * - Paths beginning with `/_` (e.g. `/_studio/...`, `/_account/...`) are
 *   already absolute SPA mounts — return them verbatim.
 * - Otherwise the target is an Account-internal SPA path (`/account`,
 *   `/organizations/...`) and gets prefixed with the Account SPA base URL.
 */
function resolveRedirect(target: string): string {
  if (target.startsWith('/_')) return target;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base + target;
}

function LoginPage() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const client = useClient() as any;

  // SSO-handoff banner.
  //
  // When the user lands on this login form via a `/oauth2/authorize`
  // bounce from a relying-party project (better-auth redirects the
  // unauthenticated user here, preserving `client_id` & `redirect_uri`
  // in the query string), the page looks visually identical to the
  // project's own login form they just left — both are this same SPA.
  // Without context, a slow network makes "Continue with ObjectStack"
  // appear broken: click, wait, see a login form again.
  //
  // We surface the relying-party hostname so the user knows where
  // they're being signed in to continue to.
  let ssoTarget: string | null = null;
  if (typeof window !== 'undefined') {
    const sp = new URLSearchParams(window.location.search);
    const redirectUri = sp.get('redirect_uri');
    if (sp.has('client_id') && redirectUri) {
      try {
        ssoTarget = new URL(redirectUri).host;
      } catch {
        ssoTarget = null;
      }
    }
  }
  const {
    session,
    user,
    loading: sessionLoading,
    refresh,
    organizations,
    organizationsLoading,
    organizationsFetched,
    setActiveOrganization,
    features,
  } = useSession();
  const signUpDisabled = features?.signUpDisabled === true;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [autoSelectingOrg, setAutoSelectingOrg] = useState(false);

  useEffect(() => {
    if (!user) return;

    // OAuth-provider hand-off: when the user landed on /login because
    // better-auth's oauth-provider redirected them here from /oauth2/authorize
    // (unauthenticated user starting an SSO flow), the original authorize query
    // params — including `client_id`, `redirect_uri`, the signed `sig`, etc. —
    // are preserved on the current URL. After login succeeds we must resume
    // the OAuth flow by sending the same params back to /oauth2/authorize so
    // the IdP can issue the code and 302 the user back to the RP.
    //
    // Without this, the user ends up on the Studio dashboard (the post-login
    // default) and the RP never sees the callback, so the SSO flow stalls.
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('client_id') && sp.has('redirect_uri')) {
        window.location.assign(`/api/v1/auth/oauth2/authorize${window.location.search}`);
        return;
      }
    }

    // If the user has organizations but no active one, auto-select the first
    // org before navigating away. Otherwise consumers like the Console's
    // `RequireOrganization` guard would bounce the user from the redirect
    // target (e.g. `/_console/home`) to `/_console/organizations`, making
    // the post-login redirect look like a back-and-forth jump.
    if (!session?.activeOrganizationId) {
      // Wait for the org list to be fetched at least once before deciding.
      if (!organizationsFetched || organizationsLoading || autoSelectingOrg) return;
      if (organizations.length === 1) {
        setAutoSelectingOrg(true);
        setActiveOrganization(organizations[0].id)
          .catch(() => undefined)
          .finally(() => setAutoSelectingOrg(false));
        return;
      }
      if (organizations.length === 0) {
        // - Single-tenant: the platform auto-binds users on register or the
        //   deployment is misconfigured. Either way, sending the user to
        //   `/organizations/new` (wizard is gated off) or `/organizations`
        //   (empty list) is wrong — hand off to home / the original redirect
        //   and let the platform decide what to show.
        // - Multi-tenant: surface the create-org wizard.
        if (features?.multiOrgEnabled === false) {
          if (isSafeRedirect(redirect)) {
            window.location.assign(resolveRedirect(redirect));
          } else {
            window.location.assign('/');
          }
          return;
        }
        navigate({ to: '/organizations/new' });
        return;
      }
      // Multiple orgs and no active selection.
      // - Single-tenant: shouldn't happen (one org per user) but if it does,
      //   auto-select the first to avoid bouncing into the gated picker.
      // - Multi-tenant: let the user choose.
      if (features?.multiOrgEnabled === false) {
        setAutoSelectingOrg(true);
        setActiveOrganization(organizations[0].id)
          .catch(() => undefined)
          .finally(() => setAutoSelectingOrg(false));
        return;
      }
      navigate({ to: '/organizations' });
      return;
    }

    if (autoSelectingOrg) return;

    if (isSafeRedirect(redirect)) {
      window.location.assign(resolveRedirect(redirect));
      return;
    }
    // Default landing after sign-in: the platform home, not the Account
    // profile page. Users can reach `/account` from the top-bar menu.
    window.location.assign('/');
  }, [
    user,
    session,
    navigate,
    redirect,
    organizations,
    organizationsLoading,
    organizationsFetched,
    autoSelectingOrg,
    setActiveOrganization,
    features?.multiOrgEnabled,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client?.auth) return;
    setSubmitting(true);
    try {
      await client.auth.login({ type: 'email', email, password });
      await refresh();
      toast({ title: t('auth.login.welcomeToast') });
    } catch (err) {
      const errorMessage = (err as Error).message;
      const errorCode = (err as Error & { code?: string }).code;

      // better-auth returns `EMAIL_NOT_VERIFIED` (HTTP 403) when sign-in is
      // blocked by `requireEmailVerification`. Prefer the structured code;
      // fall back to message inspection for older builds.
      const lowerMessage = (errorMessage || '').toLowerCase();
      const isEmailUnverified =
        errorCode === 'EMAIL_NOT_VERIFIED' ||
        (lowerMessage.includes('email') &&
          (lowerMessage.includes('verif') || lowerMessage.includes('not verified')));
      if (isEmailUnverified) {
        navigate({
          to: '/verify-email-prompt',
          search: { email, redirect },
        });
        return;
      }
      
      toast({
        title: t('auth.login.failed'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (sessionLoading || !!user) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span>
            {t('auth.login.signingIn', { defaultValue: 'Signing you in…' })}
          </span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      {submitting ? (
        <TransitionOverlay
          message={t('auth.login.signingIn', { defaultValue: 'Signing you in…' })}
        />
      ) : null}
      <div className="flex flex-col gap-6">
        {ssoTarget ? (
          <div
            role="status"
            className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground"
          >
            <span className="mt-0.5 inline-block size-2 shrink-0 rounded-full bg-primary" />
            <span>
              {t('auth.login.ssoHandoff', {
                target: ssoTarget,
                defaultValue: `Continue to ${ssoTarget}`,
              })}
            </span>
          </div>
        ) : null}
        <Card className="border-border/60 shadow-sm shadow-primary/5 backdrop-blur supports-[backdrop-filter]:bg-card/95">
              <CardHeader className="text-center">
                <CardTitle className="text-xl tracking-tight">{t('auth.login.title')}</CardTitle>
                <CardDescription>{t('auth.login.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit}>
                  <div className="flex flex-col gap-4">
                    <SocialSignInButtons mode="sign-in" redirect={redirect} />
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="email">{t('auth.emailLabel')}</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder={t('auth.emailPlaceholder')}
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center">
                        <Label htmlFor="password">{t('auth.passwordLabel')}</Label>
                        <Link
                          to="/forgot-password"
                          className="ml-auto text-sm underline-offset-4 hover:underline"
                        >
                          {t('auth.login.forgotPassword')}
                        </Link>
                      </div>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={submitting}
                    >
                      {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
                    </Button>
                    {signUpDisabled ? null : (
                      <p className="text-center text-sm text-muted-foreground">
                        {t('auth.login.noAccount')}{' '}
                        <Link
                          to="/register"
                          search={redirect ? { redirect } : undefined}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {t('auth.login.signUp')}
                        </Link>
                      </p>
                    )}
                  </div>
                </form>
              </CardContent>
        </Card>
        <LegalLinks termsUrl={features?.termsUrl} privacyUrl={features?.privacyUrl} />
      </div>
    </AuthShell>
  );
}
