// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CloudConnectionPanel — the RFC 8628 device-code binding state machine,
 * registered as the SDUI widget `cloud-connection:panel`.
 *
 * This is deliberately the ONLY React in the Cloud Connection surface:
 * the page shell, nav placement and labels ship as metadata WITH the
 * `@objectstack/cloud-connection` plugin (cloud ADR-0008 / console
 * SDUI-first direction). The widget talks to the runtime's same-origin
 * `/api/v1/cloud-connection/*` routes.
 *
 * Zero-input flow (ADR runtime-identity-binding §2.3): [Connect] →
 * bind/start (no environment id — the registration is created cloud-side
 * at approval) → the approval page auto-opens in a popup with the code
 * pre-filled and the device named → bind/poll … → bound. The visible
 * user code is the popup-blocked fallback, not the primary path.
 *
 * The runtime credential never reaches the browser — bind/poll persists
 * it server-side and strips it from the response.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cloud,
  CloudOff,
  Copy,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Unplug,
} from 'lucide-react';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';

const BASE = '/api/v1/cloud-connection';

interface ConnectionView {
  organization_id?: string | null;
  account_email?: string | null;
  bound_at?: string | null;
  name?: string | null;
  runtime_id?: string | null;
}
interface StatusData {
  environmentId: string | null;
  runtimeId?: string | null;
  bound: boolean;
  connection: ConnectionView | null;
}
interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  interval: number;
  expires_in: number;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'unbound' }
  | { kind: 'waiting'; code: DeviceCode; popupOpened: boolean }
  | { kind: 'bound'; status: StatusData }
  | { kind: 'error'; message: string };

/**
 * The two RFC 8628 device-authorization outcomes a user can actually cause,
 * rendered in the user's language instead of the producer's (objectui#5054).
 *
 * `declaredCode` is read FIRST because that is where the upstream spelling
 * lives: it is not a member of the closed `ApiErrorSchema.code` vocabulary, so
 * ADR-0112 puts it in the open producer-authored channel and `code` carries the
 * registered member — `DEVICE_CODE_FAILED` for BOTH of these. `code` is
 * consulted second only so a producer that does put the RFC spelling in the
 * registered slot is still understood.
 *
 * ⛔ Closed on purpose. Every other code — `invalid_grant`, `slow_down`,
 * whatever upstream invents next — returns `null` here and keeps rendering the
 * wire `message`, which is both today's behaviour and the single source of
 * truth for failures this console has no copy for. Widening this map means
 * adding a key to all ten packs, not adding a branch here.
 *
 * The `t()` arguments are string literals so `check:i18n-keys` can resolve
 * them against the `en` pack; a `Record<code, key>` read as `t(key)` is a
 * dynamic key and that gate goes blind to it.
 */
function translateFailureCode(
  t: (key: string) => string,
  declaredCode?: unknown,
  code?: unknown,
): string | null {
  for (const candidate of [declaredCode, code]) {
    if (candidate === 'expired_token') return t('cloudConnection.errors.expired');
    if (candidate === 'access_denied') return t('cloudConnection.errors.accessDenied');
  }
  return null;
}

/** An `Error` that still carries the envelope's codes — see `getJson`. */
type ApiFailure = Error & { declaredCode?: string; code?: string };

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok && body?.success !== true) {
    const msg = body?.error?.message ?? body?.error?.code ?? body?.error ?? `HTTP ${resp.status}`;
    // The codes ride along. A bare `Error` dropped them, and the message was
    // then the only thing that survived the throw — which is exactly why a
    // SERVER-detected expiry rendered the producer's English while the same
    // expiry noticed by this panel's own clock rendered the locale. Attached,
    // not subclassed: extending `Error` is brittle under a downlevel target.
    const failure: ApiFailure = Object.assign(
      new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)),
      {
        declaredCode: typeof body?.error?.declaredCode === 'string' ? body.error.declaredCode : undefined,
        code: typeof body?.error?.code === 'string' ? body.error.code : undefined,
      },
    );
    throw failure;
  }
  return body;
}

