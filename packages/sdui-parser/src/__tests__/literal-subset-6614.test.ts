/**
 * objectui#6614 Q1-A — `interpretBrace` materializes the JS LITERAL SUBSET.
 * The objectstack half of the #12719 lockstep (this card: #12977).
 *
 * Maintainer ruling on objectui#6614, 2026-08-28, verbatim and untranslated:
 * 「6614 也同意」 ⇒ Q1-A · Q2-A · Q3-A, adopting that card's recommendation
 * whole. This file pins Q1-A and ONLY Q1-A, in this repo's copy of the parser.
 *
 * WHY THE RULING EXISTS. The html tier is the untrusted-safe DATA tier —
 * parsed, never executed (ADR-0080) — and it is the only safe carrier for
 * runtime AI or tenant authoring. Before this change it accepted strict JSON
 * inside braces while calling itself JSX, so `columns={['name','amount']}` —
 * the spelling every JSX author and every AI author writes — compiled to the
 * deferred `{ $expr }` marker that nothing downstream evaluates, and the
 * author's whole data binding vanished at render (objectui#6598, reported from
 * production after eight spellings were tried). That is a trap, not a contract.
 *
 * WHY THIS FILE EXISTS IN THIS REPO. #12719's invariant is that both copies of
 * the parser byte-agree on the accepted grammar and on diagnostic codes. It
 * carried two obligations and landed only one (the diagnostic, #12811); the
 * grammar half was withheld until objectui#6614 was ruled, and this file is
 * that half arriving. objectui landed first deliberately: `interpretBrace`
 * emits no diagnostic in either dialect, so an objectui-first window means a
 * page saves exactly as it did and now renders correctly, whereas
 * objectstack-first would have meant the save gate materialising while the
 * renderer still deferred — "saves clean, renders inert", the very defect
 * objectui#6598 is.
 *
 * ⭐ WHY THE REFUSAL PINS BELOW MATTER AS MUCH AS THE POSITIVE ONES. A suite
 * that only asserted the newly-legal spellings would pass just as well against
 * a parser that started accepting EVERYTHING — including code — which is the
 * one failure this widening must never ship. So every positive pin here has a
 * refusal pin naming the first thing on the far side of the boundary, and the
 * refusal table is itself guarded against silently emptying.
 *
 * THE BOUNDARY, stated once. Exactly two widenings over JSON:
 *   1. single-quoted strings (value position AND key position);
 *   2. unquoted identifier object keys.
 * Everything else JSON refuses is still refused: trailing commas, comments,
 * holes, spreads, `undefined`/`NaN`/`Infinity`, `+1`/`.5`/`1.`/`0x1f`, template
 * literals, identifiers, member access, calls, and every operator. The subset
 * contains no identifier lookup and no operator, so there is nothing in it to
 * execute — the widening moves habitual spellings onto the materialized side,
 * it does not move the data/code boundary.
 *
 * ⛔ NOT IN SCOPE HERE, by the same ruling: Q2 (escalating `inert-expression`
 * from warning to error — that lands at the SAVE GATE once the framework wires
 * the registry manifest into `validate-jsx-pages`; #12719 records that gap) and
 * Q3 (base-prop `$expr` inertness, sequenced deliberately AFTER this change so
 * no warning is added for spellings this change is about to legalise).
 */
import { describe, expect, it } from 'vitest';
import { compile, interpretBrace, parseJsx } from '../index.js';
import type { Manifest } from '../types.js';

const manifest: Manifest = {
  components: {
    'list-view': {
      type: 'list-view',
      namespace: 'plugin-list',
      inputs: [
        { name: 'objectName', type: 'string', required: true },
        { name: 'columns', type: 'array' },
        { name: 'options', type: 'object' },
        { name: 'title', type: 'string' },
        { name: 'pageSize', type: 'number' },
        { name: 'enabled', type: 'boolean' },
      ],
    },
  },
};

/** The braced attribute value, as it reaches the renderer. */
const propOf = (braced: string, prop = 'columns'): unknown =>
  parseJsx(`<list-view objectName="account" ${prop}={${braced}} />`).tree?.[prop];

