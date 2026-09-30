// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate` and `os lint` — the two CLI doors of the `flow-credential-literal`
 * advisory, run for real.
 *
 * The registry proves the rule is WIRED to all three commands
 * (`@objectstack/lint`'s own tests); only running the commands proves each one
 * PRINTS it, on the channel an author reads, without failing the run. The
 * measured starting point was silence at both doors: a flow carrying a
 * credential-shaped literal in an `http` node's headers and url and in a
 * connector node's input validated clean and linted clean.
 *
 * Two fixtures, one flow each: LIT carries three literals (a header, a url
 * query parameter, a nested connector input); DARK is the same flow with
 * `{var}` templates in those three positions, and must stay silent. Every
 * value is a probe sentinel, not a credential.
 *
 * Integration tier: it spawns the source CLI (`packages/cli/vitest-tiers.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOW_CREDENTIAL_LITERAL } from '@objectstack/lint';
import { childEnv } from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

const SENTINELS = ['cli-header-sentinel', 'cli-url-sentinel', 'cli-input-sentinel'] as const;

const stackOf = (literal: boolean) => ({
  manifest: {
    id: `com.example.credential.${literal ? 'lit' : 'dark'}`,
    namespace: 'cred',
    version: '1.0.0',
    type: 'app',
    name: 'Credential door probe',
    engines: { protocol: '^17' },
  },
  objects: [
    {
      name: 'cred_note',
      label: 'Note',
      pluralLabel: 'Notes',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name', required: true } },
    },
  ],
  flows: [
    {
      name: 'cred_probe',
      label: 'Credential probe',
      type: 'autolaunched',
      variables: [{ name: 'api_token', type: 'text', isInput: true }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'call',
          type: 'http',
          label: 'Call',
          config: {
            url: literal
              ? `https://example.invalid/hook?api_key=${SENTINELS[1]}`
              : 'https://example.invalid/hook?api_key={api_token}',
            method: 'POST',
            headers: {
              Authorization: literal ? `Bearer ${SENTINELS[0]}` : 'Bearer {api_token}',
              'X-Trace-Label': 'plain-value',
            },
          },
        },
        {
          id: 'conn',
          type: 'connector_action',
          label: 'Connector',
          connectorConfig: {
            connectorId: 'rest',
            actionId: 'request',
            input: { method: 'GET', path: '/p', auth: { clientSecret: literal ? SENTINELS[2] : '{api_token}' } },
          },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'call' },
        { id: 'e2', source: 'call', target: 'conn' },
        { id: 'e3', source: 'conn', target: 'end' },
      ],
    },
  ],
});

const LIT_PATHS = [
  'flows[0].nodes[1].config.headers.Authorization',
  'flows[0].nodes[1].config.url',
  'flows[0].nodes[2].connectorConfig.input.auth.clientSecret',
];

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

interface Finding {
  rule?: string;
  path?: string;
  severity?: string;
  message?: string;
}

/** `os validate --json`: registry advisories ride `warnings` as finding objects. */
const validateFindings = (stdout: string): Finding[] =>
  ((JSON.parse(stdout) as { warnings?: unknown[] }).warnings ?? []).filter(
    (w): w is Finding => !!w && typeof w === 'object' && (w as Finding).rule === FLOW_CREDENTIAL_LITERAL,
  );

/** `os lint --json`: every finding is an `issues` entry. */
const lintFindings = (stdout: string): Finding[] =>
  ((JSON.parse(stdout) as { issues?: Finding[] }).issues ?? []).filter((i) => i.rule === FLOW_CREDENTIAL_LITERAL);

const dirs = new Map<'lit' | 'dark', string>();

beforeAll(() => {
  for (const kind of ['lit', 'dark'] as const) {
    const dir = mkdtempSync(join(tmpdir(), `os-flow-credential-${kind}-`));
    writeDefineStackConfig(dir, stackOf(kind === 'lit'));
    dirs.set(kind, dir);
  }
});

afterAll(() => {
  for (const dir of dirs.values()) rmSync(dir, { recursive: true, force: true });
});

describe('flow-credential-literal at the CLI doors', () => {
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
