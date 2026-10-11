// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { strictObject } from '../shared/strict-object';

/**
 * Position Schema — the flat capability-distribution group (ADR-0090 D3).
 *
 * A position (岗位, "job role" in NetSuite/Workday terms) is a **named,
 * assignable bundle of permission sets**: users hold positions
 * (`sys_user_position`), a position names the permission sets it distributes
 * in {@link PositionSchema}'s `permissionSets` (ADR-0131 D3/D4: the binding is
 * part of the definition, resolved by name in the environment catalog), and a
 * user's capability is the union of every set reached that way plus direct
 * grants.
 *
 * Positions are deliberately **flat** — no `parent`, no hierarchy. The
 * visibility hierarchy lives on the business-unit tree (`sys_business_unit`,
 * ADR-0057 D2) and the manager chain (`sys_user.manager_id`); re-adding a
 * second tree here is the mistake ADR-0057 D5 retired and ADR-0090 D3
 * finalizes.
 *
 * VOCABULARY (ADR-0090 D3): the word "role" is reserved-forbidden across the
 * platform — capability = permission_set, distribution = position,
 * hierarchy = business_unit. The sole exception is better-auth's internal
 * `sys_member.role` (org-membership tier), projected as
 * `org_membership_level`.
 *
 * **NAMING CONVENTION:**
 * Position names MUST be lowercase snake_case to prevent security issues.
 *
 * @example Good position names
 * - 'sales_manager'
 * - 'ceo'
 * - 'region_east_vp'
 * - 'engineering_lead'
 *
 * @example Bad position names (will be rejected)
 * - 'SalesManager' (camelCase)
 * - 'CEO' (uppercase)
 * - 'Region East VP' (spaces and uppercase)
 */
import { lazySchema } from '../shared/lazy-schema';

