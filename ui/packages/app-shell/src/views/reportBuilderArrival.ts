// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The landing that opens a report's builder on arrival (objectstack#36374): a
 * door that has just made a report (the design mode's Add menu item,
 * objectstack#36364) navigates to the report's page with this in the
 * navigation state, and the page opens the builder as its 「Edit」 does.
 *
 * Navigation state, not a URL parameter: it is a one-time instruction, not a
 * place anyone links to, so a shared or reloaded address never opens the
 * builder by itself. The page clears it once read.
 *
 * @module
 */

/** The navigation-state key the landing rides on. */
export const REPORT_BUILDER_ARRIVAL_STATE = 'openReportBuilder';

/** The navigation state that opens the builder of the report `name` on arrival. */
export function reportBuilderArrival(name: string): Record<string, string> {
  return { [REPORT_BUILDER_ARRIVAL_STATE]: name };
}

/**
 * Whether `state` asks the page of the report `name` to open its builder:
 * only a landing that names THIS report, so a history entry of another report
 * opens nothing.
 */
export function readReportBuilderArrival(state: unknown, name: string | null | undefined): boolean {
  if (!name || !state || typeof state !== 'object') return false;
  return (state as Record<string, unknown>)[REPORT_BUILDER_ARRIVAL_STATE] === name;
}

/** `state` without the landing, for the replace that clears it once read. */
export function withoutReportBuilderArrival(state: unknown): Record<string, unknown> | null {
  if (!state || typeof state !== 'object') return null;
  const { [REPORT_BUILDER_ARRIVAL_STATE]: _landing, ...rest } = state as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : null;
}
