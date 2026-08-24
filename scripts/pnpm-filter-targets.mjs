#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * pnpm-filter-targets (#10853) -- the ONE place that answers "does this
 * `--filter` selector name anything in this workspace?".
 *
 *   node scripts/pnpm-filter-targets.mjs --list
 *   node scripts/pnpm-filter-targets.mjs --preflight '<a shell command>'
 *   node scripts/pnpm-filter-targets.mjs --self-test
 *
 * ## The defect
 *
 * `pnpm --filter <name>` EXITS 0 when the filter matches no project. Measured
 * on this tree, and re-measured when this module was written:
 *
 *     $ pnpm --filter @objectstack/definitely-not-a-package test; echo $?
 *     No projects matched the filters in "/home/user/objectstack"
 *     0
 *
 * Exit 0 is the whole problem, not the typo. Every discipline this repo uses to
 * make a test run trustworthy is defeated by it: `cmd > log 2>&1; ec=$?` -- the
 * rule that exists because a pipe swallows the exit code -- faithfully captures
 * 0, and a report saying "suite green, exit 0" is then TRUE AND WORTHLESS,
 * because nothing ran. The instance that surfaced it: a dispatch briefing
 * spelled `@objectstack/adapter-hono`, which is the name a reader guesses from
 * the directory `packages/adapters/hono`; the real name is `@objectstack/hono`.
 * The dev checked whether the filter had matched, on its own initiative, and
 * caught what it called "a silent green that would have made an entire
 * verification round fictitious".
 *
 * Same shape as the sibling trap already on the books -- never write `--` when
 * passing args to vitest through pnpm, because `cac` silently discards
 * everything after it. Both end at: exit 0, nothing measured, output that reads
 * like success. This repo's recurring defect class (#4690), sitting underneath
 * the very command agents use to PROVE results.
 *
 * ## Why this is one module and not two matchers
 *
 * Two consumers ask the same question and must not answer it differently:
 * `scripts/check-pnpm-filter-targets.mjs` (the committed population) and
 * `scripts/pm/os-verify-lock.sh` (the ad-hoc population, via `--preflight`).
 * A second recogniser of the same rule is a divergence source -- the reason
 * `check-ci-filter-parity.mjs` refused to grow one.
 *
 * ## The matching rule, MEASURED against real pnpm rather than assumed
 *
 * pnpm matches a bare pattern against the package NAME, in full or with the
 * scope stripped -- and NOT against the directory. All four measured on this
 * tree with `pnpm --filter <sel> ls --depth -1 --json` (pnpm 10.31.0):
 *
 *     hono            -> 1  (@objectstack/hono, in packages/adapters/hono)
 *     @objectstack/hono -> 1
 *     app-todo        -> 0  (the DIRECTORY examples/app-todo -- not a match)
 *     example-todo    -> 1  (the unscoped NAME of @objectstack/example-todo)
 *
 * The `app-todo` row is the one that makes the rule non-obvious, and a matcher
 * written from the directory intuition would have reported a live selector as
 * dead. It is pinned in `--self-test`.
 *
 * ## What this module REFUSES to judge, and why that is the design
 *
 * A wrong red here is worse than a miss: it would make the guard the thing that
 * blocks a correct run. So a selector is judged ONLY when the answer cannot be
 * argued with -- a plain name, no metacharacters. Everything else is returned
 * as `unjudged` WITH a reason, and the reason is reported, so an unjudged
 * population is visible rather than silent:
 *
 *   - GLOBS (`@objectstack/*`, `./packages/*`) -- deciding these needs a
 *     picomatch-compatible matcher, i.e. a THIRD recogniser with its own
 *     divergence risk. `check-ci-filter-parity.mjs` rejected exactly that trade
 *     for exactly this reason; this module makes the same call.
 *   - PATH selectors (`./pkg`, `{pkg}`) -- a directory, not a name.
 *   - SINCE-REF selectors (`[origin/main]`) -- the answer depends on git state,
 *     which is not a property of the spelling.
 *   - INTERPOLATION and prose placeholders (`${pkg}`, `<pkg>`) -- the spelling
 *     is not the value.
 *
 * Dependency suffixes and the exclusion prefix are STRIPPED, not refused:
 * `...pkg`, `pkg...`, `pkg^...`, `...^pkg` and `!pkg` all carry a plain name
 * that is exactly as checkable as a bare one, and `@objectstack/adapter-hono...`
 * is the same typo wearing a suffix.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import {
  WORKSPACE_FILE,
  WorkspaceEnumerationError,
  parseWorkspaceGlobs,
  selfTest as workspaceEnumeratorSelfTest,
  workspacePackageDirs,
} from './workspace-enumerator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Scopes whose packages live in a DIFFERENT repository's workspace, so a
 * zero-match here is correct rather than a defect.
 *
 * Declared, never inferred: a new foreign scope has to be added here
 * deliberately, which is the difference between a documented exemption and a
 * silent hole. `scripts/build-console.sh` runs its `@object-ui/console` filters
 * inside `$BUILD_ROOT` -- a checkout of `objectstack-ai/objectui` at the SHA
 * pinned in `.objectui-sha` -- never against this workspace, so resolving those
 * against this tree would be asking the wrong root.
 */
