/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * No shipped `Button` may hold an icon and nothing else without a name, unless
 * the site is frozen below (objectui#12143).
 *
 * ## The defect, and why it is a census
 *
 * A `Button` whose only child is an icon has no text, so a screen reader
 * announces "button" and nothing more. One family, three cards so far: the view
 * tab bar (objectui#11690), the `data-table` pager (objectui#12124) and the
 * grouped grid's own pager (objectui#12143). Each repaired one position, and
 * nothing re-derived the shape, so it kept coming back. On the third occurrence
 * triage asked for an enumeration pin: this census. It is a test in the ordinary
 * suite, ⛔ not a new CI gate, and it is a family of its own: it shares nothing
 * with the literal-`aria-label` census objectui#12145 keeps in
 * `packages/i18n/src/__tests__/ariaLabelLiteralCensus-12145.test.ts`. That one
 * asks whether a name is translatable; this one asks whether there is a name.
 *
 * It lives in `@object-ui/components` because that package owns the `Button` it
 * judges, as the objectui#12145 census lives in `@object-ui/i18n`, which owns
 * the packs its remedy reads.
 *
 * ## The population, stated as a rule
 *
 * Every source file under the `src/` tree of a `packages/*` workspace, minus
 * test and measurement tooling (the `TOOLING` shape the objectui#12145 census
 * reads). `apps/*` is outside it: triage scoped the census to `packages/*\/src`.
 *
 * ## What it judges
 *
 * A JSX `Button` element is ICON-ONLY when, whitespace-only text aside, it has
 * exactly one child and that child is
 *
 *  - an icon element: its tag is a binding imported from `lucide-react` in the
 *    same file (an aliased import counts by its local name, a namespace import
 *    by `NS.Member`), or its tag's last segment ends in `Icon` (a local `Icon`
 *    variable, `ChevronLeftIcon`, `DensityIcon`); or
 *  - a conditional, `{cond ? A : B}`, whose every branch is such an element (a
 *    show / hide or copy / copied toggle).
 *
 * It is NAMED when the `Button` itself carries `aria-label`, `aria-labelledby`
 * or `title`. Visually hidden text needs no separate test: an `sr-only` span is
 * a second child, so a `Button` holding one is not icon-only to begin with.
 * A tooltip is not a name: Radix wires `TooltipContent` as a description.
 *
 * The census reads the TypeScript AST, so comments and string contents are
 * trivia to it and a comment that quotes a past repair is never a site.
 *
 * ## ⛔ What this instrument CANNOT see — stated, not assumed
 *
 *  - A name that arrives through a spread (`<Button {...props}>`): the source
 *    does not say what the caller passes, so such a `Button` is judged by its
 *    own attributes and counted when they carry no name.
 *  - An icon that reaches the `Button` as a value (`{icon}`, `{children}`,
 *    `{item.icon}`): the child is an expression, not an element, and a source
 *    scan cannot tell an icon from a label there.
 *  - A native `<button>`, or a component that renders a `Button` under another
 *    name: only the `Button` tag is judged.
 *  - Whether a name is non-empty or translated: `aria-label=""` counts as a
 *    name here, and a literal English name is objectui#12145's question.
 *
 * ## The ratchet
 *
 * `BACKLOG` freezes, by file and icon, every unnamed icon-only `Button` the
 * census found when it landed. Declared and found must agree exactly: a new
 * unnamed one fails, and a named one must leave the list in the same commit,
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

const workspaceDirs: string[] = readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(repoRoot, 'packages', e.name, 'package.json')))
  .map((e) => `packages/${e.name}`);
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
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
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

const NAME_CARRIERS = new Set(['aria-label', 'aria-labelledby', 'title']);

interface Judged {
  file: string;
  line: number;
  /** The icon tag, or `A | B` for a conditional between two icons. */
  icon: string;
  named: boolean;
}

interface Scan {
  /** Every `Button` element with children, icon-only or not. */
  buttons: number;
  /** The icon-only ones, named or not. */
  iconOnly: Judged[];
}

/** The local names this file binds from `lucide-react`, and its namespace imports of it. */
function lucideBindings(sf: ts.SourceFile): { named: Set<string>; namespaces: Set<string> } {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.moduleSpecifier.text !== 'lucide-react') continue;
    const bindings = st.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else for (const el of bindings.elements) named.add(el.name.text);
  }
  return { named, namespaces };
}

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  return cur;
}

