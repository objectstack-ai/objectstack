#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-facade-delegation-only — a class that has been split into facade form
 * stays a facade: every member body in it is a delegation, never logic.
 *
 *   node scripts/check-facade-delegation-only.mjs               # the gate
 *   node scripts/check-facade-delegation-only.mjs --verbose     # + one line per judged member
 *   node scripts/check-facade-delegation-only.mjs --self-test   # its own fixtures
 *   node scripts/check-facade-delegation-only.mjs --root DIR [--registry FILE]
 *                                                               # judge another checkout
 *
 * ## Why it exists
 *
 * The large-file programme (#29465) turns the two biggest classes of the
 * platform into thin facades: `ObjectStackProtocolImplementation` in
 * `packages/metadata-protocol/src/protocol.ts` (#29985) and `ObjectQL` in
 * `packages/objectql/src/engine.ts` (#29986). Every member keeps its public
 * signature and docblock on the class and forwards to a facet class in its own
 * module. Nothing stops the next feature from landing its body back in the
 * facade, and then the file grows again. The maintainer ruled the facade form
 * and named this gate as its guard, in place of the 13,000-line bar (ruling
 * 6624258595 on #29465, item 3: "once a file lands in facade form, a gate
 * refuses a method body in the facade file (delegations only)"). Card: #30019.
 *
 * ## What it reads
 *
 * `scripts/facade-delegation-registry.json`, two lists:
 *
 *   facades     { file, class, card }    a file that has LANDED in facade form,
 *                                        the class in it that is the facade, and
 *                                        the card that landed it.
 *   exceptions  { file, member, card, reason? }
 *                                        a member of a registered facade that may
 *                                        keep a body for now, and the card that
 *                                        will move it (ruling 6624345766 item 3).
 *
 * The next split adds one `facades` row. ⛔ A file joins only once it is in
 * facade form on `main`, so the gate never reds `main` ahead of a landing: the
 * PR that lands the facade (or the first PR after it) adds the row.
 *
 * ## What a delegation is
 *
 * The ruling's word is "a one-line forwarding call". This gate spells it as a
 * grammar over the AST, from the shapes the two codemods generate and the
 * shapes the hand series (#25467) left behind, rather than from a regex over
 * text:
 *
 *   forwarding call   `ref(arg, …)` where `ref` is a name or a `.`-chain off a
 *                     name or `this` (`ProtocolSaveFacet.saveMetaItem`,
 *                     `convertStoredItem.call`, `this.other`), and every
 *                     argument is a name, `this`, a literal, a `.`-chain, a
 *                     spread of one of those, ONE level of nested forwarding
 *                     call (`protocolHost(this)`), or a forwarding arrow.
 *                     `as` / `!` / `satisfies` / parentheses are transparent;
 *                     `await` is allowed on the call a body returns.
 *   forwarding arrow  an expression-bodied arrow with plain parameters whose
 *                     body is a forwarding call, an argument as above, or an
 *                     object literal of forwarders (a host).
 *
 *   method / accessor body   ONE statement: `return <forwarding call>`,
 *                     `<forwarding call>;`, `return <.-chain>` (a getter over
 *                     state), or `<.-chain> = <argument>` (a setter). It may be
 *                     preceded by `const` declarations whose initializers are
 *                     forwarding arrows or host object literals of forwarders:
 *                     the hand series' `.call(host, …)` stub, which builds a host
 *                     of one-line forwarders and makes one forwarding call.
 *   constructor       wiring only: `super(…)`, `this.x = <argument>` or
 *                     `this.x = new Ref(<arguments>)`, and forwarding calls.
 *   static block      forwarding calls only (the host factory
 *                     `installProtocolHost((p) => ({ x: (...a) => p.x(...a) }))`).
 *   field             any declaration; an initializer holding a function must
 *                     hold a forwarding arrow — a block-bodied arrow, a function
 *                     expression or a class expression in a field is a body.
 *   parameters        a default value must be a literal or a `.`-chain: a
 *                     computed default is a body in the signature.
 *
 * Anything else is a body: a branch, a loop, a `try`, a local `let`, an
 * operator, a template with substitutions, an object literal built inline as an
 * argument, a nested call two levels deep. A member kind this file does not know
 * is refused too (fail closed).
 *
 * ## Exceptions — named, carded, and dead once their card lands
 *
 * Today's facade keeps shared state on the class, so a few hot bodies may stay
 * (ruling 6624345766 item 3). Each one is an `exceptions` row naming the file,
 * the member and the card that will move it (#30020, the state-owning facets
 * card). The registry is refused, not trusted:
 *
 *   • a row with no card, or a card that is not `#<number>`        → red
 *   • a row naming a file that is not a registered facade           → red
 *   • a row naming a member the class does not have                 → red
 *   • a row naming a member that is ALREADY a delegation            → red
 *     (its card landed: delete the row, the member stays a delegation)
 *   • two rows for one member, or a key the registry does not know  → red
 *
 * ## ⛔ No silent no-op
 *
 * A gate that cannot see its input and exits 0 converts "nobody is looking"
 * into "something looked and it is fine". So:
 *
 *   • a registered facade file that does not exist                  → red
 *   • a registered class that is not in the file, or is there twice → red
 *   • a registered facade in which ZERO members read as delegations → red
 *     (the file is not in facade form, or this grammar no longer
 *     recognises what the codemod generates — both need a human)
 *   • a source that does not parse                                   → exit 3
 *     (`scripts/ts-parse.mjs`)
 *   • an EMPTY `facades` list is legal (nothing has landed yet) and the
 *     success line says, in words, that the gate guards nothing.
 *
 * ## What it does NOT judge (measured, so nobody assumes it)
 *
 * Only the members of the registered class. Top-level functions in the facade
 * file and other classes in it are outside the ruling's "method body" and
 * outside this gate. Measured on #29998's facade head `bba9d24d`: `protocol.ts`
 * holds two top-level functions (24 lines) and one class.
 *
 * Exit codes: 0 every registered facade is delegation-only (exceptions aside);
 * 1 a body, a registry problem or an unreadable facade; 2 bad arguments;
 * 3 a source that does not parse.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url, {
  measures: 'whether every member of a registered facade class is a delegation to its facet (#30019)',
});
import { parseSourceFile } from './ts-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
export const REGISTRY_FILE = 'scripts/facade-delegation-registry.json';

const CARD_REF = /^#[1-9][0-9]*$/;
const FACADE_KEYS = Object.freeze(['file', 'class', 'card']);
const EXCEPTION_KEYS = Object.freeze(['file', 'member', 'card', 'reason']);

/** One level of nested call in an argument: `protocolHost(this)`. Two is logic. */
const MAX_NESTED_CALL_DEPTH = 1;

export const FIX_LINE =
  'move the body into its facet module and delegate to it in one forwarding call ' +
  '(`return <Facet>.<member>(<host>, ...args)`); a member that cannot move yet takes an ' +
  `exceptions row in ${REGISTRY_FILE} naming the card that will move it`;

// ── The delegation grammar ─────────────────────────────────────────────────

function unwrap(e) {
  while (
    e &&
    (ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isExpressionWithTypeArguments(e))
  ) {
    e = e.expression;
  }
  return e;
}

/** A name, `this`, or a `.`-chain off one of those (no call, no `?.`, no `[]`). */
function isReference(e) {
  e = unwrap(e);
  if (!e) return false;
  if (ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(e) && !e.questionDotToken) return isReference(e.expression);
  return false;
}

function isLiteral(e) {
  e = unwrap(e);
  switch (e.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
      return true;
    default:
      return (
        ts.isPrefixUnaryExpression(e) &&
        e.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(e.operand)
      );
  }
}

/** A default that is data, not a computation: `'x'`, `-1`, `CONST.X`, `{}`, `[]`, `{ a: 1 }`. */
function isDataValue(e) {
  e = unwrap(e);
  if (!e) return false;
  if (isLiteral(e) || isReference(e)) return true;
  if (ts.isArrayLiteralExpression(e)) return e.elements.every(isDataValue);
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.every((p) =>
      (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && isDataValue(p.initializer)) ||
      (ts.isShorthandPropertyAssignment(p) && !p.objectAssignmentInitializer));
  }
  return false;
}

function isPlainParameter(p) {
  return ts.isIdentifier(p.name) && (!p.initializer || isDataValue(p.initializer));
}

function isArgument(e, depth) {
  e = unwrap(e);
  if (!e) return false;
  if (isLiteral(e) || isReference(e)) return true;
  if (ts.isSpreadElement(e)) return isArgument(e.expression, depth);
  if (ts.isCallExpression(e)) return depth < MAX_NESTED_CALL_DEPTH && isForwardingCall(e, depth + 1);
  if (ts.isArrowFunction(e)) return isForwardingArrow(e);
  return false;
}

function isForwardingCall(e, depth = 0) {
  e = unwrap(e);
  if (!e || !ts.isCallExpression(e) || e.questionDotToken) return false;
  if (!isReference(e.expression)) return false;
  return e.arguments.every((a) => isArgument(a, depth));
}

function isForwardingArrow(fn) {
  if (!ts.isArrowFunction(fn)) return false;
  if (!fn.parameters.every(isPlainParameter)) return false;
  // The hand series' writer closure `(value: T) => { this.x = value; }` is the
  // one block body a forwarder may have: exactly one forwarding statement.
  if (ts.isBlock(fn.body)) {
    return fn.body.statements.length === 1 &&
      (isForwardingStatement(fn.body.statements[0]) || isForwardingReturn(fn.body.statements[0]));
  }
  return isForwarderValue(fn.body);
}

/** What a host's slot, a reader closure or a forwarding arrow's body may hold. */
function isForwarderValue(e) {
  e = unwrap(e);
  if (!e) return false;
  if (isArgument(e, 0)) return true;
  if (ts.isObjectLiteralExpression(e)) return e.properties.every(isForwarderProperty);
  return false;
}

function isOneLineAccessorBody(body, accept) {
  return !!body && body.statements.length === 1 && accept(body.statements[0]);
}

function isForwarderProperty(p) {
  if (p.name && ts.isComputedPropertyName(p.name)) return false;
  if (ts.isPropertyAssignment(p)) return isForwarderValue(p.initializer);
  if (ts.isShorthandPropertyAssignment(p)) return !p.objectAssignmentInitializer;
  if (ts.isSpreadAssignment(p)) return isReference(p.expression);
  if (ts.isGetAccessorDeclaration(p)) {
    return isOneLineAccessorBody(p.body, (s) => ts.isReturnStatement(s) && !!s.expression && isForwarderValue(s.expression));
  }
  if (ts.isSetAccessorDeclaration(p)) {
    return p.parameters.every(isPlainParameter) && isOneLineAccessorBody(p.body, (s) => isForwardingStatement(s));
  }
  if (ts.isMethodDeclaration(p)) {
    return p.parameters.every(isPlainParameter) && isOneLineAccessorBody(p.body, (s) => isForwardingStatement(s) || isForwardingReturn(s));
  }
  return false;
}

function stripAwait(e) {
  e = unwrap(e);
  return e && ts.isAwaitExpression(e) ? unwrap(e.expression) : e;
}

function isStateWrite(e) {
  e = unwrap(e);
  return (
    !!e &&
    ts.isBinaryExpression(e) &&
    e.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    isReference(e.left) &&
    isArgument(e.right, 0)
  );
}

function isForwardingStatement(s) {
  if (!ts.isExpressionStatement(s)) return false;
  const e = stripAwait(s.expression);
  return isForwardingCall(e) || isStateWrite(e);
}

function isForwardingReturn(s) {
  if (!ts.isReturnStatement(s) || !s.expression) return false;
  const e = stripAwait(s.expression);
  return isForwardingCall(e) || isReference(e);
}

function isForwardingDeclaration(s) {
  if (!ts.isVariableStatement(s)) return false;
  if (!(s.declarationList.flags & ts.NodeFlags.Const)) return false;
  return s.declarationList.declarations.every(
    (d) => ts.isIdentifier(d.name) && !!d.initializer && isForwarderValue(d.initializer),
  );
}

// `ts.SyntaxKind[k]` answers the LAST name an enum value carries, and some
// carry range markers (`VariableStatement` reads back as `FirstStatement`).
let kindNames = null;
function kindName(n) {
  if (!kindNames) {
    kindNames = new Map();
    for (const [name, value] of Object.entries(ts.SyntaxKind)) {
      if (typeof value !== 'number' || /^(First|Last)/.test(name) || kindNames.has(value)) continue;
      kindNames.set(value, name);
    }
  }
  return kindNames.get(n.kind) ?? String(n.kind);
}

/**
 * A method or accessor body → `{ shape }` when it is a delegation, or
 * `{ why }` naming the first statement that is not.
 */
function judgeDelegationBody(block) {
  const stmts = block.statements;
  if (stmts.length === 0) return { why: 'an empty body forwards to nothing' };
  const last = stmts[stmts.length - 1];
  for (let i = 0; i < stmts.length - 1; i += 1) {
    if (!isForwardingDeclaration(stmts[i])) {
      return { why: `statement ${i + 1} of ${stmts.length} (${kindName(stmts[i])}) is not a forwarding declaration` };
    }
  }
  if (isForwardingReturn(last) || isForwardingStatement(last)) {
    if (stmts.length > 1) return { shape: 'host-literal stub (`const host = {…}; return fn.call(host, …)`)' };
    const e = ts.isReturnStatement(last) ? stripAwait(last.expression) : stripAwait(last.expression);
    if (isReference(e)) return { shape: 'state read (`return this.x`)' };
    if (isStateWrite(e)) return { shape: 'state write (`this.x = v`)' };
    const hostArg = e.arguments.some((a) => ts.isCallExpression(unwrap(a)));
    return { shape: hostArg ? 'host delegation (`return Fn(host(this), …)`)' : 'forwarding call (`return fn(…args)`)' };
  }
  return {
    why:
      stmts.length === 1
        ? `its one statement (${kindName(last)}) is not a forwarding call`
        : `its last statement (${kindName(last)}) is not a forwarding call`,
  };
}

function isConstructorWiring(s) {
  if (!ts.isExpressionStatement(s)) return false;
  const e = unwrap(s.expression);
  if (ts.isCallExpression(e) && e.expression.kind === ts.SyntaxKind.SuperKeyword) {
    return e.arguments.every((a) => isArgument(a, 0));
  }
  if (
    ts.isBinaryExpression(e) &&
    e.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(e.left) &&
    e.left.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    const right = unwrap(e.right);
    if (ts.isNewExpression(right)) {
      return isReference(right.expression) && (right.arguments ?? []).every((a) => isArgument(a, 0));
    }
    return isArgument(right, 0);
  }
  return isForwardingCall(e);
}

/** The first function-like node in a field initializer that is a body, or null. */
function bodyInInitializer(init) {
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (ts.isArrowFunction(n) && isForwardingArrow(n)) return;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isClassExpression(n) ||
        ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(init);
  return found;
}

const hasModifier = (m, kind) => (ts.getModifiers(m) ?? []).some((x) => x.kind === kind);

function memberKey(m, sf, staticBlockIndex) {
  if (ts.isConstructorDeclaration(m)) return 'constructor';
  if (ts.isClassStaticBlockDeclaration(m)) return staticBlockIndex === 1 ? 'static {}' : `static {} #${staticBlockIndex}`;
  const stat = hasModifier(m, ts.SyntaxKind.StaticKeyword) ? 'static ' : '';
  const acc = ts.isGetAccessorDeclaration(m) ? 'get ' : ts.isSetAccessorDeclaration(m) ? 'set ' : '';
  return `${stat}${acc}${m.name ? m.name.getText(sf) : kindName(m)}`;
}

/**
 * Judge every member of one class.
 * @returns {{ members: Array<{ key: string, line: number, verdict: 'delegation'|'field'|'signature'|'body', shape?: string, why?: string }> }}
 */
export function judgeClass(cls, sf) {
  const members = [];
  let staticBlocks = 0;
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  for (const m of cls.members) {
    if (ts.isSemicolonClassElement(m) || ts.isIndexSignatureDeclaration(m)) continue;
    if (ts.isClassStaticBlockDeclaration(m)) staticBlocks += 1;
    const key = memberKey(m, sf, staticBlocks);
    const at = line(m);
    const params = m.parameters ?? [];
    const badParam = params.find((p) => p.initializer && !isDataValue(p.initializer));
    if (ts.isPropertyDeclaration(m)) {
      const body = m.initializer ? bodyInInitializer(m.initializer) : null;
      members.push(body
        ? { key, line: at, verdict: 'body', why: `its initializer holds a ${kindName(body)} with a body (line ${line(body)})` }
        : { key, line: at, verdict: 'field' });
      continue;
    }
    if (ts.isConstructorDeclaration(m)) {
      if (!m.body) { members.push({ key, line: at, verdict: 'signature' }); continue; }
      if (badParam) { members.push({ key, line: at, verdict: 'body', why: `parameter \`${badParam.name.getText(sf)}\` computes its default` }); continue; }
      const i = m.body.statements.findIndex((s) => !isConstructorWiring(s));
      members.push(i === -1
        ? { key, line: at, verdict: 'delegation', shape: 'constructor wiring (`this.x = p`, `super(…)`)' }
        : { key, line: at, verdict: 'body', why: `statement ${i + 1} (${kindName(m.body.statements[i])}) is not wiring` });
      continue;
    }
    if (ts.isClassStaticBlockDeclaration(m)) {
      const i = m.body.statements.findIndex((s) => !(ts.isExpressionStatement(s) && isForwardingCall(s.expression)));
      members.push(i === -1 && m.body.statements.length > 0
        ? { key, line: at, verdict: 'delegation', shape: 'static host factory (`installHost((p) => ({ x: (...a) => p.x(...a) }))`)' }
        : { key, line: at, verdict: 'body', why: m.body.statements.length === 0 ? 'an empty static block' : `statement ${i + 1} (${kindName(m.body.statements[i])}) is not a forwarding call` });
      continue;
    }
    if (ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
      if (!m.body) { members.push({ key, line: at, verdict: 'signature' }); continue; }
      if (badParam) { members.push({ key, line: at, verdict: 'body', why: `parameter \`${badParam.name.getText(sf)}\` computes its default` }); continue; }
      const j = judgeDelegationBody(m.body);
      members.push(j.shape
        ? { key, line: at, verdict: 'delegation', shape: j.shape }
        : { key, line: at, verdict: 'body', why: `${j.why} (${m.body.statements.length} statement(s))` });
      continue;
    }
    members.push({ key, line: at, verdict: 'body', why: `a ${kindName(m)} member, a kind this gate does not know (fail closed)` });
  }
  return { members };
}

// ── The registry ────────────────────────────────────────────────────────────

function unknownKeys(row, allowed) {
  return Object.keys(row).filter((k) => !allowed.includes(k));
}

/**
 * Judge a registry against the files it names.
 * @param {{ facades: unknown[], exceptions: unknown[] }} registry
 * @param {(file: string) => string | null} readFile  null = the file does not exist
 * @returns {{ problems: Array<{ where: string, message: string }>, facades: object[], excepted: object[] }}
 */
export function checkRegistry(registry, readFile) {
  const problems = [];
  const facades = [];
  const excepted = [];
  const problem = (where, message) => problems.push({ where, message });

  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.facades) || !Array.isArray(registry.exceptions)) {
    problem(REGISTRY_FILE, 'the registry must be an object with a `facades` array and an `exceptions` array');
    return { problems, facades, excepted };
  }
  const extraTop = unknownKeys(registry, ['facades', 'exceptions']);
  if (extraTop.length) problem(REGISTRY_FILE, `unknown top-level key(s) ${extraTop.join(', ')}`);

  const byFile = new Map();
  registry.facades.forEach((row, i) => {
    const where = `${REGISTRY_FILE} facades[${i}]`;
    if (!row || typeof row !== 'object') return problem(where, 'a row must be an object');
    const extra = unknownKeys(row, FACADE_KEYS);
    if (extra.length) problem(where, `unknown key(s) ${extra.join(', ')} (a row carries ${FACADE_KEYS.join(', ')})`);
    if (typeof row.file !== 'string' || !row.file) return problem(where, 'a row must name its `file`');
    if (typeof row.class !== 'string' || !row.class) return problem(where, `${row.file}: a row must name its facade \`class\``);
    if (typeof row.card !== 'string' || !CARD_REF.test(row.card)) {
      problem(where, `${row.file}: a row must name the card that landed the facade as \`#<number>\`, got ${JSON.stringify(row.card)}`);
    }
    if (byFile.has(row.file)) return problem(where, `${row.file} is registered twice`);
    byFile.set(row.file, { row, judged: null });
  });

  for (const [file, entry] of byFile) {
    const text = readFile(file);
    if (text === null) {
      problem(file, `registered as a facade, but the file does not exist — a gate over a missing file judges nothing. Restore the file or remove its row.`);
      continue;
    }
    const sf = parseSourceFile(file, text, ts.ScriptKind.TS);
    const classes = [];
    const visit = (n) => {
      if (ts.isClassDeclaration(n) && n.name?.text === entry.row.class) classes.push(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (classes.length !== 1) {
      problem(file, `registered class \`${entry.row.class}\` is declared ${classes.length} time(s) in the file, expected exactly 1`);
      continue;
    }
    const { members } = judgeClass(classes[0], sf);
    entry.judged = members;
    const delegations = members.filter((m) => m.verdict === 'delegation');
    if (delegations.length === 0) {
      problem(file, `\`${entry.row.class}\` reads ZERO delegations across ${members.length} member(s) — the class is not in facade form, or this gate's grammar no longer recognises the generated delegation shape. Neither is a pass.`);
    }
    facades.push({ file, class: entry.row.class, card: entry.row.card, members });
  }

  const seen = new Set();
  registry.exceptions.forEach((row, i) => {
    const where = `${REGISTRY_FILE} exceptions[${i}]`;
    if (!row || typeof row !== 'object') return problem(where, 'a row must be an object');
    const extra = unknownKeys(row, EXCEPTION_KEYS);
    if (extra.length) problem(where, `unknown key(s) ${extra.join(', ')} (a row carries ${EXCEPTION_KEYS.join(', ')})`);
    if (typeof row.file !== 'string' || typeof row.member !== 'string' || !row.member) {
      return problem(where, 'a row must name its `file` and `member`');
    }
    const label = `${row.file} \`${row.member}\``;
    if (typeof row.card !== 'string' || !CARD_REF.test(row.card)) {
      problem(where, `${label}: an exception must name the card that will move the member, as \`#<number>\`; got ${JSON.stringify(row.card)}. An exception nobody owns is a permanent hole.`);
    }
    if (row.reason !== undefined && (typeof row.reason !== 'string' || !row.reason)) {
      problem(where, `${label}: \`reason\`, when present, is a non-empty string`);
    }
    const id = `${row.file}\u0000${row.member}`;
    if (seen.has(id)) return problem(where, `${label} has two exception rows`);
    seen.add(id);
    const entry = byFile.get(row.file);
    if (!entry) return problem(where, `${label}: ${row.file} is not a registered facade`);
    if (!entry.judged) return; // the facade itself was refused above
    const member = entry.judged.find((m) => m.key === row.member && m.verdict !== 'signature');
    if (!member) {
      return problem(where, `${label}: \`${entry.row.class}\` has no member \`${row.member}\` with a body — the row is stale; delete it.`);
    }
    if (member.verdict !== 'body') {
      return problem(where, `${label}: the member is already a ${member.verdict === 'field' ? 'field' : 'delegation'} — its card ${row.card} has moved it. Delete the row; the member must stay a delegation.`);
    }
    member.exception = row;
    excepted.push({ file: row.file, member: row.member, card: row.card, line: member.line });
  });

  for (const f of facades) {
    for (const m of f.members) {
      if (m.verdict !== 'body' || m.exception) continue;
      problem(`${f.file}:${m.line}`, `${f.class}.${m.key} holds a body, not a delegation: ${m.why}.\n    fix: ${FIX_LINE}.`);
    }
  }
  return { problems, facades, excepted };
}

// ── Self-test ───────────────────────────────────────────────────────────────

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` above that line prints nothing and would exit 0.
let selfTestReachedVerdict = false;

// One battery per row of the `cases` table below, floor 1 each, copied from
// `check-agent-model-declared.mjs` (AGENTS.md § Writing a `--self-test`). The
// roster is a LITERAL the table is checked against, so a deleted or renamed
// row names itself; its own size is pinned by SELF_TEST_BATTERY_FLOOR.
const SELF_TEST_BATTERIES = Object.freeze({
  'H1 a method with a real body → RED naming file, class and member': 1,
  'H2 a getter with a body → RED': 1,
  'H3 a forwarding call with a computed argument → RED': 1,
  'H4 a call nested two deep in an argument → RED': 1,
  'H5 an object literal built inline as an argument → RED': 1,
  'H6 a field initializer holding a block-bodied function → RED': 1,
  'H7 a constructor with control flow → RED': 1,
  'H8 a static block that is not a forwarding call → RED': 1,
  'H9 an empty method body → RED': 1,
  'H10 a parameter default that computes → RED': 1,
  'H11 a host literal whose slot computes → RED': 1,
  'H12 one bad member among delegations → RED naming only that member': 1,
  'A1 facet delegation `return F.m(host(this), ...args)` → GREEN': 1,
  'A2 host-literal `.call` stub (reader closures, forwarders, getters) → GREEN': 1,
  'A3 constructor wiring (this.x = p, new Map(), super, a module call) → GREEN': 1,
  'A4 static host factory of forwarders → GREEN': 1,
  'A5 fields: bare, data initializers, forwarding arrows → GREEN': 1,
  'A6 overloads, await, casts, state read/write accessors → GREEN': 1,
  'E1 an allow-listed body → GREEN, reported with its card': 1,
  'E2 an exception row without a card → RED': 1,
  'E3 an exception row whose card is not #<number> → RED': 1,
  'E4 an exception row on a member that is now a delegation → RED (stale)': 1,
  'E5 an exception row naming a member the class does not have → RED (stale)': 1,
  'E6 an exception row naming an unregistered file → RED': 1,
  'E7 two exception rows for one member → RED': 1,
  'E8 an unknown key in a row → RED': 1,
  'N1 a registered facade file that is missing → RED': 1,
  'N2 a registered class that is absent from its file → RED': 1,
  'N3 a registered facade with zero delegations → RED': 1,
  'N4 a facade row without its card → RED': 1,
  'N5 an empty registry → GREEN with nothing guarded, never a crash': 1,
  'N6 the committed registry is well-formed against this checkout': 1,
});
const SELF_TEST_BATTERY_FLOOR = 32;

function selfTest() {
  const FILE = 'pkg/src/facade.ts';
  const facadeOf = (body, extraTop = '') =>
    `${extraTop}export class Facade {\n  private engine: unknown;\n${body}\n  ok(a: string) { return Facet.ok(host(this), a); }\n}\n`;
  const reg = (facadeRows, exceptions = []) => ({ facades: facadeRows, exceptions });
  const row = { file: FILE, class: 'Facade', card: '#1' };
  const run = (text, exceptions = [], rows = [row]) =>
    checkRegistry(reg(rows, exceptions), (f) => (f === FILE ? text : null));
  const red = (r, re) =>
    r.problems.some((p) => re.test(`${p.where} ${p.message}`))
      ? null
      : `expected a problem matching ${re}, got ${JSON.stringify(r.problems.map((p) => `${p.where} ${p.message}`))}`;
  const green = (r) => (r.problems.length === 0 ? null : `expected GREEN, got ${JSON.stringify(r.problems.map((p) => `${p.where} ${p.message}`))}`);
  const all = (...xs) => xs.find((x) => x !== null) ?? null;

  const cases = [
    { label: 'H1 a method with a real body → RED naming file, class and member', run: () => {
      const r = run(facadeOf('  save(x: number) {\n    if (x > 1) { return x; }\n    return 0;\n  }'));
      return all(red(r, /^pkg\/src\/facade\.ts:\d+ Facade\.save holds a body/), red(r, /fix: move the body into its facet module/));
    } },
    { label: 'H2 a getter with a body → RED', run: () =>
      red(run(facadeOf('  get size() { const n = 1; return n + 1; }')), /Facade\.get size holds a body/) },
    { label: 'H3 a forwarding call with a computed argument → RED', run: () =>
      red(run(facadeOf('  m(a: number) { return Facet.m(host(this), a + 1); }')), /Facade\.m holds a body/) },
    { label: 'H4 a call nested two deep in an argument → RED', run: () =>
      red(run(facadeOf('  m(a: string) { return Facet.m(host(wrap(this)), a); }')), /Facade\.m holds a body/) },
    { label: 'H5 an object literal built inline as an argument → RED', run: () =>
      red(run(facadeOf("  m(a: string) { return audit({ op: 'save', a }, () => this.n(a)); }")), /Facade\.m holds a body/) },
    { label: 'H6 a field initializer holding a block-bodied function → RED', run: () => all(
      red(run(facadeOf('  private handler = (x: number) => { return x * 2; };')), /Facade\.handler holds a body, not a delegation: its initializer holds a ArrowFunction/),
      red(run(facadeOf('  private static readonly TABLE = (() => { const s = new Set(); return s; })();')), /Facade\.static TABLE holds a body/),
    ) },
    { label: 'H7 a constructor with control flow → RED', run: () =>
      red(run(facadeOf('  constructor(e: unknown) {\n    if (!e) throw new Error("x");\n    this.engine = e;\n  }')), /Facade\.constructor holds a body, not a delegation: statement 1 \(IfStatement\)/) },
    { label: 'H8 a static block that is not a forwarding call → RED', run: () =>
      red(run(facadeOf('  static { let x = 1; install(x); }')), /Facade\.static \{\} holds a body/) },
    { label: 'H9 an empty method body → RED', run: () =>
      red(run(facadeOf('  noop() {}')), /Facade\.noop holds a body, not a delegation: an empty body forwards to nothing/) },
    { label: 'H10 a parameter default that computes → RED', run: () =>
      red(run(facadeOf('  m(a = Date.now()) { return Facet.m(host(this), a); }')), /Facade\.m holds a body, not a delegation: parameter `a` computes its default/) },
    { label: 'H11 a host literal whose slot computes → RED', run: () =>
      red(run(facadeOf('  m(a: string) {\n    const host = { n: (...x: unknown[]) => this.n(...x) + 1 };\n    return impl.call(host, a);\n  }')), /Facade\.m holds a body, not a delegation: statement 1 of 2 \(VariableStatement\)/) },
    { label: 'H12 one bad member among delegations → RED naming only that member', run: () => {
      const r = run(facadeOf('  a(x: string) { return Facet.a(host(this), x); }\n  b(x: string) { while (x) { x = ""; } return x; }\n  c() { return Facet.c(host(this)); }'));
      if (r.problems.length !== 1) return `expected exactly 1 problem, got ${r.problems.length}`;
      return red(r, /Facade\.b holds a body/);
    } },
    { label: 'A1 facet delegation `return F.m(host(this), ...args)` → GREEN', run: () =>
      green(run(facadeOf('  async m(a: string, ...rest: unknown[]) { return ProtocolSaveFacet.m(protocolHost(this), a, ...rest); }\n  n() { ProtocolSaveFacet.n(protocolHost(this)); }'))) },
    { label: 'A2 host-literal `.call` stub (reader closures, forwarders, getters) → GREEN', run: () => green(run(facadeOf([
      '  private convert(type: string, data: unknown): unknown {',
      '    // [cut 23] The body moved to `convert.ts`.',
      '    const readWarned = () => this.warned;',
      '    const host: ThisParameterType<typeof convert> = {',
      '      detailed: (...a) => this.detailed(...a),',
      '      engine: this.engine,',
      '      get warned() { return readWarned(); },',
      '      set warned(v) { writeWarned(v); },',
      '    };',
      '    return convert.call(host, type, data);',
      '  }',
    ].join('\n')))) },
    { label: 'A3 constructor wiring (this.x = p, new Map(), super, a module call) → GREEN', run: () => green(run(facadeOf([
      "  constructor(engine: unknown, channel: string = 'environment') {",
      '    this.engine = engine as never;',
      '    this.cache = new Map<string, unknown>();',
      '    resolveQueryReadLimits();',
      '  }',
    ].join('\n')))) },
    { label: 'A4 static host factory of forwarders → GREEN', run: () => green(run(facadeOf([
      '  static {',
      '    installProtocolHost((protocol) => ({',
      '      a: (...a) => protocol.a(...a),',
      '      get engine() { return protocol.engine; },',
      '    }));',
      '  }',
    ].join('\n')))) },
    { label: 'A5 fields: bare, data initializers, forwarding arrows → GREEN', run: () => green(run(facadeOf([
      '  private overlayRepos = new Map<string, unknown>();',
      '  private warned = false;',
      "  private static readonly REMEDY = { field: ' Fields are ' + 'not standalone.' };",
      '  private readonly read = () => this.overlayRepos;',
      '  private listeners: Array<() => void> = [];',
    ].join('\n')))) },
    { label: 'A6 overloads, await, casts, state read/write accessors → GREEN', run: () => green(run(facadeOf([
      '  find(a: string): string;',
      '  find(a: number): number;',
      '  async find(a: unknown): Promise<unknown> { return (await EngineFindFacet.find(engineHost(this), a as never)) as unknown; }',
      '  get engineRef() { return this.engine; }',
      '  set engineRef(v: unknown) { this.engine = v; }',
    ].join('\n')))) },
    { label: 'E1 an allow-listed body → GREEN, reported with its card', run: () => {
      const r = run(facadeOf('  update(x: number) { let y = x; y += 1; return y; }'), [{ file: FILE, member: 'update', card: '#30020', reason: 'shared state' }]);
      return all(green(r), r.excepted.length === 1 && r.excepted[0].card === '#30020' ? null : `excepted ${JSON.stringify(r.excepted)}`);
    } },
    { label: 'E2 an exception row without a card → RED', run: () =>
      red(run(facadeOf('  update(x: number) { let y = x; return y; }'), [{ file: FILE, member: 'update' }]), /exceptions\[0\] .*must name the card that will move the member/) },
    { label: 'E3 an exception row whose card is not #<number> → RED', run: () =>
      red(run(facadeOf('  update(x: number) { let y = x; return y; }'), [{ file: FILE, member: 'update', card: 'state-owning facets' }]), /exceptions\[0\] .*as `#<number>`/) },
    { label: 'E4 an exception row on a member that is now a delegation → RED (stale)', run: () =>
      red(run(facadeOf('  update(x: number) { return Facet.update(host(this), x); }'), [{ file: FILE, member: 'update', card: '#30020' }]), /already a delegation — its card #30020 has moved it/) },
    { label: 'E5 an exception row naming a member the class does not have → RED (stale)', run: () =>
      red(run(facadeOf(''), [{ file: FILE, member: 'gone', card: '#30020' }]), /has no member `gone` with a body/) },
    { label: 'E6 an exception row naming an unregistered file → RED', run: () =>
      red(run(facadeOf(''), [{ file: 'pkg/src/other.ts', member: 'm', card: '#30020' }]), /pkg\/src\/other\.ts is not a registered facade/) },
    { label: 'E7 two exception rows for one member → RED', run: () => {
      const ex = { file: FILE, member: 'update', card: '#30020' };
      return red(run(facadeOf('  update(x: number) { let y = x; return y; }'), [ex, { ...ex }]), /has two exception rows/);
    } },
    { label: 'E8 an unknown key in a row → RED', run: () => all(
      red(run(facadeOf('  update(x: number) { let y = x; return y; }'), [{ file: FILE, member: 'update', crad: '#30020' }]), /unknown key\(s\) crad/),
      red(run(facadeOf(''), [], [{ ...row, path: 'x' }]), /facades\[0\] unknown key\(s\) path/),
    ) },
    { label: 'N1 a registered facade file that is missing → RED', run: () =>
      red(checkRegistry(reg([row]), () => null), /pkg\/src\/facade\.ts registered as a facade, but the file does not exist/) },
    { label: 'N2 a registered class that is absent from its file → RED', run: () =>
      red(run('export class Other { m() { return F.m(this); } }\n'), /`Facade` is declared 0 time\(s\)/) },
    { label: 'N3 a registered facade with zero delegations → RED', run: () =>
      red(run('export class Facade {\n  private x = 1;\n}\n'), /reads ZERO delegations across 1 member/) },
    { label: 'N4 a facade row without its card → RED', run: () =>
      red(run(facadeOf(''), [], [{ file: FILE, class: 'Facade' }]), /must name the card that landed the facade/) },
    { label: 'N5 an empty registry → GREEN with nothing guarded, never a crash', run: () => {
      const r = checkRegistry(reg([]), () => { throw new Error('read with nothing registered'); });
      return all(green(r), r.facades.length === 0 ? null : 'facades should be empty');
    } },
    { label: 'N6 the committed registry is well-formed against this checkout', run: () => {
      const r = runGate({ root: REPO_ROOT, registryPath: join(REPO_ROOT, REGISTRY_FILE) });
      return r.loadError ?? (r.result.problems.length === 0 ? null : `the committed registry is red: ${r.result.problems.map((p) => p.message).join(' | ')}`);
    } },
  ];

  const batterySeen = new Map();
  const registerCase = (name) => batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  let failed = 0;
  for (const c of cases) {
    registerCase(c.label);
    let outcome;
    try {
      outcome = c.run();
    } catch (e) {
      outcome = `threw ${e && e.stack ? e.stack : e}`;
    }
    if (outcome === null) {
      console.log(`  ✓ ${c.label}`);
    } else {
      failed += 1;
      console.error(`  ✗ ${c.label}\n      ${outcome}`);
    }
  }

  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  const labels = cases.map((c) => c.label);
  const dup = [...new Set(labels.filter((l, i) => labels.indexOf(l) !== i))];
  if (dup.length) floorFailure(`row label(s) used twice: ${dup.map((d) => JSON.stringify(d)).join(', ')}`);
  for (const [name, count] of batterySeen) {
    if (!declared.includes(name)) floorFailure(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floorFailure(`battery "${name}" DID NOT RUN — ${count} case(s) registered, ${SELF_TEST_BATTERIES[name]} pinned.`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ check-facade-delegation-only self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ check-facade-delegation-only self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

// ── The gate ────────────────────────────────────────────────────────────────

function runGate({ root, registryPath }) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch (e) {
    return { loadError: `cannot read the registry ${registryPath}: ${e.message}` };
  }
  const readFile = (file) => {
    const abs = resolve(root, file);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };
  return { result: checkRegistry(registry, readFile) };
}

function parseArgs(argv) {
  const opts = { root: REPO_ROOT, registryPath: null, verbose: false, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--self-test') opts.selfTest = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--root' && argv[i + 1]) opts.root = resolve(argv[(i += 1)]);
    else if (a === '--registry' && argv[i + 1]) opts.registryPath = resolve(argv[(i += 1)]);
    else return { error: `unknown or incomplete argument ${JSON.stringify(a)}` };
  }
  opts.registryPath ??= join(opts.root, REGISTRY_FILE);
  return { opts };
}

function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));
  if (error) {
    console.error(`check-facade-delegation-only: ${error}\nusage: [--self-test] [--verbose] [--root DIR] [--registry FILE]`);
    process.exit(2);
  }
  if (opts.selfTest) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ check-facade-delegation-only self-test: selfTest() returned without reaching its verdict;\n  exiting 0 here would report a self-test that never finished as one that passed.');
      process.exit(1);
    }
    return;
  }

  const { loadError, result } = runGate(opts);
  if (loadError) {
    console.error(`✗ check-facade-delegation-only: ${loadError}`);
    process.exit(1);
  }
  const { problems, facades, excepted } = result;

  if (opts.verbose) {
    for (const f of facades) {
      for (const m of f.members) {
        const tag = m.verdict === 'body' ? (m.exception ? `EXCEPTION ${m.exception.card}` : 'BODY') : m.verdict.toUpperCase();
        console.log(`${f.file}:${m.line}\t${tag}\t${m.key}\t${m.shape ?? m.why ?? ''}`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`✗ check-facade-delegation-only: ${problems.length} problem(s). A registered facade keeps delegations only (ruling 6624258595 item 3).\n`);
    for (const p of problems) console.error(`  ✗ ${p.where} ${p.message}`);
    process.exit(1);
  }

  if (facades.length === 0) {
    console.log(
      `✓ check-facade-delegation-only: ${REGISTRY_FILE} registers 0 facade files, so this gate guards NOTHING yet. ` +
        'A file joins with one `facades` row once it lands in facade form.',
    );
    return;
  }
  for (const f of facades) {
    const shapes = new Map();
    let fields = 0;
    for (const m of f.members) {
      if (m.verdict === 'field') fields += 1;
      if (m.verdict === 'delegation') shapes.set(m.shape, (shapes.get(m.shape) ?? 0) + 1);
    }
    const own = excepted.filter((x) => x.file === f.file);
    const cards = [...new Set(own.map((x) => x.card))].join(', ');
    console.log(
      `✓ ${f.file} \`${f.class}\`: ${f.members.length} members — ` +
        `${[...shapes.values()].reduce((a, b) => a + b, 0)} delegations, ${fields} fields, ` +
        `${own.length} named exception(s)${cards ? ` (${cards})` : ''}`,
    );
    for (const [shape, n] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${shape}`);
  }
  console.log(`✓ check-facade-delegation-only: ${facades.length} facade file(s) hold delegations only, ${excepted.length} named exception(s).`);
}

if (isEntrypoint(import.meta.url)) {
  main();
}
