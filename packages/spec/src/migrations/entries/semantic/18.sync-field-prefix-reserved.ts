// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A field named under the _sync_ prefix is refused on every object and object
// extension. A structured TODO, not a D2 conversion: the field's new name is
// the author's choice, and its stored column has to move with it.
export const entry: SemanticMigration = {
  id: 'sync-field-prefix-reserved',
  surface:
    'data.Object.fields and data.ObjectExtension.fields — a field key starting with _sync_ is now '
    + 'refused at parse, on any object (synced or not) and in an object extension; the published JSON '
    + 'Schema states the reservation as a second key pattern. fieldPatches, which patches an existing '
    + 'field, is unchanged',
  replacement:
    'the same field under a name outside the prefix, such as synced_at, source_id or external_id, '
    + 'with its stored column renamed to match',
  reason:
    'The prefix names the provenance columns the platform\'s pull stamps on a synced object '
    + '(_sync_source, _sync_external_id, _sync_pulled_at, _sync_run_id, _sync_deleted_at; ADR-0153 '
    + 'D4). Field keys may start with an underscore, so an author\'s own _sync_ column would collide '
    + 'with one of them or be read as one. The reservation is refused at the field\'s own key, with '
    + 'a message naming the prefix and a rename. ADR-0049 / ADR-0087 / ADR-0153.',
  acceptanceCriteria:
    'Run os validate (or defineStack) over every stack and re-save every stored object definition. '
    + 'Done when no object or object extension declares a field whose name starts with _sync_.',
};
