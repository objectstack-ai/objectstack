import { describe, expect, it } from 'vitest';
import { lockfilePath as workspaceLockfilePath } from '../workspace-root.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// Plain-JS CI helper; its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here — re-adding one
// is itself an error (TS2578). See objectui#3494.
import { stripComments } from '../js-comment-mask.mjs';

/**
 * objectui#3197: `content/docs/guide/ci-cd-pipeline.md` described a bundle-size
 * regime that had not existed for a long time — a 60 KB console budget against a
 * workflow that enforces 350 KB (5.8x off), a `size-check.yml` workflow that has
 * never existed in this repository, and three package-size tiers printed under an
 * **Enforced limits** heading even though the step that emits them compares
 * nothing and never exits non-zero.
 *
 * Prose cannot be trusted to stay in sync with YAML by review alone — the number
 * had already drifted once and would drift again. So the doc is pinned to the
 * workflow here: change `MAX_ENTRY_GZIP_KB` (or the advisory tiers, or the set of
 * workflows the page names) without updating the page and this test fails.
 *
 * The dangerous direction is deliberately covered twice. A doc that *understates*
 * a gate is annoying; a doc that advertises a guardrail the CI does not have is
 * worse than no doc, because people make size decisions believing something will
 * stop them. Hence the last block: if anyone ever makes the size report actually
 * enforce those tiers, this test fails and points at the page that calls them
 * advisory.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const docPath = path.join(repoRoot, 'content/docs/guide/ci-cd-pipeline.md');
const workflowPath = path.join(repoRoot, '.github/workflows/performance-budget.yml');
const workflowDir = path.join(repoRoot, '.github/workflows');

const doc = fs.readFileSync(docPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');

/**
 * The data rows of the markdown table that begins at `fromHeader[0]`, as trimmed
 * cell arrays — separator row skipped, stopping at the first line that is not a
 * table row.
 *
 * ⭐ There is exactly ONE of these on purpose. Three blocks on this page read a
 * markdown table (the lockfile-driver table, `ci.yml`'s job table and the workflow
 * inventory), and two of them had grown their own byte-identical copy of this loop
 * before the inventory needed a third (objectui#8726). Two copies of a reader are
 * two readers, and the next fix would have reached only one of them — the same
 * argument the alias rule below is lifted to module scope for.
 *
 * ⛔ Callers keep their own `indexOf(header)` assertion: each one has a different
 * thing to say about a table that has gone missing, and a shared message would say
 * none of them well.
 */
function markdownTableRows(fromHeader: string): string[][] {
  const rows: string[][] = [];
  for (const line of fromHeader.split('\n').slice(1)) {
    if (!line.startsWith('|')) break;
    if (/^\|[\s|:-]+\|$/.test(line)) continue; // separator
    rows.push(line.split('|').slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}

/**
 * The `Generate package size report` step body, from its `- name:` line up to the
 * next step at the same indentation. Scoping matters: the *budget* step legitimately
 * exits non-zero, and asserting over the whole file would conflate the two.
 */
function sizeReportStep(): string {
  const start = workflow.indexOf('      - name: Generate package size report');
  expect(start, 'the size-report step must still be named "Generate package size report"').toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.indexOf('\n      - name: ');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('ci-cd-pipeline.md — enforced console budget', () => {
  it('quotes the same MAX_ENTRY_GZIP_KB the workflow enforces', () => {
    const fromWorkflow = workflow.match(/^\s*MAX_ENTRY_GZIP_KB=(\d+)\s*$/m)?.[1];
    expect(fromWorkflow, 'MAX_ENTRY_GZIP_KB must still be assigned a literal in the workflow').toBeDefined();

    // The doc row that names the constant — the number lives next to it so the
    // two can never be read apart.
    const docRow = doc.split('\n').find((line) => line.includes('MAX_ENTRY_GZIP_KB') && line.startsWith('|'));
    expect(docRow, 'the doc must have a table row naming MAX_ENTRY_GZIP_KB').toBeDefined();

    const fromDoc = docRow!.match(/\*\*(\d+) KB\*\*/)?.[1];
    expect(
      fromDoc,
      `ci-cd-pipeline.md must state the console entry budget as "**${fromWorkflow} KB**"`,
    ).toBe(fromWorkflow);
  });

  it('does not leave the superseded 60 KB figure anywhere on the page', () => {
    expect(doc).not.toMatch(/\b60 ?KB\b/);
  });
});

describe('ci-cd-pipeline.md — advisory package size tiers', () => {
  // `- ✅ Core packages should be < 50KB gzipped`, ×3.
  const tiersFromWorkflow = [...workflow.matchAll(/should be < (\d+)KB gzipped/g)].map((m) => m[1]);
  // `| Core packages | < 50 KB | **No** — advisory only |`
  const advisoryRows = doc.split('\n').filter((line) => /^\|.*\|\s*<\s*\d+ KB\s*\|/.test(line));

  it('lists the same three tiers the workflow echoes into the report', () => {
    expect(tiersFromWorkflow).toEqual(['50', '100', '150']);
    expect(advisoryRows.map((row) => row.match(/<\s*(\d+) KB/)![1])).toEqual(tiersFromWorkflow);
  });

  it('marks every tier as NOT enforced', () => {
    expect(advisoryRows).toHaveLength(3);
    for (const row of advisoryRows) {
      expect(row, `advisory tier row must say it is not enforced: ${row}`).toMatch(/\*\*No\*\*/);
    }
    expect(doc).toMatch(/### Package size report — advisory, not a gate/);
  });

  it('is telling the truth: the size-report step compares nothing and cannot fail', () => {
    // The inverse pin. If someone turns the tiers into a real gate, this fails —
    // which is the moment the "advisory only" wording above must be rewritten.
    const step = sizeReportStep();
    expect(step).not.toMatch(/\bexit 1\b/);
    expect(step).not.toMatch(/\b(50|100|150)\b\s*\)?\s*(?:\]\]|\))?\s*(?:&&|\|\||;|then)/);
    expect(step).not.toMatch(/-(gt|lt|ge|le)\s/);
  });
});

/**
 * objectui#3212: the forward direction above (every workflow the page names must
 * exist) was pinned by #3197; the reverse was deliberately left out because it
 * would have gone red immediately — `lint.yml`, `cross-repo-issue-closer.yml`
 * and later `changeset-guard.yml` had no section at all. `lint.yml` is a real PR
 * gate, and a contributor reading this page had no way to learn it existed.
 *
 * Only the reverse direction actually stops the drift. Without it, fixing the
 * page fixes one snapshot and guarantees the next workflow repeats the omission
 * silently — `changeset-guard.yml` appearing between #3212 being filed and being
 * fixed is the proof.
 *
 * A *heading* is required, not a passing mention: a filename buried in a table
 * row or an ASCII box is how the page got here. The heading is what makes the
 * workflow findable and forces someone to write down what it does.
 */

/**
 * `filename -> why this workflow must not be documented`. Deliberately empty.
 *
 * A workflow that runs in this repository is a workflow contributors can be
 * blocked by, so "not worth a section" is a claim that has to be made
 * explicitly and reviewed — never by quietly skipping the page. The test below
 * also rejects entries that name a workflow which no longer exists, so the
 * escape hatch cannot rot into a permanent hole.
 */
const DOCUMENTATION_EXEMPT = new Map<string, string>();

describe('ci-cd-pipeline.md — workflow inventory', () => {
  const workflowFiles = new Set(fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml')));

  /** Workflow filenames named in a markdown heading, e.g. `## Lint (\`lint.yml\`)`. */
  const documented = new Set(
    doc
      .split('\n')
      .filter((line) => /^#{1,6}\s/.test(line))
      .flatMap((line) => [...line.matchAll(/([a-z0-9][a-z0-9-]*\.yml)\b/g)].map((m) => m[1])),
  );

  it('gives every workflow in .github/workflows/ its own section', () => {
    const undocumented = [...workflowFiles].filter(
      (f) => !documented.has(f) && !DOCUMENTATION_EXEMPT.has(f),
    );

    expect(
      undocumented,
      `These workflows exist in .github/workflows/ but no heading in ` +
        `content/docs/guide/ci-cd-pipeline.md names them:\n` +
        undocumented.map((f) => `  - ${f}`).join('\n') +
        `\n\nAdd a section to that page — a heading that contains the file name ` +
        `(e.g. "### Hook Self-Tests (\`hook-selftests.yml\`)"), what triggers it, and whether it can ` +
        `block a merge — and a row in the "Workflow Inventory" table. A workflow nobody ` +
        `documented is a check contributors get blocked by without knowing it exists ` +
        `(objectui#3212: \`lint.yml\` gated PRs for months while this page never mentioned it).` +
        `\n\nIf a workflow genuinely must not be documented, add it to DOCUMENTATION_EXEMPT in ` +
        `this file with the reason — the exemption is reviewable, skipping the page is not.`,
    ).toEqual([]);
  });

  /**
   * ── The inventory table, and WHAT A ROW MUST ASSERT (objectui#8726) ─────────
   *
   * The set above is built from `/^#{1,6}\s/` lines — markdown headings only — so
   * until now the "Workflow Inventory" table was read by nothing at all. A workflow
   * satisfied `gives every workflow … its own section` purely by having a heading,
   * while its row could be absent, duplicated, or say the opposite of the truth.
   * Two mutations on the merged tree proved it, both green where they should have
   * been red: deleting `lockfile-integrity.yml`'s row while keeping its `##`
   * section, and rewriting `live-e2e.yml`'s trailing cell back to the stale
   * `continue-on-error` wording objectui#8692 had just removed.
   *
   * ⭐ The second one is why "does the row exist?" is not the whole answer. The page
   * asserts the `continue-on-error` claim about that lane in its structural-claims
   * bullet, and objectui#8084 took the property off the job — so the page could carry
   * a *contradiction with itself*, a corrected bullet beside an uncorrected row, and
   * stay green. Existence alone does not see that.
   *
   * ⭐ So a row must: (1) exist for every non-exempt workflow and name no other,
   * (2) appear exactly once, and (3) make no claim about a YAML property that the
   * workflow it names does not declare. Nothing more.
   *
   * ⛔ Deliberately NOT pinned: whether the free prose of `Runs on` and `Blocks a PR?`
   * is *correct*. Those cells carry real nuance ("every job but the two coverage-lane
   * jobs", "ESLint **errors** only") that no derivation reproduces, and the honest
   * source for a blocking answer is the repository's required-context set, which lives
   * in GitHub's settings and not in this tree. Deriving "Blocks a PR?" from a
   * `merge_group` trigger would be a *false* derivation in the direction that matters:
   * `hook-selftests.yml` declares none and the page rightly answers **Yes**. Pinning
   * more than the page can honestly promise is how a pin becomes the next card, so what
   * (3) checks is the narrow, mechanical thing — a named YAML key the row itself
   * invokes — the same discipline STRUCTURAL_BLOCKS below applies to the bullet.
   *
   * ⭐ The failure message above tells a contributor to add a heading **and a row**.
   * That last clause was advice no assertion enforced. It is enforced here now, so the
   * message and the assertions agree; ⛔ if these are ever retired, the clause goes too.
   */
  const INVENTORY_TABLE_HEADER = '| Workflow file | Appears as | Runs on | Blocks a PR? |';

  /** Inventory rows: the `.yml` the first cell names, and the whole row as text. */
  function inventoryRows(): { file: string; text: string }[] {
    const at = doc.indexOf(INVENTORY_TABLE_HEADER);
    expect(
      at,
      'the "Workflow Inventory" table of content/docs/guide/ci-cd-pipeline.md no longer has the ' +
        `header \`${INVENTORY_TABLE_HEADER}\`. Everything below reads that table through this ` +
        'header, so a renamed or reordered column turns the whole block vacuously green — the ' +
        'exact failure objectui#8726 was filed about. Restore the header, or teach it the new one.',
    ).toBeGreaterThan(-1);

    return markdownTableRows(doc.slice(at)).map((cells) => ({
      file: cells[0].match(/([a-z0-9][a-z0-9-]*\.yml)\b/)?.[1] ?? '',
      text: cells.join(' | '),
    }));
  }

  it('the inventory table parse is live — a zero-row read is a broken reader, not an empty table', () => {
    // The control every count below rests on. A header that stopped matching, a
    // table converted to a list, or a separator regex that swallowed the rows would
    // make "no row is missing" true by comparing nothing at all (objectui#6436).
    const rows = inventoryRows();
    expect(
      rows.length,
      'the "Workflow Inventory" table parsed to implausibly few rows. This repository has ' +
        'dozens of workflows and each is supposed to have one; a handful means the reader ' +
        'broke, not that the page shrank.',
    ).toBeGreaterThan(5);

    expect(
      rows.filter((r) => r.file === '').map((r) => r.text),
      'these inventory rows have no `NAME.yml` in their first cell, so nothing below can ' +
        'match them to a workflow. The first column is the join key — write the file name ' +
        'there, in backticks.',
    ).toEqual([]);
  });

  it('gives every workflow in .github/workflows/ a row in the inventory table — in both directions', () => {
    const listed = inventoryRows().map((r) => r.file);

    const missing = [...workflowFiles].filter(
      (f) => !listed.includes(f) && !DOCUMENTATION_EXEMPT.has(f),
    );
    expect(
      missing,
      `These workflows exist in .github/workflows/ and have a section on ` +
        `content/docs/guide/ci-cd-pipeline.md, but no row in its "Workflow Inventory" table:\n` +
        missing.map((f) => `  - ${f}`).join('\n') +
        `\n\nAdd the row — file name, the name it appears under in the checks list, what it runs ` +
        `on, and whether it can block a PR. ⭐ The table is the only place a contributor can see ` +
        `the whole set at once; a workflow present in the prose but missing from it reads as one ` +
        `that does not exist (objectui#8726: a merge conflict resolution that dropped a row would ` +
        `have been invisible to this suite).` +
        `\n\nIf the workflow genuinely must not be documented, add it to DOCUMENTATION_EXEMPT in ` +
        `this file with the reason — it then needs neither a section nor a row.`,
    ).toEqual([]);

    // The phantom direction overlaps the whole-page scan in `never names a workflow
    // file that does not exist`; it is kept row-scoped because the message a reader
    // needs here names the row to delete, not a filename somewhere on the page.
    const phantom = listed.filter((f) => f !== '' && !workflowFiles.has(f));
    expect(
      phantom,
      `the "Workflow Inventory" table has rows for workflows that are NOT in ` +
        `.github/workflows/:\n` +
        phantom.map((f) => `  - ${f}`).join('\n') +
        `\n\nDelete the row. A table that advertises a workflow the repository does not run is ` +
        `worse than no table — objectui#3451 measured that exact rot on this page's job table.`,
    ).toEqual([]);
  });

  it('names each workflow in exactly one inventory row', () => {
    const listed = inventoryRows().map((r) => r.file).filter(Boolean);
    const duplicated = [...new Set(listed.filter((f, i) => listed.indexOf(f) !== i))];

    expect(
      duplicated,
      `these workflows have more than one row in the "Workflow Inventory" table:\n` +
        duplicated.map((f) => `  - ${f}`).join('\n') +
        `\n\nTwo rows for one workflow are two answers to "can it block a PR?", and the set ` +
        `comparison above cannot tell them apart — it is satisfied by either. A duplicate is how ` +
        `a conflict resolution that kept both sides survives review (objectui#8726).`,
    ).toEqual([]);
  });

  /**
   * (3), the claim half. A row that INVOKES a YAML key is making an assertion about
   * the workflow it names, and that assertion is readable out of the YAML. A row that
   * invokes none is asked for nothing — these two cases are dormant by design, and the
   * control each carries is what keeps a dormant pin from being an unfalsifiable one.
   */
  it('makes no `continue-on-error` claim the workflow YAML does not carry', () => {
    const jobLevel = (file: string) =>
      withoutComments(readWorkflow(file))
        .split('\n')
        .filter((line) => /^ {4}continue-on-error\s*:/.test(line));

    // Control. Zero job-level declarations is the whole repository's state today
    // (objectui#8084 removed the last one), so "no workflow carries it" has to be a
    // reading rather than a broken grep: the same scan one indent deeper must still
    // find the step-level flags on the cache saves, which are a different thing and stay.
    const stepLevelAnywhere = [...workflowFiles].filter((f) =>
      /^ {5,}continue-on-error\s*:/m.test(withoutComments(readWorkflow(f))),
    );
    expect(
      stepLevelAnywhere,
      'the indent-scoped `continue-on-error` scan matched NO workflow at any depth, but the ' +
        'cache-save steps declare it. The directory listing, the file reads or the regex is ' +
        'broken — and until it is fixed, "no job declares continue-on-error" is not a ' +
        'measurement (objectui#6436).',
    ).not.toEqual([]);

    const unsupported = inventoryRows()
      .filter((r) => r.file !== '' && workflowFiles.has(r.file))
      .filter((r) => r.text.includes('continue-on-error') && jobLevel(r.file).length === 0);

    expect(
      unsupported.map((r) => r.file),
      `these "Workflow Inventory" rows invoke \`continue-on-error\` to explain their lane, but ` +
        `the job in the workflow they name declares no such key:\n` +
        unsupported.map((r) => `  - ${r.file} — "${r.text.slice(0, 120)}…"`).join('\n') +
        `\n\n⭐ This is the drift objectui#8726 was filed for. objectui#8084 took the flag off ` +
        `\`live-e2e\` because it made the run conclusion disagree with the job, objectui#8692 ` +
        `removed the wording from this table, and the page's structural-claims bullet is pinned ` +
        `to the property below — so a row that says it again puts the page in contradiction with ` +
        `itself while every other test stays green. Say what the lane actually is (not in the ` +
        `required-check set, no \`merge_group\` trigger), or restore the key in the YAML and ` +
        `argue for it there. NOTE step-level \`continue-on-error:\` on a cache save is a ` +
        `different thing and is not what this row would be describing.`,
    ).toEqual([]);
  });

  it('makes no `merge_group` claim the workflow YAML contradicts', () => {
    const declaresMergeGroup = (file: string) =>
      /^\s{2}merge_group\s*:/m.test(withoutComments(readWorkflow(file)));

    // Control: the trigger scan must still see the workflows that do subscribe, or
    // "this one declares none" is a claim about a grep and not about the YAML.
    expect(
      [...workflowFiles].filter(declaresMergeGroup),
      'the `merge_group` trigger scan matched NO workflow, but `ci.yml` and `lint.yml` are ' +
        'queue-build subscribers. Nothing below is a reading until that is fixed (objectui#6436).',
    ).not.toEqual([]);

    const contradicting = inventoryRows()
      .filter((r) => r.file !== '' && workflowFiles.has(r.file))
      .filter((r) => /no\s+`merge_group`/.test(r.text) && declaresMergeGroup(r.file));

    expect(
      contradicting.map((r) => r.file),
      `these "Workflow Inventory" rows say their workflow declares no \`merge_group\` trigger, ` +
        `but it does:\n` +
        contradicting.map((r) => `  - ${r.file}`).join('\n') +
        `\n\nA workflow that subscribes to \`merge_group\` produces a context on queue builds and ` +
        `so CAN be required — which is the opposite of what the row tells a reader deciding ` +
        `whether to wait for it. Update the cell, or drop the trigger.`,
    ).toEqual([]);
  });

  it('keeps the documentation exemption list honest', () => {
    for (const [name, reason] of DOCUMENTATION_EXEMPT) {
      expect(workflowFiles, `DOCUMENTATION_EXEMPT names ${name}, which no longer exists — drop it`).toContain(name);
      expect(reason.length, `DOCUMENTATION_EXEMPT[${name}] must carry a real justification`).toBeGreaterThan(20);
    }
  });

  it('never names a workflow file that does not exist', () => {
    // Fenced blocks are excluded: they hold YAML samples for workflows that do
    // not exist yet ("Adding a New Workflow") and, until #3212, an ASCII overview
    // box that wrapped filenames across lines (`performance-` / `budget.yml`),
    // which no filename scan can read.
    const prose = doc.replace(/```[\s\S]*?```/g, '');
    // Skip path-qualified mentions (`.github/labeler.yml` is the labeler *config*,
    // not the workflow of the same name).
    const named = new Set([...prose.matchAll(/(?<![\w/.-])([a-z0-9][a-z0-9-]*\.yml)\b/g)].map((m) => m[1]));

    expect(named.size).toBeGreaterThan(5);
    for (const name of named) {
      expect(workflowFiles, `ci-cd-pipeline.md documents ${name}, which is not in .github/workflows/`).toContain(name);
    }
  });

  /**
   * objectui#3724: this page was not the only workflow inventory. `.github/WORKFLOWS.md`
   * held a second one — hand-maintained, linked from nowhere, and pinned by nothing —
   * which had drifted to documenting 5 workflows that did not exist (including a
   * changeset gate skippable with a `skip-changeset` label; neither the workflow nor the
   * label was ever real) while omitting 9 that did, `lint.yml` among them. That is #3212
   * verbatim, on a page no test could see.
   *
   * A duplicate inventory is a drift generator by construction: the pins above make *this*
   * page track `.github/workflows/` in both directions, and a second copy inherits none of
   * that while reading just as authoritative. So the resolution was deletion, not a second
   * ratchet, and this asserts the deletion holds.
   *
   * Scope, stated so it is not mistaken for more: it pins the one path that existed. A new
   * inventory under a different name evades it — the durable protection is that adding a
   * workflow already forces an edit *here*, so a second page earns nothing.
   */
  it('keeps this page as the only workflow inventory', () => {
    expect(
      fs.existsSync(path.join(repoRoot, '.github/WORKFLOWS.md')),
      '`.github/WORKFLOWS.md` is back. It was deleted by objectui#3724 because an unpinned ' +
        'second copy of the workflow inventory drifts to 5 phantom workflows and 9 omissions ' +
        'while nothing checks it. Document workflows in content/docs/guide/ci-cd-pipeline.md, ' +
        'which the tests in this file hold to `.github/workflows/` in both directions.',
    ).toBe(false);
  });

  it('does not resurrect the never-existent size-check.yml', () => {
    // Checked over the whole file, fences included — the stale claim lived in the
    // ASCII overview box as well as in its own section. (The page may still say
    // the words "size-check" while denying that such a workflow exists; what it
    // must never do again is name the file.)
    expect(doc).not.toMatch(/size-check\.yml/);
    expect(workflowFiles).not.toContain('size-check.yml');
  });

  /**
   * objectui#4912: `skip-changeset` is the other phantom that deleted page left behind, and
   * unlike `size-check.yml` it did not stay dead. The label *object* was re-minted in this
   * repository's label set — GitHub creates a label the first time one is applied by name, so
   * one API call that applies it is enough — and by 2026-08-25 it sat on seven pull requests,
   * carrying the default grey `ededed` and the empty description that tell an auto-minted
   * label apart from a curated one. It is now actively read as a mechanism: a triage comment
   * on objectui#6243 instructed a PR to carry it, the developer refused on the grounds
   * recorded above, and the refusal was upheld on PR #6260. That is the exact harm #4912
   * predicted, arriving after the card was filed.
   *
   * ⭐ The object was deleted under #4912 on 2026-09-09, once its stated precondition — that
   * no open PR carried it — had been measured. ⛔ That does not retire these two pins, and
   * they must not be read as obsolete: one API call that applies the name mints the label
   * again, and the instruction to apply it still reaches agents from the `objectstack`
   * sibling, so its absence is a moment and not a state this repository can hold.
   *
   * ⛔ What these two cases can and cannot see, said plainly because the boundary is the whole
   * design of this file: **a label lives in GitHub's data, not in the tree, so nothing here
   * can assert the label object is gone.** Deleting it is an administrative act, and a test
   * that reached for the labels API would put a network call and a credential in a suite that
   * deliberately has neither. The pins below are therefore not restatements of "the label does
   * nothing" — that needs no pin. They hold the two things that *are* ours and that a future
   * commit could change without anyone noticing.
   */
  it('never wires the phantom `skip-changeset` label into a workflow or a gate', () => {
    // Option B of #4912 — give the changeset gates a labelled skip path — was declined by
    // #3724 and again by the #4912 ruling: the presence gate has no bypass by design, and its
    // exemption is an empty-frontmatter changeset, which lives in the repo where the next
    // reader finds it rather than in a label that vanishes from history. So a read of this
    // name appearing under `.github/` or `scripts/` is that declined option landing without a
    // decision. The name IS wired in the `objectstack` sibling (lint.yml, pr-automation.yml,
    // check-empty-changeset.mjs), which is how it reaches agents who then look for it here —
    // copying that wiring across is precisely what this catches.
    const selfPath = path.resolve(fileURLToPath(import.meta.url));
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.turbo') continue;
          scan(full);
        } else if (entry.isFile() && path.resolve(full) !== selfPath) {
          // This file is the one legitimate mention: it records the history above.
          if (fs.readFileSync(full, 'utf8').includes('skip-changeset')) {
            offenders.push(path.relative(repoRoot, full));
          }
        }
      }
    }

    for (const root of ['.github', 'scripts']) scan(path.join(repoRoot, root));

    expect(
      offenders.sort(),
      `these files under .github/ or scripts/ mention \`skip-changeset\`:\n` +
        offenders.map((f) => `  - ${f}`).join('\n') +
        `\n\nNo gate in this repository reads that label and none is supposed to. If this is a ` +
        `workflow or script that now honours it, that is objectui#4912 option B — a labelled ` +
        `bypass on a changeset gate that deliberately has none — and it was declined twice ` +
        `(#3724, and the #4912 ruling). Land the decision to reverse those before the code. ` +
        `To declare that a PR publishes nothing, add a changeset with empty frontmatter; that ` +
        `is the mechanism, and it is the one content/docs/guide/ci-cd-pipeline.md documents.`,
    ).toEqual([]);
  });

  it('keeps the page denying `skip-changeset` rather than describing it', () => {
    // `ci-cd-pipeline.md` is where a contributor looks up "how do I declare this PR publishes
    // nothing", so the page is the surface that decides whether the next reader believes the
    // label. Unlike the `size-check.yml` pin, absence is the wrong assertion here: the page
    // has to keep NAMING the label in order to deny it, or the phantom is simply undocumented
    // again. So the denial itself is what gets pinned.
    //
    // Blockquote markers are stripped before matching — the whole passage is a `>` block, and
    // its sentences wrap across lines, so a raw substring search would silently never match
    // and this pin would be vacuously green.
    const prose = doc.replace(/^[ \t]*>[ \t]?/gm, '').replace(/\s+/g, ' ');

    expect(
      prose,
      'content/docs/guide/ci-cd-pipeline.md must keep stating that nothing reads the ' +
        '`skip-changeset` label. The label object was auto-minted in this repository once by ' +
        'being applied, and deleting it (objectui#4912) does not stop one API call from ' +
        'minting it again while agents are still told to use it, so a page that stops ' +
        'denying it leaves the label as the most authoritative-looking answer in reach.',
    ).toContain('no gate in this repository reads it');

    expect(
      prose,
      'the page must keep telling the reader what to do INSTEAD of the label — a denial with ' +
        'no alternative sends them back to the label. The real exemption is a changeset with ' +
        'empty frontmatter.',
    ).toContain('declare an empty changeset instead');

    // The 2026-08-08 labels-API reading this note used to carry ("the label still does not
    // exist") had expired by the time #4912 was worked: the object had been re-minted. A
    // point-in-time API reading is not a fact this repository can keep true, and restating one
    // is how the page came to assert something false about the very phantom it documents.
    expect(
      prose,
      'do not put a point-in-time labels-API reading back on this page. Nothing in the tree ' +
        'can keep it true, and the last one was false within weeks (objectui#4912).',
    ).not.toContain('checked against the labels API');
  });
});

