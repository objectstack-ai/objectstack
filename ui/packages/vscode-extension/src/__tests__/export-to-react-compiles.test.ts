/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7862 — COMPILES the file the `Export to React` command hands a user,
 * rather than reading substrings out of the generator that writes it.
 *
 * WHY A COMPILE AND NOT A SECOND SOURCE-TEXT PIN. The sibling pin
 * (`export-to-react-preamble.test.ts`, objectui#7837) asserts that named
 * strings are present or absent in the template. That instrument can only ever
 * catch the defects someone already thought to name: it was green for the whole
 * life of `import React from 'react'`, a line it never mentions, and it would be
 * green for the next line added to the preamble too. The preamble lives inside a
 * TEMPLATE LITERAL, so this package's `tsc --noEmit` sees one string, `tsup`
 * copies it through, and no doc gate's scan surface reaches this file. Compiling
 * the product closes the whole class instead of one member of it: any preamble
 * line that does not type-check — an unused binding, a syntax error, a JSX shape
 * the renderer does not accept — fails here without anyone having predicted it.
 *
 * THE DEFECT THIS WAS BUILT FOR. `generateReactComponent()` opened every file
 * with `import React from 'react'` while the only JSX in the file is one
 * SchemaRenderer element. Under the automatic runtime (`"jsx": "react-jsx"`,
 * what a new Vite or Next project is configured with) the identifier is never
 * read, so a consumer compiling with `noUnusedLocals: true` got
 * `TS6133: 'React' is declared but its value is never read` on the file the
 * command had just handed them.
 *
 * WHY THE MODULE STUBS ARE HERMETIC, NOT THE REAL `dist/index.d.ts`. The card
 * took its readings against the built declarations of `@object-ui/react` and
 * `@object-ui/components`. A TEST cannot: `.github/workflows/ci.yml` runs the
 * test job as `pnpm install --frozen-lockfile` followed by `pnpm test`, with no
 * build step between them, so both `dist/` trees are ABSENT there. Resolving to
 * them would make this file emit a TS2307 storm in CI — a red test that reports
 * a missing build rather than a defect in the template, which is the worst kind
 * of pin. The property under test is a property of the emitted TEXT — does the
 * preamble declare a binding no line of the file reads — and that is decided by
 * the compiler with any declaration for those specifiers. Import SHAPE against
 * the real packages stays the sibling pin's job; the two are complementary.
 *
 * WHY THE EXTRACTION IS DUPLICATED FROM THE SIBLING PIN. A shared helper would
 * have to be a non-`.test.ts` file under `src/`: `tsconfig.test.json` includes
 * only the `.test.ts` files under `src/`, so the helper would go unchecked,
 * while `tsconfig.json` excludes only those same files, so it WOULD land in the
 * build program and ship inside the `.vsix`. Twenty duplicated lines cost less.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const EXTENSION_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../extension.ts'),
  'utf8'
);

/** The one interpolation `generateReactComponent()` performs. */
const INTERPOLATION = '${schemaJson}';

/** A schema shaped like the `empty` template the extension itself ships. */
const SAMPLE_SCHEMA = JSON.stringify(
  {
    type: 'div',
    className: 'p-4',
    body: { type: 'text', content: 'Hello Object UI!' },
  },
  null,
  2
);

/**
 * The exact text a user receives — the template literal's body with the schema
 * interpolated, i.e. the PRODUCT, not the generator.
 *
 * Every failure mode throws with "this pin needs rewriting, not deleting": if
 * the generator is refactored, the pin has to be pointed at the new shape, and
 * an assertion that silently stops reading the real thing is exactly the
 * failure this file exists to stop.
 */
