import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { rel } from './turbo-inputs';

/**
 * Walking a tool's **configuration program** — the files a build tool reads in
 * order to know what to do, as opposed to the source it then acts on.
 *
 * Four guards now derive one, and they derive it for four different tools:
 *
 *  - `../turbo-test-inputs.test.ts` (objectui#4178) walks each package's Vitest
 *    configuration program.
 *  - `../turbo-lint-inputs.test.ts` (objectui#4184) walks each package's ESLint
 *    flat-config program.
 *  - `../turbo-build-inputs.test.ts` (objectui#4185) walks each package's build
 *    program, which is a union over the tools its `build` script drives.
 *  - `../turbo-type-check-inputs.test.ts` (objectui#3514) is the exception: a
 *    tsc program is assembled by TypeScript's own config parser, so it lives in
 *    `./tsc-program.ts` instead.
 *
 * What differs between the first three is which file a tool starts from and
 * which of its options name files. What does NOT differ is the walk itself:
 * parse a config file, follow its relative imports transitively, follow the
 * paths it designates through file-valued options, and report what lands
 * outside the package directory. Three hand-written copies of that walk is
 * three chances for one of them to drift toward resolving FEWER files — and a
 * derivation that quietly resolves fewer files is a guard that quietly stops
 * requiring inputs, which is the exact failure all four guards exist to
 * prevent. One implementation, used by all of them.
 *
 * ## Narrowings, shared by every caller
 *
 *  - BARE SPECIFIERS ARE NOT FOLLOWED. `eslint.config.js` imports
 *    `typescript-eslint`, `apps/console/vite.config.ts` imports `vite` — those
 *    resolve into `node_modules`, which turbo tracks through the lockfile
 *    rather than through a task's `inputs`. Following them would also drag in
 *    the alias closure of the workspace, which is most of the repository.
 *  - DESIGNATION IS KEY-DIRECTED, not every string literal in the file. A
 *    literal counts as a designated path only under one of the option names the
 *    caller declares. Globs that SELECT files to act on (`files` / `ignores` in
 *    an ESLint flat config, `include` in a Vitest project) are not designations:
 *    the selected files are the tool's subject, not its program, and they live
 *    inside the package where turbo's `$TURBO_DEFAULT$` already hashes them.
 *  - A literal under a designating key that LOOKS like a concrete source path
 *    and resolves to nothing THROWS rather than being skipped, so a renamed
 *    file cannot quietly leave the program.
 *
 * Every narrowing errs the same way: toward requiring MORE files, and toward
 * throwing on a shape not understood. An approximation that comes out
 * "covered" is a file waved through while turbo does not hash it —
 * wrong-and-red is recoverable, wrong-and-green is the bug.
 */

/** Extensions tried, in order, when a relative specifier carries none. */
export const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * The TypeScript sources an emitted extension may name, in the order tried.
 *
 * TypeScript's ESM spelling writes the extension the compiled file will carry,
 * so `import './x.js'` in a `.ts` file names `./x.ts` beside it. tsc and tsx
 * both resolve it that way, and the sibling walker `resolveRelative` in
 * `../side-effects-declaration-consistency.test.ts` already applies the same
 * rule (objectui#11403).
 */
const TS_SOURCE_FOR_EMITTED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
];

/**
 * Resolve a relative specifier to a file on disk, trying the extensions above.
 *
 * The TypeScript source of an emitted extension is tried AFTER every other
 * candidate, so no specifier that resolved before changes target. A specifier
 * that resolves to nothing still returns null, and the walk still throws.
 */
export function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const emitted = TS_SOURCE_FOR_EMITTED.find(([extension]) => base.endsWith(extension));
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((extension) => base + extension),
    ...RESOLVE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
    ...(emitted === undefined
      ? []
      : emitted[1].map((source) => base.slice(0, -emitted[0].length) + source)),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Does this literal look like a concrete source path rather than a glob or a name? */
