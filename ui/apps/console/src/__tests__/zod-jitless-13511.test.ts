/**
 * objectui#13511 — the Console document turns zod's JIT off before any module
 * runs.
 *
 * zod v4 probes for `eval` with `new Function('')` the first time an object
 * schema is built. Under the Console's content-security-policy that probe is
 * refused, and reported on every load, unless the react-pages tier is on. The
 * fix is one inline classic script in `apps/console/index.html`, so, following
 * `bootSplash.test.ts`, these tests read that file through `?raw` and run the
 * script itself rather than a copy of it.
 *
 * Two halves: the script is ahead of the module entry (a `z.config()` call in
 * the entry runs too late, because the bundle evaluates the vendor chunks that
 * build schemas before the entry's body), and running it before the installed
 * zod means zod builds and parses with no `Function` call, against a control
 * that the probe is seen without it. The second half is what notices a zod
 * upgrade that stops reading the global.
 *
 * The zod half runs in a child Node process: this worker's setup has already
 * loaded zod, which caches the probe's answer once per process.
 */
import indexHtml from '../../index.html?raw';
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT_MARKER = '__zod_globalConfig';
const APP_ENTRY = '/src/main.tsx';

/** Every `<script>` open tag plus its inline body, in document order, comments removed. */
function scriptsOf(html: string) {
  return [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(
    (match) => ({ attrs: match[1] ?? '', body: match[2] ?? '' }),
  );
}

/** The jitless script exactly as it ships; exactly one, or the test fails rather than test nothing. */
function jitlessScript(): string {
  const found = scriptsOf(indexHtml).filter((script) => script.body.includes(SCRIPT_MARKER));
  if (found.length !== 1) throw new Error(`expected exactly 1 inline ${SCRIPT_MARKER} script in index.html, found ${found.length}`);
  return found[0].body;
}

/** Counts `Function` calls while zod builds and parses one object schema, after `prelude`. */
function probe(prelude: string): { calls: string[]; parsed: unknown } {
  const source = `
const calls = [];
const RealFunction = globalThis.Function;
globalThis.Function = new Proxy(RealFunction, {
  construct(target, args) { calls.push(args.join(',')); return Reflect.construct(target, args); },
  apply(target, self, args) { calls.push(args.join(',')); return Reflect.apply(target, self, args); },
});
globalThis.window = globalThis;
${prelude}
const { z } = await import('zod');
const schema = z.object({ name: z.string(), count: z.number().optional() });
const parsed = schema.parse({ name: 'a', count: 1 });
process.stdout.write(JSON.stringify({ calls, parsed }));
`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`probe exited ${run.status}\n${run.stderr}`);
  return JSON.parse(run.stdout);
}

describe('apps/console/index.html — zod runs without its JIT (objectui#13511)', () => {
  it('sets it in a classic script ahead of the module entry', () => {
    const scripts = scriptsOf(indexHtml);
    const jitless = scripts.findIndex((script) => script.body.includes(SCRIPT_MARKER));
    const entry = scripts.findIndex((script) => script.attrs.includes(APP_ENTRY));
    expect(jitless).toBeGreaterThanOrEqual(0);
    expect(entry).toBeGreaterThan(jitless);
    expect(scripts[jitless].attrs).not.toMatch(/type\s*=\s*["']?module|\bsrc\s*=|\b(async|defer)\b/);
  });

  it('control: without it, the installed zod calls Function when it builds an object schema', () => {
    const { calls, parsed } = probe('');
    expect(parsed).toEqual({ name: 'a', count: 1 });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('with it run first, the installed zod builds and parses an object schema without calling Function', () => {
    const { calls, parsed } = probe(jitlessScript());
    expect(parsed).toEqual({ name: 'a', count: 1 });
    expect(calls).toEqual([]);
  });
});
