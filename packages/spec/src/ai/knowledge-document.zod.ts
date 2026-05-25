// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Knowledge Document / Chunk / Hit — canonical shapes shared by every
 * `IKnowledgeAdapter` implementation.
 *
 * The framework does **not** prescribe chunk strategy or vector
 * format. Adapters are free to chunk however they like; the framework
 * only requires they round-trip these shapes when talking to the
 * `IKnowledgeService`.
 *
 * See `content/docs/protocol/knowledge.mdx` for the full design.
 */

/**
 * One logical document submitted to an adapter for indexing.
 *
 * For `object` sources, one ObjectQL record produces exactly one
 * document. For `file` / `http` sources, the adapter is free to split
 * a single file into many documents if that's the natural unit.
 */
export const KnowledgeDocumentSchema = lazySchema(() => z.object({
  /** Globally-unique document id. Snake / kebab-safe. */
  id: z.string().describe('Document id'),
  /** Logical source this document belongs to. */
  sourceId: z.string().describe('Owning KnowledgeSource id'),
  /**
   * Underlying ObjectQL record id when the source kind is `object`.
   * Powers permission-aware retrieval: hits referencing a record are
   * re-checked against the caller's `ExecutionContext`.
   */
  sourceRecordId: z.string().optional(),
  /** Document content. UTF-8 text. */
  content: z.string(),
  /** Optional human-readable title (defaults to id when absent). */
  title: z.string().optional(),
  /**
   * Arbitrary key-value metadata. Adapters may use it for filtering
   * (e.g. `{ status: 'active', tags: ['onboarding'] }`).
   */
  metadata: z.record(z.string(), z.unknown()).default({}).optional(),
  /**
   * Optional permission descriptors for non-`object` sources. The
   * framework treats this opaquely; permission-aware retrieval for
   * `object` sources is handled by re-querying via the data engine.
   */
  permissions: z.array(z.string()).optional(),
}));

/**
 * Adapter-produced chunk of a document. The framework never sees the
 * vector — only the chunk text + metadata. Used for upserts that
 * pre-chunk on the caller side (rare; most adapters chunk internally).
 */
export const KnowledgeChunkSchema = lazySchema(() => z.object({
  /** Chunk id (typically `${documentId}#${index}`). */
  id: z.string(),
  /** Owning document. */
  documentId: z.string(),
  /** Index within the document (0-based). */
  index: z.number().int().nonnegative(),
  /** Chunk text. */
  content: z.string(),
  /** Optional metadata override (falls back to the document's). */
  metadata: z.record(z.string(), z.unknown()).optional(),
}));

/**
 * A search hit returned to the caller. `score` semantics are
 * adapter-specific (cosine / dot product / hybrid blend); higher is
 * always better, normalised to `[0, 1]` when feasible.
 */
export const KnowledgeHitSchema = lazySchema(() => z.object({
  /** Stable chunk id from the adapter. */
  chunkId: z.string(),
  /** Owning document id. */
  documentId: z.string(),
  /** Source this hit came from. */
  sourceId: z.string(),
  /** ObjectQL record id when applicable — used for RLS re-check. */
  sourceRecordId: z.string().optional(),
  /** Relevance score (higher = better). */
  score: z.number(),
  /** Snippet shown to the user / LLM. */
  snippet: z.string(),
  /** Optional title surfaced from the document. */
  title: z.string().optional(),
  /** Free-form metadata propagated from the document. */
  metadata: z.record(z.string(), z.unknown()).default({}).optional(),
}));

export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;
