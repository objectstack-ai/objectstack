// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { lazySchema } from '../../shared/lazy-schema';
import { retiredKey } from '../../shared/retired-key';
import { strictObject } from '../../shared/strict-object';
import type { DriverDefinition } from '../datasource.zod';
import {
  CREDENTIAL_URL_QUERY_PARAMS,
  credentialFreeUrl,
  driverConfigJsonSchema,
  INLINE_CREDENTIAL_REFUSED,
  placeholderFree,
  READ_ONLY_BELONGS_ON_DATASOURCE,
  refusedInlineCredentialKey,
  SCHEMA_MODE_BELONGS_ON_DATASOURCE,
} from './common.zod';

/**
 * Turso / libSQL Driver Protocol.
 *
 * ## Why this arrives late, and what it closes
 *
 * `turso` was the one connection block on the platform with NO gate. #4410 gave
 * every built-in driver's `datasource.config` a contract and made
 * `DatasourceSchema` parse against it, but turso was not a builtin: its driver
 * ships in an OPTIONAL package (`@objectstack/driver-turso`, #5602), so
 * `resolveDriverId('turso')` returned `undefined` and `validateDriverConfig`
 * answered `{ known: false }` — "nothing to check against". Meanwhile both boot
 * hosts dispatched `turso` for real. So a libSQL datasource could carry
 * `{ token: … }` (the wrong key — it is `authToken`) and be accepted in silence,
 * then connect unauthenticated, which is precisely the failure #4410 exists to
 * end, surviving in the one driver #4410 could not see.
 *
 * The maintainer's ruling (commit e2798fab7) closes it by making turso a complete builtin
 * rather than a permanent exception. Optionality of the PACKAGE is orthogonal to
 * existence of the CONTRACT — `mongodb` and `sqlite-wasm` are optional installs
 * too, and both have had a contract since #4410.
 *
 * ## What is declared here, and what is deliberately not
 *
 * The keys below are exactly the `TursoDriverConfig` fields the driver reads and
 * that an author can express as data. Three are deliberately absent:
 *
 *  - `client` (a pre-constructed `@libsql/client` instance) — a live object, not
 *    authorable metadata; declaring it would promise a JSON slot that can never
 *    be filled from a `sys_metadata` row.
 *  - `pool` — connection pooling is the datasource's own block, not driver
 *    config, exactly as on postgres/mysql/mongo.
 *  - `schemaMode` / `readOnly` — datasource-level, same as every other driver.
 *
 * ADR-0049 (enforce-or-remove) is why the list is drawn from what the driver
 * READS rather than from what libSQL supports: a key declared here that no
 * driver consults would be a new inert slot, and this file exists to close one.
 */

// ==========================================================================
// 1. Connection Configuration
// ==========================================================================

/** Transport mode, when an author pins it instead of letting the URL decide. */
export const TursoTransportModeSchema = z.enum(['local', 'replica', 'remote'])
  .describe('Force a transport mode instead of inferring it from `url`');

/**
 * Author-facing shape of {@link TursoTransportModeSchema} (ADR-0122: the bare
 * name is the AUTHOR state).
 *
 * No `TursoTransportModeParsed` beside it, deliberately: this is a plain
 * `z.enum` with no `.default()`, no `.transform()` and no coercion, so
 * `z.input` and `z.infer` are the same three literals. A second alias for an
 * identical type would be a declaration that distinguishes nothing — the same
 * call as leaving `contractId` off the driver vocabulary table. The two sibling
 * enums in this directory settle it the same way: `SqliteWasmPersistMode` and
 * `DriverSslToggle` are both bare `z.input` with no parsed twin.
 */
export type TursoTransportMode = z.input<typeof TursoTransportModeSchema>;

