// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DriverDefinitionSchema } from '@objectstack/spec/data';

/**
 * Turso / libSQL Driver Configuration Schema
 *
 * Defines the connection settings specific to Turso (libSQL) — a SQLite-compatible
 * edge database supporting embedded replicas, global distribution, and offline-first
 * architectures.
 *
 * Turso supports three connection modes:
 * 1. **Remote** — Connect to a Turso cloud or self-hosted libSQL server via HTTPS/WSS
 * 2. **Local** — Use a local SQLite/libSQL file for embedded or serverless workloads
 * 3. **Embedded Replica** — Local SQLite file that syncs with a remote Turso primary
 *
 * @see https://docs.turso.tech/sdk/ts/reference
 */

// ==========================================================================
// 1. Sync Configuration (Embedded Replicas)
// ==========================================================================

/**
 * Embedded Replica Sync Configuration.
 * Controls how the local embedded replica synchronizes with the remote primary.
 */
import { lazySchema } from '@objectstack/spec/shared';
export const TursoSyncConfigSchema = lazySchema(() => z.object({
  /**
   * Sync interval in seconds.
   * The local replica will periodically pull changes from the remote primary.
   * Set to 0 to disable periodic sync (manual sync only).
   */
  intervalSeconds: z.number().min(0).default(60).describe('Periodic sync interval in seconds (0 = manual only)'),

  /**
   * Sync on connect.
   * When true, the driver performs a sync immediately upon connection.
   */
  onConnect: z.boolean().default(true).describe('Sync immediately on connect'),
}).describe('Embedded replica sync configuration'));

// ==========================================================================
// 2. Connection Configuration
// ==========================================================================

/**
 * The prescription the retired `timeout` key raises, and the text `tsc` and the
 * parse both carry. Standardized closing sentence — the `os migrate meta`
 * wording states a property of the TOOL and is not a choice (see
 * `retired-key.ts` in `@objectstack/spec`, whose header owns that ruling).
 *
 * ⛔ No internal issue id in this string: it is customer-facing text and
 * `check:doc-authoring` refuses one. The ids live in the comments beside the
 * keys below.
 */
const TIMEOUT_RETIRED =
  '`turso config.timeout` was renamed to `timeoutMs` in @objectstack/driver-turso 17 — the unit of a '
  + 'duration-shaped number lives in the key name, not only in the describe prose. Rename the key to '
  + '`timeoutMs`; the value (milliseconds) is unchanged. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/**
 * The prescriptions the two REMOVED keys raise (ADR-0049 enforce-or-remove).
 * Same channels and closing sentence as the rename above; the middle clause
 * says what actually names the thing each key pretended to name.
 */
const LOCAL_PATH_RETIRED =
  '`turso config.localPath` was removed in @objectstack/driver-turso 17 (ADR-0049) — it never had an '
  + 'effect: no code read it, and the embedded replica\'s local file has always been named by `url` '
  + '(`file:./replica.db`, with `syncUrl` pointing at the remote primary). Delete the key; a path it '
  + 'named that differs from `url` belongs in `url`. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

const WASM_RETIRED =
  '`turso config.wasm` was removed in @objectstack/driver-turso 17 (ADR-0049) — it never had an '
  + 'effect: nothing selects a WASM build of libSQL, and the driver loads whatever `@libsql/client` '
  + 'resolves to on the host runtime. Delete the key; a runtime that cannot load native bindings uses '
  + 'the remote arm (`libsql://` / `https://`), which needs none. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

// ==========================================================================
// 2a. Transport coherence — what `new TursoDriver` refuses
// ==========================================================================
//
// #19977. Each key below parsed on its own, so this mirror accepted
// combinations the driver in this very package refuses at construction
// (`VALIDATION_ERROR` / 400), or, until #20200, constructed and ignored. It
// now refuses them, with the supported spelling in the message. The
// predicates and the messages
// are the ones `@objectstack/spec`'s own turso contract
// (`packages/spec/src/data/driver/turso.zod.ts`, `tursoTransportIssues`)
// carries, byte for byte: the helper is internal to that package and not on
// a published entry point, and publishing it only to share it here would grow
// the spec's public surface for one consumer. `turso-config-constructor-parity.test.ts`
// holds both copies and the constructor to one case table instead, messages
// included, so the copy cannot drift silently.
//
// The predicates mirror the constructor's (`localEngineDefect`,
// `refuseWebSocketTimeout` and `detectMode` in `../turso-driver.ts`): a scheme
// matches in any letter case, `:memory:` is matched exactly, and a `file:` url
// whose path is `:memory:` (or starts `:memory:?`) is in-memory. The url is
// classified TRIMMED, as both datasource loaders hand it to the constructor.
//
// ⚠️ This mirror declares no `mode` (the spec contract does), so zod strips an
// authored `mode` before this refinement sees it: every config here is judged
// in the mode its url and `syncUrl` select. The forced-mode branches of the
// message builder are therefore unreachable from this schema, and are kept so
// the two copies stay byte-identical.
//
// ⛔ No url is echoed, only a remote url's scheme: a url may carry a token.
// ⛔ No internal issue id in any message: they are customer-facing text.

