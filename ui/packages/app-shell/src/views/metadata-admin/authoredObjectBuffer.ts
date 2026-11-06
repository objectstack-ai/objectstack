// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29793, objectstack#30786 — the ONE reading of which document a
 * metadata editor edits: the item as its author wrote it, never the item as it
 * is served.
 *
 * The served reads are for display. For every type whose served reads the
 * server translates (`TRANSLATABLE_METADATA_TYPES`, the predicate the REST
 * read itself asks), `GET /meta/:type/:name?state=draft` answers the pending
 * draft translated for the console's `Accept-Language`: a view's or a page's
 * `label`, an app's navigation labels, a dashboard's widget titles. An object's
 * draft read is governed besides, with the platform's injected columns (`owner_id`,
 * `queue`, the audit and scope columns) in `fields`, and so is the layered read's
 * `effective` for an object. An editor that seeded its buffer from the served
 * draft and saved it back stored the translations as the author's text, and an
 * object's injected columns as author fields.
 *
 * The author-owned document is the layered read's, spelled by the contract
 * (`GetMetaItemLayeredResponseSchema.draft`): the `draft` layer, the pending
 * draft row as stored, `null` when none is pending. A server serves it only to a
 * caller its draft-read admission admits, and that same admission gates the
 * `?state=draft` read, so a caller that was served a draft body was served the
 * layer too. When the two disagree (a draft body served, no `draft` key on the
 * layers) there is no author-owned copy of that draft to edit: the answer is
 * `unserved`, the editor installs no buffer, and nothing is sent over the draft.
 * ⛔ Never fall back to the served draft body there: that is the translated
 * document this module exists to keep out of the buffer.
 *
 * With no draft pending, the buffer is the published item as authored
 * ({@link authoredPublished}): an object's `overlay ?? code`, because its
 * `effective` is governed; every other type's `effective ?? code`, which the
 * layered read serves untranslated and which stays the server's own reading of
 * the published item (the layered read decides it, not this module).
 *
 * Display may stay translated: the projection reads (published field names,
 * diagnostics, the header) keep reading what is served. Only the buffer moves.
 */

import { TRANSLATABLE_METADATA_TYPES } from '@objectstack/spec/system';
import { readFields, type FieldEntry } from './previews/object-fields-io.js';

/** The parts of the layered read this reading takes. */
export interface AuthoredLayers {
  code?: unknown;
  overlay?: unknown;
  effective?: unknown;
  draft?: unknown;
}

/** The object editor's spelling of {@link AuthoredLayers}. */
export type ObjectLayers = AuthoredLayers;

export type AuthoredBuffer =
  | {
      kind: 'buffer';
      /** The document the editor edits and saves. */
      body: Record<string, unknown>;
      /** True when `body` is the pending draft row. */
      fromDraft: boolean;
    }
  | {
      /** A draft is pending, and the layered read served no stored copy of it. */
      kind: 'unserved';
    };

function asDocument(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Whether an editor of `type` takes its buffer from the layers: the served reads
 * of the type are translated, so its served draft is not the author's document.
 * Any other type's served draft is the stored row (`objectui#10765`), and its
 * editors keep reading it.
 */
export function editsAuthoredLayers(type: string): boolean {
  return TRANSLATABLE_METADATA_TYPES.has(type);
}

/**
 * The editor's buffer for `type` from the layered read, and the draft body the
 * `?state=draft` read served (`extractDraftBody`, `null` when none is pending).
 * The served body only says whether a draft is pending; its content is never
 * the buffer.
 */
export function authoredBuffer(
  type: string,
  layers: AuthoredLayers | null | undefined,
  servedDraft: Record<string, unknown> | null,
): AuthoredBuffer {
  const stored = layers && 'draft' in layers ? asDocument(layers.draft) : null;
  if (stored) return { kind: 'buffer', body: stored, fromDraft: true };
  if (servedDraft) return { kind: 'unserved' };
  return { kind: 'buffer', body: authoredPublished(type, layers), fromDraft: false };
}

/**
 * The published item as its author wrote it: the buffer after a step that
 * leaves no draft to edit (a discard, a reset, a publish that promoted it).
 * An object's `overlay ?? code`; every other type's `effective ?? code`.
 */
export function authoredPublished(type: string, layers: AuthoredLayers | null | undefined): Record<string, unknown> {
  if (type === 'object') return asDocument(layers?.overlay) ?? asDocument(layers?.code) ?? {};
  return asDocument(layers?.effective) ?? asDocument(layers?.code) ?? {};
}

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
