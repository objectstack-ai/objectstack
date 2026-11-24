// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An incremental sourced mapping now states how it learns of a delete. A
// structured TODO, not a D2 conversion: whether the source has a soft-delete
// field, and whether a row the source deletes should be marked at all, is
// intent no artifact records.
export const entry: SemanticMigration = {
  id: 'incremental-source-delete-policy-stated',
  surface:
    'data.Mapping with an incremental source — a connectorSource that declares a watermark, or a '
    + 'datasourceSource without full: true — parsed by MappingSchema and judged again by the pull at run '
    + 'time: under deletePolicy absent (which reads as mark) or mark it now names a deletedField',
  replacement:
    'deletedField: the source field whose truthy value means the record was deleted (a soft-delete flag or '
    + 'deleted-at column the source keeps), or deletePolicy: \'ignore\' to leave a row the source deleted '
    + 'as it is — which is what every pull did before delete marking landed',
  reason:
    'Delete marking landed (ADR-0153 D3): under mark a pull stamps _sync_deleted_at on a row the source '
    + 'deleted and clears it when the row comes back. A full pull sees a delete as an absence; an incremental '
    + 'pull reads only rows changed since its starting point, so it never sees an absent row, and its mark '
    + 'policy would mark nothing (ADR-0078: a declared policy no runtime line honours is refused). The '
    + 'author states the soft-delete field it reads, or ignore. Refused at parse on every door and again '
    + 'when the pull runs (delete_policy_unhonourable). ADR-0049 / ADR-0078 / ADR-0087 / ADR-0153.',
  acceptanceCriteria:
    'Run os validate (or defineStack) over every stack that declares a mapping with a source. Done when '
    + 'each incremental source declares deletedField or deletePolicy: \'ignore\'.',
};
