// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The place a new report is being built for (objectstack#36364, report half).
 *
 * 「New report…」 in the design mode's 「Add menu item」 cannot create the
 * report from a name: the spec refuses a report without `dataset` and
 * `values`. So the menu holds the place (its dashed row stays), offers this
 * slot, and opens the report builder at the app's `reports/new`. The builder
 * fills it: its Save hands the report here, and the menu creates it in the
 * menu's package and saves its entry in the held place with every other
 * staged design change, in one act (`saveAppMenuWithNewItem`). Its Close
 * cancels: the held place is dropped and nothing is written.
 *
 * The menu (in the sidebar) and the builder (in the page) are not in one
 * tree that could pass a callback down, so the slot is held here, one at a
 * time. The menu withdraws it when it unmounts, which is when the design mode
 * ends, so the builder never saves into a mode that is gone: without a slot
 * it is the plain new-report page.
 *
 * @module
 */

import * as React from 'react';

/** What the builder's Save and Close do while a menu place waits for the report. */
export interface NewReportSlot {
  /** The app whose menu holds the place. */
  readonly appName: string;
  /**
   * Create the report `name` with `body` (its `label` the one the builder
   * shows) and save the menu with its entry. `false` when nothing was saved:
   * the design mode has said why, and the builder stays open.
   */
  readonly save: (name: string, label: string, body: Record<string, unknown>) => Promise<boolean>;
  /** Drop the held place; nothing is written. */
  readonly cancel: () => void;
}

let current: NewReportSlot | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Offer `slot` to the builder, in place of any slot offered before. */
export function offerNewReportSlot(slot: NewReportSlot): void {
  current = slot;
  emit();
}

/** Withdraw `slot`, if it is still the one offered. */
export function withdrawNewReportSlot(slot: NewReportSlot): void {
  if (current !== slot) return;
  current = null;
  emit();
}

/** The slot offered for `appName`, or `null`. */
export function newReportSlotFor(appName: string | undefined): NewReportSlot | null {
  return current && appName && current.appName === appName ? current : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The slot offered for `appName`, read as it changes. */
export function useNewReportSlot(appName: string | undefined): NewReportSlot | null {
  const slot = React.useSyncExternalStore(subscribe, () => current, () => null);
  return slot && appName && slot.appName === appName ? slot : null;
}