function generatedFile(): string {
  const fn = EXTENSION_SRC.indexOf('function generateReactComponent');
  if (fn < 0) {
    throw new Error(
      'generateReactComponent() is gone from extension.ts — this pin needs rewriting, not deleting.'
    );
  }
  const open = EXTENSION_SRC.indexOf('return `', fn);
  if (open < 0) {
    throw new Error(
      'generateReactComponent() no longer returns a template literal — this pin needs rewriting, not deleting.'
    );
  }
  const start = open + 'return `'.length;
  const close = EXTENSION_SRC.indexOf('`;', start);
  if (close < 0) {
    throw new Error(
      'unterminated template literal in generateReactComponent() — this pin needs rewriting, not deleting.'
    );
  }
  const template = EXTENSION_SRC.slice(start, close);

  // A backslash escape means the source text and the evaluated product differ,
  // and this extractor would compile something the user never receives. Refuse
  // rather than guess.
  if (template.includes('\\')) {
    throw new Error(
      'the template literal now contains a backslash escape, so slicing the source no longer yields the emitted text — this pin needs rewriting, not deleting.'
    );
  }
  const interpolations = template.match(/\$\{[^}]*\}/g) ?? [];
  if (interpolations.length !== 1 || interpolations[0] !== INTERPOLATION) {
    throw new Error(
      `expected exactly one ${INTERPOLATION} interpolation, found ${JSON.stringify(interpolations)} — this pin needs rewriting, not deleting.`
    );
  }
  return template.replace(INTERPOLATION, SAMPLE_SCHEMA);
}

/**
 * Minimal declarations for the four specifiers the generated file names. See
 * the header: the real `dist/` trees do not exist in the CI job that runs this.
 */
const STUB_DECLARATIONS = `
declare module 'react/jsx-runtime' {
  export namespace JSX {
    interface Element { readonly __brand: unique symbol }
    interface ElementAttributesProperty { props: object }
    interface ElementChildrenAttribute { children: object }
    interface IntrinsicElements { [name: string]: Record<string, unknown> }
  }
  export const Fragment: unknown;
  export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element;
  export function jsxs(type: unknown, props: unknown, key?: unknown): JSX.Element;
}
declare module 'react' {
  const React: { createElement(...args: unknown[]): unknown };
  export default React;
}
declare module '@object-ui/react' {
  import type { JSX } from 'react/jsx-runtime';
  export interface SchemaRendererProps { schema: unknown }
  export function SchemaRenderer(props: SchemaRendererProps): JSX.Element;
}
declare module '@object-ui/components' {}
`;

const GENERATED_PATH = '/objectui-7862/Generated.tsx';
const STUB_PATH = '/objectui-7862/stubs.d.ts';

/**
 * objectui#12405 — parsed ON-DISK source files, shared by every program this
 * file builds with the same options. The real-prop leg below reaches
 * `@object-ui/types` from source, which pulls about 280 files (its `src`, the
 * `@objectstack/spec` declarations it imports, `lib.dom.d.ts`) into each
 * program; measured on this branch, parsing them was ~2.7 s of the ~6.5 s
 * each of that leg's two compiles cost, and both compiles parsed the identical
 * files. Only the parse is shared: each compile still builds its own program
 * and its own checker, so a diagnostic is still the verdict of a whole fresh
 * compile of that candidate. Keyed by the options too, because binding a file
 * can depend on them; the text is re-read and compared, so an edited file is
 * never served stale.
 */
const ON_DISK_SOURCE_FILES = new Map<string, ts.SourceFile>();

/**
 * Compile one candidate file and return its diagnostics, formatted.
 *
 * `stubs` replaces the module declarations above (objectui#11515's real-type
 * leg below passes its own). `onlyGenerated` reports the generated file's
 * diagnostics alone: that leg reads real source trees, whose own diagnostics
 * under these options are not this pin's question.
 */
