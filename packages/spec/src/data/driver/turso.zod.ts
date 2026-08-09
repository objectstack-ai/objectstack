// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { lazySchema } from '../../shared/lazy-schema';
import { strictObject } from '../../shared/strict-object';
import type { DriverDefinition } from '../datasource.zod';
import {
  driverConfigJsonSchema,
  READ_ONLY_BELONGS_ON_DATASOURCE,
  SCHEMA_MODE_BELONGS_ON_DATASOURCE,
} from './common.zod';

/**
 * Turso / libSQL Driver Protocol (#6345).
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
 * The maintainer's #6345 ruling closes it by making turso a complete builtin
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

/** Post-parse shape of {@link TursoTransportModeSchema}. */
export type TursoTransportMode = z.infer<typeof TursoTransportModeSchema>;

export const TursoConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this turso datasource's config",
    aliases: {
      uri: 'url',
      connectionstring: 'url',
      dsn: 'url',
      database: 'url',
      databaseurl: 'url',
      token: 'authToken',
      auth_token: 'authToken',
      authtoken: 'authToken',
      jwt: 'authToken',
      encryption_key: 'encryptionKey',
      sync_url: 'syncUrl',
      syncinterval: 'sync',
      sync_interval: 'sync',
    },
    guidance: {
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
      'Until #6345 a turso `config` was validated against nothing at all: the driver ships in an '
      + 'optional package, so it was not a builtin and `validateDriverConfig` answered '
      + '"{ known: false }" for it. A misspelled `token:` was therefore accepted in silence and '
      + 'the connection was attempted unauthenticated.',
  },
  {
    /**
     * The libSQL endpoint or local file. REQUIRED — there is no default: this
     * is the single fact that makes `hasLocalDefault: false` true for turso,
     * and the reason both boot hosts refuse a driver selection with no URL
     * rather than guessing one (#6345 fork 2).
     */
    url: z.string().min(1).describe('libSQL endpoint or local file (libsql://…, https://…, file:…, :memory:)')
      .meta({ title: 'Database URL' }),

    /**
     * JWT for a remote database. Prefer `external.credentialsRef` — a
     * datasource secret always wins over an inline value, exactly as on the
     * SQL drivers' `password`.
     */
    authToken: z.string().optional()
      .describe('JWT auth token for a remote libSQL database (prefer external.credentialsRef)')
      .meta({ title: 'Auth token', format: 'password' }),

    /** AES-256 key for the local database file; local/replica modes only. */
    encryptionKey: z.string().optional()
      .describe('AES-256 encryption key for the local database file (local/replica modes)')
      .meta({ title: 'Encryption key', format: 'password' }),

    /** Max concurrent requests to the remote database (replica/remote modes). */
    concurrency: z.number().int().positive().optional()
      .describe('Maximum concurrent requests to the remote database')
      .meta({ title: 'Concurrency' }),

    /** Remote sync endpoint that turns a local file into an embedded replica. */
    syncUrl: z.string().optional()
      .describe('Remote sync URL for embedded-replica mode (libsql:// or https://)')
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

    /** Operation timeout in ms for remote operations (replica/remote modes). */
    timeout: z.number().int().positive().optional()
      .describe('Operation timeout in milliseconds for remote operations')
      .meta({ title: 'Timeout (ms)' }),

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
