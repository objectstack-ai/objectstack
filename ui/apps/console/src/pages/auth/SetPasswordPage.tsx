/**
 * SetPasswordPage — standalone, shell-less "set a local password" surface.
 *
 * Reached when a user enters via SSO-as-owner on a per-environment runtime
 * and has no `credential` account yet. The cloud `auth-proxy-plugin`
 * `sso-exchange` mints a session cookie and redirects here with `?next=`.
 *
 * This is intentionally a sibling of LoginPage / ResetPasswordPage — rendered
 * OUTSIDE ProtectedRoute and wrapped in <AuthLayout> (no console shell), which
 * is the conventional shape for an auth surface. The session cookie is already
 * present, so `setInitialPassword()` authenticates against it; the server
 * (`POST /api/v1/auth/set-initial-password`) enforces the session and rejects
 * with 409 if a local password already exists.
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

/** Only same-origin app paths are safe redirect targets. */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  // Reject absolute URLs and protocol-relative (`//host`) targets.
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

export function SetPasswordPage() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user, isLoading, setInitialPassword } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(
        t('auth.setPassword.passwordsMismatch'),
      );
      return;
    }
    setSubmitting(true);
    try {
      await setInitialPassword(newPassword);
      toast.success(
        t('auth.setPassword.success'),
      );
      navigate(next);
    } catch (err) {
      toast.error(
        t('auth.setPassword.failed'),
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
            {t('auth.setPassword.title')}
          </CardTitle>
          <CardDescription>
            {t('auth.setPassword.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isLoading && !user ? (
            <p className="text-center text-sm text-muted-foreground">
              {t('auth.setPassword.noSession')}{' '}
              <Link
                to="/login"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('auth.setPassword.backToSignIn')}
              </Link>
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {user?.email ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="set-password-email">
                    {t('auth.setPassword.email')}
                  </Label>
                  <Input
                    id="set-password-email"
                    type="email"
                    autoComplete="username"
                    value={user.email}
                    disabled
                    className="bg-muted text-muted-foreground"
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">
                  {t('auth.setPassword.newPassword')}
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
                  {t('auth.setPassword.confirmPassword')}
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
                  ? t('auth.setPassword.submitting')
                  : t('auth.setPassword.submit')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export default SetPasswordPage;
