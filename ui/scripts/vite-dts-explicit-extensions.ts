// Explicit extensions on every relative specifier a `vite-plugin-dts` build
// emits into `dist/**/*.d.ts`.
//
// ## The defect (objectui#5365)
//
// `packages/components/dist/index.d.ts` re-exported through EXTENSIONLESS
// relative specifiers — `export * from './ui'`, `export { cn } from
// './lib/utils'`, 21 of them in that one file. TypeScript under
// `"moduleResolution": "nodenext"` (or `node16`) does not extension-search a
// relative specifier, so it could follow none of the hops and every symbol they
// carried read as ABSENT from the package:
//
//     error TS2305: Module '"@object-ui/components"' has no exported member 'Badge'.
//
// Measured on `@object-ui/app-shell` with the pin applied: 1097 errors, of which
// 880 TS2305 (864 from `@object-ui/components`, 16 from `@object-ui/layout`)
// across 162 source files. The remaining TS7006 were fallout — parameters whose
// types came from the imports that stopped resolving.
//
// ## Why the fix has to live in the EMIT, not the source
//
// `@object-ui/react` had the same defect in its `.js` (objectui#4538) and fixed
// it at the source, because it builds with a bare emitting `tsc` and
// **TypeScript never rewrites import specifiers** — what the source writes is
// what `dist` ships. `@object-ui/components` and `@object-ui/layout` are
// different on exactly one axis that decides the route: they are BUNDLER builds.
// Rolldown resolves their relative specifiers away, so the `.js` is clean and
// `pnpm check:esm-specifiers` correctly judges neither package
// specifier-preserving and never scans it. The typings are emitted by the other
// half of the same build, one declaration file per source file, and there the
// source specifier survives verbatim. So the `.js` is fine and the `.d.ts` is
// broken from the same source line, and no source edit can express the
// difference.
//
// That is the whole reason this module exists rather than 350 source edits: the
// extension is a property of the DECLARATION OUTPUT here, not of the source.
//
// ## Two properties this module holds on purpose
//
// - **Loud, never lenient.** A specifier this module cannot resolve to a file
//   the build will emit THROWS, naming the declaration file and the specifier.
//   The tempting fallback — "leave it alone if it looks odd" — reproduces the
//   exact silence objectui#5365 is about: an unreachable hop that every gate
//   reads as green.
// - **It proves its own postcondition.** `afterBuild` re-parses the emitted
//   declaration files and asserts that every relative specifier now carries an
//   extension AND names a file the build actually emitted. Rewriting strings is
//   not the deliverable; RESOLVABLE published typings are, and only the second
//   check can tell the two apart. It also asserts it saw declaration files at
//   all, so a wiring change that stops calling the hook fails the build instead
//   of silently restoring the defect.
//
// Note what this module is NOT: a repository-wide gate. `pnpm check:esm-specifiers`
// deliberately scopes its specifier leg to specifier-preserving `.js` builds,
// and a typings-level criterion is a THIRD leg with its own size assertion —
// out of scope here (objectui#5365 triage), filed separately. The checks below
// are a build's assertions about its own output.

import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

/** Source extensions, mapped to the specifier extension their declaration wants. */
const SOURCE_TO_SPECIFIER_EXTENSION: ReadonlyArray<readonly [string, string]> = [
  ['.ts', '.js'],
  ['.tsx', '.js'],
  ['.d.ts', '.js'],
  ['.mts', '.mjs'],
  ['.d.mts', '.mjs'],
  ['.cts', '.cjs'],
  ['.d.cts', '.cjs'],
];

/**
 * Specifier suffixes that are already explicit and must be left alone.
 *
 * `.css` / `.json` / asset suffixes are here because a declaration file can
 * legitimately carry one; they are not module hops this module can or should
 * re-point.
 */
const ALREADY_EXPLICIT = /\.(js|mjs|cjs|jsx|json|css|scss|svg|png|node)$/;

/** Declaration files this module rewrites. Source maps and assets are skipped. */
const DECLARATION_FILE = /\.d\.(ts|mts|cts)$/;

