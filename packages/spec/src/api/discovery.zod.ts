// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod } from '../shared/http.zod';
// [#6287] Type-only: erased at compile time, so this carries no runtime edge
// from `api/` to `cloud/`. It is what makes the NODE_ENV fold table provably
// total over the environment taxonomy rather than total by inspection.
import type { EnvironmentType } from '../cloud/environment.zod';

/**
 * Service Status Enum
 * Describes the operational state of a service in the discovery response.
 *
 * - `available`   – Fully operational: service is registered AND HTTP handler is verified.
 * - `registered`  – Route is declared in the dispatcher table but the HTTP handler has
 *                   not been verified (may 501 at runtime).
 * - `unavailable` – Service is not installed / not registered in the kernel.
 * - `degraded`    – Partially working (e.g., in-memory fallback, missing persistence).
 * - `stub`        – Placeholder handler that always returns 501 Not Implemented.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ServiceStatus = z.enum([
  'available',
  'registered',
  'unavailable',
  'degraded',
  'stub',
]).describe(
  'available = fully operational, registered = route declared but handler unverified, '
  + 'unavailable = not installed, degraded = partial, stub = placeholder that returns 501'
);

export type ServiceStatus = z.input<typeof ServiceStatus>;

/**
 * Service Status in Discovery Response
 * Reports per-service availability so clients can adapt their UI accordingly.
 */
export const ServiceInfoSchema = lazySchema(() => z.object({
  /** Whether the service is enabled and available */
  enabled: z.boolean(),
  /** Current operational status */
  status: ServiceStatus,
  /**
   * Whether the HTTP handler for this service is confirmed to be mounted.
   *
   * Semantics:
   * - `undefined` (omitted) = handler readiness is unknown / not yet verified.
   * - `true`                = handler is registered in the adapter / dispatcher (safe to call).
   * - `false`               = route is declared but no handler exists or only a stub is present
   *                            — requests are expected to receive 501 Not Implemented.
   *
   * Clients SHOULD check this flag before displaying or invoking a service endpoint and may
   * distinguish between "unknown" (omitted) and "known missing" (`false`).
   */
  handlerReady: z.boolean().optional().describe(
    'Whether the HTTP handler is confirmed to be mounted. '
    + 'Omitted = readiness unknown/unverified; true = handler mounted; false = handler missing or stub (likely 501).'
  ),
  /** Route path (only present if enabled) */
  route: z.string().optional().describe('e.g. /api/v1/analytics'),
  /** Implementation provider name */
  provider: z.string().optional().describe('e.g. "objectql", "plugin-redis", "driver-memory"'),
  /** Service version */
  version: z.string().optional().describe('Semantic version of the service implementation (e.g. "3.0.6")'),
  /** Human-readable reason if unavailable */
  message: z.string().optional().describe('e.g. "Install plugin-workflow to enable"'),
  /** Rate limit configuration for this service */
  rateLimit: z.object({
    requestsPerMinute: z.number().int().optional().describe('Maximum requests per minute'),
    requestsPerHour: z.number().int().optional().describe('Maximum requests per hour'),
    burstLimit: z.number().int().optional().describe('Maximum burst request count'),
    retryAfterMs: z.number().int().optional().describe('Suggested retry-after delay in milliseconds when rate-limited'),
  }).optional().describe('Rate limit and quota info for this service'),
}));

// ============================================================================
// Honest capabilities — service self-description marker (ADR-0076 D12, #2462)
// ============================================================================

/**
 * Well-known property name a registered kernel service can carry to
 * self-identify as a stub / dev-fake / degraded fallback.
 *
 * Discovery builders MUST read this marker (via {@link readServiceSelfInfo})
 * and report the declared status instead of hardcoding `available` — a stub
 * or fallback that reports `status: 'available'` misleads consumers (AI
 * agents, the console) into treating a fake capability as real.
 */
export const SERVICE_SELF_INFO_KEY = '__serviceInfo' as const;

/**
 * Shape of the {@link SERVICE_SELF_INFO_KEY} marker a service carries to
 * describe its own honesty level. Only non-`available` self-reports exist:
 * a service that is fully real simply carries no marker.
 */
export const ServiceSelfInfoSchema = lazySchema(() => z.object({
  /** Declared honesty level: `stub` = placeholder/fake, `degraded` = working but partial fallback */
  status: z.enum(['stub', 'degraded']).describe(
    'stub = placeholder or dev fake (do not use for real work); '
    + 'degraded = functional fallback with reduced capability'
  ),
  /**
   * Whether the service's HTTP handler genuinely serves requests.
   * Defaults (when omitted): `false` for `stub`, `true` for `degraded`.
   */
  handlerReady: z.boolean().optional().describe(
    'Whether the HTTP handler genuinely serves requests. Defaults: false for stub, true for degraded.'
  ),
  /** Human-readable explanation shown in discovery (e.g. what to install for the real thing) */
  message: z.string().optional().describe('Human-readable explanation, e.g. what to install for the full implementation'),
}));

export type ServiceSelfInfo = z.input<typeof ServiceSelfInfoSchema>;

