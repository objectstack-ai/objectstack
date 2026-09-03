// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0092 D2 — generic identity write guard.
 *
 * `managedBy: 'better-auth'` promises that identity tables are only written
 * through the better-auth pipeline, but until this guard that promise was
 * enforced by nothing except UI affordances and default permission sets —
 * `admin_full_access` (wildcard, no RLS) could raw-write any column of any
 * identity table through the generic data API (ADR-0049 violation).
 *
 * The guard registers engine `beforeInsert` / `beforeUpdate` / `beforeDelete`
 * hooks that fail-closed reject USER-CONTEXT writes to every object whose
 * registered schema declares `managedBy: 'better-auth'`. The flag is read
 * from the schema registry at evaluation time — there is no hardcoded table
 * list to drift from the schemas.
 *
 * What passes untouched:
 *  - the better-auth adapter (its engine calls carry no caller context);
 *  - plugin / system writes (`isSystem` contexts, e.g. import, sign-in
 *    stamps, provenance hooks).
 *
 * The only opening is a per-object UPDATE whitelist
 * ({@link registerManagedUpdateWhitelist}); non-whitelisted keys are
 * stripped, and a payload that strips to nothing throws — a loud failure,
 * not a silent no-op. First registration:
 * `sys_user → SYS_USER_PROFILE_EDIT_FIELDS` (name, image, locale — `locale`
 * added by the maintainer ruling of 2026-09-03).
 *
 * Rejections use `code: 'PERMISSION_DENIED'` + `status: 403`, which the REST
 * layer's `mapDataError` / `sendError` already translate — same pattern as
 * plugin-audit's FEEDS_DISABLED / FILES_DISABLED capability gates.
 *
 * ADR-0092 D6 — a companion `afterUpdate` hook keeps better-auth's
 * secondary-storage session snapshots coherent after a guarded profile edit,
 * mirroring better-auth's own `refreshUserSessions`: each cached
 * `{session, user}` entry for the affected user is re-written (same TTL)
 * with the changed fields merged in. It rewrites, never deletes — deleting
 * would sign the user out when sessions live only in the cache.
 */

type LoggerLike = {
  info(msg: string): void;
  warn(msg: string): void;
  debug?(msg: string): void;
};

