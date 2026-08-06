// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { retiredKey } from './retired-key';

/**
 * Base Field Mapping Protocol
 *
 * Shared by: Connector, External Lookup
 *
 * This module provides the canonical field mapping schema used across
 * ObjectStack for data synchronization.
 *
 * **Use Cases:**
 * - Integration connectors (integration/connector.zod.ts)
 * - External lookups (data/external-lookup.zod.ts)
 *
 * @example Basic field mapping
 * ```typescript
 * const mapping: FieldMapping = {
 *   source: 'external_user_id',
 *   target: 'user_id',
 * };
 * ```
 *
 * @example With a fallback for missing source values
 * ```typescript
 * const mapping: FieldMapping = {
 *   source: 'user_name',
 *   target: 'name',
 *   defaultValue: 'Unknown'
 * };
 * ```
 *
 * ## What is NOT here any more: `transform` (#5552, protocol 17)
 *
 * This schema used to carry a `transform` key typed by a five-member
 * discriminated union (`FieldMappingTransformSchema`: `constant` / `cast` /
 * `lookup` / `javascript` / `map`). The whole union was retired under ADR-0049
 * enforce-or-remove; the tombstone below carries the prescription.
 *
 * The measurement that decided it (2026-08-06, against `origin/main`): **no
 * runtime anywhere reads a `transform` off a field mapping.** `fieldMappings`
 * is spelled only inside `packages/spec` itself — its own schemas and their
 * tests — and the two schemas that extend this one
 * (`integration/ConnectorFieldMapping`, `data/ExternalFieldMapping`) reach a
 * real `.parse()` (`AutomationEngine.registerConnector` →
 * `ConnectorSchema.parse`) but no executor. Five declared transforms, zero
 * engines: the union was `declared ≠ enforced` in full (Prime Directive #10),
 * not merely in its `javascript` member.
 *
 * The `javascript` member is why #5552 was filed and is the sharpest evidence:
 * its `.describe()` recommended `dialect="js"`, a dialect `ExpressionDialect`
 * retired in #3278 (ADR-0058 addendum). An author following that line was
 * rejected by the enum; the only spelling that parsed was the bare-string
 * shorthand, which `ExpressionInputSchema` wraps as `dialect: 'cel'` — so the
 * member named `javascript` could only ever hold CEL, and its own example
 * (`value.toUpperCase()`) is not valid CEL either. Three surfaces disagreeing
 * over a capability nothing implemented.
 *
 * **The transform pipeline that IS enforced** is a different schema with a
 * different shape, and it stays: `data/mapping.zod.ts`'s
 * `ImportFieldMappingSchema.transform` — a flat string enum steering a `params`
 * bag, applied row by row by the REST import path
 * (`packages/rest/src/import-mapping.ts:115-167`) and recorded live, key by
 * key, in `packages/spec/liveness/mapping.json`. Notably it does not pretend
 * about JS either: its `javascript` value is REJECTED with a 400 because there
 * is no server sandbox. Same word, opposite disposition — one surface runs and
 * says so, the other never ran.
 */

import { lazySchema } from './lazy-schema';

/**
 * Field Mapping Schema
 *
 * Base schema for mapping fields between source and target systems.
 *
 * **NAMING CONVENTION:**
 * - source: Field name in the source system
 * - target: Field name in the target system (should be snake_case for ObjectStack)
 *
 * @example
 * ```typescript
 * {
 *   source: 'FirstName',
 *   target: 'first_name',
 *   defaultValue: ''
 * }
 * ```
 */
export const FieldMappingSchema = lazySchema(() => z.object({
  /**
   * Source field name
   */
  source: z.string().describe('Source field name'),

  /**
   * Target field name (should be snake_case for ObjectStack)
   */
  target: z.string().describe('Target field name'),

  /**
   * REMOVED at protocol 17 (#5552, ADR-0049). See the module TSDoc above for
   * the measurement. Tombstoned rather than deleted because this schema and
   * both of its extenders are plain `z.object`s: a plain delete would strip the
   * key silently, replacing one silent no-op with another.
   */
  transform: retiredKey(
    '`FieldMapping.transform` — authored as `connector.fieldMappings[].transform` and '
    + '`externalLookup.fieldMappings[].transform` — was removed in @objectstack/spec 17.0.0 '
    + '(#5552, ADR-0049), and the whole `FieldMappingTransform` union went with it '
    + '(`constant` / `cast` / `lookup` / `javascript` / `map`) — no runtime ever executed '
    + 'any of the five, and the `javascript` member advertised `dialect: "js"`, a dialect '
    + 'retired in #3278. Delete the key. The transform pipeline that IS enforced is the '
    + "import mapping's: `mapping.fieldMapping[].transform` (a string enum — "
    + '`none`/`constant`/`map`/`split`/`join`/`lookup` — with its settings in `params`), '
    + 'applied by the REST import path, which rejects `javascript` with a 400 rather than '
    + 'pretending to run it. Run `os migrate meta --from 16` to rewrite it automatically.',
  ),

  /**
   * Default value if source is null/undefined
   */
  defaultValue: z.unknown().optional().describe('Default if source is null/undefined'),
}));

export type FieldMapping = z.infer<typeof FieldMappingSchema>;
