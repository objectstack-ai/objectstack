// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Password Complexity Policy
 */
import { lazySchema } from '../shared/lazy-schema';
export const PasswordPolicySchema = lazySchema(() => z.object({
  minLength: z.number().default(8),
  requireUppercase: z.boolean().default(true),
  requireLowercase: z.boolean().default(true),
  requireNumbers: z.boolean().default(true),
  requireSymbols: z.boolean().default(false),
  expirationDays: z.number().optional().describe('Force password change every X days'),
  historyCount: z.number().default(3).describe('Prevent reusing last X passwords'),
}));

/**
 * Network Access Policy (IP Whitelisting)
 */
export const NetworkPolicySchema = lazySchema(() => z.object({
  trustedRanges: z.array(z.string()).describe('CIDR ranges allowed to access (e.g. 10.0.0.0/8)'),
  blockUnknown: z.boolean().default(false).describe('Block all IPs not in trusted ranges'),
  vpnRequired: z.boolean().default(false),
}));

/**
 * Session Policy
 */
export const SessionPolicySchema = lazySchema(() => z.object({
  idleTimeout: z.number().default(30).describe('Minutes before idle session logout'),
  absoluteTimeout: z.number().default(480).describe('Max session duration (minutes)'),
  forceMfa: z.boolean().default(false).describe('Require 2FA for all users'),
}));

/**
 * Audit Retention Policy
 */
export const AuditPolicySchema = lazySchema(() => z.object({
  logRetentionDays: z.number().default(180),
  sensitiveFields: z.array(z.string()).describe('Fields to redact in logs (e.g. password, ssn)'),
  captureRead: z.boolean().default(false).describe('Log read access (High volume!)'),
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
  isDefault: z.boolean().default(false).describe('Apply to all users by default'),
  assignedProfiles: z.array(z.string()).optional().describe('Apply to specific profiles'),
}));

export type Policy = z.infer<typeof PolicySchema>;
