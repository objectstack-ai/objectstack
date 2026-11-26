// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The landing of a dashboard the design mode just created (objectstack#36364):
 * the design mode navigates to the new dashboard with this in the navigation
 * state, and the dashboard's page opens its edit state on arrival
 * (objectstack#36372), as its Edit button does. A dashboard opened from a
 * Studio list lands the same way (objectstack#36906, `StudioAreaAppOpen`).
 * Below it, the arrival that enters the mode itself (objectstack#36907).
 *
 * Navigation state, not a URL parameter: it is a one-time instruction, not a
 * place anyone links to, so a shared or reloaded address never opens the edit
 * state by itself. The page clears it once read.
 *
 * @module
 */

/** The navigation-state key the landing rides on. */
export const DASHBOARD_EDIT_ARRIVAL_STATE = 'designModeNewDashboard';

/** The navigation state that opens the dashboard `name` for editing on arrival. */
export function dashboardEditArrival(name: string): Record<string, string> {
  return { [DASHBOARD_EDIT_ARRIVAL_STATE]: name };
}

/**
 * Whether `state` asks the page of the dashboard `name` to open its edit
 * state: only a landing that names THIS dashboard, so a history entry of
 * another dashboard opens nothing.
 */
export function readDashboardEditArrival(state: unknown, name: string | null | undefined): boolean {
  if (!name || !state || typeof state !== 'object') return false;
  return (state as Record<string, unknown>)[DASHBOARD_EDIT_ARRIVAL_STATE] === name;
}

/** `state` without the landing, for the replace that clears it once read. */
export function withoutDashboardEditArrival(state: unknown): Record<string, unknown> | null {
  if (!state || typeof state !== 'object') return null;
  const { [DASHBOARD_EDIT_ARRIVAL_STATE]: _landing, ...rest } = state as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : null;
}

/*
 * The arrival that ENTERS the mode (objectstack#36907): a Studio dashboard
 * list's 「New」 opens its app with the mode on and the 「Add menu item」
 * picker open on its dashboards, so a dashboard is made where it hangs in a
 * menu (objectstack#36364), never outside every menu (epic objectstack#36359).
 *
 * Navigation state, never a URL parameter: the mode has no address, so no
 * link and no reload enters it. The app shell reads it once (`useDesignModeArrival`),
 * asks the mode to enter, and clears it from the history entry, so Back or a
 * reload enters nothing. A refused entry does nothing more: the mode says why.
 */

/** The navigation-state key the entering arrival rides on. */
export const DESIGN_MODE_ADD_DASHBOARD_ARRIVAL_STATE = 'designModeAddDashboard';

/** What the entering arrival carries: the Studio list it came from, or `null`. */
export interface DesignModeAddDashboardArrival {
  /** The Studio list the new dashboard's × goes back to (`?studio=`), or `null`. */
  readonly studioReturn: string | null;
}

/**
 * The navigation state that enters the mode on arrival and opens the
 * 「Add menu item」 picker on its dashboards; `studioReturn` is the Studio list
 * the dashboard created there goes back to.
 */
export function designModeAddDashboardArrival(studioReturn: string | null): Record<string, unknown> {
  return { [DESIGN_MODE_ADD_DASHBOARD_ARRIVAL_STATE]: { studioReturn } };
}

/** The entering arrival `state` carries, or `null`. */
export function readDesignModeAddDashboardArrival(state: unknown): DesignModeAddDashboardArrival | null {
  if (!state || typeof state !== 'object') return null;
  const arrival = (state as Record<string, unknown>)[DESIGN_MODE_ADD_DASHBOARD_ARRIVAL_STATE];
  if (!arrival || typeof arrival !== 'object') return null;
  const studioReturn = (arrival as Record<string, unknown>).studioReturn;
  return { studioReturn: typeof studioReturn === 'string' && studioReturn ? studioReturn : null };
}

/** `state` without the entering arrival, for the replace that clears it once read. */
export function withoutDesignModeAddDashboardArrival(state: unknown): Record<string, unknown> | null {
  if (!state || typeof state !== 'object') return null;
  const { [DESIGN_MODE_ADD_DASHBOARD_ARRIVAL_STATE]: _arrival, ...rest } = state as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : null;
}
