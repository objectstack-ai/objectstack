import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import {
  derivePreInstallSteps,
  isBuiltinSpecifier,
  parseWorkflowJobs,
  scan,
  staticSpecifiers,
  walkImportGraph,
} from '../check-pre-install-import-graph.mjs';
import { REQUIRED_CONTEXTS } from '../dependabot-merge-gate.mjs';

import { selfTestCases, stripAnsi } from './helpers/child-verdict';

/**
 * objectui#6148 — the gate for the property that lets a gate run pre-install.
 *
 * Eight workflow steps ran a `scripts/` gate before any `pnpm install`, and
 * exactly one of them had a test pinning its import graph to node builtins. The
 * other seven held the property by accident of what they happened to import,
 * and a violation is invisible to `tsc`, to ESLint, to a local run and to the
 * suite — it surfaces only as `ERR_MODULE_NOT_FOUND` in one CI job. For the
 * gates that carry no path filter *precisely so* they see every PR shape, that
 * is a gate which stops running rather than one that fails loudly.
 *
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **the derivation is a derivation** — the population comes from the
 *     workflows, so moving a step across `pnpm install` moves the population. A
 *     gate reporting "13 steps" while reading a constant is the defect it was
 *     written to prevent, and the only way to tell the two apart is to move a
 *     step in a fixture and watch the number follow;
 *  2. **the walk follows the graph** — a package ONE HOP away must be caught
 *     and its chain named, because the assertion this generalises could not see
 *     one;
 *  3. **the floor over the real tree** — every step objectui#6148 measured is
 *     still derived, by workflow and job rather than by count;
 *  4. **the wiring** — a gate nobody runs is indistinguishable from a gate that
 *     passes, so the workflow, the alias and the Dependabot classification are
 *     asserted here rather than trusted by reading;
 *  5. **the header states its population and never counts it** — objectui#8606.
 *     The header sentence describing this run carried a literal population of
 *     workflow files, derived from the same directory the gate derives from,
 *     and it had gone stale by double digits with nothing red in between. This
 *     is the fourth carrier of objectui#7448's document-count pin, and the
 *     first one pointed at this header.
 *
 * Deliberately NOT asserted: the total number of pre-install steps. That number
 * is the gate's own output and moves whenever a workflow does; a hand-copied
 * count here would drift by construction, which is the lesson
 * `lint-workflow.test.ts` records at length.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowDir = path.join(repoRoot, '.github/workflows');
const SCRIPT = 'scripts/check-pre-install-import-graph.mjs';
const WORKFLOW = 'repo-gates.yml';
const CHECK_NAME = 'Pre-Install Import Graph Check';

/** A workflow's YAML with whole-line comments removed — every file here discusses the shapes in prose. */
const withoutComments = (yaml: string): string =>
  yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const readWorkflow = (file: string): string => fs.readFileSync(path.join(workflowDir, file), 'utf8');

// ── 1. the derivation is a derivation ────────────────────────────────────────

