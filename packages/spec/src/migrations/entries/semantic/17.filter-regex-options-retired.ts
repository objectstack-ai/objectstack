// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'filter-regex-options-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'data.filter $regex / $options — in a STORED filter (dashboard widget filter and '
    + 'globalFilters, report runtimeFilter, page and component filter, solution-blueprint '
    + 'filter), and equally in the where clause of a query request',
  replacement:
    '$icontains for the case-insensitive substring match this was almost always used '
    + 'for, or $contains for a case-sensitive one — a pattern that genuinely needs a '
    + 'regular expression has no filter-level replacement',
  reason:
    'Like `driver-aggregate-undeclared-key-aliases-removed` and '
    + '`driver-sql-distinct-bare-filter-typed`, this entry records a LENIENCY being '
    + 'withdrawn rather than a declared surface: `$regex` was never in `FILTER_OPERATORS` '
    + 'and never a key on `StringOperatorSchema`. That is measured, not assumed — `git '
    + 'log -S\'$regex\'` over `packages/spec/src` returns only doc comments describing how '
    + '`$contains` LOWERS to MongoDB (`Contains substring - SQL: LIKE %?% | MongoDB: '
    + '$regex`), plus #5701 itself, which added the name solely as `RETIRED_FILTER_OPERATORS` '
    + 'prescription data. ⚠️ But it differs from those two in the one way that decides the '
    + 'disposition, so a reader should not have to infer it: those were driver CALL '
    + 'ARGUMENTS, code and never stack metadata, whereas a filter IS stored metadata. '
    + '`FilterConditionSchema` is an OPEN RECORD (`z.record(z.string(), z.unknown())`) '
    + 'because a filter key is a field name, so a stored `{ name: { $regex: \'acme.*\' } }` '
    + 'parses GREEN and always will — a `retiredKey()` tombstone cannot exist on an open '
    + 'map, which is exactly why the ledger has to carry this. What such a stack used to '
    + 'get was four different answers from four backends: `driver-sql` and Turso\'s remote '
    + 'transport compiled it to a LIKE-escaped SUBSTRING (so `a.b` matched only the literal '
    + '`a.b` and the regex was silently never a regex), `driver-memory` and objectql\'s '
    + '`having` ran it as a real `RegExp` (so the same filter also matched `axb`, and an '
    + 'INVALID pattern was caught and answered `false` — zero rows, in silence), and '
    + '`driver-mongodb` refused it with a bare `Error` carrying no `code` and no `status`. '
    + 'It is now refused everywhere with INVALID_FILTER / 400 naming the replacement. '
    + 'There is deliberately NO D2 conversion and this sits in `semantic` rather than among '
    + 'the mechanical transforms: rewriting `$regex` to `$icontains` is NOT lossless in '
    + 'either direction — a regex metacharacter becomes a literal — so an auto-applied '
    + 'rewrite would silently change which rows a dashboard, report or permission filter '
    + 'selects, a wrong number rather than a missing one. Choosing the substring the '
    + 'pattern MEANT is a judgment about the query, not a transform. ⚠️ This entry covers '
    + 'BOTH HALVES of the #4706 ruling (B), not just the driver one: the contract half '
    + '(#5701 — the `$icontains` declaration, the `$contains` family pinned '
    + 'case-sensitive, and the `RETIRED_FILTER_OPERATORS` prescriptions) landed before the '
    + 'ADR-0087 disposition gate (#6148) existed and so was never asked for a ledger entry; '
    + 'the driver half (#5702) is where the refusal became executable. One surface, one '
    + 'entry, registered from the half that made it observable. ADR-0049 / ADR-0087, '
    + '#4706 / #5701 / #5702.',
  acceptanceCriteria:
    'No stored filter and no request `where` spells `$regex` or `$options` — grep the '
    + 'stack for both. Each one is rewritten by asking what the pattern MEANT, not by '
    + 'transliterating it: a bare substring pattern becomes `$icontains` (or `$contains` '
    + 'when the match must stay case-sensitive), and its metacharacters are dropped rather '
    + 'than escaped, because they were never honoured as a regex on the SQL family in the '
    + 'first place. ⚠️ Expect the answer to CHANGE on any stack that ran on '
    + '`driver-memory`, `driver-mongodb` or objectql `having`, where the pattern really was '
    + 'evaluated as a regular expression; on the SQL family the rewritten filter returns '
    + 'what it always returned. A pattern that genuinely needs alternation, anchoring or '
    + 'character classes has no filter-level replacement — move that predicate into a '
    + 'formula field or a server-side view, or open an issue for it. Verify by loading the '
    + 'stack: a surviving `$regex` or `$options` is answered INVALID_FILTER / 400 with a '
    + 'message naming the replacement, on every backend.',
};
