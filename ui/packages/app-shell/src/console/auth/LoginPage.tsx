/**
 * Login Page for ObjectStack Console — exported as `DefaultLoginPage`.
 *
 * Offers the "Sign up" link only when the server would accept a sign-up from
 * this visitor: never under `emailPassword.disableSignUp === true`, and under
 * an audience posture closed to strangers (`invite_only`, the default) only
 * for an invitation redirect or a deployment with no owner yet. The decision
 * is `decideSignUpOffer` (`./signUpOffer`), the same one the console's own
 * login page calls (objectui#11691, objectui#11705). The link waits for the
 * config read to ANSWER: while it is pending, or after it failed, the posture
 * is unknown and nothing is offered (objectui#11806).
 *
 * When that read fails the page says the server cannot be reached, with a
 * Retry that reads it again, in place of the form (objectui#11806). The
 * sign-in request goes to the same server, so a live-looking form would only
 * have deferred that news to the submit.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  LoginForm,
  useAuth,
  AuthAlertIcon,
  AuthFormHeader,
  AuthSpinner,
  AUTH_PRIMARY_BUTTON_CLASS,
  type AuthLinkComponentProps,
  type AuthPublicConfig,
} from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { AuthPageLayout } from './AuthPageLayout.js';
import { signInRefusalMessages } from './signInRefusalMessages.js';
import { decideSignUpOffer, isInvitationRedirect, needsBootstrapProbe } from './signUpOffer.js';
import { useBootstrapStatus } from './bootstrapStatus.js';

const RouterLink = ({ href, className, children }: AuthLinkComponentProps) => (
  <Link to={href} className={className}>{children}</Link>
);

/**
 * In place of the form while the server cannot be reached (objectui#11806);
 * `./RegisterPage` shows the same panel. Built from `@object-ui/auth`'s own
 * form primitives so it sits where the form would, at the same width. Not
 * exported from the package entry.
 */
export function ServerUnreachable({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  const { t } = useObjectTranslation();
  return (
    <div
      data-testid="auth-server-unreachable"
      className="mx-auto flex w-full flex-col justify-center space-y-7 sm:w-[400px]"
    >
      <div role="alert">
        <AuthFormHeader
          icon={<AuthAlertIcon className="h-6 w-6 text-destructive" />}
          title={t('console.error.connectionFailed')}
          description={t('console.error.checkServer')}
        />
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className={AUTH_PRIMARY_BUTTON_CLASS}
      >
        {retrying ? <AuthSpinner /> : null}
        {retrying ? t('console.actions.retrying') : t('console.actions.retry')}
      </button>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect');
  const { t } = useObjectTranslation();
  const { user, getAuthConfig } = useAuth();

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
  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then(cfg => {
        if (cancelled) return;
        setAuthConfig(cfg ?? null);
        setConfigRead('known');
      })
      .catch(() => { if (!cancelled) setConfigRead('failed'); });
    return () => { cancelled = true; };
  }, [getAuthConfig, configReadAttempt]);
  const retryConfigRead = () => {
    setConfigRead('loading');
    setConfigReadAttempt(n => n + 1);
  };
  // A retry in flight keeps the unreachable state up (its button reads
  // "Retrying…") rather than flashing the form before the server has answered.
  const serverUnreachable =
    configRead === 'failed' || (configRead === 'loading' && configReadAttempt > 0);

  // objectui#11705 — whether this visitor is offered "Sign up". The bootstrap
  // probe runs only when the posture is closed to strangers and the visitor
  // did not come from an invitation; see `./signUpOffer`.
  const invitationRedirect = isInvitationRedirect(redirect);
  const bootstrap = useBootstrapStatus(!user && needsBootstrapProbe(authConfig, invitationRedirect));
  const signUpOffer = decideSignUpOffer(authConfig, { invitationRedirect, bootstrap });

  // Carry `?redirect=` into the sign-up link: it is how `/register` knows the
  // visitor came from an invitation.
  const registerUrl = redirect
    ? `/register?redirect=${encodeURIComponent(redirect)}`
    : '/register';

  if (serverUnreachable) {
    return (
      <AuthPageLayout>
        <ServerUnreachable retrying={configRead === 'loading'} onRetry={retryConfigRead} />
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout>
      <LoginForm
        onSuccess={() => navigate('/')}
        registerUrl={configRead === 'known' && signUpOffer === 'form' ? registerUrl : undefined}
        forgotPasswordUrl="/forgot-password"
        title={t('auth.login.title')}
        description={t('auth.login.description')}
        linkComponent={RouterLink}
        errorMessages={signInRefusalMessages(t)}
        labels={{
          emailLabel: t('auth.login.emailLabel'),
          emailPlaceholder: t('auth.login.emailPlaceholder'),
          passwordLabel: t('auth.login.passwordLabel'),
          passwordPlaceholder: t('auth.login.passwordPlaceholder'),
          // The password field's reveal toggle is LoginForm's own, so every
          // host shows it; its names come from the same pack (objectui#12600).
          // The header stays this page's: it keeps LoginForm's default header.
          showPasswordText: t('auth.login.showPasswordText'),
          hidePasswordText: t('auth.login.hidePasswordText'),
          forgotPasswordText: t('auth.login.forgotPasswordText'),
          submitButton: t('auth.login.submitButton'),
          submittingButton: t('auth.login.submittingButton'),
          noAccountText: t('auth.login.noAccountText'),
          signUpText: t('auth.login.signUpText'),
          socialButton: t('auth.login.socialButton'),
          orText: t('auth.login.orText'),
          // Phone sign-in, then SSO (objectui#12762): every `LoginFormLabels`
          // member is passed, from the same `auth.login.*` keys the console's
          // own login page reads. A pin enumerates the interface and holds
          // both login pages to that.
          emailOrPhoneLabel: t('auth.login.emailOrPhoneLabel'),
          emailOrPhonePlaceholder: t('auth.login.emailOrPhonePlaceholder'),
          phoneLabel: t('auth.login.phoneLabel'),
          phonePlaceholder: t('auth.login.phonePlaceholder'),
          otpCodeLabel: t('auth.login.otpCodeLabel'),
          otpCodePlaceholder: t('auth.login.otpCodePlaceholder'),
          sendOtpButton: t('auth.login.sendOtpButton'),
          // `{seconds}` is `LoginForm`'s own single-brace hole, which
          // i18next's `{{…}}` interpolation leaves alone.
          resendOtpCountdownText: t('auth.login.resendOtpCountdownText'),
          usePhoneOtpText: t('auth.login.usePhoneOtpText'),
          usePasswordSignInText: t('auth.login.usePasswordSignInText'),
          ssoButton: t('auth.login.ssoButton'),
          ssoOnlyDescription: t('auth.login.ssoOnlyDescription'),
          usePasswordText: t('auth.login.usePasswordText'),
          backToSsoText: t('auth.login.backToSsoText'),
        }}
      />
    </AuthPageLayout>
  );
}
