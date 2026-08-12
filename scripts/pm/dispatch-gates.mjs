#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dispatch-gates (#7341 item 4) — map a card's file surface to the `check:*`
 * gate families that watch it, derived from the tree AT RUNTIME.
 *
 *   node scripts/pm/dispatch-gates.mjs <path> [<path> ...]   # e.g. packages/spec/src/data/filter.zod.ts
 *   node scripts/pm/dispatch-gates.mjs --self-test
 *
 * ## Why derived, never listed
 *
 * The step-5 dispatch template's "Local gates for this card" line is filled by
 * the PM, and the gate inventory is a thing that expires SAME-DAY: it grew
 * twice in one 2026-08-08/09 shift (#6672 added `check:kernel-hook-pairs`,
 * #6661 added `check:app-nav-i18n`), and even "the farm lives in lint.yml" is
 * a memory-shaped claim — measured on #7341's own dispatch-time survey, checks
 * also live in ci.yml / spec-liveness-check.yml / validate-deps.yml /
 * release.yml / showcase-smoke.yml. #6492 is the canonical incident for a
 * second copy of a list rotting inside prose (three mutually-contradicting
 * counts, drifting within one hour), and #6865 for relaying remembered
 * workflow facts into a dispatch prompt (four of six required-context names
 * lived in a different file than claimed). So this script embeds NO list of
 * checks and NO map from paths to checks: every run re-reads
 * `.github/workflows/*.yml`, resolves each `check:*` script through
 * package.json, and scans the check scripts' own sources for the path
 * literals they operate on. When the farm grows, the next run sees it.
 *
 * ## What the output means (and what it cannot promise)
 *
 * For each input path, checks are matched by the path literals discoverable in
 * their sources ("watch hints"). That derivation is honest but heuristic:
 *
 *   - a MATCHED check is one whose own source names a directory/file that
 *     covers the input path — high-signal, paste it into the dispatch prompt.
 *     It is printed as the RUNNABLE invocation (`pnpm --filter <pkg> run
 *     check:x` for a package-scoped gate, `pnpm check:x` for a root-scoped
 *     one), not as the bare script name: the bare name sends a dev to the root
 *     `package.json`, where a package-scoped gate is absent and therefore reads
 *     as nonexistent (#7440);
 *   - a check with NO discoverable path hints is listed once in the
 *     "repo-wide / undetermined" bucket. It is NOT known to be irrelevant —
 *     many gates read the whole tree (check:nul-bytes) or a convention rather
 *     than a path. The PM's judgment call stays a judgment call; what this
 *     script removes is the memory-shaped half (which named checks exist and
 *     where they live);
 *   - a CONVENTION-TRIGGERED check is one the path derivation can never reach,
 *     because it counts a population it computes for itself and so names no
 *     path literal to match. Those are derived from the change's KIND instead
 *     and printed under their own heading — see CHANGE_KIND_GATES.
 *
 * The output is print-only and exits 0 on a completed derivation; a run that
 * cannot read the workflows or package.json exits non-zero (#4690: unreadable
 * input must never look like an empty answer).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = new URL('../..', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Extraction — pure functions over file contents, self-testable offline.
// ---------------------------------------------------------------------------

/**
 * Pull every `check:*` invocation out of a workflow file's `run:` lines,
 * with the pnpm --filter package (if any) and the workflow's file name.
 */
export function extractCheckInvocations(workflowText, workflowFile) {
  const out = [];
  const runRe = /^\s*run:\s*(.+)$/gm;
  for (const [, cmd] of workflowText.matchAll(runRe)) {
    for (const m of cmd.matchAll(/pnpm\s+(?:--filter\s+(\S+)\s+)?(?:run\s+)?(check:[\w:-]+)/g)) {
      out.push({ check: m[2], filter: m[1] ?? null, workflow: workflowFile });
    }
    for (const m of cmd.matchAll(/node\s+(scripts\/[\w./-]*check-[\w.-]+\.mjs)/g)) {
      out.push({ check: m[1], filter: null, workflow: workflowFile, direct: true });
    }
  }
  return out;
}

/** Resolve a `check:x` script name to the script files it runs, via a package.json `scripts` map. */
export function resolveCheckToFiles(checkName, scriptsMap) {
  const cmd = scriptsMap[checkName];
  if (!cmd) return [];
  // The conventional script shape names its file twice (`--self-test && run`) — dedupe.
  return [...new Set([...cmd.matchAll(/(scripts\/[\w./-]+\.(?:mjs|cjs|js|sh))/g)].map((m) => m[1]))];
}

/**
 * Scan a check script's source for the path-ish string literals it operates
 * on. A hint is a quoted string that contains a `/` (or names a top-level
 * dotted dir) and looks like a repo path rather than a URL or a regex.
 */
export function extractWatchHints(scriptSource) {
  const hints = new Set();
  for (const m of scriptSource.matchAll(/['"`]([^'"`\n]{2,120})['"`]/g)) {
    const s = m[1];
    if (/^(https?:|[A-Z_]+=|-{1,2}\w)/.test(s)) continue;
    if (!/^[\w.@][\w.@/*-]*$/.test(s)) continue;
    const looksPathy = s.includes('/') || /^\.(claude|changeset|github|gitattributes)\b/.test(s);
    if (!looksPathy) continue;
    hints.add(s.replace(/\/+$/, ''));
  }
  return [...hints];
}

/**
 * Render an invocation a dev can paste and run, from the same parse the
 * workflow line produced. The script NAME alone is not runnable for a
 * package-scoped check: `check:doc-formula-expressions` lives in
 * `@objectstack/lint`, not in the root `package.json`, so a dev who searched
 * the obvious place found nothing and concluded the gate did not exist — twice,
 * in independent sessions, within one hour (#7440, PR #7416 / #7417). The
 * `--filter` package is the one piece of provenance this tool parsed and then
 * dropped, and it is the piece needed to run the thing.
 */
export function runnableInvocation({ check, filter, direct }) {
  if (direct) return `node ${check}`; // already a script path, never a pnpm script
  if (filter) return `pnpm --filter ${filter} run ${check}`;
  return `pnpm ${check}`;
}

/**
 * Does a watch hint cover an input path? Prefix either way, with globs
 * collapsed. A hint that collapses to a bare top-level directory name
 * (`packages`, `scripts` — no slash, not a dotted dir) is rejected as too
 * generic: it would match every file under the tree's biggest directories and
 * drown the signal the matched-via column exists to carry.
 */
export function hintCovers(hint, inputPath) {
  const plain = hint.replace(/\*\*?/g, '').replace(/\/+$/, '').replace(/\/$/, '');
  if (plain.length < 2) return false;
  if (!plain.includes('/') && !plain.startsWith('.')) return false;
  return inputPath.startsWith(plain) || plain.startsWith(inputPath);
}

// ---------------------------------------------------------------------------
// Change-kind derivation — the gates a path match can never reach
// ---------------------------------------------------------------------------

/**
 * Is this path a test file, judged the way the gates below judge it?
 *
 * Both gates classify by the FILENAME infix (`*.test.*` / `*.spec.*`), not by
 * directory: a helper at `__tests__/fixtures.ts` is test-adjacent but neither
 * gate counts it — it falls in their NON-test population, where the ordinary
 * blocking lint rule applies instead. Matching directories here would name two
 * gates that cannot move, which is the failure mode this whole script exists to
 * avoid. The extension set is the UNION of the two gates' own (one counts
 * `.ts`/`.tsx`, the other also `.mts`/`.cts`); these are leads to run locally,
 * not verdicts, so the wider side is the safe one.
 */
export function isTestFilePath(path) {
  return /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(path);
}

/**
 * Gates that fire on what a change IS, keyed by a mechanically-detectable
 * convention. Everything else in this script is derived at runtime and lists
 * nothing; this table is the one exception, and it is bounded on purpose.
 *
 * ## Why these two cannot be derived like the rest
 *
 * The path derivation matches a gate when the gate's own source names a
 * directory that covers your file. Both gates here compute their population
 * instead of naming it — one lints a glob set that lives in the shared ESLint
 * config, the other walks the workspace members — so neither source carries a
 * literal to match, and both sit permanently in the "undetermined" bucket. No
 * per-card gate list derived from paths can ever name them, however the
 * derivation improves.
 *
 * ## Why a named table and not a wider heuristic
 *
 * The tempting generalisation — scan every discovered check script for
 * `*.test.ts`-shaped literals and call those the test-sensitive gates — was
 * measured against this tree and names 22 families, because a script's source
 * mentions test paths in its fixtures, its self-test and its comments.
 * "Mentions a test file" is not "counts test files", and 22 leads is the same
 * as none. So the pair is written down, and the cost of writing it down is paid
 * back by the two properties below.
 *
 * ## How this entry stays honest
 *
 * - Every `name` here is resolved against the families actually discovered in
 *   the workflows at runtime. A gate that is renamed, retired or dropped from
 *   CI does not silently stop being suggested — the run prints it as STALE and
 *   says to fix this table. A hand-written list that reports its own rot is a
 *   different object from one that quietly ages.
 * - The entry is deletable, with a stated criterion: when a gate here grows a
 *   discoverable path literal, the ordinary derivation names it and its line
 *   below becomes redundant. Delete it then.
 */
export const CHANGE_KIND_GATES = [
  {
    kind: 'adds or edits a test file',
    matches: isTestFilePath,
    gates: [
      {
        name: 'check:query-options-erasure',
        why: 'its test-surface ceiling counts sites in *.test/*.spec files, so new test code moves it',
      },
      {
        name: 'check:type-check-coverage',
        why: "TEST_DEBT ratchets a package's test-layer type errors, so a new test file that does not typecheck cleanly moves it",
      },
    ],
  },
];

/**
 * Render the convention-triggered section. Pure over its inputs so the
 * self-test can drive both the hit and the STALE branch offline;
 * `resolveInvocation` returns a runnable command for a gate the live run
 * discovered, or null for one it did not.
 */
export function changeKindLines(paths, resolveInvocation, kinds = CHANGE_KIND_GATES) {
  const lines = [];
  for (const { kind, matches, gates } of kinds) {
    const hits = paths.filter((p) => matches(p));
    if (hits.length === 0) continue;
    lines.push(`  ${kind}: ${hits.join(', ')}`);
    for (const { name, why } of gates) {
      const invocation = resolveInvocation(name);
      lines.push(
        invocation
          ? `    - ${invocation}   — ${why}`
          : `    - ⚠ ${name}: STALE — no workflow runs a gate under this name. It was renamed or retired; fix CHANGE_KIND_GATES in this script.`,
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Live derivation
// ---------------------------------------------------------------------------

function derive(paths) {
  const wfDir = join(ROOT, '.github/workflows');
  const workflows = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
  if (workflows.length === 0) throw new Error('no workflow files found under .github/workflows');
  const rootScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};

  const invocations = [];
  for (const wf of workflows) {
    invocations.push(...extractCheckInvocations(readFileSync(join(wfDir, wf), 'utf8'), wf));
  }
  if (invocations.length === 0) throw new Error('no check:* invocations found in any workflow');

  // Dedupe by (check, workflow); resolve each to script files + watch hints.
  const byCheck = new Map();
  for (const inv of invocations) {
    const key = inv.check;
    if (!byCheck.has(key)) byCheck.set(key, { ...inv, workflows: new Set(), files: [], hints: [] });
    byCheck.get(key).workflows.add(inv.workflow);
  }
  for (const entry of byCheck.values()) {
    let files = entry.direct ? [entry.check] : resolveCheckToFiles(entry.check, rootScripts);
    if (entry.filter) {
      // package-scoped check: resolve through that package's manifest when findable
      const pkgDirGuess = entry.filter.replace(/^@objectstack\//, '');
      for (const base of ['packages', 'packages/plugins', 'packages/drivers', 'packages/services']) {
        const p = join(ROOT, base, pkgDirGuess, 'package.json');
        if (existsSync(p)) {
          const pkgScripts = JSON.parse(readFileSync(p, 'utf8')).scripts ?? {};
          files = files.concat(
            resolveCheckToFiles(entry.check, pkgScripts).map((f) => join(base, pkgDirGuess, f)),
          );
        }
      }
    }
    entry.files = files;
    for (const f of files) {
      const abs = join(ROOT, f);
      if (existsSync(abs)) entry.hints.push(...extractWatchHints(readFileSync(abs, 'utf8')));
    }
  }

  const matched = new Map();
  const undetermined = [];
  for (const [check, entry] of byCheck) {
    const hits = [];
    for (const p of paths) {
      const hint = entry.hints.find((h) => hintCovers(h, p));
      if (hint) hits.push({ path: p, hint });
    }
    if (hits.length) matched.set(check, { entry, hits });
    else if (entry.hints.length === 0) undetermined.push(check);
  }

  console.log(`dispatch-gates: ${byCheck.size} check famil(ies) discovered across ${workflows.length} workflow file(s) — derived at runtime, nothing listed in this script.\n`);
  if (matched.size) {
    console.log('Local gates for this card (paste into the dispatch prompt):');
    for (const [check, { entry, hits }] of [...matched].sort()) {
      const via = hits.map((h) => `${h.path} ⇢ '${h.hint}'`).join('; ');
      console.log(`  - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]   matched via ${via}`);
    }
  } else {
    console.log('No check family names the given paths in its own source.');
  }
  const kindLines = changeKindLines(paths, (name) => {
    const entry = byCheck.get(name);
    return entry ? runnableInvocation(entry) : null;
  });
  if (kindLines.length) {
    console.log('\nConvention-triggered gates (this change KIND moves them; no path derivation can name them):');
    for (const line of kindLines) console.log(line);
  }

  console.log(
    `\nRepo-wide / undetermined (no path literals discoverable — not known irrelevant): ${undetermined.length} famil(ies).` +
      '\nConvention-scoped gates match by what the change IS, not where it lives. This script derives the conventions it can detect mechanically ' +
      `(${CHANGE_KIND_GATES.map((k) => k.kind).join('; ')}) and prints them above when they hit; the rest stay the PM judgment call — ` +
      'new fake engine ⇒ check:engine-double-contract, new error code ⇒ check:error-code-casing, any edit ⇒ check:nul-bytes.',
  );
}

// ---------------------------------------------------------------------------
// Self-test — extraction + matching over fixtures; no filesystem beyond this file.
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [];
  const t = (name, cond) => cases.push([name, cond]);

  const wf = [
    'jobs:',
    '  lint:',
    '    steps:',
    '      - name: A',
    '        run: pnpm check:engine-double-contract',
    '      - name: B',
    '        run: pnpm --filter @objectstack/spec check:authorable-surface',
    '      - name: C',
    '        run: node scripts/check-nul-bytes.mjs',
    '      - name: not-a-check',
    '        run: pnpm build',
  ].join('\n');
  const invs = extractCheckInvocations(wf, 'lint.yml');
  t('extracts plain pnpm check', invs.some((i) => i.check === 'check:engine-double-contract' && i.filter === null));
  t('extracts filtered check with its package', invs.some((i) => i.check === 'check:authorable-surface' && i.filter === '@objectstack/spec'));
  t('extracts direct node scripts/check-*.mjs', invs.some((i) => i.check === 'scripts/check-nul-bytes.mjs' && i.direct));
  t('ignores non-check runs', !invs.some((i) => String(i.check).includes('build')));

  // #7440: the printed line must be runnable as-is. The three shapes come from
  // the same three fixtures above, so the sample workflow and the print site
  // cannot drift apart.
  const inv = (name) => invs.find((i) => i.check === name);
  t('prints a package-scoped check as its full --filter invocation', runnableInvocation(inv('check:authorable-surface')) === 'pnpm --filter @objectstack/spec run check:authorable-surface');
  t('prints a root-scoped check unchanged', runnableInvocation(inv('check:engine-double-contract')) === 'pnpm check:engine-double-contract');
  t('prints a direct script as a node invocation', runnableInvocation(inv('scripts/check-nul-bytes.mjs')) === 'node scripts/check-nul-bytes.mjs');

  const scripts = { 'check:foo': 'node scripts/check-foo.mjs --self-test && node scripts/check-foo.mjs' };
  t('resolves script file from package.json', resolveCheckToFiles('check:foo', scripts).join() === 'scripts/check-foo.mjs');
  t('unknown check resolves to nothing', resolveCheckToFiles('check:bar', scripts).length === 0);

  const src = [
    "const DIR = '.claude/agents';",
    "const GLOB = 'packages/spec/src/**/*.zod.ts';",
    "const URL2 = 'https://example.com/x';",
    "const FLAG = '--self-test';",
    "const WORD = 'hello';",
  ].join('\n');
  const hints = extractWatchHints(src);
  t('finds dotted-dir hint', hints.includes('.claude/agents'));
  t('finds glob hint', hints.some((h) => h.startsWith('packages/spec/src')));
  t('skips urls', !hints.some((h) => h.includes('example.com')));
  t('skips flags and bare words', !hints.includes('--self-test') && !hints.includes('hello'));

  t('hint covers deeper path', hintCovers('.claude/agents', '.claude/agents/os-dev.md'));
  t('collapsed glob prefix covers', hintCovers('packages/spec/src/**', 'packages/spec/src/data/filter.zod.ts'));
  t('input dir covers hint below it', hintCovers('packages/spec/scripts/check-x.mjs', 'packages/spec'));
  t('unrelated path does not match', !hintCovers('.claude/agents', 'packages/rest/src/server.ts'));

  // Change-kind derivation. The predicate is pinned in BOTH directions against
  // what the two gates themselves count: filename infix, never directory — a
  // helper inside `__tests__/` is in their non-test population.
  t('test file by .test infix', isTestFilePath('packages/objectql/src/engine.test.ts'));
  t('test file by .spec infix', isTestFilePath('packages/rest/src/server.spec.tsx'));
  t('test file with an mts extension', isTestFilePath('packages/spec/src/x.test.mts'));
  t('a __tests__ helper is NOT a test file to these gates', !isTestFilePath('packages/core/src/__tests__/fixtures.ts'));
  t('a plain source file is not a test file', !isTestFilePath('packages/objectql/src/engine.ts'));
  t('a non-TS file named test is not a test file', !isTestFilePath('docs/how.test.md'));

  const resolved = (name) => `pnpm ${name}`;
  const kindHit = changeKindLines(['packages/objectql/src/engine.test.ts'], resolved);
  t('a test path emits the convention section', kindHit.length === 3 && kindHit[0].includes('adds or edits a test file'));
  t('the section names both convention gates, runnably', kindHit.some((l) => l.includes('pnpm check:query-options-erasure')) && kindHit.some((l) => l.includes('pnpm check:type-check-coverage')));
  t('a non-test path emits nothing', changeKindLines(['scripts/pm/dispatch-gates.mjs'], resolved).length === 0);

  // The table's own rot detector: a name no live run discovers must say so,
  // never disappear quietly.
  const stale = changeKindLines(['a.test.ts'], () => null);
  t('an undiscoverable gate renders as STALE', stale.filter((l) => l.includes('STALE')).length === 2);
  t('every declared convention gate carries a reason', CHANGE_KIND_GATES.every((k) => k.gates.every((g) => g.name && g.why)));

  let failed = 0;
  for (const [name, cond] of cases) {
    if (!cond) failed++;
    console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  }
  if (failed) {
    console.error(`✗ dispatch-gates self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ dispatch-gates self-test: ${cases.length} cases pass.`);
}

const argvPaths = process.argv.slice(2).filter((a) => a !== '--self-test');
if (process.argv.includes('--self-test')) {
  selfTest();
} else if (argvPaths.length === 0) {
  console.error('usage: node scripts/pm/dispatch-gates.mjs <path> [<path> ...] | --self-test');
  process.exit(2);
} else {
  try {
    derive(argvPaths.map((p) => p.replace(/^\.\//, '')));
  } catch (err) {
    console.error(`dispatch-gates: derivation failed — ${err.message}`);
    process.exit(2);
  }
}
