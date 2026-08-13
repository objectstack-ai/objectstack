// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { IHttpServer, shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE } from '@objectstack/core';
// [#7020] The read cohort names the READ-ONLY half of the ADR-0106 D4 exemption
// on purpose: `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` became the derived union
// (write gate ∪ read-only exemptions) under the 2026-08-10 ruling, while this
// gate's cohort was ruled separately (#7033 / #7023) and pins write-only callers
// OUT. Same value it read before — no re-ruling by side effect.
import { OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES } from '@objectstack/metadata-core';
import type { PackageService } from '@objectstack/service-package';
// The declared envelope is written in ONE place for the whole platform (#3973),
// and so (#8016) is the rule that reads an HTTP answer off a THROWN error.
// [#8086] `looksLikeInternalErrorLeak` / `INTERNAL_ERROR_MESSAGE` come from the
// same package for the same reason: "do not ship driver internals to clients"
// is a property of the HTTP boundary, not of one router, so every boundary
// applies ONE predicate in its own envelope (#3867).
import {
  sendOk,
  sendError,
  resolveThrownHttpError,
  looksLikeInternalErrorLeak,
  INTERNAL_ERROR_MESSAGE,
} from '@objectstack/types';
import { mountDirectRoutes, type DirectMountedRoute } from './direct-mount.js';
import { readSingleQueryValue, repeatedQueryParamMessage } from './query-multiplicity.js';

/**
 * [#7033 / #7023] The authorization gate for the REST package transport.
 *
 * `/packages` had TWO HTTP transports and both were ungated: the runtime
 * dispatcher domain (`packages/runtime/src/domains/packages.ts`) AND this
 * `@objectstack/rest` direct-mount registrar — which registers FIRST in the
 * production stack (first-match-wins, see the module note above), so for the
 * three routes both declare (`GET /packages`, `GET /packages/:id`,
 * `DELETE /packages/:id`) THIS transport is the one production actually serves.
 * Gating only the dispatcher would leave those routes open — the exact
 * one-transport gap #6603/#7019 paid for on `/meta`.
 *
 * Same ruled policy as the dispatcher (maintainer, 2026-08-09): a domain-wide
 * anonymous floor, `manage_metadata` for state-changing routes
 * (`POST /packages/publish`, `DELETE /packages/:id`), and the ADR-0106 D4 read
 * set (`studio.access` / `setup.access`) for reads (`GET /packages`,
 * `GET /packages/:id`). The public MARKETPLACE browse is a different surface
 * (`/marketplace/packages`, MarketplaceProxyPlugin) — these `/api/v1/packages`
 * routes are management, so denying anonymous here strands no public browse.
 *
 * The caller context is resolved through {@link PackageRoutesOptions.resolveExecutionContext},
 * which the composition wires to the `RestServer`'s own resolver (the SAME
 * resolution the `/meta` REST gate uses). When it is absent the gate FAILS
 * CLOSED (401) rather than open — an ungated fallback is the very hole this
 * closes. `isSystem` is never settable from the wire; CORS `OPTIONS` passes.
 *
 * Returns `true` when the response was already sent (the caller must `return`).
 */
async function refusePackageRequest(
  options: PackageRoutesOptions,
  req: any,
  res: any,
  kind: 'read' | 'write',
): Promise<boolean> {
  const ctx = options.resolveExecutionContext
    ? await options.resolveExecutionContext(req).catch(() => undefined)
    : undefined;
  // Anonymous-deny floor. This direct-mount surface DECLARES the wrapped
  // BaseResponseSchema envelope — every other body here goes through
  // sendOk/sendError, and `check:route-envelope` pins this module at ZERO
  // hand-written bodies — so the 401 is emitted through the SAME shared
  // `sendError`, not the flat `ANONYMOUS_DENY_BODY` the `/data`+`/meta`
  // `enforceAuth` seam writes. The shared DECISION (`shouldDenyAnonymous`) and
  // semantics (status / code / message) are reused; only the wrapper is this
  // surface's own (ADR-0112's two live envelopes, read per the seam you called).
  // `isSystem` is never settable from the wire; CORS `OPTIONS` passes.
  if (shouldDenyAnonymous({ userId: ctx?.userId, isSystem: ctx?.isSystem, method: req?.method })) {
    sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
    return true;
  }
  const held = new Set<string>(Array.isArray(ctx?.systemPermissions) ? ctx.systemPermissions : []);
  const allowed = ctx?.isSystem || (kind === 'write'
    ? held.has('manage_metadata')
    : OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES.some((c) => held.has(c)));
  if (!allowed) {
    // Same wrapped envelope, one FORBIDDEN code, message per cohort — the sibling
    // `/meta` REST capability gate's shape, built through the shared `sendError`.
    sendError(res, 403, 'FORBIDDEN', kind === 'write'
      ? 'Managing packages requires the `manage_metadata` capability.'
      : 'Reading packages requires the `studio.access` or `setup.access` capability.');
    return true;
  }
  return false;
}