/**
 * Reads the standardized self-description marker off a registered service
 * instance (ADR-0076 D12). Returns `undefined` for services that carry no
 * marker — i.e. services claiming to be fully real.
 *
 * Reads exactly one marker: `svc[SERVICE_SELF_INFO_KEY]`, the
 * `{ status, handlerReady?, message? }` descriptor.
 *
 * There were once three. `_fallback: true` (the kernel's in-memory fallbacks)
 * was recognized by nothing, so discovery reported those as fully `available`
 * — the honesty gap D12 exists to close; `_dev: true` (plugin-dev's stub
 * table) was normalized here to `{ status: 'stub', handlerReady: false }`.
 * Both were retired by moving their producers onto this descriptor rather than
 * by teaching this function more dialects (#4082, ADR-0115): one marker that
 * says WHICH kind of unreal a service is beats N markers that only say "unreal"
 * — `degraded` (really serves, reduced capability) and `stub` (fabricates) are
 * the distinction every consumer actually gates on, and a boolean cannot carry
 * it. A service still carrying a retired marker reads as unmarked here, i.e.
 * as fully real — migrate it (see the CHANGELOG entry for the mapping).
 */
export function readServiceSelfInfo(svc: unknown): ServiceSelfInfo | undefined {
  if (!svc || typeof svc !== 'object') return undefined;
  const self = (svc as Record<string, unknown>)[SERVICE_SELF_INFO_KEY] as Record<string, unknown> | undefined;
  if (self && typeof self === 'object' && (self.status === 'stub' || self.status === 'degraded')) {
    return {
      status: self.status,
      handlerReady: typeof self.handlerReady === 'boolean'
        ? self.handlerReady
        : self.status === 'degraded',
      ...(typeof self.message === 'string' ? { message: self.message } : {}),
    };
  }
  return undefined;
}

/**
 * API Routes Schema
 * The "Map" for the frontend to know where to send requests.
 * This decouples the frontend from hardcoded URL paths.
 */
