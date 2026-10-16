#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-pnpm-flag-spellings -- no committed pnpm call may spell a flag that a
 * global pnpm 11+/12 `@pnpm/exe` frontend rejects before it hands off to the
 * pinned pnpm.
 *
 *   node scripts/check-pnpm-flag-spellings.mjs              # the gate
 *   node scripts/check-pnpm-flag-spellings.mjs --list       # every pnpm run it judged
 *   node scripts/check-pnpm-flag-spellings.mjs --self-test  # prove it can go red
 *
 * ## The defect
 *
 * The root manifest pins `packageManager: pnpm@10.31.0`, so every script runs
 * on 10.31 -- but a contributor whose GLOBAL pnpm is the newer `@pnpm/exe`
 * 11.x / 12.x frontend reaches 10.31 through that frontend, and the frontend
 * parses the argv itself (clap-style) BEFORE it hands off. It rejects some
 * spellings 10.31 accepts, exits 2, and the pinned pnpm never runs.
 *
 * Measured 2026-10-16 in a scratch workspace pinned to 10.31.0, with both
 * binaries (PR #23777 carries the full tables, including the controls):
 *
 *   rejected   `-s`                   unexpected argument '-s' found
 *              `--prod=false`         unexpected value 'false' for '--prod' found
 *              `--production=false`   unexpected value
 *              `--no-production`      unexpected argument
 *   accepted   `--silent`, `--reporter=silent`, `--no-prod`,
 *              `--config.production=false`
 *
 * `--silent` and `--reporter=silent` were byte-identical to `-s` there
 * (stdout, stderr, exit code). `--loglevel=silent` is NOT: it still prints the
 * `> pkg script` header, so it is no substitute and this gate never suggests it.
 *
 * The failure does not look like a flag problem where it lands. Before #23777,
 * `check:generated` spawned every gate as `pnpm -s <gate>` and read the exit 2
 * as "every artifact stale"; the pre-commit regen gate refused every commit;
 * `pnpm objectui:build` installed nothing.
 *
 * ## Why only a source scan can catch it
 *
 * CI acquires pnpm through Corepack, which runs the real 10.31 binary with no
 * frontend in front of it, and 10.31 accepts every spelling above. So a
 * regression is GREEN on every CI run and red only on a contributor's laptop.
 * No test can see it; the spelling in the committed source can.
 *
 * ## What is a "pnpm run", and where in it a flag is judged
 *
 * A run is the token `pnpm` and the tokens after it, up to a shell boundary
 * (`|`, `;`, `&`, a backtick, a paren) or the end of the logical line. Three
 * source forms are read:
 *
 *   1. SHELL TEXT -- every logical line (`\`-continuations joined) of a shell
 *      file, comments stripped, and every `scripts` value of a `package.json`.
 *   2. JS/TS STRING LITERALS -- the content of every quoted string and
 *      template literal, read as shell text: `execSync(`pnpm --silent ${s}`)`.
 *      Each `${...}` reads as one opaque word. Comments are masked through
 *      `js-comment-mask.mjs`; a regex literal is a pattern, not a call, and is
 *      never read.
 *   3. JS/TS ARGV ARRAYS -- a string literal that is exactly `pnpm`, followed
 *      by a comma: the elements after it at the same level are its argv, and
 *      when the first of them is an array literal, that array's elements are.
 *      So `spawnSync('pnpm', ['--filter', pkg, '-s', 'build'])` and the tuple
 *      `['pnpm', '-s', 'build']` are both read. A non-literal element is one
 *      opaque word.
 *
 * Inside a run only pnpm's OWN option positions are judged:
 *
 *   - before the command word;
 *   - after a built-in command (`install`, `add`, `list`, `store`, `pack`, ...),
 *     whose options pnpm itself parses;
 *   - between `run` / `exec` / `dlx` / `create` and its target.
 *
 * Everything after a script name, a bin (`pnpm turbo ...`, `pnpm tsx ...`) or
 * the target of `run`/`exec`/`dlx` is FORWARDED to that program, and so is
 * everything after a bare `--`: `pnpm build -s` hands `-s` to the build script,
 * and that is never judged. `pnpm test` / `pnpm start` are `pnpm run` aliases,
 * so they forward too. `git ls-files -s` has no `pnpm` token and is no run.
 *
 * A value-taking pnpm flag this file does not list makes its value read as the
 * command word, and the rest of that run goes unjudged -- a MISS, never a
 * false red. That direction is deliberate: a gate over correct commands must
 * fail toward silence, or it teaches people to route around it.
 *
 * ## The population
 *
 * TRACKED files only (`git ls-files`), read from the working tree:
 *
 *   - `scripts/**`, every `scripts/` directory under `packages/`, `.githooks/**`
 *     -- JS/TS files by extension, shell files by extension or by an `sh`/`bash`
 *     shebang (the git hooks have no extension);
 *   - every tracked `package.json`, wherever it sits, for its `scripts` values.
 *
 * JSON data, Markdown and text files under those roots are counted and not
 * read: they hold baselines and prose, not invocations. `.github/workflows/**`
 * is out of scope on purpose -- CI's pnpm is Corepack's real 10.31 binary,
 * which no frontend fronts, so a workflow cannot hit this defect.
 *
 * ## What it does not see -- misses, named so nobody reads the green as more
 *
 *   - a flag assembled from a variable (`pnpm${flag}`, `pnpm $FLAGS build`);
 *     `ownerRunCommand` in `scripts/regen-artifacts.mjs` builds its silence
 *     flag that way, and `scripts/git-merge-regen.mjs --self-test` pins the
 *     string it produces;
 *   - an argv array built somewhere else (`spawnSync('pnpm', args)`);
 *   - a combined short cluster (`-rs`).
 *
 * ## Absence is loud
 *
 * `sweep()` REFUSES -- exit 2, never 0 -- when `git ls-files` fails, when a
 * declared root holds no tracked file, when no tracked `package.json` carries
 * `scripts`, when a tracked `package.json` does not parse, or when the whole
 * population yields no pnpm run at all. Each of those is a broken selector
 * wearing a pass. The success line prints the population and how many accepted
 * spellings it saw in judged positions, so a zero reads as a measurement.
 *
 * This file is the one file it does not judge: its `--self-test` fixtures spell
 * every rejected form. `RULE_OWNING_FILES` is pinned at exactly that one entry.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { scanSource } from './js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SELF = 'scripts/check-pnpm-flag-spellings.mjs';

export const EXIT_CLEAN = 0;
export const EXIT_VIOLATIONS = 1;
export const EXIT_REFUSED = 2;

/**
 * The declared roots, as git pathspecs. Each must hold at least one tracked
 * file or the sweep refuses: a root that moved would otherwise shrink the
 * population to nothing, in silence.
 */
export const ROOTS = Object.freeze([
  Object.freeze({ label: 'scripts/', pathspec: ':(glob)scripts/**' }),
  Object.freeze({ label: 'packages/**/scripts/', pathspec: ':(glob)packages/**/scripts/**' }),
  Object.freeze({ label: '.githooks/', pathspec: ':(glob).githooks/**' }),
]);

/** Every tracked `package.json`, the repo root's included. */
export const MANIFEST_PATHSPEC = ':(glob)**/package.json';

/** The file that owns this rule, and so is not judged by it (see the header). */
export const RULE_OWNING_FILES = Object.freeze([SELF]);

const JS_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts', '.mts', '.cts']);
const SHELL_EXTENSIONS = new Set(['.sh', '.bash']);

/* ───────────────────────────── the spellings ──────────────────────────────── */

/**
 * The spellings the frontend rejects, each with what it says and the spelling
 * both pnpm versions accept. `fix` receives the token, so a `--prod=VALUE` keeps
 * its own value.
 */
export const REJECTED = Object.freeze([
  Object.freeze({
    matches: (token) => token === '-s',
    says: "the frontend has no short `-s` (\"unexpected argument '-s' found\", exit 2)",
    fix: () => '--silent',
  }),
  Object.freeze({
    matches: (token) => /^--prod(uction)?=/.test(token),
    says: '`--prod` / `--production` are booleans to the frontend, which refuses a value on them ("unexpected value", exit 2)',
    fix: (token) => `--config.production=${token.slice(token.indexOf('=') + 1)}`,
  }),
  Object.freeze({
    matches: (token) => token === '--no-production',
    says: 'the frontend knows no `--no-production` ("unexpected argument", exit 2)',
    fix: () => '--config.production=false',
  }),
]);

/** Accepted spellings, counted where they are judged so the zero is a measurement. */
const ACCEPTED = Object.freeze([
  ['--silent', (token) => token === '--silent'],
  ['--reporter=silent', (token) => token === '--reporter=silent'],
  ['--no-prod', (token) => token === '--no-prod'],
  ['--config.production=', (token) => token.startsWith('--config.production=')],
]);

/**
 * pnpm flags that take the NEXT token as their value. Incomplete by design and
 * safe that way: an unlisted one makes its value read as the command word, and
 * the rest of the run goes unjudged. ⛔ Never list a boolean flag here -- it
 * would swallow the script name and judge that script's forwarded flags.
 */
const VALUE_FLAGS = new Set([
  '--filter', '-F', '--filter-prod', '--dir', '-C', '--workspace-concurrency',
  '--reporter', '--loglevel', '--use-node-version', '--test-pattern',
  '--changed-files-ignore-pattern', '--depth', '--store-dir', '--virtual-store-dir',
  '--modules-dir', '--lockfile-dir', '--cache-dir', '--registry', '--pack-destination',
  '--resume-from', '--audit-level', '--package', '--tag', '--otp', '--access',
  '--network-concurrency', '--child-concurrency',
]);

/**
 * Built-in commands whose own options pnpm parses -- a flag after one is still
 * pnpm's. A built-in missing here reads as a script: a miss, not a false red.
 */
const BUILTIN_COMMANDS = new Set([
  'add', 'approve-builds', 'audit', 'bin', 'cache', 'cat-file', 'cat-index', 'completion',
  'config', 'dedupe', 'deploy', 'doctor', 'env', 'fetch', 'find-hash', 'get', 'help', 'i',
  'ignored-builds', 'import', 'init', 'install', 'install-test', 'it', 'la', 'licenses', 'link',
  'list', 'll', 'ln', 'ls', 'outdated', 'pack', 'patch', 'patch-commit', 'patch-remove', 'prune',
  'publish', 'rb', 'rebuild', 'remove', 'rm', 'root', 'sbom', 'self-update', 'server', 'set',
  'setup', 'store', 'un', 'uninstall', 'unlink', 'up', 'update', 'upgrade', 'why',
]);

/** Commands whose target receives everything after it. */
const RUN_KEYWORDS = new Set(['run', 'run-script', 'exec', 'dlx', 'create']);

/** Words that change scope and are followed by the real command. */
const PREFIX_KEYWORDS = new Set(['recursive', 'multi', 'm']);

/** A non-literal argv element, or a `${...}` in a template: an opaque word. */
export const OPAQUE = '\u0000opaque';

/* ───────────────────────────── judging a run ──────────────────────────────── */

/**
 * Judge one pnpm run.
 *
 * @param {string[]} argv decoration-stripped tokens; `argv[0]` is the launcher
 * @returns {{ findings: { token: string, says: string, fix: string }[], judged: number, accepted: string[] }}
 */
export function judgeRun(argv) {
  const findings = [];
  const accepted = [];
  let judged = 0;
  let mode = 'options'; // 'options' | 'builtin' | 'target'
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') break;
    if (token.length > 1 && token.startsWith('-')) {
      judged++;
      const rule = REJECTED.find((r) => r.matches(token));
      if (rule) findings.push({ token, says: rule.says, fix: rule.fix(token) });
      for (const [name, matches] of ACCEPTED) if (matches(token)) accepted.push(name);
      if (!token.includes('=') && VALUE_FLAGS.has(token)) i++;
      continue;
    }
    if (mode === 'builtin') continue; // a built-in's positional argument
    if (mode === 'options' && PREFIX_KEYWORDS.has(token)) continue;
    if (mode === 'options' && RUN_KEYWORDS.has(token)) {
      mode = 'target';
      continue;
    }
    if (mode === 'options' && BUILTIN_COMMANDS.has(token)) {
      mode = 'builtin';
      continue;
    }
    break; // a script, a bin, or run/exec/dlx's target: the rest is forwarded
  }
  return { findings, judged, accepted };
}

/* ─────────────────────────────── shell text ───────────────────────────────── */

/**
 * Join `\`-continued lines into logical lines; each keeps the 0-based index of
 * its FIRST physical line, so a finding points at the line a reader opens.
 *
 * @param {string} text
 * @returns {{ index: number, text: string }[]}
 */
export function logicalLines(text) {
  const out = [];
  const raw = text.split('\n');
  let buffer = null;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const continues = /\\\s*$/.test(raw[i]);
    const body = continues ? raw[i].replace(/\\\s*$/, ' ') : raw[i];
    if (buffer === null) {
      start = i;
      buffer = body;
    } else {
      buffer += ` ${body.trim()}`;
    }
    if (!continues) {
      out.push({ index: start, text: buffer });
      buffer = null;
    }
  }
  if (buffer !== null) out.push({ index: start, text: buffer });
  return out;
}

