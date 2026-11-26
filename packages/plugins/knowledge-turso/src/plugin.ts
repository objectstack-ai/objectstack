// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { mkdirSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IEmbedder, IKnowledgeService } from '@objectstack/spec/contracts';
import { EMBEDDER_SERVICE, KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import { TursoKnowledgeAdapter } from './turso-adapter.js';

/** The store's file name when no `url` is given, beside the platform's own database. */
export const DEFAULT_KNOWLEDGE_FILE = 'knowledge.db';

/**
 * The file names the platform's own SQLite database takes under
 * `.objectstack/data/` (the runtime's default and its two legacy names). The
 * store never opens one: two engines writing one SQLite file in one process
 * lose rows.
 */
export const PLATFORM_DATABASE_FILES: readonly string[] = ['objectstack.db', 'dev.db', 'standalone.db'];

/** Options of {@link KnowledgeTursoPlugin}. */
export interface KnowledgeTursoPluginOptions {
  /** Adapter id, the value of `KnowledgeSource.adapter`. @default 'turso' */
  id?: string;
  /**
   * The libSQL URL of the store: a `file:` URL, `:memory:`, or a `libsql://`
   * (Turso) URL. Absent: {@link defaultStoreUrl} — `knowledge.db` under the
   * project's `.objectstack/data/`. Never the platform's own database file.
   */
  url?: string;
  /** The auth token of a `libsql://` URL. */
  authToken?: string;
  /**
   * A libSQL client the store uses as it is (the plugin neither configures nor
   * closes it). It must not be a client of the platform's own database file.
   */
  client?: Client;
  /**
   * How long a write waits for another process holding the file's lock, in
   * milliseconds (SQLite's busy timeout; `file:` URLs only). @default 5000
   */
  busyTimeoutMs?: number;
  /**
   * The longest one turn of database work may take before the call answers
   * `SERVICE_UNAVAILABLE`, for a remote database (`libsql://`, `https://`,
   * `wss://`), whose requests have no bound of their own. Applies to a
   * `client` given as it is only when set.
   * @default 10000 for a remote URL; none for a file or `:memory:`
   */
  requestTimeoutMs?: number;
  /** Text put before every query before it is embedded (see the adapter's option). */
  queryPrefix?: string;
  /** The embedder to call. Absent: the kernel's `embedder` service, read at each call. */
  embedder?: IEmbedder;
  /** The project directory the default file is under. @default process.cwd() */
  projectRoot?: string;
  /** The environment the platform's database URL is read from. @default process.env */
  env?: Record<string, string | undefined>;
}

/** The store's default URL: `file:` + `<projectRoot>/.objectstack/data/knowledge.db`. */
export function defaultStoreUrl(projectRoot: string = process.cwd()): string {
  return `file:${resolvePath(projectRoot, '.objectstack', 'data', DEFAULT_KNOWLEDGE_FILE)}`;
}

/** The bound on one turn of database work against a remote database (`requestTimeoutMs`). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** The local file a `file:` URL names, or `undefined` for any other URL. */
export function fileOf(url: string): string | undefined {
  if (!/^file:/i.test(url)) return undefined;
  const rest = url.slice('file:'.length).split('?')[0];
  if (rest.startsWith('//')) {
    try {
      return fileURLToPath(url.split('?')[0]);
    } catch {
      return undefined;
    }
  }
  try {
    // libSQL percent-decodes the path it opens; so is the name compared here.
    return resolvePath(decodeURIComponent(rest));
  } catch {
    return undefined;
  }
}

/** The file a platform database URL names: a `file:` / `sqlite:` URL, or a bare path. */
function platformFileOf(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed === '' || trimmed === ':memory:') return undefined;
  if (/^sqlite:/i.test(trimmed)) return fileOf(trimmed.replace(/^sqlite:(\/\/)?/i, 'file:'));
  if (/^file:/i.test(trimmed)) return fileOf(trimmed);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return undefined;
  return resolvePath(trimmed);
}

/** The libSQL URL the store opens, and where it was read from — or why there is none. */
export function resolveStoreUrl(
  opts: Pick<KnowledgeTursoPluginOptions, 'url' | 'projectRoot' | 'env'>,
): { url: string; from: string } | { url?: undefined; reason: string } {
  const given = opts.url?.trim();
  const url = given === undefined || given === '' ? defaultStoreUrl(opts.projectRoot) : given;
  const from = given === undefined || given === '' ? 'the default location' : 'the plugin option `url`';
  if (!/^(file:|libsql:\/\/|https?:\/\/|wss?:\/\/)/i.test(url) && url !== ':memory:') {
    return { reason: 'its `url` option is not a file:, :memory: or libsql:// URL.' };
  }
  const file = fileOf(url);
  if (file === undefined && /^file:/i.test(url)) {
    return { reason: 'its `url` option is not a valid file: URL.' };
  }
  if (file !== undefined) {
    const env = opts.env ?? process.env;
    // Compared without case: on a case-insensitive file system two spellings are one file.
    const platform = [env.OS_DATABASE_URL, env.DATABASE_URL]
      .map((u) => (u === undefined ? undefined : platformFileOf(u)))
      .filter((f): f is string => f !== undefined)
      .map((f) => f.toLowerCase());
    if (platform.includes(file.toLowerCase()) || PLATFORM_DATABASE_FILES.includes(basename(file).toLowerCase())) {
      return {
        reason:
          `its URL names the platform's own database file (${basename(file)}). The store keeps a libSQL file of its ` +
          `own: two engines writing one SQLite file lose rows. Give it another file, such as ${DEFAULT_KNOWLEDGE_FILE} beside it.`,
      };
    }
  }
  return { url, from };
}

