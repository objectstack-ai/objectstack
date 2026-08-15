// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'driver-sql-upsert-cross-row-identity-merge-refused',
  surface:
    'an `upsert` with no `conflictKeys` — or naming the primary key — on a MySQL table that '
    + 'carries a non-primary UNIQUE key, in `driver-sql` (and its `TursoDriver` / '
    + '`SqliteWasmDriver` subclasses). It merged onto whichever UNIQUE key the row collided '
    + 'with, silently rewriting a DIFFERENT row; when that happens the write is now rolled '
    + 'back and the call refuses with `VALIDATION_ERROR` / 400',
  replacement:
    'name the business key you meant to merge on (`conflictKeys`), so the intent is checkable '
    + 'and the pre-flight can answer for it; or drop/rename the extra UNIQUE key so the '
    + 'primary key is the only thing a row can collide on; or run the object on SQLite / '
    + 'PostgreSQL, which compile `ON CONFLICT (...)` and honour the named arbiter. There is '
    + 'no spelling of "merge onto whatever key happens to collide" that was ever correct — '
    + 'the old behaviour rewrote a row the caller never identified',
  reason:
    'MySQL\'s only merge statement is `ON DUPLICATE KEY UPDATE`, which carries NO conflict '
    + 'target: knex drops the named keys before the statement leaves the process, so the '
    + 'merge lands on whichever UNIQUE index the row collides with first. #8621 closed the '
    + 'half where nothing backed a caller-named target and #8755 the half where a rival key '
    + 'could absorb a caller-named one. This entry closes the residue those two left by '
    + 'construction: the `conflictKeys`-less call and the `[\'id\']` call, which compile '
    + 'byte-identically and which no pre-flight can judge, because neither names anything.\n\n'
    + 'Measured on live MySQL 8.0.46 through the same knex + `mysql2` path `upsert` takes, '
    + '`email` and `tax_id` both `unique: true`, NO `conflictKeys` at all: seeding '
    + "`{email:'d@b.com', tax_id:'T-9', title:'first'}` inserted id `iVvD35rMk4BIayYc`, and "
    + "`{email:'e@b.com', tax_id:'T-9', title:'second'}` then RESOLVED with no error — one "
    + 'row, the SEEDED one, its `email` rewritten `d@b.com` -> `e@b.com`. The id the caller '
    + 'was handed back was in no row at all. The identical pair on SQLite raises `UNIQUE '
    + 'constraint failed: ….tax_id` and leaves the seeded row untouched.\n\n'
    + 'Ruled 2026-08-15 on #8807, as a contract principle rather than a MySQL detail: *an '
    + '`upsert` must never modify a row whose identity the caller did not supply and whose '
    + 'conflict key it did not name.* Enforcement was delegated to the drivers lane with '
    + 'blanket refusal excluded by name — refusing every `conflictKeys`-less upsert on any '
    + 'table with a business unique key would refuse the platform\'s own lifecycle archiver. '
    + 'Measured before choosing: on this path the merge target is always the primary key, so '
    + 'EVERY non-primary UNIQUE key is a rival and "narrowed to tables carrying a rival key" '
    + 'and "every table with a business unique key" are the same set — the narrowing that '
    + 'made a pre-flight refusal proportionate for a caller-named target does not exist '
    + 'here.\n\n'
    + 'So the enforcement is a post-hoc identity check instead, and it is exact rather than '
    + 'heuristic: `id` is insert-only on the merge path since #8622, so a row merged on the '
    + 'primary key always still carries the id the call supplied, and a row merged on any '
    + 'other key never does. Absence of that row after the statement is therefore a '
    + 'biconditional for "this landed on a row the caller never identified", which is why the '
    + 'refusal has no false positives. It runs inside a transaction with the statement — '
    + '"never modify" is not satisfied by noticing afterwards — and only on MySQL tables that '
    + 'carry a rival UNIQUE key, so a table whose only key is its primary key keeps its '
    + 'single autocommitted round trip unchanged.\n\n'
    + 'This is a CODE-path API, not stored metadata, so — like '
    + '`driver-sql-unresolvable-where-column-refused` — there is no `sys_metadata` row for '
    + 'the D2 chain to rewrite and this entry is the notification channel. No mechanical '
    + 'rewrite exists: the platform cannot know which business key an unnamed merge meant, '
    + 'and guessing one would merge onto a row the caller never named, which is the defect. '
    + '#8807, #8755, #8621, #8622, #8592, ADR-0112.',
  acceptanceCriteria:
    'On MySQL deployments only. For every object whose rows are written with `upsert` and '
    + 'whose table carries a UNIQUE key besides the primary key, confirm the writer either '
    + 'supplies the `id` of the row it means to update or passes that business key as '
    + '`conflictKeys`. Sweeps, imports and archival copies complete with no '
    + '`VALIDATION_ERROR` whose message says "the merge landed on a row this call never '
    + 'identified". Where such a refusal appears, the old behaviour was silently overwriting '
    + 'an unrelated row on that table — audit the object for rows whose business key is '
    + 'correct but whose other columns belong to a different record, since no error was ever '
    + 'raised for those writes.',
};
