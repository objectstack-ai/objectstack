// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'sharing-rule-declared-mirror-retired',
  surface:
    'a stack\'s declared `sharingRules` are no longer copied into `sys_sharing_rule` at boot — '
    + 'the declared-rule seeder (`bootstrapDeclaredSharingRules`, @objectstack/plugin-sharing) is '
    + 'retired. FROM one `managed_by: package` row per declared rule TO none: the sharing-rule '
    + 'service reads each declared rule from the registry, its id is its name, and its grants carry '
    + 'that name as `sys_record_share.source_id`; the organization-ownership ceremony renames the '
    + 'grants of the rows the seeder wrote, then deletes those rows, and Setup\'s Sharing Rules object '
    + 'list (which lists rows) no longer shows declared rules. `DELETE /api/v1/sharing/rules/:idOrName` '
    + 'on a declared rule: FROM 204 with the seeded row deleted (and written again by the next boot) '
    + 'TO 403 PERMISSION_DENIED',
  replacement:
    'change or remove the rule in its declaration in the package (the stack\'s `sharingRules`); '
    + 'read declared rules through `GET /api/v1/sharing/rules`, which lists them beside the rules an '
    + 'organization authors. An organization\'s own rule is deleted as before. On an upgraded '
    + 'database run `os migrate organization-ownership --apply` with a fresh plan: its mirror-deletion '
    + 'step removes the seeded copies',
  reason:
    'ADR-0131 D2 retires the seeders: declared metadata is code, served from the registry, and a '
    + 'copy of it in a table is a second source that drifts and that the ownership ceremony cannot '
    + 'attribute (a NULL-organization row per declared rule under `single`). C3 stage 9, ordered by '
    + 'ruling β on the C3 epic: the registry read first, then the ceremony deletes the copies — '
    + 'grants renamed from the copy\'s row id to the rule\'s name BEFORE any copy is deleted, so no '
    + 'standing access is orphaned — and only then can the ceremony\'s verified marker mean zero NULL '
    + 'rows. The seeder is machinery, not an authorable shape: no key of any spec schema moves, and a '
    + 'stack authors `sharingRules` exactly as before, so no stored-metadata rewrite exists and this '
    + 'entry is the retirement note and the notification channel (ADR-0131 D13: each retirement is an '
    + 'ADR-0087 entry). ADR-0131 D2, D10, D13; ADR-0057 D6 (the runtime shape is canonical).',
  acceptanceCriteria:
    'A fresh boot in every posture writes no `sys_sharing_rule` row for a declared rule and the rule '
    + 'still grants; removing the declaration stops its grant; no consumer deletes a declared rule '
    + 'through the sharing-rule API or expects it as a `sys_sharing_rule` row; an upgraded database '
    + 'certifies only after the ceremony has deleted the seeded copies.',
};
