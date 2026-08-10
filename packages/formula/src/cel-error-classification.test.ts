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
 * (a `ParseError` carrying `code: 'limit_exceeded'`) and the non-parse kinds.
 *
 * #6223 finished the job on the other side of the same function. PR #6202 left
 * `type` / `runtime` on the keyword table pending a per-code audit; the audit
 * is the `evaluate-time faults` block below, one fixture per cel-js evaluation
 * code, and it deleted the table. `classifyError` now reads only the error
 * CLASS and its structured `code` — no branch of it reads text an author (or a
 * row) can write.
 */
import { describe, expect, it } from 'vitest';

import { celEngine, parseCelToAst } from './cel-engine';
import type { EvalContext } from './types';
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
      // as an EvaluationError. Since #6223 it is graded by CODE, not by the
      // words "Unknown variable" in the prose: `unknown_variable` is the one
      // evaluate-time code in `CEL_DECLARATION_CODES`, because it is the one
      // that describes the expression rather than the row.
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

  describe('evaluate-time faults are graded by code, never by the echoed source (#6223)', () => {
    /** The kind `evaluate()` reports for `source` against `ctx`. */
    function evalKind(source: string, ctx: EvalContext = {}): { kind: string; message: string } {
      const r = celEngine.evaluate(cel(source), ctx);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error(`expected '${source}' to fault`);
      return { kind: r.error.kind, message: r.error.message };
    }

    it('one fault, four field names, one verdict — the headline case', () => {
      // All four are the SAME `no_such_overload` evaluation fault with the same
      // first line (`no such overload: dyn<string> > int`); they differ only in
      // the source line cel-js echoes into `message`. Before #6223 the three
      // polluted names were graded `parse` — telling the author their
      // syntactically PERFECT expression was malformed, which is the inverse of
      // #6133's misdirection and equally against ADR-0032 D1d.
      for (const field of ['status', 'parse_status', 'syntax_mode', 'unexpected_at', 'type_code']) {
        const source = `record.${field} > 1`;
        // The expression parses and type-checks: nothing is wrong with it.
        expect(celEngine.compile(source).ok).toBe(true);
        const { kind, message } = evalKind(source, { record: { [field]: 'open' } });
        expect(message).toContain('no such overload');
        expect(message).toContain(`record.${field}`); // the echoed source IS there…
        expect(kind).toBe('runtime'); // …and it does not get a vote.
      }
    });

    // One fixture per cel-js 8.0.0 evaluation code reachable through this
    // engine, each pinned to `runtime` — the honest verdict for a fault decided
    // against the ROW. Audited per code (the measurement #6133 deferred), so a
    // cel-js re-wording cannot move any of them and a future `??`-style
    // "improvement" to the classifier goes red here rather than in production.
    it.each([
      ['division_by_zero', '1 / 0', {}, 'division by zero'],
      ['modulo_by_zero', '1 % 0', {}, 'modulo by zero'],
      ['numeric_overflow', '9223372036854775807 + 1', {}, 'integer overflow'],
      ['no_such_overload', '1 + "a"', {}, 'no such overload'],
      ['no_such_key', '{"a": 1}.b', {}, 'No such key'],
      ['index_out_of_bounds', '[1,2,3][-1]', {}, 'index out of bounds'],
      ['index_out_of_range', '"abc".substring(10)', {}, 'index out of range'],
      ['no_matching_overload', 'size(1)', {}, 'found no matching overload'],
      ['invalid_regular_expression', '"a".matches("(")', {}, 'Invalid regular expression'],
      ['invalid_timestamp', 'timestamp("nope")', {}, 'ISO 8601'],
      ['invalid_duration', 'duration("nope")', {}, 'Invalid duration string'],
      ['bool_conversion_error', 'bool("abc")', {}, 'conversion error'],
      // The four below carry the word "type" in cel-js's own prose, which is
      // the ONLY reason the keyword table graded them `type`. Each is a value
      // that would not convert / would not index — a fact about the data.
      ['int_conversion_error', 'int("abc")', {}, 'int() type error'],
      ['uint_conversion_error', 'uint("abc")', {}, 'uint() type error'],
      ['double_conversion_error', 'double("abc")', {}, 'double() type error'],
      ['invalid_index_type', 'bytes("ab")[9]', {}, 'Cannot index type'],
      ['heterogeneous_list_element', '["a", 1].sort()', {}, 'must have the same type'],
      [
        'invalid_comprehension_range',
        'record.n.all(x, x > 0)',
        { record: { n: 5 } },
        'cannot be range of a comprehension',
      ],
      ['invalid_condition_type', 'record.flag ? 1 : 2', { record: { flag: 3 } }, 'must be bool'],
      [
        'invalid_logical_operand',
        'record.flag && true',
        { record: { flag: 3 } },
        'requires bool operands',
      ],
      ['optional_value_missing', 'optional.none().value()', {}, 'Optional value is not present'],
      ['invalid_macro_argument', 'has(record)', { record: { a: 1 } }, 'has() invalid argument'],
    ] as Array<[string, string, EvalContext, string]>)(
      '%s → kind=runtime',
      (_code, source, ctx, fragment) => {
        const { kind, message } = evalKind(source, ctx);
        expect(message).toContain(fragment);
        expect(kind).toBe('runtime');
      },
    );

    it('unknown_variable is the ONE evaluate-time code held back at kind=type', () => {
      // The whole by-code table, asserted as a table of one. It earns the
      // exception because it is the only evaluate-time fault that is a property
      // of the EXPRESSION against the call site's binding contract rather than
      // of the row — see CEL_DECLARATION_CODES in cel-engine.ts.
      const { kind, message } = evalKind('nope.a');
      expect(message).toContain('Unknown variable: nope');
      expect(kind).toBe('type');

      // And it is held back by CODE, not by the phrase: a record key that reads
      // exactly like the fault's prose does not borrow its verdict.
      const borrowed = evalKind('record.unknown_variable > 1', {
        record: { unknown_variable: 'open' },
      });
      expect(borrowed.message).toContain('record.unknown_variable');
      expect(borrowed.kind).toBe('runtime');
    });

    it('a NON-cel-js throw is `runtime` — the residual arm read prose too', () => {
      // The keyword table's last consumer was never dormant. `matches()` is an
      // ObjectStack stdlib binding over `new RegExp(...)`, so an uncompilable
      // pattern escapes as a NATIVE SyntaxError whose message echoes the
      // pattern — and the pattern is written by the author, or (last fixture)
      // read straight off the record. Before #6223 these four one-and-the-same
      // regex failures were graded `type` / `bounds` / `parse` / `type`.
      for (const [source, ctx] of [
        ['matches(record.name, "type(")', { record: { name: 'x' } }],
        ['matches(record.name, "Exceeded maxAstNodes(")', { record: { name: 'x' } }],
        ['matches(record.name, "unexpected(")', { record: { name: 'x' } }],
        ['matches(record.name, "syntax[")', { record: { name: 'x' } }],
        // Not even authored: the pattern is a VALUE on the row.
        ['matches(record.name, record.re)', { record: { name: 'x', re: 'type(' } }],
      ] as Array<[string, EvalContext]>) {
        const { kind, message } = evalKind(source, ctx);
        expect(message).toContain('Invalid regular expression');
        expect(kind).toBe('runtime');
      }
    });

    it('bounds is decided by ParseError code, so prose cannot forge one', () => {
      // `Exceeded max…` is cel-js's bounds wording, raised ONLY by the parser
      // (`Parser#limitExceeded`), hence always a ParseError carrying
      // `code: 'limit_exceeded'`. A real overrun is still `bounds`…
      const overNodes = Array.from({ length: 500 }, (_, i) => `${i}`).join(' + ');
      const real = celEngine.compile(overNodes);
      expect(real.ok).toBe(false);
      if (!real.ok) expect(real.error.kind).toBe('bounds');
      // …and nothing else can claim it, however the message reads.
      const forged = evalKind('matches(record.name, "Exceeded maxAstNodes(")', {
        record: { name: 'x' },
      });
      expect(forged.message).toMatch(/Exceeded max/i);
      expect(forged.kind).toBe('runtime');
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
