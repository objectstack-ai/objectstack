import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#3741: `packages/react-runtime/package.json` declared
 * `peerDependencies.react` as `>=18` — no upper bound — while every other react peer
 * in the workspace declared `^18.0.0 || ^19.0.0`. An unbounded range does not merely
 * look untidy: the day React 20 ships, that manifest starts claiming compatibility with
 * a major nobody here has built against, let alone tested, and it makes the claim
 * silently, in a published package, with no commit and no review to point at.
 *
 * Why this is a gate and not just the one-line fix it accompanies: react-runtime is the
 * THIRD package born off-norm, and the first two were each corrected in isolation with
 * nothing left behind to stop a fourth.
 *
 *   - `plugin-dashboard` was born narrow (`^18.0.0` alone) and corrected on 2026-05-08
 *     (`d2b6ecec6`) inside an unrelated build fix.
 *   - `plugin-report` was born narrow on 2026-02-06 (`1e557cbda`) and corrected in
 *     objectui#3690 / PR #3727 — by then a React 19 consumer installing the published
 *     package hit an `ERESOLVE` while every sibling installed clean.
 *   - `react-runtime` was born unbounded on 2026-06-30 (`d23d6ebfa`, PR #2105) and is
 *     corrected here.
 *
 * Three hand-authored manifests, three different wrong spellings, one norm they were all
 * supposed to copy. That is an authoring mistake with a pattern, which is the case for
 * enforcing the norm mechanically rather than trusting the next author to look.
 *
 * ## Why the existing peer gate could not catch it
 *
 * `doc-version-claims.test.ts` already pins peer ranges (objectui#3717, widened in
 * #3750) — but it compares a README's peer line to ITS OWN manifest. That check is blind
 * to this defect in two independent ways, and react-runtime tripped both:
 *
 *   1. It judges the two sides against EACH OTHER, not against the norm. react-runtime's
 *      README said `react >= 18` and its manifest said `>=18`; they agreed, so the gate
 *      was green for the five weeks the unbounded range sat there. A wrong range spelled
 *      consistently on both sides is invisible to it by construction.
 *   2. It can only see a manifest that has a README peer line beside it. 11 of 39
 *      packages carry a peer block; the other 28 declare peers no doc restates, so their
 *      ranges are judged by nothing at all.
 *
 * So the two gates ask genuinely different questions. That one asks "does the doc tell
 * the truth about the manifest"; this one asks "does the manifest state the range the
 * fixed version group agreed on". Neither subsumes the other.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The one spelling. Not derivable from anything in the tree — it is a convention about
 * which React majors this repo builds and tests against — so it is written here as the
 * single place that states it, and this test is what makes "declared" mean "enforced".
 *
 * Both halves of the range are load-bearing and for different reasons. The `^18.0.0` arm
 * is the floor the packages actually support. The `^19.0.0` arm is the CEILING: it is
 * what stops a published manifest from promising a major that does not exist yet. The
 * workspace resolves React through a root `pnpm.overrides` pin (`19.2.8` at the time of
 * writing), so 19 is also the only major any of these packages has ever been exercised
 * against — an upper bound above it would be a claim with no test behind it.
 *
 * Moving the norm (adding a `^20.0.0` arm when React 20 is genuinely supported) is
 * deliberately a repo-wide act: every declaration moves together or this test goes red.
 * That is the intent. A fixed version group that ships 39 packages from one release
 * cannot have per-package React support windows without the difference being a lie
 * somewhere.
 */
const REACT_PEER_NORM = '^18.0.0 || ^19.0.0';

/** The React packages the norm governs. Both were widened together in objectui#3690. */
const GOVERNED = ['react', 'react-dom'] as const;

interface WorkspacePackage {
  name: string;
  dir: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

/**
 * The `packages:` globs from `pnpm-workspace.yaml`, read rather than hardcoded so a new
 * workspace root is covered the day it is added — and throwing rather than skipping on a
 * shape it does not understand, because a guard that quietly stops looking at part of the
 * workspace keeps reporting success over a shrinking surface. Same reasoning, and the
 * same two supported shapes (`dir/*` and a bare `dir`), as
 * `workspace-peer-dependency-edges.test.ts`.
 */
function workspaceGlobs(): string[] {
  const yaml = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  expect(start, '`pnpm-workspace.yaml` must still declare a top-level `packages:` key').toBeGreaterThan(-1);

  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    // A non-indented line ends the `packages:` block.
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(#.*)?$/);
    if (!match) {
      throw new Error(
        `Unparsed entry in pnpm-workspace.yaml \`packages:\`: ${JSON.stringify(line)} — teach this guard the new syntax.`,
      );
    }
    globs.push(match[1]);
  }
  return globs;
}

function readWorkspacePackages(): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const glob of workspaceGlobs()) {
    let dirs: string[];
    if (glob.endsWith('/*')) {
      const parent = path.join(repoRoot, glob.slice(0, -2));
      dirs = fs.existsSync(parent)
        ? fs
            .readdirSync(parent)
            .map((d) => path.join(parent, d))
            .filter((d) => fs.statSync(d).isDirectory())
        : [];
    } else if (!glob.includes('*')) {
      dirs = [path.join(repoRoot, glob)];
    } else {
      throw new Error(`Unsupported workspace glob ${JSON.stringify(glob)} — teach this guard how to expand it.`);
    }

    for (const dir of dirs) {
      const pkgPath = path.join(dir, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (!json.name) continue;
      found.push({
        name: json.name,
        dir: path.relative(repoRoot, dir),
        dependencies: json.dependencies ?? {},
        peerDependencies: json.peerDependencies ?? {},
      });
    }
  }
  return found;
}

const packages = readWorkspacePackages();

interface Declaration {
  pkg: WorkspacePackage;
  dep: string;
  range: string;
}

const declarations: Declaration[] = packages.flatMap((pkg) =>
  GOVERNED.filter((dep) => pkg.peerDependencies[dep] !== undefined).map((dep) => ({
    pkg,
    dep,
    range: pkg.peerDependencies[dep],
  })),
);

describe('React peer ranges state the fixed version group norm', () => {
  it('discovers the workspace and its React peers (guard cannot pass by finding nothing)', () => {
    // Without these floors a broken glob parser or a moved directory would turn the
    // assertions below into a vacuous pass over an empty list — the failure mode that
    // makes a green gate worthless.
    expect(packages.length, 'the workspace globs resolved to implausibly few packages').toBeGreaterThan(30);

    // Measured on the objectui#3741 branch: 31 `react` + 25 `react-dom` = 56. A floor
    // rather than a pin, because this legitimately shrinks when a package stops needing
    // the host to supply React.
    expect(
      declarations.length,
      'implausibly few React peer declarations were found - the manifest read collapsed and ' +
        'this gate is now green over nothing',
    ).toBeGreaterThanOrEqual(50);
  });

  it('declares every React peer as the norm, with no exemptions', () => {
    const violations = declarations
      .filter((d) => d.range !== REACT_PEER_NORM)
      .map((d) => `${d.pkg.name} (${d.pkg.dir}/package.json) declares "${d.dep}": ${JSON.stringify(d.range)}`);

    expect(
      violations,
      [
        `Every React peer range in this workspace must read exactly ${JSON.stringify(REACT_PEER_NORM)}:`,
        '',
        ...violations,
        '',
        'There is deliberately NO exemption list here, and there should not become one: at the',
        'time of writing all 56 declarations satisfy this, so an exemption would be',
        'indistinguishable from the bug it was added to hide (the same reasoning as',
        'workspace-peer-dependency-edges.test.ts).',
        '',
        'An unbounded range (`>=18`) is the specific defect objectui#3741 fixed - it claims a',
        'major that does not exist yet. A narrow one (`^18.0.0` alone) is objectui#3690 - it',
        'makes a React 19 consumer hit ERESOLVE on install. Both spellings have shipped from',
        'this repo before; neither is a matter of taste.',
        '',
        'If React 20 support is real, widen the norm above and every declaration in the same',
        'change, and say so in a changeset - the version group releases as one.',
      ].join('\n'),
    ).toEqual([]);
  });

  /**
   * objectui#8303, the second invariant this file carries: a package must not ask its host
   * for React as a PEER and also pin a React of its own in `dependencies`. Those are two
   * contradictory statements in one manifest, and the one that wins is the wrong one — a
   * consumer on React 18 satisfies the peer range and STILL gets the pinned React 19
   * installed on this package's account. Two React copies in one tree is the classic cause
   * of `Invalid hook call`, and the failure is not at install time: it is at first render,
   * in the consumer's own component, pointing nowhere near here.
   *
   * `packages/layout` and `packages/plugin-dashboard` were the only two packages in the
   * workspace doing this, against 20+ siblings that declare the peer range and keep React
   * in `devDependencies` (or not at all). The fix converged on that existing shape rather
   * than inventing one.
   *
   * ## Why an existing gate could not catch it, and why this one is here
   *
   * `check:unused-deps` asks whether a declared runtime dependency has a CONSUMER.
   * `react` is imported by both packages, so the declaration has one, and that gate is
   * green on this shape by construction — it is not a weak reading, it is the wrong
   * question. objectui#8198 removed the `react-dom` half of this same defect from these
   * same two manifests precisely because `react-dom` had no consumer and so was visible to
   * it; the `react` half survived that sweep for exactly that reason. A green from an
   * instrument on a class it cannot see by design is not a reading.
   *
   * `check-changeset-presence.mjs` cannot see it either, and says so in its own docblock:
   * `CONTRACT_FIELDS` is an eight-field allowlist that includes `peerDependencies` and
   * deliberately excludes `dependencies` ("a runtime dependency bump can be just as
   * user-visible as any of the eight, and this gate still does not see it").
   *
   * ## What this asserts, and what it deliberately does NOT
   *
   * The invariant is the CONTRADICTION, not "React in `dependencies`". `@object-ui/runner`,
   * `@object-ui/site` and the `examples/*` consoles all pin React in `dependencies` and
   * declare no React peer: they are applications that supply React rather than libraries
   * that ask for it, they make one statement instead of two, and they are correctly out of
   * scope here. Widening this to "no React in `dependencies` anywhere" would go red on them
   * for doing the right thing.
   *
   * Vacuity is covered by the floors in the first test: this iterates `declarations`, the
   * same >= 50 peer declarations the norm assertion walks.
   */
  it('declares no React runtime dependency in a package that also asks for it as a peer', () => {
    const violations = declarations
      .filter((d) => d.pkg.dependencies[d.dep] !== undefined)
      .map(
        (d) =>
          `${d.pkg.name} (${d.pkg.dir}/package.json) declares "${d.dep}" as a peer (${d.range}) ` +
          `AND pins it in dependencies (${JSON.stringify(d.pkg.dependencies[d.dep])})`,
      );

    expect(
      violations,
      [
        'A package may ask its host for React as a peer, or install a React of its own, but not both:',
        '',
        ...violations,
        '',
        'A consumer that satisfies the peer range still gets the pinned copy pulled into their graph,',
        'so a React 18 consumer ends up with two Reacts in one tree. That surfaces as `Invalid hook',
        "call` at FIRST RENDER, attributed to their component, with nothing pointing back at this",
        'manifest (objectui#8303).',
        '',
        'Fix: move the entry to `devDependencies` at the same pin, which is what the local build and',
        'test run actually need, and leave `peerDependencies` untouched. `app-shell`, `auth`,',
        '`collaboration`, `i18n`, `mobile` and `permissions` already have exactly that shape.',
        '',
        'There is deliberately NO exemption list here, for the same reason the norm assertion above',
        'has none: at the time of writing every declaration satisfies this, so an exemption would be',
        'indistinguishable from the bug it was added to hide.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('pins the two packages fixed in objectui#8303', () => {
    // The general assertion above catches a regression here too, but naming these two means a
    // revert points straight at the card that explains why the entry moved, rather than at a
    // rule someone has to go and read. Both halves are asserted: the dependency is GONE, and
    // the peer range is untouched — the fix is only correct if both are true at once.
    for (const name of ['@object-ui/layout', '@object-ui/plugin-dashboard']) {
      const pkg = packages.find((p) => p.name === name);
      expect(pkg, `${name} must exist in the workspace`).toBeDefined();
      expect(
        pkg!.dependencies.react,
        `${name} pinned react 19.2.8 in dependencies while also declaring the React peer range. ` +
          'It moved to devDependencies at the same pin in objectui#8303.',
      ).toBeUndefined();
      expect(
        pkg!.peerDependencies.react,
        `${name} must still ask its host for React — objectui#8303 moved the dependency, not the peer.`,
      ).toBe(REACT_PEER_NORM);
    }
  });

  it('pins the package fixed in objectui#3741', () => {
    // The general assertion above catches a regression here too, but naming it means a
    // revert points straight at the issue that explains why the bound exists, rather than
    // at a rule someone has to go and read.
    const pkg = packages.find((p) => p.name === '@object-ui/react-runtime');
    expect(pkg, '@object-ui/react-runtime must exist in the workspace').toBeDefined();
    expect(
      pkg!.peerDependencies.react,
      'react-runtime declared an unbounded `>=18` from its creation (PR #2105) until ' +
        'objectui#3741. It vendors react-runner and evaluates JSX against the host React, ' +
        'so it is exactly the package with no business promising a major it has never seen.',
    ).toBe(REACT_PEER_NORM);
  });
});
