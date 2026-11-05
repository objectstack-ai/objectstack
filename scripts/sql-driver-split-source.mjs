// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sql-driver-split-source -- `SqlDriver`'s text read back as ONE source, for
 * the readers that take it by path (#30147).
 *
 * `scripts/codemod-split-sql-driver.mjs` leaves each moved method on the class
 * as a one-call stub and puts its body, byte for byte, on a static method of a
 * facet class in a `sql-driver-*.ts` module; the top-level declarations ahead
 * of the class go whole to the leaf, `sql-driver-top-level.ts`. A reader that
 * slices a method out of `sql-driver.ts` (from its signature to a line of its
 * body) or requires a literal to appear there then reads a stub, or nothing.
 * So the codemod pinned every member and declaration such a reader named, and
 * those pins are what kept the members on the class.
 *
 * {@link readSqlDriverSource} returns the text those readers were written
 * against: `sql-driver.ts` with the body of every codemod stub replaced by the
 * body of the facet method it calls, and the leaf put back ahead of the class,
 * where its declarations stood. A method's signature (the one on the class, the
 * contract) is followed by its own body, as it was before the split. It is a
 * reading, not an undo: imports, a private method's docblock (moved with its
 * body) and the stub-side spellings the codemod writes (an optional parameter
 * for a computed default, a written return type) stay as the split has them.
 * `--verify` in the codemod is the byte-for-byte undo.
 *
 * It follows exactly the stub the codemod writes and nothing else: a member
 * body whose only statement carries the codemod's marker and returns
 * `<X>Facet.<m>(…)`, `<X>Facet.<m>.call(<x>Host.of(this), …)` or the generic
 * `(<X>Facet.<m><…>)` spelling of either, with the module named in the marker.
 * Any other body is left as it stands (a hand-written delegation keeps its own
 * text). A marked body it cannot follow -- another shape, a missing module, no
 * such facet class or static member -- is a REFUSAL (it throws), never the stub
 * text: a reader handed the stub would be judging the one-line call instead of
 * the method, which is the silent miss this module exists to prevent.
 *
 * ## Inert on import
 *
 * No CLI and no top-level statement that runs anything but the `typescript`
 * load, per `check:entry-guard`. Its tests are the codemod's `--self-test`
 * battery "split readers (#30147)", which drives it over a generated split.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { requireDefaultExport } from './import-prerequisite.mjs';
import { parseSourceFile } from './ts-parse.mjs';

const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);

/** The class the stubs stand on, and the file that holds it. */
export const SQL_DRIVER_HOST = 'sql-driver.ts';
const CLASS_NAME = 'SqlDriver';

/** The module the top-level declarations moved to. */
export const SQL_DRIVER_LEAF = 'sql-driver-top-level.ts';

/** The marker comment the codemod writes on every stub. */
const MARK = '[#29520 codemod]';
const MARKED = /\[#29520 codemod\] The body moved to `(sql-driver-[a-z0-9-]+\.ts)`/;

/** `XFacet.m`, optionally parenthesised with type arguments. Returns `{ facet, member }` or null. */
function facetMemberOf(expr) {
  let e = expr;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isExpressionWithTypeArguments?.(e) || ts.isInstantiationExpression?.(e)) e = e.expression;
  if (!ts.isPropertyAccessExpression(e) || !ts.isIdentifier(e.expression) || !ts.isIdentifier(e.name)) return null;
  if (!/^[A-Z][A-Za-z0-9]*Facet$/.test(e.expression.text)) return null;
  return { facet: e.expression.text, member: e.name.text };
}

/** The facet call a stub's `return` makes, as `{ facet, member }`, or null for any other shape. */
function stubTarget(expr) {
  if (!expr || !ts.isCallExpression(expr)) return null;
  const callee = expr.expression;
  // `XFacet.m.call(xHost.of(this), …)` / `(XFacet.m<T>).call(xHost.of(this), …)`
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'call') {
    const host = expr.arguments[0];
    const ok = host && ts.isCallExpression(host)
      && ts.isPropertyAccessExpression(host.expression)
      && ts.isIdentifier(host.expression.expression)
      && /^[a-z][A-Za-z0-9]*Host$/.test(host.expression.expression.text)
      && host.expression.name.text === 'of'
      && host.arguments.length === 1
      && host.arguments[0].kind === ts.SyntaxKind.ThisKeyword;
    return ok ? facetMemberOf(callee.expression) : null;
  }
  // `XFacet.m(…)` / `(XFacet.m<T>)(…)`
  return facetMemberOf(callee);
}

