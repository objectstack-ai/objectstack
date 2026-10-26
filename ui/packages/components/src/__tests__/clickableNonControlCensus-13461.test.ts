/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * No shipped `div` or `span` may take a click without a keyboard path, unless
 * the site is declared below (objectui#13461).
 *
 * ## The defect, and why it is a census
 *
 * A `div` with an `onClick` is a mouse-only control: it is not in the tab
 * order, Enter and Space do nothing on it, and a screen reader announces no
 * role, so a keyboard or screen-reader user can neither find nor use it. The
 * remedy is a real `<button type="button">`, or, where a button cannot hold the
 * content, `role="button"` with `tabIndex={0}` and an `onKeyDown` for Enter and
 * Space. objectui#13461 repaired the sites it found in the console and froze
 * the rest here. It is a test in the ordinary suite, ⛔ not a new CI gate, and
 * the sibling of the icon-only-button census objectui#12143 keeps in this
 * directory (`iconOnlyButtonCensus-12143.test.ts`): that one asks whether a
 * button has a name, this one whether a clickable thing is a control at all.
 *
 * ## The population, stated as a rule
 *
 * Every source file under the `src/` tree of a `packages/*` or `apps/*`
 * workspace, minus test and measurement tooling (the `TOOLING` shape the
 * objectui#12145 census reads). `apps/*` is in it because the console's own
 * pages carry such sites.
 *
 * ## What it judges
 *
 * A JSX `div` or `span` (opening or self-closing) that carries `onClick` and
 * none of `role`, `tabIndex`, `onKeyDown`, `onKeyUp`, `onKeyPress`. A site is
 * keyed by file, tag and HANDLER, never by line: a handler named by reference
 * reads as its text (`handleBgClick`, `dock.collapse`), an inline function as
 * the names it calls, in order (`stopPropagation,navigate`), and a
 * `cond ? fn : undefined` as its function branch.
 *
 * ## Not every clickable `div` is a control
 *
 * `NOT_CONTROLS` declares the sites that take a click but are not something a
 * user operates, each with its reason: a wrapper whose handler only stops the
 * click reaching an ancestor (the controls inside it are real buttons); the
 * scrim behind an overlay; the empty background of a design canvas, where a
 * click clears the selection; a pointer drag handle, whose click handler only
 * keeps the drag from also selecting. Whether a drag has a keyboard twin is a
 * question about the drag, not about this element, and this census does not
 * answer it. ⛔ Never give such an element `role="button"`:
 * announcing a wrapper as a button is a defect of its own.
 *
 * ## ⛔ What this instrument CANNOT see — stated, not assumed
 *
 *  - Attributes that arrive through a spread (`{...attributes}` from dnd-kit's
 *    `useSortable`, a `{...props}` pass-through): the source does not say what
 *    they carry, so an element with a spread is not judged at all.
 *  - Any other tag: a clickable `li`, `td`, `img` or `svg` element, and a
 *    component that renders a `div` under another name.
 *  - Whether a declared reason is still TRUE: a wrapper that later gains a
 *    real action keeps its key only if its handler's calls are unchanged.
 *
 * ## The ratchet
 *
 * `BACKLOG` freezes the clickable `div` / `span` sites that ARE controls and
 * still have no keyboard path; `NOT_CONTROLS` the ones that are not controls.
 * Declared and found must agree exactly, in both lists together: a new site
 * fails, and a repaired or removed one must leave its list in the same commit,
 * so the count can only fall.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/components/src/__tests__ -> repository root
const repoRoot = path.resolve(here, '../../../..');

/* -------------------------------------------------------------------------- */
/* The population                                                             */
/* -------------------------------------------------------------------------- */

const workspaceDirs: string[] = ['packages', 'apps'].flatMap((top) =>
  readdirSync(path.join(repoRoot, top), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(repoRoot, top, e.name, 'package.json')))
    .map((e) => `${top}/${e.name}`),
);
const population = workspaceDirs.filter((dir) => existsSync(path.join(repoRoot, dir, 'src')));

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', '.turbo', '.next']);
/** Test and measurement tooling never ships; the shape the objectui#12145 census reads. */
const TOOLING = /(^|\/)(__tests__|__mocks__|__benchmarks__|e2e)\/|\.(test|spec|bench|stories)\.[cm]?[jt]sx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (/\.[cm]?[jt]sx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const sources: string[] = population.flatMap((pkg) =>
  walk(path.join(repoRoot, pkg, 'src'))
    .map((f) => path.relative(repoRoot, f).split(path.sep).join('/'))
    .filter((rel) => !TOOLING.test(rel)),
);

/* -------------------------------------------------------------------------- */
/* The matcher                                                                */
/* -------------------------------------------------------------------------- */

const KEYBOARD_CARRIERS = new Set(['role', 'tabIndex', 'onKeyDown', 'onKeyUp', 'onKeyPress']);
const JUDGED_TAGS = new Set(['div', 'span']);

interface Site {
  file: string;
  line: number;
  /** `div · handleBgClick`, `span · stopPropagation,navigate`. */
  key: string;
}

interface Scan {
  /** Every `div` / `span` with an `onClick`, judged or not. */
  clickable: number;
  /** The ones with no keyboard path. */
  sites: Site[];
}

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression;
  return cur;
}

function isNothing(e: ts.Expression): boolean {
  const u = unwrap(e);
  return (ts.isIdentifier(u) && u.text === 'undefined') || u.kind === ts.SyntaxKind.NullKeyword;
}

/** The handler's signature: its reference text, or the names an inline function calls. */
function handlerSignature(e: ts.Expression, sf: ts.SourceFile): string {
  const u = unwrap(e);
  if (ts.isIdentifier(u) || ts.isPropertyAccessExpression(u)) return u.getText(sf);
  if (ts.isConditionalExpression(u)) {
    const branches = [u.whenTrue, u.whenFalse].filter((b) => !isNothing(b));
    return branches.map((b) => handlerSignature(b, sf)).join(' | ');
  }
  if (ts.isArrowFunction(u) || ts.isFunctionExpression(u)) {
    const calls: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(sf);
        if (!calls.includes(name)) calls.push(name);
      }
      ts.forEachChild(n, visit);
    };
    visit(u.body);
    return calls.length > 0 ? calls.join(',') : '(no call)';
  }
  return u.getText(sf).replace(/\s+/g, ' ');
}

