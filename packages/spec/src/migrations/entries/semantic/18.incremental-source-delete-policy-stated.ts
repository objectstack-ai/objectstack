// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An incremental sourced mapping now states how it learns of a delete. A
// structured TODO, not a D2 conversion: whether the source has a soft-delete
// field, and whether a row the source deletes should be marked at all, is
// intent no artifact records. It carries the change's second arm too: a
// synced target with systemFields: false under mark, judged when the pull runs
// only (os validate does not see it).
export const entry: SemanticMigration = {
  id: 'incremental-source-delete-policy-stated',
  surface:
    'data.Mapping with an incremental source — a connectorSource that declares a watermark, or a '
    + 'datasourceSource without full: true — parsed by MappingSchema and judged again by the pull at run '
    + 'time: under deletePolicy absent (which reads as mark) or mark it now names a deletedField. Second '
    + 'arm: a mapping of any source whose targetObject is managedBy: \'synced\' with systemFields: false, under '
    + 'deletePolicy absent or mark, is refused when the pull runs (mapping_target_refused): no row of it can '
    + 'carry _sync_deleted_at. os validate does not catch this arm; only the pull judges it',
  replacement:
    'deletedField: the source field whose truthy value means the record was deleted (a soft-delete flag or '
    + 'deleted-at column the source keeps), or deletePolicy: \'ignore\' to leave a row the source deleted '
    + 'as it is — which is what every pull did before delete marking landed. For the second arm: remove '
    + 'systemFields: false from the synced target so the platform adds its columns, or deletePolicy: \'ignore\'',
  reason:
    'Delete marking landed (ADR-0153 D3): under mark a pull stamps _sync_deleted_at on a row the source '
    + 'deleted and clears it when the row comes back. A full pull sees a delete as an absence; an incremental '
    + 'pull reads only rows changed since its starting point, so it never sees an absent row, and its mark '
    + 'policy would mark nothing (ADR-0078: a declared policy no runtime line honours is refused). The '
    + 'author states the soft-delete field it reads, or ignore. Refused at parse on every door and again '
    + 'when the pull runs (delete_policy_unhonourable). ADR-0049 / ADR-0078 / ADR-0087 / ADR-0153.',
  acceptanceCriteria:
    'Run os validate (or defineStack) over every stack that declares a mapping with a source. Done when '
    + 'each incremental source declares deletedField or deletePolicy: \'ignore\', and each mapping under '
    + 'mark targets a synced object that keeps its system columns (os validate stays green on that arm: '
    + 'check it by hand). A mapping stored at run time, which no build parses, is judged on both arms by '
    + 'its next pull: a failed sys_sync_run naming delete_policy_unhonourable or mapping_target_refused is '
    + 'the signal to apply the replacement.',
};
