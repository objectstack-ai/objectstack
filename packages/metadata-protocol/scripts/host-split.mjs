#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E1] The host split of `ObjectStackProtocolImplementation`: the one
 * tool that moves a member's body out of `src/protocol.ts`, and the check that
 * the moved body is the member's own body, changed by nothing but the rewrite
 * set below.
 *
 *   node scripts/host-split.mjs survey                     every member: can it move under the set?
 *   node scripts/host-split.mjs move <member> <module>     move one member's body into src/<module>
 *   node scripts/host-split.mjs check <base-ref> <member> <module>
 *                                                         the moved body against the member at <base-ref>
 *
 * Run from `packages/metadata-protocol`. Not a gate: nothing in CI runs it. Its
 * rules are pinned by `host-split.test.mjs` beside it, which the package's
 * vitest run collects, negative controls included.
 *
 * ## The closed rewrite set (ruling E, 6537939895, item E1)
 *
 * Inside a moved body exactly three rewrites are allowed, and nothing else
 * changes (AST identity modulo exactly this set):
 *
 *   1. `this.<member>`                → `host.<member>`  (an instance member: method, field, accessor)
 *   2. `ObjectStackProtocolImplementation.<fn>(…)` → `host.<fn>(…)`
 *                                       (a PRIVATE static method, called; the static is exposed on the host)
 *   3. `this.constructor`             → `host`           (then `.x` must name a static, exposed on the host)
 *
 * A `this` counts only when it is the method's own: the walk from it to the
 * method crosses arrow functions and nothing else that binds `this`. Anything a
 * body does with the class instance outside the set — a bare `this`, `this[k]`,
 * `super`, `arguments`, a private static read as a value or a private static
 * FIELD, an identifier already named `host` — is a refusal, and the member does
 * not move under E1's set.
 *
 * ## The shape a move leaves
 *
 *   - `src/<module>`: `export [async] function <member>(host: Pick<ProtocolHost, …>, <params>)`
 *     whose body is the method's body with the rewrites applied, re-indented one
 *     level (a line that starts inside a multi-line template literal keeps its
 *     bytes). The `Pick` names exactly the host members the body reads.
 *   - `src/protocol.ts`: the method keeps its docblock, modifiers and signature
 *     (the published `.d.ts` prints them); its body is one comment line and
 *     `return <member>(protocolHost(this), <params>);`.
 *   - `src/protocol-host.ts`: `ProtocolHost` gains one entry per member the body
 *     reads, typed AS the class member (`ObjectStackProtocolImplementation['x']`,
 *     `(typeof ObjectStackProtocolImplementation)['x']` for a static); the class's
 *     static block in `protocol.ts` gains the entry that forwards it: a method as
 *     a closure called at call time, a field as a getter (and a setter when a
 *     moved body writes it), a static as a closure to the static.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const CLASS_NAME = 'ObjectStackProtocolImplementation';
export const HOST_PARAM = 'host';
export const HOST_TYPE = 'ProtocolHost';
export const HOST_OF = 'protocolHost';
export const HOST_MODULE = 'protocol-host';

/** The rewrite kinds, by the name the check counts them under. */
export const REWRITES = Object.freeze({
    member: 'this.<member> -> host.<member>',
    privateStatic: 'ObjectStackProtocolImplementation.<fn>(...) -> host.<fn>(...)',
    constructor: 'this.constructor -> host',
});

export function parse(file, text) {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

const hasModifier = (node, kind) => !!node.modifiers?.some((m) => m.kind === kind);
const nameOf = (member) => (member.name && (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)) ? member.name.text : undefined);

/** The class declaration `name` in `sf`, or `undefined`. */
export function classOf(sf, name = CLASS_NAME) {
    return sf.statements.find((s) => ts.isClassDeclaration(s) && s.name?.text === name);
}

/**
 * The class's members by name: `instance` (method / field / accessor, constructor
 * parameter properties included) and `statics` (with `private`). A name declared
 * as both an instance and a static member is reported in `clashes`.
 */