function scanSource(file: string, text: string): Scan {
  const out: Scan = { clickable: 0, sites: [] };
  if (!text.includes('onClick')) return out;
  const kind = /\.[cm]?[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);

  const visit = (node: ts.Node): void => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening && JUDGED_TAGS.has(opening.tagName.getText(sf))) {
      const props = opening.attributes.properties;
      const onClick = props.find(
        (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'onClick',
      );
      const handler = onClick?.initializer;
      if (handler && ts.isJsxExpression(handler) && handler.expression && !isNothing(handler.expression)) {
        out.clickable += 1;
        const spread = props.some((a) => ts.isJsxSpreadAttribute(a));
        const keyboard = props.some((a) => ts.isJsxAttribute(a) && KEYBOARD_CARRIERS.has(a.name.getText(sf)));
        if (!spread && !keyboard) {
          const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1;
          const key = `${opening.tagName.getText(sf)} · ${handlerSignature(handler.expression, sf)}`;
          out.sites.push({ file, line, key });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const scans: Scan[] = sources.map((rel) => scanSource(rel, readFileSync(path.join(repoRoot, rel), 'utf8')));
const clickableCount = scans.reduce((n, s) => n + s.clickable, 0);
const found: Site[] = scans.flatMap((s) => s.sites);

/* -------------------------------------------------------------------------- */
/* The declared sites — file · tag · handler                                  */
/* -------------------------------------------------------------------------- */

/** Reasons a clickable `div` / `span` is not a control. */
const GUARD = 'a wrapper whose handler only stops the click reaching an ancestor; the controls inside it are real buttons';
const SCRIM = 'the scrim behind an overlay or drawer: a click on it dismisses, and the surface has its own close or toggle button';
const CANVAS = 'the empty background of a design canvas: a click there clears the selection and operates nothing';
const DRAG = 'a pointer drag handle (column resize, bar resize, link dot): the click handler only keeps the drag from also selecting';

/** Clickable `div` / `span` sites that are not controls, each with its reason. Deletions only. */
const NOT_CONTROLS: Array<[file: string, key: string, reason: string]> = [
  ['apps/console/src/pages/system/ApprovalsInboxPage.tsx', 'div · stopPropagation', GUARD],
  ['apps/console/src/pages/system/ApprovalsInboxPage.tsx', 'div · stopPropagation', GUARD],
  ['packages/app-shell/src/console/marketplace/MarketplaceRowActions.tsx', 'div · stopPropagation', GUARD],
  ['packages/app-shell/src/views/metadata-admin/previews/ObjectFormCanvas.tsx', 'div · handleBgClick', CANVAS],
  ['packages/app-shell/src/views/metadata-admin/previews/ObjectFormCanvas.tsx', 'div · handleBgClick', CANVAS],
  ['packages/app-shell/src/views/metadata-admin/previews/PageBlockCanvas.tsx', 'div · handleBgClick', CANVAS],
  ['packages/app-shell/src/views/metadata-admin/previews/PageBlockCanvas.tsx', 'div · handleBgClick', CANVAS],
  ['packages/app-shell/src/views/metadata-admin/previews/PageBlockCanvas.tsx', 'div · handleBgClick', CANVAS],
  // The read-only tray of a node's regions: it keeps a click from starting a card drag.
  ['packages/app-shell/src/views/metadata-admin/previews/flow-canvas-parts.tsx', 'div · stopPropagation', GUARD],
  ['packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx', 'div · clearFieldSelOnEmpty', CANVAS],
  ['packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx', 'div · clearFieldSelOnEmpty', CANVAS],
  ['packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx', 'div · setRailOpen', SCRIM],
  ['packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx', 'div · setRailOpen', SCRIM],
  ['packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx', 'div · setRailOpen', SCRIM],
  ['packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx', 'div · setRailOpen', SCRIM],
  ['packages/app-shell/src/views/studio-design/StudioRightSlot.tsx', 'div · onOverlayDismiss', SCRIM],
  ['packages/components/src/renderers/complex/data-table.tsx', 'div · stopPropagation', DRAG],
  // The column header's context menu: its entries are buttons.
  ['packages/components/src/renderers/complex/data-table.tsx', 'div · stopPropagation', GUARD],
  ['packages/plugin-dashboard/src/DashboardRenderer.tsx', 'div · handleBackgroundClick', CANVAS],
  ['packages/plugin-dashboard/src/DashboardRenderer.tsx', 'div · handleBackgroundClick', CANVAS],
  ['packages/plugin-designer/src/ProcessDesigner.tsx', 'div · handleCanvasClick', CANVAS],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · setPendingAutoSchedule', SCRIM],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · setPendingConflict', SCRIM],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · stopPropagation', DRAG],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · stopPropagation', DRAG],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · stopPropagation', DRAG],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · stopPropagation', DRAG],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · stopPropagation', DRAG],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · stopPropagation', DRAG],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · stopPropagation', DRAG],
  ['packages/plugin-grid/src/components/RowActionMenu.tsx', 'div · stopPropagation', GUARD],
  // A card's field cell: it stops a click on a link or button inside from also opening the card.
  ['packages/plugin-list/src/ObjectGallery.tsx', 'div · closest,stopPropagation', GUARD],
];

