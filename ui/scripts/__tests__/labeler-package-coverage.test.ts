import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * objectui#7746: `.github/labeler.yml` had no `package: fields` entry, so every PR
 * touching `packages/fields` went unlabelled. Measured on PR #7621 (merged
 * 2026-09-05), which changes `packages/fields/src/index.tsx` and
 * `packages/fields/src/__tests__/datetime-compact-style-7443.test.tsx`: it carries
 * exactly `package: core`, `package: components` and `tests` — no fields label.
 *
 * The path labels are not decoration here: they are how a sweeping seat finds the PRs
 * that touch a package. A package whose PRs never get labelled is a package whose PRs
 * are invisible to any query keyed on `package: *` — and such a query returns a
 * confident, short, wrong answer rather than an error.
 *
 * `fields` was not the only one. Enumerating `packages/*` against the config found
 * **16 of 40** directories drawing no label at all, against a file that named
 * `package: *` for exactly four of them (`core`, `types`, `react`, `components`).
 * Twenty of the remaining directories are `plugin-*`, covered by the `plugin` family,
 * and `data-objectstack` is covered by `data-adapter` — which is why the assertion
 * below is "at least one label", not "a `package: *` label": this config runs three
 * parallel families keyed on directory prefix, and demanding a `package:` entry for a
 * plugin would invent a convention beside the ones the file already has.
 *
 * That is the shape this file exists to stop, and the reason it is a gate rather than a
 * bigger config edit: **nothing reads `.github/labeler.yml` except the action that
 * consumes it.** A missing entry produces no error, no failed run and no diff — only a
 * successful workflow applying a slightly wrong set of labels, which no one has a reason
 * to inspect. A config gap that no gate watches is exactly how this one survived to be
 * found by a human reviewer noticing an odd label set on an unrelated PR.
 *
 * Three directions are pinned, because the config can drift from `packages/` both ways
 * and the workflow can drift out from under both:
 *
 *   1. **Add a package, forget the label.** The #7746 direction.
 *   2. **Delete a package, forget the rule.** The mirror. It was live when this file
 *      landed: the `designer` rule targeted `packages/designer`, whose `package.json`
 *      was deleted in `21396ca4d`, so it had matched nothing since — carried here as a
 *      NAMED exemption while objectui#7771 decided delete-vs-retarget. That card ruled
 *      **delete**: an unmeasured successor relationship (`packages/plugin-designer`)
 *      does not buy a retarget, which would silently change what the `designer` label
 *      means relative to every historical PR carrying it. The rule left the config and
 *      its exemption row left this file, so the direction below is now enforced with no
 *      waiver standing between it and the config. `UNRESOLVABLE_GLOB_EXEMPT` is the one
 *      place that says whether any waiver is outstanding; ⛔ do not restate it here.
 *   3. **Add rules for labels that do not exist yet, then drop the permission that
 *      lets them be created.** See the workflow assertion at the bottom of this file.
 *
 * Deliberately NOT pinned: anything about the repository's live label registry. Labels
 * exist server-side, this test reads the checked-in tree, and a gate that cannot see its
 * subject would be the "declared but never enforced" shape one level up. The registry
 * drifts objectui#7771 records (`plugin: chatbot` registered with no rule, `plugin-view`
 * spelled outside its family's convention) are therefore invisible here, on purpose.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const labelerPath = path.join(repoRoot, '.github/labeler.yml');
const workflowPath = path.join(repoRoot, '.github/workflows/labeler.yml');
const packagesDir = path.join(repoRoot, 'packages');

/**
 * Packages that intentionally draw no `package: *` label, each with the reason.
 *
 * An exemption LIST rather than a rule ("skip private packages") on purpose: the list is
 * reviewable in a diff and forces a sentence per entry, where a rule would silently
 * absorb every future private package — including one that should have been labelled.
 * The same idiom `DOCUMENTATION_EXEMPT` uses in `ci-cd-pipeline-doc.test.ts`.
 *
 * Both entries below are `private: true` and were left out because whether the
 * maintainer WANTS unpublished packages in the `package: *` taxonomy is a question this
 * gate must not answer by itself. Adding either one is a one-line config change plus
 * deleting its row here.
 */
const UNLABELLED_BY_DESIGN = new Map<string, string>([
  [
    'test-support',
    '`@object-ui/test-support` is `private: true` — an internal test helper that is ' +
      'never published, so it has no consumer-facing surface a `package: *` sweep would ' +
      'be looking for.',
  ],
  [
    'vscode-extension',
    'Published as the VS Code extension `object-ui` (`private: true`), not as an ' +
      '`@object-ui/*` npm package — it sits outside the scope the label family names.',
  ],
]);

/**
 * `packages/`-rooted globs allowed to match no existing directory, each with the reason.
 * Empty is the healthy state; an entry here is a live defect with a card, not a waiver.
 */
const UNRESOLVABLE_GLOB_EXEMPT = new Map<string, string>([]);

