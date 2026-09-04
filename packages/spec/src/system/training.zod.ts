// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { retiredKey } from '../shared/retired-key';

/**
 * Information Security Training Protocol — ISO 27001:2022 (A.6.3)
 *
 * Defines schemas for security awareness and training management including
 * course definitions, completion tracking, and organizational training plans.
 *
 * @see https://www.iso.org/standard/27001
 * @category Security
 */

/**
 * Training Category Schema
 *
 * Classification of training content by domain.
 */
import { lazySchema } from '../shared/lazy-schema';
export const TrainingCategorySchema = lazySchema(() => z.enum([
  'security_awareness',       // General security awareness
  'data_protection',          // Data handling and privacy
  'incident_response',        // Incident reporting and response
  'access_control',           // Access management best practices
  'phishing_awareness',       // Phishing and social engineering
  'compliance',               // Regulatory compliance (GDPR, HIPAA, etc.)
  'secure_development',       // Secure coding and development practices
  'physical_security',        // Physical security awareness
  'business_continuity',      // Business continuity and disaster recovery
  'other',                    // Other training categories
]));

// ─── RETIRED deadline keys (ADR-0049 enforce-or-remove) ─────────────────────
//
// Five minute/day-shaped duration and deadline keys were declared on the
// training schemas and read by NOTHING: no training engine scheduled a
// course, computed a certification expiry, re-assigned training on an
// interval, escalated an expired certification or sent a reminder — the
// schemas are exported, mounted by no stack key and registered as no metadata
// type, and the reader census over every package outside `packages/spec` (and
// over objectui at the pinned sha) returned zero hits for every key. Maintainer
// ruling 2026-09-02 (recorded on #14477): retire the family under
// enforce-or-remove.
//
// Route: `retiredKey()` tombstones, NOT plain deletion (the schemas are not
// `.strict()`; a bare deletion would be a silent strip, ADR-0104). No D2
// conversion and no `os migrate meta` sentence: none of these schemas is a
// stack collection member, so a conversion would have no seam that ever runs
// (the `kernel/MetadataPluginConfig:additionalTypes` precedent). Registered
// as `RETIRED_KEYS_BY_MAJOR[18]` entries plus the D3 semantic entry
// `training-deadline-keys-retired`.

const DURATION_MINUTES_RETIRED =
  '`TrainingCourse.durationMinutes` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no training engine scheduled, timed or '
  + 'reported a course, so the duration was a number the platform displayed nowhere and acted '
  + 'on never. Delete the key. There is no replacement, because no training-management engine '
  + 'exists.';

const VALIDITY_DAYS_RETIRED =
  '`TrainingCourse.validityDays` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no engine computed a certification expiry from '
  + 'it, so a certificate declared valid for 365 days never expired on the platform and never '
  + 'triggered recertification. Delete the key. There is no replacement, because no '
  + 'training-management engine exists to keep a validity window.';

const RECERTIFICATION_INTERVAL_DAYS_RETIRED =
  '`TrainingPlan.recertificationIntervalDays` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no engine re-assigned training on an interval, '
  + 'so the interval never elapsed into anything, and its default of 365 days was materialized '
  + 'into every parsed plan without ever being consulted. Delete the key. There is no '
  + 'replacement, because no training-management engine exists.';

const GRACE_PERIOD_DAYS_RETIRED =
  '`TrainingPlan.gracePeriodDays` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no engine escalated an expired certification, '
  + 'so a grace period before that escalation had nothing to delay, and its default of 30 days '
  + 'was materialized into every parsed plan without ever being consulted. Delete the key. '
  + 'There is no replacement, because no training-management engine exists.';

const REMINDER_DAYS_BEFORE_RETIRED =
  '`TrainingPlan.reminderDaysBefore` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no engine sent a training reminder, so the lead '
  + 'time was never counted down, and its default of 14 days was materialized into every parsed '
  + 'plan without ever being consulted. Delete the key. There is no replacement, because no '
  + 'training-reminder engine exists.';

/**
 * Training Completion Status Schema
 */
export const TrainingCompletionStatusSchema = lazySchema(() => z.enum([
  'not_started',   // Training not yet begun
  'in_progress',   // Training currently underway
  'completed',     // Training completed successfully
  'failed',        // Training assessment not passed
  'expired',       // Training certification has expired
]));

/**
 * Training Course Schema
 *
 * Definition of a security training course or module.
 *
 * @example
 * ```json
 * {
 *   "id": "COURSE-SEC-001",
 *   "title": "Information Security Fundamentals",
 *   "description": "Annual security awareness training for all employees",
 *   "category": "security_awareness",
 *   "mandatory": true,
 *   "targetRoles": ["all_employees"],
 *   "passingScore": 80
 * }
 * ```
 */
