// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'http-server-runtime-vocabulary-retired',
  surface:
    'system.serverEvent / system.serverEventType / system.serverCapabilities / '
    + 'system.serverStatus (the lifecycle-event, capability-report and status vocabulary of '
    + 'system/http-server.zod.ts — 4 defs, 8 exported names)',
  replacement:
    '(removed — there is no replacement key, because there was never a key. Server lifecycle '
    + 'is the transport plugin\'s own start/stop seam; per-request and per-server '
    + 'observability is `system/metrics.zod.ts` and `system/logging.zod.ts` (plus '
    + '`OS_SERVER_TIMING` for timings), and liveness is the `/health` endpoint. What a '
    + 'transport plugin can DO it states by implementing the kernel plugin contract — the '
    + 'seams it registers are the capability statement, and a self-described capability '
    + 'record can only disagree with them. Server-level configuration that IS authorable '
    + 'lives on `defineStack({ server })` / `StackServerConfigSchema`, which is unaffected)',
  reason:
    'The second and final ADR-0049 pass over `system/http-server.zod.ts`. #4938 removed the '
    + 'CONFIG half (`HttpServerConfigSchema`, nine keys, zero readers, zero authoring '
    + 'entry); this removes the RUNTIME half — a 7-member lifecycle event union with a '
    + 'timestamped envelope, an eight-boolean capability report, and a five-state status '
    + 'record with connection and request counters. Nothing ever emitted, consumed or '
    + 'parsed any of them. '
    + 'This card was HELD for four days rather than queued, on a specific and legitimate '
    + 'doubt: a response/capability vocabulary can be a REFERENCE surface for host '
    + 'implementers, so "zero consumers in this repo" is weaker evidence for one of those '
    + 'than for an authorable key (the CSS-variable rebuttal). The hold was lifted by '
    + 'measuring the reference reader itself rather than by re-running the same grep: '
    + '`plugin-hono-server`, the one in-tree host implementation, neither implements nor '
    + 'reports any of the three — it names no capability record, no status shape and no '
    + 'event union, and what it registers is routes and middleware through the kernel '
    + 'plugin contract. A declaration-site grep put every declaration in this one file, a '
    + 'quoted-name sweep across objectstack and objectui found no reader outside it, and '
    + 'the control passed in the SAME run: `MiddlewareConfig`, declared twelve lines away, '
    + 'resolves to `packages/runtime/src/middleware.ts`. So the sweep could see a reader in '
    + 'this file when there was one. '
    + 'With no carrier key there is nothing to tombstone, and with no author there is no '
    + 'source or `sys_metadata` row for a D2 conversion to rewrite: RETIRED_DEFS_BY_MAJOR '
    + 'plus this entry are the declaration — route 3, the same shape as #4938 in this very '
    + 'file, #4834, #4988 and #5055. If host-implementer conformance becomes a real '
    + 'requirement it returns through the ENFORCE route: an adapter contract with a checker '
    + 'behind it, vocabulary second. ADR-0049, #5295.',
  acceptanceCriteria:
    'No source imports `ServerEvent`, `ServerEventType`, `ServerEventSchema`, '
    + '`ServerCapabilities`, `ServerCapabilitiesSchema`, `ServerCapabilitiesParsed`, '
    + '`ServerStatus` or `ServerStatusSchema` from `@objectstack/spec/system` — a grep over '
    + 'consumer code resolves none of them, and `tsc` reports TS2724/TS2305 on any that '
    + 'survives. The route-registration half of the same module still resolves '
    + '(`RouteHandlerMetadataSchema`, `MiddlewareType`, `MiddlewareConfigSchema`, '
    + '`MiddlewareConfig`), and `StackServerConfigSchema` — the one authorable server '
    + 'surface — is untouched: a stack declaring `server: { trustProxy, security }` parses '
    + 'exactly as it did in 16.x.',
};
