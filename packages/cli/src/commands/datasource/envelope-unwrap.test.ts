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
 *
 * ## Why the oclif `Config` is loaded at MODULE SCOPE (#18748)
 *
 * `Config.load({ root: CLI_ROOT })` used to sit in a `beforeAll`, where it was
 * judged by vitest's DEFAULT `hookTimeout` of 10000ms -- a budget nobody in
 * this package chose (`packages/cli/vitest.config.ts` sets no timeout key at
 * all, by the declared design in its own header). Measured on the 4-vCPU
 * container this change was made on, n=5 per row, the call itself:
 *
 *     idle                       3934 / 3962 / 4272 / 4451 / 4469 ms
 *     4 spinners on 4 vCPU       7843 / 7981 / 8585 / 8782 / 9011 ms
 *
 * So an ordinary idle run already spends 39-45% of that budget, and a box that
 * cannot even reach the load a merge-queue shard applies leaves as little as
 * **989 ms** of margin. A budget a real cost approaches to within a second is
 * not a budget -- it is a LOAD SENSOR, and what it senses is how busy the
 * runner is, reported as "this file failed".
 *
 * ⛔ The answer is NOT a bigger number. Widening the window around the cost
 * relocates the cliff to the next heavier shard; the merge queue runs the FULL
 * suite where PR-side CI runs only the affected subset, so the queue shard is
 * heavier than anything a PR check measures, and it is where this class has
 * already ejected green PRs belonging to other people.
 *
 * The answer is to take the cost OUT of every clocked window, which is the
 * repo's own stated convention -- "clocked windows measure behaviour, never
 * loading" (AGENTS.md, Build & Test), the same move `check:test-source-alias`
 * prescribes for a cold dependency load and the same one
 * `plugins/plugin-dev/src/dev-plugin-security-enforcement-warning.test.ts`
 * records paying twice. A module-scope `await` is paid during COLLECTION, and
 * collection is clocked against NOTHING. Verified against the runner this tree
 * installs rather than recalled: in `@vitest/runner@4.1.11`, `withTimeout(...)`
 * wraps exactly the hooks and the test bodies, while `collectTests()` awaits
 * `runner.importFile(filepath, 'collect')` bare; and `vitest --help` on 4.1.11
 * offers exactly three timeout knobs (`testTimeout`, `hookTimeout`,
 * `teardownTimeout`), none of which covers module loading.
 *
 * ⛔ Do not move this back into a hook, and do not answer a recurrence by
 * raising a timeout. The last section of this file pins the placement so that
 * "do not" is an assertion rather than a sentence nobody reads.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Config } from '@oclif/core';
import type { Command } from '@oclif/core';
import { sendError, sendOk } from '@objectstack/types';
import type { RemoteTable, SchemaValidationResult } from '@objectstack/spec/contracts';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskCommentsAndLiterals } from '../../../../../scripts/js-comment-mask.mjs';
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

/**
 * Paid HERE, at module scope, and not in a hook -- see "Why the oclif `Config`
 * is loaded at MODULE SCOPE" in this file's header for the measured legs and
 * for the runner reading that says collection is the one unclocked phase.
 */
const config = await Config.load({ root: CLI_ROOT });

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

/**
 * The placement above, pinned (#18748).
 *
 * ⚠️ This is a SOURCE assertion on purpose, and it is the only shape available
 * here. The behavioural instrument the sibling prior art used --
 * `vitest run --hookTimeout=1`, green iff no hook time is left to clock -- is
 * INERT in this package, measured rather than assumed: a probe `beforeAll`
 * sleeping 500ms passes under `--hookTimeout=1` in `packages/cli` (with and
 * without `--project`), while the identical probe under `@objectstack/plugin-
 * dev` -- which declares no `test.projects` -- fails with `Hook timed out in
 * 1ms`. A CLI timeout override does not reach a project-level config on
 * vitest 4.1.11, so in this package that flag cannot witness anything.
 *
 * What is left to assert is the structural fact the measurement stands on: the
 * cold load has no clocked window around it. A regression puts `Config.load`
 * back inside a hook or a test body, and both halves of that show up here.
 */
describe('#18748 the oclif cold load stays outside every clocked window', () => {
  it('pays `Config.load` at module scope, leaving no hook to clock it', () => {
    // Comment AND literal spans blanked: this file's prose discusses the very
    // spellings being searched for, and so do the regex bodies just below, so
    // a bare-text scan would match itself and pass on its own commentary.
    const code = maskCommentsAndLiterals(readFileSync(fileURLToPath(import.meta.url), 'utf8'));

    // Exactly one call site, and it opens its own line -- i.e. it is nested in
    // no function body, which is what "paid during collection" reduces to.
    expect(code.match(/Config\.load\s*\(/g) ?? []).toHaveLength(1);
    expect(code).toMatch(/^const\s+config\s*=\s*await\s+Config\.load\s*\(/m);

    // ⛔ No hook may come back to carry it. The `afterEach` this file does keep
    // is a synchronous `vi.unstubAllGlobals()` and loads nothing.
    expect(code).not.toMatch(/\bbeforeAll\s*\(/);
    expect(code).not.toMatch(/\bbeforeEach\s*\(/);
  });
});
