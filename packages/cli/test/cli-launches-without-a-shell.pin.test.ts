// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: the CLI starts programs from an argv array, without a shell.
 *
 * Over every `.ts` file under `packages/cli/src`, read as a TypeScript AST
 * (comments and strings cannot match). A `child_process` binding is a named,
 * renamed, namespace or default import, a `require(…)` / `import(…)` held in
 * a variable or destructured, or such a load used inline. Four rules:
 *
 *   - `exec-non-literal` — a call to `exec` / `execSync` (by its binding, as a
 *     member of a namespace binding, or as a member of an inline load) whose
 *     command is anything but one plain string literal.
 *   - `exec-as-value` — any other use of `exec` / `execSync`: passed as a
 *     value (`promisify(exec)`), aliased, destructured from a namespace
 *     binding, read by a computed member name, or re-exported; and an inline
 *     load that escapes (handed on, or `.then(…)`), since what it hands on
 *     carries `exec`.
 *   - `shell-option` — in a file that loads `child_process`, a `shell`
 *     option whose value is anything but the literal `false`: an
 *     object-literal property (`true`, a platform test, a variable, the
 *     shorthand `{ shell }`), or an assignment to a `shell` member
 *     (`options.shell = …`, `options['shell'] = …`).
 *   - `shell-program` — a `spawn` / `spawnSync` / `execFile` /
 *     `execFileSync` whose program is a shell named by a string literal
 *     (`sh`, `bash`, `cmd`, `powershell`, `pwsh`, … with or without a
 *     directory or `.exe`), or is read from `process.env.SHELL` /
 *     `process.env.ComSpec`.
 *
 * The findings must equal {@link ALLOWED} exactly, by file, rule, enclosing
 * function and the statement that holds the finding: a new launch of any kind
 * reds here, so does a changed allowed statement, and so does an allowance
 * nothing needs any more. Each allowance also pins what its statement is
 * built from (`inputs`: the initializer of every local it reads) and, for an
 * exported wrapper, that every caller passes a plain string literal
 * (`literalCallers`).
 *
 * An allowance is a measured exception, each with the reason it is safe. ⛔
 * Never add one for a command line that carries text other than one of three
 * classes: text the CLI wrote itself; text validated to a fixed character set
 * or a closed set of values; or the invoking user's own argument to the same
 * command, which they typed into their own shell, so the shell reads nothing
 * that user did not already hand it. Text from anywhere else (a server, a
 * file, an environment variable, another program) is never in a command line.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

type Rule = 'exec-non-literal' | 'exec-as-value' | 'shell-option' | 'shell-program';

interface Finding {
  readonly rule: Rule;
  /** The enclosing function's name, or `(top level)`. */
  readonly fn: string;
  /** The statement that holds the finding, whitespace collapsed. */
  readonly site: string;
}

interface Allowance extends Finding {
  readonly file: string;
  /** The text class of the command line (see the header). */
  readonly textClass: 'cli-written' | 'validated' | 'invoking-user-argument';
  /** Locals the statement is built from, each by the initializer of its one declaration in `fn`. */
  readonly inputs?: Readonly<Record<string, string>>;
  /** An exported wrapper: every call to it under `src` passes a plain string literal first. */
  readonly literalCallers?: string;
  readonly reason: string;
}

