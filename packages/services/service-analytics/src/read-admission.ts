// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The OBJECT-LEVEL read admission this service asks BEFORE it selects a
 * strategy — the layer the raw-SQL path had no way to inherit.
 *
 * ## What was wrong, in one request
 *
 * `POST /api/v1/analytics/dataset/query` accepts an INLINE dataset definition
 * (`body.dataset`) from any authenticated caller and compiles it to a
 * statement. On a SQL driver `NativeSQLStrategy` served that statement through
 * the driver's raw `execute()`, which is documented as a tenant-isolation
 * bypass ("Unlike `find`/`update`/`delete` etc., raw `execute()` does NOT
 * inject the `organization_id` predicate", `sql-driver.ts`) and which no
 * middleware sits in front of. So the request reached the database having
 * passed exactly ONE of the three read layers — the row scope, threaded since
 * ADR-0021 D-C through `getReadScope`. A job seeker with NO grant of any kind
 * on `ats_employer_member` was answered `200 {"rows":[{"cnt":24}]}` where
 * `GET /api/v1/data/ats_employer_member` answered `403 PERMISSION_DENIED`, on
 * the same deployment, for the same principal. The memory driver refused the
 * identical request, because there the query falls through to the ObjectQL
 * engine and the engine applies all three layers in one place.
 *
 * The exposure is not opt-in and an application cannot decline it: a
 * deployment with 0 datasets and 0 dashboards has the identical surface,
 * because the reachable slot is the INLINE definition rather than a declared
 * one.
 *
 * ## Why the fix is one gate at the door, not a layer per strategy
 *
 * Two strategies each enforcing their own copy of three layers is the CAUSE of
 * this defect, not its remedy — `driver-memory` is correct today precisely
 * because it hands the request to the engine and the engine applies the layers
 * once. So the admission question is asked HERE, at the service door, over the
 * same object set the read scope is resolved for, before any strategy is
 * chosen. Every strategy inherits the verdict by construction, and a strategy
 * added tomorrow inherits it without knowing this module exists.
 *
 * ## Why the row filter could not answer it
 *
 * `security.getReadFilter` answers "WHICH ROWS", and it answers `undefined` —
 * "no row restriction" — for a caller who may not read the object at all. A
 * door holding only the filter therefore reads a caller with NO grant as a
 * caller with NO restriction. That inversion is the whole defect, which is why
 * the admission verdict is a SEPARATE question
 * (`ISecurityService.canReadObject`) and why asking it is mandatory rather
 * than an optimisation of the filter path.
 *
 * ## Fail direction
 *
 * The provider is access-NARROWING, so it fails CLOSED, and it is worth saying
 * which states are which:
 *
 *   - a wired provider that answers `false` denies, `403 PERMISSION_DENIED`
 *     (this module);
 *   - a wired provider that THROWS refuses too, but it reached no verdict, so
 *     it does not answer as one: `503 SERVICE_UNAVAILABLE`
 *     ({@link readAdmissionUnresolvedError}), the cause in the server log;
 *   - a `security` service that is wired but cannot be used — resolving it
 *     throws, or it exposes neither `canReadObject` nor `explain` — refuses at
 *     the bridge, because `/data`'s middleware does not fall open in those
 *     states either (`plugin.ts`). The bridge reached no verdict, so it throws
 *     and the refusal answers `503 SERVICE_UNAVAILABLE` (#25561);
 *   - [#22235] a deployment that registers NO security service refuses at the
 *     bridge too, by declaration: the in-repo kernels (`ObjectKernel`,
 *     `LiteKernel`) throw on a `security` service nothing ever registered, so
 *     the bridge takes its UNUSABLE branch and refuses with a located error,
 *     `503 SERVICE_UNAVAILABLE` like the broken service above (the service is
 *     "not loaded"; #25561).
 *     `/data` carries no object-level gate on such a deployment, so there the
 *     two doors do NOT agree: a loud refusal is preferred over a silent admit. A
 *     composition that wants analytics to answer registers a security service,
 *     or its host supplies its own `admitObjectRead`;
 *   - a context that answers the `security` lookup with NOTHING (ABSENT) is a
 *     different state, reached only by such a context: the package's test
 *     doubles do, and no in-repo kernel does. What the bridge does there is
 *     documented at the bridge (`plugin.ts`); it is not a statement about
 *     deployments;
 *   - a host that constructs `AnalyticsService` itself with no provider at all
 *     gets no object-level gate (`assertReadAdmitted` is a no-op). That is the
 *     host's composition, not a deployment with no security service:
 *     `AnalyticsServicePlugin` always wires a provider — the host's
 *     `admitObjectRead`, or the bridge.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { StandardErrorCode } from '@objectstack/spec/api';

/**
 * `PERMISSION_DENIED`, pinned against the STANDARD catalog.
 *
 * Typed as `StandardErrorCode` so a misspelling fails `tsc` rather than
 * shipping a code `ApiErrorSchema` rejects. The same code and the same 403 the
 * ObjectQL/engine path already answers for this request, so the two strategies
 * are indistinguishable on the wire as well as in the verdict.
 */
const PERMISSION_DENIED: StandardErrorCode = 'PERMISSION_DENIED';

/**
 * The refusal, in the ADR-0112 envelope — `PERMISSION_DENIED` / 403.
 *
 * `/analytics/dataset/query` classifies a thrown error by reading `code` plus a
 * 4xx `status` (#5352), so declaring both is what makes this refusal answer 403
 * instead of falling through to `500 ANALYTICS_QUERY_FAILED`.
 *
 * ⛔ The message names the OBJECT and nothing else. It must not report which
 * layer refused, which permission set the caller holds, or whether the object
 * exists with different grants — an admission refusal that explains itself is
 * an oracle over exactly the metadata the refusal exists to withhold. The
 * server-side log at the producing site carries the detail. The same rule
 * binds the FAULT refusal below ({@link readAdmissionUnresolvedError}): it
 * names no layer, no grant and no existence fact either.
 *
 * This is the answer for a VERDICT only — the gate asked and was told "no".
 * A gate that could not ask answers {@link readAdmissionUnresolvedError}.
 */
export function readAdmissionDeniedError(objectName: string): Error {
  const err = new Error(
    `[Analytics] Access denied: reading "${objectName}" is not permitted for this user.`,
  ) as Error & { code?: string; status?: number; object?: string };
  err.code = PERMISSION_DENIED;
  err.status = 403;
  err.object = objectName;
  return err;
}

/**
 * `SERVICE_UNAVAILABLE`, pinned against the STANDARD catalog — an existing
 * ADR-0112 member that `HttpStatusErrorCodeMap` maps to 503.
 */
const SERVICE_UNAVAILABLE: StandardErrorCode = 'SERVICE_UNAVAILABLE';

/**
 * The FAULT refusal, in the ADR-0112 envelope — `SERVICE_UNAVAILABLE` / 503 —
 * for a read gate at this door that could not reach a verdict: the object-level
 * admission provider threw (this module), the field-level read permissions
 * could not be resolved (`field-read-admission.ts`), or the API exposure
 * declaration could not be read (`api-exposure-door.ts`).
 *
 * ## Why not the denial's 403
 *
 * Fail-closed is unchanged: nothing is admitted on this path. What changes is
 * what the refusal CLAIMS. Answered as {@link readAdmissionDeniedError}, an
 * outage was byte-identical to a real denial — the server asserted "you may
 * not read this" when it never decided — so a caller, a retry policy or a
 * build probe could not tell an access remedy from an operator one. That is
 * the class `@objectstack/core`'s `authz-store-unavailable.ts` ends for the
 * authz context, under the maintainer ruling quoted there; this answer takes
 * its spelling, `SERVICE_UNAVAILABLE` / 503, so no code is added to the
 * vocabulary and no envelope gains a key.
 *
 * ## One answer for the three gates
 *
 * ⛔ The message names the OBJECT and nothing else, the no-oracle rule of
 * {@link readAdmissionDeniedError}: not WHICH gate could not answer, not why,
 * not whether the object exists. It says only that the server could not
 * decide. The cause stays in the server log at the producing site.
 *
 * `/analytics/dataset/query` relays a declared 5xx's status and code (the
 * declared-fault arm), withholding the message as it does for every declared
 * server fault; the cube query door relays the status the same way. So this
 * reaches the wire as `503 SERVICE_UNAVAILABLE`, never as
 * `500 ANALYTICS_QUERY_FAILED`.
 */
export function readAdmissionUnresolvedError(objectName: string): Error {
  const err = new Error(
    `[Analytics] Read access to "${objectName}" could not be determined, so the query was not run. ` +
      'This is a server-side fault, not a permission denial.',
  ) as Error & { code?: string; status?: number; object?: string };
  err.code = SERVICE_UNAVAILABLE;
  err.status = 503;
  err.object = objectName;
  return err;
}

/**
 * The object-level read admission provider the service asks.
 *
 * MAY be async — the production bridge resolves the verdict from the
 * `security` service, which can hit the database. Returns `true` to admit and
 * `false` to refuse; a throw is a refusal too (fail-closed), answered as a
 * fault rather than a denial ({@link readAdmissionUnresolvedError}).
 */
export type ObjectReadAdmissionProvider = (
  objectName: string,
  context?: ExecutionContext,
) => boolean | Promise<boolean>;

/**
 * Log sink — the subset of `Logger` this module uses.
 *
 * `error` is OPTIONAL because hosts legitimately inject reduced sinks, and
 * `warn` is REQUIRED because of that: a sink declaring an optional `error` and
 * no guaranteed alternative is a contract that PERMITS SILENCE (#9754,
 * `check:optional-error-sink`). Every value of this type therefore has a
 * destination for a refusal report, and {@link assertObjectsReadable} reaches
 * for it when `error` is absent rather than dropping the report. A denial this
 * module makes is never allowed to be invisible: it is the one record that a
 * request was refused, and a security refusal nobody can see is
 * indistinguishable from a gate that never ran.
 */
interface AdmissionLogger {
  error?(message: string, error?: Error): void;
  warn(message: string): void;
}

/**
 * Refuse the query unless EVERY object it will read is admitted.
 *
 * `objects` is the base object plus every joined object — the same superset
 * `resolveReadScopes` scopes, derived from one shared helper so the set that is
 * ADMITTED and the set that is SCOPED are provably the same set. A join the
 * caller may not read is refused for the same reason `$expand` is refused on
 * `/data`: an expansion may reveal only rows the caller could have read
 * directly (#7626).
 *
 * Order is the object set's iteration order and the first refusal wins; the
 * refusal names that object, which the caller already named in their own
 * request body.
 */
export async function assertObjectsReadable(
  objects: Iterable<string>,
  provider: ObjectReadAdmissionProvider,
  context: ExecutionContext | undefined,
  logger?: AdmissionLogger,
): Promise<void> {
  for (const objectName of objects) {
    let admitted: boolean;
    try {
      admitted = await provider(objectName, context);
    } catch (e) {
      // Fail CLOSED. A resolution failure must deny — admitting on an error is
      // the shape this whole module exists to remove.
      const cause = e instanceof Error ? e : new Error(String(e));
      const report =
        `[Analytics] read-admission resolution failed for object "${objectName}" — ` +
        `denying query (fail-closed)`;
      // `error` is the right level for a gate that could not reach a verdict,
      // but it is optional on this sink; `warn` is not, so the report lands
      // either way. This is the guarantee the required `warn` above buys.
      if (logger?.error) logger.error(report, cause);
      else logger?.warn(`${report}: ${cause.message}`);
      // No verdict was reached, so the refusal does not claim one: 503, not
      // the 403 a real denial answers below.
      throw readAdmissionUnresolvedError(objectName);
    }
    if (!admitted) {
      logger?.warn(
        `[Analytics] object-level read admission denied for "${objectName}" ` +
          `(user ${String((context as { userId?: unknown } | undefined)?.userId ?? 'unknown')}) — ` +
          `the same verdict GET /data/${objectName} reaches`,
      );
      throw readAdmissionDeniedError(objectName);
    }
  }
}
