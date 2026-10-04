// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21226 — registered by the change that put the caller's tenant scope on the
// remote libSQL face's doors, not by a later reconciliation. A driver call is
// code, never stack metadata, so there is no authored source for the chain to
// rewrite and no schema tombstone: this entry is the migration channel beside
// the changeset's FROM → TO table, as for its sibling
// `driver-upsert-cross-organization-conflict-refused`.
export const entry: SemanticMigration = {
  id: 'driver-remote-doors-tenant-scoped',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'IDataDriver find, findOne, count, aggregate, update, delete, bulkUpdate, bulkDelete, '
    + 'updateMany, deleteMany, create and bulkCreate on TursoDriver\'s remote (libSQL) face, '
    + 'called with a tenant context',
  replacement:
    'a tenant-scoped call on the remote face reaches the rows the local face reaches for the '
    + 'same options: the caller\'s organization, rows with no organization, and under the group '
    + 'posture the caller\'s membership set. A by-id `update` outside that scope answers `null`, '
    + 'a by-id `delete` answers `false`, and a predicate write counts only the rows in scope. '
    + '`create` stamps the caller\'s organization on a row that names none. To reach rows of '
    + 'every organization, call without `tenantId`, as on the local face',
  reason:
    'The engine hands every driver the caller\'s organization as `DriverOptions.tenantId`, and '
    + 'the group posture\'s membership set as `tenantIds` (ADR-0131 D8, ADR-0105 D2). '
    + 'TursoDriver\'s local face applies them through `SqlDriver.applyTenantScope` on every read '
    + 'and on every update and delete predicate, and stamps the organization on insert. Its remote '
    + 'face compiles its own statements, and its doors received no driver options: their '
    + 'statements carried the caller\'s filter and nothing else, and a remote `create` wrote no '
    + 'organization. Where the engine\'s Layer 0 wall composes a predicate above the driver, that '
    + 'wall held other organizations\' rows back. Where it composes none (the posture in which '
    + 'Layer 0 is inert, or an elevated caller that carries its organization), the driver scope '
    + 'is the only fence, and on the remote face there was none. The remote doors now compile the '
    + 'local face\'s own predicate, by asking the same chokepoint, and AND it onto each '
    + 'statement, so the two faces answer the same rows by construction. The remote `create` '
    + 'stamps the organization as the local `create` does. `distinct` still refuses a '
    + 'tenant-scoped call on the remote face. The call signatures are unchanged, so nothing '
    + 'reaches the compiler. Code that relied on a tenant-scoped remote call reaching another '
    + 'organization\'s rows now gets the miss answer each door already declares, and a remote '
    + '`create` that relied on landing a row with no organization now finds it under the '
    + 'caller\'s. ADR-0131 D8 / ADR-0087.',
  acceptanceCriteria:
    'No caller of a remote-mode TursoDriver passes `tenantId` and expects to read, count, '
    + 'aggregate, update or delete a row of another organization; a caller that means to reach '
    + 'every organization calls without a tenant context, as on the local face. No caller relies '
    + 'on a tenant-scoped remote `create` landing a row with no organization. Proven when a '
    + 'tenant-scoped call on each door answers the same rows on the remote face as on the local '
    + 'face for the same options: another organization\'s row excluded, `null`, `false` or '
    + 'untouched, and the caller\'s own rows and rows with no organization answered as before.',
};
