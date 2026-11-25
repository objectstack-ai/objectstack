// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_preference.digest`: an insert that leaves the digest unset
 * stores it EMPTY, on every database (ruling 7073270426 on #35123).
 *
 * ## Why a hook, and why it is temporary
 *
 * The field declares no `defaultValue` any more: empty is "not set" (the next
 * row decides) and a stored `none` is a person's explicit "send each one right
 * away". But a SQL database an earlier release created carries the old
 * declaration as a PHYSICAL column default (`digest … default 'none'`), and
 * schema sync never retrofits a column default on an existing table. On such
 * a database an insert that omits `digest` gets `none` from the database, which
 * now reads as the member's explicit opt-out from the organization's digest:
 * any writer creating a row for them (the Setup grid, the API, a flow, an
 * agent, the Notification Settings page saving only quiet hours) would
 * silently turn the organization's digest off for them.
 *
 * So the owner of the object writes `digest: null` on every insert that leaves
 * it unset: a key present as `null` is written as NULL, and the column default
 * never fires. ⚠️ TEMPORARY: the cause is the SQL driver keeping a default the
 * metadata no longer declares, carried by #36245; this hook comes out in the
 * change that lands it. Until then a write that skips engine hooks (raw SQL, a
 * bulk load straight into the table) still stores `none` on such a database.
 *
 * It fires for every context, `isSystem` included, and only on insert: an
 * update that leaves `digest` out leaves the stored value alone, and the
 * column default plays no part in an update.
 */

import { PREFERENCE_OBJECT } from './preference-resolver.js';

/** The hook registry's package id for this binding (unbound by it at teardown). */
export const PREFERENCE_DIGEST_UNSET_HOOK_PACKAGE = 'service-messaging:preference-digest-unset';

/** The engine surface the hook binds through — `ObjectQL`'s hook registry. */
export interface PreferenceDigestHookEngine {
    registerHook?: (
        event: string,
        handler: (ctx: any) => void | Promise<void>,
        options?: { object?: string | string[]; priority?: number; packageId?: string },
    ) => void;
    unregisterHooksByPackage?: (packageId: string) => number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `beforeInsert` (one dispatch per row): an unset digest is written as an explicit `null`. */
export function keepUnsetDigestEmpty(ctx: any): void {
    if (ctx?.object !== undefined && ctx.object !== PREFERENCE_OBJECT) return;
    const data = ctx?.input?.data;
    if (!isRecord(data)) return;
    if (data.digest === undefined) data.digest = null;
}

/**
 * Bind the hook on the engine. Re-binding replaces the previous binding rather
 * than stacking a second one. Returns `false` when the engine exposes no hook
 * registry, so the caller can say so.
 */
export function bindPreferenceDigestUnset(engine: PreferenceDigestHookEngine | null | undefined): boolean {
    if (!engine || typeof engine.registerHook !== 'function') return false;
    unbindPreferenceDigestUnset(engine);
    engine.registerHook('beforeInsert', keepUnsetDigestEmpty, {
        object: PREFERENCE_OBJECT,
        priority: 5,
        packageId: PREFERENCE_DIGEST_UNSET_HOOK_PACKAGE,
    });
    return true;
}

/** Unbind the hook (plugin teardown). */
export function unbindPreferenceDigestUnset(engine: PreferenceDigestHookEngine | null | undefined): void {
    if (engine && typeof engine.unregisterHooksByPackage === 'function') {
        engine.unregisterHooksByPackage(PREFERENCE_DIGEST_UNSET_HOOK_PACKAGE);
    }
}
