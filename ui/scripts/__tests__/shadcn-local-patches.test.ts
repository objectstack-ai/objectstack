import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494. (On a
// multi-line import the directive never worked anyway: TS reports the missing
// declaration at the SPECIFIER line, not at the `import {` the comment guards.)
import {
  LOCAL_PATCHES,
  applyLocalPatches,
  verifyLocalPatches,
  patchedComponents,
  describePatchFailure,
} from '../shadcn-local-patches.mjs';
// The licence header `updateComponent` prepends on write. Imported rather than
// re-typed so the round-trip assertion below strips exactly what the sync adds;
// importing the CLI module is safe (it only runs `main()` when it IS the
// process entry point) and `shadcn-sync-fetch-cache.test.ts` already does it.
import { OBJECTUI_HEADER, rewriteRegistryImports } from '../shadcn-sync.js';

/**
 * objectstack#5505 — the Shadcn `Sheet`/`Dialog` primitives shipped a hardcoded
 * English `Close` sr-only span, which (being icon-only buttons) IS their
 * accessible name, so every drawer and modal announced "Close" under zh/ja/es.
 *
 * `packages/components/src/ui/**` is regenerated from the upstream registry, so
 * the fix could not simply be typed into those files — the next
 * `pnpm shadcn:update` would revert it, silently and compilably. The fix is
 * therefore DECLARED in `scripts/shadcn-local-patches.mjs` and re-applied by
 * the sync itself.
 *
 * This file is the enforcement half of that contract, and it is deliberately
 * offline: the registry is not reachable from CI (nor from the sandbox this was
 * written in), so a test that needed the network could not gate anything. Every
 * assertion below is pure string work over a fixture or over the files on disk.
 *
 * It covers four separate regressions:
 *
 *   1. the patch stops being applied to the files we ship  (`describe` #3)
 *   2. the patch engine stops applying it to fresh upstream (`describe` #1)
 *   3. the patch silently no-ops against changed upstream   (`describe` #2)
 *   4. an anchor was never written from upstream at all     (`describe` #4)
 *
 * #4 is the objectui#4976 shape and the youngest of the four: markers present,
 * `verifyLocalPatches` empty, every other assertion green, and an anchor that
 * has never matched a registry response. Only applying the declaration to real
 * registry bytes can see it, which is what the vendored fixtures are for
 * (objectui#4996).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const uiDir = path.join(repoRoot, 'packages/components/src/ui');

/**
 * The components carrying the i18n close-label patch family.
 *
 * The registry is a general mechanism and now holds an unrelated family too
 * (`sidebar`, objectui#4234), so the close-label assertions below must iterate
 * THIS list and not `patchedComponents()` — the latter would assert one
 * family's ids and marker on every patched primitive. Derived rather than
 * hardcoded so a third `Sheet`-like primitive is picked up automatically.
 */
const closeLabelComponents = patchedComponents().filter((name: string) =>
  LOCAL_PATCHES[name].some((p: { marker: string }) => p.marker === '<CloseSrLabel />'),
);

/**
 * Where the vendored registry fixtures live: one file per patched family,
 * holding the registry's `files[0].content` VERBATIM, exactly as
 * `https://ui.shadcn.com/r/styles/default/<name>.json` serves it — before
 * `rewriteRegistryImports`, so the bytes can be hashed against the provenance
 * recorded below.
 *
 * `.txt`, not `.tsx`, and that is deliberate: this is captured upstream text,
 * not source this repo owns. ESLint targets `**\/*.{ts,tsx}` and would lint
 * these as if we had written them; `tsconfig.scripts.json` compiles
 * `scripts/**\/*.ts`. Neither should have an opinion about upstream's code,
 * and neither can be made to have one about a `.txt`.
 */
const registryFixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/shadcn-registry',
);

/**
 * @property url       The registry endpoint `shadcn-components.json` syncs from.
 * @property repoPath  Where shadcn-ui/ui checks that same JSON in verbatim.
 * @property headSha   The commit the fixture was captured at.
 * @property sha256    Hash of the captured `files[0].content` bytes.
 * @property roundTrip `true` when patching these bytes reproduces the shipped
 *                     primitive exactly; otherwise the REASON it cannot, which
 *                     is always an undeclared local edit (see below).
 */
interface RegistryFixture {
  url: string;
  repoPath: string;
  headSha: string;
  sha256: string;
  roundTrip: true | string;
}