describe('#6614 Q1-A — the two ruled widenings materialize', () => {
  it('the production spelling: a single-quoted array reaches the renderer as a real array', () => {
    // objectui#6598's page, byte-for-byte. This is the assertion the whole card
    // exists for: before the ruling this was `{ $expr: "['name','amount']" }`.
    expect(propOf(`['name','amount']`)).toEqual(['name', 'amount']);
    expect(interpretBrace(`['name','amount']`)).toEqual(['name', 'amount']);
  });

  it('a single-quoted string in value position materializes to the string itself', () => {
    expect(propOf(`'Accounts'`, 'title')).toBe('Accounts');
    // No quotes survive into the value — the point is normalization, not a
    // literal copy of the source text.
    expect(interpretBrace(`'Accounts'`)).toBe('Accounts');
  });

  it('unquoted identifier object keys materialize', () => {
    expect(propOf(`{pageSize: 25}`, 'options')).toEqual({ pageSize: 25 });
    expect(propOf(`[{field:"name"},{field:"amount"}]`)).toEqual([
      { field: 'name' },
      { field: 'amount' },
    ]);
    // `$` and `_` are identifier characters, and a digit is legal after the first.
    expect(interpretBrace(`{_a: 1, $b: 2, c3: 3}`)).toEqual({ _a: 1, $b: 2, c3: 3 });
  });

  it('a single-quoted KEY is covered — it is widening #1 in key position', () => {
    expect(interpretBrace(`{'pageSize': 25}`)).toEqual({ pageSize: 25 });
  });

  it('the two widenings compose, and nest', () => {
    expect(interpretBrace(`{cols: ['name','amount'], page: {size: 25, deep: ['x']}}`)).toEqual({
      cols: ['name', 'amount'],
      page: { size: 25, deep: ['x'] },
    });
  });

  it('escapes inside a single-quoted string follow JSON, plus `\\u0027`', () => {
    expect(interpretBrace(`'a\\'b'`)).toBe("a'b");
    expect(interpretBrace(`'tab\\there'`)).toBe('tab\there');
    expect(interpretBrace(`'\\u0041'`)).toBe('A');
    // A double quote needs no escape inside single quotes, and vice versa.
    expect(interpretBrace(`'say "hi"'`)).toBe('say "hi"');
  });

  it('the materialized spellings draw NO diagnostic — the page is simply correct now', () => {
    for (const source of [
      `<list-view objectName="account" columns={['name','amount']} />`,
      `<list-view objectName="account" columns={[{field:'name',label:'Full Name'}]} />`,
      `<list-view objectName="account" options={{pageSize: 25}} />`,
      `<list-view objectName="account" title={'Accounts'} />`,
      `<list-view objectName="account" enabled={true} pageSize={25} />`,
    ]) {
      const r = compile(source, manifest);
      expect(r.diagnostics, source).toEqual([]);
      expect(r.ok, source).toBe(true);
    }
  });

  it('a materialized value is type-checked like any other — the widening does not skip checkType', () => {
    // Single quotes get it PAST the marker; they do not get it past the
    // manifest. A string where an array is declared is still a mismatch.
    const r = compile(`<list-view objectName="account" columns={'name'} />`, manifest);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ code: 'type-mismatch', tag: 'list-view' }),
    ]);
  });
});

/**
 * The far side of the boundary. ⭐ This table IS the durable half of the port:
 * it pins the RULING (exactly two widenings), not merely today's code, so a
 * later widening past those two additions turns it red rather than passing
 * quietly.
 */
const REFUSED: Array<[label: string, braced: string]> = [
  ['a bare identifier', `columns`],
  ['member access', `ctx.user.name`],
  ['a function call', `getColumns()`],
  ['a method call on a literal', `['a'].concat(b)`],
  ['the card-quoted expression', `rows.map((r) => r.name)`],
  ['an arrow function', `() => 1`],
  ['arithmetic', `1 + 2`],
  ['a literal that merely STARTS the expression', `['a'] + x`],
  ['a ternary', `a ? b : c`],
  ['logical short-circuit', `flag && ['a']`],
  ['a template literal', '`col-${n}`'],
  ['an array spread', `[...cols]`],
  ['an object spread', `{...base, pageSize: 25}`],
  ['a trailing comma in an array', `['a',]`],
  ['a trailing comma in an object', `{a: 1,}`],
  ['an array hole', `[,1]`],
  ['a block comment', `/* cols */ ['a']`],
  ['a line comment', `['a'] // cols`],
  ['undefined', `undefined`],
  ['NaN', `NaN`],
  ['Infinity', `Infinity`],
  ['a leading plus', `+1`],
  ['a bare fractional point', `.5`],
  ['a trailing decimal point', `1.`],
  ['a hex number', `0x1f`],
  ['an octal-ish number', `010`],
  ['a non-JSON escape', `'\\x41'`],
  ['an unterminated string', `['a`],
  ['a computed key', `{[k]: 1}`],
  ['a keyword glued to an identifier', `nullish`],
  ['an empty brace', ``],
];

