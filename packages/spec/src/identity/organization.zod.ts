// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Organization Schema (Multi-Tenant Architecture)
 * 
 * Defines the standard organization/workspace model for ObjectStack.
 * Supports B2B SaaS scenarios where users belong to multiple teams/workspaces.
 * 
 * This aligns with better-auth's organization plugin capabilities.
 */

/**
 * Organization Schema
 * Represents a team, workspace, or tenant in a multi-tenant application
 */
import { lazySchema } from '../shared/lazy-schema';
export const OrganizationSchema = lazySchema(() => z.object({
  /**
   * Unique organization identifier
   */
  id: z.string().describe('Unique organization identifier'),
  
  /**
   * Organization name (display name)
   */
  name: z.string().describe('Organization display name'),
  
  /**
   * Organization slug (URL-friendly identifier)
   * Must be unique across all organizations
   */
  slug: z.string()
    .regex(/^[a-z0-9_-]+$/)
    .describe('Unique URL-friendly slug (lowercase alphanumeric, hyphens, underscores)'),
  
  /**
   * Organization logo URL.
   *
   * `null` is accepted alongside a URL string and alongside the key being
   * absent. `logo` is one of better-auth's own `sys_organization` columns,
   * declared `Field.url({ required: false })` and reaching SQLite as
   * `logo varchar(255)` with `notnull=0`; better-auth serialises it
   * present-and-null for an organization created without one. Measured on a
   * real `AuthManager` over ObjectQL + driver-sqlite-wasm (#18509): the
   * `/auth/organization/create`, `/auth/organization/list` and
   * `/auth/organization/get-full-organization` bodies all carry `"logo": null`.
   *
   * Same defect and same remedy as `SessionUserSchema.image` (#17235 / PR
   * #18501, ruling batch #138 item 1), reached here by measurement rather than
   * by analogy — #18509 exists precisely because that review refused to infer
   * this key's verdict from that one.
   *
   * `.nullish()`, NOT `.nullable()`: the key's ABSENCE is a legal shape today,
   * so `.nullable()` would retire a live shape as the price of admitting
   * `null`. Pure widening only.
   *
   * `.url()` is KEPT, and it is not in tension with `null`. `.nullish()` wraps
   * the whole `z.string().url()`, so `null` and `undefined` are separate
   * branches the URL check never sees, while a present string is still required
   * to be a well-formed URL. Measured: of the six inputs
   * (absent / `null` / `''` / a URL / a non-URL / a number) exactly ONE moves,
   * and it is the ruled one.
   *
   * ⚠️ This widening does NOT make a served organization body parse clean.
   * The same measurement found two further divergences on this schema —
   * `metadata` is served present-and-null, and `/auth/organization/create`
   * omits `updatedAt`, which is declared required. Those are separate defects
   * with their own reasoning and are filed separately rather than folded in
   * here; #18509 asked about `logo`.
   */
  logo: z.string().url().nullish().describe('Organization logo URL'),
  
  /**
   * Custom metadata for the organization
   * Can store additional configuration, settings, or custom fields
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom metadata'),
  
  /**
   * Organization creation timestamp
   */
  createdAt: z.string().datetime().describe('Organization creation timestamp'),

  /**
   * Last update timestamp — OPTIONAL, because the documented wire carries none.
   *
   * [#18728] Maintainer ruling C (batch #158 item 4) fixes the producer rather
   * than the consumer, and makes this one key conditional on a measurement:
   * 「**Fallback A**, decided by measurement first: if the identity wire is
   * produced by better-auth's own serializer and its documented shape carries
   * no `updatedAt`, then for those routes the spec aligns to the documented
   * wire (`updatedAt` optional there)」. Both halves measured against the
   * installed better-auth 1.7.3, so fallback A applies:
   *
   *  - **The serializer is the vendor's.** The `organization/*` routes are
   *    better-auth's own endpoints, mounted through plugin-auth's single
   *    catch-all (`AUTH_ROUTE_LEDGER` books every one of them
   *    `source: 'better-auth'`); each read route answers `ctx.json(<what the
   *    adapter returned>)` with no ObjectStack post-processing.
   *  - **The documented shape has no `updatedAt`.** better-auth's organization
   *    plugin declares `organization` as `name` / `slug` / `logo` /
   *    `createdAt` / `metadata` and nothing else, and its adapter factory's
   *    `transformOutput` iterates the declared fields ONLY — an undeclared
   *    column is dropped before any route sees it. Control, same file and same
   *    grep: the vendor's `team` and `organizationRole` models DO declare
   *    `updatedAt`, so the absence here is a reading rather than a miss.
   *
   * `sys_organization.updated_at` does exist as a column — the vendor's
   * serializer simply never emits it. Declaring absence is therefore the
   * honest shape (Prime Directive #10: never advertise what the runtime does
   * not deliver), and `.optional()` NOT `.nullish()`: the key is absent on the
   * wire, never `null`.
   */
  updatedAt: z.string().datetime().optional().describe('Last update timestamp (absent on the better-auth organization wire)'),
}));

export type Organization = z.input<typeof OrganizationSchema>;

/**
 * Organization Member Schema
 * Links users to organizations with specific roles
 */
