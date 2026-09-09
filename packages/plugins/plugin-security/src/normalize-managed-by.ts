// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * normalizeManagedByVocab — heal legacy `managed_by` values on the RBAC
 * catalogs to the unified tri-state vocabulary (A4 #2920).
 *
 * The three RBAC catalogs (`sys_capability`, `sys_permission_set`,
 * `sys_position`) historically spoke three different provenance dialects:
 *   - capability: platform / package / admin   (already canonical)
 *   - permission set: platform / package / user
 *   - position: system / config / user
 *
 * A4 unifies all three on **platform / package / admin**. New rows are written
 * canonically by the seeders/projector; this reconciler rewrites the residual
 * legacy values on rows those writers do NOT re-touch — env-authored permission
 * sets stamped `'user'`, and older tenant positions stamped `'system'` /
 * `'config'` / `'user'`. Built-in position rows and declared package sets
 * self-heal on their own bootstrap upsert, so this only mops up the rest.
 *
 * NOT purely cosmetic: the system-row write gate's provenance map
 * (SYSTEM_ROW_PROVENANCE in security-plugin.ts) branches on `managed_by`
 * values, so it must recognize BOTH the canonical and the legacy vocabulary —
 * renaming a stored value without updating that map silently disarms the gate
 * (#2926 ①). Keep the two in lockstep whenever this vocabulary changes.
 * Idempotent: canonical rows are skipped, so a re-run is a no-op.
 * Non-fatal to boot, like the sibling boot reconcilers — but [#15840] no longer
 * best-effort about its own reads: a catalog read that does not answer refuses
 * the pass instead of reporting the same counts an already-canonical catalog
 * reports. The `kernel:ready` caller catches the refusal and carries on.
 *
 * Runs on `kernel:ready` after the seeders, as `isSystem` (the field is
 * `readonly`, so only a system write may set it).
 */

const SYSTEM_CTX = { isSystem: true };

/** legacy value -> canonical value, per object. */
const POSITION_MAP: Record<string, string> = {
  system: 'platform',
  config: 'package',
  user: 'admin',
};
const PERMISSION_SET_MAP: Record<string, string> = {
  user: 'admin',
};

interface NormalizeOptions {
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
    /**
     * [#15840] The level the ruling names for a refused pass. Optional, unlike
     * its two siblings, so every caller that compiles today still compiles: it
     * is an input this module asks for, not a channel it publishes.
     *
     * ⚠️ Three parameters, not two: the platform `Logger` contract
     * (`packages/spec/src/contracts/logger.ts`) takes the `Error` in its OWN
     * second argument at this level and only this level. Declaring the sibling
     * `(message, meta)` shape here makes the real `ctx.logger` unassignable.
     */
    error?: (message: string, error?: Error, meta?: Record<string, any>) => void;
  };
}

/**
 * [#15840] Read the legacy rows, or REFUSE — never invent an empty catalog.
 *
 * The `catch { return []; }` that stood here is the read-seam invention rule's
 * worst case, and it was measured (report 5553806224): an unreadable catalog and
 * an already-canonical one were BYTE-IDENTICAL on both channels — the same
 * `{ positions: 0, permissionSets: 0 }` and zero log lines at any level — while
 * the row that needed healing stayed legacy. "I could not read the catalog" was
 * reported as "the catalog is already canonical".
 *
 * #15840's ruling (decision batch #105 item 5, option A) is that a read fault
 * REFUSES the normalisation pass for that batch and reports at `error`; ⛔ it
 * never answers "already canonical". So the fault leaves this function as a
 * throw, and {@link normalizeManagedByVocab} lets it out.
 *
 * The consumer contract for that throw already exists and is the reason a
 * refusal is decidable here at all: `security-plugin.ts`'s `kernel:ready`
 * bootstrap wraps this call in `try { … } catch { logger.warn('[security]
 * managed_by vocab normalization failed (non-fatal)') }`, so boot proceeds and
 * the remaining bootstrap steps still run. Nothing reached that handler before,
 * because the fault was swallowed one frame below.
 *
 * ⚠️ Refusing is also the CHEAPER report. The report-and-continue option was
 * measured at four lines per boot — this pass calls the read once per legacy
 * value, three for `sys_position` and one for `sys_permission_set` — so a
 * whole-catalog outage said the same thing four times. A refusal aborts at the
 * first un-answered read, which is exactly one `error` line per refused boot.
 *
 * ⛔ Not a relaxation: the system-row write gate's provenance map recognizes
 * BOTH the canonical and the legacy vocabulary (see the header note and
 * #2926 ①), so rows left un-normalised by a refusal are still gated. Nothing is
 * granted, widened or disarmed by declining to rewrite them; the next boot
 * asks again.
 */
function readRefused(object: string, cause?: unknown): Error {
  const why = cause === undefined ? 'the engine did not answer with a row array' : (cause as Error)?.message;
  return new Error(
    `[security] managed_by normalize REFUSED for ${object} — the catalog read did not answer, ` +
      `so this pass cannot tell "already canonical" from "could not ask": ${why}`,
  );
}

async function findOrRefuse(ql: any, object: string, where: any): Promise<any[]> {
  let rows: any;
  try {
    rows = await ql.find(object, { where, limit: 10_000, fields: ['id', 'managed_by'] }, { context: SYSTEM_CTX });
  } catch (e) {
    throw readRefused(object, e);
  }
  // Bare array, driven — `engine-find-bare-array.pin.test.ts` boots a real
  // engine over a real `SqlDriver` and pins this seam. The `{ records }` limb
  // that stood here was dead code that read as a contract; a non-array answer
  // is now a refusal for the same reason a throw is — the pass did not get the
  // rows, so it must not report on them.
  if (Array.isArray(rows)) return rows;
  throw readRefused(object);
}

async function normalizeObject(
  ql: any,
  object: string,
  map: Record<string, string>,
  logger?: NormalizeOptions['logger'],
): Promise<number> {
  let updated = 0;
  for (const [legacy, canonical] of Object.entries(map)) {
    // Narrow equality scan per legacy value keeps the where-clause
    // driver-portable (no IN / OR predicate).
    let rows: any[];
    try {
      rows = await findOrRefuse(ql, object, { managed_by: legacy });
    } catch (e) {
      // [#15840] The one report the ruling names, emitted where the count that
      // will NOT be returned is still known: rows healed before the refusal
      // stay healed, and saying so is the difference between a refusal and a
      // rollback. Reported once — the throw aborts the whole pass.
      logger?.error?.((e as Error).message, e instanceof Error ? e : undefined, {
        object,
        legacyValue: legacy,
        healedBeforeRefusal: updated,
        consequence:
          'the remaining legacy rows keep their legacy managed_by; the write gate recognizes ' +
          'both vocabularies, so nothing is disarmed, and the next boot asks again',
      });
      throw e;
    }
    for (const row of rows) {
      if (!row?.id) continue;
      try {
        await ql.update(object, { id: row.id, managed_by: canonical }, { context: SYSTEM_CTX });
        updated += 1;
      } catch (e) {
        logger?.warn?.(`[security] managed_by normalize failed for ${object}:${row.id}`, {
          error: (e as Error).message,
        });
      }
    }
  }
  return updated;
}

/**
 * Rewrite legacy `managed_by` values on `sys_permission_set` and `sys_position`
 * to the unified tri-state vocab. Returns a per-object count of rows healed.
 *
 * [#15840] THROWS if a catalog read does not answer. The returned counts are an
 * attestation — "these rows were legacy and are now canonical" — and a pass that
 * could not read the catalog has nothing to attest, so it refuses rather than
 * reporting `{ positions: 0, permissionSets: 0 }`, which is what an
 * already-canonical catalog reports. Callers already handle this: the
 * `kernel:ready` bootstrap catches it, reports at `warn` as non-fatal, and
 * continues. An engine with no `find`/`update` at all is NOT a read fault and
 * still returns zeros.
 */
export async function normalizeManagedByVocab(
  ql: any,
  options: NormalizeOptions = {},
): Promise<{ permissionSets: number; positions: number }> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.update !== 'function') {
    return { permissionSets: 0, positions: 0 };
  }
  const positions = await normalizeObject(ql, 'sys_position', POSITION_MAP, options.logger);
  const permissionSets = await normalizeObject(ql, 'sys_permission_set', PERMISSION_SET_MAP, options.logger);
  const total = positions + permissionSets;
  if (total > 0) {
    options.logger?.info?.('[security] managed_by vocab normalized to platform/package/admin (A4 #2920)', {
      positions,
      permissionSets,
    });
  }
  return { permissionSets, positions };
}
