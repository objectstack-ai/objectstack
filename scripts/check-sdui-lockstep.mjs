#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-sdui-lockstep — the `sdui-parser` LOCKSTEP invariant, mechanised.
 *
 *   node scripts/check-sdui-lockstep.mjs              # compare this tree against the record
 *   node scripts/check-sdui-lockstep.mjs --self-test  # verify the checker itself
 *   node scripts/check-sdui-lockstep.mjs --update     # re-record objectui's side (needs a checkout)
 *
 * ## The invariant, and why nothing enforced it
 *
 * Two copies of the constrained-JSX parser exist: objectui's
 * `packages/sdui-parser` (which the browser RENDERER runs) and this repo's copy
 * (which the SAVE GATE runs). #12719 states what they owe each other:
 *
 *   > both copies byte-agree on the accepted grammar and on diagnostic codes.
 *
 * If they drift, the save gate and the renderer speak different dialects and a
 * page SAVES CLEAN AND RENDERS INERT — a failure that is surface-dependent, so
 * intermittent from the author's point of view and not reliably pushed up by
 * complaints. The invariant was enforced by nothing: three manual ports had
 * been done by a human reading two files side by side, two of them landing only
 * because someone happened to file a card naming the drift.
 *
 * ## What this compares — and what it CANNOT see (read before trusting a green)
 *
 * The comparison is against a VENDORED RECORD of objectui's side
 * (`packages/sdui-parser/objectui-lockstep.json`), taken at a named objectui
 * revision. At check time there is no network, no build, and no objectui
 * checkout. So:
 *
 *   CAN see   this repo's copy moving away from the recorded objectui state —
 *             a port that is not byte-faithful, a local edit to the lockstep
 *             region, a codemod that reformats it, a new diagnostic code added
 *             on one side only, a code deleted here.
 *
 *   CANNOT see  objectui moving AFTER the record was taken. That direction
 *             needs objectui at check time, which is the shape this repo
 *             declined (a network dependency in a lint job, unrunnable locally
 *             without credentials). It is not covered here and must not be
 *             read as covered.
 *
 * The `.objectui-sha` clause below is the one offline instrument that reaches
 * into the second class, and it is deliberate rather than incidental — see it.
 *
 * ## Why `--update` cannot launder a divergence
 *
 * `--update` re-reads OBJECTUI's side only. It never reads this tree's parser,
 * so it cannot record "whatever we have now" as accepted. Run it after a port
 * and one of two things happens: the port was byte-faithful and the gate goes
 * green, or it was not and the gate stays RED naming the difference. That is
 * the opposite of the accepted-divergence baselines elsewhere in this repo
 * (`packages/spec/react-declaration-parity.baseline.json` records a diff and
 * ratchets it); this record holds ONE SIDE, so there is no diff in it to bless.
 *
 * ## Why the pin is read (`.objectui-sha`)
 *
 * `.objectui-sha` is the objectui commit whose `@object-ui/console` build this
 * platform SHIPS — i.e. it names the renderer that will run against pages this
 * repo's save gate accepted. So a pin bump is the moment a parser divergence
 * stops being latent and starts being shipped, and it is also the only moment
 * at which somebody is guaranteed to have an objectui checkout in hand (the pin
 * cannot be bumped without one — see `scripts/bump-objectui.sh`). The record
 * therefore stores the pin in force when it was taken, and this gate REFUSES
 * when the live pin has moved past it: the remedy is one command, `pnpm
 * gen:sdui-lockstep`, run against the checkout the bump already required.
 *
 * ⚠️ This is NOT a resurrection of the retired `Console Pin Freshness` gate
 * (#10134, maintainer ruling 2026-08-20: which objectui revision we pin is a
 * decision recorded in an objectstack issue, never derived from objectui
 * `main`). Nothing here reads objectui `main`, nothing here proposes a pin, and
 * a pin bump is never called stale by this gate. It asks a different question:
 * given that YOU are moving the pin, has the parser parity been re-verified
 * against what you are moving it to.
 *
 * ## The decomposition that keeps this from crying wolf on day one
 *
 * The same diagnostic code is a quoted literal in this repo and a CONSTANT
 * REFERENCE on objectui's side:
 *
 *   this repo   code: 'unconsumed-widget-option'
 *   objectui    code: UNCONSUMED_WIDGET_OPTION
 *
 * (The divergence is deliberate and documented at the site: this repo runs
 * `check:dispatcher-error-vocabulary`, whose literal grammar a kebab-case
 * constant cannot satisfy.) A literal-only scan reports a false 24-vs-23
 * difference the first time it runs. So the extractor resolves an identifier at
 * a code position through the module-level `const NAME = '...'` declarations of
 * the same package, and REFUSES on one it cannot resolve — silently skipping
 * the unresolvable one is the same false difference with the evidence removed.
 * Both halves are pinned in `--self-test`.
 *
 * ## Absence is loud, everywhere
 *
 * Every input this gate needs is asserted before any verdict: the record file,
 * its shape, the region delimiter in this tree, a non-empty code set, a
 * resolvable identifier at every code position, and the pin. A missing one exits
 * 1 saying which — never a `⚠` and exit 0. A guard whose success condition and
 * whose total-failure condition are the same exit code is worse than no guard
 * (#13014, and #4690 for the incident that named the class).
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { parseSourceFile } from './ts-parse.mjs';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where both copies keep the parser. Relative, because both trees spell it identically. */
const PARSER_SRC = 'packages/sdui-parser/src';

/** The file the ported grammar region lives in, in both copies. */
const REGION_FILE = 'packages/sdui-parser/src/parse.ts';

/**
 * The literal comment that OPENS the ported block, carried verbatim by both
 * copies — which is what makes the region addressable without a parser: it runs
 * from this line to end of file.
 *
 * ⚠️ Changing this string is changing what "the ported block" means. It is a
 * deliberate act that belongs in the same port as the block itself, and the
 * gate refuses (rather than measuring a shorter region) when it is not found.
 */
const REGION_DELIMITER = '/* ---------------------- the JS literal subset (#6614) ---------------------- */';

/** The vendored record of OBJECTUI's side. One side only — see the header. */
const RECORD_FILE = 'packages/sdui-parser/objectui-lockstep.json';

/** The objectui commit whose console build this platform ships. */
const PIN_FILE = '.objectui-sha';

/** Where `--update` looks for an objectui checkout, after `OBJECTUI_ROOT`. */
const OBJECTUI_SIBLING = '../objectui';

/** Provenance for the record, and the clone line the refusal prints. */
const OBJECTUI_REMOTE = 'https://github.com/objectstack-ai/objectui.git';

/**
 * The `ROOT_DIR_WATCH_HINTS` idiom — provenance for `scripts/pm/dispatch-gates.mjs`,
 * never read by this gate.
 *
 * #12956 asked that a `.objectui-sha` diff DERIVE the gates a pin bump exists to
 * run, and this gate is one of them by construction: the pin names the objectui
 * build whose renderer ships, so a bump is when a parser divergence starts being
 * shipped. Deriving it needs a watch hint, and the plain `'.objectui-sha'`
 * literal above builds none — measured on this tree at 96 hint literals:
 * `extractWatchHints` admits a leading-dot literal only from a fixed allowlist
 * (`.claude`, `.changeset`, `.github`, `.gitattributes`), and a root dotfile
 * outside it falls through both that admission and `hintCovers`' bare-word
 * refusal. The subtree spelling is the documented escape for a repo-ROOT FILE,
 * carried by `check-agent-test-spelling.mjs` as `AGENTS.md/**`:
 * `hintCovers('.objectui-sha/**', '.objectui-sha')` is true, and it overclaims
 * nothing because the pin has no nested namesakes.
 *
 * ⛔ Nothing here reads this array — the glob form is not a path any read in
 * this file could resolve. `--self-test` pins it to `PIN_FILE` in both
 * directions, so a declaration cannot drift from what the gate opens.
 */
export const ROOT_DIR_WATCH_HINTS = ['.objectui-sha/**'];

// ─────────────────────────────────────────────────────────────────────────────
// Measuring one side

/** git's own blob id for a byte string, so a reading here is comparable to `git hash-object`. */
export function gitBlobHash(text) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8');
  return createHash('sha1').update(Buffer.concat([header, body])).digest('hex');
}

