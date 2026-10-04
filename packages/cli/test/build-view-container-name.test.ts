// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20393] `os build` refuses a `views:` container whose own `name` disagrees
 * with the object key it binds to — the stack `os serve` refuses at boot —
 * says so in the boot registrar's own words, and writes NO artifact.
 *
 * ## The defect, measured before the fix
 *
 * On an `os init -t app` project with a view `{ name: 'order_line', object:
 * 'my_app_order_line', list: {…} }`, `os build` exited 0 and wrote
 * `dist/objectstack.json` carrying that container; `os serve`, booting that
 * artifact with no config, exited 1 with "Invalid `views:` container from
 * manifest 'com.example.my-app': the container's own `name` is 'order_line',
 * which disagrees with the object key it binds to, 'my_app_order_line' …".
 * `os validate` had refused the same stack since #20331; the build — the door
 * that SHIPS — did not, so it shipped the failure.
 *
 * ## One judge, one walk
 *
 * `compile.ts` makes the call `validate.ts` makes: `findViewContainerNameRefusals`
 * over the parsed stack, which hands each entry to `@objectstack/objectql`'s
 * `viewContainerNameRefusal` — the function the boot loop throws the answer of.
 * So the pins below assert EQUALITY with the message the boot registrar
 * actually throws for the same payload, driven through `ObjectQL.registerApp`,
 * rather than a literal copy of the words.
 *
 * The CLI runs through `bin/run-dev.js` (source, via tsx); its dependencies —
 * `@objectstack/objectql` among them — resolve through `exports` to `dist/`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL } from '@objectstack/objectql';
import { childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
/** A cold `tsx` spawn of the CLI source entry runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 120_000;
/** `os build`'s default `--output`, relative to the working directory. */
const ARTIFACT = join('dist', 'objectstack.json');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
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

function payloadOf(run: Run, label: string): Record<string, any> {
  try {
    return JSON.parse(run.stdout) as Record<string, any>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

const NS = 'bvcn';
const ID = `com.example.${NS}`;
const OBJECT = `${NS}_order_line`;

const orderLineObject = (name: string) => ({
  name,
  label: 'Order Line',
  sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' } },
});

const container = (object: string, viewName: string | undefined) => ({
  ...(viewName === undefined ? {} : { name: viewName }),
  label: 'Order Line',
  object,
  list: { type: 'grid', columns: [{ field: 'name' }] },
});

/** A one-package stack, as data — written to disk as the config AND handed to boot. */
function stack(viewName: string | undefined): Record<string, unknown> {
  return {
    manifest: { id: ID, name: NS, version: '1.0.0', type: 'app', namespace: NS },
    objects: [orderLineObject(OBJECT)],
    views: [container(OBJECT, viewName)],
  };
}

/**
 * A `packages[]` stack (ADR-0130 D4): the load path registers each body under
 * its own id and never the top level. The divergent container sits in the
 * SECOND body; the first carries a matching one, which must not be reported.
 */
const CORE_ID = 'com.example.bvcn-core';
const ORDERS_ID = 'com.example.bvcn-orders';
const ordersBody = {
  id: ORDERS_ID,
  name: 'bvcn_orders',
  version: '1.0.0',
  type: 'app',
  objects: [orderLineObject('bvcn_orders_line')],
  views: [container('bvcn_orders_line', 'order_line')],
};
function packagesStack(): Record<string, unknown> {
  return {
    packages: [
      {
        manifest: {
          id: CORE_ID,
          name: 'bvcn_core',
          version: '1.0.0',
          type: 'app',
          objects: [orderLineObject('bvcn_core_line')],
          views: [container('bvcn_core_line', 'bvcn_core_line')],
        },
      },
      { manifest: ordersBody },
    ],
  };
}

/**
 * What the boot registrar throws for a payload, driven the way the load path
 * drives it: one body into `registerApp`.
 */
function bootRefusal(payload: Record<string, unknown>): any {
  try {
    new ObjectQL().registerApp(payload);
  } catch (e) {
    return e;
  }
  return undefined;
}

/** A one-package stack (or its artifact) as `AppPlugin` hands it: `{ ...manifest, ...stack }`. */
const asBootPayload = (s: Record<string, unknown>) => ({ ...(s.manifest as Record<string, unknown>), ...s });

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-build-view-container-name-'));
  const make = (label: string, s: Record<string, unknown>) => {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    // A `defineStack` config (#20367 ruling B: `os build` refuses any other
    // default export), spec linked in — the `validate-view-container-name` twin.
    writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource(s));
    linkSpec(dir);
    dirs[label] = dir;
  };
  make('divergent-json', stack('order_line'));
  make('divergent-text', stack('order_line'));
  make('divergent-packages', packagesStack());
  make('matching', stack(OBJECT));
  make('anonymous', stack(undefined));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#20393 — os build refuses what the boot registrar refuses, in its words, and ships nothing', () => {
  it('premise: the boot registrar refuses both divergent payloads, and accepts both controls', () => {
    // Without this, the pins below could agree with a boot loop that had
    // stopped refusing anything.
    const refusal = bootRefusal(asBootPayload(stack('order_line')));
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.code).toBe('VALIDATION_ERROR');
    expect(bootRefusal(ordersBody)).toBeInstanceOf(Error);
    expect(bootRefusal(asBootPayload(stack(OBJECT)))).toBeUndefined();
    expect(bootRefusal(asBootPayload(stack(undefined)))).toBeUndefined();
  });

  it('THE PIN: --json exits 1, reports the boot registrar\'s refusal verbatim, and writes no artifact', async () => {
    const dir = dirs['divergent-json'];
    const run = await runCli(['build', '--json'], dir);
    const payload = payloadOf(run, 'divergent --json');
    expect(run.code).toBe(1);
    expect(payload.success).toBe(false);
    expect(Array.isArray(payload.errors)).toBe(true);
    expect(payload.errors).toHaveLength(1);

    const boot = bootRefusal(asBootPayload(stack('order_line')));
    const [row] = payload.errors;
    expect(row.message).toBe(boot.message);
    // The envelope boot throws with, carried onto the row.
    expect(row.code).toBe(boot.code);
    expect(row.httpStatus).toBe(boot.httpStatus);
    expect(row.path).toBe('views[0]');
    // The point of the card: the door that ships ships nothing.
    expect(existsSync(join(dir, ARTIFACT)), 'os build wrote an artifact the server refuses at boot').toBe(false);
  }, SPAWN_TIMEOUT_MS);

  it('the text face exits 1, prints the same words, and writes no artifact', async () => {
    const dir = dirs['divergent-text'];
    const run = await runCli(['build'], dir);
    expect(run.code).toBe(1);
    expect(run.stdout).not.toContain('Build complete');
    expect(run.stdout).toContain(bootRefusal(asBootPayload(stack('order_line'))).message);
    expect(existsSync(join(dir, ARTIFACT))).toBe(false);
  }, SPAWN_TIMEOUT_MS);

  it('a `packages[]` stack: the body boot refuses is refused under its own id, and the matching one is not', async () => {
    const dir = dirs['divergent-packages'];
    const run = await runCli(['build', '--json'], dir);
    const payload = payloadOf(run, 'packages --json');
    expect(run.code).toBe(1);
    expect(payload.success).toBe(false);
    expect(payload.errors).toHaveLength(1);
    const [row] = payload.errors;
    expect(row.path).toBe('packages[1].manifest.views[0]');
    expect(row.message).toBe(bootRefusal(ordersBody).message);
    expect(row.message).toContain(`from manifest '${ORDERS_ID}'`);
    expect(existsSync(join(dir, ARTIFACT))).toBe(false);
  }, SPAWN_TIMEOUT_MS);

  it('CONTROL: a container whose `name` matches its object builds, and the artifact it writes boots', async () => {
    const dir = dirs.matching;
    const run = await runCli(['build', '--json'], dir);
    const payload = payloadOf(run, 'matching --json');
    expect(payload.success, JSON.stringify(payload.errors ?? payload.error)).toBe(true);
    expect(run.code).toBe(0);
    const artifact = JSON.parse(readFileSync(join(dir, ARTIFACT), 'utf8')) as Record<string, unknown>;
    expect(bootRefusal(asBootPayload(artifact))).toBeUndefined();
  }, SPAWN_TIMEOUT_MS);

  it('CONTROL: a container with no `name` builds — the shape boot also accepts', async () => {
    const dir = dirs.anonymous;
    const run = await runCli(['build', '--json'], dir);
    const payload = payloadOf(run, 'anonymous --json');
    expect(payload.success, JSON.stringify(payload.errors ?? payload.error)).toBe(true);
    expect(run.code).toBe(0);
    expect(existsSync(join(dir, ARTIFACT))).toBe(true);
  }, SPAWN_TIMEOUT_MS);
});
