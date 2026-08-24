// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11643 — `os build --json` dropped the undeclared-authoring-key warnings
 * (#3786 / ADR-0087) that `os validate --json` carries.
 *
 * `compile.ts` computed `unknownKeyFindings` and then printed them under an
 * `if (... && !flags.json)` guard, so in JSON mode they were computed and
 * discarded. Measured at `origin/main` 4ceae8ab0 over the fixture below —
 * one authored stack, three faces:
 *
 *   os build           ->  ⚠ Undeclared authoring keys (1) — dropped at load (#3786)
 *   os validate --json ->  warnings: [ {rule record}, "…zzzUnknownKey…", … ]
 *   os build   --json ->  warnings: [ {rule record} ]              <- the defect
 *
 * So a CI consumer reading `warnings` off `os build --json` saw a strictly
 * smaller set than the same consumer reading it off `os validate --json` on the
 * same tree, and the missing members were exactly the "your key was dropped"
 * ones — the class the pipeline exists to surface.
 *
 * It also made a promise elsewhere false. #11529's truncation notice
 * (`printAuthoringAdvisories`, landed as #11645) ends with "re-run with --json
 * for the full list". That pointer is only honest if `--json` actually carries
 * the complete set.
 *
 * ## WHAT THESE PINS ASSERT — parity measured from ONE tree
 *
 * Not "build prints a string somewhere". The two commands are run over the
 * SAME temp project inside one test and their payloads compared, so the pin
 * cannot go green on a build that reports a *different* set from validate.
 * The reverse end is pinned too: on a clean fixture neither command reports an
 * undeclared-key line, so "present" is distinguishable from "always present".
 *
 * ## Shape: parity with `os validate --json`, NOT a sibling key
 *
 * `validate.ts` maps the findings through `formatUnknownAuthoringKey` and
 * spreads the resulting STRINGS into `warnings` beside the authoring-rule
 * records — its `warnings` has been heterogeneous (`object,string,string`
 * above) since it fixed this same defect on its own face. `build --json` now
 * does the identical thing, so one payload shape carries one class of warning
 * across both commands.
 *
 * This is deliberately the opposite call from `bodyExtractionWarnings`, which
 * sits under its own key one line below in the payload. That is not an
 * inconsistency: `{origin,reason}` extraction records have NO counterpart in
 * `os validate --json` (validate lowers no handlers), so there is no parity to
 * hold and a sibling key is right. The undeclared-key findings do have a
 * counterpart, and it is already in `warnings`.
 *
 * The payload's top-level key set is pinned unchanged below for that reason:
 * this fix fills a key the payload already declared rather than adding a new
 * machine-contract surface.
 *
 * ## Why the fixture plants the key inside `visibleWhen`
 *
 * An undeclared key directly on an object or a field is a hard parse ERROR
 * today — #4001 closed both roots, and `os build` exits 1 before any of this
 * runs. The #3786 lint's live subject is the strip-mode shapes still NESTED
 * under a closed root (the walker deliberately does not gate on the root's
 * posture, for exactly this reason). `field.visibleWhen` is one of them: the
 * expression object declares `dialect`/`source`/`ast`/`meta` and strips the
 * rest. So the fixture is a stack that BUILDS CLEANLY (exit 0) while quietly
 * dropping an authored value — which is the whole failure class.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

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

function payloadOf(run: Run, label: string): Record<string, unknown> {
  try {
    return JSON.parse(run.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

/** The planted key. Distinctive enough that a grep for it cannot match anything else. */
const PLANTED_KEY = 'zzzUndeclaredProbeKey';

/**
 * A stack that builds cleanly and carries BOTH advisory kinds:
 *
 *  - a bare `unique: true` index -> one authoring-RULE advisory (a RECORD), so
 *    a regression that dropped `ruleAdvisories` while folding in the strings
 *    goes red here rather than passing quietly;
 *  - `PLANTED_KEY` inside the field's `visibleWhen` -> one undeclared-key
 *    finding (a STRING), the subject of this file.
 */
const CONFIG_WITH_UNDECLARED_KEY = `
export default {
  manifest: { id: 'com.example.ukparity', name: 'ukparity', version: '1.0.0', type: 'app', namespace: 'ukparity' },
  objects: [
    {
      name: 'uk_ticket',
      label: 'Ticket',
      sharingModel: 'private',
      indexes: [{ name: 'uk_title_idx', fields: ['title'], unique: true }],
      fields: {
        title: {
          type: 'text',
          label: 'Title',
          visibleWhen: { dialect: 'cel', source: 'true', ${PLANTED_KEY}: 1 },
        },
      },
    },
  ],
};
`;

/**
 * The control: byte-identical but for the planted key. Without it, an assertion
 * that `warnings` contains an undeclared-key line would also pass against a
 * build that emitted one unconditionally.
 */
const CONFIG_CLEAN = `
export default {
  manifest: { id: 'com.example.ukclean', name: 'ukclean', version: '1.0.0', type: 'app', namespace: 'ukclean' },
  objects: [
    {
      name: 'uk_ticket',
      label: 'Ticket',
      sharingModel: 'private',
      indexes: [{ name: 'uk_title_idx', fields: ['title'], unique: true }],
      fields: {
        title: {
          type: 'text',
          label: 'Title',
          visibleWhen: { dialect: 'cel', source: 'true' },
        },
      },
    },
  ],
};
`;

/** Every undeclared-key line in a `warnings` list, whatever else rides beside it. */
function undeclaredKeyLines(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) return [];
  return warnings.filter(
    (w): w is string => typeof w === 'string' && w.includes('is not a declared') && w.includes('dropped at load'),
  );
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-uk-parity-'));
  for (const [name, source] of Object.entries({ planted: CONFIG_WITH_UNDECLARED_KEY, clean: CONFIG_CLEAN })) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), source);
    dirs[name] = dir;
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#11643 — `os build --json` carries the undeclared-authoring-key warnings', () => {
  it('reports the planted key in the payload, and the stack still builds (exit 0)', async () => {
    const run = await runCli(['build', '--json'], dirs.planted);
    expect(run.code, `os build --json failed:\n${run.stdout}\n${run.stderr}`).toBe(0);

    const payload = payloadOf(run, 'os build --json');
    expect(payload.success).toBe(true);

    const lines = undeclaredKeyLines(payload.warnings);
    expect(
      lines.join('\n'),
      'the payload carries no undeclared-key finding — computed and then discarded, which is the defect',
    ).toContain(PLANTED_KEY);
  }, 120_000);

  it('carries the SAME undeclared-key set `os validate --json` reports on the same tree', async () => {
    // Parity is measured, not assumed: both commands run over ONE project.
    const build = await runCli(['build', '--json'], dirs.planted);
    const validate = await runCli(['validate', '--json'], dirs.planted);
    expect(build.code, `build failed:\n${build.stdout}${build.stderr}`).toBe(0);
    expect(validate.code, `validate failed:\n${validate.stdout}${validate.stderr}`).toBe(0);

    const fromBuild = undeclaredKeyLines(payloadOf(build, 'os build --json').warnings);
    const fromValidate = undeclaredKeyLines(payloadOf(validate, 'os validate --json').warnings);

    // The control for the comparison below: an empty-vs-empty match would
    // "pass" while proving nothing about either command.
    expect(fromValidate.length, 'the fixture stopped producing an undeclared-key finding at all').toBeGreaterThan(0);
    expect(new Set(fromBuild), 'a CI consumer reading `warnings` off the two commands gets different sets').toEqual(
      new Set(fromValidate),
    );
  }, 180_000);

  it('folds them in BESIDE the authoring-rule advisories, in the shape `os validate --json` uses', async () => {
    const run = await runCli(['build', '--json'], dirs.planted);
    const payload = payloadOf(run, 'os build --json');
    const warnings = payload.warnings as unknown[];

    // The rule advisories still ride in the same key — the fold added to the
    // list, it did not replace it.
    const records = warnings.filter((w) => typeof w === 'object' && w !== null) as Array<Record<string, unknown>>;
    expect(
      records.map((r) => r.rule),
      'the authoring-rule advisory records were lost from `warnings`',
    ).toContain('unique/unscoped-declared-index');

    // …and the undeclared-key members are STRINGS, which is the shape
    // `os validate --json` ships them in. A consumer reads one shape from
    // either command rather than learning two.
    expect(undeclaredKeyLines(warnings).length).toBe(1);
  }, 120_000);

  it('adds NO new top-level key to the payload — this fills a declared key, it is not a new surface', async () => {
    const run = await runCli(['build', '--json'], dirs.planted);
    const payload = payloadOf(run, 'os build --json');
    expect(Object.keys(payload).sort()).toEqual(
      [
        'bodyExtractionWarnings',
        'conversions',
        'duration',
        'handlersBundled',
        'output',
        'runtimeModule',
        'runtimeModuleSize',
        'size',
        'specVersionGap',
        'stats',
        'success',
        'warnings',
      ].sort(),
    );
  }, 120_000);

  it('CONTROL — a clean stack reports no undeclared-key line on either face', async () => {
    const build = await runCli(['build', '--json'], dirs.clean);
    const validate = await runCli(['validate', '--json'], dirs.clean);
    expect(build.code, `build failed:\n${build.stdout}${build.stderr}`).toBe(0);
    expect(validate.code, `validate failed:\n${validate.stdout}${validate.stderr}`).toBe(0);

    expect(undeclaredKeyLines(payloadOf(build, 'os build --json').warnings)).toEqual([]);
    expect(undeclaredKeyLines(payloadOf(validate, 'os validate --json').warnings)).toEqual([]);
  }, 180_000);

  it('leaves the TEXT face saying what it always said', async () => {
    // The findings are now formatted once, at the computation site, and
    // consumed by both faces. The text output must be what it was.
    const run = await runCli(['build'], dirs.planted);
    expect(run.code, `os build failed:\n${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain('Undeclared authoring keys (1) — dropped at load (#3786)');
    expect(run.stdout).toContain(`${PLANTED_KEY}' is not a declared field key, so its value is dropped at load.`);
  }, 120_000);
});