export const PositionSchema = lazySchema(() => strictObject(
  {
    surface: 'this position',
    aliases: { title: 'label' },
    guidance: {
      users:
        '`users` is not a Position field — assignment is a runtime binding ' +
        '(`sys_user_position` rows), never authored on the position (ADR-0090).',
      parent:
        '`parent` is not a Position field — positions are deliberately FLAT (ADR-0090 ' +
        'D3, finalizing ADR-0057 D5): the visibility hierarchy is the business-unit ' +
        'tree (`sys_business_unit`) and the manager chain (`sys_user.manager_id`), ' +
        'never a position tree.',
      permissions:
        '`permissions` is not a Position field — there are no direct position-level ' +
        'permission strings anywhere on the platform: capability reaches a position ' +
        'ONLY through the permission sets it names in `permissionSets`. The `sys_position` ' +
        'row column of the same name — a "JSON-serialized array of permission ' +
        'strings" textarea no producer ever wrote and no runtime path ever read — ' +
        'was retired under ADR-0049 enforce-or-remove. Delete the key; to ' +
        'grant capability, name permission sets in `permissionSets` instead.',
    },
    history:
      'Until this shape was closed, these were dropped silently — the position still parsed, so the ' +
      'author believed a distribution property was declared that the runtime never saw.',
  },
  {
  /** Identity */
  // [#8468] "unique per organization", not bare "unique". This `describe()` is
  // the source of the generated reference page's `name` row
  // (`content/docs/references/identity/position.mdx`), so the bare wording
  // published the installation-wide reading that `sys_position`'s declared
  // index accidentally materialized — as if it had been intended. The ruling of
  // 2026-08-13 scopes the name per organization; the text now says so.
  name: SnakeCaseIdentifierSchema.describe(
    'Position name, unique per organization (lowercase snake_case)',
  ),
  label: z.string().describe('Display label (e.g. VP of Sales)'),

  /** Description */
  description: z.string().optional(),

  /**
   * [ADR-0131 D3/D4] The permission sets this position distributes, each by
   * its NAME. A holder of the position holds every set named here, resolved
   * by name in the environment catalog (code-declared packages and environment
   * metadata) — the same by-name read a user's direct grant gets.
   *
   * This key replaced the `sys_position_permission_set` junction as the
   * position → set binding: the authorization resolver reads this list and no
   * junction row. A name that resolves to no permission set confers nothing.
   * A set the catalog row deactivates confers nothing either: the `active`
   * flag stays on the row until it gains a definition home.
   *
   * The built-in `everyone` anchor (ADR-0090 D5) is declared by the platform
   * with the deployment's baseline sets; a package does not name it here, it
   * marks its baseline with `isDefault` on the permission set.
   */
  permissionSets: z.array(SnakeCaseIdentifierSchema).optional().describe(
    'ADR-0131 D3/D4: the permission sets this position distributes, by name (resolved in the environment catalog).',
  ),

  /**
   * [ADR-0091 D3] Delegation of duty (职务代理). When true, a holder of this
   * position may SELF-SERVICE assign it to a delegate — time-boxed
   * (`valid_until` within the config ceiling), reasoned, dual-audited —
   * WITHOUT being a delegated administrator. Default false: approval-duty
   * positions (an approver going on leave) opt in; admin-ish positions do
   * NOT — delegating administration would bypass the D12 containment gate,
   * so a delegatable position must never distribute an `adminScope`-carrying
   * set. A grant that itself arrived via delegation is not re-delegatable
   * (chains are cut).
   *
   * That invariant IS enforced — but at RUNTIME, not at authoring time. The
   * D12 containment gate (`plugin-security`'s delegated-admin gate, step 6 of
   * the self-service delegation path) refuses the delegation the moment a
   * holder attempts it, denying with the offending permission set named. No
   * lint rule checks the combination, so a package pairing `delegatable: true`
   * with an `adminScope`-carrying set publishes clean and `os lint` stays
   * green: what you will see is a delegation deny at first use, not an
   * author-time error. (The one author-time rule ADR-0091 D3 does have,
   * `security-delegation-missing-reason`, checks something else — that a
   * seeded delegation row carries its dual-audit reason.)
   */
  delegatable: z.boolean().default(false).describe(
    'ADR-0091 D3: holders may self-service delegate this position, time-boxed (default false).',
  ),

  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package authors declare
   * lock policy here; the loader translates it into the private `_lock`
   * envelope at registration time and strips this block before persistence.
   * See `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this position.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  //
  // Declared in #4001 step 2, closing the sibling gap the #4071 ledger flagged:
  // `MetadataPlugin`'s artifact loader calls `applyProtection` on EVERY
  // registered metadata type, so a position has always carried these keys at
  // runtime — the schema just could not represent them (the same ADR-0078 §3
  // inverse-drift class the permission schema had).
  ...MetadataProtectionFields,
}));

/**
 * [ADR-0090 D5/D9] Built-in AUDIENCE ANCHOR positions. `everyone` is held
 * implicitly by every authenticated org member — sets bound to it are the
 * tenant's default grants (resolved per-request; additive, no fallback
 * cliff). `guest` is held implicitly (and exclusively) by unauthenticated
 * principals; its bindings face the strictest lint tier. Packages SUGGEST
 * bindings to these anchors at install time — never auto-bind.
 */
export const EVERYONE_POSITION = 'everyone';
export const GUEST_POSITION = 'guest';
export const AUDIENCE_ANCHOR_POSITIONS = [EVERYONE_POSITION, GUEST_POSITION] as const;

export type Position = z.input<typeof PositionSchema>;
/** Post-parse shape of {@link Position} — defaults applied, transforms run (ADR-0122). */
export type PositionParsed = z.infer<typeof PositionSchema>;

/**
 * Type-safe factory for a position (flat capability-distribution group).
 * Validates at authoring time via `.parse()` and accepts input-shape config —
 * preferred over a bare `: Position` literal.
 */
export function definePosition(config: z.input<typeof PositionSchema>): PositionParsed {
  return PositionSchema.parse(config);
}
