// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The working calendars a formula's working-day functions count with (ADR-0157 D2, D4, D8)
 *
 * `addWorkingDays()`, `workingDaysBetween()` and `addWorkingHours()`
 * (`@objectstack/formula`) compute synchronously over the calendars an
 * evaluation is handed (`EvalContext.workCalendars`); the calendar service
 * (`WorkCalendarService`, `work-calendar-service.ts`) resolves asynchronously.
 * This module is where the engine resolves, before a formula plan is
 * evaluated, exactly the calendars the plan's expressions name
 * (`workingDayCalendarNeeds`: the organization default for a call with no
 * code, and each code a call spells as a quoted literal).
 *
 * ## In which organization (open point 4)
 *
 * The record's own: `organization_id` on the row, else the read's tenant
 * (`ExecutionContext.tenantId`, the organization a row read under a wall
 * belongs to when its projection left the column out). The service refuses a
 * computation that names no organization outside the `single` posture, so a
 * system read across organizations that names none gets that refusal, never a
 * calendar of whichever organization holds one.
 *
 * ## The cache, and a calendar edit
 *
 * The service's own (one entry per organization and code, dropped on every
 * calendar or exception write on this node, at most its TTL elsewhere): this
 * module keeps nothing between evaluations. A refusal is never cached there,
 * so the read after an administrator's fix counts.
 *
 * ## A refusal is data
 *
 * A calendar that did not resolve is handed to the evaluation as its refusal,
 * which the function throws: the formula reads blank, and the engine logs one
 * line naming the object, the field and the refusal (D8) through its formula
 * fault sink. A kernel without the calendar service holds no calendar, and
 * refuses as the service refuses then.
 */

import type { WorkCalendarRef } from '@objectstack/spec/contracts';
import type { WorkCalendar } from '@objectstack/spec/data';
import {
  WorkCalendarUnresolvedError,
  workingDayCalendarNeeds,
  type EvalWorkCalendar,
  type EvalWorkCalendars,
} from '@objectstack/formula';

/** The slice of the calendar service this module reads. */
export interface FormulaWorkCalendarResolver {
  resolve(ref: WorkCalendarRef): Promise<WorkCalendar>;
}

/** The calendars of one row's organization, or `undefined` when the plan calls no working-day function. */
export type FormulaWorkCalendars = (row: Record<string, unknown>) => EvalWorkCalendars | undefined;

/** The slice of a formula plan entry this module reads: its expression. */
interface PlannedExpression {
  readonly expression: unknown;
}

function sourceOf(expression: unknown): string | undefined {
  const expr = expression as { source?: unknown; dialect?: unknown } | string | undefined;
  if (typeof expr === 'string') return expr;
  if (expr && typeof expr === 'object' && (expr.dialect === undefined || expr.dialect === 'cel')) {
    return typeof expr.source === 'string' ? expr.source : undefined;
  }
  return undefined;
}

/** The union of the calendars every entry of `plan` names, or `undefined` when none calls a working-day function. */
export function planWorkCalendarNeeds(
  plan: ReadonlyArray<PlannedExpression>,
): { default: boolean; codes: string[] } | undefined {
  let any = false;
  let usesDefault = false;
  const codes: string[] = [];
  for (const entry of plan) {
    const needs = workingDayCalendarNeeds(sourceOf(entry.expression));
    if (!needs) continue;
    any = true;
    if (needs.default) usesDefault = true;
    for (const code of needs.codes) if (!codes.includes(code)) codes.push(code);
  }
  return any ? { default: usesDefault, codes } : undefined;
}

function organizationOf(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

/** One resolution, settled: the calendar, or the refusal it met, as data. */
async function settle(service: FormulaWorkCalendarResolver | undefined, ref: WorkCalendarRef): Promise<EvalWorkCalendar> {
  const code = typeof ref.calendar === 'string' ? ref.calendar : undefined;
  // A kernel without the service holds no calendar: the service's own refusal then.
  if (!service) return new WorkCalendarUnresolvedError(code === undefined ? 'no_default' : 'not_found', code);
  try {
    return await service.resolve(ref);
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Resolve the calendars `plan` names for each organization `rows` belong to,
 * and answer each row's binding. `undefined` when no entry of `plan` calls a
 * working-day function, so a read whose formulas call none pays one source
 * scan per formula and nothing else.
 */
export async function resolveFormulaWorkCalendars(
  service: FormulaWorkCalendarResolver | undefined,
  plan: ReadonlyArray<PlannedExpression>,
  rows: ReadonlyArray<Record<string, unknown> | null | undefined>,
  context: { tenantId?: unknown } | undefined,
): Promise<FormulaWorkCalendars | undefined> {
  const needs = planWorkCalendarNeeds(plan);
  if (!needs) return undefined;
  const fallback = organizationOf(context?.tenantId);
  const orgOf = (row: Record<string, unknown> | null | undefined): string | undefined =>
    organizationOf(row?.organization_id) ?? fallback;
  const keyOf = (org: string | undefined) => org ?? '';
  const organizations = new Map<string, string | undefined>();
  for (const row of rows) {
    if (row == null) continue;
    const org = orgOf(row);
    organizations.set(keyOf(org), org);
  }
  if (organizations.size === 0) organizations.set(keyOf(fallback), fallback);
  const bindings = new Map<string, EvalWorkCalendars>();
  await Promise.all([...organizations].map(async ([key, organizationId]) => {
    const [defaultCalendar, ...named] = await Promise.all([
      needs.default ? settle(service, { organizationId }) : Promise.resolve(undefined),
      ...needs.codes.map((calendar) => settle(service, { organizationId, calendar })),
    ]);
    const byCode: Record<string, EvalWorkCalendar> = {};
    needs.codes.forEach((code, i) => { byCode[code] = named[i]!; });
    bindings.set(key, defaultCalendar === undefined ? { byCode } : { default: defaultCalendar, byCode });
  }));
  return (row) => bindings.get(keyOf(orgOf(row)));
}
