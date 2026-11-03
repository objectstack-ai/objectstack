// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0010] `os validate` — the build door an author runs before shipping —
 * refuses a collection item whose body carries another package's `_packageId`,
 * run for real, located at the item's key.
 *
 * ## The defect, measured before the fix
 *
 * A stack whose connector body carried `_packageId: 'com.example.host'` (a
 * stamp only the registration writes) validated clean and exited 0; the
 * registration door (`ObjectQL.registerApp`) refused it at boot or install
 * with `VALIDATION_ERROR` / 400 at `_packageId`. The author heard about it
 * from a failed install, not where they wrote it.
 *
 * ## One judge
 *
 * Both doors call `judgeCollectionItemOwnerStamp` (`@objectstack/spec/kernel`).
 * So the headline pin asserts equality with the judge's own build-door words,
 * and with the verdict the registration door returns for the same stack,
 * driven through `ObjectQL.registerApp`, rather than a literal copy of the
 * words, which would be a second spelling of them.
 *
 * Integration tier: it spawns the source CLI (`packages/cli/vitest-tiers.ts`).
 * Two spawns, one per fixture. The CLI runs through `bin/run-dev.js` (source,
 * under `node`), and `@objectstack/spec` resolves through `exports` to `dist/`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL } from '@objectstack/objectql';
import { judgeCollectionItemOwnerStamp } from '@objectstack/spec/kernel';
import { childEnv } from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
/** A cold spawn of the CLI source entry runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 180_000;

const OWNER = 'com.example.ownerstamp';
const FOREIGN = 'com.example.host';

const manifest = {
  id: OWNER,
  namespace: 'ost',
  name: 'Owner stamp door probe',
  version: '1.0.0',
  type: 'app',
  engines: { protocol: '^18' },
};

const connector = (stamp?: string) => ({
  name: 'ost_billing',
  label: 'Billing',
  type: 'api',
  provider: 'openapi',
  providerConfig: { spec: './specs/billing.json' },
  ...(stamp === undefined ? {} : { _packageId: stamp }),
});

/** The smallest OpenAPI document the connector's `providerConfig.spec` can name. */
const OPENAPI_DOC = { openapi: '3.0.3', info: { title: 'Billing', version: '1.0.0' }, paths: {} };

const stackOf = (stamp?: string) => ({ manifest, connectors: [connector(stamp)] });

const FIXTURES = {
  /** The connector body names another package as its owner. */
  stamped: stackOf(FOREIGN),
  /** CONTROL: the same body without the stamp. */
  unstamped: stackOf(),
} as const;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

interface ValidateError {
  code?: string;
  path?: unknown[];
  message?: string;
}

/** `os validate --json` on failure: the parse's issues ride `errors`. */
const errorsOf = (stdout: string): ValidateError[] => (JSON.parse(stdout) as { errors?: ValidateError[] }).errors ?? [];

const dirs = new Map<keyof typeof FIXTURES, string>();

beforeAll(() => {
  for (const [kind, stack] of Object.entries(FIXTURES) as Array<[keyof typeof FIXTURES, unknown]>) {
    const dir = mkdtempSync(join(tmpdir(), `os-owner-stamp-door-${kind}-`));
    // `strict: false`: the door's own parse must judge the content, not `defineStack` at load.
    writeDefineStackConfig(dir, stack, { strict: false });
    // The connector's spec file, so the control's only verdict is the stamp's.
    mkdirSync(join(dir, 'specs'));
    writeFileSync(join(dir, 'specs', 'billing.json'), JSON.stringify(OPENAPI_DOC));
    dirs.set(kind, dir);
  }
});

afterAll(() => {
  for (const dir of dirs.values()) rmSync(dir, { recursive: true, force: true });
});

describe('os validate refuses a collection item whose body names another package as its owner', () => {
  it('exit 1: located at the item\'s `_packageId`, in the judge\'s build words, and the registration door refuses the same body', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('stamped')!);
    expect(run.code, `expected exit 1:\n${run.stdout}\n${run.stderr}`).toBe(1);
    const errors = errorsOf(run.stdout);
    expect(errors.map((e) => ({ code: e.code, path: (e.path ?? []).join('.') })))
      .toEqual([{ code: 'custom', path: 'connectors.0._packageId' }]);
    expect(errors[0].message).toBe(judgeCollectionItemOwnerStamp(connector(FOREIGN), 'connector', 'ost_billing', OWNER, 'build')!.message);

    // The same verdict at the registration door, for the same body.
    let boot: any;
    try {
      new ObjectQL().registerApp({ ...manifest, connectors: [connector(FOREIGN)] } as any);
    } catch (e) {
      boot = e;
    }
    expect(boot).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(boot.issues).toEqual([expect.objectContaining({ path: '_packageId' })]);
    expect(boot.message).toBe(judgeCollectionItemOwnerStamp(connector(FOREIGN), 'connector', 'ost_billing', OWNER, 'register')!.message);
  }, SPAWN_TIMEOUT_MS);

  it('CONTROL: the same body without the stamp exits 0', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('unstamped')!);
    expect(run.code, `expected exit 0:\n${run.stdout}\n${run.stderr}`).toBe(0);
    expect((JSON.parse(run.stdout) as { valid?: boolean }).valid).toBe(true);
  }, SPAWN_TIMEOUT_MS);
});
