// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

/**
 * Organization-Wide Defaults (OWD)
 * The baseline security posture for an object.
 */
import { lazySchema } from '../shared/lazy-schema';
export const OWDModel = z.enum([
  'private',               // Only owner can see
  'public_read',           // Everyone can see, owner can edit
  'public_read_write',     // Everyone can see and edit
  'controlled_by_parent'   // Access derived from parent record (Master-Detail)
]);

/**
 * Sharing Rule Type
 * How is the data shared?
 */
export const SharingRuleType = z.enum([
  'owner',        // Based on record ownership (Role Hierarchy)
  'criteria',     // Based on field values (e.g. Status = 'Open')
]);

/**
 * Sharing Level
 * What access is granted?
 */
export const SharingLevel = z.enum([
  'read',      // Read Only
  'edit',      // Read / Write
  'full'       // Full Access (Transfer, Share, Delete)
]);

/**
 * Recipient Type 
 * Who receives the access?
 */
export const ShareRecipientType = z.enum([
  'user',
  'group',
  'position',
  'unit_and_subordinates',
  'guest' // for public sharing
]);

/**
 * Base Sharing Rule
 * Common metadata for all sharing strategies.
 */
const BaseSharingRuleSchema = z.object({
  // Identification
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique rule name (snake_case)'),
  label: z.string().optional().describe('Human-readable label'),
  description: z.string().optional().describe('Administrative notes'),
  
  // Scope
  object: z.string().describe('Target Object Name'),
  active: z.boolean().default(true),
  
  // Access
  accessLevel: SharingLevel.default('read'),
  
  // Recipient (Whom to share with)
  sharedWith: z.object({
    type: ShareRecipientType,
    value: z.string().describe('ID or Code of the recipient (user / group / position / business unit)'),
  }).describe('The recipient of the shared access'),
});

/**
 * 1. Criteria-Based Sharing Rule
 * Share records that meet specific field criteria.
 */
export const CriteriaSharingRuleSchema = lazySchema(() => BaseSharingRuleSchema.extend({
  type: z.literal('criteria'),
  condition: ExpressionInputSchema.describe('Predicate (CEL). e.g. P`record.department == "Sales"`'),
}));

/**
 * 2. Owner-Based Sharing Rule
 * Share records owned by a specific group of users.
 */
export const OwnerSharingRuleSchema = lazySchema(() => BaseSharingRuleSchema.extend({
  type: z.literal('owner'),
  ownedBy: z.object({
    type: ShareRecipientType,
    value: z.string(),
  }).describe('Source group/position whose records are being shared'),
}));

/**
 * Master Sharing Rule Schema
 *
 * ADR-0058 D3 — closes #1887. The CEL `condition` of a criteria-based rule is
 * COMPILED to the runtime `criteria_json` FilterCondition by the canonical
 * `@objectstack/formula` compiler at seed / `defineRule` time, and ENFORCED:
 * records matching the criteria materialise `sys_record_share` grants for the
 * resolved recipients. Supported recipients: `user` / `team` / `business_unit` /
 * `position` / `unit_and_subordinates` (ADR-0057 D5; renamed by ADR-0090 D3).
 *
 * Still `[experimental — not enforced]` (ADR-0049): `owner`-type rules
 * (`ownedBy` — depends on live role membership, with no static `criteria_json`
 * equivalent) and `group` / `guest` recipients (no runtime recipient mapping).
 * A `condition` the compiler cannot lower (functions, cross-object traversal) is
 * skipped and logged — never seeded as a permissive match-all.
 */
export const SharingRuleSchema = lazySchema(() => z.discriminatedUnion('type', [
  CriteriaSharingRuleSchema,
  OwnerSharingRuleSchema
]));

export type SharingRule = z.infer<typeof SharingRuleSchema>;
/** Authoring input for {@link SharingRule} — defaulted fields are optional. */
export type SharingRuleInput = z.input<typeof SharingRuleSchema>;
export type CriteriaSharingRule = z.infer<typeof CriteriaSharingRuleSchema>;
export type OwnerSharingRule = z.infer<typeof OwnerSharingRuleSchema>;

/**
 * Type-safe factory for a record sharing rule. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: SharingRule` literal.
 */
export function defineSharingRule(config: z.input<typeof SharingRuleSchema>): SharingRule {
  return SharingRuleSchema.parse(config);
}
