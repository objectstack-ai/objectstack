// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29793 — the ONE reading of which document an object editor
 * edits: the object as its author wrote it, never the object as it is served.
 *
 * The served reads are for display. `GET /meta/object/X?state=draft` answers
 * the pending draft translated for the console's `Accept-Language` and
 * governed, with the platform's injected columns (`owner_id`, `queue`, the
 * audit and scope columns) in `fields`; the layered read's `effective` is
 * governed the same way. An editor that seeded its buffer from either and
 * saved it back stored the translations as the author's labels and sent the
 * platform's own columns as author fields.
 *
 * The author-owned document is the layered read's, spelled by the contract
 * (`GetMetaItemLayeredResponseSchema.draft`): `draft ?? overlay ?? code`. The
 * `draft` layer is the pending draft row as stored, `null` when none is
 * pending. A server serves it only to a caller its draft-read admission admits,
 * and that same admission gates the `?state=draft` read, so a caller that was
 * served a draft body was served the layer too. When the two disagree (a draft
 * body served, no `draft` key on the layers) there is no author-owned copy of
 * that draft to edit: the answer is `unserved`, the editor installs no buffer,
 * and nothing is sent over the draft. ⛔ Never fall back to the served draft
 * body there: that is the translated, governed document this module exists to
 * keep out of the buffer.
 *
 * Display may stay translated: the projection reads (published field names,
 * diagnostics, the header) keep reading `effective`. Only the buffer moves.
 */

import { readFields, type FieldEntry } from './previews/object-fields-io.js';

/** The parts of the layered read this reading takes. */
export interface ObjectLayers {
  code?: unknown;
  overlay?: unknown;
  draft?: unknown;
}

export type AuthoredObjectBuffer =
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
 * The object editor's buffer from the layered read, and the draft body the
 * `?state=draft` read served (`extractDraftBody`, `null` when none is pending).
 * The served body only says whether a draft is pending; its content is never
 * the buffer.
 */
export function authoredObjectBuffer(
  layers: ObjectLayers | null | undefined,
  servedDraft: Record<string, unknown> | null,
): AuthoredObjectBuffer {
  const stored = layers && 'draft' in layers ? asDocument(layers.draft) : null;
  if (stored) return { kind: 'buffer', body: stored, fromDraft: true };
  if (servedDraft) return { kind: 'unserved' };
  return { kind: 'buffer', body: authoredPublishedObject(layers), fromDraft: false };
}

/**
 * The published object as its author wrote it, `overlay ?? code`: the buffer
 * after a step that leaves no draft to edit (a discard, a reset).
 */
export function authoredPublishedObject(layers: ObjectLayers | null | undefined): Record<string, unknown> {
  return asDocument(layers?.overlay) ?? asDocument(layers?.code) ?? {};
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
