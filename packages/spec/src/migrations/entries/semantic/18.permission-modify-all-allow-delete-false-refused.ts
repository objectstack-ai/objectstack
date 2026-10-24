// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The data-at-rest half is the D2 conversion
// `permission-modify-all-allow-delete-false-to-true`, retired from the load
// path from day one: stored rows and older built artifacts are rewritten, and a
// live author is refused with the prescription instead.
export const entry: SemanticMigration = {
  id: 'permission-modify-all-allow-delete-false-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'security.permission.objects.*.allowDelete (ObjectPermissionSchema) set to false in an entry that '
    + 'also sets modifyAllRecords: true. Modify All Records is the write bypass for edit, delete and '
    + 'transfer, so the permission evaluator granted delete on the bypass bit and never read the false',
  replacement:
    'Decide which of the two the permission set means. To delete every record: delete `allowDelete` from '
    + 'the entry (an entry that sets `modifyAllRecords: true` and omits it now parses to '
    + '`allowDelete: true`), or write `allowDelete: true`. To edit records the holder does not own but '
    + 'delete none: remove `modifyAllRecords`, keep `allowEdit: true` and `allowDelete: false`, and grant '
    + 'the edit with a sharing rule: `{ type: \'criteria\', object, condition, accessLevel: \'edit\', '
    + 'sharedWith: { type: \'position\', value: \'<the position that holds this set>\' } }`. An edit '
    + 'share opens update and never delete (ADR-0111 D3); the object needs an owner field and an '
    + 'owner-write default (`private` or `public_read`). The `condition` must be a field predicate: a '
    + 'literal `true` compiles to an empty filter, which the sharing service refuses as match-all.',
  reason:
    'Maintainer ruling A, 2026-10-24: keep the Modify All semantics, which match Salesforce '
    + '"Modify All", and refuse the contradictory pair at publish time; "edit all, delete none" is '
    + 'expressed with row-level sharing. Measured on 18.0.0 by an app author: a buyer permission set '
    + 'declaring `allowEdit: true, allowDelete: false, modifyAllRecords: true` on a `public_read` object '
    + 'could delete every row. The pair parsed, was stored in sys_permission_set.object_permissions, and a '
    + 'census reading the stored entry counted a delete restriction the runtime never enforced '
    + '(ADR-0049 declared ≠ enforced). The refusal is a refinement on the AUTHORING object-permission '
    + 'schema at the allowDelete path; the response-side EffectiveObjectPermissionSchema stays tolerant '
    + '(the #4001 authorable/wire split). Because allowDelete defaults to false, the same parse writes '
    + '`allowDelete: true` into an entry that sets `modifyAllRecords: true` and omits the key; without '
    + 'that, every parse output of such an entry would be the refused pair and its next parse would fail. '
    + 'The runtime is unchanged: what the evaluator grants is exactly what it granted before. STORED ROWS '
    + 'AND OLDER BUILT ARTIFACTS: every earlier parse filled an omitted allowDelete with false, so the pair '
    + 'is also present where nobody wrote it. The D2 conversion '
    + '`permission-modify-all-allow-delete-false-to-true` rewrites it to true on stored-row rehydration and '
    + 'for a built artifact inside its declared-floor window, which changes no access decision. It is '
    + 'retired from the load path, so a source that still declares the pair is refused rather than '
    + 'rewritten. Ships at once, no grace window and no dual spelling. ADR-0049 / ADR-0087 / ADR-0111.',
  // The rewrite `os migrate meta` applies to a source carrying the pair keeps
  // the delete grant the runtime already gave; this entry is the judgment the
  // author still owes on it.
  conversionIds: ['permission-modify-all-allow-delete-false-to-true'],
  acceptanceCriteria:
    'Search every authored permission set for an object-permission entry (wildcard `*` included) that sets '
    + 'both `modifyAllRecords: true` and `allowDelete: false`, and decide as the replacement says: remove '
    + '`allowDelete: false` where Modify All is meant, or replace `modifyAllRecords` with an `edit` sharing '
    + 'rule where delete must stay withheld. `PermissionSetSchema.safeParse` answers exactly one `custom` '
    + 'issue at `objects.<object>.allowDelete` for each such entry. Rebuilding an artifact from sources '
    + 'that omit `allowDelete` under Modify All needs no edit: the new parse writes `allowDelete: true`. '
    + 'The repository carried no authored pair at the time of the change; the showcase `showcase_ops` set '
    + 'and the verifier fixture omit `allowDelete` under Modify All and parse to `allowDelete: true`.',
};
