/**
 * Every worked example on `src/zod/README.md` must get the verdict the page
 * teaches when it is handed to the schema it names (objectui#9522).
 *
 * ## The defect this closes
 *
 * The page's FIRST example — under `### Basic Validation`, the first thing a
 * reader of this package runs — could not validate. It authored
 * `variant: 'primary'`, which is not one of `ButtonSchema.variant`'s enum
 * members, and `onClick`, which `form.zod.ts` declares through
 * `handlerKeyRefusal(..., 'runtime-slot', ...)` and therefore refuses for EVERY
 * value (objectui#6124). `safeParse` came back with two issues and the page's
 * own `if (result.success)` branch — the branch it exists to teach — never ran.
 *
 * ## Why no gate saw it
 *
 * `check:doc-snippets` COMPILES this fence and it compiled cleanly. Its own
 * header names the reason: "Schema-key validity … is a different question with
 * a different answer", left unruled there because a general gate "needs a way
 * to mark which blocks are complete documents rather than prose fragments, and
 * guessing that boundary is what produces a gate people learn to ignore".
 * ⇒ this file does not guess that boundary, it DECLARES it: {@link LEDGER}
 * marks, for this one page, which fences are complete documents and what
 * verdict each is supposed to get. The page was type-correct and
 * runtime-wrong at the same time, which is the gap a compiler cannot close.
 *
 * ## The examples are EXTRACTED, never retyped
 *
 * A hand copy drifts from the page it claims to pin and pins nothing. Every
 * config below is read out of the README's own fences and evaluated from its
 * TypeScript AST, so a moved heading, a deleted fence or a rewritten literal
 * throws out of the extractor rather than passing against a stale fixture.
 *
 * An initialiser that is not a literal — an arrow function, a call, an
 * identifier — evaluates to {@link NON_LITERAL} rather than being dropped, so a
 * key like `onClick` stays PRESENT in the object handed to the schema. That
 * matters: `handlerKeyRefusal` refuses the key by name, so its refusal depends
 * on the key being there and not on what the value was.
 *
 * ## Three things make the green a measurement
 *
 * 1. A CONTROL that the validator still discriminates: the historical body of
 *    example 1 must still be refused, at both `variant` and `onClick`.
 * 2. A DELIBERATELY-REFUSED row: `### Error Messages` teaches what a rejection
 *    looks like, so it is ledgered `refused` and its issue `code`/`path` are
 *    asserted. A ledger with only `valid` rows cannot tell a live schema from
 *    one that accepts everything.
 * 3. EXHAUSTIVENESS: the ledger is compared against a scan of every fence on
 *    the page, so an example added later without a row here fails this file
 *    instead of shipping unpinned.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import * as zod from '../zod/index.zod';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

const README = join(uiRoot(), 'packages/types/src/zod/README.md');

/**
 * What an initialiser evaluates to when it is not a literal. Kept as a PRESENT
 * value rather than an omission — see this file's header.
 */
const NON_LITERAL = Symbol('non-literal');

type Verdict = 'valid' | 'refused';

interface LedgerRow {
  /** The README heading the example lives under — cited by text, never by line. */
  readonly heading: string;
  /** The exported schema the fence hands its config to. */
  readonly schema: string;
  readonly verdict: Verdict;
  /** Why this row has this verdict, for the reader who makes it fail. */
  readonly why: string;
}

/**
 * The complete documents on this page, and the verdict each one teaches.
 * ⛔ A fence that hands a literal to a schema and is absent here fails the
 * exhaustiveness leg — adding an example means adding its row.
 */
