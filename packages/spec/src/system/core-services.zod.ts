// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Service Registry Protocol
 * 
 * Defines the standard built-in services that constitute the ObjectStack Kernel.
 * This registry is used by the `ObjectKernel` and `HttpDispatcher` to:
 * 1. Verify service availability.
 * 2. Route requests to the correct service handler.
 * 3. Type-check service interactions.
 */

// ==========================================
// Service Identifiers
// ==========================================

import { lazySchema } from '../shared/lazy-schema';
export const CoreServiceName = z.enum([
  // Core Data & Metadata
  'metadata',       // Object/Field Definitions
  'data',           // CRUD & Query Engine
  'auth',           // Authentication & Identity
  
  // Infrastructure
  'file-storage',   // Storage Driver (Local/S3)
  'search',         // Search Engine (Elastic/Meili)
  'cache',          // Cache Driver (Redis/Memory)
  'queue',          // Job Queue (BullMQ/Redis)
  
  // Advanced Capabilities
  'automation',     // Flow & Script Engine
  'analytics',      // BI & Semantic Layer
  'realtime',       // WebSocket & PubSub
  'job',            // Background Job Manager
  'notification',   // Email/Push/SMS
  'ai',             // AI Engine (NLQ, Chat, Suggest, Insights)
  'i18n',           // Internationalization Service
  'ui',             // UI Metadata Service (View CRUD)
  'workflow',       // Workflow State Machine Engine
]);

export type CoreServiceName = z.infer<typeof CoreServiceName>;

/**
 * Which published package actually fills each service slot — or `null` when
 * **nothing ships for it yet**.
 *
 * [#4093 follow-up] Discovery tells a consumer two things about an absent
 * capability: that it is absent, and what to do about it. The first has been
 * carefully honest since #2462/#4000; the second was invented from the slot
 * name. The dispatcher templated `Install a ${slot} plugin to enable` for 12
 * slots, and metadata-protocol carried a hand-written table in which **ten of
 * fifteen** names did not exist (`plugin-redis`, `plugin-bullmq`,
 * `job-scheduler`, `plugin-notifications`, `plugin-storage`, `ui-plugin`,
 * `plugin-automation`, and `plugin-ai` / `plugin-search` / `plugin-workflow`
 * for slots nothing implements). That value is also surfaced as `provider`.
 *
 * A remedy naming a package that cannot be installed is a dead end handed to
 * someone at the exact moment they are trying to fix their stack — the same
 * `declared ≠ enforced` failure this lineage has been closing, one level over:
 * not "does the capability exist" but "is the fix real". An agent reading
 * discovery cannot tell the difference between a package it should install and
 * one that was never written.
 *
 * Entries are verified against what actually calls `registerService` for the
 * slot, not against name similarity, and `scripts/check-service-providers.mjs`
 * fails CI if any name here is not a real workspace package — so a rename or a
 * deletion cannot leave a stale instruction behind.
 *
 * `null` is a first-class answer, not a gap: for those slots the honest remedy
 * is "nothing to install", and saying so beats naming a plausible package.
 */
export const CORE_SERVICE_PROVIDER: Readonly<Record<string, string | null>> = {
  // Verified: each of these registers the slot itself.
  'analytics':    '@objectstack/service-analytics',
  'auth':         '@objectstack/plugin-auth',
  'automation':   '@objectstack/service-automation',
  'cache':        '@objectstack/service-cache',
  'queue':        '@objectstack/service-queue',
  'job':          '@objectstack/service-job',
  'realtime':     '@objectstack/service-realtime',
  'file-storage': '@objectstack/service-storage',
  'i18n':         '@objectstack/service-i18n',
  // The `notification` slot is filled by the messaging service — the one entry
  // whose package name shares no word with its slot, and the reason a
  // name-derived guess cannot be right in general.
  'notification': '@objectstack/service-messaging',
  // `/ui` is served by the `protocol` service, which MetadataPlugin registers;
  // the `ui` slot itself has no implementation anywhere (#4093 / #4146).
  'ui':           '@objectstack/metadata-protocol',
  // Nothing ships for these. `search` and `workflow` have no consumer either
  // (ADR-0115 Evidence 5); `graphql` and `ai` have surfaces but no provider.
  'ai':           null,
  'search':       null,
  'workflow':     null,
  'graphql':      null,
} as const;