export function CloudConnectionPanel() {
  const { t } = useObjectTranslation();
  // The bound-since date reads the DISPLAY locale, never the UI language, so
  // a regional locale (`de-CH` under an English UI) reaches it (objectui#10331).
  const displayLocale = useDisplayLocale();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `t` is a fresh function on every render under several translation
  // providers, so it must not reach a `useCallback` dependency list that the
  // MOUNT effect transitively depends on: `refreshStatus` is exactly that, and
  // an unstable dep there re-runs the effect on every state update — an
  // infinite render loop. Measured: routing `t` into `refreshStatus`'s deps
  // timed out all nine cases in this directory's two suites at 15s. A latest-ref
  // gives the helper the current `t` while keeping its own identity stable.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  /**
   * What a caught failure says to a human. One reading for all four catch
   * sites, so no future call site can reintroduce the split this card closed.
   */
  const failureText = useCallback((err: unknown): string => {
    const e = err as { declaredCode?: unknown; code?: unknown; message?: unknown } | null | undefined;
    return (
      translateFailureCode(tRef.current, e?.declaredCode, e?.code) ??
      ((e?.message as string | undefined) ?? String(err))
    );
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const body = await getJson(`${BASE}/status`);
      const data: StatusData = body?.data ?? { environmentId: null, bound: false, connection: null };
      setPhase(data.bound ? { kind: 'bound', status: data } : { kind: 'unbound' });
    } catch (err: any) {
      setPhase({ kind: 'error', message: failureText(err) });
    }
  }, [failureText]);

  useEffect(() => {
    void refreshStatus();
    return stopPolling;
  }, [refreshStatus, stopPolling]);

  const poll = useCallback((code: DeviceCode, startedAt: number) => {
    const intervalMs = Math.max(code.interval, 2) * 1000;
    const tick = async () => {
      if (Date.now() - startedAt > code.expires_in * 1000) {
        setPhase({ kind: 'error', message: t('cloudConnection.errors.expired') });
        return;
      }
      try {
        const body = await getJson(`${BASE}/bind/poll`, {
          method: 'POST',
          body: JSON.stringify({ device_code: code.device_code }),
        });
        if (body?.data?.pending) {
          pollTimer.current = setTimeout(tick, intervalMs);
          return;
        }
        if (body?.data?.bound || body?.success) {
          await refreshStatus();
          return;
        }
        // `message` first, `code` only as a fallback — the same precedence
        // `getJson` above already applies to every OTHER failure on this
        // surface. Reading `code` alone showed a machine identifier to a human
        // whenever the readable half was on the wire.
        //
        // Which bodies land here: a 2xx that says `success: false` with neither
        // `pending` nor `bound` — i.e. the control plane's `/bind` answer,
        // passed through verbatim with its own status. A non-2xx failure never
        // reaches this line at all: `getJson` throws it, and the catch below
        // renders that error's message.
        //
        // The chain stops at `code` deliberately. `getJson` has a third arm
        // (`?? body?.error`) but guards it with a non-string check before use;
        // here the last arm is the translated string, which is always safe to
        // render, and an unguarded object would reach JSX as a child.
        setPhase({
          kind: 'error',
          // The code -> copy map runs FIRST here too (objectui#5054): a body
          // that reaches this branch carrying a spelling the console knows must
          // read the same as the same spelling arriving on a 400, or the
          // asymmetry just moves to a third reader.
          message:
            translateFailureCode(t, body?.error?.declaredCode, body?.error?.code) ??
            body?.error?.message ?? body?.error?.code ?? t('cloudConnection.errors.bindFailed'),
        });
      } catch (err: any) {
        setPhase({ kind: 'error', message: failureText(err) });
      }
    };
    pollTimer.current = setTimeout(tick, intervalMs);
  }, [failureText, refreshStatus, t]);

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      const body = await getJson(`${BASE}/bind/start`, { method: 'POST', body: '{}' });
      const code: DeviceCode = body?.data;
      if (!code?.device_code || !code?.user_code) throw new Error(t('cloudConnection.errors.deviceCodeFailed'));
      // Auto-open the approval page — the GitHub-login moment. Still within
      // the click's transient activation, so popup blockers generally allow
      // it; the code display below is the blocked-popup fallback.
      const link = code.verification_uri_complete ?? code.verification_uri;
      let popupOpened = false;
      if (link) {
        try {
          popupOpened = Boolean(window.open(link, '_blank', 'noopener,width=520,height=720'));
        } catch { /* blocked — fallback UI below */ }
      }
      setPhase({ kind: 'waiting', code, popupOpened });
      poll(code, Date.now());
    } catch (err: any) {
      setPhase({ kind: 'error', message: failureText(err) });
    } finally {
      setBusy(false);
    }
  }, [failureText, poll, t]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await getJson(`${BASE}/unbind`, { method: 'POST', body: '{}' });
      await refreshStatus();
    } catch (err: any) {
      setPhase({ kind: 'error', message: failureText(err) });
    } finally {
      setBusy(false);
    }
  }, [failureText, refreshStatus]);

  const copyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — user can select the text */ }
  }, []);

  if (phase.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('cloudConnection.checking')}
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" /> {phase.message}
        </div>
        <button
          type="button"
          className="self-start rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          onClick={() => { stopPolling(); void refreshStatus(); }}
        >
          {t('cloudConnection.retry')}
        </button>
      </div>
    );
  }

  if (phase.kind === 'waiting') {
    const link = phase.code.verification_uri_complete ?? phase.code.verification_uri;
    return (
      <div className="flex flex-col gap-4 rounded-lg border p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {phase.popupOpened
            ? t('cloudConnection.waiting.popupOpened')
            : t('cloudConnection.waiting.polling')}
        </div>
        {!phase.popupOpened && link ? (
          <a
            className="inline-flex items-center gap-1.5 self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            href={link}
            target="_blank"
            rel="noreferrer"
          >
            {t('cloudConnection.waiting.openApproval')} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
        <div className="flex items-center gap-3">
          <code className="rounded-md bg-muted px-4 py-2 text-2xl font-semibold tracking-[0.25em]">
            {phase.code.user_code}
          </code>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            onClick={() => void copyCode(phase.code.user_code)}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {copied ? t('cloudConnection.waiting.copied') : t('cloudConnection.waiting.copy')}
          </button>
        </div>
        {/* Two self-contained strings rather than one sentence stitched across
            JSX — a translator never receives a dangling clause or a bare '.'. */}
        <p className="text-sm text-muted-foreground">
          {t('cloudConnection.waiting.codePrefilled')}
          {phase.popupOpened && link ? (
            <>
              {' '}
              <a className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" href={link} target="_blank" rel="noreferrer">
                {t('cloudConnection.waiting.openItHere')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </>
          ) : null}
        </p>
        <button
          type="button"
          className="self-start rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          onClick={() => { stopPolling(); void refreshStatus(); }}
        >
          {t('cloudConnection.waiting.cancel')}
        </button>
      </div>
    );
  }

  if (phase.kind === 'bound') {
    const conn = phase.status.connection ?? {};
    const runtimeId = conn.runtime_id ?? phase.status.runtimeId;
    return (
      <div className="flex flex-col gap-4 rounded-lg border p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <span className="font-medium">{t('cloudConnection.bound.title')}</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {conn.name ? (<><dt className="text-muted-foreground">{t('cloudConnection.bound.runtime')}</dt><dd>{conn.name}</dd></>) : null}
          {conn.organization_id ? (<><dt className="text-muted-foreground">{t('cloudConnection.bound.organization')}</dt><dd className="font-mono">{conn.organization_id}</dd></>) : null}
          {conn.account_email ? (<><dt className="text-muted-foreground">{t('cloudConnection.bound.approvedBy')}</dt><dd>{conn.account_email}</dd></>) : null}
          {runtimeId ? (<><dt className="text-muted-foreground">{t('cloudConnection.bound.runtimeId')}</dt><dd className="font-mono text-xs">{runtimeId}</dd></>) : null}
          {phase.status.environmentId ? (<><dt className="text-muted-foreground">{t('cloudConnection.bound.environment')}</dt><dd className="font-mono">{phase.status.environmentId}</dd></>) : null}
          {conn.bound_at ? (<><dt className="text-muted-foreground">{t('cloudConnection.bound.since')}</dt><dd>{new Date(conn.bound_at).toLocaleString(displayLocale)}</dd></>) : null}
        </dl>
        <p className="text-sm text-muted-foreground">
          {t('cloudConnection.bound.privatePackages')}
        </p>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1.5 self-start rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/5 disabled:opacity-50"
          onClick={() => void disconnect()}
        >
          <Unplug className="h-3.5 w-3.5" aria-hidden="true" /> {t('cloudConnection.bound.disconnect')}
        </button>
      </div>
    );
  }

  // unbound — zero input: no environment id, nothing to paste anywhere.
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-6">
      <div className="flex items-center gap-2">
        <CloudOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{t('cloudConnection.unbound.title')}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('cloudConnection.unbound.body')}
      </p>
      <button
        type="button"
        disabled={busy}
        className="inline-flex items-center gap-1.5 self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        onClick={() => void connect()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Cloud className="h-4 w-4" aria-hidden="true" />}
        {t('cloudConnection.unbound.connect')}
      </button>
    </div>
  );
}

// SDUI registration: page metadata (shipped by @objectstack/cloud-connection)
// references this widget by type. The renderer passes the component node as
// `schema`; the panel needs no properties today.
ComponentRegistry.register('cloud-connection:panel', () => <CloudConnectionPanel />, {
  namespace: 'app-shell',
  label: 'Cloud Connection Panel',
  category: 'plugin',
  inputs: [],
});