/**
 * objectui#3724: the `pnpm-lock.yaml` merge driver is repository configuration
 * (`.gitattributes`) that only works where something defines the driver, so "which
 * workflows define it" is a claim about three files at once — and it was wrong in both
 * copies that made it. This page named `changeset-release.yml` and
 * `dependabot-auto-merge.yml`; the deleted `.github/WORKFLOWS.md` named
 * `changeset-release.yml` and `changelog.yml`. Each omitted a different third, and both
 * read as complete.
 *
 * The content survived the deletion — the `.gitattributes` half and the add-it-to-a-new-
 * workflow half existed nowhere else — so it moved onto this page. Moving an already-drifted
 * hand-maintained list into unpinned prose would just relocate the drift generator, which is
 * the whole reason #3724 chose deletion over a second copy. Hence this pin: both directions,
 * so a workflow that gains the step without a row is as red as a row whose workflow lost it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * objectui#6436 (ruled 2026-08-27) removed the LAST workflow that configured the driver.
 * `changeset-release.yml` performs no local merge, so its config could never fire; the
 * repository half (`.gitattributes`) and the contributor half (`CONTRIBUTING.md`) were
 * measured live and were kept. The mechanism is now contributor-facing with zero CI
 * consumers.
 *
 * ⭐ THE ANTI-VACUITY WEIGHT MOVED — IT DID NOT VANISH. This block used to open with
 * `expect(configuring.length).toBeGreaterThan(0)`, and that single line was doing two
 * different jobs:
 *
 *   1. proving the grep had matched something, so "no workflow is missing a row" was a
 *      reading rather than an artifact of a scan that read nothing; and
 *   2. proving the mechanism still had a consumer at all — a zero-match grep once let both
 *      directions of this pin go vacuously green, which is why the guard was added.
 *
 * Zero is now the CORRECT answer to that count, so the guard cannot stay as `> 0`. ⛔ But
 * flipping it to `=== 0` and stopping there would delete both jobs and re-install the exact
 * defect this block exists to catch. Each job therefore has a new and explicit owner:
 *
 *   1. → `the workflow scan is live` below. A zero-hit taken with no control is not a
 *      reading. The scan now takes a control term that MUST hit the same population —
 *      `git config`, which `changelog.yml` genuinely runs. If the directory, the read or
 *      the regex ever breaks, the control collapses to zero as well and that test fails,
 *      instead of a broken scan silently agreeing with the expected zero.
 *   2. → `keeps the .gitattributes half of the mechanism true` and `keeps CONTRIBUTING.md's
 *      contributor path — the mechanism's only remaining consumer` below. That is where the
 *      real weight landed: those two files ARE the mechanism now. If either goes, the driver
 *      genuinely has no consumers left and this section should be deleted with it — which is
 *      exactly what the old `> 0` failure message demanded, re-pointed at the consumer that
 *      is actually live.
 *
 * The both-directions pin itself stays, and the PHANTOM direction is now the load-bearing
 * half of it: with zero configuring workflows, `phantom` is precisely "workflows this page
 * still names", so a row that comes back reddens on its own. The `missing` direction is the
 * tripwire for a CI consumer returning.
 */
describe('ci-cd-pipeline.md — lockfile merge driver', () => {
  /** Workflows that actually configure the driver, by grepping for the git config key. */
  function workflowsConfiguringDriver(): string[] {
    return fs
      .readdirSync(workflowDir)
      .filter((f) => f.endsWith('.yml'))
      .filter((f) => /merge\.pnpm-merge/.test(fs.readFileSync(path.join(workflowDir, f), 'utf8')))
      .sort();
  }

  /**
   * The control population: workflows containing a `git config` of any kind. Deliberately a
   * NEAR MISS of the driver key — both are `git config` lines in `.github/workflows/`, read
   * out of the same directory by the same reader — so a scan that can see one can see the
   * other. `changelog.yml` really does run `git config --local user.email`, so zero here
   * means the scan is broken, not that the repository changed.
   */
  function workflowsMatchingControl(): string[] {
    return fs
      .readdirSync(workflowDir)
      .filter((f) => f.endsWith('.yml'))
      .filter((f) => /git config/.test(fs.readFileSync(path.join(workflowDir, f), 'utf8')))
      .sort();
  }

  const DRIVER_TABLE_HEADER = '| Workflow | Why it needs the driver |';

  /**
   * The workflows named in that section's table. Scoped to the table rows on purpose: the
   * surrounding prose names all three again while recounting the drift, and a set built from
   * the whole section would stay green after the table itself was gutted.
   */
  function workflowsNamedInDoc(): string[] {
    const start = doc.indexOf('## Lockfile Merge Driver');
    expect(start, 'the page must keep a "## Lockfile Merge Driver" section').toBeGreaterThan(-1);
    const rest = doc.slice(start + 2);
    const next = rest.search(/^## /m);
    const section = next === -1 ? rest : rest.slice(0, next);

    const at = section.indexOf(DRIVER_TABLE_HEADER);
    expect(at, `that section must keep the table header \`${DRIVER_TABLE_HEADER}\``).toBeGreaterThan(-1);

    const named = new Set<string>();
    for (const cells of markdownTableRows(section.slice(at))) {
      for (const m of cells.join(' | ').matchAll(/([a-z0-9][a-z0-9-]*\.yml)\b/g)) named.add(m[1]);
    }
    return [...named].sort();
  }

  it('the workflow scan is live — zero configuring workflows is a reading, not a broken grep', () => {
    // This test is the replacement for the retired `configuring.length > 0` guard, in its
    // first job only: proving the scan works. It says nothing about whether the driver has a
    // consumer — that question moved to the two `keeps …` tests below.
    const files = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));
    expect(
      files.length,
      `no .yml files were read out of ${workflowDir} at all, so every count this block takes ` +
        'is zero for a reason that has nothing to do with the merge driver',
    ).toBeGreaterThan(0);

    expect(
      workflowsMatchingControl(),
      'the control term `git config` matched NO workflow, but `changelog.yml` runs ' +
        '`git config --local user.email`. The directory listing, the file reads or the regex ' +
        'is broken — and until it is fixed, "zero workflows configure the merge driver" is ' +
        'not a measurement. A zero-hit taken with no control is not a reading (objectui#6436).',
    ).not.toEqual([]);
  });

  it('lists exactly the workflows that configure merge.pnpm-merge — in both directions', () => {
    const configuring = workflowsConfiguringDriver();
    const named = workflowsNamedInDoc();
    const missing = configuring.filter((f) => !named.includes(f));
    const phantom = named.filter((f) => !configuring.includes(f));

    expect(
      missing,
      `these workflows configure the pnpm-lock.yaml merge driver but have no row in the ` +
        `"Lockfile Merge Driver" table of content/docs/guide/ci-cd-pipeline.md:\n` +
        missing.map((f) => `  - ${f}`).join('\n') +
        `\n\nSince objectui#6436 the expected count is ZERO, so this is a CI consumer coming ` +
        `back. Either it genuinely merges on the runner — in which case add its row, saying ` +
        `why it merges — or it is configuring a driver it can never use, which is the dead ` +
        `half that card removed. NOTE the scan greps workflow text, so merely NAMING the ` +
        `config key in a comment trips this; that is the safe direction, but spell the key ` +
        `as the \`merge=pnpm-merge\` attribute in prose to avoid it.`,
    ).toEqual([]);

    expect(
      phantom,
      `the "Lockfile Merge Driver" table names workflows that do NOT configure ` +
        `\`merge.pnpm-merge\`:\n` +
        phantom.map((f) => `  - ${f}`).join('\n') +
        `\n\n⭐ This direction is load-bearing now. With zero configuring workflows, it says ` +
        `exactly "the page names no workflow", so a row that comes back — stale, or copied ` +
        `from the pre-objectui#6436 page — fails here on its own rather than riding along ` +
        `with a count that happened to be non-zero. Either the workflow really configures ` +
        `the driver, or the row goes.`,
    ).toEqual([]);
  });

  it('keeps the .gitattributes half of the mechanism true', () => {
    // ⭐ Load-bearing since objectui#6436: with no workflow configuring the driver, the
    // attribute is the mechanism's only presence IN this repository. It used to be checked
    // because "the workflows would be configuring it for nothing"; there are no workflows to
    // configure it now, so this assertion is no longer a corollary of anything else.
    const attributes = fs.readFileSync(path.join(repoRoot, '.gitattributes'), 'utf8');
    expect(
      attributes,
      '.gitattributes no longer routes pnpm-lock.yaml through the `pnpm-merge` driver. Since ' +
        'objectui#6436 removed the last workflow that configured it, this line is the only ' +
        'thing in the repository that asks for the driver at all — without it the mechanism ' +
        'is gone, contributors who configured the driver silently stop getting it, and the ' +
        '"Lockfile Merge Driver" section of content/docs/guide/ci-cd-pipeline.md describes ' +
        'nothing. Removing it is a decision, not a cleanup: measured, a conflicting merge ' +
        'without this attribute leaves conflict markers INSIDE pnpm-lock.yaml.',
    ).toMatch(/^pnpm-lock\.yaml\s+merge=pnpm-merge\s*$/m);
  });

  it("keeps CONTRIBUTING.md's contributor path — the mechanism's only remaining consumer", () => {
    // ⭐ This is where the retired `configuring.length > 0` guard's SECOND job landed. That
    // guard asked "does anything still consume this driver?" and answered with the workflow
    // count. The workflow count is zero by ruling now, so the question is answered here, at
    // the consumer that was measured live: CONTRIBUTING.md defines the driver locally and
    // then runs a merge that gives it an occasion to fire.
    const contributing = fs.readFileSync(path.join(repoRoot, 'CONTRIBUTING.md'), 'utf8');

    expect(
      contributing,
      'CONTRIBUTING.md no longer tells contributors to define `merge.pnpm-merge.driver`. An ' +
        'attribute names a driver but does not define one, and since objectui#6436 no ' +
        'workflow defines it either — so if this instruction is gone, `.gitattributes:5` ' +
        'selects a driver that exists nowhere and silently falls back to a text merge. At ' +
        'that point the mechanism has zero consumers and the "Lockfile Merge Driver" section ' +
        'of content/docs/guide/ci-cd-pipeline.md, plus the .gitattributes line, should be ' +
        'deleted with it — which is what the retired `configuring.length > 0` guard demanded, ' +
        'pointed at the consumer that is actually live.',
    ).toMatch(/git config\s+merge\.pnpm-merge\.driver/);

    expect(
      contributing,
      "CONTRIBUTING.md still defines the driver but no longer tells contributors to merge " +
        'upstream, so nothing in the documented workflow gives the driver an occasion to ' +
        'fire. A configured driver with no merge is the same dead shape objectui#6436 removed ' +
        'from changeset-release.yml — if the contributor path really no longer merges, the ' +
        'driver instruction above it is dead too and this whole mechanism should be re-judged.',
    ).toMatch(/git merge\s+upstream\/main/);
  });
});

/**
 * ── What a job RUNS, paired against the prose that documents it ──────────────
 *
 * objectui#3653 introduced this pairing for `ci.yml`'s job table. objectui#8015
 * lifted it out of that table, because the rule it encodes was never about a
 * table: *every first-party command a job runs must be named where this page
 * documents that job, and that documentation may not credit it with one the job
 * does not run.*
 *
 * Both directions are asserted, because the documentation is a claim in both: a
 * command the job runs and the page omits is a contributor who cannot learn from
 * this page that a gate exists; a command the page names and the job does not run
 * is the objectui#3451 shape one level down — a page advertising a guardrail that
 * is not there.
 *
 * The two sources differ only in WHERE the prose lives — one table cell per job
 * for `ci.yml`, one whole `##` section for `lint.yml`'s single job — so that is
 * the only thing a caller supplies. The rule itself is written once, here.
 *
 * What counts as a command is deliberately narrower than "every step", and the
 * boundary is *derived* rather than hand-listed: a step counts when it names
 * something this repository owns — a `scripts/*.mjs` file, a script in the root
 * `package.json`, or a `turbo run` task. Environment setup drops out on its own
 * because it names none of those (`corepack enable`, `pnpm --version`, `pnpm
 * install --frozen-lockfile`, `pnpm exec playwright install`, `pnpm --filter …
 * exec vite build`, `pnpm --filter '@object-ui/cli...' build`), which keeps the
 * documentation a summary of the gates rather than a transcript of the YAML.
 *
 * The hole that leaves, stated so nobody mistakes it for coverage: a gate written
 * as an inline shell block names no first-party command and is invisible here.
 * Gates in this repository land as a root `package.json` script or a
 * `scripts/*.mjs` file — both covered — and that is the only reason the narrower
 * rule is enough.
 *
 * Steps are read from `run:` values only, never from the surrounding YAML. Both
 * workflows carry comments that name their own gates — `ci.yml`'s `type-check`
 * block mentions `pnpm type-check`, `turbo run type-check` and `pnpm
 * check:i18n-drift`, and `lint.yml`'s step comments name every script it runs
 * plus two `pnpm check:*` aliases it deliberately does NOT use — so a scan of the
 * raw block would take all of them for steps and this pin would then be
 * describing its own comments.
 *
 * A `--self-test` invocation and the real one collapse to one entry: the rule is
 * about which gate the page must name, not how many times the YAML types it.
 */
