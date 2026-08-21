// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10653 — the premise, pinned. Every claim in `checked-parse.ts`'s header is a
// measurement, and a measurement that lives only in a comment is one nobody
// re-runs. The two that matter:
//
//   1. `ts.createSourceFile` does not throw on a wreck. That is what makes the
//      `try/catch` this module replaced dead code, and what makes the unread
//      `parseDiagnostics` the LIVE path. If a future TypeScript ever starts
//      throwing, `cannot throw` below fails and the callers' catch-free parses
//      need revisiting — loudly, rather than by a caller crashing in the field.
//   2. The diagnostics are REACHED. `parseDiagnostics` is internal to the
//      compiler and typed optional here, so a rename would make every checked
//      parse silently return "no failure" — the exact green-line-that-lies this
//      module exists to remove, wearing its own badge. `the property is really
//      there` is the non-vacuity proof (#4690: a check that has only ever been
//      green must be tellable apart from a dead one).
//
// The test imports `typescript` directly, which the RULES may not do — they take
// the compiler as a parameter and load it lazily (`lazy-deps.test.ts` guards
// that). A test file is not on the kernel boot path.
import ts from 'typescript';
import { describe, it, expect } from 'vitest';

import { createSourceFileChecked, describeParseFailure } from './checked-parse.js';

/** Wrecks, and the ScriptKind each is measured under. */
const WRECKS: ReadonlyArray<{ label: string; source: string; kind: ts.ScriptKind }> = [
  {
    label: 'merge-conflict markers',
    source: '<<<<<<< HEAD\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> other\n',
    kind: ts.ScriptKind.TS,
  },
  { label: 'truncated function body', source: 'export function f() {\n  const x = 1;\n', kind: ts.ScriptKind.TS },
  { label: 'unterminated string', source: "const s = 'oops;\n", kind: ts.ScriptKind.TS },
  { label: 'unterminated block comment', source: 'function f() {\n  /* TODO\n}\n', kind: ts.ScriptKind.TS },
  { label: 'unterminated template literal', source: 'const s = `oops;\n', kind: ts.ScriptKind.TS },
  { label: 'a JSX element read as TS', source: 'const a = <div>hi</div>;\n', kind: ts.ScriptKind.TS },
];

const parse = (source: string, kind: ts.ScriptKind, synthesizedLinesBefore?: number) =>
  createSourceFileChecked(ts, 'probe.tsx', source, {
    target: ts.ScriptTarget.Latest,
    setParentNodes: true,
    scriptKind: kind,
    ...(synthesizedLinesBefore === undefined ? {} : { synthesizedLinesBefore }),
  });

describe('createSourceFileChecked — the premise (#10653)', () => {
  it.each(WRECKS)('cannot throw: $label', ({ source, kind }) => {
    // The claim is about `createSourceFile` itself, so it is called RAW here —
    // going through the helper would prove only that the helper does not throw.
    expect(() => ts.createSourceFile('probe.tsx', source, ts.ScriptTarget.Latest, true, kind)).not.toThrow();
  });

  it.each(WRECKS)('reports a failure instead of a clean tree: $label', ({ source, kind }) => {
    const { failure } = parse(source, kind);
    expect(failure, 'a source that does not parse must come back with a failure').toBeDefined();
    expect(failure!.count).toBeGreaterThan(0);
    expect(failure!.message.length).toBeGreaterThan(0);
    expect(failure!.line).toBeGreaterThanOrEqual(1);
    expect(failure!.column).toBeGreaterThanOrEqual(1);
  });

  it('the property is really there — non-vacuity of the whole module (#4690)', () => {
    // If `parseDiagnostics` is ever renamed or dropped, the optional read in
    // checked-parse.ts yields undefined and EVERY checked parse in this package
    // goes quietly back to scoring wreckage clean. Nothing else would fail. So
    // the property is asserted directly, on the compiler, once.
    const sf = ts.createSourceFile('probe.ts', 'const a = ;\n', ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
    expect(Array.isArray(diagnostics), '`SourceFile.parseDiagnostics` is gone — checked-parse.ts is now inert').toBe(
      true,
    );
    expect(diagnostics!.length).toBeGreaterThan(0);
  });
});

describe('createSourceFileChecked — a source that DOES parse', () => {
  it.each([
    ['plain TS', 'export const a: number = 1;\n', ts.ScriptKind.TS],
    ['TSX with JSX', 'export default function P() {\n  return <ObjectForm objectName="a" />;\n}\n', ts.ScriptKind.TSX],
    ['empty', '', ts.ScriptKind.TS],
  ] as const)('reports no failure: %s', (_label, source, kind) => {
    expect(parse(source, kind).failure).toBeUndefined();
  });

  it('the SAME source under the wrong ScriptKind is a failure, not an opinion', () => {
    // The ScriptKind hat: `<div>…</div>` is a JSX element in TSX and a wreck in
    // TS. Both verdicts are correct for their kind, and neither is silent.
    const jsx = 'const a = <div>hi</div>;\n';
    expect(parse(jsx, ts.ScriptKind.TSX).failure).toBeUndefined();
    expect(parse(jsx, ts.ScriptKind.TS).failure).toBeDefined();
  });
});

describe('createSourceFileChecked — position reporting', () => {
  it('reports the line the error is on', () => {
    const { failure } = parse('const a = 1;\nconst b = 2;\nconst c = ;\n', ts.ScriptKind.TS);
    expect(failure!.line).toBe(3);
  });

  it('subtracts the caller-synthesised lines, so a wrapper never shifts the blame', () => {
    // What validate-hook-body-writes.ts does: the author wrote `const c = ;` on
    // line 2 of their BODY, and the wrapper puts it on line 3 of what is parsed.
    const body = 'const a = 1;\nconst c = ;\n';
    const wrapped = `async function __body(ctx) {\n${body}\n}`;
    expect(parse(wrapped, ts.ScriptKind.TS).failure!.line, 'raw: the wrapper line counts').toBe(3);
    expect(parse(wrapped, ts.ScriptKind.TS, 1).failure!.line, "remapped: the author's own line").toBe(2);
  });

  it('clamps to line 1 — a diagnostic on a synthesised line never points above the source', () => {
    // A diagnostic that lands ON the wrapper's own first line would remap to 0,
    // which is not a line anybody wrote.
    const failure = parse('const a = ;\n', ts.ScriptKind.TS, 5).failure!;
    expect(failure.line).toBe(1);
  });

  it('counts every diagnostic, and names the first', () => {
    const failure = parse('<<<<<<< HEAD\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> other\n', ts.ScriptKind.TS)
      .failure!;
    expect(failure.count).toBeGreaterThan(1);
    expect(describeParseFailure(failure)).toContain(`${failure.count} syntax errors in total`);
    expect(describeParseFailure(failure)).toContain(failure.message);
  });

  it('a single diagnostic is described without a count', () => {
    const failure = parse('const a = ;\n', ts.ScriptKind.TS).failure!;
    expect(failure.count).toBe(1);
    expect(describeParseFailure(failure)).not.toContain('in total');
  });
});
