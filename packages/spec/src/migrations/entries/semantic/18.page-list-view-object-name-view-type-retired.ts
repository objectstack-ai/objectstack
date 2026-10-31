// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22444, ruling C (record 6100463199, the maintainer's 「同意」): the page
// carrier converges on the list view's own spelling — one list view, one set of
// property names wherever it is embedded. `ComponentPropsMap['list-view']` is
// the list view's members by reference, and refuses the page carrier's
// `objectName` / `viewType` by name with the react tier's prescription for the
// same two aliases. Neither key was ever declared on the spec's page carrier
// (it had no `list-view` row), so there is no tombstone and no
// RETIRED_KEYS_BY_MAJOR row: the refusal is the row's guidance. Data at rest
// replays the retired D2 entry `page-list-view-object-name-view-type-to-data-type`
// on read. The judgment left to the author is the TODO that entry reports: an
// alias beside a spec key that answers the same question differently.
export const entry: SemanticMigration = {
  id: 'page-list-view-object-name-view-type-retired',
  surface:
    'pages[] — a page component of type list-view (in a region, a slot, or nested in a container such as '
    + 'page:tabs) whose properties carry objectName or viewType',
  replacement:
    'Write the list view\'s own spelling in `properties`: `data: { provider: \'object\', object: \'…\' }` '
    + 'for the object (or name it on the node\'s `dataSource.object` binding) and `type: \'kanban\'` for the '
    + 'list kind. The node\'s own `type` stays `list-view`. `os migrate meta --from 17 --write` rewrites the '
    + 'nodes it can prove.',
  reason:
    'A page list-view node spelled its object and its kind objectName and viewType while every other list '
    + 'view door spells them data and type, and its properties were judged by nothing: a key every list view '
    + 'door refuses saved green on a page. The props row now judges the bag as a list view and refuses both '
    + 'aliases by name; the pinned console reads only the spec spelling off a page list-view node, so a node '
    + 'that still carries the alias queries no object or draws a grid. ⚠️ Data at rest converts instead: a '
    + 'stored page row, a compiled artifact inside the window its manifest opens and an installed package '
    + 'replay the retired conversion page-list-view-object-name-view-type-to-data-type on read, which moves '
    + 'each alias to its spec key with an OS_METADATA_CONVERTED notice. An alias beside a spec key that says '
    + 'something different (an objectName beside a data source or a dataSource.object naming another object, '
    + 'a viewType beside a different type) is left as stored and reported as an OS_METADATA_CONVERSION_TODO, '
    + 'because which one the author meant is not a walker\'s call. ADR-0087.',
  acceptanceCriteria:
    'Grep every page in defineStack pages sources, exported stacks and every page row in sys_metadata for a '
    + 'component of type list-view whose properties carry objectName or viewType. Move each to data and type '
    + '(os migrate meta --from 17 --write does it where it can prove the edit), and resolve every TODO it '
    + 'reports by keeping the one value the list should show. Then objectstack validate reports no '
    + 'component-props-unknown-key finding at a list-view node\'s properties.objectName or properties.viewType, '
    + 'and each list draws the same object and kind as before.',
  conversionIds: ['page-list-view-object-name-view-type-to-data-type'],
};
