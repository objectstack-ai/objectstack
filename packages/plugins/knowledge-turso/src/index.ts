// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/knowledge-turso`
 *
 * Turso / libSQL native-vector knowledge adapter. Implements the
 * `IKnowledgeAdapter` contract on top of `F32_BLOB` columns +
 * `libsql_vector_idx` (DiskANN). Each `KnowledgeSource` gets its own
 * `knowledge_<source.id>` table, bootstrapped lazily.
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IKnowledgeService, IEmbedder } from '@objectstack/spec/contracts';
import { KNOWLEDGE_SERVICE, EMBEDDER_SERVICE } from '@objectstack/spec/contracts';
import { createClient, type Client } from '@libsql/client';

import { TursoKnowledgeAdapter, type TursoAdapterOptions } from './turso-adapter';

export { TursoKnowledgeAdapter } from './turso-adapter';
export type { TursoAdapterOptions } from './turso-adapter';
export {
  HashEmbedder,
  HashEmbeddingProvider,
  type EmbeddingProvider,
} from './embedding';

export interface KnowledgeTursoPluginOptions {
  /** Adapter id used in `KnowledgeSource.adapter`. @default 'turso' */
  id?: string;
  /**
   * Either a libsql connection url (`libsql://…`, `file:…`, `:memory:`)
   * with optional auth token, OR a pre-constructed client. The latter is
   * useful when the kernel already owns a Turso connection (e.g. shared
   * with `driver-turso`).
   */
  url?: string;
  authToken?: string;
  client?: Client;
  /**
   * Embedder used for both upsert and search.
   *
   * When omitted, the plugin resolves the kernel-registered
   * `EMBEDDER_SERVICE` at `start()` time — typically the embedder
   * configured by `@objectstack/service-ai` from the `ai` settings
   * namespace. This is the recommended path: operators configure the
   * embedder once in `Settings → AI & Embedder` and every knowledge
   * adapter picks it up.
   *
   * For explicit wiring (tests, smoke runs, multi-embedder setups),
   * pass an instance directly. Compatible plugins:
   *   - `@objectstack/embedder-openai` (OpenAI / 阿里通义 / 智谱 /
   *     硅基流动 / 火山 Doubao / Ollama / 任何 OpenAI-shape 兼容端点)
   *
   * For tests / smoke runs, use the bundled `HashEmbedder`.
   */
  embedding?: IEmbedder;
  /** Forwarded to the adapter. */
  chunkTarget?: TursoAdapterOptions['chunkTarget'];
  /** Forwarded to the adapter. */
  overFetch?: TursoAdapterOptions['overFetch'];
}

/**
 * `KnowledgeTursoPlugin` — registers a `TursoKnowledgeAdapter` with the
 * host's `IKnowledgeService` during `start()`. If the service is not
 * installed the plugin no-ops with a warning so the host can boot.
 */
export class KnowledgeTursoPlugin implements Plugin {
  name = 'com.objectstack.plugin.knowledge-turso';
  version = '0.1.0';
  type = 'standard' as const;

  private adapter?: TursoKnowledgeAdapter;
  private readonly ownsClient: boolean;
  private readonly client: Client;
  private readonly providedEmbedder?: IEmbedder;
  private readonly adapterId: string;
  private readonly chunkTarget?: TursoAdapterOptions['chunkTarget'];
  private readonly overFetch?: TursoAdapterOptions['overFetch'];

  constructor(opts: KnowledgeTursoPluginOptions) {
    if (opts.client) {
      this.client = opts.client;
      this.ownsClient = false;
    } else {
      if (!opts.url) {
        throw new Error('KnowledgeTursoPlugin: provide either `client` or `url`.');
      }
      this.client = createClient({ url: opts.url, authToken: opts.authToken });
      this.ownsClient = true;
    }
    this.providedEmbedder = opts.embedding;
    this.adapterId = opts.id ?? 'turso';
    this.chunkTarget = opts.chunkTarget;
    this.overFetch = opts.overFetch;
  }

  async init(_ctx: PluginContext): Promise<void> {
    // No-op: registration deferred to start() once IKnowledgeService is up.
  }

  async start(ctx: PluginContext): Promise<void> {
    // Resolve the embedder: prefer the constructor-supplied instance
    // (explicit wiring), otherwise fall back to the kernel-registered
    // EMBEDDER_SERVICE (settings-driven by service-ai).
    let embedder: IEmbedder | undefined = this.providedEmbedder;
    if (!embedder) {
      try {
        embedder = ctx.getService<IEmbedder>(EMBEDDER_SERVICE);
      } catch {
        ctx.logger.warn?.(
          'KnowledgeTursoPlugin: no `embedding` option provided and no EMBEDDER_SERVICE registered. ' +
            'Configure an embedder in Settings → AI & Embedder, or pass `embedding` in the plugin options.',
        );
        return;
      }
    }

    this.adapter = new TursoKnowledgeAdapter({
      id: this.adapterId,
      client: this.client,
      embedder,
      chunkTarget: this.chunkTarget,
      overFetch: this.overFetch,
    });

    let svc: IKnowledgeService | undefined;
    try {
      svc = ctx.getService<IKnowledgeService>(KNOWLEDGE_SERVICE);
    } catch {
      ctx.logger.warn?.(
        'KnowledgeTursoPlugin: IKnowledgeService not registered — install KnowledgeServicePlugin first.',
      );
      return;
    }
    svc.registerAdapter(this.adapter.id, this.adapter);
    ctx.logger.info?.(
      `KnowledgeTursoPlugin: adapter '${this.adapter.id}' registered ` +
        `(embedder=${embedder.id}, dims=${embedder.dimensions}).`,
    );
  }

  async stop(_ctx: PluginContext): Promise<void> {
    if (this.ownsClient) {
      try {
        this.client.close();
      } catch {
        /* noop */
      }
    }
  }
}

export default KnowledgeTursoPlugin;
