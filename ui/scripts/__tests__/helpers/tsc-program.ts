import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { rel } from './turbo-inputs';

/**
 * Derives the **tsc program** a package's script drives — the files TypeScript
 * is given, as TypeScript itself assembles them.
 *
 * Written for objectui#3514 (`type-check`) and lifted out of that guard for
 * objectui#4185, because `build` drives tsc too: 14 packages build with a bare
 * `tsc`, `apps/console` adds `tsc -p tsconfig.plugin.json`, and every `tsup`
 * package's declaration step reads a tsconfig as well. The same derivation,
 * two tasks — and a second hand-written copy of a tsconfig walker is exactly
 * the drift neither guard would survive.
 *
 * ## Scope, stated so the narrowing is visible rather than assumed
 *
 *  - ROOT FILES, not the import closure. This reports the files tsc is GIVEN
 *    (config `include` / `files` / `extends` / `references`), not every module
 *    they transitively import. Building 40+ real programs to resolve imports
 *    needs a built workspace and minutes of CPU per run. The narrowing is sound
 *    for the failure being guarded: a composite project must list every file in
 *    its program, which is exactly why both of objectui#3514's known drifts were
 *    `include` entries in the first place.
 *  - Cross-package references are still reported. If one package's program
 *    reaches into another package's directory, that is reported like any other
 *    out-of-package file rather than waved through on the assumption that
 *    turbo's `dependsOn: ["^build"]` covers it — `^build` covers declared
 *    DEPENDENCIES, and a tsconfig reference is not required to be one.
 */

export interface TscInvocation {
  /** Absolute path of the tsconfig this segment compiles. */
  readonly project: string;
  /** `tsc -b` / `--build`, which also compiles the project's references. */
  readonly build: boolean;
}

/**
 * The tsc projects a `&&` chain of commands drives.
 *
 * Every shape in the repo today is a bare `tsc` (the package's own
 * `tsconfig.json`), `tsc -p <config>` for the `tsconfig.test.json` /
 * `tsconfig.plugin.json` companions, or `apps/console`'s
 * `tsc -b tsconfig.node.json --force`. A segment that runs tsc in a shape this
 * parser cannot read throws rather than being skipped: an unparsed segment is
 * an unswept program.
 */
export function invocationsFor(pkgDir: string, script: string): TscInvocation[] {
  const invocations: TscInvocation[] = [];
  for (const segment of script.split('&&')) {
    const command = segment.trim();
    if (!/(?:^|\s)tsc(?:\s|$)/.test(command)) continue;
    invocations.push(invocationForCommand(pkgDir, command));
  }
  return invocations;
}

/** The tsc project a single `tsc …` command drives. */
export function invocationForCommand(pkgDir: string, command: string): TscInvocation {
  const build = /(?:^|\s)(?:-b|--build)(?:\s|$)/.test(command);
  const named = command.match(/(?:^|\s)(?:-p|--project|-b|--build)\s+([^\s]+)/);
  if (build && !named) {
    throw new Error(
      `${rel(pkgDir)}: \`${command}\` builds without naming a project. Teach ` +
        `invocationsFor() how to resolve it.`,
    );
  }
  const project = path.resolve(pkgDir, named ? named[1] : 'tsconfig.json');
  if (!fs.existsSync(project)) {
    throw new Error(`${rel(pkgDir)}: \`${command}\` drives ${rel(project)}, which does not exist.`);
  }
  return { project, build };
}

/**
 * A tsconfig parsed the way `tsc` parses it, so `fileNames` is the real program
 * root set rather than a re-implementation of TypeScript's glob semantics.
 *
 * `readJsonConfigFile` (not `readConfigFile`) is what makes `extendedSourceFiles`
 * available — the `extends` chain, which is the half of "the program" that a
 * file-list-only reading misses.
 */
export function parseProject(configPath: string): {
  parsed: ts.ParsedCommandLine;
  extended: string[];
} {
  const sourceFile = ts.readJsonConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(
    sourceFile,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  const fatal = parsed.errors.find((e) => e.category === ts.DiagnosticCategory.Error);
  if (fatal) {
    throw new Error(
      `${rel(configPath)} must parse as a tsconfig: ` +
        ts.flattenDiagnosticMessageText(fatal.messageText, ' '),
    );
  }
  return { parsed, extended: sourceFile.extendedSourceFiles ?? [] };
}

/**
 * Every file the given tsc invocations read from outside `pkgDir`,
 * repo-relative and sorted.
 */
export function outOfPackageFilesFor(pkgDir: string, invocations: TscInvocation[]): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const queue = [...invocations];

  while (queue.length > 0) {
    const { project, build } = queue.shift()!;
    if (seen.has(project)) continue;
    seen.add(project);

    const { parsed, extended } = parseProject(project);
    // The config file itself belongs to the program too — a referenced or
    // extended config living outside the package is exactly as load-bearing as
    // a source file, and just as invisible to `$TURBO_DEFAULT$`.
    for (const file of [project, ...extended, ...parsed.fileNames]) {
      if (path.relative(pkgDir, file).startsWith('..')) found.add(rel(file));
    }

    // `tsc -b` compiles referenced projects as well; `tsc -p` does not.
    if (build) {
      for (const reference of parsed.projectReferences ?? []) {
        const target = reference.path.endsWith('.json')
          ? reference.path
          : path.join(reference.path, 'tsconfig.json');
        queue.push({ project: target, build: true });
      }
    }
  }
  return [...found].sort();
}

/**
 * Every file a package's tsc program reads from outside the package directory,
 * for a script that is a `&&` chain of `tsc` commands.
 */
export function outOfPackageFiles(pkgDir: string, script: string): string[] {
  return outOfPackageFilesFor(pkgDir, invocationsFor(pkgDir, script));
}
