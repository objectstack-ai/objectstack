// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one door permission data comes through on its way into
 * {@link EvalContext.permissions}.
 *
 * ## Why a door at all, when the payload already has the right shape
 *
 * `/auth/me/permissions` answers `{ objects, systemPermissions }` and its
 * `objects` map IS the `EvalContext.permissions` shape — object name ->
 * `EffectiveObjectPermission`. The conversion is therefore almost nothing, and
 * that is exactly the risk: "almost nothing" is what a caller re-implements by
 * hand, and a hand-built map is how the two ends drift. A map keyed on labels
 * instead of object names, a map carrying the raw `ObjectPermission` of ONE
 * permission set instead of the server-resolved effective entry, a map whose
 * values are booleans — every one of those parses as "an object" and every one
 * of them makes `can()` answer confidently and wrongly, because a permission
 * verdict has no shape of its own to be checked against.
 *
 * So the entries are parsed with the published schema and a payload that is not
 * the published shape is REFUSED, loudly, at the seam where the caller can still
 * fix it — rather than a release later, on somebody's screen, as a permission
 * check that silently says no.
 *
 * ## Cost, and where to pay it
 *
 * Call this ONCE per fetch of `/auth/me/permissions` and keep the result for as
 * long as the response is good for. ⛔ Do not call it per evaluation: the map is
 * pinned data and the engine re-reads it for free, so re-parsing per predicate
 * buys nothing and pays a full schema walk of every object the subject can see.
 */

import { EffectiveObjectPermissionSchema } from '@objectstack/spec/security';

import type { EvalPermissions } from './types';

/**
 * Build {@link EvalPermissions} from the `objects` map of a
 * `/auth/me/permissions` response.
 *
 * Accepts `unknown` on purpose — the payload usually arrives from the network,
 * where "it is typed" is a claim about the caller's declaration file rather
 * than about the bytes.
 *
 * @throws when `objects` is not a plain map of object name ->
 * `EffectiveObjectPermission`. The message names the offending object and what
 * the schema said about it; there is no lenient arm, no coercion and no
 * partial result, because half a permission map is the failure this refuses.
 */
export function toEvalPermissions(objects: unknown): EvalPermissions {
  if (objects === null || typeof objects !== 'object' || Array.isArray(objects)) {
    throw new TypeError(
      'toEvalPermissions(objects): expected the `objects` map of a /auth/me/permissions ' +
      `response (object name -> EffectiveObjectPermission), received ${describe(objects)}. ` +
      'Pass `response.objects`, not the whole response and not a permission set.',
    );
  }
  const out: Record<string, unknown> = {};
  for (const [object, value] of Object.entries(objects as Record<string, unknown>)) {
    const parsed = EffectiveObjectPermissionSchema.safeParse(value);
    if (!parsed.success) {
      throw new TypeError(
        `toEvalPermissions(objects): the entry for '${object}' is not an ` +
        `EffectiveObjectPermission — ${parsed.error.issues[0]?.message ?? 'invalid shape'} ` +
        `(at \`${object}${issuePath(parsed.error.issues[0]?.path)}\`). This map must be the ` +
        'server-resolved effective set from /auth/me/permissions, not an authored permission ' +
        "set's `objects` block.",
      );
    }
    out[object] = parsed.data;
  }
  return Object.freeze(out) as EvalPermissions;
}

/** A short, non-leaking description of a rejected payload for the error text. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/** `.a.b` for a zod issue path, or `''` when the issue is on the entry itself. */
function issuePath(path: readonly PropertyKey[] | undefined): string {
  if (!path || path.length === 0) return '';
  return path.map((segment) => `.${String(segment)}`).join('');
}
