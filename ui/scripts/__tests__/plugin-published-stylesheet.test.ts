import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as gridStylesheet from '../../packages/plugin-grid/scripts/build-css.mjs';
import * as kanbanStylesheet from '../../packages/plugin-kanban/scripts/build-css.mjs';
import * as fieldsStylesheet from '../../packages/fields/scripts/build-css.mjs';
import { classesOf, COMPONENTS_ENTRY, REPO_ROOT, defaultHeader } from '../build-plugin-stylesheet.mjs';

/**
 * objectui#4929: `@object-ui/plugin-grid` and `@object-ui/plugin-kanban` now
 * publish a stylesheet, built in the subtraction shape `@object-ui/fields`
 * established (objectui#4059).
 *
 * objectui#6438: `@object-ui/fields` is a subject here too. It is the package
 * whose sheet has actually been shipping to consumers since objectui#4059 — the
 * defect this file's shape exists to prevent — and until now it was pinned by
 * nothing in the suite: the builder's four write-time assertions run only during
 * a build, and CI runs this suite on an unbuilt worktree. It could not be a
 * subject earlier because it ran its own copy of the builder and exported no
 * module surface; objectui#6405 re-pointed it at the shared
 * `createPluginStylesheetBuilder`, so it now exports the same shape the two
 * plugins do and the five per-package assertions apply to it unchanged.
 *
 * One asymmetry is deliberate and load-bearing: fields passes a per-package
 * `header` through `buildOptions` (its published banner bytes predate the shared
 * module, and objectui#6405's acceptance gate was that re-pointing it changed
 * `dist/index.css` by not one byte), while the plugins inherit the shared
 * default. Nothing below reads the emitted banner; anything added later that
 * does must take it from `mod.buildOptions`, never from the shared default,
 * or it will judge fields wrongly.
 *
 * ## What has to be pinned, and why a naive test would pass while broken
 *
 * Two properties, and only both together mean anything:
 *
 *   1. the sheet CONTAINS the themed utilities that motivated it — the ones
 *      resolving `@theme` tokens that live in unpublished components source, so
 *      a build inside this monorepo is their only possible producer;
 *   2. the sheet does NOT re-emit what `@object-ui/components` already ships.
 *
 * A sheet built without the subtraction step — the ~164 kB near-copy of the
 * components sheet this shape exists to avoid — satisfies (1) perfectly.
 * "Does it have the class" therefore proves nothing on its own, which is why the
 * degenerate control below asserts a class components DOES carry is ABSENT here,
 * and asserts it against the same package's pre-subtraction compile so the
 * absence cannot be explained by the plugin never using the class.
 *
 * ## Why this test compiles instead of reading `dist/`
 *
 * CI runs the suite on an unbuilt worktree (`ci.yml`'s test job installs and runs
 * `pnpm test`, no build step), so each package's `dist/index.css` is legitimately
 * absent. A test that read the artifact would pass vacuously or be skipped —
 * which is how a stylesheet gate stops being a gate. It runs the real builder
 * instead, over the real sources, and supplies components' sheet compiled from
 * ITS OWN source: `base`-pinned, so byte-identical to what that package's build
 * writes (the vite-extracted `sidebar-fixes.css` it appends carries no utility
 * rule, so nothing this test judges depends on the difference).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The themed utilities objectui#4929 measured — the load-bearing set, verbatim
 * from the card, split by the package that uses each one. Re-derived on the
 * merged tree at implementation time; the card's list of 21 held in full, and
 * four more (`[&>h3]:text-foreground/80`, `border-l-primary/40`,
 * `border-primary/30`, `hover:text-primary`) turned up that its literal-grep
 * method could not see.
 *
 * These are named here rather than read from the builder's own `MUST_SURVIVE`
 * on purpose: a test that asserts the subject's own list back at it pins
 * nothing.
 */
