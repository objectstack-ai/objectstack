// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The enumeration pin of the "passes in-process, fails once lowered" family
 * (#22837, the family's closing card).
 *
 * ## The family
 *
 * A hook handler runs in two places. In-process, objectql hands it the engine's
 * `HookContext`. Lowered by `objectstack build` into a `body`, the runtime runs
 * it in the QuickJS sandbox against the context `buildSandboxContext`
 * (`packages/runtime/src/sandbox/body-runner.ts`) assembles key by key. Every
 * member the first carries and the second does not is a handler that passes
 * its in-process tests and fails once deployed: `.sudo(` (#14010), `.create(`
 * (#16249), `ctx.dispatch.scope` and `ctx.submitted` (#22810) were each found
 * one at a time, by a report, after shipping.
 *
 * ## What this pins
 *
 * Derived, never listed: both member sets are read from their SOURCES at test
 * time, so a member added on either side is seen the day it lands.
 *
 *   - the in-process face — the keys `HookContextSchema` declares
 *     (`packages/spec/src/data/hook.zod.ts`), one level into each member whose
 *     schema is a `z.object({…})`; a `retiredKey(…)` tombstone is no member;
 *   - the body face — the keys `buildSandboxContext` returns, one level into a
 *     member it builds as an object literal (`dispatch` is `{ mode, index }`)
 *     or passes through whole from the engine context (`session`, `user`).
 *
 * Every member of the first that is absent from the second must be EITHER
 * refused when a handler reaches it — measured behaviourally, by lowering a
 * handler that reads `ctx.<member>` through the real `extractHookBody` and
 * requiring a `forbidden-token` refusal that names the member — OR recorded in
 * {@link DELIBERATE_EXCEPTIONS} with its reason. Neither ⇒ red, naming the
 * member: that is the next member of the family, caught before it ships.
 *
 * The exception list is held to the same derivation in the other direction:
 * an entry for a member that is no longer absent, or that is now refused, is
 * stale and reds — an exception nobody needs is a hole waiting for a member.
 *
 * ## What it does not see, stated
 *
 *   - `api`'s own members. `HookContextSchema.api` is `z.unknown()` at run time
 *     and typed as `IScopedContext` statically, so the schema has no shape to
 *     derive; the VM's `ctx.api` face (`object()` / `transaction()`) is pinned
 *     where its refusals live — `.sudo(` and `.create(` in
 *     `extract-hook-body.test.ts`.
 *   - Depth beyond one level, and a member the runtime builds some other way
 *     (`input`, `previous`, `result` are record snapshots — their keys are the
 *     object's fields, not the context's).
 *   - The ACTION face. It is a different context (`buildActionSandboxContext`)
 *     against a different in-process object, and its lowering is not the hook
 *     face's.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractHookBody, HookBodyExtractionError } from '../src/utils/extract-hook-body.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_CONTEXT_SCHEMA_SOURCE = resolve(HERE, '../../spec/src/data/hook.zod.ts');
const BODY_RUNNER_SOURCE = resolve(HERE, '../../runtime/src/sandbox/body-runner.ts');

/**
 * Members absent from the body face that are deliberately NOT refused, each
 * with why. A path here is `member` or `member.nested`.
 */
const DELIBERATE_EXCEPTIONS: Readonly<Record<string, string>> = {
  id:
    'Declared on HookContextSchema as a tracing id, and set by none of the five hook-context ' +
    "assembly sites in objectql's engine.ts (find, findOne, insert, update, delete — measured on " +
    '1eff3224d7), so it is absent on the in-process face too: a body reading ' +
    '`ctx.id` sees what the handler sees, `undefined`, and nothing diverges. Refusing it would also ' +
    'refuse every `row.id` read off a root-bound record, the commonest read a body makes.',
};

type NestedFace = 'opaque' | 'passthrough' | ReadonlySet<string>;

const parse = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const unwrap = (e: ts.Expression): ts.Expression => {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
};

const propertyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;

/** `z.object({…})` at the ROOT of a builder chain (`z.object({…}).optional().describe(…)`). */
const rootZodObject = (initializer: ts.Expression): ts.ObjectLiteralExpression | undefined => {
  let cur = unwrap(initializer);
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    const callee = cur.expression;
    if (ts.isIdentifier(callee.expression) && callee.expression.text === 'z') {
      if (callee.name.text !== 'object') return undefined;
      const [arg] = cur.arguments;
      return arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;
    }
    cur = unwrap(callee.expression);
  }
  return undefined;
};

const isRetiredKey = (initializer: ts.Expression): boolean => {
  const e = unwrap(initializer);
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'retiredKey';
};

/** The members of one `z.object({…})` literal: name → its own nested member set, if it has one. */
const zodObjectMembers = (literal: ts.ObjectLiteralExpression): Map<string, NestedFace> => {
  const out = new Map<string, NestedFace>();
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyName(prop.name);
    if (name === undefined || isRetiredKey(prop.initializer)) continue;
    const nested = rootZodObject(prop.initializer);
    out.set(name, nested ? new Set(zodObjectMembers(nested).keys()) : 'opaque');
  }
  return out;
};

/** The in-process face: `HookContextSchema`'s declared members, read from the spec source. */
function inProcessFace(): Map<string, NestedFace> {
  const sf = parse(HOOK_CONTEXT_SCHEMA_SOURCE);
  let literal: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (literal) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'HookContextSchema') {
      const find = (n: ts.Node): void => {
        if (literal) return;
        if (ts.isCallExpression(n)) {
          const obj = rootZodObject(n);
          if (obj) {
            literal = obj;
            return;
          }
        }
        ts.forEachChild(n, find);
      };
      if (node.initializer) find(node.initializer);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!literal) throw new Error(`no \`HookContextSchema = …z.object({…})\` found in ${HOOK_CONTEXT_SCHEMA_SOURCE}`);
  return zodObjectMembers(literal);
}

