// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The packaged-action ledger switch Studio offers on a read-only app's vendor
 * actions (objectstack#34724, the ADR-0146 D4 amendment of 2026-11-17): on the
 * object's Actions view in the Data pillar, and on a standalone `action`
 * item's page in the "All metadata" area. Setup's Packaged Actions page, which
 * held the switch before, is retired.
 *
 * It is the flow switch's twin (`packagedFlowLedger.ts`), over the action's
 * own two doors, which are the ones that page used:
 *
 *   - the READ is the `sys_metadata_activation` ledger's generic list (rows
 *     with `metadata_type: 'action'`), read by `packagedActions.ts`'s rules:
 *     absence of a row means active, a truncated page is a failed read;
 *   - the WRITE is `POST /actions/_activation/:object/:action`
 *     (objectstack#12348), body exactly `{ enabled }`.
 *
 * The gate is the one the flow door has (`refuseUngrantedActivationWrite`
 * serves both doors), so it is pre-judged by the same function,
 * {@link flowLedgerWalledReadOnly}. Every refusal reaches the operator
 * VERBATIM through `actionErrorDetail`; a fallback is used only when the
 * response carried no message, in the caller's own words.
 *
 * ## No switch on a platform action
 *
 * The maintainer's ruling on the card: the platform's own actions (those a
 * kernel package ships, on `sys_user`, `sys_api_key`, `sys_sso_provider` …)
 * carry no switch anywhere. {@link useActionLedger} offers one only for a
 * package the package list serves as an app package
 * ({@link isAppPackageListed}); a kernel package, an unlisted id and a list
 * that could not be read all answer no switch. The server door is unchanged.
 */

import * as React from 'react';
import { actionErrorDetail } from '@object-ui/core';
import { apiBase } from '../../utils/apiBase.js';
import { fetchPackages, type PkgEntry } from '../studio-design/packages-io.js';
import { envelopeData, envelopeRefused } from './packagedFlows.js';
import { ledgerPageTruncated, readActionActivation, readDataRecords } from './packagedActions.js';
import { useFlowLedgerWalledReadOnly, type FlowDoorFallbacks } from './packagedFlowLedger.js';

/**
 * How many ledger rows one read asks for. The ledger holds a row only for an
 * item whose state was changed from the packaged default, so this is orders of
 * magnitude above any real installation, and a response that reports
 * `hasMore` is still refused (`ledgerPageTruncated`): a dropped row reads as
 * "active".
 */
export const ACTION_LEDGER_PAGE_SIZE = 1000;

/** The toggle's answer: the flag the server reports, or its refusal verbatim. */
export type ActionToggleOutcome = { ok: true; enabled: boolean } | { ok: false; message: string };

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * The activation EXCEPTIONS, action name → armed. Rejects on a failed or
 * truncated read with a diagnostic (untranslated, as the flow half's
 * `HTTP <status>` load errors are), never with a partial map.
 */
export async function fetchActionLedger(signal?: AbortSignal): Promise<Map<string, boolean>> {
  const res = await fetch(`${apiBase()}/data/sys_metadata_activation?top=${ACTION_LEDGER_PAGE_SIZE}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  const json = await readJson(res);
  if (!res.ok || envelopeRefused(json)) {
    throw new Error(actionErrorDetail(json, `activation ledger HTTP ${res.status}`));
  }
  if (ledgerPageTruncated(json)) {
    throw new Error(
      `activation ledger returned more than ${ACTION_LEDGER_PAGE_SIZE} rows; refusing to show a partial ledger ` +
        'because a missing row reads as "active"',
    );
  }
  return readActionActivation(readDataRecords(json));
}

/**
 * `POST /actions/_activation/:object/:action`. Never throws: a refusal comes
 * back as the server's sentence. The posture gate (403), the name collision
 * across objects (409, which names the objects) and the missing ledger (503)
 * each carry the whole of what the operator needs in that string.
 */
export async function requestActionToggle(
  objectName: string,
  name: string,
  enabled: boolean,
  fallbacks: FlowDoorFallbacks,
): Promise<ActionToggleOutcome> {
  try {
    const res = await fetch(
      `${apiBase()}/actions/_activation/${encodeURIComponent(objectName)}/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        // ⛔ EXACTLY the one key the body declares: the door refuses unknown
        // keys by name (the flow toggle's #3899 lesson).
        body: JSON.stringify({ enabled }),
      },
    );
    const json = await readJson(res);
    if (!res.ok || envelopeRefused(json)) {
      return { ok: false, message: actionErrorDetail(json, fallbacks.http(res.status)) };
    }
    const reported = envelopeData(json).enabled;
    return { ok: true, enabled: typeof reported === 'boolean' ? reported : enabled };
  } catch (e) {
    return { ok: false, message: e instanceof Error && e.message ? e.message : fallbacks.network };
  }
}

