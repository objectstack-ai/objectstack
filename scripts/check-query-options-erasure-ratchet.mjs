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
  const results = await eslint.lintFiles(targets);
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

  // A missing config block must ABORT, never report clean.
  assert(eslintConfig.some(carriesRule), 'the config must carry the query-options rule');

  if (failures.length > 0) {
    console.error(`✗ self-test (${failures.length} failure(s)):\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ self-test: ${reports.length} reporting shape(s), ${silent.length} silent counterpart(s), ` +
    `grandfathering + test-glob channels proved in both directions, ${cases.length} ratchet case(s).`,
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
  `${Object.keys(nonTest).length} file(s), none new. Every other non-test file under ` +
  `packages/ is covered by \`pnpm lint\`.`,
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
