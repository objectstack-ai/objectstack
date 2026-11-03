// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D2, #28643] `os build` asks the override write gate that `os
 * validate`, the publish doors and the managed install ask, and refuses the
 * build with the rows `os validate` prints: same rows, same exit code, and
 * NO artifact written.
 *
 * ## The defect, measured before the fix
 *
 * On a dependent package carrying `overrides: { package: 'com.acme.crm', … }`
 * (only `com.acme.crm.custom` may declare one), and on a `packages[]` stack
 * whose dependent ships a dashboard under the base's name, `os build --json`
 * exited 0 and wrote `dist/objectstack.json`, while `os validate --json`
 * exited 1 with one `NOT_OVERRIDABLE` row each. The managed install and the
 * publish doors refused that artifact later with the same judge.
 *
 * ## One judge, one walk
 *
 * `compile.ts` makes the call `validate.ts` makes
 * (`findOverrideDeclarationRefusals`, over `judgeOverrideWrite`), so the pins
 * below assert EQUALITY with what `os validate` answers for the same config,
 * run in the same process, rather than a copy of the judge's words. Both
 * commands run in-process (`Command.run`), not as spawned CLIs.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Compile from '../src/commands/compile';
import Validate from '../src/commands/validate';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const BASE = 'com.acme.crm';

interface Run {
  /** The exit code `this.exit(n)` threw, or 0 when the command returned. */
  code: number;
  stdout: string;
}

/** Runs one command in-process; stdout captured ANSI-free, the write callback honoured. */
async function run(command: typeof Compile | typeof Validate, argv: string[]): Promise<Run> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const done = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    done?.(null);
    return true;
  }) as never);
  const exitCodeBefore = process.exitCode;
  let code = 0;
  try {
    await command.run(argv, { root: CLI_ROOT });
  } catch (error) {
    const exit = (error as { oclif?: { exit?: unknown } }).oclif?.exit;
    if (typeof exit !== 'number') throw error;
    code = exit;
  } finally {
    spy.mockRestore();
    process.exitCode = exitCodeBefore;
  }
  // eslint-disable-next-line no-control-regex
  return { code, stdout: chunks.join('').replace(/\u001b\[[0-9;]*m/g, '') };
}

const json = (r: Run, label: string): Record<string, any> => {
  try {
    return JSON.parse(r.stdout) as Record<string, any>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${r.code})\n${r.stdout}`);
  }
};

const dashboard = (name: string, extra: Record<string, unknown> = {}) => ({ name, label: 'Board', widgets: [], ...extra });

/** A single-package stack declaring an override of the base's dashboard. */
const declaring = (id: string): Record<string, unknown> => ({
  manifest: { id, name: 'ovr', version: '1.0.0', type: 'app', namespace: 'ovr', dependencies: { [BASE]: '^1.0.0' } },
  dashboards: [dashboard('crm_board', { overrides: { package: BASE, basedOn: '1.0.0' } })],
});

/** A `packages[]` stack whose dependent ships the base's dashboard name, undeclared. */
const undeclaredSameName = (): Record<string, unknown> => ({
  manifest: { id: 'com.acme.bundle', name: 'bundle', version: '1.0.0', type: 'app' },
  packages: [
    { manifest: { id: BASE, name: 'crm', version: '1.0.0', type: 'app', dashboards: [dashboard('crm_board')] } },
    {
      manifest: {
        id: 'com.acme.partner', name: 'partner', version: '1.0.0', type: 'app',
        dependencies: { [BASE]: '^1.0.0' }, dashboards: [dashboard('crm_board')],
      },
    },
  ],
});

let root = '';
const fixtures: Record<string, { config: string; artifact: string }> = {};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-build-override-declarations-'));
  const make = (label: string, s: Record<string, unknown>) => {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    // `strict: false`: the content is the door's to judge, not the producer's.
    writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource(s, { strict: false }));
    linkSpec(dir);
    fixtures[label] = { config: join(dir, 'objectstack.config.ts'), artifact: join(dir, 'dist', 'objectstack.json') };
  };
  make('partner', declaring('com.acme.partner'));
  make('undeclared', undeclaredSameName());
  make('pair', declaring('com.acme.crm.custom'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const build = (label: string, ...flags: string[]) =>
  run(Compile, [fixtures[label].config, '--output', fixtures[label].artifact, ...flags]);
const validate = (label: string, ...flags: string[]) => run(Validate, [fixtures[label].config, ...flags]);

describe('#28643 — os build refuses what os validate refuses under the override write gate, and ships nothing', () => {
  it.each(['partner', 'undeclared'])('THE PIN (%s): --json exits as validate does, with validate\'s rows, and writes no artifact', async (label) => {
    const validated = await validate(label, '--json');
    expect(validated.code, validated.stdout).toBe(1);
    const expected = json(validated, `validate ${label}`).errors as Array<Record<string, unknown>>;
    // Anti-vacuity: the judge refuses this config, under the override gate.
    expect(expected.map((e) => e.code)).toEqual(['NOT_OVERRIDABLE']);

    const built = await build(label, '--json');
    const payload = json(built, `build ${label}`);
    expect(built.code).toBe(validated.code);
    expect(payload.success).toBe(false);
    expect(payload.errors).toEqual(expected);
    expect(existsSync(fixtures[label].artifact), 'os build wrote an artifact the publish door refuses').toBe(false);
  }, 60_000);

  it('the text face exits 1 and prints the refusal block os validate prints', async () => {
    const validated = await validate('undeclared');
    expect(validated.code).toBe(1);
    const block = validated.stdout.slice(validated.stdout.indexOf('✗ The publish door would refuse')).trimEnd();
    expect(block).toContain('[NOT_OVERRIDABLE]');

    const built = await build('undeclared');
    expect(built.code).toBe(1);
    expect(built.stdout).toContain(block);
    expect(built.stdout).not.toContain('Build complete');
    expect(existsSync(fixtures.undeclared.artifact)).toBe(false);
  }, 60_000);

  it('CONTROL: the base\'s paired .custom declaring the same override builds, and validates clean', async () => {
    expect((await validate('pair', '--json')).code).toBe(0);
    const built = await build('pair', '--json');
    const payload = json(built, 'build pair');
    expect(payload.success, JSON.stringify(payload.errors ?? payload.error)).toBe(true);
    expect(built.code).toBe(0);
    const artifact = JSON.parse(readFileSync(fixtures.pair.artifact, 'utf8')) as Record<string, any>;
    expect(artifact.dashboards.map((d: { name: string }) => d.name)).toEqual(['crm_board']);
  }, 60_000);
});
