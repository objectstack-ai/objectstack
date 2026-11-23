// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: the CLI starts programs from an argv array, without a shell.
 *
 * Over every `.ts` file under `packages/cli/src`, read as a TypeScript AST
 * (comments and strings cannot match):
 *
 *   - `exec-non-literal` — a call to `child_process`'s `exec` / `execSync`
 *     (named or renamed import, namespace or default import, or a
 *     destructured `await import(…)` / `require(…)`) whose command is anything
 *     but one plain string literal: a template, a concatenation, a variable.
 *   - `shell-option` — in a file that loads `child_process`, an
 *     object-literal `shell` property whose value is anything but the literal
 *     `false` (`true`, a platform test, a variable, the shorthand `{ shell }`).
 *     A file that never loads it has no use for the option, and its `shell`
 *     keys mean something else (the shell's environment, in a test fixture).
 *
 * The findings must equal {@link ALLOWED} exactly, per file and rule: a new
 * launch of either kind reds here, and so does an allowance nothing needs any
 * more. An allowance is a measured exception, each with the reason it is
 * safe; ⛔ never add one for a command line that carries text the CLI did not
 * write itself or validate to a fixed character set.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

type Rule = 'exec-non-literal' | 'shell-option';

interface Allowance {
  readonly file: string;
  readonly rule: Rule;
  readonly count: number;
  readonly reason: string;
}

const ALLOWED: readonly Allowance[] = [
  {
    file: 'commands/doctor.ts',
    rule: 'exec-non-literal',
    count: 1,
    reason:
      '`probeTool(command)` runs only the constant probes `pnpm -v`, `tsc -v` and `git --version`, through the shell on '
      + 'purpose: the probe answers what the shell would find (see the comment above `probeTool`).',
  },
  {
    file: 'commands/dev.ts',
    rule: 'exec-non-literal',
    count: 1,
    reason: '`pnpm [--filter PACKAGE --fail-if-no-match] dev`, where PACKAGE is the positional argument the user typed.',
  },
  {
    file: 'commands/init.ts',
    rule: 'exec-non-literal',
    count: 1,
    reason: '`PM install`, where PM is one of the closed set npm | pnpm | yarn | bun.',
  },
  {
    file: 'utils/skills-catalog.ts',
    rule: 'shell-option',
    count: 1,
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

function isChildProcessLoad(node: ts.Expression | undefined): boolean {
  if (!node) return false;
  const inner = ts.isAwaitExpression(node) ? node.expression : node;
  if (!ts.isCallExpression(inner)) return false;
  const [arg] = inner.arguments;
  const loads = inner.expression.kind === ts.SyntaxKind.ImportKeyword
    || (ts.isIdentifier(inner.expression) && inner.expression.text === 'require');
  return loads && !!arg && ts.isStringLiteralLike(arg) && CHILD_PROCESS.test(arg.text);
}

/** Every finding in one file's source, as `rule` per occurrence. */
function launchFindings(source: string, fileName = 'file.ts'): Rule[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const execNames = new Set<string>();
  const namespaces = new Set<string>();
  let loadsChildProcess = false;

  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && CHILD_PROCESS.test(node.moduleSpecifier.text)) {
      loadsChildProcess = true;
      const clause = node.importClause;
      if (clause?.name) namespaces.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (EXEC_FAMILY.has((el.propertyName ?? el.name).text)) execNames.add(el.name.text);
        }
      }
    }
    if (ts.isCallExpression(node) && isChildProcessLoad(node)) loadsChildProcess = true;
    if (ts.isVariableDeclaration(node) && isChildProcessLoad(node.initializer)) {
      if (ts.isIdentifier(node.name)) namespaces.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : undefined;
          if (ts.isIdentifier(el.name) && EXEC_FAMILY.has(imported ?? el.name.text)) execNames.add(el.name.text);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const findings: Rule[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isExec = (ts.isIdentifier(callee) && execNames.has(callee.text))
        || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          && namespaces.has(callee.expression.text) && EXEC_FAMILY.has(callee.name.text));
      const [command] = node.arguments;
      if (isExec && !(command && (ts.isStringLiteral(command) || ts.isNoSubstitutionTemplateLiteral(command)))) {
        findings.push('exec-non-literal');
      }
    }
    if (loadsChildProcess && ts.isPropertyAssignment(node) && node.name.getText(sf).replace(/^['"]|['"]$/g, '') === 'shell'
      && ts.isObjectLiteralExpression(node.parent) && node.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
      findings.push('shell-option');
    }
    if (loadsChildProcess && ts.isShorthandPropertyAssignment(node) && node.name.text === 'shell') findings.push('shell-option');
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

describe('the CLI starts programs from an argv array, without a shell', () => {
  it('finds no exec with a built command line and no shell option outside the measured allowances', () => {
    const counts = new Map<string, number>();
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      for (const rule of launchFindings(readFileSync(file, 'utf-8'), file)) {
        const key = `${rel} ${rule}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const found = [...counts].map(([key, count]) => `${key} ×${count}`).sort();
    const allowed = ALLOWED.map((a) => `${a.file} ${a.rule} ×${a.count}`).sort();
    expect(found).toEqual(allowed);
  });

  it('the detector sees every spelling it claims to, and nothing it does not', () => {
    // Each line below is one finding; each `quiet` line must find nothing.
    const loud = [
      "import { exec } from 'node:child_process'; exec(`open ${u}`);",
      "import { execSync as run } from 'child_process'; run('a ' + b);",
      "import * as cp from 'node:child_process'; cp.exec(cmd);",
      "import cp from 'child_process'; cp.execSync(`x ${y}`);",
      "async function f() { const { exec } = await import('node:child_process'); exec(cmd); }",
      "const { execSync: go } = require('child_process'); go(cmd);",
      "import { spawn } from 'node:child_process'; spawn('a', [], { shell: true });",
      "import { spawnSync } from 'child_process'; spawnSync('a', [], { shell: process.platform === 'win32' });",
      "import { execFile } from 'node:child_process'; const shell = true; execFile('a', [], { shell });",
      "async function f() { const cp = await import('node:child_process'); cp.spawn('a', [], { 'shell': flag }); }",
      "const opts = { shell: true }; require('child_process').spawn('a', [], opts);",
    ];
    for (const line of loud) expect(launchFindings(line), line).toHaveLength(1);
    const quiet = [
      "import { exec } from 'node:child_process'; exec('git --version');",
      "import { execFile } from 'node:child_process'; execFile('open', [url]);",
      "import { spawn } from 'node:child_process'; spawn('a', [url], { shell: false });",
      "const fixture = load({ shell: { OS_DATABASE_URL: 'file:x.db' } });",
      "const exec = db.exec; exec(sql, []);",
      "await seam.exec(sql);",
      "const m = /x/.exec(text);",
      "// exec(`open ${url}`) and { shell: true } in a comment",
      "const s = 'exec(`x ${y}`) { shell: true }';",
      "type O = { shell: boolean };",
    ];
    for (const line of quiet) expect(launchFindings(line), line).toEqual([]);
  });
});