/**
 * [#8016] The catch-all exit for every route in this registrar.
 *
 * ## What it replaced
 *
 * Four `catch` blocks, all spelling the same thing:
 *
 *     sendError(res, 500, 'INTERNAL_ERROR', (error as Error).message);
 *
 * i.e. status-blind and code-blind. `packageService.publish` / `.delete` and
 * `protocol.deletePackage` run inside those blocks, and the metadata protocol
 * throws CODED, status-carrying refusals from that call path — `409
 * DESTRUCTIVE_CHANGE` is the established one. So a caller who was *refused*
 * was told the platform had *broken*: a 500 is a server fault, it invites a
 * retry that cannot succeed, and it hides the one thing the caller needed to
 * act on (the code).
 *
 * It was also a disagreement rather than merely a bug. The dispatcher twin
 * (`packages/runtime/src/domains/packages.ts` → `errorFromThrown`) has always
 * read `.status` first and answered 409 for the same throw. Two doors serve
 * `/api/v1/packages`; **this** registrar mounts first in the production stack
 * (first-match-wins, see the module note above), so the wrong answer was the
 * live one.
 *
 * ## Why it delegates instead of mapping here
 *
 * The mapping is one rule and this is its second door, so it is CALLED, not
 * restated — a second `if (code === ...)` ladder here is how the divergence
 * arose in the first place. `resolveThrownHttpError` (`@objectstack/types`) is
 * that rule, and the dispatcher's `errorFromThrown` is now its other caller;
 * the two doors agree by construction rather than by two suites agreeing about
 * literals. It lives in `@objectstack/types` because it cannot live in
 * `@objectstack/runtime`: that package depends on THIS one, so the import would
 * only ever point the other way.
 *
 * ## The 500 survives
 *
 * A throw that declares no status and no registered code is a genuine fault and
 * still answers `500 INTERNAL_ERROR` — `resolveThrownHttpError`'s fallback is
 * this call's `500`, and the code derives from it. Mapping everything and
 * leaving nothing on the default arm would trade one wrong answer for another
 * and hide real faults.
 *
 * ## [#8086] …and a leaky 5xx message is withheld
 *
 * The paragraph that stood here recorded the gap as still open: "this door
 * applies no `looksLikeInternalErrorLeak` withholding to 5xx bodies — that gap
 * predates this change and is unchanged by it (filed separately)". Filed as
 * #8086, and closed here.
 *
 * It was reachable, not theoretical, and was reproduced through this door
 * before being fixed — a real `ObjectQL` engine and a real
 * `ObjectStackProtocolImplementation` whose driver fails the `sys_metadata`
 * read the way a missing table does. `DELETE /api/v1/packages/:id` with no
 * `?version=` routes to `protocol.deletePackage`, whose FIRST database touch
 * (`engine.find('sys_metadata', { where })`) sits outside that method's
 * per-item `try`, so the driver line propagates whole and arrived here:
 *
 *     HTTP 500
 *     {"success":false,"error":{"code":"INTERNAL_ERROR",
 *      "message":"SQLITE_ERROR: no such table: sys_metadata"}}
 *
 * This is NOT a new rule — it is the rule this surface already follows, at the
 * door that was missed. The dispatcher twin (`HttpDispatcher.error`,
 * `packages/runtime/src/http-dispatcher.ts`) has run exactly this expression
 * since #3867, and `rest-server.ts` runs the same predicate at three call
 * sites. #5437 / PR #5464 closed this class one seam over and never reached
 * this registrar, because it does not go through `resolveErrorResponse` at all.
 * Two doors serve `/api/v1/packages` and this one mounts FIRST in the
 * production stack, so the unfiltered answer was the live one.
 *
 * Scoped to 5xx, deliberately: a 4xx message is a caller-facing answer by
 * design — the protocol's `[tenant_scope_required]` refusal names the very
 * parameter to pass, a `409 DESTRUCTIVE_CHANGE` names the remedy — and
 * withholding those would delete the self-correcting sentence, at exactly the
 * boundary where disclosure costs nothing because the caller supplied the
 * input. Only the PROSE is withheld: `status`, `code` and `details` are
 * untouched, so #8016's mapping still answers and a client can still branch.
 *
 * ⚠️ Ceiling, stated because a green suite must not read as full coverage:
 * `looksLikeInternalErrorLeak` is a heuristic over the message and recognises
 * no Postgres `relation "…" does not exist` phrasing, so that dialect's line
 * still travels — through this door and through the twin alike, since both run
 * the same predicate. Widening it HERE would be a new rule at one door and
 * would re-create the divergence this closes. The cure is option C — the
 * producer (`metadata-protocol`) not interpolating driver text into
 * client-facing messages at all — which is a separate card. Pinned as a live
 * case in `package-door-5xx-message-sanitization.test.ts` so it goes red the
 * day either lands.
 */
