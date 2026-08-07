// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # API Versioning Protocol
 * 
 * Defines how API versions are negotiated between client and server.
 * Supports multiple versioning strategies and deprecation lifecycle management.
 * 
 * Architecture Alignment:
 * - Salesforce: URL path versioning (v57.0, v58.0)
 * - Stripe: Date-based versioning (2024-01-01)
 * - Kubernetes: API group versioning (v1, v1beta1)
 * - GitHub: Accept header versioning (application/vnd.github.v3+json)
 * - Microsoft Graph: URL path versioning (v1.0, beta)
 */

// ==========================================
// Versioning Strategy
// ==========================================

/**
 * API Versioning Strategy
 * Determines how the API version is specified by clients.
 * 
 * - `urlPath`: Version in URL path (e.g., /api/v1/data) — Most common, easy to understand
 * - `header`: Version in Accept header (e.g., Accept: application/vnd.objectstack.v1+json)
 * - `queryParam`: Version in query parameter (e.g., /api/data?version=v1)
 * - `dateBased`: Date-based version in header (e.g., ObjectStack-Version: 2025-01-01) — Stripe-style
 */
import { lazySchema } from '../shared/lazy-schema';
export const VersioningStrategy = z.enum([
  'urlPath',
  'header',
  'queryParam',
  'dateBased',
]);

export type VersioningStrategy = z.infer<typeof VersioningStrategy>;

// ==========================================
// Version Lifecycle
// ==========================================

/**
 * API Version Status
 * Lifecycle state of an API version.
 * 
 * - `preview`: Available for testing, may change without notice (e.g., v2beta1)
 * - `current`: The recommended stable version
 * - `supported`: Older but still maintained (receives security fixes)
 * - `deprecated`: Scheduled for removal, clients should migrate
 * - `retired`: No longer available, requests return 410 Gone
 */
export const VersionStatus = z.enum([
  'preview',
  'current',
  'supported',
  'deprecated',
  'retired',
]);

export type VersionStatus = z.infer<typeof VersionStatus>;

// ==========================================
// Version Definition
// ==========================================

/**
 * API Version Definition Schema
 * Describes a single API version and its lifecycle metadata.
 * 
 * @example
 * {
 *   "version": "v1",
 *   "status": "current",
 *   "releasedAt": "2025-01-15",
 *   "description": "Initial stable release"
 * }
 * 
 * @example Deprecated version
 * {
 *   "version": "v0",
 *   "status": "deprecated",
 *   "releasedAt": "2024-06-01",
 *   "deprecatedAt": "2025-01-15",
 *   "sunsetAt": "2025-07-15",
 *   "migrationGuide": "https://docs.objectstack.dev/migrate/v0-to-v1",
 *   "description": "Legacy API version"
 * }
 */
export const VersionDefinitionSchema = lazySchema(() => z.object({
  /** Version identifier (e.g., "v1", "v2beta1", "2025-01-01") */
  version: z.string().describe('Version identifier (e.g., "v1", "v2beta1", "2025-01-01")'),

  /** Current lifecycle status */
  status: VersionStatus.describe('Lifecycle status of this version'),

  /** Date this version was released (ISO 8601 date) */
  releasedAt: z.string().describe('Release date (ISO 8601, e.g., "2025-01-15")'),

  /** Date this version was deprecated (ISO 8601 date) */
  deprecatedAt: z.string().optional()
    .describe('Deprecation date (ISO 8601). Only set for deprecated/retired versions'),

  /** Date this version will be retired (ISO 8601 date) */
  sunsetAt: z.string().optional()
    .describe('Sunset date (ISO 8601). After this date, the version returns 410 Gone'),

  /** URL to migration guide for moving to a newer version */
  migrationGuide: z.string().url().optional()
    .describe('URL to migration guide for upgrading from this version'),

  /** Human-readable description of this version */
  description: z.string().optional()
    .describe('Human-readable description or release notes summary'),

  /** Breaking changes introduced in or since this version */
  breakingChanges: z.array(z.string()).optional()
    .describe('List of breaking changes (for preview/new versions)'),
}));

export type VersionDefinition = z.infer<typeof VersionDefinitionSchema>;

// ==========================================
// Versioning Configuration
// ==========================================

/**
 * API Versioning Configuration Schema
 * Complete configuration for API version management.
 * 
 * @example
 * {
 *   "strategy": "urlPath",
 *   "current": "v1",
 *   "default": "v1",
 *   "versions": [
 *     { "version": "v1", "status": "current", "releasedAt": "2025-01-15" },
 *     { "version": "v2beta1", "status": "preview", "releasedAt": "2025-06-01" }
 *   ],
 *   "deprecation": {
 *     "warnHeader": true,
 *     "sunsetHeader": true
 *   }
 * }
 */
