// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The landing of a dashboard the design mode just created (objectstack#36364):
 * the design mode navigates to the new dashboard with this in the navigation
 * state, and the dashboard's page opens its edit state on arrival
 * (objectstack#36372), as its Edit button does.
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
