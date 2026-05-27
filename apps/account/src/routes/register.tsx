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

export const Route = createFileRoute('/register')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const r = search.redirect;
    return typeof r === 'string' ? { redirect: r } : {};
  },
  component: RegisterPage,
});

function isSafeRedirect(target: string | undefined): target is string {
  return !!target && target.startsWith('/') && !target.startsWith('//');
}

function resolveRedirect(target: string): string {
  if (target.startsWith('/_')) return target;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base + target;
}

function RegisterPage() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const client = useClient() as any;
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

  // Defense-in-depth for the `OS_DISABLE_SIGNUP=true` /
  // `emailAndPassword.disableSignUp` toggle: bounce direct hits to
  // /register back to /login the moment we know signup is off. The
  // server still 403s the submission as the ultimate gate.
  useEffect(() => {
    if (features?.signUpDisabled === true) {
      navigate({ to: '/login', search: redirect ? { redirect } : {}, replace: true });
    }
  }, [features?.signUpDisabled, navigate, redirect]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [autoSelectingOrg, setAutoSelectingOrg] = useState(false);

  useEffect(() => {
    if (!user) return;

    // OAuth-provider hand-off: see apps/account/src/routes/login.tsx for the
    // full rationale. When the user landed on /register from /oauth2/authorize
    // we must resume the OAuth flow by replaying the signed authorize params
    // instead of dropping them into the Studio default landing.
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('client_id') && sp.has('redirect_uri')) {
        window.location.assign(`/api/v1/auth/oauth2/authorize${window.location.search}`);
        return;
      }
    }

    // If the freshly-signed-up user already has organizations (e.g. they
    // were the first user and got bound to the default org, or they
    // accepted an invitation), make sure one is active before navigating
    // away. Without this the redirect target's `RequireOrganization`
    // guard would bounce the user to `/_console/organizations`.
    if (!session?.activeOrganizationId) {
      // Wait until the org list has been fetched at least once before
      // deciding — otherwise we'd race the post-signup org provisioning.
      if (!organizationsFetched || organizationsLoading || autoSelectingOrg) return;
      if (organizations.length === 1) {
        setAutoSelectingOrg(true);
        setActiveOrganization(organizations[0].id)
          .catch(() => undefined)
          .finally(() => setAutoSelectingOrg(false));
        return;
      }
      if (organizations.length > 1) {
        navigate({ to: '/organizations' });
        return;
      }
      // No orgs at all — the user needs to create one.
      navigate({ to: '/organizations/new' });
      return;
    }

    if (autoSelectingOrg) return;

    if (isSafeRedirect(redirect)) {
      window.location.assign(resolveRedirect(redirect));
      return;
    }
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
      await client.auth.register({ name, email, password });
      
      // If email verification is enabled, registration succeeds but the user
      // can't sign in until they verify. Check if we got a "needs verification"
      // signal and redirect to the verification prompt page.
      try {
        await refresh();
      } catch (refreshErr) {
        const errorMessage = (refreshErr as Error).message;
        if (
          errorMessage.includes('email') &&
          (errorMessage.toLowerCase().includes('verif') ||
           errorMessage.toLowerCase().includes('not verified'))
        ) {
          // Redirect to verification prompt page
          navigate({
            to: '/verify-email-prompt',
            search: { email, redirect },
          });
          return;
        }
        throw refreshErr;
      }
      
      toast({ title: t('auth.register.successToast') });
      // Navigation is handled by the auth-redirect effect above once the
      // session updates: it sends users with an active org to the platform
      // home, otherwise to /organizations/new.
    } catch (err) {
      const errorMessage = (err as Error).message;
      
      // Also check if registration itself returned a verification requirement
      if (
        errorMessage.includes('email') &&
        (errorMessage.toLowerCase().includes('verif') ||
         errorMessage.toLowerCase().includes('sent'))
      ) {
        // Registration succeeded, verification email sent
        navigate({
          to: '/verify-email-prompt',
          search: { email, redirect },
        });
        return;
      }
      
      toast({
        title: t('auth.register.failed'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      {sessionLoading || !!user ? (
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span>
            {user
              ? t('auth.register.signingIn', { defaultValue: 'Setting up your account…' })
              : t('auth.login.redirecting', { defaultValue: 'Loading…' })}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <Card className="border-border/60 shadow-sm shadow-primary/5 backdrop-blur supports-[backdrop-filter]:bg-card/95">
            <CardHeader className="text-center">
              <CardTitle className="text-xl tracking-tight">{t('auth.register.title')}</CardTitle>
              <CardDescription>{t('auth.register.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <div className="flex flex-col gap-4">
                  <SocialSignInButtons mode="sign-up" redirect={redirect} />
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="name">{t('auth.nameLabel')}</Label>
                    <Input
                      id="name"
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
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
                    <Label htmlFor="password">{t('auth.passwordLabel')}</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={submitting}
                  >
                    {submitting ? t('auth.register.submitting') : t('auth.register.submit')}
                  </Button>
                  <p className="text-center text-sm text-muted-foreground">
                    {t('auth.register.haveAccount')}{' '}
                    <Link
                      to="/login"
                      search={redirect ? { redirect } : undefined}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t('auth.register.signIn')}
                    </Link>
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
          <LegalLinks termsUrl={features?.termsUrl} privacyUrl={features?.privacyUrl} />
        </div>
      )}
    </AuthShell>
  );
}
