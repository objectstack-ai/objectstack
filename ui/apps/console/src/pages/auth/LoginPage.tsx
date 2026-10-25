/**
 * LoginPage — Console-hosted sign-in surface.
 *
 * Ported from `framework/apps/account/src/routes/login.tsx`. Wraps
 * `<LoginForm>` from `@object-ui/auth` so the visual + a11y behaviour
 * stays in sync with every other auth surface, then layers Console-
 * specific concerns on top:
 *
 *  - SSO hand-off banner when `client_id` + `redirect_uri` are present
 *    in the query string (better-auth's oauth-provider redirects the
 *    unauthenticated user here before issuing a code).
 *  - Post-login orchestration: replay the original `/oauth2/authorize`
 *    request, auto-select the user's single organization, or honour a
 *    safe `?redirect=` target.
 *  - Offers the "Sign up" link only when the server would accept a sign-up
 *    from this visitor: never under `emailPassword.disableSignUp === true`,
 *    and under an audience posture closed to strangers (`invite_only`) only
 *    for an invitation redirect or a deployment with no owner yet — see
 *    `decideSignUpOffer` in `@object-ui/app-shell`, the one decision this page
 *    shares with the package's exported `DefaultLoginPage` (objectui#11691,
 *    objectui#11705). The link waits for the config read to ANSWER: while it
 *    is pending, or after it failed, the posture is unknown and nothing is
 *    offered (objectui#11806).
 *  - Says so when the server cannot be reached: a failed config read replaces
 *    the form with "Cannot connect to server" and a Retry that reads it again
 *    (objectui#11806). The sign-in request goes to the same server, so a
 *    live-looking form would only have deferred that news to the submit.
 *
 * Layout (objectui#12600): one 400 px column — brand mark, the card, a footer.
 * The card carries this page's own two-line header, so `<LoginForm>` renders
 * with `hideHeader`. On a dev instance the card's last row offers a one-click
 * sign-in as the seeded admin; the footer holds the locale switch and the
 * legal links the server's auth config serves.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  useAuth,
  LoginForm,
  AuthErrorBanner,
  AuthAlertIcon,
  AuthFormHeader,
  AuthSpinner,
  AUTH_PRIMARY_BUTTON_CLASS,
} from '@object-ui/auth';
import type { AuthPublicConfig } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { Card } from '@object-ui/components';
import {
  signInRefusalMessages,
  decideSignUpOffer,
  isInvitationRedirect,
  needsBootstrapProbe,
  useBootstrapStatus,
  LocaleSwitcher,
} from '@object-ui/app-shell';
import { AuthLayout } from './AuthLayout';
import { followOauthAuthorize } from './followAuthorize';
// Was module-private here; lifted to a shared module so `SetupPage` (whose
// first-run exits went without it) and `RegisterPage` (which had copied it)
// share ONE implementation — objectui#4181. Behaviour here is unchanged.
import { withConsoleBase } from '../../utils/consoleBase';

/** Restrict the post-login redirect to same-origin paths. */
function isSafeRedirect(target: string | null): target is string {
  return !!target && target.startsWith('/') && !target.startsWith('//');
}

/** The dev-seeded admin `/auth/config` reports on a development instance. */
interface DevSeedAdmin {
  email: string;
  password?: string;
}

/**
 * Accept a legal-link URL from the server only as an absolute http(s) URL or a
 * same-origin path. Anything else (a `javascript:` URL, a protocol-relative
 * `//host`, a non-string) renders no link.
 */
function legalHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const href = value.trim();
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  return undefined;
}

/**
 * The legal links the server's public auth config serves: `features.termsUrl`
 * and `features.privacyUrl`, which the spec lists among its non-flag keys
 * (`PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS`) and the runtime defaults to its own
 * public pages, or omits when an operator blanks them. `AuthPublicConfig` does
 * not declare the two keys, so they are read here by name; nothing is
 * rendered for a key the server did not send.
 */
function readLegalLinks(cfg: AuthPublicConfig | null): { privacyUrl?: string; termsUrl?: string } {
  const features = cfg?.features as { privacyUrl?: unknown; termsUrl?: unknown } | undefined;
  return { privacyUrl: legalHref(features?.privacyUrl), termsUrl: legalHref(features?.termsUrl) };
}