const CARD_THEMED = {
  'plugin-grid': [
    'border-foreground',
    'divide-border/50',
    'focus:border-input',
    'focus:ring-destructive/30',
    'text-muted-foreground/80',
  ],
  'plugin-kanban': [
    'bg-card/20',
    'bg-card/60',
    'bg-foreground/70',
    'bg-muted-foreground/30',
    'bg-muted/10',
    'bg-muted/15',
    'bg-muted/70',
    'border-primary/60',
    'hover:border-primary/40',
    'ring-destructive/30',
    'ring-primary/40',
    'ring-primary/60',
    'shadow-primary/25',
    'text-foreground/85',
    'text-muted-foreground/60',
    'text-primary/90',
  ],
  /**
   * Derived for objectui#6438 from the sheet this build actually emits, NOT read
   * back off fields' own `MUST_SURVIVE` — the note above applies with more force
   * here, because three of these are in that list and copying it would have
   * looked identical while pinning nothing.
   *
   * Method: build fields' sheet through the shared builder, then keep every
   * surviving class whose own declarations resolve a `--color-*` token declared
   * in `packages/components/src/index.css`'s `@theme` block (35 tokens) — the
   * file that package does not publish, which is exactly what makes a build
   * inside this monorepo the only possible producer of these utilities.
   *
   * That yields 17, and 17 is independently what
   * `packages/fields/scripts/build-css.mjs` records having measured at
   * objectui#4059 ("17 of those depend on the ObjectUI `@theme` block").
   * `bg-primary/20`, `hover:bg-accent/30` and `ring-destructive/50` — the three
   * that card names — are 3 of the 17, i.e. its starting corpus rather than its
   * answer; the other 14 are ones its literal-grep method could not see.
   */
  fields: [
    'bg-background/60',
    'bg-destructive/5',
    'bg-muted/60',
    'bg-primary/20',
    'border-background',
    'border-border/40',
    'border-muted-foreground/25',
    'border-muted-foreground/30',
    'focus-visible:ring-ring/60',
    'focus:ring-ring/60',
    'hover:bg-accent/30',
    'hover:bg-muted/80',
    'hover:bg-primary/10',
    'hover:bg-primary/50',
    'hover:border-primary/50',
    'ring-border/60',
    'ring-destructive/50',
  ],
} as const;

/**
 * Utilities `@object-ui/components`' sheet carries. Each is also compiled by all
 * three subjects — asserted below against each one's own pre-subtraction
 * compile — so "absent from the emitted sheet" can only mean the subtraction
 * ran, and never that the package simply does not use the class.
 */
const ALREADY_SHIPPED = ['flex', 'text-sm', 'rounded-md', 'bg-background', 'sr-only'];

const SUBJECTS = [
  { name: 'plugin-grid', mod: gridStylesheet },
  { name: 'plugin-kanban', mod: kanbanStylesheet },
  { name: 'fields', mod: fieldsStylesheet },
] as const;

type Built = {
  css: string;
  classes: Set<string>;
  rawClasses: Set<string>;
  droppedRules: number;
};

const built = new Map<string, Built>();

beforeAll(async () => {
  // One components compilation, shared by both subjects (~0.6 s).
  const componentsSheetCss = (await gridStylesheet.builder.compileComponentsEntry()).toString();

  for (const { name, mod } of SUBJECTS) {
    const raw = await mod.builder.compile(
      path.join(mod.PACKAGE_ROOT, 'src/index.css'),
      mod.PACKAGE_ROOT,
    );
    const result = await mod.builder.build({
      ...mod.buildOptions,
      componentsSheetCss,
      write: false,
    });
    built.set(name, {
      css: result.css,
      classes: result.survivingClasses,
      rawClasses: classesOf(raw),
      droppedRules: result.droppedRules,
    });
  }
}, 120_000);