function sendThrownError(res: any, error: unknown): void {
  const thrown = resolveThrownHttpError(error);
  // The dispatcher twin's expression, byte for byte — one rule, two doors.
  const message = thrown.status >= 500 && looksLikeInternalErrorLeak(thrown.message)
    ? INTERNAL_ERROR_MESSAGE
    : thrown.message;
  sendError(
    res,
    thrown.status,
    thrown.code,
    message,
    thrown.details ? { details: thrown.details } : undefined,
  );
}

/**
 * The `?version=` multiplicity rule (#6307), now shared (#6877).
 *
 * Both helpers moved to `query-multiplicity.ts` when the same rule was applied
 * to `rest-server.ts`'s read points — ONE rule and one refusal message across
 * the package, rather than a second implementation free to drift. Behaviour
 * here is unchanged; only the definitions' home moved. The module's header
 * carries the full argument for why repetition is refused rather than resolved.
 */

/**
 * Resolve the `package` service AT REQUEST TIME.
 *
 * [#7563] Deliberately a function and not a resolved instance. The composition
 * step used to ask `ctx.getService('package')` ONCE, during
 * `RestApiPlugin.start()`, and mount nothing when the answer was "not yet" —
 * which is a different question from "not composed". `objectstack serve`
 * registers the capability providers (`requires: ['marketplace']` →
 * `PackageServicePlugin`) AFTER `createRestApiPlugin`, and plugin start order
 * follows registration order for plugins with no edge between them
 * (`plugin-order.ts`), so on every showcase-shaped deployment the service is
 * present at request time and absent at the one instant the mount decision was
 * taken. Resolving per request makes the answer independent of composition
 * order instead of silently encoding it.
 */
export type PackageServiceResolver = () => PackageService | undefined;

/**
 * Options for package route registration.
 */
export interface PackageRoutesOptions {
  /**
   * Protocol service (ObjectStackProtocol) — provides access to in-memory
   * SchemaRegistry packages loaded via defineStack()/AppPlugin at boot time,
   * and (#2747) the full `deletePackage` uninstall semantics: package
   * metadata rows, the durable `sys_packages` record, and the registered
   * data-plane cleanups (e.g. plugin-security revoking the package's
   * permission sets and bindings).
   */
  protocol?: {
    getMetaItems?(req: { type: string }): Promise<{ items: any[] }>;
    // [#7780] `allTenants` is the explicit carrier for cross-tenant uninstall
    // semantics; the protocol refuses a call that names neither it nor an
    // `organizationId` (`TENANT_SCOPE_REQUIRED`, 400).
    deletePackage?(req: { packageId: string; actor?: string; allTenants?: boolean }): Promise<{
      success: boolean;
      deletedCount: number;
      failedCount: number;
      failed: Array<{ type: string; name: string; error: string; code?: string }>;
      cleanups: Array<{ name: string; success: boolean; removed: number; error?: string }>;
    }>;
  };
  /**
   * [#7033 / #7023] Resolve the caller's execution context for a package route
   * request. Wired by the composition to the `RestServer`'s own resolver (the
   * SAME identity/RBAC resolution the `/meta` REST gate uses), so the capability
   * gate here reads the same `systemPermissions` the rest of the surface does.
   * Absent ⇒ the gate fails CLOSED (401). Never resolves an `isSystem` context
   * from inbound HTTP.
   */
  resolveExecutionContext?: (req: any) => Promise<{
    userId?: string | null;
    isSystem?: boolean;
    systemPermissions?: string[];
  } | undefined>;
}

