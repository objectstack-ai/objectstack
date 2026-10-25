#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * markdown-test-inputs -- which markdown documents are a TEST'S INPUT, and
 * which test reads each.
 *
 *   node scripts/markdown-test-inputs.mjs --list            the adjudicated class
 *   node scripts/markdown-test-inputs.mjs --audit           re-derive and compare
 *   node scripts/markdown-test-inputs.mjs --changed -       read paths on stdin
 *   node scripts/markdown-test-inputs.mjs --changed a.md b.md
 *
 * `--changed` prints the subset of the paths handed to it that this repository
 * has recorded as a test's input, one per line, and exits 0 whether or not the
 * subset is empty -- an EMPTY LIST IS AN ANSWER, and a non-zero exit means the
 * question could not be answered at all. That distinction is the whole contract
 * with the caller in `ci.yml`, which treats "could not answer" as RUN.
 *
 * ## The blind spot this exists to close (objectui#8861)
 *
 * The `Decide whether this change needs a full run` step in `ci.yml` diffs a
 * pull request against its merge base with every markdown path excluded, and
 * skips the expensive jobs when nothing is left. That fast path is deliberate
 * and that workflow says so in its own comment. It is sound wherever a markdown
 * change is INERT.
 *
 * It is not inert when a test READS the markdown file as data. Then a
 * markdown-only pull request mutates a test's input while skipping the test that
 * consumes it, and the pull request page goes green on a question nobody asked.
 *
 * Measured, not hypothetical: objectui#8857 changed exactly one file,
 * `packages/plugin-dashboard/README.md`. Every check on the pull request was
 * green -- `Test (shard 1/4)` reported success after ten seconds, having run
 * nothing. The merge queue, whose build short-circuits this step to "run
 * everything", then took 907 seconds on the same shard and FAILED it
 * (`SyntaxError: Unexpected token 'export'`, out of the test that reads that
 * README), and the pull request was dequeued. The queue did its job; the cost is
 * that the signal arrived after review had concluded on a green page.
 *
 * ## ⛔ Why this ships a LEDGER rather than a number
 *
 * Two probes have been run at this class and returned two different numbers --
 * 21 and 27 -- and NEITHER of them is the class. Both counted co-occurrence
 * (a test file that calls `readFileSync(` and also mentions `README.md`), and a
 * co-occurrence count is not a class predicate: a test may read something else
 * entirely and merely mention a README in its prose, several read
 * `content/docs/**` rather than a package README, and at least three read a
 * whole DIRECTORY TREE of markdown without naming a single document. Each
 * candidate has to be asked WHAT IT IS before it counts. This repository has
 * written that lesson down before (objectui#8468: one grep matched three
 * different constructs, two of them correct code).
 *
 * So the thing that ships is the derivation, in two halves that check each
 * other:
 *
 *   `ADJUDICATED`   the answer a human gave for every candidate -- what the test
 *                   reads (`reads`), and which of the scanner's guesses it does
 *                   NOT read (`notRead`), so a rejected candidate is recorded as
 *                   rejected instead of vanishing.
 *   `deriveCandidates()`  the scanner that produces the candidates from the tree
 *                   again on every run. `auditTree()` compares the two, and a
 *                   candidate nobody has adjudicated is a FINDING.
 *
 * That is what keeps the class true as documents are added: a new test that
 * reads a markdown document appears as an unadjudicated candidate and reds the
 * audit, and a new document dropped into a tree that is already declared
 * (`content/docs/**`) is covered the moment it lands.
 *
 * ## objectui#9096 -- `scripts` joins the scan, and what that ruling costs
 *
 * objectui#8861 left `scripts/__tests__/**` out and gave this reason:
 *
 *   ⛔ "`scripts/__tests__/**` is deliberately OUT of the hazard class:
 *      `scripts/**` is not on the exclusion list, so a PR touching it already
 *      gets a full run."
 *
 * ⛔ That sentence is true about a pull request that touches THE TEST. The
 * hazard is a pull request that touches THE MARKDOWN THE TEST READS. Those are
 * different pull requests, and only the second one is invisible.
 *
 * ### The measurement, and why the population count is the wrong unit
 *
 * Every one of the 46 candidate files under `scripts/__tests__` was run under
 * an `fs` trace and the markdown it opened was recorded. The union is not
 * "nearly every markdown document in the tree" -- it is EVERY one of them:
 * 1805 of 1805 tracked `.md` / `.mdx` files are opened by at least one of these
 * tests. One file does it alone: `dollar-dialect-alias-census.test.ts` scans
 * every tracked path through a helper module, which is limit 2 below in its
 * purest form -- the scanner cannot see that read at all, and it is the read
 * that makes the class total.
 *
 * ⇒ so the honest statement of this ruling is: on the `test` job, the decision
 * step's markdown exclusions are now INERT. Any markdown-only pull request runs
 * the shards.
 *
 * The reason that is nonetheless the right ruling is that documents are the
 * wrong unit to price it in. Runs are. Measured over the 513 first-parent
 * commits on `main` available at the time of writing:
 *
 *   36  reached the second stage at all (everything they changed was excluded)
 *   21  of those already run, on the class objectui#8861 declared
 *   15  still skipped -- the blind spot this card is about
 *   14  of those 15 fire once `scripts` is a scan root
 *    1  of those 15 still skips, and SHOULD: `8011852dc` changed only
 *       `apps/site/**` and carried no markdown at all
 *
 * ⇒ the price of making the class total is 14 extra full runs per 513 merges
 * (2.7pp), because 93% of merges change something outside the exclusions and
 * already run. The exclusion list itself does NOT go inert: non-markdown paths
 * under `content/**`, `docs/**` and `apps/site/**` still skip, and that last
 * commit is the live control for it.
 *
 * ### ⚠️ What a reviewer should weigh against it
 *
 * triage on objectui#9096 wrote "⛔ Do not widen the `Test (shard N/4)` trigger
 * to 'every markdown file' ... a resolved input list, ⛔ not a glob". The
 * MECHANISM that fence prescribes is intact -- the workflow still consults a
 * derived, adjudicated, self-auditing list and never a glob. Its EFFECT is not:
 * the list's answer is now `true` for every markdown path. That tension is real
 * and is left visible on purpose rather than argued away. The two numbers a
 * reviewer needs to reverse this are above: 1805 of 1805 documents, 14 of 513
 * merges.
 *
 * ### Where the trees come from
 *
 * A `…/**` entry below means "this test walks this tree". Where a test read
 * most of a tree, the tree is declared rather than its files, which is the same
 * over-produce-rather-than-miss direction the scanner takes: the cost of a
 * declared document nothing reads is one extra run, and the cost of a missed
 * one is the defect this file exists to close.
 *
 * ### The repository root is a tree too -- `./*` (objectui#9142)
 *
 * The entries above buy their whole value from INHERITANCE: a page added under
 * `content/docs/` is on the trigger the moment it lands, because the tree was
 * declared rather than its members. The repository root had no tree spelling,
 * so its documents were declared one by one -- and a root document nobody had
 * declared yet was not on the trigger at all. Adding `SECURITY.md` skipped
 * `Test (shard N/4)`, and `check-doc-links.test.ts`, whose stated job is to
 * fail on a root document with no `SCAN_ROOTS` row, was the test that did not
 * run. `./*` is the root's tree spelling: depth 1, markdown only. See
 * `matchesEntry()` for why depth 1 and not `**`.
 *
 * ## ⛔ What this does NOT answer -- read this before citing it as coverage
 *
 *   1. **Test surfaces outside `SCAN_ROOTS`.** ⭐ RULED, objectui#9096 -- this
 *      limit is closed and the section below records what closing it cost. The
 *      sentence that used to stand here said widening to `scripts/__tests__`
 *      "would make nearly every markdown document in the tree a test input,
 *      which is a different ruling". That was right about the population and
 *      wrong about nothing else: it IS a different ruling, it was measured, and
 *      it was made. Nothing is excluded from the scan today.
 *   2. **A read the scanner cannot see.** It resolves string literals and
 *      recognises directory walks. A test that computes a path from parts no
 *      literal carries, or reads markdown through a helper module in another
 *      file, is invisible to it -- and therefore invisible to the audit. No
 *      static scan closes that; what closes it is a reviewer adding the entry.
 *   3. **Whether the test would actually FAIL.** The question here is whether
 *      the document is an INPUT, not whether a given edit to it changes an
 *      assertion. Answering the second one requires running the test, which is
 *      exactly what the caller is deciding whether to do.
 *   4. **Non-markdown inputs.** A test reading a JSON fixture or a `.txt`
 *      corpus is the same shape of hazard, but those paths are not on the
 *      workflow's exclusion list, so they already force a full run.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { stripComments } from './js-comment-mask.mjs';

