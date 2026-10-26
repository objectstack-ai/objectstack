/**
 * `ManagedByBucket` — the object-lifecycle bucket declared on
 * `ObjectSchema.managedBy`, the single source of truth for the closed union.
 *
 * Mirrors the framework's `@objectstack/spec/data/object.zod.ts` taxonomy
 * (ADR-0103). The RUNTIME affordance logic that interprets these buckets —
 * `resolveCrudAffordances`, `isWriteOptedIn`, `isSystemWritable`,
 * `isObjectInlineEditable` — lives in `@object-ui/core` (React-free, reachable
 * by every UI package including plugin-detail); the UI copy (badge variants,
 * empty-state messages) stays in `@object-ui/app-shell`. Keeping the union here
 * lets the schema type reference it and prevents the hand-mirrored bucket lists
 * that previously drifted.
 *
 * `system-data` replaced the residual `system` in protocol 17
 * (objectstack#3355). The v16 split was additive — the engine-owned objects
 * moved out to `engine-owned` and the admin/user-writable ones kept `system`,
 * leaving that value named after the half that had left. `system-data` names
 * both boundaries it actually holds: the SCHEMA is the platform's (versus
 * `platform`, which is tenant-modelled), the DATA is the admin's or the user's
 * (versus `engine-owned`, where the engine owns both). It is the only bucket
 * besides `platform`/`config` that defaults to writable.
 *
 * NOTE: distinct from the permission-set / metadata-record *provenance*
 * `managedBy` (`'platform' | 'package' | 'admin'`), which is an unrelated axis
 * that happens to share the word.
 */
export type ManagedByBucket =
  | 'platform'
  | 'config'
  | 'system-data'
  | 'engine-owned'
  | 'append-only'
  | 'better-auth';

/** All lifecycle buckets, in canonical order. */
export const MANAGED_BY_BUCKETS: readonly ManagedByBucket[] = [
  'platform',
  'config',
  'system-data',
  'engine-owned',
  'append-only',
  'better-auth',
];
