// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from './identifiers.zod';

// ============================================================================
// Shared Metadata Types
// ============================================================================

// The single declaration of the metadata-format vocabulary (#4537), re-exported
// by `system/metadata-persistence.zod` and consumed by
// `kernel/metadata-loader.zod` (`MetadataManagerConfig.formats`, #4411). Only
// the four canonical names: extension-style aliases (`yml`/`ts`/`js`) are
// normalized away at the loader boundary (`FilesystemLoader.detectFormat`)
// and never reach a `format` field.
/** Supported metadata file formats */
import { lazySchema } from './lazy-schema';
export const MetadataFormatSchema = lazySchema(() => z.enum(['yaml', 'json', 'typescript', 'javascript'])
  .describe('Metadata file format'));
export type MetadataFormat = z.input<typeof MetadataFormatSchema>;

/** Base metadata record fields shared across kernel and system layers */
export const BaseMetadataRecordSchema = lazySchema(() => z.object({
  id: z.string().describe('Unique metadata record identifier'),
  type: z.string().describe('Metadata type (e.g. "object", "view", "flow")'),
  name: SnakeCaseIdentifierSchema.describe('Machine name (snake_case)'),
  format: MetadataFormatSchema.optional().describe('Source file format'),
}).describe('Base metadata record fields shared across kernel and system'));
export type BaseMetadataRecord = z.input<typeof BaseMetadataRecordSchema>;
