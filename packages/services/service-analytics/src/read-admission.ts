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
 * The provider is access-NARROWING, so it fails CLOSED — but "closed" is a
 * claim about a WIRED provider, and it is worth saying which states are which:
 *
 *   - a wired provider that THROWS, or answers `false`, denies (this module);
 *   - a `security` service that is wired but cannot be used — resolving it
 *     throws, or it exposes neither `canReadObject` nor `explain` — denies at
 *     the bridge, because `/data`'s middleware does not fall open in those
 *     states either (`plugin.ts`);
 *   - an ABSENT provider is a different state altogether. No security service
 *     answered at all, which is the same deployment in which `/data` has no
 *     object-level gate either, so the two doors still AGREE — and agreement is
 *     the property being defended, not refusal for its own sake. Such a
 *     deployment keeps its pre-existing analytics behaviour, and
 *     `AnalyticsServicePlugin` logs that state loudly at init, the same posture
 *     it already takes for a missing `getReadScope`.
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
 * server-side log at the producing site carries the detail.
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
 * The object-level read admission provider the service asks.
 *
 * MAY be async — the production bridge resolves the verdict from the
 * `security` service, which can hit the database. Returns `true` to admit and
 * `false` to refuse; a throw is a refusal (fail-closed).
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
      throw readAdmissionDeniedError(objectName);
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
