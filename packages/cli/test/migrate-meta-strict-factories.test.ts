// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` over objects built with a STRICT AUTHORING FACTORY —
 * `ObjectSchema.create(…)` and its siblings — and the one list the
 * authored-source shim wraps them from (`STRICT_AUTHORING_FACTORIES`).
 *
 * ## The defect
 *
 * The shim wrapped only `define*` exports. `ObjectSchema.create(…)` parses at
 * the call, so an object carrying a retired key threw while the config module
 * was being evaluated — inside `defineStack`'s argument, before the wrapped
 * `defineStack` was ever called — and the command exited 1 at load with a raw
 * `ZodError` array. The tombstone in that array prescribes `os migrate meta`,
 * the command that had just refused. The same object written as a plain
 * literal migrated cleanly.
 *
 * ## What is pinned, and how
 *
 *  1. The card's repro migrates: the conversion applies, `schemaValid: true`.
 *  2. The plain-literal control is unchanged, and the factory spelling now
 *     reaches the SAME applied edits as the literal.
 *  3. An unrelated strict error still surfaces as a refusal — in the report's
 *     verdict group, rendered — and never as a raw `ZodError` array, on any
 *     stream. The retired key beside it is still converted.
 *  4. Every listed factory is tolerated through the shim, the owner's other
 *     members pass through untouched, and a load WITHOUT the shim still
 *     refuses: the tolerance is the codemod's alone.
 *  5. The list itself: every entry is live at its `home` and strict, and every
 *     `create` member spec exports that is not listed returns its argument
 *     untouched — so a new strict factory reddens this pin by name.
 *
 * In-process over the real command (`MigrateMeta.run`), against a temp project
 * that links the real `@objectstack/spec`: the config load, the shim, the chain
 * and the verdict are the ones the CLI runs. No process is spawned and no
 * kernel is booted, so this file sits in the `unit` tier.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import MigrateMeta from '../src/commands/migrate/meta.js';
import { loadConfig, STRICT_AUTHORING_FACTORIES } from '../src/utils/config.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const RUN_TIMEOUT = 120_000;

/**
 * Resolved through node_modules rather than by walking up from this file:
 * `packages/cli` already depends on `@objectstack/spec`, so the dependency is
 * one turbo already knows about, and a package specifier is not a
 * cross-package source read.
 */
const requireFromCli = createRequire(import.meta.url);
const SPEC_PACKAGE_ROOT = dirname(requireFromCli.resolve('@objectstack/spec/package.json'));

/** A raw `ZodError` array as `ZodError.message` spells it: `[ { "code": "…" … } ]`. */
const RAW_ZOD_ARRAY = /"code":\s*"/;

/** The card's repro, verbatim in shape: the object is built by the factory. */
const FACTORY_REPRO = `
import { defineStack } from '@objectstack/spec';
import { ObjectSchema } from '@objectstack/spec/data';

export default defineStack({
  objects: [ObjectSchema.create({
    name: 'cr_ticket',
    label: 'Ticket',
    fields: { title: { type: 'text', label: 'Title' } },
    tenancy: { enabled: true, organizationField: 'organization_id' },
  })],
});
`;

/** The card's control: the same object as a plain literal. */
const LITERAL_CONTROL = `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  objects: [{
    name: 'cr_ticket',
    label: 'Ticket',
    fields: { title: { type: 'text', label: 'Title' } },
    tenancy: { enabled: true, organizationField: 'organization_id' },
  }],
});
`;

/** The repro plus a strict error no conversion repairs: an unknown field type. */
const FACTORY_UNRELATED_ERROR = `
import { defineStack } from '@objectstack/spec';
import { ObjectSchema } from '@objectstack/spec/data';

export default defineStack({
  objects: [ObjectSchema.create({
    name: 'cr_ticket',
    label: 'Ticket',
    fields: {
      title: { type: 'text', label: 'Title' },
      stage: { type: 'dropdown', label: 'Stage' },
    },
    tenancy: { enabled: true, organizationField: 'organization_id' },
  })],
});
`;

/**
 * Every listed factory, called with an argument its schema refuses, generated
 * FROM the list so a new entry is covered the day it is added. Each call names
 * itself in its probe, so a result can be matched to its factory. The last key
 * reads another member of `ObjectSchema` through the shim's Proxy.
 */
