// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DataClassificationSchema } from './security-context.zod';

/**
 * Incident Response Protocol — ISO 27001:2022 (A.5.24–A.5.28)
 *
 * Defines schemas for information security event management including
 * incident classification, severity grading, response procedures,
 * and notification matrices.
 *
 * @see https://www.iso.org/standard/27001
 * @category Security
 */

/**
 * Incident Severity Schema
 *
 * Severity grading for security incidents following ISO 27001 guidelines.
 * Determines response urgency and escalation requirements.
 */
import { lazySchema } from '../shared/lazy-schema';
export const IncidentSeveritySchema = lazySchema(() => z.enum([
  'critical',   // Immediate threat to business operations or data integrity
  'high',       // Significant impact requiring urgent response
  'medium',     // Moderate impact with controlled response timeline
  'low',        // Minor impact with standard response procedures
]));

/**
 * Incident Category Schema
 *
 * Classification of security incidents by type (A.5.25).
 * Used for routing, reporting, and trend analysis.
 */
export const IncidentCategorySchema = lazySchema(() => z.enum([
  'data_breach',           // Unauthorized access or disclosure of data
  'malware',               // Malicious software detection
  'unauthorized_access',   // Unauthorized system or data access
  'denial_of_service',     // Service availability attack
  'social_engineering',    // Phishing, pretexting, or manipulation
  'insider_threat',        // Threat originating from internal actors
  'physical_security',     // Physical security breach
  'configuration_error',   // Security misconfiguration
  'vulnerability_exploit', // Exploitation of known vulnerability
  'policy_violation',      // Violation of security policies
  'other',                 // Other security incidents
]));

/**
 * Incident Status Schema
 *
 * Current status of a security incident in its lifecycle.
 */
export const IncidentStatusSchema = lazySchema(() => z.enum([
  'reported',        // Initial report received
  'triaged',         // Severity and category assessed
  'investigating',   // Active investigation in progress
  'containing',      // Containment measures being applied
  'eradicating',     // Root cause being removed
  'recovering',      // Systems being restored to normal
  'resolved',        // Incident resolved
  'closed',          // Post-incident review complete
]));

/**
 * Incident Response Phase Schema
 *
 * Defines structured response phases per NIST SP 800-61 / ISO 27001 (A.5.26).
 */
export const IncidentResponsePhaseSchema = lazySchema(() => z.object({
  /**
   * Phase name identifier
   */
  phase: z.enum([
    'identification',
    'containment',
    'eradication',
    'recovery',
    'lessons_learned',
  ]).describe('Response phase name'),

  /**
   * Phase description and objectives
   */
  description: z.string().describe('Phase description and objectives'),

  /**
   * Responsible team or role for this phase
   */
  assignedTo: z.string().describe('Responsible team or role'),

  /**
   * Target completion time in hours from incident start
   */
  targetHours: z.number().min(0).describe('Target completion time in hours'),

  /**
   * Actual completion timestamp (Unix milliseconds)
   */
  completedAt: z.number().optional().describe('Actual completion timestamp'),

  /**
   * Notes and findings during this phase
   */
  notes: z.string().optional().describe('Phase notes and findings'),
}).describe('Incident response phase with timing and assignment'));

export type IncidentResponsePhase = z.input<typeof IncidentResponsePhaseSchema>;

/**
 * Notification Rule Schema
 *
 * Defines who must be notified and when, based on severity (A.5.27).
 */
export const IncidentNotificationRuleSchema = lazySchema(() => z.object({
  /**
   * Minimum severity level that triggers this notification
   */
  severity: IncidentSeveritySchema.describe('Minimum severity to trigger notification'),

  /**
   * Notification channels to use
   */
  channels: z.array(z.enum([
    'email',
    'sms',
    'slack',
    'pagerduty',
    'webhook',
  ])).describe('Notification channels'),

  /**
   * Roles or teams to notify
   */
  recipients: z.array(z.string()).describe('Roles or teams to notify'),

  /**
   * Maximum time in minutes to send notification after incident detection
   */
  withinMinutes: z.number().min(1).describe('Notification deadline in minutes from detection'),

  /**
   * Whether to notify external regulators (for data breaches)
   */
  notifyRegulators: z.boolean().default(false)
    .describe('Whether to notify regulatory authorities'),

  /**
   * Regulatory notification deadline in hours (e.g., GDPR 72h)
   */
  regulatorDeadlineHours: z.number().optional()
    .describe('Regulatory notification deadline in hours'),
}).describe('Incident notification rule per severity level'));

export type IncidentNotificationRule = z.input<typeof IncidentNotificationRuleSchema>;
/** Post-parse shape of {@link IncidentNotificationRule} — defaults applied, transforms run (ADR-0122). */
export type IncidentNotificationRuleParsed = z.infer<typeof IncidentNotificationRuleSchema>;

/**
 * Notification Matrix Schema
 *
 * Complete notification matrix mapping severity levels to stakeholder groups (A.5.27).
 */
export const IncidentNotificationMatrixSchema = lazySchema(() => z.object({
  /**
   * Notification rules ordered by severity
   */
  rules: z.array(IncidentNotificationRuleSchema)
    .describe('Notification rules by severity level'),

  /**
   * Default escalation timeout in minutes before auto-escalation
   */
  escalationTimeoutMinutes: z.number().default(30)
    .describe('Auto-escalation timeout in minutes'),

  /**
   * Escalation chain: ordered list of roles to escalate to
   */
  escalationChain: z.array(z.string()).default([])
    .describe('Ordered escalation chain of roles'),
}).describe('Incident notification matrix with escalation policies'));