export const FOREIGN_SCOPES = [
  {
    scope: '@object-ui/',
    reason:
      'the objectui repo (objectstack-ai/objectui); scripts/build-console.sh and '
      + 'scripts/gen-sdui-manifest.sh run these filters inside that checkout, not this workspace',
  },
];

/**
 * Metacharacters that make a selector a PATTERN rather than a name.
 *
 * ⚠️ `@`, `!` and `+` are NOT metacharacters on their own here, and treating
 * them as such is a bug this self-test caught: `@` opens every scoped package
 * name in this workspace, so a naive class would have refused a verdict on
 * `@objectstack/spec` and on every other real selector -- the guard would then
 * be silent on exactly the population it exists for. In picomatch they are
 * extglob operators only when they PREFIX a group, hence the second alternative.
 */
const GLOB_CHARS = /[*?[\]]|[!?*+@]\(/;
/** The extglob operators, recognised only where picomatch treats them as such. */
const EXTGLOB = /[!?*+@]\(/;
const GLOB_REASON = 'a glob pattern: deciding it needs a picomatch-compatible matcher, i.e. a second recogniser';
/** Interpolation and prose placeholders: the spelling is not the value. */
const NOT_A_LITERAL = /[$`{}<>]/;

// -- the workspace ------------------------------------------------------------

/**
 * The nearest ancestor of `startDir` holding a `pnpm-workspace.yaml`.
 *
 * Resolution is from the CALLER'S directory on purpose. `--preflight` judges a
 * command that is about to run in the caller's cwd, which in this repo is
 * routinely a per-task worktree rather than the shared checkout, and the
 * workspace that matters is the one pnpm will read.
 *
 * @param {string} startDir
 * @returns {string|null}
 */
export function findWorkspaceRoot(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The `packages:` globs of a pnpm-workspace.yaml.
 *
 * Delegates to `scripts/workspace-enumerator.mjs` (#11510), this repo's one
 * parse of that block. Kept as an export because this module's `--self-test`
 * pins it and `os-verify-lock.sh --preflight` reaches the workspace through
 * here; the enumerator has no dependencies either, which is the property that
 * matters on the preflight path (it runs in trees whose `node_modules` is
 * absent or half-installed).
 *
 * @param {string} text
 * @returns {string[]}
 */
export function workspacePatterns(text) {
  return parseWorkspaceGlobs(text);
}

/**
 * Every package name this workspace declares.
 *
 * Membership comes from `scripts/workspace-enumerator.mjs` (#11510), this
 * repo's one parse and expansion of the `packages:` block.
 *
 * ## Why an unreadable workspace is ALLOWED here and refused everywhere else
 *
 * The enumerator refuses a workspace file it cannot read an answer out of —
 * an absent `packages:` key, an empty one, a glob shape it does not expand —
 * because for the gates that enumerate the workspace a silent empty list is a
 * clean run over nothing.
 *
 * This caller is the exception, and deliberately: `os-verify-lock.sh
 * --preflight` runs it ahead of EVERY verification command, and its job is to
 * judge whether a `--filter` selector names a real package. "I could not read
 * the workspace" is not a finding about the selector — turning it into a
 * refusal would block verification across the repo on a malformed file this
 * module does not own. So an unreadable workspace lands in the same bucket as
 * an absent one, which is the bucket this function already had, and the
 * callers' `names.length === 0` guard turns it into `allow`. Made explicit
 * here rather than left to a parser that happened to return `[]`.
 *
 * @param {string} root workspace root
 * @returns {{ names: string[], dirs: string[] }}
 */
export function listWorkspacePackages(root) {
  if (!existsSync(join(root, WORKSPACE_FILE))) return { names: [], dirs: [] };
  let memberDirs;
  try {
    memberDirs = workspacePackageDirs(root);
  } catch (err) {
    if (err instanceof WorkspaceEnumerationError) return { names: [], dirs: [] };
    throw err;
  }
  const names = [];
  const dirs = [];
  for (const rel of memberDirs) {
    const dir = join(root, rel);
    try {
      const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (typeof parsed.name === 'string' && parsed.name) {
        names.push(parsed.name);
        dirs.push(dir);
      }
    } catch {
      /* an unparseable manifest is not this module's finding */
    }
  }
  return { names: [...new Set(names)].sort(), dirs };
}

// -- the selector -------------------------------------------------------------

/**
 * @typedef {{ raw: string, kind: string, name: string|null, judgeable: boolean, reason: string }} Selector
 */

/**
 * Classify one `--filter` value.
 *
 * @param {string} raw
 * @returns {Selector}
 */
export function classifySelector(raw) {
  const original = String(raw);
  const un = (kind, reason) => ({ raw: original, kind, name: null, judgeable: false, reason });
  let s = original.trim();
  if (s === '') return un('empty', 'no selector');
  if (NOT_A_LITERAL.test(s)) {
    return un('interpolated', 'carries an interpolation or a prose placeholder, so the spelling is not the value');
  }
  // Extglob is tested BEFORE anything is stripped, so `!(docs)` stays a pattern
  // while `!@objectstack/docs` goes on to be an excluded NAME.
  if (EXTGLOB.test(s)) return un('glob', GLOB_REASON);

  // Exclusion is a prefix on an otherwise ordinary selector.
  let excluded = false;
  if (s.startsWith('!')) {
    excluded = true;
    s = s.slice(1);
  }
  // Dependency selectors are stripped FIRST, before the path test -- `...pkg`
  // begins with a dot and would otherwise read as a relative path. That
  // ordering bug made every `...pkg` selector unjudged, which is a silent hole
  // rather than a wrong answer, so only a self-test could have found it.
  s = s.replace(/^\.\.\.\^?/, '').replace(/\^?\.\.\.$/, '');
  if (s === '') return un('dependency-only', 'a dependency selector with no package name');

  if (s.includes('[') || s.includes(']')) {
    return un('since-ref', 'a since-ref selector: the answer depends on git state, not on the spelling');
  }
  if (s.startsWith('.') || s.startsWith('/')) {
    return un('path', 'a path selector: it names a directory, not a package');
  }
  if (GLOB_CHARS.test(s)) return un('glob', GLOB_REASON);

  for (const foreign of FOREIGN_SCOPES) {
    if (s.startsWith(foreign.scope)) {
      return {
        raw: original,
        kind: 'foreign',
        name: s,
        judgeable: false,
        reason: `names a package in ${foreign.reason}`,
      };
    }
  }
  return {
    raw: original,
    kind: excluded ? 'name-excluded' : 'name',
    name: s,
    judgeable: true,
    reason: '',
  };
}

/** The name with any scope removed: `@objectstack/hono` -> `hono`. */
export function unscoped(name) {
  return name.startsWith('@') && name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;
}

/**
 * How many workspace packages a plain-name pattern matches, by pnpm's rule.
 *
 * @param {string} pattern
 * @param {string[]} names
 * @returns {string[]} the matched names
 */
export function matchName(pattern, names) {
  const scoped = pattern.startsWith('@');
  return names.filter((name) => name === pattern || (!scoped && unscoped(name) === pattern));
}

/**
 * @typedef {{ verdict: 'matches'|'zero'|'unjudged', selector: Selector, matched: string[], suggestion: string|null }} Judgement
 */

/**
 * Judge one selector against a workspace.
 *
 * @param {string} raw
 * @param {string[]} names
 * @returns {Judgement}
 */
export function judgeSelector(raw, names) {
  const selector = classifySelector(raw);
  if (!selector.judgeable) return { verdict: 'unjudged', selector, matched: [], suggestion: null };
  const matched = matchName(selector.name, names);
  if (matched.length > 0) return { verdict: 'matches', selector, matched, suggestion: null };
  return { verdict: 'zero', selector, matched: [], suggestion: nearest(selector.name, names) };
}

/**
 * The likeliest intended name, or null. Cheap and deliberately conservative: an
 * unscoped-tail hit first (`@objectstack/adapter-hono` -> the name whose tail is
 * closest), then a single containment hit.
 *
 * @param {string} pattern
 * @param {string[]} names
 * @returns {string|null}
 */
export function nearest(pattern, names) {
  const tail = unscoped(pattern);
  const exactTail = names.filter((n) => unscoped(n) === tail);
  if (exactTail.length === 1) return exactTail[0];
  const parts = tail.split('-').filter(Boolean);
  const contains = names.filter((n) => {
    const t = unscoped(n);
    return parts.length > 0 && parts.every((p) => t.includes(p));
  });
  if (contains.length === 1) return contains[0];
  const suffix = names.filter((n) => {
    const t = unscoped(n);
    return parts.length > 1 && (t === parts[parts.length - 1] || t.endsWith(`-${parts[parts.length - 1]}`));
  });
  if (suffix.length === 1) return suffix[0];
  return null;
}

// -- extraction ---------------------------------------------------------------

/**
 * Command separators. A `--filter` belongs to the command word that PRECEDES
 * it on its own logical line, so the prefix is cut at the last separator before
 * the match.
 */
const SEPARATORS = /[;&|(`]/;

/**
 * Does this prefix mean the `--filter` after it is pnpm's (or turbo's)?
 *
 * ⚠️ This discrimination is not decoration -- without it the sweep reports
 * `git fetch --unshallow --filter=blob:none` (a git PARTIAL-CLONE filter,
 * spelled in this repo) and the prose fragment "its full --filter invocation"
 * as dead packages. Both were measured on this tree the first time the gate ran.
 *
 * Only the segment after the LAST separator counts, so `pnpm build && git fetch
 * --filter=blob:none` does not inherit the `pnpm` from the other command.
 *
 * @param {string} prefix everything before `--filter` on its logical line
 * @returns {boolean}
 */
export function isPnpmFilter(prefix) {
  const parts = String(prefix).split(SEPARATORS);
  const segment = parts[parts.length - 1];
  // The command word may be quoted, or reached by path: `"pnpm --filter ...` in
  // a package.json script and `'pnpm --filter ...'` in a JS string are both real
  // commands. So the boundary is "not a word/name character" rather than a
  // whitelist of separators -- which still rejects `my-pnpm` and `@scope/pnpm`.
  return /(^|[^\w@.-])(pnpm|turbo)(\s|$)/.test(segment);
}

/**
 * Every pnpm/turbo `--filter` value in a blob of text, with 1-based line numbers.
 *
 * Both spellings (`--filter x`, `--filter=x`) and all three quotings. The bare
 * form stops at whitespace and at the shell metacharacters that end a word, so
 * `--filter=@object-ui/console^...}` from a `${VAR:-default}` expansion yields
 * the selector without the brace that closed the expansion.
 *
 * Backslash continuations are folded before matching, and the reported line is
 * the FIRST line of the folded command -- a `pnpm \` whose `--filter` sits on
 * the next physical line is one command, and would otherwise be missed.
 *
 * @param {string} text
 * @returns {Array<{ value: string, line: number }>}
 */
export function extractFilters(text) {
  const out = [];
  const re = /--filter(?:=|\s+)(?:'([^']*)'|"([^"]*)"|([^\s'"`;|&)}]+))/g;
  /** @type {Array<{ text: string, line: number }>} */
  const logical = [];
  let accumulated = '';
  let startLine = 1;
  String(text)
    .split('\n')
    .forEach((raw, i) => {
      if (accumulated === '') startLine = i + 1;
      accumulated += raw;
      if (/\\$/.test(raw)) {
        accumulated = `${accumulated.slice(0, -1)} `;
        return;
      }
      logical.push({ text: accumulated, line: startLine });
      accumulated = '';
    });
  if (accumulated !== '') logical.push({ text: accumulated, line: startLine });

  for (const { text: line, line: lineNumber } of logical) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (!isPnpmFilter(line.slice(0, m.index))) continue;
      out.push({ value: m[1] ?? m[2] ?? m[3] ?? '', line: lineNumber });
    }
  }
  return out;
}