/**
 * A shell line with its comment cut: a `#` at the start of the line or after
 * whitespace, outside quotes. `${#arr[@]}`, `$#` and a URL fragment survive.
 *
 * @param {string} line
 */
export function cutShellComment(line) {
  let quote = null;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') k++;
      continue;
    }
    if (c === '\\') {
      k++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '#' && (k === 0 || /\s/.test(line[k - 1]))) return line.slice(0, k);
  }
  return line;
}

/** Shell boundaries that end a run. `<` / `>` are not: `<pkg>` is a placeholder. */
const BOUNDARY = /[|;&`()]+/;

/** @param {string} token */
function stripDecoration(token) {
  return token.replace(/^[`'"*_,.:[\]]+/, '').replace(/[`'"*_,.:[\]]+$/, '');
}

/**
 * Every pnpm run in a block of shell text, judged.
 *
 * @param {string} text
 * @returns {{ runs: { index: number, excerpt: string, findings: object[], judged: number, accepted: string[] }[] }}
 */
export function scanShellText(text) {
  const runs = [];
  for (const { index, text: logical } of logicalLines(text)) {
    for (const segment of cutShellComment(logical).split(BOUNDARY)) {
      const tokens = segment.split(/\s+/).filter(Boolean).map(stripDecoration);
      // Every `pnpm` token starts a run of its own: a wrapper's argument
      // (`stall-guard -- pnpm --silent test`) is a real invocation too.
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === 'pnpm') runs.push({ index, excerpt: segment.trim(), ...judgeRun(tokens.slice(i)) });
      }
    }
  }
  return { runs };
}