/** Shape of better-auth's `secondaryStorage` (see secondary-storage.ts). */
export interface SecondaryStorageLike {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface IdentityWriteGuardOptions {
  packageId: string;
  logger?: LoggerLike;
  /**
   * Resolves the EFFECTIVE better-auth secondaryStorage (kernel cache
   * adapter or host-supplied). Undefined / throwing = session caching not
   * wired = the D6 refresh is a no-op (single-node memory cache TTLs the
   * stale snapshot out).
   */
  getSecondaryStorage?: () => SecondaryStorageLike | undefined;
}

// ---------------------------------------------------------------------------
// Update whitelist registry (ADR-0092 D2)
// ---------------------------------------------------------------------------

const updateWhitelists = new Map<string, ReadonlySet<string>>();

/**
 * Open a per-object UPDATE whitelist on a better-auth-managed table. The
 * listed fields become editable through the generic data path for callers
 * the permission layer already admits; everything else stays stripped.
 * Registering is the ONLY way to open a managed table — absence = deny.
 */
export function registerManagedUpdateWhitelist(object: string, fields: Iterable<string>): void {
  updateWhitelists.set(object, new Set(fields));
}

/** Test seam / introspection. */
export function getManagedUpdateWhitelist(object: string): ReadonlySet<string> | undefined {
  return updateWhitelists.get(object);
}

// ---------------------------------------------------------------------------
// Guard internals
// ---------------------------------------------------------------------------

/**
 * A write is user-context when the operation context carries a real user and
 * is not system-elevated. better-auth's own adapter calls pass no context at
 * all (no session → not user-context), and plugin/system writes stamp
 * `isSystem` — both bypass by construction.
 */
function isUserContextWrite(session: any): boolean {
  return Boolean(session?.userId) && session?.isSystem !== true;
}

function forbidden(object: string, message: string): Error {
  const err: any = new Error(`PERMISSION_DENIED: ${message}`);
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  err.object = object;
  return err;
}

const DEDICATED_SURFACE_HINT =
  'use the dedicated auth surface instead (invite / create-user / admin endpoints, or the better-auth API)';

/**
 * Engine-owned lifecycle stamps the WRITE PATH itself injects (the REST data
 * routes stamp `updated_at`/`updated_by` on every update, for every object).
 * They pass through the whitelist filter — stripping them would freeze the
 * row's audit freshness on guarded edits — but they do NOT count as "a field
 * the caller may edit": an update whose only surviving keys are lifecycle
 * stamps is still rejected, otherwise an email-only PATCH would silently
 * degrade into a timestamp touch instead of failing loudly.
 */
const LIFECYCLE_PASSTHROUGH = new Set(['updated_at', 'updated_by']);

/**
 * [ADR-0092 D6] The `sys_user` columns whose values better-auth ALSO keeps in
 * its cached `{session, user}` snapshots — and therefore the only ones the
 * companion `afterUpdate` hook merges into those snapshots after a guarded
 * edit.
 *
 * This used to be "whatever the update whitelist admits", which was true only
 * while the whitelist and better-auth's user model happened to coincide
 * (`name → name`, `image → image`). The 2026-09-03 ruling separated them: it
 * added `locale`, a column better-auth is DELIBERATELY oblivious to — not one
 * of its own fields and not an `additionalFields` entry, because declaring it
 * there would make `getSession` SELECT a column an environment that has not
 * run schema-sync does not have (the `ai_access` note in `auth-manager.ts`).
 *
 * So `locale` is excluded, and the exclusion is the CORRECT behaviour rather
 * than a deferral. D6 exists to stop a cached snapshot going stale against the
 * row; a column better-auth never reads into the snapshot has no stale copy to
 * repair. Merging it anyway would do the opposite of D6's job — it would
 * MANUFACTURE an incoherence, a `user.locale` key present on sessions that
 * happen to be cached and absent on sessions that are not, appearing only
 * after a profile edit and differing per session between two callers of the
 * same endpoint.
 *
 * ⚠️ Widening the update whitelist does not widen this set. Add a column here
 * only when better-auth actually carries it on its user model (its own field,
 * or a declared `additionalFields` entry), and then only under the name
 * better-auth uses — a snake_case ObjectStack column whose better-auth
 * spelling is camelCase needs a translation, not an entry.
 */
const SESSION_SNAPSHOT_MIRRORED_FIELDS: ReadonlySet<string> = new Set(['name', 'image']);

/**
 * Register the identity write guard on an ObjectQL engine. Idempotent per
 * package: callers re-binding after hot reload should first run
 * `engine.unregisterHooksByPackage(packageId)` (the engine's standard
 * re-bind contract).
 *
 * Priority 10 (< default 100) so a rejection fires before plugin-audit's
 * `beforeUpdate` prior-snapshot fetch and any other default-priority hooks
 * spend work on a doomed write.
 */
export function registerIdentityWriteGuard(engine: any, opts: IdentityWriteGuardOptions): void {
  const { packageId, logger } = opts;

  const isManaged = (object: string): boolean => {
    try {
      return engine.getSchema?.(object)?.managedBy === 'better-auth';
    } catch {
      return false;
    }
  };

  const rejectWrite = (operation: 'create' | 'delete') => async (ctx: any) => {
    if (!isManaged(ctx.object) || !isUserContextWrite(ctx.session)) return;
    throw forbidden(
      ctx.object,
      `Identity table '${ctx.object}' is managed by better-auth (ADR-0092): ` +
        `direct ${operation} via the data API is disabled — ${DEDICATED_SURFACE_HINT}.`,
    );
  };

  const guardUpdate = async (ctx: any) => {
    if (!isManaged(ctx.object) || !isUserContextWrite(ctx.session)) return;

    const whitelist = updateWhitelists.get(ctx.object);
    if (!whitelist) {
      throw forbidden(
        ctx.object,
        `Identity table '${ctx.object}' is managed by better-auth (ADR-0092): ` +
          `direct update via the data API is disabled — ${DEDICATED_SURFACE_HINT}.`,
      );
    }

    const data: Record<string, unknown> = (ctx.input?.data ?? {}) as Record<string, unknown>;
    const stripped: string[] = [];
    let editableRemaining = 0;
    for (const key of Object.keys(data)) {
      // `id` is the row address, not a field write — the engine has already
      // extracted it into `input.id`; leaving it in place changes nothing.
      if (key === 'id') continue;
      if (LIFECYCLE_PASSTHROUGH.has(key)) continue;
      if (whitelist.has(key)) {
        editableRemaining += 1;
      } else {
        delete data[key];
        stripped.push(key);
      }
    }

    if (editableRemaining === 0) {
      throw forbidden(
        ctx.object,
        `None of the submitted fields (${stripped.join(', ') || '—'}) are editable on ` +
          `'${ctx.object}' via the data API (ADR-0092). Editable fields: ` +
          `${[...whitelist].join(', ')}. For anything else, ${DEDICATED_SURFACE_HINT}.`,
      );
    }
    if (stripped.length > 0) {
      logger?.warn(
        `[IdentityWriteGuard] stripped non-whitelisted field(s) from user-context update to ` +
          `'${ctx.object}': ${stripped.join(', ')} (ADR-0092)`,
      );
    }
  };

  engine.registerHook('beforeInsert', rejectWrite('create'), { priority: 10, packageId });
  engine.registerHook('beforeUpdate', guardUpdate, { priority: 10, packageId });
  engine.registerHook('beforeDelete', rejectWrite('delete'), { priority: 10, packageId });

  // ── ADR-0092 D6 — session-snapshot coherence after guarded profile edits ──
  //
  // better-auth caches `{session, user}` per session token in secondary
  // storage, plus an `active-sessions-${userId}` index. Its OWN update paths
  // re-write those snapshots (internal-adapter `refreshUserSessions`); a
  // guarded engine write bypasses that, so we mirror it here for the fields
  // better-auth actually caches — `SESSION_SNAPSHOT_MIRRORED_FIELDS` above,
  // NOT the update whitelist. The two were the same set (name → name,
  // image → image) until the 2026-09-03 ruling admitted `locale`, a column
  // better-auth does not carry on its user model at all; see that constant for
  // why mirroring it would manufacture an incoherence rather than repair one.
  const refreshSessionSnapshots = async (ctx: any) => {
    try {
      if (ctx.object !== 'sys_user' || !isUserContextWrite(ctx.session)) return;
      const storage = opts.getSecondaryStorage?.();
      if (!storage) return;

      const data: Record<string, unknown> = (ctx.input?.data ?? {}) as Record<string, unknown>;
      const whitelist = updateWhitelists.get('sys_user');
      const changed: Record<string, unknown> = {};
      for (const key of Object.keys(data)) {
        // BOTH tests, and they are different questions: the whitelist answers
        // "did the guard let this write through" (a key it stripped never
        // reached the row, so mirroring it would cache a value the database
        // does not hold), and the mirror set answers "does better-auth keep
        // this column in the snapshot at all".
        if (key === 'id') continue;
        if (!whitelist?.has(key)) continue;
        if (!SESSION_SNAPSHOT_MIRRORED_FIELDS.has(key)) continue;
        changed[key] = data[key];
      }
      if (Object.keys(changed).length === 0) return;

      const userId = ctx.input?.id ?? data.id;
      if (!userId) {
        // Multi-row user-context update — no single user to refresh. Rare
        // (bulk profile edits); snapshots then age out on their TTL.
        logger?.warn(
          '[IdentityWriteGuard] multi-row sys_user update: session snapshots not refreshed (TTL will age them out)',
        );
        return;
      }

      const listRaw = await storage.get(`active-sessions-${String(userId)}`);
      if (!listRaw) return;
      let list: Array<{ token: string; expiresAt: number }> = [];
      try {
        list = JSON.parse(listRaw) ?? [];
      } catch {
        return;
      }
      const now = Date.now();
      await Promise.all(
        list
          .filter((s) => s && typeof s.token === 'string' && s.expiresAt > now)
          .map(async ({ token }) => {
            const cached = await storage.get(token);
            if (!cached) return;
            let parsed: any;
            try {
              parsed = JSON.parse(cached);
            } catch {
              return;
            }
            if (!parsed?.session || !parsed?.user) return;
            const ttl = Math.floor((new Date(parsed.session.expiresAt).getTime() - now) / 1000);
            if (!Number.isFinite(ttl) || ttl <= 0) return;
            await storage.set(
              token,
              JSON.stringify({ session: parsed.session, user: { ...parsed.user, ...changed } }),
              ttl,
            );
          }),
      );
    } catch (e) {
      // Snapshot refresh must never fail the write — worst case the cached
      // profile is stale until the session entry's TTL expires.
      logger?.warn(
        `[IdentityWriteGuard] session snapshot refresh failed: ${(e as Error)?.message ?? e}`,
      );
    }
  };

  engine.registerHook('afterUpdate', refreshSessionSnapshots, { object: 'sys_user', packageId });

  logger?.info(
    '[IdentityWriteGuard] managedBy:better-auth write guard registered (ADR-0092 D2/D6)',
  );
}
