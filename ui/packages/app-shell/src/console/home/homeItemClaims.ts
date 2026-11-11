// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which Home card is drawing an item, so the same item is said once.
 *
 * Home stacks several cards above the apps, mounted by different owners: the
 * first-run checklist (the console's Home route), the deployment notice and the
 * Connect an AI Assistant card (this package's `HomePage`). Two of their items
 * overlap — "no email service is set up" and "connect an AI assistant" — and
 * each card decides on its own reads whether to draw them. This store is where
 * a card says "I am drawing this item now", and where another card asks.
 *
 * Who yields to whom is decided at the call sites, not here:
 *  - `mail`: the deployment notice claims it while it draws its email line on
 *    Home (what the notice states is ruled, so it never yields); the
 *    checklist's Email delivery row stands aside meanwhile.
 *  - `connect_assistant`: the checklist claims it while it draws its Connect
 *    an AI assistant row, not yet done; Home's card stands aside meanwhile.
 *
 * A claim lasts while the claiming component is mounted and says it draws the
 * item; unmounting or hiding releases it, and the yielding card comes back.
 * Module state, scoped to the page: nothing is stored.
 */

import { useEffect, useSyncExternalStore } from 'react';

/** The items more than one Home card can draw. */
export type HomeItem = 'mail' | 'connect_assistant';

const claims = new Map<HomeItem, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function claimed(item: HomeItem): boolean {
  return (claims.get(item) ?? 0) > 0;
}

/** Say this component draws `item` on Home for as long as `drawing` is true. */
export function useHomeItemClaim(item: HomeItem, drawing: boolean): void {
  useEffect(() => {
    if (!drawing) return undefined;
    claims.set(item, (claims.get(item) ?? 0) + 1);
    emit();
    return () => {
      const left = (claims.get(item) ?? 1) - 1;
      if (left > 0) claims.set(item, left);
      else claims.delete(item);
      emit();
    };
  }, [item, drawing]);
}

/** Whether some Home card is drawing `item` now. */
export function useHomeItemClaimed(item: HomeItem): boolean {
  return useSyncExternalStore(
    subscribe,
    () => claimed(item),
    () => false,
  );
}