/** Every non-test TypeScript source under one copy's `src/`, sorted, repo-relative. */
export function parserSources(root) {
  const base = join(root, PARSER_SRC);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  walk(base);
  return out;
}

/**
 * The grammar region of one `parse.ts`: the delimiter line to end of file.
 * `null` when the delimiter is absent — the caller REFUSES on that; it never
 * measures a region it could not find the start of.
 */
export function readRegion(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.trim() === REGION_DELIMITER);
  if (at === -1) return null;
  const region = lines.slice(at).join('\n');
  // The trailing newline of the last line is part of the file, so a region that
  // runs to EOF must carry it or its blob id is not the file's own tail.
  const lineCount = region.endsWith('\n') ? region.split('\n').length - 1 : region.split('\n').length;
  return { lines: lineCount, blob: gitBlobHash(region), text: region };
}

/**
 * Every diagnostic code one copy can stamp, and every code position it could
 * not resolve.
 *
 * Read from the AST, never from text: a text scan picks the phrase `code:
 * UNCONSUMED_WIDGET_OPTION` out of the very comment that DOCUMENTS the
 * divergence, and cannot tell `code: 'x'` (a stamped code) from `code: string`
 * (the Diagnostic type) or from `error(code: string, …)` (the emitter's own
 * parameter).
 *
 * Two stamping shapes, which is all either copy uses:
 *   - a `code:` property in an object literal — `{ code: 'inert-expression' }`
 *   - the emitter's first argument   — `this.error('no-root', …)`
 * with an identifier in either position resolved through the package's own
 * module-level string constants.
 */
