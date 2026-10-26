/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * No shipped source may write an accessible name as a LITERAL `aria-label`
 * unless the site is declared below (objectui#12145).
 *
 * ## The defect, and why it is a census
 *
 * An `aria-label="Row actions"` is the name a screen reader announces. Written
 * as a literal it never passes through the locale packs, so a reader under
 * `zh` hears English. Single-site cards closed one position each (objectui#4474,
 * #4645, #10104 and more) and the shape kept coming back, because nothing
 * re-derived it. objectui#12145 is the family's closing card: its sites now read
 * their names through their package's translation hook, and this census is the
 * instrument that keeps a new one from landing. Its triage ruled it a test in
 * the ordinary suite, ⛔ not a new CI gate, and a family of its own: it shares
 * nothing with the icon-only-button census objectui#12143 asks for.
 *
 * ## The population, stated as a rule
 *
 * Every source file under a `src/` tree of a `packages/*` or `apps/*` workspace,
 * minus test and measurement tooling (the same `TOOLING` shape
 * `machineLocaleCensus-9909.test.ts` reads). Not only the packages that depend
 * on `@object-ui/i18n`: a literal name is untranslatable wherever it is written,
 * and a backlog package with no translation hook to reach for yet (one that
 * does not depend on `@object-ui/i18n`) is a fact about the fix, not a reason
 * to stop counting.
 *
 * ⚠️ The card's own re-check command, `git grep … -- 'packages/*\/src/**\/*.tsx'`,
 * reached only files in a SUBDIRECTORY of `src/`: without git's `:(glob)` magic
 * that pathspec needs a `/` after `src/`, so no file directly under `src/` was
 * ever read. It enumerated 31 sites; the same regex with `:(glob)` finds several
 * times as many. This census walks the tree instead, so it cannot inherit that
 * blind spot. The sites the card did not enumerate are the BACKLOG below.
 *
 * ## The four shapes it judges
 *
 *  - `aria-label="…"` / `aria-label='…'`: a JSX attribute string;
 *  - `aria-label={'…'}` / `aria-label={"…"}`: the same string behind braces,
 *    which the card's grep could not see;
 *  - `` aria-label={`…`} `` with no `${`: a template that interpolates nothing;
 *  - `'aria-label': '…'`: the object-key spelling of the same prop.
 *
 * A value is judged only when it carries a letter, read with `\p{L}` so a name
 * in any script counts (AGENTS.md's i18n forensics rule: an ASCII class would
 * call a Cyrillic or CJK literal clean).
 *
 * ## ⛔ What this instrument CANNOT see — stated, not assumed
 *
 *  - A template that interpolates (`` aria-label={`Remove ${name}`} ``): the
 *    English words are real, but the value is an expression, and judging it
 *    belongs to a card that decides how such a name is keyed.
 *  - A literal inside a larger expression (`labels?.x ?? 'Submit'`,
 *    `cond ? 'A' : 'B'`, a default parameter, a variable): most of those are a
 *    `t(key, { defaultValue })` doing its job, and a source scan cannot tell
 *    the two apart.
 *  - Every other carrier of an accessible name: `title=`, `placeholder=`,
 *    `alt=`, an `sr-only` span, a prop that a component forwards as
 *    `aria-label` under another name.
 *  - A span the comment masker over-masks: JSX TEXT holding `/*` or `//` reads
 *    to it as a comment opener (the objectui#7882 shape, which
 *    `scripts/check-comment-mask-corpus.mjs` reports). Masking is still
 *    load-bearing: the card's enumeration counted a comment that quotes a past
 *    repair as a live site.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/i18n/src/__tests__ -> repository root
const repoRoot = path.resolve(here, '../../../..');

/* -------------------------------------------------------------------------- */
/* The population                                                             */
/* -------------------------------------------------------------------------- */

const WORKSPACE_PARENTS = ['packages', 'apps'] as const;

const workspaceDirs: string[] = WORKSPACE_PARENTS.flatMap((parent) =>
  readdirSync(path.join(repoRoot, parent), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(repoRoot, parent, e.name, 'package.json')))
    .map((e) => `${parent}/${e.name}`),
);
const population = workspaceDirs.filter((dir) => existsSync(path.join(repoRoot, dir, 'src')));

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', '.turbo', '.next']);
/** Test and measurement tooling never ships; the same shape `machineLocaleCensus-9909.test.ts` reads. */
const TOOLING = /(^|\/)(__tests__|__mocks__|__benchmarks__|e2e)\/|\.(test|spec|bench|stories)\.[cm]?[jt]sx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const sources: Array<{ pkg: string; rel: string; masked: string }> = population.flatMap((pkg) =>
  walk(path.join(repoRoot, pkg, 'src'))
    .map((f) => path.relative(repoRoot, f).split(path.sep).join('/'))
    .filter((rel) => !TOOLING.test(rel))
    .map((rel) => ({ pkg, rel, masked: mask(readFileSync(path.join(repoRoot, rel), 'utf8')) })),
);

/* -------------------------------------------------------------------------- */
/* The matcher                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One alternation per shape; exactly one capture group is set per match. The
 * template arm refuses a `$`, so an interpolating template never matches.
 */
const SITE = new RegExp(
  [
    String.raw`aria-label\s*=\s*"([^"]*)"`,
    String.raw`aria-label\s*=\s*'([^']*)'`,
    String.raw`aria-label\s*=\s*\{\s*"((?:[^"\\\n]|\\.)*)"\s*\}`,
    String.raw`aria-label\s*=\s*\{\s*'((?:[^'\\\n]|\\.)*)'\s*\}`,
    String.raw`aria-label\s*=\s*\{\s*` + '`([^`$]*)`' + String.raw`\s*\}`,
    String.raw`["']aria-label["']\s*:\s*"((?:[^"\\\n]|\\.)*)"`,
    String.raw`["']aria-label["']\s*:\s*'((?:[^'\\\n]|\\.)*)'`,
  ].join('|'),
  'g',
);
const HAS_LETTER = /\p{L}/u;

interface Site {
  file: string;
  line: number;
  /** The literal accessible name, as written. */
  name: string;
}

function scan(file: string, masked: string): Site[] {
  const found: Site[] = [];
  SITE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SITE.exec(masked)) !== null) {
    const name = m.slice(1).find((g) => g !== undefined) ?? '';
    if (!HAS_LETTER.test(name)) continue;
    found.push({ file, line: masked.slice(0, m.index).split('\n').length, name });
  }
  return found;
}

