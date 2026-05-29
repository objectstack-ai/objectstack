// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Metadata Protection Model — Phase 1 (ADR-0010)
 *
 * Phase 1 introduces the **item-level lock** (`_lock`) and the
 * provenance / package tags that drive it. Later phases extend this
 * file with the path-level (`_frozenPaths`) and package-level
 * (`metadataDefaults`) layers; the wire shapes here are forward-
 * compatible with those additions.
 *
 * Wire / runtime contract:
 *  - `_lock`        — 4-state enum, controls overlay / delete actions.
 *  - `_lockReason`  — short, user-visible explanation surfaced in
 *                     `403 item_locked` errors and on Studio tooltips.
 *  - `_lockSource`  — which layer set the lock (Phase 1 only emits
 *                     `'artifact'`; `'package'` and `'env-forced'`
 *                     are reserved for Phase 3/2 respectively).
 *  - `_provenance`  — `'package'` for loader-introduced items,
 *                     `'org'` for tenant-authored, `'env-forced'`
 *                     reserved for emergency overrides.
 *  - `_packageId` / `_packageVersion` — denormalised from the
 *                     registry tag so consumers don't need a second
 *                     round-trip to inspect provenance.
 *
 * See `docs/adr/0010-metadata-protection-model.md` for the full
 * design (industry references, 4-layer model, audit trail).
 */

// ─────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────

/**
 * 4-state lock enum.
 *
 *  | Value         | Save (PUT / publish / rollback) | Delete |
 *  |---------------|---------------------------------|--------|
 *  | `none`        | allow                           | allow  |
 *  | `no-overlay`  | **deny** (403 item_locked)      | allow  |
 *  | `no-delete`   | allow                           | **deny** |
 *  | `full`        | **deny**                        | **deny** |
 *
 * `allowRuntimeCreate` for **brand-new** items is governed by the
 * type-level L1 registry flag and is never affected by `_lock`
 * (which describes an existing item). See ADR-0010 §3.3.
 */
export const MetadataLockSchema = z.enum(['none', 'no-overlay', 'no-delete', 'full']);
export type MetadataLock = z.infer<typeof MetadataLockSchema>;

/** Where the `_lock` declaration came from. Reserved enum for forward compatibility. */
export const MetadataLockSourceSchema = z.enum(['artifact', 'package', 'env-forced']);
export type MetadataLockSource = z.infer<typeof MetadataLockSourceSchema>;

/** Where the metadata item originated. */
export const MetadataProvenanceSchema = z.enum(['package', 'org', 'env-forced']);
export type MetadataProvenance = z.infer<typeof MetadataProvenanceSchema>;

// ─────────────────────────────────────────────────────────────────────
// Mixin — raw shape that schemas spread into themselves
// ─────────────────────────────────────────────────────────────────────

/**
 * Raw shape spliced into each metadata Zod schema that wants to expose
 * the optional protection envelope to its TS authors. Implemented as a
 * Zod raw shape (not a wrapping schema) so it composes with the
 * existing `z.object({ ... })` patterns without needing to introduce
 * a refinement layer.
 *
 * Usage:
 * ```ts
 * const AppSchema = z.object({
 *   name: z.string(),
 *   // …
 *   ...MetadataProtectionFields,
 * });
 * ```
 */
export const MetadataProtectionFields = {
  /**
   * Per-item lock declaration. Defaults to `'none'` when omitted.
   * Enforced by the runtime protocol on save / publish / rollback /
   * delete. See ADR-0010 §3.3.
   */
  _lock: MetadataLockSchema.optional().describe(
    'Item-level lock — controls overlay & delete (ADR-0010).',
  ),

  /**
   * Short, user-visible explanation surfaced in `403 item_locked`
   * error envelopes and Studio tooltips. Keep < 200 chars.
   */
  _lockReason: z.string().max(500).optional().describe(
    'Human-readable reason shown when a write is refused by _lock.',
  ),

  /**
   * Which layer asserted the lock — Phase 1 only emits `'artifact'`.
   * Reserved for Phase 2/3 (`'package'`, `'env-forced'`).
   */
  _lockSource: MetadataLockSourceSchema.optional().describe(
    'Layer that set _lock (artifact | package | env-forced).',
  ),

  /**
   * `'package'` — introduced by a loader from npm-package source.
   * `'org'`     — authored by a tenant via the metadata API.
   * `'env-forced'` — emergency overrides via the unlock list.
   */
  _provenance: MetadataProvenanceSchema.optional().describe(
    'Origin of the item (package | org | env-forced).',
  ),

  /** Owning package machine id (e.g. `com.objectstack.setup`). */
  _packageId: z.string().optional().describe('Owning package machine id.'),

  /** Owning package semver. */
  _packageVersion: z.string().optional().describe('Owning package version.'),

  /**
   * Optional URL the Studio lock banner links to for more context.
   * Populated by the loader from the author-facing
   * `protection.docsUrl` field — see `shared/protection.zod.ts`.
   */
  _lockDocsUrl: z.string().optional().describe(
    'Optional documentation link surfaced next to _lockReason.',
  ),
} as const;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Read the protection envelope off any candidate item. Safe to call
 * on `undefined`, primitives, or items that have no protection fields
 * at all — returns a fully-defaulted record.
 */
