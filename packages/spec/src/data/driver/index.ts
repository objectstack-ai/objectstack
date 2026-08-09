// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-driver `datasource.config` contracts (#4410).
 *
 * These shapes existed since the protocol's early days and were reachable from
 * nothing — no barrel exported `data/driver/`, so the schemas `datasource.zod.ts`
 * told authors to write against could not even be imported. They are exported
 * here because they are now load-bearing: `DatasourceSchema` parses `config`
 * against them, `DriverDefinitionSchema.configSchema` publishes their JSON-Schema
 * projection, and the Studio connection form renders from that same projection.
 */

export * from './common.zod';
export * from './config-registry.zod';
export * from './memory.zod';
export * from './mongo.zod';
export * from './mysql.zod';
export * from './postgres.zod';
export * from './sqlite.zod';
export * from './turso.zod';
