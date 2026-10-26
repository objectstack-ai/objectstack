/**
 * RegisterPage — Console-hosted sign-up surface.
 *
 * Ported from `framework/apps/account/src/routes/register.tsx`. Wraps
 * `<RegisterForm>` from `@object-ui/auth` and layers Console-specific
 * concerns:
 *
 *  - Bounces to `/login` if `emailPassword.disableSignUp === true`
 *    (defense-in-depth; the server-side gate is the source of truth).
 *  - Under an audience posture closed to strangers (`invite_only`), shows
 *    the form only to an invitation redirect or on a deployment with no
 *    owner yet, and otherwise explains that registration is by invitation
 *    BEFORE the form — see `decideSignUpOffer` in `@object-ui/app-shell`, the
 *    one decision this page shares with the package's exported
 *    `DefaultRegisterPage` (objectui#11691, objectui#11705).
 *  - Offers nothing until the config read ANSWERS (objectui#11806): while it
 *    is pending the page shows its spinner, and when it fails it shows the
 *    same "Cannot connect to server" panel with Retry as `/login`, in place
 *    of the form. The sign-up request goes to the same server, so a
 *    live-looking form would only have deferred that news to the submit.
 *  - Routes to `/verify-email-prompt` when the server requires email
 *    verification before sign-in, and carries `?redirect=` into the
 *    verification mail's link so it survives the inbox (objectui#10893).
 *  - Replays an `/oauth2/authorize` query string when the user landed
 *    here mid-SSO so the IdP can continue the flow post-signup.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, RegisterForm, AuthFormHeader, AUTH_LINK_CLASS } from '@object-ui/auth';
import type { AuthPublicConfig } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { Card } from '@object-ui/components';
import {
  signUpRefusalMessages,
  decideSignUpOffer,
  isInvitationRedirect,
  needsBootstrapProbe,
  useBootstrapStatus,
} from '@object-ui/app-shell';
import { AuthLayout } from './AuthLayout';
import { followOauthAuthorize } from './followAuthorize';
// Was a second module-private copy of LoginPage's helper; both now share one
// implementation — objectui#4181. Behaviour here is unchanged.
import { withConsoleBase, withConsoleBaseRootRelative } from '../../utils/consoleBase';
import { ServerUnreachable } from './LoginPage';

function isSafeRedirect(target: string | null): target is string {
  return !!target && target.startsWith('/') && !target.startsWith('//');
}

function RouterLink(props: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <Link to={props.href} className={props.className}>
      {props.children}
    </Link>
  );
}

export function RegisterPage() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect');
  const {
    user,
    isLoading,
    organizations,
    isOrganizationsLoading,
    activeOrganization,
    switchOrganization,
    getAuthConfig,
  } = useAuth();

  // The public auth config and where its read stands (objectui#11806), as on
  // `/login`: `loading` until `getAuthConfig()` settles, `failed` once it
  // rejected — the auth client has already retried by then — and `known` once
  // the server answered. `authConfig` stays `null` until `known`, and the
  // offer is consulted only once the read is `known`. `configReadAttempt`
  // counts Retry presses, and re-runs the read below.
  const [authConfig, setAuthConfig] = useState<AuthPublicConfig | null>(null);
  const [configRead, setConfigRead] = useState<'loading' | 'failed' | 'known'>('loading');
  const [configReadAttempt, setConfigReadAttempt] = useState(0);
  const retryConfigRead = () => {
    setConfigRead('loading');
    setConfigReadAttempt((n) => n + 1);
  };
  // A retry in flight keeps the unreachable state up (its button reads
  // "Retrying…") rather than flashing the form before the server has answered.
  const serverUnreachable =
    configRead === 'failed' || (configRead === 'loading' && configReadAttempt > 0);
  const [autoSelectingOrg, setAutoSelectingOrg] = useState(false);
  // Fire the OAuth hand-off fetch at most once (see LoginPage).
  const ssoHandoffStartedRef = useRef(false);

  // See LoginPage: `isLoading` is overloaded (initial session check + every
  // in-flight signUp). Latch once the first check resolves so a failed
  // registration does not unmount <RegisterForm> and discard the error banner
  // it holds in local state.
  const [hasBootstrapped, setHasBootstrapped] = useState(false);
  useLayoutEffect(() => {
    if (!isLoading) setHasBootstrapped(true);
  }, [isLoading]);

  // Probe public auth config — what this visitor is offered follows from it.
  // Once on mount, and again on each Retry after a failed read.
  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((cfg) => {
        if (cancelled) return;
        setAuthConfig(cfg ?? null);
        setConfigRead('known');
      })
      .catch(() => {
        // The server did not answer (the auth client retried first): say so
        // instead of drawing a form whose submit goes to the same server.
        if (!cancelled) setConfigRead('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthConfig, configReadAttempt]);

  // objectui#11691 — the offer reads `disableSignUp` AND the audience posture;
  // the bootstrap probe runs only when the posture is closed to strangers and
  // the visitor did not come from an invitation. See app-shell's
  // `decideSignUpOffer`.
  const invitationRedirect = isInvitationRedirect(redirect);
  const bootstrap = useBootstrapStatus(
    configRead === 'known' &&
      hasBootstrapped &&
      !user &&
      needsBootstrapProbe(authConfig, invitationRedirect),
  );
  const signUpOffer = decideSignUpOffer(authConfig, { invitationRedirect, bootstrap });

  // Sign-up switched off — bounce to /login.
  useEffect(() => {
    if (signUpOffer !== 'closed') return;
    const search = redirect ? `?redirect=${encodeURIComponent(redirect)}` : '';
    navigate(`/login${search}`, { replace: true });
  }, [signUpOffer, navigate, redirect]);

  // Post-signup orchestration mirrors LoginPage exactly.
  useEffect(() => {
    if (!user) return;

    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('client_id') && sp.has('redirect_uri')) {
        if (!ssoHandoffStartedRef.current) {
          ssoHandoffStartedRef.current = true;
          followOauthAuthorize(window.location.search);
        }
        return;
      }
    }

    if (!activeOrganization) {
      if (isOrganizationsLoading || autoSelectingOrg) return;
      if (organizations.length === 1) {
        setAutoSelectingOrg(true);
        switchOrganization(organizations[0].id)
          .catch(() => undefined)
          .finally(() => setAutoSelectingOrg(false));
        return;
      }
      if (organizations.length === 0) {
        window.location.assign(withConsoleBase(isSafeRedirect(redirect) ? redirect : '/'));
        return;
      }
      window.location.assign(withConsoleBase('/organizations'));
      return;
    }

    if (autoSelectingOrg) return;
    window.location.assign(withConsoleBase(isSafeRedirect(redirect) ? redirect : '/'));
  }, [
    user,
    activeOrganization,
    organizations,
    isOrganizationsLoading,
    autoSelectingOrg,
    redirect,
    switchOrganization,
  ]);

  // The first session check has answered and nobody is signed in: the page is
  // talking to a visitor, so a failed config read is theirs to see.
  const awaitingSession = (isLoading && !hasBootstrapped) || !!user;
  if (!awaitingSession && serverUnreachable) {
    return (
      <AuthLayout formWidth="md">
        <Card className="border-border/60 px-4 py-8 shadow-sm shadow-primary/5 backdrop-blur supports-[backdrop-filter]:bg-card/95">
          <ServerUnreachable retrying={configRead === 'loading'} onRetry={retryConfigRead} />
        </Card>
      </AuthLayout>
    );
  }

  if (
    awaitingSession ||
    configRead !== 'known' ||
    signUpOffer === 'closed' ||
    signUpOffer === 'pending'
  ) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </AuthLayout>
    );
  }

  const loginUrl = redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';
  // objectui#10893 — when the server gates sign-in on email verification, the
  // mail's link is the only road back, so it must carry `?redirect=` (e.g. the
  // invitation the user registered from). Only a safe in-app target is
  // forwarded; anything else would be refused by the server and fail sign-up.
  const verificationCallbackURL = isSafeRedirect(redirect)
    ? withConsoleBaseRootRelative(redirect)
    : undefined;

  // objectui#11691 — registration here is by invitation only. Say so BEFORE
  // the form instead of refusing the finished form with
  // `SELF_REGISTRATION_CLOSED`; the sentence is that refusal's own copy.
  if (signUpOffer === 'by-invitation') {
    return (
      <AuthLayout formWidth="md">
        <Card className="border-border/60 px-4 py-8 shadow-sm shadow-primary/5 backdrop-blur supports-[backdrop-filter]:bg-card/95">
          <div
            data-testid="register-by-invitation"
            className="mx-auto flex w-full flex-col justify-center space-y-7 sm:w-[400px]"
          >
            <AuthFormHeader
              title={t('auth.register.title', { defaultValue: 'Create an account' })}
              description={t('auth.register.errors.selfRegistrationClosed', {
                defaultValue:
                  'Self-registration is not open on this system. Ask an administrator for an invitation.',
              })}
            />
            <p className="px-8 text-center text-sm text-muted-foreground">
              {t('auth.register.hasAccountText', { defaultValue: 'Already have an account?' })}{' '}
              <Link to={loginUrl} className={AUTH_LINK_CLASS}>
                {t('auth.register.signInText', { defaultValue: 'Sign in' })}
              </Link>
            </p>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout formWidth="md">
      <Card className="border-border/60 px-4 py-8 shadow-sm shadow-primary/5 backdrop-blur supports-[backdrop-filter]:bg-card/95">
      <RegisterForm
        title={t('auth.register.title', { defaultValue: 'Create an account' })}
        description={t('auth.register.description', {
          defaultValue: 'Create your account to start building.',
        })}
        loginUrl={loginUrl}
        verificationCallbackURL={verificationCallbackURL}
        linkComponent={RouterLink}
        // Server refusal `code` → localized end-user text: the one map both
        // register pages pass, owned by `@object-ui/app-shell` (objectui#11030).
        errorMessages={signUpRefusalMessages(t)}
        onVerificationRequired={(email) => {
          const sp = new URLSearchParams();
          sp.set('email', email);
          if (redirect) sp.set('redirect', redirect);
          navigate(`/verify-email-prompt?${sp.toString()}`, { replace: true });
        }}
        labels={{
          nameLabel: t('auth.register.nameLabel', { defaultValue: 'Name' }),
          namePlaceholder: t('auth.register.namePlaceholder', { defaultValue: 'John Doe' }),
          emailLabel: t('auth.register.emailLabel', { defaultValue: 'Email' }),
          emailPlaceholder: t('auth.register.emailPlaceholder', { defaultValue: 'name@example.com' }),
          passwordLabel: t('auth.register.passwordLabel', { defaultValue: 'Password' }),
          passwordPlaceholder: t('auth.register.passwordPlaceholder', {
            defaultValue: 'Create a password (min. 8 characters)',
          }),
          confirmPasswordLabel: t('auth.register.confirmPasswordLabel', {
            defaultValue: 'Confirm Password',
          }),
          confirmPasswordPlaceholder: t('auth.register.confirmPasswordPlaceholder', {
            defaultValue: 'Confirm your password',
          }),
          passwordMismatchError: t('auth.register.passwordMismatchError', {
            defaultValue: 'Passwords do not match',
          }),
          passwordTooShortError: t('auth.register.passwordTooShortError', {
            defaultValue: 'Password must be at least 8 characters',
          }),
          submitButton: t('auth.register.submitButton', { defaultValue: 'Create Account' }),
          submittingButton: t('auth.register.submittingButton', { defaultValue: 'Creating account…' }),
          hasAccountText: t('auth.register.hasAccountText', { defaultValue: 'Already have an account?' }),
          signInText: t('auth.register.signInText', { defaultValue: 'Sign in' }),
          // `{provider}` is `SocialSignInButtons`' own single-brace hole — kept
          // out of i18next's `{{…}}` interpolation on purpose.
          socialButton: t('auth.register.socialButton', { defaultValue: 'Sign up with {provider}' }),
          orText: t('auth.register.orText', { defaultValue: 'or continue with email' }),
        }}
      />
      </Card>
    </AuthLayout>
  );
}

export default RegisterPage;
