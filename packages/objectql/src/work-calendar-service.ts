// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The working-calendar service (ADR-0157 D1, D2, D8; open point 4), and the
 * write hooks that keep the two calendar objects readable.
 *
 * ## What it does, and what it leaves to the other packages
 *
 * It RESOLVES a calendar under D2 — the code the consumer names, else the
 * organization's default (`is_default`), else a refusal, never wall-clock time
 * — loads its exceptions, caches the result, and computes with the pure
 * arithmetic in `@objectstack/formula` (`work-calendar.ts`), which also holds
 * the three error classes. The arithmetic sits there so the working-day
 * formula functions count with the same daylight-saving rule (D11, open point
 * 3); a caller that must compute synchronously resolves here first and counts
 * over the plain, frozen data it gets. The contract it implements is
 * `IWorkCalendarService` (`@objectstack/spec/contracts`); the codes, column
 * names and the `WorkCalendar` shape are `@objectstack/spec/data`'s.
 *
 * ## Which organization, under whose authority (open point 4)
 *
 * The exchange-rate reader's rule (`homeAmountServing.rateOn`, ADR-0144 D5):
 * the read runs `{ isSystem: true, tenantId: <the organization> }`, so a
 * rank-and-file member — who cannot read the calendar tables — still has every
 * deadline counted through them. The organization is the one the CALLER names
 * (`WorkCalendarRef.organizationId`): the record's own, never the ambient
 * active organization. A system-context caller across organizations (the
 * approval sweep) names each request's `organization_id`.
 *
 * A computation that names NO organization is refused
 * `ERR_WORK_CALENDAR_UNRESOLVED` (`no_organization`) before any read, the
 * cache's included, in every tenancy posture but `single` (the engine's own
 * reading, `resolveEnginePosture`). An elevated read without an organization
 * carries no scope under a wall, so a code or a default would resolve in
 * whichever organization happened to hold one; refusing it is what keeps one
 * organization's calendar from counting another's. Under `single` there is one
 * logical tenant and the read runs unscoped, as before.
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
 * per organization; an exception's calendar is one of its own organization's.
 * A create that leaves `timezone` out takes the
 * organization's `localization.timezone` (D7), stored as the calendar's own.
 *
 * The hooks take the organization from the session, every writer's alike: a
 * seed or an import writes under its organization's tenant, so its session
 * names it. An update reads in the stored row's own organization. Outside the
 * `single` posture no hook reads without an organization, the service's rule.
 *
 * A create whose row names an organization other than the session's is not
 * read for, so its one-default judgement cannot run where the row lands: when
 * it sets `is_default` it is refused at the door, before any read — write it
 * under that organization, or set the default afterwards by an update, which
 * is judged in the stored row's own organization. A future seed that sets a
 * calendar's default must therefore load pinned to its organization, or set
 * the default by an update afterwards. Such a create without a default passes,
 * and gets no time-zone fill.
 *
 * A calendar, and each of its exception dates, stays in the organization it
 * was created in: an update whose `organization_id` differs from the stored
 * row's is refused at the door on `organization_id`, before any read, every
 * writer's alike, system writes included. To have the calendar in another
 * organization, create it there. An update that repeats the stored
 * organization is no change and is judged as any other edit. A predicate
 * update is judged row by row, as the engine hands the hook each matched row
 * with its stored image: one matched row whose organization would change
 * refuses the whole write.
 *
 * An exception date names a calendar of its own organization. On a create,
 * and on an update that carries `calendar`, the hooks read the calendar by id
 * in the exception's organization (the session's on a create, by the rule
 * above; the stored row's on an update) and refuse on `calendar` when none
 * comes back. A calendar of another organization and an id that names no
 * calendar meet the same refusal, word for word, so it tells a writer nothing
 * about any other organization. A create the hooks cannot read for (its row
 * names an organization other than the session's, or it has no organization
 * outside `single`) is refused the same way: write it under its organization.
 */

