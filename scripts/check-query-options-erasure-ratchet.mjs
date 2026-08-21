#!/usr/bin/env node
// check-query-options-erasure-ratchet — the #4918 guard, enforced.
//
// `eslint.config.mjs` bans erasing an engine query-options value to `any`
// (`query-options/no-any-erasure`, rationale on QUERY_OPTIONS_ANY_MESSAGE
// there). Two populations sit outside what `pnpm lint` can block on its own,
// and this script is what stops each of them from going dark:
//
//   • NON-TEST residual. The files that still hold pre-existing sites are
//     grandfathered by path in `scripts/query-options-erasure-baseline.json`.
//     An ESLint `ignores` entry silences the WHOLE file, so a new erasure added
//     to a listed file would ride the old entry in total silence — the exact
//     move the slot-lookup ratchet was written to stop (#4251). So the baseline
//     carries per-file COUNTS, measured here with the grandfathering lifted.
//
//   • TEST residual. The 08-03 triage scoped the blocking rule to non-test code:
//     an unknown share of the test sites are LEGITIMATE, because a test whose
//     subject is off-contract engine input has to erase the type to construct
//     input `tsc` would refuse. Those are held by one aggregate decrease-only
//     number instead, so the surface is measured and cannot grow unnoticed
//     without a per-file ratchet going red on a legitimate rejection test.
//
//     ⚠️ #8210: driving this number down does NOT make `tsc` catch a malformed
//     options bag for every file it counts, and no other type-aware checker
//     fills the gap either — measured directly (see below), not assumed. At
//     the time of writing, 6 of the 9 packages holding test-surface sites
//     (`objectql`, `runtime`, `spec`, `drivers/driver-mongodb`,
//     `plugins/plugin-approvals`, `plugins/plugin-auth`) exclude `**/*.test.ts`
//     from their `tsconfig.json` — ~143 of the 240 counted sites sit in files
//     `pnpm --filter <pkg> typecheck` never reads at all (`drivers/driver-memory`,
//     `drivers/driver-sql` and `drivers/driver-sqlite-wasm` hold the other ~97
//     and ARE type-checked). Re-derive the split any time with
//     `git log`-free measurement: run the two `measure()` calls below against
//     `QUERY_OPTIONS_TEST_GLOBS`, bucket the resulting files by whether their
//     package's `tsconfig.json` excludes `**/*.test.ts`.
//
//     ESLint does not fill the gap either — measured, not assumed: this
//     repo's ONE `eslint.config.mjs` never sets `parserOptions.project` (or
//     any other type-aware option) and never registers a
//     `@typescript-eslint/eslint-plugin` typed rule, so no ESLint pass here is
//     type-aware, over test files or non-test files alike. Positive control:
//     a `const opts: EngineAggregateOptions = { aggregations: [{ func: … }] }`
//     (wrong key — the declared one is `function`) planted in an excluded
//     `objectql` test file left BOTH `pnpm --filter @objectstack/objectql
//     typecheck` (exit 0) and `pnpm exec eslint --no-inline-config` on that
//     file (0 problems) silent. A second, independently measured instance:
//     PR #8406's patch round found `pnpm --filter @objectstack/lint typecheck`
//     structurally blind to 12 new TS2339s in `packages/lint` test files,
//     caught only by the TEST_DEBT hidden-layer measurement — same shape,
//     different package, same day.
//
//     What driving this number down DOES buy, honestly: it removes an `any`
//     that would otherwise blind whatever type-aware tool eventually DOES run
//     over the file (an editor's language service today; `tsc` itself on the
//     day a package's exclusion lifts), and it is the precondition for that
//     day rather than a substitute for it. Where a package's `tsconfig.json`
//     excludes `**/*.test.ts`, typing the options bag is real, low-cost
//     hygiene — it is just not, today, a compiler guard against a wrong key.
//
// It fails when:
//   • a non-test file NOT in the baseline reports a site (that already fails
//     `pnpm lint` — reported here too so one command explains the picture), or
//   • a baselined file's count INCREASES (new erasure hiding behind an old
//     entry — the invisible move), or
//   • a baselined file's count DECREASED, or the file is clean/gone (progress!)
//     — run with --update to ratchet the baseline down and commit it, or
//   • a file was ADDED to the baseline relative to the merge base with main
//     (the grandfather list is not a mute button), or
//   • the aggregate TEST count moved in either direction: up is a new erasure,
//     down is un-ratcheted progress. A ceiling left above reality silently
//     licenses that many new erasures, which is how a ratchet stops meaning
//     anything.
//
// And it REFUSES to report at all (exit 2) when a file in either population
// does not PARSE. ESLint's Node API returns a parse failure as a message
// carrying no rule id, so it matches neither count above: before #10123 such a
// file contributed zero sites and this gate printed `✓ … holds` and exited 0 —
// a clean verdict on a file it had never read, while `pnpm lint` failed loudly
// on the same input. scripts/eslint-fatal-guard.mjs carries the measurement and
// why a fatal is the measurement failing rather than a finding.
//
//   node scripts/check-query-options-erasure-ratchet.mjs [--update] [--self-test]
//
// The counts are produced by running ESLint itself over the real config with
// the relevant `ignores` lifted, and reports are matched by the rule's exact
// id. The counter therefore cannot drift from the rule: change the rule and
// this re-measures against it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import eslintConfig, {
  QUERY_OPTIONS_RULE_ID,
  QUERY_OPTIONS_TEST_GLOBS,
  QUERY_OPTIONS_ANY_MESSAGE,
} from '../eslint.config.mjs';
import {
  checkGuardAdoption,
  collectFatalMessages,
  guardAdoptionProblems,
  lintFilesStrict,
} from './eslint-fatal-guard.mjs';
import {
  HEADROOM_CANARY_FILE,
  PARSER_STACK_SIZE_KB,
  STACK_FLAG,
  STACK_REARM_GUARD,
  canaryParseFailures,
  checkHeadroomAdoption,
  ensureStackHeadroom,
  formatCanaryFailure,
  osThreadStackKb,
  stackRearmPlan,
} from './eslint-stack-headroom.mjs';