function compile(
  source: string,
  overrides: ts.CompilerOptions = {},
  stubs: string = STUB_DECLARATIONS,
  onlyGenerated = false
): string[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2020.d.ts'],
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    // The two options this pin exists for: a preamble line nothing reads is
    // exactly what `noUnusedLocals` reports, and it is the setting the card's
    // consumer had on.
    noUnusedLocals: true,
    noUnusedParameters: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    ...overrides,
  };

  const virtual = new Map<string, string>([
    [GENERATED_PATH, source],
    [STUB_PATH, stubs],
  ]);
  const read = (fileName: string): string | undefined =>
    virtual.get(fileName) ??
    (existsSync(fileName) ? readFileSync(fileName, 'utf8') : undefined);

  const optionsKey = JSON.stringify(options);
  const libDirectory = dirname(ts.getDefaultLibFilePath(options));
  const host: ts.CompilerHost = {
    fileExists: (fileName) => virtual.has(fileName) || existsSync(fileName),
    readFile: read,
    getSourceFile: (fileName, languageVersion) => {
      const text = read(fileName);
      if (text === undefined) return undefined;
      // The candidate and its stubs are parsed fresh every time: they are the
      // input under test. An ON-DISK file is parsed once per (options, file):
      // see ON_DISK_SOURCE_FILES.
      if (virtual.has(fileName)) {
        return ts.createSourceFile(fileName, text, languageVersion, true);
      }
      const key = `${optionsKey}|${JSON.stringify(languageVersion)}|${fileName}`;
      const cached = ON_DISK_SOURCE_FILES.get(key);
      if (cached && cached.text === text) return cached;
      const parsed = ts.createSourceFile(fileName, text, languageVersion, true);
      ON_DISK_SOURCE_FILES.set(key, parsed);
      return parsed;
    },
    getDefaultLibFileName: () => join(libDirectory, 'lib.es2020.d.ts'),
    getDefaultLibLocation: () => libDirectory,
    writeFile: () => undefined,
    getCurrentDirectory: () => '/objectui-7862',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };

  const program = ts.createProgram([STUB_PATH, GENERATED_PATH], options, host);
  const generated = program.getSourceFile(GENERATED_PATH);
  const diagnostics =
    onlyGenerated && generated
      ? [
          ...program.getOptionsDiagnostics(),
          ...program.getSyntacticDiagnostics(generated),
          ...program.getSemanticDiagnostics(generated),
        ]
      : ts.getPreEmitDiagnostics(program);
  return diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start
      );
      return `${diagnostic.file.fileName}(${line + 1},${character + 1}): error TS${diagnostic.code}: ${message}`;
    }
    return `error TS${diagnostic.code}: ${message}`;
  });
}

describe('Export to React — the file the command hands the user (objectui#7862)', () => {
  it('compiles clean under the automatic JSX runtime with noUnusedLocals', () => {
    // The whole point: an assertion on the PRODUCT, so a preamble line nobody
    // predicted still has to type-check.
    expect(compile(generatedFile())).toEqual([]);
  });

  it('is a harness that can fail — putting the import back reports TS6133', () => {
    // The positive control, executed on every run rather than once by hand: if
    // the stubs, options or host ever stop reaching the compiler, THIS goes red
    // instead of the pin above going quietly, permanently green.
    const withUnusedImport = `import React from 'react';\n${generatedFile()}`;
    const diagnostics = compile(withUnusedImport);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(
      "error TS6133: 'React' is declared but its value is never read."
    );
  });

  it('records the cost of dropping the import: the classic transform needs it back', () => {
    // objectui#7862 chose the automatic runtime deliberately. This is what the
    // choice costs the classic `"jsx": "react"` transform, kept measurable so a
    // future reversal argues with a reading rather than a recollection.
    //
    // The assertion is on the SUBSTANCE — one diagnostic, about `React` — and
    // not on a code, because the code depends on what declares `react`. Both
    // were measured on this branch under TypeScript 6.0.3: against the real
    // `@types/react`, whose UMD global declaration is in scope, it is
    // `TS2686: 'React' refers to a UMD global, but the current file is a
    // module`; against the hermetic stubs above, which declare no UMD global,
    // it is `TS2874: This JSX tag requires 'React' to be in scope, but it could
    // not be found`. Pinning either code here would pin the stub, not the fact.
    const diagnostics = compile(generatedFile(), { jsx: ts.JsxEmit.React });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("'React'");
  });
});