export const ApiRoutesSchema = lazySchema(() => z.object({
  /** Base URL for Object CRUD (Data Protocol) */
  data: z.string().describe('e.g. /api/v1/data'),
  
  /** Base URL for Schema Definitions (Metadata Protocol) */
  metadata: z.string().describe('e.g. /api/v1/meta'),

  /** Base URL for API Discovery endpoint */
  discovery: z.string().optional().describe('e.g. /api/v1/discovery'),

  /** Base URL for UI Configurations (Views, Menus) */
  ui: z.string().optional().describe('e.g. /api/v1/ui'),
  
  /** Base URL for Authentication (plugin-provided) */
  auth: z.string().optional().describe('e.g. /api/v1/auth'),
  
  /** Base URL for Automation (Flows/Scripts) */
  automation: z.string().optional().describe('e.g. /api/v1/automation'),
  
  /** Base URL for File/Storage operations */
  storage: z.string().optional().describe('e.g. /api/v1/storage'),
  
  /** Base URL for Analytics/BI operations */
  analytics: z.string().optional().describe('e.g. /api/v1/analytics'),
  

  /** Base URL for Package Management */
  packages: z.string().optional().describe('e.g. /api/v1/packages'),

  /**
   * Base URL for the datasource federation-admin family — the base under
   * which the external-datasource routes (`{datasources}/:name/external/*`,
   * ADR-0015 §6.2: tables / draft / import / refresh-catalog / validate) are
   * mounted.
   *
   * Declared by #6633 (route B toward #6306): the SDK's
   * `datasources.external.*` methods hard-coded `/api/v1/datasources` with no
   * discovery mechanism at all, so any deployment on a non-default base
   * (`apiPath`, or a programmatic `basePath`/`version`) had the whole family
   * pinned to a convention the server had moved away from. With the key
   * declared, a host that mounts the family advertises WHERE, and the SDK
   * follows — falling back to the `/api/v1/datasources` convention when
   * unadvertised.
   *
   * `optional`, not `nullable` — same reasoning as `mcp`: the key is ABSENT
   * when no federation surface is mounted. The runtime dispatcher serves no
   * `/datasources` domain, so it must never advertise one (ADR-0076 D12), and
   * the `getDiscovery()` builder in `metadata-protocol` emits nothing here
   * either — the mount belongs to the REST host, which that builder cannot
   * see. The one producer that CAN answer truthfully is the REST discovery
   * endpoint, which derives the value from its recorded direct mounts.
   */
  datasources: z.string().optional().describe(
    'e.g. /api/v1/datasources — base for the datasources/:name/external/* federation-admin family; '
    + 'absent when no host mounts it'
  ),

  /**
   * Base URL for the transactional-email surface — the base under which
   * `POST {email}/send` is mounted.
   *
   * Declared by #6714 (replicating the #6633 / `datasources` precedent): the
   * SDK's `email.send` hard-coded `/api/v1/email/send`, while the REST
   * server's `registerEmailEndpoints` mounts under `getApiBasePath()` and
   * therefore already follows `apiPath` — so on any `apiPath` deployment the
   * stock client's email.send was a live 404, not a latent gap. With the key
   * declared, the host that mounts the surface advertises WHERE, and the SDK
   * follows — falling back to the `/api/v1/email` convention when
   * unadvertised.
   *
   * `optional`, not `nullable` — same reasoning as `datasources`: the key is
   * ABSENT when no email surface is mounted. The runtime dispatcher serves no
   * `/email` domain, so it must never advertise one (ADR-0076 D12), and the
   * `getDiscovery()` builder in `metadata-protocol` emits nothing here either
   * — the mount belongs to the REST host, which that builder cannot see. The
   * one producer that CAN answer truthfully is the REST discovery endpoint,
   * which projects the value from its recorded route registrations.
   */
  email: z.string().optional().describe(
    'e.g. /api/v1/email — base for the email/send endpoint; absent when no host mounts it'
  ),

  // `workflow` was removed here (#4451, v17): no host ever mounted a workflow
  // surface and nothing ever registered the slot (ADR-0115 Evidence 5), so no
  // builder could truthfully populate the field. State machines are enforced
  // by the `state_machine` validation rule; approvals live below.

  /** Base URL for Approvals (ADR-0019: approval as a flow node) */
  approvals: z.string().optional().describe('e.g. /api/v1/approvals'),

  /** Base URL for Realtime (WebSocket/SSE) */
  realtime: z.string().optional().describe('e.g. /api/v1/realtime'),

  /** Base URL for Notification Service */
  notifications: z.string().optional().describe('e.g. /api/v1/notifications'),

  /** Base URL for AI Engine (NLQ, Chat, Suggest) */
  ai: z.string().optional().describe('e.g. /api/v1/ai'),

  /** Base URL for Internationalization */
  i18n: z.string().optional().describe('e.g. /api/v1/i18n'),

  /**
   * Base URL for the MCP (Model Context Protocol) Streamable-HTTP surface.
   *
   * Declared by #5679 — the #4828 defect one level down, and the opposite
   * disposition to the `endpoints` key that issue deleted. `endpoints` had no
   * measured reader, so it was retired; `mcp` has two real ones in `objectui`
   * (`ConnectAgentWidget.tsx` gates the Integrations connect card on it, and
   * `AgentConnectSection.tsx` reads it for the same card) — in fact it is the
   * ONLY `routes.*` key anything in objectui reads. So the fix is to declare
   * it, not to remove it.
   *
   * Why it was a real defect and not just tidiness: `ApiRoutesSchema` is a
   * plain `z.object`, which STRIPS unknown keys. Any consumer that parsed
   * `/discovery` through the spec dropped `routes.mcp` silently and blanked
   * the connect card with no error. Nothing broke only because those two
   * readers happen to read raw JSON. Both producers emitted it through the
   * blind spot: `@objectstack/rest` behind an `as any` cast (removed with this
   * declaration — that cast was the compiler telling the truth), and the
   * runtime dispatcher's `getDiscoveryInfo()` inside an untyped object literal.
   *
   * Shape as MEASURED off both producers, not as guessed:
   *
   * - a plain path string, e.g. `/api/v1/mcp`;
   * - always the UNSCOPED base — `/mcp` is mounted bare, so a scoped mount
   *   that advertises `/api/v1/environments/env_alpha/data` still advertises
   *   `/api/v1/mcp` here;
   * - `optional`, not `nullable`: the key is ABSENT when the surface is not
   *   advertised. rest-server `delete`s it when `OS_MCP_SERVER_ENABLED` is off
   *   or the serveability probe returns `false` (#4024); the dispatcher leaves
   *   it `undefined`, which `JSON.stringify` drops on the wire. Neither ever
   *   emits `null`.
   *
   * Optional also because a producer may legitimately not know: the
   * `getDiscovery()` builder in `metadata-protocol` sees neither the host's
   * route table nor the kernel's mcp service, so it emits nothing here rather
   * than inventing a value — the same reasoning as `scoping` above.
   *
   * @see ADR-0036 (MCP as a first-class surface)
   */
  mcp: z.string().optional().describe('e.g. /api/v1/mcp — always the unscoped base; absent when MCP is disabled or unserveable'),
}));

/**
 * Discovery Response Schema
 * The root object returned by the Metadata Discovery Endpoint.
 * 
 * Design rationale:
 * - `services` is the single source of truth for service availability.
 *   Each service entry includes `enabled`, `status`, `route`, and `provider`.
 * - `routes` is a convenience shortcut: a flat map of service-name → route-path
 *   so that clients can resolve endpoints without iterating the services map.
 * - `capabilities` is the ONE canonical name for the hierarchical capability
 *   map (#4828, maintainer ruling 2026-08-05). A top-level `features` key was
 *   emitted by the runtime dispatcher for a while and was never declared here;
 *   it is retired — see {@link DiscoverySchema} `capabilities` below. Note the
 *   surviving `features` is the SUB-key *inside* a capability entry
 *   (`capabilities.<domain>.features`), which is declared and stays.
 *
 * **This schema is authoritative for every producer** (#4828). Both the
 * `@objectstack/rest` `/discovery` endpoint and the runtime dispatcher's
 * `getDiscoveryInfo()` must satisfy it — required keys included. It is a
 * machine-readable surface (AGENTS.md "Route & surface ownership" #4: it must
 * not lie), so the gate is `DiscoverySchema.parse()` against each producer's
 * LIVE shape, plus a key-set check that nothing undeclared is emitted. Those
 * gates live next to each producer:
 * `packages/metadata-protocol/src/discovery-schema-conformance.test.ts`,
 * `packages/runtime/src/discovery-schema-conformance.test.ts` and
 * `packages/rest/src/discovery-schema-conformance.test.ts`.
 *
 * Why they were needed at all: the only schema the protocol layer referenced
 * was `GetDiscoveryResponseSchema` (`./protocol.zod.ts`), which is this schema
 * `.partial()`-ed — so missing required keys parsed clean — and a zod object
 * strips unknown keys by default — so undeclared keys parsed clean too. Both
 * halves of `declared ≠ enforced` were swallowed by one lenient wrapper.
 */
