/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * TurnstileWidget — the Cloudflare Turnstile challenge a sign-up form renders
 * when the server's public config serves `features.turnstileSiteKey`.
 *
 * The server's opt-in challenge (plugin-auth, better-auth's `captcha` plugin)
 * refuses `/sign-up/email` without a token in the `x-captcha-response`
 * header. This widget produces that token and hands it to `onToken`; the form
 * sends it (`SignUpData.captchaToken`). A token is single-use, so the form
 * bumps `resetKey` after every answer from the server, and the widget then
 * draws a fresh challenge.
 *
 * A challenge that fails, expires or cannot load (offline, blocked script)
 * hands `onToken(null)` and shows ONE retry message with a Retry button —
 * never the provider's own error code or text.
 *
 * Cloudflare's script is loaded once per page, explicitly rendered, from
 * {@link TURNSTILE_SCRIPT_URL}; the Console's content-security-policy admits
 * that origin only while the deployment has the challenge on.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

/** Cloudflare's Turnstile loader, in explicit-render mode. */
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** The subset of Cloudflare's `window.turnstile` this widget calls. */
export interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => boolean | void;
      'timeout-callback': () => void;
    },
  ) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoad: Promise<TurnstileApi> | null = null;

/** Load Cloudflare's script once; a failed load is forgotten so Retry can try again. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window !== 'undefined' && window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile unavailable')));
    script.onerror = () => reject(new Error('turnstile script failed to load'));
    document.head.appendChild(script);
  }).catch((err) => {
    scriptLoad = null;
    throw err;
  });
  return scriptLoad;
}

export interface TurnstileWidgetLabels {
  /** Shown when the challenge failed, expired or could not load. */
  failed?: string;
  /** The button that draws a fresh challenge. */
  retry?: string;
}

export interface TurnstileWidgetProps {
  /** The public site key from `features.turnstileSiteKey`. */
  siteKey: string;
  /** The challenge's token once solved; `null` when it failed, expired or was reset. */
  onToken: (token: string | null) => void;
  /** Change it to discard the current token and draw a fresh challenge (tokens are single-use). */
  resetKey?: number;
  labels?: TurnstileWidgetLabels;
}

export function TurnstileWidget({ siteKey, onToken, resetKey = 0, labels = {} }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const apiRef = useRef<TurnstileApi | null>(null);
  // Read through a ref: the callbacks are handed to Cloudflare once, at render.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [failed, setFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const fail = useCallback(() => {
    onTokenRef.current(null);
    setFailed(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        apiRef.current = api;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            setFailed(false);
            onTokenRef.current(token);
          },
          'expired-callback': fail,
          // `true` tells Cloudflare the error is handled, so it neither
          // throws nor logs its own code.
          'error-callback': () => {
            fail();
            return true;
          },
          'timeout-callback': fail,
        });
      })
      .catch(() => {
        if (!cancelled) fail();
      });
    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      widgetIdRef.current = undefined;
      if (id !== undefined) apiRef.current?.remove(id);
    };
  }, [siteKey, loadAttempt, fail]);

  // A new resetKey discards the spent token and draws a fresh challenge.
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    onTokenRef.current(null);
    const id = widgetIdRef.current;
    if (id !== undefined) apiRef.current?.reset(id);
  }, [resetKey]);

  const retry = () => {
    setFailed(false);
    onTokenRef.current(null);
    const id = widgetIdRef.current;
    if (id !== undefined && apiRef.current) apiRef.current.reset(id);
    else setLoadAttempt((n) => n + 1);
  };

  return (
    <div className="space-y-2" data-testid="turnstile-widget">
      <div ref={containerRef} className="flex justify-center" />
      {failed && (
        <div role="alert" className="flex items-center justify-between gap-3 text-[13px] text-destructive">
          <span>{labels.failed ?? 'The security check did not complete. Please try it again.'}</span>
          <button
            type="button"
            onClick={retry}
            className="shrink-0 font-medium underline underline-offset-4 hover:text-destructive/80"
          >
            {labels.retry ?? 'Retry'}
          </button>
        </div>
      )}
    </div>
  );
}