const sites: Site[] = sources.flatMap((s) => scan(s.rel, s.masked));

/* -------------------------------------------------------------------------- */
/* The declared sites — file · names · verdict · reason                       */
/* -------------------------------------------------------------------------- */

interface Declared {
  file: string;
  /** Every literal name the file may carry, once per occurrence. Cited by content, never by line. */
  names: string[];
  verdict: 'exempt' | 'backlog';
  reason: string;
}

/**
 * Sites the card enumerated that stay literal, each with why. These are the
 * "stated list" objectui#12145's acceptance asks the PR to give.
 */
const EXEMPT: Declared[] = [
  {
    file: 'packages/components/src/dev/DebugPanel.tsx',
    names: ['Developer Debug Panel', 'Close debug panel'],
    verdict: 'exempt',
    reason:
      'a developer tool, not product UI: no objectui surface mounts it (a host opts in behind `?__debug` or ' +
      'Ctrl+Shift+D), and its whole chrome — heading, tab names, empty states — is English developer copy, so ' +
      'translating two names would leave the panel half in one language.',
  },
  {
    file: 'packages/components/src/ui/pagination.tsx',
    names: ['Go to previous page', 'Go to next page'],
    verdict: 'exempt',
    reason:
      'the No-Touch Shadcn primitive (AGENTS.md commandment #7) spreads `props` after these defaults, and its ' +
      'one shipped call site, the `pagination` renderer, passes `table.previousPage` / `table.nextPage`.',
  },
  {
    file: 'packages/components/src/ui/sidebar.tsx',
    names: ['Toggle Sidebar'],
    verdict: 'exempt',
    reason:
      "`SidebarRail`'s default in the No-Touch Shadcn primitive. No objectui surface renders the rail; the only " +
      "writer is the CLI's app generator, whose generated app mounts no `I18nProvider`. A host names it through " +
      '`aria-label` / `title`, which spread last (`common.toggleSidebar` is the key).',
  },
  {
    file: 'packages/plugin-chatbot/src/elements/message.tsx',
    names: ['Previous branch', 'Next branch', 'Remove attachment', 'Remove attachment'],
    verdict: 'exempt',
    reason:
      'vendored from vercel/ai-elements (the file header says to wrap, not edit), and no objectui surface renders ' +
      '`MessageBranchPrevious`, `MessageBranchNext` or `MessageAttachment`: they are only re-exported as ' +
      '`AIElements`. The branch buttons spread `props` last, so a host can name them.',
  },
  {
    file: 'packages/plugin-chatbot/src/elements/prompt-input.tsx',
    names: ['Submit'],
    verdict: 'exempt',
    reason:
      "the vendored `PromptInputSubmit`'s default, which spreads `props` after it; its one shipped call site, " +
      "`ChatbotEnhanced`, passes `console.ai.submit` / `console.ai.stopResponse` read from the pack.",
  },
];

