// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D8 (stage 8a of the C8 card) — a runtime widening with no authorable
// key: the engine stops deriving the driver's tenant read scope beside the
// organization wall and projects the wall's own verdict instead. Registered
// because a read, update or delete that used to be narrowed to the context's
// organization by the driver alone now reaches what the wall admits, and a
// caller that leaned on the old narrowing must be told where the scope lives.
// A driver option is code, never stack metadata, so there is no authored source
// for the chain to rewrite and no schema tombstone: this entry is the migration
// channel beside the changeset's FROM → TO table.
export const entry: SemanticMigration = {
  id: 'driver-read-scope-follows-tenant-wall',
  // No backticks in `surface`: build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'ObjectQL find, findOne, count, aggregate, and update and delete by id or by predicate, on an '
    + 'object with an organization column, called with an execution context that names an organization: '
    + 'the DriverOptions tenantId and tenantIds the engine hands every driver',
  replacement:
    'the driver read scope is the organization wall\'s verdict (computeTenantLayer0Verdict, '
    + '@objectstack/core): none on a single deployment, the active organization on isolated, the '
    + 'membership set on group, and none where the wall admits an exempt platform administrator or '
    + 'the verified platform owner\'s read. To keep one organization\'s rows apart from another\'s, '
    + 'run the deployment on the isolated or group posture, or name the organization in the query\'s '
    + 'own where clause. Inserts and upserts still stamp the active organization in every posture',
  reason:
    'ADR-0131 D8 makes the tenant predicate one value computed once and threaded to Layer 0 and to '
    + 'every driver. Before this change the engine derived the driver scope on its own from the '
    + 'context organization alone: on a single deployment, where Layer 0 composes nothing, the driver '
    + 'still narrowed every read, update and delete to that organization, and under a wall it '
    + 'narrowed the exempt platform administrator\'s and the verified owner\'s reads that Layer 0 had '
    + 'admitted. Two walls gave two answers for one operation. A single deployment holding more than '
    + 'one organization was isolated by that accident, not by any declared rule; ADR-0131 D11 makes '
    + 'postures differ only in enforcement, and single enforces no wall.',
  acceptanceCriteria:
    'No code on a single deployment relies on a context organization to keep another organization\'s '
    + 'rows out of a read, count, aggregate, update or delete; no code under a wall relies on the '
    + 'driver to narrow a platform administrator\'s read that the security layer admits. Proven when, '
    + 'on a single deployment, a read with a context organization returns the same rows as the same '
    + 'read with none, while on isolated it returns that organization\'s rows and on group the '
    + 'membership set\'s (organization-less rows still included by the driver\'s compatibility '
    + 'arm until ADR-0131 D13 retires it), and an insert on any posture lands stamped with the active organization.',
};
