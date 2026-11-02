// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate` and `os lint` — the two CLI doors of the
 * `connector-credential-literal` advisory, run for real.
 *
 * The registry proves the rule is WIRED to all three commands
 * (`@objectstack/lint`'s own tests); only running the commands proves each one
 * PRINTS it, on the channel an author reads, without failing the run.
 *
 * Two fixtures: LIT declares three connectors carrying a `Bearer …` literal in
 * each of the four maps (a `rest` entry's `headers` and `defaultHeaders`, an
 * `mcp` http transport's `headers`, an `mcp` stdio transport's `env`); DARK is
 * the same three routed through `auth.credentialRef` with only ordinary
 * entries (`Accept: application/json`) left in the maps, and must stay silent.
 * Every value is a probe sentinel, not a credential.
 *
 * Integration tier: it spawns the source CLI (`packages/cli/vitest-tiers.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONNECTOR_CREDENTIAL_LITERAL } from '@objectstack/lint';
import { childEnv } from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');

const SENTINELS = [
  'cli-headers-sentinel',
  'cli-default-headers-sentinel',
  'cli-transport-headers-sentinel',
  'cli-env-sentinel',
] as const;

const ACCEPT = { Accept: 'application/json' };

const connectorsOf = (literal: boolean) => [
  {
    name: 'vendor_api',
    label: 'Vendor API',
    type: 'api',
    provider: 'rest',
    providerConfig: {
      baseUrl: 'https://api.vendor.invalid/v1',
      headers: literal ? { ...ACCEPT, Authorization: `Bearer ${SENTINELS[0]}` } : ACCEPT,
      defaultHeaders: literal ? { 'X-Vendor-Trace': `Bearer ${SENTINELS[1]}` } : ACCEPT,
    },
    ...(literal ? {} : { auth: { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' } }),
  },
  {
    name: 'search_tools',
    label: 'Search Tools',
    type: 'api',
    provider: 'mcp',
    providerConfig: {
      transport: {
        kind: 'http',
        url: 'https://mcp.vendor.invalid/mcp',
        headers: literal ? { Authorization: `Bearer ${SENTINELS[2]}` } : ACCEPT,
      },
    },
    ...(literal ? {} : { auth: { type: 'bearer', credentialRef: 'SEARCH_TOOLS_TOKEN' } }),
  },
  {
    name: 'local_tools',
    label: 'Local Tools',
    type: 'api',
    provider: 'mcp',
    providerConfig: {
      transport: {
        kind: 'stdio',
        command: 'local-mcp-server',
        env: literal ? { MCP_UPSTREAM: `Bearer ${SENTINELS[3]}` } : { LOG_LEVEL: 'info' },
      },
    },
  },
];

const stackOf = (literal: boolean) => ({
  manifest: {
    id: `com.example.connector.credential.${literal ? 'lit' : 'dark'}`,
    namespace: 'conncred',
    version: '1.0.0',
    type: 'app',
    name: 'Connector credential door probe',
    engines: { protocol: '^18' },
  },
  objects: [
    {
      name: 'conncred_note',
      label: 'Note',
      pluralLabel: 'Notes',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name', required: true } },
    },
  ],
  connectors: connectorsOf(literal),
});

const LIT_PATHS = [
  'connectors[0].providerConfig.headers.Authorization',
  'connectors[0].providerConfig.defaultHeaders["X-Vendor-Trace"]',
  'connectors[1].providerConfig.transport.headers.Authorization',
  'connectors[2].providerConfig.transport.env.MCP_UPSTREAM',
];

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

interface Finding {
  rule?: string;
  path?: string;
  severity?: string;
  message?: string;
}

/** `os validate --json`: registry advisories ride `warnings` as finding objects. */
const validateFindings = (stdout: string): Finding[] =>
  ((JSON.parse(stdout) as { warnings?: unknown[] }).warnings ?? []).filter(
    (w): w is Finding => !!w && typeof w === 'object' && (w as Finding).rule === CONNECTOR_CREDENTIAL_LITERAL,
  );

/** `os lint --json`: every finding is an `issues` entry. */
const lintFindings = (stdout: string): Finding[] =>
  ((JSON.parse(stdout) as { issues?: Finding[] }).issues ?? []).filter((i) => i.rule === CONNECTOR_CREDENTIAL_LITERAL);

const dirs = new Map<'lit' | 'dark', string>();

beforeAll(() => {
  for (const kind of ['lit', 'dark'] as const) {
    const dir = mkdtempSync(join(tmpdir(), `os-connector-credential-${kind}-`));
    writeDefineStackConfig(dir, stackOf(kind === 'lit'));
    dirs.set(kind, dir);
  }
});

afterAll(() => {
  for (const dir of dirs.values()) rmSync(dir, { recursive: true, force: true });
});

describe('connector-credential-literal at the CLI doors', () => {
  it('os validate — LIT prints one warning per literal and still passes; DARK prints none', async () => {
    const lit = await runCli(['validate', '--json'], dirs.get('lit')!);
    expect(lit.code, `validate failed:\n${lit.stdout}\n${lit.stderr}`).toBe(0);
    expect((JSON.parse(lit.stdout) as { valid?: boolean }).valid).toBe(true);
    const found = validateFindings(lit.stdout);
    expect(found.map((f) => f.path)).toEqual(LIT_PATHS);
    expect(found.every((f) => f.severity === 'warning')).toBe(true);
    // The route is in the message, which is what the text face prints.
    expect(found.every((f) => (f.message ?? '').includes('auth.credentialRef'))).toBe(true);
    for (const sentinel of SENTINELS) expect(JSON.stringify(found).includes(sentinel), sentinel).toBe(false);

    const dark = await runCli(['validate', '--json'], dirs.get('dark')!);
    expect(dark.code, `validate failed:\n${dark.stdout}\n${dark.stderr}`).toBe(0);
    expect(validateFindings(dark.stdout)).toEqual([]);
  }, 180_000);

  it('os lint — LIT reports one warning per literal and still passes; DARK reports none', async () => {
    const lit = await runCli(['lint', '--json'], dirs.get('lit')!);
    expect(lit.code, `lint failed:\n${lit.stdout}\n${lit.stderr}`).toBe(0);
    expect((JSON.parse(lit.stdout) as { passed?: boolean }).passed).toBe(true);
    const found = lintFindings(lit.stdout);
    expect(found.map((f) => f.path)).toEqual(LIT_PATHS);
    expect(found.every((f) => f.severity === 'warning')).toBe(true);
    expect(found.every((f) => (f.message ?? '').includes('auth.credentialRef'))).toBe(true);
    for (const sentinel of SENTINELS) expect(JSON.stringify(found).includes(sentinel), sentinel).toBe(false);

    const dark = await runCli(['lint', '--json'], dirs.get('dark')!);
    expect(dark.code, `lint failed:\n${dark.stdout}\n${dark.stderr}`).toBe(0);
    expect(lintFindings(dark.stdout)).toEqual([]);
  }, 180_000);
});