/** The body face: the members `buildSandboxContext` returns, read from the runtime source. */
function bodyFace(): Map<string, NestedFace> {
  const sf = parse(BODY_RUNNER_SOURCE);
  let fn: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'buildSandboxContext') fn = node;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!fn?.body) throw new Error(`no \`function buildSandboxContext\` found in ${BODY_RUNNER_SOURCE}`);

  const locals = new Map<string, ts.Expression>();
  for (const stmt of fn.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) locals.set(decl.name.text, decl.initializer);
    }
  }
  const returned = fn.body.statements.filter(ts.isReturnStatement).at(-1)?.expression;
  if (!returned || !ts.isObjectLiteralExpression(unwrap(returned))) {
    throw new Error('`buildSandboxContext` no longer ends in `return { … }` — teach this pin its new shape');
  }

  /** Object-literal keys anywhere in an expression (the `{ mode, index }` of a conditional). */
  const literalKeys = (e: ts.Node): Set<string> => {
    const keys = new Set<string>();
    const walk = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        for (const p of n.properties) {
          const k = p.name ? propertyName(p.name) : undefined;
          if (k !== undefined) keys.add(k);
        }
        return;
      }
      ts.forEachChild(n, walk);
    };
    walk(e);
    return keys;
  };
  const nestedOf = (member: string, value: ts.Expression): NestedFace => {
    const v = unwrap(value);
    // `engineCtx?.<member>` — the engine's own object, passed whole.
    if (ts.isPropertyAccessExpression(v) && ts.isIdentifier(v.expression) && v.name.text === member) return 'passthrough';
    if (ts.isObjectLiteralExpression(v)) return literalKeys(v);
    if (ts.isIdentifier(v) && locals.has(v.text)) {
      const keys = literalKeys(locals.get(v.text)!);
      return keys.size > 0 ? keys : 'opaque';
    }
    return 'opaque';
  };

  const out = new Map<string, NestedFace>();
  for (const prop of (unwrap(returned) as ts.ObjectLiteralExpression).properties) {
    if (ts.isPropertyAssignment(prop)) {
      const name = propertyName(prop.name);
      if (name !== undefined) out.set(name, nestedOf(name, prop.initializer));
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      out.set(prop.name.text, nestedOf(prop.name.text, prop.name));
    } else if (ts.isSpreadAssignment(prop)) {
      // `...(cond ? { referentialFieldClear: true } : {})` — a conditional member.
      for (const k of literalKeys(prop.expression)) out.set(k, 'opaque');
    }
  }
  return out;
}

/**
 * The member paths the in-process face carries and the body face does not.
 * Throws on an in-process object member whose body counterpart is built in a
 * way this pin cannot read one level into — classify it rather than skip it.
 */
