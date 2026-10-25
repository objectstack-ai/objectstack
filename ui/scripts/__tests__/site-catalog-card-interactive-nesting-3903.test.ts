import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * objectui#3903 — the docs site must never nest a schema preview inside an
 * interactive control.
 *
 * The defect: `SchemaCatalogIndex` rendered every gallery card as a `button`
 * and embedded `SchemaThumbnail` inside it. `SchemaThumbnail` renders the
 * example itself through a real `SchemaRenderer`, and 85 of the catalog
 * examples contain `"type": "button"` nodes — so `/docs/guide/schema-catalog`
 * shipped `button` inside `button` for a fifth of the gallery. React classifies
 * that as a hydration error, not a style nit: the HTML parser RESTRUCTURES
 * nested buttons (the inner one is hoisted out of the outer), so the server
 * HTML and the client tree disagree. It is also an accessibility defect on its
 * own — an interactive control inside an interactive control has undefined
 * keyboard and screen-reader behaviour.
 *
 * Why a static check rather than a render test: `apps/site` has no Vitest
 * project (the root config excludes `apps/**` and only `apps/console` is
 * registered), and the defect's shape is structural — a preview host sitting in
 * the subtree of a control. `scripts/__tests__/site-playground-layout-registration-3904.test.ts`
 * established the same altitude for the same app. The behavioural half (zero
 * "cannot be a descendant of" console errors on the live page) is browser
 * evidence on the PR; this file is the cheap mechanical version that runs in CI
 * on every shard.
 *
 * Pinned by DISCOVERY, not by a hardcoded file list: the bug was one card shell
 * nobody thought about, and a second host added tomorrow is caught the same way.
 *
 * Reverse verification (direction predicted before running, plain RED both
 * ways, and both were measured):
 *  - restore the `button` card shell in `SchemaCatalogIndex.tsx` and
 *    `finds no schema preview nested inside an interactive control` fails,
 *    naming that file and `SchemaThumbnail`;
 *  - drop `inert` from the scaled preview wrapper in `SchemaThumbnail.tsx` and
 *    the last suite fails.
 *
 * Deliberately NOT in scope: nesting that only exists through a component
 * boundary (a shell component that renders a `button` internally). This walker
 * reads one file's JSX tree, which is the shape the defect had and the shape a
 * regression would have. Whole-graph interactivity analysis is a different,
 * much more expensive tool.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE_APP_DIR = path.join(repoRoot, 'apps/site/app');

/**
 * Components that render UNKNOWN catalog schema, i.e. whose output may contain
 * interactive nodes. None of them may appear inside a control.
 */
const SCHEMA_PREVIEW_HOSTS = new Set([
  'SchemaRenderer',
  'SchemaThumbnail',
  'InteractiveDemo',
  'LiveSplitDemo',
  'SchemaExample',
]);

/** Intrinsic elements that are interactive controls in their own right. */
const CONTROL_TAGS = new Set(['button']);

const SOURCE_FILE = /\.tsx$/;

interface Violation {
  /** Repo-relative file. */
  file: string;
  /** 1-based line of the nested element. */
  line: number;
  /** Tag name of the nested element. */
  child: string;
  /** Tag name of the enclosing control. */
  control: string;
  /** 1-based line of the enclosing control. */
  controlLine: number;
}

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

function openingElement(node: JsxNode): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function tagNameOf(node: JsxNode, sf: ts.SourceFile): string {
  const name = openingElement(node).tagName;
  return ts.isIdentifier(name) ? name.text : name.getText(sf);
}

function attributes(node: JsxNode): ts.JsxAttribute[] {
  return openingElement(node).attributes.properties.filter((p): p is ts.JsxAttribute =>
    ts.isJsxAttribute(p)
  );
}

function attributeName(attr: ts.JsxAttribute): string {
  return ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText();
}

/** Literal text of a string-valued attribute (`x="y"` and `x={'y'}` both). */
function stringAttr(node: JsxNode, attrName: string): string | undefined {
  for (const attr of attributes(node)) {
    if (attributeName(attr) !== attrName) continue;
    const init = attr.initializer;
    if (!init) continue;
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) {
      return init.expression.text;
    }
  }
  return undefined;
}