/**
 * objectui#4996 — provenance for every vendored fixture.
 *
 * ## Why a vendored snapshot rather than a live fetch
 *
 * Verifying an anchor means applying it to bytes upstream actually served, and
 * this repo cannot reach upstream from the place the verification has to run:
 * `ui.shadcn.com` does not resolve from CI or from the sandboxes these tests
 * are written in (measured again for objectui#4996: the registry host times out
 * where `raw.githubusercontent.com` answers 200). A test that fetched would
 * therefore SKIP on every PR — and a gate that skips silently is worse than no
 * gate, because it reports green for a surface nobody read. The bytes are
 * vendored instead, so this suite is deterministic, offline, and has no
 * did-not-run state to confuse with a clean one.
 *
 * ## What a green run here does and does NOT mean
 *
 * It means: **every declared anchor was written from real registry bytes**, the
 * property objectui#4976 turned out to lack and the one that cannot be stated
 * offline any other way. An anchor reverse-engineered from `src/ui/**` matches
 * the local file happily and cannot match these.
 *
 * It does NOT mean upstream still looks like this TODAY. That is a different
 * question, it needs the network, and it already has an owner: the weekly
 * `Check Shadcn Components` workflow runs `pnpm shadcn:check` online against all
 * 46 components, exits non-zero on a patch that no longer re-applies, and —
 * crucially — distinguishes "registry unreachable" from "registry clean" via
 * its three-valued cross-run marker steps (objectui#3586). Upstream drift is
 * that job's reading; anchor provenance is this file's. Neither substitutes for
 * the other, and this suite must never be described as covering drift.
 *
 * ## Refreshing a fixture
 *
 * Re-capture `files[0].content` verbatim from the URL below and update `sha256`
 * (and `headSha`) in the same commit. What a red `sha256` must NEVER mean is
 * "edit the fixture until it agrees again" — that is precisely the hand-trimmed
 * "faithful excerpt" objectui#4976 was made of, and the hash exists to make it
 * impossible to do quietly.
 */
const REGISTRY_FIXTURES: Record<string, RegistryFixture> = {
  sheet: {
    url: 'https://ui.shadcn.com/r/styles/default/sheet.json',
    repoPath: 'apps/v4/public/r/styles/default/sheet.json',
    headSha: '8a7701ec27eb9cb8e0377db769fbe6d744113c52',
    sha256: '9051eb9d885a18c0521c63c945480effcfca29282d2a342cb3ce7f9d080c6d38',
    // Promoted to `true` by objectui#6090. It read
    // `'ships the undeclared `hideOverlay` prop'` until then: that edit was
    // documented in `shadcn-components.json` but declared nowhere, so patched
    // upstream came out exactly 3 lines short of the shipped file and equality
    // was genuinely unavailable. Declaring the `hideOverlay` family closed the
    // last gap, and this entry is the measurement — `sheet` now accounts for
    // EVERY way it differs from upstream, which is a strictly stronger gate
    // than the pinned-inequality branch it used to take.
    roundTrip: true,
  },
  dialog: {
    url: 'https://ui.shadcn.com/r/styles/default/dialog.json',
    repoPath: 'apps/v4/public/r/styles/default/dialog.json',
    headSha: '8a7701ec27eb9cb8e0377db769fbe6d744113c52',
    sha256: '60d5246653c714fc12a67743ee5951331ecd2548cdaef9a599922bcb14da26db',
    roundTrip: true,
  },
  sidebar: {
    url: 'https://ui.shadcn.com/r/styles/default/sidebar.json',
    repoPath: 'apps/v4/public/r/styles/default/sidebar.json',
    headSha: '8a7701ec27eb9cb8e0377db769fbe6d744113c52',
    sha256: 'ad7f3674de583ed57c87413b8434d3428d82f554b7ad3e590df329ed55830bb7',
    // The expensive fixture the issue flagged (774 lines) — taken in full
    // anyway, because a trimmed one could not be hashed against its source and
    // an unhashed excerpt is the objectui#4976 defect wearing a fixture's
    // clothes. It is static text read once per run; the cost is bytes on disk,
    // not time.
    //
    // `sidebar.tsx` carries three systematic undeclared local edits documented
    // in `shadcn-components.json` — the Tailwind v4 `[--var]` → `(--var)`
    // migration (load-bearing: the v3 spelling compiles to invalid CSS on
    // Tailwind 4.x), `theme(spacing.4)` → `1rem`, and an unconditional
    // `data-collapsible` — so byte-equality is not available here either.
    roundTrip: 'ships three undeclared systematic local edits (shadcn-components.json)',
  },
  slider: {
    url: 'https://ui.shadcn.com/r/styles/default/slider.json',
    repoPath: 'apps/v4/public/r/styles/default/slider.json',
    headSha: '8a7701ec27eb9cb8e0377db769fbe6d744113c52',
    sha256: '48bd0ba32cc7f341ecca995374be73111da2f761694cfcf91dbf8d4d9e632c06',
    roundTrip: true,
  },
  calendar: {
    url: 'https://ui.shadcn.com/r/styles/default/calendar.json',
    repoPath: 'apps/v4/public/r/styles/default/calendar.json',
    // Captured for objectui#10722 at the same commit as the four above, from
    // `raw.githubusercontent.com` (the registry host does not resolve here).
    // The same capture reproduces `slider`'s recorded sha256 byte for byte.
    headSha: '8a7701ec27eb9cb8e0377db769fbe6d744113c52',
    sha256: '745a6c30a70681c3ae88cb1421317ec5d06d02202e615f12db700e1776311148',
    // `calendar.tsx` carries undeclared local edits: the Tailwind v4
    // `[--cell-size]` → `(--cell-size)` migration documented in
    // `shadcn-components.json`, and no `month_grid` class entry.
    roundTrip: 'ships undeclared local edits (the Tailwind v4 `(--cell-size)` spelling, no `month_grid` entry)',
  },
};

