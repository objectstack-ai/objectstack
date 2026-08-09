// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { DatasourceSchema } from '../datasource.zod';
import {
  BUILTIN_DRIVER_IDS,
  DRIVER_CONFIG_SCHEMAS,
  DRIVER_ID_ALIASES,
  getDriverConfigJsonSchemaById,
  getDriverConfigSchema,
  resolveDriverId,
  validateDriverConfig,
} from './config-registry.zod';

describe('driver config registry', () => {
  it('ships a schema and a JSON-Schema projection for every canonical id', () => {
    for (const id of BUILTIN_DRIVER_IDS) {
      expect(DRIVER_CONFIG_SCHEMAS[id], id).toBeTruthy();
      const json = getDriverConfigJsonSchemaById(id) as { type?: string; properties?: object };
      expect(json.type, id).toBe('object');
      expect(json.properties, id).toBeTruthy();
    }
  });

  it('memoizes each projection so the form and the gate share one object', () => {
    expect(getDriverConfigJsonSchemaById('postgres')).toBe(getDriverConfigJsonSchemaById('postgres'));
  });

  it('resolves every alias onto a canonical id that has a contract', () => {
    for (const [alias, canonical] of Object.entries(DRIVER_ID_ALIASES)) {
      expect(resolveDriverId(alias), alias).toBe(canonical);
      expect(BUILTIN_DRIVER_IDS).toContain(canonical);
    }
  });

  it('resolves case- and whitespace-insensitively', () => {
    expect(resolveDriverId('  PostgreSQL ')).toBe('postgres');
    // `mongodb`, not `mongo`, since #6345 renamed the canonical id.
    expect(resolveDriverId('MongoDB')).toBe('mongodb');
    expect(resolveDriverId(' Mongo ')).toBe('mongodb');
  });

  /**
   * The distinction the whole gate rests on: "nothing to check against" is not
   * the same answer as "checked and clean", and a caller that conflates them
   * reintroduces the silence #4410 removed.
   */
  it('reports an unknown driver as unknown rather than as valid', () => {
    expect(resolveDriverId('com.vendor.snowflake')).toBeUndefined();
    expect(getDriverConfigSchema('com.vendor.snowflake')).toBeUndefined();
    expect(validateDriverConfig('com.vendor.snowflake', { whatever: 1 })).toEqual({ known: false });
  });

  it('validates a known driver and returns path-relative issues', () => {
    const result = validateDriverConfig('pg', { database: 'app', hostname: 'db.internal' });

    expect(result.known).toBe(true);
    expect(result).toHaveProperty('issues');
    const issues = (result as { issues: Array<{ path: unknown[]; message: string }> }).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('`hostname` → `host`');
  });
});

describe('DatasourceSchema × driver config (#4410)', () => {
  const base = { name: 'warehouse', driver: 'postgres' };

  /**
   * The reported bug, verbatim: the correct key is `host`, `hostname` was
   * accepted in silence, and the datasource then connected to localhost while
   * reporting success — which for an AI author is indistinguishable from having
   * configured it.
   */
  it('rejects a misspelled connection key inside config, pathed at the key', () => {
    const result = DatasourceSchema.safeParse({
      ...base,
      config: { hostname: 'db.internal', database: 'analytics' },
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['config']);
    expect(result.error!.issues[0]!.message).toContain('`hostname` → `host`');
  });

  it('accepts the corrected config', () => {
    const result = DatasourceSchema.safeParse({
      ...base,
      config: { host: 'db.internal', database: 'analytics' },
    });

    expect(result.success).toBe(true);
  });

  it('leaves a plugin-contributed driver`s config alone', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'com.vendor.snowflake',
      config: { account: 'xy12345', warehouse: 'COMPUTE_WH' },
    });

    expect(result.success).toBe(true);
  });

  it('validates every driver id alias the same way', () => {
    for (const alias of ['pg', 'postgresql', 'POSTGRES']) {
      const result = DatasourceSchema.safeParse({
        name: 'warehouse',
        driver: alias,
        config: { hostname: 'db.internal', database: 'analytics' },
      });
      expect(result.success, alias).toBe(false);
    }
  });

  /**
   * #4410 extended this gate over `readReplicas` too. #4468 retired the key —
   * nothing ever opened a replica connection — so the parse must now REJECT the
   * slot rather than check what goes in it. Pinned here, next to the config
   * cases, because the two are easy to re-conflate: both are per-driver record
   * shapes, and only one of them has a consumer.
   */
  it('rejects readReplicas outright, with the retirement prescription', () => {
    const result = DatasourceSchema.safeParse({
      ...base,
      config: { host: 'db.internal', database: 'analytics' },
      readReplicas: [{ host: 'replica-1.internal', database: 'analytics' }],
    });

    expect(result.success).toBe(false);
    // A well-formed replica block: the rejection is about the key existing at
    // all, not about anything being wrong inside it.
    expect(result.error!.issues[0]!.message).toMatch(
      /`datasource\.readReplicas` was removed.*no query path separates reads from writes.*Delete the key/s,
    );
  });

  it('rejects a sqlite datasource whose filename is misspelled', () => {
    const result = DatasourceSchema.safeParse({
      name: 'local',
      driver: 'sqlite',
      config: { file: './data.db' },
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`file` → `filename`');
  });

  it('still reports the schemaMode/external coherence rule alongside a config problem', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'postgres',
      config: { hostname: 'db.internal', database: 'analytics' },
      schemaMode: 'external',
    });

    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('config');
    expect(paths).toContain('external');
  });
});
