// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Marketplace Administration Protocol
 *
 * Defines schemas for the platform (Cloud) side of marketplace operations.
 * Covers the administrative workflows for managing and governing the marketplace.
 *
 * ## Architecture Alignment
 * - **Salesforce AppExchange Admin**: Security review, ISV monitoring, partner management
 * - **Apple App Store Connect Review**: Human review process, guidelines, rejection reasons
 * - **Google Play Console**: Policy enforcement, quality gates, content moderation
 *
 * ## Key Concepts
 * - **Review Process**: Structured workflow for submission review (automated + manual)
 * - **Curation**: Featured apps, curated collections, editorial picks
 * - **Governance**: Policy enforcement, takedown, compliance
 * - **Platform Analytics**: Marketplace health, trending, abuse detection
 */

// ==========================================
// Review Process
// ==========================================

/**
 * Review Criteria — checklist items for human reviewers
 */
import { lazySchema } from '../shared/lazy-schema';
export const ReviewCriterionSchema = lazySchema(() => z.object({
  /** Criterion identifier */
  id: z.string().describe('Criterion ID'),

  /** Category of criterion */
  category: z.enum([
    'security',       // Security best practices
    'performance',    // Performance / resource usage
    'quality',        // Code quality / best practices
    'ux',             // User experience standards
    'documentation',  // Documentation completeness
    'policy',         // Policy compliance (no malware, GDPR, etc.)
    'compatibility',  // Platform compatibility
  ]),

  /** Description of what to check */
  description: z.string(),

  /** Whether this criterion must pass for approval */
  required: z.boolean().default(true),

  /** Pass/fail result */
  passed: z.boolean().optional(),

  /** Reviewer notes for this criterion */
  notes: z.string().optional(),
}));

/**
 * Review Decision
 */
export const ReviewDecisionSchema = lazySchema(() => z.enum([
  'approved',            // Approved for publishing
  'rejected',            // Rejected (with reasons)
  'changes-requested',   // Needs changes before re-review
]));

/**
 * Rejection Reason Category
 */
export const RejectionReasonSchema = lazySchema(() => z.enum([
  'security-vulnerability',    // Security issues found
  'policy-violation',          // Violates marketplace policy
  'quality-below-standard',    // Does not meet quality bar
  'misleading-metadata',       // Listing info doesn't match functionality
  'incompatible',              // Incompatible with current platform
  'duplicate',                 // Duplicate of existing listing
  'insufficient-documentation', // Inadequate documentation
  'other',                     // Other reason (see notes)
]));

/**
 * Submission Review Schema
 *
 * The review record attached to a package submission.
 */
export const SubmissionReviewSchema = lazySchema(() => z.object({
  /** Review ID */
  id: z.string().describe('Review ID'),

  /** Submission ID being reviewed */
  submissionId: z.string().describe('Submission being reviewed'),

  /** Reviewer user ID */
  reviewerId: z.string().describe('Platform reviewer ID'),

  /** Review decision */
  decision: ReviewDecisionSchema.optional().describe('Final decision'),

  /** Review criteria checklist */
  criteria: z.array(ReviewCriterionSchema).optional()
    .describe('Review checklist results'),

  /** Rejection reasons (if rejected) */
  rejectionReasons: z.array(RejectionReasonSchema).optional(),

  /** Detailed feedback for the developer */
  feedback: z.string().optional().describe('Detailed review feedback (Markdown)'),

  /** Internal notes (not visible to developer) */
  internalNotes: z.string().optional().describe('Internal reviewer notes'),

  /** Review started timestamp */
  startedAt: z.string().datetime().optional(),

  /** Review completed timestamp */
  completedAt: z.string().datetime().optional(),
}));

// ==========================================
// Curation: Featured & Collections
// ==========================================

/**
 * Featured Listing — promoted on marketplace homepage
 */
export const FeaturedListingSchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string().describe('Featured listing ID'),

  /** Featured position/priority (lower = higher priority) */
  priority: z.number().int().min(0).default(0),

  /** Featured banner image URL */
  bannerUrl: z.string().url().optional(),

  /** Featured reason / editorial note */
  editorialNote: z.string().optional(),

  /** Start date for featured period */
  startDate: z.string().datetime(),

  /** End date for featured period */
  endDate: z.string().datetime().optional(),

  /** Whether currently active */
  active: z.boolean().default(true),
}));

/**
 * Curated Collection — a themed group of listings
 */
export const CuratedCollectionSchema = lazySchema(() => z.object({
  /** Collection unique identifier */
  id: z.string().describe('Collection ID'),

  /** Collection display name */
  name: z.string().describe('Collection name'),

  /** Collection description */
  description: z.string().optional(),

  /** Cover image URL */
  coverImageUrl: z.string().url().optional(),

  /** Listing IDs in this collection (ordered) */
  listingIds: z.array(z.string()).min(1).describe('Ordered listing IDs'),

  /** Whether publicly visible */
  published: z.boolean().default(false),

  /** Sort order for display among collections */
  sortOrder: z.number().int().min(0).default(0),

  /** Created by (admin user ID) */
  createdBy: z.string().optional(),

  /** Created at */
  createdAt: z.string().datetime().optional(),

  /** Updated at */
  updatedAt: z.string().datetime().optional(),
}));

