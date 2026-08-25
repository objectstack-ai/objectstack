// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12125 — `os build --json`'s FAILURE payloads dropped the `conversions` field
 * the run had ALREADY COMPUTED, on all nine of its failure exits.
 *
 * The same "computed, then dropped on a failure exit" shape as the `warnings`
 * family, one FIELD over. #12079 (for #11772) added `warnings` to all nine of
 * these exits and deliberately left `conversions` untouched, so closing that
 * card did not close this one.
 *
 * `conversionNotices` is filled by the `onConversionNotice` sink handed to
 * `normalizeStackInput` at step 2, and `conversions:` was published on the
 * terminal success payload alone.
 *
 * ## ⭐ Where this measurement DIFFERS from the `warnings` pins next door
 *
 * For `warnings`, compile's two earliest exits (2b `--strict-body` and 3 the
 * protocol parse) carry `[]` by construction: nothing advisory is computed that
 * early. `conversions` is NOT in that position — step 2 runs ABOVE both of them
 * — so those two exits carry the notice, and every one of the nine failure
 * exits below does. The only honestly-empty exit is a throw at LOAD, above step
 * 2 itself. Measured per exit rather than inherited from the sibling card.
 *
 * ## The ruling these pins encode
 *
 * Maintainer, 2026-08-25 on #11772/#12047, applied here to `conversions` under
 * the same-family rule: every failure exit carries the lists the run has
 * ALREADY COMPUTED, so the field means the same thing on every exit.
 *
 * ⛔ CARRYING, NOT COMPUTING. The fix is a pure SCOPE change — the sink array
 * moved above the `try` so the catch-all can read it — and `normalizeStackInput`
 * still runs at exactly step 2. The `throw at load` pin is the half that holds
 * that line.
 *
 * ## ⛔ WHAT THESE PINS DO NOT DECIDE
 *
 * Whether `warnings` and `conversions` should be FOLDED into one field is an
 * open question this card had no authority to settle. `fields stay separate` is
 * a REGRESSION GUARD recording the shape as-shipped — green before and after —
 * ⛔ not an argument that folding is wrong.
 *
 * ## WHAT THESE PINS ASSERT — "what the run computed", not "the key exists"
 *
 * ⭐ A pin asserting `'conversions' in payload` passes against a `conversions:
 * []` hard-coded at every exit. So every fixture drives a LIVE conversion
 * (`page-kind-jsx-to-html`, ADR-0087 D2, protocol 11, on `pages[0].kind:
 * 'jsx'`) and each exit is asserted to carry exactly that one notice — no
 * fewer, and NO MORE, the array being asserted whole. `converts nothing` runs
 * the same exit with the canonical `kind: 'html'` and requires `[]`, which is
 * the negative whose positive is every other test here.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, the SOURCE entry point (src/ via
 * tsx), so `compile.ts` is loaded from source and an ablation of it is measured
 * without a rebuild. Its DEPENDENCY `@objectstack/spec` — which owns the
 * conversion — resolves through `exports` to `dist/`, and is untouched here.
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
const COMPILE_TS = resolve(HERE, '../src/commands/compile.ts');

