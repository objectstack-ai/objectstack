// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ⚠️ EXPERIMENTAL — NOT ENFORCED (ADR-0056). The GDPR/HIPAA/PCI-DSS schemas below
// are parsed but have NO runtime consumer — no data-subject-rights engine,
// retention enforcer, BAA gate, or tokenizer reads them. Authoring them does NOT
// change behaviour; recorded as roadmap intent (M2+). Do not rely on them for
// compliance until a consumer lands (per ADR-0049 enforce-or-remove).
import { ComplianceFrameworkSchema } from './security-context.zod';

/**
 * Compliance protocol for GDPR, CCPA, HIPAA, SOX, PCI-DSS
 */
import { lazySchema } from '../shared/lazy-schema';
export const GDPRConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Enable GDPR compliance controls'),
  dataSubjectRights: z.object({
    rightToAccess: z.boolean().default(true).describe('Allow data subjects to access their data'),
    rightToRectification: z.boolean().default(true).describe('Allow data subjects to correct their data'),
    rightToErasure: z.boolean().default(true).describe('Allow data subjects to request deletion'),
    rightToRestriction: z.boolean().default(true).describe('Allow data subjects to restrict processing'),
    rightToPortability: z.boolean().default(true).describe('Allow data subjects to export their data'),
    rightToObjection: z.boolean().default(true).describe('Allow data subjects to object to processing'),
  }).describe('Data subject rights configuration per GDPR Articles 15-21'),
  legalBasis: z.enum([
    'consent',
    'contract',
    'legal-obligation',
    'vital-interests',
    'public-task',
    'legitimate-interests',
  ]).describe('Legal basis for data processing under GDPR Article 6'),
  consentTracking: z.boolean().default(true).describe('Track and record user consent'),
  dataRetentionDays: z.number().optional().describe('Maximum data retention period in days'),
  dataProcessingAgreement: z.string().optional().describe('URL or reference to the data processing agreement'),
}).describe('GDPR (General Data Protection Regulation) compliance configuration'));

export type GDPRConfig = z.infer<typeof GDPRConfigSchema>;
export type GDPRConfigInput = z.input<typeof GDPRConfigSchema>;

export const HIPAAConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Enable HIPAA compliance controls'),
  phi: z.object({
    encryption: z.boolean().default(true).describe('Encrypt Protected Health Information at rest'),
    accessControl: z.boolean().default(true).describe('Enforce role-based access to PHI'),
    auditTrail: z.boolean().default(true).describe('Log all PHI access events'),
    backupAndRecovery: z.boolean().default(true).describe('Enable PHI backup and disaster recovery'),
  }).describe('Protected Health Information safeguards'),
  businessAssociateAgreement: z.boolean().default(false).describe('BAA is in place with third-party processors'),
}).describe('HIPAA (Health Insurance Portability and Accountability Act) compliance configuration'));

export type HIPAAConfig = z.infer<typeof HIPAAConfigSchema>;
export type HIPAAConfigInput = z.input<typeof HIPAAConfigSchema>;

export const PCIDSSConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Enable PCI-DSS compliance controls'),
  level: z.enum(['1', '2', '3', '4']).describe('PCI-DSS compliance level (1 = highest)'),
  cardDataFields: z.array(z.string()).describe('Field names containing cardholder data'),
  tokenization: z.boolean().default(true).describe('Replace card data with secure tokens'),
  encryptionInTransit: z.boolean().default(true).describe('Encrypt cardholder data during transmission'),
  encryptionAtRest: z.boolean().default(true).describe('Encrypt stored cardholder data'),
}).describe('PCI-DSS (Payment Card Industry Data Security Standard) compliance configuration'));

export type PCIDSSConfig = z.infer<typeof PCIDSSConfigSchema>;
export type PCIDSSConfigInput = z.input<typeof PCIDSSConfigSchema>;

export const AuditLogConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(true).describe('Enable audit logging'),
  retentionDays: z.number().default(365).describe('Number of days to retain audit logs'),
  immutable: z.boolean().default(true).describe('Prevent modification or deletion of audit logs'),
  signLogs: z.boolean().default(false).describe('Cryptographically sign log entries for tamper detection'),
  events: z.array(z.enum([
    'create',
    'read',
    'update',
    'delete',
    'export',
    'permission-change',
    'login',
    'logout',
    'failed-login',
  ])).describe('Event types to capture in the audit log'),
}).describe('Audit log configuration for compliance and security monitoring'));

export type AuditLogConfig = z.infer<typeof AuditLogConfigSchema>;
export type AuditLogConfigInput = z.input<typeof AuditLogConfigSchema>;

/**
 * Audit Finding Severity Schema
 *
 * Severity classification for audit findings.
 */
export const AuditFindingSeveritySchema = lazySchema(() => z.enum([
  'critical',      // Immediate remediation required
  'major',         // Significant non-conformity
  'minor',         // Minor non-conformity
  'observation',   // Improvement opportunity
]));

/**
 * Audit Finding Status Schema
 *
 * Lifecycle status of an audit finding.
 */
export const AuditFindingStatusSchema = lazySchema(() => z.enum([
  'open',           // Finding identified, not yet addressed
  'in_remediation', // Remediation in progress
  'remediated',     // Remediation completed, pending verification
  'verified',       // Remediation verified and accepted
  'accepted_risk',  // Risk accepted by management
  'closed',         // Finding closed
]));

