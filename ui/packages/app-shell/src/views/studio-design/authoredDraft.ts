// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30859 — the pending draft a Studio editor edits, as its author
 * wrote it.
 *
 * A Studio editor reads `?state=draft` for the version pin, the refusal and
 * the per-key provenance, and seeded its buffer from that body. For a type the
 * server translates (`editsAuthoredLayers`), the body is translated for the
 * console's locale, so a save of the buffer stored the translation as the
 * author's text. The buffer is the layered read's stored `draft` layer instead,
 * read at the address the draft read was asked at, through the one reading in
 * `authoredObjectBuffer.ts` (`authoredBuffer`). A served draft whose stored copy
 * the layers do not serve is `unserved`: the editor installs no buffer.
 *
 * Any other type's served draft is the stored row and stays the buffer.
 */

import type { MetadataClient } from '@object-ui/data-objectstack';
import {
  authoredBuffer,
  editsAuthoredLayers,
  type AuthoredBuffer,
  type AuthoredLayers,
} from '../metadata-admin/authoredObjectBuffer.js';

/** Where the draft read was asked: the package (and bundle member) the layered read must name. */
export interface AuthoredDraftAddress {
  packageId?: string | null;
  member?: string;
}

/** {@link readAuthoredDraft}'s answer: the buffer, and the layers it was read from (`null`: none were read). */
export interface AuthoredDraft {
  buffer: AuthoredBuffer;
  /**
   * The layered read at the draft's address, so an editor that also needs the
   * published layer there (`effective ?? code`) reads it from this answer
   * instead of asking `/layers` again.
   */
  layers: AuthoredLayers | null;
}

/**
 * The buffer for a pending draft of `type`/`name` whose `?state=draft` read
 * served `servedDraft` (`extractDraftBody`, never `null` here: with no draft
 * pending the editor keeps its own published baseline).
 */
export async function readAuthoredDraft(
  client: Pick<MetadataClient, 'layered'>,
  type: string,
  name: string,
  servedDraft: Record<string, unknown>,
  at: AuthoredDraftAddress,
): Promise<AuthoredDraft> {
  if (!editsAuthoredLayers(type)) return { buffer: { kind: 'buffer', body: servedDraft, fromDraft: true }, layers: null };
  const scope: { packageId?: string; member?: string } = {};
  if (at.packageId) scope.packageId = at.packageId;
  if (at.member) scope.member = at.member;
  const layers = (await client.layered<Record<string, unknown>>(type, name, scope)) as AuthoredLayers;
  return { buffer: authoredBuffer(type, layers, servedDraft), layers };
}