export const MemberSchema = lazySchema(() => z.object({
  /**
   * Unique member identifier
   */
  id: z.string().describe('Unique member identifier'),
  
  /**
   * Organization ID this membership belongs to
   */
  organizationId: z.string().describe('Organization ID'),
  
  /**
   * User ID of the member
   */
  userId: z.string().describe('User ID'),
  
  /**
   * Member's role within the organization.
   *
   * The vocabulary is CLOSED (ADR-0108): `owner`, `admin`, `delegated_admin`,
   * `member` — `BUILTIN_MEMBERSHIP_ROLES` / `BUILTIN_MEMBERSHIP_ROLE_OPTIONS`
   * in `./membership-role.js`, which is what `sys_member.role` and
   * `sys_invitation.role` register as their select options. Nothing widens the
   * list at boot, and a name outside it is refused at the door
   * (`ROLE_NOT_FOUND`) rather than stored — a stack that needs another
   * business role declares a `position`, not a role. Typed `z.string()` here
   * because the wire shape mirrors better-auth's own column, not because the
   * set is open.
   */
  role: z.string().describe('Member role (owner, admin, delegated_admin, member — ADR-0108 closed vocabulary)'),
  
  /**
   * Member creation timestamp
   */
  createdAt: z.string().datetime().describe('Member creation timestamp'),

  /**
   * Last update timestamp — OPTIONAL, and here there is no column at all.
   *
   * [#18728] Fallback A of maintainer ruling C, on two independent measurements
   * (see {@link OrganizationSchema}'s `updatedAt` for the ruling's text and for
   * the vendor-serializer half, which holds identically for this model):
   *
   *  1. better-auth's `member` model declares `organizationId` / `userId` /
   *     `role` / `createdAt` — no `updatedAt` — and its `transformOutput`
   *     emits declared fields only.
   *  2. ⭐ `sys_member` provisions no `updated_at` COLUMN either. It declares
   *     `id` / `created_at` / `organization_id` / `user_id` / `role`, and it is
   *     `managedBy: 'better-auth'`, which is the one disposition under which
   *     `resolveInjectedSystemColumns` injects nothing — the audit family
   *     included. So unlike the organization row there is no stored value to
   *     put on the wire in the first place.
   *
   * `.optional()` NOT `.nullish()`: absent, never `null`.
   */
  updatedAt: z.string().datetime().optional().describe('Last update timestamp (no such column on sys_member; absent on the wire)'),
}));

export type Member = z.input<typeof MemberSchema>;

/**
 * Invitation Status Enum
 *
 * [#7726] `canceled` is the ISSUER-side terminal state, and it is a shipped
 * value rather than a speculative one: better-auth's organization plugin
 * writes it on `POST /organization/cancel-invitation` (reachable from the
 * `cancel_invitation` action on `sys_invitation`, and from the client SDK's
 * `organizations.invitations.cancel`), and again when
 * `cancelPendingInvitationsOnReInvite` supersedes a pending row. It is
 * distinct from `rejected`, which the INVITEE writes.
 *
 * The vocabulary is therefore the union of two upstreams and must stay so:
 * better-auth contributes `canceled` but has no `expired`, while expiry is
 * ObjectStack's own (`expiresAt`). `sys_invitation.status` binds its select
 * options to this enum — see `sys-invitation.status-vocabulary.test.ts`,
 * which fails loudly if either side grows alone.
 */
export const InvitationStatus = z.enum(['pending', 'accepted', 'rejected', 'expired', 'canceled']);

export type InvitationStatus = z.input<typeof InvitationStatus>;

/**
 * Organization Invitation Schema
 * Represents an invitation to join an organization
 */
export const InvitationSchema = lazySchema(() => z.object({
  /**
   * Unique invitation identifier
   */
  id: z.string().describe('Unique invitation identifier'),
  
  /**
   * Organization ID the invitation is for
   */
  organizationId: z.string().describe('Organization ID'),
  
  /**
   * Email address of the invitee
   */
  email: z.string().email().describe('Invitee email address'),
  
  /**
   * Role the invitee will receive upon accepting.
   *
   * Same closed vocabulary as {@link MemberSchema}'s `role` (ADR-0108):
   * `owner`, `admin`, `delegated_admin`, `member`. A name outside it is
   * refused at the door (`ROLE_NOT_FOUND`) before any invitation row exists.
   */
  role: z.string().describe('Role to assign upon acceptance (owner, admin, delegated_admin, member — ADR-0108 closed vocabulary)'),
  
  /**
   * Invitation status
   */
  status: InvitationStatus.default('pending').describe('Invitation status'),
  
  /**
   * Invitation expiration timestamp
   */
  expiresAt: z.string().datetime().describe('Invitation expiry timestamp'),
  
  /**
   * User ID of the person who sent the invitation
   */
  inviterId: z.string().describe('User ID of the inviter'),
  
  /**
   * Invitation creation timestamp
   */
  createdAt: z.string().datetime().describe('Invitation creation timestamp'),

  /**
   * Last update timestamp — OPTIONAL, and here there is no column at all.
   *
   * [#18728] Fallback A of maintainer ruling C, same two measurements as
   * {@link MemberSchema}'s `updatedAt`: better-auth's `invitation` model
   * declares `organizationId` / `email` / `role` / `teamId` / `status` /
   * `expiresAt` / `createdAt` / `inviterId` and no `updatedAt`, and
   * `sys_invitation` — `managedBy: 'better-auth'`, so nothing is injected —
   * provisions no `updated_at` column.
   *
   * `.optional()` NOT `.nullish()`: absent, never `null`.
   */
  updatedAt: z.string().datetime().optional().describe('Last update timestamp (no such column on sys_invitation; absent on the wire)'),
}));

export type Invitation = z.input<typeof InvitationSchema>;
/** Post-parse shape of {@link Invitation} — defaults applied, transforms run (ADR-0122). */
export type InvitationParsed = z.infer<typeof InvitationSchema>;