const ALLOWED: readonly Allowance[] = [
  {
    file: 'commands/doctor.ts',
    rule: 'exec-non-literal',
    fn: 'probeTool',
    site: "const output = execSync(command, { encoding: 'utf-8', env: options.env, cwd: options.cwd }).trim();",
    textClass: 'cli-written',
    literalCallers: 'probeTool',
    reason:
      '`probeTool(command)` runs only constant probes (`pnpm -v`, `tsc -v`, `git --version`), through the shell on '
      + 'purpose: the probe answers what the shell would find (see the comment above `probeTool`). Every caller '
      + 'passes a string literal.',
  },
  {
    file: 'commands/dev.ts',
    rule: 'exec-non-literal',
    fn: 'run',
    site: "execSync(command, { stdio: 'inherit', cwd });",
    textClass: 'invoking-user-argument',
    inputs: {
      command: '`pnpm ${filter} dev`.trim()',
      filter: "packageName === 'all' ? '' : `--filter ${packageName} --fail-if-no-match`",
      packageName: 'args.package',
    },
    reason:
      '`pnpm [--filter PACKAGE --fail-if-no-match] dev`, where PACKAGE is the positional argument of the same '
      + '`os dev` the user typed. It is not held to a character set because pnpm owns the filter grammar (names, '
      + 'globs, `./dir`, `...pkg`, `{dir}`, `[ref]`), which no fixed set short of that grammar covers.',
  },
  {
    file: 'commands/init.ts',
    rule: 'exec-non-literal',
    fn: 'run',
    site: "execSync(`${chosenPm} install`, { stdio: 'inherit', cwd: targetDir });",
    textClass: 'validated',
    inputs: {
      chosenPm: "(flags['package-manager'] as 'npm' | 'pnpm' | 'yarn' | 'bun' | undefined) ?? detectPackageManager()",
    },
    reason: '`PM install`, where PM is one of the closed set npm | pnpm | yarn | bun (the flag\'s `options` and the detector\'s answers).',
  },
  {
    file: 'utils/skills-catalog.ts',
    rule: 'shell-option',
    fn: 'npmPackInvocation',
    site:
      "return { command: 'npm', args: ['pack', spec, '--pack-destination', shell ? `\"${destination}\"` : destination, '--json'], "
      + 'options: { cwd, timeout: NPM_PACK_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, shell }, };',
    textClass: 'validated',
    inputs: { shell: "platform === 'win32'" },
    reason:
      '`npm pack` on Windows, where `npm` is a batch-file shim: its arguments are the package name, an exact version '
      + '(`isExactVersion`, digits, letters, `.`, `-`, `+`) and a quoted directory the CLI itself created.',
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:c|m)?tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

const CHILD_PROCESS = /^(?:node:)?child_process$/;
const EXEC_FAMILY = new Set(['exec', 'execSync']);
const SPAWN_FAMILY = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync']);
const SHELL_PROGRAMS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish', 'ash', 'cmd', 'powershell', 'pwsh']);
const SHELL_ENV = new Set(['SHELL', 'ComSpec', 'COMSPEC']);

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** `require('child_process')` / `import('node:child_process')`, awaited or not, parenthesized or not. */
function isChildProcessLoad(node: ts.Node | undefined): boolean {
  if (!node) return false;
  let inner: ts.Node = node;
  while (ts.isParenthesizedExpression(inner) || ts.isAwaitExpression(inner)) inner = inner.expression;
  if (!ts.isCallExpression(inner)) return false;
  const [arg] = inner.arguments;
  const loads = inner.expression.kind === ts.SyntaxKind.ImportKeyword
    || (ts.isIdentifier(inner.expression) && inner.expression.text === 'require');
  return loads && !!arg && ts.isStringLiteralLike(arg) && CHILD_PROCESS.test(arg.text);
}

/** The outermost expression a load is wrapped in (parentheses, `await`). */
function loadWrapper(load: ts.Node): ts.Node {
  let node = load;
  while (ts.isParenthesizedExpression(node.parent) || ts.isAwaitExpression(node.parent)) node = node.parent;
  return node;
}

function memberName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return undefined;
}

function enclosingFunctionName(node: ts.Node): string {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur) || ts.isFunctionExpression(cur) || ts.isArrowFunction(cur)) {
      if ((ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur) || ts.isFunctionExpression(cur)) && cur.name) {
        return cur.name.getText();
      }
      const holder = cur.parent;
      if (holder && (ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder)) && holder.name) return holder.name.getText();
    }
  }
  return '(top level)';
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isFunctionLike(cur)) return cur;
  }
  return undefined;
}

function enclosingStatement(node: ts.Node): ts.Node {
  for (let cur: ts.Node = node; cur.parent; cur = cur.parent) {
    if (ts.isExpressionStatement(cur) || ts.isReturnStatement(cur) || ts.isVariableStatement(cur)
      || ts.isExportDeclaration(cur) || ts.isImportDeclaration(cur)) {
      return cur;
    }
  }
  return node;
}

