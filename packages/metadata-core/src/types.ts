// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Repository types — see ADR-0008 §2.
 *
 * All shapes are defined as Zod schemas so the same definition serves
 * runtime validation and static typing (`z.infer<typeof X>`).
 */

import { z } from 'zod';

// ─── Metadata type registry ───────────────────────────────────────────

/**
 * Canonical metadata type names. Aligned with the `MetadataTypeSchema`
 * enum in `@objectstack/spec/kernel/metadata-plugin.zod.ts`. New types are
 * added here in lockstep with that file.
 */
export const MetadataTypeSchema = z.enum([
  'object',
  'field',
  'trigger',
  'validation',
  'hook',
  'view',
  'page',
  'dashboard',
  'app',
  'action',
  'flow',
  'workflow',
  // ADR-0019: `approval` is a flow node, not a metadata type.
  'job',
  'agent',
  'tool',
  'skill',
  'report',
  'translation',
  'role',
  'profile',
  'permission',
  'policy',
  'api',
  'endpoint',
  'datasource',
  'cube',
  'settings',
  'router',
  'function',
  'service',
  'email_template',
]).describe('Canonical metadata type name');

export type MetadataType = z.infer<typeof MetadataTypeSchema>;

// ─── MetaRef ──────────────────────────────────────────────────────────

/**
 * Fully-qualified reference to a metadata item. Identity is `(org, type, name)`.
 *
 * Per ADR-0008 v2 (2026-05) the metadata layer no longer carries `project`
 * or `branch`. Project survives only as an **artifact packaging concept**
 * (the unit a CLI/CI run compiles into `dist/objectstack.json`); it does
 * not appear in the runtime customization scope. Branching belongs to Git
 * (or your VCS of choice) and never propagated cleanly into the runtime
 * model — so it has been removed entirely.
 *
 * Higher layers may default `org='system'` for built-ins.
 *
 * `version` is optional: omit to mean "HEAD", supply to pin.
 */
export const MetaRefSchema = z.object({
  org: z.string().min(1).describe('Tenant/org identifier; "system" for built-ins'),
  type: MetadataTypeSchema,
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Snake_case machine name'),
  version: z.string().optional().describe('Optional version pin (content hash); omit for HEAD'),
});

export type MetaRef = z.infer<typeof MetaRefSchema>;

/**
 * Construct a stable string key from a MetaRef (excluding `version`,
 * which is mutable). Used as cache keys and log indexes.
 */
export function refKey(ref: Pick<MetaRef, 'org' | 'type' | 'name'>): string {
  return `${ref.org}/${ref.type}/${ref.name}`;
}

// ─── Item & header ────────────────────────────────────────────────────

/**
 * Full metadata item as stored / returned by the Repository.
 *
 * `body` is the **canonical, Zod-normalised** spec (with defaults filled
 * in). `hash` is `sha256(canonicalize(body))`. Equal hashes imply equal
 * specs.
 */
export const MetadataItemSchema = z.object({
  ref: MetaRefSchema,
  body: z.record(z.string(), z.unknown()).describe('Canonical Zod-normalised spec'),
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/).describe('sha256(canonicalize(body))'),
  parentHash: z.string().nullable().describe('Hash this version was derived from; null for first version'),
  authoredBy: z.string().describe('Identity of the writer (user id, "cli", "ai:claude", …)'),
  authoredAt: z.string().describe('ISO-8601 timestamp'),
  message: z.string().optional().describe('Optional commit message'),
  seq: z.number().int().nonnegative().describe('Sequence number this write produced in the org log'),
  schemaVersion: z.string().optional().describe('Zod schema version that wrote this spec (M3 codemod hook)'),
});

export type MetadataItem = z.infer<typeof MetadataItemSchema>;

/** Lightweight header for listing — `body` omitted. */
export type MetadataItemHeader = Omit<MetadataItem, 'body'>;

// ─── Change log event ─────────────────────────────────────────────────

