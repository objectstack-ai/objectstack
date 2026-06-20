// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ⚠️ EXPERIMENTAL — NOT ENFORCED (ADR-0056). The unified security-context governance
// (audit/encryption/masking/compliance correlation) is declared but has no runtime
// consumer. Authoring it does NOT change behaviour (roadmap M2+; per ADR-0049).

/**
 * Unified Security Context Protocol
 *
 * Provides a central governance layer that correlates and unifies
 * the four independent security subsystems:
 * - **Audit** (audit.zod.ts): Event logging and suspicious activity detection
 * - **Encryption** (encryption.zod.ts): Field-level encryption and key management
 * - **Compliance** (compliance.zod.ts): Regulatory framework enforcement (GDPR/HIPAA/SOX/PCI-DSS)
 * - **Masking** (masking.zod.ts): PII data masking and tokenization
 *
 * This schema enforces cross-cutting security policies, ensuring compliance
 * frameworks drive encryption requirements, masking rules respect role-based
 * audit visibility, and all security operations are correlated in a single
 * governance context.
 *
 * @see https://www.iso.org/standard/27001
 * @category Security
 */

/**
 * Shared data classification enum used across security subsystems.
 * Defines the canonical set of data sensitivity labels.
 */
import { lazySchema } from '../shared/lazy-schema';
export const DataClassificationSchema = lazySchema(() => z.enum([
  'pii', 'phi', 'pci', 'financial', 'confidential', 'internal', 'public',
]).describe('Data classification level'));

export type DataClassification = z.infer<typeof DataClassificationSchema>;

/**
 * Shared compliance framework enum used across compliance and security schemas.
 * Defines the canonical set of regulatory frameworks.
 */
export const ComplianceFrameworkSchema = lazySchema(() => z.enum([
  'gdpr', 'hipaa', 'sox', 'pci_dss', 'ccpa', 'iso27001',
]).describe('Compliance framework identifier'));

export type ComplianceFramework = z.infer<typeof ComplianceFrameworkSchema>;

/**
 * Compliance-driven audit requirement.
 * Maps specific compliance frameworks to the audit event types that MUST be captured.
 */
export const ComplianceAuditRequirementSchema = lazySchema(() => z.object({
  framework: ComplianceFrameworkSchema
    .describe('Compliance framework identifier'),
  requiredEvents: z.array(z.string())
    .describe('Audit event types required by this framework (e.g., "data.delete", "auth.login")'),
  retentionDays: z.number().min(1)
    .describe('Minimum audit log retention period required by this framework (in days)'),
  alertOnMissing: z.boolean().default(true)
    .describe('Raise alert if a required audit event is not being captured'),
}).describe('Compliance framework audit event requirements'));

export type ComplianceAuditRequirement = z.infer<typeof ComplianceAuditRequirementSchema>;

/**
 * Compliance-driven encryption requirement.
 * Maps compliance frameworks to encryption mandates for specific data classifications.
 */
export const ComplianceEncryptionRequirementSchema = lazySchema(() => z.object({
  framework: ComplianceFrameworkSchema
    .describe('Compliance framework identifier'),
  dataClassifications: z.array(DataClassificationSchema)
    .describe('Data classifications that must be encrypted under this framework'),
  minimumAlgorithm: z.enum(['aes-256-gcm', 'aes-256-cbc', 'chacha20-poly1305']).default('aes-256-gcm')
    .describe('Minimum encryption algorithm strength required'),
  keyRotationMaxDays: z.number().min(1).default(90)
    .describe('Maximum key rotation interval required (in days)'),
}).describe('Compliance framework encryption requirements'));

export type ComplianceEncryptionRequirement = z.infer<typeof ComplianceEncryptionRequirementSchema>;

/**
 * Masking visibility rule.
 * Controls which roles can view unmasked data with audit trail enforcement.
 */
