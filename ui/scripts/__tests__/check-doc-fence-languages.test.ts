import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import {
  APP_DOCS as FENCE_APP_DOCS,
  census,
  listDocuments as fenceDocuments,
  ROOT_PAGES as FENCE_ROOT_PAGES,
  TS_FENCE_LANGUAGES as GUARD_TS_FENCES,
} from '../check-doc-fence-languages.mjs';
import {
  ADR_DOCS as SNIPPET_ADR_DOCS,
  adrDocsPages as snippetAdrDocsPages,
  APP_DOCS as SNIPPET_APP_DOCS,
  AUDIT_DOCS as SNIPPET_AUDIT_DOCS,
  auditDocsPages as snippetAuditDocsPages,
  listDocuments as snippetDocuments,
  NESTED_PACKAGE_READMES as SNIPPET_NESTED_PACKAGE_READMES,
  nestedPackageReadmePages as snippetNestedPackageReadmes,
  ROOT_DOCS as SNIPPET_ROOT_DOCS,
  rootDocsPages as snippetRootDocsPages,
  ROOT_PAGES as SNIPPET_ROOT_PAGES,
  TS_FENCE_LANGUAGES as GATE_TS_FENCES,
} from '../check-doc-snippet-types.mjs';
import {
  APP_DOCS as COMPONENT_APP_DOCS,
  PACKAGE_READMES as COMPONENT_PACKAGE_READMES,
  packageReadmePages as componentPackageReadmes,
  ROOT_PAGES as COMPONENT_ROOT_PAGES,
} from '../check-doc-component-types.mjs';

import { selfTestCases, stripAnsi } from './helpers/child-verdict';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const GUARD = 'scripts/check-doc-fence-languages.mjs';
const WORKFLOW = 'repo-gates.yml';

/**
 * A numeral that qualifies a document-population noun, as `match: text`.
 *
 * Lifted to module scope by objectui#7914 so the pin below and its positive
 * control read ONE definition of the rule. Two copies of the same rule inside
 * one file is a defect this repository has paid for repeatedly; the pattern
 * itself is unchanged, character for character, from what this pin carried
 * inline (objectui#7888) and from the third copy in
 * `check-links-workflow.test.ts` (objectui#7825). WHY it is narrow exactly here
 * — the two intervening words, the negative lookbehind that rules out issue
 * references — is argued at the pin, and deliberately not restated here.
 *
 * A fresh `RegExp` per call: `lastIndex` on a shared global literal is exactly
 * the kind of state that makes the second caller in a run measure something
 * different from the first.
 */
