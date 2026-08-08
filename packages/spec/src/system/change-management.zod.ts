// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DataClassificationSchema } from './security-context.zod';

/**
 * Change Type Enum
 * 
 * Classification of change requests based on risk and approval requirements.
 * Follows ITIL change management best practices.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ChangeTypeSchema = lazySchema(() => z.enum([
  'standard',      // Pre-approved, low-risk changes
  'normal',        // Requires standard approval process
  'emergency',     // Fast-track approval for critical issues
  'major',         // Requires CAB (Change Advisory Board) approval
]));

/**
 * Change Priority Enum
 * 
 * Priority level for change request processing.
 */
export const ChangePrioritySchema = lazySchema(() => z.enum([
  'critical',
  'high',
  'medium',
  'low',
]));

/**
 * Change Status Enum
 * 
 * Current status of a change request in its lifecycle.
 */
export const ChangeStatusSchema = lazySchema(() => z.enum([
  'draft',
  'submitted',
  'in-review',
  'approved',
  'scheduled',
  'in-progress',
  'completed',
  'failed',
  'rolled-back',
  'cancelled',
]));

/**
 * Change Impact Schema
 * 
 * Assessment of the impact and scope of a change request.
 * Used for risk evaluation and approval routing.
 * 
 * @example
 * ```json
 * {
 *   "level": "high",
 *   "affectedSystems": ["crm-api", "customer-portal"],
 *   "affectedUsers": 5000,
 *   "downtime": {
 *     "required": true,
 *     "durationMinutes": 30
 *   }
 * }
 * ```
 */
export const ChangeImpactSchema = lazySchema(() => z.object({
  /**
   * Overall impact level of the change
   */
  level: z.enum(['low', 'medium', 'high', 'critical']).describe('Impact level'),

  /**
   * List of systems affected by this change
   */
  affectedSystems: z.array(z.string()).describe('Affected systems'),

  /**
   * Estimated number of users affected
   */
  affectedUsers: z.number().optional().describe('Affected user count'),

  /**
   * Downtime requirements
   */
  downtime: z.object({
    /**
     * Whether downtime is required
     */
    required: z.boolean().describe('Downtime required'),

    /**
     * Duration of downtime in minutes
     */
    durationMinutes: z.number().optional().describe('Downtime duration'),
  }).optional().describe('Downtime information'),
}));

/**
 * Rollback Plan Schema
 * 
 * Detailed procedure for reverting changes if implementation fails.
 * Required for all non-standard changes.
 * 
 * @example
 * ```json
 * {
 *   "description": "Revert database schema to previous version",
 *   "steps": [
 *     {
 *       "order": 1,
 *       "description": "Stop application servers",
 *       "estimatedMinutes": 5
 *     },
 *     {
 *       "order": 2,
 *       "description": "Restore database backup",
 *       "estimatedMinutes": 15
 *     }
 *   ],
 *   "testProcedure": "Verify application login and basic functionality"
 * }
 * ```
 */
export const RollbackPlanSchema = lazySchema(() => z.object({
  /**
   * High-level description of the rollback approach
   */
  description: z.string().describe('Rollback description'),

  /**
   * Sequential steps to execute rollback
   */
  steps: z.array(z.object({
    /**
     * Step execution order
     */
    order: z.number().describe('Step order'),

    /**
     * Detailed description of this step
     */
    description: z.string().describe('Step description'),

    /**
     * Estimated time to complete this step
     */
    estimatedMinutes: z.number().describe('Estimated duration'),
  })).describe('Rollback steps'),

  /**
   * Testing procedure to verify successful rollback
   */
  testProcedure: z.string().optional().describe('Test procedure'),
}));

/**
 * Change Request Schema
 * 
 * Comprehensive change management protocol for IT governance.
 * Supports change requests, deployment tracking, and ITIL compliance.
 * 
 * @example
 * ```json
 * {
 *   "id": "CHG-2024-001",
 *   "title": "Upgrade CRM Database Schema",
 *   "description": "Migrate customer database to new schema version 2.0",
 *   "type": "normal",
 *   "priority": "high",
 *   "status": "approved",
 *   "requestedBy": "user_123",
 *   "requestedAt": 1704067200000,
 *   "impact": {
 *     "level": "high",
 *     "affectedSystems": ["crm-api", "customer-portal"],
 *     "affectedUsers": 5000,
 *     "downtime": {
 *       "required": true,
 *       "durationMinutes": 30
 *     }
 *   },
 *   "implementation": {
 *     "description": "Execute database migration scripts",
 *     "steps": [
 *       {
 *         "order": 1,
 *         "description": "Backup current database",
 *         "estimatedMinutes": 10
 *       }
 *     ],
 *     "testing": "Run integration test suite"
 *   },
 *   "rollbackPlan": {
 *     "description": "Restore from backup",
 *     "steps": [
 *       {
 *         "order": 1,
 *         "description": "Restore backup",
 *         "estimatedMinutes": 15
 *       }
 *     ]
 *   },
 *   "schedule": {
 *     "plannedStart": 1704153600000,
 *     "plannedEnd": 1704155400000
 *   }
 * }
 * ```
 */