export const TrainingCourseSchema = lazySchema(() => z.object({
  /**
   * Unique course identifier
   */
  id: z.string().describe('Unique course identifier'),

  /**
   * Course title
   */
  title: z.string().describe('Course title'),

  /**
   * Course description and objectives
   */
  description: z.string().describe('Course description and learning objectives'),

  /**
   * Training category
   */
  category: TrainingCategorySchema.describe('Training category'),

  /**
   * REMOVED (ADR-0049 enforce-or-remove) — see `DURATION_MINUTES_RETIRED` above.
   */
  durationMinutes: retiredKey(DURATION_MINUTES_RETIRED),

  /**
   * Whether this training is mandatory
   */
  mandatory: z.boolean().default(false).describe('Whether training is mandatory'),

  /**
   * Target roles or groups for this training
   */
  targetRoles: z.array(z.string()).describe('Target roles or groups'),

  /**
   * REMOVED (ADR-0049 enforce-or-remove) — see `VALIDITY_DAYS_RETIRED` above.
   */
  validityDays: retiredKey(VALIDITY_DAYS_RETIRED),

  /**
   * Minimum passing score (percentage) for assessment
   */
  passingScore: z.number().min(0).max(100).optional()
    .describe('Minimum passing score percentage'),

  /**
   * Course version for tracking content updates
   */
  version: z.string().optional().describe('Course content version'),
}).describe('Security training course definition'));

/**
 * Training Record Schema
 *
 * Individual employee training completion record.
 */
export const TrainingRecordSchema = lazySchema(() => z.object({
  /**
   * Reference to the course ID
   */
  courseId: z.string().describe('Training course identifier'),

  /**
   * User who completed (or is assigned) the training
   */
  userId: z.string().describe('User identifier'),

  /**
   * Completion status
   */
  status: TrainingCompletionStatusSchema.describe('Training completion status'),

  /**
   * Training assignment date (Unix milliseconds)
   */
  assignedAt: z.number().describe('Assignment timestamp'),

  /**
   * Training completion date (Unix milliseconds)
   */
  completedAt: z.number().optional().describe('Completion timestamp'),

  /**
   * Assessment score (percentage)
   */
  score: z.number().min(0).max(100).optional().describe('Assessment score percentage'),

  /**
   * Certification expiry date (Unix milliseconds)
   */
  expiresAt: z.number().optional().describe('Certification expiry timestamp'),

  /**
   * Notes or comments from instructor or system
   */
  notes: z.string().optional().describe('Training notes or comments'),
}).describe('Individual training completion record'));

/**
 * Training Plan Schema
 *
 * Organizational training plan defining schedule and requirements (A.6.3).
 */
export const TrainingPlanSchema = lazySchema(() => z.object({
  /**
   * Whether training management is enabled
   */
  enabled: z.boolean().default(true).describe('Enable training management'),

  /**
   * Training courses in the plan
   */
  courses: z.array(TrainingCourseSchema).describe('Training courses'),

  /**
   * REMOVED (ADR-0049 enforce-or-remove) — see `RECERTIFICATION_INTERVAL_DAYS_RETIRED` above.
   */
  recertificationIntervalDays: retiredKey(RECERTIFICATION_INTERVAL_DAYS_RETIRED),

  /**
   * Whether to track training completion for compliance reporting
   */
  trackCompletion: z.boolean().default(true)
    .describe('Track training completion for compliance'),

  /**
   * REMOVED (ADR-0049 enforce-or-remove) — see `GRACE_PERIOD_DAYS_RETIRED` above.
   */
  gracePeriodDays: retiredKey(GRACE_PERIOD_DAYS_RETIRED),

  /**
   * Whether to send reminders for upcoming training deadlines
   */
  sendReminders: z.boolean().default(true)
    .describe('Send reminders for upcoming training deadlines'),

  /**
   * REMOVED (ADR-0049 enforce-or-remove) — see `REMINDER_DAYS_BEFORE_RETIRED` above.
   */
  reminderDaysBefore: retiredKey(REMINDER_DAYS_BEFORE_RETIRED),
}).describe('Organizational training plan per ISO 27001:2022 A.6.3'));

// Type exports
export type TrainingCategory = z.input<typeof TrainingCategorySchema>;
export type TrainingCompletionStatus = z.input<typeof TrainingCompletionStatusSchema>;
export type TrainingCourse = z.input<typeof TrainingCourseSchema>;
/** Post-parse shape of {@link TrainingCourse} — defaults applied, transforms run (ADR-0122). */
export type TrainingCourseParsed = z.infer<typeof TrainingCourseSchema>;
export type TrainingRecord = z.input<typeof TrainingRecordSchema>;
export type TrainingPlan = z.input<typeof TrainingPlanSchema>;
/** Post-parse shape of {@link TrainingPlan} — defaults applied, transforms run (ADR-0122). */
export type TrainingPlanParsed = z.infer<typeof TrainingPlanSchema>;
