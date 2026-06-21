// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ⚠️ EXPERIMENTAL — NOT ENFORCED (ADR-0049, #1882). The entire PolicySchema tree
// (password / network / session / audit) is parsed but has no runtime consumer;
// `better-auth` runs hardcoded defaults regardless. Every property below carries
// the `[EXPERIMENTAL — not enforced]` marker so the no-op is explicit in the
// generated reference docs and to the spec-liveness gate — authoring any of these
// does NOT change behaviour. Do not rely on them for compliance.

/**
 * Password Complexity Policy
 */
import { lazySchema } from '../shared/lazy-schema';
export const PasswordPolicySchema = lazySchema(() => z.object({
  minLength: z.number().default(8).describe('[EXPERIMENTAL — not enforced] Minimum password length'),
  requireUppercase: z.boolean().default(true).describe('[EXPERIMENTAL — not enforced] Require an uppercase letter'),
  requireLowercase: z.boolean().default(true).describe('[EXPERIMENTAL — not enforced] Require a lowercase letter'),
  requireNumbers: z.boolean().default(true).describe('[EXPERIMENTAL — not enforced] Require a number'),
  requireSymbols: z.boolean().default(false).describe('[EXPERIMENTAL — not enforced] Require a symbol'),
  expirationDays: z.number().optional().describe('[EXPERIMENTAL — not enforced] Force password change every X days'),
  historyCount: z.number().default(3).describe('[EXPERIMENTAL — not enforced] Prevent reusing last X passwords'),
}));

/**
 * Network Access Policy (IP Whitelisting)
 */
export const NetworkPolicySchema = lazySchema(() => z.object({
  trustedRanges: z.array(z.string()).describe('[EXPERIMENTAL — not enforced] CIDR ranges allowed to access (e.g. 10.0.0.0/8)'),
  blockUnknown: z.boolean().default(false).describe('[EXPERIMENTAL — not enforced] Block all IPs not in trusted ranges'),
  vpnRequired: z.boolean().default(false).describe('[EXPERIMENTAL — not enforced] Require VPN to access'),
}));

/**
 * Session Policy
 */
export const SessionPolicySchema = lazySchema(() => z.object({
  idleTimeout: z.number().default(30).describe('[EXPERIMENTAL — not enforced] Minutes before idle session logout'),
  absoluteTimeout: z.number().default(480).describe('[EXPERIMENTAL — not enforced] Max session duration (minutes)'),
  forceMfa: z.boolean().default(false).describe('[EXPERIMENTAL — not enforced] Require 2FA for all users'),
}));

/**
 * Audit Retention Policy
 */
export const AuditPolicySchema = lazySchema(() => z.object({
  logRetentionDays: z.number().default(180).describe('[EXPERIMENTAL — not enforced] Days to retain audit logs'),
  sensitiveFields: z.array(z.string()).describe('[EXPERIMENTAL — not enforced] Fields to redact in logs (e.g. password, ssn)'),
  captureRead: z.boolean().default(false).describe('[EXPERIMENTAL — not enforced] Log read access (High volume!)'),
}));

/**
 * Security Policy Schema
 * "The Cloud Compliance Contract"
 *
 * ⚠️ EXPERIMENTAL — NOT ENFORCED (ADR-0049, #1882).
 * This schema is currently a no-op: it is not registered as a metadata type and
 * has no runtime consumer. Password complexity, session idle/absolute timeout,
 * `forceMfa`, the IP allow-list (`trustedRanges`/`vpnRequired`) and audit
 * retention/redaction are all parsed but enforced by nothing — `better-auth`
 * runs hardcoded defaults regardless. Authoring a policy here does NOT change
 * behaviour. Treat as a forward-looking contract only; do not rely on it for
 * compliance. Enforcement (or removal) is tracked by #1882 for M2.
 */
export const PolicySchema = lazySchema(() => z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('[EXPERIMENTAL — not enforced] Policy Name'),

  password: PasswordPolicySchema.optional(),
  network: NetworkPolicySchema.optional(),
  session: SessionPolicySchema.optional(),
  audit: AuditPolicySchema.optional(),

  /** Assignment */
  isDefault: z.boolean().default(false).describe('[EXPERIMENTAL — not enforced] Apply to all users by default'),
  assignedProfiles: z.array(z.string()).optional().describe('[EXPERIMENTAL — not enforced] Apply to specific profiles'),
}));

export type Policy = z.infer<typeof PolicySchema>;
/** Authoring input for {@link Policy} — defaulted fields are optional. */
export type PolicyInput = z.input<typeof PolicySchema>;

/**
 * Type-safe factory for a security / compliance policy. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Policy` literal.
 */
export function definePolicy(config: z.input<typeof PolicySchema>): Policy {
  return PolicySchema.parse(config);
}
