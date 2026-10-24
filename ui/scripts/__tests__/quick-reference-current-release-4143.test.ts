import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#4143: `QUICK_REFERENCE.md`'s "Current Release" block is a deliberately
 * maintained status section — and nothing was maintaining it. At the time this test
 * was written it claimed `v3.3.2`, `@objectstack/spec ^4.0.4` and
 * `@objectstack/client ^4.0.4` against manifests carrying `17.4.0` and
 * `^17.0.0-rc.5`: thirteen majors of drift under a heading that says "Current".
 *
 * The card's premise also said the block's Node/pnpm/React rows were "currently
 * accurate". Two of the three were. **Node was not** — the row read `≥ 20` while
 * root `engines.node` was `>=22` at the time, and the row *names that anchor in
 * its own text*. A claim that cites its anchor and disagrees with it is the
 * strongest possible argument that review alone does not hold this block: the
 * reviewer had the pointer and still did not follow it.
 *
 * `engines.node` has since moved again, to `>=22.11` (objectui#5306 / PR #6311) —
 * and objectui#6313 is the same shape of drift one decimal place down: the
 * forward assertion below derived its expected floor with `match(/(\d+)/)`,
 * which keeps only the LEADING integer group and silently discards everything
 * after it. `>=22.11` derived a floor of `22`, so a row reading exactly `≥ 22`
 * (missing the `.11` its own anchor carries) passed. The derivation below now
 * strips the comparator and keeps the WHOLE version string instead, so the row
 * and the anchor can no longer disagree at the minor version.
 *
 * ## Why a per-block pin and not the repo's existing ratchet
 *
 * `scripts/__tests__/doc-version-claims.test.ts` (objectui#3697) already inventories
 * version literals in prose, and its header states the residual hole plainly: its
 * scan roots are `content/docs` and each package README, so "a version literal in
 * a file OUTSIDE the two scan roots is invisible here". `QUICK_REFERENCE.md` sits in
 * that hole, and so does `apps/console/README.md` — which is exactly how objectui#4143
 * became a card at all.
 *
 * Widening those scan roots was considered and rejected for this change. That gate is
 * a RATCHET: it decides whether a literal was *recorded with a reason*, explicitly not
 * whether it is *true* ("It cannot know whether 'Tailwind CSS v3.3+' is true — that
 * would need a per-claim anchor"). Every row in this block HAS a per-claim anchor, so
 * the stronger instrument is available here and the weaker one would have inventoried
 * `^4.0.4` as a known-stale entry rather than caught it. This file follows
 * `ci-cd-pipeline-doc.test.ts` instead: read the doc, read the anchor, derive the
 * expected text FROM the anchor. No version literal is written twice — every expected
 * value below is computed from a manifest, so this test cannot itself go stale.
 *
 * ## The two directions
 *
 * Forward: each anchored row must state EXACTLY the version literals its manifest
 * produces — a row's literals are extracted as whole tokens and compared to the derived
 * set by equality. Bump the manifest without touching the block and the row that lies
 * goes red, naming the file to edit.
 *
 * That sentence used to be false, and objectui#4913 is the accounting. The forward
 * assertions asked `toContain`, which accepts any row carrying the derived value as a
 * SUBSTRING — so every PREFIX SUPERSET of the anchor passed. Measured on this file:
 * GA manifests against a doc still reading `^17.0.0-rc.6` kept both range rows green,
 * because `'^17.0.0-rc.6'.includes('^17.0.0')`. `^17.0.0.1` and `^17.0.0-beta` passed
 * identically, and so did a `≥ 220` Node row against an `engines.node` floor of 22 —
 * the hole was the comparison, not the prerelease suffix, so it was in every anchored
 * row here rather than in the two that happened to get caught. What did catch the drift
 * was the reverse sweep, answering a different question and covering this one only by
 * accident: of the two directions, the broken one was the one this header guaranteed.
 *
 * Reverse (the last `it` below): no version literal may appear in the block that this
 * test did not derive. Without it the gate covers only the rows that exist today — a
 * new hand-written `- **Turbo:** 2.x` row would sail in beside them and rot on the
 * same schedule, which is the whole defect class, re-created one bullet to the left.
 * The forward equality does not make it redundant and it must not be dropped on that
 * argument: forward asks whether THIS row still says what its anchor says, reverse asks
 * whether anything here was never derived at all. A brand-new row is invisible to the
 * first and caught by the second — two directions, two questions.
 *
 * ## Where the forward direction still stops
 *
 * Both directions reason about version LITERALS (`VERSION_LITERAL` below), so prose
 * wrapped around a correct literal is pinned by neither. A row hedged to
 * `^17.0.0 or higher` states its anchor's literal and no other one, and passes — that
 * is measured too, not assumed. Closing it would mean writing the rows' wording into
 * this file, and the rows carry hand-written anchor notes precisely so they can be
 * reworded; the boundary is recorded here instead, so the next reader knows where the
 * guarantee above runs out.
 *
 * ## The one row nothing here can hold to account
 *
 * `**TypeScript:** ≥ 5.0` has no anchor: no workspace manifest declares a `typescript`
 * peer or engine range, so there is nothing to compare it against. It is a stack floor
 * stated in AGENTS.md §2, and the block says so on the row itself rather than passing
 * it off as a manifest fact. It is allowlisted below by exact text, with a guard that
 * fails the moment an anchor for it DOES appear — the `ci-cd-pipeline-doc.test.ts`
 * move of covering the dangerous direction twice, so the exemption cannot outlive its
 * own justification.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const docRel = 'QUICK_REFERENCE.md';
const doc = fs.readFileSync(path.join(repoRoot, docRel), 'utf8');

interface Manifest {
  name?: string;
  private?: boolean;
  version?: string;
  packageManager?: string;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function manifest(rel: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8')) as Manifest;
}

const rootManifest = manifest('package.json');
const consoleManifest = manifest('apps/console/package.json');
const dataObjectstackManifest = manifest('packages/data-objectstack/package.json');
const reactManifest = manifest('packages/react/package.json');

/**
 * The majors named by a peer range like `^18.0.0 || ^19.0.0`.
 *
 * Split on the `||` comparators first and take the leading number of each — reading
 * majors with one global `\d+\.` sweep instead returns `[18, 0, 19, 0]`, because the
 * patch segments match it too. That mistake fails LOUD here (the row is asserted to
 * name "0.x") but it would fail SILENT in the derived-literal set below, where an
 * extra member only widens what the block is allowed to say.
 */
function peerMajors(range: string): string[] {
  return range
    .split('||')
    .map((comparator) => comparator.trim().match(/^[\^~>=<\s]*(\d+)\./)?.[1])
    .filter((major): major is string => major !== undefined);
}

/**
 * The floor an `engines`-style range states, as the WHOLE version string — not just
 * its leading integer group.
 *
 * objectui#6313: the previous derivation, `match(/(\d+)/)?.[1]`, kept only the
 * leading digits, so `>=22.11` produced a floor of `22` and silently discarded the
 * `.11` rather than failing. A row reading exactly `≥ 22` then satisfied an anchor
 * that actually says `22.11`. Stripping the comparator and keeping the remainder
 * whole means the row and the anchor can no longer disagree at any segment the
 * anchor carries.
 */
function versionFloor(range: string): string | undefined {
  return range.match(/^[\^~>=<\s]*(.+)$/)?.[1];
}

/**
 * The `## Current Release` section, from its heading to the next `## ` heading (or EOF).
 * Scoping matters: `## Repository Layout` above it also carries numbers, and asserting
 * over the whole file would conflate a status claim with a package count.
 */
function currentReleaseSection(): string {
  const lines = doc.split('\n');
  const start = lines.findIndex((line) => line.trim() === '## Current Release');
  // Thrown rather than asserted: this runs at module load, where a failed `expect` has
  // no test to attach itself to. A throw fails collection with the same message.
  if (start === -1) throw new Error(`${docRel} must still have a "## Current Release" heading`);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

const section = currentReleaseSection();

/**
 * The bullet rows only — the section's prose intro is deliberately excluded.
 *
 * A row may wrap onto continuation lines, so a row runs from its `- **Label:**` line
 * up to the next bullet or blank line. Reading a row as a single physical line would
 * make the gate silently miss whatever a future editor pushes onto line two, which is
 * where the "see root `engines.node`" style of self-citing anchor tends to live.
 */
function rows(): Map<string, string> {
  const out = new Map<string, string>();
  const lines = section.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/^- \*\*(.+?):\*\*\s*(.*)$/);
    if (!head) continue;

    const parts = [head[2]];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (next.trim() === '' || /^- \*\*/.test(next) || /^>/.test(next)) break;
      parts.push(next.trim());
    }
    out.set(head[1], parts.join(' ').trim());
  }

  return out;
}

const releaseRows = rows();

function row(label: string): string {
  const value = releaseRows.get(label);
  expect(
    value,
    `${docRel}'s "Current Release" block must still have a "- **${label}:**" row ` +
      `(found: ${[...releaseRows.keys()].map((k) => `"${k}"`).join(', ')})`,
  ).toBeDefined();
  return value as string;
}

/**
 * A version literal, in the spellings this block uses. Deliberately narrow in the same
 * way `doc-version-claims.test.ts` argues for: a bare integer is not a version (the
 * rows contain `§2`, and prose elsewhere counts things), so a literal must be
 * operator-prefixed or dotted.
 *
 * Both directions read the block through this one regex: the forward assertions extract
 * a row's literals with it, and the reverse sweep collects the same tokens across every
 * row. One tokenizer means the two cannot disagree about what a version literal IS — a
 * spelling neither can see is one hole to record (see the header), not two to discover
 * separately.
 */
const VERSION_LITERAL = /(?:\^|~|>=|<=|>|<|≥|≤)\s*v?\d[\w.-]*|\bv?\d+\.[A-Za-z0-9][\w.-]*/g;

const normalize = (literal: string): string => literal.replace(/\s+/g, '');

/**
 * The version literals a row states, as WHOLE tokens — de-duplicated and sorted, so the
 * comparison below is about WHICH literals a row states, not the order it states them
 * in or how often. `matchAll` does not advance `VERSION_LITERAL.lastIndex` (it iterates
 * over an internal clone), so the shared global regex is safe to reuse per row.
 */
function statedLiterals(value: string): string[] {
  return [...new Set([...value.matchAll(VERSION_LITERAL)].map((match) => normalize(match[0])))].sort();
}

/**
 * The forward direction, for one anchored row: the literals the row states must be
 * EXACTLY the literals its anchor produced.
 *
 * Equality on extracted tokens, never `toContain` over the raw row (objectui#4913, and
 * the header's first section for the measurements). Two properties follow from
 * comparing the whole set rather than asking "does it include":
 *
 * - A row may not smuggle in a SECOND, un-anchored literal beside the right one. That
 *   is the reverse sweep's rule applied per row, so the failure names the row to edit
 *   instead of pointing at the block.
 * - A derivation that produces a literal the row does not state fails LOUD here. In the
 *   reverse set an over-broad derivation only widens what the block is allowed to say
 *   (see `peerMajors` above for the shape of that mistake).
 */
function expectRowStates(label: string, derived: string[], message: string): void {
  expect(statedLiterals(row(label)), message).toEqual([...new Set(derived.map(normalize))].sort());
}

describe('QUICK_REFERENCE.md "Current Release" — package + spec versions', () => {
  /**
   * Every `@object-ui/*` package is one `fixed` group in `.changeset/config.json`, so
   * "the version" is a single fact about the workspace rather than a per-package one.
   * This asserts that premise before quoting it: if the group ever splits, a single
   * `**Version:**` row stops being expressible and this test says so instead of
   * silently pinning whichever manifest it happened to read.
   */
  it('states the one version every workspace package carries', () => {
    const changesetConfig = JSON.parse(
      fs.readFileSync(path.join(repoRoot, '.changeset/config.json'), 'utf8'),
    ) as { fixed?: string[][] };
    const fixedGroup = changesetConfig.fixed?.[0] ?? [];
    expect(fixedGroup.length, '.changeset/config.json must still declare one `fixed` group').toBeGreaterThan(1);

    const versions = new Map<string, string>();
    for (const rel of ['packages', 'apps'] as const) {
      for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pkgRel = `${rel}/${entry.name}/package.json`;
        if (!fs.existsSync(path.join(repoRoot, pkgRel))) continue;
        const pkg = manifest(pkgRel);
        if (!pkg.name || !fixedGroup.includes(pkg.name)) continue;
        versions.set(pkg.name, pkg.version ?? '<none>');
      }
    }

    const distinct = new Set(versions.values());
    expect(
      [...distinct],
      `the changeset \`fixed\` group must carry ONE version; got ${JSON.stringify([...versions])}`,
    ).toHaveLength(1);

    const workspaceVersion = [...distinct][0];
    expectRowStates(
      'Version',
      [workspaceVersion],
      `${docRel} must state the workspace version as exactly "${workspaceVersion}"`,
    );
  });

  it('quotes the `@objectstack/spec` range the manifests declare', () => {
    const fromRoot = rootManifest.devDependencies?.['@objectstack/spec'];
    const fromConsole = consoleManifest.devDependencies?.['@objectstack/spec'];
    expect(fromRoot, 'the root package.json must still declare @objectstack/spec').toBeDefined();
    expect(fromConsole, 'apps/console must still declare @objectstack/spec').toBeDefined();

    // The row names both files as its anchor, so it may only state one literal while
    // the two agree. Disagreement is a real event and belongs in the doc, not hidden.
    expect(
      fromConsole,
      'root and apps/console declare different @objectstack/spec ranges — ' +
        `${docRel}'s Spec row names both as its anchor and can no longer state one value`,
    ).toBe(fromRoot);

    expectRowStates('Spec', [fromRoot as string], `${docRel} must state the spec range as exactly "${fromRoot}"`);
  });

  it('quotes the `@objectstack/client` range the manifests declare', () => {
    const fromConsole = consoleManifest.devDependencies?.['@objectstack/client'];
    const fromAdapter = dataObjectstackManifest.dependencies?.['@objectstack/client'];
    expect(fromConsole, 'apps/console must still declare @objectstack/client').toBeDefined();
    expect(fromAdapter, 'packages/data-objectstack must still declare @objectstack/client').toBeDefined();
    expect(
      fromAdapter,
      'apps/console and packages/data-objectstack declare different @objectstack/client ranges — ' +
        `${docRel}'s Client row names both as its anchor and can no longer state one value`,
    ).toBe(fromConsole);

    expectRowStates(
      'Client',
      [fromConsole as string],
      `${docRel} must state the client range as exactly "${fromConsole}"`,
    );
  });
});

describe('QUICK_REFERENCE.md "Current Release" — toolchain rows', () => {
  /**
   * The row that was actually wrong while the card called it accurate. It cites
   * `engines.node` in its own text, so the floor it prints and the floor the manifest
   * declares are now the same number by construction.
   */
  it('states the Node floor from root `engines.node`', () => {
    const engine = rootManifest.engines?.node;
    expect(engine, 'root package.json must still declare engines.node').toBeDefined();

    const floor = versionFloor(engine as string);
    expect(floor, `engines.node must still carry a version floor (got "${engine}")`).toBeDefined();
    expectRowStates(
      'Node.js',
      [`≥ ${floor}`],
      `${docRel} must state the Node floor as exactly "≥ ${floor}" to match engines.node "${engine}"`,
    );
  });

  /**
   * objectui#6313: `match(/(\d+)/)?.[1]` on `engines.node` kept only the leading
   * integer group, so `>=22.11` derived a floor of `22` and a row reading exactly
   * `≥ 22` — missing the `.11` its own anchor states — passed. Two properties, both
   * measured against the REAL `engines.node` rather than a hard-coded literal, so
   * this cannot itself go stale the way the row it guards did:
   *
   * - The old (leading-integer) and new (whole-string) derivations must disagree
   *   whenever the anchor carries a minor — proving the fix changed what floor
   *   comes OUT, not just how it is computed. If `engines.node` ever loses its
   *   minor this assertion goes quiet, which is why the next one does not depend
   *   on that disagreement to make its point.
   * - A row stating the coarser, pre-fix floor must be REJECTED by the same
   *   equality `expectRowStates` uses above. This is the entire point of the card:
   *   if `≥ 22` were accepted before the fix and still accepted after it, the
   *   derivation changed without changing what the pin enforces.
   */
  it('derives the Node floor as the whole version, not just its leading integer group', () => {
    const engine = rootManifest.engines?.node as string;
    const staleFloor = engine.match(/(\d+)/)?.[1];
    const floor = versionFloor(engine);

    expect(
      floor,
      `engines.node ("${engine}") no longer carries a minor segment for the leading-integer ` +
        `derivation ("${staleFloor}") to differ from — objectui#6313's regression case needs one ` +
        're-anchored to keep exercising the disagreement',
    ).not.toBe(staleFloor);

    expect(
      statedLiterals(`≥ ${staleFloor}`),
      `a row reading "≥ ${staleFloor}" must NOT satisfy the derived Node floor "≥ ${floor}" — ` +
        'accepting it is exactly the objectui#6313 staleness this pin exists to catch',
    ).not.toEqual(statedLiterals(`≥ ${floor}`));
  });

  /**
   * The coarseness objectui#4913 already fixed for `toContain` (a numerically-prefixed
   * SUPERSET like `≥ 220` passing against a derived `≥ 22`) must not come back now that
   * the floor is derived differently. Built off the real anchor's leading integer group
   * so this states the exact shape the card's own history section records, rather than
   * a made-up number.
   */
  it('rejects a `≥ 220`-shaped row as equal to a shorter derived Node floor', () => {
    const engine = rootManifest.engines?.node as string;
    const staleFloor = engine.match(/(\d+)/)?.[1] as string;

    expect(
      statedLiterals(`≥ ${staleFloor}0`),
      `"≥ ${staleFloor}0" must not equal "≥ ${staleFloor}" — a numeric-prefix superset is not the ` +
        'same version literal, the objectui#4913 regression this guards',
    ).not.toEqual(statedLiterals(`≥ ${staleFloor}`));
  });

  it('states the pnpm floor and the pinned `packageManager`', () => {
    const engine = rootManifest.engines?.pnpm;
    expect(engine, 'root package.json must still declare engines.pnpm').toBeDefined();
    const floor = versionFloor(engine as string);

    const pinned = rootManifest.packageManager;
    expect(pinned, 'root package.json must still declare packageManager').toBeDefined();
    // Split off the version the same way the reverse sweep does, so one derivation
    // serves both directions and they cannot drift apart on this row.
    const pinnedVersion = (pinned as string).split('@').pop() as string;

    expectRowStates(
      'pnpm',
      [`≥ ${floor}`, pinnedVersion],
      `${docRel}'s pnpm row must state exactly the floor "≥ ${floor}" and the pinned "${pinned}"`,
    );

    // Containment deliberately, and only over the part that is NOT a version literal:
    // the equality above holds the digits, this holds the tool they belong to, so a row
    // quoting the right version against the wrong package manager still goes red.
    expect(row('pnpm'), `${docRel} must quote the pinned packageManager "${pinned}"`).toContain(pinned as string);
  });

  /**
   * Derived from a manifest rather than from `react-peer-range-norm-3741.test.ts`'s
   * `REACT_PEER_NORM` constant on purpose: that test already pins every workspace
   * manifest to one range, so any single manifest is representative — and going
   * through the manifest keeps this file free of a second copy of the range.
   */
  it('states the React majors the packages declare as peers', () => {
    const peer = reactManifest.peerDependencies?.react;
    expect(peer, 'packages/react must still declare a react peer range').toBeDefined();

    const majors = peerMajors(peer as string);
    expect(majors.length, `could not read majors out of the react peer range "${peer}"`).toBeGreaterThan(0);

    const expected = majors.map((major) => `${major}.x`);
    expectRowStates(
      'React',
      expected,
      `${docRel} must name exactly React ${expected.join(' + ')} — the peer range is "${peer}"`,
    );
  });
});

/**
 * The unanchored row, and the guard that retires the exemption for us.
 *
 * `≥ 5.0` is believed true and is checkable against nothing. If a `typescript` peer or
 * engine range ever lands in a workspace manifest, an anchor exists and the row must
 * start quoting it — so this fails at that moment rather than leaving a stale exemption
 * in place for the next reader to trust.
 */
const UNANCHORED_LITERAL = '≥ 5.0';

describe('QUICK_REFERENCE.md "Current Release" — the unanchored TypeScript row', () => {
  it('is still unanchored, and still says so on the row', () => {
    const anchors: string[] = [];
    for (const rel of ['packages', 'apps'] as const) {
      for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pkgRel = `${rel}/${entry.name}/package.json`;
        if (!fs.existsSync(path.join(repoRoot, pkgRel))) continue;
        const pkg = manifest(pkgRel);
        if (pkg.peerDependencies?.typescript || pkg.engines?.typescript) anchors.push(pkgRel);
      }
    }

    expect(
      anchors,
      `a typescript range is now declared in ${anchors.join(', ')} — ${docRel}'s TypeScript row ` +
        'has an anchor at last and must be pinned to it here, replacing this exemption',
    ).toEqual([]);

    expectRowStates(
      'TypeScript',
      [UNANCHORED_LITERAL],
      `${docRel}'s TypeScript row must still state exactly "${UNANCHORED_LITERAL}"`,
    );
    expect(
      row('TypeScript'),
      `${docRel}'s TypeScript row is the one unanchored claim in the block and must keep saying so, ` +
        'so a reader can tell it apart from the rows a test holds to account',
    ).toMatch(/not a manifest fact/i);
  });
});