const LEDGER: readonly LedgerRow[] = [
  {
    heading: '### Basic Validation',
    schema: 'ButtonSchema',
    verdict: 'valid',
    why: 'The first example on the page. A reader copies it and takes the `result.success` branch.',
  },
  {
    heading: '### Form Validation',
    schema: 'FormSchema',
    verdict: 'valid',
    why: 'A complete form document, shown as something to hand to `safeParse`.',
  },
  {
    heading: '### Error Messages',
    schema: 'ButtonSchema',
    verdict: 'refused',
    why: 'DELIBERATELY invalid — `variant: \'invalid-variant\'` is the page teaching what a rejection looks like.',
  },
  {
    heading: '### Nested Validation',
    schema: 'CardSchema',
    verdict: 'valid',
    why: 'Shown under `CardSchema.parse`, which THROWS on a refusal, so a broken literal breaks the snippet outright.',
  },
  {
    heading: '## Best Practices',
    schema: 'ButtonSchema',
    verdict: 'valid',
    why: '"Combine with TypeScript types" — the literal is typed AND parsed, so both faces must accept it.',
  },
  {
    heading: '## Migration from TypeScript-only Types',
    schema: 'ButtonSchema',
    verdict: 'valid',
    why: 'The "after" half of the migration: the same literal plus a runtime check at the boundary.',
  },
];

/** The body of example 1 as the page taught it before objectui#9522 — the control's input. */
const HISTORICAL_BASIC_VALIDATION = {
  type: 'button',
  label: 'Click Me',
  variant: 'primary',
  onClick: () => undefined,
};

interface Fence {
  readonly heading: string;
  readonly lang: string;
  readonly body: string;
}

/** Every fenced block on the page, tagged with the heading it sits under. */
function fences(): Fence[] {
  const lines = readFileSync(README, 'utf8').split('\n');
  const out: Fence[] = [];
  let heading = '(before the first heading)';
  let i = 0;
  while (i < lines.length) {
    if (/^#{1,6} /.test(lines[i])) heading = lines[i].trim();
    const open = /^[ \t]*```(\w*)[ \t]*$/.exec(lines[i]);
    if (!open) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !/^[ \t]*```[ \t]*$/.test(lines[j])) j += 1;
    if (j >= lines.length) throw new Error(`unterminated \`\`\` fence under "${heading}" in ${README}`);
    // Fences inside a numbered list are indented; dedent so they parse as TS.
    const body = lines.slice(i + 1, j).map((l) => l.replace(/^ {2,}/, '')).join('\n');
    out.push({ heading, lang: open[1] || '(untagged)', body });
    i = j + 1;
  }
  if (out.length === 0) throw new Error(`no fenced blocks found in ${README} — the extractor read nothing`);
  return out;
}

/** Evaluate a TypeScript expression node, but only where it is a literal. */
function literalOf(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = literalOf(node.operand);
    return typeof inner === 'number' ? -inner : NON_LITERAL;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((e) => literalOf(e));
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) return NON_LITERAL;
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (key === null) return NON_LITERAL;
      out[key] = literalOf(prop.initializer);
    }
    return out;
  }
  return NON_LITERAL;
}

interface Example {
  readonly heading: string;
  readonly schema: string;
  readonly config: Record<string, unknown>;
}

/**
 * Every `<Something>Schema.parse(x)` / `.safeParse(x)` on the page whose `x`
 * resolves to an object literal — inline, or through a `const` in the same
 * fence. Anything else (a `declare const`, a function parameter, a request
 * body) is prose, not a document, and is not collected.
 */
function examples(): Example[] {
  const found: Example[] = [];
  for (const fence of fences()) {
    if (fence.lang !== 'typescript' && fence.lang !== 'ts' && fence.lang !== 'tsx') continue;
    const source = ts.createSourceFile('fence.ts', fence.body, ts.ScriptTarget.ESNext, true);
    const bindings = new Map<string, unknown>();
    const calls: { schema: string; arg: ts.Expression }[] = [];

    const walk = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isObjectLiteralExpression(node.initializer)) {
          bindings.set(node.name.text, literalOf(node.initializer));
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text.endsWith('Schema') &&
        (node.expression.name.text === 'parse' || node.expression.name.text === 'safeParse') &&
        node.arguments.length === 1
      ) {
        calls.push({ schema: node.expression.expression.text, arg: node.arguments[0] });
      }
      ts.forEachChild(node, walk);
    };
    walk(source);

    for (const call of calls) {
      let config: unknown;
      if (ts.isIdentifier(call.arg)) {
        if (!bindings.has(call.arg.text)) continue;
        config = bindings.get(call.arg.text);
      } else if (ts.isObjectLiteralExpression(call.arg)) {
        config = literalOf(call.arg);
      } else {
        continue;
      }
      if (typeof config !== 'object' || config === null) continue;
      found.push({ heading: fence.heading, schema: call.schema, config: config as Record<string, unknown> });
    }
  }
  return found;
}

