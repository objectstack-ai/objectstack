// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative as relativePath, resolve as resolvePath } from 'node:path';
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
   * The longest one request to the database (a statement, a document's batch,
   * a commit) may take before the call answers
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
  /**
   * Read the store's URL and auth token from the `knowledge` settings
   * (`turso_url`, `turso_auth_token`) when neither `url` nor `client` is
   * given. A URL read from there is held to the data directory
   * ({@link resolveSettingsStoreUrl}). The runtime's `knowledge` capability
   * mount sets it. @default false
   */
  urlFromSettings?: boolean;
  /** The project directory the default file and the data directory are under. @default process.cwd() */
  projectRoot?: string;
  /** The environment the platform's database URL is read from. @default process.env */
  env?: Record<string, string | undefined>;
}

/** The store's default URL: `file:` + `<projectRoot>/.objectstack/data/knowledge.db`. */
export function defaultStoreUrl(projectRoot: string = process.cwd()): string {
  return `file:${resolvePath(projectRoot, '.objectstack', 'data', DEFAULT_KNOWLEDGE_FILE)}`;
}

/** The project's data directory: `<projectRoot>/.objectstack/data`, where the default file is. */
export function dataDirectoryOf(projectRoot: string = process.cwd()): string {
  return resolvePath(projectRoot, '.objectstack', 'data');
}

/**
 * A control character (U+0000 to U+001F, U+007F) anywhere in a URL. The libSQL
 * client hands a `file:` URL to its native library, which ends the process on
 * a NUL byte inside the path rather than answering an error; no URL with a
 * control character in it names a store, so none reaches the client.
 */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** The bound on one request to a remote database (`requestTimeoutMs`). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** The request bound a store on `url` gets: the one given, else the default for a remote URL, else none. */
export function requestBoundFor(url: string, given?: number): number | undefined {
  if (given !== undefined) return given;
  return fileOf(url) === undefined && url !== ':memory:' ? DEFAULT_REQUEST_TIMEOUT_MS : undefined;
}

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

/** SQLite's side files of a database file: its write-ahead log, shared memory and rollback journal. */
const SIDE_FILE = /-(wal|shm|journal)$/;

/**
 * A database file as it is compared: its real path where it (or its directory)
 * exists, lower-cased, and a side file read as the database it belongs to.
 */