const rootScripts = new Set(
  Object.keys(
    (
      JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts,
  ),
);

/**
 * The job keys a workflow defines, in file order.
 *
 * Scoped to the `jobs:` mapping, because top-level `on:` has two-space children
 * of its own (`push:`, `pull_request:`) that a whole-file scan would read as
 * jobs. Inside `jobs:` the only two-space lines are the job keys themselves:
 * job-level keys sit at four, step bodies deeper still, and every block scalar
 * (`run: |`) is indented past its key, so nothing else can reach column 2.
 */
function jobKeys(yaml: string, workflowFile: string): string[] {
  const start = yaml.search(/^jobs:[ \t]*$/m);
  expect(start, `${workflowFile} must still have a top-level \`jobs:\` mapping`).toBeGreaterThan(-1);
  const body = yaml.slice(start + 'jobs:'.length);
  // `jobs:` is the last top-level key in both workflows today; stop at the next
  // one regardless.
  const end = body.search(/^[A-Za-z]/m);
  const scoped = end === -1 ? body : body.slice(0, end);
  return [...scoped.matchAll(/^ {2}([a-z0-9][a-z0-9-]*):[ \t]*$/gm)].map((m) => m[1]);
}

/** One job's YAML block, from its key line up to the next thing at that indent. */
function jobBlock(yaml: string, key: string, workflowFile: string): string {
  const body = yaml.slice(yaml.search(/^jobs:[ \t]*$/m));
  const at = body.search(new RegExp(`^ {2}${key}:[ \\t]*$`, 'm'));
  expect(at, `${workflowFile} must still define a \`${key}:\` job`).toBeGreaterThan(-1);
  const rest = body.slice(at + 1);
  // A job's own comments are indented four spaces or more; the two-space ones
  // introduce the *next* job, so stopping at any two-space line is right.
  const next = rest.search(/^ {2}\S/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Every `run:` step body in a job block — single-line and block scalar alike. */
function runSteps(block: string): string[] {
  const lines = block.split('\n');
  const steps: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf('run:');
    // `run:` must be the key of the line, not text inside another value.
    if (at === -1 || !/^[\s-]*$/.test(lines[i].slice(0, at))) continue;
    const value = lines[i].slice(at + 'run:'.length).trim();
    if (!/^[|>][-+]?$/.test(value)) {
      steps.push(value);
      continue;
    }
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (lines[j].search(/\S/) <= at) break;
      body.push(lines[j].trim());
    }
    steps.push(body.join('\n'));
  }
  return steps;
}

/**
 * The first-party commands named in a piece of text — applied to a job's `run:`
 * bodies on one side and to the prose documenting it on the other, so the two
 * sides are compared by the same rule rather than by two spellings of it.
 */
function firstPartyCommands(text: string): Set<string> {
  const found = new Set<string>();
  // A gate that lives in this repo's `scripts/` tree. The `node ` prefix is not
  // required: the workflows write `node scripts/x.mjs`, the page writes the path.
  //
  // ⛔ Except when the path is a shell-single-quoted ARGUMENT (objectui#8647).
  // This repository writes path LISTS quoted and invocations unquoted — every
  // `on.paths:` entry across `.github/workflows/` is `'scripts/x.mjs'`, and
  // since objectui#8647 the `docs` job's `git diff … -- <pathspec>` names four
  // scripts the same way, because turbo declares them as inputs to every
  // `build`. Counting those as commands the job RUNS would demand the page
  // document four gates that never execute in that job — a false statement,
  // extracted from a parser rather than from the workflow.
  for (const m of text.matchAll(/scripts\/[\w./-]+\.mjs/g)) {
    const quoted = text[m.index - 1] === "'" && text[m.index + m[0].length] === "'";
    if (!quoted) found.add(m[0]);
  }
  // A root `package.json` script. `install`, `--version`, `exec` and `--filter`
  // are not scripts, so the setup steps need no exemption list.
  for (const m of text.matchAll(/\bpnpm\s+([\w:.-]+)/g)) {
    if (rootScripts.has(m[1])) found.add(`pnpm ${m[1]}`);
  }
  // The build graph, invoked through the task runner instead of a script.
  for (const m of text.matchAll(/\bturbo\s+run\s+([\w:-]+)/g)) found.add(`turbo run ${m[1]}`);
  return found;
}

/** One unit of the pairing: a job's steps, and the prose this page documents it in. */
type CommandParity = {
  /** How a failure names the unit — a `ci.yml` job key, or a workflow section. */
  label: string;
  /** First-party commands the job's `run:` steps actually invoke. */
  ran: Set<string>;
  /** First-party commands the page credits it with. */
  named: Set<string>;
};

/** Pair one job's `run:` steps against the piece of the page that documents it. */
function commandParity(
  workflowFile: string,
  jobKey: string,
  documentation: string,
  label: string = jobKey,
): CommandParity {
  const yaml = fs.readFileSync(path.join(workflowDir, workflowFile), 'utf8');
  return {
    label,
    ran: firstPartyCommands(runSteps(jobBlock(yaml, jobKey, workflowFile)).join('\n')),
    named: firstPartyCommands(documentation),
  };
}

/**
 * objectui#12214: fifteen one-check workflows became steps of ONE job in
 * `repo-gates.yml`, each step named `<check> — <step>`. A section that documents
 * one of those checks is paired against the steps that carry its check name --
 * plus, for the gates that read built types, the job's one shared build step,
 * which runs on their behalf -- never against the whole job, which would credit
 * every section with every other gate's commands.
 */
const REPO_GATES_SHARED_BUILD_STEP = 'Build every package the gates below read';
function checkParity(
  checkName: string,
  documentation: string,
  label: string,
  { withSharedBuild = false }: { withSharedBuild?: boolean } = {},
): CommandParity {
  const yaml = fs.readFileSync(path.join(workflowDir, 'repo-gates.yml'), 'utf8');
  const steps = jobBlock(yaml, 'repo-gates', 'repo-gates.yml')
    .split(/^(?= {6}- name: )/m)
    .filter(
      (step) =>
        step.startsWith(`      - name: ${checkName} — `) ||
        (withSharedBuild && step.startsWith(`      - name: ${REPO_GATES_SHARED_BUILD_STEP}`)),
    );
  expect(steps.length, `repo-gates.yml has no step named after ${checkName}`).toBeGreaterThan(0);
  return {
    label,
    ran: firstPartyCommands(runSteps(steps.join('\n')).join('\n')),
    named: firstPartyCommands(documentation),
  };
}

/** Commands a job runs that the prose documenting it does not name. */
function undocumentedCommands(units: CommandParity[]): string[] {
  return units.flatMap((u) => [...u.ran].filter((c) => !u.named.has(c)).map((c) => `${u.label}: ${c}`));
}

/** Commands the prose names that the job it documents does not run. */
function phantomCommands(units: CommandParity[]): string[] {
  return units.flatMap((u) => [...u.named].filter((c) => !u.ran.has(c)).map((c) => `${u.label}: ${c}`));
}

/**
 * objectui#3451: the same drift as #3197/#3212, one table lower down and pointing
 * the dangerous way. The `## Core CI Workflow (ci.yml)` section opened with "Seven
 * jobs, all parallel" and its table's seventh row described a `dev-server` job —
 * "guards `apps/dev-server`'s `objectstack.config.ts` against fixture /
 * `@objectstack/spec` drift", running "Every run".
 *
 * The history matters, because the row was wrong in two different ways and only the
 * second is the one you would guess:
 *
 *   2026-05-24  `apps/dev-server` lands, and with it the `dev-server` job.
 *   2026-05-26  `apps/dev-server` is removed. The job stays. `--filter
 *               @object-ui/dev-server` now matches no package and exits 0 —
 *               green by vacuity, for the next 69 days.
 *   2026-08-03  #3253 (fixing #3212) rewrites this very table and *adds* the
 *               `dev-server` row, describing a fixture-drift guard that had not
 *               built anything since May. The row was false the day it was written.
 *   2026-08-04  #3325 deletes the vacuous job from `ci.yml`, leaving the row.
 *   2026-08-06  #3451.
 *
 * So this is not only "the YAML moved and the prose lagged". #3253 pinned the
 * *workflow* inventory in both directions and left the *job* table unpinned, and the
 * table drifted within a day. #3197's comment names the direction: understating a
 * gate is annoying, advertising a guardrail the CI does not have is worse than no
 * doc.
 *
 * The count and the table are pinned together because fixing either one alone fixes
 * a snapshot, not the drift. Add or remove a job in `ci.yml` without editing this
 * page and the first test below fails, naming the job in each direction.
 *
 * What this still cannot catch is the 2026-05-26 shape: a job that exists in YAML
 * and does nothing. No amount of doc-to-YAML pinning sees that — only reading what
 * the job runs does.
 */
describe('ci-cd-pipeline.md — ci.yml job table', () => {
  const ciWorkflow = fs.readFileSync(path.join(workflowDir, 'ci.yml'), 'utf8');

  /** Job keys from `ci.yml`, in file order — see `jobKeys` for how the scan is scoped. */
  function ciJobKeys(): string[] {
    return jobKeys(ciWorkflow, 'ci.yml');
  }

  /** The `name:` each job reports itself under in the checks list, keyed by job key. */
  function ciJobNames(): Map<string, string> {
    const names = new Map<string, string>();
    const start = ciWorkflow.search(/^jobs:[ \t]*$/m);
    const body = ciWorkflow.slice(start);
    for (const key of ciJobKeys()) {
      const at = body.search(new RegExp(`^ {2}${key}:[ \\t]*$`, 'm'));
      const after = body.slice(at);
      const name = after.match(/^ {4}name:[ \t]*(.+?)[ \t]*$/m)?.[1];
      if (name) names.set(key, name.replace(/^['"]|['"]$/g, ''));
    }
    return names;
  }

  /** The `## Core CI Workflow (ci.yml)` section, up to the next `##` heading. */
  function coreCiSection(): string {
    const start = doc.indexOf('## Core CI Workflow (`ci.yml`)');
    expect(start, 'the page must still have a "## Core CI Workflow (`ci.yml`)" section').toBeGreaterThan(-1);
    const rest = doc.slice(start + 2);
    const next = rest.search(/^## /m);
    return next === -1 ? rest : rest.slice(0, next);
  }

  const JOB_TABLE_HEADER = '| Job key | Appears as | What it runs | When |';

  /** The job table's rows in page order: job key, `Appears as`, `What it runs`. */
  function docJobRows(): { key: string; appearsAs: string; runs: string }[] {
    const section = coreCiSection();
    const at = section.indexOf(JOB_TABLE_HEADER);
    expect(at, `the job table must keep the header \`${JOB_TABLE_HEADER}\``).toBeGreaterThan(-1);
    const rows: { key: string; appearsAs: string; runs: string }[] = [];
    for (const cells of markdownTableRows(section.slice(at))) {
      rows.push({ key: cells[0].replace(/`/g, '').trim(), appearsAs: cells[1] ?? '', runs: cells[2] ?? '' });
    }
    return rows;
  }

  it('lists exactly the jobs ci.yml defines — in both directions', () => {
    const fromWorkflow = ciJobKeys();
    // A parser that silently matched nothing would make this test vacuously green,
    // which is the failure mode the removed `dev-server` job itself demonstrated.
    expect(fromWorkflow.length, 'the ci.yml `jobs:` parse returned implausibly few keys').toBeGreaterThan(3);

    const fromDoc = docJobRows().map((r) => r.key);
    expect(fromDoc.length, 'the job table parse returned implausibly few rows').toBeGreaterThan(3);

    const phantom = fromDoc.filter((k) => !fromWorkflow.includes(k));
    const missing = fromWorkflow.filter((k) => !fromDoc.includes(k));

    expect(
      phantom,
      `content/docs/guide/ci-cd-pipeline.md's job table has rows for jobs that are NOT in ` +
        `.github/workflows/ci.yml:\n` +
        phantom.map((k) => `  - ${k}`).join('\n') +
        `\n\nDelete the row. A page that advertises a guard CI does not run is worse than no ` +
        `page — objectui#3451: the \`dev-server\` row survived three months after #3325 deleted ` +
        `the job, telling contributors their objectstack.config.ts had drift protection it did not.`,
    ).toEqual([]);

    expect(
      missing,
      `.github/workflows/ci.yml defines jobs with no row in the job table of ` +
        `content/docs/guide/ci-cd-pipeline.md:\n` +
        missing.map((k) => `  - ${k}`).join('\n') +
        `\n\nAdd a row (job key, the \`name:\` it appears as in the checks list, what it runs, and ` +
        `when) — an undocumented job is a check contributors get blocked by without knowing it exists.`,
    ).toEqual([]);
  });

  it('quotes each job under the name ci.yml gives it', () => {
    // `${{ ... }}` is left as a wildcard: `test` is a matrix job whose name is
    // `Test (shard ${{ matrix.shard }}/4)` and the page sensibly writes `N` for the
    // shard index. Everything outside the expressions must match literally.
    const names = ciJobNames();
    expect(names.size, 'every ci.yml job should declare a `name:`').toBe(ciJobKeys().length);

    for (const { key, appearsAs } of docJobRows()) {
      const declared = names.get(key);
      if (!declared) continue; // key mismatch is the previous test's failure to report
      const pattern = new RegExp(
        `^${declared
          .split(/\$\{\{[^}]*\}\}/)
          .map((lit) => lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.+')}$`,
      );
      expect(
        appearsAs,
        `the job table's "Appears as" for \`${key}\` must match ci.yml's \`name: ${declared}\``,
      ).toMatch(pattern);
    }
  });

  it('states no job count, so the number cannot drift away from the table', () => {
    // The #3212 lesson applied one section down: a hand-maintained count drifts by
    // construction and a stale one still reads as authoritative. "Seven jobs, all
    // parallel" outlived the seventh job by three months.
    const section = coreCiSection();
    const counted = section.match(
      /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)[ \t]+(?:parallel[ \t]+)?jobs\b/i,
    );
    expect(
      counted?.[0],
      `the Core CI section must not hard-code how many jobs ci.yml has (found "${counted?.[0]}") — ` +
        `the table is the list. See the same decision for the workflow count at the top of the page.`,
    ).toBeUndefined();
  });

  it('is telling the truth: no CI job builds the retired dev-server fixture', () => {
    // The inverse pin. The page now states outright that there is *no* guard on
    // `objectstack.config.ts` / `@objectstack/spec` drift. If anyone restores such a
    // job, this fails and points at the paragraph that denies it exists.
    expect(ciJobKeys()).not.toContain('dev-server');
    expect(
      ciWorkflow,
      'a dev-server fixture build is back in ci.yml — update the "What is not in `ci.yml`" ' +
        'section, which currently tells readers no such guard exists',
    ).not.toMatch(/@object-ui\/dev-server/);
    // Reflow-tolerant, and asserted as a boolean so a failure prints the reason
    // rather than diffing the entire page into the terminal.
    expect(
      /Today there is no `apps\/dev-server` and no such job/.test(doc.replace(/\s+/g, ' ')),
      'the "What is not in `ci.yml`" section must keep stating outright that neither the ' +
        '`dev-server` job nor `apps/dev-server` exists. The table pin above catches a restored ' +
        'job with no row; this catches a restored job whose row was added while this paragraph ' +
        'still denies it (objectui#3451).',
    ).toBe(true);
  });

  /**
   * objectui#3653: every pin above judges `ci.yml` at JOB granularity — the set of
   * job keys, the `name:` each one reports under, the absence of a count. None of
   * them reads what a job *runs*, so a `run:` step added to an existing job left
   * this whole file green. Two such steps had landed unlisted: `pnpm
   * check:i18n-keys` (objectui#3530, PR #3547) and `pnpm check:i18n-drift`
   * (objectui#3650, PR #3659) both ran in the `type-check` job while its row on the
   * page still listed five commands.
   *
   * The rule, both of its directions, and what counts as a command all live at
   * module scope now (objectui#8015) — `lint.yml`'s section had the identical
   * drift and is pinned by the same code at the bottom of this file. Only the
   * `ci.yml`-specific part is here: the documentation for each job is that job's
   * `What it runs` table cell.
   *
   * Whether a given step still EXISTS in `ci.yml` is pinned where that step was
   * introduced — `check-i18n-call-site-keys.test.ts` and
   * `check-i18n-en-drift.test.ts` each hold their own, as do
   * `scripts-type-check.test.ts` and `vitest-setup-type-check.test.ts`. This block
   * does not repeat those assertions; it pins the *pairing* between the YAML and
   * this page, which is the part nothing owned.
   */
  describe('what each job runs', () => {
    /** `job key -> commands it actually runs`, and the same from the page's table. */
    function commandsByJob(): CommandParity[] {
      return docJobRows().map((row) => commandParity('ci.yml', row.key, row.runs));
    }

    it('names every first-party command the job actually runs', () => {
      const jobs = commandsByJob();

      // A parser that matched nothing would make both directions vacuously green —
      // the exact failure the `dev-server` job demonstrated one level up.
      const ran = jobs.reduce((n, j) => n + j.ran.size, 0);
      expect(ran, 'the ci.yml `run:` parse found implausibly few first-party commands').toBeGreaterThan(8);

      const missing = undocumentedCommands(jobs);

      expect(
        missing,
        `.github/workflows/ci.yml runs commands that the job table in ` +
          `content/docs/guide/ci-cd-pipeline.md does not name:\n` +
          missing.map((m) => `  - ${m}`).join('\n') +
          `\n\nAdd each one to that job's "What it runs" cell, in the order ci.yml runs it. ` +
          `A gate nobody wrote down is a build failure contributors meet without knowing what ` +
          `produced it — objectui#3653: two locale gates ran in \`type-check\` unlisted, because ` +
          `the pins on this page read job keys and job names but never read the steps.`,
      ).toEqual([]);
    });

    it('reads a quoted pathspec as an argument and an unquoted path as a command', () => {
      // The control for the exclusion above (objectui#8647). Without the first
      // assertion the exclusion is unverified; without the second it could
      // silently swallow every real gate and leave both directions green.
      const ran = commandsByJob().flatMap((j) => [...j.ran]);
      expect(
        ran,
        'a `git diff` pathspec entry is not a command the job runs',
      ).not.toContain('scripts/check-dist-completeness.mjs');
      expect(
        ran,
        'an unquoted `node scripts/…` invocation must still be counted',
      ).toContain('scripts/check-doc-expression-carriage.mjs');
    });

    it('credits no job with a first-party command it does not run', () => {
      const jobs = commandsByJob();

      const named = jobs.reduce((n, j) => n + j.named.size, 0);
      expect(named, 'the job table parse found implausibly few commands in "What it runs"').toBeGreaterThan(8);

      const phantom = phantomCommands(jobs);

      expect(
        phantom,
        `content/docs/guide/ci-cd-pipeline.md's job table credits jobs with commands that ` +
          `.github/workflows/ci.yml does not run there:\n` +
          phantom.map((p) => `  - ${p}`).join('\n') +
          `\n\nEither the step was removed and the cell is stale, or the command runs in a ` +
          `different job and belongs in that row. A "What it runs" cell reads as this job's ` +
          `gate list, so naming a command for contrast inside it makes the page claim a ` +
          `guardrail — the objectui#3451 mistake, one level down.`,
      ).toEqual([]);
    });
  });
});

/**
 * objectui#8015: the same pairing, applied to the section this page's other pins
 * could not reach.
 *
 * `lint.yml` is a REQUIRED context on `pull_request` and `merge_group` alike, and
 * every gate in it blocks a merge. The only thing holding its section here was the
 * workflow-inventory pin at the top of the file, which requires a `##` heading
 * naming the file and says nothing whatsoever about the heading's contents — so the
 * step list underneath it could drift indefinitely and every test on this page
 * stayed green. It had: measured on `4b4d35a7d`, the section named three of the
 * seven first-party commands the `lint` job runs, and the four it omitted —
 * `check-entry-guard.mjs`, `check-upstream-port-parity.mjs`,
 * `check-bash32-floor.mjs` and `check-cross-repo-closer-outcome.mjs` — are all
 * blocking gates. Three of them had been missing since they landed; the fourth
 * (`check-bash32-floor.mjs`, PR #8016) arrived while the card was open, which is
 * the drift rate this pin exists to absorb.
 *
 * The neighbouring gap was demonstrated rather than argued: on the card before this
 * one, a sentence in this same document was replaced with an obvious falsehood and
 * the eleven test files that read the page were re-run — 404/404 green, plus
 * `check-doc-links` at exit 0. Nothing looked at this page's contents beyond the
 * `ci.yml` table.
 *
 * The prose SHAPE differs from `ci.yml`'s (bullets and paragraphs, not a table
 * cell), which is exactly why the rule was hoisted to module scope instead of
 * copied: `commandParity` takes whatever text documents a job, so the unit here is
 * the whole `## Lint (lint.yml)` section against the single `lint` job. Reading the
 * whole section rather than only the bullet list is deliberate — the paragraphs
 * below the bullets discuss `pnpm lint` and `pnpm check` too, and a rule that read
 * only the list would call those phantoms.
 */
describe('ci-cd-pipeline.md — lint.yml step list', () => {
  const lintWorkflow = fs.readFileSync(path.join(workflowDir, 'lint.yml'), 'utf8');
  const LINT_HEADING = '## Lint (`lint.yml`)';

  /** The `## Lint (lint.yml)` section, up to the next `##` heading. */
  function lintSection(): string {
    const start = doc.indexOf(LINT_HEADING);
    expect(start, `the page must still have a "${LINT_HEADING}" section`).toBeGreaterThan(-1);
    const rest = doc.slice(start + 2);
    const next = rest.search(/^## /m);
    return next === -1 ? rest : rest.slice(0, next);
  }

  function lintUnits(): CommandParity[] {
    return [commandParity('lint.yml', 'lint', lintSection(), 'lint.yml `lint`')];
  }

  it('describes the only job lint.yml defines', () => {
    // The unit below covers the `lint` job and nothing else. A second job added to
    // this workflow would run gates that no assertion here reads and no section
    // here documents, so it has to come through this test first.
    expect(
      jobKeys(lintWorkflow, 'lint.yml'),
      'lint.yml no longer defines exactly one `lint` job. The section pinned below ' +
        'documents that job alone, so a new job needs its own documentation and its own ' +
        'unit in `lintUnits()` — otherwise its gates are unpinned and undocumented at once.',
    ).toEqual(['lint']);
  });

  it('names every first-party command the lint job actually runs', () => {
    const units = lintUnits();

    // A parser that matched nothing would make both directions vacuously green.
    // The floor is a control on the matcher, not a ratchet on the gate count.
    const ran = units.reduce((n, u) => n + u.ran.size, 0);
    expect(ran, 'the lint.yml `run:` parse found implausibly few first-party commands').toBeGreaterThan(4);

    const missing = undocumentedCommands(units);

    expect(
      missing,
      `.github/workflows/lint.yml runs commands that the "${LINT_HEADING}" section of ` +
        `content/docs/guide/ci-cd-pipeline.md does not name:\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        `\n\nAdd each one to that section, in the order lint.yml runs it. Every gate in this ` +
        `job blocks a merge on a required check, so one nobody wrote down is a build failure ` +
        `contributors meet with no way to learn from this page what produced it — objectui#8015.`,
    ).toEqual([]);
  });

  it('credits the lint job with no first-party command it does not run', () => {
    const units = lintUnits();

    const named = units.reduce((n, u) => n + u.named.size, 0);
    expect(named, 'the Lint section parse found implausibly few commands').toBeGreaterThan(4);

    const phantom = phantomCommands(units);

    expect(
      phantom,
      `the "${LINT_HEADING}" section of content/docs/guide/ci-cd-pipeline.md names commands ` +
        `that .github/workflows/lint.yml does not run:\n` +
        phantom.map((p) => `  - ${p}`).join('\n') +
        `\n\nEither the step was removed and the prose is stale, or the command runs in a ` +
        `different workflow and belongs in that section. This section reads as the \`lint\` ` +
        `job's gate list, so naming a command inside it makes the page claim a guardrail — ` +
        `the objectui#3451 mistake, in prose instead of a table.`,
    ).toEqual([]);
  });
});

/**
 * objectui#4170: the `## Merge Queue` section's other current-state claim — the
 * "Some contexts can never be required, structurally" bullet, which names four
 * workflows and, for each, quotes the live YAML property that makes it
 * unrequirable.
 *
 * All four were TRUE when this landed, so this pins prose that was not wrong; it
 * is here because of what happens next. objectui#4154 had just converged the
 * sibling paragraph one level up onto a pointer, for the reason that prose
 * nothing reads goes stale silently — and this bullet is that shape with an
 * expiry date already written into the YAML it describes: `live-e2e.yml`'s own
 * header says its `continue-on-error: true` comes off once the lane has run
 * clean long enough to trust. The day that lands, this page states that a lane
 * which now blocks merges can *never* block them, which is the direction #3197
 * and #3451 both name as the dangerous one — advertising or denying a guardrail
 * wrongly is worse than saying nothing, because people stop checking.
 *
 * The bullet is kept whole rather than replaced by a pointer (the choice that
 * fit #4154 and does not fit here): its four entries teach four *different*
 * structural reasons a context cannot be required — an inverse path filter, an
 * ordinary one, a job that cannot fail, and a trigger that only fires after the
 * merge. That is pedagogy, not an inventory, and a pointer would delete it.
 *
 * Every expectation below is READ OUT OF the workflow — never a second copy of
 * the value written here (the objectui#4150 derived-expectation pattern). The
 * page is then checked against what the YAML actually says, so a path list or a
 * trigger type cannot be changed in one place and stay green in the other.
 *
 * SCOPE, stated so it is not mistaken for more — this pins EXAMPLES TRUE, not a
 * CENSUS:
 *
 *   - Nothing here scans `.github/workflows/` for other structurally
 *     unrequirable workflows, and a fifth one arriving must NOT turn this red.
 *     The bullet says "Some contexts", and it is right to: it exists to teach
 *     the four shapes, not to enumerate their instances.
 *   - What IS checked in both directions is the page's own claims. A line added
 *     to that bullet needs an entry here, or it is unpinned prose again — this
 *     issue verbatim — and an entry here whose line has left the page fails too,
 *     so a claim cannot be quietly dropped while its pin reports green.
 *
 * THE `live-e2e.yml` RED IS EXPECTED, and it is not a bug to be worked around.
 * When `continue-on-error` comes off that job, `structuralBlocks` fails naming
 * `live-e2e.yml`. The fix is to DELETE that line from the bullet and its entry
 * from the map below — the lane has become requirable, so the page must stop
 * saying otherwise. Do not soften the line ("mostly informational"), and do not
 * relax the check to keep it green: a page that hedges about whether a gate can
 * block you is the failure this file was opened for.
 *
 * `performance-budget.yml`'s line quotes no value (it says "an ordinary path
 * filter" and names no globs), so only the existence of the property is pinned
 * there. The asymmetry is deliberate: `quotes` derives from the YAML, and a
 * claim that quotes nothing has nothing to derive.
 *
 * The small YAML-block helpers below are local copies of the ones in
 * `merge-queue-reporting.test.ts`. Data is never copied in this repository; a
 * twenty-line indentation scanner is not data, and neither file is a library.
 */
const readWorkflow = (file: string): string => fs.readFileSync(path.join(workflowDir, file), 'utf8');

/**
 * A workflow's YAML with whole-line comments removed. Load-bearing, not
 * cosmetic: `live-e2e.yml`'s header argues at length about `continue-on-error`
 * — more so since objectui#8084 took the flag off its job and wrote the
 * measurement into the header — and `changeset-guard.yml`'s explains why
 * `.changeset/**` is filtered the way it is, so a scan that counted comments
 * would report properties from prose. ⛔ No line count is stated here on
 * purpose: a hand-written count of prose lines is a claim nothing asserts.
 */
function withoutComments(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** A top-level block (`on:`, `jobs:`) up to the next top-level key. */
function topLevelBlock(yaml: string, key: string): string {
  const at = yaml.search(new RegExp(`^${key}:`, 'm'));
  if (at === -1) return '';
  const rest = yaml.slice(at);
  const firstLineEnd = rest.indexOf('\n') + 1;
  if (firstLineEnd === 0) return rest;
  const after = rest.slice(firstLineEnd);
  const next = after.search(/^[A-Za-z]/m);
  return next === -1 ? rest : rest.slice(0, firstLineEnd + next);
}

/** One two-space child of `on:` / `jobs:`, up to the next child at that indent. */
function nestedBlock(block: string, key: string): string {
  const at = block.search(new RegExp(`^ {2}${key}:`, 'm'));
  if (at === -1) return '';
  const rest = block.slice(at);
  const firstLineEnd = rest.indexOf('\n') + 1;
  if (firstLineEnd === 0) return rest;
  const after = rest.slice(firstLineEnd);
  const next = after.search(/^ {2}\S/m);
  return next === -1 ? rest : rest.slice(0, firstLineEnd + next);
}

/** The two-space child keys of an `on:` block — the events the workflow subscribes. */
const triggerKeys = (onBlock: string): string[] =>
  [...onBlock.matchAll(/^ {2}([a-z_][a-z_-]*):/gm)].map((m) => m[1]);

/** `- 'pattern'` entries — the shape a `paths:` list is written in. */
const listEntries = (block: string): string[] =>
  [...block.matchAll(/^\s*-\s*'?([^'\n]+?)'?\s*$/gm)].map((m) => m[1]);

/** A trigger's `types:` list, inline (`types: [closed]`) or block. */
function declaredTypes(trigger: string): string[] {
  const inline = trigger.match(/^\s*types:\s*\[([^\]]*)\]\s*$/m);
  if (inline) {
    return inline[1]
      .split(',')
      .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  const at = trigger.search(/^\s*types:\s*$/m);
  if (at === -1) return [];
  const types: string[] = [];
  for (const line of trigger.slice(at).split('\n').slice(1)) {
    const entry = line.match(/^\s*-\s*['"]?([\w-]+)['"]?\s*$/);
    if (!entry) break;
    types.push(entry[1]);
  }
  return types;
}

/** The `paths:` entries on a workflow's `pull_request` trigger, if it has any. */
function pullRequestPaths(file: string): string[] {
  const trigger = nestedBlock(topLevelBlock(withoutComments(readWorkflow(file)), 'on'), 'pull_request');
  const at = trigger.search(/^ {4}paths:\s*$/m);
  if (at === -1) return [];
  return listEntries(trigger.slice(at));
}

/**
 * The `paths-ignore:` globs a workflow's `pull_request` trigger declares — the
 * exclusion half of the same structural property. A context the filter keeps
 * from being created is a context a required check waits on forever, exactly as
 * for `paths:`; `ci.yml` keeps its own `paths-ignore` on the push trigger ONLY
 * for that reason (objectui#3523).
 */
function pullRequestPathsIgnore(file: string): string[] {
  const trigger = nestedBlock(topLevelBlock(withoutComments(readWorkflow(file)), 'on'), 'pull_request');
  const at = trigger.search(/^ {4}paths-ignore:\s*$/m);
  if (at === -1) return [];
  return listEntries(trigger.slice(at));
}

interface StructuralBlock {
  /** The property, named the way a failure message should name it. */
  readonly property: string;
  /** `null` while the page's claim still holds; otherwise what the YAML says now. */
  broken(): string | null;
  /** Values the page's line must still quote, READ FROM the YAML. */
  quotes(): string[];
  /** What the fix is when it breaks — different for each, so it is written per claim. */
  readonly whenItBreaks: string;
}

/**
 * `filename -> the YAML property that makes the bullet's claim about it true`.
 *
 * Not a `NEVER_REQUIRABLE` inventory, and the page does not point at it: each
 * entry is a CHECKER for a claim the page makes in its own words. "Can this
 * context be required?" is still a question about repository settings that no
 * test here can read — what is checked is the narrower, mechanical thing the
 * page actually asserts about each workflow's YAML.
 */
const STRUCTURAL_BLOCKS = new Map<string, StructuralBlock>([
  [
    'changeset-guard.yml',
    {
      property: "an inverse path filter — `paths:` on the `pull_request` trigger",
      broken() {
        const paths = pullRequestPaths('changeset-guard.yml');
        return paths.length > 0
          ? null
          : 'its `pull_request` trigger no longer declares `paths:`, so it now reports on ' +
              'pull requests that touch no changeset — which is what would make it requirable';
      },
      quotes: () => pullRequestPaths('changeset-guard.yml'),
      whenItBreaks:
        'If the filter was removed deliberately, this workflow reports on every pull request ' +
        'and belongs in the paragraph ABOVE the bullet instead — the one about workflows that ' +
        'must subscribe `merge_group` — not in the list of contexts that cannot be required.',
    },
  ],
  [
    'performance-budget.yml',
    {
      property: 'a path filter — `paths:` on the `pull_request` trigger',
      broken() {
        const paths = pullRequestPaths('performance-budget.yml');
        return paths.length > 0
          ? null
          : 'its `pull_request` trigger no longer declares `paths:`, so Bundle Analysis now ' +
              'reports on every pull request and the page is denying a guardrail that exists';
      },
      // The page's line names no globs, so there is nothing derived to hold it to.
      quotes: () => [],
      whenItBreaks:
        'Same as above: a filterless Bundle Analysis is a context that reports everywhere, so ' +
        'it stops being an example of this rule and becomes an example of the previous one.',
    },
  ],
  [
    'live-e2e.yml',
    {
      property: '`paths-ignore:` on the `pull_request` trigger',
      broken() {
        const ignored = pullRequestPathsIgnore('live-e2e.yml');
        return ignored.length > 0
          ? null
          : 'its `pull_request` trigger no longer declares `paths-ignore:`, so Live E2E now ' +
              'reports on every pull request and the page is denying a guardrail that exists';
      },
      quotes: () => pullRequestPathsIgnore('live-e2e.yml'),
      whenItBreaks:
        'THIS LINE HAS ALREADY OUTLIVED ONE PROPERTY, which is the thing to read before editing ' +
        'it again. It used to quote `continue-on-error: true` on the job, on the reasoning that ' +
        'a job which cannot fail cannot gate anything. objectui#8084 measured that reasoning ' +
        'false in both halves: the flag left the JOB and its CHECK RUN red — job 101442890465 ' +
        'and check run `Live E2E (informational)` both reported `failure` on run 34017174769 — ' +
        'so it never made the context unrequirable; it only inverted the aggregate, which is the ' +
        'defect that card was filed for. Taking it off therefore did NOT promote the lane, and ' +
        'this entry was re-pointed rather than deleted: the `paths-ignore:` filter quoted here is ' +
        'what still keeps the context from being created on a docs-only pull request, and a ' +
        'required check cannot survive a context that is never created. Retire this entry when ' +
        'live-e2e.yml carries no such property at all — never because one was replaced by ' +
        'another, and never by softening the line in place.',
    },
  ],
  [
    'cross-repo-issue-closer.yml',
    {
      property: 'every trigger restricted to `types: [closed]`, plus the job gate on `merged == true`',
      broken() {
        const yaml = withoutComments(readWorkflow('cross-repo-issue-closer.yml'));
        const on = topLevelBlock(yaml, 'on');
        const keys = triggerKeys(on);
        if (keys.length === 0) return 'no trigger could be parsed out of its `on:` block';

        const preMerge = keys.filter((key) => {
          const types = declaredTypes(nestedBlock(on, key));
          return types.length === 0 || types.some((t) => t !== 'closed');
        });
        if (preMerge.length > 0) {
          return `it now subscribes ${preMerge.map((k) => `\`${k}\``).join(', ')} without ` +
            'restricting to `types: [closed]`, so the workflow can start while a pull request ' +
            'is still open';
        }
        return /if:.*github\.event\.pull_request\.merged\s*==\s*true/.test(yaml)
          ? null
          : 'the job no longer gates on `github.event.pull_request.merged == true`, so a pull ' +
              'request CLOSED WITHOUT MERGING now runs it too — "only after a merge" is the ' +
              'half of this claim that gate carries';
      },
      quotes() {
        const on = topLevelBlock(withoutComments(readWorkflow('cross-repo-issue-closer.yml')), 'on');
        // Both halves the page's line names: which event, and which types of it.
        return [...triggerKeys(on), ...triggerKeys(on).flatMap((key) => declaredTypes(nestedBlock(on, key)))];
      },
      whenItBreaks:
        'A trigger that can fire before the merge makes this a context that reports on open ' +
        'pull requests, which is the opposite of what the line says. Rewrite the line to match ' +
        'the new trigger, or move the workflow out of the bullet.',
    },
  ],
]);

/** The bullet, and the one claim each of its nested lines makes. */
interface StructuralClaim {
  /** The workflow file the line names. */
  readonly workflow: string;
  /** The line itself, joined onto one string — for `quotes` and for messages. */
  readonly line: string;
}

const CLAIM_LEAD_IN = /^- \*\*Some contexts can never be required, structurally\*\*/m;

/**
 * The nested lines under the bullet, one per claim.
 *
 * Parsed rather than matched against a fixed shape so that reflowing the prose
 * is free: the bullet block runs from its lead-in to the next line starting at
 * column 0, and inside it a claim starts at each two-space `- ` and continues
 * through its own continuation lines.
 */
function structuralClaims(): StructuralClaim[] {
  const at = doc.search(CLAIM_LEAD_IN);
  if (at === -1) return [];

  const lines = doc.slice(at).split('\n');
  const block: string[] = [lines[0]];
  for (const line of lines.slice(1)) {
    if (line.trim() !== '' && !line.startsWith(' ')) break;
    block.push(line);
  }

  const claimLines: string[] = [];
  let current: string[] | null = null;
  for (const line of block.slice(1)) {
    if (/^ {2}- /.test(line)) {
      if (current) claimLines.push(current.join(' '));
      current = [line.trim()];
    } else if (line.trim() === '') {
      // A blank line ends the claim. The bullet closes with a paragraph about
      // the pin itself, indented into the same list item and naming
      // `live-e2e.yml` again; swallowed into the last claim it would read as a
      // second claim about whichever workflow it happened to mention.
      if (current) claimLines.push(current.join(' '));
      current = null;
    } else if (current) {
      current.push(line.trim());
    }
  }
  if (current) claimLines.push(current.join(' '));

  return claimLines.flatMap((line) => {
    const named = [
      ...new Set([...line.matchAll(/(?<![\w/.-])([a-z0-9][a-z0-9-]*\.yml)\b/g)].map((m) => m[1])),
    ];
    return named.map((workflow) => ({ workflow, line }));
  });
}

describe('ci-cd-pipeline.md — contexts that can never be required (#4170)', () => {
  it('still carries the bullet, with one workflow named per claim', () => {
    expect(
      doc.search(CLAIM_LEAD_IN),
      'the "Some contexts can never be required, structurally" bullet is gone from ' +
        'content/docs/guide/ci-cd-pipeline.md. Everything below pins that bullet, so removing it ' +
        'turns this whole block vacuously green — the failure mode this page keeps meeting ' +
        '(objectui#3451). If the bullet was deliberately retired, delete these tests with it.',
    ).toBeGreaterThan(-1);

    const claims = structuralClaims();
    expect(
      claims.length,
      'the bullet parsed to no claims at all. Each entry must be a nested `  - ` line naming ' +
        'the workflow file it is about (e.g. "`live-e2e.yml`"); a claim that names no file ' +
        'cannot be pinned to anything, which is what objectui#4170 was filed about.',
    ).toBeGreaterThan(0);
  });

  it('pins every workflow the bullet claims', () => {
    // The page → map direction. A fifth structurally unrequirable workflow may
    // exist unmentioned (this bullet is examples, not a census), but a fifth
    // LINE here is a new claim, and an unpinned claim is exactly the defect.
    const unpinned = structuralClaims()
      .filter((claim) => !STRUCTURAL_BLOCKS.has(claim.workflow))
      .map((claim) => `${claim.workflow} — "${claim.line.slice(0, 80)}…"`);

    expect(
      unpinned,
      `The "can never be required, structurally" bullet makes claims about workflows that ` +
        `nothing in this file checks:\n` +
        unpinned.map((u) => `  - ${u}`).join('\n') +
        `\n\nAdd an entry to STRUCTURAL_BLOCKS naming the YAML property that makes the claim ` +
        `true, and read that property out of the workflow rather than restating it here. A ` +
        `claim on this page that no assertion reads is true only until someone edits the YAML, ` +
        `and nothing then says so (objectui#4170).`,
    ).toEqual([]);
  });

  it.each([...STRUCTURAL_BLOCKS.keys()])('%s — the page still makes the claim this pins', (file) => {
    // The map → page direction, so a claim cannot be dropped while its pin keeps
    // reporting green on a property nobody documents any more.
    expect(
      structuralClaims().map((c) => c.workflow),
      `STRUCTURAL_BLOCKS pins a claim about ${file}, but the "can never be required, ` +
        `structurally" bullet in content/docs/guide/ci-cd-pipeline.md no longer names it.\n\n` +
        `If the line was removed because the property changed, remove this entry too — that is ` +
        `the intended sequence for live-e2e.yml. If the line was removed for space, put it ` +
        `back: each of these teaches a different structural reason a context cannot be ` +
        `required, which is why the bullet was kept whole rather than replaced by a pointer ` +
        `(objectui#4170).`,
    ).toContain(file);
  });

  it.each([...STRUCTURAL_BLOCKS.entries()])('%s — the property the page quotes still holds', (file, block) => {
    const broken = block.broken();
    expect(
      broken,
      `content/docs/guide/ci-cd-pipeline.md says ${file} can never produce a required ` +
        `context, because of ${block.property}. That is no longer what the YAML says: ${broken}.` +
        `\n\n${block.whenItBreaks}`,
    ).toBeNull();
  });

  it.each([...STRUCTURAL_BLOCKS.entries()])('%s — the page quotes the values the YAML declares', (file, block) => {
    // Skipped when the property itself is gone: that failure belongs to the test
    // above, and reporting it twice would say a page is quoting a value wrong
    // when the value no longer exists at all.
    if (block.broken() !== null) return;

    const claim = structuralClaims().find((c) => c.workflow === file);
    if (!claim) return; // reported by the presence test above

    const values = block.quotes();
    const missing = values.filter((value) => value !== '' && !claim.line.includes(value));

    expect(
      missing,
      `The ${file} line of the "can never be required, structurally" bullet no longer quotes ` +
        `what ${file} actually declares:\n` +
        missing.map((v) => `  - ${v}`).join('\n') +
        `\n\nThese are read out of the workflow, so the page is behind the YAML, not the other ` +
        `way round. Update the line to quote the live value. (Quoting the property is what ` +
        `makes the claim checkable at all — objectui#4170 was filed because a bullet quoting ` +
        `four YAML properties was pinned to none of them.)`,
    ).toEqual([]);
  });
});

/**
 * objectui#7689 — the page's live-e2e section states a pin rule that nothing read.
 *
 * `content/docs/guide/ci-cd-pipeline.md` says the backend pins "must match the
 * `@objectstack/spec` version in `pnpm-lock.yaml` — bump both in the same PR, or the
 * run proves nothing", and `e2e/live/ci/backend.env` repeats the same MUST in its own
 * header. Both were true statements about what a reader should do and false statements
 * about what CI checked: `git grep -l backend.env scripts/ .github/ e2e/` reached only
 * the workflow that caches on its hash and the script that sources it. Nothing compared
 * the two numbers, so the pin sat at `17.0.0-rc.2` against a lockfile resolving `17.2.0`
 * for two minor versions while `Live E2E (informational)` reported green.
 *
 * That is the shape this file exists for, and the worst instance of it yet. The size
 * regime in #3197 advertised a guardrail CI did not have; here the lane's OWN contract
 * says a mismatched pair "proves nothing", so every green run it produced over those two
 * minors was a check whose documentation declared it meaningless. A stale constant is a
 * chore; a green light its own spec disclaims is worse than a red one.
 *
 * ## What this asserts, and the one half it deliberately does not
 *
 * ASSERTED: `OBJECTSTACK_VERSION` equals the `@objectstack/spec` version the lockfile
 * resolves, read two independent ways (the resolution keys under `packages:`/`snapshots:`
 * and the `version:` line of every workspace importer) whose union must hold exactly one
 * value. Two readings rather than one because "the resolved version" is only a
 * well-formed question while the tree agrees with itself: a lockfile carrying two
 * `@objectstack/spec` versions has no single number for the pin to match, and naming that
 * is more useful than picking one of them and comparing to it.
 *
 * ALSO ASSERTED, since objectui#7964: that the file's other pin is GONE. `OBJECTSTACK_REF`
 * used to be a second, hand-moved sha here, carrying a MUST — "always the commit the
 * `@objectstack/cli@${OBJECTSTACK_VERSION}` release tag points at" — that nothing could
 * check, because reading that tag needs the objectstack repository over the network and
 * this unit lane has not got it. That was a true statement about what a reader should do
 * and, again, an unenforceable one: the same shape #7689 is about, one file down.
 *
 * The fix was not another check. It was to delete the second value: `start-backend.sh`
 * now RESOLVES the commit at boot from the release tag named by `OBJECTSTACK_VERSION`
 * (`git ls-remote --tags`, peeled `^{}` sha preferred) and refuses to start when the tag
 * does not resolve to a 40-character sha. The lane that consumes the commit is the lane
 * that can reach the repository, and it always could. So the pair the header describes
 * cannot disagree by construction, and there is nothing left here to hand-move.
 *
 * What this file pins about that half is therefore the ABSENCE and the DERIVATION, by
 * content: no `OBJECTSTACK_REF=` key in backend.env, and the resolution + refusal still in
 * start-backend.sh. Either one alone would be vacuous — an absent key is fine only while
 * something derives the value, and a derivation is only load-bearing while no pin
 * overrides it.
 *
 * ## Anti-vacuity
 *
 * Each half is floored. The doc sentence is required to still be on the page, because
 * this whole block is the enforcement of that sentence and a page that stopped making the
 * claim should retire the pin deliberately rather than leave it running on prose nobody
 * reads. The lockfile scan is required to have matched something, so a lockfile format
 * change turns this red instead of green-with-an-empty-set — the failure mode #3451 keeps
 * teaching this page.
 */
const backendEnvPath = path.join(repoRoot, 'e2e/live/ci/backend.env');
const startBackendPath = path.join(repoRoot, 'e2e/live/ci/start-backend.sh');
const lockfilePath = workspaceLockfilePath();
const backendEnv = fs.readFileSync(backendEnvPath, 'utf8');
const startBackend = fs.readFileSync(startBackendPath, 'utf8');

/** The page's statement of the rule, whitespace-normalised because the source wraps it. */
const PIN_RULE_SENTENCE =
  /Backend pins live in `e2e\/live\/ci\/backend\.env` and must match the `@objectstack\/spec` version the pinned build in `pnpm-lock\.yaml` declares/;

const readEnvKey = (key: string): string | null =>
  backendEnv.match(new RegExp('^' + key + '=(.+)$', 'm'))?.[1].trim() ?? null;

/**
 * Every `@objectstack/spec` version the lockfile resolves, from both spellings.
 *
 * The resolution keys carry the peer-suffixed identity (`17.2.0(ai@…)`) under
 * `snapshots:` and the bare one under `packages:`; the importer entries carry the same
 * value on their `version:` line. Each is truncated at the first `(` so the three
 * spellings collapse to one comparable number.
 *
 * Since objectui#12957 the lockfile resolves the spec to a DIRECTORY of the pinned
 * build (`'@objectstack/spec@file:.objectstack-pin/spec(ai@…)'`) and
 * records no version for it; that resolution is followed to the version the
 * directory's manifest declares. A directory that is not built answers a value no
 * `OBJECTSTACK_VERSION` can equal, naming the missing build.
 */
function resolvedSpecVersions(): string[] {
  const lock = fs.readFileSync(lockfilePath, 'utf8');
  const found = new Set<string>();

  for (const m of lock.matchAll(/^\s{0,4}'?@objectstack\/spec@file:([^'(\s:]+)/gm)) {
    try {
      found.add(JSON.parse(fs.readFileSync(path.join(repoRoot, m[1], 'package.json'), 'utf8')).version);
    } catch {
      found.add(`(pinned build absent: ${m[1]} — run \`pnpm objectstack:build\`)`);
    }
  }

  for (const m of lock.matchAll(/^\s{0,4}'?@objectstack\/spec@([0-9][^'(\s:]*)/gm)) {
    found.add(m[1]);
  }
  for (const m of lock.matchAll(
    /^\s*'@objectstack\/spec':\s*\n\s*specifier:.*\n\s*version:\s*([0-9][^\s(]*)/gm,
  )) {
    found.add(m[1]);
  }
  return [...found].sort();
}

describe('ci-cd-pipeline.md — live-e2e backend pin (#7689)', () => {
  it('still carries the sentence this block enforces', () => {
    expect(
      PIN_RULE_SENTENCE.test(doc.replace(/\s+/g, ' ')),
      'content/docs/guide/ci-cd-pipeline.md no longer states that the backend pins in ' +
        '`e2e/live/ci/backend.env` must match the `@objectstack/spec` version in ' +
        '`pnpm-lock.yaml`. Everything below is the enforcement of that sentence, so losing it ' +
        'would leave these assertions running on a rule the page stopped teaching. If the rule ' +
        'was retired, retire this describe with it; if the sentence merely moved or was ' +
        'reworded, update PIN_RULE_SENTENCE.',
    ).toBe(true);
  });

  it('resolves exactly one @objectstack/spec version to compare against', () => {
    const versions = resolvedSpecVersions();

    expect(
      versions.length,
      `Nothing in ${path.relative(repoRoot, lockfilePath)} matched either reading of an ` +
        '`@objectstack/spec` resolution. That is a green this test must never report: the ' +
        'comparison below would run against an empty set and pass no matter what ' +
        '`e2e/live/ci/backend.env` says. Either the dependency is genuinely gone — in which ' +
        'case the live lane has nothing to pin and this block should go — or the lockfile ' +
        'format moved and the two regexes above need updating.',
    ).toBeGreaterThan(0);

    expect(
      versions,
      'The lockfile resolves more than one `@objectstack/spec` version:\n' +
        versions.map((v) => `  - ${v}`).join('\n') +
        '\n\nThere is then no single "the resolved version" for `OBJECTSTACK_VERSION` to ' +
        'match, so the live lane cannot be a matched pair against any of them. Resolve the ' +
        'workspace onto one version first; this test deliberately names the split rather than ' +
        'picking a winner.',
    ).toHaveLength(1);
  });

  it('pins OBJECTSTACK_VERSION to the version the lockfile resolves', () => {
    const versions = resolvedSpecVersions();
    if (versions.length !== 1) return; // reported by the test above

    const pinned = readEnvKey('OBJECTSTACK_VERSION');
    expect(
      pinned,
      `${path.relative(repoRoot, backendEnvPath)} declares no OBJECTSTACK_VERSION. ` +
        '`start-backend.sh` sources this file and installs published `@objectstack/*` at that ' +
        'value, so an absent key is not a lighter failure than a wrong one.',
    ).not.toBeNull();

    expect(
      pinned,
      `The live-e2e lane is pinned to an unmatched pair:\n` +
        `  ${path.relative(repoRoot, backendEnvPath)}  OBJECTSTACK_VERSION=${pinned}\n` +
        `  ${path.relative(repoRoot, lockfilePath)}          @objectstack/spec  ${versions[0]}\n\n` +
        'content/docs/guide/ci-cd-pipeline.md states the rule: "Backend pins live in ' +
        '`e2e/live/ci/backend.env` and must match the `@objectstack/spec` version in ' +
        '`pnpm-lock.yaml` — bump both in the same PR, or the run proves nothing." The header ' +
        'of backend.env says the same thing in its own words. A run of `Live E2E ' +
        '(informational)` against this pair therefore carries no information, green or red — ' +
        'it exercises one published backend against a console built for another.\n\n' +
        'Fix it in whichever direction the change came from: a lockfile bump must move ' +
        'OBJECTSTACK_VERSION, and a pin bump must be a lockfile bump. That is the only ' +
        'value to move — the showcase-app commit follows it on its own, because ' +
        'start-backend.sh resolves the `@objectstack/cli@$OBJECTSTACK_VERSION` release tag ' +
        'at boot (objectui#7964). ' +
        '⛔ Do not resolve this by reverting the pin to whatever was green last: a failing ' +
        'matched pair carries strictly more information than a green mismatched one ' +
        '(objectui#7689).',
    ).toBe(versions[0]);
  });

  // Retired here, deliberately, with objectui#7964: `keeps OBJECTSTACK_REF in the one shape
  // start-backend.sh can fetch`. It asserted that a hand-moved sha was 40 hex characters —
  // the only half of that pin a lane with no network could read. There is no hand-moved sha
  // any more, so the shape pin has nothing to hold; the three below hold what replaced it.
  // ⛔ Do not restore it by re-adding the key: a pin that overrides the derivation brings
  // back the exact pair that could silently disagree.

  it('declares no OBJECTSTACK_REF — the commit is derived, not pinned', () => {
    expect(
      readEnvKey('OBJECTSTACK_REF'),
      `${path.relative(repoRoot, backendEnvPath)} declares an OBJECTSTACK_REF again. That ` +
        'key was retired by objectui#7964: it was a second, hand-moved sha whose stated MUST ' +
        '— always the commit the `@objectstack/cli@$OBJECTSTACK_VERSION` release tag points ' +
        'at — nothing could check, and a pair that CAN disagree eventually does (it is the ' +
        'same failure #7689 found in the version half). start-backend.sh resolves the commit ' +
        'from the tag at boot instead, so the app source and the published packages come ' +
        'from one release by construction.\n\n' +
        'If the derivation genuinely cannot serve some case, that is a decision to take on ' +
        'the record — reintroducing the pin here restores the drift, and this lane is ' +
        '`informational`, so nothing else would notice.',
    ).toBeNull();
  });

  it('derives the commit from the @objectstack/cli release tag in start-backend.sh', () => {
    const rel = path.relative(repoRoot, startBackendPath);

    // Pinned by CONTENT, not by behaviour: this lane cannot run the script (it needs the
    // network the whole #7964 argument turns on). What it can read is that the resolution
    // is still there and still keyed off OBJECTSTACK_VERSION — the two things whose loss
    // would leave the absent key above vacuous.
    expect(
      /git ls-remote --tags/.test(startBackend),
      `${rel} no longer resolves the release tag with \`git ls-remote --tags\`. The test ` +
        'above requires backend.env to carry NO OBJECTSTACK_REF, on the understanding that ' +
        'this script derives it. Without a resolution here, that absence is not a design — ' +
        'it is a missing value, and the lane fetches nothing.',
    ).toBe(true);

    expect(
      /refs\/tags\/\$OBJECTSTACK_TAG/.test(startBackend) &&
        /OBJECTSTACK_TAG="@objectstack\/cli@\$OBJECTSTACK_VERSION"/.test(startBackend),
      `${rel} no longer builds the tag it resolves from OBJECTSTACK_VERSION as ` +
        '`@objectstack/cli@$OBJECTSTACK_VERSION`. That coupling is the entire guarantee: it ' +
        'is what makes the checked-out app source and the installed published packages the ' +
        'same release. A tag derived from anything else — a branch, a literal, another ' +
        "package's tag — reopens the gap objectui#7964 closed.",
    ).toBe(true);

    // The refusal is half the ruling: `git ls-remote` prints nothing and exits 0 for a tag
    // that does not exist, so without a shape check the script would carry an empty ref into
    // `git fetch --depth 1 origin ""` and fail 300 seconds later, in a log nobody reads.
    expect(
      /\[\[ ! "\$OBJECTSTACK_REF" =~ \^\[0-9a-f\]\{40\}\$ \]\]/.test(startBackend),
      `${rel} no longer refuses to start when the release tag fails to resolve to a ` +
        '40-character sha. `git ls-remote` reports a missing tag as empty output and exit 0, ' +
        'so this check is the only thing standing between a typo in OBJECTSTACK_VERSION and ' +
        'a 300-second timeout with no explanation. Keep a refusal that names the tag.',
    ).toBe(true);
  });

  it('documents the derivation in backend.env, where the pin used to be', () => {
    expect(
      /no OBJECTSTACK_REF key here/.test(backendEnv) && /DERIVED at\s*\n#\s*boot/.test(backendEnv),
      `${path.relative(repoRoot, backendEnvPath)} no longer explains that the showcase-app ` +
        'commit is derived at boot rather than pinned. The key is absent from this file; a ' +
        'reader who finds no OBJECTSTACK_REF and no note saying why will conclude the pin was ' +
        'dropped by accident and restore it — which is exactly the regression the test above ' +
        'forbids. The absence has to be legible as a decision.',
    ).toBe(true);
  });
});

/**
 * objectui#8043 — the Half-State Patrol section told readers the sweeper's closed-card reader was
 * "switched **off** here via `PM_SWEEP_CLOSED_WINDOW_PAGES: '0'`". The workflow had stopped setting
 * that variable on 2026-08-28: the reader was ON with a dated floor, the page window deliberately
 * absent, and the retired knob survived only in the workflow's header comments as history. So the
 * page sent anyone looking for the switch to a variable nothing set, and — worse in the direction
 * this page is read — it described a predicate as disabled while it ran four times a day.
 *
 * The `workflow inventory` block above cannot see this: it matches filenames in headings and in
 * the inventory table's first column, so a
 * false sentence *inside* a documented section is exactly the drift it is blind to (objectui#7852
 * says so in as many words). This block closes that gap for the one thing on this page that names
 * the patrol's wiring by identifier.
 *
 * objectui#11174 MOVED that wiring, and this block moved with it. The workflow no longer sets the
 * sweeper's environment itself: it calls objectstack's composite action at a pinned sha and
 * configures it through that one step's `with:` INPUTS, which the action maps onto the sweeper
 * upstream. So the comparison is now the section against those inputs — the only place this
 * install records its wiring. The `PM_SWEEP_*` names the section still carries belong to its
 * hand-run recipe, which is the sweeper's own interface and not a setting of this workflow, and are
 * deliberately not read here.
 *
 * ⛔ The workflow side is the patrol step's `with:` mapping, PARSED, never the file as text: the
 * workflow's header argues about inputs (that is where the no-anchor opt-in is explained), and a
 * whole-file grep would accept a section naming any of them. `patrolStepOf` below is
 * unit-controlled against that shape.
 *
 * ⚠️ The page side is a heuristic, stated so it is not mistaken for a parser: the section's
 * backticked kebab-case tokens, which is how an action input is spelled. A future backticked
 * kebab-case word in this section that is NOT an input reads as a phantom below, and the failure
 * says so — rephrase it, or teach `inputsNamedIn` the difference.
 */
const HALF_STATE_WORKFLOW = 'half-state-patrol.yml';

/** The action every half-state install calls, up to the `@` that begins its ref. */
const PATROL_ACTION = 'objectstack-ai/objectstack/.github/actions/half-state-patrol';

type PatrolStep = { ref: string; inputs: Map<string, unknown> };

/**
 * The step of a workflow that calls the patrol action: its ref, and its `with:` inputs as the YAML
 * parser reads them (so `true` is a boolean and `''` an empty string, exactly as the runner gets
 * them before it stringifies). `undefined` when no step calls the action — which every assertion
 * below treats as a failure in its own right, never as "nothing to compare".
 */
function patrolStepOf(yaml: string): PatrolStep | undefined {
  type Step = { uses?: unknown; with?: Record<string, unknown> | null };
  type Job = { steps?: Step[] };
  const parsed = parseYaml(yaml) as { jobs?: Record<string, Job> } | null;
  for (const job of Object.values(parsed?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.uses !== 'string' || !step.uses.startsWith(`${PATROL_ACTION}@`)) continue;
      return {
        ref: step.uses.slice(PATROL_ACTION.length + 1),
        inputs: new Map(Object.entries(step.with ?? {})),
      };
    }
  }
  return undefined;
}

/** The page section headed by `<heading> (`<file>`)`, up to the next heading at that level or above. */
function sectionForWorkflow(file: string): string {
  const lines = doc.split('\n');
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.includes(file));
  if (start === -1) return '';
  const level = lines[start].match(/^#+/)![0].length;
  const after = lines.slice(start + 1);
  const next = after.findIndex((line) => new RegExp(`^#{1,${level}}\\s`).test(line));
  return (next === -1 ? after : after.slice(0, next)).join('\n');
}

/**
 * The action inputs a piece of prose names: backticked kebab-case tokens, alone or as the key of a
 * backticked `name: value`. Dotted file names, slash paths and `word:word` labels are not this
 * shape, so they drop out on their own.
 */
function inputsNamedIn(prose: string): string[] {
  const names = new Set<string>();
  for (const m of prose.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?::\s[^`]*)?`/g)) names.add(m[1]);
  return [...names].sort();
}

describe('ci-cd-pipeline.md — Half-State Patrol wiring (#8043, objectui#11174)', () => {
  const section = sectionForWorkflow(HALF_STATE_WORKFLOW);
  const step = patrolStepOf(readWorkflow(HALF_STATE_WORKFLOW));
  const passed = [...(step?.inputs.keys() ?? [])].sort();
  const named = inputsNamedIn(section);

  it('has both sides to compare — neither may be empty', () => {
    // The vacuity legs. Each has a failure mode that renders the comparisons below green while
    // checking nothing, and each fails silently: a renamed heading empties the section, a step
    // that stopped calling the action (or moved its inputs) empties the workflow side, and a
    // rewrite that drops every input name leaves the page describing the wiring without naming it.
    expect(
      section,
      `No heading on the page names \`${HALF_STATE_WORKFLOW}\`, so this block has no section to ` +
        'read and its comparisons below would pass vacuously. The `workflow inventory` block ' +
        'requires that heading to exist; if it moved, teach `sectionForWorkflow` where it went.',
    ).not.toBe('');

    expect(
      step,
      `${HALF_STATE_WORKFLOW} has no step whose \`uses:\` calls ${PATROL_ACTION}. Either the ` +
        'patrol stopped calling the action — and the section describes a configuration that is ' +
        'gone — or the reference changed shape and `patrolStepOf` is reading the wrong thing.',
    ).toBeDefined();

    expect(
      passed,
      `The patrol step in ${HALF_STATE_WORKFLOW} passes no \`with:\` input at all, so the ` +
        "comparisons below have nothing on the workflow side. The action's `github-token` is " +
        'required, so a step with no inputs cannot run — this is the reader failing, not the ' +
        'configuration emptying.',
    ).not.toEqual([]);

    expect(
      named,
      'The Half-State Patrol section names no action input at all. The reader needs at least ' +
        "the closure floor and the anchor opt-in: they are the things about this install that " +
        "are not the action's own defaults (objectui#8043, objectui#8740).",
    ).not.toEqual([]);
  });

  it("reads the patrol step's parsed inputs, not the file as text", () => {
    // The control for the docblock above. A commented-out input is HISTORY, a folded scalar's body
    // is a VALUE, and another step's `with:` is another action's — a text scan cannot tell any of
    // the three from the patrol's own wiring.
    const specimen = [
      'jobs:',
      '  patrol:',
      '    steps:',
      '      - uses: actions/setup-node@v7',
      '        with:',
      "          node-version: '22'",
      `      - uses: ${PATROL_ACTION}@${'a'.repeat(40)}`,
      '        with:',
      "          # retired-input: '0'  — read until the cutover; history, not a setting",
      "          closed-floor: '2026-08-28'",
      '          folded: >-',
      '            not-a-key: still just prose',
      '',
    ].join('\n');

    const read = patrolStepOf(specimen);
    expect(read?.ref).toBe('a'.repeat(40));
    expect([...(read?.inputs.keys() ?? [])].sort()).toEqual(['closed-floor', 'folded']);
    expect(patrolStepOf(specimen.replace(PATROL_ACTION, 'someone/else/.github/actions/x'))).toBeUndefined();
    // And the page-side reader: an input, an input with its value, and the three shapes that are
    // not inputs and must drop out.
    expect(
      inputsNamedIn("`closed-floor` · `anchor-optional: true` · `x.yml` · `a/b-c` · `pm:dispatched`"),
    ).toEqual(['anchor-optional', 'closed-floor']);
  });

  it('names only inputs the workflow actually passes', () => {
    const phantom = named.filter((name) => !passed.includes(name));

    expect(
      phantom,
      'The Half-State Patrol section names these action inputs:\n' +
        phantom.map((n) => `  - ${n}`).join('\n') +
        `\n\n…and the patrol step in \`${HALF_STATE_WORKFLOW}\` passes none of them. What it does ` +
        'pass is:\n' +
        passed.map((n) => `  - ${n}`).join('\n') +
        '\n\nA reader who goes looking for the knob the page names finds an input nothing sets, ' +
        'and — the expensive direction — believes whatever the page says that knob is doing. ' +
        "That is objectui#8043's shape, one wiring later. Fix the page against the workflow: the " +
        "patrol step's `with:` block is where this install records its wiring. (If the token is " +
        'a backticked kebab-case word that is not an input at all, see this block\'s docblock.)',
    ).toEqual([]);
  });

  it('names every input the workflow passes', () => {
    const missing = passed.filter((name) => !named.includes(name));

    expect(
      missing,
      `The patrol step in \`${HALF_STATE_WORKFLOW}\` passes these inputs and the Half-State ` +
        'Patrol section never names them:\n' +
        missing.map((n) => `  - ${n}`).join('\n') +
        "\n\nThe section presents the step's inputs as the whole of this install's configuration, " +
        'so an input it omits is a setting a reader cannot learn from this page exists.',
    ).toEqual([]);
  });

  it('quotes the closure floor the step is actually given', () => {
    const floor = step?.inputs.get('closed-floor');

    expect(
      typeof floor === 'string' && floor !== '' ? floor : undefined,
      '`closed-floor` is no longer passed to the patrol action as a non-empty value in ' +
        `${HALF_STATE_WORKFLOW}. If the floor was removed, the closed-card reader now judges the ` +
        'whole window and the section is wrong in the other direction; if it merely moved to an ' +
        'expression, this assertion needs to read it from wherever the value now lives.',
    ).toBeDefined();

    expect(named, 'the section must keep naming the floor input').toContain('closed-floor');

    expect(
      section,
      `The workflow floors the closed-card reader at ${String(floor)}, and the Half-State Patrol ` +
        'section does not say so. The date is the whole of the decision — it is what separates ' +
        '"the reader is off" from "the reader judges everything closed since the convention ' +
        'started" — so a page that names the input without its value tells a reader nothing they ' +
        'can check.',
    ).toContain(String(floor));
  });

  it('describes the anchor configuration the step actually passes (objectui#8740)', () => {
    // The section says this board has NO anchor issue and that this is declared, not omitted.
    // Both halves of that declaration are read off the step: an anchor number passed here, or the
    // opt-in dropped, makes the section's account of where the findings go false.
    const anchor = step?.inputs.get('anchor-issue');
    const optional = step?.inputs.get('anchor-optional');

    expect(
      { anchor, optional: String(optional) },
      `The patrol step in ${HALF_STATE_WORKFLOW} no longer passes an empty \`anchor-issue\` ` +
        'beside `anchor-optional: true`. The Half-State Patrol section tells readers this board ' +
        'has no anchor issue by decision and that its findings live in run summaries ' +
        '(objectui#8740, objectstack-ai/objectstack#20793 decision A). If an anchor was ' +
        'configured — which reverses the maintainer\'s decline on objectui#7852 — rewrite that ' +
        'part of the section with it; if the opt-in was dropped, every scheduled run is now red.',
    ).toEqual({ anchor: '', optional: 'true' });

    expect(section).toContain('`anchor-optional: true`');
    expect(named).toContain('anchor-issue');
  });

  it('pins the action to a 40-character sha, as the section says — never a branch', () => {
    // The half of the pin ruling no other check holds. The Action Ref Convention gate's
    // exception for this reference is matched by workflow and action, not by spelling, so
    // `@main` in place of the sha would pass that gate untouched.
    expect(
      step?.ref,
      `${HALF_STATE_WORKFLOW} calls ${PATROL_ACTION} at \`@${step?.ref}\`, which is not a ` +
        "40-character commit sha. A sibling board pins the action to a sha and never to `@main` " +
        '(objectstack-ai/objectstack#18471): `@main` adopts every upstream change on the next ' +
        'run with no reviewed moment and nothing to roll back to. To bump the pin, take ' +
        "objectstack `main`'s tip as read at that moment and record it in the pull request.",
    ).toMatch(/^[0-9a-f]{40}$/);

    expect(section).toContain('40-character objectstack commit sha');
    expect(section).toContain('never `@main`');
  });
});

/**
 * objectui#8238 — the lane promised an artefact its configuration cannot produce.
 *
 * `live-e2e.yml`'s header, its job-summary step, its upload glob and this page's Live E2E
 * section were FOUR spellings of one claim — "failures surface as an uploaded Playwright
 * report" — and all four were decided by a single line somewhere else entirely:
 * `playwright.live.config.ts`'s `reporter`. That line reads `[['list']]`; the `list` reporter
 * writes to stdout and nothing in that config writes `playwright-report/`, so the promised
 * report was unreachable in EVERY outcome. Measured on a passing run and on a failing run:
 * absent both times, with an `html` reporter as the control that proves the directory is
 * observable when a reporter actually writes it.
 *
 * Nothing read those four sites against the config, which is exactly how they drifted, and
 * the cost was not cosmetic: objectui#8084's acceptance criterion was written as "a
 * `playwright-report/` appears in the uploaded artifact", so a correct fix could never have
 * satisfied its stated test. An acceptance criterion nobody can pass is the same hazard as a
 * check nobody can fail, pointed the other way.
 *
 * So this block pins the claim to the mechanism rather than to a sentence. It does not care
 * which way the repository decides the question — it requires only that the reporter list and
 * everything that describes it move together. Turn the HTML reporter on and this test goes red
 * naming every site that must be updated with it; leave it off and the sites must keep quoting
 * the reporter value that makes the absence true.
 */
const LIVE_CONFIG_FILE = 'playwright.live.config.ts';
const liveConfig = fs.readFileSync(path.join(repoRoot, LIVE_CONFIG_FILE), 'utf8');

/**
 * The `reporter:` value exactly as written in a Playwright config, e.g. `[['list']]`.
 *
 * Comments come off first, and they come off through `scripts/js-comment-mask.mjs` — this
 * tree's one answer to "is this span a comment, or code?". The YAML-oriented
 * `withoutComments` above cannot be reused: this is TypeScript, and
 * `playwright.live.config.ts` opens with a 20-line block comment that names the config's
 * behaviour in prose. A whole-file regex would read that prose as configuration — the same
 * class of mistake as counting a commented-out `env:` key.
 *
 * ⛔ And a whole-file regex is exactly what this reader used to do about it (objectui#9613).
 * The paragraph above argued the case against the naive family and the function underneath it
 * WAS one: a block-comment regex plus a `//`-to-end-of-line rule, the second carrying an
 * ad-hoc one-character guard so that the `:` in a URL would save it. A regex has no idea what
 * a string literal is; the guard is a patch over that, not an answer to it.
 *
 * ## How it survived the conversion that was supposed to catch it
 *
 * objectui#9183 moved 29 source-scanning carriers onto the shared mask and ruled this file
 * out of scope because it strips Markdown and YAML — true of the file, and false of this
 * site inside it. ⭐ A census keyed on which FILE holds a stripper cannot see a second
 * stripper in a MIXED file, and an explicit pass and an unseen site read identically
 * afterwards. That is the reusable half of the card, not the call site.
 *
 * ## What was measured before the swap, so the claim is re-derivable
 *
 * Over `playwright.live.config.ts` as it stands, the two strippers agree BYTE FOR BYTE:
 * 1,779 comment bytes either way, zero characters that one calls prose and the other calls
 * code in either direction, and the same `[['list']]` out of both. The population checked was
 * the whole file — every line holding a `//` (four: three `http://` URLs behind a `:`, and
 * the real line comment beside `SELF_DEPTH_BELOW_REPO_ROOT`, which is the only one the naive
 * rule fires on), every string literal holding a `/` (seven), every string literal holding a
 * block-comment opener or terminator (none) and every regex literal (none). So the defect was
 * LATENT: nothing in the config today is mis-read, and the value this reader reports was
 * never wrong. What the swap buys is the shape the config does not hold today and a
 * Playwright config plausibly grows tomorrow — pinned below rather than described here.
 *
 * `stripComments` and not `maskComments` because this reader reports neither a line number
 * nor a byte offset into the source — it returns a captured value — which is the module's own
 * stated rule for choosing between its two projections.
 */
function reporterValueOf(source: string): string | undefined {
  return stripComments(source).match(/^\s*reporter:\s*(.+?),?\s*$/m)?.[1];
}

describe('ci-cd-pipeline.md + live-e2e.yml — the Playwright report claim (#8238)', () => {
  const section = sectionForWorkflow('live-e2e.yml');
  const liveWorkflow = readWorkflow('live-e2e.yml');
  const header = liveWorkflow.slice(0, liveWorkflow.indexOf('\nname:'));
  const reporter = reporterValueOf(liveConfig);
  const declaresHtmlReporter = /['"]html['"]/.test(reporter ?? '');

  it('has all four sides to compare — none may be empty', () => {
    // The vacuity legs. Each failure below is silent: a renamed heading empties the section, a
    // restructured config empties the reporter read, and a header that no longer leads the file
    // empties the header slice. Any one of them would make the assertions pass while comparing
    // nothing — which is the failure mode this whole block exists to prevent elsewhere.
    expect(
      section,
      'No heading on this page names `live-e2e.yml`, so this block has no section to read and ' +
        'its assertions below would pass vacuously. The `workflow inventory` block requires ' +
        'that heading to exist; if it moved, teach `sectionForWorkflow` where it went.',
    ).not.toBe('');

    expect(
      reporter,
      `${LIVE_CONFIG_FILE} no longer declares a \`reporter:\` on a line of its own. That line is ` +
        'what decides whether `playwright-report/` can exist, and every sentence pinned below ' +
        'describes it. If the reporter moved to a variable or a spread, this assertion has to ' +
        'read it from wherever the value now lives — do not delete the comparison, or the four ' +
        'claim sites go back to being unchecked prose (objectui#8238).',
    ).toBeDefined();

    expect(header, 'live-e2e.yml must still open with its header comment block').not.toBe('');
  });

  it('reads the config, not the file as text', () => {
    // The control for the paragraph above. `playwright.live.config.ts`'s header describes the
    // config in prose; a whole-file grep cannot tell that prose from a setting. This is the
    // exact shape of that file, and it is why the parser strips comments first.
    const specimen = [
      '/**',
      " * Run with reporter: [['html']] when you want a browsable report.",
      ' */',
      'export default defineConfig({',
      "  // reporter: [['html']],  — history, not a setting",
      "  reporter: [['list']],",
      '});',
    ].join('\n');

    expect(reporterValueOf(specimen)).toBe("[['list']]");
  });

  it('survives a glob, which is where the hand-rolled stripper would have broken', () => {
    // objectui#9613's carrier, and the reason the reader above goes through the shared mask.
    // The specimen in the previous case is the shape the config has TODAY, and the two-regex
    // stripper this reader used to carry got that one right — measured over the real
    // `playwright.live.config.ts`, the two agreed byte for byte. This is the shape the config
    // does NOT have: a Playwright glob, which spells a block-comment opener inside a string.
    //
    // A regex cannot see a string literal, so it opens a comment there and runs to the next
    // real terminator — the docblock BELOW `reporter:` — taking the reporter line with it.
    // The reader then answers `undefined` and the vacuity leg above reports that the config
    // no longer declares a reporter at all: a false alarm pointing at a config that is fine,
    // which is the expensive direction to fail in. Measured on this exact specimen: the old
    // stripper yields `undefined`, the shared mask yields `[['list']]`.
    //
    // ⛔ Not a synthetic stand-in for the file's behaviour — `testIgnore` and `testMatch` take
    // globs, and this config is one `testIgnore:` away from the shape. The claim about the
    // real file is the measurement in `reporterValueOf`'s docblock, not this case.
    const withGlob = [
      '/**',
      " * Run with reporter: [['html']] when you want a browsable report.",
      ' */',
      'export default defineConfig({',
      "  testIgnore: '**/*.wip.spec.ts',",
      "  // reporter: [['html']],  — history, not a setting",
      "  reporter: [['list']],",
      '  /** Serial by design, so a retry is cheap. */',
      "  use: { trace: 'on-first-retry' },",
      '});',
    ].join('\n');

    expect(reporterValueOf(withGlob)).toBe("[['list']]");
  });

  it('uploads no path the reporter cannot produce', () => {
    // Mechanical and exact: the glob may name `playwright-report/` only when a reporter that
    // writes it is declared. This is the half of #8238 that is not a matter of wording — the
    // upload step listed a directory that could not exist in any outcome, and `upload-artifact`
    // reports that as a warning, not a failure, so nothing ever went red over it.
    const globsReport = /^\s*playwright-report\/\s*$/m.test(withoutComments(liveWorkflow));

    expect(
      globsReport,
      declaresHtmlReporter
        ? `${LIVE_CONFIG_FILE} declares an HTML reporter (\`${reporter}\`) but live-e2e.yml no ` +
          'longer uploads `playwright-report/`, so the lane now produces a report and throws it ' +
          'away. Add the path back to the upload glob.'
        : `live-e2e.yml's upload glob names \`playwright-report/\`, but ${LIVE_CONFIG_FILE} ` +
          `declares \`reporter: ${reporter}\` — no reporter in it writes that directory, so the ` +
          'path matches nothing on a pass, a fail or a crash. Either declare an HTML reporter in ' +
          'that config, or drop the path. ⛔ Do not do neither: the glob is read by humans as a ' +
          'promise that the artefact contains a report, and objectui#8084 wrote an acceptance ' +
          'criterion on exactly that reading which no fix could ever have satisfied.',
    ).toBe(declaresHtmlReporter);
  });

  it('quotes the reporter value both prose sites are describing', () => {
    // The fence, adopted verbatim from #8238: the header, this page's section and the upload
    // glob are spellings of ONE claim and must move together. Requiring both prose sites to
    // quote the reporter value as written turns "they must move together" into something a test
    // can hold: flip the config and both sentences go red until someone rewrites them.
    for (const [name, text] of [
      ['live-e2e.yml’s header comment', header],
      ['the Live E2E section of content/docs/guide/ci-cd-pipeline.md', section],
    ] as const) {
      expect(
        text,
        `${name} does not quote \`${reporter}\`, the reporter list ${LIVE_CONFIG_FILE} actually ` +
          'declares. Both sites tell the reader what a failing run leaves behind, and that ' +
          'answer is decided entirely by this value — a site that describes the artefacts ' +
          'without naming the line that produces them is how this lane spent its whole ' +
          'existence promising a Playwright report it could not write (objectui#8238).',
      ).toContain(reporter!);
    }
  });

  it('says that a green run uploads nothing at all', () => {
    // #8238's second and sharper edge, and the one that outlives whichever way the reporter
    // question is decided. The upload step is gated on `failure()`, so on a green lane it never
    // runs: there is no artifact, so there is no file count, so any acceptance criterion
    // phrased over the artifact's contents is readable ONLY on a run that failed. That trap is
    // what produced objectui#8084's unpassable criterion, and it is invisible from the prose
    // unless the prose says it.
    const uploadStep = withoutComments(liveWorkflow).slice(
      withoutComments(liveWorkflow).indexOf('name: Upload'),
    );

    expect(
      uploadStep,
      'live-e2e.yml has no `Upload` step, so the sentence pinned below is describing a step ' +
        'that is gone. Re-point this assertion or drop the sentence with it.',
    ).not.toBe('');

    expect(
      /if:.*failure\(\)/.test(uploadStep.split('\n').slice(0, 6).join('\n')),
      'live-e2e.yml’s upload step is no longer gated on `failure()`. If it now runs on green ' +
        'runs too, the warning on the page — that a green lane leaves no artifact to inspect — ' +
        'has become false and must be removed in the same PR.',
    ).toBe(true);

    expect(
      section,
      'The Live E2E section does not mention `failure()`. The upload step is gated on it, so a ' +
        'green run of this lane produces NO artifact — not an empty one, none — and a reader ' +
        'who does not know that will write a check against artefact contents that can only ever ' +
        'be read on a red run. objectui#8084 did exactly that. Say it on the page.',
    ).toContain('failure()');
  });
});

/**
 * objectui#8084 defect ② — the lane's RUN conclusion asserted the negation of its JOB's.
 *
 * Measured on the 2026-09-06 nightly, while `live-e2e.yml`'s job carried
 * `continue-on-error: true`:
 *
 *     step 7 `Start ObjectStack backend`    failure
 *     job 101442890465                      failure
 *     check run `Live E2E (informational)`  failure
 *     check suite 92170955546               success
 *     workflow run 34017174769              success
 *
 * The flag moved neither the job nor its check run — the two readings a merge gate and a
 * reviewer consult — and inverted only the aggregate. This is worse than an omission: any
 * monitor, digest or agent reading run-level conclusions was told `success` while the live
 * E2E had not executed at all, which is why the backend outage carded as that issue's defect
 * ① ran a full day unseen. An outage detector that reports the negation of what it detects.
 *
 * ⛔ The repair is NOT to make the lane blocking, and this pin does not ask for that: what
 * makes the lane non-blocking is that it is not in the required-check set and declares no
 * `merge_group` trigger, neither of which `continue-on-error` had anything to do with. The
 * two are compatible; conflating them is the trap the card names.
 *
 * ## Why this is scoped to the job's OWN keys, and why the control below is not optional
 *
 * The entry this replaces in STRUCTURAL_BLOCKS asked `/^\s*continue-on-error:\s*true\s*$/m`
 * of the whole job block and promised, in writing, to go red the day the flag came off the
 * job. It could not: objectui#7048 later split both caches into bounded `save` STEPS that
 * each carry `continue-on-error: true` at step level, and `\s*` matches their indentation
 * just as happily. Two step-level flags kept that assertion green for a property that no
 * longer existed — an assertion that cannot fail, which is this card's own defect one level
 * down.
 *
 * So the matcher here is anchored to four spaces, the indentation of a job's own keys, and
 * the discrimination is EXERCISED rather than assumed: the control asserts that step-level
 * flags really are present in this job and really are not matched. If those saves are ever
 * removed, the control goes red and says so, rather than leaving a matcher that discriminates
 * against nothing.
 */
describe('live-e2e.yml — the run conclusion may not contradict the job (#8084)', () => {
  const liveJob = nestedBlock(topLevelBlock(withoutComments(readWorkflow('live-e2e.yml')), 'jobs'), 'live-e2e');
  const jobOwnKeys = liveJob.split('\n').filter((line) => /^ {4}[a-z]/i.test(line));
  const section = sectionForWorkflow('live-e2e.yml');

  it('has a job block and a page section to read — neither may be empty', () => {
    // The vacuity legs. A renamed job or heading would make every assertion below pass while
    // reading an empty string, which is the failure shape this whole file exists against.
    expect(
      liveJob,
      'the `live-e2e` job is gone from live-e2e.yml (or `jobs:` no longer parses), so the ' +
        'assertions below would compare nothing. Re-point them at wherever the lane now lives.',
    ).not.toBe('');

    expect(
      jobOwnKeys.map((line) => line.trim().split(':')[0]),
      "the job-level key scan found no four-space keys at all, so 'no continue-on-error here' " +
        'would be true of every possible file. Re-derive it from the current indentation.',
    ).toContain('timeout-minutes');

    expect(
      section,
      'No heading on this page names `live-e2e.yml`, so the page half of this claim reads an ' +
        'empty string and passes vacuously.',
    ).not.toBe('');
  });

  it('discriminates job level from step level — the control, exercised not assumed', () => {
    // Without this, the assertion below is indistinguishable from one that would also pass on
    // the broken file: the two cache saves are the exact lines that kept the old pin green.
    const anywhereInJob = liveJob.split('\n').filter((line) => /^\s*continue-on-error:\s*true\s*$/.test(line));

    expect(
      anywhereInJob.length,
      'live-e2e.yml no longer carries any step-level `continue-on-error: true` (the two bounded ' +
        'cache saves objectui#7048 added). Those lines are what made a whole-job regex unable ' +
        'to notice the job-level flag leaving. With them gone the control below no longer ' +
        'proves the matcher discriminates — either restore a control, or state here that the ' +
        'distinction has stopped mattering.',
    ).toBeGreaterThan(0);

    expect(
      anywhereInJob.filter((line) => /^ {4}\S/.test(line)),
      'a four-space `continue-on-error: true` slipped through the step-level filter, which ' +
        'means the two matchers no longer disagree and the control is measuring nothing.',
    ).toEqual([]);
  });

  it('declares no `continue-on-error` on the job itself', () => {
    const jobLevel = jobOwnKeys.filter((line) => /^ {4}continue-on-error\s*:/.test(line));

    expect(
      jobLevel,
      'The `live-e2e` job has `continue-on-error` back on it:\n' +
        jobLevel.map((l) => `  ${l.trim()}`).join('\n') +
        '\n\nThat flag does not make this lane advisory — it is advisory because it is not a ' +
        'required check and declares no `merge_group` trigger. What it does is make the ' +
        'workflow-run and check-suite conclusions report `success` while the job and its check ' +
        'run report `failure`, so every run-level reader is told the negation of what happened ' +
        '(objectui#8084, measured on run 34017174769). If the lane must stop failing runs, fix ' +
        'the lane or narrow what it asserts; ⛔ do not restore the flag that made the aggregate ' +
        'disagree with its own job. Step-level `continue-on-error:` on the cache saves is a ' +
        'different thing and stays.',
    ).toEqual([]);
  });

  it('says on the page that the two conclusions agree', () => {
    // The map -> page direction, so the sentence cannot be dropped while this stays green.
    for (const phrase of ['continue-on-error', 'run conclusion']) {
      expect(
        section,
        `The Live E2E section of content/docs/guide/ci-cd-pipeline.md no longer mentions ` +
          `"${phrase}". That section is where a reader learns this lane is advisory AND honest ` +
          `— that its run conclusion agrees with its job — and unpinned prose about this exact ` +
          `property is what objectui#8084 was filed about. Say it there, or retire this pin ` +
          `with it.`,
      ).toContain(phrase);
    }
  });
});

/**
 * ── The alias rule, and the section reader both parity describes share ───────
 *
 * Settled by objectui#8420's first instance pair and documented in full in the
 * header of the `vi-mock and shadcn` describe below — that comment is still where
 * the DECISION lives and where the limits on it are argued. What moved here is
 * only the CODE, when objectui#8420's second instance set needed the same rule
 * for four more sections: two copies of a rule are two rules, and the next edit
 * would have fixed one of them. Module scope so there is exactly one.
 *
 * ⛔ Moving it changes nothing about its blast radius. `ci.yml`'s job table and
 * the `lint.yml` section still call `commandParity` directly and are still pinned
 * by the unmodified module-scope rule; only a describe that calls `byGate` opts in.
 */

/** Root `package.json` script bodies, for resolving an alias to the gate it runs. */
const rootScriptBodies = (
  JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

/** `scripts/<file>` -> the one root alias that is exactly `node scripts/<file>`. */
function aliasByScript(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [name, body] of Object.entries(rootScriptBodies)) {
    const wrapped = /^node\s+(scripts\/[\w./-]+)$/.exec(body.trim())?.[1];
    if (!wrapped) continue;
    map.set(wrapped, [...(map.get(wrapped) ?? []), name]);
  }
  return map;
}

/**
 * One spelling per gate: the alias when the alias is a pure wrapper, otherwise the
 * command as written. Applied to both sides of a unit, so the two are compared by
 * one rule rather than by two spellings of it.
 */
function canonical(command: string, aliases: Map<string, string[]>): string {
  const named = aliases.get(command);
  if (named?.length === 1) return `pnpm ${named[0]}`;
  return command;
}

/** A unit with both of its sides put through `canonical`. */
function byGate(unit: CommandParity): CommandParity {
  const aliases = aliasByScript();
  return {
    label: unit.label,
    ran: new Set([...unit.ran].map((c) => canonical(c, aliases))),
    named: new Set([...unit.named].map((c) => canonical(c, aliases))),
  };
}

/** A `##`/`###` section of the page, up to the next heading at its level or above. */
function section(heading: string): string {
  const start = doc.indexOf(heading);
  expect(start, `the page must still have a "${heading}" section`).toBeGreaterThan(-1);
  const level = /^#+/.exec(heading)![0].length;
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * objectui#8420: the same pairing again, on the two sections the card measured by
 * hand — and the alias question that had to be settled before either pin could be
 * pointed at them.
 *
 * ## The two instances
 *
 * `vi-mock-specifiers.yml` runs TWO gates in one job: `check-vi-mock-specifiers.mjs`
 * and `check-vi-mock-inherit.mjs`. The section named only the first, and the second
 * is a blocking step of a required context (`dependabot-merge-gate.mjs` classifies
 * `Inert vi.mock Specifier Check`) — so a contributor reading that section to learn
 * what CI does to their pull request did not know a gate that can stop it exists.
 * Measured on `256c709e2`, searching the whole page for both spellings in one
 * command: `check-vi-mock-inherit` returned 0 and `check-vi-mock-specifiers`
 * returned 3, which is what makes the zero a reading rather than a failed probe.
 *
 * `shadcn-check.yml`'s section described the job in three prose bullets and named
 * none of the three first-party commands it runs.
 *
 * ## ⛔ Why this is two pins and not a loop over the page
 *
 * The card measured the naive extension — pair every `## Heading (some.yml)`
 * section against every job in that workflow — and it flags 24 of the 34 sections,
 * MOST of which are not defects: a section that names a neighbouring gate for
 * contrast (and says so), an illustrative `scripts/some-gate.mjs` placeholder
 * inside a code block, and sections that name a `pnpm check:*` alias where the
 * workflow invokes `node scripts/…` directly. A gate that cries wolf gets switched
 * off rather than fixed — this repository's own words, in
 * `check-unreferenced-sources`. So sections join this rule one at a time, each
 * after somebody has decided what that section's documentation surface IS.
 *
 * ## ⭐ The alias decision, and its blast radius
 *
 * Settled here for these two units only: **an alias whose root `package.json`
 * definition is exactly `node scripts/<file>` names the same gate as invoking that
 * file directly.** `pnpm check:vi-mock-specifiers` IS
 * `node scripts/check-vi-mock-specifiers.mjs` — same script, same population, same
 * verdict — and the vi.mock section names the alias because that is how a
 * contributor runs it locally. Without this, `undocumentedCommands` reads the two
 * spellings as two commands and reports the page's own "run it locally" line as a
 * phantom gate: cry wolf, on the first section this rule was pointed at.
 *
 * What the decision deliberately does NOT do:
 *
 *   - **It does not merge an alias that carries arguments.** `pnpm shadcn:check` is
 *     `node scripts/shadcn-sync.js --check` and `pnpm shadcn:update` is the same
 *     script with `--update`; collapsing both onto the script would let the page
 *     document one and the workflow run the other. An alias with arguments selects
 *     a MODE, and is only ever the same command as itself.
 *   - **It does not reach the other 32 sections, nor the `ci.yml` table or the
 *     `lint.yml` section above.** Those two were settled without it and are pinned
 *     by the unmodified module-scope rule; re-pointing them is a separate card, not
 *     a silent side effect of this one.
 *   - **It does not make the pre-install distinction disappear.** Several workflows
 *     invoke `node scripts/…` rather than the alias because the step runs BEFORE
 *     `pnpm install`, which is real and deliberate. That is a fact about step
 *     PLACEMENT; this rule measures which gates a job runs, and on that question
 *     the two spellings are one gate.
 */
describe('ci-cd-pipeline.md — the vi-mock and shadcn sections', () => {
  const VI_MOCK_HEADING = '### Inert vi.mock Specifiers — the Inert vi.mock Specifier Check step';
  const SHADCN_HEADING = '### Shadcn Component Check (`shadcn-check.yml`)';

  function units(): CommandParity[] {
    return [
      byGate(
        checkParity(
          'Inert vi.mock Specifier Check',
          section(VI_MOCK_HEADING),
          'repo-gates.yml `Inert vi.mock Specifier Check`',
        ),
      ),
      byGate(
        commandParity(
          'shadcn-check.yml',
          'check-components',
          section(SHADCN_HEADING),
          'shadcn-check.yml `check-components`',
        ),
      ),
    ];
  }

  it('resolves each pure alias to exactly one gate', () => {
    // The control on the decision above. Two root scripts spelled `node scripts/x`
    // for the same `x` would make `canonical` pick one arbitrarily, and the pins
    // below would then compare a spelling nobody chose. `canonical` keeps the raw
    // command when that happens; this says so out loud instead of leaving it silent.
    const ambiguous = [...aliasByScript()].filter(([, names]) => names.length > 1);
    expect(
      ambiguous.map(([script, names]) => `${script}: ${names.join(', ')}`),
      'more than one root `package.json` script is exactly `node <script>` for the same ' +
        'script. The alias decision documented above assumes one alias per gate; with two, ' +
        'the parity pins below fall back to the raw spelling and stop merging the alias with ' +
        'the path — which reads as a phantom gate on any section that names the other alias.',
    ).toEqual([]);

    // And a positive control on the resolver itself: it must actually resolve the
    // alias this section depends on, or the pins are green for the wrong reason.
    expect(
      canonical('scripts/check-vi-mock-inherit.mjs', aliasByScript()),
      '`pnpm check:vi-mock-inherit` must still be exactly `node scripts/check-vi-mock-inherit.mjs` ' +
        'in the root package.json — the vi.mock section names the gate both ways, and the pins ' +
        'below only agree because those two spellings resolve to one gate.',
    ).toBe('pnpm check:vi-mock-inherit');
  });

  it('documents the only job each of the two workflows defines', () => {
    // The units above cover one job per workflow. A second job would run gates that
    // no assertion here reads and no section here documents, so it comes through
    // this test first — the shape `lint.yml`'s pin uses, one workflow each.
    for (const [file, keys] of [
      // objectui#12214: the vi.mock gates are steps of `repo-gates.yml`'s one job.
      ['repo-gates.yml', ['repo-gates']],
      ['shadcn-check.yml', ['check-components']],
    ] as const) {
      expect(
        jobKeys(fs.readFileSync(path.join(workflowDir, file), 'utf8'), file),
        `${file} no longer defines exactly ${keys.join(', ')}. The section pinned below ` +
          'documents that job alone, so a new job needs its own documentation and its own unit ' +
          'here — otherwise its gates are unpinned and undocumented at once.',
      ).toEqual([...keys]);
    }
  });

  it('names every first-party command the two jobs actually run', () => {
    const all = units();

    // A parser that matched nothing would make both directions vacuously green. The
    // floor is a control on the matcher, not a ratchet on the gate count.
    const ran = all.reduce((n, u) => n + u.ran.size, 0);
    expect(ran, 'the `run:` parse found implausibly few first-party commands').toBeGreaterThan(3);

    const missing = undocumentedCommands(all);

    expect(
      missing,
      `these jobs run commands that the section documenting them in ` +
        `content/docs/guide/ci-cd-pipeline.md does not name:\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        `\n\nAdd each one to its section, in the order the workflow runs it. An alias and a ` +
        `\`node scripts/…\` invocation of the same wrapper count as one gate, so either ` +
        `spelling satisfies this — objectui#8420: \`check-vi-mock-inherit.mjs\` blocked merges ` +
        `from a section that never mentioned it.`,
    ).toEqual([]);
  });

  it('credits the two jobs with no first-party command they do not run', () => {
    const all = units();

    const named = all.reduce((n, u) => n + u.named.size, 0);
    expect(named, 'the two sections parsed to implausibly few commands').toBeGreaterThan(3);

    const phantom = phantomCommands(all);

    expect(
      phantom,
      `these sections of content/docs/guide/ci-cd-pipeline.md name commands the job they ` +
        `document does not run:\n` +
        phantom.map((p) => `  - ${p}`).join('\n') +
        `\n\nEither the step was removed and the prose is stale, or the command runs in another ` +
        `workflow and belongs in that section. A section reads as its job's gate list, so ` +
        `naming a command inside it makes the page claim a guardrail — the objectui#3451 ` +
        `mistake. To cite a neighbouring gate for contrast, name it without its \`scripts/\` ` +
        `path and say why, as the Lint section does for \`check-entry-guard.mjs\`.`,
    ).toEqual([]);
  });
});

/**
 * ⭐ Lifted to module scope by objectui#9463, for the reason the alias rule above
 * was: the whole-page sweep below declares the SAME phantoms at a coarser
 * granularity (per workflow, not per job), and two copies of a declaration are two
 * declarations — the next edit would have corrected one of them and left the other
 * saying the opposite. The sweep re-keys these instead of restating them, so there
 * is exactly one place where "this command is right to be on the page" is argued.
 */
/**
 * Commands these sections name that their job's `run:` steps do not contain — and
 * which are RIGHT to be there. Each entry is a claim about why the instrument
 * cannot see the command, ⛔ never "this one is inconvenient".
 *
 * Asserted as an exact set, so it works in both directions: a new phantom fails
 * here, and a declared one whose prose disappears fails as **stale** rather than
 * quietly widening the hole. That is the same shape as the shrink-only ratchets
 * elsewhere in this repository, for the same reason — an allowlist nobody has to
 * shrink stops being a record of debt and becomes permission.
 */
const DECLARED_NON_RUN_COMMANDS = new Map<string, string>([
  [
    'performance-budget.yml `bundle-analysis`: pnpm test',
    'A cross-reference to the suite you are reading right now, not a claim about this ' +
      'workflow: the section says the 350 KB figure is pinned to the YAML and "fails `pnpm test` ' +
      'if this page disagrees with it". That suite runs in `ci.yml`.',
  ],
  [
    'changeset-release.yml `release`: pnpm changeset:publish',
    "Really run by the release job, through `changesets/action@v1`'s `publish:` INPUT rather " +
      'than a `run:` step — so this rule cannot see it on the workflow side. Deleting it from ' +
      'the page would remove the only description of how a release actually reaches npm.',
  ],
  [
    'changeset-release.yml `release`: pnpm check:published-dist',
    'The blocking copy of the Published Dist Gate, reached the same way: it is the second leg of ' +
      '`pnpm changeset:publish`, which runs through the action input. The section names it to ' +
      'explain why the refresh lane deliberately does NOT run it.',
  ],
  [
    'changeset-release.yml `release`: pnpm check:spec-floors',
    'The third leg of `pnpm changeset:publish`, same action input, same invisibility. The ' +
      'section quotes that script body verbatim and names this gate to explain why the nightly ' +
      '`spec-range-floors.yml` is an alarm rather than the blocking copy.',
  ],
  [
    'changeset-release.yml `release`: scripts/objectstack-floor.mjs',
    'The first leg of `pnpm changeset:publish` (objectui#12958), same action input. The section ' +
      'quotes that script body verbatim and names this step to say what it computes before a publish.',
  ],
]);

/**
 * objectui#8420, second instance set: the four sections a full census of this page
 * measured as real command-parity defects.
 *
 * ## Why four, and why not a loop over the page
 *
 * The card warned that the naive extension — pair every `## Heading (some.yml)`
 * section against every job in that workflow — flags most of the page and that most
 * of those flags are not defects. It does: 15 of the 36 workflow sections disagree
 * with their workflow under the settled alias rule. The census that preceded these
 * pins accounted for all 36 individually, and the disagreements split like this:
 *
 *   - **4 already pinned** — `ci.yml`, `lint.yml`, `vi-mock-specifiers.yml`,
 *     `shadcn-check.yml`.
 *   - **11 legitimate exceptions** — a section naming a neighbouring gate for
 *     contrast and saying so, an illustrative `scripts/some-gate.mjs` placeholder,
 *     a file named in an enumeration of the workflow's *trigger paths*, an alias
 *     that carries an argument and therefore selects a MODE (`pnpm governed` is
 *     `node scripts/check-governed-queue-guard.mjs --test`).
 *   - **4 with no first-party command on either side** — the job's work is done by
 *     a third-party action.
 *   - **13 that agree today** and are held that way by nothing.
 *   - **4 true defects** — the ones pinned below.
 *
 * So this is still four named sections, not a sweep. The other 32 are accounted for
 * by that census, ⛔ not by silence, and joining any of them to this rule is still a
 * decision about what that section's documentation surface IS.
 *
 * ## What each of the four was hiding
 *
 * `## Performance Budget` was the one that mattered, and it hid two gates rather
 * than one:
 *
 *   - `pnpm check:sdui-registration-pins` runs in a step of its own with no
 *     `continue-on-error`, and the section contained the strings `sdui`, `SDUI` and
 *     `registration` **zero** times. `"sideEffects": false` is statically coherent
 *     and still drops live SDUI widget registrations out of the build entirely
 *     (objectui#6535) — a gate a contributor could be stopped by and could not find.
 *   - `pnpm check:eager-closure` is the **second half of the budget step itself**,
 *     and the section's rule read *"Exactly one bundle-size number in this
 *     repository is enforced"*. Two are. See the enforcement test below for the exit
 *     path that says so.
 *
 * The other three were each a build the section describes in prose and does not
 * name: `turbo run build` in `skill-examples.yml` and `spec-range-floors.yml`,
 * `pnpm build` in `changeset-release.yml`'s release job.
 *
 * ## ⚠️ The blind spot this set makes explicit
 *
 * `commandParity` reads `run:` steps and nothing else. A command a job really runs
 * through an **action input** is invisible to it, and `changeset-release.yml` runs
 * two that way through `changesets/action@v1`'s `publish:`. Reading those as
 * phantoms and deleting them from the page would be the instrument editing the
 * truth to match itself. They are declared below instead, with the reason, and the
 * declaration is asserted in BOTH directions so it cannot rot into an allowlist.
 */
describe('ci-cd-pipeline.md — the four sections measured as parity defects', () => {
  const PERF_HEADING = '## Performance Budget (`performance-budget.yml`)';
  const SKILL_EXAMPLES_HEADING = '### Skill Examples — the Skill Example Check step';
  const CHANGESET_RELEASE_HEADING = '### Changeset Release (`changeset-release.yml`)';
  const SPEC_RANGE_FLOORS_HEADING = '### Spec Range Floors (`spec-range-floors.yml`)';

  /**
   * The one job per workflow that these sections document, and the label a failure
   * names it by. `changeset-release.yml` has two jobs; only `release` runs anything
   * first-party, and the test below holds `lane` to that.
   */
  const PINNED = [
    ['performance-budget.yml', 'bundle-analysis', PERF_HEADING],
    ['changeset-release.yml', 'release', CHANGESET_RELEASE_HEADING],
    ['spec-range-floors.yml', 'spec-range-floors', SPEC_RANGE_FLOORS_HEADING],
  ] as const;

  function units(): CommandParity[] {
    return [
      ...PINNED.map(([file, job, heading]) =>
        byGate(commandParity(file, job, section(heading), `${file} \`${job}\``)),
      ),
      // objectui#12214: the skill-example gate is a set of `repo-gates.yml` steps,
      // and its `turbo run build` is the job's shared build step.
      byGate(
        checkParity('Skill Example Check', section(SKILL_EXAMPLES_HEADING), 'repo-gates.yml `Skill Example Check`', {
          withSharedBuild: true,
        }),
      ),
    ];
  }

  it('documents every job these four workflows define', () => {
    // One unit per job is the shape; a new job would run gates that no assertion here
    // reads and no section here documents, so it comes through this test first.
    for (const [file, keys] of [
      ['performance-budget.yml', ['bundle-analysis']],
      ['repo-gates.yml', ['repo-gates']],
      ['changeset-release.yml', ['lane', 'release']],
      ['spec-range-floors.yml', ['spec-range-floors']],
    ] as const) {
      expect(
        jobKeys(fs.readFileSync(path.join(workflowDir, file), 'utf8'), file),
        `${file} no longer defines exactly ${keys.join(', ')}. The section pinned below ` +
          'documents the job(s) named here, so a new job needs its own documentation and its own ' +
          'unit — otherwise its gates are unpinned and undocumented at once.',
      ).toEqual([...keys]);
    }

    // `changeset-release.yml`'s `lane` job is pinned by exclusion: it answers the
    // publish-vs-refresh question from a sparse checkout and runs no first-party
    // command at all, which is the only reason one unit covers this workflow. If it
    // grows one, that gate is undocumented and unpinned until someone notices here.
    const laneYaml = fs.readFileSync(path.join(workflowDir, 'changeset-release.yml'), 'utf8');
    expect(
      [...firstPartyCommands(runSteps(jobBlock(laneYaml, 'lane', 'changeset-release.yml')).join('\n'))],
      "changeset-release.yml's `lane` job now runs a first-party command. Only its `release` job " +
        'is paired against the Changeset Release section, so this one is invisible to the parity ' +
        'pins below — give `lane` its own unit, or document the command in that section and widen ' +
        'the unit to cover both jobs.',
    ).toEqual([]);
  });

  it('resolves the eager-closure alias to exactly one gate', () => {
    // The positive control on the alias rule for THIS set. The budget step spells the
    // closure gate `node scripts/check-eager-closure-budget.mjs` and the page names it
    // both ways; the pins below only agree because those spellings resolve to one gate.
    expect(
      canonical('scripts/check-eager-closure-budget.mjs', aliasByScript()),
      '`pnpm check:eager-closure` must still be exactly `node scripts/check-eager-closure-budget.mjs` ' +
        'in the root package.json. Without that, the Performance Budget section reads as naming a ' +
        'gate its workflow does not run — the cry-wolf failure this rule is built to avoid.',
    ).toBe('pnpm check:eager-closure');
  });

  it('names every first-party command the four jobs actually run', () => {
    const all = units();

    // A parser that matched nothing would make both directions vacuously green.
    const ran = all.reduce((n, u) => n + u.ran.size, 0);
    expect(ran, 'the `run:` parse found implausibly few first-party commands').toBeGreaterThan(8);

    const missing = undocumentedCommands(all);

    expect(
      missing,
      `these jobs run commands that the section documenting them in ` +
        `content/docs/guide/ci-cd-pipeline.md does not name:\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        `\n\nAdd each one to its section, in the order the workflow runs it. An alias and a ` +
        `\`node scripts/…\` invocation of the same wrapper count as one gate, so either spelling ` +
        `satisfies this — objectui#8420: \`check:sdui-registration-pins\` could fail a run from a ` +
        `section that mentioned neither SDUI nor registrations.`,
    ).toEqual([]);
  });

  it('names no command outside the declared non-`run:` set', () => {
    const all = units();

    const named = all.reduce((n, u) => n + u.named.size, 0);
    expect(named, 'the four sections parsed to implausibly few commands').toBeGreaterThan(8);

    expect(
      phantomCommands(all).sort(),
      `the set of commands these sections name but their job's \`run:\` steps do not contain has ` +
        `changed. Each declared entry is a claim that the instrument, not the page, is the one ` +
        `that cannot see the command — a \`changesets/action@v1\` \`publish:\` input, or a ` +
        `cross-reference to a gate that runs in another workflow. A NEW entry is the objectui#3451 ` +
        `shape unless it is one of those: a page advertising a guardrail that is not there. A ` +
        `MISSING entry means the prose that justified it is gone, so delete the declaration with ` +
        `it rather than leaving an allowlist nobody has to shrink.\n\nDeclared:\n` +
        [...DECLARED_NON_RUN_COMMANDS].map(([k, why]) => `  - ${k}\n      ${why}`).join('\n'),
    ).toEqual([...DECLARED_NON_RUN_COMMANDS.keys()].sort());
  });

  /**
   * ⭐ objectui#8420's one reading that is not about naming a command.
   *
   * The section's "Enforced limit" rule used to be *"Exactly one bundle-size number
   * in this repository is enforced"*, and it named the 350 KB entry-chunk line. The
   * budget step opens `# TWO measurements, one verdict` — and a comment saying
   * "verdict" proves nothing, so what this test reads is the **exit path**:
   *
   *     set +e
   *     node scripts/check-eager-closure-budget.mjs
   *     CLOSURE_CODE=$?
   *     set -e
   *     if [ "$CLOSURE_CODE" -eq 2 ]; then … exit 1; fi
   *     if [ "$ENTRY_OVER" -eq 1 ] || [ "$CLOSURE_CODE" -ne 0 ]; then … exit 1; fi
   *
   * The closure's exit code is captured and both of its non-zero values fail the
   * step, which declares no `continue-on-error`. It enforces. The page now says two
   * numbers are enforced, and this test fails if either side stops being true.
   *
   * ⛔ The closure ceiling's VALUE is deliberately absent from the page and asserted
   * absent below: objectui#8816 is an open decision on that exact ceiling and
   * objectui#7848 measures its headroom, so a value copied here would be a number
   * nothing fails when it moves — the shape the workflow's own comment refuses for
   * the same constant.
   */
  describe('the eager-closure half of the budget step', () => {
    /** The budget step body, from its `- name:` line to the next step at that indent. */
    function budgetStep(): string {
      const start = workflow.indexOf('      - name: Check console performance budget');
      expect(start, 'the budget step must still be named "Check console performance budget"').toBeGreaterThan(-1);
      const rest = workflow.slice(start + 1);
      const next = rest.indexOf('\n      - name: ');
      return next === -1 ? rest : rest.slice(0, next);
    }

    it('is a real gate: the step captures its exit code and exits non-zero on it', () => {
      const step = budgetStep();

      // Not the `# pnpm check:eager-closure` line in the step's own comment block —
      // that spelling appears there too, and a rule that reads comments as commands
      // would call this green on a step that ran nothing.
      const invocations = step
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !line.startsWith('#') && line.includes('check-eager-closure-budget.mjs'));
      expect(
        invocations,
        'the budget step no longer INVOKES `scripts/check-eager-closure-budget.mjs` outside its ' +
          'own comments. The Performance Budget section says two bundle-size numbers are enforced ' +
          'by this step; if the second one moved or went away, rewrite that section with it.',
      ).toHaveLength(1);

      // The COMPOSITION half (objectui#7479), held to the same three conditions:
      // a gate whose exit code nothing reads is a reading printed into a log.
      const catalogueInvocations = step
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !line.startsWith('#') && line.includes('check-eager-locale-catalogues.mjs'));
      expect(
        catalogueInvocations,
        'the budget step no longer INVOKES `scripts/check-eager-locale-catalogues.mjs` outside its ' +
          'own comments. The Performance Budget section says three measurements are enforced by ' +
          'this step; if the third one moved or went away, rewrite that section with it.',
      ).toHaveLength(1);

      for (const [pattern, what] of [
        [/CLOSURE_CODE=\$\?/, "capture the checker's exit code"],
        [/"\$CLOSURE_CODE"\s+-eq\s+2/, 'treat exit 2 (a verdict about the gauge) as its own case'],
        [/"\$CLOSURE_CODE"\s+-ne\s+0/, 'fail the step on any non-zero closure verdict'],
        [/CATALOGUE_CODE=\$\?/, "capture the composition checker's exit code"],
        [
          /"\$CATALOGUE_CODE"\s+-eq\s+2/,
          'treat the composition exit 2 (a verdict about the gauge) as its own case',
        ],
        [/"\$CATALOGUE_CODE"\s+-ne\s+0/, 'fail the step on any non-zero composition verdict'],
      ] as const) {
        expect(
          step,
          `the budget step no longer appears to ${what}. Without it the eager-closure half is a ` +
            'reading printed into a log and nothing else, and the "Enforced limits" table in ' +
            'content/docs/guide/ci-cd-pipeline.md is advertising a guardrail that is not there.',
        ).toMatch(pattern);
      }

      // A step that reports and continues enforces nothing, whatever its `exit` lines say.
      expect(
        step.split('\n').filter((line) => /^\s{8}continue-on-error\s*:/.test(line)),
        'the budget step has grown a `continue-on-error:`. That makes both of its measurements ' +
          'advisory while the page calls them enforced.',
      ).toEqual([]);
    });

    it('says so on the page, with every enforced row marked enforced', () => {
      const sec = section(PERF_HEADING);

      const rows = sec.split('\n').filter((line) => /^\|/.test(line) && /Yes —/.test(line));
      expect(
        rows.length,
        'the "Enforced limits" table no longer carries three enforced rows. The budget step makes ' +
          'three measurements and any one can fail it, so the page must not read as one enforced ' +
          'number — that sentence ("Exactly one bundle-size number in this repository is ' +
          'enforced") is what objectui#8420 measured as false. The third row is the ' +
          'locale-catalogue composition verdict (objectui#7479), which is not a size at all.',
      ).toBe(3);

      expect(
        rows.some((row) => /[Ee]ager closure/.test(row)),
        'the enforced rows no longer include the eager closure. It is the second half of the same ' +
          'step and it fails the run on its own, so it belongs beside the entry-chunk line.',
      ).toBe(true);

      expect(
        rows.some((row) => /check:eager-locale-catalogues/.test(row)),
        'the enforced rows no longer include the locale-catalogue composition verdict. It is the ' +
          'third half of the same step and it fails the run on its own — and it is the only one ' +
          'of the three that can tell "the catalogues left the closure" from "the catalogues ' +
          'moved to a chunk with more room".',
      ).toBe(true);

      // The retired sentence, with a positive control in the same test so a rename of
      // the section cannot make this zero for the wrong reason.
      expect(
        sec,
        'the "exactly one enforced number" claim is back on the page. Two are enforced by one step.',
      ).not.toMatch(/[Ee]xactly one bundle-size number/);
      expect(
        sec,
        'the Performance Budget section no longer names `MAX_ENTRY_GZIP_KB` — the control for the ' +
          'assertion above just went vacuous, so re-point both at wherever this section moved.',
      ).toContain('MAX_ENTRY_GZIP_KB');
    });

    it('restates the closure ceiling nowhere on the page', () => {
      const gate = fs.readFileSync(path.join(repoRoot, 'scripts/check-eager-closure-budget.mjs'), 'utf8');
      const literal = /^export const MAX_EAGER_CLOSURE_GZIP_BYTES = ([\d_]+);$/m.exec(gate)?.[1];

      // Positive control: an unreadable constant would make every assertion below
      // vacuously green, which is the failure this whole family exists to prevent.
      expect(
        literal,
        '`MAX_EAGER_CLOSURE_GZIP_BYTES` is no longer a plain literal export of ' +
          'scripts/check-eager-closure-budget.mjs, so this test can no longer tell whether the ' +
          'page restates it. Re-point the extraction before trusting the green below.',
      ).toBeDefined();

      const digits = literal!.replace(/_/g, '');
      expect(digits, 'the extracted ceiling does not look like a byte count').toMatch(/^\d{6,}$/);

      for (const spelling of [literal!, digits, digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')]) {
        expect(
          doc,
          `content/docs/guide/ci-cd-pipeline.md restates the eager-closure ceiling as ` +
            `"${spelling}". ⛔ It must not: the constant lives beside the argument that produced ` +
            `it, objectui#8816 is an open decision on that exact value and objectui#7848 measures ` +
            `its headroom — a copy here is a number that nothing fails when it moves, which is ` +
            `precisely how the superseded console figure survived on this page for months ` +
            `(objectui#3197). Name the gate and say that it enforces; leave the value to ` +
            `\`pnpm check:eager-closure\`, which prints payload, ceiling and headroom together.`,
        ).not.toContain(spelling);
      }
    });
  });
});

/**
 * objectui#8629: three live populations on this page were written down as literals
 * with nothing deriving them — the docs-page population the eager-closure section
 * credits to the route, the file population the shell-escape section credits to the
 * `skills` scan root, and the sweeper's page window, copied out of a source
 * constant. The first was already false when the card was filed. ⛔ Correcting the
 * numerals would have been the same card again in a month, which is the ruling
 * objectui#7448, objectui#7825 and objectui#7965 have each recorded after doing
 * exactly that; the page now names the tree each population is derived from and the
 * run that prints it, and these pins refuse a count written back.
 *
 * ## ⭐ The unit, which is the transferable half
 *
 * Both defective sentences WRAP: the numeral sat at the end of one line and its noun
 * at the start of the next. A per-line reader returns **zero** for each of them on a
 * file where they are plainly present — measured, not theorised, twice: by the seat
 * that verified this card and by objectui#8606 from the workflow-header side. So
 * every assertion below judges JOINED text, and the first test proves the unit is
 * really joined by finding a phrase this page carries that no single line contains.
 *
 * ## Why these are section-scoped and not page-wide
 *
 * ⛔ A page-wide ban on "N files" would flag the sentences that are CORRECT — the
 * skills-paths measurement and the test-file cell each state the commit they were
 * measured on, the changeset-overwrite figure states its window. Those declare what
 * they measured, which is the remedy, not the defect; rewriting them into live
 * figures would create the defect. The scope of each pin is therefore the one
 * section whose sentence was stating a population it did not derive.
 *
 * ⚠️ The shape gap this docblock used to record as open is closed — rewritten
 * here deliberately rather than swept, because the record of WHY the defect was
 * invisible is the only artefact that explains how it survived three passes. What
 * it recorded: the family's noun pattern took whitespace and only whitespace before
 * the noun, so a hyphenated attributive (`N-page docs build`) never matched, on this
 * page or in the gate header that mirrors the same cost argument. objectui#9004
 * widened the separator to `[\s-]+` below, and that instance is gone from both.
 *
 * ⛔ The reason the card gave for not widening — that the pattern is shared with
 * the other carriers, so one pin may not move it alone — does not survive reading
 * the carriers. It is NOT shared. Each spells its own: the lint-workflow carrier and
 * the merge-queue carrier both put a bounded any-character gap between the numeral
 * and the noun rather than `\s+`, so both already judge the hyphenated form and
 * neither moves when this one does. This helper is a `const` inside this block and
 * its blast radius is this file. Measured by running all three carriers, not assumed.
 *
 * ⚠️ What the widening still does not reach, which is a reading and not an
 * assumption: every assertion here is built from a named section of THIS page, so
 * the mirror in the eager-closure gate's own header is outside all of them. It gets
 * its own assertion below, over that header's text — otherwise half of objectui#9004
 * would be a repair with nothing able to notice it come back.
 */
describe('ci-cd-pipeline.md — populations are pointed at, never counted in prose', () => {
  const EAGER_HEADING = '### Docs Route Eager Closure — the Docs Route Eager Closure Check step';
  const RESIDUE_HEADING = '### Shell Escape Residue — the Shell Escape Residue Scan step';
  const PATROL_HEADING = '### Half-State Patrol (`half-state-patrol.yml`)';

  /** A section of the page as one line — the unit every assertion here judges. */
  const flat = (heading: string): string => section(heading).replace(/\s+/g, ' ').trim();

  /**
   * `<number> <noun>`, the family's own shape, applied to joined text — with the
   * separator widened from `\s+` to `[\s-]+` so the hyphenated attributive
   * (`N-page docs build`) is judged too, not only the spaced form. The docblock
   * above this block records why that widening is local to this carrier.
   */
  const population = (noun: string): RegExp =>
    new RegExp(
      String.raw`\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]+${noun}\b`,
      'i',
    );

  it('judges joined text — a per-line reader cannot see these sentences at all', () => {
    // The control is built from the page rather than hard-coded, so a re-wrap moves
    // it instead of breaking it: three consecutive words that straddle a line break
    // and appear on no single line. If this page ever stops wrapping its prose the
    // control goes undefined and says so, rather than passing on a reader that has
    // quietly become per-line-equivalent.
    const lines = doc.split('\n');
    const joined = doc.replace(/\s+/g, ' ');
    let control: string | undefined;
    for (let i = 0; i < lines.length - 1; i += 1) {
      const before = lines[i].trim().split(/\s+/);
      const after = lines[i + 1].trim().split(/\s+/);
      if (before.length < 3 || after.length < 3) continue;
      const candidate = `${before[before.length - 2]} ${before[before.length - 1]} ${after[0]}`;
      if (!/^[\w'’,.—-]+ [\w'’,.—-]+ [\w'’,.—-]+$/.test(candidate)) continue;
      if (!joined.includes(candidate)) continue;
      if (lines.some((line) => line.includes(candidate))) continue;
      control = candidate;
      break;
    }
    expect(
      control,
      'no phrase on this page straddles a line break any more, so the joined-text unit below is ' +
        'no longer demonstrably stronger than a per-line one. Check how the page is wrapped ' +
        'before trusting any zero from the assertions in this block.',
    ).toBeDefined();

    // Both halves asserted, so "clean" can never mean "unreadable": the phrase IS in
    // the joined text and is NOT in any line. That gap is exactly the one that hid
    // two of this card's three defects from the census that went looking for them.
    expect(joined).toContain(control!);
    expect(lines.filter((line) => line.includes(control!))).toEqual([]);
  });

  it('states no docs-page population, and names what derives it instead', () => {
    const sec = flat(EAGER_HEADING);

    // Positive controls first: an assertion that the section does not contain a count
    // is vacuously green on a section that moved or emptied.
    for (const anchor of [
      'registerCatalogBlocks.ts',
      'apps/site/source.config.ts',
      '`content/docs`',
      '`gauge:`',
    ]) {
      expect(
        sec,
        `the Docs Route Eager Closure section no longer names ${anchor}. That is the pointer this ` +
          'card put in place of the count, so re-point it (or the negative assertion below is ' +
          'guarding nothing).',
      ).toContain(anchor);
    }

    // Parity: the two things the page now points at have to be real, or the pointer is
    // just a different kind of unchecked prose.
    const sourceConfig = fs.readFileSync(path.join(repoRoot, 'apps/site/source.config.ts'), 'utf8');
    expect(
      sourceConfig,
      "apps/site/source.config.ts no longer declares `dir: '../../content/docs'`. The page tells " +
        'readers the docs-page population is derived from the directory this file declares — ' +
        'say where it is derived from now.',
    ).toMatch(/dir:\s*'\.\.\/\.\.\/content\/docs'/);
    const gate = fs.readFileSync(
      path.join(repoRoot, 'scripts/check-docs-route-eager-closure.mjs'),
      'utf8',
    );
    expect(
      gate,
      'scripts/check-docs-route-eager-closure.mjs no longer prints a `gauge:` line naming the ' +
        'route roots it crawled. The page points at that line as the live reading, so either the ' +
        'line comes back or the page must point somewhere else.',
    ).toMatch(/gauge: \$\{[^}]+\} modules crawled from \$\{[^}]+\} route roots/);

    const counted = sec.match(population('(?:docs\\s+)?pages?'));
    expect(
      counted?.[0],
      `the Docs Route Eager Closure section states a docs-page population again (found ` +
        `"${counted?.[0]}"). ⛔ That is the defect this card removed, not a stale number to ` +
        `refresh: "all 181 docs pages" was false against a corpus of 184 git-tracked .md/.mdx ` +
        `files and nothing could go red over it. The population is derived from the docs ` +
        `collection directory on every run — name the directory and the reading, never the number.`,
    ).toBeUndefined();
  });

  it("states no docs-page population in the gate's own header either", () => {
    // The mirror site. The page argues the ruling for readers and the gate header
    // argues it for whoever maintains the script; both used to price it with a
    // literal nothing derived. Removing one and leaving the other is how a figure
    // comes back — so the header is judged here, as joined text, the same way.
    const src = fs.readFileSync(
      path.join(repoRoot, 'scripts/check-docs-route-eager-closure.mjs'),
      'utf8',
    );
    const header = (/\/\*\*[\s\S]*?\*\//.exec(src)?.[0] ?? '').replace(/\s+/g, ' ').trim();

    // Positive controls first: a "does not contain" assertion is vacuously green on
    // a header that moved, emptied, or stopped being about this subject at all.
    for (const anchor of ['registerCatalogBlocks.ts', 'objectui#6316', '`gauge:`']) {
      expect(
        header,
        `the eager-closure gate no longer opens with a docblock naming ${anchor}. That header is ` +
          'the mirror of this page\'s cost argument; re-point this pin before trusting its green.',
      ).toContain(anchor);
    }

    const counted = header.match(population('(?:docs\\s+)?pages?'));
    expect(
      counted?.[0],
      `the eager-closure gate's header states a docs-page population again (found ` +
        `"${counted?.[0]}"). \u26d4 Not a stale number to refresh: the header carried two of them ` +
        `and both were false — one priced a hypothetical byte budget at a page count nothing ` +
        `derived, the other charged an import to a page count that was already wrong against the ` +
        `tracked .md/.mdx corpus. The gate prints the live reading on every run as its \`gauge:\` ` +
        `line — name that reading, never a numeral.`,
    ).toBeUndefined();
  });

  it('states no `skills` file population, and points at the per-root reading', () => {
    const sec = flat(RESIDUE_HEADING);

    for (const anchor of ['`SCAN_ROOTS`', 'scripts/check-shell-escape-residue.mjs', 'file(s)']) {
      expect(
        sec,
        `the Shell Escape Residue section no longer names ${anchor} — the negative assertion ` +
          'below needs that pointer present to be guarding anything.',
      ).toContain(anchor);
    }

    // Parity: the gate really does print a per-root reading in the shape the page
    // quotes. Without this, the page could point at a reading that no longer exists.
    const gate = fs.readFileSync(path.join(repoRoot, 'scripts/check-shell-escape-residue.mjs'), 'utf8');
    for (const [pattern, what] of [
      [/file\(s\)/, 'a per-root `N file(s)` figure'],
      [/fence\(s\)/, 'a per-root `N fence(s)` figure'],
    ] as const) {
      expect(
        gate,
        `scripts/check-shell-escape-residue.mjs no longer prints ${what}. The page sends readers ` +
          'to that run for what the `skills` root holds, so the reading has to survive or the ' +
          'page has to be re-pointed.',
      ).toMatch(pattern);
    }

    const counted = sec.match(population('files?'));
    expect(
      counted?.[0],
      `the Shell Escape Residue section states a file population again (found "${counted?.[0]}"). ` +
        '⛔ A live count of what the `skills` scan root holds, written where nothing derives it, ' +
        'is what this card removed. The gate prints that figure per root on every run — point at ' +
        'the run, never at a numeral.',
    ).toBeUndefined();
  });

  it('copies no closed-card window out of the sweeper, and names the export instead', () => {
    const sec = flat(PATROL_HEADING);

    // ⚠️ This pin decides nothing about whether a `pages?` noun that means *paginated
    // API result pages* belongs to objectui#7448's family at all — that question is
    // objectui#7966's and it is open. It holds only the local fact: a constant copied
    // into prose rots when the export moves, whichever way the noun set is ruled.
    //
    // ⚠️ The sweeper is objectstack's and is not in this tree since objectui#10208, so the
    // export this names is NOT re-read here: whether objectstack still exports it is a
    // reading this test cannot take. What it holds is the page side — a name, never a value.
    expect(
      sec,
      'the Half-State Patrol section no longer names `CLOSED_ISSUE_WINDOW_DAYS`. That name is ' +
        'what replaced the copied value, so restore the pointer rather than the number.',
    ).toContain('`CLOSED_ISSUE_WINDOW_DAYS`');

    for (const noun of ['pages?', 'days?']) {
      const counted = sec.match(population(noun));
      expect(
        counted?.[0],
        `the Half-State Patrol section states a closed-card window again (found "${counted?.[0]}"). ` +
          'The sweeper exports it as CLOSED_ISSUE_WINDOW_DAYS — naming the export survives the ' +
          'value moving, a copy of the value does not.',
      ).toBeUndefined();
    }
  });
});

/**
 * ── objectui#9463: command parity by DEFAULT, for every workflow section ─────
 *
 * The two blocks above pin 8 of this page's 38 workflow sections, each joined by
 * hand after somebody decided what that section's documentation surface IS. The
 * remaining 30 were priced at roughly thirty more rounds, one section per pull
 * request, because objectui#8420 measured the naive sweep at 24 of 34 flagged and
 * ruled that "a gate that cries wolf gets switched off rather than fixed".
 *
 * ⭐ That ruling was right then and does not survive its own follow-up work. What
 * made a sweep impossible was that nothing could separate a legitimate exception
 * from a real defect. objectui#8420's census classified every section individually
 * and NAMED the false-positive population, so the separation now exists and the
 * cheaper shape is the one that inverts the default: every section is pinned, and
 * the exceptions are written down with a reason each.
 *
 * ## What inverting actually costs, measured on origin/main at 38 sections
 *
 *   38 sections  =  21 that agree outright  +  17 the rule flags
 *   17 flagged   =  15 phantom-only (the page names a command the job does not
 *                   run)  +  2 in the direction that can hurt somebody
 *
 * ⛔ The 2 are not declared away. They were repaired on the page in the same change,
 * because both are the exact harm this rule exists to catch — a gate a contributor
 * can be stopped by and cannot find:
 *
 *   - `doc-component-types.yml` runs `pnpm check:prompt-keys` in a step of its own
 *     with no `continue-on-error`, and the section named neither the script nor the
 *     alias.
 *   - `changeset-presence.yml` grew a SECOND job, `changeset-claims`, and the
 *     section documented only the first.
 *
 * ⭐ **Both landed on 2026-09-11, two days after the census that had put both of
 * those sections in its "agrees today, and nothing holds them that way" bucket.**
 * That is the whole argument for inverting rather than queueing: the census did not
 * find them because they did not exist yet, and a thirty-deep one-section-per-PR
 * queue would not have found them either. A default that pins everything makes the
 * next section born pinned instead of joining the queue.
 *
 * ## ⛔ What this does NOT do
 *
 * ⛔ It weakens nothing. No assertion above is relaxed, no accept set widened, no
 * blocking check demoted; `undocumentedCommands` — the direction that hides a gate —
 * admits no exception at all here, and the per-job pins above keep running unchanged
 * on top of this. Everything below is added coverage.
 *
 * ⚠️ **It does extend the alias rule's blast radius, and that was left as a separate
 * decision on purpose.** The header of the vi-mock/shadcn block says the alias
 * decision "does not reach the other 32 sections … re-pointing them is a separate
 * card, not a silent side effect of this one." objectui#9463 IS that separate card,
 * so the side effect is neither silent nor a side effect. ⛔ The rule itself is
 * applied verbatim and re-litigated nowhere: a pure `node scripts/<file>` wrapper is
 * one gate with its alias, an alias carrying an ARGUMENT stays its own command.
 *
 * ⚠️ **The one instance the alias question is still open on is reported, ⛔ not
 * decided here.** `## Governed Surface Guard` names both `pnpm governed --  <paths>`
 * and `node scripts/check-governed-queue-guard.mjs --test <paths>` as ways to ask the
 * same question locally, while the job runs that script with `--self-test` and with
 * no argument. Because `governed` carries `--test`, the settled rule refuses to merge
 * it and it reads as a phantom. It is declared below with that reason. Whether an
 * argument-carrying alias should ever merge is a maintainer's call on the rule, not
 * an implementer's on this section.
 */

/** Every workflow section of the page: `NAME.yml` -> the heading that opens it. */
function documentedWorkflowSections(): Map<string, string> {
  const byFile = new Map<string, string>();
  for (const line of doc.split('\n')) {
    const m = /^(#{1,6}) .*\(`([^`]+\.yml)`\)[ \t]*$/.exec(line);
    if (!m) continue;
    const [, hashes, file] = m;
    const held = byFile.get(file);
    // The shallowest heading wins, so a workflow documented by a `##` section with a
    // `###` sub-gate inside it (`doc-snippet-types.yml`) is read as ONE surface —
    // which is what the page means and what a contributor reads.
    if (held && /^#+/.exec(held)![0].length <= hashes.length) continue;
    byFile.set(file, line);
  }
  return byFile;
}

/**
 * One unit per SECTION: every first-party command every job of that workflow runs,
 * against the whole section documenting it.
 *
 * ⛔ Per workflow and not per job, deliberately. The page documents a workflow in one
 * section; pairing per job would demand the section attribute each command to the job
 * that runs it, which is a claim this page does not make and should not be forced to.
 * The per-job pins above keep the finer grain where somebody chose it.
 */
function sweepUnits(): CommandParity[] {
  return [...documentedWorkflowSections()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, heading]) => {
      const yaml = fs.readFileSync(path.join(workflowDir, file), 'utf8');
      const ran = new Set<string>();
      for (const key of jobKeys(yaml, file)) {
        for (const c of firstPartyCommands(runSteps(jobBlock(yaml, key, file)).join('\n'))) ran.add(c);
      }
      return byGate({ label: file, ran, named: firstPartyCommands(section(heading)) });
    });
}

/**
 * The four per-job declarations above, re-keyed to this block's per-workflow labels.
 *
 * ⛔ Re-keyed rather than restated: the claim "this command is right to be on the
 * page" is argued in exactly one place, and a reason edited there reaches here.
 */
function inheritedDeclarations(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, why] of DECLARED_NON_RUN_COMMANDS) {
    const m = /^(\S+\.yml) `[^`]+`: (.+)$/.exec(key);
    if (m) out.set(`${m[1]}: ${m[2]}`, why);
  }
  return out;
}

/**
 * `<workflow>: <command>` -> why the page is RIGHT to name a command its workflow's
 * jobs do not run. Every entry is a claim about the page or the instrument, ⛔ never
 * "this one is inconvenient", and each was re-read on the section before being
 * written here.
 *
 * Asserted as an exact set in both directions, like the per-job map it extends: a new
 * phantom fails as undeclared, and a declared one whose prose disappears fails as
 * STALE rather than quietly widening the hole.
 */
const SWEEP_DECLARED_NON_RUN_COMMANDS = new Map<string, string>([
  [
    'changeset-guard.yml: scripts/check-changeset-presence.mjs',
    'Introduced by the words "Deliberately not listed": the overwrite gate imports that ' +
      "script's base-ref resolver and frontmatter reader, so the section names it to say it is a " +
      'shared dependency rather than a step of this workflow.',
  ],
  [
    'changeset-guard.yml: scripts/invoked-as.mjs',
    'Named as "a dependency the gate scripts import, but a widely shared one" — a module, not a ' +
      'command this job runs.',
  ],
  [
    'changeset-guard.yml: pnpm test',
    'A cross-reference to the suite you are reading: the section says `pnpm test` asserts the ' +
      'same repository state "so the rule survives this workflow being skipped". That suite runs ' +
      'in `ci.yml`.',
  ],
  [
    'changeset-guard.yml: pnpm changeset',
    'The local authoring command, named to explain why the `adjective-animal-verb` filenames it ' +
      'allocates are collision-safe and hand-picked ones are not. Never a job step.',
  ],
  [
    'check-links.yml: pnpm docs:check-links',
    "The SIBLING checker, named in this section's two-checker comparison table whose own `Runs` " +
      "column names `repo-gates.yml`'s Internal Docs Link Check. ⚠️ Dual-eligible: this job has " +
      'no `run:` step at all (its ' +
      'work is `lycheeverse/lychee-action`), so the rule reads no command on the workflow side ' +
      'either.',
  ],
  [
    'docs-deploy.yml: turbo run build',
    'The job really runs it, but not in a `run:` step. `vercel build` runs it as the ' +
      '`buildCommand` of `apps/site/vercel.json`, so the parser cannot see it on the workflow ' +
      "side. The section names it to say the deploy builds exactly what `ci.yml`'s Build Docs " +
      'job builds (objectui#12178).',
  ],
  [
    'repo-gates.yml: scripts/check-required-check-set.mjs',
    'Named as the one thing in this tree that can READ the merge queue\'s required set, in the ' +
      'sentence saying none of the folded gates was in it (objectui#12214). A different ' +
      "workflow's instrument, cited to keep the claim falsifiable.",
  ],
  [
    'repo-gates.yml: scripts/dependabot-merge-gate.mjs',
    'Named as the registry whose `REQUIRED_CONTEXTS` declares this context blocking — the ' +
      'declaration, not a command.',
  ],
  [
    'repo-gates.yml: pnpm check:eager-closure',
    'Named expressly to say it weighs the CONSOLE and not this route: "The cards that added to ' +
      'that list said the cost was governed by `check:eager-closure`. It was not." Deleting it ' +
      'would delete the correction.',
  ],
  [
    'governed-surface-guard.yml: scripts/dependabot-merge-gate.mjs',
    'Named as "the only thing this repository can write down, and has" about required contexts — ' +
      'a declaration this section points at, not a step it runs.',
  ],
  [
    'governed-surface-guard.yml: pnpm governed',
    '⚠️ The one surviving argument-carrying alias. `governed` is ' +
      '`node scripts/check-governed-queue-guard.mjs --test`, and an alias that carries an ' +
      'argument selects a MODE, so the settled rule correctly refuses to merge it with the ' +
      "`--self-test` and bare invocations the job runs. The section offers it as the local " +
      'reproduction spelling and names the raw `--test` spelling beside it. ⛔ Whether such an ' +
      'alias should ever merge is a decision about the RULE — reported, not taken here.',
  ],
  [
    'half-state-patrol.yml: scripts/pm/check-half-states.mjs',
    "objectstack's sweeper, in objectstack's tree — no such file exists in this one. The section " +
      'names it as what the pinned objectstack action runs, and again in the hand-run recipe a ' +
      'seat types inside an objectstack checkout. ⚠️ Dual-eligible: since objectui#11174 this ' +
      'job has no `run:` step at all (its work is the `uses:` of that action), so the rule reads ' +
      'no command on the workflow side either.',
  ],
  [
    'hook-selftests.yml: scripts/dependabot-merge-gate.mjs',
    'Named as what classifies this check `OPTIONAL_CONTEXTS`. ⚠️ Dual-eligible: the job drives ' +
      'the hook self-tests and the rule reads no first-party command from that step.',
  ],
  [
    'line-citation-gate.yml: scripts/dependabot-merge-gate.mjs',
    'Named as the registry that classifies this report-only check `NOT_A_GATE` — the reason the ' +
      'section gives for it never blocking.',
  ],
  [
    'line-citation-gate.yml: pnpm census:cross-file-line-citations',
    'The page says so itself: the tree-wide census "runs in no workflow", and is named to ' +
      'contrast the right instrument for sizing the class against the differential gate that ' +
      'decides a pull request.',
  ],
  [
    'lockfile-dedupe.yml: scripts/dependabot-merge-gate.mjs',
    'Named as the registry that classifies this check `OPTIONAL_CONTEXTS` — the declaration that ' +
      'makes its red block a Dependabot auto-merge, and the one file a maintainer edits to demote ' +
      'it. A declaration this section points at, not a step this workflow runs.',
  ],
  [
    'lockfile-dedupe.yml: scripts/invoked-as.mjs',
    "Named inside the section's TRIGGER sentence, which enumerates this path-filtered gate's " +
      'runtime closure (`check-lockfile-dedupe.mjs` imports `isEntrypoint` from it) to say a ' +
      'change to the checker cannot ship without running it. A path the workflow watches, not a ' +
      'command any job invokes.',
  ],
  [
    'lockfile-integrity.yml: scripts/dependabot-merge-gate.mjs',
    'Named as the registry that classifies this workflow `NOT_A_GATE`, in the sentence explaining ' +
      'that it cannot block anything today.',
  ],
  [
    'merge-queue-head-patrol.yml: scripts/dependabot-merge-gate.mjs',
    'Named as the declaration that would have to be edited if this workflow ever grew a ' +
      '`pull_request` leg — the argument for not having one.',
  ],
  [
    'node-esm-load-gate.yml: pnpm check:esm-specifiers',
    'The gate\'s OTHER leg, named to say it does not run here: "reads sources and needs no build, ' +
      'so it runs per pull request in Type Check, not in this workflow".',
  ],
  [
    'repo-gates.yml: scripts/invoked-as.mjs',
    'Named as the module every pre-install script imports since objectui#6092 — data the gate ' +
      'walks, and the tail of the illustrative failure chain under "If it fails".',
  ],
  [
    'repo-gates.yml: scripts/some-gate.mjs',
    'An illustrative PLACEHOLDER in the example failure chain ' +
      '`scripts/some-gate.mjs -> scripts/invoked-as.mjs -> typescript`. No such file exists.',
  ],
  [
    'published-dist-gate.yml: pnpm check:published-tsconfig-exclude',
    'The per-PR sibling that covers the CONFIG half, named to say where it runs instead: ' +
      '"runs in Type Check".',
  ],
  [
    'required-check-set-patrol.yml: scripts/dependabot-merge-gate.mjs',
    'Named as the classifier every `pull_request` job\'s check run must pass through — the ' +
      'section\'s stated reason for having no `pull_request` leg.',
  ],
]);

describe('ci-cd-pipeline.md — command parity, every workflow section', () => {
  it('reads one section per workflow — a shrunken enumeration is a broken reader', () => {
    // The control the whole block rests on. If the heading regex stopped matching,
    // every assertion below would pass by comparing nothing at all — the vacuous
    // green this file's inventory reader was given the same guard against.
    const sections = documentedWorkflowSections();
    const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

    expect(
      workflowFiles.filter((f) => !sections.has(f) && !DOCUMENTATION_EXEMPT.has(f)),
      'these workflows have no heading of the form "## Title (`name.yml`)" on ' +
        'content/docs/guide/ci-cd-pipeline.md, so the parity sweep below never reads them. The ' +
        'inventory test at the top of this file says the same thing about the same set — if it ' +
        'is green and this is red, the heading exists but not in the form this reader parses.',
    ).toEqual([]);

    expect(
      [...sections.keys()].filter((f) => !workflowFiles.includes(f)),
      'these headings name a `.yml` that is not in .github/workflows/. The sweep would crash ' +
        'reading it; delete the section or restore the workflow.',
    ).toEqual([]);
  });

  it('finds commands on both sides — a silent parser would make every pin below vacuous', () => {
    const units = sweepUnits();

    // Floors, not ratchets: they catch a parser that stopped matching, which is the
    // only way "nothing disagrees" can be true while the page is wrong.
    expect(
      units.reduce((n, u) => n + u.ran.size, 0),
      'the `run:` parse found implausibly few first-party commands across every workflow. ' +
        'Dozens of jobs in this repository run a `scripts/` gate; a handful means `jobBlock`, ' +
        '`runSteps` or `firstPartyCommands` stopped matching, not that CI shrank.',
    ).toBeGreaterThan(60);

    expect(
      units.reduce((n, u) => n + u.named.size, 0),
      'the page parse found implausibly few first-party commands across every section. This ' +
        'page names a gate in almost every section; a handful means the section reader broke.',
    ).toBeGreaterThan(60);

    // And the inherited declarations must actually arrive. An empty re-key would let
    // real phantoms read as undeclared — or, worse, silently shrink the exact-set
    // assertion below to something nobody wrote.
    expect(
      [...inheritedDeclarations().keys()].sort(),
      'the per-job declarations above no longer re-key onto this block\'s labels, so the ' +
        'phantoms they explain are about to be reported as undeclared. Check the key format of ' +
        'DECLARED_NON_RUN_COMMANDS against the regex in `inheritedDeclarations`.',
    ).toEqual([
      'changeset-release.yml: pnpm changeset:publish',
      'changeset-release.yml: pnpm check:published-dist',
      'changeset-release.yml: pnpm check:spec-floors',
      'changeset-release.yml: scripts/objectstack-floor.mjs',
      'performance-budget.yml: pnpm test',
    ]);
  });

  it('names every first-party command every workflow job actually runs', () => {
    // ⛔ No exception list in this direction, by design. A command a job runs and the
    // page does not name is a gate a contributor can be stopped by and cannot find —
    // objectui#8420's `check:sdui-registration-pins`, objectui#9463's
    // `check:prompt-keys`. There is no such thing as a legitimate one.
    const missing = undocumentedCommands(sweepUnits());

    expect(
      missing,
      'these workflows run first-party commands that their section on ' +
        'content/docs/guide/ci-cd-pipeline.md does not name:\n' +
        missing.map((m) => `  - ${m}`).join('\n') +
        '\n\nAdd each one to its section. An alias and a `node scripts/…` invocation of the same ' +
        'pure wrapper count as one gate, so either spelling satisfies this. ⛔ There is no ' +
        'exception list for this direction: a gate the page hides is the defect this whole file ' +
        'exists for.',
    ).toEqual([]);
  });

  it('declares every command a section names that its workflow does not run', () => {
    const declared = new Map([...inheritedDeclarations(), ...SWEEP_DECLARED_NON_RUN_COMMANDS]);
    const phantoms = phantomCommands(sweepUnits()).sort();

    // Exact set, both directions. A new phantom fails as undeclared; a declaration
    // whose prose has gone fails as stale, so the list stays a record of reasoned
    // exceptions rather than becoming permission.
    expect(
      phantoms,
      'the set of commands this page names that the workflow documenting them does not run has ' +
        'changed.\n\nIf a NEW entry appears: either the page now credits a workflow with a gate ' +
        'it does not run — fix the page — or there is a real reason it belongs there, in which ' +
        'case add it to SWEEP_DECLARED_NON_RUN_COMMANDS with that reason written out.\n\nIf an ' +
        'entry has GONE: its declaration is stale and must be deleted, or the prose it explained ' +
        'was removed by accident.\n\nCurrently declared:\n' +
        [...declared].map(([k, why]) => `  - ${k}\n      ${why}`).join('\n'),
    ).toEqual([...declared.keys()].sort());
  });
});