/** The text between a block's braces. */
function interior(text, block) {
  return text.slice(block.getStart() + 1, block.end - 1);
}

function memberName(m) {
  return m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : null;
}

/**
 * `SqlDriver` as one text: `sql-driver.ts` with each codemod stub's body
 * replaced by its facet body, and the leaf (when it exists) ahead of the class.
 *
 * @param {string} srcDir  the directory holding `sql-driver.ts` (driver-sql's `src`)
 * @param {{ readFile?: (path: string) => string }} [options]
 * @returns {{ text: string, spliced: { member: string, module: string }[], files: string[] }}
 *   `spliced` names each stub followed and the module its body was read from;
 *   `files` every file read, the host first.
 */
export function readSqlDriverSource(srcDir, { readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  const hostText = readFile(join(srcDir, SQL_DRIVER_HOST));
  const files = [SQL_DRIVER_HOST];
  const spliced = [];
  if (!hostText.includes(MARK)) return { text: hostText, spliced, files };

  const host = parseSourceFile(SQL_DRIVER_HOST, hostText);
  const cls = host.statements.find((s) => ts.isClassDeclaration(s) && s.name?.text === CLASS_NAME);
  if (!cls) throw new Error(`${SQL_DRIVER_HOST} carries ${MARK} stubs but declares no class ${CLASS_NAME}`);

  const modules = new Map();
  const facetBody = (module, facet, member, at) => {
    if (!modules.has(module)) {
      const path = join(srcDir, module);
      if (!existsSync(path)) throw new Error(`${at}: the stub names \`${module}\`, which does not exist`);
      const text = readFile(path);
      files.push(module);
      modules.set(module, { text, sf: parseSourceFile(module, text) });
    }
    const { text, sf } = modules.get(module);
    const fc = sf.statements.find((s) => ts.isClassDeclaration(s) && s.name?.text === facet);
    if (!fc) throw new Error(`${at}: \`${module}\` declares no class ${facet}`);
    const m = fc.members.find((x) => memberName(x) === member && x.body
      && ts.getCombinedModifierFlags(x) & ts.ModifierFlags.Static);
    if (!m) throw new Error(`${at}: ${facet} in \`${module}\` has no static \`${member}\` with a body`);
    return interior(text, m.body);
  };

  const edits = [];
  for (const m of cls.members) {
    const body = m.body;
    if (!body || !ts.isBlock(body)) continue;
    const name = memberName(m) ?? (ts.isConstructorDeclaration(m) ? 'constructor' : '?');
    const inner = interior(hostText, body);
    const marked = inner.match(MARKED);
    if (!inner.includes(MARK)) continue;
    const at = `${SQL_DRIVER_HOST} ${CLASS_NAME}#${name}`;
    const only = body.statements.length === 1 ? body.statements[0] : null;
    const target = only && ts.isReturnStatement(only) ? stubTarget(only.expression) : null;
    if (!marked || !target) {
      throw new Error(`${at} carries ${MARK} but is not one \`return <X>Facet.<m>…\` stub this reader follows`);
    }
    edits.push({ start: body.getStart() + 1, end: body.end - 1, text: facetBody(marked[1], target.facet, target.member, at) });
    spliced.push({ member: name, module: marked[1] });
  }

  let text = hostText;
  for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  // The leaf goes where its declarations stood: ahead of the class, which
  // starts at the same offset in the spliced text (every edit is inside it).
  const leafPath = join(srcDir, SQL_DRIVER_LEAF);
  if (existsSync(leafPath)) {
    const at = cls.getFullStart();
    text = `${text.slice(0, at)}\n${readFile(leafPath)}${text.slice(at)}`;
    files.push(SQL_DRIVER_LEAF);
  }
  return { text, spliced, files };
}