const BACKLOG_REASON =
  "outside objectui#12145's enumeration: the card's re-check pathspec never reached a file directly under " +
  '`src/`, and these were found by this census. Read each through its package translation hook, then delete ' +
  'the name here in the same commit.';

/**
 * Sites still literal that the card did not enumerate. Frozen: a new one fails,
 * and a translated one must leave this list in the same commit.
 */
const BACKLOG: Declared[] = (
  [
    ['packages/app-shell/src/views/metadata-admin/JsonSourceEditor.tsx', ['JSON source']],
    ['packages/app-shell/src/views/metadata-admin/QuickFind.tsx', ['locked']],
    ['packages/auth/src/UserMenu.tsx', ['Profile', 'Settings', 'Sign out']],
    ['packages/components/src/custom/config-panel-renderer.tsx', ['breadcrumb']],
    ['packages/components/src/ui/breadcrumb.tsx', ['breadcrumb']],
    ['packages/components/src/ui/pagination.tsx', ['pagination']],
    ['packages/layout/src/AppSchemaRenderer.tsx', ['Mobile navigation', 'Search navigation']],
    ['packages/layout/src/PageHeader.tsx', ['Back to list']],
    ['packages/plugin-chatbot/src/FloatingChatbotPanel.tsx', ['Close chat']],
    ['packages/plugin-designer/src/AppCreationWizard.tsx', ['Move up', 'Move down', 'Remove']],
    ['packages/plugin-designer/src/DashboardEditor.tsx', ['Move up', 'Move down', 'Remove widget', 'Close']],
    [
      'packages/plugin-designer/src/DataModelDesigner.tsx',
      [
        'Designer toolbar', 'Undo', 'Redo', 'Zoom Out', 'Zoom In', 'Reset Zoom', 'Copy', 'Paste', 'Auto Layout',
        'Collaboration active', 'Add Entity', 'Add Relationship', 'Canvas',
      ],
    ],
    ['packages/plugin-designer/src/EditorModeToggle.tsx', ['Editor mode']],
    [
      'packages/plugin-designer/src/PageDesigner.tsx',
      [
        'Hidden', 'Locked', 'Component palette', 'Designer toolbar', 'Undo', 'Redo', 'Copy', 'Paste',
        'Delete selected', 'Preview', 'Toggle minimap', 'Zoom out', 'Zoom in', 'Reset zoom', 'Design canvas',
        'Component tree', 'Hidden', 'Locked',
      ],
    ],
    [
      'packages/plugin-designer/src/ProcessDesigner.tsx',
      [
        'Process toolbar', 'Process name', 'Process version', 'Collaboration active', 'Undo', 'Redo', 'Copy',
        'Paste', 'Connect nodes', 'Auto layout', 'Zoom in', 'Zoom level', 'Zoom out', 'Reset zoom',
        'Add Start Event', 'Add User Task', 'Add Gateway', 'Add End Event', 'Process canvas', 'Delete node',
        'Property panel',
      ],
    ],
    ['packages/plugin-detail/src/ThreadedReplies.tsx', ['Send reply']],
    ['packages/plugin-grid/src/FormulaBar.tsx', ['Confirm', 'Cancel']],
    ['packages/plugin-grid/src/InlineEditing.tsx', ['Save', 'Cancel']],
    ['packages/plugin-kanban/src/CardTemplates.tsx', ['Card templates']],
    ['packages/plugin-kanban/src/InlineQuickAdd.tsx', ['Quick add card']],
    ['packages/plugin-kanban/src/KanbanImpl.tsx', ['Kanban board with swimlanes', 'Kanban board']],
    ['packages/plugin-list/src/ListView.tsx', ['Bulk actions']],
    [
      'packages/plugin-map/src/ObjectMap.tsx',
      ['Locations', 'Show my location', 'Your location', 'Location details', 'Close details'],
    ],
  ] as Array<[string, string[]]>
).map(([file, names]) => ({ file, names, verdict: 'backlog' as const, reason: BACKLOG_REASON }));

const DECLARED: Declared[] = [...EXEMPT, ...BACKLOG];