const EXAMPLES = examples();

function key(of: { heading: string; schema: string }): string {
  return `${of.heading} :: ${of.schema}`;
}

function schemaNamed(name: string): { safeParse: (v: unknown) => ReturnType<typeof zod.ButtonSchema.safeParse> } {
  const candidate = (zod as Record<string, unknown>)[name];
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as { safeParse?: unknown }).safeParse !== 'function'
  ) {
    throw new Error(`the README names \`${name}\`, which \`@object-ui/types/zod\` does not export as a schema`);
  }
  return candidate as { safeParse: (v: unknown) => ReturnType<typeof zod.ButtonSchema.safeParse> };
}

function reasons(schema: string, config: unknown): string[] {
  const result = schemaNamed(schema).safeParse(config);
  return result.success ? [] : result.error.issues.map((i) => `${i.code} [${i.path.join('.')}]: ${i.message}`);
}

describe("packages/types/src/zod/README.md: the page's worked examples", () => {
  it('EXHAUSTIVENESS: every ledgered example was found, and every found example is ledgered', () => {
    const extracted = new Set(EXAMPLES.map(key));
    const ledgered = new Set(LEDGER.map(key));
    expect(
      [...ledgered].filter((k) => !extracted.has(k)),
      'A ledgered example is no longer on the page under that heading. The extractor found nothing for it, ' +
        'so its row below would pass against an empty fixture. Re-point the row, or drop it.',
    ).toEqual([]);
    expect(
      [...extracted].filter((k) => !ledgered.has(k)),
      'This page grew a worked example with no row in LEDGER, so nothing says what verdict it is supposed ' +
        'to get and it ships unpinned — the state objectui#9522 was filed about. Add its row.',
    ).toEqual([]);
    // A collision would let two fences share one row and hide one of them.
    expect(new Set(EXAMPLES.map(key)).size, 'two extracted examples share a heading AND a schema').toBe(
      EXAMPLES.length,
    );
  });

  for (const row of LEDGER) {
    const verb = row.verdict === 'valid' ? 'validates' : 'is REFUSED, deliberately';
    it(`${row.heading} — ${row.schema} ${verb}`, () => {
      const example = EXAMPLES.find((e) => key(e) === key(row));
      if (!example) throw new Error(`no extracted example for ${key(row)} (the leg above says why)`);
      const issues = reasons(row.schema, example.config);
      if (row.verdict === 'valid') {
        expect(
          issues,
          `The documented example must survive the validator the page hands it to. ${row.why} It did not:`,
        ).toEqual([]);
      } else {
        expect(issues, `${row.why} If this ever comes back empty, the page is teaching a rejection that no ` +
          'longer happens.').not.toEqual([]);
      }
    });
  }

  it('CONTROL: the historical `Basic Validation` body is still refused at BOTH keys', () => {
    // Without this leg, the green above is equally consistent with a schema that
    // accepts anything. It also pins the two refusals themselves: a widened
    // `variant` enum, or an admitted `onClick`, turns this red.
    const result = zod.ButtonSchema.safeParse(HISTORICAL_BASIC_VALIDATION);
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(
      paths.sort(),
      "`'primary'` is not a ButtonSchema variant and `onClick` is a refused runtime slot (objectui#6124). " +
        'If either stops being refused, a published acceptance set was widened — which is a schema decision, ' +
        'not a documentation one.',
    ).toEqual(['onClick', 'variant']);
  });

  it('the refused example fails at `variant`, the way its own fence says it does', () => {
    const example = EXAMPLES.find((e) => key(e) === '### Error Messages :: ButtonSchema');
    if (!example) throw new Error('the `Error Messages` example is gone (the exhaustiveness leg says so too)');
    const result = zod.ButtonSchema.safeParse(example.config);
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(
      issues.map((i) => `${i.code} [${i.path.join('.')}]`),
      'That fence prints an expected `result.error.issues` beside itself. If the real code or path moves, ' +
        'the printed one becomes fiction that no reader can distinguish from a live reading.',
    ).toEqual(['invalid_value [variant]']);
  });
});
