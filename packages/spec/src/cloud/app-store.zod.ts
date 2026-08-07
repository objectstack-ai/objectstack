// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { MarketplaceCategorySchema, PricingModelSchema } from './marketplace.zod';

/**
 * # App Store Protocol (Customer Experience)
 *
 * Defines schemas for the end-customer experience when browsing, evaluating,
 * installing, and managing marketplace apps from within ObjectOS.
 *
 * ## Architecture Alignment
 * - **Salesforce AppExchange (Customer)**: Browse apps, read reviews, 1-click install
 * - **Shopify App Store (Merchant)**: App evaluation, trial, install, manage subscriptions
 * - **Apple App Store (User)**: Ratings, reviews, featured collections, personalized recs
 *
 * ## Customer Journey
 * ```
 * Discover → Evaluate → Install → Configure → Use → Rate/Review → Manage
 * ```
 *
 * ## Key Concepts
 * - **Reviews & Ratings**: User-submitted ratings and reviews with moderation
 * - **Collections & Recommendations**: Personalized discovery and curated picks
 * - **Subscription Management**: Manage licenses, billing, and renewals
 * - **Installed App Management**: Enable, disable, configure, upgrade, uninstall
 */

// ==========================================
// User Reviews & Ratings
// ==========================================

/**
 * Review Moderation Status
 */
import { lazySchema } from '../shared/lazy-schema';
export const ReviewModerationStatusSchema = lazySchema(() => z.enum([
  'pending',     // Awaiting moderation
  'approved',    // Approved and visible
  'flagged',     // Flagged for review
  'rejected',    // Rejected (spam, inappropriate)
]));

/**
 * User Review Schema — a customer's review of an installed app
 */
export const UserReviewSchema = lazySchema(() => z.object({
  /** Review ID */
  id: z.string().describe('Review ID'),

  /** Listing ID being reviewed */
  listingId: z.string().describe('Listing being reviewed'),

  /** Reviewer user ID */
  userId: z.string().describe('Review author user ID'),

  /** Reviewer display name */
  displayName: z.string().optional().describe('Reviewer display name'),

  /** Star rating (1-5) */
  rating: z.number().int().min(1).max(5).describe('Star rating (1-5)'),

  /** Review title */
  title: z.string().max(200).optional().describe('Review title'),

  /** Review body text */
  body: z.string().max(5000).optional().describe('Review text'),

  /** Version the reviewer is using */
  appVersion: z.string().optional().describe('App version being reviewed'),

  /** Moderation status */
  moderationStatus: ReviewModerationStatusSchema.default('pending'),

  /** Number of "helpful" votes from other users */
  helpfulCount: z.number().int().min(0).default(0),

  /** Publisher's response to this review */
  publisherResponse: z.object({
    body: z.string(),
    respondedAt: z.string().datetime(),
  }).optional().describe('Publisher response to review'),

  /** Submitted timestamp */
  submittedAt: z.string().datetime(),

  /** Updated timestamp */
  updatedAt: z.string().datetime().optional(),
}));

/**
 * Submit Review Request
 */
export const SubmitReviewRequestSchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string().describe('Listing to review'),

  /** Star rating (1-5) */
  rating: z.number().int().min(1).max(5).describe('Star rating'),

  /** Review title */
  title: z.string().max(200).optional(),

  /** Review body */
  body: z.string().max(5000).optional(),
}));

/**
 * List Reviews Request — customer browsing reviews
 */
export const ListReviewsRequestSchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string().describe('Listing to get reviews for'),

  /** Sort by */
  sortBy: z.enum(['newest', 'oldest', 'highest', 'lowest', 'most-helpful'])
    .default('newest'),

  /** Filter by rating */
  rating: z.number().int().min(1).max(5).optional(),

  /** Pagination */
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(10),
}));

/**
 * List Reviews Response
 */
export const ListReviewsResponseSchema = lazySchema(() => z.object({
  /** Reviews */
  items: z.array(UserReviewSchema),

  /** Total count */
  total: z.number().int().min(0),

  /** Pagination */
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),

  /** Rating summary */
  ratingSummary: z.object({
    averageRating: z.number().min(0).max(5),
    totalRatings: z.number().int().min(0),
    distribution: z.object({
      1: z.number().int().min(0).default(0),
      2: z.number().int().min(0).default(0),
      3: z.number().int().min(0).default(0),
      4: z.number().int().min(0).default(0),
      5: z.number().int().min(0).default(0),
    }),
  }).optional(),
}));