/** One module specifier found in a declaration file, with its source span. */
interface SpecifierSpan {
  /** The specifier text, without quotes. */
  text: string;
  /** Offset of the opening quote in the file content. */
  start: number;
  /** Offset just past the closing quote. */
  end: number;
}

function fail(message: string): never {
  throw new Error(`[dts-explicit-extensions] ${message}`);
}

/**
 * Every module specifier in a declaration file, located by the TypeScript
 * parser rather than by a regular expression.
 *
 * The parser is load-bearing, not fastidiousness. `removeComments` is false in
 * this repository's build configs, so JSDoc survives into `dist`, and this
 * repository's JSDoc contains PROSE specifiers — `packages/app-shell`'s
 * `i18n.ts` documents itself with `import { t } from './i18n'` inside a comment,
 * and `packages/fields`' `MasterDetailField.tsx` names `'./widgets/MasterDetailField'`
 * the same way. A text scan rewrites those (harmless but wrong) or, when the
 * prose names a path that does not exist, THROWS and breaks a correct build.
 * Module augmentations (`declare module './x'`) are deliberately not collected:
 * their specifier is a module NAME, not a hop to follow.
 */
export function findModuleSpecifiers(fileName: string, content: string): SpecifierSpan[] {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const found: SpecifierSpan[] = [];

  const record = (node: ts.Node | undefined): void => {
    if (!node || !ts.isStringLiteralLike(node)) return;
    found.push({ text: node.text, start: node.getStart(sourceFile), end: node.getEnd() });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) record(node.argument.literal);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) record(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      record(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return found;
}

/** True for a specifier that names a path rather than a package. */
function isRelative(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || /^\.\.?\//.test(specifier);
}

/**
 * The explicit form of one relative specifier, resolved against the SOURCE tree
 * the declaration output mirrors.
 *
 * Resolving against the sources rather than against `dist` is what makes this
 * usable from `beforeWriteFile`, which runs per file while the rest of the
 * output does not exist yet. `afterBuild` then re-checks the answers against
 * what was really emitted, so the mirror assumption is verified rather than
 * trusted.
 */
export function resolveExplicitSpecifier(
  specifier: string,
  sourceDir: string,
  exists: (candidate: string) => boolean = fs.existsSync
): string | null {
  if (ALREADY_EXPLICIT.test(specifier)) return null;

  const bareDirectory = specifier === '.' || specifier === '..' || specifier.endsWith('/');
  const target = path.resolve(sourceDir, specifier);

  if (!bareDirectory) {
    for (const [sourceExtension, specifierExtension] of SOURCE_TO_SPECIFIER_EXTENSION) {
      if (exists(`${target}${sourceExtension}`)) return `${specifier}${specifierExtension}`;
    }
  }

  const prefix = bareDirectory ? specifier.replace(/\/$/, '') : specifier;
  for (const [sourceExtension, specifierExtension] of SOURCE_TO_SPECIFIER_EXTENSION) {
    if (exists(path.join(target, `index${sourceExtension}`))) {
      return `${prefix}/index${specifierExtension}`;
    }
  }

  return null;
}

/**
 * One declaration file's content, with every relative specifier made explicit.
 *
 * @param declarationPath absolute path the file will be written to
 * @param content         the emitted declaration text
 * @param sourceDir       the source directory that declaration mirrors
 */
export function rewriteDeclaration(
  declarationPath: string,
  content: string,
  sourceDir: string,
  exists: (candidate: string) => boolean = fs.existsSync
): string {
  const spans = findModuleSpecifiers(declarationPath, content);
  let result = content;

  // Applied back-to-front so an earlier span's offsets stay valid.
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    if (!isRelative(span.text)) continue;

    const explicit = resolveExplicitSpecifier(span.text, sourceDir, exists);
    if (explicit === null) {
      if (ALREADY_EXPLICIT.test(span.text)) continue;
      fail(
        `\`${declarationPath}\` re-exports through \`${span.text}\`, which names no file under ` +
          `\`${sourceDir}\`. A relative specifier with no extension is unresolvable under ` +
          `\`moduleResolution: nodenext\`, and this build cannot guess the extension it wants.`
      );
    }

    const quote = content[span.start];
    result = `${result.slice(0, span.start)}${quote}${explicit}${quote}${result.slice(span.end)}`;
  }

  return result;
}