// This gate lints IN-PROCESS, so it does not inherit the `--stack-size` the
// root `lint` script puts on ESLint's CLI entry, and this repo's deepest file
// does not parse without it (#10449). Re-exec once, before any linting --
// including before `--self-test`, whose headroom assertion below is only a fact
// about the gate if the self-test runs on the same stack the gate does.
ensureStackHeadroom(fileURLToPath(import.meta.url));

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const BASELINE_PATH = 'scripts/query-options-erasure-baseline.json';
const LINT_TARGET = 'packages/**/*.{ts,tsx,mts,cts}';

const carriesRule = (entry) => entry?.rules?.[QUERY_OPTIONS_RULE_ID] !== undefined;

/**
 * The config with a chosen set of `ignores` entries dropped from the block that
 * carries the rule. Every other config entry passes through untouched, so the
 * run stays byte-identical to `pnpm lint` in all other respects.
 */
function measuringConfig(drop) {
  return eslintConfig.map((entry) =>
    carriesRule(entry)
      ? { ...entry, ignores: (entry.ignores ?? []).filter((p) => !drop.has(p)) }
      : entry,
  );
}

async function measure(drop, targets = [LINT_TARGET]) {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    baseConfig: measuringConfig(drop),
    // Match the root `lint` script: this repo lints with --no-inline-config on
    // purpose, so an eslint-disable comment must not shrink a count here either.
    allowInlineConfig: false,
  });
  // Not `eslint.lintFiles`: a parse failure inside the population is the
  // measurement failing, not a file with nothing to report, and it matches
  // neither count below. The guard names the file and stops (#10123).
  const results = await lintFilesStrict(eslint, targets, {
    gate: 'check-query-options-erasure-ratchet',
    repoRoot,
  });
  const counts = {};
  for (const result of results) {
    const hits = result.messages.filter((m) => m.ruleId === QUERY_OPTIONS_RULE_ID).length;
    if (hits > 0) counts[relative(repoRoot, result.filePath).replace(/\\/g, '/')] = hits;
  }
  return counts;
}

const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const sortKeys = (counts) =>
  Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Every failure this gate can report, as a pure function of the four measured
 * facts. Kept pure so --self-test can drive it in BOTH directions without
 * needing a repo in a particular state — the comparison logic is the half of
 * this script that a green run over a clean tree cannot exercise at all.
 */