export function looksLikeSourcePath(literal: string): boolean {
  if (/[*?{}[\]]/.test(literal)) return false;
  return RESOLVE_EXTENSIONS.some((extension) => literal.endsWith(extension));
}

/**
 * Every relative module specifier a source file imports, and every path it
 * designates through one of `fileValuedOptions`.
 *
 * Parsed with TypeScript's own parser rather than regexes — `.mts`, `.tsx`,
 * `.mjs` and plain `.js` all land here, and a specifier inside a comment or an
 * unrelated string must not count.
 */
export function programEdges(
  file: string,
  fileValuedOptions: ReadonlySet<string>,
): { imports: string[]; designated: string[] } {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('x') ? ts.ScriptKind.TSX : undefined,
  );

  const imports: string[] = [];
  const designated: string[] = [];

  const literalValue = (node: ts.Node): string | null =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;

  /** Collect every literal under a file-valued option's value. */
  const collectDesignated = (node: ts.Node): void => {
    const value = literalValue(node);
    if (value !== null) {
      designated.push(value);
      return;
    }
    node.forEachChild(collectDesignated);
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined
    ) {
      const value = literalValue(node.moduleSpecifier);
      if (value !== null) imports.push(value);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length > 0
    ) {
      const value = literalValue(node.arguments[0]);
      if (value !== null) imports.push(value);
    } else if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      fileValuedOptions.has(node.name.text)
    ) {
      collectDesignated(node.initializer);
    }
    node.forEachChild(visit);
  };
  visit(source);

  return { imports, designated };
}

export interface ProgramWalk {
  /** Which tool's program this is, for error messages: `Vitest`, `ESLint`, … */
  readonly tool: string;
  /** Where the walk started — the tool's resolved config files, absolute. */
  readonly entries: readonly string[];
  /** Package directory the walk is reported relative to. */
  readonly pkgDir: string;
  /** Option names whose values name files rather than globs or data. */
  readonly fileValuedOptions: ReadonlySet<string>;
}

/**
 * Every file a configuration program reads, absolute and sorted.
 *
 * The entries themselves are part of the program: a config file living outside
 * the package is exactly as load-bearing as a module it imports, and just as
 * invisible to `$TURBO_DEFAULT$`.
 */
export function programFiles(walk: ProgramWalk): string[] {
  const seen = new Set<string>();
  const queue = [...walk.entries];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const { imports, designated } = programEdges(file, walk.fileValuedOptions);

    for (const specifier of imports) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveRelative(file, specifier);
      if (resolved === null) {
        throw new Error(
          `${rel(file)} imports ${JSON.stringify(specifier)}, which resolves to no file on disk. ` +
            `Teach resolveRelative() about it rather than letting the ${walk.tool} program shrink ` +
            `silently.`,
        );
      }
      queue.push(resolved);
    }

    for (const literal of designated) {
      // A designated path is spelled either relative to the designating file
      // (`'../../vitest.setup.tsx'`) or as `path.resolve(<this file's dir>, …)`
      // — `__dirname` / `import.meta.dirname`, which IS that directory. Both
      // resolve the same way, so the base is the file, not the cwd.
      const resolved = resolveRelative(file, literal);
      if (resolved !== null) {
        queue.push(resolved);
        continue;
      }
      if (looksLikeSourcePath(literal)) {
        throw new Error(
          `${rel(file)} designates ${JSON.stringify(literal)} through a file-valued ${walk.tool} ` +
            `option, and it resolves to no file on disk. A renamed file must go red here, not ` +
            `drop out of the program.`,
        );
      }
    }
  }
  return [...seen].sort();
}

/**
 * Every file a configuration program reads from OUTSIDE the package directory,
 * repo-relative and sorted. This is the set turbo cannot hash from
 * `$TURBO_DEFAULT$`, and therefore the set a `$TURBO_ROOT$` input must cover.
 */
export function outOfPackageProgramFiles(walk: ProgramWalk): string[] {
  return programFiles(walk)
    .filter((file) => path.relative(walk.pkgDir, file).startsWith('..'))
    .map(rel)
    .sort();
}
