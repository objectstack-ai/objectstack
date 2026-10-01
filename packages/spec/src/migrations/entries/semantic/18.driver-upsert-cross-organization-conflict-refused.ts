// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21185 — registered by the change that fenced the merge leg (PR #21225), not by
// a later reconciliation. Executes the ruling record 5934879010 (letter A,
// refinements 1/2/3). A driver call is code, never stack metadata, so there is no
// authored source for the chain to rewrite and no schema tombstone: this entry is
// the migration channel beside the changeset's FROM → TO table.
export const entry: SemanticMigration = {
  id: 'driver-upsert-cross-organization-conflict-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'IDataDriver upsert on SqlDriver, SqliteWasmDriver and TursoDriver (both faces): a '
    + 'tenant-scoped call whose conflict lands on a row of another organization, and the '
    + 'tenant column on the merge leg',
  replacement:
    'a tenant-scoped upsert merges only into a row of the organization it writes under; a '
    + 'conflict anywhere else answers `UNIQUE_VIOLATION` / 409 and writes nothing, so handle it '
    + 'as the colliding insert it is from the caller\'s organization. To move a row between '
    + 'organizations, call the driver\'s `update` door on that row: an upsert keeps the stored '
    + 'row\'s organization on merge',
  reason:
    '`upsert` resolves its conflict against the whole table, and the primary key and a '
    + '`unique: \'global\'` column are installation-wide (ADR-0120 D1). So the row a tenant-scoped '
    + 'call (`options.tenantId` on an object with a tenant column) collided with could belong to '
    + 'an organization the caller cannot read. The merge leg wrote every payload column except '
    + 'the insert-only ones onto that row, and the tenant column was not insert-only: the other '
    + 'organization\'s columns were overwritten and the row was re-parented to the caller\'s '
    + 'organization, with no error. That was the one driver door the tenant predicate did not '
    + 'reach (ADR-0131 D8). The merge leg is now fenced to rows whose stored tenant column equals '
    + 'the written one, for any conflict target, the primary key included. A conflict anywhere '
    + 'else, including a row with no organization, is refused with `UNIQUE_VIOLATION` / 409, the '
    + 'registered code a colliding insert gets, and the refusal names no organization. The fence '
    + 'is a predicate inside the merge statement on SQLite, PostgreSQL and the remote libSQL face. '
    + 'MySQL\'s merge statement takes no predicate, so there the statement and a read of the '
    + 'landed row run in one transaction (a savepoint inside a caller\'s transaction) and the '
    + 'read\'s failure rolls the write back. The tenant column also joined '
    + '`insertOnlyUpsertColumns`, so an upsert with no tenant context keeps the organization of '
    + 'the row it merges into. Two things can break, and neither reaches the compiler, since the '
    + 'call signature is unchanged. Code that let a tenant-scoped upsert land on another '
    + 'organization\'s row now gets a refusal where it got a silent merge. Code that relied on '
    + 'a payload\'s tenant value to move a row on merge now finds the row where it was. '
    + 'ADR-0131 D8 / ADR-0087.',
  acceptanceCriteria:
    'Every caller that upserts with a tenant context handles `UNIQUE_VIOLATION` / 409 as a '
    + 'colliding insert, and none expects a merge into a row its organization cannot read. No '
    + 'caller relies on an upsert payload\'s tenant value to change which organization owns a '
    + 'row; that move goes through the `update` door. Proven when a tenant-scoped upsert on a key '
    + 'another organization\'s row holds answers `UNIQUE_VIOLATION` and that row reads back '
    + 'unchanged, while the same call on a row of the caller\'s own organization merges as '
    + 'before. An upsert with no tenant context that merges into a row leaves the row\'s '
    + 'organization as it was.',
};
