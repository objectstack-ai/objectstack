// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defineStack({ server })` — the authorable server-facing configuration.
 *
 * ## Why this is NOT `HttpServerConfigSchema`
 *
 * `system/http-server.zod.ts` used to declare nine keys (`port`, `host`,
 * `cors`, `requestTimeout`, `bodyLimit`, `compression`, `security`, `static`,
 * `trustProxy`). #4938 measured them: **none had a runtime reader and none was
 * reachable from any authoring surface** — `stack.zod.ts` had no `server:` key,
 * so the whole shape was unwritable as well as unread. Mounting it wholesale
 * here would have made eight dead keys authorable in one move, which is the
 * declared-≠-enforced defect (Prime Directive #10) manufactured on purpose.
 *
 * So this schema is deliberately NARROW: it carries only keys an executor
 * actually consumes, and it grows one key at a time, each arriving with its
 * consumer. Today that is exactly two:
 *
 * | key | consumed by |
 * |---|---|
 * | `security.rateLimit` | `createDispatcherPlugin` → the inbound token bucket (`@objectstack/runtime` `security/inbound-rate-limit.ts`) — an over-budget caller gets `429` + `Retry-After` |
 * | `trustProxy` | the same limiter's IP resolution — see below |
 *
 * The other seven `HttpServerConfigSchema` keys were RETIRED with the shape
 * that carried them (#4938, ADR-0049 enforce-or-remove): unreachable *and*
 * unread, they were the cleanest remove candidate in the ledger, and their
 * prescriptions now live in the `guidance` maps below — the only place an
 * author can write a server key is also the only place that has to answer for
 * one. Adding one here without an executor re-opens the hole this narrowness
 * exists to close.
 *
 * `cors` is the registered exception-in-waiting: the 2026-08-04 ruling named it
 * the FIRST per-key admission candidate for this shape, because embedding
 * (`example-embed-objectql`) is a real scenario with real pull. When that work
 * is scheduled it arrives the #4910 way — key and executor in one change — not
 * by un-retiring a declaration.
 *
 * ## What `server:` is NOT for
 *
 * **Deployment knobs stay on the CLI.** There is no `server.port` / `server.host`
 * on purpose: the listening socket is a property of *where* a stack runs, not of
 * the stack itself, and it is already owned by `objectstack serve -p <port>` /
 * `PORT`. Two authorities for one number is how a config becomes advisory. If a
 * future need does add `server.port`, the precedence is settled in advance and
 * recorded here so it cannot be re-litigated per-caller: **the CLI flag wins over
 * `server:`, and `server:` wins over the built-in default** — an operator
 * overriding a port at the command line must not be silently overruled by a file
 * baked into the artifact.
 *
 * Related: #4910 (this seam), #4937 (the limiter that documented an execution
 * chain it never had), #4936 (the declarative `apis:` surface as it stood while
 * nothing executed it: vocabulary kept, a non-empty array rejected outright) and
 * #5040 — the executor that ended that state. From protocol 17 a declared
 * endpoint is LIVE behind five per-endpoint publish gates, and its own
 * `rateLimit` is enforced by the endpoint policy chain against a bucket keyed in
 * a separate namespace, so an endpoint budget and the server-level budget
 * declared here meter INDEPENDENTLY rather than sharing a counter. The upgrade
 * checklist for that flip is the `declarative-apis-endpoints-live` entry of the
 * protocol upgrade guide. ADR-0069 D2 (shared counters), ADR-0049 (enforce or
 * remove).
 */

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { RateLimitConfigSchema } from '../shared/http.zod';

/**
 * `server.security.rateLimit` — the shared {@link RateLimitConfigSchema} shape,
 * closed against unknown keys for this authoring surface.
 *
 * The SHAPE is reused verbatim (`RateLimitConfigSchema.shape`) rather than
 * retyped, so there is no fourth rate-limit shape in the repo and no drift to
 * police — #4686 opened on there already being three. What is added is
 * strictness: this key is new, so it joins the #4001 ratchet at birth instead of
 * being tightened later, and a misspelled budget (`maxRequest`, `window`) is
 * rejected at parse rather than silently defaulted to 100 req/min.
 */
export const ServerRateLimitConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'server.security.rateLimit',
    history:
      'This key is new in v17 and strict from birth — an unknown key here was never accepted.',
    aliases: {
      window: 'windowMs',
      windowSeconds: 'windowMs',
      max: 'maxRequests',
      maxRequest: 'maxRequests',
      limit: 'maxRequests',
    },
    guidance: {
      keyBy:
        'The rate-limit key is not authorable. It is the resolved principal, falling back to the caller IP for '
        + 'anonymous traffic; whether the IP is read from forwarded headers is decided by `server.trustProxy`.',
      store:
        'The counter store is not authorable. Counters live in the kernel `cache` service when one is registered '
        + '(ADR-0069 D2) and degrade to a per-process store otherwise, announced once at boot.',
    },
  },
  RateLimitConfigSchema.shape,
).superRefine((value, ctx) => {
  // The shared shape declares `.int()` but no lower bound, so `0` and negatives
  // parse. They are not budgets: `maxRequests: 0` rejects every request
  // including your own health checks, and either zero makes the derived refill
  // rate undefined (`maxRequests / (windowMs / 1000)`).
  //
  // Rejecting HERE rather than at boot is the point (#4910 axis 2): an AI-
  // authored stack finds out at `defineStack`, in the file it is writing, with
  // the fix in the message — not from a 429 storm, and not from a boot log
  // nobody reads. The runtime derivation keeps its own guard for callers that
  // build a budget programmatically; this is the one authors hit.
  if (value.maxRequests <= 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxRequests'],
      message:
        `maxRequests must be greater than 0 (got ${value.maxRequests}). A zero budget rejects every request; `
        + 'to turn rate limiting off set `enabled: false`.',
    });
  }
  if (value.windowMs <= 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['windowMs'],
      message:
        `windowMs must be greater than 0 (got ${value.windowMs}). It is the budget window in MILLISECONDS — `
        + '60000 is one minute.',
    });
  }
}));

