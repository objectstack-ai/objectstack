// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0087 conversions a stack PRODUCER applied reach `os validate` and
 * `os build` — `--json` `conversions` and `os validate --strict` (#20476).
 *
 * ## What was wrong
 *
 * `defineStack` applies every ADR-0087 D2 conversion at load (either mode) and
 * said so only on stderr. Both doors accept nothing but `defineStack` /
 * `composeStacks` output (#20367 ruling B), so the stack they received was
 * already canonical and their own conversion pass found nothing to convert:
 * `--json` answered `conversions: []` for every such config and
 * `os validate --strict` exited 0 on a retiring spelling — the one advisory
 * class that carries an expiry, invisible to the CI job gating on it.
 *
 * ## What is pinned — each `--json` row at BOTH doors
 *
 * | default export                                              | `conversions`              |
 * |:------------------------------------------------------------|:---------------------------|
 * | `defineStack` with a retiring spelling + a named export     | the one notice — the record |
 * |   (`onEnable`): `loadConfig` merges with a spread            |   is read off the default   |
 * |                                                             |   BEFORE the spread drops it |
 * | `composeStacks([built-with-it, built-without])`             | the one notice, from the    |
 * |                                                             |   input that applied it     |
 * | canonical `defineStack` + a NAMED export `pages` carrying    | the one notice — the door's |
 * |   the retiring spelling (merged after the producer ran)      |   own pass, which stays     |
 * | the canonical spelling (control)                            | `[]`                        |
 *
 * Every non-empty row asserts EXACTLY one entry, so the fold and the door's own
 * pass cannot both report one conversion. And `os validate --strict` exits 1 on
 * both faces for the retiring spelling, 0 for the control.
 *
 * `page-header-subtitle-alias` is the live conversion driven here (`description`
 * on a `page:header` component, canonical `subtitle`). The day it retires from
 * the load path the non-empty rows go red; re-point the fixture at a live entry
 * in `packages/spec/src/conversions/registry.ts`.
 *
 * The CLI runs from source (`bin/run-dev.js`), but `@objectstack/spec` — the
 * producer and the record's reader — resolves through `exports` to its
 * `dist/`, in the child and in the fixture's own `defineStack` alike.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

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
  warnings?: unknown[];
  conversions?: Array<Record<string, unknown>>;
}

function payloadOf(run: Run, label: string): Payload {
  try {
    return JSON.parse(run.stdout) as Payload;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

/** The one entry every non-empty row must carry, by identity, site and direction. */
const THE_NOTICE = {
  code: 'OS_METADATA_CONVERTED',
  conversionId: 'page-header-subtitle-alias',
  path: 'pages[0].regions[0].components[0].properties.subtitle',
  from: 'description',
  to: 'subtitle',
};

function expectExactly(payload: Payload, expected: Array<typeof THE_NOTICE>, label: string): void {
  const entries = payload.conversions;
  expect(Array.isArray(entries), `${label}: \`conversions\` is present`).toBe(true);
  expect(
    entries!.map((n) => ({ code: n.code, conversionId: n.conversionId, path: n.path, from: n.from, to: n.to })),
    label,
  ).toEqual(expected);
  for (const n of entries!) expect(typeof n.retiresIn, `${label}: the expiry rides the entry`).toBe('number');
}

const manifest = (ns: string) =>
  `{ id: 'com.example.${ns}', name: '${ns}', version: '1.0.0', type: 'app', namespace: '${ns}' }`;

const page = (ns: string, headerKey: 'description' | 'subtitle') => `{
    name: '${ns}_home',
    label: 'Home',
    regions: [{ name: 'main', components: [
      { type: 'page:header', properties: { title: 'Things', ${headerKey}: 'All things' } },
    ] }],
  }`;

const stackBody = (ns: string, headerKey: 'description' | 'subtitle' | null) => `{
  manifest: ${manifest(ns)},
  objects: [{ name: '${ns}_thing', label: 'Thing', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
  apps: [{ name: '${ns}_app', label: 'App' }],${headerKey ? `\n  pages: [${page(ns, headerKey)}],` : ''}
}`;

const IMPORT = `import { composeStacks, defineStack } from '@objectstack/spec';\n\n`;

const FIXTURES: Record<string, string> = {
  // The record, across `loadConfig`'s named-export spread.
  recordAcrossSpread:
    IMPORT +
    `export const onEnable = async () => {};\n\n` +
    `export default defineStack(${stackBody('rec', 'description')});\n`,
  // The record of a composed stack: its inputs' records.
  composed:
    IMPORT +
    `const withIt = defineStack(${stackBody('cmpa', 'description')});\n` +
    `const without = defineStack({ manifest: ${manifest('cmpb')}, objects: [{ name: 'cmpb_thing', label: 'Thing', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }] });\n\n` +
    `export default composeStacks([withIt, without]);\n`,
  // A key merged after the producer ran: only the door's own pass sees it.
  namedExportPass:
    IMPORT +
    `export const pages = [${page('nep', 'description')}];\n\n` +
    `export default defineStack(${stackBody('nep', null)});\n`,
  // The control: the canonical spelling.
  canonical: IMPORT + `export default defineStack(${stackBody('can', 'subtitle')});\n`,
};

let root = '';
const dirs: Record<string, string> = {};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-stack-conversion-record-'));
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

for (const command of ['validate', 'build'] as const) {
  const ok = (p: Payload) => (command === 'validate' ? p.valid : p.success);
  const args = (label: string) =>
    command === 'build' ? ['build', '--json', '-o', join(dirs[label], 'out', 'objectstack.json')] : ['validate', '--json'];

  describe(`os ${command} --json — the producer's conversion record reaches \`conversions\``, () => {
    it('defineStack + a named export: the record is read off the default before the named-export spread', async () => {
      const run = await runCli(args('recordAcrossSpread'), dirs.recordAcrossSpread);
      const p = payloadOf(run, command);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      expect(ok(p)).toBe(true);
      expectExactly(p, [THE_NOTICE], `${command} recordAcrossSpread`);
    }, 180_000);

    it('composeStacks: the composed stack carries the record of the input that applied the conversion', async () => {
      const run = await runCli(args('composed'), dirs.composed);
      const p = payloadOf(run, command);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      expectExactly(p, [THE_NOTICE], `${command} composed`);
    }, 180_000);

    it("a key merged from a named export: the door's own pass still converts it — once", async () => {
      const run = await runCli(args('namedExportPass'), dirs.namedExportPass);
      const p = payloadOf(run, command);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      expectExactly(p, [THE_NOTICE], `${command} namedExportPass`);
      // The producer never saw that key, so it printed nothing for it.
      expect(run.stderr).not.toContain("conversion 'page-header-subtitle-alias'");
    }, 180_000);

    it('control: the canonical spelling converts nothing — `[]`', async () => {
      const run = await runCli(args('canonical'), dirs.canonical);
      const p = payloadOf(run, command);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      expectExactly(p, [], `${command} canonical`);
    }, 180_000);
  });
}

describe('os validate --strict — a conversion the producer applied fails it, on both faces', () => {
  it('the retiring spelling: exit 1 on the text face and under --json', async () => {
    const text = await runCli(['validate', '--strict'], dirs.recordAcrossSpread);
    const json = await runCli(['validate', '--json', '--strict'], dirs.recordAcrossSpread);
    expect(text.code, text.stdout + text.stderr).toBe(1);
    expect(text.stdout).toContain('Strict mode: warnings treated as errors');
    expect(text.stdout).toContain("conversion 'page-header-subtitle-alias'");
    expect(json.code, json.stdout + json.stderr).toBe(1);
    const p = payloadOf(json, 'validate --json --strict');
    expect(p.valid).toBe(true);
    expect(p.warnings).toEqual([]);
    expectExactly(p, [THE_NOTICE], 'validate --json --strict');
  }, 180_000);

  it('control: the canonical spelling exits 0 on both faces', async () => {
    const text = await runCli(['validate', '--strict'], dirs.canonical);
    const json = await runCli(['validate', '--json', '--strict'], dirs.canonical);
    expect(text.code, text.stdout + text.stderr).toBe(0);
    expect(json.code, json.stdout + json.stderr).toBe(0);
  }, 180_000);
});
