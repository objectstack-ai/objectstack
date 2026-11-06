#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Call-site census of the vouched-reference mark.
 *
 *   node scripts/check-vouch-for-reference-callers.mjs
 *   node scripts/check-vouch-for-reference-callers.mjs --self-test
 *
 * ## The rule it holds
 *
 * A write that is not a system write may name, in a `lookup`, `user` or
 * `master_detail` field, only a record its caller's own read door returns
 * (`assertReferencesResolve`, objectql). The one exception is a reference a
 * service verb vouches for on its own write (`vouchForReference`,
 * `@objectstack/core`): a record the same call authorized for the caller, set
 * only after that verb's own authorization, and never on a context a request,
 * an import, a flow or an agent tool hands the engine. Whether a call site
 * honours that is a judgement a reviewer makes once, when the call site is
 * written. This gate makes sure no call site arrives without that review: every
 * production source file that sets the mark is named in {@link ALLOWED_CALLERS}
 * with the exact number of call sites it holds, and the gate is red when a file
 * outside the list sets it, when a listed file holds more or fewer call sites
 * than its row, and when a row names a file that no longer sets it.
 *
 * "Sets the mark" is decided three ways, each a spelling that reaches the same
 * context key:
 *
 *  1. a call `vouchForReference(` (not a mention in a comment or in backticks);
 *  2. an import that renames it (`vouchForReference as …`), which would hide
 *     every later call from (1);
 *  3. the key itself, outside the module that defines it — `VOUCHED_REFERENCES`
 *     used as a computed property, or `Symbol.for('objectstack.core.vouchedReferences')`
 *     spelled anywhere else — a context built with the key by hand.
 *
 * Test files (`*.test.*`, `*.spec.*`, `*.testkit.*`, `__tests__/`) are outside
 * the census: they set the mark on purpose to pin what it admits.
 *
 * The scan surface is git's (`git ls-files --cached --others --exclude-standard`
 * under `packages/`), so build output never reads as a call site.
 *
 * Adding a caller is an edit to {@link ALLOWED_CALLERS} in the same change,
 * with the reason in the row: what the verb created or authorized for the
 * caller, and which authorization it asked first.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The module that defines the mark; its own spellings are not call sites. */
const DEFINING_MODULE = 'packages/core/src/security/vouched-reference.ts';

/**
 * Every production file that sets the mark, with its exact call-site count and
 * the reason it may. Equality, not a ceiling: one more call site is a new
 * vouch nobody reviewed, one fewer is a row that no longer says what the file
 * does.
 */
export const ALLOWED_CALLERS = Object.freeze({
  'packages/services/service-storage/src/file-attachment-service.ts': {
    count: 2,
    reason:
      'the file-attachments writer: attachFileAs vouches for the sys_file it created in the same call, and ' +
      "attachUploadAs for the caller's own unheld pending upload it commits in the same unit — each only for " +
      'sys_attachment.file_id, after that verb\'s own attach authorization',
  },
});

const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const TEST_FILE = /(?:\.test\.|\.spec\.|\.testkit\.|\/__tests__\/|\/__fixtures__\/)/;

/** A line that is a comment, by its first non-blank characters. */
const isCommentLine = (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

/** Strip backtick-quoted spans, so prose naming `vouchForReference(` is no call. */
const withoutBacktickSpans = (line) => line.replace(/`[^`]*`/g, '``');

/**
 * The census of one file's text: its call sites and the spellings that would
 * hide or bypass one.
 */
export function censusOf(path, text) {
  let calls = 0;
  const findings = [];
  const lines = String(text).split('\n');
  lines.forEach((raw, index) => {
    if (isCommentLine(raw)) return;
    const line = withoutBacktickSpans(raw.replace(/\/\/.*$/, ''));
    const where = `${path}:${index + 1}`;
    const callHits = line.match(/\bvouchForReference\s*\(/g);
    if (callHits && path !== DEFINING_MODULE) calls += callHits.length;
    if (/\bvouchForReference\s+as\s+\w/.test(line)) {
      findings.push(`${where}: renames vouchForReference on import — every later call would hide from this census`);
    }
    if (path === DEFINING_MODULE) return;
    if (/\[\s*VOUCHED_REFERENCES\s*\]/.test(line)) {
      findings.push(`${where}: builds the mark's key by hand ([VOUCHED_REFERENCES]) — call vouchForReference instead`);
    }
    if (/Symbol\.for\(\s*['"]objectstack\.core\.vouchedReferences['"]\s*\)/.test(line)) {
      findings.push(`${where}: spells the mark's symbol by hand — call vouchForReference instead`);
    }
  });
  return { calls, findings };
}

