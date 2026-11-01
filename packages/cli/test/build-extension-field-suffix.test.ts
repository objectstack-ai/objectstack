// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, #28727] `os build` asks the `__c` extension-field
 * reservation that `os validate`, the save, restore and publish doors and the
 * marketplace install ask, and refuses the build with the rows `os validate`
 * prints: same rows, same exit code, and NOTHING written to `dist/`.
 *
 * ## The defect, measured before the fix
 *
 * On a plain package declaring a field `x__c` on its own object (case (a)),
 * and on a base's paired `.custom` extending a base object with a field
 * `region` that lacks the suffix (case (b)), `os build --json` exited 0 and
 * wrote `dist/objectstack.json`, while `os validate --json` exited 1 with one
 * `VALIDATION_ERROR` row each. The marketplace install and the save and
 * publish doors refused that artifact later with the same judge.
 *
 * ## One judge, one walk
 *
 * `compile.ts` makes the call `validate.ts` makes
 * (`findExtensionFieldSuffixRefusals`, over `judgeExtensionFieldSuffix`), so
 * the pins below assert EQUALITY with what `os validate` answers for the same
 * config, run in the same process, rather than a copy of the judge's words.
 * Which packages the walk judges is pinned by its own file
 * (`src/utils/extension-field-suffix.test.ts`). Both commands run in-process
 * (`Command.run`), not as spawned CLIs.
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

/** Case (a): a plain package declaring `x__c` on its own object. */
const plainOwnField = (): Record<string, unknown> => ({
  manifest: { id: 'com.acme.partner', name: 'partner', version: '1.0.0', type: 'app', namespace: 'partner' },
  objects: [
    {
      name: 'partner_ticket',
      label: 'Ticket',
      fields: { title: { type: 'text', label: 'Title' }, x__c: { type: 'text', label: 'X' } },
    },
  ],
});

/** The base's paired `.custom` extending the base's `crm_account` with one field named `field`. */
const pairExtension = (field: string): Record<string, unknown> => ({
  manifest: {
    id: `${BASE}.custom`, name: 'ext', version: '1.0.0', type: 'app', namespace: 'crm_custom',
    dependencies: { [BASE]: '^1.0.0' },
  },
  objectExtensions: [{ extend: 'crm_account', fields: { [field]: { type: 'text', label: 'Region' } } }],
});

let root = '';
const fixtures: Record<string, { config: string; dist: string; artifact: string }> = {};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-build-extension-field-suffix-'));
  const make = (label: string, s: Record<string, unknown>) => {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    // `strict: false`: the content is the door's to judge, not the producer's.
    writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource(s, { strict: false }));
    linkSpec(dir);
    fixtures[label] = {
      config: join(dir, 'objectstack.config.ts'),
      dist: join(dir, 'dist'),
      artifact: join(dir, 'dist', 'objectstack.json'),
    };
  };
  make('plainOwnField', plainOwnField());
  make('pairPlain', pairExtension('region'));
  make('pairSuffixed', pairExtension('region__c'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const build = (label: string, ...flags: string[]) =>
  run(Compile, [fixtures[label].config, '--output', fixtures[label].artifact, ...flags]);
const validate = (label: string, ...flags: string[]) => run(Validate, [fixtures[label].config, ...flags]);

describe('#28727 — os build refuses what os validate refuses under the `__c` reservation, and writes nothing', () => {
  it.each([
    ['plainOwnField', 'reserved_outside_pair', 'objects'],
    ['pairPlain', 'unsuffixed_in_pair', 'objectExtensions'],
  ])('THE PIN (%s): --json exits as validate does, with validate\'s rows, and dist/ stays empty', async (label, rule, at) => {
    const validated = await validate(label, '--json');
    expect(validated.code, validated.stdout).toBe(1);
    const expected = json(validated, `validate ${label}`).errors as Array<Record<string, unknown>>;
    // Anti-vacuity: the judge refuses this config, under the case it names.
    expect(expected.map((e) => [e.code, e.rule])).toEqual([['VALIDATION_ERROR', rule]]);
    expect(String(expected[0]!.path).startsWith(at)).toBe(true);

    const built = await build(label, '--json');
    const payload = json(built, `build ${label}`);
    expect(built.code).toBe(validated.code);
    expect(payload.success).toBe(false);
    expect(payload.errors).toEqual(expected);
    expect(existsSync(fixtures[label].dist), 'os build wrote into dist/ for an artifact the doors refuse').toBe(false);
  }, 60_000);

  it('the text face exits 1 and prints the refusal block os validate prints', async () => {
    const validated = await validate('pairPlain');
    expect(validated.code).toBe(1);
    const block = validated.stdout.slice(validated.stdout.indexOf('✗ 1 field breaks the')).trimEnd();
    expect(block).toContain('objectExtensions[0].fields.region [VALIDATION_ERROR]');

    const built = await build('pairPlain');
    expect(built.code).toBe(1);
    expect(built.stdout).toContain(block);
    expect(built.stdout).not.toContain('Build complete');
    expect(existsSync(fixtures.pairPlain.dist)).toBe(false);
  }, 60_000);

  it('CONTROL: the base\'s paired .custom extending with `region__c` builds, and validates clean', async () => {
    expect((await validate('pairSuffixed', '--json')).code).toBe(0);
    const built = await build('pairSuffixed', '--json');
    const payload = json(built, 'build pairSuffixed');
    expect(payload.success, JSON.stringify(payload.errors ?? payload.error)).toBe(true);
    expect(built.code).toBe(0);
    const artifact = JSON.parse(readFileSync(fixtures.pairSuffixed.artifact, 'utf8')) as Record<string, any>;
    expect(Object.keys(artifact.objectExtensions[0].fields)).toEqual(['region__c']);
  }, 60_000);
});
