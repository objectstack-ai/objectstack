// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A lookup's `dependsOn` filter key is judged against what the engine can
// filter: a field of the referenced object computed on read (a `formula`) has
// no column, so every picker query and every import lookup the entry scopes is
// refused. Semantic-only — which stored field holds the value the author meant
// to scope by is the author's call, so no D2 conversion rewrites it.
export const entry: SemanticMigration = {
  id: 'lookup-depends-on-param-computed-field-refused',
  surface:
    'object.fields.<field>.dependsOn[] on a lookup, master_detail or user field — the filter key the entry '
    + 'scopes the referenced object by (`param` in the { field, param } form, else the bare name or `field`), '
    + 'when it names a field of the referenced object computed on read (a formula)',
  replacement:
    'a stored field of the referenced object that holds the same value, written as { field: '
    + '\'this_record_field\', param: \'stored_referenced_field\' }; or drop the entry when the picker need not '
    + 'be scoped.',
  reason:
    'The record picker filters its candidates, and the importer scopes a lookup cell, by this key on the '
    + 'referenced object, and the engine refuses every filter on a field computed on read. Such an entry '
    + 'published clean, then every picker query it scoped was refused and every import of the column failed '
    + 'its lookup. object-field-ref-unknown now reports it as an error, on objectstack validate and at the '
    + 'runtime publish gate. No D2 conversion exists: only the author knows which stored field carries the '
    + 'value the formula computes.',
  acceptanceCriteria:
    'Run objectstack validate: no object-field-ref-unknown finding says a dependsOn entry names a field '
    + 'computed on read. For each entry it named, the filter key is a stored field of the referenced object, or '
    + 'the entry is gone, and the record picker lists candidates once the field it depends on has a value.',
};
