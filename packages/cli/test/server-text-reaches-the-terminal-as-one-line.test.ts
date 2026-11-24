// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Server text reaches the terminal as one line of printable characters, in
 * `os mcp connect` and the device-flow sign-ins (`os login`, `os cloud login`).
 *
 * Two halves:
 *
 *   1. `terminalText`, the one sanitiser: what it rewrites, what it leaves
 *      alone, and its cap.
 *   2. A TypeScript-AST source pin over the files those flows print from
 *      ({@link FLOW_FILES}). Every argument of a print site (the `print*`
 *      helpers, `console.*`, `process.stdout|stderr.write`, `this.log|warn|
 *      error`), every `new Error(…)` message and every object-literal
 *      `message:` must be made only of: string or number literals; a
 *      `terminalText(…)` call; a call to a {@link TEXT_FUNCTIONS} function,
 *      whose own returns this pin holds to the same rule; a `const` in the
 *      same file whose initializer is so made; an element of a `const` array
 *      of string literals; a `.length`; template, `+`, `||`, `??` and `?:`
 *      compositions of those; `XS.map(x => …).join('…')` with a body so made;
 *      or an expression in the file's {@link LINE_SAFE} roster, each held to a
 *      fixed character set elsewhere and named with that reason. Anything else
 *      is a finding, and the findings must be empty: a new print site, a new
 *      thrown message or a new interpolation of any value reds here until it
 *      goes through `terminalText` or is added to the roster with its reason.
 *
 * Out of the pin, by design: `--json` records, which `JSON.stringify` writes
 * as one line with every C0 control escaped and whose fields are the server's
 * own by contract; and a value printed by a helper outside {@link FLOW_FILES}
 * (`printError` and friends format, they never take server text themselves).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { TERMINAL_TEXT_MAX, terminalText } from '../src/utils/terminal-text.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

/** A character that is not printable on one line: C0, DEL, C1, the line and paragraph separators, the bidirectional controls. */
function unprintable(text: string): boolean {
  return Array.from(text).some((character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0x061c
      || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
  });
}

describe('terminalText: one line of printable characters', () => {
  it('1: every C0 control, DEL and C1 control is written as a visible escape', () => {
    for (let code = 0; code <= 0x9f; code += 1) {
      if (code >= 0x20 && code < 0x7f) continue;
      const out = terminalText(`a${String.fromCharCode(code)}b`);
      expect(unprintable(out), `code ${code}`).toBe(false);
      expect(out, `code ${code}`).toBe(`a\\x${code.toString(16).padStart(2, '0')}b`);
    }
  });

  it('2: the line and paragraph separators and the bidirectional controls are written as a visible escape', () => {
    for (const code of [0x2028, 0x2029, 0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      const out = terminalText(`a${String.fromCharCode(code)}b`);
      expect(unprintable(out), `code ${code}`).toBe(false);
      expect(out).toBe(`a\\u${code.toString(16).padStart(4, '0')}b`);
    }
  });

  it('3: an escape sequence loses its introducer, so it prints as plain text', () => {
    const sequences = ['\x1b[2A\x1b[2K', '\x1b]52;c;dGV4dA==\x07', '\x1b]0;title\x1b\\', `${String.fromCharCode(0x9b)}1A`, '\x1bc'];
    for (const sequence of sequences) {
      const out = terminalText(`before${sequence}after`);
      expect(unprintable(out), JSON.stringify(sequence)).toBe(false);
      expect(out.startsWith('before') && out.endsWith('after')).toBe(true);
    }
  });

  it('4: printable text, non-Latin scripts and emoji come back unchanged, and a second pass changes nothing', () => {
    for (const plain of ['Acme Production (EU)', 'https://sign-in.example.test/device?user_code=ABCD-EFGH', '生产环境', 'café ☕']) {
      expect(terminalText(plain)).toBe(plain);
    }
    const once = terminalText('a\x1b[31mb\nc');
    expect(terminalText(once)).toBe(once);
  });

  it('5: the result is capped, the ellipsis counted, and non-strings are printed by their string form', () => {
    const long = terminalText('x'.repeat(TERMINAL_TEXT_MAX * 2));
    expect(Array.from(long)).toHaveLength(TERMINAL_TEXT_MAX);
    expect(long.endsWith(String.fromCharCode(0x2026))).toBe(true);
    expect(Array.from(terminalText('\x1b'.repeat(TERMINAL_TEXT_MAX)))).toHaveLength(TERMINAL_TEXT_MAX);
    expect(terminalText('abcdef', 4)).toBe(`abc${String.fromCharCode(0x2026)}`);
    expect(terminalText(404)).toBe('404');
    expect(terminalText(undefined)).toBe('undefined');
  });
});

/** The files `os mcp connect`, `os login` and `os cloud login` print from. */
const FLOW_FILES = [
  'commands/mcp/connect.ts',
  'commands/login.ts',
  'commands/cloud/login.ts',
  'utils/auth-flows.ts',
  'utils/install-target.ts',
  'utils/open-browser.ts',
] as const;

/** The sanitiser. */
const SANITISERS = new Set(['terminalText']);

/** Functions whose answer is printed as is; each one's own `return`s are held to the rule. */
const TEXT_FUNCTIONS = new Set(['describeEnvironment', 'browserOpenNotice']);

/**
 * Expressions printed as they are, each held to a fixed character set where it
 * is made. They are not passed through `terminalText` because its cap would
 * cut a line the user copies.
 */
const LINE_SAFE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'commands/mcp/connect.ts': {
    name: '`--name` held to SERVER_NAME, else `environmentServerName` (letters, digits, `-`, `_`) or a constant.',
    mcpUrl: '`mcpUrlFromBase` / `mcpUrlFromOrigin`: held to LINE_SAFE_URL.',
    line: '`claudeMcpAddLine(name, mcpUrl)`: a constant word list and the two values above.',
    'target.message': '`resolveInstallTarget`\'s refusal: its `message:` templates in utils/install-target.ts are held to this rule here.',
  },
  'commands/login.ts': {
    promptText: '`promptPassword(promptText)`: every caller passes a string literal.',
  },
  'commands/cloud/login.ts': {
    promptText: '`promptPassword(promptText)`: every caller passes a string literal.',
  },
};

