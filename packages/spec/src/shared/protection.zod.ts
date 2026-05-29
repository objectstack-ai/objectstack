// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Package-level metadata protection (ADR-0010 §3.7 — Phase 4.3)
 *
 * Public, type-safe author surface for package authors to declare
 * how much of one of their metadata items the runtime (and the
 * tenant's Studio) is allowed to mutate. Internally this is what
 * gets translated into the `_lock` / `_lockReason` / `_lockDocsUrl`
 * private envelope (`kernel/metadata-protection.zod.ts`) that the
 * protocol layer enforces.
 *
 * Why two layers?
 *  - **`protection`** is the *author DX* surface — typed, validated,
 *    and discoverable via IntelliSense on every `*.app.ts` /
 *    `*.object.ts` / `*.view.ts` etc.
 *  - **`_lock` envelope** is the *runtime* surface — strips off the
 *    protection block on load and stamps the private fields so the
 *    persistence and overlay layers don't drag the author-facing
 *    block through every `sys_metadata` overlay diff.
 *
 * Example:
 * ```ts
 * export const SETUP_APP: App = {
 *   name: 'setup',
 *   label: 'Setup',
 *   protection: {
 *     lock: 'full',
 *     reason: 'Core admin UI shipped by @objectstack/platform-objects.',
 *     docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
 *   },
 *   // ...
 * };
 * ```
 *
 * The loader (`metadata/plugin.ts` + `objectql/registry.ts`) calls
 * {@link applyProtection} to translate this block into the private
 * `_lock` envelope at registration time. Authors should NEVER set
 * the underscored fields directly — they are an implementation
 * detail.
 *
 * See also:
 *  - ADR-0010 §3.7 — Future work → now implemented.
 *  - `kernel/metadata-protection.zod.ts` — the runtime envelope.
 */

import { z } from 'zod';
import {
    MetadataLockSchema,
    type MetadataLock,
} from '../kernel/metadata-protection.zod';

/**
 * Public protection block authored by package developers. Optional on
 * every lockable metadata type — omit to leave the item fully
 * overlay-editable and overlay-deletable (default behaviour).
 *
 * The shape is intentionally *small*: only the fields that have a
 * meaningful UX impact in Studio are exposed. Internal bookkeeping
 * (provenance, packageId, packageVersion) is auto-populated by the
 * loader and must not be supplied here.
 */
export const ProtectionSchema = z.object({
    /**
     * Lock policy for this item. See {@link MetadataLockSchema} for
     * the full semantics table.
     *
     *  | Value         | Save | Delete |
     *  |---------------|------|--------|
     *  | `none`        | ✅    | ✅      |
     *  | `no-overlay`  | ❌    | ✅      |
     *  | `no-delete`   | ✅    | ❌      |
     *  | `full`        | ❌    | ❌      |
     *
     * `no-overlay` is recommended for "structural" items that should
     * stay authoritative but allow side-by-side extension (e.g. core
     * objects whose fields can be extended via `objectExtensions`).
     * `full` is for items that have no safe extension point at all
     * (e.g. the platform Setup app whose nav tree is wired directly
     * into framework code).
     */
    lock: MetadataLockSchema.describe(
        'Lock policy — none | no-overlay | no-delete | full.',
    ),

    /**
     * Short user-visible explanation surfaced in `403 item_locked`
     * errors and the Studio lock banner. Aim for one sentence; the
     * banner truncates long values.
     */
    reason: z.string().min(1).max(500).describe(
        'User-visible reason shown when the lock blocks an action.',
    ),

    /**
     * Optional documentation link rendered next to the reason in
     * the Studio lock banner. Use it to point operators at the
     * package's protection policy or to a "how to customise this"
     * guide. Must be a fully-qualified URL.
     */
    docsUrl: z.string().url().optional().describe(
        'Optional URL the Studio banner links to for more context.',
    ),
}).strict();

export type Protection = z.infer<typeof ProtectionSchema>;

// ─────────────────────────────────────────────────────────────────────
// Loader-side translation
// ─────────────────────────────────────────────────────────────────────

/** Loader context handed in by the registration pipeline. */
export interface ApplyProtectionContext {
    /** Owning package id (e.g. `com.objectstack.platform-objects`). */
    packageId?: string;
    /** Owning package semver. */
    packageVersion?: string;
    /**
     * `'package'` for items introduced by a package loader (default).
     * Pass `'env-forced'` when the runtime is materialising an
     * emergency override.
     */
    provenance?: 'package' | 'env-forced';
}

/**
 * Translate the author-facing `protection` block on `item` into the
 * private `_lock` envelope and strip the public block so it never
 * leaks into the overlay row.
 *
 * Safe to call on any object: items without `protection` are returned
 * unchanged (other than the standard `_packageId` / `_packageVersion`
 * stamping that always runs when the context supplies those fields).
 *
 * Always **mutates** `item` and returns it for chaining.
 */
export function applyProtection<T extends Record<string, unknown>>(
    item: T,
    ctx: ApplyProtectionContext = {},
): T {
    if (!item || typeof item !== 'object') return item;

    // Stamp provenance / package coords first so they apply even when
    // there is no `protection` block. The loader pipeline used to do
    // _packageId stamping itself; centralising it here keeps the two
    // load paths (artifact loader + registry.registerItem) consistent.
    if (ctx.packageId && (item as any)._packageId === undefined) {
        (item as any)._packageId = ctx.packageId;
    }
    if (ctx.packageVersion && (item as any)._packageVersion === undefined) {
        (item as any)._packageVersion = ctx.packageVersion;
    }
    // Only stamp provenance when we actually have package coords or an
    // author-facing protection block; otherwise leave the item alone so
    // that DB-only / test fixtures don't acquire an unexpected
    // `_provenance` field. The loader passes packageId for genuine
    // package items; bare `registerItem(type, item)` calls without a
    // package context still produce a clean item.
    const hasProtectionBlock =
        (item as any).protection
        && typeof (item as any).protection === 'object';
    if (
        (ctx.packageId || hasProtectionBlock)
        && (item as any)._provenance === undefined
    ) {
        (item as any)._provenance = ctx.provenance ?? 'package';
    }

    const block = (item as any).protection;
    if (!block || typeof block !== 'object') return item;

    // Author-facing block exists — translate to the private envelope.
    // We accept partial values (lock alone, reason alone) and let the
    // protocol layer fall back to defaults; full Zod validation runs
    // upstream when the schemas were composed with ProtectionSchema.
    const lock = block.lock as MetadataLock | undefined;
    const reason = typeof block.reason === 'string' ? block.reason : undefined;
    const docsUrl = typeof block.docsUrl === 'string' ? block.docsUrl : undefined;

    if (lock !== undefined) {
        (item as any)._lock = lock;
    }
    if (reason !== undefined) {
        (item as any)._lockReason = reason;
    }
    if (docsUrl !== undefined) {
        (item as any)._lockDocsUrl = docsUrl;
    }
    // Lock source is 'package' for anything that came through this
    // helper. Artifact-only items (no packageId) fall back to
    // 'artifact' to preserve the Phase-1 contract.
    if ((item as any)._lockSource === undefined) {
        (item as any)._lockSource = ctx.packageId ? 'package' : 'artifact';
    }

    // Strip the public block — it lives only on the author-side
    // module, never on the persisted overlay row.
    delete (item as any).protection;

    return item;
}
