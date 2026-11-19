// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The working-calendar service (ADR-0157 D1, D2, D8; open point 4), and the
 * write hooks that keep the two calendar objects readable.
 *
 * ## What it does, and what it leaves to the contract package
 *
 * It RESOLVES a calendar under D2 — the code the consumer names, else the
 * organization's default (`is_default`), else a refusal, never wall-clock time
 * — loads its exceptions, caches the result, and computes with the pure
 * arithmetic in `@objectstack/spec/data` (`work-calendar.ts`), which also
 * holds the refusal codes and the service contract it implements. The
 * arithmetic sits there so the working-day formula functions count with the
 * same daylight-saving rule (D11, open point 3); a caller that must compute
 * synchronously resolves here first and counts over the plain data it gets.
 *
 * ## Which organization, under whose authority (open point 4)
 *
 * The exchange-rate reader's rule (`homeAmountServing.rateOn`, ADR-0144 D5):
 * the read runs `{ isSystem: true, tenantId: <the organization> }`, so a
 * rank-and-file member — who cannot read the calendar tables — still has every
 * deadline counted through them, and one organization's calendar never counts
 * another's. The organization is the one the CALLER names
 * (`WorkCalendarRef.organizationId`): the record's own, never the ambient
 * active organization. A system-context caller across organizations (the
 * approval sweep) names each request's `organization_id`.
 *
 * ## The cache
 *
 * One entry per (organization, code-or-default), kept until a calendar or
 * exception row is written on this node (the `after*` hooks below drop every
 * entry) and at most {@link WORK_CALENDAR_CACHE_TTL_MS} — the TTL is what
 * bounds staleness on the OTHER replicas, which hear of no local write.
 * A refusal is never cached: the next computation after an administrator's
 * fix reads the rows again.
 *
 * ## The write hooks (ADR-0157 D2, D7, D10)
 *
 * `beforeInsert` / `beforeUpdate` on both objects refuse what the arithmetic
 * could not read as written, at the door, with the engine's own
 * `400 VALIDATION_FAILED` envelope and one `fields[]` entry from the closed
 * ADR-0114 catalog — so an administrator meets the refusal when saving, not a
 * consumer when counting. They judge every write, system writes included: a
 * seeded calendar with a period crossing midnight is as unreadable as a typed
 * one. Judged: the period columns (D7: no period crosses midnight; D10:
 * `24:00` is a legal end; `off` carries none, `on` carries its date's full
 * periods); `maintained_from` on or before `maintained_through`; one default
 * per organization. A create that leaves `timezone` out takes the
 * organization's `localization.timezone` (D7), stored as the calendar's own.
 */

import {
  WORK_CALENDAR_CODE_PATTERN,
  WORK_CALENDAR_WEEKDAY_FIELDS,
  WorkCalendarUnresolvedError,
  addWorkingDays,
  addWorkingHours,
  buildWorkCalendar,
  calendarDayOf,
  exceptionDayOf,
  isWorkingTime,
  parseWorkPeriods,
  workingDaysBetween,
  type WorkCalendar,
  type WorkCalendarRef,
  type WorkCalendarService as WorkCalendarServiceContract,
} from '@objectstack/spec/data';
import type { FieldErrorCode } from '@objectstack/spec/api';
import { validationFailure } from '@objectstack/types';

/** The calendar object (`@objectstack/platform-objects`). */
export const WORK_CALENDAR_OBJECT = 'sys_work_calendar';
/** The dated-exception object (`@objectstack/platform-objects`). */
export const WORK_CALENDAR_EXCEPTION_OBJECT = 'sys_work_calendar_exception';
/** The longest a cached calendar is served without a local write dropping it. */
export const WORK_CALENDAR_CACHE_TTL_MS = 60_000;
/** The `packageId` every hook below registers under, so they bind (and re-bind) as one. */
export const WORK_CALENDAR_HOOK_PACKAGE = 'objectql:work-calendar';

/** Exception rows read per page while loading one calendar. */
const EXCEPTION_PAGE = 1000;