type TursoTransportModeName = 'local' | 'replica' | 'remote';

/** The url prefixes the driver classifies as remote, matched in any letter case. */
const TURSO_REMOTE_URL_PREFIXES = ['libsql://', 'https://', 'http://', 'wss://', 'ws://'] as const;

function startsWithScheme(url: string, prefix: string): boolean {
  return url.slice(0, prefix.length).toLowerCase() === prefix;
}

function isRemoteTursoUrl(url: string): boolean {
  return TURSO_REMOTE_URL_PREFIXES.some((prefix) => startsWithScheme(url, prefix));
}

function isFileTursoUrl(url: string): boolean {
  return startsWithScheme(url, 'file:');
}

/** `@libsql/client`'s own in-memory reading: `:memory:`, or a `file:` url whose path is `:memory:`. */
function namesInMemoryTursoDatabase(url: string): boolean {
  if (url === ':memory:') return true;
  if (!isFileTursoUrl(url)) return false;
  const path = url.slice('file:'.length);
  return path === ':memory:' || path.startsWith(':memory:?');
}

/** The mode the driver runs a config in: the forced one, else what the url and `syncUrl` select. */
function tursoTransportModeOf(url: string, hasSyncUrl: boolean, mode: TursoTransportModeName | undefined): TursoTransportModeName {
  if (mode) return mode;
  if (isRemoteTursoUrl(url)) return hasSyncUrl ? 'replica' : 'remote';
  return hasSyncUrl ? 'replica' : 'local';
}

/** The keys the transport refusals read, as they arrive in the refinement. */
interface TursoTransportKeys {
  url?: unknown;
  syncUrl?: unknown;
  mode?: TursoTransportModeName;
  timeoutMs?: unknown;
}

/** One refusal: the key it sits on and its message. */
interface TursoTransportIssue {
  path: 'url' | 'syncUrl' | 'timeoutMs' | 'mode';
  message: string;
}

/**
 * Every transport refusal a turso config earns — empty for a coherent one.
 * Checked in the constructor's order, so each config meets the refusal that
 * names its way out.
 */
