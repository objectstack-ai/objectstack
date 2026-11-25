// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import pg from 'pg';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IEmbedder, IKnowledgeService } from '@objectstack/spec/contracts';
import { EMBEDDER_SERVICE, KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import { PgvectorKnowledgeAdapter, type PgPoolLike } from './pgvector-adapter.js';

/** Options of {@link KnowledgePgvectorPlugin}. */
export interface KnowledgePgvectorPluginOptions {
  /** Adapter id, the value of `KnowledgeSource.adapter`. @default 'pgvector' */
  id?: string;
  /**
   * The PostgreSQL URL of the store; when given, it is used. Absent: the
   * platform database's URL (`OS_DATABASE_URL`, else the legacy
   * `DATABASE_URL`) when it is a PostgreSQL one. Absent both, the adapter
   * registers and answers every call `SERVICE_UNAVAILABLE`, saying so.
   */
  url?: string;
  /** The schema the store's tables live in. @default 'os_knowledge' */
  schema?: string;
  /** Connections in the store's own pool. @default 4 */
  poolMax?: number;
  /**
   * How long a new connection may take before it fails, in milliseconds. Boot
   * waits on the store's first check, so an unreachable host costs boot this
   * long, once, and each later call as long. @default 5000
   */
  connectTimeoutMs?: number;
  /** Text put before every query before it is embedded (see the adapter's option). */
  queryPrefix?: string;
  /** The embedder to call. Absent: the kernel's `embedder` service, read at each call. */
  embedder?: IEmbedder;
  /** The environment the URL is read from. @default process.env */
  env?: Record<string, string | undefined>;
}

/** The PostgreSQL URL the store connects to, and where it was read from. */
export function resolveStoreUrl(
  opts: Pick<KnowledgePgvectorPluginOptions, 'url' | 'env'>,
): { url: string; from: string } | { url?: undefined; reason: string } {
  if (opts.url !== undefined && opts.url.trim() !== '') {
    const url = opts.url.trim();
    if (!isPostgresUrl(url)) {
      return { reason: "its `url` option is not a postgres:// or postgresql:// URL." };
    }
    return { url, from: 'the plugin option `url`' };
  }
  const env = opts.env ?? process.env;
  for (const name of ['OS_DATABASE_URL', 'DATABASE_URL']) {
    const value = env[name]?.trim();
    if (!value) continue;
    if (isPostgresUrl(value)) return { url: value, from: name };
    return {
      reason:
        `the platform database (${name}) is not PostgreSQL, and the plugin was given no \`url\` of a PostgreSQL ` +
        'database with the pgvector extension.',
    };
  }
  return { reason: 'it was given no `url`, and the platform database URL (OS_DATABASE_URL) is not set.' };
}

function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

/** A `pg.Pool` seen as the adapter's {@link PgPoolLike}. */
export function poolFromPg(pool: pg.Pool): PgPoolLike {
  return {
    query: async <R>(text: string, params?: unknown[]) => {
      const result = await pool.query(text, params as unknown[] | undefined);
      return { rows: result.rows as R[] };
    },
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async <R>(text: string, params?: unknown[]) => {
          const result = await client.query(text, params as unknown[] | undefined);
          return { rows: result.rows as R[] };
        },
        release: (err?: Error | boolean) => client.release(err),
      };
    },
  };
}

/**
 * `KnowledgePgvectorPlugin` — registers a {@link PgvectorKnowledgeAdapter}
 * with the host's `IKnowledgeService` during `start()`.
 *
 * It opens a small pool of its own (`poolMax`, default 4) to the store's
 * database: the `url` it is given, else the platform database when that is
 * PostgreSQL. A connection that takes longer than `connectTimeoutMs` (default
 * 5000) fails, so an unreachable host does not hold boot. When the database cannot hold the store yet (no pgvector
 * extension, no right to create it or the schema) the adapter still
 * registers: boot continues, the warning names the SQL to run, its
 * `healthCheck` answers `ok: false`, and every call answers
 * `SERVICE_UNAVAILABLE` until the SQL has been run.
 *
 * With separate databases per organization, the store is in the ONE database
 * this plugin connects to — never each organization's — and
 * organizations are kept apart by the `organization_id` column, which every
 * search filters on.
 */
export class KnowledgePgvectorPlugin implements Plugin {
  name = 'com.objectstack.plugin.knowledge-pgvector';
  version = '0.1.0';
  type = 'standard' as const;

  private readonly opts: KnowledgePgvectorPluginOptions;
  private pool?: pg.Pool;

  constructor(opts: KnowledgePgvectorPluginOptions = {}) {
    this.opts = opts;
  }

  async init(_ctx: PluginContext): Promise<void> {
    // No-op: registration happens in start() once IKnowledgeService is up.
  }

  async start(ctx: PluginContext): Promise<void> {
    let svc: IKnowledgeService | undefined;
    try {
      svc = ctx.getService<IKnowledgeService>(KNOWLEDGE_SERVICE);
    } catch {
      ctx.logger.warn?.(
        'KnowledgePgvectorPlugin: IKnowledgeService not registered — install KnowledgeServicePlugin first.',
      );
      return;
    }

    const target = resolveStoreUrl(this.opts);
    if (target.url !== undefined) {
      this.pool = new pg.Pool({
        connectionString: target.url,
        max: this.opts.poolMax ?? 4,
        connectionTimeoutMillis: this.opts.connectTimeoutMs ?? 5000,
      });
      // An idle connection's error (the server restarted) must not end the process.
      this.pool.on('error', (err) => ctx.logger.warn?.(`KnowledgePgvectorPlugin: idle connection error: ${err.message}`));
    }

    // Read at each call, never cached: the kernel's embedder may register
    // after this plugin starts, or be replaced (ADR-0161 K8, item 6), and the
    // adapter reports the embedder it will actually call.
    const embedder = (): IEmbedder | undefined => {
      if (this.opts.embedder) return this.opts.embedder;
      try {
        return ctx.getService<IEmbedder>(EMBEDDER_SERVICE);
      } catch {
        return undefined;
      }
    };

    const adapter = new PgvectorKnowledgeAdapter({
      id: this.opts.id,
      ...(this.pool ? { pool: poolFromPg(this.pool) } : { unavailable: target.url === undefined ? target.reason : undefined }),
      embedder,
      schema: this.opts.schema,
      queryPrefix: this.opts.queryPrefix,
    });
    svc.registerAdapter(adapter.id, adapter);

    const health = await adapter.healthCheck();
    if (health.ok) {
      ctx.logger.info?.(`KnowledgePgvectorPlugin: adapter '${adapter.id}' registered (${health.message}).`);
    } else {
      ctx.logger.warn?.(
        `KnowledgePgvectorPlugin: adapter '${adapter.id}' registered but not ready; its sources answer ` +
          `SERVICE_UNAVAILABLE until this is fixed. ${health.message ?? ''}`,
      );
    }
  }

  async destroy(): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    await pool?.end();
  }
}