export function diffRatchet({ baseline, current, testCeiling, testSites, addedBaselineKeys }) {
  const errors = [];

  for (const [file, count] of Object.entries(current)) {
    const allowed = baseline[file];
    if (allowed === undefined) {
      errors.push(
        `${file}: NEW engine query-options erasure (${count} site(s)). Type the ` +
        `options (\`EngineQueryOptions\` / \`QueryAST\`) instead of erasing them to ` +
        `\`any\` — see eslint.config.mjs and issue #4918. This file is not ` +
        `grandfathered, and the baseline never grows.`,
      );
    } else if (count > allowed) {
      errors.push(
        `${file}: erasure count grew ${allowed} → ${count}. The file is grandfathered ` +
        `for its EXISTING sites only; new ones must carry the declared options type.`,
      );
    }
  }

  for (const [file, allowed] of Object.entries(baseline)) {
    const now = current[file];
    if (now === undefined) {
      errors.push(
        `${file}: baselined file is clean/gone (was ${allowed}) — ratchet DOWN: run ` +
        `\`pnpm check:query-options-erasure --update\` and commit the baseline.`,
      );
    } else if (now < allowed) {
      errors.push(
        `${file}: erasure count fell ${allowed} → ${now} — ratchet DOWN: run ` +
        `\`pnpm check:query-options-erasure --update\` and commit the baseline.`,
      );
    }
  }

  // The key set must only ever SHRINK. Counts alone cannot see the last move: a
  // genuinely-erasing NEW file added to the baseline matches its own count and
  // sails through, which would turn the grandfather list into a general-purpose
  // mute button.
  for (const file of addedBaselineKeys ?? []) {
    errors.push(
      `${file}: ADDED to the baseline. The grandfather list is not a mute button — it ` +
      `only ever shrinks. Type this file's query options instead; see issue #4918.`,
    );
  }

  if (testSites > testCeiling) {
    errors.push(
      `test surface grew ${testCeiling} → ${testSites} site(s). Tests are outside the ` +
      `blocking rule, not outside the count. Either type the options, or — if the ` +
      `input is DELIBERATELY off-contract (a test asserting the engine rejects an ` +
      `unknown option) — write \`as unknown as EngineQueryOptions\`, which names the ` +
      `contract being bypassed, keeps the rest of the call checked, and is not counted ` +
      `here. Raising this number is a reviewed edit, not a remedy. Note (#8210): in a ` +
      `package whose tsconfig excludes \`**/*.test.ts\`, typing the options here does ` +
      `NOT make \`tsc\` (or ESLint — neither is type-aware over this repo's test files) ` +
      `catch a wrong key; it removes an \`any\` and is a precondition for the day that ` +
      `exclusion lifts, not a compiler guard today.`,
    );
  } else if (testSites < testCeiling) {
    errors.push(
      `test surface fell ${testCeiling} → ${testSites} site(s) — ratchet DOWN: run ` +
      `\`pnpm check:query-options-erasure --update\` and commit the baseline. A ceiling ` +
      `left above reality silently licenses that many new erasures.`,
    );
  }

  return errors;
}

/** Baseline keys that are not present at the merge base with `main`. */
function baselineKeysAddedSinceMergeBase(baselineKeys) {
  try {
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    let base;
    for (const ref of ['origin/main', 'main']) {
      try { base = git('merge-base', 'HEAD', ref); break; } catch { /* try the next ref */ }
    }
    if (!base) return null;
    const previous = JSON.parse(git('show', `${base}:${BASELINE_PATH}`));
    const known = new Set(Object.keys(previous.nonTest ?? {}));
    return { base: base.slice(0, 7), added: baselineKeys.filter((f) => !known.has(f)) };
  } catch {
    // No git, a shallow clone without the base, or the baseline is new on this
    // branch (`git show` fails). Reported by the caller rather than passed over
    // — a check that cannot run must not read as a check that passed.
    return null;
  }
}

// ---------------------------------------------------------------------------
// --self-test

// ── Guard-adoption fixtures (#10458) ──────────────────────────────────────
//
// checkGuardAdoption() reads THIS FILE, so its fixtures cannot be written the
// obvious way. `stripComments` deliberately keeps string literals — a gate's
// signal usually IS a string — so a contiguous `lintFilesStrict` + `(` inside
// a fixture would satisfy this gate's own call test after its real calls were
// gone, and a contiguous `.lintFiles` + `(` would report this gate as
// unguarded outright. Both call shapes are therefore spelled with a `+`: the
// runtime string is what the check sees, the source text is not a decoy. Do
// not "tidy" them into single literals.
const FIXTURE_CALL_STRICT = 'const results = await lintFilesStrict' + '(eslint, [TARGET], { gate: G });';
const FIXTURE_CALL_RAW = 'const results = await eslint.lintFiles' + '([TARGET]);';
const FIXTURE_IMPORT = "import { lintFilesStrict } from './eslint-fatal-guard.mjs';";
const FIXTURE_PROSE = '// on the same input. scripts/eslint-fatal-guard.mjs carries the measurement and';
const FIXTURE_COUNT = 'const sites = (await eslint.lintText(code)).messages.filter(matches).length;';

