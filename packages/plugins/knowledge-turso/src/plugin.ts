// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
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
  /**
   * The auth token of a `libsql://` URL. One with a control character in it
   * (a pasted line break, a NUL byte) is refused before it reaches the client.
   */
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
   * ({@link resolveSettingsStoreUrl}). They are read when the boot completes
   * (`kernel:bootstrapped`), and the store opens then. The runtime's
   * `knowledge` capability mount sets it. @default false
   */
  urlFromSettings?: boolean;
  /** The project directory the default file and the data directory are under. @default process.cwd() */
  projectRoot?: string;
  /**
   * The platform's state directory (`OS_HOME`, `os start --home`), where the
   * boot keeps the platform database: the data directory is then
   * `<stateDir>/data`, so the store's file moves with the database's. A leading
   * `~` is the user's home. The runtime's `knowledge` capability mount passes
   * `OS_HOME`. @default `<projectRoot>/.objectstack`
   */
  stateDir?: string;
  /** The environment the platform's database URL is read from. @default process.env */
  env?: Record<string, string | undefined>;
}

/** The store's default URL: `file:` + `knowledge.db` in the data directory ({@link dataDirectoryOf}). */
export function defaultStoreUrl(projectRoot: string = process.cwd(), stateDir?: string): string {
  return `file:${resolvePath(dataDirectoryOf(projectRoot, stateDir), DEFAULT_KNOWLEDGE_FILE)}`;
}

/**
 * The data directory, where the default file is and where a settings URL must
 * stay: `<stateDir>/data` when a state directory is given (the order the boot
 * resolves the platform database's own directory in: `--home`, `OS_HOME`, then
 * the project), else `<projectRoot>/.objectstack/data`.
 */
export function dataDirectoryOf(projectRoot: string = process.cwd(), stateDir?: string): string {
  const state = stateDir?.trim();
  if (state === undefined || state === '') return resolvePath(projectRoot, '.objectstack', 'data');
  return state.startsWith('~')
    ? resolvePath(homedir(), state.slice(1).replace(/^[/\\]/, ''), 'data')
    : resolvePath(state, 'data');
}

/**
 * A control character (U+0000 to U+001F, U+007F) anywhere in a URL. The libSQL
 * client hands a `file:` URL to its native library, which ends the process on
 * a NUL byte inside the path rather than answering an error; no URL with a
 * control character in it names a store, so none reaches the client.
 */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** One percent escape (`%00`, `%0a`), read byte by byte: a malformed one is left as written. */
const PERCENT_ESCAPE = /%([0-9a-f]{2})/gi;

/**
 * Whether `url` carries a control character, as written or behind a percent
 * escape. libSQL percent-decodes the path it opens, so `k%00.db` reaches its
 * native library as the NUL byte itself, and ends the process the same way.
 */
function carriesControlCharacter(url: string): boolean {
  return (
    CONTROL_CHARACTER.test(url) ||
    CONTROL_CHARACTER.test(url.replace(PERCENT_ESCAPE, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))))
  );
}

/**
 * Why a store whose auth token carries a control character has no database.
 * The token is the second value an operator's settings hand the libSQL client
 * (a `file:` URL passes it into the native open, a remote one into a request
 * header), and no token has a control character in it: a pasted line break is
 * the usual one. It is read as written: the client percent-decodes a URL,
 * never this option. The token is a secret, so the reason never quotes it.
 */
const AUTH_TOKEN_CONTROL_CHARACTER =
  'its auth token (the knowledge setting `turso_auth_token`, or the plugin option `authToken`) carries a NUL ' +
  'byte, a line break or another control character, which no token has. Save the token again without it.';

