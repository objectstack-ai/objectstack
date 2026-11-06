// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A BUILT consumer of `@objectstack/scenarios/score` (#30915): a throwaway
 * package that depends on this one, bundles its own entry with tsup (which
 * leaves a `dependencies` entry external), and is then loaded by plain Node,
 * the way a linked framework tree's consumer loads it at boot. Before the
 * package had a build step its exports named `.ts` files whose `.js`
 * specifiers only a TypeScript resolver follows, so this load failed with
 * ERR_MODULE_NOT_FOUND under both module kinds.
 *
 * The child process records every module it resolves (`module.registerHooks`),
 * so the narrow entry's runtime graph is read, not inferred: no
 * `@objectstack/objectql` or `@objectstack/plugin-sharing` file loads.
 *
 * Reads `dist/`: turbo runs this package's own `build` before its `test`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = resolve(PKG, '../../..');
// The JS is what plain Node loads, so it is required. The declarations are
// not built under `OS_SKIP_DTS` (CI's build sets it); when they are built,
// the package's own `build` script already fails without them
// (`check-dts-emitted.mjs`), so this test does not ask for them.
const BUILT = ['score.js', 'score.cjs'].map((f) => join(PKG, 'dist', f));

const TSUP_PKG = createRequire(join(REPO, 'package.json')).resolve('tsup/package.json');
const TSUP_BIN = join(dirname(TSUP_PKG), (JSON.parse(readFileSync(TSUP_PKG, 'utf8')) as { bin: { tsup: string } }).bin.tsup);

const ENTRY = `
import { scoreGraphShape } from '@objectstack/scenarios/score';

export const shape = () =>
  scoreGraphShape({ objects: [{ name: 'loan', fields: [{ name: 'title', type: 'text' }] }] }, { minObjects: 1 });

export const loadScore = () => import('@objectstack/scenarios/score');
`;

// Preloaded into the child: every URL Node resolves, written to the file
// named by SCENARIOS_RESOLVE_RECORD. A FILE, written synchronously: the record
// is ~140 KB, larger than a pipe's buffer, and a stdout write from an `exit`
// handler is not flushed past what the pipe takes before the process ends
// (a truncated record on a loaded CI runner).
const RECORDER = `
const { writeFileSync } = require('node:fs');
const { registerHooks } = require('node:module');
const seen = [];
registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); seen.push(r.url); return r; } });
process.on('exit', () => writeFileSync(process.env.SCENARIOS_RESOLVE_RECORD, JSON.stringify(seen)));
`;

let fixture = '';

function runNode(code: string, kind: 'module' | 'commonjs'): { out: Record<string, unknown>; resolved: string[] } {
  const record = join(fixture, `resolved-${kind}.json`);
  rmSync(record, { force: true });
  const stdout = execFileSync(process.execPath, ['--require', join(fixture, 'recorder.cjs'), `--input-type=${kind}`, '-e', code], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, SCENARIOS_RESOLVE_RECORD: record },
  });
  return { out: JSON.parse(stdout.trim()) as Record<string, unknown>, resolved: JSON.parse(readFileSync(record, 'utf8')) as string[] };
}

const probe = (mod: string) => `
  const m = ${mod};
  const s = await m.loadScore();
  const r = m.shape();
  console.log(JSON.stringify({ shape: typeof s.scoreGraphShape, run: typeof s.gradePersonaRun, tags: typeof s.scoreScenarioArtifact, score: r.score, total: r.total }));
`;

describe('a tsup-built consumer of @objectstack/scenarios/score', () => {
  beforeAll(() => {
    const missing = BUILT.filter((f) => !existsSync(f));
    if (missing.length > 0) throw new Error(`build @objectstack/scenarios first (pnpm --filter @objectstack/scenarios build): missing ${missing.join(', ')}`);

    fixture = mkdtempSync(join(tmpdir(), 'scenarios-built-consumer-'));
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({ name: 'scenarios-built-consumer', private: true, type: 'module', dependencies: { '@objectstack/scenarios': 'workspace:*' } }),
    );
    mkdirSync(join(fixture, 'src'));
    writeFileSync(join(fixture, 'src/index.ts'), ENTRY);
    writeFileSync(join(fixture, 'recorder.cjs'), RECORDER);
    mkdirSync(join(fixture, 'node_modules/@objectstack'), { recursive: true });
    symlinkSync(PKG, join(fixture, 'node_modules/@objectstack/scenarios'), 'dir');

    execFileSync(process.execPath, [TSUP_BIN, 'src/index.ts', '--format', 'esm,cjs', '--target', 'es2020', '--silent'], {
      cwd: fixture,
      stdio: 'pipe',
    });
  }, 120_000);

  afterAll(() => {
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  it('leaves the scorer external: the bundle imports it, it does not carry it', () => {
    for (const out of ['dist/index.js', 'dist/index.cjs']) {
      const text = readFileSync(join(fixture, out), 'utf8');
      expect(text, out).toContain('@objectstack/scenarios/score');
      expect(text, out).not.toContain('PLATFORM_OBJECT_PREFIX');
    }
  });

  it.each([
    ['ESM', 'module', `await import(${JSON.stringify('PLACEHOLDER')})`, 'dist/index.js'],
    ['CJS', 'commonjs', `require(${JSON.stringify('PLACEHOLDER')})`, 'dist/index.cjs'],
  ] as const)('loads under plain Node (%s) and reaches neither objectql nor plugin-sharing', (_kind, inputType, load, file) => {
    const target = inputType === 'module' ? pathToFileURL(join(fixture, file)).href : join(fixture, file);
    const body = probe(load.replace('PLACEHOLDER', target));
    const { out, resolved } = runNode(inputType === 'module' ? body : `(async () => { ${body} })()`, inputType);

    expect(out).toEqual({ shape: 'function', run: 'function', tags: 'undefined', score: 1, total: 1 });
    const scorer = resolved.filter((u) => u.includes('/qa/scenarios/dist/'));
    expect(scorer.length, 'the scorer is loaded from its dist').toBeGreaterThan(0);
    expect(resolved.filter((u) => u.includes('/qa/scenarios/src/'))).toEqual([]);
    expect(resolved.filter((u) => /objectql|plugin-sharing/.test(u))).toEqual([]);
    // Control: the recorder sees the scorer's own runtime imports.
    expect(resolved.some((u) => u.includes('/packages/core/'))).toBe(true);
  });
});