/**
 * Slots whose remedy needs more than "install X", because **the slot is not
 * what serves the capability**. `Install <pkg>` would be true but misleading:
 * it reads as "this package fills this slot", and someone who then checks
 * discovery still sees the slot empty.
 *
 * `/ui` is the case (#4146): it is served by the `protocol` service, and
 * nothing anywhere registers `ui` — so the sentence has to say what actually
 * serves it, not just what to install.
 */
const REMEDY_DETAIL: Readonly<Record<string, string>> = {
  'ui': 'Served by the protocol service — register MetadataPlugin (@objectstack/metadata-protocol) to enable',
};

/**
 * The remedy line discovery reports for an unavailable slot — the one place
 * that sentence is written, so the dispatcher and the metadata-protocol
 * builder cannot tell a consumer to install different things (the drift #4089
 * and #4130 closed for the `metadata` and `data` entries).
 *
 * See {@link CORE_SERVICE_PROVIDER}.
 */
export function serviceUnavailableMessage(slot: string): string {
  const detail = REMEDY_DETAIL[slot];
  if (detail) return detail;
  const pkg = CORE_SERVICE_PROVIDER[slot];
  return pkg
    ? `Install ${pkg} to enable`
    : `No implementation ships for the '${slot}' slot — register a service under it to enable`;
}

/**
 * Service Criticality Level
 * Defines the startup behavior when a service is missing.
 */
export const ServiceCriticalitySchema = lazySchema(() => z.enum([
  'required', // System fails to start if missing (Exit Code 1)
  'core',     // System warns if missing, functionality degraded (Warn)
  'optional', // System ignores if missing, feature disabled (Info)
]));

/**
 * Service Requirement Definition
 */
export const ServiceRequirementDef = {
  // Required: The kernel cannot function without these
  data: 'required',

  // Core: Highly recommended, defaults to in-memory / no-op if missing
  metadata: 'core',
  auth: 'core',

  // Core: Highly recommended, defaults to in-memory / no-op if missing
  cache: 'core',
  queue: 'core',
  job: 'core',
  i18n: 'core',

  // Optional: Add-on capabilities
  'file-storage': 'optional',
  search: 'optional',
  automation: 'optional',
  analytics: 'optional',
  realtime: 'optional',
  notification: 'optional',
  ai: 'optional',
  ui: 'optional',
  workflow: 'optional',
} as const;

// ==========================================
// Service Capabilities
// ==========================================

/**
 * Describes the availability and health of a service
 */
export const ServiceStatusSchema = lazySchema(() => z.object({
  name: CoreServiceName,
  enabled: z.boolean(),
  status: z.enum(['running', 'stopped', 'degraded', 'initializing']),
  version: z.string().optional(),
  provider: z.string().optional().describe('Implementation provider (e.g. "s3" for storage)'),
  features: z.array(z.string()).optional().describe('List of supported sub-features'),
}));

/**
 * The Contract definition for what the Kernel MUST expose
 * map<ServiceName, ServiceInstance>
 */
export const KernelServiceMapSchema = lazySchema(() => z.record(
  CoreServiceName, 
  z.unknown().describe('Service Instance implementing the protocol interface')
));

// ==========================================
// Service Interfaces (Stub definitions)
// ==========================================
// Ideally, we would define strict Typescript interfaces here 
// for what methods each service must expose to the Registry.
// For Zod, we primarily validate configuration and status.

// e.g.
export const ServiceConfigSchema = lazySchema(() => z.object({
  id: z.string(),
  name: CoreServiceName,
  options: z.record(z.string(), z.unknown()).optional(),
}));
