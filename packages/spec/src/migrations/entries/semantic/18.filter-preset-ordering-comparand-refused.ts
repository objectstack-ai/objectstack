// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'filter-preset-ordering-comparand-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'a dashboard date-range preset name (last_7_days / last_30_days / last_90_days, today, '
    + 'yesterday, this_week, last_week, this_month, last_month, this_quarter, last_quarter, '
    + 'this_year, last_year) authored as a bare ORDERING comparand in a filter — a '
    + '$gt / $gte / $lt / $lte value or a $between endpoint on any carrier of '
    + 'FilterConditionSchema (dashboard widget filter, dataset filter, report runtimeFilter, '
    + 'page filter, component filter, rollup filter), a greater_than / less_than / before / '
    + 'after / between view filter rule value, or an ordering [field, op, value] filter triple',
  replacement:
    'the date-macro window the preset already means — { $gte: "{30_days_ago}" } for '
    + 'last_30_days, { $between: ["{week_start}", "{week_end}"] } for this_week, and so on '
    + '(the rejection names the exact window per preset; DATE_RANGE_PRESET_MACRO_WINDOWS in '
    + '@objectstack/spec/data is the table) — or an ISO date such as 2026-01-15. The preset '
    + 'names themselves stay fully legal in the dashboard date-filter positions '
    + '(dateRange.defaultRange, a date global filter defaultValue), which is the only place '
    + 'any layer ever resolved them',
  reason:
    'The C half of #8690, maintainer-ruled 2026-08-15 alongside the engine door (PR #8808). '
    + 'The preset vocabulary is declared in the dashboard schema and lowered to {date-macro} '
    + 'bounds by the shipped console before any query is sent — so the names were declared in '
    + 'one layer and unrecognised in the next, with no error at the boundary. Authored as a '
    + 'bare comparand (a saved report, an integration, an MCP client, an AI-authored query), '
    + 'the name reached the driver as written and compared false against every row: HTTP 200, '
    + 'count 0, indistinguishable from "there is no data" (measured on #8690: $gte '
    + '"last_30_days" returned 0 of 51 seeded rows where the macro spelling returned the 38 '
    + 'in-window). The engine now refuses the bare name on a declared temporal field at query '
    + 'time (INVALID_FILTER / 400); this entry records the AUTHORING-time half: the schema '
    + 'door and the @objectstack/lint filter-preset-comparand rule refuse it at publish, '
    + 'where the author — an AI author in particular — can still act on the message. '
    + 'Ordering positions only, deliberately: equality and membership are NOT judged, because '
    + 'a select/picklist column legitimately stores values that collide with preset names, '
    + 'and on a temporal field the engine door already refuses those with the field type in '
    + 'hand. ⚠️ Metadata AT REST is deliberately not rewritten and there is no D2 conversion: '
    + 'this shape was never written by any first-party producer (every preset in this repo '
    + 'and the example apps sits in a dashboard date-filter position — measured) and never '
    + 'executed usefully (it returned a silent zero before #8808 and a 400 after). Coercing '
    + 'it at load would be the platform guessing which bound the author meant. The read path '
    + 'does not re-validate stored rows, so no stored dashboard becomes unreadable; what '
    + 'changes is that RE-SAVING one is refused with the window named. '
    + 'ADR-0049 / ADR-0078 / ADR-0112.',
  acceptanceCriteria:
    'Grep your authored filters for the thirteen preset names in ordering positions — a '
    + '$gt/$gte/$lt/$lte value, a $between endpoint, a greater_than/less_than/before/after/'
    + 'between view rule value, an ordering filter triple — and rewrite each to the '
    + '{date-macro} window the rejection names (or an ISO date). `os validate` / `os lint` '
    + 'report each one by path, so the sweep is mechanical. Leave presets in dashboard '
    + 'date-filter positions (dateRange.defaultRange, date global filter defaultValue) '
    + 'untouched — they remain the declared vocabulary there. A filter that carried one of '
    + 'these shapes was never returning the window it named (silent zero before the engine '
    + 'door, 400 after), so re-check what the surface was supposed to show rather than '
    + 'assuming the old result set was correct.',
};
