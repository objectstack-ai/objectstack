// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12639 — every console frame draws its top bar at ONE height, 48 px.
 *
 * ## The defect this holds closed
 *
 * The console's top bar is not one component: six frames each draw a sticky
 * `header` around `AppHeader` (or, inside an app, `AppShell` draws it around
 * the `navbar` that `ConsoleLayout` hands it). They were all `h-14`, 56 px.
 * The approved artboards draw the bar at 48 px, and changing one frame alone
 * makes the bar jump on the way from Home into an app — which is why
 * objectui#12601 left Home at 56 px and carded this. So the height is held for
 * every frame at once, here:
 *
 *   - `CONSOLE_TOP_BAR` is 48 px, at every breakpoint;
 *   - what sits under the bar at the viewport's edge (the app sidebar) offsets
 *     by that same height, derived from it rather than restated;
 *   - every frame that mounts `AppHeader` draws its bar from that constant —
 *     by reading it, or, across a package boundary it cannot import over, as a
 *     literal equal to it;
 *   - no other source copies the bar's class, and nothing offsets from a
 *     56 px bar any more.
 *
 * A seventh frame that mounts `AppHeader`, a copy of the bar's class anywhere
 * in the trees below, or a revert of any one frame to `h-14` turns this file
 * red.
 *
 * ## ⚠ What this file cannot assert
 *
 * A SOURCE SCAN, not a rendered measurement: it proves which class each frame
 * spells, not the pixels a browser lays out. The scan reaches the packages that
 * can mount `AppHeader` — this package and every workspace package that
 * depends on it, derived from their `package.json` files on each run — plus
 * `packages/layout/src`, where `AppShell` lives. A bar drawn in a package
 * outside that set is not seen. `packages/runner`'s own layout is a different
 * product frame and is outside it on purpose.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';
import { CONSOLE_BELOW_TOP_BAR, CONSOLE_TOP_BAR } from '../consoleTopBar';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');
/** A file's code with its comments blanked, so prose that NAMES a class is not read as a class. */
const masked = new Map<string, string>();
const code = (rel: string): string => {
  let src = masked.get(rel);
  if (src === undefined) masked.set(rel, (src = mask(read(rel))));
  return src;
};

const APP_SHELL_PACKAGE = '@object-ui/app-shell';
const TOKEN_MODULE = 'packages/app-shell/src/layout/consoleTopBar.ts';
const LAYOUT_APP_SHELL = 'packages/layout/src/AppShell.tsx';

/**
 * Every frame that mounts `AppHeader`, and how it draws the bar around it.
 *
 *   token      reads `CONSOLE_TOP_BAR` (this package's frames)
 *   app-shell  hands `AppHeader` to `@object-ui/layout`'s `AppShell` as its
 *              `navbar`; that header is a literal equal to the constant
 *   literal    a frame outside this package; its header is a literal equal to
 *              the constant
 */
const FRAMES: ReadonlyArray<{ file: string; bar: 'token' | 'app-shell' | 'literal' }> = [
  { file: 'packages/app-shell/src/console/home/HomeLayout.tsx', bar: 'token' },
  { file: 'packages/app-shell/src/console/organizations/OrganizationsLayout.tsx', bar: 'token' },
  { file: 'packages/app-shell/src/console/organizations/manage/OrganizationLayout.tsx', bar: 'token' },
  { file: 'packages/app-shell/src/console/ai/AiChatPage.tsx', bar: 'token' },
  { file: 'packages/app-shell/src/layout/ConsoleLayout.tsx', bar: 'app-shell' },
  { file: 'apps/console/src/components/StudioRoute.tsx', bar: 'literal' },
];

/** The sources allowed to spell the bar's class as a literal: the constant and its two copies. */
const LITERAL_SITES = new Set([
  TOKEN_MODULE,
  LAYOUT_APP_SHELL,
  ...FRAMES.filter((f) => f.bar === 'literal').map((f) => f.file),
]);

/** The workspace directories whose `package.json` names this package as a dependency, and this package. */
function packagesThatCanMountAppHeader(): string[] {
  const dirs: string[] = [];
  for (const group of ['packages', 'apps', 'examples']) {
    const groupDir = path.join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const manifest = path.join(groupDir, name, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      if (pkg.name === APP_SHELL_PACKAGE || APP_SHELL_PACKAGE in deps) dirs.push(`${group}/${name}`);
    }
  }
  return dirs.sort();
}

const isTest = (rel: string) => /(^|\/)__tests__\/|\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(rel);

/** Every non-test `.ts` / `.tsx` source under a workspace package's `src`, repo-relative. */
function sourcesOf(pkgDir: string): string[] {
  const srcDir = path.join(repoRoot, pkgDir, 'src');
  if (!existsSync(srcDir)) return [];
  return readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => `${pkgDir}/src/${f.split(path.sep).join('/')}`)
    .filter((rel) => !isTest(rel));
}

const SCANNED_PACKAGES = packagesThatCanMountAppHeader();
const SCANNED = [...new Set([...SCANNED_PACKAGES.flatMap(sourcesOf), ...sourcesOf('packages/layout')])].sort();

/** `h-12` → 12: the Tailwind spacing step a height utility names. */
function heightStepsOf(classes: string): string[] {
  return classes.split(/\s+/).filter((c) => /^(?:[a-z0-9-]+:)*!?h-/.test(c));
}

