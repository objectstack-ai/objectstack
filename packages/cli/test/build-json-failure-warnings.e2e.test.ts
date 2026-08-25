// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11772 — `os build --json`'s FAILURE payloads carried no `warnings`, so the
 * text face's `— re-run with --json for the full list` pointer was a dead end
 * whenever a later gate failed.
 *
 * The text face prints its advisory blocks well before the gates that can stop
 * the run: the #11529 author-time advisories at 3b, the #3786 undeclared-key
 * findings at 3d — both ending in `JSON_FULL_LIST_REMEDY`. `warnings` then
 * lived on the TERMINAL SUCCESS payload only (plus, for one list, the
 * author-time-rules failure). So on a tree with 60 undeclared authoring keys
 * AND a package-docs error:
 *
 *   os build          Undeclared authoring keys (60) … 50 rows …
 *                     … and 10 more … — re-run with --json for the full list
 *   os build --json   {"success":false,"error":"docs validation failed",…}
 *                                                        ^ the 60 keys nowhere
 *
 * The remedy the notice named returned a payload that did not contain the
 * list — the "the remedy named is unreachable" shape of #11643 and #11391.
 * The author could not see the withheld entries by any route until an
 * UNRELATED later failure was fixed.
 *
 * ## The ruling these pins encode
 *
 * Maintainer, 2026-08-25, option 1 of the three the card offered: every
 * `emitJson` failure exit carries the advisory lists the run has ALREADY
 * COMPUTED, so `warnings` means the same thing on every exit. Option 2 —
 * carry them only where the text face printed them, making the payload's
 * SHAPE depend on how far the run got — was rejected as the hardest contract
 * to declare. Option 3 (weaken the pointer) was rejected as making the
 * product worse.
 *
 * ## WHAT THESE PINS ASSERT — "what the run computed", not "the key exists"
 *
 * A pin that only asserted `'warnings' in payload` would pass against a
 * `warnings: []` hard-coded at every exit, which is the defect with a lid on
 * it. So each exit below is driven by a fixture carrying a KNOWN advisory of
 * each class, and the payload is asserted to carry exactly the classes the run
 * had reached — no fewer, and NO MORE:
 *
 *   exit (step)                        | rule | doc | key | cap
 *   -----------------------------------+------+-----+-----+-----
 *   strict-body           (2b)         |  -   |  -  |  -  |  -
 *   protocol parse        (3)          |  -   |  -  |  -  |  -
 *   author-time rules     (3b)         |  ✓   |  -  |  -  |  -
 *   capability preflight  (3c)         |  ✓   |  -  |  -  |  ✓
 *   access-matrix drift   (3e)         |  ✓   |  -  |  ✓  |  ✓
 *   package docs          (3f)         |  ✓   |  ✓  |  ✓  |  ✓
 *   --no-runtime-bundle   (4b)         |  ✓   |  ✓  |  ✓  |  ✓
 *   thrown / caught       (bottom)     |  ✓   |  ✓  |  ✓  |  ✓
 *
 * The "NO MORE" half is what tells option 1 apart from a change that hoisted
 * the COMPUTATIONS earlier to make every exit look full — which would be
 * option 2 wearing option 1's clothes, and would also change what the command
 * costs on its failure paths. The 3c and 3e rows are where that is measured:
 * a doc advisory appearing at 3c, or at 3e, means a computation moved.
 *
 * The 3b row is a REGRESSION GUARD, not evidence: that exit already published
 * `warnings: ruleAdvisories` before this change, and at that point in the run
 * `warningsSoFar()` is exactly `[...ruleAdvisories]`. It is pinned so that the
 * refactor to a shared ordering site cannot quietly drop it.
 *
 * Detection is STRUCTURAL — a capability hint is a record carrying `token`, a
 * doc advisory a record whose `rule` is namespaced `docs/`, an undeclared-key
 * finding the formatted STRING, an authoring-rule advisory the remaining
 * record. Deliberately not a substring of the planted prose: a check spelled
 * as a fragment of the term under test can match for reasons that have nothing
 * to do with the behaviour, in both directions.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, whose own header states it is
 * "the SOURCE entry point — same CLI, run from `src/` through tsx, used by
 * this repo's gates and e2e suites so they do not depend on
 * `packages/cli/dist` having been built". `compile.ts` is therefore loaded
 * from source by the child, and an ablation of that file is measured without
 * a rebuild. (Its DEPENDENCIES — `@objectstack/spec`, `@objectstack/lint` —
 * do resolve through `exports` to their `dist/`, but this change touches
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
const COMPILE_TS = resolve(HERE, '../src/commands/compile.ts');

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

/** The planted capability token — classified `unknown`, i.e. an ADVISORY. */
const PLANTED_TOKEN = 'zzz_unknown_capability_token';
/**
 * The planted FATAL capability token. `governance` is `{package: null, edition:
 * 'cloud'}` in the spec registry, so it classifies `unavailable` no matter what
 * is installed — the 3c failure exit without depending on the environment.
 */
const FATAL_TOKEN = 'governance';
/** The planted undeclared authoring key. Matched by name, never as a fragment. */
const PLANTED_KEY = 'zzzUndeclaredProbeKey';

/**
 * A stack raising ONE advisory of each of the four classes while parsing
 * cleanly: a bare `unique: true` index (authoring-RULE advisory), an unknown
 * `requires` token (#3366 capability hint), an undeclared key inside
 * `visibleWhen` (#3786 finding), plus — via `plantDocs` — a doc whose `tags:`
 * scalar the reader cannot parse (ADR-0046 doc advisory).
 *
 * The key sits inside `visibleWhen` rather than on the object or field itself:
 * an undeclared key in either of those positions has been a hard PARSE error
 * since #4001, which would stop the run at 3 and never reach the gate under
 * test.
 */
function stack(ns: string, requires: string[], extra = ''): string {
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
        },
      },
    },
  ],${extra}
};
`;
}

/** A hook whose body cannot be lowered — `require()` is refused (#10678). */
const UNLOWERABLE_HOOK = `
  hooks: [{
    name: 'lf_hook',
    object: 'lfail_ticket',
    events: ['beforeInsert'],
    handler: async (ctx: any) => {
      const os = require('node:os');
      return os.platform();
    },
  }],`;

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
/** #3786 undeclared-key findings: the formatted STRINGS. */
function keyFindings(warnings: unknown): string[] {
  return asList(warnings).filter((w): w is string => typeof w === 'string');
}
/** Author-time RULE advisories: the records that are neither of the above. */
function ruleAdvisories(warnings: unknown): Array<Record<string, unknown>> {
  const cap = new Set<unknown>(capHints(warnings));
  const doc = new Set<unknown>(docAdvisories(warnings));
  return asList(warnings).filter(
    (w): w is Record<string, unknown> =>
      typeof w === 'object' && w !== null && !cap.has(w) && !doc.has(w),
  );
}

/** The four class counts, as one comparable tuple. */
function classes(warnings: unknown): Record<string, number> {
  return {
    rule: ruleAdvisories(warnings).length,
    doc: docAdvisories(warnings).length,
    key: keyFindings(warnings).length,
    cap: capHints(warnings).length,
  };
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-fail-warnings-'));
  const make = (name: string, config: string, docs: Array<[string, string]> = []): string => {
    const dir = join(root, name);
    mkdirSync(join(dir, 'src', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), config);
    for (const [file, body] of docs) writeFileSync(join(dir, 'src', 'docs', file), body);
    dirs[name] = dir;
    return dir;
  };

  // 2b — `--strict-body`, before any advisory has been computed.
  make('strictbody', `
