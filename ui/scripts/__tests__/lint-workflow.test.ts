import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#3261: the header comment in `.github/workflows/lint.yml` said
 * `eslint.config.js` sets *three* `object-ui/*` rules to `error` and named the
 * three sources they came from. The config had four. The parenthesised list of
 * sources was short by one for the same reason.
 *
 * Miscounting is the visible symptom, not the defect. That comment is the only
 * written explanation of why `lint.yml` exists at all — it records that those
 * `error` ratchets sat inert for months because the workflow was
 * `workflow_dispatch`-only until #2923. The next person adding an `error`-level
 * rule reads it to decide what this gate covers, and a stale enumeration reads
 * exactly as authoritative as a fresh one: it will tell them their new rule is
 * outside the gate (or inside it) with equal confidence, and be wrong.
 *
 * A hand-copied enumeration drifts by construction; #3212 measured the same
 * page's workflow count at 11 in the doc, 12 in the issue and 13 in reality on
 * a single day. So the comment no longer counts or names anything, and this
 * file is what keeps it that way — plus it pins the two claims the comment
 * still makes, so the prose cannot quietly become fiction:
 *
 *   1. the enumeration does not come back (the #3261 regression itself);
 *   2. `eslint.config.js` really does set `object-ui/*` rules to `error`,
 *      otherwise the comment describes a gate that no longer has anything to
 *      gate;
 *   3. this workflow really does run on pull requests, otherwise those rules
 *      are inert again exactly as they were before #2923 — and the comment
 *      would be describing the bug as history while it is live.
 *
 * Deliberately NOT asserted: that a *list* of the rules somewhere matches the
 * config. Keeping such a list is the thing this issue removed — the generic
 * phrasing ("the rules `eslint.config.js` sets to `error`") is always true, so
 * the only honest list is the config itself.
 *
 * ## The scan surface, and why it is a list (objectui#3279)
 *
 * That sentence existed a third time, verbatim, in the header docblock of
 * `scripts/check-lint-coverage.mjs`: same hand-count, same parenthesised source
 * list, short the same rule. #3261 rewrote only the workflow, so the copy
 * outlived the fix and was found by someone reading the file for an unrelated
 * reason (#3274) rather than by a gate. Every surface in the list is scanned now
 * — the two assertions iterate it — so the next copy fails CI instead of waiting
 * on the next accidental reading. Any future file arguing from the same facts
 * belongs in that list, not in a copy of this test.
 *
 * The count pattern reads each file's explanatory comment only, never the whole
 * file, and for the script that scoping is load-bearing rather than tidiness:
 * its `Known gaps` comment legitimately counts *packages* ("the last two …, 14
 * errors"), which the pattern would otherwise report as a rule count. The
 * rule-name pattern does read the whole file — a rule name anywhere in either
 * file is the same second copy of `eslint.config.js`, wherever it sits.
 *
 * ## The doc page, and the two matcher gaps it exposed (objectui#3782)
 *
 * `content/docs/guide/ci-cd-pipeline.md` argued from the same facts a fourth
 * time. It was the one surface that had never hand-*counted* — its main clause
 * was already the evergreen phrasing — but it closed on a parenthesised source
 * list that named a rule outright. Adding it to `SURFACES` was meant to be one
 * entry; it was not, because both assertions were blind to it as written:
 *
 *   1. **The rule-name check matched only the config's key.** Prose names a
 *      rule the way a sentence does, bare: the page said
 *      `no-dynamic-import-in-test-hook`, never the `object-ui/`-qualified key
 *      the config is written in. Adding the page under that matcher would have
 *      produced a green surface entry sitting over a live enumeration — a gate
 *      that reads exactly as covered as one that works, which is this file's
 *      own defect one level up. Both spellings are matched now.
 *   2. **The count check read `one` as a count.** "every one of those `error`
 *      ratchets was inert" quantifies over whatever the config holds and cannot
 *      drift; it is the page's account of the pre-#2923 inert state, not a
 *      cardinality. Three lookbehinds drop that reading and nothing wider.
 *
 * The reader's "where did these come from" pointer survives as a *link* to
 * `eslint.config.js`, where each rule's ADR/issue sits in the comment beside it.
 * A reference cannot drift out of step with its target; a copy of its contents
 * is the thing that had already gone stale three times.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const read = (relative: string): string => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

/** Repo-relative, so the same string labels the surface in failure messages. */
const WORKFLOW = '.github/workflows/lint.yml';
const COVERAGE_SCRIPT = 'scripts/check-lint-coverage.mjs';
const DOC = 'content/docs/guide/ci-cd-pipeline.md';

const workflow = read(WORKFLOW);
const coverageScript = read(COVERAGE_SCRIPT);
const doc = read(DOC);

type FlatConfigEntry = { rules?: Record<string, unknown>; files?: string[] };

/**
 * The resolved flat config, imported rather than text-scanned: severity is
 * authored four different ways (`'error'`, `2`, `['error', {…}]`, `[2, {…}]`)
 * and the `object-ui/*` rules live in four separate config objects with
 * different `files` scopes. Reading the evaluated array is the only way to get
 * the same answer ESLint would.
 *
 * At module scope, not in `beforeAll` — AGENTS.md's testing discipline, and
 * `object-ui/no-dynamic-import-in-test-hook` mechanically enforces it: the cost
 * of loading typescript-eslint and the local plugin belongs to the import
 * phase, where no test or hook timeout applies.
 */
const eslintConfig = ((await import('../../eslint.config.js')) as { default: FlatConfigEntry[] })
  .default;

const severityOf = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

const objectUiErrorRules = eslintConfig
  .flatMap((entry) => Object.entries(entry?.rules ?? {}))
  .filter(([name, value]) => {
    const severity = severityOf(value);
    return name.startsWith('object-ui/') && (severity === 'error' || severity === 2);
  })
  .map(([name]) => name);

/**
 * The `# …` prose block between `name:` and `on:` — the workflow comment this
 * issue is about. Scoped so the assertions below read the explanation, not the
 * YAML.
 */
function workflowHeaderComment(): string {
  const start = workflow.indexOf('\n#');
  const end = workflow.indexOf('\non:');
  expect(start, `${WORKFLOW} must still carry a header comment above \`on:\``).toBeGreaterThan(-1);
  expect(end, `${WORKFLOW} must still have a top-level \`on:\` block`).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

/**
 * The leading docblock of a `.mjs` script — its equivalent of the workflow's
 * header comment. Scanning from the top of the file is right and not fragile:
 * the file opens with a shebang and then this block, and a block-comment
 * terminator cannot hide inside it — a star followed by a slash would have
 * closed the comment for the JS parser long before this test read it.
 */
function leadingDocblock(source: string, label: string): string {
  const open = source.indexOf('/**');
  expect(open, `${label} must still carry a header docblock`).toBeGreaterThan(-1);
  const close = source.indexOf('*/', open);
  expect(close, `${label}'s header docblock must still be closed`).toBeGreaterThan(open);
  return source.slice(open + '/**'.length, close);
}

/**
 * Comment prose as one continuous line: line-leading comment markers stripped
 * and wrapping undone. Matching the raw block instead would miss the exact
 * sentence that caused #3261 — "sets three" ended a line and "`object-ui/*`
 * rules" began the next one, so any pattern spanning the two has to survive the
 * marker and indent in between (`\n# ` in YAML, a newline plus star in a
 * docblock). Comment prose re-wraps whenever a word is edited, so the
 * assertions below must not depend on where the lines happen to break.
 */
function unwrap(block: string, marker: RegExp): string {
  return block.replace(marker, '').replace(/\s+/g, ' ').trim();
}

/** Markdown prose has no line-leading comment marker to strip. */
const NO_COMMENT_MARKER = /(?!)/g;

/**
 * One `## …` section of a markdown page, from its heading to the next one. The
 * markdown equivalent of the two scoping helpers above, and load-bearing for the
 * same reason: elsewhere on that page `vitest.setup.dom.tsx` "side-effect-imports
 * four `@object-ui/*` packages", a count of *packages* the count pattern would
 * otherwise report as a rule count — exactly the trap the coverage script's
 * `Known gaps` comment sets.
 */
function markdownSection(source: string, heading: string, label: string): string {
  const start = source.indexOf(`\n${heading}\n`);
  expect(start, `${label} must still have a \`${heading}\` section`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1 + heading.length);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * The prose surfaces that argue from the `object-ui/*` error ratchets. Both
 * explain a gate in terms of those rules, so both are held to the same two
 * rules: `text` is the whole file, `prose` only the explanatory comment (the
 * header records why the count pattern may not read the whole file).
 */
type ProseSurface = { label: string; text: string; prose: () => string };

const SURFACES: ProseSurface[] = [
  {
    label: WORKFLOW,
    text: workflow,
    prose: () => unwrap(workflowHeaderComment(), /^[ \t]*#[ \t]?/gm),
  },
  {
    label: COVERAGE_SCRIPT,
    text: coverageScript,
    prose: () => unwrap(leadingDocblock(coverageScript, COVERAGE_SCRIPT), /^[ \t]*\*[ \t]?/gm),
  },
  {
    label: DOC,
    text: doc,
    prose: () => unwrap(markdownSection(doc, '## Lint (`lint.yml`)', DOC), NO_COMMENT_MARKER),
  },
];

/**
 * The `on:` block, from the top-level `on:` key to the next top-level key.
 * Trigger claims have to be read here and not from the whole file, where the
 * word `pull_request` also appears in `concurrency`/`github.ref` expressions.
 */
function onBlock(): string {
  const start = workflow.indexOf('\non:');
  const rest = workflow.slice(start + 1);
  const next = rest.search(/\n[a-z_]+:/);
  return next === -1 ? rest : rest.slice(0, next);
}

for (const surface of SURFACES) {
  describe(`${surface.label} — the object-ui/* ratchet prose (objectui#3261, #3279)`, () => {
    it('never hand-counts the object-ui/* rules again', () => {
      const comment = surface.prose();

      // `three \`object-ui/*\` rules`, `all four ratchets`, `4 object-ui rules`…
      //
      // The lookbehinds drop the quantifier reading of `one`, which asserts no
      // cardinality at all: "every one of those `error` ratchets was inert" is
      // the doc page describing the pre-#2923 state (objectui#3782), and it
      // stays true however many rules there are. Narrow on purpose — "every one
      // of the four ratchets" still fails, on `four`.
      const counted = [
        ...comment.matchAll(
          /(?<!\bevery )(?<!\beach )(?<!\bany )\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b[^.]{0,20}?(`?object-ui|ratchet)/gi,
        ),
      ].map((m) => m[0]);

      expect(
        counted,
        `${surface.label}'s explanatory comment counts the \`object-ui/*\` error rules again:\n` +
          counted.map((c) => `  - ${JSON.stringify(c)}`).join('\n') +
          `\n\nDon't. The count was wrong within weeks last time (objectui#3261: the ` +
          `comment said three, the config had four) and it was still wrong in a second ` +
          `copy months later (objectui#3279). A stale count reads exactly as ` +
          `authoritative as a fresh one to the next person deciding what this gate ` +
          `covers. Say "the \`object-ui/*\` rules \`eslint.config.js\` sets to \`error\`" ` +
          `instead — always true, never maintained. ` +
          `content/docs/guide/ci-cd-pipeline.md phrases it that way for the same reason.`,
      ).toEqual([]);
    });

    it('never enumerates them by name either', () => {
      // Same defect one level down: naming the rules is a list that has to be
      // maintained in lockstep with the config, and nothing makes anyone do it.
      //
      // BOTH spellings count. Prose names a rule bare, without the plugin
      // prefix the config keys it by: ci-cd-pipeline.md wrote
      // `no-dynamic-import-in-test-hook`, never `object-ui/no-dynamic-import-
      // in-test-hook`. Matching only the config key would have added that page
      // to this list and passed on the very enumeration it was added for — a
      // surface entry that gates nothing reads exactly as covered as one that
      // does, which is this issue's own defect wearing a test's clothes
      // (objectui#3782).
      const named = objectUiErrorRules.filter((rule) =>
        [rule, rule.slice(rule.indexOf('/') + 1)].some((spelling) =>
          surface.text.includes(spelling),
        ),
      );

      expect(
        named,
        `${surface.label} names specific \`object-ui/*\` rules:\n` +
          named.map((r) => `  - ${r}`).join('\n') +
          `\n\nThat list is a second copy of eslint.config.js and will drift from it ` +
          `(objectui#3261). This file explains why the gate matters; eslint.config.js ` +
          `is where the rules are, with each rule's own comment giving its ADR/issue — ` +
          `link there instead of copying it.`,
      ).toEqual([]);
    });
  });
}

describe('the premise both comments rest on', () => {
  it("eslint.config.js really does set object-ui/* rules to `error`", () => {
    // Their shared premise. If every ratchet is downgraded or deleted, this
    // fails — which is the moment both comments have to be rewritten rather
    // than left describing a gate with nothing behind it.
    expect(
      objectUiErrorRules,
      `No \`object-ui/*\` rule is set to \`error\` in eslint.config.js, but ${WORKFLOW} ` +
        `and ${COVERAGE_SCRIPT} both build their explanation entirely on the premise ` +
        `that some are. Either a severity was downgraded by accident, or the ratchets ` +
        `are genuinely gone and both comments now need rewriting (objectui#3261, ` +
        `#3279).`,
    ).not.toEqual([]);
  });
});

describe('lint.yml — the trigger claims its header comment still makes', () => {
  it('still runs on pull requests, so those rules are not inert again (#2923)', () => {
    const on = onBlock();

    expect(
      on,
      `lint.yml no longer triggers on \`pull_request\`. That is exactly the state ` +
        `#2923 fixed: every \`object-ui/*\` rule \`eslint.config.js\` sets to \`error\` ` +
        `goes silently inert, because the only thing that runs them on a PR is this ` +
        `workflow. The header comment describes that as history — keep it history.`,
    ).toMatch(/^\s{2}pull_request:/m);
  });

  it('does not skip the TypeScript sources those rules lint', () => {
    // A narrow tripwire, not a glob engine (the repo has no glob matcher at the
    // root, and vendoring one for this would cost more than it protects). The
    // realistic way to un-gate the ratchets without touching the triggers above
    // is adding a TypeScript pattern to the ignore list; today's entries are all
    // markdown, `content/**`, `docs/**` and `.changeset/**`.
    //
    // That list now lives in TWO places and both have to be read, which is the
    // objectui#3523 change: `paths-ignore` stayed on the `push` trigger, but for
    // pull requests it moved INTO the job, as `:(exclude,glob)…` pathspecs in
    // the `Decide whether this change needs a full run` step. Reading only the
    // `on:` block would have gone on passing while a `**/*.ts` exclusion was
    // added to the job — the gate reporting green having linted nothing.
    // `merge-queue-reporting.test.ts` pins the two lists to each other and pins
    // why the trigger may not filter pull requests at all; this one stays on its
    // own question, which is what may be in the list.
    const ignored = [
      ...[...onBlock().matchAll(/^\s*-\s*'([^']+)'/gm)].map((m) => m[1]),
      ...[...workflow.matchAll(/':\(exclude,glob\)([^']+)'/g)].map((m) => m[1]),
    ];

    expect(
      ignored.length,
      'lint.yml must still declare an ignore list — on the `push` trigger, in the job, or both',
    ).toBeGreaterThan(0);

    const swallowsSource = ignored.filter((pattern) => /\.tsx?$/.test(pattern));
    expect(
      swallowsSource,
      `lint.yml skips TypeScript changes:\n` +
        swallowsSource.map((p) => `  - ${p}`).join('\n') +
        `\n\nEvery \`object-ui/*\` rule \`eslint.config.js\` sets to \`error\` only gates ` +
        `a PR because this workflow lints the .ts/.tsx it touches. Excluding them is the ` +
        `pre-#2923 inert state with extra steps — and since objectui#3523 it is the quieter ` +
        `version of it, because the \`Lint\` check still reports, green.`,
    ).toEqual([]);
  });
});
