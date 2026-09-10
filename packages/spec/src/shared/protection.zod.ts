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
 *     docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
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
import { strictObject } from './strict-object';

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
export const ProtectionSchema = strictObject({
    // ⚠️ ONE declaring schema, reached from every mount — so the surface name
    // cannot be per-mount-context the way every neighbouring `strictObject`
    // adoption's is. `protection:` is mounted on very nearly every authorable
    // metadata type in the platform, and the mount list moves; transcribing it
    // into this string would mint exactly the second copy of the truth this
    // helper exists to delete, and a stale copy here would be published as a
    // confident sentence in a rejection. So the surface names the BLOCK, which
    // is what the author actually wrote and what the error path already shows
    // (`protection.lock`), and is true at every mount without naming one.
    surface: 'the `protection` block of this metadata item',
    history:
        'This block has refused unknown keys since it was introduced, but through zod\'s own '
        + 'bare message: a one-keystroke `lockk` was echoed back and nothing else — no surface, '
        + 'no declared-key list, no rename — while every neighbouring block on the same item '
        + 'named all three. It is mounted on very nearly every authorable metadata type in the '
        + 'platform (objects, views, dashboards, datasets, reports, apps, flows, webhooks, '
        + 'permissions, positions, email templates, agents, tools, skills), so that bare message '
        + 'was what an author saw wherever a protection key was misspelled. The declared keys '
        + 'are `lock`, `reason` and `docsUrl`.',
    aliases: {
        // ── prose slot ────────────────────────────────────────────────────
        // `description` is declared on the mounting metadata types themselves,
        // one line up from this block, so an author reaching for prose inside
        // `protection` writes it by reflex. `message` and `explanation` are the
        // words this file's own docblock uses for the value ("user-visible
        // explanation surfaced in `403 ITEM_LOCKED` errors").
        description: 'reason',
        message: 'reason',
        explanation: 'reason',
        // The private envelope's public counterparts, written without the
        // underscore. Distance cannot reach them (`lockReason` → `reason` is 4
        // edits against a length-relative budget of 3); the underscored
        // spellings are answered by the guidance set below instead.
        lockReason: 'reason',
        lockDocsUrl: 'docsUrl',
        // ── docs slot ─────────────────────────────────────────────────────
        // ⚠️ `docs` and `link` are not merely unreached — measured on the
        // pre-fix build, the edit-distance fallback answered BOTH of them with
        // `lock` (`docs`/`link` are each 2 edits from `lock`, inside the budget
        // of 2 for a four-character key), i.e. it pointed an author who meant
        // the documentation URL at the lock policy. That is ledger finding 7's
        // shape — the campaign's own fix signposting into a second rejection —
        // and it is why these two entries carry judgement rather than typing.
        docs: 'docsUrl',
        link: 'docsUrl',
        url: 'docsUrl',
        href: 'docsUrl',
        helpUrl: 'docsUrl',
        documentationUrl: 'docsUrl',
    },
    guidance: {
        // Wrong-layer, and a bare rename would misinform about the VALUE: both
        // spellings are real boolean keys on neighbouring surfaces
        // (`data/field.zod.ts` `readonly`, `ui/component.zod.ts` `readOnly`),
        // whereas this block's equivalent is an enum, so `lock: true` would be
        // the author's next rejection.
        readonly:
            '`readonly` is a field/component-level boolean; this block expresses the same intent '
            + 'as a policy — write `lock: \'no-overlay\'` (save blocked, delete still allowed) or '
            + '`lock: \'full\'` (both blocked).',
        readOnly:
            '`readOnly` is a field/component-level boolean; this block expresses the same intent '
            + 'as a policy — write `lock: \'no-overlay\'` (save blocked, delete still allowed) or '
            + '`lock: \'full\'` (both blocked).',
    },
    guidanceSets: [
        {
            // The `_lock` envelope is the RUNTIME form of this block
            // (`kernel/metadata-protection.zod.ts`), stamped by
            // `applyProtection` below at registration time. An author who has
            // read the stored row writes its keys here; one prescription
            // answers the whole family, once per message.
            name: 'PRIVATE_LOCK_ENVELOPE_KEYS',
            keys: /^_lock/,
            examples: ['_lock', '_lockReason', '_lockDocsUrl', '_lockSource'],
            prescription:
                'The `_lock*` keys are the runtime\'s PRIVATE envelope, stamped by the loader from '
                + 'this block — never authored. Write the public keys instead: `_lock` → `lock`, '
                + '`_lockReason` → `reason`, `_lockDocsUrl` → `docsUrl`; `_lockSource` is derived '
                + 'and has no author-facing counterpart.',
        },
    ],
}, {
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
     * Short user-visible explanation surfaced in `403 ITEM_LOCKED`
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
});

export type Protection = z.input<typeof ProtectionSchema>;

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
