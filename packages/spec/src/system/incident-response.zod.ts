// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DataClassificationSchema } from './security-context.zod';
import { retiredKey } from '../shared/retired-key';

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

// ─── RETIRED deadline keys (ADR-0049 enforce-or-remove) ─────────────────────
//
// Six hour/minute/day-shaped deadline and SLA keys were declared on the
// incident-response schemas and read by NOTHING: no scheduler, escalation
// engine, regulator notifier, SLA clock or retention sweeper exists on the
// platform for this family — the schemas are exported, mounted by no stack
// key and registered as no metadata type, and the reader census over every
// package outside `packages/spec` (and over objectui at the pinned sha)
// returned zero hits for every key. An author could write
// `triageDeadlineHours: 4` and the platform would never act on it; the
// generated reference docs advertised a deadline nothing kept. Maintainer
// ruling 2026-09-02 (recorded on #14477): retire the family under
// enforce-or-remove.
//
// Route: `retiredKey()` tombstones, NOT plain deletion — none of these
// schemas is `.strict()`, so a bare deletion would make zod strip the key in
// silence, replacing an inert declaration with an invisible one (ADR-0104).
// The tombstone is audible in both channels: `tsc` (the input type is
// `never`) and the parse (the prescription is the message). No D2 conversion
// and no `os migrate meta` sentence: the conversion chain walks a normalized
// STACK and none of these schemas is a stack collection member, so a
// conversion would be a transform with no seam that ever runs (the
// `kernel/MetadataPluginConfig:additionalTypes` precedent). The retirement is
// registered as `RETIRED_KEYS_BY_MAJOR[18]` entries plus the D3 semantic entry
// `incident-response-deadline-keys-retired`.

const TARGET_HOURS_RETIRED =
  '`IncidentResponsePhase.targetHours` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no engine tracked a response phase against a '
  + 'clock, so the target was never checked, never escalated and never reported. Delete the '
  + 'key. There is no replacement, because no incident-response engine exists to keep a phase '
  + 'deadline.';

const WITHIN_MINUTES_RETIRED =
  '`IncidentNotificationRule.withinMinutes` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no dispatcher sent an incident notification, '
  + 'so no deadline for one was ever measured. Delete the key. There is no replacement, '
  + 'because no incident-notification engine exists to keep the deadline.';

const REGULATOR_DEADLINE_HOURS_RETIRED =
  '`IncidentNotificationRule.regulatorDeadlineHours` was removed in @objectstack/spec 17 '
  + '(ADR-0049 enforce-or-remove) — nothing ever read it: no engine notified a regulator, so a '
  + 'regulatory deadline declared here (a GDPR 72-hour window, for example) was never tracked, '
  + 'and a compliance author who wrote it held a promise the platform did not keep. Delete the '
  + 'key. There is no replacement, because no regulatory-notification engine exists.';

const ESCALATION_TIMEOUT_MINUTES_RETIRED =
  '`IncidentNotificationMatrix.escalationTimeoutMinutes` was removed in @objectstack/spec 17 '
  + '(ADR-0049 enforce-or-remove) — nothing ever read it: no engine walked `escalationChain` '
  + 'on a timer, so the timeout never fired, and its default of 30 minutes was materialized '
  + 'into every parsed matrix without ever being consulted. Delete the key. There is no '
  + 'replacement, because no escalation engine exists.';

const TRIAGE_DEADLINE_HOURS_RETIRED =
  '`IncidentResponsePolicy.triageDeadlineHours` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no engine timed the interval between detection '
  + 'and triage, so the deadline was never kept, and its default of 1 hour was materialized '
  + 'into every parsed policy without ever being consulted. Delete the key. There is no '
  + 'replacement, because no incident-response engine exists to keep a triage window.';

const RETENTION_DAYS_RETIRED =
  '`IncidentResponsePolicy.retentionDays` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no sweeper deleted incident records on a '
  + 'schedule, so the retention period was never applied, and its default of 2555 days was '
  + 'materialized into every parsed policy without ever being consulted. Delete the key. '
  + 'Retention on this platform is the object-level `lifecycle` block (ADR-0057), enforced by '
  + 'the LifecycleService over the records of an object — declare it on the object that stores '
  + 'incident records, not on this policy document.';

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
   * REMOVED (ADR-0049 enforce-or-remove) — see `TARGET_HOURS_RETIRED` above.
   */
  targetHours: retiredKey(TARGET_HOURS_RETIRED),

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
   * REMOVED (ADR-0049 enforce-or-remove) — see `WITHIN_MINUTES_RETIRED` above.
   */
  withinMinutes: retiredKey(WITHIN_MINUTES_RETIRED),

  /**
   * Whether to notify external regulators (for data breaches)
   */
  notifyRegulators: z.boolean().default(false)
    .describe('Whether to notify regulatory authorities'),

  /**
   * REMOVED (ADR-0049 enforce-or-remove) — see `REGULATOR_DEADLINE_HOURS_RETIRED` above.
   */
  regulatorDeadlineHours: retiredKey(REGULATOR_DEADLINE_HOURS_RETIRED),
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
   * REMOVED (ADR-0049 enforce-or-remove) — see `ESCALATION_TIMEOUT_MINUTES_RETIRED` above.
   */
  escalationTimeoutMinutes: retiredKey(ESCALATION_TIMEOUT_MINUTES_RETIRED),

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
 *       "assignedTo": "security_team"
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
   * REMOVED (ADR-0049 enforce-or-remove) — see `TRIAGE_DEADLINE_HOURS_RETIRED` above.
   */
  triageDeadlineHours: retiredKey(TRIAGE_DEADLINE_HOURS_RETIRED),

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
   * REMOVED (ADR-0049 enforce-or-remove) — see `RETENTION_DAYS_RETIRED` above.
   */
  retentionDays: retiredKey(RETENTION_DAYS_RETIRED),
}).describe('Organization-level incident response policy per ISO 27001:2022'));

// Type exports
export type IncidentSeverity = z.input<typeof IncidentSeveritySchema>;
export type IncidentCategory = z.input<typeof IncidentCategorySchema>;
export type IncidentStatus = z.input<typeof IncidentStatusSchema>;
export type Incident = z.input<typeof IncidentSchema>;
export type IncidentResponsePolicy = z.input<typeof IncidentResponsePolicySchema>;
/** Post-parse shape of {@link IncidentResponsePolicy} — defaults applied, transforms run (ADR-0122). */
export type IncidentResponsePolicyParsed = z.infer<typeof IncidentResponsePolicySchema>;
