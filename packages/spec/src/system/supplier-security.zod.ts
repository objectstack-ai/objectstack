// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DataClassificationSchema } from './security-context.zod';

/**
 * Supplier Security Protocol — ISO 27001:2022 (A.5.19–A.5.22)
 *
 * Defines schemas for supplier information security management including
 * risk assessment, security requirements, monitoring, and change control.
 *
 * @see https://www.iso.org/standard/27001
 * @category Security
 */

/**
 * Supplier Risk Level Schema
 *
 * Risk classification for supplier relationships based on data access
 * and service criticality.
 */
import { lazySchema } from '../shared/lazy-schema';
export const SupplierRiskLevelSchema = lazySchema(() => z.enum([
  'critical',  // Direct access to sensitive data or core infrastructure
  'high',      // Significant data processing or service dependency
  'medium',    // Limited data access with moderate dependency
  'low',       // Minimal data access and low service dependency
]));

/**
 * Supplier Assessment Status Schema
 *
 * Current status of a supplier security assessment.
 */
export const SupplierAssessmentStatusSchema = lazySchema(() => z.enum([
  'pending',      // Assessment not yet started
  'in_progress',  // Assessment currently underway
  'completed',    // Assessment completed
  'expired',      // Assessment past its validity period
  'failed',       // Supplier did not meet security requirements
]));

/**
 * Supplier Security Requirement Schema
 *
 * Individual security requirement to assess against a supplier (A.5.20).
 */
export const SupplierSecurityRequirementSchema = lazySchema(() => z.object({
  /**
   * Requirement identifier
   */
  id: z.string().describe('Requirement identifier'),

  /**
   * Requirement description
   */
  description: z.string().describe('Requirement description'),

  /**
   * ISO 27001 control reference (e.g., "A.5.19")
   */
  controlReference: z.string().optional()
    .describe('ISO 27001 control reference'),

  /**
   * Whether this requirement is mandatory
   */
  mandatory: z.boolean().default(true)
    .describe('Whether this requirement is mandatory'),

  /**
   * Compliance status
   */
  compliant: z.boolean().optional()
    .describe('Whether the supplier meets this requirement'),

  /**
   * Evidence or notes for compliance assessment
   */
  evidence: z.string().optional()
    .describe('Compliance evidence or assessment notes'),
}).describe('Individual supplier security requirement'));

export type SupplierSecurityRequirement = z.input<typeof SupplierSecurityRequirementSchema>;
/** Post-parse shape of {@link SupplierSecurityRequirement} — defaults applied, transforms run (ADR-0122). */
export type SupplierSecurityRequirementParsed = z.infer<typeof SupplierSecurityRequirementSchema>;

/**
 * Supplier Security Assessment Schema
 *
 * Comprehensive supplier security assessment record (A.5.19–A.5.21).
 *
 * @example
 * ```json
 * {
 *   "supplierId": "SUP-001",
 *   "supplierName": "Cloud Provider Inc.",
 *   "riskLevel": "critical",
 *   "status": "completed",
 *   "assessedBy": "security_team",
 *   "assessedAt": 1704067200000,
 *   "validUntil": 1735689600000,
 *   "requirements": [
 *     {
 *       "id": "REQ-001",
 *       "description": "Data encryption at rest using AES-256",
 *       "controlReference": "A.8.24",
 *       "mandatory": true,
 *       "compliant": true
 *     }
 *   ],
 *   "overallCompliant": true,
 *   "dataClassificationsShared": ["pii", "confidential"]
 * }
 * ```
 */
