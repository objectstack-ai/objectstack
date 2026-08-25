// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12047 — `os validate --json`'s FAILURE payloads dropped advisory lists the
 * run had ALREADY COMPUTED, on all five of its failure exits.
 *
 * The text face prints its advisory blocks ending `— re-run with --json for
 * the full list`. `warnings` then lived on the terminal SUCCESS payload only,
 * plus `ruleAdvisories` alone on two of the failure exits. Measured at
 * `origin/main` 2ba4329 over `packages/cli/src/commands/validate.ts`:
 *
 *   exit                    | computed by then                  | carried
 *   ------------------------+-----------------------------------+-------------
 *   parse failure           | unknownKey                        | —
 *   rule errors             | unknownKey, rule                  | rule
 *   capability errors       | unknownKey, rule, capProvider     | —
 *   doc errors              | unknownKey, rule, capProv, doc    | rule
 *   catch-all               | whatever the run reached          | —
 *
 * So an author whose tree failed a LATER gate was told to re-run with `--json`
 * and got a payload without the withheld entries in it — the "the remedy named
 * is unreachable" shape of #11643 and #11391.
 *
 * ## The parse-failure exit is the strongest instance, and it leads below
 *
 * `unknownKeyWarnings` is computed PRE-parse, above `safeParse`, precisely so
 * an undeclared-key finding SURVIVES an unrelated schema error — the parse is
 * what strips the key, so it cannot be recovered afterwards. The parse-failure
 * payload then dropped it anyway, defeating the one hoist that existed to
 * prevent exactly this. That is a strictly stronger instance than the one
 * #11772 fixes on `os build`, where nothing is computed that early and the
 * parse exit carries `[]` by construction.
 *
 * ## The ruling these pins encode
 *
 * Maintainer, 2026-08-25 on #11772, inherited here under the same-family rule:
 * every `emitJson` failure exit carries the advisory lists the run has ALREADY
 * COMPUTED, so `warnings` means the same thing on every exit. Option 2 — carry
 * them only where the text face printed them, making the payload's SHAPE
 * depend on how far the run got — was rejected as the hardest contract to
 * declare. Option 3 (weaken the pointer) was rejected as making the product
 * worse.
 *
 * ## WHAT THESE PINS ASSERT — "what the run computed", not "the key exists"
 *
 * A pin that only asserted `'warnings' in payload` would pass against a
 * `warnings: []` hard-coded at every exit, which is the defect with a lid on
 * it. So each exit is driven by a fixture carrying a KNOWN advisory of each
 * class and the payload is asserted to carry exactly the classes the run had
 * reached — no fewer, and NO MORE:
 *
 *   exit                  | rule | doc | key | cap | structural
 *   ----------------------+------+-----+-----+-----+-----------
 *   parse failure         |  -   |  -  |  ✓  |  -  |  -
 *   rule errors           |  ✓   |  -  |  ✓  |  -  |  -
 *   capability errors     |  ✓   |  -  |  ✓  |  ✓  |  -
 *   doc errors            |  ✓   |  ✓  |  ✓  |  ✓  |  -
 *   catch-all (late)      |  ✓   |  -  |  ✓  |  ✓  |  -
 *   catch-all (at load)   |  -   |  -  |  -  |  -  |  -
 *
 * The "NO MORE" half is what tells option 1 apart from a change that hoisted
 * the COMPUTATIONS earlier to make every exit look full — which would be
 * option 2 wearing option 1's clothes, and would also change what the command
 * costs on its failure paths.
 *
 * ## `structuralWarnings` — the fork clause this card had to settle first
 *
 * Triage required one genuine-difference check before implementing: whether
 * `structuralWarnings`, the member `os validate` has and `os build` does not,
 * changes the answer. MEASURED: it does not, and the measurement is the last
 * column above. It is computed LAST in the file — below every one of the five
 * failure exits — so under "carry what the run has already computed" it rides
 * every failure payload as an empty list, and the success payload is the only
 * exit that can ever see it non-empty. It differs from the other four only in
 * WHEN it becomes available, which is the axis `docWarnings` and
 * `capProviderWarnings` already differ on; it is not a semantic difference.
 *
 * That column is pinned, not assumed, and it is the tightest reading here:
 * every fixture below is built to RAISE a structural advisory (no `apps` and
 * no `plugins`), so if anyone hoists that computation up to make an early exit
 * look fuller, `nonKeyStrings` stops being empty and these pins go red. The
 * `structural control` test proves that premise on the same shape rather than
 * assuming it — without it, "no structural advisory appears" would be green
 * for a fixture that never had one to show.
 *
 * ## Detection is STRUCTURAL, and the two string classes are told apart by the
 * ## planted key rather than by prose
 *
 * A capability hint is a record carrying `token`, a doc advisory a record whose
 * `rule` is namespaced `docs/`, an authoring-rule advisory the remaining
 * record. `warnings` carries TWO string classes, though — #3786 key findings
 * and the structural advisories — so a string is classified as a key finding
 * by containing the planted key NAME, and every other string is reported as
 * `nonKeyStrings`. Deliberately not a substring of the structural prose: a
 * check spelled as a fragment of the term under test can match for reasons
 * that have nothing to do with the behaviour, in both directions.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, whose own header states it is
 * "the SOURCE entry point — same CLI, run from `src/` through tsx, used by
 * this repo's gates and e2e suites so they do not depend on
 * `packages/cli/dist` having been built". `validate.ts` is therefore loaded
 * from source by the child, and an ablation of that file is measured without a
 * rebuild. (Its DEPENDENCIES — `@objectstack/spec`, `@objectstack/lint` — do
 * resolve through `exports` to their `dist/`, but this change touches
 * neither.)
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