/* ──────────────────────────── JS / TS sources ─────────────────────────────── */

const QUOTES = new Set(["'", '"', '`']);
const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);

/** How far past a `pnpm` literal an argv list may run before it is abandoned. */
const ELEMENT_WALK_LIMIT = 4000;

/** @param {string} source  @returns {(offset: number) => number} 0-based line of an offset */
function lineIndexer(source) {
  const starts = [0];
  for (let k = 0; k < source.length; k++) if (source[k] === '\n') starts.push(k + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

/**
 * A literal's raw content, cooked just enough to be read as shell text: an
 * escaped newline or carriage return ends the command (it becomes ` ; `), an
 * escaped tab is a space, and any other escape is its character. A `\` before
 * a REAL newline -- a line continuation -- is kept, so every source newline
 * survives and `logicalLines` joins it.
 *
 * @param {string} raw
 */
function cookEscapes(raw) {
  return raw.replace(/\\([^\n])/g, (_, c) => (c === 'n' || c === 'r' ? ' ; ' : c === 't' ? ' ' : c));
}

/**
 * Every quoted string and template literal in a JS/TS source, comments
 * masked; regex literals skipped. In `text` each `${...}` keeps only its
 * delimiters -- one opaque `${}` word -- and its newlines, and escapes are
 * cooked without adding a newline, so a line index into `text` adds straight
 * onto the literal's opening line.
 *
 * @param {string} source
 * @param {ReturnType<typeof scanSource>} [scan]
 * @returns {{ open: number, close: number, text: string }[]} `open`/`close` are the delimiters' offsets
 */
export function jsLiterals(source, scan = scanSource(source)) {
  const { comment, literal, interpolation } = scan;
  const out = [];
  for (let k = 0; k < source.length; k++) {
    if (comment[k] || literal[k] || !QUOTES.has(source[k])) continue;
    let close = k + 1;
    let raw = '';
    while (close < source.length && literal[close]) {
      if (!interpolation[close] || source[close] === '\n') raw += source[close];
      close++;
    }
    out.push({ open: k, close, text: cookEscapes(raw) });
    k = close;
  }
  return out;
}

/** @returns {number} the next offset that is neither whitespace nor comment */
function skipBlank(source, comment, k) {
  while (k < source.length && (comment[k] || /\s/.test(source[k]))) k++;
  return k;
}

/**
 * Comma-separated elements from `from` up to the closer of the enclosing
 * bracket, or a `;`. An element that is exactly one string literal yields its
 * text, anything else OPAQUE; `array` marks an element that opens with `[`, so
 * the caller can descend into it.
 *
 * @returns {{ value: string, at: number, array: number | null }[]}
 */
function readElements(source, scan, literalsByOpen, from) {
  const { comment, literal } = scan;
  const elements = [];
  let start = from;
  const finish = (end) => {
    const s = skipBlank(source, comment, start);
    let e = end;
    while (e > s && (comment[e - 1] || /\s/.test(source[e - 1]))) e--;
    if (e <= s) return; // a trailing comma, or an empty list
    const lit = literalsByOpen.get(s);
    elements.push({
      value: lit !== undefined && lit.close === e - 1 ? lit.text : OPAQUE,
      at: s,
      array: source[s] === '[' ? s : null,
    });
  };
  let depth = 0;
  const limit = Math.min(source.length, from + ELEMENT_WALK_LIMIT);
  for (let k = from; k < limit; k++) {
    if (comment[k] || literal[k]) continue;
    const c = source[k];
    if (OPENERS.has(c)) {
      depth++;
    } else if (CLOSERS.has(c)) {
      if (depth === 0) {
        finish(k);
        return elements;
      }
      depth--;
    } else if (depth === 0 && c === ',') {
      finish(k);
      start = k + 1;
    } else if (depth === 0 && c === ';') {
      finish(k);
      return elements;
    }
  }
  finish(limit);
  return elements;
}

/**
 * The argv elements after a `pnpm` literal whose closing delimiter is at
 * `close` (the header's form 3), or null when no comma follows it.
 */
function argvAfter(source, scan, literalsByOpen, close) {
  const k = skipBlank(source, scan.comment, close + 1);
  if (source[k] !== ',') return null;
  const elements = readElements(source, scan, literalsByOpen, k + 1);
  if (elements.length > 0 && elements[0].array !== null) {
    return readElements(source, scan, literalsByOpen, elements[0].array + 1);
  }
  return elements;
}

/**
 * Every pnpm run in a JS/TS source: string-literal runs (form 2) and argv
 * arrays (form 3). Each finding of an argv run carries the line of its own
 * element, so a multi-line array points at the offending entry.
 *
 * @param {string} source
 */
export function scanJsSource(source) {
  const scan = scanSource(source);
  const literals = jsLiterals(source, scan);
  const byOpen = new Map(literals.map((l) => [l.open, l]));
  const lineOf = lineIndexer(source);
  const runs = [];
  for (const lit of literals) {
    if (lit.text === 'pnpm') {
      const elements = argvAfter(source, scan, byOpen, lit.close);
      if (elements === null) continue;
      const argv = ['pnpm', ...elements.map((e) => e.value)];
      const judged = judgeRun(argv);
      judged.findings = judged.findings.map((f) => ({
        ...f,
        index: lineOf(elements.find((e) => e.value === f.token)?.at ?? lit.open),
      }));
      runs.push({
        index: lineOf(lit.open),
        excerpt: argv.map((v) => (v === OPAQUE ? '<expr>' : v)).join(' '),
        form: 'argv',
        ...judged,
      });
      continue;
    }
    const base = lineOf(lit.open);
    for (const run of scanShellText(lit.text).runs) runs.push({ ...run, index: base + run.index, form: 'string' });
  }
  return { runs };
}

/* ─────────────────────────────── manifests ────────────────────────────────── */

/**
 * Every pnpm run in a `package.json`'s `scripts` values, each tagged with its
 * script name and the line its key sits on.
 *
 * @param {string} text
 * @returns {{ runs: object[], scripts: number, error?: string }}
 */
export function scanManifest(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { runs: [], scripts: 0, error: err.message };
  }
  const scripts = parsed && typeof parsed === 'object' ? parsed.scripts : null;
  if (!scripts || typeof scripts !== 'object') return { runs: [], scripts: 0 };
  const lines = text.split('\n');
  const block = Math.max(0, lines.findIndex((l) => /"scripts"\s*:/.test(l)));
  const runs = [];
  let count = 0;
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== 'string') continue;
    count++;
    const key = `${JSON.stringify(name)}:`;
    const at = lines.findIndex((l, i) => i >= block && l.includes(key));
    const index = at === -1 ? block : at;
    for (const run of scanShellText(body).runs) runs.push({ ...run, index, script: name, form: 'manifest' });
  }
  return { runs, scripts: count };
}

