// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The three `os datasource` subcommands, driven against the WRAPPED response
 * envelope the server really emits (#10675).
 *
 * This is these commands' first functional coverage: they shipped reading the
 * pre-#3843 flat shape (`body.tables` / `body.draft` / `body.results`, `error`
 * as a string) and never worked against the current envelope. Nothing was red
 * — every payload read `undefined`, which each command reported as an ordinary
 * empty result.
 *
 * ## What these tests are really pinning
 *
 * Not "the happy path parses". The severe failure mode was `validate` printing
 * `No federated objects to validate.` and exiting **0** against drift the
 * server had flagged `missing_column region severity:error` — a schema gate
 * green-lighting a CI-breaking condition it had never read. A test proving the
 * happy path now parses would not have caught it, because the happy path was
 * never what made it dangerous. So the drift case is first, and it asserts the
 * silent-pass sentence is ABSENT as well as asserting the failure.
 *
 * ## Why the bodies come from `sendOk` / `sendError`
 *
 * Those two functions in `@objectstack/types` are the one writer of the
 * declared envelope, so a fixture built through them is the server's shape by
 * construction. Typing this file's payloads out by hand would repeat the exact
 * mistake under repair: a copy of a server shape that stays self-consistent
 * while the server moves.
 */

import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Config } from '@oclif/core';
import type { Command } from '@oclif/core';
import { sendError, sendOk } from '@objectstack/types';
import type { RemoteTable, SchemaValidationResult } from '@objectstack/spec/contracts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverBody } from '../../utils/__tests__/server-body.js';
import DatasourceIntrospect from './introspect.js';
import DatasourceListTables from './list-tables.js';
import DatasourceValidate from './validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** This package's own root — `packages/cli`, never outside it. */
const CLI_ROOT = resolve(HERE, '../../..');

const DS = 'showcase_external';
const SERVER = 'http://127.0.0.1:39999';

/** The two tables the card's live-server oracle returned. */
const REMOTE_TABLES: RemoteTable[] = [
  { name: 'customers', columnCount: 7 },
  { name: 'orders', columnCount: 7 },
];

/**
 * The induced drift from the card: the fixture DB's `customers.region` was
 * renamed, and the server answered `ok:false … missing_column region`.
 */
const DRIFT_RESULT: SchemaValidationResult = {
  ok: false,
  datasource: DS,
  object: 'showcase_customers',
  diffs: [{ kind: 'missing_column', remoteName: 'customers', column: 'region', severity: 'error' }],
};

const CLEAN_RESULT: SchemaValidationResult = {
  ok: true,
  datasource: DS,
  object: 'showcase_customers',
  diffs: [],
};

/** The silent pass this card exists to make impossible. */
const SILENT_PASS = 'No federated objects to validate.';

let config: Config;