export function extractDiagnosticCodes({ files, read }) {
  const trees = files.map((rel) => [rel, parseSourceFile(rel, read(rel))]);

  const constants = new Map();
  for (const [, sourceFile] of trees) {
    const visit = (node) => {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
        && ts.isStringLiteralLike(node.initializer)
      ) {
        constants.set(node.name.text, node.initializer.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const codes = new Map();
  const unresolved = [];
  for (const [rel, sourceFile] of trees) {
    const where = (node) => `${rel}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
    const take = (expr, node) => {
      if (ts.isStringLiteralLike(expr)) {
        if (!codes.has(expr.text)) codes.set(expr.text, []);
        codes.get(expr.text).push(where(node));
        return;
      }
      if (ts.isIdentifier(expr) && constants.has(expr.text)) {
        const value = constants.get(expr.text);
        if (!codes.has(value)) codes.set(value, []);
        codes.get(value).push(`${where(node)} (via ${expr.text})`);
        return;
      }
      unresolved.push(`${where(node)}: ${expr.getText(sourceFile)}`);
    };

    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'code') {
        take(node.initializer, node);
      }
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression;
        const name = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isIdentifier(callee)
            ? callee.text
            : null;
        if (name === 'error') take(node.arguments[0], node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { codes: [...codes.keys()].sort(), sites: codes, unresolved };
}

/** One copy's whole parity fingerprint: the region reading plus the code set. */
export function fingerprintOf(root) {
  const files = parserSources(root);
  const read = (rel) => readFileSync(join(root, rel), 'utf8');
  const region = readRegion(read(REGION_FILE));
  const { codes, unresolved } = extractDiagnosticCodes({ files, read });
  return { files, region, codes, unresolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparing

/** The record's shape, asserted before anything is compared against it. */
export function recordProblems(record) {
  const problems = [];
  if (record === null || typeof record !== 'object') return ['it is not a JSON object'];
  const rev = record.objectui?.rev;
  if (typeof rev !== 'string' || !/^[0-9a-f]{40}$/.test(rev)) {
    problems.push('`objectui.rev` is not a 40-character commit id');
  }
  if (typeof record.recordedAgainstPin !== 'string' || !/^[0-9a-f]{40}$/.test(record.recordedAgainstPin)) {
    problems.push('`recordedAgainstPin` is not a 40-character commit id');
  }
  if (typeof record.grammarRegion?.lines !== 'number' || record.grammarRegion.lines <= 0) {
    problems.push('`grammarRegion.lines` is not a positive line count');
  }
  if (typeof record.grammarRegion?.blob !== 'string' || !/^[0-9a-f]{40}$/.test(record.grammarRegion.blob)) {
    problems.push('`grammarRegion.blob` is not a 40-character blob id');
  }
  if (!Array.isArray(record.diagnosticCodes) || record.diagnosticCodes.length === 0) {
    problems.push('`diagnosticCodes` is not a non-empty array');
  }
  return problems;
}

/**
 * The verdict. Pure — every input is passed in, so `--self-test` drives the
 * same function the production run does rather than a paraphrase of it.
 */
export function judge({ record, ours, livePin }) {
  const findings = [];

  const shape = recordProblems(record);
  if (shape.length > 0) {
    for (const problem of shape) findings.push(`[record-unusable] ${RECORD_FILE}: ${problem}`);
    return findings; // nothing below can be measured against a record that is not one
  }

  if (ours.region === null) {
    findings.push(
      `[region-unreachable] ${REGION_FILE} does not contain the delimiter that opens the ported block:\n`
      + `    ${REGION_DELIMITER}\n`
      + '    Nothing was measured. If the block was renamed on both sides, update REGION_DELIMITER in this gate\n'
      + '    as part of that port; if it was deleted here, that IS the drift.',
    );
  }
  if (ours.unresolved.length > 0) {
    findings.push(
      '[code-unresolvable] a diagnostic code is stamped from something this gate cannot reduce to a literal,\n'
      + '    so the code set it would compare is incomplete and no comparison was made:\n'
      + ours.unresolved.map((u) => `      ${u}`).join('\n'),
    );
  }
  if (ours.codes.length === 0) {
    findings.push(
      `[code-set-empty] no diagnostic code was found under ${PARSER_SRC} — this copy stamps two dozen, so the\n`
      + '    extractor read nothing rather than finding nothing.',
    );
  }
  if (findings.length > 0) return findings;

  if (record.recordedAgainstPin !== livePin) {
    findings.push(
      `[pin-moved] ${PIN_FILE} is ${livePin.slice(0, 12)}, and the parity record was taken while it was\n`
      + `    ${record.recordedAgainstPin.slice(0, 12)}. The pin names the objectui build whose RENDERER ships, so a\n`
      + '    bump is exactly when a parser divergence stops being latent and starts being shipped.\n'
      + '    Re-record against the objectui checkout the bump already required:  pnpm gen:sdui-lockstep',
    );
  }

  if (ours.region.blob !== record.grammarRegion.blob) {
    findings.push(
      `[grammar-drift] the ported grammar region of ${REGION_FILE} is not byte-identical to objectui's at\n`
      + `    ${record.objectui.rev.slice(0, 12)}.\n`
      + `      here     ${ours.region.lines} line(s), blob ${ours.region.blob}\n`
      + `      recorded ${record.grammarRegion.lines} line(s), blob ${record.grammarRegion.blob}\n`
      + '    Either this copy was edited without the port, or the port was not byte-faithful. Diff the two\n'
      + `    copies' ${REGION_FILE} from the delimiter down.`,
    );
  }

  const recorded = new Set(record.diagnosticCodes);
  const mine = new Set(ours.codes);
  const onlyHere = ours.codes.filter((c) => !recorded.has(c));
  const onlyThere = record.diagnosticCodes.filter((c) => !mine.has(c));
  if (onlyHere.length > 0 || onlyThere.length > 0) {
    findings.push(
      `[code-drift] the diagnostic-code sets differ from objectui's at ${record.objectui.rev.slice(0, 12)}.\n`
      + (onlyHere.length ? `      only here     ${onlyHere.join(', ')}\n` : '')
      + (onlyThere.length ? `      only objectui ${onlyThere.join(', ')}\n` : '')
      + '    A code on one side only is a dialect: the save gate and the renderer disagree about what a page means.',
    );
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-recording objectui's side

/** Resolve an objectui checkout, or say why there is none. */
export function resolveObjectui(env = process.env) {
  const candidate = env.OBJECTUI_ROOT ? env.OBJECTUI_ROOT : join(ROOT, OBJECTUI_SIBLING);
  if (!existsSync(join(candidate, '.git'))) return { root: null, why: `no git checkout at ${candidate}` };
  if (!existsSync(join(candidate, PARSER_SRC))) return { root: null, why: `${candidate} has no ${PARSER_SRC}` };
  return { root: candidate, why: null };
}

function update() {
  const { root: objectui, why } = resolveObjectui();
  if (objectui === null) {
    console.error(
      `\ncheck-sdui-lockstep --update: REFUSED — ${why}.\n\n`
      + '  This re-records OBJECTUI\'s side, so it needs objectui on disk. Clone it beside this repo, or point\n'
      + '  OBJECTUI_ROOT at an existing checkout:\n\n'
      + `    git clone ${OBJECTUI_REMOTE} ${OBJECTUI_SIBLING}\n`
      + '    OBJECTUI_ROOT=/path/to/objectui pnpm gen:sdui-lockstep\n',
    );
    process.exit(1);
  }

  const git = (...args) => execFileSync('git', ['-C', objectui, ...args], { encoding: 'utf8' }).trim();
  const dirty = git('status', '--porcelain', '--', PARSER_SRC);
  if (dirty !== '') {
    console.error(
      `\ncheck-sdui-lockstep --update: REFUSED — ${objectui}/${PARSER_SRC} has uncommitted changes, so the\n`
      + '  revision recorded would not describe the bytes recorded:\n'
      + dirty.split('\n').map((l) => `    ${l}`).join('\n')
      + '\n',
    );
    process.exit(1);
  }

  const theirs = fingerprintOf(objectui);
  if (theirs.region === null) {
    console.error(
      `\ncheck-sdui-lockstep --update: REFUSED — ${objectui}/${REGION_FILE} does not contain the delimiter\n`
      + `  that opens the ported block (${REGION_DELIMITER}).\n`
      + '  Nothing was recorded. That checkout is at a revision from BEFORE the block existed, or the block was\n'
      + '  renamed there — either way the record must not claim a region nobody found.\n',
    );
    process.exit(1);
  }
  if (theirs.unresolved.length > 0 || theirs.codes.length === 0) {
    console.error(
      '\ncheck-sdui-lockstep --update: REFUSED — objectui\'s diagnostic-code set could not be read whole:\n'
      + (theirs.codes.length === 0 ? '    no code found at all\n' : '')
      + theirs.unresolved.map((u) => `    unresolvable: ${u}`).join('\n')
      + '\n',
    );
    process.exit(1);
  }

  const record = {
    $comment: [
      'GENERATED by `pnpm gen:sdui-lockstep`. Do not hand-edit.',
      "objectui's side of the sdui-parser lockstep (#12719), recorded at one objectui revision.",
      'ONE SIDE ONLY: this file holds no diff and blesses no divergence — see scripts/check-sdui-lockstep.mjs.',
    ],
    objectui: {
      repo: OBJECTUI_REMOTE,
      rev: git('rev-parse', 'HEAD'),
      revDate: git('show', '-s', '--format=%cI', 'HEAD'),
      source: PARSER_SRC,
      files: theirs.files,
    },
    recordedAgainstPin: readFileSync(join(ROOT, PIN_FILE), 'utf8').trim(),
    grammarRegion: {
      file: REGION_FILE,
      delimiter: REGION_DELIMITER,
      lines: theirs.region.lines,
      blob: theirs.region.blob,
    },
    diagnosticCodes: theirs.codes,
  };
  writeFileSync(join(ROOT, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `check-sdui-lockstep --update: recorded objectui@${record.objectui.rev.slice(0, 12)} `
    + `(${record.objectui.revDate}) — ${record.grammarRegion.lines} region line(s), blob `
    + `${record.grammarRegion.blob.slice(0, 12)}, ${record.diagnosticCodes.length} diagnostic code(s), `
    + `against pin ${record.recordedAgainstPin.slice(0, 12)}.`,
  );
  console.log(`  Wrote ${RECORD_FILE}. Now run \`pnpm check:sdui-lockstep\` — a RED there is the port you still owe.`);
}

// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_LITERAL_SIDE = `
export interface Diagnostic { code: string; message: string }
class P {
  private error(code: string, message: string): void { void code; void message; }
  run(): void { this.error('no-root', 'nothing'); }
}
export const stamp = { code: 'unconsumed-widget-option', message: 'x' };
// objectui writes \`code: PHANTOM_CODE\` here — prose, and prose is not a stamp.
export const prose = 'code: ALSO_NOT_A_STAMP';
`;

const FIXTURE_CONSTANT_SIDE = `
export interface Diagnostic { code: string; message: string }
export const UNCONSUMED_WIDGET_OPTION = 'unconsumed-widget-option';
class P {
  private error(code: string, message: string): void { void code; void message; }
  run(): void { this.error('no-root', 'nothing'); }
}
export const stamp = { code: UNCONSUMED_WIDGET_OPTION, message: 'x' };
`;

const FIXTURE_UNRESOLVABLE = `
import { SOMEWHERE_ELSE } from './elsewhere.js';
export const stamp = { code: SOMEWHERE_ELSE, message: 'x' };
`;

export function selfTest() {
  const failures = [];
  const check = (label, ok, detail) => {
    if (!ok) failures.push(detail === undefined ? label : `${label} — ${detail}`);
  };
  const extract = (sources) =>
    extractDiagnosticCodes({
      files: Object.keys(sources),
      read: (rel) => sources[rel],
    });

  // ── The constant-vs-literal decomposition (the false 24-vs-23) ────────────
  const literalSide = extract({ 'a.ts': FIXTURE_LITERAL_SIDE });
  const constantSide = extract({ 'b.ts': FIXTURE_CONSTANT_SIDE });
  check(
    'a code spelled as a literal on one side and a constant on the other reads the SAME on both',
    literalSide.codes.join(',') === constantSide.codes.join(','),
    `${literalSide.codes.join(',')} vs ${constantSide.codes.join(',')}`,
  );
  check(
    'both sides read exactly the two codes the fixtures stamp',
    literalSide.codes.join(',') === 'no-root,unconsumed-widget-option',
    literalSide.codes.join(','),
  );
  check(
    'the emitter\'s own `code: string` parameter is not a stamp',
    !literalSide.codes.includes('string'),
    literalSide.codes.join(','),
  );
  check(
    'the Diagnostic type\'s `code: string` member is not a stamp',
    literalSide.codes.length === 2,
    `${literalSide.codes.length} code(s)`,
  );
  check(
    'a `code: IDENT` written in PROSE or in a string is not a stamp',
    !literalSide.codes.includes('PHANTOM_CODE') && !literalSide.codes.includes('ALSO_NOT_A_STAMP'),
    literalSide.codes.join(','),
  );
  // The instrument returns non-zero: drop the constant declaration and the two
  // sides stop agreeing — which is the false difference this gate must not have.
  const withoutDeclaration = extract({
    'b.ts': FIXTURE_CONSTANT_SIDE.replace("export const UNCONSUMED_WIDGET_OPTION = 'unconsumed-widget-option';", ''),
  });
  check(
    'without the constant declaration the code is NOT silently dropped — it is reported unresolvable',
    withoutDeclaration.codes.join(',') === 'no-root' && withoutDeclaration.unresolved.length === 1,
    `${withoutDeclaration.codes.join(',')} / ${withoutDeclaration.unresolved.length} unresolved`,
  );
  const imported = extract({ 'c.ts': FIXTURE_UNRESOLVABLE });
  check(
    'a code stamped from an imported constant is unresolvable, not absent',
    imported.codes.length === 0 && imported.unresolved.length === 1,
    `${imported.codes.length} code(s), ${imported.unresolved.length} unresolved`,
  );

  // ── The region reader ────────────────────────────────────────────────────
  check('git blob id for an empty file', gitBlobHash('') === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  check('git blob id for "x\\n"', gitBlobHash('x\n') === '587be6b4c3f93f93c489c0111bba5596147a26cb');
  check(
    'git blob id for "the JS literal subset\\n"',
    gitBlobHash('the JS literal subset\n') === '75fa806558a3921e1cda522d5730f98129980925',
  );
  const withRegion = `head\n${REGION_DELIMITER}\nalpha\nbeta\n`;
  const region = readRegion(withRegion);
  check('the region runs from the delimiter to end of file', region?.lines === 3, `${region?.lines} line(s)`);
  check('a file without the delimiter yields null, never a shorter region', readRegion('head\nbody\n') === null);
  check(
    'one changed character in the region changes its blob id',
    readRegion(`head\n${REGION_DELIMITER}\nalpha\nbetb\n`)?.blob !== region?.blob,
  );
  check(
    'text ABOVE the delimiter does not change the region blob id',
    readRegion(`different head\n${REGION_DELIMITER}\nalpha\nbeta\n`)?.blob === region?.blob,
  );

  // ── The verdict ──────────────────────────────────────────────────────────
  const goodRecord = {
    objectui: { rev: 'a'.repeat(40) },
    recordedAgainstPin: 'b'.repeat(40),
    grammarRegion: { lines: 3, blob: region.blob },
    diagnosticCodes: ['no-root', 'unconsumed-widget-option'],
  };
  const goodOurs = { region, codes: ['no-root', 'unconsumed-widget-option'], unresolved: [] };
  const kinds = (f) => f.map((x) => x.slice(1, x.indexOf(']'))).join(',');
  check('agreement is silent', judge({ record: goodRecord, ours: goodOurs, livePin: 'b'.repeat(40) }).length === 0);
  check(
    'a moved pin is a finding',
    kinds(judge({ record: goodRecord, ours: goodOurs, livePin: 'c'.repeat(40) })) === 'pin-moved',
  );
  check(
    'a one-character grammar change is a finding',
    kinds(judge({
      record: goodRecord,
      ours: { ...goodOurs, region: readRegion(`head\n${REGION_DELIMITER}\nalpha\nbetb\n`) },
      livePin: 'b'.repeat(40),
    })) === 'grammar-drift',
  );
  check(
    'a code present on one side only is a finding, in either direction',
    kinds(judge({
      record: goodRecord,
      ours: { ...goodOurs, codes: ['no-root'] },
      livePin: 'b'.repeat(40),
    })) === 'code-drift'
    && kinds(judge({
      record: goodRecord,
      ours: { ...goodOurs, codes: [...goodOurs.codes, 'brand-new'] },
      livePin: 'b'.repeat(40),
    })) === 'code-drift',
  );
  // ── Absence is loud: every degraded input REFUSES rather than passing ─────
  check(
    'a missing record is a finding, not a pass',
    kinds(judge({ record: null, ours: goodOurs, livePin: 'b'.repeat(40) })) === 'record-unusable',
  );
  for (const [label, mutate] of [
    ['no rev', (r) => ({ ...r, objectui: {} })],
    ['no pin', (r) => ({ ...r, recordedAgainstPin: undefined })],
    ['no blob', (r) => ({ ...r, grammarRegion: { lines: 3 } })],
    ['empty code list', (r) => ({ ...r, diagnosticCodes: [] })],
  ]) {
    check(
      `a record with ${label} is unusable, not a pass`,
      kinds(judge({ record: mutate(goodRecord), ours: goodOurs, livePin: 'b'.repeat(40) })) === 'record-unusable',
      label,
    );
  }
  check(
    'a missing delimiter in THIS tree refuses instead of comparing',
    kinds(judge({ record: goodRecord, ours: { ...goodOurs, region: null }, livePin: 'b'.repeat(40) }))
      === 'region-unreachable',
  );
  check(
    'an unresolvable code position refuses instead of comparing a short set',
    kinds(judge({
      record: goodRecord,
      ours: { ...goodOurs, unresolved: ['x.ts:1: SOMEWHERE_ELSE'] },
      livePin: 'b'.repeat(40),
    })) === 'code-unresolvable',
  );
  check(
    'an empty code set refuses instead of reporting agreement with a record that has codes',
    kinds(judge({ record: goodRecord, ours: { ...goodOurs, codes: [] }, livePin: 'b'.repeat(40) }))
      === 'code-set-empty',
  );

  // ── The wiring this gate needs to be reachable at all ────────────────────
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  check(
    'the package script runs the self-test before the gate',
    /--self-test/.test(pkg.scripts?.['check:sdui-lockstep'] ?? '')
      && /check-sdui-lockstep\.mjs/.test(pkg.scripts?.['check:sdui-lockstep'] ?? ''),
    pkg.scripts?.['check:sdui-lockstep'],
  );
  check(
    'the regeneration alias exists and points at --update',
    /--update/.test(pkg.scripts?.['gen:sdui-lockstep'] ?? ''),
    pkg.scripts?.['gen:sdui-lockstep'],
  );
  const lint = readFileSync(join(ROOT, '.github/workflows/lint.yml'), 'utf8');
  const wired = lint.split('\n').filter((line) => /run: pnpm check:sdui-lockstep\s*$/.test(line));
  check('lint.yml runs the gate exactly once', wired.length === 1, `found ${wired.length}`);
  // The path literals are what `scripts/pm/dispatch-gates.mjs` derives this gate
  // from. `.objectui-sha` is the one the card required by name (#12956): a pin
  // bump must NAME this gate, not merely be covered by CI's unfiltered lint job.
  const own = readFileSync(join(ROOT, 'scripts/check-sdui-lockstep.mjs'), 'utf8');
  const inCode = own.slice(own.indexOf('\nimport '));
  for (const literal of [PARSER_SRC, RECORD_FILE, REGION_FILE]) {
    check(
      `\`${literal}\` is a path literal in this gate's code, so the derivation can name it`,
      inCode.includes(`'${literal}'`),
    );
  }
  // The pin is the one population a plain literal cannot carry — see
  // ROOT_DIR_WATCH_HINTS. Both directions, so the declaration can neither go
  // missing nor start claiming a file this gate does not open.
  check(
    'the pin is declared in the subtree spelling the derivation can see',
    ROOT_DIR_WATCH_HINTS.includes(`${PIN_FILE}/**`),
    ROOT_DIR_WATCH_HINTS.join(','),
  );
  check(
    'and nothing is declared that this gate does not read',
    ROOT_DIR_WATCH_HINTS.every((hint) => hint.replace(/\/\*+$/, '') === PIN_FILE),
    ROOT_DIR_WATCH_HINTS.join(','),
  );
  check(
    'the plain literal is still spelled too, so the file the gate opens is named as written',
    inCode.includes(`'${PIN_FILE}'`),
  );

  if (failures.length) {
    console.error('check:sdui-lockstep --self-test FAILED');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    'check:sdui-lockstep --self-test passed (the constant-vs-literal decomposition and its unresolvable '
    + 'direction, the region reader in both drift directions, all four refusal classes, and the CI wiring)',
  );
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  if (process.argv.includes('--update')) {
    update();
    return;
  }

  let record = null;
  try {
    record = JSON.parse(readFileSync(join(ROOT, RECORD_FILE), 'utf8'));
  } catch (error) {
    console.error(
      `\ncheck-sdui-lockstep: REFUSED — ${RECORD_FILE} could not be read or parsed (${error.message}).\n`
      + '  Nothing was compared. Regenerate it from an objectui checkout:  pnpm gen:sdui-lockstep\n',
    );
    process.exit(1);
  }

  let livePin = null;
  try {
    livePin = readFileSync(join(ROOT, PIN_FILE), 'utf8').trim();
  } catch (error) {
    console.error(`\ncheck-sdui-lockstep: REFUSED — ${PIN_FILE} could not be read (${error.message}).\n`);
    process.exit(1);
  }

  const ours = fingerprintOf(ROOT);
  const findings = judge({ record, ours, livePin });

  if (findings.length === 0) {
    console.log(
      `check:sdui-lockstep: OK — this copy is byte-identical to objectui@${record.objectui.rev.slice(0, 12)} `
      + `(${record.objectui.revDate}) over ${ours.region.lines} grammar line(s) `
      + `[blob ${ours.region.blob.slice(0, 12)}] and agrees on all ${ours.codes.length} diagnostic code(s), `
      + `across ${ours.files.length} non-test source(s).`,
    );
    console.log(
      `  Recorded against pin ${record.recordedAgainstPin.slice(0, 12)}; the live pin is ${livePin.slice(0, 12)}. `
      + 'This gate does NOT see objectui moving after that revision — only a pin bump brings that question back.',
    );
    return;
  }

  console.error(`\ncheck:sdui-lockstep: ${findings.length} finding(s) — the two sdui-parser copies have drifted\n`);
  for (const finding of findings) console.error(`  ${finding}\n`);
  console.error(
    '  Why this matters: objectui\'s copy runs in the RENDERER and this one runs in the SAVE GATE. When they\n'
    + '  disagree, a page saves clean and renders inert (#12719) — a surface-dependent failure that reaches an\n'
    + '  author as intermittent, so nothing pushes it back up.\n',
  );
  process.exit(1);
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  main();
}