function scanSource(file: string, text: string): Scan {
  const out: Scan = { buttons: 0, iconOnly: [] };
  if (!text.includes('<Button')) return out;
  const kind = /\.[cm]?[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lucide = lucideBindings(sf);

  const isIconTag = (tag: ts.JsxTagNameExpression): boolean => {
    const spelled = tag.getText(sf);
    if (lucide.named.has(spelled)) return true;
    if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && lucide.namespaces.has(tag.expression.text)) {
      return true;
    }
    return /Icon$/.test(spelled.split('.').pop() ?? '');
  };

  /** The icon this node draws, or null when it is not (only) an icon. */
  const iconOf = (node: ts.Node): string | null => {
    if (ts.isJsxSelfClosingElement(node)) return isIconTag(node.tagName) ? node.tagName.getText(sf) : null;
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName;
      return isIconTag(tag) ? tag.getText(sf) : null;
    }
    if (ts.isJsxExpression(node)) return node.expression ? iconOf(unwrap(node.expression)) : null;
    if (ts.isConditionalExpression(node)) {
      const a = iconOf(unwrap(node.whenTrue));
      const b = iconOf(unwrap(node.whenFalse));
      return a && b ? `${a} | ${b}` : null;
    }
    return null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'Button') {
      out.buttons += 1;
      const kids = node.children.filter((c) => !(ts.isJsxText(c) && c.text.trim() === ''));
      const icon = kids.length === 1 ? iconOf(kids[0]) : null;
      if (icon) {
        const named = node.openingElement.attributes.properties.some(
          (a) => ts.isJsxAttribute(a) && NAME_CARRIERS.has(a.name.getText(sf)),
        );
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        out.iconOnly.push({ file, line, icon, named });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const scans: Scan[] = sources.map((rel) => scanSource(rel, readFileSync(path.join(repoRoot, rel), 'utf8')));
const buttonCount = scans.reduce((n, s) => n + s.buttons, 0);
const iconOnly: Judged[] = scans.flatMap((s) => s.iconOnly);
const unnamed: Judged[] = iconOnly.filter((j) => !j.named);

/* -------------------------------------------------------------------------- */
/* The frozen backlog — file · icons                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every unnamed icon-only `Button` the census found when it landed, by file and
 * icon, once per occurrence. Cited by content, never by line. Frozen: a new one
 * fails, and a named one leaves this list in the same commit.
 *
 * The `packages/plugin-detail/src/DetailView.tsx` previous / next record pair is
 * the one objectui#12143's filer found and triage sent here rather than into
 * that card's fix.
 */
const BACKLOG: Array<[file: string, icons: string[]]> = [
  ['packages/plugin-ai/src/AIFormAssist.tsx', ['RefreshCw', 'X', 'Check', 'X']],
  ['packages/plugin-ai/src/AIRecommendations.tsx', ['ExternalLink', 'X', 'ThumbsUp', 'ThumbsDown']],
  ['packages/plugin-detail/src/DetailView.tsx', ['ArrowLeft', 'ChevronLeft', 'ChevronRight']],
  ['packages/plugin-detail/src/RecordComments.tsx', ['Send']],
  ['packages/plugin-list/src/ListView.tsx', ['X']],
  ['packages/plugin-view/src/SharedViewLink.tsx', ['Check | Copy']],
];

/** `file · icon` -> how many times. */
function tally(entries: Array<{ file: string; icon: string }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const { file, icon } of entries) {
    const k = `${file} · ${icon}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

const declaredTally = tally(BACKLOG.flatMap(([file, icons]) => icons.map((icon) => ({ file, icon }))));
const foundTally = tally(unnamed);

/* -------------------------------------------------------------------------- */

describe('no shipped icon-only Button goes unnamed unless it is frozen in the backlog (objectui#12143)', () => {
  /**
   * ⭐ The width guards. The assertion that matters is "nothing unfrozen", which
   * a scan that read NOTHING satisfies — so a narrowing must be loud.
   */
  it('the population is every packages/* src tree, and it is wide', () => {
    expect(population.length, 'workspaces with a src/ tree').toBeGreaterThan(30);
    for (const pkg of ['packages/components', 'packages/plugin-grid', 'packages/plugin-detail', 'packages/app-shell']) {
      expect(population, `${pkg} is scanned`).toContain(pkg);
    }
    expect(sources.length).toBeGreaterThan(1000);
    expect(buttonCount, 'Button elements read').toBeGreaterThan(300);
    expect(iconOnly.length, 'icon-only Buttons judged').toBeGreaterThan(100);
  });

  /**
   * ⭐ The lit controls, one per verdict. The `data-table` pager (objectui#12124)
   * and the grouped grid's own pager (objectui#12143) are four icon-only
   * `Button`s each, named through `aria-label`; the scan must SEE them as
   * icon-only AND named, or a matcher that saw no icon would pass everything.
   * Since objectui#12620 `ObjectGrid.tsx` holds a SECOND such pager: a
   * server-grouped group's own pager, drawn in its band footer (it used to be
   * the per-group `data-table`'s pager), so that file reads two of each.
   */
  it('the repaired pagers are read as four named icon-only Buttons each', () => {
    const PAGER = ['ChevronLeft', 'ChevronRight', 'ChevronsLeft', 'ChevronsRight'];
    for (const [file, pagers] of [
      ['packages/components/src/renderers/complex/data-table.tsx', 1],
      ['packages/plugin-grid/src/ObjectGrid.tsx', 2],
    ] as const) {
      const chevrons = iconOnly
        .filter((j) => j.file === file && /^Chevrons?(Left|Right)$/.test(j.icon))
        .map((j) => `${j.icon}${j.named ? '' : ' (unnamed)'}`)
        .sort();
      expect(chevrons, file).toEqual(PAGER.flatMap((icon) => Array<string>(pagers).fill(icon)));
    }
  });

  it('every unnamed icon-only Button is frozen, exactly as many times as it is written', () => {
    const keys = new Set([...declaredTally.keys(), ...foundTally.keys()]);
    const wrong = [...keys]
      .filter((k) => (declaredTally.get(k) ?? 0) !== (foundTally.get(k) ?? 0))
      .sort()
      .map((k) => {
        const where = unnamed
          .filter((j) => `${j.file} · ${j.icon}` === k)
          .map((j) => `:${j.line}`)
          .join(' ');
        return `${k} — frozen ${declaredTally.get(k) ?? 0}, found ${foundTally.get(k) ?? 0} ${where}`.trim();
      });
    expect(
      wrong,
      'a NEW unnamed icon-only Button: give it `aria-label={t(key)}` read through the package translation hook ' +
        '(a key in all ten packs). A NAMED one: delete it from BACKLOG in the same commit.',
    ).toEqual([]);
  });

  /**
   * ⭐ The matcher's own control: each shape it judges is counted, and each it
   * does not judge is not. Without it the `toEqual([])` above passes on a
   * matcher that recognises nothing.
   */
  it('the matcher judges the icon-only shapes and nothing else', () => {
    const fixture = [
      "import { X, Trash2, Eye, EyeOff, ChevronLeft as Prev } from 'lucide-react';",
      "import * as Lucide from 'lucide-react';",
      'export const A = () => (',
      '  <div>',
      '    <Button onClick={close}><X className="h-4 w-4" /></Button>',
      '    <Button>',
      '      <Trash2 />',
      '    </Button>',
      '    <Button><Prev /></Button>',
      '    <Button><Lucide.Plus /></Button>',
      '    <Button><DensityIcon /></Button>',
      '    <Button>{shown ? <EyeOff /> : (<Eye />)}</Button>',
      // named: each carrier on its own
      "    <Button aria-label={t('common.close')}><X /></Button>",
      '    <Button aria-labelledby="close-label"><X /></Button>',
      "    <Button title={t('common.delete')}><Trash2 /></Button>",
      // not icon-only: a second child, text, a non-icon element, a value, a mixed conditional
      '    <Button><X /><span className="sr-only">Close</span></Button>',
      '    <Button><Trash2 /> Delete</Button>',
      '    <Button><Avatar /></Button>',
      '    <Button>{icon}</Button>',
      "    <Button>{busy ? <Eye /> : t('common.save')}</Button>",
      // not judged: a native button, a self-closing Button, a comment
      '    <button><X /></button>',
      '    <Button />',
      '    {/* <Button><X /></Button> */}',
      '  </div>',
      ');',
      '// <Button><Trash2 /></Button>',
    ].join('\n');
    const scan = scanSource('fixture.tsx', fixture);
    expect(scan.iconOnly.filter((j) => !j.named).map((j) => j.icon)).toEqual([
      'X',
      'Trash2',
      'Prev',
      'Lucide.Plus',
      'DensityIcon',
      'EyeOff | Eye',
    ]);
    expect(scan.iconOnly.filter((j) => j.named).map((j) => j.icon)).toEqual(['X', 'X', 'Trash2']);
    // Every `Button` with children is read, icon-only or not; the native and the self-closing one are not.
    expect(scan.buttons).toBe(14);
  });
});