/**
 * Audit Finding Schema (A.5.35)
 *
 * Individual finding from a compliance or security audit.
 * Supports tracking from discovery through remediation and verification.
 *
 * @example
 * ```json
 * {
 *   "id": "FIND-2024-001",
 *   "title": "Insufficient access logging",
 *   "description": "PHI access events are not being logged for HIPAA compliance",
 *   "severity": "major",
 *   "status": "in_remediation",
 *   "controlReference": "A.8.15",
 *   "framework": "iso27001",
 *   "identifiedAt": 1704067200000,
 *   "identifiedBy": "external_auditor",
 *   "remediationPlan": "Implement audit logging for all PHI access events",
 *   "remediationDeadline": 1706745600000
 * }
 * ```
 */
export const AuditFindingSchema = lazySchema(() => z.object({
  /**
   * Unique finding identifier
   */
  id: z.string().describe('Unique finding identifier'),

  /**
   * Short descriptive title
   */
  title: z.string().describe('Finding title'),

  /**
   * Detailed description of the finding
   */
  description: z.string().describe('Finding description'),

  /**
   * Finding severity
   */
  severity: AuditFindingSeveritySchema.describe('Finding severity'),

  /**
   * Current status
   */
  status: AuditFindingStatusSchema.describe('Finding status'),

  /**
   * ISO 27001 control reference (e.g., "A.5.35", "A.8.15")
   */
  controlReference: z.string().optional().describe('ISO 27001 control reference'),

  /**
   * Compliance framework
   */
  framework: ComplianceFrameworkSchema.optional()
    .describe('Related compliance framework'),

  /**
   * Timestamp when finding was identified (Unix milliseconds)
   */
  identifiedAt: z.number().describe('Identification timestamp'),

  /**
   * User or entity who identified the finding
   */
  identifiedBy: z.string().describe('Identifier (auditor name or system)'),

  /**
   * Planned remediation actions
   */
  remediationPlan: z.string().optional().describe('Remediation plan'),

  /**
   * Remediation deadline (Unix milliseconds)
   */
  remediationDeadline: z.number().optional().describe('Remediation deadline timestamp'),

  /**
   * Timestamp when remediation was verified (Unix milliseconds)
   */
  verifiedAt: z.number().optional().describe('Verification timestamp'),

  /**
   * Verifier name or role
   */
  verifiedBy: z.string().optional().describe('Verifier name or role'),

  /**
   * Notes or comments
   */
  notes: z.string().optional().describe('Additional notes'),
}).describe('Audit finding with remediation tracking per ISO 27001:2022 A.5.35'));

export type AuditFinding = z.infer<typeof AuditFindingSchema>;

/**
 * Audit Schedule Schema (A.5.35)
 *
 * Defines audit scheduling for independent information security reviews.
 * Supports recurring audits, scope definition, and assessor assignment.
 *
 * @example
 * ```json
 * {
 *   "id": "AUDIT-2024-Q1",
 *   "title": "Q1 ISO 27001 Internal Audit",
 *   "scope": ["access_control", "encryption", "incident_response"],
 *   "framework": "iso27001",
 *   "scheduledAt": 1711929600000,
 *   "assessor": "internal_audit_team",
 *   "recurrenceMonths": 3
 * }
 * ```
 */
export const AuditScheduleSchema = lazySchema(() => z.object({
  /**
   * Unique audit schedule identifier
   */
  id: z.string().describe('Unique audit schedule identifier'),

  /**
   * Audit title or name
   */
  title: z.string().describe('Audit title'),

  /**
   * Scope of areas to audit
   */
  scope: z.array(z.string()).describe('Audit scope areas'),

  /**
   * Target compliance framework
   */
  framework: ComplianceFrameworkSchema
    .describe('Target compliance framework'),

  /**
   * Scheduled audit date (Unix milliseconds)
   */
  scheduledAt: z.number().describe('Scheduled audit timestamp'),

  /**
   * Actual completion date (Unix milliseconds)
   */
  completedAt: z.number().optional().describe('Completion timestamp'),

  /**
   * Assessor name, team, or external firm
   */
  assessor: z.string().describe('Assessor or audit team'),

  /**
   * Whether this is an external (independent) audit
   */
  isExternal: z.boolean().default(false).describe('Whether this is an external audit'),

  /**
   * Recurrence interval in months (0 = one-time)
   */
  recurrenceMonths: z.number().default(0).describe('Recurrence interval in months (0 = one-time)'),

  /**
   * Findings from this audit
   */
  findings: z.array(AuditFindingSchema).optional().describe('Audit findings'),
}).describe('Audit schedule for independent security reviews per ISO 27001:2022 A.5.35'));

export type AuditSchedule = z.infer<typeof AuditScheduleSchema>;

export const ComplianceConfigSchema = lazySchema(() => z.object({
  gdpr: GDPRConfigSchema.optional().describe('GDPR compliance settings'),
  hipaa: HIPAAConfigSchema.optional().describe('HIPAA compliance settings'),
  pciDss: PCIDSSConfigSchema.optional().describe('PCI-DSS compliance settings'),
  auditLog: AuditLogConfigSchema.describe('Audit log configuration'),
  auditSchedules: z.array(AuditScheduleSchema).optional()
    .describe('Scheduled compliance audits (A.5.35)'),
}).describe('Unified compliance configuration spanning GDPR, HIPAA, PCI-DSS, and audit governance'));

export type ComplianceConfig = z.infer<typeof ComplianceConfigSchema>;
export type ComplianceConfigInput = z.input<typeof ComplianceConfigSchema>;