describe('#6614 Q1-A — the far side of the boundary is still refused', () => {
  it('⭐ the refusal table is non-empty and still names every class the ruling refuses', () => {
    // A guard whose success condition equals its total-failure condition must
    // REFUSE. `it.each([])` registers zero cases and reports a clean run, so an
    // emptied or thinned table would look exactly like a passing suite. Assert
    // the walk has something to walk, and that each class named in the ruling
    // is still represented — deleting a row to make a widening "pass" now costs
    // a red test here first.
    expect(REFUSED.length).toBeGreaterThanOrEqual(31);
    const labels = REFUSED.map(([label]) => label).join(' | ');
    for (const required of [
      'identifier',
      'member access',
      'function call',
      'arrow function',
      'arithmetic',
      'ternary',
      'template literal',
      'spread',
      'trailing comma',
      'hole',
      'comment',
      'undefined',
      'NaN',
      'Infinity',
      'plus',
      'fractional point',
      'decimal point',
      'hex',
      'computed key',
    ]) {
      expect(labels, `refusal class missing from the table: ${required}`).toContain(required);
    }
  });

  it.each(REFUSED)('%s stays the deferred `{ $expr }` marker', (_label, braced) => {
    expect(interpretBrace(braced)).toEqual({ $expr: braced.trim() });
  });

  it('a refused value still draws the warning-severity `inert-expression` diagnostic', () => {
    const r = compile(
      `<list-view objectName="account" columns={rows.map((r) => r.name)} />`,
      manifest,
    );
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'inert-expression',
        tag: 'list-view',
        message: expect.stringContaining('"columns"'),
      }),
    ]);
    expect(r.tree?.columns).toEqual({ $expr: 'rows.map((r) => r.name)' });
    // ⛔ Q2 is NOT this change: the render-side severity stays `warning`, and
    // the page still compiles. Escalation belongs at the save gate.
    expect(r.ok).toBe(true);
  });

  it('the diagnostic no longer advises a spelling that now works', () => {
    const r = compile(`<list-view objectName="account" columns={getCols()} />`, manifest);
    const message = r.diagnostics[0].message;
    // The pre-#6614 message said "write it as JSON (double-quoted strings and
    // keys)" and named `columns={['name','amount']}` as the WRONG form. That
    // spelling is now correct, so the old advice would send an author to edit
    // working source. Pin that it is gone.
    expect(message).not.toMatch(/double-quoted/);
    expect(message).toContain('LITERALS only');
  });
});

describe('#6614 Q1-A — strict JSON is byte-identical to before', () => {
  /**
   * The invariance is structural, not incidental: `interpretBrace` still calls
   * `JSON.parse` FIRST and untouched, so an input JSON accepts never reaches
   * the new reader at all. This pins the property that structure guarantees.
   */
  const STRICT_JSON = [
    `["name","amount"]`,
    `[{"field":"name","label":"Full Name"}]`,
    `{"pageSize":25}`,
    `{}`,
    `[]`,
    `"plain string"`,
    `25`,
    `-0`,
    `1e3`,
    `-1.5e-3`,
    `true`,
    `false`,
    `null`,
    `{"nested":{"deep":[1,2,{"x":null}]}}`,
    `"escaped \\" quote"`,
    `"\\u00e9"`,
    `{"__proto__":1}`,
    `{"a":1,"a":2}`,
  ];

  it.each(STRICT_JSON)('%s parses exactly as JSON.parse does', (source) => {
    expect(interpretBrace(source)).toEqual(JSON.parse(source));
  });

  it('-0 keeps its sign, as JSON.parse gives it', () => {
    expect(Object.is(interpretBrace(`-0`), -0)).toBe(true);
  });

  it('a strict-JSON page compiles with the same zero diagnostics it always did', () => {
    for (const source of [
      `<list-view objectName="account" columns={["name","amount"]} />`,
      `<list-view objectName="account" columns={[{"field":"name","label":"Full Name"}]} />`,
      `<list-view objectName="account" options={{"pageSize":25}} />`,
      `<list-view objectName="account" />`,
    ]) {
      const r = compile(source, manifest);
      expect(r.diagnostics, source).toEqual([]);
      expect(r.ok, source).toBe(true);
    }
  });
});