/**
 * `KnowledgeTursoPlugin` — registers a {@link TursoKnowledgeAdapter} with the
 * host's `IKnowledgeService` during `start()`.
 *
 * It opens a libSQL database of its own — by default `knowledge.db` under the
 * project's `.objectstack/data/`, beside the platform's database and never
 * the platform's file — with WAL and a busy timeout on a file. When the
 * database cannot be opened, or `@libsql/client` has no native build for the
 * platform (there is none for Windows on ARM), the adapter still registers:
 * boot continues, the warning says why, its `healthCheck` answers
 * `ok: false`, and every call answers `SERVICE_UNAVAILABLE`.
 */
export class KnowledgeTursoPlugin implements Plugin {
  name = 'com.objectstack.plugin.knowledge-turso';
  version = '0.1.0';
  type = 'standard' as const;

  private readonly opts: KnowledgeTursoPluginOptions;
  private owned?: Client;

  constructor(opts: KnowledgeTursoPluginOptions = {}) {
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
      ctx.logger.warn?.('KnowledgeTursoPlugin: IKnowledgeService not registered — install KnowledgeServicePlugin first.');
      return;
    }

    let client: Client | undefined = this.opts.client;
    let unavailable: string | undefined;
    let requestTimeoutMs = this.opts.requestTimeoutMs;
    if (!client) {
      const target = resolveStoreUrl(this.opts);
      if (target.url === undefined) {
        unavailable = target.reason;
      } else {
        if (fileOf(target.url) === undefined && target.url !== ':memory:') requestTimeoutMs ??= DEFAULT_REQUEST_TIMEOUT_MS;
        const opened = await openClient(target.url, this.opts);
        if ('client' in opened) client = this.owned = opened.client;
        else unavailable = opened.reason;
      }
    }

    // Read at each call, never cached: the kernel's embedder may register
    // after this plugin starts, or be replaced (ADR-0161 K8, item 6).
    const embedder = (): IEmbedder | undefined => {
      if (this.opts.embedder) return this.opts.embedder;
      try {
        return ctx.getService<IEmbedder>(EMBEDDER_SERVICE);
      } catch {
        return undefined;
      }
    };

    const adapter = new TursoKnowledgeAdapter({
      id: this.opts.id,
      ...(client ? { client } : { unavailable }),
      embedder,
      queryPrefix: this.opts.queryPrefix,
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    });
    svc.registerAdapter(adapter.id, adapter);

    const health = await adapter.healthCheck();
    if (health.ok) {
      ctx.logger.info?.(`KnowledgeTursoPlugin: adapter '${adapter.id}' registered (${health.message}).`);
    } else {
      ctx.logger.warn?.(
        `KnowledgeTursoPlugin: adapter '${adapter.id}' registered but not ready; its sources answer ` +
          `SERVICE_UNAVAILABLE until this is fixed. ${health.message ?? ''}`,
      );
    }
  }

  async destroy(): Promise<void> {
    const client = this.owned;
    this.owned = undefined;
    try {
      client?.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Loads `@libsql/client` and opens the store's database. The client is loaded
 * here, not at module load, so a platform without its native build (Windows
 * on ARM) gets a store that says so rather than a boot that fails.
 */
async function openClient(
  url: string,
  opts: Pick<KnowledgeTursoPluginOptions, 'authToken' | 'busyTimeoutMs'>,
): Promise<{ client: Client } | { reason: string }> {
  let createClient: typeof import('@libsql/client').createClient;
  try {
    ({ createClient } = await import('@libsql/client'));
  } catch (err) {
    return {
      reason:
        `@libsql/client could not be loaded on ${process.platform}-${process.arch} ` +
        `(${err instanceof Error ? err.message : String(err)}). libSQL publishes no native build for every ` +
        'platform (none for Windows on ARM); use knowledge-pgvector there.',
    };
  }
  const file = fileOf(url);
  try {
    if (file !== undefined) mkdirSync(dirname(file), { recursive: true });
    const client = createClient({
      url,
      ...(opts.authToken === undefined ? {} : { authToken: opts.authToken }),
      ...(file === undefined ? {} : { timeout: opts.busyTimeoutMs ?? 5000 }),
    });
    return { client };
  } catch (err) {
    return { reason: `the database at ${file ?? 'the given URL'} could not be opened (${err instanceof Error ? err.message : String(err)}).` };
  }
}