/**
 * Clickable `div` / `span` sites that ARE controls and still have no keyboard
 * path, frozen when objectui#13461 landed. Deletions only: repair one with a
 * real `button` and delete its row in the same commit.
 */
const BACKLOG: Array<[file: string, key: string]> = [
  // The data form preview selects a field by a click delegated from its frame.
  ['packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx', 'div · closest,getAttribute,some,readFields,setFieldSel'],
  ['packages/plugin-ai/src/AIRecommendations.tsx', 'div · handleSelect'],
  ['packages/plugin-designer/src/DashboardEditor.tsx', 'div · onSelect'],
  ['packages/plugin-designer/src/DataModelDesigner.tsx', 'span · stopPropagation,handleStartFieldEdit'],
  ['packages/plugin-designer/src/PageDesigner.tsx', 'div · stopPropagation,toggle'],
  ['packages/plugin-designer/src/ProcessDesigner.tsx', 'div · stopPropagation,handleNodeClickForConnect'],
  ['packages/plugin-designer/src/ProcessDesigner.tsx', 'div · stopPropagation,handleNodeClickForConnect'],
  ['packages/plugin-designer/src/ProcessDesigner.tsx', 'div · stopPropagation,handleNodeClickForConnect'],
  ['packages/plugin-designer/src/ProcessDesigner.tsx', 'div · stopPropagation,setConnectMode,setConnectSource,handleNodeClickForConnect'],
  ['packages/plugin-designer/src/ReportDesigner.tsx', 'div · toggle'],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · setSelectedTaskId'],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · setSelectedTaskId'],
  ['packages/plugin-gantt/src/GanttView.tsx', 'div · setSelectedTaskId'],
  // The mobile card list.
  ['packages/plugin-grid/src/ObjectGrid.tsx', 'div · handleClick'],
  ['packages/plugin-grid/src/VirtualGrid.tsx', 'div · getSelection,trim,toString,intersectsNode,getRangeAt,onRowClick'],
  ['packages/plugin-view/src/ManageViewsDialog.tsx', 'div · onRowClick'],
];

