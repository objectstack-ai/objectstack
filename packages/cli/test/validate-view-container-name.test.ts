// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20331] `os validate` refuses a `views:` container whose own `name`
 * disagrees with the object key it binds to — the stack `os serve` refuses at
 * boot — and says so in the boot registrar's own words.
 *
 * ## The defect, measured before the fix
 *
 * On an `os init -t app` project with a view `{ name: 'order_line', object:
 * 'my_app_order_line', list: {…} }`, `os validate` exited 0 (`✓ Validation
 * passed`, `UI: 1 Views`) and `os serve --dev` exited 1 with "Invalid `views:`
 * container from manifest 'com.example.my-app': the container's own `name` is
 * 'order_line', which disagrees with the object key it binds to,
 * 'my_app_order_line' …". The author-time judge of what the runtime accepts
 * passed a stack the runtime refuses.
 *
 * ## One judge
 *
 * The check lives in `@objectstack/objectql`'s `viewContainerNameRefusal`; the
 * boot loop throws what it returns and `os validate` reports it. So the
 * headline pin below asserts EQUALITY with the message the boot registrar
 * actually throws for the same stack — driven through `ObjectQL.registerApp`
 * with the payload `AppPlugin` hands it — rather than a literal copy of the
 * words, which would be a second spelling of them.
 *
 * The CLI runs through `bin/run-dev.js` (source, via tsx); its dependencies —
 * `@objectstack/objectql` among them — resolve through `exports` to `dist/`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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

const NS = 'vcn';
const ID = `com.example.${NS}`;
const OBJECT = `${NS}_order_line`;

/** The stack, as data — written to disk as the config AND handed to boot. */
function stack(viewName: string | undefined): Record<string, unknown> {
  return {
    manifest: { id: ID, name: NS, version: '1.0.0', type: 'app', namespace: NS },
    objects: [
      {
        name: OBJECT,
        label: 'Order Line',
        sharingModel: 'private',
        fields: { name: { type: 'text', label: 'Name' } },
      },
    ],
    views: [
      {
        ...(viewName === undefined ? {} : { name: viewName }),
        label: 'Order Line',
        object: OBJECT,
        list: { type: 'grid', columns: [{ field: 'name' }] },
      },
    ],
  };
}

/**
 * What the boot registrar throws for this stack, driven the way `AppPlugin`
 * drives it: `{ ...manifest, ...stack }` into `registerApp`.
 */
function bootRefusal(s: Record<string, unknown>): any {
  const payload = { ...(s.manifest as Record<string, unknown>), ...s };
  try {
    new ObjectQL().registerApp(payload);
  } catch (e) {
    return e;
  }
  return undefined;
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-validate-view-container-name-'));
  const make = (label: string, s: Record<string, unknown>) => {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource(s));
    linkSpec(dir);
    dirs[label] = dir;
  };
  make('divergent', stack('order_line'));
  make('matching', stack(OBJECT));
  make('anonymous', stack(undefined));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#20331 — os validate refuses what the boot registrar refuses, in its words', () => {
  it('premise: the boot registrar refuses the divergent stack, and accepts both controls', () => {
    // Without this, the pins below could agree with a boot loop that had
    // stopped refusing anything.
    const refusal = bootRefusal(stack('order_line'));
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.code).toBe('VALIDATION_ERROR');
    expect(bootRefusal(stack(OBJECT))).toBeUndefined();
    expect(bootRefusal(stack(undefined))).toBeUndefined();
  });

  it('THE PIN: --json exits 1 and reports the boot registrar\'s refusal, message equal to what boot throws', async () => {
    const run = await runCli(['validate', '--json'], dirs.divergent);
    const payload = payloadOf(run, 'divergent --json');
    expect(run.code).toBe(1);
    expect(payload.valid).toBe(false);
    expect(Array.isArray(payload.errors)).toBe(true);
    expect(payload.errors).toHaveLength(1);

    const boot = bootRefusal(stack('order_line'));
    const [row] = payload.errors;
    expect(row.message).toBe(boot.message);
    // The envelope boot throws with, carried onto the row.
    expect(row.code).toBe(boot.code);
    expect(row.httpStatus).toBe(boot.httpStatus);
    expect(row.path).toBe('views[0]');
  }, SPAWN_TIMEOUT_MS);

  it('the text face exits 1 and prints the same words', async () => {
    const run = await runCli(['validate'], dirs.divergent);
    expect(run.code).toBe(1);
    expect(run.stdout).not.toContain('Validation passed');
    expect(run.stdout).toContain(bootRefusal(stack('order_line')).message);
  }, SPAWN_TIMEOUT_MS);

  it('CONTROL: a container whose `name` matches its object validates', async () => {
    const run = await runCli(['validate', '--json'], dirs.matching);
    const payload = payloadOf(run, 'matching --json');
    expect(payload.valid, JSON.stringify(payload.errors ?? payload.error)).toBe(true);
    expect(run.code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('CONTROL: a container with no `name` validates — the shape boot also accepts', async () => {
    const run = await runCli(['validate', '--json'], dirs.anonymous);
    const payload = payloadOf(run, 'anonymous --json');
    expect(payload.valid, JSON.stringify(payload.errors ?? payload.error)).toBe(true);
    expect(run.code).toBe(0);
  }, SPAWN_TIMEOUT_MS);
});