const PRINTERS = new Set([
  'printError', 'printErrorToStderr', 'printStep', 'printSuccess', 'printKV', 'printInfo', 'printWarning',
  'printWarningToStderr', 'printHeader',
]);
const CONSOLE_METHODS = new Set(['log', 'error', 'warn', 'info']);

type Sink = 'printer' | 'console' | 'stream' | 'error' | 'message' | 'text-function';

interface Finding {
  readonly sink: Sink;
  readonly fn: string;
  readonly site: string;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

function enclosingFunctionName(node: ts.Node): string {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if ((ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur) || ts.isFunctionExpression(cur)) && cur.name) {
      return cur.name.getText();
    }
    if (ts.isArrowFunction(cur) && cur.parent && ts.isVariableDeclaration(cur.parent)) return cur.parent.name.getText();
  }
  return '(top level)';
}

/** Every sink in `source` whose text is not made as the header says, and the number of sinks seen. */
function unsafePrints(
  source: string,
  roster: Readonly<Record<string, string>> = {},
  fileName = 'file.ts',
): { findings: Finding[]; sinks: number; used: Set<string> } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const declarations = new Map<string, Array<{ isConst: boolean; initializer?: ts.Expression }>>();
  const declare = (name: string, isConst: boolean, initializer?: ts.Expression): void => {
    declarations.set(name, [...(declarations.get(name) ?? []), { isConst, initializer }]);
  };
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const list = node.parent;
      const isConst = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
      declare(node.name.text, isConst, node.initializer);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) declare(node.name.text, false);
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) declare(node.name.text, false);
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const used = new Set<string>();
  const safe = (node: ts.Node, seen: ReadonlySet<string> = new Set()): boolean => {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      return safe(node.expression, seen);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return true;
    if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => safe(span.expression, seen));
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const composes = op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.BarBarToken
        || op === ts.SyntaxKind.QuestionQuestionToken;
      return composes && safe(node.left, seen) && safe(node.right, seen);
    }
    if (ts.isConditionalExpression(node)) return safe(node.whenTrue, seen) && safe(node.whenFalse, seen);
    const text = collapse(node.getText(sf));
    if (Object.prototype.hasOwnProperty.call(roster, text)) {
      used.add(text);
      return true;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) return SANITISERS.has(callee.text) || TEXT_FUNCTIONS.has(callee.text);
      // `'*'.repeat(n)`: a method of a string literal.
      if (ts.isPropertyAccessExpression(callee) && ts.isStringLiteralLike(callee.expression)) return true;
      // `XS.map((x) => …).join('…')`, the body made as the header says.
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'join'
        && node.arguments.every((arg) => ts.isStringLiteralLike(arg))
        && ts.isCallExpression(callee.expression) && ts.isPropertyAccessExpression(callee.expression.expression)
        && callee.expression.expression.name.text === 'map') {
        const [mapper] = callee.expression.arguments;
        return !!mapper && ts.isArrowFunction(mapper) && !ts.isBlock(mapper.body) && safe(mapper.body, seen);
      }
      return false;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'length') return true;
    if (ts.isIdentifier(node)) {
      const found = declarations.get(node.text) ?? [];
      if (found.length === 0 || seen.has(node.text)) return false;
      const next = new Set([...seen, node.text]);
      return found.every((d) => d.isConst && !!d.initializer && safe(d.initializer, next));
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const found = declarations.get(node.expression.text) ?? [];
      return found.length > 0 && found.every((d) => d.isConst && !!d.initializer
        && ts.isArrayLiteralExpression(d.initializer) && d.initializer.elements.every((el) => ts.isStringLiteralLike(el)));
    }
    return false;
  };

  const findings: Finding[] = [];
  let sinks = 0;
  const check = (sink: Sink, at: ts.Node, values: readonly ts.Node[]): void => {
    sinks += 1;
    if (values.every((value) => safe(value))) return;
    let statement: ts.Node = at;
    while (statement.parent && !ts.isStatement(statement)) statement = statement.parent;
    findings.push({ sink, fn: enclosingFunctionName(at), site: collapse(statement.getText(sf)) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && PRINTERS.has(callee.text)) check('printer', node, node.arguments);
      if (ts.isPropertyAccessExpression(callee)) {
        const owner = callee.expression;
        const method = callee.name.text;
        if (ts.isIdentifier(owner) && owner.text === 'console' && CONSOLE_METHODS.has(method)) {
          check('console', node, node.arguments);
        }
        if (method === 'write' && ts.isPropertyAccessExpression(owner) && ts.isIdentifier(owner.expression)
          && owner.expression.text === 'process' && (owner.name.text === 'stdout' || owner.name.text === 'stderr')) {
          check('stream', node, node.arguments.slice(0, 1));
        }
        if (owner.kind === ts.SyntaxKind.ThisKeyword && (method === 'log' || method === 'warn' || method === 'error')) {
          check('printer', node, node.arguments.slice(0, 1));
        }
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Error') {
      check('error', node, (node.arguments ?? []).slice(0, 1));
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'message' && ts.isObjectLiteralExpression(node.parent)) {
      check('message', node, [node.initializer]);
    }
    if (ts.isReturnStatement(node) && node.expression) {
      for (let cur = node.parent; cur; cur = cur.parent) {
        if (ts.isFunctionLike(cur)) {
          if (ts.isFunctionDeclaration(cur) && cur.name && TEXT_FUNCTIONS.has(cur.name.text)) {
            check('text-function', node, [node.expression]);
          }
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { findings, sinks, used };
}

describe('every print site in os mcp connect and the device-flow sign-ins takes server text only through terminalText', () => {
  let perFile: Array<{ file: string; findings: Finding[]; sinks: number; used: Set<string> }> = [];

  beforeAll(() => {
    perFile = FLOW_FILES.map((file) => {
      const source = readFileSync(resolve(SRC, file), 'utf-8');
      return { file, ...unsafePrints(source, LINE_SAFE[file], file) };
    });
  });

  it('1: no print site, thrown message or refusal message prints a value that is not sanitised or line-safe', () => {
    const findings = perFile.flatMap(({ file, findings: list }) => list.map((f) => `${file} · ${f.sink} · ${f.fn} · ${f.site}`));
    expect(findings).toEqual([]);
  });

  it('2: the walk sees the print sites: every flow file holds some, and the total keeps its floor', () => {
    for (const { file, sinks } of perFile) expect(sinks, file).toBeGreaterThan(0);
    expect(perFile.reduce((total, { sinks }) => total + sinks, 0)).toBeGreaterThanOrEqual(100);
  });

  it('3: every roster entry is still printed somewhere, so none outlives its use', () => {
    for (const [file, roster] of Object.entries(LINE_SAFE)) {
      const { used } = perFile.find((entry) => entry.file === file)!;
      expect([...used].sort(), file).toEqual(Object.keys(roster).sort());
    }
  });

  // Each LOUD source must find exactly one finding, of the named sink; a QUIET source none.
  const LOUD: ReadonlyArray<readonly [Sink, string]> = [
    ['printer', 'printError(err.message);'],
    ['printer', 'printKV(\'Email\', user.email);'],
    ['printer', 'printStep(`Connecting to ${where}`);'],
    ['printer', 'let where = describe(); printSuccess(`at ${where}`);'],
    ['printer', 'class C { run() { this.log(`x ${y}`); } }'],
    ['printer', 'printError(ok ? \'fine\' : `bad ${reason}`);'],
    ['console', 'console.log(`  ${verificationUrl}`);'],
    ['console', 'console.error(\'a\' + b);'],
    ['console', 'const line = build(x); console.log(line);'],
    ['console', 'console.log(rows.map((r) => r.name).join(\'\\n\'));'],
    ['stream', 'process.stdout.write(`\\r ${frame}`);'],
    ['stream', 'process.stderr.write(text);'],
    ['stream', 'function p(promptText) { process.stdout.write(promptText); }'],
    ['error', 'throw new Error(`Polling failed: ${json.error_description}`);'],
    ['error', 'throw new Error(\'Device request failed: \' + res.statusText);'],
    ['message', 'const r = { kind: \'refused\', message: `${needs}: ${listed.error}` };'],
    ['message', 'return { message: e.message };'],
    ['text-function', 'function describeEnvironment(env) { return env.displayName; }'],
    ['text-function', 'function browserOpenNotice(result) { return `  (${result})`; }'],
  ];
  const QUIET: readonly string[] = [
    'printHeader(\'MCP connect\'); console.log(\'\');',
    'printError(terminalText(err.message));',
    'printKV(\'Email\', terminalText(user?.email || email));',
    'const notFound = \'a\' + \'b\'; printError(missing ? notFound : `x ${terminalText(p)}`);',
    'const where = describeEnvironment(env); printStep(`Connecting to ${where}`);',
    'const spin = [\'a\', \'b\']; process.stdout.write(`\\r ${spin[i % spin.length]} wait`);',
    'process.stdout.write(\'\\r\\x1b[K\');',
    'throw new Error(`Polling failed (${terminalText(s)}): ${terminalText(d)}`);',
    'const m = { message: `${list.length} found:\\n` + list.map((e) => `- ${describeEnvironment(e)}`).join(\'\\n\') };',
    'console.log(browserOpenNotice(openBrowser(url)));',
    'process.stdout.write(\'*\'.repeat(n));',
    'function describeEnvironment(env) { return env.displayName ? `${terminalText(env.displayName)}` : terminalText(env.id); }',
    'const x = { error: e.message }; emitRecord(x);',
    '// printError(err.message) in a comment',
  ];

  it('4: the detector sees every spelling it claims to, and nothing it does not', () => {
    for (const [sink, source] of LOUD) {
      expect(unsafePrints(source).findings.map((f) => f.sink), source).toEqual([sink]);
    }
    for (const source of QUIET) expect(unsafePrints(source).findings, source).toEqual([]);
    // A roster entry makes its expression line-safe, and only that expression.
    expect(unsafePrints('console.log(`  Endpoint  ${mcpUrl}`);', { mcpUrl: 'held' }).findings).toEqual([]);
    expect(unsafePrints('console.log(`  Endpoint  ${mcpUrl} ${other}`);', { mcpUrl: 'held' }).findings).toHaveLength(1);
  });

  it('5: the detector battery keeps its floor for every sink', () => {
    const FLOOR: Readonly<Record<Sink, number>> = {
      printer: 6, console: 4, stream: 3, error: 2, message: 2, 'text-function': 2,
    };
    const perSink = new Map<Sink, number>();
    for (const [sink] of LOUD) perSink.set(sink, (perSink.get(sink) ?? 0) + 1);
    for (const [sink, floor] of Object.entries(FLOOR) as Array<[Sink, number]>) {
      expect(perSink.get(sink) ?? 0, sink).toBeGreaterThanOrEqual(floor);
    }
    expect([...perSink.keys()].sort()).toEqual(Object.keys(FLOOR).sort());
    expect(QUIET.length).toBeGreaterThanOrEqual(14);
  });
});
