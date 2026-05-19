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
import { GalleryVerticalEnd } from 'lucide-react';

export const Route = createFileRoute('/login')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string; fallback?: boolean } => {
    const r = search.redirect;
    const f = search.fallback;
    return {
      ...(typeof r === 'string' ? { redirect: r } : {}),
      // Escape hatch for the platform-SSO auto-redirect (see useEffect below).
      // Any truthy value (`?fallback=1`, `?fallback=true`) flips the page back
      // to the legacy local email/password form. Used by:
      //   - the SSO `errorCallbackURL` so a failed cloud bounce doesn't loop
      //   - operators needing local sign-in when the cloud IdP is unreachable
      ...(f === '1' || f === 'true' || f === true ? { fallback: true } : {}),
    };
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
  const { redirect, fallback } = Route.useSearch();
  const client = useClient() as any;
  const {
    session,
    user,
    refresh,
    organizations,
    organizationsLoading,
    organizationsFetched,
    setActiveOrganization,
  } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [autoSelectingOrg, setAutoSelectingOrg] = useState(false);
  // Platform-SSO auto-redirect state — see effect below. Starts `true` so the
  // page renders the redirect splash instead of the local form during the
  // initial config probe, eliminating the brief flash-of-form on
  // SSO-enabled deployments (Airtable-style UX).
  const [ssoAutoRedirecting, setSsoAutoRedirecting] = useState<boolean>(!fallback);

  // Platform-SSO auto-redirect.
  //
  // Cloud-managed projects expose the cloud control plane as a platform-SSO
  // identity provider (registered as the social provider id
  // `objectstack-cloud`). When present, presenting a *second* local login
  // form alongside the SSO button just confuses end users — they bounce
  // between two near-identical login screens during the OAuth dance.
  //
  // This effect detects "we're an RP for cloud platform SSO" by probing
  // `/api/v1/auth/config` for the `objectstack-cloud` provider, and if so
  // immediately triggers the OAuth flow — no local form is ever rendered.
  //
  // Skip conditions:
  //   - `?fallback=1` on the URL (operator escape hatch)
  //   - we're inside the IdP-side login (cloud's own /_account/login does
  //     NOT advertise `objectstack-cloud` as a provider — only RP projects do)
  //   - we're inside an in-flight oauth2 authorize hand-off
  //     (`?client_id=...&redirect_uri=...`) — that path is handled by the
  //     post-login useEffect further down, and re-triggering signIn here
  //     would clobber the original RP's request
  useEffect(() => {
    if (fallback) {
      setSsoAutoRedirecting(false);
      return;
    }
    if (user) {
      // Already authenticated — let the post-login effect handle navigation.
      setSsoAutoRedirecting(false);
      return;
    }
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('client_id') && sp.has('redirect_uri')) {
        setSsoAutoRedirecting(false);
        return;
      }
    }
    if (!client?.auth?.getConfig || !client?.auth?.signInWithProvider) {
      setSsoAutoRedirecting(false);
      return;
    }
    let cancelled = false;
    client.auth.getConfig()
      .then((res: any) => {
        if (cancelled) return;
        const list: Array<{ id: string; enabled: boolean; type?: string }> =
          res?.socialProviders ?? res?.data?.socialProviders ?? [];
        const cloud = list.find(
          (p) => p.enabled && p.id === 'objectstack-cloud',
        );
        if (!cloud) {
          setSsoAutoRedirecting(false);
          return;
        }
        const base = window.location.origin + import.meta.env.BASE_URL;
        const fallbackQs = new URLSearchParams({ fallback: '1' });
        if (redirect) fallbackQs.set('redirect', redirect);
        const errorUrl = `${base}login?${fallbackQs.toString()}`;
        const successUrl = isSafeRedirect(redirect)
          ? window.location.origin + resolveRedirect(redirect)
          : window.location.origin + '/';
        client.auth
          .signInWithProvider(cloud.id, {
            callbackURL: successUrl,
            errorCallbackURL: errorUrl,
            type: (cloud.type as any) ?? 'oidc',
          })
          .catch((err: unknown) => {
            console.warn('[LoginPage] platform SSO auto-redirect failed', err);
            if (!cancelled) setSsoAutoRedirecting(false);
          });
      })
      .catch((err: unknown) => {
        console.warn('[LoginPage] failed to probe auth config', err);
        if (!cancelled) setSsoAutoRedirecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, fallback, redirect, user]);

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
        // Brand-new account with no org yet — send to the org creation flow
        // instead of the org picker (which would be empty).
        navigate({ to: '/organizations/new' });
        return;
      }
      // Multiple orgs and no active selection — let the user choose.
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
      toast({
        title: t('auth.login.failed'),
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      {ssoAutoRedirecting ? (
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span>{t('auth.login.redirecting', { defaultValue: 'Redirecting to ObjectStack…' })}</span>
        </div>
      ) : (
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="#" className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GalleryVerticalEnd className="size-4" />
          </div>
          ObjectStack
        </a>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">{t('auth.login.title')}</CardTitle>
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
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
                  </Button>
                  <p className="text-center text-sm text-muted-foreground">
                    {t('auth.login.noAccount')}{' '}
                    <Link
                      to="/register"
                      search={redirect ? { redirect } : undefined}
                      className="underline underline-offset-4 hover:text-primary"
                    >
                      {t('auth.login.signUp')}
                    </Link>
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
          <p className="px-6 text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-primary">
            {t('legal.agreementPrefix')}{' '}
            <a href="#">{t('legal.termsOfService')}</a> {t('legal.and')} <a href="#">{t('legal.privacyPolicy')}</a>.
          </p>
        </div>
      </div>
      )}
    </div>
  );
}