function hasAttr(node: JsxNode, attrName: string): boolean {
  return attributes(node).some((attr) => attributeName(attr) === attrName);
}

/**
 * A control is a `button` element, or anything wearing `role="button"` — the
 * `div role="button"` rewrite is the OTHER way to keep this bug (the issue says
 * so explicitly), so the rule has to see it too.
 */
function isControl(node: JsxNode, sf: ts.SourceFile): boolean {
  return CONTROL_TAGS.has(tagNameOf(node, sf)) || stringAttr(node, 'role') === 'button';
}

function lineOf(node: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function parse(fileLabel: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileLabel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * Walk one file's JSX trees, reporting every schema-preview host and every
 * nested `button` that has a control among its JSX ancestors.
 */
function findViolations(fileLabel: string, source: string): Violation[] {
  const sf = parse(fileLabel, source);
  const found: Violation[] = [];
  /** Enclosing controls, innermost last. */
  const controls: JsxNode[] = [];

  const visit = (node: ts.Node): void => {
    const jsx = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) ? (node as JsxNode) : null;

    if (jsx) {
      const tag = tagNameOf(jsx, sf);
      const enclosing = controls[controls.length - 1];
      if (enclosing && (SCHEMA_PREVIEW_HOSTS.has(tag) || CONTROL_TAGS.has(tag))) {
        found.push({
          file: fileLabel,
          line: lineOf(jsx, sf),
          child: tag,
          control: tagNameOf(enclosing, sf),
          controlLine: lineOf(enclosing, sf),
        });
      }
      if (isControl(jsx, sf)) controls.push(jsx);
    }

    ts.forEachChild(node, visit);

    if (jsx && isControl(jsx, sf)) controls.pop();
  };

  visit(sf);
  return found;
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(abs));
    else if (SOURCE_FILE.test(entry.name)) out.push(abs);
  }
  return out;
}

function siteTsxFiles(): string[] {
  return collectSourceFiles(SITE_APP_DIR)
    .map((abs) => path.relative(repoRoot, abs))
    .sort();
}

const CARD_FILE = 'apps/site/app/components/SchemaCatalogIndex.tsx';
const THUMBNAIL_FILE = 'apps/site/app/components/SchemaThumbnail.tsx';

describe('objectui#3903 — the walker detects the nesting it is meant to detect', () => {
  /**
   * Without this suite the real check below is a rule of unknown power: a
   * walker that silently reports nothing passes over a healthy tree exactly the
   * way it passes over a broken one. Sample 1 is the shape `main` shipped.
   */
  it('flags the pre-fix card shell (button wrapping the thumbnail)', () => {
    const violations = findViolations(
      'sample-prefix.tsx',
      [
        'export const Card = () => (',
        '  <button type="button" onClick={open}>',
        '    <SchemaThumbnail schema={entry.schema} />',
        '    <div>{entry.meta.title}</div>',
        '  </button>',
        ');',
      ].join('\n')
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ child: 'SchemaThumbnail', control: 'button', line: 3 });
  });

  it('flags a literal button inside a button', () => {
    const violations = findViolations(
      'sample-nested-button.tsx',
      ['export const X = () => (', '  <button>', '    <button>inner</button>', '  </button>', ');'].join(
        '\n'
      )
    );

    expect(violations.map((v) => v.child)).toEqual(['button']);
  });

  it('flags the div role="button" rewrite as well, which the issue warns against', () => {
    const violations = findViolations(
      'sample-role-button.tsx',
      [
        'export const X = () => (',
        '  <div role="button" tabIndex={0} onClick={open}>',
        '    <SchemaThumbnail schema={s} />',
        '  </div>',
        ');',
      ].join('\n')
    );

    expect(violations.map((v) => v.child)).toEqual(['SchemaThumbnail']);
  });

  it('accepts the overlay shape: preview and click target as SIBLINGS', () => {
    const violations = findViolations(
      'sample-overlay.tsx',
      [
        'export const Card = () => (',
        '  <div className="relative">',
        '    <SchemaThumbnail schema={entry.schema} />',
        '    <div>{entry.meta.title}</div>',
        '    <button type="button" className="absolute inset-0" aria-label={name} onClick={open} />',
        '  </div>',
        ');',
      ].join('\n')
    );

    expect(violations).toEqual([]);
  });
});

