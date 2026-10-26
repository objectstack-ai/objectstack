/**
 * ONE enumeration of the ADR-0080 browser preview harnesses, and ONE extractor
 * for the page `source` strings inside them — shared by every test that holds
 * those sources to a rule.
 *
 * WHY IT IS SHARED (objectui#5944). The value of the enumeration is that "a new
 * harness appears without anyone remembering to add it". Two copies of it
 * cannot deliver that: the day they disagree about what counts as a preview
 * page, one of them silently stops covering a harness and still reports green.
 * `sdui-preview-page-source-styling.test.ts` (objectui#5470) and
 * `sdui-preview-page-source-query-params.test.ts` (objectui#5944) both read
 * from here.
 *
 * WHY VITE AND NOT `node:fs`. This app's tsconfig is browser-only (`lib: ES2020,
 * DOM`, `types` without `node`), so a `node:fs` import passes under Vitest and
 * fails the console's `tsc` — the trap `insecure-origin-crypto.placement.test.ts`
 * records. `import.meta.glob` is expanded by Vite against the real directory at
 * transform time, which is also what makes the enumeration self-maintaining.
 *
 * WHY AN AST AND NOT A REGEX. A page `source` is a template literal, and its
 * RAW text is not the string the page actually gets: `sdui-workbench-preview`
 * writes its folder glyph as `\u{1F5C2}`, which cooks to one character but, read
 * raw, is JSX text followed by an expression container — `{1F5C2}` — that no JS
 * parser accepts. A consumer that parses the extracted source (objectui#5944)
 * would therefore hit a fatal parse error on exactly the harness the gate exists
 * for, and a gate that cannot parse its subject reports nothing. So the template
 * literal is read off the parsed harness and its COOKED value is returned.
 */
import tseslint from 'typescript-eslint';

export interface HarnessPage {
  kind: string;
  name: string;
  /** The page source as the page really receives it — escapes cooked. */
  source: string;
}

/** The harness files as TEXT, keyed `../../<file>` by Vite. */
const harnessModules = import.meta.glob('../../*-preview.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every `*-preview.tsx` in `apps/console/src`, by bare filename, sorted. */
export const previewHarnessFiles: string[] = Object.keys(harnessModules)
  .map((key) => key.slice(key.lastIndexOf('/') + 1))
  .sort();

/**
 * The text of one harness. A missing key means the file was renamed or the glob
 * stopped matching — fail loudly rather than hand back an empty string, which
 * reads exactly like a clean file.
 */
export function readHarness(file: string): string {
  const text = harnessModules[`../../${file}`];
  if (typeof text !== 'string') {
    throw new Error(
      `${file} is not in the preview-harness glob (found: ${previewHarnessFiles.join(', ')})`,
    );
  }
  return text;
}

/**
 * `typescript-eslint` exports its parser typed as a minimal COMPATIBILITY SHIM —
 * `parseForESLint(text: string): { ast: unknown; scopeManager: unknown }` — which
 * hides both the real `@typescript-eslint/parser` signature (`(code,
 * parserOptions)`) and the AST type. Importing `@typescript-eslint/parser`
 * directly to get the real declarations would be a phantom dependency: nothing
 * in this workspace declares it, it is only a transitive one
 * (`scripts/check-phantom-dependencies.mjs`). So the signature is restated here,
 * at the one boundary that needs it, and everything downstream still trusts no
 * more than `unknown`.
 */
interface PreviewHarnessParser {
  parseForESLint(
    text: string,
    options: {
      sourceType: 'module';
      ecmaVersion: 'latest';
      ecmaFeatures: { jsx: boolean };
    },
  ): { ast: unknown };
}

const harnessParser = tseslint.parser as unknown as PreviewHarnessParser;

type Node = Record<string, unknown> & { type: string };

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
  );
}

function walk(value: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!isNode(value)) return;
  visit(value);
  for (const key of Object.keys(value)) {
    if (key === 'parent') continue;
    const child = value[key];
    if (child && typeof child === 'object') walk(child, visit);
  }
}

/**
 * The cooked value of a template literal that carries no interpolation.
 * Anything else is a shape this extractor has never seen and must not guess at.
 */
function cookedTemplate(node: Node, what: string): string {
  const expressions = node.expressions as unknown[];
  if (expressions.length > 0) {
    throw new Error(`${what}: page source template literal interpolates — extractor cannot resolve it`);
  }
  const quasis = node.quasis as Array<{ value: { cooked?: string | null } }>;
  const cooked = quasis[0]?.value?.cooked;
  if (typeof cooked !== 'string') {
    throw new Error(`${what}: page source template literal has no cooked value`);
  }
  return cooked;
}

function staticKey(property: Node): string | null {
  if (property.type !== 'Property' || property.computed === true) return null;
  const key = property.key as Node;
  if (key.type === 'Identifier') return key.name as string;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

/**
 * Every page object in a harness — an object literal carrying both `kind` and
 * `source`, with the source resolved to the cooked text of the template literal
 * it names (or of an inline template literal).
 *
 * Deliberately throws rather than skipping when a page's source cannot be
 * resolved: an extractor that silently finds zero pages is indistinguishable
 * from a clean file, which is the exact way a count-based guard rots
 * (objectui#5470 — that card's own 79 was a whole-file `grep -c`, i.e. LINES,
 * harness JSX included; the rule's own count over the source strings is 95).
 */
export function pagesOf(text: string, label = 'harness'): HarnessPage[] {
  const { ast } = harnessParser.parseForESLint(text, {
    sourceType: 'module',
    ecmaVersion: 'latest',
    ecmaFeatures: { jsx: true },
  });

  // Pass 1: `const <name> = \`…\`` — the shape every harness uses today.
  const templates = new Map<string, string>();
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    const id = node.id as Node;
    const init = node.init as Node | null;
    if (id.type !== 'Identifier' || !init || init.type !== 'TemplateLiteral') return;
    templates.set(id.name as string, cookedTemplate(init, `${label} const ${String(id.name)}`));
  });

  // Pass 2: the page objects.
  const pages: HarnessPage[] = [];
  walk(ast, (node) => {
    if (node.type !== 'ObjectExpression') return;
    const props = new Map<string, Node>();
    for (const property of node.properties as Node[]) {
      const key = staticKey(property);
      if (key !== null) props.set(key, property);
    }
    const kindProp = props.get('kind');
    const sourceProp = props.get('source');
    if (!kindProp || !sourceProp) return;

    const kindValue = kindProp.value as Node;
    if (kindValue.type !== 'Literal' || typeof kindValue.value !== 'string') return;

    const sourceValue = sourceProp.value as Node;
    let identifier: string | null = null;
    let source: string | null = null;
    if (sourceValue.type === 'Identifier') {
      identifier = sourceValue.name as string;
      source = templates.get(identifier) ?? null;
    } else if (sourceValue.type === 'TemplateLiteral') {
      source = cookedTemplate(sourceValue, `${label} inline source`);
    }
    if (source === null) {
      throw new Error(
        `${label}: page kind:'${kindValue.value}' has a \`source\` this extractor cannot resolve`
        + ` (${identifier ? `identifier \`${identifier}\` is not a template-literal const` : `it is a ${sourceValue.type}`}).`,
      );
    }

    const nameValue = props.get('name')?.value as Node | undefined;
    const name = nameValue && nameValue.type === 'Literal' && typeof nameValue.value === 'string'
      ? nameValue.value
      : identifier ?? '(unnamed)';
    pages.push({ kind: kindValue.value, name, source });
  });
  return pages;
}
