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
  // `workflow` (Workflow State Machine Engine) retired in #4451 (v17):
  // nothing ever registered or resolved the slot (ADR-0115 Evidence 5), no
  // provider ships in either repository, and the capability is live elsewhere
  // — `state_machine` validation rules, approval flow nodes (ADR-0019),
  // lifecycle hooks + `record_change` flows (service-automation).
  // (Backticks, not quotes: scripts/check-service-providers.mjs reads every
  // quoted token in this block as an enum member, comments included.)
]);

export type CoreServiceName = z.input<typeof CoreServiceName>;

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
  // `null` means "no name belongs in an `Install X` sentence", which covers two
  // different situations — see REMEDY_DETAIL, which is how BOTH of them still
  // get an accurate message.
  //
  //   Nothing provides the slot at all: `search` (no consumer either —
  //   ADR-0115 Evidence 5). Verified across BOTH repositories: nothing in
  //   `objectstack-ai/cloud` registers it. Still true, and since #7541 it is
  //   also no longer the whole story a reader needs: the cross-object
  //   `/search` endpoint is served by the protocol whether or not this slot is
  //   filled, so `search` carries a REMEDY_DETAIL sentence saying which of the
  //   two questions this entry answers.
  //
  //   A provider exists but cannot be installed: `ai`. `@objectstack/service-ai`
  //   registers this slot in `objectstack-ai/cloud` and is `private: true`, so
  //   naming it would send a reader after a package they cannot obtain — the
  //   exact failure this table was written to end. It carries a REMEDY_DETAIL
  //   sentence instead; a bare `null` here would tell a Cloud/Enterprise
  //   deployment that nothing ships, which is false.
  //
  // Two entries left in #4451 (v17). `graphql` was never a `CoreServiceName`
  // — it existed only here and in metadata-protocol's discovery table, naming
  // a `/graphql` surface the dispatcher had already removed as out of the
  // product plan (#2462 follow-on); this table's guard
  // (`scripts/check-service-providers.mjs`) only checks that every SLOT has an
  // entry, never that every entry is a slot, so the stray sat unchallenged.
  // `workflow` retired with its slot — see the CoreServiceName note above.
  'ai':           null,
  'search':       null,
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
 *
 * `search` is the same shape (#7541), reached from the other side. Its
 * capability bit is now derived from what actually serves the endpoint
 * (`protocol.searchAll` — the predicate `registerSearchEndpoints` refuses on)
 * rather than from this slot, so an ordinary REST host reports
 * `capabilities.search.enabled: true` beside `services.search.status:
 * 'unavailable'`. Both are true, and they answer different questions — but the
 * bare "nothing ships" sentence read as "search is dead here", which is exactly
 * how the two halves of one discovery document come to look like they
 * contradict each other. The slot keeps its honest `unavailable`; the message
 * now says which question it is answering.
 */
const REMEDY_DETAIL: Readonly<Record<string, string>> = {
  'ui': 'Served by the protocol service — register MetadataPlugin (@objectstack/metadata-protocol) to enable',
  // Deliberately keeps the generic sentence's "No implementation ships for the
  // 'search' slot" opening: that fact is unchanged, and it is pinned by
  // core-service-provider.test.ts. Everything after it is the disambiguation.
  'search': "No implementation ships for the 'search' slot — a dedicated search engine (Elasticsearch/Meilisearch); "
    + 'register a service under it to enable. Cross-object search does not depend on it: '
    + 'GET {basePath}/search is served by the protocol itself, and whether it is served on this host is '
    + 'reported by capabilities.search — not by this slot.',
  // A provider EXISTS — `@objectstack/service-ai` registers this slot — but it
  // lives in the `objectstack-ai/cloud` repository and is `private: true`, so
  // there is nothing to install and no name that belongs in an "Install X"
  // sentence. Without this entry the `null` above reads as "nothing ships",
  // which is what a Cloud/Enterprise deployment is NOT looking at.
  'ai': 'Provided by @objectstack/service-ai in ObjectStack Cloud/Enterprise — no implementation ships in the open framework',
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
 * The message discovery reports for an occupied slot that is kernel-internal
 * by construction — `cache`, `queue`, `job` (#4318). Their shipped providers
 * (see {@link CORE_SERVICE_PROVIDER}) mount no HTTP routes: the slots are
 * consumed in-process via the service registry, so no route is ever advertised
 * for them (ADR-0076 D12) and `handlerReady` is reported `false` — for these
 * slots it is not a proxy for anything, it is the fact itself.
 *
 * An unmarked occupant still reports `available`: the slot's contract is
 * in-process, so "no HTTP surface" is not reduced capability. Contrast
 * `realtime`, whose advertised capability IS the missing HTTP/WS surface —
 * there an in-process bus reports `degraded`.
 *
 * Written once here so the two discovery builders (`HttpDispatcher` and the
 * metadata-protocol implementation) cannot drift apart — the same reason
 * {@link serviceUnavailableMessage} lives here (#4089, #4130).
 */
export function inProcessServiceMessage(slot: string): string {
  return `Kernel-internal service — consumed in-process via the service registry; no HTTP surface exists for the '${slot}' slot`;
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
export type ServiceCriticality = z.input<typeof ServiceCriticalitySchema>;

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
} as const;

// ==========================================
// Service Capabilities
// ==========================================

/**
 * Describes the availability and health of a kernel service.
 *
 * Named `KernelServiceStatus`, not `ServiceStatus`: `./api` publishes its own
 * `ServiceStatus` — the discovery health **enum** in `api/discovery.zod.ts` —
 * and the two are different concepts (a health value vs this `features`-bearing
 * object). One name for two declarations across two entry points is the
 * #4411 trap `check:dual-source-exports` guards, so the kernel side carries the
 * `Kernel` prefix its sibling `KernelServiceMapSchema` already uses (#6604,
 * maintainer ruling 2026-08-08 Option B).
 */
export const KernelServiceStatusSchema = lazySchema(() => z.object({
  name: CoreServiceName,
  enabled: z.boolean(),
  status: z.enum(['running', 'stopped', 'degraded', 'initializing']),
  version: z.string().optional(),
  provider: z.string().optional().describe('Implementation provider (e.g. "s3" for storage)'),
  features: z.array(z.string()).optional().describe('List of supported sub-features'),
}));
export type KernelServiceStatus = z.input<typeof KernelServiceStatusSchema>;

/**
 * The Contract definition for what the Kernel MUST expose
 * map<ServiceName, ServiceInstance>
 */
export const KernelServiceMapSchema = lazySchema(() => z.record(
  CoreServiceName, 
  z.unknown().describe('Service Instance implementing the protocol interface')
));
export type KernelServiceMap = z.input<typeof KernelServiceMapSchema>;

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
export type ServiceConfig = z.input<typeof ServiceConfigSchema>;
