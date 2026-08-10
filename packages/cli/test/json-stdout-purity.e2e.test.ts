// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--json` ⇒ stdout is EXACTLY ONE JSON DOCUMENT, for the whole
 * `bootSchemaStack` family (#6217).
 *
 * `--json` has one audience — a program — and the commands that boot a kernel
 * were handing that program a stream it could not parse. `ObjectLogger` routes
 * `debug`/`info`/`warn` to **stdout** and only `error`/`fatal` to stderr, so
 * `os migrate recorded-by --json` shipped ~60 INFO lines above the payload and
 * the two shutdown lines below it, with stderr completely empty. The consumer's
 * only recourse was a "find the last lone `{` and its matching `}`" extractor —
 * #4873 was forced to write one to assert its own payload — and that heuristic
 * silently picks the wrong text as soon as a log line looks like JSON.
 *
 * ## Why the whole family, from one expectation
 *
 * The contract has one implementation face per command, and there are nine of
 * them. A file that pinned `migrate recorded-by` alone would go green while the
 * other eight stayed broken, and would say nothing at all about the tenth. So
 * the family is DISCOVERED from the source tree — every command that calls
 * `bootSchemaStack` and declares a `--json` flag — and the discovered set is
 * reconciled against {@link FAMILY} below. Add a member and this file goes red
 * until it is listed here and passes; drop one and it goes red until it is
 * removed. The seam itself (`bootSchemaStack`'s required `jsonOutput` option)
 * makes the mistake a compile error first; this is the runtime proof that the
 * seam actually delivers the invariant.
 *
 * ## Deliberately an UNCOMPILED fixture
 *
 * No `os compile` runs here, so the project has no `dist/objectstack.json` and
 * the boot announces that through `console.log`:
 *
 *     [StandaloneStack] no compiled artifact at '…' — booting without one
 *
 * That line never passes through the kernel logger, so it is the second,
 * independent pollution source — a fix that only quieted `ObjectLogger` would
 * still leave it on stdout. Compiling the fixture would make the richer command
 * payloads possible and delete that coverage; the invariant matters more.
 *
 * ## Diagnostics are MOVED, never destroyed
 *
 * Route 2 of the issue (drop the kernel to `logLevel: 'silent'` under `--json`)
 * would also make stdout parse — by throwing the operator's boot diagnostics,
 * warnings included, on the floor. Every case therefore asserts the same lines
 * are present on **stderr**, so a regression toward silencing goes red here
 * too.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const COMMANDS_DIR = resolve(HERE, '../src/commands');

/**
 * The family, and how to drive each member into a boot.
 *
 * The value is the EXTRA argv a member needs beyond `--json`; `[]` means the
 * bare form already boots. Only one member needs anything: `os migrate meta`
 * migrates an authored config in memory and boots a kernel solely under
 * `--stored`, which is why the issue's own list names it as `migrate meta
 * --stored` rather than `migrate meta`.
 */
const FAMILY: Record<string, string[]> = {
  'meta resync': [],
  'migrate apply': [],
  'migrate files-to-references': [],
  'migrate meta': ['--stored'],
  'migrate plan': [],
  'migrate recorded-by': [],
  'migrate resume': [],
  'migrate summary-nulls': [],
  'migrate value-shapes': [],
};

/** Boot lines every member emits — the diagnostics that must survive on stderr. */
const BOOT_DIAGNOSTICS = [
  // `console.log`, not the kernel logger — see the header.
  '[StandaloneStack] no compiled artifact',
  'Bootstrap complete',
  'Graceful shutdown complete',
];

/** Every `.ts` under `src/commands`, excluding tests. */
function commandFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...commandFiles(abs));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    out.push(abs);
  }
  return out;
}

/**
 * The family, read off the source rather than remembered: a command belongs iff
 * it boots the shared stack AND offers a machine-readable mode. Both halves are
 * needed — `os serve` boots a kernel with no `--json`, and `os lint --json`
 * emits JSON without booting one.
 */
function discoverFamily(): string[] {
  const ids: string[] = [];
  for (const abs of commandFiles(COMMANDS_DIR)) {
    const src = readFileSync(abs, 'utf-8');
    if (!src.includes('bootSchemaStack(')) continue;
    if (!/\bjson:\s*Flags\.boolean\(/.test(src)) continue;
    const rel = relative(COMMANDS_DIR, abs).replace(/\.ts$/, '');
    const parts = rel.split(sep).filter((p) => p !== 'index');
    ids.push(parts.join(' '));
  }
  return ids.sort();
}

interface Run {
  id: string;
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(argv: string[], cwd: string, env: Record<string, string>): Promise<Omit<Run, 'id'>> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...argv],
      { cwd, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', ...env } },
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

/** Minimal project — every member boots the same stack, none of them needs more. */
const CONFIG = `
export default {
  name: 'json_purity_e2e',
  label: 'JSON Purity E2E',
  objects: [{
    name: 'jp_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

let dir: string;
let runs: Run[];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-json-purity-e2e-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);

  // Sequential, each on its own database file: several members create tables,
  // and a shared SQLite file would make one member's run depend on the order
  // the others happened to run in. Sequential also keeps peak memory at one
  // booted kernel rather than nine.
  runs = [];
  for (const [id, extra] of Object.entries(FAMILY)) {
    const slug = id.replace(/[^a-z0-9]+/gi, '-');
    const { code, stdout, stderr } = await runCli(
      [...id.split(' '), '--json', ...extra],
      dir,
      { OS_DATABASE_URL: `file:${join(dir, `${slug}.db`)}` },
    );
    runs.push({ id, code, stdout, stderr });
  }
}, 900_000);

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('the family this contract has to hold across', () => {
  it('is exactly the set listed here — a new member goes red until it is driven too', () => {
    expect(discoverFamily()).toEqual(Object.keys(FAMILY).sort());
  });
});

describe.each(Object.keys(FAMILY))('os %s --json', (id) => {
  const runOf = () => {
    const run = runs.find((r) => r.id === id);
    if (!run) throw new Error(`no run captured for '${id}'`);
    return run;
  };

  it('emits ONE JSON document on stdout — a bare JSON.parse, no extraction', () => {
    const run = runOf();
    // `JSON.parse(run.stdout)` directly, not a payload-hunting helper. Under
    // the defect this threw `Unexpected token 'S', "[Standalone"...`.
    const payload = JSON.parse(run.stdout);
    expect(payload).toBeTypeOf('object');
    expect(payload).not.toBeNull();
  });

  it('leaves no kernel-logger record on stdout', () => {
    const run = runOf();
    // The rendering `ObjectLogger` emits at `pretty` (the CLI's format):
    // `<iso-ts> INFO …`. Asserted separately from the parse so a regression
    // names its cause rather than only `Unexpected token`.
    expect(run.stdout).not.toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(DEBUG|INFO|WARN)\b/m);
    expect(run.stdout).not.toContain('[StandaloneStack]');
  });

  it('still shows the operator every boot diagnostic — on stderr', () => {
    const run = runOf();
    for (const line of BOOT_DIAGNOSTICS) expect(run.stderr).toContain(line);
  });
});