/** The live ADR-0087 D2 conversion these fixtures drive (protocol 11). */
const CONVERSION_ID = 'page-kind-jsx-to-html';
/** The FATAL capability token — `unavailable` whatever is installed. */
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
function stack(ns: string, opts: { pageKind?: string; requires?: string[]; extraFields?: string; extraTop?: string } = {}): string {
  const { pageKind = 'jsx', requires = [], extraFields = '', extraTop = '' } = opts;
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
  ],${extraTop}
};
`;
}

/** A hook whose body cannot be lowered — `require()` is refused (#10678). */
function unlowerableHook(ns: string): string {
  return `
  hooks: [{
    name: '${ns}_hook',
    object: '${ns}_ticket',
    events: ['beforeInsert'],
    handler: async (ctx: any) => {
      const os = require('node:os');
      return os.platform();
    },
  }],`;
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
 * `conversionId` plus the converted path — not by arity alone.
 */
const THE_NOTICE = {
  conversionId: CONVERSION_ID,
  surface: 'page.kind',
  from: 'jsx',
  to: 'html',
  path: 'pages[0].kind',
};

/** Asserts EXACTLY the one computed notice. `toEqual` is the "and NO MORE" half. */
function expectTheOneNotice(payload: Record<string, unknown>, label: string): void {
  expect(conversionsOf(payload), `${label}: expected exactly the one computed conversion notice`).toEqual([
    expect.objectContaining(THE_NOTICE),
  ]);
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-build-fail-conversions-'));
  const make = (name: string, config: string, docs: Array<[string, string]> = []): string => {
    const dir = join(root, name);
    mkdirSync(join(dir, 'src', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), config);
    for (const [file, body] of docs) writeFileSync(join(dir, 'src', 'docs', file), body);
    dirs[name] = dir;
    return dir;
  };

  // 2b — `--strict-body`. ⭐ For `warnings` this exit is empty by construction;
  //      for `conversions` it is NOT, because step 2 runs above it.
  make('strictbody', stack('sbody', { extraTop: unlowerableHook('sbody') }));

  // 3 — the protocol parse itself fails, likewise BELOW step 2.
  make('zodfail', stack('zfail', { extraFields: `
        broken: { type: 'this_is_not_a_field_type', label: 'Broken' },` }));

  // ⭐ the negative control — the SAME exit, the CANONICAL page kind.
  make('zodfail_nc', stack('znc', { pageKind: 'html', extraFields: `
        broken: { type: 'this_is_not_a_field_type', label: 'Broken' },` }));

  // 3b — an author-time rule ERROR.
  make('rulefail', stack('rfail', { extraFields: `
        subject: { type: 'text', label: 'Subject', visibleWhen: { dialect: 'cel', source: 'record.zzz_no_such_field' } },` }));

  // 3c — the FATAL capability token.
  make('capfail', stack('cfail', { requires: [FATAL_TOKEN] }));

  // 3e — a committed snapshot naming a permission set the stack does not grant.
  const amx = make('amx', stack('amx'));
  writeFileSync(
    join(amx, 'access-matrix.json'),
    JSON.stringify({
      version: 1,
      entries: [{
        permissionSet: 'ghost_ps', object: 'amx_ticket',
        create: false, read: true, edit: false, delete: false,
        viewAllRecords: false, modifyAllRecords: false,
      }],
    }) + '\n',
  );

  // 3f — a doc ERROR (missing namespace prefix).
  make('docsfail', stack('dfail'), [['otherns_guide.md', DOC_PLAIN]]);

  // 4b — `--no-runtime-bundle` over a callable that could not be lowered.
  make('latefail', stack('lfail', { extraTop: unlowerableHook('lfail') }));

  // bottom — the artifact path is a DIRECTORY, so the write throws and the
  //          catch reports. Step 2 ran long before.
  const thrown = make('thrown', stack('tfail'));
  mkdirSync(join(thrown, 'out', 'artifact.json'), { recursive: true });

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

describe('#12125 — every `os build --json` failure exit carries the conversions the run computed', () => {
  it('control — the fixture shape DOES drive a live conversion on the success exit', async () => {
    // ⭐ Anti-vacuity for every assertion below.
    const run = await runCli(['build', '--json'], dirs.control);
    expect(run.code, `expected the control to build:\n${run.stdout}${run.stderr}`).toBe(0);
    const payload = payloadOf(run, 'control');
    expect(payload.success).toBe(true);
    expectTheOneNotice(payload, 'control');
    expect(typeof (conversionsOf(payload)[0] as { retiresIn?: unknown }).retiresIn).toBe('number');
  }, 180_000);

  it('2b (--strict-body) — ⭐ carries the notice, where `warnings` is empty by construction', async () => {
    // The measured difference from the sibling card. This exit is BELOW step 2
    // and ABOVE every advisory computation, so the two fields disagree here —
    // which is exactly why `conversions` needed its own measurement.
    const run = await runCli(['build', '--json', '--strict-body'], dirs.strictbody);
    expect(run.code, `expected --strict-body to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'strictbody');
    expect(payload.success).toBe(false);
    expect(String(payload.error)).toContain('strict-body');
    expect(payload.warnings, 'no advisory is computed this early — the sibling pins this too').toEqual([]);
    expectTheOneNotice(payload, 'strictbody');
  }, 180_000);

  it('3 (protocol parse) — ⭐ carries the notice, where `warnings` is empty by construction', async () => {
    const run = await runCli(['build', '--json'], dirs.zodfail);
    expect(run.code, `expected the parse to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'zodfail');
    expect(payload.success).toBe(false);
    expect(Array.isArray(payload.errors)).toBe(true);
    expect(payload.warnings).toEqual([]);
    expectTheOneNotice(payload, 'zodfail');
  }, 180_000);

  it('⭐ converts nothing — the SAME exit reports `[]`, so the field tracks the run', async () => {
    const run = await runCli(['build', '--json'], dirs.zodfail_nc);
    expect(run.code, `expected the parse to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'zodfail_nc');
    expect(payload.success).toBe(false);
    expect('conversions' in payload, 'the field must be PRESENT even when empty').toBe(true);
    expect(payload.conversions, 'a canonical page kind converts nothing').toEqual([]);
  }, 180_000);

  it('3b (author-time rules) — the notice rides the rule gate', async () => {
    const run = await runCli(['build', '--json'], dirs.rulefail);
    expect(run.code, `expected the rule gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'rulefail');
    expect(String(payload.error)).toContain('author-time rules failed');
    expectTheOneNotice(payload, 'rulefail');
  }, 180_000);

  it('3c (capability preflight) — the notice rides the preflight gate', async () => {
    const run = await runCli(['build', '--json'], dirs.capfail);
    expect(run.code, `expected the capability gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'capfail');
    expect(String(payload.error)).toContain('capability provider preflight failed');
    expectTheOneNotice(payload, 'capfail');
  }, 180_000);

  it('3e (access-matrix drift) — the notice rides the drift gate', async () => {
    const run = await runCli(['build', '--json'], dirs.amx);
    expect(run.code, `expected the drift gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'amx');
    expect(String(payload.error)).toContain('access matrix drift');
    expectTheOneNotice(payload, 'amx');
  }, 180_000);

  it('3f (package docs) — the notice rides the docs gate', async () => {
    const run = await runCli(['build', '--json'], dirs.docsfail);
    expect(run.code, `expected the docs gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'docsfail');
    expect(String(payload.error)).toContain('docs validation failed');
    expectTheOneNotice(payload, 'docsfail');
  }, 180_000);

  it('4b (--no-runtime-bundle) — a late exit past every step carries the notice', async () => {
    const run = await runCli(['build', '--json', '--no-runtime-bundle'], dirs.latefail);
    expect(run.code, `expected --no-runtime-bundle to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'latefail');
    expect(String(payload.error)).toContain('--no-runtime-bundle');
    expectTheOneNotice(payload, 'latefail');
  }, 180_000);

  it('the catch-all — a THROWN failure still reports the computed notice', async () => {
    // Before this change the sink was declared INSIDE the `try`, so the
    // catch-all could not read it at all — structurally unreachable from this
    // exit rather than merely omitted.
    const run = await runCli(['build', '--json', '-o', 'out/artifact.json'], dirs.thrown);
    expect(run.code, `expected the artifact write to throw:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'thrown');
    expect(payload.success).toBe(false);
    expectTheOneNotice(payload, 'thrown');
  }, 180_000);

  it('catch-all (throw at load) — `conversions` is PRESENT and empty, because step 2 never ran', async () => {
    // ⛔ The line that holds "carrying, not computing": this exit is ABOVE the
    // normalize call, so `[]` is the honest reading. Hoisting the computation
    // up to make it look fuller turns this red.
    const run = await runCli(['build', '--json'], dirs.earlythrow);
    expect(run.code, `expected the config module to throw:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'earlythrow');
    expect(String(payload.error)).toContain('zzz_config_module_threw');
    expect('conversions' in payload, 'the load-failure exit omits `conversions` entirely').toBe(true);
    expect(payload.conversions).toEqual([]);
  }, 180_000);

  it('REGRESSION GUARD — `warnings` and `conversions` stay separate fields', async () => {
    // ⛔ NOT an argument that folding is wrong. Whether the two should become
    // one field is an OPEN question this card was not given authority to
    // settle; this records the shape as-shipped so a fold happens deliberately.
    const run = await runCli(['build', '--json'], dirs.docsfail);
    const payload = payloadOf(run, 'docsfail');
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    expect(
      warnings.filter((w) => typeof w === 'object' && w !== null && 'conversionId' in (w as object)),
      'a conversion notice appeared inside `warnings` — the two fields were folded',
    ).toEqual([]);
    expect(conversionsOf(payload)).toHaveLength(1);
  }, 180_000);
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

describe('#12125 — the contract is exhaustive over `compile.ts`, not just over the exits pinned above', () => {
  const SRC = readFileSync(COMPILE_TS, 'utf8');

  it('the extractor produces a POSITIVE before its negative is trusted', () => {
    const SYNTHETIC = [
      "await emitJson({ success: false, errors }, 0, { compact: true });",
      "await emitJson({ success: false, error: `x: ${e.message}`, conversions: conversionNotices }, 0, { compact: true });",
    ].join('\n');
    const found = payloadLiterals(SYNTHETIC);
    expect(found).toHaveLength(2);
    expect(found.filter((p) => !p.includes('conversions:'))).toHaveLength(1);
    expect(found[1]).toContain('conversions: conversionNotices');
  });

  it('all 10 `emitJson` exits carry `conversions` — 9 failure exits and the success payload', () => {
    const literals = payloadLiterals(SRC);
    expect(literals, 'the `emitJson` exit count moved — a new exit must carry `conversions` too').toHaveLength(10);
    expect(literals.filter((p) => p.includes('success: false'))).toHaveLength(9);
    expect(literals.filter((p) => p.includes('success: true'))).toHaveLength(1);

    const bare = literals.filter((p) => !p.includes('conversions:'));
    expect(
      bare,
      'an `os build --json` exit publishes no `conversions`, so a consumer cannot tell ' +
        '"this tree converts nothing" from "this run stopped early" through it (#12125)',
    ).toEqual([]);
  });

  it('every exit reads the ONE sink, and the sink outlives the `try`', () => {
    expect(SRC).toMatch(/const conversionNotices: ConversionNotice\[\] = \[\];\s*\n\s*\n\s*try \{/);
    for (const literal of payloadLiterals(SRC)) {
      expect(literal, 'an exit spells its own conversion list instead of reading the shared sink').toContain(
        'conversions: conversionNotices',
      );
    }
  });

  it('⛔ the conversion layer still runs at step 2 — carrying, not computing', () => {
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