describe('#6614 Q1-A — the widening opens no execution or pollution lever', () => {
  /**
   * ⚠️ THE SECURITY CLAUSE, ahead of the grammar. This tier's whole reason to
   * exist is that untrusted page source is safe to PARSE. A real JS object
   * literal `{__proto__: {...}}` invokes the prototype SETTER; `JSON.parse`
   * creates an ordinary own data property. Matching JS here would be WRONG: a
   * plain `out[key] = value` in the unquoted-key path would hand untrusted page
   * source a prototype-pollution lever the strict-JSON path never had — that is
   * a widening of ATTACK SURFACE, not a parser detail.
   *
   * So the assertion is on the PROPERTY DESCRIPTOR, in every key spelling the
   * grammar now admits. Reading the value back would pass against the
   * vulnerable implementation too, because the setter's target is readable
   * through the prototype chain — a read is not evidence here.
   */
  const PROTO_SPELLINGS: Array<[label: string, braced: string]> = [
    ['unquoted (the newly-legal key spelling)', `{__proto__: {polluted: true}}`],
    ['single-quoted key (widening #1 in key position)', `{'__proto__': {'polluted': true}}`],
    ['double-quoted key (the strict-JSON path, unchanged)', `{"__proto__": {"polluted": true}}`],
  ];

  it.each(PROTO_SPELLINGS)(
    'an authored `__proto__` key — %s — becomes an OWN DATA property, never the prototype',
    (_label, braced) => {
      const value = interpretBrace(braced) as Record<string, unknown>;

      // 1. It is an own property, not something reached through the chain.
      expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(true);

      // 2. It is a DATA property — `value`, not `get`/`set`. This is the
      //    assertion a prototype-setter implementation fails.
      const descriptor = Object.getOwnPropertyDescriptor(value, '__proto__');
      expect(descriptor).toBeDefined();
      expect(descriptor).toEqual(
        expect.objectContaining({ enumerable: true, writable: true, configurable: true }),
      );
      expect(descriptor && 'value' in descriptor).toBe(true);
      expect(descriptor?.get).toBeUndefined();
      expect(descriptor?.set).toBeUndefined();
      expect(descriptor?.value).toEqual({ polluted: true });

      // 3. The object's own prototype is untouched, and nothing leaked to
      //    `Object.prototype` — the actual pollution the lever would buy.
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  it('the DEFERRED path gains no lever either — a refused `__proto__` source stays a plain marker', () => {
    // The negative side of the clause. An expression-valued `__proto__` key is
    // refused by the grammar and comes back as `{ $expr }`; that marker is
    // constructed here, from an object literal whose only key is `$expr`, so
    // authored text can never reach a key position at all. Pinned so a future
    // "helpful" marker that echoes parsed keys cannot reopen the hole.
    const marker = interpretBrace(`{__proto__: ctx.evil}`) as Record<string, unknown>;
    expect(marker).toEqual({ $expr: '{__proto__: ctx.evil}' });
    expect(Object.keys(marker)).toEqual(['$expr']);
    expect(Object.prototype.hasOwnProperty.call(marker, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(marker)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('a nested `__proto__` key is an own data property too — the guard is not top-level only', () => {
    const value = interpretBrace(`{opts: {__proto__: {polluted: true}}}`) as {
      opts: Record<string, unknown>;
    };
    expect(Object.prototype.hasOwnProperty.call(value.opts, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(value.opts)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('a key named like a prototype member does not read through to it', () => {
    const value = interpretBrace(`{constructor: 'x', toString: 'y'}`) as Record<string, unknown>;
    expect(value.constructor).toBe('x');
    expect(value.toString).toBe('y');
  });

  it('duplicate keys take the last value, as both JSON and a JS literal do', () => {
    expect(interpretBrace(`{a: 1, a: 2}`)).toEqual({ a: 2 });
  });

  it('event handlers and raw-HTML injection stay forbidden regardless of the value grammar', () => {
    const r = parseJsx(`<list-view onClick={'x'} dangerouslySetInnerHTML={{__html: 'x'}} />`);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['forbidden-attr', 'forbidden-attr']);
  });
});