function RouterLink(props: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <Link to={props.href} className={props.className}>
      {props.children}
    </Link>
  );
}

export function LoginPage() {
  const { t } = useObjectTranslation();
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

  // The public auth config and where its read stands (objectui#11806):
  // `loading` until `getAuthConfig()` settles, `failed` once it rejected — the
  // auth client has already retried by then — and `known` once the server
  // answered. `authConfig` stays `null` until `known`; `decideSignUpOffer`
  // answers `null` as "offer the link", so the page consults it only once the
  // read is `known`. `configReadAttempt` counts Retry presses, and re-runs the
  // read below.
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
  // Dev-only seeded admin (15.1 third-party eval): the runtime seeds an admin
  // on an empty dev DB, but nothing on this page said so — new users clicked
  // "Sign up" and landed in an empty non-admin workspace. The server reports
  // the credentials via /auth/config `devSeedAdmin` ONLY in development while
  // the account still carries the default password, so production can never
  // render the row. The password is held here to submit, never rendered
  // (objectui#12600): the row signs in with it, it does not print it.
  const [devSeedAdmin, setDevSeedAdmin] = useState<DevSeedAdmin | null>(null);
  const [autoSelectingOrg, setAutoSelectingOrg] = useState(false);
  // The OAuth hand-off fetch must fire at most once even though the post-login
  // effect re-runs as org state settles (it navigates away on success).
  const ssoHandoffStartedRef = useRef(false);

  // `isLoading` from useAuth() is overloaded: it is true both during the
  // initial session check AND during every in-flight signIn. The full-page
  // spinner below should only cover the initial bootstrap (and post-login
  // orchestration when `user` is set) — never an in-flight signIn. Latch once
  // the first session check resolves so a failed login does not unmount
  // <LoginForm>, which would otherwise discard the error banner it holds in
  // local state and silently reset the fields.
  const [hasBootstrapped, setHasBootstrapped] = useState(false);
  useLayoutEffect(() => {
    if (!isLoading) setHasBootstrapped(true);
  }, [isLoading]);

  // objectui#11691 — whether this visitor is offered "Sign up". The bootstrap
  // probe runs only when the posture is closed to strangers and the visitor
  // did not come from an invitation; see app-shell's `decideSignUpOffer`.
  const invitationRedirect = isInvitationRedirect(redirect);
  const bootstrap = useBootstrapStatus(
    hasBootstrapped && !user && needsBootstrapProbe(authConfig, invitationRedirect),
  );
  const signUpOffer = decideSignUpOffer(authConfig, { invitationRedirect, bootstrap });

  // Detect SSO hand-off so we can surface the relying-party host.
  const ssoTarget = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const sp = new URLSearchParams(window.location.search);
    const redirectUri = sp.get('redirect_uri');
    if (!sp.has('client_id') || !redirectUri) return null;
    try {
      return new URL(redirectUri).host;
    } catch {
      return null;
    }
  }, []);

  // Surface an OAuth/SSO callback failure. better-auth redirects a failed
  // callback (expired hand-off, replayed `state`, IdP error, …) to its
  // error URL with `?error=<code>` — the runtime points that at this login
  // page (framework AuthManager `onAPIError.errorURL`). Without this banner
  // the user who just SUCCEEDED at typing their password on the IdP lands
  // back on a login form with zero explanation (objectui#2458 item 1).
  const callbackError = useMemo(() => {
    const code = params.get('error');
    if (!code) return null;
    const description = params.get('error_description');
    return { code, description };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read public auth config to know whether sign-up is offered and whether
  // the dev-seeded admin credentials should be surfaced — once on mount, and
  // again on each Retry after a failed read.
  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((cfg) => {
        if (cancelled) return;
        setAuthConfig(cfg ?? null);
        setConfigRead('known');
        const seed = (cfg as { devSeedAdmin?: { email?: unknown; password?: unknown } } | null)
          ?.devSeedAdmin;
        setDevSeedAdmin(
          seed && typeof seed.email === 'string'
            ? {
                email: seed.email,
                password: typeof seed.password === 'string' ? seed.password : undefined,
              }
            : null,
        );
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

  // Post-login orchestration — fires once we observe an authenticated user.
  useEffect(() => {
    if (!user) return;

    // 1. OAuth provider hand-off (see file header). Replay the signed
    //    authorize params so the IdP issues the code, then FOLLOW the redirect
    //    it hands back. better-auth's oauth-provider answers a same-origin
    //    fetch with `200 { redirect: true, url }` (NOT a 302), so a plain
    //    navigation to /authorize would just render that JSON and strand the
    //    user on this spinner — we must fetch + navigate ourselves.
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

    // 2. Auto-select a single org so post-login redirect doesn't bounce
    //    off `RequireOrganization`.
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
        // No org yet — let the Console pick (CreateWorkspaceDialog or the
        // org list, depending on `multiOrgEnabled`). Send to root.
        window.location.assign(withConsoleBase(isSafeRedirect(redirect) ? redirect : '/'));
        return;
      }
      // Multiple orgs, no active selection — surface the picker.
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

  if ((isLoading && !hasBootstrapped) || user) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span>{t('auth.login.signingIn', { defaultValue: 'Signing you in…' })}</span>
        </div>
      </AuthLayout>
    );
  }

  // Build search-aware sign-up URL so the redirect param survives the
  // bounce from /login → /register → /login.
  const registerUrl = redirect
    ? `/register?redirect=${encodeURIComponent(redirect)}`
    : '/register';
  const legalLinks = readLegalLinks(authConfig);

  return (
    <AuthLayout formWidth="base">
      <div className="flex flex-col gap-5">
        {callbackError ? (
          <AuthErrorBanner
            message={
              t('auth.login.errors.oauthCallbackFailed', {
                defaultValue:
                  'Single sign-on could not be completed — the sign-in link expired or was already used. Please try again.',
              }) + (callbackError.description ? ` (${callbackError.description})` : ` (${callbackError.code})`)
            }
          />
        ) : null}
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
        <Card
          data-testid="login-card"
          className="rounded-xl border-border/60 px-7 pb-5 pt-7 shadow-sm shadow-primary/5"
        >
          {serverUnreachable ? (
            <ServerUnreachable
              retrying={configRead === 'loading'}
              onRetry={retryConfigRead}
            />
          ) : (
            <>
              <div className="mb-5">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  {t('auth.login.welcomeTitle', { defaultValue: 'Welcome back' })}
                </h1>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {t('auth.login.welcomeDescription', {
                    defaultValue: 'Sign in to continue your work',
                  })}
                </p>
              </div>
              <LoginFormCard
                registerUrl={
                  configRead === 'known' && signUpOffer === 'form' ? registerUrl : undefined
                }
                redirect={redirect}
              />
              {devSeedAdmin ? <DevAdminRow seed={devSeedAdmin} /> : null}
            </>
          )}
        </Card>
        <LoginFooter privacyUrl={legalLinks.privacyUrl} termsUrl={legalLinks.termsUrl} />
      </div>
    </AuthLayout>
  );
}

const WrenchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3.5 w-3.5 text-muted-foreground"
    aria-hidden="true"
  >
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

/**
 * The card's last row on a dev instance (objectui#12600): "Local development
 * instance" at the left and a chip that signs in as the seeded admin at the
 * right, through the same `signIn` the form submits with. Success hands over to
 * the page's post-login orchestration (the `user` effect above), exactly as a
 * typed sign-in does.
 *
 * ⛔ The password is never rendered — not as text, not in an attribute, not in
 * a hidden element. Only the email is shown, as the chip's tooltip. A seed
 * reported without a password gets the row with the email and no chip.
 */
function DevAdminRow({ seed }: { seed: DevSeedAdmin }) {
  const { t } = useObjectTranslation();
  const { signIn } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInAsDevAdmin = async () => {
    if (pending || !seed.password) return;
    setError(null);
    setPending(true);
    try {
      await signIn(seed.email, seed.password);
      // Signed in: `user` is set and the page swaps to its post-login state.
    } catch (err) {
      const authError = err instanceof Error ? err : new Error(String(err));
      const code = (authError as Error & { code?: string }).code;
      setError((code && signInRefusalMessages(t)[code]) || authError.message);
      setPending(false);
    }
  };

  return (
    <div data-testid="dev-admin-hint" className="mt-5 border-t border-dashed border-border pt-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
          {t('auth.login.devAdminHint.title', { defaultValue: 'Local development instance' })}
        </span>
        {seed.password ? (
          <button
            type="button"
            data-testid="dev-admin-signin"
            title={seed.email}
            onClick={signInAsDevAdmin}
            disabled={pending}
            aria-busy={pending}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-60"
          >
            {pending ? <AuthSpinner /> : <WrenchIcon />}
            {t('auth.login.devAdminHint.signIn', { defaultValue: 'Sign in as dev admin' })}
          </button>
        ) : (
          <span className="truncate font-mono text-xs text-muted-foreground">{seed.email}</span>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Under the card: the locale switch at the left; at the right the privacy and
 * terms links, each only when the server's auth config serves its URL.
 *
 * No version or environment pill: the runtime config the preview badge reads
 * (`GET /api/v1/runtime/config`) carries the platform stage and no product
 * version or environment label, so there is nothing to print (objectui#12600).
 */
function LoginFooter({ privacyUrl, termsUrl }: { privacyUrl?: string; termsUrl?: string }) {
  const { t } = useObjectTranslation();
  const linkClass =
    'underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:underline';
  return (
    <div
      data-testid="auth-footer"
      className="flex min-h-8 items-center justify-between gap-3 px-1 text-xs text-muted-foreground"
    >
      <div className="flex items-center">
        <LocaleSwitcher />
      </div>
      {privacyUrl || termsUrl ? (
        <span className="inline-flex items-center gap-2.5">
          {privacyUrl ? (
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t('auth.login.footer.privacy', { defaultValue: 'Privacy' })}
            </a>
          ) : null}
          {termsUrl ? (
            <a href={termsUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t('auth.login.footer.terms', { defaultValue: 'Terms' })}
            </a>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * In place of the form while the server cannot be reached (objectui#11806);
 * `RegisterPage` shows the same panel. Built from `@object-ui/auth`'s own form
 * primitives so it sits where `<LoginForm>` would, at the same width and in
 * the same visual language.
 */
export function ServerUnreachable({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  const { t } = useObjectTranslation();
  return (
    <div
      data-testid="auth-server-unreachable"
      className="mx-auto flex w-full flex-col justify-center space-y-7 sm:max-w-[400px]"
    >
      <div role="alert">
        <AuthFormHeader
          icon={<AuthAlertIcon className="h-6 w-6 text-destructive" />}
          title={t('console.error.connectionFailed', { defaultValue: 'Cannot connect to server' })}
          description={t('console.error.checkServer', {
            defaultValue: 'Please check your network connection or that the backend is running.',
          })}
        />
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className={AUTH_PRIMARY_BUTTON_CLASS}
      >
        {retrying ? <AuthSpinner /> : null}
        {retrying
          ? t('console.actions.retrying', { defaultValue: 'Retrying…' })
          : t('console.actions.retry', { defaultValue: 'Retry' })}
      </button>
    </div>
  );
}

function LoginFormCard({
  registerUrl,
  redirect,
}: {
  registerUrl?: string;
  redirect: string | null;
}) {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  // LoginForm doesn't expose the submitted email, so we capture it here
  // to forward into the verify-email-prompt redirect. A ref is used instead
  // of state so capturing each keystroke doesn't re-render this subtree
  // (which would otherwise recompute every translated label and re-render
  // <LoginForm> on every character typed into the email field).
  const lastEmailRef = useRef('');

  useEffect(() => {
    const handler = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target?.id === 'login-email') lastEmailRef.current = target.value;
    };
    document.addEventListener('input', handler, true);
    return () => document.removeEventListener('input', handler, true);
  }, []);

  return (
    <LoginForm
      onError={(err) => {
        const message = err.message || '';
        const code = (err as Error & { code?: string }).code;
        const lower = message.toLowerCase();
        const isEmailUnverified =
          code === 'EMAIL_NOT_VERIFIED' ||
          (lower.includes('email') &&
            (lower.includes('verif') || lower.includes('not verified')));
        if (isEmailUnverified) {
          const sp = new URLSearchParams();
          if (lastEmailRef.current) sp.set('email', lastEmailRef.current);
          if (redirect) sp.set('redirect', redirect);
          navigate(`/verify-email-prompt?${sp.toString()}`);
        }
      }}
      // The card above draws this page's own header (objectui#12600).
      hideHeader
      registerUrl={registerUrl}
      forgotPasswordUrl="/forgot-password"
      linkComponent={RouterLink}
      // Server refusal `code` → localized end-user text: the one map both
      // login pages pass, owned by `@object-ui/app-shell` (objectui#11058).
      errorMessages={signInRefusalMessages(t)}
      labels={{
        emailLabel: t('auth.login.emailLabel', { defaultValue: 'Email' }),
        emailPlaceholder: t('auth.login.emailPlaceholder', { defaultValue: 'name@example.com' }),
        emailOrPhoneLabel: t('auth.login.emailOrPhoneLabel', { defaultValue: 'Email or phone number' }),
        emailOrPhonePlaceholder: t('auth.login.emailOrPhonePlaceholder', {
          defaultValue: 'name@example.com or +1 555 000 0000',
        }),
        passwordLabel: t('auth.login.passwordLabel', { defaultValue: 'Password' }),
        passwordPlaceholder: t('auth.login.passwordPlaceholder', { defaultValue: 'Enter your password' }),
        showPasswordText: t('auth.login.showPasswordText', { defaultValue: 'Show password' }),
        hidePasswordText: t('auth.login.hidePasswordText', { defaultValue: 'Hide password' }),
        forgotPasswordText: t('auth.login.forgotPasswordText', { defaultValue: 'Forgot password?' }),
        submitButton: t('auth.login.submitButton', { defaultValue: 'Sign In' }),
        submittingButton: t('auth.login.submittingButton', { defaultValue: 'Signing in…' }),
        noAccountText: t('auth.login.noAccountText', { defaultValue: "Don't have an account?" }),
        signUpText: t('auth.login.signUpText', { defaultValue: 'Sign up' }),
        phoneLabel: t('auth.login.phoneLabel', { defaultValue: 'Phone number' }),
        phonePlaceholder: t('auth.login.phonePlaceholder', { defaultValue: '+1 555 000 0000' }),
        otpCodeLabel: t('auth.login.otpCodeLabel', { defaultValue: 'Verification code' }),
        otpCodePlaceholder: t('auth.login.otpCodePlaceholder', { defaultValue: '6-digit code' }),
        sendOtpButton: t('auth.login.sendOtpButton', { defaultValue: 'Get code' }),
        // `{seconds}` (single braces) is the component's own hole — kept out
        // of i18next's `{{…}}` interpolation on purpose.
        resendOtpCountdownText: t('auth.login.resendOtpCountdownText', {
          defaultValue: 'Resend in {seconds}s',
        }),
        usePhoneOtpText: t('auth.login.usePhoneOtpText', {
          defaultValue: 'Sign in with verification code',
        }),
        usePasswordSignInText: t('auth.login.usePasswordSignInText', {
          defaultValue: 'Sign in with password instead',
        }),
        // `{provider}` is `SocialSignInButtons`' own single-brace hole — kept
        // out of i18next's `{{…}}` interpolation on purpose.
        socialButton: t('auth.login.socialButton', { defaultValue: 'Continue with {provider}' }),
        orText: t('auth.login.orText', { defaultValue: 'or continue with email' }),
        // The SSO button, and under SSO-only mode the line above the federated
        // buttons, the break-glass link and the link back (objectui#12762).
        // This block passes every `LoginFormLabels` member; a pin enumerates
        // the interface and holds both login pages to that.
        ssoButton: t('auth.login.ssoButton', { defaultValue: 'Sign in with SSO' }),
        ssoOnlyDescription: t('auth.login.ssoOnlyDescription', {
          defaultValue: "Sign in with your organization's single sign-on",
        }),
        usePasswordText: t('auth.login.usePasswordText', { defaultValue: 'Use a password instead' }),
        backToSsoText: t('auth.login.backToSsoText', { defaultValue: 'Back to single sign-on' }),
      }}
    />
  );
}

export default LoginPage;