/**
 * Register package management API routes
 *
 * Provides endpoints for publishing, retrieving, and managing packages.
 *
 * Returns the routes it mounted, so the caller can record them on the
 * `RestServer` that owns the surface (#5822) — the returned array IS the array
 * that was iterated to mount, never a second, hand-kept table.
 *
 * Routes:
 * - POST /api/v1/packages/publish - Publish a package to the marketplace registry
 * - GET /api/v1/packages - List all packages (merges registry + database)
 * - GET /api/v1/packages/:id - Get a specific package
 * - DELETE /api/v1/packages/:id - Delete a package
 *
 * Marketplace publish lives at `/packages/publish`, NOT at the bare
 * `POST /packages` (#3610): that verb+path is the dispatcher packages
 * domain's *install* route, and this registrar registers first in the
 * production stack (first-match-wins), so claiming it here silently
 * swallowed every `client.packages.install` call with a 400. The
 * dispatcher's own `POST /packages/:id/publish` (ADR-0033 draft publish)
 * is two segments — different shape, no clash.
 *
 * ## Which of these four mount, and why they differ (#7563)
 *
 * `POST /packages/publish` mounts UNCONDITIONALLY; the other three stay gated
 * on the `package` service. That asymmetry is not a compromise — it is the one
 * shape that is honest for each:
 *
 *  - The three gated routes have DISPATCHER TWINS at byte-identical patterns
 *    (`packages/runtime/src/domains/packages.ts` — `GET /packages`,
 *    `GET /packages/:id`, `DELETE /packages/:id`), mounted unconditionally.
 *    This registrar shadows them when it runs (first-match-wins). Mounting them
 *    without a `package` service would replace three WORKING routes with a
 *    degraded refusal, so absence keeps them where they are.
 *  - `POST /packages/publish` has NO twin. Nobody else serves that verb+path,
 *    so when this registrar sits out, the request does not 404 — it is absorbed
 *    by the dispatcher's `/packages/:id` (with `id = "publish"`), and the
 *    router answers `405` with `Allow: DELETE, GET, HEAD, PATCH`: ANOTHER
 *    route's method set, describing verbs that would each operate on a package
 *    literally named `publish` (#7563). "Use a different method" is the one
 *    answer that misinforms here, because `POST` is the only verb this surface
 *    ever had. Mounting it always means the path has an owner that can tell the
 *    truth — the handler when a package service is reachable, and an honest
 *    404 naming this surface when none is.
 *
 * The degraded answer is 404 and not 503: a deployment that composed no
 * marketplace capability is not going to grow one on retry, and 503 invites
 * exactly that retry. It is also what `direct-mount-composition.ts` has always
 * documented as the answer for a skipped registrar — until #7563 that promise
 * was simply not true on the wire for this one path.
 *
 * ## Where this module's error codes came from
 *
 * This was the *partially* converted module when #3843 was filed, which is
 * arguably worse than untouched: 3 of its 16 bodies carried `success: true`, so
 * the same registrar answered two shapes depending on which route you hit. Its
 * error bodies were the pre-#3675 `{ error: '<string>' }` throughout — and the
 * string was a human `message`, not a code:
 *
 *     res.status(400).json({ error: 'Missing required fields: manifest, metadata' });
 *
 * Two of them carried no error at all, only a bare `{ success: false }`, so a
 * caller was told it failed and never told why.
 *
 * Because there were no codes here to preserve, these had to be MINTED. They
 * follow ADR-0112 (#3841, settled while this was in review): SCREAMING_SNAKE, and
 * registered in `ERROR_CODE_LEDGER` under `@objectstack/rest`. That union is now
 * the `code` parameter's TYPE — `sendError` takes `ErrorCode`, not `string`
 * (#3973) — so an unregistered code fails to compile rather than waiting for a
 * conformance suite to parse a driven body.
 *
 * Generic conditions reuse the STANDARD catalog rather than becoming registered
 * synonyms of it: a missing request field is `MISSING_REQUIRED_FIELD`, an absent
 * package is `RESOURCE_NOT_FOUND`, a request whose own parameters are
 * self-contradictory is `VALIDATION_ERROR` (the catalog's generic validation
 * failure, and what `HttpStatusErrorCodeMap` already names a bare 400 — see
 * `readSingleQueryValue`), an unexpected throw is `INTERNAL_ERROR`. Only
 * the package-specific outcomes are registered — `PACKAGE_MANIFEST_INVALID`,
 * `PACKAGE_PUBLISH_FAILED`, `PACKAGE_DELETE_PARTIAL`, `PACKAGE_DELETE_FAILED`.
 *
 * [#8016] "An **unexpected** throw is `INTERNAL_ERROR`" is the sentence above,
 * and it was right — the CODE had drifted wider than it. Every one of the four
 * catch-alls treated *every* throw as unexpected, so a coded, status-carrying
 * refusal from below (`409 DESTRUCTIVE_CHANGE` out of the metadata protocol,
 * reached through `packageService.publish` / `.delete`) was answered as a
 * server fault. The word doing the work is "unexpected": a throw that DECLARES
 * its own status and a registered code is not unexpected, it is a refusal, and
 * it now leaves through {@link sendThrownError} carrying both. `INTERNAL_ERROR`
 * is still exactly what an unexpected throw gets — the sentence is unchanged
 * because it was never the thing that was wrong.
 */