export function memberTable(cls) {
    const instance = new Map();
    const statics = new Map();
    for (const m of cls.members) {
        if (ts.isConstructorDeclaration(m)) {
            for (const p of m.parameters) {
                if (ts.isIdentifier(p.name) && p.modifiers?.some((x) => ts.isParameterPropertyModifier?.(x) ?? [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(x.kind))) {
                    instance.set(p.name.text, { kind: 'field' });
                }
            }
            continue;
        }
        const name = nameOf(m);
        if (!name) continue;
        const kind = ts.isMethodDeclaration(m) ? 'method'
            : ts.isPropertyDeclaration(m) ? 'field'
            : ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m) ? 'accessor'
            : undefined;
        if (!kind) continue;
        if (hasModifier(m, ts.SyntaxKind.StaticKeyword)) {
            statics.set(name, { kind, private: hasModifier(m, ts.SyntaxKind.PrivateKeyword) });
        } else if (!instance.has(name) || instance.get(name).kind !== 'method') {
            instance.set(name, { kind });
        }
    }
    const clashes = [...instance.keys()].filter((n) => statics.has(n));
    return { instance, statics, clashes };
}

/** The implementation (body-carrying) instance method `name` of `cls`, or `undefined`. */
export function methodOf(cls, name) {
    return cls.members.find((m) => ts.isMethodDeclaration(m) && !hasModifier(m, ts.SyntaxKind.StaticKeyword) && nameOf(m) === name && m.body);
}

/** Is this `this` keyword the method's own — reached from it through arrow functions only? */
export function isMethodThis(node, method) {
    for (let p = node.parent; p; p = p.parent) {
        if (p === method) return true;
        if (ts.isArrowFunction(p)) continue;
        if (ts.isFunctionLike(p) || ts.isClassLike(p)) return false;
    }
    return false;
}

const isAssignmentTarget = (node) => {
    const p = node.parent;
    if (ts.isBinaryExpression(p) && p.left === node) {
        return p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    }
    if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p))
        && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
    return ts.isDeleteExpression(p);
};
/** Is this identifier a property NAME (`x.host`, `{ host: v }`), not a binding or a reference? */
const isPropertyName = (node) => {
    const p = node.parent;
    return (ts.isPropertyAccessExpression(p) && p.name === node)
        || ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p)
            || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isMethodSignature(p)) && p.name === node);
};
const isCallee = (node) => ts.isCallExpression(node.parent) && node.parent.expression === node;

/**
 * The rewrite sites of one method body, and its refusals.
 *
 * @returns `{ sites, refusals, used }` — each site `{ start, end, text, kind, member }`
 *          (replace source[start, end) with `text`); `used.instance` maps a member
 *          to `{ read, write, call }`; `used.statics` is the set of statics the
 *          body reaches through the host.
 */
