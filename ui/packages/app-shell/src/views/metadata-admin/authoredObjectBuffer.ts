// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29793, objectstack#30786 — the editors' reading of which document
 * they edit is `@object-ui/data-objectstack`'s `authoredBuffer` (its docblock is
 * the authority), re-exported here with the object editor's spellings and the
 * display-only {@link servedOnlyFields}.
 */

import { authoredBuffer, authoredPublished, type AuthoredBuffer, type AuthoredLayers } from '@object-ui/data-objectstack';
import { readFields, type FieldEntry } from './previews/object-fields-io.js';

export { authoredBuffer, authoredPublished, editsAuthoredLayers } from '@object-ui/data-objectstack';
export type { AuthoredBuffer, AuthoredLayers } from '@object-ui/data-objectstack';

/** The object editor's spelling of {@link AuthoredLayers}. */
export type ObjectLayers = AuthoredLayers;

/** {@link authoredBuffer} for an object. */
export function authoredObjectBuffer(
  layers: ObjectLayers | null | undefined,
  servedDraft: Record<string, unknown> | null,
): AuthoredBuffer {
  return authoredBuffer('object', layers, servedDraft);
}

/** {@link authoredPublished} for an object: `overlay ?? code`. */
export function authoredPublishedObject(layers: ObjectLayers | null | undefined): Record<string, unknown> {
  return authoredPublished('object', layers);
}

/**
 * The fields a SERVED object carries that none of the authored documents
 * declares, in served order: the platform's injected columns (`owner_id`,
 * `queue`, the audit and scope columns) and any field another package folds on.
 * Display only — a header's system-field count, a records grid's columns — so
 * the editor keeps showing what the server serves while its buffer holds only
 * what the author wrote.
 */
export function servedOnlyFields(served: unknown, authored: readonly unknown[]): FieldEntry[] {
  const declared = new Set(authored.flatMap((fields) => readFields(fields).entries.map((e) => e.name)));
  return readFields(served).entries.filter((e) => !declared.has(e.name));
}