// ==========================================================================
// 1b. Transport coherence — what `new TursoDriver` refuses
// ==========================================================================
//
// #19977. `url`, `syncUrl`, `mode` and `timeoutMs` each parsed on their own,
// so this shape accepted combinations the driver refuses at construction
// (`VALIDATION_ERROR` / 400) — or, until #20200, constructed and then ignored.
// Authoring now refuses exactly those, with the supported spelling in the
// message:
//
//  - a local or replica mode (forced by `mode`, or selected by `syncUrl`
//    beside a `file:` / `:memory:` url, or by a url that is none of those)
//    on a url its local SQLite engine cannot open: a remote url, or anything
//    that is not a `file:` url or `:memory:` (a bare path, another scheme);
//  - a replica on an in-memory url;
//  - `timeoutMs` beside a `wss://` / `ws://` url in remote mode;
//  - `syncUrl` under a forced `mode: 'remote'`, which the driver used to accept
//    and then IGNORE: the remote client was built without it, no sync ever
//    ran, and the driver's sync call failed as not supported while its
//    sync-enabled check still answered true. It was refused here first,
//    because a declared setting that changes nothing is the shape ADR-0049
//    does not ship; since #20200 the constructor refuses it too, in this
//    arm's own words;
//  - a forced `mode: 'replica'` with no `syncUrl` (#20437): a replica with no
//    remote to replicate from. The driver used to build it as a replica, never
//    synced it and ran it as a plain local database; authoring and the
//    constructor now refuse it together, in this arm's words;
//  - a forced `mode: 'local'` beside a `syncUrl` (#20586), the same defect the
//    other way round: the driver used to label it local and then run it as an
//    embedded replica, syncing with the remote on connect and on the interval
//    while its sync-enabled check answered true. Authoring and the constructor
//    now refuse it together, in this arm's words.
//
// The predicates MIRROR the constructor's on `main` (`localEngineDefect`,
// `refuseWebSocketTimeout` and `detectMode` in
// `packages/drivers/driver-turso/src/turso-driver.ts`): a scheme matches in
// any letter case, `:memory:` is matched exactly, and a `file:` url whose path
// is `:memory:` (or starts `:memory:?`) is in-memory. Nothing the constructor
// accepts is refused here: the one former exception, the
// `syncUrl`-under-`mode: 'remote'` arm, has been a constructor refusal too
// since #20200. The url is classified TRIMMED, because
// both loaders trim it before construction (`resolveTursoUrl` in
// `@objectstack/service-datasource`); `syncUrl` counts when it is a non-empty
// string, as `buildTursoDriverConfig` forwards it. The driver-local mirror
// (`packages/drivers/driver-turso/src/spec/turso.zod.ts`) carries the same
// predicates and messages, and `turso-config-constructor-parity.test.ts` there
// holds both copies and the constructor to one case table.
//
// ⛔ No url is echoed, only a remote url's scheme: a url may carry a token.
// ⛔ No internal issue id in any message: they reach Studio's datasource form.

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
function tursoTransportModeOf(url: string, hasSyncUrl: boolean, mode: TursoTransportMode | undefined): TursoTransportMode {
  if (mode) return mode;
  if (isRemoteTursoUrl(url)) return hasSyncUrl ? 'replica' : 'remote';
  return hasSyncUrl ? 'replica' : 'local';
}

