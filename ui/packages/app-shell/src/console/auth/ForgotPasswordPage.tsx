/**
 * Forgot Password Page for ObjectStack Console
 */

import { Link } from 'react-router-dom';
import { ForgotPasswordForm, type AuthLinkComponentProps } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { AuthPageLayout } from './AuthPageLayout.js';

const RouterLink = ({ href, className, children }: AuthLinkComponentProps) => (
  <Link to={href} className={className}>{children}</Link>
);

export function ForgotPasswordPage() {
  const { t } = useObjectTranslation();

  return (
    <AuthPageLayout>
      <ForgotPasswordForm
        loginUrl="/login"
        title={t('auth.forgotPassword.title')}
        description={t('auth.forgotPassword.description')}
        linkComponent={RouterLink}
        labels={{
          emailLabel: t('auth.forgotPassword.emailLabel'),
          emailPlaceholder: t('auth.forgotPassword.emailPlaceholder'),
          submitButton: t('auth.forgotPassword.submitButton'),
          submittingButton: t('auth.forgotPassword.submittingButton'),
          successTitle: t('auth.forgotPassword.successTitle'),
          successDescription: t('auth.forgotPassword.successDescription'),
          backToSignInText: t('auth.forgotPassword.backToSignInText'),
          rememberPasswordText: t('auth.forgotPassword.rememberPasswordText'),
          signInText: t('auth.forgotPassword.signInText'),
        }}
      />
    </AuthPageLayout>
  );
}
