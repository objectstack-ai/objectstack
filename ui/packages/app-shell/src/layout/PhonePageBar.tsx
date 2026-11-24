/**
 * PhonePageBar
 *
 * objectstack#35883 — a page's own top row on a phone. A page that has one (the
 * object list: 「‹」, the object's icon and name, 「⋮ More」) publishes it here,
 * and the app bar draws it in place of the app pill, the page title, the
 * search, the bell and the avatar while the page is on screen: on a phone the
 * notifications live in the bottom bar and the avatar on the app's home
 * (objectstack#35881, #35882), and the list carries its own search. The bar's
 * 「‹」 back to the app's home stays the app bar's own.
 *
 * A store rather than state in a context value: the page publishes a new
 * element on every render, and only the two small views below re-render for
 * it, never the app bar or the page.
 *
 * @module
 */

import * as React from 'react';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

export interface PhonePageBar {
  /** The page's icon (the object's), drawn before the title. */
  icon?: React.ReactNode;
  /** The page's name, the row's heading. */
  title: string;
  /** The row's right end (the list's 「⋮ More」). */
  end?: React.ReactNode;
}

interface PhonePageBarStore {
  get: () => PhonePageBar | null;
  set: (next: PhonePageBar | null) => void;
  subscribe: (listener: () => void) => () => void;
}

function createPhonePageBarStore(): PhonePageBarStore {
  let current: PhonePageBar | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (Object.is(next, current)) return;
      current = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const PhonePageBarContext = React.createContext<PhonePageBarStore | null>(null);

/** Holds the store the page publishes into and the app bar reads. `ConsoleLayout` mounts it. */
export function PhonePageBarProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createPhonePageBarStore);
  return <PhonePageBarContext.Provider value={store}>{children}</PhonePageBarContext.Provider>;
}

/**
 * The page's side: publish `bar` (or `null` for none) while mounted. Called on
 * every render with the page's current bar; withdrawn on unmount.
 */
export function usePublishPhonePageBar(bar: PhonePageBar | null): void {
  const store = React.useContext(PhonePageBarContext);
  useLayoutEffect(() => {
    store?.set(bar);
  });
  useLayoutEffect(() => () => store?.set(null), [store]);
}

const noSubscribe = () => () => {};

/** Does a page publish its own top row now? The app bar's one read of the store. */
export function useHasPhonePageBar(): boolean {
  const store = React.useContext(PhonePageBarContext);
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => !!store?.get(),
    () => false,
  );
}

function usePhonePageBar(): PhonePageBar | null {
  const store = React.useContext(PhonePageBarContext);
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, () => store?.get() ?? null, () => null);
}

/** The row's middle: the page's icon and name, the page's heading. */
export function PhonePageBarTitle() {
  const bar = usePhonePageBar();
  if (!bar) return null;
  return (
    <span className="flex min-w-0 items-center gap-2 px-1" data-testid="phone-page-bar-title">
      {bar.icon && (
        <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
          {bar.icon}
        </span>
      )}
      <h1 className="min-w-0 truncate text-base font-semibold">{bar.title}</h1>
    </span>
  );
}

/** The row's right end. */
export function PhonePageBarEnd() {
  const bar = usePhonePageBar();
  if (!bar?.end) return null;
  return (
    <div className="flex shrink-0 items-center" data-testid="phone-page-bar-end">
      {bar.end}
    </div>
  );
}