/* ──────────────────────────────── the sweep ───────────────────────────────── */

/**
 * How a tracked file is read: 'js', 'shell', 'manifest', or null for data and
 * prose that holds no invocation.
 *
 * @param {string} path repo-relative
 * @param {string} text
 */
export function kindOf(path, text) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base === 'package.json') return 'manifest';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot) : '';
  if (JS_EXTENSIONS.has(ext)) return 'js';
  if (SHELL_EXTENSIONS.has(ext)) return 'shell';
  if (ext === '') {
    const first = text.split('\n', 1)[0];
    if (/^#!.*\b(?:ba|da|k|z)?sh\b/.test(first)) return 'shell';
    if (/^#!.*\bnode\b/.test(first)) return 'js';
  }
  return null;
}

/** @returns {string[]} tracked paths matching the pathspecs, relative to `root` */
function gitLsFiles(root, pathspecs) {
  return execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter(Boolean);
}

/**
 * The gate over one work tree.
 *
 * @param {string} [root]
 * @param {{ ruleOwners?: readonly string[] }} [options]
 */
export function sweep(root = REPO_ROOT, options = {}) {
  const owners = new Set(options.ruleOwners ?? RULE_OWNING_FILES);
  const findings = [];
  const refusals = [];
  const judgedRuns = [];
  const census = {
    roots: {},
    read: { js: 0, shell: 0, manifest: 0 },
    unread: 0,
    missing: 0,
    manifestsWithScripts: 0,
    scripts: 0,
    runs: 0,
    argvRuns: 0,
    judged: 0,
    accepted: {},
  };

  let rootFiles;
  let manifests;
  try {
    rootFiles = ROOTS.map((r) => gitLsFiles(root, [r.pathspec]));
    manifests = gitLsFiles(root, [MANIFEST_PATHSPEC]);
  } catch (err) {
    const why = String(err.stderr || err.message).trim().split('\n')[0];
    refusals.push(`\`git ls-files\` failed in ${root} (${why}), so nothing was read.`);
    return { findings, refusals, census, judgedRuns };
  }
  ROOTS.forEach((r, i) => {
    census.roots[r.label] = rootFiles[i].length;
    if (rootFiles[i].length === 0) {
      refusals.push(
        `the declared root ${r.label} holds no tracked file. If it moved, point ROOTS in ` +
          `${SELF} at its new pathspec; an empty root would otherwise pass while reading nothing.`,
      );
    }
  });

  for (const path of [...new Set([...rootFiles.flat(), ...manifests])].sort()) {
    if (owners.has(path)) continue;
    let text;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      census.missing++; // tracked but absent from the working tree, or a gitlink
      continue;
    }
    const kind = kindOf(path, text);
    if (kind === null) {
      census.unread++;
      continue;
    }
    census.read[kind]++;
    let runs;
    if (kind === 'manifest') {
      const manifest = scanManifest(text);
      if (manifest.error) {
        refusals.push(`${path} is tracked but does not parse as JSON (${manifest.error}), so its scripts were not read.`);
        continue;
      }
      if (manifest.scripts > 0) census.manifestsWithScripts++;
      census.scripts += manifest.scripts;
      runs = manifest.runs;
    } else {
      runs = (kind === 'js' ? scanJsSource(text) : scanShellText(text)).runs;
    }
    for (const run of runs) {
      census.runs++;
      if (run.form === 'argv') census.argvRuns++;
      census.judged += run.judged;
      for (const name of run.accepted) census.accepted[name] = (census.accepted[name] ?? 0) + 1;
      if (run.judged > 0) judgedRuns.push({ path, line: run.index + 1, script: run.script, excerpt: run.excerpt });
      for (const f of run.findings) {
        findings.push({ path, line: (f.index ?? run.index) + 1, script: run.script, excerpt: run.excerpt, ...f });
      }
    }
  }

  if (census.manifestsWithScripts === 0) {
    refusals.push('no tracked package.json carries a `scripts` object, so the manifest half of the population is empty.');
  }
  if (census.runs === 0) {
    refusals.push(
      'the population yielded no pnpm run at all. A tree that runs pnpm everywhere cannot measure zero; ' +
        'the extraction is broken, and a green here would be a pass over nothing.',
    );
  }
  return { findings, refusals, census, judgedRuns };
}

