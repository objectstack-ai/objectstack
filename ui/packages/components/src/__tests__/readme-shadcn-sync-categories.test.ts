/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `packages/components/README_SHADCN_SYNC.md` may not contradict
 * `shadcn-components.json` about which components are re-syncable (objectui#3881).
 *
 * ## Why this file exists
 *
 * The README used to publish the whole classification as prose — a
 * `### Shadcn Components` census of 46 names ("can be updated from the registry")
 * and a `### Custom ObjectUI Components` census of 14 ("should NOT be
 * auto-updated"). The manifest is the real source: `shadcn-sync.js` reads its
 * `components` / `customComponents` split to decide what an update may
 * overwrite. Nothing held the two together, so by objectui#3881 they disagreed
 * three ways:
 *
 *   - `resizable` was listed as registry-updatable while the manifest had it
 *     under `customComponents` — whose own entry says re-syncing it BREAKS THE
 *     BUILD (upstream still ships the react-resizable-panels v3 file, which
 *     imports two names v4 does not export). Following the README performed the
 *     breaking action;
 *   - `chart` was in the manifest's `components` and absent from the README
 *     entirely, so a synced component was documented nowhere;
 *   - the custom heading said 14 while the manifest held 15.
 *
 * ## Why this pin holds SETS, and deliberately not counts
 *
 * The filer's sharpest observation on objectui#3881 is the reason this file
 * asserts no totals anywhere: the README's `(46)` still matched the manifest's 46
 * on the day the card was written — because the two membership errors cancelled
 * out (`resizable` counted in, `chart` left out). A count check would have been
 * green across the whole defect. Counts are not a weaker guard here, they are a
 * fake one, and adding one later would re-introduce exactly that blind spot.
 *
 * ## The fix this pin defends is subtraction, not correction
 *
 * Re-spelling the two censuses correctly would have left the drift generator
 * loaded — a hand-maintained second copy of a machine-readable fact drifts again
 * on the next manifest edit, which is how objectui#3767 and objectui#3724 went
 * the same way. So the censuses are gone: the README now states the two
 * categories' MEANING and points at `pnpm shadcn:list`, which prints both from
 * the manifest, offline (it calls `loadManifest()` and no network at all).
 *
 * Exactly one enumeration survives, and it is here on purpose. The diverged set —
 * `customComponents` entries carrying a `divergedFrom` URL — is the subset whose
 * misreading is what objectui#3881 actually cost: not a stale list, a broken
 * build. A reader skimming the page must see that hazard by name without running
 * a command, so the names stay and this file holds them to the manifest.
 *
 * ## Direction — deliberately BOTH, plus a guard that the censuses stay gone
 *
 *   - README names a diverged component the manifest does not mark → the page
 *     warns about a component that is fine, and the next reader learns to
 *     distrust the warning;
 *   - the manifest marks one the README does not name → the build-breaking
 *     hazard is invisible on the page whose job is to warn about it (the
 *     objectui#3881 shape, verbatim);
 *   - the Component Categories section names any `components` key at all → the
 *     census is growing back. This is the one that keeps the subtraction from
 *     being quietly undone, and it is why the section's prose names no
 *     registry-synced component even as an example.
 *
 * Order is not compared, and neither are totals.
 *
 * ## The expected sets are READ OUT OF the manifest, never listed here
 *
 * Hardcoding "resizable" below would rebuild the defect one level up — a second
 * hand-maintained copy, this time in a test that would then have to be edited
 * whenever the manifest changed, which is the edit everybody makes without
 * reading. Both sides are parsed on every run, so a red here is always "fix the
 * README (or the manifest)", never "update the test".
 *
 * `resizable` returning to `components` once upstream regenerates for v4 is a
 * REAL expected future, not a defect, so it is handled explicitly rather than
 * left to a floor that would redden on it: when the manifest marks nothing
 * diverged, the README's subsection must be gone too (see the third test).
 *
 * ## Scan surface — deliberately narrow
 *
 * This file reads `packages/components/README_SHADCN_SYNC.md` and
 * `packages/components/shadcn-components.json`, plus `existsSync` for the paths
 * the README backticks. Nothing else. In particular it does not police the
 * Usage / Manual Sync / Rollback sections, whose fenced command examples name
 * components (`pnpm shadcn:update button`) legitimately — fenced blocks are
 * stripped before the section is judged for that reason.
 *
 * **`check-doc-links.mjs` DOES scan this file today.** The claim that stood
 * here — that no link gate can see it, because the per-package `SCAN_ROOTS` row
 * globbed one directory level and matched only the exact filename `README.md` —
 * became false with objectui#4938: that row now walks every markdown file under
 * each package directory and excludes only the basenames `README.md` and
 * `CHANGELOG.md`, at every depth. `README_SHADCN_SYNC.md` is neither, so it is
 * inside that row (re-verified against the live `SCAN_ROOTS` table for
 * objectui#6280 — 17 rows total, this file collected by the `packages/*` row
 * and by no other).
 *
 * That does not make the checks below redundant, for two reasons that would
 * each independently survive `check-doc-links.mjs` scanning every byte of this
 * README:
 *
 *   - **It cannot see the paths this file names.** Every in-repo path here —
 *     `shadcn-components.json`, `scripts/shadcn-sync.js`,
 *     `scripts/shadcn-local-patches.mjs` — is written as a backticked code
 *     span, never as a `[text](href)` markdown link, and `check-doc-links.mjs`
 *     blanks every inline code span (`stripCode()`) before its link regex ever
 *     runs, by design — a command example like `` `pnpm shadcn:update button` ``
 *     must not be misread as a broken link. This README's only actual markdown
 *     links (8, all external: `ui.shadcn.com`, `github.com/shadcn-ui/...`, and
 *     the Radix/Tailwind/CVA sites) carry nothing check-doc-links would resolve
 *     against this repo. So scanning this file today asserts nothing about the
 *     paths the last `it` block below checks — the objectui#3881 path drift
 *     (`## Files` claiming `shadcn-sync.js` sits in this directory when it has
 *     always been at the repo root) would go just as uncaught by that gate
 *     under today's widened surface as it did before objectui#4938.
 *   - **It has no notion of this file's actual defect class.** objectui#3881
 *     was two prose censuses disagreeing with `shadcn-components.json` about
 *     which components belong where — a comparison against a JSON manifest,
 *     not a link target. No widening of `SCAN_ROOTS`, at any width, gives a
 *     link checker that question to ask.
 *
 * The first reason is why the path check (the last `it` block) survives; the
 * second is why the category/manifest comparisons above it do. Both hold
 * regardless of `check-doc-links.mjs`'s scan surface — not because that
 * surface stops short of this file, since it no longer does.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** `packages/components` — two levels up from `src/__tests__`. */
const PKG_DIR = resolve(__dirname, '../..');
/** Repo root — `packages/components` is two levels below it. */
const REPO_ROOT = resolve(PKG_DIR, '../..');

const README = readFileSync(join(PKG_DIR, 'README_SHADCN_SYNC.md'), 'utf8');

interface ManifestEntry {
  readonly divergedFrom?: string;
  readonly movedToPlugin?: string;
  readonly description?: string;
}

interface Manifest {
  readonly components: Record<string, unknown>;
  readonly customComponents: Record<string, ManifestEntry>;
}

const MANIFEST = JSON.parse(
  readFileSync(join(PKG_DIR, 'shadcn-components.json'), 'utf8'),
) as Manifest;

/** The line that introduces the one surviving enumeration. */
const DIVERGED_ANCHOR = 'Currently diverged:';

/**
 * Body of a top-level `## ` section, up to the next top-level heading.
 *
 * `### ` subsections are deliberately included: the diverged list lives in one,
 * and it is part of what the Component Categories section claims.
 */
function topLevelSection(heading: string): string {
  const lines = README.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(
      [
        `packages/components/README_SHADCN_SYNC.md no longer has a "${heading}" heading, so this`,
        'pin has nothing to compare (objectui#3881). If the page was restructured, re-point this',
        'reader at the new heading — do not delete the pin, or the classification goes back to',
        'being prose that nothing holds to shadcn-components.json.',
      ].join('\n'),
    );
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

/** Fenced code blocks removed — they carry command examples, not claims. */
function withoutFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/** Inline `backticked` tokens, one entry per occurrence. */
function inlineTokens(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

function componentCategoriesProse(): string {
  return withoutFences(topLevelSection('## Component Categories'));
}

/** Whether the README still carries its diverged subsection at all. */
function divergedSectionPresent(): boolean {
  return componentCategoriesProse()
    .split('\n')
    .some((line) => line.trim() === DIVERGED_ANCHOR);
}

/** Component names the README lists as diverged. */
function documentedDiverged(): string[] {
  const lines = componentCategoriesProse().split('\n');
  const at = lines.findIndex((line) => line.trim() === DIVERGED_ANCHOR);
  if (at === -1) return [];

  const names: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      // Blank lines between the anchor and the list are layout; a blank AFTER
      // the first entry ends the list.
      if (names.length === 0) continue;
      break;
    }
    const bullet = /^- `([^`]+)`/.exec(line);
    if (!bullet) break;
    names.push(bullet[1]);
  }
  return names;
}

/** `customComponents` entries the manifest marks as diverged-from-upstream. */
function manifestDiverged(): string[] {
  return Object.entries(MANIFEST.customComponents)
    .filter(([, info]) => typeof info.divergedFrom === 'string')
    .map(([name]) => name);
}

describe("README_SHADCN_SYNC.md's categories match shadcn-components.json (objectui#3881)", () => {
  it('lists no diverged component the manifest does not mark diverged', () => {
    const marked = manifestDiverged();
    const documented = documentedDiverged();

    expect(
      documented.filter((name) => !marked.includes(name)),
      [
        'README_SHADCN_SYNC.md lists a component under "Diverged components - re-syncing breaks',
        'the build" that shadcn-components.json does not mark with `divergedFrom`.',
        '',
        'Either the manifest moved it back into `components` (upstream regenerated for the major',
        'this repo installs) and the README kept warning about it — drop the bullet, and drop the',
        'whole subsection if it was the last one — or the name is simply wrong.',
        '',
        'The expected set is READ OUT OF shadcn-components.json on every run, so this is never',
        '"update the test".',
        `Marked diverged in the manifest: ${marked.join(', ') || '(none)'}`,
        `Listed in the README: ${documented.join(', ') || '(none)'}`,
      ].join('\n'),
    ).toEqual([]);
  });

  it('and lists every component the manifest marks diverged', () => {
    const marked = manifestDiverged();
    const documented = documentedDiverged();

    expect(
      marked.filter((name) => !documented.includes(name)),
      [
        'shadcn-components.json marks a component with `divergedFrom` — meaning upstream still',
        'ships a version that cannot compile here, so re-syncing it BREAKS THE BUILD — and',
        'README_SHADCN_SYNC.md does not name it.',
        '',
        'This is the objectui#3881 defect verbatim: the page a reader consults before running',
        '`pnpm shadcn:update` stays silent about the one component where that command is',
        'destructive. Add it to the "Currently diverged:" list, or stop marking it in the',
        'manifest.',
        `Marked diverged in the manifest: ${marked.join(', ') || '(none)'}`,
        `Listed in the README: ${documented.join(', ') || '(none)'}`,
      ].join('\n'),
    ).toEqual([]);
  });

  it('and both sides really parsed — the manifest split is read, and the hazard section exists exactly while the hazard does', () => {
    // Two set-difference assertions are BOTH trivially green on two empty lists,
    // which is how a pin dies without ever going red: if the README were
    // reworded so the anchor stopped matching, the tests above would silently
    // become no-ops. The floors are asserted here as their own visible fact
    // rather than only inside `expect` messages.
    const components = Object.keys(MANIFEST.components);
    const custom = Object.keys(MANIFEST.customComponents);

    expect(
      components.length,
      'no `components` entries parsed out of shadcn-components.json — every assertion in this file would prove nothing',
    ).toBeGreaterThan(1);
    expect(
      custom.length,
      'no `customComponents` entries parsed out of shadcn-components.json — every assertion in this file would prove nothing',
    ).toBeGreaterThan(1);

    // A component may not be in both objects: the two are a partition, and
    // `shadcn-sync.js` would have to pick one. This is the manifest-side drift
    // the README comparison above cannot see.
    expect(
      components.filter((name) => custom.includes(name)),
      'shadcn-components.json lists a component in BOTH `components` and `customComponents`; the two are meant to partition the tracked set, and the sync script reads the split to decide whether an update may overwrite the local file',
    ).toEqual([]);

    // The honest treatment of the empty case. `resizable` going back to
    // `components` is an expected future (upstream regenerating for
    // react-resizable-panels v4), not a defect — so rather than a floor that
    // would redden on it, the requirement is an "exactly while": the README
    // carries its diverged subsection if and only if the manifest marks
    // something diverged.
    const marked = manifestDiverged();
    expect(
      divergedSectionPresent(),
      marked.length > 0
        ? [
            `shadcn-components.json marks ${marked.length} component(s) with \`divergedFrom\` (${marked.join(', ')}),`,
            'but README_SHADCN_SYNC.md no longer has its "Currently diverged:" list. That list is the',
            'only place a reader is warned before running a build-breaking `pnpm shadcn:update`.',
            'Restore it (and re-point DIVERGED_ANCHOR if the wording changed) — removing it is how',
            'objectui#3881 happened.',
          ].join('\n')
        : [
            'No component in shadcn-components.json carries `divergedFrom` any more, but',
            'README_SHADCN_SYNC.md still has a "Currently diverged:" list. If upstream regenerated',
            'and the component moved back into `components`, delete that whole subsection together',
            'with the two set tests above — a hazard section for a hazard that no longer exists is',
            'the next stale claim.',
          ].join('\n'),
    ).toBe(marked.length > 0);

    if (marked.length > 0) {
      const documented = documentedDiverged();
      expect(
        documented.length,
        'the "Currently diverged:" anchor was found but no `backticked` bullet parsed under it — the two set assertions above are comparing against an empty list and proving nothing',
      ).toBeGreaterThan(0);

      // A repeated entry keeps both set differences empty while the two lists
      // are not the same list, so it is the one drift the pair above cannot see.
      expect(
        documented.length,
        `The README lists a diverged component twice: ${documented.join(', ')}`,
      ).toBe(new Set(documented).size);
      expect(
        marked.length,
        `shadcn-components.json marks a component diverged twice: ${marked.join(', ')}`,
      ).toBe(new Set(marked).size);
    }
  });

  it('and the Component Categories prose names no registry-synced component — the census stays gone', () => {
    const components = Object.keys(MANIFEST.components);
    expect(
      components.length,
      'no `components` entries parsed out of shadcn-components.json — the assertion below would prove nothing',
    ).toBeGreaterThan(1);

    const prose = componentCategoriesProse();
    expect(
      prose.length,
      'the Component Categories section is empty after stripping fenced blocks — the assertion below would prove nothing',
    ).toBeGreaterThan(0);

    expect(
      [...new Set(inlineTokens(prose))].filter((token) => components.includes(token)),
      [
        'The `## Component Categories` section names a component that shadcn-components.json',
        'lists under `components` (registry-synced). That section is deliberately census-free:',
        'objectui#3881 was caused by a hand-maintained copy of this exact classification, and it',
        'was fixed by deleting the copy, not by correcting it — the page now states what the two',
        'categories MEAN and points at `pnpm shadcn:list`, which prints both from the manifest.',
        '',
        'If a per-component list is growing back here, it will drift again. If instead the',
        'manifest just moved a name from `customComponents` into `components` while the README',
        'still discusses it by name, update the README to match the manifest.',
        '',
        'Command examples inside fenced code blocks are exempt (they are stripped before this',
        'check), so a `pnpm shadcn:update <a component>` example is fine — inline prose is not.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('and every in-repo path the README backticks exists on disk', () => {
    // objectui#3881 also recorded a path drift: `## Files` claimed the sync
    // script sits in this directory while it has always been at the repo root.
    // No link gate can see this file (see the header), so the check lives here.
    // Fences are stripped: their examples include a deliberate glob
    // (`.backup/button.tsx.*`) that is not a real path.
    const prose = withoutFences(README);
    const tokens = [...new Set(inlineTokens(prose))].filter((token) => !token.includes('*'));

    const repoRelative = tokens.filter((token) =>
      /^(packages|scripts|apps|content|docs|examples|e2e|public|patches|skills)\//.test(token),
    );
    const packageRelative = tokens.filter((token) => /^src\//.test(token));

    expect(
      repoRelative.length,
      'no repo-relative backticked path parsed out of README_SHADCN_SYNC.md — the assertion below would prove nothing, and the `## Files` section is meant to name at least the manifest and the sync script',
    ).toBeGreaterThan(1);

    expect(
      repoRelative.filter((token) => !existsSync(join(REPO_ROOT, token))),
      [
        'README_SHADCN_SYNC.md backticks a repo-relative path that does not exist. This is the',
        'objectui#3881 path drift: the page told readers the sync script was in',
        'packages/components/ when it is at scripts/shadcn-sync.js.',
      ].join('\n'),
    ).toEqual([]);

    expect(
      packageRelative.filter((token) => !existsSync(join(PKG_DIR, token))),
      [
        'README_SHADCN_SYNC.md backticks a path under `src/` (read as relative to',
        'packages/components/) that does not exist.',
      ].join('\n'),
    ).toEqual([]);
  });
});