const NO_IMPORT = 'does not import scripts/eslint-fatal-guard.mjs';
const NOT_ARMED = 'Importing the guard does not arm it';
const RAW_CALL = 'directly, so a parse failure in its population';

/**
 * The adoption check in both directions, over sources written here.
 *
 * The live-tree assertion below can only prove the direction today's tree is
 * in, and both gates are adopted today — so on its own it is exactly the shape
 * #4690 warns about: a check that has only ever been green. The reject side is
 * asserted positively here, and each case is a real regression someone could
 * land: `[name, source lines, the problems it must produce]`.
 */
const GUARD_ADOPTION_CASES = [
  // The positive control. A zero-hit result over the other five means nothing
  // without a case that is supposed to come back clean and does.
  ['imports the guard and calls it', [FIXTURE_PROSE, FIXTURE_IMPORT, FIXTURE_CALL_STRICT], []],
  // The measured reproduction: the real import line deleted, the docblock left
  // exactly as it was. Against the raw text this came back CLEAN and the
  // self-test printed "both gates still routed through it".
  ['a docblock mention is not an import', [FIXTURE_PROSE, FIXTURE_COUNT], [NO_IMPORT]],
  // "A guard imported once is not a guard still called" — the docblock's own
  // thesis, which nothing used to assert.
  ['imports the guard and never calls it', [FIXTURE_PROSE, FIXTURE_IMPORT, FIXTURE_COUNT], [NOT_ARMED]],
  // The same sentence one step further: commenting the call out leaves the
  // identifier in the text.
  ['a commented-out call is not a call', [FIXTURE_IMPORT, '// ' + FIXTURE_CALL_STRICT], [NOT_ARMED]],
  // Back to unguarded ESLint: both problems, because it is both.
  // (the case NAME avoids the raw call shape too — a decoy is a decoy in a
  // label as much as in a fixture, and this one did red the gate once.)
  ['went back to unguarded ESLint', [FIXTURE_IMPORT, FIXTURE_CALL_RAW], [NOT_ARMED, RAW_CALL]],
  // The mask's other direction. Over-masking costs recall; UNDER-masking
  // fabricates a finding out of prose (#9367), and this check must not.
  ['a commented-out raw call is not a raw call',
    [FIXTURE_IMPORT, FIXTURE_CALL_STRICT, '// was: ' + FIXTURE_CALL_RAW], []],
];

