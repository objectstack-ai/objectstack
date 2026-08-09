// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in datasource driver catalog.
 *
 * Each entry carries a JSON-Schema `configSchema` describing the driver's
 * connection options, so the Studio UI can render a typed connection form
 * instead of a raw-JSON editor (the `DriverDefinitionSchema.configSchema`
 * contract — "Used by the UI to generate the connection form").
 *
 * Served by `GET /api/v1/datasources/drivers`. This is the curated set of
 * connection drivers the connection form offers; a future runtime driver
 * registry can supersede this list without changing the route contract.
 *
 * ## The schemas are PROJECTED, not written here (#4410)
 *
 * They used to be JSON-Schema literals maintained in this file, in parallel
 * with `packages/spec`'s per-driver zod schemas — two descriptions of one shape,
 * neither checked against the other, and neither validating anything. #4410
 * made the zod side the gate `DatasourceSchema` parses `config` against, which
 * turns that duplication from untidy into dangerous: a form offering a field the
 * gate rejects is a Setup wizard whose Save cannot succeed, with the platform's
 * own form as the thing at fault.
 *
 * So the form renders the projection of the same schema that judges the save.
 * What stays local is CURATION — which drivers the form offers, and their
 * label/description/icon. `sqlite-wasm` is deliberately absent: it is
 * constructible and has a config contract, but it exists for CI and
 * no-native-build environments rather than as something an admin picks here.
 * `turso` is absent for the same reason since #6345 gave it a contract: it is a
 * full builtin now, but it additionally needs an optional package installed next
 * to the server, which is not a thing a dropdown can arrange.
 */

import { getDriverConfigJsonSchemaById, type BuiltinDriverId } from '@objectstack/spec/data';

export interface DriverCatalogEntry {
  /** Unique driver identifier used as `datasource.driver`. */
  id: string;
  /** Display label. */
  label: string;
  /** Optional one-line description. */
  description?: string;
  /** Optional Lucide icon name. */
  icon?: string;
  /** JSON Schema (draft-2020-12) for the driver's `config` object. */
  configSchema: Record<string, unknown>;
}

/** The curated part — everything except the shape, which comes from the spec. */
const CURATED: ReadonlyArray<{
  id: BuiltinDriverId;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'memory',
    label: 'In-Memory',
    description: 'Ephemeral in-memory driver for dev, tests, and prototyping. No connection settings.',
    icon: 'memory-stick',
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    description: 'File-backed (or in-memory) SQL database. Great for local dev and small deployments.',
    icon: 'database',
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    description: 'PostgreSQL connection. Supply host/port/database or a connection URL.',
    icon: 'database',
  },
  {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    description: 'MySQL or MariaDB connection.',
    icon: 'database',
  },
  {
    // `mongodb` since #6345 — the canonical driver id was renamed to the
    // spelling both boot hosts and `@objectstack/driver-mongodb` already used.
    // This `id` is what Studio writes into `datasource.driver`, so rows written
    // before the rename carry `mongo`; the ADR-0087 conversion
    // `datasource-driver-mongo-to-mongodb` converges them, and `mongo` remains
    // an accepted alias so a deployment that skipped it still connects.
    id: 'mongodb',
    label: 'MongoDB',
    description: 'MongoDB connection via a connection URI.',
    icon: 'database',
  },
];

export const DRIVER_CATALOG: DriverCatalogEntry[] = CURATED.map((entry) => ({
  ...entry,
  configSchema: getDriverConfigJsonSchemaById(entry.id),
}));