function tursoTransportIssues(cfg: TursoTransportKeys): TursoTransportIssue[] {
  if (typeof cfg.url !== 'string') return [];
  const url = cfg.url.trim();
  const hasSyncUrl = typeof cfg.syncUrl === 'string' && cfg.syncUrl.length > 0;
  const mode = tursoTransportModeOf(url, hasSyncUrl, cfg.mode);
  const cause = cfg.mode ? `\`mode: '${cfg.mode}'\`` : '`syncUrl`';
  const syncUrlKeys = '`syncUrl` (and `sync`)';

  if (mode !== 'remote') {
    const arm = mode === 'replica' ? 'an embedded replica' : 'a local database';
    if (isRemoteTursoUrl(url)) {
      const scheme = url.slice(0, url.indexOf('://') + '://'.length);
      const toRemote = cfg.mode
        ? `drop \`mode\` (a \`${scheme}\` url is detected as remote) or set \`mode: 'remote'\``
          + (hasSyncUrl ? `, and drop ${syncUrlKeys}` : '')
        : `drop ${syncUrlKeys} and keep the remote url alone`;
      const toLocal = mode === 'replica'
        ? `For an embedded replica, point \`url\` at a local file and ${hasSyncUrl ? 'keep' : 'name'} the `
          + "remote in `syncUrl`: `url: 'file:./data/replica.db'`."
        : "For a local database, point `url` at a file: `url: 'file:./data/app.db'`.";
      return [{
        path: 'url',
        message:
          `\`url\` is a remote \`${scheme}\` url, but ${cause} makes this datasource ${arm}, which runs `
          + 'every read and write through a local SQLite engine that cannot open a remote url — the '
          + 'turso driver refuses this configuration when it starts. '
          + (mode === 'replica'
            ? '(An embedded replica is a local file kept in sync with the remote: @libsql/client builds '
              + 'no replica for a remote url and ignores `syncUrl` beside one.) '
            : '')
          + `For a remote database, ${toRemote}. ${toLocal}`,
      }];
    }
    if (url !== ':memory:' && !isFileTursoUrl(url)) {
      const asks = cfg.mode
        ? `${cause} makes this datasource ${arm}`
        : hasSyncUrl
          ? `\`syncUrl\` makes this datasource ${arm}`
          : `With no \`mode\` and no remote scheme, this datasource is ${arm}`;
      const keepsItLocal = [
        ...(cfg.mode ? [`\`mode: '${cfg.mode}'\``] : []),
        ...(hasSyncUrl ? [syncUrlKeys] : []),
      ];
      const toFile = mode === 'replica'
        ? 'For an embedded replica, spell the local path as a `file:` url and '
          + `${hasSyncUrl ? 'keep' : 'name'} the remote in \`syncUrl\`: \`url: 'file:./data/replica.db'\`.`
        : "For a local database file, spell the path as a `file:` url: `url: 'file:./data/app.db'`. "
          + "For a throwaway in-memory database, `url: ':memory:'`.";
      const toRemote = 'For a remote database, '
        + (keepsItLocal.length > 0 ? `drop ${keepsItLocal.join(' and ')} and ` : '')
        + 'use one of the remote schemes above.';
      return [{
        path: 'url',
        message:
          '`url` is not a url the turso driver can open: it is not `:memory:`, not a `file:` url, and '
          + 'not a remote `libsql://`, `https://`, `http://`, `wss://` or `ws://` url (a scheme matches '
          + `in any letter case). ${asks}, which runs every read and write through a local SQLite `
          + 'engine that opens only a `file:` url or `:memory:` — the turso driver refuses this '
          + `configuration when it starts. ${toFile} ${toRemote}`,
      }];
    }
    if (mode === 'replica' && namesInMemoryTursoDatabase(url)) {
      const drop = cfg.mode
        ? "`mode: 'replica'`" + (hasSyncUrl ? ` and ${syncUrlKeys}` : '')
        : syncUrlKeys;
      return [{
        path: 'url',
        message:
          `\`url\` names an in-memory database, so it cannot hold the embedded replica ${cause} asks `
          + 'for: a replica is a local file kept in sync with the remote named in `syncUrl` — the '
          + "turso driver refuses this configuration when it starts. Point `url` at a local file "
          + "(`url: 'file:./data/replica.db'` beside `syncUrl`), or drop "
          + `${drop} for a plain in-memory local database.`,
      }];
    }
    if (mode === 'replica' && !hasSyncUrl) {
      // #20437. Only a FORCED replica reaches here: with no `mode`, a replica is
      // selected by `syncUrl` alone. The url is a `file:` url (every other one
      // met a refusal above), so the url is fine and the MODE is what cannot be
      // honoured — the issue sits on `mode`, as the `sync` refusal sits on `sync`.
      // Unreachable through this mirror, which strips `mode` (see above); kept
      // byte-identical to the spec contract's arm.
      return [{
        path: 'mode',
        message:
          "`mode: 'replica'` makes this datasource an embedded replica, a local file kept in sync with "
          + 'the remote named in `syncUrl`, but no `syncUrl` is set: nothing would ever sync, so it would '
          + 'run as a plain local database that never replicates — the turso driver refuses this '
          + 'configuration when it starts. For an embedded replica, name the remote in `syncUrl` beside '
          + "the local file: `url: 'file:./data/replica.db'` with `syncUrl` set to the `libsql://` or "
          + "`https://` Turso endpoint. For a plain local database, drop `mode: 'replica'`.",
      }];
    }
    if (mode === 'local' && hasSyncUrl) {
      // #20586. Only a FORCED local mode reaches here: with no `mode`, a
      // `syncUrl` selects a replica. The url is a `file:` url or `:memory:`
      // (every other one met a refusal above), so the url is fine; what the
      // runtime would ignore is the MODE, because the driver syncs whenever
      // `syncUrl` is set — so the issue sits on `mode`, as #20437's does.
      // Unreachable through this mirror, which strips `mode` (see above); kept
      // byte-identical to the spec contract's arm.
      return [{
        path: 'mode',
        message:
          "`mode: 'local'` makes this datasource a plain local database, but `syncUrl` names a remote to "
          + 'replicate from: the database would still be synced with that remote as an embedded replica, '
          + 'so the declared local mode would be ignored — the turso driver refuses this configuration '
          + 'when it starts. For an embedded replica, drop `mode` and keep `syncUrl` beside the local file: '
          + "`url: 'file:./data/replica.db'`. For a plain local database, drop `syncUrl` (and `sync`).",
      }];
    }
    return [];
  }

  const issues: TursoTransportIssue[] = [];
  const ridesWebSocket = startsWithScheme(url, 'wss://') || startsWithScheme(url, 'ws://');
  if (ridesWebSocket && typeof cfg.timeoutMs === 'number' && cfg.timeoutMs > 0) {
    const scheme = url.slice(0, url.indexOf('://') + '://'.length);
    issues.push({
      path: 'timeoutMs',
      message:
        `\`timeoutMs\` is set beside a \`${scheme}\` url, which rides @libsql/client's WebSocket `
        + 'transport, and that transport takes no timeout: the window would bound nothing, so the '
        + 'turso driver refuses this configuration when it starts. Either drop `timeoutMs` and run '
        + 'this remote database unbounded, or keep it and spell the url `libsql://` or `https://`, '
        + 'where every request is bounded.',
    });
  }
  if (hasSyncUrl) {
    issues.push({
      path: 'syncUrl',
      message:
        "`syncUrl` configures an embedded replica, but `mode: 'remote'` sends every read and write "
        + 'straight to `url` and builds no replica: the turso driver refuses this configuration when '
        + 'it starts. For a remote database, '
        + `drop ${syncUrlKeys}. For an embedded replica, drop \`mode\` and point \`url\` at a local `
        + "file beside `syncUrl`: `url: 'file:./data/replica.db'`.",
    });
  }
  return issues;
}