/* ─────────────────────────────── reporting ────────────────────────────────── */

/** @param {{ path: string, line: number, script?: string }} f */
function where(f) {
  return `${f.path}:${f.line}${f.script === undefined ? '' : ` (scripts[${JSON.stringify(f.script)}])`}`;
}

function reportFindings(findings) {
  console.error(
    `\n✗ check-pnpm-flag-spellings: ${findings.length} pnpm flag spelling(s) that a global pnpm 11+/12 ` +
      '`@pnpm/exe` frontend rejects.\n\n' +
      findings
        .map((f) => `  • ${where(f)}\n      ${f.excerpt}\n      \`${f.token}\`: ${f.says}\n      fix: spell it \`${f.fix}\``)
        .join('\n\n') +
      '\n\n  The repo pins pnpm 10.31.0 and CI runs that binary through Corepack, so every spelling above\n' +
      '  passes CI. A contributor whose global pnpm is the newer `@pnpm/exe` frontend reaches 10.31\n' +
      '  through it, and the frontend parses the argv first: it exits 2 on these and the pinned pnpm\n' +
      '  never runs. Both versions accept the spelling each fix line names. Flags after a script name,\n' +
      `  a bin or a bare \`--\` are forwarded to that program and never judged; the rule is in the\n` +
      `  header of ${SELF}.\n`,
  );
}

function reportRefusals(refusals) {
  console.error(
    `\n✗ check-pnpm-flag-spellings: REFUSED -- ${refusals.length} reason(s) the population cannot be trusted:\n\n` +
      refusals.map((r) => `  • ${r}`).join('\n') +
      '\n\n  Nothing below this line was judged. Exit 2 rather than 0: a gate that cannot find its input\n' +
      '  and passes converts "nobody is looking" into "something looked and it was fine".\n',
  );
}

function printSuccess(census) {
  const roots = ROOTS.map((r) => `${r.label} ${census.roots[r.label]}`).join(' · ');
  const accepted = ACCEPTED.map(([name]) => `${name} ×${census.accepted[name] ?? 0}`).join(', ');
  const files = census.read.js + census.read.shell + census.read.manifest;
  console.log(
    `✓ check-pnpm-flag-spellings: no rejected pnpm flag spelling in ${files} tracked file(s).\n` +
      `  roots: ${roots}; read ${census.read.js} JS/TS, ${census.read.shell} shell, ` +
      `${census.read.manifest} package.json (${census.scripts} scripts); ` +
      `${census.unread} data/prose file(s) not read, ${census.missing} tracked path(s) absent.\n` +
      `  ${census.runs} pnpm run(s), ${census.argvRuns} of them argv arrays; ${census.judged} flag(s) in a ` +
      `pnpm option position, accepted spellings among them: ${accepted}.`,
  );
}

/* ──────────────────────────────── self-test ───────────────────────────────── */

// Set by `selfTest()` only after its verdict prints, and read at the dispatch:
// a `return` that leaves the function above that line prints nothing and still
// exits 0 -- a self-test that never finished, reported as one that passed.
let selfTestReachedVerdict = false;

const RED = 'RED — a rejected spelling in a pnpm option position';
const ACCEPTED_BATTERY = 'GREEN — an accepted spelling in the same position';
const FORWARDED = 'GREEN — a flag forwarded past the script, bin or run target';
const NOT_PNPM = 'GREEN — not a pnpm invocation';
const PROSE = 'GREEN — text the scan must not read (comments, regex literals)';
const TREE = 'TREE — the real sweep over a git work tree on disk';
const PIN = 'PIN — the declared constants';

// ── The self-test's own battery roster and floor ───────────────────────────
//
// Copied in shape from `scripts/check-agent-model-declared.mjs`, never
// imported. Every case names its battery and is registered against it as the
// FIRST statement of the driving loop body, before any branch that ends in
// `continue`, so the floor measures REACH. The roster is a LITERAL the cases
// are checked against -- a roster derived from the cases would delete a
// battery's floor together with its cases. The counts are floors, not
// equalities: a battery that grows must not red.
const SELF_TEST_BATTERIES = Object.freeze({
  [RED]: 19,
  [ACCEPTED_BATTERY]: 6,
  [FORWARDED]: 9,
  [NOT_PNPM]: 6,
  [PROSE]: 6,
  [TREE]: 13,
  [PIN]: 3,
});

// Deleting a battery from the roster silences its floor as surely as zeroing
// it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 7;

/** Findings of one source text, flattened, with 1-based lines. */
function findingsOf(kind, source) {
  const scanned = kind === 'js' ? scanJsSource(source) : kind === 'manifest' ? scanManifest(source) : scanShellText(source);
  return scanned.runs.flatMap((run) =>
    run.findings.map((f) => ({ ...f, line: (f.index ?? run.index) + 1, script: run.script })),
  );
}

const manifest = (scripts) => `${JSON.stringify({ name: 'fixture', private: true, scripts }, null, 2)}\n`;

