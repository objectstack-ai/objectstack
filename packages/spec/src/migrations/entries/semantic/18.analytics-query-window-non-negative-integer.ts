// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'analytics-query-window-non-negative-integer',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'the row window of an analytics query — limit and offset on AnalyticsQuerySchema, the '
    + 'POST /analytics/query and /analytics/sql bodies, and a dataset selection '
    + '(POST /analytics/dataset/query) — authored as a negative number (limit: -1, offset: -1), '
    + 'a fraction (limit: 1.5), or an integer above Number.MAX_SAFE_INTEGER',
  replacement:
    'a non-negative integer, or no key at all: delete `limit` to return every row (a '
    + '`limit: -1` written to mean "no limit" is exactly that), write `limit: 0` only for no '
    + 'rows, and delete `offset` (or write `offset: 0`) to skip nothing; a fraction becomes the '
    + 'integer page size that was meant. An `offset` with no `limit` stays valid and returns '
    + 'every row after the offset, on SQLite and PostgreSQL alike',
  reason:
    'Both members were a bare `z.number()`, and every value outside the non-negative integers '
    + 'answered differently per driver and per face. Measured at POST /api/v1/analytics/query on '
    + 'SQLite and PostgreSQL 16, through the real dispatcher route: `limit: -1` returned every row '
    + 'on the native SQLite face, a 500 on native PostgreSQL and all but the last row on the '
    + 'ObjectQL face; `limit: 1.5` answered a 500, two rows and one row; `offset: -1` a 500 on '
    + 'both native drivers and every row on the ObjectQL face. No value had one answer, so the '
    + 'contract refuses them instead of any engine guessing (contract first, ADR-0049): the two '
    + 'members are `z.number().int().nonnegative()` on `AnalyticsQuerySchema`, the dataset '
    + 'selection reads the same two declarations off its shape, and the runtime doors answer the '
    + 'ADR-0112 envelope `400 VALIDATION_FAILED` naming `limit` or `offset` before any engine '
    + 'runs. ⚠️ No D2 conversion and no stored-metadata rewrite: the window is a QUERY-time '
    + 'request field, not a `sys_metadata` shape, and the refused values meant different windows '
    + 'on different backends, so coercing one would be the platform guessing which the author '
    + 'meant. The one stored producer that lowers into a selection, a dashboard widget\'s '
    + '`limit`, is already declared a positive integer. Measured in this repository at the '
    + 'change: no example, fixture, document or published skill authors a negative or '
    + 'fractional analytics window. ADR-0049 / ADR-0112.',
  acceptanceCriteria:
    'Grep every authored analytics `limit` and `offset` — saved analytics queries, SDK and MCP '
    + 'callers, dataset selections, and queries a host builds in-process — and rewrite each '
    + 'negative or fractional value as described. POST /analytics/query and /analytics/sql answer '
    + '`400 VALIDATION_FAILED` with `details.fields[].field` naming `limit` or `offset`, and '
    + 'POST /analytics/dataset/query names `selection.limit` or `selection.offset`, so a sweep is '
    + 'mechanical; `AnalyticsQuerySchema.safeParse` reports the same issue at the member. '
    + 'Non-negative integer windows parse byte-identically to before, `limit: 0` still answers '
    + 'no rows, and absence stays absence. The service does not parse a query passed to it '
    + 'in-process, so a host that builds one parses it with `AnalyticsQuerySchema` first. A '
    + 'query that carried a refused value was never returning one window, so re-check what the '
    + 'widget was meant to show rather than trusting the old result set.',
};