export const ChangeRequestSchema = lazySchema(() => z.object({
  /**
   * Unique change request identifier
   */
  id: z.string().describe('Change request ID'),

  /**
   * Short descriptive title of the change
   */
  title: z.string().describe('Change title'),

  /**
   * Detailed description of the change and its purpose
   */
  description: z.string().describe('Change description'),

  /**
   * Change classification type
   */
  type: ChangeTypeSchema.describe('Change type'),

  /**
   * Priority level for processing
   */
  priority: ChangePrioritySchema.describe('Change priority'),

  /**
   * Current status in the change lifecycle
   */
  status: ChangeStatusSchema.describe('Change status'),

  /**
   * User ID of the change requester
   */
  requestedBy: z.string().describe('Requester user ID'),

  /**
   * Timestamp when change was requested (Unix milliseconds)
   */
  requestedAt: z.number().describe('Request timestamp'),

  /**
   * Impact assessment of the change
   */
  impact: ChangeImpactSchema.describe('Impact assessment'),

  /**
   * Implementation plan and procedures
   */
  implementation: z.object({
    /**
     * High-level implementation description
     */
    description: z.string().describe('Implementation description'),

    /**
     * Sequential implementation steps
     */
    steps: z.array(z.object({
      /**
       * Step execution order
       */
      order: z.number().describe('Step order'),

      /**
       * Detailed description of this step
       */
      description: z.string().describe('Step description'),

      /**
       * Estimated time to complete this step
       */
      estimatedMinutes: z.number().describe('Estimated duration'),
    })).describe('Implementation steps'),

    /**
     * Testing procedures to verify successful implementation
     */
    testing: z.string().optional().describe('Testing procedure'),
  }).describe('Implementation plan'),

  /**
   * Rollback plan in case of failure
   */
  rollbackPlan: RollbackPlanSchema.describe('Rollback plan'),

  /**
   * Change schedule and timing
   */
  schedule: z.object({
    /**
     * Planned start time (Unix milliseconds)
     */
    plannedStart: z.number().describe('Planned start time'),

    /**
     * Planned end time (Unix milliseconds)
     */
    plannedEnd: z.number().describe('Planned end time'),

    /**
     * Actual start time (Unix milliseconds)
     */
    actualStart: z.number().optional().describe('Actual start time'),

    /**
     * Actual end time (Unix milliseconds)
     */
    actualEnd: z.number().optional().describe('Actual end time'),
  }).optional().describe('Schedule'),

  /**
   * Security impact assessment for the change (A.8.32)
   */
  securityImpact: z.object({
    /**
     * Whether a security impact assessment has been performed
     */
    assessed: z.boolean().describe('Whether security impact has been assessed'),

    /**
     * Security risk level of this change
     */
    riskLevel: z.enum(['none', 'low', 'medium', 'high', 'critical']).optional()
      .describe('Security risk level'),

    /**
     * Data classifications affected by this change
     */
    affectedDataClassifications: z.array(DataClassificationSchema)
      .optional().describe('Affected data classifications'),

    /**
     * Whether the change requires security team approval
     */
    requiresSecurityApproval: z.boolean().default(false)
      .describe('Whether security team approval is required'),

    /**
     * Security reviewer user ID
     */
    reviewedBy: z.string().optional()
      .describe('Security reviewer user ID'),

    /**
     * Security review completion timestamp (Unix milliseconds)
     */
    reviewedAt: z.number().optional()
      .describe('Security review timestamp'),

    /**
     * Security review notes or conditions
     */
    reviewNotes: z.string().optional()
      .describe('Security review notes or conditions'),
  }).optional().describe('Security impact assessment per ISO 27001:2022 A.8.32'),

  /**
   * Approval workflow configuration
   */
  approval: z.object({
    /**
     * Whether approval is required for this change
     */
    required: z.boolean().describe('Approval required'),

    /**
     * List of approvers and their approval status
     */
    approvers: z.array(z.object({
      /**
       * Approver user ID
       */
      userId: z.string().describe('Approver user ID'),

      /**
       * Timestamp when approval was granted (Unix milliseconds)
       */
      approvedAt: z.number().optional().describe('Approval timestamp'),

      /**
       * Comments from the approver
       */
      comments: z.string().optional().describe('Approver comments'),
    })).describe('Approvers'),
  }).optional().describe('Approval workflow'),

  /**
   * Supporting documentation and files
   */
  attachments: z.array(z.object({
    /**
     * Attachment file name
     */
    name: z.string().describe('Attachment name'),

    /**
     * URL to download the attachment
     */
    url: z.string().url().describe('Attachment URL'),
  })).optional().describe('Attachments'),

  /**
   * Custom metadata key-value pairs for extensibility
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom metadata key-value pairs for extensibility'),
}));

// Type exports
export type ChangeRequest = z.input<typeof ChangeRequestSchema>;
/** Post-parse shape of {@link ChangeRequest} — defaults applied, transforms run (ADR-0122). */
export type ChangeRequestParsed = z.infer<typeof ChangeRequestSchema>;
export type ChangeType = z.input<typeof ChangeTypeSchema>;
export type ChangeStatus = z.input<typeof ChangeStatusSchema>;
export type ChangePriority = z.input<typeof ChangePrioritySchema>;
export type ChangeImpact = z.input<typeof ChangeImpactSchema>;
export type RollbackPlan = z.input<typeof RollbackPlanSchema>;