function canonicalFile(file: string): string {
  let real = file;
  try {
    real = realpathSync(file);
  } catch {
    try {
      real = resolvePath(realpathSync(dirname(file)), basename(file));
    } catch {
      /* neither exists yet: compared as written */
    }
  }
  return real.toLowerCase().replace(SIDE_FILE, '');
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
  if (CONTROL_CHARACTER.test(url)) {
    return { reason: 'its `url` option carries a NUL byte or another control character, which names no file or database.' };
  }
  if (!/^(file:|libsql:\/\/|https?:\/\/|wss?:\/\/)/i.test(url) && url !== ':memory:') {
    return { reason: 'its `url` option is not a file:, :memory: or libsql:// URL.' };
  }
  const file = fileOf(url);
  if (file === undefined && /^file:/i.test(url)) {
    return { reason: 'its `url` option is not a valid file: URL.' };
  }
  if (file !== undefined) {
    const env = opts.env ?? process.env;
    // Compared as the file it resolves to (a link to the platform's file is that
    // file), without case (on a case-insensitive file system two spellings are
    // one file), and with SQLite's side files read as their database.
    const platform = [env.OS_DATABASE_URL, env.DATABASE_URL]
      .map((u) => (u === undefined ? undefined : platformFileOf(u)))
      .filter((f): f is string => f !== undefined)
      .map((f) => canonicalFile(f));
    const store = canonicalFile(file);
    if (platform.includes(store) || PLATFORM_DATABASE_FILES.includes(basename(store))) {
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
 * A path as it is on disk: the real path of its nearest existing ancestor with
 * the rest appended, so a link anywhere above it is followed and a file not
 * yet created is still placed.
 */
function realPathAllowingMissing(path: string): string {
  const rest: string[] = [];
  let current = resolvePath(path);
  for (;;) {
    try {
      return resolvePath(realpathSync(current), ...rest);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolvePath(path);
      rest.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * The libSQL URL a store takes from the `knowledge.turso_url` setting, or why
 * it does not take it.
 *
 * A setting is written through the settings page and the settings API, by an
 * operator who never touches the server's disk, so what it may name is held
 * tighter than a URL written in code:
 *
 * - a control character (a NUL byte above all) is refused before anything
 *   else, so it never reaches the native client;
 * - a `file:` URL must name a file inside the project's data directory
 *   (`.objectstack/data/`, {@link dataDirectoryOf}), compared as the file it
 *   resolves to, so neither `..` nor a link leads out of it. A relative path is
 *   read from the process's working directory, as libSQL opens it;
 * - `:memory:` and a remote `libsql://`, `https://` or `wss://` URL open no
 *   local file and are taken as they are.
 *
 * Every rule {@link resolveStoreUrl} applies holds after these: the platform's
 * own database file is refused there too.
 */
export function resolveSettingsStoreUrl(
  url: string,
  opts: Pick<KnowledgeTursoPluginOptions, 'projectRoot' | 'env'> = {},
): { url: string; from: string } | { url?: undefined; reason: string } {
  const from = 'the knowledge setting `turso_url`';
  if (CONTROL_CHARACTER.test(url)) {
    return {
      reason:
        `${from} carries a NUL byte or another control character, which names no file or database. ` +
        'Save the URL again without it.',
    };
  }
  const trimmed = url.trim();
  if (/^file:/i.test(trimmed)) {
    const file = fileOf(trimmed);
    if (file === undefined) {
      return { reason: `${from} is not a valid file: URL.` };
    }
    const dataDir = realPathAllowingMissing(dataDirectoryOf(opts.projectRoot));
    const inside = relativePath(dataDir, realPathAllowingMissing(file));
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      return {
        reason:
          `${from} names a file outside the data directory (${dataDir}). A store file named in settings must be ` +
          `inside it, such as file:${resolvePath(dataDir, DEFAULT_KNOWLEDGE_FILE)}; a file elsewhere is named in the ` +
          "plugin's own `url` option.",
      };
    }
  }
  const target = resolveStoreUrl({ url: trimmed, projectRoot: opts.projectRoot, env: opts.env });
  return target.url === undefined ? { reason: target.reason.replace('its `url` option', from) } : { url: target.url, from };
}

/** A settings service as this plugin reads it: one key's resolved value and the layer it came from. */
interface StoreSettingsReader {
  get(namespace: string, key: string): Promise<{ value?: unknown; source?: string } | undefined>;
}

/** The settings service's code for a namespace or key nothing declares: nothing is saved there. */
const UNDECLARED_SETTING = new Set(['SETTINGS_UNKNOWN_NAMESPACE', 'SETTINGS_UNKNOWN_KEY']);

/**
 * The `knowledge.turso_url` and `knowledge.turso_auth_token` an operator
 * saved (any layer but the manifest's default, an `OS_*` override included).
 * Nothing saved, no settings service, or no `knowledge` namespace: `{}`. A
 * read that fails otherwise is a reason: a store must not open a file other
 * than the one an operator may have named.
 */
async function readStoreSettings(
  ctx: PluginContext,
): Promise<{ url?: string; authToken?: string } | { reason: string }> {
  let settings: StoreSettingsReader | undefined;
  try {
    settings = ctx.getService<StoreSettingsReader | undefined>('settings') ?? undefined;
  } catch {
    return {};
  }
  if (typeof settings?.get !== 'function') return {};
  const saved = async (key: string): Promise<string | undefined> => {
    let resolved: { value?: unknown; source?: string } | undefined;
    try {
      resolved = await settings.get('knowledge', key);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && UNDECLARED_SETTING.has(code)) return undefined;
      throw err;
    }
    if (!resolved || (resolved.source ?? 'default') === 'default') return undefined;
    const { value } = resolved;
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };
  try {
    const url = await saved('turso_url');
    const authToken = url === undefined ? undefined : await saved('turso_auth_token');
    return { ...(url === undefined ? {} : { url }), ...(authToken === undefined ? {} : { authToken }) };
  } catch (err) {
    return {
      reason: `the knowledge settings could not be read (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
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
  /**
   * Order-if-present (ADR-0116): start() registers with the knowledge service
   * and, under `urlFromSettings`, reads the `knowledge` settings, which the
   * settings service answers from the data engine. Literal ids: the boot-order
   * gates read this array statically.
   */
  optionalDependencies = [
    'com.objectstack.service.knowledge',
    'com.objectstack.service.settings',
    'com.objectstack.engine.objectql',
  ];

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
      let target: ReturnType<typeof resolveStoreUrl> = { reason: '' };
      let authToken = this.opts.authToken;
      const given = this.opts.url?.trim();
      if (this.opts.urlFromSettings && (given === undefined || given === '')) {
        const saved = await readStoreSettings(ctx);
        if ('reason' in saved) {
          target = { reason: saved.reason };
        } else if (saved.url !== undefined) {
          target = resolveSettingsStoreUrl(saved.url, this.opts);
          authToken = saved.authToken;
        } else {
          target = resolveStoreUrl(this.opts);
        }
      } else {
        target = resolveStoreUrl(this.opts);
      }
      if (target.url === undefined) {
        unavailable = target.reason;
      } else {
        requestTimeoutMs = requestBoundFor(target.url, requestTimeoutMs);
        const opened = await openClient(target.url, { ...this.opts, authToken });
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