/**
 * objectui#7976 — BINDS the two hand-kept documentation mirrors of the preamble
 * to the preamble `generateReactComponent()` actually emits.
 *
 * WHY. Two documents transcribe that preamble by hand, and nothing held either
 * to the original: the template lives inside a TEMPLATE LITERAL, so this
 * package's `tsc --noEmit` sees one string, and `DESIGN.md` is markdown in a
 * package whose README is the only file the doc gates' surfaces name. Both
 * copies could drift indefinitely with every gate green. Hand-correction had
 * been spent three times before this pin existed — objectui#7837, objectui#7978
 * and objectui#8112 — and the third re-created the defect while fixing it: it
 * hand-copied the product byte for byte and asserted the equality in its PULL
 * REQUEST DESCRIPTION, which ran once, in one session, and is not in the tree.
 * objectui#7914's ruling is that the control demonstrating the catch belongs in
 * the FILE. This is that file.
 *
 * ⛔ WHAT THIS PIN DOES NOT SEE — read this before trusting it.
 *
 * It binds the PREAMBLE ONLY: the lines above `const schema =`. Everything
 * BELOW that line is unbound and can still drift out of both documents
 * silently — the component name `GeneratedComponent`, the returned JSX, and the
 * `export default` line. It also says nothing about prose OUTSIDE the fence:
 * the sentence claiming the output went to the clipboard (objectui#7977) was
 * false for as long as it stood, and no fence assertion would have caught it,
 * because it was a paragraph and not code.
 *
 * WHY NOT THE WHOLE BLOCK, WHICH WOULD SEE ALL OF THAT. Whole-block verbatim
 * equality is RED on BOTH copies today, and neither red is a defect:
 * `DESIGN.md` assigns `const schema` a braces-with-a-comment placeholder naming
 * the user's schema, where the
 * generator interpolates the real thing, and the `.mdx` was evaluated against
 * the example schema that page teaches rather than this file's `SAMPLE_SCHEMA`.
 * Widening to the whole block would mean editing both documents to fit the
 * test. ⛔ Sanding a document to fit its pin is not available: the readable
 * placeholder is the document doing its job. So the pin is drawn at the widest
 * line that is green on both copies UNCHANGED, and its blind half is named here
 * rather than left for a reader to discover.
 *
 * NOTE the four-line `// No React import:` comment is NOT a readability
 * addition someone made to the docs — it is inside the returned template
 * literal, so it is emitted into every user's file. It is product, and this pin
 * holds the documents to it rather than exempting it.
 */

/** Repo root, from `packages/vscode-extension/src/__tests__`. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Every document that hand-keeps a copy of the preamble, located STRUCTURALLY —
 * by the heading it lives under, not by the text being compared, which would
 * make the locator agree with whatever it found.
 */
const DOCUMENTED_MIRRORS = [
  {
    file: 'packages/vscode-extension/DESIGN.md',
    heading: '### 4. Export to React',
  },
  {
    file: 'content/docs/utilities/vscode-extension.mdx',
    heading: '### `Object UI: Export to React Component`',
  },
] as const;

/**
 * The part shape B binds: everything above the schema assignment. The line is
 * found by its binding, `const schema`, annotated or not: objectui#11515 typed
 * it, so it reads `const schema: SchemaRendererProps['schema'] =` in the
 * product, while a document may still print the binding bare.
 */
function preambleOf(source: string, what: string): string {
  const lines = source.split('\n');
  const end = lines.findIndex((line) => /^const schema\b/.test(line));
  if (end < 0) {
    throw new Error(
      `no \`const schema\` line in ${what} — this pin needs rewriting, not deleting.`
    );
  }
  return lines.slice(0, end).join('\n').trimEnd();
}

/**
 * The preamble as one document prints it. Kept pure on TEXT so the controls
 * below can drive the same extractor over a synthetic document — a control that
 * skipped the extractor would not be controlling the part that can break.
 */
function documentedPreambleFrom(
  text: string,
  mirror: { file: string; heading: string }
): string {
  const heading = text.indexOf(mirror.heading);
  if (heading < 0) {
    throw new Error(
      `${mirror.file} no longer has the heading ${mirror.heading} — this pin needs rewriting, not deleting.`
    );
  }
  const fence = '```typescript\n';
  const open = text.indexOf(fence, heading);
  if (open < 0) {
    throw new Error(
      `no typescript fence under ${mirror.heading} in ${mirror.file} — this pin needs rewriting, not deleting.`
    );
  }
  const start = open + fence.length;
  const close = text.indexOf('```', start);
  if (close < 0) {
    throw new Error(
      `unterminated fence under ${mirror.heading} in ${mirror.file} — this pin needs rewriting, not deleting.`
    );
  }
  return preambleOf(text.slice(start, close), `${mirror.file}'s fence`);
}

function documentedPreamble(mirror: { file: string; heading: string }): string {
  const path = join(REPO_ROOT, mirror.file);
  if (!existsSync(path)) {
    throw new Error(
      `${mirror.file} is gone — this pin needs rewriting, not deleting.`
    );
  }
  return documentedPreambleFrom(readFileSync(path, 'utf8'), mirror);
}