describe('QUICK_REFERENCE.md "Current Release" — no un-derived literal', () => {
  it('contains only version literals this test derives from a manifest', () => {
    const derived = new Set<string>();
    const add = (literal: string | undefined): void => {
      if (literal) derived.add(normalize(literal));
    };

    add(consoleManifest.version);
    add(rootManifest.devDependencies?.['@objectstack/spec']);
    add(consoleManifest.devDependencies?.['@objectstack/client']);
    add(`≥ ${versionFloor(rootManifest.engines?.node ?? '')}`);
    add(`≥ ${versionFloor(rootManifest.engines?.pnpm ?? '')}`);
    add(rootManifest.packageManager?.split('@').pop());
    for (const major of peerMajors(reactManifest.peerDependencies?.react ?? '')) {
      add(`${major}.x`);
    }
    add(UNANCHORED_LITERAL);

    const undecided: string[] = [];
    for (const value of releaseRows.values()) {
      for (const match of value.matchAll(VERSION_LITERAL)) {
        if (!derived.has(normalize(match[0]))) undecided.push(match[0]);
      }
    }

    expect(
      undecided,
      `${docRel}'s "Current Release" block states ${JSON.stringify(undecided)}, which no manifest in ` +
        'this tree produced. Every row under a heading that says "Current" must be derived from an ' +
        'anchor and asserted above, or it is the next objectui#4143. Derived values are: ' +
        `${JSON.stringify([...derived])}.`,
    ).toEqual([]);
  });
});
