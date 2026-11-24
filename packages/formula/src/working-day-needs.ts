// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which working calendars an expression counts with (ADR-0157 D2, D4): read
 * off the calls it spells, so a caller can resolve exactly those calendars
 * BEFORE evaluating it. The working-day functions compute synchronously over
 * pinned data (`working-day.ts`); the calendar service is asynchronous; this is
 * the bridge, and the reason a calendar code is written as a quoted literal.
 */

import { parseCelToAst } from './cel-engine';
import { WORKING_DAY_FUNCTIONS, type WorkingDayFunction } from './working-day';

/** A call of one of the three in a CEL source: CEL has no comments, so a call is spelled this way or not at all. */
const WORKING_DAY_CALL = new RegExp(`\\b(?:${WORKING_DAY_FUNCTIONS.join('|')})\\s*\\(`);

/** Does `source` spell a call of a working-day function? A cheap scan, no parse. */
export function callsWorkingDayFunction(source: unknown): boolean {
  return typeof source === 'string' && WORKING_DAY_CALL.test(source);
}

/** The calendars one expression counts with. */
export interface WorkingDayCalendarNeeds {
  /** Some call names no calendar, so it counts with the organization default. */
  readonly default: boolean;
  /** The calendar codes calls name as quoted literals, each once, in source order. */
  readonly codes: readonly string[];
  /** The functions called with a calendar argument that is not a quoted literal, each once. */
  readonly computedCode: readonly WorkingDayFunction[];
}

const NAMES = new Set<string>(WORKING_DAY_FUNCTIONS);

/**
 * The calendars `source` counts with, or `undefined` when it calls none of the
 * three (or does not parse, which its evaluation reports). Results are cached
 * per source, bounded.
 */
export function workingDayCalendarNeeds(source: unknown): WorkingDayCalendarNeeds | undefined {
  if (!callsWorkingDayFunction(source)) return undefined;
  const text = source as string;
  const hit = cache.get(text);
  if (hit !== undefined) return hit ?? undefined;
  const found = analyze(text);
  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(text, found ?? null);
  return found;
}

const cache = new Map<string, WorkingDayCalendarNeeds | null>();
const CACHE_CAP = 512;

function analyze(source: string): WorkingDayCalendarNeeds | undefined {
  const ast = parseCelToAst(source);
  if (ast == null) return undefined;
  let usesDefault = false;
  const codes: string[] = [];
  const computed: WorkingDayFunction[] = [];
  let any = false;
  const visited = new Set<object>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const { op, args } = node as { op?: unknown; args?: unknown };
    if (op === 'call' && Array.isArray(args) && typeof args[0] === 'string' && NAMES.has(args[0]) && Array.isArray(args[1])) {
      const fn = args[0] as WorkingDayFunction;
      const callArgs = args[1] as unknown[];
      any = true;
      if (callArgs.length === 2) usesDefault = true;
      else if (callArgs.length === 3) {
        const code = callArgs[2] as { op?: unknown; args?: unknown } | undefined;
        if (code?.op === 'value' && typeof code.args === 'string') {
          if (!codes.includes(code.args)) codes.push(code.args);
        } else if (!computed.includes(fn)) computed.push(fn);
      }
    }
    if (args !== undefined) walk(args);
  };
  walk(ast);
  return any ? { default: usesDefault, codes, computedCode: computed } : undefined;
}

/**
 * The authoring refusal for a working-day call whose calendar is not a quoted
 * literal, or `undefined` when every call names its calendar that way (or
 * names none).
 */
export function computedCalendarCodeMessage(source: unknown): string | undefined {
  const needs = workingDayCalendarNeeds(source);
  if (!needs || needs.computedCode.length === 0) return undefined;
  const fns = needs.computedCode.map((fn) => `${fn}()`).join(', ');
  return `${fns} names its working calendar with an expression; write the calendar code as a quoted literal ` +
    "(`addWorkingDays(record.start, 3, 'cn_mainland')`), because the engine loads the calendars an expression " +
    'names before it evaluates it, and a computed code names a calendar nobody loaded. To choose a calendar per ' +
    "record, branch between literal calls: `record.region == 'us' ? addWorkingDays(record.start, 3, 'us') : " +
    "addWorkingDays(record.start, 3, 'cn_mainland')`.";
}
