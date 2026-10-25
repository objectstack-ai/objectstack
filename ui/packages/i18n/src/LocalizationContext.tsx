/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LocalizationContext — the tenant's resolved REGIONAL defaults (currency,
 * locale, time zone) for the current request, surfaced to every renderer.
 *
 * This is the client half of ADR-0053: the framework resolves a workspace
 * `localization.currency` / `locale` / `timezone` onto each request's
 * ExecutionContext and exposes them at `GET /api/v1/auth/me/localization`. A
 * fetching wrapper (in app-shell) loads them once and feeds this PURE context,
 * so low-level field / measure renderers can resolve a currency code down to
 * the org default — instead of hard-coding `$`/`¥`/`USD` or degrading to a
 * bare number — without any of them depending on app-shell or making their own
 * fetch.
 *
 * Undefined values mean "no tenant default known" → consumers render a plain
 * number (the existing safe behavior), and instants render in the viewer's
 * own zone.
 */

import * as React from 'react';
import { getDisplayTimeZone, setDisplayTimeZone, subscribeDisplayTimeZone } from '@object-ui/core';

export interface LocalizationValue {
  /** Tenant default currency (ISO 4217), or undefined when unconfigured. */
  currency?: string;
  /** Tenant/display locale (BCP-47) for Intl formatting, or undefined. */
  locale?: string;
  /**
   * The zone instants render in (an IANA name), or undefined for the viewer's
   * own (objectui#11693). The provider hands it to the central date faces in
   * `@object-ui/core`; read back from {@link useLocalization}, it is the zone
   * those faces render in, so a name the runtime does not know reads back
   * `undefined`.
   */
  timezone?: string;
}

const LocalizationCtx = React.createContext<LocalizationValue>({});

/**
 * Pure provider — the fetching/loading concern lives in the app shell.
 *
 * It is also the ONE place the display zone enters the date faces
 * (objectui#11693): `value.timezone` is handed to `setDisplayTimeZone` in
 * `@object-ui/core`, which every date and datetime face reads, so no renderer
 * threads a zone of its own. The hand-off runs in a layout effect, and the
 * zone the context carries is read back from core through
 * `useSyncExternalStore`, so the context changes only AFTER the faces have the
 * new zone: every consumer then re-renders in it, before the browser paints.
 *
 * The display zone is one per page, as the date faces are: a second provider
 * with a different zone would race this one for it, and unmounting clears it.
 */
export function LocalizationProvider({
  value,
  children,
}: {
  value: LocalizationValue;
  children: React.ReactNode;
}) {
  const { timezone } = value;
  React.useLayoutEffect(() => {
    setDisplayTimeZone(timezone);
    return () => setDisplayTimeZone(undefined);
  }, [timezone]);
  const appliedZone = React.useSyncExternalStore(subscribeDisplayTimeZone, getDisplayTimeZone, getDisplayTimeZone);

  // Stable identity unless the resolved values actually change.
  const memo = React.useMemo<LocalizationValue>(
    () => ({ currency: value.currency, locale: value.locale, timezone: appliedZone }),
    [value.currency, value.locale, appliedZone],
  );
  return <LocalizationCtx.Provider value={memo}>{children}</LocalizationCtx.Provider>;
}

/**
 * Read the tenant regional defaults. Safe outside a provider — returns `{}`
 * (no tenant default), so a renderer mounted standalone degrades gracefully.
 */
export function useLocalization(): LocalizationValue {
  return React.useContext(LocalizationCtx);
}