export type ServerRateLimitConfig = z.input<typeof ServerRateLimitConfigSchema>;
/** Post-parse shape of {@link ServerRateLimitConfig} — defaults applied, transforms run (ADR-0122). */
export type ServerRateLimitConfigParsed = z.infer<typeof ServerRateLimitConfigSchema>;

/**
 * `server.security` — security configuration consumed by the inbound seam.
 */
export const StackServerSecuritySchema = lazySchema(() => strictObject(
  {
    surface: 'server.security',
    history:
      'This key is new in v17 and strict from birth — an unknown key here was never accepted.',
    guidance: {
      helmet:
        'Not authorable here. Response hardening headers are configured on the dispatcher plugin '
        + '(`securityHeaders`), which is on by default — see `buildSecurityHeaders` in @objectstack/runtime.',
      cors:
        'Not authorable here. CORS is owned by the transport adapter and configured by '
        + 'OS_CORS_ORIGIN / OS_CORS_CREDENTIALS / OS_CORS_MAX_AGE.',
    },
  },
  {
    /**
     * Global inbound rate limit. `enabled: false` (the default) leaves every
     * request unmetered; `enabled: true` arms a token bucket in front of every
     * route this server mounts.
     */
    rateLimit: ServerRateLimitConfigSchema.optional().describe(
      'Global inbound rate limit. When `enabled`, every inbound request consumes from a token bucket derived from '
      + 'this budget (capacity = `maxRequests`, refill = `maxRequests / (windowMs / 1000)` tokens per second); an '
      + 'empty bucket answers 429 with a `Retry-After` header. The bucket is keyed by the RESOLVED PRINCIPAL, '
      + 'falling back to the caller IP for anonymous traffic — so one abusive session cannot exhaust another '
      + "user's budget, and credential-stuffing traffic (which has no principal yet) is still metered per source. "
      + 'See `server.trustProxy` for how that IP is determined.',
    ),
  },
));

export type StackServerSecurity = z.input<typeof StackServerSecuritySchema>;
/** Post-parse shape of {@link StackServerSecurity} — defaults applied, transforms run (ADR-0122). */
export type StackServerSecurityParsed = z.infer<typeof StackServerSecuritySchema>;

/**
 * The `server:` block of a stack definition.
 */
export const StackServerConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the stack `server` block',
    history:
      'This key is new in v17 and strict from birth — an unknown key here was never accepted.',
    guidance: {
      port:
        'Not authorable. The listening port belongs to the deployment, not the stack — pass '
        + '`objectstack serve -p <port>` or set PORT. (`HttpServerConfig.port` was retired in v17,.)',
      host:
        'Not authorable. The bind address belongs to the deployment, not the stack — pass it to '
        + '`objectstack serve`. (`HttpServerConfig.host` was retired in v17,.)',
      cors:
        'Not authorable here. CORS is owned by the transport adapter and configured by '
        + 'OS_CORS_ORIGIN / OS_CORS_CREDENTIALS / OS_CORS_MAX_AGE. (`HttpServerConfig.cors` was retired in '
        + 'v17, #4938; it is the registered first candidate for a `server.cors` key, which will arrive with '
        + 'its executor.)',
      compression:
        'Not authorable — nothing reads it. `HttpServerConfig.compression` was retired in v17 '
        + 'rather than mounted here; response compression is the transport adapter\'s concern.',
      requestTimeout:
        'Not authorable — nothing reads it. `HttpServerConfig.requestTimeout` was retired in v17 '
        + 'rather than mounted here.',
      bodyLimit:
        'Not authorable — nothing reads it. `HttpServerConfig.bodyLimit` was retired in v17 '
        + 'rather than mounted here.',
      static:
        'Not authorable. Static mounts are configured on the transport plugin (`staticMounts`). '
        + '(`HttpServerConfig.static` was retired in v17,.)',
    },
  },
  {
    security: StackServerSecuritySchema.optional().describe(
      'Server-level security configuration. Today: the global inbound rate limit.',
    ),

    /**
     * Whether an `X-Forwarded-For` / `X-Real-IP` header may be believed.
     *
     * This is a SECURITY declaration, not a convenience toggle. Anything a
     * client can send, a client can forge: an attacker who can pick their own
     * `X-Forwarded-For` gets an unlimited supply of fresh rate-limit buckets
     * (limit bypassed) AND can spend another caller's budget by claiming their
     * address (limit weaponised). Trusting the header therefore has to be an act
     * of authorship — the operator asserting "a proxy I control rewrites this
     * header on every request" — and never a default.
     */
    trustProxy: z.boolean().default(false).describe(
      'Believe `X-Forwarded-For` / `X-Real-IP` when identifying a caller. Declare `true` ONLY when a reverse proxy '
      + 'you control overwrites those headers on every inbound request. Left `false` (the default) the caller IP is '
      + "the transport's own peer address, which a client cannot forge. Consumed by the inbound rate limiter when "
      + '`server.security.rateLimit.enabled` is set.',
    ),
  },
));

export type StackServerConfig = z.input<typeof StackServerConfigSchema>;
/** Post-parse shape of {@link StackServerConfig} — defaults applied, transforms run (ADR-0122). */
export type StackServerConfigParsed = z.infer<typeof StackServerConfigSchema>;