/** Whether `node` is the program-name argument's shell: a literal shell name, or `process.env.SHELL` / `ComSpec`. */
function namesAShell(node: ts.Expression | undefined): boolean {
  if (!node) return false;
  if (ts.isStringLiteralLike(node)) {
    const base = node.text.split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, '');
    return SHELL_PROGRAMS.has(base);
  }
  const name = memberName(node);
  if (name && SHELL_ENV.has(name)) {
    const owner = (node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
    return ts.isPropertyAccessExpression(owner) && owner.name.text === 'env'
      && ts.isIdentifier(owner.expression) && owner.expression.text === 'process';
  }
  return false;
}

/** Every finding in one file's source. */
function launchFindings(source: string, fileName = 'file.ts'): Finding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const execNames = new Set<string>();
  const spawnNames = new Set<string>();
  const namespaces = new Set<string>();
  /** Identifier nodes that declare a binding, never a use of one. */
  const declarations = new Set<ts.Node>();
  const findings: Finding[] = [];
  const report = (rule: Rule, node: ts.Node): void => {
    findings.push({ rule, fn: enclosingFunctionName(node), site: collapse(enclosingStatement(node).getText(sf)) });
  };
  let loadsChildProcess = false;

  const bindDestructure = (pattern: ts.ObjectBindingPattern): void => {
    for (const el of pattern.elements) {
      const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : undefined;
      if (!ts.isIdentifier(el.name)) continue;
      const original = imported ?? el.name.text;
      if (EXEC_FAMILY.has(original)) execNames.add(el.name.text);
      if (SPAWN_FAMILY.has(original)) spawnNames.add(el.name.text);
      declarations.add(el.name);
    }
  };

  // Pass 1: the bindings.
  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && CHILD_PROCESS.test(node.moduleSpecifier.text)) {
      loadsChildProcess = true;
      const clause = node.importClause;
      if (clause?.name) {
        namespaces.add(clause.name.text);
        declarations.add(clause.name);
      }
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
        declarations.add(bindings.name);
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const original = (el.propertyName ?? el.name).text;
          if (EXEC_FAMILY.has(original)) execNames.add(el.name.text);
          if (SPAWN_FAMILY.has(original)) spawnNames.add(el.name.text);
          declarations.add(el.name);
        }
      }
    }
    if (isChildProcessLoad(node)) loadsChildProcess = true;
    if (ts.isVariableDeclaration(node) && isChildProcessLoad(node.initializer)) {
      if (ts.isIdentifier(node.name)) {
        namespaces.add(node.name.text);
        declarations.add(node.name);
      }
      if (ts.isObjectBindingPattern(node.name)) bindDestructure(node.name);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const isNamespace = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && namespaces.has(node.text)) || isChildProcessLoad(node);
  /** `cp.exec` / `cp['exec']` / `require('child_process').exec`. */
  const execMember = (node: ts.Node): boolean => {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
    const name = memberName(node);
    return !!name && EXEC_FAMILY.has(name) && isNamespace(node.expression);
  };
  const spawnCallee = (callee: ts.Node): boolean => {
    if (ts.isIdentifier(callee)) return spawnNames.has(callee.text);
    const name = memberName(callee);
    return !!name && SPAWN_FAMILY.has(name)
      && isNamespace((callee as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression);
  };
  const isCallee = (node: ts.Node): boolean => {
    let outer = node;
    while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
    return ts.isCallExpression(outer.parent) && outer.parent.expression === outer;
  };

  // Pass 2: the uses.
  const visit = (node: ts.Node): void => {
    // A re-export of the module: `export { exec } from 'child_process'`, `export * from …`.
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      && CHILD_PROCESS.test(node.moduleSpecifier.text)) {
      const clause = node.exportClause;
      const names = clause && ts.isNamedExports(clause) ? clause.elements.map((el) => (el.propertyName ?? el.name).text) : undefined;
      if (!names || names.some((name) => EXEC_FAMILY.has(name))) report('exec-as-value', node);
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isExec = (ts.isIdentifier(callee) && execNames.has(callee.text)) || execMember(callee);
      const [command] = node.arguments;
      if (isExec && !(command && (ts.isStringLiteral(command) || ts.isNoSubstitutionTemplateLiteral(command)))) {
        report('exec-non-literal', node);
      }
      if (spawnCallee(callee) && namesAShell(command)) report('shell-program', node);
    }

    // An exec binding anywhere but a callee or its own declaration.
    if (ts.isIdentifier(node) && execNames.has(node.text) && !declarations.has(node) && !isCallee(node)) {
      const parent = node.parent;
      const isMemberName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node)
        || (ts.isBindingElement(parent) && parent.propertyName === node)
        || ts.isImportSpecifier(parent);
      if (!isMemberName) report('exec-as-value', node);
    }
    // `cp.exec` / `cp['exec']` anywhere but a callee.
    if (execMember(node) && !isCallee(node)) report('exec-as-value', node);
    // `cp[name]`: a computed member of a namespace binding or an inline load.
    if (ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression) && isNamespace(node.expression)) {
      report('exec-as-value', node);
    }
    // A destructure of exec from a namespace binding: `const { exec } = cp`.
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer
      && ts.isIdentifier(node.initializer) && namespaces.has(node.initializer.text)) {
      for (const el of node.name.elements) {
        const original = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.getText(sf);
        if (EXEC_FAMILY.has(original)) report('exec-as-value', el);
      }
    }
    // An inline load that escapes: held, destructured, a member read or a bare statement are its only uses.
    if (isChildProcessLoad(node) && !ts.isAwaitExpression(node) && !ts.isParenthesizedExpression(node)) {
      const wrapper = loadWrapper(node);
      const parent = wrapper.parent;
      const held = ts.isVariableDeclaration(parent) && parent.initializer === wrapper;
      const member = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === wrapper
        && !(ts.isPropertyAccessExpression(parent) && parent.name.text === 'then');
      const bare = ts.isExpressionStatement(parent);
      if (!held && !member && !bare) report('exec-as-value', node);
    }

    if (loadsChildProcess) {
      if (ts.isPropertyAssignment(node) && node.name.getText(sf).replace(/^['"]|['"]$/g, '') === 'shell'
        && ts.isObjectLiteralExpression(node.parent) && node.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
        report('shell-option', node);
      }
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'shell') report('shell-option', node);
      if (ts.isBinaryExpression(node) && memberName(node.left) === 'shell'
        && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && node.right.kind !== ts.SyntaxKind.FalseKeyword) {
        report('shell-option', node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

/** The initializer text of each variable named `name` declared inside `fnNode`. */
function localInitializers(fnNode: ts.Node, name: string, sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      out.push(collapse(node.initializer.getText(sf)));
    }
    ts.forEachChild(node, walk);
  };
  walk(fnNode);
  return out;
}

/** The function in `sf` that holds the statement `allowance` names. */
function allowedFunction(sf: ts.SourceFile, allowance: Allowance): ts.Node | undefined {
  let found: ts.Node | undefined;
  const walk = (node: ts.Node): void => {
    if (found) return;
    if ((ts.isExpressionStatement(node) || ts.isReturnStatement(node) || ts.isVariableStatement(node))
      && collapse(node.getText(sf)) === allowance.site && enclosingFunctionName(node) === allowance.fn) {
      found = enclosingFunction(node);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return found;
}

const key = (file: string, f: Finding): string => `${file} · ${f.rule} · ${f.fn} · ${f.site}`;

/**
 * The tree walk's budget. Measured locally on a box running a build beside
 * it: reading all 622 `.ts` files under `src` and parsing the 39 that pass the
 * prefilter took 0.10-0.19 s, against 1.0-2.3 s for parsing all 622; a CI
 * runner under full-suite load ran the unfiltered walk inside the test past
 * vitest's 5 s default. The bound is a ceiling for a loaded runner, not an
 * expectation.
 */
const TREE_WALK_TIMEOUT_MS = 60_000;

describe('the CLI starts programs from an argv array, without a shell', () => {
  let files: Array<{ rel: string; source: string; file: string }> = [];
  let found: string[] = [];

  beforeAll(() => {
    files = sourceFiles(SRC).map((file) => ({
      rel: relative(SRC, file).split('\\').join('/'),
      source: readFileSync(file, 'utf-8'),
      file,
    }));
    // Sound prefilter: every finding needs a `child_process` load (an import,
    // `require` or `import()` naming it by a string literal), so a file whose
    // text never holds that name has none. Only the rest are parsed.
    found = files
      .filter(({ source }) => source.includes('child_process'))
      .flatMap(({ rel, source, file }) => launchFindings(source, file).map((f) => key(rel, f)))
      .sort();
  }, TREE_WALK_TIMEOUT_MS);

  it('finds no exec with a built command line, no exec as a value, no shell option and no shell program outside the measured allowances', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(found).toEqual(ALLOWED.map((a) => key(a.file, a)).sort());
  });

  it('each allowance is built from exactly the inputs it names', () => {
    const withInputs = ALLOWED.filter((a) => a.inputs);
    expect(withInputs.length).toBeGreaterThan(0);
    for (const allowance of withInputs) {
      const { source, file } = files.find((f) => f.rel === allowance.file)!;
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const fnNode = allowedFunction(sf, allowance);
      expect(fnNode, `${allowance.file}: the allowed statement in ${allowance.fn}`).toBeDefined();
      for (const [name, initializer] of Object.entries(allowance.inputs!)) {
        expect(localInitializers(fnNode!, name, sf), `${allowance.file} ${allowance.fn}: \`${name}\``).toEqual([initializer]);
      }
    }
  });

  it('every caller of an allowed wrapper passes a plain string literal, and the wrapper is never used as a value', () => {
    const wrappers = ALLOWED.filter((a) => a.literalCallers);
    expect(wrappers.length).toBeGreaterThan(0);
    for (const allowance of wrappers) {
      const wrapper = allowance.literalCallers!;
      let calls = 0;
      const offenders: string[] = [];
      // A file whose text never holds the wrapper's name has no reference to it.
      for (const { rel, source, file } of files.filter((f) => f.source.includes(wrapper))) {
        const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        const walk = (node: ts.Node): void => {
          if (ts.isIdentifier(node) && node.text === wrapper) {
            const parent = node.parent;
            const declaring = ts.isFunctionDeclaration(parent) && parent.name === node;
            if (ts.isCallExpression(parent) && parent.expression === node) {
              calls += 1;
              const [first] = parent.arguments;
              if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
                offenders.push(`${rel}: ${collapse(parent.getText(sf))}`);
              }
            } else if (!declaring) {
              offenders.push(`${rel}: ${collapse(enclosingStatement(node).getText(sf))}`);
            }
          }
          ts.forEachChild(node, walk);
        };
        walk(sf);
      }
      expect(offenders, wrapper).toEqual([]);
      expect(calls, `${wrapper} has callers`).toBeGreaterThan(0);
    }
  });

  // Each case is one source and the one rule it must find; a QUIET source must find nothing.
  const LOUD: ReadonlyArray<readonly [Rule, string]> = [
    ['exec-non-literal', "import { exec } from 'node:child_process'; exec(`open ${u}`);"],
    ['exec-non-literal', "import { execSync as run } from 'child_process'; run('a ' + b);"],
    ['exec-non-literal', "import * as cp from 'node:child_process'; cp.exec(cmd);"],
    ['exec-non-literal', "import cp from 'child_process'; cp.execSync(`x ${y}`);"],
    ['exec-non-literal', "async function f() { const { exec } = await import('node:child_process'); exec(cmd); }"],
    ['exec-non-literal', "const { execSync: go } = require('child_process'); go(cmd);"],
    ['exec-non-literal', "require('child_process').exec(cmd);"],
    ['exec-non-literal', "async function f() { (await import('node:child_process')).execSync(cmd); }"],
    ['exec-non-literal', "import * as cp from 'node:child_process'; cp['exec'](cmd);"],
    ['exec-as-value', "import { promisify } from 'node:util'; import { exec } from 'node:child_process'; const run = promisify(exec);"],
    ['exec-as-value', "import { exec } from 'node:child_process'; const run = exec;"],
    ['exec-as-value', "import * as cp from 'node:child_process'; const { exec } = cp;"],
    ['exec-as-value', "import * as cp from 'node:child_process'; const run = promisify(cp.exec);"],
    ['exec-as-value', "const run = promisify(require('child_process').execSync);"],
    ['exec-as-value', "import * as cp from 'node:child_process'; const run = cp[name];"],
    ['exec-as-value', "export { exec } from 'node:child_process';"],
    ['exec-as-value', "export * from 'child_process';"],
    ['exec-as-value', "import { exec } from 'node:child_process'; export const seam = { exec };"],
    ['exec-as-value', "import('node:child_process').then((m) => m.exec(cmd));"],
    ['exec-as-value', "use(require('child_process'));"],
    ['shell-option', "import { spawn } from 'node:child_process'; spawn('a', [], { shell: true });"],
    ['shell-option', "import { spawnSync } from 'child_process'; spawnSync('a', [], { shell: process.platform === 'win32' });"],
    ['shell-option', "import { execFile } from 'node:child_process'; const shell = true; execFile('a', [], { shell });"],
    ['shell-option', "async function f() { const cp = await import('node:child_process'); cp.spawn('a', [], { 'shell': flag }); }"],
    ['shell-option', "const opts = { shell: true }; require('child_process').spawn('a', [], opts);"],
    ['shell-option', "import { spawn } from 'node:child_process'; const o = {}; o.shell = true; spawn('a', [], o);"],
    ['shell-option', "import { spawn } from 'node:child_process'; options['shell'] = isWin; spawn('a', [], options);"],
    ['shell-program', "import { spawn } from 'node:child_process'; spawn('sh', ['-c', line]);"],
    ['shell-program', "import { spawnSync } from 'node:child_process'; spawnSync('/bin/bash', ['-c', line]);"],
    ['shell-program', "import { execFile } from 'child_process'; execFile('cmd.exe', ['/c', line]);"],
    ['shell-program', "import * as cp from 'node:child_process'; cp.execFileSync('powershell', ['-Command', line]);"],
    ['shell-program', "require('child_process').spawn('pwsh', ['-c', line]);"],
    ['shell-program', "import { spawn } from 'node:child_process'; spawn(process.env.ComSpec, ['/c', line]);"],
    ['shell-program', "import { spawn } from 'node:child_process'; spawn(process.env['SHELL'], ['-c', line]);"],
  ];
  const QUIET: readonly string[] = [
    "import { exec } from 'node:child_process'; exec('git --version');",
    "import { execFile } from 'node:child_process'; execFile('open', [url]);",
    "import { spawn } from 'node:child_process'; spawn('a', [url], { shell: false });",
    "import { spawn } from 'node:child_process'; const o = {}; o.shell = false; spawn('a', [], o);",
    "import { spawn } from 'node:child_process'; spawn(process.execPath, [script]);",
    "import { spawnSync } from 'node:child_process'; spawnSync(client.path, args, { shell: false });",
    "import { spawn } from 'node:child_process'; spawn('shellcheck', [file]);",
    "async function f() { const { execSync } = await import('child_process'); execSync('pnpm -v'); }",
    "require('child_process').spawn('a', [url]);",
    "import 'node:child_process';",
    "const fixture = load({ shell: { OS_DATABASE_URL: 'file:x.db' } });",
    "const exec = db.exec; exec(sql, []);",
    "await seam.exec(sql);",
    "const m = /x/.exec(text);",
    "x.shell = true;",
    "// exec(`open ${url}`) and { shell: true } in a comment",
    "const s = 'exec(`x ${y}`) { shell: true }';",
    "type O = { shell: boolean };",
  ];

  it('the detector sees every spelling it claims to, and nothing it does not', () => {
    for (const [rule, source] of LOUD) expect(launchFindings(source).map((f) => f.rule), source).toEqual([rule]);
    for (const source of QUIET) expect(launchFindings(source), source).toEqual([]);
  });

  it('the detector battery keeps its floor: every rule has its loud cases, and the quiet set is whole', () => {
    // A floor per rule, not one total: a battery falling to a few cases still prints a count.
    const FLOOR: Readonly<Record<Rule, number>> = {
      'exec-non-literal': 9,
      'exec-as-value': 11,
      'shell-option': 7,
      'shell-program': 7,
    };
    const perRule = new Map<Rule, number>();
    for (const [rule] of LOUD) perRule.set(rule, (perRule.get(rule) ?? 0) + 1);
    for (const [rule, floor] of Object.entries(FLOOR) as Array<[Rule, number]>) {
      expect(perRule.get(rule) ?? 0, rule).toBeGreaterThanOrEqual(floor);
    }
    expect([...perRule.keys()].sort()).toEqual(Object.keys(FLOOR).sort());
    expect(QUIET.length).toBeGreaterThanOrEqual(18);
  });
});