/** The keys the transport refusals read, as they arrive in the refinement. */
interface TursoTransportKeys {
  url?: unknown;
  syncUrl?: unknown;
  mode?: TursoTransportMode;
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

export const TursoConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this turso datasource's config",
    // Semantic near-misses — a different WORD for a declared key. FIVE of the
    // six are the unreachable case: `connectionstring`, `dsn`, `database`,
    // `databaseurl` and `syncinterval` all score past their budget against
    // every declared key, so without the entry the author gets no suggestion
    // at all. `uri` is NOT, and the entry is worth keeping for the opposite
    // reason: the budget is `Math.max(2, Math.floor(key.length / 3))`
    // (`shared/suggestions.zod.ts`), so a 3-character key gets 2, and `uri`
    // differs from `url` by 1 — the bare fallback already answers `url`. That
    // row is a PIN on an answer the fallback happens to get right, not a
    // gap-filler, and it keeps answering `url` if this shape ever gains a key
    // within 2 of `uri`. `turso.test.ts` pins the distinction.
    // Case and underscore variants of a DECLARED key (`encryption_key`,
    // `sync_url`) are deliberately absent: the unknown-key probe already
    // normalizes those onto the declared name, so entries for them would be
    // alias rows that never fire, and two of them collided with each other on
    // one probe (`auth_token`/`authtoken`, `sync_interval`/`syncinterval`) —
    // caught by `alias-integrity.test.ts`. The `auth_token`/`authtoken`
    // variants moved to `guidance` in #7990: `authToken` is tombstoned, so it
    // left the probe's candidate list (`acceptsNothing`) and the normalization
    // that made alias rows redundant no longer reaches it.
    aliases: {
      uri: 'url',
      connectionstring: 'url',
      dsn: 'url',
      database: 'url',
      databaseurl: 'url',
      syncinterval: 'sync',
    },
    guidance: {
      // #7990 — former aliases of the now-unwritable `authToken` key (`token:`
      // was the misspelling this file's history block records). They carry the
      // refusal directly rather than renaming onto a key that would reject
      // them a second time (see postgres.zod.ts for the reasoning).
      token: INLINE_CREDENTIAL_REFUSED('token'),
      jwt: INLINE_CREDENTIAL_REFUSED('jwt'),
      auth_token: INLINE_CREDENTIAL_REFUSED('auth_token'),
      authtoken: INLINE_CREDENTIAL_REFUSED('authtoken'),
      pool:
        '`pool` is not driver config — libSQL sizes remote concurrency with `concurrency`, and '
        + "every driver's pooling block lives next to `driver` on the datasource itself.",
      schemaMode: SCHEMA_MODE_BELONGS_ON_DATASOURCE,
      readOnly: READ_ONLY_BELONGS_ON_DATASOURCE,
      filename:
        '`filename` is the sqlite spelling. A libSQL local database is still named by `url` — '
        + 'use `url: "file:./data/objectstack.db"`.',
    },
    history:
      'Until this shape was closed, a turso `config` was validated against nothing at all: the driver ships in an '
      + 'optional package, so it was not a builtin and `validateDriverConfig` answered '
      + '"{ known: false }" for it. A misspelled `token:` was therefore accepted in silence and '
      + 'the connection was attempted unauthenticated.',
  },
  {
    /**
     * The libSQL endpoint or local file. REQUIRED — there is no default: this
     * is the single fact that makes `hasLocalDefault: false` true for turso,
     * and the reason both boot hosts refuse a driver selection with no URL
     * rather than guessing one (commit e2798fab7's fork 2).
     *
     * Credential-free by contract since #8082: a `user:password@` userinfo is
     * refused at publish exactly like an inline `authToken` (#7990) — bind the
     * secret and it reaches the driver at connect time. Since #8337 the same
     * closure covers the query string: `?authToken=` is the third spelling of
     * the identical JWT — persisted cleartext into `sys_metadata`, and honoured
     * by `@libsql/core` OVER the binder-injected token (measured; see
     * `CREDENTIAL_URL_QUERY_PARAMS` in common.zod.ts). Placeholder-free since
     * #8336: a `${…}` span anywhere in the value is refused — placeholders in
     * authored metadata are resolved by nothing. Runtime-environment
     * DSNs (`OS_DATABASE_URL` + `OS_DATABASE_AUTH_TOKEN`) never pass through
     * this schema and are unaffected.
     *
     * Transport-coherent since #19977: the url must be one the transport the
     * config selects can open — see {@link tursoTransportIssues} at the foot
     * of this shape. In a local or replica mode that is a `file:` url or
     * `:memory:` (a replica: a `file:` url that is not in-memory), exactly the
     * set `new TursoDriver` accepts there.
     */
    // The description names the SHAPES in words rather than pasting URL
    // prefixes, matching how the postgres/mysql/mongo `url` keys describe
    // themselves. Not only house style: a `.describe()` is rendered verbatim
    // into `content/docs/references/`, and a scheme prefix pasted there ahead
    // of an ellipsis puts a literal U+2026 where a host belongs — which the
    // docs link checker resolves as an internationalised domain name, and
    // fails on (caught by CI on this very key). Concrete example URLs belong
    // in the TSDoc above the key, which the reference tables do not inline.
    //
    // "a file path" used to stand where "a file: URL" stands now, and it named
    // the one spelling the driver refuses: a bare path (`./data/app.db`) is not
    // a url, `@libsql/client` refuses it, and `new TursoDriver` refuses it in a
    // local or replica mode. The transport refusals at the foot of this shape
    // refuse it here too, so the describe may not invite it.
    url: placeholderFree(credentialFreeUrl(z.string().min(1), 'url', CREDENTIAL_URL_QUERY_PARAMS.turso), 'url')
      .describe('libSQL endpoint or local file: a remote libsql/https Turso URL, a local file written as a file: URL (never a bare path), or :memory:')
      .meta({ title: 'Database URL' }),

    /**
     * JWT for a remote database — REFUSED inline since #7990, exactly as the
     * SQL drivers' `password` (see postgres.zod.ts: declared-unwritable so
     * `tsc`, the parse and the connection form's secret input all stay wired
     * to the secret binder / `external.credentialsRef`). The standalone boot
     * path is unaffected: `OS_DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN` are
     * resolved by the host and handed to the driver factory directly, never
     * through this authoring schema.
     */
    authToken: refusedInlineCredentialKey('authToken', 'Auth token'),

    /**
     * AES-256 key for the local database file; local/replica modes only.
     * Placeholder-free since #8336: an unresolved `${…}` here would encrypt
     * the database with the literal placeholder string as its key — data
     * unreadable under the key the author believed they set.
     */
    encryptionKey: placeholderFree(z.string(), 'encryptionKey').optional()
      .describe('AES-256 encryption key for the local database file (local/replica modes)')
      .meta({ title: 'Encryption key', format: 'password' }),

    /** Max concurrent requests to the remote database (replica/remote modes). */
    concurrency: z.number().int().positive().optional()
      .describe('Maximum concurrent requests to the remote database')
      .meta({ title: 'Concurrency' }),

    /**
     * Remote sync endpoint that turns a local file into an embedded replica.
     * Judged by the same #8082 value-level parse as `url`: it is an authored
     * URL persisted into the identical `sys_metadata` sink, so a
     * `user:password@` userinfo is refused the same way — and by the same
     * #8336 parse too (placeholder-free), and the same #8337 query-parameter
     * closure (`?authToken=`): the at-rest half is identical whichever URL
     * key carries the token.
     */
    syncUrl: placeholderFree(
      credentialFreeUrl(z.string(), 'syncUrl', CREDENTIAL_URL_QUERY_PARAMS.turso),
      'syncUrl',
    ).optional()
      .describe('Remote sync URL for embedded-replica mode: a libsql or https Turso endpoint')
      .meta({ title: 'Sync URL' }),

    /**
     * Embedded-replica sync policy. Only meaningful beside {@link syncUrl}.
     *
     * `z.strictObject`, not a bare `z.object`: a nested block left at zod's
     * default STRIP posture would silently drop `sync: { interval: 60 }` — the
     * plausible misspelling of `intervalSeconds` — and the datasource would then
     * sync on the 60-second default while the author believed they had set it.
     * That is the exact silent acceptance this whole file exists to end, and it
     * would have been a new strip site in the #4001 ledger rather than a
     * closed one.
     */
    sync: z.strictObject({
      intervalSeconds: z.number().int().nonnegative().optional()
        .describe('Periodic sync interval in seconds (0 = manual only)'),
      onConnect: z.boolean().optional().describe('Sync immediately on connect'),
    }).optional().describe('Embedded-replica sync configuration (requires `syncUrl`)'),

    /**
     * Operation timeout in ms for remote operations (replica/remote modes).
     *
     * Renamed from `timeout` (#15680, ruling B on #14478): the unit lived only
     * in the describe prose and in a `.meta({ title })` no parse reads. It sat
     * two keys below `sync.intervalSeconds`, which already spelled ITS unit —
     * one shape carrying both conventions, and the suffixed one was the honest
     * half.
     */
    timeoutMs: z.number().int().positive().optional()
      .describe('Operation timeout in milliseconds for remote operations')
      .meta({ title: 'Timeout (ms)' }),

    /** Tombstone for the rename above (#15680, ruling B on #14478). */
    timeout: retiredKey(
      '`turso config.timeout` was renamed to `timeoutMs` in @objectstack/spec 17 — the unit of a '
      + 'duration-shaped number lives in the key name, not only in the describe prose. Rename the '
      + 'key to `timeoutMs`; the value (milliseconds) is unchanged. '
      + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.',
    ),

    /** Pin the transport instead of inferring it from `url`. */
    mode: TursoTransportModeSchema.optional().meta({ title: 'Transport mode' }),
  })
  .describe('Turso / libSQL Connection Configuration')
  .superRefine((cfg, ctx) => {
    // `sync` configures a replica that only exists when there is something to
    // replicate FROM. Accepting it alone would be a declared key that changes
    // nothing — the exact shape ADR-0049 asks us not to ship.
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
    // above the shape.
    for (const issue of tursoTransportIssues(cfg)) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
  }));