export const DiscoveryEnvironmentSchema = lazySchema(() => z
  .enum(['production', 'sandbox', 'development'])
  .describe(
    'Deployment posture a discovery response advertises. Deliberately three coarse buckets — '
    + 'a client reads this to answer "am I talking to production?", not to identify a specific '
    + 'environment (that is `sys_environment` / EnvironmentTypeSchema, a richer 7-member taxonomy).'
  ));

export type DiscoveryEnvironment = z.input<typeof DiscoveryEnvironmentSchema>;

/**
 * `NODE_ENV` spellings accepted for each declared discovery environment (#4828).
 *
 * `DiscoverySchema.environment` is an enum, and the runtime dispatcher used to
 * pass `NODE_ENV` through raw — so `NODE_ENV=test` (what vitest sets) or
 * `staging` advertised a value outside the declared enum on a machine-readable
 * surface. The maintainer's 2026-08-05 ruling requires every producer's value
 * to land inside the enum, with the disposition of the out-of-enum spellings
 * left to this layer and documented.
 *
 * Normalizing `NODE_ENV` here is the same move `NODE_ENV_TO_SEED_ENV` already
 * makes in `packages/metadata-protocol/src/seed-loader.ts`: `NODE_ENV` is an
 * OPERATOR-supplied variable at a third-party boundary (Prime Directive #9
 * lists it as exactly that), so normalizing its spellings is not the
 * consumer-side tolerance PD #12 forbids — that rule governs OUR OWN metadata
 * contract, and this is the far side of it. The `prod`/`dev` short spellings
 * are accepted for the same reason they are there: an operator who exported
 * `NODE_ENV=prod` gets what they meant rather than an indeterminate answer.
 *
 * The mapping, and why each row:
 *
 * | `NODE_ENV`              | advertised     | why |
 * |:------------------------|:---------------|:----|
 * | `production`, `prod`    | `production`   | exact / short spelling |
 * | `sandbox`               | `sandbox`      | exact |
 * | `development`, `dev`    | `development`  | exact / short spelling |
 * | `test`                  | `development`  | ephemeral developer-class run (vitest/CI), not a provisioned pre-production copy |
 * | `staging`               | `sandbox`      | pre-production and production-LIKE; certainly not `production`, and `sandbox` is the enum's pre-production member |
 * | `preview`               | `sandbox`      | a PROVISIONED environment (own database, hostname, plan tier, per-environment RBAC), not a developer's machine — same class as `staging` (#6287) |
 * | `trial`                 | `sandbox`      | a provisioned environment holding an evaluating customer's real business data; developer-class would understate it (#6287) |
 * | unset / blank           | `production`   | the host declined to say; every other reader of that absence already says `production`, and of the two ways to be wrong, calling a real production deployment `development` is the dangerous one (#5673, #5936) |
 * | anything else           | `development`  | an unrecognised spelling is a GUESS, and this function never claims `production` on a guess (#4828) |
 *
 * The last two rows carry the whole safety argument, and they point opposite
 * ways on purpose. An unrecognised spelling (`qa`, `uat`) degrades to
 * `development`, so nothing here ever advertises `production` for an
 * environment it failed to recognise. **Absence is not a guess** — it is the
 * host declining to answer, and the conservative response to that is
 * `production`: `environment` is machine-readable, and a client may skip
 * production warnings or loosen a destructive action's confirmation on it.
 *
 * ## `preview` and `trial` are a THIRD case — declared, not absent, not a guess (#6287)
 *
 * Until #6287 those two reached `development` through the `??` fallback rather
 * than through a decision, so this table declared five of the seven
 * `EnvironmentTypeSchema` members and let the other two fall off the end. That
 * is the same shape the two rows above exist to separate: the fallback answers
 * for spellings this repo has never heard of, and a first-class member of our
 * OWN taxonomy is not one of those. It is neither the host declining to answer
 * nor a guess — it is a bucket we ship, and where it folds is ours to state.
 *
 * Both fold to `sandbox`, and the reasoning is the same for each:
 *
 * 1. **What they are here.** In this repo's taxonomy an environment is a
 *    provisioned runtime container — isolated database, canonical hostname,
 *    plan tier, per-environment RBAC (`cloud/environment.zod.ts`). A `preview`
 *    or `trial` environment is that, not an ephemeral developer-class run. The
 *    `development` bucket is reserved for the machine-and-CI class (`development`,
 *    `dev`, `test`); `sandbox` is the enum's provisioned pre-production member,
 *    which is what these two are.
 * 2. **Posture, in the tightening direction.** `trial` in particular holds an
 *    evaluating customer's real business data. `environment` is read to decide
 *    whether to soften a destructive action's confirmation, so answering
 *    `development` there understates the posture — the same *kind* of error the
 *    unset row was flipped to avoid (#5673, #5936), one bucket down. Neither is
 *    `production`: they are by definition not the customer's production
 *    deployment, and claiming otherwise would make the flag's one question
 *    ("am I talking to production?") answer wrongly in the other direction.
 * 3. **It keeps the author's distinction.** An operator who tags an environment
 *    `preview` had `development` and `test` available and did not pick them.
 *    Folding `preview` onto `development` erases the only information that
 *    choice carried; folding it onto `sandbox` preserves it as far as a
 *    three-member enum can.
 *
 * The unset row moved from `development` to `production` in #5673 (maintainer
 * ruling 2026-08-06) and moved HERE, into the shared mapper, in #5936 (ruling
 * 2026-08-07, direction 1). #5673 could only reach its own producer — the
 * runtime dispatcher, which flipped the default at its call site — so the
 * second producer (`getDiscovery()` in `@objectstack/metadata-protocol`, served
 * by `@objectstack/rest`) went on passing a genuinely absent `NODE_ENV` in and
 * answering `development`. One default in one place is what stops that: a
 * producer cannot forget to copy a line it never has to write, so the next
 * discovery producer inherits the right answer.
 *
 * "Unset" includes a **blank** value, not only an absent one. `NODE_ENV=`
 * exports an empty string, and the runtime's `getEnv('NODE_ENV', …)` has always
 * folded that into its default (it tests with `||`). Had this treated blank as
 * "anything else" the two producers would have drifted again on exactly that
 * input — the drift this consolidation exists to end.
 *
 * ## The taxonomy half of this table is EXHAUSTIVE, and tsc keeps it so (#6287)
 *
 * The seven `EnvironmentTypeSchema` rows are grouped behind a
 * `satisfies Record<EnvironmentType, DiscoveryEnvironment>`: adding a bucket to
 * that enum without deciding where it folds does not compile, and a key that is
 * not a member does not compile either. The operator shorthands (`prod`, `dev`)
 * sit outside that group precisely so the check stays writable — they are
 * convenience spellings, not members.
 *
 * It is a COMPILE-time check rather than a runtime assertion because a runtime
 * one cannot see this defect: the fallback and three of the seven rows all
 * produce `'development'`, so calling `resolveDiscoveryEnvironment` returns an
 * indistinguishable answer whether a row exists or the `??` invented it. A
 * runtime exhaustiveness test would have passed on the exact state #6287
 * reported. `tsc` compares the KEY SET, which is the actual claim. The negative
 * control for it lives in `discovery.test.ts`.
 */