describe('the population follows the workflows', () => {
  const fixture = (installStepIndex: number): string => {
    const gate = '      - name: Gate\n        run: node scripts/probe.mjs\n';
    const install = '      - name: Install dependencies\n        run: pnpm install --frozen-lockfile\n';
    const filler = '      - name: Checkout code\n        uses: actions/checkout@v7\n';
    const steps = [filler, gate, filler];
    steps.splice(installStepIndex, 0, install);
    return `on:\n  pull_request:\njobs:\n  probe:\n    steps:\n${steps.join('')}`;
  };

  const derive = (text: string): string[] =>
    derivePreInstallSteps([{ file: 'probe.yml', text }]).map((s: { script: string }) => s.script);

  it('SHRINKS when the install moves above the gate', () => {
    // Install first, gate second: the gate is no longer pre-install.
    expect(derive(fixture(0))).toEqual([]);
  });

  it('GROWS when the install moves below the gate', () => {
    // The same file with the install one place later — nothing else changed.
    expect(derive(fixture(2))).toEqual(['scripts/probe.mjs']);
  });

  it('counts a job that never installs entirely', () => {
    const noInstall = 'jobs:\n  j:\n    steps:\n      - name: Gate\n        run: node scripts/probe.mjs\n';
    expect(derive(noInstall)).toEqual(['scripts/probe.mjs']);
  });

  it('measures the boundary PER JOB, not per file', () => {
    const twoJobs = `jobs:
  installs:
    steps:
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Late
        run: node scripts/late.mjs
  does-not:
    steps:
      - name: Early
        run: node scripts/early.mjs
`;
    expect(derive(twoJobs)).toEqual(['scripts/early.mjs']);
  });

  it('does not read an install out of a shell comment or a quoted argument', () => {
    // The second shape is still in this repository: block scalars carry `#` lines
    // that are shell comments rather than YAML ones. The first — a merge driver
    // whose VALUE is `"pnpm install --no-frozen-lockfile"`, sitting ahead of a
    // job's real install — was formerly `changeset-release.yml`'s, removed with
    // the dead CI half of the lockfile merge driver (objectui#6436, ruled
    // 2026-08-27). ⚠️ No live in-repo instance is left, so this fixture is now the
    // only place that shape is written down; it is kept deliberately, not by
    // oversight. Reading either as an install moves the boundary earlier and
    // silently drops a script out of the population — the shrinking direction,
    // which costs coverage rather than raising a false red. The prose anchor in
    // `scripts/check-pre-install-import-graph.mjs` cites this case by name.
    const tricky = `jobs:
  j:
    steps:
      - name: Configure Git merge driver for pnpm-lock.yaml
        run: |
          # pnpm install --frozen-lockfile
          git config merge.pnpm-merge.driver "pnpm install --no-frozen-lockfile"
      - name: Browsers are not node_modules
        run: pnpm exec playwright install chromium
      - name: Gate
        run: node scripts/probe.mjs
`;
    expect(derive(tricky)).toEqual(['scripts/probe.mjs']);
  });

  it('reads block scalars, and ignores an invocation commented out inside one', () => {
    const block = `jobs:
  j:
    steps:
      - name: Two legs
        run: |
          node scripts/probe.mjs --self-test
          node scripts/probe.mjs
      - name: Commented out
        run: |
          # node scripts/ghost.mjs
          echo done
`;
    // One row per (step, script) — two invocations of one script in one step is
    // one step, not two.
    expect(derive(block)).toEqual(['scripts/probe.mjs']);
  });

  it('parses jobs and steps in order — the index is what "before" means', () => {
    const jobs = parseWorkflowJobs(fixture(2)) as Array<{ id: string; steps: Array<{ name: string }> }>;
    expect(jobs.map((j) => j.id)).toEqual(['probe']);
    expect(jobs[0].steps.map((s) => s.name)).toEqual([
      'Checkout code',
      'Gate',
      'Install dependencies',
      'Checkout code',
    ]);
  });
});

// ── 2. the walk follows the graph ────────────────────────────────────────────

describe('the import-graph walk sees past the entry file', () => {
  const graphOf = (files: Record<string, string>, entry: string) =>
    walkImportGraph(entry, { read: (p: string) => (Object.hasOwn(files, p) ? files[p] : null) }) as {
      modules: string[];
      violations: Array<{ chain: string[]; specifier: string }>;
      unresolved: Array<{ chain: string[]; specifier: string }>;
    };

  it('catches a package ONE HOP away and names the chain', () => {
    // The control objectui#6148 hands this gate: `import ts from 'typescript'`
    // in `scripts/invoked-as.mjs` is invisible to any check that reads only the
    // entry's own import lines, and every pre-install script imports it.
    const graph = graphOf(
      {
        'scripts/gate.mjs': "import { isEntrypoint } from './invoked-as.mjs';\n",
        'scripts/invoked-as.mjs': "import ts from 'typescript';\nexport const isEntrypoint = ts;\n",
      },
      'scripts/gate.mjs',
    );
    expect(graph.violations).toHaveLength(1);
    expect(graph.violations[0].specifier).toBe('typescript');
    expect(graph.violations[0].chain.join(' -> ')).toBe(
      'scripts/gate.mjs -> scripts/invoked-as.mjs -> typescript',
    );
  });

  it('accepts a bare builtin, which the narrower predicate called a violation', () => {
    // `check-changeset-fixed.mjs` and `check-type-check-coverage.mjs` really do
    // spell theirs `from "fs"`. That is install-free, so requiring the `node:`
    // prefix would be a style rule wearing a gate's clothes.
    expect(isBuiltinSpecifier('fs')).toBe(true);
    expect(isBuiltinSpecifier('node:fs')).toBe(true);
    expect(isBuiltinSpecifier('typescript')).toBe(false);
    expect(graphOf({ 'scripts/a.mjs': 'import { readFileSync } from "fs";\n' }, 'scripts/a.mjs').violations).toEqual(
      [],
    );
  });

  it('reads an import in a comment or a string literal as prose, not as code', () => {
    // `check-entry-guard.mjs` carries `'require("fs").writeFileSync(…)'` inside
    // a corpus string, and the gate's own self-test spells a `typescript` import
    // inside a fixture. A scan that counted either would invent findings.
    const source = [
      "import { readFileSync } from 'node:fs';",
      "// import ts from 'typescript';",
      'const FIXTURE = "import ts from \'typescript\';";',
      'export const x = [readFileSync, FIXTURE];',
    ].join('\n');
    expect(staticSpecifiers(source)).toEqual(['node:fs']);
  });

  it('reports a relative import that resolves to nothing instead of walking past it', () => {
    const graph = graphOf({ 'scripts/a.mjs': "import './gone.mjs';\n" }, 'scripts/a.mjs');
    expect(graph.unresolved.map((u) => u.specifier)).toEqual(['./gone.mjs']);
  });

  it('terminates on a cycle', () => {
    const graph = graphOf(
      { 'scripts/a.mjs': "import './b.mjs';\n", 'scripts/b.mjs': "import './a.mjs';\n" },
      'scripts/a.mjs',
    );
    expect(graph.modules.sort()).toEqual(['scripts/a.mjs', 'scripts/b.mjs']);
  });
});