/**
 * Is `packageId` an app package — listed by the package list as a package the
 * switcher offers, and not a kernel one? Only then do its actions get a
 * switch. `null` (no package) answers no.
 */
export function isAppPackageListed(entries: readonly PkgEntry[], packageId: string | null): boolean {
  if (!packageId) return false;
  return entries.some((entry) => entry.id === packageId && entry.kernel !== true);
}

/** What a surface needs to draw the action switch for one package. */
export interface ActionLedgerHandle {
  /**
   * `true` once the package is known to be an app package and the ledger has
   * answered; `false` while either is unknown and for good on a platform
   * package. No switch is drawn until it is `true`.
   */
  offered: boolean;
  /** The ledger flag for one action: `true` when no row says otherwise. */
  enabledOf: (name: string) => boolean;
  /** The ledger read's failure, as a diagnostic; the switches stay undrawn. */
  loadError: string | null;
  /** The door refuses this caller on this deployment (the posture facts' verdict). */
  walled: boolean;
  /** The `<object>:<action>` whose flip is in flight. */
  busyKey: string | null;
  /** The server's refusal of the last flip, by `<object>:<action>`, verbatim. */
  refusalOf: (objectName: string, name: string) => string | undefined;
  /** Flip one action; resolves with the new flag, or `null` when refused. */
  toggle: (objectName: string, name: string, fallbacks: FlowDoorFallbacks) => Promise<boolean | null>;
}

const keyOf = (objectName: string, name: string) => `${objectName}:${name}`;

/**
 * The action switch's state for one read-only package's surface. `packageId`
 * `null` (a writable package, or no package) offers nothing and reads nothing.
 */
export function useActionLedger(packageId: string | null): ActionLedgerHandle {
  const walled = useFlowLedgerWalledReadOnly();
  const [appPackage, setAppPackage] = React.useState<{ for: string; app: boolean } | null>(null);
  const [ledger, setLedger] = React.useState<Map<string, boolean> | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [refusals, setRefusals] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!packageId) return;
    let cancelled = false;
    fetchPackages()
      .then((entries) => {
        if (!cancelled) setAppPackage({ for: packageId, app: isAppPackageListed(entries, packageId) });
      })
      .catch(() => {
        // An unread list is no answer: no switch, the platform-safe direction.
        if (!cancelled) setAppPackage({ for: packageId, app: false });
      });
    return () => {
      cancelled = true;
    };
  }, [packageId]);

  const app = !!packageId && appPackage?.for === packageId && appPackage.app;

  React.useEffect(() => {
    if (!app) return;
    const controller = new AbortController();
    fetchActionLedger(controller.signal)
      .then((map) => {
        if (controller.signal.aborted) return;
        setLoadError(null);
        setLedger(map);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setLedger(null);
        setLoadError(e instanceof Error && e.message ? e.message : String(e));
      });
    return () => controller.abort();
  }, [app]);

  const enabledOf = React.useCallback((name: string) => ledger?.get(name) ?? true, [ledger]);
  const refusalOf = React.useCallback(
    (objectName: string, name: string) => refusals[keyOf(objectName, name)],
    [refusals],
  );

  const toggle = React.useCallback(
    async (objectName: string, name: string, fallbacks: FlowDoorFallbacks): Promise<boolean | null> => {
      if (!ledger || walled) return null;
      const key = keyOf(objectName, name);
      setBusyKey(key);
      setRefusals((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      const outcome = await requestActionToggle(objectName, name, !(ledger.get(name) ?? true), fallbacks);
      setBusyKey(null);
      if (!outcome.ok) {
        setRefusals((prev) => ({ ...prev, [key]: outcome.message }));
        return null;
      }
      setLedger((prev) => {
        const next = new Map(prev ?? []);
        next.set(name, outcome.enabled);
        return next;
      });
      return outcome.enabled;
    },
    [ledger, walled],
  );

  return {
    offered: app && ledger !== null,
    enabledOf,
    loadError: app ? loadError : null,
    walled,
    busyKey,
    refusalOf,
    toggle,
  };
}