const NODE_ENV_TO_DISCOVERY_ENVIRONMENT: Readonly<Record<string, DiscoveryEnvironment>> = {
  // The seven declared `EnvironmentTypeSchema` buckets. The `satisfies` is the
  // gate described above: every member must appear, and nothing that is not a
  // member may (#6287).
  ...({
    production: 'production',
    sandbox: 'sandbox',
    development: 'development',
    test: 'development',
    staging: 'sandbox',
    preview: 'sandbox',
    trial: 'sandbox',
  } satisfies Record<EnvironmentType, DiscoveryEnvironment>),

  // Operator convenience spellings — deliberately OUTSIDE the block above,
  // because they are not taxonomy members and folding them in would make the
  // exhaustiveness check unwritable.
  prod: 'production',
  dev: 'development',
};

/**
 * Map a raw `NODE_ENV` (or any operator-supplied environment string) onto the
 * `DiscoverySchema.environment` enum.
 *
 * Shared by both discovery producers so they cannot drift — the same reason
 * `serviceUnavailableMessage` / `inProcessServiceMessage` live in
 * `@objectstack/spec/system` rather than in each builder.
 *
 * **The unset default is part of the mapping, not the caller's business**
 * (#5936). Callers pass the operator's value through as they read it and pass
 * nothing when the operator set nothing; they do not substitute a default of
 * their own. A caller that supplies one is re-opening the drift this function
 * exists to close.
 *
 * @param raw the operator-supplied value, typically `process.env.NODE_ENV`;
 *   `undefined`, `null` and a blank string all mean "the host did not say"
 * @returns a value guaranteed to satisfy {@link DiscoveryEnvironmentSchema}
 */
export function resolveDiscoveryEnvironment(raw?: string | null): DiscoveryEnvironment {
  const spelling = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (spelling === '') return 'production';
  // [#6287] The fallback's ONE remaining job: a spelling that is not a declared
  // `EnvironmentType` member and not an operator shorthand — `qa`, `uat`, a
  // typo. It no longer silently answers for members of our own taxonomy; the
  // table above is total over them and `tsc` keeps it that way, so a future
  // bucket cannot reach this line by being forgotten. Keep it: `NODE_ENV` is an
  // arbitrary operator string, so "anything else" is a real input class, and
  // degrading it to `development` is what stops a guess claiming `production`.
  return NODE_ENV_TO_DISCOVERY_ENVIRONMENT[spelling] ?? 'development';
}

// ============================================================================
// The capability vocabulary (#5672, maintainer ruling A 2026-08-06)
// ============================================================================