/** `file · name` -> how many times DECLARED allows it. */
function tally(entries: Array<{ file: string; name: string }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const { file, name } of entries) {
    const k = `${file} · ${name}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

const declaredTally = tally(DECLARED.flatMap((d) => d.names.map((name) => ({ file: d.file, name }))));
const foundTally = tally(sites);

/* -------------------------------------------------------------------------- */

describe('no shipped source names an element with a literal aria-label unless it is declared (objectui#12145)', () => {
  /**
   * ⭐ The width guards. The assertion that matters is "nothing undeclared",
   * which a scan that read NOTHING satisfies — so a narrowing must be loud.
   */
  it('the population is every packages/* and apps/* src tree, and it is wide', () => {
    expect(workspaceDirs.length, 'workspace directories under packages/ and apps/').toBeGreaterThan(30);
    expect(population.length, 'workspaces with a src/ tree').toBeGreaterThan(30);
    for (const pkg of ['apps/console', 'packages/components', 'packages/plugin-designer', 'packages/auth']) {
      expect(population, `${pkg} is scanned`).toContain(pkg);
    }
    expect(sources.length).toBeGreaterThan(1000);
    expect(sources.filter((s) => s.rel.endsWith('.tsx')).length).toBeGreaterThan(500);
    // The card's pathspec read none of these: a file directly under a `src/`.
    const directlyUnderSrc = sources.filter((s) => /^(packages|apps)\/[^/]+\/src\/[^/]+$/.test(s.rel));
    expect(directlyUnderSrc.length, 'files directly under a src/ root are in the population').toBeGreaterThan(100);
  });

  /**
   * ⭐ The lit control. The site the card's pathspec could not reach (a file
   * directly under `src/`) must be SEEN, or the census has the card's blind spot.
   */
  it('a file directly under src/ is read, and a declared site in it is found', () => {
    const control = sites.filter((s) => s.file === 'packages/plugin-designer/src/PageDesigner.tsx');
    expect(control.map((s) => s.name)).toContain('Component palette');
    expect(sites.length).toBeGreaterThan(50);
  });

  it('every literal accessible name is declared, exactly as many times as it is written', () => {
    const keys = new Set([...declaredTally.keys(), ...foundTally.keys()]);
    const wrong = [...keys]
      .filter((k) => (declaredTally.get(k) ?? 0) !== (foundTally.get(k) ?? 0))
      .sort()
      .map((k) => {
        const where = sites
          .filter((s) => `${s.file} · ${s.name}` === k)
          .map((s) => `:${s.line}`)
          .join(' ');
        return `${k} — declared ${declaredTally.get(k) ?? 0}, found ${foundTally.get(k) ?? 0} ${where}`.trim();
      });
    expect(
      wrong,
      'a NEW literal: read the name through the package translation hook (`t(key)`, a key in all ten packs) — or ' +
        'declare it in EXEMPT with its reason. A REMOVED one: delete its name here in the same commit.',
    ).toEqual([]);
  });

  it('every exemption says why, and no file is both exempt and backlog for one name', () => {
    for (const e of EXEMPT) expect(e.reason.length, `${e.file} carries a reason`).toBeGreaterThan(80);
    const exempt = new Set(EXEMPT.flatMap((e) => e.names.map((n) => `${e.file} · ${n}`)));
    const both = BACKLOG.flatMap((b) => b.names.map((n) => `${b.file} · ${n}`)).filter((k) => exempt.has(k));
    expect(both).toEqual([]);
  });

  /**
   * ⭐ The matcher's own control: each shape it judges is counted, and each it
   * does not judge is not. Without it every `toEqual([])` above passes on a
   * regex that matches nothing.
   */
  it('the matcher counts the four literal shapes and nothing else', () => {
    const fixture = [
      '<a aria-label="Double quoted" />',
      "<a aria-label='Single quoted' />",
      "<a aria-label={'Braced single'} />",
      '<a aria-label={"Braced double"} />',
      '<a aria-label={`Plain template`} />',
      "const props = { 'aria-label': 'Object key' };",
      '<a aria-label="Заголовок" />',
      '<a aria-label="名前" />',
      // not judged: an expression, an interpolating template, a value without a letter, a comment
      "<a aria-label={t('table.rowActions')} />",
      '<a aria-label={`Remove ${name}`} />',
      '<a aria-label="" />',
      '<a aria-label="42" />',
      '// <a aria-label="Commented out" />',
      '/* <a aria-label="Block comment" /> */',
    ].join('\n');
    expect(scan('fixture', mask(fixture)).map((s) => s.name)).toEqual([
      'Double quoted',
      'Single quoted',
      'Braced single',
      'Braced double',
      'Plain template',
      'Object key',
      'Заголовок',
      '名前',
    ]);
  });
});
