// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The CROSS-PACKAGE DRIFT PIN for `flow-template-grammar.ts` (#16096).
//
// That module MIRRORS the automation template evaluator's whole-token dispatch,
// because `@objectstack/lint` depends on `@objectstack/spec` and never on a
// runtime, so the dialect cannot be imported from the package that owns it. A
// mirror nobody checks is the "N copies, the next author fixes one of N" shape
// `filter-walk.ts` was written against — so this file reads the ORIGINAL from
// disk and fails when any mirrored piece stops matching it.
//
// The read escapes this package, spelled so `check:cross-package-test-inputs`
// can see it, and `$TURBO_ROOT$/packages/services/service-automation/src/**` is
// already a declared input of `@objectstack/lint#test` in turbo.json.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  classifyFlowTemplateToken,
  DATE_FUNCTION_RE,
  VARIABLE_PATH_RE,
  SAFE_EXPRESSION_RE,
  IDENTIFIER_SCAN_RE,
  CALL_POSITION_RE,
  FLOW_TEMPLATE_DATE_FUNCTIONS,
  FLOW_TEMPLATE_VALUE_FUNCTIONS,
} from './flow-template-grammar.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Walk up to the workspace root — the directory holding pnpm-workspace.yaml. */
function findUp(predicate: (dir: string) => boolean): string {
  let dir = HERE;
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('workspace root not found from ' + HERE);
    dir = parent;
  }
}
const REPO = findUp((dir) => existsSync(join(dir, 'pnpm-workspace.yaml')));

const ORIGINAL = join(REPO, 'packages/services/service-automation/src/builtin/template.ts');
// Loud absence: if this file moves, the mirror is unpinned, and an unpinned
// mirror is the defect this test exists to prevent. Failing to read IS the
// regression — never a skip.
const source = readFileSync(ORIGINAL, 'utf8');

describe('the mirrored grammar still matches the evaluator that owns it', () => {
  const mirrored: Array<[string, RegExp]> = [
    ['the NOW()/TODAY() ± N day form', DATE_FUNCTION_RE],
    ['the variable / dotted-path form', VARIABLE_PATH_RE],
    ['the arithmetic character set', SAFE_EXPRESSION_RE],
    ['the identifier scan', IDENTIFIER_SCAN_RE],
    ['the call-position lookahead', CALL_POSITION_RE],
  ];
  for (const [label, re] of mirrored) {
    it(`${label} appears verbatim in template.ts`, () => {
      expect(source).toContain(re.source);
    });
  }

  it('mirrors the value-function table exactly — no name added, none dropped', () => {
    const block = /const EXPRESSION_FUNCTION_ARITY[^{]*\{([\s\S]*?)\n\};/.exec(source);
    expect(block, 'EXPRESSION_FUNCTION_ARITY not found in template.ts').toBeTruthy();
    const names = [...block![1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]);
    expect(names.sort()).toEqual([...FLOW_TEMPLATE_VALUE_FUNCTIONS].sort());
  });

  it('mirrors the two whole-token date function names', () => {
    for (const name of FLOW_TEMPLATE_DATE_FUNCTIONS) expect(DATE_FUNCTION_RE.source).toContain(name);
    // And the evaluator still keeps them OUT of the value table — the reason
    // `{TODAY() - 45 - 10}` is refused while `{TODAY() - 45}` is not.
    const block = /const EXPRESSION_FUNCTION_ARITY[^{]*\{([\s\S]*?)\n\};/.exec(source);
    for (const name of FLOW_TEMPLATE_DATE_FUNCTIONS) expect(block![1]).not.toContain(name);
  });

  it('the evaluator still REFUSES an unknown call rather than resolving it to null', () => {
    // The mirror only means something while the runtime still throws here.
    expect(source).toContain('throw unknownFunctionError(match, trimmed)');
  });

  it('the filter position still hands an unresolved KNOWN filter token to the engine', () => {
    // The layer-one/layer-two split the rule is built on.
    expect(source).toContain('isKnownFilterToken');
  });
});

describe('dispatch ORDER — the property the negative control depends on', () => {
  it('classifies {TODAY() - 45} as a date function, never as a call', () => {
    expect(classifyFlowTemplateToken('TODAY() - 45')).toEqual({ kind: 'date-function', name: 'TODAY' });
  });

  it('classifies TOMORROW() as an unknown function', () => {
    expect(classifyFlowTemplateToken('TOMORROW()')).toEqual({ kind: 'unknown-function', name: 'TOMORROW' });
  });

  it('classifies the open arm as variable-path, never as a finding', () => {
    expect(classifyFlowTemplateToken('recordId')).toEqual({ kind: 'variable-path', head: 'recordId' });
    expect(classifyFlowTemplateToken('record.id')).toEqual({ kind: 'variable-path', head: 'record' });
  });

  it('classifies $User.* as user context', () => {
    expect(classifyFlowTemplateToken('$User.Id')).toEqual({ kind: 'user-context' });
  });

  it('classifies a junk shape as unresolvable rather than as a call', () => {
    expect(classifyFlowTemplateToken('30 days ago')).toEqual({ kind: 'unresolvable-shape' });
    expect(classifyFlowTemplateToken('')).toEqual({ kind: 'unresolvable-shape' });
  });

  it('never reports a reserved literal in call position', () => {
    expect(classifyFlowTemplateToken('null(1)').kind).not.toBe('unknown-function');
  });
});