/**
 * Well-Known Capabilities Schema — **the one capability vocabulary**.
 *
 * Flat boolean flags for quick feature detection by clients (ObjectUI).
 * Each flag indicates whether the backend supports a specific capability.
 * Clients use these to show/hide UI elements without probing individual
 * endpoints.
 *
 * ## Closed, and why (#5672)
 *
 * Until the 2026-08-06 ruling this schema was one of TWO de-facto vocabularies.
 * `#4828` renamed the runtime dispatcher's top-level `features` map to the
 * canonical `capabilities`, which collapsed the *spelling* split — but the two
 * producers went on filling **disjoint key sets**:
 *
 * | producer | keys it filled |
 * |:---|:---|
 * | `getDiscovery()` (`@objectstack/metadata-protocol`) | `comments` `automation` `cron` `search` `export` `chunkedUpload` `transactionalBatch` |
 * | `getDiscoveryInfo()` (`@objectstack/runtime` dispatcher) | `search` `websockets` `files` `analytics` `ai` `notifications` `i18n` |
 *
 * Only `search` overlapped. `DiscoverySchema.capabilities` was an OPEN
 * `z.record`, so both shapes parsed clean and no gate could see the split —
 * while `packages/client`'s getter ASSERTED the result was a
 * `WellKnownCapabilities`. Against a dispatcher-served host
 * `client.capabilities.transactionalBatch` was therefore statically `boolean`
 * and actually `undefined`: the type lied.
 *
 * Ruling A closes the vocabulary here and binds every producer to it:
 *
 * 1. this schema is the ONE vocabulary — every key explicitly declared, boolean;
 * 2. every discovery producer emits EVERY key (see `DiscoverySchema.capabilities`);
 * 3. a capability the producer does not deliver is `enabled: false`, **never a
 *    missing key** — loudly decidable, and a consumer never has to know which
 *    kind of host answered it;
 * 4. so `WellKnownCapabilities` becomes true rather than asserted.
 *
 * Adding a key here therefore obliges BOTH producers to answer it, and the
 * three `discovery-schema-conformance.test.ts` gates fail until they do.
 * Removing one is an ADR-0049 enforce-or-remove exercise, not an edit.
 */
export const WellKnownCapabilitiesSchema = lazySchema(() => z.object({
  /** Whether the backend supports record comments / chatter (served by `sys_comment` via the data API) */
  comments: z.boolean().describe('Whether the backend supports record comments / chatter (the `sys_comment` object served via the data API)'),
  /** Whether the backend supports Automation CRUD (flows, triggers) */
  automation: z.boolean().describe('Whether the backend supports Automation CRUD (flows, triggers)'),
  /** Whether the backend supports cron scheduling */
  cron: z.boolean().describe('Whether the backend supports cron scheduling'),
  /** Whether the backend supports full-text search */
  search: z.boolean().describe('Whether the backend supports full-text search'),
  /** Whether the backend supports async export */
  export: z.boolean().describe('Whether the backend supports async export'),
  /** Whether the backend supports chunked (multipart) uploads */
  chunkedUpload: z.boolean().describe('Whether the backend supports chunked (multipart) uploads'),
  /**
   * Whether the backend exposes the atomic cross-object batch endpoint
   * (`POST {basePath}/batch`, issue #1604 / ADR-0034 item 4): heterogeneous
   * create/update/delete across objects that all commit or all roll back in a
   * single transaction, with intra-batch `{ $ref: <opIndex> }` parent references.
   *
   * This lets a client decide **at connection time** whether to send an atomic
   * batch or fall back to non-atomic client-side simulation — replacing the
   * runtime probe (fire a `/batch` and read 404/405/501). `true` means the route
   * is mounted AND the runtime engine can honour a transaction; a backend that
   * would 404 (no route) or 501 (no `transaction()`) MUST report `false`
   * (declared === enforced).
   */
  transactionalBatch: z.boolean().describe(
    'Whether the backend exposes the atomic cross-object batch endpoint (POST {basePath}/batch, #1604/ADR-0034): '
    + 'all ops commit or roll back together in one transaction. Lets clients skip non-atomic client-side simulation '
    + 'instead of runtime-probing 404/405/501. True ⟺ the /batch route is mounted AND the runtime can honour a transaction.'
  ),

  // ── Joined the vocabulary with ruling A (#5672) ────────────────────────────
  // These six were the dispatcher's half of the split. They were already REAL
  // answers on the wire (`/.well-known/objectstack` has emitted them since
  // #4828) — declaring them here does not invent capability, it stops the
  // vocabulary from depending on which producer you asked.

  /**
   * Whether the backend mounts a realtime push surface (WebSocket or SSE)
   * clients can subscribe to.
   *
   * `false` on every host today, and that is a measured fact rather than a
   * placeholder: `service-realtime` is an **in-process pub/sub bus**, the
   * dispatcher has no `/realtime` branch and no plugin mounts one (ADR-0076
   * D12, #2462), which is exactly why `ApiRoutesSchema.realtime` is never
   * advertised either. A producer that one day mounts a real WS/SSE surface
   * flips this — and must also pass the anonymous-access gate (#2567).
   */
  websockets: z.boolean().describe(
    'Whether the backend mounts a realtime push surface (WebSocket/SSE) clients can subscribe to. '
    + 'False while realtime is an in-process bus with no mounted HTTP/WS surface (ADR-0076 D12, #2462).'
  ),
  /**
   * Whether a file-storage surface is served at all (upload / download /
   * attachment handling), i.e. the `storage` slot (deprecated v17 alias:
   * `file-storage` — #9683) is filled by something that really serves HTTP.
   *
   * Related to but distinct from {@link WellKnownCapabilitiesSchema} `chunkedUpload`:
   * this one says "files work"; that one says "large files can be uploaded in
   * chunks". On the hosts that exist today the two coincide, because the only
   * storage surface shipped serves both — see the per-producer notes at each
   * emit site.
   */
  files: z.boolean().describe('Whether a file-storage surface (upload/download/attachments) is served'),
  /** Whether the backend serves the analytics / BI query surface */
  analytics: z.boolean().describe('Whether the backend serves the analytics / BI query surface'),
  /** Whether the backend serves the AI surface (NLQ, chat, agents, suggest) */
  ai: z.boolean().describe('Whether the backend serves the AI surface (NLQ, chat, agents, suggest)'),
  /** Whether the backend serves the notification surface (inbox, delivery) */
  notifications: z.boolean().describe('Whether the backend serves the notification surface (inbox, delivery)'),
  /** Whether the backend serves the i18n surface (translations, locale negotiation) */
  i18n: z.boolean().describe('Whether the backend serves the i18n surface (translations, locale negotiation)'),
}).describe('Well-known capability flags for frontend intelligent adaptation'));

