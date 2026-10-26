/**
 * useSettleSignal — React binding for the global in-flight/idle signal.
 *
 * Subscribes to the app-shell settle counter (ADR-0054 C5) so a component can
 * render a global busy indicator or gate UI on "no requests in flight".
 *
 * @example
 * const { pending, idle } = useSettleSignal();
 * return idle ? null : <GlobalSpinner count={pending} />;
 *
 * @module
 */

import { useSyncExternalStore } from 'react';
import {
  getPendingRequests,
  subscribeSettle,
} from '../observability/settleSignal.js';

export interface SettleSignalState {
  /** Number of requests currently in flight. */
  pending: number;
  /** Whether the app is idle (no requests in flight). */
  idle: boolean;
}

export function useSettleSignal(): SettleSignalState {
  const pending = useSyncExternalStore(
    subscribeSettle,
    getPendingRequests,
    // SSR/server snapshot — there is no client request activity yet.
    () => 0,
  );
  return { pending, idle: pending === 0 };
}
