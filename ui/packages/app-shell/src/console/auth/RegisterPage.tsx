/**
 * Register Page for ObjectStack Console — exported as `DefaultRegisterPage`.
 *
 * What this visitor is offered is `decideSignUpOffer` (`./signUpOffer`), the
 * same decision the console's own register page calls (objectui#11691,
 * objectui#11705):
 *
 *  - `emailPassword.disableSignUp === true` bounces to `/login`
 *    (defense-in-depth; the server-side gate is the source of truth);
 *  - under an audience posture closed to strangers (`invite_only`, the
 *    default) the form is shown only to an invitation redirect or on a
 *    deployment with no owner yet; anyone else is told that registration is
 *    by invitation BEFORE the form, instead of having the finished form
 *    refused with `SELF_REGISTRATION_CLOSED`.
 *
 * A signed-in visitor is not who that decision is about (objectui#11714): the
 * page offers nothing a signed-in user can use, so once the first session
 * check answers with a user, the page sends them where it sends a visitor
 * after a successful sign-up (`/`) — the console's own register page does the
 * same — and never renders the form, the notice, or an empty layout for them.
 *
 * Nothing is offered until the config read ANSWERS (objectui#11806): while it
 * is pending the page renders an empty layout, and when it fails it shows the
 * same "Cannot connect to server" panel with Retry as `./LoginPage`, in place
 * of the form. The sign-up request goes to the same server, so a live-looking
 * form would only have deferred that news to the submit.
 */

import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  RegisterForm,
  AuthFormHeader,
  AUTH_LINK_CLASS,
  useAuth,
  type AuthLinkComponentProps,
  type AuthPublicConfig,
} from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { AuthPageLayout } from './AuthPageLayout.js';
import { signUpRefusalMessages } from './signUpRefusalMessages.js';
import { decideSignUpOffer, isInvitationRedirect, needsBootstrapProbe } from './signUpOffer.js';
import { useBootstrapStatus } from './bootstrapStatus.js';
import { ServerUnreachable } from './LoginPage.js';

const RouterLink = ({ href, className, children }: AuthLinkComponentProps) => (
  <Link to={href} className={className}>{children}</Link>
);