// -- the ad-hoc population: one command, about to run -------------------------

/**
 * @typedef {{ decision: 'allow'|'refuse', reason: string, findings: Judgement[], judged: number }} Preflight
 */

/**
 * Judge a shell command that is ABOUT TO RUN in `cwd`.
 *
 * FAIL-OPEN by construction, and that is not timidity: this runs in front of
 * every heavy verification in the container, so a wrong refusal would block
 * correct work, while a miss leaves today's behaviour exactly as it is. It
 * refuses only when the command is unambiguously a pnpm/turbo invocation in
 * THIS workspace naming a package that does not exist.
 *
 * The `cd` bail-out is the load-bearing one: a command that changes directory
 * may be filtering against another root entirely (`scripts/build-console.sh`
 * does exactly that, in the objectui checkout), and this function has no way to
 * know which. Unknown root, no verdict.
 *
 * @param {string} command
 * @param {string} cwd
 * @returns {Preflight}
 */
export function preflightCommand(command, cwd) {
  const text = String(command);
  const allow = (reason) => ({ decision: 'allow', reason, findings: [], judged: 0 });
  if (/(^|[\s;&|(])(cd|pushd|popd)(\s|$)/.test(text)) {
    return allow('the command changes directory, so the workspace it filters against is not this one');
  }
  const root = findWorkspaceRoot(cwd);
  if (!root) return allow('no pnpm-workspace.yaml above the working directory');
  const { names } = listWorkspacePackages(root);
  if (names.length === 0) return allow('the workspace declares no packages, so there is nothing to resolve against');

  const findings = [];
  let judged = 0;
  for (const { value } of extractFilters(text)) {
    const judgement = judgeSelector(value, names);
    if (judgement.verdict === 'unjudged') continue;
    judged++;
    if (judgement.verdict === 'zero') findings.push(judgement);
  }
  if (findings.length > 0) {
    return { decision: 'refuse', reason: 'a filter matches no project in this workspace', findings, judged };
  }
  return { decision: 'allow', reason: judged > 0 ? `${judged} filter(s) resolved` : 'no judgeable filter', findings: [], judged };
}

/**
 * The refusal text `os-verify-lock.sh` prints. Built here rather than in shell
 * so the wording lives next to the rule it explains.
 *
 * @param {Preflight} result
 * @returns {string}
 */
export function refusalMessage(result) {
  const lines = [];
  for (const finding of result.findings) {
    const { selector, suggestion } = finding;
    lines.push(`--filter ${selector.raw} matches NO project in this workspace.`);
    if (suggestion) lines.push(`  did you mean \`${suggestion}\`?`);
  }
  lines.push('pnpm exits 0 on a filter that matched nothing, so this run would have');
  lines.push('printed success and measured NOTHING (#10853). Refused before the lock,');
  lines.push('because a green exit code from a run that never happened is worse than no run.');
  lines.push('Deliberate? Set OS_VERIFY_LOCK_NO_FILTER_CHECK=1 for this call.');
  return lines.join('\n');
}

// -- CLI ----------------------------------------------------------------------

/** Exit code meaning "a filter is confidently dead"; anything else is allow. */
export const EXIT_REFUSE = 3;

function cliList() {
  const root = findWorkspaceRoot(process.cwd());
  if (!root) {
    console.error('pnpm-filter-targets: no pnpm-workspace.yaml above the working directory.');
    return 1;
  }
  const { names } = listWorkspacePackages(root);
  console.log(`${names.length} workspace package(s) in ${root}:`);
  for (const name of names) console.log(`  ${name}`);
  return 0;
}

function cliPreflight(command) {
  const result = preflightCommand(command, process.cwd());
  if (result.decision === 'refuse') {
    process.stdout.write(`${refusalMessage(result)}\n`);
    return EXIT_REFUSE;
  }
  return 0;
}

export async function selfTest() {
  const failures = [];
  let checked = 0;
  const ok = (description, condition) => {
    checked++;
    if (!condition) failures.push(description);
  };

  const root = findWorkspaceRoot(HERE);
  ok('the workspace root is found from this file', root !== null);
  const { names } = listWorkspacePackages(root ?? HERE);
  ok(`the workspace lists packages (found ${names.length})`, names.length > 50);
  ok('and the list holds the package the card is about', names.includes('@objectstack/hono'));

  // ---- the matching rule, exactly as measured against real pnpm ------------
  ok('a full scoped name matches', matchName('@objectstack/hono', names).length === 1);
  ok('the UNSCOPED name matches too -- pnpm strips the scope', matchName('hono', names).length === 1);
  ok(
    'a DIRECTORY name does NOT match: examples/app-todo is @objectstack/example-todo',
    matchName('app-todo', names).length === 0 && matchName('example-todo', names).length === 1,
  );
  ok('the card\'s guessed-from-the-path name matches nothing', matchName('@objectstack/adapter-hono', names).length === 0);

  // ---- the negative control: the card's own reproduction -------------------
  const dead = judgeSelector('@objectstack/adapter-hono', names);
  ok('NEGATIVE CONTROL: the card\'s bad name is judged zero', dead.verdict === 'zero');
  ok('and the judgement suggests the real package', dead.suggestion === '@objectstack/hono');
  const alive = judgeSelector('@objectstack/hono', names);
  ok('POSITIVE CONTROL: the real name is judged matching', alive.verdict === 'matches');

  // ---- what is refused a verdict, one case per reason ----------------------
  const unjudged = [
    ['@objectstack/*', 'glob'],
    ['./packages/*', 'path'],
    ['{packages/spec}', 'interpolated'],
    ['${pkg}', 'interpolated'],
    ['<pkg>', 'interpolated'],
    ['[origin/main]', 'since-ref'],
    ['@objectstack/spec[origin/main]', 'since-ref'],
    ['@object-ui/console', 'foreign'],
    ['', 'empty'],
  ];
  for (const [raw, kind] of unjudged) {
    const judged = judgeSelector(raw, names);
    ok(`\`${raw}\` is unjudged, as kind ${kind}`, judged.verdict === 'unjudged' && judged.selector.kind === kind);
  }
  ok(
    'every unjudged selector carries a REASON, so an unjudged population is visible',
    unjudged.every(([raw]) => judgeSelector(raw, names).selector.reason !== ''),
  );

  // ---- dependency selectors are stripped and judged, not waved through -----
  for (const suffixed of ['...@objectstack/hono', '@objectstack/hono...', '@objectstack/hono^...', '...^@objectstack/hono']) {
    ok(`\`${suffixed}\` is judged, and matches`, judgeSelector(suffixed, names).verdict === 'matches');
  }
  for (const suffixed of ['...@objectstack/adapter-hono', '@objectstack/adapter-hono...', '@objectstack/adapter-hono^...']) {
    ok(`\`${suffixed}\` is the same typo wearing a suffix, and is judged zero`, judgeSelector(suffixed, names).verdict === 'zero');
  }
  ok('`!@objectstack/hono` (exclusion) is judged and matches', judgeSelector('!@objectstack/hono', names).verdict === 'matches');
  ok('`!@objectstack/adapter-hono` is judged zero', judgeSelector('!@objectstack/adapter-hono', names).verdict === 'zero');

  // ---- extraction ---------------------------------------------------------
  const extracted = extractFilters(
    [
      'pnpm --filter @objectstack/spec test',
      'pnpm --filter=@objectstack/core build',
      "pnpm --filter '@objectstack/cli' test",
      'pnpm --filter "@objectstack/lint" test',
      'pnpm exec turbo run build --filter=@object-ui/console^...}',
      'pnpm --filter ./packages/* typecheck',
    ].join('\n'),
  );
  ok(`extraction finds every spelling (found ${extracted.length})`, extracted.length === 6);
  ok('the space form', extracted[0].value === '@objectstack/spec' && extracted[0].line === 1);
  ok('the equals form', extracted[1].value === '@objectstack/core');
  ok('single quotes', extracted[2].value === '@objectstack/cli');
  ok('double quotes', extracted[3].value === '@objectstack/lint');
  ok('a `${VAR:-default}` expansion does not swallow the closing brace', extracted[4].value === '@object-ui/console^...');
  ok('a path glob', extracted[5].value === './packages/*' && extracted[5].line === 6);

  // The command a `--filter` BELONGS to. Both of these are real spellings in
  // this repo, and both were reported as dead packages before this
  // discrimination existed.
  ok(
    'git\'s partial-clone --filter is not pnpm\'s',
    extractFilters('git fetch --unshallow --filter=blob:none\n').length === 0,
  );
  ok(
    'prose that merely contains the word --filter is not a command',
    extractFilters("t('prints it as its full --filter invocation', x)\n").length === 0,
  );
  ok(
    'a pnpm command earlier on the line is not inherited by a later git one',
    extractFilters('pnpm -v && git fetch --filter=blob:none\n').length === 0,
  );
  ok(
    'and the pnpm one on such a line IS still found',
    extractFilters('git fetch --filter=blob:none && pnpm --filter @objectstack/spec test\n')
      .map((e) => e.value)
      .join() === '@objectstack/spec',
  );
  const folded = extractFilters('pnpm \\\n  --filter @objectstack/spec \\\n  test\n');
  ok('a backslash continuation is folded, so `pnpm \\` + `--filter` is one command', folded.length === 1);
  ok('and the reported line is where the command STARTS', folded[0]?.line === 1);

  // ---- the preflight: both directions, on the card's own command ----------
  const cwd = root ?? HERE;
  const refused = preflightCommand('pnpm --filter @objectstack/adapter-hono test --maxWorkers=2', cwd);
  ok('PREFLIGHT REDS on the card\'s literal reproduction', refused.decision === 'refuse');
  ok('and the refusal names the selector', refusalMessage(refused).includes('@objectstack/adapter-hono'));
  ok('and suggests the real package', refusalMessage(refused).includes('@objectstack/hono'));
  ok(
    'PREFLIGHT is SILENT on the same command with the real name',
    preflightCommand('pnpm --filter @objectstack/hono test --maxWorkers=2', cwd).decision === 'allow',
  );
  ok(
    'PREFLIGHT is silent on a filter it cannot judge',
    preflightCommand('pnpm --filter ./packages/* build', cwd).decision === 'allow',
  );
  ok(
    'PREFLIGHT is silent on a command that changes directory -- unknown root, no verdict',
    preflightCommand('cd ../objectui && pnpm --filter @objectstack/adapter-hono build', cwd).decision === 'allow',
  );
  ok(
    'PREFLIGHT is silent on a command that is not pnpm or turbo',
    preflightCommand('grep -rn -- "--filter @objectstack/adapter-hono" scripts', cwd).decision === 'allow',
  );
  ok(
    'PREFLIGHT judges a turbo filter too',
    preflightCommand('pnpm exec turbo run build --filter=@objectstack/adapter-hono', cwd).decision === 'refuse',
  );
  ok(
    'PREFLIGHT reports how many filters it actually judged',
    preflightCommand('pnpm --filter @objectstack/hono test', cwd).judged === 1,
  );

  // ---- the workspace reader ------------------------------------------------
  const patterns = workspacePatterns(readFileSync(join(root ?? HERE, 'pnpm-workspace.yaml'), 'utf8'));
  ok(`the workspace file yields its globs (found ${patterns.length})`, patterns.length >= 5);
  ok('and stops at the next top-level key, not at the end of the file', !patterns.some((p) => p.includes(':')));
  ok('and holds the nested ones', patterns.includes('packages/adapters/*') || patterns.includes('packages/drivers/*'));

  // The shared workspace enumerator is a plain module with no CI invocation of
  // its own (#11510); every script that consolidated onto it folds in its checks.
  failures.push(...workspaceEnumeratorSelfTest({ root: root ?? HERE }));

  if (failures.length === 0) {
    console.log(
      `✓ pnpm-filter-targets --self-test: ${checked} assertions over ${names.length} real workspace packages `
        + '(match rule pinned against measured pnpm behaviour; preflight observed both REFUSING and SILENT).',
    );
    return 0;
  }
  console.error(`✗ pnpm-filter-targets --self-test -- ${failures.length} failure(s)\n`);
  for (const failure of failures) console.error(`  • ${failure}`);
  return 1;
}

if (isEntrypoint(import.meta.url)) {
  const [flag, argument] = process.argv.slice(2);
  if (flag === '--self-test') process.exit(await selfTest());
  else if (flag === '--list') process.exit(cliList());
  else if (flag === '--preflight') process.exit(cliPreflight(argument ?? ''));
  else {
    console.error('usage: pnpm-filter-targets.mjs [--list | --preflight <command> | --self-test]');
    process.exit(2);
  }
}