export const SupplierSecurityAssessmentSchema = lazySchema(() => z.object({
  /**
   * Unique supplier identifier
   */
  supplierId: z.string().describe('Unique supplier identifier'),

  /**
   * Supplier name
   */
  supplierName: z.string().describe('Supplier display name'),

  /**
   * Risk classification
   */
  riskLevel: SupplierRiskLevelSchema.describe('Supplier risk classification'),

  /**
   * Assessment status
   */
  status: SupplierAssessmentStatusSchema.describe('Assessment status'),

  /**
   * User or team who performed the assessment
   */
  assessedBy: z.string().describe('Assessor user ID or team'),

  /**
   * Assessment completion timestamp (Unix milliseconds)
   */
  assessedAt: z.number().describe('Assessment timestamp'),

  /**
   * Assessment validity expiry (Unix milliseconds)
   */
  validUntil: z.number().describe('Assessment validity expiry timestamp'),

  /**
   * Security requirements assessed
   */
  requirements: z.array(SupplierSecurityRequirementSchema)
    .describe('Security requirements and their compliance status'),

  /**
   * Overall compliance result
   */
  overallCompliant: z.boolean().describe('Whether supplier meets all mandatory requirements'),

  /**
   * Data classifications shared with this supplier
   */
  dataClassificationsShared: z.array(DataClassificationSchema)
    .optional().describe('Data classifications shared with supplier'),

  /**
   * Services provided by the supplier
   */
  servicesProvided: z.array(z.string()).optional()
    .describe('Services provided by this supplier'),

  /**
   * Certifications held by the supplier
   */
  certifications: z.array(z.string()).optional()
    .describe('Supplier certifications (e.g., ISO 27001, SOC 2)'),

  /**
   * Remediation items for non-compliant requirements
   */
  remediationItems: z.array(z.object({
    requirementId: z.string().describe('Non-compliant requirement ID'),
    action: z.string().describe('Required remediation action'),
    deadline: z.number().describe('Remediation deadline timestamp'),
    status: z.enum(['pending', 'in_progress', 'completed']).default('pending')
      .describe('Remediation status'),
  })).optional().describe('Remediation items for non-compliant requirements'),

  /**
   * Custom metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional()
    .describe('Custom metadata key-value pairs'),
}).describe('Supplier security assessment record per ISO 27001:2022 A.5.19–A.5.21'));

/**
 * Supplier Security Policy Schema
 *
 * Organization-level supplier security management policy (A.5.22).
 */
export const SupplierSecurityPolicySchema = lazySchema(() => z.object({
  /**
   * Whether supplier security management is enabled
   */
  enabled: z.boolean().default(true)
    .describe('Enable supplier security management'),

  /**
   * Reassessment interval in days
   */
  reassessmentIntervalDays: z.number().default(365)
    .describe('Supplier reassessment interval in days'),

  /**
   * Whether to require supplier security assessment before onboarding
   */
  requirePreOnboardingAssessment: z.boolean().default(true)
    .describe('Require security assessment before supplier onboarding'),

  /**
   * Minimum risk level that requires formal assessment
   */
  formalAssessmentThreshold: SupplierRiskLevelSchema.default('medium')
    .describe('Minimum risk level requiring formal assessment'),

  /**
   * Whether to monitor supplier security changes (A.5.22)
   */
  monitorChanges: z.boolean().default(true)
    .describe('Monitor supplier security posture changes'),

  /**
   * Required certifications for critical suppliers
   */
  requiredCertifications: z.array(z.string()).default([])
    .describe('Required certifications for critical-risk suppliers'),
}).describe('Organization-level supplier security management policy per ISO 27001:2022'));

// Type exports
export type SupplierRiskLevel = z.input<typeof SupplierRiskLevelSchema>;
export type SupplierAssessmentStatus = z.input<typeof SupplierAssessmentStatusSchema>;
export type SupplierSecurityAssessment = z.input<typeof SupplierSecurityAssessmentSchema>;
/** Post-parse shape of {@link SupplierSecurityAssessment} — defaults applied, transforms run (ADR-0122). */
export type SupplierSecurityAssessmentParsed = z.infer<typeof SupplierSecurityAssessmentSchema>;
export type SupplierSecurityPolicy = z.input<typeof SupplierSecurityPolicySchema>;
/** Post-parse shape of {@link SupplierSecurityPolicy} — defaults applied, transforms run (ADR-0122). */
export type SupplierSecurityPolicyParsed = z.infer<typeof SupplierSecurityPolicySchema>;
