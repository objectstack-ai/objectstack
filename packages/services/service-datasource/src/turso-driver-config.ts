// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE place a `DatasourceConnectionSpec` is turned into a libSQL/Turso
 * driver config (#7314).
 *
 * ## The defect this replaces
 *
 * Two loaders build the libSQL driver, and which one runs is decided by nothing
 * the author can see — whether the datasource happens to be the host's
 * `default`:
 *
 *  - `@objectstack/runtime`'s `loadTursoDriverFactory` (the HOST-injected
 *    loader, single owner for the CLI and the standalone stack since #6268)
 *    serves the `default` datasource;
 *  - the open-core `createDefaultDatasourceDriverFactory` in this package serves
 *    every other door — a datasource created in Setup, `testConnection`, a
 *    declared non-default datasource.
 *
 * Each read the spec's `config` with its own hand-written list, and the lists
 * had drifted: the open-core arm read nine keys, the host loader read `url` and
 * `authToken`. So an encrypted or embedded-replica `default` silently lost
 * `encryptionKey` / `syncUrl` / `sync` / `concurrency` / `timeout` / `mode` —
 * `TursoConfigSchema` accepts all of them, so this was declared-but-not-enforced
 * in one of the two positions, with no diagnostic anywhere. The same
 * datasource, renamed away from `default`, was honoured in full.
 *
 * Both loaders now call {@link buildTursoDriverConfig}. The fix is DERIVATION,
 * not a corrected copy: a second hand-transcribed list is exactly how the first
 * one came to disagree, and would have started drifting again at the next key.
 *
 * ## How "every key" is kept true
 *
 * {@link TURSO_CONFIG_READERS} is a mapped type over
 * `Required<TursoDriverConfigInput>`, so TypeScript REFUSES to compile a config
 * key that has no reader — the key list ({@link TURSO_DRIVER_CONFIG_KEYS}) is
 * then derived from that table at runtime rather than written a third time.
 * That closes drift between the interface and the builder. Drift between this
 * interface and the DRIVER's own `TursoDriverConfig` is pinned separately, in
 * `packages/cli/src/utils/storage-driver.test.ts`, because
 * `@objectstack/driver-turso` is deliberately not resolvable from this package
 * (that is what "optional" means here, and the missing-package arm's own pin
 * depends on it staying that way) while the CLI already carries it as a dev
 * dependency for exactly this kind of compile-time check.
 */

import type { DatasourceConnectionSpec } from './contracts/index.js';
import { resolveDatasourceSchemaMode } from './datasource-schema-mode.js';

/**
 * The libSQL driver config both loaders build.
 *
 * Structural rather than imported from `@objectstack/driver-turso`: that package
 * is an OPTIONAL install and is not a dependency of this package. Keys and value
 * types mirror `TursoDriverConfig`, minus `client` (a pre-built `@libsql/client`
 * instance — a host-composition escape hatch, never authorable config) and plus
 * `schemaMode` (ADR-0015 ownership, honoured by the `SqlDriver` base
 * `TursoDriver` extends rather than declared on `TursoDriverConfig` itself).
 * The `packages/cli` pin fails to compile if that relationship stops holding.
 */
export interface TursoDriverConfigInput {
  /** libSQL url — `libsql://`, `https://`, `file:` or `:memory:`. */
  url: string;
  /** JWT auth token for a remote Turso database. */
  authToken?: string;
  /** AES-256 key for the local database file (local/replica modes). */
  encryptionKey?: string;
  /** Max concurrent requests to the remote database (replica/remote modes). */
  concurrency?: number;
  /** Remote sync url for embedded-replica mode. */
  syncUrl?: string;
  /** Embedded-replica sync settings (requires `syncUrl`). */
  sync?: { intervalSeconds?: number; onConnect?: boolean };
  /**
   * Operation timeout in ms for remote operations.
   *
   * The DRIVER's key name. The datasource authors it as `config.timeoutMs`
   * (#15680); this one keeps the bare spelling on purpose (#16024).
   */
  timeout?: number;
  /** Force a transport mode instead of detecting it from the url. */
  mode?: 'local' | 'replica' | 'remote';
  /**
   * ADR-0015 schema ownership. Typed as the raw string on purpose — see
   * {@link resolveDatasourceSchemaMode}.
   */
  schemaMode?: string;
}

/** What every reader in {@link TURSO_CONFIG_READERS} is handed. */
interface TursoConfigSource {
  /**
   * The whole spec — two readers need more than `config`: `schemaMode` is
   * resolved from three places, and `authToken` reads the connection's bound
   * `spec.secret` ahead of `config` (#8152).
   */
  spec: DatasourceConnectionSpec;
  /** `spec.config`, narrowed to a bag so each reader can type-test its own key. */
  config: Record<string, unknown>;
  /** The already-resolved, already-refused-if-empty url (see {@link resolveTursoUrl}). */
  url: string;
}

/**
 * One reader per config key — the table that makes "read every key" a property
 * TypeScript enforces rather than a list someone remembers to extend.
 *
 * A reader returns `undefined` for "not declared", and the builder omits the key
 * entirely rather than passing `undefined` through: `@libsql/client` distinguishes
 * an absent option from an explicit `undefined` in places, and the open-core arm
 * this was lifted from had always spread-omitted.
 *
 * The type-tests are the open-core arm's — including the truthiness check on the
 * string keys (an empty `authToken` / `syncUrl` / `encryptionKey` is an unset one,
 * never a credential of length zero) and its absence on the number keys
 * (`concurrency: 0` and `timeoutMs: 0` are meaningful values the driver reads).
 *
 * A reader is not obliged to read only `config`: `schemaMode` and `authToken`
 * both consult the spec itself. `authToken`'s reason is a credential route, and
 * is worth reading before changing it (#8152).
 */
const TURSO_CONFIG_READERS: {
  readonly [K in keyof Required<TursoDriverConfigInput>]: (
    src: TursoConfigSource,
  ) => TursoDriverConfigInput[K] | undefined;
} = {
  url: ({ url }) => url,
  /**
   * The BOUND credential first, the config key second (#8152).
   *
   * This reader used to consult `config.authToken` alone, and that was a hole
   * rather than a preference: #7990/#8078 made `authToken` a refused inline key
   * (`z.never()`) at every authoring door, so the only route an author has left
   * is to bind the credential and reference it — and the resolved secret arrives
   * as `spec.secret`, which nothing on the turso path read. A turso datasource
   * created after #8078 therefore had NO working credential route: the inline
   * one is refused at the door and the bound one was dropped here. Existing
   * stored rows kept working (stored config bypasses the parse), which is what
   * kept it invisible — only new authoring was dead.
   *
   * The precedence and the shape are exact parity with the SQL arms in
   * `default-datasource-driver-factory.ts`
   * (`spec.secret ? { password: spec.secret } : cfg.password ? { password: cfg.password } : {}`):
   * a datasource's bound secret WINS over anything in `config`, and `config` is
   * the fallback. `spec` is already on {@link TursoConfigSource} for `schemaMode`,
   * so this needs no new plumbing — the credential was reaching this function
   * all along.
   *
   * `config.authToken` stays readable, and deliberately: it is not only legacy
   * stored rows. The host boot paths translate `OS_DATABASE_AUTH_TOKEN` /
   * `TURSO_AUTH_TOKEN` into `config: { url, authToken }` on a definition they
   * construct themselves (`packages/cli/src/utils/storage-driver.ts`), which
   * never meets the authoring schema. Dropping this arm would break the `default`
   * datasource's env credential — a live route, refused only for AUTHORS.
   *
   * The truthiness test carries over unchanged, now on both arms: an empty
   * `spec.secret` is an unset one, and falls through to `config` rather than
   * emitting a credential of length zero.
   */
  authToken: ({ spec, config }) =>
    spec.secret
      ? spec.secret
      : typeof config.authToken === 'string' && config.authToken
        ? config.authToken
        : undefined,
  encryptionKey: ({ config }) =>
    typeof config.encryptionKey === 'string' && config.encryptionKey ? config.encryptionKey : undefined,
  concurrency: ({ config }) => (typeof config.concurrency === 'number' ? config.concurrency : undefined),
  syncUrl: ({ config }) =>
    typeof config.syncUrl === 'string' && config.syncUrl ? config.syncUrl : undefined,
  sync: ({ config }) =>
    config.sync && typeof config.sync === 'object'
      ? (config.sync as TursoDriverConfigInput['sync'])
      : undefined,
  /**
   * The AUTHORED key is `timeoutMs`; the DRIVER key is `timeout`.
   *
   * This is the one reader whose two spellings differ, and the split is
   * deliberate on both sides. `TursoConfig.timeout` was renamed to `timeoutMs`
   * (#15680, ruling B on #14478) because the unit of a duration-shaped number
   * belongs in the key name; `TursoDriverConfig.timeout` was NOT renamed with
   * it, because renaming a published-but-inert driver key would ratify it as
   * real (#16024) — which is the outcome ADR-0049 exists to prevent.
   *
   * ⚠️ NO fallback arm for the retired `config.timeout`, and that is the
   * precedent rather than a new rule. Both sibling arms in
   * `default-datasource-driver-factory.ts` say it in the same words: sqlite's
   * "`filename` is the whole contract … so no `??` tolerance survives here",
   * mongo's "`url` is the one spelling". Each renamed key reaches a reader
   * ALREADY canonical, from two directions — authoring refuses the retired
   * spelling at the door (`retiredKey()`, tsc `never` + a parse-time
   * prescription), and a stored `sys_metadata` row replays the full ADR-0087
   * chain, retired entries included, at `loadDatasourceRows` /
   * `loadDatasourceRow` in `datasource-admin-plugin.ts` — so the D2 conversion
   * `turso-config-timeout-to-timeout-ms` has already rewritten the key before
   * this table ever sees it. A `??` arm here would be a consumer-side dialect
   * (Prime Directive #12) reintroducing the spelling both doors just closed.
   *
   * `authToken`'s legacy arm above is NOT a counter-precedent: it is kept for a
   * LIVE route (host boot translating `OS_DATABASE_AUTH_TOKEN` into a config it
   * constructs itself, which never meets the authoring schema), not for a
   * retired spelling.
   */
  timeout: ({ config }) => (typeof config.timeoutMs === 'number' ? config.timeoutMs : undefined),
  mode: ({ config }) =>
    typeof config.mode === 'string' ? (config.mode as TursoDriverConfigInput['mode']) : undefined,
  schemaMode: ({ spec }) => resolveDatasourceSchemaMode(spec),
};

/**
 * Every key {@link buildTursoDriverConfig} can put on a libSQL driver config,
 * DERIVED from the reader table rather than declared again.
 *
 * Exported so a test can assert the surface the two loaders share without
 * re-typing it — a third copy of the list would be the same defect one layer
 * up.
 */
export const TURSO_DRIVER_CONFIG_KEYS = Object.keys(TURSO_CONFIG_READERS) as ReadonlyArray<
  keyof TursoDriverConfigInput
>;

/**
 * The libSQL url a spec declares, trimmed — `''` when it declares none.
 *
 * Shared so both loaders agree on what "no url" means. They deliberately do NOT
 * share the REFUSAL: the CLI raises its own `UnsupportedDriverError` (which
 * `serve.ts` re-throws as a fatal boot error), the standalone stack a prefixed
 * `Error`, and the open-core arm a plain one naming the datasource. Only the
 * predicate is single-sourced.
 *
 * The trim came from the open-core arm; the host loader did not have it, so a
 * whitespace-only url reached `@libsql/client` there instead of being refused
 * by name.
 */
export function resolveTursoUrl(spec: DatasourceConnectionSpec): string {
  const config = (spec.config ?? {}) as Record<string, unknown>;
  return typeof config.url === 'string' ? config.url.trim() : '';
}

/**
 * Build the libSQL driver config for a connection spec — the single read of the
 * spec both the host loader and the open-core arm perform.
 *
 * `url` is passed in rather than re-read so each caller keeps its own refusal
 * for a spec that declares none (see {@link resolveTursoUrl}); by the time this
 * runs, the url has already been resolved and accepted.
 */
export function buildTursoDriverConfig(
  spec: DatasourceConnectionSpec,
  url: string,
): TursoDriverConfigInput {
  const src: TursoConfigSource = {
    spec,
    config: (spec.config ?? {}) as Record<string, unknown>,
    url,
  };
  const out: Record<string, unknown> = {};
  for (const key of TURSO_DRIVER_CONFIG_KEYS) {
    const value = TURSO_CONFIG_READERS[key](src);
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as TursoDriverConfigInput;
}
