// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24395] The writer of `GetMetaItemResponseSchema.draftChanges` — a pending
 * draft's per-key provenance — as three pure functions the overlay repository
 * calls inside its draft `put` and the strict draft read calls to serve it.
 * The contract they meet is the key's describe in `@objectstack/spec/api`
 * (`protocol.zod.ts`); this header restates none of it beyond what the code
 * below decides.
 *
 * - {@link draftChangedPaths} — which key paths a draft save changed, from the
 *   body it replaced to the body it writes. A path stops at the deepest key
 *   whose value differs; an array, or any non-object value, is one leaf
 *   compared whole. `[[]]` when nothing was replaced (the save created the
 *   draft of an item with no stored published body).
 * - {@link mergeDraftChanges} — the keep rule: every entry at or under a path
 *   the save changed is replaced by one entry at that path, so no two entries
 *   share a path and the longest prefix of a key's path answers for it.
 * - {@link storedDraftChanges} — the entries a draft row stores
 *   (`sys_metadata.draft_changes`), `undefined` when it stores none, so the
 *   read never answers `[]` for a row whose saves recorded nothing.
 *
 * [#27176] An `mcp` write also stamps the OAuth `client` it was made by, on
 * the entry beside `by`; {@link authoringClientOf} is the one shape check the
 * save door and the stored read both apply to it.
 *
 * The entries live on the draft row, ⛔ never inside the stored body: publish
 * and discard both delete that row, so the entries go with it.
 */

import { canonicalize, orderedMapKeys } from '@objectstack/metadata-core';
import type { MetadataAuthoringClient, MetadataAuthoringSurface } from '@objectstack/spec/api';

/** One entry of `draftChanges`, as stored and as served. */
export interface DraftChangeEntry {
  readonly path: readonly string[];
  readonly by: MetadataAuthoringSurface;
  readonly actor: string | null;
  readonly at: string;
  /** Only beside `by: 'mcp'`, and only when the save stated it. */
  readonly client?: MetadataAuthoringClient;
}

/** The write a {@link mergeDraftChanges} stamps on each path it changed. */
export interface DraftChangeStamp {
  readonly by: MetadataAuthoringSurface;
  readonly actor: string | null;
  readonly at: string;
  readonly client?: MetadataAuthoringClient;
}

const SURFACES: ReadonlySet<string> = new Set<MetadataAuthoringSurface>(['copilot', 'mcp', 'studio', 'api']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `value` as a `MetadataAuthoringClient` (a non-empty `id`, an optional
 * non-empty `name`, nothing else), copied member by member, or `undefined`
 * when it is not one. The save door refuses a `client` this answers
 * `undefined` for; the stored read treats such an entry as malformed.
 */
export function authoringClientOf(value: unknown): MetadataAuthoringClient | undefined {
  if (!isPlainObject(value)) return undefined;
  const { id, name, ...rest } = value;
  if (Object.keys(rest).length > 0) return undefined;
  if (typeof id !== 'string' || id === '') return undefined;
  if (name === undefined) return { id };
  if (typeof name !== 'string' || name === '') return undefined;
  return { id, name };
}

/**
 * The key paths a draft save changed. `before` is the body the save replaced
 * (the draft row's, else the published row's), `undefined` when there was
 * none; `type` names the metadata type, whose declared ordered maps
 * (`orderedMapKeys`, an object's `fields`) make a pure reorder a change, as
 * the hash does.
 *
 * A key whose segment would be empty (`""`) cannot be a path segment
 * (`z.string().min(1)`), so a change under it is reported at its parent.
 */
export function draftChangedPaths(before: unknown, after: unknown, type?: string): string[][] {
  if (before === undefined) return [[]];
  const out: string[][] = [];
  const ordered = new Set(orderedMapKeys(type));
  const walk = (a: unknown, b: unknown, path: string[]): void => {
    if (!isPlainObject(a) || !isPlainObject(b)) {
      if (canonicalize(a) !== canonicalize(b)) out.push(path);
      return;
    }
    const found = out.length;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (key === '') {
        if (canonicalize(a[key]) !== canonicalize(b[key])) {
          out.splice(found);
          out.push(path);
          return;
        }
        continue;
      }
      const inA = Object.prototype.hasOwnProperty.call(a, key) && a[key] !== undefined;
      const inB = Object.prototype.hasOwnProperty.call(b, key) && b[key] !== undefined;
      if (inA !== inB) out.push([...path, key]);
      else if (inA) walk(a[key], b[key], [...path, key]);
    }
    // A declared ordered map whose members are unchanged but reordered: the
    // order is content, and the map is the deepest key that holds it.
    if (out.length === found && path.length === 1 && ordered.has(path[0]!)
      && Object.keys(a).join('\u0000') !== Object.keys(b).join('\u0000')) {
      out.push(path);
    }
  };
  walk(before, after, []);
  return out;
}

function isAtOrUnder(path: readonly string[], prefix: readonly string[]): boolean {
  if (path.length < prefix.length) return false;
  return prefix.every((segment, i) => path[i] === segment);
}

/**
 * The keep rule: `entries` (the draft row's, `[]` for none) after a save that
 * changed `paths`, stamped `stamp`. Every entry at or under a changed path is
 * dropped and one entry at that path takes its place; the rest are kept in
 * their order, the new ones follow in `paths`' order.
 */
export function mergeDraftChanges(
  entries: readonly DraftChangeEntry[],
  paths: readonly (readonly string[])[],
  stamp: DraftChangeStamp,
): DraftChangeEntry[] {
  const kept = entries.filter((entry) => !paths.some((p) => isAtOrUnder(entry.path, p)));
  return [
    ...kept,
    ...paths.map((path) => ({
      path: [...path],
      by: stamp.by,
      actor: stamp.actor,
      at: stamp.at,
      ...(stamp.client ? { client: stamp.client } : {}),
    })),
  ];
}

/**
 * The entries a draft row stores, or `undefined` when it stores none — a row
 * saved before the writer, a column a store does not carry, or a value that is
 * not a list of well-formed entries. ⛔ Never `[]`: an empty list would read
 * as "nothing changed" for exactly the rows nothing was recorded for.
 */
export function storedDraftChanges(raw: unknown): DraftChangeEntry[] | undefined {
  let value = raw;
  if (typeof value === 'string') {
    if (value === '') return undefined;
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const entries: DraftChangeEntry[] = [];
  for (const e of value as unknown[]) {
    if (!isPlainObject(e)) return undefined;
    const { path, by, actor, at } = e;
    if (!Array.isArray(path) || !path.every((s) => typeof s === 'string' && s !== '')) return undefined;
    if (typeof by !== 'string' || !SURFACES.has(by)) return undefined;
    if (actor !== null && typeof actor !== 'string') return undefined;
    if (typeof at !== 'string') return undefined;
    // [#27176] A client is the MCP door's alone, so one beside any other
    // surface is as malformed as a client of the wrong shape.
    const client = e.client === undefined ? undefined : authoringClientOf(e.client);
    if (e.client !== undefined && (client === undefined || by !== 'mcp')) return undefined;
    entries.push({
      path: [...path] as string[],
      by: by as MetadataAuthoringSurface,
      actor,
      at,
      ...(client ? { client } : {}),
    });
  }
  return entries;
}