async function selfTest() {
  const failures = [];
  const assert = (cond, msg) => { if (!cond) failures.push(msg); };

  // ── 1. The rule, in both directions, over synthetic sources. ──────────────
  //
  // A gate that has only ever been green cannot be told apart from a gate that
  // matches nothing (#4690), so every shape is proved to REPORT and its
  // canonical counterpart proved to stay SILENT.
  const drop = new Set([...QUERY_OPTIONS_TEST_GLOBS]);
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    baseConfig: measuringConfig(drop),
    allowInlineConfig: false,
  });
  const hits = async (code, filePath = 'packages/objectql/src/__selftest__.ts') => {
    const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
    return (result?.messages ?? []).filter((m) => m.ruleId === QUERY_OPTIONS_RULE_ID).length;
  };

  const reports = [
    ['argument 1, object literal', "await e.find('o', { where: {}, orderBy: [] } as any);"],
    ['argument 1, identifier', 'await e.findOne(t, query as any);'],
    ['argument 2, member expression', 'await d.find(o, ast, ctx.input.options as any);'],
    ['count()', "await e.count('o', { where: {} } as any);"],
    ['aggregate()', "await e.aggregate('o', { aggregations: [] } as any);"],
    ['angle-bracket assertion', "await e.find('o', <any>opts);"],
    [
      'laundered chain — `as any as Contract` erases exactly as `as any` does',
      "await e.find('o', { direction: 'desc' } as any as EngineQueryOptions);",
    ],
    [
      'split declaration — the shape #4674 global search actually used',
      "const opts: any = { where: w }; await e.find('o', opts);",
    ],
    ['orderBy one level down', "await e.find('o', { ...(a.orderBy ? { orderBy: a.orderBy as any } : {}) });"],
    ['orderBy as a string key', "const q = { 'orderBy': sort as any };"],
  ];
  for (const [name, code] of reports) {
    assert((await hits(code)) >= 1, `expected a report for ${name}: ${code}`);
  }

  const silent = [
    ['typed options need no assertion', "await e.find('o', { where: {}, orderBy: [{ field: 'a', order: 'desc' }] });"],
    ['a typed local', "const opts: EngineQueryOptions = { where: w }; await e.find('o', opts);"],
    [
      'the deliberate spelling is the sanctioned escape',
      "await e.find('o', { nope: 1 } as unknown as EngineQueryOptions);",
    ],
    ['Array.prototype.find — callback at index 0', 'rows.find((r) => r.id === id as any);'],
    ['a cast RESULT is not an options erasure', "const rows = (await e.find('o', { where: w })) as any;"],
    ['argument 0 is the object name, never options', 'await e.find(name as any, { where: w });'],
    ['an unrelated `orderBy` on a non-any assertion', "const q = { orderBy: sort as SortNode[] };"],
    ['a computed key that merely spells orderBy', 'const q = { [orderBy]: sort as any };'],
    ['an `: any` local that never reaches a query', 'const opts: any = { where: w }; use(opts);'],
    ['a shadowed inner binding that is typed', 'const opts: any = 1; { const opts: EngineQueryOptions = q; e.find(o, opts); }'],
  ];
  for (const [name, code] of silent) {
    assert((await hits(code)) === 0, `expected NO report for ${name}: ${code}`);
  }

  // The grandfathering channel is real: the same source is silent on a
  // baselined path and loud on a path that is not baselined.
  {
    const baselined = Object.keys(
      JSON.parse(readFileSync(resolve(repoRoot, BASELINE_PATH), 'utf8')).nonTest,
    )[0];
    const code = "await e.find('o', { where: {} } as any);";
    assert(
      baselined === undefined || (await hits(code, baselined)) === 0,
      `a baselined path must be silent under the blocking config (${baselined})`,
    );
    assert(
      (await hits(code, 'packages/objectql/src/__selftest_not_baselined__.ts')) >= 1,
      'a non-baselined path must report',
    );
  }

  // The test-glob exclusion is real, and it is what the ratchet lifts.
  {
    const code = "await e.find('o', { where: {} } as any);";
    const blocking = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: true,
      baseConfig: eslintConfig,
      allowInlineConfig: false,
    });
    const [result] = await blocking.lintText(code, {
      filePath: 'packages/objectql/src/__selftest__.test.ts',
      warnIgnored: false,
    });
    const blocked = (result?.messages ?? []).filter((m) => m.ruleId === QUERY_OPTIONS_RULE_ID).length;
    assert(blocked === 0, 'a *.test.ts path must NOT be blocked by the rule (first cut is non-test)');
    assert(
      (await hits(code, 'packages/objectql/src/__selftest__.test.ts')) >= 1,
      'the same *.test.ts path MUST be counted once the ratchet lifts the test globs',
    );
  }

  assert(
    /4674/.test(QUERY_OPTIONS_ANY_MESSAGE) && /as unknown as/.test(QUERY_OPTIONS_ANY_MESSAGE),
    'the rule message must carry the #4674 cost and the sanctioned deliberate spelling',
  );

  // ── 2. The ratchet comparison, in both directions. ────────────────────────
  const base = { 'a.ts': 2, 'b.ts': 1 };
  const cases = [
    ['identical + ceiling met is clean', { baseline: base, current: { ...base }, testCeiling: 10, testSites: 10, addedBaselineKeys: [] }, 0],
    ['a new file fails', { baseline: base, current: { ...base, 'c.ts': 1 }, testCeiling: 10, testSites: 10, addedBaselineKeys: [] }, 1],
    ['growth in a baselined file fails', { baseline: base, current: { 'a.ts': 3, 'b.ts': 1 }, testCeiling: 10, testSites: 10, addedBaselineKeys: [] }, 1],
    ['a fall must be ratcheted down', { baseline: base, current: { 'a.ts': 1, 'b.ts': 1 }, testCeiling: 10, testSites: 10, addedBaselineKeys: [] }, 1],
    ['a cleaned file must be dropped', { baseline: base, current: { 'a.ts': 2 }, testCeiling: 10, testSites: 10, addedBaselineKeys: [] }, 1],
    ['a key added to the baseline fails', { baseline: base, current: { ...base }, testCeiling: 10, testSites: 10, addedBaselineKeys: ['b.ts'] }, 1],
    ['test-surface growth fails', { baseline: base, current: { ...base }, testCeiling: 10, testSites: 11, addedBaselineKeys: [] }, 1],
    ['test-surface shrink must be ratcheted down', { baseline: base, current: { ...base }, testCeiling: 10, testSites: 9, addedBaselineKeys: [] }, 1],
  ];
  for (const [name, input, expected] of cases) {
    const got = diffRatchet(input).length;
    assert(got === expected, `diffRatchet: ${name} — expected ${expected} error(s), got ${got}`);
  }

  // ── 3. The fatal-parse guard, in both directions (#10123). ───────────────
  //
  // ESLint does not throw on a file that will not parse: it returns the failure
  // as a message with no rule id, which matches neither count this gate keeps.
  // Before the guard such a file contributed zero sites and the gate printed
  // `✓ … holds`, so the harm is a QUIET GREEN — a case showing the guard silent
  // on today's (parseable) corpus would prove nothing at all. Both directions
  // are therefore driven through real ESLint output, and the fixture is a file
  // that genuinely does not parse rather than a hand-built message object.
  {
    const [broken] = await eslint.lintText('export const x = (', {
      filePath: 'packages/objectql/src/__selftest_unparseable__.ts',
      warnIgnored: false,
    });
    assert(
      (broken?.messages ?? []).some((m) => m.fatal),
      'ESLint must report an unparseable file as a fatal message — the premise of the guard',
    );
    assert(
      (broken?.messages ?? []).filter((m) => m.ruleId === QUERY_OPTIONS_RULE_ID).length === 0,
      'and that message must match no counted rule, which is exactly why it needs its own check',
    );

    const fatals = collectFatalMessages([broken], repoRoot);
    assert(fatals.length === 1, `the guard must collect the fatal (collected ${fatals.length})`);
    assert(
      fatals[0]?.file.endsWith('__selftest_unparseable__.ts') && /Parsing error/i.test(fatals[0]?.message ?? ''),
      `the collected fatal must name the file and the parse error (got ${JSON.stringify(fatals[0])})`,
    );

    const [parses] = await eslint.lintText('export const x = 1;', {
      filePath: 'packages/objectql/src/__selftest_parses__.ts',
      warnIgnored: false,
    });
    assert(
      collectFatalMessages([parses], repoRoot).length === 0,
      'a file that parses must produce no fatal — the guard must not fire on a healthy tree',
    );

    // The call site the gates actually use: it must refuse to hand back results
    // for a population it could not measure, and say which file broke.
    let reported = null;
    const refused = await lintFilesStrict({ lintFiles: async () => [broken] }, [LINT_TARGET], {
      gate: 'self-test',
      repoRoot,
      onFatal: (report) => { reported = report; return 'refused'; },
    });
    assert(refused === 'refused', 'lintFilesStrict must not return results when a file did not parse');
    assert(
      (reported ?? '').includes('__selftest_unparseable__.ts') && /Parsing error/i.test(reported ?? ''),
      `the failure text must name the file and the parse error (got: ${reported})`,
    );

    let fired = false;
    const passed = await lintFilesStrict({ lintFiles: async () => [parses] }, [LINT_TARGET], {
      gate: 'self-test',
      repoRoot,
      onFatal: () => { fired = true; },
    });
    assert(
      !fired && Array.isArray(passed) && passed.length === 1,
      'lintFilesStrict must pass the results through when every file parsed',
    );

    // A guard imported once is not a guard still called — proved in both
    // directions over the fixtures above, because the live-tree call that
    // follows can only ever confirm the direction this tree is already in.
    for (const [name, lines, expected] of GUARD_ADOPTION_CASES) {
      const problems = guardAdoptionProblems('scripts/__adoption_fixture__.mjs', lines.join('\n'));
      assert(
        problems.length === expected.length && expected.every((e) => problems.some((p) => p.includes(e))),
        `guard adoption, ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(problems)}`,
      );
    }

    // And the live tree. This is also the only wired coverage of the OTHER
    // gate's call site: `pnpm check:slot-lookup` has no --self-test hook, and
    // CI runs this one before the gate itself.
    for (const problem of checkGuardAdoption(repoRoot)) assert(false, problem);
  }

  // -- 5. Parser headroom: the population's deepest file must actually PARSE. --
  //
  // The fatal guard above makes an unparseable file LOUD. This makes it not
  // happen. Both gates lint in-process, so neither inherits the `--stack-size`
  // the root `lint` script puts on ESLint's CLI entry, and #10449 is what that
  // gap costs: `packages/spec/src/migrations/registry.ts` stopped parsing on
  // the default V8 stack, so both gates started failing on a file the author
  // never touched -- INTERMITTENTLY, because the verdict depends on the other
  // files in the same run, which is what let every red be re-run away as a
  // flake for a day.
  //
  // ⭐ Why this asserts a PARSE and not a number. `registry.ts` is an ADR-0087
  // D3 forever artifact that gains a step per breaking protocol major, so its
  // AST depth only ever rises. A pinned depth or a pinned minimum stack would
  // be true today and quietly wrong at the next major -- the same defect
  // arriving a fourth time. Asking "does the file the gate must read still read
  // at the headroom the gate actually has" re-measures the real question every
  // run and cannot expire.
  //
  // And it is an EARLY warning, not a restatement of the gate: measured on the
  // tree that filed #10449, this single-file parse failed 10/10 runs at the
  // default stack while the gates' own whole-population runs failed 2/14. The
  // narrow scope is the worst case, so this trips a full margin before the
  // population run starts reddening other people's PRs.
  {
    assert(
      stackRearmPlan({ execArgv: [], env: {}, flagSupported: true }).rearm === true,
      'a plain run must re-exec itself with parser headroom',
    );
    assert(
      stackRearmPlan({ execArgv: [STACK_FLAG], env: {}, flagSupported: true }).rearm === false,
      'a run that already carries --stack-size must not re-exec again',
    );
    assert(
      stackRearmPlan({ execArgv: [], env: { [STACK_REARM_GUARD]: '1' }, flagSupported: true }).rearm === false,
      'the guard variable must stop a second re-exec -- otherwise a rearm is a spawn loop',
    );
    assert(
      stackRearmPlan({ execArgv: [], env: {}, flagSupported: false }).rearm === false,
      'a node that rejects the flag must degrade, not spawn a child that cannot start',
    );

    // The flag is on THIS process, so what follows is measured with the
    // headroom rather than merely alongside a flag on some command line.
    assert(
      process.execArgv.some((a) => a.startsWith('--stack-size')),
      `this self-test is running without --stack-size (execArgv: ${JSON.stringify(process.execArgv)}). ` +
      'ensureStackHeadroom() did not re-exec, so the parse proved below is not the one the gate gets.',
    );

    // Above the OS thread stack V8 runs off the real stack and SIGSEGVs instead
    // of throwing a clean RangeError, so headroom that crosses it converts a
    // loud gate into a crash. Read the real limit rather than pinning one.
    const osStackKb = osThreadStackKb();
    if (osStackKb !== null) {
      assert(
        PARSER_STACK_SIZE_KB < osStackKb,
        `PARSER_STACK_SIZE_KB (${PARSER_STACK_SIZE_KB}) is not below this machine's ` +
        `thread stack (ulimit -s = ${osStackKb} KB). At or above it V8 SIGSEGVs instead of ` +
        'throwing, which turns every parse failure into an unexplained crash.',
      );
    }

    const canaryFatals = await canaryParseFailures(eslint, { repoRoot });
    assert(canaryFatals.length === 0, formatCanaryFailure(canaryFatals));

    // Importing the headroom module is not arming it, and a gate that quietly
    // stopped arming it looks exactly like one that never lost the flag.
    for (const problem of checkHeadroomAdoption(repoRoot)) assert(false, problem);
  }

  // A missing config block must ABORT, never report clean.
  assert(eslintConfig.some(carriesRule), 'the config must carry the query-options rule');

  if (failures.length > 0) {
    console.error(`✗ self-test (${failures.length} failure(s)):\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ self-test: ${reports.length} reporting shape(s), ${silent.length} silent counterpart(s), ` +
    `grandfathering + test-glob channels proved in both directions, ${cases.length} ratchet case(s), ` +
    `fatal-parse guard proved both ways over real ESLint output, both gates still routed through it ` +
    `(adoption proved both ways over ${GUARD_ADOPTION_CASES.length} synthetic gate source(s)), ` +
    `and ${HEADROOM_CANARY_FILE} parses at --stack-size=${PARSER_STACK_SIZE_KB} through this gate's own channel.`,
  );
}

