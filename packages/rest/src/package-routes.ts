// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { IHttpServer, shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE, rethrowAuthzStoreUnavailable } from '@objectstack/core';
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
  demotedDeclaredCode,
  looksLikeInternalErrorLeak,
  INTERNAL_ERROR_MESSAGE,
} from '@objectstack/types';
import { mountDirectRoutes, type DirectMountedRoute } from './direct-mount.js';

/**
 * [#7033 / #7023] The authorization gate for the REST package transport.
 *
 * `/packages` had TWO HTTP transports and both were ungated: the runtime
 * dispatcher domain (`packages/runtime/src/domains/packages.ts`) AND this
 * `@objectstack/rest` direct-mount registrar. Gating only the dispatcher would
 * have left this registrar's routes open — the exact one-transport gap
 * #6603/#7019 paid for on `/meta`.
 *
 * [#14503] Since the registrar mounts ONE route — `POST /packages/publish`,
 * the only verb+path here with no dispatcher twin — the gate has one cohort:
 * the same ruled policy as the dispatcher (maintainer, 2026-08-09), a
 * domain-wide anonymous floor, then `manage_metadata` for the state-changing
 * verb. The read cohort (`studio.access` / `setup.access`, ADR-0106 D4) is
 * enforced where the reads are served — the dispatcher domain is the single
 * implementation of `GET /packages` and `GET /packages/:id` now, and
 * `packages/runtime/src/domains/packages-capability-gate.test.ts` pins that
 * cohort. The public MARKETPLACE browse is a different surface
 * (`/marketplace/packages`, MarketplaceProxyPlugin) — this `/api/v1/packages`
 * route is management, so denying anonymous here strands no public browse.
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
): Promise<boolean> {
  // [#13279] The gate's OWN net. `rethrowAuthzStoreUnavailable` keeps the
  // fail-closed default for every fault except a permission-store outage, which
  // must reach `handlePackageRouteError` and be answered as the 503
  // `SERVICE_UNAVAILABLE` it is — never as a capability denial the caller could
  // mistake for "you lack `manage_metadata`".
  const ctx = options.resolveExecutionContext
    ? await options.resolveExecutionContext(req).catch(rethrowAuthzStoreUnavailable)
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
  const allowed = ctx?.isSystem || held.has('manage_metadata');
  if (!allowed) {
    // Same wrapped envelope, one FORBIDDEN code — the sibling `/meta` REST
    // capability gate's shape, built through the shared `sendError`.
    sendError(res, 403, 'FORBIDDEN', 'Managing packages requires the `manage_metadata` capability.');
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
 * It was also a disagreement rather than merely a bug. The dispatcher's
 * `/packages` domain (`packages/runtime/src/domains/packages.ts` →
 * `errorFromThrown`) has always read `.status` first and answered 409 for the
 * same throw, so the two doors that then served `/api/v1/packages` answered
 * one refusal two ways. (Since #14503 the read and delete twins are gone from
 * this registrar — the dispatcher domain is their single implementation — and
 * the rule below governs the one route left, `POST /packages/publish`.)
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
 * It was reachable, not theoretical, and was reproduced through this
 * registrar before being fixed — a real `ObjectQL` engine and a real
 * `ObjectStackProtocolImplementation` whose driver fails the `sys_metadata`
 * read the way a missing table does. The registrar's then-mounted
 * `DELETE /api/v1/packages/:id` (removed by #14503) with no `?version=` routed
 * to `protocol.deletePackage`, whose FIRST database touch
 * (`engine.find('sys_metadata', { where })`) sits outside that method's
 * per-item `try`, so the driver line propagated whole and arrived here:
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
 * this registrar, because it does not go through `resolveErrorResponse` at all
 * — and for `POST /packages/publish` this registrar is the only door, so an
 * unfiltered answer here is the live one.
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
 * client-facing messages at all — which is a separate card. Pinned on the
 * publish route in `package-door-5xx-message-sanitization.test.ts` so it goes
 * red the day either lands.
 */