/** The verdict over a set of `{ path, text }` files against `allowed`. */
export function check(files, allowed = ALLOWED_CALLERS) {
  const problems = [];
  if (files.length === 0) {
    problems.push('the scan found no source files at all — an empty scan proves nothing, so it is refused');
    return { problems, counts: new Map() };
  }
  const counts = new Map();
  for (const { path, text } of files) {
    if (!SOURCE_FILE.test(path) || TEST_FILE.test(path)) continue;
    const { calls, findings } = censusOf(path, text);
    problems.push(...findings);
    if (calls > 0) counts.set(path, calls);
  }
  for (const [path, calls] of counts) {
    const row = allowed[path];
    if (!row) {
      problems.push(
        `${path}: sets the vouched-reference mark ${calls} time(s) and is not in ALLOWED_CALLERS. A vouch lets one ` +
          "reference skip the caller's read door; add the row with its reason only after review, or write as the caller.",
      );
    } else if (row.count !== calls) {
      problems.push(
        `${path}: sets the vouched-reference mark ${calls} time(s); its ALLOWED_CALLERS row pins ${row.count}. ` +
          'Every call site is reviewed on its own: update the row (and its reason) in the same change.',
      );
    }
  }
  for (const path of Object.keys(allowed)) {
    if (!counts.has(path)) {
      problems.push(`${path}: is in ALLOWED_CALLERS and no longer sets the mark — remove the stale row.`);
    }
  }
  return { problems, counts };
}

/** The files the census reads: what git sees under `packages/`, never build output. */
function readTree() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'packages'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const files = [];
  for (const path of out.split('\0')) {
    if (!path || !SOURCE_FILE.test(path) || TEST_FILE.test(path)) continue;
    let text;
    try {
      text = readFileSync(join(REPO, path), 'utf8');
    } catch {
      continue; // listed by git, deleted in the working tree
    }
    if (!text.includes('vouchForReference') && !text.includes('VOUCHED_REFERENCES') && !text.includes('vouchedReferences')) {
      text = '';
    }
    files.push({ path, text });
  }
  return files;
}

// ── Self-test ──────────────────────────────────────────────────────────────
//
// Table-driven, as `check-agent-model-declared.mjs`'s: each row LABEL is a
// declared battery with a floor of 1, registered as the first statement of the
// loop body; the roster's own size is pinned; and the verdict sets a flag the
// dispatch refuses without (AGENTS.md, "Writing a --self-test").

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'an allow-listed file with exactly its pinned call sites → GREEN': 1,
  'a call from a file outside the allow-list → RED': 1,
  'an allow-listed file with one more call site than its row → RED': 1,
  'an allow-listed file with one fewer call site than its row → RED': 1,
  'a row naming a file that no longer sets the mark → RED (stale row)': 1,
  'an import that renames vouchForReference → RED': 1,
  'the key built by hand as [VOUCHED_REFERENCES] → RED': 1,
  "the symbol spelled by hand with Symbol.for → RED": 1,
  'a test file that sets the mark → GREEN (outside the census)': 1,
  'a comment or backtick mention is no call site → GREEN': 1,
  'the defining module’s own spellings → GREEN': 1,
  'an empty scan → RED, never a green skip': 1,
});
const SELF_TEST_BATTERY_FLOOR = 12;