/**
 * Glob constructs this file models. Anything else makes the test THROW rather than quietly
 * mis-answer: an unmodelled construct would make a real rule read as "matches nothing",
 * which is the same silent-wrong-answer failure the whole file is about. Fail closed —
 * a new glob shape should cost someone a deliberate edit here.
 */
const UNMODELLED_GLOB_SYNTAX = /[?[\]{}()!+@]/;

function globToRegExp(glob: string): RegExp {
  if (UNMODELLED_GLOB_SYNTAX.test(glob)) {
    throw new Error(
      `.github/labeler.yml uses a glob construct this gate does not model: ${glob}\n` +
        'Extend globToRegExp() in this file (and its lit control) before adding it, so ' +
        'the rule is not silently read as matching nothing.',
    );
  }

  let source = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          // `**/` spans zero or more whole path segments.
          source += '(?:[^/]+/)*';
          i += 3;
        } else {
          source += '.*';
          i += 2;
        }
      } else {
        // A single `*` never crosses a path separator.
        source += '[^/]*';
        i += 1;
      }
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

/** Every glob in the config, keyed by the label it draws. */
function readLabelerRules(): Map<string, string[]> {
  const config: unknown = parseYaml(fs.readFileSync(labelerPath, 'utf8'));
  if (config === null || typeof config !== 'object') {
    throw new Error('.github/labeler.yml did not parse to a mapping');
  }

  const rules = new Map<string, string[]>();
  for (const [label, clauses] of Object.entries(config as Record<string, unknown>)) {
    const globs: string[] = [];
    for (const clause of clauses as unknown[]) {
      for (const matchers of Object.values(clause as Record<string, unknown>)) {
        for (const matcher of matchers as unknown[]) {
          for (const value of Object.values(matcher as Record<string, unknown>)) {
            globs.push(...(Array.isArray(value) ? (value as string[]) : [value as string]));
          }
        }
      }
    }
    rules.set(label, globs);
  }
  return rules;
}