function absentFromBody(inProcess: Map<string, NestedFace>, body: Map<string, NestedFace>): string[] {
  const absent: string[] = [];
  for (const [member, nested] of inProcess) {
    if (!body.has(member)) {
      absent.push(member);
      continue;
    }
    if (nested === 'opaque' || nested === 'passthrough') continue;
    const bodyNested = body.get(member)!;
    if (bodyNested === 'passthrough') continue;
    if (bodyNested === 'opaque') {
      throw new Error(
        `\`${member}\` is an object on the in-process face (${[...nested].join(', ')}) and the body face builds it ` +
          'in a way this pin cannot read one level into. Teach `bodyFace()` its shape, or the members it drops go unseen.',
      );
    }
    for (const k of nested) if (!bodyNested.has(k)) absent.push(`${member}.${k}`);
  }
  return absent.sort();
}

/** A real handler that reads `ctx.<path>`, as the source text an author writes. */
const readerOf = (path: string): ((...a: unknown[]) => unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the handler's SOURCE is the subject under test
  new Function(`return async (ctx) => { const value = ctx.${path}; ctx.input.note = String(value); };`)() as (
    ...a: unknown[]
  ) => unknown;

/** The refusal lowering that reader produced, or `null` when it lowered. */
const refusalOf = (path: string): HookBodyExtractionError | null => {
  try {
    extractHookBody(readerOf(path), `hook 'reads_${path.replace('.', '_')}'`);
    return null;
  } catch (err) {
    if (err instanceof HookBodyExtractionError) return err;
    throw err;
  }
};

describe('the lowered body face, against the in-process HookContext (#22837)', () => {
  const inProcess = inProcessFace();
  const body = bodyFace();
  const absent = absentFromBody(inProcess, body);

  // Anti-vacuity: an empty derivation passes every check below by construction.
  it('derives both faces from their sources, with the members each is known to carry', () => {
    expect([...inProcess.keys()]).toEqual(
      expect.arrayContaining(['object', 'event', 'input', 'previous', 'session', 'dispatch', 'api', 'user']),
    );
    expect([...body.keys()]).toEqual(
      expect.arrayContaining(['input', 'previous', 'session', 'dispatch', 'api', 'user', 'log', 'crypto']),
    );
    expect(inProcess.get('dispatch')).toEqual(new Set(['mode', 'index', 'scope']));
    expect(body.get('dispatch')).toEqual(new Set(['mode', 'index']));
    expect(body.get('session')).toBe('passthrough');
    // A tombstone is no member: `session.roles` is `retiredKey(…)`.
    expect(inProcess.get('session')).not.toContain('roles');
    expect(absent.length).toBeGreaterThan(0);
  });

  it('every member a handler has in-process and a body lacks is refused at lowering, or a recorded exception', () => {
    const unclassified = absent.filter((path) => {
      if (path in DELIBERATE_EXCEPTIONS) return false;
      const err = refusalOf(path);
      return !(err && err.kind === 'forbidden-token' && err.message.includes(`\`ctx.${path}\``));
    });
    expect(
      unclassified,
      'each path here passes in-process and fails once lowered, and nothing refuses it: refuse it in ' +
        '`FORBIDDEN_PATTERNS` (packages/cli/src/utils/extract-hook-body.ts), naming `ctx.<member>`, or record why ' +
        'it is deliberately left unrefused in DELIBERATE_EXCEPTIONS',
    ).toEqual([]);
  });

  it('records no exception that the derivation does not need', () => {
    for (const [path, reason] of Object.entries(DELIBERATE_EXCEPTIONS)) {
      expect(absent, `exception \`${path}\` names a member the body face is not missing`).toContain(path);
      expect(refusalOf(path), `exception \`${path}\` names a member lowering already refuses`).toBeNull();
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  // The measured state on the base of #22837, so a reader sees the classification
  // without running the derivation — and so a member moving class is a visible diff.
  it('classifies today: one exception, five refusals', () => {
    expect(absent).toEqual(['dispatch.scope', 'id', 'provenance', 'ql', 'submitted', 'transaction']);
    expect(absent.filter((p) => refusalOf(p) !== null)).toEqual([
      'dispatch.scope',
      'provenance',
      'ql',
      'submitted',
      'transaction',
    ]);
  });
});
