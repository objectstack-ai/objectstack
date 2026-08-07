/**
 * #6133 — `EvalResult.error.kind` is an author-facing field, not an internal
 * one. It is interpolated verbatim into the write-rejection text
 * (`@objectstack/objectql`'s `rule-validator` / `cel-fault`) and into the REST
 * error body's `reason`. A missing closing paren reported as `runtime` points
 * the author at their data instead of at their expression, which is exactly the
 * misdirection ADR-0032 D1d asks these messages to avoid.
 *
 * cel-js 8.0.0 has ~19 distinct parse-time wordings; only three of them contain
 * `parse` / `unexpected` / `syntax`. This file pins **one fixture per wording
 * class** so a cel-js re-wording can never silently re-open the hole, and pins
 * the two things the classification must not lose along the way: bounds faults
 * (a `ParseError` carrying `code: 'limit_exceeded'`) and the non-parse kinds
 * the keyword table still owns.
 */
import { describe, expect, it } from 'vitest';

import { celEngine, parseCelToAst } from './cel-engine';
import type { Expression } from '@objectstack/spec';

const cel = (source: string): Expression => ({ dialect: 'cel', source });

/** The kind both entry points report for `source`, asserted to agree. */
function kindOf(source: string): string {
  const compiled = celEngine.compile(source);
  const evaluated = celEngine.evaluate(cel(source), {});
  expect(compiled.ok).toBe(false);
  expect(evaluated.ok).toBe(false);
  if (compiled.ok || evaluated.ok) throw new Error('expected both entries to fault');
  // `classifyError` serves compile() and evaluate() alike — build-time
  // (`os build` / `os validate` / `os lint`) and run-time (write rejection,
  // REST) must never disagree about what kind of mistake the author made.
  expect(evaluated.error.kind).toBe(compiled.error.kind);
  return compiled.error.kind;
}

describe('celEngine error classification (#6133)', () => {
  describe('unbalanced delimiters are syntax faults, not runtime faults', () => {
    // The headline regression: cel-js reports these as `Expected <TOKEN>, got
    // EOF`, which contains none of `parse` / `unexpected` / `syntax`, so the
    // keyword table dropped the whole family to the `runtime` default.
    it.each([
      ['unclosed paren', '((record.a)', 'RPAREN'],
      ['unclosed bracket', '[1, 2', 'RBRACKET'],
      ['unclosed brace', '{"a": 1', 'RBRACE'],
      ['ternary missing colon', 'record.a ? 1', 'COLON'],
    ])('%s → kind=parse', (_label, source, token) => {
      const compiled = celEngine.compile(source);
      expect(compiled.ok).toBe(false);
      if (compiled.ok) return;
      expect(compiled.error.kind).toBe('parse');
      // The message was always right; only the classification was wrong. Pin
      // that the fix did not "fix" it by rewriting the author's diagnostic.
      expect(compiled.error.message).toContain(`Expected ${token}`);
      expect(kindOf(source)).toBe('parse');
    });
  });

  describe('every other cel-js parse-time wording (audited on 8.0.0)', () => {
    // Codes that also missed every keyword and defaulted to `runtime`.
    it.each([
      ['unterminated_string', '"abc'],
      ['unterminated_triple_quoted_string', '"""abc'],
      ['newline_in_string', "'a\nb'"],
      ['invalid_hex_integer', '0xZZ'],
      ['invalid_escape_sequence', '"\\q"'],
      ['invalid_unicode_escape', '"\\u12"'],
      ['invalid_hex_escape', '"\\xZZ"'],
      ['invalid_octal_escape', '"\\07"'],
      ['reserved_identifier', 'record.a && package'],
    ])('%s → kind=parse', (_code, source) => {
      expect(kindOf(source)).toBe('parse');
    });

    // Codes the keyword table already graded correctly — they must stay put.
    it.each([
      ['unexpected_token (trailing operator)', 'record.budget >'],
      ['unexpected_token (QUESTION)', 'record.a ?? 3'],
      ['unexpected_character', 'record.a $$ 1'],
    ])('%s → kind=parse (unchanged)', (_code, source) => {
      expect(kindOf(source)).toBe('parse');
    });
  });

  it('does not read the author source echoed into the message (#6133)', () => {
    // cel-js embeds the offending source line in `message`
    // (`formatErrorWithHighlight`), so a keyword classifier is matching text
    // the AUTHOR controls. Before the fix this exact fixture — an ordinary
    // unbalanced paren — was graded `type`, purely because the echoed line
    // contains the substring "type". A field name must not be able to pick the
    // error kind.
    const compiled = celEngine.compile('((record.type_id)');
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error.message).toContain('record.type_id');
    expect(compiled.error.kind).toBe('parse');

    // Same shape, a field name containing "parse": it must land on `parse` for
    // the structural reason, not by accident of spelling.
    const alsoParse = celEngine.compile('((record.parsed_at)');
    expect(alsoParse.ok).toBe(false);
    if (alsoParse.ok) return;
    expect(alsoParse.error.kind).toBe('parse');
  });

  describe('the kinds that are NOT parse keep their verdicts', () => {
    it('bounds: limit_exceeded is a ParseError but must stay kind=bounds', () => {
      // cel-js raises every bounds violation through the parser, so the
      // structured route has to read `code` before it reads the class.
      const overNodes = Array.from({ length: 500 }, (_, i) => `${i}`).join(' + ');
      const r = celEngine.compile(overNodes);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('bounds');
        expect(r.error.message).toContain('Exceeded maxAstNodes');
      }

      const overList = `[${Array.from({ length: 200 }, (_, i) => i).join(',')}]`;
      const rl = celEngine.compile(overList);
      expect(rl.ok).toBe(false);
      if (!rl.ok) expect(rl.error.kind).toBe('bounds');
    });

    it('type: an unknown function is still kind=type (#1877)', () => {
      const r = celEngine.compile('PRIOR(status) != "promoted"');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('type');
    });

    it('type: an undeclared variable at evaluate time is still kind=type', () => {
      // cel-js's TypeChecker picks its error CLASS by phase
      // (`isEvaluating ? evaluationError : typeError`), so this fault arrives
      // as an EvaluationError. It stays on the keyword table on purpose — the
      // structured route only claims the ParseError arm.
      const r = celEngine.evaluate(cel('nope.a'), {});
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.message).toContain('Unknown variable');
        expect(r.error.kind).toBe('type');
      }
    });

    it('runtime: a genuine evaluation fault is still kind=runtime', () => {
      const r = celEngine.evaluate(cel('1 / 0'), {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('runtime');

      const overload = celEngine.evaluate(cel('1 + "a"'), {});
      expect(overload.ok).toBe(false);
      if (!overload.ok) expect(overload.error.kind).toBe('runtime');
    });

    it('dialect: a mismatched dialect is untouched', () => {
      const r = celEngine.evaluate({ dialect: 'cron', source: 'x' }, {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('dialect');
    });
  });

  it('parseCelToAst never reaches the classifier — it returns null (#4812)', () => {
    // Recorded because the classification fix has a natural blast radius
    // question: does the #4812 canonical parse entry re-emit `kind`? It does
    // not — it swallows the fault and answers `null`, leaving the verdict to
    // compile()/validateExpression. Nothing here changes for it.
    expect(parseCelToAst('((record.a)')).toBeNull();
    expect(parseCelToAst('record.a > 1')).not.toBeNull();
  });
});
