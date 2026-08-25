// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12125 — `os validate --json`'s FAILURE payloads dropped the `conversions`
 * field the run had ALREADY COMPUTED, on all five of its failure exits.
 *
 * The same "computed, then dropped on a failure exit" shape as the `warnings`
 * family (#11643 / #11391 / #11772 / #12047), one FIELD over. Measured by the
 * filer at `origin/main` 2ba4329, two runs over the same stack differing only
 * in one field's `type`:
 *
 *   converts + otherwise VALID   → keys include `conversions`, one notice in it
 *   converts + parse error       → keys are [duration, errors, valid, warnings]
 *
 * `conversionNotices` is filled by the `onConversionNotice` sink handed to
 * `normalizeStackInput`, which runs at step 2 — ABOVE `safeParse` and above
 * every later gate. So on each failure exit the notice was already in hand and
 * was then discarded; `conversions` reached the terminal success payload alone.
 *
 * ## Why the dropped field matters more than its size suggests
 *
 * An auto-converted key is the one advisory class carrying an EXPIRY:
 * `retiresIn` names the protocol major where the old shape stops loading. A CI
 * job gating on `os validate --json` therefore could not see that the tree
 * depends on a conversion about to retire until every unrelated failure in the
 * tree was fixed first — the notice was withheld exactly while the tree was
 * broken, which is when an author is most likely to be editing it.
 *
 * ## The ruling these pins encode
 *
 * Maintainer, 2026-08-25 on #11772/#12047, applied here to `conversions` under
 * the same-family rule: every failure exit carries the lists the run has
 * ALREADY COMPUTED, so the field means the same thing on every exit and a
 * machine consumer has exactly one way to read it.
 *
 * ⛔ CARRYING, NOT COMPUTING. The fix is a pure SCOPE change — the sink array
 * moved above the `try` so the catch-all can read it — and `normalizeStackInput`
 * still runs at exactly step 2. The `throw at load` pin below is the half that
 * holds that line: an exit ABOVE the computation reports `[]`, and if anyone
 * hoists the normalize call to make that exit look fuller, it goes red.
 *
 * ## ⛔ WHAT THESE PINS DO NOT DECIDE
 *
 * Whether `warnings` and `conversions` should be FOLDED into one field is an
 * open question (raised by the filer, not addressed by the ruling) and this
 * card had no authority to settle it. `fields stay separate` below is a
 * REGRESSION GUARD recording the shape as-shipped — green before and after this
 * change — ⛔ not an argument that folding is wrong. If the fold is later
 * decided, that pin is the one to revisit, deliberately.
 *
 * ## WHAT THESE PINS ASSERT — "what the run computed", not "the key exists"
 *
 * ⭐ A pin asserting `'conversions' in payload` passes against a `conversions:
 * []` hard-coded at every exit — the defect with a lid on it. So every fixture
 * here drives a LIVE conversion (`page-kind-jsx-to-html`, ADR-0087 D2, protocol
 * 11, on `pages[0].kind: 'jsx'`) and each exit is asserted to carry exactly the
 * notice the run had computed by then — no fewer, and NO MORE:
 *
 *   exit                  | conversions
 *   ----------------------+---------------------------------
 *   parse failure         | the one notice
 *   rule errors           | the one notice
 *   capability errors     | the one notice
 *   doc errors            | the one notice
 *   catch-all (late)      | the one notice
 *   catch-all (at load)   | [] — step 2 never ran
 *   success (control)     | the one notice
 *
 * The "NO MORE" half is the array being asserted whole, so a second live
 * conversion firing from a fixture would be caught rather than absorbed.
 *
 * ## Both directions of the instrument are proven
 *
 * `converts nothing` runs the SAME failure exit with `kind: 'html'` — already
 * canonical, nothing to convert — and requires `[]`. Without it, a payload with
 * the notice hard-coded in would satisfy every assertion above; with it, the
 * field is shown to track what the run actually computed. That is the negative
 * whose positive is every other test in this file.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, "the SOURCE entry point — same
 * CLI, run from `src/` through tsx". `validate.ts` is loaded from source by the
 * child, so an ablation of that file is measured without a rebuild. Its
 * DEPENDENCY `@objectstack/spec` — which owns the conversion itself — does
 * resolve through `exports` to `dist/`, and this change does not touch it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const VALIDATE_TS = resolve(HERE, '../src/commands/validate.ts');

/** The live ADR-0087 D2 conversion these fixtures drive (protocol 11). */
const CONVERSION_ID = 'page-kind-jsx-to-html';
/** The FATAL capability token — `{package: null, edition: 'cloud'}` in the spec
 *  registry, so it classifies `unavailable` whatever is installed. */
const FATAL_TOKEN = 'governance';

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
 * parameter so the negative control can run the identical shape with the
 * CANONICAL spelling, where there is nothing to convert.
 */
function stack(ns: string, opts: { pageKind?: string; requires?: string[]; extraFields?: string } = {}): string {
  const { pageKind = 'jsx', requires = [], extraFields = '' } = opts;
  return `
export default {
  manifest: { id: 'com.example.${ns}', name: '${ns}', version: '1.0.0', type: 'app', namespace: '${ns}' },
  requires: [${requires.map((r) => `'${r}'`).join(', ')}],
  pages: [{ name: 'landing', label: 'Landing', kind: '${pageKind}', source: '<div>hi</div>' }],
  objects: [
    {
      name: '${ns}_ticket',
      label: 'Ticket',
      sharingModel: 'private',
      fields: {
        title: { type: 'text', label: 'Title' },${extraFields}
      },
    },
  ],
};
`;
}

const DOC_PLAIN = `---
title: Wrong namespace
---

Body text.
`;

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

/**
 * Asserts the payload carries EXACTLY the one computed notice. `toEqual` over
 * the whole array is the "and NO MORE" half.
 */
function expectTheOneNotice(payload: Record<string, unknown>, label: string): void {
  expect(conversionsOf(payload), `${label}: expected exactly the one computed conversion notice`).toEqual([
    expect.objectContaining(THE_NOTICE),
  ]);
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-validate-fail-conversions-'));
  const make = (name: string, config: string, docs: Array<[string, string]> = []): string => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    if (docs.length > 0) mkdirSync(join(dir, 'src', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), config);
    for (const [file, body] of docs) writeFileSync(join(dir, 'src', 'docs', file), body);
    dirs[name] = dir;
    return dir;
  };

  // parse failure — a second field whose `type` is not a field type. The
  // conversion runs at step 2, above `safeParse`.
  make('parsefail', stack('pfail', { extraFields: `
        broken: { type: 'this_is_not_a_field_type', label: 'Broken' },` }));

  // ⭐ the negative control — the SAME exit, the CANONICAL page kind. Nothing
  // to convert, so `conversions` must be empty.
  make('parsefail_nc', stack('pnc', { pageKind: 'html', extraFields: `
        broken: { type: 'this_is_not_a_field_type', label: 'Broken' },` }));

  // rule errors — an expression naming a field that does not resolve.
  make('rulefail', stack('rfail', { extraFields: `
        subject: { type: 'text', label: 'Subject', visibleWhen: { dialect: 'cel', source: 'record.zzz_no_such_field' } },` }));

  // capability errors — the FATAL token.
  make('capfail', stack('cfail', { requires: [FATAL_TOKEN] }));

  // doc errors — a doc whose name carries no namespace prefix.
  make('docsfail', stack('dfail'), [['otherns_guide.md', DOC_PLAIN]]);

  // catch-all, LATE — `src/docs` is a FILE, so `readdirSync` raises ENOTDIR
  // inside `collectAndLintDocs`, well below step 2.
  const thrown = make('thrown', stack('tfail'));
  mkdirSync(join(thrown, 'src'), { recursive: true });
  writeFileSync(join(thrown, 'src', 'docs'), 'not a directory\n');

  // catch-all, AT LOAD — the config throws on import, ABOVE step 2.
  make('earlythrow', `
throw new Error('zzz_config_module_threw');
export default {};
`);

  // The control — the same shape, reaching SUCCESS.
  make('control', stack('ctrl'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#12125 — every `os validate --json` failure exit carries the conversions the run computed', () => {
  it('control — the fixture shape DOES drive a live conversion on the success exit', async () => {
    // ⭐ Anti-vacuity for every assertion below: without this, a fixture that
    // never converted anything would satisfy the failure-exit pins for the
    // wrong reason. This is also the run the filer measured.
    const run = await runCli(['validate', '--json'], dirs.control);
    expect(run.code, `expected the control to pass:\n${run.stdout}${run.stderr}`).toBe(0);
    const payload = payloadOf(run, 'control');
    expect(payload.valid).toBe(true);
    expectTheOneNotice(payload, 'control');
    // The expiry is the reason this field cannot just be dropped into prose.
    expect(typeof (conversionsOf(payload)[0] as { retiresIn?: unknown }).retiresIn).toBe('number');
  }, 120_000);

  it('parse failure — THE HEADLINE: the notice computed at step 2 survives the schema error', async () => {
    const run = await runCli(['validate', '--json'], dirs.parsefail);
    expect(run.code, `expected the parse to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'parsefail');
    expect(payload.valid).toBe(false);
    expect(Array.isArray(payload.errors), 'the parse exit reports under `errors`').toBe(true);
    expectTheOneNotice(payload, 'parsefail');
  }, 120_000);

  it('⭐ converts nothing — the SAME exit reports `[]`, so the field tracks the run', async () => {
    // The instrument's negative, whose positive is every other test here. A
    // `conversions: [THE_NOTICE]` hard-coded at the exits would pass all of
    // them and fail this one.
    const run = await runCli(['validate', '--json'], dirs.parsefail_nc);
    expect(run.code, `expected the parse to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'parsefail_nc');
    expect(payload.valid).toBe(false);
    expect('conversions' in payload, 'the field must be PRESENT even when empty').toBe(true);
    expect(payload.conversions, 'a canonical page kind converts nothing').toEqual([]);
  }, 120_000);

  it('rule errors — the notice rides the author-time gate', async () => {
    const run = await runCli(['validate', '--json'], dirs.rulefail);
    expect(run.code, `expected the rule gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'rulefail');
    expect(payload.valid).toBe(false);
    expect((payload.errors as Array<{ rule: string }>).map((i) => i.rule)).toContain('expression-invalid');
    expectTheOneNotice(payload, 'rulefail');
  }, 120_000);

  it('capability errors — the notice rides the #3366 preflight gate', async () => {
    const run = await runCli(['validate', '--json'], dirs.capfail);
    expect(run.code, `expected the capability gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'capfail');
    expect(payload.valid).toBe(false);
    expect((payload.errors as Array<{ token: string }>).map((i) => i.token)).toEqual([FATAL_TOKEN]);
    expectTheOneNotice(payload, 'capfail');
  }, 120_000);

  it('doc errors — the notice rides the ADR-0046 docs gate', async () => {
    const run = await runCli(['validate', '--json'], dirs.docsfail);
    expect(run.code, `expected the docs gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'docsfail');
    expect(payload.valid).toBe(false);
    expect((payload.errors as Array<{ rule: string }>).map((i) => i.rule)).toEqual(['docs/namespace-prefix']);
    expectTheOneNotice(payload, 'docsfail');
  }, 120_000);

  it('catch-all (late throw) — a THROWN failure still reports the computed notice', async () => {
    // Before this change the sink was declared INSIDE the `try`, so the
    // catch-all could not read it at all — the field was structurally
    // unreachable from this exit rather than merely omitted.
    const run = await runCli(['validate', '--json'], dirs.thrown);
    expect(run.code, `expected the docs read to throw:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'thrown');
    expect(String(payload.error)).toContain('ENOTDIR');
    expectTheOneNotice(payload, 'thrown');
  }, 120_000);

  it('catch-all (throw at load) — `conversions` is PRESENT and empty, because step 2 never ran', async () => {
    // ⛔ The line that holds "carrying, not computing": this exit is ABOVE the
    // normalize call, so `[]` is the honest reading. Hoisting the computation
    // up to make it look fuller turns this red.
    //
    // ⛔ Empty here is NOT "this tree converts nothing" — it is "this run
    // stopped before the conversion layer ran", and that distinction is what
    // the changeset tells consumers.
    const run = await runCli(['validate', '--json'], dirs.earlythrow);
    expect(run.code, `expected the config module to throw:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'earlythrow');
    expect(String(payload.error)).toContain('zzz_config_module_threw');
    expect('conversions' in payload, 'the load-failure exit omits `conversions` entirely').toBe(true);
    expect(payload.conversions).toEqual([]);
  }, 120_000);

  it('REGRESSION GUARD — `warnings` and `conversions` stay separate fields', async () => {
    // ⛔ NOT an argument that folding is wrong. Whether the two should become
    // one field is an OPEN question this card was not given authority to
    // settle; this records the shape as-shipped so a fold happens deliberately
    // rather than as a side effect. Green both before and after #12125.
    const run = await runCli(['validate', '--json'], dirs.docsfail);
    const payload = payloadOf(run, 'docsfail');
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    expect(
      warnings.filter((w) => typeof w === 'object' && w !== null && 'conversionId' in (w as object)),
      'a conversion notice appeared inside `warnings` — the two fields were folded',
    ).toEqual([]);
    // ⛔ Deliberately asserts the FOLD property and nothing else, so this pin is
    // green in BOTH states — that is what makes it a regression guard rather
    // than evidence for this change. "the payload carries the one notice" is
    // the `doc errors` test's job, on this very fixture; asserting it here too
    // made this pin red-before and its name a lie. (Measured: it failed in the
    // ablated tree for that reason alone.)
  }, 120_000);
});

// ── Exhaustiveness, read off the source ─────────────────────────────────────

/**
 * Every `emitJson` payload literal in a command file, extracted by brace
 * matching from the `{` that opens the first argument. `${…}` inside a template
 * literal is balanced, so the depth arithmetic survives a payload built from
 * one. (Same extractor as the `warnings` pins one field over.)
 */
function payloadLiterals(src: string): string[] {
  const out: string[] = [];
  const NEEDLE = 'await emitJson(';
  let i = src.indexOf(NEEDLE);
  while (i !== -1) {
    const open = src.indexOf('{', i + NEEDLE.length);
    if (open === -1) break;
    let depth = 0;
    let j = open;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(open, j + 1));
    i = src.indexOf(NEEDLE, j);
  }
  return out;
}

describe('#12125 — the contract is exhaustive over `validate.ts`, not just over the exits pinned above', () => {
  const SRC = readFileSync(VALIDATE_TS, 'utf8');

  it('the extractor produces a POSITIVE before its negative is trusted', () => {
    // ⭐ A "no payload lacks `conversions`" pass is worthless from an instrument
    // that finds no payloads, or that cannot see a missing key. Both halves are
    // demonstrated on synthetic input first.
    const SYNTHETIC = [
      "await emitJson({ valid: false, errors, duration: timer.elapsed() });",
      "await emitJson({ valid: false, error: `x: ${e.message}`, conversions: conversionNotices });",
    ].join('\n');
    const found = payloadLiterals(SYNTHETIC);
    expect(found).toHaveLength(2);
    expect(found.filter((p) => !p.includes('conversions:'))).toHaveLength(1);
    // …and the template literal's `${…}` did not break the brace matching.
    expect(found[1]).toContain('conversions: conversionNotices');
  });

  it('all 6 `emitJson` exits carry `conversions` — 5 failure exits and the success payload', () => {
    const literals = payloadLiterals(SRC);
    expect(literals, 'the `emitJson` exit count moved — a new exit must carry `conversions` too').toHaveLength(6);
    expect(literals.filter((p) => p.includes('valid: false'))).toHaveLength(5);
    expect(literals.filter((p) => p.includes('valid: true'))).toHaveLength(1);

    const bare = literals.filter((p) => !p.includes('conversions:'));
    expect(
      bare,
      'an `os validate --json` exit publishes no `conversions`, so a consumer cannot tell ' +
        '"this tree converts nothing" from "this run stopped early" through it (#12125)',
    ).toEqual([]);
  });

  it('every exit reads the ONE sink, and the sink outlives the `try`', () => {
    // The scope change is the whole fix for the catch-all exit: a sink declared
    // inside the `try` is unreachable from `catch`, so that exit could not have
    // carried the field however the payload was written.
    expect(SRC).toMatch(/const conversionNotices: ConversionNotice\[\] = \[\];\s*\n\s*\n\s*try \{/);
    for (const literal of payloadLiterals(SRC)) {
      expect(literal, 'an exit spells its own conversion list instead of reading the shared sink').toContain(
        'conversions: conversionNotices',
      );
    }
  });

  it('⛔ the conversion layer still runs at step 2 — carrying, not computing', () => {
    // The static half of the `throw at load` pin: the sink is DECLARED above
    // the `try`, but the call that fills it stays inside, below `loadConfig`.
    const declAt = SRC.indexOf('const conversionNotices: ConversionNotice[] = [];');
    const tryAt = SRC.indexOf('\n    try {');
    const loadAt = SRC.indexOf('await loadConfig(');
    const normalizeAt = SRC.indexOf('normalizeStackInput(');
    expect(declAt, 'the sink declaration was not found').toBeGreaterThan(-1);
    expect(declAt, 'the sink must be declared ABOVE the `try` so `catch` can read it').toBeLessThan(tryAt);
    expect(normalizeAt, 'the normalize call must stay INSIDE the `try`').toBeGreaterThan(tryAt);
    expect(
      normalizeAt,
      'the normalize call moved above `loadConfig` — that is computing earlier, not carrying',
    ).toBeGreaterThan(loadAt);
  });
});
