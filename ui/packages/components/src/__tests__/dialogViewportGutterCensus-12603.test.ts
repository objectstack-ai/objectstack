/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every wide centred dialog reads the ONE shared viewport gutter
 * (objectui#12603).
 *
 * ## The defect, and why it is a census
 *
 * The `DialogContent` primitive draws `w-full max-w-lg`, `fixed`, centred by
 * `left-[50%]` and `translate-x-[-50%]`. A consumer that raises the cap from
 * `sm` up (`sm:max-w-5xl`) leaves nothing to keep a margin below that cap, so
 * the dialog is as wide as the window, at x = 0, edge to edge. objectui#12593
 * repaired `ModalForm` with a gutter of its own; objectui#12603 found the same
 * edge in seven more dialogs and promoted that gutter to one export,
 * `DIALOG_VIEWPORT_GUTTER` (`packages/components/src/custom/dialog-viewport-gutter.ts`).
 * This census is the enumeration pin that card asked for: a new wide dialog
 * that forgets the gutter fails here instead of reaching a window.
 *
 * It lives in `@object-ui/components` because that package owns both the
 * `DialogContent` primitive and the gutter it judges. It is a test in the
 * ordinary suite, ⛔ not a CI gate.
 *
 * ## The population, stated as a rule
 *
 * Every source file under the `src/` tree of a `packages/*` or `apps/*`
 * workspace, minus test and measurement tooling (the `TOOLING` shape the
 * objectui#12143 / #12145 censuses read), whose comment-masked text
 * (`scripts/js-comment-mask.mjs`) names `DialogContent`.
 *
 * ## What it judges
 *
 * A JSX element whose tag ends in `DialogContent` (`DialogContent`,
 * `MobileDialogContent`, `AlertDialogContent`) is a centred dialog. Sheets
 * (`SheetContent`) are edge-anchored by design and never judged, and neither
 * is a `Drawer`. The census reads the element's `className` through the
 * TypeScript AST, following what the same file declares: `cn()` / `clsx()`
 * arguments, conditionals, `&&` / `??`, a same-file `const` (a size map, a
 * ceiling), an indexed map, and a same-file function's `return`s (the record
 * picker's column-count rung). Each string or template literal reached is a
 * UNIT.
 *
 * A unit is WIDE when it carries a breakpoint max width at or above `sm` that
 * a window at that breakpoint cannot hold with 1rem either side: the cap is
 * larger than the breakpoint less 2rem (`sm:` above 608px, `md:` above 736px,
 * `lg:` above 992px, and so on). `sm:max-w-2xl` (672px) is wide;
 * `sm:max-w-xl` (576px) is not, since the narrowest `sm` window (640px) still
 * leaves it 32px a side. A viewport-relative cap below 100 (`sm:max-w-[95vw]`,
 * the `full` size) keeps its own margin and is not wide. A cap the census
 * cannot size (`sm:max-w-[var(--w)]`, `sm:max-w-none`) is wide: it fails
 * closed.
 *
 * A wide unit READS THE GUTTER when it is a template literal that interpolates
 * `DIALOG_VIEWPORT_GUTTER` beside the cap, or when the element's `className`
 * passes `DIALOG_VIEWPORT_GUTTER` unconditionally (a direct `cn()` argument).
 * A gutter literal of a site's own does not count: the rule is one export,
 * not a literal per site.
 *
 * ## ⛔ What this instrument CANNOT see, stated rather than assumed
 *
 *  - A class that arrives from outside the file (a prop, `schema.className`, a
 *    value imported from another module): the census sizes only what the file
 *    itself declares. An author-supplied `className` is the author's.
 *  - An inline `style` width, or a wrapper component that renders a
 *    `DialogContent` under another tag name.
 *  - Whether Tailwind emits the class: that is the console's own CSS build.
 *
 * ## The census, declared
 *
 * `WIDE_SITES` lists every wide centred dialog by file and tag, once per
 * element. Declared and found must agree exactly, so a new wide dialog fails
 * until it reads the gutter and is listed. `OWN_GUTTER` names the sites that
 * keep a viewport gutter of their own and are not yet converged; it takes
 * deletions only.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';
import { DIALOG_VIEWPORT_GUTTER } from '../custom/dialog-viewport-gutter';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/components/src/__tests__ -> repository root
const repoRoot = path.resolve(here, '../../../..');

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const GUTTER_NAME = 'DIALOG_VIEWPORT_GUTTER';

/* -------------------------------------------------------------------------- */
/* The population                                                             */
/* -------------------------------------------------------------------------- */

function workspaceSrcDirs(group: 'packages' | 'apps'): string[] {
  const base = path.join(repoRoot, group);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(base, e.name, 'package.json')))
    .map((e) => `${group}/${e.name}/src`)
    .filter((dir) => existsSync(path.join(repoRoot, dir)));
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', '.turbo', '.next']);
/** Test and measurement tooling never ships; the shape the objectui#12143 census reads. */
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

const sources: string[] = [...workspaceSrcDirs('packages'), ...workspaceSrcDirs('apps')].flatMap((dir) =>
  walk(path.join(repoRoot, dir))
    .map((f) => path.relative(repoRoot, f).split(path.sep).join('/'))
    .filter((rel) => !TOOLING.test(rel)),
);

/* -------------------------------------------------------------------------- */
/* Sizing a class token                                                       */
/* -------------------------------------------------------------------------- */

/** Tailwind's default breakpoints, in px. */
const BREAKPOINT_PX: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
/** Tailwind's default `max-w-*` container scale, in px. */
const MAX_W_SCALE_PX: Record<string, number> = {
  '3xs': 256, '2xs': 288, xs: 320, sm: 384, md: 448, lg: 512, xl: 576,
  '2xl': 672, '3xl': 768, '4xl': 896, '5xl': 1024, '6xl': 1152, '7xl': 1280,
};
/** 1rem either side. */
const GUTTER_PX = 32;

/**
 * The cap a `max-w-*` value sets, in px; `'viewport'` for a viewport-relative
 * cap below 100 that keeps its own margin; `null` when the census cannot size
 * it (judged wide: fail closed).
 */
export function capPx(value: string): number | 'viewport' | null {
  if (value in MAX_W_SCALE_PX) return MAX_W_SCALE_PX[value];
  const arb = /^\[(\d+(?:\.\d+)?)(px|rem|vw|%)\]$/.exec(value);
  if (!arb) return null;
  const n = Number(arb[1]);
  if (arb[2] === 'px') return n;
  if (arb[2] === 'rem') return n * 16;
  return n < 100 ? 'viewport' : null;
}

/** The wide breakpoint caps a unit's text carries, as the tokens themselves. */
export function wideTokens(text: string): string[] {
  const out: string[] = [];
  for (const token of text.split(/\s+/)) {
    const m = /^(sm|md|lg|xl|2xl):max-w-(.+)$/.exec(token);
    if (!m) continue;
    const cap = capPx(m[2]);
    if (cap === 'viewport') continue;
    if (cap === null || cap > BREAKPOINT_PX[m[1]] - GUTTER_PX) out.push(token);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The matcher                                                                */
/* -------------------------------------------------------------------------- */

interface Unit {
  text: string;
  /** A template literal that interpolates the gutter beside its text. */
  carriesGutter: boolean;
}

interface Site {
  file: string;
  tag: string;
  line: number;
  wide: string[];
  readsGutter: boolean;
}

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur) ||
    ts.isNonNullExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

const isGutterRef = (e: ts.Expression): boolean => {
  const u = unwrap(e);
  return ts.isIdentifier(u) && u.text === GUTTER_NAME;
};

export function scanSource(file: string, text: string): { dialogs: number; sites: Site[] } {
  const out = { dialogs: 0, sites: [] as Site[] };
  if (!mask(text).includes('DialogContent')) return out;
  const kind = /\.[cm]?[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);

  // Same-file declarations a className can reach by name.
  const values = new Map<string, ts.Expression>();
  const functions = new Map<string, ts.Node>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        if (!functions.has(node.name.text)) functions.set(node.name.text, init.body);
      } else if (!values.has(node.name.text)) {
        values.set(node.name.text, node.initializer);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body && !functions.has(node.name.text)) {
      functions.set(node.name.text, node.body);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const returnsOf = (body: ts.Node): ts.Expression[] => {
    if (!ts.isBlock(body)) return [body as ts.Expression];
    const found: ts.Expression[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionLike(n) && n !== body.parent) return;
      if (ts.isReturnStatement(n) && n.expression) found.push(n.expression);
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(body, visit);
    return found;
  };

  const unitsOf = (expr: ts.Expression, seen: Set<string>, acc: Unit[]): void => {
    const e = unwrap(expr);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      acc.push({ text: e.text, carriesGutter: false });
    } else if (ts.isTemplateExpression(e)) {
      const text = [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(' ');
      acc.push({ text, carriesGutter: e.templateSpans.some((s) => isGutterRef(s.expression)) });
      for (const s of e.templateSpans) if (!isGutterRef(s.expression)) unitsOf(s.expression, seen, acc);
    } else if (ts.isIdentifier(e)) {
      if (e.text === GUTTER_NAME || seen.has(e.text)) return;
      const next = new Set(seen).add(e.text);
      const v = values.get(e.text);
      if (v) unitsOf(v, next, acc);
    } else if (ts.isCallExpression(e)) {
      const callee = unwrap(e.expression);
      if (ts.isIdentifier(callee) && functions.has(callee.text) && !seen.has(callee.text)) {
        const next = new Set(seen).add(callee.text);
        for (const r of returnsOf(functions.get(callee.text)!)) unitsOf(r, next, acc);
      }
      for (const a of e.arguments) unitsOf(a, seen, acc);
    } else if (ts.isConditionalExpression(e)) {
      unitsOf(e.whenTrue, seen, acc);
      unitsOf(e.whenFalse, seen, acc);
    } else if (ts.isBinaryExpression(e)) {
      unitsOf(e.left, seen, acc);
      unitsOf(e.right, seen, acc);
    } else if (ts.isElementAccessExpression(e)) {
      unitsOf(e.expression, seen, acc);
    } else if (ts.isPropertyAccessExpression(e)) {
      unitsOf(e.expression, seen, acc);
    } else if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) if (!ts.isSpreadElement(el)) unitsOf(el, seen, acc);
    } else if (ts.isObjectLiteralExpression(e)) {
      for (const p of e.properties) if (ts.isPropertyAssignment(p)) unitsOf(p.initializer, seen, acc);
    }
  };

  /** The gutter passed so that it applies whatever else the className picks. */
  const unconditionalGutter = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    if (isGutterRef(e)) return true;
    if (ts.isCallExpression(e)) return e.arguments.some(isGutterRef);
    if (ts.isTemplateExpression(e)) return e.templateSpans.some((s) => isGutterRef(s.expression));
    return false;
  };

  const judge = (tagName: ts.JsxTagNameExpression, attrs: ts.JsxAttributes, at: ts.Node): void => {
    const tag = tagName.getText(sf);
    if (!/DialogContent$/.test(tag.split('.').pop() ?? '')) return;
    out.dialogs += 1;
    const cls = attrs.properties.find(
      (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className',
    );
    if (!cls?.initializer) return;
    const init = cls.initializer;
    const expr = ts.isJsxExpression(init) ? init.expression : (init as ts.Expression);
    if (!expr) return;
    const units: Unit[] = [];
    unitsOf(expr, new Set(), units);
    const wideUnits = units.filter((u) => wideTokens(u.text).length > 0);
    if (wideUnits.length === 0) return;
    const blanket = unconditionalGutter(expr);
    out.sites.push({
      file,
      tag,
      line: sf.getLineAndCharacterOfPosition(at.getStart(sf)).line + 1,
      wide: [...new Set(wideUnits.flatMap((u) => wideTokens(u.text)))],
      readsGutter: blanket || wideUnits.every((u) => u.carriesGutter),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) judge(node.openingElement.tagName, node.openingElement.attributes, node);
    else if (ts.isJsxSelfClosingElement(node)) judge(node.tagName, node.attributes, node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const scans = sources.map((rel) => scanSource(rel, readFileSync(path.join(repoRoot, rel), 'utf8')));
const dialogCount = scans.reduce((n, s) => n + s.dialogs, 0);
const sites: Site[] = scans.flatMap((s) => s.sites);

/* -------------------------------------------------------------------------- */
/* The declared census — file · tag, once per element                         */
/* -------------------------------------------------------------------------- */

/**
 * Every wide centred dialog, by file and tag, once per element. Cited by
 * content, never by line. A new wide dialog fails until it reads the gutter
 * and is added here; a dialog that narrows leaves in the same commit.
 */
const WIDE_SITES: Array<[file: string, tags: string[]]> = [
  ['packages/app-shell/src/hooks/useActionModal.tsx', ['DialogContent']],
  ['packages/app-shell/src/views/ActionParamDialog.tsx', ['DialogContent']],
  ['packages/app-shell/src/views/FlowRunner.tsx', ['DialogContent']],
  ['packages/app-shell/src/views/metadata-admin/CelTestRunDialog.tsx', ['DialogContent']],
  ['packages/components/src/custom/fullscreen-editor.tsx', ['DialogContent']],
  ['packages/components/src/custom/navigation-overlay.tsx', ['DialogContent']],
  ['packages/fields/src/widgets/ImageLightbox.tsx', ['DialogContent']],
  ['packages/fields/src/widgets/RecordPickerDialog.tsx', ['DialogContent']],
  ['packages/plugin-form/src/ModalForm.tsx', ['MobileDialogContent', 'MobileDialogContent']],
  ['packages/plugin-grid/src/ImportWizard.tsx', ['DialogContent']],
];

/**
 * Wide dialogs that keep a viewport gutter of their own instead of the shared
 * export. Deletions only: converging one removes it from here.
 *
 *  - `navigation-overlay.tsx`'s modal mode draws `w-[calc(100vw-1rem)]` under
 *    a host-set `--ov-w` cap (default 42rem): never edge to edge, but a 0.5rem
 *    literal of its own. It was outside objectui#12603's enumeration and file
 *    surface.
 */
const OWN_GUTTER: ReadonlySet<string> = new Set(['packages/components/src/custom/navigation-overlay.tsx · DialogContent']);

function tally(entries: Array<{ file: string; tag: string }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const { file, tag } of entries) {
    const k = `${file} · ${tag}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

const declared = tally(WIDE_SITES.flatMap(([file, tags]) => tags.map((tag) => ({ file, tag }))));
const found = tally(sites);

describe('every wide centred dialog reads the shared viewport gutter (objectui#12603)', () => {
  it('the gutter is the one class objectui#12593 measured', () => {
    expect(DIALOG_VIEWPORT_GUTTER).toBe('sm:w-[calc(100%-2rem)]');
  });

  it('the census reads a real population', () => {
    // Floors, not counts: a matcher that stops seeing dialogs reads as a pass
    // over nothing, so the population has to be visibly there.
    expect(sources.length).toBeGreaterThan(500);
    expect(dialogCount).toBeGreaterThan(WIDE_SITES.length);
  });

  it('sizes caps the way a window at that breakpoint sees them', () => {
    expect(wideTokens('sm:max-w-2xl')).toEqual(['sm:max-w-2xl']);
    expect(wideTokens('sm:max-w-xl')).toEqual([]);
    expect(wideTokens('sm:max-w-[560px]')).toEqual([]);
    expect(wideTokens('sm:max-w-[1100px]')).toEqual(['sm:max-w-[1100px]']);
    expect(wideTokens('lg:max-w-4xl')).toEqual([]);
    expect(wideTokens('lg:max-w-5xl')).toEqual(['lg:max-w-5xl']);
    // CONTROL: the `full` size keeps its own viewport margin.
    expect(wideTokens('sm:max-w-[95vw] sm:w-full')).toEqual([]);
    // Unsizable caps fail closed.
    expect(wideTokens('sm:max-w-[var(--ov-w,42rem)]')).toEqual(['sm:max-w-[var(--ov-w,42rem)]']);
    // Below `sm` is the phone sheet: an unprefixed cap is not judged.
    expect(wideTokens('max-w-[98vw] max-w-5xl')).toEqual([]);
  });

  it('a wide cap without the shared gutter is a finding, with it is not', () => {
    const bare = scanSource('probe.tsx', `const A = () => <DialogContent className="sm:max-w-3xl" />;`);
    expect(bare.sites.map((s) => s.readsGutter)).toEqual([false]);
    const own = scanSource(
      'probe.tsx',
      `const A = () => <DialogContent className="sm:max-w-3xl sm:w-[calc(100%-2rem)]" />;`,
    );
    expect(own.sites.map((s) => s.readsGutter)).toEqual([false]);
    const paired = scanSource(
      'probe.tsx',
      `const A = () => <DialogContent className={\`sm:max-w-3xl \${DIALOG_VIEWPORT_GUTTER}\`} />;`,
    );
    expect(paired.sites.map((s) => s.readsGutter)).toEqual([true]);
    // A map entry: the wide entry must carry it itself.
    const mapped = scanSource(
      'probe.tsx',
      `const M = { a: 'sm:max-w-lg', b: \`sm:max-w-5xl \${DIALOG_VIEWPORT_GUTTER}\`, c: 'sm:max-w-4xl' };
       const A = ({ k }) => <DialogContent className={cn(M[k])} />;`,
    );
    expect(mapped.sites.map((s) => s.readsGutter)).toEqual([false]);
    // Unconditional: one direct `cn()` argument covers every rung.
    const blanket = scanSource(
      'probe.tsx',
      `function w(n) { return n > 3 ? 'sm:max-w-3xl lg:max-w-5xl' : 'sm:max-w-xl'; }
       const A = ({ n }) => <DialogContent className={cn('flex', DIALOG_VIEWPORT_GUTTER, w(n))} />;`,
    );
    expect(blanket.sites.map((s) => s.readsGutter)).toEqual([true]);
    // CONTROL: sheets are edge-anchored and never judged.
    const sheet = scanSource('probe.tsx', `const A = () => <SheetContent className="sm:max-w-3xl" />;`);
    expect(sheet.sites).toEqual([]);
  });

  it('declared and found agree: every wide dialog is listed', () => {
    expect([...found.entries()].sort()).toEqual([...declared.entries()].sort());
  });

  it('every listed wide dialog reads the shared gutter', () => {
    const missing = sites
      .filter((s) => !s.readsGutter && !OWN_GUTTER.has(`${s.file} · ${s.tag}`))
      .map((s) => `${s.file} · ${s.tag} · ${s.wide.join(' ')}`);
    expect(missing).toEqual([]);
  });

  it('OWN_GUTTER takes deletions only: each entry is still a wide site without the shared gutter', () => {
    for (const key of OWN_GUTTER) {
      const hit = sites.find((s) => `${s.file} · ${s.tag}` === key);
      expect(hit, key).toBeDefined();
      expect(hit!.readsGutter, key).toBe(false);
    }
  });
});
