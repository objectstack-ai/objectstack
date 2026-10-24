/**
 * VerifyEmailPage — Console-hosted email-verification landing page.
 *
 * Ported from `framework/apps/account/src/routes/verify-email.tsx`. A user
 * who opens `/verify-email?token=…` has `?token=` consumed on mount via
 * `GET /api/v1/auth/verify-email?token=…` (better-auth's standard endpoint,
 * served as GET only). `useAuth()` doesn't expose a `verifyEmail()` so we
 * call the REST endpoint directly.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@object-ui/components';
import { AuthLayout } from './AuthLayout';

const AUTH_BASE = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;

export function VerifyEmailPage() {
  const { t } = useObjectTranslation();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage(
        t('auth.verifyEmail.missingToken', {
          defaultValue: 'Verification link is missing a token.',
        }),
      );
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // better-auth serves verify-email as `GET ?token=` only; a POST
        // answers 404 (objectui#11633). Sent WITHOUT `callbackURL` the route
        // answers JSON instead of a 302: `{ status: true, user }` once the
        // token verifies (again on a repeat), and a 401 `{ code, message }`
        // for a garbage or expired token. So the SPA keeps the post-verify
        // UX, and only that JSON receipt counts as success: a 2xx that is
        // not it (an HTML page, a followed redirect's landing) is an error.
        const query = new URLSearchParams({ token });
        const res = await fetch(`${AUTH_BASE}/verify-email?${query}`, {
          method: 'GET',
          credentials: 'include',
        });
        const data = (await res.json().catch(() => null)) as {
          status?: unknown;
          message?: unknown;
        } | null;
        if (!res.ok || data?.status !== true) {
          const serverMessage =
            !res.ok && typeof data?.message === 'string' ? data.message : '';
          throw new Error(
            serverMessage || (res.ok ? '' : `Verification failed: ${res.status}`),
          );
        }
        if (!cancelled) setStatus('success');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setMessage(
            (err as Error).message ||
              t('auth.verifyEmail.errorDescription', {
                defaultValue: 'Verification failed. Please request a new link.',
              }),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, t]);

  return (
    <AuthLayout>
      <Card className="border-border/60 shadow-sm shadow-primary/5 backdrop-blur supports-[backdrop-filter]:bg-card/95">
        {status === 'loading' && (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-xl tracking-tight">
                {t('auth.verifyEmail.verifyingTitle', { defaultValue: 'Verifying…' })}
              </CardTitle>
              <CardDescription>
                {t('auth.verifyEmail.verifyingDescription', {
                  defaultValue: 'Hang tight while we confirm your email.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center py-6">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-primary" />
            </CardContent>
          </>
        )}
        {status === 'success' && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/30">
                <CheckCircle2 className="size-6" />
              </div>
              <CardTitle className="text-xl tracking-tight">
                {t('auth.verifyEmail.successTitle', { defaultValue: 'Email verified' })}
              </CardTitle>
              <CardDescription>
                {t('auth.verifyEmail.successDescription', {
                  defaultValue: 'Your email is confirmed. You can now sign in.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Link
                to="/login"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('auth.verifyEmail.signInLink', { defaultValue: 'Go to sign in' })}
              </Link>
            </CardContent>
          </>
        )}
        {status === 'error' && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive ring-1 ring-destructive/30">
                <XCircle className="size-6" />
              </div>
              <CardTitle className="text-xl tracking-tight">
                {t('auth.verifyEmail.errorTitle', { defaultValue: 'Verification failed' })}
              </CardTitle>
              <CardDescription>
                {message ||
                  t('auth.verifyEmail.errorDescription', {
                    defaultValue: 'Verification failed. Please request a new link.',
                  })}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Link
                to="/login"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('auth.verifyEmail.backToSignIn', { defaultValue: 'Back to sign in' })}
              </Link>
            </CardContent>
          </>
        )}
      </Card>
    </AuthLayout>
  );
}

export default VerifyEmailPage;