describe('objectui#3903 — no apps/site schema preview sits inside an interactive control', () => {
  const files = siteTsxFiles();

  it('discovers the site tree at all (a zero-hit scan would be vacuously green)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files).toContain(CARD_FILE);
  });

  it('the catalog index really does render a preview AND a button, so it is in scope', () => {
    // The other half of the empty-fixture guard: if the card ever stops
    // embedding a preview host, or stops having a click target, the sweep below
    // would go green over a file that no longer exercises the rule — and the
    // page would be broken in a different way.
    const source = fs.readFileSync(path.join(repoRoot, CARD_FILE), 'utf8');
    const sf = parse(CARD_FILE, source);
    const tags: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        tags.push(tagNameOf(node as JsxNode, sf));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    expect(tags).toContain('SchemaThumbnail');
    expect(tags).toContain('button');
  });

  it('finds no schema preview nested inside an interactive control', () => {
    const violations = files.flatMap((file) =>
      findViolations(file, fs.readFileSync(path.join(repoRoot, file), 'utf8'))
    );

    expect(
      violations.map((v) => `${v.file}:${v.line} ${v.child} inside <${v.control} > at line ${v.controlLine}`),
      'A schema preview renders whatever the example JSON says, and 85 catalog examples contain ' +
        'button nodes — inside a control that is a React hydration error plus an accessibility ' +
        'defect (objectui#3903). Keep the shell non-interactive and make the click target an ' +
        'absolutely positioned button SIBLING with an aria-label naming the example.'
    ).toEqual([]);
  });
});

describe('objectui#3903 — the thumbnail preview is inert, not merely unclickable', () => {
  /**
   * The overlay fix alone leaves the preview's own controls FOCUSABLE, and the
   * thumbnail frame is `aria-hidden` — a focusable node inside `aria-hidden` is
   * itself a violation (axe `aria-hidden-focus`), and because the preview
   * precedes the overlay in DOM order, a keyboard user would tab through every
   * example's internal buttons before reaching the card's own open button.
   * `inert` is what makes SchemaThumbnail's documented contract ("scaled,
   * non-interactive preview") true; `pointer-events: none` only ever covered
   * the mouse.
   */
  const source = fs.readFileSync(path.join(repoRoot, THUMBNAIL_FILE), 'utf8');
  const sf = parse(THUMBNAIL_FILE, source);

  function ancestorsOfRenderer(): JsxNode[][] {
    const chains: JsxNode[][] = [];
    const stack: JsxNode[] = [];
    const visit = (node: ts.Node): void => {
      const jsx =
        ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) ? (node as JsxNode) : null;
      if (jsx) {
        if (tagNameOf(jsx, sf) === 'SchemaRenderer') chains.push([...stack]);
        stack.push(jsx);
      }
      ts.forEachChild(node, visit);
      if (jsx) stack.pop();
    };
    visit(sf);
    return chains;
  }

  const chains = ancestorsOfRenderer();

  it('renders a SchemaRenderer at all', () => {
    expect(chains.length).toBeGreaterThan(0);
  });

  chains.forEach((chain, i) => {
    it(`SchemaRenderer #${i} is wrapped in an inert, pointer-events-none subtree`, () => {
      const inert = chain.filter((n) => hasAttr(n, 'inert'));
      expect(
        inert.length,
        `no ancestor of the SchemaRenderer in ${THUMBNAIL_FILE} carries inert, so the preview's own ` +
          'controls stay focusable inside an aria-hidden frame and sit ahead of the card button in ' +
          'tab order (objectui#3903)'
      ).toBeGreaterThan(0);

      const unclickable = chain.filter((n) =>
        (stringAttr(n, 'className') ?? '').includes('pointer-events-none')
      );
      expect(
        unclickable.length,
        `no ancestor of the SchemaRenderer in ${THUMBNAIL_FILE} carries pointer-events-none`
      ).toBeGreaterThan(0);
    });
  });
});
