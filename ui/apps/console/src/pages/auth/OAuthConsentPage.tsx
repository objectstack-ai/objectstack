/**
 * OAuthConsentPage — /oauth/consent screen.
 *
 * Ported from `framework/apps/account/src/routes/oauth.consent.tsx`.
 *
 * The `@better-auth/oauth-provider` plugin redirects the user here when
 * an OAuth client requests consent. The full query string (including the
 * signed `sig`/`exp` carrier) is the canonical authorization request and
 * must be forwarded back to the consent endpoint as `oauth_query` so the
 * server can verify and re-issue an authorization code.
 *
 * After accept/deny we POST to `/api/v1/auth/oauth2/consent` which
 * returns `{ redirect_uri }` pointing at the OAuth client's callback.
 *
 * ## Naming the application
 *
 * The page names the requesting application by its REGISTERED name, read
 * from `GET /api/v1/auth/oauth2/public-client?client_id=…` — the route the
 * server serves (`@better-auth/oauth-provider`'s `getOAuthClientPublic`, the
 * same URL `@objectstack/client`'s `oauth.applications.getPublic` builds).
 * It needs a signed-in session, so the lookup waits for one. Its answer is
 * the client's RFC 7591 metadata, verbatim: the name is `client_name`, the
 * logo `logo_uri`.
 *
 * When the lookup gives no name — any non-2xx (an unknown or disabled client
 * is a 404), a network failure, or an answer without `client_name` — the page
 * says the application could not be identified and shows the raw `client_id`
 * labelled as the id. ⛔ The id is never shown in the name's place: an id
 * the user cannot recognise must not read as the name of something they can.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, KeyRound, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import type { OAuthApplicationPublic } from '@objectstack/client';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@object-ui/components';

const AUTH_BASE = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;

/** What the public-client lookup established about the requesting client. */
type ClientLookup =
  | { state: 'pending' }
  | { state: 'identified'; name: string; logoUri?: string }
  | { state: 'unidentified' };

const PENDING: ClientLookup = { state: 'pending' };
const UNIDENTIFIED: ClientLookup = { state: 'unidentified' };

/** Read the server's answer: identified only by a non-empty `client_name`. */
async function readPublicClient(res: Response): Promise<ClientLookup> {
  if (!res.ok) return UNIDENTIFIED;
  const body = (await res.json().catch(() => null)) as OAuthApplicationPublic | null;
  const name = typeof body?.client_name === 'string' ? body.client_name.trim() : '';
  if (!name) return UNIDENTIFIED;
  const logoUri = typeof body?.logo_uri === 'string' && body.logo_uri ? body.logo_uri : undefined;
  return { state: 'identified', name, logoUri };
}