export type WellKnownCapabilities = z.input<typeof WellKnownCapabilitiesSchema>;

/**
 * The capability vocabulary as a key list, derived from
 * {@link WellKnownCapabilitiesSchema} rather than hand-written.
 *
 * Every consumer that has to enumerate the vocabulary — the SDK getter that
 * flattens a discovery response, the three producer conformance gates —
 * reads THIS, so none of them can become a fourth dialect of the contract.
 * Hand-listing the keys anywhere is the drift this constant exists to prevent.
 */
export const WELL_KNOWN_CAPABILITY_KEYS = Object.freeze(
  Object.keys(WellKnownCapabilitiesSchema.shape) as Array<keyof WellKnownCapabilities>,
);

/**
 * The value shape of one entry in `DiscoverySchema.capabilities`.
 *
 * `enabled` is the vocabulary's boolean; `features` and `description` are the
 * optional hierarchical extras that let a producer say more about a capability
 * it does deliver. `features` stays an OPEN record on purpose — sub-feature
 * flags are per-capability and per-producer, and #4828 explicitly kept this
 * (the surviving `features`) as the declared sub-key.
 */
export const CapabilityDescriptorSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Whether this capability is available'),
  features: z.record(z.string(), z.boolean()).optional()
    .describe('Sub-feature flags within this capability'),
  description: z.string().optional()
    .describe('Human-readable capability description'),
}));

export type CapabilityDescriptor = z.input<typeof CapabilityDescriptorSchema>;

/**
 * `capabilities` as a CLOSED object over the vocabulary — one required entry
 * per {@link WellKnownCapabilitiesSchema} key, built from that schema's own
 * shape so the two cannot drift apart (ruling A point 1: there is one
 * vocabulary, not two that a test has to keep in step).
 *
 * Each key's `.describe()` is inherited from the flag it mirrors, so the
 * generated reference docs say the same thing in both places.
 *
 * A function, not a module-level constant: reading `.shape` materialises the
 * lazy schema, so evaluating this at import time would undo exactly the
 * deferral {@link lazySchema} exists for. It is called from inside
 * `DiscoverySchema`'s own factory, i.e. on first use of that schema.
 */
function capabilityMapShape(): Record<keyof WellKnownCapabilities, typeof CapabilityDescriptorSchema> {
  return Object.fromEntries(
    Object.entries(WellKnownCapabilitiesSchema.shape).map(([key, flag]) => {
      const description = (flag as z.ZodTypeAny).description;
      return [key, description ? CapabilityDescriptorSchema.describe(description) : CapabilityDescriptorSchema];
    }),
  ) as Record<keyof WellKnownCapabilities, typeof CapabilityDescriptorSchema>;
}

