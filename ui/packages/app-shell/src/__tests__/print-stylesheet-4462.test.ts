/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4462 — `window.print()` must produce a usable page, and the Print
 * controls must say what they do.
 *
 * ## The defect
 *
 * Three surfaces call a bare `window.print()` (`plugin-list/src/ListView.tsx`,
 * `plugin-report/src/ReportViewer.tsx`, `app-shell/src/views/DashboardView.tsx`).
 * With no print stylesheet the browser printed the entire console — sidebar,
 * top bar, chat rail, toasts — with the data table clipped to one viewport,
 * because the shell is a viewport-height flex chain. The reporting project was
 * accepting the control against an "export to PDF" requirement; the real
 * print/PDF primitive was closed NOT_PLANNED as objectstack#1301.
 *
 * ## ⚠ WHAT THIS FILE CANNOT ASSERT — read before adding a case here
 *
 * **No assertion in this repo's vitest suites can observe print RENDERING.**
 * `@media print` never applies under happy-dom or jsdom: neither implements a
 * layout engine or media-type emulation, so `window.matchMedia('print')` is a
 * stub and `getComputedStyle()` returns the screen cascade whatever the sheet
 * says. Consequently the following are NOT pinned anywhere and must not be
 * claimed to be:
 *
 *   - that the sidebar/top bar are actually absent from the printed output;
 *   - that a long table paginates rather than clipping;
 *   - that a rule still MATCHES the live DOM. A selector here is a string; if
 *     `AppShell` (packages/layout) or the shadcn sidebar primitive changes its
 *     markup, the rule silently stops matching and this file stays green.
 *
 * What IS pinned is the structural half: the sheet ships, the `@media print`
 * block exists, and each load-bearing rule is present in it — so DELETING a
 * rule reds. That, plus the two call-site pins below, is the whole mechanical
 * claim. Real print rendering is verified once, by hand, through a browser's
 * print preview (Playwright `page.emulateMedia({ media: 'print' })`).
 *
 * ## Direction, predicted before running (#4118)
 *
 * Every case here fails on `origin/main`: the `@media print` block does not
 * exist there at all, and `DashboardView` still reads the
 * `dashboardActions.pdfPreparing` key. Removing any single selector from the
 * sheet reds exactly the case naming it, and no other.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/app-shell/src/__tests__ -> packages/app-shell/src
const appShellSrc = path.resolve(here, '..');
// packages/app-shell/src/__tests__ -> repo root
const repoRoot = path.resolve(here, '../../../..');

const STYLESHEET = path.join(appShellSrc, 'styles.css');

/**
 * Return the body of the first `@media print { … }` block, brace-balanced.
 *
 * A regex cannot do this: the block nests `@page { … }` and a dozen rule
 * bodies, so `/@media print\{[^}]*\}/` would stop at the first inner `}` and
 * silently "find" a block containing almost nothing — which is exactly the
 * shape that makes every `toContain` below pass for the wrong reason.
 */