export const TursoConfigSchema = lazySchema(() => z.object({
  /**
   * Database URL.
   * Supports multiple protocols:
   * - `libsql://` or `https://` for remote Turso cloud databases
   * - `ws://` or `wss://` for WebSocket connections
   * - `file:` for local SQLite/libSQL files
   * - `:memory:` for in-memory database
   */
  url: z.string().describe('Database URL (libsql://, https://, file:, or :memory:)'),

  /**
   * Authentication Token.
   * Required for remote Turso databases; optional for local files.
   * Typically a JWT issued by Turso platform or self-hosted libSQL server.
   */
  authToken: z.string().optional().describe('Authentication token for remote database'),

  /**
   * Encryption Key.
   * When provided, encrypts the local database file at rest using AES-256.
   * Applies to both local-only and embedded replica modes.
   */
  encryptionKey: z.string().optional().describe('Encryption key for local database file (AES-256)'),

  /**
   * Concurrency Limit.
   * Maximum number of concurrent requests to the database.
   * Defaults to 20 for remote connections.
   */
  concurrency: z.number().int().min(1).default(20).describe('Maximum concurrent requests'),

  /**
   * Embedded Replica Configuration.
   * When provided, enables embedded replica mode: a local SQLite file that
   * syncs with the remote primary specified in `url`.
   */
  syncUrl: z.string().optional().describe('Remote sync URL for embedded replica mode'),

  /**
   * Tombstone for the REMOVED `localPath` (#16024, ADR-0049 enforce-or-remove).
   *
   * It promised "Local file path for embedded replica" and was read by no
   * code: the replica arm names its local file via `url`, which is what the
   * driver's own docs and `@objectstack/spec`'s turso contract both say —
   * forwarding it would have created a second way to say the same thing.
   * `z.never()` rather than a bare deletion for the reason `timeout` below
   * spells out: this shape is a plain `z.object`, and a deletion would strip
   * the key in silence.
   */
  localPath: z.never({ error: () => LOCAL_PATH_RETIRED }).optional().describe(`[REMOVED] ${LOCAL_PATH_RETIRED}`),

  /**
   * Sync configuration for embedded replicas.
   */
  sync: TursoSyncConfigSchema.optional().describe('Sync settings for embedded replica mode'),

  /**
   * Operation timeout in milliseconds for remote operations; `0` = no bound.
   *
   * Renamed from `timeout` (#15682, ruling B on #14478): the unit lived only in
   * the describe prose, while `sync.intervalSeconds` — the same shape, three
   * keys above — already spelled ITS unit. One published connection config
   * carrying both conventions is what made the bare name dangerous rather than
   * untidy. `@objectstack/spec`'s own turso contract renamed the same authored
   * key in #15680; this mirror now agrees with it, and with the ADR-0087
   * conversion (`turso-config-timeout-to-timeout-ms`) that rewrites the stored
   * spelling on load.
   *
   * It reaches the driver as `TursoDriverConfig.timeout` (the datasource seam
   * in `@objectstack/service-datasource` maps the authored `timeoutMs` onto the
   * driver's bare spelling), and since #16024 that key does what the describe
   * promises: remote mode over HTTP aborts every request once the window
   * elapses, replica mode bounds `sync()`. `TursoDriverConfig.timeout`'s own
   * docblock carries the per-arm detail.
   */
  timeoutMs: z.number().int().min(0).optional().describe('Operation timeout in milliseconds for remote operations (0 = no bound)'),

  /**
   * Tombstone for the rename above (#15682, ruling B on #14478).
   *
   * This is a plain `z.object`, so zod's default STRIP posture would make a
   * bare deletion SILENT: an author's `timeout: 30000` would vanish and the
   * parse would still succeed. `z.never()` keeps the key DECLARED and
   * unwritable, so the old spelling raises the prescription instead of
   * disappearing — the two channels an upgrading author actually meets (`tsc`
   * sees `never` at the authoring site; the parse raises the text itself).
   *
   * Spelled inline rather than through `@objectstack/spec`'s `retiredKey()`:
   * that helper is internal to the spec package and is not on its published
   * `./shared` entry point, so this package cannot import it. The shape is the
   * same one-liner.
   */
  timeout: z.never({ error: () => TIMEOUT_RETIRED }).optional().describe(`[REMOVED] ${TIMEOUT_RETIRED}`),

  /**
   * Tombstone for the REMOVED `wasm` (#16024, ADR-0049 enforce-or-remove).
   *
   * It promised "Use WASM build for edge/browser environments" and nothing
   * selected one: a browser or edge deployment got whatever
   * `import('@libsql/client')` resolved to, with or without the flag.
   * Forwarding would have meant building a WASM selection that does not
   * exist, so the key goes — as a tombstone, for the same silent-strip reason
   * as `localPath` above.
   */
  wasm: z.never({ error: () => WASM_RETIRED }).optional().describe(`[REMOVED] ${WASM_RETIRED}`),
}).superRefine((cfg, ctx) => {
  // `sync` configures a replica, and the driver reads it only beside
  // `syncUrl` (its connect arm starts no sync and no interval without one).
  // The spec contract has refused `sync` alone since it was written; #19977
  // brings the same refusal, in the same words, to this mirror.
  if (cfg.sync && !cfg.syncUrl) {
    ctx.addIssue({
      code: 'custom',
      path: ['sync'],
      message:
        '`sync` configures embedded-replica syncing, which only runs when `syncUrl` names the '
        + 'remote to replicate from. Set `syncUrl`, or remove `sync` — on its own it configures '
        + 'nothing.',
    });
  }
  // What the driver refuses at construction — see `tursoTransportIssues`
  // above.
  for (const issue of tursoTransportIssues(cfg)) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
}).describe('Turso/libSQL Connection Configuration'));