const POPULATION_COUNT =
  /(?<![#\w.])\d+(?:,\d{3})*\s+(?:[A-Za-z][\w-]*\s+){0,2}`?(?:\.mdx|\.md|documents?|pages?|docs?|files?)\b/i;

function documentCounts(text: string): string[] {
  return [...text.matchAll(new RegExp(POPULATION_COUNT.source, 'gi'))].map((m) => m[0].replace(/\s+/g, ' ').trim());
}

/**
 * The workflow header's comment prose, as the count pin reads it.
 *
 * Lifted to module scope by objectui#7901 for the same reason objectui#7914
 * lifted the pattern: the pin below and the emptiness control beside it must
 * read ONE extraction, or the control demonstrates a surface the pin does not
 * have.
 *
 * Stripped, not kept: a sentence that wraps across two comment lines has a `#`
 * sitting in the middle of it, and a scan that reads the raw lines cannot see a
 * numeral and the noun it qualifies as adjacent when the line break falls
 * between them. Removing the marker is what makes the count pin below read the
 * header the way a person does.
 *
 * That paragraph is the third copy's (`check-links-workflow.test.ts`), carried
 * here verbatim by objectui#7967 together with the `.map` line it argues for.
 * This extraction and its twin in the other objectui#7448 pin KEPT the marker
 * while the third copy stripped it — one rule, three copies, and the two that
 * never wrote down WHY were the two that drifted. The divergence is not
 * theoretical: the census objectui#7967 ran over all 35 workflow headers reads
 * two document counts under the stripped extraction that the kept extraction
 * cannot see at all (`pre-install-import-graph.yml`, `shell-escape-residue.yml`
 * — neither of them read by any pin today, which is why nothing was failing).
 * The extraction control below fixtures the shape so this cannot drift back.
 */
function headerComments(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => /^\s*#/.test(line))
    .map((line) => line.replace(/^\s*#\s?/, ''))
    .join('\n');
}

/**
 * The floor the extracted header must clear before an empty count list means
 * anything — carried from the third copy of this pin
 * (`check-links-workflow.test.ts`, objectui#7825), which has asserted it since
 * that copy was written and which both twins were missing (objectui#7901).
 *
 * Why a floor at all: `documentCounts('')` is `[]`. A header this extraction has
 * stopped reading — the workflow renamed or deleted, its comment markers
 * changed, the path moved — therefore satisfies the pin perfectly, and the pin
 * reports a clean surface it never read. The floor is what makes "no counts
 * here" a reading rather than the absence of one. It is the same claim the
 * scan-collapse pins in this file already make about the document walk, applied
 * to the one surface that had none.
 */
const MIN_HEADER_PROSE = 400;

/**
 * objectui#6135. `check-doc-snippet-types` reads `ts` / `tsx` / `typescript`
 * fences, so a TypeScript block fenced any other way is invisible to it, and
 * objectui#5867's remediation lane collected its population from `plaintext`
 * fences only — one spelling of an unhighlighted fence out of several. A
 * ```text block opening `interface FileUploadSchema {` was outside both.
 *
 * `check-doc-fence-languages.mjs` closes that by reading BODIES rather than
 * pinning a list of languages. This file pins the two things its correctness
 * rests on and cannot check about itself:
 *
 *   1. **The scan surface really is the gate's.** The guard re-implements
 *      `listDocuments` so it needs no `pnpm install` — the gate imports
 *      `typescript`, and an install-gated docs check is one a docs-only pull
 *      request skips, which is the hole `doc-component-types.yml`'s header
 *      records. A copy that is never compared is a copy free to drift, and the
 *      drift direction is silent: a document the guard stops walking is a
 *      document nothing reports on. So both walks are imported and compared.
 *   2. **The wiring.** A gate nobody runs is indistinguishable from a gate that
 *      passes (`entry-guard-wiring.test.ts` records that lesson for its own
 *      subject). The alias, the workflow, the self-test leg and the
 *      unfiltered triggers are asserted here.
 *
 * Deliberately NOT asserted: the size of the baseline or the number of blocks it
 * carries. Those move with every objectui#5867 batch, and a hand-copied
 * enumeration in a test drifts by construction — the lesson `lint-workflow.test.ts`
 * records for this repository at length. The guard's own output is the honest
 * place for those numbers.
 */
describe('check-doc-fence-languages: the scan surface is check-doc-snippet-types’s', () => {
  /**
   * objectui#7856 — the ONE place the two walks are allowed to differ, named
   * rather than tolerated. Card 1 opened it; card 2 widened it to three legs and
   * did NOT widen the way it is expressed.
   *
   * That card brought the repository-root `docs/` tree, TOP LEVEL only, into
   * `check-doc-snippet-types`' walk: an authored-documentation directory that no
   * doc gate read, where three phantom-teaching sites (objectui#7838,
   * objectui#7854) had already been found by hand. It moved THAT gate's
   * population and no other, for a stated reason: the rest of the tree —
   * `docs/adr/**`, a GOVERNED surface, and `docs/audits/**` — was card 2, whose
   * pull request stops in draft for a human to merge, and `check:doc-fences`'
   * own surface was not either card's to move.
   *
   * ⭐ Card 2 has now landed those two subtrees on the snippet gate — LEDGER-FIRST,
   * because an ADR and a dated audit are records rather than pages to repair — and
   * the whole cost of it here is three enumerators in the subtraction instead of
   * one. That is the payoff of how card 1 wrote this: the equality subtracts
   * exactly what the snippet gate EXPORTS as its legs rather than a hand-written
   * list of today's seventeen filenames. A page added to `docs/` tomorrow travels
   * into BOTH sides of this comparison by itself, a page added under `docs/adr/`
   * travels into the snippet gate's side and is subtracted by itself, and a page
   * added under a THIRD subdirectory of `docs/` travels into NEITHER. A
   * hand-written list would have to be re-typed for the first two cases and would
   * stay silently green for the third.
   *
   * ⛔ What this is not: a licence for the two walks to drift anywhere else. Any
   * OTHER divergence still fails here, which is the whole point of keeping the
   * comparison rather than deleting it.
   */
  /**
   * The snippet gate's own legs, taken from the gate itself: its three
   * root-`docs/` legs, plus objectui#7308's nested package READMEs.
   *
   * ⭐ objectui#7308 is the fourth enumerator and it arrives the way card 1 built
   * this for: `check-doc-links` had already closed the same hole on the same four
   * files (objectui#6026), but moving `check:doc-fences`' own surface is not that
   * card's to do — so the divergence is SUBTRACTED BY IMPORT and every other
   * drift between the two walks still fails here. A fifth nested README landing
   * under `packages/` tomorrow travels into the snippet gate's side and into this
   * subtraction by itself; a hand-written list of today's four filenames would
   * have had to be re-typed for it.
   */
  const snippetDocsLegs = () => [
    ...snippetRootDocsPages(ROOT),
    ...snippetAdrDocsPages(ROOT),
    ...snippetAuditDocsPages(ROOT),
    ...snippetNestedPackageReadmes(ROOT),
  ];

  it('walks exactly the documents the snippet gate walks, minus that gate’s own legs', () => {
    const legOnly = new Set(snippetDocsLegs());
    expect(fenceDocuments(ROOT)).toEqual(snippetDocuments(ROOT).filter((d: string) => !legOnly.has(d)));
  });

  it('…and that subtraction is non-empty, so it is not silently subtracting nothing', () => {
    // Each leg separately: a union that is non-empty overall would stay green
    // with one of its four members returning nothing at all.
    for (const leg of [
      snippetRootDocsPages(ROOT),
      snippetAdrDocsPages(ROOT),
      snippetAuditDocsPages(ROOT),
      snippetNestedPackageReadmes(ROOT),
    ]) {
      expect(leg.length).toBeGreaterThan(0);
    }
    // Every subtracted document really is on the snippet gate's side only.
    for (const doc of snippetDocsLegs()) {
      expect(snippetDocuments(ROOT), `${doc} is not in the snippet gate's walk`).toContain(doc);
      expect(fenceDocuments(ROOT), `${doc} reached the fence guard's walk`).not.toContain(doc);
    }
  });

  /**
   * objectui#7308's leg, pinned where it stops rather than only that it is
   * non-empty.
   *
   * Two claims a reading of the code cannot make: that the leg collects a README
   * BELOW a package root and never the package's own top-level one (the
   * no-double-collect guarantee objectui#6026 got structurally, by rooting the
   * walk at each package's SUBdirectories), and that it does not follow pnpm's
   * workspace symlinks out of the authored tree. The second is not hypothetical:
   * `statSync` follows symlinks, and `packages/a/node_modules/@object-ui/b` leads
   * back into `packages/b`, so an unguarded walk does not terminate.
   */
  it('the nested-README leg collects below package roots only, and the tracked tree exactly', () => {
    expect(SNIPPET_NESTED_PACKAGE_READMES).toEqual({
      dir: 'packages',
      name: 'README.md',
      recursive: true,
    });
    const nested = snippetNestedPackageReadmes(ROOT);
    // Below a package root, every one of them — never `packages/<name>/README.md`.
    for (const doc of nested) {
      expect(doc, `${doc} is not a README.md`).toMatch(/\/README\.md$/);
      expect(doc, `${doc} sits at a package root, so the leg above already has it`).not.toMatch(
        /^packages\/[^/]+\/README\.md$/,
      );
      expect(doc.split('/'), `${doc} left the authored tree`).not.toContain('node_modules');
    }
    // The leg plus the top-level README leg is EXACTLY the tracked population —
    // measured against git, not against a hand-written list, so the walk cannot
    // quietly gain a generated page or lose an authored one.
    const tracked = execFileSync('git', ['ls-files', '--', 'packages/'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /(^|\/)README\.md$/.test(f))
      .sort();
    const walked = snippetDocuments(ROOT)
      .filter((d: string) => d.startsWith('packages/') && d.endsWith('/README.md'))
      .sort();
    expect(walked).toEqual(tracked);
    // Non-vacuous on both halves: the tracked population is not empty, and it
    // really does contain pages at both depths.
    expect(tracked.length).toBeGreaterThan(0);
    expect(nested.length).toBeGreaterThan(0);
    expect(tracked.filter((f) => /^packages\/[^/]+\/README\.md$/.test(f)).length).toBeGreaterThan(0);
    // No document is collected twice by the two package legs together.
    expect(new Set(walked).size).toBe(walked.length);
  });

  /**
   * The boundary, pinned on the legs themselves. `recursive: false` on one and
   * `recursive: true` on the other two are claims about where each surface stops,
   * and a claim about a walk is only worth what a test that reads the tree says
   * about it.
   *
   * Card 1 could state this as "no nested page reaches either walk". Card 2 makes
   * that false for the snippet gate on purpose, so the pin says the stronger
   * thing it can still say: the snippet gate's nested pages are EXACTLY the two
   * subtree legs, and the fence guard's are still none. A third subdirectory of
   * `docs/` appearing tomorrow lands in no leg and fails the first half here —
   * which is the alarm card 1's version could not have rung, because it read
   * every nested page as a violation and would have gone red for card 2 itself.
   */
  it('the three docs/ legs stop where they say they do, and only the snippet gate has them', () => {
    expect(SNIPPET_ROOT_DOCS).toEqual({ dir: 'docs', recursive: false });
    expect(SNIPPET_ADR_DOCS).toEqual({ dir: 'docs/adr', recursive: true });
    expect(SNIPPET_AUDIT_DOCS).toEqual({ dir: 'docs/audits', recursive: true });
    const nested = (docs: string[]) =>
      docs.filter((d) => d.startsWith(`${SNIPPET_ROOT_DOCS.dir}/`) && d.slice(`${SNIPPET_ROOT_DOCS.dir}/`.length).includes('/'));
    expect([...nested(snippetDocuments(ROOT))].sort()).toEqual(
      [...snippetAdrDocsPages(ROOT), ...snippetAuditDocsPages(ROOT)].sort(),
    );
    // Card 2 moved ONE gate's population; `check:doc-fences` still stops at the
    // top level of `docs/`.
    expect(nested(fenceDocuments(ROOT))).toEqual([]);
    // Non-vacuous: both subtrees exist and really hold pages.
    for (const tree of [SNIPPET_ADR_DOCS, SNIPPET_AUDIT_DOCS]) {
      expect(
        fs.existsSync(path.join(ROOT, tree.dir)),
        `${tree.dir} no longer exists, so the equality above pins nothing`,
      ).toBe(true);
    }
    expect(snippetAdrDocsPages(ROOT).length).toBeGreaterThan(0);
    expect(snippetAuditDocsPages(ROOT).length).toBeGreaterThan(0);
  });

  it('…and that is a non-empty set, so the comparison is not vacuous', () => {
    expect(fenceDocuments(ROOT).length).toBeGreaterThan(100);
  });

  it('treats exactly the snippet gate’s fence languages as already-covered', () => {
    expect([...GUARD_TS_FENCES].sort()).toEqual([...GATE_TS_FENCES].sort());
  });

  /**
   * objectui#7115 — the ROOT_PAGES half of the surface, pinned across ALL THREE
   * doc gates rather than two.
   *
   * The document-list assertion above is what caught this: objectui#7115 widened
   * `check-doc-component-types` and `check-doc-snippet-types` onto the root
   * `README.md` — the two gates its ruling named — and this file went red,
   * because a third gate is coupled to that surface by construction. The lists
   * are equal again, but list equality alone would not have said WHERE they
   * diverged.
   *
   * ⚠️ This comment used to add that `check-doc-component-types`'s surface is
   * "deliberately narrower (it does not walk the package READMEs), so it cannot
   * join that comparison". That stopped being true when objectui#7896's fourth
   * leg landed (objectui#8115): all three gates now walk
   * `packages/NAME/README.md`, and the leg gets its own cross-gate pin below
   * rather than being left as a sentence.
   *
   * This is the piece all three DO share. Each carries its own copy for its own
   * install-free reason; comparing the copies is what keeps "copy freely" honest.
   */
  it('all three doc gates carry the same ROOT_PAGES — the surface objectui#7115 widened', () => {
    expect([...FENCE_ROOT_PAGES]).toEqual(['README.md']);
    expect([...SNIPPET_ROOT_PAGES]).toEqual([...FENCE_ROOT_PAGES]);
    expect([...COMPONENT_ROOT_PAGES]).toEqual([...FENCE_ROOT_PAGES]);
  });

  it('the root README is really in this gate’s walk — the widening, pinned', () => {
    // Not implied by the equality above: both lists could lose it together.
    expect(fenceDocuments(ROOT)).toContain('README.md');
  });

  /**
   * objectui#7896 / objectui#8115 — the `packages/NAME/README.md` half, the leg
   * that made the third gate joinable here at all.
   *
   * This gate and the snippet gate had walked those READMEs all along;
   * `check-doc-component-types` — the one that asks whether a `type` literal
   * names a component that EXISTS — walked past them, so their type literals
   * were read twice and judged never. The pin is written as an equality against
   * the population THIS gate already collects, because the two enumerations come
   * from different files and neither is the other read twice.
   *
   * ⛔ Not folded into the whole-document equality above: that comparison is
   * between this gate and the snippet gate, whose surface still carries four legs
   * this one does not. A named leg is what says WHERE two walks agree.
   */
  it('all three doc gates now walk packages/NAME/README.md — objectui#7896’s fourth leg', () => {
    expect(COMPONENT_PACKAGE_READMES).toEqual({ dir: 'packages', name: 'README.md' });
    const componentLeg = componentPackageReadmes(ROOT)
      .map((abs: string) => path.relative(ROOT, abs).split(path.sep).join('/'))
      .sort();
    // Non-vacuous: an empty leg would make every comparison below pass.
    expect(componentLeg.length, 'the component gate collected no package README').toBeGreaterThan(10);
    const fenceLeg = fenceDocuments(ROOT)
      .filter((f: string) => /^packages\/[^/]+\/README\.md$/.test(f))
      .sort();
    expect(componentLeg).toEqual(fenceLeg);
    const snippetLeg = snippetDocuments(ROOT)
      .filter((f: string) => /^packages\/[^/]+\/README\.md$/.test(f))
      .sort();
    expect(componentLeg).toEqual(snippetLeg);
  });

  /**
   * objectui#6600 — the `apps/<app>/docs/**` half of the surface.
   *
   * The equality assertion above does NOT cover this: both walks could drop the
   * tree together and stay equal, which is precisely the state this card was
   * filed about — three gates agreeing with each other about a tree none of them
   * opened. `check-doc-component-types`' own header states the rule these two
   * assertions implement: "Widening a scan surface is the change that can be
   * GREEN ABOUT NOTHING… Anything added here later is owed the same proof."
   *
   * So membership is pinned by NAME, and the shared constant is pinned across all
   * three gates the way `ROOT_PAGES` is.
   */
  it('all three doc gates carry the same APP_DOCS — the surface objectui#6600 widened', () => {
    expect(FENCE_APP_DOCS).toEqual({ dir: 'apps', subdir: 'docs' });
    expect(SNIPPET_APP_DOCS).toEqual(FENCE_APP_DOCS);
    expect(COMPONENT_APP_DOCS).toEqual(FENCE_APP_DOCS);
  });

  it('the apps/*/docs guides are really in the walk — the widening, pinned', () => {
    const docs = fenceDocuments(ROOT);
    expect(docs).toContain('apps/console/docs/deployment.md');
    expect(docs).toContain('apps/console/docs/error-tracking.md');
    expect(docs).toContain('apps/console/docs/UI_IMPROVEMENT_PROPOSAL.md');
  });

  /**
   * The walk takes ONE app-directory level before the `docs` segment, rather
   * than any depth. `apps/site/app/docs` is a Next.js route directory;
   * collecting it would be collecting routes, and the
   * only reason nothing breaks today is that it holds `.tsx` rather than `.md`.
   * Pinned so a later "make the glob more general" edit has to argue with a test.
   */
  it('does not descend into nested route directories that happen to be named docs', () => {
    expect(fenceDocuments(ROOT).filter((d) => d.startsWith('apps/site/'))).toEqual([]);
  });
});

describe('check-doc-fence-languages: non-vacuity, through the shipped module', () => {
  const TS_BODY = 'interface FileUploadSchema {\n  accept?: string;\n}';
  const doc = (info: string, body: string = TS_BODY) => [
    { rel: 'probe.mdx', source: ['```' + info, body, '```'].join('\n') },
  ];
  const modes = (info: string, body?: string) =>
    census(doc(info, body)).sites.map((s: { mode: string }) => s.mode);

  // The three spellings the 2026-08-24 ruling on objectui#6135 named by hand.
  it.each(['text', 'txt', ''])('a TypeScript block fenced %o is found', (info) => {
    expect(modes(info)).toEqual(['synonym']);
  });

  it('names the file and the fence line, rather than only counting', () => {
    const [site] = census(doc('text')).sites;
    expect(site).toMatchObject({ rel: 'probe.mdx', line: 1, language: 'text', mode: 'synonym' });
  });

  it.each(['ts', 'tsx', 'typescript'])('the same block fenced %o is not a finding', (info) => {
    expect(modes(info)).toEqual([]);
  });

  it('a spelling nobody has thought of is the OTHER failure mode', () => {
    expect(modes('console')).toEqual(['unknown']);
  });

  it('prose under an unhighlighted fence is not a finding — the classifier is quoted, not widened', () => {
    expect(modes('plaintext', 'Upload a file, then press Save.')).toEqual([]);
  });
});

describe('check-doc-fence-languages is wired, not merely present', () => {
  const workflow = parseYaml(fs.readFileSync(path.join(ROOT, '.github/workflows', WORKFLOW), 'utf8'));
  const steps: Array<Record<string, unknown>> = workflow.jobs['repo-gates'].steps;
  const gateSteps = steps.filter((s) => typeof s.run === 'string' && (s.run as string).includes(GUARD));

  it('the guard script exists', () => {
    expect(fs.existsSync(path.join(ROOT, GUARD))).toBe(true);
  });

  it('package.json aliases it, and the alias points at the script that exists', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:doc-fences']).toContain(GUARD);
  });

  it('the workflow runs it — one step, both legs', () => {
    expect(gateSteps).toHaveLength(1);
    const run = gateSteps[0].run as string;
    expect(run).toContain(`node ${GUARD} --self-test`);
    expect(run.split('\n').some((l) => l.trim() === `node ${GUARD}`)).toBe(true);
  });

  it('one gate, one home — no other workflow runs the same script', () => {
    const dir = path.join(ROOT, '.github/workflows');
    const others = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.yml') && f !== WORKFLOW)
      .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(GUARD));
    expect(others).toEqual([]);
  });

  it('has no paths filter — the defect it catches arrives in a docs-only pull request', () => {
    // `on` parses as the boolean `true` in YAML 1.1; `yaml` gives back `on`.
    const on = workflow.on ?? workflow[true as unknown as string];
    expect(Object.keys(on)).toContain('pull_request');
    expect(on.pull_request).not.toHaveProperty('paths');
    expect(on.pull_request).not.toHaveProperty('paths-ignore');
  });

  it('subscribes to the merge queue, so it cannot stall one if it becomes required', () => {
    const on = workflow.on ?? workflow[true as unknown as string];
    expect(Object.keys(on)).toContain('merge_group');
  });

  it('needs no install — no pnpm runs before this gate in its job', () => {
    // Since objectui#12214 the home is `repo-gates.yml`, ONE job that installs
    // after its install-free gates: the property is now an ORDER -- nothing
    // before this gate's step runs `pnpm install` -- and no longer an absence.
    const gateAt = steps.findIndex((s) => typeof s.run === 'string' && (s.run as string).includes(GUARD));
    expect(gateAt).toBeGreaterThan(-1);
    const before = steps
      .slice(0, gateAt)
      .map((s) => (typeof s.run === 'string' ? s.run : ''))
      .join('\n');
    expect(before).not.toContain('pnpm install');
  });

  it('its self-test passes — the half that makes a green scan mean something', () => {
    const out = execFileSync('node', [GUARD, '--self-test'], { cwd: ROOT, encoding: 'utf8' });
    // objectui#7897 — the COUNT, not the shape. `\d+ cases pass` is satisfied
    // by `0 cases pass`, so the old spelling passed for a self-test whose case
    // table had gone empty: the outcome it exists to refuse. `selfTestCases`
    // also strips ANSI, the second belt for a child that starts colouring —
    // that is the CI-only direction, and no repo gate colours today.
    expect(stripAnsi(out)).toMatch(/check-doc-fence-languages self-test: \d+ cases pass/);
    expect(
      selfTestCases(out, 'check-doc-fence-languages'),
      'a self-test that ran no cases is not a passing self-test',
    ).toBeGreaterThan(0);
  });

  /**
   * objectui#7448. The header of this workflow described its scan surface as
   * "the same 222 documents `check-doc-snippet-types` covers". The walk held 227
   * when this pin was written, and NO check went red over the whole distance
   * between the two — a count copied into a comment drifts by
   * construction, which is the same reason the file header above declines to
   * assert the size of the baseline, and the same fix `UNGATED_DOCS`'s header
   * records being applied to itself ("a pointer to the list now rather than a
   * copy of its length").
   *
   * Changing 222 to 227 would only have restarted that clock. This is what makes
   * the class fail loudly instead: the header may state the population, never
   * count it. `doc-component-types.yml` carries the twin of this pin in
   * `check-doc-component-types.test.ts` — one gate, one home, so each workflow's
   * header is asserted beside its own gate rather than in a shared sweep.
   *
   * Deliberately narrow, and narrow in the same place as the other two copies:
   * a numeral qualifying a document-population noun, with at most two words
   * allowed to sit between the two. Issue references (ruled out at the pattern
   * level by the negative lookbehind, not by luck), `node-version`,
   * `timeout-minutes` and "the sixth instance of the same shape" are all
   * numbers this header legitimately carries, and none of them rots when a
   * document is added or deleted. That is
   * also why the header must not quote another header's stale literal verbatim
   * — this pin cannot tell a quotation from a claim, and the safe direction for
   * a check on prose accuracy is to refuse both.
   *
   * ⭐ Those two intervening words are objectui#7888, and they are the sentence
   * above implemented rather than a new rule. This pin and its twin in
   * `check-doc-component-types.test.ts` both said "a numeral DIRECTLY
   * qualifying" and both coded it as strict adjacency, so a single adjective
   * defeated them. Measured: run verbatim over `check-links.yml`'s header as it
   * stood on `origin/main` at `83fe6e741` — a header carrying TWO live drifted
   * counts — the adjacent-only pattern reported ONE of them. It found the
   * sentence about the files the published site is built from, and scored the
   * one reading "holds 15 INTERNAL documents" clean — which was the count that
   * had drifted furthest (15 against a measured 17), because an adjective sat
   * between the numeral and the noun. The pattern below is the third copy's,
   * carried here verbatim (objectui#7825, PR objectui#7885,
   * `check-links-workflow.test.ts`), with the noun set unchanged; the word
   * DIRECTLY is gone from the sentence above because keeping it would only have
   * inverted the same gap between what this pin claims and what it does.
   *
   * Both twin headers were clean under BOTH patterns when this was carried
   * across, so this closes a proven hole rather than a live violation.
   *
   * Only the negative half is asserted. A positive assertion ("the header names
   * the verdict line") would pin a wording, and pinned wording is the thing this
   * file already refuses to do elsewhere; what has to stay true is that no
   * number is written here that a document being added would falsify.
   */
  it('its header states the population and never counts it — no count can rot here', () => {
    const header = headerComments(fs.readFileSync(path.join(ROOT, '.github/workflows', WORKFLOW), 'utf8'));

    // objectui#7901 — the floor first, or the assertion below is vacuous. The
    // count half cannot distinguish a header that carries no counts from a
    // header this pin has stopped reading; both score `[]`. Measured when this
    // was added, so it is latent rather than live: the extraction returned 4435
    // characters from this header, 11.1 times the floor. It read 4696 at 11.7
    // before objectui#7967 made this extraction strip the `#` markers: 261 of
    // those characters were markers, and none of them were prose.
    expect(
      header.length,
      `${WORKFLOW}: the header prose this pin reads came back empty or near-empty, so it asserted over nothing`,
    ).toBeGreaterThan(MIN_HEADER_PROSE);

    const counts = documentCounts(header);
    expect(
      counts,
      `${WORKFLOW}'s header states a document count (${counts.join(', ')}). Nothing fails when it ` +
        'drifts, so it will. State the population — or point at the gate\u2019s own verdict line, which ' +
        'prints the live figure on every run — instead of copying a number into a comment (objectui#7448).',
    ).toEqual([]);
  });

  /**
   * The positive control for the pin above — objectui#7914.
   *
   * A pin that cannot fail is not a pin, and this repository has shipped one
   * with zero demonstrated power before (objectui#7466: 0/32 on the broken tree
   * AND 0/32 on the fixed one). This header carries no count today, so the pin
   * above asserts `[] toEqual []` — and would assert exactly that if the pattern
   * were deleted, reversed, or narrowed back to adjacency. Nothing in this file
   * exercised the claim, which is why objectui#7888 had to demonstrate its own
   * widening out of band, in a pull request description this repository does not
   * hold. The shapes that actually rotted are fixtured here as POSITIVES rather
   * than trusted to a reading of the regex. The block is carried from the third
   * copy's control in `check-links-workflow.test.ts`, which has held this shape
   * since objectui#7825 — one shape, three homes, so none of them may drift.
   *
   * The first entry is this header's own pre-fix sentence, verbatim; two more
   * are what its twin and the third copy said. `15 INTERNAL documents` is the
   * direction objectui#7888 turned on, and it is measured, not assumed: run over
   * that line, the adjacency-only pattern this pin used to carry returns `[]`,
   * because one adjective sat between the numeral and the noun.
   *
   * ⭐ Two entries state a number that is CORRECT TODAY — this gate's own verdict
   * line reported `227 document(s)` on the day this control was written. They are
   * rejected anyway, and that is the entire point: the rule governs the WRITING,
   * not one wrong figure. A control that only rejected stale numbers would wave
   * the same trap through on the day the number happens to be right, which is
   * precisely the day it starts rotting again.
   *
   * The negatives are numbers this header legitimately carries. The first is a
   * MEASURED false positive of the pre-objectui#7888 pattern: run over
   * `#7448 documents the rule`, it returned `["7448 documents"]` — an issue
   * reference read as a document count. The negative lookbehind rules that out at
   * the pattern level now, and this fixture is what keeps it ruled out.
   */
  it('the count pin fires on the shapes that rotted, and on none of the numbers a header may keep', () => {
    const rotted = [
      'the same 222 documents `check-doc-snippet-types` covers',
      'the same 227 documents `check-doc-snippet-types` covers',
      'every TypeScript block in 227 covered documents is fenced ts/tsx/typescript',
      '80 declared file(s) carrying 89 block(s)',
      'the repo-root `docs/**`, which holds 15 INTERNAL documents (ADRs, audits), while',
      '184 pages (144 `.mdx` + 40 `.md`)',
      'roughly 1,204 markdown files under the two trees',
    ];
    for (const line of rotted) {
      expect(documentCounts(line), `${WORKFLOW}'s count pin must fire on: ${line}`).not.toEqual([]);
    }

    const legitimate = [
      '#7448 documents the rule this gate enforces',
      'objectui#5342 documents the `.md` widening',
      'objectui#5867, whose remediation lane collected its population',
      '#3213 to #3448 spent inside the `ci.yml` docs job',
      'this is the sixth instance of the same shape',
      'objectui#6135 measured a ```text block outside both',
      'node-version: 22',
      'timeout-minutes: 10',
      'the ruleset 60-minute timeout fails it',
    ];
    for (const line of legitimate) {
      expect(documentCounts(line), `${WORKFLOW}'s count pin must NOT fire on: ${line}`).toEqual([]);
    }
  });

  /**
   * The positive control for the EXTRACTION — objectui#7967.
   *
   * The control above exercises the PATTERN half of the pin and the one below
   * exercises the emptiness floor. Neither can fail if the extraction hands the
   * pattern a string the pattern is unable to read, and that is a third way for
   * this pin to go vacuous — the one that was live here. Where an empty surface
   * scores clean because there was nothing to read, this one scores clean with
   * the surface arriving whole and still unreadable.
   *
   * Measured, not inferred. This extraction used to KEEP the `#` markers, so a
   * count wrapping across two comment lines reached the pattern as
   * `184\n# pages`: the marker is not one of the two intervening words the
   * pattern allows, and it also trips the negative lookbehind that exists to
   * rule out issue references. Run over that fixture the kept-marker extraction
   * returns `[]`; the stripped one returns `["184 pages"]`.
   *
   * ⭐ A count landing at end-of-line is not a corner case in a block this
   * shape. `doc-fence-languages.yml`'s header is hard-wrapped at a comment column, so a
   * numeral parting from its noun is the ordinary outcome of editing a
   * paragraph, not an unlucky one.
   *
   * Both halves are asserted because only the pair means anything. The
   * unwrapped sentence proves the fixture is a count this pattern accepts, so
   * the wrapped assertion is a claim about the EXTRACTION rather than about the
   * regex; without it, a fixture the pattern simply never matched would look
   * like the same green.
   */
  it('the extraction strips the markers, so a count that wraps across comment lines is still caught', () => {
    const wrapped = ['  # the published site is built from 184', '  # pages today, so the sweep covers', '  name: x'].join(
      '\n',
    );
    expect(
      documentCounts(headerComments(wrapped)),
      'a count wrapping across two comment lines must survive the extraction',
    ).toEqual(['184 pages']);

    const unwrapped = '  # the published site is built from 184 pages today, so the sweep covers\n  name: x';
    expect(
      documentCounts(headerComments(unwrapped)),
      'the same sentence on one line — so the assertion above is about the extraction, not the pattern',
    ).toEqual(['184 pages']);
  });
  /**
   * The positive control for the emptiness floor — objectui#7901.
   *
   * The pin above has two halves and they fail differently. The control right
   * above this one exercises the PATTERN half; this one exercises the other,
   * and the shape it demonstrates is what makes a pin vacuous rather than
   * merely wrong — a surface that came back empty scores clean under any
   * pattern, however good. That is not hypothetical for this family:
   * objectui#7466 is the pin in this repository that scored the same on the
   * broken tree and the fixed one.
   *
   * Demonstrated on synthetic YAML rather than by emptying the real workflow,
   * so the claim stays reproducible in a checkout whose header is intact —
   * which is every checkout.
   */
  it('the emptiness floor fires on a header this pin has stopped reading', () => {
    const unread = 'name: Doc Fence Languages\non:\n  workflow_dispatch:\n';
    expect(headerComments(unread), 'the extraction returns nothing on a comment-less workflow').toBe('');
    expect(
      documentCounts(headerComments(unread)),
      'and the count half alone scores that identically to a header carrying no counts',
    ).toEqual([]);
    expect(headerComments(unread).length, 'so the floor is the half that has to reject it').not.toBeGreaterThan(
      MIN_HEADER_PROSE,
    );

    // Short, not empty: a header truncated to a line or two is the same defect
    // arriving gradually, and `toBe('')` would wave it through.
    const nearEmpty = '# Doc fence languages.\n# The gate prints its own verdict line.\nname: x\n';
    expect(headerComments(nearEmpty).length, 'this fixture must be short, not empty').toBeGreaterThan(0);
    expect(headerComments(nearEmpty).length).not.toBeGreaterThan(MIN_HEADER_PROSE);
  });
});