// ── 3. the floor over the real tree ──────────────────────────────────────────

describe('the real tree — every step objectui#6148 measured is still derived', () => {
  const result = scan(repoRoot) as {
    steps: Array<{ workflow: string; job: string; script: string }>;
    scripts: string[];
    modules: string[];
    findings: Array<{ script: string; chain: string[]; kind: string }>;
  };
  const rows = new Set(result.steps.map((s) => `${s.workflow} : ${s.job} -> ${s.script}`));

  /**
   * The table objectui#6148 measured, plus `lint.yml`'s entry-guard step, which
   * the card named separately. A FLOOR, not an inventory: the assertion is that
   * none of these silently leaves the population. The gate's own `--list` is
   * where the current total lives, and pinning a total here would drift.
   */
  const MEASURED = [
    'changeset-guard.yml : no-major -> scripts/check-changeset-no-major.mjs',
    'changeset-presence.yml : changeset-presence -> scripts/check-changeset-presence.mjs',
    'ci.yml : changeset-check -> scripts/check-changeset-fixed.mjs',
    'ci.yml : type-check -> scripts/check-type-check-coverage.mjs',
    // objectui#12214 folded these four (and eleven more) into `repo-gates.yml`,
    // ahead of that job's install step, so they stay in the population.
    'repo-gates.yml : repo-gates -> scripts/check-control-bytes.mjs',
    'repo-gates.yml : repo-gates -> scripts/check-doc-component-types.mjs',
    'repo-gates.yml : repo-gates -> scripts/check-doc-links.mjs',
    'repo-gates.yml : repo-gates -> scripts/check-skills-paths.mjs',
    'lint.yml : lint -> scripts/check-entry-guard.mjs',
  ];

  it.each(MEASURED)('still derives %s', (row) => {
    expect([...rows], `the population no longer contains this step — was it moved below an install?`).toContain(row);
  });

  it('walks every pre-install script it derived, and reaches past the entries', () => {
    // The walk is only worth anything if it follows relative edges: since
    // objectui#6092 these scripts share `scripts/invoked-as.mjs`, which is
    // reached by no workflow step directly.
    expect(result.modules).toContain('scripts/invoked-as.mjs');
    expect(result.modules.length).toBeGreaterThan(result.scripts.length);
  });

  it('is in its own population — the gate walks its own import graph', () => {
    // A floor that exempted its own enforcer would be the first thing to rot.
    expect(result.scripts).toContain(SCRIPT);
  });

  it('finds no pre-install gate reaching a package', () => {
    expect(
      result.findings.map((f) => `${f.kind}: ${f.chain.join(' -> ')}`),
      'a script this repository runs before `pnpm install` needs `node_modules` to load',
    ).toEqual([]);
  });
});

// ── 4. the wiring ────────────────────────────────────────────────────────────

