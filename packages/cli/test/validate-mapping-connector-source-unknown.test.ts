// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate` names a mapping whose `connectorSource.connector` is not a
 * declared rest or openapi connector, and says when the name is a datasource.
 *
 * ## The defect, measured before the rule
 *
 * A mapping pointing its pull at the datasource `legacy_db` validated at exit
 * 0 with no finding of any kind. The boot then scheduled the `job` that pulls
 * it, and every tick wrote a failed job run (`connector_not_registered`) that
 * nothing else reported. The rule (`mapping-connector-source-unknown`) is a
 * reference-integrity member, so `os validate` runs it on the whole stack.
 *
 * ## The control
 *
 * The same stack's second mapping names the declared `rest` connector
 * `crm_api`: no finding at its path. One spawn carries both legs.
 *
 * The CLI runs through `bin/run-dev.js` (the source entry), and
 * `@objectstack/lint` resolves through `exports` to `dist/`, so the lint
 * package must be built for this file to see the rule.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
/** A cold spawn of the CLI source entry runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 120_000;
const RULE = 'mapping-connector-source-unknown';

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

const pull = (name: string, connector: string) => ({
  name,
  label: name,
  sourceFormat: 'json',
  targetObject: 'fx_contact',
  mode: 'upsert',
  upsertKey: ['external_id'],
  fieldMapping: [
    { source: 'id', target: 'external_id', transform: 'none' },
    { source: 'name', target: 'name', transform: 'none' },
  ],
  connectorSource: { connector, action: 'request' },
});

const STACK = {
  manifest: { id: 'com.example.fx-connector-ref', name: 'fx', version: '0.1.0', type: 'app', namespace: 'fx' },
  objects: [
    {
      name: 'fx_contact',
      label: 'Contact',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name' }, external_id: { type: 'text', label: 'External ID' } },
    },
  ],
  datasources: [{ name: 'legacy_db', driver: 'sqlite', config: { filename: 'legacy.db' } }],
  connectors: [{ name: 'crm_api', label: 'CRM', type: 'api', provider: 'rest' }],
  mappings: [pull('fx_contacts_legacy', 'legacy_db'), pull('fx_contacts_crm', 'crm_api')],
};

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-validate-connector-source-ref-'));
  mkdirSync(join(root, 'app'), { recursive: true });
  writeFileSync(join(root, 'app', 'objectstack.config.ts'), defineStackSource(STACK));
  linkSpec(join(root, 'app'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('`os validate` resolves a mapping\'s connectorSource.connector', () => {
  it('names the datasource, and passes the mapping naming a declared rest connector', async () => {
    const run = await runCli(['validate', '--json'], join(root, 'app'));
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(run.stdout) as Record<string, any>;
    } catch {
      throw new Error(`stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
    }
    const all = JSON.stringify(payload);
    const findings = [...(payload.errors ?? []), ...(payload.warnings ?? []), ...(payload.issues ?? [])] as Array<
      { rule?: string; path?: string; message?: string; severity?: string }
    >;
    const hits = findings.filter((f) => f.rule === RULE);
    expect(hits.map((f) => f.path), all).toEqual(['mappings[0].connectorSource.connector']);
    expect(hits[0].message).toContain('"legacy_db" is a datasource');
    // An advisory: the stack still validates (the connector universe reaches past this stack).
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
  }, SPAWN_TIMEOUT_MS);
});