/** Whether `authToken` is one the libSQL client may be handed: absent, or free of control characters. */
export function acceptsAuthToken(authToken: string | undefined): boolean {
  return authToken === undefined || !CONTROL_CHARACTER.test(authToken);
}

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
  opts: Pick<KnowledgeTursoPluginOptions, 'url' | 'projectRoot' | 'stateDir' | 'env'>,
): { url: string; from: string } | { url?: undefined; reason: string } {
  const given = opts.url?.trim();
  const url = given === undefined || given === '' ? defaultStoreUrl(opts.projectRoot, opts.stateDir) : given;
  const from = given === undefined || given === '' ? 'the default location' : 'the plugin option `url`';
  if (carriesControlCharacter(url)) {
    return {
      reason:
        'its `url` option carries a NUL byte or another control character, written out or percent-encoded, ' +
        'which names no file or database.',
    };
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
 * - a control character (a NUL byte above all), written out or
 *   percent-encoded, is refused before anything else, so it never reaches the
 *   native client;
 * - a `file:` URL must name a file inside the data directory
 *   (`.objectstack/data/` of the project, or `data/` of the state directory:
 *   {@link dataDirectoryOf}), compared as the file it
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
  opts: Pick<KnowledgeTursoPluginOptions, 'projectRoot' | 'stateDir' | 'env'> = {},
): { url: string; from: string } | { url?: undefined; reason: string } {
  const from = 'the knowledge setting `turso_url`';
  if (carriesControlCharacter(url)) {
    return {
      reason:
        `${from} carries a NUL byte or another control character, written out or percent-encoded, which names ` +
        'no file or database. Save the URL again without it.',
    };
  }
  const trimmed = url.trim();
  if (/^file:/i.test(trimmed)) {
    const file = fileOf(trimmed);
    if (file === undefined) {
      return { reason: `${from} is not a valid file: URL.` };
    }
    const dataDir = realPathAllowingMissing(dataDirectoryOf(opts.projectRoot, opts.stateDir));
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
  const target = resolveStoreUrl({ url: trimmed, projectRoot: opts.projectRoot, stateDir: opts.stateDir, env: opts.env });
  return target.url === undefined ? { reason: target.reason.replace('its `url` option', from) } : { url: target.url, from };
}

/**
 * What a store whose URL is the operator's setting says between its start()
 * and `kernel:bootstrapped`, when it opens: every call answers
 * `SERVICE_UNAVAILABLE` with this.
 */
const SETTINGS_NOT_READ_YET =
  'Its URL is read from the knowledge settings (`turso_url`) once the boot has completed; until then it opens no database.';

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
 * Under `urlFromSettings` the adapter registered in `start()` has no database
 * yet: the saved `knowledge.turso_url` is read, and the database opened, at
 * `kernel:bootstrapped`, the first moment the settings service answers a
 * saved value. Until then its calls answer `SERVICE_UNAVAILABLE`.
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
   * Order-if-present (ADR-0116): start() registers with the knowledge service.
   * No edge to the settings service: under `urlFromSettings` the settings are
   * read at `kernel:bootstrapped`, and no ordering moves a read in start()
   * past the settings service's bind (see init()). A literal id: the
   * boot-order gates read this array statically.
   */
  optionalDependencies = ['com.objectstack.service.knowledge'];

  private readonly opts: KnowledgeTursoPluginOptions;
  private owned?: Client;

  constructor(opts: KnowledgeTursoPluginOptions = {}) {
    this.opts = opts;
  }

  async init(ctx: PluginContext): Promise<void> {
    // The adapter registers in start(), once IKnowledgeService is up. A store
    // whose URL is the operator's setting opens later still: the settings
    // service answers a saved value only once its data engine is bound, in its
    // own `kernel:ready` hook, so a read in init() or start() sees the default
    // while a saved row sits unread (`pnpm check:settings-bind-window`). The
    // hook is registered here, in init(), so it runs ahead of every
    // `kernel:bootstrapped` handler a plugin registers in its start(): the
    // knowledge service's own (its embedder, its reading of unmounted
    // adapters, a first build) then find the store open.
    if (!this.opensFromSettings()) return;
    ctx.hook('kernel:bootstrapped', async () => {
      await this.openFromSettings(ctx);
    });
  }

  async start(ctx: PluginContext): Promise<void> {
    const svc = this.knowledgeService(ctx);
    if (!svc) {
      ctx.logger.warn?.('KnowledgeTursoPlugin: IKnowledgeService not registered — install KnowledgeServicePlugin first.');
      return;
    }
    if (this.opts.client) {
      await this.register(ctx, svc, { client: this.opts.client, requestTimeoutMs: this.opts.requestTimeoutMs });
      return;
    }
    if (this.opensFromSettings()) {
      // Mounted from here on, so a source naming it is never read as naming an
      // unmounted adapter; it has no database until the boot completes.
      svc.registerAdapter(this.opts.id ?? 'turso', this.adapterOver(ctx, { unavailable: SETTINGS_NOT_READ_YET }));
      return;
    }
    await this.open(ctx, svc, resolveStoreUrl(this.opts), this.opts.authToken);
  }

  /** The store's URL is the operator's setting: `urlFromSettings`, and neither `client` nor `url` given. */
  private opensFromSettings(): boolean {
    const given = this.opts.url?.trim();
    return this.opts.urlFromSettings === true && !this.opts.client && (given === undefined || given === '');
  }

  private knowledgeService(ctx: PluginContext): IKnowledgeService | undefined {
    try {
      return ctx.getService<IKnowledgeService>(KNOWLEDGE_SERVICE) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * At `kernel:bootstrapped`: read the saved `knowledge.turso_url` and
   * `turso_auth_token`, open that database (or the default file when nothing
   * is saved) and register the adapter over the one start() registered.
   */
  private async openFromSettings(ctx: PluginContext): Promise<void> {
    const svc = this.knowledgeService(ctx);
    if (!svc) return; // start() said so
    const saved = await readStoreSettings(ctx);
    if ('reason' in saved) {
      await this.open(ctx, svc, { reason: saved.reason }, undefined);
    } else if (saved.url !== undefined) {
      await this.open(ctx, svc, resolveSettingsStoreUrl(saved.url, this.opts), saved.authToken);
    } else {
      await this.open(ctx, svc, resolveStoreUrl(this.opts), this.opts.authToken);
    }
  }

  /** Open the database `target` names and register the adapter on it, or one that says why there is none. */
  private async open(
    ctx: PluginContext,
    svc: IKnowledgeService,
    target: ReturnType<typeof resolveStoreUrl>,
    authToken: string | undefined,
  ): Promise<void> {
    if (target.url === undefined) {
      await this.register(ctx, svc, { unavailable: target.reason });
      return;
    }
    if (!acceptsAuthToken(authToken)) {
      await this.register(ctx, svc, { unavailable: AUTH_TOKEN_CONTROL_CHARACTER });
      return;
    }
    const opened = await openClient(target.url, { ...this.opts, authToken });
    if ('client' in opened) {
      this.owned = opened.client;
      await this.register(ctx, svc, {
        client: opened.client,
        requestTimeoutMs: requestBoundFor(target.url, this.opts.requestTimeoutMs),
      });
    } else {
      await this.register(ctx, svc, { unavailable: opened.reason });
    }
  }

  private adapterOver(
    ctx: PluginContext,
    store: { client?: Client; unavailable?: string; requestTimeoutMs?: number },
  ): TursoKnowledgeAdapter {
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
    return new TursoKnowledgeAdapter({
      id: this.opts.id,
      ...(store.client ? { client: store.client } : { unavailable: store.unavailable }),
      embedder,
      queryPrefix: this.opts.queryPrefix,
      ...(store.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: store.requestTimeoutMs }),
    });
  }

  /** Register the adapter over `store` and say whether it is ready. */
  private async register(
    ctx: PluginContext,
    svc: IKnowledgeService,
    store: { client?: Client; unavailable?: string; requestTimeoutMs?: number },
  ): Promise<void> {
    const adapter = this.adapterOver(ctx, store);
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