export function registerPackageRoutes(
  server: IHttpServer,
  resolvePackageService: PackageServiceResolver,
  basePath: string = '/api/v1',
  options: PackageRoutesOptions = {},
): readonly DirectMountedRoute[] {
  const packagesPath = `${basePath}/packages`;

  /**
   * The always-mounted half — see "Which of these four mount" above.
   */
  const publishRoute: DirectMountedRoute =
  // POST /api/v1/packages/publish - Publish a package to the marketplace
  {
    method: 'POST',
    path: `${packagesPath}/publish`,
    metadata: { summary: 'Publish a package to the marketplace registry', tags: ['packages'] },
    handler: async (req, res) => {
    try {
      if (await refusePackageRequest(options, req, res, 'write')) return;
      // Resolved HERE, not at composition (#7563). Authorization runs first so
      // an anonymous prober cannot read a deployment's capability composition
      // off this seam.
      const packageService = resolvePackageService();
      if (!packageService) {
        // The honest answer for a surface this host does not serve. It names
        // the surface rather than a package id, so it cannot be confused with
        // the `RESOURCE_NOT_FOUND` a real publish emits for a missing package,
        // and it can never be the `405` of a route that merely shares the
        // `/packages` prefix.
        sendError(
          res,
          404,
          'RESOURCE_NOT_FOUND',
          'This deployment serves no marketplace publish surface — it composes no `package` service. '
          + "Add the `marketplace` capability to the app's `requires` to enable publishing.",
        );
        return;
      }
      const { manifest, metadata } = req.body || {};

      if (!manifest || !metadata) {
        sendError(res, 400, 'MISSING_REQUIRED_FIELD', 'Missing required fields: manifest, metadata');
        return;
      }

      if (!manifest.id || !manifest.version) {
        sendError(res, 400, 'PACKAGE_MANIFEST_INVALID', 'Invalid manifest: id and version are required');
        return;
      }

      const result = await packageService.publish({ manifest, metadata });

      if (result.success) {
        sendOk(res, {
          message: `Published ${manifest.id}@${manifest.version}`,
          package: {
            id: manifest.id,
            version: manifest.version,
          },
        });
        return;
      }

      // [#8131] A REPORTED publish failure is a DRIVER FAULT, and a driver
      // fault is a **5xx**. This answered `400` for as long as it existed —
      // telling a caller to fix a request that was never the problem, and
      // hiding a real server fault from every dashboard that buckets by
      // status. It is the mirror of what #8016 fixed on the throw path there
      // (`a caller who was refused was told the platform had broken`); here
      // the platform broke and the caller was told they had made a mistake.
      //
      // The CALLER's own errors on this route are unaffected and still 4xx:
      // the missing-field and invalid-manifest refusals above are checked
      // before `publish` is called at all, and a coded refusal thrown from
      // below `publish` is re-thrown by the producer and answered by
      // {@link sendThrownError} with its own status (#8016) — so a `409
      // DESTRUCTIVE_CHANGE` is still a 409, not swept in here.
      //
      // The code stays `PACKAGE_PUBLISH_FAILED` rather than becoming
      // `INTERNAL_ERROR`: it is registered, it is more informative than the
      // generic fallback, and it discloses nothing (the *message* was the
      // disclosure, and the producer no longer emits one). `envelopeViolations`
      // imposes no code↔status agreement, so a registered code on a 5xx is
      // conformant — `SERVICE_UNAVAILABLE` at 503 is the same shape.
      //
      // `result.driverFault.message` is a CONSTANT the producer owns and never
      // interpolates into; the `??` arm is not a leniency alias but the answer
      // for a `PackageService` implementation that reports failure without
      // saying why, which is the one thing the old `error?: string` could not
      // distinguish from a driver dump.
      sendError(
        res,
        500,
        'PACKAGE_PUBLISH_FAILED',
        result.driverFault?.message ?? `Failed to publish ${manifest.id}.`,
      );
    } catch (error) {
      sendThrownError(res, error);
    }
    },
  };

  /**
   * The service-gated half — mounted only when a `package` service is
   * reachable, because each of these three SHADOWS a live dispatcher twin at
   * the same pattern and a degraded shadow is worse than no shadow.
   *
   * These take the RESOLVED service, not the resolver: the gate below already
   * decided on presence, and handing them an optional they would each have to
   * re-check would add three branches no deployment can reach. Their bodies are
   * unchanged from before #7563.
   */
  const serviceGatedRoutes = (packageService: PackageService): readonly DirectMountedRoute[] => [
  // GET /api/v1/packages - List all packages (merges registry + database)
  {
    method: 'GET',
    path: packagesPath,
    metadata: { summary: 'List packages (registry + published)', tags: ['packages'] },
    handler: async (_req, res) => {
    try {
      if (await refusePackageRequest(options, _req, res, 'read')) return;
      // Merge two sources:
      // 1. Registry packages (in-memory, loaded at boot via defineStack/AppPlugin)
      // 2. Database packages (published via POST /packages)
      const packagesMap = new Map<string, any>();

      // Registry packages (via protocol service → SchemaRegistry)
      if (options.protocol && typeof options.protocol.getMetaItems === 'function') {
        try {
          const result = await options.protocol.getMetaItems({ type: 'package' });
          if (result?.items) {
            for (const item of result.items) {
              const id = item.manifest?.id || item.id;
              if (id) {
                packagesMap.set(id, {
                  ...item,
                  source: 'registry',
                });
              }
            }
          }
        } catch {
          // Protocol unavailable — continue with database only
        }
      }

      // Database packages (published artifacts)
      try {
        const dbPackages = await packageService.list();
        for (const pkg of dbPackages) {
          const id = pkg.manifest?.id || pkg.id;
          if (id) {
            // Database entry takes precedence (has richer metadata from publish)
            packagesMap.set(id, {
              ...packagesMap.get(id),
              ...pkg,
              source: packagesMap.has(id) ? 'both' : 'database',
            });
          }
        }
      } catch {
        // Database query failed — continue with registry-only packages
      }

      const packages = Array.from(packagesMap.values());
      sendOk(res, { packages, total: packages.length });
    } catch (error) {
      sendThrownError(res, error);
    }
    },
  },

  // GET /api/v1/packages/:id - Get a specific package
  {
    method: 'GET',
    path: `${packagesPath}/:id`,
    metadata: { summary: 'Get a package by id', tags: ['packages'] },
    handler: async (req, res) => {
    try {
      if (await refusePackageRequest(options, req, res, 'read')) return;
      const packageId = req.params.id;
      const requested = readSingleQueryValue(req.query?.version);
      if (!requested.ok) {
        sendError(res, 400, 'VALIDATION_ERROR', repeatedQueryParamMessage('version', requested.count));
        return;
      }
      const version = requested.value || 'latest';

      // Try database first (richer data from publish)
      const pkg = await packageService.get(packageId, version);
      if (pkg) {
        sendOk(res, { package: { ...pkg, source: 'database' } });
        return;
      }

      // Fall back to registry (in-memory loaded packages)
      if (options.protocol && typeof options.protocol.getMetaItems === 'function') {
        try {
          const result = await options.protocol.getMetaItems({ type: 'package' });
          const match = result?.items?.find((item: any) =>
            (item.manifest?.id || item.id) === packageId
          );
          if (match) {
            sendOk(res, { package: { ...match, source: 'registry' } });
            return;
          }
        } catch {
          // Protocol unavailable
        }
      }

      sendError(res, 404, 'RESOURCE_NOT_FOUND', `Package "${packageId}" was not found.`);
    } catch (error) {
      sendThrownError(res, error);
    }
    },
  },

  // DELETE /api/v1/packages/:id - Delete a package
  {
    method: 'DELETE',
    path: `${packagesPath}/:id`,
    metadata: { summary: 'Delete a package', tags: ['packages'] },
    handler: async (req, res) => {
    try {
      if (await refusePackageRequest(options, req, res, 'write')) return;
      const packageId = req.params.id;
      // Refused BEFORE the branch below, because the branch below is exactly
      // what a repeated `?version=` silently changed (#6307): the truthiness of
      // `version` is what decides full uninstall vs version-scoped delete.
      const requested = readSingleQueryValue(req.query?.version);
      if (!requested.ok) {
        sendError(res, 400, 'VALIDATION_ERROR', repeatedQueryParamMessage('version', requested.count));
        return;
      }
      const version = requested.value;

      // [#2747] A FULL uninstall (no version pin) goes through
      // protocol.deletePackage — one uninstall semantic, not three dialects:
      // it removes the package's metadata rows, drops the durable
      // sys_packages record, and runs the registered data-plane cleanups
      // (plugin-security revokes the package's permission sets/bindings —
      // no ghost grants). A version-scoped delete keeps the narrow durable
      // registry semantics, as does a deployment without the protocol.
      if (!version && typeof options.protocol?.deletePackage === 'function') {
        // [#7780] `allTenants: true` is stated, not implied. This registrar has
        // no organization to resolve — `packages/rest` carries no
        // `resolveActiveOrganizationId` and no org plumbing at all (the
        // dispatcher twin owns that seam), so of the two doors the ruling
        // allows — resolve an org, or declare the cross-tenant intent — only
        // the second is available here.
        //
        // This preserves the behaviour this door has always had (a full
        // uninstall through it is package-wide, which #7705 case 4 pinned on
        // purpose); what changes is that the width is now DECLARED at the call
        // site instead of being inferred from an argument nobody passed. The
        // protocol now refuses the undeclared form outright, so the two doors
        // can no longer disagree by accident.
        const result = await options.protocol.deletePackage({ packageId, allTenants: true });
        // Zero metadata rows is still a successful uninstall (e.g. a
        // runtime-registered package that never published metadata) —
        // only per-item failures make it a failure.
        if (result.failedCount === 0) {
          sendOk(res, {
            message: `Deleted ${packageId}`,
            deletedCount: result.deletedCount,
            cleanups: result.cleanups,
          });
          return;
        }
        // Was a bare `{ success: false, failed, cleanups }` — a failure with no
        // `error` at all, so a caller learned that it failed but never why. The
        // per-item detail is preserved under the declared `error.details`.
        sendError(
          res,
          400,
          'PACKAGE_DELETE_PARTIAL',
          `Deleting ${packageId} left ${result.failedCount} item(s) behind.`,
          { details: { failed: result.failed, cleanups: result.cleanups } },
        );
        return;
      }

      const result = await packageService.delete(packageId, version);

      if (result.success) {
        sendOk(res, {
          message: `Deleted ${packageId}${version ? `@${version}` : ''}`,
        });
        return;
      }

      // The other bare `{ success: false }`.
      sendError(
        res,
        400,
        'PACKAGE_DELETE_FAILED',
        `Failed to delete ${packageId}${version ? `@${version}` : ''}.`,
      );
    } catch (error) {
      sendThrownError(res, error);
    }
    },
  },
  ];

  /**
   * ONE declaration of this registrar's surface (#5822): the array below is
   * what gets mounted on the host server AND what is handed back as the
   * description of what was mounted. There is no second table to keep in sync —
   * see `direct-mount.ts` for why that identity is the whole point. The gate is
   * inside the declaration rather than around the call, so "what was mounted"
   * stays the array that mounted it on both branches.
   */
  const packageService = resolvePackageService();
  const routes: readonly DirectMountedRoute[] = packageService
    ? [publishRoute, ...serviceGatedRoutes(packageService)]
    : [publishRoute];

  return mountDirectRoutes(server, routes);
}
