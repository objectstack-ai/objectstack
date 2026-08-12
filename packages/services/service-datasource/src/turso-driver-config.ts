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
  /** Operation timeout in ms for remote operations. */
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
  /** The whole spec — `schemaMode` is resolved from three places, not just `config`. */
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
 * The type-tests are the open-core arm's, unchanged — including the truthiness
 * check on the string keys (an empty `authToken` / `syncUrl` / `encryptionKey` is
 * an unset one, never a credential of length zero) and its absence on the number
 * keys (`concurrency: 0` and `timeout: 0` are meaningful values the driver reads).
 */
const TURSO_CONFIG_READERS: {
  readonly [K in keyof Required<TursoDriverConfigInput>]: (
    src: TursoConfigSource,
  ) => TursoDriverConfigInput[K] | undefined;
} = {
  url: ({ url }) => url,
  authToken: ({ config }) =>
    typeof config.authToken === 'string' && config.authToken ? config.authToken : undefined,
  encryptionKey: ({ config }) =>
    typeof config.encryptionKey === 'string' && config.encryptionKey ? config.encryptionKey : undefined,
  concurrency: ({ config }) => (typeof config.concurrency === 'number' ? config.concurrency : undefined),
  syncUrl: ({ config }) =>
    typeof config.syncUrl === 'string' && config.syncUrl ? config.syncUrl : undefined,
  sync: ({ config }) =>
    config.sync && typeof config.sync === 'object'
      ? (config.sync as TursoDriverConfigInput['sync'])
      : undefined,
  timeout: ({ config }) => (typeof config.timeout === 'number' ? config.timeout : undefined),
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
