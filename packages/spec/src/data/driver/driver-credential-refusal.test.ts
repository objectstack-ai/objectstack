// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7990 — inline credentials are refused across the driver-config family
 * (maintainer-ruled Option A, 2026-08-12: per-artefact contract closure).
 *
 * `sys_metadata.metadata` is reachable through the ordinary data API, and a
 * datasource is persisted whole — so a credential the schema ACCEPTS inline is
 * a credential stored in cleartext. Every pin here asserts BOTH directions the
 * ruling names:
 *
 *   1. the inline form is refused LOUDLY, with guidance naming the mechanisms
 *      that already exist (`sys_secret` via the datasource secret binder;
 *      `external.credentialsRef`) — never a bare `unrecognized_keys`;
 *   2. the ref-based and credential-free forms keep parsing BYTE-IDENTICALLY.
 *
 * Plus the projection contract that makes the refusal safe to ship: the Studio
 * connection form renders its SECRET input from the `format: 'password'`
 * marker in the driver's JSON-Schema projection and routes the value to the
 * top-level `secret` (the binder's door). The refused key must keep that
 * marker, or the wizard loses the very input the refusal diverts authors to.
 */

import { describe, expect, it } from 'vitest';

import { DatasourceSchema } from '../datasource.zod';
import {
  getMongoConfigJsonSchema,
  MongoConfigSchema,
} from './mongo.zod';
import { getMysqlConfigJsonSchema, MysqlConfigSchema } from './mysql.zod';
import { getPostgresConfigJsonSchema, PostgresConfigSchema } from './postgres.zod';
import { getTursoConfigJsonSchema, TursoConfigSchema } from './turso.zod';

/** The family under the ruling: schema, its credential key, a minimal valid config. */
const FAMILY = [
  {
    driver: 'postgres',
    key: 'password',
    schema: PostgresConfigSchema,
    jsonSchema: getPostgresConfigJsonSchema,
    valid: { database: 'prod', host: 'db.internal', username: 'app' },
    formerAliases: ['passwd', 'pwd'],
  },
  {
    driver: 'mysql',
    key: 'password',
    schema: MysqlConfigSchema,
    jsonSchema: getMysqlConfigJsonSchema,
    valid: { database: 'prod', host: 'db.internal', username: 'app' },
    formerAliases: ['passwd', 'pwd'],
  },
  {
    driver: 'mongo',
    key: 'password',
    schema: MongoConfigSchema,
    jsonSchema: getMongoConfigJsonSchema,
    valid: { database: 'events', host: 'mongo.internal', username: 'svc' },
    formerAliases: ['passwd', 'pwd'],
  },
  {
    driver: 'turso',
    key: 'authToken',
    schema: TursoConfigSchema,
    jsonSchema: getTursoConfigJsonSchema,
    valid: { url: 'libsql://x.turso.io' },
    formerAliases: ['token', 'jwt', 'auth_token', 'authtoken'],
  },
] as const;

describe.each(FAMILY)('$driver — inline credential refusal (#7990)', (f) => {
  it(`refuses an inline \`${f.key}\`, naming the key's replacement mechanisms`, () => {
    const result = f.schema.safeParse({ ...f.valid, [f.key]: 'hunter2' });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === f.key);
    expect(issue, `refusal must be pathed at \`${f.key}\``).toBeDefined();
    // The ADR-named mechanisms, BY NAME — the message is the migration doc for
    // whoever hits it (very often an AI author).
    expect(issue!.message).toContain(`\`${f.key}\``);
    expect(issue!.message).toContain('external.credentialsRef');
    expect(issue!.message).toContain('sys_secret');
    expect(issue!.message).toContain('secret binder');
  });

  it('refuses a placeholder value exactly like a real one — the KEY is the sink', () => {
    // `${…}` placeholders are resolved by nothing (measured, #7990 census):
    // they were stored verbatim in `sys_metadata` and connected verbatim.
    const result = f.schema.safeParse({ ...f.valid, [f.key]: '${DB_PASSWORD}' });
    expect(result.success).toBe(false);
  });

  it.each([...f.formerAliases])(
    'former alias spelling `%s` carries the refusal directly (no two-step rename)',
    (alias) => {
      const result = f.schema.safeParse({ ...f.valid, [alias]: 'hunter2' });
      expect(result.success).toBe(false);
      const text = JSON.stringify(result.error!.issues);
      expect(text).toContain('external.credentialsRef');
      expect(text).toContain('sys_secret');
      // Never a rename hint onto the unwritable key — that is the
      // `triggerPhrase → triggerPhrases` two-step rejection.
      expect(text).not.toContain('Did you mean');
    },
  );

  it('accepts the credential-free config byte-identically (pin)', () => {
    const before = f.schema.safeParse(f.valid);
    expect(before.success, JSON.stringify(before.error?.issues)).toBe(true);
    // Parse twice — the output is a pure function of the input, and the parsed
    // value must carry no trace of the refused key.
    const again = f.schema.parse(f.valid);
    expect(again).toEqual(before.data);
    expect(Object.keys(again)).not.toContain(f.key);
  });

  it("keeps the connection form's secret input renderable: `format: 'password'` survives", () => {
    const json = f.jsonSchema() as {
      properties?: Record<string, { format?: string; not?: object }>;
    };
    const prop = json.properties?.[f.key];
    expect(prop, `projection must still declare \`${f.key}\``).toBeDefined();
    // Both halves of the dual role, pinned together: the wizard's marker …
    expect(prop!.format).toBe('password');
    // … and the refusal (z.never emits `{ not: {} }` — also what flags the key
    // `[RETIRED]` in the authorable-surface ratchet).
    expect(prop!.not).toEqual({});
  });
});

describe('DatasourceSchema — the refusal reaches the authored artefact (#7990)', () => {
  it('re-paths the refusal under `config.<key>` for the author', () => {
    const result = DatasourceSchema.safeParse({
      name: 'prod',
      driver: 'postgres',
      config: { database: 'prod', password: 'hunter2' },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'config.password');
    expect(issue, 'issue must be re-pathed under config.password').toBeDefined();
    expect(issue!.message).toContain('external.credentialsRef');
  });

  it('still accepts the ref-based form byte-identically (pin)', () => {
    // The shape the refusal diverts to: secret in the store, opaque handle at
    // `external.credentialsRef` — exactly what the datasource secret binder
    // writes (`sys_secret:<id>`), on a federated datasource.
    const refBased = {
      name: 'warehouse',
      driver: 'postgres',
      schemaMode: 'external',
      config: { database: 'analytics', host: 'wh.internal', username: 'readonly' },
      external: {
        allowWrites: false,
        credentialsRef: 'sys_secret:01J9ZK4T2N',
      },
    } as const;
    const result = DatasourceSchema.safeParse(refBased);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data!.external?.credentialsRef).toBe('sys_secret:01J9ZK4T2N');
    // Byte-identical across parses — the refusal changed nothing on this path.
    expect(DatasourceSchema.parse(refBased)).toEqual(result.data);
  });

  it('embedded-in-URL credentials remain accepted (measured, NOT ruled — #7990 open question)', () => {
    // The ruling covers inline credential FIELDS. A `user:password@host` inside
    // `config.url` is a live, unruled door — pinned here as a FACT so a future
    // ruling starts from measurement, not as an endorsement.
    const result = DatasourceSchema.safeParse({
      name: 'legacy',
      driver: 'postgres',
      config: { url: 'postgresql://user:pass@db.example.com:5432/production' },
    });
    expect(result.success).toBe(true);
  });
});
