// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExitSignal } from '../../utils/format.js';
import MigratePlan from './plan.js';

// Pay the first transform of the dist-resolved workspace deps the command
// reaches through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/plugin-auth';
import '@objectstack/plugin-security';
import '@objectstack/metadata-protocol';
import '@objectstack/platform-objects/plugin';
import '@objectstack/platform-objects/system';
import '@objectstack/rest';
import '@objectstack/service-datasource';
import '@objectstack/service-knowledge';
import '@objectstack/driver-sql';
import '@objectstack/driver-turso';

/**
 * [ADR-0161 K8 item 12] An artifact-only stack (`dist/objectstack.json`, no
 * `objectstack.config.ts`) that ships a `knowledge_source` and lists no
 * `requires: ['knowledge']`: `os serve` lays the standalone stack's result over
 * the (empty) config and mounts KnowledgeServicePlugin for the item. `os
 * migrate plan` boots the same artifact and must compose the same set — the
 * knowledge service among "what `os serve` mounts" — or it plans a different
 * platform and its own boot warns that the source is unserved.
 *
 * Control: the same artifact with no source composes no knowledge service.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;
const UNSERVED = /knowledge_source item.*no 'knowledge' service is registered/;

const ENV_KEYS = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ARTIFACT_PATH', 'NODE_ENV',
] as const;

/** Run `os migrate plan --json` with every output channel captured, and its JSON document parsed. */
async function plan(): Promise<{ payload: any; exitCode: number; said: string }> {
  const savedExit = process.exitCode;
  const heard: string[] = [];
  const capture = ((chunk: unknown, ...rest: unknown[]) => {
    heard.push(String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  for (const level of ['error', 'log', 'warn', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { heard.push(args.map(String).join(' ')); });
  }
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  let thrownExit: number | undefined;
  try {
    try {
      await MigratePlan.run(['--json'], { root: CLI_ROOT });
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    // The document is the last whole line that parses as a JSON object.
    let payload: any = { unparsed: out.slice(-400) };
    for (const line of out.split('\n').reverse()) {
      if (!line.startsWith('{')) continue;
      try {
        payload = JSON.parse(line);
        break;
      } catch { /* a log fragment */ }
    }
    return {
      payload,
      exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0,
      said: heard.join('\n'),
    };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
let savedCwd: string;

const SOURCE = { name: 'notes', label: 'Notes', source: { kind: 'object', object: 'os38062_note', content: ['title'] } };

/** An artifact-only project: `dist/objectstack.json` and no config. */
function artifactProject(extra: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-38062-artifact-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify({
    manifest: { id: 'com.example.os38062', name: 'artifact item mount', version: '0.0.0', type: 'app' },
    objects: [{ name: 'os38062_note', label: 'Note', fields: { title: { type: 'text' } } }],
    ...extra,
  }));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'os38062-host', version: '0.0.0', private: true }, null, 2)}\n`);
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

/** The "Composed what `os serve` mounts" note, or undefined. */
function servedNote(payload: any): string | undefined {
  return (payload.composition?.notes as string[] | undefined)?.find((n) => n.startsWith('Composed what `os serve` mounts'));
}

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

describe('os migrate plan on an artifact-only stack composes what its shipped items mount, as os serve does', () => {
  it('⭐ one knowledge_source and no `requires`: the knowledge service is composed and named, and nothing warns it is unserved', async () => {
    enter(artifactProject({ knowledgeSources: [SOURCE] }));

    const out = await plan();
    expect(out.exitCode, JSON.stringify(out.payload).slice(0, 400)).toBe(0);
    expect(out.payload.composition?.hostConfig, 'precondition: no config, the artifact alone').toBeNull();
    expect(servedNote(out.payload), JSON.stringify(out.payload.composition?.notes)).toContain('KnowledgeServicePlugin');
    expect(out.said).not.toMatch(UNSERVED);
  }, CASE_TIMEOUT_MS);

  it('control: the same artifact with no source composes no knowledge service', async () => {
    enter(artifactProject({}));

    const out = await plan();
    expect(out.exitCode, JSON.stringify(out.payload).slice(0, 400)).toBe(0);
    expect(servedNote(out.payload), 'precondition: the served platform was composed').toBeDefined();
    expect(servedNote(out.payload)).not.toContain('KnowledgeServicePlugin');
  }, CASE_TIMEOUT_MS);
});