export const VersioningConfigSchema = lazySchema(() => z.object({
  /** Versioning strategy */
  strategy: VersioningStrategy.default('urlPath')
    .describe('How the API version is specified by clients'),

  /** Current (recommended) API version */
  current: z.string().describe('The current/recommended API version identifier'),

  /** Default version when none specified by client */
  default: z.string().describe('Fallback version when client does not specify one'),

  /** All available API versions */
  versions: z.array(VersionDefinitionSchema)
    .min(1)
    .describe('All available API versions with lifecycle metadata'),

  /** Header name for header-based versioning */
  headerName: z.string().default('ObjectStack-Version')
    .describe('HTTP header name for version negotiation (header/dateBased strategies)'),

  /** Query parameter name for queryParam strategy */
  queryParamName: z.string().default('version')
    .describe('Query parameter name for version specification (queryParam strategy)'),

  /** URL prefix pattern for urlPath strategy */
  urlPrefix: z.string().default('/api')
    .describe('URL prefix before version segment (urlPath strategy)'),

  /** Deprecation behavior */
  deprecation: z.object({
    /** Include Deprecation header in responses for deprecated versions */
    warnHeader: z.boolean().default(true)
      .describe('Include Deprecation header (RFC 8594) in responses'),

    /** Include Sunset header with retirement date */
    sunsetHeader: z.boolean().default(true)
      .describe('Include Sunset header (RFC 8594) with retirement date'),

    /** Include Link header pointing to migration guide */
    linkHeader: z.boolean().default(true)
      .describe('Include Link header pointing to migration guide URL'),

    /** Whether to reject requests to retired versions */
    rejectRetired: z.boolean().default(true)
      .describe('Return 410 Gone for retired API versions'),

    /** Custom deprecation warning message */
    warningMessage: z.string().optional()
      .describe('Custom warning message for deprecated version responses'),
  }).optional().describe('Deprecation lifecycle behavior'),

  /** Whether to include version info in discovery response */
  includeInDiscovery: z.boolean().default(true)
    .describe('Include version information in the API discovery endpoint'),
}));

export type VersioningConfig = z.infer<typeof VersioningConfigSchema>;
/** Post-parse shape of {@link VersioningConfig} — defaults applied, transforms run (ADR-0122). */
export type VersioningConfigParsed = z.infer<typeof VersioningConfigSchema>;
export type VersioningConfigInput = z.input<typeof VersioningConfigSchema>;

// ==========================================
// Version Negotiation Response
// ==========================================

/**
 * Version Negotiation Response Schema
 * Returned when a client requests version information or
 * included in the discovery endpoint response.
 * 
 * @example
 * {
 *   "current": "v1",
 *   "requested": "v1",
 *   "resolved": "v1",
 *   "supported": ["v1", "v2beta1"],
 *   "deprecated": ["v0"],
 *   "versions": [...]
 * }
 */
export const VersionNegotiationResponseSchema = lazySchema(() => z.object({
  /** The current/recommended version */
  current: z.string().describe('Current recommended API version'),

  /** The version the client requested (if any) */
  requested: z.string().optional().describe('Version requested by the client'),

  /** The version actually being used for this request */
  resolved: z.string().describe('Resolved API version for this request'),

  /** All supported (non-retired) version identifiers */
  supported: z.array(z.string()).describe('All supported version identifiers'),

  /** Deprecated version identifiers (still functional but will be removed) */
  deprecated: z.array(z.string()).optional()
    .describe('Deprecated version identifiers'),

  /** Full version definitions (optional, for detailed clients) */
  versions: z.array(VersionDefinitionSchema).optional()
    .describe('Full version definitions with lifecycle metadata'),
}));

export type VersionNegotiationResponse = z.infer<typeof VersionNegotiationResponseSchema>;

// ==========================================
// Default Versioning Configuration
// ==========================================

/**
 * Default versioning configuration for ObjectStack.
 * Uses URL path strategy with v1 as the current/default version.
 */
export const DEFAULT_VERSIONING_CONFIG: VersioningConfigInput = {
  strategy: 'urlPath',
  current: 'v1',
  default: 'v1',
  versions: [
    {
      version: 'v1',
      status: 'current',
      releasedAt: '2025-01-15',
      description: 'ObjectStack API v1 — Initial stable release',
    },
  ],
  deprecation: {
    warnHeader: true,
    sunsetHeader: true,
    linkHeader: true,
    rejectRetired: true,
  },
  includeInDiscovery: true,
};
