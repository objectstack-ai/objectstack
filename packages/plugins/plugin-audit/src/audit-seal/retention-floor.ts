// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { parseLifecycleDuration, type LifecycleRetentionFloor } from '@objectstack/objectql';

/**
 * [ADR-0154 D8] On a sealed object, a retention override cannot shorten the
 * declared window.
 *
 * A sealed object's rows leave only by whole checkpoints, each run's `expiry`
 * amendment signed first, and that amendment signs the window it expired
 * under. The declared window is what the object's owner published; the
 * `lifecycle` settings namespace may still lengthen it (globally, or for one
 * organization), never shorten it. The mechanism is the one the job queue uses
 * for its idempotency window (#5195): a retention floor per sealed object at
 * its declared window, so the lifecycle service rejects an override below it,
 * keeps the declared window, and reports the rejection at `error`.
 *
 * Which windows: the ones the sealed expiry runs under on an object that
 * declares no `archive` — `retention.maxAge` and `ttl.expireAfter`. An
 * archiving sealed object expires only past `archive.keep`, which no settings
 * key reaches, and its other window decides when a row moves to the archive,
 * not when it leaves.
 */

/** Who the floors are registered by: named in every rejection the lifecycle service reports. */
export const AUDIT_SEAL_FLOOR_REGISTRAR = 'com.objectstack.plugin.audit.seal';

/** The `lifecycle` slot's floor seam, as this package consumes it. */
export interface SealedFloorRegistrar {
  registerRetentionFloor?(object: string, floor: LifecycleRetentionFloor): void;
}

interface SealedLifecycleLike {
  seal?: unknown;
  archive?: unknown;
  retention?: { maxAge?: unknown };
  ttl?: { expireAfter?: unknown };
}

/** The window's literal in milliseconds, or `null` when it does not parse to a positive window. */
function windowMs(literal: unknown): number | null {
  if (typeof literal !== 'string') return null;
  try {
    const ms = parseLifecycleDuration(literal);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    // The lifecycle service cannot apply a window it cannot parse either, and reports that object itself.
    return null;
  }
}

function floorOf(object: string, policy: 'retention' | 'ttl', key: string, literal: string, ms: number): LifecycleRetentionFloor {
  return {
    policy,
    minWindowMs: ms,
    declaredBy: AUDIT_SEAL_FLOOR_REGISTRAR,
    consequence:
      `${object} is sealed (lifecycle.seal), so its expiry signs the window it expired under; a window shorter ` +
      `than the declared ${policy === 'ttl' ? 'ttl.expireAfter' : 'retention.maxAge'} '${literal}' is not applied.`,
    remedy:
      `remove the ${key} override for ${object}, or raise it to at least '${literal}'; to keep its rows for less ` +
      'time, shorten the window the object declares.',
  };
}

/** The floors one object definition takes: one per window its sealed expiry runs under, at the declared value. */
export function sealedWindowFloors(object: { name: string; lifecycle?: unknown }): LifecycleRetentionFloor[] {
  const lc = object.lifecycle as SealedLifecycleLike | undefined;
  if (!lc?.seal || lc.archive) return [];
  const floors: LifecycleRetentionFloor[] = [];
  const maxAge = lc.retention?.maxAge;
  const retentionMs = windowMs(maxAge);
  if (retentionMs !== null) floors.push(floorOf(object.name, 'retention', 'maxAge', maxAge as string, retentionMs));
  const expireAfter = lc.ttl?.expireAfter;
  const ttlMs = windowMs(expireAfter);
  if (ttlMs !== null) floors.push(floorOf(object.name, 'ttl', 'expireAfter', expireAfter as string, ttlMs));
  return floors;
}

/**
 * Register {@link sealedWindowFloors} for every object `objects` holds. A floor
 * is keyed by object, policy and registrar, so registering again replaces it:
 * called again after a declaration changed, the floor follows the declaration.
 */
export function registerSealedWindowFloors(
  lifecycle: Required<SealedFloorRegistrar>,
  objects: ReadonlyArray<{ name: string; lifecycle?: unknown }>,
): number {
  let registered = 0;
  for (const object of objects) {
    for (const floor of sealedWindowFloors(object)) {
      lifecycle.registerRetentionFloor(object.name, floor);
      registered += 1;
    }
  }
  return registered;
}
