// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27687 — the code author's credential route, in every credential refusal.
 *
 * The refusals prescribe two routes (the Setup → Datasources secret field, a
 * minted `external.credentialsRef` handle) and both are a UI author's: the
 * Setup form cannot edit a datasource defined in code, and nothing mints a
 * handle for one. Maintainer ruling (option 5): a code-defined datasource
 * reads its credential at connect time from `OS_DATASOURCE_<NAME>_PASSWORD`.
 * Each refusal now carries that route in ONE shared sentence
 * ({@link CODE_DEFINED_CREDENTIAL_ROUTE}), keeps the UI routes, and is walked
 * here exactly as written: the example name and variable are read OUT of the
 * message, the credential is left out of the very declaration that was
 * refused, and the result must parse. That the example variable is the one
 * the runtime derives is pinned where the derivation lives
 * (`service-datasource`'s `datasource-env-credential.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { DatasourceSchema } from '../datasource.zod';
import { CODE_DEFINED_CREDENTIAL_ROUTE } from './common.zod';

/** Every issue message the authored artefact draws, with its dotted path. */
const issuesOf = (input: unknown): { path: string; message: string }[] => {
  const result = DatasourceSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
};

/** Read the route's worked example back out of a message. */
const exampleOf = (message: string) => {
  const m = /`(OS_DATASOURCE_[A-Z0-9_]+_PASSWORD)` for a datasource named `([a-z0-9_]+)`/.exec(message);
  return m ? { variable: m[1], name: m[2] } : undefined;
};

const PG = { host: 'db.internal', database: 'warehouse', username: 'svc' } as const;

/**
 * One row per refusal family: the refused authored artefact, where the refusal
 * is pathed, and the same artefact with the credential left out — what the
 * route tells a code author to write.
 */
const REFUSALS: { family: string; refused: (name: string) => unknown; at: string; following: (name: string) => unknown }[] = [
  {
    family: 'inline `config.password`',
    refused: (name) => ({ name, driver: 'postgres', config: { ...PG, password: 'hunter2' } }),
    at: 'config.password',
    following: (name) => ({ name, driver: 'postgres', config: PG }),
  },
  {
    family: 'URL userinfo password',
    refused: (name) => ({ name, driver: 'postgres', config: { url: 'postgres://svc:hunter2@db.internal/warehouse' } }),
    at: 'config.url',
    following: (name) => ({ name, driver: 'postgres', config: { url: 'postgres://svc@db.internal/warehouse' } }),
  },
  {
    family: 'URL credential query parameter',
    refused: (name) => ({ name, driver: 'postgres', config: { url: 'postgres://svc@db.internal/warehouse?password=hunter2' } }),
    at: 'config.url',
    following: (name) => ({ name, driver: 'postgres', config: { url: 'postgres://svc@db.internal/warehouse' } }),
  },
  {
    family: 'mongo passthrough `auth.password`',
    refused: (name) => ({
      name,
      driver: 'mongodb',
      config: { database: 'events', host: 'mongo.internal', options: { auth: { username: 'svc', password: 'hunter2' } } },
    }),
    at: 'config.options.auth.password',
    following: (name) => ({
      name,
      driver: 'mongodb',
      config: { database: 'events', host: 'mongo.internal', options: { auth: { username: 'svc' } } },
    }),
  },
  {
    family: 'mongo passthrough nested credential spelling',
    refused: (name) => ({
      name,
      driver: 'mongodb',
      config: { database: 'events', host: 'mongo.internal', username: 'svc', options: { pool: { password: 'hunter2' } } },
    }),
    at: 'config.options.pool.password',
    following: (name) => ({
      name,
      driver: 'mongodb',
      config: { database: 'events', host: 'mongo.internal', username: 'svc', options: { pool: {} } },
    }),
  },
  {
    family: 'top-level `password` guidance',
    refused: (name) => ({ name, driver: 'postgres', password: 'hunter2', config: PG }),
    at: '',
    following: (name) => ({ name, driver: 'postgres', config: PG }),
  },
  {
    family: '`external.password` guidance',
    refused: (name) => ({ name, driver: 'postgres', schemaMode: 'external', config: PG, external: { password: 'hunter2' } }),
    at: 'external',
    following: (name) => ({ name, driver: 'postgres', schemaMode: 'external', config: PG, external: {} }),
  },
];

describe('CODE_DEFINED_CREDENTIAL_ROUTE — the sentence itself', () => {
  it('names the derived variable by a worked example, the CLI host default and the switch', () => {
    const example = exampleOf(CODE_DEFINED_CREDENTIAL_ROUTE);
    expect(example).toEqual({ variable: 'OS_DATASOURCE_WAREHOUSE_PASSWORD', name: 'warehouse' });
    expect(CODE_DEFINED_CREDENTIAL_ROUTE).toContain('`defineDatasource`');
    expect(CODE_DEFINED_CREDENTIAL_ROUTE).toContain('`os serve` / `os start`');
    expect(CODE_DEFINED_CREDENTIAL_ROUTE).toContain('`OS_DATASOURCE_ENV_CREDENTIALS=on`');
  });

  it('carries no tracker id and no pasteable placeholder', () => {
    expect(CODE_DEFINED_CREDENTIAL_ROUTE).not.toMatch(/#\d{3,6}\b/);
    expect(CODE_DEFINED_CREDENTIAL_ROUTE).not.toMatch(/<[A-Z_]+>|\$\{/);
  });
});

describe.each(REFUSALS)('$family — the refusal carries the code route and following it parses', ({ refused, at, following }) => {
  it('is refused with the shared sentence, keeping the UI routes', () => {
    const issue = issuesOf(refused('warehouse')).find(
      (i) => i.path === at && i.message.includes(CODE_DEFINED_CREDENTIAL_ROUTE),
    );
    expect(issue, `a refusal at \`${at}\` carrying the shared sentence`).toBeDefined();
    // The ruled UI routes stay in the same message (#7990 / #8082's prescription).
    expect(issue!.message).toContain('Setup → Datasources');
    expect(issue!.message).toContain('sys_secret');
    expect(issue!.message).not.toMatch(/#\d{3,6}\b/);
  });

  it("following the route — the example's name, the credential left out — parses, with no secret anywhere", () => {
    const issue = issuesOf(refused('warehouse')).find((i) => i.path === at && i.message.includes(CODE_DEFINED_CREDENTIAL_ROUTE));
    const example = exampleOf(issue?.message ?? '');
    expect(example).toBeDefined();
    const followed = DatasourceSchema.safeParse(following(example!.name));
    expect(followed.success, JSON.stringify(followed.error?.issues)).toBe(true);
    expect(JSON.stringify(followed.data)).not.toContain('hunter2');
    expect(followed.data?.name).toBe(example!.name);
  });
});
