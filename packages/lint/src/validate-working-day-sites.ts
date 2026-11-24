// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0157 D4/D6 (#35356): where the working-day functions (`addWorkingDays`,
 * `workingDaysBetween`, `addWorkingHours`) cannot count.
 *
 * The engine loads a working calendar for exactly two sites: a formula field's
 * and a stored field's `expression`, evaluated on the server. Every other
 * expression is handed none, so a call there throws on every evaluation and the
 * site's own fault outcome applies. `validate-expressions.ts` refuses the call
 * at the predicate and flow-value sites it judges ({@link workingDayElsewhereMessage});
 * this module adds the two value sites that pass does not walk:
 *
 * - a field's expression `defaultValue` (a `{ dialect, source }` envelope; a
 *   bare string there is a literal): the engine's default step evaluates it
 *   with no calendar, logs the fault and leaves the field unset, so every
 *   insert would land a blank due date;
 * - a seed record's expression value (`data[].records`, a `cel` value at any
 *   depth): the seed loader evaluates it with no calendar either.
 *
 * Both are refused with the D6 prescription: store the due time in a field
 * whose `expression` calls the function.
 */

import { WORKING_DAY_FUNCTIONS, callsWorkingDayFunction } from '@objectstack/formula';
import { recordsOf } from './object-graph.js';
import type { ExprIssue } from './validate-expressions.js';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** The CEL source of an expression envelope, or `undefined` for anything else (a bare string is a literal at a value site). */
function envelopeSource(raw: unknown): string | undefined {
  if (!isRec(raw) || typeof raw.source !== 'string') return undefined;
  if (raw.dialect !== undefined && raw.dialect !== 'cel') return undefined;
  return raw.source;
}

/** The raw CEL source behind an expression slot (string or `{ dialect, source }`). */
function celSourceOf(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : envelopeSource(raw);
}

/**
 * The refusal of a working-day call at a site the engine loads no calendar
 * for, prescribing the stored due time (D6). `undefined` when `raw` calls none
 * of the three.
 */
export function workingDayElsewhereMessage(raw: unknown): string | undefined {
  const source = celSourceOf(raw);
  if (!callsWorkingDayFunction(source)) return undefined;
  const called = WORKING_DAY_FUNCTIONS.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(source!));
  const names = called.map((fn) => `${fn}()`).join(', ');
  return `${names} counts with the organization's working calendar, which the engine loads only for a ` +
    "formula field's or a computed field's `expression`; here it has no calendar and fails on every evaluation, " +
    'and no calendar arithmetic runs as a database filter. Store the due time instead: give the object a ' +
    `datetime field whose \`expression\` calls ${called[0]}(), computed when the record is written, and read ` +
    'or compare that field here.';
}

/** Which collections one run judges: the publish gate narrows them per write type. */
export interface WorkingDayValueSiteScope {
  /** The stack's seed data (`data[]`). */
  readonly data: boolean;
}

function refuseAt(issues: ExprIssue[], where: string, raw: unknown): void {
  const source = envelopeSource(raw);
  if (source === undefined) return;
  const message = workingDayElsewhereMessage(raw);
  if (message) issues.push({ where, message, source, severity: 'error' });
}

/** Every expression envelope in one seed value, at any depth, with its key path. */
function walkSeedValue(issues: ExprIssue[], where: string, value: unknown): void {
  if (envelopeSource(value) !== undefined) {
    refuseAt(issues, where, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkSeedValue(issues, `${where}[${i}]`, item));
    return;
  }
  if (isRec(value)) {
    for (const [key, item] of Object.entries(value)) walkSeedValue(issues, `${where}.${key}`, item);
  }
}

/** The working-day refusals at a field's expression `defaultValue` and at a seed record's expression values. */
export function workingDayValueSiteIssues(stack: AnyRec, scope: WorkingDayValueSiteScope): ExprIssue[] {
  const issues: ExprIssue[] = [];
  for (const obj of recordsOf(stack.objects)) {
    const objectName = typeof obj.name === 'string' ? obj.name : '?';
    for (const field of recordsOf(obj.fields)) {
      const fname = typeof field.name === 'string' ? field.name : '?';
      refuseAt(issues, `object '${objectName}' · field '${fname}' defaultValue`, field.defaultValue);
    }
  }
  if (scope.data && Array.isArray(stack.data)) {
    stack.data.forEach((seed, i) => {
      if (!isRec(seed)) return;
      const objectName = typeof seed.object === 'string' ? seed.object : '?';
      if (!Array.isArray(seed.records)) return;
      seed.records.forEach((record, j) => walkSeedValue(issues, `data[${i}] (object '${objectName}') · records[${j}]`, record));
    });
  }
  return issues;
}