/** The text cases: one source, one expected verdict, and what a red must name. */
const TEXT_CASES = [
  // ── RED ──
  { battery: RED, label: '`pnpm -s <script>` → --silent', kind: 'shell', source: 'pnpm -s check:generated', fix: '--silent' },
  { battery: RED, label: '`-s` after a value-taking `--filter <pkg>`', kind: 'shell', source: 'pnpm --filter @objectstack/spec -s build', fix: '--silent' },
  { battery: RED, label: '`-s` after `--filter=<pkg>`', kind: 'shell', source: 'pnpm --filter=@objectstack/spec -s build', fix: '--silent' },
  { battery: RED, label: '`-s` between `run` and its target', kind: 'shell', source: 'pnpm run -s build', fix: '--silent' },
  { battery: RED, label: '`--prod=false` on install → --config.production=false', kind: 'shell', source: 'pnpm install --frozen-lockfile --prefer-offline --prod=false', fix: '--config.production=false' },
  { battery: RED, label: '`--production=false` on install', kind: 'shell', source: 'pnpm install --production=false', fix: '--config.production=false' },
  { battery: RED, label: '`--no-production` on `pnpm i`', kind: 'shell', source: 'pnpm i --no-production', fix: '--config.production=false' },
  { battery: RED, label: '`--prod=true` after `-C <dir>` keeps its value', kind: 'shell', source: 'pnpm -C ../objectui install --prod=true', fix: '--config.production=true' },
  { battery: RED, label: 'a run after `&&`', kind: 'shell', source: 'cd "$BUILD_ROOT" && pnpm -s build', fix: '--silent' },
  { battery: RED, label: 'a run inside `$(...)`', kind: 'shell', source: 'OUT="$(pnpm -s list)"', fix: '--silent' },
  { battery: RED, label: 'a `\\`-continued install points at its first line', kind: 'shell', source: 'echo start\npnpm install \\\n  --frozen-lockfile \\\n  --prod=false\n', fix: '--config.production=false', line: 2 },
  { battery: RED, label: "a wrapper's pnpm is a run of its own", kind: 'shell', source: 'node scripts/run-with-stall-guard.mjs --stall-minutes 10 -- pnpm -s test', fix: '--silent' },
  { battery: RED, label: 'a quoted `#` is not a comment', kind: 'shell', source: 'echo "see # pnpm -s build"', fix: '--silent' },
  { battery: RED, label: 'JS template spawn (the shape #23777 removed)', kind: 'js', source: 'const out = execSync(`pnpm -s ${script}`, { cwd: pkgRoot });\n', fix: '--silent' },
  { battery: RED, label: 'JS string concatenation head', kind: 'js', source: "execSync('pnpm -s ' + script);\n", fix: '--silent' },
  { battery: RED, label: "JS argv array: spawnSync('pnpm', [..., '-s', ...])", kind: 'js', source: "spawnSync('pnpm', ['--filter', pkg, '-s', 'build'], { stdio: 'inherit' });\n", fix: '--silent' },
  { battery: RED, label: 'JS multi-line argv array names the offending element', kind: 'js', source: "const r = spawnSync('pnpm', [\n  '--filter',\n  pkg,\n  '-s',\n  'build',\n]);\n", fix: '--silent', line: 4 },
  { battery: RED, label: "JS tuple ['pnpm', 'install', '--no-production']", kind: 'js', source: "const cmd = ['pnpm', 'install', '--no-production'];\n", fix: '--config.production=false' },
  { battery: RED, label: 'a package.json script names its key', kind: 'manifest', source: manifest({ build: 'tsc', gen: 'pnpm -s build && tsc' }), fix: '--silent', script: 'gen', line: 6 },

  // ── GREEN: accepted spellings ──
  { battery: ACCEPTED_BATTERY, label: '--silent', kind: 'shell', source: 'pnpm --silent check:generated' },
  { battery: ACCEPTED_BATTERY, label: '--reporter=silent', kind: 'shell', source: 'pnpm --reporter=silent check:generated' },
  { battery: ACCEPTED_BATTERY, label: '--no-prod', kind: 'shell', source: 'pnpm install --frozen-lockfile --no-prod' },
  { battery: ACCEPTED_BATTERY, label: '--config.production=false', kind: 'shell', source: 'pnpm install --frozen-lockfile --config.production=false' },
  { battery: ACCEPTED_BATTERY, label: 'a bare boolean --prod', kind: 'shell', source: 'pnpm install --prod' },
  { battery: ACCEPTED_BATTERY, label: 'JS template spawn with --silent', kind: 'js', source: 'execSync(`pnpm --silent ${script}`);\n' },

  // ── GREEN: forwarded ──
  { battery: FORWARDED, label: 'after a script name', kind: 'shell', source: 'pnpm build -s' },
  { battery: FORWARDED, label: 'after `run <script>`', kind: 'shell', source: 'pnpm run build -s' },
  { battery: FORWARDED, label: 'after `exec <bin>`', kind: 'shell', source: 'pnpm --filter @objectstack/spec exec vitest run -s' },
  { battery: FORWARDED, label: 'after `dlx <pkg>`', kind: 'shell', source: 'pnpm dlx some-tool -s' },
  { battery: FORWARDED, label: 'after an implicit bin', kind: 'shell', source: 'pnpm turbo run build -s' },
  { battery: FORWARDED, label: 'after the `test` alias of `run test`', kind: 'shell', source: 'pnpm test -s' },
  { battery: FORWARDED, label: 'after a bare `--`', kind: 'shell', source: 'pnpm run gen -- -s' },
  { battery: FORWARDED, label: '`--prod=false` handed to a script', kind: 'shell', source: 'pnpm build --prod=false' },
  { battery: FORWARDED, label: 'JS argv array after `exec <bin>`', kind: 'js', source: "spawnSync('pnpm', ['exec', 'tsx', 'gen.ts', '-s']);\n" },

  // ── GREEN: not pnpm ──
  { battery: NOT_PNPM, label: 'git ls-files -s', kind: 'shell', source: 'git ls-files -s .githooks/pre-push' },
  { battery: NOT_PNPM, label: 'git show -s', kind: 'shell', source: 'git show -s --format=%cI HEAD' },
  { battery: NOT_PNPM, label: 'a git argv array', kind: 'js', source: "execFileSync('git', ['ls-files', '-s', path]);\n" },
  { battery: NOT_PNPM, label: 'npm -s (npm keeps its short flag)', kind: 'shell', source: 'npm -s run build' },
  { battery: NOT_PNPM, label: 'a launcher table beside an unrelated -s', kind: 'js', source: "const LAUNCHERS = new Set(['pnpm', 'npx']);\nrun('git', ['show', '-s']);\n" },
  { battery: NOT_PNPM, label: 'pnpm as a word in prose', kind: 'shell', source: 'echo "pnpm and git ls-files -s"' },

  // ── GREEN: text the scan must not read ──
  { battery: PROSE, label: 'a JS line comment', kind: 'js', source: '// pnpm -s check:x\nconst a = 1;\n' },
  { battery: PROSE, label: 'a JS block comment', kind: 'js', source: '/* pnpm install --prod=false */ const a = 1;\n' },
  { battery: PROSE, label: 'a JSDoc recording a historical measurement', kind: 'js', source: '/**\n * measured, `pnpm -s check:sdui-lockstep` exits 1\n */\nexport const x = 1;\n' },
  { battery: PROSE, label: 'a JS regex literal', kind: 'js', source: 'const r = /pnpm -s/;\n' },
  { battery: PROSE, label: 'a shell comment line', kind: 'shell', source: '# pnpm -s check:x\n' },
  { battery: PROSE, label: 'a trailing shell comment', kind: 'shell', source: 'echo ok # then pnpm -s check:x\n' },
];

