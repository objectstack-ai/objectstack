// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataHmrReloader
 *
 * Dev-only component. Subscribes to the server's metadata-events SSE
 * stream and triggers `location.reload()` (debounced) whenever any
 * metadata file changes on disk.
 *
 * Why a full reload?
 *   Studio owns its metadata-fetching layer and can invalidate granular
 *   caches via `useMetadataHmr` + custom `subscribe(...)` listeners.
 *   The runtime Console, by contrast, leans entirely on
 *   `@object-ui/app-shell` and the `@object-ui/plugin-*` packs for
 *   data loading — their caches are not externally invalidatable. A
 *   debounced page reload is the simplest reliable strategy in dev.
 *
 * Mount-time gating
 *   - `enabled` defaults to `import.meta.env.DEV` so production builds
 *     never run this component.
 *   - SSR-safe: no-op when `window`/`EventSource` are unavailable.
 *
 * Give-up-after-first-failure (objectui#7257)
 *   `enabled` alone is not a hard guarantee that the server actually mounts
 *   `/api/v1/dev/metadata-events` — a build can end up with
 *   `import.meta.env.DEV === true` baked in (e.g. a "prod-like" rig that
 *   forces `NODE_ENV=development` for the *build tooling* while running the
 *   server itself in production posture) even though the route is absent
 *   there. Treat the very first `connect()` attempt as the real capability
 *   probe: if the stream is closed before it ever reaches `open`, the server
 *   doesn't support it (a 404, most likely), and retrying on a fixed
 *   interval would just recreate that 404 every `reconnectDelayMs` forever —
 *   so this gives up permanently instead of retrying or backing off. A
 *   stream that HAS opened at least once and later drops (dev server
 *   restart, network blip) keeps reconnecting as before — that scenario
 *   means the route genuinely exists, so it is ordinary dev-time churn, not
 *   a production posture mismatch.
 *
 * No production-posture substitute
 *   This component's only job is dev-time "a metadata file changed on disk"
 *   -> full reload. Production deployments never have metadata files
 *   changing on the server's disk after a publish, so there is nothing for
 *   an equivalent production channel to watch — this card intentionally
 *   ships no replacement. A separate, unrelated caching bug (the Studio left
 *   nav not refreshing after a metadata change) needs its own fix elsewhere;
 *   it does not go through this SSE stream today either way.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

export interface MetadataHmrReloaderProps {
  /** Toggle to force-disable. Defaults to `import.meta.env.DEV`. */
  enabled?: boolean;
  /** SSE endpoint. Defaults to the standard dev route. */
  url?: string;
  /** Debounce window in ms — coalesces bursts from one edit. */
  debounceMs?: number;
  /** Reconnect delay after the connection drops. */
  reconnectDelayMs?: number;
}

export function MetadataHmrReloader({
  enabled = (import.meta as any).env?.DEV ?? false,
  url = '/api/v1/dev/metadata-events',
  debounceMs = 400,
  reconnectDelayMs = 2000,
}: MetadataHmrReloaderProps) {
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    // Set once the stream has ever reached `open`. Until then, a closed
    // connection is read as "this server doesn't mount the route" rather
    // than "a transient drop" — see the give-up-after-first-failure note
    // in the file header (objectui#7257).
    let hasOpenedOnce = false;

    const scheduleReload = (reason: string) => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        try {
          toast.info(`Metadata changed (${reason}) — reloading…`, { duration: 800 });
        } catch { /* toaster may be unmounted */ }
        // Small extra delay so the toast paints before navigation.
        setTimeout(() => {
          try { window.location.reload(); } catch { /* noop */ }
        }, 150);
      }, debounceMs);
    };

    const onChange = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as {
          metadataType?: string;
          name?: string;
        };
        const label = data?.name
          ? `${data.metadataType ?? 'metadata'}:${data.name}`
          : 'metadata';
        scheduleReload(label);
      } catch {
        scheduleReload('change');
      }
    };

    const onReload = (event: MessageEvent<string>) => {
      let reason = 'rebuild';
      try {
        const data = JSON.parse(event.data) as { reason?: string };
        reason = data?.reason ?? reason;
      } catch { /* tolerate */ }
      scheduleReload(reason);
    };

    const connect = () => {
      if (cancelled) return;
      try {
        es = new EventSource(url);
        es.addEventListener('open', () => {
          hasOpenedOnce = true;
        });
        es.addEventListener('metadata-change', onChange as EventListener);
        es.addEventListener('reload', onReload as EventListener);
        es.addEventListener('error', () => {
          if (cancelled) return;
          if (es?.readyState === EventSource.CLOSED) {
            es = null;
            if (!hasOpenedOnce) {
              // Never got past the first attempt — most likely a 404
              // (production posture doesn't mount this dev-only route).
              // Retrying on a timer would just recreate the same 404 every
              // `reconnectDelayMs` forever; give up instead of extending
              // the interval.
              return;
            }
            retryTimer = setTimeout(connect, reconnectDelayMs);
          }
        });
      } catch {
        if (!hasOpenedOnce) return;
        retryTimer = setTimeout(connect, reconnectDelayMs);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      if (es) { try { es.close(); } catch { /* noop */ } }
    };
  }, [enabled, url, debounceMs, reconnectDelayMs]);

  return null;
}
