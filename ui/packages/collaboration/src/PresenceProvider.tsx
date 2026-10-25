/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import type { PresenceUser } from './usePresence.js';

/**
 * Scope key for record-level presence ("who else is viewing this record").
 */
export interface RecordPresenceScope {
  objectName: string;
  recordId: string;
}

/**
 * Transport-agnostic source of presence updates. Implementations would
 * typically be backed by a WebSocket / SSE channel; the platform ships a
 * no-op default so consumers can read presence hooks unconditionally and
 * simply render nothing until a real transport is wired in.
 *
 * Both `subscribeTenant` and `subscribeRecord` follow the same contract:
 *
 *   1. Push the *current* known user list to the callback synchronously
 *      (or as soon as it's available).
 *   2. Push subsequent updates as users join / leave / change status.
 *   3. Return an unsubscribe function that the hook will invoke on unmount
 *      or when the scope changes.
 */
export interface PresenceSource {
  /** Tenant-wide "who else is online in this workspace". */
  subscribeTenant?: (cb: (users: PresenceUser[]) => void) => () => void;
  /** Record-scoped "who else is viewing this record". */
  subscribeRecord?: (
    scope: RecordPresenceScope,
    cb: (users: PresenceUser[]) => void,
  ) => () => void;
}

const NOOP_SOURCE: PresenceSource = {};

const PresenceContext = React.createContext<PresenceSource>(NOOP_SOURCE);

export interface PresenceProviderProps {
  /**
   * Concrete presence source. When omitted, all presence hooks resolve to
   * an empty user list — useful for development and for environments
   * without a realtime transport yet.
   */
  source?: PresenceSource;
  children: React.ReactNode;
}

/**
 * Provides a presence source to descendants. Wrap the application shell
 * once; nested components consume the source via `useTenantPresence()`
 * or `useRecordPresence()`.
 *
 * The default value is a no-op source so unwrapped trees still render
 * correctly — the hooks simply return `[]`.
 */
export function PresenceProvider({ source, children }: PresenceProviderProps) {
  const value = source ?? NOOP_SOURCE;
  return (
    <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
  );
}

/**
 * Read tenant-wide presence ("who else is in this workspace right now").
 * Returns an empty array when no `PresenceProvider` is mounted or the
 * source doesn't implement `subscribeTenant`.
 */
export function useTenantPresence(): PresenceUser[] {
  const source = React.useContext(PresenceContext);
  const [users, setUsers] = React.useState<PresenceUser[]>([]);

  React.useEffect(() => {
    if (!source.subscribeTenant) {
      setUsers([]);
      return;
    }
    return source.subscribeTenant((next) => {
      setUsers(Array.isArray(next) ? next : []);
    });
  }, [source]);

  return users;
}

/**
 * Read presence for a specific record ("who else is viewing this customer
 * detail page"). Returns an empty array when no `PresenceProvider` is
 * mounted, the source doesn't implement `subscribeRecord`, or the scope
 * is incomplete.
 */
export function useRecordPresence(
  objectName: string | undefined,
  recordId: string | undefined,
): PresenceUser[] {
  const source = React.useContext(PresenceContext);
  const [users, setUsers] = React.useState<PresenceUser[]>([]);

  React.useEffect(() => {
    if (!source.subscribeRecord || !objectName || !recordId) {
      setUsers([]);
      return;
    }
    return source.subscribeRecord(
      { objectName, recordId },
      (next) => {
        setUsers(Array.isArray(next) ? next : []);
      },
    );
  }, [source, objectName, recordId]);

  return users;
}

/**
 * Internal-only test helper that exposes the raw context value. Not part
 * of the stable API; do not import from outside the package.
 *
 * @internal
 */
export function __unsafe_usePresenceContext(): PresenceSource {
  // This IS a hook (a thin useContext wrapper that must be called under the
  // Rules of Hooks); the `__unsafe_` prefix is a deliberate danger signal for
  // this @internal test-only accessor, so the name doesn't start with `use`.
  // Scoped disable rather than renaming away the intentional prefix.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return React.useContext(PresenceContext);
}
