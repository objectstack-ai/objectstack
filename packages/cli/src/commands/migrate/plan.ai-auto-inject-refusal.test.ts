// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExitSignal } from '../../utils/format.js';
import MigratePlan from './plan.js';
import MigrateApply from './apply.js';
import MigrateOrganizationOwnership from './organization-ownership.js';

// Pay the first transform of the dist-resolved workspace deps the commands
// reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/plugin-auth';
import '@objectstack/plugin-security';

/**
 * `os migrate plan` / `apply` and the organization-ownership ceremony compose
 * what `os serve` mounts around a stack (`composeServedPlatform`). `serve`
 * auto-injects `@objectstack/service-ai` when the config mounts no AI plugin
 * and declares `requires: ['ai']` (or `['ai-studio']`), or when the app's
 * `package.json` declares the package, unless the `ai` tier is off. The
 * migrate commands compose no AI plugin, so on such a host they plan without
 * the `ai_*` tables `serve` would declare.
 *
 * Ruled B (the maintainer's 「以上都同意」, recorded on the card): the
 * migrate commands refuse that config, naming the reason and the remedy —
 * mount the AI plugin explicitly in the config — through the one predicate
 * `serve` itself reads (`resolveAiServiceLoad`).
 *
 * Controls: a config that mounts the AI plugin explicitly, a config whose
 * `ai` tier is off, and a config that asks for no AI, all plan as before.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;
const REMEDY = /mount the AI plugin explicitly in the config/;

const ENV_KEYS = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ARTIFACT_PATH', 'NODE_ENV',
] as const;

type Invoke = (argv: string[]) => Promise<unknown>;
const invoke = (command: { run: (argv: string[], opts: { root: string }) => Promise<unknown> }): Invoke =>
  (argv) => command.run(argv, { root: CLI_ROOT });

/** Run a command with stdout captured, its exits trapped, and its JSON document parsed. */
async function runJson(command: Invoke, argv: string[]): Promise<{ payload: any; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  let thrownExit: number | undefined;
  try {
    try {
      await command(argv);
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    // The boot's log lines share stdout with the document on some paths: the
    // document is the last whole line that parses as a JSON object.
    let payload: any = { unparsed: out.slice(-400) };
    for (const line of out.split('\n').reverse()) {
      if (!line.startsWith('{')) continue;
      try {
        payload = JSON.parse(line);
        break;
      } catch { /* a log fragment */ }
    }
    if (payload.unparsed !== undefined) {
      try { payload = JSON.parse(out); } catch { /* left unparsed */ }
    }
    return { payload, exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
let savedCwd: string;

/**
 * A config-only project. `config` is the config's extra keys, as source text;
 * `dependencies` is the app's own `package.json` dependencies.
 */
function project(config: string[], dependencies: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-31411-ai-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    [
      'export default {',
      "  manifest: { id: 'com.example.os31411ai', name: 'ai', version: '0.0.0', type: 'app' },",
      "  objects: [{ name: 'os31411_thing', fields: { title: { type: 'text' } } }],",
      ...config.map((line) => `  ${line}`),
      '};',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'os31411-ai-host', version: '0.0.0', private: true, dependencies }, null, 2)}\n`,
  );
  return dir;
}

/** Enter the fixture as the operator's shell would. */
function enter(dir: string): void {
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  process.env.OS_DATABASE_URL = `file:${join(dir, 'app.db')}`;
  process.chdir(dir);
}

/** The AI plugin, mounted explicitly: `serve` reads it by its registered name. */
const EXPLICIT_AI_PLUGIN =
  "plugins: [{ name: 'com.objectstack.service-ai', version: '0.0.0', init: async () => {}, start: async () => {} }],";

beforeAll(() => {
  savedCwd = process.cwd();
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  process.chdir(savedCwd);
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe('os migrate refuses a config that relies on serve\'s AI auto-inject', () => {
  it('⭐ requires: [ai] and no AI plugin: plan and apply refuse, naming the reason and the remedy', async () => {
    enter(project(["requires: ['ai'],"]));

    const plan = await runJson(invoke(MigratePlan), ['--json']);
    expect(plan.exitCode, JSON.stringify(plan.payload).slice(0, 400)).toBe(1);
    expect(plan.payload.error).toMatch(/requires/);
    expect(plan.payload.error).toMatch(/@objectstack\/service-ai/);
    expect(plan.payload.error).toMatch(REMEDY);

    const apply = await runJson(invoke(MigrateApply), ['--json']);
    expect(apply.exitCode, JSON.stringify(apply.payload).slice(0, 400)).toBe(1);
    expect(apply.payload.error, JSON.stringify(apply.payload).slice(0, 600)).toMatch(REMEDY);
  }, CASE_TIMEOUT_MS);

  it('⭐ the app\'s package.json declares @objectstack/service-ai and the config mounts no AI plugin: plan refuses', async () => {
    enter(project([], { '@objectstack/service-ai': '*' }));

    const plan = await runJson(invoke(MigratePlan), ['--json']);
    expect(plan.exitCode, JSON.stringify(plan.payload).slice(0, 400)).toBe(1);
    expect(plan.payload.error, JSON.stringify(plan.payload).slice(0, 600)).toMatch(/package\.json/);
    expect(plan.payload.error).toMatch(REMEDY);
  }, CASE_TIMEOUT_MS);

  it('⭐ the organization-ownership ceremony\'s --apply refuses the same config at its boot', async () => {
    const dir = project(["requires: ['ai-studio'],"]);
    enter(dir);
    // A well-formed plan file: the refusal comes at the boot, before any plan is compared.
    const planFile = join(dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({
      kind: 'organization-ownership-plan', ceremony: 'ADR-0131 D10', inventoryDigest: 'sha256:fixture',
      database: join(dir, 'app.db'), generatedAt: '2026-11-08T00:00:00.000Z', posture: 'single',
    }));

    const ceremony = await runJson(
      invoke(MigrateOrganizationOwnership),
      ['--apply', '--backup-taken', '--plan-file', planFile, '--out', join(dir, 'apply.json'), '--json'],
    );
    expect(ceremony.exitCode, JSON.stringify(ceremony.payload).slice(0, 400)).toBe(1);
    expect(ceremony.payload, JSON.stringify(ceremony.payload).slice(0, 600)).toMatchObject({ reason: 'boot-failed', detail: expect.stringMatching(REMEDY) });
  }, CASE_TIMEOUT_MS);

  it('control: the AI plugin mounted explicitly plans as before', async () => {
    enter(project(["requires: ['ai'],", EXPLICIT_AI_PLUGIN], { '@objectstack/service-ai': '*' }));

    const plan = await runJson(invoke(MigratePlan), ['--json']);
    expect(plan.exitCode, JSON.stringify(plan.payload).slice(0, 400)).toBe(0);
    expect(plan.payload.error).toBeUndefined();
  }, CASE_TIMEOUT_MS);

  it('control: the ai tier off — serve injects nothing for a declared dependency — plans as before', async () => {
    enter(project(["tiers: ['core', 'i18n', 'ui', 'auth'],"], { '@objectstack/service-ai': '*' }));

    const plan = await runJson(invoke(MigratePlan), ['--json']);
    expect(plan.exitCode, JSON.stringify(plan.payload).slice(0, 400)).toBe(0);
    expect(plan.payload.error).toBeUndefined();
  }, CASE_TIMEOUT_MS);

  it('control: a config that asks for no AI plans as before', async () => {
    enter(project([]));

    const plan = await runJson(invoke(MigratePlan), ['--json']);
    expect(plan.exitCode, JSON.stringify(plan.payload).slice(0, 400)).toBe(0);
    expect(plan.payload.error).toBeUndefined();
  }, CASE_TIMEOUT_MS);
});
