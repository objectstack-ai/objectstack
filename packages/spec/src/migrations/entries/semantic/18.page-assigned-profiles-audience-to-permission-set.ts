// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'page-assigned-profiles-audience-to-permission-set',
  surface: '`page.assignedProfiles` — the per-page audience list (REMOVED)',
  replacement:
    "the object's permission sets, bound to people through positions. The page shows DATA; gate "
    + 'that data with the permission sets on the objects it reads (`objects.<name>.allowRead` and '
    + 'the field-level bits), and bind each set to the people who should hold it through a position '
    + '(`sys_position_permission_set`). There is no per-page audience key to move the list into, '
    + 'and ADR-0090 D2 deleted the Profile concept the old list was written in, so each name in a '
    + 'retired `assignedProfiles` list has to be re-expressed as a permission set + position pair.',
  reason:
    'The D2 conversion `page-assigned-profiles-removed` STRIPS the key mechanically, but the strip '
    + 'is not the whole migration and must not read as one: the author who wrote the list was '
    + 'declaring an intent ("only these people see this page") that the platform never honoured. '
    + 'Measured at the ruling: zero readers in this repository and zero in objectui — no renderer, '
    + 'route or metadata read door consulted the key — so the page has been open to every caller '
    + 'who could reach it for as long as the key existed. Deleting it therefore changes no '
    + 'behaviour and closes no hole; it makes an unkept promise stop being made. Which permission '
    + 'set corresponds to a given profile name is a judgement no walker can derive, which is why '
    + 'this is a TODO rather than a rewrite.',
  acceptanceCriteria:
    'No page metadata carries `assignedProfiles` (`os migrate meta --from 17` lists the strips; '
    + '`os migrate meta --stored` covers rows already at rest). For every page that carried one, '
    + 'each name in the old list resolves to a permission set held by the intended people through '
    + 'a position, and a caller OUTSIDE that audience, signed in, is refused the data the page '
    + 'reads — verified against the running deployment, not against the metadata alone. A caller '
    + 'who was previously outside an `assignedProfiles` list and could nonetheless open the page '
    + 'is the pre-existing state, not a regression introduced by the removal.',
};