// ==========================================
// Governance & Policy
// ==========================================

/**
 * Policy Violation Type
 */
export const PolicyViolationTypeSchema = lazySchema(() => z.enum([
  'malware',               // Malicious software
  'data-harvesting',       // Unauthorized data collection
  'spam',                  // Spammy or misleading content
  'copyright',             // Copyright/IP infringement
  'inappropriate-content', // Inappropriate or offensive content
  'terms-of-service',      // General ToS violation
  'security-risk',         // Unresolved critical security issues
  'abandoned',             // Abandoned / no longer maintained
]));

/**
 * Policy Action — enforcement action on a listing
 */
export const PolicyActionSchema = lazySchema(() => z.object({
  /** Action ID */
  id: z.string().describe('Action ID'),

  /** Listing ID */
  listingId: z.string().describe('Target listing ID'),

  /** Violation type */
  violationType: PolicyViolationTypeSchema,

  /** Action taken */
  action: z.enum([
    'warning',         // Warning to publisher
    'suspend',         // Temporarily suspend listing
    'takedown',        // Permanently remove listing
    'restrict',        // Restrict new installs (existing users keep access)
  ]),

  /** Detailed reason */
  reason: z.string().describe('Explanation of the violation'),

  /** Admin user who took the action */
  actionBy: z.string().describe('Admin user ID'),

  /** Timestamp */
  actionAt: z.string().datetime(),

  /** Resolution notes (if resolved) */
  resolution: z.string().optional(),

  /** Whether resolved */
  resolved: z.boolean().default(false),
}));

// ==========================================
// Platform Analytics
// ==========================================

/**
 * Marketplace Health Metrics — overall platform statistics
 */
export const MarketplaceHealthMetricsSchema = lazySchema(() => z.object({
  /** Total number of published listings */
  totalListings: z.number().int().min(0),

  /** Listings by status breakdown (partial — only non-zero statuses) */
  listingsByStatus: z.record(z.string(), z.number().int().min(0)).optional(),

  /** Listings by category breakdown (partial — only non-zero categories) */
  listingsByCategory: z.record(z.string(), z.number().int().min(0)).optional(),

  /** Total registered publishers */
  totalPublishers: z.number().int().min(0),

  /** Verified publishers count */
  verifiedPublishers: z.number().int().min(0),

  /** Total installs across all listings (all time) */
  totalInstalls: z.number().int().min(0),

  /** Average time from submission to review completion (hours) */
  averageReviewTime: z.number().min(0).optional(),

  /** Pending review queue size */
  pendingReviews: z.number().int().min(0),

  /** Listings by pricing model (partial — only non-zero models) */
  listingsByPricing: z.record(z.string(), z.number().int().min(0)).optional(),

  /** Snapshot timestamp */
  snapshotAt: z.string().datetime(),
}));

/**
 * Trending Listing — computed from recent activity
 */
export const TrendingListingSchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string(),

  /** Trending rank (1 = most trending) */
  rank: z.number().int().min(1),

  /** Trend score (computed from velocity of installs, ratings, page views) */
  trendScore: z.number().min(0),

  /** Install velocity (installs per day over measurement period) */
  installVelocity: z.number().min(0),

  /** Measurement period (e.g., "7d", "30d") */
  period: z.string(),
}));

// ==========================================
// Export Types
// ==========================================

export type ReviewCriterion = z.input<typeof ReviewCriterionSchema>;
/** Post-parse shape of {@link ReviewCriterion} — defaults applied, transforms run (ADR-0122). */
export type ReviewCriterionParsed = z.infer<typeof ReviewCriterionSchema>;
export type ReviewDecision = z.input<typeof ReviewDecisionSchema>;
export type RejectionReason = z.input<typeof RejectionReasonSchema>;
export type SubmissionReview = z.input<typeof SubmissionReviewSchema>;
/** Post-parse shape of {@link SubmissionReview} — defaults applied, transforms run (ADR-0122). */
export type SubmissionReviewParsed = z.infer<typeof SubmissionReviewSchema>;
export type FeaturedListing = z.input<typeof FeaturedListingSchema>;
/** Post-parse shape of {@link FeaturedListing} — defaults applied, transforms run (ADR-0122). */
export type FeaturedListingParsed = z.infer<typeof FeaturedListingSchema>;
export type CuratedCollection = z.input<typeof CuratedCollectionSchema>;
/** Post-parse shape of {@link CuratedCollection} — defaults applied, transforms run (ADR-0122). */
export type CuratedCollectionParsed = z.infer<typeof CuratedCollectionSchema>;
export type PolicyViolationType = z.input<typeof PolicyViolationTypeSchema>;
export type PolicyAction = z.input<typeof PolicyActionSchema>;
/** Post-parse shape of {@link PolicyAction} — defaults applied, transforms run (ADR-0122). */
export type PolicyActionParsed = z.infer<typeof PolicyActionSchema>;
export type MarketplaceHealthMetrics = z.input<typeof MarketplaceHealthMetricsSchema>;
export type TrendingListing = z.input<typeof TrendingListingSchema>;