/** The opening tag of a file's first `header` element. */
function headerTagOf(rel: string): string {
  const tag = /<header\b[^>]*>/.exec(code(rel));
  if (!tag) throw new Error(`${rel} no longer renders a \`header\` element`);
  return tag[0];
}

/** The class literal of a file's first `header` element. */
function headerLiteralOf(rel: string): string {
  const literal = /^<header\s+className="([^"]*)"/.exec(headerTagOf(rel));
  if (!literal) throw new Error(`${rel}'s \`header\` no longer carries a plain class literal`);
  return literal[1];
}

describe('the console top bar is one 48 px bar in every frame (objectui#12639)', () => {
  it('`CONSOLE_TOP_BAR` is 48 px (`h-12`) at every breakpoint', () => {
    expect(
      heightStepsOf(CONSOLE_TOP_BAR),
      'Both approved artboards draw the console bar at 48 px (`h-12`), with no breakpoint variant.',
    ).toEqual(['h-12']);
  });

  it('what sits under the bar offsets by the bar\'s own height', () => {
    const step = Number(/(?:^|\s)h-(\d+)(?:\s|$)/.exec(CONSOLE_TOP_BAR)?.[1]);
    expect(Number.isInteger(step), 'CONSOLE_TOP_BAR names no integer height step').toBe(true);
    expect(
      CONSOLE_BELOW_TOP_BAR,
      'The app sidebar starts where the bar ends and is the viewport less the bar: both numbers follow `h-N`.',
    ).toBe(`!top-${step} !h-[calc(100svh-${step / 4}rem)]`);
    expect(code('packages/app-shell/src/layout/UnifiedSidebar.tsx')).toMatch(
      /<Sidebar\b[^>]*\bclassName=\{CONSOLE_BELOW_TOP_BAR\}/,
    );
  });

  it('the census reaches the packages that can mount `AppHeader`, and the frames this file lists', () => {
    // Positive control for the scan below: a census that found nothing would
    // pass the "no seventh frame" assertion vacuously.
    expect(SCANNED_PACKAGES).toContain('packages/app-shell');
    expect(SCANNED_PACKAGES).toContain('apps/console');
    for (const { file } of FRAMES) expect(SCANNED, `the scan does not reach ${file}`).toContain(file);
    expect(SCANNED).toContain(LAYOUT_APP_SHELL);
  });

  it('every frame that mounts `AppHeader` is listed here, so a seventh frame cannot draw its own bar', () => {
    const mounting = SCANNED.filter((rel) => /<AppHeader\b/.test(code(rel)));
    expect(
      mounting,
      [
        'A source now mounts `AppHeader` that this file does not list. Its bar must be the console',
        "bar: read `CONSOLE_TOP_BAR` from `layout/consoleTopBar.ts`, then add the file to FRAMES.",
      ].join('\n'),
    ).toEqual(FRAMES.map((f) => f.file).sort());
  });

  for (const { file, bar } of FRAMES) {
    it(`${file} draws the bar ${bar === 'token' ? 'from `CONSOLE_TOP_BAR`' : 'equal to `CONSOLE_TOP_BAR`'}`, () => {
      if (bar === 'token') {
        const tag = headerTagOf(file);
        expect(tag, `${file}'s top bar no longer reads CONSOLE_TOP_BAR`).toMatch(
          /^<header\s+className=\{(?:cn\(\s*)?CONSOLE_TOP_BAR\b/,
        );
        expect(heightStepsOf(tag.replace(/CONSOLE_TOP_BAR/, '')), `${file} sets its own bar height`).toEqual([]);
        return;
      }
      if (bar === 'app-shell') {
        expect(code(file)).toMatch(/import\s*\{[^}]*\bAppShell\b[^}]*\}\s*from\s*'@object-ui\/layout'/);
        expect(code(file)).toMatch(/<AppShell\b[\s\S]*?navbar=\{\s*<AppHeader\b/);
        expect(headerLiteralOf(LAYOUT_APP_SHELL), `${LAYOUT_APP_SHELL}'s header is not the console bar`).toBe(
          CONSOLE_TOP_BAR,
        );
        return;
      }
      expect(headerLiteralOf(file), `${file}'s header is not the console bar`).toBe(CONSOLE_TOP_BAR);
    });
  }

  it('no other source copies the bar\'s class', () => {
    // The bar's signature: sticky, pinned to the top, on the bar's layer.
    const signature = (literal: string) => ['sticky', 'top-0', 'z-30'].every((c) => literal.split(/\s+/).includes(c));
    // Control: the signature recognises the bar it describes.
    expect(signature(CONSOLE_TOP_BAR)).toBe(true);

    const copies = SCANNED.filter((rel) => !LITERAL_SITES.has(rel)).filter((rel) =>
      [...code(rel).matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].some((m) => signature(m[2])),
    );
    expect(
      copies,
      'These sources spell the console bar\'s class themselves. Read `CONSOLE_TOP_BAR` instead.',
    ).toEqual([]);
  });

  it('nothing offsets from a 56 px bar any more', () => {
    const fromFiftySix = /(?:^|[\s"'`!])top-14\b|scroll-mt-14\b|calc\(100(?:s|d)?vh-3\.5rem\)/;
    // Control: the pattern recognises the sidebar's spelling before objectui#12639.
    expect(fromFiftySix.test('!top-14 !h-[calc(100svh-3.5rem)]')).toBe(true);

    const offsets = SCANNED.filter((rel) => fromFiftySix.test(code(rel)));
    expect(offsets, 'These sources still offset from a 56 px top bar.').toEqual([]);
  });
});
