/**
 * ForgotPasswordPage — Console-hosted "send me a reset link" surface.
 *
 * Ported from `framework/apps/account/src/routes/forgot-password.tsx`.
 * Uses `@object-ui/auth`'s `ForgotPasswordForm` for the email input and
 * server call so the UX matches LoginForm / RegisterForm exactly.
 */

import { Link } from 'react-router-dom';
import { ForgotPasswordForm } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { Card } from '@object-ui/components';
import { AuthLayout } from './AuthLayout';

function RouterLink(props: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <Link to={props.href} className={props.className}>
      {props.children}
    </Link>
  );
}

export function ForgotPasswordPage() {
  const { t } = useObjectTranslation();

  return (
    <AuthLayout formWidth="md">
      <Card className="border-border/60 px-4 py-8 shadow-sm shadow-primary/5 backdrop-blur supports-[backdrop-filter]:bg-card/95">
      <ForgotPasswordForm
        loginUrl="/login"
        linkComponent={RouterLink}
        title={t('auth.forgotPassword.title', { defaultValue: 'Reset your password' })}
        description={t('auth.forgotPassword.description', {
          defaultValue: "Enter your email address and we'll send you a link to reset your password",
        })}
        labels={{
          emailLabel: t('auth.forgotPassword.emailLabel', { defaultValue: 'Email' }),
          emailPlaceholder: t('auth.forgotPassword.emailPlaceholder', { defaultValue: 'name@example.com' }),
          submitButton: t('auth.forgotPassword.submitButton', { defaultValue: 'Send Reset Link' }),
          submittingButton: t('auth.forgotPassword.submittingButton', {
            defaultValue: 'Sending…',
          }),
          successTitle: t('auth.forgotPassword.successTitle', {
            defaultValue: 'Check your email',
          }),
          successDescription: t('auth.forgotPassword.successDescription', {
            defaultValue: "We've sent a password reset link to {email}. Please check your inbox.",
          }),
          backToSignInText: t('auth.forgotPassword.backToSignInText', {
            defaultValue: 'Back to sign in',
          }),
          phoneLabel: t('auth.forgotPassword.phoneLabel', { defaultValue: 'Phone number' }),
          phonePlaceholder: t('auth.forgotPassword.phonePlaceholder', { defaultValue: '+1 555 000 0000' }),
          otpCodeLabel: t('auth.forgotPassword.otpCodeLabel', { defaultValue: 'Verification code' }),
          otpCodePlaceholder: t('auth.forgotPassword.otpCodePlaceholder', { defaultValue: '6-digit code' }),
          sendOtpButton: t('auth.forgotPassword.sendOtpButton', { defaultValue: 'Get code' }),
          // `{seconds}` (single braces) is the component's own hole — kept out
          // of i18next's `{{…}}` interpolation on purpose.
          resendOtpCountdownText: t('auth.forgotPassword.resendOtpCountdownText', {
            defaultValue: 'Resend in {seconds}s',
          }),
          newPasswordLabel: t('auth.forgotPassword.newPasswordLabel', { defaultValue: 'New password' }),
          newPasswordPlaceholder: t('auth.forgotPassword.newPasswordPlaceholder', {
            defaultValue: 'Enter a new password',
          }),
          resetButton: t('auth.forgotPassword.resetButton', { defaultValue: 'Reset Password' }),
          usePhoneResetText: t('auth.forgotPassword.usePhoneResetText', {
            defaultValue: 'Reset via SMS code',
          }),
          useEmailResetText: t('auth.forgotPassword.useEmailResetText', {
            defaultValue: 'Reset via email instead',
          }),
          phoneSuccessTitle: t('auth.forgotPassword.phoneSuccessTitle', {
            defaultValue: 'Password reset',
          }),
          phoneSuccessDescription: t('auth.forgotPassword.phoneSuccessDescription', {
            defaultValue: 'Your password has been reset. You can now sign in with your new password.',
          }),
          rememberPasswordText: t('auth.forgotPassword.rememberPasswordText', {
            defaultValue: 'Remember your password?',
          }),
          signInText: t('auth.forgotPassword.signInText', { defaultValue: 'Sign in' }),
        }}
      />
      </Card>
    </AuthLayout>
  );
}

export default ForgotPasswordPage;

