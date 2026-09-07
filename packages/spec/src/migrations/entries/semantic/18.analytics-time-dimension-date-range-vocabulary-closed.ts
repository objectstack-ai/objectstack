// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'analytics-time-dimension-date-range-vocabulary-closed',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'the bare-STRING arm of timeDimensions[].dateRange on an analytics query — '
    + 'AnalyticsQuerySchema / the POST /analytics/query and /analytics/sql bodies, a dataset '
    + 'selection\'s timeDimensions, and any AnalyticsQuery a host passes to '
    + 'AnalyticsService.query in-process — authored as anything other than one of the '
    + 'thirteen declared date-range preset names (today, yesterday, this_week, last_week, '
    + 'this_month, last_month, this_quarter, last_quarter, this_year, last_year, last_7_days, '
    + 'last_30_days, last_90_days): the display spelling "Last 7 days" the schema comment used '
    + 'to show, the driver-memory dialect "last N days" / "last 3 months", or a bare ISO date '
    + 'such as "2026-01-20" (the SQL strategies\' single-day dialect)',
  replacement:
    'a preset name from the closed vocabulary — `\'last_7_days\'` for "Last 7 days" / "last 7 '
    + 'days", `\'last_30_days\'`, `\'this_month\'`, and so on (`DATE_RANGE_PRESETS` in '
    + '`@objectstack/spec/data` is the list; the rejection prints it) — or, for an explicit '
    + 'window, the two-element array the array arm always accepted: `[\'2026-01-20\', '
    + '\'2026-01-20\']` for the single day a bare ISO string used to mean on SQL, '
    + '`[\'2026-01-01\', \'2026-01-31\']`, or `[\'{7_days_ago}\', \'{today}\']` in date-macro tokens',
  reason:
    'Maintainer ruling on #16041 (decision batch #57, option A — contract first, 2026-09-06): '
    + 'the protocol is the baseline, so the vocabulary is declared once in the schema and the '
    + 'drivers align to it (#16322) instead of each guessing. The arm was a bare `z.string()` '
    + 'whose only documented example, `"Last 7 days"`, no driver could parse: driver-memory '
    + 'recognised exactly `today` and a case-sensitive `last N <unit>` and fell every other '
    + 'string through to a `[range, range]` pseudo-window that — measured through mingo on '
    + '2026-09-05 — matched EVERY `Date`-typed row, 2099 included, because a `Date` compares '
    + 'above a `String` under BSON cross-type ordering; the SQL strategies read the same string '
    + 'as a single ISO day. A dashboard asking for one week silently got all of history on one '
    + 'backend and one day on the other, with no error on either. The string arm is now '
    + '`z.enum(DATE_RANGE_PRESETS)` — derived from `data/date-range-presets.ts`, the vocabulary\'s '
    + 'single source of truth since #4614, so the two cannot drift — and any other string is '
    + 'refused at parse time with one prescriptive issue at the field\'s own path; the runtime '
    + 'door answers the ADR-0112 envelope `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` '
    + '(`api/error-code-ledger.zod.ts`). ⚠️ No D2 conversion and no stored-metadata rewrite: '
    + 'this value is a QUERY-time request field, not a `sys_metadata` shape, and the two '
    + 'retired dialects meant different windows on different backends, so coercing one would '
    + 'be the platform guessing which the author meant. Measured in this repository at the '
    + 'ruling: three authored `\'Last 7 days\'`, all in spec tests, and no published dashboard '
    + 'authors the string arm at all (the shipped console lowers presets to the array arm). '
    + 'ADR-0049 / ADR-0112.',
  acceptanceCriteria:
    'Grep every authored `timeDimensions[].dateRange` string — dashboard datasets, saved '
    + 'analytics queries, SDK / MCP callers, in-process `AnalyticsService.query` calls — and '
    + 'rewrite each bare string that is not one of the thirteen preset names: a relative '
    + 'phrase to its preset (`\'last_7_days\'`), an ISO day to the two-element array '
    + '`[day, day]`. `POST /analytics/query` now answers `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` '
    + 'naming the value and the vocabulary, so a sweep is mechanical; `AnalyticsQuerySchema.'
    + 'safeParse` reports the same issue at `timeDimensions.N.dateRange`. Preset names and '
    + '`[start, end]` arrays parse byte-identically to before. A query that carried one of the '
    + 'retired spellings was never returning the window it named (all rows on driver-memory, '
    + 'one day on SQL), so re-check what the widget was supposed to show rather than trusting '
    + 'the old result set.',
};
