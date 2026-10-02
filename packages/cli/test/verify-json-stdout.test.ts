// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `os verify --json` on a stack that REACHES THE RUNTIME STAGE writes
 * exactly one JSON document to stdout, and the boot's diagnostics are moved to
 * stderr rather than destroyed (#21324).
 *
 * ## The defect
 *
 * `objectstack verify --json > report.json` exited 0 and left a file no JSON
 * parser accepts. Measured through the real CLI on a clean stack before this
 * landed: 349 stdout lines, the document starting at line 319, and
 * `JSON.parse` failing at position 4. Every line ahead of it came from one of
 * three independent writers:
 *
 *   - the kernel's `ObjectLogger` — 174 lines, 5 of them WARN (`info` and
 *     `warn` go to stdout by design, `packages/core/src/logger.ts`);
 *   - the ObjectQL registry's `console.log` — 143 `[Registry] Installed
 *     package: …` lines;
 *   - `HonoServerPlugin`'s `console.log` when the stack stops — 1 line.
 *
 * So a kernel logger setting could never have produced one document: two of
 * the three writers never pass through it.
 *
 * ## What is pinned
 *
 *   - `--json`: stdout is BYTE-EQUAL to the re-serialized document — a bare
 *     `JSON.parse`, and then nothing else on the stream, whoever wrote it —
 *     and the document is the RUNTIME report (`crud`, `hardFailures`), so the
 *     run really reached the stage whose boot writes the lines;
 *   - the diagnostics are moved, never destroyed: stderr carries the kernel
 *     logger's records, WARN among them, and the registry's `console.log`
 *     lines. Silencing the logger would make stdout parse too, and go red here;
 *   - the text face is unchanged: without `--json`, the kernel logger's
 *     records still go to stdout beside the report.
 *
 * The stage-1 refusal face (`{ error, errors }`, nothing booted) is pinned by
 * `verify-author-time-stage.test.ts`.
 *
 * Spawned rather than run in-process: the stream a byte lands on is the
 * contract, and only a real process has the streams a consumer redirects.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

/** A stack the author-time rules pass, so `os verify` reaches the runtime stage. */
const STACK = {
  manifest: {
    id: 'com.example.verify-json-stdout',
    namespace: 'vj',
    version: '1.0.0',
    name: 'Verify JSON Stdout',
    type: 'app',
    engines: { protocol: '^17' },
  },
  objects: [
    {
      name: 'vj_note',
      label: 'Note',
      pluralLabel: 'Notes',
      sharingModel: 'private',
      fields: {
        title: { type: 'text', label: 'Title', required: true },
        done: { type: 'boolean', label: 'Done' },
      },
    },
  ],
};

/** The rendering `ObjectLogger` writes at `pretty` (the CLI's format): `<iso-ts> LEVEL …`. */
const LOGGER_RECORD = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(DEBUG|INFO|WARN)\b/m;
const LOGGER_WARN_RECORD = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+WARN\b/m;

/** The second writer: a `console.log` in the ObjectQL registry, outside the kernel logger. */
const REGISTRY_CONSOLE_LINE = '[Registry] Installed package';

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(dir: string, args: string[]): Run {
  // Through tsx, so the child runs this checkout's `src/` — under plain node
  // oclif resolves the command from `dist/`, and the pin would measure
  // whatever was last built.
  const r = spawnSync(TSX, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    // Every spawned child under this directory declares its environment at the
    // call site (#11595). `OS_REGISTRY_LOG: 'info'` is the shipped default,
    // restated because this package's vitest config sets `warn` for its own
    // workers and the child would inherit it: at `warn` the registry's
    // `console.log` — the writer a logger-level fix cannot reach — never speaks,
    // and the pin would hold over one writer instead of the three an operator's
    // run has.
    env: childEnv({ NO_COLOR: '1', OS_REGISTRY_LOG: 'info' }),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('os verify --json on a stack that reaches the runtime stage (#21324)', () => {
  let dir: string;
  let json: Run;
  let text: Run;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-verify-json-stdout-'));
    writeFileSync(join(dir, 'objectstack.config.mjs'), defineStackSource(STACK));
    linkSpec(dir);
    json = runCli(dir, ['verify', '--json']);
    text = runCli(dir, ['verify']);
  }, 360_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes exactly one JSON document to stdout, and it is the runtime report', () => {
    expect(json.status, `os verify --json failed on a clean stack:\n${json.stdout}\n${json.stderr}`).toBe(0);
    // A bare parse — no extraction. Under the defect this threw at position 4.
    const doc = JSON.parse(json.stdout) as { crud?: unknown; hardFailures?: unknown };
    // And NOTHING else on the stream: a stray line after the document, or a
    // second document, would survive a lenient reader but not this equality.
    expect(json.stdout).toBe(`${JSON.stringify(doc, null, 2)}\n`);
    expect(doc.crud).toBeTypeOf('object');
    expect(doc.hardFailures).toBe(0);
  });

  it('leaves no record of either writer on stdout, naming the cause separately from the parse', () => {
    expect(json.stdout).not.toMatch(LOGGER_RECORD);
    expect(json.stdout).not.toContain(REGISTRY_CONSOLE_LINE);
  });

  it('moves the diagnostics to stderr instead of destroying them — WARN records included', () => {
    expect(json.stderr).toMatch(LOGGER_RECORD);
    expect(json.stderr).toMatch(LOGGER_WARN_RECORD);
    expect(json.stderr).toContain(REGISTRY_CONSOLE_LINE);
  });

  it('leaves the text face as it was: the kernel logger still writes to stdout beside the report', () => {
    expect(text.status, `os verify failed on a clean stack:\n${text.stdout}\n${text.stderr}`).toBe(0);
    expect(text.stdout).toMatch(LOGGER_RECORD);
    expect(text.stdout).toContain(REGISTRY_CONSOLE_LINE);
    expect(text.stdout).toContain('verify passed');
  });
});