/** A throwaway git work tree; returns its path. */
function fixtureTree({ plant = {}, untracked = {}, omit = [], git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pnpm-flag-spellings-'));
  const files = {
    'package.json': manifest({ build: 'pnpm --silent turbo run build' }),
    'scripts/ok.sh': '#!/usr/bin/env bash\nset -euo pipefail\npnpm --filter @objectstack/spec --silent build\n',
    'packages/foo/package.json': `${JSON.stringify({ name: 'foo', scripts: { test: 'vitest run' } }, null, 2)}\n`,
    'packages/foo/scripts/gen.mjs': "import { execSync } from 'node:child_process';\nexecSync('pnpm --silent gen');\n",
    '.githooks/pre-commit': '#!/bin/sh\nexec pnpm --silent check:hooks\n',
    'docs/notes.md': 'nothing to see\n',
  };
  for (const path of omit) delete files[path];
  Object.assign(files, plant);
  const write = (entries) => {
    for (const [path, text] of Object.entries(entries)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  };
  write(files);
  if (git) {
    const quiet = { cwd: dir, stdio: 'ignore' };
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], quiet);
    execFileSync('git', ['add', '-A'], quiet);
  }
  write(untracked);
  return dir;
}

const PLANT = '#!/usr/bin/env bash\nset -euo pipefail\npnpm -s check:planted\n';

/** Each returns null when the case holds, or what went wrong. */
const one = (path, line) => (r) => {
  if (r.refusals.length > 0) return `refused: ${r.refusals.join(' | ')}`;
  if (r.findings.length !== 1) return `expected exactly 1 finding, got ${r.findings.length}`;
  const f = r.findings[0];
  return f.path === path && (line === undefined || f.line === line) ? null : `finding at ${where(f)}, expected ${path}${line ? `:${line}` : ''}`;
};
const clean = (r) =>
  r.refusals.length > 0 ? `refused: ${r.refusals.join(' | ')}` : r.findings.length > 0 ? `${r.findings.length} finding(s): ${r.findings.map(where).join(', ')}` : null;
const refused = (pattern) => (r) =>
  r.refusals.some((x) => pattern.test(x)) ? null : `expected a refusal matching /${pattern.source}/, got ${JSON.stringify(r.refusals)}`;