beforeAll(async () => {
  config = await Config.load({ root: CLI_ROOT });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Driven {
  logs: string[];
  warns: string[];
  /** The URL the command actually requested — the route the oracle drove. */
  url?: string;
  /** Present when the command exited non-zero. */
  failure?: { message: string; exit?: number };
}

type CommandCtor = new (argv: string[], config: Config) => Command;

/**
 * Run one command in-process against a fixed HTTP response, capturing what a
 * user would see. `run()` is driven directly rather than through oclif's
 * dispatcher so the assertions are about THIS class, not about command lookup.
 */
async function drive(
  Cmd: CommandCtor,
  argv: string[],
  response: { status: number; body: unknown },
): Promise<Driven> {
  const logs: string[] = [];
  const warns: string[] = [];
  let url: string | undefined;

  vi.stubGlobal('fetch', async (input: unknown) => {
    url = String(input);
    return {
      status: response.status,
      ok: response.status < 400,
      json: async () => response.body,
    };
  });

  const cmd = new Cmd(argv, config);
  Object.assign(cmd, {
    log: (message?: string) => {
      logs.push(String(message ?? ''));
    },
    warn: (message: string | Error) => {
      warns.push(message instanceof Error ? message.message : String(message));
      return message;
    },
  });

  try {
    await cmd.run();
    return { logs, warns, url };
  } catch (err) {
    const exit = (err as { oclif?: { exit?: number } }).oclif?.exit;
    return { logs, warns, url, failure: { message: (err as Error).message, exit } };
  }
}

const target = [DS, '--url', SERVER, '--token', 'tok'];

describe('os datasource validate — the gate must not pass on drift it never read', () => {
  it('fails on induced drift the server flagged, instead of reporting nothing to validate', async () => {
    const run = await drive(DatasourceValidate, target, {
      status: 200,
      body: serverBody((res) => sendOk(res, { ok: false, results: [DRIFT_RESULT] })),
    });

    // The defect: this sentence, with exit 0, against the body below it.
    expect(run.logs).not.toContain(SILENT_PASS);
    expect(run.logs.join('\n')).toContain('✗ missing_column: showcase_customers.region');
    expect(run.failure?.message).toBe('External schema validation failed.');
    expect(run.failure?.exit).toBe(1);
    expect(run.url).toBe(`${SERVER}/api/v1/datasources/${DS}/external/validate`);
  });

  it('passes when the server reports every federated object matching', async () => {
    const run = await drive(DatasourceValidate, target, {
      status: 200,
      body: serverBody((res) => sendOk(res, { ok: true, results: [CLEAN_RESULT] })),
    });

    expect(run.failure).toBeUndefined();
    expect(run.logs.join('\n')).toContain('✓ showcase_customers matches');
    expect(run.logs).not.toContain(SILENT_PASS);
  });

  it('keeps "nothing to validate" reachable only from a server that really said so', async () => {
    const run = await drive(DatasourceValidate, target, {
      status: 200,
      body: serverBody((res) => sendOk(res, { ok: true, results: [] })),
    });

    expect(run.failure).toBeUndefined();
    expect(run.logs).toContain(SILENT_PASS);
  });

  it('refuses a body it cannot read rather than reporting it as zero results', async () => {
    // The pre-#3843 flat shape — i.e. any response that is not the declared
    // envelope. Reading it as "no results" is precisely the silent pass; a
    // consumer-side fallback that accepted it would be the second de-facto
    // contract Prime Directive #12 forbids.
    const run = await drive(DatasourceValidate, target, {
      status: 200,
      body: { ok: false, results: [DRIFT_RESULT] },
    });

    expect(run.logs).not.toContain(SILENT_PASS);
    expect(run.failure?.message).toContain('envelope');
  });

  it('prints the server error text for an unknown datasource instead of crashing on the error object', async () => {
    const run = await drive(DatasourceValidate, ['nope', '--url', SERVER, '--token', 'tok'], {
      status: 400,
      body: serverBody((res) =>
        sendError(res, 400, 'EXTERNAL_DATASOURCE_ERROR', "Datasource 'nope' is not configured."),
      ),
    });

    expect(run.failure?.message).toBe("Datasource 'nope' is not configured.");
    // The pre-fix crash — `this.error(<the error OBJECT>)`.
    expect(run.failure?.message).not.toContain('first argument must be a string');
  });
});

describe('os datasource list-tables', () => {
  it('lists the tables the server returned, instead of reporting none found', async () => {
    const run = await drive(DatasourceListTables, target, {
      status: 200,
      body: serverBody((res) => sendOk(res, { tables: REMOTE_TABLES })),
    });

    expect(run.failure).toBeUndefined();
    expect(run.logs).not.toContain('No remote tables found.');
    expect(run.logs.join('\n')).toContain('customers  (7 cols)');
    expect(run.logs.join('\n')).toContain('orders  (7 cols)');
    expect(run.url).toBe(`${SERVER}/api/v1/datasources/${DS}/external/tables`);
  });

  it('keeps "no remote tables" reachable from an empty server list', async () => {
    const run = await drive(DatasourceListTables, target, {
      status: 200,
      body: serverBody((res) => sendOk(res, { tables: [] })),
    });

    expect(run.failure).toBeUndefined();
    expect(run.logs).toContain('No remote tables found.');
  });

  it('prints the server error text for an unknown datasource', async () => {
    const run = await drive(DatasourceListTables, ['nope', '--url', SERVER], {
      status: 400,
      body: serverBody((res) =>
        sendError(res, 400, 'EXTERNAL_DATASOURCE_ERROR', "Datasource 'nope' is not configured."),
      ),
    });

    expect(run.failure?.message).toBe("Datasource 'nope' is not configured.");
    expect(run.failure?.message).not.toContain('first argument must be a string');
  });
});

describe('os datasource introspect', () => {
  // An opaque marker, deliberately: what this asserts is that the CLI emits the
  // source the SERVER produced. The draft's contents are the server's business
  // (#10712 fixes the namespace prefix / sharingModel gap, #10676 the primary
  // key), and pinning today's draft text here would block those fixes.
  const DRAFT_SOURCE = '/* draft source, verbatim from the server */';

  it('emits the draft the server generated, instead of "Failed to generate draft"', async () => {
    const run = await drive(DatasourceIntrospect, [...target, '--table', 'customers'], {
      status: 200,
      body: serverBody((res) =>
        sendOk(res, {
          draft: {
            name: 'customers',
            datasource: DS,
            definition: {},
            source: DRAFT_SOURCE,
            review: [{ column: 'region', remoteType: 'jsonb', note: 'unmapped remote type' }],
          },
        }),
      ),
    });

    expect(run.failure).toBeUndefined();
    expect(run.logs).toContain(DRAFT_SOURCE);
    expect(run.warns.join('\n')).toContain("REVIEW: column 'region' — unmapped remote type");
    expect(run.url).toBe(`${SERVER}/api/v1/datasources/${DS}/external/tables/customers/draft`);
  });

  it('still reports a genuinely absent draft', async () => {
    const run = await drive(DatasourceIntrospect, [...target, '--table', 'customers'], {
      status: 200,
      body: serverBody((res) => sendOk(res, {})),
    });

    expect(run.failure?.message).toBe(`Failed to generate draft for 'customers' on '${DS}'.`);
  });

  it('prints the server error text when the remote table does not exist', async () => {
    const run = await drive(DatasourceIntrospect, [...target, '--table', 'ghost'], {
      status: 400,
      body: serverBody((res) =>
        sendError(res, 400, 'EXTERNAL_DATASOURCE_ERROR', "Remote table 'ghost' not found."),
      ),
    });

    expect(run.failure?.message).toBe("Remote table 'ghost' not found.");
    expect(run.failure?.message).not.toContain('first argument must be a string');
  });
});