export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect');
  const { t } = useObjectTranslation();
  const { user, isLoading, getAuthConfig, sendVerificationEmail } = useAuth();

  // objectui#11714 — whether the first session check has answered, so the
  // page knows who it is talking to before it offers anything. `isLoading` is
  // also raised by every `signUp` in flight, so it is latched the first time it
  // clears: a sign-up in flight must not unmount the form and the refusal it
  // holds (the console's register page latches it the same way). Latched
  // while rendering, so the render that first sees the answer already uses it.
  const [sessionChecked, setSessionChecked] = useState(!isLoading);
  if (!isLoading && !sessionChecked) setSessionChecked(true);

  // The public auth config and where its read stands (objectui#11806), as on
  // `./LoginPage`: `loading` until `getAuthConfig()` settles, `failed` once it
  // rejected — the auth client has already retried by then — and `known` once
  // the server answered. `authConfig` stays `null` until `known`, and the offer
  // is consulted only once the read is `known`; nothing is rendered before
  // then, so the form never flashes. `configReadAttempt` counts Retry presses,
  // and re-runs the read below.
  const [authConfig, setAuthConfig] = useState<AuthPublicConfig | null>(null);
  const [configRead, setConfigRead] = useState<'loading' | 'failed' | 'known'>('loading');
  const [configReadAttempt, setConfigReadAttempt] = useState(0);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);

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

  // objectui#11705 — the offer reads `disableSignUp` AND the audience posture;
  // the bootstrap probe runs only when the posture is closed to strangers and
  // the visitor did not come from an invitation. See `./signUpOffer`. It is
  // asked only for a visitor known to be signed out (objectui#11714).
  const invitationRedirect = isInvitationRedirect(redirect);
  const signedOut = sessionChecked && !user;
  const bootstrap = useBootstrapStatus(signedOut && needsBootstrapProbe(authConfig, invitationRedirect));
  const signUpOffer = decideSignUpOffer(authConfig, { invitationRedirect, bootstrap });

  // Sign-up switched off — bounce a signed-out visitor to /login, keeping
  // `?redirect=`. A signed-in one is moved on below instead, never to /login.
  useEffect(() => {
    if (!signedOut || signUpOffer !== 'closed') return;
    const search = redirect ? `?redirect=${encodeURIComponent(redirect)}` : '';
    navigate(`/login${search}`, { replace: true });
  }, [signedOut, signUpOffer, navigate, redirect]);

  // objectui#11714 — signed in: go where a successful sign-up goes, without
  // waiting for the config or the probe. `<Navigate>` renders nothing.
  if (user) return <Navigate to="/" replace />;

  if (signedOut && serverUnreachable) {
    return (
      <AuthPageLayout>
        <ServerUnreachable retrying={configRead === 'loading'} onRetry={retryConfigRead} />
      </AuthPageLayout>
    );
  }

  if (!signedOut || configRead !== 'known' || signUpOffer === 'closed' || signUpOffer === 'pending') {
    // Render nothing until the offer is known — prevents a flash of the form.
    return <AuthPageLayout>{null}</AuthPageLayout>;
  }

  const loginUrl = redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';

  // Registration here is by invitation only. Say so BEFORE the form; the
  // sentence is the `SELF_REGISTRATION_CLOSED` refusal's own copy, the same
  // key the console's register page shows.
  if (signUpOffer === 'by-invitation') {
    return (
      <AuthPageLayout>
        <div
          data-testid="register-by-invitation"
          className="mx-auto flex w-full flex-col justify-center space-y-7 sm:w-[400px]"
        >
          <AuthFormHeader
            title={t('auth.register.title')}
            description={t('auth.register.errors.selfRegistrationClosed')}
          />
          <p className="px-8 text-center text-sm text-muted-foreground">
            {t('auth.register.hasAccountText')}{' '}
            <Link to={loginUrl} className={AUTH_LINK_CLASS}>
              {t('auth.register.signInText')}
            </Link>
          </p>
        </div>
      </AuthPageLayout>
    );
  }

  if (pendingEmail) {
    const handleResend = async () => {
      setResendState('sending');
      setResendError(null);
      try {
        await sendVerificationEmail(pendingEmail);
        setResendState('sent');
      } catch (err) {
        setResendState('error');
        setResendError(err instanceof Error ? err.message : String(err));
      }
    };
    return (
      <AuthPageLayout>
        <div className="mx-auto flex w-full flex-col justify-center space-y-7 sm:w-[400px]">
          <div className="flex flex-col items-center space-y-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('auth.register.verifyInbox.title', { defaultValue: 'Check your inbox' })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('auth.register.verifyInbox.description', { email: pendingEmail, defaultValue: "We've sent a verification link to {{email}}. Click the link to activate your account." })}
            </p>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === 'sending'}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {resendState === 'sending'
                ? t('auth.register.verifyInbox.resending', { defaultValue: 'Sending…' })
                : t('auth.register.verifyInbox.resend', { defaultValue: 'Resend verification email' })}
            </button>
            {resendState === 'sent' && (
              <p className="text-center text-sm text-emerald-600 dark:text-emerald-400">
                {t('auth.register.verifyInbox.resent', { defaultValue: 'Verification email sent.' })}
              </p>
            )}
            {resendState === 'error' && resendError && (
              <p className="text-center text-sm text-destructive">{resendError}</p>
            )}
          </div>

          <p className="px-8 text-center text-sm text-muted-foreground">
            <Link to="/login" className="font-medium text-primary hover:underline">
              {t('auth.register.verifyInbox.backToSignIn', { defaultValue: 'Back to sign in' })}
            </Link>
          </p>
        </div>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout>
      <RegisterForm
        onSuccess={() => navigate('/')}
        onVerificationRequired={(email) => setPendingEmail(email)}
        loginUrl={loginUrl}
        title={t('auth.register.title')}
        description={t('auth.register.description')}
        linkComponent={RouterLink}
        errorMessages={signUpRefusalMessages(t)}
        labels={{
          nameLabel: t('auth.register.nameLabel'),
          namePlaceholder: t('auth.register.namePlaceholder'),
          emailLabel: t('auth.register.emailLabel'),
          emailPlaceholder: t('auth.register.emailPlaceholder'),
          passwordLabel: t('auth.register.passwordLabel'),
          passwordPlaceholder: t('auth.register.passwordPlaceholder'),
          confirmPasswordLabel: t('auth.register.confirmPasswordLabel'),
          confirmPasswordPlaceholder: t('auth.register.confirmPasswordPlaceholder'),
          passwordMismatchError: t('auth.register.passwordMismatchError'),
          passwordTooShortError: t('auth.register.passwordTooShortError'),
          submitButton: t('auth.register.submitButton'),
          submittingButton: t('auth.register.submittingButton'),
          hasAccountText: t('auth.register.hasAccountText'),
          signInText: t('auth.register.signInText'),
          socialButton: t('auth.register.socialButton'),
          orText: t('auth.register.orText'),
        }}
      />
    </AuthPageLayout>
  );
}
