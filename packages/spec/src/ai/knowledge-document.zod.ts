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
  /**
   * The organization the document belongs to (ADR-0161 K8, item 9). Set by the
   * knowledge service when it assembles a document from a record: the
   * record's `organization_id`, under a walled tenancy posture (`group` or
   * `isolated`, ADR-0105 D1). Absent for `file` / `http` sources, under the
   * `single` posture, and for a record that carries no organization; a
   * caller-supplied value is refused by `indexDocument`. Stored by the adapter
   * and read by its search: when the search is handed
   * `AdapterSearchOptions.organizationIds`, only documents whose organization
   * is in that set are ranked, so a document without one is not. An adapter
   * that stores `docHash` stores `organizationId` from the same version on:
   * the hash already covers the organization, so an adapter that held only the
   * hash would have every document skipped by a later complete reindex, and a
   * walled search would never rank them.
   */
  organizationId: z.string().optional()
    .describe('Organization of the record the document was assembled from; set by the knowledge service under a walled tenancy posture'),
  /**
   * A hash of the assembled document — its content, title and metadata, and its
   * `organizationId` when it has one, in a stable key order, behind a version
   * prefix (ADR-0161 K8, item 2). Set by
   * the knowledge service on every document it hands an adapter; a
   * caller-supplied value is refused by `indexDocument`. Stored by the adapter
   * and returned as stored by `listDocuments`; an unchanged hash lets a
   * complete reindex skip writing the document again. Adapters never compute
   * or alter it.
   */
  docHash: z.string().optional()
    .describe('Service-computed hash of the assembled document (content, title, metadata, and organizationId when set); stored and returned as stored by the adapter'),
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

export type KnowledgeDocument = z.input<typeof KnowledgeDocumentSchema>;
export type KnowledgeChunk = z.input<typeof KnowledgeChunkSchema>;
export type KnowledgeHit = z.input<typeof KnowledgeHitSchema>;
