// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'driver-sql-unresolvable-where-column-refused',
  surface:
    'a `where` naming a column the table does not have, on `driver-sql` (and its '
    + '`TursoDriver` / `SqliteWasmDriver` subclasses) — `find()` / `findOne()` answered '
    + '`[]` and `count()` threw the dialect\'s own error; both now refuse with '
    + '`INVALID_FILTER` / 400',
  replacement:
    'name a column the object actually has, or run schema sync so a recently declared '
    + 'field exists as a column before filtering on it. A caller that legitimately wants '
    + '"no rows unless this matches" gets that from a predicate over a real column; there '
    + 'is no spelling of an unresolvable column that means "match nothing", which is '
    + 'exactly what the old empty list was mistaken for',
  reason:
    'One predicate had two answers. `SqlDriver.findRows()` carries the #3821 unknown-'
    + 'column recovery ladder, whose rungs are all built from `buildBase()` — and '
    + '`buildBase()` always re-applies `query.where`. So the ladder can drop a projection '
    + 'and can drop an ORDER BY, but it can never drop the clause that failed when the '
    + 'unresolvable column is in the WHERE: both rungs raise the same error and the method '
    + 'fell to `return []`. `SqlDriver.count()` runs a separate statement with no ladder at '
    + 'all, so the identical predicate threw. Measured on better-sqlite3, one seeded row: '
    + "`where { 'title.x': 'y' }` gave `find()` 0 rows and NO error, while `count()` threw "
    + "`code: 'SQLITE_ERROR'`, `status: undefined`, message `select count(*) as \\`count\\` "
    + "from \\`task\\` where \\`title\\`.\\`x\\` = 'y' - no such column: title.x`.\n\n"
    + 'A list view calls both halves, so one query produced an empty page from the rows '
    + 'half and a 500-shaped failure from the total half — and a caller reading only the '
    + 'rows got a silent empty page saying "no records exist" for what was really "your '
    + 'predicate never ran". That is the single most AI-legible failure to get wrong: an '
    + 'agent reads "no matching records" and writes its next query on that belief. The '
    + "thrown half was no better — the dialect's own `code`, no `status` (an unclassified "
    + '5xx at the REST boundary rather than a caller mistake), and the statement\'s bound '
    + 'literals inlined in the message, the same predicate-text disclosure shape #7929 '
    + 'redacted elsewhere.\n\n'
    + 'Ruled 2026-08-15 on #8790: refuse BOTH halves with `INVALID_FILTER` / 400, naming '
    + 'the column. The envelope is not minted here — it is what every sibling refusal on '
    + 'this path already answers, required on both SQL drivers by '
    + '`cross-field-conformance-cases.ts` and pinned by `sql-driver-boolean-identity.test.ts` '
    + 'and `sql-driver-cross-field-conformance.test.ts` — so what closes is a declared-vs-'
    + 'enforced gap, not a new posture. Recover-both was excluded by the card\'s own '
    + 'argument: dropping a WHERE returns rows the caller explicitly excluded, and #3821\'s '
    + '"rows matter more than their order" is an argument about how rows are PRESENTED, '
    + 'which does not transfer to a predicate. The ladder KEEPS both of its recoveries — '
    + 'only the WHERE-failure terminal became a refusal.\n\n'
    + 'Reach, stated rather than assumed: the refusal fires on the wordings the ladder has '
    + 'always recognised — SQLite (`no such column: x`) and Postgres (`column "x" does not '
    + "exist`). MySQL spells it `Unknown column 'x' in 'where clause'`, which neither arm "
    + 'matches, so on MySQL this condition still travels out as the raw dialect error; '
    + 'widening that predicate would also hand MySQL the #3821 recoveries it has never had, '
    + 'which is an accept-set change in the opposite direction and is filed separately.\n\n'
    + 'This is a CODE-path API, not stored metadata, so — like '
    + '`engine-dotted-projection-refused` and `engine-find-formula-filter-refused` — there '
    + 'is no `sys_metadata` row for the D2 chain to rewrite and this entry is the '
    + 'notification channel. No mechanical rewrite exists: the platform cannot know which '
    + 'real column a mistyped filter key meant, and guessing one would answer with rows the '
    + 'caller never asked for. #8790, #3821, #7929, #8371, ADR-0112.',
  acceptanceCriteria:
    'No saved report `query.filter`, flow condition, sharing/permission rule or hook '
    + 'filters on a name the queried object has no column for. Reads and counts complete '
    + 'with no `INVALID_FILTER` whose message says "names a column that object" or "names a '
    + 'column the database could not resolve". Where a filter key was a relationship '
    + 'traversal spelled as a dotted path, rewrite it against a column on the queried '
    + 'object — the driver never resolved such a path and answered `[]`, so any list that '
    + 'looked correct under one was already showing nothing.',
};