function everyFactoryConfig(): string {
  const byHome = new Map<string, string[]>();
  for (const { owner, home } of STRICT_AUTHORING_FACTORIES) {
    const owners = byHome.get(home) ?? [];
    if (!owners.includes(owner)) owners.push(owner);
    byHome.set(home, owners);
  }
  const imports = [...byHome].map(([home, owners]) => `import { ${owners.join(', ')} } from '${home}';`);
  const calls = STRICT_AUTHORING_FACTORIES.map(
    ({ owner, member }) => `    ${owner}.${member}({ __strict_probe__: '${owner}.${member}' }),`,
  );
  return [
    ...imports,
    // A second, aliased binding of the same export, so the member read below
    // never depends on which owners the list happens to name.
    "import { ObjectSchema as __ObjectSchemaMembers } from '@objectstack/spec/data';",
    '',
    'export default {',
    '  results: [',
    ...calls,
    '  ],',
    "  untouched: typeof __ObjectSchemaMembers.safeParse === 'function'",
    "    && __ObjectSchemaMembers.safeParse({ name: 'sf_ok', fields: {} }).success,",
    '};',
    '',
  ].join('\n');
}

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

let root: string;
let specLink: string;
let caseSeq = 0;

/** Write `source` as the config of a fresh case directory under the temp project. */
function writeCase(source: string): string {
  const dir = join(root, `case-${++caseSeq}`);
  mkdirSync(dir);
  const configPath = join(dir, 'objectstack.config.ts');
  writeFileSync(configPath, source);
  return configPath;
}

/** Run the real command in-process, capturing both streams and any exit. */
async function runMeta(configPath: string, flags: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const priorExitCode = process.exitCode;
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    out.push(String(chunk));
    const done = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    done?.();
    return true;
  }) as never);
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  let exitCode: number | undefined;
  try {
    await MigrateMeta.run([configPath, '--from', '17', ...flags], { root: CLI_ROOT });
  } catch (e: any) {
    if (typeof e?.oclif?.exit !== 'number') throw e;
    exitCode = e.oclif.exit;
  } finally {
    write.mockRestore();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    if (exitCode === undefined && typeof process.exitCode === 'number' && process.exitCode !== 0) {
      exitCode = process.exitCode;
    }
    process.exitCode = priorExitCode;
  }
  return {
    stdout: stripVTControlCharacters(out.join('\n')),
    stderr: stripVTControlCharacters(err.join('\n')),
    exitCode,
  };
}

function applied(run: Run): Array<{ conversionId: string; path: string }> {
  const payload = JSON.parse(run.stdout);
  expect(Array.isArray(payload.applied), `no \`applied\` in the --json payload: ${run.stdout}`).toBe(true);
  return payload.applied.map((a: any) => ({ conversionId: a.conversionId, path: a.path }));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-migrate-meta-strict-factories-'));
  mkdirSync(join(root, 'node_modules', '@objectstack'), { recursive: true });
  specLink = join(root, 'node_modules', '@objectstack', 'spec');
  symlinkSync(SPEC_PACKAGE_ROOT, specLink, 'dir');
});