export const DiscoverySchema = lazySchema(() => z.object({
  /** System Identity */
  name: z.string(),
  version: z.string(),
  environment: DiscoveryEnvironmentSchema,
  
  /** Dynamic Routing — convenience shortcut for client routing */
  routes: ApiRoutesSchema,
  
  /** Localization Info (helping frontend init i18n) */
  locale: z.object({
    default: z.string(),
    supported: z.array(z.string()),
    timezone: z.string(),
  }),
  
  /**
   * Per-service status map.
   * This is the **single source of truth** for service availability.
   * Clients use this to determine which features are available,
   * show/hide UI elements, and display appropriate messages.
   */
  services: z.record(z.string(), ServiceInfoSchema).describe(
    'Per-service availability map keyed by CoreServiceName'
  ),

  /**
   * Hierarchical capability descriptors — **the whole vocabulary, every time**.
   *
   * One entry per {@link WellKnownCapabilitiesSchema} key, every entry
   * REQUIRED. Ruling A (#5672): a capability a producer does not deliver is
   * reported `enabled: false`, never omitted, so a consumer reads the same key
   * set from every host and never has to know which producer answered.
   *
   * Two things changed here at once, and both were load-bearing:
   *
   * * **open `z.record` → closed object.** The record accepted any key, which
   *   is how two producers filled disjoint key sets for a year without a gate
   *   noticing. Closed, an undeclared capability is a contract change you have
   *   to make in {@link WellKnownCapabilitiesSchema} — where both producers are
   *   then obliged to answer it. (A zod object STRIPS unknown keys rather than
   *   rejecting them, so the producer gates also carry a key-set check, exactly
   *   as `routes` does since #5679.)
   * * **optional → required.** This is the `scoping` precedent read the other
   *   way round. `scoping` is optional because only ONE producer can honestly
   *   answer it; `capabilities` is answerable by all of them, and an optional
   *   block would leave the consumer back at `undefined` for every flag —
   *   precisely the pre-#4828 dispatcher situation the ruling removes.
   */
  capabilities: z.object(capabilityMapShape())
    .describe('Hierarchical capability descriptors — the full WellKnownCapabilities vocabulary, every key present'),

  /**
   * Schema discovery URLs for cross-ecosystem interoperability.
   */
  schemaDiscovery: z.object({
    openapi: z.string().optional().describe('URL to OpenAPI (Swagger) specification (e.g., "/api/v1/openapi.json")'),
    jsonSchema: z.string().optional().describe('URL to JSON Schema definitions'),
  }).optional().describe('Schema discovery endpoints for API toolchain integration'),

  /**
   * Environment-scoping posture of the server that answered (#4828).
   *
   * Added by the `@objectstack/rest` discovery endpoint, which is the only
   * layer that knows it: the REST server can mount the same API twice — once
   * bare (`/api/v1`) and once environment-scoped
   * (`/api/v1/environments/:environmentId`) — and a client needs to know which
   * mode it reached and how the environment id is resolved before it can build
   * URLs. It was emitted (and consumed — `packages/client`'s
   * `client.environment-scoping.test.ts` asserts `scoping.enabled` /
   * `scoping.resolution` off the live response) long before it was declared;
   * the 2026-08-05 ruling declares it here rather than deleting a real
   * capability-negotiation fact.
   *
   * Optional because only the REST producer can answer it: the runtime
   * dispatcher serves one kernel and mounts no scoped variant, so it emits
   * nothing here rather than inventing a value.
   */
  scoping: z.object({
    enabled: z.boolean().describe('Whether environment-scoped routes are mounted at all'),
    resolution: z.enum(['required', 'optional', 'auto'])
      .describe('How the environment id is resolved when scoping is enabled (mirrors RestApiConfig.projectResolution)'),
    scoped: z.boolean().describe('Whether THIS response was served from the environment-scoped mount'),
    environmentId: z.string().optional()
      .describe('The resolved environment id — present only on a scoped mount'),
  }).optional().describe('Environment-scoping posture, added by the REST discovery endpoint'),

  /**
   * Custom metadata key-value pairs for extensibility
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom metadata key-value pairs for extensibility'),
}));

export type DiscoveryResponse = z.input<typeof DiscoverySchema>;
export type ApiRoutes = z.input<typeof ApiRoutesSchema>;
export type ServiceInfo = z.input<typeof ServiceInfoSchema>;

// ============================================================================
// Route Health Report
// ============================================================================

/**
 * Single route health entry for the coverage report.
 */
export const RouteHealthEntrySchema = lazySchema(() => z.object({
  /** Route path (e.g. /api/v1/analytics) */
  route: z.string().describe('Route path pattern'),
  /** HTTP method */
  method: HttpMethod.describe('HTTP method (GET, POST, etc.)'),
  /** Target service name */
  service: z.string().describe('Target service name'),
  /** Whether the route is declared in discovery */
  declared: z.boolean().describe('Whether the route is declared in discovery/metadata'),
  /** Whether the handler is actually registered in the adapter/dispatcher */
  handlerRegistered: z.boolean().describe('Whether the HTTP handler is registered'),
  /**
   * Health check result:
   * - `pass`    – Handler exists and responds (2xx/4xx — i.e., not 404/501/503)
   * - `fail`    – Handler returned 501 or 503
   * - `missing` – No handler registered (404)
   * - `skip`    – Health check was not performed
   */
  healthStatus: z.enum(['pass', 'fail', 'missing', 'skip']).describe(
    'pass = handler responds, fail = 501/503, missing = no handler (404), skip = not checked'
  ),
  /** Optional diagnostic message */
  message: z.string().optional().describe('Diagnostic message'),
}));

export type RouteHealthEntry = z.input<typeof RouteHealthEntrySchema>;

/**
 * Route Health Report Schema
 * Aggregated route coverage report produced at startup or on demand.
 *
 * This report enables automated detection of routes that are declared
 * in discovery metadata but have no corresponding HTTP handler.
 */
export const RouteHealthReportSchema = lazySchema(() => z.object({
  /** ISO 8601 timestamp of when the report was generated */
  timestamp: z.string().describe('ISO 8601 timestamp of report generation'),
  /** Adapter name that generated the report (e.g. "hono", "express", "nextjs") */
  adapter: z.string().describe('Adapter or runtime that produced this report'),
  /** Total routes declared in discovery / dispatcher table */
  totalDeclared: z.number().int().describe('Total routes declared in discovery'),
  /** Routes with a confirmed handler registration */
  totalRegistered: z.number().int().describe('Routes with confirmed handler'),
  /** Routes missing a handler */
  totalMissing: z.number().int().describe('Routes missing a handler'),
  /** Per-route health entries */
  routes: z.array(RouteHealthEntrySchema).describe('Per-route health entries'),
}));

export type RouteHealthReport = z.input<typeof RouteHealthReportSchema>;