describe('Export to React — the documented mirrors of the preamble (objectui#7976)', () => {
  // ONE assertion, both consumers. The two documents are not pinned separately:
  // a second copy of this comparison is how the two would drift apart again.
  it.each(DOCUMENTED_MIRRORS)(
    '$file reproduces the emitted preamble verbatim',
    (mirror) => {
      expect(documentedPreamble(mirror)).toBe(
        preambleOf(generatedFile(), 'the generated file')
      );
    }
  );

  it('binds every known mirror — an emptied list would assert nothing', () => {
    // The floor. A refactor that quietly emptied the list above would satisfy
    // `it.each` by running zero cases and report green having compared nothing.
    expect(DOCUMENTED_MIRRORS).toHaveLength(2);
    for (const mirror of DOCUMENTED_MIRRORS) {
      expect(existsSync(join(REPO_ROOT, mirror.file))).toBe(true);
    }
  });

  it('is a harness that can fail — a document that drops the side-effect import is rejected', () => {
    // The positive control objectui#7914 requires IN THE FILE, executed on every
    // run rather than once by hand in a PR description. It drives the real
    // extractor over a synthetic document, so if the extractor ever stops
    // finding the fence, THIS goes red instead of the pin above going quietly,
    // permanently green over an empty string.
    const product = preambleOf(generatedFile(), 'the generated file');
    const mirror = DOCUMENTED_MIRRORS[0];
    const asDocument = (preamble: string): string =>
      `${mirror.heading}\n\n\`\`\`typescript\n${preamble}\n\nconst schema = {};\n\`\`\`\n`;

    // Negative: a drifted document is caught.
    const drifted = product
      .split('\n')
      .filter((line) => line !== "import '@object-ui/components';")
      .join('\n');
    expect(drifted).not.toBe(product); // the mutation really removed a line
    expect(documentedPreambleFrom(asDocument(drifted), mirror)).not.toBe(product);

    // Positive: an accurate document is accepted, so the check above is not
    // simply rejecting everything the extractor hands it.
    expect(documentedPreambleFrom(asDocument(product), mirror)).toBe(product);
  });
});

/**
 * objectui#11515 — the emitted `schema` constant compiles against the REAL
 * `SchemaRendererProps['schema']`, not against a stub of it.
 *
 * WHY THE PIN ABOVE CANNOT SEE THIS. Its stub types the prop as `unknown`,
 * which accepts every schema, so an annotation, a missing annotation or a wrong
 * one all compile there. objectui#11466 types the prop as the declared-node
 * union, which discriminates on the literal `type`: an unannotated constant
 * widens every `type` to `string` and is refused, and `SchemaNode`, the first
 * candidate annotation, is refused today and under that change alike, because
 * it admits `number` and `boolean`, which the prop leaves out.
 *
 * HOW THE REAL TYPE IS REACHED WITHOUT A BUILD (the header's CI constraint
 * stands). `@object-ui/types` resolves to its SOURCE entry, which is in the tree
 * when no `dist/` is. The `@object-ui/react` module is still declared here, but
 * its `SchemaRendererProps` is read out of `packages/react/src/SchemaRenderer.tsx`
 * at test time: the interface body and the `@object-ui/types` names it imports,
 * verbatim. So when the prop's type moves, this program moves with it, and a
 * restated copy of the prop never exists to drift.
 */
const REACT_SCHEMA_RENDERER = join(REPO_ROOT, 'packages/react/src/SchemaRenderer.tsx');
const TYPES_SOURCE_ENTRY = join(REPO_ROOT, 'packages/types/src/index.ts');

/**
 * The documented sample (`content/docs/utilities/vscode-extension.mdx`). Both
 * of its types are declared: `div`, and `h1`, one of the HTML passthrough tags
 * `HtmlElementSchema` declares (objectui#8499).
 */
const DOC_SAMPLE_SCHEMA = JSON.stringify(
  {
    type: 'div',
    className: 'p-4',
    children: [{ type: 'h1', children: 'Hello World' }],
  },
  null,
  2
);

