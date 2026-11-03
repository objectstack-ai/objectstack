// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Host-configured read limits for the data API: a default page size, a
 * maximum page size, and a per-query row budget.
 *
 * ## The three numbers
 *
 * | Env var | Meaning | Unset |
 * |:--|:--|:--|
 * | `OS_DATA_DEFAULT_PAGE_SIZE` | the page a read gets when it names no `limit` | the maximum page size when one is set, else no default |
 * | `OS_DATA_MAX_PAGE_SIZE` | the largest `limit` a read may name | no maximum |
 * | `OS_DATA_QUERY_ROW_BUDGET` | the most rows one query may walk: `offset` plus the rows it returns | no budget |
 *
 * All three unset is today's behaviour exactly: nothing here touches a read,
 * so a self-hosted deployment that sets none of them answers as before. A
 * hosted deployment sets the numbers; one value per deployment.
 *
 * ## The rule for a request over a limit: refuse, never clamp
 *
 * A clamp answers a different page from the one asked for. A caller that
 * pages by adding its own `limit` to `offset` then skips the rows between the
 * clamped page and the next offset, and an analytics answer has no `hasMore`
 * to say the chart was cut. So every limit here is a REFUSAL, `400`, naming
 * the limit, before the driver is asked:
 *
 * - a `limit` over the maximum page size → the standard `MAX_RECORDS_EXCEEDED`
 *   (a caller-side limit: the request asked for more rows than a request may
 *   carry);
 * - `offset + limit` over the row budget → `QUERY_ROW_BUDGET_EXCEEDED`.
 *
 * A read that names no `limit` is where the default page size applies, and
 * the server never cuts an answer silently there either:
 *
 * - a LIST read ({@link QueryReadSurface} `list`) runs with the default page
 *   size as its `limit`. Its answer already says when more rows exist
 *   (`hasMore`, `total`), so the default is an ordinary first page.
 * - an ANALYTICS read (`analytics`: `/analytics/query`, the dataset doors that
 *   reports and dashboards read through) has no such signal. It runs with one
 *   row more than the default page size; an answer holding more rows than the
 *   default is refused with `MAX_RECORDS_EXCEEDED`, telling the caller to
 *   name a `limit` and page with `offset`.
 * - a read with a row budget and no page size at all runs with one row more
 *   than the budget leaves after its `offset`; an answer over the budget is
 *   refused with `QUERY_ROW_BUDGET_EXCEEDED`.
 *
 * Every refusal writes ONE log line carrying the surface, the object, the row
 * count and the limit — never a row value. The budget counts rows the query
 * walks through its window (`offset` + returned rows); rows a database scans
 * inside an aggregate or behind an unindexed filter are not visible to the
 * data API, so they are not what this budget counts.
 */

/** The page a read gets when it names no `limit`. */
export const DATA_DEFAULT_PAGE_SIZE_ENV = 'OS_DATA_DEFAULT_PAGE_SIZE';
/** The largest `limit` a read may name. */
export const DATA_MAX_PAGE_SIZE_ENV = 'OS_DATA_MAX_PAGE_SIZE';
/** The most rows one query may walk: `offset` plus the rows it returns. */
export const DATA_QUERY_ROW_BUDGET_ENV = 'OS_DATA_QUERY_ROW_BUDGET';

/**
 * Over the maximum page size, or an unpaged analytics answer larger than the
 * default page. The standard code (`errors.zod.ts`), not a new one: a caller-side
 * limit, the request asked for more rows than a request may carry.
 */
export const MAX_RECORDS_EXCEEDED = 'MAX_RECORDS_EXCEEDED';
/**
 * `offset` plus the rows a query returns is over the row budget. Not
 * `MAX_RECORDS_EXCEEDED`: the page asked for may be well within the maximum;
 * it is how deep the query walks (`offset` plus the page) that is bounded.
 */
export const QUERY_ROW_BUDGET_EXCEEDED = 'QUERY_ROW_BUDGET_EXCEEDED';

/** The three host numbers; an absent member is "no limit on this axis". */
export interface QueryReadLimits {
  readonly defaultPageSize?: number;
  readonly maxPageSize?: number;
  readonly rowBudget?: number;
}

/**
 * Which door a read came through — it decides what a read with no `limit`
 * gets (see the module doc): `list` reads answer `hasMore`, `analytics` reads
 * do not.
 */
export type QueryReadSurface = 'list' | 'analytics';