function sendThrownError(res: any, error: unknown): void {
  const thrown = resolveThrownHttpError(error);
  // The dispatcher twin's expression, byte for byte — one rule, two doors.
  const message = thrown.status >= 500 && looksLikeInternalErrorLeak(thrown.message)
    ? INTERNAL_ERROR_MESSAGE
    : thrown.message;
  // [#12405] The producer's OWN spelling, when the closed vocabulary did not
  // admit it — the same demote the dispatcher twin serving this very path has
  // emitted since #9106 (`errorFromThrown` in
  // `packages/runtime/src/http-dispatcher.ts`) and the flat `/data` door since
  // #9232 (`thrownCodeFields` in `error-response.ts`). This helper already
  // held the resolved answer and forwarded only `details`, so the author's
  // string was dropped one line below the local that carried it: nothing
  // invalid shipped — the closed `code` still carried the derived member —
  // which is exactly what made the loss silent and one-directional.
  //
  // ⛔ Read through {@link demotedDeclaredCode}, NEVER `thrown.declaredCode`
  // raw. Presence MEANS demotion (`ApiErrorSchema.declaredCode`'s documented
  // invariant), and the raw field is also set when the producer's spelling IS
  // the member already sitting in `code` — forwarding that would put two
  // spellings of one fact on every registered refusal. `sendError`
  // deliberately does not re-derive this; the caller owes it (that writer's
  // docblock records the obligation).
  //
  // ⚠️ NOT withheld on the sanitised 5xx above, deliberately: this door's
  // withholding is scoped to the PROSE (see the note on this function), and
  // `status`, `code` and `details` are untouched by it. `declaredCode` is a
  // CODE channel, and the twin applies no status condition to it either —
  // adding one here would be a new rule at one door and would re-create the
  // divergence this closes.
  const declaredCode = demotedDeclaredCode(thrown);
  // [#12502] The producer's user-facing refusal text (#9934), the SECOND
  // declared channel this writer was holding and dropping. A third spread into
  // the same object, and the three do not interact: `details` is structured
  // context, `declaredCode` is a code spelling, `userMessage` is prose a
  // producer marked AT THROW TIME as addressed to the end user.
  //
  // The idiom is the INVERSE of `declaredCode`'s directly above, and the
  // inversion is the whole point of this being a separate change rather than a
  // rider. Read `thrown.userMessage` RAW: `resolveThrownHttpError` has already
  // applied `declaredUserMessage`'s non-empty-string rule when it built the
  // field, and presence here means only "the producer opted in". `declaredCode`
  // needs `demotedDeclaredCode` because its raw field carries a SECOND meaning
  // — it is also set when the producer's spelling IS the registered member, so
  // forwarding it raw would put two spellings of one fact on every registered
  // refusal. ⛔ `userMessage` has no second meaning, so there is no caller
  // obligation to re-derive and inventing one to match the sibling would be the
  // mistake, not the safe choice. Byte for byte the dispatcher twin's
  // expression (`errorFromThrown`, `packages/runtime/src/http-dispatcher.ts`),
  // which serves this same path and has emitted the channel since #9934.
  //
  // ⚠️ NOT withheld on the sanitised 5xx above, and this one needs no judgement
  // call: the withhold rewrites a LOCAL `message` const, and
  // `looksLikeInternalErrorLeak` is only ever handed `thrown.message`, so
  // `thrown.userMessage` is never an input to it. A marked text is the
  // producer's deliberate statement to the caller at any status — the ruling
  // that created the channel made it status-agnostic on purpose.
  const extra = {
    ...(thrown.details ? { details: thrown.details } : {}),
    ...(declaredCode !== undefined ? { declaredCode } : {}),
    ...(thrown.userMessage !== undefined ? { userMessage: thrown.userMessage } : {}),
  };
  sendError(
    res,
    thrown.status,
    thrown.code,
    message,
    Object.keys(extra).length > 0 ? extra : undefined,
  );
}

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
 * taken. Resolving per request is what lets the HANDLER answer for the
 * deployment it is really on.
 *
 * ⚠️ [#14503] It never made the MOUNT decision independent of composition
 * order, whatever this docblock used to claim: `registerPackageRoutes` still
 * asked the resolver ONCE, at registration time, to decide whether to mount
 * its three service-gated routes — so on that same showcase boot those three
 * were never mounted at all (measured: 147 registrations with the service
 * absent against 150 with it present; the dispatcher's `/packages` domain
 * answered every read and delete). That gate is gone with the routes; the one
 * route left mounts unconditionally and this resolver is consulted only per
 * request.
 */
export type PackageServiceResolver = () => PackageService | undefined;

/**
 * Options for package route registration.
 */
export interface PackageRoutesOptions {
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
 * Register the REST package management route.
 *
 * Returns the routes it mounted, so the caller can record them on the
 * `RestServer` that owns the surface (#5822) — the returned array IS the array
 * that was iterated to mount, never a second, hand-kept table.
 *
 * Routes:
 * - POST /api/v1/packages/publish - Publish a package to the marketplace registry
 *
 * ## One route, and why (#14503)
 *
 * This registrar used to mount three more — `GET /packages`,
 * `GET /packages/:id` and `DELETE /packages/:id` — gated on the `package`
 * service and documented as SHADOWING the dispatcher's twins at the same
 * patterns. Neither half of that sentence held on a stock boot: the gate asked
 * `resolvePackageService()` ONCE, here, inside `RestApiPlugin.start()`, and
 * `objectstack serve` registers `PackageServicePlugin` AFTER
 * `createRestApiPlugin`, so the three were never mounted at all (measured: 147
 * registrations with the service absent against 150 with it present, the
 * 3-route delta exactly) and the dispatcher's `/packages` domain answered
 * every request — with its own 404 wording (`Package '<id>' not found`) and
 * its own envelope (the bare row under `data`, no `{ package }` wrapper and no
 * `source` stamp). Two implementations of one URL that had already diverged
 * were ruled (maintainer, 2026-09-02, on #14503) to become one: the three
 * routes are gone, `packages/runtime/src/domains/packages.ts` is the single
 * implementation, and `packages/runtime/src/domains/packages-single-door.test.ts`
 * pins the surviving door's wording and envelope so "which door answered"
 * stays observable. The REST-only `source: 'registry' | 'database' | 'both'`
 * stamp and the `?version=` read (with its repeated-parameter refusal) on
 * those verbs went with the routes — recorded in the `@objectstack/rest`
 * changeset as deliberately removed, not silently dropped.
 *
 * `POST /packages/publish` stays because it has NO twin (#7563): nobody else
 * serves that verb+path, so when this registrar sat out, the request did not
 * 404 — it was absorbed by the dispatcher's `/packages/:id` (with
 * `id = "publish"`), and the router answered `405` with
 * `Allow: DELETE, GET, HEAD, PATCH`: ANOTHER route's method set, describing
 * verbs that would each operate on a package literally named `publish`. "Use
 * a different method" is the one answer that misinforms here, because `POST`
 * is the only verb this surface ever had. Mounting it always means the path
 * has an owner that can tell the truth — the handler when a package service
 * is reachable, and an honest 404 naming this surface when none is.
 *
 * Marketplace publish lives at `/packages/publish`, NOT at the bare
 * `POST /packages` (#3610): that verb+path is the dispatcher packages
 * domain's *install* route, and a registrar claiming it swallowed every
 * `client.packages.install` call with a 400. The dispatcher's own
 * `POST /packages/:id/publish` (ADR-0033 draft publish) is two segments —
 * different shape, no clash.
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
 * surface is `RESOURCE_NOT_FOUND`, an unexpected throw is `INTERNAL_ERROR`.
 * Only the package-specific outcomes are registered — `PACKAGE_MANIFEST_INVALID`
 * and `PACKAGE_PUBLISH_FAILED` on this route (`PACKAGE_DELETE_PARTIAL` and
 * `PACKAGE_DELETE_FAILED` belonged to the delete route #14503 removed and stay
 * in the ledger only as history).
 *
 * [#8016] "An **unexpected** throw is `INTERNAL_ERROR`" is the sentence above,
 * and it was right — the CODE had drifted wider than it. Every one of the
 * catch-alls treated *every* throw as unexpected, so a coded, status-carrying
 * refusal from below (`409 DESTRUCTIVE_CHANGE` out of the metadata protocol,
 * reached through `packageService.publish`) was answered as a server fault.
 * The word doing the work is "unexpected": a throw that DECLARES its own
 * status and a registered code is not unexpected, it is a refusal, and it now
 * leaves through {@link sendThrownError} carrying both. `INTERNAL_ERROR` is
 * still exactly what an unexpected throw gets — the sentence is unchanged
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
   * The one route this registrar mounts — see "One route, and why" above.
   */
  const publishRoute: DirectMountedRoute =
  // POST /api/v1/packages/publish - Publish a package to the marketplace
  {
    method: 'POST',
    path: `${packagesPath}/publish`,
    metadata: { summary: 'Publish a package to the marketplace registry', tags: ['packages'] },
    handler: async (req, res) => {
    try {
      if (await refusePackageRequest(options, req, res)) return;
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
   * ONE declaration of this registrar's surface (#5822): the array below is
   * what gets mounted on the host server AND what is handed back as the
   * description of what was mounted. There is no second table to keep in sync —
   * see `direct-mount.ts` for why that identity is the whole point. No service
   * gate sits around it any more (#14503): the resolver is a per-request
   * concern of the handler, never a mount-time verdict.
   */
  const routes: readonly DirectMountedRoute[] = [publishRoute];

  return mountDirectRoutes(server, routes);
}
