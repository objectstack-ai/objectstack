// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Embedding & Vector Store Primitives
 *
 * Platform contract for configuring embedding models and vector stores.
 *
 * Scope (intentionally minimal):
 * - How to reference an embedding model (provider + model name + secret).
 * - How to reference a vector store (provider + connection).
 *
 * NOT in scope (these belong to application code, not the platform):
 * - Chunking strategies (fixed/semantic/recursive/markdown).
 * - Retrieval pipelines (rerankers, multi-stage retrieval, filters).
 * - Document loaders / ingestion DSLs.
 * - End-to-end RAG pipeline orchestration.
 *
 * These were removed in v1 because they describe one specific way to
 * build a RAG application; the platform's job is to expose the embed +
 * vector primitives so any RAG strategy can be built on top.
 */

/**
 * Supported vector store providers.
 *
 * `custom` is the escape hatch for self-hosted or unlisted backends —
 * the actual connection details live in driver-specific config.
 */
export const VectorStoreProviderSchema = lazySchema(() => z.enum([
  'pgvector',
  'chroma',
  'qdrant',
  'pinecone',
  'weaviate',
  'milvus',
  'redis',
  'opensearch',
  'elasticsearch',
  'custom',
]));

/**
 * Embedding model reference.
 *
 * The platform uses this to look up an embedding adapter at runtime.
 * Credentials are *referenced* (via `secretRef`) rather than inlined
 * so metadata can be safely persisted.
 */
export const EmbeddingModelSchema = lazySchema(() => z.object({
  /** Provider identifier (e.g. `openai`, `cohere`, `local`). */
  provider: z.enum(['openai', 'cohere', 'azure_openai', 'huggingface', 'local', 'custom']),
  /** Model identifier as understood by the provider (e.g. `text-embedding-3-large`). */
  model: z.string().describe('Provider-specific model identifier'),
  /** Output vector dimensions — required so vector-store DDL can pre-size columns. */
  dimensions: z.number().int().positive().describe('Embedding vector dimensions'),
  /** Optional custom endpoint (for self-hosted / proxied providers). */
  endpoint: z.string().url().optional().describe('Custom endpoint URL'),
  /** Reference to a stored secret (preferred over inlining `apiKey`). */
  secretRef: z.string().optional().describe('Reference to stored API key secret'),
}));

/**
 * Vector store connection reference.
 *
 * Plugins / drivers implement the actual upsert / search calls; this
 * schema only captures *which* store and *how to reach it*.
 */
export const VectorStoreSchema = lazySchema(() => z.object({
  /** Backing provider. */
  provider: VectorStoreProviderSchema,
  /** Logical collection / index / namespace name. */
  collection: z.string().describe('Collection / index / namespace name'),
  /** Optional connection string or endpoint. */
  endpoint: z.string().optional().describe('Connection string or endpoint URL'),
  /** Reference to stored credentials. */
  secretRef: z.string().optional().describe('Reference to stored credential secret'),
  /** Dimensions of vectors in this store (must match the embedding model). */
  dimensions: z.number().int().positive().optional(),
}));

export type VectorStoreProvider = z.input<typeof VectorStoreProviderSchema>;
export type EmbeddingModel = z.input<typeof EmbeddingModelSchema>;
export type VectorStore = z.input<typeof VectorStoreSchema>;
