// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Page commands — what the page behind the ⌘K palette offers it, published by
 * the page beside the control that runs it (objectstack#36286).
 *
 * The palette's "Current page" group lists a page's 「Add view」 and 「Edit」.
 * Neither can be recomputed where the palette is mounted: the list's create
 * card is state inside its view switcher, and the record's Edit is offered
 * by a verdict only the record page holds (approval lock, `edit.visibleWhen`
 * / `disabledWhen`, the state lock, the edit state). So the page publishes
 * the command it draws, with the handler its own control runs and the
 * verdict its own control is drawn under, for exactly as long as that
 * control is drawn; the palette lists what is published. Nothing is derived
 * twice, so the row and the page's control cannot disagree.
 *
 * A module store rather than a context, for the reason `advertisedShortcuts`
 * gives: the publishers sit on a different branch of the tree from the
 * palette.
 *
 * @module
 */

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

/** The commands a page can publish, one per control. */
export type PageCommandId = 'add-view' | 'edit-record';

export interface PageCommand {
  id: PageCommandId;
  /** Runs what the page's control runs. */
  run: () => void;
  /** The page's control is drawn but off: the row is listed, and off. */
  disabled?: boolean;
  /** Why it is off, as the page's control says it. */
  disabledReason?: string;
}

/** What the palette reads: a command's state, and a `run` that calls the latest handler. */
export interface PublishedPageCommand {
  id: PageCommandId;
  disabled: boolean;
  disabledReason?: string;
  run: () => void;
}

interface Holding {
  /** The publisher's latest command; its `run` changes every render. */
  command: PageCommand;
}

// Publishers in the order they published: the last one of an id is listed.
const holdings: Holding[] = [];
const listeners = new Set<() => void>();
let snapshot: readonly PublishedPageCommand[] = [];

function shownState(command: PageCommand): string {
  return JSON.stringify([command.id, !!command.disabled, command.disabledReason ?? '']);
}

function commit(): void {
  const byId = new Map<PageCommandId, Holding>();
  for (const holding of holdings) byId.set(holding.command.id, holding);
  snapshot = Array.from(byId.values(), (holding) => ({
    id: holding.command.id,
    disabled: !!holding.command.disabled,
    disabledReason: holding.command.disabledReason,
    // Read at the press, so the handler is the publisher's latest render's.
    run: () => holding.command.run(),
  }));
  for (const listener of listeners) listener();
}

/**
 * Publish `command` (or `null` for none) while the calling component is
 * mounted. Call it on every render, beside the control the command names,
 * under the same condition that control is drawn under.
 */
export function usePublishPageCommand(command: PageCommand | null): void {
  const holdingRef = useRef<Holding | null>(null);
  useLayoutEffect(() => {
    const holding = holdingRef.current;
    if (!command) {
      if (holding) {
        holdings.splice(holdings.indexOf(holding), 1);
        holdingRef.current = null;
        commit();
      }
      return;
    }
    if (!holding) {
      holdingRef.current = { command };
      holdings.push(holdingRef.current);
      commit();
      return;
    }
    const before = shownState(holding.command);
    holding.command = command;
    // A new handler alone is not a change the palette draws.
    if (shownState(command) !== before) commit();
  });
  useLayoutEffect(
    () => () => {
      const holding = holdingRef.current;
      if (!holding) return;
      holdings.splice(holdings.indexOf(holding), 1);
      holdingRef.current = null;
      commit();
    },
    [],
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly PublishedPageCommand[] {
  return snapshot;
}

/** The commands the page publishes right now. */
export function usePageCommands(): readonly PublishedPageCommand[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