export const MetadataOpSchema = z.enum(['create', 'update', 'delete', 'rename', 'publish', 'revert']);
export type MetadataOp = z.infer<typeof MetadataOpSchema>;

/**
 * The single event payload broadcast by the change log. ADR-0008 §2.4.
 *
 * For `rename`, `previousName` carries the old machine name. For
 * `delete`, `hash` is null. The payload is intentionally small —
 * consumers re-fetch via the cache when they need the full body.
 */
export const MetadataEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  op: MetadataOpSchema,
  ref: MetaRefSchema,
  hash: z.string().nullable(),
  parentHash: z.string().nullable(),
  /**
   * Per-(org,type,name) monotonic lineage counter at this event.
   * Populated by `SysMetadataRepository.history()`; used by
   * `rollbackMetaItem({ toVersion })` to pin a specific snapshot.
   */
  version: z.number().int().positive().optional(),
  previousName: z.string().optional().describe('Set on op="rename"'),
  actor: z.string(),
  message: z.string().optional(),
  ts: z.string(),
  source: z.string().describe('Origin label: "fs", "studio", "rest", "ai", "git-import", …'),
});

export type MetadataEvent = z.infer<typeof MetadataEventSchema>;

// ─── Operation options ────────────────────────────────────────────────

/**
 * Two-tier metadata authorization intent (ADR-0005 extension).
 *
 * - `override-artifact`: the write targets an item that ships from a code
 *   package (an artifact). Only permitted when the type opts into
 *   per-org overlay writes via `allowOrgOverride: true`.
 * - `runtime-only`: the write targets a brand-new item OR an item that
 *   exists only in `sys_metadata` (no artifact backing). Permitted for
 *   types that opt into runtime creation via `allowRuntimeCreate: true`,
 *   even when they explicitly forbid artifact overrides.
 *
 * The protocol layer determines the intent by consulting the schema
 * registry; the repository's `assertAllowed()` enforces it as
 * defense-in-depth. Defaults to `override-artifact` for backward
 * compatibility with callers that predate the two-tier model.
 */
export type MetadataWriteIntent = 'override-artifact' | 'runtime-only';

export interface PutOptions {
  /**
   * Hash this writer believed was at HEAD. `null` means "creating, expect
   * absence". A mismatch throws ConflictError.
   */
  parentVersion: string | null;
  /** Identity of the writer; mirrored to MetadataEvent.actor. */
  actor: string;
  /** Optional human-readable commit message. */
  message?: string;
  /** Optional label for the change log "source" column. */
  source?: string;
  /** Two-tier authorization intent; defaults to `override-artifact`. */
  intent?: MetadataWriteIntent;
  /**
   * Software-package id to bind this metadata row to (`sys_metadata.package_id`).
   * Set when authoring inside a Studio package workspace. On create the row is
   * stamped with this id; on update an existing non-null binding is preserved
   * (never silently re-bound). Omit/undefined for env-local overlays.
   */
  packageId?: string | null;
}

export interface PutResult {
  /** New content hash assigned to the spec. */
  version: string;
  /** Sequence number of the emitted MetadataEvent. */
  seq: number;
  /** The committed item (canonicalised). */
  item: MetadataItem;
}

export interface DeleteOptions {
  parentVersion: string;
  actor: string;
  message?: string;
  source?: string;
  /** Two-tier authorization intent; defaults to `override-artifact`. */
  intent?: MetadataWriteIntent;
}

export interface DeleteResult {
  seq: number;
}

export interface ListFilter {
  org?: string;
  type?: MetadataType;
  /** Substring match on `name`; case-sensitive. */
  nameContains?: string;
  /** Pagination cursor; opaque string from a previous response. */
  cursor?: string;
  /** Page size; implementations may clamp. */
  limit?: number;
}

export interface WatchFilter {
  org?: string;
  type?: MetadataType;
  /** When omitted, match all names within the scope. */
  name?: string;
}

export interface HistoryOptions {
  /** Lower bound (exclusive) for pagination. */
  sinceSeq?: number;
  limit?: number;
}
