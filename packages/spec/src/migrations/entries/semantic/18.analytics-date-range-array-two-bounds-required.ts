// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'analytics-date-range-array-two-bounds-required',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'the ARRAY arm of timeDimensions[].dateRange on an analytics query — '
    + 'AnalyticsQuerySchema / the POST /analytics/query and /analytics/sql bodies, a dataset '
    + 'selection\'s timeDimensions, and any AnalyticsQuery a host passes to '
    + 'AnalyticsService.query in-process — authored with anything other than EXACTLY two '
    + 'string bounds: a one-element window such as ["2026-01-01"], the empty array [], and '
    + 'three or more bounds such as ["2026-01-01", "2026-01-31", "2026-02-28"]',
  replacement:
    'exactly two string bounds — `[start, end]`. A ONE-ELEMENT window is that day written as '
    + 'BOTH bounds: `[\'2026-01-01\']` becomes `[\'2026-01-01\', \'2026-01-01\']`, the shape '
    + 'the shipped #16322 migration table already prescribes for a single day, and the shape '
    + 'all four analytics faces have selected that one day with since PR #17593. ⛔ The EMPTY '
    + 'array and THREE-OR-MORE bounds have NO replacement that can be derived from what was '
    + 'written: an empty array names no window at all, and a 3+ array names no pair — decide '
    + 'the window the widget was meant to show and write its two bounds, or drop the '
    + 'dateRange entirely (the field is optional, and absent means the query is not '
    + 'time-bounded). A relative window is a preset name from the closed vocabulary '
    + '(`\'last_7_days\'`) or a date-macro pair (`[\'{7_days_ago}\', \'{today}\']`).',
  reason:
    'Maintainer ruling A on #17598 (decision batch #117 item 3, 2026-09-12, re-affirmed '
    + '2026-09-13): the array arm was a bare `z.array(z.string())` with NO length constraint, '
    + 'while the refusal sentence in the same source file said verbatim that "an explicit '
    + 'window is the two-element array [start, end]" and #16322\'s shipped migration table '
    + 'told an author to write a single day as `[\'2026-01-20\', \'2026-01-20\']`. So only the '
    + 'TYPE was weaker than the prose beside it, and #17124 measured what that bought: one '
    + 'authored `[\'2026-01-01\']` meant a point window on ObjectQLStrategy, NO time clause at '
    + 'all on NativeSQLStrategy (the whole of history), an unbounded-above window in the '
    + 'draft-preview evaluator, and a shifted point window in DatasetExecutor.runCompare — the '
    + 'same document, four backends, four different numbers, no error on any of them. PR '
    + '#17593 made all four faces refuse it with the ADR-0112 envelope `400 '
    + 'ANALYTICS_DATE_RANGE_UNRECOGNIZED`, which left the contract door LOOSER than every '
    + 'reader behind it; this narrowing closes that gap at the door. ⚠️ No D2 conversion and '
    + 'no stored-metadata rewrite, deliberately: rewriting `[\'2026-01-01\']` to the same day '
    + 'twice at load would be the platform deciding, silently, that the author meant one day '
    + 'rather than a window whose end they forgot — and for the empty array and 3+ bounds '
    + 'there is nothing to decide FROM. The blast radius is the WIDGET, not the page: a stored '
    + 'dashboard carrying a now-refused range loses that widget with the accurate refusal '
    + 'shown, and the dashboard still loads. Since PR #17593 every such stored range already '
    + 'failed at QUERY time with the same code and status, so this adds no new class of '
    + 'breakage — it moves the refusal to authoring time and states it accurately. '
    + 'ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep every authored `timeDimensions[].dateRange` ARRAY — dashboard widget datasets, saved '
    + 'analytics queries, SDK / MCP callers, in-process `AnalyticsService.query` calls — and '
    + 'count its bounds. Two string bounds parse byte-identically to before, as do every preset '
    + 'name and an absent `dateRange`; anything else now answers one prescriptive issue at '
    + '`timeDimensions.N.dateRange` naming the arity it received, so `AnalyticsQuerySchema.'
    + 'safeParse` and `POST /analytics/query` both make the sweep mechanical. ⚠️ Do not trust '
    + 'the numbers a one-element window used to produce: the four analytics faces disagreed '
    + 'about what it meant, so a widget that showed a plausible figure may have been reading '
    + 'all of history on one backend and a single day on another. Re-check what each converted '
    + 'widget was supposed to show against its two explicit bounds.',
};