/**
 * The refusal every limit here answers with: a `400` carrying a registered
 * code and the configured number the read went over. One subclass per code,
 * each declaring its own `code` and `status`, so the pair is a declaration the
 * error-status conformance gate reads rather than a value computed at the throw.
 */
export abstract class QueryReadLimitError extends Error {
  abstract readonly code: typeof MAX_RECORDS_EXCEEDED | typeof QUERY_ROW_BUDGET_EXCEEDED;
  abstract readonly status: 400;
  constructor(
    message: string,
    /** The configured number the read went over. */
    readonly limit: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A `limit` over the maximum page size, or an unpaged analytics answer larger than the default page. */
export class QueryPageSizeExceededError extends QueryReadLimitError {
  readonly code: typeof MAX_RECORDS_EXCEEDED = MAX_RECORDS_EXCEEDED;
  readonly status = 400;
}

/** A read whose `offset` plus its rows walks more than the query row budget. */
export class QueryRowBudgetExceededError extends QueryReadLimitError {
  readonly code: typeof QUERY_ROW_BUDGET_EXCEEDED = QUERY_ROW_BUDGET_EXCEEDED;
  readonly status = 400;
}

function readLimitVar(env: Record<string, string | undefined>, name: string): number | undefined {
  const raw = env[name];
  if (raw == null || raw.trim() === '') return undefined;
  const text = raw.trim();
  const n = Number(text);
  // A typo here must not be the thing that switches the guard off: an
  // unreadable value fails loudly instead of reading as unset.
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n <= 0) {
    throw new Error(
      `${name} must be a positive integer; got ${JSON.stringify(raw)}. `
      + 'Unset it for no limit on this axis, or set a whole number of rows.',
    );
  }
  return n;
}

/**
 * The deployment's read limits, from `env` (default `process.env`). Throws on
 * a value that is not a positive integer, and on a default page size above the
 * maximum, naming the variable — a misconfigured guard is a boot fault, never
 * a guard that is silently off.
 */
export function resolveQueryReadLimits(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): QueryReadLimits {
  const defaultPageSize = readLimitVar(env, DATA_DEFAULT_PAGE_SIZE_ENV);
  const maxPageSize = readLimitVar(env, DATA_MAX_PAGE_SIZE_ENV);
  const rowBudget = readLimitVar(env, DATA_QUERY_ROW_BUDGET_ENV);
  if (defaultPageSize !== undefined && maxPageSize !== undefined && defaultPageSize > maxPageSize) {
    throw new Error(
      `${DATA_DEFAULT_PAGE_SIZE_ENV} (${defaultPageSize}) is larger than ${DATA_MAX_PAGE_SIZE_ENV} `
      + `(${maxPageSize}): a read naming no limit would get a page it may not ask for. `
      + 'Lower the default or raise the maximum.',
    );
  }
  return {
    ...(defaultPageSize !== undefined ? { defaultPageSize } : {}),
    ...(maxPageSize !== undefined ? { maxPageSize } : {}),
    ...(rowBudget !== undefined ? { rowBudget } : {}),
  };
}

/** One read, as the window planner sees it. */
export interface QueryReadRequest {
  readonly surface: QueryReadSurface;
  /** The object (or analytics cube) read — logged on a refusal, never a row. */
  readonly object: string;
  /** The `limit` the caller named, already validated as a non-negative integer. */
  readonly limit?: number;
  /** The `offset` the caller named, already validated as a non-negative integer. */
  readonly offset?: number;
  /** The parameter spelling the caller wrote for `limit` (`$top`, `top`, `limit`), for the refusal. */
  readonly limitParam?: string;
}

/** Where a refusal's one log line goes. */
export interface QueryReadLimitLogger {
  warn(message: string): void;
}

/** What to run the read with. */
export interface QueryReadPlan {
  /** The `limit` to hand the engine; `undefined` leaves the read unbounded, as today. */
  readonly limit?: number;
  /**
   * Present when {@link limit} is a PROBE one row past what the answer may
   * hold: the server chose it, not the caller, and an answer with more than
   * `maxRows` rows is refused by {@link assertQueryReadRows}. A list read
   * hands its caller no `limit` it did not ask for in that case.
   */
  readonly probe?: {
    readonly maxRows: number;
    readonly code: typeof MAX_RECORDS_EXCEEDED | typeof QUERY_ROW_BUDGET_EXCEEDED;
    readonly limit: number;
    /** The maximum page size, when one is set — named in the refusal. */
    readonly maxPageSize?: number;
  };
}

function refuse(
  request: QueryReadRequest,
  logger: QueryReadLimitLogger | undefined,
  code: typeof MAX_RECORDS_EXCEEDED | typeof QUERY_ROW_BUDGET_EXCEEDED,
  limit: number,
  rows: number,
  message: string,
): never {
  // Object and counts only: a refusal line never carries a row value.
  logger?.warn(
    `[data] read refused: code=${code} surface=${request.surface} object=${request.object} `
    + `rows=${rows} limit=${limit}`,
  );
  throw code === MAX_RECORDS_EXCEEDED
    ? new QueryPageSizeExceededError(message, limit)
    : new QueryRowBudgetExceededError(message, limit);
}

function budgetMessage(budget: number, offset: number, rows: number | string): string {
  return `This query would read ${rows} rows (offset ${offset} plus the rows it returns), over this `
    + `deployment's query row budget of ${budget}. The query was not run. Narrow the filter, or page `
    + `with a smaller offset and limit, so offset plus limit stays within ${budget}.`;
}

/**
 * Decide the window one read runs with, or refuse it. Pure apart from the
 * refusal's log line; with every limit unset it returns the caller's own
 * `limit` untouched.
 */
export function planQueryReadWindow(
  request: QueryReadRequest,
  limits: QueryReadLimits,
  logger?: QueryReadLimitLogger,
): QueryReadPlan {
  const { maxPageSize, rowBudget } = limits;
  const defaultPageSize = limits.defaultPageSize ?? maxPageSize;
  const offset = request.offset ?? 0;
  const param = request.limitParam ?? 'limit';

  if (request.limit !== undefined) {
    if (maxPageSize !== undefined && request.limit > maxPageSize) {
      refuse(request, logger, MAX_RECORDS_EXCEEDED, maxPageSize, request.limit,
        `Query parameter '${param}' asks for ${request.limit} rows; this deployment's maximum page size `
        + `is ${maxPageSize}. The query was not run. Ask for at most ${maxPageSize} rows and page with offset.`);
    }
    if (rowBudget !== undefined && offset + request.limit > rowBudget) {
      refuse(request, logger, QUERY_ROW_BUDGET_EXCEEDED, rowBudget, offset + request.limit,
        budgetMessage(rowBudget, offset, offset + request.limit));
    }
    return { limit: request.limit };
  }

  if (defaultPageSize !== undefined) {
    if (rowBudget !== undefined && offset + defaultPageSize > rowBudget) {
      refuse(request, logger, QUERY_ROW_BUDGET_EXCEEDED, rowBudget, offset + defaultPageSize,
        budgetMessage(rowBudget, offset, offset + defaultPageSize));
    }
    if (request.surface === 'list') return { limit: defaultPageSize };
    return {
      limit: defaultPageSize + 1,
      probe: {
        maxRows: defaultPageSize,
        code: MAX_RECORDS_EXCEEDED,
        limit: defaultPageSize,
        ...(maxPageSize !== undefined ? { maxPageSize } : {}),
      },
    };
  }

  if (rowBudget !== undefined) {
    if (offset > rowBudget) {
      refuse(request, logger, QUERY_ROW_BUDGET_EXCEEDED, rowBudget, offset, budgetMessage(rowBudget, offset, offset));
    }
    const maxRows = rowBudget - offset;
    return { limit: maxRows + 1, probe: { maxRows, code: QUERY_ROW_BUDGET_EXCEEDED, limit: rowBudget } };
  }

  return {};
}

/**
 * Refuse an answer that holds more rows than a probing {@link QueryReadPlan}
 * allows. A plan without a probe never refuses here.
 */
export function assertQueryReadRows(
  request: QueryReadRequest,
  plan: QueryReadPlan,
  rowCount: number,
  logger?: QueryReadLimitLogger,
): void {
  const probe = plan.probe;
  if (!probe || rowCount <= probe.maxRows) return;
  const offset = request.offset ?? 0;
  if (probe.code === QUERY_ROW_BUDGET_EXCEEDED) {
    refuse(request, logger, probe.code, probe.limit, offset + rowCount,
      budgetMessage(probe.limit, offset, `more than ${probe.limit}`));
  }
  const bound = probe.maxPageSize !== undefined ? ` of at most ${probe.maxPageSize}` : '';
  refuse(request, logger, probe.code, probe.limit, rowCount,
    `This query answers more than ${probe.limit} rows, this deployment's default page size, and named `
    + `no limit. The answer was not returned. Name a limit${bound} and page with offset.`);
}