export const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

/**
 * Where `deriveCandidates()` looks for tests.
 *
 * Every root the root Vitest config collects from, `scripts` included since
 * objectui#9096. That config's `node` project collects `.test.ts` files under
 * `scripts` too, so those tests run in the same `Test (shard N/4)` job as the
 * rest -- see the objectui#9096 section in this file's header for what
 * including them costs and why the cost was paid.
 */
export const SCAN_ROOTS = ['packages', 'apps', 'examples', 'eslint-rules', 'scripts'];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', 'build', '.next']);

/**
 * The adjudicated class: for every candidate the scanner produces, what a human
 * decided it is.
 *
 * `reads`   -- the markdown this test genuinely takes as input. A `…/**` entry
 *              is a directory TREE the test walks, reading every markdown
 *              document it finds; every other entry is one document.
 * `notRead` -- candidates the scanner offered for this test that it does NOT
 *              read. Recorded rather than dropped: the scanner resolves a bare
 *              `'README.md'` against the test's directory AND every ancestor of
 *              it, so a package-local read also lands on the root README. Which
 *              one is real is a question about the code, and the answer belongs
 *              where the next reader will find it.
 * `walker`  -- present when the scanner saw a directory walk in the file.
 *              `'markdown-tree'` means the walk IS the markdown read and the
 *              tree is in `reads`; `'not-markdown'` means the walk collects
 *              something else, and says what.
 */