import {
  WORK_CALENDAR_CODE_PATTERN,
  WORK_CALENDAR_WEEKDAY_FIELDS,
  type WorkCalendar,
} from '@objectstack/spec/data';
import type { IWorkCalendarService, WorkCalendarRef } from '@objectstack/spec/contracts';
import type { FieldErrorCode } from '@objectstack/spec/api';
import type { TenancyPosture } from '@objectstack/spec/security';
import {
  WorkCalendarUnresolvedError,
  addWorkingDays,
  addWorkingHours,
  buildWorkCalendar,
  calendarDayOf,
  exceptionDayOf,
  isWorkingTime,
  parseWorkPeriods,
  workingDaysBetween,
} from '@objectstack/formula';
import { validationFailure } from '@objectstack/types';
import { resolveEnginePosture } from './engine-driver-options.js';

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
  /**
   * The tenancy posture, read per computation. Omitted, it is the posture the
   * engine from `getEngine` enforces ({@link enginePostureOf}).
   */
  posture?: () => TenancyPosture;
  /** Milliseconds now — injectable for the TTL pin. */
  now?: () => number;
  ttlMs?: number;
}

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored or carried organization id, or `undefined` for none. */
function organizationOf(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

/**
 * The tenancy posture an engine enforces, through the engine's own reader
 * (`resolveEnginePosture`), read live: the posture SecurityPlugin injected on
 * the engine, else the deployment's configuration, else `isolated` when that
 * cannot be read.
 */
export function enginePostureOf(engine?: unknown): TenancyPosture {
  const provider = (engine as { tenancyPostureProvider?: () => string | undefined } | null | undefined)?.tenancyPostureProvider;
  return resolveEnginePosture.call({ tenancyPostureProvider: provider });
}

/** Where the hooks' elevated reads run; `read: false` when they make none. */
interface ReadScope {
  read: boolean;
  organizationId?: string | undefined;
  /** The create's row names an organization other than the session's. */
  elsewhere?: boolean;
}

/** May an elevated calendar read run in `organizationId`? Not without one, outside `single`. */
function mayReadIn(organizationId: string | undefined, posture: TenancyPosture): boolean {
  return organizationId !== undefined || posture === 'single';
}

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
export class WorkCalendarService implements IWorkCalendarService {
  private readonly cache = new Map<string, { at: number; calendar: Promise<WorkCalendar> }>();

  constructor(private readonly options: WorkCalendarServiceOptions) {}

  resolve(ref: WorkCalendarRef): Promise<WorkCalendar> {
    // No organization, outside `single`: refused before any read, the cache's
    // included, so a calendar resolved under another posture is never served.
    const posture = this.options.posture?.() ?? enginePostureOf(this.options.getEngine());
    if (!mayReadIn(organizationOf(ref.organizationId), posture)) {
      return Promise.reject(new WorkCalendarUnresolvedError('no_organization', namedCode(ref)));
    }
    const now = (this.options.now ?? Date.now)();
    const key = JSON.stringify([organizationOf(ref.organizationId) ?? null, namedCode(ref) ?? null]);
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
    const context = readContext(organizationOf(ref.organizationId));
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

/** Where an update's elevated reads run: the stored row's own organization (see the module note). */
function updateReadOrganization(previous: Row, posture: TenancyPosture): ReadScope {
  const organizationId = organizationOf(previous.organization_id);
  return mayReadIn(organizationId, posture) ? { read: true, organizationId } : { read: false };
}

/**
 * Where an insert's elevated reads run: the session's organization (see the
 * module note), `read: false` when the hooks make none.
 */
function insertReadOrganization(ctx: any, row: Row, posture: TenancyPosture): ReadScope {
  const organizationId = organizationOf(ctx?.session?.organizationId);
  const named = organizationOf(row.organization_id);
  if (named !== undefined && named !== organizationId) return { read: false, elsewhere: true };
  return mayReadIn(organizationId, posture) ? { read: true, organizationId } : { read: false };
}

export interface WorkCalendarHookOptions {
  /** The organization's `localization.timezone`, for a create that leaves `timezone` out (ADR-0157 D7). */
  timezoneOf?: (organizationId: string | undefined) => Promise<string | undefined>;
  /** The tenancy posture; omitted, the one the hooked engine enforces ({@link enginePostureOf}). */
  posture?: () => TenancyPosture;
}

/**
 * Judge a calendar row's post-image: the columns the write carries, and the
 * pair they belong to. `scope.read` false skips the one-default judgement,
 * which reads (see the module note).
 */
async function judgeCalendar(
  engine: WorkCalendarReadEngine,
  ctx: any,
  data: Row,
  previous: Row | undefined,
  scope: ReadScope,
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
  // A create placed in another organization cannot be judged there, so its
  // default is refused, with no read (see the module note).
  if (scope.elsewhere && data.is_default === true) {
    problems.push({
      field: 'is_default',
      code: 'invalid_value',
      message:
        'This calendar names an organization this write does not run in, so it cannot be marked ' +
        'the default here. Create it while working in that organization, or create it without Default and set ' +
        'Default afterwards by editing it.',
      value: true,
    });
  } else if (scope.read && data.is_default === true && previous?.is_default !== true) {
    const others = (await engine.find(WORK_CALENDAR_OBJECT, {
      where: { is_default: true },
      fields: ['id', 'code'],
      limit: 2,
      context: readContext(scope.organizationId, ctx?.transaction),
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

/** The fixed reasons for an update that changes a row's organization (ADR-0157 D2). */
const STAYS_IN_ORGANIZATION: Record<string, string> = {
  [WORK_CALENDAR_OBJECT]: 'A calendar stays in the organization it was created in; create it in the other organization instead.',
  [WORK_CALENDAR_EXCEPTION_OBJECT]: "An exception date stays in its calendar's organization.",
};

/** Refuse an update that changes the stored row's organization, before any read (see the module note). */
function refuseOrganizationChange(object: string, data: Row, previous: Row): void {
  if (!hasOwn(data, 'organization_id')) return;
  if (organizationOf(data.organization_id) === organizationOf(previous.organization_id)) return;
  refuse(object, [{ field: 'organization_id', code: 'invalid_value', message: STAYS_IN_ORGANIZATION[object]! }]);
}

/** The fixed reason for an exception whose calendar its organization does not hold: no organization, code or id. */
const CALENDAR_OF_OWN_ORGANIZATION = 'An exception date names a calendar of its own organization.';

/**
 * Refuse an exception whose `calendar` its own organization does not hold:
 * one read by id in `scope`'s organization (see the module note). A blank is
 * left to `required`.
 */
async function refuseForeignCalendar(engine: WorkCalendarReadEngine, ctx: any, data: Row, scope: ReadScope): Promise<void> {
  if (!hasOwn(data, 'calendar')) return;
  const ref = data.calendar;
  if (ref === undefined || ref === null || ref === '') return;
  if (scope.read && (typeof ref === 'string' || typeof ref === 'number')) {
    const held = (await engine.find(WORK_CALENDAR_OBJECT, {
      where: { id: String(ref) },
      fields: ['id'],
      limit: 1,
      context: readContext(scope.organizationId, ctx?.transaction),
    })).filter(isRow);
    if (held.length > 0) return;
  }
  refuse(WORK_CALENDAR_EXCEPTION_OBJECT, [{ field: 'calendar', code: 'invalid_value', message: CALENDAR_OF_OWN_ORGANIZATION }]);
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
  const postureNow = () => options.posture?.() ?? enginePostureOf(engine);

  bind('beforeInsert', WORK_CALENDAR_OBJECT, async (ctx: any) => {
    const row = ctx?.input?.data;
    if (!isRow(row)) return;
    const scope = insertReadOrganization(ctx, row, postureNow());
    const zone = row.timezone;
    if ((zone === undefined || zone === null || zone === '') && options.timezoneOf && scope.read) {
      const fallback = await options.timezoneOf(scope.organizationId);
      if (fallback) row.timezone = fallback;
    }
    await judgeCalendar(engine, ctx, row, undefined, scope);
  });
  bind('beforeUpdate', WORK_CALENDAR_OBJECT, async (ctx: any) => {
    const data = ctx?.input?.data;
    const previous = isRow(ctx?.previous) ? ctx.previous : undefined;
    if (!isRow(data) || !previous) return;
    refuseOrganizationChange(WORK_CALENDAR_OBJECT, data, previous);
    // The stored row's own organization: the engine read it under the write's own scope.
    await judgeCalendar(engine, ctx, data, previous, updateReadOrganization(previous, postureNow()));
  });
  bind('beforeInsert', WORK_CALENDAR_EXCEPTION_OBJECT, async (ctx: any) => {
    const row = ctx?.input?.data;
    if (!isRow(row)) return;
    judgeException(row, undefined);
    await refuseForeignCalendar(engine, ctx, row, insertReadOrganization(ctx, row, postureNow()));
  });
  bind('beforeUpdate', WORK_CALENDAR_EXCEPTION_OBJECT, async (ctx: any) => {
    const data = ctx?.input?.data;
    const previous = isRow(ctx?.previous) ? ctx.previous : undefined;
    if (!isRow(data) || !previous) return;
    refuseOrganizationChange(WORK_CALENDAR_EXCEPTION_OBJECT, data, previous);
    judgeException(data, previous);
    await refuseForeignCalendar(engine, ctx, data, updateReadOrganization(previous, postureNow()));
  });
  const both = [WORK_CALENDAR_OBJECT, WORK_CALENDAR_EXCEPTION_OBJECT];
  for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) bind(event, both, () => service.invalidate());
  return true;
}