export default {
  manifest: { id: 'com.example.sbody', name: 'sbody', version: '1.0.0', type: 'app', namespace: 'sbody' },
  requires: ['${PLANTED_TOKEN}'],
  objects: [{ name: 'sb_ticket', label: 'Ticket', sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } } }],
  hooks: [{ name: 'sb_hook', object: 'sb_ticket', events: ['beforeInsert'],
    handler: async (ctx: any) => { const os = require('node:os'); return os.platform(); } }],
};
`);

  // 3 — the protocol parse itself fails, likewise before any advisory.
  make('zodfail', `
export default {
  manifest: { id: 'com.example.zfail', name: 'zfail', version: '1.0.0', type: 'app', namespace: 'zfail' },
  requires: ['${PLANTED_TOKEN}'],
  objects: [{ name: 'zf_ticket', label: 'Ticket', sharingModel: 'private',
    fields: { title: { type: 'this_is_not_a_field_type', label: 'Title' } } }],
};
`);

  // 3b — an author-time rule ERROR (a `record.<field>` that does not resolve),
  //      raised alongside the bare-`unique` advisory.
  make('rulefail', `
export default {
  manifest: { id: 'com.example.rfail', name: 'rfail', version: '1.0.0', type: 'app', namespace: 'rfail' },
  requires: ['${PLANTED_TOKEN}'],
  objects: [{ name: 'rf_ticket', label: 'Ticket', sharingModel: 'private',
    indexes: [{ name: 'rf_title_idx', fields: ['title'], unique: true }],
    fields: { title: { type: 'text', label: 'Title',
      visibleWhen: { dialect: 'cel', source: 'record.zzz_no_such_field' } } } }],
};
`);

  // 3c — one FATAL capability token beside the advisory one.
  make('capfail', stack('capfail', [FATAL_TOKEN, PLANTED_TOKEN]), [['capfail_guide.md', DOC_BAD_TAGS]]);

  // 3e — a committed snapshot naming a permission set the stack does not grant.
  const amx = make('amx', stack('amx', [PLANTED_TOKEN]), [['amx_guide.md', DOC_BAD_TAGS]]);
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

  // 3f — the card's headline: a doc ERROR (missing namespace prefix) reached
  //      with every one of the four advisory lists already computed.
  make('docsfail', stack('dfail', [PLANTED_TOKEN]), [
    ['dfail_guide.md', DOC_BAD_TAGS],
    ['otherns_guide.md', DOC_PLAIN],
  ]);

  // 4b — `--no-runtime-bundle` over a callable that could not be lowered.
  make('latefail', stack('lfail', [PLANTED_TOKEN], UNLOWERABLE_HOOK), [['lfail_guide.md', DOC_BAD_TAGS]]);

  // bottom — the artifact path is a DIRECTORY, so the write throws and the
  //          catch reports. Everything is computed by then.
  const thrown = make('thrown', stack('tfail', [PLANTED_TOKEN]), [['tfail_guide.md', DOC_BAD_TAGS]]);
  mkdirSync(join(thrown, 'out', 'artifact.json'), { recursive: true });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#11772 — every `os build --json` failure exit carries the advisory lists the run computed', () => {
  it('3f (package docs) — the card\'s headline: all four lists ride the failure payload', async () => {
    const run = await runCli(['build', '--json'], dirs.docsfail);
    expect(run.code, `expected the docs gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'docsfail');
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('docs validation failed');

    // The gate's own findings are untouched by this change.
    expect((payload.issues as Array<{ rule: string }>).map((i) => i.rule)).toEqual(['docs/namespace-prefix']);

    // …and the advisories the author was pointed at are now reachable HERE.
    expect(
      classes(payload.warnings),
      'the docs failure payload dropped an advisory list the run had already computed',
    ).toEqual({ rule: 1, doc: 1, key: 1, cap: 1 });

    // Identity, not just arity — this is the list the truncation notice names.
    expect(keyFindings(payload.warnings)[0]).toContain(PLANTED_KEY);
    expect(capHints(payload.warnings)[0]?.token).toBe(PLANTED_TOKEN);
    expect(docAdvisories(payload.warnings)[0]?.rule).toBe('docs/frontmatter-tags');
  }, 120_000);

  it('3e (access-matrix drift) — carries the three lists computed by then and NOT the doc advisory', async () => {
    const run = await runCli(['build', '--json'], dirs.amx);
    expect(run.code, `expected the access-matrix gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'amx');
    expect(payload.error).toBe('access matrix drift');
    expect(payload.changes).toEqual(["'ghost_ps' loses ALL access to 'amx_ticket' (entry removed)"]);

    // The fixture SHIPS a doc that raises an advisory — and 3f has not run, so
    // that advisory must NOT be here. This is the assertion that tells "carry
    // what was computed" apart from "compute everything at every exit".
    expect(
      classes(payload.warnings),
      'the 3e payload carries a list the run had not computed yet — a computation moved',
    ).toEqual({ rule: 1, doc: 0, key: 1, cap: 1 });
    expect(keyFindings(payload.warnings)[0]).toContain(PLANTED_KEY);
  }, 120_000);

  it('3c (capability preflight) — carries rule + capability only; the 3d key finding is not computed yet', async () => {
    const run = await runCli(['build', '--json'], dirs.capfail);
    expect(run.code, `expected the capability gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'capfail');
    expect(payload.error).toBe('capability provider preflight failed');
    expect((payload.issues as Array<{ token: string }>).map((i) => i.token)).toEqual([FATAL_TOKEN]);

    // The fixture plants an undeclared key AND a doc advisory, neither of which
    // 3c has reached. Only the fatal token is an `issue`; the advisory token
    // rides `warnings`, which is the whole point of the two being separate.
    expect(
      classes(payload.warnings),
      'the 3c payload carries a list the run had not computed yet — a computation moved',
    ).toEqual({ rule: 1, doc: 0, key: 0, cap: 1 });
    expect(capHints(payload.warnings)[0]?.token).toBe(PLANTED_TOKEN);
  }, 120_000);

  it('4b (--no-runtime-bundle) — a late exit past every advisory step carries all four', async () => {
    const run = await runCli(['build', '--json', '--no-runtime-bundle'], dirs.latefail);
    expect(run.code, `expected the bundle gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'latefail');
    expect(String(payload.error)).toContain('--no-runtime-bundle requires every callable to have a metadata body');
    expect(classes(payload.warnings)).toEqual({ rule: 1, doc: 1, key: 1, cap: 1 });
  }, 120_000);

  it('the catch-all — a THROWN failure still reports what the run had computed', async () => {
    // The artifact path is a directory, so `writeFileSync` throws EISDIR and the
    // bottom `catch` reports. Before this change that payload was `{success,
    // error}` alone: an author whose build died on an unwritable artifact got
    // the truncation notice's remedy and a payload with nothing in it.
    const run = await runCli(['build', '--json', '-o', 'out/artifact.json'], dirs.thrown);
    expect(run.code, `expected the write to throw:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'thrown');
    expect(String(payload.error)).toContain('EISDIR');
    expect(
      classes(payload.warnings),
      'the catch-all payload dropped the lists the run had already computed',
    ).toEqual({ rule: 1, doc: 1, key: 1, cap: 1 });
  }, 120_000);

  it('2b (--strict-body) — `warnings` is PRESENT and empty, because nothing is computed yet', async () => {
    // The shape-constancy half of the ruling: the key is there on every exit, so
    // a consumer has one way to read it. ⛔ Empty here is not "this tree is
    // clean" — it is "this run stopped before any advisory was computed", and
    // that distinction is what the changeset tells consumers.
    const run = await runCli(['build', '--json', '--strict-body'], dirs.strictbody);
    expect(run.code, `expected --strict-body to refuse:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'strictbody');
    expect(payload.error).toBe('strict-body: missing body');
    expect('warnings' in payload, 'the strict-body exit omits `warnings` entirely').toBe(true);
    expect(payload.warnings).toEqual([]);
  }, 120_000);

  it('3 (protocol parse) — `warnings` is PRESENT and empty on the parse failure too', async () => {
    const run = await runCli(['build', '--json'], dirs.zodfail);
    expect(run.code, `expected the parse to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'zodfail');
    expect(Array.isArray(payload.errors), 'the parse exit reports under `errors`').toBe(true);
    expect('warnings' in payload, 'the parse exit omits `warnings` entirely').toBe(true);
    expect(payload.warnings).toEqual([]);
  }, 120_000);

  it('3b (author-time rules) — REGRESSION GUARD: this exit already carried `ruleAdvisories`', async () => {
    // Green before this change as well, and named as such: at 3b
    // `warningsSoFar()` is exactly `[...ruleAdvisories]`, so the refactor to a
    // single ordering site must leave this exit byte-identical. ⛔ Never read
    // this one as evidence that the change does anything.
    const run = await runCli(['build', '--json'], dirs.rulefail);
    expect(run.code, `expected the rule gate to fail:\n${run.stdout}${run.stderr}`).toBe(1);
    const payload = payloadOf(run, 'rulefail');
    expect(payload.error).toBe('author-time rules failed');
    expect((payload.issues as Array<{ rule: string }>).map((i) => i.rule)).toEqual(['expression-invalid']);

    // `cap: 0` although the fixture DECLARES the unknown token: the #3366
    // preflight is step 3c, one step past this exit, so the hint does not exist
    // yet. Measured, not assumed — the first draft of this pin expected `cap: 1`
    // and this assertion is what corrected it. It is the earliest of the three
    // "and NO MORE" readings, and the tightest.
    expect(classes(payload.warnings)).toEqual({ rule: 1, doc: 0, key: 0, cap: 0 });
  }, 120_000);
});

// ── Exhaustiveness, read off the source ─────────────────────────────────────

/**
 * Every `emitJson` payload literal in a command file, extracted by brace
 * matching from the `{` that opens the first argument. `${…}` inside a template
 * literal is balanced, so the depth arithmetic survives the `runtime bundle
 * failed: ${err.message}` payload.
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

describe('#11772 — the contract is exhaustive over `compile.ts`, not just over the exits pinned above', () => {
  const SRC = readFileSync(COMPILE_TS, 'utf8');

  it('the extractor produces a POSITIVE before its negative is trusted', () => {
    // ⭐ A "no payload lacks `warnings`" pass is worthless from an instrument
    // that finds no payloads, or that cannot see a missing key. Both halves are
    // demonstrated on synthetic input first.
    const SYNTHETIC = [
      "await emitJson({ success: false, error: 'a', issues }, 0, { compact: true });",
      "await emitJson({ success: false, error: `x: ${e.message}`, warnings: warningsSoFar() }, 0, { compact: true });",
    ].join('\n');
    const found = payloadLiterals(SYNTHETIC);
    expect(found).toHaveLength(2);
    expect(found.filter((p) => !p.includes('warnings:'))).toHaveLength(1);
    // …and the template literal's `${…}` did not break the brace matching.
    expect(found[1]).toContain('warnings: warningsSoFar()');
  });

  it('all 10 `emitJson` exits carry `warnings` — 9 failure exits and the success payload', () => {
    const literals = payloadLiterals(SRC);
    // The enumeration measured on this card, three MORE than the filing card's
    // table listed: it missed the protocol-parse exit, the `--no-runtime-bundle`
    // refusal, and the bottom catch-all.
    expect(literals, 'the `emitJson` exit count moved — a new exit must carry `warnings` too').toHaveLength(10);
    expect(literals.filter((p) => p.includes('success: false'))).toHaveLength(9);
    expect(literals.filter((p) => p.includes('success: true'))).toHaveLength(1);

    const bare = literals.filter((p) => !p.includes('warnings:'));
    expect(
      bare,
      'an `os build --json` exit publishes no `warnings`, so the text face\'s ' +
        '`re-run with --json for the full list` pointer is a dead end through it (#11772)',
    ).toEqual([]);
  });

  it('the order lives at ONE site, which the success payload reads too', () => {
    // Before this change the spread was written out at the success payload. A
    // tenth exit could have been added with a different member order and
    // nothing would have caught it; now every exit reads `warningsSoFar()`.
    expect(SRC).toContain('const warningsSoFar = () => [');
    expect(SRC).toMatch(/\.\.\.ruleAdvisories,\s*\n\s*\.\.\.docWarnings,\s*\n\s*\.\.\.unknownKeyWarnings,\s*\n\s*\.\.\.capProviderWarnings,/);
    for (const literal of payloadLiterals(SRC)) {
      expect(literal, 'an exit spells its own `warnings` list instead of reading the shared one').toContain(
        'warnings: warningsSoFar()',
      );
    }
  });
});