export function OAuthConsentPage() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  // Keyed by the client id it answers for, so the lookup below is derived
  // rather than reset from an effect.
  const [answer, setAnswer] = useState<{ clientId: string; lookup: ClientLookup } | null>(null);

  // Read raw query so the signed `sig=` is forwarded verbatim.
  const rawSearch = typeof window !== 'undefined' ? window.location.search : '';
  const oauthQuery = rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch;
  const params = new URLSearchParams(oauthQuery);
  const clientId = params.get('client_id') ?? undefined;
  const scope = params.get('scope') ?? '';

  // Unauthenticated → bounce to /login with a return-to that brings the
  // user back here once signed in.
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      const here = window.location.pathname + window.location.search;
      navigate(`/login?redirect=${encodeURIComponent(here)}`, { replace: true });
    }
  }, [user, isLoading, navigate]);

  // Look the client up by its registered name. The route requires a session,
  // so a signed-out visitor (bounced to /login above) never asks it.
  const userId = user?.id;
  useEffect(() => {
    if (!clientId || !userId) return;
    let cancelled = false;
    fetch(`${AUTH_BASE}/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, {
      credentials: 'include',
    })
      .then(readPublicClient, () => UNIDENTIFIED)
      .then((lookup) => {
        if (!cancelled) setAnswer({ clientId, lookup });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, userId]);

  const lookup: ClientLookup = !clientId
    ? UNIDENTIFIED
    : answer?.clientId === clientId
      ? answer.lookup
      : PENDING;
  const identified = lookup.state === 'identified' ? lookup : null;

  const scopes = scope.split(/\s+/).filter(Boolean);

  const handleDecision = async (accept: boolean) => {
    setSubmitting(true);
    try {
      const res = await fetch(`${AUTH_BASE}/oauth2/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { message?: string })?.message || `Consent failed: ${res.status}`,
        );
      }
      const redirect =
        (data as { redirect_uri?: string; redirectURI?: string; url?: string })
          .redirect_uri ??
        (data as { redirectURI?: string }).redirectURI ??
        (data as { url?: string }).url;
      if (redirect) {
        window.location.href = redirect;
        return;
      }
      const title = accept
        ? t('oauth.consent.granted', { defaultValue: 'Access granted' })
        : t('oauth.consent.denied', { defaultValue: 'Access denied' });
      toast(title, {
        description: t('oauth.consent.noRedirect', {
          defaultValue: 'No redirect URL returned by the server.',
        }),
      });
    } catch (err) {
      toast.error(
        t('oauth.consent.failed', { defaultValue: 'Consent failed' }),
        { description: (err as Error).message },
      );
    } finally {
      setSubmitting(false);
    }
  };

  const appName =
    identified?.name ?? t('oauth.consent.unknownApp', { defaultValue: 'an application' });

  return (
    <div className="flex min-h-svh w-full flex-1 items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-3 rounded-full border bg-muted p-3">
            {identified?.logoUri ? (
              <img
                src={identified.logoUri}
                alt=""
                className="h-8 w-8 rounded"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <KeyRound className="h-7 w-7 text-muted-foreground" />
            )}
          </div>
          <CardTitle className="text-xl">
            {t('oauth.consent.title', {
              appName,
              defaultValue: `${appName} wants to access your account`,
            })}
          </CardTitle>
          <CardDescription>
            {t('oauth.consent.request', {
              appName,
              suffix: user?.email ? ` (${user.email})` : '',
              defaultValue: `${appName} is requesting permission${
                user?.email ? ` for ${user.email}` : ''
              }.`,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lookup.state === 'unidentified' && (
            <Alert>
              <ShieldAlert className="size-4" />
              <AlertTitle>
                {t('oauth.consent.unidentified', {
                  defaultValue: 'This application could not be identified.',
                })}
              </AlertTitle>
              {clientId && (
                <AlertDescription>
                  <dl className="text-xs">
                    <dt className="text-muted-foreground">
                      {t('oauth.consent.clientId', { defaultValue: 'Client ID' })}
                    </dt>
                    <dd>
                      <code className="break-all font-mono">{clientId}</code>
                    </dd>
                  </dl>
                </AlertDescription>
              )}
            </Alert>
          )}

          {scopes.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">
                {t('oauth.consent.willAllow', {
                  defaultValue: 'This app will be able to:',
                })}
              </p>
              <ul className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
                {scopes.map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 text-green-600 dark:text-green-400" />
                    <span>{describeScope(s, t)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => handleDecision(false)}
              disabled={submitting}
            >
              <X className="mr-2 h-4 w-4" />
              {t('oauth.consent.deny', { defaultValue: 'Deny' })}
            </Button>
            <Button onClick={() => handleDecision(true)} disabled={submitting}>
              <Check className="mr-2 h-4 w-4" />
              {submitting
                ? t('oauth.consent.submitting', { defaultValue: 'Authorizing…' })
                : t('oauth.consent.authorize', { defaultValue: 'Authorize' })}
            </Button>
          </div>

          <p className="pt-2 text-center text-xs text-muted-foreground">
            {t('oauth.consent.footer', {
              defaultValue: 'You can revoke access at any time from your account settings.',
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function describeScope(
  scope: string,
  t: ReturnType<typeof useObjectTranslation>['t'],
): string {
  switch (scope) {
    case 'openid':
      return t('oauth.consent.scope.openid', {
        defaultValue: 'Confirm your identity',
      });
    case 'profile':
      return t('oauth.consent.scope.profile', {
        defaultValue: 'Read your basic profile (name, picture)',
      });
    case 'email':
      return t('oauth.consent.scope.email', {
        defaultValue: 'Read your email address',
      });
    case 'offline_access':
      return t('oauth.consent.scope.offlineAccess', {
        defaultValue: 'Stay signed in (refresh access)',
      });
    // The three agent scopes, as the server grants them: the agent's tools and
    // data ceiling follow the scope, and every call still runs under the
    // signed-in user's own permissions, so each sentence carries that bound.
    case 'data:read':
      return t('oauth.consent.scope.dataRead', {
        defaultValue: 'Read records, within your own permissions',
      });
    case 'data:write':
      return t('oauth.consent.scope.dataWrite', {
        defaultValue: 'Create, change and delete records, within your own permissions',
      });
    case 'actions:execute':
      return t('oauth.consent.scope.actionsExecute', {
        defaultValue: 'Run actions on your behalf, within your own permissions',
      });
    default:
      return scope;
  }
}

export default OAuthConsentPage;