// ---------------------------------------------------------------------------
// main

if (process.argv.includes('--self-test')) {
  await selfTest();
  process.exit(0);
}

if (!eslintConfig.some(carriesRule)) {
  console.error(
    `check-query-options-erasure-ratchet: no config block carries \`${QUERY_OPTIONS_RULE_ID}\`.\n` +
    'The rule was renamed or removed without updating QUERY_OPTIONS_RULE_ID — refusing\n' +
    'to report "clean" for a rule that is no longer being measured.',
  );
  process.exit(2);
}

const update = process.argv.includes('--update');
const baselineFile = JSON.parse(readFileSync(resolve(repoRoot, BASELINE_PATH), 'utf8'));
const baseline = baselineFile.nonTest ?? {};
const testCeiling = baselineFile.testSurface?.sites;

if (typeof testCeiling !== 'number' && !update) {
  console.error(
    `check-query-options-erasure-ratchet: ${BASELINE_PATH} has no numeric ` +
    '`testSurface.sites`. Refusing to report clean with half the surface unmeasured.',
  );
  process.exit(2);
}

// Two runs, one per population. The split is done by ESLint against the very
// globs the rule uses, so there is no second definition of "is this a test
// file" for the two halves to drift apart on.
const nonTest = sortKeys(await measure(new Set(Object.keys(baseline))));
const everything = sortKeys(await measure(new Set([...Object.keys(baseline), ...QUERY_OPTIONS_TEST_GLOBS])));
const testOnly = sortKeys(
  Object.fromEntries(Object.entries(everything).filter(([file]) => !(file in nonTest))),
);
const testSites = sum(testOnly);

