// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12297 — `os lint` never surfaced an ADR-0087 D2 conversion notice, in
 * EITHER face.
 *
 * ## The class this belongs to, and the one it does not
 *
 * ⛔ NOT the "computed, then dropped on a failure exit" family (#11643 /
 * #11391 / #11772 / #12047 / #12125). Nothing was computed and discarded here.
 * `lint.ts` called `normalizeStackInput(config)` with no options object at all,
 * so no `onConversionNotice` sink existed and the notices were never PRODUCED.
 * The filer's anchored count over the whole file said so in one number:
 *
 *     grep -cE 'onConversionNotice|conversions' packages/cli/src/commands/lint.ts
 *     0
 *
 * ⭐ It is the #3782 PARITY class — two surfaces disagreeing about what an
 * author is told — and specifically the gap `os build` was in before #11772 /
 * PR #12079. `os lint` is the third of the three authoring commands the #4409
 * registry holds to one bar, and it was the only one telling an author nothing
 * about a conversion its own load path had just applied.
 *
 * ## Why a missing advisory is worth pinning
 *
 * A conversion notice is the one advisory class carrying an EXPIRY: `retiresIn`
 * names the protocol major where the old shape stops loading. Five conversions
 * are live today (protocol 11 and 15). An author or CI job whose only authoring
 * gate is `os lint` got no signal at all — not in the console, not in `--json` —
 * right up until the conversion retired and their metadata stopped loading.
 *
 * ## ⛔ WHAT THESE PINS DO NOT DECIDE
 *
 * Whether an auto-converted key should instead become a `LintIssue` folded into
 * `issues` — the `os lint` shape of the same question raised on #12125, where
 * it is whether `warnings` and `conversions` should be one field — is OPEN. The
 * 2026-08-25 ruling did not address it and #12125's implementer explicitly
 * withheld an answer. This change had no authority to settle it, so it mirrors
 * the shipped sibling shape. `counts are unchanged` below is a REGRESSION GUARD
 * recording the as-shipped shape — green before and after — ⛔ never an argument
 * that folding is wrong. If the fold is later decided, that is the pin to
 * revisit deliberately.
 *
 * ## WHAT THESE PINS ASSERT — a notice the run really produced
 *
 * ⭐ A pin asserting "a notice appears" is worthless against a fixture that
 * converts nothing, and `expect('conversions' in payload)` is green against a
 * `conversions: []` hard-coded at the exit — the defect with a lid on it. So:
 *
 *   - every positive fixture drives a LIVE conversion (`page-kind-jsx-to-html`,
 *     ADR-0087 D2, protocol 11, on `pages[0].kind: 'jsx'`), and the notice is
 *     asserted by IDENTITY — `conversionId` plus the converted path — over the
 *     WHOLE array, so "and NO MORE" is asserted too;
 *   - `converts nothing` runs the identical shape with the canonical spelling
 *     `kind: 'html'` and requires the field to be present and EMPTY, in both
 *     faces. That is the negative whose positive is every other test here:
 *     without it, a hard-coded notice would satisfy all of them.
 *
 * The `--json` key is asserted three ways — on `Object.keys`, on the SERIALIZED
 * BYTES, and by value — because `JSON.stringify` drops an `undefined` value
 * silently, so a payload that spelled the key but never filled it would still
 * read as "the key is there" to a test that only checked the parsed object.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, the SOURCE entry point — same
 * CLI, run from `src/` through tsx — so `lint.ts` is loaded from source by the
 * child and an ablation of it is measured without a rebuild. Its DEPENDENCY
 * `@objectstack/spec`, which owns the conversion itself, does resolve through
 * `exports` to `dist/`, and this change does not touch it.
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

/** The live ADR-0087 D2 conversion these fixtures drive (protocol 11). */
const CONVERSION_ID = 'page-kind-jsx-to-html';

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

/**
 * A stack whose `pages[0].kind` drives the live conversion. `pageKind` is a
 * parameter so the negative control runs the identical shape with the CANONICAL
 * spelling, where there is nothing to convert.
 *
 * `source` is a single-root element: the `jsx-no-root` authoring rule rejects a
 * bare string, so a fixture that used one would never reach the exit under test.
 */
function stack(ns: string, opts: { pageKind?: string } = {}): string {
  const { pageKind = 'jsx' } = opts;
  return `
export default {
  manifest: { id: 'com.example.${ns}', name: '${ns}', version: '1.0.0', type: 'app', namespace: '${ns}' },
  pages: [{ name: 'landing', label: 'Landing', kind: '${pageKind}', source: '<div>hi</div>' }],
  objects: [
    {
      name: '${ns}_ticket',
      label: 'Ticket',
      sharingModel: 'private',
      fields: {
        title: { type: 'text', label: 'Title' },
      },
    },
  ],
};
`;
}

/** The `conversions` field, as a list, whatever the payload shipped. */
function conversionsOf(payload: Record<string, unknown>): unknown[] {
  return Array.isArray(payload.conversions) ? (payload.conversions as unknown[]) : [];
}

/**
 * The one notice this fixture family must produce, asserted by IDENTITY —
 * `conversionId` plus the converted path — rather than by arity alone, so a
 * different conversion firing could not satisfy it.
 */
const THE_NOTICE = {
  conversionId: CONVERSION_ID,
  surface: 'page.kind',
  from: 'jsx',
  to: 'html',
  path: 'pages[0].kind',
};

/** Asserts the payload carries EXACTLY the one computed notice, and no more. */
function expectTheOneNotice(payload: Record<string, unknown>, label: string): void {
  expect(conversionsOf(payload), `${label}: expected exactly the one computed conversion notice`).toEqual([
    expect.objectContaining(THE_NOTICE),
  ]);
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-lint-conversions-'));
  const make = (name: string, config: string): string => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), config);
    dirs[name] = dir;
    return dir;
  };

  // Drives the live conversion.
  make('converts', stack('cvt'));

  // ⭐ The negative control — the identical shape, the CANONICAL page kind.
  make('canonical', stack('cnl', { pageKind: 'html' }));

  // Catch-all exit, AT LOAD — the config throws on import, ABOVE the normalize
  // step, so the run must report the field EMPTY rather than absent.
  make('earlythrow', `
throw new Error('zzz_config_module_threw');
export default {};
`);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#12297 — `os lint` surfaces ADR-0087 conversion notices in both faces', () => {
  it('⭐ the fixture REALLY converts — `--json` publishes the notice the run produced', async () => {
    const run = await runCli(['lint', '--json'], dirs.converts);
    const payload = payloadOf(run, 'converts');

    // Three ways, deliberately. `Object.keys` is the one a folded-away field
    // would fail; the serialized bytes are the one an `undefined` value would
    // fail (JSON.stringify drops it silently, leaving the parsed object and the
    // bytes disagreeing); the value is the one a `[]` lid would fail.
    expect(Object.keys(payload), 'the `conversions` key must be published').toContain('conversions');
    expect(run.stdout, 'the key must survive serialization, not just exist on the object').toContain('"conversions"');
    expectTheOneNotice(payload, 'converts');

    // The expiry is the whole reason the notice cannot be flattened to prose.
    const notice = conversionsOf(payload)[0] as { retiresIn?: unknown };
    expect(typeof notice.retiresIn, '`retiresIn` names the major where the source stops loading').toBe('number');
  }, 120_000);

  it('⭐ converts nothing — the field is PRESENT and EMPTY, so it tracks the run', async () => {
    // The instrument's negative, whose positive is the test above. A
    // `conversions: [THE_NOTICE]` hard-coded at the exit would pass that one
    // and fail this one; a field omitted when empty would fail this one too.
    const run = await runCli(['lint', '--json'], dirs.canonical);
    const payload = payloadOf(run, 'canonical');

    expect(Object.keys(payload), 'the field must be PRESENT even when empty').toContain('conversions');
    expect(run.stdout, 'and present in the serialized bytes').toContain('"conversions"');
    expect(payload.conversions, 'a canonical page kind converts nothing').toEqual([]);
  }, 120_000);

  it('⭐ the human face says it too — the notice is printed, with its expiry', async () => {
    // The face an author actually reads. `--json` is not the authoring gate for
    // a human, and this command had NEITHER face.
    const run = await runCli(['lint'], dirs.converts);
    expect(run.stdout, 'the converted path').toContain('pages[0].kind');
    expect(run.stdout, 'the conversion identity').toContain(CONVERSION_ID);
    expect(run.stdout, 'the from → to rewrite').toMatch(/'jsx'.*'html'/);
    expect(run.stdout, 'the EXPIRY — the part that makes it actionable').toMatch(/retires in protocol \d+/);
  }, 120_000);

  it('⭐ the human face stays SILENT when nothing converted', async () => {
    // The negative for the console face. Without it, a notice printed
    // unconditionally would satisfy the test above.
    const run = await runCli(['lint'], dirs.canonical);
    expect(run.stdout, 'no conversion ran, so nothing may be claimed').not.toContain(CONVERSION_ID);
    expect(run.stdout, 'nor the notice wording').not.toContain('converted at load');
  }, 120_000);

  it('catch-all at load — `[]` honestly, because the normalize step never ran', async () => {
    // The sink is declared above the `try` so this exit can read it, under the
    // 2026-08-25 ruling that every failure exit carries what the run has
    // ALREADY COMPUTED. This is the half that holds the line: if anyone hoists
    // the normalize call to make this exit look fuller, `[]` stops being true.
    const run = await runCli(['lint', '--json'], dirs.earlythrow);
    const payload = payloadOf(run, 'earlythrow');

    expect(typeof payload.error, 'this is the catch-all exit').toBe('string');
    expect(Object.keys(payload), 'the field is present on the failure exit too').toContain('conversions');
    expect(payload.conversions, 'nothing was computed before the throw').toEqual([]);
  }, 120_000);

  it('REGRESSION GUARD — the notice is NOT folded into `issues`, and the counts are unchanged', async () => {
    // ⛔ Green in BOTH states, before and after this change — a guard recording
    // the as-shipped shape, ⛔ never red-before evidence. `issues` keeps meaning
    // "something to fix"; a converted key is not one, and folding it in would
    // move `total`/`warnings` for every author with a deprecated spelling. The
    // fold question is OPEN (#12125) and this pin takes no side on it.
    const converted = payloadOf(await runCli(['lint', '--json'], dirs.converts), 'converts');
    const canonical = payloadOf(await runCli(['lint', '--json'], dirs.canonical), 'canonical');

    for (const key of ['total', 'errors', 'warnings', 'suggestions'] as const) {
      expect(
        converted[key],
        `\`${key}\` must not move because a key was auto-converted — that would be the fold`,
      ).toEqual(canonical[key]);
    }
    const issues = (converted.issues ?? []) as Array<{ rule?: string; message?: string }>;
    expect(
      issues.some((i) => (i.rule ?? '').includes('conversion') || (i.message ?? '').includes('converted at load')),
      'no conversion notice may appear inside `issues`',
    ).toBe(false);
  }, 180_000);
});