function selfTest() {
  const VERB = 'packages/services/demo/src/verb.ts';
  const OTHER = 'packages/rest/src/door.ts';
  const ALLOW = { [VERB]: { count: 1, reason: 'demo' } };
  const call = "  const ctx = vouchForReference(context, { object: 'o', field: 'f', id });\n";
  const filler = { path: 'packages/core/src/other.ts', text: 'export const x = 1;\n' };

  const cases = [
    { label: 'an allow-listed file with exactly its pinned call sites → GREEN', files: [{ path: VERB, text: call }], expect: 'green' },
    { label: 'a call from a file outside the allow-list → RED', files: [{ path: VERB, text: call }, { path: OTHER, text: call }], expect: 'red', names: OTHER },
    { label: 'an allow-listed file with one more call site than its row → RED', files: [{ path: VERB, text: call + call }], expect: 'red', names: VERB },
    { label: 'an allow-listed file with one fewer call site than its row → RED', files: [{ path: VERB, text: call }], allow: { [VERB]: { count: 2, reason: 'demo' } }, expect: 'red', names: VERB },
    { label: 'a row naming a file that no longer sets the mark → RED (stale row)', files: [filler], expect: 'red', names: VERB },
    { label: 'an import that renames vouchForReference → RED', files: [{ path: VERB, text: call }, { path: OTHER, text: "import { vouchForReference as vouch } from '@objectstack/core';\n" }], expect: 'red', names: OTHER },
    { label: 'the key built by hand as [VOUCHED_REFERENCES] → RED', files: [{ path: VERB, text: call }, { path: OTHER, text: '  const ctx = { ...context, [VOUCHED_REFERENCES]: [ref] };\n' }], expect: 'red', names: OTHER },
    { label: "the symbol spelled by hand with Symbol.for → RED", files: [{ path: VERB, text: call }, { path: OTHER, text: "  const k = Symbol.for('objectstack.core.vouchedReferences');\n" }], expect: 'red', names: OTHER },
    { label: 'a test file that sets the mark → GREEN (outside the census)', files: [{ path: VERB, text: call }, { path: 'packages/rest/src/door.test.ts', text: call + '  ({ [VOUCHED_REFERENCES]: [] });\n' }], expect: 'green' },
    { label: 'a comment or backtick mention is no call site → GREEN', files: [{ path: VERB, text: call }, { path: OTHER, text: '// vouchForReference(context, ref) is the verb\'s\n * see vouchForReference( here\nconst s = `vouchForReference(x)`;\n' }], expect: 'green' },
    { label: 'the defining module’s own spellings → GREEN', files: [{ path: VERB, text: call }, { path: DEFINING_MODULE, text: "export const VOUCHED_REFERENCES = Symbol.for('objectstack.core.vouchedReferences');\nexport function vouchForReference(context, reference) {\n  return { ...context, [VOUCHED_REFERENCES]: [] };\n}\n" }], expect: 'green' },
    { label: 'an empty scan → RED, never a green skip', files: [], expect: 'red', names: 'no source files' },
  ];

  const batterySeen = new Map();
  let failed = 0;
  for (const c of cases) {
    batterySeen.set(c.label, (batterySeen.get(c.label) ?? 0) + 1);
    const { problems } = check(c.files, c.allow ?? ALLOW);
    const red = problems.length > 0;
    const ok =
      (c.expect === 'green' && !red) ||
      (c.expect === 'red' && red && (!c.names || problems.some((p) => p.includes(c.names))));
    if (!ok) {
      failed += 1;
      console.error(`✗ ${c.label}\n    expected ${c.expect}${c.names ? ` naming ${c.names}` : ''}, got: ${red ? problems.join(' | ') : 'green'}`);
    }
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  const labels = cases.map((c) => c.label);
  const duplicated = [...new Set(labels.filter((l, i) => labels.indexOf(l) !== i))];
  if (duplicated.length > 0) floorFailure(`row label(s) used more than once: ${duplicated.join(', ')}`);
  for (const [name] of batterySeen) {
    if (!declared.includes(name)) floorFailure(`battery "${name}" ran but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const seen = batterySeen.get(name) ?? 0;
    if (seen < SELF_TEST_BATTERIES[name]) {
      floorFailure(`battery "${name}" DID NOT RUN — ${seen} case(s) registered, ${SELF_TEST_BATTERIES[name]} pinned.`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ check-vouch-for-reference-callers self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`✓ check-vouch-for-reference-callers self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '✗ check-vouch-for-reference-callers self-test: selfTest() returned without reaching its verdict, so no ' +
          'success line was printed; exiting 0 would report a self-test that never finished as one that passed.',
      );
      process.exit(1);
    }
    return;
  }
  const { problems, counts } = check(readTree());
  if (problems.length > 0) {
    console.error(`✗ check-vouch-for-reference-callers: ${problems.length} finding(s)\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const listed = [...counts].map(([path, n]) => `${path} (${n})`).join(', ');
  console.log(`✓ check-vouch-for-reference-callers: every call site that sets the vouched-reference mark is allow-listed — ${listed}.`);
}

if (isEntrypoint(import.meta.url)) {
  main();
}
