/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useMonacoFallback — decide between the Monaco editor and a plain-textarea
 * fallback for the metadata designer's code surfaces (JSON source tab,
 * html/react page source).
 *
 * Monaco's core is fetched lazily from a public CDN (jsdelivr) and spins up
 * web workers. On offline / air-gapped / CSP-restricted installs — and the
 * console is explicitly meant to embed in ANY ObjectStack server, many of
 * which ship a strict CSP — that fetch fails. We detect it two ways:
 *
 *  - **Fast path:** `loader.init()` rejects the moment the CDN loader script
 *    fails to load, so we flip to the textarea immediately instead of making
 *    the user stare at a loading state for the full grace period
 *    (previously a hard-coded 4s of dead air on every CSP-blocked install).
 *  - **Backstop:** some failures still resolve the loader but paint nothing
 *    (e.g. blocked workers). A one-shot DOM poll after `fallbackDelayMs`
 *    checks for a rendered `.view-line` row and falls back if the editor
 *    mounted empty.
 *
 * ## One loader probe per page, and why the editor waits for it (objectui#11800)
 *
 * `@monaco-editor/loader` (read at 1.7.0) wraps its page-wide promise in
 * `makeCancelable`, which subscribes with a bare `promise.then(onFulfilled)` —
 * no rejection handler. So EVERY `loader.init()` call made while the loader is
 * failing leaves one rejected promise that no caller can reach, and the
 * browser reports it as an uncaught `Event` error, however carefully the
 * caller handles the promise `init()` returns. On the Studio's source-page
 * shape that is one per caller per mount: the canvas preview and the inspector
 * editor each run this hook, the editor's `<Editor>` calls `init()` again and
 * logs its own "Monaco initialization: error: Event", and the dev build's
 * StrictMode mounts each of them twice.
 * `useMonacoFallback.loaderRejection-11800.test.tsx` drives the real loader
 * through that shape and counts what escapes.
 *
 * Hence:
 *  - `loader.init()` is called ONCE per page, here, and every mount reads that
 *    one outcome (`probeMonacoLoader`).
 *  - The editor is not mounted until that probe resolves (`'loading'` renders
 *    the same skeleton the lazy import already shows), so on a failing install
 *    `<Editor>` never calls `init()` and never logs its own error.
 *  - The one rejection the probe's own call leaves behind is caught at the only
 *    place it can be: an `unhandledrejection` listener that cancels exactly the
 *    rejection carrying the loader's own failure (compared by identity), and
 *    nothing else.
 *  - The failure is reported once per page, as one console line that names the
 *    cause — for the CDN case, the loader URL that could not be fetched.
 *
 * Returns `[status, containerRef]`: render the textarea when `status` is
 * `'unavailable'`, the editor when it is `'ready'`, and a loading placeholder
 * while it is `'loading'`. Attach `containerRef` to the element that wraps the
 * Monaco instance so the backstop can inspect it.
 */

import * as React from 'react';
import { loader } from '@monaco-editor/react';

export type MonacoStatus = 'loading' | 'ready' | 'unavailable';

type LoaderOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: unknown };

/** The page's one `loader.init()` probe, and its outcome once it settled. */
let loaderProbe: Promise<LoaderOutcome> | null = null;
let loaderOutcome: LoaderOutcome | null = null;

/**
 * Name what failed. The CDN case rejects with the loader `<script>`'s `error`
 * Event, whose target carries the URL that could not be fetched; the later
 * AMD stage (`vs/editor/editor.main`) rejects with an Error.
 */
function describeLoaderFailure(reason: unknown): string {
  const target = (reason as { target?: { tagName?: unknown; src?: unknown } } | null)?.target;
  if (target && target.tagName === 'SCRIPT' && typeof target.src === 'string' && target.src) {
    return `its loader script could not be fetched from ${target.src} (no network route to it, or blocked by a Content-Security-Policy)`;
  }
  if (reason instanceof Error && reason.message) return reason.message;
  return String(reason);
}

function onLoaderFailure(reason: unknown): void {
  // The rejection `makeCancelable` leaves unhandled carries this very reason
  // object; cancel that one and let every other rejection through. The
  // listener stays for the page: a later `loader.init()` from any other editor
  // leaves one more rejection carrying the same reason.
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      if (event.reason === reason) event.preventDefault();
    });
  }
  console.warn(
    `Monaco editor unavailable: ${describeLoaderFailure(reason)}. Code editors fall back to a plain textarea.`,
  );
}

/**
 * Whether there is a loader to probe. Optional-chained so a test that mocks
 * '@monaco-editor/react' without a `loader` export mounts the editor at once
 * and relies on the DOM-poll backstop alone.
 */
function hasLoader(): boolean {
  return typeof loader?.init === 'function';
}

/** Call `loader.init()` once for the page; every caller reads that one outcome. */
function probeMonacoLoader(): Promise<LoaderOutcome> {
  if (!loaderProbe) {
    loaderProbe = Promise.resolve(loader.init()).then(
      (): LoaderOutcome => (loaderOutcome = { ok: true }),
      (reason: unknown): LoaderOutcome => {
        loaderOutcome = { ok: false, reason };
        onLoaderFailure(reason);
        return loaderOutcome;
      },
    );
  }
  return loaderProbe;
}

function initialStatus(): MonacoStatus {
  if (!hasLoader()) return 'ready';
  if (!loaderOutcome) return 'loading';
  return loaderOutcome.ok ? 'ready' : 'unavailable';
}

export function useMonacoFallback(
  fallbackDelayMs = 4000,
): readonly [MonacoStatus, React.RefObject<HTMLDivElement | null>] {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<MonacoStatus>(initialStatus);
  const unavailable = status === 'unavailable';

  // Fast fail: read the page's one loader probe. A fallback already taken
  // (the backstop below) is never undone by a late answer.
  React.useEffect(() => {
    if (!hasLoader()) return;
    let cancelled = false;
    void probeMonacoLoader().then((outcome) => {
      if (cancelled) return;
      setStatus((s) => (s === 'unavailable' ? s : outcome.ok ? 'ready' : 'unavailable'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Backstop: Monaco resolved but painted nothing (blocked workers, etc.).
  React.useEffect(() => {
    if (unavailable) return;
    const id = setTimeout(() => {
      const el = containerRef.current;
      if (!el || !el.querySelector('.view-line')) setStatus('unavailable');
    }, fallbackDelayMs);
    return () => clearTimeout(id);
  }, [unavailable, fallbackDelayMs]);

  return [status, containerRef] as const;
}
