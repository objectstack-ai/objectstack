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
   * Last update timestamp
   */
  updatedAt: z.string().datetime().describe('Last update timestamp'),
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
   * Last update timestamp
   */
  updatedAt: z.string().datetime().describe('Last update timestamp'),
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
   * Last update timestamp
   */
  updatedAt: z.string().datetime().describe('Last update timestamp'),
}));

export type Invitation = z.input<typeof InvitationSchema>;
/** Post-parse shape of {@link Invitation} — defaults applied, transforms run (ADR-0122). */
export type InvitationParsed = z.infer<typeof InvitationSchema>;
