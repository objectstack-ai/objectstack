// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Column Apply-On Policy — when a write door that matches rows by a natural
 * key writes a column.
 *
 * - `always` writes the column on every row the door creates or updates.
 * - `create` writes it only when the door creates the row. On a row the door
 *   matched, the column is left out of the update, so the value the row holds
 *   (one a job or a person wrote since) stays.
 *
 * One vocabulary for both doors that upsert by a natural key, so a column means
 * the same thing whichever door loads it: an import mapping entry
 * (`FieldMappingEntry.applyOn`, #25577) and a seed dataset column
 * (`SeedColumn.applyOn`, #25761). Each door declares its own default on its own
 * key (`always` on both), and neither spells the values a second time.
 */
export const ColumnApplyOnSchema = z.enum(['create', 'always'])
  .describe('When a matched-row write door writes a column: `always` on create and update, `create` on create only');

export type ColumnApplyOn = z.infer<typeof ColumnApplyOnSchema>;