export const MaskingVisibilityRuleSchema = lazySchema(() => z.object({
  dataClassification: DataClassificationSchema
    .describe('Data classification this rule applies to'),
  defaultMasked: z.boolean().default(true)
    .describe('Whether data is masked by default'),
  unmaskRoles: z.array(z.string()).optional()
    .describe('Roles allowed to view unmasked data'),
  auditUnmask: z.boolean().default(true)
    .describe('Log an audit event when data is unmasked'),
  requireApproval: z.boolean().default(false)
    .describe('Require explicit approval before unmasking'),
  approvalRoles: z.array(z.string()).optional()
    .describe('Roles that can approve unmasking requests'),
}).describe('Masking visibility and audit rule per data classification'));

export type MaskingVisibilityRule = z.infer<typeof MaskingVisibilityRuleSchema>;

/**
 * Security Event Correlation Schema.
 * Defines how security events from different subsystems are correlated.
 */
export const SecurityEventCorrelationSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(true)
    .describe('Enable cross-subsystem security event correlation'),
  correlationId: z.boolean().default(true)
    .describe('Inject a shared correlation ID into audit, encryption, and masking events'),
  linkAuthToAudit: z.boolean().default(true)
    .describe('Link authentication events to subsequent data operation audit trails'),
  linkEncryptionToAudit: z.boolean().default(true)
    .describe('Log encryption/decryption operations in the audit trail'),
  linkMaskingToAudit: z.boolean().default(true)
    .describe('Log masking/unmasking operations in the audit trail'),
}).describe('Cross-subsystem security event correlation configuration'));

export type SecurityEventCorrelation = z.infer<typeof SecurityEventCorrelationSchema>;

/**
 * Data Classification Policy Schema.
 * Assigns classification labels to fields/objects for unified security enforcement.
 */
export const DataClassificationPolicySchema = lazySchema(() => z.object({
  classification: DataClassificationSchema
    .describe('Data classification level'),
  requireEncryption: z.boolean().default(false)
    .describe('Encryption required for this classification'),
  requireMasking: z.boolean().default(false)
    .describe('Masking required for this classification'),
  requireAudit: z.boolean().default(false)
    .describe('Audit trail required for access to this classification'),
  retentionDays: z.number().optional()
    .describe('Data retention limit in days (for compliance)'),
}).describe('Security policy for a specific data classification level'));

export type DataClassificationPolicy = z.infer<typeof DataClassificationPolicySchema>;

/**
 * Security Context Configuration Schema
 *
 * Top-level unified security governance context that ties together
 * audit, encryption, compliance, and masking subsystems.
 */
export const SecurityContextConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(true)
    .describe('Enable unified security context governance'),

  complianceAuditRequirements: z.array(ComplianceAuditRequirementSchema).optional()
    .describe('Compliance-driven audit event requirements'),

  complianceEncryptionRequirements: z.array(ComplianceEncryptionRequirementSchema).optional()
    .describe('Compliance-driven encryption requirements by data classification'),

  maskingVisibility: z.array(MaskingVisibilityRuleSchema).optional()
    .describe('Masking visibility rules per data classification'),

  dataClassifications: z.array(DataClassificationPolicySchema).optional()
    .describe('Data classification policies for unified security enforcement'),

  eventCorrelation: SecurityEventCorrelationSchema.optional()
    .describe('Cross-subsystem security event correlation settings'),

  enforceOnWrite: z.boolean().default(true)
    .describe('Enforce encryption and masking requirements on data write operations'),

  enforceOnRead: z.boolean().default(true)
    .describe('Enforce masking and audit requirements on data read operations'),

  failOpen: z.boolean().default(false)
    .describe('When false (default), deny access if security context cannot be evaluated'),
}).describe('Unified security context governance configuration'));

export type SecurityContextConfig = z.infer<typeof SecurityContextConfigSchema>;
export type SecurityContextConfigInput = z.input<typeof SecurityContextConfigSchema>;