function printBlock(css: string): string {
  const at = css.indexOf('@media print');
  if (at === -1) return '';
  const open = css.indexOf('{', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}

const css = readFileSync(STYLESHEET, 'utf8');
const block = printBlock(css);

/**
 * The console chrome that must be hidden on paper, each with the markup it
 * targets. Listed one-per-case so a failure names the piece of chrome that
 * came back, not "the selector list changed".
 */
const HIDDEN_CHROME: ReadonlyArray<readonly [selector: string, what: string]> = [
  ['.group\\/sidebar-wrapper > header', "AppShell's full-width top bar"],
  ['[data-collapsible][data-side][data-state]', 'the shadcn Sidebar root (incl. its layout gap)'],
  ["[data-sidebar='sidebar']", 'the sidebar panel / mobile sheet'],
  ["[data-sidebar='rail']", 'the sidebar resize rail'],
  ["[data-sidebar='trigger']", 'the sidebar toggle button'],
  ["[data-testid='chat-dock-panel']", 'the docked chat rail'],
  ["[data-testid='chat-dock-mobile-sheet']", 'the chat bottom sheet'],
  ["[data-testid='console-chatbot-fab']", 'the floating chat launcher'],
  ["[data-testid='draft-preview-bar']", 'the draft-preview bar'],
  ["[data-testid='unpublished-app-bar']", 'the unpublished-app bar'],
  ['[data-sonner-toaster]', 'toasts'],
  ['[data-radix-popper-content-wrapper]', 'open popovers / dropdowns / menus'],
  ["[role='tooltip']", 'tooltips'],
  ['[data-print-hide]', 'in-content toolbars that opt out via the shared marker'],
];

describe('objectui#4462 — the shared print stylesheet', () => {
  it('ships an @media print block in the app-shell styles entry', () => {
    // Non-vacuity for every `toContain` below: without this, an emptied or
    // renamed stylesheet would make each of them assert over `''`.
    expect(css).toContain('@media print');
    expect(block.length).toBeGreaterThan(400);
  });

  it('is the entry host apps import, so the rules reach the console chrome', () => {
    // The sheet is only worth anything where it is actually pulled in. The
    // console is the surface #4462 was reported against.
    const consoleCss = readFileSync(
      path.join(repoRoot, 'apps/console/src/index.css'),
      'utf8',
    );
    expect(consoleCss).toContain("@import '@object-ui/app-shell/styles.css';");

    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages/app-shell/package.json'), 'utf8'),
    );
    expect(pkg.exports['./styles.css']).toBe('./src/styles.css');
  });

  describe('hides the console chrome', () => {
    for (const [selector, what] of HIDDEN_CHROME) {
      it(`hides ${what} — ${selector}`, () => {
        expect(block).toContain(selector);
      });
    }

    it('groups them under a single `display: none !important` declaration', () => {
      // The selectors above are only load-bearing if something hides them.
      // Anchored on the LAST selector of the group so a rule appended after
      // `[data-print-hide]` cannot silently take the declaration with it.
      expect(block).toMatch(
        /\[data-print-hide\]\s*\{\s*display:\s*none\s*!important;\s*\}/,
      );
    });

    it('does NOT hide modal dialogs — an open record overlay is the content being printed', () => {
      expect(block).not.toContain("[role='dialog']");
      expect(block).not.toContain('[role="dialog"]');
    });
  });

  describe('prints the active content area full-width and unclipped', () => {
    it('releases the viewport-height chain on html/body', () => {
      expect(block).toMatch(/html,\s*body\s*\{[^}]*height:\s*auto\s*!important;/);
      expect(block).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*visible\s*!important;/);
    });

    it('releases it on the SidebarProvider wrapper', () => {
      expect(block).toMatch(
        /\.group\\\/sidebar-wrapper\s*\{[^}]*overflow:\s*visible\s*!important;/,
      );
    });

    it('gives <main> full width, auto height and visible overflow', () => {
      const mainRule = /(^|\n)\s*main\s*\{([^}]*)\}/.exec(block);
      expect(mainRule).not.toBeNull();
      const body = mainRule![2];
      expect(body).toMatch(/width:\s*100%\s*!important;/);
      expect(body).toMatch(/height:\s*auto\s*!important;/);
      expect(body).toMatch(/max-height:\s*none\s*!important;/);
      expect(body).toMatch(/overflow:\s*visible\s*!important;/);
    });

    it('un-clips every bounded box inside the content, by Tailwind class substring', () => {
      // This is what reaches ListView's `overflow-hidden` root, its
      // `flex-1 min-h-0 overflow-hidden` view container and the grid's
      // `overflow-auto` scroller without any plugin-local print rule. AGENTS.md
      // §2 bans inline `style={{}}` and CSS modules, so the constraint is
      // always a CLASS and always reachable this way.
      expect(block).toMatch(
        /main \[class\*='overflow-'\]\s*\{\s*overflow:\s*visible\s*!important;\s*\}/,
      );
      expect(block).toMatch(
        /main \[class\*='max-h-'\]\s*\{\s*max-height:\s*none\s*!important;\s*\}/,
      );
      expect(block).toContain("main [class*='h-full']");
      expect(block).toContain("main [class*='h-screen']");
      expect(block).toContain("main [class*='h-svh']");
    });
  });

  describe('paginates tables instead of clipping them', () => {
    it('repeats the header row on every sheet', () => {
      expect(block).toMatch(/main thead\s*\{\s*display:\s*table-header-group;\s*\}/);
      expect(block).toMatch(/main tfoot\s*\{\s*display:\s*table-footer-group;\s*\}/);
    });

    it('keeps a row from being split across a page break', () => {
      expect(block).toMatch(/main tr,\s*\n?\s*main img\s*\{\s*break-inside:\s*avoid;\s*\}/);
    });

    it('sets a page margin', () => {
      expect(block).toMatch(/@page\s*\{\s*margin:\s*\d+mm;\s*\}/);
    });
  });

  it('neutralises dark mode, which otherwise prints white-on-white', () => {
    // Browsers drop background fills by default but keep foreground colours,
    // so a dark-themed console prints light text onto white paper.
    expect(block).toMatch(/\.dark,\s*\n?\s*\.dark \*\s*\{/);
  });
});

describe('objectui#4462 — the dashboard print action stops claiming a PDF export', () => {
  const dashboardView = readFileSync(
    path.join(appShellSrc, 'views/DashboardView.tsx'),
    'utf8',
  );

  it('announces the browser print dialog, not a PDF export', () => {
    expect(dashboardView).toContain("t('dashboardActions.printDialogOpening')");
  });

  it('no longer reads the retired `pdfPreparing` key', () => {
    // The key is gone from all ten packs; a leftover reader would render the
    // raw key string in the toast.
    expect(dashboardView).not.toContain('pdfPreparing');
  });

  it('still calls window.print() — the ruling forbids removal and headless gating', () => {
    expect(dashboardView).toContain('window.print()');
    expect(dashboardView).not.toMatch(/headless|navigator\.webdriver/i);
  });
});