describe('published supplement stylesheets (objectui#4929, objectui#6438)', () => {
  it('gives every themed utility the card measured a producer', () => {
    const everything = new Set(
      SUBJECTS.flatMap(({ name }) => [...(built.get(name) as Built).classes]),
    );
    const missing = Object.values(CARD_THEMED)
      .flat()
      .filter((cls) => !everything.has(cls));
    expect(missing).toEqual([]);
  });

  describe.each(SUBJECTS.map(({ name }) => name))('%s', (name) => {
    const themed = CARD_THEMED[name];

    /**
     * objectui#7044: the emitted sheet's banner is part of the published
     * artifact (objectui#6405's acceptance gate was byte-identity of that
     * file), yet nothing here read it. Two checks, deliberately independent
     * of each other, because the obvious single check is vacuous: recomputing
     * "expected" by calling the very function that ALSO produced "actual"
     * (`defaultHeader`, or fields' own `buildOptions.header`) can never be
     * surprised by a mutation to that function's wording — both sides move
     * together. Neither check below has that shape:
     *
     *   1. the emitted sheet starts with the header this subject is
     *      CONFIGURED to use — its own declared `buildOptions.header` when it
     *      has one (`fields`, objectui#4059/#6405), else the shared
     *      `defaultHeader(PACKAGE_NAME)` this module now exports for exactly
     *      this. Catches the ASSEMBLY breaking (`header` no longer prepended,
     *      or some third, unrelated value used) — never a second hand-spelled
     *      copy of either wording, which would be free to drift from the real
     *      one while staying green.
     *   2. that header actually NAMES this package: `mod.PACKAGE_NAME` is a
     *      plain string constant each build script declares independently
     *      (never derived from `defaultHeader`), so a broken interpolation
     *      inside `defaultHeader` cannot hide behind (1)'s self-consistent
     *      recomputation — this is what gives (1) teeth against a mutation to
     *      `defaultHeader` itself, for the two subjects that inherit it.
     */
    it('opens the emitted sheet with the banner it declares', () => {
      const { css } = built.get(name) as Built;
      const { mod } = SUBJECTS.find((s) => s.name === name)!;
      const declaredHeader = (mod.buildOptions as { header?: string }).header;
      const expectedHeader = declaredHeader ?? defaultHeader(mod.PACKAGE_NAME);
      expect(css.startsWith(`${expectedHeader}\n`)).toBe(true);
      expect(css.slice(0, expectedHeader.length)).toContain(mod.PACKAGE_NAME);
    });

    // fields-only: the control that (1) above cannot provide, because
    // dropping fields' `header` override moves both its "expected" and
    // "actual" to the shared default IN LOCKSTEP — exactly the failure mode
    // objectui#7044 was filed over ("an accidental drop of fields' per-package
    // `header`, would ship silently"). This checks the emitted sheet against
    // the OTHER branch's value, independent of whichever branch (1) took.
    if (name === 'fields') {
      it('does not fall back to the shared default banner', () => {
        const { css } = built.get('fields') as Built;
        const { mod } = SUBJECTS.find((s) => s.name === 'fields')!;
        expect(css.startsWith(`${defaultHeader(mod.PACKAGE_NAME)}\n`)).toBe(false);
      });
    }

    it('emits the themed utilities only this build can produce', () => {
      const { classes } = built.get(name) as Built;
      expect(themed.filter((cls) => !classes.has(cls))).toEqual([]);
    });

    it('resolves those utilities through the unpublished @theme tokens', () => {
      // The point of the `@reference`: `bg-muted/10` must come out as a real
      // colour expression over `--color-muted`, not be dropped or left inert.
      const { css } = built.get(name) as Built;
      const themedTokens = /var\(--color-(muted|card|primary|foreground|destructive|border|input)/;
      expect(themedTokens.test(css)).toBe(true);
    });

    it('does not re-emit what the components sheet already carries', () => {
      const { classes, rawClasses } = built.get(name) as Built;
      // The control is only meaningful if the plugin really compiles these.
      expect(ALREADY_SHIPPED.filter((cls) => !rawClasses.has(cls))).toEqual([]);
      expect(ALREADY_SHIPPED.filter((cls) => classes.has(cls))).toEqual([]);
      expect(classes.size).toBeLessThan(rawClasses.size / 4);
    });

    it('carries utilities only — no preflight, no theme block', () => {
      const { css } = built.get(name) as Built;
      expect(css).not.toMatch(/@layer base/);
      expect(css).not.toMatch(/^:root\s*[,{]/m);
      expect(css).not.toMatch(/--color-[a-z-]+:\s/);
    });

    it('compiles the same bytes from any working directory', async () => {
      const { mod } = SUBJECTS.find((s) => s.name === name)!;
      const entry = path.join(mod.PACKAGE_ROOT, 'src/index.css');
      const fromPackage = await mod.builder.compile(entry, mod.PACKAGE_ROOT);
      const fromRepoRoot = await mod.builder.compile(entry, REPO_ROOT);
      expect(fromRepoRoot.toString()).toBe(fromPackage.toString());
    }, 60_000);

    it('declares the export AND the step that produces it', () => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'packages', name, 'package.json'), 'utf8'),
      ) as { exports: Record<string, unknown>; scripts: Record<string, string> };
      // objectui#4059 was an export promising a file no build step wrote.
      expect(manifest.exports['./style.css']).toBe('./dist/index.css');
      expect(manifest.scripts.build).toContain('node scripts/build-css.mjs');
    });
  });

  it('reaches the components entry where the builder says it does', () => {
    expect(fs.existsSync(COMPONENTS_ENTRY)).toBe(true);
    expect(COMPONENTS_ENTRY.startsWith(REPO_ROOT)).toBe(true);
  });
});