/** The real `SchemaRendererProps` declaration, as module text for the stub. */
function realSchemaRendererProps(): { imports: string; body: string } {
  if (!existsSync(REACT_SCHEMA_RENDERER)) {
    throw new Error('packages/react/src/SchemaRenderer.tsx is gone — this pin needs rewriting, not deleting.');
  }
  const source = readFileSync(REACT_SCHEMA_RENDERER, 'utf8');
  const imports = source.match(/^import type \{([^}]*)\} from '@object-ui\/types';$/m);
  const body = source.match(/^export interface SchemaRendererProps \{\n([^}]*)\n\}$/m);
  if (!imports || !body) {
    throw new Error(
      'SchemaRenderer.tsx no longer spells its `@object-ui/types` type import or `SchemaRendererProps` the way this extractor reads them — this pin needs rewriting, not deleting.'
    );
  }
  if (!/^\s*schema:/m.test(body[1])) {
    throw new Error('`SchemaRendererProps` has no `schema` member — this pin needs rewriting, not deleting.');
  }
  return { imports: imports[1].trim(), body: body[1] };
}

/** The stubs above, with `@object-ui/react` carrying the real prop type. */
function realPropStubs(): string {
  const { imports, body } = realSchemaRendererProps();
  const react = `declare module '@object-ui/react' {
  import type { JSX } from 'react/jsx-runtime';
  import type { ${imports} } from '@object-ui/types';
  export interface SchemaRendererProps {
${body}
  }
  export function SchemaRenderer(props: SchemaRendererProps): JSX.Element;
}`;
  const stubbed = STUB_DECLARATIONS.replace(
    /declare module '@object-ui\/react' \{[\s\S]*?\n\}/,
    react
  );
  if (stubbed === STUB_DECLARATIONS) {
    throw new Error('the `@object-ui/react` stub was not replaced — this pin needs rewriting, not deleting.');
  }
  return stubbed;
}

function compileAgainstRealProp(schemaJson: string): string[] {
  return compile(
    generatedFile().replace(SAMPLE_SCHEMA, schemaJson),
    {
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      paths: { '@object-ui/types': [TYPES_SOURCE_ENTRY] },
    },
    realPropStubs(),
    true
  );
}

/** A schema that is no node: it names no `type`. */
const NOT_A_NODE_SCHEMA = JSON.stringify({ className: 'p-4' }, null, 2);

/**
 * objectui#12405 — the two real-prop compiles run in the IMPORT phase, once
 * each, and the tests below read their verdicts. Each is a whole TypeScript
 * program over `@object-ui/types`' source; measured on this branch they cost
 * 5.6–7.2 s apiece inside the 15 s `testTimeout`, and 17.3 / 17.6 s on a slow
 * CI runner (job 116029528393), where both tests timed out with the compile
 * itself correct. Module scope, not `beforeAll`: the import phase is governed
 * by no timeout, whereas a hook would trade the 15 s `testTimeout` for the
 * narrower 10 s `hookTimeout` (objectui `AGENTS.md`, the test discipline
 * section; the same move as `check-unused-dependencies.test.ts`'s
 * `REPOSITORY_SCAN`). Nothing asserted changed: each test reads the same
 * diagnostics from the same compile it ran before.
 */
const DOC_SAMPLE_DIAGNOSTICS = compileAgainstRealProp(DOC_SAMPLE_SCHEMA);
const NOT_A_NODE_DIAGNOSTICS = compileAgainstRealProp(NOT_A_NODE_SCHEMA);

describe('Export to React — the schema constant against the real prop type (objectui#11515)', () => {
  it('compiles the documented sample, annotated, against SchemaRendererProps[\'schema\']', () => {
    expect(DOC_SAMPLE_DIAGNOSTICS).toEqual([]);
  });

  it('is a harness that can fail — a schema that is no node is refused AT the constant', () => {
    // The positive control: if `@object-ui/types` stopped resolving, the prop
    // would read as an error type and this would compile. The refusal lands on
    // the annotated line, which is what the annotation buys: the error is
    // reported where the schema is written, not at the JSX element.
    const product = generatedFile().replace(SAMPLE_SCHEMA, NOT_A_NODE_SCHEMA);
    const constLine = product.split('\n').findIndex((line) => /^const schema\b/.test(line)) + 1;
    const diagnostics = NOT_A_NODE_DIAGNOSTICS;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(`${GENERATED_PATH}(${constLine},`);
    expect(diagnostics[0]).toContain('error TS2322');
  });

  it('reads the prop from the source it names, not from a copy', () => {
    const stubs = realPropStubs();
    expect(stubs).toContain(realSchemaRendererProps().body);
    expect(stubs).not.toContain('export interface SchemaRendererProps { schema: unknown }');
  });
});