describe('the gate is wired, not merely present', () => {
  const yaml = withoutComments(readWorkflow(WORKFLOW));

  it('exists, with a package.json alias that names the same file', () => {
    expect(fs.existsSync(path.join(repoRoot, SCRIPT))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:pre-install-import-graph']).toContain(SCRIPT);
  });

  it('runs both legs — the self-test first, then the scan', () => {
    expect(yaml).toContain(`node ${SCRIPT} --self-test`);
    expect(yaml.split('\n').some((l) => l.trim() === `node ${SCRIPT}`)).toBe(true);
  });

  it('runs before its job installs anything, which is the property it exists to protect', () => {
    // Since objectui#12214 the home is `repo-gates.yml`, one job that installs
    // AFTER its install-free gates; this gate must stay on the near side.
    const gateAt = yaml.indexOf(`node ${SCRIPT} --self-test`);
    const installAt = yaml.indexOf('pnpm install');
    expect(gateAt).toBeGreaterThan(-1);
    expect(installAt === -1 || gateAt < installAt, 'the gate step moved below the install step').toBe(true);
  });

  it('carries NO path filter of any kind', () => {
    // Deliberate: its input is the workflows themselves, and a workflow edit is
    // the change most likely to break it. A filter would also make the check
    // unrequirable (objectui#3523).
    expect(yaml).not.toMatch(/paths-ignore:/);
    expect(yaml).not.toMatch(/^\s+paths:/m);
  });

  it('subscribes merge_group, so a queue build is not stalled by a silent context', () => {
    expect(yaml).toMatch(/^\s{2}merge_group:/m);
  });

  it('is the only workflow that runs it — one gate, one home', () => {
    const runners = fs
      .readdirSync(workflowDir)
      .filter((f) => f.endsWith('.yml'))
      .filter((f) => withoutComments(readWorkflow(f)).includes(SCRIPT));
    expect(runners).toEqual([WORKFLOW]);
  });

  it('is classified by the Dependabot merge gate as a blocking check', () => {
    // objectui#6135: an UNCLASSIFIED blocking check is one a Dependabot merge
    // would be let past. `dependabot-merge-gate.test.ts` asserts the partition
    // itself; this asserts the direction that matters for this check.
    // Since objectui#12214 it reports as a step of the one `Repo Gates` context.
    expect(REQUIRED_CONTEXTS).toContain('Repo Gates');
  });

  it('names the same check in the workflow as the gate requires', () => {
    expect(yaml).toContain(`name: ${CHECK_NAME}`);
  });

  it('passes its own self-test', () => {
    // A scan whose recogniser is broken reports a clean tree.
    const out = execFileSync('node', [SCRIPT, '--self-test'], { cwd: repoRoot, encoding: 'utf8' });
    // objectui#7897 — the COUNT, not the shape. `\d+ cases pass` is satisfied
    // by `0 cases pass`, so the old spelling passed for a self-test whose case
    // table had gone empty: the outcome it exists to refuse. `selfTestCases`
    // also strips ANSI, the second belt for a child that starts colouring —
    // that is the CI-only direction, and no repo gate colours today.
    expect(stripAnsi(out)).toContain('self-test:');
    expect(stripAnsi(out)).toMatch(/^✓/);
    expect(
      selfTestCases(out, 'check-pre-install-import-graph'),
      'a self-test that ran no cases is not a passing self-test',
    ).toBeGreaterThan(0);
  });
});

// ── 5. the header states its population, and never counts it ─────────────────

/**
 * A numeral that qualifies a document-population noun, as `match: text`.
 *
 * The FOURTH copy of objectui#7448's pin, and the pattern is carried character
 * for character from the three that exist (`check-doc-fence-languages.test.ts`,
 * `check-doc-component-types.test.ts`, `check-links-workflow.test.ts`). WHY it
 * is narrow exactly here — the two intervening words, the negative lookbehind
 * that rules out issue references — is argued at those copies and deliberately
 * not restated.
 *
 * A fresh `RegExp` per call: `lastIndex` on a shared global literal is exactly
 * the kind of state that makes the second caller in a run measure something
 * different from the first.
 */
const POPULATION_COUNT =
  /(?<![#\w.])\d+(?:,\d{3})*\s+(?:[A-Za-z][\w-]*\s+){0,2}`?(?:\.mdx|\.md|documents?|pages?|docs?|files?)\b/i;

const documentCounts = (text: string): string[] =>
  [...text.matchAll(new RegExp(POPULATION_COUNT.source, 'gi'))].map((m) => m[0].replace(/\s+/g, ' ').trim());

/**
 * The workflow header's comment prose, as the count pin reads it.
 *
 * Stripped, not kept: a sentence that wraps across two comment lines has a `#`
 * sitting in the middle of it, and a scan that reads the raw lines cannot see a
 * numeral and the noun it qualifies as adjacent when the line break falls
 * between them. Removing the marker is what makes the count pin below read the
 * header the way a person does.
 *
 * That paragraph is carried verbatim from the three copies that already run it,
 * and THIS header is the instance it was written about. Two independent things
 * had to be true for objectui#7448's family to miss the count here, and both
 * were: no pin read this header, AND the count wrapped a comment line, so a
 * per-line unit could not have seen it even if one had. The `extractionControl`
 * fixture below is that second half written down as a test rather than as
 * prose, so the unit cannot quietly drift back — the same subtlety
 * objectui#8629's thread measured from the documentation end, where the pin
 * carriers were found to run their pattern over JOINED text rather than per
 * line, which is why `\s+` in the pattern above spans the line break at all.
 */
const headerComments = (yaml: string): string =>
  yaml
    .split('\n')
    .filter((line) => /^\s*#/.test(line))
    .map((line) => line.replace(/^\s*#\s?/, ''))
    .join('\n');

/** The same extraction with the marker LEFT IN — the blind unit, kept only as a control. */
const headerCommentsKeepingMarkers = (yaml: string): string =>
  yaml
    .split('\n')
    .filter((line) => /^\s*#/.test(line))
    .join('\n');

/**
 * The floor the extracted prose must clear before an empty count list means
 * anything, carried from the three existing copies.
 *
 * Why a floor at all: `documentCounts('')` is `[]`. A header this extraction has
 * stopped reading — the workflow renamed or deleted, its comment markers
 * changed, the path moved — therefore satisfies the pin perfectly, and the pin
 * reports a clean surface it never read. The floor is what makes "no counts
 * here" a reading rather than the absence of one.
 */
const MIN_HEADER_PROSE = 400;

/**
 * This file's own leading block comment — the second surface the count pin reads.
 *
 * objectui#7825 found the drifted counts in a workflow header duplicated, word
 * for word, in the header of the very file that pins it. One of the two copies
 * being guarded and the other not is how the guarded one gets "corrected" from
 * the stale twin later, so both are read here.
 */
function ownHeaderComment(): string {
  const source = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const block = /\/\*\*[\s\S]*?\*\//.exec(source);
  expect(block, "this file's own leading block comment is gone").not.toBeNull();
  return block![0];
}

/**
 * The directory the gate derives its population from, read OUT OF THE GATE.
 *
 * Derived, not copied: spelling the path here would make this file a second
 * copy of the gate's own declaration, free to drift from it — which is the
 * class of defect this whole section exists to close. Move `WORKFLOW_DIR` and
 * this goes red the same day instead of pointing at a directory nobody reads.
 */
function derivedPopulationDir(): string {
  const source = fs.readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
  const match = /\bWORKFLOW_DIR\s*=\s*'([^']+)'/.exec(source);
  expect(match, `${SCRIPT} no longer declares a WORKFLOW_DIR to derive the population from`).not.toBeNull();
  return match![1];
}

describe("the header's population is a pointer, not a copy", () => {
  /**
   * objectui#8606 — the header said the run covered a literal number of
   * workflow files, and `scripts/check-pre-install-import-graph.mjs` DERIVES
   * that population from the same directory, so the two are the same
   * measurement written twice. Only one of them was live. It had drifted by
   * double digits and drifted again between the card being filed and the fix
   * landing, which is the whole argument for not writing the second copy at
   * all.
   *
   * ⛔ Correcting the numeral would only have reloaded the trap — this family
   * has already spent two hand-corrections elsewhere making exactly that point
   * (objectui#7837, objectui#7978). The header names the directory and the
   * command that prints the reading; the rule pinned below is that no number
   * may be written back that adding a workflow would falsify.
   *
   * Only the negative half is asserted about counts, as in all three existing
   * copies: a positive assertion about the wording would pin prose. The one
   * positive claim made here is that the pin READ something — an empty scan is
   * the failure mode this gate family exists to catch.
   */
  it('states no count that adding a workflow would falsify', () => {
    const surfaces = [
      [WORKFLOW, headerComments(readWorkflow(WORKFLOW))],
      ["this test file's own header", ownHeaderComment()],
    ] as const;

    for (const [label, prose] of surfaces) {
      expect(
        prose.length,
        `${label}: the prose this pin reads came back empty or near-empty, so it asserted over nothing`,
      ).toBeGreaterThan(MIN_HEADER_PROSE);

      const counts = documentCounts(prose);
      expect(
        counts,
        `${label} states a population count (${counts.join(', ')}). Nothing fails when it drifts, so it ` +
          'will. Name the population — which directory, which files — or point at the live reading ' +
          '(`--list`), instead of copying a number into a comment (objectui#7448, objectui#8606).',
      ).toEqual([]);
    }
  });

  it('names the directory the gate actually derives the population from', () => {
    // The measurement point, asserted as a path rather than as a sentence: the
    // header has to say WHERE the population comes from, and that "where" is
    // read out of the gate. A header that stops naming it leaves the reader
    // with no way to take the reading, which is the state this card found.
    const dir = derivedPopulationDir();
    const prose = headerComments(readWorkflow(WORKFLOW));
    expect(prose, `${WORKFLOW}'s header must name \`${dir}\` — the population's one live source`).toContain(dir);

    // …and the pointer must point at something. A named directory that holds no
    // workflows is a measurement point in form only.
    const present = fs.readdirSync(path.join(repoRoot, dir)).filter((f) => /\.ya?ml$/.test(f));
    expect(present.length, `${dir} holds no workflow files — the pointer above resolves to nothing`).toBeGreaterThan(0);
    expect(present).toContain(WORKFLOW);
  });

  /**
   * The unit control, and the reason this pin is not a per-line scan.
   *
   * The fixture is this header's own pre-fix sentence, verbatim, wrapping across
   * two comment lines exactly as it did. Under the marker-KEEPING extraction the
   * pattern reads nothing at all — the `#` lands between the numeral and its
   * noun and the pattern's own negative lookbehind rules the marker out. Under
   * the stripping extraction it reads the count. Both legs are asserted, so
   * "clean" can never again mean "unreadable".
   */
  it('reads a count that wraps a comment line — the unit is stripped prose, not raw lines', () => {
    const wrapped = ['# a checkout plus one `node` call over 24', '# workflow files and a dozen scripts'].join('\n');

    expect(
      documentCounts(headerCommentsKeepingMarkers(wrapped)),
      'the marker-keeping unit is blind to a wrapped count — that is why it is not the unit here',
    ).toEqual([]);
    expect(
      documentCounts(headerComments(wrapped)),
      'the stripping unit must see the count this header actually carried',
    ).toEqual(['24 workflow files']);
  });

  /**
   * The positive control for the pin. A pin that cannot fail is not a pin, and
   * this repository has shipped one with zero demonstrated power before
   * (objectui#7466), so the shapes that actually rotted are fixtured as
   * POSITIVES rather than trusted to a reading of the regex. The negatives are
   * every number a workflow header of this shape legitimately carries.
   */
  it('fires on the shapes that rotted, and on none of the numbers this header may keep', () => {
    const rotted = [
      'a checkout plus one `node` call over 24 workflow files and a dozen scripts',
      'the same 35 workflow files the gate derives from',
      'one `node` call over 36 files, well under a second',
      '184 pages (144 `.mdx` + 40 `.md`)',
      'roughly 1,204 markdown files under the two trees',
    ];
    for (const line of rotted) {
      expect(documentCounts(line), `the pin must fire on: ${line}`).not.toEqual([]);
    }

    const legitimate = [
      'an unclassified blocking check is one a Dependabot merge would be let past (objectui#6135)',
      'Merge queue (objectui#3523 — see `ci.yml`s trigger block for the full note)',
      'stalls the queue until the rulesets 60-minute timeout fails it',
      'uses: actions/checkout@v7',
      'node-version: 22',
      'timeout-minutes: 10',
      'the fourth instance of the same shape in this repository',
      'its whole input is `.github/workflows/**` plus the `scripts/` files those steps name',
    ];
    for (const line of legitimate) {
      expect(documentCounts(line), `the pin must NOT fire on: ${line}`).toEqual([]);
    }
  });
});