// ==========================================
// App Discovery & Recommendations
// ==========================================

/**
 * App Recommendation Reason
 */
export const RecommendationReasonSchema = lazySchema(() => z.enum([
  'popular-in-category',  // Popular in your industry/category
  'similar-users',        // Used by similar organizations
  'complements-installed', // Complements apps you already use
  'trending',             // Currently trending
  'new-release',          // Recently released / major update
  'editor-pick',          // Editorial/curated recommendation
]));

/**
 * Recommended App
 */
export const RecommendedAppSchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string(),

  /** App name */
  name: z.string(),

  /** Short tagline */
  tagline: z.string().optional(),

  /** Icon URL */
  iconUrl: z.string().url().optional(),

  /** Category */
  category: MarketplaceCategorySchema,

  /** Pricing */
  pricing: PricingModelSchema,

  /** Average rating */
  averageRating: z.number().min(0).max(5).optional(),

  /** Active installs */
  activeInstalls: z.number().int().min(0).optional(),

  /** Why this is recommended */
  reason: RecommendationReasonSchema,
}));

/**
 * App Discovery Request — personalized browse/home page
 */
export const AppDiscoveryRequestSchema = lazySchema(() => z.object({
  /** Tenant ID for personalization */
  tenantId: z.string().optional(),

  /** Categories the customer is interested in */
  categories: z.array(MarketplaceCategorySchema).optional(),

  /** Platform version for compatibility filtering */
  platformVersion: z.string().optional(),

  /** Max number of items per section */
  limit: z.number().int().min(1).max(50).default(10),
}));

/**
 * App Discovery Response — structured content for the storefront
 */
export const AppDiscoveryResponseSchema = lazySchema(() => z.object({
  /** Featured apps (editorial picks) */
  featured: z.array(RecommendedAppSchema).optional(),

  /** Personalized recommendations */
  recommended: z.array(RecommendedAppSchema).optional(),

  /** Trending apps */
  trending: z.array(RecommendedAppSchema).optional(),

  /** Recently added */
  newArrivals: z.array(RecommendedAppSchema).optional(),

  /** Curated collections */
  collections: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    coverImageUrl: z.string().url().optional(),
    apps: z.array(RecommendedAppSchema),
  })).optional(),
}));

// ==========================================
// Subscription & License Management
// ==========================================

/**
 * Subscription Status
 */
export const SubscriptionStatusSchema = lazySchema(() => z.enum([
  'active',        // Active and paid
  'trialing',      // Free trial period
  'past-due',      // Payment overdue
  'cancelled',     // Cancelled (still active until period ends)
  'expired',       // Expired / ended
]));

/**
 * App Subscription Schema — customer's license/subscription for an app
 */
export const AppSubscriptionSchema = lazySchema(() => z.object({
  /** Subscription ID */
  id: z.string().describe('Subscription ID'),

  /** Listing ID */
  listingId: z.string().describe('App listing ID'),

  /** Tenant ID */
  tenantId: z.string().describe('Customer tenant ID'),

  /** Subscription status */
  status: SubscriptionStatusSchema,

  /** License key */
  licenseKey: z.string().optional(),

  /** Plan/tier name (if multiple plans) */
  plan: z.string().optional().describe('Subscription plan name'),

  /** Billing cycle */
  billingCycle: z.enum(['monthly', 'annual']).optional(),

  /** Price per billing cycle (in cents) */
  priceInCents: z.number().int().min(0).optional(),

  /** Current period start */
  currentPeriodStart: z.string().datetime().optional(),

  /** Current period end */
  currentPeriodEnd: z.string().datetime().optional(),

  /** Trial end date (if trialing) */
  trialEndDate: z.string().datetime().optional(),

  /** Whether auto-renew is on */
  autoRenew: z.boolean().default(true),

  /** Created timestamp */
  createdAt: z.string().datetime(),
}));

// ==========================================
// Installed App Management (Customer Side)
// ==========================================

/**
 * Installed App Summary — what the customer sees in their "My Apps" dashboard
 */