/** `file · key` -> how many times. */
function tally(entries: Array<{ file: string; key: string }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const { file, key } of entries) {
    const k = `${file} · ${key}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

const declared = [
  ...NOT_CONTROLS.map(([file, key]) => ({ file, key })),
  ...BACKLOG.map(([file, key]) => ({ file, key })),
];
const declaredTally = tally(declared);
const foundTally = tally(found);

/* -------------------------------------------------------------------------- */

describe('no shipped div or span takes a click without a keyboard path unless it is declared (objectui#13461)', () => {
  /**
   * ⭐ The width guards. The assertion that matters is "nothing undeclared",
   * which a scan that read NOTHING satisfies — so a narrowing must be loud.
   */
  it('the population is every packages/* and apps/* src tree, and it is wide', () => {
    expect(population.length, 'workspaces with a src/ tree').toBeGreaterThan(30);
    for (const pkg of ['packages/components', 'packages/app-shell', 'packages/plugin-grid', 'apps/console']) {
      expect(population, `${pkg} is scanned`).toContain(pkg);
    }
    expect(sources.length, 'JSX-capable source files read').toBeGreaterThan(700);
    expect(clickableCount, 'clickable div / span elements read').toBeGreaterThan(50);
  });

  it('every reason is one of the declared four, and no site is declared twice over', () => {
    for (const [file, key, reason] of NOT_CONTROLS) {
      expect([GUARD, SCRIM, CANVAS, DRAG], `${file} · ${key}`).toContain(reason);
    }
    const backlogKeys = new Set(BACKLOG.map(([file, key]) => `${file} · ${key}`));
    const both = NOT_CONTROLS.map(([file, key]) => `${file} · ${key}`).filter((k) => backlogKeys.has(k));
    expect(both, 'a site is either a control or not').toEqual([]);
  });

  it('every clickable div / span without a keyboard path is declared, exactly as many times as it is written', () => {
    const keys = new Set([...declaredTally.keys(), ...foundTally.keys()]);
    const wrong = [...keys]
      .filter((k) => (declaredTally.get(k) ?? 0) !== (foundTally.get(k) ?? 0))
      .sort()
      .map((k) => {
        const where = found
          .filter((s) => `${s.file} · ${s.key}` === k)
          .map((s) => `:${s.line}`)
          .join(' ');
        return `${k} — declared ${declaredTally.get(k) ?? 0}, found ${foundTally.get(k) ?? 0} ${where}`.trim();
      });
    expect(
      wrong,
      'a NEW clickable div / span: make it a `<button type="button">` (or `role="button"` + `tabIndex={0}` + ' +
        'an Enter / Space `onKeyDown` where a button cannot hold the content); if it is not a control, declare it ' +
        'in NOT_CONTROLS with its reason. A REPAIRED one: delete it from its list in the same commit.',
    ).toEqual([]);
  });

  /**
   * ⭐ The matcher's own control: each shape it judges is counted with the
   * key it is declared by, and each it does not judge is not counted.
   */
  it('the matcher judges the mouse-only shapes and nothing else', () => {
    const fixture = [
      'export const A = () => (',
      '  <div>',
      '    <div onClick={handleBgClick}>x</div>',
      '    <span onClick={(e) => { e.stopPropagation(); navigate(to); }}>Manage</span>',
      '    <div onClick={onSelect ? (e) => onSelect(e) : undefined} />',
      '    <div onClick={() => dock.collapse()} />',
      // keyboard path: each carrier on its own
      '    <div role="button" onClick={go}>x</div>',
      '    <div tabIndex={0} onClick={go}>x</div>',
      '    <span onKeyDown={key} onClick={go}>x</span>',
      // not judged: a spread, another tag, no handler, an undefined handler, a comment
      '    <div {...attributes} onClick={go}>x</div>',
      '    <li onClick={go}>x</li>',
      '    <button onClick={go}>x</button>',
      '    <div className="x">x</div>',
      '    <div onClick={undefined}>x</div>',
      '    {/* <div onClick={go}>x</div> */}',
      '  </div>',
      ');',
    ].join('\n');
    const scan = scanSource('fixture.tsx', fixture);
    expect(scan.sites.map((s) => s.key)).toEqual([
      'div · handleBgClick',
      'span · stopPropagation,navigate',
      'div · onSelect',
      'div · collapse',
    ]);
    // Every div / span with a live handler is read, keyboard path or not; the spread one too.
    expect(scan.clickable).toBe(8);
  });
});
