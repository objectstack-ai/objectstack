// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Object-level API exposure gate (ADR-0049, #1889, #3391).
 *
 * Objects declare `apiEnabled` (default true) and an optional `apiMethods`
 * whitelist. The HTTP/MCP data dispatch decides, for a given data action,
 * whether the object's declared exposure permits it. Both fields live in the
 * object's `enable` capability block.
 *
 * ## What #3391 changed here
 *
 * 1. **Nested-first shape.** `meta.getObject()` returns the full object schema
 *    with `apiEnabled`/`apiMethods` under `.enable`. The previous version read
 *    them off the *flat* top level, so the dispatcher/MCP whitelist never fired
 *    (a silent dead gate). We now read `def.enable` first, falling back to the
 *    flat shape for legacy/test doubles.
 * 2. **Shared derivation.** The action→operation mapping and the three-state
 *    whitelist semantics are no longer duplicated here — they come from the
 *    spec's single source of truth (`@objectstack/spec/data`
 *    `resolveEffectiveApiMethods` / `isApiOperationAllowed`).
 * 3. **`[]` = deny-all.** An empty whitelist now means "expose nothing" (405),
 *    matching the documented three-state contract, instead of the prior
 *    fail-open "no restriction".
 *
 * An unresolvable object definition still fails OPEN — that matches the schema
 * defaults (`apiEnabled` true, no `apiMethods`) and avoids breaking traffic when
 * metadata is briefly unavailable. The gate is a no-op for system/internal
 * contexts (callers pass `isSystem` and skip this check entirely).
 *
 * ## #3545 — fail-open residual-risk decision
 *
 * This gate is a SURFACE-AREA control (which API operations an object exposes),
 * NOT the authorization boundary — every request still passes auth and the
 * ObjectQL security middleware (CRUD / FLS / RLS) on the data call regardless of
 * the outcome here. So a fail-open on unresolvable metadata cannot bypass data
 * authorization; at worst an operation the author meant to HIDE from the API is
 * transiently reachable (still fully access-controlled).
 *
 * That premise is load-bearing, so it was VERIFIED rather than assumed — and as
 * first stated it was wrong. The middleware does run unconditionally, but two of
 * its INPUTS were read from this same object metadata and defaulted permissively
 * when it could not be resolved: `access.default` read as PUBLIC (so a plain `'*'`
 * wildcard covered an object ADR-0066 D2 excludes from it) and `requiredPermissions`
 * read as NO CONTRACT (so the D3 capability AND-gate was skipped). The very trigger
 * this issue is about therefore reached one layer PAST the surface-area gate, into
 * the boundary itself. Closed in plugin-security's `getObjectSecurityMeta`, which
 * now flags an unresolved posture so the middleware, `canExport` and
 * `getReadableFields` fail CLOSED on it (pinned by
 * `metadata-unresolvable-posture.test.ts`). With the boundary now actually
 * unconditional, the tiered decision below stands:
 *   • Metadata service not ready / whole registry unavailable (cold start,
 *     registration race, scoped kernel warming) → KEEP fail-open. Failing closed
 *     would 405 every request during the normal startup window for no security
 *     gain (the data call fails or is authorized independently). Callers that
 *     read metadata (e.g. the REST `loadObjectItems`) LOG a thrown read so a
 *     PERSISTENT outage is observable instead of a silent blanket-allow.
 *   • Object resolvable but its `enable`/`apiMethods` is present-yet-unreadable
 *     (a non-array policy) → `resolveEffectiveApiMethods` resolves it to
 *     `deny-all` (fails CLOSED) since the #3543 exposure-semantics window. The
 *     path is unreachable through the Zod-validated registration flow (only a
 *     raw/out-of-band metadata write can produce it).
 */

import {
  resolveEffectiveApiMethods,
  isApiOperationAllowed,
  effectiveOperationsArray,
  DATA_ACTION_TO_API_OPERATION,
  type EnableLike,
} from '@objectstack/spec/data';

/** The exposure-relevant slice of an object definition (flat or nested). */
export interface ObjectApiDef {
  apiEnabled?: boolean;
  apiMethods?: string[] | null;
  /** Real `getObject()` shape — the exposure flags live under `enable`. */
  enable?: EnableLike | null;
  [key: string]: unknown;
}

export interface ApiExposureDecision {
  allowed: boolean;
  /** HTTP status to return when denied (404 hides, 405 = method not allowed). */
  status?: number;
  reason?: string;
  /** The effective operation set (enum-ordered) — surfaced on a 405 denial. */
  allowedOperations?: string[];
}

/**
 * Resolve the `enable` capability block from either the nested `getObject()`
 * shape (`{ enable: {...} }`) or a flat legacy/test shape (`{ apiEnabled, ... }`).
 * Nested wins when present.
 */
function resolveEnableBlock(def: ObjectApiDef): EnableLike {
  if (def.enable && typeof def.enable === 'object') return def.enable;
  return def as EnableLike;
}

/**
 * Decide whether a data `action` is permitted for `def`'s declared exposure.
 *
 * @param def    Object definition (nested `getObject` shape or flat).
 * @param action Runtime data action; normalized to a canonical operation
 *               internally. The only caller is `callData`, whose closed set is
 *               `create`/`get`/`update`/`delete`/`query`/`find`/`aggregate`.
 *               (#6259 removed one more name from this list: `callData` has had
 *               no `batch` arm since #5856, so no caller could ever send that
 *               word. Batching reaches this gate from REST as canonical `bulk`.)
 * @param opts   Optional `writeMode` (import precision) / `bulkChild` (bulk∧child).
 */
export function checkApiExposure(
  def: ObjectApiDef | null | undefined,
  action: string,
  opts?: { writeMode?: string; bulkChild?: string },
): ApiExposureDecision {
  // Unresolvable definition → fall open to the schema defaults.
  if (!def) return { allowed: true };

  const enable = resolveEnableBlock(def);

  // `apiEnabled: false` hides the object from the API entirely → 404.
  if (enable.apiEnabled === false) {
    return { allowed: false, status: 404, reason: 'object is not exposed via the API' };
  }

  const eff = resolveEffectiveApiMethods(enable);
  // Unrestricted (no whitelist) → allow everything, exactly as before.
  if (eff.mode === 'unrestricted') return { allowed: true };

  // Normalize the runtime action onto a canonical ApiMethod operation. An
  // action with no mapping is not gated by `apiMethods` (respects `apiEnabled`
  // only), preserving the prior behavior for custom actions.
  const operation = DATA_ACTION_TO_API_OPERATION[action] ?? action;

  if (isApiOperationAllowed(eff, operation, opts)) return { allowed: true };

  return {
    allowed: false,
    status: 405,
    reason: `API operation '${operation}' is not allowed for this object`,
    allowedOperations: effectiveOperationsArray(eff),
  };
}
