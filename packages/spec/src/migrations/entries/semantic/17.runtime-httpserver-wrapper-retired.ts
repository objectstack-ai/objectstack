// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'runtime-httpserver-wrapper-retired',
  surface: 'runtime.HttpServer (the exported delegating wrapper class)',
  replacement:
    'register an `IHttpServer` ADAPTER INSTANCE directly as the `http.server` service — '
    + '`HonoHttpServer` or whatever adapter the host already builds — instead of wrapping one',
  reason:
    '`@objectstack/runtime` exported an `HttpServer` class that took an `IHttpServer` in its '
    + 'constructor, declared `implements IHttpServer`, and forwarded only the contract\'s '
    + 'REQUIRED members (`get` / `post` / `put` / `delete` / `patch` / `use` / `listen` / '
    + '`close`). It forwarded none of the OPTIONAL ones — `getPort?()`, `getRawApp?()`, '
    + '`setFallbackHandler?()`. `packages/spec/src/contracts/http-server.ts` instructs '
    + 'consumers to feature-detect exactly those members with `typeof server.X === '
    + '"function"` and to degrade when absent, so wrapping a capable adapter made every '
    + 'probe answer false and the capability vanish with the adapter underneath providing it '
    + 'the whole time. The sharpest consequence is worth writing down before anyone reaches '
    + 'for a wrapper of the same shape: a host that wrapped `HonoHttpServer` and registered '
    + 'the wrapper as `http.server` would answer 404 to every endpoint its metadata declared, '
    + 'because `setFallbackHandler` — since #5111 the ONLY entry path for declarative `apis:` '
    + 'endpoints — was never forwarded. This is a TS/API contract surface: an HTTP server '
    + 'adapter is CODE, never stack metadata, so there is no authored source for the chain to '
    + 'rewrite and deliberately no schema tombstone — nothing ever ran an adapter through a '
    + '`.parse()`. That is precisely why this entry must exist: for an untyped JS host the '
    + 'ledger is the only notification channel there is, and for a typed one tsc reports at '
    + 'the construction site. Same disposition, and the same reason, as '
    + '`storage-service-list-retired` (#5540) and `data-driver-find-stream-retired` (#4484). '
    + 'Registered by the #6350 stock reconciliation, not by the original change: #5122 landed '
    + 'before the #6148 completeness gate existed, so nothing ever asked it what it had done '
    + 'about the ledger. ADR-0049 / ADR-0087, #5122 (backfilled #6350).',
  acceptanceCriteria:
    'No code constructs `new HttpServer(...)` from `@objectstack/runtime`, and no import of '
    + 'the name resolves — the export is gone, so a typed caller fails to compile at the '
    + 'construction site. A host that was wrapping an adapter registers the ADAPTER INSTANCE '
    + 'as `http.server` instead, and then proves the capability came back: `getPort()` returns '
    + 'the real bound port after `listen(0)`, `getRawApp()` returns the framework-native app, '
    + 'and a declarative `apis:` endpoint declared in metadata answers its route rather than '
    + '404 — the last of which is the failure a wrapper produced silently. An adapter that '
    + 'genuinely needs to intercept calls implements `IHttpServer` in full, forwarding the '
    + 'optional members too, rather than declaring `implements` and dropping them.',
};
