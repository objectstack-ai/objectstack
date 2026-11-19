// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'flow-hook-condition-injected-column-null-guard-at-build',
  surface:
    'automation.Flow start node config.condition, edges[].condition and decision branch expression of a '
    + 'record-triggered flow, and data.Hook condition: an ordering or arithmetic operator applied, with no '
    + '!= null guard, to an injected system column the object does not declare itself (owner_id, created_by, '
    + 'updated_by, owning_business_unit_id, queue, organization_id; and created_at / updated_at in a hook whose '
    + 'events include beforeInsert)',
  replacement:
    'Guard the column in the same branch: record.owner_id != null && record.owner_id > \'a\'. A start '
    + 'condition\'s guard holds at every edge and branch of the flow. has() is no guard.',
  reason:
    'os build judged the null guard over the declared fields only, so it accepted these conditions while the '
    + 'runtime publish gate, which reads the object as served with the injected columns declared, refused them. '
    + 'A stored row holds null in those columns: a system-context insert stores null in owner_id, created_by and '
    + 'updated_by, a seeded row keeps created_by and updated_by null, nothing stamps owning_business_unit_id, '
    + 'queue is null until a queue write names one, a beforeInsert hook reads organization_id as null (it is '
    + 'resolved after the hook chain), and a beforeInsert hook can read created_at and updated_at as null when '
    + 'it runs before the stamp (priority below 10). CEL has no ordering or arithmetic over null, so on '
    + 'such a row the flow run fails at the condition (the write that fired it still lands) and a hook condition '
    + 'fails the write. os build now refuses the same conditions the publish gate refuses, with the same '
    + 'finding; so do the MCP validate_expression tool at a flow condition and a publish-drafts batch that '
    + 'carries a draft of the flow\'s or hook\'s own object, which both judge the object as authored. There is no mechanical rewrite: whether a null value should pass or fail the condition is the '
    + 'author\'s call.',
  acceptanceCriteria:
    'os build and os validate report no expression-invalid null-guard error naming the column on the flow or '
    + 'hook condition; POST /api/v1/packages/PKG/publish-drafts publishes the flow or hook; a system-context '
    + 'insert of a row with the column empty starts the flow and the run completes past the condition.',
};