/** The engine surface the service reads through. */
export interface WorkCalendarReadEngine {
  find(object: string, query: Record<string, unknown>): Promise<unknown[]>;
}

/** The engine surface the hooks register on. */
export interface WorkCalendarHookEngine extends WorkCalendarReadEngine {
  registerHook(event: string, handler: (ctx: any) => unknown, options?: Record<string, unknown>): void;
  unregisterHooksByPackage?(packageId: string): number;
}

export interface WorkCalendarServiceOptions {
  /** The engine, resolved per read so plugin order cannot leave the service without it. */
  getEngine: () => WorkCalendarReadEngine | undefined;
  /** Is the calendar object registered on this kernel? Without it no calendar resolves. */
  hasCalendarObject?: () => boolean;
  /** Milliseconds now — injectable for the TTL pin. */
  now?: () => number;
  ttlMs?: number;
}

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/** The elevated read context in the organization a computation belongs to (open point 4). */
function readContext(organizationId: string | undefined, transaction?: unknown): Row {
  const context: Row = { isSystem: true };
  if (organizationId !== undefined) context.tenantId = organizationId;
  if (transaction !== undefined) context.transaction = transaction;
  return context;
}

function namedCode(ref: WorkCalendarRef): string | undefined {
  const code = typeof ref.calendar === 'string' ? ref.calendar.trim() : '';
  return code === '' ? undefined : code;
}

const CODE_RE = new RegExp(WORK_CALENDAR_CODE_PATTERN);

/** ADR-0157: the calendar service. See the module note. */
export class WorkCalendarService implements WorkCalendarServiceContract {
  private readonly cache = new Map<string, { at: number; calendar: Promise<WorkCalendar> }>();

  constructor(private readonly options: WorkCalendarServiceOptions) {}

  resolve(ref: WorkCalendarRef): Promise<WorkCalendar> {
    const now = (this.options.now ?? Date.now)();
    const key = JSON.stringify([ref.organizationId ?? null, namedCode(ref) ?? null]);
    const hit = this.cache.get(key);
    if (hit && now - hit.at < (this.options.ttlMs ?? WORK_CALENDAR_CACHE_TTL_MS)) return hit.calendar;
    const calendar = this.load(ref);
    this.cache.set(key, { at: now, calendar });
    // A refusal is never cached: the next computation reads the rows again.
    calendar.catch(() => {
      if (this.cache.get(key)?.calendar === calendar) this.cache.delete(key);
    });
    return calendar;
  }

  async isWorkingTime(ref: WorkCalendarRef, at: number | Date): Promise<boolean> {
    return isWorkingTime(await this.resolve(ref), at);
  }

  async addWorkingDays(ref: WorkCalendarRef, day: string, days: number): Promise<string> {
    return addWorkingDays(await this.resolve(ref), day, days);
  }

  async workingDaysBetween(ref: WorkCalendarRef, start: string, end: string): Promise<number> {
    return workingDaysBetween(await this.resolve(ref), start, end);
  }

  async addWorkingHours(ref: WorkCalendarRef, start: number | Date, hours: number): Promise<number> {
    return addWorkingHours(await this.resolve(ref), start, hours);
  }

  invalidate(): void {
    this.cache.clear();
  }

  /** ADR-0157 D2: the named code, else the organization default, else refuse. */
  private async load(ref: WorkCalendarRef): Promise<WorkCalendar> {
    const code = namedCode(ref);
    // A code that is not a calendar code names no calendar; it is never sent
    // to the query layer, where a `{…}` spelling would read as a filter token.
    if (code !== undefined && !CODE_RE.test(code)) throw new WorkCalendarUnresolvedError('not_found', code);
    const engine = this.options.getEngine();
    // A kernel without the calendar object holds no calendar (the rate table's rule).
    if (!engine || this.options.hasCalendarObject?.() === false) {
      throw new WorkCalendarUnresolvedError(code === undefined ? 'no_default' : 'not_found', code);
    }
    const context = readContext(ref.organizationId);
    const rows = (await engine.find(WORK_CALENDAR_OBJECT, {
      where: code === undefined ? { is_default: true } : { code },
      limit: 2,
      context,
    })).filter(isRow);
    if (rows.length === 0) throw new WorkCalendarUnresolvedError(code === undefined ? 'no_default' : 'not_found', code);
    if (rows.length > 1) throw new WorkCalendarUnresolvedError('ambiguous', code);
    const calendar = rows[0]!;
    const exceptions: Row[] = [];
    for (let offset = 0; ; offset += EXCEPTION_PAGE) {
      const page = (await engine.find(WORK_CALENDAR_EXCEPTION_OBJECT, {
        where: { calendar: calendar.id },
        orderBy: [{ field: 'date', order: 'asc' }, { field: 'id', order: 'asc' }],
        limit: EXCEPTION_PAGE,
        offset,
        fields: ['date', 'kind', 'periods'],
        context,
      })).filter(isRow);
      exceptions.push(...page);
      if (page.length < EXCEPTION_PAGE) break;
    }
    return buildWorkCalendar(calendar, exceptions);
  }
}

