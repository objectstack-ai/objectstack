// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 50 — spawns the real producer once per single-cause fixture: four spawns of the source CLI, one per distinct (command, fixture) pair (`os validate --json` and `os verify --json` on the open-edition stack and on the same stack with its enterprise provider wired), the two verify spawns each booting the app; local reading 39.92 s file duration, 25.00 s in tests (shared box, under the verify lock), x 1.25, rounded up

/**
 * PIN — a stack that declares an `enterprise` capability with no provider
 * wired in is NAMED, with what the open edition does instead, by `os validate`
 * AND `os verify`; the same stack with the provider in `plugins[]` gets no
 * finding from either.
 *
 * ## The defect
 *
 * `requires: ['hierarchy-security']` plus a `readScope: 'unit_and_below'`
 * grant, on the open edition: `defineStack` accepts it (the token is declared),
 * the sharing layer has no `hierarchy-scope-resolver` and falls back to
 * owner-only without a log line, and `os verify` ran no capability check at
 * all, so its `--json` report was green and said nothing. `os validate` named
 * the package but not the consequence.
 *
 * ## What is pinned
 *
 *   - the open-edition stack: `os validate --json` carries the token under
 *     `warnings` and `os verify --json` under `capabilities`, both naming the
 *     owner-only fallback, and both exit 0 (advisory, by decision);
 *   - the control: the same stack with a package of the provider's name,
 *     declared and resolvable, whose exported plugin class is in `plugins[]`,
 *     gets no capability finding from either door. Without it, a door that
 *     reported every enterprise token whatever was wired would pass the first
 *     half.
 *
 * Spawned rather than run in-process: the `--json` document and the exit code
 * are the contract an agent reads, and only a real process produces them. The
 * per-token battery (every `enterprise` and `cloud` registry row) is unit-level,
 * in `capability-preflight.test.ts`.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, childEnv } from './helpers/serve-process.js';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

const TOKEN = 'hierarchy-security';
const PROVIDER = '@objectstack/security-enterprise';

/** The stack: one private object, one grant at a hierarchy depth, the token declared. */
function stackLiteral(wired: boolean): string {
  return `{
  manifest: { id: 'com.example.edition-advisory', namespace: 'ea', version: '1.0.0', name: 'Edition Advisory', type: 'app', engines: { protocol: '^18' } },
  requires: ['${TOKEN}'],${wired ? '\n  plugins: [new FixtureProviderPlugin()],' : ''}
  objects: [
    { name: 'ea_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } },
  ],
  permissions: [
    { name: 'ea_member', label: 'Member', objects: { ea_note: { allowRead: true, allowCreate: true, allowEdit: true, readScope: 'unit_and_below' } } },
  ],
}`;
}

/**
 * A package under the provider's name, declared by the fixture app and
 * resolvable from it, exporting one plugin class that does nothing. It stands
 * in for the closed-source provider: what the doors judge is whether
 * `plugins[]` holds a class that package exports, never what the plugin does.
 */
function writeProviderPackage(dir: string): void {
  const root = join(dir, 'node_modules', ...PROVIDER.split('/'));
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: PROVIDER, version: '0.0.0-fixture', type: 'module', exports: { '.': './index.js' } }),
  );
  writeFileSync(
    join(root, 'index.js'),
    "export class FixtureProviderPlugin {\n  name = 'fixture.enterprise-provider';\n  version = '0.0.0';\n  async init() {}\n  async start() {}\n}\n",
  );
}

function projectDir(wired: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), `os-edition-advisory-${wired ? 'wired' : 'open'}-`));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'edition-advisory-fixture',
      private: true,
      type: 'module',
      ...(wired ? { dependencies: { [PROVIDER]: '0.0.0-fixture' } } : {}),
    }),
  );
  const source = defineStackSourceFromLiteral(stackLiteral(wired));
  writeFileSync(
    join(dir, 'objectstack.config.mjs'),
    wired ? `import { FixtureProviderPlugin } from '${PROVIDER}';\n${source}` : source,
  );
  if (wired) writeProviderPackage(dir);
  linkSpec(dir);
  return dir;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(dir: string, args: string[]): Run {
  // `bin/run-dev.js` runs this checkout's `src/` through tsx, never `dist/`.
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: childEnv({ NO_COLOR: '1' }),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

type Finding = { token?: string; message?: string };

/** The capability findings of one `--json` document: validate's `warnings`/`errors`, verify's `capabilities`. */
function capabilityFindings(doc: Record<string, unknown>): Finding[] {
  const lists = [doc.warnings, doc.errors, doc.capabilities].filter(Array.isArray) as unknown[][];
  return lists.flat().filter((f): f is Finding => typeof (f as Finding)?.token === 'string');
}

describe('os validate and os verify name an enterprise capability no provider enforces', () => {
  let open: string;
  let wired: string;

  beforeAll(() => {
    open = projectDir(false);
    wired = projectDir(true);
  });

  afterAll(() => {
    for (const dir of [open, wired]) if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the open-edition stack: both `--json` documents name the token and the owner-only fallback, exit 0', () => {
    const validate = runCli(open, ['validate', '--json']);
    expect(validate.status, `os validate --json:\n${validate.stdout}\n${validate.stderr}`).toBe(0);
    const fromValidate = capabilityFindings(JSON.parse(validate.stdout));
    expect(fromValidate.map((f) => f.token)).toEqual([TOKEN]);
    expect(fromValidate[0].message).toContain('owner-only');

    const verify = runCli(open, ['verify', '--json']);
    expect(verify.status, `os verify --json:\n${verify.stdout}\n${verify.stderr}`).toBe(0);
    const verifyDoc = JSON.parse(verify.stdout) as Record<string, unknown>;
    expect(verifyDoc.capabilities).toEqual([
      { token: TOKEN, message: fromValidate[0].message, validate: 'warning' },
    ]);
  }, 180_000);

  it('the control: the provider wired into `plugins[]` gets no capability finding from either door', () => {
    const validate = runCli(wired, ['validate', '--json']);
    expect(validate.status, `os validate --json:\n${validate.stdout}\n${validate.stderr}`).toBe(0);
    expect(capabilityFindings(JSON.parse(validate.stdout))).toEqual([]);

    const verify = runCli(wired, ['verify', '--json']);
    expect(verify.status, `os verify --json:\n${verify.stdout}\n${verify.stderr}`).toBe(0);
    const verifyDoc = JSON.parse(verify.stdout) as Record<string, unknown>;
    // Present and empty: the stage ran and found nothing, not "never ran".
    expect(verifyDoc.capabilities).toEqual([]);
  }, 180_000);
});
