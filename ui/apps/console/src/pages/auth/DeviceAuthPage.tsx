/**
 * DeviceAuthPage — /auth/device input + approval surface.
 *
 * Ported from `framework/apps/account/src/routes/auth.device.tsx`.
 * Renders the user-code entry box (when missing from the URL) or the
 * approve/deny prompt once the user is signed in. Talks to better-auth's
 * device-authorization endpoints directly via fetch.
 */

import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { getProductName, getLogoUrl } from '@object-ui/app-shell';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@object-ui/components';

const AUTH_BASE = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="#" className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground overflow-hidden">
            {getLogoUrl() ? (
              <img src={getLogoUrl()} alt={getProductName()} className="h-full w-full object-contain" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
          </div>
          {getProductName()}
        </a>
        <div className="flex flex-col gap-6">{children}</div>
      </div>
    </div>
  );
}

export function DeviceAuthPage() {
  const { t } = useObjectTranslation();
  const location = useLocation();
  const [params] = useSearchParams();
  const code = params.get('user_code') ?? params.get('code') ?? '';
  // Device context appended by the requesting runtime's bind/start (ADR
  // runtime-identity-binding §2.3). Display-only informed consent — the
  // warning copy below is what carries the anti-phishing weight.
  const runtimeName = params.get('runtime_name') ?? '';
  const runtimeVersion = params.get('runtime_version') ?? '';
  const { user, isLoading, getAuthConfig } = useAuth();
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  const [denying, setDenying] = useState(false);
  const [approved, setApproved] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  // Whether the server actually wires the deviceAuthorization plugin
  // (framework#2874 / objectui#2513). `null` while the public config is still
  // loading. The `/device*` endpoints only exist when this is on, so we gate
  // the whole page on it instead of rendering a form that would only fail on
  // submit with "not enabled".
  const [deviceAuthEnabled, setDeviceAuthEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    getAuthConfig()
      .then((config) => {
        if (active) setDeviceAuthEnabled(config?.features?.deviceAuthorization === true);
      })
      .catch(() => {
        // Config unreachable → don't hard-block a page that may legitimately
        // work; fall back to the prior behavior and let the endpoints surface
        // the real error.
        if (active) setDeviceAuthEnabled(true);
      });
    return () => {
      active = false;
    };
  }, [getAuthConfig]);

  if (!code) {
    return (
      <PageShell>
        <Card>
          <CardHeader className="text-center">
            <CardTitle>
              {t('auth.device.invalidTitle', { defaultValue: 'Invalid device link' })}
            </CardTitle>
            <CardDescription>
              {t('auth.device.invalidDescription', {
                defaultValue: 'No device code was provided in the URL.',
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  // Gate on the deviceAuthorization capability before anything else that
  // requires it (login round-trip, claim/approve): if the plugin is off the
  // endpoints 404, so tell the user plainly instead of advertising a form
  // that can't work (framework#2874 / objectui#2513).
  if (deviceAuthEnabled === false) {
    return (
      <PageShell>
        <Card>
          <CardHeader className="text-center">
            <CardTitle>
              {t('auth.device.disabledTitle', { defaultValue: 'Device authorization not enabled' })}
            </CardTitle>
            <CardDescription>
              {t('auth.device.disabledDescription', {
                defaultValue:
                  'This deployment does not have device authorization enabled, so this device cannot be approved here.',
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  if (isLoading || deviceAuthEnabled === null) {
    return (
      <PageShell>
        <Card>
          <CardHeader className="text-center">
            <CardDescription>
              {t('auth.device.loading', { defaultValue: 'Loading…' })}
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  if (!user) {
    // Preserve the FULL query string through the login round-trip — it
    // carries the device context (runtime_name / runtime_version) the
    // approval card displays, not just the user code.
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(`/auth/device${location.search}`)}`}
        replace
      />
    );
  }

  if (approved) {
    return (
      <PageShell>
        <Card>
          <CardHeader className="text-center">
            <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-green-500" />
            <CardTitle>
              {t('auth.device.approvedTitle', { defaultValue: 'Device authorized' })}
            </CardTitle>
            <CardDescription>
              {t('auth.device.approvedDescription', {
                defaultValue: 'You can return to the device — it should sign in shortly.',
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  if (denied) {
    return (
      <PageShell>
        <Card>
          <CardHeader className="text-center">
            <CardTitle>
              {t('auth.device.deniedTitle', { defaultValue: 'Access denied' })}
            </CardTitle>
            <CardDescription>
              {t('auth.device.deniedDescription', {
                defaultValue: 'The device will not be granted access.',
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  // better-auth's device-authorization plugin requires the verifying
  // session to CLAIM the code (GET /device?user_code=…) before it will
  // accept approve/deny — without it both return 400 "not been claimed
  // by a verifying session". Idempotent, so claim right before acting.
  const claimDevice = async () => {
    await fetch(`${AUTH_BASE}/device?user_code=${encodeURIComponent(code)}`, {
      credentials: 'include',
    }).catch(() => { /* approve below surfaces the real error */ });
  };

  const handleApprove = async () => {
    setError('');
    setSubmitting(true);
    try {
      await claimDevice();
      const res = await fetch(`${AUTH_BASE}/device/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userCode: code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { message?: string; error?: { message?: string } })?.message ??
            (data as { error?: { message?: string } })?.error?.message ??
            t('auth.device.approveFailed', {
              defaultValue: 'Approval failed',
            }),
        );
      }
      setApproved(true);
      toast.success(
        t('auth.device.approveSuccess', { defaultValue: 'Device authorized' }),
        {
          description: t('auth.device.approveSuccessDescription', {
            defaultValue: 'You can close this window.',
          }),
        },
      );
    } catch (err) {
      setError(
        (err as Error)?.message ??
          t('auth.device.approveFailed', { defaultValue: 'Approval failed' }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeny = async () => {
    setError('');
    setDenying(true);
    try {
      await claimDevice();
      await fetch(`${AUTH_BASE}/device/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userCode: code }),
      });
      setDenied(true);
    } catch (err) {
      setError(
        (err as Error)?.message ??
          t('auth.device.denyFailed', { defaultValue: 'Failed to deny request' }),
      );
    } finally {
      setDenying(false);
    }
  };

  return (
    <PageShell>
      <Card>
        <CardHeader className="text-center">
          <CardTitle>
            {t('auth.device.title', { defaultValue: 'Authorize new device' })}
          </CardTitle>
          <CardDescription>
            {t('auth.device.subtitle', {
              email: user.email,
              defaultValue: `Approve this device to sign in as ${user.email}.`,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {runtimeName ? (
            <div className="rounded-md border bg-background px-4 py-3 text-center">
              <p className="mb-1 text-xs text-muted-foreground">
                {t('auth.device.requesterLabel', { defaultValue: 'Connection request from' })}
              </p>
              <p className="font-medium">{runtimeName}</p>
              {runtimeVersion ? (
                <p className="text-xs text-muted-foreground">{getProductName().toLowerCase()} {runtimeVersion}</p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-md border bg-background px-4 py-3 text-center">
            <p className="mb-1 text-xs text-muted-foreground">
              {t('auth.device.userCodeLabel', { defaultValue: 'Device code' })}
            </p>
            <p className="font-mono text-lg font-semibold tracking-widest">{code}</p>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            {t('auth.device.approveWarning', {
              defaultValue:
                'Only approve if you started this connection yourself a moment ago. '
                + "Once approved, this runtime can access your organization's private packages.",
            })}
          </p>

          <div className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">
              {t('auth.device.loggedInAs', {
                email: user.email,
                defaultValue: `Signed in as ${user.email}`,
              })}
            </p>
            {error && <p className="text-center text-sm text-destructive">{error}</p>}
            <Button
              onClick={handleApprove}
              className="w-full"
              disabled={submitting || denying}
            >
              {submitting
                ? t('auth.device.approving', { defaultValue: 'Approving…' })
                : t('auth.device.approve', { defaultValue: 'Approve device' })}
            </Button>
            <Button
              onClick={handleDeny}
              variant="outline"
              className="w-full"
              disabled={submitting || denying}
            >
              {denying
                ? t('auth.device.denying', { defaultValue: 'Denying…' })
                : t('auth.device.deny', { defaultValue: 'Deny request' })}
            </Button>
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => navigate('/')}
              >
                {t('auth.device.cancel', { defaultValue: 'Cancel' })}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default DeviceAuthPage;
