// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { EmbeddingModelSchema, VectorStoreSchema } from './embedding.zod';

/**
 * Knowledge Source — declarative metadata describing what to index and
 * which adapter to use.
 *
 * A KnowledgeSource is the metadata-level equivalent of an
 * `IDataEngine` driver binding: it pairs a logical source description
 * (object/file/http) with the *id* of an `IKnowledgeAdapter` plugin
 * that will actually do the work. The adapter resolves the id at
 * runtime via `IKnowledgeService.registerAdapter`.
 *
 * See `content/docs/protocol/knowledge.mdx` for the full design.
 */

/** Refresh strategies for a knowledge source. */
export const KnowledgeRefreshPolicySchema = lazySchema(() => z.object({
  /**
   * Subscribe to ObjectQL `record.*` events for `object` sources.
   * Defaults to `true` for object sources; ignored for file/http.
   */
  onRecordChange: z.boolean().default(true).optional(),
  /**
   * Cron expression (5-field) for periodic full reindex. Optional.
   * `service-knowledge` does not schedule the cron itself — it merely
   * surfaces the value so an automation flow / external scheduler can
   * trigger `reindexSource`.
   */
  cron: z.string().optional(),
}));

/** Source backed by an ObjectQL object — each record becomes a document. */
export const ObjectKnowledgeSourceSchema = lazySchema(() => z.object({
  kind: z.literal('object'),
  /** Short object name (e.g. `task`, `kb_article`). */
  object: z.string().describe('Short object name to index'),
  /**
   * Fields to concatenate into the document body (in order).
   * `*` means "use every readable text field" (adapter / service decides).
   */
  contentFields: z.array(z.string()).min(1).describe('Fields contributing to document content'),
  /**
   * Extra fields to project into `metadata` for filtering at search
   * time (e.g. `status`, `owner_id`, `tags`).
   */
  metadataFields: z.array(z.string()).default([]).optional(),
  /**
   * Optional filter restricting which records are indexed.
   * Uses ObjectQL `where` syntax.
   */
  where: z.record(z.string(), z.unknown()).optional(),
}));

/** Source backed by a folder in `IStorageService`. */
export const FileKnowledgeSourceSchema = lazySchema(() => z.object({
  kind: z.literal('file'),
  /** Storage prefix to scan (e.g. `kb/handbooks/`). */
  prefix: z.string().describe('Storage prefix'),
  /** Optional MIME-type allow-list. Empty = all types. */
  mimeTypes: z.array(z.string()).default([]).optional(),
}));

/** Source backed by a list of remote URLs. */
export const HttpKnowledgeSourceSchema = lazySchema(() => z.object({
  kind: z.literal('http'),
  /** URLs to fetch. */
  urls: z.array(z.string().url()).min(1),
  /** Optional User-Agent header. */
  userAgent: z.string().optional(),
}));

export const KnowledgeSourceKindSchema = lazySchema(() => z.discriminatedUnion('kind', [
  ObjectKnowledgeSourceSchema,
  FileKnowledgeSourceSchema,
  HttpKnowledgeSourceSchema,
]));

/**
 * Canonical KnowledgeSource. Stored as metadata, versioned, and
 * environment-scoped exactly like a view or a flow.
 */
export const KnowledgeSourceSchema = lazySchema(() => z.object({
  /** Stable identifier. Snake_case. */
  id: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Snake_case source id'),
  /** Human-readable label. */
  label: z.string(),
  /** Optional description. */
  description: z.string().optional(),
  /**
   * Adapter id this source binds to (e.g. `'ragflow'`, `'memory'`).
   * Resolved at runtime by `IKnowledgeService.registerAdapter`.
   */
  adapter: z.string().describe('Adapter id'),
  /** Adapter-specific configuration (opaque to the service). */
  adapterConfig: z.record(z.string(), z.unknown()).default({}).optional(),
  /** What gets indexed. */
  source: KnowledgeSourceKindSchema,
  /**
   * Optional embedding model reference. Adapters that manage
   * embeddings internally (RAGFlow, Dify, Vectara) may ignore this.
   */
  embedding: EmbeddingModelSchema.optional(),
  /**
   * Optional vector store reference. Same caveat as `embedding` — many
   * adapters own their own backend.
   */
  vectorStore: VectorStoreSchema.optional(),
  /** Refresh / sync configuration. */
  refresh: KnowledgeRefreshPolicySchema.default({}).optional(),
  /** Whether `search_knowledge` may expose this source to AI agents. */
  aiExposed: z.boolean().default(true).optional(),
}));

export type KnowledgeRefreshPolicy = z.infer<typeof KnowledgeRefreshPolicySchema>;
export type ObjectKnowledgeSource = z.infer<typeof ObjectKnowledgeSourceSchema>;
export type FileKnowledgeSource = z.infer<typeof FileKnowledgeSourceSchema>;
export type HttpKnowledgeSource = z.infer<typeof HttpKnowledgeSourceSchema>;
export type KnowledgeSourceKind = z.infer<typeof KnowledgeSourceKindSchema>;
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;
