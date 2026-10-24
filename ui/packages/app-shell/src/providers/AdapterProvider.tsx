/**
 * AdapterProvider
 *
 * Creates and provides an ObjectStackAdapter instance to the component tree.
 * Also exposes a `useAdapter` hook for consuming the adapter in child components.
 *
 * @module
 */

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { createAuthenticatedFetch } from '@object-ui/auth';
import { AdapterCtx } from '@object-ui/react';
import { useObjectTranslation, useSafeFieldLabel } from '@object-ui/i18n';
import { installSettleSignalGlobal, withSettleSignal } from '../observability/settleSignal.js';
import { emitWriteWarning, type TranslateFn } from './writeWarningToast.js';
import { emitSaveAdvisories } from './saveAdvisoryToast.js';
import { emitMetadataReadWarning } from './metadataReadWarningToast.js';

export { useAdapter } from '@object-ui/react';

interface AdapterProviderProps {
  children: ReactNode;
  /** Optional pre-created adapter (useful for testing). */
  adapter?: ObjectStackAdapter | null;
}

/**
 * Creates an ObjectStackAdapter, connects to the API, then provides it to children.
 * Shows nothing (returns null) until the adapter is ready.
 */
export function AdapterProvider({ children, adapter: externalAdapter }: AdapterProviderProps) {
  const [adapter, setAdapter] = useState<ObjectStackAdapter | null>(externalAdapter ?? null);
  // The warning listener is registered ONCE (the adapter outlives a language
  // switch), so read `t` through a ref instead of capturing it — otherwise a
  // user who switches language mid-session keeps getting the old locale, and
  // adding `t` to the effect deps would tear down and rebuild the adapter.
  const { t } = useObjectTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  // Same one-time-registration reasoning as `t` above: read the label resolver
  // through a ref so a language switch relabels the next toast without
  // rebuilding the adapter.
  const { fieldLabel } = useSafeFieldLabel();
  const fieldLabelRef = useRef(fieldLabel);
  fieldLabelRef.current = fieldLabel;

  useEffect(() => {
    if (externalAdapter) {
      setAdapter(externalAdapter);
      return;
    }

    let cancelled = false;
    let unsubscribeWriteWarning: (() => void) | undefined;
    let unsubscribeSaveAdvisory: (() => void) | undefined;
    let unsubscribeMetadataReadWarning: (() => void) | undefined;

    // Expose window.__objectui.{pendingRequests,idle,whenIdle} so an automated
    // (AI) browser driver has one "is the app settled?" predicate (ADR-0054 C5).
    installSettleSignalGlobal();

    async function init() {
      try {
        const a = new ObjectStackAdapter({
          baseUrl: import.meta.env.VITE_SERVER_URL || '',
          // Count every outbound request in the global in-flight signal (C5).
          fetch: withSettleSignal(createAuthenticatedFetch()),
          autoReconnect: true,
          maxReconnectAttempts: 5,
          reconnectDelay: 1000,
          cache: { maxSize: 50, ttl: 300_000 },
        });

        // Surface silently-stripped write fields (objectstack-ai/objectstack#3431 / objectstack-ai/objectstack#3455) as a toast so a
        // read-only value the user typed doesn't just vanish on save. The sink
        // is passed in rather than imported by the message builder — see
        // `WriteWarningSink`.
        unsubscribeWriteWarning = a.onWriteWarning((ev) => {
          void emitWriteWarning(ev, tRef.current as TranslateFn, a, fieldLabelRef.current, toast);
        });

        // Surface the runtime authoring gate's advisory findings for metadata
        // saves that went through THIS adapter's `ObjectStackClient.meta`
        // (#4237) — `MetadataService`, `useNavigationSync`, plugin-designer's
        // app wizard, and the adapter's own view/dashboard save paths all take
        // that client from `getClient()`, so this one subscription covers every
        // one of them. The renderer is the same `emitSaveAdvisories` the other
        // client class already uses (#4133/#4236): one wording, two doors. `t`
        // rides the same ref as the write-warning channel above, and for the
        // same reason — the adapter outlives a language switch.
        unsubscribeSaveAdvisory = a.onSaveAdvisory((ev) => {
          emitSaveAdvisories(ev, tRef.current as TranslateFn, toast);
        });

        // Surface a metadata READ that could not be answered and was degraded
        // to an empty result anyway (objectui#7741). Without this the import
        // wizard's saved-mapping selector is hidden identically whether the
        // deployment registered no mapping or the server refused the read —
        // the ambiguity that produced the objectstack#14026 misdiagnosis. The
        // supported "this server does not serve that kind" case never reaches
        // here: the adapter classifies it and emits nothing, so an older
        // deployment stays quiet. `t` rides the same ref as the two channels
        // above, and for the same reason.
        unsubscribeMetadataReadWarning = a.onMetadataReadWarning((ev) => {
          emitMetadataReadWarning(ev, tRef.current as TranslateFn, toast);
        });

        await a.connect();

        if (!cancelled) {
          setAdapter(a);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[Console] Failed to initialize:', err);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      unsubscribeWriteWarning?.();
      unsubscribeSaveAdvisory?.();
      unsubscribeMetadataReadWarning?.();
    };
  }, [externalAdapter]);

  return (
    <AdapterCtx.Provider value={adapter}>
      {children}
    </AdapterCtx.Provider>
  );
}