export function extractProtection(item: unknown): {
  lock: MetadataLock;
  lockReason: string | undefined;
  lockSource: MetadataLockSource | undefined;
  lockDocsUrl: string | undefined;
  provenance: MetadataProvenance | undefined;
  packageId: string | undefined;
  packageVersion: string | undefined;
} {
  const empty = {
    lock: 'none' as MetadataLock,
    lockReason: undefined,
    lockSource: undefined,
    lockDocsUrl: undefined,
    provenance: undefined,
    packageId: undefined,
    packageVersion: undefined,
  };
  if (!item || typeof item !== 'object') return empty;
  const rec = item as Record<string, unknown>;
  const lockRaw = rec['_lock'];
  const lock = typeof lockRaw === 'string' && MetadataLockSchema.options.includes(lockRaw as MetadataLock)
    ? (lockRaw as MetadataLock)
    : 'none';
  const lockReason = typeof rec['_lockReason'] === 'string' ? (rec['_lockReason'] as string) : undefined;
  const lockSource = typeof rec['_lockSource'] === 'string'
    && MetadataLockSourceSchema.options.includes(rec['_lockSource'] as MetadataLockSource)
    ? (rec['_lockSource'] as MetadataLockSource)
    : undefined;
  const lockDocsUrl = typeof rec['_lockDocsUrl'] === 'string' ? (rec['_lockDocsUrl'] as string) : undefined;
  const provenance = typeof rec['_provenance'] === 'string'
    && MetadataProvenanceSchema.options.includes(rec['_provenance'] as MetadataProvenance)
    ? (rec['_provenance'] as MetadataProvenance)
    : undefined;
  const packageId = typeof rec['_packageId'] === 'string' ? (rec['_packageId'] as string) : undefined;
  const packageVersion = typeof rec['_packageVersion'] === 'string' ? (rec['_packageVersion'] as string) : undefined;
  return { lock, lockReason, lockSource, lockDocsUrl, provenance, packageId, packageVersion };
}

/**
 * Decide whether a write-style operation (PUT / publish / rollback)
 * is allowed under the given lock state.
 *
 * Returns `null` on allow. Returns a structured refusal envelope when
 * the lock blocks the operation; the protocol layer turns that into a
 * `403 item_locked` HTTP error.
 */
export function evaluateLockForWrite(lock: MetadataLock): { code: 'item_locked'; reason: string } | null {
  if (lock === 'no-overlay' || lock === 'full') {
    return { code: 'item_locked', reason: `Write refused — _lock=${lock}` };
  }
  return null;
}

/** Counterpart of {@link evaluateLockForWrite} for delete operations. */
export function evaluateLockForDelete(lock: MetadataLock): { code: 'item_locked'; reason: string } | null {
  if (lock === 'no-delete' || lock === 'full') {
    return { code: 'item_locked', reason: `Delete refused — _lock=${lock}` };
  }
  return null;
}

/**
 * Derive the read-side flags Studio needs to render the UI. The
 * `editable` / `deletable` / `resettable` triple is what the
 * `GET /meta/:type/:name` response carries in Phase 1. See ADR-0010 §5.
 */
export function resolveLockState(item: unknown, artifactBacked: boolean): {
  lock: MetadataLock;
  lockReason: string | undefined;
  lockSource: MetadataLockSource | undefined;
  lockDocsUrl: string | undefined;
  provenance: MetadataProvenance | undefined;
  packageId: string | undefined;
  packageVersion: string | undefined;
  editable: boolean;
  deletable: boolean;
  resettable: boolean;
} {
  const p = extractProtection(item);
  const editable = p.lock !== 'no-overlay' && p.lock !== 'full';
  const deletable = p.lock !== 'no-delete' && p.lock !== 'full';
  // Reset only makes sense when there is something to reset *to* —
  // i.e. the artifact is package-backed and an overlay can be peeled
  // off. Phase 3 will surface this through a dedicated endpoint; for
  // Phase 1 we publish the boolean so Studio can pre-disable the
  // button when artifactBacked is false.
  const resettable = artifactBacked;
  return { ...p, editable, deletable, resettable };
}