export function rewriteSites(sf, method, table, className = CLASS_NAME) {
    const sites = [];
    const refusals = [];
    const used = { instance: new Map(), statics: new Set() };
    const refuse = (node, reason) => {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        refusals.push({ line: line + 1, reason });
    };
    const useInstance = (name, how) => {
        const u = used.instance.get(name) ?? { read: false, write: false, call: false };
        u[how] = true;
        used.instance.set(name, u);
    };
    const visit = (node) => {
        if (node.kind === ts.SyntaxKind.ThisKeyword && isMethodThis(node, method)) {
            const p = node.parent;
            if (ts.isPropertyAccessExpression(p) && p.expression === node && ts.isIdentifier(p.name)) {
                const name = p.name.text;
                if (name === 'constructor') {
                    const g = p.parent;
                    const st = ts.isPropertyAccessExpression(g) && g.expression === p && ts.isIdentifier(g.name) ? table.statics.get(g.name.text) : undefined;
                    if (!st) refuse(node, '`this.constructor` not followed by `.<static>`: outside the closed set');
                    else {
                        sites.push({ start: p.getStart(sf), end: p.getEnd(), text: HOST_PARAM, kind: 'constructor', member: g.name.text });
                        used.statics.add(g.name.text);
                    }
                    return;
                }
                const member = table.instance.get(name);
                if (!member) { refuse(node, `\`this.${name}\` names no declared instance member`); return; }
                if (table.statics.has(name)) { refuse(node, `\`${name}\` is both an instance and a static member: the host cannot carry both`); return; }
                sites.push({ start: node.getStart(sf), end: node.getEnd(), text: HOST_PARAM, kind: 'member', member: name });
                useInstance(name, isAssignmentTarget(p) ? 'write' : isCallee(p) ? 'call' : 'read');
                ts.forEachChild(p, (c) => { if (c !== node) visit(c); });
                return;
            }
            refuse(node, ts.isElementAccessExpression(p) && p.expression === node
                ? '`this[…]` (element access): outside the closed set'
                : 'a bare `this` (not `this.<member>`): outside the closed set');
            return;
        }
        if (node.kind === ts.SyntaxKind.SuperKeyword) { refuse(node, '`super`: outside the closed set'); return; }
        if (ts.isIdentifier(node)) {
            if (node.text === 'arguments' && !isPropertyName(node)) {
                let p = node.parent;
                while (p && p !== method && (ts.isArrowFunction(p) || !ts.isFunctionLike(p))) p = p.parent;
                if (p === method) refuse(node, '`arguments` of the method: a moved function\'s `arguments` would carry the host');
            }
            if (node.text === HOST_PARAM && !isPropertyName(node)) refuse(node, `an identifier already named \`${HOST_PARAM}\` would shadow or be shadowed by the host parameter`);
            if (node.text === className && ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && ts.isIdentifier(node.parent.name)) {
                const name = node.parent.name.text;
                const st = table.statics.get(name);
                if (st?.private) {
                    if (st.kind === 'method' && isCallee(node.parent)) {
                        sites.push({ start: node.getStart(sf), end: node.getEnd(), text: HOST_PARAM, kind: 'privateStatic', member: name });
                        used.statics.add(name);
                    } else {
                        refuse(node, `private static \`${name}\` (${st.kind}) ${st.kind === 'method' ? 'read as a value' : 'read'}: only a private static METHOD, called, is in the closed set`);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    if (method.body) ts.forEachChild(method.body, visit);
    sites.sort((a, b) => a.start - b.start);
    return { sites, refusals, used };
}

/** Apply sites (absolute positions in `text` offset by `base`). */
export function applySites(text, sites, base = 0) {
    let out = text;
    for (const s of [...sites].sort((a, b) => b.start - a.start)) {
        out = out.slice(0, s.start - base) + s.text + out.slice(s.end - base);
    }
    return out;
}

/** Line starts (offsets into `text`) that fall inside a multi-line template literal or string token. */
function linesInsideLiterals(text) {
    const inside = new Set();
    // A full parse is the reliable way to find literal spans: a scanner alone
    // cannot tell a template's tail from a `}`.
    const sf = parse('x.ts', text);
    const visit = (node) => {
        if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isStringLiteral(node)) {
            const start = node.getStart(sf);
            const end = node.getEnd();
            for (let i = text.indexOf('\n', start); i !== -1 && i < end - 1; i = text.indexOf('\n', i + 1)) inside.add(i + 1);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return inside;
}

/** Remove `by` leading spaces from every line but the first, except a line that starts inside a literal. */
export function dedent(text, by = 4, literalLineStarts = undefined) {
    const keep = literalLineStarts ?? new Set();
    let out = '';
    let at = 0;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        if (i > 0 && !keep.has(at) && line.startsWith(' '.repeat(by))) out += line.slice(by);
        else out += line;
        if (i < lines.length - 1) out += '\n';
        at += line.length + 1;
    });
    return out;
}

/** Literal line starts of a body text, found by parsing it as a function body. */
function literalStartsOfBody(bodyText) {
    const prefix = 'function f() ';
    const inside = linesInsideLiterals(prefix + bodyText);
    return new Set([...inside].map((i) => i - prefix.length));
}

/** The method's parameter list text (between the parens), its type parameters and return type. */
function signatureParts(sf, fn) {
    const params = fn.parameters;
    const paramsText = params.length ? sf.text.slice(params[0].getStart(sf), params.end).trim() : '';
    return {
        typeParams: fn.typeParameters ? `<${sf.text.slice(fn.typeParameters.pos, fn.typeParameters.end).trim()}>` : '',
        paramsText,
        returnType: fn.type ? fn.type.getText(sf) : undefined,
        async: hasModifier(fn, ts.SyntaxKind.AsyncKeyword),
        generator: !!fn.asteriskToken,
    };
}

/** The host members a body's sites name, sorted: what the function's `Pick` lists. */
export function hostNamesOf(sites) {
    return [...new Set(sites.map((s) => s.member))].sort();
}

const pickOf = (names) => `Pick<${HOST_TYPE}, ${names.map((n) => `'${n}'`).join(' | ')}>`;

/**
 * Plan one move: the moved function's text, the stub's body text, and the host
 * entries the body needs. Refusals are returned, never thrown; a caller writes
 * nothing when there is one.
 */
export function planMove(source, member, moduleFile, className = CLASS_NAME) {
    const sf = parse('protocol.ts', source);
    const cls = classOf(sf, className);
    if (!cls) return { refusals: [{ line: 0, reason: `no class ${className}` }] };
    const method = methodOf(cls, member);
    if (!method) return { refusals: [{ line: 0, reason: `no instance method ${member} with a body` }] };
    const already = stubKindOf(method);
    if (already) return { refusals: [{ line: 0, reason: `already a stub ('${already}'): its body moved before` }] };
    const table = memberTable(cls);
    const { sites, refusals, used } = rewriteSites(sf, method, table, className);
    const sig = signatureParts(sf, method);
    if (sig.generator) refusals.push({ line: 0, reason: 'a generator method' });
    for (const p of method.parameters) {
        if (!ts.isIdentifier(p.name)) refusals.push({ line: 0, reason: 'a destructured parameter: the stub forwards parameters by name' });
    }
    if (refusals.length) return { refusals, sites, used };
    const body = method.body;
    const bodyText = sf.text.slice(body.getStart(sf), body.getEnd());
    const rewritten = applySites(bodyText, sites, body.getStart(sf));
    const movedBody = dedent(rewritten, 4, literalStartsOfBody(rewritten));
    const names = hostNamesOf(sites);
    const hostParam = names.length ? `${HOST_PARAM}: ${pickOf(names)}` : `${HOST_PARAM}: ${HOST_TYPE}`;
    const params = sig.paramsText ? `${hostParam}, ${sig.paramsText}` : hostParam;
    const fnText = `/** The body of \`${className}#${member}\`; the method's docblock there is its contract. */\n`
        + `export ${sig.async ? 'async ' : ''}function ${member}${sig.typeParams}(${params})${sig.returnType ? `: ${sig.returnType}` : ''} ${movedBody}\n`;
    const args = method.parameters.map((p) => (p.dotDotDotToken ? '...' : '') + p.name.text);
    const stubBody = `{\n`
        + `        // [#25467 E1] The body moved to \`${moduleFile}\`; it reaches this class through \`${HOST_MODULE}.ts\`.\n`
        + `        return ${member}(${[`${HOST_OF}(this)`, ...args].join(', ')});\n`
        + `    }`;
    return {
        refusals: [],
        sites,
        used,
        names,
        fnText,
        stub: { start: body.getStart(sf), end: body.getEnd(), text: stubBody },
        hostEntries: hostEntriesFor(used, table, className),
    };
}

/** The interface and factory lines for the members a body reaches, keyed by member name. */
export function hostEntriesFor(used, table, className = CLASS_NAME) {
    const entries = new Map();
    for (const [name, u] of used.instance) {
        const kind = table.instance.get(name).kind;
        if (kind === 'method') {
            entries.set(name, {
                iface: `    readonly ${name}: ${className}['${name}'];`,
                factory: `            ${name}: (...a) => protocol.${name}(...a),`,
            });
        } else {
            const writes = u.write;
            entries.set(name, {
                iface: `    ${writes ? '' : 'readonly '}${name}: ${className}['${name}'];`,
                factory: writes
                    ? `            get ${name}() { return protocol.${name}; },\n            set ${name}(value) { protocol.${name} = value; },`
                    : `            get ${name}() { return protocol.${name}; },`,
            });
        }
    }
    for (const name of used.statics) {
        entries.set(name, {
            iface: `    readonly ${name}: (typeof ${className})['${name}'];`,
            factory: `            ${name}: (...a) => ${className}.${name}(...a),`,
        });
    }
    return entries;
}

// ── The check ───────────────────────────────────────────────────────────────

/**
 * A node's children in source order, EVERY token included: punctuation,
 * keywords such as `let`/`const`, and operator tokens. `forEachChild` skips
 * those (a `PrefixUnaryExpression` keeps its operator in a field), so a walk
 * over it would not see `!x` become `-x`; `getChildren` does.
 */
function children(node, sf) {
    return node.getChildren(sf).flatMap((c) => (c.kind === ts.SyntaxKind.SyntaxList ? c.getChildren(sf) : [c]));
}

/**
 * AST identity of a base method body and a moved function body, modulo exactly
 * the closed set. Returns `{ problems, counts }`; `problems` is empty when the
 * bodies are the same program text under the set.
 */
export function compareBodies(baseSf, baseMethod, table, headSf, headBody, className = CLASS_NAME) {
    const problems = [];
    const counts = { member: 0, privateStatic: 0, constructor: 0 };
    const where = (sf, node) => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
    const isHost = (n) => ts.isIdentifier(n) && n.text === HOST_PARAM;
    const walk = (a, b) => {
        // Rewrite 3: `this.constructor.<static>` ⇄ `host.<static>`.
        if (ts.isPropertyAccessExpression(a) && ts.isPropertyAccessExpression(a.expression)
            && a.expression.expression.kind === ts.SyntaxKind.ThisKeyword && isMethodThis(a.expression.expression, baseMethod)
            && ts.isIdentifier(a.expression.name) && a.expression.name.text === 'constructor') {
            if (ts.isPropertyAccessExpression(b) && isHost(b.expression) && b.name.getText(headSf) === a.name.getText(baseSf)
                && table.statics.has(a.name.getText(baseSf))) { counts.constructor++; return; }
            problems.push(`${where(headSf, b)}: \`this.constructor.${a.name.getText(baseSf)}\` must read \`${HOST_PARAM}.${a.name.getText(baseSf)}\``);
            return;
        }
        // Rewrite 1: `this.<member>` ⇄ `host.<member>`.
        if (ts.isPropertyAccessExpression(a) && a.expression.kind === ts.SyntaxKind.ThisKeyword && isMethodThis(a.expression, baseMethod)) {
            const name = a.name.getText(baseSf);
            if (ts.isPropertyAccessExpression(b) && isHost(b.expression) && b.name.getText(headSf) === name && table.instance.has(name)) {
                counts.member++;
                return;
            }
            problems.push(`${where(headSf, b)}: \`this.${name}\` must read \`${HOST_PARAM}.${name}\`, found \`${b.getText(headSf).slice(0, 80)}\``);
            return;
        }
        // Rewrite 2: `C.<private static fn>(…)` callee ⇄ `host.<fn>`.
        if (ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.expression) && a.expression.text === className
            && table.statics.get(a.name.getText(baseSf))?.private && table.statics.get(a.name.getText(baseSf)).kind === 'method' && isCallee(a)) {
            const name = a.name.getText(baseSf);
            if (ts.isPropertyAccessExpression(b) && isHost(b.expression) && b.name.getText(headSf) === name && isCallee(b)) {
                counts.privateStatic++;
                return;
            }
            problems.push(`${where(headSf, b)}: \`${className}.${name}(…)\` must read \`${HOST_PARAM}.${name}(…)\``);
            return;
        }
        if (a.kind !== b.kind) {
            problems.push(`${where(headSf, b)}: ${ts.SyntaxKind[b.kind]} where the base has ${ts.SyntaxKind[a.kind]} (\`${a.getText(baseSf).slice(0, 60)}\`)`);
            return;
        }
        const ca = children(a, baseSf);
        const cb = children(b, headSf);
        if (!ca.length && !cb.length) {
            if (a.getText(baseSf) !== b.getText(headSf)) {
                problems.push(`${where(headSf, b)}: \`${b.getText(headSf).slice(0, 60)}\` where the base has \`${a.getText(baseSf).slice(0, 60)}\``);
            }
            return;
        }
        if (ca.length !== cb.length) {
            problems.push(`${where(headSf, b)}: ${ts.SyntaxKind[b.kind]} has ${cb.length} children where the base has ${ca.length}`);
            return;
        }
        // Operator and modifier tokens are children; a changed operator is a changed token.
        for (let i = 0; i < ca.length; i++) walk(ca[i], cb[i]);
    };
    walk(baseMethod.body, headBody);
    return { problems, counts };
}

/** The exported function `name` of a module source, or `undefined`. */
export function exportedFunctionOf(sf, name) {
    return sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name && hasModifier(s, ts.SyntaxKind.ExportKeyword) && s.body);
}

/**
 * The whole check for one moved member: the stub, the moved function's
 * signature, AST identity modulo the set, the `Pick`, and the body's text
 * (comments included) against the base body rewritten by the same sites.
 */
export function checkMove({ baseSource, headSource, moduleSource, moduleFile, member, className = CLASS_NAME }) {
    const problems = [];
    const baseSf = parse('base:protocol.ts', baseSource);
    const headSf = parse('protocol.ts', headSource);
    const modSf = parse(moduleFile, moduleSource);
    const baseCls = classOf(baseSf, className);
    const headCls = classOf(headSf, className);
    const baseMethod = baseCls && methodOf(baseCls, member);
    const headMethod = headCls && methodOf(headCls, member);
    const fn = exportedFunctionOf(modSf, member);
    if (!baseMethod) problems.push(`base: no method ${member}`);
    if (!headMethod) problems.push(`head: no method ${member} in protocol.ts`);
    if (!fn) problems.push(`${moduleFile}: no exported function ${member}`);
    if (problems.length) return { ok: false, problems };
    const table = memberTable(baseCls);

    // The method's signature is unchanged; only its body is the stub.
    const sigText = (sf, m) => sf.text.slice(m.getFullStart(), m.body.getStart(sf));
    if (sigText(baseSf, baseMethod) !== sigText(headSf, headMethod)) problems.push(`protocol.ts: ${member}'s docblock, modifiers or signature changed`);
    const stmts = headMethod.body.statements;
    const ret = stmts.length === 1 && ts.isReturnStatement(stmts[0]) ? stmts[0].expression : undefined;
    const args = ret && ts.isCallExpression(ret) && ts.isIdentifier(ret.expression) && ret.expression.text === member ? ret.arguments : undefined;
    const expectedArgs = [`${HOST_OF}(this)`, ...baseMethod.parameters.map((p) => (p.dotDotDotToken ? '...' : '') + p.name.getText(baseSf))];
    if (!args || args.map((x) => x.getText(headSf)).join(', ') !== expectedArgs.join(', ')) {
        problems.push(`protocol.ts: ${member}'s body is not the stub \`return ${member}(${expectedArgs.join(', ')});\``);
    }

    // The function's signature: the host parameter, then the method's own.
    const bs = signatureParts(baseSf, baseMethod);
    const hostParam = fn.parameters[0];
    const rest = fn.parameters.slice(1);
    const restText = rest.length ? modSf.text.slice(rest[0].getStart(modSf), fn.parameters.end).trim() : '';
    if (!hostParam || hostParam.name.getText(modSf) !== HOST_PARAM) problems.push(`${moduleFile}: ${member}'s first parameter is not \`${HOST_PARAM}\``);
    if (restText !== bs.paramsText) problems.push(`${moduleFile}: ${member}'s parameters after the host are not the method's own`);
    const fs = signatureParts(modSf, fn);
    if (fs.typeParams !== bs.typeParams || fs.returnType !== bs.returnType || fs.async !== bs.async || fs.generator !== bs.generator) {
        problems.push(`${moduleFile}: ${member}'s type parameters, return type, async or generator flag differ from the method's`);
    }

    // AST identity modulo the set.
    const ast = compareBodies(baseSf, baseMethod, table, modSf, fn.body, className);
    problems.push(...ast.problems);

    // The `Pick` names exactly the host members the body reads.
    const { sites, refusals } = rewriteSites(baseSf, baseMethod, table, className);
    for (const r of refusals) problems.push(`base: ${member} line ${r.line}: ${r.reason}`);
    const want = hostNamesOf(sites);
    const pickType = hostParam?.type;
    const picked = pickType && ts.isTypeReferenceNode(pickType) && pickType.typeName.getText(modSf) === 'Pick'
        ? (() => {
            const keys = pickType.typeArguments?.[1];
            const lits = keys ? (ts.isUnionTypeNode(keys) ? keys.types : [keys]) : [];
            return lits.map((k) => (ts.isLiteralTypeNode(k) && ts.isStringLiteral(k.literal) ? k.literal.text : '?')).sort();
        })()
        : pickType && ts.isTypeReferenceNode(pickType) && pickType.typeName.getText(modSf) === HOST_TYPE && !want.length ? [] : undefined;
    if (!picked || picked.join(',') !== want.join(',')) problems.push(`${moduleFile}: ${member}'s host type must be ${want.length ? pickOf(want) : HOST_TYPE}`);

    // Text: comments and layout carried, i.e. the base body rewritten and re-indented.
    const bodyStart = baseMethod.body.getStart(baseSf);
    const rewritten = applySites(baseSf.text.slice(bodyStart, baseMethod.body.getEnd()), sites, bodyStart);
    const expectedText = dedent(rewritten, 4, literalStartsOfBody(rewritten));
    const headText = modSf.text.slice(fn.body.getStart(modSf), fn.body.getEnd());
    let textIdentical = expectedText === headText;
    if (!textIdentical) {
        const el = expectedText.split('\n');
        const hl = headText.split('\n');
        const at = el.findIndex((l, i) => l !== hl[i]);
        problems.push(`${moduleFile}: ${member}'s body text differs from the base body rewritten and re-indented, first at body line ${at + 1}`);
    }
    return { ok: problems.length === 0, problems, counts: ast.counts, sites: sites.length, textIdentical, hostMembers: want };
}

// ── Survey ──────────────────────────────────────────────────────────────────

/**
 * The function a per-member stub calls: `fn` in `fn.call(host, …)`, and in the
 * generic spelling `(fn<R>).call(host, …)` (an instantiation expression in
 * parentheses), which the per-member series wrote for a generic method.
 */
function calleeOf(node) {
    let n = node;
    while (ts.isParenthesizedExpression(n) || ts.isExpressionWithTypeArguments(n)) n = n.expression;
    return n;
}

/**
 * Is this method already a stub — its body moved before? One of three shapes,
 * its last statement returning (awaited or not):
 *   'call'  — `fn.call(host, …)` or `(fn<R>).call(host, …)` (the per-member series);
 *   'host'  — `fn(protocolHost(this), …)` (this tool);
 *   'plain' — `fn(<its own parameters, in order>)`, `fn` named as the method:
 *             a body that read no member moved as a plain function.
 */
export function stubKindOf(m) {
    const last = m.body?.statements[m.body.statements.length - 1];
    let call = last && ts.isReturnStatement(last) ? last.expression : undefined;
    if (call && ts.isAwaitExpression(call)) call = call.expression;
    if (!call || !ts.isCallExpression(call)) return undefined;
    if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'call'
        && ts.isIdentifier(calleeOf(call.expression.expression)) && !!call.arguments[0] && ts.isIdentifier(call.arguments[0])) return 'call';
    if (call.arguments[0] && ts.isCallExpression(call.arguments[0]) && ts.isIdentifier(call.arguments[0].expression)
        && call.arguments[0].expression.text === HOST_OF) return 'host';
    const name = nameOf(m);
    const params = m.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : undefined));
    if (ts.isIdentifier(call.expression) && call.expression.text === name && call.arguments.length === params.length
        && call.arguments.every((x, i) => ts.isIdentifier(x) && x.text === params[i])) return 'plain';
    return undefined;
}