export type IncidentNotificationMatrix = z.input<typeof IncidentNotificationMatrixSchema>;
/** Post-parse shape of {@link IncidentNotificationMatrix} — defaults applied, transforms run (ADR-0122). */
export type IncidentNotificationMatrixParsed = z.infer<typeof IncidentNotificationMatrixSchema>;

/**
 * Incident Schema
 *
 * Comprehensive security incident record following ISO 27001:2022 (A.5.24–A.5.28).
 * Tracks the full incident lifecycle from detection through post-incident review.
 *
 * @example
 * ```json
 * {
 *   "id": "INC-2024-001",
 *   "title": "Unauthorized API Access Detected",
 *   "description": "Multiple failed authentication attempts from unknown IP range",
 *   "severity": "high",
 *   "category": "unauthorized_access",
 *   "status": "investigating",
 *   "reportedBy": "monitoring_system",
 *   "reportedAt": 1704067200000,
 *   "affectedSystems": ["api-gateway", "auth-service"],
 *   "affectedDataClassifications": ["pii", "confidential"],
 *   "responsePhases": [
 *     {
 *       "phase": "identification",
 *       "description": "Identify scope of unauthorized access",
 *       "assignedTo": "security_team",
 *       "targetHours": 2
 *     }
 *   ]
 * }
 * ```
 */
export const IncidentSchema = lazySchema(() => z.object({
  /**
   * Unique incident identifier
   */
  id: z.string().describe('Unique incident identifier'),

  /**
   * Short descriptive title of the incident
   */
  title: z.string().describe('Incident title'),

  /**
   * Detailed description of the security event
   */
  description: z.string().describe('Detailed incident description'),

  /**
   * Severity classification
   */
  severity: IncidentSeveritySchema.describe('Incident severity level'),

  /**
   * Incident category / type
   */
  category: IncidentCategorySchema.describe('Incident category'),

  /**
   * Current status in the incident lifecycle
   */
  status: IncidentStatusSchema.describe('Current incident status'),

  /**
   * User or system that reported the incident
   */
  reportedBy: z.string().describe('Reporter user ID or system name'),

  /**
   * Timestamp when the incident was reported (Unix milliseconds)
   */
  reportedAt: z.number().describe('Report timestamp'),

  /**
   * Timestamp when the incident was detected (may differ from reported)
   */
  detectedAt: z.number().optional().describe('Detection timestamp'),

  /**
   * Timestamp when the incident was resolved
   */
  resolvedAt: z.number().optional().describe('Resolution timestamp'),

  /**
   * Systems affected by the incident
   */
  affectedSystems: z.array(z.string()).describe('Affected systems'),

  /**
   * Data classifications affected (for data breach assessment)
   */
  affectedDataClassifications: z.array(DataClassificationSchema)
    .optional().describe('Affected data classifications'),

  /**
   * Structured response phases tracking
   */
  responsePhases: z.array(IncidentResponsePhaseSchema).optional()
    .describe('Incident response phases'),

  /**
   * Root cause analysis (completed post-incident)
   */
  rootCause: z.string().optional().describe('Root cause analysis'),

  /**
   * Corrective actions taken or planned
   */
  correctiveActions: z.array(z.string()).optional()
    .describe('Corrective actions taken or planned'),

  /**
   * Lessons learned from the incident (A.5.28)
   */
  lessonsLearned: z.string().optional()
    .describe('Lessons learned from the incident'),

  /**
   * Related change request IDs (if changes resulted from incident)
   */
  relatedChangeRequestIds: z.array(z.string()).optional()
    .describe('Related change request IDs'),

  /**
   * Custom metadata for extensibility
   */
  metadata: z.record(z.string(), z.unknown()).optional()
    .describe('Custom metadata key-value pairs'),
}).describe('Security incident record per ISO 27001:2022 A.5.24–A.5.28'));

/**
 * Incident Response Policy Schema
 *
 * Organization-level incident response policy configuration (A.5.24).
 */
export const IncidentResponsePolicySchema = lazySchema(() => z.object({
  /**
   * Whether incident response is enabled
   */
  enabled: z.boolean().default(true)
    .describe('Enable incident response management'),

  /**
   * Notification matrix configuration
   */
  notificationMatrix: IncidentNotificationMatrixSchema
    .describe('Notification and escalation matrix'),

  /**
   * Default response team or role
   */
  defaultResponseTeam: z.string()
    .describe('Default incident response team or role'),

  /**
   * Maximum time in hours to begin initial triage
   */
  triageDeadlineHours: z.number().default(1)
    .describe('Maximum hours to begin triage after detection'),

  /**
   * Whether to require post-incident review for all incidents
   */
  requirePostIncidentReview: z.boolean().default(true)
    .describe('Require post-incident review for all incidents'),

  /**
   * Minimum severity level that requires regulatory notification
   */
  regulatoryNotificationThreshold: IncidentSeveritySchema.default('high')
    .describe('Minimum severity requiring regulatory notification'),

  /**
   * Retention period for incident records in days
   */
  retentionDays: z.number().default(2555)
    .describe('Incident record retention period in days (default ~7 years)'),
}).describe('Organization-level incident response policy per ISO 27001:2022'));

// Type exports
export type IncidentSeverity = z.input<typeof IncidentSeveritySchema>;
export type IncidentCategory = z.input<typeof IncidentCategorySchema>;
export type IncidentStatus = z.input<typeof IncidentStatusSchema>;
export type Incident = z.input<typeof IncidentSchema>;
export type IncidentResponsePolicy = z.input<typeof IncidentResponsePolicySchema>;
/** Post-parse shape of {@link IncidentResponsePolicy} — defaults applied, transforms run (ADR-0122). */
export type IncidentResponsePolicyParsed = z.infer<typeof IncidentResponsePolicySchema>;
