// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10] `os validate` and `os build` refuse `fieldGroups` /
 * `relatedLists` on the object extension of a package that is not a base's
 * paired `.custom`: the save and install doors' own judge
 * (`judgeExtensionArrangement`), over the walk `utils/extension-arrangement.ts`
 * takes, whose own file pins which packages it judges.
 *
 * What is pinned here is the two commands: a plain package writing
 * `fieldGroups` exits 1 from `os validate` with ONE row, located at the key
 * and prescribing `place`; `os build` answers the same rows and the same exit
 * code and writes NOTHING to `dist/`. The base's paired `.custom` writing the
 * same arrangement validates and builds, and so does the plain package placing
 * its field with `place`. Both commands run in-process (`Command.run`), not as
 * spawned CLIs.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Compile from '../src/commands/compile';
import Validate from '../src/commands/validate';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

// Pay the first transform of the dist-resolved deps `os build` reaches through
// dynamic `import()`s at MODULE LOAD, not inside a clocked case
// (`scripts/check-test-source-alias.mjs`).
import '@objectstack/objectql/core';
import '@objectstack/plugin-security';
import '@objectstack/runtime';

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

/** A package `id` extending the base's `crm_account` with one field, its extension body carrying `extra`. */
const extending = (id: string, namespace: string, field: string, extra: Record<string, unknown>): Record<string, unknown> => ({
  manifest: { id, name: 'ext', version: '1.0.0', type: 'app', namespace, dependencies: { [BASE]: '^1.0.0' } },
  objectExtensions: [{ extend: 'crm_account', fields: { [field]: { type: 'text', label: 'Region' } }, ...extra }],
});

const GROUPS = (field: string) => [{ key: 'basic', label: 'Basics', fields: ['name', field] }];
const TABS = ['crm_contact', { list: 'crm_task', hidden: true }];

let root = '';
const fixtures: Record<string, { config: string; dist: string; artifact: string }> = {};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-extension-arrangement-'));
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
  make('vendorGroups', extending('com.acme.partner', 'partner', 'region', { fieldGroups: GROUPS('region') }));
  make('vendorTabs', extending('com.acme.partner', 'partner', 'region', { relatedLists: TABS }));
  make('vendorPlace', extending('com.acme.partner', 'partner', 'region', { place: [{ field: 'region', group: 'basic' }] }));
  make('pair', extending(`${BASE}.custom`, 'crm_custom', 'region__c', { fieldGroups: GROUPS('region__c'), relatedLists: TABS }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const build = (label: string, ...flags: string[]) =>
  run(Compile, [fixtures[label].config, '--output', fixtures[label].artifact, ...flags]);
const validate = (label: string, ...flags: string[]) => run(Validate, [fixtures[label].config, ...flags]);

describe('ADR-0146 D10 — os validate and os build refuse an arrangement outside the paired `.custom` package', () => {
  it.each([
    ['vendorGroups', 'fieldGroups'],
    ['vendorTabs', 'relatedLists'],
  ])('THE PIN (%s): validate --json exits 1 with one row at `%s`, prescribing `place`; build answers the same and dist/ stays empty', async (label, key) => {
    const validated = await validate(label, '--json');
    expect(validated.code, validated.stdout).toBe(1);
    const expected = json(validated, `validate ${label}`).errors as Array<Record<string, unknown>>;
    expect(expected.map((e) => [e.path, e.code, e.key, e.packageId])).toEqual([
      [`objectExtensions[0].${key}`, 'VALIDATION_ERROR', key, 'com.acme.partner'],
    ]);
    expect(String(expected[0]!.message)).toContain('`place`');

    const built = await build(label, '--json');
    const payload = json(built, `build ${label}`);
    expect(built.code).toBe(validated.code);
    expect(payload.success).toBe(false);
    expect(payload.errors).toEqual(expected);
    expect(existsSync(fixtures[label].dist), 'os build wrote into dist/ for an artifact the doors refuse').toBe(false);
  }, 60_000);

  it('the text face exits 1 and prints the key\'s path with the refusal', async () => {
    const validated = await validate('vendorGroups');
    expect(validated.code).toBe(1);
    expect(validated.stdout).toContain('objectExtensions[0].fieldGroups [VALIDATION_ERROR]');
    expect(validated.stdout).toContain('`place`');

    const built = await build('vendorGroups');
    expect(built.code).toBe(1);
    expect(built.stdout).toContain('objectExtensions[0].fieldGroups [VALIDATION_ERROR]');
    expect(built.stdout).not.toContain('Build complete');
    expect(existsSync(fixtures.vendorGroups.dist)).toBe(false);
  }, 60_000);

  it('CONTROL: the same package placing its field with `place` validates clean and builds', async () => {
    expect((await validate('vendorPlace', '--json')).code).toBe(0);
    const built = await build('vendorPlace', '--json');
    expect(json(built, 'build vendorPlace').success, built.stdout).toBe(true);
  }, 60_000);

  it('CONTROL: the base\'s paired .custom writing both keys validates clean and builds, the keys in the artifact', async () => {
    const validated = await validate('pair', '--json');
    expect(validated.code, validated.stdout).toBe(0);
    const built = await build('pair', '--json');
    const payload = json(built, 'build pair');
    expect(payload.success, JSON.stringify(payload.errors ?? payload.error)).toBe(true);
    const artifact = JSON.parse(readFileSync(fixtures.pair.artifact, 'utf8')) as Record<string, any>;
    expect(artifact.objectExtensions[0].fieldGroups.map((g: any) => g.key)).toEqual(['basic']);
    expect(artifact.objectExtensions[0].relatedLists).toEqual(TABS);
  }, 60_000);
});