/** Every instance method with a body: its line count, sites and refusals under the set. */
export function survey(source, className = CLASS_NAME) {
    const sf = parse('protocol.ts', source);
    const cls = classOf(sf, className);
    const table = memberTable(cls);
    const rows = [];
    for (const m of cls.members) {
        if (!ts.isMethodDeclaration(m) || !m.body || hasModifier(m, ts.SyntaxKind.StaticKeyword)) continue;
        const name = nameOf(m);
        const { sites, refusals } = rewriteSites(sf, m, table, className);
        const stub = stubKindOf(m);
        const lines = sf.getLineAndCharacterOfPosition(m.getEnd()).line - sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1;
        rows.push({ name, lines, sites: sites.length, refusals, stub });
    }
    return { rows, clashes: table.clashes };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const SRC = 'src';
const PROTOCOL = `${SRC}/protocol.ts`;

/** Insert host entries into the interface (protocol-host.ts) and the static block factory (protocol.ts), sorted, skipping names present. */
export function insertHostEntries(hostSource, protocolSource, entries) {
    const insertSorted = (text, openMarker, closeMarker, lineOf, keyOf) => {
        const open = text.indexOf(openMarker);
        const close = text.indexOf(closeMarker, open);
        if (open < 0 || close < 0) throw new Error(`marker not found: ${openMarker}`);
        const head = text.slice(0, open + openMarker.length);
        const block = text.slice(open + openMarker.length, close);
        const tail = text.slice(close);
        const existing = block.split('\n').filter((l) => l.trim());
        const groups = [];
        for (const l of existing) {
            const k = keyOf(l);
            if (k !== undefined) groups.push({ key: k, lines: [l] });
            else if (groups.length) groups[groups.length - 1].lines.push(l);
        }
        const have = new Set(groups.map((g) => g.key));
        for (const [name, e] of entries) if (!have.has(name)) groups.push({ key: name, lines: lineOf(e).split('\n') });
        groups.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
        return `${head}\n${groups.flatMap((g) => g.lines).join('\n')}${tail}`;
    };
    const ifaceKey = (l) => /^ {4}(?:readonly )?([A-Za-z_$][\w$]*):/.exec(l)?.[1];
    const factoryKey = (l) => /^ {12}(?:get |set )?([A-Za-z_$][\w$]*)[:(]/.exec(l)?.[1];
    return {
        host: insertSorted(hostSource, `export interface ${HOST_TYPE} {`, '\n}', (e) => e.iface, ifaceKey),
        protocol: insertSorted(protocolSource, `installProtocolHost((protocol) => ({`, '\n        }));', (e) => e.factory, (l) => {
            const k = factoryKey(l);
            return k !== undefined && !/^ {12}set /.test(l) ? k : undefined;
        }),
    };
}

function main(argv) {
    const [cmd, ...rest] = argv;
    if (cmd === 'survey') {
        const all = survey(readFileSync(PROTOCOL, 'utf8'));
        const { clashes } = all;
        const stubs = all.rows.filter((r) => r.stub);
        console.log(`already stubs: ${stubs.length} (${stubs.filter((r) => r.stub === 'call').length} by \`fn.call(host, …)\` from the per-member series, ${stubs.filter((r) => r.stub === 'host').length} by \`fn(${HOST_OF}(this), …)\`, ${stubs.filter((r) => r.stub === 'plain').length} by a plain \`fn(<params>)\`)`);
        const rows = all.rows.filter((r) => !r.stub);
        const movable = rows.filter((r) => !r.refusals.length);
        const reasons = new Map();
        for (const r of rows) for (const f of r.refusals) {
            const key = f.reason.replace(/`[^`]*`/g, '`…`');
            reasons.set(key, (reasons.get(key) ?? 0) + 1);
        }
        console.log(`instance methods with a body, not stubs: ${rows.length}; movable under the closed set: ${movable.length} (${movable.reduce((a, r) => a + r.lines, 0)} lines); refused: ${rows.length - movable.length} (${rows.filter((r) => r.refusals.length).reduce((a, r) => a + r.lines, 0)} lines)`);
        console.log(`instance/static name clashes: ${clashes.length ? clashes.join(', ') : 'none'}`);
        for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${k}`);
        if (rest.includes('--rows')) for (const r of rows) console.log(`${r.refusals.length ? 'REFUSED' : 'movable'}\t${r.name}\t${r.lines}\t${r.sites}${r.refusals.length ? `\t${r.refusals.map((f) => `L${f.line} ${f.reason}`).join(' | ')}` : ''}`);
        return 0;
    }
    if (cmd === 'move') {
        const [member, moduleFile] = rest;
        if (!member || !moduleFile) throw new Error('usage: move <member> <module file name>');
        const source = readFileSync(PROTOCOL, 'utf8');
        const plan = planMove(source, member, moduleFile);
        if (plan.refusals.length) {
            for (const r of plan.refusals) console.error(`REFUSED ${member} line ${r.line}: ${r.reason}`);
            return 1;
        }
        const modPath = `${SRC}/${moduleFile}`;
        const existing = existsSync(modPath) ? readFileSync(modPath, 'utf8') : '';
        writeFileSync(modPath, existing ? `${existing.replace(/\n*$/, '\n')}\n${plan.fnText}` : plan.fnText);
        const stubbed = source.slice(0, plan.stub.start) + plan.stub.text + source.slice(plan.stub.end);
        const hostPath = `${SRC}/${HOST_MODULE}.ts`;
        const { host, protocol } = insertHostEntries(readFileSync(hostPath, 'utf8'), stubbed, plan.hostEntries);
        writeFileSync(hostPath, host);
        writeFileSync(PROTOCOL, protocol);
        console.log(`moved ${member} -> ${modPath}: ${plan.sites.length} rewrite site(s); host members ${plan.names.join(', ') || 'none'}`);
        console.log(`${modPath}: its imports are not written by this tool; add what tsc names.`);
        return 0;
    }
    if (cmd === 'check') {
        const [baseRef, member, moduleFile] = rest;
        if (!baseRef || !member || !moduleFile) throw new Error('usage: check <base-ref> <member> <module file name>');
        const rel = path.relative(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(), path.resolve(PROTOCOL));
        const baseSource = execFileSync('git', ['show', `${baseRef}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
        const r = checkMove({
            baseSource,
            headSource: readFileSync(PROTOCOL, 'utf8'),
            moduleSource: readFileSync(`${SRC}/${moduleFile}`, 'utf8'),
            moduleFile,
            member,
        });
        console.log(JSON.stringify({ member, module: moduleFile, ok: r.ok, rewrites: r.counts, sites: r.sites, textIdentical: r.textIdentical, hostMembers: r.hostMembers }));
        for (const p of r.problems) console.log(`PROBLEM ${p}`);
        return r.ok ? 0 : 1;
    }
    console.error('usage: host-split.mjs survey [--rows] | move <member> <module> | check <base-ref> <member> <module>');
    return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    process.exitCode = main(process.argv.slice(2));
}