afterAll(() => {
  // Unlinked BEFORE the recursive remove, and named explicitly: this symlink
  // points at the real `packages/spec`, and a cleanup must never be able to
  // follow it.
  try { unlinkSync(specLink); } catch { /* already gone */ }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('os migrate meta over an object built with ObjectSchema.create', () => {
  const RETIRED = { conversionId: 'object-tenancy-organization-field-removed', path: 'objects[0].tenancy.organizationField' };

  it("migrates the card's repro: the conversion applies and the migrated stack is schema-valid", async () => {
    const run = await runMeta(writeCase(FACTORY_REPRO), ['--json']);

    expect(run.exitCode, run.stderr).toBeUndefined();
    const payload = JSON.parse(run.stdout);
    expect(applied(run)).toContainEqual(RETIRED);
    expect(payload.schemaValid).toBe(true);
    // The swallowed verdict is announced, by factory name, and rendered.
    expect(run.stderr).toContain('[authored-source] ObjectSchema.create(): the current schema refuses this artifact');
    expect(run.stderr).not.toMatch(RAW_ZOD_ARRAY);
  }, RUN_TIMEOUT);

  it('leaves the plain-literal control unchanged — and the factory spelling now matches it', async () => {
    const literal = await runMeta(writeCase(LITERAL_CONTROL), ['--json']);
    const factory = await runMeta(writeCase(FACTORY_REPRO), ['--json']);

    expect(literal.exitCode, literal.stderr).toBeUndefined();
    expect(applied(literal)).toContainEqual(RETIRED);
    expect(JSON.parse(literal.stdout).schemaValid).toBe(true);
    // No factory was called, so the shim had nothing of the factory's to say.
    expect(literal.stderr).not.toContain('ObjectSchema.create');

    expect(applied(factory)).toEqual(applied(literal));
  }, RUN_TIMEOUT);

  it('surfaces an unrelated strict error as a refusal, never as a raw ZodError array', async () => {
    const configPath = writeCase(FACTORY_UNRELATED_ERROR);
    const json = await runMeta(configPath, ['--json']);
    const human = await runMeta(configPath, []);

    // The load no longer aborts: the retired key is converted…
    expect(json.exitCode, json.stderr).toBeUndefined();
    expect(applied(json)).toContainEqual(RETIRED);
    // …and what the chain cannot repair is the verdict, not a crash.
    expect(JSON.parse(json.stdout).schemaValid).toBe(false);

    expect(human.exitCode, human.stderr).toBeUndefined();
    expect(human.stdout).toMatch(/does not yet pass schema validation — 1 refusal left after the chain/);
    expect(human.stdout).toMatch(/✗ objects\.0\.fields\.stage\.type: /);
    // The one refusal is the unrelated one; the retired key is not among them.
    expect(human.stdout).not.toMatch(/✗ objects\.0\.tenancy/);

    for (const stream of [json.stdout, json.stderr, human.stdout, human.stderr]) {
      expect(stream).not.toMatch(RAW_ZOD_ARRAY);
    }
  }, RUN_TIMEOUT);
});

describe('STRICT_AUTHORING_FACTORIES — the one list the shim wraps', () => {
  it('tolerates every listed factory through the shim, and only through the shim', async () => {
    const configPath = writeCase(everyFactoryConfig());

    const warnings: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warnings.push(a.join(' ')); });
    let loaded;
    try {
      loaded = await loadConfig(configPath, { authoredSource: true });
    } finally {
      warn.mockRestore();
    }

    // Each refused call is handed on exactly as authored…
    expect(loaded.config.results).toEqual(
      STRICT_AUTHORING_FACTORIES.map(({ owner, member }) => ({ __strict_probe__: `${owner}.${member}` })),
    );
    // …and announced once, by its own name.
    for (const { owner, member } of STRICT_AUTHORING_FACTORIES) {
      expect(warnings.filter((w) => w.startsWith(`[authored-source] ${owner}.${member}(): `))).toHaveLength(1);
    }
    // The owner is still the real schema for every other member.
    expect(loaded.config.untouched).toBe(true);

    // Without the shim the same source is refused at load, as every other
    // command must keep hearing it.
    await expect(loadConfig(configPath)).rejects.toThrow();
  }, RUN_TIMEOUT);

  it('lists only live, strict factories, and every unlisted spec `create` is an identity factory', async () => {
    const spec = requireFromCli('@objectstack/spec/package.json') as { exports: Record<string, unknown> };
    const entrypoints = Object.keys(spec.exports)
      .filter((key) => !key.endsWith('.json'))
      .map((key) => (key === '.' ? '@objectstack/spec' : `@objectstack/spec/${key.slice(2)}`));

    const strictFound = new Set<string>();
    const identity: string[] = [];
    const neither: string[] = [];
    for (const entrypoint of entrypoints) {
      const ns = (await import(pathToFileURL(requireFromCli.resolve(entrypoint)).href)) as Record<string, unknown>;
      for (const [owner, value] of Object.entries(ns)) {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) continue;
        // By property, never by enumerating the owner — see the list's docblock.
        const create = (value as { create?: unknown }).create;
        if (typeof create !== 'function') continue;
        const listed = STRICT_AUTHORING_FACTORIES.some((f) => f.owner === owner && f.member === 'create');
        const probe = { __strict_probe__: `${entrypoint}#${owner}.create` };
        let threw = false;
        let returned: unknown;
        try {
          returned = create.call(value, probe);
        } catch {
          threw = true;
        }
        if (listed && threw) strictFound.add(owner);
        else if (!listed && !threw && returned === probe) identity.push(`${entrypoint}#${owner}`);
        else neither.push(`${entrypoint}#${owner}.create (listed: ${listed}, threw: ${threw})`);
      }
    }

    // A strict factory spec exports but the list does not name — or a listed
    // one that stopped refusing — lands here by name.
    expect(neither, 'add a strict `create` to STRICT_AUTHORING_FACTORIES, or drop an entry that no longer refuses').toEqual([]);
    // The enumeration is not vacuous: it found every listed owner, strict…
    expect([...strictFound].sort()).toEqual(
      [...new Set(STRICT_AUTHORING_FACTORIES.filter((f) => f.member === 'create').map((f) => f.owner))].sort(),
    );
    // …and at least one identity factory to tell them apart from.
    expect(identity.length).toBeGreaterThan(0);

    // Every entry is live at the entrypoint it names.
    for (const { owner, member, home } of STRICT_AUTHORING_FACTORIES) {
      const ns = (await import(pathToFileURL(requireFromCli.resolve(home)).href)) as Record<string, any>;
      expect(typeof ns[owner]?.[member], `${home}#${owner}.${member}`).toBe('function');
      expect(() => ns[owner][member]({ __strict_probe__: home }), `${home}#${owner}.${member}`).toThrow();
    }
  }, RUN_TIMEOUT);
});