const TREE_CASES = [
  {
    label: 'a clean tree → green, every root and both halves counted',
    tree: {},
    check: (r) =>
      clean(r) ??
      (ROOTS.every((x) => r.census.roots[x.label] > 0) && r.census.runs === 4 && r.census.manifestsWithScripts === 2
        ? null
        : `census does not describe the fixture: ${JSON.stringify(r.census)}`),
  },
  { label: 'a planted `pnpm -s` in a tracked scripts/ shell file → red at its line', tree: { plant: { 'scripts/plant.sh': PLANT } }, check: one('scripts/plant.sh', 3) },
  { label: 'a planted package.json script → red naming the manifest', tree: { plant: { 'package.json': manifest({ build: 'pnpm --silent build', plant: 'pnpm -s check:x' }) } }, check: one('package.json') },
  { label: 'a planted JS spawn under packages/*/scripts/ → red', tree: { plant: { 'packages/foo/scripts/gen.mjs': "execSync('pnpm --filter @objectstack/spec -s gen');\n" } }, check: one('packages/foo/scripts/gen.mjs', 1) },
  { label: 'a planted spelling in an extension-less git hook → red', tree: { plant: { '.githooks/pre-commit': '#!/bin/sh\nexec pnpm install --prod=false\n' } }, check: one('.githooks/pre-commit', 2) },
  { label: 'the same plant UNTRACKED → green (only tracked files are read)', tree: { untracked: { 'scripts/plant.sh': PLANT } }, check: clean },
  { label: 'the same plant tracked OUTSIDE every root → green', tree: { plant: { 'docs/plant.sh': PLANT } }, check: clean },
  { label: 'the same plant in the rule-owning file → green (its fixtures spell the rule)', tree: { plant: { [SELF]: `execSync('pnpm -s x');\n` } }, check: clean },
  { label: 'a declared root with no tracked file → REFUSED', tree: { omit: ['.githooks/pre-commit'] }, check: refused(/\.githooks\/ holds no tracked file/) },
  {
    label: 'a population with no pnpm run at all → REFUSED',
    tree: { plant: { 'package.json': manifest({ build: 'tsc' }), 'scripts/ok.sh': 'echo\n', 'packages/foo/scripts/gen.mjs': 'export {};\n', '.githooks/pre-commit': '#!/bin/sh\nexit 0\n' } },
    check: refused(/no pnpm run at all/),
  },
  { label: 'a tracked package.json that does not parse → REFUSED', tree: { plant: { 'packages/foo/package.json': '{ "name": \n' } }, check: refused(/does not parse as JSON/) },
  { label: 'not a git work tree → REFUSED, never an empty pass', tree: { git: false }, ceiling: true, check: refused(/git ls-files` failed/) },
  {
    label: 'the real tree: every root holds files and yields runs',
    real: true,
    check: (r) =>
      r.refusals.length === 0 && ROOTS.every((x) => r.census.roots[x.label] > 0) && r.census.runs > 0 && r.census.argvRuns > 0
        ? null
        : `real-tree census: ${JSON.stringify({ refusals: r.refusals, census: r.census })}`,
  },
];

const PIN_CASES = [
  { label: 'RULE_OWNING_FILES is exactly this one file', check: () => (RULE_OWNING_FILES.length === 1 && RULE_OWNING_FILES[0] === SELF ? null : JSON.stringify(RULE_OWNING_FILES)) },
  {
    label: 'ROOTS are the three declared roots',
    check: () => {
      const labels = ROOTS.map((r) => r.label).join(' ');
      return labels === 'scripts/ packages/**/scripts/ .githooks/' ? null : labels;
    },
  },
  {
    label: 'no fix line names a spelling this gate rejects',
    check: () => {
      const bad = ['-s', '--prod=false', '--production=false', '--prod=true', '--no-production']
        .map((t) => REJECTED.find((r) => r.matches(t)).fix(t))
        .filter((fix) => REJECTED.some((r) => r.matches(fix)));
      return bad.length === 0 ? null : `fixes rejected by the gate itself: ${bad.join(', ')}`;
    },
  },
];

function selfTest() {
  const cases = [
    ...TEXT_CASES.map((c) => ({ ...c, run: 'text' })),
    ...TREE_CASES.map((c) => ({ ...c, battery: TREE, run: 'tree' })),
    ...PIN_CASES.map((c) => ({ ...c, battery: PIN, run: 'pin' })),
  ];

  const batterySeen = new Map();
  const registerCase = (battery) => batterySeen.set(battery, (batterySeen.get(battery) ?? 0) + 1);

  let failed = 0;
  let heading = null;
  const fail = (c, why) => {
    failed += 1;
    console.error(`    ✗ ${c.label}\n        ${why}`);
  };

  for (const c of cases) {
    registerCase(c.battery);
    if (c.battery !== heading) {
      heading = c.battery;
      console.log(`  ${heading}`);
    }
    let problem = null;
    try {
      if (c.run === 'text') {
        const found = findingsOf(c.kind, c.source);
        const wantRed = c.battery === RED;
        if (found.length > 0 !== wantRed) {
          problem = `expected ${wantRed ? 'red' : 'green'}, got ${found.length} finding(s)` +
            (found.length > 0 ? `: ${found.map((f) => `${f.token} (line ${f.line})`).join(', ')}` : '');
        } else if (wantRed && found[0].fix !== c.fix) {
          problem = `red, but the fix reads \`${found[0].fix}\`, expected \`${c.fix}\``;
        } else if (wantRed && c.line !== undefined && found[0].line !== c.line) {
          problem = `red, but at line ${found[0].line}, expected line ${c.line}`;
        } else if (wantRed && c.script !== undefined && found[0].script !== c.script) {
          problem = `red, but names script ${JSON.stringify(found[0].script)}, expected ${JSON.stringify(c.script)}`;
        }
      } else if (c.run === 'tree') {
        if (c.real) {
          problem = c.check(sweep(REPO_ROOT));
        } else {
          const dir = fixtureTree(c.tree);
          const ceiling = process.env.GIT_CEILING_DIRECTORIES;
          if (c.ceiling) process.env.GIT_CEILING_DIRECTORIES = dirname(dir);
          try {
            problem = c.check(sweep(dir));
          } finally {
            if (c.ceiling) {
              if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
              else process.env.GIT_CEILING_DIRECTORIES = ceiling;
            }
            rmSync(dir, { recursive: true, force: true });
          }
        }
      } else {
        problem = c.check();
      }
    } catch (err) {
      problem = `threw: ${err.stack || err.message}`;
    }
    if (problem) {
      fail(c, problem);
      continue;
    }
    console.log(`    ✓ ${c.label}`);
  }

  // ── The floor: every declared battery RAN its cases ─────────────────────
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — ` +
        'a battery deleted from the roster takes its own floor with it.',
    );
  }
  const labels = cases.map((c) => `${c.battery} / ${c.label}`);
  const duplicated = [...new Set(labels.filter((name, i) => labels.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    floorBreached = true;
    floorFailure(`case label(s) used twice in one battery: ${duplicated.map((n) => JSON.stringify(n)).join(', ')}.`);
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    floorBreached = true;
    floorFailure(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery below its floor means cases STOPPED RUNNING — find what stopped registering (a deleted case, ' +
        'a renamed battery, a loop that no longer reaches it) and restore it.',
    );
  }

  if (failed > 0) {
    console.error(`\n✗ check-pnpm-flag-spellings self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(EXIT_VIOLATIONS);
  }
  console.log(`\n✓ check-pnpm-flag-spellings self-test: ${cases.length} cases across ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
}

/* ───────────────────────────────── dispatch ───────────────────────────────── */

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--self-test' && a !== '--list');
  if (unknown.length > 0) {
    console.error(`usage: node ${SELF} [--list | --self-test]   (unknown: ${unknown.join(' ')})`);
    process.exit(EXIT_REFUSED);
  }
  if (args.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-pnpm-flag-spellings self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
          'finished as a self-test that passed.\n',
      );
      process.exit(EXIT_VIOLATIONS);
    }
    return;
  }

  const { findings, refusals, census, judgedRuns } = sweep();
  if (args.includes('--list')) {
    for (const run of judgedRuns) console.log(`${where(run)}  ${run.excerpt}`);
    console.log('');
  }
  if (findings.length > 0) reportFindings(findings);
  if (refusals.length > 0) {
    reportRefusals(refusals);
    process.exit(EXIT_REFUSED);
  }
  if (findings.length > 0) process.exit(EXIT_VIOLATIONS);
  printSuccess(census);
}

if (isEntrypoint(import.meta.url)) {
  main();
}