/** The planted capability token — classified `unknown`, i.e. an ADVISORY. */
const PLANTED_TOKEN = 'zzz_unknown_capability_token';
/**
 * The planted FATAL capability token. `governance` is `{package: null, edition:
 * 'cloud'}` in the spec registry, so it classifies `unavailable` no matter what
 * is installed — the capability failure exit without depending on the
 * environment.
 */
const FATAL_TOKEN = 'governance';
/** The planted undeclared authoring key. Matched by name, never as a fragment. */
const PLANTED_KEY = 'zzzUndeclaredProbeKey';

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
 * A stack raising ONE advisory of each class while parsing cleanly: a bare
 * `unique: true` index (authoring-RULE advisory), an unknown `requires` token
 * (#3366 capability hint), an undeclared key inside `visibleWhen` (#3786
 * finding), and — by declaring neither `apps` nor `plugins` — the structural
 * advisory that must NOT appear on any failure exit.
 *
 * The key sits inside `visibleWhen` rather than on the object or field itself:
 * an undeclared key in either of those positions has been a hard PARSE error
 * since #4001, which would stop the run at the parse gate and never reach the
 * gate under test.
 */
function stack(ns: string, requires: string[], extraFields = '', extraTop = ''): string {
  return `
export default {
  manifest: { id: 'com.example.${ns}', name: '${ns}', version: '1.0.0', type: 'app', namespace: '${ns}' },
  requires: [${requires.map((r) => `'${r}'`).join(', ')}],
  objects: [
    {
      name: '${ns}_ticket',
      label: 'Ticket',
      sharingModel: 'private',
      indexes: [{ name: '${ns}_title_idx', fields: ['title'], unique: true }],
      fields: {
        title: {
          type: 'text',
          label: 'Title',
          visibleWhen: { dialect: 'cel', source: 'true', ${PLANTED_KEY}: 1 },
        },${extraFields}
      },
    },
  ],${extraTop}
};
`;
}

const DOC_BAD_TAGS = `---
title: Guide
tags: not-a-list
---

Body text.
`;

const DOC_PLAIN = `---
title: Wrong namespace
---

Body text.
`;

// ── Structural classifiers over one `warnings` list ─────────────────────────

function asList(warnings: unknown): unknown[] {
  return Array.isArray(warnings) ? warnings : [];
}
/** #3366 capability hints: records carrying a `token`. */
function capHints(warnings: unknown): Array<Record<string, unknown>> {
  return asList(warnings).filter(
    (w): w is Record<string, unknown> => typeof w === 'object' && w !== null && 'token' in w,
  );
}
/** ADR-0046 doc advisories: records whose `rule` is namespaced `docs/`. */
function docAdvisories(warnings: unknown): Array<Record<string, unknown>> {
  return asList(warnings).filter(
    (w): w is Record<string, unknown> =>
      typeof w === 'object' && w !== null &&
      typeof (w as { rule?: unknown }).rule === 'string' &&
      ((w as { rule: string }).rule).startsWith('docs/'),
  );
}
/** #3786 undeclared-key findings: the formatted strings naming the planted key. */
function keyFindings(warnings: unknown): string[] {
  return asList(warnings).filter((w): w is string => typeof w === 'string' && w.includes(PLANTED_KEY));
}
/**
 * Every OTHER string. On a failure exit this must be empty: the only other
 * string class in this payload is `structuralWarnings`, which is computed below
 * all five failure exits. A non-empty reading here means a computation moved.
 */
