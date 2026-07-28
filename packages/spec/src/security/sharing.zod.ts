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
 *
 * `criteria` is the single enforced rule form (field-value predicates,
 * compiled to `criteria_json` and materialised as `sys_record_share`).
 * `owner`-type rules ("share records owned by members of X") were REMOVED
 * from the authoring surface: they depend on live team/position membership,
 * which the static materialiser cannot track (a membership change would have
 * to re-materialise every dependent rule). They return as an enforced form if
 * membership-reactive materialisation is designed; until then a rule that
 * validates but silently does nothing is an authoring trap (ADR-0078).
 */
export const SharingRuleType = z.enum([
  'criteria',     // Based on field values (e.g. Status = 'Open')
]);

/**
 * Sharing Level
 * What access is granted?
 *
 * Both members map onto an enforced runtime behaviour: `read` widens the read
 * filter (`buildReadFilter`), `edit` additionally opens the write gate
 * (`buildWriteFilter` / `canEdit`).
 *
 * Removed (never enforced): `full`, documented as "Full Access (Transfer,
 * Share, Delete)". NO code path granted transfer, re-share, or delete because
 * of it — both enforcement sites matched `access_level in ('edit','full')`,
 * making it byte-equivalent to `edit`. An admin picking it in Setup was told
 * they had granted delete rights and had not; a level that validates and then
 * silently does nothing is an authoring trap (ADR-0078, ADR-0049) — the same
 * reason `ShareRecipientType` below dropped `queue` / `guest`.
 *
 * This is also where the industry model lands: record sharing widens WHICH
 * ROWS a principal reaches, never WHICH VERBS they may use. Salesforce sharing
 * rules stop at Read-Only / Read-Write (its Full Access is owner / hierarchy /
 * Modify All only, never grantable by a rule); Dataverse AND-s any shared
 * access right against the security role's own privilege. Delete and transfer
 * belong to ownership, the hierarchy DEPTH scopes (ADR-0057), and admin scope
 * — not to a sharing level. Re-share additionally presupposes a
 * share-administration model that does not exist yet. Reviving `full` means
 * designing a capability mask AND-ed with object CRUD, not re-adding an enum
 * member (#3865).
 */
export const SharingLevel = z.enum([
  'read',      // Read Only
  'edit',      // Read / Write
]);

/**
 * Recipient Type
 * Who receives the access?
 *
 * Every member maps 1:1 onto an enforced runtime recipient expansion
 * (`plugin-sharing` `expandRecipient`) — this enum is the authorable subset of
 * the runtime `SharingRuleRecipientType` contract:
 * - `user` — a single user id.
 * - `team` — every member of a `sys_team` (flat collaboration grouping;
 *   ADR-0090 D3 renamed the pre-D3 `group` vocabulary to `team`).
 * - `position` — every holder of a position (flat; ADR-0090 D3).
 * - `unit_and_subordinates` — a business unit plus every descendant unit's
 *   members (ADR-0057 D5 subtree widening).
 * - `business_unit` — exactly one business unit's members (no subtree).
 *
 * Removed (never enforced): `group` (renamed → `team`) and `guest` — anonymous
 * access is served by the public-form grant and share links, not sharing rules;
 * a guest recipient that silently no-ops is an authoring trap (ADR-0078). The
 * runtime contract additionally reserves `queue` (no `sys_queue` yet) — it is
 * deliberately NOT authorable until the implementation lands.
 */
export const ShareRecipientType = z.enum([
  'user',
  'team',
  'position',
  'unit_and_subordinates',
  'business_unit',
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
    value: z.string().describe('ID or code of the recipient (user / team / position / business unit)'),
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
 * Master Sharing Rule Schema
 *
 * ADR-0058 D3 — closes #1887. The CEL `condition` of a criteria-based rule is
 * COMPILED to the runtime `criteria_json` FilterCondition by the canonical
 * `@objectstack/formula` compiler at seed / `defineRule` time, and ENFORCED:
 * records matching the criteria materialise `sys_record_share` grants for the
 * resolved recipients. Supported recipients: `user` / `team` / `position` /
 * `unit_and_subordinates` / `business_unit` (ADR-0057 D5; ADR-0090 D3) — every
 * authorable recipient expands at runtime (`plugin-sharing` `expandRecipient`).
 *
 * The whole authorable surface is enforced — nothing here validates and then
 * silently does nothing (ADR-0078). Removed to keep it that way: `owner`-type
 * rules (`ownedBy` — live-membership-dependent, needs membership-reactive
 * re-materialisation that is not designed yet) and the `group` / `guest`
 * recipients (`group` renamed → `team`; anonymous access is the public-form
 * grant / share-link surface). A `condition` the compiler cannot lower
 * (functions, cross-object traversal) is skipped and logged — never seeded as
 * a permissive match-all (ADR-0049).
 *
 * Kept as the `SharingRuleType`-discriminated form so a future enforced rule
 * type (e.g. membership-reactive owner-based) re-joins as a union member.
 */
export const SharingRuleSchema = CriteriaSharingRuleSchema;

export type SharingRule = z.infer<typeof SharingRuleSchema>;
/** Authoring input for {@link SharingRule} — defaulted fields are optional. */
export type SharingRuleInput = z.input<typeof SharingRuleSchema>;
export type CriteriaSharingRule = z.infer<typeof CriteriaSharingRuleSchema>;

/**
 * Type-safe factory for a record sharing rule. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: SharingRule` literal.
 */
export function defineSharingRule(config: z.input<typeof SharingRuleSchema>): SharingRule {
  return SharingRuleSchema.parse(config);
}
