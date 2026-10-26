/**
 * ObjectUI Console - Conditional Auth Wrapper
 *
 * This component fetches discovery information from the server and conditionally
 * enables/disables authentication based on the server's auth service status.
 */

import { useState, useEffect, useCallback, ReactNode } from 'react';
import { getSharedDiscovery } from '@object-ui/data-objectstack';
import { AuthProvider } from '@object-ui/auth';
import { LoadingScreen } from './LoadingScreen.js';
import { isServiceUsable, type DiscoveryInfo } from '@object-ui/react';

interface ConditionalAuthWrapperProps {
  children: ReactNode;
  authUrl: string;
}

const DISCOVERY_TIMEOUT_MS = 10_000;

// Bootstrap-critical UI: must render before i18n is loaded (especially when the
// server is unreachable, which is also when i18n can't load translations).
// We deliberately do NOT use useObjectTranslation here — it suspends on first
// render and would prevent the discovery fetch from ever running.
const STRINGS = {
  timeout: 'Connection timed out after 10 seconds.',
  serverUnreachable: (url: string) => `The server at ${url} is unreachable.`,
};

/**
 * Wrapper component that conditionally enables authentication based on server discovery.
 *
 * On startup it:
 * 1. Calls `/api/v1/discovery` (with a 10s AbortController timeout)
 * 2. Reads the auth service's availability from the response
 * 3. On failure, shows the LoadingScreen in error mode with a Retry button
 *    (no silent fallback to "auth enabled" — the user is told the server is unreachable)
 */
export function ConditionalAuthWrapper({ children, authUrl }: ConditionalAuthWrapperProps) {
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const runDiscovery = useCallback(async (isRetry = false) => {
    if (isRetry) setRetrying(true);
    setError(null);

    const baseUrl = (import.meta.env.VITE_SERVER_URL as string | undefined) || '';
    const discoveryUrl = baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/api/v1/discovery`
      : '/api/v1/discovery';

    try {
      const discovery = (await getSharedDiscovery(baseUrl, async () => {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), DISCOVERY_TIMEOUT_MS);
        try {
          const res = await fetch(discoveryUrl, {
            credentials: 'include',
            signal: ctrl.signal,
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const body = await res.json();
          if (body && typeof body.success === 'boolean' && 'data' in body) {
            return body.data;
          }
          return body;
        } catch (e) {
          if ((e as Error).name === 'AbortError') {
            // Manual `cause` assignment — the two-arg Error constructor needs
            // an ES2022 lib this package's tsconfig doesn't target.
            const timeoutErr = new Error('timeout');
            (timeoutErr as Error & { cause?: unknown }).cause = e;
            throw timeoutErr;
          }
          throw e;
        } finally {
          clearTimeout(timeoutId);
        }
      })) as DiscoveryInfo | null;

      // Defensive: an empty/undefined discovery means the server didn't actually
      // respond with usable data (e.g. a cached rejection that resolved as null,
      // or an upstream adapter swallowed the error). Treat it as a connectivity
      // failure so the user sees the error UI instead of being silently dropped
      // onto a "auth enabled" code path against a non-existent server.
      if (!discovery) {
        throw new Error('empty discovery response');
      }

      // ADR-0076 D12 (honest capabilities): trust the 15.1+ signals when
      // present — a `stub` or `handlerReady:false` auth service must NOT
      // wrap the app in a real AuthProvider (login against a dev fake).
      // Pre-15.1 servers carry none of these fields → historical default
      // (enabled) is preserved by isServiceUsable.
      //
      // This reading is the ONLY thing that decides it. `discovery.mode` used
      // to be consulted first: `'preview'` turned auth off outright and
      // simulated an identity out of `discovery.previewMode`. `@objectstack/spec`
      // retired that whole wire surface (objectstack `0c2334f6c`), so this consumer
      // is retired with it (objectui#6654) — a deployment still emitting it
      // falls back to this reading, i.e. it requires login.
      const isAuthEnabled = isServiceUsable(discovery?.services?.auth);
      if (discovery?.services?.auth?.status === 'degraded') {
        console.warn('[ConditionalAuthWrapper] auth service reports degraded — keeping auth enabled (it still serves).');
      }
      setAuthEnabled(isAuthEnabled);
      setIsLoading(false);
    } catch (e) {
      const err = e as Error;
      let message: string;
      if (err.message === 'timeout') {
        message = STRINGS.timeout;
      } else if (err.message?.startsWith('HTTP ')) {
        message = `${STRINGS.serverUnreachable(discoveryUrl)} (${err.message})`;
      } else {
        message = `${STRINGS.serverUnreachable(discoveryUrl)}${err.message ? ` (${err.message})` : ''}`;
      }
      console.warn('[ConditionalAuthWrapper] Discovery failed:', err);
      setError(message);
      // Keep isLoading true so the splash stays mounted with the error UI.
      setIsLoading(true);
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    runDiscovery();
  }, [runDiscovery]);

  if (isLoading) {
    return (
      <LoadingScreen
        error={error}
        onRetry={error ? () => runDiscovery(true) : undefined}
        retrying={retrying}
      />
    );
  }

  // If auth is enabled, wrap with AuthProvider
  if (authEnabled) {
    return (
      <AuthProvider authUrl={authUrl}>
        {children}
      </AuthProvider>
    );
  }

  // If auth is disabled, wrap with a disabled AuthProvider (guest mode)
  return (
    <AuthProvider authUrl={authUrl} enabled={false}>
      {children}
    </AuthProvider>
  );
}