export const ADJUDICATED = new Map([
  // objectui#11605. `bindingDocRows()` parses the binding doc's "which keys each
  // one honours" table to learn what the `dataSource` binding supplies on each
  // bound block -- so an edit to that table is an edit to this pin's input.
  [
    'apps/console/src/__tests__/objectname-binding-required-11605.test.ts',
    { reads: ['content/docs/guide/data-source.md'] },
  ],
  // objectui#11403. The console's SDUI manifest pin lists the files the
  // generator writes into a temp directory; no markdown in this tree is read.
  [
    'apps/console/src/__tests__/sdui-manifest-build-11403.test.ts',
    {
      reads: [],
      walker: 'not-markdown: walks GENERATED output in a temp directory; its `sdui-blocks.md` literal names a file the generator writes, not one in this tree',
    },
  ],
  // objectui#11165. Evaluates the guide's "customize only the header" fence, so an edit to that page is an edit to this test's input.
  [
    'examples/schema-catalog/test/slotted-pages-header-example-11165.test.ts',
    { reads: ['content/docs/guide/slotted-pages.md'] },
  ],
  // ADR-0060. The product-neutral renderer ratchet reads its CEILING -- the
  // product words, the frozen directories and namespaces, and the most its live
  // list may ever hold -- out of that ADR's frozen-baseline block, so an edit to
  // the ADR is an edit to this test's input. Its walk collects file NAMES under
  // `packages`, `apps` and `examples`, never markdown content.
  [
    'packages/app-shell/src/__tests__/product-neutral-renderer.ratchet.test.ts',
    {
      reads: ['docs/adr/0060-product-neutral-renderer.md'],
      walker: 'not-markdown: walks `packages`, `apps` and `examples` for file paths, reading no file it finds',
    },
  ],
  [
    'packages/app-shell/src/views/metadata-admin/previews/readme-flow-canvas-draft.test.ts',
    { reads: ['packages/app-shell/README.md'] },
  ],
  [
    'packages/auth/src/__tests__/reserved-auth-features.test.ts',
    {
      reads: ['packages/auth/README.md'],
      notRead: ['README.md'],
      walker: 'not-markdown: sweeps package `src` directories for `.ts` sources',
    },
  ],
  // objectui#10859. Extracts `@object-ui/plugin-ai`'s README "Schema-Driven
  // Usage" block and runs it through `objectui validate` end to end -- so an edit
  // to that README IS an edit to this test's input. The scanner also resolves the
  // bare `'README.md'` segment of that path against this package and the root;
  // an `fs` trace of the file's run at objectui#10859 opened the plugin-ai README
  // and nothing else. objectui#10872 batch 4 added the second read (its
  // `QUICK_START` path): the first json fence under the quick-start's
  // "### Add Actions" heading -- the taught `action:button` node -- which the
  // page pin runs through `objectui validate` beside a `page:header`.
  [
    'packages/cli/src/__tests__/registered-types-validate-ratchet-10859.test.ts',
    {
      reads: ['packages/plugin-ai/README.md', 'content/docs/guide/quick-start.md'],
      notRead: ['README.md', 'packages/cli/README.md'],
    },
  ],
  [
    'packages/components/src/__tests__/div-guidance-names-box.test.tsx',
    {
      reads: ['content/docs/components/basic/div.mdx', 'content/docs/components/basic/span.mdx'],
      walker: 'not-markdown: reads a directory of JSON schema fixtures',
    },
  ],
  [
    'packages/components/src/__tests__/guide-layout-page-buttons-7926.test.tsx',
    { reads: ['content/docs/guide/layout.md'] },
  ],
  // objectui#11436, which subsumes objectui#11423's layout-guide pin. Parses
  // every fence of every page under `content/docs`, in any language, and renders
  // each `type: "page"` node that authors a heading -- so an edit to any docs
  // page's page fences IS an edit to this test's input. It also walks
  // `examples` for page documents, which are not markdown. objectui#11450 adds
  // every `README.md` under `packages/`, at any depth, read the same way; the
  // tree is declared rather than its READMEs, so a README added tomorrow is on
  // the trigger the day it lands. It does not read the root `README.md`: the
  // scanner offers it because a bare `README.md` literal resolves against every
  // ancestor directory.
  [
    'packages/components/src/__tests__/page-node-headings-drawn-11436.test.tsx',
    {
      reads: ['content/docs/**', 'packages/**'],
      notRead: ['README.md'],
      walker: 'markdown-tree: walks `content/docs` and parses every fence of every `.md`/`.mdx` under it, and walks `packages` for every `README.md` and parses its fences; its walk of `examples` collects JSON and script sources, not markdown',
    },
  ],
  // The four-leg render pin for objectui#8021. Leg A is READ OFF
  // `content/docs/guide/schema-rendering.md` rather than transcribed -- both the
  // wiring and the expression spelling -- and the sweep arm reads the second
  // surface the same repair covered.
  [
    'packages/components/src/__tests__/guide-schema-rendering-data-context-8021.test.tsx',
    {
      reads: ['content/docs/guide/schema-rendering.md', 'packages/react/README.md'],
    },
  ],
  // objectui#9569. This one reads a CHANGELOG as a CONTROL, not as a spec: the
  // test asserts a class named only by that prose is absent from the compiled
  // stylesheet, and reads the file to prove the prose still names it -- so the
  // negative assertion cannot pass because the token quietly went away.
  [
    'packages/components/src/__tests__/index-css-scan-excludes-tests.test.ts',
    {
      reads: ['packages/components/CHANGELOG.md'],
      notRead: ['CHANGELOG.md'],
    },
  ],
  [
    'packages/components/src/__tests__/page-body-single-node-8310.test.tsx',
    {
      reads: ['README.md'],
      notRead: ['packages/components/README.md', 'packages/components/src/__tests__/README.md'],
    },
  ],
  [
    'packages/components/src/__tests__/readme-shadcn-sync-categories.test.ts',
    { reads: ['packages/components/README_SHADCN_SYNC.md'] },
  ],
  [
    'packages/components/src/__tests__/skill-guide-data-table-binding.test.tsx',
    {
      reads: [
        'skills/objectui/guides/data-integration.md',
        'skills/objectui/guides/schema-expressions.md',
        'skills/objectui/rules/protocol.md',
      ],
      walker: 'not-markdown: concatenates plugin package `.tsx` sources',
    },
  ],
  [
    'packages/components/src/__tests__/skill-guide-provider-envelope.test.tsx',
    {
      reads: ['skills/objectui/**'],
      walker: 'markdown-tree: walks the published skill package and asserts over every `.md` in it',
    },
  ],
  [
    'packages/core/src/utils/__tests__/filter-icontains-alignment-8976.test.ts',
    { reads: ['packages/core/src/adapters/README.md'] },
  ],
  [
    'packages/create-plugin/src/__tests__/cli-cancel-and-nontty-8786.test.ts',
    {
      reads: [],
      notRead: ['README.md', 'packages/create-plugin/README.md'],
      walker: 'not-markdown: walks GENERATED output in a temp directory; its `README.md` literal names a file the generator writes, not one in this tree',
    },
  ],
  [
    'packages/create-plugin/src/__tests__/templates.test.ts',
    {
      reads: [],
      notRead: ['README.md', 'packages/create-plugin/README.md'],
      walker: 'not-markdown: reads sibling `package.json` manifests; its `README.md` literal is a generated filename',
    },
  ],
  [
    'packages/data-objectstack/src/readme-filter-operator-table.test.ts',
    { reads: ['packages/data-objectstack/README.md'] },
  ],
  // objectui#7989. Reads this package's OWN README and compares the built-in
  // locale count that document states against what the package EXPORTS -- so an
  // edit to that README IS an edit to this test's input, and a markdown-only
  // pull request touching it has to run the shard.
  [
    'packages/i18n/src/__tests__/readme-locale-count-7989.test.ts',
    { reads: ['packages/i18n/README.md'] },
  ],
  [
    'packages/layout/src/__tests__/app-shell-branding-title-surfaces.test.ts',
    {
      reads: [
        'content/docs/guide/layout.md',
        'content/docs/layout/app-shell.mdx',
        'packages/layout/README.md',
      ],
      notRead: ['README.md'],
    },
  ],
  [
    'packages/layout/src/__tests__/app-shell-docs-nav-example.test.ts',
    { reads: ['content/docs/layout/app-shell.mdx'] },
  ],
  [
    'packages/layout/src/__tests__/guide-layout-app-shell-doc.test.ts',
    { reads: ['content/docs/guide/layout.md'] },
  ],
  [
    'packages/layout/src/__tests__/guide-layout-sidebar-nav-doc.test.ts',
    { reads: ['content/docs/guide/layout.md'] },
  ],
  [
    'packages/layout/src/__tests__/readme-app-shell-example.test.ts',
    { reads: ['packages/layout/README.md'], notRead: ['README.md'] },
  ],
  [
    'packages/layout/src/__tests__/readme-registration-keys.test.ts',
    { reads: ['packages/layout/README.md'], notRead: ['README.md'] },
  ],
  [
    'packages/layout/src/__tests__/readme-sidebar-nav-example.test.ts',
    { reads: ['packages/layout/README.md'], notRead: ['README.md'] },
  ],
  [
    'packages/permissions/src/__tests__/skill-guide-permission-config.test.tsx',
    { reads: ['skills/objectui/guides/auth-permissions.md'] },
  ],
  [
    'packages/plugin-calendar/src/readme-calendar-view-schema.test.ts',
    { reads: ['packages/plugin-calendar/README.md'] },
  ],
  [
    'packages/plugin-dashboard/src/__tests__/readme-dashboard-examples-spec-valid.test.ts',
    { reads: ['packages/plugin-dashboard/README.md'], notRead: ['README.md'] },
  ],
  [
    'packages/plugin-detail/src/__tests__/guideCrudAppRenders.test.tsx',
    { reads: ['content/docs/guide/building-crud-app.md'] },
  ],
  // The `reads` below is a MEASURED subset of a DERIVED population, which is
  // why it is one document rather than a tree. Two of this test's three pins
  // name `packages/plugin-detail/README.md` by constant; the third enumerates
  // `git grep -l isMultiValueField packages` and opens every hit, so any
  // markdown that starts mentioning that symbol joins the set. Measured on this
  // card: the enumeration offers 18 paths, ten of them CHANGELOGs the test
  // drops before opening anything, and exactly one markdown document survives
  // into the read set -- the same README the other two pins name. The root
  // `CHANGELOG.md` the scanner resolves is never in the population at all: the
  // pathspec is `packages`, and the bare literal comes from the drop filter.
  [
    'packages/plugin-detail/src/__tests__/relatedListParentScopeResidue-8937.test.ts',
    {
      reads: ['packages/plugin-detail/README.md'],
      notRead: ['CHANGELOG.md', 'packages/plugin-detail/CHANGELOG.md'],
    },
  ],
  [
    'packages/plugin-detail/src/renderers/__tests__/docsActivityMapTranscription-7876.test.ts',
    { reads: ['content/docs/plugins/plugin-detail.mdx'] },
  ],
  [
    'packages/plugin-form/src/__tests__/guideCrudAppRenders.test.tsx',
    { reads: ['content/docs/guide/building-crud-app.md'] },
  ],
  [
    'packages/plugin-gantt/src/readme-navigation-example.test.ts',
    { reads: ['packages/plugin-gantt/README.md'] },
  ],
  [
    'packages/plugin-grid/src/__tests__/guideCrudAppRenders.test.tsx',
    { reads: ['content/docs/guide/building-crud-app.md'] },
  ],
  [
    'packages/plugin-markdown/src/toc-anchor-parity.test.tsx',
    { reads: ['content/docs/utilities/runner.mdx'] },
  ],
  // objectui#11586. This reads a CHANGELOG as a CONTROL, the same shape as the
  // components entry above. The test asserts that the published sheet lacks a
  // class only that prose names, and it reads the file to prove the prose still
  // names it.
  [
    'packages/runner/src/__tests__/published-stylesheet-sources.test.ts',
    {
      reads: ['packages/runner/CHANGELOG.md'],
      notRead: ['CHANGELOG.md'],
    },
  ],
  [
    'packages/types/src/__tests__/action-callback-retired-7068.test.ts',
    {
      reads: ['content/docs/**'],
      walker: 'markdown-tree: walks `content/docs` and refuses the retired callback shape in every `.md`/`.mdx` under it',
    },
  ],
  // objectui#10859. Extracts `@object-ui/plugin-ai`'s README "Schema-Driven
  // Usage" block and runs it through `safeValidateSchema` and the strict
  // authoring face -- the `timeline-readme-schema-example-10824.test.ts` shape.
  // The scanner also resolves the bare `'README.md'` segment of that path against
  // this package and the root; an `fs` trace of the file's run opened the
  // plugin-ai README and nothing else.
  [
    'packages/types/src/__tests__/ai-zod-arms-10859.test.ts',
    {
      reads: ['packages/plugin-ai/README.md'],
      notRead: ['README.md', 'packages/types/README.md'],
    },
  ],
  [
    'packages/types/src/__tests__/alert-dialog-read-dialect-7104.test.ts',
    { reads: ['content/docs/components/overlay/alert-dialog.mdx'] },
  ],
  [
    'packages/types/src/__tests__/button-group-doc-surface-6347.test.ts',
    { reads: ['content/docs/components/basic/button-group.mdx'] },
  ],
  [
    'packages/types/src/__tests__/calendar-doc-key-set-8830.test.ts',
    { reads: ['content/docs/plugins/plugin-calendar.mdx'] },
  ],
  [
    'packages/types/src/__tests__/calendar-flat-color-allday-8466.test.ts',
    { reads: ['packages/plugin-calendar/README.md'] },
  ],
  // objectui#11521. Parses the `chartType` row of the page's `ChartSchema`
  // table and holds its quoted values equal to the node's declared set -- so an
  // edit to that page IS an edit to this test's input.
  [
    'packages/types/src/__tests__/chart-type-doc-row-11521.test.ts',
    { reads: ['content/docs/api/schema-reference.md'] },
  ],
  [
    'packages/types/src/__tests__/chat-message-avatar-keys-7295.test.ts',
    { reads: ['content/docs/plugins/plugin-chatbot.mdx'] },
  ],
  [
    'packages/types/src/__tests__/component-docs-disabled-inherited-7239.test.ts',
    {
      reads: ['content/docs/components/**'],
      walker: 'markdown-tree: walks the component doc pages and reads every `.mdx` it finds',
    },
  ],
  [
    'packages/types/src/__tests__/component-docs-retired-handler-keys-7340.test.ts',
    {
      reads: ['content/docs/**'],
      walker: 'markdown-tree: walks `content/docs` and collects handler rows from every `.md`/`.mdx` under it',
    },
  ],
  // objectui#11117. `documentedBindings()` parses every json fence on these two
  // pages that binds a node through `dataSource`, and asserts each one parses on
  // `safeValidateSchema` -- the documented per-element bindings ARE this pin's
  // input, so an edit to either page's binding fences is an edit to the test.
  [
    'packages/types/src/__tests__/element-data-source-objectname-waiver-11117.test.ts',
    { reads: ['content/docs/utilities/data-objectstack.mdx', 'content/docs/guide/data-source.md'] },
  ],
  [
    'packages/types/src/__tests__/filter-builder-mirror-6939.test.ts',
    { reads: ['content/docs/components/complex/filter-builder.mdx'] },
  ],
  // objectui#10872 batch 4. `taughtActionButton()` extracts the first json fence
  // under the quick-start's "### Add Actions" heading -- the taught
  // `action:button` node -- and judges it on both zod faces, in a page and alone.
  // objectui#11586. Reads no markdown. Its only `.md` literal is the
  // `:!*CHANGELOG.md` pathspec that keeps every CHANGELOG OUT of its `git grep`
  // census.
  [
    'packages/types/src/__tests__/handler-keys-string-any-mirrors-7344.test.ts',
    {
      reads: [],
      walker: 'not-markdown: lists the zod mirror sources in `packages/types/src/zod`',
    },
  ],
  [
    'packages/types/src/__tests__/held-public-block-arms-10872.test.ts',
    { reads: ['content/docs/guide/quick-start.md'] },
  ],
  // objectui#11405. Reads every marked fence in the two guides that authors a
  // bind-only `list`, with the marker gate's own `scanSkillFences`, and judges it
  // through `safeValidateSchema` and the strict face -- so an edit to either guide
  // is an edit to this test's input.
  [
    'packages/types/src/__tests__/list-bind-only-11405.test.ts',
    {
      reads: [
        'skills/objectui/guides/data-integration.md',
        'skills/objectui/guides/schema-expressions.md',
      ],
    },
  ],
  // objectui#6152 round 9 -- the corpus census of `object-calendar` containers.
  // It walks the authored trees, reads every markdown document in them that
  // names `object-calendar`, and parses each fenced element's `calendar`
  // container -- so an edit to any of those documents IS an edit to this
  // test's input. It reads the root `README.md` and every package's
  // `README.md`, the second through the `packages` tree.
  [
    'packages/types/src/__tests__/object-calendar-container-by-reference-6152.test.ts',
    {
      reads: ['README.md', 'apps/**', 'content/**', 'docs/**', 'examples/**', 'packages/**', 'skills/**'],
      walker: 'markdown-tree: walks `examples`, `content`, `skills`, `docs` and `apps`, and every package `README.md`, and parses the fences of each `.md`/`.mdx` that names `object-calendar`',
    },
  ],
  [
    'packages/types/src/__tests__/object-calendar-record-source-7313.test.ts',
    { reads: ['content/docs/plugins/plugin-calendar.mdx'] },
  ],
  [
    'packages/types/src/__tests__/object-kanban-group-by-limit-7322.test.ts',
    { reads: ['content/docs/plugins/plugin-kanban.mdx'] },
  ],
  // objectui#5157. Reads no markdown: the two document literals are PROVENANCE
  // on the rows of its sweep fixture (every `map` block the pre-landing sweep
  // found in authored metadata, copied into the test and parsed under the strict
  // schema). The test imports no `fs` and opens neither page, so an edit to
  // either one cannot move its verdict.
  [
    'packages/types/src/__tests__/object-map-config-strict-5157.test.ts',
    {
      reads: [],
      notRead: ['content/docs/fields/location.mdx', 'content/docs/plugins/plugin-map.mdx'],
    },
  ],
  [
    'packages/types/src/__tests__/object-view-unmirrored-keys-7779.test.ts',
    {
      reads: [
        'content/docs/api/schema-reference.md',
        'content/docs/guide/building-crud-app.md',
        'content/docs/plugins/plugin-view.mdx',
        'packages/plugin-view/README.md',
      ],
    },
  ],
  [
    'packages/types/src/__tests__/overlay-node-slot-doc-types-7082.test.ts',
    {
      reads: [
        'content/docs/components/feedback/empty.mdx',
        'content/docs/components/overlay/alert-dialog.mdx',
        'content/docs/components/overlay/context-menu.mdx',
        'content/docs/components/overlay/dropdown-menu.mdx',
        'content/docs/components/overlay/hover-card.mdx',
        'content/docs/components/overlay/sheet.mdx',
      ],
    },
  ],
  [
    'packages/types/src/__tests__/page-actions-refusal-7926.test.ts',
    { reads: ['content/docs/guide/layout.md'] },
  ],
  [
    'packages/types/src/__tests__/page-body-arity-8310.test.ts',
    { reads: ['README.md'], notRead: ['packages/types/README.md'] },
  ],
  [
    'packages/types/src/__tests__/page-breadcrumbs-refusal-8871.test.ts',
    { reads: ['content/docs/guide/layout.md'] },
  ],
  // objectui#11318. Runs every `type: "page"` JSON fence of the layout guide
  // through the tolerant and the strict face, and reads its Schema API block --
  // so an edit to that page IS an edit to this test's input.
  [
    'packages/types/src/__tests__/page-width-padding-refusal-11318.test.ts',
    { reads: ['content/docs/guide/layout.md'] },
  ],
  // objectui#11321. Extracts the two `record:related_list` examples and the two
  // `action:button` route examples and runs each through both faces and the
  // spec -- so an edit to any of the three pages IS an edit to this test's input.
  [
    'packages/types/src/__tests__/public-block-doc-examples-bag-11321.test.ts',
    {
      reads: [
        'content/docs/api/schema-reference.md',
        'content/docs/guide/slotted-pages.md',
        'packages/app-shell/README.md',
      ],
    },
  ],
  // objectui#8256. Reads the root README's "Kanban Board" `json` fence and runs
  // it through `safeValidateSchema` -- so an edit to that page IS an edit to
  // this test's input, and a README-only pull request has to run the shard.
  [
    'packages/types/src/__tests__/readme-kanban-example-8256.test.ts',
    { reads: ['README.md'], notRead: ['packages/types/README.md'] },
  ],
  [
    'packages/types/src/__tests__/schema-reference-named-list-view-keys-7923.test.ts',
    { reads: ['content/docs/api/schema-reference.md'] },
  ],
  // objectui#11465. Extracts the `sidebar` literal of the types README's
  // "4. Composable" example and runs it through the strict and the tolerant
  // face -- so an edit to that README IS an edit to this test's input, and a
  // README-only pull request has to run the shard.
  [
    'packages/types/src/__tests__/sidebar-declared-surface-11465.test.ts',
    { reads: ['packages/types/README.md'] },
  ],
  // objectui#10824. Extracts `@object-ui/plugin-timeline`'s README "Schema-Driven
  // Usage" block and runs it through `safeValidateSchema` and the strict
  // authoring face -- so an edit to that README IS an edit to this test's input,
  // and a README-only pull request has to run the shard. It lives in this
  // package because plugin-timeline's test config names no `node` types.
  [
    'packages/types/src/__tests__/timeline-readme-schema-example-10824.test.ts',
    { reads: ['packages/plugin-timeline/README.md'] },
  ],
  // objectui#9522. Reads the zod README's own `typescript` fences and runs each
  // worked example through the schema that fence names -- so an edit to that page
  // IS an edit to this test's input, and a README-only pull request has to run
  // the shard. Same relationship `readme-kanban-example-8256.test.ts` has to the
  // root README, one page down.
  [
    'packages/types/src/__tests__/zod-readme-examples-9522.test.ts',
    { reads: ['packages/types/src/zod/README.md'] },
  ],
  [
    'packages/vscode-extension/src/__tests__/export-to-react-compiles.test.ts',
    {
      reads: ['content/docs/utilities/vscode-extension.mdx', 'packages/vscode-extension/DESIGN.md'],
    },
  ],

  // ---------------------------------------------------------------------------
  // objectui#9096 -- the `scripts/__tests__/**` surface.
  //
  // Added with `scripts` as a scan root. These are repository GATE tests, and
  // they read documentation the way the product tests read a README: as data.
  // The `reads` column below was not inferred from the literals -- every one of
  // these 45 files was run under an `fs` trace and the documents it actually
  // opened were recorded, which is also how the three tests that ENUMERATE a
  // markdown population without opening it were caught.
  // ---------------------------------------------------------------------------
  // Reads no markdown: the document literal is an ARGUMENT to a path-matcher assertion, never opened.
  [
    'scripts/__tests__/check-action-forward-parity.test.ts',
    {
      reads: [],
      notRead: ['content/docs/guide/ci-cd-pipeline.md'],
    },
  ],
  // objectui#9727 -- the rebuilt polarity census. It walks TWO markdown trees:
  // the real pending corpus (through the script, for the controls and the
  // corpus-boundary pin) and its own fixture corpus (for every instrument pin).
  [
    'scripts/__tests__/changeset-polarity-census.test.ts',
    {
      reads: ['scripts/__tests__/fixtures/changeset-polarity/corpus/**'],
      walker: 'markdown-tree',
    },
  ],
  // Reads no markdown: drives the gate against a fixture repository it writes in a temp directory.
  [
    'scripts/__tests__/check-changeset-claims.test.ts',
    {
      reads: [],
      notRead: ['.changeset/README.md', 'README.md'],
    },
  ],
  [
    'scripts/__tests__/check-changeset-no-major.test.ts',
    {
      reads: ['.changeset/**'],
      notRead: ['README.md'],
      walker: 'markdown-tree',
    },
  ],
  // Reads no markdown: drives the gate against a fixture repository it writes in a temp directory.
  [
    'scripts/__tests__/check-changeset-overwrite.test.ts',
    {
      reads: [],
      notRead: ['.changeset/README.md'],
    },
  ],
  // Reads no markdown: drives the gate against a fixture repository it writes in a temp directory.
  [
    'scripts/__tests__/check-changeset-presence.test.ts',
    {
      reads: [],
      notRead: ['.changeset/README.md', 'CHANGELOG.md', 'README.md', 'apps/console/README.md'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-doc-component-types.test.ts',
    {
      // `packages/**` joined with objectui#7896's fourth leg (objectui#8115):
      // `check:doc-types` now walks every `packages/NAME/README.md`, so this test
      // reads them and a change to one must start the shard that runs it. The
      // entry is the same shape `check-doc-snippet-types.test.ts` below carries
      // for the same surface — the ledger has no `dir/*/name` form, and
      // over-declaring is the safe direction here: the failure this whole file
      // exists to prevent (objectui#8857) was a pull request changing exactly
      // ONE package README, `packages/plugin-dashboard/README.md`, whose shard
      // reported success in ten seconds having run nothing.
      reads: ['README.md', 'apps/console/docs/UI_IMPROVEMENT_PROPOSAL.md', 'apps/console/docs/deployment.md', 'apps/console/docs/error-tracking.md', 'content/docs/**', 'packages/**'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-doc-example-ids.test.ts',
    {
      reads: ['content/docs/**'],
      notRead: ['examples/README.md'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-doc-example-shared-reader.test.ts',
    {
      reads: ['content/docs/guide/ci-cd-pipeline.md'],
    },
  ],
  [
    'scripts/__tests__/check-doc-example-types.test.ts',
    {
      reads: ['content/docs/guide/ci-cd-pipeline.md'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-doc-expression-carriage.test.ts',
    {
      // `packages/**` for the same reason as the entry above: this census takes
      // `check:doc-types`' surface by IMPORT, so objectui#7896's fourth leg
      // reached it in the same change (objectui#8115).
      reads: ['README.md', 'apps/console/docs/UI_IMPROVEMENT_PROPOSAL.md', 'apps/console/docs/deployment.md', 'apps/console/docs/error-tracking.md', 'content/docs/**', 'packages/**'],
      walker: 'markdown-tree',
    },
  ],
  [
    'scripts/__tests__/check-doc-fence-languages.test.ts',
    {
      reads: ['apps/console/docs/**', 'content/docs/**', 'docs/**'],
      notRead: ['README.md'],
      walker: 'markdown-tree',
    },
  ],
  [
    'scripts/__tests__/check-doc-json-fences.test.ts',
    {
      // objectui#5250: the agreement test walks the JSON-fence gate's own scan
      // surface (the CI pipeline guide it also reads by name is inside it).
      // objectui#12131 widened that surface to the published READMEs: the root
      // `README.md` and every `packages/NAME/README.md`, a leg taken by IMPORT
      // from `check-doc-component-types.mjs`, hence `packages/**` as in the
      // carriage census's entry above. objectui#12204 added the gate's fourth
      // leg, the published skill bundle -- every `.md` under `skills/objectui/`,
      // its anchor `rules/protocol.md` -- so the walk reads that tree too; the
      // two bundle pages the scanner resolves by name (`SKILL.md`, the anchor)
      // are fixture keys of the leg's order and anchor pins, inside the tree.
      reads: ['README.md', 'content/docs/**', 'packages/**', 'skills/objectui/**'],
      walker: 'markdown-tree',
    },
  ],
  // `./*` rather than the eight root documents it used to list, and the
  // distinction is the whole of objectui#9142. This test does not read a list
  // of root documents -- it runs `git ls-files -- '*.md'`, keeps the paths with
  // no separator in them, and fails when one of them has no `SCAN_ROOTS` row.
  // Its own words: "scans EVERY tracked root-level markdown file -- the
  // invariant that replaces the list". Its input is therefore the root CLASS,
  // and a list of the eight members was a declaration that went stale on the
  // ninth -- at precisely the moment the test was written to speak.
  [
    'scripts/__tests__/check-doc-links.test.ts',
    {
      reads: ['./*', 'apps/**', 'content/docs/**', 'docs/ARCHITECTURE.md', 'docs/CONSOLE-STREAMLINING-SUMMARY.md', 'docs/adr/**', 'docs/audits/**', 'examples/**', 'packages/**'],
    },
  ],
  [
    'scripts/__tests__/check-doc-snippet-emitted-census.test.ts',
    {
      reads: ['README.md', 'apps/console/docs/UI_IMPROVEMENT_PROPOSAL.md', 'apps/console/docs/deployment.md', 'apps/console/docs/error-tracking.md', 'content/docs/**', 'docs/ARCHITECTURE.md', 'docs/CONSOLE-STREAMLINING-SUMMARY.md', 'docs/adr/**', 'docs/audits/**', 'packages/**'],
    },
  ],
  [
    'scripts/__tests__/check-doc-snippet-types.test.ts',
    {
      reads: ['README.md', 'apps/console/docs/UI_IMPROVEMENT_PROPOSAL.md', 'apps/console/docs/deployment.md', 'apps/console/docs/error-tracking.md', 'content/docs/**', 'docs/ARCHITECTURE.md', 'docs/CONSOLE-STREAMLINING-SUMMARY.md', 'docs/adr/**', 'docs/audits/**', 'packages/**'],
      walker: 'markdown-tree',
    },
  ],
  // Reads no markdown: the root-document literals are fixture INPUTS to a pure path classifier.
  [
    'scripts/__tests__/check-governed-queue-guard.test.ts',
    {
      reads: [],
      notRead: ['AGENTS.md', 'CLAUDE.md'],
    },
  ],
  [
    'scripts/__tests__/check-handler-key-read-sites.test.ts',
    {
      reads: ['content/docs/guide/ci-cd-pipeline.md'],
    },
  ],
  // Reads no markdown: opens no markdown; the `.md` literal is a message string.
  [
    'scripts/__tests__/check-i18n-dead-keys.test.ts',
    {
      reads: [],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-installed-spec-pin-claims.test.ts',
    {
      reads: ['.claude/skills/**', '.github/prompts/component.prompt.md', '.github/prompts/engine.prompt.md', '.github/prompts/ui-library.prompt.md', '.github/pull_request_template.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'LICENSE-THIRD-PARTY.md', 'QUICK_REFERENCE.md', 'README.md', 'ROADMAP.md', 'apps/**', 'content/docs/**', 'docs/ARCHITECTURE.md', 'docs/CONSOLE-STREAMLINING-SUMMARY.md', 'docs/adr/**', 'docs/audits/**', 'examples/**', 'packages/**', 'patches/README.md', 'skills/objectui/**'],
      notRead: ['CHANGELOG.md'],
    },
  ],
  [
    'scripts/__tests__/check-links-workflow.test.ts',
    {
      reads: ['content/docs/**', 'docs/**'],
      notRead: ['README.md'],
      walker: 'markdown-tree',
    },
  ],
  // Reads no markdown: fixture trees only, and the suite asserts markdown is OUT of the ESLint walk.
  [
    'scripts/__tests__/check-lint-rule-coverage.test.ts',
    {
      reads: [],
      walker: 'not-markdown: the files ESLint walks — the suite asserts `.md` is OUT of that walk',
    },
  ],
  [
    'scripts/__tests__/check-new-cross-file-line-citations.test.ts',
    {
      reads: ['content/docs/guide/ci-cd-pipeline.md'],
    },
  ],
  // Reads no markdown: the three documents below are ARGUMENTS to a path
  // predicate — `isPendingDeclaration` classifies a string and opens nothing.
  // They are real paths on purpose (a synthetic one would prove nothing about
  // the shapes the predicate has to decline), and permanent ones on purpose:
  // the suite pins the gate that stops a test naming a file `changeset version`
  // deletes, so naming a pending declaration here would make it an instance of
  // its own subject (objectui#9583).
  [
    'scripts/__tests__/check-pending-changeset-literals.test.ts',
    {
      reads: [],
      notRead: ['.changeset/README.md', 'CHANGELOG.md', 'packages/core/README.md'],
    },
  ],
  // Reads no markdown: reads workflow YAML and sources, no markdown.
  [
    'scripts/__tests__/check-pre-install-import-graph.test.ts',
    {
      reads: [],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-prompt-component-keys.test.ts',
    {
      reads: ['.github/prompts/component.prompt.md', '.github/prompts/engine.prompt.md', '.github/prompts/ui-library.prompt.md'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  // Reads no markdown: the `README.md` literals are packed-file names inside a manifest fixture.
  [
    'scripts/__tests__/check-published-dist-tooling.test.ts',
    {
      reads: [],
      notRead: ['README.md'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-readme-exports.test.ts',
    {
      reads: ['packages/**'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  // objectui#9502 widened this suite to read prose: the repaired carriers must
  // point at the gate instead of restating the ruleset's membership, and the
  // untouched `AGENTS.md` carrier is the positive control that proves the
  // detector still fires.
  [
    'scripts/__tests__/check-required-check-set.test.ts',
    {
      reads: ['AGENTS.md', 'content/docs/guide/ci-cd-pipeline.md'],
    },
  ],
  [
    'scripts/__tests__/check-shell-escape-residue.test.ts',
    {
      reads: ['.claude/skills/**', 'AGENTS.md', 'CLAUDE.md', 'content/docs/**', 'skills/objectui/**'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-skill-eval-tokens.test.ts',
    {
      reads: ['content/docs/guide/ci-cd-pipeline.md', 'skills/objectui/**'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-skill-examples.test.ts',
    {
      reads: ['.claude/skills/**', 'content/docs/guide/ci-cd-pipeline.md', 'skills/objectui/**'],
      notRead: ['README.md'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/check-skills-paths.test.ts',
    {
      reads: ['.claude/skills/**', 'skills/objectui/**'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/ci-cd-pipeline-doc.test.ts',
    {
      reads: ['.github/prompts/component.prompt.md', '.github/prompts/engine.prompt.md', '.github/prompts/ui-library.prompt.md', 'CONTRIBUTING.md', 'content/docs/guide/ci-cd-pipeline.md'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  [
    'scripts/__tests__/component-node-vocabulary-7434.test.ts',
    {
      reads: ['content/docs/**', 'packages/**'],
      walker: 'markdown-tree',
    },
  ],
  // Reads no markdown: its `README.md` literal is sample input to a pure path-matcher
  // assertion -- the suite is a census OF corpus walkers and keeps its own inputs literal.
  [
    'scripts/__tests__/coverage-red-cause-census.test.ts',
    {
      reads: [],
      notRead: ['README.md'],
    },
  ],
  // Reads no markdown: every document literal is fixture text handed to pure functions.
  [
    'scripts/__tests__/cross-file-line-citation-census.test.ts',
    {
      reads: [],
      notRead: ['README.md', 'ROADMAP.md', 'packages/core/README.md', 'packages/plugin-form/CHANGELOG.md', 'packages/plugin-form/README.md'],
    },
  ],
  [
    'scripts/__tests__/doc-version-claims.test.ts',
    {
      reads: ['content/docs/**', 'packages/**', 'skills/objectui/**'],
      walker: 'markdown-tree',
    },
  ],
  // Reads no markdown: reads workspace manifests and turbo inputs; the `README.md` literal is a declared-input fixture.
  [
    'scripts/__tests__/docs-build-trigger.test.ts',
    {
      reads: [],
      notRead: ['README.md'],
      walker: 'not-markdown: workspace `package.json` manifests and turbo input globs',
    },
  ],
  // `./*` for the same reason as `check-doc-links.test.ts` above, reached by a
  // different route: this one takes its population from `trackedFiles()` in
  // `dollar-dialect-alias-census.mjs`, which is `git ls-files -z` -- EVERY
  // tracked path, root documents included, with no list anywhere to update.
  [
    'scripts/__tests__/dollar-dialect-alias-census.test.ts',
    {
      reads: ['./*', '.changeset/**', '.claude/skills/**', '.github/prompts/component.prompt.md', '.github/prompts/engine.prompt.md', '.github/prompts/ui-library.prompt.md', 'apps/**', 'content/docs/**', 'docs/ARCHITECTURE.md', 'docs/CONSOLE-STREAMLINING-SUMMARY.md', 'docs/adr/**', 'docs/audits/**', 'examples/**', 'packages/**', 'patches/README.md', 'skills/objectui/**'],
    },
  ],
  [
    'scripts/__tests__/extract-mdx-demos.test.ts',
    {
      reads: ['content/docs/**'],
      walker: 'markdown-tree',
    },
  ],
  // Reads no markdown: the `README.md` literal names a repo-wide labeler rule, not a file it opens.
  [
    'scripts/__tests__/labeler-package-coverage.test.ts',
    {
      reads: [],
      notRead: ['README.md'],
      walker: 'not-markdown: package directories under `packages/`',
    },
  ],
  [
    'scripts/__tests__/layered-read-declared-path-4016.test.ts',
    {
      reads: ['skills/objectui/**'],
      walker: 'not-markdown: package `src/` directories',
    },
  ],
  [
    'scripts/__tests__/lint-workflow.test.ts',
    {
      reads: ['content/docs/guide/ci-cd-pipeline.md'],
    },
  ],
  // objectui#9194. Names one page -- the one that legitimately teaches nested
  // fences -- to pin that a block quoted inside a longer run stays that run's
  // body. The whole scan surface is reached too, but through the two gates' own
  // scanners rather than a walk of its own, which is why no `walker` is declared.
  // Its odd-marker control is written into a temp directory and is ⛔ not a
  // document in this tree.
  [
    'scripts/__tests__/markdown-fence-scan.test.ts',
    { reads: ['content/docs/plugins/plugin-markdown.mdx'] },
  ],
  // Reads no markdown: drives the decision step against fixture repositories it
  // writes in a temp directory, so every document literal here is a fixture path
  // rather than a file in this tree -- `AGENTS.md` included, which is the
  // objectui#9096 firing fixture and is WRITTEN by the test, never read from the
  // repository root.
  [
    'scripts/__tests__/markdown-test-inputs.test.ts',
    {
      reads: [],
      notRead: ['AGENTS.md', 'README.md', 'ROADMAP.md', 'packages/app-shell/README.md', 'packages/plugin-dashboard/README.md'],
    },
  ],
  [
    'scripts/__tests__/merge-queue-reporting.test.ts',
    {
      reads: ['content/docs/guide/ci-cd-pipeline.md'],
      walker: 'not-markdown: `.github/workflows/*.yml`',
    },
  ],
  // objectui#12958. Its `CHANGELOG.md` is a fixture written into a temp directory;
  // from this tree it reads the root `package.json` and one workflow, no markdown.
  [
    'scripts/__tests__/objectstack-floor.test.ts',
    { reads: [], notRead: ['CHANGELOG.md'] },
  ],
  [
    'scripts/__tests__/quick-reference-commands-4149.test.ts',
    {
      reads: ['QUICK_REFERENCE.md'],
      walker: 'not-markdown: directory listings that test whether a documented path exists',
    },
  ],
  [
    'scripts/__tests__/quick-reference-current-release-4143.test.ts',
    {
      reads: ['QUICK_REFERENCE.md'],
      walker: 'not-markdown: package and app directories',
    },
  ],
  // objectui#12214. Its fixtures write a `README.md` into a temp directory to
  // prove a root documentation change is not a full-run trigger; the selector
  // it tests never opens a markdown file.
  [
    'scripts/__tests__/select-affected-tests.test.ts',
    {
      reads: [],
      notRead: ['README.md'],
    },
  ],
  [
    'scripts/__tests__/sync-quick-reference-release.test.ts',
    {
      reads: ['QUICK_REFERENCE.md'],
    },
  ],
  [
    'scripts/__tests__/unconsumed-widget-option-claim-6186.test.ts',
    {
      reads: ['content/docs/plugins/plugin-dashboard.mdx'],
    },
  ],
]);

/** Is `rel` a markdown document at all? The only extensions this tree publishes. */
export const isMarkdown = (rel) => /\.mdx?$/.test(rel);

/**
 * Is this entry a CLASS of documents rather than one document?
 *
 * Two spellings, and what separates them is DEPTH:
 *
 *   `dir/**`   every markdown document under `dir`, at any depth.
 *   `dir/*`    every markdown document directly IN `dir`, and none deeper.
 *
 * Neither names a file, so neither is something `missingDocuments()` can look
 * for on disk -- that is the one thing this predicate is for.
 */
export const isClassEntry = (entry) => entry.endsWith('/**') || entry.endsWith('/*');

/**
 * Does one repo-relative path match one ledger entry?
 *
 * A `…/**` entry matches every markdown document under that directory, at any
 * depth. A `…/*` entry matches only the documents directly in it. Anything else
 * is one exact path -- deliberately not a glob, so a new document beside a
 * declared one does not inherit its declaration by accident.
 *
 * ## The repository root is spelled `./*` (objectui#9142)
 *
 * A document inside a declared tree inherits that tree's declaration the moment
 * it lands -- that is what a `…/**` entry buys, and it is why a new page under
 * `content/docs/` is on the trigger before anyone has thought about it. The
 * repository ROOT had no tree spelling at all, so every root document was
 * declared per file, and a root document nobody had declared yet was not on the
 * trigger: a pull request whose only change was "add `SECURITY.md`" skipped
 * `Test (shard N/4)`.
 *
 * ⇒ the test that does not run is exactly the one written to notice. Measured
 * on `f080538813`, before this spelling existed:
 *
 *     LIT CONTROL  planted undeclared root doc  SECURITY.md
 *        Test (shard N/4) step : should_run=false   matched: (none)
 *
 * and `scripts/__tests__/check-doc-links.test.ts` describes itself as scanning
 * "EVERY tracked root-level markdown file -- the invariant that replaces the
 * list", failing when a root document has no `SCAN_ROOTS` row. An invariant
 * that replaces a list is silent at the one moment the list would have been
 * updated. The merge queue catches it and dequeues the pull request, which is
 * the objectui#8857 shape and the objectui#8857 cost.
 *
 * ⛔ `./*` is NOT a step toward "every markdown file". The depth-1 spelling is
 * the narrowest thing that gives the root what every declared tree already has;
 * it matches `SECURITY.md` and it does not match `docs/NOTES.md`. The resolved
 * input list is still a resolved input list -- the fence objectui#9096 carried
 * ("a resolved input list, ⛔ not a glob") governs this file and is intact.
 */
export function matchesEntry(rel, entry) {
  if (entry.endsWith('/**')) {
    const prefix = `${entry.slice(0, -3)}/`;
    return rel.startsWith(prefix) && isMarkdown(rel);
  }
  if (entry.endsWith('/*')) {
    // `./*` is the repository root, whose prefix is the empty string; every
    // other `dir/*` carries its own trailing separator.
    const dir = entry.slice(0, -2);
    const prefix = dir === '.' ? '' : `${dir}/`;
    if (!isMarkdown(rel) || !rel.startsWith(prefix)) return false;
    return !rel.slice(prefix.length).includes('/');
  }
  return rel === entry;
}

/** Every ledger entry, deduplicated -- the class as the workflow consults it. */
export function declaredEntries() {
  const out = new Set();
  for (const { reads } of ADJUDICATED.values()) for (const r of reads) out.add(r);
  return [...out].sort();
}

/** `document entry -> the tests that read it`, for `--list`. */
export function readersByEntry() {
  const out = new Map();
  for (const [test, { reads }] of ADJUDICATED) {
    for (const r of reads) {
      if (!out.has(r)) out.set(r, []);
      out.get(r).push(test);
    }
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The subset of `paths` that this repository has recorded as a test's input.
 *
 * Paths are taken as repo-relative, which is what `git diff --name-only` emits.
 *
 * ## Every matching entry, not the first one (objectui#9142)
 *
 * Entries OVERLAP, and they always have: `packages/app-shell/README.md` is one
 * test's declared read and is also inside `packages/**`, which is another's.
 * Reporting only the first match made the readers list an artefact of sort
 * order -- that README reported eight readers and lost the ninth, the one whose
 * entry names the file exactly. The root class makes the same overlap
 * structural rather than incidental, so the union is taken here: `entries` is
 * every rule that covers the document and `readers` is every test behind them.
 *
 * `should_run` does not depend on this -- one match is enough to run everything
 * and the caller in `ci.yml` reads only the path. The readers do: they are what
 * the log line names when it says which test is waiting on this document.
 */
export function markdownTestInputsAmong(paths) {
  const entries = declaredEntries();
  const readers = readersByEntry();
  const out = [];
  for (const raw of paths) {
    // `git diff --name-only` wraps a path in double quotes when it holds a byte
    // it has to escape. Strip them: a quoted path that kept its quotes would
    // match no entry, and "no entry" is the answer that SKIPS.
    const unquoted = raw.trim().replace(/^"(.*)"$/, '$1');
    const rel = unquoted.replace(/^\.\//, '');
    if (!rel || !isMarkdown(rel)) continue;
    const hits = entries.filter((entry) => matchesEntry(rel, entry));
    if (!hits.length) continue;
    const tests = new Set();
    for (const entry of hits) for (const test of readers.get(entry) ?? []) tests.add(test);
    out.push({ path: rel, entries: hits, readers: [...tests].sort() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scanner -- candidates, not verdicts
// ---------------------------------------------------------------------------

const TEST_FILE = /\.test\.(tsx?|jsx?)$/;
const LITERAL = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\\n$]*)`/g;
const WALKS = /\breaddirSync\b|\breaddir\(|\bglobSync\b/;
const SELECTS_MARKDOWN = /\.mdx\?\$|endsWith\((['"`])\.mdx?\1\)|\.mdx?['"`]/;

function collectTests(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTests(full, out);
    else if (TEST_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Path fragments a file could be naming: every string literal, plus every run
 * of literals separated only by commas.
 *
 * The run is what makes `join(ROOT, 'content', 'docs', 'guide', 'layout.md')`
 * legible -- one argument per segment is the spelling this tree uses most.
 */
function pathFragments(source) {
  const literals = [];
  let m;
  LITERAL.lastIndex = 0;
  while ((m = LITERAL.exec(source))) {
    literals.push({ value: m[1] ?? m[2] ?? m[3], start: m.index, end: LITERAL.lastIndex });
  }
  const out = new Set();
  for (let i = 0; i < literals.length; i += 1) {
    let joined = literals[i].value;
    out.add(joined);
    for (let j = i + 1; j < literals.length; j += 1) {
      if (!/^\s*,\s*$/.test(source.slice(literals[j - 1].end, literals[j].start))) break;
      joined = `${joined}/${literals[j].value}`;
      out.add(joined);
    }
  }
  return out;
}

/**
 * Every markdown document a test file could be naming, and whether it walks a
 * directory.
 *
 * Resolution is deliberately GENEROUS: a fragment is resolved against the test's
 * own directory and every ancestor of it up to the repository root, and every
 * resolution that exists in the tree is offered. That over-produces -- a
 * package-local `'README.md'` also lands on the root README -- and
 * over-producing is the safe direction here, because the cost of a rejected
 * candidate is one line in `ADJUDICATED` while the cost of a missed one is the
 * defect this file exists to close.
 */
export function deriveCandidates({ root = REPO_ROOT, roots = SCAN_ROOTS } = {}) {
  const files = [];
  for (const top of roots) collectTests(path.join(root, top), files);

  const out = new Map();
  for (const file of files.sort()) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const bases = [];
    for (let dir = path.dirname(file); dir.startsWith(root); dir = path.dirname(dir)) bases.push(dir);

    const documents = new Set();
    for (const fragment of pathFragments(source)) {
      if (!isMarkdown(fragment)) continue;
      if (/[\s*!:?<>|]/.test(fragment)) continue; // a message or a pathspec, not a path
      if (/^\.mdx?$/.test(fragment)) continue; // the bare extension
      for (const base of bases) {
        const resolved = path.resolve(base, fragment);
        if (!resolved.startsWith(`${root}${path.sep}`)) continue;
        if (resolved.includes(`${path.sep}node_modules${path.sep}`)) continue;
        if (existsSync(resolved) && statSync(resolved).isFile()) {
          documents.add(path.relative(root, resolved));
        }
      }
    }
    const walks = WALKS.test(source) && SELECTS_MARKDOWN.test(source);
    if (documents.size || walks) {
      out.set(path.relative(root, file), { documents: [...documents].sort(), walks });
    }
  }
  return out;
}

/**
 * Compare the tree against the ledger.
 *
 * Returns one finding per disagreement. Each is a question a human has to
 * answer, never something this file guesses at.
 */
export function auditTree(candidates) {
  const findings = [];
  for (const [test, { documents, walks }] of candidates) {
    const verdict = ADJUDICATED.get(test);
    if (!verdict) {
      findings.push({
        kind: 'unadjudicated-test',
        test,
        detail:
          `reads markdown the ledger does not describe` +
          (documents.length ? ` (${documents.join(', ')})` : '') +
          (walks ? ' and walks a directory' : '') +
          `. Add it to ADJUDICATED with what it reads, or with an empty \`reads\` and why.`,
      });
      continue;
    }
    const accounted = new Set(verdict.notRead ?? []);
    for (const document of documents) {
      if (accounted.has(document)) continue;
      if ((verdict.reads ?? []).some((entry) => matchesEntry(document, entry))) continue;
      findings.push({
        kind: 'unadjudicated-document',
        test,
        detail: `resolves \`${document}\`, which is in neither \`reads\` nor \`notRead\`.`,
      });
    }
    if (walks && !verdict.walker) {
      findings.push({
        kind: 'unadjudicated-walk',
        test,
        detail: `walks a directory and selects markdown, but declares no \`walker\`.`,
      });
    }
    if (!walks && verdict.walker) {
      findings.push({
        kind: 'stale-walker',
        test,
        detail: `declares a \`walker\` the scanner no longer sees.`,
      });
    }
    for (const rejected of verdict.notRead ?? []) {
      if (!documents.includes(rejected)) {
        findings.push({
          kind: 'stale-not-read',
          test,
          detail: `rejects \`${rejected}\`, which the scanner no longer offers.`,
        });
      }
    }
  }
  for (const test of ADJUDICATED.keys()) {
    if (!candidates.has(test)) {
      findings.push({
        kind: 'stale-test',
        test,
        detail: `is in the ledger but the scanner no longer sees it reading markdown.`,
      });
    }
  }
  return findings;
}

/**
 * Ledger entries naming one document that is not in the tree.
 *
 * A class entry (`…/**`, `…/*`) is skipped: it names a rule, not a file, so
 * there is nothing to look for. objectui#9142's triage named the trap this
 * avoids -- `missingDocuments()` reds on a declared path that is not in the
 * tree, so a root class spelled as if it were a path would red every run.
 */
export function missingDocuments({ root = REPO_ROOT } = {}) {
  return declaredEntries().filter(
    (entry) => !isClassEntry(entry) && !existsSync(path.join(root, entry)),
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function runList() {
  const readers = readersByEntry();
  for (const [entry, tests] of readers) {
    process.stdout.write(`${entry}\n`);
    for (const test of tests) process.stdout.write(`    <- ${test}\n`);
  }
  process.stdout.write(
    `\n${readers.size} declared entries, read by ${ADJUDICATED.size} adjudicated test files.\n`,
  );
  return 0;
}

function runAudit() {
  const candidates = deriveCandidates();
  const findings = auditTree(candidates);
  const missing = missingDocuments();

  for (const finding of findings) {
    process.stdout.write(`${finding.kind}: ${finding.test} ${finding.detail}\n`);
  }
  for (const entry of missing) {
    process.stdout.write(`missing-document: ${entry} is declared but is not in the tree.\n`);
  }
  if (candidates.size === 0) {
    process.stdout.write(
      'collapsed: the scanner found no markdown-reading test at all. That is not a pass — ' +
        'it means the scan roots or the scan itself stopped working.\n',
    );
    return 1;
  }
  if (findings.length === 0 && missing.length === 0) {
    process.stdout.write(
      `markdown-test-inputs: ${candidates.size} candidate test files, all adjudicated; ` +
        `${declaredEntries().length} declared entries, all present.\n`,
    );
    return 0;
  }
  process.stdout.write(
    `\n${findings.length + missing.length} finding(s). The class of markdown documents a test ` +
      `reads decides whether CI runs on a markdown-only pull request, so an unadjudicated ` +
      `candidate is a blind spot, not a formality (objectui#8861).\n`,
  );
  return 1;
}

function runChanged(args) {
  const paths = args.includes('-')
    ? [...args.filter((a) => a !== '-'), ...readStdin().split('\n')]
    : args;
  for (const hit of markdownTestInputsAmong(paths)) {
    process.stdout.write(`${hit.path}\n`);
  }
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  let code;
  if (argv[0] === '--list') code = runList();
  else if (argv[0] === '--audit') code = runAudit();
  else if (argv[0] === '--changed') code = runChanged(argv.slice(1));
  else {
    process.stderr.write(
      'usage: markdown-test-inputs.mjs (--list | --audit | --changed <path…> | --changed -)\n',
    );
    code = 2;
  }
  process.exit(code);
}
