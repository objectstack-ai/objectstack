/**
 * ResetPasswordPage — Console-hosted "set a new password" surface.
 *
 * Ported from `framework/apps/account/src/routes/reset-password.tsx`.
 * The reset token is carried in `?token=` (better-auth's standard
 * format). On submit we call `useAuth().resetPassword(token, password)`
 * and route to `/login` on success.
 */

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@object-ui/components';
import { AuthLayout } from './AuthLayout';

export function ResetPasswordPage() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const { resetPassword } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(
        t('auth.resetPassword.passwordsMismatch', {
          defaultValue: 'Passwords do not match',
        }),
      );
      return;
    }
    if (!token) {
      toast.error(
        t('auth.resetPassword.missingToken', {
          defaultValue: 'Reset link is missing or expired',
        }),
      );
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      toast.success(
        t('auth.resetPassword.success', { defaultValue: 'Password updated' }),
      );
      navigate('/login');
    } catch (err) {
      toast.error(
        t('auth.resetPassword.failed', { defaultValue: 'Reset failed' }),
        { description: (err as Error).message },
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <Card className="border-border/60 shadow-sm shadow-primary/5 backdrop-blur supports-[backdrop-filter]:bg-card/95">
        <CardHeader className="text-center">
          <CardTitle className="text-xl tracking-tight">
            {t('auth.resetPassword.title', { defaultValue: 'Set a new password' })}
          </CardTitle>
          <CardDescription>
            {t('auth.resetPassword.description', {
              defaultValue: 'Choose a password you have not used before.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <p className="text-center text-sm text-muted-foreground">
              {t('auth.resetPassword.invalidToken', {
                defaultValue: 'This reset link is invalid or has expired.',
              })}{' '}
              <Link
                to="/forgot-password"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('auth.resetPassword.requestNewLink', {
                  defaultValue: 'Request a new link',
                })}
              </Link>
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">
                  {t('auth.resetPassword.newPassword', { defaultValue: 'New password' })}
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password">
                  {t('auth.resetPassword.confirmPassword', {
                    defaultValue: 'Confirm password',
                  })}
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting
                  ? t('auth.resetPassword.submitting', { defaultValue: 'Updating…' })
                  : t('auth.resetPassword.submit', { defaultValue: 'Update password' })}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export default ResetPasswordPage;