export interface DtsExplicitExtensionsOptions {
  /** Absolute path of the package root (the directory holding `package.json`). */
  packageDir: string;
  /** Source root the declarations mirror. Defaults to `<packageDir>/src`. */
  srcDir?: string;
  /** Declaration output root. Defaults to `<packageDir>/dist`. */
  outDir?: string;
}

/** The two `vite-plugin-dts` hooks that carry the fix. */
export interface DtsExplicitExtensionsHooks {
  beforeWriteFile: (filePath: string, content: string) => { content: string } | undefined;
  afterBuild: (emitted: Map<string, string>) => void;
}

/**
 * Wire the fix into a `vite-plugin-dts` invocation.
 *
 * ```ts
 * const dtsExtensions = createDtsExplicitExtensions({ packageDir: __dirname });
 * dts({ ...existing, ...dtsExtensions })
 * ```
 */
export function createDtsExplicitExtensions(
  options: DtsExplicitExtensionsOptions
): DtsExplicitExtensionsHooks {
  const packageDir = path.resolve(options.packageDir);
  const srcDir = path.resolve(options.srcDir ?? path.join(packageDir, 'src'));
  const outDir = path.resolve(options.outDir ?? path.join(packageDir, 'dist'));

  let rewritten = 0;

  const sourceDirFor = (declarationPath: string): string =>
    path.join(srcDir, path.dirname(path.relative(outDir, declarationPath)));

  return {
    beforeWriteFile(filePath, content) {
      if (!DECLARATION_FILE.test(filePath)) return undefined;
      const absolute = path.resolve(filePath);
      if (path.relative(outDir, absolute).startsWith('..')) return undefined;

      rewritten += 1;
      return { content: rewriteDeclaration(absolute, content, sourceDirFor(absolute)) };
    },

    afterBuild(emitted) {
      // A hook that stopped being called must not read as "nothing to fix".
      if (rewritten === 0) {
        fail(
          `no declaration file reached \`beforeWriteFile\` for \`${packageDir}\`. The hook is wired ` +
            `up but never ran, so the emitted typings were not checked at all.`
        );
      }

      const declarations = [...emitted.keys()].filter((file) => DECLARATION_FILE.test(file));
      if (declarations.length === 0) {
        fail(`\`${outDir}\` received no declaration files, so there is nothing to assert about.`);
      }

      const present = new Set([...emitted.keys()].map((file) => path.resolve(file)));
      const findings: string[] = [];

      for (const declaration of declarations) {
        const absolute = path.resolve(declaration);
        const content = emitted.get(declaration)!;
        for (const span of findModuleSpecifiers(absolute, content)) {
          if (!isRelative(span.text)) continue;
          if (!ALREADY_EXPLICIT.test(span.text)) {
            findings.push(`${absolute}: \`${span.text}\` still carries no extension`);
            continue;
          }
          // The specifier a `.d.ts` writes points at a `.js`; the file the
          // compiler actually loads is the declaration beside it.
          const target = path.resolve(path.dirname(absolute), span.text);
          const candidates = [
            target.replace(/\.js$/, '.d.ts'),
            target.replace(/\.mjs$/, '.d.mts'),
            target.replace(/\.cjs$/, '.d.cts'),
          ];
          if (/\.(js|mjs|cjs)$/.test(span.text) && !candidates.some((file) => present.has(file))) {
            findings.push(
              `${absolute}: \`${span.text}\` names no emitted declaration ` +
                `(looked for ${candidates.filter((file, i, all) => all.indexOf(file) === i).join(', ')})`
            );
          }
        }
      }

      if (findings.length > 0) {
        fail(
          `${findings.length} unresolvable relative specifier(s) survived into the emitted typings ` +
            `of \`${packageDir}\`:\n  ${findings.join('\n  ')}`
        );
      }
    },
  };
}
