// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

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
 *   "durationMinutes": 60,
 *   "mandatory": true,
 *   "targetRoles": ["all_employees"],
 *   "validityDays": 365,
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
   * Estimated duration in minutes
   */
  durationMinutes: z.number().min(1).describe('Estimated course duration in minutes'),

  /**
   * Whether this training is mandatory
   */
  mandatory: z.boolean().default(false).describe('Whether training is mandatory'),

  /**
   * Target roles or groups for this training
   */
  targetRoles: z.array(z.string()).describe('Target roles or groups'),

  /**
   * Validity period in days before recertification is needed
   */
  validityDays: z.number().optional().describe('Certification validity period in days'),

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
   * Default recertification interval in days
   */
  recertificationIntervalDays: z.number().default(365)
    .describe('Default recertification interval in days'),

  /**
   * Whether to track training completion for compliance reporting
   */
  trackCompletion: z.boolean().default(true)
    .describe('Track training completion for compliance'),

  /**
   * Grace period in days after expiry before non-compliance escalation
   */
  gracePeriodDays: z.number().default(30)
    .describe('Grace period in days after certification expiry'),

  /**
   * Whether to send reminders for upcoming training deadlines
   */
  sendReminders: z.boolean().default(true)
    .describe('Send reminders for upcoming training deadlines'),

  /**
   * Days before deadline to send first reminder
   */
  reminderDaysBefore: z.number().default(14)
    .describe('Days before deadline to send first reminder'),
}).describe('Organizational training plan per ISO 27001:2022 A.6.3'));

// Type exports
export type TrainingCategory = z.infer<typeof TrainingCategorySchema>;
export type TrainingCompletionStatus = z.infer<typeof TrainingCompletionStatusSchema>;
export type TrainingCourse = z.infer<typeof TrainingCourseSchema>;
/** Post-parse shape of {@link TrainingCourse} — defaults applied, transforms run (ADR-0122). */
export type TrainingCourseParsed = z.infer<typeof TrainingCourseSchema>;
export type TrainingRecord = z.infer<typeof TrainingRecordSchema>;
export type TrainingPlan = z.infer<typeof TrainingPlanSchema>;
/** Post-parse shape of {@link TrainingPlan} — defaults applied, transforms run (ADR-0122). */
export type TrainingPlanParsed = z.infer<typeof TrainingPlanSchema>;