export const InstalledAppSummarySchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string(),

  /** Package ID */
  packageId: z.string(),

  /** Display name */
  name: z.string(),

  /** Icon URL */
  iconUrl: z.string().url().optional(),

  /** Installed version */
  installedVersion: z.string(),

  /** Latest available version */
  latestVersion: z.string().optional(),

  /** Whether an update is available */
  updateAvailable: z.boolean().default(false),

  /** Whether the app is currently enabled */
  enabled: z.boolean().default(true),

  /** Subscription status (for paid apps) */
  subscriptionStatus: SubscriptionStatusSchema.optional(),

  /** Installed timestamp */
  installedAt: z.string().datetime(),
}));

/**
 * List Installed Apps Request
 */
export const ListInstalledAppsRequestSchema = lazySchema(() => z.object({
  /** Tenant ID */
  tenantId: z.string().optional(),

  /** Filter by enabled/disabled */
  enabled: z.boolean().optional(),

  /** Filter by update availability */
  updateAvailable: z.boolean().optional(),

  /** Sort by */
  sortBy: z.enum(['name', 'installed-date', 'updated-date']).default('name'),

  /** Pagination */
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
}));

/**
 * List Installed Apps Response
 */
export const ListInstalledAppsResponseSchema = lazySchema(() => z.object({
  /** Installed apps */
  items: z.array(InstalledAppSummarySchema),

  /** Total count */
  total: z.number().int().min(0),

  /** Pagination */
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
}));

// ==========================================
// Export Types
// ==========================================

export type ReviewModerationStatus = z.input<typeof ReviewModerationStatusSchema>;
export type UserReview = z.input<typeof UserReviewSchema>;
/** Post-parse shape of {@link UserReview} — defaults applied, transforms run (ADR-0122). */
export type UserReviewParsed = z.infer<typeof UserReviewSchema>;
export type SubmitReviewRequest = z.input<typeof SubmitReviewRequestSchema>;
export type ListReviewsRequest = z.input<typeof ListReviewsRequestSchema>;
/** Post-parse shape of {@link ListReviewsRequest} — defaults applied, transforms run (ADR-0122). */
export type ListReviewsRequestParsed = z.infer<typeof ListReviewsRequestSchema>;
export type ListReviewsResponse = z.input<typeof ListReviewsResponseSchema>;
/** Post-parse shape of {@link ListReviewsResponse} — defaults applied, transforms run (ADR-0122). */
export type ListReviewsResponseParsed = z.infer<typeof ListReviewsResponseSchema>;
export type RecommendationReason = z.input<typeof RecommendationReasonSchema>;
export type RecommendedApp = z.input<typeof RecommendedAppSchema>;
export type AppDiscoveryRequest = z.input<typeof AppDiscoveryRequestSchema>;
/** Post-parse shape of {@link AppDiscoveryRequest} — defaults applied, transforms run (ADR-0122). */
export type AppDiscoveryRequestParsed = z.infer<typeof AppDiscoveryRequestSchema>;
export type AppDiscoveryResponse = z.input<typeof AppDiscoveryResponseSchema>;
export type SubscriptionStatus = z.input<typeof SubscriptionStatusSchema>;
export type AppSubscription = z.input<typeof AppSubscriptionSchema>;
/** Post-parse shape of {@link AppSubscription} — defaults applied, transforms run (ADR-0122). */
export type AppSubscriptionParsed = z.infer<typeof AppSubscriptionSchema>;
export type InstalledAppSummary = z.input<typeof InstalledAppSummarySchema>;
/** Post-parse shape of {@link InstalledAppSummary} — defaults applied, transforms run (ADR-0122). */
export type InstalledAppSummaryParsed = z.infer<typeof InstalledAppSummarySchema>;
export type ListInstalledAppsRequest = z.input<typeof ListInstalledAppsRequestSchema>;
/** Post-parse shape of {@link ListInstalledAppsRequest} — defaults applied, transforms run (ADR-0122). */
export type ListInstalledAppsRequestParsed = z.infer<typeof ListInstalledAppsRequestSchema>;
export type ListInstalledAppsResponse = z.input<typeof ListInstalledAppsResponseSchema>;
/** Post-parse shape of {@link ListInstalledAppsResponse} — defaults applied, transforms run (ADR-0122). */
export type ListInstalledAppsResponseParsed = z.infer<typeof ListInstalledAppsResponseSchema>;