function nonKeyStrings(warnings: unknown): string[] {
  return asList(warnings).filter((w): w is string => typeof w === 'string' && !w.includes(PLANTED_KEY));
}
/** Author-time RULE advisories: the records that are neither cap nor doc. */
function ruleAdvisories(warnings: unknown): Array<Record<string, unknown>> {
  const cap = new Set<unknown>(capHints(warnings));
  const doc = new Set<unknown>(docAdvisories(warnings));
  return asList(warnings).filter(
    (w): w is Record<string, unknown> =>
      typeof w === 'object' && w !== null && !cap.has(w) && !doc.has(w),
  );
}

/** The five class counts, as one comparable tuple. */
function classes(warnings: unknown): Record<string, number> {
  return {
    rule: ruleAdvisories(warnings).length,
    doc: docAdvisories(warnings).length,
    key: keyFindings(warnings).length,
    cap: capHints(warnings).length,
    otherStrings: nonKeyStrings(warnings).length,
  };
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-validate-fail-warnings-'));
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
  // planted key rides `visibleWhen` on the FIRST field, computed pre-parse.
  make('parsefail', stack('pfail', [PLANTED_TOKEN], `
        broken: { type: 'this_is_not_a_field_type', label: 'Broken' },`));

  // rule errors — an expression naming a field that does not resolve, raised
  // alongside the bare-`unique` advisory.
  make('rulefail', stack('rfail', [PLANTED_TOKEN], `
        subject: { type: 'text', label: 'Subject', visibleWhen: { dialect: 'cel', source: 'record.zzz_no_such_field' } },`));

  // capability errors — one FATAL token beside the advisory one. The fixture
  // SHIPS a doc advisory that this exit must NOT carry.
  make('capfail', stack('cfail', [FATAL_TOKEN, PLANTED_TOKEN]), [['cfail_guide.md', DOC_BAD_TAGS]]);

  // doc errors — the exit with the most computed: a doc ERROR (missing
  // namespace prefix) reached with all four other lists already in hand.
  make('docsfail', stack('dfail', [PLANTED_TOKEN]), [
    ['dfail_guide.md', DOC_BAD_TAGS],
    ['otherns_guide.md', DOC_PLAIN],
  ]);

  // catch-all, LATE — `src/docs` is a FILE, so `readdirSync` raises ENOTDIR
  // inside `collectAndLintDocs`, after three lists are computed.
  const thrown = make('thrown', stack('tfail', [PLANTED_TOKEN]));
  mkdirSync(join(thrown, 'src'), { recursive: true });
  writeFileSync(join(thrown, 'src', 'docs'), 'not a directory\n');

  // catch-all, AT LOAD — the config throws on import, before anything is
  // computed. The shape-constancy half: `warnings` is present and empty.
  make('earlythrow', `
throw new Error('zzz_config_module_threw');
export default {};
`);

  // The structural control — the same shape, reaching SUCCESS.
  make('control', stack('ctrl', [PLANTED_TOKEN]));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#12047 — every `os validate --json` failure exit carries the advisory lists the run computed', () => {
  it('parse failure — THE HEADLINE: the pre-parse key finding survives the schema error', async () => {
    // The strongest instance. `unknownKeyWarnings` is computed above
    // `safeParse` precisely so this finding outlives an unrelated schema
    // error — and this payload dropped it, which made the hoist pointless.
    const run = await runCli(['validate', '--json'], dirs.parsefail);
    expect(run.code, `expected the parse to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'parsefail');
    expect(payload.valid).toBe(false);
    expect(Array.isArray(payload.errors), 'the parse exit reports under `errors`').toBe(true);

    // `rule`/`cap`/`doc` are 0 although the fixture plants all three: every one
    // of those gates is BELOW the parse, so none has run. The earliest and
    // tightest "and NO MORE" reading in this file.
    expect(
      classes(payload.warnings),
      'the parse-failure payload dropped the key finding computed six lines above it',
    ).toEqual({ rule: 0, doc: 0, key: 1, cap: 0, otherStrings: 0 });
    expect(keyFindings(payload.warnings)[0]).toContain(PLANTED_KEY);
  }, 120_000);

  it('rule errors — carries rule + key, and NOT the capability hint one step later', async () => {
    const run = await runCli(['validate', '--json'], dirs.rulefail);
    expect(run.code, `expected the rule gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'rulefail');
    expect(payload.valid).toBe(false);
    expect((payload.errors as Array<{ rule: string }>).map((i) => i.rule)).toContain('expression-invalid');

    // This exit already published `ruleAdvisories` before the change; what is
    // new is `key`. `cap: 0` although the fixture DECLARES the unknown token —
    // the #3366 preflight is one step past this exit.
    expect(classes(payload.warnings)).toEqual({ rule: 1, doc: 0, key: 1, cap: 0, otherStrings: 0 });
    expect(keyFindings(payload.warnings)[0]).toContain(PLANTED_KEY);
  }, 120_000);

  it('capability errors — carries rule + key + cap; the doc advisory is not computed yet', async () => {
    const run = await runCli(['validate', '--json'], dirs.capfail);
    expect(run.code, `expected the capability gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'capfail');
    expect(payload.valid).toBe(false);
    expect((payload.errors as Array<{ token: string }>).map((i) => i.token)).toEqual([FATAL_TOKEN]);

    // The fixture ships a doc raising an advisory, and the docs gate has not
    // run — so `doc: 0` is what tells "carry what was computed" apart from
    // "compute everything at every exit". Only the FATAL token is an `error`;
    // the advisory token rides `warnings`, which is why the two are separate.
    expect(
      classes(payload.warnings),
      'the capability payload carries a list the run had not computed yet — a computation moved',
    ).toEqual({ rule: 1, doc: 0, key: 1, cap: 1, otherStrings: 0 });
    expect(capHints(payload.warnings)[0]?.token).toBe(PLANTED_TOKEN);
  }, 120_000);

  it('doc errors — all four computed lists ride the payload', async () => {
    const run = await runCli(['validate', '--json'], dirs.docsfail);
    expect(run.code, `expected the docs gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'docsfail');
    expect(payload.valid).toBe(false);
    expect((payload.errors as Array<{ rule: string }>).map((i) => i.rule)).toEqual(['docs/namespace-prefix']);

    expect(
      classes(payload.warnings),
      'the docs failure payload dropped an advisory list the run had already computed',
    ).toEqual({ rule: 1, doc: 1, key: 1, cap: 1, otherStrings: 0 });

    // Identity, not just arity — this is the list the pointer names.
    expect(keyFindings(payload.warnings)[0]).toContain(PLANTED_KEY);
    expect(capHints(payload.warnings)[0]?.token).toBe(PLANTED_TOKEN);
    expect(docAdvisories(payload.warnings)[0]?.rule).toBe('docs/frontmatter-tags');
  }, 120_000);

  it('catch-all (late throw) — a THROWN failure still reports what the run had computed', async () => {
    // `src/docs` is a FILE, so `readdirSync` raises ENOTDIR inside
    // `collectAndLintDocs`. Before this change that payload was `{valid,
    // error}` alone: an author whose run died on an unreadable docs path got
    // the pointer's remedy and a payload with nothing in it.
    const run = await runCli(['validate', '--json'], dirs.thrown);
    expect(run.code, `expected the docs read to throw:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'thrown');
    expect(String(payload.error)).toContain('ENOTDIR');
    expect(
      classes(payload.warnings),
      'the catch-all payload dropped the lists the run had already computed',
    ).toEqual({ rule: 1, doc: 0, key: 1, cap: 1, otherStrings: 0 });
  }, 120_000);

  it('catch-all (throw at load) — `warnings` is PRESENT and empty, because nothing is computed yet', async () => {
    // The shape-constancy half of the ruling: the key is there on every exit,
    // so a consumer has one way to read it. ⛔ Empty here is not "this tree is
    // clean" — it is "this run stopped before any advisory was computed", and
    // that distinction is what the changeset tells consumers.
    const run = await runCli(['validate', '--json'], dirs.earlythrow);
    expect(run.code, `expected the config module to throw:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'earlythrow');
    expect(String(payload.error)).toContain('zzz_config_module_threw');
    expect('warnings' in payload, 'the load-failure exit omits `warnings` entirely').toBe(true);
    expect(payload.warnings).toEqual([]);
  }, 120_000);

  it('structural control — the fixture shape DOES raise a structural advisory on success', async () => {
    // ⭐ Anti-vacuity for the `otherStrings: 0` column above. Without this, a
    // fixture that never had a structural advisory to show would satisfy every
    // "and NO MORE" assertion for the wrong reason. Same shape as the failure
    // fixtures — no `apps`, no `plugins` — run to SUCCESS, where the string
    // that is not a key finding is exactly the structural advisory that must
    // stay off the failure payloads.
    const run = await runCli(['validate', '--json'], dirs.control);
    expect(run.code, `expected the control to pass:\n${run.stdout}${run.stderr}`).toBe(0);
    const payload = payloadOf(run, 'control');
    expect(payload.valid).toBe(true);

    expect(
      nonKeyStrings(payload.warnings).length,
      'the fixture shape raises no structural advisory, so the failure-exit pins prove nothing',
    ).toBeGreaterThanOrEqual(1);
    // The other four classes are present here too, which is what makes the
    // failure exits' SUBSETS meaningful rather than accidental.
    expect(keyFindings(payload.warnings).length).toBe(1);
    expect(capHints(payload.warnings).length).toBe(1);
    expect(ruleAdvisories(payload.warnings).length).toBe(1);
  }, 120_000);
});