// ── The write hooks ─────────────────────────────────────────────────────

interface FieldRefusal {
  field: string;
  code: FieldErrorCode;
  message: string;
  value?: unknown;
}

function refuse(object: string, problems: FieldRefusal[]): never {
  const noun = object === WORK_CALENDAR_OBJECT ? 'working calendar' : 'calendar exception';
  throw validationFailure(`The ${noun} cannot be saved: ${problems.map((p) => p.message).join(' ')}`, problems);
}

function hasOwn(row: Row, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

/** One period column's refusal, or none (ADR-0157 D7, D10). */
function periodsRefusal(field: string, value: unknown): FieldRefusal | undefined {
  const parsed = parseWorkPeriods(value);
  if (parsed.ok) return undefined;
  const message = `${field} ${parsed.message}.`;
  // Two plain literals, one per branch: a field-level ADR-0114 code, never `error.code`.
  if (parsed.reason === 'malformed') return { field, code: 'invalid_format', message, value };
  return { field, code: 'invalid_value', message, value };
}

/** The organization an insert row is stored in: its own, else the call's tenant, else the writer's. */
function insertOrganization(ctx: any, row: Row): string | undefined {
  for (const candidate of [row.organization_id, ctx?.input?.options?.tenantId, ctx?.session?.organizationId]) {
    if (candidate !== undefined && candidate !== null && candidate !== '') return String(candidate);
  }
  return undefined;
}

export interface WorkCalendarHookOptions {
  /** The organization's `localization.timezone`, for a create that leaves `timezone` out (ADR-0157 D7). */
  timezoneOf?: (organizationId: string | undefined) => Promise<string | undefined>;
}

/** Judge a calendar row's post-image: the columns the write carries, and the pair they belong to. */
async function judgeCalendar(
  engine: WorkCalendarReadEngine,
  ctx: any,
  data: Row,
  previous: Row | undefined,
  organizationId: string | undefined,
): Promise<void> {
  const problems: FieldRefusal[] = [];
  for (const field of WORK_CALENDAR_WEEKDAY_FIELDS) {
    if (!hasOwn(data, field)) continue;
    const refusal = periodsRefusal(field, data[field]);
    if (refusal) problems.push(refusal);
  }
  if (hasOwn(data, 'maintained_from') || hasOwn(data, 'maintained_through')) {
    const pick = (k: string) => calendarDayOf(hasOwn(data, k) ? data[k] : previous?.[k]);
    const from = pick('maintained_from');
    const through = pick('maintained_through');
    if (from !== undefined && through !== undefined && from > through) {
      problems.push({
        field: 'maintained_through',
        code: 'invalid_value',
        message: `maintained_through (${through}) is before maintained_from (${from}).`,
        value: through,
      });
    }
  }
  // One default per organization (ADR-0157 D2): judged when the write makes
  // this row a default, against every OTHER default the organization holds.
  if (data.is_default === true && previous?.is_default !== true) {
    const others = (await engine.find(WORK_CALENDAR_OBJECT, {
      where: { is_default: true },
      fields: ['id', 'code'],
      limit: 2,
      context: readContext(organizationId, ctx?.transaction),
    })).filter(isRow).filter((r) => previous === undefined || String(r.id) !== String(previous.id));
    if (others.length > 0) {
      problems.push({
        field: 'is_default',
        code: 'invalid_value',
        message: `The calendar '${String(others[0]!.code ?? others[0]!.id)}' is already the default in this organization; clear its Default flag first.`,
        value: true,
      });
    }
  }
  if (problems.length > 0) refuse(WORK_CALENDAR_OBJECT, problems);
}

/** Judge an exception row's post-image (ADR-0157 D10) when the write carries its kind or periods. */
function judgeException(data: Row, previous: Row | undefined): void {
  if (!hasOwn(data, 'kind') && !hasOwn(data, 'periods')) return;
  const post: Row = { ...(previous ?? {}), ...data };
  if (post.kind !== 'off' && post.kind !== 'on') return; // the select's own door answers it
  const day = exceptionDayOf(post);
  if (typeof day !== 'string') return;
  const malformed = periodsRefusal('periods', post.periods);
  const message = `This exception ${day}.`;
  if (post.kind === 'off') {
    refuse(WORK_CALENDAR_EXCEPTION_OBJECT, [{ field: 'periods', code: 'invalid_value', message, value: post.periods }]);
  }
  refuse(WORK_CALENDAR_EXCEPTION_OBJECT, [
    malformed ?? { field: 'periods', code: 'required', message, value: post.periods },
  ]);
}

/**
 * Bind the hooks on the engine — idempotently: a re-run replaces the binding.
 * Returns `false`, after saying so at `warn`, when the engine has no hook
 * registry (a test double): the refusals and the cache invalidation are then
 * not in force.
 */
export function installWorkCalendarHooks(
  engine: WorkCalendarHookEngine | null | undefined,
  service: Pick<WorkCalendarService, 'invalidate'>,
  options: WorkCalendarHookOptions = {},
  logger?: { warn?: (msg: string) => void },
): boolean {
  if (!engine || typeof engine.registerHook !== 'function') {
    logger?.warn?.(
      '[objectql] the engine exposes no hook registry — working-calendar rows are NOT validated at write, ' +
        'and the calendar cache is dropped only by its TTL',
    );
    return false;
  }
  engine.unregisterHooksByPackage?.(WORK_CALENDAR_HOOK_PACKAGE);
  const bind = (event: string, object: string | string[], handler: (ctx: any) => unknown) =>
    engine.registerHook(event, handler, { object, packageId: WORK_CALENDAR_HOOK_PACKAGE });

  bind('beforeInsert', WORK_CALENDAR_OBJECT, async (ctx: any) => {
    const row = ctx?.input?.data;
    if (!isRow(row)) return;
    const organizationId = insertOrganization(ctx, row);
    const zone = row.timezone;
    if ((zone === undefined || zone === null || zone === '') && options.timezoneOf) {
      const fallback = await options.timezoneOf(organizationId);
      if (fallback) row.timezone = fallback;
    }
    await judgeCalendar(engine, ctx, row, undefined, organizationId);
  });
  bind('beforeUpdate', WORK_CALENDAR_OBJECT, async (ctx: any) => {
    const data = ctx?.input?.data;
    const previous = isRow(ctx?.previous) ? ctx.previous : undefined;
    if (!isRow(data) || !previous) return;
    const org = previous.organization_id;
    await judgeCalendar(engine, ctx, data, previous, org === undefined || org === null || org === '' ? undefined : String(org));
  });
  bind('beforeInsert', WORK_CALENDAR_EXCEPTION_OBJECT, (ctx: any) => {
    const row = ctx?.input?.data;
    if (isRow(row)) judgeException(row, undefined);
  });
  bind('beforeUpdate', WORK_CALENDAR_EXCEPTION_OBJECT, (ctx: any) => {
    const data = ctx?.input?.data;
    if (isRow(data) && isRow(ctx?.previous)) judgeException(data, ctx.previous);
  });
  const both = [WORK_CALENDAR_OBJECT, WORK_CALENDAR_EXCEPTION_OBJECT];
  for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) bind(event, both, () => service.invalidate());
  return true;
}