/** The captured registry bytes for `name`, exactly as served (pre-rewrite). */
function readRegistryFixture(name: string): Buffer {
  return fs.readFileSync(path.join(registryFixturesDir, `${name}.registry.txt`));
}

/**
 * The captured bytes after `rewriteRegistryImports` — i.e. the exact input the
 * patch engine sees during `--update`.
 *
 * The rewrite is IMPORTED from the sync rather than re-typed here for the same
 * reason `OBJECTUI_HEADER` is: a second copy of the transform could drift, and a
 * drifted copy would make these fixtures agree with this test while disagreeing
 * with what `pnpm shadcn:update` actually writes.
 */
function upstreamFor(name: string): string {
  return rewriteRegistryImports(readRegistryFixture(name).toString('utf-8'));
}

/** Registry bytes for `dialog`, the i18n close-label family's worked example. */
const UPSTREAM_DIALOG = upstreamFor('dialog');

/** Registry bytes for `slider`, the family objectui#4976 was found in. */
const UPSTREAM_SLIDER = upstreamFor('slider');

describe('shadcn local patches — application to fresh upstream (objectstack#5505)', () => {
  /**
   * Scoped to the close-label family's own `issue`, NOT to every patch declared
   * for the primitive. `sheet` carries a second family since objectui#6090
   * (`hideOverlay`), so a whole-list equality here would assert that no
   * primitive may ever carry more than one — the same over-reach the
   * `closeLabelComponents` derivation above exists to avoid. Order within the
   * family still matters and is still asserted: the import must land before the
   * label swap.
   */
  it.each(closeLabelComponents)('%s declares the i18n close patch', (name: string) => {
    const ids = LOCAL_PATCHES[name]
      .filter((p: { issue: string }) => p.issue === 'objectstack#5505')
      .map((p: { id: string }) => p.id);
    expect(ids).toEqual([`${name}-i18n-close-import`, `${name}-i18n-close-label`]);
  });

  /**
   * The fourth family: sheet's `hideOverlay` prop (objectui#6090).
   *
   * All three halves are listed because dropping any one of them leaves a state
   * that still compiles: without the prop declaration external consumers lose
   * the API, without the destructure the value leaks to the DOM as
   * `hideoverlay="true"` and the conditional reads `undefined`, and without the
   * conditional the prop is accepted and silently ignored.
   */
  it('sheet declares the hideOverlay patches', () => {
    const ids = LOCAL_PATCHES.sheet
      .filter((p: { issue: string }) => p.issue === 'objectui#6090')
      .map((p: { id: string }) => p.id);
    expect(ids).toEqual([
      'sheet-hide-overlay-prop',
      'sheet-hide-overlay-destructure',
      'sheet-hide-overlay-conditional',
    ]);
  });

  /** The other declared family: the sidebar collapse-persistence patch. */
  it('sidebar declares the cookie-read patch', () => {
    const ids = LOCAL_PATCHES.sidebar
      .filter((p: { issue: string }) => p.issue === 'objectui#4234')
      .map((p: { id: string }) => p.id);
    expect(ids).toEqual(['sidebar-cookie-read-import', 'sidebar-cookie-read-initial-state']);
  });

  /**
   * The sixth family: the sidebar's non-throwing context read (objectui#10859,
   * batch 8 phase 2d). Both halves are listed because the reader alone compiles
   * and is unreachable — the SDUI `sidebar` registration imports the EXPORTED
   * name, so without the export it fails to build, and without the reader the
   * export names nothing.
   */
  it('sidebar declares the optional-context patches', () => {
    const ids = LOCAL_PATCHES.sidebar
      .filter((p: { issue: string }) => p.issue === 'objectui#10859')
      .map((p: { id: string }) => p.id);
    expect(ids).toEqual(['sidebar-optional-context-reader', 'sidebar-optional-context-export']);
  });

  /**
   * The seventh family: the sidebar's offcanvas rules qualified by the collapsed
   * state (objectui#11464). One patch per upstream line, and every one is
   * listed: each line drops a different part of the expanded sidebar off its
   * place on its own (the gap, the left panel, the right panel, the rail), and
   * dropping any one of them still compiles. Chromium reads the geometry in
   * `e2e/sidebar-offcanvas-geometry.spec.ts`.
   */
  it('sidebar declares the offcanvas state-qualifier patches', () => {
    const family = LOCAL_PATCHES.sidebar.filter((p: { issue: string }) => p.issue === 'objectui#11464');
    expect(family.map((p: { id: string }) => p.id)).toEqual([
      'sidebar-offcanvas-gap-collapsed-only',
      'sidebar-offcanvas-left-offset-collapsed-only',
      'sidebar-offcanvas-right-offset-collapsed-only',
      'sidebar-offcanvas-rail-collapsed-only',
      'sidebar-offcanvas-rail-left-edge-collapsed-only',
      'sidebar-offcanvas-rail-right-edge-collapsed-only',
    ]);
    for (const p of family as Array<{ id: string; find: string; replace: string; marker: string }>) {
      // The marker is the whole patched string, so the shipped file has to
      // carry the payload byte for byte, not merely a fragment of it.
      expect(p.marker, p.id).toBe(p.replace);
      // Each patch only ADDS the collapsed-state qualifier: with it removed,
      // the replacement is the upstream anchor again.
      expect(
        p.replace.replaceAll('group-data-[state=collapsed]:', '').replace('[data-state=collapsed]', ''),
        p.id,
      ).toBe(p.find);
    }
  });

  it('sidebar declares no patch outside those three families', () => {
    const issues = [...new Set(LOCAL_PATCHES.sidebar.map((p: { issue: string }) => p.issue))].sort();
    expect(issues).toEqual(['objectui#10859', 'objectui#11464', 'objectui#4234']);
  });

  /**
   * The third family: the slider thumb pass-through (objectui#3318).
   *
   * The root half is listed here on purpose. It is easy to read
   * `slider-thumb-root-split` as bookkeeping next to the delivery patch and
   * drop it, and the result compiles and renders: the object is simply
   * String()-ed onto the wrapper as `thumbprops="[object Object]"`, and the id
   * it also leaves behind gives the row two elements answering to one id.
   */
  it('slider declares the thumb pass-through patches', () => {
    const ids = LOCAL_PATCHES.slider.map((p: { id: string }) => p.id);
    expect(ids).toEqual([
      'slider-thumb-import',
      'slider-thumb-props-type',
      'slider-thumb-root-split',
      'slider-thumb-aria-delivery',
    ]);
  });

  /**
   * The fifth family: the calendar display locale (objectui#10722), and the
   * `localeTag` input that lets a caller name its own tag (objectui#10747).
   * Every patch is listed because the import alone compiles and changes
   * nothing, and neither the input nor the default compiles without the others.
   */
  it('calendar declares the display-locale patches', () => {
    const ids = LOCAL_PATCHES.calendar.map((p: { id: string }) => p.id);
    expect(ids).toEqual([
      'calendar-display-locale-import',
      'calendar-locale-tag-input',
      'calendar-display-locale-default',
    ]);
  });

  it('applies the slider family to fresh upstream, and is idempotent', () => {
    const once = applyLocalPatches('slider', UPSTREAM_SLIDER);

    expect(once.failed).toEqual([]);
    expect(once.applied).toHaveLength(4);
    expect(verifyLocalPatches('slider', once.content)).toEqual([]);
    // The thumb takes the routed props and the wrapper does not take the raw
    // `props` object any more — the two halves that must land together.
    expect(once.content).toContain('{...splitSliderThumbProps(props).thumb}');
    expect(once.content).toContain('{...splitSliderThumbProps(props).root}');

    const twice = applyLocalPatches('slider', once.content);
    expect(twice.applied).toEqual([]);
    expect(twice.content).toBe(once.content);
  });

  /**
   * The assertion that would have caught objectui#4976 on the day it landed.
   *
   * Patching real registry bytes must reproduce the primitive we ship, byte for
   * byte. Anything weaker is a claim nobody can check: an anchor invented from
   * the local file matches the local file quite happily, and a hand-trimmed
   * "faithful excerpt" of upstream can be wrong about the very line a patch
   * targets without one assertion noticing. Equality can only hold if every
   * anchor in the family was written from registry bytes — which is exactly the
   * property the declaration needs and cannot otherwise state offline.
   *
   * When this goes red, the question is which side moved. Upstream drifting is
   * the expected cause: re-target the patch against the new bytes, refresh this
   * fixture from the registry, and if the incoming shape is an improvement take
   * it into `src/ui/slider.tsx` too. What red must never mean is "trim the
   * fixture until it agrees again".
   */
  it('regenerates the shipped slider.tsx byte for byte from registry bytes', () => {
    const patched = applyLocalPatches('slider', UPSTREAM_SLIDER);
    const shipped = fs.readFileSync(path.join(uiDir, 'slider.tsx'), 'utf-8');

    expect(patched.failed).toEqual([]);
    // The header is added on write, downstream of the patch engine, so it is
    // stripped here rather than baked into the fixture.
    expect(patched.content).toBe(shipped.replace(OBJECTUI_HEADER, ''));
  });

  it('refuses when upstream restyles the thumb', () => {
    // The realistic churn: shadcn tweaks the thumb's class list. The anchor
    // names that list verbatim, so a tweak takes the anchor with it. Loud is
    // the correct outcome — the operator has to re-target, and pick up the new
    // classes while doing so — but it must be loud about the DELIVERY patch
    // only, not smear across the family.
    const restyled = UPSTREAM_SLIDER.replace('block h-5 w-5', 'block size-4');
    expect(restyled).not.toBe(UPSTREAM_SLIDER);

    const result = applyLocalPatches('slider', restyled);

    expect(result.failed.map((p: { id: string }) => p.id)).toEqual([
      'slider-thumb-aria-delivery',
    ]);
    expect(result.failed[0].found).toBe(0);
    // The other three anchors are independent of the class list and still land.
    expect(result.applied).toHaveLength(3);
    // And the delivery payload is NOT in the content: a caller that ignored
    // `failed` would ship an unreachable thumb again.
    expect(result.content).not.toContain('splitSliderThumbProps(props).thumb');
  });

  it('refuses when upstream drops the thumb element altogether', () => {
    // The structural case: no thumb to deliver to. Radix would still render one
    // internally, so this compiles and renders — the patch must refuse rather
    // than let a sync quietly ship a slider nothing can address.
    const withoutThumb = UPSTREAM_SLIDER.replace(/^ {4}<SliderPrimitive\.Thumb .*\n/m, '');
    // Guard the mutation itself: a pattern that silently matched nothing would
    // leave the assertions below testing unmodified upstream.
    expect(withoutThumb).not.toContain('SliderPrimitive.Thumb');

    const result = applyLocalPatches('slider', withoutThumb);

    expect(result.failed.map((p: { id: string }) => p.id)).toEqual([
      'slider-thumb-aria-delivery',
    ]);
    expect(result.failed[0].found).toBe(0);
  });

  it('turns an unpatched upstream file into the translated form', () => {
    const result = applyLocalPatches('dialog', UPSTREAM_DIALOG);

    expect(result.failed).toEqual([]);
    expect(result.applied).toHaveLength(2);
    // The English literal is GONE — this is the actual user-visible defect.
    expect(result.content).not.toContain('<span className="sr-only">Close</span>');
    expect(result.content).toContain('<CloseSrLabel />');
    expect(result.content).toContain('import { CloseSrLabel } from "../lib/close-label"');
    // The anchor line itself survives; the import is added beside it.
    expect(result.content).toContain('import { cn } from "../lib/utils"');
  });

  it('is idempotent — re-running over already-patched content changes nothing', () => {
    const once = applyLocalPatches('dialog', UPSTREAM_DIALOG);
    const twice = applyLocalPatches('dialog', once.content);

    expect(twice.content).toBe(once.content);
    expect(twice.applied).toEqual([]);
    expect(twice.already).toHaveLength(2);
    expect(twice.failed).toEqual([]);
  });

  it('leaves components with no declared patches untouched', () => {
    const input = 'const Button = () => null\n';
    const result = applyLocalPatches('button', input);

    expect(result.content).toBe(input);
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});

describe('shadcn local patches — loud failure when upstream moves (objectstack#5505)', () => {
  it('refuses (does not silently no-op) when the label anchor is gone', () => {
    // A plausible future upstream: the close button keeps its shape but the
    // label text changes. The old anchor no longer matches.
    const moved = UPSTREAM_DIALOG.replace(
      '<span className="sr-only">Close</span>',
      '<span className="sr-only">Close dialog</span>',
    );

    const result = applyLocalPatches('dialog', moved);

    expect(result.failed.map((p: { id: string }) => p.id)).toEqual(['dialog-i18n-close-label']);
    expect(result.failed[0].found).toBe(0);
    // Critically: the content is NOT silently returned as "fine". A caller that
    // ignored `failed` would ship an untranslated primitive again.
    expect(result.content).not.toContain('<CloseSrLabel />');
  });

  it('refuses when the import anchor is gone', () => {
    const moved = UPSTREAM_DIALOG.replace(
      'import { cn } from "../lib/utils"',
      'import { cn, cva } from "../lib/utils"',
    );

    const result = applyLocalPatches('dialog', moved);

    expect(result.failed.map((p: { id: string }) => p.id)).toEqual(['dialog-i18n-close-import']);
  });

  it('refuses when the anchor became AMBIGUOUS rather than absent', () => {
    // Two close buttons upstream: patching "the" span is no longer well
    // defined, so guessing is worse than stopping. `occurrences` pins this.
    const doubled = UPSTREAM_DIALOG.replace(
      '<span className="sr-only">Close</span>',
      '<span className="sr-only">Close</span>\n      <span className="sr-only">Close</span>',
    );

    const result = applyLocalPatches('dialog', doubled);

    expect(result.failed.map((p: { id: string }) => p.id)).toEqual(['dialog-i18n-close-label']);
    expect(result.failed[0].found).toBe(2);
  });

  it('explains a failure with id, issue and reason — not just "changed"', () => {
    const moved = UPSTREAM_DIALOG.replace('<span className="sr-only">Close</span>', '');
    const [failure] = applyLocalPatches('dialog', moved).failed;

    const text = describePatchFailure('dialog', failure).join('\n');

    expect(text).toContain('dialog-i18n-close-label');
    expect(text).toContain('objectstack#5505');
    expect(text).toContain('accessible name');
  });
});

describe('shipped primitives still carry every declared patch (objectstack#5505)', () => {
  /**
   * The PR gate. If a future forced sync, hand edit or bad merge drops the
   * patch from the files we actually ship, this goes red — offline, on every
   * PR, without needing anyone to run `pnpm shadcn:check` against the network.
   */
  it.each(patchedComponents())('%s.tsx carries its declared patches', (name: string) => {
    const content = fs.readFileSync(path.join(uiDir, `${name}.tsx`), 'utf-8');

    const missing = verifyLocalPatches(name, content);
    expect(
      missing.map((p: { id: string }) => p.id),
      `${name}.tsx lost declared patch(es); re-apply with: node scripts/shadcn-sync.js --update ${name}`,
    ).toEqual([]);
  });

  /**
   * The negative assertion the issue asked for, at the source level: the
   * English literal must not be back in the file under any spelling of the
   * span. Rendering-level negatives live in
   * `packages/components/src/__tests__/sheet-dialog-close-i18n.test.tsx`.
   *
   * Scoped to `closeLabelComponents` (see the top of this file), NOT to
   * `patchedComponents()`: "contains `<CloseSrLabel />`" is simply false for
   * the unrelated `sidebar` family.
   */
  it.each(closeLabelComponents)('%s.tsx has no hardcoded English close label', (name: string) => {
    const content = fs.readFileSync(path.join(uiDir, `${name}.tsx`), 'utf-8');

    expect(content).not.toMatch(/<span className="sr-only">\s*Close\s*<\/span>/);
    expect(content).toContain('<CloseSrLabel />');
  });

  /** The derivation above must never silently select nothing. */
  it('still covers the close-label primitives', () => {
    expect(closeLabelComponents).toEqual(['sheet', 'dialog']);
  });
});

describe('declared anchors were written from REGISTRY bytes (objectui#4996)', () => {
  /**
   * The gap this suite closes.
   *
   * Before it, only `slider` was ever applied to real registry bytes. `sheet`
   * and `sidebar` were held up by two things that say NOTHING about whether
   * their anchors match upstream: their ids, and the markers present in the
   * files on disk. That is exactly the objectui#4976 configuration — markers
   * complete, `verifyLocalPatches` empty, suite green, and an anchor pinned to
   * a line the registry has never served. It kept a dead patch alive for four
   * months.
   *
   * Measured for objectui#4996 before writing any of this: all ten declared
   * anchors across all four families DO apply to real registry bytes, both at
   * the pinned sha and at shadcn-ui/ui `main` on the day (byte-identical there
   * — the `default` style registry has not moved for these four). So nothing
   * was broken; what was missing was anything that would say so when it stops.
   * These assertions are that thing, and they are why the fixtures exist.
   */
  it.each(patchedComponents())('%s has a vendored registry fixture', (name: string) => {
    // A new patched family with no fixture goes red HERE rather than being
    // quietly exempt from every assertion below — the failure mode a
    // hand-maintained fixture list always eventually has.
    expect(
      Object.keys(REGISTRY_FIXTURES),
      `${name} is declared in LOCAL_PATCHES but has no entry in REGISTRY_FIXTURES; ` +
        'capture files[0].content from its registry URL verbatim into ' +
        `scripts/__tests__/fixtures/shadcn-registry/${name}.registry.txt`,
    ).toContain(name);

    expect(
      fs.existsSync(path.join(registryFixturesDir, `${name}.registry.txt`)),
      `missing fixture file for ${name}`,
    ).toBe(true);
  });

  it.each(patchedComponents())(
    '%s fixture still hashes to its recorded provenance',
    (name: string) => {
      const actual = crypto.createHash('sha256').update(readRegistryFixture(name)).digest('hex');

      // This is what makes the fixture uncheatable. Every assertion below is
      // only as good as the claim that these bytes are upstream's; a hash
      // pinned to the capture is the one way to hold that claim offline. Red
      // here means the file was edited — re-capture and update `sha256` in the
      // same commit, never trim the file until the anchors agree.
      expect(actual, `${name}.registry.txt no longer matches its captured sha256`).toBe(
        REGISTRY_FIXTURES[name].sha256,
      );
    },
  );

  it.each(patchedComponents())(
    '%s: every declared anchor applies to real registry bytes',
    (name: string) => {
      const result = applyLocalPatches(name, upstreamFor(name));

      // The core assertion of objectui#4996. An anchor reverse-engineered from
      // `src/ui/**` — the objectui#4976 defect — cannot be in `applied` here,
      // because the line it names does not exist in these bytes.
      expect(
        result.failed.map((p: { id: string; found: number }) => `${p.id} (found ${p.found}x)`),
        `${name}: declared anchor(s) do not match the registry bytes, so the patch would NOT ` +
          'survive the next `pnpm shadcn:update`. Re-target the anchor against upstream — do not ' +
          'weaken the fixture.',
      ).toEqual([]);

      // `already` would mean the fixture arrived carrying our own marker, i.e.
      // it was captured from the patched local file rather than from upstream.
      // Distinguishing it from `applied` is the difference between "the anchor
      // works" and "the fixture was taken from the wrong side".
      expect(result.already, `${name}: fixture already contains our marker(s)`).toEqual([]);
      expect(result.applied).toHaveLength(LOCAL_PATCHES[name].length);

      // And the result actually carries every declared patch.
      expect(verifyLocalPatches(name, result.content)).toEqual([]);
    },
  );

  it.each(patchedComponents())(
    '%s: byte round-trip holds, or its unavailability is pinned with a reason',
    (name: string) => {
      const patched = applyLocalPatches(name, upstreamFor(name));
      const shipped = fs
        .readFileSync(path.join(uiDir, `${name}.tsx`), 'utf-8')
        // Added on write, downstream of the patch engine — stripped rather than
        // baked into the fixture, which must stay byte-faithful to upstream.
        .replace(OBJECTUI_HEADER, '');

      const { roundTrip } = REGISTRY_FIXTURES[name];

      if (roundTrip === true) {
        // The strongest available statement: patching real upstream reproduces
        // the shipped primitive exactly, so the declaration accounts for EVERY
        // way this file differs from upstream.
        expect(patched.content, `${name}.tsx no longer regenerates from registry bytes`).toBe(
          shipped,
        );
        return;
      }

      // The other families ship local edits that are documented in
      // `shadcn-components.json` but not declared in `shadcn-local-patches.mjs`,
      // so equality is genuinely unavailable and claiming it would be a lie.
      // Pinning the inequality is still worth doing: if it starts holding —
      // upstream adopted the edit, or someone declared it — this goes red and
      // the family should be promoted to `roundTrip: true`, which is a strictly
      // better gate than the one below.
      expect(typeof roundTrip).toBe('string');
      expect(
        patched.content,
        `${name} now regenerates byte-for-byte from registry bytes — promote its ` +
          "REGISTRY_FIXTURES entry to `roundTrip: true` (recorded reason: " +
          `${roundTrip})`,
      ).not.toBe(shipped);
    },
  );

  /**
   * The provenance record must not outlive the declarations it describes: a
   * family removed from `LOCAL_PATCHES` should take its fixture with it, or the
   * directory silently accumulates snapshots nothing reads.
   */
  it('records no fixture for a family that is no longer patched', () => {
    expect(Object.keys(REGISTRY_FIXTURES).sort()).toEqual([...patchedComponents()].sort());

    const onDisk = fs
      .readdirSync(registryFixturesDir)
      .filter((f: string) => f.endsWith('.registry.txt'))
      .map((f: string) => f.replace(/\.registry\.txt$/, ''))
      .sort();
    expect(onDisk).toEqual([...patchedComponents()].sort());
  });
});

/**
 * objectui#6027 — the Tailwind v4 custom-property migration on the SHIPPED
 * `sidebar.tsx`, guarded from the other side.
 *
 * `925051db6` converted every Tailwind arbitrary value holding a bare CSS
 * custom property from the v3 spelling `w-[--sidebar-width]` to the v4
 * spelling `w-(--sidebar-width)`. Under Tailwind 4.x the v3 spelling no longer
 * resolves the variable — it compiles to a bare custom-property *name* as a
 * value, which is invalid CSS that browsers silently discard, collapsing the
 * sidebar to 0 width over the main content.
 *
 * That migration is an UNDECLARED local edit: it lives only as prose in
 * `packages/components/shadcn-components.json` (`localEdits`), with nothing in
 * `scripts/shadcn-local-patches.mjs` re-applying it. A `--force` sync — which
 * bypasses the `localOnlyLines` refusal by design — drops it.
 *
 * ## Why only this one of the four undeclared edits is guarded here
 *
 * Declaring the migration as a patch family would mean anchoring ~20 class
 * strings, each a maintenance surface that can drift out of agreement with
 * upstream. This assertion buys the same protection from the other side, for
 * one regex, and is the option objectui#6027 itself costed as "much cheaper".
 * The other three undeclared edits are NOT guarded here because each already
 * fails through an existing gate — recorded so a reader knows why:
 *
 *   | undeclared edit                          | file        | gate that catches its loss |
 *   |------------------------------------------|-------------|----------------------------|
 *   | `hideOverlay` prop suppressing overlay    | `sheet.tsx` | type-check — but see the caveat below |
 *   | `eslint-disable react-hooks/purity`       | `sidebar.tsx` | Lint. The rule arrives via `reactHooks.configs.recommended.rules` (`eslint.config.js:39`) and is NOT downgraded by the repo's overrides (unlike `react-hooks/refs`, `immutability`, `set-state-in-effect`, …), so the skeleton's random width errors without the directive. |
 *   | unconditional `data-collapsible` + `group-data-[state=collapsed]:` qualifiers | `sidebar.tsx` | Test locator — `packages/app-shell/src/__tests__/print-stylesheet-4462.test.ts` pins the selector `[data-collapsible][data-side][data-state]`. |
 *   | Tailwind v4 `[--var]` → `(--var)`         | `sidebar.tsx` | **nothing — this block** |
 *
 * ⚠️ Caveat measured while writing this (objectui#6027): `hideOverlay` has
 * **zero consumers** in the tree today — the `DesignDrawer` that ROADMAP.md
 * credits no longer exists. It is an optional prop, so a `--force` sync
 * dropping it would type-check clean. The type-check gate that card credits is
 * vacuous as things stand; it re-arms the moment anything passes the prop.
 * Filed separately rather than fixed here.
 *
 * Deliberately asserted against the file this repo SHIPS, not against a
 * vendored fixture: the regression is "a forced sync overwrote the shipped
 * file", which a fixture-based check would sail straight past.
 */
describe('shipped sidebar.tsx keeps the Tailwind v4 custom-property spelling (objectui#6027)', () => {
  const sidebarRelPath = 'packages/components/src/ui/sidebar.tsx';
  const sidebarPath = path.join(uiDir, 'sidebar.tsx');

  /**
   * The v3 spelling this refuses: `[` followed IMMEDIATELY by a custom-property
   * name and closed by `]` — i.e. the whole arbitrary value is the bare
   * variable name (`w-[--sidebar-width]`).
   *
   * What it deliberately does NOT match, so it stays a spelling check rather
   * than a blanket "no `--var` in brackets" trap:
   *
   *   - `w-[calc(var(--sidebar-width-icon)_+_1rem)]` — a `var()` call inside an
   *     arbitrary value is correct on v4; `[` is followed by `calc`, not `--`.
   *   - `shadow-[0_0_0_1px_hsl(var(--sidebar-border))]` — same shape.
   *   - `[--sidebar-width:16rem]` — the arbitrary *property* form, which SETS a
   *     custom property and remains valid on v4. The trailing `:` breaks the
   *     match, which is intentional: this guard is about arbitrary *values*.
   */
  const V3_BARE_VAR = /\[--[a-zA-Z0-9-]+\]/g;

  /**
   * The v4 spelling that must stay green. `(` preceded by the utility's `-`
   * (`w-(--sidebar-width)`), which is what distinguishes the Tailwind shorthand
   * from a plain CSS `var(--x)` call — there `(` is preceded by `r`.
   */
  const V4_SHORTHAND = /-\(--[a-zA-Z0-9-]+\)/g;

  const readSidebar = () => fs.readFileSync(sidebarPath, 'utf-8');

  /** Offending spellings with line numbers, so a failure names WHAT and WHERE. */
  const findV3Spellings = (source: string): string[] =>
    source
      .split('\n')
      .flatMap((line, i) =>
        (line.match(V3_BARE_VAR) ?? []).map(
          (spelling) => `${sidebarRelPath}:${i + 1}: ${spelling}`,
        ),
      );

  /**
   * The gate. Goes red on a `--force` sync that reverts the migration, offline,
   * on every PR.
   */
  it('contains no Tailwind v3 `[--var]` arbitrary values', () => {
    const offenders = findV3Spellings(readSidebar());

    expect(
      offenders,
      `${sidebarRelPath} contains Tailwind v3 bare-custom-property arbitrary ` +
        `value(s), which Tailwind 4.x compiles to invalid CSS that browsers ` +
        `silently discard. Rewrite each \`[--var]\` as \`(--var)\` (see ` +
        `925051db6). Offenders:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * The inverse guard. Without this the block above is satisfied by a file that
   * has no custom-property utilities at all — including one where a bad sync
   * stripped them — and it would equally be satisfied by a pattern so greedy it
   * forbids the correct v4 spelling, making this a trap for the next person who
   * does a migration RIGHT.
   */
  it('tolerates the v4 `(--var)` spellings that are supposed to be there', () => {
    const source = readSidebar();
    const v4 = source.match(V4_SHORTHAND) ?? [];

    // The migration's own targets, still in their v4 form.
    expect(source).toContain('w-(--sidebar-width)');
    expect(source).toContain('w-(--sidebar-width-icon)');
    expect(source).toContain('max-w-(--skeleton-width)');

    expect(v4.length).toBeGreaterThanOrEqual(7);
    expect(findV3Spellings(source)).toEqual([]);
  });

  /**
   * The distinguishing evidence: the pattern separates the two spellings rather
   * than matching any `--var` occurrence. Asserted on literals, not on the file,
   * so it keeps proving the pattern's shape even after the file changes.
   */
  it('distinguishes the v3 spelling from every valid v4 neighbour', () => {
    const refused = [
      'w-[--sidebar-width]',
      'max-w-[--skeleton-width]',
      'group-data-[collapsible=icon]:w-[--sidebar-width-icon]',
    ];
    for (const s of refused) {
      expect(s.match(V3_BARE_VAR), `${s} must be refused as a v3 spelling`).not.toBeNull();
    }

    const tolerated = [
      // v4 shorthand — the correct spelling.
      'w-(--sidebar-width)',
      'max-w-(--skeleton-width)',
      // `var()` inside an arbitrary value — correct on v4, present in the file.
      'w-[calc(var(--sidebar-width-icon)_+_1rem)]',
      'left-[calc(var(--sidebar-width)*-1)]',
      'shadow-[0_0_0_1px_hsl(var(--sidebar-border))]',
      // arbitrary *property* form — sets the variable, still valid on v4.
      '[--sidebar-width:16rem]',
      // unrelated arbitrary values that merely use brackets.
      'group-data-[collapsible=offcanvas]:left-0',
      '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
    ];
    for (const s of tolerated) {
      expect(s.match(V3_BARE_VAR), `${s} must NOT be flagged`).toBeNull();
    }
  });

  /**
   * The counts objectui#6027 asked to be reported alongside each other: what the
   * pattern tolerates vs. what it refuses, measured on the shipped file. Pinned
   * so that a sync which quietly deletes the custom-property utilities — rather
   * than respelling them — cannot pass as "no v3 spellings found".
   */
  it('reports the v4 spellings it tolerates alongside the v3 it refuses', () => {
    const source = readSidebar();

    const v4Shorthand = source.match(V4_SHORTHAND) ?? [];
    const varCalls = source.match(/var\(--[a-zA-Z0-9-]+\)/g) ?? [];
    const v3 = findV3Spellings(source);

    expect({
      v4Shorthand: v4Shorthand.length,
      varCallsInsideArbitraryValues: varCalls.length,
      v3BareVar: v3.length,
    }).toEqual({
      v4Shorthand: 7,
      varCallsInsideArbitraryValues: 6,
      v3BareVar: 0,
    });
  });
});