// ── Exhaustiveness, read off the source ─────────────────────────────────────

/**
 * Every `emitJson` payload literal in a command file, extracted by brace
 * matching from the `{` that opens the first argument. `${…}` inside a template
 * literal is balanced, so the depth arithmetic survives a payload built from
 * one.
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

describe('#12047 — the contract is exhaustive over `validate.ts`, not just over the exits pinned above', () => {
  const SRC = readFileSync(VALIDATE_TS, 'utf8');

  it('the extractor produces a POSITIVE before its negative is trusted', () => {
    // ⭐ A "no payload lacks `warnings`" pass is worthless from an instrument
    // that finds no payloads, or that cannot see a missing key. Both halves are
    // demonstrated on synthetic input first.
    const SYNTHETIC = [
      "await emitJson({ valid: false, errors, duration: timer.elapsed() });",
      "await emitJson({ valid: false, error: `x: ${e.message}`, warnings: warningsSoFar() });",
    ].join('\n');
    const found = payloadLiterals(SYNTHETIC);
    expect(found).toHaveLength(2);
    expect(found.filter((p) => !p.includes('warnings:'))).toHaveLength(1);
    // …and the template literal's `${…}` did not break the brace matching.
    expect(found[1]).toContain('warnings: warningsSoFar()');
  });

  it('all 6 `emitJson` exits carry `warnings` — 5 failure exits and the success payload', () => {
    const literals = payloadLiterals(SRC);
    expect(literals, 'the `emitJson` exit count moved — a new exit must carry `warnings` too').toHaveLength(6);
    expect(literals.filter((p) => p.includes('valid: false'))).toHaveLength(5);
    expect(literals.filter((p) => p.includes('valid: true'))).toHaveLength(1);

    const bare = literals.filter((p) => !p.includes('warnings:'));
    expect(
      bare,
      'an `os validate --json` exit publishes no `warnings`, so the text face\'s ' +
        '`re-run with --json for the full list` pointer is a dead end through it (#12047)',
    ).toEqual([]);
  });

  it('the order lives at ONE site, which the success payload reads too', () => {
    // Before this change the spread was written out at the success payload. A
    // seventh exit could have been added with a different member order and
    // nothing would have caught it; now every exit reads `warningsSoFar()`.
    expect(SRC).toContain('const warningsSoFar = () => [');
    expect(SRC).toMatch(
      /\.\.\.ruleAdvisories,\s*\n\s*\.\.\.docWarnings,\s*\n\s*\.\.\.unknownKeyWarnings,\s*\n\s*\.\.\.capProviderWarnings,\s*\n\s*\.\.\.structuralWarnings,/,
    );
    for (const literal of payloadLiterals(SRC)) {
      expect(literal, 'an exit spells its own `warnings` list instead of reading the shared one').toContain(
        'warnings: warningsSoFar()',
      );
    }
  });
});