if (update) {
  const next = {
    ...baselineFile,
    nonTest,
    testSurface: { ...(baselineFile.testSurface ?? {}), sites: testSites },
  };
  writeFileSync(resolve(repoRoot, BASELINE_PATH), JSON.stringify(next, null, 2) + '\n');
  console.log(
    `query-options-erasure baseline updated: ${sum(nonTest)} non-test site(s) in ` +
    `${Object.keys(nonTest).length} file(s); test surface ${testSites} site(s) in ` +
    `${Object.keys(testOnly).length} file(s).`,
  );
  process.exit(0);
}

const monotonicity = baselineKeysAddedSinceMergeBase(Object.keys(baseline));
const errors = diffRatchet({
  baseline,
  current: nonTest,
  testCeiling,
  testSites,
  addedBaselineKeys: monotonicity?.added ?? [],
});

if (errors.length > 0) {
  console.error(`✗ query-options-erasure ratchet (${errors.length} problem(s)):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error(
    `\nUnswept: ${sum(nonTest)} non-test site(s) in ${Object.keys(nonTest).length} file(s), ` +
    `plus ${testSites} in test code. Sweeping is a separate batch — part of the residual ` +
    `needs a boundary type WRITTEN (objectql's \`hookContext.input.options\`, the metadata ` +
    `loader's query bag), not the assertion deleted. See issue #4918.`,
  );
  process.exit(1);
}

console.log(
  `✓ query-options-erasure ratchet holds: ${sum(nonTest)} unswept non-test site(s) in ` +
  `${Object.keys(nonTest).length} file(s), none new, and every file measured parsed. ` +
  `Every other non-test file under packages/ is covered by \`pnpm lint\`.`,
);
console.log(
  `  test surface: ${testSites} site(s) in ${Object.keys(testOnly).length} file(s) — at the ` +
  `ceiling, outside the blocking rule by the #4918 triage (a rejection test must be able ` +
  `to build off-contract input).`,
);
console.log(
  monotonicity
    ? `  baseline key set verified against ${monotonicity.base}: no files added.`
    : `  NOT verified: could not read the baseline at the merge base with main (no git, ` +
      `shallow clone, or the baseline is new here), so "no files added" is unchecked this run.`,
);
