// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1] `os validate` and `os build` refuse a stack whose
 * namespace spells a literal segment of the address grammar (`hooks`,
 * `trigger`, …): same rows, exit 1, and NOTHING written to `dist/`. The
 * install door refuses such a namespace already; before these calls the two
 * commands passed it and `os build` wrote the artifact.
 *
 * The rows are asserted EQUAL to the spec's judge
 * (`validateNamespaceNotAddressLiteral`) for the same namespace. Which
 * namespaces the walk judges is pinned by its own file
 * (`src/utils/namespace-address-literals.test.ts`). Both commands run
 * in-process (`Command.run`), not as spawned CLIs.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Compile from '../src/commands/compile';
import Validate from '../src/commands/validate';
import { validateNamespaceNotAddressLiteral } from '@objectstack/spec/kernel';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

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

const stack = (namespace: string): Record<string, unknown> => ({
  manifest: { id: `com.acme.${namespace}`, name: namespace, version: '1.0.0', type: 'app', namespace },
  objects: [
    {
      name: `${namespace}_ticket`,
      label: 'Ticket',
      sharingModel: 'private',
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
});

let root = '';
const fixtures: Record<string, { config: string; dist: string; artifact: string }> = {};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-build-namespace-address-literal-'));
  for (const namespace of ['hooks', 'triggers']) {
    const dir = join(root, namespace);
    mkdirSync(dir, { recursive: true });
    // `strict: false`: the namespace is the commands' to judge, not the producer's.
    writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource(stack(namespace), { strict: false }));
    linkSpec(dir);
    fixtures[namespace] = {
      config: join(dir, 'objectstack.config.ts'),
      dist: join(dir, 'dist'),
      artifact: join(dir, 'dist', 'objectstack.json'),
    };
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const build = (label: string, ...flags: string[]) =>
  run(Compile, [fixtures[label].config, '--output', fixtures[label].artifact, ...flags]);
const validate = (label: string, ...flags: string[]) => run(Validate, [fixtures[label].config, ...flags]);

describe('os validate / os build refuse an address-literal namespace', () => {
  it('THE PIN: --json exits 1 on both with the judge\'s row, and dist/ stays empty', async () => {
    const expected = [{ namespace: 'hooks', packageId: 'com.acme.hooks', message: validateNamespaceNotAddressLiteral('hooks') }];
    expect(expected[0]!.message).not.toBeNull();

    const validated = await validate('hooks', '--json');
    expect(validated.code, validated.stdout).toBe(1);
    expect(json(validated, 'validate hooks').errors).toEqual(expected);

    const built = await build('hooks', '--json');
    const payload = json(built, 'build hooks');
    expect(built.code).toBe(1);
    expect(payload.success).toBe(false);
    expect(payload.errors).toEqual(expected);
    expect(existsSync(fixtures.hooks.dist), 'os build wrote into dist/ for a namespace the install door refuses').toBe(false);
  }, 60_000);

  it('the text face exits 1 on both and names the literal and the rename remedy', async () => {
    for (const r of [await validate('hooks'), await build('hooks')]) {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("Namespace 'hooks' spells a literal segment of the address grammar");
      expect(r.stdout).toContain('Choose another namespace.');
      expect(r.stdout).not.toContain('Build complete');
    }
    expect(existsSync(fixtures.hooks.dist)).toBe(false);
  }, 60_000);

  it('CONTROL: `triggers` validates clean and builds', async () => {
    expect((await validate('triggers', '--json')).code).toBe(0);
    const built = await build('triggers', '--json');
    const payload = json(built, 'build triggers');
    expect(payload.success, JSON.stringify(payload.errors ?? payload.error)).toBe(true);
    expect(built.code).toBe(0);
    expect(JSON.parse(readFileSync(fixtures.triggers.artifact, 'utf8')).manifest.namespace).toBe('triggers');
  }, 60_000);
});