// ==========================================================================
// 3. Driver Definition (Metadata)
// ==========================================================================

/**
 * The static definition of the Turso driver's identity and default metadata.
 * Implements the `DriverDefinitionSchema` contract.
 *
 * Turso/libSQL is a SQLite-compatible database with:
 * - Full ACID transactions (interactive + batch)
 * - Standard SQL query support (WHERE, ORDER BY, LIMIT/OFFSET, aggregations)
 * - JSON field support via SQLite JSON1 extension
 * - Full-text search via FTS5
 * - No native JOIN push-down limitations (full SQL joins supported)
 * - No window functions, subqueries, CTEs limitations (full SQLite SQL support)
 * - Embedded replica sync for edge deployments
 *
 * No `capabilities` block: `datasource.capabilities` was removed in
 * @objectstack/spec 17.0.0 (#4583, ADR-0049). The eleven flags were declared
 * and read by nobody — pushdown is decided by the runtime driver's own
 * `supports.*`, not by this metadata, so the block never changed which engine
 * path ran. The list above is the honest, non-executable statement of what
 * this driver can do.
 */
export const TursoDriverSpec = DriverDefinitionSchema.parse({
  id: 'turso',
  label: 'Turso (libSQL)',
  description: 'SQLite-compatible edge database with embedded replicas, global distribution, and offline-first support. Built on libSQL, a fork of SQLite.',
  icon: 'database',
  configSchema: {},
});

// ==========================================================================
// 4. Derived Types
// ==========================================================================

export type TursoConfig = z.infer<typeof TursoConfigSchema>;
export type TursoSyncConfig = z.infer<typeof TursoSyncConfigSchema>;
