// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate` and `os build` accept one authoring shape (#20367 ruling B).
 *
 * ## What was wrong
 *
 * The `STACK_*` cross-field refusals (capability vocabulary, cross-references,
 * namespace prefix, single app, hierarchy-scope and trigger capability) run
 * inside `defineStack` and nowhere else. The same defective stack exported as
 * a plain object literal skipped all of them: both doors ran only the schema
 * parse and answered exit 0, and `os build` shipped the artifact.
 *
 * ## What is pinned — each row at BOTH doors, by `code` and exit status
 *
 * | default export                                     | answer                                   |
 * |:---------------------------------------------------|:-----------------------------------------|
 * | the defective stack as `defineStack({ … })`        | the family's own code, exit 1            |
 * | the SAME stack as a plain object                   | `STACK_PROVENANCE_MISSING`, exit 1        |
 * | a host-shaped plain object (instantiated plugins)  | `STACK_PROVENANCE_MISSING`, exit 1        |
 * | the same host shape as `defineStack({ … })`        | accepted, exit 0                          |
 * | a spread copy of a built stack                     | `STACK_PROVENANCE_MISSING`, exit 1        |
 * | `defineStack` + a named export (`onEnable`)        | accepted, exit 0 — the mark is read off   |
 * |                                                    | the default BEFORE the named-export merge |
 *
 * The plain-object refusal happens before any other judgement, so `os build`
 * writes no artifact for it. The host-shaped rows are the ruling's premise as
 * measured: a host-shaped export CAN reach these doors, it is refused only when
 * no producer built it, and the prescribed fix (wrap it in `defineStack`) is
 * accepted — `examples/app-showcase` is a host-shaped `defineStack` config.
 *
 * Refusal assertions read the envelope (`code`, exit status), never a bare
 * throw; the first sentence of the prescription is asserted on top because the
 * wording IS the fix an author (or an AI) applies.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

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

interface Payload {
  valid?: boolean;
  success?: boolean;
  error?: string;
  code?: string;
}

function payloadOf(run: Run, label: string): Payload {
  try {
    return JSON.parse(run.stdout) as Payload;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

/** A stack `defineStack` refuses: `requires` names a token no runtime provides. */
const DEFECTIVE = `{
  manifest: { id: 'com.example.prov', name: 'prov', version: '1.0.0', type: 'app', namespace: 'prov' },
  requires: ['no-such-capability'],
  objects: [{ name: 'prov_thing', label: 'Thing', fields: { title: { type: 'text', label: 'Title' } } }],
}`;

/** A host-shaped stack: its `plugins` list carries an instantiated plugin object. */
const HOST = `{
  manifest: { id: 'com.example.host', name: 'host', version: '1.0.0', type: 'app', namespace: 'host' },
  plugins: [{ name: 'com.example.host.probe', init: async () => {}, start: async () => {} }],
}`;

const FIXTURES: Record<string, string> = {
  defineStackDefective: defineStackSourceFromLiteral(DEFECTIVE),
  plainDefective: `export default ${DEFECTIVE};\n`,
  plainHost: `export default ${HOST};\n`,
  defineStackHost: defineStackSourceFromLiteral(HOST),
  spreadCopy:
    `import { defineStack } from '@objectstack/spec';\n\n` +
    `const stack = defineStack({ manifest: { id: 'com.example.copy', name: 'copy', version: '1.0.0', type: 'app', namespace: 'copy' } });\n\n` +
    `export default { ...stack, api: {} };\n`,
  namedExport:
    `import { defineStack } from '@objectstack/spec';\n\n` +
    `export const onEnable = async () => {};\n\n` +
    `export default defineStack({ manifest: { id: 'com.example.named', name: 'named', version: '1.0.0', type: 'app', namespace: 'named' } });\n`,
};

let root = '';
const dirs: Record<string, string> = {};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-stack-provenance-'));
  for (const [label, source] of Object.entries(FIXTURES)) {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), source);
    linkSpec(dir);
    dirs[label] = dir;
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const PRESCRIPTION_HEAD = 'objectstack.config.ts: the default export was not built by `defineStack`';

for (const command of ['validate', 'build'] as const) {
  const ok = (p: Payload) => (command === 'validate' ? p.valid : p.success);

  describe(`os ${command} --json — one authoring shape`, () => {
    it('the defective stack as defineStack({ … }): the family\'s own code, exit 1', async () => {
      const run = await runCli([command, '--json'], dirs.defineStackDefective);
      const p = payloadOf(run, command);
      expect(run.code, run.stdout + run.stderr).toBe(1);
      expect(p.code).toBe('STACK_CAPABILITY_UNKNOWN');
      expect(ok(p)).toBe(false);
    }, 180_000);

    it('the SAME stack as a plain object: STACK_PROVENANCE_MISSING, exit 1, the defineStack prescription', async () => {
      const run = await runCli([command, '--json'], dirs.plainDefective);
      const p = payloadOf(run, command);
      expect(run.code, run.stdout + run.stderr).toBe(1);
      expect(p.code).toBe('STACK_PROVENANCE_MISSING');
      expect(ok(p)).toBe(false);
      expect(p.error?.startsWith(PRESCRIPTION_HEAD), p.error).toBe(true);
      expect(p.error).toContain('export default defineStack({ … });');
      if (command === 'build') {
        // Refused before any other step: no artifact is emitted.
        expect(existsSync(join(dirs.plainDefective, 'dist', 'objectstack.json'))).toBe(false);
      }
    }, 180_000);

    it('a host-shaped plain object is refused the same way', async () => {
      const run = await runCli([command, '--json'], dirs.plainHost);
      expect(run.code, run.stdout + run.stderr).toBe(1);
      expect(payloadOf(run, command).code).toBe('STACK_PROVENANCE_MISSING');
    }, 180_000);

    it('control: the same host shape as defineStack({ … }) is accepted', async () => {
      const run = await runCli([command, '--json'], dirs.defineStackHost);
      const p = payloadOf(run, command);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      expect(ok(p)).toBe(true);
    }, 180_000);

    it('a spread copy of a built stack is not the built stack: STACK_PROVENANCE_MISSING, exit 1', async () => {
      const run = await runCli([command, '--json'], dirs.spreadCopy);
      expect(run.code, run.stdout + run.stderr).toBe(1);
      expect(payloadOf(run, command).code).toBe('STACK_PROVENANCE_MISSING');
    }, 180_000);

    it('control: defineStack plus a named export is accepted — the mark is read before the named-export merge', async () => {
      const run = await runCli([command, '--json'], dirs.namedExport);
      const p = payloadOf(run, command);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      expect(ok(p)).toBe(true);
    }, 180_000);
  });
}
