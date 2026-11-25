// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';

/**
 * Knowledge Document / Chunk / Hit — canonical shapes shared by every
 * `IKnowledgeAdapter` implementation.
 *
 * The knowledge service owns the structural split (ADR-0161 K1): it cuts a
 * document into passages once, by the source's `split` key, and hands the
 * passages to every adapter that declares `capabilities.chunks` as the
 * document's `chunks`. An adapter that does not declare it receives whole
 * documents and splits them itself. The framework never sees a vector.
 *
 * See `content/docs/protocol/knowledge.mdx` for the full design.
 */

/**
 * One passage of a document, cut by the knowledge service's splitter
 * (ADR-0161 K8, item 5) and handed to an adapter that declares
 * `capabilities.chunks`, as `KnowledgeDocument.chunks`. The adapter embeds and
 * stores each chunk's `content` as given; it does not split a chunk again.
 */
export const KnowledgeChunkSchema = lazySchema(() => z.object({
  /**
   * Chunk id, set by the service to `${documentId}#${index}`, so a hit's
   * `chunkId` is the same on every adapter.
   */
  id: z.string(),
  /** Owning document. */
  documentId: z.string(),
  /** Index within the document (0-based). */
  index: z.number().int().nonnegative(),
  /**
   * Chunk text: the text the adapter embeds and returns as a snippet. Under
   * the `markdown` strategy it begins with the chunk's heading path.
   */
  content: z.string(),
  /**
   * The headings the chunk sits under, outermost first (the `markdown`
   * strategy). Absent when the strategy reads no headings.
   */
  headingPath: z.array(z.string()).optional()
    .describe('Headings the chunk sits under, outermost first (markdown strategy)'),
  /**
   * Tombstoned, not deleted: `KnowledgeChunkSchema` is not `.strict()`, so a
   * plain deletion would let a caller keep writing `metadata`, parse clean and
   * lose the value in silence. `retiredKey()` turns that into a rejection
   * carrying the fix, in both channels an author meets: `tsc` (the input type
   * is `never`) and the parse.
   *
   * Retired under ADR-0049 enforce-or-remove, as ADR-0161 K8 item 5 asks of
   * #37098: the key had no producer and no reader. The service's splitter
   * never sets per-passage metadata, and no adapter read one — a passage's
   * metadata is its document's `metadata`, which every adapter already stores
   * beside each passage.
   */
  metadata: retiredKey(
    '`KnowledgeChunk.metadata` was removed in @objectstack/spec 18 (ADR-0049, ADR-0161 K8) — ' +
    'nothing ever wrote or read it: the knowledge service cuts the passages and sets no ' +
    'per-passage metadata, and no adapter consulted one. Delete the key. A passage takes its ' +
    "document's `metadata` (`KnowledgeDocument.metadata`), which is what adapters filter on.",
  ),
}));

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
   * that stores `docHash` stores `organizationId` from the same version on;
   * otherwise, once it starts reading this field, a complete reindex skips its
   * documents and a walled search never ranks them.
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
  /**
   * The document's passages, cut by the knowledge service's splitter
   * (ADR-0161 K8, item 5). Set by the service, and only on a document handed
   * to an adapter that declares `capabilities.chunks`; a caller-supplied value
   * is refused by `indexDocument`. Derived from `content`, so it is not part
   * of `docHash`. An adapter that receives it indexes these passages as given.
   */
  chunks: z.array(KnowledgeChunkSchema).optional()
    .describe('Service-cut passages of the document, handed to an adapter that declares capabilities.chunks'),
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
