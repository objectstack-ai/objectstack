// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * The accept set of a search-field override — `searchFields`, its transport
 * spelling `$searchFields`, and the structured search's `fields` — as the
 * protocol door judges it (`assertSearchFieldsAreSearchable` in
 * `@objectstack/metadata-protocol`, reached from `findData` and so from every
 * Data API list, query and export door). A comma string is split, trimmed and
 * emptied of blank members there, an array is kept as sent, and a value naming
 * NO field is refused with a 400: absent means "search the object's default
 * search fields", so an empty override read as absent is a widening.
 *
 * The string arm is that rule as a pattern: `[^\s,]` holds iff some comma
 * segment has a non-whitespace character, and `\s` is exactly the set
 * `trim()` strips. The array arm refuses only the empty list, because that is
 * all the door refuses as naming no field: a blank member is a name the door
 * then looks up, and refuses as an unknown field when the object is known.
 * A pattern and a minimum, not refinements, so the published JSON Schema
 * states both.
 *
 * Declared in its own module, outside the `data` barrel, because its readers
 * sit on both sides of an import edge: `./query.zod.ts` (`QuerySchema.searchFields`
 * and `FullTextSearchSchema.fields`) and `./data-engine.zod.ts` (the transport
 * spelling `$searchFields`, which imports `./query.zod.ts`). The projection's
 * rule lives beside it in `./projection-names-a-field.ts`.
 *
 * [#27683] The declarations joined the door, which refuses this set since
 * #27484. [#28059] The engine-side `searchFields` declarations
 * (`EngineQueryOptionsSchema` and its aggregate and count siblings) take the
 * array arm too, so no published declaration of the override admits `[]`.
 */
export const SEARCH_FIELDS_NAMES_NO_FIELD =
  'Name at least one field, or leave the key out to search the default search fields';

export const SEARCH_FIELDS_ACCEPT_SET =
  'at least one field name; a value naming no field (blank, only commas and spaces, or an empty list) is refused';

export const searchFieldsString = () => z.string().regex(/[^\s,]/, SEARCH_FIELDS_NAMES_NO_FIELD);

export const searchFieldsArray = () => z.array(z.string()).min(1, SEARCH_FIELDS_NAMES_NO_FIELD);
