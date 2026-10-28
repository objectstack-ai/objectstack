// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * The array arm of the projection rule every published declaration of a
 * read's projection shares: a list names at least one field, and no member is
 * blank. Absent means "every column", so an empty projection read as absent is
 * a widening; it is refused instead, in one sentence.
 *
 * Declared in its own module, outside the `data` barrel, because its readers
 * sit on both sides of an import edge: `./query.zod.ts` (the QueryAST's own
 * `fields`, and so every nested `expand` value), `./data-engine.zod.ts` (the
 * transport and engine-side spellings, which import `./query.zod.ts`) and
 * `../automation/builtin-node-config.zod.ts` (the flow `get_record` node's
 * `fields`). The accept set and its history are documented beside the
 * transport arms in `./data-engine.zod.ts`.
 *
 * [#27166] The QueryAST and `get_record` declarations joined once the
 * in-process engine refused an empty projection at its `find` / `findOne`
 * entry, top level and at any `expand` depth.
 */
export const PROJECTION_NAMES_NO_FIELD = 'Name at least one field';

export const transportProjectionArray = <T extends z.ZodString>(member: T) =>
  z.array(member.regex(/\S/, 'A field name cannot be blank')).min(1, PROJECTION_NAMES_NO_FIELD);