/**
 * JSON-Schema projection of {@link TursoConfigSchema}, memoized — what
 * {@link TursoDriverSpec} publishes as its `configSchema`.
 */
export const getTursoConfigJsonSchema = driverConfigJsonSchema(TursoConfigSchema);

// ==========================================================================
// 2. Driver Definition (Metadata)
// ==========================================================================

/**
 * The static definition of the Turso driver's default metadata, satisfying the
 * `DriverDefinitionSchema` contract (proved by `turso.test.ts`).
 *
 * Not in `service-datasource`'s `DRIVER_CATALOG`: that list is CURATION — which
 * drivers the Studio connection form offers — and turso stays out of it for the
 * same reason `sqlite-wasm` does. Both are constructible and both have a
 * contract; neither is something an admin picks from a dropdown, since turso
 * additionally needs an optional package installed next to the server.
 */
export const TursoDriverSpec = {
  id: 'turso',
  label: 'Turso / libSQL',
  description:
    'libSQL driver for ObjectStack — remote Turso databases, local files, and embedded replicas. '
    + 'Ships in the optional @objectstack/driver-turso package.',
  icon: 'database',
  get configSchema() {
    return getTursoConfigJsonSchema();
  },
} satisfies DriverDefinition;

/**
 * Derived Types
 */
export type TursoConfig = z.input<typeof TursoConfigSchema>;
/** Post-parse shape of {@link TursoConfig} — defaults applied, transforms run (ADR-0122). */
export type TursoConfigParsed = z.infer<typeof TursoConfigSchema>;