/** Directory names under `packages/`, which are the population the labels must cover. */
function readPackageDirs(): string[] {
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const rules = readLabelerRules();
const packageDirs = readPackageDirs();

/**
 * A non-test source file, which is what a package's PRs actually change. Deliberately
 * NOT `README.md` or `package.json`: both are matched by repo-wide rules
 * (`documentation`, `dependencies`), so probing with either would report coverage that
 * the per-package families do not actually provide. The path need not exist on disk —
 * the subject here is the config, not the tree.
 */
function probePathFor(pkg: string): string {
  return `packages/${pkg}/src/index.ts`;
}

function labelsDrawnBy(filePath: string): string[] {
  const drawn: string[] = [];
  for (const [label, globs] of rules) {
    if (globs.some((glob) => globToRegExp(glob).test(filePath))) drawn.push(label);
  }
  return drawn;
}

describe('.github/labeler.yml package coverage', () => {
  /**
   * The lit control. Every "package X draws nothing" reading below is only worth as much
   * as the query that produced it, and a matcher that silently matched nothing would make
   * this whole file pass while asserting the opposite of the truth. `core` is in the
   * config, so it must come back lit — if this fails, no other result here means anything.
   */
  it('draws the expected label for a package that IS in the config (lit control)', () => {
    expect(labelsDrawnBy(probePathFor('core'))).toContain('package: core');
    expect(labelsDrawnBy(probePathFor('plugin-kanban'))).toEqual(
      expect.arrayContaining(['plugin', 'plugin: kanban']),
    );
    expect(labelsDrawnBy(probePathFor('data-objectstack'))).toContain('data-adapter');
    // The negative half of the control: the matcher must not match everything.
    expect(labelsDrawnBy('README.md')).not.toContain('package: core');
  });

  it('gives every package under packages/ at least one label', () => {
    const unlabelled = packageDirs
      .filter((pkg) => !UNLABELLED_BY_DESIGN.has(pkg))
      .filter((pkg) => labelsDrawnBy(probePathFor(pkg)).length === 0);

    expect(
      unlabelled,
      `These packages draw no label at all, so their PRs are invisible to any sweep ` +
        `keyed on \`package: *\` (objectui#7746):\n` +
        unlabelled.map((pkg) => `  - ${pkg}`).join('\n') +
        `\n\nAdd an entry to .github/labeler.yml in the shape the file already uses:\n` +
        `  'package: NAME':\n    - changed-files:\n      - any-glob-to-any-file: 'packages/NAME/**/*'\n` +
        `\nIf the package should NOT be labelled, add it to UNLABELLED_BY_DESIGN in this ` +
        `file with the reason — the exemption is reviewable, skipping the gate is not.`,
    ).toEqual([]);
  });

  it('never keeps a packages/ rule pointing at a directory that does not exist', () => {
    const existing = new Set(packageDirs);
    const dangling: string[] = [];

    for (const [label, globs] of rules) {
      for (const glob of globs) {
        if (!glob.startsWith('packages/')) continue;
        const segment = glob.split('/')[1];
        // `packages/**/README.md` and friends are repo-wide rules, not package rules.
        if (segment === undefined || segment === '**') continue;
        if (UNRESOLVABLE_GLOB_EXEMPT.has(glob)) continue;

        const segmentMatcher = globToRegExp(segment);
        if (![...existing].some((dir) => segmentMatcher.test(dir))) {
          dangling.push(`${label} -> ${glob}`);
        }
      }
    }

    expect(
      dangling,
      `These labeler rules target a directory that no longer exists under packages/, so ` +
        `they can never fire — the mirror of objectui#7746, and just as silent:\n` +
        dangling.map((entry) => `  - ${entry}`).join('\n'),
    ).toEqual([]);
  });

  it('spells each `package: X` label to match the directory its glob targets', () => {
    const mismatched: string[] = [];
    for (const [label, globs] of rules) {
      const named = /^package: (.+)$/.exec(label);
      if (!named) continue;
      const expected = `packages/${named[1]}/**/*`;
      if (!globs.includes(expected)) mismatched.push(`${label} -> ${globs.join(', ')}`);
    }

    expect(
      mismatched,
      `A \`package: X\` label whose glob does not target \`packages/X/**/*\` labels the ` +
        `wrong package, which reads as coverage while pointing somewhere else:\n` +
        mismatched.map((entry) => `  - ${entry}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps both exemption lists honest', () => {
    for (const [pkg, reason] of UNLABELLED_BY_DESIGN) {
      expect(
        packageDirs,
        `UNLABELLED_BY_DESIGN names ${pkg}, which is no longer a directory under packages/ — drop it`,
      ).toContain(pkg);
      expect(
        reason.length,
        `UNLABELLED_BY_DESIGN[${pkg}] must carry a real justification`,
      ).toBeGreaterThan(20);
    }

    const allGlobs = new Set([...rules.values()].flat());
    for (const [glob, reason] of UNRESOLVABLE_GLOB_EXEMPT) {
      expect(
        [...allGlobs],
        `UNRESOLVABLE_GLOB_EXEMPT names ${glob}, which .github/labeler.yml no longer ` +
          `contains — the defect it waives is fixed, so drop the row`,
      ).toContain(glob);
      expect(
        reason.length,
        `UNRESOLVABLE_GLOB_EXEMPT[${glob}] must carry a real justification`,
      ).toBeGreaterThan(20);
    }
  });

  /**
   * objectui#10012: no rule named `content/**`, the published docs site, so a PR that
   * touched only that tree drew no label at all — the package gap above, one tree over.
   *
   * The assertion names `documentation` rather than "at least one label" on purpose. The
   * workflow runs with `sync-labels: true`, and actions/labeler v7's `src/labeler.ts`
   * deletes from the PR's existing labels every label this config names whose globs match
   * nothing (its `else if (syncLabels)` branch) — so `documentation` hung by hand on such a
   * PR comes off on the next push. Drawing some other label would leave that intact.
   *
   * One tree, not a population: whether every top-level tree must draw a label is a
   * decision objectui#10012 left open, and this assertion does not take it.
   *
   * The probe page does not exist, deliberately — as with `probePathFor`, the subject is
   * the config. A real page here would also enrol this file in
   * `scripts/markdown-test-inputs.mjs` as a reader of that page, which it is not.
   */
  it('labels a change to the published docs tree `documentation`', () => {
    expect(labelsDrawnBy('content/docs/guide/labeler-coverage-probe.mdx')).toContain(
      'documentation',
    );
  });

  /**
   * The third direction, and the one with no other witness in the tree.
   *
   * `pull-requests: write` only lets actions/labeler add labels that ALREADY EXIST;
   * creating one it has never seen needs `issues: write` (v7 README "Recommended
   * Permissions", and the error its `src/labeler.ts` raises on a 403). Twelve of the
   * fourteen labels #7746 added did not exist in this repository's registry when the
   * rules landed, and the action applies the whole set in ONE `setLabels` call — so
   * dropping this permission does not degrade to "the new label is missing", it makes
   * the call fail and the PR get NO labels at all.
   *
   * Parsed with the YAML library rather than grepped, so a `permissions:` block that
   * only DISCUSSES `issues: write` in a comment cannot satisfy it.
   */
  it('keeps the labeler workflow able to create labels this config names', () => {
    const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8')) as {
      permissions?: Record<string, string>;
    };

    expect(
      workflow.permissions?.issues,
      `.github/workflows/labeler.yml must grant \`issues: write\`. Without it, the first ` +
        `PR matching a rule whose label is not already in the repository's label registry ` +
        `fails the action's single setLabels call and receives NO labels at all — a ` +
        `regression strictly worse than the objectui#7746 coverage gap this config closed. ` +
        `If the permission is deliberately dropped, every \`package: *\` label named in ` +
        `.github/labeler.yml must first be created in the repository by hand.`,
    ).toBe('write');

    expect(
      workflow.permissions?.['pull-requests'],
      '.github/workflows/labeler.yml must still grant `pull-requests: write` — `issues: write` ' +
        'covers creating a label, not attaching it to a pull request.',
    ).toBe('write');
  });
});
